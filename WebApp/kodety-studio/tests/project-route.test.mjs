import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../../../', import.meta.url)), logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
const route = await server.ssrLoadModule('/WebApp/kodety-studio/src/project-route.ts');
after(() => server.close());

test('Dash query links remain cloud routes while local identities are explicit', () => {
  assert.deepEqual(route.readProjectRoute('https://studio.test/?project=same-id'), { id: 'same-id', source: 'cloud' });
  assert.deepEqual(route.readProjectRoute('https://studio.test/?project=same-id&source=local'), { id: 'same-id', source: 'local' });
  for (const query of ['project=', 'project=../other', 'project=one&source=unknown']) assert.equal(route.readProjectRoute(`https://studio.test/?${query}`), null);
});

test('opening and leaving preserve the shell base and clear project-only state', () => {
  const base = 'https://studio.test/tools/index.html?lang=en&project=old&source=local&section=license&collection=old-items&view=fields&item=3#settings';
  assert.equal(route.projectRouteUrl(base, { id: 'next', source: 'cloud' }), 'https://studio.test/tools/index.html?lang=en&project=next');
  assert.equal(route.projectRouteUrl(base, { id: 'next', source: 'local' }), 'https://studio.test/tools/index.html?lang=en&project=next&source=local');
  assert.equal(route.libraryRouteUrl(base), 'https://studio.test/tools/index.html?lang=en#projects');
  assert.equal(route.wordpressProjectRouteUrl(base, 'legacy-id'), 'https://studio.test/tools/project-storage.html?project=legacy-id&action=open');
});

test('the fixed login callback restores only the requested cloud project, never stale history', () => {
  assert.deepEqual(route.restoredProjectRoute('https://studio.test/#studio_ticket=t&studio_state=s', 'cloud-id'), { id: 'cloud-id', source: 'cloud' });
  assert.equal(route.restoredProjectRoute('https://studio.test/#projects', 'cloud-id'), null);
  assert.deepEqual(route.restoredProjectRoute('https://studio.test/?project=explicit&source=local#studio_ticket=t', 'other'), { id: 'explicit', source: 'local' });
  assert.equal(route.restoredProjectRoute('https://studio.test/?project=..#studio_ticket=t', 'other'), null);
});

test('login can return to a local project without confusing an identical cloud ID', () => {
  let saved;
  const storage = { setItem: (key, value) => { assert.equal(key, route.LOGIN_PROJECT_KEY); saved = value; }, removeItem: () => { saved = null; } };
  route.rememberProjectRouteForLogin('https://studio.test/?project=same-id&source=local', storage);
  assert.deepEqual(route.restoredProjectRoute('https://studio.test/#studio_ticket=t&studio_state=s', saved), { id: 'same-id', source: 'local' });
  assert.equal(route.restoredProjectRoute('https://studio.test/', saved), null);
  route.rememberProjectRouteForLogin('https://studio.test/#projects', storage);
  assert.equal(saved, null);
  assert.equal(route.restoredProjectRoute('https://studio.test/#studio_ticket=t', '{"id":"safe","source":"external"}'), null);
});
