import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-html-extensions-'));
await build({ entryPoints: [path.join(root, 'WebApp/kodety-studio/src/html-extensions.ts')], outfile: path.join(scratch, 'extensions.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const { validateHtmlExtensionArchive, createHtmlExtensionRepository, HTML_LOCALIZATION_EXTENSION } = createRequire(import.meta.url)(path.join(scratch, 'extensions.cjs'));
after(() => rm(scratch, { recursive: true, force: true }));

const manifest = {
  schemaVersion: 1, type: 'extension', slug: HTML_LOCALIZATION_EXTENSION,
  name: 'Kodety Multi-language', description: 'Localized sites.', version: '1.1.0',
  entry: 'extension.php', requires: { kodety: '1.0.0' }, dependencies: [],
};
async function archive({ changes = {}, prefix = '', extra = {}, omitted = [] } = {}) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries({ 'kodety-extension.json': JSON.stringify({ ...manifest, ...changes }), 'extension.php': '<?php /* extension */', 'assets/localization.js': '/* compiled Localization runtime */', ...extra })) {
    if (!omitted.includes(name)) zip.file(prefix + name, value);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
function storage() {
  const values = new Map();
  let writes = 0;
  let fail = false;
  return {
    read: async id => structuredClone(values.get(id) || []),
    update: async (id, change) => {
      const next = change(structuredClone(values.get(id) || []));
      if (fail) throw new Error('Disk full');
      writes++;
      values.set(id, structuredClone(next));
      return structuredClone(next);
    },
    writes: () => writes,
    fail: value => { fail = value; },
  };
}

test('accepts the actual WordPress Localization release ZIP without repackaging', async () => {
  const bytes = await readFile(path.join(root, 'Wordpress/dist/extensions/kodety-localization.zip'));
  const result = await validateHtmlExtensionArchive(Uint8Array.from(bytes).buffer);
  assert.equal(result.slug, HTML_LOCALIZATION_EXTENSION);
  assert.equal(result.entry, 'extension.php');
  const state = storage();
  const repo = createHtmlExtensionRepository(state);
  assert.equal((await repo.install('project-one', new Blob([bytes])))[0].active, false);
  await repo.setActive('project-one', HTML_LOCALIZATION_EXTENSION, true);
  const reloaded = (await createHtmlExtensionRepository(state).list('project-one'))[0];
  assert.equal(reloaded.active, true);
  assert.equal(reloaded.manifest.version, result.version);
  assert.deepEqual(new Uint8Array((await state.read('project-one'))[0].archive), new Uint8Array(bytes));
});

test('accepts WordPress manifest at ZIP root or inside one outer folder', async () => {
  for (const prefix of ['', 'kodety-localization/']) {
    const result = await validateHtmlExtensionArchive(await archive({ prefix }));
    assert.equal(result.version, manifest.version);
  }
});

test('fresh workspaces have no active extensions; install is inactive until explicitly activated', async () => {
  const state = storage();
  const repo = createHtmlExtensionRepository(state);
  assert.deepEqual(await repo.list('project-one'), []);
  await assert.rejects(repo.setActive('project-one', HTML_LOCALIZATION_EXTENSION, true), /Install.*first/);
  const installed = await repo.install('project-one', new Blob([await archive()]));
  assert.equal(installed[0].active, false);
  assert.equal('archive' in installed[0], false);
  assert.ok((await state.read('project-one'))[0].archive.byteLength > 0);
  assert.equal((await repo.setActive('project-one', HTML_LOCALIZATION_EXTENSION, true))[0].active, true);
  assert.deepEqual(await repo.list('project-two'), []);
  assert.equal((await createHtmlExtensionRepository(state).list('project-one'))[0].active, true);
});

test('upgrades preserve activation; deactivate and remove affect only the workspace registry', async () => {
  const state = storage();
  const repo = createHtmlExtensionRepository(state);
  await repo.install('project-one', new Blob([await archive()]));
  await repo.setActive('project-one', HTML_LOCALIZATION_EXTENSION, true);
  await repo.install('project-two', new Blob([await archive()]));
  const original = (await repo.list('project-one'))[0];
  const upgraded = await repo.install('project-one', new Blob([await archive({ changes: { version: '1.1.1' } })]));
  assert.equal(upgraded[0].active, true);
  assert.equal(upgraded[0].installedAt, original.installedAt);
  assert.equal(upgraded[0].manifest.version, '1.1.1');
  assert.equal((await repo.setActive('project-one', HTML_LOCALIZATION_EXTENSION, false))[0].active, false);
  assert.deepEqual(await repo.remove('project-one', HTML_LOCALIZATION_EXTENSION), []);
  assert.equal((await repo.list('project-two')).length, 1);
});

test('invalid or incompatible packages never write the extension registry', async () => {
  const state = storage();
  const repo = createHtmlExtensionRepository(state);
  for (const config of [
    { changes: { schemaVersion: 2 } },
    { changes: { slug: 'kodety-membership' } },
    { changes: { requires: { kodety: '99.0.0' } } },
    { changes: { requires: { extensionApi: '2.0.0' } } },
    { changes: { entry: '../extension.php' } },
    { changes: { dependencies: ['another-extension'] } },
    { omitted: ['assets/localization.js'] },
    { omitted: ['extension.php'] },
    { extra: { 'another/kodety-extension.json': JSON.stringify(manifest) } },
    { prefix: 'nested/deeper/' },
  ]) await assert.rejects(repo.install('project-one', new Blob([await archive(config)])));
  assert.equal(state.writes(), 0);
});

test('unsafe paths, symbolic links and oversized entries are rejected before extraction', async () => {
  for (const name of ['../escape.php', '/absolute.php', 'C:/drive.php', 'nested\\escape.php', 'secret.env']) {
    await assert.rejects(validateHtmlExtensionArchive(await archive({ extra: { [name]: 'unsafe' } })));
  }
  const zip = new JSZip();
  zip.file('kodety-extension.json', JSON.stringify(manifest));
  zip.file('extension.php', 'target', { unixPermissions: 0o120777 });
  zip.file('assets/localization.js', 'compiled');
  await assert.rejects(validateHtmlExtensionArchive(await zip.generateAsync({ type: 'arraybuffer', platform: 'UNIX' })));
  const oversized = await archive();
  const view = new DataView(oversized);
  for (let offset = 0; offset < view.byteLength - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + 24, 33 * 1024 * 1024, true); break; }
  }
  await assert.rejects(validateHtmlExtensionArchive(oversized));
});

test('failed persistence keeps the previously acknowledged activation intact', async () => {
  const state = storage();
  const repo = createHtmlExtensionRepository(state);
  await repo.install('project-one', new Blob([await archive()]));
  state.fail(true);
  await assert.rejects(repo.setActive('project-one', HTML_LOCALIZATION_EXTENSION, true), /Disk full/);
  assert.equal((await repo.list('project-one'))[0].active, false);
});
