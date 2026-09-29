import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve('ChromeExtension/kodety-recorder');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const english = JSON.parse(await fs.readFile(path.join(root, '_locales/en/messages.json'), 'utf8'));
const portuguese = JSON.parse(await fs.readFile(path.join(root, '_locales/pt_BR/messages.json'), 'utf8'));

assert.equal(manifest.default_locale, 'en');
assert.deepEqual(Object.keys(portuguese).sort(), Object.keys(english).sort(), 'Chrome locale catalogs must have exact key parity.');
for (const [key, entry] of Object.entries(english)) {
  assert.equal(typeof entry.message, 'string', `English message ${key} must be a string.`);
  assert.ok(entry.message, `English message ${key} must not be empty.`);
  assert.deepEqual(
    Object.keys(portuguese[key].placeholders || {}).sort(),
    Object.keys(entry.placeholders || {}).sort(),
    `Chrome locale placeholders must match for ${key}.`,
  );
}

const manifestMessages = [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(match => match[1]);
for (const key of manifestMessages) assert.ok(english[key], `Manifest references missing message ${key}.`);

const popupHtml = await fs.readFile(path.join(root, 'popup.html'), 'utf8');
const runtimeFiles = ['background.js', 'offscreen.js', 'page-recorder.js', 'popup.js'];
const runtimeSources = await Promise.all(runtimeFiles.map(file => fs.readFile(path.join(root, file), 'utf8')));
const htmlKeys = [...popupHtml.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
const runtimeKeys = runtimeSources.flatMap(source => [
  ...source.matchAll(/\bmessage\('([^']+)'/g),
  ...source.matchAll(/\bi18nMessage\('([^']+)'/g),
  ...source.matchAll(/chrome\.i18n\.getMessage\('([^']+)'/g),
].map(match => match[1]));
for (const key of new Set([...htmlKeys, ...runtimeKeys])) {
  assert.ok(english[key], `Chrome runtime references missing English message ${key}.`);
  assert.ok(portuguese[key], `Chrome runtime references missing Portuguese message ${key}.`);
}

const englishPath = [popupHtml, ...runtimeSources].join('\n');
assert.doesNotMatch(
  englishPath,
  /\b(?:Não|Pronto|Gravando|Captura concluída|Compilar|Limpar gravação|Iniciar captura|Código|Aba ativa|Recarregue|gravação)\b/,
  'The extension English path must not contain fixed Portuguese UI copy.',
);
assert.match(popupHtml, /<html lang="en">/);
assert.match(runtimeSources[0], /const i18nMessage = key => chrome\.i18n\.getMessage/);
assert.doesNotMatch(runtimeSources[0], /const message = key =>/, 'The background translator must not be shadowed by the message event parameter.');
assert.match(
  runtimeSources[3],
  /eventCount === 1 \? 'eventCountOne' : 'eventCount'/,
  'Recorder counters must select singular locale messages when the count is one.',
);
assert.equal(english.eventCountOne.message, '$COUNT$ event');
assert.equal(portuguese.eventCountOne.message, '$COUNT$ evento');
assert.ok(htmlKeys.length >= 6, 'Popup static copy should use Chrome locale keys.');
assert.ok(runtimeKeys.length >= 15, 'Popup and background status copy should use Chrome locale keys.');

const [backgroundSource, offscreenSource, pageSource] = runtimeSources;
assert.deepEqual(manifest.host_permissions, ['<all_urls>'], 'Recorder host access must not expand beyond its existing capture scope.');
assert.equal(manifest.content_scripts.length, 1, 'The recorder must use one isolated content script.');
assert.deepEqual(manifest.content_scripts[0].js, ['page-recorder.js']);
assert.equal(manifest.content_scripts[0].world, 'ISOLATED');
assert.doesNotMatch(JSON.stringify(manifest), /content-script\.js|"world":"MAIN"/);
await assert.rejects(fs.access(path.join(root, 'content-script.js')), error => error?.code === 'ENOENT');
assert.doesNotMatch(runtimeSources.join('\n'), /window\.postMessage|MessageChannel|KODETY_BRIDGE_INIT/);
assert.doesNotMatch(pageSource, /__KODETY_INTERACTION_RECORDER__/);
assert.match(pageSource, /chrome\.runtime\.onMessage\.addListener/);
assert.match(pageSource, /requestAnimationFrame\(scanFrame\)/, 'Animation discovery must scan every rendered frame.');
assert.doesNotMatch(pageSource, /Element\.prototype\.animate\s*=|setInterval\(/, 'The isolated recorder must not pretend to patch MAIN-world animations.');
assert.match(pageSource, /earlyAnimations\.length = 0;\s*earlyAnimationKeys\.clear\(\)/, 'The pre-start buffer must be drained after import.');
assert.doesNotMatch(backgroundSource, /\bfetch\s*\(|downloadStylesheets|downloadOriginalHtml|isPublicHttpUrl/, 'The service worker must not refetch page resources.');
assert.match(backgroundSource, /chrome\.downloads\.cancel\(downloadId\)/, 'A download that starts after its deadline must be cancelled.');
assert.match(backgroundSource, /MAX_OFFSCREEN_MESSAGE_BYTES = 48 \* 1024 \* 1024/);
assert.match(backgroundSource, /MAX_MHTML_BYTES = 4 \* 1024 \* 1024/);
assert.match(offscreenSource, /isValidBuildMessage\(message\)/, 'The ZIP builder must validate payload shape and size.');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.classList = { add() {} };
    this.hidden = false;
    this.id = '';
    this.isConnected = true;
    this.textContent = '';
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  querySelectorAll() { return []; }
  closest() { return null; }
}

const origin = 'https://capture.example';
const location = { protocol: 'https:', origin, href: `${origin}/page`, hostname: 'capture.example' };
const documentElement = new FakeElement('html');
documentElement.innerHTML = '';
documentElement.outerHTML = '<html><head></head><body>capture</body></html>';
const makeAnimation = label => {
  const target = new FakeElement('div');
  target.textContent = label;
  return {
    effect: {
      target,
      getKeyframes: () => [{ opacity: '0', offset: 0 }, { opacity: '1', offset: 1 }],
      getTiming: () => ({ duration: 16, easing: 'linear', iterations: 1, fill: 'none', direction: 'normal' }),
      getComputedTiming: () => ({ duration: 16 }),
    },
  };
};
const oneFrameAnimation = makeAnimation('ephemeral-before-start');
const persistentAnimations = Array.from({ length: 251 }, (_value, index) => makeAnimation(`persistent-${index}`));
let animationRead = 0;
const documentMock = {
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getAnimations: () => {
    animationRead++;
    if (animationRead === 1) return [];
    if (animationRead === 2) return [oneFrameAnimation, ...persistentAnimations];
    return persistentAnimations;
  },
  styleSheets: [],
  documentElement,
  body: new FakeElement('body'),
  title: 'Capture',
  readyState: 'complete',
};
const makeNode = () => ({
  dataset: {},
  appendChild() {},
  insertBefore() {},
  querySelector: () => ({}),
  querySelectorAll: () => [],
  setAttribute() {},
});
class FakeDomParser {
  parseFromString(source) {
    const head = makeNode();
    const clone = makeNode();
    clone.outerHTML = source.replace(/^<!doctype html>/i, '');
    clone.querySelector = selector => selector === 'head' ? head : null;
    return { documentElement: clone, createElement: makeNode };
  }
}

let recorderMessageListener;
const recorderRuntimeMessages = [];
let nextAnimationFrameId = 0;
const animationFrames = new Map();
const requestAnimationFrameMock = callback => {
  const id = ++nextAnimationFrameId;
  animationFrames.set(id, callback);
  return id;
};
const cancelAnimationFrameMock = id => animationFrames.delete(id);
const runAnimationFrame = () => {
  const pending = [...animationFrames.values()];
  animationFrames.clear();
  pending.forEach(callback => callback(performance.now()));
};
const chromeMock = {
  i18n: { getMessage: key => english[key]?.message || key },
  runtime: {
    id: 'extension-test-id',
    onMessage: { addListener: listener => { recorderMessageListener = listener; } },
    sendMessage: async message => {
      recorderRuntimeMessages.push(message);
      return message.type === 'KODETY_BACKGROUND_CONTENT_READY' ? { recording: false } : { ok: true };
    },
  },
};
const pageContext = vm.createContext({
  location,
  document: documentMock,
  performance: { getEntriesByType: () => [] },
  chrome: chromeMock,
  Element: FakeElement,
  MutationObserver: class { observe() {} disconnect() {} },
  DOMParser: FakeDomParser,
  CSS: { escape: value => value },
  TextEncoder,
  URL,
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  scrollX: 0,
  scrollY: 0,
  addEventListener() {},
  getComputedStyle: () => ({}),
  setTimeout: () => 1,
  clearTimeout() {},
  requestAnimationFrame: requestAnimationFrameMock,
  cancelAnimationFrame: cancelAnimationFrameMock,
  queueMicrotask,
});
vm.runInContext(pageSource, pageContext, { filename: 'page-recorder.js' });
assert.equal(typeof recorderMessageListener, 'function', 'The isolated recorder must register its runtime command listener.');
assert.ok(recorderRuntimeMessages.some(message => message.type === 'KODETY_BACKGROUND_CONTENT_READY'));

function recorderCommand(type, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}.`)), 1_000);
    const keepAlive = recorderMessageListener({ type, payload }, { id: chromeMock.runtime.id }, response => {
      clearTimeout(timer);
      resolve(response);
    });
    assert.equal(keepAlive, true, `${type} must keep the response channel open.`);
  });
}

assert.equal(recorderMessageListener({ type: 'KODETY_CONTENT_STATUS' }, { id: 'foreign-extension' }, () => {}), false);
assert.equal(recorderMessageListener({ type: 'KODETY_CONTENT_START', payload: { resume: 'yes' } }, { id: chromeMock.runtime.id }, () => {}), false);
assert.equal((await recorderCommand('KODETY_CONTENT_STATUS')).state, 'idle');
assert.equal(animationRead, 1, 'The document-start buffer must scan immediately while idle.');
runAnimationFrame();
assert.equal(animationRead, 2, 'The short animation must exist only on the next rendered-frame read.');
runAnimationFrame();
assert.equal(animationRead, 3, 'The short animation must disappear before recording starts.');
const started = await recorderCommand('KODETY_CONTENT_START', { resume: true });
assert.equal(started.state, 'recording');
assert.equal(started.animations, 252, 'Starting must import the 250-item buffer, retain the ephemeral animation, and recover active overflow.');
assert.equal((await recorderCommand('KODETY_CONTENT_STATUS')).animations, 252, 'An animation visible for one rendered frame must be captured.');
assert.equal((await recorderCommand('KODETY_CONTENT_STOP')).state, 'stopped');
assert.equal(animationFrames.size, 0, 'Stopping must cancel the scheduled animation scan.');
const animationRecording = await recorderCommand('KODETY_CONTENT_EXPORT');
assert.equal(animationRecording.manifest.animations.length, 252, 'The one-frame animation and the 251st active animation must be exported.');
assert.equal((await recorderCommand('KODETY_CONTENT_CLEAR')).state, 'idle');
assert.equal((await recorderCommand('KODETY_CONTENT_START')).state, 'recording');
assert.ok(animationFrames.size > 0);
assert.equal((await recorderCommand('KODETY_CONTENT_CLEAR')).state, 'idle');
assert.equal(animationFrames.size, 0, 'Clearing while recording must cancel the scheduled animation scan.');

const recording = await recorderCommand('KODETY_CONTENT_EXPORT');
assert.deepEqual([...recording.stylesheetUrls], [], 'Captured HTML must retain its own remote links without privileged CSS downloads.');
documentElement.outerHTML = `<html><body>${'x'.repeat(12_000_001)}</body></html>`;
const oversized = await recorderCommand('KODETY_CONTENT_EXPORT');
assert.equal(oversized.error, english.capturePayloadTooLarge.message, 'Oversized captures must fail closed with an actionable error.');

const localCapture = {
  html: '<!doctype html><html><head><link rel="stylesheet" href="http://127.0.0.1/private.css"></head><body></body></html>',
  css: '',
  responsiveCss: '',
  runtime: '',
  stylesheetUrls: ['http://127.0.0.1/private.css', 'https://cdn.example.com/public.css'],
  manifest: {
    page: { url: 'http://localhost:3000/page', hostname: 'localhost', platform: 'code' },
  },
  framerManifest: {},
};
let backgroundMessageListener;
let offscreenRequest;
let remoteFetchCalls = 0;
const backgroundContext = vm.createContext({
  chrome: {
    i18n: { getMessage: key => english[key]?.message || key },
    runtime: {
      id: chromeMock.runtime.id,
      lastError: null,
      getURL: file => `chrome-extension://${chromeMock.runtime.id}/${file}`,
      getContexts: async () => [],
      onMessage: { addListener: listener => { backgroundMessageListener = listener; } },
      sendMessage: async message => {
        offscreenRequest = message;
        return { ok: true, url: 'blob:extension-test', filename: 'capture.zip' };
      },
    },
    tabs: {
      sendMessage: async (_tabId, message) => {
        if (message.type === 'KODETY_CONTENT_EXPORT') return structuredClone(localCapture);
        return null;
      },
      get: async () => ({ id: 7, url: localCapture.manifest.page.url }),
      onRemoved: { addListener() {} },
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    pageCapture: { saveAsMHTML: (_options, callback) => callback(null) },
    downloads: {
      download: (_options, callback) => callback(42),
      cancel: async () => {},
    },
    offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  },
  fetch: () => {
    remoteFetchCalls++;
    throw new Error('The service worker must not perform remote fetches.');
  },
  TextEncoder,
  Uint8Array,
  URL,
  setTimeout,
  clearTimeout,
});
vm.runInContext(backgroundSource, backgroundContext, { filename: 'background.js' });
assert.equal(typeof backgroundMessageListener, 'function');
const exported = await vm.runInContext('exportCapture(7)', backgroundContext);
assert.equal(exported.ok, true);
assert.equal(exported.downloadId, 42);
assert.equal(remoteFetchCalls, 0, 'Exporting localhost with private stylesheet URLs must not trigger a privileged fetch.');
assert.equal(offscreenRequest.payload.externalCss, '');
assert.equal(offscreenRequest.payload.originalHtml, '');
assert.match(offscreenRequest.payload.html, /http:\/\/127\.0\.0\.1\/private\.css/);

