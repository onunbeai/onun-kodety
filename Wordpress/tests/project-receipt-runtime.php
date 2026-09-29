<?php
/** Actual receipt binding logic; no WordPress installation or network. */
define('ABSPATH', __DIR__);
$GLOBALS['receipt_options'] = [];
function get_option(string $name, mixed $fallback = false): mixed { return $GLOBALS['receipt_options'][$name] ?? $fallback; }
require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';
$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
$read = new ReflectionMethod(Kodety_Plugin::class, 'project_upload_receipt');
$receipt = ['projectId' => 'project-b', 'projectDigest' => str_repeat('a', 64), 'workspaceRevision' => 2];
$baseline = ['kodety_workspace_upload_receipt' => $receipt, 'kodety_workspace_project_id' => 'project-b', 'kodety_workspace_revision' => 2];
$cases = [
    'matching live and archive revision' => [$baseline, 2, $receipt],
    'delta or import advances same project' => [array_replace($baseline, ['kodety_workspace_revision' => 3]), 3, null],
    'stale archive cannot borrow newer receipt' => [array_replace($baseline, ['kodety_workspace_upload_receipt' => array_replace($receipt, ['workspaceRevision' => 3]), 'kodety_workspace_revision' => 3]), 2, null],
    'different live project at same revision' => [array_replace($baseline, ['kodety_workspace_project_id' => 'project-c']), 2, null],
    'malformed digest' => [array_replace($baseline, ['kodety_workspace_upload_receipt' => array_replace($receipt, ['projectDigest' => 'invalid'])]), 2, null],
    'no receipt on older installation' => [array_diff_key($baseline, ['kodety_workspace_upload_receipt' => true]), 2, null],
    'rejected upload preserves previous receipt' => [$baseline, 2, $receipt],
];
foreach ($cases as $name => [$options, $revision, $expected]) {
    $GLOBALS['receipt_options'] = $options;
    if ($read->invoke($plugin, $revision) !== $expected) throw new RuntimeException($name);
}
echo "Project upload receipt: revision, archive, identity and digest binding passed.\n";
