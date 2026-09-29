import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'parse5';
import { createServer } from 'vite';

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixturePath = path.join(root, 'tests/fixtures/localization-visual-contract.json');
const phpRunnerPath = path.join(root, 'Wordpress/tests/localization-contract-runner.php');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

function attribute(node, name) {
  return node?.attrs?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function textContent(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

function walkElements(node, visit) {
  if (node?.tagName) visit(node);
  (node?.childNodes || []).forEach((child) => walkElements(child, visit));
}

function findElement(document, predicate) {
  let result = null;
  walkElements(document, (element) => {
    if (!result && predicate(element)) result = element;
  });
  return result;
}

function elementByLocalizationId(document, id) {
  return findElement(document, (element) => attribute(element, 'data-kodety-l10n-id') === id);
}

function normalizedText(node) {
  return textContent(node).replace(/\s+/g, ' ').trim();
}

function normalizedStyles(value) {
  const styles = {};
  String(value || '').split(';').forEach((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 1) return;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const rawValue = declaration.slice(separator + 1).trim().replace(/\s*!\s*important\s*$/i, ' !important');
    if (property && rawValue) styles[property] = rawValue;
  });
  return Object.fromEntries(Object.entries(styles).sort(([left], [right]) => left.localeCompare(right)));
}

function semanticSnapshot(source) {
  const document = parse(source);
  const title = findElement(document, (element) => element.tagName === 'title');
  const description = findElement(
    document,
    (element) => element.tagName === 'meta'
      && attribute(element, 'name')?.toLowerCase() === 'description',
  );
  const hero = elementByLocalizationId(document, 'hero');
  const heading = elementByLocalizationId(document, 'heading');
  const pictureSource = elementByLocalizationId(document, 'hero-source');
  const image = elementByLocalizationId(document, 'hero-image');
  assert.ok(hero && heading && pictureSource && image, 'contract source must retain every stable localization target');

  const localeSections = [];
  const documentIds = [];
  walkElements(document, (element) => {
    const commonId = attribute(element, 'id');
    if (commonId) documentIds.push(commonId);
    const owner = attribute(element, 'data-kodety-locale-insertion');
    if (!owner) return;
    const parentOwner = element.parentNode?.tagName
      ? attribute(element.parentNode, 'data-kodety-locale-insertion')
      : null;
    if (parentOwner === owner) return;
    localeSections.push({
      owner,
      id: attribute(element, 'id'),
      locale: attribute(element, 'data-locale-only'),
      text: normalizedText(element),
    });
  });

  return {
    metadata: {
      title: normalizedText(title),
      description: attribute(description, 'content'),
    },
    heading: normalizedText(heading),
    hero: {
      mode: attribute(hero, 'data-mode'),
      hidden: attribute(hero, 'hidden') !== null,
      ariaHidden: attribute(hero, 'aria-hidden'),
      // `data-kodety-locale-hidden` is preview bookkeeping and is deliberately
      // not part of the public semantic contract. Visibility itself must
      // agree through hidden/aria-hidden and the authoritative display style.
      styles: normalizedStyles(attribute(hero, 'style')),
    },
    media: {
      sourceSrcset: attribute(pictureSource, 'srcset'),
      sourceSizes: attribute(pictureSource, 'sizes'),
      imageSrc: attribute(image, 'src'),
      imageSrcset: attribute(image, 'srcset'),
      imageSizes: attribute(image, 'sizes'),
      imageAlt: attribute(image, 'alt'),
    },
    localeSections,
    documentIds,
  };
}

function stylesheetSnapshot(source) {
  const document = parse(source);
  const stylesheets = [];
  walkElements(document, (element) => {
    if (element.tagName !== 'link') return;
    const relations = String(attribute(element, 'rel') || '').toLowerCase().split(/\s+/);
    if (!relations.includes('stylesheet')) return;
    stylesheets.push({
      href: attribute(element, 'href'),
      localized: attribute(element, 'data-kodety-localized-style'),
    });
  });
  return stylesheets;
}

const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  const localization = await server.ssrLoadModule('/lib/html-editor/localization.ts');
  const agentLocalization = await server.ssrLoadModule('/lib/html-editor/agent-localization-tools.ts');
  const { stdout, stderr } = await execFileAsync(
    'php',
    [phpRunnerPath, fixturePath],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.equal(stderr, '', `PHP localization contract runner wrote to stderr: ${stderr}`);
  const phpEncodedOutputs = JSON.parse(stdout);

  for (const localeCode of fixture.locales) {
    const expected = fixture.expected[localeCode];
    assert.ok(expected, `fixture must declare expected semantics for ${localeCode}`);
    const tsOutput = localization.applyPageTranslations(
      fixture.source,
      fixture.pagePath,
      localeCode,
      fixture.settings,
    );
    const phpOutput = Buffer.from(phpEncodedOutputs[localeCode], 'base64').toString('utf8');
    const tsSnapshot = semanticSnapshot(tsOutput);
    const phpSnapshot = semanticSnapshot(phpOutput);

    assert.deepEqual(
      tsSnapshot,
      expected,
      `TypeScript preview localization violated the shared ${localeCode} visual contract`,
    );
    assert.deepEqual(
      phpSnapshot,
      expected,
      `WordPress localization violated the shared ${localeCode} visual contract`,
    );
    assert.deepEqual(
      phpSnapshot,
      tsSnapshot,
      `preview and published WordPress output diverged semantically for ${localeCode}`,
    );
    const expectedLocalizedStylesheets = localeCode === 'en-US'
      ? ['styles/localized-en.css']
      : localeCode === 'fr-FR'
        ? ['styles/localized-en.css', 'styles/localized-fr.css']
        : [];
    const tsStylesheets = stylesheetSnapshot(tsOutput);
    const phpStylesheets = stylesheetSnapshot(phpOutput);
    assert.deepEqual(
      tsStylesheets.filter((stylesheet) => stylesheet.localized !== null).map((stylesheet) => stylesheet.href),
      expectedLocalizedStylesheets,
      `TypeScript must load fallback then direct CSS after the authored stylesheet for ${localeCode}`,
    );
    assert.deepEqual(
      phpStylesheets,
      tsStylesheets,
      `WordPress and TypeScript stylesheet materialization must agree for ${localeCode}`,
    );
    assert.equal(tsStylesheets[0]?.href, 'styles/base.css', 'the authored stylesheet must keep first cascade priority');
  }

  for (const contractCase of fixture.additionalCases || []) {
    const tsOutput = localization.applyPageTranslations(
      fixture.source,
      contractCase.pagePath,
      contractCase.locale,
      fixture.settings,
    );
    const phpOutput = Buffer.from(
      phpEncodedOutputs[`case:${contractCase.id}`],
      'base64',
    ).toString('utf8');
    assert.deepEqual(
      semanticSnapshot(tsOutput).metadata,
      contractCase.expectedMetadata,
      `TypeScript metadata fallback violated case ${contractCase.id}`,
    );
    assert.deepEqual(
      semanticSnapshot(phpOutput).metadata,
      contractCase.expectedMetadata,
      `WordPress metadata fallback violated case ${contractCase.id}`,
    );
    if (contractCase.expectedStylesheets) {
      const tsStylesheets = stylesheetSnapshot(tsOutput);
      const phpStylesheets = stylesheetSnapshot(phpOutput);
      assert.deepEqual(
        tsStylesheets.filter((stylesheet) => stylesheet.localized !== null).map((stylesheet) => stylesheet.href),
        contractCase.expectedStylesheets,
        `TypeScript metadata-only rendering must resolve localized CSS for ${contractCase.id}`,
      );
      assert.deepEqual(
        phpStylesheets,
        tsStylesheets,
        `WordPress metadata-only CSS rendering must match TypeScript for ${contractCase.id}`,
      );
    } else {
      assert.equal(
        stylesheetSnapshot(tsOutput).some((stylesheet) => stylesheet.localized !== null),
        false,
        `legacy page ${contractCase.id} must not gain a localized stylesheet link`,
      );
      assert.equal(
        stylesheetSnapshot(phpOutput).some((stylesheet) => stylesheet.localized !== null),
        false,
        `legacy WordPress page ${contractCase.id} must remain stylesheet-compatible`,
      );
    }
  }

  const generatedStylesheetPath = localization.localizedPageStylesheetPath('pages/about.html', 'pt-BR');
  assert.match(
    generatedStylesheetPath,
    /^pages\/kodety-l10n-pt-br-[a-z0-9]+\.css$/,
    'a localized page stylesheet must live beside its HTML with a safe stable identity',
  );
  assert.equal(
    localization.localizedPageStylesheetPath('pages/about.html', 'pt-BR'),
    generatedStylesheetPath,
    'the generated localized stylesheet path must be deterministic',
  );
  assert.equal(
    localization.localizedPageStylesheetPath('../about.html', 'pt-BR'),
    '',
    'unsafe authored page paths must never generate a localized stylesheet path',
  );
  const stylesheetSettings = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
      { ...localization.createLocale('fr-FR'), fallback: 'en-US' },
    ],
  });
  const withEnglishStylesheet = localization.updateLocalePageStylesheet(
    stylesheetSettings,
    'en-US',
    'pages/about.html',
    'pages/about.en.css',
  );
  const withFrenchStylesheet = localization.updateLocalePageStylesheet(
    withEnglishStylesheet,
    'fr-FR',
    'pages/about.html',
    'pages/about.fr.css',
  );
  assert.deepEqual(
    localization.resolveLocalizationStylesheets(withFrenchStylesheet, 'fr-FR', 'pages/about.html'),
    ['pages/about.en.css', 'pages/about.fr.css'],
    'stylesheet fallback resolution must preserve cascade order without flattening direct metadata',
  );
  assert.equal(
    localization.updateLocalePageStylesheet(
      withFrenchStylesheet,
      'fr-FR',
      'pages/about.html',
      '../escape.css',
    ),
    withFrenchStylesheet,
    'unsafe localized stylesheet mutations must be rejected atomically',
  );
  assert.deepEqual(
    localization.resolveLocalizationStylesheets(
      localization.updateLocalePageStylesheet(
        withFrenchStylesheet,
        'fr-FR',
        'pages/about.html',
        null,
      ),
      'fr-FR',
      'pages/about.html',
    ),
    ['pages/about.en.css'],
    'removing a direct stylesheet must resume fallback inheritance',
  );
  assert.equal(
    stylesheetSnapshot(
      localization.applyPageTranslations(
        localization.applyPageTranslations(
          fixture.source,
          fixture.pagePath,
          'fr-FR',
          fixture.settings,
        ),
        fixture.pagePath,
        'fr-FR',
        fixture.settings,
      ),
    ).filter((stylesheet) => stylesheet.localized !== null).length,
    2,
    're-materializing one localized page must never duplicate its CSS overlays',
  );

  const sourceSnapshot = semanticSnapshot(fixture.source);
  assert.deepEqual(
    semanticSnapshot(
      localization.applyPageTranslations(
        fixture.source,
        fixture.pagePath,
        fixture.settings.sourceLocale,
        fixture.settings,
      ),
    ),
    sourceSnapshot,
    'the TypeScript source locale must ignore a corrupt translations[sourceLocale] payload',
  );
  assert.deepEqual(
    semanticSnapshot(
      Buffer.from(phpEncodedOutputs[fixture.settings.sourceLocale], 'base64').toString('utf8'),
    ),
    sourceSnapshot,
    'the WordPress source locale must ignore a corrupt translations[sourceLocale] payload',
  );

  const migratedSiteLanguage = localization.setLocalizationSiteLanguage(
    {
      ...localization.defaultLocalization('pt-BR'),
      locales: [
        localization.createLocale('pt-BR'),
        { ...localization.createLocale('it-IT'), fallback: 'pt-BR' },
        { ...localization.createLocale('es-ES'), fallback: 'pt-BR' },
      ],
      translations: {
        'pt-BR': { pages: { 'index.html': { entries: { stale: 'fonte inválida' } } } },
        'it-IT': { pages: { 'index.html': { entries: { 'id:title:text': 'Italiano' } } } },
        'es-ES': { pages: { 'index.html': { entries: { 'id:title:text': 'Español tratado como tradução' } } } },
      },
    },
    'es',
  );
  assert.equal(
    migratedSiteLanguage.sourceLocale,
    'es-ES',
    'Site Settings language must replace the authored/source locale',
  );
  assert.equal(
    migratedSiteLanguage.defaultLocale,
    'es-ES',
    'a newly selected site language must also become the public default',
  );
  assert.deepEqual(
    migratedSiteLanguage.locales.map((locale) => locale.code),
    ['es-ES', 'it-IT'],
    'the previous implicit source must not survive as a phantom configured locale',
  );
  assert.equal(
    migratedSiteLanguage.locales[1].fallback,
    'es-ES',
    'remaining target locales must fall back to the new source',
  );
  assert.equal(
    migratedSiteLanguage.translations['es-ES'],
    undefined,
    'the new source must not retain its former translation overlay',
  );
  assert.equal(
    migratedSiteLanguage.translations['pt-BR'],
    undefined,
    'stale payloads for the removed source must be discarded',
  );
  assert.deepEqual(
    migratedSiteLanguage.translations['it-IT']?.pages?.['index.html']?.entries,
    { 'id:title:text': 'Italiano' },
    'translations for explicitly configured target locales must survive the source migration',
  );

  const scriptLocale = localization.createLocale('zh-Hant-TW');
  assert.equal(scriptLocale.code, 'zh-Hant-TW', 'BCP 47 script subtags must remain canonical');
  assert.equal(scriptLocale.language, 'zh', 'BCP 47 scripts must not replace the language subtag');
  assert.equal(scriptLocale.region, 'TW', 'BCP 47 scripts must not be mistaken for the region');
  assert.doesNotThrow(
    () => localization.normalizeLocalization({ sourceLocale: 'pt-BR', locales: /** @type {any} */ ({ broken: true }) }),
    'corrupt locale collections must be repaired instead of crashing the workspace',
  );

  const longCopy = 'x'.repeat(260);
  const largeBody = Array.from(
    { length: 800 },
    (_, index) => `<div><span>Item ${index} ${longCopy}</span><img alt="Imagem ${index}"></div>`,
  ).join('');
  const publicHtml = `<!doctype html><html><head><title>Large</title></head><body>${largeBody}</body></html>`;
  const componentHtml = '<!doctype html><html><body><p>Component internal copy</p></body></html>';
  const experimentPath = '.incode/experiments/experiment-test/variant-test/project/index.html';
  const localizationProject = {
    name: 'Localization performance contract',
    mainHtmlPath: 'index.html',
    rootPath: '',
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: publicHtml },
      [experimentPath]: { path: experimentPath, mimeType: 'text/html', text: publicHtml },
      '.incode/components/component-test/variant-test.html': {
        path: '.incode/components/component-test/variant-test.html',
        mimeType: 'text/html',
        text: componentHtml,
      },
    },
  };
  const idStartedAt = performance.now();
  const localizedIdsProject = localization.ensureProjectLocalizationIds(localizationProject);
  const idDuration = performance.now() - idStartedAt;
  assert.ok(
    idDuration < 3000,
    `stable localization IDs must be assigned in one bounded parse (${Math.round(idDuration)}ms)`,
  );
  assert.equal(
    localizedIdsProject.files['.incode/components/component-test/variant-test.html'].text,
    componentHtml,
    'component implementation documents must stay outside localization',
  );
  const publicIds = [...localizedIdsProject.files['index.html'].text.matchAll(/data-kodety-l10n-id="([^"]+)"/g)]
    .map(match => match[1]);
  const experimentIds = [...localizedIdsProject.files[experimentPath].text.matchAll(/data-kodety-l10n-id="([^"]+)"/g)]
    .map(match => match[1]);
  assert.ok(publicIds.length > 1000, 'the performance fixture must exercise a substantial authored tree');
  assert.deepEqual(
    experimentIds,
    publicIds,
    'A/B copies must inherit the public page ID namespace so the same translations resolve',
  );
  assert.equal(
    localization.ensureProjectLocalizationIds(localizedIdsProject),
    localizedIdsProject,
    'assigning stable IDs twice must be referentially idempotent',
  );
  const metadataOnlyProject = {
    ...localizedIdsProject,
    files: {
      ...localizedIdsProject.files,
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: '{"localization":true}',
      },
    },
  };
  const cachedIdStartedAt = performance.now();
  const cachedIdProject = localization.ensureProjectLocalizationIds(metadataOnlyProject);
  const cachedIdDuration = performance.now() - cachedIdStartedAt;
  assert.equal(
    cachedIdProject,
    metadataOnlyProject,
    'metadata-only changes must retain the project identity after HTML files were stamped',
  );
  assert.equal(
    cachedIdProject.files['index.html'],
    localizedIdsProject.files['index.html'],
    'the ID fast path must preserve authored HTML file identity',
  );
  assert.ok(
    cachedIdDuration < 100,
    `metadata-only localization saves must avoid reparsing stamped HTML (${Math.round(cachedIdDuration)}ms)`,
  );

  const divergentVariant = localization.ensureProjectLocalizationIds({
    name: 'Divergent A/B identity contract',
    mainHtmlPath: 'index.html',
    rootPath: '',
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><h1>Hello world</h1><p>Body copy</p></body></html>',
      },
      [experimentPath]: {
        path: experimentPath,
        mimeType: 'text/html',
        text: '<!doctype html><html><body><div data-kodety-l10n-id="legacy-promo">Promo only</div><h1 data-kodety-l10n-id="legacy-heading">Hello world</h1><p data-kodety-l10n-id="legacy-copy">Body copy</p></body></html>',
      },
    },
  });
  const publicHeadingId = divergentVariant.files['index.html'].text
    .match(/<h1[^>]*data-kodety-l10n-id="([^"]+)"/)?.[1];
  const publicCopyId = divergentVariant.files['index.html'].text
    .match(/<p[^>]*data-kodety-l10n-id="([^"]+)"/)?.[1];
  const variantPromoId = divergentVariant.files[experimentPath].text
    .match(/<div[^>]*data-kodety-l10n-id="([^"]+)"/)?.[1];
  const variantHeadingId = divergentVariant.files[experimentPath].text
    .match(/<h1[^>]*data-kodety-l10n-id="([^"]+)"/)?.[1];
  const variantCopyId = divergentVariant.files[experimentPath].text
    .match(/<p[^>]*data-kodety-l10n-id="([^"]+)"/)?.[1];
  assert.equal(variantHeadingId, publicHeadingId, 'a shifted A/B heading must recover its public identity by signature');
  assert.equal(variantCopyId, publicCopyId, 'a shifted A/B paragraph must recover its public identity by signature');
  assert.notEqual(variantPromoId, publicHeadingId, 'a variant-only node must never steal the public node at the same path');
  assert.notEqual(variantPromoId, publicCopyId, 'a variant-only node must stay outside the public ID namespace');

  const translationProject = localization.ensureProjectLocalizationIds({
    name: 'A/B translation contract',
    mainHtmlPath: 'index.html',
    rootPath: '',
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><h1>Hello world</h1></body></html>',
      },
      'about.html': {
        path: 'about.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><h2>About world</h2></body></html>',
      },
      [experimentPath]: {
        path: experimentPath,
        mimeType: 'text/html',
        text: '<!doctype html><html><body><h1>Hello world</h1></body></html>',
      },
      '.incode/components/component-test/variant-test.html': {
        path: '.incode/components/component-test/variant-test.html',
        mimeType: 'text/html',
        text: componentHtml,
      },
    },
  });
  const entry = localization.extractLocalizableEntries(translationProject.files['index.html'].text)
    .find(candidate => candidate.source === 'Hello world');
  assert.ok(entry, 'the public page must expose its translatable heading');
  const aboutEntry = localization.extractLocalizableEntries(translationProject.files['about.html'].text)
    .find(candidate => candidate.source === 'About world');
  assert.ok(aboutEntry, 'the secondary public page must expose its translatable heading');
  let translationSettings = localization.defaultLocalization('pt-BR');
  translationSettings = localization.normalizeLocalization({
    ...translationSettings,
    locales: [
      ...translationSettings.locales,
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
    ],
  });
  translationSettings = localization.updateTranslation(
    translationSettings,
    'en-US',
    'index.html',
    entry.key,
    'Translated heading',
  );
  translationSettings = localization.updateTranslation(
    translationSettings,
    'en-US',
    'about.html',
    aboutEntry.key,
    'Translated about heading',
  );
  const emptyAgentSettings = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
    ],
  });
  const localeInventory = agentLocalization.snapshotAgentLocalization(
    translationProject,
    emptyAgentSettings,
    '41',
    {},
  );
  assert.equal(localeInventory.revision, '41', 'the Agent locale inventory must expose the exact live revision');
  assert.ok(
    localeInventory.locales.some(candidate => candidate.code === 'en-US' && candidate.source === false),
    'the Agent must discover configured target locales before translating',
  );
  const agentBatch = agentLocalization.snapshotAgentLocalization(
    translationProject,
    emptyAgentSettings,
    '41',
    { localeCode: 'en-US', pagePaths: ['index.html'], onlyMissing: true, limit: 60 },
  );
  const headingTarget = agentBatch.batch.items.find(candidate => candidate.source === 'Hello world');
  assert.ok(headingTarget?.target, 'the semantic Agent catalog must return the public heading as an opaque target');
  const agentApplied = agentLocalization.applyAgentLocalizationChanges(
    translationProject,
    emptyAgentSettings,
    'en-US',
    [{ target: headingTarget.target, value: 'Hello translated in one native batch' }],
  );
  assert.equal(agentApplied.applied, 1, 'the semantic Agent apply must commit a valid target once');
  assert.equal(
    agentLocalization.localizationAgentTargetValue(agentApplied.settings, 'en-US', headingTarget.target),
    'Hello translated in one native batch',
    'the Agent translation must land in localization metadata rather than page HTML',
  );
  const preservedAgentTranslation = agentLocalization.applyAgentLocalizationChanges(
    translationProject,
    agentApplied.settings,
    'en-US',
    [{ target: headingTarget.target, value: 'Should not overwrite reviewed copy' }],
  );
  assert.equal(preservedAgentTranslation.applied, 0, 'bulk translation must preserve existing copy by default');
  assert.equal(preservedAgentTranslation.preserved, 1, 'preserved human translations must be reported');
  assert.throws(
    () => agentLocalization.applyAgentLocalizationChanges(
      translationProject,
      emptyAgentSettings,
      'en-US',
      [{ target: 'entry:index.html:fabricated', value: 'Unsafe' }],
    ),
    /inválido|não existe/i,
    'the native apply boundary must reject fabricated targets atomically',
  );
  const addedAgentLocale = agentLocalization.applyAgentLocalizationSettings(
    agentApplied.settings,
    {
      action: 'add',
      locale: {
        code: 'fr-fr',
        name: 'Français personnalisé',
        slug: 'francais',
        fallback: 'en-us',
      },
    },
  );
  assert.equal(addedAgentLocale.localeCode, 'fr-FR', 'locale settings must canonicalize BCP 47 codes');
  assert.equal(
    addedAgentLocale.settings.locales.find(candidate => candidate.code === 'fr-FR')?.fallback,
    'en-US',
    'adding a locale must validate and retain an enabled configured fallback',
  );
  assert.deepEqual(
    addedAgentLocale.settings.translations,
    agentApplied.settings.translations,
    'adding a locale must preserve every existing translation',
  );
  const updatedAgentLocale = agentLocalization.applyAgentLocalizationSettings(
    addedAgentLocale.settings,
    {
      action: 'update',
      localeCode: 'fr-FR',
      patch: { name: 'Français', region: 'ca', fallback: 'pt-BR', direction: 'ltr' },
    },
  );
  assert.deepEqual(
    updatedAgentLocale.settings.translations,
    addedAgentLocale.settings.translations,
    'updating locale metadata must not touch translation content',
  );
  assert.equal(
    updatedAgentLocale.settings.locales.find(candidate => candidate.code === 'fr-FR')?.region,
    'CA',
    'locale metadata updates must normalize the region atomically',
  );
  assert.throws(
    () => agentLocalization.applyAgentLocalizationSettings(updatedAgentLocale.settings, {
      action: 'update',
      localeCode: 'fr-FR',
      patch: { fallback: 'fr-FR' },
    }),
    /fallback.*outro idioma/i,
    'locale settings must reject a self-referential fallback',
  );
  const updatedAgentPreferences = agentLocalization.applyAgentLocalizationSettings(
    updatedAgentLocale.settings,
    {
      action: 'updatePreferences',
      preferences: {
        automaticLocale: true,
        rememberLocale: false,
        translatePagePaths: true,
        includePathsInAi: true,
      },
    },
  );
  assert.equal(updatedAgentPreferences.settings.automaticLocale, true);
  assert.equal(updatedAgentPreferences.settings.rememberLocale, false);
  assert.deepEqual(
    updatedAgentPreferences.settings.translations,
    updatedAgentLocale.settings.translations,
    'preference updates must preserve translations',
  );
  const defaultAgentLocale = agentLocalization.applyAgentLocalizationSettings(
    updatedAgentPreferences.settings,
    { action: 'setDefault', localeCode: 'fr-fr' },
  );
  assert.equal(defaultAgentLocale.settings.defaultLocale, 'fr-FR');
  assert.equal(
    defaultAgentLocale.settings.locales.find(candidate => candidate.code === 'fr-FR')?.slug,
    '',
    'the semantic settings boundary must use the native default-locale URL contract',
  );
  const settingsWithFrenchTranslation = localization.updateTranslation(
    defaultAgentLocale.settings,
    'fr-FR',
    'index.html',
    entry.key,
    'Bonjour traduit',
  );
  assert.throws(
    () => agentLocalization.applyAgentLocalizationSettings(settingsWithFrenchTranslation, {
      action: 'remove',
      localeCode: 'fr-FR',
      confirmRemoval: false,
    }),
    /confirme explicitamente/i,
    'removing a locale must require explicit confirmation',
  );
  const removedAgentLocale = agentLocalization.applyAgentLocalizationSettings(
    settingsWithFrenchTranslation,
    { action: 'remove', localeCode: 'fr-FR', confirmRemoval: true },
  );
  assert.equal(removedAgentLocale.settings.defaultLocale, 'pt-BR');
  assert.equal(removedAgentLocale.settings.translations['fr-FR'], undefined);
  assert.deepEqual(
    removedAgentLocale.settings.translations['en-US'],
    settingsWithFrenchTranslation.translations['en-US'],
    'confirmed removal must delete only the removed locale translations',
  );
  const translatedAbProject = localization.translatedProject(
    translationProject,
    'en-US',
    translationSettings,
  );
  assert.match(translatedAbProject.files['index.html'].text, /Translated heading/);
  assert.match(
    translatedAbProject.files['about.html'].text,
    /Translated about heading/,
    'the default project materialization must still translate every public page for publication',
  );
  assert.match(
    translatedAbProject.files[experimentPath].text,
    /Translated heading/,
    'the active A/B document must resolve translations through its public page path',
  );
  assert.equal(
    translatedAbProject.files['.incode/components/component-test/variant-test.html'].text,
    componentHtml,
    'localizing a preview must not rewrite component source documents',
  );
  const translatedIndexPreview = localization.translatedProject(
    translationProject,
    'en-US',
    translationSettings,
    [translationProject.mainHtmlPath],
  );
  assert.match(
    translatedIndexPreview.files['index.html'].text,
    /Translated heading/,
    'a filtered preview must materialize its active HTML file',
  );
  assert.strictEqual(
    translatedIndexPreview.files['about.html'],
    translationProject.files['about.html'],
    'a filtered preview must preserve object identity for an unrelated translated page',
  );
  assert.strictEqual(
    translatedIndexPreview.files[experimentPath],
    translationProject.files[experimentPath],
    'filtering by file path must not also materialize an A/B document mapped to the same public page',
  );
  assert.strictEqual(
    translatedIndexPreview.files['.incode/components/component-test/variant-test.html'],
    translationProject.files['.incode/components/component-test/variant-test.html'],
    'a filtered preview must preserve unrelated component file identity',
  );
  const translatedExperimentPreview = localization.translatedProject(
    translationProject,
    'en-US',
    translationSettings,
    [experimentPath],
  );
  assert.match(
    translatedExperimentPreview.files[experimentPath].text,
    /Translated heading/,
    'a filtered A/B file must still resolve translations through its public page mapping',
  );
  assert.strictEqual(
    translatedExperimentPreview.files['index.html'],
    translationProject.files['index.html'],
    'materializing an A/B preview must leave its canonical public file untouched',
  );
  assert.strictEqual(
    localization.translatedProject(translationProject, 'en-US', translationSettings, []),
    translationProject,
    'an empty preview filter must preserve the complete project identity',
  );
  assert.equal(
    localization.localizationProgress(translationProject, translationSettings, 'en-US').total,
    localization.extractLocalizableEntries(translationProject.files['index.html'].text).length
      + localization.extractLocalizableEntries(translationProject.files['about.html'].text).length,
    'progress must count authored public pages once and ignore A/B/component internals',
  );

  const mixedSource = '<!doctype html><html lang="pt-BR"><head></head><body><p data-kodety-l10n-id="mixed">\n  Olá <strong data-kodety-l10n-id="mixed-strong">mundo</strong>!\n  <!-- preserve-inline-marker -->\n</p></body></html>';
  const mixedEntries = localization.extractLocalizableEntries(mixedSource);
  assert.deepEqual(
    mixedEntries.map(({ key, kind, textNodeOrdinal, source }) => ({ key, kind, textNodeOrdinal, source })),
    [
      { key: 'id:mixed:text-node:0', kind: 'text-node', textNodeOrdinal: 0, source: 'Olá' },
      { key: 'id:mixed:text-node:1', kind: 'text-node', textNodeOrdinal: 1, source: '!' },
      { key: 'id:mixed-strong:text', kind: 'text', textNodeOrdinal: undefined, source: 'mundo' },
    ],
    'mixed inline copy must expose each direct text node without collapsing its child markup',
  );
  const mixedSettings = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
      { ...localization.createLocale('fr-FR'), fallback: 'en-US' },
    ],
    translations: {
      'en-US': {
        pages: {
          'mixed.html': {
            entries: {
              'path:0:text-node:0': 'Hello',
              'id:mixed:text-node:1': '.',
              'id:mixed-strong:text': 'world',
            },
          },
        },
      },
      'fr-FR': {
        pages: {
          'mixed.html': {
            entries: { 'id:mixed:text-node:0': ' \u00a0 ' },
          },
        },
      },
    },
  });
  assert.doesNotThrow(
    () => localization.assertLocalizationForPersistence(mixedSettings),
    'text-node entry keys must be accepted by the persistence contract',
  );
  for (const localeCode of ['en-US', 'fr-FR']) {
    const mixedLocalized = localization.applyPageTranslations(
      mixedSource,
      'mixed.html',
      localeCode,
      mixedSettings,
    );
    const mixedDocument = parse(mixedLocalized);
    const mixedParagraph = elementByLocalizationId(mixedDocument, 'mixed');
    const directTextNodes = (mixedParagraph?.childNodes || [])
      .filter((node) => node.nodeName === '#text' && String(node.value || '').trim())
      .map((node) => node.value);
    assert.deepEqual(
      directTextNodes,
      ['\n  Hello ', '.\n  '],
      `${localeCode} must translate direct nodes while preserving authored surrounding whitespace`,
    );
    assert.equal(
      normalizedText(elementByLocalizationId(mixedDocument, 'mixed-strong')),
      'world',
      `${localeCode} must translate the inline child independently`,
    );
    assert.ok(
      (mixedParagraph?.childNodes || []).some((node) => node.nodeName === '#comment' && node.data === ' preserve-inline-marker '),
      `${localeCode} must preserve inline comments and markup`,
    );
  }

  const safeFragment = localization.canonicalizeLocalizationInsertionHtml(
    '<svg aria-label="safe"><use xlink:href="#safe" onclick="alert(2)"></use></svg>',
  );
  assert.match(safeFragment, /aria-label="safe"/, 'safe fragment attributes must survive canonicalization');
  assert.doesNotMatch(
    safeFragment,
    /xlink:href|javascript:|onclick/i,
    'namespaced and executable insertion attributes must be removed from editor payloads',
  );

  const deeplyNormalized = localization.normalizeLocalization({
    version: 'corrupt',
    sourceLocale: ' PT-br ',
    defaultLocale: 'EN-us',
    automaticLocale: 'true',
    rememberLocale: 0,
    translatePagePaths: 'yes',
    includePathsInAi: 1,
    locales: [
      {
        code: 'PT-br',
        language: 42,
        region: ['BR'],
        name: 99,
        slug: { unsafe: true },
        fallback: 'EN-us',
        enabled: false,
        direction: 'rtl',
        autoTranslate: 'true',
        aiModel: 7,
        aiStyle: {},
      },
      {
        code: 'EN-us',
        language: false,
        region: 'us',
        name: '  Custom English  ',
        slug: ' Fancy / English ',
        fallback: 'PT-br',
        enabled: 'false',
        direction: 'sideways',
        autoTranslate: 'true',
        aiModel: 7,
        aiStyle: {},
      },
      { code: 'en-US', name: 'Duplicate must be discarded' },
      {
        code: 'FR-fr',
        language: 'fr',
        name: 'Français',
        slug: 'fr',
        fallback: 'EN-us',
        enabled: false,
        direction: 'ltr',
      },
      { code: 'not_a_locale', enabled: true },
      null,
    ],
    translations: {
      'PT-br': {
        siteTitle: 'Source overlays are invalid',
        pages: { 'index.html': { entries: { 'id:heading:text': 'Fonte inválida' } } },
      },
      'EN-us': {
        siteTitle: 42,
        siteDescription: 'English description',
        pages: {
          'index.html': {
            path: 99,
            title: false,
            description: 'Localized description',
            entries: {
              'id:heading:text': 'Hello',
              'id:heading:attr:title': 123,
              'not-a-safe-entry-key': 'Discard me',
            },
          },
          '../escape.html': { entries: { 'id:heading:text': 'Unsafe page' } },
        },
      },
      'fr-FR': [],
      not_a_locale: { pages: {} },
    },
  });
  assert.equal(deeplyNormalized.version, 3, 'corrupt localization versions must upgrade to v3');
  assert.equal(deeplyNormalized.sourceLocale, 'pt-BR', 'source locale codes must be canonicalized');
  assert.equal(deeplyNormalized.defaultLocale, 'en-US', 'enabled default locale codes must be canonicalized');
  assert.deepEqual(
    deeplyNormalized.locales.map((locale) => locale.code),
    ['pt-BR', 'en-US', 'fr-FR'],
    'invalid and duplicate locale records must be removed deeply',
  );
  assert.equal(deeplyNormalized.locales[0].enabled, true, 'the source locale must remain enabled');
  assert.equal(deeplyNormalized.locales[0].name, 'Português (Brasil)', 'invalid source names must use locale defaults');
  assert.equal(deeplyNormalized.locales[0].fallback, undefined, 'the source locale cannot retain a fallback');
  assert.equal(deeplyNormalized.locales[1].enabled, true, 'string flags must not disable a locale');
  assert.equal(deeplyNormalized.locales[1].name, 'Custom English', 'valid locale names must be trimmed');
  assert.equal(deeplyNormalized.locales[1].region, 'US', 'locale regions must be normalized');
  assert.equal(deeplyNormalized.locales[1].direction, 'ltr', 'invalid directions must use the locale default');
  assert.equal(deeplyNormalized.locales[1].autoTranslate, false, 'string auto-translation flags must not be trusted');
  assert.equal(deeplyNormalized.locales[1].aiModel, undefined, 'non-string AI model metadata must be removed');
  assert.equal(deeplyNormalized.locales[1].slug, '', 'the canonical default locale must own the empty slug');
  assert.equal(deeplyNormalized.locales[2].enabled, false, 'literal false must keep a target locale disabled');
  assert.equal(deeplyNormalized.automaticLocale, true, 'legacy/corrupt metadata must migrate to the default-on automatic locale');
  assert.equal(
    localization.normalizeLocalization({
      ...localization.defaultLocalization('pt-BR'),
      automaticLocale: false,
    }).automaticLocale,
    false,
    'an explicit v3 opt-out must keep automatic locale disabled',
  );
  assert.equal(deeplyNormalized.rememberLocale, true, 'corrupt remember-locale flags must use the safe default');
  assert.equal(deeplyNormalized.translatePagePaths, false, 'localized paths must require a literal boolean true');
  assert.equal(deeplyNormalized.includePathsInAi, false, 'AI path inclusion must require a literal boolean true');
  assert.deepEqual(
    Object.keys(deeplyNormalized.translations),
    ['en-US'],
    'translation owners must be canonical, configured targets only',
  );
  assert.equal(
    deeplyNormalized.translations['en-US'].siteTitle,
    undefined,
    'non-string localized site titles must be discarded',
  );
  assert.equal(
    deeplyNormalized.translations['en-US'].siteDescription,
    'English description',
    'valid localized site metadata must survive deep normalization',
  );
  assert.deepEqual(
    deeplyNormalized.translations['en-US'].pages['index.html'],
    {
      description: 'Localized description',
      entries: { 'id:heading:text': 'Hello' },
    },
    'page metadata and entries must be sanitized recursively without retaining invalid scalar types',
  );

  const mergedCanonicalTranslations = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
    ],
    translations: {
      'en-US': {
        siteTitle: 'First title',
        pages: { 'index.html': { entries: { 'id:heading:text': 'First heading' } } },
      },
      'en-us': {
        siteDescription: 'Complementary description',
        pages: {
          'index.html': {
            entries: {
              'id:heading:text': 'Must not overwrite first',
              'id:body:text': 'Complementary body',
            },
          },
        },
      },
    },
  });
  assert.deepEqual(
    mergedCanonicalTranslations.translations['en-US'],
    {
      siteTitle: 'First title',
      siteDescription: 'Complementary description',
      pages: {
        'index.html': {
          entries: {
            'id:heading:text': 'First heading',
            'id:body:text': 'Complementary body',
          },
          overrides: {},
          insertions: [],
        },
      },
    },
    'canonical aliases must merge complementary data without silently overwriting the first authored value',
  );

  const tombstoneSettings = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
      { ...localization.createLocale('es-ES'), fallback: 'en-US' },
    ],
    translations: {
      'en-US': {
        pages: {
          'index.html': {
            entries: {},
            insertions: [{
              id: 'promo',
              anchor: 'body',
              position: 'append',
              html: '<section>Inherited promotion</section>',
            }],
          },
        },
      },
      'es-ES': {
        pages: {
          'index.html': {
            entries: {},
            insertions: [
              {
                id: 'promo',
                anchor: 123,
                position: 'invalid',
                html: null,
                removed: true,
              },
              {
                id: 'locale-only',
                anchor: 'body',
                position: 'append',
                html: '<section>Contenido local</section>',
              },
            ],
          },
        },
      },
    },
  });
  assert.deepEqual(
    tombstoneSettings.translations['es-ES'].pages['index.html'].insertions[0],
    {
      id: 'promo',
      anchor: 'body',
      position: 'append',
      html: '',
      removed: true,
    },
    'normalization must preserve a removed:true insertion tombstone even when obsolete fields are corrupt',
  );
  localization.assertLocalizationForPersistence(tombstoneSettings);
  const resolvedTombstonePage = localization.resolveLocalizationPage(
    tombstoneSettings,
    'es-ES',
    'index.html',
  );
  assert.deepEqual(
    resolvedTombstonePage.insertions.map((insertion) => insertion.id),
    ['locale-only'],
    'a normalized tombstone must suppress the inherited insertion without removing unrelated locale content',
  );
  assert.equal(
    resolvedTombstonePage.insertions[0].html,
    '<section>Contenido local</section>',
    'suppressing an inherited insertion must preserve direct locale-only markup',
  );

  const divergentHeadingEntry = localization
    .extractLocalizableEntries(divergentVariant.files['index.html'].text)
    .find((candidate) => candidate.source === 'Hello world');
  assert.ok(divergentHeadingEntry, 'the divergent public page must expose its heading translation key');
  let divergentSettings = localization.normalizeLocalization({
    ...localization.defaultLocalization('pt-BR'),
    locales: [
      localization.createLocale('pt-BR'),
      { ...localization.createLocale('en-US'), fallback: 'pt-BR' },
    ],
  });
  divergentSettings = localization.updateTranslation(
    divergentSettings,
    'en-US',
    'index.html',
    divergentHeadingEntry.key,
    'Translated divergent heading',
  );
  const divergentTranslatedProject = localization.translatedProject(
    divergentVariant,
    'en-US',
    divergentSettings,
  );
  const divergentTranslatedDocument = parse(divergentTranslatedProject.files[experimentPath].text);
  assert.equal(
    normalizedText(elementByLocalizationId(divergentTranslatedDocument, variantPromoId)),
    'Promo only',
    'a public heading translation must never fall onto a variant-only Promo node',
  );
  assert.equal(
    normalizedText(elementByLocalizationId(divergentTranslatedDocument, variantHeadingId)),
    'Translated divergent heading',
    'a divergent A/B heading must still receive the public-page translation',
  );

  const localizationManagerSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlLocalizationManager.tsx'),
    'utf8',
  );
  const localizationEntrySource = await readFile(
    path.join(root, 'Wordpress/editor/localization-main.tsx'),
    'utf8',
  );
  const localizationWorkspaceSource = await readFile(
    path.join(root, 'Wordpress/editor/WordPressLocalizationWorkspace.tsx'),
    'utf8',
  );
  const htmlProjectEditorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  const localizationExtensionSource = await readFile(
    path.join(root, 'Wordpress/extensions/kodety-localization/extension.php'),
    'utf8',
  );
  const wordpressEntryConfigSource = await readFile(
    path.join(root, 'Wordpress/editor/wordpress-entry-config.ts'),
    'utf8',
  );
  const editorShellSource = await readFile(
    path.join(root, 'Wordpress/kodety/templates/editor-shell.php'),
    'utf8',
  );
  const aiGatewaySource = await readFile(
    path.join(root, 'Wordpress/kodety/includes/class-kodety-ai.php'),
    'utf8',
  );
  const globalCssSource = await readFile(path.join(root, 'app/globals.css'), 'utf8');
  const localeFlagAssetsSource = await readFile(
    path.join(root, 'lib/html-editor/locale-flag-assets.ts'),
    'utf8',
  );
  const localeFlagAssetDirectory = path.join(root, 'lib/html-editor/locale-flags');
  const localeFlagFiles = (await readdir(localeFlagAssetDirectory)).filter((file) => file.endsWith('.svg'));
  assert.match(
    htmlProjectEditorSource,
    /translatedProject\([\s\S]*?previewProject,[\s\S]*?resolvedActiveLocale,[\s\S]*?previewLocalization,[\s\S]*?\[previewProject\.mainHtmlPath\][\s\S]*?\)/,
    'the canvas preview must materialize localization only for its active HTML file',
  );
  assert.equal(localeFlagFiles.length, 28, 'every locale preset must use its committed Figma SVG flag');
  assert.doesNotMatch(
    localizationManagerSource,
    /localeFlagEmoji|Apple_Color_Emoji|Segoe_UI_Emoji|Noto_Color_Emoji/,
    'the Localization UI must not substitute operating-system emoji for the Figma assets',
  );
  assert.match(
    localizationManagerSource,
    /<img[\s\S]*?src=\{assetUrl\}[\s\S]*?className=\{`block shrink-0 object-cover/,
    'flags must render as loose SVG images without a decorative container',
  );
  assert.match(
    localizationManagerSource,
    /<SelectItem[\s\S]*?<LocaleFlag locale=\{locale\}/,
    'locale dropdowns must render the same SVG flags instead of emoji text',
  );
  assert.doesNotMatch(
    localizationManagerSource,
    /border border-white\/10 bg-white\/\[0\.04\].*LocaleFlag/,
    'flags must not regain the bordered tile that is absent from the Figma reference',
  );
  const localeNavigationStart = localizationManagerSource.indexOf('aria-label="Idiomas do projeto"');
  const localeNavigationEnd = localizationManagerSource.indexOf('</nav>', localeNavigationStart);
  const localeNavigationSource = localizationManagerSource.slice(localeNavigationStart, localeNavigationEnd);
  assert.match(
    localeNavigationSource,
    /<LocaleFlag locale=\{locale\} \/>[\s\S]*?\{locale\.name\}[\s\S]*?\{localeProgress\}%/,
    'each locale row must stay to one line: Figma flag, language name and completion percentage',
  );
  assert.doesNotMatch(
    localeNavigationSource,
    /<span[^>]*>\s*\{locale\.code\}|Fonte|rounded-full|style=\{\{ width:/,
    'locale rows must not show a BCP-47 subtitle, source badge or progress strip',
  );
  const translationToolbarStart = localizationManagerSource.indexOf(
    '<div className="grid min-h-[52px] shrink-0',
  );
  const translationToolbarEnd = localizationManagerSource.indexOf(
    '<div className="hidden h-10 shrink-0 grid-cols-2',
    translationToolbarStart,
  );
  const translationToolbarSource = localizationManagerSource.slice(
    translationToolbarStart,
    translationToolbarEnd,
  );
  assert.ok(
    translationToolbarStart >= 0 && translationToolbarEnd > translationToolbarStart,
    'the translation search toolbar must remain discoverable',
  );
  assert.doesNotMatch(
    translationToolbarSource,
    /LocaleFlag locale=\{activeLocale\}|activeLocale\.name|pendentes/,
    'the search toolbar must not repeat the selected locale already shown in navigation and the target column',
  );
  assert.doesNotMatch(
    localizationManagerSource,
    /const missingCount =/,
    'removing the redundant toolbar counter must not leave dead pending-count state',
  );
  assert.match(
    localizationManagerSource,
    /<LocaleFlag locale=\{activeLocale\} \/>[\s\S]*?\{activeLocale\.name\}[\s\S]*?\{activeLocale\.code\}[\s\S]*?\{progress\.translated\}\/\{progress\.total\}/,
    'the destination column must retain the selected locale identity and its compact progress count',
  );
  assert.doesNotMatch(
    localizationManagerSource,
    /aria-label=\{`Cobertura de \$\{activeLocale\.name\}`\}/,
    'the locale sidebar must not repeat progress in a detached card below the compact rows',
  );
  assert.match(
    localizationManagerSource,
    /id: 'kodety-localization-save-error'/,
    'save failures must share one stable toast instead of stacking duplicate errors',
  );
  assert.match(
    localizationManagerSource,
    /AI_TRANSLATION_BATCH_ITEMS = 24;[\s\S]*?AI_TRANSLATION_BATCH_CHARACTERS = 12_000;[\s\S]*?function aiTranslationBatches/,
    'AI translation must use bounded item and character-aware batches instead of one oversized request',
  );
  assert.match(
    localizationManagerSource,
    /async function readAiTranslationResponse[\s\S]*?response\.text\(\)[\s\S]*?JSON\.parse[\s\S]*?text\/html[\s\S]*?<!doctype\\s\+html/,
    'AI translation must reject HTML responses without leaking JSON parser errors into the UI',
  );
  assert.doesNotMatch(
    localizationManagerSource,
    /await response\.json\(\)/,
    'AI translation must inspect the response body before assuming WordPress returned JSON',
  );
  const translateWithAiStart = localizationManagerSource.indexOf('const translateWithAi = async');
  const translateWithAiEnd = localizationManagerSource.indexOf('\n  useEffect(() => {', translateWithAiStart);
  const translateWithAiContract = localizationManagerSource.slice(translateWithAiStart, translateWithAiEnd);
  assert.ok(
    translateWithAiStart >= 0 && translateWithAiEnd > translateWithAiStart,
    'the scoped AI translation workflow must remain discoverable',
  );
  assert.match(
    translateWithAiContract,
    /const translateWithAi = async \(pagePath\?: string\)[\s\S]*?const scopedGroups = pagePath[\s\S]*?allGroups\.filter\(\(group\) => group\.page\.path === pagePath\)/,
    'AI translation must support an isolated page scope as well as the global project scope',
  );
  assert.ok(
    (translateWithAiContract.match(/aiTranslationBatches\(/g) || []).length >= 2,
    'both content entries and page metadata must travel through bounded AI batches',
  );
  assert.match(
    translateWithAiContract,
    /for \(const batch of aiTranslationBatches\([\s\S]*?await persistGenerated\(candidate, batchApplied\)/,
    'each completed AI batch must be persisted before the next batch can start',
  );
  assert.match(
    localizationManagerSource,
    /onClick=\{\(\) => \{[\s\S]*?translateWithAi\(page\.path\);[\s\S]*?aria-label=\{pageIsTranslating[\s\S]*?`Traduzir \$\{pageLabel\(page\.path\)\} com IA`/,
    'every page header must expose its own cancellable AI translation action',
  );
  const localizationHeaderStart = localizationManagerSource.indexOf('<header className="relative flex h-[52px]');
  const localizationHeaderEnd = localizationManagerSource.indexOf('</header>', localizationHeaderStart);
  const localizationHeaderSource = localizationManagerSource.slice(localizationHeaderStart, localizationHeaderEnd);
  assert.ok(
    localizationHeaderStart >= 0 && localizationHeaderEnd > localizationHeaderStart,
    'the compact Localization topbar must remain discoverable',
  );
  assert.doesNotMatch(
    localizationHeaderSource,
    /<LocaleFlag|project\.name|sourceLocale[^\n]*→/,
    'the Localization topbar must not repeat flags, the site name or a source-to-target locale cluster',
  );
  for (const file of localeFlagFiles) {
    const svg = await readFile(path.join(localeFlagAssetDirectory, file), 'utf8');
    assert.match(svg, /<clipPath[^>]*>[\s\S]*?<rect width="60" height="45" rx="6"/, `${file} must preserve Figma's rounded flag clip`);
    assert.doesNotMatch(svg, /<rect width="60" height="45" fill="#1E1E1E"\/>/, `${file} must not include the Figma canvas background`);
  }
  assert.equal(
    (localeFlagAssetsSource.match(/new URL\('\.\/locale-flags\/[a-z]{2}\.svg', import\.meta\.url\)\.href/g) || []).length,
    28,
    'the bundle must reference every committed Figma SVG through stable build-time URLs',
  );
  const settingsDialogRoot = localizationManagerSource.indexOf('open={showSettings}');
  const settingsDialogStart = localizationManagerSource.indexOf('<DialogContent', settingsDialogRoot);
  const settingsDialogEnd = localizationManagerSource.indexOf('</DialogContent>', settingsDialogStart);
  const settingsDialogSource = localizationManagerSource.slice(settingsDialogStart, settingsDialogEnd);
  assert.doesNotMatch(
    localizationEntrySource,
    /import '\.\.\/\.\.\/app\/globals\.css';|import '\.\/wordpress-editor\.css';/,
    'the extension must reuse the shell design-system CSS instead of downloading and parsing it a second time',
  );
  assert.match(
    localizationEntrySource,
    /kodetyImportLocalizationChunk[\s\S]*?import\('\.\/WordPressLocalizationWorkspace'\)[\s\S]*?React\.lazy[\s\S]*?<Suspense/,
    'the private workspace must start in parallel while the lightweight entry can paint its loading state',
  );
  assert.match(
    localizationEntrySource,
    /const separator = source\.includes\('\?'\) \? '&' : '\?';[\s\S]*?file=\$\{encodeURIComponent\(normalized\)\}[\s\S]*?import\(\/\* @vite-ignore \*\/ url\)/,
    'the dynamic chunk loader must preserve the base query bytes and append file last',
  );
  assert.doesNotMatch(
    localizationEntrySource,
    /searchParams\.set\('file'/,
    'URLSearchParams must not re-encode a private module URL into a second ESM identity',
  );
  assert.match(
    localizationExtensionSource,
    /\$kodety_localization_private_asset_url[\s\S]*?foreach \(\['kodety_share_token', 'ver'\][\s\S]*?if \(\$relative !== ''\) \$url = add_query_arg\('file'/,
    'PHP must use one canonical action/share/version/file URL order for private chunks',
  );
  assert.match(
    localizationExtensionSource,
    /\$kodety_localization_rewrite_static_imports[\s\S]*?\$kodety_localization_private_asset_url\([\s\S]*?'kodety_localization_file'[\s\S]*?\$target_relative/,
    'static imports must use the same private URL helper as preload and config',
  );
  assert.match(
    localizationExtensionSource,
    /hash_file\('sha256', \$entry\)[\s\S]*?hash_file\('sha256', __FILE__\)[\s\S]*?substr\(hash\('sha256'/,
    'immutable localization URLs must change for emitted code or delivery-rewrite changes',
  );
  assert.match(
    wordpressEntryConfigSource,
    /aiSettingsPageUrl\?: string;/,
    'the WordPress entry contract must distinguish the Settings page from the AI REST endpoint',
  );
  assert.match(
    editorShellSource,
    /'aiSettingsPageUrl'[\s\S]*?add_query_arg\('section', 'mcp', \$surface_url\('settings'\)\) \. '#integrations-ai'/,
    'the configuration CTA must open the AI provider section in Settings',
  );
  assert.match(
    localizationWorkspaceSource,
    /aiSettingsPageUrl=\{config\?\.aiSettingsPageUrl\}/,
    'the standalone Languages workspace must pass the Settings destination to its manager',
  );
  assert.match(
    htmlProjectEditorSource,
    /<HtmlLocalizationManager[\s\S]*?aiSettingsPageUrl=\{topbarWp\?\.aiSettingsPageUrl\}/,
    'the Builder composition must offer the same AI Settings destination',
  );
  assert.match(
    aiGatewaySource,
    /generation_configuration_error\(\)[\s\S]*?'kodety_ai_configuration_required'[\s\S]*?'status' => 409[\s\S]*?'no_provider_credentials'/,
    'the gateway must expose a stable non-retryable configuration error before provider I/O',
  );
  assert.match(
    localizationManagerSource,
    /payload\.code === 'kodety_ai_configuration_required'[\s\S]*?class AiTranslationConfigurationError/,
    'Languages must classify missing credentials by the stable backend code, not message text',
  );
  assert.match(
    localizationManagerSource,
    /showAiConfigurationRequired[\s\S]*?id: 'kodety-localization-ai-configuration-required'[\s\S]*?label: 'Configurar IA'[\s\S]*?onNavigate\?\.\(aiSettingsPageUrl \|\| ''\)/,
    'missing AI credentials must offer an explicit Settings action when the user can configure them',
  );
  assert.match(
    localizationManagerSource,
    /error instanceof AiTranslationConfigurationError[\s\S]*?showAiConfigurationRequired\(error\.message\)[\s\S]*?else \{[\s\S]*?toast\.error/,
    'ordinary provider and network failures must remain separate from the Settings CTA',
  );
  assert.match(
    localizationEntrySource,
    /export function mountLocalization\(\)[\s\S]*?kodetyMountLocalization = mountLocalization[\s\S]*?kodetyLocalizationManualMount[\s\S]*?mountLocalization\(\)/,
    'the extension must support CSS-gated manual mount while retaining compatibility with older cores',
  );
  assert.match(
    settingsDialogSource,
    /width="min\(560px,\s*calc\(100vw - 1\.5rem\)\)"/,
    'the localization settings shell must fit the authored content width without artificial lateral gutters',
  );
  assert.match(
    settingsDialogSource,
    /data-kodety-localization-dialog="settings"[\s\S]*?max-h-\[calc\(100dvh-1\.5rem\)\]/,
    'the settings dialog must use a viewport ceiling instead of manufacturing a fixed-height scrolling panel',
  );
  assert.doesNotMatch(
    settingsDialogSource,
    /h-\[min\(560px/,
    'the settings dialog must keep its natural content height when the viewport has enough room',
  );
  const addDialogRoot = localizationManagerSource.indexOf('open={addingLocale}');
  const addDialogStart = localizationManagerSource.indexOf('<DialogContent', addDialogRoot);
  const addDialogEnd = localizationManagerSource.indexOf('</DialogContent>', addDialogStart);
  const addDialogSource = localizationManagerSource.slice(addDialogStart, addDialogEnd);
  assert.match(
    addDialogSource,
    /data-kodety-localization-dialog="add"[\s\S]*?data-kodety-localization-add-layout/,
    'the add-language dialog must retain its dedicated selector-and-settings layout contract',
  );
  assert.match(
    globalCssSource,
    /@media \(min-width: 768px\)[\s\S]*?\[data-kodety-localization-add-layout\][\s\S]*?grid-template-columns: 208px minmax\(0, 1fr\)/,
    'the desktop add-language dialog must remain horizontally split between its locale rail and details',
  );
  assert.match(
    globalCssSource,
    /\[data-kodety-localization-surface\]\[data-kodety-localization-dialog\][\s\S]*?background: var\(--kodety-panel\) !important;[\s\S]*?\[data-kodety-localization-dialog-region\][\s\S]*?background: var\(--kodety-panel\) !important;/,
    'localization dialog headers, bodies and footers must share one panel fill',
  );
  assert.match(
    globalCssSource,
    /\[data-kodety-localization-surface\]\[data-kodety-localization-dialog\][\s\S]*?overflow: hidden !important;[\s\S]*?border-radius: 14px !important;[\s\S]*?box-shadow: var\(--kodety-shadow-popover\) !important;/,
    'the dialog shell must never become a second scroll owner or inherit the generic WordPress raised-surface treatment',
  );
  assert.match(
    localizationManagerSource,
    /data-kodety-localization-custom-code[\s\S]*?data-kodety-settings-control-inner/,
    'the custom locale code field must be a composed single-surface control',
  );
  assert.ok(
    (localizationManagerSource.match(/data-kodety-localization-group-header/g) || []).length >= 2,
    'site and page group headers must share the protected sticky-layer contract',
  );
  assert.match(
    globalCssSource,
    /\[data-kodety-localization\] \[data-kodety-localization-group-header\][\s\S]*?z-index: 80;[\s\S]*?isolation: isolate;[\s\S]*?background: var\(--kodety-panel\) !important;/,
    'sticky group names must remain on an opaque layer above scrolling translation text',
  );
  assert.match(
    globalCssSource,
    /\[data-kodety-localization\]\s*\{\s*isolation: isolate;\s*\}/,
    'the localization workspace must contain sticky layers below portalled dialogs',
  );
  assert.match(
    localizationManagerSource,
    /<main[\s\S]{0,400}?data-kodety-localization[\s\S]{0,400}?style=\{\{ isolation: 'isolate' \}\}/,
    'the localization workspace must preserve its dialog layer containment on older extension hosts',
  );
  const commitStart = localizationManagerSource.indexOf('const commitSettings = async');
  const commitEnd = localizationManagerSource.indexOf('\n  const selectLocale', commitStart);
  const commitContract = localizationManagerSource.slice(commitStart, commitEnd);
  assert.ok(commitStart >= 0 && commitEnd > commitStart, 'the async localization commit contract must remain discoverable');
  assert.match(
    commitContract,
    /assertLocalizationForPersistence\(normalizedSettings\)[\s\S]*?await onChange\(normalizedSettings\)/,
    'localization commits must validate before awaiting their persistence callback',
  );
  assert.match(
    commitContract,
    /retryable[\s\S]*?return 'queued';[\s\S]*?return false;[\s\S]*?return 'saved';/,
    'async commits must distinguish queued transient work, terminal failure and acknowledged saves',
  );
  const addLocaleStart = localizationManagerSource.indexOf('const addLocale = async');
  const addLocaleEnd = localizationManagerSource.indexOf('\n  const removeLocale', addLocaleStart);
  const addLocaleContract = localizationManagerSource.slice(addLocaleStart, addLocaleEnd);
  assert.ok(
    addLocaleContract.indexOf('await commitSettings') < addLocaleContract.indexOf('setAddingLocale(false)'),
    'the add-language dialog must await commit before closing or reporting success',
  );
  assert.match(
    addLocaleContract,
    /addingLocalePendingRef\.current[\s\S]*?setAddingLocalePending\(true\)[\s\S]*?finally[\s\S]*?setAddingLocalePending\(false\)/,
    'adding a locale must use an immediate ref guard and a rendered pending state against double submission',
  );
  const translationRowsStart = localizationManagerSource.indexOf('{siteRows.length > 0');
  const translationRowsEnd = localizationManagerSource.indexOf('{!groups.length && !siteRows.length', translationRowsStart);
  const translationRowsContract = localizationManagerSource.slice(translationRowsStart, translationRowsEnd);
  const translationRowDefinitionStart = localizationManagerSource.indexOf('function TranslationRow({');
  const translationRowDefinitionEnd = localizationManagerSource.indexOf('\nexport function HtmlLocalizationManager', translationRowDefinitionStart);
  const translationRowDefinition = localizationManagerSource.slice(
    translationRowDefinitionStart,
    translationRowDefinitionEnd,
  );
  assert.match(
    translationRowDefinition,
    /<textarea[\s\S]*?disabled=\{disabled\}[\s\S]*?<Input[\s\S]*?disabled=\{disabled\}/,
    'TranslationRow must enforce read-only mode on both multiline and single-line native controls',
  );
  assert.match(
    localizationManagerSource,
    /translationFieldClassName = '[^']*border-0 bg-transparent[^']*focus-visible:ring-0/,
    'the inner translation editor must stay transparent so its composed field owns the only surface and stroke',
  );
  assert.match(
    translationRowDefinition,
    /data-kodety-localization-translation-editor[\s\S]*?border-b border-transparent[\s\S]*?focus-within:border-\[var\(--kodety-focus\)\]\/72/,
    'translation editing must remain a transparent full-cell editor with bottom-only violet focus',
  );
  const translationEditorStart = translationRowDefinition.indexOf('data-kodety-localization-translation-editor');
  const translationEditorEnd = translationRowDefinition.indexOf('>', translationEditorStart);
  assert.doesNotMatch(
    translationRowDefinition.slice(translationEditorStart, translationEditorEnd),
    /rounded-|bg-white|border border-/,
    'the translation editor itself must not regress into a filled rounded input card',
  );
  assert.match(
    localizationManagerSource,
    />\s*Novo\s*<\/span>/,
    'missing translations must use the compact status treatment from the reference table',
  );
  assert.equal(
    (translationRowsContract.match(/disabled=\{readOnly\}/g) || []).length,
    3,
    'site, SEO and content translation fields must all become native disabled controls in read-only mode',
  );
  assert.match(
    localizationManagerSource,
    /if \(!readOnly\) return;[\s\S]*?saveRevisionRef\.current \+= 1;[\s\S]*?settingsRef\.current = settings;[\s\S]*?translationAbortRef\.current\?\.abort\(\);/,
    'entering read-only mode must invalidate pending feedback, restore settings and abort AI work',
  );

  console.log('Localization cross-runtime contract passed.');
} finally {
  await server.close();
}
