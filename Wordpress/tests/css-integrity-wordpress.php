<?php

// Integration test: run with
// wp eval-file Wordpress/tests/css-integrity-wordpress.php --path=/path/to/wordpress

if (!defined('ABSPATH') || !class_exists('Kodety_Plugin')) {
    throw new RuntimeException('Execute este teste dentro do WP-CLI com o plugin Kodety ativo.');
}

$css_digest = static function (string $zip_path): string {
    $zip = new ZipArchive();
    if ($zip->open($zip_path) !== true) throw new RuntimeException('ZIP inválido no teste.');
    $digests = [];
    try {
        for ($index = 0; $index < $zip->numFiles; $index++) {
            $name = str_replace('\\', '/', (string) $zip->getNameIndex($index));
            if (!preg_match('/\.(?:css|html?)$/i', $name)) continue;
            $contents = $zip->getFromIndex($index);
            if (!is_string($contents)) throw new RuntimeException('Falha ao ler CSS/HTML do ZIP.');
            $digests[] = hash('sha256', $contents);
        }
    } finally {
        $zip->close();
    }
    sort($digests, SORT_STRING);
    return hash('sha256', implode("\0", $digests));
};

$plugin = Kodety_Plugin::instance();
$snapshot = $plugin->download_project(new WP_REST_Request('GET', '/kodety/v1/project'));
if (is_wp_error($snapshot)) throw new RuntimeException($snapshot->get_error_message());
$snapshot_data = $snapshot->get_data();
$body = base64_decode((string) ($snapshot_data['data'] ?? ''), true);
if (!is_string($body) || $body === '') throw new RuntimeException('Falha ao obter o snapshot nativo do workspace.');
$snapshot_zip = wp_tempnam('kodety-css-integrity.zip');
if (!$snapshot_zip || file_put_contents($snapshot_zip, $body, LOCK_EX) === false) throw new RuntimeException('Falha ao preparar o snapshot do teste.');
$digest = $css_digest($snapshot_zip);
@unlink($snapshot_zip);
$initial_revision = (int) ($snapshot_data['workspaceRevision'] ?? -1);
if ($initial_revision < 0) throw new RuntimeException('O snapshot não informou a revisão do workspace.');

$draft = new WP_REST_Request('POST', '/kodety/v1/project');
$draft->set_body($body);
$draft->set_header('x-kodety-expected-revision', (string) $initial_revision);
$draft->set_header('x-kodety-css-digest', $digest);
$draft_result = $plugin->save_project_draft($draft);
if (is_wp_error($draft_result)) throw new RuntimeException($draft_result->get_error_message());
$draft_data = $draft_result->get_data();
if (($draft_data['cssDigest'] ?? '') !== $digest) throw new RuntimeException('O draft não confirmou o digest esperado.');
$draft_revision = (int) ($draft_data['workspaceRevision'] ?? -1);
if ($draft_revision !== $initial_revision + 1) throw new RuntimeException('A revisão do draft não avançou exatamente uma posição.');

$stale = new WP_REST_Request('POST', '/kodety/v1/project');
$stale->set_body($body);
$stale->set_header('x-kodety-expected-revision', (string) $initial_revision);
$stale->set_header('x-kodety-css-digest', $digest);
$stale_result = $plugin->save_project_draft($stale);
if (!is_wp_error($stale_result) || (int) ($stale_result->get_error_data()['status'] ?? 0) !== 409) {
    throw new RuntimeException('Um autosave obsoleto não foi bloqueado com HTTP 409.');
}

$publish = new WP_REST_Request('POST', '/kodety/v1/publish');
$publish->set_body($body);
$publish->set_header('x-kodety-expected-revision', (string) $draft_revision);
$publish->set_header('x-kodety-css-digest', $digest);
$publish->set_header('x-kodety-publish-request-id', 'publish-css-integrity-retry');
$publish->set_param('optimizations', get_option('kodety_optimization_settings', []));
$publish_result = $plugin->publish_project($publish);
if (is_wp_error($publish_result)) throw new RuntimeException($publish_result->get_error_message());
$publish_data = $publish_result->get_data();
if (($publish_data['cssDigest'] ?? '') !== $digest) throw new RuntimeException('O publish não confirmou o digest esperado.');
if ((int) ($publish_data['workspaceRevision'] ?? -1) !== $draft_revision + 1) {
    throw new RuntimeException('A revisão de publicação não avançou exatamente uma posição.');
}
$replayed_publish_result = $plugin->publish_project($publish);
if (is_wp_error($replayed_publish_result)) throw new RuntimeException($replayed_publish_result->get_error_message());
$replayed_publish_data = $replayed_publish_result->get_data();
if (
    empty($replayed_publish_data['replayed'])
    || ($replayed_publish_data['release'] ?? '') !== ($publish_data['release'] ?? '')
    || (int) ($replayed_publish_data['workspaceRevision'] ?? -1) !== $draft_revision + 1
) {
    throw new RuntimeException('Retry idempotente não confirmou exatamente a release publicada anteriormente.');
}
$published_snapshot = $plugin->download_project(new WP_REST_Request('GET', '/kodety/v1/project'));
if (is_wp_error($published_snapshot)) throw new RuntimeException($published_snapshot->get_error_message());
$published_snapshot_data = $published_snapshot->get_data();
if (($published_snapshot_data['cssDigest'] ?? '') !== $digest) {
    throw new RuntimeException('O workspace nativo divergiu do CSS/HTML validado após a publicação.');
}

echo 'CSS integrity: draft, conflito obsoleto e publish verificados. Release ' . ($publish_data['release'] ?? '') . PHP_EOL;
