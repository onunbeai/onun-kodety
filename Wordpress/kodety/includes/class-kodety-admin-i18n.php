<?php

defined('ABSPATH') || exit;

/**
 * Runtime localization for every Kodety-owned administration surface.
 *
 * The Builder and the legacy wp-admin applications predate a shared gettext
 * layer and contain both Portuguese and English source copy. Catalog aliases
 * normalize those rendered phrases to stable message IDs, while locale files
 * contain only the final copy. A new language therefore requires one JSON file
 * and no PHP/React changes.
 */
final class Kodety_Admin_I18n {
    public const OPTION = 'kodety_admin_ui_locale';
    public const AUTO = 'auto';
    private const CATALOG_SUBDIR = 'languages/admin-ui';

    /**
     * Exact Onun Kodety copy rendered by admin/login.js.
     *
     * The administration catalog contains thousands of Builder phrases. The
     * login document needs only this deliberately small, audited surface.
     * Keep this list in sync when the standalone login experience gains copy.
     *
     * @var list<string>
     */
    private const LOGIN_DIRECT_SOURCES = [
        'Abra a mensagem enviada pelo WordPress para concluir com segurança.',
        'Acesso ao Onun Kodety',
        'Acesso protegido pelo WordPress',
        'Boas-vindas de volta',
        'A confirmação foi registrada com segurança.',
        'Acesso confirmado',
        'Ação concluída',
        'Confirme o email administrativo',
        'Crie sua conta',
        'Defina uma nova senha',
        'Entre novamente',
        'Entre para continuar criando, publicando e evoluindo seus projetos.',
        'Escolha uma senha forte para proteger o seu workspace.',
        'Esqueceu sua senha?',
        'Informe seu usuário ou email. O WordPress enviará um link seguro para você continuar.',
        'O próximo passo está na sua caixa de entrada',
        'Ocultar senha',
        'Preencha seus dados para começar a construir com o Onun Kodety.',
        'Revise o endereço antes de continuar para manter a conta protegida.',
        'Sua nova senha já está ativa. Entre novamente para continuar.',
        'Sua sessão terminou. Entre para continuar de onde parou.',
        'Tudo pronto',
        'Você já pode continuar de onde parou.',
    ];

