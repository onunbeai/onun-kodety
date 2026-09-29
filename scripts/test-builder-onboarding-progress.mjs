import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(relative) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', compiled)(exports);
  return exports;
}

const { readOnboardingProgress: read, writeOnboardingProgress: write } = await loadModule('../lib/html-editor/onboarding-progress.ts');
const { createOnboardingStorageKey } = await loadModule('../lib/html-editor/onboarding-state.ts');
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
};
const storageKey = key => `${key}:reading:v1`;
const key = createOnboardingStorageKey('https://site.test/wordpress/', 17);
const local = memoryStorage();

assert.deepEqual(read(key, local), {}, 'a first visit has no reading progress');
assert.equal(write(key, 'design', { stepId: 'style', completed: false }, local), true);
assert.deepEqual(read(key, local), { design: { stepId: 'style', completed: false } });
for (const otherKey of [
  createOnboardingStorageKey('https://site.test/wordpress/', 18),
  createOnboardingStorageKey('https://site.test/another-install/', 17),
  createOnboardingStorageKey('https://another.test/wordpress/', 17),
]) {
  assert.deepEqual(read(otherKey, local), {}, 'site, installation and user each isolate progress');
  assert.equal(write(otherKey, 'cms', { stepId: 'fields', completed: true }, local), true);
}
assert.deepEqual(read(key, local), { design: { stepId: 'style', completed: false } }, 'other identities cannot affect the active user');

local.setItem(key, 'dismissed');
assert.equal(write(key, 'cms', { stepId: 'collections', completed: false }, local), true);
assert.equal(local.getItem(key), 'dismissed', 'reading progress never changes the invitation decision');
assert.deepEqual(read(key, local), {
  design: { stepId: 'style', completed: false },
  cms: { stepId: 'collections', completed: false },
}, 'reading a second area preserves the first');

// A write must merge the latest durable state, rather than a caller's stale copy.
const staleRead = read(key, local);
assert.equal(write(key, 'analytics', { stepId: 'funnels', completed: false }, local), true);
assert.equal(staleRead.analytics, undefined);
assert.equal(write(key, 'settings', { stepId: 'seo', completed: false }, local), true);
assert.equal(read(key, local).analytics.stepId, 'funnels');
assert.equal(write(key, 'localization', { stepId: 'translations', completed: true }, local), true);
assert.deepEqual(Object.keys(read(key, local)), ['design', 'cms', 'settings', 'analytics', 'localization']);

assert.equal(write(key, 'design', { stepId: 'reopen', completed: true }, local), true);
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }, local), true);
assert.deepEqual(read(key, local).design, { stepId: 'canvas', completed: true }, 'manual replay updates position without removing completion');
assert.deepEqual(read(key, local).localization, { stepId: 'translations', completed: true });
const detached = read(key, local);
detached.cms.stepId = 'tampered';
assert.equal(read(key, local).cms.stepId, 'collections', 'callers receive independent progress objects');

for (const raw of ['', '{broken', 'null', 'false', '42', '"design"', '[]', '[{"stepId":"canvas","completed":true}]']) {
  const invalid = memoryStorage();
  invalid.setItem(storageKey(key), raw);
  assert.deepEqual(read(key, invalid), {}, `invalid storage value is ignored: ${raw}`);
}

const mixed = memoryStorage();
mixed.setItem(storageKey(key), JSON.stringify({
  design: { stepId: 'style', completed: false, extra: 'ignored' },
  cms: { stepId: 123, completed: false },
  settings: { stepId: 'seo', completed: 'true' },
  analytics: null,
  localization: { stepId: 'translations', completed: true },
  members: { stepId: 'members', completed: true },
  templates: { stepId: 'catalog', completed: false },
  arbitrary: { stepId: 'value', completed: true },
}));
assert.deepEqual(read(key, mixed), {
  design: { stepId: 'style', completed: false },
  localization: { stepId: 'translations', completed: true },
}, 'invalid areas and entries are discarded independently');

for (const stepId of ['', 'with space', 'UPPERCASE', '-leading', '_leading', 'a/b', '<script>', 'a'.repeat(121), 123, null, {}, []]) {
  const invalid = memoryStorage();
  invalid.setItem(storageKey(key), JSON.stringify({ design: { stepId, completed: false } }));
  assert.deepEqual(read(key, invalid), {}, 'malformed step identifiers do not become resumable progress');
}
for (const stepId of ['a', 'style-custom-css', 'step_2', 'a'.repeat(120)]) {
  const valid = memoryStorage();
  assert.equal(write(key, 'design', { stepId, completed: false }, valid), true);
  assert.equal(read(key, valid).design.stepId, stepId);
}

let invalidStorageCalls = 0;
const untouched = {
  getItem() { invalidStorageCalls++; return null; },
  setItem() { invalidStorageCalls++; },
};
for (const area of ['', 'members', 'templates', 'DESIGN', '__proto__', 'unknown']) {
  assert.equal(write(key, area, { stepId: 'canvas', completed: false }, untouched), false);
}
for (const entry of [
  null, undefined, {}, [], 'canvas', 123,
  { stepId: 123, completed: false },
  { stepId: null, completed: true },
  { stepId: 'canvas', completed: 'true' },
  { stepId: 'canvas', completed: 1 },
  { stepId: '', completed: false },
  { stepId: 'a'.repeat(121), completed: false },
]) {
  assert.equal(write(key, 'design', entry, untouched), false, 'invalid writes are rejected without throwing');
}
assert.deepEqual(read('', untouched), {});
assert.equal(write('', 'design', { stepId: 'canvas', completed: false }, untouched), false);
assert.equal(invalidStorageCalls, 0, 'invalid inputs never reach storage');

const blocked = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { assert.fail('unreadable progress must not be overwritten'); },
};
assert.deepEqual(read(key, blocked), {}, 'blocked reads degrade to an empty presentation');
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }, blocked), false);
let unreadableWrites = 0;
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }, {
  getItem() { throw new Error('SecurityError'); },
  setItem() { unreadableWrites++; },
}), false);
assert.equal(unreadableWrites, 0, 'a failed merge read cannot erase another area or its completion');

const quota = memoryStorage();
quota.setItem = () => { throw new Error('QuotaExceededError'); };
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }, quota), false);
const ignored = memoryStorage();
ignored.setItem = () => {};
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }, ignored), false, 'silently ignored writes are not reported as durable');
const changedAfterWrite = memoryStorage();
const originalSetItem = changedAfterWrite.setItem;
changedAfterWrite.setItem = (target, value) => {
  originalSetItem(target, JSON.stringify({ ...JSON.parse(value), cms: { stepId: 'fields', completed: true } }));
};
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }, changedAfterWrite), false, 'a concurrent replacement cannot be reported as the verified write');
let verifyReads = 0;
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }, {
  getItem() { if (++verifyReads > 1) throw new Error('Storage became unavailable'); return null; },
  setItem() {},
}), false, 'a write requires a successful verification read');

assert.deepEqual(read(key), {}, 'server rendering without browser storage remains safe');
assert.equal(write(key, 'design', { stepId: 'canvas', completed: false }), false);
console.log('Builder onboarding reading progress: isolation, validation, merge, completion and storage failures passed.');
