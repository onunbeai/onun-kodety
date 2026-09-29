<?php

declare(strict_types=1);

// Reuse the isolated WordPress facade and run its existing contracts first.
require __DIR__ . '/agents-runtime.php';
Kodety_Edition::$licensed = true;
$fresh_agents = static fn(): Kodety_Agents => (new ReflectionClass(Kodety_Agents::class))->newInstanceWithoutConstructor();
$agents = $fresh_agents();
$root = $runtime_root_method->invoke($agents);
$hosting_fixture = $root . '/hosting-fixtures';
mkdir($hosting_fixture, 0700);
$process_method = new ReflectionMethod($agents, 'run_runtime_process');
$node_validator = new ReflectionMethod($agents, 'validate_node_version');
$classifier = new ReflectionMethod($agents, 'runtime_execution_error');

foreach ([
    ['Permission denied /private/token=hidden', 126, false, 'execution_denied'],
    ["/private/libc.so: version 'GLIBC_2.28' not found", 1, false, 'system_incompatible'],
    ["GLIBCXX_3.4.29 not found", 1, false, 'system_incompatible'],
    ['Exec format error', 126, false, 'architecture'],
    ['', 132, false, 'architecture'],
    ['', 137, false, 'resources'],
    ['pthread_create: Resource temporarily unavailable', 1, false, 'resources'],
    ['', 143, true, 'probe_timeout'],
] as [$detail, $status, $timed_out, $reason]) {
    foreach (['node', 'codex'] as $kind) {
        $error = $classifier->invoke($agents, $kind, ['output' => $detail, 'status' => $status, 'timedOut' => $timed_out], 'invalid');
        check($error->get_error_code() === 'kodety_agents_' . $kind . '_' . $reason, 'execution failures must retain their specific cause');
        $safe = $diagnostics_method->invoke($agents, $error);
        check($safe['code'] === $kind . '_' . $reason, 'the UI must recognize the execution failure');
        check(!str_contains(json_encode($safe), '/private') && !str_contains(json_encode($safe), 'hidden'), 'execution details must never escape to the UI');
    }
}
check($diagnostics_method->invoke($agents, new WP_Error('kodety_agents_runtime_noexec', 'private'))['code'] === 'runtime_noexec', 'noexec must have an actionable diagnostic');

$result = $process_method->invoke($agents, [PHP_BINARY, '-r', 'echo str_repeat("x", 65536);'], $root, 3.0, 64);
check($result['status'] === 0 && $result['truncated'] && strlen($result['output']) === 64, 'process output must be capped without deadlocking');
putenv('KODETY_HOSTING_TEST_SENTINEL=must-not-inherit');
$result = $process_method->invoke($agents, [PHP_BINARY, '-r', 'echo getenv("KODETY_HOSTING_TEST_SENTINEL") ?: "isolated";'], $root);
putenv('KODETY_HOSTING_TEST_SENTINEL');
check($result['status'] === 0 && $result['output'] === 'isolated', 'children must not inherit the PHP server environment');
if ((new ReflectionMethod($agents, 'bounded_process_api_available'))->invoke($agents)) {
    $started = microtime(true);
    $result = $process_method->invoke($agents, [PHP_BINARY, '-r', 'if (function_exists("pcntl_async_signals")) { pcntl_async_signals(true); pcntl_signal(SIGTERM, SIG_IGN); } usleep(5000000);'], $root, 0.15);
    check($result['timedOut'] && microtime(true) - $started < 1.5, 'a probe ignoring SIGTERM must be force-stopped within its deadline');
}

$bad_bin = $hosting_fixture . '/bad/bin';
$good_bin = $hosting_fixture . '/good/bin';
mkdir($bad_bin, 0700, true);
mkdir($good_bin, 0700, true);
file_put_contents($bad_bin . '/node', "#!/bin/sh\necho \"GLIBC_2.28 not found\" >&2\nexit 1\n");
file_put_contents($good_bin . '/node', "#!/bin/sh\necho v22.0.0\n");
file_put_contents($good_bin . '/codex', "#!/bin/sh\necho 'codex app-server'\n");
chmod($bad_bin . '/node', 0755);
chmod($good_bin . '/node', 0755);
chmod($good_bin . '/codex', 0755);
$saved_test_path = (string) getenv('PATH');
putenv('PATH=' . $bad_bin . PATH_SEPARATOR . $good_bin . PATH_SEPARATOR . $saved_test_path);
try {
    $resolved = $resolve_executable_method->invoke($fresh_agents(), 'node');
    check($resolved === $good_bin . '/node', 'an incompatible first candidate must not hide a working Node later in PATH');
    file_put_contents($bad_bin . '/node', "#!/bin/sh\necho v16.20.0\n");
    check($resolve_executable_method->invoke($fresh_agents(), 'node') === $good_bin . '/node', 'an obsolete Node must not hide a newer host installation');
} finally {
    putenv('PATH=' . $saved_test_path);
}
file_put_contents($bad_bin . '/node', "#!/bin/sh\necho \"GLIBC_2.28 not found\" >&2\nexit 1\n");
$dirs = (new ReflectionMethod($agents, 'executable_search_directories'))->invoke($agents);
foreach (['/opt/alt/alt-nodejs22/root/usr/bin', '/opt/cpanel/ea-nodejs22/bin', '/opt/plesk/node/22/bin'] as $directory) {
    check(in_array($directory, $dirs, true), 'hosting panel Node paths must be discoverable without a PHP PATH change');
}
chmod($bad_bin . '/node', 0600);
$denied = $node_validator->invoke($fresh_agents(), $bad_bin . '/node', $root);
check($denied instanceof WP_Error && $denied->get_error_code() === 'kodety_agents_node_execution_denied', 'real permission errors must survive the process adapter');
chmod($bad_bin . '/node', 0755);

