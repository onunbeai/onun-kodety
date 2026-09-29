import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': root } },
});

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  tokens() {
    return (this.element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  }

  contains(name) {
    return this.tokens().includes(name);
  }

  add(name) {
    this.element.setAttribute('class', [...new Set([...this.tokens(), name])].join(' '));
  }

  remove(name) {
    this.element.setAttribute('class', this.tokens().filter(token => token !== name).join(' '));
  }

  toggle(name) {
    if (this.contains(name)) this.remove(name);
    else this.add(name);
  }
}

class FakeElement {
  constructor(tagName, attributes = {}, innerHTML = '') {
    this.tagName = tagName.toUpperCase();
    this.attributeMap = new Map(Object.entries(attributes));
    this.innerHTML = innerHTML;
    this.style = {};
    this.classList = new FakeClassList(this);
    this.childNodes = [];
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.dispatchedEvents = [];
  }

  get attributes() {
    return [...this.attributeMap].map(([name, value]) => ({ name, value }));
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  getAttribute(name) {
    return this.attributeMap.has(name) ? this.attributeMap.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributeMap.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributeMap.delete(name);
  }

  hasAttribute(name) {
    return this.attributeMap.has(name);
  }

  matches(selector) {
    if (selector === '[data-kodety-component-id]') {
      return this.hasAttribute('data-kodety-component-id');
    }
    if (selector === '.target') return this.classList.contains('target');
    const attribute = selector.match(/^\[([:\w-]+)="([^"]*)"\]$/);
    if (attribute) return this.getAttribute(attribute[1]) === attribute[2];
    return false;
  }

  closest(selector) {
    if (selector === '[data-kodety-ticker-clone]') return null;
    if (selector === '[data-kodety-component-id]') {
      return this.hasAttribute('data-kodety-component-id') ? this : null;
    }
    return null;
  }

  contains(element) {
    return element === this;
  }

  querySelectorAll() {
    return [];
  }

  dispatchEvent(event) {
    this.dispatchedEvents.push(event);
    return true;
  }
}

function parseTemplateElement(markup) {
  const match = markup.trim().match(/^<([a-z][\w-]*)([^>]*)>([\s\S]*)<\/\1>$/i);
  if (!match) return null;
  const attributes = {};
  for (const attribute of match[2].matchAll(/([:\w-]+)(?:\s*=\s*"([^"]*)")?/g)) {
    attributes[attribute[1]] = attribute[2] || '';
  }
  return new FakeElement(match[1], attributes, match[3]);
}

class FakeDocument {
  constructor(element, registry = { version: 1, components: [] }) {
    this.element = element;
    this.registry = registry;
    this.readyState = 'complete';
    this.listeners = new Map();
    this.body = new FakeElement('body');
    this.head = { append() {} };
    this.documentElement = { getBoundingClientRect() { return {}; } };
  }

  querySelector(selector) {
    if (selector === 'script[data-kodety-component-registry]') {
      return { textContent: JSON.stringify(this.registry) };
    }
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return this.element.matches(selector) ? [this.element] : [];
  }

  createElement(tagName) {
    if (tagName !== 'template') return new FakeElement(tagName);
    const template = { content: { firstElementChild: null } };
    Object.defineProperty(template, 'innerHTML', {
      set(value) {
        template.content.firstElementChild = parseTemplateElement(value);
      },
    });
    return template;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
}

function applyValues(elements, values) {
  const ignored = new Set([
    'duration', 'ease', 'repeat', 'repeatDelay', 'yoyo', 'stagger',
  ]);
  for (const element of elements) {
    for (const [name, value] of Object.entries(values || {})) {
      if (!ignored.has(name)) element.style[name] = value;
    }
  }
}

class FakeTimeline {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
    this.tracks = [];
    this.currentTime = 0;
    this.span = 0;
    this.onUpdate = null;
    this.killed = false;
    this.lastProgressSuppressed = null;
  }

  fromTo(elements, from, to, start = 0) {
    applyValues(elements, from);
    const duration = Number(to.duration) || 0;
    this.tracks.push({ elements, from, to, start, end: start + duration });
    this.span = Math.max(this.span, start + duration);
    return this;
  }

  to(elements, to, start = 0) {
    const duration = Number(to.duration) || 0;
    this.tracks.push({ elements, from: {}, to, start, end: start + duration });
    this.span = Math.max(this.span, start + duration);
    return this;
  }

  set(elements, values, start = 0) {
    this.tracks.push({ elements, from: {}, to: values, start, end: start });
    this.span = Math.max(this.span, start);
    return this;
  }

