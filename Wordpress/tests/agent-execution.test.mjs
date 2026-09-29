import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-wordpress-agent-execution-'));
after(() => rm(scratch, { recursive: true, force: true }));
const entry = path.join(scratch, 'agent-execution.mjs');
await build({
  entryPoints: [path.join(root, 'Wordpress/editor/wordpress-agent-execution.ts')],
  outfile: entry,
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const { selectWordPressAgentExecution, wordpressAgentExecutionUrl, wordpressBrowserAgentSettingsUrl, wordpressBrowserAgentLicensed } = await import(pathToFileURL(entry).href);

function config(overrides = {}) {
  return {
    appView: 'editor',
    agentUrl: 'https://wordpress.test/wp-json/kodety/v1/agent',
    editorUrl: 'https://wordpress.test/kodety/editor/?project=project-7',
    settingsUrl: 'https://wordpress.test/kodety/settings/?project=project-7',
    product: { edition: 'pro', licensed: true, features: { ai: true }, limits: {}, upgradeUrl: '', licenseUrl: '' },
    nonce: 'fixture-nonce',
    ...overrides,
  };
}

function environment(pageUrl = 'https://wordpress.test/kodety/editor/?project=project-7', guard = async () => true) {
  const calls = [];
  return {
    calls,
    pageUrl,
    guard: async destination => { calls.push(['guard', destination]); return guard(destination); },
    writeCookie: cookie => calls.push(['cookie', cookie]),
    navigate: destination => calls.push(['navigate', destination]),
  };
}

test('a cancelled save guard leaves the preference and current page unchanged', async () => {
  const env = environment(undefined, async () => false);
  assert.equal(await selectWordPressAgentExecution('browser', config(), env), false);
  assert.deepEqual(env.calls, [['guard', 'https://wordpress.test/kodety/editor/?project=project-7&kodety_agent_settings=1&kodety_panel=agent&kodety_agent_runtime=webcontainer']]);
});

test('a failed save guard propagates its error without writing a cookie or navigating', async () => {
  const failure = new Error('The current project could not be saved.');
  const env = environment(undefined, async () => { throw failure; });
  await assert.rejects(selectWordPressAgentExecution('browser', config(), env), error => error === failure);
  assert.deepEqual(env.calls.map(([operation]) => operation), ['guard']);
});

test('the preference is written only after saving resolves, immediately before navigation', async () => {
  let finishSave;
  const env = environment(undefined, () => new Promise(resolve => { finishSave = resolve; }));
  const selecting = selectWordPressAgentExecution('browser', config(), env);
  await Promise.resolve();
  assert.deepEqual(env.calls.map(([operation]) => operation), ['guard'], 'pending saves must not change execution');
  finishSave(true);
  assert.equal(await selecting, true);
  assert.deepEqual(env.calls.map(([operation]) => operation), ['guard', 'cookie', 'navigate']);
  assert.equal(env.calls[0][1], env.calls[2][1], 'the saved destination must be the actual navigation destination');
});

test('browser and server persist matching query and cookie values, with Secure only on HTTPS', async () => {
  for (const [mode, persisted] of [['browser', 'webcontainer'], ['server', 'server']]) {
    for (const protocol of ['https:', 'http:']) {
      const env = environment(`${protocol}//wordpress.test/kodety/editor/?project=project-7`);
      assert.equal(await selectWordPressAgentExecution(mode, config(), env), true);
      assert.equal(env.calls[1][1], `kodety_agent_runtime=${persisted}; Path=/; SameSite=Lax; Max-Age=31536000${protocol === 'https:' ? '; Secure' : ''}`);
      const destination = new URL(env.calls[2][1]);
      assert.equal(destination.searchParams.get('kodety_agent_runtime'), persisted);
      assert.equal(destination.protocol, protocol);
    }
  }
});

test('browser selection in the editor retains the current document URL and requests the Agent dialog', () => {
  for (const appView of ['editor', undefined]) {
    const page = `https://wordpress.test/subsite/kodety/${appView || 'editor'}/?project=my-project&section=agents&filter=recent&kodety_agent_runtime=server#selection`;
    const destination = new URL(wordpressAgentExecutionUrl('browser', config({ appView }), page));
    assert.equal(destination.pathname, new URL(page).pathname);
    assert.equal(destination.searchParams.get('project'), 'my-project');
    assert.equal(destination.searchParams.get('section'), 'agents');
    assert.equal(destination.searchParams.get('filter'), 'recent');
    assert.deepEqual(destination.searchParams.getAll('kodety_agent_runtime'), ['webcontainer']);
    assert.equal(destination.searchParams.get('kodety_agent_settings'), '1');
    assert.equal(destination.searchParams.get('kodety_panel'), 'agent');
    assert.equal(destination.hash, '#selection');
  }
});

test('browser selection outside the editor opens its Agent dialog and preserves the selected project', () => {
  for (const appView of ['settings', 'cms', 'localization', 'templates', 'analytics', 'members', 'kodefy']) {
    const destination = new URL(wordpressAgentExecutionUrl('browser', config({
      appView,
      editorUrl: '/subsite/kodety/editor/?project=selected-project&filter=recent',
    }), `https://wordpress.test/subsite/kodety/${appView}/?project=selected-project`));
    assert.equal(destination.pathname, '/subsite/kodety/editor/');
    assert.equal(destination.searchParams.get('project'), 'selected-project');
    assert.equal(destination.searchParams.get('filter'), 'recent');
    assert.equal(destination.searchParams.get('kodety_agent_runtime'), 'webcontainer');
    assert.equal(destination.searchParams.get('kodety_agent_settings'), '1');
    assert.equal(destination.searchParams.get('kodety_panel'), 'agent');
  }
});

test('server selection retains the editor or Settings URL and uses the Agent section from other workspaces', () => {
  for (const appView of ['editor', 'settings', undefined]) {
    const page = `https://wordpress.test/subsite/kodety/${appView || 'editor'}/?project=my-project&section=agents&filter=recent#selection`;
    const destination = new URL(wordpressAgentExecutionUrl('server', config({ appView }), page));
    assert.equal(destination.pathname, new URL(page).pathname);
    assert.equal(destination.searchParams.get('project'), 'my-project');
    assert.equal(destination.searchParams.get('section'), 'agents');
    assert.equal(destination.searchParams.get('filter'), 'recent');
    assert.equal(destination.hash, '#selection');
    assert.equal(destination.searchParams.get('kodety_agent_runtime'), 'server');
    assert.equal(destination.searchParams.get('kodety_panel'), appView === 'settings' ? null : 'agent');
  }
  const destination = new URL(wordpressAgentExecutionUrl('server', config({ appView: 'cms' }), 'https://wordpress.test/kodety/cms/'));
  assert.equal(destination.pathname, '/kodety/settings/');
  assert.equal(destination.searchParams.get('section'), 'agents');
  assert.equal(destination.searchParams.get('project'), 'project-7');
});

test('the browser settings helper opens the Builder with its project and consumes no current Settings section', () => {
  const page = 'https://wordpress.test/kodety/settings/?section=agents';
  const destination = new URL(wordpressBrowserAgentSettingsUrl(config({ editorUrl: '/subsite/kodety/editor/?project=selected-project&filter=recent' }), page));
  assert.equal(destination.pathname, '/subsite/kodety/editor/');
  assert.equal(destination.searchParams.get('project'), 'selected-project');
  assert.equal(destination.searchParams.get('filter'), 'recent');
  assert.equal(destination.searchParams.get('section'), null);
  assert.equal(destination.searchParams.get('kodety_agent_runtime'), 'webcontainer');
  assert.equal(destination.searchParams.get('kodety_agent_settings'), '1');
  assert.equal(destination.searchParams.get('kodety_panel'), 'agent');
  assert.equal(new URL(wordpressBrowserAgentSettingsUrl(config({ editorUrl: undefined }), page)).pathname, '/kodety/editor/');
  assert.throws(() => wordpressBrowserAgentSettingsUrl(config({ editorUrl: 'https://other.test/kodety/editor/' }), page), /pertencer a este WordPress/);
});

test('workspaces without a Settings URL fall back to the editor URL, then the current page', () => {
  const pageUrl = 'https://wordpress.test/kodety/localization/?project=project-7';
  const editor = new URL(wordpressAgentExecutionUrl('server', config({ appView: 'localization', settingsUrl: undefined }), pageUrl));
  assert.equal(editor.pathname, '/kodety/editor/');
  assert.equal(editor.searchParams.get('project'), 'project-7');
  assert.equal(editor.searchParams.get('section'), 'agents');
  const current = new URL(wordpressAgentExecutionUrl('server', config({ appView: 'localization', settingsUrl: undefined, editorUrl: undefined }), pageUrl));
  assert.equal(current.pathname, '/kodety/localization/');
  assert.equal(current.searchParams.get('project'), 'project-7');
  assert.equal(current.searchParams.get('section'), 'agents');
});

test('an external browser or server destination is rejected before the guard or preference changes', async () => {
  for (const [mode, overrides] of [
    ['browser', { editorUrl: 'https://other.test/kodety/editor/' }],
    ['browser', { editorUrl: '//other.test/kodety/editor/' }],
    ['browser', { editorUrl: 'http://wordpress.test/kodety/editor/' }],
    ['server', { settingsUrl: 'https://other.test/kodety/settings/' }],
    ['server', { settingsUrl: '//other.test/kodety/settings/' }],
    ['server', { settingsUrl: 'http://wordpress.test/kodety/settings/' }],
    ['server', { settingsUrl: undefined, editorUrl: 'https://other.test/kodety/editor/' }],
  ]) {
    const env = environment('https://wordpress.test/kodety/cms/');
    await assert.rejects(selectWordPressAgentExecution(mode, config({ appView: 'cms', ...overrides }), env), /pertencer a este WordPress/);
    assert.deepEqual(env.calls, []);
  }
});

test('browser Agent access requires a licensed AI feature, an Agent endpoint and a private workspace', () => {
  assert.equal(wordpressBrowserAgentLicensed(config()), true);
  assert.equal(wordpressBrowserAgentLicensed(config({ share: { active: false } })), true);
  for (const candidate of [
    undefined,
    config({ product: undefined }),
    config({ product: { ...config().product, licensed: false } }),
    config({ product: { ...config().product, features: { ai: false } } }),
    config({ product: { ...config().product, features: {} } }),
    config({ product: { ...config().product, features: { ai: 1 } } }),
    config({ agentUrl: undefined }),
    config({ agentUrl: '' }),
    config({ share: { active: true, mode: 'view' } }),
    config({ share: { active: true, mode: 'edit' } }),
  ]) assert.equal(wordpressBrowserAgentLicensed(candidate), false);
});

test('both the core and separately loaded Languages entry mount the shared WordPress Agent provider', async () => {
  const [core, localization] = await Promise.all([
    readFile(path.join(root, 'Wordpress/editor/main.tsx'), 'utf8'),
    readFile(path.join(root, 'Wordpress/editor/localization-main.tsx'), 'utf8'),
  ]);
  for (const source of [core, localization]) {
    assert.match(source, /import\s+\{\s*WordPressAgentProvider\s*\}\s+from\s+['"]\.\/WordPressAgentProvider['"]/);
    assert.match(source, /<WordPressAgentProvider>[\s\S]*?<\/WordPressAgentProvider>/);
  }
  assert.match(core, /<WordPressAgentProvider>\s*\{workspace\}/);
  assert.match(localization, /<WordPressAgentProvider>\s*<WordPressLocalizationWorkspace\s*\/>/);
});
