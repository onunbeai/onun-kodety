<?php

/**
 * Authorization matrix against an installed, bootstrapped WordPress site.
 *
 * Run only against a disposable local/development/staging installation:
 *
 *   KODETY_AUTH_MATRIX_ALLOW_TEMP_USERS=1 \
 *   WP_ENVIRONMENT_TYPE=local \
 *   wp --path=/path/to/wordpress eval-file \
 *     /path/to/repository/Wordpress/tests/installed-authorization-matrix.php
 *
 * Safety and scope:
 *
 * - The file refuses plain `php`, WordPress stubs, multisite, production and an
 *   inactive Kodety plugin.
 * - Every role and user has a random, run-scoped name and is removed in a
 *   `finally` block. Passwords, REST nonces and cookies are never printed.
 * - `WP_REST_Server::dispatch()` does not call the authentication filter used
 *   by `serve_request()`. The matrix therefore establishes the current user in
 *   process and exercises route matching, argument validation and each route's
 *   `permission_callback`. Cookie/nonce authentication is covered separately
 *   by direct calls to the real `rest_cookie_check_errors()` implementation.
 * - A run-scoped probe first proves that an authorized builder write receives
 *   the real 423 without an editor lease. During the capability matrix a
 *   `rest_dispatch_request` filter clears only that marker-scoped lock error,
 *   after WordPress has invoked the route's permission callback. A later
 *   filter then returns a synthetic 204. The harness
 *   requires a sentinel response header before accepting that 2xx, so no
 *   selected read or mutation callback can touch project, CMS, Analytics, MCP,
 *   release or storage data.
 *
 * Consequently this is an installed authorization test, not an HTTP transport
 * test: it does not prove browser cookie parsing, TLS/proxy behavior, or any
 * route callback's business logic/persistence. Those require a separate HTTP
 * E2E run against the same disposable installation.
 */

if (
    PHP_SAPI !== 'cli'
    || !defined('WP_CLI')
    || WP_CLI !== true
    || !defined('ABSPATH')
    || !defined('WPINC')
    || !is_file(ABSPATH . WPINC . '/version.php')
) {
    fwrite(STDERR, "FAIL: execute este arquivo somente com wp eval-file em um WordPress real.\n");
    exit(1);
}

/** @param mixed $value */
function kodety_installed_matrix_assert($value, string $message): void {
    if ($value) return;
    throw new RuntimeException($message);
}

/** @return array<string,bool> */
function kodety_installed_matrix_role_caps(string $role_name): array {
    $role = get_role($role_name);
    kodety_installed_matrix_assert(
        $role instanceof WP_Role,
        sprintf('O papel-base %s não existe; ative/migre o plugin antes do teste.', $role_name)
    );

    return array_filter(
        array_map(static fn($granted): bool => $granted === true, $role->capabilities),
        static fn(bool $granted): bool => $granted
    );
}

function kodety_installed_matrix_set_request_params(
    WP_REST_Request $request,
    array $params
): void {
    if (!$params) return;

    if ($request->get_method() === 'GET') {
        $request->set_query_params($params);
        return;
    }

    $request->set_body_params($params);
}

function kodety_installed_matrix_test_request_param_transport(): string {
    $get_params = ['surface' => 'analytics'];
    $get_request = new WP_REST_Request('GET', '/kodety/v1/project/surface');
    kodety_installed_matrix_set_request_params($get_request, $get_params);
    kodety_installed_matrix_assert(
        $get_request->get_query_params() === $get_params
        && $get_request->get_body_params() === []
        && $get_request->get_param('surface') === 'analytics',
        'Parâmetros GET da matriz devem usar query para chegar ao permission callback.'
    );

    foreach (['POST', 'PUT', 'PATCH', 'DELETE'] as $method) {
        $body_params = ['probe' => strtolower($method)];
        $request = new WP_REST_Request($method, '/kodety/v1/parameter-probe');
        kodety_installed_matrix_set_request_params($request, $body_params);
        kodety_installed_matrix_assert(
            $request->get_query_params() === []
            && $request->get_body_params() === $body_params
            && $request->get_param('probe') === strtolower($method),
            sprintf('Parâmetros %s da matriz devem permanecer no body.', $method)
        );
    }

    return 'request params — GET=query; POST/PUT/PATCH/DELETE=body';
}