backgroundContext.utf8Value = { text: 'é'.repeat(8) };
assert.equal(
  vm.runInContext('jsonByteLength(utf8Value)', backgroundContext),
  Buffer.byteLength(JSON.stringify(backgroundContext.utf8Value), 'utf8'),
  'Message budgets must count UTF-8 bytes instead of JavaScript characters.',
);

const transportPayload = {
  html: '<html></html>',
  css: '',
  externalCss: '',
  responsiveCss: '',
  runtime: '',
  originalHtml: '',
  stylesheetUrls: [],
  manifest: { page: { url: 'http://localhost:3000/page', hostname: 'localhost', platform: 'code' } },
  framerManifest: {},
};
const emptyEnvelope = { type: 'KODETY_OFFSCREEN_BUILD_ZIP', payload: transportPayload, mhtml: null };
const tightTransportBudget = Buffer.byteLength(JSON.stringify(emptyEnvelope), 'utf8');
backgroundContext.transportPayload = transportPayload;
backgroundContext.smallMhtml = new Uint8Array(64).fill(255);
backgroundContext.tightTransportBudget = tightTransportBudget;
const budgetedMessage = vm.runInContext(
  'buildOffscreenMessage(transportPayload, smallMhtml, tightTransportBudget)',
  backgroundContext,
);
assert.equal(budgetedMessage.mhtml, null, 'MHTML must be omitted when the combined envelope would exceed its byte budget.');
let rejectedOversizedEnvelope = false;
try {
  vm.runInContext('buildOffscreenMessage(transportPayload, null, tightTransportBudget - 1)', backgroundContext);
} catch (error) {
  rejectedOversizedEnvelope = true;
  assert.equal(error.message, english.invalidCapturePayload.message);
}
assert.equal(rejectedOversizedEnvelope, true, 'A payload that cannot fit without MHTML must fail with an actionable error.');

