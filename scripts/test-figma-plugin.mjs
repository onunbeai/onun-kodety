import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFile = promisify(execFileCallback);
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

function fixtureNode(overrides = {}) {
  const sharedPluginData = new Map();
  return {
    id: 'fixture:node',
    name: 'Fixture node',
    type: 'RECTANGLE',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    rotation: 0,
    fills: [],
    strokes: [],
    effects: [],
    cornerRadius: 0,
    getCSSAsync: async () => ({}),
    getSharedPluginData(namespace, key) {
      return sharedPluginData.get(`${namespace}:${key}`) || '';
    },
    setSharedPluginData(namespace, key, value) {
      sharedPluginData.set(`${namespace}:${key}`, String(value));
    },
    ...overrides,
  };
}

function findClass(html, figmaId) {
  const match = html.match(new RegExp(`class="([^"]+)"[^>]+data-figma-id="${figmaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.ok(match, `expected an exported class for ${figmaId}`);
  return match[1];
}

function findRule(css, className) {
  const match = css.match(new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`));
  assert.ok(match, `expected a CSS rule for ${className}`);
  return match[1];
}

function findRules(css, className) {
  const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`\\.${escapedClassName}\\{([^}]*)\\}`, 'g'))]
    .map(match => match[1]);
}

function findImageAsset(payload, figmaId) {
  const className = findClass(payload.html, figmaId);
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const image = payload.html.match(new RegExp(`<img class="${escapedClass}"[^>]*\\bsrc="figma-asset:\\/\\/([^\"]+)"`));
  assert.ok(image, `expected an asset reference on image ${figmaId}`);
  const asset = payload.assets.find(candidate => candidate.id === image[1]);
  assert.ok(asset, `expected image ${figmaId} to reference a materialized asset`);
  return asset;
}

function validPngFixtureBytes() {
  return new Uint8Array(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ));
}

function validGifFixtureBytes() {
  return new Uint8Array(Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    'base64',
  ));
}

