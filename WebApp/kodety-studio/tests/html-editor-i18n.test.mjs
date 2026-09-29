import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let script;
let tours;
let english;
let portuguese;
before(async () => {
  const result = await build({ entryPoints: [path.join(root, 'WebApp/kodety-studio/src/html-editor-i18n.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', globalName: 'HtmlI18n', logLevel: 'silent' });
  script = result.outputFiles[0].text;
  const catalog = await build({ entryPoints: [path.join(root, 'lib/html-editor/onboarding-tours.ts')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  tours = (await import(`data:text/javascript;base64,${Buffer.from(catalog.outputFiles[0].text).toString('base64')}`)).ONBOARDING_TOURS;
  [english, portuguese] = await Promise.all(['en', 'pt-BR'].map(async locale => JSON.parse(await readFile(path.join(root, `Wordpress/kodety/languages/admin-ui/${locale}.json`), 'utf8'))));
});

// A small DOM fixture exercises the actual bundled WordPress runtime and JSON
// catalogs in Node. It does not launch/control a browser or replace translation.
function environment(readyState = 'complete') {
  let document;
  class Text {
    constructor(value) { this.nodeValue = value; this.nodeType = 3; this.parentElement = null; }
  }
  class Element {
    constructor(tag, attributes = {}) { this.tagName = tag.toUpperCase(); this.attributes = new Map(Object.entries(attributes)); this.childNodes = []; this.parentElement = null; this.dataset = {}; this.lang = ''; this.dir = ''; }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.childNodes.push(node); } return this; }
    matches(selector) {
      if (selector.startsWith('[')) { const [name, value] = selector.slice(1, -1).split('='); return value ? this.getAttribute(name) === value.replaceAll('"', '') : this.hasAttribute(name); }
      if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1);
      return this.tagName.toLowerCase() === selector.toLowerCase();
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (selector.split(',').some(item => node.matches(item.trim()))) return node; return null; }
    querySelectorAll() { return this.childNodes.filter(node => node instanceof Element).flatMap(node => [node, ...node.querySelectorAll()]); }
    getRootNode() { return document; }
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
  }
  class HTMLInputElement extends Element { constructor() { super('input'); this.type = 'text'; } }
  class DocumentFragment extends Element {}
  class Document {
    constructor() { this.documentElement = new Element('html'); this.documentElement.lang = 'en-US'; this.documentElement.dir = 'ltr'; this.body = new Element('body'); this.documentElement.append(this.body); this.readyState = readyState; this.listeners = new Map(); }
    querySelectorAll() { return [this.documentElement, ...this.documentElement.querySelectorAll()]; }
    querySelector(selector) { return this.querySelectorAll().find(node => selector.split(',').some(item => node.matches(item.trim()))) || null; }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
  }
  document = new Document();
  const observers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const calls = [];
  const nativeConfirm = value => { calls.push(value); return true; };
  const nativeTranslate = value => `old:${value}`;
  const window = { confirm: nativeConfirm, alert: nativeConfirm, prompt: nativeConfirm, kodetyTranslate: nativeTranslate };
  const context = { window, document, Element, Text, HTMLInputElement, DocumentFragment, Document, MutationObserver, Node: { TEXT_NODE: 3 } };
  vm.runInNewContext(script, context);
  return { ...context, mount: context.HtmlI18n.mountHtmlEditorI18n, observers, calls, nativeConfirm, nativeTranslate,
    label(value, attributes) { const text = new Text(value); const element = new Element('button', attributes); element.append(text); document.body.append(element); return { text, element }; },
  };
}

test('HTML uses the original WordPress catalog for labels, attributes, native dialogs and dynamic portals', () => {
  const env = environment();
  const control = env.label('Salvar agora', { title: 'Camadas' });
  const authored = env.label('Salvar', { 'data-kodety-no-i18n': '' });
  const code = new env.Element('code'); code.append(new env.Text('Salvar')); env.document.body.append(code);
  const stop = env.mount('en');
  assert.equal(control.text.nodeValue, 'Save now');
  assert.equal(control.element.getAttribute('title'), 'Layers');
  assert.equal(authored.text.nodeValue, 'Salvar');
  assert.equal(code.childNodes[0].nodeValue, 'Salvar');
  assert.equal(env.window.kodetyTranslate('Publicar'), 'Publish');
  assert.equal(env.window.kodetyFormatMessage('common.save'), 'Save');
  env.window.confirm('Salvar');
  assert.deepEqual(env.calls, ['Save']);
  const portal = env.label('Camadas');
  env.observers[0].callback([{ type: 'childList', addedNodes: [portal.element] }]);
  assert.equal(portal.text.nodeValue, 'Layers');
  stop();
});

test('language switching restores source and keeps one observer, then teardown restores all globals and owned DOM', () => {
  const env = environment();
  const control = env.label('Salvar agora', { title: 'Camadas' });
  const stopEnglish = env.mount('en');
  const englishObserver = env.observers[0];
  const stopPortuguese = env.mount('pt');
  assert.equal(englishObserver.disconnected, true);
  assert.equal(control.text.nodeValue, 'Salvar agora');
  assert.equal(control.element.getAttribute('title'), 'Camadas');
  assert.equal(env.window.kodetyTranslate('Save'), 'Salvar');
  assert.equal(env.document.documentElement.lang, 'pt-BR');
  stopEnglish(); // Stale React cleanup cannot stop the newer language runtime.
  assert.equal(env.observers[1].disconnected, false);
  stopPortuguese();
  assert.equal(env.observers[1].disconnected, true);
  assert.equal(env.window.confirm, env.nativeConfirm);
  assert.equal(env.window.kodetyTranslate, env.nativeTranslate);
  assert.equal(env.window.kodetyFormatMessage, undefined);
  assert.equal(env.window.__kodetyI18nDialogsTranslated, undefined);
  assert.equal(env.document.documentElement.lang, 'en-US');
  assert.equal(env.document.documentElement.dataset.kodetyUiLocale, undefined);
});

test('teardown preserves newer data and callbacks cannot mutate after exit', () => {
  const env = environment();
  const control = env.label('Salvar agora', { title: 'Camadas' });
  const stop = env.mount('en');
  control.text.nodeValue = 'My project name';
  control.element.setAttribute('title', 'New user data');
  stop();
  assert.equal(control.text.nodeValue, 'My project name');
  assert.equal(control.element.getAttribute('title'), 'New user data');
  const later = env.label('Salvar');
  env.observers[0].callback([{ type: 'childList', addedNodes: [later.element] }]);
  assert.equal(later.text.nodeValue, 'Salvar');
});

test('unmount before DOMContentLoaded cancels delayed observer and native-dialog installation', () => {
  const env = environment('loading');
  const stop = env.mount('en');
  const pending = env.document.listeners.get('DOMContentLoaded');
  assert.ok(pending);
  stop();
  assert.equal(env.document.listeners.has('DOMContentLoaded'), false);
  pending();
  assert.equal(env.observers.length, 0);
  assert.equal(env.window.confirm, env.nativeConfirm);
});

test('every tour and nested explanation has a full translation through the actual HTML runtime', () => {
  const env = environment();
  const phrases = new Set();
  const collect = item => {
    for (const field of ['title', 'description', 'tip']) if (item[field]) phrases.add(item[field]);
    for (const child of [...(item.steps || []), ...(item.details || [])]) collect(child);
  };
  tours.forEach(collect);
  const stopEnglish = env.mount('en');
  const controls = [...phrases].map(source => {
    assert.ok(Object.hasOwn(english.direct, source), `Missing complete English onboarding phrase: ${source}`);
    const control = env.label(source, { 'aria-label': source });
    env.observers[0].callback([{ type: 'childList', addedNodes: [control.element] }]);
    assert.equal(control.text.nodeValue, english.direct[source], source);
    assert.equal(control.element.getAttribute('aria-label'), english.direct[source], source);
    return { source, ...control };
  });
  const stopPortuguese = env.mount('pt');
  assert.deepEqual(controls.flatMap(({ source, text, element }) => {
    const expected = portuguese.direct[source] || source;
    return text.nodeValue === expected && element.getAttribute('aria-label') === expected ? [] : [{ source, actual: text.nodeValue }];
  }), [], 'Switching back to Portuguese must not reinterpret tour sentences as generic label templates');
  stopEnglish();
  stopPortuguese();
});

test('onboarding counts and completion fragments translate without mixed-language generic fallbacks', () => {
  const env = environment();
  const stop = env.mount('en');
  const translate = env.window.kodetyTranslate;
  assert.equal(translate('Até 23 etapas'), 'Up to 23 steps');
  assert.equal(translate('Até 14 etapas'), 'Up to 14 steps');
  assert.equal(translate('2 áreas para explorar'), '2 areas to explore');
  assert.equal(translate('1 de 2 áreas exploradas'), '1 of 2 areas explored');
  // React emits a text node on either side of the separately rendered tour title.
  const completion = ['Você conheceu os principais controles de', 'Builder e Design', '. Use o que aprendeu no projeto ou continue explorando.'].map(translate);
  assert.equal(completion.join(' ').replace(' .', '.'), 'You explored the main controls in Builder and Design. Use what you learned in your project or keep exploring.');
  stop();
});
