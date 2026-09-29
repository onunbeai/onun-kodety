<?php
/**
 * Saúde de entrega.
 *
 * Código nenhum conserta reputação de IP. O que dá para fazer — e é o que esta
 * classe faz — é auditar o servidor com honestidade, gerar o par de chaves
 * DKIM e entregar os registros DNS prontos para colar. Os resultados são
 * recomendações de entregabilidade: nunca substituem a tentativa real do
 * transporte nem bloqueiam uma campanha manual.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Health {
    public const STATUS_OK = 'ok';
    public const STATUS_WARN = 'warn';
    public const STATUS_FAIL = 'fail';

    /** Cache curto: consulta de DNS numa tela de admin não pode travar. */
    private const CACHE_KEY = 'kodety_email_health_report';
    private const CACHE_TTL = 300;
    private const DELIVERY_TEST_OPTION = 'kodety_email_delivery_test';
    private const DELIVERY_TEST_MAX_AGE = 2592000; // 30 dias.

    public static function report(bool $fresh = false): array {
        if (!$fresh) {
            $cached = get_transient(self::CACHE_KEY);
            if (is_array($cached) && (int) ($cached['schema'] ?? 0) === 2) return $cached;
        }

        $settings = Kodety_Email_Settings::all();
        $domain = Kodety_Email_Settings::sender_domain();

        $checks = [
            self::check_sender($settings, $domain),
            self::check_spf($domain),
            self::check_dkim($settings, $domain),
            self::check_dmarc($domain),
            self::check_reverse_dns(),
            self::check_outbound_port($settings),
            self::check_delivery_test($settings),
            self::check_bounce_mailbox($settings),
        ];

        $report = [
            'schema' => 2,
            'domain' => $domain,
            'checks' => $checks,
            'score' => self::score($checks),
            // Compatibilidade: `ready` historicamente era consumido como
            // permissão de envio. Saúde de domínio é consultiva, portanto uma
            // campanha sempre pode tentar o transporte.
            'ready' => self::is_ready($checks),
            'send_allowed' => true,
            'optimized' => self::is_optimized($checks),
            'generated_at' => Kodety_Email_Schema::now(),
        ];

        set_transient(self::CACHE_KEY, $report, self::CACHE_TTL);
        return $report;
    }

    public static function flush(): void {
        delete_transient(self::CACHE_KEY);
    }

    /** Diagnósticos de reputação nunca são autorização para enviar. */
    private static function is_ready(array $checks): bool {
        return true;
    }

    /**
     * Indica somente se a configuração atingiu o nível recomendado. DKIM e um
     * teste recente são evidências; mail() existir ou um socket aceitar conexão
     * não são. O resultado informa a UI, mas não bloqueia o transporte.
     */
    private static function is_optimized(array $checks): bool {
        $required = ['dkim', 'test'];
        foreach ($checks as $check) {
            if (in_array($check['id'], $required, true) && $check['status'] !== self::STATUS_OK) {
                return false;
            }
            if (
                in_array($check['id'], ['sender', 'spf', 'port'], true)
                && $check['status'] === self::STATUS_FAIL
            ) {
                return false;
            }
        }
        return true;
    }

    private static function score(array $checks): int {
        $weights = [
            'sender' => 15,
            'spf' => 10,
            'dkim' => 30,
            'dmarc' => 10,
            'ptr' => 5,
            'port' => 5,
            'test' => 25,
            'bounce' => 0,
        ];
        $total = 0;
        foreach ($checks as $check) {
            $weight = $weights[$check['id']] ?? 0;
            if ($check['status'] === self::STATUS_OK) $total += $weight;
            elseif ($check['status'] === self::STATUS_WARN) $total += (int) round($weight / 2);
        }
        return min(100, $total);
    }

    // --- Checagens individuais -------------------------------------------

    private static function check_sender(array $settings, string $domain): array {
        $from = (string) $settings['from_email'];
        if ($from === '' || !is_email($from)) {
            return self::result('sender', 'Remetente', self::STATUS_FAIL,
                'Nenhum endereço de remetente válido configurado.',
                'Defina o remetente em Configurações.');
        }

        $site_host = (string) wp_parse_url((string) home_url(), PHP_URL_HOST);
        $site_domain = strtolower(preg_replace('/^www\./i', '', $site_host));

        if ($domain !== $site_domain) {
            return self::result('sender', 'Remetente', self::STATUS_WARN,
                sprintf('Enviando como %s, mas o site é %s.', $domain, $site_domain),
                'Use um remetente do domínio do site. Enviar em nome de um domínio de terceiro (gmail.com, por exemplo) é rejeitado por DMARC.');
        }

        return self::result('sender', 'Remetente', self::STATUS_OK, $from, '');
    }

    private static function check_spf(string $domain): array {
        $records = self::txt_records($domain);
        if ($records === null) {
            return self::result('spf', 'SPF', self::STATUS_WARN,
                'Não foi possível consultar o DNS neste servidor.', '');
        }

        $spf_records = array_values(array_filter(
            $records,
            static fn(string $record): bool => stripos(trim($record), 'v=spf1') === 0
        ));
        if (count($spf_records) > 1) {
            return self::result('spf', 'SPF', self::STATUS_FAIL,
                'Há mais de um registro SPF publicado. Isso invalida a avaliação SPF.',
                'Una todos os mecanismos em um único TXT iniciado por v=spf1.');
        }

        if ($spf_records) {
            $record = trim($spf_records[0]);
            if (preg_match('/(?:^|\s)\+?all(?:\s|$)/i', $record)) {
                return self::result('spf', 'SPF', self::STATUS_FAIL, $record,
                    'O mecanismo +all autoriza qualquer servidor. Restrinja as origens e termine com ~all ou -all.');
            }
            if (!preg_match('/(?:^|\s)[~\-]all(?:\s|$)/i', $record)) {
                return self::result('spf', 'SPF', self::STATUS_WARN, $record,
                    'O registro não tem política final. Termine com ~all (softfail) ou -all (fail).');
            }

            // `v=spf1 -all` é sintaticamente válido, mas autoriza exatamente
            // ninguém — portanto não comprova que este WordPress possa enviar.
            if (!preg_match('/(?:^|\s)[+?~-]?(a(?::|\/|\s|$)|mx(?::|\/|\s|$)|ip4:|ip6:|include:|exists:|redirect=)/i', $record)) {
                return self::result('spf', 'SPF', self::STATUS_FAIL, $record,
                    'O SPF não autoriza nenhum servidor de envio. Inclua o IP, host ou provedor usado pelo transporte.');
            }

            return self::result(
                'spf',
                'SPF (análise estrutural)',
                self::STATUS_WARN,
                $record,
                'O registro parece estruturalmente válido, mas só o Authentication-Results de uma mensagem recebida comprova spf=pass para o caminho real de envio.'
            );
        }

        return self::result('spf', 'SPF', self::STATUS_FAIL,
            'Nenhum registro SPF publicado para ' . $domain . '.',
            'Publique um TXT na raiz do domínio autorizando este servidor a enviar.',
            ['type' => 'TXT', 'host' => $domain, 'value' => 'v=spf1 a mx ip4:' . self::server_ip() . ' ~all']);
    }

    private static function check_dkim(array $settings, string $domain): array {
        $selector = (string) $settings['dkim_selector'];
        $public = self::public_key_body((string) $settings['dkim_public_key']);
        $host = $selector . '._domainkey.' . $domain;

        if (trim((string) $settings['dkim_private_key']) === '' || $public === '') {
            return self::result('dkim', 'DKIM', self::STATUS_FAIL,
                'Nenhuma chave DKIM gerada.',
                'Gere o par de chaves — leva um segundo e é o maior ganho de entregabilidade disponível.');
        }

        $expected = 'v=DKIM1; k=rsa; p=' . $public;
        $records = self::txt_records($host);

        if ($records === null) {
            return self::result('dkim', 'DKIM', self::STATUS_WARN,
                'Chave gerada, mas não foi possível consultar o DNS.', '',
                ['type' => 'TXT', 'host' => $host, 'value' => $expected]);
        }

        foreach ($records as $record) {
            if (stripos($record, 'v=DKIM1') === false) continue;
            if (preg_match('/p=([A-Za-z0-9+\/=]+)/', $record, $matches) && $matches[1] === $public) {
                return self::result('dkim', 'DKIM', self::STATUS_OK,
                    'Publicado e conferindo com a chave local (' . $selector . ').', '');
            }
            return self::result('dkim', 'DKIM', self::STATUS_FAIL,
                'Existe um registro DKIM em ' . $host . ', mas a chave publicada é diferente da local.',
                'Substitua o valor do TXT pelo gerado abaixo.',
                ['type' => 'TXT', 'host' => $host, 'value' => $expected]);
        }

        return self::result('dkim', 'DKIM', self::STATUS_FAIL,
            'Chave gerada, mas ainda não publicada no DNS.',
            'Crie este TXT no seu provedor de DNS. A propagação costuma levar alguns minutos.',
            ['type' => 'TXT', 'host' => $host, 'value' => $expected]);
    }

    private static function check_dmarc(string $domain): array {
        $records = self::txt_records('_dmarc.' . $domain);
        if ($records === null) {
            return self::result('dmarc', 'DMARC', self::STATUS_WARN,
                'Não foi possível consultar o DNS neste servidor.', '');
        }

        foreach ($records as $record) {
            if (stripos($record, 'v=DMARC1') === 0) {
                return self::result('dmarc', 'DMARC', self::STATUS_OK, $record, '');
            }
        }

        return self::result('dmarc', 'DMARC', self::STATUS_WARN,
            'Nenhuma política DMARC publicada.',
            'Comece com p=none só para receber relatórios; endureça para quarentena depois de confirmar que SPF e DKIM passam.',
            ['type' => 'TXT', 'host' => '_dmarc.' . $domain, 'value' => 'v=DMARC1; p=none; rua=mailto:dmarc@' . $domain]);
    }

    /**
     * PTR (DNS reverso) com confirmação direta. Provedores grandes recusam ou
     * marcam como spam quem envia de um IP sem reverso coerente.
     */
    private static function check_reverse_dns(): array {
        $ip = self::server_ip();
        if ($ip === '') {
            return self::result('ptr', 'DNS reverso', self::STATUS_WARN, 'IP do servidor não identificado.', '');
        }

        $hostname = @gethostbyaddr($ip);
        if (!is_string($hostname) || $hostname === '' || $hostname === $ip) {
            return self::result('ptr', 'DNS reverso', self::STATUS_WARN,
                'O IP ' . $ip . ' não tem PTR configurado.',
                'Peça ao seu provedor de hospedagem para apontar o reverso do IP para o seu domínio.');
        }

        $forward = @gethostbyname($hostname);
        if ($forward !== $ip) {
            return self::result('ptr', 'DNS reverso', self::STATUS_WARN,
                'O PTR aponta para ' . $hostname . ', mas esse nome não resolve de volta para ' . $ip . '.',
                'O reverso precisa ser confirmado nos dois sentidos.');
        }

        return self::result('ptr', 'DNS reverso', self::STATUS_OK, $hostname . ' → ' . $ip, '');
    }

    /**
     * Testa se a saída SMTP é possível a partir deste servidor. Muitas
     * hospedagens compartilhadas bloqueiam a porta 25 — descobrir isso aqui é
     * melhor do que descobrir com a fila travada.
     */
    private static function check_outbound_port(array $settings): array {
        if ($settings['transport'] === 'local') {
            if (!function_exists('mail')) {
                return self::result('port', 'Saída SMTP', self::STATUS_FAIL,
                    'O modo local depende de mail(), que está indisponível neste PHP.',
                    'Habilite mail/sendmail no servidor ou configure um SMTP.');
            }
            return self::result(
                'port',
                'Saída SMTP (pré-checagem)',
                self::STATUS_WARN,
                'A função mail() existe, mas isso não comprova que o MTA local aceite ou entregue mensagens.',
                'Recomenda-se enviar um teste para validar o caminho real. Você ainda pode iniciar uma campanha manualmente.'
            );
        }

        if ($settings['transport'] === 'smtp') {
            $host = (string) $settings['smtp_host'];
            $port = (int) $settings['smtp_port'];
            if ($host === '') {
                return self::result('port', 'Saída SMTP', self::STATUS_FAIL,
                    'Modo SMTP ativo sem servidor configurado.', 'Informe host, porta e credenciais.');
            }
            return self::probe($host, $port, 'port', 'Saída SMTP');
        }

        // mx_direct depende de porta 25 aberta na saída. Testar contra um MX
        // público real é o único jeito honesto de saber.
        return self::probe('gmail-smtp-in.l.google.com', 25, 'port', 'Saída SMTP (porta 25)',
            'Sua hospedagem bloqueia a porta 25. O modo de entrega direta não vai funcionar aqui — use SMTP ou o modo local.');
    }

    private static function probe(string $host, int $port, string $id, string $label, string $fix = ''): array {
        $errno = 0;
        $error = '';
        $socket = @fsockopen($host, $port, $errno, $error, 5);
        if (!$socket) {
            return self::result($id, $label, self::STATUS_FAIL,
                sprintf('Não foi possível conectar em %s:%d (%s).', $host, $port, $error !== '' ? $error : 'sem resposta'),
                $fix !== '' ? $fix : 'Verifique firewall, porta e credenciais.');
        }
        fclose($socket);
        return self::result(
            $id,
            $label . ' (pré-checagem)',
            self::STATUS_WARN,
            sprintf('O socket em %s:%d aceitou conexão; autenticação e envio ainda não foram testados.', $host, $port),
            'Envie o teste de entrega para validar o transporte completo com a configuração atual.'
        );
    }

    /**
     * Registra o resultado do teste executado pelo próprio transporte.
     *
     * O destinatário nunca é persistido em texto puro e as credenciais entram
     * somente por fingerprint não reversível. Uma falha nova invalida um
     * sucesso anterior da mesma configuração.
     */
    public static function record_delivery_test(
        bool $ok,
        string $recipient,
        array $settings,
        string $error = ''
    ): void {
        update_option(self::DELIVERY_TEST_OPTION, [
            'ok' => $ok,
            'fingerprint' => Kodety_Email_Settings::delivery_fingerprint($settings),
            'transport' => sanitize_key((string) ($settings['transport'] ?? '')),
            'recipient_hash' => hash_hmac(
                'sha256',
                Kodety_Email_Schema::normalize_email($recipient),
                wp_salt('kodety_email_delivery_test')
            ),
            'error' => $ok ? '' : mb_substr(sanitize_text_field($error), 0, 300),
            'tested_at' => Kodety_Email_Schema::now(),
            'tested_at_unix' => time(),
        ], false);
        self::flush();
    }

    private static function check_delivery_test(array $settings): array {
        $test = get_option(self::DELIVERY_TEST_OPTION, []);
        if (!is_array($test) || empty($test['fingerprint'])) {
            return self::result(
                'test',
                'Teste do transporte',
                self::STATUS_WARN,
                'Nenhum teste de entrega foi executado com esta configuração.',
                'Envie um email de teste para validar autenticação, conexão e aceitação pelo transporte.'
            );
        }

        $current = Kodety_Email_Settings::delivery_fingerprint($settings);
        if (!hash_equals((string) $test['fingerprint'], $current)) {
            return self::result(
                'test',
                'Teste do transporte',
                self::STATUS_WARN,
                'Remetente, conexão ou chave DKIM mudaram desde o último teste.',
                'Execute um novo teste; o resultado antigo não vale para a configuração atual.'
            );
        }

        if (empty($test['ok'])) {
            return self::result(
                'test',
                'Teste do transporte',
                self::STATUS_FAIL,
                'O teste mais recente desta configuração falhou: ' . ((string) ($test['error'] ?? '') ?: 'falha não detalhada'),
                'Revise o transporte e repita o teste. O envio manual permanece disponível, mas pode falhar pelo mesmo motivo.'
            );
        }

        $tested_at = (int) ($test['tested_at_unix'] ?? 0);
        if ($tested_at <= 0 || $tested_at < time() - self::DELIVERY_TEST_MAX_AGE) {
            return self::result(
                'test',
                'Teste do transporte',
                self::STATUS_WARN,
                'O último teste bem-sucedido tem mais de 30 dias.',
                'Repita o teste para confirmar que credenciais e conectividade continuam válidas.'
            );
        }

        return self::result(
            'test',
            'Teste do transporte',
            self::STATUS_OK,
            'O transporte aceitou um teste com a configuração atual em ' . (string) ($test['tested_at'] ?? '') . '.',
            'A aceitação não comprova chegada à caixa de entrada; confira também Authentication-Results no email recebido.'
        );
    }

    private static function check_bounce_mailbox(array $settings): array {
        if (empty($settings['bounce_enabled'])) {
            return self::result('bounce', 'Retorno de bounce', self::STATUS_WARN,
                'Return-Path VERP desativado. Falhas síncronas retornadas pelo SMTP continuam sendo classificadas e suprimidas quando seguro.',
                'Ative VERP e conecte seu MTA/provedor ao webhook autenticado para consumir retornos assíncronos.');
        }

        if (strlen((string) ($settings['bounce_webhook_secret'] ?? '')) < 24) {
            return self::result('bounce', 'Retorno de bounce', self::STATUS_WARN,
                'Return-Path VERP ativo, mas o webhook ainda não possui uma credencial válida.',
                'Configure um segredo com ao menos 24 caracteres e conecte o processador de DSN ao endpoint exibido nas configurações.');
        }

        $last_seen = class_exists(Kodety_Email_Bounces::class)
            ? Kodety_Email_Bounces::last_seen()
            : null;
        if (!$last_seen) {
            return self::result('bounce', 'Retorno de bounce', self::STATUS_WARN,
                'Webhook VERP configurado, ainda sem nenhum retorno recebido.',
                'Faça um teste controlado no MTA/provedor. O Onun Kodety não lê caixas IMAP/POP3 automaticamente.');
        }

        return self::result('bounce', 'Retorno de bounce', self::STATUS_OK,
            'Webhook VERP recebeu um retorno em ' . (string) $last_seen['received_at'] . '.',
            'Monitore o processador externo: o webhook cobre DSN/complaint enviados por ele; não existe leitor IMAP/POP3 embutido.');
    }

    // --- DKIM -------------------------------------------------------------

    /**
     * Gera o par RSA 2048 e devolve o registro TXT pronto.
     *
     * @return array{private:string,public:string,record:array}
     */
    public static function generate_dkim_keys(string $domain, string $selector): array {
        if (!function_exists('openssl_pkey_new')) {
            throw new \RuntimeException('A extensão OpenSSL do PHP não está disponível neste servidor.');
        }

        $resource = openssl_pkey_new([
            'digest_alg' => 'sha256',
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        if ($resource === false) {
            throw new \RuntimeException('Não foi possível gerar o par de chaves DKIM.');
        }

        $private = '';
        if (!openssl_pkey_export($resource, $private)) {
            throw new \RuntimeException('Não foi possível exportar a chave privada DKIM.');
        }

        $details = openssl_pkey_get_details($resource);
        $public_pem = (string) ($details['key'] ?? '');
        if ($public_pem === '') {
            throw new \RuntimeException('Não foi possível extrair a chave pública DKIM.');
        }

        return [
            'private' => $private,
            'public' => $public_pem,
            'record' => [
                'type' => 'TXT',
                'host' => $selector . '._domainkey.' . $domain,
                'value' => 'v=DKIM1; k=rsa; p=' . self::public_key_body($public_pem),
            ],
        ];
    }

    /** Remove cabeçalhos PEM e quebras: o TXT do DNS carrega só o base64. */
    private static function public_key_body(string $pem): string {
        $body = preg_replace('/-----(BEGIN|END)[^-]+-----/', '', $pem);
        return (string) preg_replace('/\s+/', '', (string) $body);
    }

    // --- Utilidades -------------------------------------------------------

    /** @return string[]|null Null quando o servidor não consegue consultar DNS. */
    private static function txt_records(string $host): ?array {
        if ($host === '' || !function_exists('dns_get_record')) return null;

        $records = @dns_get_record($host, DNS_TXT);
        if (!is_array($records)) return null;

        $values = [];
        foreach ($records as $record) {
            // `entries` preserva strings TXT longas divididas em partes, o que
            // é comum justamente em chaves DKIM.
            if (!empty($record['entries']) && is_array($record['entries'])) {
                $values[] = implode('', $record['entries']);
                continue;
            }
            if (!empty($record['txt'])) $values[] = (string) $record['txt'];
        }
        return $values;
    }

    public static function server_ip(): string {
        $ip = (string) ($_SERVER['SERVER_ADDR'] ?? '');
        if ($ip !== '' && filter_var($ip, FILTER_VALIDATE_IP)) return $ip;

        $host = (string) wp_parse_url((string) home_url(), PHP_URL_HOST);
        $resolved = $host !== '' ? @gethostbyname($host) : '';
        return is_string($resolved) && filter_var($resolved, FILTER_VALIDATE_IP) ? $resolved : '';
    }

    private static function result(string $id, string $label, string $status, string $detail, string $fix, ?array $record = null): array {
        return [
            'id' => $id,
            'label' => $label,
            'status' => $status,
            'detail' => $detail,
            'fix' => $fix,
            'record' => $record,
        ];
    }
}