backgroundContext.oversizedMhtml = new Uint8Array((4 * 1024 * 1024) + 1);
assert.equal(
  vm.runInContext('buildOffscreenMessage(transportPayload, oversizedMhtml).mhtml', backgroundContext),
  null,
  'MHTML larger than 4 MiB must never be converted to a JSON number array.',
);

let offscreenMessageListener;
const offscreenContext = vm.createContext({
  chrome: {
    i18n: { getMessage: key => english[key]?.message || key },
    runtime: {
      id: chromeMock.runtime.id,
      onMessage: { addListener: listener => { offscreenMessageListener = listener; } },
    },
  },
  TextEncoder,
  Uint8Array,
  Blob,
  URL,
  setTimeout,
});
vm.runInContext(offscreenSource, offscreenContext, { filename: 'offscreen.js' });
assert.equal(typeof offscreenMessageListener, 'function');
offscreenContext.emptyEnvelope = emptyEnvelope;
offscreenContext.envelopeWithMhtml = { ...emptyEnvelope, mhtml: Array(64).fill(255) };
offscreenContext.tightTransportBudget = tightTransportBudget;
assert.equal(vm.runInContext('isValidBuildMessage(emptyEnvelope, tightTransportBudget)', offscreenContext), true);
assert.equal(
  vm.runInContext('isValidBuildMessage(envelopeWithMhtml, tightTransportBudget)', offscreenContext),
  false,
  'The offscreen document must independently reject an oversized combined envelope.',
);

console.log(`Chrome extension checks passed: ${Object.keys(english).length} locale messages plus isolated runtime, frame animation, no-refetch, and transport guards.`);
