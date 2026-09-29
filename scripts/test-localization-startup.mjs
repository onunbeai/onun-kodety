import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entrySource = await readFile(path.join(root, 'Wordpress/editor/wordpress-entry-config.ts'), 'utf8');

assert.match(
  entrySource,
  /LOCALIZATION_PROJECT_PREFETCH_TIMEOUT_MS = 30_000[\s\S]*?controller\.abort/,
  'the speculative project archive must have a bounded transfer deadline',
);
assert.match(
  entrySource,
  /signal: controller\.signal[\s\S]*?\.then\(bufferLocalizationPrefetchResponse\)/,
  'the prefetch deadline must cover buffering the archive body, not only response headers',
);

const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
try {
  const entry = await server.ssrLoadModule('/Wordpress/editor/wordpress-entry-config.ts');
  assert.equal(
    entry.wordpressEntryAppView(
      { appView: 'editor' },
      { pathname: '/kodety/localization/' },
    ),
    'localization',
    'the canonical Languages pathname must override a stale editor appView',
  );
  assert.equal(
    entry.wordpressEntryAppView(
      { appView: 'cms' },
      { pathname: '/kodety/localization' },
    ),
    'localization',
    'the Languages route must tolerate a missing trailing slash',
  );
  assert.equal(
    entry.wordpressEntryAppView(
      { appView: 'cms' },
      { pathname: '/kodety/cms/' },
    ),
    'cms',
    'other workspaces must continue using the server appView',
  );
  let speculativeSignal;
  globalThis.window = {
    location: { href: 'https://example.test/kodety/localization/' },
    setTimeout,
    clearTimeout,
  };
  const bridgeCopyA = await server.ssrLoadModule('/stores/useHtmlAgentEditorBridgeStore.ts?bridge-copy=a');
  const bridgeCopyB = await server.ssrLoadModule('/stores/useHtmlAgentEditorBridgeStore.ts?bridge-copy=b');
  let invokedBySecondCopy = false;
  bridgeCopyA.useHtmlAgentEditorBridgeStore.getState().publish('localization-test', {
    invoke: async () => {
      invokedBySecondCopy = true;
      return { workspace: 'localization' };
    },
  });
  assert.equal(
    bridgeCopyB.useHtmlAgentEditorBridgeStore.getState().available,
    true,
    'independently evaluated extension chunks must share the published Agent callback state',
  );
  assert.deepEqual(
    await bridgeCopyB.invokeHtmlAgentEditorTool('kodety_editor_context', {}, {
      requestId: 'request',
      callId: 'call',
      threadId: 'thread',
      turnId: 'turn',
    }),
    { workspace: 'localization' },
    'an Agent panel from a second module graph must invoke the Localization workspace bridge',
  );
  assert.equal(invokedBySecondCopy, true);
  bridgeCopyB.useHtmlAgentEditorBridgeStore.getState().resetOwner('localization-test');
  globalThis.fetch = (_input, init) => {
    speculativeSignal = init?.signal;
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    });
  };

  const config = {
    nonce: 'nonce-value',
    projectUrl: '/wp-json/kodety/v1/project',
    projectDownloadUrl: '/wp-admin/admin-post.php?action=kodety_download_editor_project',
  };
  entry.startLocalizationProjectPrefetch(config);
  const consumer = new AbortController();
  const prefetched = entry.takeLocalizationProjectPrefetch(config, consumer.signal);
  assert.ok(prefetched, 'the matching speculative response must be consumable once');
  consumer.abort(new DOMException('Navigation cancelled.', 'AbortError'));
  assert.equal(await prefetched, null, 'consumer cancellation must settle the speculative request safely');
  assert.equal(speculativeSignal?.aborted, true, 'consumer cancellation must abort the underlying fetch');
  assert.equal(
    entry.takeLocalizationProjectPrefetch(config, new AbortController().signal),
    null,
    'a consumed prefetch must never be reused by a second loader',
  );
} finally {
  globalThis.fetch = previousFetch;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  await server.close();
}

console.log('Localization startup timeout and cancellation contracts passed.');
