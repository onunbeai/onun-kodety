import assert from 'node:assert/strict';
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
  server: { middlewareMode: true },
});

function fixtureProject() {
  return {
    name: 'Experiment fixture',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><button data-kodety-tracking-id="hero-cta">Start</button><script src="script.js"></script></body></html>',
      },
      'about/index.html': {
        path: 'about/index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body>About</body></html>',
      },
      'styles.css': {
        path: 'styles.css',
        mimeType: 'text/css',
        text: 'body { color: black; background: url("/assets/hero.png"); }',
      },
      'script.js': {
        path: 'script.js',
        mimeType: 'text/javascript',
        text: 'window.fixture = true;',
      },
      'assets/hero.png': {
        path: 'assets/hero.png',
        mimeType: 'image/png',
        data: new Uint8Array([1, 2, 3, 4, 5]),
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          projectId: 'fixture-project',
          name: 'Experiment fixture',
          mainHtmlPath: 'index.html',
          homeHtmlPath: 'index.html',
          rootPath: '',
          analytics: { privacyMode: 'strict' },
        }),
      },
      '.incode/unrelated.json': {
        path: '.incode/unrelated.json',
        mimeType: 'application/json',
        text: '{}',
      },
    },
  };
}

try {
  const experiments = await server.ssrLoadModule('/lib/html-editor/experiments.ts');
  const projectIo = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const preview = await server.ssrLoadModule('/lib/html-editor/preview.ts');
  const codedProject = await server.ssrLoadModule('/lib/html-editor/coded-project.ts');
  const customCode = await server.ssrLoadModule('/lib/html-editor/custom-code.ts');
  const interactions = await server.ssrLoadModule('/lib/html-editor/interactions.ts');
  const seo = await server.ssrLoadModule('/lib/html-editor/seo-settings.ts');

  const managedVariantPath = '.incode/experiments/favicon-test/variant-a/project/index.html';
  const oldManagedFavicons = [
    '<link rel="icon" href="https://example.test/old-light.png" media="(prefers-color-scheme: light)" data-kodety-favicon="light">',
    '<link rel="icon" href="https://example.test/old-dark.png" media="(prefers-color-scheme: dark)" data-kodety-favicon="dark">',
    '<link rel="shortcut icon" href="https://example.test/old-light.png" data-kodety-favicon="fallback">',
  ].join('\n  ');
  const managedVariantHtml = '<!doctype html><html><head>'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<link rel="icon" href="manual-variant.ico">'
    + oldManagedFavicons
    + '</head><body data-favicon-canary="preserved">Variant body</body></html>';
  const managedVariantProject = {
    name: 'Managed favicon transport',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>Control</body></html>',
      },
      [managedVariantPath]: {
        path: managedVariantPath,
        mimeType: 'text/html',
        text: managedVariantHtml,
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          projectId: 'managed-favicon-transport',
          mainHtmlPath: 'index.html',
          homeHtmlPath: 'index.html',
          rootPath: '',
          siteSettings: {
            faviconLight: 'https://example.test/new-light.png',
            faviconDark: 'https://example.test/new-dark.png',
          },
        }),
      },
    },
  };
  assert.equal(projectIo.projectNeedsManagedVariantFaviconSync(managedVariantProject), true);
  const managedVariantTransport = projectIo.prepareProjectForTransport(managedVariantProject);
  const synchronizedVariantHtml = managedVariantTransport.files[managedVariantPath].text;
  assert.doesNotMatch(synchronizedVariantHtml, /old-(?:light|dark)\.png/);
  assert.match(synchronizedVariantHtml, /href="https:\/\/example\.test\/new-light\.png"/);
  assert.match(synchronizedVariantHtml, /href="https:\/\/example\.test\/new-dark\.png"/);
  assert.equal((synchronizedVariantHtml.match(/data-kodety-favicon=/g) || []).length, 3);
  assert.match(synchronizedVariantHtml, /href="manual-variant\.ico"/);
  assert.match(synchronizedVariantHtml, /data-favicon-canary="preserved"/);
  assert.equal(managedVariantProject.files[managedVariantPath].text, managedVariantHtml);
  assert.equal(projectIo.projectNeedsManagedVariantFaviconSync(managedVariantTransport), false);
  assert.equal(
    seo.synchronizeManagedVariantFaviconHtml(synchronizedVariantHtml, {
      faviconLight: 'https://example.test/new-light.png',
      faviconDark: 'https://example.test/new-dark.png',
    }),
    synchronizedVariantHtml,
    'managed favicon synchronization must be byte-idempotent',
  );
  const uppercaseManagedVariantHtml = managedVariantHtml
    .replaceAll('<link ', '<LINK ')
    .replaceAll('data-kodety-favicon', 'DATA-KODETY-FAVICON');
  assert.match(
    seo.synchronizeManagedVariantFaviconHtml(uppercaseManagedVariantHtml, {
      faviconLight: 'https://example.test/new-light.png',
      faviconDark: 'https://example.test/new-dark.png',
    }),
    /new-light\.png/,
    'HTML tag and attribute names must remain ASCII case-insensitive',
  );
  const clearedVariantHtml = seo.synchronizeManagedVariantFaviconHtml(managedVariantHtml, {});
  assert.doesNotMatch(clearedVariantHtml, /data-kodety-favicon/);
  assert.match(clearedVariantHtml, /href="manual-variant\.ico"/);
  assert.equal(
    seo.synchronizeManagedVariantFaviconHtml(
      managedVariantHtml.replaceAll(' data-kodety-favicon="light"', '').replaceAll(' data-kodety-favicon="dark"', '').replaceAll(' data-kodety-favicon="fallback"', ''),
      { faviconLight: 'https://example.test/new-light.png' },
    ),
    managedVariantHtml.replaceAll(' data-kodety-favicon="light"', '').replaceAll(' data-kodety-favicon="dark"', '').replaceAll(' data-kodety-favicon="fallback"', ''),
    'unmarked variant icons are explicit snapshot content and must not inherit global state',
  );
  assert.equal(
    seo.synchronizeManagedVariantFaviconHtml(managedVariantHtml, { faviconLight: './assets/new-local.png' }),
    managedVariantHtml,
    'a variant must not inherit a relative asset that its snapshot may not contain',
  );
  const faviconOverlayPackage = await projectIo.projectToMaterializedPublishOverlayPackage(
    managedVariantProject,
    { fast: true },
  );
  const faviconOverlayZip = await JSZip.loadAsync(await faviconOverlayPackage.zip.arrayBuffer());
  const faviconOverlayManifest = JSON.parse(
    await faviconOverlayZip.file('.incode/publish-overlay.json').async('string'),
  );
  assert.ok(faviconOverlayManifest.upserts.some(entry => entry.path === managedVariantPath));
  assert.equal(faviconOverlayZip.file('.incode/project.json'), null);
  assert.equal(await faviconOverlayZip.file(managedVariantPath).async('string'), synchronizedVariantHtml);
  const managedVariantMembershipMetadata = JSON.parse(
    managedVariantProject.files['.incode/project.json'].text,
  );
  managedVariantMembershipMetadata.membership = {
    version: 1,
    enabled: true,
    gates: {},
    pages: {
      'index.html': {
        requirement: { type: 'authenticated' },
        anonymous: { type: 'branch', branch: 'guest' },
        denied: { type: 'branch', branch: 'upgrade' },
      },
    },
  };
  const managedVariantMembershipProject = {
    ...managedVariantProject,
    files: {
      ...managedVariantProject.files,
      '.incode/project.json': {
        ...managedVariantProject.files['.incode/project.json'],
        text: JSON.stringify(managedVariantMembershipMetadata),
      },
    },
  };
  const managedVariantMembershipTransport = projectIo.prepareProjectForTransport(
    managedVariantMembershipProject,
  );
  const managedVariantMembershipRuntime = JSON.parse(
    managedVariantMembershipTransport.files['.incode/membership/runtime.json'].text,
  );
  const managedVariantRuntimePage = managedVariantMembershipRuntime.pages[
    '.kodety-experiments/favicon-test/variant-a/index.html'
  ];
  assert.match(managedVariantRuntimePage.protectedHtml, /new-light\.png/);
  assert.doesNotMatch(managedVariantRuntimePage.protectedHtml, /old-light\.png/);
  assert.match(managedVariantRuntimePage.editorHtml, /old-light\.png/);
  assert.doesNotMatch(managedVariantRuntimePage.editorHtml, /new-light\.png/);
  const repeatedManagedVariantMembershipTransport = projectIo.prepareProjectForTransport(
    managedVariantMembershipTransport,
  );
  const repeatedManagedVariantMembershipRuntime = JSON.parse(
    repeatedManagedVariantMembershipTransport.files['.incode/membership/runtime.json'].text,
  );
  const repeatedManagedVariantRuntimePage = repeatedManagedVariantMembershipRuntime.pages[
    '.kodety-experiments/favicon-test/variant-a/index.html'
  ];
  assert.match(repeatedManagedVariantRuntimePage.protectedHtml, /new-light\.png/);
  assert.doesNotMatch(repeatedManagedVariantRuntimePage.protectedHtml, /old-light\.png/);
  assert.equal(
    repeatedManagedVariantMembershipTransport.files['.incode/membership/runtime.json'].text,
    managedVariantMembershipTransport.files['.incode/membership/runtime.json'].text,
    'managed variant favicon + Membership transport must be byte-idempotent',
  );

  const fixture = fixtureProject();
  const homeInteractionPath = interactions.interactionDocumentPath('index.html');
  const aboutInteractionPath = interactions.interactionDocumentPath('about/index.html');
  const homeInteractionText = JSON.stringify({ version: 2, interactions: [] });
  const aboutInteractionText = JSON.stringify({ version: 2, interactions: [], page: 'about' });
  fixture.files[homeInteractionPath] = {
    path: homeInteractionPath,
    mimeType: 'application/json',
    text: homeInteractionText,
  };
  fixture.files[aboutInteractionPath] = {
    path: aboutInteractionPath,
    mimeType: 'application/json',
    text: aboutInteractionText,
  };
  assert.deepEqual(
    experiments.publicPagePaths(fixture),
    ['about/index.html', 'index.html'],
    'only author-facing public HTML files belong in the Pages panel',
  );
  assert.deepEqual(
    experiments.publicProjectFilePaths(fixture),
    ['about/index.html', 'assets/hero.png', 'index.html', 'script.js', 'styles.css'],
    'metadata and private experiment trees must not be treated as public dependencies',
  );
  assert.equal(experiments.isExperimentInternalPath('.incode/experiments/a/b/project/index.html'), true);
  assert.equal(experiments.isExperimentInternalPath('.incode/project.json'), false);
  assert.equal(experiments.isExperimentInternalPath('index.html'), false);

  const guardedBinary = new Uint8Array([9, 8, 7, 6]);
  Object.defineProperties(guardedBinary, {
    slice: {
      value() { throw new Error('binary slice reached A/B hot path'); },
    },
    forEach: {
      value() { throw new Error('binary digest reached A/B hot path'); },
    },
  });
  const guardedProject = fixtureProject();
  guardedProject.files['assets/hero.png'] = {
    ...guardedProject.files['assets/hero.png'],
    data: guardedBinary,
  };
  const guardedControlAsset = experiments.visibleExperimentAssets(guardedProject)[0];
  assert.notEqual(
    guardedControlAsset,
    guardedProject.files['assets/hero.png'],
    'the Control asset panel receives a detached read-only file view',
  );
  assert.equal(
    guardedControlAsset.data,
    guardedBinary,
    'the Control asset projection must preserve binary identity',
  );
  let binaryDigestReads = 0;
  const digestBytes = new Uint8Array([3, 1, 4, 1, 5]);
  const iterateDigestBytes = digestBytes.forEach.bind(digestBytes);
  Object.defineProperty(digestBytes, 'forEach', {
    value(callback, thisArg) {
      binaryDigestReads += 1;
      return iterateDigestBytes(callback, thisArg);
    },
  });
  const digestFile = {
    path: 'assets/digest.bin',
    mimeType: 'application/octet-stream',
    data: digestBytes,
  };
  const firstDigest = experiments.projectFileDigest(digestFile);
  assert.equal(experiments.projectFileDigest(digestFile), firstDigest);
  assert.equal(
    binaryDigestReads,
    1,
    'an unchanged project file must hash its binary bytes only once',
  );
  assert.equal(
    experiments.projectFileDigest({ ...digestFile }),
    firstDigest,
    'an immutable replacement with equal bytes keeps the same digest value',
  );
  assert.equal(
    binaryDigestReads,
    2,
    'replacing the project file object establishes a fresh digest cache entry',
  );
  const guardedExperiment = experiments.createExperiment(guardedProject, {
    id: 'guarded-binary',
    pagePath: 'index.html',
  });
  const guardedVariant = experiments.createExperimentVariant(
    guardedExperiment.project,
    'guarded-binary',
    { id: 'variant' },
  );
  const guardedOpened = experiments.openExperimentVariant(
    guardedVariant.project,
    'guarded-binary',
    'variant',
  );
  assert.equal(
    experiments.visibleExperimentAssets(guardedOpened.project)[0].data,
    guardedBinary,
    'create/open/assets must neither digest nor clone inherited binary bytes',
  );
  assert.equal(
    experiments.materializeExperimentVariantProject(
      guardedOpened.project,
      'guarded-binary',
      'variant',
    ).files['assets/hero.png'].data,
    guardedBinary,
    'integration materialization exposes the inherited buffer without copying it',
  );

  const created = experiments.createExperiment(fixture, {
    id: 'home-test',
    name: 'Home hero',
    pagePath: 'index.html',
    goal: { type: 'click', trackingId: 'hero-cta' },
    now: '2026-07-23T12:00:00.000Z',
  });
  assert.equal(created.experiment.id, 'home-test');
  assert.equal(created.experiment.status, 'draft');
  assert.deepEqual(created.experiment.goal, { type: 'click', trackingId: 'hero-cta' });
  assert.equal(created.experiment.trafficPercent, 100);
  assert.equal(created.experiment.allocationMode, 'manual');
  assert.equal(created.experiment.deliveryMode, 'redirect');
  assert.equal(created.experiment.stickyDays, 180);
  const configuredProject = experiments.updateExperimentOptions(created.project, 'home-test', {
    trafficPercent: 65,
    allocationMode: 'adaptive',
    deliveryMode: 'server',
    stickyDays: 30,
    audience: { device: 'mobile', visitor: 'new', queryParameter: 'utm_campaign', queryValue: 'launch' },
    autoStop: { maxExposures: 5000 },
  });
  const configuredExperiment = experiments.readExperimentSettings(configuredProject).experiments[0];
  assert.equal(configuredExperiment.trafficPercent, 65);
  assert.equal(configuredExperiment.allocationMode, 'adaptive');
  assert.equal(configuredExperiment.deliveryMode, 'server');
  assert.deepEqual(configuredExperiment.audience, {
    device: 'mobile',
    visitor: 'new',
    queryParameter: 'utm_campaign',
    queryValue: 'launch',
    referrerHost: undefined,
  });
  assert.equal(configuredExperiment.autoStop.maxExposures, 5000);
  assert.deepEqual(
    created.experiment.variants.map(variant => ({
      id: variant.id,
      kind: variant.kind,
      pagePath: variant.pagePath,
      weight: variant.weight,
    })),
    [{ id: 'control', kind: 'control', pagePath: 'index.html', weight: 100 }],
    'a new test always starts with its immutable Control identity',
  );
  const createdMetadata = projectIo.readEditorMetadata(created.project);
  assert.equal(createdMetadata.analytics.privacyMode, 'strict');
  assert.equal(createdMetadata.analytics.experimentsVersion, 3);
  assert.equal(createdMetadata.analytics.experiments[0].id, 'home-test');
  assert.equal(createdMetadata.experiments, undefined);
  assert.equal(createdMetadata.abTests, undefined);

  const variantBResult = experiments.createExperimentVariant(created.project, 'home-test', {
    id: 'variant-b',
    name: 'Dark',
    now: '2026-07-23T12:01:00.000Z',
  });
  const variantB = variantBResult.variant;
  const variantBPrefix = experiments.experimentVariantPrefix('home-test', 'variant-b');
  const variantBInteractionPath = interactions.interactionDocumentPath(
    `${variantBPrefix}index.html`,
  );
  const variantBAboutInteractionPath = interactions.interactionDocumentPath(
    `${variantBPrefix}about/index.html`,
  );
  assert.match(
    variantBInteractionPath,
    /^\.incode\/animations\/%2Eincode%2Fexperiments%2F/,
    'private variant interaction companions must encode their leading dot instead of creating a rejected dotfile',
  );
  assert.deepEqual(
    variantBInteractionPath.split('/').filter(segment => segment.startsWith('.')),
    ['.incode'],
    'the trusted metadata root must be the only hidden path segment in a variant interaction companion',
  );
  assert.equal(
    variantB.pagePath,
    `${variantBPrefix}index.html`,
    'every authored variant owns a private pagePath',
  );
  assert.equal(
    variantBResult.project.files[variantBInteractionPath].text,
    homeInteractionText,
    'a new variant must own the interaction document paired with its private HTML',
  );
  assert.equal(
    variantBResult.project.files[variantBAboutInteractionPath].text,
    aboutInteractionText,
    'every cloned HTML page keeps its interaction companion inside the variant snapshot',
  );
  assert.notEqual(
    variantBResult.project.files[variantBInteractionPath],
    fixture.files[homeInteractionPath],
    'interaction companions must be cloned instead of sharing file objects with Control',
  );

  // Variant slug: friendly, nested-segment-capable identifier that never
  // mutates the physical id used for storage/assignment/analytics.
  assert.equal(experiments.safeVariantSlug('Home B!', 'x'), 'home-b');
  assert.equal(experiments.safeVariantSlug('/Case/Hero B/', 'x'), 'case/hero-b', 'nested segments are preserved and cleaned');
  assert.equal(experiments.safeVariantSlug('///', 'fallback'), 'fallback', 'empty slugs fall back');
  assert.equal(experiments.variantSlug({ id: 'variant-b' }), 'variant-b', 'slug defaults to the physical id');
  assert.equal(variantB.slug, 'variant-b', 'a new variant slug defaults to its id');

  const slugged = experiments.setExperimentVariantSlug(variantBResult.project, 'home-test', 'variant-b', 'Case/Hero-B');
  const sluggedVariant = experiments.readExperimentSettings(slugged).experiments[0].variants
    .find(variant => variant.id === 'variant-b');
  assert.equal(sluggedVariant.slug, 'case/hero-b', 'the slug is normalized and persisted');
  assert.equal(sluggedVariant.id, 'variant-b', 'editing the slug must never change the physical id');
  assert.equal(sluggedVariant.pagePath, `${variantBPrefix}index.html`, 'the private storage path is unaffected by the slug');

  const secondVariant = experiments.createExperimentVariant(slugged, 'home-test', {
    name: 'Second',
    slug: 'case/hero-b',
    now: '2026-07-23T12:02:00.000Z',
  });
  assert.equal(
    secondVariant.variant.slug,
    'case/hero-b-2',
    'a colliding slug is made unique within the experiment',
  );
  const otherExperiment = experiments.createExperiment(secondVariant.project, {
    id: 'about-test',
    pagePath: 'about/index.html',
  });
  const globallyUniqueVariant = experiments.createExperimentVariant(
    otherExperiment.project,
    'about-test',
    { slug: 'case/hero-b' },
  );
  assert.equal(
    globallyUniqueVariant.variant.slug,
    'case/hero-b-3',
    'public variant slugs are unique across different experiments',
  );
  assert.deepEqual(
    experiments.readExperimentSettings(variantBResult.project)
      .experiments[0].variants.map(variant => variant.weight),
    [50, 50],
    'new variants default to an equal traffic distribution',
  );
  assert.equal(
    variantBResult.project.files[`${variantBPrefix}styles.css`].text,
    fixture.files['styles.css'].text,
  );
  assert.equal(
    variantBResult.project.files[`${variantBPrefix}assets/hero.png`],
    undefined,
    'a new variant must not duplicate an inherited binary in its private tree',
  );
  assert.deepEqual(
    variantB.inheritedFilePaths,
    ['assets/hero.png'],
    'copy-on-write metadata records the public binary inherited by the variant',
  );
  assert.equal(
    variantB.sourceFileDigests['assets/hero.png'],
    undefined,
    'the synchronous creation hot path must not digest inherited binary bytes',
  );
  assert.equal(
    Object.keys(variantBResult.project.files)
      .some(file => file === `${variantBPrefix}.incode/project.json`),
    false,
    'private copies must never recursively clone project metadata',
  );
  assert.deepEqual(
    experiments.publicPagePaths(variantBResult.project),
    ['about/index.html', 'index.html'],
    'variant HTML stays hidden from ordinary Pages',
  );

  const openedB = experiments.openExperimentVariant(
    variantBResult.project,
    'home-test',
    'variant-b',
  );
  assert.equal(openedB.project.mainHtmlPath, `${variantBPrefix}index.html`);
  assert.equal(openedB.project.rootPath, '');
  assert.equal(openedB.project.previewRootPath, variantBPrefix.replace(/\/$/, ''));
  assert.deepEqual(
    experiments.activeExperimentEditSession(openedB.project),
    openedB.session,
    'an active private page must recover its edit session without React state',
  );
  assert.deepEqual(
    experiments.activeExperimentStorageFilePaths(openedB.project),
    Object.keys(openedB.project.files)
      .filter(file => file.startsWith(variantBPrefix))
      .sort(),
    'bulk panel edits in a variant must be restricted to its private tree',
  );
  assert.deepEqual(
    experiments.activeExperimentStorageFilePaths(variantBResult.project),
    experiments.publicProjectFilePaths(variantBResult.project),
    'bulk panel edits in Control must exclude every private variant tree',
  );
  const controlBeforeIsolatedMutation = Object.fromEntries(
    experiments.publicProjectFilePaths(openedB.project).map(file => [
      file,
      openedB.project.files[file].text
        ?? Array.from(openedB.project.files[file].data || []),
    ]),
  );
  let isolatedMutation = openedB.project;
  experiments.activeExperimentStorageFilePaths(openedB.project)
    .filter(file => /\.css$/i.test(file))
    .forEach(file => {
      isolatedMutation = projectIo.updateTextFile(
        isolatedMutation,
        file,
        `${isolatedMutation.files[file].text}\n/* variant-only */`,
      );
    });
  assert.deepEqual(
    Object.fromEntries(
      experiments.publicProjectFilePaths(isolatedMutation).map(file => [
        file,
        isolatedMutation.files[file].text
          ?? Array.from(isolatedMutation.files[file].data || []),
      ]),
    ),
    controlBeforeIsolatedMutation,
    'an active-tree bulk mutation must leave Control byte-for-byte unchanged',
  );
  assert.equal(
    experiments.experimentStoragePath(openedB.project, 'assets/hero.png'),
    `${variantBPrefix}assets/hero.png`,
  );
  assert.equal(
    experiments.experimentStoragePath(variantBResult.project, 'assets/hero.png'),
    'assets/hero.png',
  );
  assert.deepEqual(
    experiments.visibleExperimentAssets(openedB.project).map(file => file.path),
    ['assets/hero.png'],
    'the asset panel must expose only the selected variant tree with public-looking paths',
  );
  const inheritedVisibleAsset = experiments.visibleExperimentAssets(openedB.project)[0];
  assert.notEqual(
    inheritedVisibleAsset,
    openedB.project.files['assets/hero.png'],
    'the asset panel receives a path-safe view object',
  );
  assert.equal(
    inheritedVisibleAsset.data,
    openedB.project.files['assets/hero.png'].data,
    'the inherited asset view shares bytes instead of copying the buffer',
  );
  assert.equal(
    codedProject.projectPublicFilePath(
      openedB.project,
      `${variantBPrefix}assets/hero.png`,
    ),
    'assets/hero.png',
    'preview resolution falls back from a missing private binary to Control',
  );
  assert.deepEqual(
    experiments.visibleExperimentAssets(variantBResult.project).map(file => file.path),
    ['assets/hero.png'],
    'Control must not leak private variant assets into its asset panel',
  );
  assert.equal(
    preview.resolveProjectPath(
      openedB.project.mainHtmlPath,
      '/styles.css',
      openedB.project.previewRootPath,
    ),
    `${variantBPrefix}styles.css`,
    'root-absolute dependencies must resolve inside the selected private variant',
  );
  const selectedPageCode = {
    version: 1,
    entries: [{
      id: 'home-only',
      name: 'Home only',
      code: 'window.__variantCustomCode = true;',
      placement: 'body-end',
      scope: 'selected',
      pages: ['index.html'],
      run: 'once',
      language: 'javascript',
      enabled: true,
    }],
  };
  assert.match(
    customCode.applyCustomCodeToHtml(
      openedB.project.files[openedB.project.mainHtmlPath].text,
      selectedPageCode,
      openedB.project.mainHtmlPath,
    ),
    /__variantCustomCode/,
    'page-scoped custom code must resolve a private variant path as its public source page',
  );
  const customCodeTransport = customCode.applyCustomCodeToProject(
    openedB.project,
    selectedPageCode,
  );
  assert.match(customCodeTransport.files['index.html'].text, /__variantCustomCode/);
  assert.match(
    customCodeTransport.files[`${variantBPrefix}index.html`].text,
    /__variantCustomCode/,
    'transport must materialize page-scoped custom code in every matching variant copy',
  );
  const openedTransportBlob = await projectIo.projectToZipBlob(
    openedB.project,
    { fast: true },
  );
  const openedTransport = await JSZip.loadAsync(await openedTransportBlob.arrayBuffer());
  const openedTransportMetadata = JSON.parse(
    await openedTransport.file('.incode/project.json').async('string'),
  );
  assert.equal(
    openedTransportMetadata.analytics.experiments[0].id,
    'home-test',
    'a transport ZIP must retain the canonical analytics definition',
  );
  assert.deepEqual(
    openedTransportMetadata.analytics.experiments[0].variants[1].inheritedFilePaths,
    ['assets/hero.png'],
    'transport metadata retains the binary overlay contract for WordPress publish',
  );
  assert.equal(
    openedTransport.file(`${variantBPrefix}assets/hero.png`),
    null,
    'autosave ZIP stores the inherited binary only once',
  );
  assert.equal(
    openedTransportMetadata.rootPath,
    '',
    'the ephemeral private preview root must never replace the published public root',
  );
  const canonicalTransportProject = projectIo.canonicalProjectForTransport(openedB.project);
  assert.equal(
    canonicalTransportProject.mainHtmlPath,
    'index.html',
    'publish compiler passes must start from the public home while a variant is open',
  );
  assert.equal(
    canonicalTransportProject.previewRootPath,
    undefined,
    'the private preview root must not reach compiler passes',
  );
  assert.ok(
    canonicalTransportProject.files[`${variantBPrefix}index.html`],
    'canonicalizing transport must retain the private textual variant snapshot for WordPress',
  );
  const publishPackage = await projectIo.projectToPublishPackage(
    openedB.project,
    { fast: true },
  );
  const publishedTransport = await JSZip.loadAsync(await publishPackage.zip.arrayBuffer());
  const publishedTransportMetadata = JSON.parse(
    await publishedTransport.file('.incode/project.json').async('string'),
  );
  assert.equal(
    publishedTransportMetadata.analytics.experiments[0].id,
    'home-test',
    'the complete publish compiler pipeline must not strip analytics from project.json',
  );
  assert.ok(
    publishedTransport.file(`${variantBPrefix}index.html`),
    'the publish package must carry the isolated variant HTML alongside its analytics definition',
  );
  assert.equal(
    publishedTransport.file(`${variantBPrefix}assets/hero.png`),
    null,
    'publish transport must not re-expand inherited binaries before WordPress staging',
  );
  assert.equal(
    projectIo.prepareProjectForTransport(openedB.project).mainHtmlPath,
    'index.html',
    'every transport compiler pass must receive the canonical public entry point',
  );
  const editedInPlace = projectIo.updateTextFile(
    openedB.project,
    `${variantBPrefix}styles.css`,
    'body { color: white; }',
  );
  assert.equal(editedInPlace.files['styles.css'].text, 'body { color: black; background: url("/assets/hero.png"); }');
  assert.equal(editedInPlace.files[`${variantBPrefix}styles.css`].text, 'body { color: white; }');
  const closedB = experiments.closeExperimentVariant(editedInPlace, openedB.session);
  assert.equal(closedB.mainHtmlPath, 'index.html');
  assert.equal(closedB.rootPath, '');
  assert.equal(closedB.previewRootPath, undefined);
  assert.equal(
    experiments.experimentEditPath(openedB.session, 'assets/new.png'),
    `${variantBPrefix}assets/new.png`,
    'new assets can be explicitly routed to the active private tree',
  );
  assert.equal(
    experiments.experimentPublicEditPath(
      openedB.session,
      `${variantBPrefix}assets/new.png`,
    ),
    'assets/new.png',
  );
  const uploadedBytes = new Uint8Array([7, 7, 7]);
  const withUploadedVariantAsset = experiments.upsertExperimentVariantFile(
    openedB.project,
    openedB.session,
    'assets/uploaded.png',
    {
      path: 'assets/uploaded.png',
      mimeType: 'image/png',
      data: uploadedBytes,
    },
  );
  uploadedBytes[0] = 0;
  assert.deepEqual(
    withUploadedVariantAsset.files[`${variantBPrefix}assets/uploaded.png`].data,
    new Uint8Array([7, 7, 7]),
    'variant uploads must own their binary memory',
  );
  const uploadedVariantAsset = experiments.visibleExperimentAssets(withUploadedVariantAsset)
    .find(file => file.path === 'assets/uploaded.png');
  assert.notEqual(
    uploadedVariantAsset,
    withUploadedVariantAsset.files[`${variantBPrefix}assets/uploaded.png`],
    'a private asset keeps a path-safe projection object',
  );
  assert.equal(
    uploadedVariantAsset.data,
    withUploadedVariantAsset.files[`${variantBPrefix}assets/uploaded.png`].data,
    'a private asset projection must preserve the canonical binary identity',
  );
  const deduplicatedVariantUpload = experiments.createActiveExperimentFile(
    openedB.project,
    'assets/hero.png',
    {
      path: 'ignored.png',
      mimeType: 'image/png',
      data: new Uint8Array([6]),
    },
  );
  assert.equal(deduplicatedVariantUpload.publicPath, 'assets/hero-2.png');
  assert.equal(
    deduplicatedVariantUpload.storagePath,
    `${variantBPrefix}assets/hero-2.png`,
  );
  assert.deepEqual(
    deduplicatedVariantUpload.project.files[`${variantBPrefix}assets/hero-2.png`].data,
    new Uint8Array([6]),
  );
  assert.equal(
    deduplicatedVariantUpload.project.files['assets/hero-2.png'],
    undefined,
    'creating an asset while a variant is open must never write to public assets',
  );
  assert.throws(
    () => experiments.createActiveExperimentFile(
      openedB.project,
      '.incode/project.json',
      { path: 'project.json', mimeType: 'application/json', text: '{}' },
    ),
    /caminho público válido/i,
  );
  assert.equal(
    experiments.activeExperimentEditSession({
      ...openedB.project,
      mainHtmlPath: `${variantBPrefix}missing.html`,
    }),
    null,
    'a forged/missing private page cannot activate variant write routing',
  );

  const materializedB = experiments.materializeExperimentVariantProject(
    closedB,
    'home-test',
    'variant-b',
  );
  assert.deepEqual(
    Object.keys(materializedB.files).sort(),
    ['about/index.html', 'assets/hero.png', 'index.html', 'script.js', 'styles.css'],
  );
  assert.equal(
    materializedB.files['assets/hero.png'].data,
    closedB.files['assets/hero.png'].data,
    'materializing an integration view must not copy inherited binary bytes',
  );
  assert.equal(materializedB.mainHtmlPath, 'index.html');
  const materializedWithAsset = {
    ...materializedB,
    files: {
      ...materializedB.files,
      'assets/new.png': {
        path: 'assets/new.png',
        mimeType: 'image/png',
        data: new Uint8Array([9, 8, 7]),
      },
    },
  };
  const committedB = experiments.commitExperimentVariantProject(
    closedB,
    'home-test',
    'variant-b',
    materializedWithAsset,
    '2026-07-23T12:02:00.000Z',
  );
  assert.deepEqual(
    committedB.files[`${variantBPrefix}assets/new.png`].data,
    new Uint8Array([9, 8, 7]),
  );
  assert.equal(committedB.files['assets/new.png'], undefined);
  assert.equal(
    committedB.files[`${variantBPrefix}assets/hero.png`],
    undefined,
    'committing an unchanged integration view keeps inherited binaries copy-on-write',
  );

  const duplicatedInteractionText = JSON.stringify({
    version: 2,
    interactions: [],
    source: 'variant-b',
  });
  const animatedCommittedB = projectIo.updateTextFile(
    committedB,
    variantBInteractionPath,
    duplicatedInteractionText,
  );
  const variantCResult = experiments.duplicateExperimentVariant(
    animatedCommittedB,
    'home-test',
    'variant-b',
    {
      id: 'variant-c',
      name: 'High contrast',
      now: '2026-07-23T12:03:00.000Z',
    },
  );
  const variantCPrefix = experiments.experimentVariantPrefix('home-test', 'variant-c');
  const variantCInteractionPath = interactions.interactionDocumentPath(
    `${variantCPrefix}index.html`,
  );
  assert.equal(
    variantCResult.project.files[`${variantCPrefix}styles.css`].text,
    animatedCommittedB.files[`${variantBPrefix}styles.css`].text,
    'duplicating a variant must start from that variant, not silently from Control',
  );
  assert.equal(
    variantCResult.project.files[variantCInteractionPath].text,
    duplicatedInteractionText,
    'duplicating a variant must copy the source variant interaction companion',
  );
  assert.equal(
    variantCResult.project.files[`${variantCPrefix}assets/hero.png`],
    undefined,
    'duplicating a copy-on-write variant keeps inherited binaries shared',
  );
  assert.deepEqual(
    variantCResult.variant.inheritedFilePaths,
    ['assets/hero.png'],
  );
  assert.deepEqual(
    experiments.readExperimentSettings(variantCResult.project)
      .experiments[0].variants.map(variant => variant.weight),
    [33.3333, 33.3333, 33.3334],
  );

  const weighted = experiments.setExperimentVariantWeight(
    variantCResult.project,
    'home-test',
    'variant-c',
    70,
    '2026-07-23T12:04:00.000Z',
  );
  assert.deepEqual(
    experiments.readExperimentSettings(weighted)
      .experiments[0].variants.map(variant => variant.weight),
    [15, 15, 70],
    'setting one weight must proportionally consume the remaining traffic',
  );
  const pausedC = experiments.setExperimentVariantStatus(
    weighted,
    'home-test',
    'variant-c',
    'paused',
  );
  assert.deepEqual(
    experiments.readExperimentSettings(pausedC)
      .experiments[0].variants.map(variant => [variant.id, variant.status, variant.weight]),
    [
      ['control', 'active', 50],
      ['variant-b', 'active', 50],
      ['variant-c', 'paused', 0],
    ],
    'paused variants receive no traffic and the remainder is normalized',
  );
  const reactivatedC = experiments.setExperimentVariantStatus(
    pausedC,
    'home-test',
    'variant-c',
    'active',
  );
  assert.deepEqual(
    experiments.readExperimentSettings(reactivatedC)
      .experiments[0].variants.map(variant => variant.weight),
    [49.505, 49.505, 0.99],
    'reactivation receives traffic without erasing the existing relative distribution',
  );
  const equalAgain = experiments.rebalanceExperimentTraffic(reactivatedC, 'home-test');
  assert.deepEqual(
    experiments.readExperimentSettings(equalAgain)
      .experiments[0].variants.map(variant => variant.weight),
    [33.3333, 33.3333, 33.3334],
  );
  const archivedC = experiments.setExperimentVariantStatus(
    equalAgain,
    'home-test',
    'variant-c',
    'archived',
  );
  assert.equal(
    experiments.readExperimentSettings(archivedC)
      .experiments[0].variants.find(variant => variant.id === 'variant-c').weight,
    0,
  );

  const pageGroups = experiments.variantGroupsForPage(archivedC, 'index.html');
  assert.equal(pageGroups.length, 1);
  assert.equal(pageGroups[0].variants.length, 3);
  assert.deepEqual(experiments.variantGroupsForPage(archivedC, 'about/index.html'), []);

  const assignments = experiments.experimentRuntimeAssignments(
    experiments.readExperimentSettings(archivedC),
  );
  assert.deepEqual(
    assignments.map(assignment => ({
      documentKey: assignment.documentKey,
      path: assignment.path,
      enabled: assignment.enabled,
    })),
    [
      { documentKey: 'control', path: 'index.html', enabled: false },
      { documentKey: 'variant-b', path: `${variantBPrefix}index.html`, enabled: false },
      { documentKey: 'variant-c', path: `${variantCPrefix}index.html`, enabled: false },
    ],
    'draft/paused experiments cannot route visitors even when a variant is individually active',
  );

  const active = experiments.setExperimentStatus(
    archivedC,
    'home-test',
    'active',
    '2026-07-23T12:05:00.000Z',
  );
  assert.equal(
    experiments.experimentRuntimeAssignments(
      experiments.readExperimentSettings(active),
    ).filter(assignment => assignment.enabled).length,
    2,
    'only active, non-archived variants are sent to the runtime',
  );
  const activeWithOnlyControl = experiments.setExperimentStatus(
    experiments.createExperiment(fixture, {
      id: 'safe-routing',
      goal: { type: 'pageview', pagePath: 'index.html' },
    }).project,
    'safe-routing',
    'active',
  );
  assert.throws(
    () => experiments.setExperimentVariantStatus(
      activeWithOnlyControl,
      'safe-routing',
      'control',
      'paused',
    ),
    /única variante com tráfego/i,
    'a running test must never be left without a routable fallback',
  );

  assert.deepEqual(
    experiments.trackingIdsFromHtml(
      '<button data-kodety-tracking-id=" hero cta "></button><a data-kodety-tracking-id=\'hero-cta\'></a><i data-kodety-tracking-id=secondary></i>',
    ),
    ['hero-cta', 'secondary'],
    'tracking IDs use the canonical data-kodety-tracking-id contract and deduplicate',
  );

  const selectorGoal = experiments.createExperiment(fixture, {
    id: 'selector-click',
    goal: {
      type: 'click',
      trackingId: '',
      targetType: 'class',
      targetValue: 'hero cta',
    },
  });
  assert.deepEqual(
    selectorGoal.experiment.goal,
    {
      type: 'click',
      trackingId: 'class:hero-cta',
      targetType: 'class',
      targetValue: 'hero-cta',
    },
    'ID/class goals persist a selector type and a canonical event key',
  );
  assert.deepEqual(
    experiments.normalizeExperimentSettings({
      experiments: [{
        id: 'encoded-selector',
        pagePath: 'index.html',
        goal: { type: 'click', trackingId: 'id:checkout-button' },
      }],
    }).experiments[0].goal,
    {
      type: 'click',
      trackingId: 'id:checkout-button',
      targetType: 'id',
      targetValue: 'checkout-button',
    },
    'encoded selector goals recover their type when reading published metadata',
  );

  const emptyGoal = experiments.createExperiment(fixture, {
    id: 'invalid-click',
    goal: { type: 'click', trackingId: '' },
  });
  assert.throws(
    () => experiments.setExperimentStatus(emptyGoal.project, 'invalid-click', 'active'),
    /meta de conversão/i,
    'an experiment with an incomplete goal cannot begin routing traffic',
  );

  const legacy = experiments.normalizeExperimentSettings({
    tests: [{
      clientKey: 'hero test',
      name: 'Hero',
      pageId: '/index.html',
      status: 'running',
      goalType: 'click',
      trackingId: 'hero click',
      documents: [
        { documentKey: 'control', type: 'control', percentage: '25' },
        {
          documentKey: 'dark',
          name: 'Dark',
          path: '/copy.html',
          traffic: 75,
          enabled: false,
        },
      ],
    }],
  });
  assert.equal(legacy.version, 3);
  assert.equal(legacy.experiments[0].id, 'hero-test');
  assert.equal(legacy.experiments[0].pagePath, 'index.html');
  assert.deepEqual(legacy.experiments[0].goal, { type: 'click', trackingId: 'hero-click' });
  assert.deepEqual(
    legacy.experiments[0].variants.map(variant => [variant.id, variant.status, variant.weight]),
    [['control', 'active', 100], ['dark', 'paused', 0]],
    'legacy enabled/traffic documents migrate without routing traffic to a disabled variant',
  );
  const manyVariants = experiments.normalizeExperimentSettings({
    experiments: [{
      id: 'unlimited',
      pagePath: 'index.html',
      variants: [
        { id: 'control', kind: 'control', weight: 1 },
        ...Array.from({ length: 250 }, (_, index) => ({
          id: `v-${index}`,
          weight: 1,
          pagePath: `.incode/experiments/unlimited/v-${index}/project/index.html`,
        })),
      ],
    }],
  });
  assert.equal(
    manyVariants.experiments[0].variants.length,
    251,
    'the domain imposes no arbitrary variant-count limit',
  );
  assert.equal(
    Math.round(
      manyVariants.experiments[0].variants.reduce((sum, variant) => sum + variant.weight, 0)
      * 10_000,
    ) / 10_000,
    100,
  );

  const promotionBase = experiments.createExperimentVariant(
    experiments.createExperiment(fixture, {
      id: 'promotion',
      pagePath: 'index.html',
      goal: { type: 'pageview', pagePath: 'index.html' },
      now: '2026-07-23T13:00:00.000Z',
    }).project,
    'promotion',
    { id: 'winner', now: '2026-07-23T13:01:00.000Z' },
  ).project;
  const winnerPrefix = experiments.experimentVariantPrefix('promotion', 'winner');
  const winnerSession = experiments.openExperimentVariant(
    promotionBase,
    'promotion',
    'winner',
  ).session;
  const binaryOverrideProject = experiments.upsertExperimentVariantFile(
    promotionBase,
    winnerSession,
    'assets/hero.png',
    {
      path: 'assets/hero.png',
      mimeType: 'image/png',
      data: new Uint8Array([5, 4, 3, 2, 1]),
    },
  );
  const binaryPromotion = experiments.promoteExperimentVariant(
    binaryOverrideProject,
    'promotion',
    'winner',
  );
  assert.deepEqual(binaryPromotion.conflicts, []);
  assert.deepEqual(binaryPromotion.promotedPaths, ['assets/hero.png']);
  assert.deepEqual(
    binaryPromotion.project.files['assets/hero.png'].data,
    new Uint8Array([5, 4, 3, 2, 1]),
    'an explicit private binary override wins when the variant is promoted',
  );
  const winnerStyled = projectIo.updateTextFile(
    promotionBase,
    `${winnerPrefix}styles.css`,
    'body { color: rebeccapurple; }',
  );
  const winnerInteractionPath = interactions.interactionDocumentPath(
    `${winnerPrefix}index.html`,
  );
  const winnerInteractionText = JSON.stringify({
    version: 2,
    interactions: [],
    winner: true,
  });
  const winnerEdited = projectIo.updateTextFile(
    winnerStyled,
    winnerInteractionPath,
    winnerInteractionText,
  );
  const concurrentControl = projectIo.updateTextFile(
    winnerEdited,
    'styles.css',
    'body { color: green; }',
  );
  const abortedPromotion = experiments.promoteExperimentVariant(
    concurrentControl,
    'promotion',
    'winner',
  );
  assert.equal(abortedPromotion.project, concurrentControl);
  assert.deepEqual(
    abortedPromotion.conflicts,
    [{ path: 'styles.css', reason: 'control-changed' }],
    'promotion must not overwrite concurrent Control edits silently',
  );
  const forcedPromotion = experiments.promoteExperimentVariant(
    concurrentControl,
    'promotion',
    'winner',
    {
      conflictStrategy: 'variant-wins',
      now: '2026-07-23T13:02:00.000Z',
    },
  );
  assert.equal(forcedPromotion.project.files['styles.css'].text, 'body { color: rebeccapurple; }');
  assert.deepEqual(
    forcedPromotion.promotedPaths,
    ['styles.css', homeInteractionPath],
    'promoting a variant must carry its interaction document to the public HTML',
  );
  assert.equal(
    forcedPromotion.project.files[homeInteractionPath].text,
    winnerInteractionText,
  );
  const promotedExperiment = experiments.readExperimentSettings(forcedPromotion.project).experiments[0];
  assert.equal(promotedExperiment.winnerVariantId, 'winner');
  assert.equal(promotedExperiment.status, 'paused');
  assert.equal(
    forcedPromotion.project.files['assets/hero.png'],
    concurrentControl.files['assets/hero.png'],
    'unchanged assets must retain Control object identity during promotion',
  );

  const deletedWinner = experiments.deleteExperimentVariant(
    forcedPromotion.project,
    'promotion',
    'winner',
  );
  assert.equal(
    Object.keys(deletedWinner.files).some(path => path.startsWith(winnerPrefix)),
    false,
    'deleting a variant atomically removes its private dependency tree',
  );
  assert.equal(
    deletedWinner.files[winnerInteractionPath],
    undefined,
    'deleting a variant must remove interaction companions stored outside its file prefix',
  );
  assert.equal(
    deletedWinner.files[homeInteractionPath].text,
    winnerInteractionText,
    'deleting the promoted private variant must retain the public interaction document',
  );
  assert.equal(
    experiments.readExperimentSettings(deletedWinner).experiments[0].winnerVariantId,
    undefined,
  );
  assert.throws(
    () => experiments.deleteExperimentVariant(deletedWinner, 'promotion', 'control'),
    /Control não pode ser removida/,
  );
  const deletedExperiment = experiments.deleteExperiment(deletedWinner, 'promotion');
  assert.deepEqual(experiments.readExperimentSettings(deletedExperiment).experiments, []);

  console.log('Experiment domain tests passed.');
} finally {
  await server.close();
}
