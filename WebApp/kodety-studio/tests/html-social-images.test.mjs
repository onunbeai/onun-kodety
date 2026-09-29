import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import sharp from 'sharp';
import { codeComponentReactRuntimePlugin } from '../../../scripts/vite-code-component-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { prepareHtmlSocialImages, wrapSocialImageText } = await server.ssrLoadModule('/WebApp/kodety-studio/src/html-social-images.ts');
const { prepareStaticHtmlProject } = await server.ssrLoadModule('/lib/html-editor/static-project.ts');
const { updateEditorMetadata, readEditorMetadata } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
const { normalizeSocialImageTemplate } = await server.ssrLoadModule('/lib/html-editor/social-image.ts');
const { createLocale, defaultLocalization } = await server.ssrLoadModule('/lib/html-editor/localization.ts');
after(() => server.close());

const png = new Uint8Array(await sharp({ create: { width: 320, height: 320, channels: 4, background: '#38a169' } }).png().toBuffer());
const template = id => normalizeSocialImageTemplate({ id, width: 320, height: 320, elements: [] });
function project() {
  const html = '<!doctype html><html><head><title>Original</title><meta name="description" content="Keep description"><meta name="robots" content="noindex"><script type="application/ld+json">{"@type":"Article"}</script></head><body><h1>Unchanged body</h1></body></html>';
  return { name: 'My site', rootPath: '', mainHtmlPath: 'index.html', openedAt: 1, files: Object.fromEntries(['index.html', 'about.html'].map(path => [path, { path, text: html, mimeType: 'text/html' }])) };
}
function configured() {
  return updateEditorMetadata(project(), current => ({ ...current, siteSettings: { baseUrl: 'https://example.com/project', siteTitle: 'Site', socialImageTemplates: [template('site'), template('page')], socialImageTemplateId: 'site' }, pageSettings: { 'about.html': { title: 'About', socialImageTemplateId: 'page' } } }));
}

test('no template leaves imports byte-for-byte unchanged and does not render', async () => {
  const source = project();
  const output = await prepareHtmlSocialImages(source, { render: () => { throw new Error('Unexpected render'); } });
  assert.equal(output, source);
});

