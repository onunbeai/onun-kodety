import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/html-editor/onboarding-state.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const loadState = () => {
  const exports = {};
  new Function('exports', compiled)(exports);
  return exports;
};
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
};
const state = loadState();
const { createOnboardingStorageKey, resolveOnboardingPreference } = state;
const key = createOnboardingStorageKey('https://site.test/wordpress/', 17);
assert.equal(key, createOnboardingStorageKey('https://site.test/wordpress?project=other&nonce=rotated#builder', 17));
assert.equal(key, createOnboardingStorageKey('https://username:password@SITE.test:443/wordpress', 17));
assert.notEqual(key, createOnboardingStorageKey('https://site.test/wordpress', 18));
assert.notEqual(key, createOnboardingStorageKey('https://site.test/another-install', 17));
assert.notEqual(key, createOnboardingStorageKey('https://another.test/wordpress', 17));
assert.notEqual(key, createOnboardingStorageKey('http://site.test/wordpress', 17));
assert.ok(!key.includes('nonce') && !key.includes('password'), 'preference keys contain only stable site/user identity');
for (const site of ['invalid', '', 'javascript:alert(1)', 'file:///tmp/test']) assert.equal(createOnboardingStorageKey(site, 17), '');
for (const user of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(createOnboardingStorageKey('https://site.test', user), '');
assert.ok(createOnboardingStorageKey('https://site.test', 0), 'anonymous runtimes can explicitly use user 0');

const preferences = ['unseen', 'offered', 'started', 'completed', 'dismissed'];
for (const [localRank, local] of preferences.entries()) {
  for (const [serverRank, server] of preferences.entries()) {
    assert.equal(resolveOnboardingPreference(local, server), preferences[Math.max(localRank, serverRank)]);
  }
  for (const invalid of [undefined, null, '', 'toString', '__proto__', {}, 1]) {
    assert.equal(resolveOnboardingPreference(local, invalid), local);
    assert.equal(resolveOnboardingPreference(invalid, local), local);
  }
}
assert.equal(resolveOnboardingPreference(null, 'unknown'), null);

const local = memoryStorage();
assert.equal(state.readOnboardingPreference(key, undefined, local), 'unseen');
assert.equal(state.writeOnboardingPreference(key, 'dismissed', local), true);
assert.equal(state.readOnboardingPreference(key, 'unseen', local), 'dismissed');
assert.equal(state.writeOnboardingPreference(key, 'started', local), true);
assert.equal(local.getItem(key), 'dismissed', 'manual replay cannot re-enable invitations after refusal');
assert.equal(loadState().readOnboardingPreference(key, 'unseen', local), 'dismissed', 'refusal survives a document reload');
assert.equal(state.readOnboardingPreference(createOnboardingStorageKey('https://site.test/wordpress', 18), undefined, local), 'unseen');
assert.equal(state.readOnboardingPreference(createOnboardingStorageKey('https://another.test/wordpress', 17), undefined, local), 'unseen');

for (const nonUnseen of ['offered', 'started', 'completed', 'dismissed']) {
  const fresh = loadState();
  const storage = memoryStorage();
  assert.equal(fresh.readOnboardingPreference(key, nonUnseen, storage), nonUnseen);
  assert.equal(fresh.writeOnboardingPreference(key, 'unseen', storage), true);
  assert.equal(storage.getItem(key), nonUnseen, 'stale local writes cannot undo a server decision');
  assert.equal(fresh.readOnboardingPreference(key, 'unseen', storage), nonUnseen);
}

const blocked = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { assert.fail('unreadable storage must not overwrite an unknown refusal'); },
  removeItem() { throw new Error('SecurityError'); },
};
const blockedState = loadState();
assert.equal(blockedState.readOnboardingPreference(key, undefined, blocked), null);
assert.equal(blockedState.readOnboardingPreference(key, 'unseen', blocked), null, 'blocked local state must not cause an invitation');
assert.equal(blockedState.writeOnboardingPreference(key, 'dismissed', blocked), false);
assert.equal(blockedState.readOnboardingPreference(key, 'unseen', blocked), 'dismissed', 'failed durable writes still suppress invitations across mounts');
assert.equal(blockedState.readOnboardingPreference(key, undefined, memoryStorage()), 'dismissed');
assert.equal(loadState().readOnboardingPreference(key, 'completed', blocked), 'completed');
assert.equal(loadState().readOnboardingPreference(key), null, 'server rendering without browser storage stays quiet');
assert.equal(state.readOnboardingPreference('', 'unseen', local), null);
assert.equal(state.writeOnboardingPreference('', 'dismissed', local), false);

