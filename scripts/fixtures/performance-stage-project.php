<?php
if (!defined('WP_CLI') || !WP_CLI) { http_response_code(404); exit; }
if (!str_starts_with(basename(rtrim((string) ABSPATH, '/')), 'kodety-stability-wp-') || !str_starts_with((string) DB_NAME, 'kodety_stability_') || wp_parse_url(home_url(), PHP_URL_HOST) !== '127.0.0.1') throw new RuntimeException('Disposable installation required.');
$archive = realpath($args[0] ?? '');
if (!$archive || !is_file($archive) || !preg_match('/^kodety-performance-(medium|large|deckdocs|timeline)\.zip$/D', basename($archive))) throw new RuntimeException('Generated performance fixture ZIP required.');
$method = new ReflectionMethod(Kodety_Plugin::class, 'stage_builder_import');
$method->invoke(Kodety_Plugin::instance(), $archive, basename($archive), true);
WP_CLI::success('Staged isolated performance fixture.');
