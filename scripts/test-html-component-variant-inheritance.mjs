import assert from 'node:assert/strict';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment, serializeOuter } from 'parse5';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { '@': root } },
});

const document = markup => `<!doctype html><html><head></head><body>${markup}</body></html>`;
const testDomParser = class {
  parseFromString(markup) {
    const fragment = parseFragment(markup);
    const rootNode = fragment.childNodes.find(node => node.tagName);
    const wrapElement = node => ({
      getAttribute(name) {
        return node.attrs?.find(attribute => attribute.name === name)?.value ?? null;
      },
      hasAttribute(name) {
        return Boolean(node.attrs?.some(attribute => attribute.name === name));
      },
      setAttribute(name, value) {
        const attribute = node.attrs?.find(candidate => candidate.name === name);
        if (attribute) attribute.value = value;
        else (node.attrs ||= []).push({ name, value });
      },
      querySelectorAll(selector) {
        assert.equal(selector, '*');
        const descendants = [];
        const visit = candidate => {
          (candidate.childNodes || []).forEach(child => {
            if (!child.tagName) return;
            descendants.push(wrapElement(child));
            visit(child);
          });
        };
        visit(node);
        return descendants;
      },
      get outerHTML() {
        return serializeOuter(node);
      },
    });
    return { body: { firstElementChild: rootNode ? wrapElement(rootNode) : null } };
  }
};
const styleAt = (source, nodeId) => {
  const match = source.match(new RegExp(`<[^>]+data-kodety-component-node="${nodeId}"[^>]*>`));
  assert.ok(match, `missing node ${nodeId}`);
  const style = match[0].match(/\sstyle="([^"]*)"/)?.[1] || '';
  return Object.fromEntries(style.split(';').flatMap(declaration => {
    const separator = declaration.indexOf(':');
    return separator < 0 ? [] : [[
      declaration.slice(0, separator).trim(),
      declaration.slice(separator + 1).trim(),
    ]];
  }));
};

