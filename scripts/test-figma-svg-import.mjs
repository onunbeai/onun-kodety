import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
try {
  const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
  const { createBlankProject } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const { KODETY_FIGMA_SIGNATURE, KODETY_FIGMA_VERSION } = await server.ssrLoadModule('/lib/figma/types.ts');
  const svg = '<svg viewBox="-12 -12 224 124">'
    + '<defs><linearGradient id="gradient"><stop stop-color="#ff0033"/><stop offset="1" stop-color="#0099ff"/></linearGradient>'
    + '<filter id="blur" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="4"/><feComposite in="SourceGraphic" operator="over"/></filter>'
    + '<mask id="mask" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="100"><rect width="200" height="100" fill="white"/><circle cx="100" cy="50" r="20" fill="black"/></mask>'
    + '<clipPath id="clip"><rect width="200" height="100" rx="12"/></clipPath>'
    + '<image id="bitmap" width="1" height="1" xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="/>'
    + '<pattern id="pattern" patternUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#bitmap" transform="matrix(200 0 0 100 0 0)"/></pattern></defs>'
    + '<g clip-path="url(#clip)" mask="url(#mask)" filter="url(#blur)"><path d="M0 0h200v100H0z" fill="url(#gradient)"/><path d="M10 10h180v80H10z" fill="url(#pattern)" opacity=".5" style="mix-blend-mode:multiply"/></g>'
    + '<script>alert(1)</script><image href="https://invalid.example/tracker.png" onload="alert(1)"/>'
    + '</svg>';
  const payload = {
    signature: KODETY_FIGMA_SIGNATURE, version: KODETY_FIGMA_VERSION, source: 'figma-plugin',
    engine: { version: 5, sceneFormat: 'JSON_REST_V1' }, exportId: 'svg-fidelity',
    exportedAt: new Date().toISOString(), documentName: 'SVG fixture', pageName: 'Page',
    html: '<section class="svg-section"><img src="figma-asset://vector" alt="Fixture"></section>',
    css: '.svg-section{background-image:url("figma-asset://vector")}',
    assets: [{ id: 'vector', name: 'complex.svg', mimeType: 'image/svg+xml', text: svg }],
    fonts: [], variables: [], warnings: [], stats: { nodes: 2, assets: 1, bytes: svg.length },
  };
  const safeReference = `${svg.slice(0, svg.indexOf('<script>'))}</svg>`
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ');
  const referencePixels = await sharp(Buffer.from(safeReference)).ensureAlpha().raw().toBuffer();
  for (const encoding of ['text', 'base64']) {
    const value = encoding === 'text' ? payload : {
      ...payload, assets: [{ ...payload.assets[0], text: undefined, dataBase64: Buffer.from(svg).toString('base64') }],
    };
    const result = await importKodetyFigmaPayload(createBlankProject('SVG fidelity'), value, { targetPath: '0', preferredStylesheetPath: 'styles.css' });
    const asset = Object.values(result.project.files).find(file => file.mimeType === 'image/svg+xml');
    assert.ok(asset, `${encoding} SVG must remain a vector asset`);
    const output = new TextDecoder().decode(asset.data);
    assert.match(output, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(output, /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/);
    for (const part of [
      'viewBox="-12 -12 224 124"', 'mask="url(#mask)"', 'clip-path="url(#clip)"', 'filter="url(#blur)"',
      '<feGaussianBlur stdDeviation="4"/>', '<feComposite in="SourceGraphic" operator="over"/>',
      'patternUnits="objectBoundingBox"', 'xlink:href="#bitmap"', 'transform="matrix(200 0 0 100 0 0)"',
      'data:image/png;base64,iVBORw0KGgo', 'fill="url(#gradient)"', 'fill="url(#pattern)"', 'mix-blend-mode:multiply',
    ]) assert.ok(output.includes(part), `${encoding} SVG must preserve ${part}`);
    assert.doesNotMatch(output, /<script|onload=|invalid\.example/);
    const importedPixels = await sharp(Buffer.from(output)).ensureAlpha().raw().toBuffer();
    assert.deepEqual(importedPixels, referencePixels, `${encoding} SVG must render the exact same pixels after import sanitation`);
    assert.match(result.project.files['styles.css'].text, /url\("assets\/figma\/svg-fidelity\/complex\.svg"\)/);
    assert.match(result.project.files['index.html'].text, /src="assets\/figma\/svg-fidelity\/complex\.svg"/);
  }
  console.log('Figma SVG import: text/base64 filters, masks, patterns, namespaces, safe URLs and pixel-identical roundtrip passed.');
} finally {
  await server.close();
}
