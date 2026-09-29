import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const [socialImage, seo, projectMetadata, projectIo, projectIoSource] = await Promise.all([
    server.ssrLoadModule('/lib/html-editor/social-image.ts'),
    server.ssrLoadModule('/lib/html-editor/seo-settings.ts'),
    server.ssrLoadModule('/lib/html-editor/project-metadata.ts'),
    server.ssrLoadModule('/lib/html-editor/project-io.ts'),
    readFile(path.join(root, 'lib/html-editor/project-io.ts'), 'utf8'),
  ]);

  const template = socialImage.createDefaultSocialImageTemplate();
  template.background.image = 'blob:https://editor.test/background';
  const templateText = template.elements.find(element => element.type === 'text');
  assert.ok(templateText, 'the default social template exposes a text layer');
  templateText.fontFile = 'blob:https://editor.test/font';
  template.elements.push({
    ...socialImage.createSocialImageElement('image', template),
    source: 'blob:https://editor.test/layer',
  });
  const canonical = socialImage.canonicalizeSocialImageTemplateAssets(
    template,
    'pages/about.html',
  );
  assert.equal(canonical.background.image, '', 'template backgrounds must not persist object URLs');
  assert.equal(canonical.elements.at(-1).source, '', 'template image layers must not persist object URLs');
  assert.equal(
    canonical.elements.find(element => element.type === 'text')?.fontFile,
    undefined,
    'template text fonts must not persist object URLs',
  );
  assert.equal(
    socialImage.persistableMediaUrl('data:image/png;base64,AAAA'),
    'data:image/png;base64,AAAA',
    'portable data images remain valid project data',
  );
  assert.equal(
    socialImage.persistableMediaUrl('{{cms.hero_image}}'),
    '{{cms.hero_image}}',
    'CMS/variable media tokens must keep their authored bytes',
  );

  const malformedLegacyTemplate = {
    id: 'legacy-partial',
    customMetadata: { ids: ['keep-a', 'keep-b'] },
    background: null,
    elements: [
      null,
      { id: 'legacy-image', type: 'image', source: 'blob:https://legacy.test/layer' },
      { id: 'legacy-text', type: 'text', text: 'Keep me', fontFile: 'blob:https://legacy.test/font' },
      { id: 'legacy-token', type: 'text', text: 'Keep token', fontFile: '{{cms.font_file}}' },
    ],
  };
  const malformedLegacySite = {
    socialImage: '{{cms.hero_image}}',
    socialImageTemplate: malformedLegacyTemplate,
    socialImageTemplates: [null, 'legacy-string', malformedLegacyTemplate],
  };
  let sanitizedMalformedLegacySite;
  assert.doesNotThrow(() => {
    sanitizedMalformedLegacySite = seo.sanitizeSiteSeoMediaForPersistence(malformedLegacySite);
  }, 'partial/malformed legacy templates must remain persistence-safe');
  assert.equal(sanitizedMalformedLegacySite.socialImage, '{{cms.hero_image}}');
  assert.deepEqual(
    sanitizedMalformedLegacySite.socialImageTemplate.customMetadata,
    { ids: ['keep-a', 'keep-b'] },
    'sanitization must not reconstruct unrelated legacy template metadata',
  );
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplate.background, null);
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplate.elements[0], null);
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplate.elements[1].source, '');
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplate.elements[2].text, 'Keep me');
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplate.elements[2].fontFile, '');
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplate.elements[3].fontFile, '{{cms.font_file}}');
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplates[0], null);
  assert.equal(sanitizedMalformedLegacySite.socialImageTemplates[1], 'legacy-string');

  const unchangedJsonLd = [
    '{',
    '  "@type": "ImageObject",',
    '  "image": "{{cms.featured_image}}",',
    '  "contentUrl": "data:image/png;base64,PORTABLE",',
    '  "custom": { "ids": ["alpha", "beta"] }',
    '}',
  ].join('\n');
  assert.equal(
    seo.sanitizeJsonLdMediaForPersistence(unchangedJsonLd),
    unchangedJsonLd,
    'portable JSON-LD and CMS tokens remain byte-identical',
  );
  const invalidJsonLd = '{"image":"blob:https://editor.test/schema","broken":';
  assert.equal(
    seo.sanitizeJsonLdMediaForPersistence(invalidJsonLd),
    invalidJsonLd,
    'invalid authored JSON-LD must not be reconstructed or discarded',
  );
  const sanitizedJsonLd = JSON.parse(seo.sanitizeJsonLdMediaForPersistence(JSON.stringify({
    '@type': 'Article',
    image: [
      'blob:https://editor.test/article-image',
      '{{cms.featured_image}}',
      {
        '@type': 'ImageObject',
        url: 'blob:https://editor.test/image-object',
        contentUrl: '/assets/article.png',
        caption: 'Keep caption',
      },
    ],
    thumbnailUrl: 'data:image/png;base64,THUMB',
    video: {
      '@type': 'VideoObject',
      embedUrl: 'blob:https://editor.test/video',
      name: 'Keep video',
    },
    description: 'blob: is ordinary text outside media properties',
    custom: { ids: ['alpha', 'beta'], enabled: true },
  })));
  assert.equal(sanitizedJsonLd.image[0], '');
  assert.equal(sanitizedJsonLd.image[1], '{{cms.featured_image}}');
  assert.equal(sanitizedJsonLd.image[2].url, '');
  assert.equal(sanitizedJsonLd.image[2].contentUrl, '/assets/article.png');
  assert.equal(sanitizedJsonLd.image[2].caption, 'Keep caption');
  assert.equal(sanitizedJsonLd.thumbnailUrl, 'data:image/png;base64,THUMB');
  assert.equal(sanitizedJsonLd.video.embedUrl, '');
  assert.equal(sanitizedJsonLd.video.name, 'Keep video');
  assert.equal(sanitizedJsonLd.description, 'blob: is ordinary text outside media properties');
  assert.deepEqual(sanitizedJsonLd.custom, { ids: ['alpha', 'beta'], enabled: true });

  const html = seo.applySeoToHtml(
    '<!doctype html><html><head></head><body></body></html>',
    'about.html',
    {
      siteTitle: 'Example',
      socialImage: 'https://cdn.example.test/fallback.png',
      faviconLight: 'blob:https://editor.test/favicon',
      faviconDark: '/assets/favicon-dark.svg',
      organizationName: 'Example',
      organizationLogo: 'blob:https://editor.test/logo',
      globalSchemaJsonLd: JSON.stringify({
        '@type': 'ImageObject',
        url: 'blob:https://editor.test/global-schema-image',
        contentUrl: 'data:image/png;base64,GLOBAL',
        caption: 'Keep global caption',
      }),
    },
    {
      title: 'About',
      socialImage: 'blob:https://editor.test/page-card',
      schemaJsonLd: JSON.stringify({
        '@type': 'Article',
        image: 'blob:https://editor.test/page-schema-image',
        thumbnailUrl: '{{cms.thumbnail}}',
        headline: 'Keep headline',
      }),
    },
  );
  assert.doesNotMatch(html, /blob:/i, 'public SEO HTML must not contain browser object URLs');
  assert.match(html, /og:image" content="https:\/\/cdn\.example\.test\/fallback\.png"/);
  assert.match(html, /data-kodety-favicon="light"/);
  assert.match(html, /href="\/assets\/favicon-dark\.svg"/);
  assert.doesNotMatch(html, /"logo":/, 'transient organization logos must not enter JSON-LD');
  assert.match(html, /"contentUrl":"data:image\/png;base64,GLOBAL"/);
  assert.match(html, /"caption":"Keep global caption"/);
  assert.match(html, /"thumbnailUrl":"\{\{cms\.thumbnail\}\}"/);
  assert.match(html, /"headline":"Keep headline"/);

  const imported = '<!doctype html><html><head>'
    + '<meta property="og:image" content="blob:https://stale.test/card">'
    + '<link rel="icon" href="blob:https://stale.test/icon">'
    + '</head><body></body></html>';
  assert.equal(seo.readSiteSeoFromHtml(imported).socialImage, undefined);
  assert.equal(seo.readSiteSeoFromHtml(imported).faviconLight, undefined);
  assert.equal(seo.readPageSeoFromHtml(imported).socialImage, undefined);

  const project = {
    name: 'SEO persistence',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 0,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head></head><body></body></html>',
      },
    },
  };
  const update = metadata => ({
    ...metadata,
    siteSettings: {
      socialImage: 'blob:https://editor.test/site',
      faviconLight: '/assets/favicon.svg',
      faviconDark: 'blob:https://editor.test/dark',
      organizationLogo: 'data:image/png;base64,BBBB',
      globalSchemaJsonLd: JSON.stringify({
        '@type': 'Organization',
        logo: 'blob:https://editor.test/schema-logo',
        image: '{{cms.organization_image}}',
        custom: { ids: ['site-a', 'site-b'] },
      }),
      socialImageTemplate: template,
      socialImageTemplates: [template],
    },
    pageSettings: {
      'index.html': {
        title: 'Home',
        socialImage: 'blob:https://editor.test/page',
        schemaJsonLd: JSON.stringify({
          '@type': 'Article',
          image: 'blob:https://editor.test/schema-image',
          thumbnailUrl: 'data:image/png;base64,PAGE',
          headline: '{{cms.title}}',
        }),
        socialImageTemplate: template,
      },
    },
  });

  const written = projectMetadata.updateEditorMetadata(project, update);
  const serialized = written.files['.incode/project.json'].text;
  assert.doesNotMatch(serialized, /blob:/i, 'the lightweight metadata writer must remove object URLs before JSON serialization');
  const metadata = JSON.parse(serialized);
  assert.equal(metadata.siteSettings.faviconLight, '/assets/favicon.svg');
  assert.equal(metadata.siteSettings.organizationLogo, 'data:image/png;base64,BBBB');
  assert.equal(metadata.pageSettings['index.html'].title, 'Home');
  assert.equal(metadata.pageSettings['index.html'].socialImage, undefined);
  assert.equal(metadata.siteSettings.socialImageTemplates[0].background.image, '');
  assert.equal(metadata.siteSettings.socialImageTemplate.elements.find(element => element.type === 'text').fontFile, '');
  const storedGlobalSchema = JSON.parse(metadata.siteSettings.globalSchemaJsonLd);
  assert.equal(storedGlobalSchema.logo, '');
  assert.equal(storedGlobalSchema.image, '{{cms.organization_image}}');
  assert.deepEqual(storedGlobalSchema.custom, { ids: ['site-a', 'site-b'] });
  const storedPageSchema = JSON.parse(metadata.pageSettings['index.html'].schemaJsonLd);
  assert.equal(storedPageSchema.image, '');
  assert.equal(storedPageSchema.thumbnailUrl, 'data:image/png;base64,PAGE');
  assert.equal(storedPageSchema.headline, '{{cms.title}}');

  const parityUpdate = current => ({
    ...current,
    projectId: 'metadata-parity-project',
    unrelated: {
      ids: ['alpha', 'beta'],
      nested: { enabled: true },
    },
    siteSettings: {
      siteTitle: 'Parity',
      socialImage: 'blob:https://editor.test/parity-site',
      faviconLight: './assets/parity.svg',
      organizationLogo: '{{cms.organization_logo}}',
      socialImageTemplate: malformedLegacyTemplate,
    },
    pageSettings: {
      'pages/About.html': {
        title: 'About',
        socialImage: 'blob:https://editor.test/parity-page',
        socialImageTemplate: {
          ...malformedLegacyTemplate,
          background: { image: '{{cms.page_background}}' },
        },
      },
    },
  });
  const lightweightParity = projectMetadata.updateEditorMetadata(project, parityUpdate);
  const transportParity = projectIo.updateEditorMetadata(project, parityUpdate);
  assert.deepEqual(
    JSON.parse(transportParity.files['.incode/project.json'].text),
    JSON.parse(lightweightParity.files['.incode/project.json'].text),
    'project-metadata and project-io must serialize the same sanitized metadata state',
  );
  const parityMetadata = JSON.parse(transportParity.files['.incode/project.json'].text);
  assert.deepEqual(parityMetadata.unrelated, {
    ids: ['alpha', 'beta'],
    nested: { enabled: true },
  });
  assert.deepEqual(Object.keys(parityMetadata.pageSettings), ['pages/About.html']);
  assert.equal(parityMetadata.siteSettings.organizationLogo, '{{cms.organization_logo}}');
  assert.equal(
    parityMetadata.pageSettings['pages/About.html'].socialImageTemplate.background.image,
    '{{cms.page_background}}',
  );
  assert.doesNotMatch(transportParity.files['.incode/project.json'].text, /blob:/i);

  const projectIoPersistence = projectIoSource.slice(
    projectIoSource.indexOf('function sanitizeEditorMetadataSeoMediaForPersistence('),
  );
  assert.match(projectIoPersistence, /sanitizeSiteSeoMediaForPersistence\(metadata\.siteSettings\)/);
  assert.match(projectIoPersistence, /sanitizePageSeoMediaForPersistence\(settings\)/);
  assert.match(projectIoPersistence, /return sanitizeEditorMetadataSeoMediaForPersistence\(\{/);
  assert.match(projectIoPersistence, /const metadata = sanitizeEditorMetadataSeoMediaForPersistence\(updated\)/);

  const importedMetadata = {
    version: 1,
    projectId: 'seo-persistence-project',
    name: 'SEO persistence',
    mainHtmlPath: 'index.html',
    homeHtmlPath: 'index.html',
    siteSettings: {
      socialImage: 'https://cdn.example.test/site-card.png',
      faviconLight: './assets/favicon.svg',
      faviconDark: '/assets/favicon-dark.svg?theme=night#icon',
      organizationLogo: 'data:image/png;base64,LOCAL',
      socialImageTemplate: {
        ...template,
        background: { ...template.background, image: '../assets/social-background.png' },
      },
      socialImageTemplates: [template],
    },
    pageSettings: {
      'index.html': {
        title: 'Home',
        socialImage: 'images/social-card.png',
      },
    },
  };
  assert.match(JSON.stringify(importedMetadata), /blob:/i, 'the imported fixture must contain transient media');
  const importArchive = new JSZip();
  importArchive.file('index.html', '<!doctype html><html><head></head><body></body></html>');
  importArchive.file('.incode/project.json', JSON.stringify(importedMetadata, null, 2));
  const importedProject = await projectIo.importZip(new File(
    [await importArchive.generateAsync({ type: 'uint8array' })],
    'seo-import.zip',
    { type: 'application/zip' },
  ));

  const firstWrite = projectIo.updateEditorMetadata(importedProject, current => current);
  const secondWrite = projectIo.updateEditorMetadata(firstWrite, current => current);
  assert.equal(
    secondWrite.files['.incode/project.json'].text,
    firstWrite.files['.incode/project.json'].text,
    'sanitizing the same imported metadata twice must be byte-idempotent',
  );
  const firstMetadata = projectIo.readEditorMetadata(firstWrite);
  assert.equal(firstMetadata.siteSettings.socialImage, 'https://cdn.example.test/site-card.png');
  assert.equal(firstMetadata.siteSettings.faviconLight, './assets/favicon.svg');
  assert.equal(firstMetadata.siteSettings.faviconDark, '/assets/favicon-dark.svg?theme=night#icon');
  assert.equal(firstMetadata.siteSettings.organizationLogo, 'data:image/png;base64,LOCAL');
  assert.equal(firstMetadata.siteSettings.socialImageTemplate.background.image, '../assets/social-background.png');
  assert.equal(firstMetadata.siteSettings.socialImageTemplate.elements.at(-1).source, '');
  assert.equal(firstMetadata.siteSettings.socialImageTemplates[0].background.image, '');
  assert.equal(firstMetadata.siteSettings.socialImageTemplates[0].elements.at(-1).source, '');
  assert.equal(firstMetadata.pageSettings['index.html'].socialImage, 'images/social-card.png');

  const assertPortableMetadata = (candidate, label) => {
    assert.equal(candidate.siteSettings.socialImage, 'https://cdn.example.test/site-card.png', `${label}: HTTP media`);
    assert.equal(candidate.siteSettings.faviconLight, './assets/favicon.svg', `${label}: relative local media`);
    assert.equal(candidate.siteSettings.faviconDark, '/assets/favicon-dark.svg?theme=night#icon', `${label}: root local media`);
    assert.equal(candidate.siteSettings.organizationLogo, 'data:image/png;base64,LOCAL', `${label}: data media`);
    assert.equal(candidate.siteSettings.socialImageTemplate.background.image, '../assets/social-background.png', `${label}: nested local media`);
    assert.equal(candidate.pageSettings['index.html'].socialImage, 'images/social-card.png', `${label}: page-local media`);
  };
  assertPortableMetadata(firstMetadata, 'metadata write');

  const fixedUpdatedAt = '2026-08-29T12:00:00.000Z';
  const draftTransport = projectIo.prepareProjectForDraftTransport(importedProject, fixedUpdatedAt);
  const draftMetadata = JSON.parse(draftTransport.files['.incode/project.json'].text);
  assert.doesNotMatch(draftTransport.files['.incode/project.json'].text, /blob:/i);
  assertPortableMetadata(draftMetadata, 'draft transport');

  const exportBlob = await projectIo.projectToZipBlob(importedProject, { updatedAt: fixedUpdatedAt });
  const exportedZip = await JSZip.loadAsync(await exportBlob.arrayBuffer());
  const exportedMetadataText = await exportedZip.file('.incode/project.json').async('string');
  assert.doesNotMatch(exportedMetadataText, /blob:/i, 'import/export must sanitize transient SEO media');
  assertPortableMetadata(JSON.parse(exportedMetadataText), 'ZIP export');

  const published = await projectIo.projectToPublishPackage(importedProject, { updatedAt: fixedUpdatedAt });
  const publishedZip = await JSZip.loadAsync(await published.zip.arrayBuffer());
  const publishedMetadataText = await publishedZip.file('.incode/project.json').async('string');
  assert.doesNotMatch(publishedMetadataText, /blob:/i, 'publication must sanitize imported transient SEO media');
  assertPortableMetadata(JSON.parse(publishedMetadataText), 'publication package');
} finally {
  await server.close();
}

console.log('SEO media persistence: transient blob URLs are excluded from project JSON and public HTML.');
