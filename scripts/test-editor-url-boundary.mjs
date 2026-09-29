import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { updateUrlQueryParam } from '../lib/browser/update-url-query-param.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const helperPath = path.join(root, 'lib/browser/update-url-query-param.ts');
const storePath = path.join(root, 'stores/useEditorStore.ts');
const hookPath = path.join(root, 'hooks/use-editor-url.ts');
const helperSource = readFileSync(helperPath, 'utf8');
const storeSource = readFileSync(storePath, 'utf8');
const hookSource = readFileSync(hookPath, 'utf8');

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function restoreWindow() {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
}

function installBrowser({ pathname, search, state }) {
  const calls = [];
  const location = { pathname, search };
  const history = {
    state,
    replaceState(nextState, title, url) {
      calls.push({ state: nextState, title, url });
      this.state = nextState;
      const nextUrl = new URL(url, 'https://editor.test');
      location.pathname = nextUrl.pathname;
      location.search = nextUrl.search;
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { history, location },
    writable: true,
  });

  return { calls, history, location };
}

try {
  Reflect.deleteProperty(globalThis, 'window');
  assert.doesNotThrow(
    () => updateUrlQueryParam('layer', 'hero'),
    'SSR calls must be a no-op',
  );

  const preservedState = { editor: 'design', nested: { revision: 7 } };
  const setBrowser = installBrowser({
    pathname: '/kodety/pages/home',
    search: '?view=desktop&layer=old',
    state: preservedState,
  });
  updateUrlQueryParam('layer', 'hero section');
  assert.equal(setBrowser.calls.length, 1, 'a changed value must replace the URL once');
  assert.deepEqual(setBrowser.calls[0], {
    state: preservedState,
    title: '',
    url: '/kodety/pages/home?view=desktop&layer=hero+section',
  });
  assert.notEqual(
    setBrowser.calls[0].state,
    preservedState,
    'replaceState must retain the existing shallow-clone behavior',
  );
  assert.equal(
    setBrowser.calls[0].state.nested,
    preservedState.nested,
    'history.state contents must be preserved',
  );

  const equalBrowser = installBrowser({
    pathname: '/kodety/pages/home',
    search: '?layer=hero',
    state: { revision: 8 },
  });
  updateUrlQueryParam('layer', 'hero');
  assert.equal(equalBrowser.calls.length, 0, 'an equal value must not touch history');

  const absentBrowser = installBrowser({
    pathname: '/kodety/pages/home',
    search: '?view=tablet',
    state: { revision: 9 },
  });
  updateUrlQueryParam('layer', null);
  assert.equal(absentBrowser.calls.length, 0, 'null must be a no-op when the key is absent');

  for (const value of [null, undefined, '']) {
    const deleteBrowser = installBrowser({
      pathname: '/kodety/pages/home',
      search: '?view=mobile&layer=hero',
      state: { value },
    });
    updateUrlQueryParam('layer', value);
    assert.equal(deleteBrowser.calls.length, 1, `${String(value)} must delete an existing key`);
    assert.equal(deleteBrowser.calls[0].url, '/kodety/pages/home?view=mobile');
    assert.deepEqual(deleteBrowser.calls[0].state, { value });
  }
} finally {
  restoreWindow();
}

assert.match(
  storeSource,
  /import \{ updateUrlQueryParam \} from ['"]@\/lib\/browser\/update-url-query-param['"];/,
  'the editor store must import the pure browser helper directly',
);
assert.doesNotMatch(
  storeSource,
  /(?:hooks\/use-editor-url|next\/navigation)/,
  'the editor store must not retain a Next or hook import edge',
);

assert.match(
  helperSource,
  /export function updateUrlQueryParam\([\s\S]*?typeof window === 'undefined'[\s\S]*?window\.history\.replaceState/,
  'the pure helper must own the SSR-safe browser implementation',
);
assert.doesNotMatch(
  helperSource,
  /^\s*import\s|\b(?:next\/navigation|React|react|hooks\/|stores\/)\b/m,
  'the pure helper must not import Next, React, hooks or stores',
);

assert.match(
  hookSource,
  /from ['"]next\/navigation['"]/,
  'the editor URL hook must remain the owner of Next navigation hooks',
);
assert.match(
  hookSource,
  /from ['"]react['"]/,
  'the editor URL hook must retain its React hook boundary',
);
assert.doesNotMatch(
  hookSource,
  /(?:export\s+)?function\s+updateUrlQueryParam|lib\/browser\/update-url-query-param/,
  'the editor URL hook must not duplicate or re-export the browser helper',
);

console.log('Editor URL runtime boundary passed.');