/** @return array{status:int,code:string,intercepted:bool} */
function kodety_installed_matrix_dispatch(
    WP_REST_Server $server,
    string $method,
    string $route,
    array $params,
    string $marker,
    int $user_id
): array {
    wp_set_current_user($user_id);

    $request = new WP_REST_Request($method, $route);
    $request->set_header('X-Kodety-Authorization-Matrix', $marker);
    if ($user_id > 0) {
        // Required explicitly by private Analytics routes. Never logged.
        $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
    }
    kodety_installed_matrix_set_request_params($request, $params);

    $response = $server->dispatch($request);
    $data = $response->get_data();
    $headers = $response->get_headers();
    $code = is_array($data) && is_string($data['code'] ?? null)
        ? sanitize_key($data['code'])
        : '';

    return [
        'status' => $response->get_status(),
        'code' => $code,
        'intercepted' => ($headers['X-Kodety-Authorization-Matrix'] ?? '') === 'permission-checked',
    ];
}

/** @return list<string> */
function kodety_installed_matrix_test_cookie_nonces(int $user_id): array {
    $results = [];
    $had_request_nonce = array_key_exists('_wpnonce', $_REQUEST);
    $previous_request_nonce = $had_request_nonce ? $_REQUEST['_wpnonce'] : null;
    $had_header_nonce = array_key_exists('HTTP_X_WP_NONCE', $_SERVER);
    $previous_header_nonce = $had_header_nonce ? $_SERVER['HTTP_X_WP_NONCE'] : null;
    $had_auth_cookie_state = array_key_exists('wp_rest_auth_cookie', $GLOBALS);
    $previous_auth_cookie_state = $had_auth_cookie_state ? $GLOBALS['wp_rest_auth_cookie'] : null;
    $had_nocache_filter = has_filter('rest_send_nocache_headers', '__return_true');

    try {
        unset($_REQUEST['_wpnonce'], $_SERVER['HTTP_X_WP_NONCE']);
        wp_set_current_user(0);
        $GLOBALS['wp_rest_auth_cookie'] = null;
        $result = rest_cookie_check_errors(null);
        kodety_installed_matrix_assert(
            $result === true && get_current_user_id() === 0,
            'Cookie ausente deve permanecer anônimo sem produzir identidade.'
        );
        $results[] = 'cookie ausente: anônimo';

        unset($_REQUEST['_wpnonce'], $_SERVER['HTTP_X_WP_NONCE']);
        wp_set_current_user($user_id);
        $GLOBALS['wp_rest_auth_cookie'] = true;
        $result = rest_cookie_check_errors(null);
        kodety_installed_matrix_assert(
            $result === true && get_current_user_id() === 0,
            'Nonce ausente em autenticação por cookie deve remover a identidade.'
        );
        $results[] = 'nonce ausente: identidade removida';

        unset($_REQUEST['_wpnonce']);
        wp_set_current_user($user_id);
        $GLOBALS['wp_rest_auth_cookie'] = true;
        $_SERVER['HTTP_X_WP_NONCE'] = 'invalid-' . wp_generate_password(24, false, false);
        $result = rest_cookie_check_errors(null);
        $error_data = is_wp_error($result)
            ? $result->get_error_data('rest_cookie_invalid_nonce')
            : null;
        kodety_installed_matrix_assert(
            is_wp_error($result)
            && $result->get_error_code() === 'rest_cookie_invalid_nonce'
            && is_array($error_data)
            && (int) ($error_data['status'] ?? 0) === 403,
            'Nonce inválido deve retornar rest_cookie_invalid_nonce com HTTP 403.'
        );
        $results[] = 'nonce inválido: 403';

        unset($_REQUEST['_wpnonce']);
        wp_set_current_user($user_id);
        $GLOBALS['wp_rest_auth_cookie'] = true;
        $valid_nonce = wp_create_nonce('wp_rest');
        $_SERVER['HTTP_X_WP_NONCE'] = $valid_nonce;
        $result = rest_cookie_check_errors(null);
        kodety_installed_matrix_assert(
            $result === true && get_current_user_id() === $user_id,
            'Nonce válido deve preservar a identidade autenticada.'
        );
        $results[] = 'nonce válido: identidade preservada';

        // Core places a refreshed nonce on the in-process REST server. Remove it
        // before any output and erase both local references immediately.
        rest_get_server()->remove_header('X-WP-Nonce');
        $_SERVER['HTTP_X_WP_NONCE'] = '';
        $valid_nonce = '';
    } finally {
        if ($had_request_nonce) $_REQUEST['_wpnonce'] = $previous_request_nonce;
        else unset($_REQUEST['_wpnonce']);

        if ($had_header_nonce) $_SERVER['HTTP_X_WP_NONCE'] = $previous_header_nonce;
        else unset($_SERVER['HTTP_X_WP_NONCE']);

        if ($had_auth_cookie_state) $GLOBALS['wp_rest_auth_cookie'] = $previous_auth_cookie_state;
        else unset($GLOBALS['wp_rest_auth_cookie']);

        if ($had_nocache_filter === false) {
            remove_filter('rest_send_nocache_headers', '__return_true', 20);
        }
    }

    return $results;
}

