import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wordpressEntrySource = await readFile(
  path.join(root, 'Wordpress/editor/main.tsx'),
  'utf8',
);
assert.match(wordpressEntrySource, /installWordPressProjectObservabilityBridge\(performanceDebug\)/);
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  const observabilityModule = await server.ssrLoadModule(
    '/Wordpress/editor/wordpress-observability.ts',
  );
  const projectModule = await server.ssrLoadModule(
    '/Wordpress/editor/wordpress-project-observability.ts',
  );
  const { createWordPressObservability, isKodetyOperationId } = observabilityModule;
  const {
    KODETY_WORDPRESS_PROJECT_OBSERVABILITY_GLOBAL,
    KODETY_WORDPRESS_PROJECT_PHASES,
    createWordPressProjectObservabilityBridge,
    installWordPressProjectObservabilityBridge,
    wordpressProjectObservabilityBridge,
  } = projectModule;

  assert.deepEqual(KODETY_WORDPRESS_PROJECT_PHASES, [
    'project_download_body',
    'project_unzip',
    'project_parse',
    'project_first_canvas_visual_ready',
  ]);

  let now = 10;
  const observer = createWordPressObservability(
    { enabled: true, traceId: `trace-${'a'.repeat(32)}` },
    {},
    {
      crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
      performance: {
        now: () => {
          now += 1.25;
          return now;
        },
        mark: () => undefined,
        measure: () => undefined,
        clearMarks: () => undefined,
        clearMeasures: () => undefined,
      },
    },
  );
  const bridge = createWordPressProjectObservabilityBridge(observer);
  const installedBridge = installWordPressProjectObservabilityBridge(observer);
  assert.equal(
    globalThis[KODETY_WORDPRESS_PROJECT_OBSERVABILITY_GLOBAL],
    installedBridge,
  );
  assert.equal(wordpressProjectObservabilityBridge(), installedBridge);
  const operationId = `obs-${'b'.repeat(32)}`;
  bridge.start(operationId);

  const outcomes = ['ok', 'error', 'aborted', 'ok'];
  const caches = ['miss', 'bypass', 'bypass', 'hit'];
  const tokens = [];
  for (let index = 0; index < KODETY_WORDPRESS_PROJECT_PHASES.length; index += 1) {
    const token = bridge.begin(KODETY_WORDPRESS_PROJECT_PHASES[index], caches[index]);
    assert.ok(token, `phase ${KODETY_WORDPRESS_PROJECT_PHASES[index]} must start`);
    assert.equal(token.operationId, operationId);
    tokens.push(token);
    bridge.finish(token, outcomes[index]);
    bridge.finish(token, 'error');
  }

  const entries = observer.entries();
  assert.deepEqual(entries.map(entry => entry.operation), KODETY_WORDPRESS_PROJECT_PHASES);
  assert.deepEqual(entries.map(entry => entry.result), outcomes);
  assert.deepEqual(entries.map(entry => entry.cache), caches);
  assert.ok(entries.every(entry => entry.operationId === operationId));
  assert.ok(entries.every(entry => Number.isFinite(entry.durationMs) && entry.durationMs >= 0));
  assert.equal(
    bridge.begin('project_unzip'),
    null,
    'phase order cannot move backwards inside one lifecycle',
  );

  bridge.finish({
    phase: 'project_parse',
    operationId,
  }, 'ok');
  assert.equal(observer.entries().length, entries.length, 'forged tokens must be ignored');

  const stale = tokens.at(-1);
  const secret = 'Bearer customer@example.com?token=private';
  bridge.start(operationId);
  const superseded = bridge.begin('project_download_body');
  assert.ok(superseded);
  bridge.start(secret);
  assert.equal(
    observer.entries().at(-1).result,
    'aborted',
    'starting a newer lifecycle must close an unfinished phase monotonically',
  );
  bridge.finish(stale, 'ok');
  const secretPayload = { url: secret, headers: { authorization: secret } };
  const sanitizedToken = bridge.begin('project_download_body', secretPayload);
  assert.ok(sanitizedToken);
  assert.ok(isKodetyOperationId(sanitizedToken.operationId));
  assert.notEqual(sanitizedToken.operationId, secret);
  bridge.finish(sanitizedToken, 'ok');
  const serialized = JSON.stringify(observer.entries());
  for (const forbidden of ['customer@example.com', 'token=private', 'authorization', 'Bearer']) {
    assert.equal(serialized.includes(forbidden), false, `closed phase payload leaked ${forbidden}`);
  }

  const disabled = createWordPressProjectObservabilityBridge(
    createWordPressObservability(null),
  );
  disabled.start(operationId);
  assert.equal(disabled.begin('project_download_body'), null);

  console.log('WordPress project observability phase contract passed.');
} finally {
  delete globalThis.__kodetyWordPressProjectObservability;
  await server.close();
}
