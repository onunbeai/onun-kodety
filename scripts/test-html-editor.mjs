import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import JSZip from 'jszip';
import ts from 'typescript';
import { parse as parseHtml, serialize as serializeHtml } from 'parse5';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(absolutePath);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
    }),
  );
  return files.flat();
}

function interactionTestSelectorMatches(element, rawSelector) {
  return rawSelector.split(',').some(candidate => {
    let selector = candidate.trim();
    if (!selector) return false;
    const attributes = [];
    selector = selector.replace(/\[([a-zA-Z_][\w:-]*)(?:=(["'])(.*?)\2)?\]/g, (_match, name, _quote, value) => {
      attributes.push({ name: name.toLowerCase(), value });
      return '';
    });
    if (
      attributes.some(
        attribute =>
          !Object.hasOwn(element.attributes, attribute.name) || (attribute.value !== undefined && element.attributes[attribute.name] !== attribute.value),
      )
    )
      return false;
    const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch && element.attributes.id !== idMatch[1]) return false;
    const classes = Array.from(selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map(match => match[1]);
    const elementClasses = new Set((element.attributes.class || '').split(/\s+/).filter(Boolean));
    if (classes.some(className => !elementClasses.has(className))) return false;
    const tag = selector.match(/^[a-zA-Z][a-zA-Z0-9-]*/)?.[0];
    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    const residue = selector
      .replace(/^\*/, '')
      .replace(/^[a-zA-Z][a-zA-Z0-9-]*/, '')
      .replace(/#[a-zA-Z0-9_-]+/g, '')
      .replace(/\.[a-zA-Z0-9_-]+/g, '')
      .trim();
    return residue === '';
  });
}

class InteractionTestElement {
  constructor(node, parentElement = null) {
    this.tagName = node.tagName;
    this.attributes = Object.fromEntries((node.attrs || []).map(attribute => [attribute.name.toLowerCase(), attribute.value]));
    this.parentElement = parentElement;
    this.children = (node.childNodes || []).filter(child => Boolean(child.tagName)).map(child => new InteractionTestElement(child, this));
  }

  matches(selector) {
    return interactionTestSelectorMatches(this, selector);
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = element => {
      if (element.matches(selector)) matches.push(element);
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }
}

class InteractionTestDocument {
  constructor(source) {
    const parsed = parseHtml(source);
    const findBody = node => {
      if (node.tagName === 'body') return node;
      for (const child of node.childNodes || []) {
        const found = findBody(child);
        if (found) return found;
      }
      return null;
    };
    const bodyNode = findBody(parsed);
    if (!bodyNode) throw new Error('Interaction test document requires body.');
    this.body = new InteractionTestElement(bodyNode);
  }

  querySelectorAll(selector) {
    const matches = this.body.matches(selector) ? [this.body] : [];
    return [...matches, ...this.body.querySelectorAll(selector)];
  }
}

const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

try {
  const css = await server.ssrLoadModule('/lib/html-editor/css-patcher.ts');
  const source = await server.ssrLoadModule('/lib/html-editor/source-patcher.ts');
  const styles = await server.ssrLoadModule('/lib/html-editor/style-utils.ts');
  const projectIo = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const imageCompression = await server.ssrLoadModule('/lib/html-editor/image-compression.ts');
  const classSelector = await server.ssrLoadModule('/lib/html-editor/class-selector.ts');
  const cssIntegrity = await server.ssrLoadModule('/lib/html-editor/css-integrity.ts');
  const visualStyles = await server.ssrLoadModule('/lib/html-editor/visual-style-adapter.ts');
  const sizingValues = await server.ssrLoadModule('/lib/html-editor/sizing-values.ts');
  const infiniteCanvas = await server.ssrLoadModule('/lib/html-editor/infinite-canvas.ts');
  const infiniteCanvasRuntime = await server.ssrLoadModule('/lib/html-editor/infinite-canvas-runtime.ts');
  const canvasProtocol = await server.ssrLoadModule('/lib/html-editor/canvas-protocol.ts');
  const canvasViewState = await server.ssrLoadModule('/lib/html-editor/canvas-view-state.ts');
  const mediaFocus = await server.ssrLoadModule('/lib/html-editor/media-focus.ts');
  const editCoalescing = await server.ssrLoadModule('/lib/html-editor/edit-coalescing.ts');
  const spatialControls = await server.ssrLoadModule('/lib/html-editor/spatial-controls.ts');
  const cssLengthDraft = await server.ssrLoadModule('/lib/html-editor/css-length-draft.ts');
  const localization = await server.ssrLoadModule('/lib/html-editor/localization.ts');
  const projectRebase = await server.ssrLoadModule('/lib/html-editor/project-rebase.ts');
  const collaborativeMerge = await server.ssrLoadModule('/lib/html-editor/collaborative-merge.ts');
  const projectStorage = await server.ssrLoadModule('/lib/html-editor/project-storage.ts');
  const pageRename = await server.ssrLoadModule('/lib/html-editor/page-rename.ts');
  const customCode = await server.ssrLoadModule('/lib/html-editor/custom-code.ts');
  const motionTimeline = await server.ssrLoadModule('/lib/html-editor/motion-timeline.ts');
  const interactions = await server.ssrLoadModule('/lib/html-editor/interactions.ts');
  const interactionLibrary = await server.ssrLoadModule('/lib/html-editor/interaction-library.ts');
  const codedProject = await server.ssrLoadModule('/lib/html-editor/coded-project.ts');
  const framerImport = await server.ssrLoadModule('/lib/html-editor/framer-import.ts');
  const previewRuntime = await server.ssrLoadModule('/lib/html-editor/preview.ts');
  const nativeRuntime = await server.ssrLoadModule('/lib/html-editor/native-runtime.ts');
  const wordpressPublication = await server.ssrLoadModule('/lib/html-editor/wordpress-publication.ts');
  const projectFonts = await server.ssrLoadModule('/lib/html-editor/project-fonts.ts');
  const socialFontConversion = await server.ssrLoadModule('/lib/html-editor/social-font-conversion.ts');
  const fontUtils = await server.ssrLoadModule('/lib/font-utils.ts');
  const fontPanel = await server.ssrLoadModule('/lib/font-panel-utils.ts');
  const colorFormat = await server.ssrLoadModule('/lib/color-format.ts');
  const designTokens = await server.ssrLoadModule('/lib/html-editor/design-tokens.ts');
  const layerPresentation = await server.ssrLoadModule('/lib/html-editor/layer-presentation.ts');
  const staleHydrationStaticFramerProject = {
    name: 'Static Framer import',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<main data-framer-hydrate-v2 data-kodety-framer-compat-runtime>Static and editable</main>',
      },
      '.incode/url-import.json': {
        path: '.incode/url-import.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          platform: 'framer',
          framerMode: 'static',
          runtime: 'static-editable',
        }),
      },
      '.incode/framer-import.json': {
        path: '.incode/framer-import.json',
        mimeType: 'application/json',
        text: JSON.stringify({ version: 1, runtime: true }),
      },
    },
  };
  assert.equal(
    framerImport.isHydratedFramerProject(staleHydrationStaticFramerProject),
    false,
    'static-editable Framer metadata must override stale hydration markers and remain editable',
  );
  const animatedHydratedFramerProject = {
    ...staleHydrationStaticFramerProject,
    name: 'Animated Framer import',
    files: {
      ...staleHydrationStaticFramerProject.files,
      '.incode/url-import.json': {
        path: '.incode/url-import.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          platform: 'framer',
          framerMode: 'animated',
          runtime: 'preserved-guarded',
        }),
      },
    },
  };
  assert.equal(
    framerImport.isHydratedFramerProject(animatedHydratedFramerProject),
    true,
    'only an animated hydrated Framer import may enter the guarded editing flow',
  );
  const editableFallbackFramerProject = {
    name: 'Editable Framer fallback',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><section class="hero kodety-framer-motion-7" data-label="Hero principal">Hero</section></body></html>',
      },
      '.incode/framer-import.json': {
        path: '.incode/framer-import.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          runtime: false,
          animations: [{
            trigger: 'load',
            targetClass: 'kodety-framer-motion-7',
            elementLabel: 'Hero principal',
            frames: [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }],
            timing: { duration: 400, delay: 50, easing: 'ease-out', iterations: 1 },
          }],
        }),
      },
    },
  };
  const convertedFallbackFramerProject = framerImport.applyFramerImportManifest(editableFallbackFramerProject);
  const convertedFallbackHtml = convertedFallbackFramerProject.files['index.html'].text;
  const fallbackTargetId = convertedFallbackHtml.match(/data-kodety-interaction-id="(element-framer-[a-z0-9]{5})"/)?.[1];
  assert.ok(fallbackTargetId, 'a unique captured Framer motion target must receive a durable editable element identity');
  const convertedFallbackInteraction = interactions.readInteractionDocument(convertedFallbackHtml)
    .interactions.find(interaction => interaction.id === 'framer-load');
  assert.deepEqual(
    convertedFallbackInteraction?.actions[0]?.target,
    {
      selector: `[data-kodety-interaction-id="${fallbackTargetId}"]`,
      label: 'Hero principal',
      scope: 'document',
      mode: 'element',
    },
    'fallback load motion must target the stable layer instead of an opaque generated class',
  );
  const reconvertedFallbackHtml = framerImport.applyFramerImportManifest(convertedFallbackFramerProject).files['index.html'].text;
  assert.equal(
    (reconvertedFallbackHtml.match(/data-kodety-interaction-id="element-framer-[a-z0-9]{5}"/g) || []).length,
    1,
    'reapplying the Framer manifest must reuse the durable target instead of stamping duplicate identities',
  );
  const inlineTextSource = '<!doctype html><html><body><h1 class="title">Hello <span style="color:red">world</span><br>again</h1><p>Keep me</p></body></html>';
  const patchedInlineTextSource = source.patchElementInnerHtml(inlineTextSource, '0', 'Hello <span style="color:blue">Kodety</span><br>again');
  assert.match(
    patchedInlineTextSource,
    /<h1 class="title">Hello <span style="color:blue">Kodety<\/span><br>again<\/h1><p>Keep me<\/p>/,
    'rich inline text persistence must retain the host element and neighboring source while round-tripping span/br markup',
  );
  assert.equal(colorFormat.cssColorToHex('rgb(255, 127, 0)'), '#FF7F00');
  assert.equal(colorFormat.cssColorToHex('rgba(0, 0, 0, 0)'), '#00000000');
  assert.equal(colorFormat.cssColorToHex('rgb(100% 50% 0% / 50%)'), '#FF800080');
  assert.equal(colorFormat.cssColorToHex('#369/25'), null);
  assert.equal(colorFormat.cssColorToHex('#336699/25'), '#33669940');
  assert.equal(colorFormat.cssColorToHex('#abc'), '#AABBCC');
  assert.equal(colorFormat.cssColorToHex('var(--brand-color)'), null);
  const layerNode = ({ tag = 'div', label = tag, id = '', classes = [], attributes = {}, text = '' } = {}) => ({
    path: '0',
    tag,
    label,
    id,
    classes,
    attributes,
    text,
    hasElementChildren: false,
    children: [],
  });
  assert.deepEqual(
    layerPresentation.resolveHtmlLayerPresentation(
      layerNode({
        tag: 'section',
        label: 'about',
        id: 'about',
        attributes: { id: 'about' },
      }),
      'Section',
    ),
    {
      name: 'About',
      type: 'Section',
      showType: true,
      source: 'id',
      title: 'ID: #about',
    },
    'layer names must prioritize a humanized ID before the element type',
  );
  assert.deepEqual(
    layerPresentation.resolveHtmlLayerPresentation(
      layerNode({
        tag: 'button',
        label: 'awards__item',
        classes: ['awards__item'],
        attributes: { class: 'awards__item' },
      }),
      'Button',
    ),
    {
      name: 'Awards item',
      type: 'Button',
      showType: true,
      source: 'class',
      title: 'Classe: .awards__item',
    },
    'layer names must humanize the primary class while preserving the HTML element type',
  );
  assert.deepEqual(
    layerPresentation.resolveHtmlLayerPresentation(
      layerNode({
        tag: 'section',
        label: 'Custom Hero',
        id: 'hero',
        classes: ['hero-section'],
        attributes: {
          'data-label': 'Custom Hero',
          id: 'hero',
          class: 'hero-section',
        },
      }),
      'Section',
    ),
    {
      name: 'Custom Hero',
      type: 'Section',
      showType: true,
      source: 'label',
      title: 'Nome da layer: Custom Hero',
    },
    'an explicit layer label must remain more important than technical selectors',
  );
  assert.deepEqual(
    layerPresentation.resolveHtmlLayerPresentation(layerNode(), 'Block'),
    {
      name: 'Block',
      type: 'Block',
      showType: false,
      source: 'type',
      title: undefined,
    },
    'a generic unnamed element must avoid repeating the same name and type',
  );
  const numberedImageNodes = [
    layerNode({
      tag: 'img',
      label: 'incode-img-0-1',
      classes: ['incode-img-0-1'],
      attributes: { class: 'incode-img-0-1' },
    }),
    {
      ...layerNode({ tag: 'section', label: 'gallery' }),
      path: '1',
      children: [
        {
          ...layerNode({
            tag: 'img',
            label: 'thumbnail',
            classes: ['thumbnail'],
            attributes: { class: 'thumbnail' },
          }),
          path: '1/0',
        },
        {
          ...layerNode({
            tag: 'img',
            label: 'Hero',
            attributes: { 'data-label': 'Hero' },
          }),
          path: '1/1',
        },
      ],
    },
  ];
  const numberedImageNames = layerPresentation.resolveHtmlImageLayerNames(numberedImageNodes);
  assert.deepEqual(
    Array.from(numberedImageNames.entries()),
    [
      ['0', 'Image_1'],
      ['1/0', 'Image_2'],
    ],
    'only unnamed image layers must receive stable document-order Image_N names',
  );
  assert.deepEqual(
    layerPresentation.resolveHtmlLayerPresentation(numberedImageNodes[0], 'Image', numberedImageNames.get('0')),
    {
      name: 'Image_1',
      type: 'Image',
      showType: true,
      source: 'generated',
      title: undefined,
    },
    'technical image classes must not leak into the Layers name',
  );
  assert.equal(
    imageCompression.projectImageCompressionMimeType({
      path: 'assets/hero.JPG',
      mimeType: 'application/octet-stream',
      data: new Uint8Array([1]),
    }),
    'image/jpeg',
    'image compression must infer a supported format without renaming opaque imported assets',
  );
  assert.deepEqual(
    imageCompression.imageCompressionTargetSize(4000, 2000, 1600),
    { width: 1600, height: 800 },
    'image compression must preserve aspect ratio when limiting the largest side',
  );
  assert.deepEqual(
    imageCompression.imageCompressionTargetSize(800, 600, 1600),
    { width: 800, height: 600 },
    'image compression must never enlarge a smaller source',
  );
  assert.deepEqual(
    imageCompression.imageCompressionQualityCandidates(82, 'image/jpeg'),
    [0.82, 0.74, 0.66, 0.58],
    'lossy compression must retry below the maximum quality when the first browser encoding is not smaller',
  );
  assert.deepEqual(
    imageCompression.imageCompressionQualityCandidates(82, 'image/png'),
    [1],
    'lossless PNG compression must never pretend that the browser quality argument is supported',
  );
  assert.deepEqual(
    imageCompression.imageCompressionQualityCandidates(30, 'image/webp'),
    [0.3],
    'a programmatic quality below the UI floor must never be silently raised',
  );
  const animatedPngFixture = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]);
  assert.equal(
    imageCompression.isAnimatedProjectImage({
      path: 'assets/loading.png',
      mimeType: 'image/png',
      data: animatedPngFixture,
    }),
    true,
    'APNG assets must be protected from single-frame canvas re-encoding',
  );
  const animatedWebpFixture = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 65, 78, 73, 77, 0, 0, 0, 0]);
  assert.equal(
    imageCompression.isAnimatedProjectImage({
      path: 'assets/loading.webp',
      mimeType: 'image/webp',
      data: animatedWebpFixture,
    }),
    true,
    'animated WebP assets must be protected from single-frame canvas re-encoding',
  );
  assert.deepEqual(
    imageCompression.summarizeImageCompressionResults([
      {
        path: 'assets/a.jpg',
        status: 'compressed',
        originalBytes: 1000,
        compressedBytes: 600,
      },
      {
        path: 'assets/b.png',
        status: 'skipped',
        reason: 'not-smaller',
        originalBytes: 500,
        compressedBytes: 500,
      },
    ]),
    {
      total: 2,
      compressed: 1,
      skipped: 1,
      failed: 0,
      originalBytes: 1500,
      compressedBytes: 1100,
      savedBytes: 400,
    },
    'batch compression summaries must report exact savings and skipped originals',
  );
  assert.equal(
    imageCompression.projectImageConversionMimeType({
      path: 'assets/cover.AVIF',
      mimeType: 'application/octet-stream',
      data: new Uint8Array([1]),
    }),
    'image/avif',
    'batch conversion must recognize AVIF assets even when imports retain an opaque MIME type',
  );
  assert.equal(
    imageCompression.projectImageConversionMimeType({
      path: 'assets/animated.jpg',
      mimeType: 'image/gif',
      data: new Uint8Array([1]),
    }),
    null,
    'an explicit unsupported image MIME type must not be overridden by a misleading filename extension',
  );
  assert.equal(
    imageCompression.convertedProjectImagePath('.incode/experiments/sale/b/project/assets/hero.photo.jpg', 'webp'),
    '.incode/experiments/sale/b/project/assets/hero.photo.webp',
    'conversion must replace only the final extension while retaining variant namespaces and dotted names',
  );
  assert.deepEqual(
    imageCompression.missingProjectImageSiblingPaths(
      {
        'case-ampere-thumb.avif': {
          path: 'case-ampere-thumb.avif',
          mimeType: 'image/avif',
          data: new Uint8Array([1]),
        },
        'case-ampere-thumb.jpg': {
          path: 'case-ampere-thumb.jpg',
          mimeType: 'image/jpeg',
          data: new Uint8Array([2]),
        },
      },
      'case-ampere-thumb.avif',
    ),
    ['case-ampere-thumb.jpeg', 'case-ampere-thumb.jfif', 'case-ampere-thumb.png', 'case-ampere-thumb.webp'],
    'rerunning conversion must repair only missing same-stem extensions and never redirect an existing source file',
  );
  assert.equal(
    imageCompression.rewriteImageExtensionsByBasename(
      '<img src="./case-ampere-thumb.png"><source srcset="assets/case-ampere-thumb.jpg 1x, assets/other.png 2x">',
      ['case-ampere-thumb.avif'],
      'avif',
    ),
    '<img src="./case-ampere-thumb.avif"><source srcset="assets/case-ampere-thumb.avif 1x, assets/other.png 2x">',
    'mass conversion must update every image element by matching the filename stem and changing only its extension',
  );
  assert.equal(
    imageCompression.rewriteImageExtensionsByBasename(
      '{"src":".\\\\/case-ampere-thumb.png","cdn":"https:\\/\\/cdn.example\\/case-ampere-thumb.png"}',
      ['case-ampere-thumb.webp'],
      'webp',
    ),
    '{"src":".\\\\/case-ampere-thumb.webp","cdn":"https:\\/\\/cdn.example\\/case-ampere-thumb.png"}',
    'basename migration must cover escaped element snapshots without modifying an external URL',
  );
  const animatedAvifFixture = new TextEncoder().encode('\u0000\u0000\u0000 ftypavis\u0000\u0000\u0000\u0000avisavifmif1');
  assert.equal(
    imageCompression.isAnimatedProjectImage({
      path: 'assets/sequence.avif',
      mimeType: 'image/avif',
      data: animatedAvifFixture,
    }),
    true,
    'AVIF image sequences must remain protected from still-image conversion',
  );
  assert.deepEqual(
    imageCompression.summarizeImageConversionResults([
      {
        path: 'assets/a.jpg',
        status: 'converted',
        originalBytes: 1200,
        convertedBytes: 500,
      },
      {
        path: 'assets/b.webp',
        status: 'unchanged',
        originalBytes: 400,
        convertedBytes: 400,
      },
      {
        path: 'assets/c.png',
        status: 'protected',
        originalBytes: 300,
        convertedBytes: 300,
      },
    ]),
    {
      total: 3,
      converted: 1,
      unchanged: 1,
      protected: 1,
      originalBytes: 1900,
      convertedBytes: 1200,
      savedBytes: 700,
    },
    'conversion summaries must distinguish converted, existing and protected assets',
  );
  const rootCanvasViewStore = canvasViewState.createCanvasViewStateStore();
  const rootCanvasViewSnapshot = canvasViewState.commitCanvasViewTransaction(
    rootCanvasViewStore,
    {
      patches: [{ path: '', property: 'background-color', value: '#111827' }],
      attributes: [{ path: '', name: 'data-theme', value: 'dark' }],
      texts: [{ path: '', value: 'Body copy' }],
    },
    1,
  );
  assert.deepEqual(
    {
      patches: rootCanvasViewSnapshot.patches,
      attributes: rootCanvasViewSnapshot.attributes,
      texts: rootCanvasViewSnapshot.texts,
    },
    {
      patches: [{ path: '', property: 'background-color', value: '#111827' }],
      attributes: [{ path: '', name: 'data-theme', value: 'dark' }],
      texts: [{ path: '', value: 'Body copy' }],
    },
    'the persistent View State must retain style, attribute and text atoms addressed to body path ""',
  );

  const canvasViewStore = canvasViewState.createCanvasViewStateStore();
  assert.deepEqual(
    canvasViewState.snapshotCanvasViewState(canvasViewStore),
    {
      protocol: 1,
      kind: 'snapshot',
      epoch: 1,
      version: 0,
      revision: 0,
      stylesheets: [],
      patches: [],
      attributes: [],
      texts: [],
      ownerships: [],
    },
    'a new Canvas View State store must start as one complete empty projection',
  );
  const firstCanvasViewSnapshot = canvasViewState.commitCanvasViewTransaction(
    canvasViewStore,
    {
      cssPath: 'src/style.css',
      cssText: '.card { display: flex; }',
      designTokenCssText: ':root { --space: 8px; }',
      patches: [
        { path: '0/1', property: ' COLOR ', value: 'red' },
        { path: '0/1', property: 'color', value: 'blue' },
        { path: '0/1', property: 'width', value: '120px' },
      ],
      attributes: [
        { path: '0/1', name: 'ARIA-HIDDEN', value: 'true' },
        { path: '0/1', name: 'aria-hidden', value: null },
        { path: '0/1', name: 'class', value: 'card featured' },
      ],
      texts: [
        { path: '0/1/0', value: 'Old title' },
        { path: '0/1/0', value: 'Newest title' },
      ],
      ownerships: [
        {
          scope: 'selector',
          target: '.card',
          property: ' OPACITY ',
          owned: true,
        },
      ],
    },
    9,
  );
  assert.equal(firstCanvasViewSnapshot.version, 1);
  assert.equal(firstCanvasViewSnapshot.revision, 9);
  assert.deepEqual(
    canvasViewState.latestCanvasViewStateDelta(canvasViewStore),
    {
      protocol: 1,
      kind: 'delta',
      epoch: 1,
      version: 1,
      revision: 9,
      stylesheets: [{ path: 'src/style.css', cssText: '.card { display: flex; }' }],
      designTokenCssText: ':root { --space: 8px; }',
      patches: [
        { path: '0/1', property: 'color', value: 'blue' },
        { path: '0/1', property: 'width', value: '120px' },
      ],
      attributes: [
        { path: '0/1', name: 'aria-hidden', value: null },
        { path: '0/1', name: 'class', value: 'card featured' },
      ],
      texts: [{ path: '0/1/0', value: 'Newest title' }],
      ownerships: [
        {
          scope: 'selector',
          target: '.card',
          property: 'opacity',
          owned: true,
          breakpoint: 'base',
          pseudo: 'base',
        },
      ],
    },
    'mounted frames must receive only the normalized atoms from the current transaction',
  );
  assert.deepEqual(
    firstCanvasViewSnapshot.patches.find(patch => patch.path === '0/1' && patch.property === 'color'),
    { path: '0/1', property: 'color', value: 'blue' },
    'style atoms must normalize their property and keep only the latest value',
  );
  assert.equal(
    firstCanvasViewSnapshot.patches.filter(patch => patch.path === '0/1' && patch.property === 'color').length,
    1,
    'a complete view-state snapshot must never retain superseded style atoms',
  );
  assert.deepEqual(
    firstCanvasViewSnapshot.attributes.find(patch => patch.path === '0/1' && patch.name === 'aria-hidden'),
    { path: '0/1', name: 'aria-hidden', value: null },
    'attribute removal is a latest-write-wins atom, including normalized names',
  );
  assert.deepEqual(
    firstCanvasViewSnapshot.texts,
    [{ path: '0/1/0', value: 'Newest title' }],
    'text must compact by authored path so a missed frame needs only the newest snapshot',
  );
  assert.deepEqual(firstCanvasViewSnapshot.stylesheets, [{ path: 'src/style.css', cssText: '.card { display: flex; }' }]);
  assert.equal(firstCanvasViewSnapshot.designTokenCssText, ':root { --space: 8px; }');
  assert.deepEqual(
    firstCanvasViewSnapshot.ownerships,
    [
      {
        scope: 'selector',
        target: '.card',
        property: 'opacity',
        owned: true,
        breakpoint: 'base',
        pseudo: 'base',
      },
    ],
    'CSS Rule ownership must survive as a complete projection for replacement and passive canvases',
  );

  const secondCanvasViewSnapshot = canvasViewState.commitCanvasViewTransaction(
    canvasViewStore,
    {
      cssPath: 'src/style.css',
      cssText: '.card { display: grid; }',
      designTokenCssText: ':root { --space: 16px; }',
      patches: [
        { path: '0/1', property: 'color', value: 'rebeccapurple' },
        { path: '0/2', property: 'color', value: 'orange' },
      ],
      attributes: [{ path: '0/1', name: 'class', value: 'card selected' }],
      texts: [{ path: '0/1/0', value: 'Final title' }],
      ownerships: [
        {
          scope: 'selector',
          target: '.card',
          property: 'opacity',
          owned: false,
        },
        {
          scope: 'path',
          target: '0/2',
          property: 'transform',
          owned: true,
          breakpoint: 'mobile',
        },
      ],
    },
    4,
  );
  assert.equal(secondCanvasViewSnapshot.version, 2);
  assert.equal(secondCanvasViewSnapshot.revision, 9, 'a late persistence revision must never move the visual projection backwards');
  assert.deepEqual(
    secondCanvasViewSnapshot.stylesheets,
    [{ path: 'src/style.css', cssText: '.card { display: grid; }' }],
    'stylesheets must compact by source path with the newest complete CSS winning',
  );
  assert.equal(secondCanvasViewSnapshot.designTokenCssText, ':root { --space: 16px; }', 'design-token CSS must follow the same latest-write-wins projection');
  assert.equal(secondCanvasViewSnapshot.patches.find(patch => patch.path === '0/1' && patch.property === 'color')?.value, 'rebeccapurple');
  assert.equal(secondCanvasViewSnapshot.attributes.find(patch => patch.path === '0/1' && patch.name === 'class')?.value, 'card selected');
  assert.equal(secondCanvasViewSnapshot.texts[0]?.value, 'Final title');
  assert.deepEqual(
    secondCanvasViewSnapshot.ownerships,
    [
      {
        scope: 'path',
        target: '0/2',
        property: 'transform',
        owned: true,
        breakpoint: 'mobile',
        pseudo: 'base',
      },
    ],
    'latest ownership removal must discard an older selector while retaining unrelated properties',
  );
  assert.deepEqual(
    canvasViewState.latestCanvasViewStateDelta(canvasViewStore)?.ownerships,
    [
      {
        scope: 'selector',
        target: '.card',
        property: 'opacity',
        owned: false,
        breakpoint: 'base',
        pseudo: 'base',
      },
      {
        scope: 'path',
        target: '0/2',
        property: 'transform',
        owned: true,
        breakpoint: 'mobile',
        pseudo: 'base',
      },
    ],
    'mounted canvases must receive explicit ownership removals without a reload',
  );

  const thirdCanvasViewSnapshot = canvasViewState.commitCanvasViewTransaction(
    canvasViewStore,
    {
      cssPath: 'src/components.css',
      cssText: '.button { border-radius: 999px; }',
    },
    10,
  );
  assert.equal(thirdCanvasViewSnapshot.version, 3);
  assert.equal(thirdCanvasViewSnapshot.revision, 10);
  assert.deepEqual(
    canvasViewState.latestCanvasViewStateDelta(canvasViewStore)?.stylesheets,
    [
      {
        path: 'src/components.css',
        cssText: '.button { border-radius: 999px; }',
      },
    ],
    'an incremental commit must not retransmit unrelated stylesheet documents',
  );
  assert.deepEqual(
    thirdCanvasViewSnapshot.stylesheets,
    [
      { path: 'src/style.css', cssText: '.card { display: grid; }' },
      {
        path: 'src/components.css',
        cssText: '.button { border-radius: 999px; }',
      },
    ],
    'independent stylesheet atoms must survive while another stylesheet advances',
  );
  assert.equal(
    thirdCanvasViewSnapshot.designTokenCssText,
    ':root { --space: 16px; }',
    'omitting token CSS from a transaction must retain the latest token document',
  );

  const previousCanvasViewEpoch = canvasViewStore.epoch;
  canvasViewState.resetCanvasViewState(canvasViewStore, 24);
  const resetCanvasViewSnapshot = canvasViewState.snapshotCanvasViewState(canvasViewStore);
  assert.equal(resetCanvasViewSnapshot.epoch, previousCanvasViewEpoch + 1);
  assert.equal(resetCanvasViewSnapshot.version, 0);
  assert.equal(resetCanvasViewSnapshot.revision, 24);
  assert.equal(canvasViewState.latestCanvasViewStateDelta(canvasViewStore), null);
  assert.deepEqual(resetCanvasViewSnapshot.stylesheets, []);
  assert.deepEqual(resetCanvasViewSnapshot.patches, []);
  assert.deepEqual(resetCanvasViewSnapshot.attributes, []);
  assert.deepEqual(resetCanvasViewSnapshot.texts, []);
  assert.deepEqual(resetCanvasViewSnapshot.ownerships, []);
  assert.equal(
    Object.hasOwn(resetCanvasViewSnapshot, 'designTokenCssText'),
    false,
    'reset must start a clean epoch instead of leaking tokens from another page or canvas',
  );
  const postResetCanvasViewSnapshot = canvasViewState.commitCanvasViewTransaction(
    canvasViewStore,
    {
      patches: [{ path: '0', property: 'display', value: 'none', priority: 'important' }],
    },
    20,
  );
  assert.equal(postResetCanvasViewSnapshot.epoch, previousCanvasViewEpoch + 1);
  assert.equal(postResetCanvasViewSnapshot.version, 1);
  assert.equal(postResetCanvasViewSnapshot.revision, 24);
  assert.deepEqual(
    postResetCanvasViewSnapshot.patches,
    [{ path: '0', property: 'display', value: 'none', priority: 'important' }],
    'the first mutation after reset must contain only atoms from the new epoch',
  );
  assert.deepEqual(
    styles.diffStyleDeclarationDetails(
      'width: 100px !important; color: red !important',
      'width: 200px !important; color: red !important',
    ),
    [{ property: 'width', value: '200px', important: true }],
    'the mounted Canvas delta must change only the inline value and retain its authored priority',
  );
  assert.deepEqual(
    styles.diffStyleDeclarationDetails(
      'width: 200px !important',
      'width: 200px',
    ),
    [{ property: 'width', value: '200px', important: false }],
    'a priority-only source change must still repaint and remove priority from the live CSSOM',
  );
  assert.equal(
    interactions.interactionDuration({
      repeat: 1,
      actions: [
        {
          start: 0.25,
          duration: 0.5,
          keyframes: [],
          repeat: 2,
          repeatDelay: 0.1,
        },
      ],
    }),
    3.9,
    'timeline duration must include decimal action timing, repeat delays and the interaction repeat count',
  );
  assert.equal(interactions.normalizeInteractionRepeat(-1), -1, 'repeat -1 must remain the explicit infinite sentinel');
  assert.equal(interactions.normalizeInteractionRepeat(-0.25), 0, 'fractional negative repeats must normalize to no repeat');
  assert.equal(interactions.normalizeInteractionRepeat(-4), 0, 'negative repeats other than -1 must normalize to no repeat');
  assert.equal(interactions.normalizeInteractionRepeat(2.9), 2, 'fractional positive repeats must normalize to whole completed cycles');
  assert.equal(interactions.normalizeInteractionRepeat(Number.POSITIVE_INFINITY), 0, 'non-finite repeats must normalize safely');
  assert.equal(
    interactions.interactionDuration({
      repeat: -1,
      actions: [
        {
          start: 0.25,
          duration: 0.5,
          keyframes: [],
          repeat: -1,
          repeatDelay: 999,
        },
      ],
    }),
    0.75,
    'infinite action and interaction repeats must expose one finite editable cycle instead of a unbounded engine duration',
  );
  assert.equal(
    interactions.interactionDuration({
      repeat: 0,
      actions: [
        {
          start: 0,
          duration: 7_200.25,
          keyframes: [],
          repeat: 0,
          repeatDelay: 0,
        },
      ],
    }),
    7_200.25,
    'long finite interactions must retain their authored duration without an arbitrary one-hour cutoff',
  );
  const customAnimationBody = 'gsap.to(element, { opacity: 1 });';
  const customAnimationScaffold = interactions.customInteractionCodeScaffold({
    triggerSelector: '.hero-title',
    customEvent: 'hero:reveal',
    customCode: customAnimationBody,
  });
  assert.match(customAnimationScaffold, /querySelectorAll\("\.hero-title"\)/);
  assert.match(customAnimationScaffold, /addEventListener\("hero:reveal"/);
  assert.equal(
    interactions.customInteractionCodeBody(customAnimationScaffold),
    customAnimationBody,
    'the managed custom-event scaffold must round-trip only the user-authored animation body',
  );
  const retargetedCustomAnimationScaffold = interactions.customInteractionCodeScaffold({
    triggerSelector: '#hero-title',
    customEvent: 'hero:updated',
    customCode: customAnimationBody,
  });
  assert.match(retargetedCustomAnimationScaffold, /querySelectorAll\("#hero-title"\)/);
  assert.match(retargetedCustomAnimationScaffold, /addEventListener\("hero:updated"/);
  assert.match(retargetedCustomAnimationScaffold, /gsap\.to\(element, \{ opacity: 1 \}\)/);
  assert.doesNotMatch(retargetedCustomAnimationScaffold, /hero:reveal/);
  const normalizedRepeatDocument = JSON.parse(
    interactions.serializeInteractionDocument({
      version: 2,
      interactions: [
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'repeat-normalization',
          name: 'Repeat normalization',
          trigger: 'load',
          triggerSelector: 'body',
          triggerLabel: 'Body',
          triggerTargetMode: 'selector',
          repeat: 3.75,
          actions: [
            {
              ...interactions.createInteractionAction('animate'),
              repeat: -0.5,
              repeatDelay: -2,
            },
          ],
        },
      ],
    }),
  );
  assert.equal(normalizedRepeatDocument.interactions[0].repeat, 3);
  assert.equal(normalizedRepeatDocument.interactions[0].actions[0].repeat, 0);
  assert.equal(normalizedRepeatDocument.interactions[0].actions[0].repeatDelay, 0);
  assert.notEqual(
    interactions.interactionDocumentPath('a/b.html'),
    interactions.interactionDocumentPath('a__b.html'),
    'nested page paths and literal double underscores must never share one animation companion',
  );
  assert.notEqual(
    interactions.interactionDocumentPath('a b.html'),
    interactions.interactionDocumentPath('a-b.html'),
    'spaces and authored hyphens must never share one animation companion',
  );
  const legacyCompanionHtmlPath = 'legacy folder/page.html';
  const legacyCompanionPath = interactions.legacyInteractionDocumentPath(legacyCompanionHtmlPath);
  assert.notEqual(
    legacyCompanionPath,
    interactions.interactionDocumentPath(legacyCompanionHtmlPath),
    'the migration fixture must exercise the old flattened companion path',
  );
  const legacyCompanionInteraction = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'legacy-companion-interaction',
    name: 'Legacy companion interaction',
    trigger: 'click',
    triggerSelector: '#legacy-button',
    triggerLabel: '#legacy-button',
    triggerTargetMode: 'selector',
    actions: [interactions.actionFromPreset('fade-in')],
  };
  const legacyCompanionProject = {
    name: 'Legacy animation companion',
    mainHtmlPath: legacyCompanionHtmlPath,
    rootPath: '',
    openedAt: Date.now(),
    files: {
      [legacyCompanionHtmlPath]: {
        path: legacyCompanionHtmlPath,
        mimeType: 'text/html',
        text: '<!doctype html><html><body><button id="legacy-button">Legacy</button></body></html>',
      },
      [legacyCompanionPath]: {
        path: legacyCompanionPath,
        mimeType: 'application/json',
        text: interactions.serializeInteractionDocument({
          version: 2,
          interactions: [legacyCompanionInteraction],
        }),
      },
    },
  };
  assert.equal(
    interactions.readInteractionDocumentFile(legacyCompanionProject, legacyCompanionHtmlPath).interactions[0]?.id,
    legacyCompanionInteraction.id,
    'projects created with the legacy companion resolver must remain readable',
  );
  const partiallyMigratedCompanionProject = {
    ...legacyCompanionProject,
    files: {
      ...legacyCompanionProject.files,
      [interactions.interactionDocumentPath(legacyCompanionHtmlPath)]: {
        path: interactions.interactionDocumentPath(legacyCompanionHtmlPath),
        mimeType: 'application/json',
        text: JSON.stringify({ version: 2, interactions: [] }),
      },
    },
  };
  assert.equal(
    interactions.readInteractionDocumentFile(partiallyMigratedCompanionProject, legacyCompanionHtmlPath).interactions[0]?.id,
    legacyCompanionInteraction.id,
    'an empty canonical companion must not mask a populated legacy animation document during migration',
  );
  const collidingNestedPath = 'a/b.html';
  const collidingLiteralPath = 'a__b.html';
  const sharedLegacyCompanionPath = interactions.legacyInteractionDocumentPath(collidingNestedPath);
  assert.equal(
    sharedLegacyCompanionPath,
    interactions.interactionDocumentPath(collidingLiteralPath),
    'the collision fixture must share a legacy path with another page canonical path',
  );
  const collidingCompanionProject = {
    ...legacyCompanionProject,
    mainHtmlPath: collidingNestedPath,
    files: {
      [collidingNestedPath]: {
        path: collidingNestedPath,
        mimeType: 'text/html',
        text: '<!doctype html><html><body>Nested</body></html>',
      },
      [collidingLiteralPath]: {
        path: collidingLiteralPath,
        mimeType: 'text/html',
        text: '<!doctype html><html><body>Literal</body></html>',
      },
      [interactions.interactionDocumentPath(collidingNestedPath)]: {
        path: interactions.interactionDocumentPath(collidingNestedPath),
        mimeType: 'application/json',
        text: JSON.stringify({ version: 2, interactions: [] }),
      },
      [sharedLegacyCompanionPath]: {
        path: sharedLegacyCompanionPath,
        mimeType: 'application/json',
        text: interactions.serializeInteractionDocument({
          version: 2,
          interactions: [legacyCompanionInteraction],
        }),
      },
    },
  };
  assert.equal(
    interactions.readInteractionDocumentFile(collidingCompanionProject, collidingNestedPath).interactions.length,
    0,
    'a shared legacy companion must never resurrect another page animation over an empty canonical document',
  );
  assert.equal(
    interactions.readInteractionDocumentFile(collidingCompanionProject, collidingLiteralPath).interactions[0]?.id,
    legacyCompanionInteraction.id,
    'the page that owns the collision-free canonical path must retain its animation',
  );
  const legacyOnlySharedFiles = {
    ...collidingCompanionProject.files,
  };
  delete legacyOnlySharedFiles[interactions.interactionDocumentPath(collidingNestedPath)];
  assert.equal(
    interactions.readInteractionDocumentFile(
      {
        ...collidingCompanionProject,
        files: legacyOnlySharedFiles,
      },
      collidingNestedPath,
    ).interactions[0]?.id,
    legacyCompanionInteraction.id,
    'an ambiguous shared legacy file must remain recoverable until a canonical document exists',
  );
  const embeddedOlderInteraction = {
    ...legacyCompanionInteraction,
    id: 'embedded-older-interaction',
  };
  const dedicatedLegacyBeatsEmbeddedProject = {
    ...partiallyMigratedCompanionProject,
    files: {
      ...partiallyMigratedCompanionProject.files,
      [legacyCompanionHtmlPath]: {
        ...partiallyMigratedCompanionProject.files[legacyCompanionHtmlPath],
        text: interactions.patchInteractionDocument(partiallyMigratedCompanionProject.files[legacyCompanionHtmlPath].text, {
          version: 2,
          interactions: [embeddedOlderInteraction],
        }),
      },
    },
  };
  assert.equal(
    interactions.readInteractionDocumentFile(dedicatedLegacyBeatsEmbeddedProject, legacyCompanionHtmlPath).interactions[0]?.id,
    legacyCompanionInteraction.id,
    'an exclusive dedicated legacy companion must take precedence over an older embedded payload',
  );
  const authoritativeEmptyCompanionProject = {
    ...partiallyMigratedCompanionProject,
    files: {
      ...partiallyMigratedCompanionProject.files,
      [interactions.interactionDocumentPath(legacyCompanionHtmlPath)]: {
        path: interactions.interactionDocumentPath(legacyCompanionHtmlPath),
        mimeType: 'application/json',
        text: interactions.serializeInteractionDocument({ version: 2, interactions: [] }, { canonical: true }),
      },
    },
  };
  assert.equal(
    interactions.readInteractionDocumentFile(authoritativeEmptyCompanionProject, legacyCompanionHtmlPath).interactions.length,
    0,
    'an explicitly canonical empty document must remain authoritative over stale legacy payloads',
  );

  const savedInteractionFixture = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'saved-animation-source',
    name: 'Hero entrance',
    trigger: 'scroll',
    triggerSelector: '#hero',
    triggerLabel: '#hero',
    triggerTargetMode: 'selector',
    scrollTriggerSelector: '[id="story"]',
    scrollTriggerLabel: '#story',
    enabledBreakpoints: ['desktop', 'mobile'],
    actions: [
      {
        ...interactions.createInteractionAction('animate'),
        id: 'source-trigger-action',
        name: 'Animate hero',
        target: {
          selector: '#hero',
          label: '#hero',
          scope: 'document',
          mode: 'selector',
        },
        duration: 0.7,
        from: { opacity: 0, x: -24 },
        to: { opacity: 1, x: 0 },
        keyframes: [
          {
            id: 'source-trigger-start',
            time: 0,
            values: { opacity: 0, x: -24 },
          },
          {
            id: 'source-trigger-end',
            time: 0.7,
            values: { opacity: 1, x: 0 },
          },
        ],
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'source-external-action',
        name: 'Animate badge',
        target: {
          selector: '.badge',
          label: 'Badge',
          scope: 'document',
          mode: 'class',
        },
        from: { scale: 0.8 },
        to: { scale: 1 },
        keyframes: [
          {
            id: 'source-external-end',
            time: 0.5,
            values: { scale: 1 },
          },
        ],
      },
    ],
  };
  const savedInteractionPreset = interactions.createSavedInteractionPreset(savedInteractionFixture, '  Hero reutilizável  ');
  assert.equal(savedInteractionPreset.name, 'Hero reutilizável');
  assert.equal(
    Object.hasOwn(savedInteractionPreset.definition, 'triggerSelector'),
    false,
    'a saved animation must not retain the page-specific trigger selector',
  );
  assert.deepEqual(
    savedInteractionPreset.definition.actions[0].target,
    interactions.DEFAULT_ACTION_TARGET,
    'an action bound to the original trigger must become portable',
  );
  assert.deepEqual(
    savedInteractionPreset.definition.actions[1].target,
    savedInteractionFixture.actions[1].target,
    'an explicit external action target must survive saving unchanged',
  );
  assert.notEqual(
    savedInteractionPreset.definition.actions[0].id,
    savedInteractionFixture.actions[0].id,
    'saving must detach action identity from the live interaction',
  );
  assert.notEqual(
    savedInteractionPreset.definition.actions[0].keyframes[0].id,
    savedInteractionFixture.actions[0].keyframes[0].id,
    'saving must detach keyframe identity from the live interaction',
  );
  assert.equal(savedInteractionPreset.definition.scrollTriggerSelector, '');
  assert.equal(
    savedInteractionPreset.definition.scrollTriggerLabel,
    interactions.DEFAULT_INTERACTION.scrollTriggerLabel,
    'a page-specific Scroll Section must reset when an animation is saved',
  );
  assert.deepEqual(
    interactions.normalizeSavedInteractionPresets(JSON.parse(JSON.stringify({ presets: [savedInteractionPreset] }))),
    [savedInteractionPreset],
    'a normalized saved-animation library must round-trip through project JSON without drift',
  );
  const previousSavedPresetDomParser = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(input) {
      return new InteractionTestDocument(input);
    }
  };
  try {
    const equivalentIdentityFixture = {
      ...savedInteractionFixture,
      triggerSelector: '#hero',
      actions: [
        {
          ...savedInteractionFixture.actions[0],
          target: {
            selector: '[id="hero"]',
            label: 'Hero identity',
            scope: 'document',
            mode: 'element',
          },
        },
      ],
    };
    const equivalentIdentityPreset = interactions.createSavedInteractionPreset(
      equivalentIdentityFixture,
      'Equivalent identity',
      '<!doctype html><html><body><section id="hero"></section></body></html>',
    );
    assert.deepEqual(
      equivalentIdentityPreset.definition.actions[0].target,
      interactions.DEFAULT_ACTION_TARGET,
      'equivalent stable id selectors must become trigger-relative when saved',
    );
    const duplicateIdentityPreset = interactions.createSavedInteractionPreset(
      equivalentIdentityFixture,
      'Duplicate identity',
      '<!doctype html><html><body><section id="hero"></section><aside id="hero"></aside></body></html>',
    );
    assert.equal(
      duplicateIdentityPreset.definition.actions[0].target.scope,
      'document',
      'a duplicated authored id must not be inferred as the unique trigger target',
    );
    const genericSelectorFixture = {
      ...savedInteractionFixture,
      triggerSelector: '.card',
      actions: [
        {
          ...savedInteractionFixture.actions[0],
          target: {
            selector: '.card',
            label: 'Every card',
            scope: 'document',
            mode: 'class',
          },
        },
      ],
    };
    const genericSelectorPreset = interactions.createSavedInteractionPreset(
      genericSelectorFixture,
      'All cards',
      '<!doctype html><html><body><article class="card"></article></body></html>',
    );
    assert.equal(
      genericSelectorPreset.definition.actions[0].target.scope,
      'document',
      'a generic document selector must preserve its all-elements semantics even when only one match currently exists',
    );
    const invalidEscapeFixture = {
      ...savedInteractionFixture,
      triggerSelector: '#\\110000',
      actions: [
        {
          ...savedInteractionFixture.actions[0],
          target: {
            selector: '#\\110000',
            label: 'Invalid escaped id',
            scope: 'document',
            mode: 'element',
          },
        },
      ],
    };
    assert.doesNotThrow(
      () => interactions.createSavedInteractionPreset(invalidEscapeFixture, 'Invalid escape', '<!doctype html><html><body><section></section></body></html>'),
      'saving an animation must tolerate out-of-range CSS escapes',
    );
  } finally {
    if (previousSavedPresetDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousSavedPresetDomParser;
  }

  const savedTargetSource =
    '<!doctype html><html><head></head><body><button class="cta" data-kodety-interaction-id="saved-target">Apply</button></body></html>';
  const savedTargetSelection = {
    path: '0',
    tag: 'button',
    id: '',
    classes: ['cta'],
    attributes: {
      class: 'cta',
      'data-kodety-interaction-id': 'saved-target',
    },
    text: 'Apply',
    hasElementChildren: false,
    computedStyle: {},
  };
  const savedPresetBeforeApply = JSON.stringify(savedInteractionPreset);
  const firstSavedApplication = interactions.addInteractionFromSavedPreset(
    savedTargetSource,
    savedTargetSelection.path,
    savedTargetSelection,
    savedInteractionPreset,
  );
  const secondSavedApplication = interactions.addInteractionFromSavedPreset(
    firstSavedApplication.source,
    savedTargetSelection.path,
    savedTargetSelection,
    savedInteractionPreset,
  );
  assert.equal(
    interactions.readInteractionDocument(secondSavedApplication.source).interactions.length,
    2,
    'applying one saved animation twice must append two independent interactions',
  );
  assert.notEqual(
    firstSavedApplication.interaction.id,
    secondSavedApplication.interaction.id,
    'each saved-animation application must receive a fresh interaction id',
  );
  const appliedActionIds = [...firstSavedApplication.interaction.actions, ...secondSavedApplication.interaction.actions].map(action => action.id);
  assert.equal(new Set(appliedActionIds).size, appliedActionIds.length, 'each saved-animation application must receive fresh action ids');
  const appliedKeyframeIds = [...firstSavedApplication.interaction.actions, ...secondSavedApplication.interaction.actions].flatMap(action =>
    action.keyframes.map(keyframe => keyframe.id),
  );
  assert.equal(new Set(appliedKeyframeIds).size, appliedKeyframeIds.length, 'each saved-animation application must receive fresh keyframe ids');
  const presetActionIds = new Set(savedInteractionPreset.definition.actions.map(action => action.id));
  const presetKeyframeIds = new Set(savedInteractionPreset.definition.actions.flatMap(action => action.keyframes.map(keyframe => keyframe.id)));
  assert.equal(
    appliedActionIds.some(actionId => presetActionIds.has(actionId)),
    false,
    'applied interactions must not reuse action ids owned by the saved preset',
  );
  assert.equal(
    appliedKeyframeIds.some(keyframeId => presetKeyframeIds.has(keyframeId)),
    false,
    'applied interactions must not reuse keyframe ids owned by the saved preset',
  );
  assert.notEqual(
    firstSavedApplication.interaction.actions[0].from,
    savedInteractionPreset.definition.actions[0].from,
    'applying a preset must deep-clone mutable animation values',
  );
  assert.notEqual(
    firstSavedApplication.interaction.actions[0].keyframes[0].values,
    savedInteractionPreset.definition.actions[0].keyframes[0].values,
    'applying a preset must deep-clone mutable keyframe values',
  );
  assert.equal(JSON.stringify(savedInteractionPreset), savedPresetBeforeApply, 'applying a saved animation must not mutate its library entry');
  assert.equal(firstSavedApplication.interaction.scrollTriggerSelector, '', 'reusing a scroll animation must not inherit its original Scroll Section');
  assert.equal(firstSavedApplication.interaction.scrollTriggerLabel, interactions.DEFAULT_INTERACTION.scrollTriggerLabel);
  const triggerOverrideApplication = interactions.addInteractionFromSavedPreset(
    savedTargetSource,
    savedTargetSelection.path,
    savedTargetSelection,
    savedInteractionPreset,
    'click',
  );
  assert.equal(triggerOverrideApplication.interaction.trigger, 'click', 'a saved animation must accept a new trigger when it is applied');
  assert.equal(savedInteractionPreset.definition.trigger, 'scroll', 'a trigger override must not rewrite the saved preset');

  assert.deepEqual(
    interactionLibrary.parseNumericLayerText('R$ 1.234,50 mi'),
    { value: 1234.5, decimals: 2, prefix: 'R$ ', suffix: ' mi' },
    'Count Up must preserve localized numeric decoration while extracting its value',
  );
  assert.deepEqual(
    interactionLibrary.parseNumericLayerText('€ 1\u202f234,50'),
    { value: 1234.5, decimals: 2, prefix: '€ ', suffix: '' },
    'Count Up must parse grouped localized numbers after removing narrow spaces',
  );
  const retargetedCount = interactionLibrary.retargetInteractionLibraryDraft(
    interactionLibrary.createInteractionLibraryDraft('count-up', {
      ...layerNode({ tag: 'span', text: '10' }),
      path: '0',
    }),
    {
      ...layerNode({ tag: 'span', text: 'R$ 1 234,50' }),
      path: '1',
    },
  );
  assert.equal(retargetedCount.countTo, 1234.5);
  assert.equal(retargetedCount.countDecimals, 2);
  assert.equal(retargetedCount.countPrefix, 'R$ ');
  assert.equal(retargetedCount.targetChanged, true);
  assert.ok(interactionLibrary.INTERACTION_LIBRARY_CATALOG.length >= 30, 'the official Effects Library must include a broad high-end motion catalog');
  assert.equal(
    new Set(interactionLibrary.INTERACTION_LIBRARY_CATALOG.map(item => item.id)).size,
    interactionLibrary.INTERACTION_LIBRARY_CATALOG.length,
    'every official Library effect id must be unique',
  );
  assert.deepEqual(
    Object.fromEntries(
      ['entrance', 'hover', 'cursor', 'continuous', 'scroll'].map(activation => [
        activation,
        interactionLibrary.INTERACTION_LIBRARY_CATALOG.filter(item => item.activation === activation).map(item => item.id),
      ]),
    ),
    {
      entrance: [
        'fade-in',
        'fade-up',
        'fade-down',
        'fade-left',
        'fade-right',
        'scale-in',
        'zoom-out',
        'rotate-in',
        'blur-reveal',
        'mask-reveal',
        'clip-up',
        'text-words',
        'text-chars',
        'text-lines',
        'text-blur-words',
        'stagger-children',
        'count-up',
      ],
      hover: ['text-roll-whole', 'text-roll-words', 'text-roll-chars', 'hover-lift', 'hover-scale'],
      cursor: ['magnetic'],
      continuous: ['ticker-infinite', 'ticker-infinite-reverse'],
      scroll: ['parallax-y', 'scroll-scale', 'scroll-rotate', 'image-sequence', 'video-scrub'],
    },
    'every Library effect must advertise the same activation moment users experience at runtime',
  );
  const libraryIdsFor = (activation, category) =>
    interactionLibrary.INTERACTION_LIBRARY_CATALOG.filter(item => item.activation === activation && item.category === category).map(item => item.id);
  assert.deepEqual(
    libraryIdsFor('hover', 'Text'),
    ['text-roll-whole', 'text-roll-words', 'text-roll-chars'],
    'Hover + Texto must isolate the three Text Roll variants',
  );
  assert.deepEqual(libraryIdsFor('hover', 'Pointer'), ['hover-lift', 'hover-scale'], 'Hover + Pointer must isolate direct hover effects');
  assert.deepEqual(libraryIdsFor('cursor', 'Pointer'), ['magnetic'], 'Cursor + Pointer must isolate Magnetic');
  assert.equal(libraryIdsFor('scroll', 'Scroll').length, 5);
  const librarySequenceSource =
    '<!doctype html><html><head></head><body><img src="frames/poster.webp" data-kodety-interaction-id="product-sequence" alt=""><section id="story-one"></section><section id="story-two"></section></body></html>';
  const librarySequenceSelection = {
    path: '0',
    tag: 'img',
    id: '',
    classes: [],
    attributes: {
      src: 'frames/poster.webp',
      'data-kodety-interaction-id': 'product-sequence',
    },
    text: '',
    hasElementChildren: false,
    computedStyle: {},
  };
  const sequenceDraft = interactionLibrary.createInteractionLibraryDraft('image-sequence', librarySequenceSelection);
  sequenceDraft.imageUrlTemplate = 'https://cdn.example.com/product/frame_{index:04}.webp';
  sequenceDraft.imageStartIndex = 1;
  sequenceDraft.imageEndIndex = 120;
  sequenceDraft.imageZeroPad = 2;
  sequenceDraft.milestones = [
    {
      ...interactionLibrary.sectionMilestone({ id: 'story-one', label: 'Story one' }, 1, 0.85),
      elementAnchor: 0.5,
    },
    {
      ...interactionLibrary.sectionMilestone({ id: 'story-one', label: 'Story one' }, 24, 0.5),
      elementAnchor: 0.5,
    },
    interactionLibrary.sectionMilestone({ id: 'story-two', label: 'Story two' }, 120, 0.76),
  ];
  const appliedSequence = interactionLibrary.addInteractionFromLibrary(librarySequenceSource, sequenceDraft);
  const sequenceInteraction = interactions.readInteractionDocument(appliedSequence.source).interactions[0];
  assert.equal(sequenceInteraction.libraryEffectId, 'image-sequence');
  assert.equal(sequenceInteraction.trigger, 'scroll');
  assert.equal(sequenceInteraction.actions.length, 0);
  assert.equal(sequenceInteraction.behavior?.kind, 'image-sequence');
  assert.equal(sequenceInteraction.behavior?.urlTemplate, 'https://cdn.example.com/product/frame_{index}.webp');
  assert.equal(sequenceInteraction.behavior?.zeroPad, 4);
  assert.deepEqual(
    sequenceInteraction.behavior?.milestones.map(milestone => ({
      selector: milestone.selector,
      value: milestone.value,
      elementAnchor: milestone.elementAnchor,
      viewportAnchor: milestone.viewportAnchor,
    })),
    [
      {
        selector: '[id="story-one"]',
        value: 1,
        elementAnchor: 0.5,
        viewportAnchor: 0.85,
      },
      {
        selector: '[id="story-one"]',
        value: 24,
        elementAnchor: 0.5,
        viewportAnchor: 0.5,
      },
      {
        selector: '[id="story-two"]',
        value: 120,
        elementAnchor: 0,
        viewportAnchor: 0.76,
      },
    ],
    'sequence checkpoints must preserve repeated sections with independent anchors',
  );
  const sequenceRoundTrip = interactions.parseInteractionDocumentText(
    interactions.serializeInteractionDocument({
      version: 2,
      interactions: [sequenceInteraction],
    }),
  );
  assert.deepEqual(
    sequenceRoundTrip?.interactions[0].behavior,
    sequenceInteraction.behavior,
    'Library behavior settings must survive the canonical interaction document round-trip',
  );
  assert.match(
    appliedSequence.source,
    /installImageSequenceBehavior[\s\S]*?activeLoads < 6[\s\S]*?destroyed[\s\S]*?loader\.decode[\s\S]*?desiredIndex !== index/,
    'published interaction runtime must bound image requests and ignore stale decoded frames',
  );
  assert.ok(appliedSequence.source.includes('/\\{index(?::(\\d+))?\\}/g'), 'the materialized runtime must preserve escaped inline zero-padding tokens');
  const invalidSequenceDraft = {
    ...sequenceDraft,
    imageUrlTemplate: '/images/frame_{index}.webp',
  };
  assert.throws(
    () => interactionLibrary.addInteractionFromLibrary(librarySequenceSource, invalidSequenceDraft),
    /URL https:\/\//,
    'root-relative frame patterns must be rejected because publication routes can live below the domain root',
  );
  assert.throws(
    () =>
      interactionLibrary.addInteractionFromLibrary(librarySequenceSource, {
        ...sequenceDraft,
        imageUrlTemplate: 'http://cdn.example.com/frame_{index}.webp',
      }),
    /URL https:\/\//,
    'frame URL validation must use an explicit HTTPS or project-relative allowlist',
  );
  assert.throws(
    () =>
      interactionLibrary.addInteractionFromLibrary(librarySequenceSource, {
        ...sequenceDraft,
        imageUrlTemplate: 'frames/frame.webp',
      }),
    /exatamente um \{index\}/,
    'a sequence pattern without an index token must be rejected',
  );
  assert.throws(
    () =>
      interactionLibrary.addInteractionFromLibrary(librarySequenceSource, {
        ...sequenceDraft,
        imageUrlTemplate: 'frames/frame_{index:99}.webp',
      }),
    /padding inline/,
    'inline zero padding must be bounded before it reaches String.padStart',
  );
  const relativeSequence = interactionLibrary.addInteractionFromLibrary(librarySequenceSource, {
    ...sequenceDraft,
    imageUrlTemplate: 'frames/frame_{index}.webp',
  });
  assert.equal(relativeSequence.interaction.behavior?.kind, 'image-sequence');
  assert.throws(
    () =>
      interactionLibrary.addInteractionFromLibrary(librarySequenceSource, {
        ...sequenceDraft,
        target: { ...librarySequenceSelection, tag: 'div' },
      }),
    /layer de imagem/,
    'Image Sequence must reject a target that cannot render image frames',
  );
  assert.throws(
    () =>
      interactionLibrary.addInteractionFromLibrary(librarySequenceSource, {
        ...sequenceDraft,
        milestones: sequenceDraft.milestones.slice(0, 2).map(milestone => ({
          ...milestone,
          selector: '',
        })),
      }),
    /checkpoint 1/,
    'two empty milestone selectors must not normalize into a silent no-op sequence',
  );
  assert.throws(
    () =>
      interactionLibrary.addInteractionFromLibrary(librarySequenceSource, {
        ...sequenceDraft,
        milestones: sequenceDraft.milestones.map((milestone, index) => (index === 0 ? { ...milestone, selector: '[' } : milestone)),
      }),
    /não existe mais na página/,
    'invalid or removed Scroll Section selectors must be rejected before persistence',
  );
  const malformedLibrarySource = interactions.updateInteraction(appliedSequence.source, sequenceInteraction.id, interaction => ({
    ...interaction,
    libraryEffectId: 'legacy-image-sequence-v0',
  }));
  const malformedLibraryInteraction = interactions.readInteractionDocument(malformedLibrarySource).interactions[0];
  const recoveredDraft = interactionLibrary.interactionLibraryDraftFromDefinition(malformedLibraryInteraction, {
    ...librarySequenceSelection,
    path: '99',
    tag: 'div',
    text: 'Unrelated selection',
  });
  assert.equal(recoveredDraft.effectId, 'image-sequence');
  assert.equal(recoveredDraft.targetChanged, false);
  const recoveredLibrary = interactionLibrary.updateInteractionFromLibrary(malformedLibrarySource, malformedLibraryInteraction.id, {
    ...recoveredDraft,
    imagePreloadRadius: 5,
    enabled: false,
  });
  assert.equal(recoveredLibrary.interaction.behavior?.kind, 'image-sequence');
  assert.equal(
    recoveredLibrary.interaction.triggerSelector,
    malformedLibraryInteraction.triggerSelector,
    'saving behavior settings must preserve the persisted target until the picker explicitly changes it',
  );
  assert.equal(recoveredLibrary.interaction.behavior?.preloadRadius, 5);
  assert.equal(recoveredLibrary.interaction.enabled, false);

  const retargetPageSource =
    '<!doctype html><html><head></head><body><img data-kodety-interaction-id="sequence-primary" alt=""><img data-kodety-interaction-id="sequence-secondary" alt=""><section id="story-one"></section><section id="story-two"></section></body></html>';
  const primarySequenceSelection = {
    ...librarySequenceSelection,
    path: '0',
    attributes: { 'data-kodety-interaction-id': 'sequence-primary' },
  };
  const secondarySequenceSelection = {
    ...librarySequenceSelection,
    path: '1',
    attributes: { 'data-kodety-interaction-id': 'sequence-secondary' },
  };
  const retargetSequenceDraft = interactionLibrary.createInteractionLibraryDraft('image-sequence', primarySequenceSelection);
  retargetSequenceDraft.imageUrlTemplate = 'frames/frame_{index}.webp';
  retargetSequenceDraft.imageEndIndex = 10;
  retargetSequenceDraft.milestones = [
    interactionLibrary.sectionMilestone({ id: 'story-one', label: 'Story one' }, 0, 0.85),
    interactionLibrary.sectionMilestone({ id: 'story-two', label: 'Story two' }, 10, 0.5),
  ];
  const createdRetargetSequence = interactionLibrary.addInteractionFromLibrary(retargetPageSource, retargetSequenceDraft);
  const explicitRetargetDraft = interactionLibrary.retargetInteractionLibraryDraft(
    interactionLibrary.interactionLibraryDraftFromDefinition(createdRetargetSequence.interaction, primarySequenceSelection),
    secondarySequenceSelection,
  );
  const explicitlyRetargeted = interactionLibrary.updateInteractionFromLibrary(
    createdRetargetSequence.source,
    createdRetargetSequence.interaction.id,
    explicitRetargetDraft,
  );
  assert.match(explicitlyRetargeted.interaction.triggerSelector, /sequence-secondary/);
  assert.equal(
    interactions.readInteractionDocument(explicitlyRetargeted.source).interactions.length,
    1,
    'retargeting must keep the same interaction instead of creating a duplicate undo entry',
  );

  const libraryButtonSource = '<!doctype html><html><head></head><body><button data-kodety-interaction-id="library-button">Start</button></body></html>';
  const libraryButtonSelection = {
    ...librarySequenceSelection,
    tag: 'button',
    attributes: { 'data-kodety-interaction-id': 'library-button' },
    text: 'Start',
  };
  const hoverLibrary = interactionLibrary.addInteractionFromLibrary(
    libraryButtonSource,
    interactionLibrary.createInteractionLibraryDraft('hover-lift', libraryButtonSelection),
  );
  assert.equal(hoverLibrary.interaction.trigger, 'hover');
  assert.equal(hoverLibrary.interaction.actions[0]?.name, 'Hover lift');
  const textRollLibrary = interactionLibrary.addInteractionFromLibrary(
    libraryButtonSource,
    interactionLibrary.createInteractionLibraryDraft('text-roll-words', libraryButtonSelection),
  );
  assert.equal(textRollLibrary.interaction.trigger, 'hover');
  assert.equal(textRollLibrary.interaction.actions.length, 0);
  assert.equal(textRollLibrary.interaction.behavior?.kind, 'text-roll');
  assert.equal(textRollLibrary.interaction.behavior?.split, 'words');
  assert.match(
    textRollLibrary.source,
    /installTextRollBehavior[\s\S]*?kodetyTextRollCopy[\s\S]*?pointerenter[\s\S]*?timeline\.reverse/,
    'Text Roll must duplicate a simple label and support reversible pointer/focus motion',
  );
  assert.match(
    textRollLibrary.source,
    /globalThis\.Intl\?\.Segmenter[\s\S]*?text: \(element\.textContent \|\| ''\)\.trim\(\)[\s\S]*?if \(copy\) line\.setAttribute\('aria-hidden', 'true'\)[\s\S]*?hovered \|\| focused[\s\S]*?if \(!editorFrozen\) \{/,
    'Text Roll must preserve graphemes, ignore authored indentation, keep one accessible line, reconcile hover with focus and isolate frozen previews',
  );
  assert.match(
    textRollLibrary.source,
    /seek: nextTime => \{\s*stopPlayback\(\);\s*pause\?\.\(\);\s*renderTime\(nextTime\);/,
    'seeking a Library behavior must stop its private preview clock before fixing the requested frame',
  );
  for (const [effectId, split] of [
    ['text-roll-whole', 'whole'],
    ['text-roll-words', 'words'],
    ['text-roll-chars', 'chars'],
  ]) {
    const variant = interactionLibrary.addInteractionFromLibrary(
      libraryButtonSource,
      interactionLibrary.createInteractionLibraryDraft(effectId, libraryButtonSelection),
    );
    assert.equal(variant.interaction.libraryEffectId, effectId);
    assert.equal(variant.interaction.behavior?.kind, 'text-roll');
    assert.equal(variant.interaction.behavior?.split, split);
    const variantRoundTrip = interactions.parseInteractionDocumentText(
      interactions.serializeInteractionDocument({
        version: 2,
        interactions: [variant.interaction],
      }),
    );
    assert.equal(variantRoundTrip?.interactions[0].libraryEffectId, effectId);
    assert.equal(variantRoundTrip?.interactions[0].behavior?.split, split);
  }
  const normalizedMixedBehavior = interactions.parseInteractionDocumentText(
    JSON.stringify({
      version: 2,
      interactions: [
        {
          ...textRollLibrary.interaction,
          actions: hoverLibrary.interaction.actions,
        },
      ],
    }),
  );
  assert.equal(normalizedMixedBehavior?.interactions[0].behavior?.kind, 'text-roll');
  assert.equal(normalizedMixedBehavior?.interactions[0].actions.length, 0, 'a Library behavior must remain isolated from imported normal timeline actions');

  const tickerSource = '<!doctype html><html><head></head><body><div data-kodety-interaction-id="ticker-strip"><span>Studio</span><span>Motion</span><span>Loop</span></div></body></html>';
  const tickerSelection = {
    ...libraryButtonSelection,
    tag: 'div',
    attributes: { 'data-kodety-interaction-id': 'ticker-strip' },
    text: 'Studio Motion Loop',
    hasElementChildren: true,
  };
  const tickerDraft = interactionLibrary.createInteractionLibraryDraft('ticker-infinite', tickerSelection);
  tickerDraft.tickerSpeed = 72;
  tickerDraft.tickerGap = 24;
  tickerDraft.tickerHoverBehavior = 'slow';
  tickerDraft.tickerHoverSlowdown = 0.22;
  tickerDraft.tickerHoverTransition = 0.3;
  tickerDraft.tickerDraggable = true;
  tickerDraft.tickerDragSensitivity = 1.25;
  tickerDraft.tickerMomentum = 0.91;
  const tickerLibrary = interactionLibrary.addInteractionFromLibrary(tickerSource, tickerDraft);
  assert.equal(tickerLibrary.interaction.libraryEffectId, 'ticker-infinite');
  assert.equal(tickerLibrary.interaction.trigger, 'load');
  assert.equal(tickerLibrary.interaction.actions.length, 0);
  assert.equal(tickerLibrary.interaction.reducedMotion, 'skip');
  assert.deepEqual(tickerLibrary.interaction.behavior, {
    kind: 'ticker',
    target: interactions.DEFAULT_ACTION_TARGET,
    direction: 'left',
    speed: 72,
    gap: 24,
    hoverBehavior: 'slow',
    hoverSlowdown: 0.22,
    hoverTransition: 0.3,
    draggable: true,
    dragSensitivity: 1.25,
    momentum: 0.91,
  });
  const tickerRoundTrip = interactions.parseInteractionDocumentText(
    interactions.serializeInteractionDocument({
      version: 2,
      interactions: [tickerLibrary.interaction],
    }),
  );
  assert.deepEqual(
    tickerRoundTrip?.interactions[0].behavior,
    tickerLibrary.interaction.behavior,
    'Ticker direction, hover, drag and momentum settings must survive the canonical document round-trip',
  );
  const reverseTickerDraft = interactionLibrary.createInteractionLibraryDraft('ticker-infinite-reverse', tickerSelection);
  const reverseTicker = interactionLibrary.addInteractionFromLibrary(tickerSource, reverseTickerDraft);
  assert.equal(reverseTicker.interaction.libraryEffectId, 'ticker-infinite-reverse');
  assert.equal(reverseTicker.interaction.behavior?.kind, 'ticker');
  assert.equal(reverseTicker.interaction.behavior?.direction, 'right');
  assert.throws(
    () => interactionLibrary.addInteractionFromLibrary(tickerSource, {
      ...tickerDraft,
      target: { ...tickerSelection, hasElementChildren: false },
    }),
    /container com elementos filhos/,
    'Ticker must reject a leaf target that cannot provide one repeatable cycle',
  );
  assert.match(
    tickerLibrary.source,
    /installTickerBehavior[\s\S]*?positiveModulo[\s\S]*?sideCopies[\s\S]*?replaceChildren\(\.\.\.before, record\.group, \.\.\.after\)[\s\S]*?translate3d/,
    'Ticker must fill both sides with measured copies and wrap its phase without a visible position reset',
  );
  assert.match(
    tickerLibrary.source,
    /kodetyTickerClone[\s\S]*?aria-hidden[\s\S]*?clone\.inert = true[\s\S]*?pointerEvents = 'none'/,
    'Ticker clones must be inert and inaccessible',
  );
  assert.match(
    tickerLibrary.source,
    /baseTargetsFor[\s\S]*?element\.closest\?\.\('\[data-kodety-ticker-clone\]'\)/,
    'Ticker clones must be excluded from all later interaction target resolution',
  );
  assert.ok(
    ['hoverBehavior', 'hoverSlowdown', 'hoverTransition', 'Math.exp'].every(token => tickerLibrary.source.includes(token)),
    'Ticker must support eased hover pause and slowdown',
  );
  assert.ok(
    ['momentumVelocity', 'suppressClickUntil', 'pointerdown', 'pointermove', 'pointerup'].every(token => tickerLibrary.source.includes(token)),
    'Ticker must support pointer drag, momentum and accidental-link suppression',
  );
  assert.match(
    tickerLibrary.source,
    /ResizeObserver[\s\S]*?MutationObserver[\s\S]*?document\.fonts\?\.ready[\s\S]*?replaceChildren\(\.\.\.Array\.from\(record\.group\.childNodes\)\)/,
    'Ticker must remeasure responsive/content changes and restore the exact authored children on cleanup',
  );
  const parallaxLibrary = interactionLibrary.addInteractionFromLibrary(
    libraryButtonSource,
    interactionLibrary.createInteractionLibraryDraft('parallax-y', libraryButtonSelection),
  );
  assert.equal(parallaxLibrary.interaction.trigger, 'scroll');
  assert.equal(parallaxLibrary.interaction.scrollScrub, true);
  assert.equal(parallaxLibrary.interaction.scrollStart, 'top bottom');

  const libraryVideoSource =
    '<!doctype html><html><head></head><body><video src="product.mp4" data-kodety-interaction-id="product-video" muted playsinline></video><section id="story-one"></section><section id="story-two"></section></body></html>';
  const libraryVideoSelection = {
    ...librarySequenceSelection,
    tag: 'video',
    attributes: {
      src: 'product.mp4',
      'data-kodety-interaction-id': 'product-video',
      muted: '',
      playsinline: '',
    },
  };
  const videoDraft = interactionLibrary.createInteractionLibraryDraft('video-scrub', libraryVideoSelection);
  videoDraft.milestones = [
    interactionLibrary.sectionMilestone({ id: 'story-one', label: 'Story one' }, 0, 0.85),
    interactionLibrary.sectionMilestone({ id: 'story-two', label: 'Story two' }, 9.5, 0.5),
  ];
  const appliedVideo = interactionLibrary.addInteractionFromLibrary(libraryVideoSource, videoDraft);
  assert.equal(appliedVideo.interaction.behavior?.kind, 'video-scrub');
  assert.equal(appliedVideo.interaction.actions.length, 0);
  assert.deepEqual(
    appliedVideo.interaction.behavior?.milestones.map(item => item.value),
    [0, 9.5],
  );
  const videoRoundTrip = interactions.parseInteractionDocumentText(
    interactions.serializeInteractionDocument({
      version: 2,
      interactions: [appliedVideo.interaction],
    }),
  );
  assert.deepEqual(
    videoRoundTrip?.interactions[0].behavior,
    appliedVideo.interaction.behavior,
    'Video Scrub settings and checkpoints must survive the canonical document round-trip',
  );
  assert.equal(videoRoundTrip?.interactions[0].actions.length, 0);
  assert.match(
    appliedVideo.source,
    /installVideoScrubBehavior[\s\S]*?desiredTimeFor[\s\S]*?needsAdvance[\s\S]*?loadeddata[\s\S]*?seeked[\s\S]*?activationToken/,
    'video scrub runtime must avoid spinning while media is unavailable or an async seek is pending',
  );

  const selectorModeSource = '<!doctype html><html><body><button class="target">Target</button></body></html>';
  const selectorModeSelection = {
    path: '0',
    tag: 'button',
    id: '',
    classes: ['target'],
    attributes: { class: 'target' },
    text: 'Target',
    hasElementChildren: false,
    computedStyle: {},
  };
  const selectorModeTarget = interactions.ensureInteractionSelector(selectorModeSource, selectorModeSelection.path, selectorModeSelection, 'selector');
  assert.equal(selectorModeTarget.mode, 'selector', 'selector mode without an authored id must remain selector mode');
  assert.match(
    selectorModeTarget.selector,
    /^\[data-kodety-interaction-id="element-[^"]+"\]$/,
    'selector mode without an id must receive one stable attribute selector',
  );
  assert.match(selectorModeTarget.source, /data-kodety-interaction-id="element-[^"]+"/, 'the generated selector must be materialized in the authored element');
  assert.equal(
    interactions.inferInteractionTargetMode('[data-kodety-interaction-id="case-ampere"]', 'Case Study Ampère', 'element'),
    'selector',
    'an imported explicit selector must repair a stale Element declaration automatically',
  );
  assert.equal(
    interactions.inferInteractionTargetMode('[data-kodety-interaction-id="target"]', '.target', 'element'),
    'element',
    'an element picked by the Builder must retain its explicit element binding',
  );
  assert.equal(
    interactions.inferInteractionTargetMode('.shared-card', 'Cards', 'element'),
    'class',
    'a simple class selector must repair a stale Element declaration automatically',
  );
  assert.equal(
    interactions.inferInteractionTargetMode('.shared-card[data-active]', 'Active cards', 'class'),
    'selector',
    'a compound selector must repair a stale Class declaration automatically',
  );
  const inferredModeDocument = JSON.parse(
    interactions.serializeInteractionDocument({
      version: 2,
      interactions: [
        {
          ...savedInteractionFixture,
          id: 'inferred-target-modes',
          triggerSelector: '[data-kodety-interaction-id="case-ampere"]',
          triggerLabel: 'Case Study Ampère',
          triggerTargetMode: 'element',
          actions: [
            {
              ...interactions.actionFromPreset('fade-in'),
              target: {
                selector: '.case-card',
                label: 'Case cards',
                scope: 'document',
                mode: 'element',
              },
            },
          ],
        },
      ],
    }),
  );
  assert.equal(inferredModeDocument.interactions[0].triggerTargetMode, 'selector', 'serialization must persist the automatically corrected trigger mode');
  assert.equal(
    inferredModeDocument.interactions[0].actions[0].target.mode,
    'class',
    'serialization must persist the automatically corrected action target mode',
  );
  const numericClassTarget = interactions.ensureInteractionSelector(
    selectorModeSource.replace('class="target"', 'class="2hero"'),
    selectorModeSelection.path,
    {
      ...selectorModeSelection,
      classes: ['2hero'],
      attributes: { class: '2hero' },
    },
    'class',
  );
  assert.equal(numericClassTarget.selector, '.\\32 hero', 'a class beginning with a digit must use a valid CSS identifier escape');
  const staleIdentitySource = '<!doctype html><html><body><button id="new-id" class="new-class">Target</button></body></html>';
  const staleIdentitySelection = {
    ...selectorModeSelection,
    id: 'old-id',
    classes: ['old-class'],
    attributes: { id: 'old-id', class: 'old-class' },
  };
  assert.equal(
    interactions.ensureInteractionSelector(staleIdentitySource, staleIdentitySelection.path, staleIdentitySelection, 'selector').selector,
    '[id="new-id"]',
    'selector binding must trust the current authored id over a stale selection snapshot',
  );
  assert.equal(
    interactions.ensureInteractionSelector(staleIdentitySource, staleIdentitySelection.path, staleIdentitySelection, 'class').selector,
    '.new-class',
    'class binding must trust the current authored class over a stale selection snapshot',
  );
  const staleMissingIdentity = interactions.ensureInteractionSelector(
    '<!doctype html><html><body><button>Target</button></body></html>',
    staleIdentitySelection.path,
    staleIdentitySelection,
    'selector',
  );
  assert.notEqual(staleMissingIdentity.selector, '[id="old-id"]', 'a removed authored id must not be resurrected from a stale selection snapshot');
  assert.match(
    staleMissingIdentity.source,
    /data-kodety-interaction-id="element-[^"]+"/,
    'a stale missing identity must receive a real stable selector in the current source',
  );
  const duplicateElementIdSource =
    '<!doctype html><html><body><section data-kodety-interaction-id="hero"></section><section data-kodety-interaction-id="hero"></section></body></html>';
  const duplicateElementIdResult = interactions.ensureInteractionSelector(
    duplicateElementIdSource,
    '1',
    {
      path: '1',
      tag: 'section',
      id: '',
      classes: [],
      attributes: { 'data-kodety-interaction-id': 'hero' },
      text: '',
      hasElementChildren: false,
      computedStyle: {},
    },
    'element',
  );
  assert.notEqual(
    duplicateElementIdResult.selector,
    '[data-kodety-interaction-id="hero"]',
    'binding a duplicated group id must isolate the selected group with a fresh identity',
  );
  assert.equal(
    Array.from(duplicateElementIdResult.source.matchAll(/data-kodety-interaction-id="hero"/g)).length,
    1,
    'repairing one duplicated group id must leave only one owner of the original identity',
  );
  const emptySelectorDocument = JSON.parse(
    interactions.serializeInteractionDocument({
      version: 2,
      interactions: [
        {
          ...savedInteractionFixture,
          id: 'empty-selector-interaction',
          triggerSelector: '',
          triggerLabel: '',
          triggerTargetMode: 'selector',
        },
      ],
    }),
  );
  assert.equal(emptySelectorDocument.interactions[0].triggerSelector, '', 'an explicitly empty custom selector must never normalize to body');

  const groupSelection = {
    path: '0',
    tag: 'section',
    id: '',
    classes: ['motion-group'],
    attributes: {
      class: 'motion-group',
      'data-kodety-interaction-id': 'hero',
    },
    text: '',
    hasElementChildren: true,
    computedStyle: {},
  };
  const childOneSelection = {
    path: '0/0',
    tag: 'article',
    id: '',
    classes: ['child-one'],
    attributes: { class: 'child-one' },
    text: '',
    hasElementChildren: true,
    computedStyle: {},
  };
  const deepChildSelection = {
    path: '0/0/0',
    tag: 'span',
    id: '',
    classes: ['deep-one'],
    attributes: { class: 'deep-one' },
    text: '',
    hasElementChildren: false,
    computedStyle: {},
  };
  const groupInteractionFixture = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'group-interaction',
    name: 'Grouped interaction',
    trigger: 'click',
    triggerSelector: '[data-kodety-interaction-id="hero"]',
    triggerLabel: 'Hero group',
    triggerTargetMode: 'element',
    actions: [
      {
        ...interactions.createInteractionAction('animate'),
        id: 'group-trigger-action',
        name: 'Animate group',
        target: { ...interactions.DEFAULT_ACTION_TARGET },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'group-child-action',
        name: 'Animate direct child',
        target: {
          selector: '.child-one',
          label: 'Child one',
          scope: 'children',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'group-deep-action',
        name: 'Animate descendant',
        target: {
          selector: '.deep-one',
          label: 'Deep child',
          scope: 'descendants',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'group-external-action',
        name: 'Animate external target',
        target: {
          selector: '.external-target',
          label: 'External target',
          scope: 'document',
          mode: 'class',
        },
      },
    ],
  };
  assert.deepEqual(
    interactions.interactionTimelineForSelection(groupInteractionFixture, groupSelection)?.actions.map(action => action.id),
    groupInteractionFixture.actions.map(action => action.id),
    'selecting the group trigger must expose its complete authored timeline',
  );
  assert.deepEqual(
    interactions.interactionTimelineForSelection(groupInteractionFixture, childOneSelection)?.actions.map(action => action.id),
    ['group-child-action'],
    'selecting one direct child must expose only the action scoped to that child',
  );
  assert.deepEqual(
    interactions.interactionTimelineForSelection(groupInteractionFixture, deepChildSelection)?.actions.map(action => action.id),
    ['group-deep-action'],
    'selecting one descendant must not inherit the group trigger or sibling actions',
  );
  assert.equal(
    interactions.interactionMatchesSelection(
      {
        ...groupInteractionFixture,
        id: 'similar-id-interaction',
        triggerSelector: '[data-kodety-interaction-id="hero-child"]',
        actions: [],
      },
      groupSelection,
    ),
    false,
    'interaction id hero must not match a selector bound to hero-child',
  );
  assert.equal(
    interactions.interactionMatchesSelection(
      {
        ...groupInteractionFixture,
        id: 'descendant-selector-interaction',
        triggerSelector: '.motion-group .child-one',
        actions: [],
      },
      groupSelection,
    ),
    false,
    'a descendant selector must not make its ancestor an exact interaction match',
  );
  assert.equal(
    interactions.interactionMatchesSelection(
      {
        ...groupInteractionFixture,
        id: 'descendant-id-selector-interaction',
        triggerSelector: '[data-kodety-interaction-id="hero"] .child-one',
        actions: [],
      },
      groupSelection,
    ),
    false,
    'a descendant selector containing the group id must not match the group itself',
  );
  assert.equal(
    interactions.interactionMatchesSelection(
      {
        ...groupInteractionFixture,
        id: 'compound-selector-interaction',
        triggerSelector: 'section.other',
        actions: [],
      },
      groupSelection,
    ),
    false,
    'a compound selector must satisfy its tag and class instead of matching on the tag alone',
  );
  assert.equal(
    interactions.interactionMatchesSelection(
      {
        ...groupInteractionFixture,
        id: 'compound-positive-selector-interaction',
        triggerSelector: 'section.motion-group:not(.other)',
        actions: [],
      },
      groupSelection,
    ),
    true,
    'the snapshot fallback must retain complete compound and :not semantics for the selected group',
  );
  assert.equal(
    interactions.interactionMatchesSelection(
      {
        ...groupInteractionFixture,
        id: 'missing-id-attribute-interaction',
        triggerSelector: '[id]',
        actions: [],
      },
      { ...groupSelection, id: '', attributes: { class: 'motion-group' } },
    ),
    false,
    'an absent id attribute must not be treated as an authored empty id',
  );

  const unstableSelectorSource = '<!doctype html><html><body><section class="motion-group"><span>Child</span></section></body></html>';
  const unstableSelectorSelection = {
    ...groupSelection,
    attributes: { class: 'motion-group' },
  };
  const firstStableSelector = interactions.ensureInteractionSelector(
    unstableSelectorSource,
    unstableSelectorSelection.path,
    unstableSelectorSelection,
    'element',
  );
  const reopenedStableSelector = interactions.ensureInteractionSelector(
    firstStableSelector.source,
    unstableSelectorSelection.path,
    unstableSelectorSelection,
    'element',
  );
  assert.equal(
    reopenedStableSelector.selector,
    firstStableSelector.selector,
    'reopening against a stale selection snapshot must reuse the authored interaction selector',
  );
  assert.equal(reopenedStableSelector.source, firstStableSelector.source, 'reopening an existing group binding must not replace its stable element id');

  const duplicateGroupAction = {
    ...interactions.createInteractionAction('animate'),
    id: 'duplicate-group-action',
    keyframes: [
      {
        id: 'duplicate-group-keyframe',
        time: 0,
        values: { opacity: 0 },
      },
      {
        id: 'duplicate-group-keyframe',
        time: 0.5,
        values: { opacity: 1 },
      },
    ],
  };
  const normalizedDuplicateGroups = interactions.parseInteractionDocumentText(
    JSON.stringify({
      version: 2,
      interactions: [
        {
          ...groupInteractionFixture,
          id: 'duplicate-group-interaction',
          actions: [duplicateGroupAction, { ...duplicateGroupAction }],
        },
        {
          ...groupInteractionFixture,
          id: 'duplicate-group-interaction',
          actions: [{ ...duplicateGroupAction }],
        },
      ],
    }),
  );
  assert.ok(normalizedDuplicateGroups);
  const normalizedGroupInteractionIds = normalizedDuplicateGroups.interactions.map(interaction => interaction.id);
  assert.equal(
    new Set(normalizedGroupInteractionIds).size,
    normalizedGroupInteractionIds.length,
    'normalization must repair duplicate interaction ids before a grouped timeline reopens',
  );
  normalizedDuplicateGroups.interactions.forEach(interaction => {
    const actionIds = interaction.actions.map(action => action.id);
    assert.equal(new Set(actionIds).size, actionIds.length, 'normalization must repair duplicate action ids within one grouped timeline');
    const keyframeIds = interaction.actions.flatMap(action => action.keyframes.map(keyframe => keyframe.id));
    assert.equal(new Set(keyframeIds).size, keyframeIds.length, 'normalization must repair duplicate keyframe ids within one grouped timeline');
  });
  const normalizedGlobalActionIds = normalizedDuplicateGroups.interactions.flatMap(interaction => interaction.actions.map(action => action.id));
  assert.equal(
    new Set(normalizedGlobalActionIds).size,
    normalizedGlobalActionIds.length,
    'action ids must be unique across grouped interactions so drag and click suppression address one lane',
  );
  const normalizedGlobalKeyframeIds = normalizedDuplicateGroups.interactions.flatMap(interaction =>
    interaction.actions.flatMap(action => action.keyframes.map(keyframe => keyframe.id)),
  );
  assert.equal(
    new Set(normalizedGlobalKeyframeIds).size,
    normalizedGlobalKeyframeIds.length,
    'keyframe ids must remain unambiguous across every visible grouped lane',
  );
  const reopenedNormalizedGroups = interactions.parseInteractionDocumentText(interactions.serializeInteractionDocument(normalizedDuplicateGroups));
  assert.deepEqual(
    reopenedNormalizedGroups?.interactions.map(interaction => ({
      id: interaction.id,
      actions: interaction.actions.map(action => ({
        id: action.id,
        keyframes: action.keyframes.map(keyframe => keyframe.id),
      })),
    })),
    normalizedDuplicateGroups.interactions.map(interaction => ({
      id: interaction.id,
      actions: interaction.actions.map(action => ({
        id: action.id,
        keyframes: action.keyframes.map(keyframe => keyframe.id),
      })),
    })),
    'normalized group, action and keyframe ids must remain stable after reopening',
  );
  const duplicateGroupRuntimeSource = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section class="motion-group"></section></body></html>',
    normalizedDuplicateGroups,
  );
  const firstNormalizedGroupId = normalizedDuplicateGroups.interactions[0].id;
  const updatedSingleGroupSource = interactions.updateInteraction(duplicateGroupRuntimeSource, firstNormalizedGroupId, interaction => ({
    ...interaction,
    name: 'Only this group changed',
  }));
  assert.equal(
    interactions.readInteractionDocument(updatedSingleGroupSource).interactions.filter(interaction => interaction.name === 'Only this group changed').length,
    1,
    'updating one normalized group id must never rewrite multiple interaction definitions',
  );
  const removedSingleGroupSource = interactions.removeInteraction(duplicateGroupRuntimeSource, firstNormalizedGroupId);
  assert.equal(
    interactions.readInteractionDocument(removedSingleGroupSource).interactions.length,
    normalizedDuplicateGroups.interactions.length - 1,
    'removing one normalized group id must never remove multiple interaction definitions',
  );
  const unorderedKeyframeAction = {
    ...interactions.createInteractionAction('animate'),
    duration: 5,
    keyframes: [
      { id: 'keyframe-end', time: 2, values: { opacity: 1 } },
      { id: 'keyframe-start', time: 0, values: { opacity: 0 } },
      { id: 'keyframe-middle', time: 1, values: { opacity: 0.5 } },
    ],
  };
  const resizedOrderedKeyframes = interactions.interactionKeyframesForDuration(unorderedKeyframeAction, 1);
  assert.deepEqual(
    resizedOrderedKeyframes.map(keyframe => ({
      id: keyframe.id,
      time: keyframe.time,
    })),
    [
      { id: 'keyframe-start', time: 0 },
      { id: 'keyframe-middle', time: 0.5 },
      { id: 'keyframe-end', time: 1 },
    ],
    'duration edits must order imported keyframes and scale them from their real authored span',
  );
  assert.deepEqual(
    unorderedKeyframeAction.keyframes.map(keyframe => keyframe.time),
    [2, 0, 1],
    'resizing keyframes must not mutate the authored action passed to the helper',
  );
  const normalizedUnorderedKeyframes = JSON.parse(
    interactions.serializeInteractionDocument({
      version: 2,
      interactions: [
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'unordered-keyframe-interaction',
          actions: [unorderedKeyframeAction],
        },
      ],
    }),
  ).interactions[0].actions[0].keyframes;
  assert.deepEqual(
    normalizedUnorderedKeyframes.map(keyframe => keyframe.id),
    ['keyframe-start', 'keyframe-middle', 'keyframe-end'],
    'normalization must align From/To editing with runtime time order before any duration edit occurs',
  );
  assert.deepEqual(
    normalizedUnorderedKeyframes.map(keyframe => ({
      id: keyframe.id,
      time: keyframe.time,
      opacity: keyframe.values.opacity,
    })),
    [
      { id: 'keyframe-start', time: 0, opacity: 0 },
      { id: 'keyframe-middle', time: 1, opacity: 0.5 },
      { id: 'keyframe-end', time: 2, opacity: 1 },
    ],
    'sorting imported keyframes must keep every id paired with its own time and values',
  );
  const missingKeyframeIdsDocument = {
    version: 2,
    interactions: [
      {
        ...interactions.DEFAULT_INTERACTION,
        id: 'missing-keyframe-ids',
        actions: [
          {
            ...interactions.createInteractionAction('animate'),
            id: 'missing-keyframe-action',
            keyframes: [
              { time: 2, values: { opacity: 1 } },
              { time: 0, values: { opacity: 0 } },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(
    interactions.serializeInteractionDocument(missingKeyframeIdsDocument),
    interactions.serializeInteractionDocument(missingKeyframeIdsDocument),
    'missing imported keyframe ids must receive deterministic fallbacks even after sorting',
  );

  const groupedScopeSource = `<!doctype html>
<html>
  <body>
    <section class="selected-group">
      <div class="previous-target"></div>
      <button class="inner-trigger">
        <span class="trigger-child"><i class="deep-target"></i></span>
      </button>
      <div class="next-target sibling-target"></div>
      <div class="sibling-target"></div>
      <div class="inside-target"></div>
    </section>
    <aside class="outside-target"></aside>
    <div class="trigger-child outside-copy"></div>
  </body>
</html>`;
  const scopedGroupInteraction = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'scoped-group-interaction',
    name: 'Scoped group interaction',
    trigger: 'click',
    triggerSelector: '.inner-trigger',
    triggerLabel: 'Inner trigger',
    triggerTargetMode: 'class',
    actions: [
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-trigger',
        target: { ...interactions.DEFAULT_ACTION_TARGET },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-children',
        target: {
          selector: '.trigger-child',
          label: 'Trigger child',
          scope: 'children',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-descendants',
        target: {
          selector: '.deep-target',
          label: 'Deep target',
          scope: 'descendants',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-previous',
        target: {
          selector: '.previous-target',
          label: 'Previous target',
          scope: 'previous',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-next',
        target: {
          selector: '.next-target',
          label: 'Next target',
          scope: 'next',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-siblings',
        target: {
          selector: '.sibling-target',
          label: 'Sibling target',
          scope: 'siblings',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-inside-document',
        target: {
          selector: '.inside-target',
          label: 'Inside target',
          scope: 'document',
          mode: 'class',
        },
      },
      {
        ...interactions.createInteractionAction('animate'),
        id: 'scope-outside-document',
        target: {
          selector: '.outside-target',
          label: 'Outside target',
          scope: 'document',
          mode: 'class',
        },
      },
    ],
  };
  const relativeChildrenInteraction = {
    ...scopedGroupInteraction,
    id: 'relative-children-interaction',
    actions: [scopedGroupInteraction.actions[1]],
  };
  const allDescendantsAction = {
    ...interactions.createInteractionAction('animate'),
    id: 'scope-all-descendants',
    target: {
      selector: '',
      label: 'All descendants',
      scope: 'descendants',
      mode: 'selector',
    },
  };
  const allDescendantsInteraction = {
    ...scopedGroupInteraction,
    id: 'all-descendants-interaction',
    actions: [allDescendantsAction],
  };
  const closestGroupAction = {
    ...interactions.createInteractionAction('animate'),
    id: 'scope-closest-group',
    target: {
      selector: '.selected-group',
      label: 'Closest group',
      scope: 'closest',
      mode: 'class',
    },
  };
  const closestGroupInteraction = {
    ...scopedGroupInteraction,
    id: 'closest-group-interaction',
    actions: [closestGroupAction],
  };
  const closestMustNotSelectSelfInteraction = {
    ...scopedGroupInteraction,
    id: 'closest-self-interaction',
    triggerSelector: '.selected-group',
    actions: [closestGroupAction],
  };
  const mixedDocumentTargetSource = groupedScopeSource.replace('class="outside-target"', 'class="outside-target inside-target"');
  const mixedDocumentTargetInteraction = {
    ...scopedGroupInteraction,
    id: 'mixed-document-target-interaction',
    actions: [scopedGroupInteraction.actions[6]],
  };
  const mixedTriggerInteraction = {
    ...scopedGroupInteraction,
    id: 'mixed-trigger-interaction',
    triggerSelector: '.trigger-child',
    triggerLabel: 'Trigger copies',
    actions: [scopedGroupInteraction.actions[0]],
  };
  const outsideCopySelection = {
    path: '2',
    tag: 'div',
    id: '',
    classes: ['trigger-child', 'outside-copy'],
    attributes: { class: 'trigger-child outside-copy' },
    text: '',
    hasElementChildren: false,
    computedStyle: {},
  };
  const previousDomParser = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(source) {
      return new InteractionTestDocument(source);
    }
  };
  try {
    assert.deepEqual(
      interactions.interactionsInSelectionSubtree(groupedScopeSource, [scopedGroupInteraction], '0').map(interaction => ({
        id: interaction.id,
        actions: interaction.actions.map(action => action.id),
      })),
      [
        {
          id: scopedGroupInteraction.id,
          actions: ['scope-trigger', 'scope-children', 'scope-descendants', 'scope-previous', 'scope-next', 'scope-siblings', 'scope-inside-document'],
        },
      ],
      'a selected group must expose in-scope child actions without leaking document targets outside the group',
    );
    const containedRelativeProjection = interactions.interactionsInSelectionSubtree(groupedScopeSource, [relativeChildrenInteraction], '0')[0];
    assert.ok(containedRelativeProjection);
    assert.equal(
      interactions.interactionProjectionIsCompleteForSelectionSubtree(groupedScopeSource, relativeChildrenInteraction, containedRelativeProjection, '0'),
      true,
      'a projection with every trigger and relative target inside the group must remain previewable',
    );
    const mixedDocumentProjection = interactions.interactionsInSelectionSubtree(mixedDocumentTargetSource, [mixedDocumentTargetInteraction], '0')[0];
    assert.equal(
      mixedDocumentProjection?.actions.length,
      mixedDocumentTargetInteraction.actions.length,
      'the mixed document-target fixture must retain every action so count-only preview guards cannot detect it',
    );
    assert.equal(
      interactions.interactionProjectionIsCompleteForSelectionSubtree(mixedDocumentTargetSource, mixedDocumentTargetInteraction, mixedDocumentProjection, '0'),
      false,
      'a document selector matching inside and outside the group must disable projected preview',
    );
    const mixedTriggerProjection = interactions.interactionsInSelectionSubtree(groupedScopeSource, [mixedTriggerInteraction], '0')[0];
    assert.equal(
      mixedTriggerProjection?.actions.length,
      mixedTriggerInteraction.actions.length,
      'the mixed trigger fixture must retain every action so count-only preview guards cannot detect it',
    );
    assert.equal(
      interactions.interactionProjectionIsCompleteForSelectionSubtree(groupedScopeSource, mixedTriggerInteraction, mixedTriggerProjection, '0'),
      false,
      'a trigger selector matching inside and outside the group must disable projected preview',
    );
    assert.equal(
      interactions.interactionTriggerMatchesSelectionPath(groupedScopeSource, scopedGroupInteraction, '0/4'),
      false,
      'an exact action target must not acquire destructive ownership of its interaction trigger',
    );
    assert.equal(
      interactions.interactionTriggerMatchesSelectionPath(groupedScopeSource, scopedGroupInteraction, '0/1'),
      true,
      'the canonical trigger element must retain destructive ownership of its interaction',
    );
    assert.deepEqual(
      interactions.interactionsInSelectionSubtree(groupedScopeSource, [scopedGroupInteraction], '0/4').map(interaction => ({
        id: interaction.id,
        actions: interaction.actions.map(action => action.id),
      })),
      [
        {
          id: scopedGroupInteraction.id,
          actions: ['scope-inside-document'],
        },
      ],
      'selecting one child must not inherit its group trigger, siblings or external actions',
    );
    assert.deepEqual(
      interactions.interactionsInSelectionSubtree(groupedScopeSource, [relativeChildrenInteraction], outsideCopySelection.path),
      [],
      'a children-scoped target must not match an unrelated copy outside its trigger group',
    );
    assert.equal(
      interactions.interactionTimelineForSelection(relativeChildrenInteraction, outsideCopySelection, groupedScopeSource),
      null,
      'exact child matching must honor relative target scope instead of matching the selector globally',
    );
    assert.equal(
      interactions.interactionActionTargetMatchesSelectionPath(groupedScopeSource, allDescendantsInteraction, allDescendantsAction, '0/1/0'),
      true,
      'an empty descendants selector must include every descendant of the real trigger',
    );
    assert.equal(
      interactions.interactionActionTargetMatchesSelectionPath(groupedScopeSource, allDescendantsInteraction, allDescendantsAction, '0/1'),
      false,
      'descendants scope must not include the trigger itself',
    );
    assert.equal(
      interactions.interactionActionTargetMatchesSelectionPath(groupedScopeSource, closestGroupInteraction, closestGroupAction, '0'),
      true,
      'closest scope must resolve the nearest matching ancestor of the trigger',
    );
    assert.equal(
      interactions.interactionActionTargetMatchesSelectionPath(groupedScopeSource, closestMustNotSelectSelfInteraction, closestGroupAction, '0'),
      false,
      'closest scope must never resolve the trigger itself as its own ancestor',
    );
    assert.equal(
      interactions.interactionTimelineForSelection(
        relativeChildrenInteraction,
        {
          ...outsideCopySelection,
          path: '99',
        },
        groupedScopeSource,
      ),
      null,
      'a stale numeric selection path missing from the current source must not fall back to old snapshot classes',
    );
  } finally {
    if (previousDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousDomParser;
  }
  const codeComponentControlSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCodeComponentControlRenderer.tsx'),
    'utf8',
  );
  assert.match(
    codeComponentControlSource,
    /codeComponentDateInputValue\(args\.value, mode\)/,
    'datetime Code Component controls must format ISO values for datetime-local instead of rendering an invalid empty input',
  );
  assert.match(
    codeComponentControlSource,
    /codeComponentDateValue\(event\.target\.value, mode\)/,
    'datetime edits must return to the component as a stable timestamp',
  );
  assert.match(
    codeComponentControlSource,
    /resolveAsset\(image\.id\)[\s\S]*?asset\?\.kind !== 'image'[\s\S]*?setPreviewSrc\(asset\.src\)/,
    'image controls must resolve project assets into a preview URL instead of rendering a page-relative path in the inspector',
  );
  assert.match(
    codeComponentControlSource,
    /kind === 'image' \? 'h-28 border-b border-border\/60' : 'h-20'/,
    'asset controls must use a vertical card with a useful image preview area',
  );

  const tokenFixture = projectIo.createBlankProject('Design token fixture');
  const tokenDocument = {
    version: 1,
    collections: [{ id: 'base', name: 'Base collection' }],
    tokens: [
      {
        id: 'brand-primary',
        collectionId: 'base',
        name: 'Brand / Primary',
        type: 'color',
        value: '#6d5dfc',
      },
      {
        id: 'space-large',
        collectionId: 'base',
        name: 'Space / Large',
        type: 'size',
        value: '48px',
      },
      {
        id: 'font-h1',
        collectionId: 'base',
        name: 'H1 / Display',
        type: 'font-family',
        value: '"Neue Haas Display", Helvetica, sans-serif',
      },
    ],
  };
  const tokenizedProject = designTokens.updateProjectDesignTokens(tokenFixture, tokenDocument);
  assert.deepEqual(
    projectIo.readEditorMetadata(tokenizedProject).designTokens,
    tokenDocument,
    'design tokens must persist in the project metadata rather than browser-only state',
  );
  assert.match(
    tokenizedProject.files[tokenizedProject.mainHtmlPath].text,
    /<style data-kodety-design-tokens>[\s\S]*--kodety-token-brand-primary:\s*#6d5dfc;[\s\S]*--kodety-token-space-large:\s*48px;[\s\S]*--kodety-token-font-h1:\s*"Neue Haas Display", Helvetica, sans-serif;/,
    'every HTML entry must receive native CSS custom properties for preview and publication',
  );
  assert.equal(
    designTokens.designTokenReference('space-large'),
    'var(--kodety-token-space-large)',
    'bindings must keep a live reference instead of copying the current value',
  );
  assert.ok(
    designTokens.isDesignTokenCompatible(tokenDocument.tokens[1], 'width'),
    'size variables must be available to width/height controls including relative/fill presets',
  );
  assert.ok(!designTokens.isDesignTokenCompatible(tokenDocument.tokens[0], 'width'), 'incompatible color variables must not be offered by a size input');
  assert.ok(designTokens.isDesignTokenCompatible(tokenDocument.tokens[2], 'font-family'), 'font variables must be offered by the font-family picker');
  assert.ok(
    !designTokens.isDesignTokenCompatible(tokenDocument.tokens[2], 'font-weight'),
    'a font-family variable must never take control of the independently editable font weight',
  );
  assert.equal(designTokens.designTokenTypeForProperty('font-weight'), 'number', 'font weight must remain an independent numeric property');
  const withTokenBinding = projectIo.updateTextFile(
    tokenizedProject,
    tokenizedProject.mainHtmlPath,
    tokenizedProject.files[tokenizedProject.mainHtmlPath].text.replace('<main>', '<main style="width: var(--kodety-token-space-large)">'),
  );
  const detachedTokenProject = designTokens.updateProjectDesignTokens(withTokenBinding, {
    ...tokenDocument,
    tokens: tokenDocument.tokens.filter(token => token.id !== 'space-large'),
  });
  assert.match(
    detachedTokenProject.files[detachedTokenProject.mainHtmlPath].text,
    /<main style="width: 48px">/,
    'deleting a variable must preserve its resolved value at every prior binding',
  );
  const withFontBinding = projectIo.updateTextFile(
    tokenizedProject,
    tokenizedProject.mainHtmlPath,
    tokenizedProject.files[tokenizedProject.mainHtmlPath].text.replace('<main>', '<main style="font-family: var(--kodety-token-font-h1); font-weight: 700">'),
  );
  const detachedFontProject = designTokens.updateProjectDesignTokens(withFontBinding, {
    ...tokenDocument,
    tokens: tokenDocument.tokens.filter(token => token.id !== 'font-h1'),
  });
  assert.match(
    detachedFontProject.files[detachedFontProject.mainHtmlPath].text,
    /font-family:\s*"Neue Haas Display", Helvetica, sans-serif;\s*font-weight:\s*700/,
    'detaching a font variable must preserve the independently selected font weight',
  );
  assert.doesNotMatch(
    detachedTokenProject.files[detachedTokenProject.mainHtmlPath].text,
    /--kodety-token-space-large/,
    'deleted tokens must disappear from both references and compiled declarations',
  );

  const makeSfntFontFixture = ({
    family,
    legacyFamily = family,
    subfamily = 'Regular',
    legacySubfamily = subfamily,
    weight = 400,
    italic = false,
    serif = false,
  }) => {
    const encodeUtf16Be = value => {
      const bytes = new Uint8Array(value.length * 2);
      const view = new DataView(bytes.buffer);
      Array.from(value).forEach((character, index) => {
        view.setUint16(index * 2, character.charCodeAt(0));
      });
      return bytes;
    };
    const nameValues = [
      [1, legacyFamily],
      [2, legacySubfamily],
      [16, family],
      [17, subfamily],
    ].map(([id, value]) => [id, encodeUtf16Be(String(value))]);
    const nameHeaderLength = 6 + nameValues.length * 12;
    const nameLength = nameHeaderLength + nameValues.reduce((total, [, bytes]) => total + bytes.length, 0);
    const name = new Uint8Array(nameLength);
    const nameView = new DataView(name.buffer);
    nameView.setUint16(2, nameValues.length);
    nameView.setUint16(4, nameHeaderLength);
    let stringOffset = 0;
    nameValues.forEach(([id, bytes], index) => {
      const record = 6 + index * 12;
      nameView.setUint16(record, 3);
      nameView.setUint16(record + 2, 1);
      nameView.setUint16(record + 4, 0x0409);
      nameView.setUint16(record + 6, id);
      nameView.setUint16(record + 8, bytes.length);
      nameView.setUint16(record + 10, stringOffset);
      name.set(bytes, nameHeaderLength + stringOffset);
      stringOffset += bytes.length;
    });
    const os2 = new Uint8Array(64);
    const os2View = new DataView(os2.buffer);
    os2View.setUint16(4, weight);
    os2[32] = 2;
    os2[33] = serif ? 2 : 11;
    os2View.setUint16(62, italic ? 1 : 0);
    const head = new Uint8Array(46);
    new DataView(head.buffer).setUint16(44, italic ? 2 : 0);
    const post = new Uint8Array(8);
    new DataView(post.buffer).setInt32(4, italic ? -12 * 65536 : 0);
    const tables = [
      ['OS/2', os2],
      ['head', head],
      ['name', name],
      ['post', post],
    ];
    const directoryLength = 12 + tables.length * 16;
    let totalLength = directoryLength;
    const tableOffsets = tables.map(([, bytes]) => {
      const offset = totalLength;
      totalLength += Math.ceil(bytes.length / 4) * 4;
      return offset;
    });
    const result = new Uint8Array(totalLength);
    const resultView = new DataView(result.buffer);
    resultView.setUint32(0, 0x00010000);
    resultView.setUint16(4, tables.length);
    tables.forEach(([tag, bytes], index) => {
      const record = 12 + index * 16;
      Array.from(tag).forEach((character, characterIndex) => {
        result[record + characterIndex] = character.charCodeAt(0);
      });
      resultView.setUint32(record + 8, tableOffsets[index]);
      resultView.setUint32(record + 12, bytes.length);
      result.set(bytes, tableOffsets[index]);
    });
    return result;
  };

  const fontProject = {
    name: 'Font discovery fixture',
    rootPath: 'site',
    mainHtmlPath: 'site/index.html',
    openedAt: 1,
    files: {
      'site/index.html': {
        path: 'site/index.html',
        mimeType: 'text/html',
        text: '<style>@font-face { font-family: "Editorial Display"; src: url("/fonts/editorial%20bold.woff2") format("woff2"); font-weight: bold; }</style>',
      },
      'site/styles/site.css': {
        path: 'site/styles/site.css',
        mimeType: 'text/css',
        text: [
          '@font-face { font-family: "Neue Haas Display"; src: url("../fonts/neue-haas-regular.woff2") format("woff2"); font-weight: 400; }',
          '@font-face { font-family: "Neue Haas Display"; src: url("../fonts/neue-haas-bold-italic.woff2") format("woff2"); font-weight: 700; font-style: italic; }',
          '.hero { color: red; }',
        ].join('\n'),
      },
      'site/fonts/neue-haas-regular.woff2': {
        path: 'site/fonts/neue-haas-regular.woff2',
        mimeType: 'font/woff2',
        data: new Uint8Array([1, 2, 3]),
      },
      'site/fonts/neue-haas-bold-italic.woff2': {
        path: 'site/fonts/neue-haas-bold-italic.woff2',
        mimeType: 'font/woff2',
        data: new Uint8Array([4, 5, 6]),
      },
      'site/public/fonts/editorial bold.woff2': {
        path: 'site/public/fonts/editorial bold.woff2',
        mimeType: 'font/woff2',
        data: new Uint8Array([7, 8, 9]),
      },
      'site/assets/Acme Serif/AcmeSerif-Regular.woff': {
        path: 'site/assets/Acme Serif/AcmeSerif-Regular.woff',
        mimeType: 'font/woff',
        data: new Uint8Array([10, 11, 12]),
      },
      '.incode/experiments/home/variant-a/project/site/styles/site.css': {
        path: '.incode/experiments/home/variant-a/project/site/styles/site.css',
        mimeType: 'text/css',
        text: '@font-face { font-family: "Private Clone"; src: url("../fonts/private.ttf"); font-weight: 900; }',
      },
      '.incode/experiments/home/variant-a/project/site/fonts/private.ttf': {
        path: '.incode/experiments/home/variant-a/project/site/fonts/private.ttf',
        mimeType: 'font/ttf',
        data: new Uint8Array([13, 14, 15]),
      },
      '.kodety-social/cache/HiddenFont.otf': {
        path: '.kodety-social/cache/HiddenFont.otf',
        mimeType: 'font/otf',
        data: new Uint8Array([16, 17, 18]),
      },
    },
  };
  const discoveredFonts = projectFonts.discoverProjectFonts(fontProject);
  assert.deepEqual(
    discoveredFonts.fonts.map(font => font.family),
    ['Acme Serif', 'Editorial Display', 'Neue Haas Display'],
    'project font discovery must combine @font-face declarations and otherwise-unreferenced font assets',
  );
  const neueHaasFont = discoveredFonts.fonts.find(font => font.family === 'Neue Haas Display');
  assert.deepEqual(neueHaasFont.weights, ['400', '700']);
  assert.deepEqual(neueHaasFont.variants, ['regular', '700italic']);
  assert.equal(
    discoveredFonts.fonts.find(font => font.family === 'Editorial Display').faces[0].weight,
    '700',
    'CSS font-weight keywords must normalize to their numeric face weight',
  );
  assert.ok(
    !discoveredFonts.fonts.some(font => ['Private Clone', 'HiddenFont'].includes(font.family)),
    'private editor and generated Social Image trees must never leak into the project font catalog',
  );
  assert.deepEqual(
    neueHaasFont.faces.map(face => face.sources[0].filePath),
    ['site/fonts/neue-haas-regular.woff2', 'site/fonts/neue-haas-bold-italic.woff2'],
    'relative @font-face URLs must resolve to the actual imported project files',
  );
  assert.equal(
    discoveredFonts.fonts.find(font => font.family === 'Editorial Display').faces[0].sources[0].filePath,
    'site/public/fonts/editorial bold.woff2',
    'quoted and encoded root-relative Vite public URLs must resolve inside the imported public directory',
  );
  const metadataFontProject = {
    name: 'Font metadata and aliases fixture',
    rootPath: 'site',
    mainHtmlPath: 'site/index.html',
    openedAt: 1,
    files: {
      'site/index.html': {
        path: 'site/index.html',
        mimeType: 'text/html',
        text: [
          '<style>',
          '@font-face { font-family: "Rubrika Neue Haas"; src: url("./fonts/NeueHaas-MediumItalic.ttf"); }',
          '@font-face { font-family: "Haas Grot Disp R Trial"; src: url("./fonts/NeueHaas-MediumItalic.ttf"); font-weight: 500; font-style: italic; }',
          '@font-face { font-family: "Arial Placeholder"; src: local("Arial"); }',
          '.hero { font-family: "Rubrika Neue Haas", Helvetica, sans-serif; }',
          '</style>',
        ].join('\n'),
      },
      'site/fonts/NeueHaas-MediumItalic.ttf': {
        path: 'site/fonts/NeueHaas-MediumItalic.ttf',
        mimeType: 'font/ttf',
        data: makeSfntFontFixture({
          family: 'Neue Haas Grotesk Display',
          legacyFamily: 'NeueHaasGrotDisp 65 Medium Trial',
          subfamily: 'Medium Italic',
          weight: 500,
          italic: true,
        }),
      },
      'site/fonts/NeueHaas-BoldItalic.ttf': {
        path: 'site/fonts/NeueHaas-BoldItalic.ttf',
        mimeType: 'font/ttf',
        data: makeSfntFontFixture({
          family: 'Neue Haas Grotesk Display',
          legacyFamily: 'NeueHaasGrotDisp 75 Bold Trial',
          subfamily: 'Bold Italic',
          weight: 700,
          italic: true,
        }),
      },
    },
  };
  const metadataFonts = projectFonts.discoverProjectFonts(metadataFontProject);
  assert.equal(
    metadataFonts.fonts.length,
    1,
    'CSS family, internal typographic family and unreferenced variants must collapse into one deterministic project family',
  );
  const rubrikaFont = metadataFonts.fonts[0];
  assert.equal(rubrikaFont.family, 'Rubrika Neue Haas', 'the family actively authored in project CSS must remain the canonical picker label');
  assert.deepEqual(rubrikaFont.weights, ['500', '700'], 'OS/2 metadata must recover complete weights even when CSS omits the descriptors');
  assert.deepEqual(rubrikaFont.variants, ['500italic', '700italic'], 'SFNT subfamily/style metadata must preserve italic variants across aliases');
  assert.ok(
    rubrikaFont.aliases.includes('Neue Haas Grotesk Display') && rubrikaFont.aliases.includes('Haas Grot Disp R Trial'),
    'internal and authored legacy names must remain searchable aliases of the canonical family',
  );
  assert.equal(rubrikaFont.faces.length, 3, 'the canonical family must retain every declared and inferred face instead of losing alias weights');
  assert.ok(
    !metadataFonts.fonts.some(font => font.family === 'Arial Placeholder'),
    'a local()-only fallback must not be listed as a font imported from the ZIP',
  );
  const fontArchive = new JSZip();
  fontArchive.file(
    'site/index.html',
    '<style>@font-face{font-family:"Rubrika Neue Haas";src:url("./fonts/NeueHaas-MediumItalic.ttf")}.hero{font-family:"Rubrika Neue Haas",sans-serif}</style>',
  );
  fontArchive.file('site/fonts/NeueHaas-MediumItalic.ttf', metadataFontProject.files['site/fonts/NeueHaas-MediumItalic.ttf'].data);
  const fontArchiveBytes = await fontArchive.generateAsync({ type: 'uint8array' });
  const nativeBlobArrayBuffer = Blob.prototype.arrayBuffer;
  let zipBlobArrayBufferCalls = 0;
  Blob.prototype.arrayBuffer = function countedZipArrayBuffer() {
    zipBlobArrayBufferCalls += 1;
    return nativeBlobArrayBuffer.call(this);
  };
  let importedFontProject;
  try {
    importedFontProject = await projectIo.importZip(
      new File([fontArchiveBytes], 'font-project.zip', { type: 'application/zip' }),
    );
  } finally {
    Blob.prototype.arrayBuffer = nativeBlobArrayBuffer;
  }
  assert.equal(
    zipBlobArrayBufferCalls,
    1,
    'ZIP import must materialize only the archive itself, not a temporary Blob for every binary entry',
  );
  assert.deepEqual(
    importedFontProject.files['site/fonts/NeueHaas-MediumItalic.ttf'].data,
    metadataFontProject.files['site/fonts/NeueHaas-MediumItalic.ttf'].data,
    'ZIP import must preserve exact binary font bytes for metadata discovery and later persistence',
  );
  const oversizedMetadataArchive = new JSZip();
  oversizedMetadataArchive.file('oversized.bin', Uint8Array.of(1), { compression: 'STORE' });
  const oversizedMetadataBytes = await oversizedMetadataArchive.generateAsync({ type: 'uint8array' });
  const oversizedMetadataView = new DataView(
    oversizedMetadataBytes.buffer,
    oversizedMetadataBytes.byteOffset,
    oversizedMetadataBytes.byteLength,
  );
  for (let offset = 0; offset <= oversizedMetadataBytes.byteLength - 4; offset += 1) {
    const signature = oversizedMetadataView.getUint32(offset, true);
    if (signature === 0x04034b50) oversizedMetadataView.setUint32(offset + 22, 256 * 1024 * 1024 + 1, true);
    if (signature === 0x02014b50) oversizedMetadataView.setUint32(offset + 24, 256 * 1024 * 1024 + 1, true);
  }
  await assert.rejects(
    () => projectIo.importZip(
      new File([oversizedMetadataBytes], 'oversized-metadata.zip', { type: 'application/zip' }),
    ),
    /ultrapassa o limite seguro de 256 MB/,
    'ZIP central-directory sizes must be rejected before an oversized entry is inflated',
  );
  const importedFontCatalog = projectFonts.discoverProjectFonts(importedFontProject);
  assert.equal(importedFontCatalog.fonts[0]?.family, 'Rubrika Neue Haas');
  assert.deepEqual(
    importedFontCatalog.fonts[0]?.variants,
    ['500italic'],
    'font metadata must survive the real ZIP extraction pipeline, not only in-memory fixtures',
  );
  const liquidArchive = new JSZip();
  const liquidSectionSource =
    '<section data-comparison="2 > 1" {{ block.shopify_attributes }} class="product{% if product.available %} is-available{% endif %}" data-product-id={{ product.id }}><h2>{{ section.settings.heading }}</h2><a href="{{ product.url }}"><img src="{{ product.featured_image | image_url: width: 1200 }}" alt="{{ product.title | escape }}"><h1>{{ product.title }}</h1></a>{% if product.available %}<button>Comprar</button>{% endif %}</section>{% schema %}{"name":"Produto","settings":[{"type":"text","id":"heading","default":"Escolhas para viver melhor"}]}{% endschema %}';
  liquidArchive.file('layout/theme.liquid', '<!doctype html><html><body>{{ content_for_layout }}</body></html>');
  liquidArchive.file('sections/main-product.liquid', liquidSectionSource);
  liquidArchive.file('assets/theme.css', '.product{display:grid}');
  const importedLiquidProject = await projectIo.importZip(
    new File([await liquidArchive.generateAsync({ type: 'uint8array' })], 'tema-liquid.zip', {
      type: 'application/zip',
    }),
  );
  assert.equal(projectIo.isShopifyThemeProject(importedLiquidProject), true);
  assert.equal(importedLiquidProject.mainHtmlPath, 'index.html');
  assert.doesNotMatch(importedLiquidProject.name, /manutenção Shopify/i, 'Liquid imports must look like regular Builder projects');
  assert.match(importedLiquidProject.files['sections/main-product.liquid'].text, /product\.title/, 'the original Liquid source must remain directly editable');
  assert.doesNotMatch(
    importedLiquidProject.files['index.html'].text,
    /__KODETY_LIQUID_/,
    'the visual Shopify canvas must never expose Liquid variable placeholders',
  );
  assert.match(
    importedLiquidProject.files['index.html'].text,
    /Produto de exemplo/,
    'dynamic Liquid text must use representative visual content in the Builder',
  );
  assert.match(importedLiquidProject.files['index.html'].text, /Escolhas para viver melhor/);
  assert.match(
    importedLiquidProject.files['index.html'].text,
    /data-kodety-liquid-attr-[a-z0-9]+="(?:href|src|alt)"/,
    'dynamic Liquid attributes must retain an invisible reversible binding',
  );
  const findHtmlElement = (htmlSource, tagName) => {
    const parsed = parseHtml(htmlSource);
    let found = null;
    const visit = node => {
      if (found) return;
      if (node.tagName === tagName) {
        found = node;
        return;
      }
      (node.childNodes || []).forEach(visit);
    };
    visit(parsed);
    return found;
  };
  const projectedLiquidSection = findHtmlElement(importedLiquidProject.files['index.html'].text, 'section');
  assert.ok(projectedLiquidSection, 'an adversarial Liquid start tag must remain one selectable section');
  const projectedLiquidAttributes = Object.fromEntries((projectedLiquidSection.attrs || []).map(attribute => [attribute.name, attribute.value]));
  assert.equal(
    projectedLiquidAttributes['data-comparison'],
    '2 > 1',
    'a quoted greater-than sign before Liquid bindings must not terminate the start tag projection',
  );
  assert.ok(projectedLiquidAttributes['data-product-id']);
  assert.doesNotMatch(
    projectedLiquidAttributes['data-product-id'],
    /KODETY_LIQUID|product\.id|[{}]/,
    'an unquoted Liquid output must project to a usable attribute value instead of exposing source syntax',
  );
  assert.equal(projectedLiquidAttributes.class, 'product is-available');
  assert.ok(
    Object.keys(projectedLiquidAttributes).some(name => /^data-kodety-liquid-output-attribute-/.test(name)),
    'a bare Shopify attributes output must remain attached to its owning start tag',
  );
  assert.ok(
    Object.keys(projectedLiquidAttributes).filter(name => /^data-kodety-liquid-attr-/.test(name)).length >= 2,
    'conditional class and unquoted output bindings must remain attached to the projected start tag',
  );
  const importedLiquidMetadata = JSON.parse(importedLiquidProject.files['.incode/shopify-theme.json'].text);
  assert.ok(
    Object.keys(importedLiquidMetadata.previewSources['index.html'].attributeBindings || {}).length >= 5,
    'start-tag, href, image and alt bindings must be persisted for exact visual round-trip',
  );
  const noOpLiquidArchive = await JSZip.loadAsync(await (await projectIo.shopifyThemeToZipBlob(importedLiquidProject)).arrayBuffer());
  assert.equal(
    await noOpLiquidArchive.file('sections/main-product.liquid').async('string'),
    liquidSectionSource,
    'an untouched visual Liquid preview must export its canonical source byte-for-byte',
  );
  assert.equal(
    await noOpLiquidArchive.file('layout/theme.liquid').async('string'),
    importedLiquidProject.files['layout/theme.liquid'].text,
    'an untouched Liquid layout must remain byte-identical',
  );
  const horizonArchive = new JSZip();
  const horizonFooterSource = [
    '{% doc %}INTERNAL HORIZON DOCUMENTATION MUST STAY HIDDEN{% enddoc %}',
    '{% comment %}INTERNAL LIQUID COMMENT MUST STAY HIDDEN{% endcomment %}',
    '{% capture internal_note %}INTERNAL CAPTURE MUST STAY HIDDEN{% endcapture %}',
    '<footer class="footer-content section--{{ section.settings.section_width }}" style="--footer-gap: {{ section.settings.gap }}px">',
    "  {% content_for 'blocks' %}",
    '</footer>',
    '{% stylesheet %}',
    '  .footer-content { display: grid; gap: var(--footer-gap); padding: 32px; background: #171717; color: white; }',
    '{% endstylesheet %}',
    '{% style %}.footer-content > * { min-width: 0; }{% endstyle %}',
    '{% javascript %}document.documentElement.dataset.themeLoaded = "true";{% endjavascript %}',
    '{% schema %}{"name":"Footer","settings":[{"type":"select","id":"section_width","default":"page-width"},{"type":"range","id":"gap","default":8}],"blocks":[{"type":"text"}]}{% endschema %}',
  ].join('\n');
  horizonArchive.file('layout/theme.liquid', '<!doctype html><html><body>{{ content_for_layout }}</body></html>');
  horizonArchive.file('sections/footer.liquid', horizonFooterSource);
  horizonArchive.file(
    'blocks/text.liquid',
    '<div class="footer-copy"><h2>{{ block.settings.text }}</h2></div>{% schema %}{"name":"Text","settings":[{"type":"richtext","id":"text","default":"<p>Conteúdo do rodapé</p>"}]}{% endschema %}',
  );
  horizonArchive.file(
    'sections/footer-group.json',
    '/* Shopify generated file */\n{"type":"footer","sections":{"footer":{"type":"footer","settings":{"section_width":"full-width","gap":24},"blocks":{"about":{"type":"text","settings":{"text":"<p>Sobre a marca</p>"}}},"block_order":["about"]}},"order":["footer"]}',
  );
  const importedHorizonProject = await projectIo.importZip(
    new File([await horizonArchive.generateAsync({ type: 'uint8array' })], 'heritage-horizon.zip', {
      type: 'application/zip',
    }),
  );
  const horizonPreview = importedHorizonProject.files['index.html'].text;
  assert.match(
    horizonPreview,
    /<style data-kodety-shopify-stylesheet>[\s\S]*?\.footer-content\s*\{/,
    'Shopify stylesheet blocks must become real preview styles instead of visible canvas text',
  );
  assert.doesNotMatch(
    horizonPreview,
    /<main[^>]*>\s*\.footer-content\s*\{/,
    'stylesheet source must not leak as a text node at the beginning of the editable section',
  );
  assert.match(horizonPreview, /Sobre a marca/, 'Horizon content_for blocks must project configured Theme Block content into the canvas');
  assert.match(horizonPreview, /section--full-width/);
  assert.match(horizonPreview, /--footer-gap:\s*24px/);
  assert.doesNotMatch(
    horizonPreview,
    /themeLoaded\s*=|document\.documentElement|INTERNAL (?:HORIZON DOCUMENTATION|LIQUID COMMENT|CAPTURE)/,
    'Shopify javascript, documentation, comments and captures must stay inert in the authoring preview',
  );
  assert.match(horizonPreview, /<style data-kodety-shopify-style>\.footer-content > \*/);
  const noOpHorizonArchive = await JSZip.loadAsync(await (await projectIo.shopifyThemeToZipBlob(importedHorizonProject)).arrayBuffer());
  assert.equal(
    await noOpHorizonArchive.file('sections/footer.liquid').async('string'),
    horizonFooterSource,
    'Horizon visual expansions must preserve the canonical Liquid section byte-for-byte when untouched',
  );
  class LiquidRoundTripTestElement {
    constructor(node) {
      this.node = node;
    }

    get attributes() {
      return this.node.attrs || [];
    }

    getAttribute(name) {
      return this.node.attrs?.find(attribute => attribute.name === name)?.value ?? null;
    }

    setAttribute(name, value) {
      const existing = this.node.attrs?.find(attribute => attribute.name === name);
      if (existing) existing.value = value;
      else (this.node.attrs ||= []).push({ name, value });
    }

    removeAttribute(name) {
      this.node.attrs = (this.node.attrs || []).filter(attribute => attribute.name !== name);
    }

    querySelectorAll(selector) {
      assert.equal(selector, '*');
      const descendants = [];
      const visit = node => {
        (node.childNodes || []).forEach(child => {
          if (child.tagName) descendants.push(new LiquidRoundTripTestElement(child));
          visit(child);
        });
      };
      visit(this.node);
      return descendants;
    }

    get innerHTML() {
      return serializeHtml(this.node);
    }
  }
  class LiquidRoundTripTestDocument {
    constructor(htmlSource) {
      this.document = parseHtml(htmlSource);
    }

    querySelector(selector) {
      assert.equal(selector, '[data-kodety-shopify-source-root]');
      let found = null;
      const visit = node => {
        if (found) return;
        if (node.attrs?.some(attribute => attribute.name === 'data-kodety-shopify-source-root')) {
          found = new LiquidRoundTripTestElement(node);
          return;
        }
        (node.childNodes || []).forEach(visit);
      };
      visit(this.document);
      return found;
    }
  }
  const visuallyEditedLiquid = projectIo.updateTextFile(
    importedLiquidProject,
    'index.html',
    importedLiquidProject.files['index.html'].text.replace('<h1>', '<h1 data-kodety-effect="fade-up">'),
  );
  const previousLiquidDomParser = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(htmlSource) {
      return new LiquidRoundTripTestDocument(htmlSource);
    }
  };
  let visualLiquidArchive;
  try {
    visualLiquidArchive = await JSZip.loadAsync(await (await projectIo.shopifyThemeToZipBlob(visuallyEditedLiquid)).arrayBuffer());
  } finally {
    if (previousLiquidDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousLiquidDomParser;
  }
  const visuallyMaterializedLiquid = await visualLiquidArchive.file('sections/main-product.liquid').async('string');
  const liquidTokenSequence = value => value.match(/{{[-]?[\s\S]*?[-]?}}|{%[-]?[\s\S]*?[-]?%}/g) || [];
  assert.deepEqual(
    liquidTokenSequence(visuallyMaterializedLiquid),
    liquidTokenSequence(liquidSectionSource),
    'a visual edit must preserve every Liquid output, control-flow tag and schema delimiter in source order',
  );
  assert.match(
    visuallyMaterializedLiquid,
    /<h1 data-kodety-effect="fade-up">\{\{ product\.title \}\}<\/h1>/,
    'a visual effect edit must target the authored element while preserving its dynamic Liquid text',
  );
  assert.match(visuallyMaterializedLiquid, /data-comparison="2 &gt; 1"|data-comparison="2 > 1"/);
  assert.match(visuallyMaterializedLiquid, /\{\{ block\.shopify_attributes \}\}/);
  assert.match(visuallyMaterializedLiquid, /class="product\{% if product\.available %\} is-available\{% endif %\}"/);
  assert.match(visuallyMaterializedLiquid, /data-product-id=\{\{ product\.id \}\}/);
  assert.match(visuallyMaterializedLiquid, /href="\{\{ product\.url \}\}"/);
  assert.match(visuallyMaterializedLiquid, /alt="\{\{ product\.title \| escape \}\}"/);
  assert.match(
    visuallyMaterializedLiquid,
    /\{% schema %\}\{"name":"Produto","settings":\[\{"type":"text","id":"heading","default":"Escolhas para viver melhor"\}\]\}\{% endschema %\}/,
    'visual edits must preserve the section schema instead of projecting it into Builder markup',
  );
  assert.doesNotMatch(
    visuallyMaterializedLiquid,
    /KODETY_LIQUID|Produto de exemplo|shopify-preview|data-kodety-liquid-attr/,
    'visual samples and reversible binding markers must never leak into the exported theme',
  );
  const materializeLiquidFixtureAfterVisualEdit = async (fixtureName, fixtureSource, editPreview) => {
    const fixtureArchive = new JSZip();
    fixtureArchive.file('layout/theme.liquid', '<!doctype html><html><body>{{ content_for_layout }}</body></html>');
    fixtureArchive.file(`sections/${fixtureName}.liquid`, fixtureSource);
    const fixtureProject = await projectIo.importZip(
      new File([await fixtureArchive.generateAsync({ type: 'uint8array' })], `${fixtureName}.zip`, {
        type: 'application/zip',
      }),
    );
    const preview = fixtureProject.files['index.html'].text;
    const editedPreview = editPreview(preview);
    assert.notEqual(editedPreview, preview, `${fixtureName} must perform a real visual edit before testing materialization`);
    const editedProject = projectIo.updateTextFile(fixtureProject, 'index.html', editedPreview);
    const previousDomParser = globalThis.DOMParser;
    globalThis.DOMParser = class {
      parseFromString(htmlSource) {
        return new LiquidRoundTripTestDocument(htmlSource);
      }
    };
    try {
      const exported = await JSZip.loadAsync(await (await projectIo.shopifyThemeToZipBlob(editedProject)).arrayBuffer());
      return {
        liquid: await exported.file(`sections/${fixtureName}.liquid`).async('string'),
        preview,
      };
    } finally {
      if (previousDomParser === undefined) delete globalThis.DOMParser;
      else globalThis.DOMParser = previousDomParser;
    }
  };

  const visuallyEditedHorizonProject = projectIo.updateTextFile(
    importedHorizonProject,
    'index.html',
    horizonPreview.replace('<footer class="footer-content', '<footer data-kodety-effect="fade-up" class="footer-content'),
  );
  const previousHorizonDomParser = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(htmlSource) {
      return new LiquidRoundTripTestDocument(htmlSource);
    }
  };
  let visuallyEditedHorizonArchive;
  try {
    visuallyEditedHorizonArchive = await JSZip.loadAsync(await (await projectIo.shopifyThemeToZipBlob(visuallyEditedHorizonProject)).arrayBuffer());
  } finally {
    if (previousHorizonDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousHorizonDomParser;
  }
  const visuallyMaterializedHorizon = await visuallyEditedHorizonArchive.file('sections/footer.liquid').async('string');
  assert.deepEqual(
    liquidTokenSequence(visuallyMaterializedHorizon),
    liquidTokenSequence(horizonFooterSource),
    'visual edits to Horizon sections must preserve stylesheet, javascript and content_for token order',
  );
  assert.match(visuallyMaterializedHorizon, /<footer data-kodety-effect="fade-up" class="footer-content/);
  assert.match(visuallyMaterializedHorizon, /{% stylesheet %}[\s\S]*?\.footer-content[\s\S]*?{% endstylesheet %}/);
  assert.match(visuallyMaterializedHorizon, /{% javascript %}[\s\S]*?{% endjavascript %}/);
  assert.match(visuallyMaterializedHorizon, /{% content_for 'blocks' %}/);
  assert.doesNotMatch(
    visuallyMaterializedHorizon,
    /Sobre a marca|data-kodety-shopify-block|data-kodety-shopify-stylesheet/,
    'preview-only Horizon expansions must not leak into the exported Liquid source',
  );

  const rcdataLiquidSource = [
    '<section class="editorial-copy">',
    '  <textarea name="message">{{ section.settings.message }}</textarea>',
    '  <title data-theme-title>{{ section.settings.browser_title }} — {{ shop.name }}</title>',
    '  <p class="outside-rcdata">Edite este texto</p>',
    '</section>',
    '{% schema %}{"name":"RCDATA","settings":[{"type":"text","id":"message","default":"Mensagem da loja"},{"type":"text","id":"browser_title","default":"Coleção editorial"}]}{% endschema %}',
  ].join('\n');
  const rcdataRoundTrip = await materializeLiquidFixtureAfterVisualEdit('rcdata-round-trip', rcdataLiquidSource, preview =>
    preview.replace('<p class="outside-rcdata">', '<p class="outside-rcdata" data-kodety-effect="fade-up">'),
  );
  assert.match(
    rcdataRoundTrip.liquid,
    /<textarea name="message">\{\{ section\.settings\.message \}\}<\/textarea>/,
    'textarea RCDATA must retain its Liquid output when another element is edited visually',
  );
  assert.match(
    rcdataRoundTrip.liquid,
    /<title data-theme-title="">\{\{ section\.settings\.browser_title \}\} — \{\{ shop\.name \}\}<\/title>|<title data-theme-title>\{\{ section\.settings\.browser_title \}\} — \{\{ shop\.name \}\}<\/title>/,
    'title RCDATA must retain every Liquid output when another element is edited visually',
  );
  assert.deepEqual(
    liquidTokenSequence(rcdataRoundTrip.liquid),
    liquidTokenSequence(rcdataLiquidSource),
    'RCDATA projection must preserve the complete Liquid token sequence',
  );
  assert.doesNotMatch(
    rcdataRoundTrip.liquid.split('{% schema %}')[0],
    /KODETY_LIQUID|Mensagem da loja|Coleção editorial|Minha loja/,
    'RCDATA visual samples and sentinels must never leak into Liquid export',
  );

  const tableLoopLiquidSource = [
    '<section class="cart-lines">',
    '  <table><tbody>{% for item in cart.items %}<tr data-line="{{ forloop.index }}"><td>{{ item.product.title }}</td><td>{{ item.final_line_price | money }}</td></tr>{% endfor %}</tbody></table>',
    '  <p class="table-caption">Itens do pedido</p>',
    '</section>',
    '{% schema %}{"name":"Linhas do carrinho","settings":[]}{% endschema %}',
  ].join('\n');
  const tableLoopRoundTrip = await materializeLiquidFixtureAfterVisualEdit('table-loop-round-trip', tableLoopLiquidSource, preview =>
    preview.replace('<p class="table-caption">', '<p class="table-caption" data-kodety-effect="fade-up">'),
  );
  assert.match(
    tableLoopRoundTrip.liquid,
    /<tbody>\s*\{% for item in cart\.items %\}\s*<tr[^>]*>[\s\S]*?<\/tr>\s*\{% endfor %\}\s*<\/tbody>/,
    'a for-loop that owns table rows must remain inside tbody after visual DOM serialization',
  );
  assert.doesNotMatch(
    tableLoopRoundTrip.liquid,
    /\{% for item in cart\.items %\}\s*<tbody>|<\/tbody>\s*\{% endfor %\}/,
    'HTML table repair must not foster-parent Liquid loop delimiters outside tbody',
  );
  assert.deepEqual(
    liquidTokenSequence(tableLoopRoundTrip.liquid),
    liquidTokenSequence(tableLoopLiquidSource),
    'table repair must preserve every loop and output token in source order',
  );

  const dynamicPresentationLiquidSource = [
    '<section class="hero {{ section.settings.extra_class }}{% if section.settings.dark %} is-dark{% endif %}" style="color: {{ section.settings.color }}; transform: translateY({{ section.settings.offset }}px)">',
    '  <h2>{{ section.settings.heading }}</h2>',
    '</section>',
    '{% schema %}{"name":"Apresentação dinâmica","settings":[{"type":"text","id":"extra_class","default":"featured"},{"type":"checkbox","id":"dark","default":true},{"type":"color","id":"color","default":"#171717"},{"type":"range","id":"offset","default":16},{"type":"text","id":"heading","default":"Destaque"}]}{% endschema %}',
  ].join('\n');
  const dynamicPresentationRoundTrip = await materializeLiquidFixtureAfterVisualEdit(
    'dynamic-presentation-round-trip',
    dynamicPresentationLiquidSource,
    preview =>
      preview.replace(/(<section\b[^>]*\bclass=")([^"]*)(")/, '$1$2 visual-accent$3').replace(/(<section\b[^>]*\bstyle=")([^"]*)(")/, '$1$2; opacity: 0.75$3'),
  );
  assert.match(
    dynamicPresentationRoundTrip.liquid,
    /class="[^"]*\{\{ section\.settings\.extra_class \}\}[^"]*\{% if section\.settings\.dark %\} is-dark\{% endif %\}[^"]*visual-accent[^"]*"/,
    'adding a visual class must merge with the authored class lexeme instead of replacing Liquid bindings',
  );
  assert.match(
    dynamicPresentationRoundTrip.liquid,
    /style="[^"]*color:\s*\{\{ section\.settings\.color \}\};[^"]*translateY\(\{\{ section\.settings\.offset \}\}px\)[^"]*opacity:\s*0\.75[^"]*"/,
    'adding an effect style must merge with the authored style lexeme instead of replacing Liquid bindings',
  );
  assert.deepEqual(
    liquidTokenSequence(dynamicPresentationRoundTrip.liquid),
    liquidTokenSequence(dynamicPresentationLiquidSource),
    'visual class and style deltas must retain every dynamic class/style token',
  );
  assert.doesNotMatch(
    dynamicPresentationRoundTrip.liquid,
    /class="hero featured|color:\s*#171717|translateY\(16px\)/,
    'resolved visual class/style samples must not replace authored Liquid expressions',
  );

  const attributeLexemeLiquidSource = [
    '<section class="search-card">',
    '  <a href=\'{{ routes.search_url | append: "?type=product&q=" | append: search.terms }}\'>Buscar produtos</a>',
    '  <svg viewBox="0 0 24 24" aria-label="Busca"><path d="M2 12h20"></path></svg>',
    '  <p class="lexeme-caption">Busca editorial</p>',
    '</section>',
    '{% schema %}{"name":"Busca","settings":[]}{% endschema %}',
  ].join('\n');
  const attributeLexemeRoundTrip = await materializeLiquidFixtureAfterVisualEdit('attribute-lexeme-round-trip', attributeLexemeLiquidSource, preview =>
    preview.replace('<p class="lexeme-caption">', '<p class="lexeme-caption" data-kodety-effect="fade-up">'),
  );
  assert.match(
    attributeLexemeRoundTrip.liquid,
    /href='\{\{ routes\.search_url \| append: "\?type=product&q=" \| append: search\.terms \}\}'/,
    'a single-quoted attribute must preserve its quote lexeme and double quotes inside Liquid',
  );
  assert.doesNotMatch(
    attributeLexemeRoundTrip.liquid,
    /href="[^"]*&quot;|append:\s*&quot;/,
    'DOM serialization must not HTML-escape quotes that belong to the Liquid expression',
  );
  assert.match(
    attributeLexemeRoundTrip.liquid,
    /<svg viewBox="0 0 24 24" aria-label="Busca">/,
    'foreign-content attributes must preserve their case-sensitive SVG lexeme',
  );
  assert.deepEqual(
    liquidTokenSequence(attributeLexemeRoundTrip.liquid),
    liquidTokenSequence(attributeLexemeLiquidSource),
    'attribute lexeme restoration must retain the complete Liquid token sequence',
  );
  const directlyEditedLiquid = projectIo.updateTextFile(
    importedLiquidProject,
    'sections/main-product.liquid',
    '<section><h1>{{ product.title }}</h1><p>Alterado no Code</p></section>\n',
  );
  const exportedLiquidArchive = await JSZip.loadAsync(await (await projectIo.shopifyThemeToZipBlob(directlyEditedLiquid)).arrayBuffer());
  assert.equal(
    await exportedLiquidArchive.file('sections/main-product.liquid').async('string'),
    directlyEditedLiquid.files['sections/main-product.liquid'].text,
    'the standard export materializer must preserve direct Liquid edits',
  );
  assert.equal(exportedLiquidArchive.file('index.html'), null);
  assert.equal(exportedLiquidArchive.file('.incode/shopify-theme.json'), null);
  const liquidWithOverlay = projectIo.updateTextFile(
    directlyEditedLiquid,
    'sections/main-product.liquid',
    '<section><button data-kodety-overlay-open aria-controls="product-help">Ajuda</button><div data-kodety-overlay="popover"><div id="product-help" data-kodety-overlay-surface hidden>Detalhes</div></div></section>\n',
  );
  const overlayLiquidArchive = await JSZip.loadAsync(await (await projectIo.shopifyThemeToZipBlob(liquidWithOverlay)).arrayBuffer());
  const overlayLiquidLayout = await overlayLiquidArchive.file('layout/theme.liquid').async('string');
  assert.match(
    overlayLiquidLayout,
    /data-kodety-native-components-runtime/,
    'a standard Shopify export must install the native overlay runtime in its Liquid layout',
  );
  assert.equal(
    (overlayLiquidLayout.match(/data-kodety-native-components-runtime/g) || []).length,
    1,
    'a Shopify layout must receive the native runtime at most once',
  );
  assert.equal(
    (overlayLiquidLayout.match(/data-kodety-native-components-style="2"/g) || []).length,
    1,
    'a Shopify layout must receive exactly one current fail-closed overlay style',
  );
  assert.ok(
    overlayLiquidLayout.indexOf('data-kodety-native-components-style="2"') < overlayLiquidLayout.indexOf('data-kodety-native-components-runtime="2"'),
    'the Shopify fail-closed style must precede its delegated overlay runtime',
  );
  assert.doesNotMatch(
    await overlayLiquidArchive.file('sections/main-product.liquid').async('string'),
    /data-kodety-native-components-runtime/,
    'the runtime belongs in the Liquid layout instead of being duplicated into authored sections',
  );

  const folderLayout = new File(['<html><body>{{ content_for_layout }}</body></html>'], 'theme.liquid', {
    type: 'text/plain',
  });
  Object.defineProperty(folderLayout, 'webkitRelativePath', {
    value: 'Minha Loja/layout/theme.liquid',
  });
  const folderSection = new File(['<section>{{ product.title }}</section>'], 'main-product.liquid', {
    type: 'text/plain',
  });
  Object.defineProperty(folderSection, 'webkitRelativePath', {
    value: 'Minha Loja/sections/main-product.liquid',
  });
  const importedLiquidFolder = await projectIo.importFolder([folderLayout, folderSection]);
  assert.equal(projectIo.isShopifyThemeProject(importedLiquidFolder), true);
  assert.equal(importedLiquidFolder.mainHtmlPath, 'index.html', 'folder imports containing Liquid must enter the same Builder flow as ZIP imports');
  const metadataPreviewFonts = previewRuntime.createProjectFontPreviewStylesheet(
    metadataFontProject,
    fontPath => `data:,kodety-runtime-asset-${encodeURIComponent(fontPath)}`,
  );
  assert.match(
    metadataPreviewFonts.cssText,
    /font-family:"Rubrika Neue Haas";[^}]*font-weight:700;[^}]*font-style:italic/,
    'the isolated canvas font sheet must expose every inferred weight under the authored canonical family',
  );
  assert.match(
    metadataPreviewFonts.cssText,
    /font-family:"Neue Haas Grotesk Display";[^}]*font-weight:700;[^}]*font-style:italic/,
    'the isolated canvas font sheet must preserve internal-family aliases without parent-realm Blob URLs',
  );
  assert.deepEqual(
    metadataPreviewFonts.assetPaths.sort(),
    ['site/fonts/NeueHaas-BoldItalic.ttf', 'site/fonts/NeueHaas-MediumItalic.ttf'],
    'the isolated canvas must transfer every binary needed by the canonical family and its aliases',
  );
  const liveFontStylesheet = previewRuntime.resolvePreviewStylesheet(fontProject, 'site/styles/site.css', fontProject.files['site/styles/site.css'].text);
  assert.ok(
    liveFontStylesheet.cssText.includes('data:,kodety-runtime-asset-site%2Ffonts%2Fneue-haas-regular.woff2') &&
      liveFontStylesheet.cssText.includes('data:,kodety-runtime-asset-site%2Ffonts%2Fneue-haas-bold-italic.woff2'),
    'live visual CSS updates must keep font binaries transferable into the opaque canvas',
  );
  assert.equal(liveFontStylesheet.objectUrls.length, 0, 'live canvas stylesheets must never reference Blob URLs owned by the parent document');
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const projectFontRuntime = projectFonts.createProjectFontRuntime(fontProject);
    assert.match(projectFontRuntime.css, /font-family:"Neue Haas Display"/);
    assert.match(projectFontRuntime.css, /font-weight:700/);
    assert.equal(projectFontRuntime.objectUrls.length, 4, 'each distinct project font binary must receive one reusable browser URL');
    projectFontRuntime.revoke();
    const metadataFontRuntime = projectFonts.createProjectFontRuntime(metadataFontProject);
    assert.match(
      metadataFontRuntime.css,
      /font-family:"Rubrika Neue Haas";[^}]*font-weight:700;[^}]*font-style:italic/,
      'the runtime must expose inferred alias faces under the canonical family saved by the picker',
    );
    assert.match(
      metadataFontRuntime.css,
      /font-family:"Haas Grot Disp R Trial";[^}]*font-weight:700;[^}]*font-style:italic/,
      'the runtime must keep complete weights available under authored aliases too',
    );
    assert.doesNotMatch(metadataFontRuntime.css, /Arial Placeholder/, 'local-only placeholder faces must not leak into the generated project runtime');
    metadataFontRuntime.revoke();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.equal(
    fontUtils.fontFamilyValueMatches('"Neue Haas Display", Helvetica, sans-serif', neueHaasFont),
    true,
    'a complete authored CSS fallback stack must select its project font in the picker',
  );
  const interWoff2 = new Uint8Array(await readFile(path.join(root, 'Wordpress/kodety/admin/fonts/inter-latin-variable.woff2')));
  const socialViteFontProject = {
    name: 'Social WOFF2 fixture',
    rootPath: 'site',
    mainHtmlPath: 'site/index.html',
    openedAt: 1,
    files: {
      'site/index.html': {
        path: 'site/index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html></html>',
      },
      'site/vite.config.ts': {
        path: 'site/vite.config.ts',
        mimeType: 'text/typescript',
        text: 'export default { publicDir: "public" };',
      },
      'site/assets/inter.woff2': {
        path: 'site/assets/inter.woff2',
        mimeType: 'font/woff2',
        data: interWoff2,
      },
    },
  };
  const preparedWoff2 = await socialFontConversion.prepareSocialFontFile(socialViteFontProject, 'site/assets/inter.woff2');
  assert.match(preparedWoff2.fontFile, /^\.kodety-social\/fonts\/[a-f0-9]{64}\.ttf$/, 'a WOFF2 project font must become a stable public TTF reference');
  assert.equal(preparedWoff2.storedPath, `site/public/${preparedWoff2.fontFile}`, 'a Vite project must persist its converted social font below public/');
  const preparedWoff2File = preparedWoff2.project.files[preparedWoff2.storedPath];
  assert.deepEqual(Array.from(preparedWoff2File.data.slice(0, 4)), [0x00, 0x01, 0x00, 0x00], 'WOFF2 conversion must yield a validated SFNT payload');
  assert.equal(socialViteFontProject.files[preparedWoff2.storedPath], undefined, 'preparing a font must not mutate the incoming project snapshot');
  const repeatedWoff2 = await socialFontConversion.prepareSocialFontFile(preparedWoff2.project, preparedWoff2.fontFile);
  assert.equal(repeatedWoff2.project, preparedWoff2.project, 'content-addressed social fonts must be idempotent');
  const concurrentSocialFontProject = {
    ...socialViteFontProject,
    name: 'Name changed during conversion',
  };
  const mergedWoff2 = socialFontConversion.mergePreparedSocialFontFile(concurrentSocialFontProject, preparedWoff2);
  assert.equal(mergedWoff2.name, concurrentSocialFontProject.name);
  assert.equal(mergedWoff2.files[preparedWoff2.storedPath], preparedWoff2File, 'the derived font must merge without discarding concurrent project edits');

  const socialStaticFontProject = {
    name: 'Social SFNT fixture',
    rootPath: 'static-site',
    mainHtmlPath: 'static-site/index.html',
    openedAt: 1,
    files: {
      'static-site/index.html': {
        path: 'static-site/index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html></html>',
      },
      // Deliberately use the wrong authored extension: the persisted copy must
      // be normalized from its binary signature, not trusted metadata.
      'static-site/assets/inter.otf': {
        path: 'static-site/assets/inter.otf',
        mimeType: 'font/otf',
        data: preparedWoff2File.data,
      },
    },
  };
  const preparedSfnt = await socialFontConversion.prepareSocialFontFile(socialStaticFontProject, 'static-site/assets/inter.otf');
  assert.equal(preparedSfnt.storedPath, `static-site/${preparedSfnt.fontFile}`, 'a non-Vite project must persist the immutable font below its project root');
  assert.match(preparedSfnt.fontFile, /\.ttf$/);
  await assert.rejects(
    socialFontConversion.prepareSocialFontFile(
      {
        ...socialStaticFontProject,
        files: {
          ...socialStaticFontProject.files,
          'static-site/assets/broken.woff2': {
            path: 'static-site/assets/broken.woff2',
            mimeType: 'font/woff2',
            data: new Uint8Array(48),
          },
        },
      },
      'static-site/assets/broken.woff2',
    ),
    /assinatura inválida/,
    'invalid WOFF2 input must fail before reaching the decompressor',
  );
  assert.equal(
    fontUtils.fontFamilyValueMatches(
      '"Neue Haas Display", Helvetica, sans-serif',
      fontUtils.BUILT_IN_FONTS.find(font => font.name === 'sans'),
    ),
    false,
    'a generic fallback must not also select the built-in system option',
  );
  const visuallyEditedFontProject = structuredClone(fontProject);
  visuallyEditedFontProject.files['site/styles/site.css'].text = visuallyEditedFontProject.files['site/styles/site.css'].text.replace(
    'color: red',
    'color: blue',
  );
  assert.equal(
    projectFonts.projectFontSourceSignature(fontProject),
    projectFonts.projectFontSourceSignature(visuallyEditedFontProject),
    'ordinary visual edits must not churn project font object URLs',
  );
  const privatelyEditedFontProject = structuredClone(fontProject);
  privatelyEditedFontProject.files['.incode/experiments/home/variant-a/project/site/fonts/private.ttf'].data = new Uint8Array([99, 98, 97]);
  assert.equal(
    projectFonts.projectFontSourceSignature(fontProject),
    projectFonts.projectFontSourceSignature(privatelyEditedFontProject),
    'private experiment font clones must not churn the public project font runtime',
  );
  assert.equal(
    projectFonts.resolveProjectFontFile(fontProject, 'site/styles/site.css', '/.incode/experiments/home/variant-a/project/site/fonts/private.ttf'),
    '',
    'private font paths must not resolve through public font-face discovery',
  );

  assert.deepEqual(
    wordpressPublication.resolveWordPressPublicationState({
      release: '20260727-partial',
      publicationComplete: false,
      releaseOnline: true,
      syncPending: true,
      warnings: ['Assets pendentes.', 'Assets pendentes.', '', 42],
    }),
    {
      complete: false,
      releaseOnline: true,
      warnings: ['Assets pendentes.'],
    },
    'HTTP 202 payloads must remain partial even though their release is already online',
  );
  assert.deepEqual(
    wordpressPublication.resolveWordPressPublicationState({
      release: 'legacy-complete',
    }),
    {
      complete: true,
      releaseOnline: true,
      warnings: [],
    },
    'publish payloads from older WordPress runtimes must retain the completed contract',
  );

  const queuedWrites = [];
  let releaseFirstQueuedWrite;
  const firstQueuedWriteGate = new Promise(resolve => {
    releaseFirstQueuedWrite = resolve;
  });
  const latestWriteQueue = projectStorage.createLatestWriteQueue(async value => {
    queuedWrites.push(value);
    if (value === 'first') await firstQueuedWriteGate;
    return `saved:${value}`;
  });
  const firstQueuedResult = latestWriteQueue('first');
  assert.deepEqual(queuedWrites, ['first'], 'the first local recovery write must start immediately without an idle timer');
  const supersededQueuedResult = latestWriteQueue('superseded');
  const latestQueuedResult = latestWriteQueue('latest');
  assert.deepEqual(queuedWrites, ['first'], 'rapid snapshots must occupy one pending slot while a write is in flight');
  releaseFirstQueuedWrite();
  assert.deepEqual(
    await Promise.all([firstQueuedResult, supersededQueuedResult, latestQueuedResult]),
    ['saved:first', 'saved:latest', 'saved:latest'],
    'coalesced callers must resolve only after the newest pending snapshot is stored',
  );
  assert.deepEqual(queuedWrites, ['first', 'latest'], 'latest-wins storage must never build an unbounded queue of project clones');

  assert.equal(
    classSelector.classEditingSelector(['card', 'shadow', 'large'], ['shadow'], 2),
    '.card.large',
    'reusable classes must not become dependencies of neighboring combo selectors',
  );
  assert.equal(classSelector.classEditingSelector(['card', 'shadow'], ['shadow']), '.shadow', 'a reusable class must always edit its standalone selector');
  assert.deepEqual(
    classSelector.normalizeReusableClassNames(['shadow', 'shadow', '2invalid', '', 'wide']),
    ['shadow', 'wide'],
    'the reusable-class registry must normalize, validate and deduplicate metadata',
  );
  const indexedClassSource =
    '<!doctype html><html><body class="theme base"><main class="base combo"><p class="base combo detail">Text</p></main></body></html>';
  assert.deepEqual(
    classSelector.allClassNames(indexedClassSource),
    ['theme', 'base', 'combo', 'detail'],
    'class discovery through the shared source index must retain body classes and document order',
  );
  assert.equal(classSelector.countClassUsage(indexedClassSource, ['base']), 3, 'class usage must include body at the canonical empty path');
  assert.equal(classSelector.countClassUsage(indexedClassSource, ['base', 'combo']), 2);
  assert.deepEqual(
    classSelector.comboSuggestions(indexedClassSource, 'base', ['theme']),
    ['combo', 'detail'],
    'combo suggestions must keep their frequency ordering when backed by the shared parse5 index',
  );

  const renameReferenceProject = {
    name: 'Rename references',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<link href="./styles/main.css?rev=1"><link href="/styles/main.css"><link href=styles/main.css><a href="https://cdn.example/styles/main.css">externo</a><style>.theme{--sheet:styles/main.css;}</style><span>styles/main.css.map</span>',
      },
      'src/main.js': {
        path: 'src/main.js',
        mimeType: 'text/javascript',
        text: 'import "../styles/main.css"; const stylesheet = "styles/main.css";',
      },
      'styles/main.css': {
        path: 'styles/main.css',
        mimeType: 'text/css',
        text: '@import "./main.css";',
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({ version: 1, stylesheet: 'styles/main.css' }),
      },
    },
  };
  const renamedReferenceProject = projectIo.renameProjectFile(renameReferenceProject, 'styles/main.css', 'styles/theme.css');
  assert.ok(renamedReferenceProject.files['styles/theme.css'], 'renaming a text asset must move the canonical project file');
  assert.match(
    renamedReferenceProject.files['index.html'].text,
    /href="\.\/styles\/theme\.css\?rev=1"[\s\S]*?href="\/styles\/theme\.css"/,
    'HTML document-relative and project-root references must follow a renamed stylesheet',
  );
  assert.match(
    renamedReferenceProject.files['index.html'].text,
    /href=styles\/theme\.css>[\s\S]*?--sheet:styles\/theme\.css;/,
    'unquoted HTML attributes and semicolon-terminated CSS values must follow a renamed asset',
  );
  assert.match(
    renamedReferenceProject.files['src/main.js'].text,
    /import "\.\.\/styles\/theme\.css"/,
    'module references must be recalculated from each source file',
  );
  assert.match(renamedReferenceProject.files['styles/theme.css'].text, /@import "\.\/theme\.css"/, 'a moved text file must update its own bounded references');
  assert.match(renamedReferenceProject.files['.incode/project.json'].text, /styles\/theme\.css/, 'project metadata references must follow a renamed asset');
  assert.match(
    renamedReferenceProject.files['index.html'].text,
    /https:\/\/cdn\.example\/styles\/main\.css/,
    'renaming a local asset must not rewrite a matching path on an external origin',
  );
  assert.match(
    renamedReferenceProject.files['index.html'].text,
    /styles\/main\.css\.map/,
    'renaming must not rewrite a longer filename that only shares the same prefix',
  );
  const imageConversionReferenceProject = {
    name: 'Image conversion references',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<picture><source srcset="/assets/hero.jpg 1x, ./assets/icon.png 2x"><img src="./assets/hero.jpg?rev=4" style="background:url(assets/icon.png)"></picture>',
      },
      'styles/site.css': {
        path: 'styles/site.css',
        mimeType: 'text/css',
        text: '.hero{background-image:url("../assets/hero.jpg#focus")}.icon{mask:url(../assets/icon.png)}',
      },
      'src/runtime.js': {
        path: 'src/runtime.js',
        mimeType: 'text/javascript',
        text: 'const hero = "../assets/hero.jpg"; const icon = "../assets/icon.png";',
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          socialImage: 'assets/hero.jpg',
          icon: 'assets/icon.png',
        }).replaceAll('/', '\\/'),
      },
      'assets/hero.jpg': {
        path: 'assets/hero.jpg',
        mimeType: 'image/jpeg',
        data: new Uint8Array([1, 2, 3]),
      },
      'assets/icon.png': {
        path: 'assets/icon.png',
        mimeType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
      },
    },
  };
  const convertedImageReferenceProject = [
    ['assets/hero.jpg', 'assets/hero.webp'],
    ['assets/icon.png', 'assets/icon.webp'],
  ].reduce((current, [sourcePath, targetPath]) => projectIo.renameProjectFile(current, sourcePath, targetPath), imageConversionReferenceProject);
  assert.ok(
    convertedImageReferenceProject.files['assets/hero.webp'] && convertedImageReferenceProject.files['assets/icon.webp'],
    'batch conversion must create every target path before the transaction is committed',
  );
  assert.equal(convertedImageReferenceProject.files['assets/hero.jpg'], undefined);
  assert.equal(convertedImageReferenceProject.files['assets/icon.png'], undefined);
  const convertedImageText = Object.values(convertedImageReferenceProject.files)
    .map(file => file.text || '')
    .join('\n');
  assert.doesNotMatch(
    convertedImageText,
    /assets\/(?:hero\.jpg|icon\.png)/,
    'batch conversion must leave no direct old image reference in HTML, CSS, JavaScript or metadata',
  );
  assert.match(
    convertedImageReferenceProject.files['index.html'].text,
    /srcset="\/assets\/hero\.webp 1x, \.\/assets\/icon\.webp 2x"[\s\S]*?src="\.\/assets\/hero\.webp\?rev=4"/,
    'srcset candidates and query-bearing image URLs must follow converted extensions',
  );
  assert.match(
    convertedImageReferenceProject.files['styles/site.css'].text,
    /url\("\.\.\/assets\/hero\.webp#focus"\)[\s\S]*?url\(\.\.\/assets\/icon\.webp\)/,
    'CSS URLs with quotes, fragments and unquoted values must follow converted extensions',
  );
  assert.match(
    convertedImageReferenceProject.files['src/runtime.js'].text,
    /\.\.\/assets\/hero\.webp[\s\S]*?\.\.\/assets\/icon\.webp/,
    'literal JavaScript asset paths must follow the same batch transaction',
  );
  assert.match(
    convertedImageReferenceProject.files['.incode/project.json'].text,
    /assets\\\/hero\.webp[\s\S]*?assets\\\/icon\.webp/,
    'JSON slash-escaped metadata asset paths must follow the same batch transaction',
  );
  assert.equal(
    projectIo.rewriteProjectFileReferenceText('./case-ampere-thumb.png', 'index.html', 'case-ampere-thumb.png', 'case-ampere-thumb.avif'),
    './case-ampere-thumb.avif',
    'Inspector media attributes must use the same path migration as project files',
  );
  assert.equal(
    projectIo.rewriteProjectFileReferenceText('.\\/case-ampere-thumb.png', '.incode/project.json', 'case-ampere-thumb.png', 'case-ampere-thumb.webp'),
    '.\\/case-ampere-thumb.webp',
    'serialized metadata overrides must not restore a removed image extension',
  );
  const scopedVariantReferenceProject = {
    ...imageConversionReferenceProject,
    files: {
      ...imageConversionReferenceProject.files,
      '.incode/experiments/sale/b/project/index.html': {
        path: '.incode/experiments/sale/b/project/index.html',
        mimeType: 'text/html',
        text: '<img src="assets/hero.jpg">',
      },
      '.incode/experiments/sale/b/project/assets/hero.jpg': {
        path: '.incode/experiments/sale/b/project/assets/hero.jpg',
        mimeType: 'image/jpeg',
        data: new Uint8Array([7, 8, 9]),
      },
    },
  };
  const publicOnlyReferenceRewrite = projectIo.rewriteProjectFileReferences(
    projectIo.renameProjectFile(scopedVariantReferenceProject, 'assets/hero.jpg', 'assets/hero.webp', {
      rewriteReferences: false,
    }),
    'assets/hero.jpg',
    'assets/hero.webp',
    {
      shouldRewriteFile: path => !path.startsWith('.incode/experiments/'),
    },
  );
  assert.match(publicOnlyReferenceRewrite.files['index.html'].text, /assets\/hero\.webp/, 'control references must follow a control image conversion');
  assert.match(
    publicOnlyReferenceRewrite.files['.incode/experiments/sale/b/project/index.html'].text,
    /assets\/hero\.jpg/,
    'a control conversion must not rewrite a variant reference with different protected bytes',
  );
  const renamedPrivateAsset = projectIo.renameProjectFile(
    publicOnlyReferenceRewrite,
    '.incode/experiments/sale/b/project/assets/hero.jpg',
    '.incode/experiments/sale/b/project/assets/hero.webp',
    {
      allowInternalPath: true,
      rewriteReferences: false,
    },
  );
  assert.ok(
    renamedPrivateAsset.files['.incode/experiments/sale/b/project/assets/hero.webp'],
    'the conversion transaction must be allowed to rename a validated private variant asset',
  );
  const renamedAcrossTypes = projectIo.renameProjectFile(renamedReferenceProject, 'styles/theme.css', 'styles/theme.js');
  assert.equal(
    renamedAcrossTypes.files['styles/theme.js'].mimeType,
    'text/javascript',
    'changing a file extension must update the MIME contract used by preview and publish',
  );
  const genericPageCompanionPath = interactions.interactionDocumentPath('pages/case.html');
  const renamedGenericPageCompanionPath = interactions.interactionDocumentPath('work/case.html');
  const unrelatedPageCompanionPath = interactions.interactionDocumentPath('about.html');
  const genericPageFileProject = {
    name: 'Generic page companion lifecycle',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body></body></html>',
      },
      'pages/case.html': {
        path: 'pages/case.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><main></main></body></html>',
      },
      'about.html': {
        path: 'about.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><main></main></body></html>',
      },
      [genericPageCompanionPath]: {
        path: genericPageCompanionPath,
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 2,
          interactions: [{ id: 'case-animation' }],
        }),
      },
      [unrelatedPageCompanionPath]: {
        path: unrelatedPageCompanionPath,
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 2,
          interactions: [{ id: 'about-animation' }],
        }),
      },
    },
  };
  const renamedGenericPage = projectIo.renameProjectFile(genericPageFileProject, 'pages/case.html', 'work/case.html');
  assert.equal(
    renamedGenericPage.files[genericPageCompanionPath],
    undefined,
    'the Files-panel rename boundary must remove the old HTML animation companion path',
  );
  assert.equal(
    renamedGenericPage.files[renamedGenericPageCompanionPath]?.path,
    renamedGenericPageCompanionPath,
    'the Files-panel rename boundary must move the HTML animation companion with the page',
  );
  assert.match(
    renamedGenericPage.files[renamedGenericPageCompanionPath].text,
    /case-animation/,
    'renaming a page must preserve its companion payload byte-for-byte',
  );
  const removedGenericPage = projectIo.removeProjectFile(renamedGenericPage, 'work/case.html');
  assert.equal(removedGenericPage.files['work/case.html'], undefined);
  assert.equal(removedGenericPage.files[renamedGenericPageCompanionPath], undefined, 'removing an HTML file must also remove its animation companion');
  assert.ok(removedGenericPage.files[unrelatedPageCompanionPath], 'removing one HTML file must preserve animation companions owned by other pages');

  const browserNativeProject = {
    name: 'Imported browser bundle',
    mainHtmlPath: 'Ready Site/index.html',
    rootPath: 'Ready Site',
    openedAt: Date.now(),
    files: {
      'Ready Site/index.html': {
        path: 'Ready Site/index.html',
        mimeType: 'text/html',
        text: `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="./assets/site.css">
    <script type="importmap">
      { "imports": { "gsap": "./vendor/gsap.js" } }
    </script>
  </head>
  <body><span>Somos a Unkern</span><script type="module" src="./assets/app.js"></script></body>
</html>
`,
      },
      'Ready Site/assets/site.css': {
        path: 'Ready Site/assets/site.css',
        mimeType: 'text/css',
        text: `.hero::after {
  content: "duas  palavras";
  background: url("../media/hero.webp") center / cover;
}
`,
      },
      'Ready Site/assets/app.js': {
        path: 'Ready Site/assets/app.js',
        mimeType: 'text/javascript',
        text: `import { gsap } from "gsap";
import { start } from "./chunk.js";

start(gsap);
`,
      },
      'Ready Site/assets/chunk.js': {
        path: 'Ready Site/assets/chunk.js',
        mimeType: 'text/javascript',
        text: `export function start(gsap) {
  gsap.set(document.body, { opacity: 1 });
}
`,
      },
      'Ready Site/vendor/gsap.js': {
        path: 'Ready Site/vendor/gsap.js',
        mimeType: 'text/javascript',
        text: 'export const gsap = globalThis.gsap;\n',
      },
      'Ready Site/vite.config.js': {
        path: 'Ready Site/vite.config.js',
        mimeType: 'text/javascript',
        text: 'export default { base: "./" };\n',
      },
      'Ready Site/media/hero.webp': {
        path: 'Ready Site/media/hero.webp',
        mimeType: 'image/webp',
        data: new Uint8Array([82, 73, 70, 70]),
      },
    },
  };
  assert.equal(
    codedProject.projectRequiresCodedBuild(browserNativeProject),
    false,
    'a Vite config alone must not opt a browser-native ESM graph into source compilation',
  );
  const browserNativeTransport = projectIo.prepareProjectForTransport(browserNativeProject);
  Object.values(browserNativeProject.files).forEach(file => {
    if (file.text === undefined) return;
    assert.equal(browserNativeTransport.files[file.path]?.text, file.text, `${file.path} must reach transport byte-for-byte`);
  });
  assert.equal(
    Object.keys(browserNativeTransport.files).some(path => path.startsWith('kodety-build/')),
    false,
    'an imported browser bundle must not gain a parallel generated module graph',
  );
  const browserNativePublishPackage = await projectIo.projectToPublishPackage(browserNativeProject, { fast: true });
  const browserNativePublishArchive = await JSZip.loadAsync(await browserNativePublishPackage.zip.arrayBuffer());
  for (const file of Object.values(browserNativeProject.files)) {
    if (file.text === undefined) continue;
    assert.equal(await browserNativePublishArchive.file(file.path).async('string'), file.text, `${file.path} must remain byte-for-byte inside the publish ZIP`);
  }

  const codedSourceProject = {
    name: 'Vite source',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta property="og:image" content="/social-preview.png"><link rel="manifest" href="./manifest.webmanifest"></head><body><img src="./hero.png" srcset="/hero.png 1x, ./legacy/Hero%20Image.PNG 2x" data-lazy-src="./logo.svg"><video poster="/poster.jpg"></video><div style="background-image:url(\'/hero.png\')"></div><script type="module" src="/src/main.js"></script></body></html>',
      },
      'package.json': {
        path: 'package.json',
        mimeType: 'application/json',
        text: JSON.stringify({ dependencies: { gsap: '^3.15.0' } }),
      },
      'src/main.js': {
        path: 'src/main.js',
        mimeType: 'text/javascript',
        text: 'import "./style.css";\nimport { gsap } from "gsap";\nimport logoUrl from "/logo.svg?url";\nconst poster = new URL("/poster.jpg?size=2#frame", import.meta.url);\nconst assignedImage = "./showreel-poster.jpg?cache=1#cover";\ndocument.body.insertAdjacentHTML("beforeend", `<img src="./showreel-poster.jpg">`);\ngsap.set(document.body, { opacity: 1 });\nvoid logoUrl; void assignedImage;',
      },
      'src/style.css': {
        path: 'src/style.css',
        mimeType: 'text/css',
        text: '@font-face{font-family:Rubrika;src:url("../fonts/Rubrika Display.otf") format("opentype")}.hero{background-image:url("/hero.png")}',
      },
      'public/hero.png': {
        path: 'public/hero.png',
        mimeType: 'image/png',
        data: new Uint8Array([137, 80, 78, 71]),
      },
      'public/social-preview.png': {
        path: 'public/social-preview.png',
        mimeType: 'image/png',
        data: new Uint8Array([137, 80, 78, 71, 1]),
      },
      'public/poster.jpg': {
        path: 'public/poster.jpg',
        mimeType: 'image/jpeg',
        data: new Uint8Array([255, 216, 255]),
      },
      'public/showreel-poster.jpg': {
        path: 'public/showreel-poster.jpg',
        mimeType: 'image/jpeg',
        data: new Uint8Array([255, 216, 254]),
      },
      'public/logo.svg': {
        path: 'public/logo.svg',
        mimeType: 'image/svg+xml',
        text: '<svg xmlns="http://www.w3.org/2000/svg"><image href="/hero.png"></image></svg>',
      },
      'media/gallery/Hero Image.PNG': {
        path: 'media/gallery/Hero Image.PNG',
        mimeType: 'image/png',
        data: new Uint8Array([137, 80, 78, 71, 2]),
      },
      'fonts/Rubrika Display.otf': {
        path: 'fonts/Rubrika Display.otf',
        mimeType: 'font/otf',
        data: new Uint8Array([79, 84, 84, 79]),
      },
      'manifest.webmanifest': {
        path: 'manifest.webmanifest',
        mimeType: 'application/manifest+json',
        text: JSON.stringify({
          icons: [{ src: '/hero.png', sizes: '512x512' }],
        }),
      },
    },
  };
  assert.equal(
    codedProject.projectPublicFilePath(codedSourceProject, 'hero.png'),
    'public/hero.png',
    'Vite public assets must resolve from the authored web root in the Builder',
  );
  assert.deepEqual(
    previewRuntime.runtimeAssetPathAliases(codedSourceProject, ['public/hero.png']),
    { 'hero.png': 'public/hero.png' },
    'the opaque iframe bridge must map authored Vite web-root paths back to canonical public files',
  );
  assert.deepEqual(
    previewRuntime.runtimeAssetPathAliases(
      {
        ...codedSourceProject,
        mainHtmlPath: 'Arquivos/index.html',
        rootPath: 'Arquivos',
      },
      ['Arquivos/public/hero.png', 'Arquivos/assets/other.png'],
    ),
    { 'Arquivos/hero.png': 'Arquivos/public/hero.png' },
    'public aliases must retain a nested imported project root and ignore ordinary asset paths',
  );
  const importedPassThroughTransport = projectIo.prepareProjectForTransport(codedSourceProject);
  assert.equal(
    importedPassThroughTransport.files['index.html'].text,
    codedSourceProject.files['index.html'].text,
    'an imported executable HTML document must reach transport byte-for-byte',
  );
  assert.equal(
    importedPassThroughTransport.files['src/main.js'].text,
    codedSourceProject.files['src/main.js'].text,
    'an imported native module must reach transport byte-for-byte',
  );
  assert.equal(
    importedPassThroughTransport.files['src/style.css'].text,
    codedSourceProject.files['src/style.css'].text,
    'an imported stylesheet must reach transport byte-for-byte',
  );
  assert.equal(
    importedPassThroughTransport.files['kodety-build/src/main.js'],
    undefined,
    'pass-through transport must not create a parallel Kodety module graph',
  );
  assert.equal(
    codedProject.projectRequiresCodedBuild(codedSourceProject),
    false,
    'ambiguous source syntax without an explicit Vite signature must remain fail-safe pass-through',
  );
  const explicitViteSourceProject = {
    ...codedSourceProject,
    files: {
      ...codedSourceProject.files,
      'vite.config.js': {
        path: 'vite.config.js',
        mimeType: 'text/javascript',
        text: 'export default { base: "./" };',
      },
    },
  };
  assert.equal(
    codedProject.projectRequiresCodedBuild(explicitViteSourceProject),
    true,
    'an explicit Vite project with reachable CSS/npm imports must opt into source compilation',
  );
  assert.ok(
    projectIo.prepareProjectForTransport(explicitViteSourceProject).files['kodety-build/src/main.js'],
    'the public transport boundary must compile only a positively identified Vite source project',
  );
  const codedTransport = codedProject.prepareCodedProjectForTransport(codedSourceProject);
  assert.equal(
    codedTransport.files['src/main.js'].text,
    codedSourceProject.files['src/main.js'].text,
    'the authored module must remain byte-for-byte available beside generated publish artifacts',
  );
  assert.ok(codedTransport.files['hero.png'], 'publish build must hoist Vite public assets to the web root');
  assert.ok(codedTransport.files['poster.jpg'], 'every public image format must be hoisted to the authored web root');
  assert.match(
    codedTransport.files['index.html'].text,
    /srcset="\.\/hero\.png 1x, \.\/media\/gallery\/Hero Image\.PNG 2x"/,
    'srcset candidates must resolve public-root, encoded and uniquely relocated upload paths',
  );
  assert.match(
    codedTransport.files['index.html'].text,
    /data-lazy-src="\.\/logo\.svg"/,
    'lazy-loaded image attributes must use the same automatic asset resolver',
  );
  assert.match(codedTransport.files['index.html'].text, /poster="\.\/poster\.jpg"/, 'video poster assets must be normalized during publication');
  assert.match(
    codedTransport.files['index.html'].text,
    /property="og:image" content="\.\/social-preview\.png"/,
    'social preview images must be normalized instead of silently breaking',
  );
  assert.match(
    codedTransport.files['index.html'].text,
    /style="background-image:url\('\.\/hero\.png'\)"/,
    'inline CSS asset URLs must be normalized with HTML uploads',
  );
  assert.match(
    codedTransport.files['index.html'].text,
    /href="\.\/src\/style\.css"[^>]*data-kodety-coded-style="src\/style\.css"/,
    'publish build must extract module CSS into a real stylesheet link',
  );
  assert.match(
    codedTransport.files['index.html'].text,
    /src="\.\/kodety-build\/src\/main\.js"/,
    'publish build must point the HTML entry at a generated module through a document-relative URL',
  );
  const nestedCodedSourceProject = {
    ...codedSourceProject,
    mainHtmlPath: 'Arquivos/index.html',
    rootPath: 'Arquivos',
    files: Object.fromEntries(Object.entries(codedSourceProject.files).map(([path, file]) => [`Arquivos/${path}`, { ...file, path: `Arquivos/${path}` }])),
  };
  const nestedCodedTransport = codedProject.prepareCodedProjectForTransport(nestedCodedSourceProject);
  assert.match(
    nestedCodedTransport.files['Arquivos/index.html'].text,
    /src="\.\.\/kodety-build\/Arquivos\/src\/main\.js"/,
    'nested imported roots must reach the generated module relatively — hosts resolve "/..." against the authored root, not the archive root',
  );
  // A variant is authored two segments deeper than it is published. Counting
  // `../` from the authored path walked past the theme and 404'd the module,
  // which silently killed every animation on the variant page.
  const variantPrefix = '.incode/experiments/experiment-a/variant-b/project/';
  const variantCodedProject = {
    ...nestedCodedSourceProject,
    files: {
      ...nestedCodedSourceProject.files,
      ...Object.fromEntries(
        Object.entries(nestedCodedSourceProject.files).map(([path, file]) => [`${variantPrefix}${path}`, { ...file, path: `${variantPrefix}${path}` }]),
      ),
    },
  };
  const variantCodedTransport = codedProject.prepareCodedProjectForTransport(variantCodedProject);
  assert.match(
    variantCodedTransport.files[`${variantPrefix}Arquivos/index.html`].text,
    /src="(?:\.\.\/){4}kodety-build\/Arquivos\/src\/main\.js"/,
    'a variant must reach kodety-build from where it is published (.kodety-experiments/<test>/<variant>/), not from its deeper authored path',
  );
  assert.match(
    variantCodedTransport.files['Arquivos/index.html'].text,
    /src="\.\.\/kodety-build\/Arquivos\/src\/main\.js"/,
    'cloning a variant must not disturb the Control document specifier',
  );
  const customPublicSourceProject = {
    name: 'Vite custom publicDir',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><img src="/assets/logo.png"><script type="module" src="/main.js"></script></body></html>',
      },
      'vite.config.js': {
        path: 'vite.config.js',
        mimeType: 'text/javascript',
        text: 'import { defineConfig } from "vite";\n\nexport default defineConfig({\n  base: "./",\n  publicDir: "sequencia de imagem",\n});\n',
      },
      'main.js': {
        path: 'main.js',
        mimeType: 'text/javascript',
        text: 'const frame = `${import.meta.env.BASE_URL}img/frame-001.jpg`;\nconst mode = import.meta.env.MODE;\nvoid frame; void mode;',
      },
      'sequencia de imagem/assets/logo.png': {
        path: 'sequencia de imagem/assets/logo.png',
        mimeType: 'image/png',
        data: new Uint8Array([137, 80, 78, 71]),
      },
      'sequencia de imagem/img/frame-001.jpg': {
        path: 'sequencia de imagem/img/frame-001.jpg',
        mimeType: 'image/jpeg',
        data: new Uint8Array([255, 216, 255]),
      },
    },
  };
  assert.deepEqual(
    codedProject.projectPublicDirectoryNames(customPublicSourceProject),
    ['public', 'sequencia de imagem'],
    'a literal publicDir in vite.config must extend the conventional public directory',
  );
  const customPublicTransport = codedProject.prepareCodedProjectForTransport(customPublicSourceProject);
  assert.ok(customPublicTransport.files['assets/logo.png'], 'custom publicDir assets must be hoisted to the published web root');
  assert.ok(customPublicTransport.files['img/frame-001.jpg'], 'runtime-addressed publicDir files must exist at their authored web-root path after publish');
  assert.match(
    customPublicTransport.files['index.html'].text,
    /src="\.\/assets\/logo\.png"/,
    'authored web-root references must resolve through the configured publicDir',
  );
  assert.doesNotMatch(
    customPublicTransport.files['kodety-build/main.js'].text,
    /import\.meta\.env/,
    'published modules must not retain Vite-only import.meta.env accesses',
  );
  assert.match(
    customPublicTransport.files['kodety-build/main.js'].text,
    /\$\{"\.\/"\}img\/frame-001\.jpg/,
    'import.meta.env.BASE_URL must compile to a document-relative base',
  );
  assert.deepEqual(
    previewRuntime.runtimeAssetPathAliases(customPublicSourceProject, ['sequencia de imagem/img/frame-001.jpg', 'sequencia de imagem/assets/logo.png']),
    {
      'img/frame-001.jpg': 'sequencia de imagem/img/frame-001.jpg',
      'assets/logo.png': 'sequencia de imagem/assets/logo.png',
    },
    'the preview bridge must alias custom publicDir files at their authored web-root paths',
  );
  assert.doesNotMatch(
    codedProject.replaceViteImportMetaEnv(customPublicSourceProject.files['main.js'].text),
    /import\.meta\.env/,
    'source modules in Preview must receive the same Vite production env replacement as published modules',
  );
  assert.deepEqual(
    previewRuntime.runtimeAssetAvailablePaths(customPublicSourceProject).sort(),
    ['index.html', 'main.js', 'sequencia de imagem/assets/logo.png', 'sequencia de imagem/img/frame-001.jpg'],
    'Preview must advertise runtime-loadable assets without exposing package and bundler configuration files',
  );
  assert.doesNotMatch(
    codedTransport.files['kodety-build/src/main.js'].text,
    /import\s+["']\.\/style\.css/,
    'generated browser modules must not retain unsupported CSS imports',
  );
  assert.match(
    codedTransport.files['kodety-build/src/main.js'].text,
    /https:\/\/esm\.sh\/gsap@3\.15\.0\?bundle/,
    'generated browser modules must resolve versioned npm dependencies through the CDN bridge',
  );
  assert.match(
    codedTransport.files['kodety-build/src/main.js'].text,
    /new URL\("\.\.\/\.\.\/poster\.jpg\?size=2#frame", import\.meta\.url\)/,
    'new URL assets in modules must target the generated public alias and preserve query/fragment suffixes',
  );
  assert.match(
    codedTransport.files['kodety-build/src/main.js'].text,
    /const logoUrl = new URL\("\.\.\/\.\.\/logo\.svg\?url", import\.meta\.url\)\.href;/,
    'Vite-style static asset imports must compile to a browser-native URL',
  );
  assert.match(
    codedTransport.files['kodety-build/src/main.js'].text,
    /const assignedImage = new URL\("\.\.\/\.\.\/showreel-poster\.jpg\?cache=1#cover", import\.meta\.url\)\.href;/,
    'ordinary JavaScript image literals must work in assignments, setAttribute/fetch arguments and object values',
  );
  assert.match(
    codedTransport.files['kodety-build/src/main.js'].text,
    /<img src="\$\{new URL\("\.\.\/\.\.\/showreel-poster\.jpg", import\.meta\.url\)\.href\}">/,
    'assets created later from JavaScript template markup must receive stable module-relative URLs',
  );
  assert.match(
    codedTransport.files['src/style.css'].text,
    /url\("\.\.\/hero\.png"\)/,
    'root-relative CSS backgrounds must become stylesheet-relative publish URLs',
  );
  assert.match(
    codedTransport.files['src/style.css'].text,
    /url\("\.\.\/fonts\/Rubrika Display\.otf"\)/,
    '@font-face files with spaces must remain connected to their uploaded font asset',
  );
  assert.match(codedTransport.files['public/logo.svg'].text, /href="\.\.\/hero\.png"/, 'nested SVG image references must be normalized too');
  assert.deepEqual(
    JSON.parse(codedTransport.files['manifest.webmanifest'].text),
    { icons: [{ src: './hero.png', sizes: '512x512' }] },
    'web app manifest icon paths must share the project asset resolver',
  );
  const lexicalModuleProject = {
    name: 'Lexically scanned module graph',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head></head><body><script type="module" src="/src/vendor.js"></script></body></html>',
      },
      'package.json': {
        path: 'package.json',
        mimeType: 'application/json',
        text: JSON.stringify({ dependencies: { motion: '12.23.24' } }),
      },
      'src/vendor.js': {
        path: 'src/vendor.js',
        mimeType: 'text/javascript',
        text: [
          'import { animate } from "motion";',
          'export { spring } from "motion/react";',
          'import "./real.css";',
          'export { value as localValue } from "/src/reexport.js";',
          'const lazy = import("/src/lazy.js");',
          'const lazyTemplate = import(`/src/lazy-template.js`);',
          'const computed = import(`/src/${chunkName}.js`);',
          'const interpolatedImport = `loaded: ${await import("motion/dom")}`;',
          'const metaUrl = import.meta.url;',
          'const gradient = angle => { let output = `conic-gradient(from `; return output += `${angle}deg)`; };',
          'const motionKeys = new Set([`repeatDelay`,`from`,`elapsed`]);',
          'const stringText = \'import("fake-package") export { x } from "fake-export"\';',
          'const regexText = /import\\("fake-regex"\\)|from\\s+"fake-from"/;',
          '// import "fake-comment";',
          '/* export { fake } from "fake-block-comment"; */',
          'const fakeCss = `',
          'import "./ghost.css";',
          '`;',
          'void animate; void lazy; void lazyTemplate; void computed; void interpolatedImport; void metaUrl;',
        ].join('\n'),
      },
      'src/reexport.js': {
        path: 'src/reexport.js',
        mimeType: 'text/javascript',
        text: 'export const value = 1;',
      },
      'src/lazy.js': {
        path: 'src/lazy.js',
        mimeType: 'text/javascript',
        text: 'export default 1;',
      },
      'src/lazy-template.js': {
        path: 'src/lazy-template.js',
        mimeType: 'text/javascript',
        text: 'export default 2;',
      },
      'src/real.css': {
        path: 'src/real.css',
        mimeType: 'text/css',
        text: '.real { color: green; }',
      },
      'src/ghost.css': {
        path: 'src/ghost.css',
        mimeType: 'text/css',
        text: '.ghost { color: red; }',
      },
    },
  };
  const lexicalModuleTransport = codedProject.prepareCodedProjectForTransport(lexicalModuleProject);
  const lexicalModuleBuild = lexicalModuleTransport.files['kodety-build/src/vendor.js'].text;
  assert.match(
    lexicalModuleTransport.files['index.html'].text,
    /href="\.\/src\/real\.css"/,
    'a real static CSS import must remain reachable through the lexical module graph',
  );
  assert.doesNotMatch(
    lexicalModuleTransport.files['index.html'].text,
    /ghost\.css/,
    'import-like text inside a template must not create a stylesheet dependency',
  );
  assert.match(
    lexicalModuleBuild,
    /from "https:\/\/esm\.sh\/motion@12\.23\.24\?bundle"/,
    'a real static import must still resolve through the versioned CDN bridge',
  );
  assert.match(
    lexicalModuleBuild,
    /from "https:\/\/esm\.sh\/motion@12\.23\.24\/react\?bundle"/,
    'a real export-from declaration must still resolve its package subpath',
  );
  assert.match(
    lexicalModuleBuild,
    /export \{ value as localValue \} from "\.\/reexport\.js"/,
    'a real local export-from declaration must target the generated module graph',
  );
  assert.match(lexicalModuleBuild, /import\("\.\/lazy\.js"\)/, 'a quoted literal dynamic import must target the generated module graph');
  assert.match(lexicalModuleBuild, /import\(`\.\/lazy-template\.js`\)/, 'a no-substitution template dynamic import must target the generated module graph');
  assert.match(
    lexicalModuleBuild,
    /import\(`\/src\/\$\{chunkName\}\.js`\)/,
    'a computed dynamic import must remain authored because it is not a literal specifier',
  );
  assert.match(
    lexicalModuleBuild,
    /`loaded: \$\{await import\("https:\/\/esm\.sh\/motion@12\.23\.24\/dom\?bundle"\)\}`/,
    'a real literal dynamic import inside an interpolated expression must be rewritten without touching raw template text',
  );
  assert.match(
    lexicalModuleBuild,
    /let output = `conic-gradient\(from `; return output \+= `\$\{angle\}deg\)`/,
    'Framer conic-gradient templates must not be mistaken for export-from syntax',
  );
  assert.match(
    lexicalModuleBuild,
    /new Set\(\[`repeatDelay`,`from`,`elapsed`\]\)/,
    'neighboring template literals containing the word from must remain byte-stable',
  );
  assert.match(
    lexicalModuleBuild,
    /'import\("fake-package"\) export \{ x \} from "fake-export"'/,
    'module-like text inside an ordinary string must not be rewritten',
  );
  assert.match(
    lexicalModuleBuild,
    /\/import\\\("fake-regex"\\\)\|from\\s\+"fake-from"\//,
    'module-like text inside a regular expression must not be rewritten',
  );
  assert.match(
    lexicalModuleBuild,
    /\/\/ import "fake-comment";[\s\S]*?\/\* export \{ fake \} from "fake-block-comment"; \*\//,
    'module-like text inside comments must not be rewritten',
  );
  assert.match(lexicalModuleBuild, /const metaUrl = import\.meta\.url/, 'import.meta must not be interpreted as a dynamic or static module specifier');
  assert.doesNotMatch(lexicalModuleBuild, /esm\.sh\/(?:,|;return|fake-)/, 'only real module specifiers may reach the CDN bridge');
  const lexicalBuildManifest = JSON.parse(lexicalModuleTransport.files['.incode/coded-build.json'].text);
  assert.equal(lexicalBuildManifest.version, 2);
  assert.deepEqual(lexicalBuildManifest.entrypoints, ['kodety-build/src/vendor.js'], 'the attested graph must identify only authored HTML module entrypoints');
  assert.deepEqual(
    Object.keys(lexicalBuildManifest.modules),
    ['kodety-build/src/lazy-template.js', 'kodety-build/src/lazy.js', 'kodety-build/src/reexport.js', 'kodety-build/src/vendor.js'],
    'every generated module must be attested, including possible computed dynamic-import targets',
  );
  assert.deepEqual(
    lexicalBuildManifest.modules['kodety-build/src/vendor.js'].dependencies,
    ['kodety-build/src/lazy-template.js', 'kodety-build/src/lazy.js', 'kodety-build/src/reexport.js'],
    'imports, reexports and literal dynamic imports must all join the attested local graph',
  );
  Object.entries(lexicalBuildManifest.modules).forEach(([modulePath, record]) => {
    const generatedCode = lexicalModuleTransport.files[modulePath].text;
    assert.equal(record.bytes, Buffer.byteLength(generatedCode, 'utf8'));
    assert.equal(
      record.sha256,
      createHash('sha256').update(generatedCode, 'utf8').digest('hex'),
      `the manifest must attest exact generated bytes for ${modulePath}`,
    );
  });

  const regexSafeProject = {
    ...lexicalModuleProject,
    files: {
      ...lexicalModuleProject.files,
      'src/vendor.js': {
        ...lexicalModuleProject.files['src/vendor.js'],
        text: 'const x=true;if(x) /[)]/.test(")");while(false) /[}]/.test("}");export {x};',
      },
    },
  };
  assert.doesNotThrow(
    () => codedProject.prepareCodedProjectForTransport(regexSafeProject),
    'a real JavaScript parser must accept regex literals after control-flow statements',
  );
  const malformedGeneratedProject = {
    ...lexicalModuleProject,
    files: {
      ...lexicalModuleProject.files,
      'src/vendor.js': {
        ...lexicalModuleProject.files['src/vendor.js'],
        text: 'export const broken = ;',
      },
    },
  };
  assert.throws(
    () => codedProject.prepareCodedProjectForTransport(malformedGeneratedProject),
    /JavaScript gerado está malformado/,
    'malformed post-transform JavaScript must fail before a publish transport exists',
  );
  const missingModuleProject = {
    ...lexicalModuleProject,
    files: {
      ...lexicalModuleProject.files,
      'src/vendor.js': {
        ...lexicalModuleProject.files['src/vendor.js'],
        text: 'import "./missing.js"; export const safe = true;',
      },
    },
  };
  assert.throws(
    () => codedProject.prepareCodedProjectForTransport(missingModuleProject),
    /grafo JavaScript está incompleto/,
    'a missing literal import must fail before the theme activation boundary',
  );
  const hydratedCodedSource = codedProject.hydrateCodedProject(codedTransport);
  assert.equal(
    hydratedCodedSource.files['index.html'].text,
    codedSourceProject.files['index.html'].text,
    'reopening a published workspace must restore the original authored HTML',
  );
  assert.equal(hydratedCodedSource.files['kodety-build/src/main.js'], undefined, 'generated build artifacts must stay outside the reopened editor file tree');
  assert.equal(
    hydratedCodedSource.files['src/style.css'].text,
    codedSourceProject.files['src/style.css'].text,
    'reopening after publish must restore authored CSS while discarding transport-only URL repairs',
  );
  assert.equal(
    hydratedCodedSource.files['manifest.webmanifest'].text,
    codedSourceProject.files['manifest.webmanifest'].text,
    'manifest path repair must never mutate the editable source',
  );
  const codedDraftZip = await JSZip.loadAsync(await (await projectIo.projectToZipBlob(codedSourceProject, { fast: true })).arrayBuffer());
  assert.equal(codedDraftZip.file('kodety-build/src/main.js'), null, 'draft autosave must contain sources, not a release build');
  assert.equal(
    await codedDraftZip.file('src/main.js').async('string'),
    codedSourceProject.files['src/main.js'].text,
    'draft autosave must preserve authored module bytes',
  );
  assert.equal(
    await codedDraftZip.file('src/style.css').async('string'),
    codedSourceProject.files['src/style.css'].text,
    'draft/autosave transports must keep original CSS URLs rather than publish rewrites',
  );
  const deterministicDraftUpdatedAt = '2026-08-20T12:00:00.000Z';
  const identifiedDraftSource = projectIo.ensureProjectIdentity(codedSourceProject);
  const preparedDraft = projectIo.prepareProjectForDraftTransport(identifiedDraftSource, deterministicDraftUpdatedAt);
  const equivalentDraftZip = await JSZip.loadAsync(
    await (
      await projectIo.projectToZipBlob(identifiedDraftSource, {
        fast: true,
        updatedAt: deterministicDraftUpdatedAt,
      })
    ).arrayBuffer(),
  );
  assert.equal(
    await equivalentDraftZip.file('.incode/project.json').async('string'),
    preparedDraft.files['.incode/project.json'].text,
    'delta and ZIP autosave must persist byte-identical generated project metadata',
  );
  assert.equal(
    await equivalentDraftZip.file('src/style.css').async('string'),
    preparedDraft.files['src/style.css'].text,
    'delta and ZIP autosave must preserve identical authored CSS bytes',
  );

  const wrappedArchive = new JSZip();
  wrappedArchive.file('Rubrika/index.html', '<!doctype html><img src="./brand%20hero.png"><img src="/gallery/detail.png">');
  wrappedArchive.file('Rubrika/public/brand hero.png', new Uint8Array([1, 2, 3]));
  wrappedArchive.file('Rubrika/assets/gallery/detail.png', new Uint8Array([4, 5, 6]));
  const wrappedProject = await projectIo.importZip(
    new File([await wrappedArchive.generateAsync({ type: 'uint8array' })], 'rubrika.zip', { type: 'application/zip' }),
  );
  assert.equal(wrappedProject.rootPath, 'Rubrika', 'ZIP imports must retain a deterministic project web root');
  assert.equal(
    codedProject.projectPublicFilePath(wrappedProject, 'Rubrika/brand hero.png'),
    'Rubrika/public/brand hero.png',
    'ZIP wrapper and Vite public paths must resolve without moving authored files',
  );
  assert.equal(
    codedProject.projectPublicFilePath(wrappedProject, 'Rubrika/gallery/detail.png'),
    'Rubrika/assets/gallery/detail.png',
    'a unique suffix must recover assets relocated by an archive or uploader',
  );

  const folderHtml = new File(['<!doctype html><img src="./images/photo.png">'], 'index.html', { type: 'text/html' });
  Object.defineProperty(folderHtml, 'webkitRelativePath', {
    value: 'Portfolio/index.html',
  });
  const folderImage = new File([new Uint8Array([7, 8, 9])], 'photo.png', {
    type: 'image/png',
  });
  Object.defineProperty(folderImage, 'webkitRelativePath', {
    value: 'Portfolio/images/photo.png',
  });
  const folderProject = await projectIo.importFolder([folderHtml, folderImage]);
  assert.equal(folderProject.mainHtmlPath, 'index.html');
  assert.equal(
    codedProject.projectPublicFilePath(folderProject, 'images/photo.png'),
    'images/photo.png',
    'folder uploads must resolve the same asset path after their picker root is stripped',
  );

  const ambiguousAssets = {
    ...codedSourceProject,
    files: {
      'one/logo.png': {
        path: 'one/logo.png',
        mimeType: 'image/png',
        data: new Uint8Array([1]),
      },
      'two/logo.png': {
        path: 'two/logo.png',
        mimeType: 'image/png',
        data: new Uint8Array([2]),
      },
    },
  };
  assert.equal(
    codedProject.projectPublicFilePath(ambiguousAssets, 'logo.png'),
    null,
    'basename recovery must never guess when two uploaded assets are ambiguous',
  );

  const wildcardInteractionDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section class="group"><span>Child</span></section></body></html>',
    {
      version: 2,
      interactions: [
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'wildcard-group',
          name: 'Group * children',
          triggerSelector: '.group',
          actions: [
            {
              ...interactions.createInteractionAction('animate'),
              id: 'wildcard-action',
              target: {
                selector: '*',
                label: 'Every * descendant',
                scope: 'descendants',
                mode: 'selector',
              },
            },
          ],
        },
      ],
    },
  );
  const reopenedWildcardDocument = interactions.readInteractionDocument(wildcardInteractionDocument);
  assert.equal(
    reopenedWildcardDocument.interactions[0]?.name,
    'Group * children',
    'an asterisk in interaction data must survive the embedded runtime round-trip',
  );
  assert.equal(
    reopenedWildcardDocument.interactions[0]?.actions[0]?.target.selector,
    '*',
    'a wildcard group selector must not truncate and erase the interaction payload',
  );

  const legacyMotionPayload = encodeURIComponent(
    JSON.stringify({
      name: 'Legacy * group',
      trigger: 'click',
      triggerSelector: '.legacy-group',
      clips: [
        {
          name: 'Legacy child',
          selector: '.legacy-child',
          keyframes: [
            { time: 0, values: { opacity: 0 } },
            { time: 0.5, values: { opacity: 1 } },
          ],
        },
      ],
    }),
  );
  const legacyGsapPayload = encodeURIComponent(
    JSON.stringify({
      trigger: 'load',
      opacity: 0,
      duration: 0.5,
    }),
  );
  const legacyIdSource = `<!doctype html><html><body>
<section class="legacy-group"><span class="legacy-child">Child</span></section>
<div data-incode-animation-id="legacy-gsap">Legacy GSAP</div>
<script data-incode-motion-timeline="legacy-motion">/* incode-motion-timeline:${legacyMotionPayload} */</script>
<script data-incode-gsap="legacy-gsap">/* incode-gsap-config:${legacyGsapPayload} */</script>
</body></html>`;
  const firstLegacyRead = interactions.readInteractionDocument(legacyIdSource);
  const secondLegacyRead = interactions.readInteractionDocument(legacyIdSource);
  assert.deepEqual(
    secondLegacyRead.interactions.map(interaction => ({
      id: interaction.id,
      actions: interaction.actions.map(action => ({
        id: action.id,
        keyframes: action.keyframes.map(keyframe => keyframe.id),
      })),
    })),
    firstLegacyRead.interactions.map(interaction => ({
      id: interaction.id,
      actions: interaction.actions.map(action => ({
        id: action.id,
        keyframes: action.keyframes.map(keyframe => keyframe.id),
      })),
    })),
    'legacy group/action/keyframe ids must remain stable across repeated reads',
  );
  assert.equal(firstLegacyRead.interactions[0]?.name, 'Legacy * group', 'legacy encoded payloads must accept literal asterisks without truncation');

  const inlineInteractionDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><button id="target">Open</button></body></html>',
    {
      version: 2,
      interactions: [
        {
          id: 'self-contained-click',
          name: 'Self-contained click',
          trigger: 'click',
          triggerSelector: '#target',
          triggerLabel: '#target',
          triggerTargetMode: 'selector',
          enabled: true,
          actions: [interactions.actionFromPreset('fade-in')],
        },
      ],
    },
  );
  assert.match(
    inlineInteractionDocument,
    /data-kodety-interactions-engine="motion"[\s\S]*?Motion/,
    'interaction output must embed the Motion runtime instead of depending on iframe network access',
  );
  assert.doesNotMatch(
    inlineInteractionDocument,
    /cdn\.jsdelivr\.net\/npm\/gsap|<script[^>]+src=["'][^"']*gsap/i,
    'interaction output must not require a remote GSAP script',
  );
  const inlineMotionDependency = inlineInteractionDocument.match(/<script[^>]*data-kodety-interactions-engine="motion"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(inlineMotionDependency, 'interaction output must contain a complete Motion dependency');
  assert.doesNotThrow(() => new Function(inlineMotionDependency[1]), 'the materialized Motion dependency must remain valid standalone JavaScript');
  const inlineInteractionRuntime = inlineInteractionDocument.match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/);
  assert.ok(inlineInteractionRuntime, 'interaction output must contain its controller runtime');
  assert.doesNotThrow(
    () => new Function(inlineInteractionRuntime[1]),
    'the interaction runtime, including grouped preview coordination, must remain valid standalone JavaScript',
  );
  const legacyInteractionProject = {
    name: 'Legacy interactions',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: inlineInteractionDocument,
      },
      [interactions.interactionDocumentPath('index.html')]: {
        path: interactions.interactionDocumentPath('index.html'),
        mimeType: 'application/json',
        text: JSON.stringify({ version: 2, interactions: [] }),
      },
    },
  };
  assert.equal(
    interactions.readInteractionDocumentFile(legacyInteractionProject).interactions[0]?.id,
    'self-contained-click',
    'an absent or empty dedicated animation file must recover the legacy runtime payload',
  );
  const legacyBlurDocument = interactions.patchInteractionDocument('<!doctype html><html><head></head><body><div id="legacy-blur"></div></body></html>', {
    version: 2,
    interactions: [
      {
        ...interactions.DEFAULT_INTERACTION,
        id: 'legacy-blur-interaction',
        trigger: 'load',
        triggerSelector: '#legacy-blur',
        actions: [
          {
            ...interactions.actionFromPreset('fade-in'),
            id: 'legacy-blur-action',
            from: { opacity: 0, blur: '0' },
            to: { opacity: 1, blur: '10px' },
          },
        ],
      },
    ],
  });
  const normalizedLegacyBlur = interactions.readInteractionDocument(legacyBlurDocument).interactions[0]?.actions[0];
  assert.deepEqual(normalizedLegacyBlur?.from, { opacity: 0, filter: 'blur(0px)' }, 'legacy blur values must migrate to the canonical CSS filter property');
  assert.deepEqual(normalizedLegacyBlur?.to, { opacity: 1, filter: 'blur(10px)' }, 'legacy blur units must survive normalization');
  const prunedCanonicalSource = interactions.pruneInteractionTargets(
    '<!doctype html><html><head></head><body><div data-kodety-interaction-id="kept"></div></body></html>',
    ['removed'],
    {
      version: 2,
      interactions: [
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'removed-interaction',
          triggerSelector: '[data-kodety-interaction-id="removed"]',
          actions: [interactions.actionFromPreset('fade-in')],
        },
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'kept-interaction',
          triggerSelector: '[data-kodety-interaction-id="kept"]',
          actions: [interactions.actionFromPreset('fade-in')],
        },
      ],
    },
  );
  assert.deepEqual(
    interactions.readInteractionDocument(prunedCanonicalSource).interactions.map(interaction => interaction.id),
    ['kept-interaction'],
    'removing a layer must prune its interaction from the dedicated animation document',
  );
  const inlineLoadDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section id="load-target">Loaded</section></body></html>',
    {
      version: 2,
      interactions: [
        {
          id: 'self-contained-load',
          name: 'Self-contained load',
          trigger: 'load',
          triggerSelector: '#load-target',
          triggerLabel: '#load-target',
          triggerTargetMode: 'selector',
          enabled: true,
          actions: [interactions.actionFromPreset('fade-in')],
        },
      ],
    },
  );
  const inlineLoadRuntime = inlineLoadDocument.match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  let loadTimelinePlayCount = 0;
  const loadTarget = {
    children: [],
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    matches: () => true,
    addEventListener() {},
    removeEventListener() {},
  };
  const loadTimeline = {
    set() {
      return this;
    },
    to() {
      return this;
    },
    fromTo() {
      return this;
    },
    call() {
      return this;
    },
    play() {
      loadTimelinePlayCount += 1;
      return this;
    },
    restart() {
      return this;
    },
    reverse() {
      return this;
    },
    pause() {
      return this;
    },
    progress() {
      return this;
    },
    totalTime() {
      return 0;
    },
    totalDuration() {
      return 0.5;
    },
    duration() {
      return 0.5;
    },
    reversed() {
      return false;
    },
    kill() {},
  };
  const loadDocumentStub = {
    readyState: 'complete',
    body: loadTarget,
    querySelectorAll: selector => (selector === '#load-target' ? [loadTarget] : []),
    createElement: () => loadTarget,
    addEventListener() {},
  };
  const loadWindowStub = {
    __ONUN_MOTION_ENGINE__: {
      timeline: () => loadTimeline,
      set() {},
      to() {},
    },
    requestAnimationFrame: callback => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  assert.doesNotThrow(
    () =>
      new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', inlineLoadRuntime)(
        loadWindowStub,
        loadDocumentStub,
        () => ({ matches: false }),
        1280,
        class CustomEvent {},
      ),
    'the generated interaction runtime must initialize with its embedded Preview dependencies',
  );
  assert.equal(loadTimelinePlayCount, 1, 'a Page load interaction must start its timeline in the real Preview runtime');
  const orphanLoadDocument = interactions.patchInteractionDocument('<!doctype html><html><head></head><body><main>Safe content</main></body></html>', {
    version: 2,
    interactions: [
      {
        ...interactions.DEFAULT_INTERACTION,
        id: 'orphan-load',
        trigger: 'load',
        triggerSelector: '#missing-load-target',
        actions: [interactions.actionFromPreset('fade-in')],
      },
    ],
  });
  const orphanLoadRuntime = orphanLoadDocument.match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  let orphanTimelineCount = 0;
  assert.doesNotThrow(
    () =>
      new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', orphanLoadRuntime)(
        {
          __ONUN_MOTION_ENGINE__: {
            timeline: () => {
              orphanTimelineCount += 1;
              return loadTimeline;
            },
            set() {},
            to() {},
          },
          requestAnimationFrame: callback => {
            callback(0);
            return 1;
          },
          cancelAnimationFrame() {},
          setTimeout,
          clearTimeout,
        },
        {
          ...loadDocumentStub,
          querySelectorAll: () => [],
        },
        () => ({ matches: false }),
        1280,
        class CustomEvent {},
      ),
    'an orphaned Page load selector must remain inert',
  );
  assert.equal(orphanTimelineCount, 0, 'an explicit missing trigger must never fall back to animating document.body');

  const frozenGroupDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section id="frozen-group" style="color: red"><span>Child</span></section></body></html>',
    {
      version: 2,
      interactions: [
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'frozen-group-interaction',
          name: 'Frozen group',
          triggerSelector: '#frozen-group',
          actions: [
            {
              ...interactions.actionFromPreset('fade-in'),
              id: 'frozen-group-action',
              textSplit: 'words',
              target: { ...interactions.DEFAULT_ACTION_TARGET },
            },
          ],
        },
      ],
    },
  );
  const frozenGroupRuntime = frozenGroupDocument.match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const frozenGroupAttributes = new Map([['style', 'color: red']]);
  const frozenGroupChildren = [{}];
  const frozenGroupTarget = {
    children: frozenGroupChildren,
    dataset: {},
    textContent: 'Child',
    innerHTML: '<span>Child</span>',
    classList: { add() {}, remove() {}, toggle() {} },
    matches: () => true,
    hasAttribute: name => frozenGroupAttributes.has(name),
    getAttribute: name => frozenGroupAttributes.get(name) ?? null,
    setAttribute: (name, value) => {
      frozenGroupAttributes.set(name, String(value));
    },
    removeAttribute: name => {
      frozenGroupAttributes.delete(name);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  let frozenReducedMotionProgressCalls = 0;
  let frozenReducedMotionPauseAtTimeCalls = 0;
  let frozenTimelineTime = 0;
  const frozenRenderedTimes = [];
  const frozenScheduledFrames = [];
  const frozenTimeline = {
    set() {
      return this;
    },
    to() {
      return this;
    },
    fromTo() {
      return this;
    },
    call() {
      return this;
    },
    play() {
      return this;
    },
    restart() {
      return this;
    },
    reverse() {
      return this;
    },
    pause(time) {
      if (time !== undefined) frozenReducedMotionPauseAtTimeCalls += 1;
      return this;
    },
    progress() {
      frozenReducedMotionProgressCalls += 1;
      return this;
    },
    totalTime(value) {
      if (value === undefined) return frozenTimelineTime;
      frozenTimelineTime = Number(value) || 0;
      frozenRenderedTimes.push(frozenTimelineTime);
      return this;
    },
    totalDuration() {
      return 0.5;
    },
    duration() {
      return 0.5;
    },
    reversed() {
      return false;
    },
    kill() {},
  };
  let frozenSplitNodeCreations = 0;
  const frozenDocumentStub = {
    readyState: 'complete',
    body: frozenGroupTarget,
    querySelectorAll: selector => (selector === '#frozen-group' ? [frozenGroupTarget] : []),
    createElement: () => {
      frozenSplitNodeCreations += 1;
      return frozenGroupTarget;
    },
    addEventListener() {},
  };
  const frozenWindowStub = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_POST_EDITOR_MESSAGE__() {},
    __ONUN_MOTION_ENGINE__: {
      timeline: () => frozenTimeline,
      set(elements) {
        (Array.isArray(elements) ? elements : [elements]).forEach(element => {
          element.setAttribute?.('style', 'opacity: 0');
        });
      },
      to() {},
    },
    performance: { now: () => 0 },
    requestAnimationFrame: callback => {
      frozenScheduledFrames.push(callback);
      return frozenScheduledFrames.length;
    },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', frozenGroupRuntime)(
    frozenWindowStub,
    frozenDocumentStub,
    () => ({ matches: true }),
    1280,
    class CustomEvent {},
  );
  assert.equal(
    frozenGroupAttributes.get('style'),
    'color: red',
    'building grouped timelines in Design must restore the authored inline style before preview starts',
  );
  assert.equal(frozenSplitNodeCreations, 0, 'text splitting a group target must never replace its authored child tree with generated spans');
  assert.equal(frozenGroupTarget.children, frozenGroupChildren, 'group children must retain their original identity after interaction setup');
  assert.equal(
    frozenReducedMotionProgressCalls + frozenReducedMotionPauseAtTimeCalls,
    0,
    'the host reduced-motion preference must not force a frame onto the frozen Design canvas during setup',
  );
  frozenGroupAttributes.set('style', 'color: blue');
  frozenWindowStub.__kodetyInteractions.get('frozen-group-interaction').seek(0);
  assert.equal(frozenGroupAttributes.get('style'), 'opacity: 0', 'an explicit Design preview must still seed the interaction start frame');
  frozenWindowStub.__kodetyInteractions.get('frozen-group-interaction').play();
  const frozenPlaybackFrame = frozenScheduledFrames.shift();
  assert.equal(typeof frozenPlaybackFrame, 'function');
  frozenPlaybackFrame(250);
  assert.ok(
    frozenRenderedTimes.some(time => Math.abs(time - 0.25) < 0.001),
    'Design Timeline play must continuously render the same exact totalTime frames as scrubbing',
  );
  frozenWindowStub.__kodetyInteractions.get('frozen-group-interaction').release();
  assert.equal(
    frozenGroupAttributes.get('style'),
    'color: blue',
    'releasing Design preview must restore the latest live style instead of the stale setup-time style',
  );
  frozenWindowStub.__kodetyInteractions.update({
    version: 2,
    interactions: [],
  });
  assert.equal(frozenGroupAttributes.get('style'), 'color: blue', 'updating or removing a grouped interaction must preserve the latest authored target style');

  const createRuntimeClassList = initial => {
    const tokens = new Set(initial);
    return {
      add: token => tokens.add(token),
      remove: token => tokens.delete(token),
      toggle: token => {
        if (tokens.has(token)) {
          tokens.delete(token);
          return false;
        }
        tokens.add(token);
        return true;
      },
      contains: token => tokens.has(token),
      values: () => Array.from(tokens),
    };
  };
  const createRuntimeTarget = ({ style = null, classes = [], onDispatch = () => undefined } = {}) => {
    const attributes = new Map();
    if (style !== null) attributes.set('style', style);
    return {
      children: [],
      childNodes: [],
      dataset: {},
      classList: createRuntimeClassList(classes),
      matches: () => true,
      hasAttribute: name => attributes.has(name),
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: name => attributes.delete(name),
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: onDispatch,
      attributes,
    };
  };
  const createSeekableRuntimeTimeline = () => {
    let currentTime = 0;
    let updateCallback = null;
    const callbacks = [];
    return {
      set() {
        return this;
      },
      to() {
        return this;
      },
      fromTo() {
        return this;
      },
      call(callback, _params, position) {
        callbacks.push({ callback, position: Number(position) || 0 });
        return this;
      },
      eventCallback(name, callback) {
        if (name === 'onUpdate') updateCallback = callback;
        return this;
      },
      play() {
        return this;
      },
      restart() {
        return this.totalTime(0);
      },
      reverse() {
        return this;
      },
      pause(time) {
        if (time !== undefined) this.totalTime(time);
        return this;
      },
      progress(value) {
        if (value !== undefined) this.totalTime(value);
        return this;
      },
      totalTime(value) {
        if (value === undefined) return currentTime;
        const previousTime = currentTime;
        currentTime = Number(value) || 0;
        const crossed = callbacks
          .filter(({ position }) =>
            currentTime >= previousTime ? position > previousTime && position <= currentTime : position <= previousTime && position >= currentTime,
          )
          .sort((left, right) => (currentTime >= previousTime ? left.position - right.position : right.position - left.position));
        crossed.forEach(({ callback }) => callback());
        updateCallback?.();
        return this;
      },
      time() {
        return currentTime;
      },
      iteration() {
        return 1;
      },
      totalDuration() {
        return 1;
      },
      duration() {
        return 1;
      },
      reversed() {
        return false;
      },
      kill() {},
    };
  };
  let directionalEventCount = 0;
  const directionalTarget = createRuntimeTarget({
    classes: ['enabled'],
    onDispatch: () => {
      directionalEventCount += 1;
      return true;
    },
  });
  const directionalInteraction = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'directional-interaction',
    name: 'Directional interaction',
    triggerSelector: '#directional-target',
    actions: [
      {
        ...interactions.createInteractionAction('class-add'),
        id: 'directional-class-add',
        start: 0.25,
        className: 'active',
      },
      {
        ...interactions.createInteractionAction('class-remove'),
        id: 'directional-class-remove',
        start: 0.25,
        className: 'enabled',
      },
      {
        ...interactions.createInteractionAction('event'),
        id: 'directional-event',
        start: 0.25,
        eventName: 'directional-test',
      },
    ],
  };
  const directionalRuntimeSource =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><div id="directional-target"></div></body></html>', {
        version: 2,
        interactions: [directionalInteraction],
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const directionalWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_POST_EDITOR_MESSAGE__() {},
    __ONUN_MOTION_ENGINE__: {
      timeline: createSeekableRuntimeTimeline,
      set() {},
      to() {},
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', directionalRuntimeSource)(
    directionalWindow,
    {
      readyState: 'complete',
      body: directionalTarget,
      querySelectorAll: selector => (selector === '#directional-target' ? [directionalTarget] : []),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  const directionalController = directionalWindow.__kodetyInteractions.get('directional-interaction');
  directionalController.seek(0.8);
  assert.equal(directionalTarget.classList.contains('active'), true);
  assert.equal(directionalTarget.classList.contains('enabled'), false);
  assert.equal(directionalEventCount, 1);
  directionalController.seek(0);
  assert.equal(directionalTarget.classList.contains('active'), false, 'backward scrubbing must reverse class-add even when the engine reversed() remains false');
  assert.equal(directionalTarget.classList.contains('enabled'), true, 'backward scrubbing must reverse class-remove even when the engine reversed() remains false');
  assert.equal(directionalEventCount, 1, 'backward scrubbing must not redispatch irreversible custom events');
  directionalController.seek(0.8);
  directionalTarget.classList.add('live-external-class');
  directionalController.release();
  assert.equal(directionalTarget.classList.contains('active'), false);
  assert.equal(directionalTarget.classList.contains('enabled'), true);
  assert.equal(
    directionalTarget.classList.contains('live-external-class'),
    true,
    'class cleanup must restore only interaction-owned tokens and preserve unrelated live classes',
  );

  const strictClassTokens = new Set();
  const validateClassToken = token => {
    if (!token || /\s/.test(token)) {
      throw new Error('DOMTokenList requires one non-whitespace token');
    }
  };
  const multiClassTarget = createRuntimeTarget();
  multiClassTarget.classList = {
    add(token) {
      validateClassToken(token);
      strictClassTokens.add(token);
    },
    remove(token) {
      validateClassToken(token);
      strictClassTokens.delete(token);
    },
    toggle(token) {
      validateClassToken(token);
      if (strictClassTokens.has(token)) {
        strictClassTokens.delete(token);
        return false;
      }
      strictClassTokens.add(token);
      return true;
    },
    contains(token) {
      validateClassToken(token);
      return strictClassTokens.has(token);
    },
  };
  let multiClassBeginCount = 0;
  let multiClassEndCount = 0;
  const multiClassRuntime =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><button id="multi-class-target"></button></body></html>', {
        version: 2,
        interactions: [
          {
            ...interactions.DEFAULT_INTERACTION,
            id: 'multi-class-interaction',
            triggerSelector: '#multi-class-target',
            actions: [
              {
                ...interactions.createInteractionAction('class-add'),
                id: 'multi-class-action',
                start: 0.25,
                className: 'active ready',
              },
            ],
          },
        ],
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const multiClassWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {
      multiClassBeginCount += 1;
    },
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {
      multiClassEndCount += 1;
    },
    __KODETY_POST_EDITOR_MESSAGE__() {},
    __ONUN_MOTION_ENGINE__: {
      timeline: createSeekableRuntimeTimeline,
      set() {},
      to() {},
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', multiClassRuntime)(
    multiClassWindow,
    {
      readyState: 'complete',
      body: multiClassTarget,
      querySelectorAll: selector => (selector === '#multi-class-target' ? [multiClassTarget] : []),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  assert.doesNotThrow(
    () => multiClassWindow.__kodetyInteractions.get('multi-class-interaction').seek(0.8),
    'a whitespace-separated class value must be handled as independent DOM tokens',
  );
  assert.deepEqual(Array.from(strictClassTokens).sort(), ['active', 'ready']);
  multiClassWindow.__kodetyInteractions.get('multi-class-interaction').release();
  assert.deepEqual(Array.from(strictClassTokens), []);
  assert.equal(multiClassBeginCount, multiClassEndCount, 'multi-token classes must not leave a frozen preview session unbalanced');

  const overlappingTarget = createRuntimeTarget({ style: 'color: purple' });
  const overlappingAction = (id, opacity) => ({
    ...interactions.createInteractionAction('animate'),
    id,
    from: { opacity },
    to: { opacity: 1 },
  });
  const overlappingInteractions = [
    {
      ...interactions.DEFAULT_INTERACTION,
      id: 'overlap-a',
      name: 'Overlap A',
      triggerSelector: '#overlap-target',
      actions: [overlappingAction('overlap-action-a', 0.2)],
    },
    {
      ...interactions.DEFAULT_INTERACTION,
      id: 'overlap-b',
      name: 'Overlap B',
      triggerSelector: '#overlap-target',
      actions: [overlappingAction('overlap-action-b', 0.8)],
    },
  ];
  const overlappingRuntimeSource =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><div id="overlap-target"></div></body></html>', {
        version: 2,
        interactions: overlappingInteractions,
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const overlappingScheduledFrames = [];
  const overlappingWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_POST_EDITOR_MESSAGE__() {},
    __ONUN_MOTION_ENGINE__: {
      timeline: createSeekableRuntimeTimeline,
      set(elements, values) {
        (Array.isArray(elements) ? elements : [elements]).forEach(element => {
          element.setAttribute('style', `opacity: ${values.opacity}`);
        });
      },
      to() {},
    },
    performance: { now: () => 0 },
    requestAnimationFrame: callback => {
      overlappingScheduledFrames.push(callback);
      return overlappingScheduledFrames.length;
    },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', overlappingRuntimeSource)(
    overlappingWindow,
    {
      readyState: 'complete',
      body: overlappingTarget,
      querySelectorAll: selector => (selector === '#overlap-target' ? [overlappingTarget] : []),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  overlappingWindow.__kodetyInteractions.control(['overlap-a', 'overlap-b'], 'seek', 0.5);
  overlappingWindow.__kodetyInteractions.control(['overlap-a', 'overlap-b'], 'play', 0.5);
  assert.equal(overlappingScheduledFrames.length, 1, 'grouped Timeline play must use one shared private frame clock');
  overlappingScheduledFrames.shift()(250);
  assert.equal(overlappingWindow.__kodetyInteractions.get('overlap-a').__previewTime(), 0.75);
  assert.equal(
    overlappingWindow.__kodetyInteractions.get('overlap-b').__previewTime(),
    0.75,
    'a grouped play frame must render every interaction at the exact same totalTime',
  );
  overlappingWindow.__kodetyInteractions.get('overlap-b').seek(0.5);
  const activeOverlapStyle = overlappingTarget.getAttribute('style');
  assert.equal(overlappingWindow.__KODETY_ACTIVE_INTERACTION_PREVIEW__, 'single:"overlap-b"');
  overlappingWindow.__kodetyInteractions.control(['overlap-a', 'overlap-b'], 'release');
  overlappingWindow.__kodetyInteractions.get('overlap-a').release();
  assert.equal(overlappingTarget.getAttribute('style'), activeOverlapStyle, 'a stale individual or grouped release must not rewrite the active preview target');
  assert.equal(
    overlappingWindow.__KODETY_ACTIVE_INTERACTION_PREVIEW__,
    'single:"overlap-b"',
    'a stale individual or grouped release must not clear the newer preview owner',
  );
  overlappingWindow.__kodetyInteractions.get('overlap-b').release();
  assert.equal(overlappingTarget.getAttribute('style'), 'color: purple');

  const createTextSplitSpan = () => {
    const attributes = new Map();
    return {
      nodeType: 1,
      children: [],
      childNodes: [],
      style: {},
      textContent: '',
      classList: createRuntimeClassList([]),
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      removeAttribute: name => attributes.delete(name),
      getBoundingClientRect: () => ({ top: 0 }),
    };
  };
  const createTextSplitTarget = initialText => {
    const attributes = new Map();
    const nodes = [];
    let rawText = initialText;
    let rawHtml = initialText;
    const dataset = {};
    Object.defineProperty(dataset, 'kodetyInteractionSplit', {
      get: () => attributes.get('data-kodety-interaction-split'),
      set: value => attributes.set('data-kodety-interaction-split', String(value)),
    });
    const target = {
      nodeType: 1,
      dataset,
      style: {},
      classList: createRuntimeClassList([]),
      matches: () => true,
      hasAttribute: name => attributes.has(name),
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: name => attributes.delete(name),
      appendChild: node => {
        nodes.push(node);
        node.parentElement = target;
        return node;
      },
      addEventListener() {},
      removeEventListener() {},
      attributes,
    };
    Object.defineProperties(target, {
      children: {
        get: () => nodes.filter(node => node.nodeType === 1),
      },
      childNodes: {
        get: () => nodes,
      },
      textContent: {
        get: () => (nodes.length ? nodes.map(node => node.textContent || '').join('') : rawText),
        set: value => {
          rawText = String(value);
          rawHtml = String(value);
          nodes.splice(0);
        },
      },
      innerHTML: {
        get: () =>
          nodes.length
            ? nodes
                .map(node =>
                  node.nodeType === 1
                    ? `<span${node.getAttribute?.('style') ? ` style="${node.getAttribute('style')}"` : ''}>${node.textContent || ''}</span>`
                    : node.textContent || '',
                )
                .join('')
            : rawHtml,
        set: value => {
          rawHtml = String(value);
          rawText = rawHtml.replace(/<[^>]*>/g, '');
          nodes.splice(0);
        },
      },
    });
    return target;
  };
  const textSplitTarget = createTextSplitTarget('Old text');
  let textSplitSpanCreations = 0;
  const lazyTextSplitInteraction = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'lazy-text-split',
    name: 'Lazy text split',
    triggerSelector: '#split-target',
    actions: [
      {
        ...interactions.actionFromPreset('fade-in'),
        id: 'lazy-text-split-action',
        textSplit: 'words',
      },
    ],
  };
  const lazyTextSplitRuntime =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><h1 id="split-target">Old text</h1></body></html>', {
        version: 2,
        interactions: [lazyTextSplitInteraction],
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const lazyTextSplitWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_POST_EDITOR_MESSAGE__() {},
    __ONUN_MOTION_ENGINE__: {
      timeline: createSeekableRuntimeTimeline,
      invalidateElement(element) { element.motionCacheInvalidated = true; },
      set(elements) {
        (Array.isArray(elements) ? elements : [elements]).forEach(element => {
          element.setAttribute?.('style', 'opacity: 0');
        });
      },
      to() {},
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', lazyTextSplitRuntime)(
    lazyTextSplitWindow,
    {
      readyState: 'complete',
      body: textSplitTarget,
      querySelectorAll: selector => (selector === '#split-target' ? [textSplitTarget] : []),
      createElement: () => {
        textSplitSpanCreations += 1;
        return createTextSplitSpan();
      },
      createTextNode: textValue => ({
        nodeType: 3,
        textContent: String(textValue),
      }),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  assert.equal(textSplitSpanCreations, 0, 'frozen Design setup must leave leaf text structurally authored before preview');
  assert.equal(textSplitTarget.innerHTML, 'Old text');
  lazyTextSplitWindow.__kodetyInteractions.get('lazy-text-split').seek(0.25);
  assert.ok(textSplitSpanCreations > 0, 'an explicit text animation preview must still build its temporary split targets');
  textSplitTarget.textContent = 'New text';
  lazyTextSplitWindow.__kodetyInteractions.get('lazy-text-split').release();
  assert.equal(textSplitTarget.innerHTML, 'New text', 'releasing a text preview must not restore stale HTML over a newer live text edit');
  assert.equal(textSplitTarget.hasAttribute('data-kodety-interaction-split'), false, 'releasing a text preview must remove its temporary split marker');
  lazyTextSplitWindow.__kodetyInteractions.get('lazy-text-split').seek(0.25);
  lazyTextSplitWindow.__kodetyInteractions.get('lazy-text-split').release();
  assert.equal(textSplitTarget.innerHTML, 'New text', 'subsequent text previews must rebuild from and restore the latest authored text');

  const measuredSplitTarget = createTextSplitTarget('One two');
  let measuredSplitSpanCreations = 0;
  let measuredSplitPreviewBeginCount = 0;
  let measuredSplitPreviewEndCount = 0;
  const measuredSplitDurations = [];
  const measuredSplitTweenTargetCounts = [];
  const createMeasuredRuntimeTimeline = config => {
    let currentTime = 0;
    let cycleDuration = 0;
    const tweenDuration = (elements, vars, position) => {
      const count = Array.isArray(elements) ? elements.length : 1;
      measuredSplitTweenTargetCounts.push(count);
      const duration = Math.max(0, Number(vars?.duration) || 0);
      const repeat = Math.max(0, Number(vars?.repeat) || 0);
      const repeatDelay = Math.max(0, Number(vars?.repeatDelay) || 0);
      const staggerEach = Math.abs(Number(vars?.stagger?.each) || 0);
      const span = duration * (repeat + 1) + repeatDelay * repeat + staggerEach * Math.max(0, count - 1);
      cycleDuration = Math.max(cycleDuration, Math.max(0, Number(position) || 0) + span);
    };
    return {
      set(_elements, _values, position) {
        cycleDuration = Math.max(cycleDuration, Number(position) || 0);
        return this;
      },
      to(elements, vars, position) {
        tweenDuration(elements, vars, position);
        return this;
      },
      fromTo(elements, _from, vars, position) {
        tweenDuration(elements, vars, position);
        return this;
      },
      call() {
        return this;
      },
      eventCallback() {
        return this;
      },
      play() {
        return this;
      },
      restart() {
        return this;
      },
      reverse() {
        return this;
      },
      pause(time) {
        if (time !== undefined) currentTime = Number(time) || 0;
        return this;
      },
      progress() {
        return this;
      },
      totalTime(value) {
        if (value === undefined) return currentTime;
        currentTime = Number(value) || 0;
        return this;
      },
      time() {
        return currentTime;
      },
      iteration() {
        return 1;
      },
      totalDuration() {
        return cycleDuration * (Math.max(0, Number(config?.repeat) || 0) + 1);
      },
      duration() {
        return cycleDuration;
      },
      reversed() {
        return false;
      },
      kill() {},
    };
  };
  const measuredSplitInteraction = {
    ...interactions.DEFAULT_INTERACTION,
    id: 'measured-text-split',
    name: 'Measured text split',
    triggerSelector: '#measured-split-target',
    actions: [
      {
        ...interactions.actionFromPreset('fade-in'),
        id: 'measured-text-split-action',
        duration: 0.5,
        stagger: 0.2,
        textSplit: 'words',
      },
      {
        ...interactions.actionFromPreset('fade-in'),
        id: 'must-not-capture-runtime-spans',
        target: {
          selector: 'span',
          label: 'Authored spans only',
          scope: 'document',
          mode: 'selector',
        },
      },
    ],
  };
  const measuredSplitRuntime =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><h1 id="measured-split-target">One two</h1></body></html>', {
        version: 2,
        interactions: [measuredSplitInteraction],
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const measuredSplitWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {
      measuredSplitPreviewBeginCount += 1;
    },
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {
      measuredSplitPreviewEndCount += 1;
    },
    __KODETY_POST_EDITOR_MESSAGE__(message) {
      if (message.type === 'html-editor-interaction-duration') {
        measuredSplitDurations.push(message.duration);
      }
    },
    __ONUN_MOTION_ENGINE__: {
      timeline: createMeasuredRuntimeTimeline,
      set() {},
      to() {},
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', measuredSplitRuntime)(
    measuredSplitWindow,
    {
      readyState: 'complete',
      body: measuredSplitTarget,
      querySelectorAll: selector => {
        if (selector === '#measured-split-target') {
          return [measuredSplitTarget];
        }
        if (selector === 'span') return measuredSplitTarget.children;
        return [];
      },
      createElement: () => {
        measuredSplitSpanCreations += 1;
        return createTextSplitSpan();
      },
      createTextNode: textValue => ({
        nodeType: 3,
        textContent: String(textValue),
      }),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  assert.equal(measuredSplitSpanCreations, 0, 'the initial duration fallback must not mutate frozen Design text');
  measuredSplitWindow.__kodetyInteractions.get('measured-text-split').pause();
  assert.ok(measuredSplitSpanCreations > 0, 'a duration request must synchronously measure the real split target count');
  assert.equal(measuredSplitDurations.at(-1), 0.9, 'the first reported measured duration must include every text-split stagger target');
  assert.deepEqual(measuredSplitTweenTargetCounts, [3], 'selectors from later actions must not capture temporary text-split spans');
  assert.equal(measuredSplitTarget.innerHTML, 'One two');
  assert.equal(
    measuredSplitTarget.hasAttribute('data-kodety-interaction-split'),
    false,
    'duration measurement must restore the authored text tree before returning',
  );
  assert.equal(measuredSplitWindow.__KODETY_ACTIVE_INTERACTION_PREVIEW__ || '', '', 'duration measurement must not claim visible preview ownership');
  assert.equal(
    measuredSplitPreviewBeginCount + measuredSplitPreviewEndCount,
    0,
    'invisible duration measurement must not open or close a canvas preview session',
  );

  const groupedMeasurementTarget = createTextSplitTarget('One two');
  const groupedMeasuredDurations = new Map();
  const groupedMeasurementRuntime =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><h1 id="grouped-measurement-target">One two</h1></body></html>', {
        version: 2,
        interactions: [
          {
            ...interactions.DEFAULT_INTERACTION,
            id: 'group-duration-a',
            triggerSelector: '#grouped-measurement-target',
            actions: [
              {
                ...interactions.actionFromPreset('fade-in'),
                id: 'group-duration-words',
                duration: 0.5,
                stagger: 0.2,
                textSplit: 'words',
              },
            ],
          },
          {
            ...interactions.DEFAULT_INTERACTION,
            id: 'group-duration-b',
            triggerSelector: '#grouped-measurement-target',
            actions: [
              {
                ...interactions.actionFromPreset('fade-in'),
                id: 'group-duration-chars',
                duration: 0.5,
                stagger: 0.1,
                textSplit: 'chars',
              },
            ],
          },
        ],
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const groupedMeasurementWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_POST_EDITOR_MESSAGE__(message) {
      if (message.type === 'html-editor-interaction-duration') {
        groupedMeasuredDurations.set(message.interactionId, message.duration);
      }
    },
    __ONUN_MOTION_ENGINE__: {
      timeline: createMeasuredRuntimeTimeline,
      set() {},
      to() {},
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', groupedMeasurementRuntime)(
    groupedMeasurementWindow,
    {
      readyState: 'complete',
      body: groupedMeasurementTarget,
      querySelectorAll: selector => (selector === '#grouped-measurement-target' ? [groupedMeasurementTarget] : []),
      createElement: createTextSplitSpan,
      createTextNode: textValue => ({
        nodeType: 3,
        textContent: String(textValue),
      }),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  const previousGroupMeasurementWarn = console.warn;
  console.warn = () => undefined;
  try {
    groupedMeasurementWindow.__kodetyInteractions.control(['group-duration-b', 'group-duration-a'], 'pause');
  } finally {
    console.warn = previousGroupMeasurementWarn;
  }
  assert.equal(groupedMeasuredDurations.get('group-duration-a'), 0.9, 'group duration measurement must account for the first authored split and its stagger');
  assert.equal(
    groupedMeasuredDurations.get('group-duration-b'),
    0.5,
    'group duration measurement must use the same deterministic split-conflict fallback as real playback',
  );
  assert.equal(groupedMeasurementTarget.innerHTML, 'One two');
  assert.equal(
    groupedMeasurementWindow.__KODETY_ACTIVE_INTERACTION_PREVIEW__ || '',
    '',
    'group duration measurement must restore the DOM without claiming preview ownership',
  );

  const measuredSvgTarget = createRuntimeTarget();
  measuredSvgTarget.attributes.set('transform', 'translate(4 8)');
  measuredSvgTarget.attributes.set('data-svg-origin', '10 20');
  measuredSvgTarget._gsap = { uncache: 0 };
  const measuredSvgRuntime =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><svg><path id="measured-svg-target"></path></svg></body></html>', {
        version: 2,
        interactions: [
          {
            ...interactions.DEFAULT_INTERACTION,
            id: 'measured-svg',
            triggerSelector: '#measured-svg-target',
            actions: [interactions.actionFromPreset('slide-up')],
          },
        ],
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  const measuredSvgWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_POST_EDITOR_MESSAGE__() {},
    __ONUN_MOTION_ENGINE__: {
      timeline: createSeekableRuntimeTimeline,
      invalidateElement(element) { element.motionCacheInvalidated = true; },
      set(elements) {
        (Array.isArray(elements) ? elements : [elements]).forEach(element => {
          element.setAttribute('transform', 'matrix(1,0,0,1,0,40)');
          element.setAttribute('data-svg-origin', '0 0');
          element._gsap.uncache = 0;
        });
      },
      to() {},
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', measuredSvgRuntime)(
    measuredSvgWindow,
    {
      readyState: 'complete',
      body: measuredSvgTarget,
      querySelectorAll: selector => (selector === '#measured-svg-target' ? [measuredSvgTarget] : []),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  measuredSvgWindow.__kodetyInteractions.get('measured-svg').pause();
  assert.equal(measuredSvgTarget.getAttribute('transform'), 'translate(4 8)', 'passive duration measurement must restore an authored SVG transform attribute');
  assert.equal(measuredSvgTarget.getAttribute('data-svg-origin'), '10 20', 'passive duration measurement must restore the authored GSAP SVG origin attribute');
  assert.equal(measuredSvgTarget.motionCacheInvalidated, true, 'restoring SVG attributes must invalidate the active Motion engine cache');

  const publishedSplitTarget = createTextSplitTarget('Published words');
  let temporarySpanListenerCount = 0;
  const publishedSplitRuntime =
    interactions
      .patchInteractionDocument('<!doctype html><html><head></head><body><h1 id="published-split-target">Published words</h1></body></html>', {
        version: 2,
        interactions: [
          {
            ...interactions.DEFAULT_INTERACTION,
            id: 'published-split-source',
            name: 'Published split source',
            trigger: 'load',
            triggerSelector: '#published-split-target',
            actions: [
              {
                ...interactions.actionFromPreset('fade-in'),
                id: 'published-split-action',
                textSplit: 'words',
              },
            ],
          },
          {
            ...interactions.DEFAULT_INTERACTION,
            id: 'published-span-trigger',
            name: 'Authored span trigger',
            trigger: 'click',
            triggerSelector: 'span',
            actions: [interactions.actionFromPreset('fade-in')],
          },
        ],
      })
      .match(/<script data-kodety-interactions-runtime>([\s\S]*?)<\/script>/)?.[1] || '';
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', publishedSplitRuntime)(
    {
      __ONUN_MOTION_ENGINE__: {
        timeline: createSeekableRuntimeTimeline,
        set() {},
        to() {},
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      setTimeout,
      clearTimeout,
    },
    {
      readyState: 'complete',
      body: publishedSplitTarget,
      querySelectorAll: selector => {
        if (selector === '#published-split-target') {
          return [publishedSplitTarget];
        }
        if (selector === 'span') return publishedSplitTarget.children;
        return [];
      },
      createElement: () => {
        const span = createTextSplitSpan();
        span.matches = () => true;
        span.addEventListener = () => {
          temporarySpanListenerCount += 1;
        };
        span.removeEventListener = () => undefined;
        return span;
      },
      createTextNode: textValue => ({
        nodeType: 3,
        textContent: String(textValue),
      }),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  assert.ok(publishedSplitTarget.children.length > 0, 'the publication fixture must create runtime-only split spans');
  assert.equal(temporarySpanListenerCount, 0, 'published interactions must not register later triggers on temporary split spans');

  const failingSplitTarget = createTextSplitTarget('Safe fallback');
  let failingSplitEndCount = 0;
  const failingSplitWindow = {
    __KODETY_EDITOR_MOTION_FROZEN__: true,
    __KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__() {},
    __KODETY_END_EDITOR_INTERACTION_PREVIEW__() {
      failingSplitEndCount += 1;
    },
    __KODETY_POST_EDITOR_MESSAGE__() {},
    __ONUN_MOTION_ENGINE__: {
      timeline: createSeekableRuntimeTimeline,
      set() {},
      to() {},
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'matchMedia', 'innerWidth', 'CustomEvent', lazyTextSplitRuntime)(
    failingSplitWindow,
    {
      readyState: 'complete',
      body: failingSplitTarget,
      querySelectorAll: selector => (selector === '#split-target' ? [failingSplitTarget] : []),
      createElement: () => {
        throw new Error('simulated split construction failure');
      },
      createTextNode: textValue => ({
        nodeType: 3,
        textContent: String(textValue),
      }),
      addEventListener() {},
    },
    () => ({ matches: false }),
    1280,
    class CustomEvent {},
  );
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    assert.doesNotThrow(
      () => failingSplitWindow.__kodetyInteractions.get('lazy-text-split').seek(0.25),
      'a failed lazy timeline build must roll back instead of escaping into the editor',
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failingSplitTarget.innerHTML, 'Safe fallback');
  assert.equal(failingSplitTarget.hasAttribute('data-kodety-interaction-split'), false);
  assert.equal(failingSplitWindow.__KODETY_ACTIVE_INTERACTION_PREVIEW__, '');
  assert.equal(failingSplitEndCount, 1, 'a failed lazy timeline build must close the preview session exactly once');

  const inlineScrollDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section id="target">Scroll</section></body></html>',
    {
      version: 2,
      interactions: [
        {
          id: 'self-contained-scroll',
          name: 'Self-contained scroll',
          trigger: 'scroll',
          triggerSelector: '#target',
          triggerLabel: '#target',
          triggerTargetMode: 'selector',
          enabled: true,
          actions: [interactions.actionFromPreset('slide-up')],
        },
      ],
    },
  );
  assert.match(
    inlineScrollDocument,
    /data-kodety-interactions-engine="onun-motion"[\s\S]*?createOnunMotionRuntime/,
    'scroll interactions must embed the project Motion scheduler',
  );
  const inlineScrollDependency = inlineScrollDocument.match(/<script[^>]*data-kodety-interactions-engine="onun-motion"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(inlineScrollDependency, 'scroll interactions must contain a complete project Motion scheduler');
  assert.doesNotMatch(inlineScrollDependency[1], /<\/head\s*>/i, 'the closing head tag must never be substituted inside the Motion scheduler');
  assert.doesNotThrow(() => new Function(inlineScrollDependency[1]), 'the materialized Motion scheduler must remain valid standalone JavaScript');
  const emptyScrollDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section id="empty-scroll"></section></body></html>',
    {
      version: 2,
      interactions: [
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'empty-scroll',
          trigger: 'scroll',
          triggerSelector: '#empty-scroll',
          actions: [],
        },
      ],
    },
  );
  assert.doesNotMatch(emptyScrollDocument, /data-kodety-interactions-engine="scroll-trigger"/, 'an empty Scroll interaction must not load ScrollTrigger');
  const disabledScrollDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section id="disabled-scroll"></section></body></html>',
    {
      version: 2,
      interactions: [
        {
          ...interactions.DEFAULT_INTERACTION,
          id: 'disabled-scroll',
          trigger: 'scroll',
          triggerSelector: '#disabled-scroll',
          enabled: false,
          actions: [interactions.actionFromPreset('slide-up')],
        },
      ],
    },
  );
  assert.doesNotMatch(disabledScrollDocument, /data-kodety-interactions-engine="scroll-trigger"/, 'a disabled Scroll interaction must not load ScrollTrigger');
  const externalScrollDocument = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><section id="story">Story</section><div id="card">Card</div></body></html>',
    {
      version: 2,
      interactions: [
        {
          id: 'section-driven-scroll',
          name: 'Section driven scroll',
          trigger: 'scroll',
          triggerSelector: '#card',
          triggerLabel: '#card',
          triggerTargetMode: 'selector',
          scrollTriggerSelector: '[id="story"]',
          scrollTriggerLabel: '#story',
          enabled: true,
          actions: [interactions.actionFromPreset('slide-up')],
        },
      ],
    },
  );
  const externalScrollInteraction = interactions.readInteractionDocument(externalScrollDocument).interactions[0];
  assert.equal(
    externalScrollInteraction.triggerSelector,
    '#card',
    'a section-driven scroll interaction must retain the animated element as its timeline subject',
  );
  assert.equal(
    externalScrollInteraction.scrollTriggerSelector,
    '[id="story"]',
    'a section-driven scroll interaction must persist its independent Scroll Section selector',
  );
  const actionTargetInteraction = {
    ...externalScrollInteraction,
    id: 'page-load-targeting-header',
    trigger: 'load',
    triggerSelector: 'body',
    actions: [
      {
        ...interactions.actionFromPreset('fade-in'),
        target: {
          selector: '.header',
          label: 'Header',
          scope: 'document',
          mode: 'class',
        },
      },
    ],
  };
  const headerSelection = {
    path: 'html > body > header.header',
    tag: 'header',
    id: '',
    classes: ['header'],
    attributes: {},
    text: '',
    hasElementChildren: true,
    computedStyle: {},
  };
  assert.ok(
    interactions.interactionMatchesSelection(actionTargetInteraction, headerSelection),
    'selecting an animated action target must reveal its interaction even when the trigger belongs to another element',
  );
  assert.ok(
    !interactions.interactionMatchesSelection(actionTargetInteraction, {
      ...headerSelection,
      classes: ['footer'],
      path: 'html > body > footer.footer',
    }),
    'an unrelated selection must not inherit interactions from another action target',
  );
  const multiTargetInteraction = {
    ...actionTargetInteraction,
    actions: [
      {
        ...actionTargetInteraction.actions[0],
        id: 'header-enter',
        name: 'Header enter',
      },
      {
        ...interactions.actionFromPreset('fade-in'),
        id: 'footer-enter',
        name: 'Footer enter',
        target: {
          selector: '.footer',
          label: 'Footer',
          scope: 'document',
          mode: 'class',
        },
      },
    ],
  };
  assert.deepEqual(
    interactions.interactionTimelineForSelection(multiTargetInteraction, headerSelection)?.actions.map(action => action.id),
    ['header-enter'],
    'selecting one animated layer must expose only the actions that target that layer',
  );
  assert.equal(
    interactions.interactionTimelineForSelection({ ...multiTargetInteraction, triggerSelector: '.header' }, headerSelection)?.actions.length,
    2,
    'selecting an interaction trigger must retain its complete authored timeline',
  );
  assert.deepEqual(
    motionTimeline.timelinePreviewInteractionIds('selection', 'hero-art', ['hero-art', 'navbar', 'badge', 'hero-art', 'copy']),
    ['hero-art', 'navbar', 'badge', 'copy'],
    'a grouped section preview must retain every visible interaction once and in lane order',
  );
  assert.deepEqual(
    motionTimeline.timelinePreviewInteractionIds('interaction', 'navbar', ['hero-art', 'navbar', 'badge']),
    ['navbar'],
    'an explicitly focused interaction must keep the existing single-controller preview',
  );
  assert.equal(motionTimeline.clampTimelineZoom(Number.NaN), motionTimeline.TIMELINE_DEFAULT_ZOOM, 'invalid timeline zoom must keep a stable finite fallback');
  assert.equal(motionTimeline.clampTimelineZoom(0.01), motionTimeline.TIMELINE_MIN_ZOOM, 'timeline zoom must clamp values below its supported range');
  assert.equal(motionTimeline.clampTimelineZoom(99_999), motionTimeline.TIMELINE_MAX_ZOOM, 'timeline zoom must clamp values above its supported range');
  assert.equal(motionTimeline.fitTimelineZoom(2, 900), 342, 'Fit must use the compact timeline label column, available viewport and end padding');
  assert.equal(motionTimeline.fitTimelineZoom(4, 900), 171, 'Fit must adapt the pixels-per-second scale to longer interactions');
  assert.equal(motionTimeline.fitTimelineZoom(60, 300), 1.4, 'Fit must keep long interactions visible instead of imposing the old 60px/s floor');
  assert.equal(motionTimeline.timelineTickStep(100), 0.5, 'the compact ruler may expose half-second labels while retaining readable spacing');
  assert.equal(motionTimeline.timelineTickStep(320), 0.2, 'a dense timeline may expose sub-second labels without overlap');
  const fittedTimelineRuler = motionTimeline.buildTimelineRulerTicks(640, 320);
  assert.equal(fittedTimelineRuler.step, 0.2);
  assert.deepEqual(fittedTimelineRuler.ticks.slice(0, 4), [0, 0.2, 0.4, 0.6], 'timeline ruler ticks must follow the adaptive major-label interval');
  assert.ok(
    fittedTimelineRuler.step * 320 >= motionTimeline.TIMELINE_MIN_LABEL_SPACING,
    'major timeline labels must never be placed closer than the readable spacing',
  );

  assert.equal(
    infiniteCanvas.clampInfiniteCanvasZoom(-500),
    infiniteCanvas.INFINITE_CANVAS_MIN_ZOOM,
    'infinite canvas zoom must clamp values below its supported range',
  );
  assert.equal(
    infiniteCanvas.clampInfiniteCanvasZoom(500),
    infiniteCanvas.INFINITE_CANVAS_MAX_ZOOM,
    'infinite canvas zoom must clamp values above its supported range',
  );
  assert.equal(infiniteCanvas.clampInfiniteCanvasZoom(Number.NaN), 64, 'invalid infinite canvas zoom must normalize to the stable default');

  const infiniteLayout = infiniteCanvas.layoutInfiniteCanvasFrames(
    [
      { id: 'base', width: 1200, height: 900 },
      { id: 'tablet', width: 810, height: 900 },
      { id: 'mobile', width: 390, height: 844 },
    ],
    { gap: 32, padding: 24, headerHeight: 20 },
  );
  assert.deepEqual(
    infiniteLayout.frames,
    [
      { id: 'base', width: 1200, height: 900, x: 24, y: 24 },
      { id: 'tablet', width: 810, height: 900, x: 1256, y: 24 },
      { id: 'mobile', width: 390, height: 844, x: 2098, y: 24 },
    ],
    'breakpoint frames must keep their input order and deterministic plane coordinates',
  );
  assert.equal(infiniteLayout.width, 2512);
  assert.equal(infiniteLayout.height, 968);
  infiniteLayout.frames.slice(1).forEach((frame, index) => {
    const previous = infiniteLayout.frames[index];
    assert.equal(frame.x - (previous.x + previous.width), 32, 'adjacent infinite canvas frames must retain the configured gap without overlap');
  });
  const normalizedInfiniteLayout = infiniteCanvas.layoutInfiniteCanvasFrames([{ id: 'invalid', width: Number.NaN, height: 0 }], {
    gap: 0,
    padding: -10,
    headerHeight: Number.NaN,
  });
  assert.deepEqual(
    normalizedInfiniteLayout.frames,
    [{ id: 'invalid', width: 1, height: 1, x: 0, y: 0 }],
    'invalid frame geometry must normalize to a finite visible plane',
  );
  assert.equal(normalizedInfiniteLayout.width, 1);
  assert.equal(normalizedInfiniteLayout.height, 1 + infiniteCanvas.INFINITE_CANVAS_FRAME_HEADER_HEIGHT);
  assert.deepEqual(
    infiniteCanvas.layoutInfiniteCanvasFrames([]),
    {
      frames: [],
      width: infiniteCanvas.INFINITE_CANVAS_PLANE_PADDING * 2,
      height: infiniteCanvas.INFINITE_CANVAS_PLANE_PADDING * 2,
    },
    'an empty infinite canvas must still expose a finite padded plane',
  );

  const fittedInfiniteView = infiniteCanvas.fitInfiniteCanvasView({ width: 1000, height: 800 }, { width: 2000, height: 1000 }, 100);
  assert.deepEqual(fittedInfiniteView, { zoom: 40, pan: { x: 100, y: 200 } }, 'Fit must center the complete breakpoint plane inside the padded viewport');
  assert.equal(
    infiniteCanvas.fitInfiniteCanvasView({ width: 1000, height: 800 }, { width: 1, height: 1 }).zoom,
    infiniteCanvas.INFINITE_CANVAS_MAX_ZOOM,
    'Fit must respect the maximum zoom for tiny planes',
  );
  assert.equal(
    infiniteCanvas.fitInfiniteCanvasView({ width: 1000, height: 800 }, { width: 1_000_000, height: 1_000_000 }).zoom,
    infiniteCanvas.INFINITE_CANVAS_MIN_ZOOM,
    'Fit must respect the minimum zoom for very large planes',
  );
  const degenerateInfiniteFit = infiniteCanvas.fitInfiniteCanvasView({ width: Number.NaN, height: 0 }, { width: Number.POSITIVE_INFINITY, height: -1 });
  assert.equal(Number.isFinite(degenerateInfiniteFit.zoom), true);
  assert.equal(Number.isFinite(degenerateInfiniteFit.pan.x), true);
  assert.equal(Number.isFinite(degenerateInfiniteFit.pan.y), true);

  const focusedInfiniteView = infiniteCanvas.focusInfiniteCanvasFrame(
    { zoom: 75, pan: { x: -120, y: -840 } },
    { width: 1000, height: 800 },
    infiniteLayout.frames[2],
  );
  assert.equal(focusedInfiniteView.zoom, 75, 'breakpoint focus must preserve the current infinite-canvas zoom');
  assert.equal(focusedInfiniteView.pan.y, -840, 'breakpoint focus must preserve the current vertical reading position');
  assert.equal(
    focusedInfiniteView.pan.x +
      infiniteLayout.frames[2].x * (focusedInfiniteView.zoom / 100) +
      (infiniteLayout.frames[2].width * (focusedInfiniteView.zoom / 100)) / 2,
    500,
    'breakpoint focus must horizontally center only the selected frame',
  );

  const anchoredInfiniteView = {
    zoom: 100,
    pan: { x: 100, y: 50 },
  };
  const infiniteZoomPoint = { x: 460, y: 290 };
  const infiniteWorldBeforeZoom = {
    x: (infiniteZoomPoint.x - anchoredInfiniteView.pan.x) / (anchoredInfiniteView.zoom / 100),
    y: (infiniteZoomPoint.y - anchoredInfiniteView.pan.y) / (anchoredInfiniteView.zoom / 100),
  };
  const zoomedInfiniteView = infiniteCanvas.zoomInfiniteCanvasAtPoint(anchoredInfiniteView, infiniteZoomPoint, -100);
  const infiniteWorldAfterZoom = {
    x: (infiniteZoomPoint.x - zoomedInfiniteView.pan.x) / (zoomedInfiniteView.zoom / 100),
    y: (infiniteZoomPoint.y - zoomedInfiniteView.pan.y) / (zoomedInfiniteView.zoom / 100),
  };
  assert.ok(
    Math.abs(infiniteWorldBeforeZoom.x - infiniteWorldAfterZoom.x) < 1e-9 && Math.abs(infiniteWorldBeforeZoom.y - infiniteWorldAfterZoom.y) < 1e-9,
    'cursor-anchored zoom must preserve the world point below the pointer',
  );
  assert.equal(
    infiniteCanvas.zoomInfiniteCanvasAtPoint(anchoredInfiniteView, infiniteZoomPoint, 10_000).zoom,
    infiniteCanvas.INFINITE_CANVAS_MIN_ZOOM,
    'wheel zoom-out must clamp at the supported minimum',
  );
  assert.equal(
    infiniteCanvas.zoomInfiniteCanvasAtPoint(anchoredInfiniteView, infiniteZoomPoint, -10_000).zoom,
    infiniteCanvas.INFINITE_CANVAS_MAX_ZOOM,
    'wheel zoom-in must clamp at the supported maximum',
  );
  assert.deepEqual(
    infiniteCanvas.normalizeInfiniteCanvasView({
      zoom: 999,
      pan: { x: -120.5, y: 88.25 },
    }),
    {
      zoom: infiniteCanvas.INFINITE_CANVAS_MAX_ZOOM,
      pan: { x: -120.5, y: 88.25 },
    },
    'persisted infinite canvas transforms must retain finite pan and clamp zoom',
  );
  assert.equal(infiniteCanvas.normalizeInfiniteCanvasView(null), null);
  assert.equal(
    infiniteCanvas.normalizeInfiniteCanvasView({
      zoom: 100,
      pan: { x: Number.POSITIVE_INFINITY, y: 0 },
    }),
    null,
    'persisted transforms with non-finite pan coordinates must be rejected',
  );

  const customCodeSettings = customCode.normalizeCustomCodeSettings({
    version: 99,
    entries: [
      {
        id: ' Analytics 🚀 ',
        name: ' Analytics ',
        code: 'console.log("analytics")',
        position: 'head',
        scope: 'site',
        pagePath: '/pages/./about.html?draft=1#preview',
        run: 'every-page-visit',
        language: 'js',
        enabled: 'false',
      },
      {
        id: 'Analytics',
        name: '',
        code: '<meta name="page-code">',
        placement: 'body-start',
        scope: 'page',
        pages: ['pages/about.html', 'pages/../pages/about.html'],
      },
    ],
  });
  assert.equal(customCodeSettings.version, 1);
  assert.equal(customCodeSettings.entries[0].id, 'Analytics');
  assert.equal(customCodeSettings.entries[1].id, 'Analytics-2', 'normalization must make marker IDs deterministic and unique');
  assert.deepEqual(
    customCodeSettings.entries[0],
    {
      id: 'Analytics',
      name: 'Analytics',
      code: 'console.log("analytics")',
      placement: 'head-end',
      scope: 'all',
      pages: ['pages/about.html'],
      run: 'navigation',
      language: 'javascript',
      enabled: false,
      consent: 'always',
      consentCategory: '',
    },
    'legacy Custom Code fields must normalize into the stable v1 contract',
  );
  assert.equal(customCodeSettings.entries[1].name, 'Código 2');
  assert.equal(customCodeSettings.entries[1].scope, 'selected');
  assert.deepEqual(customCodeSettings.entries[1].pages, ['pages/about.html']);
  assert.equal(
    customCode.normalizeCustomCodeSettings({
      entries: [{ id: 'unsafe--comment', code: '<meta>', enabled: true }],
    }).entries[0].id,
    'unsafe-comment',
    'marker IDs must not contain the invalid double-hyphen sequence used by HTML comments',
  );

  const placementSettings = {
    version: 1,
    entries: [
      {
        id: 'head-start-a',
        name: 'Head A',
        code: '<meta name="head-start-a">',
        placement: 'head-start',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
      {
        id: 'body-end',
        name: 'Body end',
        code: '<div id="body-end"></div>',
        placement: 'body-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
      {
        id: 'head-end',
        name: 'Head end',
        code: '<meta name="head-end">',
        placement: 'head-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
      {
        id: 'head-start-b',
        name: 'Head B',
        code: '<meta name="head-start-b">',
        placement: 'head-start',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
      {
        id: 'body-start',
        name: 'Body start',
        code: '<div id="body-start"></div>',
        placement: 'body-start',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
    ],
  };
  const authoredCustomCodeHtml = '<!doctype html><html><head><title>Authored title</title></head><body><main>Authored body</main></body></html>';
  const customCodeHtml = customCode.applyCustomCodeToHtml(authoredCustomCodeHtml, placementSettings, 'index.html');
  const customCodeIndexes = {
    headOpen: customCodeHtml.indexOf('<head>'),
    headStartA: customCodeHtml.indexOf('name="head-start-a"'),
    headStartB: customCodeHtml.indexOf('name="head-start-b"'),
    title: customCodeHtml.indexOf('<title>'),
    headEnd: customCodeHtml.indexOf('name="head-end"'),
    headClose: customCodeHtml.indexOf('</head>'),
    bodyOpen: customCodeHtml.indexOf('<body>'),
    bodyStart: customCodeHtml.indexOf('id="body-start"'),
    main: customCodeHtml.indexOf('<main>'),
    bodyEnd: customCodeHtml.indexOf('id="body-end"'),
    bodyClose: customCodeHtml.indexOf('</body>'),
  };
  assert.ok(
    customCodeIndexes.headOpen < customCodeIndexes.headStartA &&
      customCodeIndexes.headStartA < customCodeIndexes.headStartB &&
      customCodeIndexes.headStartB < customCodeIndexes.title &&
      customCodeIndexes.title < customCodeIndexes.headEnd &&
      customCodeIndexes.headEnd < customCodeIndexes.headClose,
    'head-start/head-end entries must surround authored head content and retain list order',
  );
  assert.ok(
    customCodeIndexes.bodyOpen < customCodeIndexes.bodyStart &&
      customCodeIndexes.bodyStart < customCodeIndexes.main &&
      customCodeIndexes.main < customCodeIndexes.bodyEnd &&
      customCodeIndexes.bodyEnd < customCodeIndexes.bodyClose,
    'body-start/body-end entries must surround authored body content',
  );
  assert.equal(
    customCode.applyCustomCodeToHtml(customCodeHtml, placementSettings, 'index.html'),
    customCodeHtml,
    'Custom Code materialization must be byte-for-byte idempotent',
  );
  assert.equal(
    customCode.applyCustomCodeToHtml(customCodeHtml, { version: 1, entries: [] }, 'index.html'),
    authoredCustomCodeHtml,
    'removing an entry from settings must remove its previously materialized marker range',
  );

  const wrappingSettings = {
    version: 1,
    entries: [
      {
        id: 'raw-css',
        name: 'Raw CSS',
        code: '.label::after { content: "<style docs </style>"; }',
        placement: 'head-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'css',
        enabled: true,
      },
      {
        id: 'wrapped-css',
        name: 'Wrapped CSS',
        code: '<style>.wrapped { color: red; }</style>',
        placement: 'head-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'css',
        enabled: true,
      },
      {
        id: 'raw-js',
        name: 'Raw JS',
        code: 'const closing = "</script>"; // <script docs',
        placement: 'body-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'javascript',
        enabled: true,
      },
      {
        id: 'wrapped-js',
        name: 'Wrapped JS',
        code: '<script type="module">window.wrapped = true;</script>',
        placement: 'body-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'javascript',
        enabled: true,
      },
      {
        id: 'raw-html',
        name: 'Raw HTML',
        code: '<aside id="custom-html"></aside>',
        placement: 'body-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
    ],
  };
  const wrappedCustomCodeHtml = customCode.applyCustomCodeToHtml(authoredCustomCodeHtml, wrappingSettings, 'index.html');
  assert.match(
    wrappedCustomCodeHtml,
    /<style data-incode-custom-code="raw-css">[\s\S]*<\\\/style>[\s\S]*<\/style>/,
    'raw CSS must be wrapped even when its contents mention a style tag',
  );
  assert.equal(
    (wrappedCustomCodeHtml.match(/<style>\.wrapped \{ color: red; \}<\/style>/g) || []).length,
    1,
    'already wrapped CSS must not receive a second style wrapper',
  );
  assert.match(
    wrappedCustomCodeHtml,
    /<script data-incode-custom-code="raw-js">[\s\S]*<\\\/script>[\s\S]*<\/script>/,
    'raw JavaScript must be wrapped and protect literal closing-script text',
  );
  assert.equal(
    (wrappedCustomCodeHtml.match(/<script type="module">window\.wrapped = true;<\/script>/g) || []).length,
    1,
    'already wrapped JavaScript must not receive a second script wrapper',
  );
  assert.doesNotMatch(wrappedCustomCodeHtml, /data-kodety-/, 'Custom Code markers/runtime must not opt an otherwise static page into the CMS parser');

  const scopedSettings = {
    version: 1,
    entries: [
      {
        id: 'all',
        name: 'All',
        code: '<meta name="all">',
        placement: 'head-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
      {
        id: 'about',
        name: 'About',
        code: '<meta name="about">',
        placement: 'head-end',
        scope: 'selected',
        pages: ['/pages/./about.html'],
        run: 'once',
        language: 'html',
        enabled: true,
      },
      {
        id: 'contact',
        name: 'Contact',
        code: '<meta name="contact">',
        placement: 'head-end',
        scope: 'selected',
        pages: ['contact.html'],
        run: 'once',
        language: 'html',
        enabled: true,
      },
      {
        id: 'disabled',
        name: 'Disabled',
        code: '<meta name="disabled">',
        placement: 'head-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: false,
      },
      {
        id: 'blank',
        name: 'Blank',
        code: '   ',
        placement: 'head-end',
        scope: 'all',
        pages: [],
        run: 'once',
        language: 'html',
        enabled: true,
      },
    ],
  };
  assert.deepEqual(
    customCode.resolveCustomCodeEntries(scopedSettings, '/pages/about.html?preview=1#hero').map(entry => entry.id),
    ['all', 'about'],
    'page scope must normalize paths and exclude disabled/blank/unselected entries',
  );

  const incompleteCustomCodeHtml = customCode.applyCustomCodeToHtml(
    '<html><head><title>Incomplete</title><body><main>Body',
    {
      version: 1,
      entries: [
        {
          id: 'incomplete-head',
          name: 'Head',
          code: '<meta name="incomplete-head">',
          placement: 'head-end',
          scope: 'all',
          pages: [],
          run: 'once',
          language: 'html',
          enabled: true,
        },
        {
          id: 'incomplete-body',
          name: 'Body',
          code: '<aside id="incomplete-body"></aside>',
          placement: 'body-end',
          scope: 'all',
          pages: [],
          run: 'once',
          language: 'html',
          enabled: true,
        },
      ],
    },
    'index.html',
  );
  assert.ok(
    incompleteCustomCodeHtml.indexOf('name="incomplete-head"') < incompleteCustomCodeHtml.indexOf('<body>'),
    'head-end must stay in the head when an authored closing head tag is missing',
  );
  assert.ok(
    incompleteCustomCodeHtml.indexOf('<main>Body') < incompleteCustomCodeHtml.indexOf('id="incomplete-body"'),
    'body-end must follow authored body content when a closing body tag is missing',
  );

  const navigationCustomCodeHtml = customCode.applyCustomCodeToHtml(
    authoredCustomCodeHtml,
    {
      version: 1,
      entries: [
        {
          id: 'navigation',
          name: 'Navigation',
          code: 'window.navigationRuns = (window.navigationRuns || 0) + 1;',
          placement: 'body-end',
          scope: 'all',
          pages: [],
          run: 'navigation',
          language: 'javascript',
          enabled: true,
        },
      ],
    },
    'index.html',
  );
  assert.match(navigationCustomCodeHtml, /__incodeCustomCodeRuntimeV1/);
  assert.match(navigationCustomCodeHtml, /addEventListener\("kodety:navigation",schedule\)/);
  assert.match(navigationCustomCodeHtml, /addEventListener\("popstate",schedule\)/);
  assert.match(navigationCustomCodeHtml, /addEventListener\("hashchange",schedule\)/);
  assert.match(navigationCustomCodeHtml, /\["pushState","replaceState"\]/);
  assert.match(
    navigationCustomCodeHtml,
    /while\(node&&node!==end\)[\s\S]*node\.remove\(\)/,
    'navigation mode must remove the previous mounted range before rerunning',
  );
  assert.match(
    navigationCustomCodeHtml,
    /fragment\.querySelectorAll\("script"\)[\s\S]*oldScript\.replaceWith\(live\)/,
    'navigation mode must recreate script nodes so template-parsed scripts execute',
  );
  assert.equal(
    customCode.applyCustomCodeToHtml(
      navigationCustomCodeHtml,
      {
        version: 1,
        entries: [
          {
            id: 'navigation',
            name: 'Navigation',
            code: 'window.navigationRuns = (window.navigationRuns || 0) + 1;',
            placement: 'body-end',
            scope: 'all',
            pages: [],
            run: 'navigation',
            language: 'javascript',
            enabled: true,
          },
        ],
      },
      'index.html',
    ),
    navigationCustomCodeHtml,
    'navigation runtime materialization must remain idempotent',
  );

  const remappedCustomCode = customCode.remapCustomCodePage(
    {
      version: 1,
      entries: [
        {
          id: 'page',
          name: 'Page',
          code: '<meta name="page">',
          placement: 'head-end',
          scope: 'selected',
          pages: ['old.html', 'new.html'],
          run: 'once',
          language: 'html',
          enabled: true,
        },
      ],
    },
    './old.html',
    '/new.html',
  );
  assert.deepEqual(remappedCustomCode.entries[0].pages, ['new.html'], 'renaming a page must remap and deduplicate selected-page scopes');
  const removedCustomCode = customCode.removeCustomCodePage(remappedCustomCode, 'new.html');
  assert.deepEqual(removedCustomCode.entries[0].pages, []);
  assert.deepEqual(
    customCode.resolveCustomCodeEntries(removedCustomCode, 'new.html'),
    [],
    'removing a page must leave its orphaned entry inert rather than broadening it to every page',
  );

  const variantCasePath = '.incode/experiments/route-test/variant-b/project/case.html';
  const caseCompanionPath = interactions.interactionDocumentPath('case.html');
  const variantCaseCompanionPath = interactions.interactionDocumentPath(variantCasePath);
  let routeRenameProject = {
    name: 'Route rename',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<a href="/case?from=home#work">Case</a><a href="/case-study">Untouched</a>',
      },
      'case.html': {
        path: 'case.html',
        mimeType: 'text/html',
        text: '<a href="./case.html#top">Self</a>',
      },
      'about.html': {
        path: 'about.html',
        mimeType: 'text/html',
        text: '<a href="case.html">Case</a><form action="/case"></form><a href="https://example.com/case">External</a>',
      },
      [variantCasePath]: {
        path: variantCasePath,
        mimeType: 'text/html',
        text: '<a href="/case">Variant link</a>',
      },
      [caseCompanionPath]: {
        path: caseCompanionPath,
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 2,
          interactions: [{ id: 'control-case-animation' }],
        }),
      },
      [variantCaseCompanionPath]: {
        path: variantCaseCompanionPath,
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 2,
          interactions: [{ id: 'variant-case-animation' }],
        }),
      },
    },
  };
  routeRenameProject = projectIo.updateEditorMetadata(routeRenameProject, metadata => ({
    ...metadata,
    homeHtmlPath: 'index.html',
    pageSettings: { 'case.html': { title: 'Case' } },
    localization: {
      version: 2,
      sourceLocale: 'pt-BR',
      defaultLocale: 'pt-BR',
      automaticLocale: false,
      rememberLocale: false,
      translatePagePaths: false,
      includePathsInAi: false,
      locales: [
        {
          code: 'pt-BR',
          language: 'pt',
          region: 'BR',
          name: 'Português (Brasil)',
          slug: '',
          enabled: true,
          direction: 'ltr',
        },
      ],
      translations: {
        'en-US': {
          pages: {
            'case.html': {
              entries: {},
              overrides: {
                'id:cta': { attributes: { href: '/case#localized' } },
              },
              insertions: [
                {
                  id: 'nav',
                  anchor: 'body',
                  position: 'append',
                  html: '<a href="/case">Case</a>',
                },
              ],
            },
          },
        },
      },
    },
    components: [
      {
        id: 'card',
        name: 'Card',
        variants: [
          {
            id: 'primary',
            name: 'Primary',
            markup: '<a href="/case">Open case</a>',
          },
        ],
        interactions: [],
        props: [
          {
            id: 'destination',
            name: 'Destination',
            type: 'link',
            attribute: 'href',
            defaultValue: '/case',
          },
        ],
      },
    ],
    membership: {
      version: 1,
      enabled: true,
      gates: {},
      pages: {
        'case.html': {
          requirement: { type: 'authenticated' },
          anonymous: { type: 'redirect', url: '/case?login=1' },
          denied: { type: 'hide' },
        },
      },
    },
    customCode: {
      version: 1,
      entries: [
        {
          id: 'case-only',
          name: 'Case',
          code: '',
          placement: 'head-end',
          scope: 'selected',
          pages: ['case.html'],
          run: 'once',
          language: 'html',
          enabled: true,
        },
      ],
    },
    redirects: {
      version: 1,
      entries: [
        {
          id: 'legacy',
          source: '/legacy',
          destination: '/case',
          status: 301,
          match: 'exact',
          enabled: true,
        },
      ],
    },
    analytics: {
      experimentsVersion: 2,
      experiments: [
        {
          id: 'route-test',
          name: 'Route test',
          pagePath: 'case.html',
          status: 'draft',
          goal: { type: 'pageview', pagePath: 'case.html' },
          variants: [
            {
              id: 'control',
              name: 'Control',
              kind: 'control',
              status: 'active',
              weight: 50,
              pagePath: 'case.html',
              sourcePagePath: 'case.html',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'variant-b',
              name: 'Variant B',
              kind: 'variant',
              status: 'active',
              weight: 50,
              pagePath: variantCasePath,
              sourcePagePath: 'case.html',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  }));
  const routeRename = pageRename.renameProjectPage(routeRenameProject, 'case.html', 'projetos');
  assert.ok(routeRename.project.files['projetos.html']);
  assert.equal(routeRename.project.files['case.html'], undefined);
  assert.match(routeRename.project.files['index.html'].text, /href="\/projetos\?from=home#work"/);
  assert.match(routeRename.project.files['index.html'].text, /href="\/case-study"/);
  assert.match(routeRename.project.files['about.html'].text, /href="projetos\.html"/);
  assert.match(routeRename.project.files['about.html'].text, /action="\/projetos"/);
  assert.match(routeRename.project.files['about.html'].text, /href="https:\/\/example\.com\/case"/);
  const renamedVariantPath = '.incode/experiments/route-test/variant-b/project/projetos.html';
  const renamedCaseCompanionPath = interactions.interactionDocumentPath('projetos.html');
  const renamedVariantCompanionPath = interactions.interactionDocumentPath(renamedVariantPath);
  assert.ok(routeRename.project.files[renamedVariantPath]);
  assert.match(routeRename.project.files[renamedVariantPath].text, /href="\/projetos"/);
  assert.equal(routeRename.project.files[caseCompanionPath], undefined);
  assert.equal(routeRename.project.files[variantCaseCompanionPath], undefined);
  assert.match(
    routeRename.project.files[renamedCaseCompanionPath].text,
    /control-case-animation/,
    'the page refactor must move the Control animation companion with its HTML file',
  );
  assert.match(
    routeRename.project.files[renamedVariantCompanionPath].text,
    /variant-case-animation/,
    'the page refactor must move every affected A/B variant animation companion',
  );
  const routeMetadata = projectIo.readEditorMetadata(routeRename.project);
  assert.equal(routeMetadata.pageSettings['projetos.html'].title, 'Case');
  assert.equal(routeMetadata.localization.translations['en-US'].pages['case.html'], undefined);
  assert.equal(routeMetadata.localization.translations['en-US'].pages['projetos.html'].overrides['id:cta'].attributes.href, '/projetos#localized');
  assert.match(routeMetadata.localization.translations['en-US'].pages['projetos.html'].insertions[0].html, /href="\/projetos"/);
  assert.ok(routeMetadata.membership.pages['projetos.html']);
  assert.equal(routeMetadata.membership.pages['projetos.html'].anonymous.url, '/projetos?login=1');
  assert.deepEqual(routeMetadata.customCode.entries[0].pages, ['projetos.html']);
  assert.equal(routeMetadata.redirects.entries[0].destination, '/projetos');
  assert.equal(routeMetadata.analytics.experiments[0].pagePath, 'projetos.html');
  assert.equal(routeMetadata.analytics.experiments[0].goal.pagePath, 'projetos.html');
  assert.equal(routeMetadata.analytics.experiments[0].variants[1].pagePath, renamedVariantPath);
  assert.ok(routeRename.updatedLinks >= 5, 'route refactoring must report every rewritten authored HTML navigation target');

  const customCodeProject = {
    name: 'Custom Code',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: authoredCustomCodeHtml,
      },
      'pages/about.html': {
        path: 'pages/about.html',
        mimeType: 'text/html',
        text: authoredCustomCodeHtml,
      },
      'styles.css': {
        path: 'styles.css',
        mimeType: 'text/css',
        text: 'body { color: black; }',
      },
    },
  };
  const materializedCustomCodeProject = customCode.applyCustomCodeToProject(customCodeProject, scopedSettings);
  assert.match(materializedCustomCodeProject.files['index.html'].text, /name="all"/);
  assert.doesNotMatch(materializedCustomCodeProject.files['index.html'].text, /name="about"/);
  assert.match(materializedCustomCodeProject.files['pages/about.html'].text, /name="all"/);
  assert.match(materializedCustomCodeProject.files['pages/about.html'].text, /name="about"/);
  assert.equal(
    materializedCustomCodeProject.files['styles.css'],
    customCodeProject.files['styles.css'],
    'project materialization must not clone or rewrite non-HTML assets',
  );
  assert.equal(
    customCode.applyCustomCodeToProject(materializedCustomCodeProject, scopedSettings),
    materializedCustomCodeProject,
    'a second project materialization must preserve object identity when no bytes change',
  );

  const mobileRule = {
    target: 'rule',
    selector: '.card',
    cssFilePath: 'styles.css',
    pseudo: 'hover',
    breakpoint: 'mobile',
  };
  assert.equal(css.changeCssEditingTarget, undefined, 'the visual authoring API must not expose an Inline/CSS target switch');
  assert.equal(mobileRule.target, 'rule');
  let html = '<!doctype html><html><body><div class="card" style="color:red"></div></body></html>';
  const applyInline = (property, value) => {
    const current = styles.parseStyleDeclarations((html.match(/style="([^"]*)"/) || [])[1] || '');
    if (value) current[property] = value;
    else delete current[property];
    html = source.patchElementAttribute(html, '', 'style', styles.serializeStyleDeclarations(current));
  };
  applyInline('gap', '16px');
  applyInline('background-color', '#123456');
  const declarations = styles.parseStyleDeclarations((html.match(/style="([^"]*)"/) || [])[1] || '');
  assert.deepEqual(declarations, {
    color: 'red',
    gap: '16px',
    'background-color': '#123456',
  });
  const priorityInline = styles.parseStyleDeclarations('display: grid !important; color: red');
  priorityInline.color = 'blue';
  assert.equal(styles.serializeStyleDeclarations(priorityInline), 'display: grid; color: blue');
  assert.deepEqual(
    styles.parseStyleDeclarationDetails(
      'width: 120px; width: 233px !important; width: 300px; color: red; color: blue !important; color: green !important',
    ),
    {
      width: { value: '233px', important: true },
      color: { value: 'green', important: true },
    },
    'the detailed inline parser must retain the real duplicate winner and its priority',
  );
  assert.deepEqual(
    styles.parseStyleDeclarationDetails(
      'content: "!important"; background-image: url("icon!important.svg"); opacity: .8 !/**/ important /* retained priority */',
    ),
    {
      content: { value: '"!important"', important: false },
      'background-image': { value: 'url("icon!important.svg")', important: false },
      opacity: { value: '.8', important: true },
    },
    'priority parsing must ignore literal text while accepting comments around the priority token',
  );
  assert.deepEqual(
    styles.parseStyleDeclarations('display: grid !important; display: flex; color: red; color: blue !important'),
    { display: 'grid', color: 'blue' },
    'inline duplicate parsing must retain the declaration that wins while removing priority',
  );
  const authoritativeInline = styles.writeStyleDeclaration(styles.parseStyleDeclarations('gap: 4px; row-gap: 40px !important; color: red'), 'gap', '12px', {
    authoritative: true,
  });
  assert.equal(
    styles.serializeStyleDeclarations(authoritativeInline),
    'color: red; gap: 12px',
    'an authoritative inline shorthand must remove conflicts without persisting priority',
  );
  const inlineSourcePatched = source.patchElementStyleDeclaration(
    '<!doctype html><html><body><div class="card" style="gap: 4px; row-gap: 40px !important"></div></body></html>',
    '0',
    'gap',
    '18px',
    { authoritative: true },
  );
  assert.match(inlineSourcePatched, /style="gap: 18px"/i, 'the source-level inline patch must remove authored priority and persist the panel value');
  assert.doesNotMatch(inlineSourcePatched, /row-gap/i, 'a stale important longhand must not survive an authoritative shorthand edit');
  const prioritizedInlineSourcePatched = source.patchElementStyleDeclaration(
    '<!doctype html><html><body><div style="width: 100px !important; color: red !important; opacity: .6"></div></body></html>',
    '0',
    'width',
    '200px',
    { authoritative: true },
  );
  assert.match(
    prioritizedInlineSourcePatched,
    /style="color: red !important; opacity: \.6; width: 200px !important"/i,
    'a generic inline edit must change only the value while retaining the edited and unrelated priorities',
  );
  const removedPrioritizedInline = source.patchElementStyleDeclaration(
    prioritizedInlineSourcePatched,
    '0',
    'width',
    '',
    { authoritative: true },
  );
  assert.doesNotMatch(removedPrioritizedInline, /\bwidth\s*:/i, 'an explicit empty value must still remove the inline property');
  assert.match(
    removedPrioritizedInline,
    /\bcolor:\s*red\s*!important/i,
    'removing one inline property must not flatten an unrelated declaration priority',
  );
  const absoluteContextSource = source.ensureAbsoluteParentPositioningContext(
    '<!doctype html><html><body><section class="hero"><a class="cta" style="position:absolute;left:12%;bottom:12px">CTA</a></section></body></html>',
    ['0/0'],
  );
  assert.match(
    absoluteContextSource,
    /<section class="hero" style="position: relative">/i,
    'an absolute child must persist its direct parent as the containing block used by px and percentage offsets',
  );
  const preservedFixedContext = source.ensureAbsoluteParentPositioningContext(
    '<!doctype html><html><body><aside style="position:fixed"><button style="position:absolute;right:12px">Close</button></aside></body></html>',
    ['0/0'],
  );
  assert.match(preservedFixedContext, /<aside style="position:fixed">/i, 'an existing fixed/absolute/sticky parent must remain its own valid containing block');
  assert.doesNotMatch(preservedFixedContext, /<aside[^>]*position:\s*relative/i, 'materializing an absolute context must never downgrade a fixed parent');
  const prioritizedAbsoluteContext = source.ensureAbsoluteParentPositioningContext(
    '<!doctype html><html><body><section style="position:static !important;color:red !important"><a style="position:absolute">CTA</a></section></body></html>',
    ['0/0'],
  );
  assert.match(
    prioritizedAbsoluteContext,
    /<section style="color: red !important; position: relative !important">/i,
    'materializing an inline positioning context must preserve its existing priority and unrelated priorities',
  );
  const visibilitySource =
    '<!doctype html><html><body><section class="hero" style="display: grid !important; gap: 24px"><button>CTA</button></section></body></html>';
  const hiddenVisibilitySource = source.patchElementVisibility(visibilitySource, '0', false);
  assert.match(hiddenVisibilitySource, /\bhidden="hidden"/i, 'Hide must persist the semantic hidden state on the selected layer');
  assert.match(hiddenVisibilitySource, /\baria-hidden="true"/i, 'Hide must expose the same authoritative state to assistive and runtime visibility checks');
  assert.match(hiddenVisibilitySource, /\bdisplay:\s*none(?!\s*!important)/i, 'Hide must remove authored priority and persist the selected layer state');
  assert.match(
    hiddenVisibilitySource,
    /\bdata-kodety-hidden-display="grid"/i,
    'Hide must retain the displaced inline layout value for an exact Show round-trip',
  );
  const hiddenVisibilityTwice = source.patchElementVisibility(hiddenVisibilitySource, '0', false);
  assert.equal(hiddenVisibilityTwice, hiddenVisibilitySource, 'repeating Hide must not replace the original display backup with none');
  const shownVisibilitySource = source.patchElementVisibility(hiddenVisibilityTwice, '0', true);
  assert.doesNotMatch(shownVisibilitySource, /\bhidden(?:\s|=|>)/i);
  assert.doesNotMatch(shownVisibilitySource, /\baria-hidden=/i);
  assert.doesNotMatch(shownVisibilitySource, /\bdata-kodety-hidden-display=/i);
  assert.match(
    shownVisibilitySource,
    /\bdisplay:\s*grid(?!\s*!important)/i,
    'Show must restore the exact authored flex/grid display instead of falling back to block',
  );
  assert.match(shownVisibilitySource, /\bgap:\s*24px/i);
  const deeplyNestedVisibilitySource =
    '<!doctype html><html><body><section class="catalog"><article><ul><li><span class="label" style="display:inline !important">Deep child</span></li></ul></article></section></body></html>';
  const hiddenDeepChild = source.patchElementVisibility(deeplyNestedVisibilitySource, '0/0/0/0/0', false);
  assert.equal(hiddenDeepChild.match(/\bhidden="hidden"/gi)?.length, 1, 'Hide on a deeply nested child must affect exactly that child, never its parents');
  assert.match(
    hiddenDeepChild,
    /<section class="catalog"><article><ul><li><span[^>]*hidden="hidden"[^>]*>Deep child<\/span>/i,
    'arbitrary parent depth must preserve the exact source path of the edited child',
  );
  assert.match(
    source.patchElementVisibility(hiddenDeepChild, '0/0/0/0/0', true),
    /<span class="label" style="display:\s*inline">Deep child<\/span>/i,
    'Show must restore a deeply nested inline child without changing any ancestor layout',
  );
  const hiddenSvgChild = source.patchElementVisibility(
    '<!doctype html><html><body><section><svg><g><circle cx="5" cy="5"></circle></g></svg></section></body></html>',
    '0/0/0/0',
    false,
  );
  assert.match(
    hiddenSvgChild,
    /<circle[^>]*hidden="hidden"[^>]*style="display:\s*none"/i,
    'nested SVG descendants must participate in the same universal visibility writer',
  );
  const classImportantHidden = source.patchElementVisibility('<!doctype html><html><body><div class="hero-actions">CTA</div></body></html>', '0', false);
  assert.match(classImportantHidden, /\bstyle="display:\s*none"/i, 'the per-layer Hide override must persist without CSS priority');
  assert.doesNotMatch(
    source.patchElementVisibility(classImportantHidden, '0', true),
    /\bstyle=/i,
    'Show must remove a Hide-only inline override and let the authored class layout resume',
  );
  const inlineDisplayPatched = source.patchElementStyleDeclaration(
    '<!doctype html><html><body><div style="all: initial !important; display: grid !important; color: red"></div></body></html>',
    '0',
    'display',
    'none',
    { authoritative: true },
  );
  assert.match(inlineDisplayPatched, /style="color: red; display: none !important"/i);
  assert.doesNotMatch(inlineDisplayPatched, /\ball\s*:|display:\s*grid/i, 'a generic authoritative display edit must replace conflicts while retaining the edited property priority');
  const inlineLonghandPatched = source.patchElementStyleDeclaration(
    '<!doctype html><html><body><div style="padding: 20px !important; padding-top: 7px; padding-right: 9px"></div></body></html>',
    '0',
    'padding-left',
    '12px',
    { authoritative: true },
  );
  assert.doesNotMatch(inlineLonghandPatched, /\bpadding\s*:/i);
  assert.match(inlineLonghandPatched, /padding-top:\s*7px/i);
  assert.match(inlineLonghandPatched, /padding-right:\s*9px/i);
  assert.match(inlineLonghandPatched, /padding-left:\s*12px(?!\s*!important)/i);

  const breakpoints = [
    { id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 },
    { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 },
  ];
  assert.equal(css.normalizeBreakpointWidth(5200, css.DEFAULT_PRIMARY_BREAKPOINT.width), 5200, 'large primary breakpoint widths must not be silently clamped');
  assert.equal(
    css.normalizeBreakpointWidth('', css.DEFAULT_PRIMARY_BREAKPOINT.width),
    css.DEFAULT_PRIMARY_BREAKPOINT.width,
    'an empty persisted breakpoint width must use its fallback',
  );
  assert.deepEqual(
    css.normalizeBreakpointRegistry([
      { id: 'tablet', label: 'Tablet antigo', width: 810 },
      { id: 'wide', label: '', mode: 'legacy-invalid', width: 2560 },
      { id: 'custom-min', label: 'Custom min', mode: 'min-width', width: 1440 },
    ]),
    [
      { id: 'tablet', label: 'Tablet antigo', mode: 'max-width', width: 810 },
      { id: 'wide', label: 'Wide', mode: 'min-width', width: 2560 },
      { id: 'custom-min', label: 'Custom min', mode: 'min-width', width: 1440 },
    ],
    'legacy responsive registries must never serialize an undefined media-query mode',
  );
  assert.deepEqual(css.normalizeBreakpointRegistry([]), [], 'an intentionally empty responsive registry must not recreate default breakpoints');
  assert.throws(
    () => css.patchCssDeclaration(
      '.card { width: 100%; }',
      {
        target: 'rule',
        selector: '.card',
        cssFilePath: 'styles.css',
        pseudo: 'base',
        breakpoint: 'tablet',
      },
      'width',
      '80%',
      [{ id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 }],
    ),
    /Breakpoint desconhecido: tablet/,
    'an explicitly removed Tablet breakpoint must never be recreated from editor defaults',
  );
  let stylesheet = '.card { color: red; }';
  stylesheet = css.patchCssDeclaration(stylesheet, { ...mobileRule, pseudo: 'base' }, 'gap', '8px', breakpoints);
  stylesheet = css.patchCssDeclaration(stylesheet, { ...mobileRule, pseudo: 'base' }, 'padding', '12px', breakpoints);
  assert.deepEqual(css.readCssRuleDeclarations(stylesheet, { ...mobileRule, pseudo: 'base' }, breakpoints), {
    gap: '8px',
    padding: '12px',
  });
  assert.match(stylesheet, /@media \(max-width: 410px\)/);

  const prioritySource = '.unrelated { display: block !important; }\n.card { color: red !important; background: black; }';
  const priorityPatched = css.patchCssDeclaration(
    prioritySource,
    {
      target: 'rule',
      selector: '.card',
      cssFilePath: 'styles.css',
      pseudo: 'base',
      breakpoint: 'base',
    },
    'background',
    'white !important',
    breakpoints,
  );
  assert.match(priorityPatched, /\.unrelated\s*\{[^}]*display:\s*block\s*!important/i);
  assert.match(priorityPatched, /color:\s*red\s*!important/i);
  assert.match(priorityPatched, /background:\s*white(?!\s*!important)/i);
  const priorityReplaced = css.patchCssDeclaration(
    prioritySource,
    {
      target: 'rule',
      selector: '.card',
      cssFilePath: 'styles.css',
      pseudo: 'base',
      breakpoint: 'base',
    },
    'color',
    'blue !important',
    breakpoints,
  );
  assert.match(priorityReplaced, /color:\s*blue\s*!important/i, 'replacing the exact winning declaration must preserve its authored priority tier');
  assert.match(priorityReplaced, /\.unrelated\s*\{[^}]*display:\s*block\s*!important/i);
  const priorityMigrated = css.patchCssDeclaration(
    '.card {}',
    {
      target: 'rule',
      selector: '.card',
      cssFilePath: 'styles.css',
      pseudo: 'base',
      breakpoint: 'base',
    },
    'display',
    'grid !important',
    breakpoints,
    { preservePriority: true },
  );
  assert.match(priorityMigrated, /display:\s*grid/i);
  assert.doesNotMatch(priorityMigrated, /display:\s*grid\s*!important/i);

  const baseCardContext = {
    target: 'rule',
    selector: '.card',
    cssFilePath: 'styles.css',
    pseudo: 'base',
    breakpoint: 'base',
  };
  const duplicatePrioritySource = ['.card { display: grid !important; gap: 40px !important; }', '.card { display: flex; gap: 20px; }'].join('\n');
  assert.deepEqual(
    css.readCssRuleDeclarations(duplicatePrioritySource, baseCardContext, breakpoints),
    { display: 'grid', gap: '40px' },
    'the rule reader must report the declaration that actually wins, not merely the last AST node',
  );
  let authoritativeClass = css.patchCssDeclaration(duplicatePrioritySource, baseCardContext, 'display', 'none', breakpoints, { authoritative: true });
  authoritativeClass = css.patchCssDeclaration(authoritativeClass, baseCardContext, 'gap', '12px', breakpoints, {
    authoritative: true,
  });
  assert.deepEqual(
    css.readCssRuleDeclarations(authoritativeClass, baseCardContext, breakpoints),
    { display: 'none', gap: '12px' },
    'hide and gap writes must replace the declarations that actually win for the class',
  );
  assert.equal((authoritativeClass.match(/\bdisplay\s*:/gi) || []).length, 2, 'editing one declaration must not erase a shadowed authored duplicate');
  assert.equal(
    (authoritativeClass.match(/\bgap\s*:/gi) || []).length,
    2,
    'editing one declaration must leave the other duplicate block byte-semantically intact',
  );
  assert.match(authoritativeClass, /display:\s*none\s*!important/i);
  assert.match(authoritativeClass, /gap:\s*12px\s*!important/i);
  assert.match(authoritativeClass, /display:\s*flex/i);
  assert.match(authoritativeClass, /gap:\s*20px/i);
  const classConflictSource = [
    '.card { all: revert !important; display: grid !important; row-gap: 48px !important; }',
    '.card { column-gap: 24px; color: red; }',
  ].join('\n');
  let classConflictsRemoved = css.patchCssDeclaration(classConflictSource, baseCardContext, 'display', 'none', breakpoints, { authoritative: true });
  classConflictsRemoved = css.patchCssDeclaration(classConflictsRemoved, baseCardContext, 'gap', '10px', breakpoints, {
    authoritative: true,
  });
  assert.match(classConflictsRemoved, /\ball\s*:\s*revert\s*;/i);
  assert.doesNotMatch(classConflictsRemoved, /\ball\s*:\s*revert\s*!important/i);
  assert.match(classConflictsRemoved, /row-gap:\s*48px\s*;/i);
  assert.doesNotMatch(classConflictsRemoved, /row-gap:\s*48px\s*!important/i);
  assert.match(classConflictsRemoved, /column-gap:\s*24px/i);
  assert.equal((classConflictsRemoved.match(/\bdisplay\s*:/gi) || []).length, 1, 'Hide must update the class declaration already present');
  assert.equal(
    (classConflictsRemoved.match(/(?:^|[;{]\s*)gap\s*:/gim) || []).length,
    1,
    'Gap must add one explicit winner after the shorthand/longhand that owned it',
  );
  assert.match(classConflictsRemoved, /display:\s*none\s*!important/i);
  assert.match(classConflictsRemoved, /gap:\s*10px\s*;/i);
  assert.doesNotMatch(classConflictsRemoved, /gap:\s*10px\s*!important/i);
  assert.match(classConflictsRemoved, /color:\s*red/i);
  const classLonghandPreservesSiblings = css.patchCssDeclaration(
    '.card { padding: 20px !important; padding-top: 3px; padding-right: 4px; }',
    baseCardContext,
    'padding-left',
    '11px',
    breakpoints,
    { authoritative: true },
  );
  assert.match(classLonghandPreservesSiblings, /\bpadding:\s*20px\s*!important\s*;/i);
  assert.match(classLonghandPreservesSiblings, /padding-top:\s*3px/i);
  assert.match(classLonghandPreservesSiblings, /padding-right:\s*4px/i);
  assert.match(classLonghandPreservesSiblings, /padding-left:\s*11px\s*!important\s*;/i);
  assert.equal((classLonghandPreservesSiblings.match(/!important/gi) || []).length, 2,
    'Editing one side must preserve the shorthand priority that still controls the other sides');
  const higherSpecificityAuthority = css.patchCssDeclaration(
    '.shell .card { display: grid !important; }\n.card { color: red; }',
    baseCardContext,
    'display',
    'none',
    breakpoints,
    { authoritative: true },
  );
  assert.match(higherSpecificityAuthority, /\.shell \.card\s*\{\s*display:\s*grid\s*!important/i);
  assert.match(
    higherSpecificityAuthority,
    /\.card\s*\{[^}]*display:\s*none(?!\s*!important)/i,
    'authority must replace the requested selector without borrowing priority from a different selector',
  );
  assert.doesNotMatch(
    higherSpecificityAuthority,
    /#__kodety_visual_authority_/,
    'visual edits must never synthesize ID specificity that can suppress pseudo states or breakpoints',
  );
  assert.equal(
    css.readCssRuleDeclarations(higherSpecificityAuthority, baseCardContext, breakpoints).display,
    'none',
    'the edited class must remain addressable through its authored selector',
  );
  const tracedMobileContext = {
    ...baseCardContext,
    selector: '.shell .card',
    breakpoint: 'mobile',
  };
  const tracedMobilePriority = css.patchCssDeclaration(
    '.shell .card { width: 233px !important; }',
    tracedMobileContext,
    'width',
    '181px',
    breakpoints,
    { authoritative: true },
  );
  assert.match(tracedMobilePriority, /\.shell \.card\s*\{\s*width:\s*233px\s*;/i);
  assert.match(
    tracedMobilePriority,
    /@media\s*\(max-width:\s*410px\)[\s\S]*?\.shell \.card\s*\{[^}]*width:\s*181px\s*;/i,
    'a Mobile 410 edit must create an equally authoritative override for the browser-traced winning selector',
  );
  assert.doesNotMatch(tracedMobilePriority, /!\s*important|#__kodety_visual_authority_/i);
  const tracedDesktopOwner = css.inspectCssRuleAtViewport(
    tracedMobilePriority,
    { ...baseCardContext, selector: '.shell .card' },
    'width',
    1920,
    breakpoints,
  ).propertyOwner;
  assert.equal(tracedDesktopOwner?.value, '233px');
  assert.equal(tracedDesktopOwner?.important, false);
  const tracedMobileInspection = css.inspectCssRuleAtViewport(
    tracedMobilePriority,
    tracedMobileContext,
    'width',
    410,
    breakpoints,
  );
  assert.equal(
    tracedMobileInspection.propertyOwner?.value,
    '181px',
    'the traced Mobile declaration must become the real viewport winner, not only an Inspector-local value',
  );
  assert.equal(tracedMobileInspection.propertyOwner?.important, false);
  assert.equal(tracedMobileInspection.propertyOwnerBelongsToBreakpoint, true);

  const cursorTokenCascade = css.patchCssDeclaration(
    [
      ':root { --interactive-cursor: pointer; }',
      '.unrelated { cursor: auto !important; }',
      '.card:hover { cursor: grab; }',
      '@media (max-width: 810px) { .card { cursor: crosshair; } }',
    ].join('\n'),
    baseCardContext,
    'cursor',
    'var(--interactive-cursor)',
    breakpoints,
    { authoritative: true },
  );
  assert.match(cursorTokenCascade, /:root\s*\{[^}]*--interactive-cursor:\s*pointer/i);
  assert.match(cursorTokenCascade, /\.unrelated\s*\{[^}]*cursor:\s*auto\s*!important/i);
  assert.match(
    cursorTokenCascade,
    /\.card\s*\{[^}]*cursor:\s*var\(--interactive-cursor\)(?!\s*!important)/i,
    'an unrelated priority must not contaminate an authored cursor/token declaration',
  );
  assert.match(cursorTokenCascade, /\.card:hover\s*\{[^}]*cursor:\s*grab/i);
  assert.ok(
    cursorTokenCascade.indexOf('.card {') < cursorTokenCascade.indexOf('@media (max-width: 810px)'),
    'a newly created base rule must be inserted before responsive overrides',
  );
  assert.equal(
    css.readCssRuleDeclarations(cursorTokenCascade, baseCardContext, breakpoints).cursor,
    'var(--interactive-cursor)',
    'the Inspector must read the authored token reference that the canvas can resolve to pointer',
  );

  const legacyGuard = ':not(#__kodety_visual_authority_a#__kodety_visual_authority_b#__kodety_visual_authority_c#__kodety_visual_authority_d)';
  const legacyAuthorityHealed = css.patchCssDeclaration(
    `.card${legacyGuard} { color: red; cursor: pointer; }\n.card:hover { cursor: grab; }`,
    baseCardContext,
    'color',
    'blue',
    breakpoints,
    { authoritative: true },
  );
  assert.doesNotMatch(legacyAuthorityHealed, /#__kodety_visual_authority_/);
  assert.match(legacyAuthorityHealed, /\.card\s*\{[^}]*color:\s*blue[^}]*cursor:\s*pointer/i);
  assert.match(legacyAuthorityHealed, /\.card:hover\s*\{[^}]*cursor:\s*grab/i);

  const mobileCardContext = { ...baseCardContext, breakpoint: 'mobile' };
  let responsiveAuthority = [
    '@media (max-width:410px) { .card { display: flex; gap: 24px; } }',
    '.card { display: grid !important; gap: 48px !important; }',
    '@media (max-width: 410px) { .card { display: block; gap: 32px; } }',
  ].join('\n');
  responsiveAuthority = css.patchCssDeclaration(responsiveAuthority, mobileCardContext, 'display', 'none', breakpoints, { authoritative: true });
  responsiveAuthority = css.patchCssDeclaration(responsiveAuthority, mobileCardContext, 'gap', '8px', breakpoints, {
    authoritative: true,
  });
  assert.deepEqual(
    css.readCssRuleDeclarations(responsiveAuthority, mobileCardContext, breakpoints),
    { display: 'none', gap: '8px' },
    'equivalent duplicate media wrappers must be treated as one breakpoint cascade',
  );
  assert.deepEqual(
    css.readInheritedCssRuleDeclarations(responsiveAuthority, mobileCardContext, 410, breakpoints),
    { display: 'grid', gap: '48px' },
    'the active breakpoint must be excluded from its inherited base values',
  );
  assert.equal(
    responsiveAuthority,
    [
      '@media (max-width:410px) { .card { display: flex; gap: 24px; } }',
      '.card { display: grid; gap: 48px; }',
      '@media (max-width: 410px) { .card { display: none; gap: 8px; } }',
    ].join('\n'),
  );
  assert.doesNotMatch(responsiveAuthority, /!\s*important/i);
  for (const [breakpoint, width, expected] of [
    ['base', 1920, { display: 'grid', gap: '48px' }],
    ['mobile', 410, { display: 'none', gap: '8px' }],
  ]) {
    for (const property of ['display', 'gap']) {
      const inspection = css.inspectCssRuleAtViewport(
        responsiveAuthority,
        { ...baseCardContext, breakpoint },
        property,
        width,
        breakpoints,
      );
      assert.equal(inspection.propertyOwner?.value, expected[property]);
      assert.equal(inspection.propertyOwner?.important, false);
      assert.equal(inspection.propertyOwnerBelongsToBreakpoint, true);
    }
  }
  assert.ok(
    responsiveAuthority.lastIndexOf('@media') > responsiveAuthority.lastIndexOf('.card { display: grid'),
    'simple breakpoint wrappers must remain after base rules so equal-priority responsive edits win',
  );

  let responsiveHierarchy = css.patchCssDeclaration('', baseCardContext, 'opacity', '1', breakpoints, { authoritative: true });
  responsiveHierarchy = css.patchCssDeclaration(responsiveHierarchy, mobileCardContext, 'opacity', '0.35', breakpoints, { authoritative: true });
  assert.equal(
    css.readCssRuleDeclarations(responsiveHierarchy, baseCardContext, breakpoints).opacity,
    '1',
    'a child breakpoint override must never replace the Primary declaration',
  );
  assert.equal(
    css.readCssRuleDeclarations(responsiveHierarchy, mobileCardContext, breakpoints).opacity,
    '0.35',
    'the child breakpoint must retain only its own override',
  );
  responsiveHierarchy = css.patchCssDeclaration(responsiveHierarchy, mobileCardContext, 'opacity', '', breakpoints, { authoritative: true });
  assert.equal(
    css.readCssRuleDeclarations(responsiveHierarchy, mobileCardContext, breakpoints).opacity,
    undefined,
    'clearing a child override must restore inheritance instead of copying Primary into the child',
  );
  assert.equal(
    css.readInheritedCssRuleDeclarations(responsiveHierarchy, mobileCardContext, 410, breakpoints).opacity,
    '1',
    'a child without its own value must inherit the Primary declaration',
  );

  const pseudoWithSelectorFunction = css.patchCssDeclaration(
    '',
    {
      ...baseCardContext,
      selector: ':is(.card, .tile), [data-label="a,b"]',
      pseudo: 'hover',
    },
    'display',
    'none',
    breakpoints,
    { authoritative: true },
  );
  assert.match(pseudoWithSelectorFunction, /:is\(\.card, \.tile\):hover/);
  assert.match(pseudoWithSelectorFunction, /\[data-label="a,b"\]:hover/);
  assert.doesNotMatch(pseudoWithSelectorFunction, /#__kodety_visual_authority_/, 'pseudo-state rules must keep their authored specificity');

  const overlappingBreakpoints = [
    ...breakpoints,
    { id: 'overlap-max', label: 'Overlap max', mode: 'max-width', width: 900 },
    { id: 'overlap-min', label: 'Overlap min', mode: 'min-width', width: 600 },
  ];
  const overlappingSource = [
    '@media (max-width: 900px) { .card { color: tomato; } }',
    '.between-ranges { color: rebeccapurple; }',
    '@media (min-width: 600px) { .card { color: royalblue; } }',
  ].join('\n');
  const overlappingPatched = css.patchCssDeclaration(
    overlappingSource,
    { ...baseCardContext, breakpoint: 'overlap-max' },
    'color',
    'salmon',
    overlappingBreakpoints,
    { authoritative: true },
  );
  const maxRangeIndex = overlappingPatched.indexOf('@media (max-width: 900px)');
  const betweenRangeIndex = overlappingPatched.indexOf('.between-ranges');
  const minRangeIndex = overlappingPatched.indexOf('@media (min-width: 600px)');
  assert.ok(
    maxRangeIndex >= 0 && maxRangeIndex < betweenRangeIndex && betweenRangeIndex < minRangeIndex,
    'editing a max-width rule must preserve the authored order of overlapping min/max ranges',
  );
  assert.match(overlappingPatched, /@media \(max-width: 900px\)[\s\S]*?color:\s*salmon/);
  assert.match(overlappingPatched, /@media \(min-width: 600px\)[\s\S]*?color:\s*royalblue/);

  const overlappingWidthPatched = css.patchBreakpointMediaQueries(overlappingSource, overlappingBreakpoints.slice(-2), [
    {
      id: 'overlap-max',
      label: 'Overlap max',
      mode: 'max-width',
      width: 850,
    },
    overlappingBreakpoints.at(-1),
  ]);
  assert.ok(
    overlappingWidthPatched.indexOf('@media (max-width: 850px)') < overlappingWidthPatched.indexOf('.between-ranges') &&
      overlappingWidthPatched.indexOf('.between-ranges') < overlappingWidthPatched.indexOf('@media (min-width: 600px)'),
    'resizing a breakpoint must not globally sort media wrappers or alter an overlapping cascade',
  );

  const breakpointPriority = css.patchBreakpointMediaQueries(
    '@media (max-width: 410px) { .card { color: red !important; } }',
    [{ id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 }],
    [{ id: 'mobile', label: 'Mobile', mode: 'max-width', width: 420 }],
  );
  assert.match(breakpointPriority, /@media \(max-width: 420px\)/);
  assert.match(breakpointPriority, /color:\s*red\s*!important/i);

  assert.equal(visualStyles.normalizeVisualCssValue('backgrounds', 'backgroundPosition', 'left-top'), 'left top');
  assert.equal(visualStyles.normalizeVisualCssValue('backgrounds', 'backgroundRepeat', 'repeat-round'), 'round');
  assert.equal(visualStyles.normalizeVisualCssValue('sizing', 'gridColumnSpan', 'full'), '1 / -1');
  assert.equal(visualStyles.normalizeVisualCssValue('sizing', 'gridRowSpan', '3'), 'span 3');
  assert.equal(visualStyles.normalizeVisualCssValue('transforms', 'transformOrigin', 'bottom-right'), 'bottom right');
  assert.equal(visualStyles.normalizeVisualCssValue('transitions', 'easing', 'in-out'), 'ease-in-out');
  assert.equal(visualStyles.normalizeVisualCssValue('typography', 'fontFamily', 'sans'), 'ui-sans-serif, system-ui, sans-serif');
  assert.equal(
    visualStyles.controlFontFamilyToCss('sans'),
    'ui-sans-serif, system-ui, sans-serif',
    'font variables must store browser-valid CSS rather than an editor-only font token',
  );
  assert.equal(visualStyles.cssFontFamilyToControl('ui-serif, Georgia, serif'), 'serif');
  assert.equal(
    visualStyles.replaceCssFunctions('brightness(1.1) blur(3px) drop-shadow(0 2px 3px rgb(0 0 0 / 40%))', 'blur', 'blur(12px)'),
    'brightness(1.1) drop-shadow(0 2px 3px rgb(0 0 0 / 40%)) blur(12px)',
  );
  assert.equal(
    visualStyles.replaceCssFunctions('perspective(500px) skewX(4deg) rotate(2deg)', ['skew', 'skewX', 'skewY'], ''),
    'perspective(500px) rotate(2deg)',
  );
  assert.equal(visualStyles.replaceCssFunctions('none', 'blur', 'blur(8px)'), 'blur(8px)');
  assert.deepEqual(
    visualStyles.releaseCenteredPositionAnchor('-50% -50%', 'rotate(8deg) scale(1.1)', {
      horizontal: true,
      vertical: true,
    }),
    {
      translate: '0 0',
      transform: 'rotate(8deg) scale(1.1)',
      translateChanged: true,
      transformChanged: false,
    },
    'left/bottom pins must attach the element edges instead of retaining a centered translate anchor',
  );
  assert.deepEqual(
    visualStyles.releaseCenteredPositionAnchor('', 'translate(-50%, -50%) rotate(8deg) scale(1.1)', {
      horizontal: true,
      vertical: false,
    }),
    {
      translate: '',
      transform: 'translate(0, -50%) rotate(8deg) scale(1.1)',
      translateChanged: false,
      transformChanged: true,
    },
    'pinning one axis must release only that center anchor and preserve the other axis and transforms',
  );
  assert.deepEqual(
    visualStyles.releaseCenteredPositionAnchor('12px -50%', 'translateX(24px) translateY(-50%) rotate(4deg)', {
      horizontal: true,
      vertical: true,
    }),
    {
      translate: '12px 0',
      transform: 'translateX(24px) rotate(4deg)',
      translateChanged: true,
      transformChanged: true,
    },
    'edge pinning must preserve intentional pixel translations while removing only ±50% centering compensation',
  );

  assert.equal(sizingValues.sizingValueMode('width', '72%'), 'relative');
  assert.equal(sizingValues.sizingValueMode('maxHeight', '[35%]'), 'relative');
  assert.equal(sizingValues.sizingValueMode('width', '72% !important'), 'relative');
  assert.equal(sizingValues.cssSizingValueToControl('fit-content ! important'), 'fit');
  assert.equal(sizingValues.cssSizingValueToControl('stretch!important'), 'fill');
  assert.equal(
    sizingValues.cssSizingValueToControl('calc(100% - 2rem) !important'),
    'calc(100% - 2rem)',
    'cleaning priority must preserve significant whitespace in authored CSS functions',
  );
  assert.equal(sizingValues.normalizeSizingInputForMode('width', 'relative', '64'), '64%', 'editing a Relative value must preserve percentage semantics');
  assert.equal(sizingValues.normalizeSizingInputForMode('maxHeight', 'relative', '42px'), '42%', 'min/max Relative controls must not silently fall back to px');
  assert.equal(
    sizingValues.normalizeSizingInputForMode('width', 'relative', '8%0%'),
    '80%',
    'legacy inline percentage suffixes must be repaired instead of duplicated',
  );
  assert.deepEqual(
    sizingValues.sizingValueForEditing('width', 'relative', '80%'),
    { draft: '80', unit: '%' },
    'a focused Relative input must keep its suffix outside the editable draft',
  );
  assert.equal(sizingValues.commitSizingEditValue('width', 'relative', '8', '%'), '8%');
  assert.equal(sizingValues.commitSizingEditValue('width', 'relative', '80', '%'), '80%', 'typing 8 then 0 must commit 80%, never 8%0%');
  assert.deepEqual(
    sizingValues.sizingValueForEditing('height', 'fixed', '12rem'),
    { draft: '12', unit: 'rem' },
    'focused fixed measurements must retain their authored unit',
  );
  assert.equal(sizingValues.commitSizingEditValue('height', 'fixed', '24', 'rem'), '24rem', 'the retained fixed unit must survive the final commit');
  assert.equal(
    sizingValues.commitSizingEditValue('height', 'fixed', '50vw', 'rem'),
    '50vw',
    'an explicitly pasted unit must replace, rather than concatenate with, the retained unit',
  );
  assert.equal(sizingValues.normalizeSizingInputForMode('height', 'fixed', '42'), '42');
  assert.equal(sizingValues.normalizeSizingInputForMode('width', 'fit', '900'), 'fit');
  assert.equal(sizingValues.normalizeSizingInputForMode('height', 'fill', '900'), 'fill');
  assert.equal(sizingValues.normalizeSizingInputForMode('minWidth', 'screen', '900'), '100vw');
  assert.equal(sizingValues.normalizeSizingInputForMode('minHeight', 'screen', '900'), '100svh');

  for (const [property, controlValue, cssValue] of [
    ['width', 'fit', 'fit-content'],
    ['height', 'fit', 'fit-content'],
    ['width', 'fill', 'stretch'],
    ['height', 'fill', 'stretch'],
  ]) {
    const authored = sizingValues.sizingControlValueToCss(property, controlValue);
    assert.equal(authored, cssValue);
    assert.equal(sizingValues.cssSizingValueToControl(authored), controlValue, `${controlValue} must survive a source reload/rebuild`);
    assert.equal(sizingValues.sizingValueMode(property, authored), controlValue, `${controlValue} mode must survive reconstruction from CSS`);
  }
  assert.equal(sizingValues.cssSizingValueToControl('-webkit-fill-available'), 'fill');
  const sizingControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/components/SizingControls.tsx'), 'utf8');
  assert.match(
    sizingControlsSource,
    /const SIZING_VALUE_PRESET_GRID = ["']grid min-w-0 grid-cols-2 gap-1["']/,
    'the authored value and sizing mode must receive equal, readable columns',
  );
  assert.equal(sizingControlsSource.match(/\{renderSizingField\(\{/g)?.length, 2, 'Width and Height must remain the only two unconditional sizing rows');
  for (const property of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
    assert.match(
      sizingControlsSource,
      new RegExp(`isOptionalSizingPropertyVisible\\(["']${property}["']\\)\\s*&&\\s*renderSizingField\\(\\{`),
      `${property} must only render when it is authored or explicitly added`,
    );
  }
  assert.match(
    sizingControlsSource,
    /function hasMeaningfulSizingConstraint[\s\S]*?property === ["']minWidth["'] \|\| property === ["']minHeight["'][\s\S]*?\^0/,
    'computed zero min-size defaults must not pollute the inspector',
  );
  assert.match(
    sizingControlsSource,
    /\.filter\(\(property\) => !isOptionalSizingPropertyVisible\(property\)\)/,
    'the Add menu must list only missing size constraints',
  );
  assert.doesNotMatch(
    sizingControlsSource,
    /repeat\(auto-fit,\s*minmax/,
    'sizing constraints must not reshuffle into inconsistent columns as the inspector width changes',
  );
  assert.match(
    sizingControlsSource,
    /value=\{sizingInputValue\(property, inputValue\)\}[\s\S]*?sizingInputUnit\(property\)/,
    'every sizing input must render its retained unit separately from its focused draft',
  );
  assert.match(
    sizingControlsSource,
    /onBlur=\{\(event\) =>[\s\S]*?finishSizingEdit\([\s\S]*?property,[\s\S]*?setInput,[\s\S]*?event\.currentTarget\.value,[\s\S]*?\)[\s\S]*?\}/,
    'focused sizing drafts must commit the latest DOM value on blur instead of a stale React render',
  );
  assert.match(
    sizingControlsSource,
    /const activeSizingEditsRef = useRef[\s\S]*?activeSizingEditsRef\.current\[property\] = edit[\s\S]*?const draft = domDraft === undefined \? edit\.draft : domDraft/,
    'same-task focus, type, and Enter events must share a synchronous sizing transaction',
  );
  assert.match(
    sizingControlsSource,
    /const \[pendingSizingCommits, setPendingSizingCommits\][\s\S]*?pendingSizingCommitsRef[\s\S]*?externalSizingValues\[property\][\s\S]*?cssSizingValueToControl\([\s\S]*?sizingControlValueToCss\(property, value \|\| ["']["']\)[\s\S]*?retainPendingSizingCommit\(property, value\)/,
    'a stale computed canvas width must not replace the authored Relative value before source reconstruction confirms it',
  );
  assert.match(
    sizingControlsSource,
    /aria-label=\{`\$\{ariaLabel\} value`\}[\s\S]*?aria-label=\{`\$\{ariaLabel\} preset`\}/,
    'the shared row must preserve stable value and preset names for browser E2E',
  );
  for (const property of ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
    const handlerName = `handle${property.replace(/^./, value => value.toUpperCase())}PresetChange`;
    const handler = sizingControlsSource.match(new RegExp(`const ${handlerName} = \\(value: string\\) => \\{([\\s\\S]*?)\\n  \\};`))?.[1] || '';
    assert.ok(handler, `${property} must retain its preset handler`);
    assert.match(
      handler,
      new RegExp(`commitMeasurementProperty\\(["']${property}["'],`),
      `${property} mode changes must enter the pending canonical commit guard`,
    );
    assert.doesNotMatch(handler, /updateDesignProperty\(/, `${property} presets must not bypass the pending canonical commit guard`);
  }
  assert.match(
    sizingControlsSource,
    /const commitMeasurementProperty[\s\S]*?cancelPendingDesignProperties\(\[property\]\)[\s\S]*?retainPendingSizingCommit\(property, value\)[\s\S]*?updateDesignProperty\(["']sizing["'], property, value\)/,
    'every measurement preset must cancel stale writes, retain its value and commit synchronously',
  );
  const borderControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/components/BorderControls.tsx'), 'utf8');
  const popoverUiSource = await readFile(path.join(root, 'components/ui/popover.tsx'), 'utf8');
  const designSyncSource = await readFile(path.join(root, 'hooks/use-design-sync.ts'), 'utf8');
  assert.match(
    popoverUiSource,
    /panelTitle\?: React\.ReactNode[\s\S]*?dark:bg-\[#161616\][\s\S]*?dark:border-white\/\[0\.18\][\s\S]*?data-slot="popover-panel-title"/,
    'floating property panels must use the darker surface and render a persistent title area',
  );
  assert.match(
    popoverUiSource,
    /align=\{align \?\? \(panelTitle \? 'start' : 'center'\)\}[\s\S]*?side=\{side \?\? \(panelTitle \? 'left' : 'bottom'\)\}[\s\S]*?sideOffset=\{sideOffset \?\? \(panelTitle \? 12 : 4\)\}[\s\S]*?collisionPadding=\{collisionPadding \?\? \(panelTitle \? 12 : undefined\)\}/,
    'property panels must open beside the Design sidebar with a collision-safe viewport margin',
  );
  assert.match(
    popoverUiSource,
    /data-slot=input[\s\S]*?!border-white\/\[0\.18\][\s\S]*?data-slot=input-group[\s\S]*?!border-white\/\[0\.18\][\s\S]*?data-slot=select-trigger[\s\S]*?!border-white\/\[0\.18\]/,
    'fields inside floating panels must use the stronger shared stroke',
  );
  assert.match(
    borderControlsSource,
    /panelTitle="Border"[\s\S]*?panelTitle="Dividers"[\s\S]*?panelTitle="Outline"/,
    'every Borders floating editor must identify the property being adjusted',
  );
  const individualBorderWidthSource =
    borderControlsSource.match(/widthModeToggle\.mode === ["']individual["'][\s\S]*?borderLeftWidthInput[\s\S]*?>\s*Left\s*<\/Label>/)?.[0] || '';
  assert.equal(
    (individualBorderWidthSource.match(/flex flex-col items-center gap-1/g) || []).length,
    4,
    'Top, Right, Bottom and Left border-width fields must use identical centered alignment',
  );
  assert.doesNotMatch(individualBorderWidthSource, /flex flex-col items-start gap-1/, 'the Top border-width field must not retain a unique corner alignment');
  assert.match(sizingControlsSource, /panelTitle="Object position"/, 'the object-position floating editor must identify its property');
  assert.match(
    designSyncSource,
    /const cancelPendingDesignProperties = useCallback\([\s\S]*?debouncedFnMapRef\.current\.get\(property\)\?\.cancel\(\)/,
    'semantic field mode changes must be able to cancel stale per-property writes',
  );
  assert.match(
    borderControlsSource,
    /const radiusInputValues[\s\S]*?getCurrentValue:\s*\(prop: string\)\s*=>[\s\S]*?radiusInputValues\[prop\][\s\S]*?const handleRadiusModeToggle = \(\) => \{[\s\S]*?cancelPendingDesignProperties\(radiusProperties\)[\s\S]*?radiusModeToggle\.handleToggle\(\)/,
    'linking equal corner radii must use the current local drafts and atomically cancel queued corner writes',
  );
  assert.match(borderControlsSource, /onModeToggle=\{handleRadiusModeToggle\}/, 'the radius link button must use the guarded atomic mode transition');
  assert.match(
    borderControlsSource,
    /outlineStyle\.trim\(\)\.toLowerCase\(\) !== ["']none["'][\s\S]*?property: ["']outlineStyle["'], value: ["']solid["'][\s\S]*?property: ["']outlineStyle["'], value: null/,
    'computed outline defaults must stay hidden until Outline is explicitly added from the Borders menu',
  );
  const atomicRadiusChange = visualStyles.resolveAtomicHtmlBorderRadiusChange({
    borderRadiusMode: 'all',
    borderRadius: '12px',
    borderTopLeftRadius: undefined,
    borderTopRightRadius: undefined,
    borderBottomRightRadius: undefined,
    borderBottomLeftRadius: undefined,
  });
  assert.deepEqual(
    atomicRadiusChange,
    {
      property: 'border-radius',
      values: ['12px'],
      consumedDesignProperties: ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
    },
    'linking individual corners must collapse to one HTML/CSS shorthand command',
  );
  assert.equal(
    visualStyles
      .resolveAtomicHtmlBorderRadiusChange({
        borderRadiusMode: 'individual',
        borderTopLeftRadius: '4px',
        borderTopRightRadius: '8px',
        borderBottomRightRadius: '12px',
        borderBottomLeftRadius: '16px',
      })
      ?.values.join(' '),
    '4px 8px 12px 16px',
    'expanding a radius must remain one atomic shorthand write',
  );
  const radiusAfterAtomicLink = styles.writeStyleDeclaration(
    {
      'border-top-left-radius': '12px !important',
      'border-top-right-radius': '12px !important',
      'border-bottom-right-radius': '12px !important',
      'border-bottom-left-radius': '12px !important',
    },
    atomicRadiusChange.property,
    atomicRadiusChange.values.join(' '),
    { authoritative: true },
  );
  assert.deepEqual(
    radiusAfterAtomicLink,
    { 'border-radius': '12px' },
    'the atomic radius shorthand must replace all authored corner declarations without being erased afterwards',
  );
  const htmlKodetyStyleControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlKodetyStyleControls.tsx'), 'utf8');
  assert.match(
    htmlKodetyStyleControlsSource,
    /resolveAtomicHtmlBorderRadiusChange\(nextCategory, currentCategory\)[\s\S]*?onChange\([\s\S]*?atomicBorderRadiusChange\.property[\s\S]*?atomicBorderRadiusChange\.consumedDesignProperties\.includes/,
    'the HTML design adapter must consume linked radius properties as one source mutation',
  );
  assert.equal(
    visualStyles.resolveAtomicHtmlBorderRadiusChange({ borderRadiusMode: 'all', borderRadius: '12px' }, { borderRadiusMode: 'all', borderRadius: '12px' }),
    null,
    'an unrelated design update must not rewrite border radius',
  );
  assert.equal(
    visualStyles
      .resolveAtomicHtmlGapChange({
        gapMode: 'individual',
        rowGap: '8px',
        columnGap: '16px',
      })
      ?.values.join(' '),
    '8px 16px',
    'unlinking gap axes must remain one atomic shorthand write',
  );
  assert.equal(
    visualStyles.resolveAtomicHtmlGapChange({ gapMode: 'all', gap: '12px' }, { gapMode: 'all', gap: '12px' }),
    null,
    'an unrelated design update must not rewrite gap',
  );

  const sharedBreakpoints = [
    { id: 'compact-a', label: 'Compact A', mode: 'max-width', width: 600 },
    { id: 'compact-b', label: 'Compact B', mode: 'max-width', width: 600 },
  ];
  const sharedMedia = '@media (max-width: 600px) { .card { color: tomato; } }';
  const sharedAfterDelete = css.patchBreakpointMediaQueries(sharedMedia, sharedBreakpoints, [sharedBreakpoints[0]]);
  assert.match(sharedAfterDelete, /@media \(max-width: 600px\)/);
  assert.match(sharedAfterDelete, /color:\s*tomato/);

  const sharedAfterDivergence = css.patchBreakpointMediaQueries(sharedMedia, sharedBreakpoints, [
    sharedBreakpoints[0],
    { ...sharedBreakpoints[1], width: 820 },
  ]);
  assert.match(sharedAfterDivergence, /@media \(max-width: 600px\)/);
  assert.match(sharedAfterDivergence, /@media \(max-width: 820px\)/);
  assert.equal((sharedAfterDivergence.match(/color:\s*tomato/g) || []).length, 2);

  const project = {
    name: 'test',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 0,
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: html },
    },
  };

  const repairedLocalization = localization.normalizeLocalization({
    version: 1,
    sourceLocale: 'pt-BR',
    defaultLocale: 'en-US',
    automaticLocale: false,
    rememberLocale: true,
    translatePagePaths: false,
    includePathsInAi: false,
    locales: [
      { ...localization.createLocale('pt-BR'), enabled: false },
      {
        ...localization.createLocale('en-US'),
        enabled: false,
        fallback: 'fr-FR',
      },
      { ...localization.createLocale('es-ES'), fallback: 'en-US' },
    ],
    translations: {},
  });
  assert.equal(repairedLocalization.locales.find(locale => locale.code === 'pt-BR')?.enabled, true, 'the source locale must remain publishable');
  assert.equal(repairedLocalization.defaultLocale, 'pt-BR', 'a disabled locale cannot own the unprefixed public URL');
  assert.equal(
    repairedLocalization.locales.find(locale => locale.code === 'en-US')?.fallback,
    'pt-BR',
    'a removed fallback must be repaired to the source locale',
  );
  assert.equal(
    repairedLocalization.locales.find(locale => locale.code === 'es-ES')?.fallback,
    'pt-BR',
    'a disabled fallback must be repaired to the source locale',
  );
  assert.equal(repairedLocalization.version, 3, 'legacy localization metadata must be upgraded to the default-on v3 contract');
  assert.equal(repairedLocalization.automaticLocale, true, 'legacy false defaults must migrate to automatic routing enabled');
  const spanishSiteLanguage = localization.setLocalizationSiteLanguage(
    localization.normalizeLocalization({
      ...localization.defaultLocalization('pt-BR'),
      locales: [localization.createLocale('pt-BR'), localization.createLocale('it-IT')],
    }),
    'es',
  );
  assert.equal(spanishSiteLanguage.sourceLocale, 'es-ES', 'changing the site language must replace the authored source locale');
  assert.equal(spanishSiteLanguage.defaultLocale, 'es-ES', 'compact Site Settings language codes must select the canonical public locale');
  assert.equal(
    spanishSiteLanguage.locales.find(locale => locale.code === 'es-ES')?.name,
    'Español (España)',
    'the selected Site Settings language must use the canonical source locale',
  );
  assert.equal(
    spanishSiteLanguage.locales.some(locale => locale.code === 'pt-BR'),
    false,
    'the previous implicit source must not survive as a phantom configured locale',
  );
  assert.equal(
    spanishSiteLanguage.locales.find(locale => locale.code === 'it-IT')?.fallback,
    'es-ES',
    'configured target locales must fall back to the new authored source',
  );
  const legacyLocalizedSource = '<!doctype html><html><head></head><body><p>Base copy</p><img src="/base.jpg" alt="Base alt"></body></html>';
  const legacyLocalizedSettings = localization.normalizeLocalization({
    version: 1,
    sourceLocale: 'pt-BR',
    defaultLocale: 'pt-BR',
    automaticLocale: false,
    rememberLocale: true,
    translatePagePaths: false,
    includePathsInAi: false,
    locales: [localization.createLocale('pt-BR'), localization.createLocale('en-US')],
    translations: {
      'en-US': {
        pages: {
          'index.html': {
            entries: {
              'path:0:text': 'Legacy English copy',
              'path:1:attr:alt': 'Legacy English alt',
            },
          },
        },
      },
    },
  });
  assert.match(localization.applyPageTranslations(legacyLocalizedSource, 'index.html', 'en-US', legacyLocalizedSettings), /Legacy English copy/);
  const legacyAnchoredProject = localization.ensureProjectLocalizationIds({
    name: 'Legacy localized',
    mainHtmlPath: 'index.html',
    rootPath: '',
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: legacyLocalizedSource,
      },
    },
  });
  const legacyAnchoredTranslation = localization.applyPageTranslations(
    legacyAnchoredProject.files['index.html'].text,
    'index.html',
    'en-US',
    legacyLocalizedSettings,
  );
  assert.match(legacyAnchoredTranslation, /Legacy English copy/, 'v1 path text must survive structural ID assignment');
  assert.match(legacyAnchoredTranslation, /alt="Legacy English alt"/, 'v1 path attribute translations must survive structural ID assignment');
  assert.equal(
    localization.localizationProgress(legacyAnchoredProject, legacyLocalizedSettings, 'en-US').percent,
    100,
    'v1 path translations must remain counted after migration',
  );

  const authoredLocaleAttributes = {
    class: 'hero',
    style: 'display: grid !important; color: red; padding: 12px',
    'data-source': 'base',
  };
  const hiddenLocaleAttributes = localization.applyLocaleElementOverrideToAttributes(authoredLocaleAttributes, {
    visible: false,
    attributes: {
      'data-source': 'localized',
      title: 'Locale',
      class: null,
    },
    styles: { color: 'blue', padding: null },
  });
  assert.equal(hiddenLocaleAttributes.class, undefined, 'null attribute overrides must remove the authored attribute');
  assert.equal(hiddenLocaleAttributes['data-source'], 'localized');
  assert.equal(hiddenLocaleAttributes['data-kodety-locale-hidden'], '');
  assert.equal(hiddenLocaleAttributes.hidden, 'hidden');
  assert.match(
    hiddenLocaleAttributes.style,
    /display:\s*none(?!\s*!important)/i,
    'locale visibility must remove authored priority and persist its display declaration',
  );
  assert.match(hiddenLocaleAttributes.style, /color:\s*blue(?!\s*!important)/i);
  assert.doesNotMatch(hiddenLocaleAttributes.style, /!\s*important/i);
  assert.doesNotMatch(hiddenLocaleAttributes.style, /padding:/i, 'null style overrides are explicit tombstones');
  const restoredLocaleAttributes = localization.applyLocaleElementOverrideToAttributes(authoredLocaleAttributes, {
    visible: true,
  });
  assert.equal(
    restoredLocaleAttributes.style,
    'display: grid; color: red; padding: 12px',
    'visible:true must restore the authored display without retaining CSS priority',
  );
  assert.equal(restoredLocaleAttributes.hidden, undefined);
  assert.equal(restoredLocaleAttributes['data-kodety-locale-hidden'], undefined);
  const explicitlyRevealedLocaleAttributes = localization.applyLocaleElementOverrideToAttributes(
    {
      hidden: 'hidden',
      'aria-hidden': 'true',
      style: 'display: none !important; color: red',
    },
    { visible: true },
  );
  assert.equal(explicitlyRevealedLocaleAttributes.hidden, undefined);
  assert.equal(explicitlyRevealedLocaleAttributes['aria-hidden'], undefined);
  assert.doesNotMatch(explicitlyRevealedLocaleAttributes.style, /display:/i);
  assert.match(explicitlyRevealedLocaleAttributes.style, /color:\s*red/i);
  const safeLocaleAttributes = localization.applyLocaleElementOverrideToAttributes(
    {
      href: '/base',
      style: 'color: red',
      'data-kodety-l10n-id': 'stable-anchor',
    },
    {
      attributes: {
        id: 'english-hero',
        class: 'localized featured',
        href: 'java&#x73;cript&colon;alert(1)',
        onclick: 'alert(1)',
        srcdoc: '<script>alert(1)</script>',
        style: 'display:none',
        'data-kodety-l10n-id': 'hijacked',
      },
      styles: {
        color: 'blue',
        behavior: 'url(evil.htc)',
        'background-image': 'url(javascript:alert(1))',
      },
    },
  );
  assert.equal(safeLocaleAttributes.id, 'english-hero', 'safe IDs must remain available for locale anchors');
  assert.equal(safeLocaleAttributes.class, 'localized featured', 'safe class lists must remain editable per locale');
  assert.equal(safeLocaleAttributes.href, '/base', 'an unsafe URL override must not replace the authored safe URL');
  assert.equal(safeLocaleAttributes.onclick, undefined);
  assert.equal(safeLocaleAttributes.srcdoc, undefined);
  assert.equal(safeLocaleAttributes['data-kodety-l10n-id'], 'stable-anchor');
  assert.match(safeLocaleAttributes.style, /color:\s*blue(?!\s*!important)/i);
  assert.doesNotMatch(safeLocaleAttributes.style, /!\s*important/i);
  assert.doesNotMatch(safeLocaleAttributes.style, /display:|behavior:|javascript:/i);
  const maxLocaleId = 'i'.repeat(200);
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ id: 'base-id' }, { attributes: { id: maxLocaleId } }).id,
    maxLocaleId,
    'the shared 200-character structural ID limit must be accepted at its boundary',
  );
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ id: 'base-id' }, { attributes: { id: 'i'.repeat(201) } }).id,
    'base-id',
    'IDs beyond the shared 200-character limit must be ignored',
  );
  const maxLocaleClass = 'c'.repeat(2000);
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ class: 'base-class' }, { attributes: { class: maxLocaleClass } }).class,
    maxLocaleClass,
    'the shared 2000-character class limit must be accepted at its boundary',
  );
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ class: 'base-class' }, { attributes: { class: 'c'.repeat(2001) } }).class,
    'base-class',
    'classes beyond the shared 2000-character limit must be ignored',
  );
  const maxMultibyteLocaleId = '😀'.repeat(200);
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ id: 'base-id' }, { attributes: { id: maxMultibyteLocaleId } }).id,
    maxMultibyteLocaleId,
    'locale ID limits must count Unicode points instead of UTF-16 units or UTF-8 bytes',
  );
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ id: 'base-id' }, { attributes: { id: `${maxMultibyteLocaleId}😀` } }).id,
    'base-id',
    'a 201-point multibyte locale ID must be rejected',
  );
  const maxMultibyteLocaleClass = '😀'.repeat(2000);
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ class: 'base-class' }, { attributes: { class: maxMultibyteLocaleClass } }).class,
    maxMultibyteLocaleClass,
    'locale class limits must count Unicode points',
  );
  assert.equal(
    localization.applyLocaleElementOverrideToAttributes({ class: 'base-class' }, { attributes: { class: `${maxMultibyteLocaleClass}😀` } }).class,
    'base-class',
    'a 2001-point multibyte class must be rejected',
  );
  const forgedLocaleAttributes = localization.applyLocaleElementOverrideToAttributes(
    {},
    {
      attributes: {
        'data-kodety-locale-hidden': 'forged',
        'data-kodety-locale-text-root': 'forged',
        'data-kodety-locale-future-marker': 'forged',
      },
    },
  );
  assert.deepEqual(forgedLocaleAttributes, {}, 'no user override may forge any data-kodety-locale-* runtime marker');

  const persistenceBase = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [localization.createLocale('pt-BR'), { ...localization.createLocale('en-US'), fallback: 'pt-BR' }],
    translations: {
      'en-US': {
        pages: {
          'index.html': { entries: {} },
        },
      },
    },
  });
  const persistenceWithPage = page => ({
    ...persistenceBase,
    translations: {
      ...persistenceBase.translations,
      'en-US': {
        ...persistenceBase.translations['en-US'],
        pages: { 'index.html': page },
      },
    },
  });
  const limitCases = [
    {
      name: 'attributes',
      limit: localization.LOCALIZATION_PERSISTENCE_LIMITS.attributesPerOverride,
      candidate: count =>
        persistenceWithPage({
          entries: {},
          overrides: {
            'id:target': {
              attributes: Object.fromEntries(Array.from({ length: count }, (_, index) => [`data-value-${index}`, 'ok'])),
            },
          },
        }),
    },
    {
      name: 'styles',
      limit: localization.LOCALIZATION_PERSISTENCE_LIMITS.stylesPerOverride,
      candidate: count =>
        persistenceWithPage({
          entries: {},
          overrides: {
            'id:target': {
              styles: Object.fromEntries(Array.from({ length: count }, (_, index) => [`--value-${index}`, '1px'])),
            },
          },
        }),
    },
    {
      name: 'insertions',
      limit: localization.LOCALIZATION_PERSISTENCE_LIMITS.insertionsPerPage,
      candidate: count =>
        persistenceWithPage({
          entries: {},
          insertions: Array.from({ length: count }, (_, index) => ({
            id: `section-${index}`,
            anchor: 'body',
            position: 'append',
            html: '<div>ok</div>',
          })),
        }),
    },
    {
      name: 'overrides',
      limit: localization.LOCALIZATION_PERSISTENCE_LIMITS.overridesPerPage,
      candidate: count =>
        persistenceWithPage({
          entries: {},
          overrides: Object.fromEntries(Array.from({ length: count }, (_, index) => [`id:target-${index}`, { visible: true }])),
        }),
    },
  ];
  limitCases.forEach(({ name, limit, candidate }) => {
    assert.equal(localization.validateLocalizationForPersistence(candidate(limit)).valid, true, `${name} must be accepted at the exact persistence limit`);
    assert.equal(localization.validateLocalizationForPersistence(candidate(limit + 1)).valid, false, `${name} must fail atomically at N+1`);
  });
  const maxUtf8Payload = '😀'.repeat(localization.LOCALIZATION_PERSISTENCE_LIMITS.scalarBytes / 4);
  assert.equal(
    localization.validateLocalizationForPersistence(persistenceWithPage({ entries: { 'id:target:text': maxUtf8Payload } })).valid,
    true,
    'a multibyte scalar at the exact UTF-8 byte limit must pass',
  );
  assert.equal(
    localization.validateLocalizationForPersistence(
      persistenceWithPage({
        entries: { 'id:target:text': `${maxUtf8Payload}a` },
      }),
    ).valid,
    false,
    'scalar persistence limits must use UTF-8 bytes',
  );
  const maxUtf8Style = 'é'.repeat(localization.LOCALIZATION_PERSISTENCE_LIMITS.styleValueBytes / 2);
  assert.equal(
    localization.validateLocalizationForPersistence(
      persistenceWithPage({
        entries: {},
        overrides: { 'id:target': { styles: { color: maxUtf8Style } } },
      }),
    ).valid,
    true,
    'a style at the exact UTF-8 byte limit must pass',
  );
  assert.equal(
    localization.validateLocalizationForPersistence(
      persistenceWithPage({
        entries: {},
        overrides: { 'id:target': { styles: { color: `${maxUtf8Style}a` } } },
      }),
    ).valid,
    false,
    'style persistence limits must reject the first UTF-8 byte beyond N',
  );
  const exactAttributeSettings = limitCases[0].candidate(limitCases[0].limit);
  const exactAttributeSnapshot = JSON.stringify(exactAttributeSettings);
  assert.throws(
    () =>
      localization.updateLocaleElementOverride(exactAttributeSettings, 'en-US', 'index.html', 'id:target', {
        attributes: { 'data-over-limit': 'no' },
      }),
    /não foi salva|limite/i,
    'a mutation that crosses a persistence limit must throw before commit',
  );
  assert.equal(JSON.stringify(exactAttributeSettings), exactAttributeSnapshot, 'a rejected localization mutation must not mutate the current candidate');
  const oversizedLoadCandidate = persistenceWithPage({
    entries: { 'id:target:text': `${maxUtf8Payload}a` },
  });
  assert.doesNotThrow(
    () => localization.normalizeLocalization(oversizedLoadCandidate),
    'loading/normalization must remain permissive so invalid legacy metadata can be repaired',
  );

  const structuralSource =
    '<!doctype html><html lang="pt-BR"><head><title>Base</title></head><body><section data-kodety-l10n-id="hero" style="display: grid !important"><picture><source data-kodety-l10n-id="hero-source" srcset="/base.webp 2x" sizes="50vw"><img data-kodety-l10n-id="hero-image" src="/base.jpg" srcset="/base-2x.jpg 2x" sizes="50vw"></picture><p data-kodety-l10n-id="copy">Base copy</p></section><footer data-kodety-l10n-id="footer">Footer</footer></body></html>';
  const structuralSettings = localization.normalizeLocalization({
    version: 2,
    sourceLocale: 'pt-BR',
    defaultLocale: 'pt-BR',
    automaticLocale: false,
    rememberLocale: true,
    translatePagePaths: false,
    includePathsInAi: false,
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('fr-FR'), fallback: 'pt-BR' },
      { ...localization.createLocale('en-US'), fallback: 'fr-FR' },
    ],
    translations: {
      'fr-FR': {
        pages: {
          'index.html': {
            entries: { 'id:copy:text': 'Texte français' },
            overrides: {
              'id:hero': { visible: false },
            },
            insertions: [
              {
                id: 'promo',
                anchor: 'id:hero',
                position: 'after',
                html: '<aside class="promo-a">Promo A<img data-kodety-l10n-id="promo-image" src="/fallback-promo.jpg"></aside><aside class="promo-b">Promo B</aside>',
              },
              {
                id: 'before-footer',
                anchor: 'id:footer',
                position: 'before',
                html: '<div>Avant 1</div><div>Avant 2</div>',
              },
            ],
          },
        },
      },
      'en-US': {
        siteTitle: 'English site',
        pages: {
          'index.html': {
            entries: { 'id:copy:text': 'English copy' },
            overrides: {
              // The direct locale explicitly restores source visibility over
              // the fallback locale and localizes only this image.
              'id:hero': { visible: true },
              'id:hero-image': {
                attributes: { src: '/english.jpg', srcset: null },
                styles: { 'object-position': 'center top' },
              },
              'id:promo-image': {
                attributes: { src: '/english-promo.jpg' },
              },
              // This legacy path must resolve before the prepended insertion
              // changes the body child indexes.
              'path:1': { attributes: { 'data-path-still-footer': 'yes' } },
              'insertion:promo': { attributes: { 'data-locale-only': 'yes' } },
            },
            insertions: [
              {
                id: 'lead',
                anchor: 'body',
                position: 'prepend',
                html: '<nav>Locale navigation</nav>',
              },
              {
                id: 'safe-fragment',
                anchor: 'body',
                position: 'append',
                html: '<section data-kodety-l10n-id="hero" data-kodety-locale-insertion="forged" data-kodety-locale-insertion-owner="forged" onclick="alert(1)"><a href="java&#x73;cript&colon;alert(1)" style="background-image:url(javascript:alert(2))">Safe text</a><i data-kodety-l10n-id="promo-image">Collision</i><b data-kodety-l10n-id="unique-local">One</b><b data-kodety-l10n-id="unique-local">Two</b><img src="vbscript:alert(1)"><script>alert(1)</script><base href="https://evil.invalid/"><object data="x"></object><embed src="x"></section>',
              },
            ],
          },
        },
      },
    },
  });
  const poisonedSourceSettings = localization.normalizeLocalization({
    ...structuralSettings,
    translations: {
      ...structuralSettings.translations,
      'pt-BR': {
        pages: {
          'index.html': {
            entries: { 'id:copy:text': 'Payload must be ignored' },
            overrides: { 'id:hero': { visible: false } },
            insertions: [
              {
                id: 'source-poison',
                anchor: 'body',
                position: 'append',
                html: '<aside>Source payload must be ignored</aside>',
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(
    localization.applyPageTranslations(structuralSource, 'index.html', 'pt-BR', poisonedSourceSettings),
    structuralSource,
    'the authored source locale must ignore every translation/override/insertion payload',
  );
  assert.equal(
    localization.updateLocaleElementOverride(structuralSettings, 'pt-BR', 'index.html', 'id:hero', { visible: false }),
    structuralSettings,
    'the authored source locale must never be converted into an override payload',
  );
  const helperOverrideSettings = localization.updateLocaleElementOverride(structuralSettings, 'en-US', 'index.html', 'id:footer', {
    attributes: { title: 'English footer' },
  });
  assert.equal(helperOverrideSettings.translations['en-US'].pages['index.html'].overrides['id:footer'].attributes.title, 'English footer');
  const helperResetSettings = localization.removeLocaleElementOverride(helperOverrideSettings, 'en-US', 'index.html', 'id:footer');
  assert.equal(
    helperResetSettings.translations['en-US'].pages['index.html'].overrides['id:footer'],
    undefined,
    'resetting one direct override must resume fallback inheritance',
  );
  const promotedInsertionSettings = localization.upsertLocaleInsertion(structuralSettings, 'en-US', 'index.html', {
    ...localization.resolveLocalizationPage(structuralSettings, 'en-US', 'index.html').insertions.find(insertion => insertion.id === 'promo'),
    html: '<aside>Promoted English promo</aside>',
  });
  assert.equal(
    localization.resolveLocalizationPage(promotedInsertionSettings, 'en-US', 'index.html').insertions.find(insertion => insertion.id === 'promo').html,
    '<aside>Promoted English promo</aside>',
    'editing a fallback section must promote a direct locale copy',
  );
  const canonicalizedUpsertSettings = localization.upsertLocaleInsertion(structuralSettings, 'en-US', 'index.html', {
    id: 'canonical-save',
    anchor: 'body',
    position: 'append',
    html: '<script>unsafe()</script><p>Persisted safely</p>',
  });
  assert.equal(
    canonicalizedUpsertSettings.translations['en-US'].pages['index.html'].insertions.find(insertion => insertion.id === 'canonical-save').html,
    '<p>Persisted safely</p>',
    'the shared upsert boundary must never persist an unsanitized active locale fragment',
  );
  const emptyUpsertSettings = localization.upsertLocaleInsertion(structuralSettings, 'en-US', 'index.html', {
    id: 'empty-save',
    anchor: 'body',
    position: 'append',
    html: '',
  });
  assert.equal(
    emptyUpsertSettings.translations['en-US'].pages['index.html'].insertions.find(insertion => insertion.id === 'empty-save').html,
    '',
    'canonical persistence must preserve an intentionally empty active insertion',
  );
  const removedPromotedInsertionSettings = localization.removeLocaleInsertion(promotedInsertionSettings, 'en-US', 'index.html', 'promo');
  assert.equal(
    localization.resolveLocalizationPage(removedPromotedInsertionSettings, 'en-US', 'index.html').insertions.some(insertion => insertion.id === 'promo'),
    false,
    'removing a promoted/fallback insertion must persist a direct tombstone',
  );
  assert.equal(removedPromotedInsertionSettings.translations['en-US'].pages['index.html'].insertions.find(insertion => insertion.id === 'promo').removed, true);
  const structuralEnglish = localization.applyPageTranslations(structuralSource, 'index.html', 'en-US', structuralSettings);
  assert.match(structuralEnglish, /<html[^>]*lang="en-US"[^>]*dir="ltr"/);
  assert.match(structuralEnglish, /<title>English site<\/title>/);
  assert.match(structuralEnglish, /<p[^>]*>English copy<\/p>/);
  assert.match(structuralEnglish, /src="\/english\.jpg"/);
  assert.doesNotMatch(structuralEnglish, /\bsrcset=/, 'a localized image must remove stale img and picture source candidates');
  assert.doesNotMatch(structuralEnglish, /\bsizes=/, 'a localized image must remove stale responsive sizing candidates');
  assert.match(
    structuralEnglish,
    /data-kodety-l10n-id="promo-image"[^>]*src="\/english-promo\.jpg"/,
    'a unique stable child ID inside an inherited insertion must remain overrideable',
  );
  assert.match(structuralEnglish, /object-position:\s*center top(?!\s*!important)/);
  assert.doesNotMatch(structuralEnglish, /!\s*important/i);
  assert.doesNotMatch(
    structuralEnglish,
    /data-kodety-l10n-id="hero"[^>]*(?:data-kodety-locale-hidden|\shidden=|display:\s*none)/,
    'visible:true must override a hidden fallback and restore the authored base display',
  );
  assert.match(structuralEnglish, /data-kodety-l10n-id="footer"[^>]*data-path-still-footer="yes"/);
  assert.ok(
    structuralEnglish.indexOf('Locale navigation') < structuralEnglish.indexOf('data-kodety-l10n-id="hero"'),
    'body prepend must be applied without changing which base node a path override targets',
  );
  assert.ok(structuralEnglish.indexOf('Promo A') < structuralEnglish.indexOf('Promo B'), 'multiple roots in one locale insertion must retain source order');
  assert.ok(
    structuralEnglish.indexOf('Avant 1') < structuralEnglish.indexOf('Avant 2') &&
      structuralEnglish.indexOf('Avant 2') < structuralEnglish.indexOf('data-kodety-l10n-id="footer"'),
    'multiple before roots must retain source order',
  );
  assert.equal(
    (structuralEnglish.match(/data-kodety-locale-insertion="promo"/g) || []).length,
    2,
    'every top-level insertion root must carry the stable locale insertion marker',
  );
  assert.equal((structuralEnglish.match(/data-locale-only="yes"/g) || []).length, 2, 'an insertion override must apply to every root owned by the insertion');
  assert.equal(
    localization.localeElementKeyForPath(structuralEnglish, '2'),
    'insertion:promo',
    'selection inside locale-only content must resolve back to its insertion contract',
  );
  assert.match(structuralEnglish, />Safe text<\/a>/, 'safe locale-only content must survive sanitization');
  assert.doesNotMatch(structuralEnglish, /onclick=|javascript:|vbscript:/i);
  assert.doesNotMatch(structuralEnglish, /<(?:script|base|object|embed)\b/i);
  assert.equal(
    (structuralEnglish.match(/data-kodety-l10n-id="hero"/g) || []).length,
    1,
    'a locale insertion must never duplicate the stable ID of a base element',
  );
  assert.equal(
    (structuralEnglish.match(/data-kodety-l10n-id="promo-image"/g) || []).length,
    1,
    'stable IDs must not collide across separate locale insertion payloads',
  );
  assert.equal(
    (structuralEnglish.match(/data-kodety-l10n-id="unique-local"/g) || []).length,
    1,
    'duplicate stable IDs inside one locale insertion must retain only their first owner',
  );
  assert.doesNotMatch(structuralEnglish, /data-kodety-locale-insertion-(?:owner|forged)=/i);
  assert.match(
    structuralEnglish,
    /<section[^>]*data-kodety-locale-insertion="safe-fragment"/,
    'forged markers must be replaced by the insertion owner assigned by runtime',
  );

  const metadataFallbackSource =
    '<!doctype html><html><head><title>Base title</title><meta name="description" content="Base description"></head><body></body></html>';
  const metadataFallbackSettings = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
      { ...localization.createLocale('fr-FR'), fallback: 'en-US' },
      { ...localization.createLocale('de-DE'), fallback: 'en-US' },
    ],
    translations: {
      'en-US': {
        siteTitle: 'English global title',
        siteDescription: 'English global description',
        pages: {
          'index.html': {
            title: 'English page title',
            description: 'English page description',
            entries: {},
          },
        },
      },
      'fr-FR': {
        siteTitle: 'Titre global français',
        siteDescription: 'Description globale française',
        pages: {},
      },
      'de-DE': { pages: {} },
    },
  });
  const metadataFallbackFrench = localization.applyPageTranslations(metadataFallbackSource, 'index.html', 'fr-FR', metadataFallbackSettings);
  assert.match(
    metadataFallbackFrench,
    /<title>English page title<\/title>/,
    'page metadata anywhere in the fallback chain must beat current-locale global metadata',
  );
  assert.match(metadataFallbackFrench, /content="English page description"/);
  const metadataFallbackGerman = localization.applyPageTranslations(metadataFallbackSource, 'metadata-only.html', 'de-DE', metadataFallbackSettings);
  assert.match(
    metadataFallbackGerman,
    /<title>English global title<\/title>/,
    'global metadata must resolve through the locale fallback chain when no page value exists',
  );
  assert.match(metadataFallbackGerman, /content="English global description"/);

  const duplicateDocumentIdSource =
    '<!doctype html><html><head></head><body><section id="shared-id" data-kodety-l10n-id="first"></section><section id="kept-id" data-kodety-l10n-id="second"></section></body></html>';
  const duplicateDocumentIdSettings = localization.normalizeLocalization({
    ...persistenceBase,
    translations: {
      'en-US': {
        pages: {
          'index.html': {
            entries: {},
            overrides: {
              'id:second': { attributes: { id: 'shared-id' } },
            },
            insertions: [
              {
                id: 'duplicate-id-fragment',
                anchor: 'body',
                position: 'append',
                html: '<aside id="shared-id">Duplicate insertion ID</aside>',
              },
            ],
          },
        },
      },
    },
  });
  const duplicateDocumentIdEnglish = localization.applyPageTranslations(duplicateDocumentIdSource, 'index.html', 'en-US', duplicateDocumentIdSettings);
  assert.equal(
    (duplicateDocumentIdEnglish.match(/\bid="shared-id"/g) || []).length,
    1,
    'runtime defense must never create a duplicate document ID from overrides or insertions',
  );
  assert.match(
    duplicateDocumentIdEnglish,
    /id="kept-id"[^>]*data-kodety-l10n-id="second"/,
    'a colliding localized ID override must leave the authored target ID intact',
  );

  const englishPage = structuralSettings.translations['en-US'].pages['index.html'];
  const explicitPictureSourceSettings = localization.normalizeLocalization({
    ...structuralSettings,
    translations: {
      ...structuralSettings.translations,
      'en-US': {
        ...structuralSettings.translations['en-US'],
        pages: {
          ...structuralSettings.translations['en-US'].pages,
          'index.html': {
            ...englishPage,
            overrides: {
              'id:hero-source': {
                attributes: { srcset: '/english.webp 2x', sizes: '100vw' },
              },
              ...englishPage.overrides,
            },
          },
        },
      },
    },
  });
  const explicitPictureSourceEnglish = localization.applyPageTranslations(structuralSource, 'index.html', 'en-US', explicitPictureSourceSettings);
  assert.match(
    explicitPictureSourceEnglish,
    /<source[^>]*srcset="\/english\.webp 2x"[^>]*sizes="100vw"/,
    'an explicit locale override on a picture source must survive img candidate neutralization',
  );
  const imgSrcsetOnlySettings = localization.normalizeLocalization({
    ...structuralSettings,
    translations: {
      ...structuralSettings.translations,
      'en-US': {
        ...structuralSettings.translations['en-US'],
        pages: {
          ...structuralSettings.translations['en-US'].pages,
          'index.html': {
            ...englishPage,
            overrides: {
              ...englishPage.overrides,
              'id:hero-image': {
                attributes: { srcset: '/english-only-2x.jpg 2x' },
              },
            },
          },
        },
      },
    },
  });
  const imgSrcsetOnlyEnglish = localization.applyPageTranslations(structuralSource, 'index.html', 'en-US', imgSrcsetOnlySettings);
  assert.match(imgSrcsetOnlyEnglish, /srcset="\/english-only-2x\.jpg 2x"/);
  assert.doesNotMatch(imgSrcsetOnlyEnglish, /\/base\.webp/, 'changing only img.srcset must neutralize stale picture/source candidates too');

  const structuralFrench = localization.applyPageTranslations(structuralSource, 'index.html', 'fr-FR', structuralSettings);
  assert.match(structuralFrench, /data-kodety-locale-hidden=""/);
  assert.match(structuralFrench, /display:\s*none(?!\s*!important)/);
  assert.doesNotMatch(structuralFrench, /!\s*important/i);
  assert.match(structuralFrench, /src="\/base\.jpg"/, 'image overrides must remain isolated to their locale');

  const shorthandPrecedenceSettings = localization.normalizeLocalization({
    ...structuralSettings,
    translations: {
      ...structuralSettings.translations,
      'fr-FR': {
        pages: {
          'index.html': {
            entries: {},
            overrides: {
              'id:hero': {
                styles: {
                  'padding-left': '80px',
                  padding: '12px',
                },
              },
            },
          },
        },
      },
      'en-US': {
        pages: {
          'index.html': {
            entries: {},
            overrides: {
              'id:hero': {
                styles: { 'padding-left': '24px' },
              },
            },
          },
        },
      },
    },
  });
  const shorthandPrecedenceEnglish = localization.applyPageTranslations(structuralSource, 'index.html', 'en-US', shorthandPrecedenceSettings);
  assert.match(shorthandPrecedenceEnglish, /padding-left:\s*24px(?!\s*!important)/i);
  assert.doesNotMatch(shorthandPrecedenceEnglish, /!\s*important/i);
  assert.doesNotMatch(
    shorthandPrecedenceEnglish,
    /padding:\s*12px/i,
    'a direct locale longhand must remove an inherited shorthand regardless of object key order',
  );

  const insertionTombstoneSettings = localization.normalizeLocalization({
    ...structuralSettings,
    translations: {
      ...structuralSettings.translations,
      'en-US': {
        pages: {
          'index.html': {
            entries: {},
            insertions: [
              {
                id: 'promo',
                anchor: 'body',
                position: 'append',
                html: '',
                removed: true,
              },
            ],
          },
        },
      },
    },
  });
  const tombstonedPage = localization.resolveLocalizationPage(insertionTombstoneSettings, 'en-US', 'index.html');
  assert.equal(
    tombstonedPage.insertions.some(insertion => insertion.id === 'promo'),
    false,
    'a direct removed tombstone must suppress a fallback insertion',
  );
  assert.equal(
    tombstonedPage.insertions.some(insertion => insertion.id === 'before-footer'),
    true,
    'unrelated fallback insertions must remain intact',
  );

  const duplicateInsertions = localization.mergeLocalizationInsertions(
    [],
    [
      { id: 'same', anchor: 'body', position: 'append', html: '<p>First</p>' },
      { id: 'other', anchor: 'body', position: 'append', html: '<p>Other</p>' },
      { id: 'same', anchor: 'body', position: 'append', html: '<p>Last</p>' },
    ],
  );
  assert.deepEqual(
    duplicateInsertions.map(({ id, html }) => [id, html]),
    [
      ['same', '<p>Last</p>'],
      ['other', '<p>Other</p>'],
    ],
    'duplicate insertion IDs must use the last valid value without moving their first position',
  );
  assert.deepEqual(
    localization
      .mergeLocalizationInsertions(duplicateInsertions, [
        {
          id: 'same',
          anchor: 'body',
          position: 'append',
          html: '',
          removed: true,
        },
      ])
      .map(({ id }) => id),
    ['other'],
    'a last-write tombstone must deterministically remove exactly one duplicate insertion ID',
  );

  const unsafeBeforeEditable = '<script>badRoot()</script><section><script>badChild()</script><p data-kodety-l10n-id="editable">Editable</p></section>';
  const canonicalInsertionHtml = localization.canonicalizeLocalizationInsertionHtml(unsafeBeforeEditable);
  assert.doesNotMatch(canonicalInsertionHtml, /<script|badRoot|badChild/i);
  assert.match(
    canonicalInsertionHtml,
    /^<section><p data-kodety-l10n-id="editable">Editable<\/p><\/section>$/,
    'canonical insertion HTML must remove unsafe siblings before the editor stores structural paths',
  );
  assert.match(
    source.patchElementAttribute(canonicalInsertionHtml, '0/0', 'title', 'Edited after sanitization'),
    /<p[^>]*title="Edited after sanitization"[^>]*>Editable<\/p>/,
    'a path from sanitized preview must mutate the same editable descendant in canonical storage',
  );
  assert.equal(
    localization.canonicalizeLocalizationInsertionHtml('Standalone locale text'),
    '<span data-kodety-locale-text-root="1">Standalone locale text</span>',
    'canonical storage must give a meaningful top-level text node a selectable element root',
  );
  assert.equal(
    localization.canonicalizeLocalizationInsertionHtml('<section data-kodety-locale-hidden="forged" data-kodety-locale-future="forged">Safe</section>'),
    '<section>Safe</section>',
    'canonical insertion storage must strip every forged data-kodety-locale-* marker',
  );
  assert.equal(
    localization.canonicalizeLocalizationInsertionHtml(canonicalInsertionHtml),
    canonicalInsertionHtml,
    'canonical insertion normalization must be idempotent across editor and persistence boundaries',
  );

  const insertionGraphSource = '<!doctype html><html><head></head><body><main data-kodety-l10n-id="root">Base</main></body></html>';
  const insertionGraphSettings = localization.normalizeLocalization({
    version: 2,
    sourceLocale: 'pt-BR',
    defaultLocale: 'pt-BR',
    automaticLocale: false,
    rememberLocale: true,
    translatePagePaths: false,
    includePathsInAi: false,
    locales: [localization.createLocale('pt-BR'), localization.createLocale('en-US')],
    translations: {
      'en-US': {
        pages: {
          'index.html': {
            entries: {},
            overrides: {
              'insertion:text-root': {
                attributes: { title: 'Owned text root' },
              },
            },
            insertions: [
              {
                id: 'child',
                anchor: 'insertion:parent',
                position: 'append',
                html: '<strong>Dependent child</strong>',
              },
              {
                id: 'parent',
                anchor: 'id:root',
                position: 'after',
                html: '<section>Parent insertion</section>',
              },
              {
                id: 'cycle-a',
                anchor: 'insertion:cycle-b',
                position: 'append',
                html: '<i>Cycle A must not render</i>',
              },
              {
                id: 'cycle-b',
                anchor: 'insertion:cycle-a',
                position: 'append',
                html: '<i>Cycle B must not render</i>',
              },
              {
                id: 'missing',
                anchor: 'id:does-not-exist',
                position: 'after',
                html: '<i>Missing anchor must not render</i>',
              },
              {
                id: 'duplicate',
                anchor: 'body',
                position: 'append',
                html: '<p>Duplicate first value</p>',
              },
              {
                id: 'text-root',
                anchor: 'body',
                position: 'append',
                html: 'Locale-only text root',
              },
              {
                id: 'duplicate',
                anchor: 'body',
                position: 'append',
                html: '<p>Duplicate last value</p>',
              },
              {
                id: 'disabled',
                anchor: 'body',
                position: 'append',
                html: '<p>Disabled insertion must not render</p>',
                enabled: false,
              },
              {
                id: 'x'.repeat(201),
                anchor: 'body',
                position: 'append',
                html: '<p>Oversized insertion ID</p>',
              },
            ],
          },
        },
      },
    },
  });
  const insertionGraphEnglish = localization.applyPageTranslations(insertionGraphSource, 'index.html', 'en-US', insertionGraphSettings);
  assert.match(
    insertionGraphEnglish,
    /<section[^>]*data-kodety-locale-insertion="parent"[^>]*>Parent insertion<strong[^>]*data-kodety-locale-insertion="child"[^>]*>Dependent child<\/strong><\/section>/,
    'out-of-order insertion dependencies must resolve in deterministic retry passes',
  );
  assert.doesNotMatch(
    insertionGraphEnglish,
    /Cycle [AB] must not render|Missing anchor must not render|Disabled insertion must not render/,
    'cycles and missing anchors must be discarded when a retry pass makes no progress',
  );
  assert.doesNotMatch(insertionGraphEnglish, /Duplicate first value/);
  assert.equal(
    (insertionGraphEnglish.match(/Duplicate last value/g) || []).length,
    1,
    'duplicate insertion IDs must render only their canonical last-write value',
  );
  assert.match(
    insertionGraphEnglish,
    /<span[^>]*data-kodety-locale-text-root="1"[^>]*data-kodety-locale-insertion="text-root"[^>]*title="Owned text root"[^>]*>Locale-only text root<\/span>/,
    'a meaningful top-level text insertion must be normalized to an owned, overrideable element',
  );
  assert.equal(
    localization.localeElementKeyForPath(insertionGraphEnglish, '3'),
    'insertion:text-root',
    'selection on a normalized text root must resolve to its insertion owner',
  );
  assert.doesNotMatch(insertionGraphEnglish, /Oversized insertion ID/, 'insertion IDs beyond the shared structural limit must be ignored');

  const anchorProject = {
    ...project,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head></head><body><section></section><img><div data-kodety-l10n-id="kept"></div><span data-kodety-l10n-id="kept"></span><script><div></div></script></body></html>',
      },
    },
  };
  const anchoredProject = localization.ensureProjectLocalizationIds(anchorProject);
  const anchoredHtml = anchoredProject.files['index.html'].text;
  assert.match(anchoredHtml, /<section[^>]*data-kodety-l10n-id=/, 'empty structural sections need stable locale IDs');
  assert.match(anchoredHtml, /<img[^>]*data-kodety-l10n-id=/, 'media without alt text needs a stable locale ID');
  assert.equal(
    (anchoredHtml.match(/data-kodety-l10n-id="kept"/g) || []).length,
    1,
    'duplicate authored locale IDs must be repaired while preserving the first owner',
  );
  assert.equal(localization.ensureProjectLocalizationIds(anchoredProject), anchoredProject, 'stable locale ID assignment must be idempotent');

  const transportMetadata = {
    version: 1,
    localization: {
      ...structuralSettings,
      version: 1,
    },
  };
  const transportProject = {
    ...anchorProject,
    files: {
      ...anchorProject.files,
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify(transportMetadata),
      },
    },
  };
  const preparedTransport = projectIo.prepareProjectForTransport(transportProject);
  assert.equal(
    projectIo.readEditorMetadata(preparedTransport).localization.version,
    3,
    'preview/export/publish transport must always emit the normalized v3 localization contract',
  );
  assert.match(
    preparedTransport.files['index.html'].text,
    /data-kodety-l10n-id=/,
    'transport must guarantee structural anchors even for legacy projects that were never reopened in localization UI',
  );
  assert.equal(projectIo.updateTextFile(project, 'index.html', html), project);
  const authorCss = '.hero { display: grid !important; }';
  const projectWithStyles = {
    ...project,
    files: {
      ...project.files,
      'styles.css': { path: 'styles.css', mimeType: 'text/css', text: '' },
    },
  };
  const updatedProject = projectIo.updateTextFile(projectWithStyles, 'styles.css', authorCss);
  assert.equal(updatedProject.files['styles.css'].text, authorCss);
  assert.equal(projectIo.sanitizeProjectPriorities(updatedProject), updatedProject);
  const importedAuthorFile = await projectIo.fileToProjectFile('styles.css', new Blob([authorCss], { type: 'text/css' }));
  assert.equal(importedAuthorFile.text, authorCss);
  const priorityArchive = await JSZip.loadAsync(await (await projectIo.projectToZipBlob(updatedProject)).arrayBuffer());
  assert.equal(await priorityArchive.file('styles.css').async('string'), authorCss);

  const legacyPriorityProject = {
    ...project,
    files: {
      ...project.files,
      'index.html': {
        ...project.files['index.html'],
        text: '<style>.hero{display:grid!important}</style><main style="margin: 0 ! important">!important remains ordinary text</main><aside style=display:none!important>Legacy</aside>',
      },
      'styles.css': {
        path: 'styles.css',
        mimeType: 'text/css',
        text: '.hero { display: grid !important; color: red!important }',
      },
      'script.js': {
        path: 'script.js',
        mimeType: 'text/javascript',
        text: 'const message = "!important is ordinary JavaScript text";',
      },
    },
  };
  const legacyPriorityProjectWithMetadata = projectIo.updateEditorMetadata(legacyPriorityProject, metadata => ({
    ...metadata,
    components: [
      {
        id: 'legacy-card',
        name: 'Legacy card',
        variants: [
          {
            id: 'default',
            name: 'Default',
            markup: '<article style="display:grid!important">Card</article>',
          },
        ],
        interactions: [],
        props: [],
      },
    ],
    customCode: {
      version: 1,
      entries: [
        {
          id: 'legacy-css',
          name: 'Legacy CSS',
          code: '.card{color:red!important}',
          placement: 'head-end',
          scope: 'all',
          pages: [],
          run: 'once',
          language: 'css',
          enabled: true,
        },
        {
          id: 'legacy-js',
          name: 'Legacy JS',
          code: 'console.log("!important")',
          placement: 'body-end',
          scope: 'all',
          pages: [],
          run: 'once',
          language: 'javascript',
          enabled: true,
        },
      ],
    },
  }));
  const preservedLegacyPriorityProject = projectIo.sanitizeProjectPriorities(legacyPriorityProjectWithMetadata);
  assert.equal(
    preservedLegacyPriorityProject.files['index.html'].text,
    legacyPriorityProjectWithMetadata.files['index.html'].text,
    'opening a project must preserve embedded and inline authored CSS byte-for-byte',
  );
  assert.equal(
    preservedLegacyPriorityProject.files['styles.css'].text,
    legacyPriorityProjectWithMetadata.files['styles.css'].text,
    'opening a project must preserve stylesheet priority and formatting',
  );
  assert.equal(
    preservedLegacyPriorityProject.files['script.js'].text,
    legacyPriorityProjectWithMetadata.files['script.js'].text,
    'opening a project must preserve authored JavaScript byte-for-byte',
  );
  const preservedPriorityMetadata = projectIo.readEditorMetadata(preservedLegacyPriorityProject);
  assert.match(preservedPriorityMetadata.customCode.entries[0].code, /!\s*important/i);
  assert.match(preservedPriorityMetadata.customCode.entries[1].code, /!important/);
  assert.match(
    preservedLegacyPriorityProject.files['index.html'].text,
    /<aside style=display:none!important>Legacy<\/aside>/,
    'opening a project must preserve unquoted inline CSS priority',
  );

  const withoutPriority = {
    ...project,
    files: {
      'index.html': {
        ...project.files['index.html'],
        text: '<style>.hero{display:grid}</style>',
      },
    },
  };
  const withPriority = {
    ...project,
    files: {
      'index.html': {
        ...project.files['index.html'],
        text: '<style>.hero{display:grid!important}</style>',
      },
    },
  };
  assert.notEqual(
    await cssIntegrity.projectCssDigest(withoutPriority),
    await cssIntegrity.projectCssDigest(withPriority),
    'integrity digest must detect priority-only code changes',
  );

  const generation = 'canvas-generation-current';
  const runtimeAssetBatchRequest = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-runtime-assets-request',
    paths: ['assets/hero.webp', 'assets/logo.svg', 'assets/hero.webp'],
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(runtimeAssetBatchRequest, generation),
    true,
    'a bounded runtime asset batch must cross the canvas protocol',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...runtimeAssetBatchRequest,
        paths: ['assets/hero.webp', '../secret.txt'],
      },
      generation,
    ),
    false,
    'runtime asset batches must reject traversal paths',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...runtimeAssetBatchRequest, paths: [] }, generation),
    false,
    'empty runtime asset batches must be rejected',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...runtimeAssetBatchRequest,
        paths: Array.from({ length: 1025 }, (_, index) => `asset-${index}.png`),
      },
      generation,
    ),
    false,
    'runtime asset batches must be capped before the parent allocates transfer buffers',
  );
  assert.notEqual(
    canvasProtocol.canvasPreviewScrollOwnerKey({
      projectId: 'project-a',
      openedAt: 10,
      rootPath: '',
      mainHtmlPath: 'index.html',
    }),
    canvasProtocol.canvasPreviewScrollOwnerKey({
      projectId: 'project-a',
      openedAt: 10,
      rootPath: '',
      mainHtmlPath: 'about.html',
    }),
    'scroll restoration must be scoped to the current project page',
  );
  assert.notEqual(
    canvasProtocol.canvasPreviewScrollOwnerKey({
      projectId: 'project-a',
      openedAt: 10,
      rootPath: '',
      mainHtmlPath: 'index.html',
    }),
    canvasProtocol.canvasPreviewScrollOwnerKey({
      projectId: 'project-b',
      openedAt: 10,
      rootPath: '',
      mainHtmlPath: 'index.html',
    }),
    'scroll restoration must not leak between projects that share the same entry path',
  );
  assert.equal(
    canvasProtocol.canvasPreviewScrollOwnerKey({
      projectId: 'project-a',
      openedAt: 10,
      rootPath: '',
      mainHtmlPath: 'index.html',
    }),
    canvasProtocol.canvasPreviewScrollOwnerKey({
      projectId: 'project-a',
      openedAt: 999,
      rootPath: 'changed-locally',
      mainHtmlPath: 'index.html',
    }),
    'canonical reloads of an identified project page must keep the same scroll owner',
  );
  const compactStyleJournal = new Map();
  compactStyleJournal.set('0\u0000margin-top', {
    revision: 1,
    patch: { property: 'margin-top', value: '4px' },
  });
  compactStyleJournal.set('0\u0000margin', {
    revision: 2,
    patch: { property: 'margin', value: '8px' },
  });
  compactStyleJournal.set('0\u0000margin-top', {
    revision: 3,
    patch: { property: 'margin-top', value: '12px' },
  });
  assert.deepEqual(
    canvasProtocol.sortCanvasJournalEntriesByRevision(compactStyleJournal.values()).map(entry => `${entry.revision}:${entry.patch.property}`),
    ['2:margin', '3:margin-top'],
    'compacted shorthand/longhand patches must replay by revision instead of stale Map insertion order',
  );
  const compactAttributeJournal = new Map();
  compactAttributeJournal.set('0\u0000aria-label', {
    revision: 4,
    patch: { name: 'aria-label' },
  });
  compactAttributeJournal.set('0\u0000class', {
    revision: 5,
    patch: { name: 'class' },
  });
  compactAttributeJournal.set('0\u0000aria-label', {
    revision: 6,
    patch: { name: 'aria-label' },
  });
  assert.deepEqual(
    canvasProtocol.sortCanvasJournalEntriesByRevision(compactAttributeJournal.values()).map(entry => `${entry.revision}:${entry.patch.name}`),
    ['5:class', '6:aria-label'],
    'compacted attribute patches must also replay in canonical revision order',
  );
  const selection = {
    path: '0/2',
    tag: 'section',
    id: 'hero',
    classes: ['hero', 'is-active'],
    attributes: { class: 'hero is-active', 'aria-label': 'Hero' },
    text: '',
    hasElementChildren: true,
    computedStyle: { display: 'grid', gap: '16px' },
    styleOrigins: {
      width: {
        selector: '.hero.is-active',
        cssPath: 'css/layout.css',
        property: 'width',
        important: true,
        inline: false,
      },
      'padding-left': {
        selector: '',
        cssPath: '',
        property: 'padding',
        important: true,
        inline: true,
      },
      color: {
        selector: '.hero',
        cssPath: '',
        property: 'color',
        important: false,
        inline: false,
      },
    },
    parentDisplay: 'inline-grid',
    parentPosition: 'relative',
  };
  const selectionMessage = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-selection',
    breakpointId: 'mobile',
    payload: selection,
    // Secondary selections intentionally carry only paths; sending every
    // computed-style snapshot was the dominant multi-select bridge payload.
    selectedPaths: ['0/1', '0/2'],
    revision: 17,
  });
  assert.equal(canvasProtocol.isCanvasToEditorMessage(selectionMessage, generation), true);
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      Object.fromEntries(Object.entries(selectionMessage).filter(([key]) => key !== 'breakpointId')),
      generation,
    ),
    false,
    'a selection without its physical canvas breakpoint must be rejected',
  );
  assert.equal(canvasProtocol.isCanvasToEditorMessage(selectionMessage, 'stale-generation'), false);
  const invalidStyleOrigins = [
    { width: { ...selection.styleOrigins.width, extra: true } },
    { width: { ...selection.styleOrigins.width, important: 'yes' } },
    { width: { ...selection.styleOrigins.width, cssPath: '../outside.css' } },
    { width: { ...selection.styleOrigins.width, cssPath: 'https://example.com/layout.css' } },
    { width: { ...selection.styleOrigins.width, cssPath: 'css/layout.scss' } },
    { width: { ...selection.styleOrigins.width, selector: '' } },
    { width: { ...selection.styleOrigins.width, inline: true } },
    { 'width;display': selection.styleOrigins.width },
    { width: { ...selection.styleOrigins.width, property: 'width;color' } },
  ];
  invalidStyleOrigins.forEach((styleOrigins, index) => {
    assert.equal(
      canvasProtocol.isCanvasToEditorMessage({
        ...selectionMessage,
        payload: { ...selection, styleOrigins },
      }, generation),
      false,
      `selection style origin fixture ${index + 1} must fail strict protocol validation`,
    );
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({
      ...selectionMessage,
      payload: { ...selection, styleOrigins: [] },
    }, generation),
    false,
    'selection style origins must be a bounded property-to-origin record',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({
      ...selectionMessage,
      selectionSequence: 1,
      detail: 'identity',
      origin: 'canvas',
    }, generation),
    true,
    'direct canvas selections must carry a validated origin marker',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...selectionMessage, origin: 'unknown' }, generation),
    false,
    'selection origin must reject values outside the canvas/editor protocol',
  );
  const editComponentMessage = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-edit-component',
    path: '0/2',
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(editComponentMessage, generation),
    true,
    'a bounded component double-click command must cross the current canvas generation',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...editComponentMessage, path: 'not/a/path' }, generation),
    false,
    'component edit commands must reject non-canonical element paths',
  );
  const editCodeComponentMessage = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-edit-code-component',
    path: '0/2',
    instanceId: 'hero-instance',
    componentId: 'marketing.hero',
    componentVersion: '1.2.3',
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(editCodeComponentMessage, generation),
    true,
    'a Code Component double-click must cross the strict canvas protocol with its exact identity',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...editCodeComponentMessage, instanceId: '' }, generation),
    false,
    'Code Component edit commands must reject an empty instance identity',
  );
  const rejectedCodeComponentUpdate = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-code-component-rejected',
    instanceId: 'hero-instance',
    revision: 18,
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(rejectedCodeComponentUpdate, generation),
    true,
    'a failed React commit must return a bounded rejection to the editor',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...rejectedCodeComponentUpdate, revision: -1 }, generation),
    false,
    'Code Component rejections must reject invalid revisions',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...selectionMessage,
        unexpectedPayload: ['must', 'not', 'be', 'processed'],
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      canvasProtocol.withCanvasGeneration(generation, {
        type: 'html-editor-text-change',
        path: '0/2',
        value: 'Hello Kodety',
        html: 'Hello <span class="accent">Kodety</span><br>',
        rangeStyle: true,
      }),
      generation,
    ),
    true,
    'bounded inline span/br markup must cross the canvas protocol with the text fallback',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      canvasProtocol.withCanvasGeneration(generation, {
        type: 'html-editor-text-range',
        path: '0/2',
        active: true,
      }),
      generation,
    ),
    true,
    'a bounded active text range must cross the canvas protocol without serializing DOM Range internals',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...selectionMessage,
        selectedPaths: ['not/a/numeric/path'],
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...selectionMessage,
        payload: { ...selection, computedStyle: { display: 42 } },
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...selectionMessage,
        payload: { ...selection, parentDisplay: 42 },
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...selectionMessage,
        payload: { ...selection, parentPosition: 42 },
      },
      generation,
    ),
    false,
  );
  const { revision: _selectionRevision, ...selectionWithoutRevision } = selectionMessage;
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(selectionWithoutRevision, generation),
    false,
    'selection snapshots without a source/live revision must never overwrite newer Inspector state',
  );
  for (const command of [
    'undo',
    'redo',
    'copy-selection',
    'paste-selection',
    'copy-selection-styles',
    'paste-selection-styles',
    'delete-selection',
    'duplicate-selection',
    'move-selection-up',
    'move-selection-down',
    'move-selection-first',
    'move-selection-last',
    'open-insert',
  ]) {
    assert.equal(
      canvasProtocol.isCanvasToEditorMessage(
        canvasProtocol.withCanvasGeneration(generation, {
          type: 'html-editor-command',
          command,
        }),
        generation,
      ),
      true,
      `${command} must cross the isolated canvas command bridge`,
    );
  }
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      canvasProtocol.withCanvasGeneration(generation, {
        type: 'html-editor-command',
        command: 'publish-without-confirmation',
      }),
      generation,
    ),
    false,
    'the canvas command bridge must reject undeclared commands',
  );
  const svgPasteMessage = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-svg-paste',
    svg: '<svg viewBox="0 0 24 24"><path d="M2 12h20"/></svg>',
    targetPath: '0/2',
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(svgPasteMessage, generation),
    true,
    'a bounded SVG paste must preserve the layer selected when the clipboard event fired',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...svgPasteMessage, targetPath: '' }, generation),
    true,
    'the body path must remain a valid exact SVG paste target',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(svgPasteMessage, 'stale-generation'),
    false,
    'an SVG copied from a replaced canvas generation must not mutate the current document',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...svgPasteMessage, targetPath: 'not/a/path' }, generation),
    false,
    'SVG paste targets must use canonical element paths',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...svgPasteMessage, svg: 'x'.repeat(384 * 1024 + 1) }, generation),
    false,
    'the canvas protocol must reject oversized clipboard SVG payloads',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...svgPasteMessage, fallbackPosition: 'after' }, generation),
    false,
    'SVG paste must not smuggle a fallback position or any undeclared field across the canvas boundary',
  );
  const scrollCheckpoint = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-scroll-checkpoint',
    requestId: 'canonical-scroll:12',
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(scrollCheckpoint, generation),
    true,
    'the current iframe must be able to acknowledge a bounded scroll checkpoint',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...scrollCheckpoint, requestId: 'foreign checkpoint' }, generation),
    false,
    'arbitrary iframe request ids must not trigger a canonical navigation',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(scrollCheckpoint, 'stale-generation'),
    false,
    'a checkpoint from the replaced iframe generation must be ignored',
  );
  const infiniteCanvasHeight = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-infinite-canvas-height',
    height: 8_000,
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(infiniteCanvasHeight, generation),
    true,
    'a finite full-document height from the current opaque iframe must pass the bridge contract',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...infiniteCanvasHeight, height: 1_000_001 }, generation),
    false,
    'runaway full-document heights must be rejected before changing infinite-canvas geometry',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(infiniteCanvasHeight, 'stale-generation'),
    false,
    'a stale iframe generation must never resize the current infinite canvas',
  );
  const viewportHeightSimulation = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-viewport-height-simulation',
    path: '0/3',
    height: 1080,
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(viewportHeightSimulation, generation),
    true,
    'a bounded per-section viewport simulation must cross the opaque iframe boundary',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...viewportHeightSimulation, height: 10_001 }, generation),
    false,
    'section viewport simulations must reject runaway editor geometry',
  );
  const injectedInfiniteRuntime = infiniteCanvasRuntime.injectInfiniteCanvasRuntime('<!doctype html><html><body><main></main></body></html>', {
    defaultViewportHeight: 844,
  });
  assert.match(injectedInfiniteRuntime, /data-kodety-infinite-canvas-runtime/);
  assert.match(injectedInfiniteRuntime, /"defaultViewportHeight":844/, 'the device viewport height must be embedded before the first srcdoc execution');
  assert.doesNotMatch(
    injectedInfiniteRuntime,
    /\bas (?:Window|CSSStyleSheet)\b|interface DeclarationCandidate|:\s*Record<string/,
    'the serialized browser runtime must not leak TypeScript-only syntax into srcdoc',
  );
  assert.equal(
    infiniteCanvasRuntime.injectInfiniteCanvasRuntime(injectedInfiniteRuntime),
    injectedInfiniteRuntime,
    'infinite-canvas runtime injection must be idempotent across preview rebuilds',
  );
  const markerMentionWithoutRuntime = infiniteCanvasRuntime.injectInfiniteCanvasRuntime(
    '<!doctype html><html><body><script>const safe = "data-kodety-infinite-canvas-runtime";</script></body></html>',
  );
  assert.match(
    markerMentionWithoutRuntime,
    /<script data-kodety-infinite-canvas-runtime>/,
    'mentioning the marker in another runtime must not skip the actual viewport-height bootstrap',
  );
  assert.equal(infiniteCanvasRuntime.defaultInfiniteCanvasViewportHeight(2560), 1080);
  assert.equal(infiniteCanvasRuntime.defaultInfiniteCanvasViewportHeight(1920), 1080);
  assert.equal(infiniteCanvasRuntime.defaultInfiniteCanvasViewportHeight(1200), 900);
  assert.equal(infiniteCanvasRuntime.defaultInfiniteCanvasViewportHeight(810), 1080);
  assert.equal(infiniteCanvasRuntime.defaultInfiniteCanvasViewportHeight(410), 844);
  assert.equal(
    canvasProtocol.canvasComputedStyleExpectationMatches({ path: '0/2', property: 'display', value: 'none' }, '  NONE  '),
    true,
    'a Hidden ACK must be accepted only when the canvas computed display is none',
  );
  assert.equal(
    canvasProtocol.canvasComputedStyleExpectationMatches({ path: '0/2', property: 'display', value: 'none' }, 'flex'),
    false,
    'an authored display:flex!important must make the Hidden computed check fail',
  );
  assert.equal(
    canvasProtocol.canvasComputedStyleExpectationMatches({ path: '0/2', property: 'display', value: 'none', mode: 'not-equals' }, 'flex'),
    true,
    'Show is confirmed only after computed display stops being none',
  );
  assert.equal(
    canvasProtocol.canvasComputedStyleExpectationMatches({ path: '0/2', property: 'display', value: 'none', mode: 'not-equals' }, 'none'),
    false,
    'Show must not ACK while another important rule still hides the element',
  );
  assert.deepEqual(
    mediaFocus.parseObjectPositionFocus('center top'),
    [50, 0],
    'the media focus control must understand keyword object-position values from authored rules',
  );
  assert.deepEqual(mediaFocus.parseObjectPositionFocus('right bottom'), [100, 100], 'the media focus control must preserve both keyword axes');
  assert.deepEqual(
    mediaFocus.parseObjectPositionFocus('-20% 140%'),
    [0, 100],
    'the media focus control must clamp authored positions to its interactive surface',
  );
  assert.equal(mediaFocus.formatObjectPositionFocus([19.6, 74.7]), '20% 75%', 'focus-point gestures must emit stable integer percentages');
  assert.deepEqual(
    canvasProtocol.canvasComputedStyleExpectationsForEdit(['0/2'], 'display', 'none !important'),
    [{ path: '0/2', property: 'display', value: 'none', mode: 'equals' }],
    'a Hidden live mutation must carry an explicit computed-style proof',
  );
  assert.deepEqual(
    canvasProtocol.canvasComputedStyleExpectationsForEdit(['0/2'], 'display', ''),
    [{ path: '0/2', property: 'display', value: 'none', mode: 'not-equals' }],
    'a Show live mutation must prove that display:none no longer wins',
  );
  assert.deepEqual(
    canvasProtocol.canvasComputedStyleExpectationsForEdit(['0/2'], 'object-position', '20% 75% !important'),
    [
      {
        path: '0/2',
        property: 'object-position',
        value: '20% 75%',
        mode: 'equals',
      },
    ],
    'focus-point mutations must stay pending until the iframe confirms the computed position',
  );
  assert.deepEqual(
    canvasProtocol.canvasComputedStyleExpectationsForEdit(['0/2'], 'gap', '12px'),
    [],
    'computed ACK checks stay scoped to properties with stable CSSOM values',
  );
  assert.equal(
    canvasProtocol.isCanvasElementComputedVisible('flex', 'none', true),
    true,
    'the panel must not claim Hidden from optimistic source attributes while the canvas still paints the layer',
  );
  assert.equal(
    canvasProtocol.isCanvasElementComputedVisible('none', 'flex', false),
    false,
    'the panel must report Hidden when the browser computed result is actually display:none',
  );
  assert.equal(
    canvasProtocol.isCanvasElementComputedVisible(undefined, 'none !important', false),
    false,
    'before the first canvas snapshot, the authored display remains the safe fallback',
  );
  const canonicalSelectionHandoff = {
    generation: 'canvas-outgoing',
    revision: 18,
  };
  assert.equal(
    canvasProtocol.shouldRetainCanvasSelectionSnapshot(canonicalSelectionHandoff, 'canvas-outgoing', 18),
    true,
    'an equal-revision selection echo from the outgoing canvas must not roll optimistic Inspector state back',
  );
  assert.equal(
    canvasProtocol.shouldRetainCanvasSelectionSnapshot(canonicalSelectionHandoff, 'canvas-outgoing', 19),
    true,
    'the outgoing generation remains stale even if an unrelated edit advances its global revision',
  );
  assert.equal(
    canvasProtocol.shouldRetainCanvasSelectionSnapshot(canonicalSelectionHandoff, 'canvas-promoted', 17),
    true,
    'a replacement generation older than the authored edit cannot complete the Inspector handoff',
  );
  assert.equal(
    canvasProtocol.shouldRetainCanvasSelectionSnapshot(canonicalSelectionHandoff, 'canvas-promoted', 18),
    false,
    'a promoted generation containing the authored revision may replace optimistic Inspector state',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      canvasProtocol.withCanvasGeneration(generation, {
        type: 'html-editor-text-change',
        path: '0/2',
        value: 'x'.repeat(256 * 1024 + 1),
      }),
      generation,
    ),
    false,
  );
  const directGapCommit = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-direct-style',
    breakpointId: 'mobile',
    path: '0/2',
    property: 'column-gap',
    sourceProperty: 'column-gap',
    value: '24px',
    startPx: 16,
    valuePx: 24,
    gestureId: 'direct:7',
  });
  assert.equal(canvasProtocol.isCanvasToEditorMessage(directGapCommit, generation), true);
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directGapCommit,
        gestureId: 'unbounded gesture',
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directGapCommit,
        valuePx: Number.NaN,
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directGapCommit,
        valuePx: 24,
        startPx: undefined,
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directGapCommit,
        property: 'position',
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directGapCommit,
        valuePx: 23,
      },
      generation,
    ),
    false,
  );
  const directStylePreview = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-direct-style-preview',
    breakpointId: 'mobile',
    path: '0/2',
    values: { 'column-gap': '24px', 'border-style': 'solid' },
  });
  assert.equal(canvasProtocol.isCanvasToEditorMessage(directStylePreview, generation), true);
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directStylePreview,
        values: { left: '-18.5px', top: '42px' },
      },
      generation,
    ),
    true,
    'absolute/fixed position previews must accept bounded signed pixels',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directStylePreview,
        values: { position: 'fixed' },
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directStylePreview,
        values: { 'column-gap': 'calc(100vw)' },
      },
      generation,
    ),
    false,
  );
  const interactionDurationMessage = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-interaction-duration',
    interactionId: 'interaction-duration',
    signature: '{"id":"interaction-duration"}',
    duration: 2.75,
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(interactionDurationMessage, generation),
    true,
    'runtime interaction duration must cross the same generation-bound canvas protocol',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...interactionDurationMessage,
        duration: 86_401,
      },
      generation,
    ),
    false,
  );
  const interactionControlAppliedMessage = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-interaction-control-applied',
    timelineSequence: 17,
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(interactionControlAppliedMessage, generation),
    true,
    'the active iframe must be able to acknowledge an exact Timeline command',
  );
  assert.equal(canvasProtocol.isCanvasToEditorMessage({ ...interactionControlAppliedMessage, timelineSequence: 0 }, generation), false);
  const drawnFrame = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-draw-insert',
    key: 'frame',
    targetPath: '0/2',
    position: 'inside',
    width: 640,
    height: 360,
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(drawnFrame, generation),
    true,
    'drawn frame dimensions must cross the iframe boundary as bounded geometry',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...drawnFrame,
        width: 10001,
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...drawnFrame,
        key: 'script',
      },
      generation,
    ),
    false,
  );
  const directRotationCommit = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-direct-style',
    breakpointId: 'mobile',
    path: '0/2',
    property: 'rotate',
    value: '-37.5deg',
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(directRotationCommit, generation),
    true,
    'visual rotation must accept a bounded signed angle without spatial pixel metadata',
  );
  const directPositionBatch = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-direct-style-batch',
    breakpointId: 'mobile',
    path: '0/2',
    gestureId: 'direct:8',
    styles: [
      {
        property: 'left',
        sourceProperty: 'left',
        value: '-18.5px',
        startPx: 0,
        valuePx: -18.5,
      },
      {
        property: 'top',
        sourceProperty: 'top',
        value: '42px',
        startPx: 24,
        valuePx: 42,
      },
    ],
  });
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(directPositionBatch, generation),
    true,
    'a positioned drag must cross the canvas boundary as one bounded style batch',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directPositionBatch,
        styles: [...directPositionBatch.styles, directPositionBatch.styles[0]],
      },
      generation,
    ),
    false,
    'a positioned drag batch must reject duplicate anchors',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directPositionBatch,
        styles: [{ property: 'width', value: '100px', startPx: 80, valuePx: 100 }],
      },
      generation,
    ),
    false,
    'the batch channel is intentionally limited to positional anchors',
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directRotationCommit,
        value: '-37.5px',
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...directRotationCommit,
        startPx: 0,
        valuePx: 37.5,
      },
      generation,
    ),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      canvasProtocol.withCanvasGeneration(generation, {
        type: 'html-editor-direct-style-preview',
        breakpointId: 'mobile',
        path: '0/2',
        values: { width: '1280px', height: '720px', rotate: '15deg' },
      }),
      generation,
    ),
    true,
  );
  const canvasReady = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-canvas-ready',
    revision: 41,
  });
  assert.equal(canvasProtocol.isCanvasToEditorMessage(canvasReady, generation), true);
  assert.equal(canvasProtocol.isCanvasToEditorMessage({ ...canvasReady, revision: -1 }, generation), false);
  assert.equal(canvasProtocol.isCanvasToEditorMessage({ ...canvasReady, revision: 1.5 }, generation), false);
  const liveStyleApplied = canvasProtocol.withCanvasGeneration(generation, {
    type: 'html-editor-live-style-applied',
    mutationId: 'live:42:3',
    revision: 42,
  });
  assert.equal(canvasProtocol.isCanvasToEditorMessage(liveStyleApplied, generation), true);
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      {
        ...liveStyleApplied,
        mutationId: 'invalid mutation id',
      },
      generation,
    ),
    false,
  );
  const liveStyleRejected = {
    ...liveStyleApplied,
    type: 'html-editor-live-style-rejected',
  };
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(liveStyleRejected, generation),
    true,
    'a live DOM rejection must cross the bounded protocol so Infinite Canvas can repair without reload',
  );
  assert.deepEqual(
    canvasProtocol.reconcileCanvasRevisionMutations(
      [
        { mutationId: 'live:39:1', revision: 39 },
        { mutationId: 'live:41:2', revision: 41 },
        { mutationId: 'live:42:3', revision: 42 },
        { mutationId: 'live:44:4', revision: 44 },
      ],
      41,
    ),
    {
      included: [
        { mutationId: 'live:39:1', revision: 39 },
        { mutationId: 'live:41:2', revision: 41 },
      ],
      replay: [
        { mutationId: 'live:42:3', revision: 42 },
        { mutationId: 'live:44:4', revision: 44 },
      ],
    },
    'a rebuilt canvas must replay only mutations newer than its canonical revision',
  );

  const rebaseBase = {
    ...project,
    openedAt: 1234,
    files: {
      ...project.files,
      'assets/logo.png': {
        path: 'assets/logo.png',
        mimeType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      },
    },
  };
  const producedAsset = {
    ...rebaseBase,
    files: {
      ...rebaseBase.files,
      'assets/photo.png': {
        path: 'assets/photo.png',
        mimeType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
      },
    },
  };
  const concurrentHtml = projectIo.updateTextFile(rebaseBase, 'index.html', '<!doctype html><html><body><main style="gap:24px"></main></body></html>');
  const rebasedAsset = projectRebase.rebaseProducedProjectFiles(rebaseBase, producedAsset, concurrentHtml);
  assert.equal(
    rebasedAsset.project.files['index.html'].text,
    concurrentHtml.files['index.html'].text,
    'an async asset result must preserve concurrent HTML/style edits',
  );
  assert.deepEqual(Array.from(rebasedAsset.project.files['assets/photo.png'].data), [4, 5, 6]);
  const collisionProject = {
    ...concurrentHtml,
    files: {
      ...concurrentHtml.files,
      'assets/photo.png': {
        path: 'assets/photo.png',
        mimeType: 'image/png',
        data: new Uint8Array([9]),
      },
    },
  };
  const rebasedCollision = projectRebase.rebaseProducedProjectFiles(rebaseBase, producedAsset, collisionProject);
  assert.equal(rebasedCollision.pathMap['assets/photo.png'], 'assets/photo-2.png');
  assert.deepEqual(Array.from(rebasedCollision.project.files['assets/photo.png'].data), [9]);
  assert.deepEqual(Array.from(rebasedCollision.project.files['assets/photo-2.png'].data), [4, 5, 6]);

  const realtimeBase = {
    ...rebaseBase,
    files: {
      ...rebaseBase.files,
      'index.html': {
        ...rebaseBase.files['index.html'],
        text: '<main><h1>Original</h1><p>Texto</p></main>',
      },
    },
  };
  const realtimeLocal = projectIo.updateTextFile(realtimeBase, 'index.html', '<main><h1>Título local</h1><p>Texto</p></main>');
  const realtimeRemote = projectIo.updateTextFile(realtimeBase, 'index.html', '<main><h1>Original</h1><p>Texto remoto</p></main>');
  const threeWaySamePage = collaborativeMerge.mergeWorkspaceConflict(realtimeBase, realtimeLocal, realtimeRemote);
  assert.equal(
    threeWaySamePage.project.files['index.html'].text,
    '<main><h1>Título local</h1><p>Texto remoto</p></main>',
    'the defensive CAS recovery must preserve local and external edits when an out-of-band writer changes the workspace',
  );

  const producedReplacement = {
    ...rebaseBase,
    files: {
      ...rebaseBase.files,
      'assets/logo.png': {
        path: 'assets/logo.png',
        mimeType: 'image/png',
        data: new Uint8Array([7, 8]),
      },
    },
  };
  const concurrentReplacement = {
    ...rebaseBase,
    files: {
      ...rebaseBase.files,
      'assets/logo.png': {
        path: 'assets/logo.png',
        mimeType: 'image/png',
        data: new Uint8Array([9, 9]),
      },
    },
  };
  assert.throws(
    () => projectRebase.rebaseProducedProjectFiles(rebaseBase, producedReplacement, concurrentReplacement),
    error => error?.name === 'ProjectRebaseConflictError',
    'same-file async conflicts must abort instead of overwriting either edit',
  );
  assert.throws(
    () =>
      projectRebase.rebaseProducedProjectFiles(rebaseBase, producedAsset, {
        ...concurrentHtml,
        openedAt: 9999,
      }),
    error => error?.name === 'ProjectSessionChangedError',
  );

  const baseWithRegistry = projectIo.updateEditorMetadata(rebaseBase, metadata => ({
    ...metadata,
    codeComponents: { schemaVersion: '1.0.0', components: [], instances: [] },
  }));
  const compiledVersion = {
    id: 'test.concurrent',
    version: '1.0.0',
    schemaVersion: '1.0.0',
    bundle: 'export const compiled = true',
    manifest: { id: 'test.concurrent', version: '1.0.0', dependencies: [] },
    publishedAt: new Date(0).toISOString(),
    author: 'test',
    dependencies: [],
  };
  const compiledProject = projectIo.updateEditorMetadata(baseWithRegistry, metadata => ({
    ...metadata,
    codeComponents: {
      schemaVersion: '1.0.0',
      components: [compiledVersion],
      instances: [],
    },
  }));
  const concurrentProject = projectIo.updateTextFile(
    baseWithRegistry,
    'index.html',
    '<!doctype html><html><body hidden><main style="gap:32px"></main></body></html>',
  );
  const rebasedCompile = projectRebase.rebaseCompiledCodeComponentVersion(baseWithRegistry, compiledProject, concurrentProject, 'test.concurrent', '1.0.0');
  assert.equal(
    rebasedCompile.files['index.html'].text,
    concurrentProject.files['index.html'].text,
    'compiler metadata must be merged onto the latest project rather than commit its stale snapshot',
  );
  assert.equal(projectRebase.snapshotCodeSources(rebasedCompile)['missing.ts'], undefined);
  assert.equal(projectRebase.codeSourcesMatchSnapshot(rebasedCompile, projectRebase.snapshotCodeSources(rebasedCompile)), true);

  const previewSource = await readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');
  const canvasViewStateSource = await readFile(path.join(root, 'lib/html-editor/canvas-view-state.ts'), 'utf8');
  const interactionRuntimeContractSource = await readFile(path.join(root, 'lib/html-editor/interactions.ts'), 'utf8');
  const designMotionFreezeSource = previewSource.slice(
    previewSource.indexOf('if (freezeMotion) {'),
    previewSource.indexOf('const rememberAttribute', previewSource.indexOf('if (freezeMotion) {')),
  );
  assert.ok(designMotionFreezeSource, 'the disposable Design document must retain a dedicated motion-freeze transform');
  assert.match(
    designMotionFreezeSource,
    /document\.querySelectorAll\('script'\)\.forEach\(script => \{[\s\S]*?script\.hasAttribute\('data-kodety-interactions-runtime'\)[\s\S]*?script\.hasAttribute\('data-kodety-interactions-dependency'\)[\s\S]*?return;[\s\S]*?script\.setAttribute\('data-html-editor-frozen-script-type'/,
    'Design mode must exempt the editor-owned interaction runtime and dependencies before neutralizing authored scripts',
  );
  assert.match(
    previewSource,
    /const pageAnimationDocument = readInteractionDocumentFile\([\s\S]*?const animationDocument = pageAnimationDocument[\s\S]*?if \(animationDocument\?\.interactions\.length\)[\s\S]*?patchInteractionDocument\([\s\S]*?animationDocument,[\s\S]*?false/,
    'Design and executable Preview must materialize the configured interaction runtime in their isolated document',
  );
  assert.match(
    designMotionFreezeSource,
    /animation:\s*none;[\s\S]*?animation-play-state:\s*paused;[\s\S]*?transition-property:\s*none;/,
    'authored CSS motion must stay frozen without introducing CSS priorities',
  );
  assert.match(
    designMotionFreezeSource,
    /canvasLoadingGateClass[\s\S]*?entrance\|animation\|motion[\s\S]*?releaseCanvasLoadingGate\(document\.documentElement\)[\s\S]*?data-html-editor-canvas-loading-overlay[\s\S]*?display:\s*none/,
    'Design mode must release inert page-loading gates and hide their full-page overlays without changing publication',
  );
  assert.match(
    previewSource,
    /const externalPlayerPreview = !inspectionEnabled[\s\S]*?if \(externalPlayerPreview\) \{[\s\S]*?releasePreviewPlayerLoadingGate\(document\.documentElement\)[\s\S]*?data-html-editor-preview-player-loading-overlay[\s\S]*?display:\s*none/,
    'executable Preview must reuse the disposable loader release only when an isolated Vimeo or YouTube player can strand the authored gate',
  );
  assert.match(
    designMotionFreezeSource,
    /Element\.prototype\.animate = function\(keyframes, options\)[\s\S]*?duration: 0[\s\S]*?animation\.finish\?\.\(\)[\s\S]*?animation\.pause\?\.\(\)/,
    'Web Animations created by retained structural renderers must complete synchronously and remain paused',
  );
  assert.match(
    designMotionFreezeSource,
    /\['appendChild', 'insertBefore', 'replaceChild'\][\s\S]*?freezeScriptTree\(node\)[\s\S]*?original\.call\(this, node, \.\.\.rest\)/,
    'late dynamically-inserted project scripts must be neutralized before they can execute',
  );
  assert.match(
    designMotionFreezeSource,
    /Document\.prototype\.createElement = function\(tagName, options\)[\s\S]*?freezeScript\(element\)[\s\S]*?document\.write = \(\) => \{\};[\s\S]*?neutralizeEventProperties/,
    'createElement+src, document.write and property event handlers must not reopen authored execution paths',
  );
  assert.match(
    designMotionFreezeSource,
    /let publicClockBudget = 1[\s\S]*?publicClockBudget -= 1[\s\S]*?const sealPublicClock[\s\S]*?pendingPublicFrames\.forEach[\s\S]*?pendingPublicTimers\.forEach[\s\S]*?DOMContentLoaded', sealPublicClock/,
    'the public rAF/timer clock must have a finite initialization budget and cancel pending work after module evaluation',
  );
  assert.match(
    designMotionFreezeSource,
    /window\.__KODETY_EDITOR_STRUCTURAL_RAF__ = nativeClock\.requestAnimationFrame[\s\S]*?data-kodety-infinite-canvas-runtime/,
    'editor-owned structural runtimes must keep a private native frame clock without releasing authored animation loops',
  );
  assert.match(
    designMotionFreezeSource,
    /HTMLMediaElement\.prototype\.play = function\(\)[\s\S]*?this\.pause\?\.\(\)[\s\S]*?Promise\.resolve\(\)/,
    'autoplay and runtime play calls must remain paused in Design mode',
  );
  assert.match(
    previewSource,
    /data-html-editor-canvas-static-embed[\s\S]*?element\.removeAttribute\('src'\)[\s\S]*?element\.removeAttribute\('allow'\)[\s\S]*?quadro estático no canvas/,
    'Design must replace external iframe players with an inert static projection before srcdoc loads',
  );
  assert.match(
    designMotionFreezeSource,
    /const freezeCanvasEmbed[\s\S]*?node\.querySelectorAll\?\.\('iframe'\)\.forEach\(freezeCanvasEmbed\)[\s\S]*?target instanceof HTMLIFrameElement[\s\S]*?freezeCanvasEmbed\(target\)/,
    'late component/CMS iframe insertions and source mutations must remain inert in Design',
  );
  assert.doesNotMatch(
    previewSource,
    /querySelectorAll\('img, picture source, video, video source, iframe'\)/,
    'the Design lazy-asset promoter must never reactivate video sources or embedded players',
  );
  assert.match(
    previewSource,
    /designMediaPayload\(element, name\)[\s\S]*?runtimeAssetAttribute \|\| name === 'autoplay'[\s\S]*?removeLiveAttribute\(element, name\)[\s\S]*?nativeSetAttribute\.call\(element, promotedName, patch\.value\)[\s\S]*?nativeSetAttribute\.call\(element, originalName, patch\.value\)[\s\S]*?return true;[\s\S]*?requestRuntimeAssetUrl/,
    'live Canvas attribute patches must preserve authored media values without reactivating video or audio payloads in Design',
  );
  assert.match(
    previewSource,
    /const designEmbedPayload[\s\S]*?HTMLIFrameElement[\s\S]*?'src', 'srcdoc', 'allow', 'allowfullscreen'[\s\S]*?if \(designEmbedPayload\(element, name\)\)[\s\S]*?setLiveAttribute\(element, originalName, patch\.value\)[\s\S]*?if \(name !== 'srcdoc'\) removeLiveAttribute\(element, name\)[\s\S]*?return true;/,
    'live Canvas attribute patches must update static embed metadata without restoring iframe navigation or permissions',
  );
  assert.match(
    designMotionFreezeSource,
    /pauseAnimations\?\.\(\)[\s\S]*?element\.stop\?\.\(\)/,
    'inline SVG SMIL and native marquee motion must be paused with media',
  );
  assert.match(
    designMotionFreezeSource,
    /Element\.prototype\.attachShadow = function\(options\)[\s\S]*?installShadowFreeze\(root\)[\s\S]*?shadowObservers\.forEach/,
    'open and closed programmatic Shadow DOM roots must receive their own motion stylesheet and observer',
  );
  assert.match(
    designMotionFreezeSource,
    /observer\.observe\(document\.documentElement, \{[\s\S]*?childList: true,[\s\S]*?attributes: true/,
    'late class/style/event mutations and inserted CMS/component nodes must be re-settled',
  );
  assert.match(
    designMotionFreezeSource,
    /class CanvasIntersectionObserver[\s\S]*?isIntersecting: true,[\s\S]*?intersectionRatio: 1[\s\S]*?window\.IntersectionObserver = CanvasIntersectionObserver/,
    'Design must materialize retained IntersectionObserver renderers without waiting for visitor scroll',
  );
  assert.match(
    designMotionFreezeSource,
    /PAINT_CHUNK_MAX_HEIGHT = 6144[\s\S]*?PAINT_CHUNK_LIMIT = 24[\s\S]*?PAINT_CHUNK_SCAN_LIMIT = 96[\s\S]*?PAINT_CHUNK_MAX_DEPTH = 2[\s\S]*?while \(pending\.length && inspected < PAINT_CHUNK_SCAN_LIMIT\)[\s\S]*?entry\.depth < PAINT_CHUNK_MAX_DEPTH/,
    'giant Design documents must use a bounded shallow compositor scan instead of measuring the complete DOM',
  );
  assert.match(
    designMotionFreezeSource,
    /PAINT_CHUNK_COMPLEX_SURFACE_MIN_HEIGHT = 1536[\s\S]*?paintChunkNeedsSubdivision[\s\S]*?element\.matches\('video, iframe, canvas'\)[\s\S]*?element\.querySelector\('video, iframe, canvas'\)[\s\S]*?height <= PAINT_CHUNK_MAX_HEIGHT[\s\S]*?!paintChunkNeedsSubdivision\(element, height\)[\s\S]*?candidates\.push/,
    'tall media/compositor scenes must be subdivided instead of promoted as one large Design texture',
  );
  assert.doesNotMatch(
    designMotionFreezeSource,
    /height <= PAINT_CHUNK_MAX_HEIGHT\s*\|\||height > PAINT_CHUNK_MAX_HEIGHT[\s\S]{0,160}data-html-editor-canvas-paint-chunk/,
    'an oversized leaf or deeply nested region must never become one giant compositor surface',
  );
  assert.doesNotMatch(
    designMotionFreezeSource,
    /distributePaintCandidates[\s\S]*?firstCenter[\s\S]*?lastCenter[\s\S]*?buckets = Array\.from\(\{ length: PAINT_CHUNK_LIMIT \}[\s\S]*?candidate\.center - firstCenter[\s\S]*?return ordered\.filter/,
    'paint chunk selection must not sort and redistribute every measured node across the full document',
  );
  assert.match(
    designMotionFreezeSource,
    /nextPaintChunkElements[\s\S]*?!nextPaintChunkElements\.has\(element\)[\s\S]*?!paintChunkElements\.has\(element\)[\s\S]*?nextPaintChunkElements\.forEach\(element => paintChunkElements\.add\(element\)\)/,
    'paint chunk refreshes must diff stable markers instead of tearing every compositor layer down',
  );
  const paintChunkRule = designMotionFreezeSource.match(/:root\[data-html-editor-motion-frozen\] \[data-html-editor-canvas-paint-chunk\] \{([\s\S]*?)\}/);
  assert.ok(paintChunkRule, 'the Design compositor chunk rule must exist');
  assert.match(
    paintChunkRule[1],
    /will-change:\s*opacity/,
    'paint chunks must request independent compositor surfaces without creating a transform containing block',
  );
  assert.doesNotMatch(
    paintChunkRule[1],
    /\b(?:transform|contain|position|width|height)\s*:|will-change:\s*[^;}]*\btransform\b/,
    'paint chunking must not change authored geometry, containing blocks, or overflow',
  );
  assert.doesNotMatch(
    designMotionFreezeSource,
    /offsetHeight[\s\S]*?paintChunkElements\.forEach\(element => \{ void element\.getBoundingClientRect\(\); \}\)/,
    'paint chunks must not force another complete synchronous layout realization',
  );
  assert.match(
    designMotionFreezeSource,
    /new ResizeObserver\(\(\) => schedulePaintChunkRefresh\(\)\)[\s\S]*?document\.fonts\?\.ready\?\.then\(schedulePaintChunkRefresh\)/,
    'paint chunks must refresh after responsive and font-driven layout changes',
  );
  assert.match(
    designMotionFreezeSource,
    /const observePaintBody = \(\) =>[\s\S]*?paintResizeObserver\.observe\(observedPaintBody\)[\s\S]*?const ready = \(\) => \{[\s\S]*?observePaintBody\(\)/,
    'the body must be observed after parsing even though the bootstrap executes before body exists',
  );
  assert.match(
    previewSource,
    /window\.__KODETY_REFRESH_EDITOR_PAINT_CHUNKS__ = schedulePaintChunkRefresh[\s\S]*?const scheduleLiveStylePaintRefresh[\s\S]*?requestIdleCallback\(run, \{ timeout: 240 \}\)[\s\S]*?html-editor-live-style[\s\S]*?scheduleLiveStylePaintRefresh\(\)/,
    'live style mutations must coalesce expensive paint-chunk work into an idle window without rebuilding the iframe',
  );
  assert.match(
    designMotionFreezeSource,
    /conditionalUiPattern[\s\S]*?hasActivePeer[\s\S]*?authoredHidden\(element\)[\s\S]*?data-html-editor-canvas-reveal/,
    'Canvas reveal settling must preserve authored and stateful UI hiding instead of exposing every inactive child',
  );
  assert.match(
    designMotionFreezeSource,
    /const conditionalUi = element =>[\s\S]*?\[role="dialog"\][\s\S]*?details:not\(\[open\]\)[\s\S]*?\[aria-expanded="false"\]\[aria-controls~="/,
    'Canvas entrance settling must leave closed dialogs, menus, tabs and disclosure content hidden',
  );
  assert.match(
    designMotionFreezeSource,
    /const authoredMotionHint = element =>[\s\S]*?data-html-editor-original-style[\s\S]*?const staticContentCandidate[\s\S]*?const importedFramerEntrance = hiddenByCss[\s\S]*?data-kodety-framer-node[\s\S]*?const likelyEntranceState = !inheritedVisibility && hiddenByCss[\s\S]*?importedFramerEntrance[\s\S]*?motionOffset[\s\S]*?staticContentCandidate\(element\)[\s\S]*?data-html-editor-canvas-reveal-motion/,
    'unmarked opacity/transform entrance states must materialize as their readable resting state in Design',
  );
  assert.match(
    designMotionFreezeSource,
    /stateClassPattern = \/\(\?:\^\|\[-_\]\)[\s\S]*?active\|current\|selected\|open\|visible\|playing[\s\S]*?hasActivePeer/,
    'compound state classes such as swiper-slide-active must protect inactive peer content from Canvas promotion',
  );
  assert.doesNotMatch(
    designMotionFreezeSource,
    /conditionalUiPattern\s*=\s*\/[^\\n]*\|transition\|/,
    'generic transition utility classes must not suppress legitimate entrance materialization',
  );
  assert.match(
    designMotionFreezeSource,
    /\['style', 'class', 'hidden', 'aria-hidden'\]\.includes\(mutation\.attributeName \|\| ''\)[\s\S]*?target\.hasAttribute\('data-kodety-framer-node'\)[\s\S]*?needsSettle = true[\s\S]*?scheduleRoot\(\s*target,[\s\S]*?\['style', 'class', 'hidden', 'aria-hidden'\]\.includes\(mutation\.attributeName \|\| ''\)/,
    'late responsive Framer style changes must be re-evaluated by the Design resting-state materializer',
  );
  assert.doesNotMatch(
    previewSource,
    /if \(freezeMotion\) \{[\s\S]*?data-html-editor-canvas-promoted-\$\{name\}[\s\S]*?loading'\)\?\.toLowerCase\(\) === 'lazy'[\s\S]*?setCanvasOnlyAttribute\(element, 'loading', 'eager'\)/,
    'Design must preserve authored lazy loading instead of materializing every image during canvas startup',
  );
  assert.match(
    previewSource,
    /script:not\(\[data-html-editor-bridge\]\):not\(\[data-html-editor-motion-freeze\]\)/,
    'passive infinite-canvas frames must retain the same Design materialization bootstrap',
  );
  assert.match(
    designMotionFreezeSource,
    /data-html-editor-original-\$\{attribute\.name\}[\s\S]*?element\.removeAttribute\(attribute\.name\)/,
    'inline event handlers must be preserved for editing but made inert in the canvas',
  );
  assert.match(
    previewSource,
    /isAnimatedRasterAsset[\s\S]*?image\/gif[\s\S]*?acTL[\s\S]*?ANIM[\s\S]*?rasterizeFrozenFirstFrame[\s\S]*?canvas\.toBlob/,
    'GIF, APNG and animated WebP uploads (including CSS backgrounds) must resolve to a static first-frame canvas asset',
  );
  assert.match(
    previewSource,
    /const animatedRuntimeAssetBlobs = new Map\(\)[\s\S]*?const restartAnimatedRuntimeAssets = \(\) => \{[\s\S]*?motionFrozen[\s\S]*?URL\.createObjectURL\(blob\)[\s\S]*?replaceRuntimeAssetUrl\([\s\S]*?html-editor-buffer-promoted[\s\S]*?restartAnimatedRuntimeAssets\(\)/,
    'a buffered Preview generation must restart animated raster object URLs when it is promoted instead of appearing mid-cycle',
  );
  assert.match(
    previewSource,
    /const installTransferredRuntimeAsset = \(asset, aliases\) => \{[\s\S]*?isAnimatedRasterAsset\(asset\)[\s\S]*?if \(motionFrozen && animated\) \{[\s\S]*?rasterizeFrozenFirstFrame\(asset, aliases, installGeneration\)/,
    'an animated raster requested on demand must obey the same frozen first-frame Design contract as the bulk transfer path',
  );
  assert.match(
    previewSource,
    /svg\.querySelectorAll\('script, animate, animateMotion, animateTransform, discard, set'\)[\s\S]*?animation-play-state:paused/,
    'external SVG images must be sanitized into a non-executable, non-animated Design-only data asset',
  );
  assert.match(
    previewSource,
    /const editorClock = window\.__KODETY_EDITOR_NATIVE_CLOCK__[\s\S]*?const requestAnimationFrame = editorClock\.requestAnimationFrame/,
    'the editing bridge must remain responsive through its private native clock after the page clock is frozen',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const editorClock = window\.__KODETY_EDITOR_NATIVE_CLOCK__[\s\S]*?const previewDelta[\s\S]*?const pauseFrozenPlayback = \(\) => \{[\s\S]*?editorCancelFrame\(previewFrame\)[\s\S]*?timeline\.pause\(\)[\s\S]*?const runFrozenPreview[\s\S]*?renderPreviewTime\([\s\S]*?previewFrame = editorRequestFrame\(tick\)/,
    'Timeline preview must continuously render exact Motion totalTime frames through the private Design clock',
  );
  assert.match(
    interactionRuntimeContractSource,
    /rawDelta > 500 \? 33 : rawDelta[\s\S]*?timeline\.totalTime\(targetTime, false\)/,
    'Timeline playback must retain Motion lag behavior while using the exact scrub renderer in frozen Design',
  );
  assert.match(
    designMotionFreezeSource,
    /const safeCanvasScript[\s\S]*?data-html-editor-motion-freeze[\s\S]*?data-html-editor-bridge[\s\S]*?data-kodety-infinite-canvas-runtime/,
    'the motion observer must never neutralize the editor bridge that transfers assets and owns Canvas interaction',
  );
  assert.doesNotMatch(
    designMotionFreezeSource,
    /setInterval\(\(\) => \{\s*pauseMedia\(document\)/,
    'motion settling must stay mutation-driven instead of polling the whole document forever',
  );
  assert.match(
    previewSource,
    /element\.hidden && !element\.hasAttribute\('data-html-editor-original-hidden'\)/,
    'motion settling must not reveal authored hidden elements',
  );
  assert.match(
    previewSource,
    /type: 'html-editor-canvas-ready', revision: editorRevision/,
    'canvas readiness must be emitted only after the complete bridge is installed',
  );
  assert.match(
    previewSource,
    /data-kodety-canvas-tool[\s\S]*?const paintDrawGesture[\s\S]*?event\.shiftKey[\s\S]*?event\.altKey[\s\S]*?Math\.round\(value \/ 8\) \* 8[\s\S]*?type: 'html-editor-draw-insert'/,
    'Frame/Text tools must draw a measured, modifier-aware, grid-snapped box before committing source',
  );
  assert.match(
    previewSource,
    /'resize-width','resize-height'[\s\S]*?startPointerAngle[\s\S]*?Math\.round\(value \/ 15\) \* 15[\s\S]*?values: \{ rotate: value \+ 'deg' \}[\s\S]*?dataset\.directKind = 'rotate'[\s\S]*?dataset\.rotateCorner = corner/,
    'direct selection controls must expose visual resize and four-corner, shift-snapped rotation with live feedback',
  );
  assert.match(
    previewSource,
    /data-spacing-kind\^="padding-"[\s\S]*?rgba\(255, 111, 224, \.25\)[\s\S]*?data-direct-kind\^="padding-"[\s\S]*?background: #ff6fe0[\s\S]*?opacity: 0; pointer-events: none[\s\S]*?data-selected-hover[\s\S]*?opacity: 1; pointer-events: auto/,
    'Penpot-style pink padding regions and thin handles must stay quiet until hover, focus, or a direct spacing gesture',
  );
  assert.match(
    previewSource,
    /directSizeLabel[\s\S]*?Math\.round\(rect\.width\) \+ ' × ' \+ Math\.round\(rect\.height\) \+ ' px'[\s\S]*?id = '__kodety-direct-size-label'/,
    'the selected layer must retain a compact width-by-height badge below its outline',
  );
  assert.match(
    previewSource,
    /directGestureLabel[\s\S]*?border-radius'\) return 'Radius '[\s\S]*?resize-width'\) return 'Width '[\s\S]*?resize-height'\) return 'Height '[\s\S]*?directSizeLabel\.textContent = directGestureLabel/,
    'the dimensions badge must become contextual feedback during radius and edge resizing',
  );
  assert.match(
    previewSource,
    /data-direct-kind="resize-width"[\s\S]*?height: 100%[\s\S]*?data-direct-kind="resize-height"[\s\S]*?width: 100%[\s\S]*?__kodety-direct-corner[\s\S]*?solid var\(--kodety-direct-selection-color\)[\s\S]*?border-radius: var\(--kodety-direct-corner-radius, 999px\)[\s\S]*?background: #fff; pointer-events: none/,
    'width and height must use invisible full-edge hit zones with white corner markers that follow the selection owner color',
  );
  assert.doesNotMatch(
    previewSource,
    /id = '__kodety-direct-label'/,
    'the redundant dark direct-manipulation label must stay removed now that the compact selection badge owns feedback',
  );
  assert.match(previewSource, /type: 'html-editor-live-style-applied'/, 'live style application must acknowledge its mutation');
  assert.match(
    previewSource,
    /const value = rawValue\.replace\(\/\\s\*![\s\S]*?const priority =[\s\S]*?element\.style\.setProperty\(property, value, priority\)/,
    'inline live styles must preserve explicit source priority while applying the value in the iframe',
  );
  assert.match(
    previewSource,
    /appliedEveryPatch\s*&&[\s\S]*type: 'html-editor-live-style-applied'/,
    'the canvas must not ACK a live mutation when one of its targets was not found',
  );
  assert.match(
    previewSource,
    /computedChecks[\s\S]*elements\.every\(element =>[\s\S]*getComputedStyle\(element\)[\s\S]*if \(!matchesEveryTarget\) appliedEveryPatch = false/,
    'the canvas must not ACK Hidden/Show until the browser computed style confirms the visual result',
  );
  assert.match(
    previewSource,
    /setProperty\('padding-top', value \+ 'px', 'important'\)/,
    'direct canvas feedback must visibly win legacy important declarations during the gesture',
  );

  assert.equal(spatialControls.authoredSpatialValue({ gap: '1rem 2rem' }, 'column-gap'), '2rem');
  assert.equal(spatialControls.authoredSpatialValue({ padding: '8px 1.5em' }, 'padding-block'), '8px');
  assert.equal(spatialControls.authoredSpatialValue({ 'padding-right': '2rem' }, 'padding-right'), '2rem');
  assert.equal(spatialControls.preserveSpatialUnit('1rem', 16, 24, '24px'), '1.5rem');
  assert.equal(spatialControls.preserveSpatialUnit('calc(1rem + 2px)', 18, 24, '24px'), '24px');
  assert.equal(spatialControls.preserveSpatialUnit('0cm', 0, 96, '96px'), '2.54cm');
  assert.equal(
    spatialControls.preserveSpatialUnit('2rem', 32, -16, '-16px', {
      allowNegative: true,
    }),
    '-1rem',
    'position gestures must preserve authored units when crossing into negative coordinates',
  );
  assert.deepEqual(
    cssLengthDraft.splitCssLengthDraft('36px', { emptyValue: '0' }),
    { value: '36', unit: 'px' },
    'compact spacing fields must keep the numeric draft separate from its px suffix',
  );
  assert.deepEqual(
    cssLengthDraft.splitCssLengthDraft('80%', { emptyValue: '0' }),
    { value: '80', unit: '%' },
    'relative spacing units must remain stable while the numeric part is edited',
  );
  assert.deepEqual(
    cssLengthDraft.splitCssLengthDraft('normal', { emptyValue: '0' }),
    { value: '0', unit: 'px' },
    'an unset axis gap must render as an explicit editable zero instead of an empty broken field',
  );
  assert.equal(cssLengthDraft.composeCssLengthDraft('8', '%'), '8%');
  assert.equal(
    cssLengthDraft.composeCssLengthDraft('80', '%'),
    '80%',
    'typing the second digit of a percentage must replace only the numeric draft, never append another unit',
  );
  assert.equal(cssLengthDraft.composeCssLengthDraft('8.', 'px'), null);
  assert.equal(cssLengthDraft.composeCssLengthDraft('calc(1rem + 2px)', ''), 'calc(1rem + 2px)');

  const buttonSource = await readFile(path.join(root, 'components/ui/button.tsx'), 'utf8');
  const ycodeButtonSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/ui/button.tsx'), 'utf8');
  assert.match(
    buttonSource,
    /disabled:!bg-neutral-500\/20[\s\S]*?disabled:!text-white\/70[\s\S]*?disabled:opacity-100/,
    'disabled buttons must use a translucent neutral surface with readable white text instead of fading the active color',
  );
  assert.match(
    buttonSource,
    /data-\[disabled=true\]:!bg-neutral-500\/20[\s\S]*?data-\[disabled=true\]:!text-white\/70[\s\S]*?data-\[disabled=true\]:opacity-100/,
    'button-like slots must share the same disabled visual state',
  );
  assert.match(
    buttonSource,
    /data: 'border border-\[var\(--kodety-accent\)\]\/28 bg-\[var\(--kodety-accent\)\]\/12 text-\[var\(--kodety-accent-hover\)\] hover:bg-\[var\(--kodety-accent\)\]\/16'/,
    'informational data buttons must use a translucent accent surface, bounded stroke and readable light label',
  );
  assert.match(
    buttonSource,
    /default: 'bg-\[var\(--kodety-accent\)\] text-white hover:bg-\[var\(--kodety-accent-hover\)\] \[&_svg\]:text-current \[&_svg\]:opacity-100'/,
    'solid accent buttons must keep their labels and icons fully white',
  );
  assert.match(
    ycodeButtonSource,
    /disabled:!bg-neutral-500\/20[\s\S]*?disabled:!text-white\/70[\s\S]*?disabled:opacity-100/,
    'Ycode-style disabled buttons must replace the action color with the shared neutral surface',
  );
  assert.match(
    ycodeButtonSource,
    /default: 'bg-\[var\(--kodety-accent\)\] text-white hover:bg-\[var\(--kodety-accent-hover\)\] \[&_svg\]:text-current \[&_svg\]:opacity-100'/,
    'Ycode-style solid accent buttons must keep their labels and icons fully white',
  );
  assert.match(
    ycodeButtonSource,
    /data-disabled=\{disabled \? 'true' : undefined\}[\s\S]*?aria-disabled=\{asChild && disabled \? true/,
    'Ycode-style button slots must preserve disabled semantics and visuals',
  );

  const firstCodeResult = { revision: 2 };
  const codeTransaction = {
    path: 'index.html',
    at: 1000,
    after: firstCodeResult,
  };
  assert.equal(
    editCoalescing.shouldStartCodeEditTransaction(codeTransaction, firstCodeResult, 'index.html', 1200),
    false,
    'adjacent keystrokes should remain one history transaction',
  );
  assert.equal(
    editCoalescing.shouldStartCodeEditTransaction(codeTransaction, { revision: 1 }, 'index.html', 1200),
    true,
    'an intervening undo/redo state must start a fresh history branch',
  );
  assert.equal(
    editCoalescing.CANVAS_STYLE_PREVIEW_PATH,
    '.kodety/canvas-style-preview.css',
    'transient visual edits must use one reserved stylesheet identity outside authored project files',
  );
  const canvasPreviewAuthority = Array.from(
    { length: 8 },
    (_, index) => `:not(#__kodety_canvas_preview_${index})`,
  ).join('');
  let canvasStylePreview = editCoalescing.updateCanvasStylePreviewDraft(null, ['0/2', '0/1', '0/2'], ' COLOR ', 'red !important');
  canvasStylePreview = editCoalescing.updateCanvasStylePreviewDraft(canvasStylePreview, ['0/1', '0/2'], 'color', 'blue');
  canvasStylePreview = editCoalescing.updateCanvasStylePreviewDraft(canvasStylePreview, ['0/2', '0/1'], 'opacity', '0.75');
  assert.deepEqual(
    canvasStylePreview,
    {
      targetKey: '0/1\u00000/2',
      paths: ['0/1', '0/2'],
      declarations: { color: 'blue', opacity: '0.75' },
    },
    'rapid previews for one selection must coalesce by property and keep only the latest visual value',
  );
  assert.equal(
    editCoalescing.serializeCanvasStylePreview(canvasStylePreview),
    `[data-html-editor-path="0/1"]${canvasPreviewAuthority},[data-html-editor-path="0/2"]${canvasPreviewAuthority}{color:blue!important;opacity:0.75!important;}`,
    'the coalesced preview must be deterministic and visibly outrank legacy authored priority',
  );
  let customPropertyPreview = editCoalescing.updateCanvasStylePreviewDraft(null, ['0'], '--Gap', '12px');
  customPropertyPreview = editCoalescing.updateCanvasStylePreviewDraft(customPropertyPreview, ['0'], '--gap', '24px');
  assert.deepEqual(customPropertyPreview.declarations, {'--Gap': '12px', '--gap': '24px'}, 'CSS variable previews must remain case-sensitive while coalescing');
  assert.deepEqual(editCoalescing.removeCanvasStylePreviewProperties(customPropertyPreview, ['--Gap']).declarations, {'--gap': '24px'}, 'releasing one variable must retain a different case-sensitive variable');
  const bodyCanvasStylePreview = editCoalescing.updateCanvasStylePreviewDraft(null, [''], 'background-color', '#111827');
  assert.deepEqual(
    bodyCanvasStylePreview,
    {
      targetKey: '',
      paths: [''],
      declarations: { 'background-color': '#111827' },
    },
    'the empty authored path is the document body and must remain a valid realtime preview target',
  );
  assert.equal(
    editCoalescing.serializeCanvasStylePreview(bodyCanvasStylePreview),
    `[data-html-editor-path=""]${canvasPreviewAuthority}{background-color:#111827!important;}`,
    'body/root scrubs must paint through the same transient stylesheet without waiting for commit or reload',
  );
  const classCanvasStylePreview = editCoalescing.updateCanvasStylePreviewDraft(null, ['0/1'], 'height', '84px', '.shared-card');
  assert.deepEqual(
    classCanvasStylePreview,
    {
      targetKey: 'selector\u0000.shared-card',
      paths: ['0/1'],
      selector: '.shared-card',
      declarations: { height: '84px' },
    },
    'a rule preview must retain its real selector so every matching class instance shares realtime paint',
  );
  assert.equal(
    editCoalescing.serializeCanvasStylePreview(classCanvasStylePreview),
    `.shared-card${canvasPreviewAuthority}{height:84px!important;}`,
    'class realtime must serialize through the winning rule selector with disposable preview authority',
  );
  assert.equal(
    editCoalescing.serializeCanvasStylePreview(editCoalescing.updateCanvasStylePreviewDraft(null, ['0/1'], 'height', '84px', '.shared-card{display:none}')),
    `[data-html-editor-path="0/1"]${canvasPreviewAuthority}{height:84px!important;}`,
    'an unsafe preview selector must fall back to the bounded selected path',
  );
  const previewWithoutColor = editCoalescing.removeCanvasStylePreviewProperties(canvasStylePreview, [' COLOR ', 'not a property']);
  assert.deepEqual(
    previewWithoutColor?.declarations,
    { opacity: '0.75' },
    'a canonical commit must clear only its committed preview properties without dropping unrelated live feedback',
  );
  assert.equal(
    editCoalescing.removeCanvasStylePreviewProperties(previewWithoutColor, ['opacity']),
    null,
    'the final canonical commit must leave no transient preview stylesheet behind',
  );
  assert.deepEqual(
    editCoalescing.updateCanvasStylePreviewDraft(canvasStylePreview, ['0/9'], 'width', '120px'),
    {
      targetKey: '0/9',
      paths: ['0/9'],
      declarations: { width: '120px' },
    },
    'moving to another selection must discard the previous selection preview instead of leaking declarations',
  );
  assert.equal(
    editCoalescing.isLiveCanvasStylesheetPath(' styles/theme.CSS?ver=2#editor '),
    true,
    'CSS code edits must remain eligible for the reload-free live stylesheet channel',
  );
  assert.equal(editCoalescing.isLiveCanvasStylesheetPath('scripts/editor.js'), false);
  assert.equal(editCoalescing.isLiveCanvasStylesheetPath('scripts/editor.mjs?ver=2'), false);
  assert.equal(
    editCoalescing.isLiveCanvasStylesheetPath('styles/theme.css.map'),
    false,
    'JavaScript and source maps must stay on the controlled canonical refresh path',
  );

  const settingsSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'), 'utf8');
  const mcpSettingsContentSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlMcpSettingsContent.tsx'),
    'utf8',
  );
  const settingsAndMcpSource = `${settingsSource}\n${mcpSettingsContentSource}`;
  const settingsHostSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx'), 'utf8');
  const settingsSaveStateSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/hooks/use-canonical-settings-draft.ts'), 'utf8');
  assert.match(
    settingsSource,
    /autosaveTimerRef[\s\S]*?if \(siteDirty && !siteSaveError\)[\s\S]*?persistSite\('auto'\)/,
    'Settings changes must be debounced and persisted without requiring a manual save click',
  );
  assert.match(
    settingsSource,
    /const SETTINGS_AUTOSAVE_IDLE_MS = 2000;[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?persistSite\('auto'\)[\s\S]*?}, SETTINGS_AUTOSAVE_IDLE_MS\)/,
    'Settings autosave must wait for a real typing pause',
  );
  assert.match(
    settingsSource,
    /title="Canvas Infinito"[\s\S]*?description="Beta · múltiplos breakpoints no mesmo canvas\."[\s\S]*?title="Disponibilizar Canvas Infinito"[\s\S]*?ainda é instável[\s\S]*?por sua conta e risco[\s\S]*?betaFeatures\?\.(?:infiniteCanvas)[\s\S]*?onCheckedChange=\{\(infiniteCanvas\)/,
    'Infinite Canvas must live behind an explicit unstable-Beta opt-in with a plain risk warning',
  );
  assert.match(
    settingsSource,
    /\{hydratedFramerProject && \([\s\S]*?title="Importações Framer"[\s\S]*?title="Permitir edição de sites Framer"[\s\S]*?Não se aplica a imports estáticos, que são sempre editáveis/,
    'the Framer editing preference must be rendered only for hydrated animated imports and explain that static imports stay editable',
  );
  assert.match(
    settingsHostSource,
    /isHydratedFramerProject\(project\)[\s\S]*?hydratedFramerProject,/,
    'Settings must receive the current project runtime classification before rendering the Framer editing preference',
  );
  assert.match(
    settingsSource,
    /const enqueueSave[\s\S]*?request\.origin === 'auto'[\s\S]*?pending\.origin === 'manual'[\s\S]*?drainSaveQueue\(\)/,
    'settings autosave and explicit saves must share a serialized latest-draft queue without dropping a manual request',
  );
  assert.match(
    settingsSaveStateSource,
    /function canonicalSettingsSignature[\s\S]*?Object\.entries\(candidate[\s\S]*?\.sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/,
    'Settings dirty checks must ignore object key order returned by a canonical save',
  );
  assert.match(
    settingsSaveStateSource,
    /function useCanonicalSettingsDraft[\s\S]*?pendingSaveRef[\s\S]*?currentSignature === pendingDraft[\s\S]*?onSuccess:[\s\S]*?setSavedSignature\(signature\)/,
    'every Settings scope must acknowledge the exact successful draft while preserving newer typing',
  );
  assert.match(
    settingsSource,
    /useCanonicalSettingsDraft\(siteSettings\)[\s\S]*?useCanonicalSettingsDraft\(normalizedCustomCode\)[\s\S]*?useCanonicalSettingsDraft\(normalizedRedirects\)[\s\S]*?useCanonicalSettingsDraft\(canonicalPageDraft\)/,
    'General, Analytics, language, Custom Code, Redirects and page settings must share the same saved-state reconciler',
  );
  assert.match(
    settingsSource,
    /const requestSection = async[\s\S]*?selectedPage && pageDirty[\s\S]*?await waitForSaveQueue\(\)[\s\S]*?await onSavePage\(selectedPage, pageDraft, pagePath\.trim\(\)\)[\s\S]*?setSection\(id\)/,
    'switching away from a page Settings form must persist it before replacing the page draft',
  );
  assert.match(
    settingsSource,
    /onClick=\{\(\) => void onSave\(\)\}[\s\S]*?disabled=\{saving \|\| !dirty \|\| Boolean\(error\)\}[\s\S]*?aria-busy=\{saving\}/,
    'a visible save in progress must prevent a duplicate manual request',
  );
  assert.match(
    settingsSource,
    /mx-auto w-full px-4 pb-20 pt-6 sm:px-7 sm:pt-8 lg:px-8 lg:pt-10/,
    'every Settings tab must share comfortable top padding and fixed-save-bar clearance across viewport sizes',
  );
  const customCodeSettingsSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCustomCodeSettings.tsx'), 'utf8');
  const aiProviderLogoSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAiProviderLogo.tsx'), 'utf8');
  const projectSettingsFieldControlSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettingsFieldControl.tsx'),
    'utf8',
  );
  const spacingControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/components/SpacingControls.tsx'), 'utf8');
  const layoutControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/LayoutControls.tsx'), 'utf8');
  const selfLayoutControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/SelfLayoutControls.tsx'), 'utf8');
  const ycodeSettingsPanelSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/SettingsPanel.tsx'), 'utf8');
  const transitionControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/components/TransitionControls.tsx'), 'utf8');
  const htmlCssLengthFieldSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCssLengthField.tsx'), 'utf8');
  const marginPaddingSource = await readFile(path.join(root, 'app/(builder)/kodety/components/MarginPadding.tsx'), 'utf8');
  const ycodeMarginPaddingSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/MarginPadding.tsx'), 'utf8');
  assert.match(
    spacingControlsSource,
    /<SettingsPanel[\s\S]*?title="Spacing"[\s\S]*?<MarginPadding[\s\S]*?onChange=\{handleChange\}/,
    'the Ycode Spacing panel must retain its original visual box-model control',
  );
  assert.match(
    htmlKodetyStyleControlsSource,
    /spacing:\s*\{[\s\S]*?marginTop:\s*["']margin-top["'][\s\S]*?paddingLeft:\s*["']padding-left["'][\s\S]*?HtmlKodetySpacingControls[\s\S]*?<SpacingControls \{\.\.\.adapter\} \/>/,
    'the HTML adapter must map every Ycode Spacing field back to direct CSS longhands',
  );
  assert.match(
    ycodeMarginPaddingSource,
    /export \{ default \} from '@\/app\/\(builder\)\/kodety\/components\/MarginPadding'/,
    'the HTML Spacing adapter must reuse the canonical bounded box-model implementation',
  );
  assert.match(
    marginPaddingSource,
    /data-spacing-control[\s\S]*?aspect-\[10\/7\][\s\S]*?max-w-\[320px\][\s\S]*?overflow-hidden/,
    'the canonical Spacing box model must keep a bounded aspect ratio so inputs cannot stretch it over Sizing',
  );
  assert.match(
    marginPaddingSource,
    /nativeCss[\s\S]*splitCssLengthDraft[\s\S]*composeCssLengthDraft[\s\S]*geometria compartilhada desenha cada stroke uma vez[\s\S]*Área interna de padding/,
    'the visual box-model must preserve authored CSS units inside the unified Webflow-like margin/padding diagram',
  );
  assert.match(
    marginPaddingSource,
    /!h-6 !w-\[40px\][\s\S]*?!cursor-ew-resize focus-visible:!cursor-text[\s\S]*?function SpacingValueDragger[\s\S]*?distance < 3[\s\S]*?data-spacing-value-dragger=\{side\}[\s\S]*?isDragging && 'cursor-ew-resize \[&_input\]:!cursor-ew-resize'/,
    'spacing values must remain compact, expose numeric scrubbing and preserve a text cursor while focused',
  );
  assert.doesNotMatch(marginPaddingSource, /function BoxEdge|data-spacing-drag-handle/, 'the former draggable strips and their separate grips must be removed');
  assert.match(
    marginPaddingSource,
    /SPACING_INPUT_CLASS[\s\S]*!border-transparent[\s\S]*data-spacing-input[\s\S]*data-spacing-control[\s\S]*aspect-\[10\/7\][\s\S]*inset-x-\[16%\]/,
    'the visual box-model must use transparent compact inputs inside a slightly taller proportional nested diagram',
  );
  assert.match(
    marginPaddingSource,
    /function SpacingGeometry[\s\S]*data-spacing-geometry=\{box\}[\s\S]*'absolute inset-0 border'[\s\S]*border-dashed[\s\S]*border-solid[\s\S]*function SpacingFace[\s\S]*pointerEvents: interactive \? 'all' : 'none'/,
    'spacing geometry must paint each shared border once while every full face retains its own hover target',
  );
  assert.match(
    marginPaddingSource,
    /rgb\(147 147 255 \/ 0\.12\)[\s\S]*data-spacing-face-activation=\{`\$\{box\}-\$\{side\}`\}[\s\S]*points=\{FACE_POLYGONS\[box\]\[side\]\}[\s\S]*onMouseDown=\{handleMouseDown\}/,
    'every full spacing triangle must expose blue drag feedback and own the click-and-drag gesture',
  );
  assert.doesNotMatch(
    marginPaddingSource,
    /bg-\[#29292a\]|bg-\[#363637\]|bg-\[#151516\]|bg-white\/\[\.018\].*clip-path/,
    'spacing boxes must not return to permanently filled surfaces',
  );
  assert.match(
    htmlCssLengthFieldSource,
    /focusedRef\.current[\s\S]*composeCssLengthDraft[\s\S]*w-7 shrink-0 justify-center/,
    'spacing drafts must resist stale parent updates and reserve stable space for their unit',
  );
  assert.match(
    layoutControlsSource,
    /const LAYOUT_TYPE_OPTIONS[\s\S]*?value: 'columns'[\s\S]*?value: 'rows'[\s\S]*?value: 'grid'[\s\S]*?const layoutDisplay = display === 'hidden' \? visibleDisplay[\s\S]*?const layoutType =[\s\S]*?data-html-layout-visibility[\s\S]*?label="Visible"[\s\S]*?options=\{VISIBILITY_OPTIONS\}[\s\S]*?property="display"[\s\S]*?value=\{layoutType\}[\s\S]*?options=\{LAYOUT_TYPE_OPTIONS\}/,
    'Layout must separate Visible Yes/No from its columns, rows and grid type while retaining the hidden layout type',
  );
  assert.doesNotMatch(layoutControlsSource.slice(layoutControlsSource.indexOf('const LAYOUT_TYPE_OPTIONS'), layoutControlsSource.indexOf('const ALIGN_OPTIONS')), /value: 'hidden'|label: 'Hide'/);
  assert.match(
    layoutControlsSource,
    /handleGapChange[\s\S]*?handleColumnGapChange[\s\S]*?handleRowGapChange[\s\S]*?gridTemplateColumns[\s\S]*?gridTemplateRows/,
    'the Ycode Layout panel must keep independent gap and grid controls',
  );
  assert.match(
    layoutControlsSource,
    /data-design-token-section="layout"[\s\S]*?<GapValueControl[\s\S]*?value=\{gapInput\}[\s\S]*?onColumnGapChange=\{handleColumnGapChange\}[\s\S]*?onModeToggle=\{handleGapModeToggle\}/,
    'the flat Ycode Layout panel must retain a semantic section boundary for its gap token connector',
  );
  assert.match(
    ycodeSettingsPanelSource,
    /data-design-token-section=\{title\?\.toLowerCase\(\)\}/,
    'transplanted Ycode panel wrappers must identify their section without changing their visual chrome',
  );
  assert.match(ycodeSettingsPanelSource, /aria-expanded=\{isOpen\}[\s\S]*?onClick=\{onToggle\}[\s\S]*?<DisclosureChevron expanded=\{isOpen\}/, 'Ycode inspector sections must use the shared stroke chevron');
  assert.doesNotMatch(ycodeSettingsPanelSource, /triangle-right/, 'Ycode inspector sections must not regress to filled triangle disclosure icons');
  assert.match(
    selfLayoutControlsSource,
    /function SelfLayoutControls[\s\S]*?isParentFlex[\s\S]*?isParentGrid[\s\S]*?if \(!isParentFlex && !isParentGrid\) return null[\s\S]*?Self align/,
    'the Ycode Self layout panel must appear only for children of flex or grid containers',
  );
  assert.match(
    htmlKodetyStyleControlsSource,
    /value === "hidden"[\s\S]*?return "none"[\s\S]*?HtmlKodetyLayoutControls[\s\S]*?<LayoutControls[\s\S]*?\{\.\.\.adapter\}[\s\S]*?freeLayout=\{props\.freeLayout\}[\s\S]*?HtmlKodetySelfLayoutControls[\s\S]*?<SelfLayoutControls \{\.\.\.adapter\} parentLayer=\{parentLayer\} \/>/,
    'the HTML adapter must preserve Ycode Layout semantics while writing native CSS display values',
  );
  assert.match(
    htmlKodetyStyleControlsSource,
    /<EffectControls \{\.\.\.adapter\} \/>[\s\S]*?<BackgroundsControls \{\.\.\.adapter\} \/>[\s\S]*?<BorderControls \{\.\.\.adapter\} \/>/,
    'the HTML adapter must expose the original controls in embedded mode instead of recreating them',
  );
  assert.match(
    transitionControlsSource,
    /const timingUnitClassName = ["']text-xs opacity-50["'][\s\S]*?Duration[\s\S]*?<InputGroupAddon[\s\S]*?align="inline-end"[\s\S]*?className=\{timingUnitClassName\}[\s\S]*?>\s*ms\s*<\/InputGroupAddon>[\s\S]*?Delay[\s\S]*?<InputGroupAddon[\s\S]*?align="inline-end"[\s\S]*?className=\{timingUnitClassName\}[\s\S]*?>\s*ms\s*<\/InputGroupAddon>/,
    'Duration and Delay must render the ms suffix with identical size and color',
  );
  assert.match(
    settingsSource,
    /\{ id: 'code', label: 'Custom Code', icon: Code2, sidebarIcon: SidebarCodeIcon \}/,
    'Custom Code must remain a first-class Site Settings destination with a duotone sidebar identity',
  );
  assert.match(
    settingsSource,
    /SettingsMinimalisticIcon[\s\S]*?MinimalisticMagnifierIcon[\s\S]*?SolarRouteIcon[\s\S]*?SidebarCodeIcon[\s\S]*?data-kodety-project-settings[\s\S]*?sidebarIcon: Icon[\s\S]*?<Home2Icon \/>[\s\S]*?<FileTextIcon \/>/,
    'Project Settings must reserve Solar Bold Duotone icons for its desktop information architecture',
  );
  assert.match(
    projectSettingsFieldControlSource,
    /HtmlSettingsFieldGlyph[\s\S]*?rounded-\[9px\][\s\S]*?focus-within:border-\[var\(--kodety-focus\)\]\/75/,
    'Project Settings fields must reuse the single-surface Builder grammar with Gravity glyphs',
  );
  assert.match(
    projectSettingsFieldControlSource,
    /data-kodety-settings-control-inner[\s\S]*?className:[\s\S]*?h-full/,
    'Project Settings compound fields must leave border and focus ownership with their outer surface',
  );
  assert.match(
    projectSettingsFieldControlSource,
    /FIELD_SURFACE_CLASS[\s\S]*?["']h-9 items-stretch["']/,
    'Project Settings single-line fields must use the canonical 36px metric',
  );
  assert.doesNotMatch(projectSettingsFieldControlSource, /@solar-icons\/react/, 'duotone icons must not leak from the Settings sidebar into form controls');
  assert.match(
    settingsSource,
    /function SocialImageTemplateThumbnail[\s\S]*?rgb\(255 255 255 \/ 0\.065\)[\s\S]*?<ImageIcon className="size-4"/,
    'empty Social Image template previews must use a neutral filled surface with one centered image glyph',
  );
  assert.doesNotMatch(
    settingsSource,
    /#111827|block h-1\.5 w-12 rounded-full|block h-1 w-8 rounded-full/,
    'Social Image template placeholders must not regress to the blue mockup with decorative text bars',
  );
  assert.equal(
    [...settingsSource.matchAll(/data-kodety-settings-preview className="(?:mt-3 )?w-full overflow-hidden"/g)].length,
    3,
    'every settings preview must fill the available content column',
  );
  assert.match(
    settingsSource,
    /function SettingRow[\s\S]*?className="py-1\.5"[\s\S]*?Diretivas avançadas[\s\S]*?border-t border-\[var\(--kodety-divider\)\][\s\S]*?<SettingRow/,
    'toggle cards must retain breathing room when they follow an internal divider',
  );
  assert.match(
    settingsSource,
    /aria-label="Provedor de IA" className="space-y-2"[\s\S]*?bg-white\/\[\.025\][\s\S]*?<HtmlAiProviderLogo provider=\{provider\.id\}/,
    'AI provider options must keep a filled neutral surface, consistent spacing, and the provider brand mark',
  );
  assert.match(
    aiProviderLogoSource,
    /provider === 'openai'[\s\S]*?provider === 'codex'[\s\S]*?provider === 'kimi'[\s\S]*?provider === 'openrouter'/,
    'OpenAI, Codex, Kimi and OpenRouter must render distinct inline SVG brand marks',
  );
  assert.match(
    settingsSource,
    /data-kodety-settings-disclosure className="group border-t border-\[var\(--kodety-divider\)\] py-2"[\s\S]*?Preferências de escrita[\s\S]*?className="mt-2 border-t border-\[var\(--kodety-divider\)\] pb-2"/,
    'writing preferences must keep visible space between its rounded summary and both separator strokes',
  );
  assert.match(
    settingsSource,
    /data-kodety-settings-card className="my-5 flex items-start gap-2/,
    'standalone settings notices must not touch the divider above or below them',
  );
  assert.match(
    settingsSource,
    /function SeoScoreMeter[\s\S]*?role="meter"[\s\S]*?aria-valuenow=\{boundedScore\}[\s\S]*?h-1 w-8 overflow-hidden rounded-full[\s\S]*?<SeoScoreMeter score=\{seoScore\} \/>/,
    'the page SEO score must render as a compact accessible meter instead of loose colored text',
  );
  assert.match(
    settingsSource,
    /customCode: CustomCodeSettings[\s\S]*?onSaveCustomCode: \(settings: CustomCodeSettings\)/,
    'Custom Code must use its own metadata contract and save callback instead of SEO settings',
  );
  assert.match(
    settingsSource,
    /const persistCustomCode = \(origin: SettingsSaveOrigin = 'manual'\) => \{[\s\S]*?run: \(\) => onSaveCustomCode\(draft\)/,
    'the Custom Code editor must persist its isolated draft explicitly',
  );
  assert.match(
    settingsSource,
    /section === 'code'[\s\S]*?<HtmlCustomCodeSettings[\s\S]*?onChange=\{setCustomCodeDraft\}[\s\S]*?<SaveBar[\s\S]*?onSave=\{persistCustomCode\}/,
    'the Code destination must render the responsive list/editor and a dedicated save bar',
  );
  assert.match(customCodeSettingsSource, /placeholder="Buscar códigos…"/, 'Custom Code entries must remain searchable');
  assert.match(
    customCodeSettingsSource,
    /Nenhum código adicionado[\s\S]*?Adicionar código/,
    'Custom Code must keep an explicit empty state and creation action',
  );
  assert.match(
    customCodeSettingsSource,
    /Duplicar[\s\S]*?Mover para cima[\s\S]*?Mover para baixo[\s\S]*?Remover/,
    'entry actions must cover duplication, ordering and removal',
  );
  assert.match(
    customCodeSettingsSource,
    /checked=\{selectedEntry\.enabled\}[\s\S]*?Inserir em[\s\S]*?Páginas[\s\S]*?Executar[\s\S]*?Linguagem[\s\S]*?<CodeEditor/,
    'the editor must expose enablement, placement, page scope, run mode, language and code',
  );
  const projectEditorSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8');
  assert.match(
    projectEditorSource,
    /const framerEditingPreferenceEnabled[\s\S]*?const framerEditingEnabled = !hydratedFramerProject \|\| framerEditingPreferenceEnabled[\s\S]*?const framerRuntimeReadOnly = hydratedFramerProject && !framerEditingEnabled/,
    'static and non-hydrated projects must stay editable regardless of the animated Framer preference',
  );
  const editorRightSidebarSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorRightSidebar.tsx'), 'utf8');
  assert.match(
    `${projectEditorSource}\n${editorRightSidebarSource}`,
    /const unlockFramerEditing = useCallback[\s\S]*?framerSiteEditing: true[\s\S]*?onUnlockFramerEditing=\{unlockFramerEditing\}[\s\S]*?Desbloquear edição/,
    'animated Framer protection must be directly and persistently unlockable from the Builder',
  );
  const editorChromeStoreSource = await readFile(path.join(root, 'stores/useHtmlEditorChromeStore.ts'), 'utf8');
  const viewportStoreSource = await readFile(path.join(root, 'stores/useHtmlViewportStore.ts'), 'utf8');
  const codeEditorSource = await readFile(path.join(root, 'components/ui/code-editor.tsx'), 'utf8');
  const editorCodePanelSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCodePanel.tsx'), 'utf8');
  const pasteCodeComponentDialogSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlPasteCodeComponentDialog.tsx'), 'utf8');
  const editorChromeOverlaysSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorChromeOverlays.tsx'), 'utf8');
  const canvasStageSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'), 'utf8');
  const projectEditorAndCanvasStageSource = `${projectEditorSource}\n${canvasStageSource}`;
  const canvasStageAndProjectEditorSource = `${canvasStageSource}\n${projectEditorSource}`;
  const editorConstantsSource = await readFile(path.join(root, 'lib/html-editor/editor-constants.ts'), 'utf8');
  assert.match(
    editorConstantsSource,
    /export \{ TOAST_PROPS \} from '\.\/toast-config'/,
    'the editor must reuse the shared toast configuration',
  );
  const editorProjectAndConstantsSource = `${editorConstantsSource}\n${projectEditorSource}\n${canvasStageSource}`;
  const editorTypesSource = await readFile(path.join(root, 'lib/html-editor/editor-types.ts'), 'utf8');
  const editorTypesAndProjectSource = `${editorTypesSource}\n${projectEditorSource}`;
  const editorLocalizationHelpersSource = await readFile(path.join(root, 'lib/html-editor/editor-localization-helpers.ts'), 'utf8');
  const editorLocalizationHelpersAndProjectSource = `${editorLocalizationHelpersSource}\n${projectEditorSource}`;
  const editorLiveDomHelpersSource = await readFile(path.join(root, 'lib/html-editor/editor-live-dom-helpers.ts'), 'utf8');
  const mcpActivityFeedbackSource = await readFile(path.join(root, 'lib/html-editor/mcp-activity-feedback.ts'), 'utf8');
  const agentBridgeStoreSource = await readFile(path.join(root, 'stores/useHtmlAgentEditorBridgeStore.ts'), 'utf8');
  const agentPanelSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAgentPanel.tsx'), 'utf8');
  const editorLiveDomHelpersAndProjectSource = `${editorLiveDomHelpersSource}\n${projectEditorSource}`;
  const editorConstantsAndLiveDomHelpersSource = `${editorConstantsSource}\n${editorLiveDomHelpersSource}`;
  const topbarComponentSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorTopbar.tsx'), 'utf8');
  const editorChromeBitsSource = await readFile(path.join(root, 'lib/html-editor/EditorChromeBits.tsx'), 'utf8');
  const workspaceLogoMenuSource = await readFile(path.join(root, 'Wordpress/editor/WordPressWorkspaceLogoMenu.tsx'), 'utf8');
  const topbarAndProjectSource = `${topbarComponentSource}\n${projectEditorSource}\n${canvasStageSource}`;
  const editorChromeBitsAndTopbarSource = `${editorChromeBitsSource}\n${topbarComponentSource}`;
  const shareDialogSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlShareDialog.tsx'), 'utf8');
  const dialogPrimitiveSource = await readFile(path.join(root, 'components/ui/dialog.tsx'), 'utf8');
  assert.match(
    dialogPrimitiveSource,
    /overlayClassName[\s\S]*?<DialogOverlay className=\{overlayClassName\}/,
    'feature dialogs must be able to lift their backdrop above the complete Builder chrome',
  );
  assert.match(
    shareDialogSource,
    /SHARE_MODAL_OVERLAY_CLASS = 'z-\[11000\][^']*'[\s\S]*?SHARE_MODAL_CONTENT_CLASS =[\s\S]*?z-\[11010\][\s\S]*?SHARE_SELECT_CONTENT_CLASS =[\s\S]*?z-\[11020\][\s\S]*?overlayClassName=\{SHARE_MODAL_OVERLAY_CLASS\}/,
    'sharing must dim the complete z-10000 WordPress chrome while keeping its dialog and portalled controls above the backdrop',
  );
  assert.match(
    shareDialogSource,
    /data-kodety-share-invite-control[\s\S]*?items-stretch[\s\S]*?focus-within:border-\[var\(--kodety-focus\)\]\/70[\s\S]*?<Mail[\s\S]*?data-kodety-share-control-inner[\s\S]*?type="email"[\s\S]*?!m-0[\s\S]*?!h-auto[\s\S]*?!min-h-0[\s\S]*?self-stretch[\s\S]*?!py-0[\s\S]*?focus-visible:!border-0[\s\S]*?focus-visible:!ring-0[\s\S]*?aria-label="Enviar convite"/,
    'the share invitation field must be one compound tokenized surface whose input fills the row without inherited margins',
  );
  assert.doesNotMatch(
    `${shareDialogSource}\n${topbarComponentSource}`,
    /HtmlEditingTurnControl|HtmlCollaborationAvatars|Solicitar turno|Passar para|Na fila|Conectando turno/,
    'the Builder must not expose a turn, queue, pass action or multi-editor participant stack',
  );
  assert.match(
    topbarComponentSource,
    /topbarWp\?\.sharingUrl && !sharedSession[\s\S]*?size="sm"[\s\S]*?onClick=\{\(\) => setShareDialogOpen\(true\)\}[\s\S]*?>\s*Convidar\s*<\/Button>/,
    'sharing invitations must remain available through one explicit text action in the topbar',
  );
  assert.doesNotMatch(
    topbarComponentSource,
    /data-tooltip="Compartilhar"|aria-label="Compartilhar projeto"|<Users\s*\/>/,
    'the topbar must not duplicate the text invitation action with a second icon-only button',
  );
  const topbarToolsSource = topbarComponentSource;
  const topbarSource = topbarComponentSource;
  assert.match(
    topbarComponentSource,
    /kodety-editor-topbar relative z-30/,
    'the topbar must stay above the editor canvas without escaping into standalone panels and fullscreen builders',
  );
  const portalledTopbarMenuOpenings = [
    ...topbarComponentSource.matchAll(/<DropdownMenu(?:Sub)?Content\b[\s\S]*?>/g),
  ].map(match => match[0]);
  assert.equal(
    portalledTopbarMenuOpenings.length,
    4,
    'the topbar must retain its four portalled menu surfaces',
  );
  for (const opening of portalledTopbarMenuOpenings) {
    assert.match(
      opening,
      /className="[^"]*kodety-editor-topbar-overlay z-\[10010\][^"]*"/,
      'every portalled topbar menu must remain above the editor chrome at z-[10010]',
    );
  }
  const portalledTopbarTooltipOpenings = [
    ...topbarComponentSource.matchAll(/<TooltipContent\b[\s\S]*?>/g),
  ].map(match => match[0]);
  assert.equal(
    portalledTopbarTooltipOpenings.length,
    2,
    'Preview must retain the shared action tooltip and the hosted-URL tooltip',
  );
  for (const opening of portalledTopbarTooltipOpenings) {
    assert.match(
      opening,
      /className="[^"]*z-\[10020\][^"]*"/,
      'every portalled topbar tooltip must stay above topbar menus at z-[10020]',
    );
  }
  assert.match(
    topbarComponentSource,
    /activeExtensions\?\.includes\('kodefy-shopify'\)[\s\S]*?Exportar ZIP normal[\s\S]*?Converter para Shopify/,
    'the relative Shopify export choice must exist only behind the active extension contract',
  );
  assert.doesNotMatch(
    `${topbarComponentSource}\n${projectEditorSource}`,
    /HtmlUrlImport|setUrlImportOpen|loadUrlProject|Importar via URL/,
    'URL import must stay completely outside the Builder UI and runtime bundle',
  );
  assert.match(
    projectEditorSource,
    /convertProjectToShopifyThemeZip\(current\)[\s\S]*?layout\/theme\.liquid/,
    'the Shopify export action must invoke the real theme converter and describe its valid layout output',
  );
  assert.match(
    projectEditorSource,
    /activeAnimatedRasterSurfaceRef[\s\S]*?const restartBufferedAnimatedAssets = [\s\S]*?withCanvasGeneration\(generation, \{[\s\S]*?html-editor-buffer-promoted[\s\S]*?const activateBufferedCanvasSurface = [\s\S]*?restartBufferedAnimatedAssets\(node, generation\)[\s\S]*?const reactivatedSurface = activeAnimatedRasterSurfaceRef\.current !== nextSurface[\s\S]*?if \(reactivatedSurface\) \{[\s\S]*?restartBufferedAnimatedAssets\(node, promoted\.generation\)/,
    'canvas promotion and mode reactivation must rebase animated raster playback under the exact iframe generation',
  );
  const projectStorageSource = await readFile(path.join(root, 'lib/html-editor/project-storage.ts'), 'utf8');
  const projectSettingsSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'), 'utf8');
  assert.match(
    projectEditorSource,
    /setInfiniteCanvasEnabled\(false\)[\s\S]*?writeLocalPreference\(INFINITE_CANVAS_PREFERENCE, 'false'\)[\s\S]*?const changeInfiniteCanvasEnabled[\s\S]*?betaFeatures\?\.infiniteCanvas[\s\S]*?url\.searchParams\.set\('section', 'beta'\)[\s\S]*?navigateWithEditorLockHandoff\(url\.toString\(\)\)[\s\S]*?por sua conta e risco/,
    'every editor session must start on the normal canvas and route to standalone Settings when the Infinite Canvas Beta gate is disabled',
  );
  assert.match(
    projectEditorAndCanvasStageSource,
    /const infiniteCanvasBetaEnabled[\s\S]*?betaFeatures\?\.infiniteCanvas[\s\S]*?!infiniteCanvasEnabled[\s\S]*?changeInfiniteCanvasEnabled\(false\)[\s\S]*?\{!editingHtmlComponent && infiniteCanvasBetaEnabled && \([\s\S]*?Canvas infinito · Beta instável/,
    'disabling the Beta gate must leave Infinite Canvas immediately and hide its normal-canvas launcher',
  );
  const stylePreviewTransactionSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/useHtmlStylePreviewTransaction.ts'),
    'utf8',
  );
  const realtimeInspectorSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'), 'utf8');
  const htmlComponentSystemSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlComponentSystem.tsx'), 'utf8');
  const htmlComponentsSource = await readFile(path.join(root, 'lib/html-editor/html-components.ts'), 'utf8');
  const componentPreviewSource = await readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');
  const componentProjectIoSource = await readFile(path.join(root, 'lib/html-editor/project-io.ts'), 'utf8');
  assert.match(
    projectEditorSource,
    /const componentAuthoringCssPath = editingHtmlComponent\?\.component\.bundle\?\.styleFilePath \|\| '';[\s\S]*?const cssFiles = componentAuthoringCssPath[\s\S]*?\[componentAuthoringCssPath\]/,
    'component authoring must keep its private bundle stylesheet authoritative without exposing .incode files in Assets',
  );
  assert.match(
    projectEditorSource,
    /const authoredCssContext: CssEditingContext = \{[\s\S]*?target: 'rule',[\s\S]*?breakpoint: activeViewportBreakpoint/,
    'every normal-canvas style commit must be forced into a class-backed CSS rule',
  );
  assert.match(
    projectEditorSource,
    /const updateLayerVisibility[\s\S]*?pendingResponsiveLayerVisibilityRef\.current = \{ path, visible \}[\s\S]*?type: 'html-editor-select'[\s\S]*?updateVisibility\(pending\.visible\)/,
    'the Layers visibility control must select and author a class rule at every breakpoint',
  );
  assert.doesNotMatch(
    realtimeInspectorSource,
    />\s*(?:Inline style|CSS rule)\s*</i,
    'the Inspector must not expose Inline mode, target tabs, ID or tag selectors',
  );
  assert.doesNotMatch(realtimeInspectorSource, /kodety-editor-context-tabs|Ou use #id \/ tag/);
  assert.match(
    projectEditorSource,
    /const agentComponentSnapshot[\s\S]*?includeSources[\s\S]*?includeInteractions[\s\S]*?includeInstances/,
    'the embedded Agent must be able to inspect native component masters, interactions and placed instances',
  );
  assert.match(
    projectEditorSource,
    /const applyAgentComponentChanges[\s\S]*?expectedRevision[\s\S]*?createComponent[\s\S]*?upsertComponentVariant[\s\S]*?updateComponentInstance[\s\S]*?reorderComponentVariants[\s\S]*?deleteComponentVariant[\s\S]*?deleteComponent/,
    'the embedded Agent must expose one revision-checked semantic transaction for the complete component lifecycle',
  );
  assert.match(
    projectEditorSource,
    /if \(componentDefinitionsChanged\)[\s\S]*?refreshProjectHtmlComponentInstances\(next, library\)[\s\S]*?commitProject\(next\)/,
    'component definition changes must refresh every materialized instance and commit once',
  );
  assert.match(
    projectEditorSource,
    /tool === 'kodety_component_snapshot'[\s\S]*?tool === 'kodety_apply_component_changes'/,
    'the live editor bridge must route both native component tools',
  );
  assert.match(
    agentPanelSource,
    /\['kodety_apply_changes', 'kodety_apply_component_changes', 'kodety_apply_code_component_changes'\][\s\S]*?detachComponentInstance[\s\S]*?deleteComponentVariant[\s\S]*?deleteComponent[\s\S]*?removeInstance[\s\S]*?removeSource/,
    'read-only enforcement and explicit approval must cover destructive native and code component changes',
  );
  assert.match(
    htmlComponentSystemSource,
    /const \[variables, setVariables\] = useState<HtmlComponentVariable\[]>\(\[\]\)[\s\S]*?<DialogFooter[\s\S]*?onChange\(variables\)[\s\S]*?Save variables/,
    'component variables must be edited as one cancellable draft instead of refreshing every instance on each keystroke',
  );
  assert.match(
    htmlComponentSystemSource,
    /const commitValue = \(next: string\) => onCommit\?\.\(next\)[\s\S]*?<HtmlSettingsTextControl[\s\S]*?onChange=\{updateValue\}[\s\S]*?onCommit=\{commitValue\}[\s\S]*?data-component-property=\{variable\.type\}[\s\S]*?grid grid-cols-3 items-start gap-2 py-3/,
    'selected component instances must expose Ycode-style typed property rows and commit text overrides at the edit boundary',
  );
  assert.match(
    htmlComponentsSource,
    /htmlComponentVariableBindings[\s\S]*?variable\.bindings[\s\S]*?htmlComponentVariableHasBinding[\s\S]*?withHtmlComponentVariableBinding[\s\S]*?bindings\.push\(binding\)[\s\S]*?withoutHtmlComponentVariableBinding/,
    'one component variable must own multiple independent property bindings with link and unlink helpers',
  );
  assert.match(
    `${htmlComponentSystemSource}\n${realtimeInspectorSource}`,
    /withHtmlComponentVariableBinding\(variable, \{ targetNodeId: componentNodeId, attribute \}\)[\s\S]*?bindings: \[\{ targetNodeId: componentNodeId, attribute \}\][\s\S]*?defaultValue: currentValue/,
    'linking an existing variable must preserve its shared default while creating one captures the authored value',
  );
  assert.match(
    htmlComponentsSource,
    /const bindings = htmlComponentVariableBindings\(variable\)[\s\S]*?bindings\.forEach\(binding => \{[\s\S]*?componentNode\(root, binding\.targetNodeId\)[\s\S]*?target\.textContent = value/,
    'rendering one variable must apply the same effective value to every linked element',
  );
  assert.match(
    htmlComponentsSource,
    /variable\.type !== 'variant'[\s\S]*?htmlComponentVariableBindings\(variable\)\.length[\s\S]*?variantsById\.has\(value\)/,
    'rendering must discard stale root-variant overrides while accepting targeted nested variants',
  );
  assert.match(
    realtimeInspectorSource,
    /function FieldRow[\s\S]*?const \[draft, setDraft\] = useState\(value\)[\s\S]*?const commit = \(next = draft\)[\s\S]*?<HtmlSettingsTextControl[\s\S]*?value=\{draft\}[\s\S]*?onChange=\{setDraft\}[\s\S]*?onCommit=\{next => \{ if \(!connected\) commit\(next\); \}\}/,
    'inspector text fields must keep a local draft and commit once on blur instead of rebuilding the project on every key',
  );
  assert.match(
    componentPreviewSource,
    /const authoredRuntimeSource = applyCustomCodeToHtml\([\s\S]*?authoredSource[\s\S]*?const componentSource = refreshHtmlComponentInstancesInSource\([\s\S]*?authoredRuntimeSource,[\s\S]*?project,[\s\S]*?htmlComponentLibrary/,
    'the central canvas must hydrate component instances from their masters before rendering',
  );
  assert.match(
    projectEditorSource,
    /finishHtmlComponentEditing[\s\S]*?editorSourceRef\.current = next\.files\[returnPath\]\?\.text \|\| ''[\s\S]*?clearCanvasSelectionForSurfaceChange\(\)[\s\S]*?commitProject\(next\)/,
    'leaving a component must switch the synchronous source authority before mounting the return page canvas',
  );
  assert.match(
    previewSource,
    /document\.addEventListener\('dblclick'[\s\S]*?data-kodety-component-id[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?type: 'html-editor-edit-component'/,
    'double-clicking any materialized descendant of a page component must open its master before inline text editing',
  );
  assert.match(
    previewSource,
    /document\.addEventListener\('dblclick'[\s\S]*?data-coday-code-instance[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?type: 'html-editor-edit-code-component'[\s\S]*?instanceId: codeComponent\.dataset\.codayCodeInstance[\s\S]*?componentVersion: codeComponent\.dataset\.codayCodeVersion/,
    'double-clicking a React descendant must treat the placed Code Component as atomic and open its source before inline text editing',
  );
  assert.match(
    previewSource,
    /const soleCodeComponentSelection = Boolean\([\s\S]*?selected === codeComponent[\s\S]*?querySelectorAll\('\[data-html-editor-selected\]'\)\.length === 1[\s\S]*?if \(!soleCodeComponentSelection\) selectElement\(el, additive\)/,
    'the second click of a Code Component double-click must not emit a duplicate selection transaction',
  );
  assert.match(
    previewSource,
    /const annotateEditorRuntimeSubtree = root =>[\s\S]*?element\.parentElement\?\.closest\?\.\('\[data-coday-code-instance\]'\)[\s\S]*?return;/,
    'runtime annotation must keep React-owned Code Component descendants out of authored HTML selection paths',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-edit-component'[\s\S]*?editHtmlComponentAtPathRef\.current\(message\.path\)[\s\S]*?editHtmlComponentAtPathRef\.current = editHtmlComponentAtPath/,
    'the editor must route a current-generation canvas double click to the canonical component opener',
  );
  assert.match(
    projectEditorSource,
    /const openCodeComponentSource = \([\s\S]*?published\?\.sourcePath[\s\S]*?codeComponentCompileState[\s\S]*?sourcePath\.length === 1[\s\S]*?openCodeFile\(sourcePath\[0\]\)[\s\S]*?openCodeComponentSourceRef\.current = openCodeComponentSource/,
    'the Code Component opener must resolve one editable sourcePath with a legacy compile-state fallback',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-edit-code-component'[\s\S]*?openCodeComponentSourceRef\.current\([\s\S]*?message\.instanceId,[\s\S]*?message\.componentId,[\s\S]*?message\.componentVersion/,
    'a current-generation Code Component double-click must reach the dedicated code-file opener',
  );
  assert.match(
    projectEditorSource,
    /componentEditPersistenceDeferredRef[\s\S]*?holdWordPressDraftDuringComponentEdit[\s\S]*?pendingWordPressDraftProjectRef\.current = next[\s\S]*?nextIsComponentDocument[\s\S]*?componentEditPersistenceDeferredRef\.current = true[\s\S]*?flushDeferredComponentPersistence[\s\S]*?scheduleWordPressDraftWrite\(next\)/,
    'component master edits must remain one local transaction and flush one consolidated remote save on exit',
  );
  assert.match(
    projectEditorSource,
    /const scheduleWordPressDraftWrite = useCallback[\s\S]*?next\.mainHtmlPath\.startsWith\(`\$\{HTML_COMPONENTS_DIRECTORY\}\/`\)[\s\S]*?holdWordPressDraftDuringComponentEdit\(next\)[\s\S]*?return;/,
    'secondary text autosaves must stay paused throughout component editing',
  );
  assert.match(
    projectEditorSource,
    /const componentTransactionActive[\s\S]*?current\?\.mainHtmlPath\.startsWith\(`\$\{HTML_COMPONENTS_DIRECTORY\}\/`\)[\s\S]*?!componentTransactionActive/,
    'failed-upload retries must not restart a full project upload during component editing',
  );
  assert.match(
    projectEditorSource,
    /const schedulePreviewReviewSync = useCallback[\s\S]*?next\.mainHtmlPath\.startsWith\(`\$\{HTML_COMPONENTS_DIRECTORY\}\/`\)[\s\S]*?return;/,
    'component edits must not rebuild and upload hosted review packages before the transaction closes',
  );
  assert.match(
    projectEditorSource,
    /htmlComponentLibraryCacheRef[\s\S]*?cached\?\.metadataSource === metadataSource[\s\S]*?htmlComponentPreviewCacheRef[\s\S]*?cached\.signature === signature[\s\S]*?cached\.dependencyFiles\.every[\s\S]*?buildHtmlComponentPreviewDocument\(project, component, variant\)/,
    'unchanged component definitions and previews must not be reparsed on every active-master edit',
  );
  assert.match(
    componentProjectIoSource,
    /const hydratedComponents = file\.path\.startsWith\(`[\s\S]*?refreshHtmlComponentInstancesInSource\([\s\S]*?const withComponentStyles[\s\S]*?inlineHtmlComponentStyles\([\s\S]*?const withComponents = injectHtmlComponentRuntimeRegistry\([\s\S]*?withComponentStyles/,
    'published HTML must materialize component masters just like the design canvas',
  );
  const liquidLayerProjectionSource = previewSource.slice(
    previewSource.indexOf('export function buildElementTree'),
    previewSource.indexOf('function runtimeAssetPlaceholder'),
  );
  assert.match(
    liquidLayerProjectionSource,
    /(?:filter|delete)[\s\S]*?data-kodety-liquid-/,
    'Layers must filter reversible Liquid projection attributes from its public node snapshots',
  );
  assert.match(
    liquidLayerProjectionSource,
    /const tag = element\.tagName\.toLowerCase\(\);[\s\S]*?if \(tag === 'br'\) return \[\];/,
    'BR must retain its authored DOM/path position while remaining hidden from the Layers projection',
  );
  const liquidSelectionSnapshotSource = previewSource.slice(
    previewSource.indexOf('const snapshotIdentity = el'),
    previewSource.indexOf('const selectElement = (el'),
  );
  assert.match(
    liquidSelectionSnapshotSource,
    /(?:filter|delete)[\s\S]*?data-kodety-liquid-/,
    'canvas selection snapshots must not expose reversible Liquid projection attributes to React state',
  );
  const liquidInspectorAttributeSource = realtimeInspectorSource.slice(
    realtimeInspectorSource.indexOf('const customAttributes ='),
    realtimeInspectorSource.indexOf('const validNewAttribute ='),
  );
  assert.match(
    liquidInspectorAttributeSource,
    /filter[\s\S]*?data-kodety-liquid-/,
    'the Inspector must defensively hide reversible Liquid projection attributes from custom fields',
  );
  const nativeComponentsSource = await readFile(path.join(root, 'lib/html-editor/native-components.ts'), 'utf8');
  const nativeRuntimeSource = await readFile(path.join(root, 'lib/html-editor/native-runtime.ts'), 'utf8');
  const wordpressThemeRuntimeSource = await readFile(path.join(root, 'Wordpress/kodety/theme-runtime/functions.php'), 'utf8');
  const insertMenuSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInsertMenu.tsx'), 'utf8');
  const navigatorSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlNavigator.tsx'), 'utf8');
  const layersTreeSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlLayersTree.tsx'), 'utf8');
  const leftSidebarSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorLeftSidebar.tsx'), 'utf8');
  const rightSidebarSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorRightSidebar.tsx'), 'utf8');
  const projectEditorAndLeftSidebarSource = `${projectEditorSource}\n${leftSidebarSource}`;
  const editorChromeStoreAndLeftSidebarSource = `${editorChromeStoreSource}\n${leftSidebarSource}`;
  const classSelectorSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlClassSelector.tsx'), 'utf8');
  const canvasViewPublisherStart = projectEditorSource.indexOf('const postCanvasViewStateToFrame = useCallback');
  const canvasViewPublisherEnd = projectEditorSource.indexOf('const postDesignTokensToFrame = useCallback', canvasViewPublisherStart);
  assert.ok(
    canvasViewPublisherStart >= 0 && canvasViewPublisherEnd > canvasViewPublisherStart,
    'the parent must expose a dedicated complete Canvas View State publisher',
  );
  const canvasViewPublisherSource = projectEditorSource.slice(canvasViewPublisherStart, canvasViewPublisherEnd);
  assert.match(
    canvasViewPublisherSource,
    /type: 'html-editor-view-state',[\s\S]*?state: snapshot,[\s\S]*?breakpointId:/,
    'Canvas Runtime v2 must publish a named state projection instead of an imperative mutation',
  );
  assert.match(
    canvasViewPublisherSource,
    /postCanvasViewStateToFrame\(iframeRef\.current\?\.contentWindow, projection\)[\s\S]*?passiveCanvasFramesRef\.current\.forEach\(frame => \{[\s\S]*?postCanvasViewStateToFrame\(frame, projection\)/,
    'the same projection and its breakpoint identity must reach the active canvas and every passive Infinite Canvas frame',
  );
  assert.match(
    projectEditorAndCanvasStageSource,
    /message\.type === 'html-editor-canvas-ready'[\s\S]*?postCanvasViewStateToFrame\(sourceFrame\)[\s\S]*?onPassiveFrameLoad=\{\(frame, id\) => \{[\s\S]*?postCanvasViewStateToFrame\(frame\.contentWindow\)/,
    'a newly loaded active or passive frame must hydrate from the latest complete view-state snapshot',
  );
  const canvasViewEnqueueStart = projectEditorSource.indexOf('const enqueueCanvasLiveStyle = useCallback');
  const canvasViewEnqueueEnd = projectEditorSource.indexOf('const runCanvasLiveStyleBatch =', canvasViewEnqueueStart);
  assert.ok(canvasViewEnqueueStart >= 0 && canvasViewEnqueueEnd > canvasViewEnqueueStart, 'the visual commit path must keep an explicit Runtime v2 boundary');
  const canvasViewEnqueueSource = projectEditorSource.slice(canvasViewEnqueueStart, canvasViewEnqueueEnd);
  assert.match(
    canvasViewEnqueueSource,
    /commitCanvasViewTransaction\([\s\S]*?canvasViewStateRef\.current[\s\S]*?latestCanvasViewStateDelta\(canvasViewStateRef\.current\)[\s\S]*?publishCanvasViewStateRef\.current\(delta \|\| snapshot\)/,
    'visual commits must publish the bounded delta after updating the complete retained snapshot',
  );
  assert.match(
    canvasViewStateSource,
    /interface CanvasViewPropertyOwnershipPatch[\s\S]*?scope: 'path' \| 'selector'[\s\S]*?interface CanvasViewStateDelta[\s\S]*?kind: 'delta'[\s\S]*?latestCanvasViewStateDelta[\s\S]*?ownerships: delta\.ownerships\.map/,
    'mounted canvases must receive bounded transaction deltas while the parent retains the complete snapshot',
  );
  assert.match(
    canvasViewStateSource,
    /interface CanvasViewStylePatch[\s\S]*?priority\?: '' \| 'important'/,
    'Canvas View State style atoms must carry the exact authored CSSOM priority',
  );
  assert.match(
    editorLiveDomHelpersSource,
    /diffCanvasLiveStyleDeclarations[\s\S]*?diffStyleDeclarationDetails\(beforeStyle, afterStyle\)[\s\S]*?priority: change\.important \? 'important' : ''[\s\S]*?diffCanvasLiveStyleDeclarations\([\s\S]*?patches\.push\(\{ path, \.\.\.patch \}\)/,
    'inline source diffs must propagate value and priority together into the live Canvas projection',
  );
  assert.doesNotMatch(
    canvasViewEnqueueSource,
    /scheduleCanvasMutationReplayRef\.current|replayPendingCanvasLiveStylesRef\.current|type:\s*'html-editor-live-style'/,
    'Runtime v2 visual commits must not wait for, retry, or replay an ACK-backed mutation',
  );

  const canvasViewBridgeStart = previewSource.indexOf('const normalizeCanvasViewState = state => {');
  const canvasViewBridgeEnd = previewSource.indexOf("if (event.data?.type === 'html-editor-design-tokens') {", canvasViewBridgeStart);
  assert.ok(
    canvasViewBridgeStart >= 0 && canvasViewBridgeEnd > canvasViewBridgeStart,
    'the iframe must keep Canvas View State validation, application and message dispatch inside one auditable boundary',
  );
  const canvasViewBridgeSource = previewSource.slice(canvasViewBridgeStart, canvasViewBridgeEnd);
  assert.match(
    canvasViewBridgeSource,
    /patch\.priority !== undefined[\s\S]*?patch\.priority !== 'important'[\s\S]*?patch\.priority !== undefined \? \{ priority: patch\.priority \} : \{\}/,
    'the Canvas bridge must validate and retain explicit priority additions and removals',
  );
  const canvasViewApplyStart = canvasViewBridgeSource.indexOf('const applyCanvasViewState = rawState => {');
  const canvasViewApplyEnd = canvasViewBridgeSource.indexOf('const remapEditorPathAfterRemoval =', canvasViewApplyStart);
  assert.ok(canvasViewApplyStart >= 0 && canvasViewApplyEnd > canvasViewApplyStart, 'the iframe must keep Runtime v2 application in a bounded one-way section');
  const canvasViewApplySource = canvasViewBridgeSource.slice(canvasViewApplyStart, canvasViewApplyEnd);
  assert.match(
    canvasViewBridgeSource,
    /const normalizeCanvasViewState = state => \{[\s\S]*?state\.protocol !== 1[\s\S]*?Number\.isSafeInteger\(state\.epoch\)[\s\S]*?Number\.isSafeInteger\(state\.version\)/,
    'the iframe must validate protocol, epoch and version before touching its projection',
  );
  assert.match(
    canvasViewBridgeSource,
    /epoch\s*<\s*canvasViewEpoch|canvasViewEpoch\s*>\s*[\w.]+\.epoch/,
    'a snapshot from an older canvas epoch must never repaint a newer document',
  );
  assert.match(
    canvasViewBridgeSource,
    /epoch\s*===\s*canvasViewEpoch[\s\S]{0,220}?version\s*<=\s*canvasViewVersion|canvasViewEpoch\s*===\s*[\w.]+\.epoch[\s\S]{0,220}?canvasViewVersion\s*>=\s*[\w.]+\.version/,
    'within one epoch, the iframe must ignore duplicate and out-of-order snapshots',
  );
  assert.match(
    canvasViewBridgeSource,
    /normalized\.kind === 'delta'[\s\S]*?normalized\.epoch !== canvasViewEpoch[\s\S]*?rememberPathPatch\([\s\S]*?canvasViewPathStyles[\s\S]*?rememberPathPatch\([\s\S]*?canvasViewPathAttributes[\s\S]*?canvasViewPathTexts\.set[\s\S]*?reapplyEditorLiveState\(element, false\)[\s\S]*?return;/,
    'an incremental projection must touch only its changed atoms after the surface snapshot is installed',
  );
  assert.match(
    canvasViewBridgeSource,
    /normalized\.epoch > canvasViewEpoch[\s\S]*?restoreCanvasViewElement[\s\S]*?restoreCanvasViewStylesheet[\s\S]*?restoreCanvasViewDesignTokens/,
    'a new epoch must restore every visual baseline before adopting another document projection',
  );
  assert.match(
    canvasViewBridgeSource,
    /canvasViewStylesheets\.clear\(\)[\s\S]*?canvasViewPathStyles\.clear\(\)[\s\S]*?canvasViewPathAttributes\.clear\(\)[\s\S]*?canvasViewPathTexts\.clear\(\)/,
    'installing a complete snapshot must restore and remove atoms absent from the latest state',
  );
  assert.match(
    canvasViewBridgeSource,
    /state\.stylesheets[\s\S]*?state\.patches[\s\S]*?state\.attributes[\s\S]*?state\.texts[\s\S]*?rawOwnerships[\s\S]*?normalized\.stylesheets[\s\S]*?canvasViewStylesheets\.set[\s\S]*?canvasViewPathStyles\.set[\s\S]*?canvasViewPathAttributes\.set[\s\S]*?canvasViewPathTexts\.set[\s\S]*?canvasViewPropertyOwnerships\.set/,
    'one snapshot must install stylesheet, DOM and visual-ownership atoms as a single projection',
  );
  assert.match(
    canvasViewBridgeSource,
    /canvasViewDesignTokenCssText = normalized\.designTokenCssText[\s\S]*?applyCanvasViewDesignTokens\(canvasViewDesignTokenCssText\)[\s\S]*?changedPaths\.forEach[\s\S]*?reapplyEditorLiveState\(element, false\)/,
    'token and DOM atoms must paint immediately from the accepted snapshot',
  );
  assert.match(
    canvasViewBridgeSource,
    /if \(event\.data\?\.type === 'html-editor-view-state'\) \{[\s\S]*?applyCanvasViewState\(event\.data\.state\);[\s\S]*?return;/,
    'the view-state message branch must delegate exclusively to the validated monotonic applicator',
  );
  assert.match(
    previewSource,
    /authoredCmsBindingSnapshots[\s\S]*?materializeInitialCmsPreview\(document, initialCmsPreview\)[\s\S]*?serializedAuthoredCmsBindingSnapshots/,
    'the iframe document must retain authored CMS values before initial data materialization',
  );
  assert.match(
    previewSource,
    /const isCmsRuntimeAttribute[\s\S]*?const scheduleCmsViewStateRefresh[\s\S]*?refreshedPaths\.forEach\(path => \{[\s\S]*?reapplyEditorLiveState\(element, true, false\)[\s\S]*?applyCmsPreview\(lastCmsPayload\)[\s\S]*?!element\.matches\(cmsSelector\)[\s\S]*?applyCmsBindingElement\(element, null\)[\s\S]*?reapplyEditorLiveState\(element, true, false\)/,
    'CMS configuration must update before rematerialization, preserve each collection item, and restore only bindings that were removed',
  );
  assert.doesNotMatch(
    previewSource,
    /scheduleCmsViewStateRefresh[\s\S]*?applyCmsPreview\(lastCmsPayload\)[\s\S]*?applyCmsBindingElement\(element, lastCmsPayload\.item\)/,
    'a CMS refresh must never overwrite every collection clone with the global preview item',
  );
  assert.match(
    previewSource,
    /const applyCanvasViewStateToElement[\s\S]*?!cmsBindingOwnsTarget\(element, patch\.name\)[\s\S]*?!cmsBindingOwnsTarget\(element, 'content'\)[\s\S]*?const reapplyEditorLiveState[\s\S]*?!cmsBindingOwnsTarget\(element, patch\.name\)[\s\S]*?!cmsBindingOwnsTarget\(element, 'content'\)/,
    'View State and compatibility journals must not overwrite values currently owned by CMS bindings',
  );
  assert.match(
    previewSource,
    /const ensureCmsCollectionOriginal[\s\S]*?const mirrorCmsAttributeToCollectionOriginal[\s\S]*?ensureCmsCollectionOriginal\(container\)[\s\S]*?ensureCmsCollectionOriginal\(candidate\)[\s\S]*?const applyCanvasViewAttributePatchToElement[\s\S]*?mirrorCmsAttributeToCollectionOriginal\(element, patch\)[\s\S]*?Array\.from\(normalized\.attributes\.values\(\)\)[\s\S]*?scheduleCmsViewStateRefresh\(cmsRefreshPaths\)/,
    'CMS attribute deltas must update pristine collection templates and schedule an in-place runtime refresh',
  );
  assert.match(
    previewSource,
    /if \(target === 'src'\) \{[\s\S]*?Object\.entries\(original\.styles \|\| \{\}\)[\s\S]*?if \(typeof value === 'object'/,
    'switching a CMS image binding to a scalar URL must restore authored crop styles before applying the next value',
  );
  assert.match(
    previewSource,
    /const cmsConfigurationSignature[\s\S]*?cmsBefore !== cmsConfigurationSignature[\s\S]*?cmsViewStatePathsInSubtree\(rootElement\)[\s\S]*?scheduleCmsViewStateRefresh\(Array\.from\(replayedCmsPaths\)\)[\s\S]*?const cmsViewStatePathsInSubtree[\s\S]*?scheduleCmsViewStateRefresh\(Array\.from\(viewStatePaths\)\)/,
    'runtime-recreated nodes must rematerialize CMS after View State reinstalls or removes their binding configuration',
  );
  assert.match(
    previewSource,
    /const scheduleCmsRefresh[\s\S]*?if \(pendingCmsViewStatePaths\.size\)[\s\S]*?scheduleCmsViewStateRefresh\(Array\.from\(pendingCmsViewStatePaths\)\)[\s\S]*?applyCmsPreview\(lastCmsPayload\)/,
    'a generic CMS refresh must preserve and drain pending path-aware authored-value restorations',
  );
  assert.doesNotMatch(
    canvasViewApplySource,
    /postEditorMessage|html-editor-live-style-(?:applied|rejected)|mutationId/,
    'accepting a Runtime v2 snapshot must be one-way and must never depend on a visual ACK',
  );
  assert.match(
    previewSource,
    /const pathHasCommittedStyleAtom[\s\S]*?const pathHasCommittedTextAtom[\s\S]*?const pathHasCommittedAttributeAtom[\s\S]*?const pathHasCommittedElementAtom[\s\S]*?const subtreeHasCommittedElementAtom/,
    'the observer must index ownership by exact path and atom instead of treating every runtime mutation as a full-canvas invalidation',
  );
  assert.match(
    previewSource,
    /const committedStateObserver = new MutationObserver[\s\S]*?mutation\.type === 'attributes'[\s\S]*?scheduleCommittedStateReplay\(element, false\)[\s\S]*?mutation\.type === 'characterData'[\s\S]*?pathHasCommittedTextAtom\(path\)[\s\S]*?annotateEditorRuntimeSubtree\(node\)[\s\S]*?subtreeHasCommittedElementAtom\(node\)[\s\S]*?scheduleCommittedStateReplay\(node, true\)/,
    'the mutation observer must repaint one owned element, reserving descendant replay only for a newly inserted matching subtree',
  );
  assert.match(
    previewSource,
    /canvasViewDocumentStyleForElement[\s\S]*?scheduleCanvasViewDocumentReplay[\s\S]*?committedStateObserver\.observe\(document\.documentElement, \{[\s\S]*?subtree: true,[\s\S]*?childList: true,[\s\S]*?attributes: true,[\s\S]*?characterData: true/,
    'stylesheet and token mutations must use the same targeted observer without polling',
  );
  assert.doesNotMatch(
    previewSource,
    /setInterval\([\s\S]{0,180}?(?:reapplyCanvasView|reapplyEditorLiveState|committedState)/,
    'Runtime v2 enforcement must remain mutation-driven instead of polling the page',
  );
  const canvasSemanticSurfaceSource = projectEditorSource.slice(
    projectEditorSource.indexOf('const semanticSurfaceBase = useMemo'),
    projectEditorSource.indexOf('const preview = useMemo', projectEditorSource.indexOf('const semanticSurfaceBase = useMemo')),
  );
  assert.doesNotMatch(
    canvasSemanticSurfaceSource,
    /infiniteCanvasEnabled/,
    'normal and Infinite Canvas must remain projections of the same semantic View State',
  );
  assert.match(
    projectEditorSource,
    /canvasSemanticSurfaceKeyRef\.current[\s\S]*?=== editorCanvasSemanticSurfaceKey[\s\S]*?resetCanvasViewStateRef\.current[\s\S]*?canvasAuthoredStylesRef\.current\.clear\(\)[\s\S]*?canvasLiveStyleJournalRef\.current\.patches\.clear\(\)/,
    'switching semantic documents must clear every path-addressed visual authority before the new frame can hydrate',
  );
  assert.match(
    navigatorSource,
    /onDoubleClick=\{startRename\}[\s\S]*?duplo clique para renomear/,
    'renamable files and pages must expose inline rename through double click',
  );
  const pagePointerDragSource = navigatorSource.slice(
    navigatorSource.indexOf('const startPageTreePointerDrag'),
    navigatorSource.indexOf('const visibleAssets'),
  );
  assert.match(pagePointerDragSource, /elementFromPoint[\s\S]*?data-page-tree-drop-folder/, 'Pages must hit-test pointer drop targets like Layers');
  assert.match(pagePointerDragSource, /Math\.hypot[\s\S]*?< 5/, 'Pages must wait for the Layers-style movement threshold before dragging');
  assert.match(
    pagePointerDragSource,
    /item\.kind === "folder"[\s\S]*?onPageFolderMove[\s\S]*?onPageMove/,
    'the Pages pointer drop must dispatch folder and page moves through their canonical mutations',
  );
  assert.match(navigatorSource, /data-page-tree-drop-folder=""[\s\S]*?Raiz de Pages/, 'Pages must expose an explicit pointer drop target for the root');
  assert.match(
    navigatorSource,
    /isTemplatePage \? "text-violet-300" : "text-\[var\(--kodety-accent-hover\)\]"/,
    'ordinary page icons must use the light Kodety accent while CMS and extension template pages stay light purple',
  );
  assert.match(
    layersTreeSource,
    /const scrollSectionId = node\.attributes\.id\?\.trim\(\)[\s\S]*?data-layer-indicator="scroll-section"[\s\S]*?Scroll section #\$\{scrollSectionId\}/,
    'layers with navigable IDs must expose a compact scroll-section hash indicator',
  );
  assert.match(
    layersTreeSource,
    /resolveHtmlLayerPresentation\([\s\S]*?data-layer-name-source=\{presentation\.source\}[\s\S]*?\{presentation\.name\}/,
    'layers must lead with their semantic identity',
  );
  assert.doesNotMatch(layersTreeSource, /data-layer-element-type|\{presentation\.type\}/, 'layers must not render HTML element types as secondary metadata');
  assert.match(
    layersTreeSource,
    /interactionSelectors\.some[\s\S]*?data-layer-indicator="interaction"[\s\S]*?<ZapFill className="size-3"/,
    'layers participating in Interactions must expose a compact lightning indicator',
  );
  assert.match(
    layersTreeSource,
    /function isNativeLocaleSelectorNode[\s\S]*?data-kodety-locale-selector[\s\S]*?data-incode-component[\s\S]*?locales-list[\s\S]*?function isNativeLocaleOverlayNode[\s\S]*?data-kodety-locale-options/,
    'the Layers panel must recognize both the native language selector and its floating options overlay structurally',
  );
  assert.match(
    layersTreeSource,
    /<Globe2[\s\S]*?Overlay de idiomas[\s\S]*?Seletor de idiomas[\s\S]*?text-\[var\(--kodety-accent\)\]/,
    'language selector layers must retain the Kodety globe icon and accent',
  );
  assert.match(
    layersTreeSource,
    /data-layer-indicator="scroll-section"[\s\S]*?text-white\/45/,
    'scroll-section tags must stay neutral gray instead of competing with editor actions',
  );
  assert.match(
    layersTreeSource,
    /data-layer-indicator="interaction"[\s\S]*?text-\[var\(--kodety-accent-hover\)\]/,
    'the Interactions indicator should use the Builder accent color',
  );
  assert.match(
    layersTreeSource,
    /const SELECTED_DESCENDANT_BG =[\s\S]*?color-mix\(in srgb, var\(--kodety-accent\) 18%, var\(--kodety-panel\)\)[\s\S]*?const SELECTED_DESCENDANT_HOVER_BG =[\s\S]*?color-mix\(in srgb, var\(--kodety-accent\) 24%, var\(--kodety-panel\)\)[\s\S]*?const rowBg = isSelected[\s\S]*?"var\(--primary\)"[\s\S]*?isChildOfSelected[\s\S]*?SELECTED_DESCENDANT_BG[\s\S]*?SELECTED_DESCENDANT_HOVER_BG/,
    'selected layers and their visible descendants must use the connected Kodety accent surface',
  );
  assert.match(
    layersTreeSource,
    /const componentInstance = Boolean\(node\.attributes\["data-kodety-component-id"\]\)[\s\S]*?componentInstance[\s\S]*?color-mix\(in srgb, rgb\(147 51 234\) 46%, var\(--kodety-panel\)\)[\s\S]*?isSelected && componentInstance && "text-purple-50"/,
    'selected component instances must use an opaque purple mix so the sticky actions do not double the tint',
  );
  assert.match(
    layersTreeSource,
    /function HtmlLayerIcon[\s\S]*?text-\[var\(--kodety-accent\)\][\s\S]*?getHtmlElementIcon\(node\)/,
    'every element-type icon in Layers must use the blue editor accent',
  );
  assert.match(
    layersTreeSource,
    /<ContextMenuTrigger asChild>[\s\S]*?<ContextMenuContent[\s\S]*?onToggleVisibility\(entry\.node\.path, hidden\)/,
    'every Ycode row must expose its complete action system through right click',
  );
  assert.match(
    layersTreeSource,
    /data-layer-path=\{node\.path\}[\s\S]*?focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-\[var\(--kodety-focus\)\]/,
    'layer focus rings must render inside the rounded row so panel clipping cannot cut them',
  );
  const layerScrollIndicatorIndex = layersTreeSource.indexOf('data-layer-indicator="scroll-section"');
  const layerVisibilityIndex = layersTreeSource.indexOf('onToggleVisibility(node.path, hidden)', layerScrollIndicatorIndex);
  assert.ok(
    layerScrollIndicatorIndex >= 0 && layerVisibilityIndex > layerScrollIndicatorIndex,
    'layer metadata indicators must sit immediately before the Ycode visibility control',
  );
  assert.match(
    layersTreeSource,
    /data-ycode-layers-tree[\s\S]*?bg-\[var\(--kodety-panel\)\]/,
    'the imported Ycode tree must retain the exact Kodety panel background tone',
  );
  assert.doesNotMatch(
    navigatorSource,
    /NavigatorNode|layerVirtualizer|layersScrollRef/,
    'the removed Kodety tree must not remain as dead code beside the Ycode implementation',
  );
  assert.match(
    projectEditorAndLeftSidebarSource,
    /const navigatorInteractionSelectors = useMemo\([\s\S]*?interaction\.triggerSelector[\s\S]*?action\.target\.selector[\s\S]*?<HtmlNavigator[\s\S]*?interactionSelectors=\{navigatorInteractionSelectors\}/,
    'the Layers panel must receive trigger and target selectors from the current Interactions document',
  );
  assert.doesNotMatch(navigatorSource, /window\.prompt\("Novo caminho da página"/, 'renaming a page must not fall back to a blocking browser prompt');
  assert.match(
    topbarComponentSource,
    /onDoubleClick=\{startInlineProjectRename\}[\s\S]*?Duplo clique para renomear o projeto/,
    'the project title must share the platform double-click rename convention',
  );
  assert.match(
    classSelectorSource,
    /onDoubleClick=\{\(event\) => \{[\s\S]*?setRenaming\(true\)/,
    'renamable CSS class chips must share the platform double-click rename convention',
  );
  assert.match(
    classSelectorSource,
    /Combo class[\s\S]*?Depende da classe base[\s\S]*?Reutilizável[\s\S]*?Seletor próprio, aplicável em qualquer elemento[\s\S]*?Classes reutilizáveis/,
    'the class selector must distinguish dependent combos from the reusable project library',
  );
  assert.match(
    classSelectorSource,
    /data-ycode-class-selector[\s\S]*?<Label variant=["']muted["'][^>]*>[\s\S]*?Classes[\s\S]*?chips\.map\([\s\S]*?<ClassChip/,
    'the class selector must use the Ycode label grid while retaining reusable-class identity without decorative icons',
  );
  assert.match(
    classSelectorSource,
    /data-reusable-class=\{reusable \|\| undefined\}[\s\S]*?>Reutilizável<\/strong>/,
    'reusable classes must retain semantic identity and a text label after removing their decorative icon',
  );
  assert.doesNotMatch(classSelectorSource, /\bShare2\b/, 'reusable class chips and choices must not regain a decorative share icon');
  assert.doesNotMatch(
    classSelectorSource,
    /\bCrosshair\b/,
    'the removed Kodety class-selector header icon must not remain as dead code beside the Ycode field',
  );
  assert.match(
    classSelectorSource,
    /classEditingSelector\([\s\S]*?onRegisterReusableClass\([\s\S]*?reusableSet/,
    'reusable chips must resolve standalone selectors and register their project-wide identity',
  );
  assert.match(
    projectEditorSource,
    /normalizeReusableClassNames\(editorMetadataSnapshot\?\.reusableClasses\)[\s\S]*?registerReusableProjectClass[\s\S]*?reusableClasses: \[\.\.\.stored, trimmed\][\s\S]*?<HtmlInspector[\s\S]*?reusableClasses=\{reusableClasses\}[\s\S]*?onRegisterReusableClass=/,
    'the project editor must persist and expose the reusable-class registry to the inspector',
  );
  assert.match(
    editorLiveDomHelpersAndProjectSource,
    /function patchSelectionSnapshotAttributes\([\s\S]*?hasOwnProperty\.call\(changes, 'class'\)[\s\S]*?split\(\/\\s\+\/\)[\s\S]*?const updateAttributes[\s\S]*?setSelection\(current => \{[\s\S]*?patchSelectionSnapshotAttributes\(current, changes\)/,
    'class attribute mutations must synchronously update the selected snapshot used by reusable class chips',
  );
  assert.match(
    editorChromeStoreAndLeftSidebarSource,
    /insertPanelOpen: false[\s\S]*?data-builder-sidebar-rail[\s\S]*?aria-controls="html-editor-insert-panel"[\s\S]*?insertPanelOpen \? \([\s\S]*?<HtmlInsertMenu[\s\S]*?width=\{leftSidebarWidth\}/,
    'Insert must be launched from the persistent sidebar rail and replace the Layers panel',
  );
  assert.match(
    leftSidebarSource,
    /data-builder-sidebar-rail[\s\S]*?data-tooltip="Insert"[\s\S]*?panel="layers"[\s\S]*?panel="pages"[\s\S]*?panel="assets"[\s\S]*?data-tooltip="Variables"[\s\S]*?membershipExtensionActive[\s\S]*?data-tooltip="Membership"[\s\S]*?data-tooltip="Code"[\s\S]*?data-tooltip="Languages"/,
    'the Webflow-style sidebar rail must expose icon-only builder destinations in the requested order and gate Membership by its extension',
  );
  const sidebarRailStart = leftSidebarSource.indexOf('data-builder-sidebar-rail');
  const sidebarRailEnd = leftSidebarSource.indexOf('data-builder-sidebar-utility-group', sidebarRailStart);
  const sidebarRailSource = sidebarRailStart >= 0 && sidebarRailEnd > sidebarRailStart ? leftSidebarSource.slice(sidebarRailStart, sidebarRailEnd) : '';
  assert.doesNotMatch(
    sidebarRailSource,
    /data-tooltip="CMS"|aria-label="CMS"/,
    'CMS must leave the builder sidebar after becoming a primary workspace destination',
  );
  assert.match(
    leftSidebarSource,
    /data-tooltip="Languages"[\s\S]*?data-builder-sidebar-utility-group[\s\S]*?className="mt-auto[\s\S]*?data-mcp-state=[\s\S]*?Visualizar como \$\{membershipPreviewLabel\}[\s\S]*?HtmlProjectSettingsRail(?:Link|Button)/,
    'MCP, Membership preview and Settings must live together in the bottom utility group of the sidebar rail',
  );
  assert.match(
    leftSidebarSource,
    /DISCORD_COMMUNITY_URL = 'https:\/\/discord\.gg\/PfHSRE7Faj'[\s\S]*?data-mcp-state=[\s\S]*?rel="noopener noreferrer"[\s\S]*?data-kodety-community-link[\s\S]*?data-tooltip=\{communityLabel\}/,
    'the localized Discord community action must live directly below MCP and open safely in a new tab',
  );
  assert.match(
    leftSidebarSource,
    /Visualizar como \$\{membershipPreviewLabel\}[\s\S]*?<PopoverContent[\s\S]*?className="kodety-editor-sidebar-overlay[^\"]*border-0 bg-transparent p-0 shadow-none"[\s\S]*?<HtmlMembershipPreviewSelector/,
    'the membership preview popover shell must be visually transparent so only the selector surface remains',
  );
  assert.doesNotMatch(
    topbarSource,
    /data-tooltip="Settings"|data-mcp-state=|Visualizar como \$\{membershipPreviewLabel\}/,
    'Settings, MCP and Membership preview must no longer render in the topbar',
  );
  assert.doesNotMatch(
    navigatorSource,
    /TabsList|TabsTrigger|aria-label="Painéis do projeto"/,
    'Pages, Layers and Assets must no longer render as tabs inside the navigator',
  );
  assert.doesNotMatch(
    navigatorSource,
    /<hr className="mt-2 border-\[var\(--kodety-divider\)\]" \/>/,
    'navigator destinations must not render a redundant divider before their content',
  );
  assert.match(
    navigatorSource,
    /aria-label="Comprimir imagens"[\s\S]*?<Minimize2 className="size-3\.5" \/>[\s\S]*?<p>Comprimir imagens<\/p>[\s\S]*?aria-label="Converter formato das imagens"[\s\S]*?<Repeat2 className="size-3\.5" \/>[\s\S]*?<p>Converter formato<\/p>/,
    'the media header must use distinct icon-only compression and conversion actions with hover tooltips',
  );
  const assetPreviewSource = navigatorSource.slice(
    navigatorSource.indexOf('function AssetPreview'),
    navigatorSource.indexOf('function isVisualAsset'),
  );
  assert.match(
    assetPreviewSource,
    /<video[\s\S]*?preload="metadata"[\s\S]*?onPointerEnter=[\s\S]*?playAssetVideoPreview[\s\S]*?onPointerLeave=[\s\S]*?stopAssetVideoPreview/,
    'asset video previews must play only while hovered and avoid eager media loading',
  );
  assert.doesNotMatch(
    assetPreviewSource,
    /\bautoPlay\b/,
    'asset video previews must never autoplay in a loop while the Assets panel is idle',
  );
  const mediaHeaderStart = navigatorSource.indexOf('<span className="min-w-0 flex-1">Mídia</span>');
  const mediaHeaderEnd = navigatorSource.indexOf('</div>', mediaHeaderStart);
  const mediaHeaderSource = mediaHeaderStart >= 0 && mediaHeaderEnd > mediaHeaderStart ? navigatorSource.slice(mediaHeaderStart, mediaHeaderEnd) : '';
  assert.doesNotMatch(
    mediaHeaderSource,
    /<Minimize2 \/> Comprimir[\s\S]*?<ArrowRight \/> Converter/,
    'the media header must not return to labeled action buttons',
  );
  assert.doesNotMatch(
    topbarToolsSource,
    /data-tooltip="(?:Insert|Variables|CMS|Membership|Code|Languages)"/,
    'destinations moved to the sidebar rail must disappear from the topbar',
  );
  assert.match(
    projectEditorSource,
    /data-workspace-primary-navigation[\s\S]*?<CursorIcon[\s\S]*?<span>Design<\/span>[\s\S]*?<DatabaseIcon[\s\S]*?<span>CMS<\/span>[\s\S]*?<ChartSquareIcon[\s\S]*?<span>Insights<\/span>/,
    'Design, CMS and Insights must form the primary workspace navigation in the common topbar',
  );
  assert.match(
    projectEditorSource,
    /const standaloneWorkspaceTopbar[\s\S]*?<WordPressWorkspaceLogoMenu\b[^>]*\bconfig=\{topbarWp\}[^>]*\bonNavigate=\{navigateAfterWordPressSave\}/,
    'CMS, Insights and Settings must use the shared corner menu with guarded project navigation',
  );
  assert.match(
    workspaceLogoMenuSource,
    /data-editor-corner-menu-trigger[\s\S]*?size-\[50px\][\s\S]*?size-9 place-items-center rounded-\[7px\][\s\S]*?<EditorCornerMenuGlyph name=\{config\?\.editorCornerIcon\} logoUrl=\{config\?\.brandLogoUrl\}/,
    'workspace menus must keep the same 50px corner cell, 36px hover surface and compact logo glyph as Design',
  );
  assert.match(
    workspaceLogoMenuSource,
    /<HtmlKodetyUpdateMenuItems[\s\S]*?<HtmlOnboardingMenuItem/,
    'workspace menus must keep the optional onboarding entry below updates',
  );
  assert.match(
    editorChromeBitsAndTopbarSource,
    /function EditorCornerIcon[\s\S]*?h-6 w-\[22px\][\s\S]*?function EditorCornerMenuGlyph[\s\S]*?relative grid size-5[\s\S]*?h-5! w-auto! max-w-5![\s\S]*?data-editor-corner-hamburger[\s\S]*?gap-1[\s\S]*?group-hover:flex group-data-\[state=open\]:flex[\s\S]*?w-\[18px\][\s\S]*?<button[\s\S]*?data-editor-corner-menu-trigger[\s\S]*?h-\[50px\]! w-\[50px\]![\s\S]*?style=\{\{ width: 50, height: 50, borderRadius: 0 \}\}[\s\S]*?data-editor-corner-menu-surface[\s\S]*?size-9 place-items-center rounded-\[7px\][\s\S]*?group-hover:bg-white\/\[0\.055\][\s\S]*?group-data-\[state=open\]:bg-white\/\[0\.09\][\s\S]*?<EditorCornerMenuGlyph/,
    'the Kodety corner menu must keep a 50px structural cell, a compact 20px logo, and the rail 36px rounded-square hover surface',
  );
  assert.match(
    topbarComponentSource,
    /<EditorCornerMenuGlyph[\s\S]*?menuOnly=\{topbarWp\?\.studio\?\.enabled === true\}/,
    'an embedded Studio Builder must keep the corner menu without repeating the Kodety product mark',
  );
  assert.match(
    editorChromeBitsSource,
    /menuOnly \? 'flex' : 'hidden group-hover:flex group-data-\[state=open\]:flex'/,
    'the Studio-specific corner trigger must remain visibly recognizable as a menu',
  );
  assert.match(
    topbarComponentSource,
    /<DropdownMenuContent[\s\S]*?align="start"[\s\S]*?sideOffset=\{8\}[\s\S]*?collisionPadding=\{12\}[\s\S]*?kodety-editor-topbar-overlay/,
    'the Kodety corner menu must keep a visible margin from the browser edges',
  );
  assert.match(
    topbarComponentSource,
    /<DropdownMenuContent[\s\S]*?data-kodety-logo-menu[\s\S]*?rounded-\[10px\][\s\S]*?bg-\[var\(--kodety-panel\)\][\s\S]*?<DropdownMenuLabel[\s\S]*?>\s*Projeto\s*<\/DropdownMenuLabel>[\s\S]*?<DropdownMenuLabel[\s\S]*?>\s*Editar\s*<\/DropdownMenuLabel>/,
    'the Kodety logo menu must use the canonical panel surface and semantic compact section labels',
  );
  assert.match(leftSidebarSource, /data-builder-sidebar-rail[\s\S]*?w-\[50px\]/, 'the builder rail must align with the 50px square Kodety corner area');
  assert.match(
    projectEditorSource,
    /data-workspace-primary-navigation[\s\S]*?className="flex min-w-0 items-center gap-0\.5"[\s\S]*?bg-white\/\[0\.11\] text-\[var\(--kodety-text\)\]/,
    'Design, CMS and Insights must remain independent neutral tabs without a connected outer surface',
  );
  assert.doesNotMatch(
    editorChromeBitsAndTopbarSource,
    /WORKSPACE_PRIMARY_NAV_CLASSNAME|workspacePrimaryNavigationItemClassName|kodety-accent-muted/,
    'primary workspace tabs must not regain a shared stroked capsule or purple active surface',
  );
  const kodetyMenuTriggerStart = topbarComponentSource.indexOf('title="Abrir menu do Onun Kodety"');
  const kodetyMenuTriggerEnd = topbarComponentSource.indexOf('</DropdownMenuTrigger>', kodetyMenuTriggerStart);
  const kodetyMenuTriggerSource =
    kodetyMenuTriggerStart >= 0 && kodetyMenuTriggerEnd > kodetyMenuTriggerStart
      ? topbarComponentSource.slice(kodetyMenuTriggerStart, kodetyMenuTriggerEnd)
      : '';
  assert.ok(kodetyMenuTriggerSource, 'the Kodety corner menu trigger must remain available');
  assert.doesNotMatch(kodetyMenuTriggerSource, /<ChevronDown/, 'the Kodety corner trigger must not retain a separate down arrow');
  assert.doesNotMatch(
    topbarSource,
    /<span[^>]*>Layout<\/span>|<span[^>]*>Text<\/span>|data-tooltip="Analytics"/,
    'Layout and Text must leave the topbar, and Analytics must not remain duplicated beside Preview',
  );
  assert.match(
    projectEditorSource,
    /appView === 'cms'[\s\S]*?standaloneWorkspaceTopbar\('cms'\)[\s\S]*?appView === 'analytics'[\s\S]*?standaloneWorkspaceTopbar\('insights'\)[\s\S]*?appView === 'settings'[\s\S]*?standaloneWorkspaceTopbar\(null\)/,
    'CMS, Insights and Settings must retain the shared workspace topbar',
  );
  assert.match(
    insertMenuSource,
    /id="html-editor-insert-panel"[\s\S]*?gridTemplateColumns: `\$\{width\}px \$\{detailWidth\}px`[\s\S]*?<aside[\s\S]*?Elements[\s\S]*?CMS[\s\S]*?Components/,
    'the Insert catalog must keep categories in the sidebar and open its catalog beside them',
  );
  assert.match(
    insertMenuSource,
    /aspect-\[1\.04\][\s\S]*?CATALOG_ICON_CLASS[\s\S]*?\{item\.label\}[\s\S]*?\{item\.hint\}/,
    'insertable elements must render as visual cards with a Solar icon, label and description',
  );
  assert.match(
    insertMenuSource,
    /@solar-icons\/react\/bold-duotone\/structure[\s\S]*?@solar-icons\/react\/bold-duotone\/box-minimalistic[\s\S]*?@solar-icons\/react\/bold-duotone\/text-field[\s\S]*?@solar-icons\/react\/bold-duotone\/gallery[\s\S]*?@solar-icons\/react\/bold-duotone\/window-frame[\s\S]*?@solar-icons\/react\/bold-duotone\/programming[\s\S]*?@solar-icons\/react\/bold-duotone\/star/,
    'Insert information-architecture icons must use the approved Solar Bold Duotone exception',
  );
  assert.match(
    insertMenuSource,
    /const CATEGORY_META[\s\S]*?icon: StructureIcon[\s\S]*?icon: BoxMinimalisticIcon[\s\S]*?icon: TextFieldIcon[\s\S]*?icon: DatabaseIcon[\s\S]*?icon: GalleryIcon[\s\S]*?icon: TextFieldFocusIcon[\s\S]*?icon: WindowFrameIcon[\s\S]*?icon: ProgrammingIcon[\s\S]*?icon: StarIcon[\s\S]*?size-8 shrink-0[\s\S]*?<Icon className="size-\[18px\]" \/>/,
    'every Insert category must retain a semantic duotone glyph inside the neutral 32px navigation target',
  );
  assert.match(
    insertMenuSource,
    /data-kodety-insert-search-control[\s\S]*?h-8 min-w-0 overflow-hidden rounded-\[8px\][\s\S]*?border border-transparent bg-white\/\[\.05\][\s\S]*?focus-within:border-\[var\(--kodety-focus\)\]\/70[\s\S]*?focus-visible:border-transparent focus-visible:ring-0/,
    'Insert search must be one 32px tokenized compound surface with one focus stroke',
  );
  assert.match(
    insertMenuSource,
    /key: "locales-list"[\s\S]*?label: "Locales List"[\s\S]*?icon: GlobalIcon/,
    'Locales List must use the locale/language icon instead of a generic list glyph',
  );
  assert.match(
    insertMenuSource,
    /setData\("application\/x-incode-insert", key\)[\s\S]*?html-editor-insert-drag-start[\s\S]*?html-editor-insert-drag-end/,
    'the redesigned Insert catalog must preserve canvas drag-and-drop',
  );
  assert.match(
    insertMenuSource,
    /const panelRef = useRef<HTMLElement>\(null\)[\s\S]*?closeOnOutsidePointer[\s\S]*?panelRef\.current\?\.contains\(target\)[\s\S]*?target\.closest\([\s\S]*?\[data-insert-panel-trigger\][\s\S]*?document\.addEventListener\("pointerdown", closeOnOutsidePointer, true\)[\s\S]*?ref=\{panelRef\}/,
    'Insert must close on an outside pointer while preserving clicks inside the panel and on its toggle',
  );
  assert.match(
    leftSidebarSource,
    /data-insert-panel-trigger[\s\S]*?aria-controls="html-editor-insert-panel"/,
    'the Insert toggle must be excluded from outside-click dismissal so it can still close the panel itself',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-selection'[\s\S]*?message\.origin === 'canvas' && message\.detail !== 'computed'[\s\S]*?setInsertPanelOpen\(false\)[\s\S]*?setEffectsLibraryOpen\(false\)[\s\S]*?setVariablesPanelOpen\(false\)/,
    'only the identity snapshot from a real canvas gesture may dismiss attached sidebar panels',
  );
  assert.match(
    insertMenuSource,
    /const insert = \(key: string\) => \{\s*onInsert\(key\);\s*\};/,
    'inserting an element from inside Insert must keep the panel open',
  );
  assert.match(
    insertMenuSource,
    /onClick=\{\(\) => \{\s*onInsertCodeComponent\?\.\(component\.id, component\.version\);\s*\}\}[\s\S]*?onInsert=\{\(\) => \{\s*onInsertComponent\?\.\(component\.id\);\s*\}\}/,
    'code and reusable component insertion must keep the Insert panel open',
  );
  assert.match(
    insertMenuSource,
    /onEdit=\{\(\) => \{\s*onEditComponent\?\.\(component\.id\);\s*\}\}[\s\S]*?onRename=\{\(\) => \{\s*onRenameComponent\?\.\(component\.id\);\s*\}\}/,
    'component edit and rename actions inside Insert must not implicitly close the panel',
  );
  assert.match(
    projectEditorSource,
    /onEditComponent: componentId => openHtmlComponentEditor\([\s\S]*?preserveNavigatorOverlays: true/,
    'component editing launched inside Insert must preserve the originating sidebar panel',
  );
  const attachedEffectsPropsStart = projectEditorSource.indexOf('interactionLibraryProps={selection ? {');
  const attachedEffectsPropsEnd = projectEditorSource.indexOf('designTokenPanelProps={{', attachedEffectsPropsStart);
  assert.ok(
    attachedEffectsPropsStart >= 0 && attachedEffectsPropsEnd > attachedEffectsPropsStart,
    'the attached Effects panel props must remain auditable',
  );
  assert.doesNotMatch(
    projectEditorSource.slice(attachedEffectsPropsStart, attachedEffectsPropsEnd),
    /setEffectsLibraryOpen\(false\)/,
    'applying an effect from inside the attached panel must not close it',
  );
  assert.doesNotMatch(insertMenuSource, /<Popover|PopoverContent|PopoverTrigger/, 'Insert must no longer be constrained to a floating popover');
  const elementMarkupStart = editorConstantsSource.indexOf('const ELEMENT_MARKUP: Record<string, string> = {');
  const elementMarkupEnd = editorConstantsSource.indexOf('const CONTAINER_TAGS = new Set([', elementMarkupStart);
  assert.ok(elementMarkupStart >= 0 && elementMarkupEnd > elementMarkupStart, 'the complete Insert markup catalog must remain auditable');
  const elementMarkupSource = editorConstantsSource.slice(elementMarkupStart, elementMarkupEnd);
  const insertCatalogBlock = insertMenuSource.slice(
    insertMenuSource.indexOf('const INSERT_ITEMS: InsertItem[] = ['),
    insertMenuSource.indexOf('const CATEGORY_META:'),
  );
  const solarInsertIconImports = new Set(
    [...insertMenuSource.matchAll(
      /import \{\s*([A-Za-z0-9]+)\s*\} from "@solar-icons\/react\/bold-duotone\/[^"]+";/g,
    )].map(match => match[1]),
  );
  const insertIconNames = [...insertCatalogBlock.matchAll(/icon: ([A-Za-z0-9]+),/g)]
    .map(match => match[1]);
  assert.deepEqual(
    [...new Set(insertIconNames)].filter(icon => !solarInsertIconImports.has(icon)),
    [],
    'every built-in Insert card must use a Solar Bold Duotone icon',
  );
  const insertCatalogCardSource = insertMenuSource.slice(
    insertMenuSource.indexOf('const CATALOG_CARD_CLASS ='),
    insertMenuSource.indexOf('type CatalogSection ='),
  );
  assert.match(
    insertCatalogCardSource,
    /hover:border-\[var\(--kodety-accent-hover\)\]\/70[\s\S]*?group-hover:text-\[var\(--kodety-accent-hover\)\]/,
    'Insert cards must paint their border and Solar icon violet on hover',
  );
  assert.doesNotMatch(
    insertCatalogCardSource,
    /hover:-?translate-y|transition-\[[^\]]*transform/,
    'Insert cards must remain spatially stable on hover',
  );
  const catalogKeys = [...insertCatalogBlock.matchAll(/key: "([^"]+)"/g)].map(match => match[1]);
  const markupKeys = new Set([...elementMarkupSource.matchAll(/^  (?:'([^']+)'|([a-zA-Z0-9-]+)):/gm)].map(match => match[1] || match[2]));
  const membershipCatalogKeys = new Set([
    'membership-gate',
    'membership-login',
    'membership-register',
    'membership-forgot-password',
    'membership-reset-password',
    'membership-profile',
    'membership-logout',
  ]);
  const settingsActionCatalogKeys = new Set(['cookie-consent']);
  assert.deepEqual(
    [...new Set(catalogKeys)].filter(key => !markupKeys.has(key) && !membershipCatalogKeys.has(key) && !settingsActionCatalogKeys.has(key)),
    [],
    'every Insert catalog item must resolve to styled markup, a styled factory or an explicit Settings action',
  );
  for (const label of ['Frame', 'Stack', 'Row', 'Grid', 'Masonry', 'Header', 'Navigation', 'Main', 'Section', 'Article', 'Aside', 'Footer']) {
    assert.match(
      elementMarkupSource,
      new RegExp(`data-label="${label}"[^>]*style="[^"]*min-height: 600px;`),
      `the inserted ${label} structure must start with at least 600px of usable height`,
    );
  }
  for (const tag of ['form', 'button', 'input', 'textarea', 'select', 'details', 'summary', 'audio', 'video', 'iframe', 'img']) {
    const starts = [...elementMarkupSource.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(match => match[0]);
    assert.ok(starts.length > 0, `Insert must keep at least one ${tag} example`);
    assert.ok(
      starts.every(start => /\bstyle=/.test(start)),
      `every inserted ${tag} must carry its neutral visual baseline instead of browser-default styling`,
    );
  }
  assert.match(
    editorConstantsSource,
    /const NEUTRAL_CONTROL_STYLE =[\s\S]*?border-radius: 14px[\s\S]*?background: #f5f5f5[\s\S]*?const NEUTRAL_BUTTON_STYLE =[\s\S]*?background: #2b2b2b[\s\S]*?color: #ffffff/,
    'Insert controls and actions must share a polished neutral design system',
  );
  assert.match(
    elementMarkupSource,
    /form: `<form[\s\S]*?Jane Smith[\s\S]*?jane@company\.com[\s\S]*?Subject[\s\S]*?Select a subject…[\s\S]*?width: 100%;[\s\S]*?>Send message<\/button>[\s\S]*?data-kodety-form-success[\s\S]*?data-kodety-form-error[\s\S]*?<\/form>`/,
    'the default form block must arrive as a complete neutral form composition',
  );
  assert.doesNotMatch(
    elementMarkupSource,
    /border-radius:\s*0;\s*background:\s*transparent/,
    'inserted controls must never fall back to the former sharp transparent browser-like appearance',
  );
  assert.match(
    previewSource,
    /if \(inspectionEnabled\) \{[\s\S]*?const nativeControlSelector = 'input, textarea, select, video, audio';[\s\S]*?addEventListener\('mousedown'[\s\S]*?event\.preventDefault\(\)[\s\S]*?addEventListener\('keydown'/,
    'native control popovers must be suppressed in Design mode and remain exclusive to Preview',
  );
  assert.match(
    projectEditorSource,
    /buildPreview\([\s\S]*?!animatedCanvas,[\s\S]*?canvasLockedPaths,[\s\S]*?!isPreviewing && mode === 'design' && !workspaceReadOnly,/,
    'runtime Preview must never receive the inline-content-editing capability',
  );
  assert.match(
    previewSource,
    /document\.addEventListener\('click', event => \{[\s\S]*?if \(!inspectionEnabled\) return;[\s\S]*?const additive = event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey[\s\S]*?selectElement\(el, additive\)/,
    'the canvas selection capture listener must be a strict no-op in runtime Preview',
  );
  assert.match(
    previewSource,
    /const bridge = document\.createElement\('script'\);[\s\S]*?globalThis\.__CODAY_RENDER_TARGET__ = \$\{inspectionEnabled \? "'canvas'" : "'preview'"\};[\s\S]*?document\.body\.appendChild\(bridge\)/,
    'the classic iframe bridge must set Canvas versus Preview before deferred Code Component modules mount',
  );
  assert.match(
    previewSource,
    /if \(!inspectionEnabled\) \{[\s\S]*?const previewLinkAnchor[\s\S]*?event\.composedPath[\s\S]*?href\.startsWith\('#'\)[\s\S]*?requestId = intent\.disposition === 'new-context' \? previewLinkRequestId\(\) : ''[\s\S]*?Element\.prototype\.setAttribute\.call\(link\.anchor, 'href', shield\)[\s\S]*?setTimeout\(\(\) => finishPreviewLink\(event, pending\), 0\)[\s\S]*?\['click', 'auxclick'\][\s\S]*?capturePreviewLink[\s\S]*?finishCapturedPreviewLink/,
    'Preview must shield project links, preserve authored cancellation, and route modified clicks/downloads through safe parent-owned destinations',
  );
  assert.match(
    previewSource,
    /activateSlider\(root, active[\s\S]*?event\.preventDefault\(\);[\s\S]*?if \(inspectionEnabled\) event\.stopPropagation\(\)/,
    'native slider controls may own selection in Design but must continue bubbling to authored Preview interactions',
  );
  assert.match(
    previewSource,
    /let editorRevealedLocaleSelector = null[\s\S]*?data-kodety-locale-options[\s\S]*?details\[data-kodety-locale-selector\][\s\S]*?editorRevealedLocaleSelectorWasOpen[\s\S]*?next\.open = true[\s\S]*?data-html-editor-locale-forced-open[\s\S]*?syncEditorRevealedLocaleSelector\(selected\)/,
    'selecting the language options layer must reveal its overlay only inside the editor and restore its previous open state afterwards',
  );
  const canvasShortcutStart = previewSource.indexOf("const textEditingSelector = 'input, textarea, select, [data-html-editor-editing]");
  const canvasShortcutEnd = previewSource.indexOf("const canContainTags = new Set", canvasShortcutStart);
  assert.ok(
    canvasShortcutStart >= 0 && canvasShortcutEnd > canvasShortcutStart,
    'missing the isolated canvas keyboard shortcut handler',
  );
  const canvasShortcutSource = previewSource.slice(canvasShortcutStart, canvasShortcutEnd);
  assert.match(
    canvasShortcutSource,
    /event\.target\?\.closest\?\.\(textEditingSelector\)[\s\S]*?document\.activeElement\?\.closest\?\.\(textEditingSelector\)[\s\S]*?if \(event\.repeat \|\| activeTextEditor\) return[\s\S]*?command = 'delete-selection'[\s\S]*?command = 'undo'[\s\S]*?command = 'redo'[\s\S]*?command = 'copy-selection-styles'[\s\S]*?command = 'paste-selection-styles'[\s\S]*?command = 'copy-selection'[\s\S]*?modifier && key === 'v'[\s\S]*?return;[\s\S]*?command = 'duplicate-selection'[\s\S]*?command = 'open-insert'[\s\S]*?postEditorMessage\(\{ type: 'html-editor-command', command \}\)/,
    'canvas-focused keyboard commands must be forwarded while plain Cmd/Ctrl+V remains available to the clipboard event',
  );
  assert.doesNotMatch(
    canvasShortcutSource,
    /command = 'paste-selection'/,
    'plain Cmd/Ctrl+V must not bypass clipboard SVG inspection from the canvas keydown handler',
  );
  assert.match(
    previewSource,
    /const standaloneClipboardSvg = value =>[\s\S]*?document\.addEventListener\('paste', event => \{[\s\S]*?if \(!inspectionEnabled \|\| !selected \|\| !event\.clipboardData\) return;[\s\S]*?const targetPath = selected\.dataset\.htmlEditorPath \|\| ''[\s\S]*?getData\('text\/plain'\)[\s\S]*?getData\('text\/html'\)[\s\S]*?type: 'html-editor-figma-paste'[\s\S]*?getData\('image\/svg\+xml'\)[\s\S]*?event\.clipboardData\.files[\s\S]*?type: 'html-editor-svg-paste'[\s\S]*?source\.length <= 384 \* 1024[\s\S]*?targetPath[\s\S]*?command: 'paste-selection'[\s\S]*?\}, true\)/,
    'the canvas paste event must prioritize Figma packages, route bounded standalone SVG data to the captured layer and retain the internal element fallback',
  );
  assert.match(
    previewSource,
    /const nativeEditingField = event\.target\?\.closest\?\.[\s\S]*?input, textarea, select, \[role="textbox"\], \[contenteditable\][\s\S]*?if \(nativeEditingField\) return;[\s\S]*?svgFile\.size > 384 \* 1024[\s\S]*?svgFile\.text\(\)/,
    'SVG clipboard interception must preserve native field paste and reject oversized files before reading them',
  );
  assert.match(
    previewSource,
    /el\.contentEditable = rich \? 'true' : 'plaintext-only';[\s\S]*?el\.setAttribute\('data-html-editor-editing', ''\)/,
    'plain and rich inline editing must remain identifiable without enabling either capability in Preview',
  );
  assert.match(
    projectEditorSource,
    /const historyShortcut = modifier[\s\S]*?const isEditingField[\s\S]*?const ownsNativeTextHistory[\s\S]*?textarea, \[data-html-editor-editing\][\s\S]*?if \(isEditingField && \(!historyShortcut \|\| ownsNativeTextHistory\)\) return/,
    'Inspector inputs must route project Undo/Redo while textarea and inline editors retain character-level native history',
  );
  assert.match(
    projectEditorSource,
    /if \(message\.type === 'html-editor-command'\) \{[\s\S]*?editorCommandRef\.current\(message\.command\)[\s\S]*?editorCommandRef\.current = \(command\) => \{[\s\S]*?command === 'undo'[\s\S]*?command === 'redo'[\s\S]*?command === 'open-insert'[\s\S]*?setInsertPanelOpen\(true\)[\s\S]*?command === 'delete-selection'[\s\S]*?removeLayer\(selection\.path\)/,
    'parent-window and canvas shortcuts must converge on the same editor command executor',
  );
  assert.match(
    projectEditorSource,
    /command === 'copy-selection'[\s\S]*?copyLayer\(selection\.path\)[\s\S]*?command === 'copy-selection-styles'[\s\S]*?copyCurrentStyles\(\)[\s\S]*?command === 'paste-selection'[\s\S]*?pasteLayer\(selection\.path\)[\s\S]*?command === 'paste-selection-styles'[\s\S]*?pasteStyleClipboard\(\)/,
    'element and style clipboard commands from either focus surface must remain explicitly separated',
  );
  assert.match(
    layersTreeSource,
    /Copiar elemento[\s\S]*?⌘C[\s\S]*?Colar elemento aqui[\s\S]*?⌘V[\s\S]*?Copiar estilos[\s\S]*?⌘⇧C[\s\S]*?Colar estilos[\s\S]*?⌘⇧V/,
    'the Layers menu must label element and style clipboard actions as separate operations',
  );
  assert.match(
    projectEditorSource,
    />Elemento<[\s\S]*?Copiar elemento[\s\S]*?Colar elemento aqui[\s\S]*?>Estilos<[\s\S]*?Copiar estilos[\s\S]*?Colar estilos/,
    'the canvas context menu must expose distinct Element and Styles clipboard groups',
  );
  assert.match(
    projectEditorSource,
    /command = 'open-insert'[\s\S]*?window\.addEventListener\('keydown', handleShortcut, true\)/,
    'the parent editor command system must capture shortcuts before browser defaults',
  );
  assert.match(
    projectEditorSource,
    /else if \(modifier && key === 'v' && selection\) \{[\s\S]*?paste event reads the operating-system payload first[\s\S]*?return;[\s\S]*?window\.addEventListener\('keydown', handleShortcut, true\)/,
    'parent-focused Cmd/Ctrl+V must also defer to the clipboard event instead of immediately pasting the internal layer',
  );
  assert.match(
    projectEditorSource,
    /const pasteFigmaSelection = async \(event: ClipboardEvent\) => \{[\s\S]*?if \(!figmaClipboard\) \{[\s\S]*?const targetPath = selection\?\.path \|\| ''[\s\S]*?clipboardContainsSvg\(event\.clipboardData\)[\s\S]*?editorCommandRef\.current\('paste-selection'\)[\s\S]*?readClipboardSvgSource\(event\.clipboardData\)[\s\S]*?pasteInlineSvgRef\.current\(svg, targetPath\)[\s\S]*?window\.addEventListener\('paste', pasteListener, true\)/,
    'the parent paste event must inspect SVG data at the captured selection and use the internal layer clipboard only as a non-SVG fallback',
  );
  assert.match(
    previewSource,
    /event\.key === 'ArrowUp'[\s\S]*?move-selection-first[\s\S]*?move-selection-up[\s\S]*?event\.key === 'ArrowDown'[\s\S]*?move-selection-last[\s\S]*?move-selection-down/,
    'canvas-focused arrows must forward sibling layer movement, with Shift jumping to an edge',
  );
  assert.match(
    projectEditorSource,
    /const moveSelectedLayer = \(direction: 'up' \| 'down', toEdge = false\)[\s\S]*?siblings\.findIndex[\s\S]*?moveLayer\([\s\S]*?direction === 'up' \? 'before' : 'after'/,
    'keyboard layer movement must reuse the structural drag reorder transaction',
  );
  assert.match(
    projectEditorSource,
    /const updateCurrentPageLocks = \([\s\S]*?refreshCanvas = true[\s\S]*?commitProject\([\s\S]*?record,\s*refreshCanvas,/,
    'layer lock remapping must be able to join a structural transaction without starting a competing canvas generation',
  );
  assert.match(
    layersTreeSource,
    /const handleDragEnd = useCallback[\s\S]*?validDrop\(source, target, dropPosition\)[\s\S]*?onMove\([\s\S]*?source\.node\.path,[\s\S]*?target\.node\.path,[\s\S]*?dropPosition === ["']above["'][\s\S]*?["']before["'][\s\S]*?dropPosition === ["']below["'][\s\S]*?["']after["'][\s\S]*?["']inside["'][\s\S]*?onDragEnd=\{handleDragEnd\}/,
    'Ycode drag-and-drop must forward every valid before, after or inside reorder through the existing move callback',
  );
  assert.match(
    projectEditorSource,
    /const moveLayer = [\s\S]*?const latestSource = editorSourceRef\.current;[\s\S]*?const result = patchMoveElement\(latestSource, sourcePath, targetPath, position\);[\s\S]*?const remapPath = \(candidate: string\) => remapPathAfterMove\(candidate, sourcePath, result\.path\);[\s\S]*?const movedCodeComponentInstanceId = result\.movedAttributes[\s\S]*?\['data-coday-code-instance'\][\s\S]*?commitLiveStructure\([\s\S]*?codeComponentInstanceId: movedCodeComponentInstanceId[\s\S]*?remapPath[\s\S]*?return;[\s\S]*?reconcileCanvasSelectionForStructure\(result\.source, remapPath, result\.path\);[\s\S]*?changeSource\(result\.source, true, true, false, remapPath\);/,
    'a Code Component root must preserve its mounted runtime while runtime-owned reorders keep canonical recovery and remapped locks',
  );
  assert.match(
    projectEditorSource,
    /if \(structuralRemap\) \{[\s\S]*?const currentLocks = metadata\.lockedLayers\?\.\[current\.mainHtmlPath\] \|\| \[\];[\s\S]*?const nextLocks = reconcileStructuralSelectionPaths\(currentLocks, structuralRemap\);[\s\S]*?next = updateEditorMetadata\(next,[\s\S]*?\[current\.mainHtmlPath\]: nextLocks,[\s\S]*?commitProject\(next, record, refreshCanvas, canvasAlreadySynchronized\);/,
    'structural source and remapped locks must enter one committed project revision before the canonical canvas generation',
  );
  const moveLayerStart = projectEditorSource.indexOf('  const moveLayer = ');
  const moveLayerEnd = projectEditorSource.indexOf('\n  useLayoutEffect(() => {', moveLayerStart);
  assert.ok(moveLayerStart >= 0 && moveLayerEnd > moveLayerStart, 'missing the canonical layer reorder handler');
  const moveLayerSource = projectEditorSource.slice(moveLayerStart, moveLayerEnd);
  assert.doesNotMatch(
    moveLayerSource,
    /synchronizeLiveStructure|postCanvasMessage/,
    'layer reorder must use the ACK-tracked structural transaction rather than treating direct postMessage delivery as acknowledgement',
  );
  assert.match(
    moveLayerSource,
    /if \(movedCodeComponentInstanceId\)[\s\S]*?operation: 'move'[\s\S]*?movedPath: result\.path[\s\S]*?selectPath: result\.path[\s\S]*?codeComponentInstanceId: movedCodeComponentInstanceId[\s\S]*?return;/,
    'the exact authored Code Component root must use identity-checked mounted-node reparenting',
  );
  assert.match(
    projectEditorSource,
    /const canvasMutationPosted = synchronizeLiveStructure\(nextSource, message, remapPath\);\s*changeSource\(nextSource, true, !canvasMutationPosted, false, remapPath\);[\s\S]*?if \(canvasMutationPosted && previousProject && nextProject && nextProject !== previousProject && inverse\) \{[\s\S]*?liveHistoryTransitionsRef\.current\.set\(nextProject,[\s\S]*?return canvasMutationPosted;/,
    'other live structural commands must persist their exact source and retain a canonical rejection fallback',
  );
  assert.match(
    previewSource,
    /const finalizeLiveStructure = message => \{[\s\S]*?const selectPath =[\s\S]*?preferredEditorPathElement\(selectPath\)[\s\S]*?selectElement\(nextSelection, false, 'editor'\)[\s\S]*?const applyLiveElementMove = message => \{[\s\S]*?remapAllEditorPathState\(path => remapEditorPathAfterMove\(path, sourcePath, movedPath\)\)[\s\S]*?finalizeLiveStructure\(message\)/,
    'the compatibility live-structure bridge must still understand an in-flight move from an older editor runtime',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-live-structure-rejected'[\s\S]*?forceCanonicalCanvasRefresh\(\)/,
    'a rejected compatibility live-structure command must repair the canvas from the latest canonical source',
  );
  assert.match(
    projectEditorSource,
    /const moveLayer = [\s\S]*?commitLocaleInsertionSourceMutation\([\s\S]*?patchMoveElement\(html, insertionSourcePath, insertionTargetPath, position\)[\s\S]*?true,\s*\);[\s\S]*?pendingSelectionPathRef\.current = resultPath[\s\S]*?selectedPathsRef\.current = \[\][\s\S]*?setSelection\(null\)[\s\S]*?setSelectedPaths\(\[\]\)/,
    'localized Ycode reorder must commit its insertion through the canonical canvas refresh path',
  );
  assert.match(
    projectEditorSource,
    /const commitLocaleInsertionSourceMutation = useCallback[\s\S]*?const structureSynchronized = structuralProjection[\s\S]*?synchronizeLiveStructure\([\s\S]*?commitProject\([\s\S]*?structureSynchronized \? false : refreshCanvas === true \|\| \(useLiveProjection && !canProjectLive\),[\s\S]*?structureSynchronized/,
    'localized reorder must use the canonical project refresh whenever its live structural projection is unavailable',
  );
  assert.match(
    projectEditorSource,
    /const optionArea = [\s\S]*?\^Digit\[1-6\]\$[\s\S]*?optionArea === '2'[\s\S]*?navigateAfterWordPressSave\(topbarWp\.settingsUrl\)[\s\S]*?optionArea === '4'[\s\S]*?openGlobalCodeEditor\(\)[\s\S]*?optionArea === '5'[\s\S]*?navigateAfterWordPressSave\(topbarWp\.cmsUrl\)[\s\S]*?optionArea === '6'[\s\S]*?OPEN_HTML_AGENT_PANEL_EVENT[\s\S]*?useHtmlInspectorPanelStore\.getState\(\)\.requestTab\(tab\)/,
    'Option 1–6 must open Design, the Settings page, Interactions, Code, the CMS page and Agent using physical digit keys on macOS',
  );
  assert.match(
    rightSidebarSource,
    /import \{[^}]*OPEN_HTML_AGENT_PANEL_EVENT[^}]*\} from '@\/lib\/html-editor\/agent-panel-events'[\s\S]*?setPanelMode\('agent'\)[\s\S]*?window\.addEventListener\(OPEN_HTML_AGENT_PANEL_EVENT, openAgentPanel\)[\s\S]*?window\.removeEventListener\(OPEN_HTML_AGENT_PANEL_EVENT, openAgentPanel\)/,
    'the Option 6 event must select Agent and remove its global listener when the sidebar unmounts',
  );
  assert.match(
    realtimeInspectorSource,
    /tabRequest\?:[\s\S]*?tab: 'design' \| 'settings' \| 'interactions'[\s\S]*?if \(tabRequest\) setActiveTab\(tabRequest\.tab\)/,
    'the parent shortcut router must be able to activate every Inspector area repeatedly',
  );
  assert.match(
    navigatorSource,
    /<div className="w-full">\s*<div className="group relative w-full">[\s\S]*?aria-label=\{expanded \? "Ocultar variantes" : "Mostrar variantes"\}[\s\S]*?aria-label=\{`Opções de \$\{getPageDisplayName\(path, homePage\)\}`\}[\s\S]*?<\/DropdownMenu>\s*<\/div>\s*\{expanded && experimentGroups\.map/,
    'A/B expand and options controls must be positioned against the page row, not the expanded variant tree',
  );
  assert.match(
    navigatorSource,
    /const pageRowClassName = cn\([\s\S]*?active && "bg-white\/\[0\.09\] text-\[var\(--kodety-text\)\]"/,
    'the active page row must use the same subtle gray fill as the active sidebar destination',
  );
  assert.match(
    navigatorSource,
    /const statusUi = EXPERIMENT_STATUS_UI\[group\.status\][\s\S]*?role="group"[\s\S]*?aria-label=\{`Variantes de \$\{group\.name\}`\}[\s\S]*?rounded-\[7px\][\s\S]*?style=\{\{ marginLeft: rowContentInset \}\}[\s\S]*?<FlaskConical[\s\S]*?statusUi\.label[\s\S]*?<div className="space-y-px">[\s\S]*?group\.variants\.map/,
    'A/B variants must live in one compact labelled group whose header, status and indentation stay clear at every page depth',
  );
  assert.match(
    navigatorSource,
    /const pageExperimentStatus =[\s\S]*?group\.status === "active"[\s\S]*?group\.status === "paused"[\s\S]*?aria-label=\{`A\/B · \$\{pageExperimentStatusUi\?\.label \|\| "Experimento"\}`\}[\s\S]*?pageExperimentStatusUi\.dotClassName/,
    'the collapsed page badge must distinguish an active or paused A/B test without relying on violet alone',
  );
  assert.match(
    navigatorSource,
    /const rowLeadingControls =[\s\S]*?hasHierarchyChildren \? 18 : 0[\s\S]*?experimentGroups\.length > 0 \? 18 : 0[\s\S]*?const rowContentInset = 8 \+ depth \* 14 \+ rowLeadingControls[\s\S]*?style=\{\{ paddingLeft: rowContentInset \}\}/,
    'page content must reserve independent leading space for hierarchy and A/B toggles',
  );
  assert.match(
    navigatorSource,
    /const hasExactExperimentSelection = Boolean\([\s\S]*?activeExperimentId && activeExperimentVariantId[\s\S]*?const variantActive = hasExactExperimentSelection[\s\S]*?activeExperimentId === group\.experimentId[\s\S]*?activeExperimentVariantId === variant\.id[\s\S]*?const weightLabel = `\$\{Math\.round\(variant\.weight \* 10\) \/ 10\}%`[\s\S]*?aria-current=\{variantActive \? "page" : undefined\}[\s\S]*?border-violet-400\/35 bg-violet-400\/\[\.11\][\s\S]*?min-w-\[34px\][\s\S]*?tabular-nums/,
    'A/B variant rows must use exact experiment identity, a clear selected state and a stable traffic value',
  );
  assert.match(
    navigatorSource,
    /const activeExperimentVariant = useMemo\([\s\S]*?group\.experimentId === activeExperimentId[\s\S]*?variant\.id === activeExperimentVariantId[\s\S]*?aria-current=\{pageActive && !activeExperimentVariant \? "page" : undefined\}/,
    'an active A/B variant must not mark both the source page and variant as the current page',
  );
  assert.match(
    projectEditorSource,
    /activeExperimentId: experimentEditSession\?\.experimentId[\s\S]*?activeExperimentVariantId: experimentEditSession\?\.variantId/,
    'the Pages tree must receive the exact open experiment selection from the editor session',
  );
  assert.doesNotMatch(
    navigatorSource,
    /disabled \? "Off"|disabled && "opacity-50"/,
    'paused variant rows must remain readable and selectable instead of being visually disabled',
  );
  assert.match(
    projectEditorSource,
    /Design is a static editing surface:[\s\S]*?!isPreviewing,\s*(?:cmsPreviewState|cmsPreviewRef\.current),/,
    'Design must isolate authored scheduling, scroll, cursor and loading runtimes from visual editing',
  );
  assert.match(
    previewSource,
    /if \(animationDocument\?\.interactions\.length\)[\s\S]*?patchInteractionDocument\([\s\S]*?animationDocument,[\s\S]*?false/,
    'Design must materialize only the editor-owned Kodety runtime needed for Timeline preview',
  );
  const previewMemoSource = projectEditorSource.match(/const preview = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[([\s\S]*?)\]\);/);
  assert.ok(previewMemoSource, 'the iframe preview must remain behind an explicit memoized reload boundary');
  assert.match(
    previewMemoSource[1],
    /const latestCanvasProject = canvasProjectRef\.current \|\| canvasProject[\s\S]*?const canvasRevision = canvasProjectRef\.current[\s\S]*?\? canvasProjectRevisionRef\.current[\s\S]*?: 0/,
    'a deliberate rebuild must pair the latest canonical project with its exact revision',
  );
  const previewFrameFlushStart = stylePreviewTransactionSource.indexOf('const flushPreviewFrame = useCallback');
  const previewFrameScheduleStart = stylePreviewTransactionSource.indexOf('const schedulePreview = useCallback', previewFrameFlushStart);
  const previewCommitFlushStart = stylePreviewTransactionSource.indexOf('const flush = useCallback', previewFrameScheduleStart);
  const previewCancelStart = stylePreviewTransactionSource.indexOf('const cancel = useCallback', previewCommitFlushStart);
  const previewChangeStart = stylePreviewTransactionSource.indexOf('const change = useCallback', previewCancelStart);
  assert.ok(
    previewFrameFlushStart >= 0 &&
      previewFrameScheduleStart > previewFrameFlushStart &&
      previewCommitFlushStart > previewFrameScheduleStart &&
      previewCancelStart > previewCommitFlushStart &&
      previewChangeStart > previewCancelStart,
    'the visual transaction hook must keep preview paint, final commit and cancellation as separate phases',
  );
  const previewFrameFlushSource = stylePreviewTransactionSource.slice(previewFrameFlushStart, previewFrameScheduleStart);
  assert.match(
    previewFrameFlushSource,
    /changes\.forEach\(\(\[property, value\], index\) => \{\s*preview\(property, value, index === changes\.length - 1\);\s*\}\);/,
    'each coalesced preview batch must flush only its final property immediately instead of scheduling a second RAF',
  );
  const previewFrameScheduleSource = stylePreviewTransactionSource.slice(previewFrameScheduleStart, previewCommitFlushStart);
  assert.match(
    previewFrameScheduleSource,
    /pendingRef\.current\.set\(property, value\);[\s\S]*?previewQueueRef\.current\.set\(property, value\);[\s\S]*?frameRef\.current === null[\s\S]*?requestAnimationFrame\(flushPreviewFrame\)/,
    'repeated control samples must overwrite the same property and schedule at most one preview frame',
  );
  const previewCommitFlushSource = stylePreviewTransactionSource.slice(previewCommitFlushStart, previewCancelStart);
  assert.match(
    previewCommitFlushSource,
    /const transaction = activeTransactionRef\.current;[\s\S]*?cancelFrame\(\);[\s\S]*?Array\.from\(pendingRef\.current\)[\s\S]*?pendingRef\.current\.clear\(\);[\s\S]*?previewQueueRef\.current\.clear\(\);[\s\S]*?const preview = transaction\?\.preview;[\s\S]*?changes\.forEach\(\(\[property, value\], index\) => \{\s*preview\(property, value, index === changes\.length - 1\);\s*\}\);[\s\S]*?changes\.forEach\(\(\[property, value\]\) => transaction\.commit\(property, value\)\)/,
    'ending an interaction must cancel its queued frame, paint the last sample and commit that final property value once through its captured scope',
  );
  assert.equal(
    (previewCommitFlushSource.match(/transaction\.commit\(property, value\)/g) || []).length,
    1,
    'the final flush must contain exactly one canonical commit pass',
  );
  assert.match(
    stylePreviewTransactionSource,
    /interface ActiveStylePreviewTransaction \{[\s\S]*?scopeKey: string;[\s\S]*?commit: StyleChangeHandler;[\s\S]*?preview\?: StylePreviewHandler;[\s\S]*?cancel\?: \(\) => void;[\s\S]*?const captureTransaction = useCallback\(\(\) => \{[\s\S]*?scopeKey: scopeKeyRef\.current,[\s\S]*?commit: captureHtmlInspectorAction\(commitRef\.current\),[\s\S]*?preview: captureHtmlInspectorAction\(previewRef\.current\),[\s\S]*?cancel: captureHtmlInspectorAction\(cancelRef\.current\)/,
    'a visual gesture must retain immutable commit, preview and rollback handlers from the scope where it started',
  );
  assert.match(
    stylePreviewTransactionSource,
    /if \(activeTransactionRef\.current\?\.scopeKey === scopeKey\) \{[\s\S]*?if \(scopeKeyRef\.current === scopeKey\) flush\(\);[\s\S]*?else cancel\(\);[\s\S]*?optimisticScopeRef\.current === scopeKey[\s\S]*?optimisticRef\.current\.clear\(\)/,
    'switching selection or CSS scope must cancel the obsolete gesture and hide its optimism from the next scope',
  );
  const previewChangeSource = stylePreviewTransactionSource.slice(
    previewChangeStart,
    stylePreviewTransactionSource.indexOf('const onPointerDownCapture = useCallback', previewChangeStart),
  );
  assert.match(
    previewChangeSource,
    /!pointerActiveRef\.current && !editableFocusRef\.current[\s\S]*?commitRef\.current\(property, value\);[\s\S]*?return;[\s\S]*?schedulePreview\(property, value\)/,
    'discrete changes may commit immediately, while active pointer/focus gestures must remain preview-only until their boundary',
  );
  assert.match(
    stylePreviewTransactionSource,
    /onPointerUp(?:Capture)?[\s\S]*?pointerActiveRef\.current = false;[\s\S]*?flush\(\)[\s\S]*?onPointerCancel(?:Capture)?[\s\S]*?cancel\(\)[\s\S]*?onBlurCapture[\s\S]*?queueMicrotask\(\(\) => \{[\s\S]*?editableFocusRef\.current = isEditableTarget\(document\.activeElement\)[\s\S]*?flush\(\)[\s\S]*?event\.key === 'Escape'\) cancel\(\)/,
    'pointer release and blur must commit, while cancellation and Escape must roll transient paint back',
  );
  assert.match(
    stylePreviewTransactionSource,
    /confirmedValues[\s\S]*?optimisticRef\.current\.forEach\(\(expected, property\)[\s\S]*?Object\.prototype\.hasOwnProperty\.call\([\s\S]*?comparableStyleValue\(confirmedValues\[property\][\s\S]*?optimisticRef\.current\.delete\(property\)/,
    'controlled inspector fields must retain their last sample until canonical authored source confirms that exact value',
  );
  assert.doesNotMatch(
    stylePreviewTransactionSource,
    /scheduleOptimisticRelease|optimisticReleaseFramesRef|secondFrame = requestAnimationFrame/,
    'Inspector optimism must never expire on a fixed animation-frame timer',
  );
  assert.match(
    realtimeInspectorSource,
    /stylePreviewTransaction\.optimisticValues[\s\S]*?\}, \[baseBreakpointStyles,[\s\S]*?stylePreviewTransaction\.optimisticValues\]\)/,
    'optimistic transaction values must remain the last display layer until canonical inspector props catch up',
  );
  assert.match(
    realtimeInspectorSource,
    /const selectionPath = selection\?\.path[\s\S]*?const selectedOuterHtml = useMemo[\s\S]*?getElementOuterHtml\(source, selectionPath\)[\s\S]*?\}, \[selectionPath, source\]\)[\s\S]*?const inlineStyles = useMemo[\s\S]*?readSourceElementInlineStyles\(source, selectionPath, selection\?\.attributes\.style\)[\s\S]*?\[source, selectionPath, selection\?\.attributes\.style\][\s\S]*?confirmedValues: confirmedStyleValues/,
    'the Inspector must derive authored inline declarations from canonical source and use them to confirm optimistic controls',
  );
  assert.match(
    realtimeInspectorSource,
    /function authoredOverlayOptions[\s\S]*?data-kodety-overlay[\s\S]*?\.test\(source\)\) return \[\][\s\S]*?inspectSourceElementIndex\(source\)\.elements/,
    'overlay discovery must skip ordinary pages and share the authored source index when needed',
  );
  assert.match(
    realtimeInspectorSource,
    /const inheritedCollection = useMemo[\s\S]*?data-kodety-collection[\s\S]*?\.test\(source\)\)[\s\S]*?inspectSourceElementIndex\(source\)[\s\S]*?index\.byPath\.get\(candidatePath\)[\s\S]*?\}, \[selectionPath, source\]\)/,
    'collection ancestry must use stable path dependencies and the shared source index instead of DOMParser',
  );
  const canvasStylePreviewFlushStart = projectEditorSource.indexOf('const flushCanvasStylePreview = useCallback');
  const canvasStylePreviewScheduleStart = projectEditorSource.indexOf('const scheduleCanvasStylePreviewFlush = useCallback', canvasStylePreviewFlushStart);
  const canvasStylePreviewMutationStart = projectEditorSource.indexOf('const previewCanvasStyle = useCallback', canvasStylePreviewScheduleStart);
  const canvasStylePreviewReleaseStart = projectEditorSource.indexOf(
    'const releaseCanvasStylePreviewProperties = useCallback',
    canvasStylePreviewMutationStart,
  );
  assert.ok(
    canvasStylePreviewFlushStart >= 0 &&
      canvasStylePreviewScheduleStart > canvasStylePreviewFlushStart &&
      canvasStylePreviewMutationStart > canvasStylePreviewScheduleStart &&
      canvasStylePreviewReleaseStart > canvasStylePreviewMutationStart,
    'the editor must expose separate scheduling, preview and canonical-release boundaries',
  );
  const canvasStylePreviewFlushSource = projectEditorSource.slice(canvasStylePreviewFlushStart, canvasStylePreviewScheduleStart);
  assert.match(
    canvasStylePreviewFlushSource,
    /const message = \{\s*type: 'html-editor-live-style',\s*transientPreview: true,\s*cssPath: CANVAS_STYLE_PREVIEW_PATH,/,
    'the transient overlay stylesheet must identify itself so the canvas bridge can avoid an inspector selection round-trip',
  );
  assert.match(
    canvasStylePreviewFlushSource,
    /const targetBreakpoint = canvasStylePreviewBreakpointRef\.current[\s\S]*?passiveCanvasFramesRef\.current\.forEach\(frame => \{[\s\S]*?passiveCanvasFrameIdsRef\.current\.get\(frame\)[\s\S]*?breakpointId === targetBreakpoint[\s\S]*?targets\.add\(frame\)/,
    'selector-aware realtime must reach every Infinite Canvas frame for the edited breakpoint without leaking into other breakpoints',
  );
  assert.match(
    canvasStylePreviewFlushSource,
    /previewPropertyVersions:\s*nextCssText[\s\S]*?Object\.fromEntries\(canvasStylePreviewPropertyVersionsRef\.current\)[\s\S]*?: \{\}/,
    'each transient paint must carry the exact property versions needed for an atomic canonical handoff',
  );
  const liveStyleBridgeStart = previewSource.indexOf("if (event.data?.type === 'html-editor-live-style') {");
  const liveStyleBridgeEnd = previewSource.indexOf("if (event.data?.type === 'html-editor-cms-preview') {", liveStyleBridgeStart);
  assert.ok(
    liveStyleBridgeStart >= 0 && liveStyleBridgeEnd > liveStyleBridgeStart,
    'the canvas bridge must keep the live-style message behind an explicit handler boundary',
  );
  const liveStyleBridgeSource = previewSource.slice(liveStyleBridgeStart, liveStyleBridgeEnd);
  assert.match(
    liveStyleBridgeSource,
    /const transientPreview = event\.data\.transientPreview === true;/,
    'the live-style bridge must classify transient overlays once at the handler boundary',
  );
  assert.match(
    liveStyleBridgeSource,
    /if \(!transientPreview\) scheduleLiveStylePaintRefresh\(\);/,
    'transient preview samples must skip the expensive paint-chunk re-indexing pass',
  );
  assert.match(
    liveStyleBridgeSource,
    /appliedEditorRevision = Math\.max\(appliedEditorRevision, event\.data\.revision\)[\s\S]*?requestAnimationFrame\(\(\) => \{\s*refreshDirectControls\(\);[\s\S]*?if \(transientPreview\) return;[\s\S]*?pendingSelectionDetail = \{[\s\S]*?element: selected,[\s\S]*?sequence: selectionSnapshotSequence,[\s\S]*?schedulePendingSelectionDetail\(\)/,
    'transient preview frames must refresh direct controls and return before scheduling deferred Inspector detail',
  );
  assert.match(
    liveStyleBridgeSource,
    /previewPropertyVersions = versions[\s\S]*?beginPreviewPropertyHandoff\([\s\S]*?event\.data\.clearPreviewProperties[\s\S]*?appliedEveryPatch\) previewHandoff\?\.commit\(\)[\s\S]*?previewHandoff\?\.rollback\(\)/,
    'canonical paint must remove only the matching preview version and roll it back if visual verification fails',
  );
  const canvasStylePreviewScheduleSource = projectEditorSource.slice(canvasStylePreviewScheduleStart, canvasStylePreviewMutationStart);
  assert.match(
    canvasStylePreviewScheduleSource,
    /canvasStylePreviewFrameRef\.current !== null\) return;[\s\S]*?window\.requestAnimationFrame\(\(\) => \{[\s\S]*?canvasStylePreviewFrameRef\.current = null;[\s\S]*?flushCanvasStylePreviewRef\.current\(\)/,
    'rapid visual previews must share one animation frame and flush the latest draft through its live ref',
  );
  const canvasStylePreviewMutationSource = projectEditorSource.slice(canvasStylePreviewMutationStart, canvasStylePreviewReleaseStart);
  assert.match(
    canvasStylePreviewMutationSource,
    /target: 'rule',[\s\S]*?updateCanvasStylePreviewDraft\([\s\S]*?context\.selector,[\s\S]*?scheduleCanvasStylePreviewFlush\(\)/,
    'each transient visual value must target the real rule selector for classes before scheduling paint',
  );
  assert.match(
    projectEditorSource,
    /const scheduleCanvasStylePreviewRelease = useCallback[\s\S]*?const secondFrame = window\.requestAnimationFrame[\s\S]*?releaseCanvasStylePreviewProperties\(properties\)/,
    'the transient overlay must survive until the committed View State has stabilized for two frames',
  );
  assert.match(
    projectEditorSource,
    /queueCanvasStylePreviewReleaseAfterReload[\s\S]*?canvasStylePreviewReloadReleasesRef[\s\S]*?message\.type === 'html-editor-canvas-ready'[\s\S]*?scheduleCanvasStylePreviewRelease\(releases\)/,
    'reload-backed style commits must keep their preview until the new canonical iframe is ready',
  );
  assert.match(
    canvasViewEnqueueSource,
    /publishCanvasViewStateRef\.current\(delta \|\| snapshot\)[\s\S]*?scheduleCanvasStylePreviewRelease\(previewReleases\)/,
    'a visual commit must hand its transient overlay directly to the persistent iframe View State',
  );
  assert.doesNotMatch(
    canvasViewEnqueueSource,
    /requiresCanonicalRefresh|scheduleCommittedCanvasRefresh|queueCanvasStylePreviewReleaseAfterReload|forceCanonicalCanvasRefresh|setCanvasProject|setCanvasReloadKey/,
    'a representable visual commit must never create or queue another iframe generation',
  );
  assert.match(
    canvasStylePreviewMutationSource,
    /if \(flushImmediately\) \{\s*if \(canvasStylePreviewFrameRef\.current !== null\) \{\s*window\.cancelAnimationFrame\(canvasStylePreviewFrameRef\.current\);\s*canvasStylePreviewFrameRef\.current = null;\s*\}\s*flushCanvasStylePreviewRef\.current\(\);\s*\} else \{\s*scheduleCanvasStylePreviewFlush\(\);\s*\}/,
    'the final sample must cancel a pending parent RAF and paint immediately, while ordinary samples stay coalesced',
  );
  assert.doesNotMatch(
    canvasStylePreviewMutationSource,
    /\b(?:commitProject|changeSource|updateStyle|enqueueCanvasLiveStyle)\s*\(/,
    'a preview frame must never persist history or masquerade as the final canonical commit',
  );
  assert.match(
    projectEditorSource,
    /onStylePreview=\{previewCanvasStyle\}[\s\S]*?onStylePreviewCancel=\{clearCanvasStylePreview\}[\s\S]*?onStyleChange=\{updateStyle\}/,
    'the inspector must receive distinct transient preview, rollback and canonical commit callbacks',
  );
  const updateStyleStart = projectEditorSource.indexOf('const updateStyle = (name: string, value: string');
  const updateStyleEnd = projectEditorSource.indexOf('// The iframe listener is intentionally installed once', updateStyleStart);
  assert.ok(updateStyleStart >= 0 && updateStyleEnd > updateStyleStart, 'the canonical CSS writer must exist');
  const updateStyleSource = projectEditorSource.slice(updateStyleStart, updateStyleEnd);
  assert.match(
    previewSource,
    /const readAuthoredStyleOrigins = element =>[\s\S]*?style\.setProperty\([\s\S]*?candidate\.important \? 'important' : ''[\s\S]*?getComputedStyle\(element\)[\s\S]*?styleOrigins: readAuthoredStyleOrigins\(el\)/,
    'the Canvas must ask the browser cascade which authored declaration really owns each selected property',
  );
  assert.match(
    updateStyleSource,
    /selection\.styleOrigins\?\.\[normalizedProperty\][\s\S]*?authoringRootCssPaths[\s\S]*?resolveCssAuthoringOrigin\([\s\S]*?activeCssContext[\s\S]*?parseStyleDeclarationDetails[\s\S]*?primaryInlineWithPriority[\s\S]*?editActiveWinner:/,
    'visual writes must route through the browser-traced selector/source while normalizing legacy inline priority during migration',
  );
  const codeComponentUpdateStart = projectEditorSource.indexOf('const updateSelectedCodeComponent = useCallback');
  const codeComponentUpdateEnd = projectEditorSource.indexOf('const beginCodeComponentTransaction', codeComponentUpdateStart);
  assert.ok(
    codeComponentUpdateStart >= 0 && codeComponentUpdateEnd > codeComponentUpdateStart,
    'Code Component Property Controls must keep a dedicated update path',
  );
  const codeComponentUpdateSource = projectEditorSource.slice(codeComponentUpdateStart, codeComponentUpdateEnd);
  assert.match(
    codeComponentUpdateSource,
    /normalizeCodeComponentInstanceForRuntime\([\s\S]*?const revision = projectRevisionRef\.current \+ 1[\s\S]*?postCanvasMessage\(\{[\s\S]*?type: 'html-editor-code-component-update'[\s\S]*?revision,[\s\S]*?pendingCodeComponentUpdatesRef\.current\.set\(revision[\s\S]*?commitProject\([\s\S]*?!liveCanvasUpdated,[\s\S]*?false/,
    'Code Component props must repaint the mounted runtime immediately and rebuild only when that channel is unavailable',
  );
  assert.doesNotMatch(
    codeComponentUpdateSource,
    /setCanvasProject|scheduleCodeCanvasRefresh|forceCanonicalCanvasRefresh/,
    'ordinary Code Component controls must never schedule a canonical canvas rebuild',
  );
  assert.match(
    projectEditorSource,
    /const pendingCanvasCommandsRef = useRef<Array<[\s\S]*?pending\.push\(\{ generation, payload \}\)[\s\S]*?pending\.slice\(-256\)[\s\S]*?const matchingCommands = pendingCanvasCommandsRef\.current\.filter[\s\S]*?port\.postMessage\(matchingCommands\[sent\]\.payload\)[\s\S]*?matchingCommands\.slice\(sent\)/,
    'commands emitted before MessagePort readiness must be replayed in order instead of overwriting the latest Code Component value',
  );
  assert.match(
    previewSource,
    /event\.data\?\.type === 'html-editor-code-component-update'[\s\S]*?JSON\.stringify\(instance\)\.length > 512 \* 1024[\s\S]*?dispatchEvent\(new CustomEvent\('coday:code-component-instance-update'/,
    'the canvas bridge must validate and forward bounded instance updates over both window and command-port transports',
  );
  assert.match(
    previewSource,
    /const forwardCodeComponentUpdateRejection = event =>[\s\S]*?type: 'html-editor-code-component-rejected'[\s\S]*?addEventListener\('coday:code-component-instance-rejected', forwardCodeComponentUpdateRejection\)/,
    'the iframe must forward a failed React commit through the strict editor protocol',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-code-component-applied'[\s\S]*?canvasAppliedRevisionRef\.current = Math\.max[\s\S]*?message\.revision >= projectRevisionRef\.current[\s\S]*?window\.clearTimeout\(canvasCanonicalFallbackTimerRef\.current\)/,
    'a mounted React ACK must cancel the sub-second canonical fallback only for the latest persisted prop revision',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-code-component-rejected'[\s\S]*?rejectedUpdate\.before[\s\S]*?newerInstanceUpdatePending[\s\S]*?pending\.instanceId === message\.instanceId[\s\S]*?instances: snapshot\.instances\.map[\s\S]*?commitProject\(rolledBack, false, false, true\)[\s\S]*?último valor válido/,
    'a rejected prop revision must restore the same last-good instance while preserving unrelated newer project edits',
  );
  const codeRefreshStart = projectEditorSource.indexOf('const scheduleCodeCanvasRefresh = useCallback');
  const changeCodeFileStart = projectEditorSource.indexOf('const changeCodeFile = useCallback', codeRefreshStart);
  const changeCodeFileEnd = projectEditorSource.indexOf('useEffect(() => () => {', changeCodeFileStart);
  assert.ok(
    codeRefreshStart >= 0 && changeCodeFileStart > codeRefreshStart && changeCodeFileEnd > changeCodeFileStart,
    'code editing must keep explicit refresh scheduling and mutation boundaries',
  );
  const codeRefreshSource = projectEditorSource.slice(codeRefreshStart, changeCodeFileStart);
  assert.match(
    codeRefreshSource,
    /pendingCodeCanvasProjectRef\.current = next;[\s\S]*?window\.clearTimeout\(codeCanvasRefreshTimerRef\.current\)[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?pendingCodeCanvasProjectRef\.current = null;[\s\S]*?const latest = projectRef\.current;[\s\S]*?setCanvasProject\(latest\);[\s\S]*?}, 220\)/,
    'JavaScript and structural code edits must collapse into one delayed refresh of the latest canonical project',
  );
  const changeCodeFileSource = projectEditorSource.slice(changeCodeFileStart, changeCodeFileEnd);
  const liveCssBranchStart = changeCodeFileSource.indexOf('if (isLiveCanvasStylesheetPath(path)) {');
  const nonLiveCodeBranchStart = changeCodeFileSource.indexOf('\n      } else {', liveCssBranchStart);
  const transactionFinalizationStart = changeCodeFileSource.indexOf('transaction.after = projectRef.current', nonLiveCodeBranchStart);
  assert.ok(
    liveCssBranchStart >= 0 && nonLiveCodeBranchStart > liveCssBranchStart && transactionFinalizationStart > nonLiveCodeBranchStart,
    'code editing must classify live CSS before its controlled non-live refresh branch',
  );
  const liveCssBranch = changeCodeFileSource.slice(liveCssBranchStart, nonLiveCodeBranchStart);
  assert.match(
    liveCssBranch,
    /commitProject\(next, record, false,[\s\S]*?enqueueCanvasLiveStyle\(\{/,
    'a CSS edit must persist and enter the ACKed live stylesheet channel without replacing srcDoc',
  );
  assert.doesNotMatch(
    liveCssBranch,
    /\b(?:scheduleCodeCanvasRefresh|setCanvasProject|forceCanonicalCanvasRefresh)\s*\(/,
    'the live CSS branch must not schedule a canonical iframe reload',
  );
  const nonLiveCodeBranch = changeCodeFileSource.slice(nonLiveCodeBranchStart, transactionFinalizationStart);
  assert.match(
    nonLiveCodeBranch,
    /commitProject\(next, record, false, codeComponentSource\);[\s\S]*?if \(!codeComponentSource\) scheduleCodeCanvasRefresh\(next\)/,
    'ordinary JavaScript must retain its refresh scheduler while incomplete TSX keeps the mounted last-good bundle',
  );
  assert.match(
    changeCodeFileSource,
    /compiled\.result\.success && manifest[\s\S]*?rebaseCompiledCodeComponentVersion\([\s\S]*?if \(rebased !== currentProject\) commitProject\(rebased, false\)/,
    'only a successful Code Component compile may perform the canonical bundle swap',
  );
  assert.match(
    projectEditorSource,
    /const editorMetadataSource = project\?\.files\['\.incode\/project\.json'\]\?\.text \|\| ''[\s\S]*?primaryBreakpointSource = JSON\.stringify[\s\S]*?breakpointRegistrySource = JSON\.stringify[\s\S]*?const primaryBreakpoint = useMemo[\s\S]*?\}, \[primaryBreakpointSource\]\);[\s\S]*?const breakpoints = useMemo[\s\S]*?\}, \[breakpointRegistrySource\]\);/,
    'breakpoint/frame identities must remain stable while HTML or CSS styles change',
  );
  assert.match(
    projectEditorSource,
    /const materializeCanonicalCanvas = useCallback[\s\S]*?canvasProjectRevisionRef\.current = projectRevisionRef\.current[\s\S]*?changeInfiniteCanvasEnabled[\s\S]*?materializeCanonicalCanvas\(\)[\s\S]*?const enterFocusedPreview[\s\S]*?materializeCanonicalCanvas\(\)[\s\S]*?const leaveFocusedPreview[\s\S]*?materializeCanonicalCanvas\(\)/,
    'canvas topology and Preview rebuilds must materialize canonical source plus revision first',
  );
  assert.match(
    projectEditorSource,
    /const changeInfiniteCanvasEnabled = useCallback[\s\S]*?prepareCanvasTopologySwitchRef\.current\(enabled\)[\s\S]*?materializeCanonicalCanvas\(\)[\s\S]*?setInfiniteCanvasEnabled\(enabled\)/,
    'a canvas mode switch must quarantine the outgoing iframe before mounting canonical source in the other topology',
  );
  const canvasTopologyBarrierSource =
    projectEditorSource.match(
      /prepareCanvasTopologySwitchRef\.current = \(enabled\) => \{[\s\S]*?\n    \};\n  \}, \[clearCanvasStylePreview, isPreviewing\]\);/,
    )?.[0] || '';
  assert.ok(canvasTopologyBarrierSource, 'missing canvas topology switch barrier');
  assert.match(
    canvasTopologyBarrierSource,
    /clearCanvasStylePreview\(\);[\s\S]*?activeCanvasGenerationRef\.current = ''[\s\S]*?canvasReadyRef\.current = null[\s\S]*?iframeRef\.current = null[\s\S]*?passiveCanvasFramesRef\.current\.clear\(\)[\s\S]*?passiveCanvasFrameIdsRef\.current\.clear\(\)/,
    'the topology barrier must remove transient paint, revoke the old generation and detach active/passive frame ownership atomically',
  );
  assert.match(
    canvasTopologyBarrierSource,
    /canvasMutationReplayTimerRef[\s\S]*?canvasCanonicalFallbackTimerRef[\s\S]*?committedCanvasRefreshFrameRef[\s\S]*?committedCanvasRefreshIdleTimerRef[\s\S]*?committedCanvasRefreshCheckpointRef[\s\S]*?codeCanvasRefreshTimerRef/,
    'every outgoing refresh or replay scheduler must be cancelled before the other canvas mode takes authority',
  );
  assert.match(
    canvasTopologyBarrierSource,
    /pendingCanvasLiveStylesRef\.current\.forEach\(mutation => \{[\s\S]*?mutation\.attempts = 0[\s\S]*?delete mutation\.repairing/,
    'confirmed source mutations must survive a topology switch and restart replay against the new generation',
  );
  assert.doesNotMatch(
    canvasTopologyBarrierSource,
    /pendingCanvasLiveStylesRef\.current\.clear|canvasLiveStyleJournalRef\.current\s*=/,
    'switching canvas modes must never discard committed realtime state or its compact replay journal',
  );
  assert.match(
    projectEditorSource,
    /passiveCanvasFramesRef\.current\.forEach\(frame => \{[\s\S]*?postCanvasViewStateToFrame\(frame\)/,
    'mounted infinite-canvas role frames must receive the complete latest View State snapshot after each acknowledged commit',
  );
  assert.match(
    projectEditorSource,
    /const previewScrollOwner = useMemo\(\(\) => canvasPreviewScrollOwnerKey[\s\S]*?previewScrollOwnerRef\.current = previewScrollOwner[\s\S]*?previewScrollRef\.current = \{\}[\s\S]*?buildPreview\([\s\S]*?previewScrollOwnerRef\.current === previewScrollOwner\s*\?\s*previewScrollRef\.current\s*:\s*\{\}/,
    'static canvas scroll checkpoints must survive same-page reloads but reset before another project page is built',
  );
  const breakpointSelectionSource = projectEditorSource.match(/const selectCanvasBreakpoint = \(id: string\) => \{([\s\S]*?)\n  \};/);
  assert.ok(breakpointSelectionSource, 'the canvas breakpoint selector must exist');
  assert.doesNotMatch(
    breakpointSelectionSource[1],
    /setCanvasProject|setCanvasReloadKey|forceCanonicalCanvasRefresh/,
    'switching infinite-canvas roles must not force a canonical reload after a live style ACK',
  );
  assert.match(
    canvasStageSource,
    /const lastAutoFittedBreakpointRef = useRef\(viewport\)[\s\S]*?lastAutoFittedBreakpointRef\.current === viewport[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?viewportRef\.current !== targetBreakpoint[\s\S]*?focusFrame\(targetBreakpoint\)[\s\S]*?lastAutoFittedBreakpointRef\.current = targetBreakpoint/,
    'changing the active breakpoint must focus its frame after the new geometry settles',
  );
  assert.match(
    projectEditorSource,
    /commitProject\(nextProject, recordHistory, false\)[\s\S]*?enqueueCanvasLiveStyle\(\{[\s\S]*?attributes: liveDom\.attributes/,
    'the first generated visual class and its stylesheet must commit through one live DOM transaction',
  );
  const selectionMessageSource = projectEditorSource.match(
    /if \(message\.type === 'html-editor-selection'\) \{([\s\S]*?)\n      \}\n      if \(message\.type === 'html-editor-context-menu'/,
  );
  assert.ok(selectionMessageSource, 'the canvas selection handler must exist');
  assert.doesNotMatch(
    selectionMessageSource[1],
    /generatedVisualClass|patchElementAttribute|applyLivePatch/,
    'selecting a layer must never generate or persist a class',
  );
  assert.match(
    projectEditorSource,
    /const needsStableSelector =[\s\S]*?if \(needsStableSelector\) \{[\s\S]*?(?:const|let) className = generatedVisualClass\(node\)[\s\S]*?patchElementAttribute\(html, path, 'class'/,
    'a classless layer may receive its stable selector only inside an actual visual style transaction',
  );
  assert.match(
    previewSource,
    /const editorPathElements = path => Array\.from\(document\.querySelectorAll[\s\S]*?const editorVisualElements = path =>[\s\S]*?const attributePatches = Array\.isArray\(event\.data\.attributes\)[\s\S]*?editorVisualElements\(patch\.path\)[\s\S]*?applyLiveAttributePatchToElement\(element, patch\)/,
    'the bridge must apply bounded class/visibility deltas to every visual projection of a path without replacing srcDoc',
  );
  assert.match(
    previewSource,
    /const applyLiveTextPatchToElement[\s\S]*?data-html-editor-leaf[\s\S]*?element\.textContent !== patch\.value[\s\S]*?const textPatches = Array\.isArray\(event\.data\.texts\)[\s\S]*?editorVisualElements\(patch\.path\)[\s\S]*?applyLiveTextPatchToElement\(element, patch\)/,
    'duplicated leaf children must use the same idempotent live DOM bridge instead of navigating srcDoc',
  );
  assert.match(
    previewSource,
    /name === 'hidden'[\s\S]*?isDormantPreviewTemplate\(element\)[\s\S]*?data-html-editor-original-hidden[\s\S]*?name === 'aria-hidden'[\s\S]*?data-html-editor-original-aria-hidden/,
    'live visibility attributes must acquire authored markers while dormant CMS templates retain runtime-owned hidden state',
  );
  assert.match(
    previewSource,
    /\[data-html-editor-canvas-visibility-hidden\][\s\S]*?display: none[\s\S]*?const CANVAS_HIDDEN_MARKER = 'data-html-editor-canvas-visibility-hidden'[\s\S]*?normalizedProperty === 'display'[\s\S]*?setCanvasHiddenAuthority\([\s\S]*?value\.trim\(\)\.toLowerCase\(\) === 'none'[\s\S]*?name === 'hidden'[\s\S]*?setCanvasHiddenAuthority\(element, false\)[\s\S]*?setCanvasHiddenAuthority\(element, true\)/,
    'Hide and Show must project one canvas-only visibility authority in both directions instead of relying on runtime-owned hidden/display state',
  );
  assert.match(
    previewSource,
    /canvasViewRelatedAttributeNames[\s\S]*?normalized === 'hidden'[\s\S]*?names\.add\(CANVAS_HIDDEN_MARKER\)[\s\S]*?isStyleImplementationAttribute[\s\S]*?normalized === CANVAS_HIDDEN_MARKER[\s\S]*?scheduleCommittedStateReplay/,
    'runtime removal of the canvas Hidden marker must replay the latest committed visibility atom before paint',
  );
  assert.doesNotMatch(
    previewSource,
    /authoredCanvasCommandObserver|authoredCanvasStyleCommands|enforceAuthoredCanvasCommands|authoredCanvasTransientPreviewActive/,
    'the universal Runtime v2 observer must replace, not duplicate, the abandoned authored-command enforcement loop',
  );
  assert.match(
    projectEditorSource,
    /const canvasAuthoredStylesRef = useRef[\s\S]*?\(message\.patches \|\| \[\]\)\.forEach\(patch =>[\s\S]*?const authoredValue = stripImportantPriority\(patch\.value\)\.trim\(\)[\s\S]*?if \(authoredValue\) styles\.set\(property, authoredValue\)[\s\S]*?else styles\.delete\(property\)[\s\S]*?Object\.fromEntries\(authoredStyles\)[\s\S]*?styles\.set\('display', display\)/,
    'selection snapshots from the iframe must not overwrite any style value most recently authored in the Builder',
  );
  assert.match(
    previewSource,
    /const applyLiveStylePatchToElement[\s\S]*?element\.style\.setProperty\(property[\s\S]*?getPropertyValue\(property\)[\s\S]*?acceptedEveryTarget[\s\S]*?html-editor-live-style-applied/,
    'the bridge must not ACK an inline declaration that the browser silently rejected',
  );
  assert.match(
    previewSource,
    /const committedPathStyles = new Map\(\)[\s\S]*?const transientPathStyles = new Map\(\)[\s\S]*?const reapplyEditorLiveState[\s\S]*?committedPathStyles\.get\(path\)[\s\S]*?transientPathStyles\.get\(path\)[\s\S]*?committedPathAttributes\.get\(path\)[\s\S]*?committedPathTexts\.get\(path\)/,
    'the iframe must retain compact committed and transient latest-wins state for children recreated after an ACK',
  );
  assert.match(
    previewSource,
    /const finishMotionSettlement = \(\) => \{[\s\S]*?__KODETY_REAPPLY_EDITOR_LIVE_STATE__\?\.\(document, true, false\)[\s\S]*?const flushChanged = \(\) => \{[\s\S]*?const subtreeRoots = new Set\(roots[\s\S]*?roots\.forEach\(\(\[root, includeDescendants\]\) => \{[\s\S]*?if \(subtreeRoots\.has\(ancestor\)\) return[\s\S]*?settleMotion\(root, includeDescendants, true\);\s*\}\);\s*if \(roots\.length\) \{\s*finishMotionSettlement\(\);[\s\S]*?scheduleRoot\(node, true\)/,
    'new runtime subtrees must replay the compact journal once per frame and only after motion normalization',
  );
  assert.match(
    previewSource,
    /const computedChecks[\s\S]*?const elements = editorVisualElements\(check\.path\)[\s\S]*?elements\.every\(element =>[\s\S]*?getComputedStyle\(element\)/,
    'an ACK must validate every visible CMS/runtime projection instead of only the first matching child',
  );
  assert.match(
    previewSource,
    /const rebindEditorSelection[\s\S]*?previewItemIdForElement\(selected\)[\s\S]*?editorVisualElements\(path\)\.find[\s\S]*?data-html-editor-selected[\s\S]*?__KODETY_REBIND_EDITOR_SELECTION__/,
    'a selected child must stay anchored to the same CMS item when its subtree is materialized again',
  );
  assert.match(
    previewSource,
    /const authoredMotionProperties = new Set\(\[[\s\S]*?'opacity'[\s\S]*?'content-visibility'[\s\S]*?\]\)[\s\S]*?display intentionally stays outside this marker[\s\S]*?data-html-editor-canvas-author-property-/,
    'motion normalizers must respect property-level authorship while display Show continues to reveal imported animation states',
  );
  assert.match(
    editorProjectAndConstantsSource,
    /CANVAS_MOTION_AUTHORITY_PROPERTIES[\s\S]*?ownerships:[\s\S]*?CANVAS_MOTION_AUTHORITY_PROPERTIES\.has\(normalizeStylePropertyName\(name\)\)[\s\S]*?scope: 'selector'[\s\S]*?target: targetContext\.selector[\s\S]*?breakpoint: targetContext\.breakpoint[\s\S]*?pseudo: targetContext\.pseudo/,
    'a CSS Rule edit must declare property ownership for every matching class instance and its exact responsive/state context',
  );
  assert.match(
    projectEditorSource,
    /const flushCanvasStylePreview[\s\S]*?ownershipProperties[\s\S]*?scope: 'selector'[\s\S]*?scope: 'path' as const[\s\S]*?ownerships: nextCssText \? ownerships : \[\]/,
    'transient slider/input previews must acquire and release the same motion authority without waiting for persistence',
  );
  assert.match(
    previewSource,
    /const applyCanvasRuleOwnershipMarkersToElement[\s\S]*?data-html-editor-canvas-rule-property-[\s\S]*?const refreshCanvasPropertyOwnershipMarkers[\s\S]*?canvasViewPropertyOwnerships[\s\S]*?transientPropertyOwnerships/,
    'the iframe must project rule ownership onto every matching element and runtime clone',
  );
  assert.match(
    previewSource,
    /const unlockDocument = \(\) => \{[\s\S]*?if \(documentUnlocked \|\| !document\.body\) return;[\s\S]*?releaseCanvasLoadingGate\(document\.documentElement\)[\s\S]*?documentUnlocked = true/,
    'motion freeze may unlock the initial document once without continuously taking ownership from the editor',
  );
  assert.doesNotMatch(
    previewSource,
    /document\.body\.style\.setProperty\('visibility', 'visible', 'important'\)/,
    'motion freeze must never install a permanent inline body visibility override',
  );
  assert.match(
    previewSource,
    /const canvasOwnsAnyMotion[\s\S]*?data-html-editor-canvas-rule-property-[\s\S]*?handleMotionMutations[\s\S]*?canvasOwnsAnyMotion\(target\)[\s\S]*?return;/,
    'the animation observer must ignore editor-owned style/class/visibility mutations instead of starting a competing settle loop',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /PREVIEW_ONLY_MOTION_PREFERENCE|previewOnlyMotion|Animar somente no Preview/,
    'Design motion freeze is an invariant and must not be weakened by a stale browser preference or menu toggle',
  );
  const infiniteCanvasSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInfiniteCanvas.tsx'), 'utf8');
  const bufferedIframeSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx'), 'utf8');
  const infiniteCanvasRuntimeSource = await readFile(path.join(root, 'lib/html-editor/infinite-canvas-runtime.ts'), 'utf8');
  const passiveInfiniteCanvasRuntimeSource = infiniteCanvasRuntimeSource.slice(
    infiniteCanvasRuntimeSource.indexOf('function infiniteCanvasPassiveRuntimeBootstrap'),
    infiniteCanvasRuntimeSource.indexOf('export function injectInfiniteCanvasRuntime'),
  );
  const canvasProtocolSource = await readFile(path.join(root, 'lib/html-editor/canvas-protocol.ts'), 'utf8');
  const previewBridgeSource = await readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');
  const breakpointControlSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBreakpointControl.tsx'), 'utf8');
  const breakpointDeviceIconSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBreakpointDeviceIcon.tsx'), 'utf8');
  const interactionSource = await readFile(path.join(root, 'lib/html-editor/interactions.ts'), 'utf8');
  const motionTimelineSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlMotionTimeline.tsx'), 'utf8');
  const interactionsPanelSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInteractionsPanel.tsx'), 'utf8');
  const interactionLibraryPanelSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInteractionLibrary.tsx'), 'utf8');
  const fontsStoreSource = await readFile(path.join(root, 'stores/useFontsStore.ts'), 'utf8');
  const editorPlatformServicesSource = await readFile(path.join(root, 'lib/editor-platform-services.ts'), 'utf8');
  const wordpressFontTransportSource = await readFile(path.join(root, 'Wordpress/editor/wordpress-font-library-transport.ts'), 'utf8');
  const ycodeFontPickerSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/FontPicker.tsx'), 'utf8');
  const wordpressEditorShellSource = await readFile(path.join(root, 'Wordpress/kodety/templates/editor-shell.php'), 'utf8');
  const wordpressEditorCssSource = await readFile(path.join(root, 'Wordpress/editor/wordpress-editor.css'), 'utf8');
  const kodetyLoadingScreenSource = await readFile(path.join(root, 'components/ui/kodety-loading-screen.tsx'), 'utf8');
  const wordpressViteConfigSource = await readFile(path.join(root, 'Wordpress/vite.config.ts'), 'utf8');
  const wordpressPackageScriptSource = await readFile(path.join(root, 'scripts/package-wordpress-plugin.mjs'), 'utf8');
  const wordpressPluginSource = await readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8');
  const wordpressProjectAdminSource = await readFile(path.join(root, 'Wordpress/kodety/admin/kodety-page.js'), 'utf8');
  const wordpressProjectAdminCssSource = await readFile(path.join(root, 'Wordpress/kodety/admin/kodety-page.css'), 'utf8');
  assert.doesNotMatch(wordpressEditorShellSource, /['"]importUrl['"]\s*=>/, 'the Builder bootstrap must not receive the URL importer endpoint');
  assert.match(
    wordpressPluginSource,
    /<details id="kodety-import-url"[^>]*?data-kodety-url-import\s+<\?php if \(\$elementor_converter_requested\): \?>open<\?php endif; \?>>[\s\S]*?<summary class="kodety-import-url__summary">[\s\S]*?Importar site via URL[\s\S]*?<form[\s\S]*?class="kodety-import-url__form"[\s\S]*?name="action" value="kodety_import_url"[\s\S]*?wp_nonce_field\('kodety_import_url'\)/,
    'the wp-admin ZIP panel must own the closed-by-default expandable URL importer',
  );
  assert.doesNotMatch(
    wordpressPluginSource,
    /<details id="kodety-import-url"[^>]*?data-kodety-url-import\s+open(?:\s|>)/,
    'the wp-admin URL importer must be collapsed by default',
  );
  assert.match(
    wordpressPluginSource,
    /public function admin_import_url[\s\S]*?current_user_can\('kodety_import'\)[\s\S]*?if \(!\$has_permission\)[\s\S]*?check_admin_referer\('kodety_import_url'\)/,
    'open-source URL import must retain user capability and nonce checks',
  );
  assert.doesNotMatch(
    wordpressPluginSource,
    /kodety_import_kodety_domain_restricted|Importação via URL é exclusiva do Kodety Pro/,
    'URL import must have no product paywall or vendor-domain exclusion',
  );
  assert.doesNotMatch(
    wordpressProjectAdminSource,
    /isRestrictedKodetyImportUrl|KODETY_URL_IMPORT_RESTRICTION/,
    'the URL importer must allow vendor domains without a commercial restriction',
  );
  assert.match(
    wordpressPluginSource,
    /'auto'[\s\S]*?'framer'[\s\S]*?'webflow'[\s\S]*?'elementor'[\s\S]*?'code'[\s\S]*?name="kodety_platform"[\s\S]*?name="kodety_framer_mode" value="animated"[\s\S]*?name="kodety_framer_mode" value="static"[\s\S]*?name="kodety_elementor_mode" value="visual"[\s\S]*?name="kodety_elementor_mode" value="native"[\s\S]*?name="kodety_capture_delay"[\s\S]*?name="kodety_breakpoints\[\]"/,
    'the dashboard importer must preserve platform, Framer mode, Elementor conversion mode, delay, and breakpoint controls',
  );
  const elementorModes = wordpressPluginSource.match(/<fieldset\b[^>]*data-kodety-url-elementor-mode[\s\S]*?<\/fieldset>/)?.[0];
  assert.ok(elementorModes, 'Elementor import modes must exist');
  for (const expected of [
    /if \(!\$elementor_converter_requested\): \?>hidden/,
    /Página publicada completa/, /Conversão estrutural/, /rascunho Onun Kodety/,
    /Nenhum dos modos publica automaticamente/,
  ]) assert.match(elementorModes, expected, 'Elementor modes must explain their options and draft-only outcome regardless of copy order');
  assert.match(
    wordpressProjectAdminSource,
    /const platform = effectivePlatform\(\)[\s\S]*?if \(framerMode\) framerMode\.hidden = platform !== 'framer'[\s\S]*?if \(elementorMode\) elementorMode\.hidden = platform !== 'elementor'/,
    'platform-specific import modes must be visible only for their selected source',
  );
  const adminAst = ts.createSourceFile('kodety-page.js', wordpressProjectAdminSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let elementorCopyInitializer;
  const findElementorCopy = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(adminAst) === 'elementorIdleCopy') elementorCopyInitializer = node.initializer?.getText(adminAst);
    ts.forEachChild(node, findElementorCopy);
  };
  findElementorCopy(adminAst);
  assert.ok(elementorCopyInitializer, 'Elementor must provide mode-specific copy');
  for (const structured of [true, false]) {
    const copy = new Function('elementorModeIsStructured', `return (${elementorCopyInitializer})()`)(() => structured);
    assert.ok(copy.button.trim(), 'both Elementor modes need a submit label');
    assert.match(copy.status, /rascunho/);
    assert.match(copy.status, /Nenhuma alteração será publicada/, 'both modes must explain the draft-only outcome before submission');
  }
  assert.match(
    wordpressPluginSource,
    /data-kodety-url-framer-mode hidden/,
    'Framer import mode must start hidden while automatic platform detection is selected',
  );
  assert.match(
    wordpressPluginSource,
    /private function url_import_icon[\s\S]*?'framer'\s*=>[\s\S]*?'webflow'\s*=>[\s\S]*?'tablet'\s*=>[\s\S]*?'mobile'\s*=>[\s\S]*?url_import_icon\(\$platform_icon\)[\s\S]*?url_import_icon\(\$breakpoint_icon\)/,
    'the URL importer must own its platform and device iconography instead of reusing generic admin icons',
  );
  assert.match(
    wordpressPluginSource,
    /https:\/\/www\.framer\.com\/brand\/[\s\S]*?https:\/\/brand\.webflow\.com\/brand-assets[\s\S]*?'framer'\s*=>\s*'<path fill="#FFF"[^>]*d="M44\.65 33\.992h50\.7v25\.349H70z[\s\S]*?'webflow'\s*=>\s*'<path fill="#FFF"[^>]*d="M1080 0L735\.385 673\.684/,
    'the platform picker must embed the official current Framer and Webflow brand-mark paths',
  );
  assert.match(
    wordpressProjectAdminCssSource,
    /\.kodety-import-url__icon > svg\s*\{\s*display: block;\s*width: 100%;\s*height: 100%;/,
    'URL import icons must fit their accessible labeled controls',
  );
  assert.match(
    wordpressProjectAdminCssSource,
    /label:has\(input:checked\)\s*\{[^}]*?background: var\(--kodety-shell-elevated/,
    'URL import selections must use the shared selected surface',
  );
  assert.match(
    wordpressProjectAdminCssSource,
    /:is\(button, a, input, select, textarea, summary\):focus-visible\s*\{\s*outline: 2px solid var\(--kodety-project-primary\)/,
    'URL import fields must retain a visible keyboard focus indication',
  );
  assert.match(
    `${wordpressProjectAdminSource}\n${wordpressPluginSource}`,
    /captureRenderedUrlImport[\s\S]*?captureUrlImportVariants[\s\S]*?mergeUrlImportVariants[\s\S]*?kodety_rendered_html[\s\S]*?bundle_rendered_external_project[\s\S]*?\$requested_platform[\s\S]*?\$framer_mode/,
    'advanced Framer capture must execute on the wp-admin import page and reach the server with its selected mode',
  );
  const projectIoSource = await readFile(path.join(root, 'lib/html-editor/project-io.ts'), 'utf8');
  assert.match(
    projectIoSource,
    /convertProjectToShopifyThemeZip[\s\S]*?layout\/theme\.liquid[\s\S]*?content_for_header[\s\S]*?content_for_layout/,
    'ordinary Builder projects must convert into a valid Shopify theme skeleton with Liquid layout and an OS 2.0 index template',
  );
  assert.match(projectIoSource, /convertProjectToShopifyThemeZip[\s\S]*?templates\/index\.json/);
  assert.match(
    projectIoSource,
    /\$\{variable\}\.title[\s\S]*?\$\{variable\}\.featured_image[\s\S]*?bindProduct\(card, 'card_product'\)/,
    'Shopify conversion must materialize Builder product cards as native Liquid loops and add-to-cart forms',
  );
  assert.match(projectIoSource, /collections\.all\.products/);
  assert.match(projectIoSource, /action = '\/cart\/add'/);
  assert.match(
    projectIoSource,
    /\$\{variable\}\.selected_or_first_available_variant/,
    'Shopify conversion must bind collection, search, product detail and cart contexts instead of leaving headless placeholders',
  );
  assert.match(projectIoSource, /collection\.products/);
  assert.match(projectIoSource, /search\.results/);
  assert.match(projectIoSource, /cart\.items/);
  assert.match(
    wordpressEditorCssSource,
    /\[data-slot="tooltip-content"\]:not\([^)]*\)[^{]*\{[\s\S]*?--tooltip-surface:\s*var\(--kodety-control\)[\s\S]*?background:\s*var\(--tooltip-surface\)[\s\S]*?\[data-slot="tooltip-content"\]:not\([^)]*\)[^{]*>\s*svg\s*\{[\s\S]*?background:\s*var\(--tooltip-surface\)[\s\S]*?fill:\s*var\(--tooltip-surface\)/,
    'the tooltip body and arrow must share the same themed overlay surface',
  );
  assert.match(
    previewBridgeSource,
    /#__kodety-direct-overlay\s*\{[^}]*z-index:\s*(?:2147483646|(?:\\?\$\{)?[^;}]*2147483646)/,
    'normal page canvases must retain the high direct-manipulation overlay layer',
  );
  assert.doesNotMatch(
    previewBridgeSource,
    /if\s*\(\s*!directGapLayer\s*\|\|\s*directDrag\?\.kind\s*===\s*'gap'\s*\)\s*return/,
    'gap geometry must never freeze while its direct-manipulation gesture is active',
  );
  assert.match(
    previewBridgeSource,
    /key:\s*property\s*\+\s*':'\s*\+\s*Math\.min\(item\.index,\s*nearest\.index\)[\s\S]*?if\s*\(directDrag\?\.kind\s*===\s*'gap'\)[\s\S]*?const byKey = new Map[\s\S]*?paintGapHandle\(handle,\s*zone,\s*rect\)[\s\S]*?if\s*\(!used\.has\(handle\)\)\s*handle\.hidden\s*=\s*true/,
    'gap scrubbing must preserve the captured handle and repaint every stable gap band from live layout geometry',
  );
  assert.match(
    previewBridgeSource,
    /const applyDirectViewScale = rawScale[\s\S]*?directViewScale = Math\.max\(\.02, Math\.min\(2\.4, nextScale\)\)[\s\S]*?1 \/ Math\.max\(\.35, directViewScale\)[\s\S]*?html-editor-canvas-view-scale/,
    'normal and infinite canvases must inverse-scale compact direct controls without unbounded low-zoom chrome',
  );
  assert.match(
    previewBridgeSource,
    /--kodety-direct-handle-size', 8[\s\S]*?--kodety-direct-handle-hit-inset', -6[\s\S]*?--kodety-direct-corner-size', 8[\s\S]*?--kodety-direct-corner-radius', 999[\s\S]*?--kodety-direct-rotate-size', 20/,
    'Penpot-style direct manipulation must use compact circular points with forgiving 20px corner rotation targets',
  );
  assert.match(
    previewBridgeSource,
    /computed\.position === 'absolute' \|\| computed\.position === 'fixed'[\s\S]*?kind: 'position'[\s\S]*?positionX[\s\S]*?event\.shiftKey[\s\S]*?type: 'html-editor-direct-style-batch'/,
    'absolute and fixed layers must drag spatially, support axis locking, and persist as one position batch',
  );
  assert.match(
    previewBridgeSource,
    /pendingDirectCommit = drag[\s\S]*?type: 'html-editor-direct-style'[\s\S]*?gestureId: drag\.gestureId[\s\S]*?html-editor-direct-style-release[\s\S]*?releaseDirectCommitPreview\(event\.data\.gestureId\)/,
    'pointerup must retain its final visual sample until the parent releases the canonical direct-style commit',
  );
  const directCommitReleaseSource =
    previewBridgeSource.match(/const releaseDirectCommitPreview = \(gestureId, canonical = true\) => \{[\s\S]*?\n    \};/)?.[0] || '';
  assert.ok(directCommitReleaseSource, 'missing direct manipulation release handler');
  assert.match(
    directCommitReleaseSource,
    /restoreDirectPreview\(drag\)[\s\S]*?refreshDirectControls\(\)/,
    'canonical direct-style release must remove the priority preview after the stylesheet ACK is installed',
  );
  assert.match(
    previewBridgeSource,
    /selected\.style\.setProperty\('rotate', value \+ 'deg', 'important'\)[\s\S]*?selected\.style\.setProperty\('padding-top', value \+ 'px', 'important'\)/,
    'direct manipulation must use disposable inline priority so legacy authored priority cannot freeze Canvas feedback',
  );
  assert.doesNotMatch(
    previewBridgeSource,
    /pendingDirectCommitTimer|releaseDirectCommitPreview\(drag\.gestureId\)[\s\S]{0,120}?\},\s*1800\)/,
    'a direct manipulation preview must not expire before its canonical ACK',
  );
  assert.doesNotMatch(
    previewBridgeSource,
    /restoreDirectPreview\(drag\);\s*postEditorMessage\(\{\s*type: 'html-editor-direct-style'/,
    'pointerup must never restore the old style before asking the parent to commit the new one',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-direct-style'[\s\S]*?runCanvasLiveStyleBatch\(\(\) => \{[\s\S]*?directStyleCommitRef\.current\([\s\S]*?}, message\.gestureId\)/,
    'a direct gesture and every declaration it changes must share one ACK-able live mutation',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-direct-style-batch'[\s\S]*?runCanvasLiveStyleBatch\(\(\) => \{[\s\S]*?message\.styles\.forEach[\s\S]*?directStyleCommitRef\.current\([\s\S]*?}, message\.gestureId\)/,
    'position anchors from one canvas drag must share one history entry and one live-style ACK',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-direct-style-preview'[\s\S]*?queueCanvasLiveStyleState\([\s\S]*?selectedPathsRef\.current\.at\(-1\) === message\.path[\s\S]*?Object\.entries\(message\.values\)[\s\S]*?previewCanvasStyleRef\.current\([\s\S]*?index === entries\.length - 1/,
    'direct manipulation must keep canvas paint immediate while coalescing secondary Inspector mirroring',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-live-style-applied'[\s\S]*?pending\.directGestureIds\.forEach\(gestureId => \{[\s\S]*?type: 'html-editor-direct-style-release'[\s\S]*?gestureId/,
    'the parent must release direct manipulation only after the matching live mutation ACK',
  );
  const directLiveStyleAppliedSource =
    projectEditorSource.match(/if \(message\.type === 'html-editor-live-style-applied'\) \{[\s\S]*?\n        return;\n      \}/)?.[0] || '';
  assert.ok(directLiveStyleAppliedSource, 'missing direct-style ACK handler');
  assert.match(
    directLiveStyleAppliedSource,
    /scheduleCanvasStylePreviewRelease\(pending\.clearPreviewProperties\)/,
    'a persistence ACK must hand the matching versioned realtime overlay to canonical paint',
  );
  assert.match(
    projectEditorSource,
    /reconciled\.included\.flatMap\(\s*mutation => mutation\.clearPreviewProperties,[\s\S]*?scheduleCanvasStylePreviewRelease\(includedPreviewReleases\)/,
    'a canonical canvas-ready revision must release only previews already included in that document',
  );
  assert.match(
    projectEditorSource,
    /canvasStylePreviewPropertyVersionsRef\.current\.get\(normalized\) !== item\.version[\s\S]*?return \[\]/,
    'an older ACK must never release the property version owned by a newer realtime interaction',
  );
  assert.match(
    editorConstantsAndLiveDomHelpersSource,
    /const CANVAS_VISIBILITY_ATTRIBUTE_NAMES = new Set\(\[[\s\S]*?'hidden'[\s\S]*?'aria-hidden'[\s\S]*?'data-kodety-hidden-display'[\s\S]*?function canvasLiveStyleAtom[\s\S]*?normalized === 'display'[\s\S]*?visibility/,
    'display and every semantic visibility marker must share one latest-wins transaction atom',
  );
  assert.match(
    editorLiveDomHelpersSource,
    /function supersedePendingCanvasLiveStyle[\s\S]*?stylesheetSuperseded[\s\S]*?pending\.patches\.filter[\s\S]*?pending\.attributes\.filter[\s\S]*?pending\.texts\.filter[\s\S]*?pending\.checks\.filter/,
    'a newer mutation must compact only overlapping retry atoms while retaining unrelated pending work',
  );
  assert.match(
    projectEditorSource,
    /commitCanvasViewTransaction\([\s\S]*?latestCanvasViewStateDelta[\s\S]*?pendingCanvasLiveStylesRef\.current\.clear\(\)[\s\S]*?publishCanvasViewStateRef\.current\(delta \|\| snapshot\)/,
    'the newest bounded View State projection must replace the retry queue',
  );
  assert.match(
    previewBridgeSource,
    /const liveStyleAtomRevisions = new Map\(\)[\s\S]*?isSupersededLiveAtom[\s\S]*?patches\.forEach[\s\S]*?isSupersededLiveAtom\(atom, mutationRevision\)[\s\S]*?markLiveAtom\(atom, mutationRevision\)[\s\S]*?attributePatches\.forEach[\s\S]*?isSupersededLiveAtom\(atom, mutationRevision\)[\s\S]*?markLiveAtom\(atom, mutationRevision\)/,
    'every canvas frame must reject stale style and attribute atoms without blocking independent properties',
  );
  assert.match(
    previewBridgeSource,
    /staleStylesheet = !transientPreview[\s\S]*?isSupersededLiveAtom\(atom, mutationRevision\)[\s\S]*?if \(!staleStylesheet\)[\s\S]*?markLiveAtom\(atom, mutationRevision\)[\s\S]*?computedChecks\.forEach[\s\S]*?staleStylesheet[\s\S]*?isSupersededLiveAtom\(atom, mutationRevision\)/,
    'stylesheet retries and their checks must be gated per canonical file/atom in active and passive canvases',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-canvas-ready'[\s\S]*?pendingDirectGestureReleasesRef\.current\.forEach\(\(revision, gestureId\)[\s\S]*?revision > message\.revision[\s\S]*?html-editor-direct-style-release/,
    'reload-backed direct commits must retain their final sample until a canonical ready revision includes them',
  );
  assert.match(
    editorLiveDomHelpersAndProjectSource,
    /function reconcileSelectionSnapshotWithElement[\s\S]*?attributes: authored\.attributes[\s\S]*?authoredElementByPath\.get\(message\.payload\.path\)[\s\S]*?canvasSelectionRevisionFloorRef[\s\S]*?message\.revision < revisionFloor[\s\S]*?staleAuthoredSnapshot[\s\S]*?primary\?\.path === previousPrimaryPath/,
    'canonical authored attributes and per-path revision floors must prevent stale selection snapshots from rolling the Inspector back',
  );
  assert.doesNotMatch(
    canvasViewEnqueueSource,
    /canvasSelectionCanonicalHandoffRef|outgoingGeneration|requiresCanonicalRefresh/,
    'a persistent iframe commit must not enter the old outgoing-generation handoff path',
  );
  assert.match(
    projectEditorSource,
    /canonicalHandoff = primary[\s\S]*?canvasSelectionCanonicalHandoffRef\.current\.get\(primary\.path\)[\s\S]*?staleCanonicalHandoffSnapshot = shouldRetainCanvasSelectionSnapshot\([\s\S]*?canonicalHandoff,[\s\S]*?message\.generation,[\s\S]*?message\.revision,[\s\S]*?canvasSelectionCanonicalHandoffRef\.current\.delete\(primary\.path\)[\s\S]*?\(staleAuthoredSnapshot \|\| staleCanonicalHandoffSnapshot\)[\s\S]*?primary\?\.path === previousPrimaryPath/,
    'the Inspector must retain its optimistic value through same-generation echoes and release it only to a current promoted generation',
  );
  assert.match(
    canvasProtocolSource,
    /type: 'html-editor-selection'[\s\S]*?revision: number[\s\S]*?case 'html-editor-selection'[\s\S]*?consumeRevision\(value\.revision, budget\)/,
    'selection revision is a required, bounded part of the canvas protocol',
  );
  assert.match(
    canvasProtocolSource,
    /interface EditorToCanvasSelectMessage[\s\S]*?type: 'html-editor-select'[\s\S]*?reveal\?: boolean/,
    'select messages must allow restoring selection without revealing it in the viewport',
  );
  assert.match(
    previewBridgeSource,
    /selectElement\(el, Boolean\(event\.data\.additive\), 'editor'\);[\s\S]*?const selectionNeedsReveal = element => \{[\s\S]*?getBoundingClientRect\(\)[\s\S]*?rect\.width <= 0 && rect\.height <= 0[\s\S]*?document\.documentElement\?\.clientWidth \|\| window\.innerWidth[\s\S]*?document\.documentElement\?\.clientHeight \|\| window\.innerHeight[\s\S]*?rect\.bottom <= 0[\s\S]*?rect\.top >= viewportHeight[\s\S]*?rect\.right <= 0[\s\S]*?rect\.left >= viewportWidth[\s\S]*?event\.data\.reveal !== false[\s\S]*?selectionNeedsReveal\(el\)[\s\S]*?el\.scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/,
    'layer selection must preserve the canvas scroll while the target is visible and reveal only an offscreen target',
  );
  assert.match(
    previewBridgeSource,
    /initialScrollPositions\?: PreviewScrollPositions[\s\S]*?hasGuardedInitialScroll = inspectionEnabled[\s\S]*?!infiniteCanvasNavigation[\s\S]*?data-html-editor-scroll-restore-pending[\s\S]*?scroll-behavior: auto[\s\S]*?__KODETY_EDITOR_SCROLL_RESTORE_FALLBACK__/,
    'a normal inspection canvas with saved scroll must restore instantly and fail open if restoration breaks',
  );
  assert.doesNotMatch(
    previewBridgeSource,
    /data-html-editor-scroll-restore-pending[\s\S]{0,500}?opacity:\s*0\s*!important/,
    'scroll restoration must never blank a buffered canvas generation before promotion',
  );
  assert.match(
    previewBridgeSource,
    /const restoreCanvasScrollPositions = positions => \{[\s\S]*?restore\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?restore\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?restore\(\);[\s\S]*?finishCanvasScrollRestore\(version\)/,
    'document and nested scroll must be restored immediately, settled twice, and revealed only afterwards',
  );
  assert.match(
    previewBridgeSource,
    /const knownScrollKeys = new Set\([\s\S]*?'__document__'[\s\S]*?type === 'html-editor-capture-scroll'[\s\S]*?knownScrollKeys\.forEach\(postCurrentScrollState\)[\s\S]*?type: 'html-editor-scroll-checkpoint'[\s\S]*?requestId: event\.data\.requestId/,
    'a navigation checkpoint must synchronously snapshot every known scroll container before acknowledging it',
  );
  assert.match(
    projectEditorSource,
    /const restoreCanvasSelectionWithoutReveal = useCallback\(\(\) => \{\s*const selectedPaths = reconcileStructuralSelectionPaths\(\s*selectedPathsRef\.current,\s*path => path,\s*\);[\s\S]*?const primaryPath = selectedPaths\.length \? selectedPaths\.at\(-1\)! : null;[\s\S]*?const pendingPath = pendingSelectionPathRef\.current;[\s\S]*?const hasPendingPath = pendingPath !== null;[\s\S]*?hasPendingPath && pendingPath !== primaryPath[\s\S]*?\? \[pendingPath\][\s\S]*?paths\.forEach\(\(path, index\) => \{[\s\S]*?type: 'html-editor-select',[\s\S]*?path,[\s\S]*?additive: index > 0,[\s\S]*?fallbackToAncestor: true,[\s\S]*?reveal: false,/,
    'canonical rebuilds must preserve the full ordered multi-selection without moving the viewport',
  );
  assert.match(
    projectEditorSource,
    /const \[selectedPaths, setSelectedPaths\] = useState<string\[\]>\(\[\]\);[\s\S]*?selectedPathsRef\.current = selectedPaths;[\s\S]*?const clearCanvasSelectionForSurfaceChange = useCallback\(\(\) => \{[\s\S]*?pendingSelectionPathRef\.current = null;[\s\S]*?selectedPathsRef\.current = \[\];[\s\S]*?setSelection\(null\);[\s\S]*?setSelectedPaths\(\[\]\)/,
    'the srcDoc selection ref must synchronize during render and surface changes must synchronously discard pending paths',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /useEffect\(\(\) => \{\s*selectedPathsRef\.current = selectedPaths;\s*\}, \[selectedPaths\]\)/,
    'selection paths used by buildPreview must never lag one render behind in an effect',
  );
  assert.match(
    projectEditorSource,
    /const switchCanvasLocale = useCallback\([\s\S]*?setPendingLocaleCode\(code\);[\s\S]*?clearCanvasSelectionForSurfaceChange\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?materializeCanonicalCanvas\(\);[\s\S]*?setActiveLocale\(code\)/,
    'changing the rendered locale must clear selection and paint feedback before rebuilding the localized surface',
  );
  assert.doesNotMatch(
    canvasViewEnqueueSource,
    /committedCanvasRefreshRequiredRef|scheduleCommittedCanvasRefreshRef|forceCanonicalCanvasRefresh/,
    'CSS, tokens, interactions, style, attribute and text transactions must stay inside the mounted iframe',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /const scheduleCommittedCanvasRefresh|scheduleCommittedCanvasRefreshRef/,
    'the Builder must not retain a generic persisted-edit scheduler that can silently reintroduce iframe reloads',
  );
  const canvasRefreshTiming = Object.fromEntries(
    [
      'CANVAS_ACTIVE_EDIT_GRACE_MS',
      'CANVAS_MUTATION_REPLAY_MS',
      'CANVAS_MUTATION_MAX_ATTEMPTS',
      'CANVAS_MUTATION_IDLE_RETRY_MS',
      'CANVAS_CANONICAL_FALLBACK_MS',
    ].map(name => {
      const match = editorConstantsSource.match(new RegExp(`const ${name} = (\\d+);`));
      assert.ok(match, `missing finite-canvas timing constant ${name}`);
      return [name, Number(match[1])];
    }),
  );
  const previewRefreshTiming = Object.fromEntries(
    ['PREVIEW_SCROLL_RESTORE_FAIL_OPEN_MS', 'PREVIEW_RUNTIME_FONT_SETTLE_MS', 'PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS'].map(name => {
      const match = previewSource.match(new RegExp(`const ${name} = (\\d+);`));
      assert.ok(match, `missing preview reload timing constant ${name}`);
      return [name, Number(match[1])];
    }),
  );
  assert.ok(
    previewRefreshTiming.PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS <= 1000,
    'the buffered generation must still fail open within one second after its immediate start',
  );
  assert.ok(
    canvasRefreshTiming.CANVAS_MUTATION_REPLAY_MS * canvasRefreshTiming.CANVAS_MUTATION_MAX_ATTEMPTS +
      canvasRefreshTiming.CANVAS_MUTATION_IDLE_RETRY_MS +
      previewRefreshTiming.PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS <=
      1000,
    'a missing live-style ACK must enter the calm repair cadence within one second',
  );
  assert.ok(
    canvasRefreshTiming.CANVAS_CANONICAL_FALLBACK_MS + previewRefreshTiming.PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS <= 1000,
    'untracked source mutations must also have a sub-second canonical fallback',
  );
  assert.ok(
    previewRefreshTiming.PREVIEW_SCROLL_RESTORE_FAIL_OPEN_MS <= 1000 &&
      previewRefreshTiming.PREVIEW_RUNTIME_FONT_SETTLE_MS <= previewRefreshTiming.PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS,
    'scroll/font restoration must fail open quickly without revealing fallback metrics before the normal settle window',
  );
  const canvasRefreshDeferralSource = projectEditorSource.match(/const shouldDeferCanvasRefresh = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/)?.[0] || '';
  assert.ok(canvasRefreshDeferralSource, 'missing finite-canvas edit deferral policy');
  assert.doesNotMatch(
    canvasRefreshDeferralSource,
    /document\.activeElement|matches\('input/,
    'a focused inspector input is not proof of active editing and must never hold the canvas reload indefinitely',
  );
  assert.match(
    canvasViewEnqueueSource,
    /Every message accepted here is already proven to be representable[\s\S]*?commitCanvasViewTransaction[\s\S]*?publishCanvasViewStateRef\.current\(delta \|\| snapshot\)/,
    'every persisted visual mutation must synchronously advance the persistent iframe projection',
  );
  assert.match(
    projectEditorSource,
    /const activateBufferedCanvasSurface = [\s\S]*?hydrateCanvasIframe\([^;]*\);[\s\S]*?surface === 'editor'[\s\S]*?canvasStylePreviewReloadReleasesRef\.current\.length[\s\S]*?canvasStylePreviewReloadReleasesRef\.current = \[\];[\s\S]*?scheduleCanvasStylePreviewRelease\(releases\)/,
    'the queued preview must be released only after the promoted editor iframe receives its final hydrated View State',
  );
  const inspectorTextCommitSource =
    projectEditorSource.match(/const applyInspectorText = useCallback\(\(path: string, value: string\) => \{[\s\S]*?\n  \}, \[applyLocalizedText\]\);/)?.[0] ||
    '';
  assert.match(
    inspectorTextCommitSource,
    /applyLocalizedText\(path, value\)/,
    'Inspector text edits must use the same path-stable text transaction as direct canvas editing',
  );
  const inlineCanvasEditingSource = previewSource.match(/const inlineEditSessions = new WeakMap\(\);[\s\S]*?const knownScrollKeys = new Set/)?.[0] || '';
  assert.match(
    inlineCanvasEditingSource,
    /Intl\.Segmenter[\s\S]*?range\.setStart\(node, start\)[\s\S]*?range\.setEnd\(node, Math\.max\(start, end\)\)/,
    'double-click must select the word under the pointer instead of selecting the entire text element',
  );
  assert.match(
    inlineCanvasEditingSource,
    /const rich = el\.hasAttribute\('data-html-editor-rich-text'\);[\s\S]*?inlineEditSessions\.set\(el,[\s\S]*?\brich,[\s\S]*?el\.contentEditable = rich \? 'true' : 'plaintext-only'/,
    'rich text hosts must enter the continuous inline editing session',
  );
  assert.match(
    inlineCanvasEditingSource,
    /document\.addEventListener\('blur'[\s\S]*?type: 'html-editor-text-change'[\s\S]*?session\?\.rich \|\| session\?\.insertedMarkup[\s\S]*?html: cleanEditableInnerHtml\(el\)/,
    'rich text hosts must persist their sanitized span/br structure',
  );
  assert.match(
    inlineCanvasEditingSource,
    /html-editor-text-range[\s\S]*?captureInlineTextRange[\s\S]*?applyInlineTextRangeStyle[\s\S]*?data-html-editor-inline-style-range[\s\S]*?span\.style\.setProperty[\s\S]*?cleanEditableInnerHtml\(host\)/,
    'Design changes on a non-collapsed text range must materialize one reusable inline span and persist its cumulative styles',
  );
  assert.match(
    projectEditorSource,
    /const inlineRange = activeInlineTextRangeRef\.current;[\s\S]*?inlineRange\.generation === activeCanvasGenerationRef\.current[\s\S]*?type: 'html-editor-inline-range-style'[\s\S]*?property: name,[\s\S]*?value/,
    'the Design style transaction must target the active canvas text range before falling back to whole-layer CSS/inline styling',
  );
  assert.doesNotMatch(
    inlineCanvasEditingSource,
    /selectNodeContents\(el\)|if \(el\.children\.length\) el\.textContent/,
    'entering inline editing must never flatten span children or select the whole element',
  );
  assert.doesNotMatch(
    inspectorTextCommitSource,
    /committedCanvasRefresh|forceCanonicalCanvasRefresh|setCanvasProject|setCanvasReloadKey/,
    'Inspector text commits must not replace the iframe after their realtime paint',
  );
  assert.match(
    projectEditorSource,
    /const commitLocaleInsertionSourceMutation = useCallback[\s\S]*?refreshCanvas: boolean \| 'live'[\s\S]*?useLiveProjection[\s\S]*?canApplyCanvasLiveDomDelta[\s\S]*?commitProject\([\s\S]*?refreshCanvas === true \|\| \(useLiveProjection && !canProjectLive\)[\s\S]*?enqueueCanvasLiveStyle[\s\S]*?const applyLocalizedText = useCallback[\s\S]*?patchElementInnerHtml[\s\S]*?commitLocaleInsertionSourceMutation\(path,[\s\S]*?patchText\(html, insertionPath\)[\s\S]*?'live'/,
    'plain and span/br text inside a locale-exclusive insertion must use the live projection and reserve iframe rebuilds for an unrepresentable fallback',
  );
  assert.doesNotMatch(
    previewSource,
    /data-html-editor-project-fonts-guard[\s\S]*?visibility: hidden/,
    'project fonts may delay readiness metrics but must never blank the visible canvas while they load',
  );
  assert.match(
    bufferedIframeSource,
    /const documents = pendingDocument[\s\S]*?visibleDocument[\s\S]*?pending: false[\s\S]*?pendingDocument[\s\S]*?pending: true[\s\S]*?document\.pending \|\| document\.retained[\s\S]*?absolute inset-0 z-0[\s\S]*?nonInteractive && 'pointer-events-none'[\s\S]*?document\.pending && !incoming[\s\S]*?opacity-\[0\.01\]/,
    'a canonical srcDoc generation must load behind the currently painted canvas instead of navigating it to white',
  );
  assert.match(
    bufferedIframeSource,
    /const promotePendingDocument[\s\S]*?promotionNotificationRef\.current = \{ document, kind: 'buffered' \}[\s\S]*?setVisibleDocument\(document\)[\s\S]*?setPendingDocument[\s\S]*?assignExternalNode\(node\)[\s\S]*?onPromoteRef\.current\?\.\([\s\S]*?document\.key,[\s\S]*?document\.revision,[\s\S]*?document\.surfaceKey,[\s\S]*?notification\.kind[\s\S]*?const handlePendingLoad[\s\S]*?onBufferedLoad\?\.\([\s\S]*?event,[\s\S]*?document\.key,[\s\S]*?document\.revision,[\s\S]*?semanticNavigation/,
    'the hidden generation must receive cached assets without replacing the realtime frame, then hydrate only after atomic promotion',
  );
  assert.match(
    bufferedIframeSource,
    /isBufferedDocumentInitialPaintReadyMessage[\s\S]*?html-editor-buffer-ready[\s\S]*?html-editor-first-content-ready[\s\S]*?html-editor-buffer-visuals-ready[\s\S]*?const revealInitialDocument[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?setInitialVisualReadyDocument\(visibleDocument\)[\s\S]*?isBufferedDocumentInitialPaintReadyMessage\(event\.data\)[\s\S]*?markDocumentPaintReady\(visibleDocument\.mountKey\)[\s\S]*?revealInitialDocument\(\)[\s\S]*?onInitialVisualReadyRef\.current\?\.\([\s\S]*?initialVisualReadyDocument\.key[\s\S]*?const handleVisibleLoad/,
    'an initial surface must reveal after first critical-content paint while optional media and authored loaders continue progressively',
  );
  assert.match(
    bufferedIframeSource,
    /const handleVisibleLoad[\s\S]*?document: BufferedDocument[\s\S]*?onLoad\?\.\(event, document\.key, document\.revision\)[\s\S]*?handleVisibleLoad\(event, document\)/,
    'the first visible iframe must activate the exact document generation that loaded instead of a newer React prop',
  );
  assert.match(
    bufferedIframeSource,
    /progressiveSemanticNavigation[\s\S]*?semanticNavigation[\s\S]*?markDocumentPaintReady\(document\.mountKey\)/,
    'progressive load promotion must remain an explicit buffered-iframe opt-in',
  );
  const localizedPageCanvasStart = canvasStageSource.indexOf('data-page-editor-canvas-surface');
  const localizedComponentCanvasStart = canvasStageSource.indexOf('data-component-editor-canvas-surface');
  const localizedRuntimePreviewStart = canvasStageSource.indexOf('data-runtime-preview-surface');
  assert.ok(
    localizedPageCanvasStart >= 0
      && localizedComponentCanvasStart > localizedPageCanvasStart
      && localizedRuntimePreviewStart > localizedComponentCanvasStart,
    'missing isolated canvas surface boundaries',
  );
  const localizedPageCanvasSource = canvasStageSource.slice(
    localizedPageCanvasStart,
    localizedComponentCanvasStart,
  );
  const nonLocalizedCanvasSource = canvasStageSource.slice(localizedComponentCanvasStart);
  assert.match(
    canvasStageSource,
    /const localizedDesignCanvas = resolvedActiveLocale !== localizationSourceLocale;/,
    'the load-promotion opt-in must be derived from a non-source Design locale',
  );
  assert.match(
    localizedPageCanvasSource,
    /retainDocument=\{!localizedDesignCanvas\}[\s\S]*?pinRetainedDocument=\{!localizedDesignCanvas\}[\s\S]*?progressiveSemanticNavigation=\{localizedDesignCanvas\}/,
    'localized page Design must disable retained semantic contexts before promoting on load',
  );
  assert.doesNotMatch(
    nonLocalizedCanvasSource,
    /progressiveSemanticNavigation/,
    'component Design and runtime Preview must not opt into load promotion',
  );
  assert.match(
    bufferedIframeSource,
    /function isBufferedDocumentPaintReadyMessage\(data: unknown\)[\s\S]*?return type === 'html-editor-buffer-visuals-ready';/,
    'the default buffered generation must use the bounded in-frame visuals-ready signal',
  );
  assert.match(
    bufferedIframeSource,
    /!isBufferedDocumentPaintReadyMessage\(event\.data\)[\s\S]*?return;[\s\S]*?markDocumentPaintReady\(document\.mountKey\);[\s\S]*?schedulePromotion\(\);/,
    'a generation without the localized opt-in must wait for visuals-ready before crossing its paint barrier',
  );
  const pendingLoadStart = bufferedIframeSource.indexOf('  const handlePendingLoad = useCallback');
  const pendingLoadEnd = bufferedIframeSource.indexOf('  const retainedDocuments =', pendingLoadStart);
  assert.ok(pendingLoadStart >= 0 && pendingLoadEnd > pendingLoadStart, 'missing buffered pending-load handler');
  const pendingLoadSource = bufferedIframeSource.slice(pendingLoadStart, pendingLoadEnd);
  assert.match(pendingLoadSource, /onBufferedLoad\?\./);
  assert.doesNotMatch(pendingLoadSource, /schedulePromotion|promotePendingDocument|setTimeout/);
  assert.match(
    canvasStageSource,
    /data-page-editor-canvas-surface[\s\S]*?onBufferedLoad=\{\(event, bufferedGeneration\)[\s\S]*?sendRuntimeAssetsToFrame\(event\.currentTarget\.contentWindow, 'fonts', bufferedGeneration\)/,
    'Design load must start font transfer while source-locale promotion remains on the strong gate',
  );
  assert.match(
    canvasStageSource,
    /data-runtime-preview-surface[\s\S]*?onBufferedLoad=\{\(event, bufferedGeneration, _revision, _surfaceKey, semanticNavigation\)[\s\S]*?semanticNavigation \? 'fonts' : 'all'/,
    'Preview load must transfer fonts for a page change and all assets for a same-surface refresh',
  );
  assert.match(
    projectEditorSource,
    /const openedProjectSignature = localBootstrap\?\.projectSignature[\s\S]*?ensureProjectIdentity\(sanitizeProjectPriorities\(next\)\)[\s\S]*?const normalizedProjectSignature[\s\S]*?lastWordPressDraftSignatureRef\.current = replaceWordPressWorkspace[\s\S]*?openedProjectSignature[\s\S]*?normalizedProjectSignature !== openedProjectSignature[\s\S]*?scheduleWordPressDraftWrite\(next\)/,
    'metadata created while opening an imported workspace must be persisted instead of being marked as server-acknowledged',
  );
  assert.doesNotMatch(
    bufferedIframeSource,
    /HTML_BUFFERED_IFRAME_(?:INITIAL|PROMOTION)_FAIL_OPEN_MS|setTimeout\(\s*(?:revealInitialDocument|schedulePromotion)/,
    'loaded iframe generations must not wait behind an artificial fail-open timeout',
  );
  assert.match(
    canvasStageSource,
    /data-page-editor-canvas-surface[\s\S]*?documentKey=\{pageCanvasPreview\?\.generation[\s\S]*?iframeRef=\{setPageCanvasIframeNode\}[\s\S]*?data-component-editor-canvas-surface[\s\S]*?iframeRef=\{setComponentCanvasIframeNode\}[\s\S]*?data-runtime-preview-surface[\s\S]*?documentKey=\{preview\.generation\}[\s\S]*?iframeRef=\{setRuntimePreviewIframeNode\}/,
    'Canvas and Preview must be separate mounted surfaces with separate iframe ownership',
  );
  assert.match(
    projectEditorSource,
    /const runtimePreviewVisible = Boolean\(isPreviewing && preview\);[\s\S]*?if \(!isPreviewing\) return;[\s\S]*?setRuntimePreviewReadyGeneration\(''\)[\s\S]*?canvasScrollRef\.current\.scrollTop = 0/,
    'entering Preview must reset readiness and scroll to its start without an artificial minimum loading interval',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /RUNTIME_PREVIEW_LOADING_MIN_MS|runtimePreviewMinimumDelayElapsed/,
    'Preview must become visible as soon as its real iframe is ready',
  );
  assert.match(
    projectEditorSource,
    /const handleRuntimePreviewPromotion[\s\S]*?generation === preview\?\.generation[\s\S]*?surfaceKey === runtimePreviewSemanticSurfaceKey[\s\S]*?setRuntimePreviewReadyGeneration\(generation\)/,
    'every accepted Preview refresh promotion must advance readiness to the new generation instead of leaving the review loader stuck',
  );
  assert.match(
    projectEditorSource,
    /const enterFocusedPreview[\s\S]*?topbarWp\?\.editorUrl\s*\|\|\s*'\/kodety\/editor\/'[\s\S]*?url\.search = ''[\s\S]*?kodety-preview-review[\s\S]*?kodety-preview-viewport[\s\S]*?window\.open\('about:blank', '_blank'\)[\s\S]*?Salvando e preparando o preview[\s\S]*?const savePromise = prepareWorkspacePreview[\s\S]*?prepareWorkspacePreview\(current\)[\s\S]*?saveProjectNow\(\{ notifySuccess: false \}\)[\s\S]*?previewTab\.location\.replace\(latestRoute\)/,
    'Preview must reserve a trusted tab, persist the exact draft, and navigate to the stable review route only once',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /focusedPreviewReloadSignatureRef|reviewWindow\.location\.replace\(route\)/,
    'the review tab must never perform a second signature-driven navigation after its first paint',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /const enterFocusedPreview[\s\S]{0,4200}?window\.open\(reviewRoute, '_blank'/,
    'Play must not show an old review and then reload it after the draft save races the first request',
  );
  assert.match(
    projectEditorSource,
    /const existing = focusedPreviewTabRef\.current[\s\S]*?about:blank[\s\S]*?existing\.location\.replace\(reviewRoute\)/,
    'Play must recover a previously reserved review tab if it is ever found on about:blank',
  );
  assert.doesNotMatch(
    `${canvasStageSource}\n${bufferedIframeSource}`,
    /data-html-buffered-iframe-placeholder|Preparando canvas|Preparando Preview|Carregando Preview/,
    'Builder loading chrome must never cover the authored Canvas or executable Preview surface',
  );
  assert.match(
    bufferedIframeSource,
    /const schedulePromotion[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?secondPromotionFrame = window\.requestAnimationFrame[\s\S]*?promote\(\)[\s\S]*?const handleVisualsReady[\s\S]*?event\.source !== node\.contentWindow[\s\S]*?isBufferedDocumentPaintReadyMessage\(event\.data\)[\s\S]*?markDocumentPaintReady\(document\.mountKey\)[\s\S]*?schedulePromotion\(\)/,
    'a canonical iframe must keep the old paint during buffering and promote after its two compositor boundaries',
  );
  assert.doesNotMatch(
    bufferedIframeSource,
    /data-html-buffered-iframe-placeholder|kodety-loading-bar-indeterminate/,
    'the first canvas must paint progressively without an opaque loading overlay',
  );
  assert.match(
    previewSource,
    /window\.parent\.postMessage\(\{ type: 'html-editor-buffer-ready' \}, '\*'\)[\s\S]*?const startEditorBridge = \(\) => \{[\s\S]*?const startEditorBridgeOnce[\s\S]*?startEditorBridgeOnce\(\)/,
    'the editor bridge must initialize synchronously so background tabs cannot miss asset or interaction messages',
  );
  assert.match(
    previewSource,
    /projectFontsStyle\.media = 'not all'[\s\S]*?const activateProjectFontStyles = \(\) => \{[\s\S]*?data-html-editor-project-fonts[\s\S]*?removeAttribute\('media'\)[\s\S]*?runtimeFontAssetPaths\.every[\s\S]*?activateProjectFontStyles\(\)/,
    'project font CSS must stay inactive until iframe-owned font Blob URLs replace transfer markers',
  );
  assert.match(
    previewSource,
    /data-html-editor-google-font-state[\s\S]*?'pending'[\s\S]*?addEventListener\('load'[\s\S]*?'loaded'[\s\S]*?addEventListener\('error'[\s\S]*?'error'/,
    'Google font links must expose a settled state so cached responses cannot force the complete timeout path',
  );
  assert.match(
    previewSource,
    /const stylesheetSettlement = waitForStylesheets\(\);[\s\S]*?activateDeferredFontStylesheets\(\);[\s\S]*?return stylesheetSettlement;/,
    'the Canvas must subscribe to Google font stylesheet settlement before activating deferred links',
  );
  assert.match(
    fontsStoreSource,
    /const fontLibraryTransport = getFontLibraryTransport\(\);[\s\S]*?const initialInstalledFonts = fontLibraryTransport\.readInstalledFontsSnapshot\(\);[\s\S]*?fonts: initialInstalledFonts,[\s\S]*?fontsCss: initialInstalledFonts\.length \? buildAllFontsCss\(initialInstalledFonts\) : ''[\s\S]*?isLoaded: initialInstalledFontsLoaded/,
    'the installed platform transport must hydrate persisted fonts before the first Canvas document is built',
  );
  assert.match(
    ycodeFontPickerSource,
    /fontFamilySelectionValue\(font, value, true\)/,
    'font selection must persist a category fallback while the remote Google face settles',
  );
  assert.doesNotMatch(
    ycodeFontPickerSource,
    /const familyValue = getFontFamilyValue\(font\)/,
    'the style picker must not persist a bare remote family with the browser serif as its implicit fallback',
  );
  const installedFontFixture = (family, name = family.toLocaleLowerCase().replace(/\s+/g, '-')) => ({
    id: `google-${name}`,
    name,
    family,
    type: 'google',
    variants: ['regular'],
    weights: ['400'],
    category: 'sans-serif',
    is_published: true,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  });
  assert.deepEqual(
    fontUtils
      .fontsReferencedBySources([installedFontFixture('Actor'), installedFontFixture('Acme')], ['.case-title { font-family: "Actor", sans-serif; }'])
      .map(font => font.family),
    ['Actor'],
    'the Canvas must not fetch unrelated families merely because they exist in the installed picker catalog',
  );
  assert.deepEqual(
    fontUtils
      .fontsReferencedBySources([installedFontFixture('Anek Devanagari'), installedFontFixture('Actor')], ['<h1 class="font-[Anek_Devanagari]">Title</h1>'])
      .map(font => font.family),
    ['Anek Devanagari'],
    'arbitrary font utility classes must retain their selected Google family in the scoped Canvas catalog',
  );
  assert.match(
    previewSource,
    /const projectInstalledFonts = projectReferencedInstalledFonts\(project, installedFonts\)[\s\S]*?const pageInstalledFonts = fontsReferencedBySources\(installedFonts, \[source\]\)[\s\S]*?const surfaceInstalledFonts = installedFonts\.filter[\s\S]*?getFontStylesheetResources\(surfaceInstalledFonts\)[\s\S]*?buildFontClassesCss\(surfaceInstalledFonts\)/,
    'the preview must use the same surface-scoped catalog for network links and installed font classes',
  );
  assert.match(
    projectEditorSource,
    /const rebuildInstalledFontsCss = useFontsStore\(state => state\.rebuildCss\)[\s\S]*?if \(installedFontsLoaded\) rebuildInstalledFontsCss\(\)/,
    'an already hydrated WordPress font catalog must inject its CSS during the initial editor mount',
  );
  assert.match(
    projectEditorSource,
    /const installedFonts = useFontsStore\(state => state\.fonts\)[\s\S]*?void loadInstalledFonts\(\)/,
    'every editor instance must initialize its installed-font catalog without waiting for the picker',
  );
  assert.match(
    projectEditorSource,
    /const editorCanvasPreviewCacheRef[\s\S]*?const nextPreview = buildPreview\([\s\S]*?installedFonts,/,
    'every Canvas srcdoc must receive the installed-font catalog directly',
  );
  assert.match(
    projectEditorSource,
    /Returning from runtime Preview used to synchronously parse[\s\S]*?!isPreviewing[\s\S]*?previousPreviewModeRef\.current[\s\S]*?cachedEditorCanvas\.surfaceKey === editorCanvasSemanticSurfaceKey[\s\S]*?cachedEditorCanvas\.preview\.revision === currentCanvasRevision[\s\S]*?previewProjectRef\.current = cachedEditorCanvas\.project;[\s\S]*?return cachedEditorCanvas\.preview;/,
    'returning from Preview must restore the painted editor cache before entering the full buildPreview pipeline',
  );
  assert.match(
    editorLiveDomHelpersAndProjectSource,
    /function membershipGateRoots[\s\S]*?!source\.includes\(MEMBERSHIP_GATE_ATTRIBUTE\)[\s\S]*?const pageMembershipGateRoots = useMemo\([\s\S]*?const selectedMembershipGateId = useMemo\([\s\S]*?pageMembershipGateRoots/,
    'pages without membership gates must not create a DOMParser merely because the selected layer changed',
  );
  assert.match(
    projectEditorSource,
    /combinedTextLinesCacheRef[\s\S]*?!selection\.hasElementChildren[\s\S]*?cache\.source !== source[\s\S]*?cache\.values\.has\(selection\.path\)[\s\S]*?getCombinedTextLines\(source, selection\.path\)/,
    'leaf selections and repeated container selections must not reparse the complete HTML for combined-text detection',
  );
  assert.match(
    previewSource,
    /const html = '<!doctype html>\\n' \+ document\.documentElement\.outerHTML;[\s\S]*?let passiveHtml = '';[\s\S]*?if \(infiniteCanvasNavigation\) \{[\s\S]*?const passiveDocument = document\.cloneNode\(true\)[\s\S]*?passiveHtml = '<!doctype html>\\n' \+ passiveDocument\.documentElement\.outerHTML;[\s\S]*?return \{[\s\S]*?html,[\s\S]*?passiveHtml,/,
    'finite Canvas reloads must serialize only their active document and reserve the expensive passive clone for Infinite Canvas',
  );
  assert.match(
    projectEditorSource,
    /const elementTreeCacheRef = useRef\(new Map[\s\S]*?const cachedElementTree = useCallback[\s\S]*?cached\?\.source === treeSource[\s\S]*?entry\.source === treeSource[\s\S]*?buildElementTree\(treeSource\)[\s\S]*?const tree = useMemo\([\s\S]*?cachedElementTree\([\s\S]*?`rendered:\$\{project\?\.mainHtmlPath \|\| ''\}`[\s\S]*?const linkPages = useMemo[\s\S]*?cachedElementTree\([\s\S]*?`source:\$\{path\}`/,
    'Layers and link navigation must share parsed page trees instead of reparsing every unchanged page during a canonical reload',
  );
  assert.match(
    projectEditorSource,
    /const analyticsTrackingTargets = useMemo\([\s\S]*?project && appView === 'analytics'[\s\S]*?trackingTargetsForProject\(project, htmlPages, homeHtmlPath\)[\s\S]*?\[appView, homeHtmlPath, htmlPages, project\]/,
    'ordinary Builder edits must not parse every page for Analytics targets while the Analytics workspace is closed',
  );
  assert.match(
    previewSource,
    /let bufferedVisualsReadySent = false[\s\S]*?let bufferedFontsSettled = !runtimeFontAssetPaths\.length[\s\S]*?let bufferedInitialAssetSweepComplete[\s\S]*?let bufferedVisibleImagesSettled[\s\S]*?const maybeSignalBufferedVisualsReady = \(\) => \{[\s\S]*?!bufferedFontsSettled[\s\S]*?!bufferedInitialAssetSweepComplete[\s\S]*?!bufferedVisibleImagesSettled[\s\S]*?type: 'html-editor-buffer-visuals-ready'/,
    'the hidden canvas must announce readiness only after fonts, the asset sweep and visible images settle',
  );
  assert.match(
    previewSource,
    /scheduleBufferedVisualAssetSettlement = \(\) => \{[\s\S]*?pendingRuntimeAssetRequests\.size[\s\S]*?Array\.from\(document\.images \|\| \[\]\)[\s\S]*?image\.decode\(\)[\s\S]*?bufferedVisibleImagesSettled = true[\s\S]*?maybeSignalBufferedVisualsReady\(\)/,
    'a newly shown image must decode behind the old canvas before a display reload is promoted',
  );
  assert.match(
    projectEditorSource,
    /const sendRuntimeAssetsToFrame = useCallback\([\s\S]*?phase: 'fonts' \| 'all' = 'fonts'[\s\S]*?runtimeFontAssetPaths[\s\S]*?fontsOnly[\s\S]*?sendRuntimeAssetsRef\.current = \(\) => \{[\s\S]*?sendRuntimeAssetsToFrame\(frame, isPreviewingRef\.current \? 'all' : 'fonts'\);[\s\S]*?runtimeAssetsSentRef\.current = Boolean\(frame\)/,
    'active Preview must eagerly batch only its referenced binaries for authored loaders while Design remains font-only',
  );
  assert.match(
    canvasStageSource,
    /<HtmlInfiniteCanvas[\s\S]*?onActiveFrameBufferedLoad=\{\(frame, bufferedGeneration\)[\s\S]*?sendRuntimeAssetsToFrame\(frame\.contentWindow, 'all', bufferedGeneration\)/,
    'an Infinite Canvas active hidden generation must receive every referenced asset before promotion',
  );
  assert.match(
    previewSource,
    /event\.data\?\.type === 'html-editor-buffer-promoted'[\s\S]*?pendingRuntimeAssetRequests\.forEach\(enqueueRuntimeAssetRequest\)[\s\S]*?flushRuntimeAssetRequests\(\)[\s\S]*?sweepRuntimeAssets\(document\.documentElement\)[\s\S]*?sweepRuntimeStyles\(document\.documentElement\)/,
    'a promoted frame must replay any asset request deferred while it was not the command target',
  );
  assert.match(
    previewSource,
    /const flushRuntimeAssetRequests[\s\S]*?for \(let offset = 0; offset < paths\.length; offset \+= 1024\)[\s\S]*?type: 'html-editor-runtime-assets-request'[\s\S]*?const enqueueRuntimeAssetRequest[\s\S]*?queueMicrotask\(flushRuntimeAssetRequests\)/,
    'runtime asset discovery must batch Design and Preview requests through the bounded protocol',
  );
  assert.match(
    projectEditorSource,
    /promotedCanvasDocumentByNodeRef = useRef\(new WeakMap<HTMLIFrameElement,[\s\S]*?const activateBufferedCanvasSurface = [\s\S]*?surface: 'editor' \| 'preview'[\s\S]*?promotedCanvasDocumentByNodeRef\.current\.set\(node, promoted\)[\s\S]*?\(surface === 'preview'\) !== isPreviewingRef\.current[\s\S]*?iframeRef\.current = node[\s\S]*?activeCanvasGenerationRef\.current = generation[\s\S]*?const handleEditorCanvasPromotion[\s\S]*?const handleRuntimePreviewPromotion/,
    'Canvas and Preview promotions must remember their painted generation on the iframe that owns it without taking ownership of each other’s command channel',
  );
  assert.match(
    projectEditorSource,
    /Building a hidden canonical generation must not revoke the visible[\s\S]*?\}, \[activeSurfacePreview\?\.generation\]\)[\s\S]*?const promoted = promotedCanvasDocumentByNodeRef\.current\.get\(node\)[\s\S]*?if \(!promoted\) return;[\s\S]*?activeCanvasGenerationRef\.current = promoted\.generation/,
    'a hidden canonical generation must leave the currently painted frame authoritative until atomic promotion',
  );
  assert.match(
    projectEditorSource,
    /A canonical reload first resets the View State[\s\S]*?if \(promoted\.generation !== activeSurfacePreview\.generation\) return;\s*hydrateCanvasIframe\(false\)/,
    'a hidden canonical generation must never rehydrate the outgoing painted iframe with the replacement generation’s reset View State',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-canvas-ready'[\s\S]*?if \(isPreviewingRef\.current\) return;[\s\S]*?postDesignTokensToFrame\(sourceFrame\)[\s\S]*?postCanvasViewStateToFrame\(sourceFrame\)[\s\S]*?restoreCanvasSelectionWithoutReveal\(\)/,
    'runtime Preview readiness must not replay Canvas tokens, View State or selection',
  );
  assert.match(
    projectEditorSource,
    /const publishCanvasViewState = useCallback[\s\S]*?if \(isPreviewingRef\.current\) return;[\s\S]*?postCanvasViewStateToFrame\(iframeRef\.current\?\.contentWindow, projection\)/,
    'editor View State publication must be disabled while the Preview surface owns the command channel',
  );
  assert.match(
    previewSource,
    /runtimeAssetPaths: Object\.keys\(runtimeAssetUrls\),[\s\S]*?runtimeFontAssetPaths: projectFontRuntimeAssetPaths/,
    'the preview must expose the exact font subset used by the phased asset handoff',
  );
  assert.match(
    previewSource,
    /const iframeRuntimeObjectUrls = new Map\(\)[\s\S]*?iframeRuntimeObjectUrls\.get\(asset\.path\)[\s\S]*?iframeRuntimeObjectUrls\.set\(asset\.path, url\)/,
    'progressive media installation must preserve already-settled font object URLs',
  );
  assert.match(
    canvasStageSource,
    /data-editor-canvas-surface[\s\S]*?data-page-editor-canvas-surface[\s\S]*?<HtmlBufferedIframe[\s\S]*?documentKey=\{pageCanvasPreview\?\.generation \|\| ''\}[\s\S]*?title="Canvas persistente da página HTML"/,
    'the finite canvas must use the buffered iframe for silent display refreshes',
  );
  assert.match(
    canvasStageSource,
    /data-page-editor-canvas-surface[\s\S]*?<HtmlBufferedIframe[\s\S]*?documentKey=\{pageCanvasPreview\?\.generation \|\| ''\}[\s\S]*?surfaceKey=\{pageCanvasSemanticSurfaceKey\}[\s\S]*?retainDocument[\s\S]*?data-component-editor-canvas-surface[\s\S]*?<HtmlBufferedIframe[\s\S]*?documentKey=\{componentCanvasPreview\.generation\}[\s\S]*?surfaceKey=\{componentCanvasSemanticSurfaceKey\}[\s\S]*?retainDocument/,
    'component masters and pages must retain their painted surface instead of remounting to a blank iframe',
  );
  assert.doesNotMatch(
    canvasStageSource,
    /key=\{editingHtmlComponent \? 'component-master' : 'page-document'\}/,
    'entering or leaving a component must never destroy the buffered page browsing context',
  );
  assert.match(
    bufferedIframeSource,
    /retained\.surfaceKey === surfaceKey[\s\S]*?show the already-painted page\/component immediately[\s\S]*?retained\.revision === documentRevision[\s\S]*?setPendingDocument/,
    'a cached page/component surface must be shown immediately while its newer canonical revision buffers',
  );
  assert.match(
    infiniteCanvasSource,
    /<HtmlBufferedIframe[\s\S]*?documentKey=\{`\$\{documentKey\}:active-editor`\}[\s\S]*?iframeRef=\{setActiveIframeNode\}/,
    'the editable Infinite Canvas frame must preserve its previous paint while the canonical display generation loads',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-live-style-applied'[\s\S]*?ACK confirms persistence[\s\S]*?committedCanvasRefreshRequiredRef\.current = false[\s\S]*?cancelAnimationFrame\(committedCanvasRefreshFrameRef\.current\)[\s\S]*?clearTimeout\(committedCanvasRefreshCheckpointRef\.current\.timeout\)/,
    'a live mutation ACK may confirm persistence but must never repaint or navigate the realtime iframe',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-scroll-state'[\s\S]*?scrollState\[message\.key\] = \{ x: message\.x, y: message\.y \};[\s\S]*?return;[\s\S]*?message\.type === 'html-editor-scroll-checkpoint'[\s\S]*?scroll event\/checkpoint is never permission to rebuild srcdoc[\s\S]*?return;/,
    'scroll state and legacy checkpoints must terminate without authorizing a canvas reload',
  );
  assert.match(
    canvasProtocolSource,
    /type: 'html-editor-scroll-checkpoint'; requestId: string[\s\S]*?case 'html-editor-scroll-checkpoint'[\s\S]*?\^canonical-scroll:\\d\+\$/,
    'scroll checkpoint acknowledgements must be generation-bound and accept only parent-issued request ids',
  );
  assert.match(
    projectEditorSource,
    /const forceCanonicalCanvasRefresh = useCallback[\s\S]*?cancelAnimationFrame\(committedCanvasRefreshFrameRef\.current\)[\s\S]*?clearTimeout\(committedCanvasRefreshIdleTimerRef\.current\)[\s\S]*?clearTimeout\(committedCanvasRefreshCheckpointRef\.current\.timeout\)[\s\S]*?clearTimeout\(canvasCanonicalFallbackTimerRef\.current\)[\s\S]*?silentCanvasRefreshRef\.current = true[\s\S]*?setCanvasReloadKey\(key => key \+ 1\)/,
    'a deliberate canonical rebuild must cancel every obsolete proof, supersede the old fallback and mark the navigation as silent',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-canvas-ready'[\s\S]*?message\.revision >= projectRevisionRef\.current[\s\S]*?cancelAnimationFrame\(committedCanvasRefreshFrameRef\.current\)[\s\S]*?clearTimeout\(committedCanvasRefreshIdleTimerRef\.current\)[\s\S]*?clearTimeout\(committedCanvasRefreshCheckpointRef\.current\.timeout\)/,
    'a current canonical canvas-ready event must cancel an obsolete queued proof so it cannot cause a second reload',
  );
  const liveStyleAppliedSource =
    projectEditorSource.match(/if \(message\.type === 'html-editor-live-style-applied'\) \{[\s\S]*?\n        return;\n      \}/)?.[0] || '';
  assert.ok(liveStyleAppliedSource, 'missing live-style ACK handler');
  assert.doesNotMatch(
    liveStyleAppliedSource,
    /scheduleCommittedCanvasRefreshRef|forceCanonicalCanvasRefresh|setCanvasProject|setCanvasReloadKey/,
    'a lagging or current visual ACK must never schedule iframe replacement',
  );
  assert.match(
    projectEditorAndCanvasStageSource,
    /const postDesignTokensToFrame = useCallback[\s\S]*?readEditorMetadata\(current\)\.designTokens[\s\S]*?type: 'html-editor-design-tokens'[\s\S]*?message\.type === 'html-editor-canvas-ready'[\s\S]*?postDesignTokensToFrame\(sourceFrame\)[\s\S]*?onPassiveFrameLoad=\{\(frame, id\) => \{[\s\S]*?postDesignTokensToFrame\(frame\.contentWindow\)/,
    'current design tokens must be replayed into every rebuilt active or passive canvas rather than relying on one best-effort post',
  );
  assert.match(
    projectEditorSource,
    /const publishCanvasViewState = useCallback[\s\S]*?postCanvasMessage\(message\)[\s\S]*?postPassiveCanvasMessage\(message\)/,
    'each authoritative View State delta must reach active and passive Infinite Canvas frames in the same ordered publication',
  );
  assert.match(
    editorTypesAndProjectSource,
    /interface PendingCanvasLiveStyle[\s\S]*?repairing\?: boolean[\s\S]*?if \(exhausted\.length\) \{[\s\S]*?mutation\.attempts = 0;[\s\S]*?mutation\.repairing = true;[\s\S]*?CANVAS_MUTATION_REPAIR_RETRY_MS[\s\S]*?const replayable = reconciled\.replay;[\s\S]*?replayable\.some\(mutation => mutation\.repairing\)[\s\S]*?CANVAS_MUTATION_REPAIR_RETRY_MS/,
    'an unconfirmed visual mutation must use the throttled repair loop in every canvas mode instead of reloading',
  );
  const mutationReplaySource =
    projectEditorSource.match(
      /const scheduleCanvasMutationReplay = useCallback\([\s\S]*?scheduleCanvasMutationReplayRef\.current = scheduleCanvasMutationReplay;/,
    )?.[0] || '';
  assert.ok(mutationReplaySource, 'missing visual mutation repair scheduler');
  assert.doesNotMatch(
    mutationReplaySource,
    /forceCanonicalCanvasRefresh|setCanvasProject|setCanvasReloadKey/,
    'visual mutation repair must remain inside the existing iframe even after repeated rejection',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-live-style-rejected'[\s\S]*?pending\.repairing = true[\s\S]*?clearTimeout\(canvasMutationReplayTimerRef\.current\)[\s\S]*?CANVAS_MUTATION_REPAIR_RETRY_MS/,
    'an explicit bridge rejection must move directly into the throttled repair path',
  );
  assert.match(
    projectEditorSource,
    /const silentRefresh = silentCanvasRefreshRef\.current[\s\S]*?if \(silentRefresh\) \{[\s\S]*?infiniteCanvasLoadingTrackingRef\.current = false[\s\S]*?setInfiniteCanvasLoadingVisible\(false\)/,
    'canonical style refreshes must not cover an already usable infinite canvas with the loading screen',
  );
  assert.match(
    projectEditorSource,
    /const currentSource = editorSourceRef\.current[\s\S]*?const liveDom = diffCanvasLiveDom\(currentSource, nextSource\)[\s\S]*?patches: liveDom\.patches[\s\S]*?attributes: liveDom\.attributes/,
    'inline style commits must broadcast removed conflicting declarations as well as the requested property',
  );
  assert.match(
    projectEditorSource,
    /const applyLivePatch = useCallback[\s\S]*?diffCanvasLiveDom\(currentSource, nextSource\)[\s\S]*?canApplyCanvasLiveDomDelta\(currentSource, nextSource, liveDom\)[\s\S]*?changeSource\(nextSource, record, false,[\s\S]*?canvasSelectionRevisionFloorRef\.current\.set[\s\S]*?texts: liveDom\.texts/,
    'safe text and attribute edits must prove path-stable topology, guard optimistic selection state and publish View State without reloading',
  );
  assert.match(
    projectEditorSource,
    /const keepOptimisticVisibility = \(display: string, semantic = true\) => \{[\s\S]*?optimisticallySetCanvasLayerVisibility\(targets, visible\)[\s\S]*?canvasSelectionRevisionFloorRef\.current\.set[\s\S]*?attributes: semantic[\s\S]*?applyElementVisibilityAttributes[\s\S]*?computedStyle:[\s\S]*?display,[\s\S]*?updateStyle\('display', visible \? '' : 'none',[\s\S]*?visibility: \{ visible, fallbackDisplay, computedDisplay: computedVisibleDisplay \}[\s\S]*?keepOptimisticVisibility\([\s\S]*?false,/,
    'Hide/Show must keep the Layers state, Inspector snapshot and stale-snapshot floor synchronized while class-owned visibility avoids semantic attributes',
  );
  const visibilityMutationSource = projectEditorSource.slice(
    projectEditorSource.indexOf('const updateVisibility = (visible: boolean) => {'),
    projectEditorSource.indexOf('const updateClassName =', projectEditorSource.indexOf('const updateVisibility = (visible: boolean) => {')),
  );
  assert.equal(
    visibilityMutationSource.match(/clearPreviewProperties: \['display'\]/g)?.length,
    3,
    'localized and off-selection Hide/Show commits must atomically supersede any earlier display preview',
  );
  assert.match(
    visibilityMutationSource,
    /membershipPreviewLayer === 'base'[\s\S]*?resolvedActiveLocale === localization\.sourceLocale[\s\S]*?lastVisualStyleEditRef\.current = null[\s\S]*?const ruleDisplay = updateStyle\('display', visible \? '' : 'none',[\s\S]*?visibility: \{ visible, fallbackDisplay, computedDisplay: computedVisibleDisplay \}[\s\S]*?keepOptimisticVisibility\([\s\S]*?false,[\s\S]*?return;/,
    'base Hide/Show must persist through the active class rule and keep hidden/ARIA attributes out of responsive visibility edits',
  );
  assert.match(
    visibilityMutationSource,
    /commitMembershipAudienceOverride\(targets,[\s\S]*?keepOptimisticVisibility\([\s\S]*?releaseCanvasStylePreviewProperties\(\['display'\]\)/,
    'membership Hide/Show must supersede a transient display preview after committing its audience override',
  );
  assert.match(
    previewSource,
    /const queueCommittedStateReplayFrame[\s\S]*?reapplyEditorLiveState\(rootElement, true, false\)[\s\S]*?reapplyEditorLiveState\(rootElement, false, false\)[\s\S]*?if \(replayDocument \|\| canvasViewInteractionPending\)[\s\S]*?reapplyCanvasViewDocumentState\(\)/,
    'site runtimes must not overwrite committed atoms, while unrelated animation frames stay outside the replay queue',
  );
  assert.match(
    previewSource,
    /appliedEveryPatch[\s\S]*?type: 'html-editor-live-style-applied'[\s\S]*?type: 'html-editor-live-style-rejected'/,
    'the bridge must positively or negatively acknowledge every revisioned live DOM mutation',
  );
  assert.match(
    previewBridgeSource,
    /const customPropertyNames = new Set\(\)[\s\S]*?const learnCustomPropertiesFromRules = rules =>[\s\S]*?const learnCustomPropertiesFromStyleElement = style =>[\s\S]*?if \(style\.sheet\?\.cssRules\)[\s\S]*?customPropertyNames\.forEach\(name => \{[\s\S]*?if \(customPropertyCount >= 512\) return;[\s\S]*?computedStyle\[name\] = computed\.getPropertyValue\(name\)[\s\S]*?customPropertyCount \+= 1/,
    'the selection snapshot must keep a bounded incremental CSS custom-property catalog instead of freezing it at iframe load',
  );
  assert.match(
    previewBridgeSource,
    /const applyLiveStylePatchToElement[\s\S]*?const property = normalizeRuntimeStyleProperty\(patch\.property\)[\s\S]*?if \(property\.startsWith\('--'\)\) customPropertyNames\.add\(property\)[\s\S]*?type === 'html-editor-design-tokens'[\s\S]*?learnCustomPropertiesFromStyleElement\(style\)[\s\S]*?typeof event\.data\.cssPath === 'string'[\s\S]*?data-editor-source[\s\S]*?learnCustomPropertiesFromStyleElement\(style\)/,
    'design-token, inline and live-stylesheet mutations must teach new custom-property names without requiring a reload',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /addEventListener\(['"]beforeunload|returnValue\s*=\s*['"]['"]/,
    'autosave must never block navigation with a native browser unload confirmation',
  );
  assert.match(
    settingsSource,
    /if \(readOnly\) return;[\s\S]*?const beforeSettingsUnload[\s\S]*?const pending = activeSavePromiseRef\.current \|\| saveQueueRef\.current\.length[\s\S]*?if \(!pending\) return;[\s\S]*?event\.preventDefault\(\)[\s\S]*?removeEventListener\('beforeunload', beforeSettingsUnload\)/,
    'Settings must warn about unsaved work only and remove the unload listener on teardown',
  );
  assert.match(
    infiniteCanvasSource,
    /const postActiveViewScale = useCallback[\s\S]*?type: 'html-editor-canvas-view-scale'[\s\S]*?generation: documentKey[\s\S]*?useLayoutEffect\(\(\) => \{\s*postActiveViewScale\(\);\s*\}, \[postActiveViewScale, view\.zoom\]\)/,
    'the infinite canvas must send every effective zoom to its editable iframe for constant-size direct controls',
  );
  assert.match(
    infiniteCanvasSource,
    /const markActiveDocumentReady = \(\) => \{[\s\S]*?activeIframePostedScaleRef\.current = null;[\s\S]*?postActiveViewScale\(true\);[\s\S]*?onActiveFrameLoad\(\)[\s\S]*?onLoad=\{markActiveDocumentReady\}[\s\S]*?onPromote=\{markActiveDocumentReady\}/,
    'a newly loaded or atomically promoted infinite-canvas iframe must receive its current control scale before normal editor replay',
  );
  assert.match(
    topbarSource,
    /<DropdownMenuLabel[^>]*>\s*Editar\s*<\/DropdownMenuLabel>[\s\S]*?onClick=\{undo\}[\s\S]*?Desfazer[\s\S]*?onClick=\{redo\}[\s\S]*?Refazer/,
    'Undo and Redo must be available from the project menu',
  );
  assert.doesNotMatch(
    topbarAndProjectSource,
    /<div className="hidden items-center lg:flex">[\s\S]*?title="Desfazer"[\s\S]*?title="Refazer"/,
    'Undo and Redo must not remain as topbar corner controls',
  );
  const undoHandlerStart = projectEditorSource.indexOf('const undo = useCallback(() => {');
  const redoHandlerStart = projectEditorSource.indexOf('const redo = useCallback(() => {', undoHandlerStart);
  const editorCommandHandlerStart = projectEditorSource.indexOf('editorCommandRef.current = (command) => {', redoHandlerStart);
  assert.ok(
    undoHandlerStart >= 0 && redoHandlerStart > undoHandlerStart && editorCommandHandlerStart > redoHandlerStart,
    'Undo and Redo must keep explicit project restoration boundaries',
  );
  const undoHandlerSource = projectEditorSource.slice(undoHandlerStart, redoHandlerStart);
  const redoHandlerSource = projectEditorSource.slice(redoHandlerStart, editorCommandHandlerStart);
  for (const [label, handlerSource] of [
    ['Undo', undoHandlerSource],
    ['Redo', redoHandlerSource],
  ]) {
    assert.match(
      handlerSource,
      /const structureMutationPosted = liveProjection[\s\S]*?synchronizeLiveStructure\(liveProjection\.source, liveProjection\.message, liveProjection\.remapPath\)[\s\S]*?: false;[\s\S]*?const visualProjection = !liveProjection && currentProject[\s\S]*?prepareLiveVisualHistoryProjection\(currentProject, snapshot\)[\s\S]*?: null;[\s\S]*?const canvasProjected = structureMutationPosted \|\| Boolean\(visualProjection\);/,
      `${label} must distinguish a posted structural mutation from a visual projection`,
    );
    assert.match(
      handlerSource,
      /historyIndexRef\.current = index;[\s\S]*?setHistoryIndex\(index\);[\s\S]*?projectRevisionRef\.current \+= 1;[\s\S]*?if \(!canvasProjected\) resetCanvasViewStateRef\.current\(projectRevisionRef\.current\);[\s\S]*?projectRef\.current = snapshot;[\s\S]*?canvasProjectRef\.current = snapshot;[\s\S]*?canvasProjectRevisionRef\.current = projectRevisionRef\.current;/,
      `${label} must restore one snapshot under one canonical revision`,
    );
    assert.match(
      handlerSource,
      /if \(liveProjection\) \{[\s\S]*?editorSourceRef\.current = liveProjection\.source;[\s\S]*?\} else if \(visualProjection\) \{[\s\S]*?editorSourceRef\.current = visualProjection\.source;[\s\S]*?if \(visualProjection\.message\) \{[\s\S]*?enqueueCanvasLiveStyle\(visualProjection\.message\);/,
      `${label} must project the restored source and enqueue its visual delta`,
    );
    assert.match(
      handlerSource,
      /setProject\(snapshot\);[\s\S]*?if \(liveProjection\) \{[\s\S]*?if \(!structureMutationPosted\) setCanvasProject\(snapshot\);[\s\S]*?\} else if \(visualProjection\) \{[\s\S]*?pendingSelectionPathRef\.current = null;[\s\S]*?\} else \{[\s\S]*?setCanvasProject\(snapshot\);[\s\S]*?selectedPathsRef\.current = \[\];[\s\S]*?setSelection\(null\);[\s\S]*?setSelectedPaths\(\[\]\);/,
      `${label} must preserve projected selection and reset it only for a canonical fallback`,
    );
    assert.match(
      handlerSource,
      /if \(structureMutationPosted\) scheduleCanvasStructureRecovery\(\);[\s\S]*?else if \(!canvasProjected\) forceCanonicalCanvasRefresh\(\);/,
      `${label} must wait for structural ACK recovery and rebuild unsupported changes immediately`,
    );
    assert.doesNotMatch(
      handlerSource,
      /canvasSynchronized/,
      `${label} must not treat a posted canvas mutation as an acknowledgement`,
    );
  }
  assert.match(
    projectEditorSource,
    /const prepareLiveVisualHistoryProjection[\s\S]*?canApplyCanvasLiveDomDelta\(beforeSource, afterSource, liveDom\)[\s\S]*?resolvePreviewStylesheet\(to, cssPath, afterCss\)[\s\S]*?canvasViewStateRef\.current\.lastDelta\?\.ownerships[\s\S]*?message\.ownerships = ownerships/,
    'visual history must validate DOM topology, restore complete stylesheets and preserve motion-property ownership',
  );
  assert.match(
    motionTimelineSource,
    /useState<'fit' \| 'manual'>\('fit'\)[\s\S]*?fitTimelineZoom\(duration, timelineViewportWidth\)/,
    'the interaction timeline must open in Fit mode based on its measured viewport',
  );
  assert.match(
    motionTimelineSource,
    /timelineViewportRef[\s\S]*?new ResizeObserver\(measure\)[\s\S]*?observer\.observe\(viewport\)/,
    'the interaction timeline Fit must respond to viewport resizes',
  );
  assert.match(
    projectEditorSource,
    /const changeInteractionSource = useCallback[\s\S]*?dependencyChanged[\s\S]*?changeSource\(nextSource, record, dependencyChanged\)[\s\S]*?if \(!dependencyChanged\) \{[\s\S]*?enqueueCanvasLiveStyle\(\{[\s\S]*?interactionDocument/,
    'ordinary interaction edits must use Canvas View State while dependency changes rebuild srcDoc',
  );
  assert.match(
    projectEditorSource,
    /<HtmlMotionTimeline[\s\S]*?onSourceChange=\{changeInteractionSource\}[\s\S]*?<HtmlInspector[\s\S]*?onInteractionSourceChange=\{changeInteractionSource\}/,
    'both the Timeline and Interactions inspector must share the reload-free interaction mutation path',
  );
  assert.match(
    previewBridgeSource,
    /event\.data\.interactionDocument !== undefined[\s\S]*?__kodetyInteractions\?\.update\?\.\(interactionDocument\)[\s\S]*?html-editor-live-style-applied/,
    'the iframe must rebuild its paused interaction controllers before ACKing the live source revision',
  );
  assert.match(
    projectEditorSource,
    /pinnedInteractionPreviewRef[\s\S]*?action: 'seek' \| 'play' \| 'reverse'[\s\S]*?startedAt: number[\s\S]*?action: 'seek'[\s\S]*?action === 'play' \|\| action === 'restart'[\s\S]*?startedAt: performance\.now\(\)[\s\S]*?const replayPinnedInteractionPreview[\s\S]*?const replayTime[\s\S]*?action: pinned\.action[\s\S]*?time: replayTime/,
    'the editor must retain paused and live Timeline state and resume it at the elapsed frame after a disposable canvas handoff',
  );
  assert.match(
    projectEditorSource,
    /timelineControlSequenceRef[\s\S]*?pendingTimelineControlRef[\s\S]*?const ensureTimelineControlRetry[\s\S]*?postCanvasMessage\(pending\.message\)[\s\S]*?__kodetyTimelineSequence: timelineSequence[\s\S]*?Every newest UI sample crosses immediately[\s\S]*?sendTimelineCanvasMessage\(message\)[\s\S]*?message\.type === 'html-editor-interaction-control-applied'/,
    'Timeline transport must send the newest command immediately while retaining bounded ACK retry',
  );
  assert.match(
    previewBridgeSource,
    /latestObservedTimelineControlSequence[\s\S]*?queuedInteractionSeek[\s\S]*?queueInteractionSeek[\s\S]*?requestAnimationFrame\(flushQueuedInteractionSeek\)[\s\S]*?timelineSequence < latestObservedTimelineControlSequence[\s\S]*?clearQueuedInteractionSeek\(true\)/,
    'the canvas must reject stale cross-channel commands and coalesce Seek on its native paint clock',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-canvas-ready'[\s\S]*?postCanvasViewStateToFrame\(sourceFrame\)[\s\S]*?replayPinnedInteractionPreview\(\)/,
    'a pinned Timeline frame must replay after a canonical canvas rebuild hydrates the latest View State',
  );
  assert.match(
    previewBridgeSource,
    /canvasViewInteractionDocument[\s\S]*?__kodetyInteractions\?\.update\?\.\(interactionDocument\)[\s\S]*?replayPinnedInteractionPreview\(\)/,
    'a live interaction-document projection must preserve and replay the pinned Timeline frame inside the iframe',
  );
  assert.match(
    previewBridgeSource,
    /if \(normalized\.hasInteractionDocument\) \{[\s\S]*?queueCanvasViewInteraction\([\s\S]*?normalized\.interactionDocument[\s\S]*?\} else if \(epochChanged\) \{[\s\S]*?canvasViewInteractionDocument = undefined[\s\S]*?canvasViewHasInteractionSnapshot = false[\s\S]*?canvasViewInteractionPending = false/,
    'an initial View State without an interaction override must preserve the canonical iframe controllers instead of replacing them with an empty document',
  );
  assert.doesNotMatch(
    previewBridgeSource,
    /queueCanvasViewInteraction\(\s*normalized\.hasInteractionDocument\s*\?\s*normalized\.interactionDocument\s*:\s*undefined/,
    'absence of an interaction override must never enter the empty-document update path',
  );
  assert.match(
    projectEditorAndCanvasStageSource,
    /onPassiveFrameLoad=\{\(frame, id\) => \{[\s\S]*?postCanvasViewStateToFrame\(frame\.contentWindow\)[\s\S]*?id === viewportRef\.current\) replayPinnedInteractionPreview\(\)/,
    'promoting an already-loaded infinite-canvas frame must replay the pinned Timeline seek without waiting for another canvas-ready event',
  );
  assert.match(
    previewBridgeSource,
    /let pinnedInteractionPreview = null[\s\S]*?const interactionControlIds[\s\S]*?const acknowledgeInteractionControl[\s\S]*?html-editor-interaction-control-applied[\s\S]*?const applyInteractionControl[\s\S]*?__kodetyInteractions\?\.control\?\.\([\s\S]*?const scheduleInteractionControlRetry[\s\S]*?acknowledgeInteractionControl\(pendingInteractionControl\.payload\)[\s\S]*?const replayPinnedInteractionPreview[\s\S]*?__kodetyInteractions\?\.update\?\.\(interactionDocument\)[\s\S]*?replayPinnedInteractionPreview\(\)[\s\S]*?action === 'release'/,
    'the iframe bridge must apply, acknowledge and retry single/group controls while a runtime is being replaced',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const releasePreview = \(\) => \{[\s\S]*?previewKey = individualPreviewKey\(interaction\.id\)[\s\S]*?__KODETY_ACTIVE_INTERACTION_PREVIEW__ !== previewKey[\s\S]*?return false;[\s\S]*?return teardownActiveFrozenPreview\([\s\S]*?previewKey,[\s\S]*?reset: releasePreview,[\s\S]*?release: releasePreview/,
    'reset and Timeline close/selection release must restore only the frozen Design preview session they own',
  );
  assert.match(
    interactionRuntimeContractSource,
    /teardownActiveFrozenPreview = expectedKey => \{[\s\S]*?activeKey !== expectedKey[\s\S]*?restorePreviewSession\(activeKey\)[\s\S]*?restoreSplitText\(\)[\s\S]*?__KODETY_END_EDITOR_INTERACTION_PREVIEW__/,
    'ending a frozen preview must restore its current session and temporary text split only after ownership validation',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const previewTimelineDuration = timeline => \{[\s\S]*?timeline\.totalDuration\(\)[\s\S]*?timeline\.duration\(\)[\s\S]*?const targetTime = Math\.min\([\s\S]*?const currentTime = Number\(timeline\.totalTime\(\)\) \|\| 0;[\s\S]*?__kodetyTraversalBackward = targetTime < currentTime[\s\S]*?timeline\.totalTime\(targetTime, false\)[\s\S]*?runFrozenPreview\(instances\[0\]\?\.totalTime\?\.\(\) \|\| 0, 'play'\)/,
    'the frozen runtime must scrub total timeline time with explicit traversal direction, including finite repeats, while bounding infinite repeats to one editable cycle',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const initialStates = \[\][\s\S]*?initialStates\.push\(\{ elements, values: initialValues \}\)[\s\S]*?motionEngine\.set\(elements, initialValues\)[\s\S]*?timeline\.__kodetyInitialStates = initialStates[\s\S]*?const seedPreviewStates = \(\) => \{[\s\S]*?\(timeline\.__kodetyInitialStates \|\| \[\]\)\.forEach[\s\S]*?motionEngine\.set\(state\.elements, state\.values\)[\s\S]*?__KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__[\s\S]*?seedPreviewStates\(\)/,
    'delayed animation clips must use fill-both semantics and restore their first authored state after Design releases its static canvas style',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const groupedControllersFor[\s\S]*?const activateGroupedPreview[\s\S]*?__prepareFrozenPreview\(\)[\s\S]*?__KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__\?\.\(targets\)[\s\S]*?__buildFrozenPreview\([\s\S]*?__seedPreviewStates\(\)[\s\S]*?const runGroupedFrozenPreview[\s\S]*?renderGroupedPreviewTime\([\s\S]*?groupedPreviewFrame = editorRequestFrame\(tick\)[\s\S]*?control: controlGroupedPreview/,
    'a grouped Timeline preview must lazily build one union-target session and render every Motion controller from one private frame clock',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const scheduleSetupRetry = setup =>[\s\S]*?typeof motionEngine\.timeline !== 'function'[\s\S]*?scheduleSetupRetry\(setup\)[\s\S]*?return false/,
    'the interaction runtime must retry controller setup when Motion is not ready yet',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const motionEngine = window\.__ONUN_MOTION_ENGINE__;[\s\S]*?const MotionScroll = motionEngine\?\.scroll;/,
    'native interactions must prefer private engines without replacing authored animation globals',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const snapshots = names\.map[\s\S]*?window\.\$\{privateGlobalName\} = window\.\$\{globalName\};[\s\S]*?Object\.defineProperty\(window, snapshot\.name, snapshot\.descriptor\)[\s\S]*?delete window\[snapshot\.name\]/,
    'bundled animation dependencies must restore every authored global after capturing the private runtime',
  );
  assert.match(
    interactionRuntimeContractSource,
    /interactions\.filter[\s\S]*?forEach\(interaction => \{\s*try \{[\s\S]*?Failed to register interaction[\s\S]*?interaction\.id/,
    'one malformed interaction must not prevent the remaining controllers from registering',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const controlGroupedPreview[\s\S]*?action === 'release' \|\| action === 'reset'[\s\S]*?releaseGroupedPreview\(entries\)[\s\S]*?action === 'seek' \|\| action === 'pause'[\s\S]*?renderGroupedPreviewTime\(entries,[\s\S]*?action === 'restart'[\s\S]*?runGroupedFrozenPreview\(entries, 0, 'restart'\)[\s\S]*?action === 'play'[\s\S]*?runGroupedFrozenPreview\(entries, currentTime, 'play'\)/,
    'group seek, pause, restart, play and release must address the same aggregate controller set',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const scaleRatio = value => \{[\s\S]*?normalized\.endsWith\('%'\)[\s\S]*?percent \/ 100[\s\S]*?const motionValues = rawValues => \{[\s\S]*?hasOwn\('scale'\)[\s\S]*?delete values\.scale[\s\S]*?values\.scaleX = uniformScale[\s\S]*?values\.scaleY = uniformScale/,
    'uniform Scale must convert percentages to ratios and drive both transform axes equally',
  );
  assert.match(
    interactionRuntimeContractSource,
    /currentMarker === snapshot\.mode[\s\S]*?currentNodes\.length === snapshot\.ownedNodes\.length[\s\S]*?node === snapshot\.ownedNodes\[index\][\s\S]*?if \(ownsGeneratedTree\) element\.innerHTML = snapshot\.html/,
    'text cleanup must restore old HTML only while the runtime still owns the exact generated split tree',
  );
  assert.match(
    interactionRuntimeContractSource,
    /if \(activeMode !== mode\) \{[\s\S]*?Conflicting text split modes[\s\S]*?return \[element\]/,
    'conflicting text-split granularities must never silently reuse targets created for another mode',
  );
  assert.match(
    interactionRuntimeContractSource,
    /!editorFrozen[\s\S]{0,120}?&& matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/,
    'the operating-system reduced-motion preference must not move a frozen Design timeline during setup',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const groupedPreviewKey = entries => \([\s\S]*?JSON\.stringify\(entries\.map\(entry => entry\.id\)\.sort\(\)\)/,
    'group preview ownership keys must be collision-safe and independent of interaction ordering',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const initialValues = motionValues\(frames\[0\]\.values\)[\s\S]*?\.\.\.motionValues\(frame\.values\)[\s\S]*?const initialValues = motionValues\(action\.from\)[\s\S]*?\.\.\.motionValues\(action\.to\)[\s\S]*?action\.kind === 'set'\) timeline\.set\(elements, motionValues\(action\.to\)/,
    'timeline keyframes, from/to actions and set actions must share the aspect-safe scale normalization',
  );
  assert.match(
    interactionRuntimeContractSource,
    /previewKey = individualPreviewKey\(interaction\.id\)[\s\S]*?__KODETY_ACTIVE_INTERACTION_PREVIEW__ === previewKey[\s\S]*?__KODETY_ACTIVE_INTERACTION_PREVIEW__ = previewKey[\s\S]*?releasePreview[\s\S]*?__KODETY_ACTIVE_INTERACTION_PREVIEW__ = ''/,
    'scrubbing one interaction must retain a stable preview session instead of restoring authored styles before every playhead update',
  );
  assert.doesNotMatch(
    interactionRuntimeContractSource,
    /total\s*<=\s*3600/,
    'finite interaction durations must never be truncated by the old arbitrary one-hour cutoff',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const runtimeRepeat = value => \{[\s\S]*?editorFrozen && repeat === -1 \? 0 : repeat[\s\S]*?repeat: runtimeRepeat\(interaction\.repeat\)[\s\S]*?repeat = runtimeRepeat\(action\.repeat\)/,
    'the frozen canvas must render one editable cycle for infinite action or interaction repeats while publication keeps repeat -1',
  );
  assert.match(
    interactionRuntimeContractSource,
    /const publishPreviewDuration = \(\) => \{[\s\S]*?__KODETY_POST_EDITOR_MESSAGE__\?\.\(\{[\s\S]*?html-editor-interaction-duration[\s\S]*?signature: JSON\.stringify\(interaction\)[\s\S]*?duration: previewDuration\(\)[\s\S]*?publishPreviewDuration\(\)/,
    'the Motion runtime must report its measured duration so stagger and multiple live targets extend the visible playhead',
  );
  assert.match(
    previewBridgeSource,
    /const postEditorMessage = message => parent\.postMessage\(\{ \.\.\.message, generation: editorGeneration \}[\s\S]*?window\.__KODETY_POST_EDITOR_MESSAGE__ = postEditorMessage/,
    'interaction runtime telemetry must use the bridge generation instead of posting an unscoped window message',
  );
  assert.match(
    motionTimelineSource,
    /previewRuntimeDurationKeys[\s\S]*?measuredRuntimeDuration = Math\.max[\s\S]*?Math\.max\(authoredDuration, measuredRuntimeDuration\)[\s\S]*?html-editor-interaction-duration[\s\S]*?expectedDurationKeys\.has\(key\)[\s\S]*?postInteractionControl\([\s\S]*?previewInteractionIds,[\s\S]*?'seek',[\s\S]*?playheadRef\.current/,
    'the grouped timeline must consume every runtime duration and prewarm the frozen preview at the visible playhead',
  );
  assert.match(
    motionTimelineSource,
    /playbackDurationRef\.current = duration[\s\S]*?const liveDuration = playbackDurationRef\.current[\s\S]*?const frameTime = Math\.min\(liveDuration, time\)[\s\S]*?setPlayhead\(frameTime\)[\s\S]*?time >= liveDuration/,
    'an in-flight playhead must adopt a newly measured live-target duration instead of stopping on a stale closure',
  );
  assert.match(
    motionTimelineSource,
    /const stopPlayback = \(\) => \{[\s\S]*?playbackInteractionIdsRef\.current[\s\S]*?control\('seek', playheadRef\.current, playbackInteractionIds\)[\s\S]*?const closeTimeline[\s\S]*?releaseInteractionPreview/,
    'pausing must pin the displayed playhead for the complete playback group while closing the Timeline explicitly releases it',
  );
  assert.match(
    motionTimelineSource,
    /timelinePreviewInteractionIds\([\s\S]*?visibleInteractions\.map\(interaction => interaction\.id\)[\s\S]*?const postInteractionControl[\s\S]*?normalizedIds\.length > 1[\s\S]*?\{ interactionIds: normalizedIds \}[\s\S]*?const beginPlayback[\s\S]*?const interactionIds = Array\.from\(previewInteractionIds\)[\s\S]*?postInteractionControl\(interactionIds, 'play', next\)/,
    'Play in a section or element group must start every visible interaction ID atomically instead of only the selected lane',
  );
  assert.match(
    motionTimelineSource,
    /handleSpacePlay[\s\S]*?event\.code !== 'Space'[\s\S]*?beginPlayback\(0\)/,
    'Space must restart Timeline playback from second zero',
  );
  assert.match(
    motionTimelineSource,
    /value=\{zoomDraft\}[\s\S]*?onChange=\{event => setZoomDraft\(event\.target\.value\)\}[\s\S]*?onBlur=\{commitZoomDraft\}/,
    'timeline zoom typing must remain a draft until Enter or blur commits it',
  );
  assert.doesNotMatch(
    motionTimelineSource,
    /onChange=\{event => setZoom\(Math\.max\(/,
    'timeline zoom must not clamp and overwrite the value after every keystroke',
  );
  assert.match(
    motionTimelineSource,
    /const skipZoomCommitRef = useRef\(false\)[\s\S]*?if \(skipZoomCommitRef\.current\) \{[\s\S]*?setZoomDraft\(formatTimelineZoom\(zoom\)\)[\s\S]*?skipZoomCommitRef\.current = true;[\s\S]*?event\.currentTarget\.blur\(\)/,
    'Escape must cancel the timeline zoom draft without committing the stale typed value on blur',
  );
  assert.match(
    motionTimelineSource,
    /<main className="relative flex min-w-0 flex-1 flex-col bg-\[var\(--kodety-panel\)\]">[\s\S]*?<header className="relative flex h-10 shrink-0 items-center[\s\S]*?className="min-w-0 shrink-0" style=\{\{ width: TIMELINE_LABEL_COLUMN_WIDTH - 20 \}\}[\s\S]*?data-timeline-toolbar-actions[\s\S]*?className="ml-auto flex shrink-0[\s\S]*?data-timeline-viewport[\s\S]*?min-h-0 flex-1 overflow-auto[\s\S]*?className="sticky left-0 z-20 shrink-0[\s\S]*?pt-\[26px\]"[\s\S]*?style=\{\{ width: TIMELINE_LABEL_COLUMN_WIDTH \}\}/,
    'the compact interaction timeline header and label lanes must retain non-overlapping flexible regions',
  );
  assert.match(
    motionTimelineSource,
    /id="interaction-action-catalog"[\s\S]*?className="flex h-full w-\[304px\][\s\S]*?min-h-0 flex-1 overflow-y-auto/,
    'the interaction action catalog must occupy the right sidebar and scroll within the available timeline height',
  );
  assert.match(
    motionTimelineSource,
    /data-timeline-action-search[\s\S]*?h-8 min-w-0 flex-1[\s\S]*?data-action-picker-navigation[\s\S]*?role="tablist" aria-label="Tipo de animação"[\s\S]*?h-6 min-w-0[\s\S]*?Predefinições[\s\S]*?Ações[\s\S]*?Filtrar predefinições por categoria[\s\S]*?presetGroups\.map[\s\S]*?preset\.ease[\s\S]*?preset\.duration\.toFixed\(2\)[\s\S]*?catalog\.map/,
    'the animation picker must use a compact command surface, neutral local tabs and one low-emphasis category filter while retaining timing metadata',
  );
  assert.doesNotMatch(
    motionTimelineSource.slice(
      motionTimelineSource.indexOf('function ActionPicker'),
      motionTimelineSource.indexOf('function PropertyValue'),
    ),
    /grid-cols-5|<Play className="size-3\.5 stroke-\[1\.5\]"/,
    'the animation picker must not restore the dominant five-category strip or imply that adding a preset only previews it',
  );
  const createAnimationCtaIndex = motionTimelineSource.indexOf('data-create-animation-from-scratch');
  const animationCatalogScrollIndex = motionTimelineSource.indexOf(
    'kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto',
    motionTimelineSource.indexOf('id="interaction-action-catalog"'),
  );
  assert.ok(
    animationCatalogScrollIndex >= 0 && createAnimationCtaIndex > animationCatalogScrollIndex,
    'the generic animation action must live inside the scrollable Actions segment instead of duplicating a fixed CTA',
  );
  assert.equal(
    motionTimelineSource.match(/data-create-animation-from-scratch=/g)?.length,
    1,
    'the animation picker must expose exactly one generic animation entry',
  );
  assert.match(
    motionTimelineSource,
    /data-create-animation-from-scratch=\{kind === 'animate' \|\| undefined\}[\s\S]*?onClick=\{\(\) => onAdd\(\{ \.\.\.createInteractionAction\(kind\), name: label \}\)\}/,
    'the single Animar row must create the editable generic action while preserving its localized catalog name',
  );
  assert.match(
    motionTimelineSource,
    /if \([\s\S]*?!activeInteraction[\s\S]*?\|\| activeInteraction\.actions\.length[\s\S]*?\|\| showInteractionGroups[\s\S]*?\) return;[\s\S]*?setSelectedActionId\(null\);[\s\S]*?setPickerOpen\(true\);[\s\S]*?\[activeInteraction\?\.id, showInteractionGroups\]/,
    'an interaction with no actions must reveal the animation catalog immediately without reopening it after a manual close',
  );
  assert.doesNotMatch(
    motionTimelineSource,
    /relative mx-auto mb-1\.5 block h-8 w-10[\s\S]*?group-hover:translate-x-1/,
    'the initial animation picker must not use decorative fake-preview cards',
  );
  assert.match(
    motionTimelineSource,
    /data-animation-properties-panel[^>]*bg-\[var\(--kodety-panel\)\][\s\S]*?Fechar propriedades[\s\S]*?grid-cols-\[minmax\(72px,\.9fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)_22px\]/,
    'the animation property sidebar must use the shared dark panel, expose its own close affordance and reserve usable columns for From and To values',
  );
  assert.match(
    motionTimelineSource,
    /data-animation-timing[\s\S]*?grid grid-cols-2 gap-2[\s\S]*?Duração<DecimalInput[\s\S]*?Início<DecimalInput[\s\S]*?data-animation-sequence[\s\S]*?grid grid-cols-2 gap-2[\s\S]*?Origem[\s\S]*?<VisualSelectControl[\s\S]*?Dividir texto[\s\S]*?<VisualSelectControl/,
    'timing and sequence controls must share equal columns, full assigned width, height and radius',
  );
  assert.match(
    motionTimelineSource,
    /function decimalDraftValue[\s\S]*?function DecimalInput[\s\S]*?editingRef[\s\S]*?const updateDraft[\s\S]*?setDraft\(next\)[\s\S]*?<VisualMeasurementControl[\s\S]*?value=\{draft\}[\s\S]*?onChange=\{updateDraft\}/,
    'animation numeric fields must preserve an editable decimal draft instead of rewriting partial values after every keystroke',
  );
  const decimalInputSource = motionTimelineSource.slice(
    motionTimelineSource.indexOf('function DecimalInput'),
    motionTimelineSource.indexOf('function ActionPicker'),
  );
  assert.match(
    decimalInputSource,
    /const updateDraft[\s\S]*?setDraft\(next\);[\s\S]*?commit\(next\)[\s\S]*?onBlurCapture[\s\S]*?commit\(draft, true\)/,
    'animation numeric fields must keep the established immediate update semantics while still normalizing the final draft on blur',
  );
  assert.match(
    motionTimelineSource,
    /allowPercent[\s\S]*?endsWith\('%'\)[\s\S]*?definition\.type === 'number'[\s\S]*?<DecimalInput[\s\S]*?allowPercent/,
    'numeric animation properties must accept percentages as well as unrestricted decimal values',
  );
  assert.match(
    motionTimelineSource,
    /Duração<DecimalInput[\s\S]*?unit="s"[\s\S]*?Início<DecimalInput[\s\S]*?unit="s"/,
    'duration and start units must live inside one input control without a separately bordered suffix',
  );
  assert.doesNotMatch(
    motionTimelineSource,
    /rounded-r-none[\s\S]{0,240}?border-l-0[\s\S]{0,120}?>s</,
    'time fields must not render the seconds suffix as a detached bordered control',
  );
  assert.match(
    motionTimelineSource,
    /selectionInteraction[\s\S]*?interactionMatchesSelection\(interaction, selection, source\)[\s\S]*?const selectionCandidates[\s\S]*?const activeStillValid[\s\S]*?releaseInteractionPreview\(\)[\s\S]*?if \(!interactionId\) \{[\s\S]*?setActiveInteractionId\(''\)[\s\S]*?if \(interactionId === activeInteractionIdRef\.current\) return;[\s\S]*?setActiveInteractionId\(interactionId\)/,
    'an open timeline must follow the selected element and release its pinned preview when that element no longer owns an interaction',
  );
  assert.match(
    motionTimelineSource,
    /interactionsInSelectionSubtree[\s\S]*?selectionScopeAvailable[\s\S]*?visibleInteractions\.map\(interaction =>[\s\S]*?focusTimelineInteraction\(interaction\.id\)[\s\S]*?selectTimelineAction\(interaction\.id, action\.id\)/,
    'selecting a section must render its descendant interactions as editable timeline groups',
  );
  assert.match(
    motionTimelineSource,
    /interactionTimelineForSelection\(\s*interaction,\s*selection,\s*source,\s*\)[\s\S]*?selection\?\.hasElementChildren && selectionScopedInteractions\.length[\s\S]*?timelineScope === 'element'[\s\S]*?\? selectionItemInteractions/,
    'selecting an individual descendant must leave container grouping and render only that layer’s matching actions',
  );
  assert.match(
    motionTimelineSource,
    /const canonicalActiveInteraction =\s*document\.interactions\.find[\s\S]*?const activeInteraction = timelineScope === 'interaction'[\s\S]*?canonicalActiveInteraction \|\| \(!selection \? document\.interactions\[0\] \|\| null : null\)/,
    'selecting an element without motion must not silently keep another element’s timeline active',
  );
  assert.doesNotMatch(
    motionTimelineSource,
    /const duration = activeInteraction \? Math\.max\(2, interactionDuration\(activeInteraction\)\)/,
    'the visible playhead must not run to an artificial two-second minimum after the canvas animation already completed',
  );
  assert.match(
    motionTimelineSource,
    /closeTopLayer[\s\S]*?if \(pickerOpen\)[\s\S]*?if \(selectedActionId\)[\s\S]*?closeTimeline\(\)/,
    'Escape must progressively close the catalog, property sidebar and timeline',
  );
  assert.match(
    motionTimelineSource,
    /aria-label=\{pickerOpen \? 'Fechar catálogo de ações' : 'Abrir catálogo de ações'\}[\s\S]*?aria-controls="interaction-action-catalog"/,
    'the timeline header must expose the single persistent action-catalog trigger',
  );
  assert.match(
    motionTimelineSource,
    /data-timeline-toolbar-actions[\s\S]*?aria-label="Ajustar timeline"[\s\S]*?<Maximize2[\s\S]*?data-timeline-zoom-control[\s\S]*?aria-label="Diminuir zoom da timeline"[\s\S]*?<Minus[\s\S]*?<span className="sr-only">Zoom da timeline<\/span>[\s\S]*?aria-label="Zoom da timeline"[\s\S]*?aria-label="Aumentar zoom da timeline"[\s\S]*?<Plus[\s\S]*?aria-label=\{pickerOpen \? 'Fechar catálogo de ações' : 'Abrir catálogo de ações'\}[\s\S]*?<Plus[\s\S]*?aria-label="Fechar timeline"[\s\S]*?<X/,
    'the toolbar must separate Fit from the compound decrease/value/increase zoom surface and preserve accessible labels',
  );
  assert.match(
    motionTimelineSource,
    /const startPlayheadDrag[\s\S]*?stopPlayback\(\)[\s\S]*?setPointerCapture\(pointerId\)[\s\S]*?pendingSeekTime[\s\S]*?requestAnimationFrame\(flushPendingSeek\)[\s\S]*?releasePointerCapture\(pointerId\)[\s\S]*?updateFromClientX\(upEvent\.clientX, true\)[\s\S]*?data-timeline-playhead[\s\S]*?role="slider"[\s\S]*?onPointerDown=\{startPlayheadDrag\}/,
    'the blue playhead must capture the pointer, coalesce only superseded moves and flush the exact final scrub frame',
  );
  assert.match(
    motionTimelineSource,
    /postInteractionControl\(interactionIds, 'play', next\)[\s\S]*?const tick[\s\S]*?setPlayhead\(frameTime\)[\s\S]*?time >= liveDuration[\s\S]*?postInteractionControl\(interactionIds, 'pause', liveDuration\)/,
    'Play must run on the canvas native clock while the outer Timeline tracks and pins the exact final frame',
  );
  const timelinePlaybackTickSource = motionTimelineSource.slice(
    motionTimelineSource.indexOf('const tick = (now: number) => {', motionTimelineSource.indexOf('const beginPlayback')),
    motionTimelineSource.indexOf(
      'animationFrame.current = requestAnimationFrame(tick);',
      motionTimelineSource.indexOf('const tick = (now: number) => {', motionTimelineSource.indexOf('const beginPlayback')),
    ),
  );
  assert.doesNotMatch(
    timelinePlaybackTickSource,
    /postInteractionControl\([^\n]+, 'seek'/,
    'Play must not flood the iframe with one Seek command per UI frame',
  );
  assert.match(
    motionTimelineSource,
    /previewScopeHasHiddenActions \? 'cursor-not-allowed' : 'cursor-ew-resize'[\s\S]*?onPointerDown=\{startPlayheadDrag\}[\s\S]*?data-timeline-playhead/,
    'clicking or dragging the ruler must remain a fallback for moving the playhead',
  );
  assert.match(
    motionTimelineSource,
    /TIMELINE_ACTION_DRAG_THRESHOLD_PX = 4[\s\S]*?const startDrag = \([\s\S]*?event\.stopPropagation\(\)[\s\S]*?let activated = false[\s\S]*?Math\.hypot\([\s\S]*?< TIMELINE_ACTION_DRAG_THRESHOLD_PX[\s\S]*?activated = true[\s\S]*?setDragPreview/,
    'an interaction card must stay a click until the pressed pointer crosses the drag threshold',
  );
  assert.match(
    motionTimelineSource,
    /data-timeline-action-clip[\s\S]*?selected \? 'border-transparent bg-\[color-mix\(in_srgb,var\(--kodety-accent\)_72%,#4338ca\)\] text-white[\s\S]*?data-timeline-resize-handle="start"[\s\S]*?inset-y-0 left-0[\s\S]*?left-1\.5[\s\S]*?h-3\.5 w-\[3px\][\s\S]*?bg-white opacity-100[\s\S]*?data-timeline-resize-handle="end"[\s\S]*?inset-y-0 right-0[\s\S]*?right-1\.5[\s\S]*?h-3\.5 w-\[3px\][\s\S]*?bg-white opacity-100/,
    'the selected timeline clip must use an inset white resize tab at each edge of its flat purple surface',
  );
  const selectedTimelineClipSource = motionTimelineSource.slice(
    motionTimelineSource.indexOf('data-timeline-action-clip'),
    motionTimelineSource.indexOf('</button>', motionTimelineSource.indexOf('data-timeline-action-clip')),
  );
  assert.doesNotMatch(
    selectedTimelineClipSource,
    /shadow-|box-shadow/,
    'timeline clips and resize handles must not add decorative shadows when color contrast already defines the control',
  );
  assert.doesNotMatch(
    motionTimelineSource.match(/const startDrag = \([\s\S]*?\n  \};\n  const selectKeyframe/)?.[0] || '',
    /event\.preventDefault\(\);\s*event\.stopPropagation\(\)/,
    'pointerdown on an interaction card must not prevent its native click',
  );
  assert.match(
    motionTimelineSource,
    /const clickTimelineAction = \([\s\S]*?suppressedActionClickRef\.current = null[\s\S]*?Date\.now\(\) - suppressed\.at < 600[\s\S]*?selectTimelineAction\(interactionId, actionId\)[\s\S]*?onClick=\{event => clickTimelineAction\(event, interaction\.id, action\.id\)\}/,
    'a real drag must suppress only its synthetic trailing click while a simple card click opens the action',
  );
  assert.match(
    motionTimelineSource,
    /\{pickerOpen\s*\?\s*<ActionPicker[\s\S]*?: selectedAction\s*\?\s*<ActionInspector/,
    'opening the action catalog must replace the inspector in the right sidebar',
  );
  assert.doesNotMatch(
    motionTimelineSource,
    /Adicionar primeira ação|\{pickerOpen && <ActionPicker|<Button[\s\S]{0,180}Adicionar ação/,
    'the timeline must not duplicate add-action controls in the empty lane, inspector empty-state, or header popup',
  );
  assert.match(
    interactionsPanelSource,
    /onClick=\{\(\) => onOpenTimeline\(action\.id\)\}/,
    'an interaction action row must open the timeline with that action selected',
  );
  assert.match(
    interactionsPanelSource,
    /onOpenTimeline=\{actionId => onOpenTimeline\(active\.id, actionId\)\}/,
    'the interaction panel must propagate the selected action id together with its interaction id',
  );
  assert.match(
    interactionsPanelSource,
    /data-custom-interaction-code[\s\S]*?<CodeEditor[\s\S]*?customInteractionCodeScaffold\(interaction\)[\s\S]*?customInteractionCodeBody\(source, interaction\.customCode\)/,
    'custom event details must expose a managed code scaffold that preserves the authored animation body',
  );
  assert.match(
    interactionSource,
    /const compileCustomAnimation[\s\S]*?interaction\.customCode[\s\S]*?Function\([\s\S]*?'element'[\s\S]*?'elements'[\s\S]*?customAnimation\.call\([\s\S]*?element[\s\S]*?elements[\s\S]*?event[\s\S]*?motionEngine/,
    'the runtime must execute custom event animation code with the managed target and Motion context',
  );
  assert.match(
    motionTimelineSource,
    /<MousePointer2 className="size-5[^"]*"[\s\S]*?max-w-\[232px\] text-balance[\s\S]*?max-w-\[218px\] text-balance/,
    'the empty timeline inspector must keep its icon restrained and both messages visually balanced',
  );
  assert.match(
    interactionsPanelSource,
    /data-saved-animation-library[\s\S]*?Animações salvas[\s\S]*?savedAnimations\.map\(preset =>[\s\S]*?onApplySaved\(preset\)[\s\S]*?onRemoveSaved\(preset\.id\)/,
    'the trigger chooser must expose saved animations with explicit apply and remove actions',
  );
  assert.match(
    interactionsPanelSource,
    /mode === 'library'[\s\S]*?<HtmlInteractionLibrary[\s\S]*?onApplied=/,
    'Interactions must expose the official Effects Library independently from saved animations',
  );
  assert.match(
    interactionsPanelSource,
    /data-effects-panel-trigger[\s\S]*?aria-label="Biblioteca de efeitos"[\s\S]*?onClick=\{onOpenLibrary\}[\s\S]*?const openEffectsLibrary = \(\) => \{[\s\S]*?if \(onOpenEffectsLibrary\)[\s\S]*?onOpenEffectsLibrary\(\)[\s\S]*?setMode\('library'\)[\s\S]*?onOpenLibrary=\{openEffectsLibrary\}/,
    'the empty trigger chooser must keep Effects Library reachable through the workspace panel with an embedded-library fallback',
  );
  assert.match(
    interactionLibraryPanelSource,
    /INTERACTION_LIBRARY_CATALOG[\s\S]*?function TargetPicker[\s\S]*?data-interaction-library-wizard[\s\S]*?data-interaction-effects-library/,
    'the Effects Library must provide a catalog and a target-picking wizard',
  );
  assert.match(
    interactionLibraryPanelSource,
    /Buscar efeitos[\s\S]*?Quando acontece\?[\s\S]*?data-library-activation-filters[\s\S]*?data-library-activation-filter=\{filter\}[\s\S]*?aria-pressed=\{selected\}/,
    'the Effects Library must lead with searchable, accessible activation filters',
  );
  assert.match(
    interactionLibraryPanelSource,
    /Entrada[\s\S]*?Ao entrar na tela[\s\S]*?Hover[\s\S]*?Ao passar o cursor[\s\S]*?Cursor[\s\S]*?Segue o ponteiro[\s\S]*?Loop contínuo[\s\S]*?Movimento ambiente[\s\S]*?Scroll contínuo[\s\S]*?Ligado ao progresso/,
    'activation filters must explain when Entrance, Hover, Cursor, ambient Loop and continuous Scroll effects run',
  );
  assert.match(
    interactionLibraryPanelSource,
    /data-kodety-effects-search-control[\s\S]*?h-8 min-w-0 overflow-hidden rounded-\[8px\][\s\S]*?focus-within:border-\[var\(--kodety-focus\)\]\/70[\s\S]*?data-kodety-effects-search-inner[\s\S]*?focus-visible:!border-0[\s\S]*?focus-visible:!ring-0/,
    'the attached Effects panel must use the same single-outline compound search control as Insert',
  );
  assert.match(
    interactionLibraryPanelSource,
    /@solar-icons\/react\/bold-duotone\/stars-minimalistic[\s\S]*?bold-duotone\/hand-stars[\s\S]*?bold-duotone\/cursor-square[\s\S]*?bold-duotone\/repeat[\s\S]*?bold-duotone\/magic-wand-3[\s\S]*?const PANEL_NAVIGATION_ICONS[\s\S]*?<Icon className="size-\[18px\]"/,
    'Effects navigation must use semantic Solar Bold Duotone glyphs inside the neutral 32px targets',
  );
  assert.match(
    interactionLibraryPanelSource,
    /Tipo de efeito[\s\S]*?data-library-category-filters[\s\S]*?data-library-category-filter=\{categoryFilter\}/,
    'effect type must remain an explicitly secondary filter instead of being mixed with activation',
  );
  assert.match(
    interactionLibraryPanelSource,
    /data-library-activation=\{group\.activation\}[\s\S]*?data-library-effect-card=\{item\.id\}[\s\S]*?data-library-effect-activation=\{item\.activation\}[\s\S]*?data-library-activation-badge=\{item\.activation\}/,
    'results must be visually grouped and every effect card must retain a visible activation badge',
  );
  assert.match(
    interactionLibraryPanelSource,
    /data-library-empty-state[\s\S]*?Nenhum efeito encontrado[\s\S]*?Limpar filtros/,
    'combined filters and search must provide a recoverable empty state',
  );
  assert.ok(
    !interactionLibraryPanelSource.includes('>{item.engine}</span>'),
    'cards and headers must not expose timeline/behavior implementation jargon as their primary badge',
  );
  assert.match(
    interactionLibraryPanelSource,
    /data-library-scroll-milestones[\s\S]*?Scroll checkpoints[\s\S]*?sectionSelector\(section\.id\)[\s\S]*?elementAnchor[\s\S]*?viewportAnchor[\s\S]*?offsetPx/,
    'sequence effects must expose multiple section checkpoints with independent anchors and offsets',
  );
  assert.match(
    interactionLibraryPanelSource,
    /frame_\{index\}\.webp[\s\S]*?imageStartIndex[\s\S]*?imageEndIndex[\s\S]*?imageZeroPad[\s\S]*?imagePreloadRadius/,
    'Image Sequence must expose URL token, frame range, zero padding and bounded preload controls',
  );
  assert.match(
    interactionLibraryPanelSource,
    /textRollStagger: Math\.max\(0, Math\.min\(0\.5, numeric\(/,
    'the Text Roll editor must clamp stagger before save instead of displaying a value that persistence changes',
  );
  assert.match(
    interactionLibraryPanelSource,
    /data-library-ticker-settings[\s\S]*?Direção[\s\S]*?tickerSpeed[\s\S]*?tickerGap[\s\S]*?No hover[\s\S]*?Desacelerar[\s\S]*?Pausar[\s\S]*?Segurar e arrastar[\s\S]*?tickerDragSensitivity[\s\S]*?tickerMomentum/,
    'Ticker must expose direction, speed, spacing, hover pause/slowdown, drag sensitivity and inertia before applying',
  );
  assert.match(
    interactionLibraryPanelSource,
    /videoStartTime[\s\S]*?videoEndTime[\s\S]*?videoSmoothing[\s\S]*?<MilestoneEditor/,
    'Video Scrub must expose time mapping, seek smoothing and the shared checkpoint editor',
  );
  assert.match(
    projectEditorSource,
    /interaction\.behavior && 'milestones' in interaction\.behavior[\s\S]*?interaction\.behavior\.milestones\.map\(milestone => milestone\.selector\)/,
    'the Navigator must mark every section used as a sequence checkpoint',
  );
  assert.match(
    interactionsPanelSource,
    /title=\{interaction\.actions\.length \? 'Salvar animação na biblioteca' : 'Adicione uma ação antes de salvar'\}[\s\S]*?disabled=\{readOnly \|\| !onSaveAnimation \|\| !interaction\.actions\.length\}[\s\S]*?data-save-animation-form[\s\S]*?Salvar como predefinição[\s\S]*?onSaveAnimation\?\.\(interaction, saveName\.trim\(\)\)[\s\S]*?>\s*Salvar\s*</,
    'an authored interaction must expose a guarded save-to-library flow',
  );
  assert.match(
    interactionsPanelSource,
    /const changeTrigger = \(trigger: InteractionTrigger\) => \{[\s\S]*?interactionUsesDefaultName\(interaction\)[\s\S]*?changes\.name = `\$\{triggerMeta\(trigger\)\.defaultName\} interaction`[\s\S]*?<VisualSelectControl[\s\S]*?value=\{interaction\.trigger\}[\s\S]*?options=\{TRIGGER_OPTIONS\}[\s\S]*?onValueChange=\{value => changeTrigger\(value as InteractionTrigger\)\}/,
    'the interaction detail must expose the complete trigger catalog and update only an untouched default name',
  );
  assert.match(
    interactionsPanelSource,
    /const patch = \(changes: Partial<InteractionDefinition>\) => \{[\s\S]*?if \(readOnly\) return;[\s\S]*?const changeTargetMode[\s\S]*?if \(readOnly\) return;[\s\S]*?const pickTrigger[\s\S]*?if \(readOnly\) return;/,
    'read-only interaction details must guard every shared mutation entry point',
  );
  assert.match(
    interactionsPanelSource,
    /const create = \(trigger: InteractionTrigger\) => \{[\s\S]*?if \(readOnly\) return;[\s\S]*?const applySaved = \(preset: SavedInteractionPreset\) => \{[\s\S]*?if \(readOnly\) return;/,
    'read-only interaction panels must block both new and saved-animation creation',
  );
  assert.match(
    realtimeInspectorSource,
    /<HtmlInteractionsPanel[\s\S]*?readOnly=\{readOnly \|\| isLocaleOverride\}[\s\S]*?savedAnimations=\{savedAnimations\}[\s\S]*?onSaveAnimation=\{onSaveAnimation\}[\s\S]*?onRemoveSavedAnimation=\{onRemoveSavedAnimation\}/,
    'localized overrides and shared read-only sessions must reach the saved-animation controls as read-only',
  );
  assert.match(
    projectEditorSource,
    /const saveAnimation = useCallback\([\s\S]*?if \(sharedReadOnly \|\| editingLocalizedPage\) return;[\s\S]*?savedAnimations: \[\.\.\.existing, preset\][\s\S]*?const removeSavedAnimation = useCallback[\s\S]*?if \(sharedReadOnly \|\| editingLocalizedPage\) return;[\s\S]*?savedAnimations: nextLibrary/,
    'saving and removing reusable animations must honor shared and locale edit guards at the persistence boundary',
  );
  assert.match(
    interactionsPanelSource,
    /const active = document\.interactions\.find\(interaction => interaction\.id === activeId\) \|\| null;[\s\S]*?if \(activeId && !document\.interactions\.some\(interaction => interaction\.id === activeId\)\) \{[\s\S]*?setActiveId\(null\);[\s\S]*?setMode\(matching\.length \? 'list' : 'choose'\);/,
    'removing a grouped interaction must close its obsolete detail state instead of reopening a stale definition',
  );
  assert.match(
    interactionsPanelSource,
    /useEffect\(\(\) => \{[\s\S]*?chooserRequested\.current = false;[\s\S]*?setActiveId\(null\);[\s\S]*?setMode\(matching\.length \? 'list' : 'choose'\);[\s\S]*?\}, \[selection\.path\]\);/,
    'moving between a group and one of its children must reset the sidebar detail identity',
  );
  assert.match(
    motionTimelineSource,
    /const selectedAction = activeInteraction\?\.actions\.find\(action => action\.id === selectedActionId\) \|\| null;[\s\S]*?selectedActionId &&[\s\S]*?!activeInteraction\?\.actions\.some\(action => action\.id === selectedActionId\)[\s\S]*?setSelectedActionId\(null\)/,
    'renaming may preserve an active timeline id, but deleting its selected action must clear obsolete timeline state',
  );
  assert.match(
    motionTimelineSource,
    /onChange=\{event => updateTarget\(\{[\s\S]*?selector: event\.target\.value,[\s\S]*?scope: action\.target\.scope === 'trigger'[\s\S]*?\? 'document'[\s\S]*?: action\.target\.scope/,
    'editing a selector must preserve descendant, closest and document scopes instead of silently rebinding them',
  );
  assert.match(
    motionTimelineSource,
    /focusActionId\?\.startsWith\([\s\S]*?INTERACTION_ACTION_CATALOG_FOCUS_PREFIX[\s\S]*?setSelectedActionId\(openActionCatalog \? null : focusActionId \|\| null\);[\s\S]*?setPickerOpen\(openActionCatalog\)/,
    'the panel action-catalog request must open the catalog instead of leaving a stale selected action',
  );
  assert.match(
    interactionsPanelSource,
    /onOpenTimeline\([\s\S]*?INTERACTION_ACTION_CATALOG_FOCUS_PREFIX[\s\S]*?Date\.now\(\)[\s\S]*?actionCatalogFocusSequence/,
    'each add-action request from the interactions panel must carry a fresh catalog focus token',
  );
  assert.match(
    interactionsPanelSource,
    /function InteractionRow\([\s\S]*?disabled=\{readOnly \|\| !canRemove\}[\s\S]*?const selectionOwnsTrigger = interactionTriggerMatchesSelectionPath\([\s\S]*?canRemove=\{selectionOwnsTrigger\}[\s\S]*?if \(!readOnly && selectionOwnsTrigger\)/,
    'only the selected canonical trigger may expose destructive deletion of an interaction',
  );
  assert.match(
    motionTimelineSource,
    /const addAction = \(action: InteractionAction\) => \{[\s\S]*?actions: \[\.\.\.interaction\.actions, nextAction\][\s\S]*?setTimelineScope\('interaction'\);[\s\S]*?setSelectedActionId\(nextAction\.id\)/,
    'adding an action from a group projection must switch to its complete canonical timeline so the new action stays visible',
  );
  assert.match(
    motionTimelineSource,
    /const previewScopeHasHiddenActions = timelineScope !== 'interaction'[\s\S]*?interactionProjectionIsCompleteForSelectionSubtree\([\s\S]*?selection\.path[\s\S]*?const seek = \(time: number\) => \{[\s\S]*?if \(previewScopeHasHiddenActions\) return;[\s\S]*?const beginPlayback[\s\S]*?\|\| previewScopeHasHiddenActions[\s\S]*?\) return;/,
    'a semantically incomplete group projection must not play or scrub hidden external targets or triggers',
  );
  assert.match(
    motionTimelineSource,
    /const selectTimelineAction = \(interactionId: string, actionId: string\) => \{[\s\S]*?setTimelineScope\('interaction'\)[\s\S]*?const removeAction = \(interactionId: string, actionId: string\) => \{[\s\S]*?if \(selectedActionId === actionId\) closeActionInspector\(\)/,
    'opening a projected action must reveal its canonical timeline and removing another action must keep the inspector open',
  );
  assert.equal(
    [...motionTimelineSource.matchAll(/interactionKeyframesForDuration\(\s*[^,\n]+,\s*changes\.duration/g)].length,
    2,
    'duration edits from both animation inspectors must use the ordered domain keyframe rescaler',
  );
  assert.match(
    projectEditorSource,
    /onTimelineOpen=\{\(interactionId, actionId\) => \{[\s\S]*?if \(sharedReadOnly\) return;[\s\S]*?setTimelineFocusTimelineId\(interactionId \|\| null\);[\s\S]*?setTimelineFocusClipId\(actionId \|\| null\);[\s\S]*?setShowTimeline\(true\)/,
    'opening the timeline must clear stale action focus and remain unavailable in a shared read-only workspace',
  );
  assert.match(
    motionTimelineSource,
    /const closeTimeline = useCallback\(\(\) => \{[\s\S]*?releaseInteractionPreview\(\)[\s\S]*?setShowTimeline\(false\);[\s\S]*?setTimelineFocusTimelineId\(null\);[\s\S]*?setTimelineFocusClipId\(null\)/,
    'closing the timeline must clear both interaction and action focus before it can be reopened',
  );
  assert.doesNotMatch(
    interactionsPanelSource,
    /const exact = document\.interactions\.filter\(interaction =>\s*interactionMatchesSelection\(interaction, selection\)\)/,
    'the group sidebar must not use context-free exact matching that promotes an ancestral selector to the selected child',
  );
  assert.doesNotMatch(
    motionTimelineSource,
    /const selectedTimeline = interactionTimelineForSelection\(interaction, selection\);/,
    'the timeline must resolve relative target scopes against source instead of matching a same-class element outside the group',
  );
  const interactionSettingsSource = interactionsPanelSource.slice(
    interactionsPanelSource.indexOf('function InteractionSettings'),
    interactionsPanelSource.indexOf('export function HtmlInteractionsPanel'),
  );
  assert.match(
    interactionSettingsSource,
    /const changeTargetMode = \(mode: InteractionTargetMode\) => \{[\s\S]*?if \(mode === 'selector'\)[\s\S]*?if \(!selectionIsTrigger\) return;[\s\S]*?ensureInteractionSelector\(source, selection\.path, selection, mode\)/,
    'editing a child-owned row must not silently rebind the parent group trigger to the current ancestor selection',
  );
  const actionInspectorSource = motionTimelineSource.slice(
    motionTimelineSource.indexOf('function ActionInspector'),
    motionTimelineSource.indexOf('export function HtmlMotionTimeline'),
  );
  assert.match(
    actionInspectorSource,
    /const changeTargetMode = \(mode: InteractionTargetMode\) => \{[\s\S]*?if \(mode === 'selector'\)[\s\S]*?if \(!selection \|\| !selectionBindingAllowed\) return;[\s\S]*?ensureInteractionSelector\(source, selection\.path, selection, mode\)/,
    'editing one grouped child action must not rebind its target to the selected group ancestor',
  );
  assert.match(
    interactionsPanelSource,
    /data-interaction-essentials[\s\S]*?space-y-3[\s\S]*?data-interaction-trigger-target[\s\S]*?space-y-1\.5[\s\S]*?flex h-8 min-w-0 overflow-hidden[\s\S]*?Selecionar alvo no canvas[\s\S]*?data-interaction-target-modes[\s\S]*?grid h-8 min-w-0 grid-cols-3[\s\S]*?min-w-0 truncate/,
    'interaction target controls must use full-width vertical fields and truncate safely inside a narrow inspector',
  );
  assert.match(
    interactionsPanelSource,
    /data-interaction-trigger-chooser[\s\S]*?px-3 pb-2 pt-3[\s\S]*?Como iniciar\?[\s\S]*?data-interaction-trigger-grid[\s\S]*?grid grid-cols-2 gap-1[\s\S]*?TRIGGERS\.map[\s\S]*?h-\[42px\]/,
    'the initial trigger chooser must use a dense two-column grid with concise localized copy',
  );
  const triggerChooserSource = interactionsPanelSource.slice(
    interactionsPanelSource.indexOf('function TriggerChooser'),
    interactionsPanelSource.indexOf('function InteractionRow'),
  );
  assert.doesNotMatch(triggerChooserSource, /Nova interação/, 'the trigger chooser must not repeat the redundant “Nova interação” eyebrow');
  assert.match(
    interactionsPanelSource,
    /data-interaction-detail-header[\s\S]*?h-11 min-h-11[\s\S]*?bg-\[var\(--kodety-panel\)\][\s\S]*?title="Voltar para interações"[\s\S]*?h-7 min-w-0 flex-1 truncate[\s\S]*?data-interaction-detail-actions[\s\S]*?border-l border-\[var\(--kodety-divider\)\][\s\S]*?<Switch size="sm"/,
    'the interaction detail header must use the shared panel fill and reserve the narrow width for navigation, identity and actions',
  );
  assert.match(
    motionTimelineSource,
    /data-kodety-motion-timeline[\s\S]*?bg-\[var\(--kodety-panel\)\][\s\S]*?<main[^>]*bg-\[var\(--kodety-panel\)\][\s\S]*?<header[^>]*bg-\[var\(--kodety-panel\)\][\s\S]*?data-timeline-viewport[^>]*bg-\[var\(--kodety-panel\)\][\s\S]*?sticky left-0[^>]*bg-\[var\(--kodety-panel\)\][\s\S]*?data-timeline-lanes[^>]*bg-\[var\(--kodety-panel\)\][\s\S]*?sticky top-0[^>]*bg-\[var\(--kodety-panel\)\]/,
    'the timeline root, chrome, viewport, lane labels, lane canvas and ruler must each declare the same opaque panel token',
  );
  assert.match(
    motionTimelineSource,
    /data-timeline-action-clip[\s\S]*?selected \? 'border-transparent bg-\[color-mix\(in_srgb,var\(--kodety-accent\)_72%,#4338ca\)\][\s\S]*?dragPreview\?\.id === action\.id \? 'border-\[var\(--kodety-accent\)\] bg-\[var\(--kodety-panel-raised\)\][\s\S]*?'border-\[var\(--kodety-divider-strong\)\] bg-\[var\(--kodety-panel-raised\)\]/,
    'the selected timeline clip must use an opaque purple surface while every inactive state keeps its solid panel fill',
  );
  assert.doesNotMatch(
    motionTimelineSource.slice(
      motionTimelineSource.indexOf('data-timeline-action-clip'),
      motionTimelineSource.indexOf('data-timeline-resize-handle="start"'),
    ),
    /bg-\[var\(--kodety-accent\)\]\/\[|bg-white\/\[/,
    'timeline clip fills must not use translucent accent or white overlays',
  );
  assert.match(
    interactionsPanelSource,
    /data-interaction-list[\s\S]*?<section className="px-3 py-3">[\s\S]*?>Interações<\/h3>[\s\S]*?Gatilhos deste elemento[\s\S]*?variant="ghost"[\s\S]*?Efeitos[\s\S]*?overflow-hidden rounded-\[8px\] border border-\[var\(--kodety-divider\)\][\s\S]*?<InteractionRow[\s\S]*?onToggle=\{enabled =>/,
    'the interaction list must use a dense single surface with compact localized actions and direct enable control',
  );
  assert.match(
    realtimeInspectorSource,
    /<TabsContent value="interactions"[\s\S]*?kodety-page-transition-tabs[\s\S]*?<TabsContent value="element" className="[^"]*\bpt-2\b[^"]*"[\s\S]*?<div className="[^"]*\boverflow-hidden\b[^"]*">/,
    'Interactions must own its horizontal gutter so the minimum-width sidebar does not double inset controls',
  );
  assert.match(
    interactionsPanelSource,
    /data-interaction-actions[\s\S]*?data-interaction-action-list[\s\S]*?\{action\.name\}[\s\S]*?text-\[8px\][\s\S]*?\{actionMeta\.label\} · \{action\.target\.label \|\| 'Elemento do gatilho'\}[\s\S]*?action\.start\.toFixed\(2\)[\s\S]*?data-add-interaction-action[\s\S]*?<Plus className="size-3 shrink-0" \/>[\s\S]*?<span className="min-w-0 truncate">Adicionar ação<\/span>/,
    'action rows must prioritize the name, keep type, target and time as secondary metadata, and integrate add action into the same surface',
  );
  const interactionDetailHeaderSource = interactionsPanelSource.slice(
    interactionsPanelSource.indexOf('<header data-interaction-detail-header'),
    interactionsPanelSource.indexOf('</header>', interactionsPanelSource.indexOf('<header data-interaction-detail-header')),
  );
  assert.doesNotMatch(
    interactionDetailHeaderSource,
    /<span>Voltar<\/span>|backdrop-blur|bg-white\/\[\.04\]|data-interaction-detail-type-icon/,
    'the interaction detail header must avoid repeated labels, redundant trigger glyphs and one-off filled surfaces',
  );
  assert.match(
    interactionsPanelSource,
    /const scrollSectionOptions:[\s\S]*?__animated_element__[\s\S]*?Este elemento[\s\S]*?scrollSections\.map[\s\S]*?data-scroll-section-trigger[\s\S]*?value=\{interaction\.scrollTriggerSelector \|\| '__animated_element__'\}[\s\S]*?scrollTriggerSelector[\s\S]*?scrollTriggerLabel/,
    'Scroll interactions must offer a dropdown of available Scroll Section IDs without replacing the animated element',
  );
  assert.match(
    interactionsPanelSource,
    /data-interaction-availability[\s\S]*?Disponibilidade[\s\S]*?data-interaction-breakpoint-control[\s\S]*?role="group" aria-label="Dispositivos da interação"[\s\S]*?BREAKPOINTS\.map[\s\S]*?enabledBreakpoints\.includes[\s\S]*?aria-pressed=\{enabled\}[\s\S]*?toggleBreakpoint\(value\)[\s\S]*?data-interaction-breakpoint-label[\s\S]*?<TooltipContent side="top">\{label\}<\/TooltipContent>[\s\S]*?data-interaction-reduced-motion-control[\s\S]*?value=\{interaction\.reducedMotion\}[\s\S]*?REDUCED_MOTION_OPTIONS/,
    'interaction availability must use responsive accessible breakpoint controls and a separate full-width reduced-motion field',
  );
  assert.match(
    interactionsPanelSource,
    /value: 'desktop', label: 'PC'[\s\S]*?role="group" aria-label="Dispositivos da interação" className="[^"]*grid-cols-3 gap-0\.5/,
    'interaction devices must use the compact PC label and an exact two-pixel gap between controls',
  );
  const interactionAvailabilitySource = interactionsPanelSource.slice(
    interactionsPanelSource.indexOf('<section data-interaction-availability'),
    interactionsPanelSource.indexOf('</section>', interactionsPanelSource.indexOf('<section data-interaction-availability')),
  );
  assert.doesNotMatch(
    interactionAvailabilitySource,
    /enabledBreakpoints\.length\} de|grid-cols-3 items-center gap-y-2/,
    'availability must not show a redundant 3/3 counter or squeeze devices into a narrow value column',
  );
  assert.doesNotMatch(
    interactionsPanelSource,
    /function DraftTextInput|type DraftTextInputProps/,
    'interaction text fields must update the document directly instead of deferring edits until blur',
  );
  assert.match(
    interactionsPanelSource,
    /aria-label="Nome da interação"[\s\S]*?onChange=\{event => patch\(\{ name: event\.target\.value \}\)\}[\s\S]*?aria-label=\{interaction\.triggerTargetMode === 'selector'[\s\S]*?onChange=\{event => patch\(\{ triggerSelector: event\.target\.value/,
    'interaction name and selector fields must preserve immediate editing semantics',
  );
  const decimalSettingSource = interactionsPanelSource.slice(
    interactionsPanelSource.indexOf('function DecimalSettingInput'),
    interactionsPanelSource.indexOf('function TriggerChooser'),
  );
  assert.match(
    decimalSettingSource,
    /onChange=\{candidate =>[\s\S]*?setDraft\(next\)[\s\S]*?onCommit\(Math\.max\(0, Number\(next\.replace\(',', '\.'\)\)\)\)/,
    'numeric interaction fields must keep applying valid values while the user types',
  );
  assert.match(
    interactionsPanelSource,
    /selection\.hasElementChildren[\s\S]*?interactionsInSelectionSubtree\([\s\S]*?\[\.\.\.subtree, \.\.\.exact\][\s\S]*?matchingSignature[\s\S]*?setMode\(matching\.length \? 'list' : 'choose'\)/,
    'the Interactions sidebar must list grouped child timelines and leave a stale chooser when their document arrives',
  );
  assert.doesNotMatch(
    navigatorSource,
    /Boolean\(node\.attributes\["data-kodety-interaction-id"\]\?\.trim\(\)\)\s*\|\|/,
    'an orphan interaction id must not show a lightning indicator without a real timeline',
  );
  assert.doesNotMatch(
    interactionsPanelSource,
    /grid-cols-\[72px_minmax\(0,1fr\)_28px\]|ml-\[80px\]/,
    'interaction target controls must not rely on fixed columns or offsets that clip in the inspector',
  );
  assert.match(
    interactionSource,
    /INTERACTION_DOCUMENT_DIRECTORY = '\.incode\/animations'[\s\S]*?serializeInteractionDocument[\s\S]*?stripInteractionRuntime/,
    'interaction definitions must have a dedicated serializable animation document and runtime stripping boundary',
  );
  assert.match(
    projectEditorSource,
    /const dependencyChanged[\s\S]*?interactionDocumentNeedsScrollTrigger\([\s\S]*?changeSource\(nextSource, record, dependencyChanged\)/,
    'crossing the ScrollTrigger dependency boundary must refresh the canvas document',
  );
  assert.match(
    interactionSource,
    /target\.scope === 'descendants'[\s\S]{0,220}?safeQuery\(triggerElement, selector \|\| '\*', mode\)/,
    'the published interaction runtime must treat an empty descendants selector as every descendant',
  );
  assert.match(
    interactionSource,
    /legacyModeQuery[\s\S]*?mode === 'class'[\s\S]*?getElementsByClassName[\s\S]*?mode === 'element'[\s\S]*?data-kodety-interaction-id[\s\S]*?interaction\.triggerTargetMode/,
    'the published interaction runtime must resolve legacy Element and Class references without requiring a manual mode toggle',
  );
  assert.match(
    interactionSource,
    /target\.scope === 'closest'[\s\S]{0,220}?triggerElement\?\.parentElement\?\.closest\(selector \|\| '\*'\)/,
    'the published interaction runtime must resolve closest from the parent so a trigger cannot target itself',
  );
  assert.match(
    interactionSource,
    /const splitTextSnapshots = new Map\(\)[\s\S]*?const restoreSplitText[\s\S]*?element\.innerHTML = snapshot\.html[\s\S]*?if \(element\.children\?\.length\) return \[element\][\s\S]*?restoreSplitText\(\)/,
    'text splitting must protect group containers and restore generated leaf spans when the runtime is replaced',
  );
  const frozenInteractionSetupBranch = interactionSource.match(/if \(editorFrozen\) \{([\s\S]*?)\}\s*else if \(interaction\.trigger === 'load'\)/)?.[1] || '';
  assert.ok(frozenInteractionSetupBranch, 'the interaction runtime must keep an explicit frozen Design setup branch');
  assert.doesNotMatch(
    frozenInteractionSetupBranch,
    /register\(|splitText\(|motionEngine\.set\(/,
    'frozen Design setup must not build timelines, split text, or seed styles before explicit preview',
  );
  assert.match(
    interactionSource,
    /const prepareFrozenPreview = \(\) => \{[\s\S]*?baseTargetsFor\([\s\S]*?const buildFrozenInstances = triggerElements => \{[\s\S]*?triggerElements\.forEach\(register\)[\s\S]*?const activatePreview = \(\) => \{[\s\S]*?capturePreviewSession\([\s\S]*?buildFrozenInstances\(prepared\.triggerElements\)/,
    'Design must resolve current live targets, snapshot them, and lazily build temporary timelines only when preview starts',
  );
  assert.match(
    interactionSource,
    /externalScrollElements = interaction\.scrollTriggerSelector[\s\S]*?safeQuery\(document, interaction\.scrollTriggerSelector\)[\s\S]*?scrollElement = externalScrollElements\[index\] \|\| externalScrollElements\[0\] \|\| element[\s\S]*?MotionScroll\.create\(\{ animation: timeline, trigger: scrollElement/,
    'the runtime must animate the selected item while an external Scroll Section drives its scroll controller',
  );
  assert.match(
    projectEditorSource,
    /navigatorInteractionSelectors[\s\S]*?interaction\.triggerSelector,[\s\S]*?interaction\.scrollTriggerSelector,/,
    'layers must mark an external Scroll Section as participating in an interaction',
  );
  assert.match(
    previewBridgeSource,
    /projectPublicFilePath[\s\S]*?moduleStylePaths[\s\S]*?CSS extracted by Kodety preview/,
    'the isolated canvas must resolve public assets and module CSS without mutating source files',
  );
  assert.match(
    projectEditorSource,
    /const currentMediaAssetPath[\s\S]*?projectPublicFilePath\(project, resolved\)/,
    'the image inspector must select an imported public asset even when the authored source uses its web-root alias',
  );
  assert.match(
    previewBridgeSource,
    /runtimeAssetPathAliases\(project, Object\.keys\(runtimeAssetUrls\)\)[\s\S]*?runtimeAssets\.pathAliases\?\.\[path\]/,
    'runtime asset installation must reconcile Vite public paths before replacing iframe placeholders',
  );
  assert.match(
    previewBridgeSource,
    /replaceViteImportMetaEnv\(file\.text\)[\s\S]*?replaceViteImportMetaEnv\(script\.textContent \|\| ''\)/,
    'external and inline source modules must compile Vite import.meta.env before isolated Preview execution',
  );
  assert.match(
    previewBridgeSource,
    /cachedRuntimeAssetAvailablePaths\(project\)[\s\S]*?const flushRuntimeAssetRequests[\s\S]*?html-editor-runtime-assets-request[\s\S]*?patchRuntimeUrlProperty[\s\S]*?HTMLImageElement/,
    'dynamic detached media must request project assets on demand instead of resolving against about:srcdoc',
  );
  assert.match(
    projectEditorSource,
    /const getRuntimeAssetPathIndex = useCallback[\s\S]*?const filePathByLower = new Map<string, string>[\s\S]*?const availablePathSet = new Set<string>[\s\S]*?const availablePathByLower = new Map<string, string>[\s\S]*?runtimeAssetPathIndexRef\.current = next/,
    'runtime asset lookup must index the manifest and project paths instead of rescanning every file per request',
  );
  assert.match(
    projectEditorSource,
    /const sendRuntimeAssetBatchToFrame = useCallback[\s\S]*?requestedPaths: readonly string\[\][\s\S]*?projectOverride\?: HtmlProject[\s\S]*?availablePathSet\.has\(requestedPath\)[\s\S]*?availablePathByLower\.get\(requestedPathKey\)[\s\S]*?transferredPathKeys[\s\S]*?type: 'html-editor-runtime-assets'/,
    'the parent must deduplicate manifest-approved paths and post one transferable runtime-assets message per batch',
  );
  assert.match(
    previewBridgeSource,
    /const registerRuntimeAssetPath = path =>[\s\S]*?availableRuntimeAssetPaths\.push\(normalized\)[\s\S]*?const installTransferredRuntimeAssets = \(assets, aliases\) =>[\s\S]*?registerRuntimeAssetPath\(asset\.path\)[\s\S]*?sweepRuntimeAssets\(document\.documentElement\)/,
    'a file uploaded after the iframe was created must join the runtime asset index before the live React image is swept',
  );
  assert.match(
    previewBridgeSource,
    /const resolveRuntimeAssetPath = \(raw, allowUnregistered = false\)[\s\S]*?new URL\(document\.baseURI\)[\s\S]*?absolute\.origin !== base\.origin[\s\S]*?path\.startsWith\('assets\/'\) \|\| path\.includes\('\/assets\/'\)/,
    'a srcdoc-expanded same-base image URL and a just-uploaded assets path must resolve locally without admitting arbitrary remote URLs',
  );
  assert.match(
    previewBridgeSource,
    /const resolveRuntimeAssetUrlForComponent = raw =>[\s\S]*?requestRuntimeAssetUrl\(raw, finish, true\)[\s\S]*?runtimeAssetUrl\(raw\) \|\| raw[\s\S]*?globalThis\.__KODETY_RESOLVE_RUNTIME_ASSET_URL__ = resolveRuntimeAssetUrlForComponent/,
    'Code Components must await an iframe-owned Blob URL and fail open only for a genuinely missing optional asset',
  );
  assert.match(
    projectEditorSource,
    /const codeComponentAssetProvider = useMemo[\s\S]*?commitProject\(rebased\.project, true, false, true\);[\s\S]*?sendRuntimeAssetBatchToFrame\([\s\S]*?\[storagePath\],[\s\S]*?rebased\.project,[\s\S]*?\);/,
    'Code Component uploads must transfer the new binary to the retained iframe without forcing a canonical rebuild',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-runtime-asset-request'[\s\S]*?message\.type === 'html-editor-runtime-assets-request'[\s\S]*?message\.paths : \[message\.path\]/,
    'the parent must preserve singular runtime asset request compatibility while accepting batches',
  );
  assert.match(
    canvasProtocolSource,
    /html-editor-runtime-assets-request[\s\S]*?MAX_RUNTIME_ASSET_REQUEST_PATHS[\s\S]*?consumeRuntimeAssetPath/,
    'runtime asset batches must pass the bounded canvas protocol and reject absolute or traversal paths',
  );
  assert.match(
    previewBridgeSource,
    /url\.startsWith\('data:,kodety-runtime-asset-'\)/,
    'every transferred binary placeholder must be discovered without an asset-extension allowlist',
  );
  assert.doesNotMatch(previewBridgeSource, /RUNTIME_ASSET_EXTENSIONS/, 'new upload formats must not require a hard-coded preview extension update');
  assert.match(
    previewBridgeSource,
    /addPreviewBareModuleImports\(imports, bareModuleSpecifiers, dependencyVersions\)/,
    'the isolated canvas must map ordinary bare npm imports without overwriting runtime-owned aliases',
  );
  assert.match(
    previewBridgeSource,
    /function addPreviewBareModuleImports[\s\S]*?hasOwnProperty\.call\(imports, specifier\)[\s\S]*?moduleCdnUrl\(specifier, versions\)/,
    'React and the private Code Component SDK aliases must stay on the embedded canvas runtime',
  );
  assert.match(fontsStoreSource, /getFontLibraryTransport\(\)/, 'the shared font store must consume the installed platform transport');
  assert.doesNotMatch(
    fontsStoreSource,
    /googleFontsUrl|mediaUploadUrl|\/kodety\/api\/fonts|\bfetch\s*\(/,
    'the shared font store must not select a WordPress or legacy browser transport',
  );
  assert.match(
    wordpressFontTransportSource,
    /googleFontsUrl[\s\S]*?dependencies\.fetch\(googleFontsUrl[\s\S]*?credentials: 'same-origin'[\s\S]*?'X-WP-Nonce': nonce/,
    'the WordPress font transport must use only the injected authenticated catalog endpoint',
  );
  assert.match(
    wordpressFontTransportSource,
    /function normalizeAxes[\s\S]*?axis\.start \?\? axis\.min[\s\S]*?familyMetadataList[\s\S]*?normalizeGoogleFont/,
    'the WordPress font transport must understand the current Google metadata schema and variable axes',
  );
  assert.match(
    wordpressFontTransportSource,
    /WORDPRESS_FONT_LIBRARY_STORAGE_KEY[\s\S]*?dependencies\.storage\.setItem/,
    'the WordPress font transport must retain installed font associations',
  );
  assert.match(
    editorPlatformServicesSource,
    /installFontLibraryTransport[\s\S]*?getFontLibraryTransport[\s\S]*?No font library transport was installed/,
    'the font registry must install explicitly and fail closed without a composition root',
  );
  assert.match(
    wordpressEditorShellSource,
    /googleFontsUrl' => rest_url\('kodety\/v1\/fonts\/google'\)/,
    'the editor shell must expose the same-origin Google Fonts catalog endpoint',
  );
  assert.match(
    wordpressViteConfigSource,
    /\bbase:\s*['"]\.\/['"]/,
    'WordPress editor chunks must resolve relative to the plugin entry instead of the site-root /assets path',
  );
  assert.match(
    wordpressPluginSource,
    /register_rest_route\('kodety\/v1', '\/fonts\/google'[\s\S]*?function google_fonts_catalog\(\)[\s\S]*?fonts\.google\.com\/metadata\/fonts[\s\S]*?kodety_google_fonts_catalog_cache/,
    'WordPress must proxy and durably cache the Google Fonts metadata catalog',
  );
  assert.match(
    wordpressPluginSource,
    /familyMetadataList[\s\S]*?preg_match\('\/\^\(\\d\+\)i\$\/'[\s\S]*?sans-serif/,
    'the WordPress proxy must understand the current Google catalog schema and normalize italic variants/categories',
  );
  assert.match(
    projectEditorSource,
    /interactionDocumentPath\(current\.mainHtmlPath\)[\s\S]*?serializeInteractionDocument\([\s\S]*?interactionDocument,[\s\S]*?\{ canonical: true \}/,
    'editing an interaction must persist its document separately from the authored HTML page',
  );
  assert.match(
    projectEditorSource,
    /hasInteractionPayload = interactionDocumentPathCandidates\([\s\S]*?current\.mainHtmlPath,[\s\S]*?\)\.some\(path => Boolean\(current\.files\[path\]\)\)/,
    'removing the final legacy-only interaction must still materialize an authoritative empty canonical document',
  );

  assert.match(
    previewBridgeSource,
    /readInteractionDocumentFile\([\s\S]*?project\.mainHtmlPath[\s\S]*?if \(animationDocument\?\.interactions\.length\)[\s\S]*?patchInteractionDocument\([\s\S]*?animationDocument[\s\S]*?false/,
    'preview must materialize the current or recoverable legacy animation document inside its isolated Design and runtime documents',
  );
  assert.match(
    projectIoSource,
    /prepareProjectForTransport[\s\S]*?pageAnimationDocument = readInteractionDocumentFile\([\s\S]*?file\.path[\s\S]*?animationDocument[\s\S]*?patchInteractionDocument\(withComponents, animationDocument\)/,
    'publish transport must compile current or recoverable legacy animation documents into the shipped HTML without changing editor source',
  );
  assert.match(
    projectIoSource,
    /projectRequiresCodedBuild\(localizedProject\)[\s\S]*?\? prepareCodedProjectForTransport\(localizedProject\)[\s\S]*?: hydrateCodedProject\(localizedProject\)/,
    'ordinary Preview/export transport must bypass the coded build unless the fail-safe Vite predicate opts in',
  );
  assert.match(
    projectEditorSource,
    /wordpressDraftRetryTimerRef[\s\S]*?pendingWordPressDraftProjectRef\.current\s*=\s*latest[\s\S]*?retryDelay/,
    'WordPress draft failures must retain the latest project and retry automatically',
  );
  assert.match(
    projectEditorSource,
    /response\.status === 429[\s\S]*?Retry-After[\s\S]*?WORDPRESS_DRAFT_RATE_LIMIT_FLOOR_MS[\s\S]*?wordpressDraftRateLimitedUntilRef\.current/,
    'HTTP 429 must establish a server-aware autosave cooldown instead of immediately uploading another project ZIP',
  );
  assert.match(
    projectEditorSource,
    /pendingWordPressDraftProjectRef\.current = next;[\s\S]*?if \(wordpressDraftRetryTimerRef\.current !== null\) return;[\s\S]*?wordpressDraftRetryCountRef\.current = 0/,
    'new edits during an autosave retry must replace the pending snapshot without cancelling the active backoff',
  );
  assert.match(
    projectEditorSource,
    /const persistLocalProjectSnapshot = useCallback[\s\S]*?const protectedRecovery = recoveryPendingDecisionRef\.current[\s\S]*?saveProjectSnapshot\(snapshot, \{[\s\S]*?preserveRecovery[\s\S]*?if \(!isWordPressRuntime\) setSavedAt\(localSavedAt\)[\s\S]*?const stored:[^=]*= \{[\s\S]*?project: snapshot,[\s\S]*?savedAt: localSavedAt[\s\S]*?setRecoverableProject\(stored\)/,
    'the local recovery snapshot must never masquerade as a confirmed WordPress save',
  );
  assert.match(
    projectEditorSource,
    /pendingLocalSnapshotRef\.current = project;[\s\S]*?isWordPressRuntime && localSnapshotTimerRef\.current !== null\) return;[\s\S]*?const delay = isWordPressRuntime[\s\S]*?WORDPRESS_DRAFT_AUTOSAVE_INTERVAL_MS[\s\S]*?: normalDelay[\s\S]*?persistLocalProjectSnapshot\(pending\)/,
    'WordPress local recovery must stay on an anchored interval while standalone projects retain their short debounce',
  );
  assert.match(
    projectEditorSource,
    /const persistentContentUnchanged = Boolean\([\s\S]*?previousContent\.files === project\.files[\s\S]*?previousContent\.name === project\.name[\s\S]*?previousContent\.rootPath === project\.rootPath[\s\S]*?if \(persistentContentUnchanged\) \{[\s\S]*?if \(pendingLocalSnapshotRef\.current\) pendingLocalSnapshotRef\.current = project;[\s\S]*?return;/,
    'route-only navigation must neither restart nor create a full-project IndexedDB recovery snapshot',
  );
  assert.match(
    projectEditorSource,
    /projectAutosaveNotBeforeRef\.current = isWordPressRuntime[\s\S]*?Date\.now\(\) \+ PROJECT_FIRST_AUTOSAVE_DELAY_MS[\s\S]*?: 0/,
    'opening a WordPress project must establish the ten-minute first-autosave deadline without delaying standalone recovery',
  );
  assert.match(
    projectEditorSource,
    /const persistBeforePageHide[\s\S]*?enqueueCurrentLocalSnapshot\(\)[\s\S]*?Date\.now\(\) >= projectAutosaveNotBeforeRef\.current[\s\S]*?flushWordPressDraftWrite\(\)[\s\S]*?addEventListener\('pagehide', persistBeforePageHide\)/,
    'pagehide must always start local recovery while respecting the WordPress first-autosave deadline for remote writes',
  );
  assert.match(
    projectStorageSource,
    /createLatestWriteQueue[\s\S]*?pendingValue === null \? value : merge\(pendingValue, value\)[\s\S]*?preserveRecovery: pending\.preserveRecovery \|\| next\.preserveRecovery/,
    'project storage must keep one latest-wins pending value without dropping a protected recovery',
  );
  assert.match(
    projectStorageSource,
    /RECOVERY_KEY = 'recovery'[\s\S]*?store\.put\(snapshot\.preserveRecovery, snapshotStorageKey\(RECOVERY_KEY, snapshot\.workspaceKey\)\)[\s\S]*?clearProjectRecoverySnapshot/,
    'a divergent local copy must survive later latest-snapshot writes until recovery succeeds',
  );
  assert.match(
    projectEditorSource,
    /recoveryPendingDecisionRef = useRef[\s\S]*?initialWordPressWorkspaceOpenedRef\.current = true[\s\S]*?openProjectRef\.current\([\s\S]*?requestedProject[\s\S]*?hasDivergentLocalRecovery[\s\S]*?title="Recuperar a cópia local\?"[\s\S]*?confirmLabel="Recuperar e substituir"/,
    'divergent recovery must stay behind an explicit replacement confirmation',
  );
  assert.match(
    topbarSource,
    /hasDivergentLocalRecovery[\s\S]*?Recuperar cópia local/,
    'the project menu must expose the protected local-recovery action only when a divergent copy exists',
  );
  assert.match(
    projectEditorSource,
    /wordpressRecoveryComparisonDoneRef\.current = true[\s\S]*?projectSignature\(candidate\.project\) !== projectSignature\(project\)[\s\S]*?recoveryPendingDecisionRef\.current = candidate/,
    'only the pre-existing local copy compared with the initial WordPress workspace may become protected recovery',
  );
  assert.match(
    projectEditorSource,
    /const pendingDecision = recoveryPendingDecisionRef\.current[\s\S]*?if \(pendingDecision && projectSignature\(pendingDecision\.project\) !== projectSignature\(snapshot\)\)[\s\S]*?const stored:[^=]*= \{[\s\S]*?project: snapshot,[\s\S]*?savedAt: localSavedAt[\s\S]*?setRecoverableProject\(stored\)/,
    'ordinary local autosaves must advance recoverable/latest instead of freezing the previous edit',
  );
  assert.match(
    projectEditorSource,
    /const recoverDivergentLocalProject = useCallback[\s\S]*?openProject\(stored\.project, null, true\)[\s\S]*?persistExactWordPressDraft\(stored\.project, true\)[\s\S]*?clearProjectRecoverySnapshot/,
    'recovering a local copy must immediately upload that exact replacement before clearing its protection',
  );
  assert.match(
    projectEditorSource,
    /const discardDivergentLocalRecovery = useCallback[\s\S]*?await clearProjectRecoverySnapshot\(currentSnapshotWorkspaceKey\(\)\)[\s\S]*?recoveryPendingDecisionRef\.current = null[\s\S]*?persistLocalProjectSnapshot\(current\)[\s\S]*?extraActionLabel="Descartar cópia local"[\s\S]*?onExtraAction=\{discardDivergentLocalRecovery\}/,
    'the recovery confirmation must let the user discard the protected copy and resume normal latest snapshots',
  );
  assert.match(
    projectEditorSource,
    /const persistExactWordPressDraft = useCallback[\s\S]*?await enqueueWordPressDraftWrite\(next, \{[\s\S]*?exact: true,[\s\S]*?signal,[\s\S]*?forceRoundTrip[\s\S]*?lastWordPressDraftSignatureRef\.current !== signature[\s\S]*?throw createWordPressExactSnapshotChangedError\(\)/,
    'explicit saves must await the REST write for their exact project snapshot',
  );
  assert.match(
    projectEditorSource,
    /!templateImport[\s\S]*?signature === lastWordPressDraftSignatureRef\.current[\s\S]*?\/\^\[a-f0-9\]\{64\}\$\/i\.test\(wordpressCssDigestRef\.current\)[\s\S]*?wordpressDraftQueuedCountRef\.current \+= 1[\s\S]*?\.finally\(\(\) => \{[\s\S]*?wordpressDraftQueuedCountRef\.current = Math\.max\(0, wordpressDraftQueuedCountRef\.current - 1\)/,
    'a saved snapshot must be skipped while queued autosaves retain exact in-flight accounting',
  );
  assert.match(
    projectEditorSource,
    /config\?\.editorLockUrl && useHtmlCollaborationStore\.getState\(\)\.mode !== 'edit'[\s\S]*?Este projeto já está aberto para edição em outra sessão/,
    'explicit persistence must fail closed unless this exact session owns the editor lock',
  );
  assert.match(
    settingsHostSource,
    /const saveSiteSettings = useCallback\([\s\S]*?await persistExactDraft\(next, true\);[\s\S]*?commitProject\(next\)/,
    'Settings must remain saving until WordPress ACKs the exact site snapshot',
  );
  assert.match(
    settingsHostSource,
    /const saveCustomCode = useCallback\([\s\S]*?await persistExactDraft\(next, true\)[\s\S]*?const saveRedirects = useCallback\([\s\S]*?await persistExactDraft\(next, true\)/,
    'Custom Code and redirects must expose the same ACK-backed save contract',
  );
  assert.match(
    projectEditorSource,
    /const publishToWordPress = useCallback[\s\S]*?const publishSnapshot = projectRef\.current[\s\S]*?const current = publishSnapshot[\s\S]*?await persistExactWordPressDraft\(current, false, controller\.signal, false, true, true\)[\s\S]*?publishSnapshotMode = true[\s\S]*?const cssDigest = wordpressCssDigestRef\.current[\s\S]*?requiresMaterializedPublish = publishSnapshotMode[\s\S]*?config\.materializedPublishOverlay[\s\S]*?projectToMaterializedPublishOverlayPackage[\s\S]*?projectToPublishPackage[\s\S]*?\)\(current[\s\S]*?publishArchiveDigest = prepared\.cssDigest[\s\S]*?'X-Kodety-Publish-Snapshot': '1'[\s\S]*?'X-Kodety-Publish-Materialized-Overlay': '1'[\s\S]*?'X-Kodety-Source-CSS-Digest': cssDigest[\s\S]*?'X-Kodety-Publish-Workspace': '1'/,
    'publish must prefer an exact draft ACK while retaining snapshot, overlay and saved-workspace transports without letting autosave block release',
  );
  assert.match(
    projectEditorSource.slice(
      projectEditorSource.indexOf('const publishToWordPress = useCallback'),
      projectEditorSource.indexOf('const cancelWordPressPublish'),
    ),
    /requiresMaterializedPublish = publishSnapshotMode[\s\S]*?if \(requiresMaterializedPublish\)[\s\S]*?projectToMaterializedPublishOverlayPackage[\s\S]*?projectToPublishPackage[\s\S]*?\)\(current/,
    'WordPress publish must build a release package for runtime-only output or whenever draft persistence cannot be a prerequisite',
  );
  assert.match(
    projectEditorSource,
    /const hasCodedBuild = projectRequiresCodedBuild\(current\);[\s\S]*?requiresMaterializedPublish = publishSnapshotMode[\s\S]*?\|\| hasCodedBuild/,
    'a source project that requires compilation must never publish the raw fallback-ZIP workspace',
  );
  assert.match(
    projectEditorSource,
    /const requiresManagedVariantFaviconSync = projectNeedsManagedVariantFaviconSync\(current\);[\s\S]*?requiresMaterializedPublish[\s\S]*?\|\| requiresManagedVariantFaviconSync/,
    'a stale managed favicon inside an A/B snapshot must force the release-only overlay compiler',
  );
  assert.match(
    projectEditorSource,
    /requiresMembershipTransport = Object\.prototype\.hasOwnProperty\.call\([\s\S]*?releaseMetadata,[\s\S]*?'membership'[\s\S]*?requiresMaterializedPublish[\s\S]*?\|\| requiresMembershipTransport/,
    'every explicit Membership contract must reach the fail-closed transport compiler',
  );
  assert.match(
    projectEditorSource,
    /let publishRequestId = createWordPressPublishRequestId\(\)[\s\S]*?'X-Kodety-Expected-Revision': String\(releaseWorkspaceRevision\)[\s\S]*?'X-Kodety-Publish-Request-Id': publishRequestId[\s\S]*?isRetryableWordPressPublishStatus\(response\.status\)[\s\S]*?tentativa \$\{attempt \+ 2\}\/3/,
    'publish must keep one idempotency key and expected revision across uncertain retries',
  );
  assert.doesNotMatch(projectEditorSource, /switchToSnapshotPublication|Conflito conciliado · publicando snapshot/,
    'a confirmed publication conflict must stop without sending an older snapshot over concurrent changes');
  assert.match(
    projectEditorSource,
    /const nativeSyncPending = !publication\.complete && publication\.releaseOnline;[\s\S]*?toast\.success\('Site publicado'[\s\S]*?continuarão sincronizando em segundo plano[\s\S]*?html-editor:last-published-signature[\s\S]*?setPublishPanelOpen\(false\)/,
    'an online release must complete the Builder publish flow even while native pages or media continue in the background',
  );
  assert.doesNotMatch(
    projectEditorSource.slice(
      projectEditorSource.indexOf('const publication = resolveWordPressPublicationState(result);'),
      projectEditorSource.indexOf('const cancelWordPressPublish', projectEditorSource.indexOf('const publication = resolveWordPressPublicationState(result);')),
    ),
    /method: 'GET'|Não foi possível acompanhar a sincronização|Release online, sincronização pendente/,
    'post-activation sync observation must never turn an already-online release into a publish error',
  );
  assert.match(
    projectEditorSource,
    /const persistBeforeAnchorNavigation[\s\S]*?navigateAfterWordPressSave\(destination\.href\)[\s\S]*?document\.addEventListener\('click', persistBeforeAnchorNavigation\)/,
    'same-window WordPress navigation must flush the project before leaving the Builder',
  );
  assert.match(
    editorLocalizationHelpersSource,
    /function upsertCanonicalLocaleInsertion\([\s\S]*?canonicalizeLocalizationInsertionHtml\(insertion\.html\)[\s\S]*?return upsertLocaleInsertion/,
    'every locale insertion create/paste/duplicate/promotion write must share the canonical sanitizer boundary',
  );
  assert.equal(
    (editorLocalizationHelpersSource.match(/\bupsertLocaleInsertion\(/g) || []).length,
    1,
    'HtmlProjectEditor must call the raw insertion upsert only inside its canonical wrapper',
  );
  assert.match(
    projectEditorSource,
    /const commitLocaleElementOverride = useCallback[\s\S]*?let html = canonicalizeLocalizationInsertionHtml\(insertion\.html\)[\s\S]*?patchElementAttribute\(html, insertionPath/,
    'locale element overrides must canonicalize stored insertion HTML before applying a rendered-tree path',
  );
  assert.match(
    projectEditorSource,
    /const commitLocaleInsertionSourceMutation = useCallback[\s\S]*?const canonicalHtml = canonicalizeLocalizationInsertionHtml\(insertion\.html\)[\s\S]*?mutate\(canonicalHtml, insertionPath\)/,
    'all structural insertion mutations must target canonical storage rather than unsafe raw sibling indexes',
  );
  assert.match(
    projectEditorSource,
    /const saveLocalization = useCallback[\s\S]*?assertLocalizationForPersistence\(normalized\)[\s\S]*?localization: normalized/,
    'the settings panel must reject an invalid complete localization candidate before metadata persistence',
  );
  assert.match(
    settingsHostSource,
    /const saveSiteSettings = useCallback\([\s\S]*?setLocalizationSiteLanguage\([\s\S]*?siteSettings: normalizedSettings[\s\S]*?localization: synchronizedLocalization/,
    'saving the Site Settings language must replace the localization source and locale list atomically',
  );
  assert.match(
    projectEditorSource,
    /const saveLocalization = useCallback[\s\S]*?language: normalized\.sourceLocale[\s\S]*?siteSettings: synchronizedSiteSettings[\s\S]*?localization: normalized/,
    'localization persistence must keep Site Settings bound to the authored source locale',
  );
  assert.match(
    projectEditorSource,
    /storedLanguage[\s\S]*?setLocalizationSiteLanguage\([\s\S]*?language: canonicalLanguage[\s\S]*?localization: synchronizedLocalization[\s\S]*?commitProject\(next, false\)/,
    'older projects with divergent language metadata must repair themselves when opened',
  );
  assert.match(
    projectEditorSource,
    /const openBlankProject = useCallback\(async[\s\S]*?const blankProject = ensureProjectIdentity\(sanitizeProjectPriorities\(createBlankProject\(\)\)\)[\s\S]*?await persistExactWordPressDraft\([\s\S]*?blankProject,[\s\S]*?true,[\s\S]*?openProject\(blankProject, null, true, null, false, true\)[\s\S]*?if \(!projectRef\.current\)[\s\S]*?openBlankProject\(\)\.catch/,
    'the empty-state New Project action must await its transactional WordPress replacement before opening the acknowledged blank project',
  );
  assert.match(
    projectEditorSource,
    /const \[newProjectConfirmOpen, setNewProjectConfirmOpen\] = useState\(false\)[\s\S]*?confirmLabel="Descartar e criar novo"[\s\S]*?onConfirm=\{confirmCreateNewProject\}/,
    'replacing an existing project must use one confirmation that directly opens the blank project',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /newProjectStep|Confirme para descartar|newProjectNameEcho/,
    'New Project must not reintroduce the two-dialog state race that silently cancelled Continue',
  );
  assert.match(
    settingsHostSource,
    /const saveSiteSettings = useCallback\([\s\S]*?localization: synchronizedLocalization[\s\S]*?await persistExactDraft\(next, true\);[\s\S]*?commitProject\(next\);[\s\S]*?setActiveLocale\(synchronizedLocalization\.sourceLocale\)/,
    'Site Settings must ACK and commit the same synchronized-language snapshot before switching the active locale',
  );
  assert.match(
    projectSettingsSource,
    /const updateSiteLanguage[\s\S]*?origin: 'manual'[\s\S]*?onSaveSite\(next\)/,
    'changing the base language must enqueue an immediate explicit save',
  );
  assert.match(
    projectSettingsSource,
    /const flushSettingsBeforeLeave[\s\S]*?waitForSaveQueue\(\)[\s\S]*?settingsLeaveDraftRef\.current[\s\S]*?onSaveSite\(latest\.siteDraft\)[\s\S]*?const leaveSettings[\s\S]*?await prepareSettingsLeave\(\)/,
    'leaving Settings must flush drafts before the autosave timer is destroyed',
  );
  assert.match(
    editorLocalizationHelpersAndProjectSource,
    /function assertUniqueLocalizedElementId[\s\S]*?querySelectorAll\('\[id\]'\)[\s\S]*?já está em uso[\s\S]*?const commitLocaleElementOverride = useCallback[\s\S]*?assertUniqueLocalizedElementId\(renderedSource, paths, requestedId\)/,
    'localized ID edits must detect document collisions before committing and surface a clear editor error',
  );
  assert.match(
    infiniteCanvasSource,
    /const \[documentHeightState, setDocumentHeightState\][\s\S]*?documentHeightState\.scopeKey === viewPreferenceKey[\s\S]*?frames\.map\(frame => \(\{[\s\S]*?documentHeights\[frame\.id\][\s\S]*?layoutInfiniteCanvasFrames\(renderedFrames\)/,
    'each infinite-canvas breakpoint frame must use its measured real document height',
  );
  assert.match(
    infiniteCanvasSource,
    /useLayoutEffect\(\(\) => \{[\s\S]*?setDocumentHeightState\(current => \(\{[\s\S]*?heights: current\.scopeKey === viewPreferenceKey \? current\.heights : \{\}[\s\S]*?cancelAnimationFrame\(heightCommitFrameRef\.current\)[\s\S]*?pendingDocumentHeightsRef\.current\.clear\(\)/,
    'an iframe generation refresh must retain measured heights within the same canvas scope and discard stale pending measurements',
  );
  assert.match(
    infiniteCanvasSource,
    /const layoutRef = useRef\(layout\)[\s\S]*?fitInfiniteCanvasView\([\s\S]*?layoutRef\.current[\s\S]*?setFrameContentHeight[\s\S]*?pendingDocumentHeightsRef[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?const settled = new Map[\s\S]*?frames\.every[\s\S]*?contentFitTimerRef[\s\S]*?240/,
    'content heights must commit as one paint-boundary batch and fit only after every frame reports',
  );
  assert.match(
    infiniteCanvasSource,
    /const focusFrame = useCallback[\s\S]*?userAdjustedViewRef\.current = true[\s\S]*?focusInfiniteCanvasFrame\([\s\S]*?current[\s\S]*?frame/,
    'selecting a breakpoint must focus that frame without allowing a deferred whole-plane fit',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-infinite-canvas-height'[\s\S]*?setFrameContentHeight\(breakpointId, message\.height\)/,
    'active and passive iframe measurements must update the frame identified by the message source',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-infinite-canvas-wheel'[\s\S]*?infiniteCanvasRef\.current\?\.handleFrameWheel\(message\)/,
    'wheel events captured inside the editable iframe must reach the outer infinite plane',
  );
  assert.match(
    canvasStageSource,
    /passiveCanvasFrameIdsRef[\s\S]*?onPassiveFrameRegister=\{\(frame, registered, id\)[\s\S]*?passiveCanvasFrameIdsRef\.current\.set\(frame, id\)/,
    'passive breakpoint windows must retain an exact id for content-height and section-viewport messages',
  );
  assert.match(
    canvasStageSource,
    /onActiveFrameLoad=\{\(\) => \{[\s\S]*?passiveCanvasFramesRef\.current\.forEach\(frame => \{[\s\S]*?sendRuntimeAssetsToFrame\(frame, 'fonts', pageGeneration\)[\s\S]*?postDesignTokensToFrame\(frame\)[\s\S]*?postCanvasViewStateToFrame\(frame\)[\s\S]*?postViewportHeightSimulationsToFrame\(frame, id\)[\s\S]*?html-editor-infinite-canvas-refresh-height[\s\S]*?html-editor-runtime-assets-refresh/,
    'references that paint before the active authority must receive state, measurement and asset replays without navigation',
  );
  assert.match(
    previewBridgeSource,
    /passiveBreakpointPreview = document\.documentElement\.hasAttribute\('data-kodety-passive-breakpoint-preview'\)[\s\S]*?inspectionEnabled = [^\n]*&& !passiveBreakpointPreview[\s\S]*?contentEditing = [^\n]*&& !passiveBreakpointPreview/,
    'passive references must keep projection services while leaving selection and editing runtimes asleep',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /configuration\.defaultViewportHeight[\s\S]*?let defaultViewportHeight[\s\S]*?VIEWPORT_UNIT_PATTERN[\s\S]*?resolveCustomProperties[\s\S]*?viewportPixels/,
    'viewport units, including simple custom-property indirection, must resolve against the frame device height',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /const authoredDeclarations = Array\.from\(rule\.style\)[\s\S]*?const declarations = authoredDeclarations\.filter[\s\S]*?containsViewportUnit\(declaration\.value\)[\s\S]*?document\.querySelectorAll\('\[style\]'\)[\s\S]*?const prepared:[\s\S]*?applyRuntimeValue\(element, property, value\)/,
    'every CSS property, inline value and root custom property containing vh/svh/dvh/lvh must be resolved, not only height',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /if \(!declarations\.length && !mayDeclareFixed\) return;[\s\S]*?const specificityByElement = new Map/,
    'selectors without viewport-dependent or fixed declarations must not scan a long document, and specificity work must be cached per match',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /originalMediaConditions[\s\S]*?rewriteMediaConditionAtHeight[\s\S]*?rule\.media\.mediaText = simulatedCondition/,
    'height and orientation media queries must use the simulated device instead of the full-page iframe',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /computed\.position !== 'fixed'[\s\S]*?rect\.height >= Math\.max\(1, innerHeight - 2\)[\s\S]*?applyRuntimeValue\(element, 'height', `\$\{viewportHeight\}px`\)[\s\S]*?applyRuntimeValue\(element, 'max-height', `\$\{viewportHeight\}px`\)/,
    'fixed inset fullscreen gates without a literal vh must be capped to the simulated viewport',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /boundedViewportShell[\s\S]*?body\.querySelectorAll\('\[data-html-editor-path\]'\)[\s\S]*?contentElements = boundedViewportShell[\s\S]*?insideFixedRoot[\s\S]*?fixedRootElements\.includes\(current\)/,
    'a clipped html/body 100% shell and every descendant of fixed chrome must not feed physical iframe height back into measurement',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /bottom <= height[\s\S]*?const computed = getComputedStyle\(element\)/,
    'long-page measurement must read computed style only for elements that can extend the current lower bound',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /const scheduleControlRefresh[\s\S]*?requestStructuralFrame[\s\S]*?refreshControl\(\)[\s\S]*?document\.addEventListener\('scroll',[\s\S]*?scheduleControlRefresh\(\);[\s\S]*?\}, true\)/,
    'nested and document scroll must align viewport controls at most once per structural frame',
  );
  assert.doesNotMatch(
    infiniteCanvasRuntimeSource,
    /document\.addEventListener\('scroll',[\s\S]{0,320}?scheduleMeasure\(\)/,
    'scroll must not trigger the O(N) structural height walk',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /if \(needsScan\) \{[\s\S]*?scheduleScan\(\);[\s\S]*?\} else refreshControl\(\);/,
    'only structural mutations must rescan and remeasure; selection markers update chrome only',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /appliedRuntimeValues[\s\S]*?mutation\.attributeName !== 'style'[\s\S]*?current\.value !== runtimeValue\.value[\s\S]*?originals\.set\(property, current\)/,
    'viewport values applied after load must survive restoration and be re-resolved on the next scan',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /installStylesheetMutationHooks[\s\S]*?prototype\.insertRule[\s\S]*?scheduleScan\(\)[\s\S]*?prototype\.replaceSync[\s\S]*?scheduleScan\(\)/,
    'dynamic stylesheet rules must schedule another viewport-unit scan',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /new ResizeObserver\(\(\) => \{[\s\S]*?refreshControl\(\);[\s\S]*?scheduleMeasure\(\);[\s\S]*?resizeObserver\.observe\(document\.documentElement\)/,
    'text reflow must update canvas height through ResizeObserver without rescanning the complete CSS cascade per character',
  );
  assert.doesNotMatch(
    infiniteCanvasRuntimeSource,
    /characterData:\s*true/,
    'contenteditable character mutations must not trigger a complete viewport-unit CSS scan',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /html-editor-infinite-canvas-default-height[\s\S]*?defaultViewportHeight = clampHeight\(event\.data\.height\)[\s\S]*?scheduleScan\(\)[\s\S]*?scheduleMeasure\(\)/,
    'the persistent editable iframe must update its default viewport simulation without navigation',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /html-editor-infinite-canvas-refresh-height[\s\S]*?lastHeight = 0[\s\S]*?scheduleMeasure\(\)/,
    'a passive browsing context must be able to re-report its own height after becoming a reference',
  );
  assert.doesNotMatch(
    infiniteCanvasRuntimeSource,
    /root\?\.scrollHeight|body\?\.scrollHeight/,
    'document measurement must not feed the iframe viewport height back through html/body scrollHeight',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /__KODETY_EDITOR_NATIVE_CLOCK__[\s\S]*?requestStructuralFrame[\s\S]*?scheduleMeasure/,
    'measurement and chrome scheduling must use the editor structural clock',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /Math\.abs\(window\.innerWidth - lastObservedWidth\) >= 1[\s\S]*?scheduleScan\(\)[\s\S]*?scheduleMeasure\(\)/,
    'height fitting resizes must not restart the CSS cascade scan unless responsive width actually changed',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /Yield once before the first cascade walk[\s\S]*?scheduleScan\(\);[\s\S]*?\[120, 600\]/,
    'initial viewport normalization must yield so canvas-ready/load can make the active frame interactive first',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /html-editor-infinite-canvas-height[\s\S]*?new ResizeObserver/,
    'the isolated runtime must observe layout and report stabilized document height',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /__kodety-vh-control[\s\S]*?Viewport[\s\S]*?type="number"[\s\S]*?pointerdown[\s\S]*?html-editor-viewport-height-simulation/,
    'a selected viewport-height section must expose a draggable, exact-value Viewport handle',
  );
  assert.match(
    infiniteCanvasRuntimeSource,
    /const commitInputHeight[\s\S]*?addEventListener\('change', commitInputHeight\)[\s\S]*?addEventListener\('blur', commitInputHeight\)[\s\S]*?event\.key !== 'Enter'[\s\S]*?commitInputHeight\(\)/,
    'typing an exact simulated viewport height must commit on change, blur and Enter',
  );
  assert.match(
    projectEditorSource,
    /viewportHeightSimulationsRef\.current = \{[\s\S]*?\[breakpointId\]: \{[\s\S]*?\[message\.path\]: message\.height/,
    'section viewport overrides must be scoped by breakpoint plus source path',
  );
  assert.match(
    infiniteCanvasSource,
    /const passiveDocument = useMemo\([\s\S]*?injectInfiniteCanvasPassiveRuntime\(passiveHtml\)[\s\S]*?layout\.frames\.map\(frame => \{[\s\S]*?<HtmlBufferedIframe[\s\S]*?documentKey=\{referenceDocumentKey\}[\s\S]*?loading="eager"[\s\S]*?srcDoc=\{passiveDocument\}/,
    'all reference breakpoints must mount eagerly from one shared lightweight srcdoc',
  );
  assert.doesNotMatch(
    infiniteCanvasSource,
    /passiveHydrationState|mountedPassiveIdSet|requestIdleCallback|Preparando breakpoint/,
    'reference breakpoints must never be hidden behind progressive idle hydration',
  );
  assert.match(
    infiniteCanvasSource,
    /const loadReferenceDocument = \(node: HTMLIFrameElement, loadedKey: string\) => \{[\s\S]*?if \(loadedKey !== referenceDocumentKey\) return[\s\S]*?loadedPassiveIdsRef\.current\.add\(frame\.id\)[\s\S]*?html-editor-infinite-canvas-default-height[\s\S]*?descriptor\.simulatedViewportHeight[\s\S]*?onPassiveFrameLoadRef\.current[\s\S]*?onLoad=\{\(event, loadedKey\) => loadReferenceDocument\(event\.currentTarget, loadedKey\)\}[\s\S]*?onPromote=\{loadReferenceDocument\}/,
    'each eagerly loaded reference must receive its own viewport height without requiring a distinct srcdoc',
  );
  assert.match(
    passiveInfiniteCanvasRuntimeSource,
    /VIEWPORT_VARIABLE[\s\S]*?rewriteViewportValue[\s\S]*?rewriteDeclarations\(style\)[\s\S]*?walkRules[\s\S]*?scrollExtent > physicalHeight/,
    'passive references must rewrite viewport units in-place and measure the complete document without selector matching',
  );
  assert.doesNotMatch(
    passiveInfiniteCanvasRuntimeSource,
    /querySelectorAll\(selector\)|specificity\(/,
    'passive references must not repeat the active editor cascade/specificity scan',
  );
  assert.match(
    passiveInfiniteCanvasRuntimeSource,
    /Object\.entries\(simulations\)[\s\S]*?data-html-editor-path[\s\S]*?VIEWPORT_VARIABLE[\s\S]*?html-editor-viewport-height-simulations/,
    'passive references must preserve per-section viewport simulations through scoped CSS variables',
  );
  assert.match(
    infiniteCanvasSource,
    /activeDocumentCacheRef[\s\S]*?documentKey !== documentKey[\s\S]*?html !== html[\s\S]*?injectInfiniteCanvasRuntime\(html,[\s\S]*?data-infinite-canvas-active-iframe[\s\S]*?<HtmlBufferedIframe[\s\S]*?documentKey=\{`\$\{documentKey\}:active-editor`\}[\s\S]*?sandbox=\{sandbox\}[\s\S]*?srcDoc=\{activeDocument\}/,
    'one buffered editable browsing context must move between frames without navigating when activeId changes',
  );
  assert.match(
    infiniteCanvasSource,
    /const referenceDocumentKey = `\$\{documentKey\}:\$\{descriptor\.id\}:reference`[\s\S]*?<HtmlBufferedIframe[\s\S]*?documentKey=\{referenceDocumentKey\}[\s\S]*?sandbox="allow-scripts"[\s\S]*?srcDoc=\{passiveDocument\}/,
    'reference iframe identity, permissions and srcdoc must remain independent from active selection',
  );
  assert.doesNotMatch(
    infiniteCanvasSource,
    /key=\{[^}]*active\s*\?|srcDoc=\{active\s*\?|sandbox=\{active\s*\?/,
    'clicking a breakpoint must never navigate an iframe by swapping its active/passive props',
  );
  assert.match(
    infiniteCanvasSource,
    /passiveWindowsRef\.current\.forEach[\s\S]*?id !== activeId[\s\S]*?html-editor-infinite-canvas-refresh-height[\s\S]*?html-editor-infinite-canvas-default-height[\s\S]*?onPassiveFrameLoadRef\.current\?\.\(activeIframe, activeId\)/,
    'activation must remap message ownership and replay breakpoint-specific simulation state into the stable bridge',
  );
  assert.match(
    infiniteCanvasSource,
    /useEffect\(\s*\(\) => \(\) => \{[\s\S]*?passiveWindowsRef\.current\.forEach\(\(frameWindow, id\) => \{[\s\S]*?onPassiveFrameRegisterRef\.current\?\.\(frameWindow, false, id\)[\s\S]*?passiveWindowsRef\.current\.clear\(\)[\s\S]*?iframeRef\.current === activeIframeElementRef\.current[\s\S]*?iframeRef\.current = null/,
    'unmounting Infinite Canvas must explicitly release every active and passive browsing context before normal canvas can mount',
  );
  assert.match(
    canvasStageSource,
    /simulatedViewportHeight\s*=\s*descriptor\.id === 'base'[\s\S]*?defaultInfiniteCanvasViewportHeight\(size\.width\)[\s\S]*?height: simulatedViewportHeight,[\s\S]*?simulatedViewportHeight/,
    'responsive frames must derive a device-like default height instead of sharing desktop 1080',
  );
  assert.match(
    infiniteCanvasSource,
    /layout\.frames\.map\(frame => \{[\s\S]*?data-infinite-canvas-frame=\{frame\.id\}[\s\S]*?left: frame\.x,[\s\S]*?top: frame\.y,[\s\S]*?width: frame\.width/,
    'every responsive frame must use the non-overlapping world-plane coordinates',
  );
  assert.match(
    infiniteCanvasSource,
    /const INFINITE_CANVAS_DOT_GAP = 34;[\s\S]*?function infiniteCanvasDotOffset[\s\S]*?Math\.round\(value\)[\s\S]*?backgroundPosition: `\$\{infiniteCanvasDotOffset\(view\.pan\.x\)\}px \$\{infiniteCanvasDotOffset\(view\.pan\.y\)\}px`[\s\S]*?backgroundSize: `\$\{INFINITE_CANVAS_DOT_GAP\}px \$\{INFINITE_CANVAS_DOT_GAP\}px`/,
    'the infinite-canvas dot grid must keep a 40%-larger pixel-aligned screen-space gap at every zoom level',
  );
  assert.doesNotMatch(infiniteCanvasSource, /backgroundSize:[^\n]*view\.zoom/, 'distant zoom levels must never collapse the infinite-canvas dots together');
  assert.match(
    infiniteCanvasSource,
    /data-infinite-canvas-toolbar[\s\S]*?aria-label="Ferramentas do canvas infinito"[\s\S]*?aria-label="Ferramenta de seleção"[\s\S]*?aria-label="Ferramenta de mão"[\s\S]*?aria-label="Desativar canvas infinito"[\s\S]*?aria-label="Afastar canvas"[\s\S]*?aria-label=\{`Zoom do canvas:[\s\S]*?aria-label="Aproximar canvas"/,
    'the infinite toolbar must retain selection, pan, the single active mode button and zoom controls',
  );
  assert.match(
    infiniteCanvasSource,
    /<DropdownMenuItem onClick=\{fit\}>[\s\S]*?<Maximize2 \/> Enquadrar tudo/,
    'infinite-canvas fit must remain available from the zoom menu',
  );
  assert.match(
    infiniteCanvasSource,
    /toolbarHost && createPortal\(\([\s\S]*?data-infinite-canvas-toolbar[\s\S]*?\), toolbarHost\)/,
    'the infinite toolbar must portal into the builder workspace HUD instead of positioning against its world plane',
  );
  assert.match(
    infiniteCanvasSource,
    /const persistedViewKey = `\$\{VIEW_PREFERENCE\}:\$\{viewPreferenceKey\}`[\s\S]*?normalizeInfiniteCanvasView\([\s\S]*?window\.localStorage\.getItem\(persistedViewKey\)[\s\S]*?window\.localStorage\.setItem\(persistedViewKey, JSON\.stringify\(viewRef\.current\)\)/,
    'the tested normalized view must be restored and persisted by the infinite canvas',
  );
  assert.match(
    topbarComponentSource,
    /isPreviewing && !framerRuntimeReadOnly[\s\S]*?className="ml-2 h-8[\s\S]*?onClick=\{leaveFocusedPreview\}[\s\S]*?aria-label="Voltar à edição"/,
    'focused Preview must expose a padded topbar action that returns to editing',
  );
  assert.match(
    projectEditorSource,
    /const notifySharedReadOnly = useCallback[\s\S]*?toast\.info\('Somente leitura'[\s\S]*?id: 'kodety-shared-read-only-attempt'/,
    'shared read-only attempts must use one deduplicated explanatory notification',
  );
  assert.match(
    projectEditorSource,
    /document\.addEventListener\('pointerdown', blockPointer, true\)[\s\S]*?document\.addEventListener\('keydown', blockKeyboard, true\)/,
    'shared read-only feedback must cover blocked pointer and keyboard attempts across every standalone panel',
  );
  assert.match(
    projectEditorSource,
    /findControl[\s\S]*?\[role="tab"\][\s\S]*?control\.closest\('\[data-kodety-read-only-allow="true"\]'\)[\s\S]*?editableControl[\s\S]*?\[role="tab"\]/,
    'shared read-only mode must block mutating tab fields while preserving explicitly allowed navigation tabs',
  );
  assert.match(
    projectEditorSource,
    /sharedReadOnly[\s\S]*?message\.type === 'html-editor-text-change'[\s\S]*?message\.type === 'html-editor-direct-style'[\s\S]*?message\.type === 'html-editor-direct-style-batch'[\s\S]*?message\.type === 'html-editor-move-element'[\s\S]*?notifySharedReadOnly\('A edição visual foi bloqueada neste link\.'\)/,
    'canvas mutations must be blocked with feedback instead of failing silently',
  );
  assert.match(
    projectEditorSource,
    /const leaveFocusedPreview = \(\) => \{[\s\S]*?setIsPreviewing\(false\)/,
    'the Preview back action must restore editing state',
  );
  assert.match(
    projectEditorSource,
    /const enterFocusedPreview = \(requestedViewport: Viewport = viewportRef\.current\) => \{[\s\S]*?materializeCanonicalCanvas\(\)[\s\S]*?topbarWp\?\.editorUrl\s*\|\|\s*'\/kodety\/editor\/'[\s\S]*?kodety-preview-review[\s\S]*?kodety-preview-viewport[\s\S]*?window\.open\('about:blank', '_blank'\)[\s\S]*?previewReviewWindowRef\.current = previewTab[\s\S]*?const savePromise = prepareWorkspacePreview[\s\S]*?prepareWorkspacePreview\(current\)[\s\S]*?saveProjectNow\(\{ notifySuccess: false \}\)[\s\S]*?openPersistedReview/,
    'focused Preview must reserve its tab synchronously and authenticate the live review channel after the silent save',
  );
  assert.match(
    projectEditorSource,
    /const prepareHostedPreview = useCallback\(async \([\s\S]*?reportFailure = true[\s\S]*?if \(reportFailure && !\(error instanceof Error && error\.name === 'AbortError'\)\)[\s\S]*?Não foi possível preparar o link do preview/,
    'hosted-link failures must be opt-in and must never masquerade as a failure to open the already-running visual Preview',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /Não foi possível abrir o preview['"`]/i,
    'closing a successfully opened Preview must not leave the old false opening-failure toast in the code path',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'closing'[\s\S]*?reviewWindow\.closed[\s\S]*?previewReviewWindowRef\.current = null[\s\S]*?previewAbortControllerRef\.current\?\.abort\(\)[\s\S]*?addEventListener\('pagehide', notifyPreviewReviewClosing\)/,
    'closing the review tab must be recognized as normal cancellation and stop its optional hosted-link work',
  );
  assert.equal(
    (canvasStageSource.match(/onPreview=\{enterFocusedPreview\}/g) || []).length,
    2,
    'both normal and active infinite-canvas frame headers must preview their explicit breakpoint',
  );
  assert.match(
    canvasStageSource,
    /onSelectFrame=\{selectCanvasBreakpoint\}[\s\S]*?onPreviewFrame=\{enterFocusedPreview\}/,
    'the infinite canvas must route passive frame play actions directly to focused Preview',
  );
  assert.match(
    breakpointControlSource,
    /onPreview\?\.\(safeActiveId\)[\s\S]*?aria-label=\{`Abrir preview de \$\{active\.label\}`\}/,
    'the normal frame header play control must send its active breakpoint explicitly',
  );
  assert.match(
    breakpointControlSource,
    /agentActivityLabel\?: string \| null[\s\S]*?\{isFrame && !frameAgentActivityLabel && \([\s\S]*?<Play\b[\s\S]*?\{frameAgentActivityLabel && \([\s\S]*?data-agent-canvas-activity[\s\S]*?kodety-agent-frame-dots[\s\S]*?kodety-agent-frame-dot/,
    'the active frame header must replace play, breakpoint name and width with compact Agent copy followed by animated dots',
  );
  assert.match(
    breakpointControlSource,
    /<HtmlBreakpointDeviceIcon[\s\S]*?<ChevronDown className="size-3 text-\[var\(--kodety-accent-hover\)\]\/70"/,
    'the floating breakpoint control must use a meaningful device glyph and a disclosure chevron',
  );
  assert.doesNotMatch(
    breakpointControlSource,
    /Laptop|Tablet|<Plus className="size-3\.5"/,
    'the floating breakpoint control must not reuse duplicate device glyphs or imply that opening the menu always adds a breakpoint',
  );
  assert.match(
    breakpointDeviceIconSource,
    /width >= 1024[\s\S]*?<Monitor[\s\S]*?width >= 600[\s\S]*?<Square[\s\S]*?<Smartphone/,
    'breakpoint device icons must map desktop, tablet, and mobile to distinct Gravity silhouettes',
  );
  assert.match(
    infiniteCanvasSource,
    /onPreviewFrame\?\.\(frame\.id\)[\s\S]*?aria-label=\{`Abrir preview de \$\{descriptor\.label\}`\}/,
    'every passive infinite-canvas frame must expose a play action bound to its own id',
  );
  assert.match(
    projectEditorSource,
    /editorCommandRef\.current = \(command\) => \{[\s\S]*?if \(workspaceReadOnly \|\| isPreviewing\) \{[\s\S]*?return;/,
    'global editing shortcuts must be inert while Preview is focused',
  );
  assert.match(
    topbarAndProjectSource,
    /\{!isPreviewing && workspacePrimaryNavigation\('design'\)\}[\s\S]*?canvasToolbarHost && !isPreviewing && mode === 'design'/,
    'focused Preview must hide the workspace switcher and mutable canvas tools',
  );
  assert.match(
    topbarComponentSource,
    /data-preview-viewport-toolbar[\s\S]*?aria-label="Selecionar dispositivo de preview"[\s\S]*?aria-label="Largura do viewport de preview"[\s\S]*?aria-label="Altura do viewport de preview"[\s\S]*?data-preview-fit[\s\S]*?aria-label="Ajustar preview ao espaço disponível"[\s\S]*?onClick=\{fitCanvas\}/,
    'focused Preview must expose device, width, height, and fit controls',
  );
  assert.match(
    topbarComponentSource,
    /const PREVIEW_CONTROL_SURFACE_CLASS =[\s\S]*?h-8 min-w-0 items-center gap-\[2px\][\s\S]*?rounded-\[8px\][\s\S]*?border border-transparent bg-white\/\[\.05\] p-\[2px\][\s\S]*?focus-within:border-\[var\(--kodety-focus\)\]\/70[\s\S]*?has-\[\[data-state=open\]\]:border-\[var\(--kodety-focus\)\]\/70/,
    'Preview compound controls must share one 32px neutral surface with exact 2px inset/gaps and one tokenized violet focus/open stroke',
  );
  const previewControlSurfaceClass = topbarComponentSource.match(
    /const PREVIEW_CONTROL_SURFACE_CLASS =\s*\n\s*'([^']+)'/,
  )?.[1] || '';
  assert.doesNotMatch(
    previewControlSurfaceClass,
    /(?:^|:)ring|shadow/,
    'the Preview compound surface must express focus through its existing border, never a second ring or glow',
  );
  assert.match(
    topbarComponentSource,
    /data-preview-viewport-toolbar[\s\S]*?role="toolbar"[\s\S]*?max-w-\[calc\(100vw-24rem\)\][\s\S]*?min-\[760px\]:flex[\s\S]*?<DropdownMenuRadioGroup value=\{viewport\}[\s\S]*?data-\[state=checked\]:bg-white\/\[\.035\][\s\S]*?hidden h-full min-w-0 items-center gap-\[2px\] min-\[1040px\]:flex/,
    'Preview viewport selection must stay neutral, truncate safely and collapse its numeric pair on compact topbars',
  );
  assert.match(
    topbarComponentSource,
    /function PreviewToolbarIconButton[\s\S]*?size-\[26px\][\s\S]*?data-preview-viewport-toolbar[\s\S]*?className="flex h-full[\s\S]*?data-preview-status-toolbar[\s\S]*?className="flex h-full/,
    '2px container padding must leave 26px controls without overflowing the 32px Preview surfaces',
  );
  assert.match(
    topbarComponentSource,
    /hidden h-full min-w-0 items-center gap-\[2px\][\s\S]*?<label className="[^"]*rounded-\[6px\][^"]*"[\s\S]*?aria-label="Largura do viewport de preview"[\s\S]*?<label className="[^"]*rounded-\[6px\][^"]*"[\s\S]*?aria-label="Altura do viewport de preview"/,
    'Preview width and height fields must retain the same subtle 6px inner radius as the breakpoint trigger',
  );
  assert.match(
    canvasStageSource,
    /data-runtime-preview-surface[\s\S]*?absolute inset-0 z-10 shadow-none drop-shadow-none[\s\S]*?title="Preview executável do projeto HTML"[\s\S]*?className="block size-full border-0 bg-white shadow-none drop-shadow-none"/,
    'the executable Preview surface and iframe must never add a drop shadow',
  );
  assert.match(
    topbarComponentSource,
    /data-preview-status-toolbar[\s\S]*?role="toolbar"[\s\S]*?max-w-\[min\(16\.25rem,28vw\)\][\s\S]*?data-preview-url[\s\S]*?bg-\[var\(--kodety-success\)\][\s\S]*?max-w-40 truncate min-\[1380px\]:block[\s\S]*?aria-label="Copiar link do preview"[\s\S]*?tooltip="Copiar link do preview"/,
    'Preview status and URL actions must remain one responsive tokenized surface with a labelled copy action',
  );
  const previewViewportMaximum = Number(editorConstantsSource.match(/const MAX_CANVAS_VIEWPORT_WIDTH = (\d+);/)?.[1]);
  assert.ok(previewViewportMaximum >= 5200, 'preview resizing must preserve intentional large canvas widths such as 5120px');
  assert.match(
    canvasStageSource,
    /\{!isPreviewing && !editingHtmlComponent && mode === 'design' && !framerRuntimeReadOnly && !showTimeline && \([\s\S]*?<CanvasChromeWhenCodeClosed>[\s\S]*?<HtmlBreakpointControl/,
    'the editable breakpoint manager must stay out of focused Preview',
  );
  assert.match(
    `${viewportStoreSource}\n${canvasStageSource}`,
    /viewport: ["']base["'][\s\S]*?zoom: initialPreferences\.zoom[\s\S]*?viewportSizes: initialPreferences\.viewportSizes[\s\S]*?canvasAvailableSize: \{ width: 0, height: 0 \}[\s\S]*?useHtmlViewportStore\(state => state\.viewport\)[\s\S]*?useHtmlViewportStore\(state => state\.zoom\)/,
    'viewport and zoom state must be owned and consumed outside the project editor',
  );
  assert.match(
    canvasStageSource,
    /aria-label="Redimensionar largura do viewport pela esquerda"[\s\S]*?startViewportResize\('width', event, -1\)/,
    'focused Preview must support bilateral viewport resizing',
  );
  assert.doesNotMatch(editorChromeOverlaysSource, /HtmlCmsManager|cmsManagerOpen/, 'CMS must stay out of editor overlays so it cannot cover focused Preview');
  assert.match(
    projectEditorSource,
    /if \(appView === 'cms' && cmsConfig\?\.cmsItemsUrl\)[\s\S]*?<HtmlCmsManager[\s\S]*?standalone/,
    'CMS must render as an isolated workspace instead of an editor dialog',
  );
  assert.match(
    leftSidebarSource,
    /className=\{isPreviewing \? 'hidden' : 'contents'\}[\s\S]*?data-editor-panel-region="left"/,
    'focused Preview must remove the navigator and its resize divider from the flex layout',
  );
  assert.match(
    rightSidebarSource,
    /\{!isPreviewing && \([\s\S]*?aria-label="Resize design sidebar"[\s\S]*?data-editor-panel-region="right"[\s\S]*?isPreviewing && 'hidden'/,
    'focused Preview must remove the right resize divider and hide the external Human/Agent panel region',
  );
  assert.match(
    projectEditorSource,
    /\{!isPreviewing && currentTemplatePostType && cmsConfig\?\.cmsItemsUrl && \(/,
    'focused Preview must not reserve canvas height for the CMS editing toolbar',
  );
  assert.match(
    projectEditorSource,
    /if \(appView === 'settings'\)[\s\S]*?<HtmlProjectSettingsStandaloneHost/,
    'project settings must render as an isolated workspace instead of covering focused Preview',
  );
  assert.match(
    editorCodePanelSource,
    /\{showCode\s*&&\s*mode === ["']design["']\s*&&\s*!framerRuntimeReadOnly\s*&&\s*!isPreviewing\s*&&\s*\(/,
    'the code editor must not cover a focused Preview',
  );
  assert.match(
    `${projectEditorSource}\n${pasteCodeComponentDialogSource}`,
    /if \(pastedCodeComponentCandidate\(text\)\) return;[\s\S]*?const pasteCodeComponent = \(event: ClipboardEvent\)[\s\S]*?target\?\.closest[\s\S]*?pastedCodeComponentCandidate[\s\S]*?setValue/,
    'complete TSX clipboard payloads must bypass layer paste and open the dedicated Code Component naming flow without stealing paste from text fields',
  );
  assert.match(
    pasteCodeComponentDialogSource,
    /compileCodeComponentProjectFile\(draft, created\.storagePath, 'Kodety clipboard'\)[\s\S]*?if \(!compiled\.result\.success \|\| !compiled\.result\.componentManifest\)[\s\S]*?commitProject\(draft\)[\s\S]*?openCodeFile\(storagePath\)[\s\S]*?commitProject\(compiled\.project\)/,
    'clipboard creation must retain failed TSX only as an editable draft and register only a fully compiled project',
  );
  assert.match(
    pasteCodeComponentDialogSource,
    /Criar Code Component do clipboard[\s\S]*?code-components\/[\s\S]*?\.tsx[\s\S]*?linha destacada em vermelho/,
    'the paste dialog must offer a filename and explain compiler feedback before creation',
  );
  assert.match(
    pasteCodeComponentDialogSource,
    /flex min-w-0 items-center[\s\S]*?shrink-0 whitespace-nowrap pl-3[\s\S]*?code-components\/[\s\S]*?min-w-0 flex-1[\s\S]*?shrink-0 whitespace-nowrap pr-3[\s\S]*?\.tsx/,
    'the Code Component filename prefix, editable stem and suffix must remain on one line',
  );
  assert.match(
    `${editorCodePanelSource}\n${codeEditorSource}`,
    /diagnosticLines=[\s\S]*?item\.line[\s\S]*?focusDiagnostic[\s\S]*?border-red-400\/90 bg-red-500\/15/,
    'compiler diagnostics must paint source lines red and remain clickable in the Code Component editor',
  );
  assert.match(
    motionTimelineSource,
    /!showTimeline \|\|[\s\S]*?props\.mode !== 'design' \|\|[\s\S]*?props\.workspaceReadOnly \|\|[\s\S]*?props\.isPreviewing \|\|[\s\S]*?props\.editingLocalizedPage/,
    'the motion timeline must not cover a focused Preview',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /data-tooltip="Fit canvas"|aria-label="Alternar canvas infinito"/,
    'fit and canvas-mode controls must no longer occupy the editor topbar',
  );
  assert.match(
    canvasStageSource,
    /canvasToolbarHost && !isPreviewing[\s\S]*?createPortal\(\([\s\S]*?data-canvas-mode-toolbar[\s\S]*?aria-label="Ferramentas do canvas"[\s\S]*?aria-label="Abrir ferramentas de inserção"[\s\S]*?CANVAS_INSERT_OPTIONS\.map[\s\S]*?data-tooltip=\{canvasDesignTool === 'text-block' \? 'Cancelar Text \(Esc\)' : 'Text \(T\)'\}[\s\S]*?>T<\/span>[\s\S]*?\{!editingHtmlComponent && infiniteCanvasBetaEnabled && \([\s\S]*?onClick=\{\(\) => changeInfiniteCanvasEnabled\(true\)\}[\s\S]*?aria-label="Ativar Canvas Infinito Beta instável"[\s\S]*?role="tablist"[\s\S]*?aria-label="Breakpoints principais"[\s\S]*?mainCanvasBreakpointTabs\.map[\s\S]*?selectCanvasBreakpoint\(tab\.id\)[\s\S]*?data-tooltip="Ajustar canvas"[\s\S]*?aria-label="Enquadrar canvas"[\s\S]*?\), canvasToolbarHost\)/,
    'the canvas HUD must use a clear T and place fit after the primary breakpoints while gating Infinite Canvas behind Beta',
  );
  assert.match(
    canvasStageSource,
    /data-canvas-mode-toolbar[\s\S]*?bg-\[var\(--kodety-panel\)\][\s\S]*?shadow-none/,
    'the canvas toolbar must share the Layers panel background without a popover shadow',
  );
  assert.match(
    realtimeInspectorSource,
    /title="Attributes"[\s\S]*?size="sm" variant="input"[\s\S]*?<Plus \/> Add attribute<\/YcodeButton>/,
    'the add-attribute action must keep the same vertical button sizing as Link',
  );
  assert.match(
    editorConstantsSource,
    /const MAIN_CANVAS_BREAKPOINT_TABS = \[[\s\S]*?id: 'base', label: 'Desktop'[\s\S]*?id: 'tablet', label: 'Tablet'[\s\S]*?id: 'mobile', label: 'Mobile'[\s\S]*?id: 'wide', label: 'Wide'[\s\S]*?id: 'notebook', label: 'Notebook'[\s\S]*?\] as const/,
    'the normal-canvas tabs must list only the five main breakpoints in the intended UX order',
  );
  assert.match(
    canvasStageSource,
    /data-tooltip="Canvas infinito · Beta instável"[\s\S]*?<Frames \/>[\s\S]*?tab\.icon === 'mobile'[\s\S]*?<Smartphone \/>[\s\S]*?tab\.icon === 'tablet'[\s\S]*?<Square \/>[\s\S]*?tab\.icon === 'notebook'[\s\S]*?<Notebook \/>[\s\S]*?tab\.icon === 'wide'[\s\S]*?<WideScreen \/>[\s\S]*?<Monitor \/>/,
    'the normal canvas HUD must use distinct, meaningful Gravity icons for canvas mode and every breakpoint family',
  );
  assert.doesNotMatch(
    canvasStageSource,
    /Infinity as InfinityIcon|<MonitorUp \/>|<Tablet \/>|<Laptop \/>/,
    'the canvas HUD must not reuse mobile for tablet, a chart for Wide, or a disconnected infinity glyph',
  );
  assert.match(
    editorProjectAndConstantsSource,
    /const MOBILE_BUILDER_MEDIA_QUERY = '\(max-width: 767px\), \(max-height: 767px\) and \(pointer: coarse\)'[\s\S]*?useLayoutEffect\(\(\) => \{[\s\S]*?appView !== 'editor'[\s\S]*?matchMedia\(MOBILE_BUILDER_MEDIA_QUERY\)[\s\S]*?addEventListener\('change', synchronize\)/,
    'the Builder mobile gate must react to portrait and landscape phone viewports without affecting standalone panels',
  );
  assert.match(
    projectEditorSource,
    /if \(appView === 'editor' && mobileBuilderBlocked\) \{[\s\S]*?data-mobile-builder-gate[\s\S]*?Abra o Builder no desktop[\s\S]*?Settings, CMS, Membership, Analytics e outros painéis continuam disponíveis no celular/,
    'only the visual editor view must show the desktop-only message on mobile',
  );
  assert.match(
    editorProjectAndConstantsSource,
    /const CANVAS_HUD_TOOLTIP_CLASS = '[^']*bottom-\[calc\(100%\+8px\)\][^']*content-\[attr\(data-tooltip\)\][^']*hover:after:opacity-100[^']*focus-visible:after:opacity-100'[\s\S]*?data-tooltip="Canvas infinito · Beta instável"[\s\S]*?data-tooltip=\{tab\.label\}[\s\S]*?data-tooltip="Ajustar canvas"/,
    'every normal-canvas HUD icon must expose a styled tooltip above the toolbar on hover and keyboard focus',
  );
  assert.match(canvasStageSource, /onInfiniteCanvasChange=\{changeInfiniteCanvasEnabled\}/, 'the infinite canvas toolbar must receive the shared mode switch');
  assert.match(
    projectEditorSource,
    /setInfiniteCanvasEnabled\(false\)[\s\S]*?writeLocalPreference\(INFINITE_CANVAS_PREFERENCE, 'false'\)/,
    'Infinite Canvas must never reactivate itself from an older local preference',
  );
  assert.match(
    projectEditorSource,
    /infiniteCanvasLoadingGenerationRef\.current = shouldTrack \? generation : ''[\s\S]*?infiniteCanvasLoadingExpectedRef\.current = shouldTrack[\s\S]*?new Set\(ids\)[\s\S]*?setInfiniteCanvasLoadingVisible\(shouldTrack\)/,
    'each infinite-canvas document generation must start one logical loading session for its breakpoint ids',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-infinite-canvas-height'[\s\S]*?markInfiniteCanvasBreakpointMeasured\(breakpointId, message\.generation\)[\s\S]*?message\.type === 'html-editor-canvas-ready'[\s\S]*?markInfiniteCanvasActiveReady\(message\.generation\)/,
    'canvas loading must track real measurements and the editable bridge instead of using fake progress',
  );
  assert.match(
    projectEditorSource,
    /const activeLoaded = infiniteCanvasLoadingLoadedRef\.current\.has\(activeId\)[\s\S]*?const complete = activeLoaded[\s\S]*?infiniteCanvasLoadingActiveReadyRef\.current/,
    'the full-screen loader must leave as soon as the editable frame is usable instead of waiting for progressively hydrated references',
  );
  const infiniteCanvasLoadingMaxMs = Number(editorConstantsSource.match(/const INFINITE_CANVAS_LOADING_MAX_MS = (\d+);/)?.[1] || Number.NaN);
  assert.ok(
    Number.isFinite(infiniteCanvasLoadingMaxMs) && infiniteCanvasLoadingMaxMs <= 1000,
    'the initial Infinite Canvas loading cover must fail open within one second',
  );
  assert.match(
    projectEditorSource,
    /Math\.max\(0, INFINITE_CANVAS_LOADING_MIN_MS - elapsed\)[\s\S]*?\}, INFINITE_CANVAS_LOADING_MAX_MS\)/,
    'canvas loading may finish progressively but must never add a fixed delay after the editable frame is ready',
  );
  assert.match(
    canvasStageSource,
    /onActiveFrameLoad=\{\(\) => \{[\s\S]*?markInfiniteCanvasBreakpointLoaded\([\s\S]*?onPassiveFrameLoad=\{\(frame, id\) => \{[\s\S]*?id !== viewportRef\.current[\s\S]*?markInfiniteCanvasBreakpointLoaded/,
    'loading progress must count the editable active frame and each passive reference exactly once',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /<KodetyLoadingScreen[\s\S]*?label="Carregando breakpoints do Canvas"/,
    'Infinite Canvas must mount progressively without covering the editable surface',
  );
  assert.match(
    kodetyLoadingScreenSource,
    /M51\.1932 122L0 61L113\.183 94\.8289V122H51\.1932Z[\s\S]*?M51\.1932 0L0 61L113\.183 27\.1711V0H51\.1932Z/,
    'the reusable loading screen must preserve the supplied Kodety SVG mark',
  );
  assert.match(
    kodetyLoadingScreenSource,
    /role="progressbar"[\s\S]*?aria-valuenow=\{normalizedProgress\}[\s\S]*?width: `\$\{normalizedProgress\}%`/,
    'determinate loading must expose and render its real percentage accessibly',
  );
  assert.doesNotMatch(
    bufferedIframeSource,
    /initialVisualSettled|onInitialVisualSettled/,
    'visible images and fonts must never keep a hidden readiness gate alive after the iframe can paint',
  );
  assert.doesNotMatch(
    `${projectEditorSource}\n${canvasStageSource}`,
    /wordpressInitialCanvasReady|handleEditorCanvasInitialVisualSettled|onInitialVisualSettled/,
    'the /editor route must hand off to the progressively painted canvas without a second full-screen cover',
  );
  assert.match(
    projectEditorSource,
    /singleType === 'replaceSelectionHtml'[\s\S]*?singlePagePath === current\.mainHtmlPath[\s\S]*?commitLiveStructure\([\s\S]*?operation: 'replace'[\s\S]*?remapPathAfterReplace/,
    'a focused Agent replacement must update the already painted canvas instead of rebuilding its iframe',
  );
  assert.match(
    previewSource,
    /const applyLiveElementReplace[\s\S]*?liveMarkupRoot\(message\.markup, path\)[\s\S]*?target\.replaceWith\(root\)[\s\S]*?reapplyEditorLiveState\(root\)[\s\S]*?event\.data\.operation === 'replace'[\s\S]*?applyLiveElementReplace/,
    'the canvas bridge must apply safe single-root Agent replacements in place and preserve editor state',
  );
  assert.match(
    editorLiveDomHelpersSource,
    /function remapPathAfterReplace[\s\S]*?path === replacedPath[\s\S]*?path\.startsWith[\s\S]*?operation === 'replace'[\s\S]*?getElementOuterHtml\(source, path\)/,
    'Agent replacements must retain root identity, discard stale descendant state and remain live-undoable',
  );
  assert.match(
    editorLiveDomHelpersSource,
    /function canvasLiveBodyReplacement[\s\S]*?semanticHeadMarkup\(before\) !== semanticHeadMarkup\(after\)[\s\S]*?operation: 'replace-body'[\s\S]*?agentActivityPathsForHtmlChange/,
    'whole-page Agent edits must use a safe live body projection while executable shell changes keep the canonical fallback',
  );
  assert.match(
    projectEditorSource,
    /canvasLiveBodyReplacement\([\s\S]*?const inverse = liveStructureInverse\(beforeRenderedSource, liveBody\.message\);[\s\S]*?const canvasSynchronized = synchronizeLiveStructure\([\s\S]*?nextRenderedSource,[\s\S]*?liveBody\.message,[\s\S]*?\(\) => null,[\s\S]*?\);[\s\S]*?editorSourceRef\.current = nextRenderedSource;[\s\S]*?commitProject\(next, true, !canvasSynchronized, false\);[\s\S]*?const committedProject = projectRef\.current;[\s\S]*?if \([\s\S]*?canvasSynchronized[\s\S]*?&& inverse[\s\S]*?&& committedProject[\s\S]*?&& committedProject !== current[\s\S]*?\) \{[\s\S]*?liveHistoryTransitionsRef\.current\.set\(committedProject,[\s\S]*?previous: current,[\s\S]*?forward: \{[\s\S]*?source: nextRenderedSource,[\s\S]*?message: liveBody\.message,[\s\S]*?remapPath: \(\) => null,[\s\S]*?backward: \{ source: beforeRenderedSource, \.\.\.inverse \},/,
    'safe Agent page snapshots must commit source/history while preserving the mounted canvas browsing context',
  );
  assert.match(
    projectEditorSource,
    /else if \(canvasAlreadySynchronized && !pendingCanvasLiveStructuresRef\.current\.size\) \{[\s\S]*?canvasAppliedRevisionRef\.current = projectRevisionRef\.current;[\s\S]*?\} else \{[\s\S]*?canvasCanonicalFallbackTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*?canvasRevisionNeedsCanonicalRecovery\([\s\S]*?canvasAppliedRevisionRef\.current,[\s\S]*?projectRevisionRef\.current,[\s\S]*?pendingCanvasLiveStructuresRef\.current\.size,[\s\S]*?forceCanonicalCanvasRefresh\(\);[\s\S]*?CANVAS_CANONICAL_FALLBACK_MS/,
    'posted Agent page snapshots must await an exact ACK and retain the canonical fail-safe',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /commitProject\(next, true, !canvasSynchronized, canvasSynchronized\)/,
    'posting an Agent page snapshot must not be treated as its canvas acknowledgement',
  );
  assert.match(
    previewSource,
    /const agentActivityController[\s\S]*?kodety-agent-shine[\s\S]*?::after[\s\S]*?conic-gradient[\s\S]*?ResizeObserver[\s\S]*?sectionIds[\s\S]*?MutationObserver[\s\S]*?setTargets[\s\S]*?html-editor-agent-activity/,
    'Agent and MCP targets must render a restrained perimeter shine and track sections plus live canvas layout changes',
  );
  assert.match(
    `${projectEditorSource}\n${previewSource}`,
    /agentActive: agentTurnActiveRef\.current[\s\S]*?data-html-editor-agent-selection-active[\s\S]*?--kodety-direct-selection-color: #a78bfa[\s\S]*?event\.data\.agentActive === true/,
    'the native selection outline, handles and size badge must switch from mint to lilac while the Agent owns the active turn',
  );
  assert.match(
    previewSource,
    /const applyLiveDocumentBodyReplace[\s\S]*?annotateLiveInsertedTree[\s\S]*?insertBefore\(fragment, anchor\)[\s\S]*?reapplyEditorLiveState[\s\S]*?operation === 'replace-body'/,
    'the canvas runtime must replace authored body roots in place without removing its editor bridge',
  );
  assert.match(
    agentBridgeStoreSource,
    /activityTargets[\s\S]*?turnActivity[\s\S]*?markActivity[\s\S]*?startTurnActivity[\s\S]*?updateTurnActivity[\s\S]*?finishTurnActivity/,
    'Agent target and turn activity must stay centralized for canvas-wide feedback',
  );
  assert.match(
    agentPanelSource,
    /method === 'turn\/started'[\s\S]*?startTurnActivity[\s\S]*?method === 'turn\/completed'[\s\S]*?toast\.success[\s\S]*?finishTurnActivity[\s\S]*?clearActivity/,
    'Agent activity must start with the turn, notify after applied mutations and clear on completion',
  );
  assert.match(
    wordpressEditorShellSource,
    /<body class="kodety-wordpress-editor">[\s\S]*?class="kodety-boot-loader"[\s\S]*?class="kodety-boot-loader__mark"[\s\S]*?class="kodety-boot-loader__track"/,
    'the shared WordPress shell must paint the branded loader before React starts on every app tab',
  );
  assert.match(
    wordpressEditorCssSource,
    /\.kodety-boot-loader[\s\S]*?background: #050505;[\s\S]*?\.kodety-boot-loader__fill[\s\S]*?kodety-loading-bar-scan/,
    'the pre-React loader must match the branded black screen and animated line',
  );
  assert.match(
    canvasStageSource,
    /\{infiniteCanvasEnabled && !isPreviewing && \([\s\S]*?data-persistent-infinite-page-canvas[\s\S]*?aria-hidden=\{editingHtmlComponent \|\| undefined\}[\s\S]*?<HtmlInfiniteCanvas[\s\S]*?\{\(!infiniteCanvasEnabled \|\| isPreviewing \|\| editingHtmlComponent\) && \([\s\S]*?ref=\{canvasScrollRef\}/,
    'the extracted canvas stage must preserve the infinite page canvas while hiding it beneath the component studio, and mount the focused canvas only when needed',
  );
  assert.match(
    projectEditorSource,
    /if \(infiniteCanvasEnabled && !isPreviewing\) \{\s*infiniteCanvasRef\.current\?\.fit\(\);\s*return;\s*\}/,
    'Fit canvas must target the infinite toolbar plane only while that branch is active',
  );
  assert.match(
    topbarSource,
    /onClick=\{\(\) => enterFocusedPreview\(\)\}[\s\S]*?aria-label="Abrir Preview"[\s\S]*?<Play\b/,
    'the extracted topbar must enter Preview through an accessible play control',
  );
  assert.match(
    topbarSource,
    /aria-label="Altura do viewport de preview"[\s\S]*?aria-label="Recarregar preview"[\s\S]*?onClick=\{refreshFocusedPreview\}[\s\S]*?<RefreshCw/,
    'focused Preview must expose a reload control immediately after viewport height',
  );
  assert.match(
    projectEditorSource,
    /const refreshFocusedPreview = \(\) => \{[\s\S]*?forceCanonicalCanvasRefresh\(\);[\s\S]*?previewReviewModeRef\.current[\s\S]*?type: 'refresh'/,
    'the reload control must recreate the visible runtime iframe even inside the dedicated review tab',
  );
  const globalCssSource = await readFile(path.join(root, 'app/globals.css'), 'utf8');
  assert.match(
    globalCssSource,
    /@keyframes kodety-automation-shine[\s\S]*?\.kodety-automation-activity::after[\s\S]*?prefers-reduced-motion[\s\S]*?\.kodety-automation-activity::after/,
    'the shared Agent/MCP HUD must use a clean shine pass with a reduced-motion resting state',
  );
  assert.match(
    globalCssSource,
    /@keyframes kodety-agent-frame-dot-wave[\s\S]*?\.kodety-agent-frame-dots[\s\S]*?\.kodety-agent-frame-dot[\s\S]*?prefers-reduced-motion[\s\S]*?\.kodety-agent-frame-dot/,
    'the frame-level Agent status must pulse and oscillate its lilac dots while honoring reduced motion',
  );
  assert.match(
    globalCssSource,
    /\[data-kodety-logo-menu\][\s\S]*?background:\s*var\(--kodety-panel\)[\s\S]*?dropdown-menu-item[\s\S]*?min-height:\s*32px[\s\S]*?background:\s*rgb\(255 255 255 \/ 6\.5%\)[\s\S]*?dropdown-menu-separator[\s\S]*?background:\s*var\(--kodety-divider\)/,
    'the Kodety logo menu must keep neutral compact rows, canonical panel color and tokenized separators',
  );
  const settingsPanelSource = await readFile(path.join(root, 'app/(builder)/kodety/components/SettingsPanel.tsx'), 'utf8');
  const htmlInspectorWidthSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'), 'utf8');
  const propertyInspectorSource = await readFile(path.join(root, 'packages/property-inspector/src/index.tsx'), 'utf8');
  const inputSource = await readFile(path.join(root, 'components/ui/input.tsx'), 'utf8');
  const inputGroupSource = await readFile(path.join(root, 'components/ui/input-group.tsx'), 'utf8');
  const tabsSource = await readFile(path.join(root, 'components/ui/tabs.tsx'), 'utf8');
  const sliderSource = await readFile(path.join(root, 'components/ui/slider.tsx'), 'utf8');
  const cmsManagerSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsManager.tsx'), 'utf8');
  const cmsCsvImportSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsCsvImport.tsx'), 'utf8');
  const agentComposerCssSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAgentComposer.module.css'), 'utf8');
  assert.match(
    globalCssSource,
    /:where\([\s\S]*?body:has\(\.kodety-editor-main\)[\s\S]*?\) \{[\s\S]*?--kodety-accent: #9393ff;[\s\S]*?--kodety-accent-hover: #afafff;[\s\S]*?--kodety-accent-foreground: #ffffff;[\s\S]*?--kodety-focus: #9393ff;/,
    'the Kodety palette must use the approved base and light tones and reach body-level portals',
  );
  assert.match(
    globalCssSource,
    /@keyframes kodety-community-invite[\s\S]*?rotate\(-11deg\)[\s\S]*?rotate\(9deg\)[\s\S]*?data-kodety-community-link[\s\S]*?560ms[\s\S]*?prefers-reduced-motion: reduce/,
    'the Discord invite must use a polished lateral rotation cue and respect reduced-motion preferences',
  );
  assert.match(
    globalCssSource,
    /--color-blue-400: #afafff;[\s\S]*?--color-blue-500: #9393ff;[\s\S]*?--color-sky-400: #afafff;[\s\S]*?--color-sky-500: #9393ff;/,
    'Tailwind blue and sky utilities in the product chrome must inherit the Kodety palette',
  );
  assert.match(
    globalCssSource,
    /--kodety-accent-muted: rgb\(147 147 255 \/ 0\.14\);[\s\S]*?--kodety-accent-border: rgb\(147 147 255 \/ 0\.28\);/,
    'informational accent surfaces must share the approved 14% fill and 28% border tokens',
  );
  assert.match(
    globalCssSource,
    /\[data-kodety-project-settings\] :is\(p, \[data-kodety-settings-description\]\),[\s\S]*?text-wrap: balance;/,
    'Project Settings descriptions must balance their lines instead of leaving orphaned words',
  );
  assert.match(
    agentComposerCssSource,
    /\.skillPill \{[\s\S]*?border: 1px solid rgb\(175 175 255 \/ 0\.25\);[\s\S]*?background: rgb\(147 147 255 \/ 0\.13\);[\s\S]*?color: var\(--kodety-accent-hover\);/,
    'Agent skill pills must use a translucent accent surface with a light label instead of a solid accent fill',
  );
  assert.doesNotMatch(
    agentComposerCssSource,
    /#22d3ee|#a5f3fc/i,
    'Agent drag feedback must stay inside the Kodety palette instead of reintroducing cyan chrome',
  );
  assert.match(
    settingsPanelSource,
    /<ChevronRight[\s\S]*?isOpen && 'rotate-90'/,
    'inspector sections must use the shared simple chevron',
  );
  assert.doesNotMatch(settingsPanelSource, /triangle-right/, 'inspector sections must not regress to filled triangle disclosure icons');
  assert.match(
    settingsPanelSource,
    /--inspector-control-label-width': 'var\(--html-design-control-label-width, 88px\)'[\s\S]*?grid-cols-\[var\(--inspector-control-label-width\)_minmax\(0,1fr\)\]/,
    'shared Design rows must derive their label column from one width contract while retaining the 88px fallback',
  );
  assert.match(
    htmlInspectorWidthSource,
    /data-html-design-property-widths[\s\S]*?--html-design-control-label-width': '72px'[\s\S]*?--html-design-control-label-width': '88px'[\s\S]*?<HtmlKodetyPositionControls[\s\S]*?data-ycode-style-controls[\s\S]*?<HtmlKodetyLayoutControls[\s\S]*?<HtmlKodetySpacingControls/,
    'Design property sections must share the compact 72px label contract while Position retains its explicit 88px spatial-control width',
  );
  assert.match(inputSource, /bg-transparent border-border\/70/, 'configuration inputs must use a transparent surface with a one-pixel border');
  assert.match(inputGroupSource, /border-border\/70 bg-transparent/, 'configuration input groups must blend into the panel instead of adding a gray fill');
  assert.match(
    inputGroupSource,
    /focus-within:border-ring[\s\S]*?focus-within:ring-2[\s\S]*?focus-visible:border-transparent[\s\S]*?focus-visible:bg-transparent[\s\S]*?focus-visible:ring-0/,
    'compound fields must draw one rounded focus surface on the group and suppress the inner rectangular input ring',
  );
  assert.match(tabsSource, /data-slot="tabs-list"[\s\S]*?'[^'\n]*bg-input text-muted-foreground/, 'tab and segmented controls must retain their filled surface');
  assert.match(
    sliderSource,
    /data-slot="slider-track"[\s\S]*?radial-gradient\(circle at center[\s\S]*?backgroundSize: '11px 100%'[\s\S]*?data-slot="slider-range"[\s\S]*?bg-\[var\(--kodety-accent\)\]\/\[\.62\][\s\S]*?data-slot="slider-thumb"[\s\S]*?border-0 bg-white\/60 shadow-none[\s\S]*?focus-visible:ring-\[var\(--kodety-focus\)\]\/35[\s\S]*?h-4 w-\[2px\]/,
    'every shared Builder slider must retain its dotted track, visible accent range and narrow high-contrast thumb',
  );
  assert.doesNotMatch(
    sliderSource,
    /data-slot="slider-range"[\s\S]{0,240}?bg-(?:primary|blue)|data-slot="slider-thumb"[\s\S]{0,320}?(?:ring-ring|bg-primary|border-(?:primary|blue))/,
    'the shared slider must use Builder tokens rather than unrelated primary/blue utility colors',
  );
  assert.match(
    globalCssSource,
    /\.kodety-builder-range[\s\S]*?::-webkit-slider-runnable-track[\s\S]*?height: 3px;[\s\S]*?background: rgb\(255 255 255 \/ 25%\);[\s\S]*?::-webkit-slider-thumb[\s\S]*?width: 12px;[\s\S]*?height: 12px;[\s\S]*?background: #ffffff;[\s\S]*?::-moz-range-track,[\s\S]*?::-moz-range-progress[\s\S]*?::-moz-range-thumb/,
    'native Builder ranges must match the shared neutral slider in Chromium, Safari and Firefox',
  );
  assert.equal(
    (projectSettingsSource.match(/type="range"/g) || []).length,
    (projectSettingsSource.match(/className="kodety-builder-range/g) || []).length,
    'every native range in Settings must use the Builder slider contract',
  );
  assert.equal(
    (cmsManagerSource.match(/type="range"/g) || []).length,
    (cmsManagerSource.match(/className="kodety-builder-range/g) || []).length,
    'every native range in CMS must use the Builder slider contract',
  );
  assert.match(
    cmsManagerSource,
    /CmsSearchControl[\s\S]*?CmsEmptyState[\s\S]*?data-kodety-cms-manager[\s\S]*?w-\[232px\][\s\S]*?FolderWithFilesIcon/,
    'the CMS workspace must keep its compact collection navigation, search and empty-state design system',
  );
  assert.doesNotMatch(cmsManagerSource, /CMS_VIEW_OPTIONS|CmsIntegrationCard|view === 'plugins'/, 'Plugins must remain outside the CMS content workspace');
  assert.match(
    cmsManagerSource,
    /HtmlSettingsFieldControl[\s\S]*?HtmlSettingsToggleControl[\s\S]*?data-kodety-cms-surface/,
    'CMS authored fields, toggles and portalled surfaces must use the shared Settings control grammar',
  );
  assert.match(
    cmsCsvImportSource,
    /data-kodety-cms-surface[\s\S]*?HtmlSettingsFieldControl[\s\S]*?data-kodety-cms-card/,
    'CSV import must remain inside the CMS surface and card system instead of falling back to legacy controls',
  );
  assert.match(
    globalCssSource,
    /:is\(\[data-kodety-cms-manager\], \[data-kodety-cms-surface\]\)[\s\S]*?--kodety-cms-control-fill:[\s\S]*?text-wrap: balance;[\s\S]*?body:has\(\[data-kodety-cms-manager\]\)[\s\S]*?z-index: 100;/,
    'CMS controls, balanced descriptions and portalled menus must retain their scoped visual and stacking contracts',
  );
  assert.match(
    globalCssSource,
    /:is\([\s\S]*?\[data-slot=["']input-group["']\]:not\([\s\S]*?\[data-ycode-native-ui\][\s\S]*?\[data-slot=["']select-trigger["']\]:not\([\s\S]*?\[data-variant=["']default["']\][\s\S]*?background-color: transparent !important;[\s\S]*?border-color: color-mix[\s\S]*?!important/,
    'legacy fields in every configuration surface must remain transparent without overriding the native Ycode control skin',
  );
  assert.doesNotMatch(
    globalCssSource,
    /\.kodety-editor-design-sidebar\s+:is\([^)]*\[data-slot=["']input-group["']\][\s\S]{0,240}?\)\s*\{\s*background-color:\s*transparent/,
    'transparent configuration fields must not be limited to the Builder inspector',
  );
  assert.match(
    globalCssSource,
    /\[data-slot=["']tabs-list["']\]:not\([\s\S]*?\[data-ycode-native-ui\][\s\S]*?color-mix\([\s\S]*?var\(--foreground\) 5%[\s\S]*?transparent[\s\S]*?\[data-slot=["']tabs-trigger["']\]:not\([\s\S]*?\[data-ycode-native-ui\][\s\S]*?\[data-state=["']active["']\][\s\S]*?border-color: transparent[\s\S]*?color-mix\([\s\S]*?var\(--foreground\) 13%[\s\S]*?transparent[\s\S]*?color: var\(--kodety-text/,
    'the selected legacy tab must use the quiet filled surface and light label without overriding native Ycode tabs',
  );
  assert.doesNotMatch(propertyInspectorSource, /stroke-width:1\.35/, 'sidebar glyphs must retain the native Gravity weight used by Layers');
  assert.match(
    propertyInspectorSource,
    /--accent-muted:color-mix\(in srgb,var\(--accent\) 14%,transparent\);--accent-border:color-mix\(in srgb,var\(--accent\) 28%,transparent\)[\s\S]*?\.cpi-segmented button\[data-active=true\]\{background:var\(--accent-muted\);color:var\(--accent-hover\);box-shadow:inset 0 0 0 1px var\(--accent-border\)\}/,
    'the code-component inspector must render selected segments as contextual accent surfaces rather than solid fills',
  );
  assert.match(
    propertyInspectorSource,
    /cpi-section-chevron[\s\S]*?<ChevronRight className="cpi-section-chevron"/,
    'the code-component inspector must share the same simple disclosure chevron',
  );
  assert.match(
    layersTreeSource,
    /data-drag-active=\{isDragActive\}[\s\S]*?locked[\s\S]*?"cursor-not-allowed"[\s\S]*?!solidAccentSelection && "opacity-60"[\s\S]*?isDragging && "opacity-40"/,
    'the extracted layer tree must expose drag state while preserving selectable and locked row affordances',
  );
  assert.doesNotMatch(layersTreeSource, /cursor-grab active:cursor-grabbing/, 'layer rows must not advertise dragging before the user starts the gesture');
  assert.match(
    globalCssSource,
    /\.kodety-editor-main\[data-previewing=["']true["']\] \.kodety-editor-workspace \{[\s\S]*?min-width: 0(?:\s*!important)?;/,
    'focused Preview must not retain the compact editor workspace minimum width',
  );
  const inspectorSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'), 'utf8');
  assert.match(
    inspectorSource,
    /function BooleanAttributeRow[\s\S]*?<HtmlSettingsToggleControl[\s\S]*?label=\{label\}[\s\S]*?description=\{description\}[\s\S]*?checked=\{checked\}[\s\S]*?onChange=\{onChange\}/,
    'described boolean controls must delegate their label, description, state and change contract to the shared settings control',
  );
  const builderSourceFiles = await collectSourceFiles(path.join(root, 'app/(builder)/kodety'));
  const nativeColorInputFiles = [];
  for (const sourceFile of builderSourceFiles) {
    const sourceText = await readFile(sourceFile, 'utf8');
    if (/type\s*=\s*["']color["']/.test(sourceText)) {
      nativeColorInputFiles.push(path.relative(root, sourceFile));
    }
  }
  assert.deepEqual(nativeColorInputFiles, [], 'every Builder color field must open the shared custom ColorPicker instead of the browser-native picker');
  const positionControlsSource = await readFile(path.join(root, 'app/(builder)/kodety/components/PositionControls.tsx'), 'utf8');
  assert.match(
    inspectorSource,
    /kodety-editor-inspector-tabs[\s\S]*?>Style<\/TabsTrigger>[\s\S]*?>Settings<\/TabsTrigger>[\s\S]*?>Interactions<\/TabsTrigger>/,
    'the Inspector must keep the horizontal Style, Settings and Interactions navigation inside its compact pill rail',
  );
  assert.doesNotMatch(inspectorSource, /<TabsTrigger[^>]*value="agent"/, 'Agent must not be moved into the Style, Settings and Interactions tab group');
  assert.match(
    rightSidebarSource,
    /<HtmlHumanAgentToggle value=\{panelMode\} onChange=\{setPanelMode\} inspectorAvailable=\{!framerRuntimeReadOnly\} \/>[\s\S]*?<HtmlDesignTokenProvider[\s\S]*?\{inspector\}[\s\S]*?<HtmlAgentPanel visible=\{!isPreviewing && panelMode === 'agent'\} onNavigate=\{onNavigate\} \/>/,
    'the existing Human/Agent switch and Agent body must remain outside and above the Inspector tabs',
  );
  assert.match(
    inspectorSource,
    /const elementInteractionsPanel = \([\s\S]*?<HtmlInteractionsPanel[\s\S]*?onOpenEffectsLibrary=\{onOpenEffectsLibrary\}[\s\S]*?<TabsContent value="interactions"[\s\S]*?\{componentInteractions \|\| \([\s\S]*?\{elementInteractionsPanel\}/,
    'the Interactions tab must retain the complete Kodety HtmlInteractionsPanel body',
  );
  assert.match(
    inspectorSource,
    /data-html-inspector-selection-context[\s\S]*?<HtmlClassSelector[\s\S]*?>State<\/span>[\s\S]*?<Select[\s\S]*?<SelectTrigger[\s\S]*?!bg-white\/\[\.05\]/,
    'Classes and State must remain above the transplanted Ycode fields without an authoring-mode switch',
  );
  assert.match(
    inspectorSource,
    /<AdvancedStylePanel[\s\S]*?title="Code Overrides"[\s\S]*?title="Fluid Responsive"/,
    'Code Overrides must render immediately below Custom CSS and before Fluid Responsive in Style',
  );
  assert.equal(
    (inspectorSource.match(/title="Code Overrides"/g) ?? []).length,
    1,
    'attached CSS and JavaScript must render once as Code Overrides instead of remaining in Settings',
  );
  assert.doesNotMatch(inspectorSource, /title="Arquivos anexados"/, 'the former attached-files group title must be removed');
  assert.equal(
    (inspectorSource.match(/<AdvancedStylePanel\b/g) ?? []).length,
    1,
    'Custom CSS must render only once, inside Style, and never be duplicated in Settings',
  );
  assert.ok(
    inspectorSource.indexOf('<AdvancedStylePanel') < inspectorSource.indexOf('data-html-inspector-settings-scroll'),
    'Custom CSS must remain before the Settings tab content boundary',
  );
  assert.equal((inspectorSource.match(/title="Fluid Responsive"/g) ?? []).length, 1, 'the Style inspector must render Fluid Responsive only once');
  assert.match(
    inspectorSource,
    /const isBodySelected = selection\.tag\.toLowerCase\(\) === 'body'[\s\S]*?\{isBodySelected && \([\s\S]*?title="Text Selection"[\s\S]*?title="Scrollbar"[\s\S]*?<AdvancedStylePanel[\s\S]*?title="Code Overrides"[\s\S]*?\{isBodySelected && <SettingsPanel[\s\S]*?title="Fluid Responsive"/,
    'Text Selection, Scrollbar and Fluid Responsive must render only while Body is selected',
  );
  assert.match(
    inspectorSource,
    /function AdvancedStylePanel[\s\S]*?const \[open, setOpen\] = useState\(false\)[\s\S]*?const \[openSections, setOpenSections\] = useState<Record<string, boolean>>\(\{[\s\S]*?'Scroll Section': false[\s\S]*?'Seleção de texto': false[\s\S]*?'Barra de rolagem': false[\s\S]*?'Code Overrides': false[\s\S]*?'Fluid Responsive': false/,
    'all auxiliary Design sections must start collapsed',
  );
  const defaultOpenDesignControls = [
    ['SpacingControls.tsx', /const \[isOpen, setIsOpen\] = useState\(true\)/],
    ['SizingControls.tsx', /const \[isOpen, setIsOpen\] = useState\(true\)/],
  ];
  for (const [fileName, defaultOpenPattern] of defaultOpenDesignControls) {
    const controlSource = await readFile(path.join(root, 'app/(builder)/kodety/components', fileName), 'utf8');
    assert.match(controlSource, defaultOpenPattern, `${fileName} must start open in the Design inspector`);
  }
  const preservedClosedDesignControls = [
    'TypographyControls.tsx',
    'BackgroundsControls.tsx',
    'BorderControls.tsx',
    'EffectControls.tsx',
    'TransformControls.tsx',
    'TransitionControls.tsx',
    'PositionControls.tsx',
  ];
  for (const fileName of preservedClosedDesignControls) {
    const controlSource = await readFile(path.join(root, 'app/(builder)/kodety/components', fileName), 'utf8');
    assert.match(
      controlSource,
      /const \[(?:sectionOpen|isOpen), (?:setSectionOpen|setIsOpen)\] = useState\(false\)[\s\S]*?\bcollapsible\b/,
      `${fileName} must use the collapsed-by-default Ycode section chrome`,
    );
  }
  assert.doesNotMatch(
    inspectorSource,
    /\b(?:HtmlLayoutControls|HtmlSpacingControls|HtmlStylesControls|HtmlVisibilityControl)\b/,
    'the removed Kodety replacement panels must not remain imported, rendered or commented beside the Ycode controls',
  );
  const knownStylePropertiesSource = inspectorSource.match(/const KNOWN_STYLE_PROPERTIES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  for (const property of [
    'border-top-left-radius',
    'border-bottom-right-radius',
    'border-top-width',
    'border-left-width',
    'outline-width',
    'outline-style',
    'outline-color',
    'outline-offset',
  ]) {
    assert.match(
      knownStylePropertiesSource,
      new RegExp(`['"]${property}['"]`),
      `${property} must stay owned by its transplanted Ycode control instead of duplicating in custom CSS`,
    );
  }
  for (const property of [
    'visibility',
    'overflow-x',
    'overflow-y',
    'user-select',
    'mix-blend-mode',
    'image-rendering',
    'mask-image',
    'pointer-events',
    'outline',
    '-webkit-tap-highlight-color',
    'white-space',
    'margin',
    'padding',
    'filter',
    'backdrop-filter',
    'transform',
    'transition',
  ]) {
    assert.doesNotMatch(
      knownStylePropertiesSource,
      new RegExp(`['"]${property}['"]`),
      `${property} must remain visible and removable in custom CSS when no complete Ycode control owns it`,
    );
  }
  const inspectorControlOrder = [
    'HtmlKodetyPositionControls',
    'HtmlKodetyLayoutControls',
    'HtmlKodetySelfLayoutControls',
    'HtmlKodetySpacingControls',
    'HtmlKodetySizingControls',
    'HtmlKodetyTypographyControls',
    'HtmlKodetyBackgroundsControls',
    'HtmlKodetyBorderControls',
    'HtmlKodetyEffectControls',
    'HtmlKodetyTransformControls',
    'HtmlKodetyTransitionControls',
  ];
  let previousInspectorControlIndex = -1;
  for (const controlName of inspectorControlOrder) {
    const controlPattern = new RegExp(`<${controlName}\\b`, 'g');
    const matches = inspectorSource.match(controlPattern) ?? [];
    assert.equal(matches.length, 1, `${controlName} must render exactly once in Style`);
    const controlIndex = inspectorSource.indexOf(`<${controlName}`);
    assert.ok(controlIndex > previousInspectorControlIndex, `${controlName} must retain the Ycode control order after the preserved Position panel`);
    previousInspectorControlIndex = controlIndex;
  }
  const overlayDesignPanelIndex = inspectorSource.indexOf('{overlayDesignPanel}');
  const typographyControlIndex = inspectorSource.indexOf('<HtmlKodetyTypographyControls');
  const backgroundsControlIndex = inspectorSource.indexOf('<HtmlKodetyBackgroundsControls');
  assert.ok(
    overlayDesignPanelIndex > typographyControlIndex && backgroundsControlIndex > overlayDesignPanelIndex,
    'the Kodety overlay controls must remain available between typography and background properties',
  );
  assert.match(
    inspectorSource,
    /<HtmlKodetyTransformControls[\s\S]*?<HtmlKodetyTransitionControls[\s\S]*?<SettingsPanel\s+title="Scroll Section"[\s\S]*?onClick=\{\(\) => onScrollSectionApply\(scrollSectionId, Number\(scrollOffsetY\) \|\| 0\)\}/,
    'Scroll Section must remain in Style after the transform and transition controls and preserve its save behavior',
  );
  assert.equal((inspectorSource.match(/title="Scroll Section"/g) ?? []).length, 1, 'Scroll Section must be removed from Settings instead of being duplicated');
  const overlayMenuAnchor = inspectorSource.indexOf('className="w-64 space-y-1 rounded-xl border-border/80 p-1.5 shadow-2xl"');
  const overlayMenuStart = inspectorSource.lastIndexOf('<YcodePopoverContent', overlayMenuAnchor);
  const overlayMenuEnd = inspectorSource.indexOf('</YcodePopoverContent>', overlayMenuAnchor);
  const overlayCreationMenu =
    overlayMenuAnchor >= 0 && overlayMenuStart >= 0 && overlayMenuEnd >= 0 ? inspectorSource.slice(overlayMenuStart, overlayMenuEnd) : '';
  assert.ok(overlayCreationMenu, 'the overlay creation menu must remain available');
  assert.doesNotMatch(overlayCreationMenu, /<Layers3/, 'the overlay menu must use clean text-only options without decorative icons');
  assert.match(
    positionControlsSource,
    /activeInsetSides[\s\S]*?activeInsets[\s\S]*?Computed inset measurements change[\s\S]*?const toggleInset = \(side: InsetSide\)[\s\S]*?activeInsets\.has\(side\)[\s\S]*?next\.delete\(side\)[\s\S]*?updateDesignProperty\('positioning', side, null\)[\s\S]*?changeInset\(side, isInsetActive\(displayedValue\) \? displayedValue : '0', true\)[\s\S]*?const activateAllInsets = \(\)[\s\S]*?setActiveInsets\(new Set\(INSET_SIDES\)\)[\s\S]*?updateDesignProperties\(INSET_SIDES\.map/,
    'each Absolute/Fixed pin must toggle independently from its computed measurement while the center only reactivates all sides',
  );
  assert.match(
    positionControlsSource,
    /data-position-inset-diagram[\s\S]*?grid-cols-\[minmax\(0,1fr\)_64px_minmax\(0,1fr\)\][\s\S]*?data-position-inset-side="top"[\s\S]*?activeInsets\.has\('top'\)[\s\S]*?data-position-inset-side="right"[\s\S]*?activeInsets\.has\('right'\)[\s\S]*?data-position-inset-side="bottom"[\s\S]*?activeInsets\.has\('bottom'\)[\s\S]*?data-position-inset-side="left"[\s\S]*?activeInsets\.has\('left'\)[\s\S]*?aria-label="Ancorar em todos os lados"[\s\S]*?onClick=\{activateAllInsets\}/,
    'the compact anchor diagram must expose four combinable side toggles and one apply-all center button',
  );
  assert.match(
    inspectorSource,
    /<HtmlKodetyPositionControls[\s\S]*?values=\{styleValues\}[\s\S]*?authoredValues=\{explicitStyles\}/,
    'Position must receive authored declarations separately from computed inset measurements',
  );
  assert.match(
    htmlKodetyStyleControlsSource,
    /function authoredInsetSides[\s\S]*?Object\.hasOwn\(values, side\)[\s\S]*?<PositionControls[\s\S]*?\{\.\.\.adapter\}[\s\S]*?activeInsetSides=\{authoredInsetSides\(props\.authoredValues\)\}/,
    'the HTML adapter must derive active pins only from authored inset declarations',
  );
  assert.match(
    positionControlsSource,
    /STICKY_OPTIONAL_SIDES: InsetSide\[\] = \['bottom', 'left', 'right'\][\s\S]*?position === 'sticky'[\s\S]*?Adicionar offset ao Sticky/,
    'Sticky must start with Top and expose Bottom, Left and Right through its add control',
  );
  assert.match(
    positionControlsSource,
    /!showInsetDiagram && positionSelect[\s\S]*?position === 'sticky'[\s\S]*?showInsetDiagram && positionSelect/,
    'Relative and Sticky must keep Type compact while Absolute and Fixed place Type beneath the inset diagram',
  );
  const globalInspectorTabsCssStart = globalCssSource.indexOf(
    '[data-slot="tabs-list"]:not(',
    globalCssSource.indexOf('/* Inspector navigation uses'),
  );
  const globalInspectorTabsCssEnd = globalCssSource.indexOf('/* Page-transition navigation', globalInspectorTabsCssStart);
  const globalInspectorTabsCss =
    globalInspectorTabsCssStart >= 0 && globalInspectorTabsCssEnd > globalInspectorTabsCssStart
      ? globalCssSource.slice(globalInspectorTabsCssStart, globalInspectorTabsCssEnd)
      : '';
  const wordpressInspectorTabsCssStart = wordpressEditorCssSource.indexOf(
    '[data-slot="tabs-list"]:not([data-ycode-native-ui], [data-ycode-native-ui] *).kodety-editor-inspector-tabs',
  );
  const wordpressInspectorTabsCssEnd = wordpressEditorCssSource.indexOf(
    'body.kodety-wordpress-editor :is(\n  [data-slot="dropdown-menu-content"]:not(',
    wordpressInspectorTabsCssStart,
  );
  const wordpressInspectorTabsCss =
    wordpressInspectorTabsCssStart >= 0 && wordpressInspectorTabsCssEnd > wordpressInspectorTabsCssStart
      ? wordpressEditorCssSource.slice(wordpressInspectorTabsCssStart, wordpressInspectorTabsCssEnd)
      : '';
  for (const [surface, inspectorTabsCss, activeSelector] of [
    ['Builder', globalInspectorTabsCss, '[data-state="active"]'],
    ['WordPress', wordpressInspectorTabsCss, '[data-state="active"]'],
  ]) {
    assert.ok(inspectorTabsCss, `${surface} must define the scoped Inspector pill tabs`);
    assert.match(
      inspectorTabsCss,
      /kodety-editor-inspector-tabs\s*\{[\s\S]*?height:\s*42px;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent !important;/,
      `${surface} Inspector tabs must use a compact transparent 42px rail without a stroke`,
    );
    assert.match(
      inspectorTabsCss,
      /> \[data-slot=(?:'|")tabs-trigger(?:'|")\][\s\S]*?flex:\s*0\s+0\s+auto;[\s\S]*?height:\s*32px;[\s\S]*?border-radius:\s*(?!0)[^;]+;/,
      `${surface} Inspector labels must remain compact auto-width 32px pills with rounded corners`,
    );
    assert.match(
      inspectorTabsCss,
      /border-bottom:\s*0;[\s\S]*?\[data-state=(?:'|")active(?:'|")\][\s\S]*?border-bottom-color:\s*transparent;/,
      `${surface} Inspector tabs must explicitly suppress the rail divider and active underline`,
    );
    const activeRule = inspectorTabsCss.match(new RegExp(`${activeSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.match(activeRule, /background(?:-color)?:\s*(?!transparent(?:\s|!|;))[^;]+;/, `${surface} active Inspector tab must use a visible neutral fill`);
    assert.match(activeRule, /box-shadow:\s*none;/, `${surface} active Inspector tab must not draw a decorative stroke`);
    assert.match(activeRule, /color:\s*var\(--kodety-text(?:,|\))/, `${surface} active Inspector tab must keep a neutral foreground`);
    assert.doesNotMatch(
      activeRule,
      /kodety-accent|#(?:9393ff|afafff)|147\s+147\s+255/i,
      `${surface} active Inspector tab must not use the purple accent palette`,
    );
  }
  const cmsBindingsSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsBindings.tsx'), 'utf8');
  assert.match(
    cmsBindingsSource,
    /data-cms-connected=\{active \? 'true' : 'false'\}[\s\S]*?active \? 'text-\[var\(--kodety-accent\)\][\s\S]*?\[&_svg\]:text-\[var\(--kodety-accent\)\]'/,
    'an active CMS field binding must use the Kodety accent for the connection icon',
  );
  assert.match(
    inspectorSource,
    /blockReadOnlyControl[\s\S]*?\[role="tab"\][\s\S]*?closest\('\[data-kodety-read-only-allow="true"\]'\)[\s\S]*?aria-label="Inspector panels"[\s\S]*?data-kodety-read-only-allow="true"/,
    'the inspector must block segmented tab fields in read-only mode without blocking panel navigation',
  );
  assert.match(
    leftSidebarSource,
    /data-builder-sidebar-rail[\s\S]*?<HtmlNavigatorRailTab[\s\S]*?panel="layers"[\s\S]*?<HtmlNavigatorRailTab[\s\S]*?panel="pages"[\s\S]*?<HtmlNavigatorRailTab[\s\S]*?panel="assets"/,
    'the extracted navigator rail controls must keep Layers, Pages and Assets available to read-only users',
  );
  assert.match(
    navigatorSource,
    /NAVIGATOR_RAIL_LABELS[\s\S]*?layers:\s*"Layers"[\s\S]*?pages:\s*"Pages"[\s\S]*?assets:\s*"Assets"[\s\S]*?data-tooltip=\{label\}/,
    'the navigator rail tabs must expose accessible icon tooltips',
  );
  assert.match(
    wordpressEditorCssSource,
    /\[data-kodety-read-only="true"\][\s\S]*?\[role="tab"\][\s\S]*?\[data-kodety-read-only-allow="true"\][\s\S]*?\[role="tab"\]/,
    'mutating tabs must advertise their read-only cursor while navigation tabs remain usable',
  );
  const designTokenUiSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlDesignTokens.tsx'), 'utf8');
  const radiusControlSource = await readFile(path.join(root, 'app/(builder)/kodety/components/RadiusValueControl.tsx'), 'utf8');
  const iconSource = await readFile(path.join(root, 'components/ui/icon.tsx'), 'utf8');
  const colorPickerSource = await readFile(path.join(root, 'app/(builder)/kodety/components/ColorPicker.tsx'), 'utf8');
  const htmlInspectorColorPickerSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/ColorPicker.tsx'), 'utf8');
  const localizationManagerSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlLocalizationManager.tsx'), 'utf8');
  const selectSource = await readFile(path.join(root, 'components/ui/select.tsx'), 'utf8');
  assert.match(
    inspectorSource,
    /useHtmlStylePreviewTransaction\(\{[\s\S]*?onCommit: onStyleChange,[\s\S]*?onPreview: onStylePreview,[\s\S]*?onCancel: onStylePreviewCancel,[\s\S]*?scopeKey:[\s\S]*?const onVisualStyleChange = stylePreviewTransaction\.change/,
    'the inspector must route one scoped visual transaction to preview, rollback and final source commit',
  );
  assert.match(
    inspectorSource,
    /const setInspectorRootRef[\s\S]*?stylePreviewTransaction\.rootRef\(node\)[\s\S]*?designTokenConnector\.rootRef\(node\)[\s\S]*?ref=\{setInspectorRootRef\}[\s\S]*?\{\.\.\.stylePreviewTransaction\.interactionProps\}[\s\S]*?<HtmlKodetyPositionControls[\s\S]*?onChange=\{onVisualStyleChange\}[\s\S]*?<HtmlKodetyLayoutControls[\s\S]*?onChange=\{onVisualStyleChange\}[\s\S]*?<HtmlKodetySpacingControls[\s\S]*?onChange=\{onVisualStyleChange\}[\s\S]*?<HtmlKodetyTypographyControls[\s\S]*?onChange=\{onVisualStyleChange\}/,
    'visual controls must share the transaction interaction boundary instead of committing every scrub sample',
  );
  assert.match(
    colorPickerSource,
    /data-slot="color-picker-trigger"[\s\S]*?border border-border\/70[\s\S]*?data-slot="color-picker-trigger"[\s\S]*?border border-border\/70/,
    'both compact and full color triggers must participate in the stronger floating-panel stroke contract',
  );
  assert.match(
    colorPickerSource,
    /popoverContentClassName\?: string[\s\S]*?popoverSide\?: 'top' \| 'right' \| 'bottom' \| 'left'[\s\S]*?popoverAlign\?: 'start' \| 'center' \| 'end'[\s\S]*?<PopoverContent[\s\S]*?data-design-token-ui[\s\S]*?popoverContentClassName[\s\S]*?side=\{popoverSide\}[\s\S]*?align=\{popoverAlign\}/,
    'the shared color picker must expose an elevated, positionable portaled surface that remains part of the design-token UI',
  );
  assert.match(selectSource, /bg-transparent !px-3 py-1/, 'select triggers must keep horizontal padding even under WordPress admin button resets');
  assert.match(selectSource, /xs: 'h-6 text-xs !px-3 py-1'/, 'compact select triggers must retain the same protected horizontal inset');
  assert.match(
    localizationManagerSource,
    /\{settings\.locales\.length\}<\/span>/,
    'the locale counter must include the source locale already listed in the panel',
  );
  assert.doesNotMatch(localizationManagerSource, /\{targetLocales\.length\}<\/span>/, 'the locale counter must not report only translation targets');
  assert.match(
    inspectorSource,
    /function SelectOptionsEditor[\s\S]*?data-select-options-editor[\s\S]*?aria-label=\{`Edit option[\s\S]*?aria-label=\{`Remove option[\s\S]*?>Add…</,
    'native select options must use the compact edit/remove/add list instead of expanded fields for every item',
  );
  assert.match(
    inspectorSource,
    /<PopoverContent[\s\S]*?side="left"[\s\S]*?label="Valor"[\s\S]*?label="Title"[\s\S]*?label="Habilitada"[\s\S]*?label="Default"/,
    'clicking a select option must open the Framer-style detail editor with value, title, enabled and default controls',
  );
  assert.match(
    inspectorSource,
    /if \(patch\.selected === true\) return \{ \.\.\.option, selected: false \}/,
    'making one option the default must clear the previous default',
  );
  assert.match(
    inspectorSource,
    /scrollSections=\{linkPages\.find\(page => page\.path === currentPage\)\?\.sections \|\| \[\]\}/,
    'the interaction panel must receive the current page Scroll Sections for its trigger dropdown',
  );
  const inspectorScrollRegionIndex = inspectorSource.indexOf('data-html-inspector-scroll-region');
  const inspectorSelectionContextIndex = inspectorSource.indexOf('data-html-inspector-selection-context');
  const inspectorScrollablePanelsIndex = inspectorSource.indexOf('<SettingsPanel', inspectorSelectionContextIndex);
  const inspectorScrollRegionEndIndex = inspectorSource.indexOf('</TabsContent>', inspectorScrollRegionIndex);
  assert.ok(
    inspectorScrollRegionIndex >= 0 &&
      inspectorSelectionContextIndex > inspectorScrollRegionIndex &&
      inspectorScrollablePanelsIndex > inspectorSelectionContextIndex &&
      inspectorScrollRegionEndIndex > inspectorScrollablePanelsIndex,
    'the selection/CSS context must scroll in the same inspector region as the design panels instead of remaining pinned above them',
  );
  assert.doesNotMatch(
    inspectorSource.slice(inspectorSelectionContextIndex, inspectorScrollablePanelsIndex),
    /\b(?:sticky|fixed)\b/,
    'the selection/CSS context must not regain sticky or fixed positioning',
  );
  assert.match(
    inspectorSource,
    /data-css-rule-context-control className="hidden" aria-hidden="true"[\s\S]*?tabIndex=\{-1\}[\s\S]*?title="Arquivo CSS e breakpoint desta regra"/,
    'the technical CSS file/property summary must remain hidden and outside keyboard navigation in the visual inspector',
  );
  assert.match(
    inspectorSource,
    /const prefersSettings = Boolean\([\s\S]*?componentControls[\s\S]*?'input'[\s\S]*?useEffect\(\(\) => \{[\s\S]*?setActiveTab\(current => current === 'interactions' \? current : 'settings'\)[\s\S]*?settingsScrollRef\.current\?\.scrollTo\(\{ top: 0, behavior: 'auto' \}\)/,
    'interactive elements must prefer Settings without ejecting an author who is working in Interactions',
  );
  assert.match(
    inspectorSource,
    /ref=\{settingsScrollRef\}[\s\S]*?data-html-inspector-settings-scroll[\s\S]*?className="[^"]*\bflex\b[^"]*\bflex-col\b/,
    'the Settings inspector must expose a vertically ordered scroll region',
  );
  assert.match(
    inspectorSource,
    /data-ycode-settings-panel[\s\S]*?label="ID"[\s\S]*?label="Tag"[\s\S]*?label="Tracking ID"[\s\S]*?ariaLabel="Title"[\s\S]*?title="Element"[\s\S]*?ariaLabel="Content"[\s\S]*?title=\{selection\.tag === 'a' \? 'Link Button Container' : 'Button Container'\}/,
    'Settings must use the native Ycode surface and keep core Element/Content fields before element-specific modules',
  );
  assert.doesNotMatch(inspectorSource, /order-\[-(?:20|30)\]/, 'Settings must not reorder element-specific modules ahead of the Ycode Element header');
  assert.doesNotMatch(
    inspectorSource.slice(
      inspectorSource.indexOf('<TabsContent value="design"'),
      inspectorSource.indexOf('</TabsContent>', inspectorSource.indexOf('<TabsContent value="design"')),
    ),
    /\{componentControls\}/,
    'advanced component controls must not remain buried in the Design tab',
  );
  assert.doesNotMatch(inspectorSource, /TabsTrigger[\s\S]*?value="variables"[\s\S]*?>Variables</, 'Variables must not consume a permanent Inspector tab');
  assert.match(
    leftSidebarSource,
    /data-variables-panel-trigger[\s\S]*?aria-controls="html-editor-variables-panel"[\s\S]*?<Tuning2Icon \/>[\s\S]*?variablesPanelOpen \? \([\s\S]*?<HtmlDesignTokenPanel/,
    'the extracted sidebar Variables action must open the same left overlay slot used by Insert',
  );
  assert.match(
    designTokenUiSource,
    /id="html-editor-variables-panel"[\s\S]*?absolute inset-y-0 left-0 z-\[80\][\s\S]*?border-\[var\(--kodety-divider\)\][\s\S]*?bg-\[var\(--kodety-panel\)\]/,
    'the Variables workspace must use the canonical attached-panel surface and divider',
  );
  const tokenEditorSource = designTokenUiSource.slice(
    designTokenUiSource.indexOf('function TokenEditor('),
    designTokenUiSource.indexOf('export function HtmlDesignTokenManager('),
  );
  assert.doesNotMatch(
    tokenEditorSource,
    /<select\b|<Input\b|max-w-\[calc\(50%-4px\)\]/,
    'the Variables editor must not fall back to native selects, generic Inputs, or an arbitrary half-width color field',
  );
  assert.match(
    tokenEditorSource,
    /<DesignTokenTextControl[\s\S]*?<VisualSelectControl[\s\S]*?contentDataDesignTokenUi[\s\S]*?<VisualMeasurementControl[\s\S]*?inputMode=\{draft\.type === 'duration' \? 'text' : 'decimal'\}/,
    'the Variables editor must reuse the custom compound text, select, and scrub-capable measurement controls',
  );
  assert.match(
    tokenEditorSource,
    /<ColorPicker[\s\S]*?value=\{draft\.value\}[\s\S]*?popoverContentClassName="z-\[620\]"[\s\S]*?popoverSide="right"[\s\S]*?popoverAlign="start"[\s\S]*?triggerClassName="[^"]*border-transparent[^"]*focus-visible:!border-\[var\(--kodety-focus\)\]\/70[^"]*"[\s\S]*?onClear=\{\(\) => onChange\(\{ \.\.\.draft, value: 'transparent' \}\)\}[\s\S]*?solidOnly/,
    'the Variables color editor must fill its column, use one tokenized focus stroke, and clear to transparency',
  );
  assert.match(
    designTokenUiSource,
    /function DesignTokenIconAction[\s\S]*?<Tooltip>[\s\S]*?aria-label=\{label\}[\s\S]*?function DesignTokenTextControl[\s\S]*?focus-within:border-\[var\(--kodety-focus\)\]\/70[\s\S]*?border-l border-white\/\[\.055\]/,
    'Variables icon actions need tooltips while compound text fields retain one focus owner and embedded actions',
  );
  assert.doesNotMatch(
    designTokenUiSource,
    /data-design-token-ui[\s\S]{0,500}?bg-black\/\[0\.08\]/,
    'the Variables workspace must share the standard Builder panel background',
  );
  assert.match(
    designTokenUiSource,
    /data-design-token-property[\s\S]*?Conectar \$\{target\.property\} a uma variável[\s\S]*?Criar nova variável/,
    'compatible visual fields must expose the hover dot/plus connector and inline creation flow',
  );
  assert.match(
    designTokenUiSource,
    /'\[data-design-token-section\], \[data-slot="inspector-section"\]'[\s\S]*?section\.dataset\.designTokenSection[\s\S]*?DESIGN_TOKEN_SECTION_ALIASES\[context\.section\]/,
    'variable inference must recognize semantic Ycode sections as well as the legacy Inspector wrapper',
  );
  assert.match(
    designTokenUiSource,
    /DESIGN_TOKEN_SECTION_ALIASES[\s\S]*?borders: 'border'[\s\S]*?sizing: 'size'[\s\S]*?transforms: 'transform'[\s\S]*?transitions: 'transition'/,
    'Ycode plural panel titles must resolve to the canonical CSS inference sections',
  );
  const designTokenConnectorSelectors = designTokenUiSource.slice(
    designTokenUiSource.indexOf('const DESIGN_TOKEN_INTERACTIVE_SELECTOR'),
    designTokenUiSource.indexOf('interface ConnectorTarget'),
  );
  assert.doesNotMatch(
    designTokenConnectorSelectors,
    /\[role="slider"\]/,
    'variable connectors must stay on value fields and never attach to a Radix slider thumb',
  );
  assert.equal(
    designTokenConnectorSelectors.match(/:not\(\[type="range"\]\)/g)?.length,
    2,
    'native range sliders must also be excluded from variable discovery and connected strokes',
  );
  assert.match(
    designTokenUiSource,
    /controlRect\.right - 16[\s\S]*?fixed z-\[580\] size-8[\s\S]*?group\/token grid size-8[\s\S]*?createPortal\(overlayContent, globalThis\.document\.body\)/,
    'the variable connector must keep a 32px bridged hit area around its small viewport-portaled dot',
  );
  assert.match(
    designTokenUiSource,
    /event\.target\.closest\('\[data-design-token-ui\]'\)[\s\S]*?cancelLeave\(\)[\s\S]*?if \(!match\) \{[\s\S]*?scheduleLeave\(\)[\s\S]*?document\.addEventListener\('scroll', closeOnGeometryChange, true\)[\s\S]*?window\.addEventListener\('resize', closeFloatingConnector\)/,
    'the variable dot must keep its hover bridge alive, disappear after leaving it and close on scroll or resize instead of floating',
  );
  assert.match(
    designTokenUiSource,
    /Desconectar e manter \{boundToken\.value\}<\/span>[\s\S]*?Criar nova variável<\/span>/,
    'variable connector actions must stay on one line and truncate long values with an ellipsis',
  );
  assert.match(
    designTokenUiSource,
    /designTokenIdFromReference\(styleValues\[connectedProperty\][\s\S]*?data-design-token-connected[\s\S]*?MutationObserver/,
    'fields bound to project variables must retain a connected marker as inspector controls change',
  );
  assert.match(
    designTokenUiSource,
    /function designTokenStrokeTarget[\s\S]*?owner\.closest<HTMLElement>\('\.kodety-radius-control__field'\)[\s\S]*?owner\.closest<HTMLElement>\('\[data-slot="input-group"\]'\)[\s\S]*?function connectorTargetForControl[\s\S]*?control\.closest<HTMLElement>\([\s\S]*?'\.kodety-radius-control__field, \[data-slot="input-group"\], \[data-design-token-control\]'[\s\S]*?\) \|\| control/,
    'variable strokes and connector geometry must follow the complete compound field instead of its inner input',
  );
  assert.match(
    designTokenUiSource,
    /data-design-token-managed-readonly[\s\S]*?openConnectedActions[\s\S]*?Editar no painel de Variáveis[\s\S]*?Desconectar e manter/,
    'connected fields must be read-only and offer edit-variable or disconnect actions on click',
  );
  assert.match(
    designTokenUiSource,
    /editTokenId[\s\S]*?normalized\.tokens\.find[\s\S]*?setCollectionId\(token\.collectionId\)[\s\S]*?setDraft\(\{/,
    'opening a connected variable must navigate the Variables panel directly to its editor',
  );
  assert.match(
    globalCssSource,
    /\[data-design-token-connected=["']true["']\][\s\S]*?border-color:\s*rgb\(139 92 246 \/ 60%\)(?:\s*!important)?;/,
    'variable-bound fields must render a persistent violet stroke at 60% opacity',
  );
  assert.match(
    radiusControlSource,
    /label: 'TL'[\s\S]*?label: 'TR'[\s\S]*?label: 'BL'[\s\S]*?label: 'BR'[\s\S]*?mode === 'all'[\s\S]*?selectMode\('individual'\)[\s\S]*?grid-cols-2 grid-rows-2[\s\S]*?selectMode\('all'\)/,
    'radius must switch between one unified value and a spatial TL/TR/BL/BR corner grid',
  );
  assert.match(
    radiusControlSource,
    /data-kodety-radius-field[\s\S]*?<RadiusMetric[\s\S]*?designTokenProperty=\{designTokenProperties\?\.all\}[\s\S]*?<button[\s\S]*?individualBorders[\s\S]*?grid-cols-2 grid-rows-2[\s\S]*?corners\.map/,
    'radius must be a fully custom compound field with native inputs and mode buttons isolated from shared control sizing',
  );
  assert.match(
    radiusControlSource,
    /kodety-radius-control grid min-w-0 grid-cols-3 items-start[\s\S]*?flex h-8 min-w-0 items-center[\s\S]*?col-span-2/,
    'radius must align its label and compound editor on the shared three-column Design grid',
  );
  assert.doesNotMatch(
    radiusControlSource,
    /<Input\b|<Button\b|data-slot="input-group"/,
    'radius must not inherit Input, Button or generic input-group styling',
  );
  assert.match(
    iconSource,
    /individualBorders:\s*Gravity\.Circles4Square/,
    'individual radius mode must use a four-corner glyph instead of the generic frame icon',
  );
  assert.match(
    inspectorSource,
    /const customProperties = Object\.fromEntries\([\s\S]*?property\.startsWith\('--'\)[\s\S]*?designTokenCssName\(token\.id\)[\s\S]*?const visualValue = stripImportantPriority\(value\)\.trim\(\)[\s\S]*?resolveInspectorCustomProperties\(visualValue, customProperties\)/,
    'visual controls must remove CSS priority and resolve effective custom-property values without rewriting authored bindings',
  );
  assert.match(
    radiusControlSource,
    /designTokenProperty=\{designTokenProperties\?\.all\}/,
    'the unified radius field must expose its compatible design-token target',
  );
  assert.doesNotMatch(
    radiusControlSource,
    /data-design-token-property=\{designTokenProperties\?\.\[corner\.key\]\}/,
    'individual radius fields must not render variable bullets over their compact corner inputs',
  );
  assert.match(
    htmlInspectorColorPickerSource,
    /useOptionalColorVariableCapability\(\)[\s\S]*?useColorVariableCapabilitySnapshot\(colorVariableCapability\)[\s\S]*?kind === 'html-design-tokens'[\s\S]*?title=\{usesProjectVariables \? 'Variáveis de cor'/,
    'the actual Inspector color popover must list shared project Variables instead of its legacy store',
  );
  assert.match(
    htmlInspectorColorPickerSource,
    /colorVariableReference\(result\.id, usesProjectVariables[\s\S]*?colorVariableReference\(varId, usesProjectVariables/,
    'solid and gradient choices in the actual Inspector picker must persist native project variable references',
  );
  assert.match(
    inspectorSource,
    /import ColorPicker from '@\/app\/\(builder\)\/kodety\/html-editor\/ycode-style\/ColorPicker'/,
    'the tested project-token picker must be the same implementation mounted by the HTML Inspector',
  );
  assert.match(
    await readFile(path.join(root, 'app/(builder)/kodety/components/FontPicker.tsx'), 'utf8'),
    /data-slot="select-trigger"[\s\S]*?data-variant="default"/,
    'the font picker trigger must expose the same connected-variable stroke target as other inspector fields',
  );
  assert.match(
    projectEditorSource,
    /const changeDesignTokens = useCallback[\s\S]*?commitProject\(next, true, false\);[\s\S]*?enqueueCanvasLiveStyle\(\{\s*designTokenCssText: serializeHtmlDesignTokenCss\(normalized\)/,
    'token edits must enter the revisioned live-style transaction instead of claiming the canvas is already synchronized',
  );
  assert.match(
    canvasViewStateSource,
    /designTokenCssText: string \| undefined[\s\S]*?snapshotCanvasViewState[\s\S]*?designTokenCssText !== undefined[\s\S]*?latestCanvasViewStateDelta[\s\S]*?transaction\.designTokenCssText !== undefined/,
    'design-token mutations must live in the authoritative snapshot and incremental delta used by every canvas',
  );
  assert.match(
    previewBridgeSource,
    /const applyCanvasViewDesignTokens[\s\S]*?data-kodety-design-tokens[\s\S]*?learnCustomPropertiesFromStyleElement\(style\)[\s\S]*?canvasViewDesignTokenCssText = normalized\.designTokenCssText/,
    'the canvas must apply token CSS and refresh its variable catalog directly from the one-way View State projection',
  );
  assert.match(
    projectEditorSource,
    /const persistLocalizationDraft = useCallback[\s\S]*?window\.setTimeout\([\s\S]*?persistExactLocalizationDraft\(\s*nextProject,\s*pending\.workspaceEpoch,\s*pending\.projectId,\s*pending\.authoredProject,?\s*\)[\s\S]*?}, TEXT_EDIT_AUTOSAVE_IDLE_MS\)/,
    'rapid translation edits must coalesce and resolve only after the latest WordPress snapshot ACK',
  );
  assert.match(
    editorConstantsSource,
    /const FOLDER_SYNC_AUTOSAVE_IDLE_MS = 2500;[\s\S]*?const WORDPRESS_DRAFT_AUTOSAVE_INTERVAL_MS = 30_000;[\s\S]*?const PROJECT_FIRST_AUTOSAVE_DELAY_MS = 15_000;[\s\S]*?const TEXT_EDIT_AUTOSAVE_IDLE_MS = 2000;/,
    'WordPress network persistence must use the anchored interval without changing folder/text edit cadence',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /scheduleWordPressDraftWrite\([^;\n]*,\s*180\)/,
    'text edits must not upload WordPress drafts while the author is still typing',
  );
  assert.match(
    localizationManagerSource,
    /setEditFeedback\('saving'\)[\s\S]*?await onChange\(normalizedSettings\)[\s\S]*?setEditFeedback\('error'\)[\s\S]*?setEditFeedback\('saved'\)/,
    'the localization header must distinguish saving, confirmed and failed states',
  );
  assert.match(
    localizationManagerSource,
    /settingsRef\.current = normalizedSettings[\s\S]*?await onChange\(normalizedSettings\)/,
    'localization mutations must advance their local base before an async parent echo',
  );
  assert.match(
    localizationManagerSource,
    /updateTranslation\(\s*settingsRef\.current,/,
    'rapid translation edits must compose from the latest local settings snapshot',
  );
  assert.match(
    localizationManagerSource,
    /editFeedback === 'saving'[\s\S]*?'Salvando…'[\s\S]*?editFeedback === 'saved'[\s\S]*?'Alterações salvas'/,
    'localization must never announce a save before the async parent callback resolves',
  );
  const addLocaleDialogRoot = localizationManagerSource.indexOf('open={addingLocale}');
  const addLocaleDialogStart = localizationManagerSource.indexOf('<DialogContent', addLocaleDialogRoot);
  const addLocaleDialogEnd = localizationManagerSource.indexOf('</DialogContent>', addLocaleDialogStart);
  const addLocaleDialogSource =
    addLocaleDialogRoot >= 0 && addLocaleDialogStart >= 0 && addLocaleDialogEnd >= 0
      ? localizationManagerSource.slice(addLocaleDialogStart, addLocaleDialogEnd + '</DialogContent>'.length)
      : '';
  assert.ok(addLocaleDialogSource, 'the Add language dialog must remain discoverable by its controlled open state');
  const addLocaleWidth = addLocaleDialogSource.match(/width="min\((\d+)px,\s*calc\(100vw - 1\.5rem\)\)"/);
  assert.ok(addLocaleWidth, 'the Add language dialog must pass an explicit responsive width to DialogContent so the base sm:max-w-lg cap is disabled');
  assert.ok(Number(addLocaleWidth?.[1]) >= 760, 'the Add language dialog needs enough desktop width for the locale list and data-entry pane');
  assert.match(
    addLocaleDialogSource,
    /grid-cols-1[\s\S]*?md:grid-cols-\[[^\]]*minmax\(0,1fr\)[^\]]*\]/,
    'the Add language dialog must stack on narrow screens and give the data-entry pane the flexible desktop column',
  );
  const addLocaleFormStart = addLocaleDialogSource.indexOf('{draftLocale ? (');
  const addLocaleFormEnd = addLocaleDialogSource.indexOf('</section>', addLocaleFormStart);
  const addLocaleFormSource =
    addLocaleFormStart >= 0 && addLocaleFormEnd >= 0 ? addLocaleDialogSource.slice(addLocaleFormStart, addLocaleFormEnd + '</section>'.length) : '';
  assert.match(addLocaleFormSource, /<section className="[^"]*\bw-full\b[^"]*"/, 'the locale data-entry form must use the complete width of the right pane');
  assert.doesNotMatch(addLocaleFormSource, /\bmax-w-lg\b/, 'the locale data-entry form must not collapse its fields behind a max-w-lg cap');
  const settingsFieldStart = localizationManagerSource.indexOf('function SettingsField');
  const settingsFieldEnd = localizationManagerSource.indexOf('function TranslationStatus', settingsFieldStart);
  const settingsFieldSource = settingsFieldStart >= 0 && settingsFieldEnd >= 0 ? localizationManagerSource.slice(settingsFieldStart, settingsFieldEnd) : '';
  assert.match(
    settingsFieldSource,
    /grid-cols-1[\s\S]*?minmax\(0,1fr\)/,
    'settings rows must keep a responsive single-column fallback and a non-overflowing flexible input column',
  );
  const settingsAst = ts.createSourceFile('HtmlProjectSettings.tsx', settingsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const proportionalSocialImageSource = settingsAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProportionalSocialImage')?.getText(settingsAst) || '';
  assert.match(
    proportionalSocialImageSource,
    /className="block h-auto w-full max-w-full"/,
    'social-image previews must fill the available width while retaining their intrinsic proportion',
  );
  assert.match(
    proportionalSocialImageSource,
    /onError=\{\(\) => setFailed\(true\)\}/,
    'a broken social-image URL must switch to an intentional fallback instead of exposing a broken image icon',
  );
  assert.match(
    proportionalSocialImageSource,
    /useEffect\(\(\) => \{\s*setFailed\(false\);\s*setLoaded\(false\);\s*}, \[src\]\)/,
    'changing a broken social-image URL must reset the error state and retry the new source',
  );
  assert.match(
    proportionalSocialImageSource,
    /style=\{loaded \? undefined : \{ position: 'absolute', inset: 0, visibility: 'hidden' \}\}[\s\S]*?onLoad=\{\(\) => setLoaded\(true\)\}/,
    'social-image previews must hide the native image surface until it has loaded successfully',
  );
  assert.match(proportionalSocialImageSource, /role="img"[\s\S]*aria-label=\{`\$\{alt} indisponível`\}/, 'the broken-image fallback must remain accessible');
  assert.doesNotMatch(settingsSource, /aspect-\[1\.91\/1\]|max-h-(?:52|60)/, 'social previews must not force a fixed-height crop box');
  assert.equal(
    (settingsSource.match(/<ProportionalSocialImage\b/g) || []).length,
    2,
    'both the media picker and social card must use the same proportional-image contract',
  );
  assert.match(
    editorConstantsSource,
    /const NEUTRAL_IMAGE_PLACEHOLDER_STYLE =[\s\S]*?width: 100%; height: 320px; min-height: 240px;[\s\S]*?repeating-linear-gradient\(135deg,[\s\S]*?object-fit: cover;/,
    'new image placeholders must have a substantial initial height, subtle diagonal treatment and cover behavior',
  );
  assert.match(
    editorConstantsSource,
    /img:\s*`<img[^`]*data-kodety-empty-image[^`]*style="\$\{NEUTRAL_IMAGE_PLACEHOLDER_STYLE\}"[^`]*>`/,
    'a plain inserted image must use the resilient CSS placeholder instead of a broken source',
  );
  assert.match(
    editorConstantsSource,
    /picture:[\s\S]*?<img data-kodety-empty-image[^`]*style="\$\{NEUTRAL_IMAGE_PLACEHOLDER_STYLE\}"[^`]*><\/picture>`/,
    'an inserted responsive Picture must use the same resilient placeholder contract',
  );
  assert.match(editorConstantsSource, /lightbox:\s*buildNativeLightboxMarkup\(\)/, 'an inserted Lightbox must use the shared native component contract');
  assert.match(
    nativeComponentsSource,
    /data-kodety-lightbox-thumb\$\{thumbnailAttribute\}[\s\S]*?min-height: 320px;[\s\S]*?background-image: repeating-linear-gradient/,
    'an inserted Lightbox thumbnail must use a substantial resilient placeholder instead of a broken source',
  );
  assert.match(
    nativeComponentsSource,
    /<dialog[\s\S]*?data-kodety-lightbox-dialog[\s\S]*?data-kodety-lightbox-close[\s\S]*?data-kodety-lightbox-image/,
    'Lightbox markup must include a real modal dialog, backdrop/close controls and full-size image',
  );
  assert.match(
    nativeComponentsSource,
    /data-kodety-locale-icon[\s\S]*?data-kodety-locale-chevron/,
    'the language insert must include its own stylable globe and chevron icons',
  );
  assert.match(
    nativeComponentsSource,
    /<details[\s\S]*?data-kodety-locale-selector[\s\S]*?data-kodety-locale-current[\s\S]*?data-kodety-locale-options/,
    'the language insert must be a styled selector with current value and dropdown options',
  );
  assert.match(
    nativeComponentsSource,
    /data-kodety-locale-selector[\s\S]*?max-width: 240px[\s\S]*?min-height: 48px[\s\S]*?font-size: 15px/,
    'the language selector default must stay compact and use normal input typography',
  );
  assert.equal(
    (projectEditorSource.match(/buildNativeLocaleSelectorMarkup\(localization\.locales, resolvedActiveLocale\)/g) || []).length,
    1,
    'the shared insertion path must populate the locale selector from the project locales exactly once',
  );
  assert.match(
    projectEditorSource,
    /message\.type === 'html-editor-insert-drop'[\s\S]*?insertElementAt\(message\.key, message\.targetPath, message\.position\)[\s\S]*?const addElement = \(tag: string\) =>[\s\S]*?insertElementAt\(tag, parentPath \|\| '', 'inside'\)/,
    'drag and click insertion must both route through the shared locale-aware insertion function',
  );
  for (const builder of [
    'buildNativeModalMarkup',
    'buildNativeDrawerMarkup',
    'buildNativePopoverMarkup',
    'buildNativeTooltipMarkup',
    'buildNativeCheckoutOverlayMarkup',
  ]) {
    assert.match(nativeComponentsSource, new RegExp(`export function ${builder}`), `${builder} must be a reusable native component builder`);
  }
  for (const tag of ['overlay-modal', 'overlay-drawer', 'overlay-popover', 'overlay-tooltip', 'checkout-overlay']) {
    assert.match(insertMenuSource, new RegExp(`key:\\s*["']${tag}["']`), `${tag} must be insertable from the Overlays catalog`);
    assert.match(
      editorConstantsSource,
      new RegExp(`["']${tag}["']:\\s*buildNative`),
      `${tag} must resolve through the shared authored-overlay builder registry`,
    );
  }
  assert.match(insertMenuSource, /category:\s*"Overlays"/, 'authored overlays must have a first-class Insert category');
  assert.match(editorLiveDomHelpersSource, /buildFreshNativeOverlayMarkup[\s\S]*?Date\.now\(\)/, 'each inserted overlay must receive a fresh ID');
  assert.match(
    nativeComponentsSource,
    /data-kodety-overlay-trigger[\s\S]*?data-kodety-overlay-surface[\s\S]*?data-kodety-overlay-close/,
    'native overlays must expose trigger, surface and close semantics',
  );
  assert.match(
    nativeComponentsSource,
    /data-kodefy-checkout-overlay[\s\S]*?data-kodefy-checkout-items[\s\S]*?data-kodefy-checkout-confirm/,
    'the checkout overlay must expose editable commerce bindings',
  );
  assert.match(
    nativeComponentsSource,
    /data-kodefy-checkout-item data-kodefy-template hidden/,
    'the editable checkout sample must be hidden outside Design mode',
  );
  assert.match(
    previewSource,
    /function nativeOverlayRuntimeBootstrap[\s\S]*?KodetyOverlays[\s\S]*?ResizeObserver/,
    'real Preview must install the robust delegated overlay runtime',
  );
  const previewOverlayInitializerSource =
    previewSource.match(/const initializeRoot = \(root: HTMLElement\) => \{[\s\S]*?\n  \};\n  const refresh =/)?.[0] || '';
  assert.ok(previewOverlayInitializerSource, 'real Preview must expose one native-overlay initializer');
  assert.match(
    previewOverlayInitializerSource,
    /initializedStates\.add\(state\)[\s\S]*?setHiddenState\(state\)/,
    'real Preview must synchronously normalize every overlay to closed before any interaction',
  );
  assert.match(
    previewOverlayInitializerSource,
    /removeAttribute\('data-kodety-overlay-default-open'\)/,
    'real Preview must discard the retired page-load-open marker before deferred authored code can reuse it',
  );
  assert.doesNotMatch(
    previewOverlayInitializerSource,
    /defaultOpen|hasAttribute\('data-kodety-overlay-default-open'\)|openState\(/,
    'real Preview must not infer an initial open state from authored or legacy markup',
  );
  assert.match(
    previewSource,
    /NATIVE_OVERLAY_BOOT_GUARD_CSS[\s\S]*?data-kodety-native-overlays-ready[\s\S]*?display: none !important[\s\S]*?data-kodety-native-overlays-guard/,
    'real Preview must hide overlay surfaces before its delegated runtime reaches first paint',
  );
  assert.match(
    previewSource,
    /isBareKodefyCheckoutControl[\s\S]*?data-kodefy-checkout[\s\S]*?if \(isBareKodefyCheckoutControl\(control\)\) return/,
    'Preview must leave the bare checkout trigger to Kodefy so placeholders are not opened before cart hydration',
  );
  assert.match(
    previewSource,
    /document\.addEventListener\('pointerover'[\s\S]*?scheduleTooltipOpen[\s\S]*?document\.addEventListener\('pointerout'[\s\S]*?scheduleTooltipClose[\s\S]*?document\.addEventListener\('focusout'/,
    'Preview tooltips must match published pointer and keyboard focus behavior',
  );
  assert.match(
    previewSource,
    /if \(mode\) return mode === 'anchored';[\s\S]*?anchoredKinds\.has/,
    'an explicit fixed overlay mode must override kind-based anchored defaults in Preview',
  );
  assert.match(
    previewSource,
    /editorRevealedOverlay[\s\S]*?data-html-editor-overlay-forced-open/,
    'Design mode must reveal a selected hidden overlay without mutating authored HTML',
  );
  assert.match(
    previewSource,
    /editorOverlayRootForSelection = el[\s\S]*?el\.closest\('\[data-kodety-overlay\]'\)[\s\S]*?editorOverlayRootsForSelection = elements[\s\S]*?elements\.forEach\(element[\s\S]*?editorOverlayRootForSelection\(element\)[\s\S]*?syncEditorRevealedOverlay = \(el, dirtyRoots = \[\]\)[\s\S]*?querySelectorAll\('\[data-html-editor-selected\]'\)[\s\S]*?editorOverlayRootsForSelection\(selectedElements\)/,
    'Design mode must reveal the union of overlay trees that contain selected Layers items',
  );
  assert.match(
    previewSource,
    /\[data-kodety-overlay\]:not\(\[data-html-editor-selected\]\):not\(:has\(\[data-html-editor-selected\]\)\) \[data-kodety-overlay-surface\][\s\S]*?\[data-kodety-overlay\]\[data-kodety-overlay-surface\]:not\(\[data-html-editor-selected\]\):not\(:has\(\[data-html-editor-selected\]\)\)[\s\S]*?\[data-kodety-overlay-backdrop\][\s\S]*?display: none !important;[\s\S]*?visibility: hidden !important;[\s\S]*?pointer-events: none !important;/,
    'Design mode must suppress every overlay whose own layer tree has no current selection, regardless of runtime open state',
  );
  assert.match(
    previewSource,
    /const suppressEditorOverlay = root[\s\S]*?hidden', ''[\s\S]*?aria-hidden', 'true'[\s\S]*?data-state', 'closed'[\s\S]*?const editorOverlayRootsForSelection[\s\S]*?chain\.unshift\(root\)[\s\S]*?document\.querySelectorAll\('\[data-kodety-overlay\]'\)[\s\S]*?selectedRoots\.includes\(root\)[\s\S]*?suppressEditorOverlay\(root\)[\s\S]*?editorOverlaySuppressionObserver/,
    'the Design bridge must close every unselected overlay projection, retain nested selected ancestors, and reassert the rule after runtime DOM mutations',
  );
  assert.match(
    previewSource,
    /const setEditorOverlayAttribute = \(element, name, value\)[\s\S]*?alreadyMatches[\s\S]*?if \(alreadyMatches\) return[\s\S]*?editorRevealedOverlays\.forEach\(root[\s\S]*?forceEditorOverlayOpen\(root\)/,
    'the Design bridge must idempotently reassert an open projection when a selected overlay is mutated',
  );
  assert.match(
    previewSource,
    /syncEditorRevealedOverlay = \(el, dirtyRoots = \[\]\) => \{[\s\S]*?if \(!inspectionEnabled\) return[\s\S]*?syncEditorRevealedOverlay\(selected\)[\s\S]*?if \(inspectionEnabled\) \{[\s\S]*?const editorOverlaySuppressionObserver = new MutationObserver/,
    'selection-only overlay projection must run in Design mode and never suppress real Preview interactions',
  );
  assert.match(
    previewSource,
    /data-html-editor-overlay-projected-display="block"[\s\S]*?display: block !important[\s\S]*?data-html-editor-overlay-projected-display="grid"[\s\S]*?display: grid !important[\s\S]*?visibleElements\.forEach\(element[\s\S]*?data-state', 'open'[\s\S]*?visibleElements\.forEach\(element[\s\S]*?editorOverlayProjectedDisplay/,
    'Design mode must derive an open-state display before forcing selected overlays above authored hidden rules',
  );
  assert.doesNotMatch(
    previewSource,
    /setEditorOverlayStyleProperty|positionEditorOverlayTopLayer/,
    'Design overlay projection must not mutate and later restore the complete authored style attribute',
  );
  assert.match(
    previewSource,
    /editorOverlayUsesAnchoredLayout[\s\S]*?popover[\s\S]*?tooltip[\s\S]*?menu[\s\S]*?surfaceInTopLayer = editorOverlayUsesAnchoredLayout[\s\S]*?\? false/,
    'anchored Design overlays must retain their authored containing block instead of being displaced into the top layer',
  );
  assert.match(
    previewSource,
    /showPopover\(\) moves fixed Design overlays[\s\S]*?data-kodety-overlay-surface\]\[popover\][\s\S]*?inset: auto;[\s\S]*?margin: 0;[\s\S]*?data-kodety-overlay-backdrop\]\[popover\][\s\S]*?margin: 0;/,
    'fixed Design overlays must neutralize UA popover centering while leaving authored positioning authoritative',
  );
  assert.match(
    previewSource,
    /reconcileEditorSuppressedOverlayAttributes[\s\S]*?structuralAttributeNames[\s\S]*?data-kodety-overlay-surface[\s\S]*?data-kodety-overlay-backdrop[\s\S]*?addedNodes[\s\S]*?removedNodes/,
    'Design suppression must restore detached or structurally repurposed overlay parts',
  );
  assert.match(
    previewSource,
    /const structureDirty = editorOverlayStructureDirty[\s\S]*?unchanged = !structureDirty[\s\S]*?editorOverlayStructureDirty = false[\s\S]*?structuralMutation = mutations\.some[\s\S]*?if \(structuralMutation\) editorOverlayStructureDirty = true/,
    'a structural edit inside a selected overlay must restore the old reveal projection before projecting its new parts',
  );
  assert.match(
    previewSource,
    /selectedNodeRemoved = mutations\.some[\s\S]*?removedNodes[\s\S]*?data-html-editor-selected[\s\S]*?overlayMutation = selectedNodeRemoved/,
    'removing the selected overlay descendant must immediately close its selection-only projection',
  );
  assert.match(
    previewSource,
    /updateOverlayAuthoredBaseline[\s\S]*?editorRevealedOverlayAttributes[\s\S]*?editorSuppressedOverlayAttributes[\s\S]*?committedStateObserver[\s\S]*?editorRevealedOverlayAttributes\.get\(element\)\?\.has\(attributeName\)/,
    'live authored attribute edits must update the projection baseline without entering a committed-state replay loop',
  );
  assert.doesNotMatch(
    previewSource,
    /syncEditorRevealedOverlay = \(el, interactionElement|selectElement\(el, event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey, event\.target\)/,
    'clicking an overlay recipient in the canvas must remain a normal parent-editing selection',
  );
  assert.match(
    previewSource,
    /data-html-editor-overlay-forced-open[\s\S]*?data-kodefy-checkout-item[\s\S]*?checkoutTemplates/,
    'Design mode must reveal the editable checkout sample while keeping it hidden on the published site',
  );
  assert.match(
    inspectorSource,
    /isOverlayComponent[\s\S]*?selection\?\.attributes\['data-kodety-overlay'\] !== undefined[\s\S]*?Close with Escape[\s\S]*?Lock page scroll/,
    'the Inspector must expose behavior controls for native and imported overlay roots',
  );
  assert.match(
    inspectorSource,
    /function BooleanAttributeRow\([\s\S]*?void alignSwitchEnd[\s\S]*?<HtmlSettingsToggleControl[\s\S]*?label="Close with Escape"[\s\S]*?alignSwitchEnd[\s\S]*?label="Close outside"[\s\S]*?alignSwitchEnd[\s\S]*?label="Lock page scroll"[\s\S]*?alignSwitchEnd/,
    'overlay switches must share the right edge with the focus control without wrapping their labels',
  );
  assert.match(
    inspectorSource,
    /'data-kodety-overlay': behavior[\s\S]*?'data-kodety-overlay-default-open': ''/,
    'changing overlay behavior must remove the legacy page-load-open attribute',
  );
  assert.doesNotMatch(inspectorSource, /label="Open on page load"/, 'the Inspector must not offer a page-load state that bypasses overlay interaction');
  assert.match(
    layersTreeSource,
    /isNativeOverlayRootNode[\s\S]*?isNativeOverlaySurfaceNode[\s\S]*?isNativeOverlayBackdropNode[\s\S]*?<PanelTopOpen\s+aria-label="Surface de overlay"\s+className=\{iconClassName\}[\s\S]*?<Layers3[\s\S]*?className=\{iconClassName\}/,
    'the extracted Layers tree must give overlay roots, surfaces and backdrops distinct structural icons using the shared layer accent',
  );
  assert.match(
    previewSource,
    /event\.data\?\.type !== 'html-editor-select'[\s\S]*?deferred detail pass then closes\/reopens projected overlays[\s\S]*?const findByPath[\s\S]*?selectElement\(el/,
    'every Layers selection must update the exact native marker before the deferred detail pass reconciles its overlay projection',
  );
  assert.match(
    previewSource,
    /if \(!el\) \{[\s\S]*?querySelectorAll\('\[data-html-editor-selected\]'\)[\s\S]*?selected = null[\s\S]*?pendingSelectionDetail = \{ element: null, sequence \}[\s\S]*?schedulePendingSelectionDetail\(\)/,
    'a stale or cleared Layers path must remove selection markers and schedule a null detail pass so the previous overlay projection closes',
  );
  assert.match(
    inspectorSource,
    /title="Overlays"[\s\S]*?aria-label="Add overlay"[\s\S]*?>Relative<[\s\S]*?Dropdowns, popovers[\s\S]*?>Fixed<[\s\S]*?Modals, drawers, videos/,
    'the Design panel must expose the native Relative/Fixed overlay insertion UX on the selected item',
  );
  assert.match(
    inspectorSource,
    /\{overlayDesignPanel && \([\s\S]*?<div data-ycode-native-ui>[\s\S]*?\{overlayDesignPanel\}/,
    'the Overlays design section must remain inside the native Ycode style sequence',
  );
  assert.doesNotMatch(
    inspectorSource,
    /Nenhum overlay conectado a este item/,
    'the empty Overlays group must stay compact without a divergent placeholder sentence',
  );
  assert.match(
    inspectorSource,
    /createAndAttachOverlay[\s\S]*?buildNativePopoverMarkup[\s\S]*?buildNativeModalMarkup[\s\S]*?data-kodety-overlay-managed[\s\S]*?patchInsertAdjacentElement/,
    'item-level overlay creation must author a managed editable surface beside the selected trigger',
  );
  assert.match(
    inspectorSource,
    /detachOverlay[\s\S]*?linkedOverlay\?\.managed[\s\S]*?patchRemoveElement\(detachedSource, linkedOverlay\.rootPath\)[\s\S]*?data-kodety-overlay-control[\s\S]*?Click[\s\S]*?onSelectPath\?\.\(linkedOverlay\.surfacePath \|\| linkedOverlay\.rootPath\)[\s\S]*?detachOverlay/,
    'a linked item must open its Surface and delete a builder-managed overlay when explicitly removed',
  );
  assert.match(
    inspectorSource,
    /const checkout = overlay\.kind === 'checkout'[\s\S]*?'data-kodety-overlay-open': checkout \? '' : overlay\.id[\s\S]*?'data-kodety-overlay-trigger': checkout \? overlay\.id : ''[\s\S]*?'data-kodefy-checkout': checkout \? 'true' : ''/,
    'connecting a checkout overlay must preserve Kodefy hydration instead of letting the generic runtime open placeholders',
  );
  assert.match(
    projectEditorSource,
    /<HtmlInspector[\s\S]*?onSelectPath=\{path => selectPath\(path\)\}/,
    'the Inspector overlay chip must navigate through the canonical canvas selection bridge',
  );
  assert.match(
    previewSource,
    /#__kodety-overlay-link-badge[\s\S]*?data-kodety-overlay-target[\s\S]*?data-kodefy-checkout[\s\S]*?Checkout overlay[\s\S]*?directOverlayBadge\.id = '__kodety-overlay-link-badge'/,
    'the selected canvas item must visibly identify normal and checkout overlay links',
  );
  assert.match(
    previewSource,
    /showInOverlayTopLayer[\s\S]*?showPopover[\s\S]*?2147483647[\s\S]*?showEditorOverlayTopLayer[\s\S]*?showPopover[\s\S]*?editorOverlayUsesAnchoredLayout/,
    'Preview must use the maximum top layer while Design promotes only non-anchored overlay surfaces',
  );
  assert.match(
    previewSource,
    /paintedOverlayRoot = event\.target\?\.closest[\s\S]*?candidate\.closest\('\[data-kodety-overlay\]'\) !== paintedOverlayRoot/,
    'canvas hit testing inside a painted overlay must not select deeper page text behind it and immediately hide the surface',
  );
  assert.match(
    previewSource,
    /const selectableFromEvent[\s\S]*?document\.elementsFromPoint[\s\S]*?document\.caretPositionFromPoint[\s\S]*?document\.caretRangeFromPoint/,
    'canvas selection must use the browser point stack and caret hit test before considering a document-wide fallback',
  );
  assert.match(
    previewSource,
    /bridge\.textContent = `[\s\S]*?const authoredPointHitTestStyle = inspectionEnabled[\s\S]*?style\.textContent = '\[data-html-editor-path\] \{ pointer-events: auto !important; \}'[\s\S]*?document\.head\.appendChild\(style\)[\s\S]*?style\.disabled = true[\s\S]*?const selectableFromEvent[\s\S]*?const pointStack = document\.elementsFromPoint[\s\S]*?const directMayHideAuthoredDescendant = !direct[\s\S]*?direct\.querySelector\('\[data-html-editor-path\]'\)[\s\S]*?const needsInclusivePointHitTest = Boolean\(authoredPointHitTestStyle\)[\s\S]*?directMayHideAuthoredDescendant[\s\S]*?!Array\.from\(candidates\)\.some\(authoredTextCandidate\)[\s\S]*?if \(needsInclusivePointHitTest\) \{[\s\S]*?authoredPointHitTestStyle\.disabled = false[\s\S]*?document\.elementsFromPoint[\s\S]*?finally \{[\s\S]*?authoredPointHitTestStyle\.disabled = true/,
    'the costly inclusive point query must skip exact authored leaves while retaining pointer-events:none recovery below authored ancestors',
  );
  assert.doesNotMatch(
    previewSource,
    /authoredPointHitTestStyle\.media\s*=/,
    'point hit testing must not mutate media because Infinite Canvas treats it as a full cascade-scan signal',
  );
  assert.match(
    previewSource,
    /const needsLegacyGlobalHitTest[\s\S]*?if \(needsLegacyGlobalHitTest\) \{[\s\S]*?document\.querySelectorAll\('\[data-html-editor-path\]'\)/,
    'the full authored-layer scan must remain isolated to legacy hit-test implementations',
  );
  assert.match(
    nativeRuntimeSource,
    /showTopLayer[\s\S]*?showPopover[\s\S]*?const setPartOpen[\s\S]*?showTopLayer\(element, zIndex\)[\s\S]*?const setPartClosed[\s\S]*?hideTopLayer\(element\)[\s\S]*?setPartOpen\(overlay\.backdrop, 2147483646\)[\s\S]*?setPartOpen\(overlay\.surface, 2147483647\)/,
    'portable HTML exports must escape overflow and stacking-context clipping through the browser top layer',
  );
  assert.match(
    wordpressThemeRuntimeSource,
    /showOverlayTopLayer[\s\S]*?showPopover[\s\S]*?const setOverlayPartOpen[\s\S]*?showOverlayTopLayer\(element, zIndex\)[\s\S]*?const setOverlayPartClosed[\s\S]*?hideOverlayTopLayer\(element\)[\s\S]*?setOverlayPartOpen\(backdrop, 2147483646\)[\s\S]*?setOverlayPartOpen\(surface, 2147483647\)/,
    'the WordPress publication runtime must keep overlay surfaces above every authored stacking context',
  );
  assert.doesNotMatch(
    inspectorSource,
    /inline-grid[^"']*bg-(?:blue-500|\[var\(--kodety-accent\)\])[^<]*<Layers3/,
    'overlay icons must remain unboxed and visually integrated with their labels',
  );
  assert.doesNotMatch(
    previewSource,
    /directOverlayBadge\.textContent\s*=\s*[^;]*▣/,
    'the canvas overlay indicator must not fake another boxed icon with a glyph',
  );
  assert.match(projectIoSource, /injectNativeComponentsRuntime\(withInteractions\)/, 'normal HTML transport must include the native overlay runtime');
  assert.match(
    projectIoSource,
    /usesNativeComponents[\s\S]*?layout[\s\S]*?liquid[\s\S]*?injectNativeComponentsRuntime\(layout, true\)/,
    'Liquid transport must install one forced native runtime in each exported theme layout',
  );
  assert.match(
    projectIoSource,
    /patchInteractionDocument\(layout[\s\S]*?applyCustomCodeToHtml\(layout/,
    'Liquid transport must compile visual interactions and custom code into the exported theme layout',
  );
  assert.doesNotThrow(() => new Function(nativeRuntime.NATIVE_COMPONENTS_RUNTIME), 'the standalone native-components runtime must remain valid JavaScript');
  assert.match(
    nativeRuntime.NATIVE_COMPONENTS_STYLES,
    /data-kodety-overlay-ready[\s\S]*?data-state="open"[\s\S]*?\[hidden\][\s\S]*?display: none !important;[\s\S]*?visibility: hidden !important;[\s\S]*?pointer-events: none !important;/,
    'portable HTML must ship a fail-closed overlay stylesheet that wins over inline surface display',
  );
  const guardedOverlayTransport = nativeRuntime.injectNativeComponentsRuntime(
    '<!doctype html><html><head><title>Overlay</title></head><body><div data-kodety-overlay="popover" data-state="open"><section data-kodety-overlay-surface style="display:grid">Conteúdo</section></div><script data-kodety-native-components-runtime>legacy</script></body></html>',
  );
  assert.ok(
    guardedOverlayTransport.indexOf('data-kodety-native-components-style="2"') < guardedOverlayTransport.indexOf('</head>'),
    'portable transport must install the fail-closed guard in head before surface markup can paint',
  );
  assert.equal(
    (guardedOverlayTransport.match(/data-kodety-native-components-runtime="2"/g) || []).length,
    1,
    'portable transport must replace a legacy marked runtime with one canonical current runtime',
  );
  assert.doesNotMatch(guardedOverlayTransport, />legacy<\/script>/, 'portable transport must not preserve a stale overlay runtime across re-export');
  const guardedHeadlessTransport = nativeRuntime.injectNativeComponentsRuntime(
    '<!doctype html><body><div data-kodety-overlay="modal"><section data-kodety-overlay-surface>Modal</section></div></body>',
  );
  assert.match(
    guardedHeadlessTransport,
    /^<!doctype html><style data-kodety-native-components-style="2">/i,
    'injecting the guard into headless HTML must retain the doctype as the first token',
  );
  for (const runtimeSource of [nativeRuntimeSource, wordpressThemeRuntimeSource]) {
    assert.match(
      runtimeSource,
      /data-kodety-overlay-target[\s\S]*?data-kodety-overlay-toggle[\s\S]*?aria-controls/,
      'published runtimes must resolve the full external trigger contract',
    );
    assert.match(
      runtimeSource,
      /ACTION_SELECTOR[\s\S]*?data-kodety-overlay-trigger[\s\S]*?bareKodefyCheckout/,
      'published runtimes must support bare triggers without stealing Kodefy checkout clicks',
    );
    assert.match(
      runtimeSource,
      /mode \?[\s\S]*?mode !== 'anchored'[\s\S]*?popover[\s\S]*?tooltip[\s\S]*?menu/,
      'published runtimes must honor explicit fixed positioning',
    );
    assert.match(runtimeSource, /closeOutside|outside/, 'published runtimes must expose close-outside behavior');
    assert.match(
      runtimeSource,
      /data-kodety-overlay['"]\) === 'checkout'[\s\S]*?data-kodefy-checkout-ready/,
      'published runtimes must reject checkout overlays until Kodefy hydrates the cart',
    );
    assert.match(
      runtimeSource,
      /removeAttribute\('data-kodety-overlay-default-open'\)/,
      'published runtimes must discard the retired page-load-open marker from every overlay type',
    );
    assert.doesNotMatch(
      runtimeSource,
      /hasAttribute\('data-kodety-overlay-default-open'\)|defaultOpen/,
      'published runtimes must never infer an open state from the retired page-load marker',
    );
    assert.match(runtimeSource, /MutationObserver[\s\S]*?refresh/, 'published runtimes must fail-close overlays inserted after initial bootstrap');
    assert.match(
      runtimeSource,
      /initializedBackdrops = new WeakMap[\s\S]*?const (?:liveParts|liveOverlayParts) = root[\s\S]*?initializedSurfaces\.get\(root\)[\s\S]*?initializedBackdrops\.get\(root\)/,
      'published runtimes must retain the last initialized parts long enough to close surfaces and backdrops after structural edits',
    );
    assert.match(
      runtimeSource,
      /cached(?:Overlay)?PartForRoot[\s\S]*?root\.contains\(part\)[\s\S]*?(?:nearestRoot|nearestOverlayRoot)\(part\)[\s\S]*?forgetInitialized(?:Overlay)?Parts/,
      'published runtimes must use cached parts only for their current owner and forget them after structural removal',
    );
    assert.match(
      runtimeSource,
      /const setOverlayPartsOpen = \(root, overlay\)[\s\S]*?HTMLDialogElement[\s\S]*?showModal\(\)[\s\S]*?(?:opened|openOverlays)\.includes\(root\)[\s\S]*?setOverlayPartsOpen\(root/,
      'idempotent published open calls must reopen a dialog that native dialog behavior closed independently',
    );
    assert.match(
      runtimeSource,
      /install(?:Overlay)?DialogHandlers[\s\S]*?addEventListener\('close', syncNativeClose\)[\s\S]*?addEventListener\('cancel'[\s\S]*?queueMicrotask\(syncNativeClose\)/,
      'native dialog close and cancel behavior must converge through the canonical overlay close path',
    );
    assert.match(
      runtimeSource,
      /const (?:open|openOverlay) = \(target, opener\)[\s\S]*?!root\.isConnected[\s\S]*?!root\.matches\([A-Z_]+\)/,
      'published runtimes must not reopen detached or structurally retired overlay roots',
    );
    assert.match(
      runtimeSource,
      /scrollLockedRoots = new WeakSet[\s\S]*?scrollLockedRoots\.add\(root\)[\s\S]*?scrollLockedRoots\.has\(root\)[\s\S]*?(?:unlock|unlockScroll)\(\)/,
      'published runtimes must release scroll locks even when the overlay kind attribute changes before close',
    );
    assert.match(
      runtimeSource,
      /mutation\.attributeName === 'data-kodety-overlay'[\s\S]*?initialized(?:Overlays)?\.has\(target\)[\s\S]*?!target\.matches\([A-Z_]+\)[\s\S]*?(?:close|closeOverlay)\(target/,
      'published runtimes must close an initialized overlay when its structural root marker is removed',
    );
    assert.match(
      runtimeSource,
      /const clearTooltipTimer[\s\S]*?clearTimeout\(timerState\.value\)[\s\S]*?timerState\.value = 0[\s\S]*?const (?:open|openOverlay) = \(target, opener\)[\s\S]*?clearTooltipTimer\(root\)[\s\S]*?const (?:close|closeOverlay) = \(target, options = \{\}\)[\s\S]*?clearTooltipTimer\(root\)/,
      'published tooltip timers must be cancelled by explicit open and close actions so a stale hover cannot reopen a dismissed surface',
    );
    assert.match(
      runtimeSource,
      /root\.getAttribute\('data-kodety-overlay'\) !== 'tooltip'[\s\S]*?options\.restoreFocus !== false/,
      'published tooltip close actions must not refocus their trigger and immediately schedule a reopen',
    );
  }
  assert.match(
    previewSource,
    /restoreFocus[\s\S]*?overlayKind\(state\.root, state\.surface\) !== 'tooltip'[\s\S]*?focusTarget\?\.isConnected/,
    'real Preview tooltip close actions must not refocus their trigger and immediately schedule a reopen',
  );
  assert.match(
    previewSource,
    /function materializeNativeLocaleSelectors[\s\S]*?readEditorMetadata\(project\)\.localization[\s\S]*?locale\.enabled !== false[\s\S]*?options\.replaceChildren\(fragment\)/,
    'real Preview must refresh language options dynamically from localization metadata',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /NEUTRAL_PLACEHOLDER_IMAGE|data:image\/svg\+xml/,
    'new image placeholders must not depend on a data URL that can break inside the isolated canvas',
  );
  const patchedImagePlaceholder = source.patchMediaSource(
    '<img data-kodety-empty-image aria-label="Image placeholder" data-kodety-bind-src="featured_image" alt="">',
    '0',
    '/images/hero.jpg',
  );
  assert.match(patchedImagePlaceholder, /src="\/images\/hero\.jpg"/, 'choosing a real image source must install it on the placeholder');
  assert.doesNotMatch(
    patchedImagePlaceholder,
    /data-kodety-empty-image|aria-label="Image placeholder"/,
    'choosing a real image source must remove empty-placeholder semantics',
  );
  assert.match(
    patchedImagePlaceholder,
    /data-kodety-bind-src="featured_image"/,
    'replacing the placeholder source must preserve its CMS image-field connection',
  );
  assert.match(
    inspectorSource,
    /function serializePictureModel[\s\S]*?style="display: block; width: 100%; height: auto;"/,
    'editing Picture settings must not regress its proportional canvas sizing',
  );
  assert.match(
    inspectorSource,
    /function serializeLightboxModel[\s\S]*?buildNativeLightboxMarkup\(/,
    'editing Lightbox settings must preserve the shared native modal contract',
  );
  assert.match(
    previewSource,
    /export const PROPORTIONAL_IMAGE_DEFAULTS_CSS[\s\S]*?:where\(img:not\(\[width\]\)\)\s*\{\s*width:\s*100%;\s*}[\s\S]*?:where\(img:not\(\[height\]\)\)\s*\{\s*height:\s*auto;\s*}[\s\S]*?:where\(img:not\(\[hidden\]\)\)\s*\{\s*display:\s*block;\s*}/,
    'the canvas preview must provide a zero-specificity Fill/auto fallback for unconfigured images',
  );
  assert.match(
    previewSource,
    /:where\(picture:not\(\[hidden\]\)\)\s*\{\s*display:\s*block;\s*width:\s*100%;\s*}/,
    'responsive Picture wrappers must fill their canvas container by default',
  );
  assert.match(
    previewSource,
    /:where\(\[data-incode-component="lightbox"\]:not\(\[hidden\]\)\)\s*\{\s*display:\s*block;\s*width:\s*100%;\s*}/,
    'Lightbox wrappers must fill their canvas container by default',
  );
  assert.match(
    previewSource,
    /document\.head\.insertBefore\(proportionalImageDefaults, document\.head\.firstChild\)/,
    'proportional image defaults must be inserted before authored project styles so explicit CSS remains authoritative',
  );
  const mediaSettingsStart = inspectorSource.indexOf('{isMedia && (');
  const mediaSettingsEnd = inspectorSource.indexOf('{isImage && (', mediaSettingsStart);
  const mediaSettingsSource = mediaSettingsStart >= 0 && mediaSettingsEnd >= 0 ? inspectorSource.slice(mediaSettingsStart, mediaSettingsEnd) : '';
  assert.match(
    inspectorSource,
    /function MediaSourceRow[\s\S]*?data-media-source-control[\s\S]*?Origem da mídia[\s\S]*?Assets do projeto[\s\S]*?Upload new file/,
    'media source, project assets and upload must live in one source dropdown',
  );
  assert.doesNotMatch(
    mediaSettingsSource,
    />Asset<\/Label>|Substituir por upload/,
    'the media inspector must not expose Asset and Source as competing controls',
  );
  assert.match(
    inspectorSource,
    /connected \? 'Connected to CMS\. Changes update the item without removing its binding\.'/,
    'the consolidated source control must preserve and explain its CMS field connection',
  );
  assert.match(
    mediaSettingsSource,
    /data-media-focus-control[\s\S]*?bg-secondary\/45[\s\S]*?border-2 border-white bg-background/,
    'the focus point must use a restrained neutral surface and precise marker',
  );
  assert.match(
    mediaSettingsSource,
    /data-media-fit-control[\s\S]*?grid-cols-\[repeat\(3,minmax\(0,1fr\)\)\]/,
    'Fit, Fill and Stretch must keep a real three-column segmented layout inside SettingsPanel',
  );
  assert.match(
    inspectorSource,
    /const mediaObjectPosition = styleValues\['object-position'\][\s\S]*?parseObjectPositionFocus\(mediaObjectPosition\)/,
    'the focus marker must synchronize from the effective rule, breakpoint, computed and optimistic style value',
  );
  assert.match(
    mediaSettingsSource,
    /onPointerDown=\{handleMediaFocusPointerDown\}[\s\S]*?onPointerMove=\{handleMediaFocusPointerMove\}[\s\S]*?onPointerUp=\{handleMediaFocusPointerUp\}/,
    'the focus surface must support continuous pointer drag instead of click-only placement',
  );
  assert.doesNotMatch(
    mediaSettingsSource,
    /radial-gradient|bg-\[size:33\.333%_33\.333%\]|<Crosshair className="size-3"/,
    'the focus point must not regress to the decorative blue grid treatment',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /data-workspace-conflict|A edição foi pausada|WordPressWorkspaceConflictError/,
    'multi-editor mode must never pause or cover the canvas with the legacy revision-conflict system',
  );
  assert.match(
    shareDialogSource,
    /HtmlInvitationAccessDialog[\s\S]*?accountExists[\s\S]*?Entrar e editar[\s\S]*?Crie sua senha[\s\S]*?Criar senha e editar/,
    'edit invitations must offer login to existing users and first-access password creation to new users',
  );
  assert.match(
    topbarSource,
    /invitationRequiresActivation[\s\S]*?setInvitationAccessOpen\(true\)[\s\S]*?Ativar edição/,
    'the extracted shared-project toolbar must keep a pending editor invitation reopenable',
  );
  assert.match(
    projectEditorSource,
    /editInvitation && invitationRequiresActivation[\s\S]*?<HtmlInvitationAccessDialog[\s\S]*?open=\{invitationAccessOpen\}/,
    'the editor shell must retain the invitation access dialog controlled by the extracted toolbar',
  );
  assert.match(
    shareDialogSource,
    /size-7 shrink-0 place-items-center rounded-\[7px\][\s\S]*?<ArrowUp className="size-\[13px\] stroke-\[1\.7\]"/,
    'the invite submit control must stay compact instead of dominating the email field',
  );
  assert.match(
    shareDialogSource,
    /data-kodety-share-access[\s\S]*?size-8 shrink-0[\s\S]*?Exclusive editing[\s\S]*?Protected[\s\S]*?Link do projeto[\s\S]*?sm:w-\[142px\][\s\S]*?>Ativar<\/Button>/,
    'project access and project-link controls must use the compact tokenized sharing surface',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /broadcastCollaborativeOperations|createCollaborativeOperations|applyCollaborativeOperations|collaborationChangesUrl/,
    'the exclusive editor lock must not calculate, publish or poll multi-editor operations',
  );
  assert.match(
    projectEditorSource,
    /scheduleFolderWrite\(next\);[\s\S]*?scheduleWordPressDraftWrite\(next\);/,
    'a canonical edit must schedule normal persistence without scanning every project file for collaboration diffs',
  );
  const workspaceRevisionPollStart = projectEditorSource.indexOf('const statusEndpoint = config.mcpStatusUrl;');
  const workspaceRevisionPollEnd = projectEditorSource.indexOf('\n  }, [commitProject', workspaceRevisionPollStart);
  const workspaceRevisionPollSource =
    workspaceRevisionPollStart >= 0 && workspaceRevisionPollEnd > workspaceRevisionPollStart
      ? projectEditorSource.slice(workspaceRevisionPollStart, workspaceRevisionPollEnd)
      : '';
  assert.ok(workspaceRevisionPollSource, 'missing WordPress workspace revision poll');
  assert.match(
    projectEditorSource,
    /const previewReviewRequest =[^;]+kodety-preview-review[^;]+;[\s\S]*?const \[isPreviewing, setIsPreviewing\] = useState\(previewReviewRequest\);[\s\S]*?useHtmlCollaborationPresence\(\{[\s\S]*?enabled: isWordPressRuntime && !previewReviewRequest && \(!wordpressInitialLoadDone \|\| Boolean\(project\)\),[\s\S]*?editorLockUrl:/,
    'preview review mode must be established before the exclusive editor lock heartbeat mounts',
  );
  assert.match(
    projectEditorSource,
    /!isWordPressRuntime \|\|\s*isPreviewing \|\|\s*!wordpressInitialLoadDone \|\|\s*!config\?\.projectUrl \|\|\s*!config\.mcpStatusUrl \|\|\s*config\.mcpEnabled !== true \|\|/,
    'MCP status polling must require an active connection and stay disabled on preview surfaces',
  );
  assert.match(
    workspaceRevisionPollSource,
    /if \(status\.enabled !== true\) \{[\s\S]*?cancelled = true;[\s\S]*?return;/,
    'MCP polling must stop when another tab disables the active connection',
  );
  assert.match(
    workspaceRevisionPollSource,
    /const hasLocalWrite =[\s\S]*?if \(hasLocalWrite\) \{[\s\S]*?compare-and-swap save[\s\S]*?return;/,
    'status polling must defer while this tab has a pending or in-flight save instead of inferring a conflict from its own revision',
  );
  assert.match(
    workspaceRevisionPollSource,
    /const mcpChangeRevision = Number\(status\.lastChange\?\.workspaceRevision\);[\s\S]*?const revisionCameFromMcp = status\.enabled === true[\s\S]*?mcpChangeRevision === externalRevision[\s\S]*?publishAbortControllerRef\.current !== null[\s\S]*?setMcpCanvasSyncing\(revisionCameFromMcp\)/,
    'the workspace poll must attribute only matching MCP revisions to MCP and ignore the revision created by this tab while publishing',
  );
  assert.match(
    workspaceRevisionPollSource,
    /const hasNewLocalWrite =[\s\S]*?explicitWordPressDraftProjectRef\.current !== null[\s\S]*?if \(hasNewLocalWrite\) \{[\s\S]*?return;/,
    'a local edit that lands during an external snapshot download must abort that background read without freezing the canvas',
  );
  assert.doesNotMatch(workspaceRevisionPollSource, /activateWordPressWorkspaceConflict/, 'the observational poll must never block realtime editing');
  assert.match(
    workspaceRevisionPollSource,
    /activity\?: McpRuntimeActivity[\s\S]*?setMcpRuntimeStatus\([\s\S]*?activity: status\.enabled === true \? status\.activity \|\| null : null[\s\S]*?commitProject\(next, true, true, false, false\);[\s\S]*?forceCanonicalCanvasRefresh\(\)/,
    'the MCP poll must expose live activity and force a canonical canvas generation after accepting an AI workspace update',
  );
  assert.match(
    editorTypesAndProjectSource,
    /mcpProjectConnectionUrl\?: string[\s\S]*?mcpTarget\?: McpProjectTarget[\s\S]*?data-mcp-canvas-activity/,
    'the Builder shell must retain the project-scoped MCP connection contract and canvas activity indicator',
  );
  assert.match(
    leftSidebarSource,
    /mcpTargetName[\s\S]*?href=\{mcpSettingsHref\}[\s\S]*?onClick=\{openMcpSettings\}[\s\S]*?Copiar conexão deste projeto[\s\S]*?Configurar MCP/,
    'the extracted Builder MCP menu must identify its target and route connection setup through Settings',
  );
  assert.match(
    projectEditorSource,
    /const mcpOperationActive = currentMcpStatus\.activity\?\.active === true;[\s\S]*?const mcpActivityVisible = mcpConnected[\s\S]*?mcpCanvasSyncing \|\| mcpOperationActive[\s\S]*?mcpActivityPresentation[\s\S]*?data-mcp-canvas-activity[\s\S]*?agentActivityLabel=\{agentTurnActivity\?\.label \|\| null\}/,
    'the Builder must route Agent work into the active frame header while retaining the separate live MCP HUD',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /data-agent-canvas-activity/,
    'Agent work must no longer render as a centered floating pill above the canvas',
  );
  assert.match(
    mcpActivityFeedbackSource,
    /publish:[\s\S]*?Site publicado pelo MCP[\s\S]*?upsert_section[\s\S]*?notify: !reading/,
    'MCP feedback copy must distinguish publication and section work while suppressing read-completion toast noise',
  );
  assert.match(
    workspaceRevisionPollSource,
    /surfaceActivityFeedback[\s\S]*?toast\.loading\(presentation\.activeLabel[\s\S]*?toast\.error\(presentation\.errorLabel[\s\S]*?toast\.success\(presentation\.successLabel[\s\S]*?activity\.tool === 'publish'[\s\S]*?Abrir site[\s\S]*?activityEvents[\s\S]*?forEach\(surfaceActivityFeedback\)[\s\S]*?mcpActivityToastId\(status\.lastChange\.activityId\)/,
    'MCP polling must promote correlated active/event toasts to success or error and expose published sites directly',
  );
  assert.match(
    settingsAndMcpSource,
    /fetch\(wordpress\.projectConnectionUrl[\s\S]*?setMcpRemoteConfig\(payload\.remoteConfig\)[\s\S]*?navigator\.clipboard\.writeText\(payload\.remoteConfig\)[\s\S]*?data-kodety-mcp-skill-installer[\s\S]*?Copiar prompt de instalação[\s\S]*?Baixar pacote ZIP/,
    'Settings must create the project connection and keep the external Kodety skill installer visible beside it',
  );
  assert.match(
    settingsSource,
    /const loadMcpProjectConnections[\s\S]*?fetch\(wordpress\.projectConnectionUrl[\s\S]*?payload\.connections\.filter[\s\S]*?encodeURIComponent\(connectionId\)[\s\S]*?method: 'DELETE'/,
    'Settings must load project connections and revoke one encoded connection id through the authenticated endpoint',
  );
  assert.match(
    mcpSettingsContentSource,
    /interface McpProjectConnectionSummary[\s\S]*?name: string[\s\S]*?projectId: string[\s\S]*?currentProject: boolean[\s\S]*?data-kodety-mcp-project-connections[\s\S]*?Somente metadados seguros são exibidos[\s\S]*?projectConnections\.map[\s\S]*?onRevokeProjectConnection\(connection\.id\)/,
    'the MCP panel must render safe connection metadata and an individual revocation control',
  );
  assert.match(
    settingsAndMcpSource,
    /wordpress\.studio\?\.enabled[\s\S]*?MCP do Studio conectado[\s\S]*?data-kodety-mcp-studio-relay[\s\S]*?Copiar conexão deste projeto/,
    'the MCP panel must identify browser Studio projects and expose their public relay connection',
  );
  assert.doesNotMatch(
    mcpSettingsContentSource,
    /connection\.(?:token|secret|credential|remoteConfig)/i,
    'the MCP connection inventory must never render a token, secret or one-time remote configuration',
  );
  assert.match(
    settingsSource,
    /lazy\(\(\) =>[\s\S]*?import\('\.\/HtmlMcpSettingsContent'\)[\s\S]*?<HtmlMcpSettingsContent/,
    'the MCP setup surface must load only when the integrations section renders',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /fetch\(topbarWp\.mcpProjectConnectionUrl/,
    'the Builder MCP popover must not mint or copy a credential before opening Settings',
  );
  assert.match(
    projectEditorSource,
    /if \(replaceWordPressWorkspace && publishAbortControllerRef\.current\)[\s\S]*?Aguarde ou cancele a publicação antes de substituir o projeto/,
    'project replacement must be blocked while a release snapshot is publishing',
  );
  assert.match(
    topbarSource,
    /if \(topbarWp\?\.importZipUrl\) \{\s*void navigateAfterWordPressSave\(topbarWp\.importZipUrl\)/,
    'the extracted topbar wp-admin ZIP importer navigation must wait for the current workspace ACK',
  );
  const importPublishReviewSource = projectEditorSource.slice(
    projectEditorSource.indexOf('const [importPublishReviewPending'),
    projectEditorSource.indexOf('const shopifyImportNoticeShownRef'),
  );
  assert.match(
    importPublishReviewSource,
    /openPublishAfterImport[\s\S]*?paintedProjectOpenedAt !== project\.openedAt[\s\S]*?if \(config\.editorLockUrl && editorLockMode !== 'edit'\) return;[\s\S]*?url\.searchParams\.delete\('kodety_open_publish'\)[\s\S]*?setPublishPanelOpen\(true\)[\s\S]*?setImportPublishReviewPending\(false\)/,
    'a staged ZIP must wait for its authoritative canvas paint and edit authority before opening only the manual publish panel',
  );
  assert.doesNotMatch(
    importPublishReviewSource,
    /publishToWordPress|persistExactWordPressDraft|scheduleWordPressDraftWrite|fetch\(/,
    'the post-import handoff must never save or publish without an explicit click',
  );
  assert.doesNotMatch(
    projectEditorSource,
    /wordpressWorkspaceConflict|wordpressDraftConflictRef/,
    'legacy conflict state must be completely removed from editor input paths',
  );

  const typographyPanelFont = {
    id: 'project-font-neue-haas',
    name: 'neue-haas-display',
    family: 'Neue Haas Display',
    type: 'custom',
    variants: ['regular', '500', '500italic', '700italic'],
    weights: ['400', '500', '700'],
    category: 'sans-serif',
    aliases: ['NeueHaasDisplay', 'Neue Haas Display'],
    faces: [
      { weight: '400', style: 'normal' },
      { weight: '500', style: 'normal' },
      { weight: '500', style: 'italic' },
      { weight: '700', style: 'italic' },
    ],
    is_published: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  };
  assert.deepEqual(
    fontPanel.fontPanelWeightOptions(typographyPanelFont, 'medium'),
    [
      { value: '400', label: 'Regular · 400' },
      { value: '500', label: 'Medium · 500' },
      { value: '700', label: 'Bold · 700' },
    ],
    'ZIP font weights must use canonical numeric values and stable human labels without duplicate Medium entries',
  );
  assert.deepEqual(
    fontPanel.fontPanelStyleOptions(typographyPanelFont, '500', ''),
    [
      { value: 'normal', label: 'Normal' },
      { value: 'italic', label: 'Italic' },
    ],
    'the typography panel must expose only styles actually available for the selected ZIP face weight',
  );
  assert.equal(
    fontPanel.nearestFontPanelStyle(typographyPanelFont, '700', 'normal'),
    'italic',
    'selecting a weight that only ships italic must initialize the matching available style',
  );
  assert.equal(
    fontPanel.fontFamilySelectionValue(typographyPanelFont, '"NeueHaasDisplay", Helvetica, sans-serif', true),
    '"Neue Haas Display", Helvetica, sans-serif',
    'selecting a ZIP font by an internal CSS alias must persist its canonical family while retaining authored fallbacks',
  );
  assert.deepEqual(
    fontPanel.fontPanelAliases(typographyPanelFont),
    ['NeueHaasDisplay'],
    'the canonical family must not be repeated as its own CSS alias in the picker',
  );
  assert.deepEqual(
    fontPanel.fontPanelWeightOptions(undefined, '500').filter(option => option.value === '500'),
    [{ value: '500', label: 'Medium · 500' }],
    'a valid CSS weight must remain selected with the correct label before the ZIP catalog synchronizes',
  );
  assert.deepEqual(
    fontPanel.fontPanelWeightOptions(undefined, '450').find(option => option.value === '450'),
    { value: '450', label: '450' },
    'non-standard variable-font weights must remain valid without a duplicated numeric label',
  );
  assert.equal(
    fontPanel.nearestFontPanelWeight(typographyPanelFont, 'bolder'),
    'bolder',
    'relative CSS font weights must not be discarded during panel initialization',
  );
  const fontPickerPanelSource = await readFile(path.join(root, 'app/(builder)/kodety/components/FontPicker.tsx'), 'utf8');
  const typographyPanelSource = await readFile(path.join(root, 'app/(builder)/kodety/components/TypographyControls.tsx'), 'utf8');
  const tailwindClassMapperSource = await readFile(path.join(root, 'lib/tailwind-class-mapper.ts'), 'utf8');
  assert.match(
    fontPickerPanelSource,
    /fontFamilySelectionValue\([\s\S]*?preserveCssFallbacks/,
    'project font choices must save canonical families while retaining native CSS fallbacks',
  );
  assert.match(
    fontPickerPanelSource,
    /fontPanelAliases\(panelFont\)[\s\S]*?fontPanelAvailability\(panelFont\)[\s\S]*?Aliases CSS:[\s\S]*?renderFontSection\('Fontes do projeto', localProjectFonts, \{ detailed: true \}\)/,
    'project font choices must show their CSS aliases plus available faces',
  );
  assert.match(
    typographyPanelSource,
    /state\) => state\.fonts[\s\S]*?state\) => state\.projectFonts[\s\S]*?fontFamilyValueMatches[\s\S]*?fontPanelWeightOptions[\s\S]*?fontPanelStyleOptions/,
    'typography must subscribe to late ZIP catalog updates instead of reading only a stable store action',
  );
  assert.doesNotMatch(
    typographyPanelSource,
    /const getFontByFamily = useFontsStore/,
    'the selected ZIP family must re-render when project font discovery completes',
  );
  assert.match(
    typographyPanelSource,
    /nearestFontPanelWeight[\s\S]*?nearestFontPanelStyle[\s\S]*?property: 'fontFamily'[\s\S]*?property: 'fontWeight'[\s\S]*?property: 'fontStyle'/,
    'changing a family must initialize its supported weight and style atomically',
  );
  assert.match(
    typographyPanelSource,
    /data-design-token-property="font-style"[\s\S]*?styleOptions\.map/,
    'font style must be a first-class typography field populated from the selected ZIP face',
  );
  assert.match(
    typographyPanelSource,
    /<SettingsPanel[\s\S]*?title=\{isIcon \? 'Fill' : 'Typography'\}[\s\S]*?<Label variant="muted">Size<\/Label>[\s\S]*?<InputGroupInput[\s\S]*?value=\{fontSizeInput\}/,
    'the shared Typography panel must expose font size under the semantic section wrapper recognized by the token connector',
  );
  assert.match(
    htmlKodetyStyleControlsSource,
    /fontStyle: ["']font-style["'][\s\S]*?fontStyle: values\[["']font-style["']\] \|\| ["']normal["'][\s\S]*?function HtmlKodetyTypographyControls[\s\S]*?useHtmlKodetyLayer\(props\)[\s\S]*?<TypographyControls \{\.\.\.adapter\}/,
    'the native HTML panel must round-trip font-style and retain complete CSS fallback stacks',
  );
  assert.match(
    tailwindClassMapperSource,
    /fontStyle: \/\^\(italic\|not-italic\|\\\[font-style:[\s\S]*?case 'fontStyle':[\s\S]*?if \(cls === 'italic'\) design\.typography!\.fontStyle = 'italic'/,
    'the shared Kodety typography path must persist normal, italic and oblique style choices',
  );

  const interactionEasingControlSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/InteractionEasingControl.tsx'),
    'utf8',
  );
  assert.match(
    interactionEasingControlSource,
    /<PopoverContent[\s\S]*?w-\[min\(320px,calc\(100vw-20px\)\)\][\s\S]*?max-h-\[min\(520px,var\(--radix-popover-content-available-height\)\)\][\s\S]*?<header className="flex h-11[\s\S]*?role="tablist"[\s\S]*?grid h-8/,
    'the easing editor must keep its 320px by 520px compact popover, 44px header and 32px tab rail',
  );
  assert.match(
    interactionEasingControlSource,
    /selected \? 'bg-white\/\[\.13\] text-white'[\s\S]*?selected \? 'bg-white\/\[\.13\]'/,
    'curve, Bézier and spring presets must use a neutral selected surface',
  );
  assert.doesNotMatch(
    interactionEasingControlSource,
    /selected\s*\?\s*['"][^'"]*bg-\[var\(--kodety-accent\)\]/,
    'selected easing presets must reserve the accent for their curve and check instead of a violet fill',
  );
  assert.match(
    interactionEasingControlSource,
    /const handleTabKeyDown[\s\S]*?event\.key === 'ArrowRight'[\s\S]*?event\.key === 'ArrowLeft'[\s\S]*?event\.key === 'Home'[\s\S]*?event\.key === 'End'[\s\S]*?tabRefs\.current\[nextTab\]\?\.focus\(\)[\s\S]*?tabIndex=\{tab === key \? 0 : -1\}[\s\S]*?onKeyDown=\{event => handleTabKeyDown\(event, index\)\}/,
    'the easing tabs must implement roving focus with arrows, Home and End',
  );
  assert.match(
    interactionEasingControlSource,
    /const BEZIER_POINT_LABELS = \['X1', 'Y1', 'X2', 'Y2'\] as const[\s\S]*?grid h-8 grid-cols-4[\s\S]*?BEZIER_POINT_LABELS\.map[\s\S]*?type="number"[\s\S]*?min=\{index % 2 === 0 \? 0 : -0\.25\}[\s\S]*?max=\{index % 2 === 0 \? 1 : 1\.25\}[\s\S]*?aria-label=\{`Ponto \$\{label\} da curva Bézier`\}/,
    'the Bézier editor must expose four compact bounded numeric inputs for X1, Y1, X2 and Y2',
  );
  assert.match(
    interactionEasingControlSource,
    /const commitBezierPoint =[\s\S]*?setBezier\(next\)[\s\S]*?setPointDrafts\(bezierDrafts\(next\)\)[\s\S]*?onValueChange\(formatBezier\(next\)\)[\s\S]*?onBlur=\{\(\) => \{[\s\S]*?commitBezierPoint\(index\)[\s\S]*?event\.key === 'Enter'[\s\S]*?event\.currentTarget\.blur\(\)[\s\S]*?event\.key === 'Escape'[\s\S]*?skipBezierBlurCommitRef\.current = index[\s\S]*?setPointDrafts\(bezierDrafts\(bezier\)\)[\s\S]*?event\.currentTarget\.blur\(\)/,
    'numeric Bézier edits must commit on confirmation and restore the current curve on Escape',
  );

  const internalStyleEmitterPaths = [
    'Wordpress/kodety/templates/editor-shell.php',
    'Wordpress/kodety/theme-runtime/functions.php',
    'lib/html-editor/infinite-canvas-runtime.ts',
    'lib/html-editor/membership.ts',
    'lib/html-editor/native-runtime.ts',
    'app/(builder)/kodety/html-editor/components/HtmlAnalyticsPageInsights.tsx',
  ];
  for (const emitterPath of internalStyleEmitterPaths) {
    const emitterSource = await readFile(path.join(root, emitterPath), 'utf8');
    // Native overlay visibility is an explicit priority exception: authored
    // surfaces commonly carry inline display:grid/block, so the fail-closed
    // guard must outrank that declaration before interaction/runtime startup.
    // Keep the allowance scoped to exact visibility declarations inside a CSS
    // rule whose selector is explicitly an overlay selector.
    let priorityAuditSource = emitterSource.replace(/([^{}]*\[data-kodety-overlay[^{}]*\{)([^{}]*)(\})/gi, (_rule, selector, declarations, close) => {
      const auditedDeclarations = declarations.replace(
        /(display\s*:\s*(?:none|block|grid|flex|inline-block|inline-flex|table|flow-root|contents)|visibility\s*:\s*(?:hidden|visible)|pointer-events\s*:\s*(?:none|auto)|opacity\s*:\s*1|content-visibility\s*:\s*visible)\s*!\s*important\b/gi,
        '$1',
      );
      return `${selector}${auditedDeclarations}${close}`;
    });
    if (emitterPath === 'lib/html-editor/infinite-canvas-runtime.ts') {
      const runtimeAst = ts.createSourceFile(emitterPath, emitterSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const passiveBootstrap = runtimeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'infiniteCanvasPassiveRuntimeBootstrap');
      const passiveInjector = runtimeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'injectInfiniteCanvasPassiveRuntime');
      assert.ok(passiveBootstrap?.body && passiveInjector, 'passive viewport simulation must retain its isolated bootstrap/injection boundary');
      const passiveSource = passiveBootstrap.getText(runtimeAst);
      assert.match(passiveSource, /const VIEWPORT_VARIABLE = '--kodety-passive-viewport-unit';/);
      assert.match(passiveSource, /baseStyle\.setAttribute\('data-kodety-infinite-canvas-passive-style', 'base'\)/);
      assert.match(passiveSource, /simulationStyle\.setAttribute\('data-kodety-infinite-canvas-passive-style', 'simulations'\)/);
      assert.match(passiveSource, /document\.head\.append\(baseStyle, simulationStyle\)/);
      assert.match(passiveInjector.getText(runtimeAst), /inlineScriptSafe\(infiniteCanvasPassiveRuntimeBootstrap\.toString\(\)\)/);
      let refreshRuntimeStyles;
      const findRefreshStyles = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(runtimeAst) === 'refreshRuntimeStyles') refreshRuntimeStyles = node.initializer?.getText(runtimeAst);
        ts.forEachChild(node, findRefreshStyles);
      };
      findRefreshStyles(passiveBootstrap.body);
      assert.ok(refreshRuntimeStyles, 'passive style refresh must remain scoped inside the read-only reference bootstrap');
      // Only these two simulation declarations may outrank authored viewport
      // rules. Leave every other declaration in this same function audited.
      const allowedPassiveDeclarations = [
        'baseStyle.textContent = `:root{${VIEWPORT_VARIABLE}:${defaultViewportHeight / 100}px}html,body{height:auto!important}`;',
        '`[data-html-editor-path="${cssString(path)}"]{${VIEWPORT_VARIABLE}:${clampHeight(height) / 100}px!important}`',
      ];
      let auditedRefreshStyles = refreshRuntimeStyles;
      for (const declaration of allowedPassiveDeclarations) {
        assert.ok(auditedRefreshStyles.includes(declaration), 'only the existing passive height and viewport-variable priority declarations are allowed');
        auditedRefreshStyles = auditedRefreshStyles.replace(declaration, declaration.replace('!important', ''));
      }
      priorityAuditSource = priorityAuditSource.replace(refreshRuntimeStyles, auditedRefreshStyles);
    }
    assert.doesNotMatch(
      priorityAuditSource,
      /!\s*important\b/i,
      `${emitterPath} must never emit or contain CSS priority outside the exact overlay visibility and isolated passive viewport declarations`,
    );
    assert.doesNotMatch(
      emitterSource,
      /\.setProperty\([\s\S]{0,180}?,\s*['"]important['"]\s*\)/i,
      `${emitterPath} must never create priority through CSSStyleDeclaration`,
    );
  }
  assert.match(globalCssSource, /background-color:\s*transparent\s*!important/, 'Builder UI CSS may use priority to preserve its own outlined controls');
  assert.match(
    wordpressEditorCssSource,
    /body\.kodety-wordpress-editor[\s\S]*?!important/,
    'the WordPress Builder shell may use priority for isolated interface behavior',
  );
  assert.doesNotMatch(
    wordpressViteConfigSource,
    /noCssPrioritiesPlugin|declaration\.important\s*=\s*false/,
    'the WordPress build must not strip priority from Builder-only interface CSS',
  );
  assert.doesNotMatch(
    wordpressPackageScriptSource,
    /assertBuilderCssHasNoPriorities|CSS priority is forbidden in Builder assets/,
    'packaging must allow scoped priority in the isolated Builder interface bundle',
  );

  console.log('HTML editor regression tests passed');
} finally {
  await server.close();
}
