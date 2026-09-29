import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React, { act, StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useCanonicalSettingsDraft, canonicalSettingsSignature, mergeCanonicalSettingsDraft } from './app/(builder)/kodety/html-editor/hooks/use-canonical-settings-draft';
    window.IS_REACT_ACT_ENVIRONMENT = true;
    let canonical, latest, lifecycle, generation = 0;
    const root = createRoot(document.getElementById('root'));
    function Probe() { latest = useCanonicalSettingsDraft(canonical); return null; }
    const state = () => ({ draft: latest.draft, dirty: latest.dirty, savedSignature: latest.savedSignature });
    window.fixture = {
      async mount(value) { canonical = value; generation++; await act(async () => root.render(<StrictMode><Probe key={generation} /></StrictMode>)); return state(); },
      async edit(value) { await act(async () => latest.setDraft(value)); return state(); },
      async canonical(value) { canonical = value; await act(async () => root.render(<StrictMode><Probe key={generation} /></StrictMode>)); return state(); },
      async start() { lifecycle = latest.saveLifecycle(canonicalSettingsSignature(latest.draft)); await act(async () => lifecycle.onStart()); return state(); },
      async success() { await act(async () => lifecycle.onSuccess()); return state(); },
      async failure() { await act(async () => lifecycle.onFailure()); return state(); },
      state, merge: mergeCanonicalSettingsDraft,
      async unmount() { await act(async () => root.unmount()); },
    };
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const run = (method, value) => page.evaluate(async ({ method, value }) => window.fixture[method](value), { method, value });
  const base = { title: 'Old', language: 'pt-BR' };
  await run('mount', base);
  await run('edit', { ...base, title: 'Local title' });
  let current = await run('canonical', { ...base, language: 'en-US' });
  assert.deepEqual(current.draft, { title: 'Local title', language: 'en-US' }, 'the next Save includes local title and Agent language');
  assert.equal(current.dirty, true);
  current = await run('canonical', { title: 'Local title', language: 'en-US' });
  assert.equal(current.dirty, false, 'a matching server acknowledgement clears dirty state');

  await run('mount', base);
  await run('edit', { ...base, title: 'In-flight title' });
  await run('start');
  current = await run('canonical', { ...base, language: 'en-US' });
  assert.deepEqual(current.draft, { title: 'In-flight title', language: 'en-US' }, 'an unrelated canonical update does not erase a pending save draft');
  await run('failure');
  assert.deepEqual((await run('state')).draft, current.draft);

  await run('mount', base);
  await run('edit', { ...base, title: 'Saved title' });
  await run('start');
  await run('success');
  await run('edit', base);
  current = await run('canonical', { title: 'Saved title', language: 'en-US' });
  assert.deepEqual(current.draft, { title: 'Old', language: 'en-US' }, 'typing back to an older title is a local edit relative to the successful save');

  const nested = { seo: { title: 'Old', description: 'Description', removable: 'remove' }, flags: { index: true }, rules: ['one', 'two'], remoteDelete: true };
  const local = { ...nested, seo: { title: 'Local', removable: 'remove' }, localAdd: { a: 1 } };
  const remote = { ...nested, seo: { title: 'Old', description: 'Description', remoteAdd: true }, flags: { index: false }, rules: ['two', 'one'], localAdd: { b: 2 } };
  delete remote.remoteDelete;
  await run('mount', nested);
  await run('edit', local);
  current = await run('canonical', remote);
  assert.deepEqual(current.draft, { seo: { title: 'Local', remoteAdd: true }, flags: { index: false }, rules: ['two', 'one'], localAdd: { a: 1, b: 2 } }, 'nested remote fields, both independent additions and explicit deletions survive rebase');

  const atomic = await page.evaluate(() => window.fixture.merge(
    { list: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }], value: 'base', nested: { old: true }, deletionConflict: { keep: true } },
    { list: [{ id: 'b', value: 3 }], value: 'local', nested: null },
    { list: [{ id: 'a', value: 4 }, { id: 'b', value: 2 }, { id: 'c', value: 5 }], value: 'remote', nested: { old: false }, deletionConflict: { keep: false } },
  ));
  assert.deepEqual(atomic, { list: [{ id: 'b', value: 3 }], value: 'local', nested: null }, 'same-field conflicts keep local intent; arrays are never spliced by index and deletion/type changes remain explicit');
  const inputsUnchanged = await page.evaluate(() => {
    const base = { nested: { one: 1 }, list: [1] };
    const local = { nested: { one: 2 }, list: [1] };
    const remote = { nested: { one: 1, two: 2 }, list: [2] };
    const before = JSON.stringify([base, local, remote]);
    window.fixture.merge(base, local, remote);
    return before === JSON.stringify([base, local, remote]);
  });
  assert.equal(inputsUnchanged, true, 'merge never mutates canonical or local input objects');
  await run('unmount');
  assert.deepEqual(errors, []);
  console.log('Canonical Settings drafts: real React StrictMode preserves local and Agent edits, nested fields, deletion, arrays and save baselines.');
} finally { await browser.close(); }
