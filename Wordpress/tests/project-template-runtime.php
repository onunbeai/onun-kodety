<?php

/** Portable project-template export/import contracts. */

define('ABSPATH', __DIR__);
define('KODETY_VERSION', '1.34.2');

$kodety_template_options = [
    'kodety_collections' => [[
        'slug' => 'kodety_old',
        'name' => 'Antiga',
        'singular' => 'Antiga',
        'urlSlug' => 'antiga',
        'fields' => [],
    ]],
    'kodety_field_definitions' => [],
    'kodety_cms_templates' => [],
];
$kodety_template_membership = [
    'registration_enabled' => false,
    'default_role' => 'subscriber',
];
$kodety_template_registered = [];
$kodety_template_flushed = 0;

function get_option(string $name, mixed $default = false): mixed {
    global $kodety_template_options;
    return array_key_exists($name, $kodety_template_options)
        ? $kodety_template_options[$name]
        : $default;
}
function update_option(string $name, mixed $value, mixed $autoload = null): bool {
    global $kodety_template_options;
    $changed = !array_key_exists($name, $kodety_template_options)
        || $kodety_template_options[$name] !== $value;
    $kodety_template_options[$name] = $value;
    return $changed;
}
function sanitize_key(string $value): string {
    return strtolower(preg_replace('/[^a-z0-9_-]/', '', $value) ?: '');
}
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_textarea_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_title(string $value): string {
    return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($value)) ?: '', '-');
}
function rest_sanitize_boolean(mixed $value): bool { return filter_var($value, FILTER_VALIDATE_BOOLEAN); }
function esc_url_raw(string $value): string {
    return filter_var($value, FILTER_VALIDATE_URL) ? $value : '';
}
function wp_kses_post(string $value): string { return strip_tags($value, '<p><strong><em><a>'); }
function sanitize_hex_color(string $value): string { return preg_match('/^#[a-f0-9]{6}$/i', $value) ? $value : ''; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function current_time(string $type, bool $gmt = false): string { return '2026-07-28T12:00:00+00:00'; }
function is_admin(): bool { return false; }
function post_type_exists(string $slug): bool { return false; }
function register_post_type(string $slug, array $arguments): void {
    global $kodety_template_registered;
    $kodety_template_registered[] = $slug;
}
function flush_rewrite_rules(bool $hard = true): void {
    global $kodety_template_flushed;
    $kodety_template_flushed++;
}
function do_action(string $name, mixed ...$arguments): void {}

final class Kodety_Members {
    public static function settings(): array {
        global $kodety_template_membership;
        return $kodety_template_membership;
    }
    public static function template_settings(): array {
        return self::settings();
    }
    public static function restore_template_settings(array $settings): bool {
        global $kodety_template_membership;
        $allowed = ['registration_enabled', 'default_role', 'login_page_url'];
        $kodety_template_membership = array_merge(
            $kodety_template_membership,
            array_intersect_key($settings, array_fill_keys($allowed, true))
        );
        return true;
    }
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_template_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
$kodety_template_options['kodety_workspace_mode'] = 'agency';
$kodety_template_options['kodety_agency_active_project'] = 'project-a';
$kodety_template_options['kodety_collections__project_project-a'] = [[
    'slug' => 'kodety_cases',
    'name' => 'Cases A',
]];
$kodety_template_options['kodety_collections__project_project-b'] = [[
    'slug' => 'kodety_news',
    'name' => 'News B',
]];
kodety_template_assert(
    ($plugin->project_cms_option('kodety_collections', [])[0]['slug'] ?? '') === 'kodety_old',
    'CMS deve ignorar opções antigas de agência e usar somente o projeto único'
);
$kodety_template_options['kodety_workspace_mode'] = 'single';
$kodety_template_options['kodety_agency_active_project'] = '';

$manifest_method = new ReflectionMethod(Kodety_Plugin::class, 'project_template_manifest_json');
$manifest = json_decode((string) $manifest_method->invoke($plugin), true);
kodety_template_assert(
    ($manifest['kind'] ?? '') === 'kodety-project-template'
        && ($manifest['schemaVersion'] ?? 0) === 1,
    'export deve produzir manifesto versionado'
);
kodety_template_assert(
    isset($manifest['cms']['collections'], $manifest['cms']['fieldDefinitions'], $manifest['cms']['templates']),
    'manifesto deve carregar schema e mappings do CMS'
);
kodety_template_assert(
    in_array('members', $manifest['excludes'] ?? [], true)
        && in_array('credentials', $manifest['excludes'] ?? [], true),
    'manifesto deve declarar a exclusão de dados pessoais e segredos'
);

$root = sys_get_temp_dir() . '/kodety-project-template-' . bin2hex(random_bytes(5));
mkdir($root . '/.incode', 0777, true);
file_put_contents($root . '/index.html', '<!doctype html><title>Template</title>');
$import = [
    'schemaVersion' => 1,
    'kind' => 'kodety-project-template',
    'cms' => [
        'collections' => [[
            'slug' => 'kodety_cases',
            'name' => 'Cases',
            'singular' => 'Case',
            'urlSlug' => 'cases',
        ]],
        'fieldDefinitions' => [
            'kodety_cases' => [[
                'name' => 'client',
                'label' => 'Cliente',
                'type' => 'text',
            ]],
        ],
        'templates' => [
            'kodety_cases' => 'index.html',
            'post' => '../outside.html',
        ],
    ],
    'membership' => [
        'settings' => [
            'registration_enabled' => true,
            'default_role' => 'subscriber',
            'enabled_projects' => ['foreign-project'],
            'api_key' => 'must-not-be-restored',
        ],
    ],
];
file_put_contents(
    $root . '/.incode/template.json',
    json_encode($import, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
);
$restore_method = new ReflectionMethod(Kodety_Plugin::class, 'restore_project_template_state');
kodety_template_assert($restore_method->invoke($plugin, $root) === true, 'import deve restaurar manifesto válido');
kodety_template_assert(
    ($kodety_template_options['kodety_collections'][0]['slug'] ?? '') === 'kodety_cases'
        && ($kodety_template_options['kodety_field_definitions']['kodety_cases'][0]['name'] ?? '') === 'client',
    'import deve restaurar collection e campos do CMS'
);
kodety_template_assert(
    $kodety_template_options['kodety_cms_templates'] === ['kodety_cases' => 'index.html'],
    'import deve aceitar somente mappings existentes dentro do projeto'
);
kodety_template_assert(
    ($kodety_template_membership['registration_enabled'] ?? false) === true
        && !isset($kodety_template_membership['enabled_projects'], $kodety_template_membership['api_key']),
    'Membership deve restaurar configuração portátil sem ativação nem segredos'
);
kodety_template_assert(
    $kodety_template_registered === ['kodety_cases'] && $kodety_template_flushed === 1,
    'schema restaurado deve registrar collection e regenerar rotas'
);

// The imported workspace identity, not the project currently mounted in
// WordPress, owns its portable CMS schema.
$project_a_state = [[
    'slug' => 'kodety_a',
    'name' => 'Project A',
]];
$kodety_template_options['kodety_workspace_project_id'] = 'project-a';
$kodety_template_options['kodety_collections__project_project-a'] = $project_a_state;
$unsuffixed_state = $kodety_template_options['kodety_collections'];
kodety_template_assert(
    $restore_method->invoke($plugin, $root, 'project-b') === true
        && $kodety_template_options['kodety_collections__project_project-a'] === $project_a_state
        && ($kodety_template_options['kodety_collections__project_project-b'][0]['slug'] ?? '') === 'kodety_cases'
        && $kodety_template_options['kodety_collections'] === $unsuffixed_state,
    'import A→B deve restaurar CMS somente no namespace explícito de B'
);
kodety_template_assert(
    $kodety_template_registered === ['kodety_cases'] && $kodety_template_flushed === 1,
    'restore de projeto ainda não montado deve aguardar o próximo init para registrar rewrites'
);

$kodety_template_options['kodety_workspace_project_id'] = '';
unset(
    $kodety_template_options['kodety_collections__project_project-b'],
    $kodety_template_options['kodety_field_definitions__project_project-b'],
    $kodety_template_options['kodety_cms_templates__project_project-b']
);
kodety_template_assert(
    $restore_method->invoke($plugin, $root, 'project-b') === true
        && ($kodety_template_options['kodety_collections__project_project-b'][0]['slug'] ?? '') === 'kodety_cases'
        && ($kodety_template_options['kodety_field_definitions__project_project-b']['kodety_cases'][0]['name'] ?? '') === 'client'
        && $kodety_template_options['kodety_collections'] === $unsuffixed_state,
    'instalação fresh→B deve materializar o schema no namespace de B, nunca no legado sem sufixo'
);

unlink($root . '/.incode/template.json');
rmdir($root . '/.incode');
unlink($root . '/index.html');
rmdir($root);

$plugin_source = (string) file_get_contents(
    dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php'
);
kodety_template_assert(
    str_contains($plugin_source, 'private function write_project_zip_cache_from_file(')
        && substr_count($plugin_source, '$this->write_project_zip_cache_from_file(') >= 2
        && str_contains($plugin_source, '$zip->addFromString(self::PROJECT_TEMPLATE_MANIFEST, $template_manifest)')
        && str_contains($plugin_source, '$restore_project_id = $this->project_id_from_directory($workspace);')
        && str_contains($plugin_source, '$this->restore_project_template_state($workspace, $restore_project_id);'),
    'importação e autosave devem preparar o cache da próxima abertura sem recomprimir o workspace e com manifesto atual'
);
kodety_template_assert(
    str_contains($plugin_source, "glob(\$dir . '/project-*-r*.zip')"),
    'limpeza do cache deve reconhecer os nomes revisionados e escopados atuais'
);

echo "Project template: export portátil e restauração segura aprovados.\n";
