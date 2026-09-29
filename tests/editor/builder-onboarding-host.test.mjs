import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-guide-host-'));
await build({ entryPoints: [path.join(root, 'lib/html-editor/onboarding-workspace.ts'), path.join(root, 'lib/html-editor/onboarding-availability.ts')], outdir: scratch, bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, logLevel: 'silent' });
const require = createRequire(import.meta.url);
const { createWorkspaceOnboardingHandoff, createWorkspaceOnboardingStorageKey } = require(path.join(scratch, 'onboarding-workspace.cjs'));
const { onboardingAreaEnabled, onboardingAreaUrl } = require(path.join(scratch, 'onboarding-availability.cjs'));
after(() => rm(scratch, { recursive: true, force: true }));

const host = (overrides = {}) => ({ id: 'html-project-one', currentArea: 'design', enabledAreas: ['design', 'settings'], onNavigate: async () => true, ...overrides });

test('HTML advertises Builder and Settings without fabricated WordPress endpoints', () => {
  const workspace = host();
  assert.equal(onboardingAreaEnabled('design', undefined, workspace), true);
  assert.equal(onboardingAreaEnabled('settings', undefined, workspace), true);
  for (const area of ['cms', 'analytics', 'members', 'templates', 'localization']) assert.equal(onboardingAreaEnabled(area, undefined, workspace), false);
  assert.equal(onboardingAreaUrl('settings'), undefined);
  assert.equal(onboardingAreaEnabled('localization', undefined, host({ enabledAreas: ['design', 'settings', 'localization'] })), true);
  assert.equal(onboardingAreaEnabled('localization', { localizationUrl: '/locale' }), false);
  assert.equal(onboardingAreaEnabled('localization', { localizationUrl: '/locale', localizationEntryUrl: '/extension.js' }), true, 'WordPress retains its installed-extension contract');
});

test('tour waits for the save guard and actual SPA destination, then resumes exactly once', async () => {
  const handoff = createWorkspaceOnboardingHandoff();
  let finishSave;
  const workspace = host({ onNavigate: () => new Promise(resolve => { finishSave = resolve; }) });
  const request = handoff.navigate(workspace, 'settings');
  assert.equal(handoff.navigating, true);
  assert.equal(handoff.pending, null);
  assert.equal(handoff.consume('settings', workspace.enabledAreas), null, 'rendering a destination before the guard resolves cannot start a tour');
  finishSave(true);
  assert.equal(await request, true);
  assert.equal(handoff.pending, 'settings');
  assert.equal(handoff.consume('design', workspace.enabledAreas), null);
  assert.equal(handoff.pending, 'settings');
  assert.equal(handoff.consume('settings', workspace.enabledAreas), 'settings');
  assert.equal(handoff.consume('settings', workspace.enabledAreas), null);
  assert.equal(createWorkspaceOnboardingHandoff().pending, null, 'reloads never replay a queued host tour');
});

test('cancelled or failed save guards never queue another area', async () => {
  const handoff = createWorkspaceOnboardingHandoff();
  assert.equal(await handoff.navigate(host({ onNavigate: async () => false }), 'settings'), false);
  assert.equal(handoff.pending, null);
  await assert.rejects(handoff.navigate(host({ onNavigate: async () => { throw new Error('Unsaved draft'); } }), 'settings'), /Unsaved draft/);
  assert.equal(handoff.pending, null);
  assert.equal(handoff.navigating, false);
});

test('closing or explicitly reopening the guide invalidates an in-flight handoff', async () => {
  const handoff = createWorkspaceOnboardingHandoff();
  let finishSave;
  const request = handoff.navigate(host({ onNavigate: () => new Promise(resolve => { finishSave = resolve; }) }), 'settings');
  handoff.clear();
  finishSave(true);
  assert.equal(await request, false);
  assert.equal(handoff.pending, null);
  assert.equal(handoff.navigating, false);
});

test('ordinary area changes during a guide reuse its handoff while unavailable extensions stay hidden', async () => {
  const handoff = createWorkspaceOnboardingHandoff();
  const workspace = host();
  assert.equal(handoff.queue('settings', workspace.enabledAreas), true);
  assert.equal(handoff.consume('settings', workspace.enabledAreas), 'settings');
  let navigated = false;
  assert.equal(await handoff.navigate(host({ onNavigate: async () => { navigated = true; return true; } }), 'localization'), false);
  assert.equal(navigated, false);
  assert.equal(handoff.queue('localization', ['design', 'settings', 'localization']), true);
  assert.equal(handoff.consume('localization', workspace.enabledAreas), null, 'deactivating Localization before mount cancels its pending tour');
  assert.equal(handoff.pending, null);
});

test('concurrent requests cannot replace an unacknowledged save handoff', async () => {
  const handoff = createWorkspaceOnboardingHandoff();
  let finishSave;
  const workspace = host({ enabledAreas: ['design', 'settings', 'localization'], onNavigate: () => new Promise(resolve => { finishSave = resolve; }) });
  const request = handoff.navigate(workspace, 'settings');
  assert.equal(await handoff.navigate(workspace, 'localization'), false);
  assert.equal(handoff.queue('design', workspace.enabledAreas), false);
  finishSave(true);
  assert.equal(await request, true);
  assert.equal(handoff.consume('settings', workspace.enabledAreas), 'settings');
});

test('host tour progress is scoped to the workspace and independent of WordPress user preferences', () => {
  const key = createWorkspaceOnboardingStorageKey('https://studio.test/app/', 'project-one');
  assert.equal(key, createWorkspaceOnboardingStorageKey('https://studio.test/app/?view=settings#seo', 'project-one'));
  assert.equal(key, createWorkspaceOnboardingStorageKey('https://studio.test/app/index.html?view=settings', 'project-one'));
  assert.notEqual(key, createWorkspaceOnboardingStorageKey('https://studio.test/app/', 'project-two'));
  assert.notEqual(key, createWorkspaceOnboardingStorageKey('https://other.test/app/', 'project-one'));
  assert.notEqual(key, 'kodety:onboarding:https%3A%2F%2Fstudio.test%2Fapp:user:0');
  assert.equal(createWorkspaceOnboardingStorageKey('invalid', 'project-one'), '');
});
