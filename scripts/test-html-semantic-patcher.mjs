import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const html = body => `<!doctype html>\n<html><head></head><body>\n${body}\n</body></html>`;
const rejectsStructure = callback => assert.throws(
  callback,
  error => error instanceof Error && /HTML inválido|não pode (?:conter|envolver|substituir)/i.test(error.message),
);

try {
  const [patcher, classSelector, elementClipboard, clipboardSvg] = await Promise.all([
    server.ssrLoadModule('/lib/html-editor/source-patcher.ts'),
    server.ssrLoadModule('/lib/html-editor/class-selector.ts'),
    server.ssrLoadModule('/lib/html-editor/element-clipboard.ts'),
    server.ssrLoadModule('/lib/html-editor/clipboard-svg.ts'),
  ]);
  const [localization, editorLocalizationHelpers] = await Promise.all([
    server.ssrLoadModule('/lib/html-editor/localization.ts'),
    server.ssrLoadModule('/lib/html-editor/editor-localization-helpers.ts'),
  ]);

  // Selection/component consumers in the same render turn must share one
  // authored-tree parse. A different source still receives independent offsets.
  const cachedSource = html('<main><section><p>Cached tree</p></section></main>');
  const cachedElements = patcher.inspectSourceElements(cachedSource);
  const cachedIndex = patcher.inspectSourceElementIndex(cachedSource);
  assert.strictEqual(patcher.inspectSourceElements(cachedSource), cachedElements);
  assert.strictEqual(
    patcher.inspectSourceElementIndex(cachedSource),
    cachedIndex,
    'body-aware consumers must share the same authored parse/index',
  );
  assert.strictEqual(cachedIndex.elements, cachedElements);
  assert.equal(cachedIndex.body?.path, '');
  assert.equal(cachedIndex.body?.tagName, 'body');
  assert.strictEqual(
    cachedIndex.byPath.get(''),
    cachedIndex.body,
    'the empty canvas path must resolve to body in the shared index',
  );
  assert.strictEqual(cachedIndex.byPath.get('0/0/0'), cachedElements[2]);
  assert.equal(
    patcher.getElementOuterHtml(cachedSource, '0/0/0'),
    '<p>Cached tree</p>',
  );
  assert.match(
    patcher.getElementOuterHtml(cachedSource, ''),
    /^<body>[\s\S]*<\/body>$/,
    'the cached lookup must preserve the canvas body selection at the empty path',
  );
  assert.strictEqual(patcher.inspectSourceElements(cachedSource), cachedElements);
  assert.notStrictEqual(
    patcher.inspectSourceElements(html('<main><p>Different tree</p></main>')),
    cachedElements,
  );

  // Locale width/font scrubs resolve the same rendered tree once for both the
  // insertion owner and stable element key. Repeated/multi-selection lookups
  // must stay on the source patcher's bounded parse5 index rather than opening
  // a fresh DOMParser and parse5 tree for every target.
  const localizedResolutionSource = html(`
    <main>
      <section data-kodety-locale-insertion="hero"><h1>First</h1></section>
      <section data-kodety-locale-insertion-id="hero"><h2>Second</h2></section>
      <aside data-kodety-locale-insertion-id="legacy"><p>Legacy</p></aside>
      <p data-kodety-l10n-id="standalone">Stable</p>
      <table data-kodety-locale-insertion="table"><tr><td>Implicit tbody</td></tr></table>
    </main>
  `);
  const localizedResolutionIndex = patcher.inspectSourceElementIndex(localizedResolutionSource);
  const previousDomParser = globalThis.DOMParser;
  globalThis.DOMParser = class {};
  try {
    assert.deepEqual(
      editorLocalizationHelpers.localeInsertionAtPath(localizedResolutionSource, '0/0/0'),
      { id: 'hero', rootPath: '0/0', rootIndex: 0, rootCount: 2 },
    );
    assert.deepEqual(
      editorLocalizationHelpers.localeInsertionAtPath(localizedResolutionSource, '0/1/0'),
      { id: 'hero', rootPath: '0/1', rootIndex: 1, rootCount: 2 },
      'legacy insertion markers must share the canonical owner ordering',
    );
    assert.deepEqual(
      editorLocalizationHelpers.localeInsertionAtPath(localizedResolutionSource, '0/2/0'),
      { id: 'legacy', rootPath: '0/2', rootIndex: 0, rootCount: 1 },
    );
    assert.equal(
      localization.localeElementKeyForPath(localizedResolutionSource, '0/0/0'),
      'insertion:hero',
      'an insertion owner must continue to outrank descendant stable IDs',
    );
    assert.equal(
      localization.localeElementKeyForPath(localizedResolutionSource, '/0/3/'),
      'id:standalone',
      'normalized canvas paths must retain stable locale keys',
    );
    assert.deepEqual(
      editorLocalizationHelpers.localeInsertionAtPath(localizedResolutionSource, '0/4/0'),
      { id: 'table', rootPath: '0/4', rootIndex: 0, rootCount: 1 },
      'browser-inserted structural elements must retain their authored insertion ancestor',
    );
    assert.equal(
      localization.localeElementKeyForPath(localizedResolutionSource, '0/4/0'),
      'insertion:table',
      'implicit table structure must keep the insertion key resolved by the old browser DOM walk',
    );
    assert.equal(localization.localeElementKeyForPath(localizedResolutionSource, ''), 'body');
    assert.strictEqual(
      patcher.inspectSourceElementIndex(localizedResolutionSource),
      localizedResolutionIndex,
      'insertion and key resolution must reuse the already parsed localized HTML index',
    );
  } finally {
    if (previousDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousDomParser;
  }

  const sourcePatcherModuleSource = await readFile(
    path.join(root, 'lib/html-editor/source-patcher.ts'),
    'utf8',
  );
  const cacheLimit = Number(
    sourcePatcherModuleSource.match(/const SOURCE_ELEMENT_CACHE_LIMIT = (\d+);/)?.[1],
  );
  assert.ok(Number.isInteger(cacheLimit) && cacheLimit > 0, 'the shared HTML index cache must stay explicitly bounded');
  const evictionSource = html('<main><p>Evict this localized tree</p></main>');
  const evictedIndex = patcher.inspectSourceElementIndex(evictionSource);
  for (let index = 0; index < cacheLimit; index++) {
    patcher.inspectSourceElementIndex(html(`<main><p>New localized tree ${index}</p></main>`));
  }
  assert.notStrictEqual(
    patcher.inspectSourceElementIndex(evictionSource),
    evictedIndex,
    'localized document indexes must leave memory after the bounded LRU window',
  );

  const localizationHelperSource = await readFile(
    path.join(root, 'lib/html-editor/editor-localization-helpers.ts'),
    'utf8',
  );
  const insertionResolverSource = localizationHelperSource.slice(
    localizationHelperSource.indexOf('export function localeInsertionAtPath'),
    localizationHelperSource.indexOf('export function localizedElementAtPath'),
  );
  assert.match(insertionResolverSource, /inspectSourceElementIndex\(source\)/);
  assert.doesNotMatch(
    insertionResolverSource,
    /new DOMParser/,
    'locale insertion lookup must not parse the complete rendered document per target',
  );

  const localizationModuleSource = await readFile(
    path.join(root, 'lib/html-editor/localization.ts'),
    'utf8',
  );
  const elementKeyResolverSource = localizationModuleSource.slice(
    localizationModuleSource.indexOf('export function localeElementKeyForPath'),
    localizationModuleSource.indexOf('/** Assign an ID to every editable/anchor element'),
  );
  assert.match(elementKeyResolverSource, /inspectSourceElementIndex\(source\)/);
  assert.doesNotMatch(
    elementKeyResolverSource,
    /parsedDocumentParts\(source\)/,
    'locale element keys must share the localized index instead of reparsing with parse5',
  );

  const indexedClassSource = '<!doctype html><html><body class="theme base"><main class="base combo"><p class="base combo detail">Text</p></main></body></html>';
  assert.deepEqual(
    classSelector.allClassNames(indexedClassSource),
    ['theme', 'base', 'combo', 'detail'],
    'class discovery through the shared index must retain body and document order',
  );
  assert.equal(classSelector.countClassUsage(indexedClassSource, ['base']), 3);
  assert.equal(classSelector.countClassUsage(indexedClassSource, ['base', 'combo']), 2);
  assert.deepEqual(
    classSelector.comboSuggestions(indexedClassSource, 'base', ['theme']),
    ['combo', 'detail'],
    'shared-index combo suggestions must retain frequency ordering',
  );

  const renameProject = {
    name: 'Atomic class rename fixture',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': {
        path: 'index.html', mimeType: 'text/html',
        text: '<main class="button shell"><a class="button cta">Buy</a></main>',
      },
      'about.html': {
        path: 'about.html', mimeType: 'text/html',
        text: '<section class="button">About</section>',
      },
      'styles/base.css': {
        path: 'styles/base.css', mimeType: 'text/css',
        text: '.button, .shell > .button:hover { color: red; }\n.keep { color: blue; }',
      },
      'styles/responsive.css': {
        path: 'styles/responsive.css', mimeType: 'text/css',
        text: '@media (max-width: 410px) { .button { display: grid; } }',
      },
      'ignored.html': {
        path: 'ignored.html', mimeType: 'text/html', text: '<p class="button">Sibling experiment</p>',
      },
      '.incode/animations/index.html.json': {
        path: '.incode/animations/index.html.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 2,
          canonical: true,
          interactions: [{
            id: 'button-click',
            name: 'Button click',
            trigger: 'click',
            triggerSelector: '.button',
            triggerLabel: '.button',
            triggerTargetMode: 'class',
            actions: [],
          }],
        }),
      },
    },
  };
  const renamedProject = classSelector.renameProjectClassReferences(
    renameProject,
    ['styles/responsive.css', 'index.html', 'styles/base.css', 'about.html', 'index.html'],
    'button',
    'cta',
  );
  assert.deepEqual(renamedProject.changedFilePaths, [
    '.incode/animations/index.html.json',
    'about.html',
    'index.html',
    'styles/base.css',
    'styles/responsive.css',
  ]);
  assert.match(renamedProject.project.files['about.html'].text, /class="cta"/);
  assert.match(renamedProject.project.files['index.html'].text, /class="cta shell"/);
  assert.match(
    renamedProject.project.files['index.html'].text,
    /class="cta"/, // Existing `cta` is deduplicated after button → cta.
  );
  assert.match(renamedProject.project.files['styles/base.css'].text, /\.cta, \.shell > \.cta:hover/);
  assert.match(renamedProject.project.files['styles/responsive.css'].text, /\.cta \{ display: grid/);
  assert.match(
    renamedProject.project.files['.incode/animations/index.html.json'].text,
    /"triggerSelector": "\.cta"/,
    'the same atomic transaction must keep Interactions v2 selectors coherent',
  );
  assert.equal(renamedProject.project.files['styles/base.css'].text.includes('.keep'), true);
  assert.strictEqual(renamedProject.project.files['ignored.html'], renameProject.files['ignored.html']);
  assert.equal(renameProject.files['index.html'].text.includes('button'), true, 'input snapshot stays immutable');

  const invalidRenameProject = {
    ...renameProject,
    files: {
      ...renameProject.files,
      'styles/broken.css': {
        path: 'styles/broken.css', mimeType: 'text/css', text: '.button { color: red;',
      },
    },
  };
  assert.throws(() => classSelector.renameProjectClassReferences(
    invalidRenameProject,
    ['index.html', 'styles/broken.css'],
    'button',
    'cta',
  ));
  assert.strictEqual(
    invalidRenameProject.files['index.html'],
    renameProject.files['index.html'],
    'a later CSS parse failure must roll back the entire prepared transaction',
  );

  const elementCopySource = html(`
    <main>
      <button id="cta" class="button primary incode-card">Buy <span class="icon">now</span><em class="js-hook">!</em></button>
      <section class="target"></section>
    </main>
  `);
  const elementCopyCss = [
    '.button, .unrelated { margin-top: 12px; border-radius: 9px; color: #fff; }',
    '.button:hover { color: #111; }',
    '.button.primary { display: inline-flex; }',
    '.theme-shell .button { box-shadow: 0 2px 8px #0004; }',
    '.incode-card.incode-card.incode-card { padding: 8px; }',
    '#cta .icon { width: 14px; }',
    '@media (max-width: 700px) { .button { margin-top: 6px; } }',
  ].join('\n');
  const preparedElementPaste = elementClipboard.prepareIndependentElementPaste(
    elementCopySource,
    '<button id="cta" class="button primary incode-card">Buy <span class="icon">now</span><em class="js-hook">!</em></button>',
    { 'styles/site.css': elementCopyCss },
  );
  assert.deepEqual(preparedElementPaste.changedStylesheetPaths, ['styles/site.css']);
  assert.deepEqual(preparedElementPaste.classAliases, {
    button: 'button-copy',
    primary: 'primary-copy',
    'incode-card': 'incode-card-copy',
    icon: 'icon-copy',
  });
  assert.deepEqual(preparedElementPaste.idAliases, { cta: 'cta-copy' });
  assert.match(
    preparedElementPaste.markup,
    /id="cta-copy" class="button button-copy primary primary-copy incode-card incode-card-copy"/,
    'an element paste must retain behavior hooks while adding copy-specific visual classes',
  );
  assert.match(preparedElementPaste.markup, /class="icon icon-copy"/);
  assert.match(
    preparedElementPaste.markup,
    /class="js-hook incode-em-copy-[^"]+"/,
    'a layer without a local CSS rule must still receive a unique class for its next edit',
  );
  const pastedCss = preparedElementPaste.stylesheets['styles/site.css'];
  assert.match(pastedCss, /\.button\.button-copy \{ margin-top: 12px; border-radius: 9px; color: #fff; \}/);
  assert.match(pastedCss, /\.button\.button-copy:hover \{ color: #111; \}/);
  assert.match(pastedCss, /\.button\.button-copy\.primary\.primary-copy \{ display: inline-flex; \}/);
  assert.match(
    pastedCss,
    /\.theme-shell \.button\.button-copy, \.button\.button-copy \{ box-shadow: 0 2px 8px #0004; \}/,
    'styles owned by an uncopied ancestor must also receive a copy-local selector',
  );
  assert.match(
    pastedCss,
    /\.incode-card\.incode-card\.incode-card\.incode-card-copy\.incode-card-copy\.incode-card-copy \{ padding: 8px; \}/,
    'editor-owned repeated-specificity selectors must retain their exact specificity shape',
  );
  assert.match(pastedCss, /#cta-copy \.icon\.icon-copy \{ width: 14px; \}/);
  assert.match(pastedCss, /@media \(max-width: 700px\) \{ \.button \{ margin-top: 6px; \} \.button\.button-copy \{ margin-top: 6px; \} \}/);
  assert.equal(
    pastedCss.match(/\.unrelated/g)?.length || 0,
    1,
    'a grouped selector clone must not duplicate unrelated selector branches',
  );

  const pastedSvg = clipboardSvg.prepareClipboardSvgMarkup(`
    <svg width="24" height="18" viewBox="0 0 24 18" onload="alert(1)">
      <script>alert(1)</script>
      <path id="line" fill="none" stroke="#123456" style="stroke-width: 2; background-image: url(https://bad.test/x)" d="M1 1h22"></path>
      <use href="#line"></use>
      <foreignObject><iframe src="https://bad.test"></iframe></foreignObject>
    </svg>
  `, 'svg-test');
  assert.match(pastedSvg, /^<svg[^>]*class="incode-svg-paste-svg-test"/);
  assert.match(pastedSvg, /width="24"/);
  assert.match(pastedSvg, /height="18"/);
  assert.match(pastedSvg, /style="[^"]*display: block[^"]*width: 24px[^"]*height: 18px/);
  assert.match(pastedSvg, /color: #123456/);
  assert.match(pastedSvg, /fill="none" stroke="currentColor"/);
  assert.match(pastedSvg, /id="svg-test-line"/);
  assert.match(pastedSvg, /href="#svg-test-line"/);
  assert.doesNotMatch(pastedSvg, /script|foreignObject|iframe|onload|bad\.test/i);
  assert.equal(
    patcher.ensureInsertedElementClasses(pastedSvg),
    pastedSvg,
    'the unique SVG root class must remain the authoring selector after the generic insert guard',
  );

  const gradientSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg viewBox="0 0 32 20"><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"></stop></linearGradient><clipPath id="clip"><rect width="32" height="20"></rect></clipPath></defs><rect width="32" height="20" fill="url(#paint)" clip-path="url(#clip)"></rect></svg>',
    'gradient-icon',
  );
  assert.match(gradientSvg, /width="32" height="20"/);
  assert.match(gradientSvg, /id="gradient-icon-paint"/);
  assert.match(gradientSvg, /fill="url\(#gradient-icon-paint\)"/);
  assert.match(gradientSvg, /clip-path="url\(#gradient-icon-clip\)"/);

  const multicolorSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg viewBox="0 0 20 10"><rect width="10" height="10" fill="#ff0000"></rect><rect x="10" width="10" height="10" fill="#0000ff"></rect></svg>',
    'multicolor-icon',
  );
  assert.match(multicolorSvg, /fill="#ff0000"/);
  assert.match(multicolorSvg, /fill="#0000ff"/);
  assert.doesNotMatch(multicolorSvg, /fill="currentColor"/);

  assert.throws(
    () => clipboardSvg.prepareClipboardSvgMarkup('<svg><path d="M0 0"></path></svg>', 'missing-size'),
    /width\/height|viewBox/i,
  );
  assert.throws(
    () => clipboardSvg.prepareClipboardSvgMarkup(`<svg viewBox="0 0 1 1">${' '.repeat(clipboardSvg.MAX_CLIPBOARD_SVG_CHARACTERS)}</svg>`),
    /grande demais/i,
  );
  const selectedContainerSource = html('<div><span>Selected</span></div>');
  const selectedContainerResult = patcher.patchInsertElement(selectedContainerSource, '0/0', pastedSvg);
  assert.match(
    selectedContainerResult,
    /<span>Selected\s*<svg[\s\S]*<\/svg><\/span>/,
    'an operating-system SVG paste must be a child of the exact selected layer',
  );
  assert.throws(
    () => patcher.patchInsertElement(html('<img src="icon.svg" alt="">'), '0', pastedSvg),
    /não foi possível inserir|HTML inválido/i,
    'a void image cannot silently move an SVG beside the selected element',
  );
  const fakeSvgClipboard = {
    files: [],
    items: [],
    types: ['text/plain'],
    getData: type => type === 'text/plain' ? '<svg viewBox="0 0 8 8"><path d="M0 0h8v8z"></path></svg>' : '',
  };
  assert.equal(clipboardSvg.clipboardContainsSvg(fakeSvgClipboard), true);
  assert.match(await clipboardSvg.readClipboardSvgSource(fakeSvgClipboard), /^<svg/);

  const hardenedSvg = clipboardSvg.prepareClipboardSvgMarkup(`
    <svg class="imported-root" viewBox="0 0 16 16" style="position: fixed; inset: 0; z-index: 999999; pointer-events: all">
      <defs><path id="inside" d="M0 0h4v4z"></path></defs>
      <path class="imported-child" style="fill: #ff0000; background-image: u\\72l(https://bad.test/a); filter: image-set('https://bad.test/b' 1x)" d="M0 0h16v16z"></path>
      <use href=" #inside "></use>
      <use href="#outside"></use>
      <rect clip-path="url(#outside)" width="4" height="4"></rect>
      <a href="#inside" ping="https://bad.test/p"><rect width="2" height="2"></rect></a>
    </svg>
  `, 'hardened');
  assert.doesNotMatch(hardenedSvg, /position:|inset:|z-index:|pointer-events:|background-image:|image-set|bad\.test|<a\b|imported-/i);
  assert.match(hardenedSvg, /href="#hardened-inside"/);
  assert.doesNotMatch(hardenedSvg, /href="#outside"|clip-path="url\(#outside\)"/);
  assert.match(hardenedSvg, /class="incode-svg-paste-hardened"/);

  const explicitPaintSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg viewBox="0 0 12 12" style="color:#000"><path fill="#f00" d="M0 0h12v12z"></path></svg>',
    'explicit-paint',
  );
  assert.match(explicitPaintSvg, /fill="currentColor"/);
  assert.match(explicitPaintSvg, /color: #f00/);
  const mixedCurrentColorSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg viewBox="0 0 12 12" style="color:#00f"><path fill="#f00" stroke="currentColor" d="M0 0h12v12z"></path></svg>',
    'mixed-paint',
  );
  assert.match(mixedCurrentColorSvg, /fill="#f00" stroke="currentColor"/);
  const winningStylePaintSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg viewBox="0 0 12 12"><path fill="#f00" style="fill:#00f" d="M0 0h12v12z"></path></svg>',
    'style-paint',
  );
  assert.match(winningStylePaintSvg, /fill="#f00" style="fill: currentColor/);
  assert.match(winningStylePaintSvg, /color: #00f/);

  const fractionalSizeSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg width="16.5" height="12.25" viewBox="0 0 16 12"></svg>',
    'fractional-size',
  );
  assert.match(fractionalSizeSvg, /width="16\.5" height="12\.25"/);
  const proportionalSizeSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg width="32" viewBox="0 0 16 8"></svg>',
    'proportional-size',
  );
  assert.match(proportionalSizeSvg, /width="32"/);
  assert.match(proportionalSizeSvg, /height="16"/);
  const dataDimensionSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg data-width="999" data-height="888" data-viewBox="0 0 999 888" viewBox="0 0 20 10"></svg>',
    'data-size',
  );
  assert.match(dataDimensionSvg, /width="20"/);
  assert.match(dataDimensionSvg, /height="10"/);
  assert.throws(
    () => clipboardSvg.prepareClipboardSvgMarkup('<svg width="100001" height="24"></svg>', 'huge-size'),
    /dimensões.*grandes/i,
  );
  assert.throws(
    () => clipboardSvg.prepareClipboardSvgMarkup(`<svg viewBox="0 0 8 8">${'<g>'.repeat(6_000)}${'</g>'.repeat(6_000)}</svg>`, 'deep-svg'),
    error => error instanceof Error && /complexidade/i.test(error.message) && !(error instanceof RangeError),
  );
  const oversizedClipboard = {
    files: [],
    items: [],
    types: ['text/plain'],
    getData: type => type === 'text/plain'
      ? `<svg viewBox="0 0 1 1">${' '.repeat(clipboardSvg.MAX_CLIPBOARD_SVG_CHARACTERS)}</svg>`
      : '',
  };
  assert.equal(clipboardSvg.clipboardContainsSvg(oversizedClipboard), true);
  await assert.rejects(() => clipboardSvg.readClipboardSvgSource(oversizedClipboard), /grande demais/i);
  const titledSvg = clipboardSvg.prepareClipboardSvgMarkup(
    '<svg viewBox="0 0 8 8" aria-hidden="true"><title>Close</title><path d="M0 0h8v8z"></path></svg>',
    'titled',
  );
  assert.match(titledSvg, /role="img"/);
  assert.doesNotMatch(titledSvg, /aria-hidden=/);

  // Generic insertion must respect the direct and transparent content models.
  rejectsStructure(() => patcher.patchInsertElement(
    html('<select><option>One</option></select>'),
    '0',
    '<div>Invalid select child</div>',
  ));
  rejectsStructure(() => patcher.patchInsertElement(
    html('<picture><source srcset="wide.webp"><img src="fallback.webp" alt=""></picture>'),
    '0',
    '<div>Invalid picture child</div>',
  ));
  rejectsStructure(() => patcher.patchInsertElement(
    html('<button><span>Save</span></button>'),
    '0',
    '<div>Invalid button child</div>',
  ));
  rejectsStructure(() => patcher.patchInsertElement(
    html('<label><span>Name</span></label>'),
    '0',
    '<div>Invalid label child</div>',
  ));
  rejectsStructure(() => patcher.patchInsertElement(
    html('<p><a href="/outer"><span>Outer link</span></a></p>'),
    '0/0',
    '<a href="/inner">Nested link</a>',
  ));
  rejectsStructure(() => patcher.patchInsertElement(
    html('<p><a href="/outer"><span>Outer link</span></a></p>'),
    '0/0',
    '<div>Block content cannot be inserted through a paragraph link</div>',
  ));
  rejectsStructure(() => patcher.patchInsertAdjacentElement(
    html('<select><option>One</option></select>'),
    '0/0',
    '<div>Invalid select sibling</div>',
    'after',
  ));
  rejectsStructure(() => patcher.patchInsertAdjacentElement(
    html('<picture><source srcset="wide.webp"><img src="fallback.webp" alt=""></picture>'),
    '0/1',
    '<source srcset="too-late.webp">',
    'after',
  ));
  rejectsStructure(() => patcher.patchInsertAdjacentElement(
    html('<button><span>Save</span></button>'),
    '0/0',
    '<div>Invalid button sibling</div>',
    'after',
  ));
  rejectsStructure(() => patcher.patchInsertAdjacentElement(
    html('<label><span>Name</span></label>'),
    '0/0',
    '<div>Invalid label sibling</div>',
    'after',
  ));
  rejectsStructure(() => patcher.patchInsertAdjacentElement(
    html('<p><a href="/outer"><span>Outer link</span></a></p>'),
    '0/0/0',
    '<a href="/inner">Nested link</a>',
    'after',
  ));
  assert.match(
    patcher.patchInsertElement(
      html('<select><option>One</option></select>'),
      '0',
      '<option>Two</option>',
    ),
    /<option>One<\/option>\s*<option>Two<\/option>/,
  );

  // The exact generic wrap routes share the same validator.
  rejectsStructure(() => patcher.patchWrapElement(
    html('<select><option>One</option></select>'),
    '0/0',
    'div',
  ));
  rejectsStructure(() => patcher.patchWrapElement(
    html('<picture><source srcset="wide.webp"><img src="fallback.webp" alt=""></picture>'),
    '0/1',
    'div',
  ));
  rejectsStructure(() => patcher.patchWrapElement(
    html('<button><span>Save</span></button>'),
    '0/0',
    'div',
  ));
  rejectsStructure(() => patcher.patchWrapElement(
    html('<label><span>Name</span></label>'),
    '0/0',
    'div',
  ));
  rejectsStructure(() => patcher.patchWrapElementWithAnchor(
    html('<div><a href="/outer">Outer link</a></div>'),
    '0/0',
    '/inner',
  ));

  // Retagging validates both the new parent placement and retained children.
  rejectsStructure(() => patcher.patchElementTag(
    html('<select><option>One</option></select>'),
    '0/0',
    'div',
  ));
  rejectsStructure(() => patcher.patchElementTag(
    html('<picture><source srcset="wide.webp"><img src="fallback.webp" alt=""></picture>'),
    '0',
    'div',
  ));
  rejectsStructure(() => patcher.patchElementTag(
    html('<button><span>Save</span></button>'),
    '0/0',
    'div',
  ));
  rejectsStructure(() => patcher.patchElementTag(
    html('<label><span>Name</span></label>'),
    '0/0',
    'div',
  ));
  rejectsStructure(() => patcher.patchElementTag(
    html('<p><a href="/outer"><span>Outer link</span></a></p>'),
    '0/0/0',
    'a',
  ));
  rejectsStructure(() => patcher.patchElementTag(
    html('<div><div>Block child</div></div>'),
    '0',
    'button',
  ));

  // A normal layer wrap works and remains reversible by the source operation
  // used by structural history/undo.
  const wrapSource = html('<aside class="desktop-gate"><p class="desktop-gate__note">Desktop gate note</p></aside>');
  const wrapped = patcher.patchWrapElement(wrapSource, '0/0', 'div');
  assert.match(
    wrapped.source,
    /<aside class="desktop-gate"><div>\s*<p class="desktop-gate__note">Desktop gate note<\/p>\s*<\/div><\/aside>/,
  );
  assert.equal(patcher.patchUnwrapElement(wrapped.source, '0/0').source, wrapSource);

  // Common semantic choices must round-trip. In particular, changing a text
  // paragraph to a div must not make P disappear from the Inspector.
  const paragraphSource = html('<aside><p class="desktop-gate__note">Desk &amp; note</p></aside>');
  const asDiv = patcher.patchElementTag(paragraphSource, '0/0', 'div');
  assert.match(asDiv, /<div class="desktop-gate__note">Desk &amp; note<\/div>/);
  assert.equal(patcher.patchElementTag(asDiv, '0/0', 'p'), paragraphSource);

  // alt="" is authored accessibility data, not a missing value.
  const decorative = html('<img src="divider.svg" alt="">');
  assert.match(patcher.patchElementAttribute(decorative, '0', 'alt', ''), /alt=""/);
  assert.match(
    patcher.patchElementAttribute(html('<img src="divider.svg" alt="Divider">'), '0', 'alt', ''),
    /alt=""/,
  );
  assert.match(
    patcher.patchElementAttribute(html('<img src="divider.svg">'), '0', 'alt', ''),
    /alt=""/,
  );

  // Combined text returns decoded text and re-escapes it once. Numeric and
  // named entities must never become &amp;amp; / &amp;#... after editing.
  const entitySource = html('<h2><span>Fish &amp; Chips &#38; &#x26; &copy;</span><strong>&lt;b&gt;</strong></h2>');
  const decodedLines = patcher.getCombinedTextLines(entitySource, '0');
  assert.deepEqual(decodedLines, ['Fish & Chips & & ©', '<b>']);
  const entityRoundTrip = patcher.patchContainerLines(entitySource, '0', decodedLines);
  assert.deepEqual(patcher.getCombinedTextLines(entityRoundTrip, '0'), decodedLines);
  assert.doesNotMatch(entityRoundTrip, /&amp;(?:amp|#(?:38|x26));/i);

  const inspectorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
    'utf8',
  );
  assert.match(
    inspectorSource,
    /const TAG_OPTIONS[\s\S]*?value: 'p', label: 'P \(parágrafo\)'/,
    'the persistent tag choices must include P after a P → Div retag',
  );

  const projectEditorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  const wrapRoute = projectEditorSource.slice(
    projectEditorSource.indexOf('const wrapLayer ='),
    projectEditorSource.indexOf('const unwrapLayer ='),
  );
  assert.match(wrapRoute, /const tag = 'div';/);
  assert.doesNotMatch(wrapRoute, /window\.prompt/);
  assert.match(
    wrapRoute,
    /patchWrapElement\(editorSourceRef\.current, path, tag\)[\s\S]*?commitLiveStructure\([\s\S]*?operation: 'wrap'/,
    'Wrap in div must apply immediately and commit through structural history so undo remains available',
  );
  const shortcutRoute = projectEditorSource.slice(
    projectEditorSource.indexOf('const handleShortcut ='),
    projectEditorSource.indexOf("window.addEventListener('keydown', handleShortcut"),
  );
  assert.match(
    shortcutRoute,
    /modifier && event\.shiftKey && key === 'c'[\s\S]*?editorCommandRef\.current\('copy-selection-styles'\)[\s\S]*?modifier && event\.shiftKey && key === 'v'[\s\S]*?editorCommandRef\.current\('paste-selection-styles'\)/,
    'style clipboard shortcuts must use the explicit Shift chord',
  );
  assert.match(
    shortcutRoute,
    /modifier && key === 'c' && selection[\s\S]*?editorCommandRef\.current\('copy-selection'\)[\s\S]*?modifier && key === 'v' && selection[\s\S]*?return/,
    'plain Ctrl/Cmd+V must reach the paste event so operating-system SVG data remains available',
  );
  assert.match(
    projectEditorSource,
    /const pasteFigmaSelection = async[\s\S]*?clipboardContainsSvg\(event\.clipboardData\)[\s\S]*?editorCommandRef\.current\('paste-selection'\)[\s\S]*?readClipboardSvgSource\(event\.clipboardData\)[\s\S]*?pasteInlineSvgRef\.current\(svg, targetPath\)[\s\S]*?window\.addEventListener\('paste', pasteListener, true\)/,
    'the parent paste route must prefer SVG clipboard data and preserve ordinary internal layer paste as its fallback',
  );
  assert.match(
    projectEditorSource,
    /const copyCurrentStyles = \(\) =>[\s\S]*?baseBreakpointRuleStyles[\s\S]*?cssRuleStyles[\s\S]*?parseStyleDeclarations/,
    'copy styles must include inherited breakpoint declarations plus the active rule and inline declarations',
  );
  assert.match(
    projectEditorSource,
    /const copyStylesForPath = \(path: string\)[\s\S]*?classEditingSelector\([\s\S]*?readCssAuthoringDeclarations\(/,
    'copy styles from the Layers tree must resolve the complete combo-class authoring cascade',
  );
  assert.match(
    projectEditorSource,
    /prepareIndependentElementPaste\(latestSource, copiedMarkup, stylesheets\)[\s\S]*?preparedPaste\.changedStylesheetPaths[\s\S]*?commitProject\(nextProject, false, false\)/,
    'element paste must commit its HTML and cloned CSS aliases into one undoable history head',
  );

  console.log('HTML semantic source patcher regression tests passed');
} finally {
  await server.close();
}
