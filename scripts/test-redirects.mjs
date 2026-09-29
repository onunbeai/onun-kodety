import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const entry = (overrides = {}) => ({
  id: 'redirect',
  source: '/old',
  destination: '/new',
  match: 'exact',
  status: 301,
  preserveQuery: true,
  enabled: true,
  ...overrides,
});

const settings = (...entries) => ({ version: 1, entries });

try {
  const redirects = await server.ssrLoadModule('/lib/html-editor/redirects.ts');

  const normalized = redirects.normalizeRedirectSettings({
    version: 99,
    redirects: [
      {
        id: ' Campaign 🚀 ',
        from: 'https://source.test/pages/./old/../about/?draft=1#hero',
        to: 'new/path?fixed=1#section',
        type: 'starts-with',
        statusCode: '308',
        preserveQuery: 'false',
        enabled: 'false',
      },
      {
        id: 'Campaign',
        sourcePath: '\\docs\\*\\article\\*\\',
        target: 'https://example.test/library/*/post/*?from=redirect',
        type: 'glob',
        code: 307,
      },
      {
        id: '',
        path: '/fallback/',
        targetPath: '/target/',
        status: 999,
      },
    ],
  });
  assert.equal(normalized.version, 1);
  assert.deepEqual(normalized.entries[0], {
    id: 'Campaign',
    source: '/pages/about',
    destination: '/new/path?fixed=1#section',
    match: 'prefix',
    status: 308,
    preserveQuery: false,
    enabled: false,
  });
  assert.deepEqual(normalized.entries[1], {
    id: 'Campaign-2',
    source: '/docs/*/article/*',
    destination: 'https://example.test/library/*/post/*?from=redirect',
    match: 'wildcard',
    status: 307,
    preserveQuery: true,
    enabled: true,
  });
  assert.equal(normalized.entries[2].id, 'redirect-3');
  assert.equal(normalized.entries[2].status, 301);
  assert.deepEqual(
    redirects.normalizeRedirectSettings(normalized),
    normalized,
    'redirect normalization must be idempotent',
  );

  assert.equal(redirects.normalizeRedirectPath('/'), '/');
  assert.equal(redirects.normalizeRedirectPath('/docs//./api/../guide/?a=1#top'), '/docs/guide');
  assert.equal(redirects.normalizeRedirectPath('https://example.test/a/b/?x=1'), '/a/b');
  assert.equal(redirects.normalizeRedirectPath('/caf%C3%A9'), '/café');
  assert.equal(redirects.normalizeRedirectPath('/safe/%2e%2e/wp-admin'), '/wp-admin');
  assert.equal(redirects.normalizeRedirectDestination('/about/../contact/?a=1#form'), '/contact/?a=1#form');
  assert.equal(
    redirects.normalizeRedirectDestination('https://Example.TEST:443/docs?a=1#top'),
    'https://example.test/docs?a=1#top',
  );

  const disabledIssues = redirects.validateRedirectSettings(settings(
    entry({ id: 'disabled', source: '', destination: '', enabled: false }),
  ));
  assert.deepEqual(
    disabledIssues,
    [],
    'disabled drafts must be saveable while remaining inert at runtime',
  );
  const overLimitEntries = Array.from({ length: 2_001 }, (_, index) => entry({
    id: `limit-${index}`,
    source: `/limit-${index}`,
    destination: `/target-${index}`,
  }));
  assert.ok(
    redirects.validateRedirectSettings(settings(...overLimitEntries))
      .some(issue => issue.code === 'too-many-redirects'),
    'editor validation must enforce the same 2,000-rule publication limit',
  );
  assert.equal(
    redirects.resolveRedirect(settings(...overLimitEntries), '/limit-2000'),
    null,
    'preview must not execute rules that the WordPress runtime would truncate',
  );
  assert.ok(
    redirects.validateRedirectSettings(settings(entry({
      source: `/${'a'.repeat(2_048)}`,
    }))).some(issue => issue.code === 'source-too-long'),
    'source byte limit must match publication',
  );
  assert.ok(
    redirects.validateRedirectSettings(settings(entry({
      destination: `/${'b'.repeat(4_096)}`,
    }))).some(issue => issue.code === 'destination-too-long'),
    'destination byte limit must match publication',
  );

  for (const source of [
    '/wp-admin',
    '/WP-ADMIN/plugins.php',
    '/wp-login.php',
    '/wp-json/v2/posts',
    '/xmlrpc.php',
    '/wp-content/uploads/image.png',
    '/wp-includes/js/jquery.js',
    '/kodety',
    '/kodety/settings',
  ]) {
    assert.ok(
      redirects.validateRedirectSettings(settings(entry({ id: source, source })))
        .some(issue => issue.code === 'reserved-source'),
      `${source} must remain protected from user-authored redirects`,
    );
    assert.equal(
      redirects.resolveRedirect(settings(entry({ source })), `https://site.test${source}`),
      null,
      `${source} must also be protected in the pure resolver`,
    );
  }
  assert.equal(
    redirects.validateRedirectSettings(settings(entry({ source: '/kodety-stories' }))).length,
    0,
    'reserved route checks must respect path boundaries',
  );
  assert.equal(
    redirects.resolveRedirect(
      settings(entry({ source: '/café', destination: '/coffee' })),
      '/caf%C3%A9',
    )?.location,
    '/coffee',
    'encoded and literal Unicode paths must share one canonical route',
  );
  assert.equal(
    redirects.resolveRedirect(
      settings(entry({ source: '/safe/%2e%2e/wp-admin', destination: '/blocked' })),
      '/safe/%2e%2e/wp-admin',
    ),
    null,
    'encoded dot segments must not bypass reserved WordPress routes',
  );

  const invalidDestinations = [
    '//evil.test/path',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'ftp://example.test/file',
    'https://user:password@example.test/private',
    'https://',
  ];
  invalidDestinations.forEach((destination, index) => {
    assert.ok(
      redirects.validateRedirectSettings(settings(entry({
        id: `unsafe-${index}`,
        destination,
      }))).some(issue => issue.code === 'destination-invalid'),
      `${destination} must be rejected as a redirect target`,
    );
  });

  assert.ok(
    redirects.validateRedirectSettings(settings(
      entry({ match: 'wildcard', source: '/docs' }),
    )).some(issue => issue.code === 'wildcard-required'),
  );
  assert.ok(
    redirects.validateRedirectSettings(settings(
      entry({ match: 'exact', source: '/docs/*' }),
    )).some(issue => issue.code === 'wildcard-not-allowed'),
  );
  assert.ok(
    redirects.validateRedirectSettings(settings(
      entry({ id: 'one', source: '/Case' }),
      entry({ id: 'two', source: '/case/' }),
    )).some(issue => issue.code === 'duplicate-source'),
    'equivalent enabled sources must not introduce ambiguous priority',
  );
  assert.equal(
    redirects.validateRedirectSettings(settings(
      entry({ id: 'exact', source: '/same', match: 'exact' }),
      entry({ id: 'prefix', source: '/same', match: 'prefix' }),
    )).some(issue => issue.code === 'duplicate-source'),
    false,
    'different match modes may intentionally share a source and use list priority',
  );
  assert.ok(
    redirects.validateRedirectSettings(settings(
      entry({ source: '/about/', destination: '/about?campaign=1' }),
    )).some(issue => issue.code === 'self-redirect'),
    'query-only internal changes must not create a self redirect',
  );

  const cyclic = settings(
    entry({ id: 'cycle-a', source: '/a', destination: '/b' }),
    entry({ id: 'cycle-b', source: '/b', destination: '/c' }),
    entry({ id: 'cycle-c', source: '/c', destination: '/a' }),
  );
  const cycleIssues = redirects.validateRedirectSettings(cyclic)
    .filter(issue => issue.code === 'redirect-cycle');
  assert.deepEqual(
    new Set(cycleIssues.map(issue => issue.entryId)),
    new Set(['cycle-a', 'cycle-b', 'cycle-c']),
    'every participant in a redirect cycle must be identified',
  );
  assert.equal(
    redirects.validateRedirectSettings(settings(
      entry({ id: 'chain-a', source: '/a', destination: '/b' }),
      entry({ id: 'chain-b', source: '/b', destination: '/c' }),
    )).some(issue => issue.code === 'redirect-cycle'),
    false,
    'a finite redirect chain is valid',
  );
  ['/a', '/b', '/c'].forEach(source => {
    assert.equal(
      redirects.resolveRedirect(cyclic, `https://site.test${source}`),
      null,
      `runtime must refuse redirect cycle member ${source}`,
    );
  });
  const prefixCycle = settings(
    entry({
      id: 'prefix-cycle-a',
      source: '/a',
      destination: '/b',
      match: 'prefix',
    }),
    entry({
      id: 'prefix-cycle-b',
      source: '/b',
      destination: '/a',
      match: 'prefix',
    }),
  );
  assert.equal(
    redirects.resolveRedirect(prefixCycle, '/a/child'),
    null,
    'concrete prefix/wildcard chains that return to the request must also be blocked',
  );

  const exact = redirects.resolveRedirect(
    settings(entry({ id: 'exact', source: '/Articles/Old/', status: 308 })),
    'https://site.test/articles/old?utm_source=test#intro',
  );
  assert.equal(exact?.location, '/new?utm_source=test');
  assert.equal(exact?.status, 308);
  assert.equal(exact?.external, false);

  const ordered = settings(
    entry({
      id: 'prefix-first',
      source: '/learn',
      destination: '/docs',
      match: 'prefix',
    }),
    entry({
      id: 'exact-second',
      source: '/learn/course',
      destination: '/academy',
      match: 'exact',
    }),
  );
  assert.equal(
    redirects.resolveRedirect(ordered, '/learn/course')?.entry.id,
    'prefix-first',
    'list order, not specificity, defines redirect priority',
  );
  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/learn',
      destination: '/docs?lang=pt#overview',
      match: 'prefix',
    })), '/learn/course/lesson?lang=en&utm=one&utm=two')?.location,
    '/docs/course/lesson?lang=pt&utm=one&utm=two#overview',
    'prefix redirects must append the unmatched suffix and merge query before a target fragment',
  );
  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/learn',
      destination: '/docs',
      match: 'prefix',
      preserveQuery: false,
    })), '/learn/course?utm=discard')?.location,
    '/docs/course',
  );
  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/learn',
      destination: '/docs',
      match: 'prefix',
    })), '/learned'),
    null,
    'prefix matching must respect path-segment boundaries',
  );

  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/blog/*/post/*',
      destination: '/articles/*/entry/*',
      match: 'wildcard',
    })), '/blog/design/post/42')?.location,
    '/articles/design/entry/42',
  );
  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/out/*',
      destination: 'https://external.test/archive/*?ref=fixed',
      match: 'wildcard',
      status: 302,
    })), 'https://site.test/out/news?ref=source&utm=campaign')?.location,
    'https://external.test/archive/news?ref=fixed&utm=campaign',
    'external targets must be allowed and target query keys must win',
  );
  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/out/*',
      destination: 'https://external.test/archive/*',
      match: 'wildcard',
    })), '/out/news')?.external,
    true,
  );

  assert.equal(
    redirects.resolveRedirect(settings(
      entry({ id: 'disabled', source: '/old', destination: '/ignored', enabled: false }),
      entry({ id: 'active', source: '/old', destination: '/used' }),
    ), '/old')?.location,
    '/used',
  );
  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/docs',
      destination: '/target',
      match: 'wildcard',
    })), '/docs'),
    null,
    'a malformed wildcard rule without * must remain inert even if metadata is corrupted',
  );
  assert.equal(
    redirects.resolveRedirect(settings(entry({
      source: '/docs/*',
      destination: '/target/*',
      match: 'exact',
    })), '/docs/guide'),
    null,
    'an explicit non-wildcard rule containing * must not be silently promoted at runtime',
  );
  assert.equal(
    redirects.resolveRedirect(
      settings(entry({ source: '/same', destination: '/same/' })),
      '/same',
    ),
    null,
  );
  assert.equal(
    redirects.resolveRedirect(
      settings(entry({ source: '/same', destination: 'https://site.test/same' })),
      'https://site.test/same',
    ),
    null,
    'absolute same-origin self redirects must be blocked',
  );
  assert.equal(
    redirects.resolveRedirect(
      settings(entry({ destination: '/new#destination' })),
      '/old?utm=kept#source',
    )?.location,
    '/new?utm=kept#destination',
    'an explicit destination fragment must win while source fragments are left to browser semantics',
  );

  assert.equal(redirects.publicRouteForProjectPage('index.html', 'index.html'), '/');
  assert.equal(redirects.publicRouteForProjectPage('docs/index.html', 'index.html'), '/docs');
  assert.equal(redirects.publicRouteForProjectPage('pages/about.html', 'index.html'), '/pages/about');
  assert.equal(
    redirects.publicRouteForProjectPage('about.html?draft=preview.html#section', 'index.html'),
    '/about',
    'query and fragment text must be removed before interpreting the authored .html suffix',
  );
  assert.deepEqual(
    redirects.findProjectPageRouteCollisions([
      'index.html',
      'about.html',
      'about/index.html',
      'legal/privacy.html',
      'legal/privacy.html',
      'assets/logo.svg',
    ]),
    [{ route: '/about', pagePaths: ['about.html', 'about/index.html'] }],
    'route collision detection reports every competing physical page without treating duplicates as collisions',
  );
  assert.deepEqual(
    redirects.findProjectPageRouteCollisions([
      'about.html#preview.html',
      'about/index.html',
    ]),
    [{ route: '/about', pagePaths: ['about.html', 'about/index.html'] }],
    'fragment text ending in .html must not hide the physical route collision',
  );
  assert.throws(
    () => redirects.assertUniqueProjectPageRoutes(['about/index.html', 'about.html']),
    error => (
      error instanceof redirects.ProjectPageRouteCollisionError
      && error.code === 'project-page-route-collision'
      && error.collisions[0].route === '/about'
      && /about\.html/.test(error.message)
      && /about\/index\.html/.test(error.message)
    ),
    'the assertion exposes a structured, actionable error instead of allowing a manifest overwrite',
  );
  const remapped = redirects.remapRedirectDestination(
    settings(
      entry({ id: 'internal', destination: '/pages/about?utm=1#team' }),
      entry({ id: 'external', destination: 'https://external.test/pages/about' }),
      entry({ id: 'source', source: '/pages/about', destination: '/other' }),
    ),
    'pages/about.html',
    'company/team.html',
  );
  assert.equal(remapped.entries[0].destination, '/company/team?utm=1#team');
  assert.equal(remapped.entries[1].destination, 'https://external.test/pages/about');
  assert.equal(
    remapped.entries[2].source,
    '/pages/about',
    'renaming a page must preserve the historical source path',
  );

  const redirectUiSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlRedirectSettings.tsx'),
    'utf8',
  );
  const projectSettingsSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'),
    'utf8',
  );
  const projectSettingsHostSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx'),
    'utf8',
  );
  const projectEditorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  assert.match(
    redirectUiSource,
    /from '@\/lib\/html-editor\/redirects'/,
    'Redirect UI and runtime must share one metadata contract',
  );
  assert.doesNotMatch(
    redirectUiSource,
    /caseSensitive/,
    'the UI must not save fields that the publication runtime ignores',
  );
  assert.match(
    redirectUiSource,
    /DndContext[\s\S]*?KeyboardSensor[\s\S]*?sortableKeyboardCoordinates[\s\S]*?onDragEnd=\{handleDragEnd\}/,
    'priority ordering must support pointer and keyboard reordering',
  );
  [
    'Filtrar redirecionamentos…',
    'Adicionar redirecionamento',
    'Duplicar',
    'Mover para cima',
    'Mover para baixo',
    'Remover',
  ].forEach(label => {
    assert.ok(
      redirectUiSource.includes(label),
      `Redirect management must retain the “${label}” action`,
    );
  });
  assert.match(
    redirectUiSource,
    /value="301"[\s\S]*?value="302"[\s\S]*?value="307"[\s\S]*?value="308"/,
    'all supported HTTP redirect statuses must remain selectable',
  );
  assert.match(
    redirectUiSource,
    /value="exact"[\s\S]*?value="prefix"[\s\S]*?value="wildcard"[\s\S]*?Preservar parâmetros/,
    'exact, prefix, wildcard and query behavior must remain authorable',
  );
  assert.match(
    projectSettingsSource,
    /redirects: RedirectSettings[\s\S]*?onSaveRedirects: \(settings: RedirectSettings\)/,
    'Settings must persist Redirects through their own typed callback',
  );
  assert.match(
    projectSettingsSource,
    /section === 'redirects'[\s\S]*?<HtmlRedirectSettings[\s\S]*?onChange=\{setRedirectDraft\}[\s\S]*?<SaveBar[\s\S]*?onSave=\{persistRedirects\}/,
    'Redirects must be a first-class Settings panel with explicit save behavior',
  );
  assert.match(
    projectSettingsHostSource,
    /const saveRedirects = useCallback\([\s\S]*?async \(settings: RedirectSettings\)[\s\S]*?normalizeRedirectSettings\(settings\)[\s\S]*?redirects: normalized[\s\S]*?await persistExactDraft\(next, true\)[\s\S]*?commitProject\(next\)/,
    'saving redirects must only commit the project after the native WordPress draft acknowledges the exact snapshot',
  );
  assert.match(
    projectEditorSource,
    /const projectSettingsHostProps: HtmlProjectSettingsHostProps = \{[\s\S]*?persistExactDraft: workspace \? workspace\.saveProject : persistExactWordPressDraft/,
    'the Settings host must use folder persistence for HTML and retain the exact native WordPress draft persistence callback',
  );
  assert.match(
    projectEditorSource,
    /const redirect = resolveRedirect\(redirects, redirectRequest\)[\s\S]*?redirect\?\.location/,
    'project Preview navigation must honor the same resolver as publication',
  );

  // Redirect normalization must stay idempotent so the canonical save echo
  // can replace exactly the draft that produced it without altering its value.
  const midTyping = redirects.normalizeRedirectSettings(settings(entry({ destination: 'h' })));
  assert.equal(
    midTyping.entries[0].destination,
    '/h',
    'normalization anchors a bare destination to the site root',
  );
  assert.deepEqual(
    redirects.normalizeRedirectSettings(midTyping),
    midTyping,
    'normalizeRedirectSettings must be idempotent or the autosave echo guard never matches',
  );
  assert.equal(
    redirects.normalizeRedirectSettings(settings(entry({ destination: 'https://exemplo.test/pagina' })))
      .entries[0].destination,
    'https://exemplo.test/pagina',
    'a finished external URL must survive normalization untouched',
  );
  assert.match(
    projectSettingsSource,
    /draft: redirectDraft,[\s\S]*?saveLifecycle: redirectSaveLifecycle,[\s\S]*?useCanonicalSettingsDraft\(normalizedRedirects\)/,
    'redirects must use the shared canonical saved-state reconciler',
  );
  assert.match(
    projectSettingsSource,
    /scope: 'redirects',[\s\S]*?signature: redirectDraftSignature,[\s\S]*?\.\.\.redirectSaveLifecycle\(redirectDraftSignature\)[\s\S]*?run: \(\) => onSaveRedirects\(draft\)/,
    'a successful redirect save must acknowledge only the exact queued draft',
  );

  // Bulk import reads whatever a spreadsheet exported: PT or EN headers, comma
  // or semicolon, BOM, CRLF, quoted fields and no header row at all.
  const csvPt = redirects.parseRedirectCsv(
    'origem,destino,status,correspondencia,preservar_parametros,ativo\n/a,/b,302,exact,nao,sim',
  );
  assert.deepEqual(csvPt.entries, [{
    source: '/a', destination: '/b', status: 302, match: 'exact', preserveQuery: false, enabled: true,
  }]);
  assert.equal(
    redirects.parseRedirectCsv('source;destination;code\n/x;https://ex.test/y;308').entries[0].destination,
    'https://ex.test/y',
    'a semicolon export with English headers must import',
  );
  assert.equal(
    redirects.parseRedirectCsv('/old,/new').entries[0].source,
    '/old',
    'a headerless file must be read positionally',
  );
  assert.equal(
    redirects.parseRedirectCsv('﻿origem,destino\r\n"/busca,teste","/resultado"\r\n').entries[0].source,
    '/busca,teste',
    'BOM, CRLF and a quoted delimiter must survive parsing',
  );
  const csvBad = redirects.parseRedirectCsv('origem,destino\n,/orfao\n/sozinho,\n/,/raiz\n/ok,/fine');
  assert.equal(csvBad.entries.length, 1, 'only the valid row imports');
  assert.deepEqual(
    csvBad.skipped.map(issue => issue.line),
    [2, 3, 4],
    'every rejected row must be reported by line so nothing vanishes silently',
  );
  const template = redirects.parseRedirectCsv(redirects.redirectCsvTemplate());
  assert.equal(template.skipped.length, 0, 'the sample file must import cleanly');
  assert.equal(template.entries.length, 3, 'the sample file must show every match mode');
  assert.deepEqual(
    redirects.parseRedirectCsv(redirects.redirectsToCsv(csvPt.entries.map((entry, index) => ({ ...entry, id: String(index) })))).entries,
    csvPt.entries,
    'exporting and reimporting must round-trip a rule unchanged',
  );

  console.log('Redirect regression tests passed.');
} finally {
  await server.close();
}