$mountinfo = "1 0 0:1 / / rw - rootfs rootfs rw\n2 1 0:2 / /tmp rw,noexec - tmpfs tmpfs rw\n3 2 0:3 / /tmp/allowed rw - ext4 disk rw\n4 1 0:4 / /private\\040disk rw,noexec - tmpfs tmpfs rw\n";
$mount_parser = new ReflectionMethod($agents, 'mountinfo_has_noexec');
check($mount_parser->invoke($agents, '/tmp/cache/node', $mountinfo) === true, 'a noexec mount must be recognized');
check($mount_parser->invoke($agents, '/tmp/allowed/node', $mountinfo) === false, 'the most specific mount must take precedence');
check($mount_parser->invoke($agents, '/tmp-other/node', $mountinfo) === false, 'mount path matching must respect component boundaries');
check($mount_parser->invoke($agents, '/private disk/node', $mountinfo) === true, 'escaped mount paths must be decoded');
check($mount_parser->invoke($agents, '/tmp/node', '') === null, 'missing mount data must not be presented as proof of noexec');

$private_parent = $hosting_fixture . '/private-parent';
$public_parent = $hosting_fixture . '/public_html';
$unsafe_parent = $hosting_fixture . '/world-writable';
foreach ([$private_parent, $public_parent, $unsafe_parent] as $directory) mkdir($directory, 0700);
chmod($unsafe_parent, 0777);
$saved_document_root = $_SERVER['DOCUMENT_ROOT'] ?? null;
$_SERVER['DOCUMENT_ROOT'] = $public_parent;
$runtime_filters['kodety_agents_private_runtime_parents'] = static fn(): array => [$public_parent, $unsafe_parent, $private_parent];
$parents = (new ReflectionMethod($agents, 'private_runtime_parents'))->invoke($agents);
check($parents === [$private_parent], 'fallback parents must exclude the public tree and world-writable directories');
if ($saved_document_root === null) unset($_SERVER['DOCUMENT_ROOT']);
else $_SERVER['DOCUMENT_ROOT'] = $saved_document_root;
$runtime_filters['kodety_agents_private_runtime_parents'] = static fn(): array => [$private_parent];

$target = (new ReflectionMethod($agents, 'managed_runtime_target'))->invoke($agents);
$manifest = (new ReflectionMethod($agents, 'managed_runtime_manifest'))->invoke($agents, $target);
$node_top = dirname(dirname($manifest['node']['archivePath']));
$vendor_path = $manifest['codex']['vendorPath'];
$node_source = $hosting_fixture . '/node-source/' . $node_top . '/bin';
$codex_source = $hosting_fixture . '/codex-source/' . $vendor_path . '/bin';
mkdir($node_source, 0700, true);
mkdir($codex_source, 0700, true);
copy($good_bin . '/node', $node_source . '/node');
copy($good_bin . '/codex', $codex_source . '/codex');
chmod($node_source . '/node', 0700);
chmod($codex_source . '/codex', 0700);
$tar = (new ReflectionMethod($agents, 'system_executable'))->invoke($agents, ['/usr/bin/tar', '/bin/tar']);
check(is_string($tar), 'the hosting fixture requires the same trusted tar discovery as production');
$node_archive = $hosting_fixture . '/node.tgz';
$codex_archive = $hosting_fixture . '/codex.tgz';
foreach ([[$node_archive, $hosting_fixture . '/node-source', $node_top], [$codex_archive, $hosting_fixture . '/codex-source', 'package']] as [$archive, $source, $entry]) {
    $result = $process_method->invoke($agents, [$tar, '-czf', $archive, '-C', $source, $entry], $root);
    check($result['status'] === 0, 'hosting smoke archives must be created without depending on exec()');
}
$manifest['node']['url'] = 'https://nodejs.org/kodety-hosting-fixture.tgz';
$manifest['node']['sha256'] = hash_file('sha256', $node_archive);
$manifest['codex']['url'] = 'https://registry.npmjs.org/@openai/codex/-/kodety-hosting-fixture.tgz';
$manifest['codex']['sha512'] = base64_encode(hash_file('sha512', $codex_archive, true));
$runtime_downloads = [$manifest['node']['url'] => $node_archive, $manifest['codex']['url'] => $codex_archive];
$install_method = new ReflectionMethod($agents, 'install_managed_runtime');
$staging_method = new ReflectionMethod($agents, 'runtime_install_directory');
$managed_root_method = new ReflectionMethod($agents, 'managed_runtime_root');
$download_count = static fn(string $kind): int => count(array_filter($GLOBALS['runtime_http_requests'], static fn(array $request): bool => $request['url'] === $GLOBALS['manifest'][$kind]['url']));
$advance = static function (array $available = [], ?string $stop_phase = null) use ($fresh_agents, $install_method, &$manifest): mixed {
    for ($step = 0; $step < 80; $step++) {
        $result = $install_method->invoke($fresh_agents(), $manifest, $available);
        if (!is_array($result) || $result['phase'] === $stop_phase) return $result;
    }
    check(false, 'hosting installer must converge instead of looping between phases');
    return null;
};