async function listFilesRecursively(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursively(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

async function assertOneWayPackage() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kodety-figma-package-'));
  const pluginFiles = [
    'manifest.json',
    'code.js',
    'ui.html',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
  ];
  try {
    const temporaryPlugin = path.join(temporaryRoot, 'FigmaPlugin');
    const temporaryDist = path.join(temporaryPlugin, 'dist');
    const temporaryMirror = path.join(temporaryDist, 'figma-to-kodety');
    await mkdir(temporaryMirror, { recursive: true });
    for (const file of pluginFiles) {
      await copyFile(path.join(root, 'FigmaPlugin', file), path.join(temporaryPlugin, file));
    }
    await writeFile(path.join(temporaryDist, 'figma-to-kodety-bridge.zip'), 'legacy bridge archive');
    await writeFile(path.join(temporaryMirror, 'stale.txt'), 'stale mirror file');

    await execFile(process.execPath, [path.join(root, 'scripts/package-figma-plugin.mjs')], {
      cwd: temporaryRoot,
    });

    const distEntries = await readdir(temporaryDist, { withFileTypes: true });
    assert.deepEqual(
      distEntries.filter(entry => entry.isFile() && entry.name.endsWith('.zip')).map(entry => entry.name).sort(),
      ['figma-to-kodety.zip'],
      'packaging must remove the obsolete bridge ZIP and emit only the one-way plugin ZIP',
    );
    assert.equal(
      distEntries.some(entry => entry.name === 'figma-to-kodety-bridge.zip'),
      false,
    );
    assert.equal(
      (await readdir(temporaryMirror)).includes('stale.txt'),
      false,
      'the extracted mirror must be rebuilt instead of retaining stale files',
    );

    const archive = await JSZip.loadAsync(
      await readFile(path.join(temporaryDist, 'figma-to-kodety.zip')),
    );
    assert.deepEqual(Object.keys(archive.files).sort(), [...pluginFiles].sort());
    for (const file of pluginFiles) {
      const source = await readFile(path.join(temporaryPlugin, file));
      const mirrored = await readFile(path.join(temporaryMirror, file));
      const archived = await archive.file(file).async('nodebuffer');
      assert.deepEqual(mirrored, source, `${file} must be current in the extracted mirror`);
      assert.deepEqual(archived, source, `${file} must be current in the official ZIP`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function assertLocalBridgeContract() {
  const bridgeRoot = path.join(root, 'FigmaPlugin/bridge');
  const bridgeFiles = await listFilesRecursively(bridgeRoot);
  if (bridgeFiles.length === 0) return;

  const relativeFiles = bridgeFiles.map(file => path.relative(bridgeRoot, file));
  assert.ok(relativeFiles.includes('server.js'), 'the URL import bridge must expose its local HTTP server');
  assert.ok(relativeFiles.includes('validation.js'), 'bridge request validation must remain side-effect-free and directly testable');
  assert.ok(relativeFiles.includes('network-policy.js'), 'the bridge must isolate public captures from private networks');

  const sourceFiles = bridgeFiles.filter(file => /\.(?:c|m)?js$/i.test(file));
  for (const file of sourceFiles) {
    await execFile(process.execPath, ['--check', file]);
  }

  const bridgeSource = (await Promise.all(sourceFiles.map(async file => [
    path.relative(bridgeRoot, file),
    await readFile(file, 'utf8'),
  ])))
    .map(([file, source]) => `/* ${file} */\n${source}`)
    .join('\n');

  assert.doesNotMatch(
    bridgeSource,
    /Access-Control-Allow-Origin[\s\S]{0,100}['"`]\*['"`]/i,
    'the local bridge must never grant wildcard CORS access',
  );
  assert.doesNotMatch(bridgeSource, /\beval\s*\(/, 'the bridge must not execute arbitrary JavaScript with eval');
  assert.doesNotMatch(bridgeSource, /\bnew\s+Function\b/, 'the bridge must not compile arbitrary JavaScript');
  assert.doesNotMatch(bridgeSource, /file:\/\//i, 'the bridge must not accept or navigate to local file URLs');
  assert.doesNotMatch(bridgeSource, /\/command(?:\b|['"`])/, 'the bridge must not expose a generic command endpoint');

  const serverSource = await readFile(path.join(bridgeRoot, 'server.js'), 'utf8');
  assert.match(serverSource, /127\.0\.0\.1/, 'the bridge must bind only to loopback');
  assert.doesNotMatch(serverSource, /0\.0\.0\.0/, 'the bridge must never bind to every network interface');
  assert.match(serverSource, /\/health/);
  assert.match(serverSource, /\/import/);
  assert.match(serverSource, /X-Kodety-Client/i);
  assert.match(serverSource, /X-Kodety-Bridge-Token/i);
  assert.match(serverSource, /pairingRequired:\s*true/);
  assert.match(serverSource, /timingSafeEqual/);
  assert.match(serverSource, /function generateBridgeToken\(/);
  assert.match(serverSource, /return \{ server, port, host: LOOPBACK_HOST, token \}/);
  const healthHandler = serverSource.slice(
    serverSource.indexOf("request.method === 'GET' && requestUrl.pathname === '/health'"),
    serverSource.indexOf("requestUrl.pathname !== '/import'"),
  );
  assert.doesNotMatch(
    healthHandler,
    /bridgeToken|Pairing token/i,
    'health discovery must never expose the bridge pairing secret',
  );

  const networkPolicySource = await readFile(path.join(bridgeRoot, 'network-policy.js'), 'utf8');
  assert.match(networkPolicySource, /public page tried to access a private or reserved network address/i);
  const browserSource = await readFile(path.join(bridgeRoot, 'browser.js'), 'utf8');
  assert.match(browserSource, /createNetworkPolicy/);

  const validationUrl = `${pathToFileURL(path.join(bridgeRoot, 'validation.js')).href}?test=${Date.now()}`;
  const { validateImportRequest } = await import(validationUrl);
  assert.equal(typeof validateImportRequest, 'function');
  const normalized = validateImportRequest({
    url: 'https://example.com/landing?preview=1',
    width: 1440,
    colorScheme: 'dark',
    rootSelector: 'main',
    frameName: 'Landing',
    hybridSnapshot: true,
  });
  assert.equal(normalized.width, 1440);
  assert.equal(normalized.colorScheme, 'dark');
  assert.doesNotThrow(() => validateImportRequest({ url: 'http://localhost:3000', width: 320 }));
  assert.doesNotThrow(() => validateImportRequest({ url: 'https://example.com', width: 3840 }));
  for (const invalid of [
    { url: 'file:///etc/passwd', width: 1440 },
    { url: 'javascript:alert(1)', width: 1440 },
    { url: 'https://example.com', width: 319 },
    { url: 'https://example.com', width: 3841 },
    { url: 'https://example.com', width: 1440, colorScheme: 'sepia' },
    { url: 'https://example.com', width: 1440, rootSelector: 'x'.repeat(513) },
    { url: 'https://example.com', width: 1440, frameName: 'x'.repeat(513) },
  ]) {
    assert.throws(() => validateImportRequest(invalid));
  }
}

async function executePluginFixture(pluginCode, responsiveMode = 'safe', selectionMode = 'multiple') {
  const svgFormats = [];
  const vectorExportSettings = [];
  const fallbackVectorExportSettings = [];
  const missingPatternVectorExportSettings = [];
  const filterVectorExportSettings = [];
  const lineVectorExportSettings = [];
  const specialVectorExportSettings = [];
  const rasterExportSettings = [];
  const originalImageExportSettings = [];
  const hiddenImageVectorExportSettings = [];
  let animatedGifExportCalls = 0;
  let tiledImageExportCalls = 0;
  const richText = fixtureNode({
    id: 'text:fill',
    name: 'Hero title',
    type: 'TEXT',
    x: 0,
    y: 0,
    width: 220,
    height: 60,
    absoluteBoundingBox: { x: 112, y: 212, width: 220, height: 60 },
    layoutSizingHorizontal: 'FILL',
    layoutSizingVertical: 'HUG',
    textAutoResize: 'HEIGHT',
    hasMissingFont: true,
    characters: 'Kodety type',
    boundVariables: {
      fills: [{ type: 'VARIABLE_ALIAS', id: 'variable:color' }],
      opacity: { type: 'VARIABLE_ALIAS', id: 'variable:string' },
    },
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
    fontName: { family: 'Fixture Sans', style: 'Italic' },
    fontSize: 24,
    fontWeight: 650,
    letterSpacing: { unit: 'PIXELS', value: 0 },
    lineHeight: { unit: 'PIXELS', value: 30 },
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'CENTER',
    textCase: 'UPPER',
    textDecoration: 'STRIKETHROUGH',
    getStyledTextSegments: () => [{
      characters: 'Kodety type',
      start: 0,
      end: 10,
      fontName: { family: 'Fixture Sans', style: 'Italic' },
      fontStyle: 'ITALIC',
      fontSize: 24,
      fontWeight: 650,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
      letterSpacing: { unit: 'PIXELS', value: 0 },
      lineHeight: { unit: 'PIXELS', value: 30 },
      textCase: 'UPPER',
      textDecoration: 'STRIKETHROUGH',
      hyperlink: { type: 'URL', value: 'https://example.com' },
      openTypeFeatures: { LIGA: true },
      indentation: 0,
      paragraphIndent: 0,
    }],
  });
  const constrained = fixtureNode({
    id: 'absolute:constraints',
    name: 'Pinned child',
    x: 20,
    y: 30,
    width: 100,
    height: 50,
    absoluteBoundingBox: { x: 120, y: 230, width: 100, height: 50 },
    layoutPositioning: 'ABSOLUTE',
    constraints: { horizontal: 'STRETCH', vertical: 'MAX' },
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
    getCSSAsync: async () => ({ width: '100px', height: '50px' }),
  });
  const centered = fixtureNode({
    id: 'absolute:centered',
    name: 'Centered child',
    x: 150,
    y: 125,
    width: 100,
    height: 50,
    absoluteBoundingBox: { x: 250, y: 325, width: 100, height: 50 },
    layoutPositioning: 'ABSOLUTE',
    constraints: { horizontal: 'CENTER', vertical: 'CENTER' },
  });
  const layeredFill = fixtureNode({
    id: 'paint:layers',
    name: 'Layered fill',
    width: 120,
    height: 80,
    absoluteBoundingBox: { x: 112, y: 280, width: 120, height: 80 },
    layoutMode: 'GRID',
    layoutSizingHorizontal: 'FIXED',
    layoutSizingVertical: 'FIXED',
    gridColumnCount: 2,
    gridRowCount: 1,
    gridColumnSizes: [{ type: 'FIXED', value: 40 }, { type: 'FLEX', value: 2 }],
    gridRowSizes: [{ type: 'HUG' }],
    gridColumnGap: 6,
    gridRowGap: 4,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    fills: [
      {
        type: 'GRADIENT_LINEAR',
        opacity: 0.5,
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        gradientTransform: [[1, 0, 0], [0, 1, 0]],
      },
      {
        type: 'IMAGE',
        imageHash: 'fixture-image',
        scaleMode: 'CROP',
        imageTransform: [[1, 0, 0.2], [0, 1, -0.1]],
      },
    ],
    children: [fixtureNode({
      id: 'paint:content',
      name: 'Content',
      width: 20,
      height: 20,
      absoluteBoundingBox: { x: 112, y: 280, width: 20, height: 20 },
    })],
    getCSSAsync: async () => ({
      background: '#000',
      'background-size': 'contain',
      'background-position': 'left top',
    }),
  });
  const vector = fixtureNode({
    id: 'vector:one',
    name: 'Vector mark',
    type: 'VECTOR',
    width: 24,
    height: 24,
    opacity: 0.5,
    rotation: 15,
    absoluteBoundingBox: { x: 240, y: 280, width: 24, height: 24 },
    // A vector may contain an image paint (for example, a clipped bitmap).
    // Image-painted vectors must use a native PNG, even below the SVG threshold.
    fills: [{ type: 'IMAGE', imageHash: 'fixture-image', scaleMode: 'FILL' }],
    exportAsync: async settings => {
      svgFormats.push(settings.format);
      vectorExportSettings.push(settings);
      if (settings.format === 'SVG_STRING') {
        return '<svg viewBox="0 0 24 24"><defs><image id="image0" href="data:image/png;base64,iVBORw0KGgo="/><pattern id="pattern0" width="1" height="1"><use href="#image0"/></pattern></defs><path opacity="0.5" fill="url(#pattern0)" d="M0 0h24v24z"/></svg>';
      }
      if (settings.format === 'PNG') return validPngFixtureBytes();
      throw new Error('Unsupported vector fixture export');
    },
  });
  const rasterImage = fixtureNode({
    id: 'image:raster',
    name: 'Raster photo',
    type: 'FRAME',
    x: 276,
    y: 280,
    width: 160,
    height: 90,
    opacity: 0.5,
    absoluteBoundingBox: { x: 376, y: 480, width: 160, height: 90 },
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'CENTER',
    counterAxisAlignItems: 'CENTER',
    itemSpacing: 16,
    counterAxisSpacing: 12,
    paddingTop: 24,
    paddingRight: 24,
    paddingBottom: 24,
    paddingLeft: 24,
    layoutSizingHorizontal: 'FILL',
    layoutSizingVertical: 'FIXED',
    layoutGrow: 1,
    clipsContent: true,
    fills: [{
      type: 'IMAGE',
      imageHash: 'fixture-image',
      scaleMode: 'CROP',
      opacity: 0.8,
      imageTransform: [[1, 0, 0.15], [0, 1, -0.1]],
    }],
    children: [],
    exportAsync: async settings => {
      rasterExportSettings.push(settings);
      if (settings.format === 'PNG' && settings.constraint.value > 1) {
        throw new Error('Fixture forces the adaptive 1x retry');
      }
      if (settings.format === 'PNG') return validPngFixtureBytes();
      throw new Error('Raster fixture only supports PNG');
    },
  });
  const vectorFallback = fixtureNode({
    id: 'vector:fallback',
    name: 'Vector fallback',
    type: 'BOOLEAN_OPERATION',
    x: 20,
    y: 220,
    width: 32,
    height: 32,
    absoluteBoundingBox: { x: 120, y: 420, width: 32, height: 32 },
    layoutPositioning: 'ABSOLUTE',
    constraints: { horizontal: 'STRETCH', vertical: 'STRETCH' },
    fills: [{ type: 'IMAGE', imageHash: 'fixture-image', scaleMode: 'FILL' }],
    exportAsync: async settings => {
      fallbackVectorExportSettings.push(settings);
      if (settings.format === 'PNG') return validPngFixtureBytes();
      const brokenSvg = settings.svgSimplifyStroke === false
        ? '<svg viewBox="0 0 32 32"><defs><image id="image0" href="data:image/png;base64,iVBORw0KGgo="/><pattern id="pattern0"></pattern></defs><path fill="url(#pattern0)" d="M0 0h32v32z"/></svg>'
        : '<svg viewBox="0 0 32 32"><defs><image id="image0" href="data:image/png;base64,iVBORw0KGgo="/><pattern id="good"><use href="#image0"/></pattern><pattern id="broken"><use href="#missing"/></pattern></defs><path fill="url(#good)" d="M0 0h16v32z"/><path fill="url(#broken)" d="M16 0h16v32z"/></svg>';
      if (settings.format === 'SVG_STRING') return brokenSvg;
      if (settings.format === 'SVG') return new Uint8Array(Buffer.from(brokenSvg));
      throw new Error('Unsupported forced-fallback export');
    },
  });
  const missingPatternVector = fixtureNode({
    id: 'vector:missing-pattern',
    name: 'Missing pattern vector',
    type: 'BOOLEAN_OPERATION',
    width: 36,
    height: 36,
    absoluteBoundingBox: { x: 540, y: 480, width: 36, height: 36 },
    fills: [{ type: 'IMAGE', imageHash: 'fixture-image', scaleMode: 'FILL' }],
    exportAsync: async settings => {
      missingPatternVectorExportSettings.push(settings);
      if (settings.format === 'PNG') return validPngFixtureBytes();
      const precise = '<svg viewBox="0 0 36 36"><defs><image id="image0" href="data:image/png;base64,iVBORw0KGgo="/><pattern id="validPattern" width="1" height="1"><use href="#image0"/></pattern></defs><path fill="url(#validPattern)" d="M0 0h18v36z"/><path fill="url(#missingPattern)" d="M18 0h18v36z"/></svg>';
      const compatible = '<svg viewBox="0 0 36 36"><defs><image id="image0" href="data:image/png;base64,iVBORw0KGgo="/><pattern id="validPattern" width="1" height="1"><use href="#image0"/></pattern></defs><path fill="url(#validPattern)" d="M0 0h36v36z"/></svg>';
      const output = settings.svgSimplifyStroke === false ? precise : compatible;
      if (settings.format === 'SVG_STRING') return output;
      if (settings.format === 'SVG') return new Uint8Array(Buffer.from(output));
      throw new Error('The valid compatibility SVG must win before PNG');
    },
  });
  const filterVector = fixtureNode({
    id: 'vector:filter',
    name: 'Filtered vector',
    type: 'POLYGON',
    width: 40,
    height: 40,
    absoluteBoundingBox: { x: 584, y: 480, width: 40, height: 40 },
    exportAsync: async settings => {
      filterVectorExportSettings.push(settings);
      if (settings.format === 'PNG') return validPngFixtureBytes();
      const invalid = '<svg viewBox="0 0 40 40"><defs><filter id="filter0"></filter></defs><path filter="url(#filter0)" d="M0 0h40v40z"/></svg>';
      const valid = '<svg viewBox="0 0 40 40"><path d="M0 0h40v40z"/></svg>';
      const output = settings.svgSimplifyStroke === false ? invalid : valid;
      if (settings.format === 'SVG_STRING') return output;
      if (settings.format === 'SVG') return new Uint8Array(Buffer.from(output));
      throw new Error('Filtered vector should remain SVG');
    },
  });
  const lineVector = fixtureNode({
    id: 'vector:line',
    name: 'Diagonal arrow',
    type: 'LINE',
    width: 200,
    height: 40,
    strokeWeight: 2,
    strokeCap: 'ARROW_LINES',
    startMarkerType: 'ARROW_EQUILATERAL',
    endMarkerType: 'ARROW_EQUILATERAL',
    absoluteBoundingBox: { x: 632, y: 500, width: 200, height: 40 },
    exportAsync: async settings => {
      lineVectorExportSettings.push(settings);
      if (settings.format === 'PNG') return validPngFixtureBytes();
      if (settings.format === 'SVG_STRING') {
        return '<svg viewBox="0 0 200 2"><path stroke="#000" stroke-width="2" d="M0 1h200"/></svg>';
      }
      throw new Error('Arrow line should use SVG_STRING');
    },
  });
  const originalImageFallback = fixtureNode({
    id: 'image:original-fallback',
    name: 'Original image fallback',
    type: 'FRAME',
    width: 180.5,
    height: 96.25,
    absoluteBoundingBox: { x: 840, y: 480, width: 180.5, height: 96.25 },
    layoutMode: 'HORIZONTAL',
    itemSpacing: 20,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    cornerRadius: 12,
    opacity: 0.8,
    fills: [{ type: 'IMAGE', imageHash: 'fixture-original', scaleMode: 'FILL', opacity: 0.5 }],
    children: [],
    exportAsync: async settings => {
      originalImageExportSettings.push(settings);
      throw new Error('Fixture forces original image fallback');
    },
  });
  const animatedGif = fixtureNode({
    id: 'image:animated-gif',
    name: 'Animated GIF',
    type: 'FRAME',
    width: 120,
    height: 80,
    opacity: 0.6,
    absoluteBoundingBox: { x: 1250, y: 480, width: 120, height: 80 },
    fills: [{ type: 'IMAGE', imageHash: 'fixture-gif', scaleMode: 'FILL' }],
    children: [],
    exportAsync: async () => {
      animatedGifExportCalls += 1;
      throw new Error('A simple original GIF must never be flattened to PNG');
    },
  });
  const tiledImage = fixtureNode({
    id: 'image:tiled',
    name: 'Tiled texture',
    type: 'FRAME',
    width: 180,
    height: 100,
    absoluteBoundingBox: { x: 1380, y: 480, width: 180, height: 100 },
    layoutMode: 'HORIZONTAL',
    itemSpacing: 16,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    fills: [{ type: 'IMAGE', imageHash: 'fixture-tile', scaleMode: 'TILE', scalingFactor: 0.5 }],
    children: [],
    exportAsync: async () => {
      tiledImageExportCalls += 1;
      throw new Error('A TILE paint must stay an original repeating background');
    },
  });
  const hiddenImageVector = fixtureNode({
    id: 'vector:hidden-image',
    name: 'Vector with hidden image',
    type: 'BOOLEAN_OPERATION',
    width: 48,
    height: 48,
    absoluteBoundingBox: { x: 1570, y: 480, width: 48, height: 48 },
    children: [fixtureNode({
      id: 'vector:hidden-image:child',
      name: 'Hidden bitmap',
      visible: false,
      fills: [{ type: 'IMAGE', imageHash: 'fixture-hidden', scaleMode: 'FILL' }],
    })],
    exportAsync: async settings => {
      hiddenImageVectorExportSettings.push(settings);
      if (settings.format === 'PNG') return validPngFixtureBytes();
      if (settings.format === 'SVG_STRING') {
        return '<svg viewBox="0 0 48 48"><path d="M0 0h48v48z"/></svg>';
      }
      throw new Error('A hidden bitmap must not force a visible SVG image');
    },
  });
  const arcVector = fixtureNode({
    id: 'vector:arc',
    name: 'Partial donut',
    type: 'ELLIPSE',
    width: 60,
    height: 60,
    absoluteBoundingBox: { x: 1030, y: 480, width: 60, height: 60 },
    arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.5 },
    exportAsync: async settings => {
      specialVectorExportSettings.push({ id: 'vector:arc', settings });
      if (settings.format === 'PNG') return validPngFixtureBytes();
      if (settings.format === 'SVG_STRING') {
        return '<svg viewBox="0 0 60 60"><path d="M30 0a30 30 0 0 1 0 60V45a15 15 0 0 0 0-30z"/></svg>';
      }
      throw new Error('Partial ellipse should use SVG_STRING');
    },
  });
  const textPathVector = fixtureNode({
    id: 'vector:text-path',
    name: 'Text on path',
    type: 'TEXT_PATH',
    width: 140,
    height: 40,
    absoluteBoundingBox: { x: 1100, y: 480, width: 140, height: 40 },
    characters: 'Kodety curve',
    exportAsync: async settings => {
      specialVectorExportSettings.push({ id: 'vector:text-path', settings });
      if (settings.format === 'PNG') return validPngFixtureBytes();
      if (settings.format === 'SVG_STRING') {
        return '<svg viewBox="0 0 140 40"><path d="M0 30Q70 0 140 30"/></svg>';
      }
      throw new Error('Text path should use SVG_STRING');
    },
  });
  const autoRoot = fixtureNode({
    id: 'root:auto',
    name: 'Auto root',
    type: 'FRAME',
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    minWidth: 240,
    maxWidth: 800,
    absoluteBoundingBox: { x: 100, y: 200, width: 400, height: 300 },
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'CENTER',
    counterAxisAlignContent: 'MAX',
    itemSpacing: 12,
    counterAxisSpacing: 18,
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    clipsContent: true,
    children: [
      richText,
      constrained,
      centered,
      layeredFill,
      vector,
      rasterImage,
      vectorFallback,
      missingPatternVector,
      filterVector,
      lineVector,
      originalImageFallback,
      arcVector,
      textPathVector,
      animatedGif,
      tiledImage,
      hiddenImageVector,
    ],
    exportAsync: async settings => {
      assert.equal(settings.format, 'JSON_REST_V1');
      return {
        document: {
          id: 'root:auto',
          name: 'Auto root',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          children: [
            { id: 'text:fill', name: 'Hero title', type: 'TEXT', characters: 'Kodety type' },
            { id: 'absolute:constraints', name: 'Pinned child', type: 'RECTANGLE' },
            { id: 'absolute:centered', name: 'Centered child', type: 'RECTANGLE' },
            { id: 'paint:layers', name: 'Layered fill', type: 'FRAME' },
            { id: 'vector:one', name: 'Vector mark', type: 'VECTOR' },
            { id: 'image:raster', name: 'Raster photo', type: 'FRAME', layoutMode: 'HORIZONTAL' },
            { id: 'vector:fallback', name: 'Vector fallback', type: 'BOOLEAN_OPERATION' },
            { id: 'vector:missing-pattern', name: 'Missing pattern vector', type: 'BOOLEAN_OPERATION' },
            { id: 'vector:filter', name: 'Filtered vector', type: 'POLYGON' },
            { id: 'vector:line', name: 'Diagonal arrow', type: 'LINE' },
            { id: 'image:original-fallback', name: 'Original image fallback', type: 'FRAME', layoutMode: 'HORIZONTAL' },
            { id: 'vector:arc', name: 'Partial donut', type: 'ELLIPSE', arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.5 } },
            { id: 'vector:text-path', name: 'Text on path', type: 'TEXT_PATH', characters: 'Kodety curve' },
            { id: 'image:animated-gif', name: 'Animated GIF', type: 'FRAME' },
            { id: 'image:tiled', name: 'Tiled texture', type: 'FRAME', layoutMode: 'HORIZONTAL' },
            {
              id: 'vector:hidden-image',
              name: 'Vector with hidden image',
              type: 'BOOLEAN_OPERATION',
              children: [{ id: 'vector:hidden-image:child', name: 'Hidden bitmap', type: 'RECTANGLE', visible: false }],
            },
          ],
        },
        components: {},
        componentSets: {},
        styles: {},
      };
    },
  });
  const inferredChild = fixtureNode({
    id: 'inferred:child',
    name: 'Inferred child',
    width: 80,
    height: 30,
    absoluteBoundingBox: { x: 600, y: 200, width: 80, height: 30 },
  });
  const geometryChild = fixtureNode({
    id: 'geometry:child',
    name: 'Geometry child',
    x: 0,
    y: 40,
    width: 80,
    height: 30,
    absoluteBoundingBox: { x: 600, y: 240, width: 80, height: 30 },
  });
  const inferredRoot = fixtureNode({
    id: 'root:inferred',
    name: 'Inferred root',
    type: 'FRAME',
    x: 600,
    y: 200,
    width: 200,
    height: 100,
    absoluteBoundingBox: { x: 600, y: 200, width: 200, height: 100 },
    layoutMode: 'NONE',
    inferredAutoLayout: responsiveMode === 'smart' ? null : {
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      itemSpacing: 8,
      paddingTop: 10,
      paddingRight: 10,
      paddingBottom: 10,
      paddingLeft: 10,
    },
    children: responsiveMode === 'smart' ? [inferredChild, geometryChild] : [inferredChild],
    exportAsync: async settings => {
      assert.equal(settings.format, 'JSON_REST_V1');
      return {
        document: {
          id: 'root:inferred',
          name: 'Inferred root',
          type: 'FRAME',
          layoutMode: 'NONE',
          children: [{ id: 'inferred:child', name: 'Inferred child', type: 'RECTANGLE' }],
        },
        components: {},
        componentSets: {},
        styles: {},
      };
    },
  });
  const carouselCards = [
    { id: 'carousel:card-left', x: -220, y: 0 },
    { id: 'carousel:card-top', x: 360, y: 0 },
    { id: 'carousel:card-bottom-left', x: 80, y: 300 },
    { id: 'carousel:card-bottom-right', x: 1260, y: 300 },
  ].map(({ id, x, y }) => fixtureNode({
    id,
    name: 'Testimonial card',
    type: 'FRAME',
    x,
    y,
    width: 520,
    height: 250,
    absoluteBoundingBox: { x: 100 + x, y: 460 + y, width: 520, height: 250 },
    layoutMode: 'NONE',
    fills: [{ type: 'SOLID', color: { r: 0.95, g: 0.93, b: 0.89 }, opacity: 1 }],
    children: [],
    getCSSAsync: async () => ({
      'flex-shrink': '1',
      order: '1',
    }),
  }));
  const carouselTrack = fixtureNode({
    id: 'carousel:track',
    name: 'Testimonials track',
    type: 'FRAME',
    x: 0,
    y: 260,
    width: 1440,
    height: 550,
    absoluteBoundingBox: { x: 100, y: 460, width: 1440, height: 550 },
    layoutMode: 'NONE',
    constraints: { horizontal: 'CENTER', vertical: 'MIN' },
    clipsContent: true,
    // This intentionally mirrors the broad Figma hint that caused the real
    // design to become a compressed flex-wrap grid in Kodety.
    inferredAutoLayout: {
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'WRAP',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      itemSpacing: 24,
      counterAxisSpacing: 40,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    },
    children: carouselCards,
    getCSSAsync: async () => ({
      display: 'flex',
      'flex-direction': 'row',
      'flex-wrap': 'wrap',
      gap: '24px',
      padding: '12px',
    }),
  });
  const carouselHeading = fixtureNode({
    id: 'carousel:heading',
    name: 'Heading 2 Testimonials',
    type: 'TEXT',
    x: 400,
    y: 100,
    width: 640,
    height: 70,
    absoluteBoundingBox: { x: 500, y: 300, width: 640, height: 70 },
    characters: "Don't take our word for it",
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
    fontName: { family: 'Arial', style: 'Regular' },
    fontSize: 56,
    fontWeight: 400,
    letterSpacing: { unit: 'PIXELS', value: 0 },
    lineHeight: { unit: 'PIXELS', value: 70 },
    textAlignHorizontal: 'CENTER',
    textAlignVertical: 'CENTER',
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    textAutoResize: 'NONE',
    constraints: { horizontal: 'CENTER', vertical: 'MIN' },
  });
  const carouselRoot = fixtureNode({
    id: 'carousel:root',
    name: 'Testimonials section',
    type: 'FRAME',
    x: 100,
    y: 200,
    width: 1440,
    height: 997,
    absoluteBoundingBox: { x: 100, y: 200, width: 1440, height: 997 },
    layoutMode: 'NONE',
    clipsContent: true,
    // Layer order is paint order (track first, heading last), while the
    // heading is visually above the track. Treating this as flex moves it.
    inferredAutoLayout: {
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'CENTER',
      itemSpacing: 100,
      paddingTop: 100,
      paddingRight: 0,
      paddingBottom: 187,
      paddingLeft: 0,
    },
    children: [carouselTrack, carouselHeading],
    getCSSAsync: async () => ({
      display: 'flex',
      'flex-direction': 'column',
      gap: '24px',
      'align-items': 'center',
      'max-width': '1440px',
      padding: '12px',
    }),
    exportAsync: async settings => {
      assert.equal(settings.format, 'JSON_REST_V1');
      return {
        document: {
          id: 'carousel:root',
          name: 'Testimonials section',
          type: 'FRAME',
          layoutMode: 'NONE',
          children: [
            { id: 'carousel:track', name: 'Testimonials track', type: 'FRAME', layoutMode: 'NONE' },
            { id: 'carousel:heading', name: 'Heading 2 Testimonials', type: 'TEXT' },
          ],
        },
        components: {},
        componentSets: {},
        styles: {},
      };
    },
  });
  const railCards = [0, 560, 1120].map((x, index) => fixtureNode({
    id: `rail:card-${index + 1}`,
    name: `Rail card ${index + 1}`,
    type: 'FRAME',
    x,
    y: 0,
    width: 520,
    height: 250,
    absoluteBoundingBox: { x: 100 + x, y: 200, width: 520, height: 250 },
    layoutSizingHorizontal: 'FIXED',
    layoutSizingVertical: 'FIXED',
    layoutMode: 'NONE',
    children: [],
  }));
  const railRoot = fixtureNode({
    id: 'rail:root',
    name: 'Testimonials carousel track',
    type: 'FRAME',
    x: 100,
    y: 200,
    width: 1440,
    height: 250,
    absoluteBoundingBox: { x: 100, y: 200, width: 1440, height: 250 },
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'NO_WRAP',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    itemSpacing: 40,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    clipsContent: true,
    children: railCards,
    exportAsync: async settings => {
      assert.equal(settings.format, 'JSON_REST_V1');
      return {
        document: {
          id: 'rail:root',
          name: 'Testimonials carousel track',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          layoutWrap: 'NO_WRAP',
          children: railCards.map(card => ({ id: card.id, name: card.name, type: 'FRAME', layoutMode: 'NONE' })),
        },
        components: {},
        componentSets: {},
        styles: {},
      };
    },
  });

  const messages = [];
  const eventHandlers = new Map();
  const pageEventHandlers = new Map();
  const localCollections = [
    { id: 'collection:alpha', name: 'Shared collection', defaultModeId: 'mode:alpha' },
    { id: 'collection:beta', name: 'Shared collection', defaultModeId: 'mode:beta' },
  ];
  const localVariableFixtures = [
    {
      id: 'variable:color',
      name: 'Shared name',
      variableCollectionId: 'collection:alpha',
      resolvedType: 'COLOR',
      valuesByMode: { 'mode:alpha': { r: 0.25, g: 0.5, b: 0.75, a: 1 } },
    },
    {
      id: 'variable:string',
      name: 'Shared name',
      variableCollectionId: 'collection:beta',
      resolvedType: 'STRING',
      valuesByMode: { 'mode:beta': 'Quoted "value" \\ path; }' },
    },
    {
      id: 'variable:unused',
      name: 'Unused local value',
      variableCollectionId: 'collection:alpha',
      resolvedType: 'FLOAT',
      valuesByMode: { 'mode:alpha': 999 },
    },
  ];
  const figma = {
    mixed: Symbol('mixed'),
    command: '',
    showUI() {},
    closePlugin() {},
    notify() {},
    on(eventName, handler) {
      eventHandlers.set(eventName, handler);
    },
    ui: {
      postMessage(message) {
        messages.push(message);
      },
      onmessage: null,
    },
    root: { name: 'Fixture document' },
    currentPage: {
      id: 'page:fixture',
      name: 'Fixture page',
      selection: selectionMode === 'auto-root'
        ? [autoRoot]
        : selectionMode === 'carousel-root'
          ? [carouselRoot]
          : selectionMode === 'rail-root'
            ? [railRoot]
          : [autoRoot, inferredRoot],
      on(eventName, handler) {
        pageEventHandlers.set(eventName, handler);
      },
      off(eventName, handler) {
        if (pageEventHandlers.get(eventName) === handler) pageEventHandlers.delete(eventName);
      },
    },
    variables: {
      getLocalVariablesAsync: async () => localVariableFixtures,
      getLocalVariableCollectionsAsync: async () => localCollections,
    },
    getImageByHash(hash) {
      assert.ok(['fixture-image', 'fixture-original', 'fixture-gif', 'fixture-tile'].includes(hash));
      return {
        getBytesAsync: async () => hash === 'fixture-gif'
          ? validGifFixtureBytes()
          : validPngFixtureBytes(),
      };
    },
  };
  const sandbox = {
    figma,
    __html__: '<main></main>',
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(pluginCode, sandbox, { filename: 'FigmaPlugin/code.js' });
  figma.ui.onmessage({ type: 'locale', locale: 'pt-BR' });
  figma.ui.onmessage({ type: 'locale', locale: 'en-US' });
  figma.ui.onmessage({
    type: 'export',
    options: { responsiveMode, includeRestScene: true },
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payloadMessage = messages.find(message => message.type === 'payload');
    if (payloadMessage) return {
      payload: payloadMessage.payload,
      svgFormats,
      vectorExportSettings,
      fallbackVectorExportSettings,
      missingPatternVectorExportSettings,
      filterVectorExportSettings,
      lineVectorExportSettings,
      specialVectorExportSettings,
      rasterExportSettings,
      originalImageExportSettings,
      hiddenImageVectorExportSettings,
      animatedGifExportCalls,
      tiledImageExportCalls,
      i18n: sandbox.KodetyFigmaI18n,
      messages,
      eventHandlers,
      pageEventHandlers,
      figma,
      nodes: {
        autoRoot,
        vector,
        vectorFallback,
        missingPatternVector,
        filterVector,
        lineVector,
        arcVector,
        textPathVector,
        animatedGif,
        tiledImage,
        hiddenImageVector,
        rasterImage,
        originalImageFallback,
        inferredRoot,
        carouselRoot,
        carouselTrack,
        carouselHeading,
        carouselCards,
        railRoot,
        railCards,
      },
    };
    const error = messages.find(message => message.type === 'error');
    if (error) throw new Error(error.message);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Figma plugin fixture export timed out');
}

class UiElementFixture {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.files = [];
    this.hidden = false;
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
    this.classList = { toggle() {} };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  querySelectorAll(selector) {
    return selector === '.segment' ? this.children : [];
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  select() {}

  remove() {}

  async dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ currentTarget: this });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function executeUiClipboardFixture(pluginUiScript) {
  const ids = [
    'selection-icon', 'selection-dot', 'selection-heading', 'selection-detail',
    'semantic-current', 'apply-semantic', 'primary-action', 'primary-label',
    'conversion-progress', 'progress-bar', 'progress-value', 'progress-label', 'progress-summary',
    'font-files', 'font-input', 'font-panel', 'font-count', 'diagnostics', 'download',
    'rest-stat', 'responsive-stat', 'fallback-stat', 'warning-count', 'warnings',
    'close', 'semantic-tag', 'responsive-mode',
  ];
  const elements = new Map(ids.map(id => [id, new UiElementFixture(id)]));
  const responsiveButtons = ['pixel', 'safe', 'smart'].map(mode => {
    const button = new UiElementFixture(`responsive-${mode}`);
    button.dataset.mode = mode;
    return button;
  });
  elements.get('responsive-mode').children = responsiveButtons;
  elements.get('semantic-tag').value = 'nav';

  const clipboardWrites = [];
  const execCommandCalls = [];
  const outboundMessages = [];
  const document = {
    documentElement: { lang: 'en' },
    body: new UiElementFixture('body'),
    getElementById(id) {
      const element = elements.get(id);
      assert.ok(element, `missing UI fixture element #${id}`);
      return element;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return new UiElementFixture(tagName);
    },
    execCommand(command) {
      execCommandCalls.push(command);
      return false;
    },
  };
  const sandbox = {
    document,
    navigator: {
      language: 'en-US',
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value);
        },
      },
    },
    parent: {
      postMessage(value) {
        outboundMessages.push(value.pluginMessage);
      },
    },
    URL,
    Blob,
    console,
    setTimeout,
    clearTimeout,
    onmessage: null,
  };
  vm.runInNewContext(pluginUiScript, sandbox, { filename: 'FigmaPlugin/ui.html' });
  assert.equal(typeof sandbox.onmessage, 'function');
  sandbox.onmessage({
    data: {
      pluginMessage: {
        type: 'i18n',
        locale: 'en',
        messages: {
          ready: 'Ready',
          convertFirstHelp: 'Convert first',
          analyzingSelection: 'Analyzing',
          largeLayouts: 'Working',
          convertedTitle: 'Package ready',
          convertedHelp: 'Review and copy',
          copyBuilder: 'Copy to clipboard',
          copied: 'Copied',
          pasteBuilder: 'Paste in Kodety',
          copiedNotify: 'Copied',
          noWarnings: 'No warnings',
        },
        selectionCount: 1,
        selectionKey: '0:root:auto',
        selectionNames: ['Hero'],
        selectionTags: ['section'],
      },
    },
  });

  const primary = elements.get('primary-action');
  await primary.dispatch('click');
  assert.equal(clipboardWrites.length, 0, 'requesting conversion must not touch the clipboard');
  assert.ok(
    outboundMessages.some(message => message.type === 'export'),
    'the first explicit click must request conversion',
  );

  const payload = {
    signature: '__kodety_figma__',
    version: 5,
    source: 'figma-plugin',
    exportId: 'ui-fixture',
    exportedAt: '2026-09-04T12:00:00.000Z',
    documentName: 'UI fixture',
    pageName: 'Home',
    html: '<section>Fixture</section>',
    css: '',
    assets: [],
    fonts: [],
    variables: [],
    warnings: [],
    stats: { nodes: 1, assets: 0, bytes: 26, restSnapshotNodes: 1, responsiveRules: 1 },
  };
  sandbox.onmessage({
    data: {
      pluginMessage: {
        type: 'payload',
        selectionKey: '0:root:auto',
        payload,
      },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(
    clipboardWrites.length,
    0,
    'receiving a converted payload must never copy automatically',
  );
  assert.equal(execCommandCalls.length, 0, 'receiving a payload must not call the legacy clipboard API');
  assert.equal(elements.get('primary-label').textContent, 'Copy to clipboard');

  await primary.dispatch('click');
  assert.deepEqual(execCommandCalls, ['copy']);
  assert.equal(clipboardWrites.length, 1, 'the second explicit click must copy the prepared payload');
  const copiedPayload = JSON.parse(clipboardWrites[0]);
  assert.equal(copiedPayload.version, 4, 'the clipboard must remain compatible with the deployed v4 Builder');
  assert.equal(copiedPayload.signature, payload.signature);
  assert.equal(copiedPayload.exportId, payload.exportId);
  assert.equal(copiedPayload.html, payload.html);
  assert.equal(copiedPayload.css, payload.css);
  assert.deepEqual(copiedPayload.assets, payload.assets);
  assert.deepEqual(copiedPayload.fonts, payload.fonts);
  assert.equal(copiedPayload.engine, undefined, 'internal converter metadata must not leak into the v4 envelope');
  assert.equal(copiedPayload.scene, undefined, 'the clipboard should contain compiled output, not the internal REST scene');
  assert.equal(copiedPayload.options, undefined);
  assert.equal(copiedPayload.provenance, undefined);
  return { clipboardWrites, elements, outboundMessages };
}

async function executeImportFixture(pluginCode) {
  const messages = [];
  const notifications = [];
  const svgSources = [];
  const imageBytes = [];
  const viewportTargets = [];
  const loadedFonts = [];
  const collections = [];
  const variables = [];
  const paintStyles = [];
  let nodeSequence = 0;
  let closePluginCalls = 0;
  let componentizeCalls = 0;
  let cancelOnProgress = false;
  let failNextFrameCreation = false;

  const page = {
    id: 'page:import',
    name: 'Import fixture',
    type: 'PAGE',
    children: [],
    selection: [],
  };
  const documentRoot = {
    id: 'document:import',
    name: 'Fixture document',
    type: 'DOCUMENT',
    children: [page],
  };
  page.parent = documentRoot;
  page.remove = function removePage() {
    detach(this);
  };

  const websiteCollection = {
    id: 'collection:website',
    name: 'Kodety / Website variables',
    defaultModeId: 'mode:website',
    modes: [{ modeId: 'mode:website', name: 'Mode 1' }],
    remove() {
      const index = collections.indexOf(this);
      if (index >= 0) collections.splice(index, 1);
      this.removed = true;
    },
  };
  collections.push(websiteCollection);
  const existingVariable = {
    id: 'variable:existing',
    name: 'existing',
    variableCollectionId: websiteCollection.id,
    resolvedType: 'STRING',
    valuesByMode: { 'mode:website': 'before' },
    setValueForMode(modeId, value) {
      this.valuesByMode[modeId] = value;
    },
    remove() {
      const index = variables.indexOf(this);
      if (index >= 0) variables.splice(index, 1);
      this.removed = true;
    },
  };
  variables.push(existingVariable);
  const originalStylePaint = {
    type: 'SOLID',
    color: { r: 0.1, g: 0.2, b: 0.3 },
    opacity: 1,
  };
  const existingStyle = {
    id: 'style:existing',
    name: 'Kodety / Website / ABCDEF',
    paints: [originalStylePaint],
    remove() {
      const index = paintStyles.indexOf(this);
      if (index >= 0) paintStyles.splice(index, 1);
      this.removed = true;
    },
  };
  paintStyles.push(existingStyle);

  function detach(node) {
    if (!node.parent || !Array.isArray(node.parent.children)) return;
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
    node.parent = null;
  }

  function createSceneNode(type) {
    const targetPage = figma.currentPage;
    const node = {
      id: `import:${++nodeSequence}`,
      name: type === 'TEXT' ? 'Text' : type === 'RECTANGLE' ? 'Rectangle' : 'Frame',
      type,
      parent: targetPage,
      children: type === 'FRAME' ? [] : undefined,
      x: 0,
      y: 0,
      width: type === 'TEXT' ? 1 : 100,
      height: type === 'TEXT' ? 16 : 100,
      fills: [],
      strokes: [],
      effects: [],
      opacity: 1,
      blendMode: 'NORMAL',
      cornerRadius: 0,
      layoutMode: type === 'FRAME' ? 'NONE' : undefined,
      layoutWrap: type === 'FRAME' ? 'NO_WRAP' : undefined,
      clipsContent: false,
      layoutGrow: 0,
      layoutAlign: 'INHERIT',
      hyperlink: null,
      rotation: 0,
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
      rangeCalls: {
        fills: [],
        fontSizes: [],
        fontNames: [],
        decorations: [],
      },
      resizeWithoutConstraints(width, height) {
        this.width = width;
        this.height = height;
      },
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
      appendChild(child) {
        assert.ok(Array.isArray(this.children));
        detach(child);
        this.children.push(child);
        child.parent = this;
      },
      insertChild(index, child) {
        assert.ok(Array.isArray(this.children));
        detach(child);
        this.children.splice(index, 0, child);
        child.parent = this;
      },
      remove() {
        detach(this);
      },
      setRangeFills(start, end, fills) {
        this.rangeCalls.fills.push({ start, end, fills });
      },
      setRangeFontSize(start, end, size) {
        this.rangeCalls.fontSizes.push({ start, end, size });
      },
      setRangeFontName(start, end, fontName) {
        this.rangeCalls.fontNames.push({ start, end, fontName });
      },
      setRangeTextDecoration(start, end, decoration) {
        this.rangeCalls.decorations.push({ start, end, decoration });
      },
    };
    targetPage.children.push(node);
    return node;
  }

  const figma = {
    mixed: Symbol('mixed'),
    command: 'import-url',
    showUI() {},
    closePlugin() {
      closePluginCalls += 1;
    },
    notify(message) {
      notifications.push(message);
    },
    ui: {
      postMessage(message) {
        messages.push(message);
        if (cancelOnProgress && message.type === 'import-progress' && message.progress > 50) {
          cancelOnProgress = false;
          figma.ui.onmessage({ type: 'close' });
          figma.ui.onmessage({ type: 'cancel-import' });
        }
      },
      onmessage: null,
    },
    root: documentRoot,
    currentPage: page,
    viewport: {
      scrollAndZoomIntoView(nodes) {
        viewportTargets.push(nodes);
      },
    },
    createFrame: () => {
      if (failNextFrameCreation) {
        failNextFrameCreation = false;
        throw new Error('fixture frame failure');
      }
      return createSceneNode('FRAME');
    },
    createRectangle: () => createSceneNode('RECTANGLE'),
    createText: () => {
      const node = createSceneNode('TEXT');
      node.characters = '';
      node.fontName = { family: 'Inter', style: 'Regular' };
      return node;
    },
    createNodeFromSvg(source) {
      svgSources.push(source);
      return createSceneNode('FRAME');
    },
    createImage(bytes) {
      imageBytes.push([...bytes]);
      return { hash: `fixture-image-${imageBytes.length}` };
    },
    loadFontAsync: async fontName => {
      loadedFonts.push(fontName);
    },
    loadAllPagesAsync: async () => {},
    createPage() {
      const createdPage = {
        id: `page:created:${documentRoot.children.length}`,
        name: 'Page',
        type: 'PAGE',
        parent: documentRoot,
        children: [],
        selection: [],
        remove() {
          detach(this);
        },
      };
      documentRoot.children.push(createdPage);
      return createdPage;
    },
    setCurrentPageAsync: async nextPage => {
      figma.currentPage = nextPage;
    },
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
      createVariableCollection(name) {
        const collection = {
          id: `collection:created:${collections.length}`,
          name,
          defaultModeId: `mode:created:${collections.length}`,
          modes: [{ modeId: `mode:created:${collections.length}`, name: 'Mode 1' }],
          remove() {
            const index = collections.indexOf(this);
            if (index >= 0) collections.splice(index, 1);
            this.removed = true;
          },
        };
        collections.push(collection);
        return collection;
      },
      createVariable(name, collection, resolvedType) {
        const variable = {
          id: `variable:created:${variables.length}`,
          name,
          variableCollectionId: collection.id,
          resolvedType,
          valuesByMode: {},
          setValueForMode(modeId, value) {
            this.valuesByMode[modeId] = value;
          },
          remove() {
            const index = variables.indexOf(this);
            if (index >= 0) variables.splice(index, 1);
            this.removed = true;
          },
        };
        variables.push(variable);
        return variable;
      },
      setBoundVariableForPaint(paint, property, variable) {
        return { ...paint, boundVariables: { [property]: { type: 'VARIABLE_ALIAS', id: variable.id } } };
      },
    },
    getLocalPaintStylesAsync: async () => paintStyles,
    createPaintStyle() {
      const style = {
        id: `style:created:${paintStyles.length}`,
        name: '',
        paints: [],
        remove() {
          const index = paintStyles.indexOf(this);
          if (index >= 0) paintStyles.splice(index, 1);
          this.removed = true;
        },
      };
      paintStyles.push(style);
      return style;
    },
    createComponentFromNode() {
      componentizeCalls += 1;
      throw new Error('componentization should be disabled by default');
    },
  };
  const sandbox = {
    figma,
    __html__: '<main></main>',
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(pluginCode, sandbox, { filename: 'FigmaPlugin/code.js' });
  figma.ui.onmessage({ type: 'locale', locale: 'en-US' });
  async function waitForImportOutcome(startIndex) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const outcome = messages.slice(startIndex).find(message => (
        message.type === 'import-result' || message.type === 'import-error'
      ));
      if (outcome) return outcome;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error('Figma plugin fixture URL import timed out');
  }

  const successfulImportStart = messages.length;
  figma.ui.onmessage({
    type: 'import-spec',
    spec: {
      type: 'frame',
      name: 'Imported landing',
      width: 640,
      height: 420,
      layout: 'VERTICAL',
      layoutWrap: 'WRAP',
      spacing: 16,
      counterAxisSpacing: 12,
      counterAxisAlign: 'BASELINE',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'FIXED',
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      fill: '#111111',
      children: [
        {
          type: 'text',
          name: 'Headline',
          characters: 'Editable headline',
          width: 360,
          fontFamily: 'Inter',
          fontWeight: 700,
          fontStyle: 'italic',
          fontSize: 32,
          color: '#ffffff',
          _componentGroupId: 'fixture:repeated',
          ranges: [{
            start: 0,
            end: 8,
            color: '#9393ff',
            fontSize: 34,
            fontFamily: 'Inter',
            fontWeight: 500,
            fontStyle: 'italic',
            textDecoration: 'UNDERLINE',
          }],
        },
        {
          type: 'image',
          name: 'Hero image',
          width: 240,
          height: 120,
          _imageBytes: 'data:image/png;base64,iVBORw0KGgo=',
          imageScaleMode: 'FILL',
          imagePosition: { x: 0.2, y: 0.8 },
          _componentGroupId: 'fixture:repeated',
        },
        {
          type: 'svg',
          name: 'Vector mark',
          width: 24,
          height: 24,
          _svg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>',
          _color: '#9393ff',
        },
      ],
    },
    options: { frameName: 'Imported section', componentize: false },
  });
  const resultMessage = await waitForImportOutcome(successfulImportStart);
  assert.equal(resultMessage.type, 'import-result', resultMessage.message);
  const rootNode = page.selection[0];
  assert.ok(rootNode, 'the imported root must become the active Figma selection');
  assert.equal(rootNode.type, 'FRAME');
  assert.equal(rootNode.name, 'Imported section');
  assert.equal(rootNode.layoutMode, 'VERTICAL');
  assert.equal(rootNode.layoutWrap, 'WRAP');
  assert.equal(rootNode.itemSpacing, 16);
  assert.equal(rootNode.paddingTop, 24);
  assert.equal(rootNode.counterAxisAlignItems, 'BASELINE');
  assert.equal(rootNode.primaryAxisSizingMode, 'AUTO');
  assert.equal(rootNode.counterAxisSizingMode, 'FIXED');
  assert.equal(rootNode.children.length, 3);
  const importedText = rootNode.children[0];
  assert.equal(importedText.type, 'TEXT');
  assert.equal(importedText.characters, 'Editable headline');
  assert.equal(importedText.fontName.family, 'Inter');
  assert.equal(importedText.fontName.style, 'Bold Italic');
  assert.deepEqual(importedText.rangeCalls.fills.map(call => [call.start, call.end]), [[0, 8]]);
  assert.deepEqual(importedText.rangeCalls.fontSizes, [{ start: 0, end: 8, size: 34 }]);
  assert.deepEqual(
    importedText.rangeCalls.fontNames.map(call => ({
      start: call.start,
      end: call.end,
      family: call.fontName.family,
      style: call.fontName.style,
    })),
    [{ start: 0, end: 8, family: 'Inter', style: 'Medium Italic' }],
  );
  assert.deepEqual(importedText.rangeCalls.decorations, [{
    start: 0,
    end: 8,
    decoration: 'UNDERLINE',
  }]);
  assert.ok(loadedFonts.some(font => font.family === 'Inter' && font.style === 'Bold Italic'));
  assert.ok(loadedFonts.some(font => font.family === 'Inter' && font.style === 'Medium Italic'));
  const importedImage = rootNode.children[1];
  assert.equal(importedImage.type, 'RECTANGLE');
  assert.equal(importedImage.fills[0].type, 'IMAGE');
  assert.equal(importedImage.fills[0].scaleMode, 'CROP');
  assert.deepEqual(Array.from(importedImage.fills[0].imageTransform, row => Array.from(row)), [
    [1, 0, 0.3],
    [0, 1, -0.30000000000000004],
  ]);
  assert.equal(rootNode.children[2].type, 'FRAME');
  assert.deepEqual(imageBytes, [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]);
  assert.equal(svgSources.length, 1);
  assert.match(svgSources[0], /#9393ff/);
  assert.equal(viewportTargets.length, 1);
  assert.equal(viewportTargets[0][0], rootNode);
  assert.equal(resultMessage.result.createdCount, 4);
  assert.equal(resultMessage.result.nodeId, rootNode.id);
  assert.equal(resultMessage.result.componentsCreated, 0);
  assert.equal(componentizeCalls, 0, 'the default-off component toggle must bypass component creation');
  assert.equal(notifications.length, 1);

  const childrenBeforeCancellation = page.children.length;
  const notificationsBeforeCancellation = notifications.length;
  const cancellationStart = messages.length;
  cancelOnProgress = true;
  figma.ui.onmessage({
    type: 'import-spec',
    spec: {
      type: 'frame',
      name: 'Cancelled root',
      width: 600,
      height: 600,
      layout: 'VERTICAL',
      children: Array.from({ length: 61 }, (_unused, index) => ({
        type: 'rect',
        name: `Partial ${index}`,
        width: 10,
        height: 10,
        fill: '#222222',
      })),
    },
    options: { componentize: false },
  });
  const cancelledMessage = await waitForImportOutcome(cancellationStart);
  assert.equal(cancelledMessage.type, 'import-error');
  assert.equal(cancelledMessage.cancelled, true);
  assert.match(cancelledMessage.message, /cancelled/i);
  assert.equal(page.children.length, childrenBeforeCancellation, 'a cancelled partial root must be removed');
  assert.equal(page.children.some(node => node.name === 'Cancelled root'), false);
  assert.equal(closePluginCalls, 0, 'closing the plugin must be blocked while native creation is active');
  assert.equal(notifications.length, notificationsBeforeCancellation + 1);
  assert.match(notifications.at(-1), /cannot close|cancel/i);

  const perNodeRangeLimitStart = messages.length;
  figma.ui.onmessage({
    type: 'import-spec',
    spec: {
      type: 'text',
      characters: 'Range limit',
      ranges: Array.from({ length: 1001 }, () => ({})),
    },
    options: { componentize: false },
  });
  const perNodeRangeError = await waitForImportOutcome(perNodeRangeLimitStart);
  assert.equal(perNodeRangeError.type, 'import-error');
  assert.match(perNodeRangeError.message, /style ranges/i);

  const totalRangeLimitStart = messages.length;
  figma.ui.onmessage({
    type: 'import-spec',
    spec: {
      type: 'frame',
      children: [
        ...Array.from({ length: 5 }, () => ({
          type: 'text',
          characters: 'Aggregate range limit',
          ranges: Array.from({ length: 1000 }, () => ({})),
        })),
        {
          type: 'text',
          characters: 'One range over',
          ranges: [{}],
        },
      ],
    },
    options: { componentize: false },
  });
  const totalRangeError = await waitForImportOutcome(totalRangeLimitStart);
  assert.equal(totalRangeError.type, 'import-error');
  assert.match(totalRangeError.message, /style ranges/i);
  assert.equal(page.children.length, childrenBeforeCancellation, 'range validation must fail before nodes are created');

  const pagesBeforeRollback = [...documentRoot.children];
  const variablesBeforeRollback = [...variables];
  const stylesBeforeRollback = [...paintStyles];
  const selectionBeforeRollback = [...page.selection];
  const rollbackStart = messages.length;
  failNextFrameCreation = true;
  figma.ui.onmessage({
    type: 'import-spec',
    spec: {
      type: 'frame',
      name: 'Rollback root',
      width: 400,
      height: 200,
      _cssVariables: {
        '--existing': 'after',
        '--created-color': '#9393ff',
      },
      _colorHistogram: [
        { hex: '#ABCDEF', count: 4 },
        { hex: '#123456', count: 2 },
      ],
      children: [],
    },
    options: { pageName: 'Rollback page', componentize: false },
  });
  const rollbackError = await waitForImportOutcome(rollbackStart);
  assert.equal(rollbackError.type, 'import-error');
  assert.equal(rollbackError.cancelled, false);
  assert.match(rollbackError.message, /fixture frame failure/);
  assert.equal(figma.currentPage, page);
  assert.deepEqual(documentRoot.children, pagesBeforeRollback);
  assert.equal(page.selection.length, selectionBeforeRollback.length);
  assert.ok(page.selection.every((node, index) => node === selectionBeforeRollback[index]));
  assert.deepEqual(variables, variablesBeforeRollback);
  assert.equal(existingVariable.valuesByMode['mode:website'], 'before');
  assert.deepEqual(paintStyles, stylesBeforeRollback);
  assert.equal(existingStyle.paints.length, 1);
  assert.equal(existingStyle.paints[0], originalStylePaint);
}

try {
  const figmaImport = await server.ssrLoadModule('/lib/figma/html-import.ts');
  const figmaTypes = await server.ssrLoadModule('/lib/figma/types.ts');
  const projectIo = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const payload = {
    signature: figmaTypes.KODETY_FIGMA_SIGNATURE,
    version: figmaTypes.KODETY_FIGMA_VERSION,
    source: 'figma-plugin',
    engine: { version: 5, sceneFormat: 'JSON_REST_V1' },
    exportId: 'fixture-01',
    sourceId: 'figma-home-hero',
    exportedAt: '2026-07-28T12:00:00.000Z',
    documentName: 'Fixture',
    pageName: 'Home',
    html: '<section class="kf-fixture" data-label="Hero" onclick="alert(1)"><img src="figma-asset://image-1" onerror="alert(1)"><script>alert(1)</script><h1>Design fiel</h1></section>',
    css: '.kf-fixture{background-image:url("figma-asset://image-1");width:1440px}@import url("https://invalid.example/a.css");',
    scene: {
      version: 1,
      format: 'JSON_REST_V1',
      roots: [{ document: { id: '1:2', type: 'FRAME', name: 'Hero' } }],
    },
    options: { responsiveMode: 'safe', includeRestScene: true },
    assets: [{
      id: 'image-1',
      name: 'hero.png',
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgo=',
      width: 1,
      height: 1,
    }],
    fonts: [{ family: 'Inter', style: 'Bold', weight: 700 }],
    variables: [],
    stats: {
      nodes: 3,
      assets: 1,
      bytes: 8,
      richTextSegments: 0,
      inferredAutoLayoutNodes: 0,
      geometryInferredAutoLayoutNodes: 0,
      missingFonts: 0,
      semanticNodes: 1,
      rasterizedNodes: 0,
      vectorFallbackNodes: 0,
      responsiveRules: 1,
      restSnapshotRoots: 1,
      restSnapshotNodes: 1,
    },
    warnings: [],
  };
  assert.equal(figmaTypes.isKodetyFigmaHtmlPayload(payload), true);
  assert.deepEqual(
    figmaImport.parseKodetyFigmaClipboard(JSON.stringify(payload)),
    payload,
    'the Builder must recognize the versioned plain-text clipboard package',
  );

  const project = projectIo.createBlankProject('Figma fixture');
  const progress = [];
  const imported = await figmaImport.importKodetyFigmaPayload(project, payload, {
    targetPath: '0',
    placement: 'inside',
    preferredStylesheetPath: 'styles.css',
    onProgress: entry => progress.push(entry),
  });
  const html = imported.project.files['index.html'].text;
  const css = imported.project.files['styles.css'].text;
  assert.equal(imported.selectionPath, '0/0');
  assert.match(html, /<main>\s*<section class="kf-fixture"/);
  assert.match(html, /src="assets\/figma\/fixture-01\/hero\.png"/);
  assert.doesNotMatch(html, /onclick|onerror|<script>alert/);
  assert.match(css, /KODETY_FIGMA:fixture-01:START/);
  assert.match(css, /url\("assets\/figma\/fixture-01\/hero\.png"\)/);
  assert.doesNotMatch(css, /@import/);
  assert.equal(
    imported.project.files['assets/figma/fixture-01/hero.png'].data.byteLength,
    8,
  );
  assert.deepEqual(
    progress.map(entry => entry.phase),
    ['prepare', 'assets', 'commit'],
    'large imports must expose deterministic progress phases while assets decode',
  );
  assert.deepEqual(imported.fonts, [{
    family: 'Inter',
    style: 'Bold',
    weight: 700,
    missing: false,
  }]);
  assert.deepEqual(imported.missingFonts, ['Inter']);
  assert.match(
    imported.warnings.join('\n'),
    /A face "Inter" não está disponível/,
    'font metadata from the plugin must identify families that need to be installed in the project',
  );

  const fontPayload = {
    ...payload,
    exportId: 'font-face',
    html: '<p class="kf-font">Tipografia exata</p>',
    css: '.kf-font{font-family:"Rubrika Neue Haas",Arial,sans-serif;font-style:italic;font-weight:500}',
    assets: [{
      id: 'font-rubrika-medium-italic',
      name: 'RubrikaNeueHaas-MediumItalic.woff2',
      mimeType: 'font/woff2',
      dataBase64: 'd09GMgAAAAA=',
    }],
    fonts: [{
      family: 'Rubrika Neue Haas',
      style: 'Medium Italic',
      weight: 500,
      missing: true,
      assetId: 'font-rubrika-medium-italic',
    }],
    fontUsage: [{
      family: 'Rubrika Neue Haas',
      style: 'Medium Italic',
      weight: 500,
      missing: true,
      assetId: 'font-rubrika-medium-italic',
      nodes: 2,
      characters: 41,
    }],
    hasMissingFont: true,
    stats: {
      ...payload.stats,
      nodes: 1,
      assets: 1,
      bytes: 8,
      richTextSegments: 1,
      missingFonts: 1,
    },
  };
  assert.equal(
    figmaTypes.isKodetyFigmaHtmlPayload(fontPayload),
    true,
    'the transport guard must accept exact face diagnostics and an explicitly attached font binary',
  );
  const fontImport = await figmaImport.importKodetyFigmaPayload(project, fontPayload, {
    targetPath: '0',
    preferredStylesheetPath: 'styles.css',
  });
  const fontPath = 'assets/figma/font-face/fonts/RubrikaNeueHaas-MediumItalic.woff2';
  assert.equal(fontImport.project.files[fontPath].data.byteLength, 8);
  assert.match(
    fontImport.project.files['styles.css'].text,
    /@font-face\{font-family:"Rubrika Neue Haas";src:url\("assets\/figma\/font-face\/fonts\/RubrikaNeueHaas-MediumItalic\.woff2"\) format\("woff2"\);font-style:italic;font-weight:500;font-display:swap;\}/,
    'attached licensed faces must become exact, project-local @font-face rules',
  );
  assert.deepEqual(
    fontImport.missingFonts,
    [],
    'an explicitly attached face must not be reported as missing even when Figma lacked it locally',
  );
  assert.doesNotMatch(
    fontImport.warnings.join('\n'),
    /não está disponível/,
    'the Builder must not silently fall back after the exact face was attached',
  );
  await assert.rejects(
    () => figmaImport.importKodetyFigmaPayload(project, {
      ...fontPayload,
      exportId: 'font-invalid',
      assets: [{
        ...fontPayload.assets[0],
        dataBase64: 'AAAAAAAAAAA=',
      }],
    }, {
      targetPath: '0',
      preferredStylesheetPath: 'styles.css',
    }),
    /não corresponde ao formato WOFF2/,
    'a mislabeled font must fail transactionally rather than producing a broken serif fallback',
  );
  assert.equal(
    project.files['assets/figma/font-invalid/fonts/RubrikaNeueHaas-MediumItalic.woff2'],
    undefined,
  );

  const projectWithStaleAsset = {
    ...imported.project,
    files: {
      ...imported.project.files,
      'assets/figma/fixture-01/stale.png': {
        path: 'assets/figma/fixture-01/stale.png',
        mimeType: 'image/png',
        data: new Uint8Array([1]),
      },
    },
  };
  const refreshedPayload = {
    ...payload,
    css: '.kf-fixture{background-image:url("figma-asset://image-1");width:720px}',
  };
  const importedAgain = await figmaImport.importKodetyFigmaPayload(projectWithStaleAsset, refreshedPayload, {
    targetPath: '0',
    placement: 'inside',
    preferredStylesheetPath: 'styles.css',
  });
  assert.equal(
    (importedAgain.project.files['styles.css'].text.match(/KODETY_FIGMA:fixture-01:START/g) || []).length,
    1,
    're-pasting one export must not duplicate its stylesheet block',
  );
  assert.match(importedAgain.project.files['styles.css'].text, /width:720px/);
  assert.doesNotMatch(
    importedAgain.project.files['styles.css'].text,
    /width:1440px/,
    're-pasting the same export must refresh stale CSS rather than keeping its first snapshot forever',
  );
  assert.equal(
    importedAgain.project.files['assets/figma/fixture-01/stale.png'],
    undefined,
    'refreshing one export must prune stale generated assets inside its reserved namespace',
  );
  assert.equal(importedAgain.selectionPath, '0/1');

  await assert.rejects(
    () => figmaImport.importKodetyFigmaPayload(project, {
      ...payload,
      assets: [...payload.assets, { ...payload.assets[0] }],
      stats: { ...payload.stats, assets: 2 },
    }, {
      targetPath: '0',
      preferredStylesheetPath: 'styles.css',
    }),
    /asset duplicado/,
    'duplicate asset ids must fail the whole import before a project snapshot is produced',
  );
  assert.equal(
    project.files['assets/figma/fixture-01/hero.png'],
    undefined,
    'a rejected transaction must leave its input project untouched',
  );
  await assert.rejects(
    () => figmaImport.importKodetyFigmaPayload(project, payload, {
      pagePath: '../../index.html',
      targetPath: '0',
    }),
    /sair da raiz do projeto/,
    'virtual project paths must not be allowed to traverse outside their root',
  );
  await assert.rejects(
    () => figmaImport.importKodetyFigmaPayload(project, {
      ...payload,
      html: '<img src="figma-asset://missing-asset">',
    }, {
      targetPath: '0',
      preferredStylesheetPath: 'styles.css',
    }),
    /asset\(s\) ausente\(s\)/,
    'corrupt packages with unresolved asset protocols must never leave broken URLs in the canvas',
  );

  const maliciousSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
    '<script>alert(1)</script>',
    '<foreignObject><iframe src="https://invalid.example"></iframe></foreignObject>',
    '<image href="https://invalid.example/tracker.png"/>',
    '<rect width="10" height="10" fill="red"/>',
    '</svg>',
  ].join('');
  const svgPayload = {
    ...payload,
    exportId: 'svg-base64',
    html: '<img src="figma-asset://vector-1" alt="">',
    css: '.kf-svg{background-image:url("https://invalid.example/tracker.png")}',
    assets: [{
      id: 'vector-1',
      name: '../unsafe.svg',
      mimeType: 'image/svg+xml',
      dataBase64: Buffer.from(maliciousSvg).toString('base64'),
    }],
    fonts: [],
    stats: { ...payload.stats, nodes: 1, assets: 1, bytes: maliciousSvg.length },
  };
  const svgImport = await figmaImport.importKodetyFigmaPayload(project, svgPayload, {
    targetPath: '0',
    preferredStylesheetPath: 'styles.css',
  });
  const svgAssetPath = Object.keys(svgImport.project.files).find(path =>
    path.startsWith('assets/figma/svg-base64/') && path.endsWith('.svg'));
  assert.ok(svgAssetPath);
  const sanitizedSvg = new TextDecoder().decode(svgImport.project.files[svgAssetPath].data);
  assert.doesNotMatch(sanitizedSvg, /script|foreignObject|onload|https:/i);
  assert.match(sanitizedSvg, /<rect/);
  assert.doesNotMatch(
    svgImport.project.files['styles.css'].text,
    /https:\/\/invalid\.example/,
    'CSS and base64-encoded SVGs must block executable or remote resource loads without flattening safe vector markup',
  );

  const gifBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const gifImport = await figmaImport.importKodetyFigmaPayload(project, {
    ...payload,
    exportId: 'gif-asset',
    html: '<img src="figma-asset://animated-1" alt="">',
    css: '',
    assets: [{
      id: 'animated-1',
      name: 'animated.gif',
      mimeType: 'image/gif',
      dataBase64: gifBytes.toString('base64'),
    }],
    fonts: [],
    stats: { ...payload.stats, nodes: 1, assets: 1, bytes: gifBytes.byteLength },
  }, {
    targetPath: '0',
    preferredStylesheetPath: 'styles.css',
  });
  const gifAssetPath = Object.keys(gifImport.project.files).find(file =>
    file.startsWith('assets/figma/gif-asset/') && file.endsWith('.gif'));
  assert.ok(gifAssetPath, 'GIF exports must remain valid GIF assets in the Builder');
  assert.equal(
    Buffer.from(gifImport.project.files[gifAssetPath].data).subarray(0, 6).toString('ascii'),
    'GIF89a',
  );

  const nestedProject = {
    ...project,
    mainHtmlPath: 'pages/home.html',
    files: {
      ...project.files,
      'pages/home.html': {
        path: 'pages/home.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head></head><body><main></main></body></html>',
      },
    },
  };
  const nested = await figmaImport.importKodetyFigmaPayload(nestedProject, payload, {
    pagePath: 'pages/home.html',
    targetPath: '0',
    preferredStylesheetPath: null,
  });
  assert.match(
    nested.project.files['pages/home.html'].text,
    /href="\.\.\/styles\.css"/,
    'nested pages must link an existing root stylesheet with a correct relative href',
  );
  assert.match(
    nested.project.files['pages/home.html'].text,
    /src="\.\.\/assets\/figma\/fixture-01\/hero\.png"/,
  );

  const htmlProjectEditor = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  assert.match(
    htmlProjectEditor,
    /figmaImportInFlightRef[\s\S]*?await importKodetyFigmaPayload\([\s\S]*?projectRevisionRef\.current !== baseRevision[\s\S]*?commitProject\(result\.project\)/,
    'the paste host must serialize Figma imports and reject a stale transaction before it can overwrite concurrent Builder edits',
  );

  const manifest = JSON.parse(await readFile(path.join(root, 'FigmaPlugin/manifest.json'), 'utf8'));
  const pluginCode = await readFile(path.join(root, 'FigmaPlugin/code.js'), 'utf8');
  const pluginUi = await readFile(path.join(root, 'FigmaPlugin/ui.html'), 'utf8');
  const pluginUiScript = pluginUi.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  assert.ok(pluginUiScript, 'The Figma UI script must be present.');
  new vm.Script(pluginUiScript, { filename: 'FigmaPlugin/ui.html' });
  const nativeFixture = await executePluginFixture(pluginCode);
  const nativePayload = nativeFixture.payload;
  const nativePayloadMessage = nativeFixture.messages.find(message => message.type === 'payload');
  assert.equal(nativePayloadMessage.selectionKey, '0:root:auto\u001froot:inferred');
  assert.equal(typeof nativeFixture.eventHandlers.get('selectionchange'), 'function');
  assert.equal(typeof nativeFixture.eventHandlers.get('currentpagechange'), 'function');
  assert.equal(typeof nativeFixture.pageEventHandlers.get('nodechange'), 'function');

  nativeFixture.figma.currentPage.selection = [nativeFixture.nodes.inferredRoot];
  nativeFixture.eventHandlers.get('selectionchange')();
  const selectionMessage = nativeFixture.messages.filter(message => message.type === 'selection').at(-1);
  assert.equal(selectionMessage.selectionKey, '0:root:inferred');
  assert.equal(selectionMessage.selectionCount, 1);

  const messagesBeforeEmptyNodeChange = nativeFixture.messages.length;
  nativeFixture.pageEventHandlers.get('nodechange')({ nodeChanges: [] });
  assert.equal(nativeFixture.messages.length, messagesBeforeEmptyNodeChange);
  nativeFixture.pageEventHandlers.get('nodechange')({ nodeChanges: [{ type: 'PROPERTY_CHANGE' }] });
  const nodeChangeMessage = nativeFixture.messages.filter(message => message.type === 'selection').at(-1);
  assert.equal(nodeChangeMessage.selectionKey, '1:root:inferred');

  const exportMessagesBeforeStaleRequest = nativeFixture.messages.filter(message => (
    message.type === 'progress' || message.type === 'payload' || message.type === 'error'
  )).length;
  nativeFixture.figma.ui.onmessage({ type: 'export', selectionKey: nativePayloadMessage.selectionKey });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(
    nativeFixture.messages.filter(message => (
      message.type === 'progress' || message.type === 'payload' || message.type === 'error'
    )).length,
    exportMessagesBeforeStaleRequest,
    'the main runtime must reject an export request for a stale selection revision',
  );
  const figmaI18n = nativeFixture.i18n;
  assert.deepEqual(
    Object.keys(figmaI18n['pt-BR']).sort(),
    Object.keys(figmaI18n.en).sort(),
    'Figma English and Portuguese catalogs must have exact key parity.',
  );
  for (const key of Object.keys(figmaI18n.en)) {
    assert.deepEqual(
      [...figmaI18n['pt-BR'][key].matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort(),
      [...figmaI18n.en[key].matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort(),
      `Figma locale placeholders must match for ${key}.`,
    );
  }
  const uiTranslationKeys = [
    ...pluginUi.matchAll(/data-i18n="([^"]+)"/g),
    ...pluginUi.matchAll(/\bt\('([^']+)'/g),
  ].map(match => match[1]);
  const mainTranslationKeys = [...pluginCode.matchAll(/\btranslate\('([^']+)'/g)].map(match => match[1]);
  for (const key of new Set([...uiTranslationKeys, ...mainTranslationKeys])) {
    assert.ok(figmaI18n.en[key], `Figma UI references missing English message ${key}.`);
    assert.ok(figmaI18n['pt-BR'][key], `Figma UI references missing Portuguese message ${key}.`);
  }
  assert.ok(
    nativeFixture.messages.some(message => message.type === 'i18n' && message.locale === 'pt-BR'),
    'The Figma main sandbox must negotiate Portuguese with the UI.',
  );
  assert.ok(
    nativeFixture.messages.some(message => message.type === 'i18n' && message.locale === 'en'),
    'The Figma main sandbox must normalize English regional locales.',
  );
  assert.doesNotMatch(
    pluginUi,
    /\b(?:Copiar|Converter|Selecione|Pronto|Fontes|Fechar|Baixar|Preparando|Conversão|Não)\b/,
    'The Figma UI English path must not contain fixed Portuguese copy.',
  );
  assert.doesNotMatch(
    JSON.stringify({
      warnings: nativePayload.warnings,
      runtime: nativeFixture.messages.filter(message => !['i18n', 'payload'].includes(message.type)),
    }),
    /\b(?:Não|Selecione|Preparando|Convertendo|Exportação|camadas|variáveis|Página)\b/,
    'The negotiated English Figma runtime must not emit Portuguese status copy.',
  );
  assert.equal(nativePayload.version, 5);
  assert.equal(nativePayload.engine.version, 5);
  assert.equal(nativePayload.engine.sceneFormat, 'JSON_REST_V1');
  assert.equal(nativePayload.options.responsiveMode, 'safe');
  assert.equal(nativePayload.scene.version, 1);
  assert.equal(nativePayload.scene.format, 'JSON_REST_V1');
  assert.equal(nativePayload.scene.roots.length, 2);
  assert.equal(nativePayload.stats.restSnapshotRoots, 2);
  assert.equal(nativePayload.stats.restSnapshotNodes, 20);
  assert.match(nativePayload.sourceId, /^figma-/);
  assert.match(nativePayload.html, /data-kodety-figma-source=/);
  assert.match(nativePayload.css, /@media \(max-width:810px\)/);
  assert.match(nativePayload.html, /data-label="Figma selection"/);
  assert.deepEqual(nativeFixture.svgFormats, ['PNG']);
  assert.match(nativePayload.css, /position:relative;isolation:isolate;width:700px;height:300px/);
  assert.equal(nativePayload.stats.rasterizedNodes, 9);
  assert.equal(nativePayload.stats.vectorFallbackNodes, 0);
  assert.equal(nativePayload.stats.imageFallbackNodes, 1);
  assert.equal(nativeFixture.vectorExportSettings.length, 1);
  assert.equal(nativeFixture.vectorExportSettings[0].format, 'PNG');
  assert.equal(nativeFixture.vectorExportSettings[0].contentsOnly, true);
  assert.equal(nativeFixture.vectorExportSettings[0].useAbsoluteBounds, true);
  assert.equal(nativeFixture.vectorExportSettings[0].constraint.value, 4);
  assert.deepEqual(
    Array.from(nativeFixture.fallbackVectorExportSettings, settings => settings.format),
    ['PNG'],
    'medium artwork uses high-resolution PNG immediately under the user-selected fidelity policy',
  );
  assert.equal(nativeFixture.fallbackVectorExportSettings[0].useAbsoluteBounds, true);
  assert.equal(nativeFixture.fallbackVectorExportSettings.at(-1).constraint.value, 4);
  assert.equal(nativeFixture.fallbackVectorExportSettings.at(-1).contentsOnly, true);
  assert.equal(nativeFixture.fallbackVectorExportSettings.at(-1).useAbsoluteBounds, true);
  assert.deepEqual(
    Array.from(nativeFixture.missingPatternVectorExportSettings, settings => settings.format),
    ['PNG'],
    'a medium patterned vector no longer depends on SVG paint-server compatibility',
  );
  assert.equal(nativeFixture.missingPatternVectorExportSettings[0].constraint.value, 4);
  assert.deepEqual(
    Array.from(nativeFixture.filterVectorExportSettings, settings => settings.format),
    ['PNG'],
    'a medium filtered vector uses its native pixels instead of SVG filters',
  );
  assert.equal(nativeFixture.filterVectorExportSettings[0].constraint.value, 4);
  assert.equal(nativeFixture.lineVectorExportSettings.length, 1);
  assert.equal(nativeFixture.lineVectorExportSettings[0].format, 'PNG');
  assert.equal(
    nativeFixture.lineVectorExportSettings[0].useAbsoluteBounds,
    false,
    'a stroked arrow line must keep its authored coordinate system so caps and markers are not clipped',
  );
  assert.deepEqual(
    Array.from(nativeFixture.specialVectorExportSettings, entry => [entry.id, entry.settings.format]),
    [['vector:arc', 'PNG'], ['vector:text-path', 'PNG']],
    'partial ellipses and text paths must retain their rendered pixels instead of empty/generic HTML boxes',
  );
  assert.deepEqual(
    Array.from(nativeFixture.rasterExportSettings, settings => settings.format),
    ['PNG', 'PNG', 'PNG'],
    'CROP uses progressive high-resolution PNG without fragile SVG serialization',
  );
  const rasterPngSettings = nativeFixture.rasterExportSettings.filter(settings => settings.format === 'PNG');
  assert.equal(rasterPngSettings.length, 3);
  assert.deepEqual(
    Array.from(rasterPngSettings, settings => settings.constraint.value),
    [4, 2, 1],
    'a failed high-density PNG must retry at 1x before using a lower-fidelity source fallback',
  );
  assert.ok(rasterPngSettings.every(settings => settings.constraint.type === 'SCALE'));
  assert.ok(nativeFixture.rasterExportSettings.every(settings => settings.contentsOnly === true));
  assert.ok(nativeFixture.rasterExportSettings.every(settings => settings.useAbsoluteBounds === true));
  assert.deepEqual(
    Array.from(nativeFixture.originalImageExportSettings, settings => settings.format),
    ['PNG', 'PNG', 'PNG'],
    'a translucent image paint tries native PNG at progressively smaller scales',
  );
  assert.deepEqual(
    Array.from(nativeFixture.originalImageExportSettings.filter(settings => settings.format === 'PNG'), settings => settings.constraint.value),
    [4, 2, 1],
    'a failed snapshot must exhaust 4x, 2x and 1x before preserving the original paint atomically',
  );
  assert.equal(nativeFixture.animatedGifExportCalls, 0);
  assert.equal(nativeFixture.tiledImageExportCalls, 0);
  assert.equal(nativeFixture.hiddenImageVectorExportSettings.length, 1);
  assert.equal(nativeFixture.hiddenImageVectorExportSettings[0].format, 'PNG');

  const nativeVectorClass = findClass(nativePayload.html, 'vector:one');
  const nativeVectorFallbackClass = findClass(nativePayload.html, 'vector:fallback');
  const nativeFilterVectorClass = findClass(nativePayload.html, 'vector:filter');
  const nativeLineVectorClass = findClass(nativePayload.html, 'vector:line');
  const nativeArcVectorClass = findClass(nativePayload.html, 'vector:arc');
  const nativeTextPathVectorClass = findClass(nativePayload.html, 'vector:text-path');
  const nativeRasterClass = findClass(nativePayload.html, 'image:raster');
  const nativeOriginalImageClass = findClass(nativePayload.html, 'image:original-fallback');
  const nativeAnimatedGifClass = findClass(nativePayload.html, 'image:animated-gif');
  const nativeTiledImageClass = findClass(nativePayload.html, 'image:tiled');
  const nativeHiddenImageVectorClass = findClass(nativePayload.html, 'vector:hidden-image');
  for (const [className, label] of [
    [nativeVectorClass, 'SVG vector'],
    [nativeVectorFallbackClass, 'rasterized vector fallback'],
    [nativeFilterVectorClass, 'filtered SVG vector'],
    [nativeLineVectorClass, 'arrow SVG line'],
    [nativeArcVectorClass, 'partial ellipse SVG'],
    [nativeTextPathVectorClass, 'text-path SVG'],
    [nativeRasterClass, 'raster image'],
    [nativeOriginalImageClass, 'original image fallback'],
    [nativeAnimatedGifClass, 'original animated GIF'],
    [nativeTiledImageClass, 'tiled original image'],
    [nativeHiddenImageVectorClass, 'vector with a hidden bitmap'],
  ]) {
    const rules = findRules(nativePayload.css, className);
    for (const responsive of rules.slice(1)) {
      assert.ok(responsive.split(';').filter(Boolean).every(declaration =>
        /^(?:max-width|min-width|height|aspect-ratio|width|flex-grow|flex-shrink|flex-basis):/.test(declaration)),
      `${label} may receive proportional responsive sizing, never container styles`);
    }
    assert.match(rules[0], /(?:^|;)display:block(?:;|$)/);
    assert.match(rules[0], /(?:^|;)margin:0(?:;|$)/);
    assert.match(rules[0], /(?:^|;)padding:0(?:;|$)/);
    assert.match(rules[0], /(?:^|;)border:0(?:;|$)/);
    assert.match(rules[0], /(?:^|;)background:none(?:;|$)/);
    assert.doesNotMatch(
      rules[0],
      /(?:^|;)(?:display:(?:flex|grid)|flex-direction:|flex-wrap:|gap:|row-gap:|column-gap:|justify-content:|align-items:|grid-template-columns:)/,
      `${label} must not inherit the exported frame's internal layout`,
    );
  }
  for (const className of [
    nativeVectorClass,
    nativeVectorFallbackClass,
    nativeFilterVectorClass,
    nativeLineVectorClass,
    nativeArcVectorClass,
    nativeTextPathVectorClass,
    nativeHiddenImageVectorClass,
  ]) {
    assert.match(findRule(nativePayload.css, className), /(?:^|;)object-fit:fill(?:;|$)/);
  }
  assert.match(findRule(nativePayload.css, nativeRasterClass), /(?:^|;)object-fit:fill(?:;|$)/);
  assert.match(findRule(nativePayload.css, nativeRasterClass), /(?:^|;)object-position:center(?:;|$)/);
  assert.doesNotMatch(findRule(nativePayload.css, nativeRasterClass), /(?:^|;)opacity:/);
  assert.match(findRule(nativePayload.css, nativeRasterClass), /(?:^|;)width:100%(?:;|$)/);
  assert.match(findRule(nativePayload.css, nativeRasterClass), /(?:^|;)flex-grow:1(?:;|$)/);
  assert.match(findRule(nativePayload.css, nativeRasterClass), /(?:^|;)min-width:0(?:;|$)/);
  const vectorFallbackRule = findRule(nativePayload.css, nativeVectorFallbackClass);
  assert.match(vectorFallbackRule, /(?:^|;)left:20px(?:;|$)/);
  assert.match(vectorFallbackRule, /(?:^|;)right:348px(?:;|$)/);
  assert.match(vectorFallbackRule, /(?:^|;)top:220px(?:;|$)/);
  assert.match(vectorFallbackRule, /(?:^|;)bottom:48px(?:;|$)/);
  assert.match(vectorFallbackRule, /(?:^|;)width:calc\(100% - 368px\)(?:;|$)/);
  assert.match(vectorFallbackRule, /(?:^|;)height:calc\(100% - 268px\)(?:;|$)/);
  const originalImageRule = findRule(nativePayload.css, nativeOriginalImageClass);
  assert.match(originalImageRule, /(?:^|;)width:180\.5px(?:;|$)/);
  assert.match(originalImageRule, /(?:^|;)height:96\.25px(?:;|$)/);
  assert.match(originalImageRule, /(?:^|;)object-fit:fill(?:;|$)/);
  assert.match(originalImageRule, /(?:^|;)border-radius:12px(?:;|$)/);
  assert.match(originalImageRule, /background-image:url\("figma-asset:\/\/image-/);
  assert.match(originalImageRule, /background-size:cover/);
  assert.match(originalImageRule, /(?:^|;)opacity:0\.4(?:;|$)/);
  assert.doesNotMatch(
    findRule(nativePayload.css, nativeVectorClass),
    /(?:^|;)border-radius:/,
    'a flattened SVG/PNG snapshot must not be clipped again by CSS radius',
  );
  assert.doesNotMatch(
    findRule(nativePayload.css, nativeVectorClass),
    /(?:^|;)(?:opacity:|transform:)/,
    'a flattened SVG snapshot must not apply its baked opacity or rotation twice',
  );
  assert.match(
    nativePayload.html,
    new RegExp(`<div class="${nativeOriginalImageClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+role="img"`),
    'a failed complex PNG export must stay an atomic painted box instead of restoring Auto Layout',
  );
  const animatedGifRule = findRule(nativePayload.css, nativeAnimatedGifClass);
  assert.match(animatedGifRule, /(?:^|;)object-fit:cover(?:;|$)/);
  assert.match(animatedGifRule, /(?:^|;)opacity:0\.6(?:;|$)/);
  assert.match(
    nativePayload.html,
    new RegExp(`<img class="${nativeAnimatedGifClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+src="figma-asset:\/\/image-`),
    'a simple GIF must stay an original <img> instead of becoming a static PNG',
  );
  const tiledImageRule = findRule(nativePayload.css, nativeTiledImageClass);
  assert.match(tiledImageRule, /background-image:url\("figma-asset:\/\/image-/);
  assert.match(tiledImageRule, /background-size:0\.5px 0\.5px/, 'TILE scales the 1px source by 0.5, independently of its 180px frame');
  assert.match(tiledImageRule, /background-repeat:repeat/);
  assert.match(nativePayload.html, new RegExp(`<div class="${nativeTiledImageClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(
    nativePayload.html,
    new RegExp(`class="${nativeRasterClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+width="160"[^>]+height="90"`),
    'atomic images must preserve intrinsic dimensions for stable Builder layout',
  );
  assert.ok(
    findImageAsset(nativePayload, 'vector:one').mimeType === 'image/png',
    'a vector with an image fill must preserve the exact composition as PNG',
  );
  assert.ok(
    findImageAsset(nativePayload, 'image:raster').mimeType === 'image/png',
    'a raster snapshot must be included as a PNG asset',
  );
  assert.ok(
    findImageAsset(nativePayload, 'vector:fallback').mimeType === 'image/png',
    'a medium vector uses PNG as a normal render choice',
  );
  assert.ok(
    findImageAsset(nativePayload, 'vector:filter').mimeType === 'image/png',
    'filtered vectors must preserve their native pixel output',
  );
  assert.ok(
    findImageAsset(nativePayload, 'vector:line').mimeType === 'image/png',
    'a medium stroked arrow line is a native PNG',
  );
  assert.ok(
    findImageAsset(nativePayload, 'vector:arc').mimeType === 'image/png',
    'a partial ellipse/donut must retain its authored silhouette',
  );
  assert.ok(
    findImageAsset(nativePayload, 'vector:text-path').mimeType === 'image/png',
    'text on a path must not become an empty HTML element',
  );
  assert.ok(
    findImageAsset(nativePayload, 'image:animated-gif').mimeType === 'image/gif',
    'an animated GIF must keep its original MIME type',
  );
  assert.ok(
    findImageAsset(nativePayload, 'vector:hidden-image').mimeType === 'image/png',
    'a medium artwork composition must render normally despite an invisible bitmap descendant',
  );
  assert.ok(
    nativePayload.assets.every(asset => !/fixture-hidden/.test(asset.name)),
    'an invisible bitmap descendant must not be materialized as an asset',
  );
  const atomicMediaRoundTrip = await figmaImport.importKodetyFigmaPayload(
    projectIo.createBlankProject('Atomic media round trip'),
    nativePayload,
    {
      targetPath: '0',
      placement: 'inside',
      preferredStylesheetPath: 'styles.css',
    },
  );
  const atomicMediaRoundTripCss = atomicMediaRoundTrip.project.files['styles.css'].text;
  const atomicMediaRoundTripHtml = atomicMediaRoundTrip.project.files['index.html'].text;
  for (const className of [
    nativeVectorClass,
    nativeVectorFallbackClass,
    nativeFilterVectorClass,
    nativeLineVectorClass,
    nativeArcVectorClass,
    nativeTextPathVectorClass,
    nativeRasterClass,
    nativeOriginalImageClass,
    nativeAnimatedGifClass,
    nativeTiledImageClass,
    nativeHiddenImageVectorClass,
  ]) {
    const rule = findRule(atomicMediaRoundTripCss, className);
    assert.match(rule, /(?:^|;)padding:0(?:;|$)/);
    assert.doesNotMatch(rule, /(?:^|;)display:(?:flex|grid)(?:;|$)/);
  }
  assert.match(findRule(atomicMediaRoundTripCss, nativeVectorClass), /(?:^|;)object-fit:fill(?:;|$)/);
  assert.match(findRule(atomicMediaRoundTripCss, nativeRasterClass), /(?:^|;)object-fit:fill(?:;|$)/);
  assert.match(findRule(atomicMediaRoundTripCss, nativeOriginalImageClass), /(?:^|;)object-fit:fill(?:;|$)/);
  assert.match(findRule(atomicMediaRoundTripCss, nativeAnimatedGifClass), /(?:^|;)object-fit:cover(?:;|$)/);
  assert.match(findRule(atomicMediaRoundTripCss, nativeTiledImageClass), /background-repeat:repeat/);
  assert.match(atomicMediaRoundTripHtml, /assets\/figma\//);

  const responsiveRootFixture = await executePluginFixture(pluginCode, 'safe', 'auto-root');
  const responsiveWrapperClass = responsiveRootFixture.payload.html.match(/^<div class="([^"]+)"/)?.[1];
  assert.ok(responsiveWrapperClass, 'a responsive single-root export must include its wrapper class');
  const responsiveWrapperRule = findRule(responsiveRootFixture.payload.css, responsiveWrapperClass);
  assert.match(
    responsiveWrapperRule,
    /(?:^|;)width:100%(?:;|$)/,
    'the responsive width must remain a plain editable value in the Builder width control',
  );
  assert.doesNotMatch(
    responsiveWrapperRule,
    /(?:^|;)max-width:/,
    'the desktop frame width must not become an artificial maximum for a responsive section',
  );
  assert.doesNotMatch(
    responsiveWrapperRule,
    /width:min\(/,
    'the exporter must not hide a maximum constraint inside the width value',
  );
  const responsiveRootClass = findClass(
    responsiveRootFixture.payload.html,
    'root:auto',
  );
  const responsiveRootRule = findRule(responsiveRootFixture.payload.css, responsiveRootClass);
  assert.match(
    responsiveRootRule,
    /(?:^|;)min-width:240px(?:;|$)/,
    'a real Figma minimum must remain an independent min-width constraint',
  );
  assert.match(
    responsiveRootRule,
    /(?:^|;)max-width:800px(?:;|$)/,
    'only an authored Figma maximum may populate the Builder max-width control',
  );
  assert.ok(
    findRules(responsiveRootFixture.payload.css, responsiveRootClass)
      .some(rule => /(?:^|;)width:100%(?:;|$)/.test(rule)),
    'the single responsive root must use the available Builder width',
  );

  const smartRootFixture = await executePluginFixture(pluginCode, 'smart', 'auto-root');
  const smartWrapperClass = smartRootFixture.payload.html.match(/^<div class="([^"]+)"/)?.[1];
  assert.ok(smartWrapperClass);
  const smartWrapperRule = findRule(smartRootFixture.payload.css, smartWrapperClass);
  assert.match(smartWrapperRule, /(?:^|;)width:100%(?:;|$)/);
  assert.doesNotMatch(smartWrapperRule, /(?:^|;)max-width:/);
  assert.doesNotMatch(smartWrapperRule, /width:min\(/);
  const smartRasterClass = findClass(smartRootFixture.payload.html, 'image:raster');
  const smartRasterRules = findRules(smartRootFixture.payload.css, smartRasterClass);
  assert.equal(smartRasterRules.length, 3, 'smart mode bounds atomic media and preserves its aspect ratio without stacking a compact row');
  assert.match(smartRasterRules[0], /(?:^|;)padding:0(?:;|$)/);
  assert.match(smartRasterRules[0], /(?:^|;)object-fit:fill(?:;|$)/);
  assert.doesNotMatch(
    smartRasterRules[0],
    /(?:^|;)(?:display:(?:flex|grid)|flex-direction:|flex-wrap:|gap:|row-gap:|column-gap:)/,
  );
  assert.match(smartRasterRules[0], /(?:^|;)width:100%(?:;|$)/);
  assert.match(smartRasterRules[1], /(?:^|;)max-width:100%(?:;|$)/);
  assert.match(smartRasterRules[2], /(?:^|;)height:auto(?:;|$)/);
  assert.match(smartRasterRules[2], /(?:^|;)aspect-ratio:160 \/ 90(?:;|$)/);
  for (const rule of smartRasterRules.slice(1)) {
    assert.doesNotMatch(rule, /(?:^|;)(?:padding|display|flex-direction|flex-wrap|gap|row-gap|column-gap):/);
  }

  const pixelRootFixture = await executePluginFixture(pluginCode, 'pixel', 'auto-root');
  const pixelWrapperClass = pixelRootFixture.payload.html.match(/^<div class="([^"]+)"/)?.[1];
  assert.ok(pixelWrapperClass);
  const pixelWrapperRule = findRule(pixelRootFixture.payload.css, pixelWrapperClass);
  assert.match(pixelWrapperRule, /(?:^|;)width:400px(?:;|$)/);
  assert.doesNotMatch(pixelWrapperRule, /(?:^|;)max-width:/);
  assert.doesNotMatch(pixelWrapperRule, /width:min\(/);

  const safeCarouselFixture = await executePluginFixture(pluginCode, 'safe', 'carousel-root');
  const safeCarouselRootClass = findClass(safeCarouselFixture.payload.html, 'carousel:root');
  const safeCarouselTrackClass = findClass(safeCarouselFixture.payload.html, 'carousel:track');
  const safeCarouselHeadingClass = findClass(safeCarouselFixture.payload.html, 'carousel:heading');
  const safeCarouselLeftCardClass = findClass(safeCarouselFixture.payload.html, 'carousel:card-left');
  const safeCarouselRightCardClass = findClass(safeCarouselFixture.payload.html, 'carousel:card-bottom-right');
  const safeCarouselRootRule = findRule(safeCarouselFixture.payload.css, safeCarouselRootClass);
  const safeCarouselTrackRule = findRule(safeCarouselFixture.payload.css, safeCarouselTrackClass);
  const safeCarouselHeadingRule = findRule(safeCarouselFixture.payload.css, safeCarouselHeadingClass);
  const safeCarouselLeftCardRule = findRule(safeCarouselFixture.payload.css, safeCarouselLeftCardClass);
  const safeCarouselRightCardRule = findRule(safeCarouselFixture.payload.css, safeCarouselRightCardClass);
  const safeCarouselWrapperClass = safeCarouselFixture.payload.html.match(/^<div class="([^"]+)"/)?.[1];
  assert.ok(safeCarouselWrapperClass);
  const safeCarouselWrapperRule = findRule(safeCarouselFixture.payload.css, safeCarouselWrapperClass);
  assert.match(safeCarouselWrapperRule, /(?:^|;)width:100%(?:;|$)/);
  assert.doesNotMatch(safeCarouselWrapperRule, /(?:^|;)max-width:/);
  assert.match(safeCarouselRootRule, /(?:^|;)position:absolute(?:;|$)/);
  assert.match(safeCarouselRootRule, /(?:^|;)width:1440px(?:;|$)/);
  assert.match(safeCarouselRootRule, /(?:^|;)height:997px(?:;|$)/);
  assert.match(safeCarouselRootRule, /(?:^|;)overflow:hidden(?:;|$)/);
  assert.doesNotMatch(safeCarouselRootRule, /(?:^|;)display:(?:flex|grid)(?:;|$)/);
  assert.doesNotMatch(safeCarouselRootRule, /(?:^|;)max-width:/);
  assert.match(safeCarouselRootRule, /(?:^|;)padding:0(?:;|$)/, 'the element reset must not introduce layout padding');
  assert.doesNotMatch(safeCarouselRootRule, /(?:^|;)padding:(?!0(?:;|$))/);
  assert.ok(
    findRules(safeCarouselFixture.payload.css, safeCarouselRootClass)
      .some(rule => /(?:^|;)width:100%(?:;|$)/.test(rule)),
    'an absolute single-root section must still fill the Builder breakpoint',
  );
  assert.match(safeCarouselTrackRule, /(?:^|;)position:absolute(?:;|$)/);
  assert.match(safeCarouselTrackRule, /(?:^|;)left:calc\(50% - 720px\)(?:;|$)/);
  assert.match(safeCarouselTrackRule, /(?:^|;)top:260px(?:;|$)/);
  assert.match(safeCarouselTrackRule, /(?:^|;)overflow:hidden(?:;|$)/);
  assert.doesNotMatch(safeCarouselTrackRule, /(?:^|;)display:(?:flex|grid)(?:;|$)/);
  assert.doesNotMatch(safeCarouselTrackRule, /(?:^|;)(?:flex-wrap|gap):/);
  assert.match(safeCarouselTrackRule, /(?:^|;)padding:0(?:;|$)/, 'the element reset must not introduce layout padding');
  assert.doesNotMatch(safeCarouselTrackRule, /(?:^|;)padding:(?!0(?:;|$))/);
  assert.match(safeCarouselHeadingRule, /(?:^|;)position:absolute(?:;|$)/);
  assert.match(safeCarouselHeadingRule, /(?:^|;)left:calc\(50% - 320px\)(?:;|$)/);
  assert.match(safeCarouselHeadingRule, /(?:^|;)top:100px(?:;|$)/);
  assert.match(safeCarouselLeftCardRule, /(?:^|;)position:absolute(?:;|$)/);
  assert.match(safeCarouselLeftCardRule, /(?:^|;)left:-220px(?:;|$)/);
  assert.match(safeCarouselLeftCardRule, /(?:^|;)width:520px(?:;|$)/);
  assert.doesNotMatch(safeCarouselLeftCardRule, /(?:^|;)flex-shrink:1(?:;|$)/);
  assert.match(safeCarouselRightCardRule, /(?:^|;)left:1260px(?:;|$)/);
  assert.match(safeCarouselRightCardRule, /(?:^|;)width:520px(?:;|$)/);
  assert.ok(
    safeCarouselFixture.payload.html.indexOf('data-figma-id="carousel:track"')
      < safeCarouselFixture.payload.html.indexOf('data-figma-id="carousel:heading"'),
    'safe mode must retain Figma paint order while CSS keeps the heading visually above the track',
  );
  assert.equal(safeCarouselFixture.payload.stats.inferredAutoLayoutNodes, 0);
  assert.equal(safeCarouselFixture.payload.stats.geometryInferredAutoLayoutNodes, 0);
  assert.ok(
    safeCarouselFixture.payload.warnings.some(warning => /Testimonials section/.test(warning)),
    'safe mode must explain when it preserves an absolute root for fidelity',
  );
  const carouselRoundTrip = await figmaImport.importKodetyFigmaPayload(
    projectIo.createBlankProject('Carousel round trip'),
    safeCarouselFixture.payload,
    {
      targetPath: '0',
      placement: 'inside',
      preferredStylesheetPath: 'styles.css',
    },
  );
  const carouselRoundTripHtml = carouselRoundTrip.project.files['index.html'].text;
  const carouselRoundTripCss = carouselRoundTrip.project.files['styles.css'].text;
  assert.ok(
    carouselRoundTripHtml.indexOf('data-figma-id="carousel:track"')
      < carouselRoundTripHtml.indexOf('data-figma-id="carousel:heading"'),
    'the Builder import must retain the Figma paint order without turning it into layout order',
  );
  assert.match(findRule(carouselRoundTripCss, safeCarouselRootClass), /(?:^|;)overflow:hidden(?:;|$)/);
  assert.doesNotMatch(
    findRule(carouselRoundTripCss, safeCarouselRootClass),
    /(?:^|;)display:(?:flex|grid)(?:;|$)/,
  );
  assert.match(findRule(carouselRoundTripCss, safeCarouselTrackClass), /(?:^|;)top:260px(?:;|$)/);
  assert.match(findRule(carouselRoundTripCss, safeCarouselTrackClass), /(?:^|;)overflow:hidden(?:;|$)/);
  assert.doesNotMatch(
    findRule(carouselRoundTripCss, safeCarouselTrackClass),
    /(?:^|;)display:(?:flex|grid)(?:;|$)/,
  );
  assert.match(findRule(carouselRoundTripCss, safeCarouselHeadingClass), /(?:^|;)top:100px(?:;|$)/);
  assert.match(
    findRule(carouselRoundTripCss, safeCarouselHeadingClass),
    /(?:^|;)left:calc\(50% - 320px\)(?:;|$)/,
  );
  assert.match(findRule(carouselRoundTripCss, safeCarouselLeftCardClass), /(?:^|;)left:-220px(?:;|$)/);

  const smartCarouselFixture = await executePluginFixture(pluginCode, 'smart', 'carousel-root');
  const smartCarouselRootClass = findClass(smartCarouselFixture.payload.html, 'carousel:root');
  const smartCarouselTrackClass = findClass(smartCarouselFixture.payload.html, 'carousel:track');
  const smartCarouselHeadingClass = findClass(smartCarouselFixture.payload.html, 'carousel:heading');
  const smartCarouselLeftCardClass = findClass(smartCarouselFixture.payload.html, 'carousel:card-left');
  const smartCarouselRootRule = findRule(smartCarouselFixture.payload.css, smartCarouselRootClass);
  const smartCarouselTrackRule = findRule(smartCarouselFixture.payload.css, smartCarouselTrackClass);
  const smartCarouselHeadingRule = findRule(smartCarouselFixture.payload.css, smartCarouselHeadingClass);
  const smartCarouselLeftCardRule = findRule(smartCarouselFixture.payload.css, smartCarouselLeftCardClass);
  assert.match(smartCarouselRootRule, /(?:^|;)display:flex(?:;|$)/);
  assert.match(smartCarouselRootRule, /(?:^|;)flex-direction:column(?:;|$)/);
  assert.match(smartCarouselRootRule, /(?:^|;)gap:90px(?:;|$)/);
  assert.match(smartCarouselRootRule, /(?:^|;)align-items:center(?:;|$)/);
  assert.match(smartCarouselRootRule, /(?:^|;)overflow:hidden(?:;|$)/);
  assert.ok(
    smartCarouselFixture.payload.html.indexOf('data-figma-id="carousel:heading"')
      < smartCarouselFixture.payload.html.indexOf('data-figma-id="carousel:track"'),
    'smart mode must use deterministic spatial order for a proven column',
  );
  assert.match(smartCarouselTrackRule, /(?:^|;)position:relative(?:;|$)/);
  assert.match(smartCarouselTrackRule, /(?:^|;)flex-shrink:0(?:;|$)/);
  assert.match(smartCarouselTrackRule, /(?:^|;)width:1440px(?:;|$)/);
  assert.match(smartCarouselTrackRule, /(?:^|;)overflow:hidden(?:;|$)/);
  assert.doesNotMatch(smartCarouselTrackRule, /(?:^|;)display:(?:flex|grid)(?:;|$)/);
  assert.match(smartCarouselHeadingRule, /(?:^|;)flex-shrink:0(?:;|$)/);
  assert.match(smartCarouselLeftCardRule, /(?:^|;)left:-220px(?:;|$)/);
  assert.equal(smartCarouselFixture.payload.stats.inferredAutoLayoutNodes, 0);
  assert.equal(smartCarouselFixture.payload.stats.geometryInferredAutoLayoutNodes, 1);
  assert.equal(
    findRules(smartCarouselFixture.payload.css, smartCarouselTrackClass)
      .some(rule => /(?:^|;)flex-(?:wrap:wrap|direction:column)(?:;|$)/.test(rule)),
    false,
    'an intentionally clipped testimonial track must never become a wrapping/vertical rail',
  );

  const smartRailFixture = await executePluginFixture(pluginCode, 'smart', 'rail-root');
  const smartRailRootClass = findClass(smartRailFixture.payload.html, 'rail:root');
  const smartRailCardClass = findClass(smartRailFixture.payload.html, 'rail:card-1');
  const smartRailRootRule = findRule(smartRailFixture.payload.css, smartRailRootClass);
  const smartRailCardRule = findRule(smartRailFixture.payload.css, smartRailCardClass);
  assert.match(smartRailRootRule, /(?:^|;)display:flex(?:;|$)/);
  assert.match(smartRailRootRule, /(?:^|;)flex-direction:row(?:;|$)/);
  assert.match(smartRailRootRule, /(?:^|;)gap:40px(?:;|$)/);
  assert.match(smartRailRootRule, /(?:^|;)overflow:hidden(?:;|$)/);
  assert.equal(
    findRules(smartRailFixture.payload.css, smartRailRootClass)
      .some(rule => /(?:^|;)flex-(?:wrap:wrap|direction:column)(?:;|$)/.test(rule)),
    false,
    'smart responsiveness must keep an authored clipped carousel on one row',
  );
  assert.match(smartRailCardRule, /(?:^|;)flex-grow:0(?:;|$)/);
  assert.match(smartRailCardRule, /(?:^|;)flex-shrink:0(?:;|$)/);
  assert.match(smartRailCardRule, /(?:^|;)flex-basis:auto(?:;|$)/);
  assert.match(smartRailCardRule, /(?:^|;)width:520px(?:;|$)/);

  const pixelCarouselFixture = await executePluginFixture(pluginCode, 'pixel', 'carousel-root');
  const pixelCarouselRootRule = findRule(
    pixelCarouselFixture.payload.css,
    findClass(pixelCarouselFixture.payload.html, 'carousel:root'),
  );
  const pixelCarouselHeadingRule = findRule(
    pixelCarouselFixture.payload.css,
    findClass(pixelCarouselFixture.payload.html, 'carousel:heading'),
  );
  const pixelCarouselLeftCardRule = findRule(
    pixelCarouselFixture.payload.css,
    findClass(pixelCarouselFixture.payload.html, 'carousel:card-left'),
  );
  assert.doesNotMatch(pixelCarouselRootRule, /(?:^|;)display:(?:flex|grid)(?:;|$)/);
  assert.match(pixelCarouselRootRule, /(?:^|;)overflow:hidden(?:;|$)/);
  assert.match(pixelCarouselHeadingRule, /(?:^|;)left:calc\(50% - 320px\)(?:;|$)/);
  assert.match(pixelCarouselHeadingRule, /(?:^|;)top:100px(?:;|$)/);
  assert.match(pixelCarouselLeftCardRule, /(?:^|;)left:-220px(?:;|$)/);
  assert.doesNotMatch(pixelCarouselFixture.payload.css, /@media \(max-width:/);
  assert.equal(pixelCarouselFixture.payload.stats.inferredAutoLayoutNodes, 0);
  assert.equal(pixelCarouselFixture.payload.stats.geometryInferredAutoLayoutNodes, 0);

  const autoRootRule = findRule(nativePayload.css, findClass(nativePayload.html, 'root:auto'));
  assert.match(autoRootRule, /position:absolute/);
  assert.match(autoRootRule, /left:0px/);
  assert.match(autoRootRule, /display:flex/);
  assert.match(autoRootRule, /flex-direction:row/);
  assert.match(autoRootRule, /row-gap:18px/);
  assert.match(autoRootRule, /column-gap:12px/);
  const inferredRootRule = findRule(nativePayload.css, findClass(nativePayload.html, 'root:inferred'));
  assert.match(inferredRootRule, /left:500px/);
  assert.doesNotMatch(inferredRootRule, /(?:^|;)display:(?:flex|grid)(?:;|$)/);
  assert.equal(nativePayload.stats.inferredAutoLayoutNodes, 0);
  assert.equal(nativePayload.stats.geometryInferredAutoLayoutNodes, 0);
  const inferredChildRule = findRule(nativePayload.css, findClass(nativePayload.html, 'inferred:child'));
  assert.match(inferredChildRule, /(?:^|;)position:absolute(?:;|$)/);
  assert.match(inferredChildRule, /(?:^|;)left:0px(?:;|$)/);
  assert.match(inferredChildRule, /(?:^|;)top:0px(?:;|$)/);
  const fillChildRule = findRule(nativePayload.css, findClass(nativePayload.html, 'text:fill'));
  assert.match(fillChildRule, /width:100%/);
  assert.match(fillChildRule, /min-width:0/);
  assert.doesNotMatch(fillChildRule, /height:60px/);
  assert.match(fillChildRule, /text-decoration:line-through/);
  assert.match(nativePayload.html, /font-style:italic/);
  assert.match(nativePayload.html, /href="https:\/\/example\.com"/);
  const constrainedRule = findRule(nativePayload.css, findClass(nativePayload.html, 'absolute:constraints'));
  assert.match(constrainedRule, /left:20px/);
  assert.match(constrainedRule, /right:280px/);
  assert.match(constrainedRule, /bottom:220px/);
  assert.doesNotMatch(constrainedRule, /width:100px/);
  const centeredRule = findRule(nativePayload.css, findClass(nativePayload.html, 'absolute:centered'));
  assert.match(centeredRule, /left:calc\(50% - 50px\)/);
  assert.match(centeredRule, /top:calc\(50% - 25px\)/);
  const paintRule = findRule(nativePayload.css, findClass(nativePayload.html, 'paint:layers'));
  assert.match(paintRule, /background-image:linear-gradient\([^;]+50%/);
  assert.match(paintRule, /url\("figma-asset:\/\/image-\d+"\)/);
  assert.match(paintRule, /background-size:auto,cover/);
  assert.match(paintRule, /background-position:center,30% 60%/);
  assert.doesNotMatch(paintRule, /(?:^|;)background:#000(?:;|$)/);
  assert.match(paintRule, /display:grid/);
  assert.match(paintRule, /grid-template-columns:40px 2fr/);
  assert.match(paintRule, /grid-template-rows:max-content/);
  assert.match(
    paintRule,
    /(?:^|;)flex-shrink:0(?:;|$)/,
    'fixed children in real Auto Layout must keep their Figma dimensions',
  );
  assert.equal(nativePayload.hasMissingFont, true);
  assert.equal(nativePayload.fontUsage[0].family, 'Fixture Sans');
  assert.equal(nativePayload.fontUsage[0].missing, true);
  assert.deepEqual(
    Array.from(nativePayload.variables, variable => variable.id).sort(),
    ['variable:color', 'variable:string'],
    'only variables actually bound inside the exported selection may enter the clipboard payload',
  );
  assert.equal(
    nativePayload.variables.some(variable => variable.id === 'variable:unused'),
    false,
  );
  const exportedColorVariable = nativePayload.variables.find(variable => variable.id === 'variable:color');
  const exportedStringVariable = nativePayload.variables.find(variable => variable.id === 'variable:string');
  assert.equal(exportedColorVariable.name, exportedStringVariable.name);
  assert.notEqual(
    exportedColorVariable.cssName,
    exportedStringVariable.cssName,
    'same-named variables from different collection/id identities must receive unique CSS names',
  );
  assert.ok(exportedColorVariable.cssName.startsWith('--kodety-token-figma-'));
  assert.ok(exportedStringVariable.cssName.startsWith('--kodety-token-figma-'));
  assert.equal(exportedColorVariable.tokenId, exportedColorVariable.cssName.replace('--kodety-token-', ''));
  assert.equal(exportedStringVariable.tokenId, exportedStringVariable.cssName.replace('--kodety-token-', ''));
  const serializedStringValue = `"${String(exportedStringVariable.value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
  assert.equal(serializedStringValue, '"Quoted \\"value\\" \\\\ path; }"');
  assert.doesNotMatch(nativePayload.css, /Unused local value|variable:unused/);
  assert.equal(nativePayload.assets.some(asset => asset.mimeType === 'image/svg+xml'), false,
    'this fixture has only medium or complex artwork; small simple SVG is covered separately');
  assert.equal(nativePayload.assets.some(asset => asset.mimeType === 'image/png'), true);
  assert.equal(manifest.documentAccess, 'dynamic-page');
  assert.equal(manifest.name, 'Figma to Kodety');
  assert.deepEqual(manifest.editorType, ['figma']);
  assert.deepEqual(
    manifest.networkAccess,
    { allowedDomains: ['none'] },
    'the one-way plugin must explicitly deny every network destination',
  );
  assert.deepEqual(
    manifest.menu,
    [{ name: 'Convert selection for Kodety', command: 'copy-selection' }],
    'the manifest must expose only the Figma to Kodety conversion command',
  );
  assert.match(pluginCode, /getStyledTextSegments/);
  assert.match(pluginCode, /inferredAutoLayout/);
  assert.doesNotMatch(
    pluginCode,
    /(?:const|let|var)\s+\w+\s*=\s*node\.inferredAutoLayout/,
    'the exporter must not promote Figma heuristic layout hints directly to CSS flow',
  );
  assert.match(pluginCode, /layoutSizingHorizontal/);
  assert.match(pluginCode, /SVG_STRING/);
  assert.match(pluginCode, /hasMissingFont/);
  assert.match(pluginCode, /node\.type !== 'TEXT'.*'fills' in node/s);
  assert.match(pluginCode, /variableReference\(context, solid, color\(solid\.color, solid\.opacity\), node\)/);
  assert.match(pluginCode, /getCSSAsync/);
  assert.match(pluginCode, /responsiveMode === 'pixel'/);
  assert.match(pluginCode, /responsiveMode !== 'smart'/);
  assert.match(pluginCode, /@media \(max-width:\$\{context\.responsiveNotebookMaxWidth \|\| 1200\}px\)/);
  assert.match(pluginCode, /@media \(max-width:810px\)/);
  assert.match(pluginCode, /@media \(max-width:410px\)/);
  assert.match(pluginCode, /function fontFamilyCss/);
  assert.match(pluginCode, /fontFamilyCss\(node\.fontName\.family\)/);
  assert.match(pluginCode, /fontFamilyCss\(segment\.fontName\.family\)/);
  assert.match(pluginCode, /ensureFontFallback\(normalizedValue\)/);
  assert.match(pluginCode, /Arial, Helvetica, sans-serif/);
  assert.match(pluginCode, /font-family:Arial,Helvetica,sans-serif/);
  assert.match(pluginCode, /function atomicMediaDeclarations/);
  assert.match(pluginCode, /'background:none'/);
  assert.match(pluginCode, /'padding:0'/);
  assert.match(pluginCode, /options\.objectFit \|\| 'fill'/);
  const renderNodeSource = pluginCode.slice(
    pluginCode.indexOf('async function renderNode'),
    pluginCode.indexOf('function estimateNodes'),
  );
  assert.ok(
    renderNodeSource.indexOf('const vectorAssetCandidate = shouldExportSvg(node)')
      < renderNodeSource.indexOf('...visualDeclarations(node, context)'),
    'SVG assets must be emitted before fill/background declarations are applied to their <img> box',
  );
  assert.match(pluginCode, /getLocalVariablesAsync/);
  assert.match(pluginCode, /getImageByHash/);
  assert.match(pluginCode, /exportAsync/);
  assert.match(pluginCode, /MAX_NODES = 100000/);
  assert.doesNotMatch(
    pluginCode,
    /\bText(?:Encoder|Decoder)\s*\(/,
    'the Figma main sandbox does not reliably expose browser TextEncoder/TextDecoder globals',
  );
  assert.match(pluginCode, /function utf8Decode/);
  assert.doesNotMatch(
    pluginCode,
    /\bfetch\s*\(/,
    'the one-way Figma runtime must not make HTTP requests',
  );
  assert.match(pluginCode, /exportAsync\(\{ format: 'JSON_REST_V1' \}\)/);
  assert.match(pluginCode, /sceneFormat: 'JSON_REST_V1'/);
  const pluginMessageHandler = pluginCode.slice(pluginCode.indexOf('figma.ui.onmessage = message =>'));
  assert.doesNotMatch(
    pluginMessageHandler,
    /message\.type === 'import-spec'/,
    'the public plugin message protocol must be one-way Figma to Kodety',
  );
  assert.match(pluginCode, /function currentSelectionKey\(\)/);
  assert.match(pluginCode, /requestedSelectionKey && requestedSelectionKey !== selectionKey\) return/);
  assert.match(pluginCode, /figma\.on\('selectionchange'/);
  assert.match(
    pluginCode,
    /observedPage\.on\('nodechange', handleCurrentPageNodeChange\)/,
  );
  assert.match(pluginCode, /MAX_RICH_TEXT_SEGMENTS = 50000/);
  assert.match(pluginCode, /MAX_RICH_TEXT_SEGMENTS_PER_NODE = 10000/);
  assert.match(pluginCode, /MAX_EXPORT_ASSET_BYTES = 64 \* 1024 \* 1024/);
  assert.match(pluginCode, /bytes\[4\] === 0x37 \|\| bytes\[4\] === 0x39/);
  assert.match(pluginCode, /bytes\[8\] === 0x57[\s\S]*?bytes\[11\] === 0x50/);
  assert.match(pluginCode, /collectVariableAliases\(value, target/);
  assert.match(pluginCode, /const included = new Set\(context\.usedVariableIds\)/);
  assert.match(pluginCode, /stableCssSuffix\(`\$\{variable\.variableCollectionId\}:\$\{variable\.id\}`\)/);
  assert.match(pluginUi, /data-i18n="semanticTitle"/);
  assert.match(pluginUi, /id="apply-semantic"/);
  assert.match(pluginUi, /id="semantic-tag"/);
  assert.equal(
    [...pluginUi.matchAll(/data-mode="(?:pixel|safe|smart)"/g)].length,
    3,
    'the UI must expose pixel, safe, and smart responsive strategies',
  );
  assert.match(
    pluginUi,
    /send\(\{ type: 'export', selectionKey: state\.selectionKey, options: \{ responsiveMode: state\.responsiveMode, includeRestScene: true \} \}\)/,
  );
  assert.match(pluginUi, /JSON_REST_V1/);
  assert.match(pluginUi, /async function copyPayloadFromUserClick\(payload\)/);
  assert.match(pluginUi, /navigator\.clipboard\.writeText\(json\)/);
  assert.match(pluginUi, /json\.length > 92 \* 1024 \* 1024/);
  assert.match(pluginUi, /totalBytes > 48 \* 1024 \* 1024/);
  assert.doesNotMatch(pluginUi, /\bfetch\s*\(/, 'the one-way UI must not perform HTTP requests');
  assert.doesNotMatch(pluginUi, /bridge|import URL/i, 'legacy URL import must not be exposed in the UI');
  const payloadHandlerStart = pluginUiScript.indexOf("if (message.type === 'payload' && currentExport)");
  assert.ok(payloadHandlerStart >= 0, 'the UI must handle converted payloads');
  const payloadHandler = pluginUiScript.slice(payloadHandlerStart);
  assert.doesNotMatch(
    payloadHandler,
    /copyPayloadFromUserClick|clipboard\.writeText|execCommand\('copy'\)/,
    'receiving a payload must only prepare it for a later explicit copy click',
  );
  const uiClipboardFixture = await executeUiClipboardFixture(pluginUiScript);
  const clipboardCompatibilityPayload = figmaImport.parseKodetyFigmaClipboard(
    uiClipboardFixture.clipboardWrites[0],
  );
  assert.ok(
    clipboardCompatibilityPayload,
    'the UI clipboard projection must pass the Builder transport validator',
  );
  assert.equal(clipboardCompatibilityPayload.version, 4);

  const pixelFixture = await executePluginFixture(pluginCode, 'pixel');
  assert.equal(pixelFixture.payload.options.responsiveMode, 'pixel');
  assert.equal(pixelFixture.payload.stats.inferredAutoLayoutNodes, 0);
  assert.equal(pixelFixture.payload.stats.geometryInferredAutoLayoutNodes, 0);
  assert.doesNotMatch(pixelFixture.payload.css, /@media\s*\(/);

  const smartFixture = await executePluginFixture(pluginCode, 'smart');
  assert.equal(smartFixture.payload.options.responsiveMode, 'smart');
  assert.equal(smartFixture.payload.stats.geometryInferredAutoLayoutNodes, 1);
  assert.match(smartFixture.payload.css, /@media \(max-width:410px\)/);

  nativeFixture.figma.ui.onmessage({ type: 'apply-semantic', tag: 'nav' });
  const semanticResult = nativeFixture.messages.filter(message => message.type === 'semantic-result').at(-1);
  assert.equal(semanticResult.ok, true);
  assert.deepEqual(semanticResult.selectionTags, ['nav']);
  assert.match(nativeFixture.nodes.inferredRoot.name, /#tag:nav$/);
  assert.equal(
    JSON.parse(nativeFixture.nodes.inferredRoot.getSharedPluginData('kodety', 'semantic')).tag,
    'nav',
  );
  const payloadCountBeforeSemanticExport = nativeFixture.messages.filter(message => message.type === 'payload').length;
  nativeFixture.figma.ui.onmessage({
    type: 'export',
    options: { responsiveMode: 'safe', includeRestScene: true },
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (nativeFixture.messages.filter(message => message.type === 'payload').length > payloadCountBeforeSemanticExport) break;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const semanticPayload = nativeFixture.messages.filter(message => message.type === 'payload').at(-1).payload;
  assert.match(semanticPayload.html, /<nav\b/);
  assert.match(semanticPayload.html, /aria-label="Inferred root"/);
  assert.match(semanticPayload.html, /data-kodety-section-id=/);
  nativeFixture.figma.ui.onmessage({ type: 'apply-semantic', tag: 'script' });
  assert.equal(nativeFixture.messages.filter(message => message.type === 'semantic-result').at(-1).ok, false);

  const packageScript = await readFile(path.join(root, 'scripts/package-figma-plugin.mjs'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageScript, /figma-to-kodety\.zip/);
  assert.doesNotMatch(packageScript, /buildBridgeArchive|bridgeFiles|Kodety Bridge created/);
  assert.match(packageScript, /rm\(legacyBridgeOutput, \{ force: true \}\)/);
  assert.match(packageScript, /rm\(pluginMirror, \{ recursive: true, force: true \}\)/);
  assert.match(packageJson.scripts['figma:zip'], /^npm run figma-plugin:test && /);
  await assertOneWayPackage();
  console.log('Figma to Kodety v5 producer, explicit clipboard, package, and transactional Builder tests passed.');
} finally {
  await server.close();
}
