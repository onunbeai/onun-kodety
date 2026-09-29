import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

try {
  const assetReferences = await server.ssrLoadModule('/lib/html-editor/asset-references.ts');
  const assetUrl = '/media/hero%20image.png';
  const project = {
    name: 'Asset reference fixture',
    mainHtmlPath: 'site/index.html',
    rootPath: 'site',
    openedAt: 0,
    files: {
      'site/index.html': {
        path: 'site/index.html',
        mimeType: 'text/html',
        text: [
          '<!doctype html><html><head>',
          `<link rel="icon" href="${assetUrl}?v=1#icon">`,
          `<meta property="og:image" content="${assetUrl}">`,
          `<style>.hero{background:url('${assetUrl}')}/* url('${assetUrl}') */.fake{content:"url('${assetUrl}')"}</style>`,
          `<script>const fake = '<img src="${assetUrl}">'</script>`,
          `<script type="application/ld+json">{"@type":"Organization","image":"${assetUrl}"}</script>`,
          '</head><body>',
          `<img src="${assetUrl}" alt="first">`,
          `<img src="${assetUrl}" alt="duplicate">`,
          `<img srcset="data:image/png;base64,AAAA 1x, ${assetUrl} 2x">`,
          `<div style="background-image: url(&quot;${assetUrl}&quot;)"></div>`,
          `<object data="${assetUrl}"></object>`,
          `<img data-src="https://cdn.example.test${assetUrl}">`,
          `<img data-src="data:image/svg+xml,${assetUrl}">`,
          `<img data-src="blob:https://builder.example/id/${assetUrl}">`,
          `<img src="${assetUrl}.backup">`,
          `<!-- <img src="${assetUrl}"> -->`,
          '</body></html>',
        ].join('\n'),
      },
      'site/pages/about.html': {
        path: 'site/pages/about.html',
        mimeType: 'text/html',
        text: '<video poster="../media/hero%20image.png?cache=2"></video>',
      },
      'site/styles/site.css': {
        path: 'site/styles/site.css',
        mimeType: 'text/css',
        text: [
          '.hero { background-image: url("../public/media/hero%20image.png#hero"); }',
          '.duplicate { mask-image: url("../public/media/hero%20image.png#hero"); }',
          '.remote { background: url("https://cdn.example.test/media/hero%20image.png"); }',
          '.embedded { background: url(data:image/png;base64,AAAA); }',
          '.fragment { filter: url(#blur); }',
          '/* .comment { background: url("../public/media/hero%20image.png"); } */',
          '.string::after { content: "url(../public/media/hero%20image.png)"; }',
        ].join('\n'),
      },
      'site/styles/self.css': {
        path: 'site/styles/self.css',
        mimeType: 'text/css',
        text: '.self { background: url("./self.css"); }',
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          homeHtmlPath: 'site/index.html',
          siteSettings: {
            faviconLight: assetUrl,
            faviconDark: 'https://cdn.example.test/favicon.png',
            organizationLogo: `${assetUrl}?organization=1`,
            socialImage: assetUrl,
            globalSchemaJsonLd: JSON.stringify({
              '@type': 'Organization',
              logo: assetUrl,
            }),
            socialImageTemplate: {
              background: { image: assetUrl },
              elements: [
                { type: 'image', source: assetUrl },
                { type: 'text', fontFile: assetUrl },
                { type: 'image', source: '{{page.featured_image}}' },
              ],
            },
            socialImageTemplates: [
              { id: 'shared', background: { image: assetUrl }, elements: [] },
            ],
          },
          pageSettings: {
            'site/pages/about.html': {
              socialImage: '../media/hero%20image.png',
              schemaJsonLd: JSON.stringify({ image: '../media/hero%20image.png' }),
              socialImageTemplate: {
                background: { image: '../media/hero%20image.png' },
                elements: [],
              },
            },
          },
        }, null, 2),
      },
      'site/remote-only.html': {
        path: 'site/remote-only.html',
        mimeType: 'text/html',
        text: `<img src="https://cdn.example.test${assetUrl}"><img src="data:image/png;base64,${assetUrl}"><img src="blob:https://builder.example/123">`,
      },
      'site/public/media/hero image.png': {
        path: 'site/public/media/hero image.png',
        mimeType: 'image/png',
      },
      'site/public/media/unused.png': {
        path: 'site/public/media/unused.png',
        mimeType: 'image/png',
      },
    },
  };

  const before = JSON.stringify(project);
  deepFreeze(project);
  const found = assetReferences.findProjectAssetReferences(
    project,
    'site/public/media/hero image.png',
  );

  assert.deepEqual(
    [...new Set(found.map(reference => reference.kind))].sort(),
    ['css-url', 'html-src', 'html-srcset', 'seo', 'social', 'template'],
    'HTML src/srcset, CSS url(), SEO, social and template references must be distinguished',
  );
  assert.ok(found.every(reference => (
    typeof reference.filePath === 'string'
    && typeof reference.label === 'string'
    && !('authoredReferences' in reference)
  )), 'each result exposes only origin and safe human detail, never authored source');

  assert.equal(
    found.filter(reference => (
      reference.filePath === 'site/index.html'
      && reference.kind === 'html-src'
      && reference.detail === 'img[src]'
    )).length,
    1,
    'identical references in one origin are deduplicated',
  );
  assert.ok(found.some(reference => (
    reference.filePath === 'site/index.html'
    && reference.kind === 'html-srcset'
    && reference.detail === 'img[srcset]'
  )), 'srcset finds the local 2x candidate without misreading the data URL comma');
  assert.ok(found.some(reference => (
    reference.filePath === 'site/styles/site.css'
    && reference.kind === 'css-url'
    && reference.detail === 'url()'
  )), 'external CSS resolves encoded paths, query/fragment and public aliases');
  assert.ok(found.some(reference => (
    reference.filePath === 'site/index.html'
    && reference.kind === 'css-url'
    && reference.detail === 'div[style] url()'
  )), 'inline CSS references are enumerated');
  assert.ok(found.some(reference => (
    reference.filePath === '.incode/project.json'
    && reference.kind === 'template'
    && reference.detail?.endsWith('.background.image')
  )), 'template backgrounds are enumerated');
  assert.ok(found.some(reference => (
    reference.filePath === '.incode/project.json'
    && reference.kind === 'template'
    && reference.detail?.endsWith('.source')
  )), 'template image elements are enumerated');
  assert.ok(found.some(reference => (
    reference.filePath === '.incode/project.json'
    && reference.kind === 'template'
    && reference.detail?.endsWith('.fontFile')
  )), 'local template font files are enumerated');
  assert.ok(found.some(reference => (
    reference.filePath === '.incode/project.json'
    && reference.kind === 'seo'
    && reference.detail === 'siteSettings.globalSchemaJsonLd'
  )), 'custom JSON-LD image/logo references are enumerated as SEO');

  assert.equal(
    found.some(reference => reference.filePath === 'site/remote-only.html'),
    false,
    'remote, data and blob URLs never become local references',
  );
  assert.deepEqual(
    assetReferences.findProjectAssetReferences(project, 'site/public/media/missing.png'),
    [],
    'a missing project asset is not confused with a live file',
  );
  assert.deepEqual(
    assetReferences.findProjectAssetReferences(project, 'site/public/media/unused.png'),
    [],
    'an unused asset has no references',
  );
  assert.deepEqual(
    assetReferences.findProjectAssetReferences(project, 'site/styles/self.css'),
    [],
    'the target file does not count a self-reference as an external owner',
  );

  assert.deepEqual(
    found,
    assetReferences.findProjectAssetReferences(project, '/media/hero%20image.png?v=2'),
    'canonical and public URL spellings produce the same deterministic output',
  );
  assert.deepEqual(
    found,
    assetReferences.findProjectAssetReferences(project, 'site/public/media/hero image.png'),
    'repeated enumeration is stable',
  );

  const blocked = assetReferences.projectAssetRemovalGuard(
    project,
    'site/public/media/hero image.png',
  );
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requiresConfirmation, true);
  assert.deepEqual(blocked.references, found);
  assert.equal(JSON.stringify(project), before, 'cancelled preflight leaves the project byte-identical');

  const confirmed = assetReferences.projectAssetRemovalGuard(
    project,
    'site/public/media/hero image.png',
    true,
  );
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.requiresConfirmation, false);
  assert.deepEqual(confirmed.references, found);
  assert.equal(JSON.stringify(project), before, 'confirmed preflight is also pure; the caller owns mutation');

  assert.deepEqual(
    assetReferences.projectAssetRemovalGuard(project, 'site/public/media/unused.png'),
    { allowed: true, requiresConfirmation: false, references: [] },
    'unused assets proceed without destructive-reference confirmation',
  );
} finally {
  await server.close();
}

console.log('Asset references: canonical HTML, CSS, SEO/social/template and pure deletion guard approved.');
