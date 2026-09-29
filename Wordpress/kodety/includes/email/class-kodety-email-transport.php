<?php
/**
 * Entrega de email — 100% self-hosted.
 *
 * Não existe driver de serviço externo aqui por decisão de arquitetura: o
 * WordPress é o backend. Os três modos usam apenas PHP e a stack de email que
 * o cliente já possui.
 *
 *   local     mail()/sendmail do próprio servidor. Default, zero configuração.
 *   smtp      Um servidor SMTP que o cliente controla (o do domínio dele).
 *   mx_direct O WordPress vira o MTA e entrega direto no MX do destinatário.
 *
 * Em todos eles o Onun Kodety assina DKIM, escreve o Return-Path VERP e monta
 * multipart/alternative. A escolha do modo não muda mais nada do sistema.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Transport {
    private static ?self $instance = null;

    /**
     * PHPMailer reaproveitado dentro de um lote. Em SMTP isso mantém a
     * conexão aberta (SMTPKeepAlive), evitando um handshake TLS por email —
     * a diferença entre enviar 25 emails em 2s e em 40s.
     */
    private ?\PHPMailer\PHPMailer\PHPMailer $mailer = null;
    private string $mailer_signature = '';

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {}

    /**
     * @param array $message to, to_name, subject, html, text, verp_token,
     *                       campaign_id, list_unsubscribe, list_unsubscribe_post
     * @return array{ok:bool,code:string,error:string,message_id:string,permanent:bool,suppress:bool}
     */
    public function send(array $message): array {
        $to = Kodety_Email_Schema::normalize_email((string) ($message['to'] ?? ''));
        if ($to === '' || !is_email($to)) {
            return $this->failure('invalid_recipient', 'Endereço de destino inválido.', true, true);
        }

        $message_settings = $message['settings'] ?? null;
        $settings = is_array($message_settings)
            ? array_merge(Kodety_Email_Settings::all(), $message_settings)
            : Kodety_Email_Settings::all();

        try {
            $mailer = $this->mailer_for($to, $settings);
        } catch (\Throwable $exception) {
            return $this->failure('transport_unavailable', $exception->getMessage(), false);
        }

        try {
            $mailer->clearAllRecipients();
            $mailer->clearCustomHeaders();
            $mailer->clearAttachments();
            // O PHPMailer é persistente dentro do lote. Limpar sempre evita
            // herdar o Reply-To da mensagem anterior quando a próxima não tem
            // um endereço configurado.
            $mailer->clearReplyTos();

            $mailer->setFrom((string) $settings['from_email'], (string) $settings['from_name'], false);
            if (is_email((string) $settings['reply_to'])) {
                $mailer->addReplyTo((string) $settings['reply_to'], (string) $settings['from_name']);
            }
            $mailer->addAddress($to, sanitize_text_field((string) ($message['to_name'] ?? '')));

            // Return-Path VERP: o bounce volta para um endereço que carrega o
            // token da linha da fila, o que permite casar o retorno com o
            // contato exato sem depender de webhook de terceiro.
            $mailer->Sender = $this->return_path((string) ($message['verp_token'] ?? ''), $settings);

            $mailer->Subject = (string) ($message['subject'] ?? '');
            $html = (string) ($message['html'] ?? '');
            $text = (string) ($message['text'] ?? '');

            if ($html !== '') {
                $mailer->isHTML(true);
                $mailer->Body = $html;
                // Sem versão texto o filtro de spam pune. Se o renderizador
                // não mandou uma, degrada a partir do HTML.
                $mailer->AltBody = $text !== '' ? $text : wp_strip_all_tags($html);
            } else {
                $mailer->isHTML(false);
                $mailer->Body = $text;
                // isHTML(false) não limpa AltBody. Sem isto uma mensagem texto
                // poderia carregar a alternativa de outra mensagem do lote.
                $mailer->AltBody = '';
            }

            // Gmail e Yahoo já exigem descadastro de um clique de quem envia
            // em volume. Sem estes headers a campanha é penalizada.
            $unsubscribe = (string) ($message['list_unsubscribe'] ?? '');
            if ($unsubscribe !== '') {
                $mailer->addCustomHeader('List-Unsubscribe', $unsubscribe);
                if (!empty($message['list_unsubscribe_post'])) {
                    $mailer->addCustomHeader('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click');
                }
            }
            if (!empty($message['campaign_id'])) {
                $mailer->addCustomHeader('X-Kodety-Campaign', (string) (int) $message['campaign_id']);
            }
            $mailer->addCustomHeader('Precedence', 'bulk');

            $mailer->send();

            return [
                'ok' => true,
                'code' => '',
                'error' => '',
                'message_id' => trim($mailer->getLastMessageID()),
                'permanent' => false,
                'suppress' => false,
            ];
        } catch (\Throwable $exception) {
            $info = $mailer->ErrorInfo !== '' ? $mailer->ErrorInfo : $exception->getMessage();
            // Uma conexão SMTP que falhou pode estar num estado inválido;
            // descartar força reconexão limpa no próximo item do lote.
            $this->close();
            return $this->classify($info);
        }
    }

    /**
     * Fecha a conexão persistente. O worker chama isso ao fim de cada tick —
     * deixar socket SMTP aberto entre requisições vaza recurso no servidor.
     */
    public function close(): void {
        if ($this->mailer instanceof \PHPMailer\PHPMailer\PHPMailer) {
            try {
                $this->mailer->smtpClose();
            } catch (\Throwable $exception) {
                // Fechar é best-effort: o socket pode já ter caído.
                unset($exception);
            }
        }
        $this->mailer = null;
        $this->mailer_signature = '';
    }

    private function mailer_for(string $recipient, array $settings): \PHPMailer\PHPMailer\PHPMailer {
        // No modo mx_direct cada domínio de destino tem um host próprio, então
        // a conexão só é reaproveitada entre destinatários do mesmo domínio.
        $signature = hash('sha256', (string) wp_json_encode([
            'transport' => (string) $settings['transport'],
            'smtp_host' => (string) $settings['smtp_host'],
            'smtp_port' => (int) $settings['smtp_port'],
            'smtp_secure' => (string) $settings['smtp_secure'],
            'smtp_username' => (string) $settings['smtp_username'],
            'smtp_password' => (string) $settings['smtp_password'],
            // DKIM_identity e HELO dependem do remetente; não reaproveite uma
            // instância configurada para outro From.
            'from_email' => (string) $settings['from_email'],
            'dkim_domain' => (string) $settings['dkim_domain'],
            'dkim_selector' => (string) $settings['dkim_selector'],
            'dkim_private_key' => (string) $settings['dkim_private_key'],
        ]));
        if ($settings['transport'] === 'mx_direct') {
            $signature .= '|' . $this->recipient_domain($recipient);
        }

        if ($this->mailer instanceof \PHPMailer\PHPMailer\PHPMailer && $this->mailer_signature === $signature) {
            return $this->mailer;
        }

        $this->close();

        if (!class_exists(\PHPMailer\PHPMailer\PHPMailer::class)) {
            require_once ABSPATH . WPINC . '/PHPMailer/PHPMailer.php';
            require_once ABSPATH . WPINC . '/PHPMailer/SMTP.php';
            require_once ABSPATH . WPINC . '/PHPMailer/Exception.php';
        }

        // O modo MX precisa conectar no IP já validado sem perder o hostname
        // usado por SNI/verificação do certificado. Esta subclasse mínima
        // tenta cada par hostname+IP separadamente e fixa peer_name por alvo.
        $mailer = new class(true) extends \PHPMailer\PHPMailer\PHPMailer {
            /** @var array<int,array{hostname:string,ip:string}> */
            public array $KodetyMXEndpoints = [];

            public function smtpConnect($options = null) {
                if (!$this->KodetyMXEndpoints) {
                    return parent::smtpConnect($options);
                }

                $original_host = $this->Host;
                $last_exception = null;
                foreach ($this->KodetyMXEndpoints as $endpoint) {
                    $ip = (string) $endpoint['ip'];
                    $hostname = (string) $endpoint['hostname'];
                    $this->Host = str_contains($ip, ':') ? '[' . $ip . ']' : $ip;

                    $candidate_options = is_array($options) ? $options : [];
                    $ssl_options = isset($candidate_options['ssl']) && is_array($candidate_options['ssl'])
                        ? $candidate_options['ssl']
                        : [];
                    $candidate_options['ssl'] = array_merge($ssl_options, [
                        'peer_name' => $hostname,
                        'SNI_enabled' => true,
                        'verify_peer' => true,
                        'verify_peer_name' => true,
                        'allow_self_signed' => false,
                    ]);

                    try {
                        if (parent::smtpConnect($candidate_options)) return true;
                    } catch (\Throwable $exception) {
                        $last_exception = $exception;
                    }
                    $this->smtpClose();
                }

                $this->Host = $original_host;
                if ($last_exception instanceof \Throwable) throw $last_exception;
                return false;
            }
        };
        $mailer->CharSet = 'UTF-8';
        $mailer->Encoding = 'quoted-printable';
        $mailer->XMailer = 'Onun Kodety';
        $mailer->Timeout = 20;

        switch ($settings['transport']) {
            case 'smtp':
                $this->configure_smtp($mailer, $settings);
                break;
            case 'mx_direct':
                $this->configure_mx_direct($mailer, $recipient, $settings);
                break;
            default:
                $mailer->isMail();
        }

        $this->apply_dkim($mailer, $settings);

        $this->mailer = $mailer;
        $this->mailer_signature = $signature;
        return $mailer;
    }

    private function configure_smtp(\PHPMailer\PHPMailer\PHPMailer $mailer, array $settings): void {
        $host = trim((string) $settings['smtp_host']);
        if ($host === '') {
            throw new \RuntimeException('O modo SMTP está ativo mas nenhum servidor foi configurado.');
        }

        $mailer->isSMTP();
        $mailer->Host = $host;
        $mailer->Port = (int) $settings['smtp_port'];
        $mailer->SMTPKeepAlive = true;

        if ($settings['smtp_secure'] === 'ssl') {
            $mailer->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
        } elseif ($settings['smtp_secure'] === 'tls') {
            $mailer->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        } else {
            $mailer->SMTPSecure = '';
            $mailer->SMTPAutoTLS = false;
        }

        $username = (string) $settings['smtp_username'];
        if ($username !== '') {
            $mailer->SMTPAuth = true;
            $mailer->Username = $username;
            $mailer->Password = (string) $settings['smtp_password'];
        }
    }

    /**
     * Entrega direta ao MX do destinatário: o WordPress vira o próprio MTA.
     *
     * Modo avançado. Exige porta 25 liberada na saída e PTR correto — sem
     * isso a maioria dos provedores recusa a conexão. A tela de Saúde de
     * entrega só oferece este modo depois do preflight passar.
     */
    private function configure_mx_direct(
        \PHPMailer\PHPMailer\PHPMailer $mailer,
        string $recipient,
        array $settings
    ): void {
        if (!function_exists('stream_socket_client')) {
            // O fallback interno para fsockopen não aceita o contexto TLS que
            // fixa peer_name/SNI; nesse ambiente o modo direto é desativado.
            throw new \RuntimeException(
                'Entrega direta ao MX exige stream_socket_client para validar TLS com segurança.'
            );
        }

        $endpoints = $this->mx_endpoints($this->recipient_domain($recipient));
        if (!$endpoints) {
            throw new \RuntimeException(
                'Nenhum endereço público e seguro foi encontrado para os servidores MX do domínio de destino.'
            );
        }

        $mailer->isSMTP();
        // A subclasse criada em mailer_for fixa o IP do socket e conserva o
        // hostname de cada MX exclusivamente como peer_name/SNI. Não há
        // fallback para nova resolução DNS dentro do PHPMailer.
        $mailer->KodetyMXEndpoints = $endpoints;
        $first_ip = (string) $endpoints[0]['ip'];
        $mailer->Host = str_contains($first_ip, ':') ? '[' . $first_ip . ']' : $first_ip;
        $mailer->Port = 25;
        $mailer->SMTPAuth = false;
        $mailer->SMTPSecure = '';
        $mailer->SMTPAutoTLS = true;
        $mailer->SMTPKeepAlive = true;
        $mailer->Helo = Kodety_Email_Settings::sender_domain_for($settings);
    }

    /**
     * Resolve os MX uma única vez e devolve somente endereços IP públicos.
     *
     * Nunca devolvemos o hostname original nem usamos o resolver legado como
     * fallback. Assim, uma segunda resolução feita no momento do socket não
     * pode trocar um IP público validado por loopback, rede interna ou
     * link-local. Um MX que misture qualquer endereço não público é rejeitado
     * por inteiro, mesmo se também anunciar um endereço público.
     *
     * @return string[] IPs públicos dos MX, ordenados pela prioridade do MX.
     */
    public function mx_hosts(string $domain): array {
        return array_values(array_unique(array_map(
            static fn(array $endpoint): string => (string) $endpoint['ip'],
            $this->mx_endpoints($domain)
        )));
    }

    /** @return array<int,array{hostname:string,ip:string}> */
    private function mx_endpoints(string $domain): array {
        $domain = strtolower(rtrim(trim($domain), '.'));
        if (
            $domain === ''
            || strlen($domain) > 253
            || !function_exists('dns_get_record')
            || filter_var($domain, FILTER_VALIDATE_IP) !== false
            || !self::is_valid_dns_name($domain)
        ) {
            return [];
        }

        $records = @dns_get_record($domain, DNS_MX);
        if (!is_array($records) || !$records) return [];

        usort($records, static fn(array $a, array $b): int => ((int) ($a['pri'] ?? 0)) <=> ((int) ($b['pri'] ?? 0)));

        $endpoints = [];
        foreach ($records as $record) {
            $target = strtolower(rtrim(trim((string) ($record['target'] ?? '')), '.'));
            if (
                $target === ''
                || $target === '.'
                || filter_var($target, FILTER_VALIDATE_IP) !== false
                || !self::is_valid_dns_name($target)
            ) {
                continue;
            }

            $resolved = [];
            $unsafe_target = false;
            foreach ([DNS_A, DNS_AAAA] as $record_type) {
                $address_records = @dns_get_record($target, $record_type);
                if (!is_array($address_records)) {
                    $unsafe_target = true;
                    break;
                }

                foreach ($address_records as $address_record) {
                    $address = $record_type === DNS_A
                        ? trim((string) ($address_record['ip'] ?? ''))
                        : trim((string) ($address_record['ipv6'] ?? ''));
                    // Registros auxiliares (por exemplo CNAME) não carregam IP.
                    if ($address === '') continue;
                    if (!self::is_public_ip($address)) {
                        $unsafe_target = true;
                        break 2;
                    }
                    $resolved[] = $address;
                }
            }

            if ($unsafe_target || !$resolved) continue;
            foreach ($resolved as $address) {
                $key = $target . '|' . $address;
                $endpoints[$key] = ['hostname' => $target, 'ip' => $address];
            }
        }
        return array_values($endpoints);
    }

    private static function is_valid_dns_name(string $hostname): bool {
        return strlen($hostname) <= 253 && preg_match(
            '/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+'
                . '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i',
            $hostname
        ) === 1;
    }

    /**
     * Validação conservadora para destinos de socket.
     *
     * Os flags nativos não cobrem em todas as versões do PHP faixas como
     * CGNAT, documentação e multicast. As verificações explícitas fecham
     * essas lacunas; para IPv6 aceitamos apenas unicast global 2000::/3 e
     * removemos também a faixa de documentação.
     */
    public static function is_public_ip(string $ip): bool {
        $ip = trim($ip);
        if (
            filter_var(
                $ip,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
            ) === false
        ) {
            return false;
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            $numeric = ip2long($ip);
            if ($numeric === false) return false;
            $numeric = (int) sprintf('%u', $numeric);

            foreach ([
                ['0.0.0.0', 8],
                ['10.0.0.0', 8],
                ['100.64.0.0', 10],
                ['127.0.0.0', 8],
                ['169.254.0.0', 16],
                ['172.16.0.0', 12],
                ['192.0.0.0', 24],
                ['192.0.2.0', 24],
                ['192.168.0.0', 16],
                ['198.18.0.0', 15],
                ['198.51.100.0', 24],
                ['203.0.113.0', 24],
                ['224.0.0.0', 4],
                ['240.0.0.0', 4],
            ] as [$network, $prefix]) {
                $base = (int) sprintf('%u', ip2long($network));
                $mask = $prefix === 0 ? 0 : ((0xffffffff << (32 - $prefix)) & 0xffffffff);
                if (($numeric & $mask) === ($base & $mask)) return false;
            }
            return true;
        }

        $packed = @inet_pton($ip);
        if (!is_string($packed) || strlen($packed) !== 16) return false;

        // Somente 2000::/3 é unicast global; isso exclui loopback, ULA,
        // link-local, multicast e endereços IPv4 mapeados.
        if ((ord($packed[0]) & 0xe0) !== 0x20) return false;

        // Faixas especiais dentro de 2000::/3 que os flags do PHP nem sempre
        // classificam como reservadas.
        foreach ([
            ['2001::', 23],       // atribuições de protocolo IETF
            ['2001:db8::', 32],   // documentação
            ['2002::', 16],       // 6to4 (descontinuado)
            ['3fff::', 20],       // documentação
        ] as [$network, $prefix]) {
            if (self::ipv6_has_prefix($packed, $network, $prefix)) return false;
        }

        return true;
    }

    private static function ipv6_has_prefix(string $packed, string $network, int $prefix): bool {
        $network_packed = @inet_pton($network);
        if (!is_string($network_packed) || strlen($network_packed) !== 16) return true;

        $whole_bytes = intdiv($prefix, 8);
        if (
            $whole_bytes > 0
            && substr($packed, 0, $whole_bytes) !== substr($network_packed, 0, $whole_bytes)
        ) {
            return false;
        }

        $remaining_bits = $prefix % 8;
        if ($remaining_bits === 0) return true;
        $mask = (0xff << (8 - $remaining_bits)) & 0xff;
        return (ord($packed[$whole_bytes]) & $mask) === (ord($network_packed[$whole_bytes]) & $mask);
    }

    /**
     * Assinatura DKIM — nativa do PHPMailer que o WordPress já embarca.
     *
     * É o item de maior impacto em entregabilidade que dá para resolver
     * inteiramente em código, sem contratar ninguém.
     */
    private function apply_dkim(\PHPMailer\PHPMailer\PHPMailer $mailer, array $settings): void {
        $private = trim((string) $settings['dkim_private_key']);
        // O domínio d= precisa acompanhar o From efetivo. Isto também corrige
        // instalações atualizadas que ainda carreguem dkim_domain legado.
        $domain = Kodety_Email_Settings::sender_domain_for($settings);
        $selector = trim((string) $settings['dkim_selector']);
        if ($private === '' || $domain === '' || $selector === '') return;

        $mailer->DKIM_domain = $domain;
        $mailer->DKIM_selector = $selector;
        $mailer->DKIM_private_string = $private;
        $mailer->DKIM_identity = (string) $settings['from_email'];
        $mailer->DKIM_copyHeaderFields = false;
    }

    private function return_path(string $verp_token, array $settings): string {
        $from = (string) $settings['from_email'];
        if ($verp_token === '' || empty($settings['bounce_enabled'])) return $from;

        $from_at = strrpos($from, '@');
        $domain = $from_at === false
            ? strtolower(trim((string) ($settings['dkim_domain'] ?? '')))
            : strtolower(substr($from, $from_at + 1));
        if ($domain === '') return $from;

        // VERP com sub-endereçamento: a caixa `bounce@` recebe tudo e o token
        // identifica a linha exata da fila que gerou o retorno.
        return 'bounce+' . $verp_token . '@' . $domain;
    }

    private function recipient_domain(string $email): string {
        $at = strrpos($email, '@');
        return $at === false ? '' : strtolower(substr($email, $at + 1));
    }

    /**
     * Separa falha definitiva de temporária sem transformar todo 5xx em
     * supressão. Um 550 pode ser política, autenticação ou conteúdo; somente
     * códigos enhanced-status específicos de endereço inexistente têm força
     * para banir globalmente o destinatário.
     */
    private function classify(string $info): array {
        if (preg_match('/\b([245])\.(\d{1,3})\.(\d{1,3})\b/', $info, $matches)) {
            $enhanced = $matches[1] . '.' . $matches[2] . '.' . $matches[3];
            if ($matches[1] === '4') {
                return $this->failure('smtp_' . str_replace('.', '_', $enhanced), $info, false);
            }
            if ($matches[1] === '5') {
                $invalid_mailbox = in_array($enhanced, ['5.1.0', '5.1.1', '5.1.3', '5.1.6'], true);
                return $this->failure(
                    'smtp_' . str_replace('.', '_', $enhanced),
                    $info,
                    true,
                    $invalid_mailbox
                );
            }
        }

        if (preg_match('/\b(5\d{2})\b/', $info, $matches)) {
            // Sem enhanced status o motivo é ambíguo. Retenta com backoff e,
            // mesmo ao esgotar, nunca cria uma suppression global.
            return $this->failure('smtp_' . $matches[1], $info, false);
        }
        if (preg_match('/\b(4\d{2})\b/', $info, $matches)) {
            return $this->failure('smtp_' . $matches[1], $info, false);
        }
        // Falha sem código (socket, DNS, timeout) é tratada como temporária:
        // é quase sempre problema de rede, não do destinatário.
        return $this->failure('send_failed', $info, false);
    }

    private function failure(string $code, string $error, bool $permanent, bool $suppress = false): array {
        return [
            'ok' => false,
            'code' => $code,
            'error' => mb_substr(trim($error), 0, 500),
            'message_id' => '',
            'permanent' => $permanent,
            'suppress' => $suppress,
        ];
    }
}
