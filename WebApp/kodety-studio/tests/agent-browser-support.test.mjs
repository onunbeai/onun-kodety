import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../../../', import.meta.url)), logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
const { agentBrowserNotice } = await server.ssrLoadModule('/lib/html-editor/agent-browser-support.ts');
after(() => server.close());
const environment = { webAssembly: true, worker: true, platform: 'MacIntel', maxTouchPoints: 0 };
const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

test('Safari receives guidance before starting the credentialless runtime', () => {
  assert.equal(agentBrowserNotice({ ...environment, userAgent: safari }), 'webkit');
});

test('Firefox and Zen are not incorrectly excluded by brand or a required Chromium UA', () => {
  for (const userAgent of ['Mozilla/5.0 Gecko/20100101 Firefox/143.0', 'Mozilla/5.0 Gecko/20100101 Firefox/143.0 Zen/1.0']) {
    assert.equal(agentBrowserNotice({ ...environment, userAgent }), null);
  }
});

test('Chrome, Edge, Brave, Arc and Dia do not match the Safari compatibility token in Chromium user agents', () => {
  // Arc and Dia also use the ordinary Chromium UA; optional branding must not
  // change the result, and a brand token is not required for recognition.
  for (const userAgent of [chrome, chrome + ' Edg/140.0.0.0', chrome + ' Brave/1.82', chrome + ' Arc/1.0', chrome + ' Dia/1.0', chrome + ' OPR/122.0']) {
    assert.equal(agentBrowserNotice({ ...environment, userAgent }), null);
  }
});

test('Chrome/Edge on iOS and iPad desktop mode remain WebKit, not a desktop Chromium workaround', () => {
  for (const token of ['CriOS/140.0', 'EdgiOS/140.0', 'FxiOS/143.0']) {
    assert.equal(agentBrowserNotice({ ...environment, userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 ${token} Mobile Safari/604.1` }), 'webkit');
  }
  assert.equal(agentBrowserNotice({ ...environment, userAgent: safari, maxTouchPoints: 5 }), 'webkit');
});

test('missing browser primitives trigger guidance without misclassifying hosting isolation as browser support', () => {
  for (const feature of ['webAssembly', 'worker']) {
    assert.equal(agentBrowserNotice({ ...environment, userAgent: chrome, [feature]: false }), 'features');
  }
  assert.equal(agentBrowserNotice({ ...environment, userAgent: chrome, crossOriginIsolated: false, sharedArrayBuffer: false }), null);
});
