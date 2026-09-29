import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const aliases = {
  '@coday/components': path.join(root, 'packages/component-sdk/src/index.ts'),
  '@coday/control-schema': path.join(root, 'packages/control-schema/src/index.ts'),
  '@coday/component-runtime/vendor': path.join(root, 'packages/component-runtime/src/vendor.ts'),
  '@coday/component-runtime': path.join(root, 'packages/component-runtime/src/index.tsx'),
};

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
  resolve: { alias: aliases },
});

let browser;
let fixtureServer;
try {
  const codeComponents = await vite.ssrLoadModule('/lib/html-editor/code-components.ts');
  const componentId = 'test.paint-reveal-browser';
  const componentVersion = '1.0.0';
  const instanceId = 'paint-reveal-browser-instance';
  const controls = {
    cover: {
      type: 'image',
      title: 'Reveal Image',
      framerValueType: 'responsive-image',
    },
  };
  const initialCover = {
    id: 'assets/initial.gif',
    src: 'assets/initial.gif',
    srcSet: 'assets/initial.gif 1x, assets/initial%20retina.gif 2x',
    alt: 'Initial image',
    width: 1200,
    height: 800,
    focalPoint: { x: 0.4, y: 0.6 },
  };
  const instance = {
    schemaVersion: '1.0.0',
    id: instanceId,
    componentId,
    componentVersion,
    props: { cover: initialCover },
    responsiveProps: {},
    bindings: {},
    slots: {},
    sizing: { widthMode: 'fixed', heightMode: 'fixed', width: 320, height: 180 },
    metadata: {},
  };
  // Deliberately model a component persisted before the Framer compatibility
  // compiler rewrite. Publication must migrate this bundle without reimport.
  const legacyBundle = `
import { ControlType } from "framer"
const assetPath = value => globalThis.__KODETY_BROWSER_ASSET_PATHS__?.get(value) || value || ""
const paint = (element, props) => {
  if (ControlType.String !== "string") throw new Error("Framer facade unavailable")
  let image = element.querySelector("img")
  if (!image) {
    image = document.createElement("img")
    image.crossOrigin = "anonymous"
    element.append(image)
  }
  const cover = props.cover || { src: "", alt: "Default image" }
  image.src = cover.src || ""
  image.srcset = cover.srcSet || ""
  image.alt = cover.alt || ""
  element.dataset.coverPath = assetPath(cover.src)
  element.dataset.coverSrc = cover.src || ""
  element.dataset.coverSrcSet = cover.srcSet || ""
  element.dataset.coverAlt = cover.alt || ""
  element.dataset.coverWidth = String(cover.width || "")
  element.dataset.coverFocalX = String(cover.focalPoint?.x || "")
  return true
}
export async function mountCodayComponent(element, props) {
  paint(element, props)
  return {
    update(nextProps) { return paint(element, nextProps) },
    dispose() {},
  }
}
`;
  const component = {
    id: componentId,
    version: componentVersion,
    schemaVersion: '1.0.0',
    bundle: legacyBundle,
    bundleHash: 'a'.repeat(64),
    manifest: {
      schemaVersion: '1.0.0',
      id: componentId,
      name: 'Paint Reveal Browser Fixture',
      version: componentVersion,
      exportName: 'default',
      controls,
      defaultProps: { cover: initialCover },
      sizing: { width: 'fixed', height: 'fixed', defaultWidth: 320, defaultHeight: 180 },
      dependencies: ['framer'],
      capabilities: [],
      slots: {},
      events: {},
    },
    publishedAt: new Date(0).toISOString(),
    author: 'Kodety browser regression',
    dependencies: ['framer'],
  };
  const marker = codeComponents.codeComponentMarkup(instance);
  const resolver = `<script>
globalThis.__KODETY_BROWSER_ASSET_PATHS__ = new Map();
globalThis.__KODETY_BROWSER_APPLIED__ = [];
addEventListener('coday:code-component-instance-applied', event => __KODETY_BROWSER_APPLIED__.push(event.detail.revision));
globalThis.__KODETY_RESOLVE_RUNTIME_ASSET_URL__ = value => new Promise(resolve => {
  const authored = String(value || '');
  const delay = authored.includes('slow') ? 160 : authored.includes('fast') ? 8 : 0;
  setTimeout(() => {
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
    __KODETY_BROWSER_ASSET_PATHS__.set(url, authored);
    resolve(url);
  }, delay);
});
</script>`;
  const project = {
    name: 'Code Component browser regression',
    mainHtmlPath: 'published.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'published.html': {
        path: 'published.html',
        mimeType: 'text/html',
        text: `<!doctype html><html><body>${marker}</body></html>`,
      },
      'editor.html': {
        path: 'editor.html',
        mimeType: 'text/html',
        text: `<!doctype html><html><body>${marker}${resolver}</body></html>`,
      },
      'assets/initial.gif': {
        path: 'assets/initial.gif',
        mimeType: 'image/gif',
        data: Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')),
      },
      'assets/initial retina.gif': {
        path: 'assets/initial retina.gif',
        mimeType: 'image/gif',
        data: Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')),
      },
    },
  };
  const prepared = codeComponents.prepareCodeComponentProject(project, {
    schemaVersion: '1.0.0',
    components: [component],
    instances: [instance],
  });
  const emittedModule = Object.values(prepared.files).find(file => (
    file.path.startsWith('.coday/components/') && file.path.endsWith('.mjs')
  ));
  assert.ok(emittedModule?.text, 'publication must emit the legacy component module');
  assert.doesNotMatch(emittedModule.text, /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])framer\1/);

  fixtureServer = http.createServer((request, response) => {
    let filePath = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname.slice(1));
    if (!filePath) filePath = 'published.html';
    const file = prepared.files[filePath];
    if (!file) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader('content-type', file.mimeType || 'application/octet-stream');
    response.end(file.text !== undefined ? file.text : Buffer.from(file.data || new Uint8Array()));
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  const address = fixtureServer.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(`${baseUrl}/published.html`);
  await page.waitForFunction(id => document.querySelector(`[data-coday-code-instance="${id}"]`)?.dataset.coverPath === 'assets/initial.gif', instanceId);
  assert.equal(await page.locator('[data-coday-code-instance] img').getAttribute('crossorigin'), 'anonymous');
  assert.equal(await page.locator('[data-coday-code-instance] img').evaluate(image => image.naturalWidth), 1);
  assert.deepEqual(pageErrors, [], `published component page errors: ${pageErrors.join('\n')}`);
  assert.deepEqual(
    consoleErrors.filter(message => /resolve module specifier|CORS|origin 'null'/i.test(message)),
    [],
    `published component console errors: ${consoleErrors.join('\n')}`,
  );

  await page.goto(`${baseUrl}/editor.html`);
  await page.waitForFunction(id => document.querySelector(`[data-coday-code-instance="${id}"]`)?.dataset.coverSrc.startsWith('blob:'), instanceId);
  const initialHydrated = await page.locator('[data-coday-code-instance]').evaluate(element => ({
    path: element.dataset.coverPath,
    src: element.dataset.coverSrc,
    srcSet: element.dataset.coverSrcSet,
    alt: element.dataset.coverAlt,
    width: element.dataset.coverWidth,
    focalX: element.dataset.coverFocalX,
  }));
  assert.equal(initialHydrated.path, 'assets/initial.gif');
  assert.match(initialHydrated.src, /^blob:/);
  assert.match(initialHydrated.srcSet, /^blob:[^,]+ 1x, blob:[^,]+ 2x$/);
  assert.deepEqual(
    { alt: initialHydrated.alt, width: initialHydrated.width, focalX: initialHydrated.focalX },
    { alt: 'Initial image', width: '1200', focalX: '0.4' },
  );

  const candidate = (src, alt) => ({
    ...instance,
    props: {
      cover: {
        ...initialCover,
        id: src,
        src,
        srcSet: `${src} 1x`,
        alt,
      },
    },
  });
  await page.evaluate(({ slow, fast }) => {
    dispatchEvent(new CustomEvent('coday:code-component-instance-update', {
      detail: { instance: slow, revision: 1 },
    }));
    dispatchEvent(new CustomEvent('coday:code-component-instance-update', {
      detail: { instance: fast, revision: 2 },
    }));
  }, {
    slow: candidate('assets/slow.gif', 'Slow image'),
    fast: candidate('assets/fast.gif', 'Fast image'),
  });
  await page.waitForFunction(id => document.querySelector(`[data-coday-code-instance="${id}"]`)?.dataset.coverPath === 'assets/fast.gif', instanceId);
  await page.waitForTimeout(220);
  const rapidResult = await page.locator('[data-coday-code-instance]').evaluate(element => ({
    path: element.dataset.coverPath,
    alt: element.dataset.coverAlt,
    applied: globalThis.__KODETY_BROWSER_APPLIED__,
  }));
  assert.deepEqual(rapidResult, { path: 'assets/fast.gif', alt: 'Fast image', applied: [2] });
  assert.deepEqual(pageErrors, [], `editor component page errors: ${pageErrors.join('\n')}`);
  assert.deepEqual(
    consoleErrors.filter(message => /resolve module specifier|CORS|origin 'null'/i.test(message)),
    [],
    `editor component console errors: ${consoleErrors.join('\n')}`,
  );

  console.log('Code Components browser runtime tests passed');
} finally {
  await browser?.close();
  await new Promise(resolve => fixtureServer?.close(resolve) ?? resolve());
  await vite.close();
}
