import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const root = await mkdtemp(path.join(tmpdir(), 'kodety-agent-start-'));
const binary = path.join(root, 'codex-fixture');
await copyFile(new URL('../Wordpress/tests/fixtures/codex-app-server.mjs', import.meta.url), binary);
await chmod(binary, 0o700);
process.env.KODETY_CODEX_BINARY = binary;
process.env.KODETY_AGENT_DATA_DIR = root;
process.env.KODETY_AGENT_TEST_SPAWNS = path.join(root, 'spawns');
const { CodexClient, clientFor, codexReadiness } = await import('../Wordpress/kodety/agent-runtime/server.mjs');
const clients = new Set();
const runtime = name => ({ cwd: path.join(root, name), skillRoots: [], projectName: name });
try {
  const initial = await clientFor('37', runtime('first'), { waitUntilReady: false });
  clients.add(initial);
  assert.equal(codexReadiness(initial).state, 'starting', 'a created process is not yet ready');
  const simultaneous = await clientFor('37', runtime('first'), { waitUntilReady: false });
  assert.equal(initial, simultaneous, 'concurrent polls must share one native startup');
  await initial.ready;
  assert.equal(codexReadiness(initial).ok, true, 'initialize + permission profile + skills must complete before ready');
  assert.equal((await readFile(process.env.KODETY_AGENT_TEST_SPAWNS, 'utf8')).trim().split('\n').length, 1);

  process.env.KODETY_AGENT_TEST_MODE = 'bad-profile';
  const invalid = await clientFor('37', runtime('restricted'), { waitUntilReady: false });
  clients.add(invalid);
  await assert.rejects(invalid.ready);
  const failed = codexReadiness(invalid);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'codex_permission_profile');
  assert.doesNotMatch(JSON.stringify(failed), /codex-home|token|stderr/, 'readiness must only expose public error codes');
  assert.equal(await clientFor('37', runtime('restricted'), { waitUntilReady: false }), invalid, 'polling a failed startup must not spawn repeatedly');
  await assert.rejects(clientFor('37', runtime('restricted')), /permission profile/, 'RPC must still reject while startup is failed');

  process.env.KODETY_AGENT_TEST_MODE = 'ready';
  const retried = await clientFor('37', runtime('restricted'), { waitUntilReady: false, retry: true });
  clients.add(retried);
  assert.notEqual(retried, invalid, 'an explicit retry must allow recovery without restarting the entire bridge');
  await retried.ready;
  assert.equal(codexReadiness(retried).ok, true);

  process.env.KODETY_AGENT_TEST_MODE = 'exit';
  const exited = await clientFor('37', runtime('exit'), { waitUntilReady: false });
  clients.add(exited);
  await assert.rejects(exited.ready);
  assert.equal(codexReadiness(exited).code, 'codex_start_failed');
  assert.equal(await clientFor('37', runtime('exit'), { waitUntilReady: false }), exited);

  process.env.KODETY_AGENT_TEST_MODE = 'ignore-term';
  const slow = await clientFor('38', runtime('slow'), { waitUntilReady: false });
  clients.add(slow);
  // Capture the fake process after asynchronous private-directory setup.
  while (!slow.process && slow.startupState === 'starting') await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(codexReadiness(slow).state, 'starting', 'slow initialization must remain pending instead of timing out');
  assert.equal(slow.pending.size, 1, 'the initialization request must remain pending while the process is alive');
  slow.startupActivityAt = Date.now() - 100_000;
  assert.equal(codexReadiness(slow).state, 'stalled', 'an inactive startup must stop presenting an endless loading state');
  assert.equal(codexReadiness(slow).code, 'codex_start_stalled');
  const child = slow.process;
  const exit = once(child, 'exit');
  process.env.KODETY_AGENT_TEST_MODE = 'ready';
  const recoveredSlow = await clientFor('38', runtime('slow'), { waitUntilReady: false, retry: true });
  clients.add(recoveredSlow);
  assert.notEqual(recoveredSlow, slow, 'an explicit retry must replace a stalled native process');
  await assert.rejects(slow.ready);
  await recoveredSlow.ready;
  const [, signal] = await exit;
  assert.equal(signal, 'SIGKILL', 'an explicitly stopped unresponsive child must be reaped after the SIGTERM grace period');
  assert.equal(slow.pending.size, 0, 'explicit shutdown must reject and clear every pending RPC');
  console.log('Agent start: slow readiness, stalled watchdog, recovery and process cleanup OK.');
} finally {
  const exits = [];
  for (const client of clients) {
    const child = client.process;
    if (child && child.exitCode === null && child.signalCode === null) exits.push(once(child, 'exit').catch(() => {}));
    client.stop();
  }
  await Promise.all(exits);
  await rm(root, { recursive: true, force: true });
}