test('materializes inherited/page templates with real PNG assets, stable paths and targeted SEO', async () => {
  const source = configured();
  const prepared = prepareStaticHtmlProject(source);
  const original = JSON.stringify(prepared);
  const calls = [];
  const output = await prepareHtmlSocialImages(prepared, { sourceProject: source, render: async request => { calls.push(request); return png; } });
  assert.equal(JSON.stringify(prepared), original);
  assert.deepEqual(calls.map(request => request.template.id), ['site', 'page']);
  assert.deepEqual(readEditorMetadata(output), readEditorMetadata(prepared));
  assert.equal(calls[1].variables['page.title'], 'About · Site');
  const assets = Object.values(output.files).filter(file => file.mimeType === 'image/png');
  assert.equal(assets.length, 2);
  assert.deepEqual(assets[0].data, png);
  const html = output.files['about.html'].text;
  assert.match(html, /property="og:image" content="https:\/\/example.com\/project\/kodety-social\/[a-f0-9-]+\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:image:width" content="320"/);
  const withoutImageTags = text => text.replace(/<meta\b[^>]*(?:og:image[^"']*|twitter:image|twitter:card)[^>]*>/g, '').replace(/\s+/g, ' ');
  assert.equal(withoutImageTags(html), withoutImageTags(prepared.files['about.html'].text));
  const repeat = await prepareHtmlSocialImages(prepared, { sourceProject: source, render: async () => png });
  assert.deepEqual(Object.keys(repeat.files), Object.keys(output.files));
});

test('translated pages retain source page override and use translated social text', async () => {
  const source = updateEditorMetadata(configured(), current => ({ ...current, localization: { ...defaultLocalization('pt-BR'), translatePagePaths: true, locales: [createLocale('pt-BR'), { ...createLocale('en-US'), slug: 'en' }], translations: { 'en-US': { siteTitle: 'English site', pages: { 'about.html': { entries: {}, title: 'Translated', description: 'English summary', path: 'company' } } } } } }));
  const prepared = prepareStaticHtmlProject(source);
  const calls = [];
  const result = await prepareHtmlSocialImages(prepared, { sourceProject: source, render: async request => { calls.push(request); return png; } });
  const translated = calls.find(request => request.variables['page.title'] === 'Translated');
  assert.equal(translated.template.id, 'page');
  assert.equal(translated.referencePath, 'about.html');
  assert.equal(translated.variables['page.excerpt'], 'English summary');
  assert.equal(translated.variables['page.url'], 'https://example.com/project/en/company/');
  assert.equal(translated.variables['site.name'], 'English site');
  assert.match(result.files['en/company/index.html'].text, /https:\/\/example.com\/project\/kodety-social\//);
});

test('legacy embedded template works; duplicate imported image tags are replaced without altering other metadata', async () => {
  let source = project();
  source.files['index.html'].text = source.files['index.html'].text.replace('</head>', '<meta property="og:image" content="old.png"><meta content="duplicate.png" property="og:image"><meta property="og:image:secure_url" content="https://old.test/img.png"><link rel="canonical" href="https://example.com/site/"></head>');
  source = updateEditorMetadata(source, current => ({ ...current, pageSettings: { 'index.html': { socialImageTemplate: template('legacy') } } }));
  const result = await prepareHtmlSocialImages(source, { render: async () => png });
  assert.equal((result.files['index.html'].text.match(/property="og:image"/g) || []).length, 1);
  assert.doesNotMatch(result.files['index.html'].text, /duplicate\.png|old\.png|secure_url/);
  assert.match(result.files['index.html'].text, /https:\/\/example.com\/site\/kodety-social\//);
  assert.equal(result.files['about.html'], source.files['about.html']);
});

test('missing public URL and render failures reject without partially changing project', async () => {
  const source = configured();
  const noUrl = updateEditorMetadata(source, current => ({ ...current, siteSettings: { ...current.siteSettings, baseUrl: '' } }));
  await assert.rejects(prepareHtmlSocialImages(noUrl, { render: async () => png }), /URL pública/);
  const original = JSON.stringify(source);
  await assert.rejects(prepareHtmlSocialImages(source, { render: async () => { throw new Error('Image requires CORS'); } }), /Social Image de index\.html: Image requires CORS/);
  await assert.rejects(prepareHtmlSocialImages(source, { render: async () => new Uint8Array([1, 2]) }), /PNG válido/);
  assert.equal(JSON.stringify(source), original);
});

test('wrapping keeps explicit lines, wraps words and breaks oversized graphemes', () => {
  const context = { measureText: text => ({ width: [...text].length * 10 }) };
  assert.deepEqual(wrapSocialImageText(context, 'one two\n\nabcdef', 40, 0), ['one ', 'two', '', 'abcd', 'ef']);
  assert.deepEqual(wrapSocialImageText(context, 'abc', 31, 2), ['ab', 'c']);
});

test('real browser renders PNG pixels with local media/fonts, stacks, shadows, anchors and rejects missing/CORS assets', { skip: process.env.KODETY_SOCIAL_BROWSER_TEST !== '1', timeout: 90_000 }, async () => {
  const { chromium } = await import('@playwright/test');
  const http = createHttpServer((request, response) => {
    if (request.url === '/__social-test.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Social image test</title>'); }
    else server.middlewares(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${http.address().port}/__social-test.html`);
    const font = Array.from(await readFile(path.join(root, 'lib/html-editor/fonts/geist/Geist-Regular.ttf')));
    const result = await page.evaluate(async font => {
      const { renderHtmlSocialImage } = await import('/WebApp/kodety-studio/src/html-social-images.ts');
      const { normalizeSocialImageTemplate, createSocialImageElement } = await import('/lib/html-editor/social-image.ts');
      const base = normalizeSocialImageTemplate({ width: 640, height: 400, background: { color: '#ffffff' } });
      const shape = { ...createSocialImageElement('shape', base), id: 'shape', x: 20, y: 20, width: 90, height: 90, fill: '#ff0000', border: { color: '#000000', width: 3, radius: 8 }, shadow: { enabled: true, color: '#000000', opacity: .5, blur: 4, offsetX: 5, offsetY: 5 } };
      const image = { ...createSocialImageElement('image', base), id: 'image', x: 20, y: 20, horizontalAnchor: 'right', width: 90, height: 90, source: '/image.svg', fit: 'contain', border: { color: '#000000', width: 0, radius: 0 } };
      const text = { ...createSocialImageElement('text', base), id: 'text', x: 150, y: 130, width: 280, height: 40, fontFile: 'font.ttf', fontFileWeight: 400, fontWeight: 600, fontSize: 28, text: '{{page.title}}', color: '#000000' };
      const subtitle = { ...createSocialImageElement('text', base), id: 'subtitle', x: 150, y: 180, width: 280, height: 40, fontWeight: 800, fontSize: 20, text: 'Bundled Geist\nsecond line', color: '#0000ff', letterSpacing: 1 };
      const icon = { ...createSocialImageElement('icon', base), id: 'icon', x: 40, y: 40, horizontalAnchor: 'right', verticalAnchor: 'bottom', width: 50, height: 50, icon: 'star', color: '#000000', rotation: 15 };
      const ellipse = { ...shape, id: 'ellipse', x: 20, y: 290, width: 150, height: 75, shape: 'ellipse', fill: '#00ff00' };
      const template = normalizeSocialImageTemplate({ ...base, elements: [shape, image, text, subtitle, icon, ellipse], stacks: [{ id: 'content', elementIds: ['text', 'subtitle'], direction: 'vertical', gap: 12, align: 'start', anchor: 'center' }] });
      const project = { name: 'Pixels', rootPath: '', mainHtmlPath: 'index.html', openedAt: 1, files: {
        'image.svg': { path: 'image.svg', mimeType: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="blue"/></svg>' },
        'font.ttf': { path: 'font.ttf', mimeType: 'font/ttf', data: new Uint8Array(font) },
      } };
      const request = { project, referencePath: 'nested/page.html', template, variables: { 'page.title': 'Título dinâmico que quebra em várias linhas' } };
      const before = document.fonts.size;
      const bytes = await renderHtmlSocialImage(request);
      const after = document.fonts.size;
      const decoded = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = decoded.width; canvas.height = decoded.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(decoded, 0, 0); decoded.close();
      const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      let darkTextPixels = 0;
      const textPixels = ctx.getImageData(145, 100, 290, 175).data;
      for (let i = 0; i < textPixels.length; i += 4) if (textPixels[i] < 100 && textPixels[i + 1] < 100) darkTextPixels++;
      const rejection = async source => {
        try { await renderHtmlSocialImage({ ...request, template: { ...template, elements: [{ ...image, source }], stacks: [] } }); return ''; }
        catch (error) { return error.message; }
      };
      const missing = await rejection('missing.png');
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
      const cors = await rejection('https://external.example/image.png');
      globalThis.fetch = originalFetch;
      return { signature: [...bytes.slice(0, 8)], size: bytes.length, width: canvas.width, height: canvas.height, red: pixel(50, 50), blue: pixel(570, 50), white: pixel(320, 10), green: pixel(90, 325), darkTextPixels, fontLeaks: after - before, missing, cors };
    }, font);
    assert.deepEqual(result.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(result.size > 1_000);
    assert.equal(result.width, 640); assert.equal(result.height, 400);
    assert.deepEqual(result.red, [255, 0, 0, 255]);
    assert.deepEqual(result.blue, [0, 0, 255, 255]);
    assert.deepEqual(result.white, [255, 255, 255, 255]);
    assert.deepEqual(result.green, [0, 255, 0, 255]);
    assert.ok(result.darkTextPixels > 100);
    assert.equal(result.fontLeaks, 0);
    assert.match(result.missing, /ausente nos arquivos/);
    assert.match(result.cors, /CORS/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close(); await new Promise(resolve => http.close(resolve));
  }
});