  call(callback, _params, start = 0) {
    this.calls.push({ callback, start });
    this.span = Math.max(this.span, start);
    return this;
  }

  eventCallback(name, callback) {
    if (name === 'onUpdate') this.onUpdate = callback;
    return this;
  }

  totalTime(value, suppressEvents = false) {
    if (value === undefined) return this.currentTime;
    const previous = this.currentTime;
    this.currentTime = value;
    for (const track of this.tracks) {
      if (value >= track.end) applyValues(track.elements, track.to);
      else if (value <= track.start) applyValues(track.elements, track.from);
    }
    if (!suppressEvents) {
      const callbacks = value >= previous
        ? this.calls.filter(item => item.start >= previous && item.start <= value)
        : this.calls.filter(item => item.start >= value && item.start < previous).reverse();
      callbacks.forEach(item => item.callback());
    }
    this.onUpdate?.();
    return this;
  }

  progress(value, suppressEvents = false) {
    if (value === undefined) return this.span ? this.currentTime / this.span : 0;
    this.lastProgressSuppressed = suppressEvents;
    return this.totalTime(this.span * value, suppressEvents);
  }

  totalDuration() {
    return this.span;
  }

  duration() {
    return this.span;
  }

  time() {
    return this.currentTime;
  }

  iteration() {
    return 1;
  }

  reversed() {
    return false;
  }

  pause(value) {
    if (value !== undefined) this.totalTime(value, false);
    return this;
  }

  play() {
    return this;
  }

  restart() {
    this.totalTime(0, false);
    return this;
  }

  reverse() {
    this.totalTime(0, false);
    return this;
  }

  kill() {
    this.killed = true;
  }
}

function createFakeGsap() {
  const timelines = [];
  return {
    timelines,
    timeline(options) {
      const timeline = new FakeTimeline(options);
      timelines.push(timeline);
      return timeline;
    },
    set(elements, values) {
      applyValues(elements, values);
    },
    to(elements, values) {
      applyValues(Array.isArray(elements) ? elements : [elements], values);
      return { kill() {} };
    },
    core: { getCache() { return null; } },
  };
}

function interactionRuntime(compiled) {
  const match = compiled.match(
    /<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/,
  );
  assert.ok(match, 'compiled interaction runtime must exist');
  return match[1];
}

function executeInteractionRuntime(code, document, motionEngine, options = {}) {
  const window = {
    __ONUN_MOTION_ENGINE__: motionEngine,
    __KODETY_EDITOR_MOTION_FROZEN__: Boolean(options.frozen),
    __KODETY_ACTIVE_INTERACTION_PREVIEW__: '',
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_POST_EDITOR_MESSAGE__() {},
    setTimeout,
    clearTimeout,
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    performance: { now() { return 0; } },
    addEventListener() {},
    removeEventListener() {},
    scrollY: 0,
    pageYOffset: 0,
  };
  const CustomEvent = class {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  new Function(
    'window',
    'document',
    'innerWidth',
    'innerHeight',
    'matchMedia',
    'CustomEvent',
    code,
  )(
    window,
    document,
    1200,
    800,
    () => ({ matches: Boolean(options.reducedMotion) }),
    CustomEvent,
  );
  return window;
}

try {
  const interactions = await server.ssrLoadModule('/lib/html-editor/interactions.ts');

  const classAction = {
    ...interactions.createInteractionAction('class-toggle'),
    id: 'toggle-hero',
    className: 'hero is-open hero-alt',
    target: {
      selector: ':is(.hero,.other) > [data-note=".hero"] .heroine /* .hero */ .h\\65 ro',
      label: 'Human target',
      scope: 'document',
      mode: 'selector',
    },
  };
  const timelineInteraction = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'rename-timeline',
    name: 'Rename timeline',
    trigger: 'click',
    triggerSelector: '.hero',
    triggerLabel: '.hero',
    triggerTargetMode: 'class',
    scrollTriggerSelector: '.hero .sentinel',
    scrollTriggerLabel: '.hero .sentinel',
    customCode: 'document.querySelector(".hero")',
    actions: [classAction],
  };
  const behaviorInteraction = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'rename-behavior',
    name: 'Rename behavior',
    trigger: 'scroll',
    triggerSelector: '.other',
    triggerLabel: 'Other',
    triggerTargetMode: 'class',
    actions: [],
    behavior: {
      kind: 'video-scrub',
      target: {
        selector: '.hero',
        label: '.hero',
        scope: 'document',
        mode: 'class',
      },
      startTime: 0,
      endTime: 2,
      smoothing: 0.1,
      viewportAnchor: 0.5,
      milestones: [{
        id: 'chapter',
        selector: '.hero .chapter',
        label: '.hero .chapter',
        value: 1,
        elementAnchor: 0,
        viewportAnchor: 0.5,
        offsetPx: 0,
      }],
    },
  };
  const renameDocument = {
    version: 2,
    canonical: true,
    interactions: [timelineInteraction, behaviorInteraction],
  };
  const beforeRename = JSON.stringify(renameDocument);
  const renamed = interactions.renameInteractionClassReferences(
    renameDocument,
    'hero',
    'banner',
  );
  assert.equal(JSON.stringify(renameDocument), beforeRename, 'rename must be pure');
  assert.notStrictEqual(renamed, renameDocument);
  assert.equal(renamed.interactions[0].triggerSelector, '.banner');
  assert.equal(renamed.interactions[0].triggerLabel, '.banner');
  assert.equal(renamed.interactions[0].scrollTriggerSelector, '.banner .sentinel');
  assert.equal(renamed.interactions[0].scrollTriggerLabel, '.banner .sentinel');
  assert.equal(
    renamed.interactions[0].actions[0].target.selector,
    ':is(.banner,.other) > [data-note=".hero"] .heroine /* .hero */ .banner',
  );
  assert.equal(renamed.interactions[0].actions[0].target.label, 'Human target');
  assert.equal(renamed.interactions[0].actions[0].className, 'banner is-open hero-alt');
  assert.equal(
    renamed.interactions[0].customCode,
    'document.querySelector(".hero")',
    'custom JavaScript must not be rewritten as CSS',
  );
  assert.equal(renamed.interactions[1].behavior.target.selector, '.banner');
  assert.equal(renamed.interactions[1].behavior.target.label, '.banner');
  assert.equal(renamed.interactions[1].behavior.milestones[0].selector, '.banner .chapter');
  assert.equal(renamed.interactions[1].behavior.milestones[0].label, '.banner .chapter');
  assert.strictEqual(
    interactions.renameInteractionClassReferences(renameDocument, 'missing', 'next'),
    renameDocument,
    'a no-op rename must preserve document identity',
  );
  const numericRename = interactions.renameInteractionClassReferences(
    renameDocument,
    'hero',
    '2banner',
  );
  assert.equal(numericRename.interactions[0].triggerSelector, '.\\32 banner');

