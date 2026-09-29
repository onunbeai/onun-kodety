<?php

declare(strict_types=1);

$root = dirname(__DIR__, 2);
$coreBootstrap = (string) file_get_contents($root . '/Wordpress/kodety/kodety.php');
$corePlugin = (string) file_get_contents($root . '/Wordpress/kodety/includes/class-kodety-plugin.php');
$navigator = (string) file_get_contents($root . '/app/(builder)/kodety/html-editor/components/HtmlNavigator.tsx');
$editor = (string) file_get_contents($root . '/app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx');
$addon = (string) file_get_contents($root . '/Wordpress/extensions/kodety-proposals/includes/class-kodety-proposals-addon.php');
$manifest = json_decode((string) file_get_contents($root . '/Wordpress/extensions/kodety-proposals/kodety-extension.json'), true);

$assert = static function (bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
};

$assert(!str_contains($coreBootstrap, 'Kodety_Proposals'), 'the Kodety bootstrap must not load proposal implementation');
$assert(!str_contains($corePlugin, 'kodety_proposal'), 'the core plugin class must not own proposal routes or records');
$assert(($manifest['slug'] ?? '') === 'kodety-proposals', 'the addon manifest slug must be stable');
$assert(($manifest['dependencies'] ?? null) === [], 'the proposal addon must not depend on the CMS extension');
$assert(str_contains($addon, "self::TEMPLATE_OPTION"), 'the addon must persist its own template mapping');
$assert(str_contains($addon, "add_filter('kodety_editor_shell_config'"), 'the addon must expose its Builder provider only while active');
$assert(str_contains($addon, "add_filter('kodety_runtime_context'"), 'the addon must resolve its public template through the runtime contract');
$assert(!str_contains($addon, 'kodety_cms_templates'), 'the addon must never write CMS template mappings');
$assert(!str_contains($addon, 'cmsTemplatesUrl'), 'the addon must never use the CMS template endpoint');
$assert(!str_contains($addon, 'kodety/v1/cms'), 'the addon must never call the CMS API');
$assert(str_contains($navigator, '<LayoutTemplate /> Página de template'), 'the existing CMS template menu must remain present');
$assert(str_contains($navigator, '<LayoutTemplate /> Template'), 'Pages must expose the separate extension template menu');
$assert(str_contains($editor, 'setExtensionTemplate'), 'extension template persistence must use a separate Builder action');
$assert(str_contains($editor, 'provider.templatesUrl'), 'extension templates must post to the provider-owned endpoint');
$assert(str_contains($editor, '<HtmlTemplateBindings'), 'the active extension template must expose its own variable connector');

echo "OK: Proposals is an optional addon with a separate Builder template contract.\n";