    /**
     * Common WordPress login copy in the two administration locales supported
     * by Onun Kodety. Keys are WordPress' English source and values follow the
     * official pt_BR core language pack. Entries with {placeholders} match the
     * final DOM text after WordPress has injected a site, user or email value.
     *
     * @var array<string,string>
     */
    private const LOGIN_WORDPRESS_COPY = [
        '(opens in a new tab)' => '(abrir em uma nova aba)',
        'Administration email verification' => 'Verificação do e-mail de administração',
        'Change' => 'Alterar',
        'Check your email' => 'Verifique seu e-mail',
        'Close' => 'Fechar',
        'Confirm new password' => 'Confirmar nova senha',
        'Confirm use of weak password' => 'Confirmar o uso de uma senha fraca',
        'Confirm your administration email' => 'Confirme o seu e-mail de administração',
        'Current administration email:' => 'E-mail de administração atual:',
        'Email' => 'E-mail',
        'Enter your new password below or generate one.' => 'Digite sua nova senha abaixo ou gere uma.',
        'Error:' => 'Erro:',
        'Generate Password' => 'Gerar senha',
        'Get New Password' => 'Obter nova senha',
        'Help' => 'Ajuda',
        'Hide' => 'Esconder',
        'Hide password' => 'Ocultar senha',
        'Language' => 'Idioma',
        'Log in' => 'Acessar',
        'Log In' => 'Acessar',
        'Lost Password' => 'Senha perdida',
        'Lost your password?' => 'Perdeu a senha?',
        'Medium' => 'Médio',
        'Mismatch' => 'Incompatível',
        'Missing confirm key.' => 'Chave de confirmação ausente.',
        'Missing request ID.' => 'ID de solicitação ausente.',
        'New password' => 'Nova senha',
        'Password' => 'Senha',
        'Password Reset' => 'Redefinir senha',
        'Password strength unknown' => 'Nível de segurança da senha desconhecido',
        'Please enter a username.' => 'digite um nome de usuário.',
        'Please enter a username or email address.' => 'digite um nome de usuário ou endereço de e-mail.',
        'Please enter your username or email address. You will receive an email message with instructions on how to reset your password.' => 'Digite o seu nome de usuário ou endereço de e-mail. Você receberá um e-mail com instruções sobre como redefinir a sua senha.',
        'Please log in again.' => 'Acesse novamente.',
        'Please type your email address.' => 'preencha seu endereço de e-mail.',
        'Recovery Mode Initialized. Please log in to continue.' => 'Modo de restauração inicializado. Acesse para continuar.',
        'Recovery Mode — {title}' => 'Modo de recuperação — {title}',
        'Register' => 'Cadastre-se',
        'Register For This Site' => 'Cadastre-se nesse site',
        'Registration complete. Please check your email, then visit the' => 'Cadastro concluído. Verifique seu e-mail, então visite a',
        'Registration confirmation will be emailed to you.' => 'Uma confirmação de registro será enviada para você por e-mail.',
        'Registration Form' => 'Formulário de registro',
        'Remember Me' => 'Lembrar-me',
        'Remind me later' => 'Lembre-me depois',
        'Reset Password' => 'Redefinir senha',
        'Save Password' => 'Salvar senha',
        'Selecting "Remember Me" increases the length of time until you’re asked to log in again on this device. To keep your account secure, use this option only on your personal devices.' => 'Selecionar "Lembrar-me" aumenta o tempo até que seja solicitado um novo acesso neste dispositivo. Para manter sua conta segura, use esta opção somente em seus dispositivos pessoais.',
        'Session expired' => 'A sessão expirou',
        'Show' => 'Mostrar',
        'Show password' => 'Mostrar senha',
        'Sorry, that username is not allowed.' => 'este nome de usuário não é permitido.',
        'Strength indicator' => 'Indicador de força',
        'Strong' => 'Forte',
        'The email address is already used.' => 'o endereço de e-mail já está sendo usado.',
        'The email address is not correct.' => 'o endereço de e-mail não está correto.',
        'The email field is empty.' => 'o campo de e-mail está vazio.',
        'The email is correct' => 'O e-mail está correto',
        'The password cannot be a space or all spaces.' => 'A senha não pode ser um espaço ou ser formada apenas por espaços.',
        'The password field is empty.' => 'o campo da senha está vazio.',
        'The password you entered for the email address {email} is incorrect.' => 'a senha fornecida para o e-mail {email} está incorreta.',
        'The password you entered for the username {username} is incorrect.' => 'a senha informada para o usuário {username} está incorreta.',
        'The passwords do not match.' => 'as senhas não são iguais.',
        'The username' => 'o usuário',
        'The username field is empty.' => 'o campo do nome de usuário está vazio.',
        'There is no account with that username or email address.' => 'não existe uma conta com este nome de usuário ou endereço de e-mail.',
        'This email address is already registered.' => 'Este endereço de e-mail já está registrado.',
        'This email may be different from your personal email address.' => 'Esse e-mail pode ser diferente do seu endereço de e-mail pessoal.',
        'This username is invalid because it uses illegal characters. Please enter a valid username.' => 'este nome de usuário é inválido porque usa caracteres não permitidos. Digite um nome de usuário válido.',
        'This username is already registered. Please choose another one.' => 'este nome de usuário já está cadastrado. Escolha outro.',
        'Unknown email address. Check again or try your username.' => 'endereço de e-mail desconhecido. Verifique de novo ou tente com o seu nome de usuário.',
        'Unknown username. Check again or try your email address.' => 'nome de usuário desconhecido. Verifique de novo ou tente com o seu endereço de e-mail.',
        'Update' => 'Atualizar',
        'User action confirmed.' => 'Ação do usuário confirmada.',
        'User registration is currently not allowed.' => 'o cadastro de usuários não está permitido no momento.',
        'Username' => 'Nome de usuário',
        'Username or Email Address' => 'Nome de usuário ou endereço de e-mail',
        'Very weak' => 'Muito fraca',
        'Weak' => 'Fraca',
        'Why is this important?' => 'Por que isso é importante?',
        'You are now logged out.' => 'Você está desconectado agora.',
        'You have logged in successfully.' => 'Login feito com sucesso.',
        'Your password has been reset.' => 'Sua senha foi redefinida.',
        'Your password reset link appears to be invalid. Please request a new link below.' => 'o link para redefinir a sua senha parece ser inválido. Solicite um novo link abaixo.',
        'Your password reset link has expired. Please request a new link below.' => 'o link para redefinir a sua senha expirou. Solicite um novo link abaixo.',
        'Your session has expired. Please log in to continue where you left off.' => 'Sua sessão expirou. Efetue seu login para continuar de onde você parou.',
        'Check your email for the confirmation link, then visit the' => 'Verifique no seu e-mail o link de confirmação, então visite a',
        'login page' => 'página de acesso',
        'Please verify that the' => 'Verifique se o',
        'administration email' => 'e-mail de administração',
        'for this website is still correct.' => 'deste site continua correto.',
        'is not registered on this site. If you are unsure of your username, try your email address instead.' => 'não está cadastrado neste site. Se você não está certo de seu nome de usuário, experimente o endereço de e-mail.',
        '← Go to {site}' => '← Ir para {site}',
    ];