  const pageCompanionPath = interactions.interactionDocumentPath('index.html');
  const aboutCompanionPath = interactions.interactionDocumentPath('pages/about.html');
  const interactionProject = {
    name: 'Interaction rename transaction',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: '<main class="hero"></main>' },
      'pages/about.html': { path: 'pages/about.html', mimeType: 'text/html', text: '<main class="hero"></main>' },
      [pageCompanionPath]: {
        path: pageCompanionPath,
        mimeType: 'application/json',
        text: interactions.serializeInteractionDocument(renameDocument, { canonical: true }),
      },
      [aboutCompanionPath]: {
        path: aboutCompanionPath,
        mimeType: 'application/json',
        text: interactions.serializeInteractionDocument(renameDocument, { canonical: true }),
      },
    },
  };
  const renamedInteractionProject = interactions.renameProjectInteractionClassReferences(
    interactionProject,
    ['pages/about.html', 'index.html'],
    'hero',
    'banner',
  );
  assert.deepEqual(renamedInteractionProject.changedFilePaths, [
    pageCompanionPath,
    aboutCompanionPath,
  ].sort());
  for (const companionPath of renamedInteractionProject.changedFilePaths) {
    assert.match(renamedInteractionProject.project.files[companionPath].text, /\.banner/);
    assert.doesNotMatch(
      renamedInteractionProject.project.files[companionPath].text,
      /"triggerSelector": "\.hero"/,
    );
  }
  assert.strictEqual(
    interactionProject.files[pageCompanionPath].text.includes('.hero'),
    true,
    'the input project must remain immutable',
  );
  const invalidInteractionProject = {
    ...interactionProject,
    files: {
      ...interactionProject.files,
      [aboutCompanionPath]: {
        ...interactionProject.files[aboutCompanionPath],
        text: '{ invalid interactions',
      },
    },
  };
  assert.throws(
    () => interactions.renameProjectInteractionClassReferences(
      invalidInteractionProject,
      ['index.html', 'pages/about.html'],
      'hero',
      'banner',
    ),
    /Documento de interações inválido/,
  );
  assert.strictEqual(
    invalidInteractionProject.files[pageCompanionPath],
    interactionProject.files[pageCompanionPath],
    'a later invalid companion must roll back every prepared interaction rename',
  );

  const reducedRoot = new FakeElement('div', { class: 'target' });
  const reducedDocument = new FakeDocument(reducedRoot);
  const visual = {
    ...interactions.createInteractionAction('animate'),
    id: 'visual',
    duration: 1,
    from: { opacity: 0 },
    to: { opacity: 1 },
    target: { selector: '', label: 'Trigger', scope: 'trigger', mode: 'element' },
  };
  const sideEffect = {
    ...interactions.createInteractionAction('event'),
    id: 'side-effect',
    start: 0.5,
    eventName: 'must-not-fire',
    target: { selector: '', label: 'Trigger', scope: 'trigger', mode: 'element' },
  };
  const reducedDefinition = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'reduced-end',
    name: 'Reduced end',
    trigger: 'load',
    triggerSelector: '.target',
    triggerLabel: '.target',
    triggerTargetMode: 'selector',
    reducedMotion: 'end',
    actions: [visual, sideEffect],
  };
  const reducedGsap = createFakeGsap();
  executeInteractionRuntime(
    interactionRuntime(interactions.patchInteractionDocument(
      '<!doctype html><html><head></head><body><div class="target"></div></body></html>',
      { version: 2, interactions: [reducedDefinition] },
    )),
    reducedDocument,
    reducedGsap,
    { reducedMotion: true },
  );
  assert.equal(reducedRoot.style.opacity, 1, 'reduced end must settle visual tracks');
  assert.equal(reducedRoot.dispatchedEvents.length, 0, 'reduced end must suppress call actions');
  assert.equal(reducedGsap.timelines[0].lastProgressSuppressed, true);

  const componentRoot = new FakeElement('article', {
    class: 'target',
    'data-kodety-component-id': 'card',
    'data-kodety-component-variant': 'default',
    'data-kodety-component-state-variant': 'default',
    'data-kodety-component-instance': 'card-one',
  }, '<span>Default</span>');
  const registry = {
    version: 1,
    components: [{
      id: 'card',
      name: 'Card',
      variables: [],
      variants: [
        { id: 'default', markup: '<article><span>Default</span></article>' },
        { id: 'alternate', markup: '<section><strong>Alternate</strong></section>' },
      ],
    }],
  };
  const variantDocument = new FakeDocument(componentRoot, registry);
  const variantAction = {
    ...interactions.createInteractionAction('component-variant'),
    id: 'set-alternate',
    duration: 0.3,
    componentId: 'card',
    componentVariantId: 'alternate',
    target: { selector: '', label: 'Trigger', scope: 'trigger', mode: 'element' },
  };
  const variantDefinition = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'variant-preview',
    name: 'Variant preview',
    trigger: 'load',
    triggerSelector: '[data-kodety-component-instance="card-one"]',
    triggerLabel: 'Card instance',
    triggerTargetMode: 'selector',
    actions: [variantAction],
  };
  const variantGsap = createFakeGsap();
  const variantWindow = executeInteractionRuntime(
    interactionRuntime(interactions.patchInteractionDocument(
      '<!doctype html><html><head></head><body><article class="target"></article></body></html>',
      { version: 2, interactions: [variantDefinition] },
    )),
    variantDocument,
    variantGsap,
    { frozen: true },
  );
  const controller = variantWindow.__kodetyInteractions.get('variant-preview');
  assert.ok(controller);
  controller.seek(0.8);
  assert.equal(componentRoot.getAttribute('data-kodety-component-variant'), 'alternate');
  assert.equal(componentRoot.innerHTML, '<strong>Alternate</strong>');
  assert.equal(controller.reset(), true);
  assert.equal(
    componentRoot.getAttribute('data-kodety-component-variant'),
    'default',
    'reset must cross Set Variant backwards before killing its timeline',
  );
  assert.equal(componentRoot.innerHTML, '<span>Default</span>');
  controller.seek(0.8);
  assert.equal(componentRoot.getAttribute('data-kodety-component-variant'), 'alternate');
  assert.equal(controller.release(), true);
  assert.equal(
    componentRoot.getAttribute('data-kodety-component-variant'),
    'default',
    'release must cross Set Variant backwards before killing its timeline',
  );
  assert.equal(componentRoot.innerHTML, '<span>Default</span>');
  assert.equal(variantWindow.__KODETY_ACTIVE_INTERACTION_PREVIEW__, '');

  console.log('Interactions hardening regressions passed');
} finally {
  await server.close();
}
