import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const helperSource = await readFile(new URL('../../../lib/html-editor/onboarding-preview.ts', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../../../Wordpress/editor/WordPressBuilderOnboarding.tsx', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const helperCode = compile(helperSource);
const wrapperCode = compile(wrapperSource);

function environment(search = '') {
  let previewing = false;
  let mutationObserver;
  const root = {};
  const document = {
    documentElement: root,
    querySelector(selector) {
      assert.equal(selector, '[data-previewing="true"]');
      return previewing ? root : null;
    },
  };
  const window = new EventTarget();
  window.location = { search, href: `https://site.test/kodety/editor/${search}` };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; mutationObserver = this; }
    observe(target, options) {
      assert.equal(target, root);
      assert.equal(options.subtree, true);
      assert.equal(options.childList, true, 'preview roots may be inserted or removed during SPA navigation');
      assert.equal(options.attributes, true);
      assert.ok(options.attributeFilter.includes('data-previewing'));
      this.connected = true;
    }
    disconnect() { this.connected = false; }
  }
  const exports = {};
  new Function('exports', 'window', 'document', 'MutationObserver', helperCode)(exports, window, document, MutationObserver);
  return {
    ...exports, window, document,
    setPreviewing(value) {
      previewing = value;
      if (mutationObserver?.connected) mutationObserver.callback();
    },
    observer: () => mutationObserver,
  };
}

test('review requests suppress the guide before any canvas or WordPress configuration mounts', () => {
  for (const search of ['?kodety-preview-review=1', '?project=one&kodety-preview-review=1&view=html']) {
    const env = environment(search);
    assert.equal(env.builderOnboardingPreviewActive(), true);
  }
  for (const search of ['', '?kodety-preview-review=0', '?previewPage=about.html', '?project=preview']) {
    assert.equal(environment(search).builderOnboardingPreviewActive(), false);
  }
});

test('inline preview blocks an open guide and becomes available again on return to editing', () => {
  const env = environment();
  const snapshots = [];
  const unsubscribe = env.subscribeBuilderOnboardingPreview(() => snapshots.push(env.builderOnboardingPreviewActive()));
  assert.equal(env.builderOnboardingPreviewActive(), false);
  env.setPreviewing(true);
  env.setPreviewing(false);
  assert.deepEqual(snapshots, [true, false]);
  unsubscribe();
  assert.equal(env.observer().connected, false);
  env.setPreviewing(true);
  env.window.dispatchEvent(new Event('popstate'));
  assert.deepEqual(snapshots, [true, false], 'unmount removes mutation and location listeners');
});

test('history navigation rechecks review mode independently of the inline canvas marker', () => {
  const env = environment();
  const snapshots = [];
  const unsubscribe = env.subscribeBuilderOnboardingPreview(() => snapshots.push(env.builderOnboardingPreviewActive()));
  env.window.location.search = '?kodety-preview-review=1';
  env.window.dispatchEvent(new Event('popstate'));
  env.window.location.search = '';
  env.window.dispatchEvent(new Event('hashchange'));
  assert.deepEqual(snapshots, [true, false]);
  unsubscribe();
});

test('the same wrapper excludes both host adapters while preserving their normal editor selection', () => {
  const env = environment();
  let lazyLoads = 0;
  const exports = {};
  const require = id => {
    if (id === 'react') return {
      Component: class {},
      lazy: () => { lazyLoads++; return () => null; },
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    };
    if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (id.endsWith('/onboarding-preview')) return env;
    // Other adapter dependencies are intentionally never mounted here. A
    // preview must return before either adapter can read preferences, schedule
    // an invitation, attach manual-open listeners, or load the lazy guide.
    return {};
  };
  new Function('exports', 'require', 'window', wrapperCode)(exports, require, env.window);
  const render = exports.WordPressBuilderOnboarding;
  const config = { nonce: 'fixture' };
  const workspace = { id: 'html-one' };
  assert.equal(render({ config }).type.name, 'WordPressDocumentBuilderOnboarding');
  assert.equal(render({ workspace }).type.name, 'WorkspaceBuilderOnboarding');
  env.setPreviewing(true);
  assert.equal(render({ config }), null);
  assert.equal(render({ workspace }), null);
  env.setPreviewing(false);
  env.window.location.search = '?kodety-preview-review=1';
  assert.equal(render({ config }), null);
  assert.equal(render({ workspace }), null);
  assert.equal(lazyLoads, 1, 'the lazy component is declared once; no preview selects an adapter that could render it');
});

test('non-browser imports remain inert', () => {
  const exports = {};
  new Function('exports', helperCode)(exports);
  assert.equal(exports.builderOnboardingPreviewActive(), false);
  assert.doesNotThrow(exports.subscribeBuilderOnboardingPreview(() => assert.fail('no browser notification')));
});