$runtime_http_requests = [];
$installed = $advance(['node' => $good_bin . '/node']);
check($installed === true, 'a host Node plus a missing Codex must install successfully');
check($download_count('node') === 0 && $download_count('codex') === 1, 'a working host Node must not be downloaded again');
$final = $managed_root_method->invoke($agents) . '/' . $target;
$marker = json_decode(file_get_contents($final . '/runtime.json'), true);
check($marker['components'] === ['node' => false, 'codex' => true], 'the activation marker must identify reused host components');
check(!is_file($final . '/node/bin/node') && (fileperms($good_bin . '/node') & 0777) === 0755, 'host binaries must not be copied, replaced or chmodded');
remove_test_tree($root . '/managed-runtime');

$runtime_http_requests = [];
check($advance(['codex' => $good_bin . '/codex']) === true, 'a host Codex plus a missing Node must install successfully');
check($download_count('node') === 1 && $download_count('codex') === 0, 'a working host Codex must not be downloaded again');
remove_test_tree($root . '/managed-runtime');

$runtime_http_requests = [];
check(is_array($advance(['node' => $good_bin . '/node'], 'download_codex')), 'a reused Node must have a resumable checkpoint');
check($advance() === true, 'a host runtime that disappears must become a managed component on resumption');
check($download_count('node') === 1 && $download_count('codex') === 1, 'resumption must download only components that now need installation');
remove_test_tree($root . '/managed-runtime');

// A legacy step-six failure is recoverable with a host Node and both already
// verified archives. No old extracted Node may become preferred at activation.
$staging = $staging_method->invoke($agents, $manifest);
mkdir($staging, 0700, true);
foreach (['node' => 'node.tar.gz', 'codex' => 'codex.tgz'] as $kind => $filename) {
    $algorithm = $kind === 'node' ? 'sha256' : 'sha512';
    $downloader = new ReflectionMethod($agents, 'download_runtime_artifact');
    for ($step = 0; $step < 4; $step++) {
        $result = $downloader->invoke($agents, $manifest[$kind]['url'], $staging . '/' . $filename, $algorithm, $manifest[$kind][$algorithm], $manifest[$kind]['maxBytes']);
        if ($result === true) break;
    }
    check($result === true, 'legacy checkpoints require hash-verified archives');
}
file_put_contents($staging . '/installation.json', json_encode(['phase' => 'validate_node']));
$runtime_http_requests = [];
check($advance(['node' => $good_bin . '/node']) === true, 'a legacy node_invalid checkpoint must accept a validated host runtime');
check(count($runtime_http_requests) === 0, 'checkpoint migration must preserve both verified downloads');
remove_test_tree($root . '/managed-runtime');

// Move only extraction/activation to a private executable filesystem. Downloads
// and their hashes remain in the original store, including across PHP requests.
$secret_before = $secret_method->invoke($agents);
file_put_contents($root . '/account-preservation-fixture', 'keep account state');
$runtime_http_requests = [];
$progress = $advance([], 'validate_node');
check(is_array($progress) && $download_count('node') === 1 && $download_count('codex') === 0, 'Node must be tested before downloading Codex');
$select_root = new ReflectionMethod($agents, 'select_executable_runtime_root');
check($select_root->invoke($agents) === true, 'a private fallback directory must pass a real native execution probe');
$execution_root = $managed_root_method->invoke($fresh_agents());
check(str_starts_with($execution_root, $private_parent . '/') && (fileperms($execution_root) & 0777) === 0700, 'selected binary storage must be private and persistent');
$progress = $advance([], 'activate');
check(is_array($progress) && $download_count('node') === 1 && $download_count('codex') === 1, 'switching binary storage must re-extract rather than redownload verified packages');
check($runtime_root_method->invoke($fresh_agents()) === $root && $secret_method->invoke($fresh_agents()) === $secret_before, 'binary relocation must not move or regenerate account credentials');
check(file_get_contents($root . '/account-preservation-fixture') === 'keep account state', 'account files must survive a binary relocation');

