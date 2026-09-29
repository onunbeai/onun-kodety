import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../../../', import.meta.url)), logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
const entry = await server.ssrLoadModule('/WebApp/kodety-studio/src/studio-entry.ts');
after(() => server.close());

test('Dash entry requests a fresh authentication exchange independently of any previous Studio account', () => {
  assert.deepEqual(entry.readStudioEntry('https://studio.test/?from=dash&lang=pt&project=abc'), { fromDash: true, callback: false, language: 'pt' });
  assert.equal(entry.readStudioEntry('https://studio.test/?from=other&lang=en').fromDash, false);
  assert.equal(entry.readStudioEntry('https://studio.test/?project=abc').fromDash, false);
});

test('a callback takes priority over a handoff marker and cannot restart the exchange', () => {
  for (const hash of ['studio_ticket=t&studio_state=s', 'studio_state=s', 'studio_ticket=t']) {
    const value = entry.readStudioEntry(`https://studio.test/?from=dash&lang=en#${hash}`);
    assert.equal(value.fromDash, false);
    assert.equal(value.callback, true);
  }
});

test('consuming an entry prevents a redirect loop while preserving project and CMS destination', () => {
  const value = entry.consumedStudioEntryUrl('https://studio.test/?from=dash&lang=pt&project=local-id&source=local&collection=articles#settings');
  assert.equal(value, 'https://studio.test/?project=local-id&source=local&collection=articles#settings');
  assert.equal(entry.readStudioEntry(value).fromDash, false);
  assert.equal(entry.consumedStudioEntryUrl('https://studio.test/?from=other&lang=es#studio_ticket=t&studio_state=s'), 'https://studio.test/?from=other&lang=es#studio_ticket=t&studio_state=s');
});

test('only supported explicit locales override a stored preference', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ language: 'pt', onboardingVersion: 2 }) };
  try {
    assert.equal(entry.loadStudioEntryPreferences('https://studio.test/?lang=en').language, 'en');
    assert.equal(entry.loadStudioEntryPreferences('https://studio.test/?lang=pt').language, 'pt');
    assert.equal(entry.loadStudioEntryPreferences('https://studio.test/?lang=es').language, 'pt');
    assert.equal(entry.loadStudioEntryPreferences('https://studio.test/').language, 'pt');
  } finally { globalThis.localStorage = previous; }
});