$created_user_ids = [];
$created_role_names = [];
$matrix_lines = [];
$nonce_lines = [];
$failures = [];
$unexpected_failure = null;
$interceptor = null;
$lock_bypass = null;
$original_user_id = get_current_user_id();

try {
    kodety_installed_matrix_assert(
        getenv('KODETY_AUTH_MATRIX_ALLOW_TEMP_USERS') === '1',
        'Defina KODETY_AUTH_MATRIX_ALLOW_TEMP_USERS=1 para autorizar usuários temporários.'
    );
    kodety_installed_matrix_assert(
        function_exists('wp_get_environment_type')
        && in_array(wp_get_environment_type(), ['local', 'development', 'staging'], true),
        'Execução recusada: WP_ENVIRONMENT_TYPE deve ser local, development ou staging.'
    );
    kodety_installed_matrix_assert(!is_multisite(), 'Execução recusada em Multisite.');
    kodety_installed_matrix_assert(
        defined('KODETY_FILE')
        && is_file(KODETY_FILE)
        && class_exists('Kodety_Plugin')
        && class_exists('Kodety_Analytics')
        && class_exists('Kodety_MCP'),
        'O plugin Kodety instalado não está carregado por completo.'
    );

    global $wpdb;
    kodety_installed_matrix_assert(
        $wpdb instanceof wpdb && (string) $wpdb->get_var('SELECT 1') === '1',
        'A conexão com o banco WordPress real não está disponível.'
    );

    if (!function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    kodety_installed_matrix_assert(
        is_plugin_active(plugin_basename(KODETY_FILE)),
        'O Kodety deve estar ativo nesta instalação WordPress.'
    );
    $matrix_lines[] = kodety_installed_matrix_test_request_param_transport();

    $source_plugin_root = realpath(dirname(__DIR__) . '/kodety');
    $installed_plugin_root = realpath(dirname(KODETY_FILE));
    kodety_installed_matrix_assert(
        is_string($source_plugin_root) && is_string($installed_plugin_root),
        'Não foi possível comparar os fontes PHP com o plugin instalado.'
    );
    $php_contract_files = [
        'kodety.php',
        'includes/class-kodety-plugin.php',
        'includes/class-kodety-analytics.php',
        'includes/class-kodety-mcp.php',
        'includes/class-kodety-sharing.php',
    ];
    $stale_php_files = [];
    foreach ($php_contract_files as $relative_file) {
        $source_file = $source_plugin_root . '/' . $relative_file;
        $installed_file = $installed_plugin_root . '/' . $relative_file;
        if (
            !is_file($source_file)
            || !is_file($installed_file)
            || !hash_equals(
                (string) hash_file('sha256', $source_file),
                (string) hash_file('sha256', $installed_file)
            )
        ) {
            $stale_php_files[] = $relative_file;
        }
    }
    kodety_installed_matrix_assert(
        $stale_php_files === [],
        'Instalação divergente dos fontes atuais; reinstale o ZIP antes da matriz: '
            . implode(', ', $stale_php_files)
    );

    $run_id = strtolower(str_replace('-', '', wp_generate_uuid4()));
    $role_specs = [
        'administrator' => kodety_installed_matrix_role_caps('administrator'),
        'designer' => kodety_installed_matrix_role_caps(Kodety_Plugin::ROLE_DESIGNER),
        'editor' => kodety_installed_matrix_role_caps('editor'),
        'cms_only' => [
            'read' => true,
            Kodety_Plugin::CAP_ACCESS_CMS => true,
        ],
        'analytics_only' => [
            'read' => true,
            Kodety_Plugin::CAP_VIEW_ANALYTICS => true,
        ],
    ];
    $users = ['anonymous' => 0];

    foreach ($role_specs as $label => $capabilities) {
        $role_name = sprintf('kdm_%s_%s', substr($run_id, 0, 16), $label);
        kodety_installed_matrix_assert(get_role($role_name) === null, 'Colisão de papel temporário.');
        $role = add_role(
            $role_name,
            sprintf('Kodety Matrix %s %s', $label, substr($run_id, 0, 8)),
            $capabilities
        );
        kodety_installed_matrix_assert($role instanceof WP_Role, 'Não foi possível criar papel temporário.');
        $created_role_names[] = $role_name;

        $login = sprintf('kdm_%s_%s', substr($run_id, 0, 12), $label);
        $password = wp_generate_password(64, true, true);
        $user_id = wp_insert_user([
            'user_login' => $login,
            'user_pass' => $password,
            'user_email' => $login . '@example.invalid',
            'display_name' => sprintf('Kodety Matrix %s %s', $label, substr($run_id, 0, 8)),
            'role' => $role_name,
        ]);
        $password = '';
        kodety_installed_matrix_assert(
            !is_wp_error($user_id) && is_int($user_id) && $user_id > 0,
            is_wp_error($user_id)
                ? 'Falha ao criar usuário temporário: ' . sanitize_key($user_id->get_error_code())
                : 'Falha ao criar usuário temporário.'
        );
        $created_user_ids[] = $user_id;
        $users[$label] = $user_id;

        $created_user = get_userdata($user_id);
        kodety_installed_matrix_assert(
            $created_user instanceof WP_User
            && $created_user->roles === [$role_name],
            'Usuário temporário não recebeu exatamente o papel isolado esperado.'
        );
    }

    $mcp_available = Kodety_Edition::has('mcp');
    $routes = [
        [
            'name' => 'project.read',
            'method' => 'GET',
            'route' => '/kodety/v1/project',
            'allowed' => ['administrator', 'designer', 'editor'],
        ],
        [
            'name' => 'project.delta',
            'method' => 'POST',
            'route' => '/kodety/v1/project/delta',
            'allowed' => ['administrator', 'designer', 'editor'],
        ],
        [
            'name' => 'surface.analytics',
            'method' => 'GET',
            'route' => '/kodety/v1/project/surface',
            'params' => ['surface' => 'analytics'],
            'allowed' => ['administrator', 'designer', 'editor', 'analytics_only'],
        ],
        [
            'name' => 'cms.types',
            'method' => 'GET',
            'route' => '/kodety/v1/cms/types',
            'allowed' => ['administrator', 'designer', 'editor', 'cms_only'],
        ],
        [
            'name' => 'cms.items.create',
            'method' => 'POST',
            'route' => '/kodety/v1/cms/items/post',
            'allowed' => ['administrator', 'designer', 'editor', 'cms_only'],
        ],
        [
            'name' => 'cms.collections.create',
            'method' => 'POST',
            'route' => '/kodety/v1/cms/collections',
            'allowed' => ['administrator', 'designer'],
        ],
        [
            'name' => 'cms.templates.save',
            'method' => 'POST',
            'route' => '/kodety/v1/cms/templates',
            'allowed' => ['administrator', 'designer'],
        ],
        [
            'name' => 'analytics.overview',
            'method' => 'GET',
            'route' => '/kodety/v1/analytics/overview',
            'allowed' => ['administrator', 'designer', 'editor', 'analytics_only'],
        ],
        [
            'name' => 'analytics.funnels.create',
            'method' => 'POST',
            'route' => '/kodety/v1/analytics/funnels',
            'allowed' => ['administrator', 'designer'],
        ],
        [
            'name' => 'publish.status',
            'method' => 'GET',
            'route' => '/kodety/v1/publish',
            'allowed' => ['administrator'],
        ],
        [
            'name' => 'publish.create',
            'method' => 'POST',
            'route' => '/kodety/v1/publish',
            'allowed' => ['administrator'],
        ],
        [
            'name' => 'storage.read',
            'method' => 'GET',
            'route' => '/kodety/v1/storage',
            'allowed' => ['administrator'],
        ],
        [
            'name' => 'storage.delete',
            'method' => 'DELETE',
            'route' => '/kodety/v1/storage',
            'allowed' => ['administrator'],
        ],
        [
            'name' => 'mcp.status',
            'method' => 'GET',
            'route' => '/kodety/v1/mcp/status',
            'allowed' => $mcp_available ? ['administrator', 'designer', 'editor'] : [],
        ],
        [
            'name' => 'mcp.settings.disable',
            'method' => 'POST',
            'route' => '/kodety/v1/mcp/settings',
            'params' => ['operation' => 'disable'],
            'allowed' => $mcp_available ? ['administrator'] : [],
        ],
    ];

    $server = rest_get_server();
    $selected_route_methods = [];
    foreach ($routes as $route) {
        $selected_route_methods[$route['method'] . ' ' . $route['route']] = true;
    }
    $marker = hash('sha256', $run_id . wp_generate_password(32, true, true));
    $interceptor = static function ($dispatch_result, WP_REST_Request $request) use (
        $marker,
        $selected_route_methods
    ) {
        if ($dispatch_result !== null) return $dispatch_result;
        $request_marker = (string) $request->get_header('X-Kodety-Authorization-Matrix');
        $key = $request->get_method() . ' ' . $request->get_route();
        if (
            $request_marker === ''
            || !hash_equals($marker, $request_marker)
            || !isset($selected_route_methods[$key])
        ) {
            return $dispatch_result;
        }

        $response = new WP_REST_Response(null, 204);
        $response->header('X-Kodety-Authorization-Matrix', 'permission-checked');
        return $response;
    };
    add_filter('rest_dispatch_request', $interceptor, PHP_INT_MAX, 4);

    $lock_probe = kodety_installed_matrix_dispatch(
        $server,
        'POST',
        '/kodety/v1/project/delta',
        [],
        $marker,
        $users['administrator']
    );
    kodety_installed_matrix_assert(
        $lock_probe['status'] === 423
        && $lock_probe['code'] === 'kodety_editor_lock_required'
        && !$lock_probe['intercepted'],
        'Uma mutação de Builder autorizada sem lease deve parar no boundary com HTTP 423.'
    );
    $matrix_lines[] = 'POST project.delta sem lease — administrator=423';

    $lock_bypass = static function ($dispatch_result, WP_REST_Request $request) use (
        $marker,
        $selected_route_methods
    ) {
        $request_marker = (string) $request->get_header('X-Kodety-Authorization-Matrix');
        $key = $request->get_method() . ' ' . $request->get_route();
        if (
            $request_marker === ''
            || !hash_equals($marker, $request_marker)
            || !isset($selected_route_methods[$key])
            || !is_wp_error($dispatch_result)
            || $dispatch_result->get_error_code() !== 'kodety_editor_lock_required'
        ) {
            return $dispatch_result;
        }

        // Permission already succeeded before rest_dispatch_request. The real
        // 423 was asserted above; clear only this run-scoped error so the later
        // sentinel can stop the selected route callback without touching data.
        return null;
    };
    add_filter('rest_dispatch_request', $lock_bypass, PHP_INT_MAX - 1, 4);

    foreach ($routes as $route) {
        $statuses = [];
        foreach ($users as $label => $user_id) {
            $expected_allowed = in_array($label, $route['allowed'], true);
            $expected_status = $expected_allowed ? null : ($label === 'anonymous' ? 401 : 403);
            $result = kodety_installed_matrix_dispatch(
                $server,
                $route['method'],
                $route['route'],
                $route['params'] ?? [],
                $marker,
                $user_id
            );
            $statuses[] = sprintf('%s=%d', $label, $result['status']);

            if ($expected_allowed) {
                if (
                    $result['status'] < 200
                    || $result['status'] > 299
                    || !$result['intercepted']
                ) {
                    $failures[] = sprintf(
                        '%s %s para %s: esperado 2xx interceptado, recebido %d%s.',
                        $route['method'],
                        $route['name'],
                        $label,
                        $result['status'],
                        $result['code'] !== '' ? ' (' . $result['code'] . ')' : ''
                    );
                }
                continue;
            }

            if ($result['status'] !== $expected_status || $result['intercepted']) {
                $failures[] = sprintf(
                    '%s %s para %s: esperado %d sem callback, recebido %d%s.',
                    $route['method'],
                    $route['name'],
                    $label,
                    $expected_status,
                    $result['status'],
                    $result['code'] !== '' ? ' (' . $result['code'] . ')' : ''
                );
            }
        }
        $matrix_lines[] = sprintf(
            '%s %s — %s',
            $route['method'],
            $route['name'],
            implode(', ', $statuses)
        );
    }

    $nonce_lines = kodety_installed_matrix_test_cookie_nonces($users['administrator']);
} catch (Throwable $error) {
    $unexpected_failure = get_class($error) . ': ' . $error->getMessage();
} finally {
    if (is_callable($lock_bypass)) {
        remove_filter('rest_dispatch_request', $lock_bypass, PHP_INT_MAX - 1);
    }
    if (is_callable($interceptor)) {
        remove_filter('rest_dispatch_request', $interceptor, PHP_INT_MAX);
    }
    if (function_exists('rest_get_server')) {
        rest_get_server()->remove_header('X-WP-Nonce');
    }

    wp_set_current_user(0);
    if (!function_exists('wp_delete_user')) {
        require_once ABSPATH . 'wp-admin/includes/user.php';
    }
    foreach (array_reverse($created_user_ids) as $user_id) {
        if (!wp_delete_user($user_id)) {
            $failures[] = 'Não foi possível remover um usuário temporário.';
        }
    }
    foreach (array_reverse($created_role_names) as $role_name) {
        remove_role($role_name);
        if (get_role($role_name) !== null) {
            $failures[] = 'Não foi possível remover um papel temporário.';
        }
    }

    if ($original_user_id > 0 && get_userdata($original_user_id) instanceof WP_User) {
        wp_set_current_user($original_user_id);
    } else {
        wp_set_current_user(0);
    }
}

foreach ($matrix_lines as $line) WP_CLI::log($line);
foreach ($nonce_lines as $line) WP_CLI::log('REST cookie — ' . $line);

if ($unexpected_failure !== null) {
    $failures[] = $unexpected_failure;
}
if ($failures) {
    foreach ($failures as $failure) WP_CLI::warning($failure);
    WP_CLI::error(sprintf('Matriz de autorização falhou com %d divergência(s).', count($failures)));
}

WP_CLI::success(sprintf(
    'Matriz instalada passou: %d rotas x %d identidades; nonces ausente/inválido/válido validados; limpeza concluída.',
    count($routes),
    count($users)
));