const quota = memoryStorage();
quota.setItem = () => { throw new Error('QuotaExceededError'); };
const quotaState = loadState();
assert.equal(quotaState.writeOnboardingPreference(key, 'dismissed', quota), false);
assert.equal(quotaState.readOnboardingPreference(key, 'unseen', quota), 'dismissed');
const ignoredWrites = memoryStorage();
ignoredWrites.setItem = () => {};
assert.equal(loadState().writeOnboardingPreference(key, 'started', ignoredWrites), false, 'silent storage write failure is not reported as persistence');
for (const malformed of ['', '{broken', 'null', 'toString', '__proto__', 'false']) {
  const corrupt = memoryStorage();
  corrupt.setItem(key, malformed);
  assert.equal(loadState().readOnboardingPreference(key, 'unseen', corrupt), null, 'corrupt preferences must not trigger invitations');
  assert.equal(loadState().readOnboardingPreference(key, 'dismissed', corrupt), 'dismissed');
}
assert.equal(loadState().readOnboardingPreference(key, 'invalid-server-state', memoryStorage()), null);

const availabilitySource = await readFile(new URL('../lib/html-editor/onboarding-availability.ts', import.meta.url), 'utf8');
const availability = {};
new Function('exports', ts.transpileModule(availabilitySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(availability);
const currentUrl = 'https://site.test/wordpress/kodety/editor/';
const routes = {
  editorUrl: currentUrl, cmsUrl: '/wordpress/kodety/cms/', cmsItemsUrl: '/cms/items',
  settingsUrl: '/wordpress/kodety/settings/', analyticsUrl: '/wordpress/kodety/analytics/', canViewAnalytics: true,
  localizationUrl: '/wordpress/kodety/localization/', membersUrl: '/wordpress/kodety/members/', templatesUrl: '/wordpress/kodety/templates/',
};
assert.equal(availability.onboardingAreaForDestination('/wordpress/kodety/cms/?collection=post', routes, currentUrl), 'cms');
assert.equal(availability.onboardingAreaForDestination('/wordpress/kodety/settings?section=seo#robots', routes, currentUrl), 'settings');
assert.equal(availability.onboardingAreaForDestination('/wordpress/kodety/localization/', routes, currentUrl), null, 'a route alone does not install Localization');
assert.equal(availability.onboardingAreaForDestination('/wordpress/kodety/localization/', { ...routes, localizationEntryUrl: '/private/localization.js' }, currentUrl), 'localization');
for (const destination of ['https://evil.test/wordpress/kodety/cms/', '/wordpress/kodety/members/', '/wordpress/kodety/templates/', '/another-install/kodety/cms/']) {
  assert.equal(availability.onboardingAreaForDestination(destination, routes, currentUrl), null);
}
assert.equal(availability.onboardingAreaForDestination(routes.cmsUrl, { ...routes, cmsItemsUrl: undefined }, currentUrl), null);
assert.equal(availability.onboardingAreaForDestination(routes.analyticsUrl, { ...routes, canViewAnalytics: false }, currentUrl), null);
const adminRoutes = { ...routes, cmsUrl: '/wp-admin/admin.php?page=kodety&workspace=cms', settingsUrl: '/wp-admin/admin.php?page=kodety&workspace=settings' };
assert.equal(availability.onboardingAreaForDestination('/wp-admin/admin.php?page=kodety&workspace=settings&section=seo', adminRoutes, currentUrl), 'settings', 'configured query routes remain distinct');
assert.equal(availability.onboardingAreaForDestination('/wp-admin/admin.php?page=kodety&workspace=other', adminRoutes, currentUrl), null);

const originalNow = Date.now;
try {
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const session = memoryStorage();
  const intent = { tourId: 'cms', destination: 'https://site.test/wordpress/wp-admin/admin.php?page=kodety&workspace=cms#collections' };
  const pendingKey = `${key}:pending-tour`;
  assert.equal(state.queueOnboardingTour(key, intent, session), true);
  assert.deepEqual(loadState().consumeOnboardingTour(key, intent.destination, session), intent, 'explicit intent survives route navigation');
  assert.equal(loadState().consumeOnboardingTour(key, intent.destination, session), null, 'document reload does not replay a consumed tour');
  assert.equal(session.getItem(pendingKey), null);

  assert.equal(state.queueOnboardingTour(key, intent, session), true);
  const reordered = 'https://site.test/wordpress/wp-admin/admin.php?workspace=cms&page=kodety#collections';
  assert.deepEqual(state.consumeOnboardingTour(key, reordered, session), intent, 'equivalent query ordering identifies the same destination');

  const handoff = new URL(intent.destination);
  handoff.searchParams.set('kodety_editor_handoff', 'fixture-editor-session-1234');
  state.queueOnboardingTour(key, intent, session);
  assert.deepEqual(state.consumeOnboardingTour(key, handoff.href, session), intent, 'transport handoff does not change the requested workspace');
  state.queueOnboardingTour(key, { ...intent, destination: handoff.href }, session);
  assert.deepEqual(state.consumeOnboardingTour(key, intent.destination, session), intent, 'consuming the editor handoff before mount preserves the tour');

  for (const otherUrl of [
    'https://site.test/wordpress/wp-admin/admin.php?page=kodety&workspace=settings#collections',
    'https://site.test/wordpress/wp-admin/admin.php?page=kodety&workspace=cms',
    'https://site.test/wordpress/wp-admin/admin.php?page=kodety&workspace=cms&extra=1#collections',
    'https://site.test/wordpress/other.php?page=kodety&workspace=cms#collections',
    'https://evil.test/wordpress/wp-admin/admin.php?page=kodety&workspace=cms#collections',
    '',
  ]) {
    state.queueOnboardingTour(key, intent, session);
    assert.equal(state.consumeOnboardingTour(key, otherUrl, session), null);
    assert.equal(state.consumeOnboardingTour(key, intent.destination, session), null, 'visiting another route discards intent instead of reviving it later');
  }

  state.queueOnboardingTour(key, intent, session);
  now += 119_999;
  assert.deepEqual(state.consumeOnboardingTour(key, intent.destination, session), intent);
  state.queueOnboardingTour(key, intent, session);
  now += 120_000;
  assert.equal(state.consumeOnboardingTour(key, intent.destination, session), null, 'intent expires after two minutes');
  state.queueOnboardingTour(key, intent, session);
  now -= 1;
  assert.equal(state.consumeOnboardingTour(key, intent.destination, session), null, 'future timestamps fail closed');

  for (const raw of ['{broken', 'null', '[]', '{}', JSON.stringify({ ...intent, createdAt: 'recent' }), JSON.stringify({ ...intent, tourId: '<script>', createdAt: now })]) {
    session.setItem(pendingKey, raw);
    assert.equal(state.consumeOnboardingTour(key, intent.destination, session), null);
    assert.equal(session.getItem(pendingKey), null, 'malformed intent is removed');
  }
  const otherUserKey = createOnboardingStorageKey('https://site.test/wordpress', 18);
  state.queueOnboardingTour(key, intent, session);
  assert.equal(state.consumeOnboardingTour(otherUserKey, intent.destination, session), null);
  assert.deepEqual(state.consumeOnboardingTour(key, intent.destination, session), intent);
  state.queueOnboardingTour(key, intent, session);
  state.clearOnboardingTour(key, session);
  assert.equal(state.consumeOnboardingTour(key, intent.destination, session), null);

  for (const destination of ['https://evil.test/cms', 'javascript:alert(1)', 'https://user:password@site.test/cms', '']) {
    assert.equal(state.queueOnboardingTour(key, { ...intent, destination }, session), false);
  }
  assert.equal(state.queueOnboardingTour(key, { ...intent, tourId: '' }, session), false);
  assert.equal(state.queueOnboardingTour('', intent, session), false);
  assert.equal(state.queueOnboardingTour(key, intent, quota), false);
  assert.equal(state.queueOnboardingTour(key, intent, ignoredWrites), false);
  assert.equal(state.consumeOnboardingTour(key, intent.destination, blocked), null);
  assert.doesNotThrow(() => state.clearOnboardingTour(key, blocked));

  const cannotRemove = memoryStorage();
  cannotRemove.removeItem = () => {};
  state.queueOnboardingTour(key, intent, cannotRemove);
  assert.equal(state.consumeOnboardingTour(key, intent.destination, cannotRemove), null, 'unconfirmed removal must not open a tour that could replay after reload');
} finally {
  Date.now = originalNow;
}

console.log('Builder onboarding preference and manual navigation behavior passed.');
