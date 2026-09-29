<?php

/**
 * Isolated activation contract for Kodety's initial permalink setup.
 *
 * Run with: php Wordpress/tests/permalink-activation-runtime.php
 */

define('ABSPATH', __DIR__);

$kodety_permalink_options = [
    'permalink_structure' => '',
];
$kodety_permalink_set_calls = [];

function get_option(string $name, mixed $default = false): mixed {
    global $kodety_permalink_options;
    return $kodety_permalink_options[$name] ?? $default;
}

function update_option(string $name, mixed $value, mixed $autoload = null): bool {
    global $kodety_permalink_options;
    $kodety_permalink_options[$name] = $value;
    return true;
}

final class Kodety_Permalink_Rewrite_Stub {
    public function set_permalink_structure(string $structure): void {
        global $kodety_permalink_set_calls;
        $kodety_permalink_set_calls[] = $structure;
        update_option('permalink_structure', $structure, false);
    }
}

$wp_rewrite = new Kodety_Permalink_Rewrite_Stub();

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_permalink_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$setup = new ReflectionMethod(Kodety_Plugin::class, 'install_default_permalink_structure');
$setup->invoke(null);

kodety_permalink_assert(
    get_option('permalink_structure') === '/%postname%/',
    'primeira ativação deve selecionar Nome do post'
);
kodety_permalink_assert(
    get_option('kodety_permalink_initialized') === '1',
    'configuração inicial deve ser marcada como concluída'
);
kodety_permalink_assert(
    $kodety_permalink_set_calls === ['/%postname%/'],
    'estrutura deve ser aplicada ao runtime de rewrite'
);

update_option('permalink_structure', '/arquivos/%post_id%/', false);
$setup->invoke(null);

kodety_permalink_assert(
    get_option('permalink_structure') === '/arquivos/%post_id%/',
    'reativação deve preservar uma escolha posterior do usuário'
);
kodety_permalink_assert(
    count($kodety_permalink_set_calls) === 1,
    'reativação não deve reaplicar a estrutura inicial'
);

$plugin_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
kodety_permalink_assert(
    preg_match(
        '/public static function activate\(\): void \{[\s\S]*?self::install_default_permalink_structure\(\);[\s\S]*?flush_rewrite_rules\(\);/',
        $plugin_source
    ) === 1,
    'ativação deve configurar a estrutura antes de regenerar as regras'
);

echo "Permalinks iniciais do Kodety aprovados.\n";