try {
  const inheritance = await server.ssrLoadModule(
    '/lib/html-editor/component-variant-inheritance.ts',
  );
  const components = await server.ssrLoadModule('/lib/html-editor/html-components.ts');
  const componentBundles = await server.ssrLoadModule('/lib/html-editor/component-bundle.ts');

  const legacyVariantDocument = '<!doctype html><html><head></head><body class="component" data-kodety-component-editor="old-component" data-kodety-component-variant-editor="primary"><section>Variant</section></body></html>';
  const normalizedVariantDocument = components.normalizeHtmlComponentEditorDocumentIdentity(
    legacyVariantDocument,
    'footer',
    'alternate',
  );
  assert.match(normalizedVariantDocument, /data-kodety-component-editor="footer"/);
  assert.match(normalizedVariantDocument, /data-kodety-component-variant-editor="alternate"/);
  assert.match(normalizedVariantDocument, /<body class="component"/);
  assert.match(normalizedVariantDocument, /<section>Variant<\/section>/);

  const maxLengthNodeId = 'n'.repeat(160);
  const duplicatedNodeMarkup = `<section data-kodety-component-node="root">
    <h2 data-kodety-component-node="title">Title</h2>
    <p data-kodety-component-node="title">Copy</p>
    <span data-kodety-component-node="title-2">Reserved</span>
    <strong data-kodety-component-node="title">More copy</strong>
    <div data-kodety-component-node="root">Nested duplicate</div>
    <i data-kodety-component-node="${maxLengthNodeId}"></i>
    <b data-kodety-component-node="${maxLengthNodeId}"></b>
  </section>`;
  const previousDomParser = globalThis.DOMParser;
  globalThis.DOMParser = testDomParser;
  const normalizedNodeMarkup = components.ensureComponentNodeIds(duplicatedNodeMarkup);
  const normalizedNodeIds = Array.from(
    normalizedNodeMarkup.matchAll(/data-kodety-component-node="([^"]+)"/g),
    match => match[1],
  );
  assert.deepEqual(normalizedNodeIds.slice(0, 6), [
    'root',
    'title',
    'title-3',
    'title-2',
    'title-4',
    'root-2',
  ]);
  assert.equal(new Set(normalizedNodeIds).size, normalizedNodeIds.length);
  assert.equal(normalizedNodeIds.at(-1).length, 160);
  assert.match(normalizedNodeIds.at(-1), /^[a-zA-Z0-9_-]{1,160}$/);
  assert.equal(
    components.ensureComponentNodeIds(normalizedNodeMarkup),
    normalizedNodeMarkup,
    'duplicate node normalization must be deterministic and idempotent',
  );
  if (previousDomParser === undefined) delete globalThis.DOMParser;
  else globalThis.DOMParser = previousDomParser;

  const componentStylesheetProject = {
    name: 'Component stylesheet',
    mainHtmlPath: '.incode/components/navbar/default.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: '<html><head></head><body></body></html>' },
      'pages/about.html': { path: 'pages/about.html', mimeType: 'text/html', text: '<html><head></head><body></body></html>' },
      '.incode/components/navbar/default.html': {
        path: '.incode/components/navbar/default.html',
        mimeType: 'text/html',
        text: '<html><head></head><body data-kodety-component-editor="navbar"></body></html>',
      },
      '.incode/experiments/control.html': {
        path: '.incode/experiments/control.html',
        mimeType: 'text/html',
        text: '<html><head></head><body></body></html>',
      },
      'kodety-styles.css': { path: 'kodety-styles.css', mimeType: 'text/css', text: '/* Styles */\n' },
    },
  };
  const linkedComponentStylesheet = components.linkHtmlComponentStylesheet(
    componentStylesheetProject,
    'kodety-styles.css',
  );
  assert.match(linkedComponentStylesheet.files['index.html'].text, /href="kodety-styles\.css"/);
  assert.match(linkedComponentStylesheet.files['pages/about.html'].text, /href="\.\.\/kodety-styles\.css"/);
  assert.match(
    linkedComponentStylesheet.files['.incode/components/navbar/default.html'].text,
    /href="\.\.\/\.\.\/\.\.\/kodety-styles\.css"/,
  );
  assert.equal(
    linkedComponentStylesheet.files['.incode/experiments/control.html'],
    componentStylesheetProject.files['.incode/experiments/control.html'],
    'component CSS must not leak into unrelated editor-only HTML documents',
  );

  const bundleReference = componentBundles.createHtmlComponentBundleReference('footer');
  assert.deepEqual(bundleReference, {
    version: 1,
    manifestFilePath: '.incode/components/footer/component.json',
    styleFilePath: '.incode/components/footer/component.css',
  });
  assert.equal(
    componentBundles.htmlComponentDocumentRootDeclarationIsPortable('background'),
    false,
    'a page background must not become the component root background',
  );
  assert.equal(
    componentBundles.htmlComponentDocumentRootDeclarationIsPortable('background-color'),
    false,
    'a page background color must not make transparent components opaque',
  );
  assert.equal(
    componentBundles.htmlComponentDocumentRootDeclarationIsPortable('--brand-color'),
    true,
    'document custom properties remain available to the extracted component',
  );
  assert.equal(
    componentBundles.htmlComponentDocumentRootDeclarationIsPortable('font-family'),
    true,
    'inherited typography remains available to the extracted component',
  );
  const nestedComponentCss = componentBundles.rebaseHtmlComponentStylesheetScope(
    `[data-kodety-component-scope="footer"]:is(.site-footer__contact), [data-kodety-component-scope="footer"] .site-footer__contact { position: absolute; color: #f0ede4; }
@media (max-width: 767px) { body[data-kodety-component-variant-editor="footer-home"] :is(.site-footer__contact), [data-kodety-component-state-variant="footer-home"] .site-footer__contact, [data-kodety-component-scope='footer'] .site-footer__contact { position: relative; } }
[data-kodety-component-scope=footer] .site-footer__contact a { color: inherit; }`,
    'footer',
    'footer-contact',
    'footer-home',
    'contact-default',
  );
  assert.doesNotMatch(
    nestedComponentCss,
    /data-kodety-component-scope=(?:"footer"|'footer'|footer\s*\])/,
  );
  assert.match(
    nestedComponentCss,
    /\[data-kodety-component-scope="footer-contact"\]:is\(\.site-footer__contact\)/,
  );
  assert.match(
    nestedComponentCss,
    /@media \(max-width: 767px\)[\s\S]*?\[data-kodety-component-scope="footer-contact"\] \.site-footer__contact/,
  );
  assert.match(
    nestedComponentCss,
    /body\[data-kodety-component-variant-editor="contact-default"\] :is\(\.site-footer__contact\)/,
  );
  assert.match(
    nestedComponentCss,
    /\[data-kodety-component-state-variant="contact-default"\] \.site-footer__contact/,
  );
  assert.match(
    nestedComponentCss,
    /\[data-kodety-component-scope="footer-contact"\] \.site-footer__contact a/,
  );
  const bundledProject = {
    ...componentStylesheetProject,
    mainHtmlPath: 'pages/about.html',
    files: {
      ...componentStylesheetProject.files,
      'assets/logo.svg': {
        path: 'assets/logo.svg',
        mimeType: 'image/svg+xml',
        text: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      },
      '.incode/components/footer/component.css': {
        path: '.incode/components/footer/component.css',
        mimeType: 'text/css',
        text: '[data-kodety-component-scope="footer"]{background-image:url("../../../assets/logo.svg")}',
      },
      '.incode/components/footer/component.json': {
        path: '.incode/components/footer/component.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          componentId: 'footer',
          styleFilePath: '.incode/components/footer/component.css',
          variants: [{ id: 'default', filePath: '.incode/components/footer/default.html' }],
          dependencies: {
            stylesheets: ['styles.css'],
            externalStylesheets: [],
            projectFiles: ['assets/logo.svg'],
            externalUrls: [],
          },
        }),
      },
      '.incode/components/footer/default.html': {
        path: '.incode/components/footer/default.html',
        mimeType: 'text/html',
        text: '<html><body><footer data-kodety-component-scope="footer"></footer></body></html>',
      },
    },
  };
  const bundledLibrary = {
    components: [{
      id: 'footer',
      name: 'Footer',
      bundle: bundleReference,
      variants: [{ id: 'default', filePath: '.incode/components/footer/default.html' }],
    }],
  };
  const bundledPage = '<html><head></head><body><footer data-kodety-component-id="footer" data-kodety-component-scope="footer"></footer></body></html>';
  const attachedBundle = componentBundles.attachHtmlComponentStylesheets(
    bundledPage,
    bundledProject,
    bundledLibrary,
    'pages/about.html',
  );
  assert.match(attachedBundle, /href="\.\.\/\.incode\/components\/footer\/component\.css"/);
  const inlinedBundle = componentBundles.inlineHtmlComponentStyles(
    bundledPage,
    bundledProject,
    bundledLibrary,
    'pages/about.html',
  );
  assert.match(inlinedBundle, /data-kodety-component-styles/);
  assert.match(inlinedBundle, /url\("\.\.\/assets\/logo\.svg"\)/);
  assert.doesNotMatch(inlinedBundle, /<link[^>]+\.incode\/components\/footer\/component\.css/);

  const legacyMasterSource = '<!doctype html><html><head><base href="../../../"><link rel="stylesheet" href="css/components.css"></head><body data-kodety-component-editor="legacy-card" data-kodety-component-variant-editor="default"><article class="legacy-card" data-kodety-component-node="root"><img src="assets/logo.svg" data-kodety-component-node="logo"></article></body></html>';
  const legacyProject = {
    ...bundledProject,
    files: {
      ...bundledProject.files,
      'css/components.css': {
        path: 'css/components.css',
        mimeType: 'text/css',
        text: '.legacy-card{background-image:url("../assets/logo.svg")}@media (max-width:767px){.legacy-card{display:block}}',
      },
      '.incode/components/legacy-card/default.html': {
        path: '.incode/components/legacy-card/default.html',
        mimeType: 'text/html',
        text: legacyMasterSource,
      },
    },
  };
  const legacyVariant = {
    id: 'default',
    filePath: '.incode/components/legacy-card/default.html',
  };
  const legacyReferencePath = componentBundles.htmlComponentSourceReferencePath(
    legacyMasterSource,
    legacyVariant.filePath,
  );
  assert.equal(legacyReferencePath, '__component_base__.html');
  assert.equal(
    componentBundles.rebaseHtmlComponentReferenceValue(
      legacyProject,
      'assets/logo.svg',
      legacyReferencePath,
      legacyVariant.filePath,
    ),
    '../../../assets/logo.svg',
  );
  const mergedLegacyResults = componentBundles.mergeHtmlComponentBundleResults(
    {
      id: 'legacy-card',
      name: 'Legacy Card',
      variants: [legacyVariant, { id: 'alternate', filePath: '.incode/components/legacy-card/alternate.html' }],
    },
    [
      {
        markup: '<article>Primary</article>',
        styleText: '/* Kodety component: Legacy Card */\n[data-kodety-component-scope="legacy-card"]{display:block}\n',
        manifestText: '',
        manifest: {
          version: 1,
          componentId: 'legacy-card',
          styleFilePath: '.incode/components/legacy-card/component.css',
          variants: [legacyVariant],
          dependencies: {
            stylesheets: ['css/components.css'],
            externalStylesheets: [],
            projectFiles: ['assets/logo.svg'],
            externalUrls: [],
          },
        },
      },
      {
        markup: '<article>Alternate</article>',
        styleText: '/* Kodety component: Legacy Card */\n[data-kodety-component-scope="legacy-card"]{display:block}\n@media(max-width:767px){[data-kodety-component-scope="legacy-card"]{width:100%}}\n',
        manifestText: '',
        manifest: {
          version: 1,
          componentId: 'legacy-card',
          styleFilePath: '.incode/components/legacy-card/component.css',
          variants: [],
          dependencies: {
            stylesheets: ['css/alternate.css'],
            externalStylesheets: ['https://cdn.example.com/type.css'],
            projectFiles: ['assets/alternate.svg'],
            externalUrls: ['https://example.com/alternate'],
          },
        },
      },
    ],
  );
  assert.ok(mergedLegacyResults);
  assert.equal(
    (mergedLegacyResults.styleText.match(/display:block/g) || []).length,
    1,
    'legacy variants must deduplicate common CSS rules',
  );
  assert.match(mergedLegacyResults.styleText, /@media\(max-width:767px\)/);
  assert.deepEqual(
    mergedLegacyResults.manifest.dependencies.projectFiles,
    ['assets/alternate.svg', 'assets/logo.svg'],
  );
  assert.deepEqual(
    mergedLegacyResults.manifest.variants.map(variant => variant.id),
    ['default', 'alternate'],
  );
  assert.equal(
    componentBundles.rebaseHtmlComponentReferenceValue(
      legacyProject,
      'css/components.css',
      legacyReferencePath,
      legacyVariant.filePath,
    ),
    '../../../css/components.css',
  );
  assert.equal(
    componentBundles.htmlComponentSourceReferencePath(
      '<html><head></head><body></body></html>',
      legacyVariant.filePath,
    ),
    legacyVariant.filePath,
  );
  assert.equal(
    componentBundles.htmlComponentSourceReferencePath(
      '<html><head><base href="https://example.com/"></head><body></body></html>',
      legacyVariant.filePath,
    ),
    legacyVariant.filePath,
  );
  /* The browser-only extractor consumes this resolved reference before it
     scopes CSS and records dependencies. The pure assertions above protect
     the legacy <base> path math without introducing a DOM test environment. */
  assert.match(
    legacyProject.files['css/components.css'].text,
    /@media \(max-width:767px\)/,
  );
  /* keep the fixture representative of a copied-head legacy master */
  assert.match(
    legacyMasterSource,
    /<base href="\.\.\/\.\.\/\.\.\/">/,
  );
  /* path rebasing must never create a component-local asset copy */
  assert.equal(
    Object.keys(legacyProject.files).some(filePath => (
      filePath.startsWith('.incode/components/legacy-card/assets/')
    )),
    false,
  );
  assert.equal(
    componentBundles.rebaseHtmlComponentReferenceValue(
      legacyProject,
      '../assets/logo.svg',
      'css/components.css',
      '.incode/components/legacy-card/component.css',
    ),
    '../../../assets/logo.svg',
  );
  assert.equal(
    components.linkHtmlComponentStylesheet(linkedComponentStylesheet, 'kodety-styles.css'),
    linkedComponentStylesheet,
    'linking the shared component stylesheet must be idempotent',
  );

  const pageBefore = document(`
    <main>
      <section data-kodety-component-id="card" data-kodety-component-instance="one" data-kodety-component-variant="primary"><span>One</span></section>
      <p>Authored page content</p>
      <section data-kodety-component-id="card" data-kodety-component-instance="two" data-kodety-component-variant="primary"><span>Two</span></section>
    </main>
  `);
  const pageAfter = document(`
    <main>
      <article data-kodety-component-id="card" data-kodety-component-instance="one" data-kodety-component-variant="alternate"><strong>Changed one</strong></article>
      <p>Authored page content</p>
      <section data-kodety-component-id="card" data-kodety-component-instance="two" data-kodety-component-variant="primary"><span>Changed two</span><i>New child</i></section>
    </main>
  `);
  const liveReplacements = components.htmlComponentLiveReplacements(pageBefore, pageAfter);
  assert.equal(liveReplacements.length, 2);
  assert.deepEqual(liveReplacements.map(replacement => replacement.path), ['0/0', '0/2']);
  assert.equal(
    components.htmlComponentLiveReplacements(
      pageBefore,
      pageAfter.replace('Authored page content', 'Unrelated page change'),
    ),
    null,
    'live component projection must reject changes outside stable instance roots',
  );

  const oldPrimary = document(`
    <section data-kodety-component-node="root" class="card" style="color: red; padding: 10px">
      <h2 data-kodety-component-node="title" style="opacity: 1">Old title</h2>
    </section>
  `);
  const nextPrimary = document(`
    <section data-kodety-component-node="root" class="card primary" style="color: blue; padding: 20px; background-color: white">
      <h2 data-kodety-component-node="title" style="opacity: .8">New title</h2>
      <p data-kodety-component-node="description">New description</p>
    </section>
  `);
  const authoredVariant = document(`
    <section data-kodety-component-node="root" class="card" style="color: green; padding: 10px">
      <h2 data-kodety-component-node="title" style="opacity: 1">Old title</h2>
    </section>
  `);

  const migrated = inheritance.inferHtmlComponentVariantOverrides(
    oldPrimary,
    authoredVariant,
  );
  assert.deepEqual(migrated['node:root'].styles, ['color']);
  assert.equal(migrated['node:root'].attributes, undefined);
  assert.equal(migrated['node:title'], undefined);

  const isolatedVariant = inheritance.ensureHtmlComponentVariantReusableClass(
    authoredVariant,
    '0/0',
    'alternate',
  );
  assert.match(isolatedVariant.className, /^incode-variant-alternate-title-/);
  assert.match(isolatedVariant.source, new RegExp(`class="${isolatedVariant.className}"`));
  assert.equal(
    inheritance.ensureHtmlComponentVariantReusableClass(
      isolatedVariant.source,
      '0/0',
      'alternate',
    ).source,
    isolatedVariant.source,
    'repeated edits must reuse the same secondary-variant class',
  );
  const semanticDisplayClass = inheritance.ensureHtmlComponentVariantReusableClass(
    authoredVariant,
    '0/0',
    'alternate',
    'display',
  );
  assert.equal(semanticDisplayClass.className, 'variant-display-01');
  assert.equal(
    inheritance.ensureHtmlComponentVariantReusableClass(
      semanticDisplayClass.source,
      '0/0',
      'alternate',
      'display',
    ).className,
    'variant-display-01',
    'repeated edits to the same property must reuse its semantic class',
  );
  const semanticColorClass = inheritance.ensureHtmlComponentVariantReusableClass(
    semanticDisplayClass.source,
    '0/0',
    'alternate',
    'color',
    ['variant-color-01'],
  );
  assert.equal(semanticColorClass.className, 'variant-color-02');
  assert.match(semanticColorClass.source, /class="variant-display-01 variant-color-02"/);
  const isolatedOwnership = inheritance.recordHtmlComponentVariantReusableClassOverride(
    migrated,
    isolatedVariant.nodeKey,
  );
  assert.deepEqual(isolatedOwnership['node:title'].attributes, ['class']);
  const primaryWithChangedTitleClass = nextPrimary.replace(
    'data-kodety-component-node="title"',
    'data-kodety-component-node="title" class="primary-title"',
  );
  const classInherited = inheritance.inheritHtmlComponentPrimaryVariantEdit(
    oldPrimary,
    primaryWithChangedTitleClass,
    isolatedVariant.source,
    isolatedOwnership,
  );
  assert.match(classInherited, new RegExp(`class="${isolatedVariant.className}"`));
  assert.doesNotMatch(classInherited, /primary-title/);

  const inherited = inheritance.inheritHtmlComponentPrimaryVariantEdit(
    oldPrimary,
    nextPrimary,
    authoredVariant,
    migrated,
  );
  assert.deepEqual(styleAt(inherited, 'root'), {
    color: 'green',
    padding: '20px',
    'background-color': 'white',
  });
  assert.deepEqual(styleAt(inherited, 'title'), { opacity: '.8' });
  assert.match(inherited, /class="card primary"/);
  assert.match(inherited, />New title<\/h2>/);
  assert.match(inherited, /data-kodety-component-node="description"/);

  // Ownership is metadata, not merely a value comparison. Even when the
  // primary later happens to equal the override, its next edit cannot erase it.
  const primaryMatchingOverride = document(`
    <section data-kodety-component-node="root" class="card primary" style="color: green; padding: 20px; background-color: white">
      <h2 data-kodety-component-node="title" style="opacity: .8">New title</h2>
      <p data-kodety-component-node="description">New description</p>
    </section>
  `);
  const primaryAfterMatch = document(`
    <section data-kodety-component-node="root" class="card primary" style="color: yellow; padding: 20px; background-color: white">
      <h2 data-kodety-component-node="title" style="opacity: .8">New title</h2>
      <p data-kodety-component-node="description">New description</p>
    </section>
  `);
  const afterMatchingPrimary = inheritance.inheritHtmlComponentPrimaryVariantEdit(
    primaryMatchingOverride,
    primaryAfterMatch,
    inherited,
    migrated,
  );
  assert.equal(styleAt(afterMatchingPrimary, 'root').color, 'green');

  const editedVariant = document(`
    <section data-kodety-component-node="root" class="card" style="color: green">
      <h2 data-kodety-component-node="title" style="opacity: .4">Old title</h2>
    </section>
  `);
  const recorded = inheritance.recordHtmlComponentVariantEditOverrides(
    authoredVariant,
    editedVariant,
    migrated,
  );
  assert.deepEqual(recorded['node:root'].styles, ['color', 'padding']);
  assert.deepEqual(recorded['node:title'].styles, ['opacity']);
  const withResponsiveCss = inheritance.recordHtmlComponentVariantCssOverride(
    recorded,
    'node:title',
    {
      property: 'color',
      cssFilePath: 'styles.css',
      selector: '[data-kodety-component-state-variant="alternate"] .title',
      pseudo: 'hover',
      breakpoint: 'tablet',
    },
  );
  assert.deepEqual(
    Object.values(withResponsiveCss['node:title'].css),
    [{
      property: 'color',
      cssFilePath: 'styles.css',
      selector: '[data-kodety-component-state-variant="alternate"] .title',
      pseudo: 'hover',
      breakpoint: 'tablet',
    }],
  );

  // A structural override on the parent protects a variant-only child list.
  const structuralVariant = document(`
    <section data-kodety-component-node="root" class="card" style="color: red; padding: 10px">
      <h2 data-kodety-component-node="title" style="opacity: 1">Old title</h2>
      <aside data-kodety-component-node="variant-only">Variant only</aside>
    </section>
  `);
  const structuralOwnership = inheritance.inferHtmlComponentVariantOverrides(
    oldPrimary,
    structuralVariant,
  );
  assert.equal(structuralOwnership['node:root'].children, true);
  const structuralInherited = inheritance.inheritHtmlComponentPrimaryVariantEdit(
    oldPrimary,
    nextPrimary,
    structuralVariant,
    structuralOwnership,
  );
  assert.match(structuralInherited, /data-kodety-component-node="variant-only"/);
  assert.doesNotMatch(structuralInherited, /data-kodety-component-node="description"/);

  // Reset is scoped to the selected layer: its own state returns to Primary,
  // while an independently overridden descendant node remains the same object.
  const reset = inheritance.resetHtmlComponentVariantLayerSource(
    nextPrimary,
    editedVariant,
    '0',
  );
  assert.equal(reset.nodeKey, 'node:root');
  assert.equal(styleAt(reset.source, 'root').color, 'blue');
  assert.equal(styleAt(reset.source, 'title').opacity, '.4');
  const cleared = inheritance.clearHtmlComponentVariantLayerOverride(recorded, reset.nodeKey);
  assert.equal(cleared['node:root'], undefined);
  assert.deepEqual(cleared['node:title'].styles, ['opacity']);

  const customBefore = document('<section data-kodety-component-node="root" style="--Gap: 10px; --gap: 20px; gap: var(--Gap)"><p data-kodety-component-node="child" style="--Accent: red">Child</p></section>');
  const customVariant = customBefore.replace('--Gap: 10px', '--Gap: 30px').replace('--Accent: red', '--Accent: green');
  const customPrimary = customBefore.replace('--Gap: 10px', '--Gap: 40px').replace('--gap: 20px', '--gap: 50px').replace('--Accent: red', '--Accent: blue');
  const customOverrides = inheritance.recordHtmlComponentVariantEditOverrides(customBefore, customVariant);
  assert.deepEqual(customOverrides['node:root'].styles, ['--Gap'], 'a differently cased token is an independent override');
  let customCssOverrides = customOverrides;
  for (const property of ['--Gap', '--gap']) {
    customCssOverrides = inheritance.recordHtmlComponentVariantCssOverride(customCssOverrides, 'node:root', {
      property, cssFilePath: 'styles.css', selector: '.alternate', pseudo: 'hover', breakpoint: 'tablet',
    });
  }
  assert.deepEqual(Object.values(customCssOverrides['node:root'].css).map(entry => entry.property), ['--Gap', '--gap']);
  const customInherited = inheritance.inheritHtmlComponentPrimaryVariantEdit(customBefore, customPrimary, customVariant, customOverrides);
  assert.deepEqual(styleAt(customInherited, 'root'), { '--Gap': '30px', '--gap': '50px', gap: 'var(--Gap)' }, 'Primary must update only the token not owned by the variant');
  assert.equal(styleAt(customInherited, 'child')['--Accent'], 'green');
  const customReset = inheritance.resetHtmlComponentVariantLayerSource(customPrimary, customInherited, '0');
  assert.deepEqual(styleAt(customReset.source, 'root'), { '--Gap': '40px', '--gap': '50px', gap: 'var(--Gap)' });
  assert.equal(styleAt(customReset.source, 'child')['--Accent'], 'green', 'resetting the parent must retain the child token override');
  assert.equal(inheritance.clearHtmlComponentVariantLayerOverride(customCssOverrides, customReset.nodeKey)['node:root'], undefined);

  console.log('HTML component variant inheritance tests passed.');
} finally {
  await server.close();
}