    private static ?self $instance = null;
    /** @var array<string,array<string,mixed>>|null */
    private ?array $catalogs = null;
    /** @var array<string,mixed>|null */
    private ?array $aliases = null;
    /** @var array<string,array<string,string>> */
    private array $exact_translations = [];
    /** @var array<string,list<array{regex:string,names:list<string>,target:string,specificity:int,order:int}>> */
    private array $pattern_translations = [];
    private int $translation_sequence = 0;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('plugins_loaded', [$this, 'load_textdomain'], 0);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_runtime'], 0);
        add_action('login_enqueue_scripts', [$this, 'enqueue_login_runtime'], 0);
        if (function_exists('add_filter')) {
            add_filter('wp_die_handler', [$this, 'filter_wp_die_handler'], PHP_INT_MAX);
            add_filter('rest_post_dispatch', [$this, 'translate_rest_response'], PHP_INT_MAX, 3);
        }
    }

    public function load_textdomain(): void {
        load_plugin_textdomain('kodety', false, dirname(plugin_basename(KODETY_FILE)) . '/languages');
    }

    public function sanitize_selection(mixed $value): string {
        $selection = is_string($value) ? trim(wp_unslash($value)) : self::AUTO;
        if ($selection === self::AUTO) return self::AUTO;
        return isset($this->catalogs()[$selection]) ? $selection : self::AUTO;
    }

    public function selection(): string {
        return $this->sanitize_selection(get_option(self::OPTION, self::AUTO));
    }

    public function wordpress_locale(): string {
        $locale = function_exists('determine_locale') ? determine_locale() : get_locale();
        return str_replace('_', '-', (string) $locale);
    }

    public function effective_locale(): string {
        $selected = $this->selection();
        if ($selected !== self::AUTO) return $selected;
        $wordpress = strtolower($this->wordpress_locale());
        $resolved = str_starts_with($wordpress, 'pt') ? 'pt-BR' : 'en';
        if (!isset($this->catalogs()[$resolved])) $resolved = array_key_first($this->catalogs()) ?: 'en';
        return (string) apply_filters('kodety_admin_ui_locale', $resolved, $wordpress, $selected);
    }

    /** Format a number with the separators selected for the Onun Kodety interface. */
    public function format_number(int|float $number, int $decimals = 0): string {
        $locale = strtolower($this->effective_locale());
        $decimal_separator = str_starts_with($locale, 'pt') ? ',' : '.';
        $thousands_separator = str_starts_with($locale, 'pt') ? '.' : ',';
        return number_format($number, max(0, $decimals), $decimal_separator, $thousands_separator);
    }

    /**
     * Format an administration timestamp without inheriting WordPress' locale.
     *
     * Supported styles intentionally cover the date shapes rendered by Onun Kodety;
     * callers cannot pass arbitrary localized PHP date patterns.
     */
    public function format_date(
        int $timestamp,
        string $style = 'date_time',
        ?DateTimeZone $timezone = null
    ): string {
        if ($timestamp <= 0) return '';
        $timezone ??= function_exists('wp_timezone') ? wp_timezone() : new DateTimeZone('UTC');
        $date = (new DateTimeImmutable('@' . $timestamp))->setTimezone($timezone);
        $is_portuguese = str_starts_with(strtolower($this->effective_locale()), 'pt');

        if ($style === 'short_date') return $date->format($is_portuguese ? 'd/m/Y' : 'm/d/Y');
        if ($style === 'long_date') {
            $weekdays = $is_portuguese
                ? ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
                : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            $months = $is_portuguese
                ? ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
                : ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            $weekday = $weekdays[(int) $date->format('w')];
            $month = $months[(int) $date->format('n')];
            return $is_portuguese
                ? sprintf('%s, %d de %s', $weekday, (int) $date->format('j'), $month)
                : sprintf('%s, %s %d', $weekday, $month, (int) $date->format('j'));
        }
        return $date->format($is_portuguese ? 'd/m/Y \\à\\s H:i' : 'm/d/Y \\a\\t g:i A');
    }

    /** Format a UTC database timestamp in the selected administration locale. */
    public function format_mysql_gmt(string $value, string $style = 'date_time'): string {
        $timestamp = strtotime(trim($value) . ' UTC');
        return $timestamp === false ? '' : $this->format_date($timestamp, $style);
    }

    /** Format a compact elapsed-time duration in the selected administration locale. */
    public function format_duration(int $from, ?int $to = null): string {
        $difference = abs(($to ?? time()) - $from);
        $units = [
            ['seconds' => 31536000, 'en' => ['year', 'years'], 'pt' => ['ano', 'anos']],
            ['seconds' => 2592000, 'en' => ['month', 'months'], 'pt' => ['mês', 'meses']],
            ['seconds' => 604800, 'en' => ['week', 'weeks'], 'pt' => ['semana', 'semanas']],
            ['seconds' => 86400, 'en' => ['day', 'days'], 'pt' => ['dia', 'dias']],
            ['seconds' => 3600, 'en' => ['hour', 'hours'], 'pt' => ['hora', 'horas']],
            ['seconds' => 60, 'en' => ['minute', 'minutes'], 'pt' => ['minuto', 'minutos']],
            ['seconds' => 1, 'en' => ['second', 'seconds'], 'pt' => ['segundo', 'segundos']],
        ];
        foreach ($units as $unit) {
            if ($difference < $unit['seconds'] && $unit['seconds'] !== 1) continue;
            $count = max(1, (int) round($difference / $unit['seconds']));
            $is_portuguese = str_starts_with(strtolower($this->effective_locale()), 'pt');
            $labels = $unit[$is_portuguese ? 'pt' : 'en'];
            $label = $labels[$count === 1 ? 0 : 1];
            return sprintf('%d %s', $count, $label);
        }
        return '';
    }

    /** Format a compact relative timestamp in the selected administration locale. */
    public function format_relative_time(int $from, ?int $to = null): string {
        $duration = $this->format_duration($from, $to);
        if ($duration === '') return '';
        return str_starts_with(strtolower($this->effective_locale()), 'pt')
            ? 'há ' . $duration
            : $duration . ' ago';
    }

    /** @return array<string,array<string,mixed>> */
    public function catalogs(): array {
        if ($this->catalogs !== null) return $this->catalogs;
        $directory = $this->catalog_directory();
        $catalogs = [];
        foreach (glob($directory . '/*.json') ?: [] as $path) {
            if (basename($path) === 'aliases.json' || basename($path) === 'catalog.schema.json') continue;
            $decoded = json_decode((string) file_get_contents($path), true);
            if (!is_array($decoded)) continue;
            $locale = trim((string) ($decoded['locale'] ?? ''));
            $messages = $decoded['messages'] ?? null;
            if ($locale === '' || !is_array($messages)) continue;
            $catalogs[$locale] = [
                'locale' => $locale,
                'name' => sanitize_text_field((string) ($decoded['name'] ?? $locale)),
                'nativeName' => sanitize_text_field((string) ($decoded['nativeName'] ?? $decoded['name'] ?? $locale)),
                'direction' => ($decoded['direction'] ?? 'ltr') === 'rtl' ? 'rtl' : 'ltr',
                'messages' => array_filter($messages, 'is_string'),
                'direct' => is_array($decoded['direct'] ?? null)
                    ? array_filter($decoded['direct'], 'is_string')
                    : [],
                'glossary' => is_array($decoded['glossary'] ?? null)
                    ? array_filter($decoded['glossary'], 'is_string')
                    : [],
                'legacy' => is_array($decoded['legacy'] ?? null)
                    ? array_values(array_filter($decoded['legacy'], 'is_string'))
                    : [],
                'path' => $path,
            ];
        }
        ksort($catalogs);
        return $this->catalogs = $catalogs;
    }

    /** @return array<string,mixed> */
    private function aliases(): array {
        if ($this->aliases !== null) return $this->aliases;
        $path = $this->catalog_directory() . '/aliases.json';
        $decoded = is_file($path) ? json_decode((string) file_get_contents($path), true) : [];
        return $this->aliases = is_array($decoded) ? $decoded : [];
    }

    private function catalog_directory(): string {
        return untrailingslashit((string) apply_filters(
            'kodety_admin_ui_catalog_dir',
            KODETY_DIR . self::CATALOG_SUBDIR
        ));
    }

    /** @return array<string,mixed> */
    private function catalog(?string $locale = null): array {
        $catalogs = $this->catalogs();
        $locale = $locale ?: $this->effective_locale();
        if (isset($catalogs[$locale])) return $catalogs[$locale];
        if (isset($catalogs['en'])) return $catalogs['en'];
        $first = reset($catalogs);
        if (is_array($first)) return $first;
        return [
            'locale' => 'en', 'name' => 'English', 'nativeName' => 'English',
            'direction' => 'ltr', 'messages' => [], 'direct' => [],
            'glossary' => [], 'legacy' => [],
        ];
    }

    /** Translate a stable catalog key for server-rendered plugin chrome. */
    public function message(string $key, array $replacements = []): string {
        $catalog = $this->catalog();
        $fallback = $this->catalog('en');
        $value = (string) ($catalog['messages'][$key] ?? $fallback['messages'][$key] ?? $key);
        return $this->interpolate($value, $replacements);
    }

    /** Replacement values are data, including literal placeholder syntax. */
    private function interpolate(string $template, array $replacements): string {
        return (string) preg_replace_callback(
            '/\{([A-Za-z][A-Za-z0-9_]*)\}/',
            static fn(array $match): string => array_key_exists($match[1], $replacements)
                ? (string) $replacements[$match[1]]
                : $match[0],
            $template
        );
    }

    /**
     * Translate legacy PHP copy by its complete rendered phrase.
     *
     * WordPress gettext cannot translate the plugin's historical Portuguese
     * source strings because the administration catalogs are JSON files. This
     * resolver gives server-rendered error pages and accessibility copy the
     * same exact, placeholder-aware behavior used by admin/i18n.js.
     */
    public function translate(string $source): string {
        $normalized = $this->normalize_source($source);
        if ($normalized === '') return $source;

        $catalog = $this->catalog();
        $fallback = $this->catalog('en');
        $locale = (string) ($catalog['locale'] ?? 'en');
        $this->prepare_translation_index($locale, $catalog, $fallback);
        if (array_key_exists($normalized, $this->exact_translations[$locale])) {
            return $this->exact_translations[$locale][$normalized];
        }
        foreach ($this->pattern_translations[$locale] as $pattern) {
            if (!preg_match($pattern['regex'], $normalized, $values)) continue;
            $replacements = [];
            foreach ($pattern['names'] as $index => $name) {
                $replacements[$name] = (string) ($values[$index + 1] ?? '');
            }
            return $this->interpolate($pattern['target'], $replacements);
        }
        return $source;
    }

    private function normalize_source(string $value): string {
        return trim((string) preg_replace('/\s+/u', ' ', $value));
    }

    private function prepare_translation_index(string $locale, array $catalog, array $fallback): void {
        if (isset($this->exact_translations[$locale], $this->pattern_translations[$locale])) return;
        $this->exact_translations[$locale] = [];
        $this->pattern_translations[$locale] = [];

        $messages = (array) ($catalog['messages'] ?? []);
        $fallback_messages = (array) ($fallback['messages'] ?? []);
        foreach ($this->aliases() as $key => $sources) {
            if (!is_array($sources)) continue;
            $target = (string) ($messages[$key] ?? $fallback_messages[$key] ?? '');
            if ($target === '') continue;
            foreach ($sources as $source) {
                if (is_string($source)) $this->register_translation($locale, $source, $target);
            }
        }
        foreach ((array) ($catalog['direct'] ?? []) as $source => $target) {
            if (is_string($source) && is_string($target)) $this->register_translation($locale, $source, $target);
        }
        usort(
            $this->pattern_translations[$locale],
            static fn(array $left, array $right): int =>
                ($right['specificity'] <=> $left['specificity'])
                ?: ($right['order'] <=> $left['order'])
        );
    }

    private function register_translation(string $locale, string $source, string $target): void {
        $source = $this->normalize_source($source);
        if ($source === '') return;
        $pattern = $this->compile_pattern($source);
        if ($pattern === null) {
            $this->exact_translations[$locale][$source] = $target;
            return;
        }
        $this->pattern_translations[$locale][] = [
            'regex' => $pattern['regex'],
            'names' => $pattern['names'],
            'target' => $target,
            'specificity' => $this->literal_specificity($source),
            'order' => ++$this->translation_sequence,
        ];
    }

    private function literal_specificity(string $source): int {
        $literal = (string) preg_replace('/\{[A-Za-z][A-Za-z0-9_]*\}/', '', $source);
        return function_exists('mb_strlen') ? mb_strlen($literal, 'UTF-8') : strlen($literal);
    }

    /** @return array{regex:string,names:list<string>}|null */
    private function compile_pattern(string $source): ?array {
        $names = [];
        $cursor = 0;
        $expression = '';
        if (!preg_match_all('/\{([A-Za-z][A-Za-z0-9_]*)\}/', $source, $matches, PREG_OFFSET_CAPTURE)) return null;
        foreach ($matches[0] as $index => $match) {
            $expression .= preg_quote(substr($source, $cursor, $match[1] - $cursor), '/');
            $expression .= '(.+?)';
            $names[] = $matches[1][$index][0];
            $cursor = $match[1] + strlen($match[0]);
        }
        $expression .= preg_quote(substr($source, $cursor), '/');
        return ['regex' => '/^' . $expression . '$/u', 'names' => $names];
    }

    /** Translate ordinary wp_die() pages without replacing custom handlers. */
    public function filter_wp_die_handler(callable $handler): callable {
        return function (mixed $message, mixed $title = '', mixed $args = []) use ($handler): void {
            if ($this->is_kodety_request()) {
                if (is_string($message)) $message = $this->translate($message);
                if (is_string($title) && $title !== '') $title = $this->translate($title);
            }
            call_user_func($handler, $message, $title, $args);
        };
    }

    private function is_kodety_request(): bool {
        foreach (['page', 'action'] as $key) {
            $value = $_REQUEST[$key] ?? '';
            if (is_scalar($value) && preg_match('/^kode[tf]y/i', (string) $value)) return true;
        }
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
        if (preg_match('~(?:^|/)kode[tf]y(?:/|$|[?&])~i', $uri)) return true;
        $query = (string) parse_url($uri, PHP_URL_QUERY);
        if ($query !== '') {
            parse_str($query, $params);
            foreach (['page', 'action'] as $key) {
                $value = $params[$key] ?? '';
                if (is_scalar($value) && preg_match('/^kode[tf]y/i', (string) $value)) return true;
            }
        }
        return false;
    }

    /** Translate the user-facing message envelope returned by Onun Kodety REST routes. */
    public function translate_rest_response(mixed $response, mixed $server, mixed $request): mixed {
        $route = is_object($request) && method_exists($request, 'get_route')
            ? (string) $request->get_route()
            : '';
        if (!str_starts_with($route, '/kodety/') && !str_starts_with($route, '/kodefy/')) return $response;

        if (is_object($response) && method_exists($response, 'get_data') && method_exists($response, 'set_data')) {
            $data = $response->get_data();
            if (is_array($data) && isset($data['message']) && is_string($data['message'])) {
                $data['message'] = $this->translate($data['message']);
                $response->set_data($data);
            }
        }
        return $response;
    }

    /** @return array<string,mixed> */
    public function client_config(string $scope = 'kodety'): array {
        $catalog = $this->catalog();
        $messages = (array) $catalog['messages'];
        $aliases = $this->aliases();
        $direct = (array) ($catalog['direct'] ?? []);
        if ($scope === 'login') {
            // wp-login.php is a standalone document. Shipping the complete
            // administration dictionary here used to inline roughly 512 KB on
            // every authentication request, even though none of the Builder
            // copy can be rendered on this surface.
            $messages = [];
            $aliases = [];
            $direct = $this->login_direct_catalog($catalog);
        }
        return [
            'version' => 1,
            'locale' => (string) $catalog['locale'],
            'direction' => (string) $catalog['direction'],
            'scope' => $scope,
            'documentLocale' => $scope !== 'login' || $this->login_document_locale_supported(),
            'aliases' => $aliases,
            'messages' => $messages,
            'direct' => $direct,
            'attributes' => [
                'title', 'placeholder', 'aria-label', 'aria-description', 'alt',
                'value',
                'data-kodety-confirm', 'data-enabling-label', 'data-disabling-label',
                'data-tooltip', 'data-confirm-message', 'data-default-label',
            ],
        ];
    }

    /** @return array<string,string> */
    private function login_direct_catalog(array $catalog): array {
        $available = (array) ($catalog['direct'] ?? []);
        $direct = [];
        foreach (self::LOGIN_DIRECT_SOURCES as $source) {
            $target = $available[$source] ?? null;
            // Empty catalog values are intentionally ignored: registering an
            // empty exact translation would erase accessible login copy.
            if (is_string($target) && $target !== '') $direct[$source] = $target;
        }

        $is_portuguese = str_starts_with(strtolower((string) ($catalog['locale'] ?? 'en')), 'pt');
        foreach (self::LOGIN_WORDPRESS_COPY as $english => $portuguese) {
            $source = $is_portuguese ? $english : $portuguese;
            $target = $is_portuguese ? $portuguese : $english;
            if ($source === '' || $target === '') continue;
            $direct[$source] = $target;
        }
        return $direct;
    }

    private function login_document_locale_supported(): bool {
        $wordpress = strtolower($this->wordpress_locale());
        return str_starts_with($wordpress, 'en') || str_starts_with($wordpress, 'pt');
    }

    public function should_enqueue_admin_runtime(string $hook_suffix): bool {
        $page = $_GET['page'] ?? '';
        if (is_scalar($page) && preg_match('/^kode[tf]y(?:[-_]|$)/i', (string) $page)) return true;
        return in_array($hook_suffix, ['index.php', 'plugins.php'], true);
    }

    public function enqueue_admin_runtime(string $hook_suffix = ''): void {
        if (!$this->should_enqueue_admin_runtime($hook_suffix)) return;
        $path = KODETY_DIR . 'admin/i18n.js';
        if (!is_file($path)) return;
        wp_enqueue_script('kodety-admin-i18n', KODETY_URL . 'admin/i18n.js', [], (string) filemtime($path), true);
        wp_add_inline_script(
            'kodety-admin-i18n',
            'window.kodetyAdminI18n=' . wp_json_encode($this->client_config('admin')) . ';',
            'before'
        );
    }

    public function enqueue_login_runtime(): void {
        if (!in_array(get_option('kodety_interface_enabled', '1'), ['1', 1, true], true)) return;
        $path = KODETY_DIR . 'admin/i18n.js';
        if (!is_file($path)) return;
        wp_enqueue_script('kodety-admin-i18n', KODETY_URL . 'admin/i18n.js', [], (string) filemtime($path), true);
        wp_add_inline_script(
            'kodety-admin-i18n',
            'window.kodetyAdminI18n=' . wp_json_encode($this->client_config('login')) . ';',
            'before'
        );
    }

}
