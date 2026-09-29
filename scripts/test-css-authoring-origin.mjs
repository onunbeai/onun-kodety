import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

try {
  const [origin, css] = await Promise.all([
    server.ssrLoadModule('/lib/html-editor/css-authoring-origin.ts'),
    server.ssrLoadModule('/lib/html-editor/css-patcher.ts'),
  ]);
  const project = {
    name: 'CSS origin fixture',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: [
          '<!doctype html><html><head>',
          '<link rel="stylesheet" href="styles/base.css">',
          '<link rel="stylesheet" href="styles/theme.css">',
          '</head><body><button class="button">Buy</button></body></html>',
        ].join(''),
      },
      'styles/base.css': {
        path: 'styles/base.css',
        mimeType: 'text/css',
        text: [
          '/* @import "../inactive/commented.css"; */',
          '@import "../inactive/print.css" print;',
          '@import "../inactive/screen.css" screen;',
          '@import "../inactive/wide.css" screen and (min-width: 2400px);',
          '@import "../inactive/tablet.css" screen and (max-width: 810px);',
          '@import "../inactive/orientation.css" screen and (orientation: landscape);',
          '@import "../inactive/not-orientation.css" not screen and (orientation: portrait);',
          '@import "../inactive/supported.css" supports(display: grid) screen;',
          '@import "../inactive/unsupported.css" supports(display: imaginary);',
          '@import "../inactive/layered.css" layer(components) screen;',
          '@import "../components/index.css";',
          '.shell { display: block; }',
          '@import "../inactive/late.css";',
        ].join('\n'),
      },
      'components/index.css': {
        path: 'components/index.css',
        mimeType: 'text/css',
        text: '@import url("./button.css");\n:root { --button-gap: 8px; }',
      },
      'components/button.css': {
        path: 'components/button.css',
        mimeType: 'text/css',
        text: '.button { display: inline-flex; opacity: 0.4; gap: var(--button-gap); }',
      },
      'styles/theme.css': {
        path: 'styles/theme.css',
        mimeType: 'text/css',
        text: '@import "../components/button.css";\n.button { color: tomato; }\n.unrelated { opacity: 0.9; }',
      },
      'styles/unlayered-first.css': {
        path: 'styles/unlayered-first.css',
        mimeType: 'text/css',
        text: '.button { opacity: 0.91; }',
      },
      'styles/layered-last.css': {
        path: 'styles/layered-last.css',
        mimeType: 'text/css',
        text: '@layer widgets { .button { opacity: 0.21; } }',
      },
      'styles/layer-order.css': {
        path: 'styles/layer-order.css',
        mimeType: 'text/css',
        text: [
          '@layer theme, reset;',
          '@import "../layers/reset.css" layer(reset);',
          '@import "../layers/theme.css" layer(theme);',
        ].join('\n'),
      },
      'layers/reset.css': {
        path: 'layers/reset.css',
        mimeType: 'text/css',
        text: '.button { opacity: 0.2; z-index: 2 !important; }',
      },
      'layers/theme.css': {
        path: 'layers/theme.css',
        mimeType: 'text/css',
        text: '.button { opacity: 0.8; z-index: 8 !important; }',
      },
      'styles/nested-import-layer.css': {
        path: 'styles/nested-import-layer.css',
        mimeType: 'text/css',
        text: [
          '@layer theme;',
          '@import "../layers/theme-direct.css" layer(theme);',
          '@import "../layers/theme-nested.css" layer(theme);',
        ].join('\n'),
      },
      'layers/theme-direct.css': {
        path: 'layers/theme-direct.css',
        mimeType: 'text/css',
        text: '.button { color: blue; background-color: black !important; }',
      },
      'layers/theme-nested.css': {
        path: 'layers/theme-nested.css',
        mimeType: 'text/css',
        text: '@layer components { .button { color: red; background-color: white !important; } }',
      },
      ...Object.fromEntries([
        ['commented', '.commented { color: red; }'],
        ['print', '.print-only { color: black; }'],
        ['screen', '.screen-only { color: green; }'],
        ['wide', '.wide-only { color: blue; }'],
        ['tablet', '.tablet-only { color: purple; }'],
        ['orientation', '.orientation-only { color: maroon; }'],
        ['not-orientation', '.not-orientation-only { color: navy; }'],
        ['supported', '.supported-only { color: teal; }'],
        ['unsupported', '.unsupported-only { color: orange; }'],
        ['layered', '.layered-only { color: olive; }'],
        ['late', '.late-import { color: pink; }'],
      ].map(([name, text]) => [`inactive/${name}.css`, {
        path: `inactive/${name}.css`,
        mimeType: 'text/css',
        text,
      }])),
    },
  };
  const linked = ['styles/base.css', 'styles/theme.css'];
  const context = {
    target: 'rule',
    selector: '.button',
    // Deliberately stale: the last selected element happened to use theme.css.
    cssFilePath: 'styles/theme.css',
    pseudo: 'base',
    breakpoint: 'base',
  };

  assert.deepEqual(
    origin.cssAuthoringCascade(project, linked).map(entry => [entry.cssFilePath, entry.rootCssFilePath]),
    [
      ['inactive/screen.css', 'styles/base.css'],
      ['inactive/layered.css', 'styles/base.css'],
      ['components/button.css', 'styles/base.css'],
      ['components/index.css', 'styles/base.css'],
      ['styles/base.css', 'styles/base.css'],
      ['components/button.css', 'styles/theme.css'],
      ['styles/theme.css', 'styles/theme.css'],
    ],
    'local @imports must participate before their importing root and retain the linked root identity',
  );

  const qualified = origin.cssAuthoringCascade(project, linked, {
    context,
    supports: condition => condition === 'display: grid',
  });
  assert.ok(qualified.some(entry => entry.cssFilePath === 'inactive/supported.css'));
  assert.ok(qualified.some(entry => entry.cssFilePath === 'inactive/screen.css'));
  assert.ok(qualified.some(entry => (
    entry.cssFilePath === 'inactive/layered.css'
    && entry.layerPath.join('.') === 'components'
  )));
  for (const inactive of [
    'inactive/commented.css',
    'inactive/print.css',
    'inactive/wide.css',
    'inactive/tablet.css',
    'inactive/orientation.css',
    'inactive/not-orientation.css',
    'inactive/unsupported.css',
    'inactive/late.css',
  ]) assert.ok(!qualified.some(entry => entry.cssFilePath === inactive), `${inactive} must stay inactive`);

  const tabletContext = { ...context, breakpoint: 'tablet' };
  const tabletCascade = origin.cssAuthoringCascade(project, linked, {
    context: tabletContext,
    breakpoints: [{ id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 }],
  });
  assert.ok(tabletCascade.some(entry => entry.cssFilePath === 'inactive/tablet.css'));
  assert.ok(!tabletCascade.some(entry => entry.cssFilePath === 'inactive/wide.css'));

  const customPrimaryCascade = origin.cssAuthoringCascade(project, linked, {
    context,
    primaryWidth: 2600,
  });
  assert.ok(
    customPrimaryCascade.some(entry => entry.cssFilePath === 'inactive/wide.css'),
    'base @import qualifiers must use the project Primary width, not the default 1920px canvas',
  );

  const opacityOrigin = origin.resolveCssAuthoringOrigin(project, linked, context, 'opacity');
  assert.equal(opacityOrigin.cssFilePath, 'components/button.css');
  assert.equal(opacityOrigin.rootCssFilePath, 'styles/theme.css');
  assert.equal(opacityOrigin.hasProperty, true);
  assert.deepEqual(opacityOrigin.liveRootCssFilePaths, ['styles/base.css', 'styles/theme.css']);

  const colorOrigin = origin.resolveCssAuthoringOrigin(project, linked, context, 'color');
  assert.equal(colorOrigin.cssFilePath, 'styles/theme.css');
  assert.equal(colorOrigin.rootCssFilePath, 'styles/theme.css');
  assert.equal(colorOrigin.hasProperty, true);
  assert.deepEqual(colorOrigin.liveRootCssFilePaths, ['styles/theme.css']);

  assert.deepEqual(
    origin.readCssAuthoringDeclarations(project, linked, context),
    {
      display: 'inline-flex',
      opacity: '0.4',
      gap: 'var(--button-gap)',
      color: 'tomato',
    },
    'Inspector reads must merge the same linked/imported cascade used by writes',
  );

  // Origin resolution and declaration reads are consecutive projections of
  // the same immutable file graph. The second projection must reuse the
  // expanded @import/layer cascade even when callers recreate equal arrays and
  // context objects. A new files snapshot or viewport remains an exact cache
  // boundary.
  const cascadeCacheProject = {
    ...project,
    openedAt: 2,
    files: { ...project.files },
  };
  const cascadeCacheBreakpoints = [
    { id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 },
  ];
  const nativePostcssParse = postcss.parse;
  let postcssParseCount = 0;
  postcss.parse = (...args) => {
    postcssParseCount += 1;
    return nativePostcssParse(...args);
  };
  try {
    const cachedOrigin = origin.resolveCssAuthoringOrigin(
      cascadeCacheProject,
      [...linked],
      { ...context },
      'opacity',
      cascadeCacheBreakpoints.map(breakpoint => ({ ...breakpoint })),
      1920,
    );
    assert.equal(cachedOrigin.cssFilePath, 'components/button.css');
    const countAfterOriginResolution = postcssParseCount;
    assert.ok(countAfterOriginResolution > 0, 'the initial cascade must parse its local preludes');
    assert.equal(
      origin.readCssAuthoringDeclarations(
        cascadeCacheProject,
        [...linked],
        { ...context },
        cascadeCacheBreakpoints.map(breakpoint => ({ ...breakpoint })),
        1920,
      ).opacity,
      '0.4',
    );
    assert.equal(
      postcssParseCount,
      countAfterOriginResolution,
      'equal files, links, viewport and options must reuse the expanded authoring cascade',
    );
    origin.readCssAuthoringDeclarations(
      cascadeCacheProject,
      [...linked],
      { ...context, selector: '.another-selected-class' },
      cascadeCacheBreakpoints.map(breakpoint => ({ ...breakpoint })),
      1920,
    );
    assert.equal(
      postcssParseCount,
      countAfterOriginResolution,
      'changing only the selected selector must reuse the same import/layer topology',
    );

    const exposedCascade = origin.cssAuthoringCascade(cascadeCacheProject, [...linked], {
      context: { ...context },
      breakpoints: cascadeCacheBreakpoints.map(breakpoint => ({ ...breakpoint })),
      primaryWidth: 1920,
    });
    exposedCascade[0].layerPath.push('__external_mutation__');
    assert.ok(
      origin.cssAuthoringCascade(cascadeCacheProject, [...linked], {
        context: { ...context },
        breakpoints: cascadeCacheBreakpoints.map(breakpoint => ({ ...breakpoint })),
        primaryWidth: 1920,
      }).every(entry => !entry.layerPath.includes('__external_mutation__')),
      'public cascade values must not expose the shared internal cache to mutation',
    );

    origin.readCssAuthoringDeclarations(
      cascadeCacheProject,
      [...linked],
      { ...context },
      cascadeCacheBreakpoints.map(breakpoint => ({ ...breakpoint })),
      2600,
    );
    assert.ok(
      postcssParseCount > countAfterOriginResolution,
      'a different Primary viewport must rebuild the active import cascade',
    );
    const countAfterViewportChange = postcssParseCount;

    const changedFilesProject = {
      ...cascadeCacheProject,
      files: {
        ...cascadeCacheProject.files,
        'styles/theme.css': {
          ...cascadeCacheProject.files['styles/theme.css'],
          text: `${cascadeCacheProject.files['styles/theme.css'].text}\n.cache-contract { opacity: 1; }`,
        },
      },
    };
    origin.resolveCssAuthoringOrigin(
      changedFilesProject,
      [...linked],
      { ...context },
      'opacity',
      cascadeCacheBreakpoints.map(breakpoint => ({ ...breakpoint })),
      1920,
    );
    assert.ok(
      postcssParseCount > countAfterViewportChange,
      'a new project.files snapshot must invalidate the cascade cache',
    );
  } finally {
    postcss.parse = nativePostcssParse;
  }

  const beforeBase = project.files['styles/base.css'].text;
  const beforeTheme = project.files['styles/theme.css'].text;
  const beforeButton = project.files['components/button.css'].text;
  const patchedButton = css.patchCssDeclaration(
    beforeButton,
    { ...context, cssFilePath: opacityOrigin.cssFilePath },
    'opacity',
    '0.73',
    undefined,
    { authoritative: true },
  );
  assert.match(patchedButton, /\.button\s*\{[^}]*opacity:\s*0\.73/);
  assert.equal((patchedButton.match(/\.button\s*\{/g) || []).length, 1);
  assert.equal(project.files['styles/base.css'].text, beforeBase);
  assert.equal(project.files['styles/theme.css'].text, beforeTheme);
  assert.doesNotMatch(project.files['styles/theme.css'].text, /opacity:\s*0\.73/);
  assert.notEqual(patchedButton, beforeButton);

  const priorityProject = {
    ...project,
    files: {
      ...project.files,
      'components/button.css': {
        ...project.files['components/button.css'],
        text: '.button { opacity: 0.4 !important; }',
      },
      'styles/theme.css': {
        ...project.files['styles/theme.css'],
        text: '.button { opacity: 0.8; }',
      },
    },
  };
  assert.equal(
    origin.resolveCssAuthoringOrigin(priorityProject, linked, context, 'opacity').cssFilePath,
    'components/button.css',
    'an earlier important declaration owns the property ahead of a later normal declaration',
  );

  const unlayeredLinked = ['styles/unlayered-first.css', 'styles/layered-last.css'];
  assert.equal(
    origin.resolveCssAuthoringOrigin(project, unlayeredLinked, context, 'opacity').cssFilePath,
    'styles/unlayered-first.css',
    'a normal unlayered declaration must own the edit ahead of a later named-layer declaration',
  );
  assert.equal(
    origin.readCssAuthoringDeclarations(project, unlayeredLinked, context).opacity,
    '0.91',
    'Inspector reads must apply the same unlayered-over-layered precedence as writes',
  );

  const declaredLayerLinked = ['styles/layer-order.css'];
  assert.equal(
    origin.resolveCssAuthoringOrigin(project, declaredLayerLinked, context, 'opacity').cssFilePath,
    'layers/reset.css',
    'a preceding @layer theme, reset statement must make reset win normal declarations even when theme is imported later',
  );
  assert.equal(
    origin.resolveCssAuthoringOrigin(project, declaredLayerLinked, context, 'z-index').cssFilePath,
    'layers/theme.css',
    'important declarations must reverse the global layer order across imported files',
  );
  assert.deepEqual(
    origin.readCssAuthoringDeclarations(project, declaredLayerLinked, context),
    { opacity: '0.2', 'z-index': '8' },
    'cross-file layer ranking must be identical in the Inspector and property-origin resolver',
  );

  const nestedLayerLinked = ['styles/nested-import-layer.css'];
  assert.equal(
    origin.resolveCssAuthoringOrigin(project, nestedLayerLinked, context, 'color').cssFilePath,
    'layers/theme-direct.css',
    'an imported sheet\'s unlayered owner becomes the direct import layer and beats its nested sublayers normally',
  );
  assert.equal(
    origin.resolveCssAuthoringOrigin(project, nestedLayerLinked, context, 'background-color').cssFilePath,
    'layers/theme-nested.css',
    'important precedence must reverse direct-vs-nested order inside an @import layer wrapper',
  );
  assert.deepEqual(
    origin.readCssAuthoringDeclarations(project, nestedLayerLinked, context),
    { color: 'blue', 'background-color': 'white' },
  );

  const responsiveBreakpoints = [
    { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 },
  ];
  const responsiveContext = {
    ...context,
    cssFilePath: 'css/components.css',
    selector: '.hero__copy',
    breakpoint: 'mobile',
  };
  const responsiveProject = {
    name: 'Overlapping responsive cascade fixture',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 3,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<link rel="stylesheet" href="css/components.css"><link rel="stylesheet" href="css/pages.css"><div class="hero__copy"></div>',
      },
      'css/components.css': {
        path: 'css/components.css',
        mimeType: 'text/css',
        text: '@media (max-width: 410px) { .hero__copy { width: calc(100% - 1.5rem); } }',
      },
      'css/pages.css': {
        path: 'css/pages.css',
        mimeType: 'text/css',
        text: '@media (max-width: 767px) { .hero__copy { width: 90vw; } }',
      },
    },
  };
  const responsiveLinked = ['css/components.css', 'css/pages.css'];
  const responsiveOrigin = origin.resolveCssAuthoringOrigin(
    responsiveProject,
    responsiveLinked,
    responsiveContext,
    'width',
    responsiveBreakpoints,
    1920,
  );
  assert.equal(
    responsiveOrigin.cssFilePath,
    'css/pages.css',
    'responsive writes must follow the declaration that really wins at the mobile viewport, even when it belongs to a broader query in a later stylesheet',
  );
  assert.equal(responsiveOrigin.hasRule, false, 'the winning broader rule is not an exact Mobile rule');
  assert.equal(responsiveOrigin.propertyOwner?.value, '90vw');
  const responsiveDeclarations = origin.readCssAuthoringDeclarations(
    responsiveProject,
    responsiveLinked,
    responsiveContext,
    responsiveBreakpoints,
    1920,
  );
  assert.equal(
    responsiveDeclarations.width,
    '90vw',
    'Inspector values must show the declaration that wins at the concrete mobile viewport',
  );
  assert.deepEqual(
    origin.cssAuthoringOwnDeclarations(responsiveDeclarations),
    { width: 'calc(100% - 1.5rem)' },
    'own markers must remain limited to declarations authored in the exact Mobile tier',
  );
  const repairedResponsiveCss = css.patchCssDeclaration(
    responsiveProject.files['css/pages.css'].text,
    { ...responsiveContext, cssFilePath: 'css/pages.css' },
    'width',
    '280px',
    responsiveBreakpoints,
    { authoritative: true },
  );
  assert.equal(
    css.inspectCssRuleAtViewport(
      repairedResponsiveCss,
      { ...responsiveContext, cssFilePath: 'css/pages.css' },
      'width',
      410,
      responsiveBreakpoints,
    ).propertyOwner?.value,
    '280px',
    'the selected mobile value must become the actual winner in the target stylesheet',
  );

  const authoringOriginSource = await readFile(
    path.join(root, 'lib/html-editor/css-authoring-origin.ts'),
    'utf8',
  );
  assert.match(
    authoringOriginSource,
    /readCssAuthoringDeclarations[\s\S]*?inspectCssRuleDeclarationsAtViewport\([\s\S]*?readCssViewportPropertyOwner\(inspection, property, true\)/,
    'Inspector declarations must resolve viewport and exact-tier owners from one parsed rule snapshot',
  );

  const editorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  assert.match(
    editorSource,
    /const stylesheetLinkPath = resolvedCssOrigin\?\.cssFilePath === targetContext\.cssFilePath[\s\S]*?resolvedCssOrigin\.rootCssFilePath[\s\S]*?ensureCssLink\(pageHtml, relativePageHref\(file\.path, stylesheetLinkPath\)\)/,
    'project-wide class propagation must link the importing root, never expose an imported dependency as a duplicate direct stylesheet',
  );
  assert.match(editorSource, /batch\.stylesheets\.set\(message\.cssPath, message\.cssText\)/);
  assert.match(editorSource, /stylesheets: new Map\(\)/);
  assert.match(
    editorSource,
    /const stylesheets = Array\.from\(batch\.stylesheets\)[\s\S]*?projections\.forEach/,
    'a compound Canvas batch must retain every linked root refreshed by a shared imported dependency',
  );

  const shorthandProject = {
    name: 'Shorthand source projection', openedAt: 1, rootPath: '', mainHtmlPath: 'index.html',
    files: {
      'first.css': { path: 'first.css', text: '.card { column-gap:3px; padding-top:3px; --Gap:12px; --gap:24px; }' },
      'second.css': { path: 'second.css', text: '.card { gap:24px!important; padding:20px!important; margin:10px 20px; font:italic 700 20px serif!important; font-size:11px; }' },
    },
  };
  const shorthandContext = { ...context, selector: '.card', cssFilePath: 'first.css' };
  const parseBeforeShorthands = postcss.parse;
  const previousDocument = globalThis.document;
  let shorthandParseCount = 0;
  postcss.parse = (...args) => { shorthandParseCount += 1; return parseBeforeShorthands(...args); };
  delete globalThis.document;
  try {
    const projected = origin.readCssAuthoringDeclarations(shorthandProject, ['first.css', 'second.css'], shorthandContext);
    assert.equal(projected['column-gap'], '24px');
    assert.equal(projected['row-gap'], '24px');
    assert.equal(projected['padding-top'], '20px');
    assert.equal(projected['padding-left'], '20px');
    assert.equal(projected['margin-left'], '20px');
    assert.equal(projected['--Gap'], '12px');
    assert.equal(projected['--gap'], '24px');
    assert.equal(projected['font-size'], undefined, 'SSR must not invent a font expansion or expose a losing size without CSSOM');
    assert.equal(origin.cssAuthoringOwnDeclarations(projected)['column-gap'], undefined);
    assert.equal(shorthandParseCount, 4, 'all expanded properties share one cascade-prelude parse and one rule inspection per source file');
    origin.readCssAuthoringDeclarations(shorthandProject, ['first.css', 'second.css'], shorthandContext);
    assert.equal(shorthandParseCount, 4, 'a repeated projection must reuse immutable parsed sources');
    const variableProject = { ...shorthandProject, files: { ...shorthandProject.files, 'second.css': { path: 'second.css', text: '.card { gap:var(--Gap, 8px 16px)!important; column-gap:3px; }' } } };
    const variableProjection = origin.readCssAuthoringDeclarations(variableProject, ['second.css'], shorthandContext);
    assert.equal(variableProjection.gap, 'var(--Gap, 8px 16px)');
    assert.equal(variableProjection['column-gap'], undefined, 'a variable with a multi-value fallback must use computed fallback instead of the losing literal');
  } finally {
    postcss.parse = parseBeforeShorthands;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  console.log('CSS authoring origin regression tests passed');
} finally {
  await server.close();
}
