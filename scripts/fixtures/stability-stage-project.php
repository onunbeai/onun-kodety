<?php
/** Seed only a separately prepared, disposable WordPress installation. */
if (!defined('WP_CLI') || !WP_CLI) {
    http_response_code(404);
    exit;
}
if (
    !str_starts_with(basename(rtrim((string) ABSPATH, '/')), 'kodety-stability-wp-')
    || !str_starts_with((string) DB_NAME, 'kodety_stability_')
    || wp_parse_url(home_url(), PHP_URL_HOST) !== '127.0.0.1'
) {
    throw new RuntimeException('The stability fixture requires a disposable directory/database and loopback URL.');
}
if (!class_exists('Kodety_Plugin')) {
    throw new RuntimeException('Install and activate the exact candidate before staging the fixture.');
}
$fixture = __DIR__ . '/stability-project/';
$archive_path = tempnam(sys_get_temp_dir(), 'kodety-stability-fixture-');
if ($archive_path === false) throw new RuntimeException('Could not create the temporary fixture ZIP.');
try {
    chmod($archive_path, 0600);
    $zip = new ZipArchive();
    if ($zip->open($archive_path, ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Could not open the fixture ZIP.');
    foreach (['index.html', 'about.html', 'styles.css', 'script.js', 'project.json'] as $file) {
        $target = $file === 'project.json' ? '.incode/project.json' : $file;
        if (!$zip->addFile($fixture . $file, $target)) throw new RuntimeException('Could not add a fixture file.');
    }
    if (!$zip->close()) throw new RuntimeException('Could not finish the fixture ZIP.');
    $method = new ReflectionMethod(Kodety_Plugin::class, 'stage_builder_import');
    $method->invoke(Kodety_Plugin::instance(), $archive_path, 'stability-fixture-small.zip');
    WP_CLI::success('Staged isolated project kst-stability-small from tracked fixtures.');
} finally {
    if (is_file($archive_path)) unlink($archive_path);
}
