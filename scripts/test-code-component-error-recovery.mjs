import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

class FakeNode {
  constructor(nodeType, nodeName, ownerDocument = null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (reference == null) return this.appendChild(child);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('Reference node is not a child.');
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error('Node is not a child.');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes.at(-1) || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;
  }

  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue;
    return this.childNodes.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes.forEach(child => { child.parentNode = null; });
    this.childNodes = [];
    const text = String(value ?? '');
    if (text && this.ownerDocument) this.appendChild(this.ownerDocument.createTextNode(text));
  }
}

class FakeText extends FakeNode {
  constructor(value, ownerDocument) {
    super(3, '#text', ownerDocument);
    this.nodeValue = String(value);
  }
}

class FakeComment extends FakeNode {
  constructor(value, ownerDocument) {
    super(8, '#comment', ownerDocument);
    this.nodeValue = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(1, String(tagName).toUpperCase(), ownerDocument);
    this.tagName = this.nodeName;
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    const styleValues = new Map();
    this.style = {
      setProperty: (name, value) => styleValues.set(name, String(value)),
      removeProperty: name => styleValues.delete(name),
    };
    this.scrollWidth = 0;
    this.scrollHeight = 0;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(9, '#document');
    this.ownerDocument = this;
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tagName) { return new FakeElement(tagName, this); }
  createElementNS(namespaceURI, tagName) { return new FakeElement(tagName, this, namespaceURI); }
  createTextNode(value) { return new FakeText(value, this); }
  createComment(value) { return new FakeComment(value, this); }
}

const document = new FakeDocument();
const window = {
  document,
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({}),
  HTMLIFrameElement: class HTMLIFrameElement extends FakeElement {},
};
document.defaultView = window;
globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node.js' } });
globalThis.Node = FakeNode;
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;
globalThis.HTMLIFrameElement = window.HTMLIFrameElement;
globalThis.ResizeObserver = class ResizeObserver { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const aliases = {
  '@coday/components': path.join(rootDirectory, 'packages/component-sdk/src/index.ts'),
  '@coday/control-schema': path.join(rootDirectory, 'packages/control-schema/src/index.ts'),
  '@coday/component-registry': path.join(rootDirectory, 'packages/component-registry/src/index.ts'),
  '@coday/cms-bridge': path.join(rootDirectory, 'packages/cms-bridge/src/index.ts'),
  '@coday/canvas-bridge': path.join(rootDirectory, 'packages/canvas-bridge/src/index.ts'),
};
const server = await createServer({
  root: rootDirectory,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: aliases },
});

try {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = React;
  const runtime = await server.ssrLoadModule('/packages/component-runtime/src/index.tsx');
  const registry = new runtime.RuntimeRegistry();
  let sisterMounts = 0;
  let sisterUnmounts = 0;

  function BrokenComponent() { throw new Error('development build failed'); }
  function FixedComponent() { return React.createElement('strong', { 'data-fixed': 'true' }, 'Recovered'); }
  function SisterComponent() {
    React.useEffect(() => {
      sisterMounts += 1;
      return () => { sisterUnmounts += 1; };
    }, []);
    return React.createElement('span', { 'data-sister': 'true' }, 'Sister');
  }

  const manifest = (id) => ({
    schemaVersion: '1.0.0', id, name: id, displayName: id, version: '1.0.0',
    exportName: id, controls: {}, defaultProps: {}, sizing: { width: 'hug', height: 'hug' },
    dependencies: [], capabilities: [],
  });
  const brokenRegistration = registry.register({ component: BrokenComponent, manifest: manifest('test.recovery') });
  registry.register({ component: SisterComponent, manifest: manifest('test.sister') });
  const instance = (id, componentId) => ({
    schemaVersion: '1.0.0', id, componentId, componentVersion: '1.0.0', props: {}, sizing: {},
    metadata: { createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() },
  });
  const targetInstance = instance('stable-instance', 'test.recovery');
  const sisterInstance = instance('sister-instance', 'test.sister');
  const fallback = React.createElement('span', { 'data-fallback': 'true' }, 'Fallback');
  const renderHosts = () => React.createElement(React.Fragment, null,
    React.createElement(runtime.ComponentHost, {
      key: targetInstance.id, instance: targetInstance, registry, breakpoints: [], activeBreakpoint: 'base', fallback,
    }),
    React.createElement(runtime.ComponentHost, {
      key: sisterInstance.id, instance: sisterInstance, registry, breakpoints: [], activeBreakpoint: 'base',
    }),
  );

  const container = document.createElement('main');
  document.body.appendChild(container);
  const root = createRoot(container);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await act(async () => { root.render(renderHosts()); });
  } finally {
    console.error = originalConsoleError;
  }
  assert.match(container.textContent, /Fallback/);
  assert.match(container.textContent, /Sister/);
  assert.equal(sisterMounts, 1);
  assert.equal(sisterUnmounts, 0);

  const fixedRegistration = registry.register({ component: FixedComponent, manifest: manifest('test.recovery') });
  assert.ok(fixedRegistration.registrationRevision > brokenRegistration.registrationRevision);
  await act(async () => { root.render(renderHosts()); });
  assert.match(container.textContent, /Recovered/);
  assert.doesNotMatch(container.textContent, /Fallback/);
  assert.match(container.textContent, /Sister/);
  assert.equal(targetInstance.id, 'stable-instance', 'hot reload keeps the same placed instance');
  assert.equal(sisterMounts, 1, 'a sibling host must not remount during recovery');
  assert.equal(sisterUnmounts, 0, 'a sibling host must not be disposed during recovery');

  await act(async () => { root.unmount(); });
  assert.equal(sisterUnmounts, 1, 'the harness still observes an ordinary final cleanup');
  console.log('Code Component error boundary hot-reload recovery approved.');
} finally {
  await server.close();
}