// Simulate a PHP termination after the activation rename but before cleanup.
$state = json_decode(file_get_contents($staging . '/installation.json'), true);
$execution_staging = $execution_root . '/' . basename($staging);
$final = $execution_root . '/' . $target;
file_put_contents($execution_staging . '/runtime.json', json_encode([
    'schemaVersion' => 1, 'target' => $target, 'nodeVersion' => $manifest['nodeVersion'], 'codexVersion' => $manifest['codexVersion'],
    'installationId' => $state['id'], 'components' => ['node' => true, 'codex' => true],
]));
check($activate_method->invoke($agents, $execution_staging, $final, $execution_root) === true, 'the simulated activation must move the verified files');
check($advance() === true && is_file($final . '/node/bin/node') && is_file($final . '/codex/bin/codex'), 'activation recovery must not overwrite a completed install with an empty staging directory');
check(!is_dir($staging) && $download_count('node') === 1 && $download_count('codex') === 1, 'activation recovery must finish cleanup without downloading again');
remove_test_tree($execution_root);
delete_option('kodety_agent_private_execution_dir');

// Verify early failure using an intact archive containing an incompatible
// executable (the host situation), not a corrupt download/hash failure.
copy($bad_bin . '/node', $node_source . '/node');
$result = $process_method->invoke($agents, [$tar, '-czf', $node_archive, '-C', $hosting_fixture . '/node-source', $node_top], $root);
check($result['status'] === 0, 'the incompatible Node fixture must be archived');
$manifest['node']['sha256'] = hash_file('sha256', $node_archive);
$runtime_http_requests = [];
$failed = $advance();
check($failed instanceof WP_Error && $failed->get_error_code() === 'kodety_agents_node_system_incompatible', 'an intact incompatible Node must explain the system-library failure');
check($download_count('codex') === 0, 'an incompatible Node must not waste bandwidth downloading Codex');

// Simulate an execution denial even when /proc mount information is unavailable.
// A failed alternate binary must stop, not bounce forever between directories.
file_put_contents($node_source . '/node', "#!/bin/sh\necho 'Permission denied' >&2\nexit 126\n");
$result = $process_method->invoke($agents, [$tar, '-czf', $node_archive, '-C', $hosting_fixture . '/node-source', $node_top], $root);
check($result['status'] === 0, 'the execution-denial fixture must be archived');
$manifest['node']['sha256'] = hash_file('sha256', $node_archive);
$runtime_http_requests = [];
$failed = $advance();
check($failed instanceof WP_Error && $failed->get_error_code() === 'kodety_agents_node_execution_denied', 'denied execution must trigger a bounded fallback and then an actionable error');
check(get_option('kodety_agent_private_execution_dir') === $execution_root && $download_count('node') === 1 && $download_count('codex') === 0, 'automatic fallback must preserve downloads even when it cannot resolve the host restriction');
check($secret_method->invoke($agents) === $secret_before, 'a failed fallback must also preserve login credentials');
delete_option('kodety_agent_private_execution_dir');

// Constants deliberately remain in force for the rest of this short process.
define('KODETY_AGENT_NODE_BINARY', $bad_bin . '/node');
$explicit = $resolve_executable_method->invoke($fresh_agents(), 'node');
check($explicit instanceof WP_Error && $explicit->get_error_code() === 'kodety_agents_node_system_incompatible', 'an explicit invalid Node override must fail closed instead of silently selecting another binary');
$_SERVER['DOCUMENT_ROOT'] = $public_parent;
define('KODETY_AGENT_RUNTIME_DIR', $public_parent . '/agent-binaries');
$rejected = false;
try {
    $managed_root_method->invoke($fresh_agents());
} catch (RuntimeException) {
    $rejected = true;
}
check($rejected && $select_root->invoke($agents) === false, 'public storage and silent override of an explicit runtime directory must be rejected');
if ($saved_document_root === null) unset($_SERVER['DOCUMENT_ROOT']);
else $_SERVER['DOCUMENT_ROOT'] = $saved_document_root;
unset($runtime_filters['kodety_agents_private_runtime_parents']);
remove_test_tree($root);
echo "Kodety Agents hosting compatibility OK\n";
