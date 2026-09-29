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
  server: { middlewareMode: true },
});

try {
  const analytics = await server.ssrLoadModule('/lib/html-editor/analytics.ts');
  const analyticsDisplay = await server.ssrLoadModule('/lib/html-editor/analytics-display.ts');
  const analyticsAccess = await server.ssrLoadModule('/lib/html-editor/analytics-access.ts');
  const clientModule = await server.ssrLoadModule('/lib/html-editor/analytics-client.ts');
  const demoModule = await server.ssrLoadModule('/lib/html-editor/analytics-demo.ts');

  assert.equal(demoModule.isAnalyticsDemoMode('?value=teste'), true, 'value=teste must enable the visual demo');
  assert.equal(demoModule.isAnalyticsDemoMode('?value=producao'), false, 'other query values must preserve normal Analytics');
  assert.equal(demoModule.isAnalyticsDemoMode('?preview=1&value=teste&view=analytics'), true, 'the demo query may coexist with other parameters');
  const demoSource = demoModule.createAnalyticsDemoDataSource();
  assert.deepEqual(
    analyticsAccess.resolveAnalyticsFeatureAccess({
      licensed: false,
      features: { analytics: true },
      limits: { analyticsHistoryDays: 7 },
      licenseUrl: '/wp-admin/admin.php?page=kodety-license',
      upgradeUrl: 'https://dash.kodety.com/',
    }),
    {
      licensed: true,
      historyDays: null,
      pageInsights: true,
      funnels: true,
      abTests: true,
      utms: true,
    },
    'legacy license state must not restrict the open-source analytics workspace',
  );
  assert.deepEqual(
    analyticsAccess.resolveAnalyticsFeatureAccess(undefined),
    {
      licensed: true,
      historyDays: null,
      pageInsights: true,
      funnels: true,
      abTests: true,
      utms: true,
    },
    'standalone/demo hosts without a product projection must retain the historical full workspace',
  );
  const demoPeriod = { preset: '30d', from: '2026-06-24', to: '2026-07-23', timezone: 'America/Sao_Paulo' };
  const demoOverview = await demoSource.loadOverview({ period: demoPeriod });
  assert.equal(demoOverview.liveVisitors, 420);
  assert.equal(demoOverview.uniqueVisitors, 10_000_000);
  assert.equal(demoOverview.totalSessions, 13_200_000);
  assert.ok(demoOverview.series.length >= 2, 'the demo must populate the traffic chart');
  assert.ok(demoOverview.sources.length >= 5, 'the demo must populate overview breakdowns');
  const demoInsight = await demoSource.loadPageInsights({ period: demoPeriod, pagePath: '/produto/', device: 'mobile' });
  assert.equal(demoInsight.totalSessions, 4_800_000);
  assert.equal(demoInsight.device, 'mobile');
  assert.ok(demoInsight.scroll.length >= 5, 'the demo must populate page scroll data');
  const demoFunnels = await demoSource.loadFunnels({ period: demoPeriod });
  assert.equal(demoFunnels.length, 3);
  assert.ok(demoFunnels.every(item => item.results?.length), 'demo funnels must include large conversion results');
  assert.equal(demoSource.createFunnel, undefined, 'the visual demo must never expose create mutations');
  assert.equal(demoSource.updateFunnel, undefined, 'the visual demo must never expose update mutations');
  assert.equal(demoSource.deleteFunnel, undefined, 'the visual demo must never expose delete mutations');

  assert.deepEqual(
    analytics.emptyAnalyticsOverview(),
    {
      liveVisitors: null,
      totalSessions: null,
      uniqueVisitors: null,
      pageviews: null,
      bounceRate: null,
      averageSessionSeconds: null,
      series: [],
      sources: [],
      pages: [],
      countries: [],
      locations: [],
      devices: [],
      browsers: [],
      operatingSystems: [],
      tracking: [],
    },
    'the Analytics fallback must be empty and never contain fabricated metrics',
  );

  const normalized = analytics.normalizeAnalyticsOverview({
    liveVisitors: -1,
    uniqueVisitors: 42,
    pageviews: Number.NaN,
    series: [
      { timestamp: '2026-07-23T12:00:00Z', uniqueVisitors: 2, pageviews: 3 },
      { timestamp: '2026-07-22T12:00:00Z', uniqueVisitors: 1, pageviews: 2 },
      { timestamp: '', uniqueVisitors: 99, pageviews: 99 },
    ],
    sources: [{ key: 'google', label: 'Google', value: 12 }, { label: '', value: 99 }],
  });
  assert.equal(normalized.liveVisitors, null);
  assert.equal(normalized.uniqueVisitors, 42);
  assert.equal(normalized.pageviews, null);
  assert.deepEqual(
    normalized.series.map(point => point.timestamp),
    ['2026-07-22T12:00:00Z', '2026-07-23T12:00:00Z'],
    'series points must be valid and chronologically sorted',
  );
  assert.equal(normalized.sources.length, 1);
  assert.equal(
    analyticsDisplay.resolveAnalyticsCountryCode({ key: 'São Paulo|São Paulo|BR', label: 'São Paulo, São Paulo, BR' }),
    'BR',
    'location rows must recover their country code from the existing backend key',
  );
  assert.equal(
    analyticsDisplay.resolveAnalyticsCountryCode({ key: 'demo-country', label: 'Estados Unidos' }),
    'US',
    'demo and legacy country names must also resolve to a flag',
  );
  assert.equal(analyticsDisplay.countryCodeToFlagEmoji('JP'), '🇯🇵');
  assert.equal(
    analyticsDisplay.resolveAnalyticsSourceVisual({ key: 'l.facebook.com', label: 'l.facebook.com' }),
    'facebook',
    'social redirect subdomains must retain the source brand',
  );
  assert.equal(
    analyticsDisplay.resolveAnalyticsSourceVisual({ key: 'google.com', label: 'google.com' }),
    'google',
    'search referrer domains must resolve to their monochrome brand mark',
  );
  assert.equal(
    analyticsDisplay.resolveAnalyticsSourceVisual({ key: 't.co', label: 't.co' }),
    'x',
    'short redirect domains must survive source normalization',
  );
  assert.equal(
    analyticsDisplay.resolveAnalyticsDeviceVisual({ key: 'mobile', label: 'mobile' }),
    'mobile',
    'mobile rows must use the phone glyph',
  );
  const pageInsight = analytics.normalizeAnalyticsPageInsight({
    pagePath: '/pricing',
    pageUrl: 'https://example.test/pricing',
    device: 'desktop',
    totalSessions: 8,
    averageFoldPx: 820,
    scroll: [{ depth: 50, sessions: 6, percentage: 75 }],
    topEvents: [{
      key: 'cta',
      type: 'click',
      trackingId: 'buy',
      selector: '#buy',
      label: 'Comprar',
      count: 12,
      uniqueVisitors: 5,
    }],
  });
  assert.equal(pageInsight.totalSessions, 8);
  assert.equal(pageInsight.scroll[0].percentage, 75);
  assert.equal(pageInsight.topEvents[0].selector, '#buy');

  const funnel = analytics.createEmptyFunnel('Conversão');
  assert.equal(funnel.steps.length, 1);
  assert.deepEqual(funnel.connections, []);
  assert.deepEqual(funnel.canvas, { x: 0, y: 0, zoom: 1 });
  assert.equal(funnel.windowMinutes, 0, 'a new funnel defaults to no conversion window');
  assert.equal(analytics.validateFunnelInput(funnel), null);
  assert.equal(analytics.normalizeFunnelWindowMinutes('120'), 120, 'the conversion window accepts whole minutes');
  assert.equal(analytics.normalizeFunnelWindowMinutes(-3), 0, 'a negative window collapses to no limit');
  assert.equal(analytics.normalizeFunnelWindowMinutes(9_999_999), analytics.MAX_FUNNEL_WINDOW_MINUTES, 'the window is capped at 30 days');
  assert.match(
    analytics.validateFunnelInput({ ...funnel, windowMinutes: analytics.MAX_FUNNEL_WINDOW_MINUTES + 1 }),
    /janela de conversão/i,
    'a window beyond the cap is rejected',
  );
  assert.match(
    analytics.validateFunnelInput({
      ...funnel,
      steps: [{ id: 'click', name: 'CTA', type: 'click' }],
    }),
    /Tracking ID/,
  );
  assert.equal(
    analytics.validateFunnelInput({
      ...funnel,
      steps: [{ id: 'click', name: 'CTA', type: 'click', trackingId: 'get-started-hero' }],
    }),
    null,
    'click steps must persist a data-kodety-tracking-id value',
  );
  const graphInput = analytics.funnelToInput({
    id: 'legacy',
    name: 'Legacy',
    enabled: true,
    filters: [],
    steps: [
      { id: 'landing', name: 'Landing', type: 'page', pagePath: '/' },
      { id: 'lead', name: 'Lead', type: 'submit', trackingId: 'lead-form' },
    ],
  });
  assert.equal(graphInput.connections.length, 1, 'legacy linear funnels are upgraded to a graph connection');
  assert.equal(graphInput.connections[0].sourceStepId, 'landing');
  assert.equal(graphInput.connections[0].targetStepId, 'lead');
  const portableJson = analytics.serializeFunnelExport(graphInput);
  const portablePayload = JSON.parse(portableJson);
  assert.equal(portablePayload.kind, 'kodety-funnel');
  assert.equal(portablePayload.version, 1);
  assert.equal(portablePayload.funnel.name, 'Legacy');
  assert.equal('results' in portablePayload.funnel, false, 'exports must never carry visitor results');
  const importedFunnel = analytics.parseFunnelImport(portableJson);
  assert.equal(importedFunnel.enabled, false, 'imported funnels must always start paused');
  assert.equal(importedFunnel.steps.length, 2);
  assert.notEqual(importedFunnel.steps[0].id, graphInput.steps[0].id, 'imported nodes must receive fresh local IDs');
  assert.equal(importedFunnel.connections.length, 1);
  assert.equal(importedFunnel.connections[0].sourceStepId, importedFunnel.steps[0].id);
  assert.equal(importedFunnel.connections[0].targetStepId, importedFunnel.steps[1].id);
  assert.throws(
    () => analytics.parseFunnelImport(JSON.stringify({
      kind: 'kodety-funnel',
      version: 999,
      funnel: graphInput,
    })),
    /versão.*não é compatível/i,
  );
  assert.throws(() => analytics.parseFunnelImport('{'), /JSON válido/i);
  const emailNode = {
    ...funnel,
    steps: [{
      id: 'email',
      name: 'Adicionar à lista',
      type: 'email',
      emailAction: 'add-to-list',
      emailListId: 12,
    }],
  };
  assert.equal(analytics.validateFunnelInput(emailNode), null, 'email marketing actions are valid funnel nodes');
  const legacyCampaignNode = analytics.funnelToInput({
    ...funnel,
    id: 'legacy-campaign',
    steps: [{
      id: 'email',
      name: 'Disparo legado',
      type: 'email',
      emailAction: 'send-campaign',
      emailCampaignId: 91,
    }],
  });
  assert.equal(
    legacyCampaignNode.steps[0].emailAction,
    'upsert-contact',
    'legacy campaign automations must downgrade to contact capture',
  );
  const webhookNode = {
    ...funnel,
    steps: [
      { id: 'lead', name: 'Lead', type: 'submit', trackingId: 'lead-form' },
      {
        id: 'crm',
        name: 'Enviar ao CRM',
        type: 'webhook',
        webhookUrl: 'https://hooks.example.test/kodety',
        webhookMethod: 'PATCH',
        webhookPayloadMode: 'fields',
        webhookEvent: 'lead.created',
        webhookSecret: 'write-only-secret',
        webhookSecretConfigured: true,
      },
    ],
    connections: [{
      id: 'lead-to-crm',
      sourceStepId: 'lead',
      targetStepId: 'crm',
      minDelayMinutes: 0,
      maxDelayMinutes: 0,
      filters: [],
    }],
  };
  assert.equal(analytics.validateFunnelInput(webhookNode), null, 'webhooks connected to a form are valid action nodes');
  assert.match(
    analytics.validateFunnelInput({
      ...webhookNode,
      steps: webhookNode.steps.map(step => step.type === 'webhook'
        ? { ...step, webhookUrl: 'http://127.0.0.1/hook' }
        : step),
    }),
    /URL HTTPS válida/i,
    'webhook authoring must reject non-HTTPS endpoints',
  );
  assert.match(
    analytics.validateFunnelInput({ ...webhookNode, connections: [] }),
    /Conecte todas as etapas|Conecte cada webhook/i,
    'a webhook must be reachable from a submitted form',
  );
  const portableWebhook = JSON.parse(analytics.serializeFunnelExport(webhookNode));
  assert.equal('webhookSecret' in portableWebhook.funnel.steps[1], false, 'exports must strip write-only webhook secrets');
  assert.equal('webhookSecretConfigured' in portableWebhook.funnel.steps[1], false, 'exports must strip secret metadata');
  const importedWebhook = analytics.parseFunnelImport(portableWebhook);
  assert.equal(importedWebhook.steps[1].type, 'webhook');
  assert.equal(importedWebhook.steps[1].webhookMethod, 'PATCH');
  assert.equal(importedWebhook.steps[1].webhookPayloadMode, 'fields');
  assert.equal(importedWebhook.steps[1].webhookSecretConfigured, false, 'import never carries a signing secret');

  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (init?.method === 'DELETE') return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (init?.method === 'POST' || init?.method === 'PUT') {
      return Response.json({ funnel: { id: 'funnel-1', ...JSON.parse(String(init.body)), results: [] } });
    }
    if (String(input).includes('/page-insights')) return Response.json({
      insight: {
        pagePath: '/pricing',
        pageUrl: 'https://example.test/pricing',
        device: 'mobile',
        totalSessions: 4,
        scroll: [],
        topEvents: [],
      },
    });
    if (String(input).includes('/overview')) return Response.json({ overview: { uniqueVisitors: 7 } });
    if (String(input).includes('/funnels/funnel-1')) return Response.json({
      id: 'funnel-1',
      name: 'Conversão',
      enabled: true,
      steps: funnel.steps,
      filters: [],
      results: [{ stepId: funnel.steps[0].id, visitors: 3, conversionRate: 100 }],
    });
    return Response.json({ funnels: [{ id: 'funnel-1', name: 'Conversão', enabled: true, steps: funnel.steps, filters: [] }] });
  };
  try {
    const client = clientModule.createHtmlAnalyticsClient({
      baseUrl: 'https://example.test/wp-admin/',
      overviewUrl: '/wp-json/kodety/v1/analytics/overview',
      pageInsightsUrl: '/wp-json/kodety/v1/analytics/page-insights',
      funnelsUrl: '/wp-json/kodety/v1/analytics/funnels',
      funnelItemUrl: '/wp-json/kodety/v1/analytics/funnels/{id}',
      nonce: 'nonce-value',
    });
    const period = { preset: '30d', from: '2026-06-24', to: '2026-07-23', timezone: 'America/Sao_Paulo' };
    const overview = await client.loadOverview({ period });
    assert.equal(overview.uniqueVisitors, 7);
    assert.match(requests[0].url, /from=2026-06-24/);
    assert.match(requests[0].url, /timezone=America%2FSao_Paulo/);
    assert.equal(new Headers(requests[0].init.headers).get('X-WP-Nonce'), 'nonce-value');
    const definitions = await client.loadFunnels({ period });
    assert.equal(definitions.length, 1);
    const definitionRequest = requests.find(request => request.url.includes('/funnels?'));
    assert.ok(definitionRequest, 'the funnel definition request must be sent');
    assert.match(definitionRequest.url, /[?&]summary=1(?:&|$)/, 'funnel lists must request the inexpensive summary representation');
    const selectedFunnel = await client.loadFunnel('funnel-1', { period });
    assert.equal(selectedFunnel.results[0].visitors, 3, 'only the selected funnel request carries calculated results');
    await client.createFunnel(funnel);
    await client.updateFunnel('special/id', funnel);
    await client.deleteFunnel('special/id');
    const updateRequest = requests.find(request => request.init?.method === 'PUT');
    const deleteRequest = requests.find(request => request.init?.method === 'DELETE');
    assert.match(updateRequest.url, /special%2Fid$/);
    assert.equal(updateRequest.init.method, 'PUT');
    assert.equal(deleteRequest.init.method, 'DELETE');
    const insight = await client.loadPageInsights({
      period,
      pagePath: '/pricing',
      device: 'mobile',
    });
    assert.equal(insight.totalSessions, 4);
    const insightRequest = requests.find(request => request.url.includes('/page-insights'));
    assert.match(insightRequest.url, /page=%2Fpricing/);
    assert.match(insightRequest.url, /device=mobile/);

    globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init?.signal?.aborted) rejectAbort();
      else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
    });
    const timeoutClient = clientModule.createHtmlAnalyticsClient({
      baseUrl: 'https://example.test/wp-admin/',
      overviewUrl: '/wp-json/kodety/v1/analytics/overview',
      funnelsUrl: '/wp-json/kodety/v1/analytics/funnels',
      requestTimeoutMs: 5,
    });
    await assert.rejects(
      timeoutClient.loadOverview({ period }),
      /demorou demais para responder/i,
      'a stalled Analytics request must terminate with an actionable timeout',
    );
  } finally {
    globalThis.fetch = previousFetch;
  }

  const workspaceSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAnalyticsWorkspace.tsx'),
    'utf8',
  );
  const abTestsSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAnalyticsAbTests.tsx'),
    'utf8',
  );
  const demoAbTestsSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAnalyticsDemoAbTests.tsx'),
    'utf8',
  );
  const overviewSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAnalyticsOverview.tsx'),
    'utf8',
  );
  const wordpressAnalyticsSource = await readFile(
    path.join(root, 'Wordpress/editor/WordPressAnalyticsWorkspace.tsx'),
    'utf8',
  );
  assert.doesNotMatch(
    workspaceSource,
    /data-kodety-tracking-id/,
    'the Analytics workspace must not expose implementation-specific tracking attributes in the UI',
  );
  assert.match(
    workspaceSource,
    /liveRefreshMs = false/,
    'Analytics auto-refresh must default to manual so an idle dashboard does not continuously query WordPress',
  );
  assert.match(
    workspaceSource,
    /if \(!source\?\.loadFunnel \|\| activeView !== 'funnels' \|\| !selectedFunnelId\)[\s\S]*?source\.loadFunnel\(selectedFunnelId/,
    'calculated funnel results must load only for the selected funnel while the Funnels view is open',
  );
  assert.match(
    workspaceSource,
    /activeView !== 'funnels' \|\| !api\?\.emailOptionsUrl/,
    'email automation options must stay lazy outside the Funnels view',
  );
  assert.match(
    workspaceSource,
    /setEmailOptionsError\(null\)[\s\S]*?setEmailOptionsError\(timedOut/,
    'a recovered email-options request must clear only its own obsolete error',
  );
  assert.match(
    workspaceSource,
    /error=\{funnelsError \|\| emailOptionsError\}/,
    'funnel and email integration failures must remain independently tracked',
  );
  assert.match(workspaceSource, /page-insights/);
  assert.match(workspaceSource, /abTestsSlot/);
  assert.match(
    workspaceSource,
    /const source = demoMode \? demoDataSource : dataSource \|\| apiClient/,
    'demo mode must replace the real source before any Analytics loading effect runs',
  );
  assert.match(
    workspaceSource,
    /forcedDemoMode \?\? isAnalyticsDemoMode\(\)/,
    'the routed WordPress flag must take precedence over direct browser query detection',
  );
  assert.match(
    wordpressAnalyticsSource,
    /demoMode=\{config\.analyticsDemoMode\}/,
    'the lightweight WordPress Analytics entry must pass the server-resolved demo flag',
  );
  assert.match(
    wordpressAnalyticsSource,
    /if \(config\?\.studio\?\.enabled\) return <StudioAnalyticsUnavailable config=\{config\} \/>/,
    'the WordPress plugin must replace Analytics with an explicit local-environment state inside Kodety Studio',
  );
  assert.match(wordpressAnalyticsSource, /data-kodety-analytics-studio-unavailable="true"/);
  assert.match(wordpressAnalyticsSource, /Analytics indisponível no Onun Kodety/);
  assert.match(wordpressAnalyticsSource, /Analytics is unavailable in Onun Kodety/);
  assert.match(workspaceSource, /Demo · dados simulados/, 'simulated numbers must be visibly identified');
  assert.match(workspaceSource, /api\.readOnly \|\| demoMode/, 'demo mode must not query real email integration data');
  assert.match(demoAbTestsSource, /8_400_000[\s\S]*?1_280_000[\s\S]*?\+32,8%/, 'the demo must populate the A\/B panel');
  assert.match(
    overviewSource,
    /bg-\[#181818\][\s\S]*?bg-\[#242424\]/,
    'breakdown rows must keep an opaque gray remainder behind their proportional fill',
  );
  assert.match(
    overviewSource,
    /fallbackIcon: FallbackIcon[\s\S]*?return <ItemIconFrame><FallbackIcon/,
    'every Analytics breakdown row must fall back to its category icon',
  );
  assert.match(
    overviewSource,
    /title="Páginas"[\s\S]{0,160}?icon=\{FileText\}/,
    'page rows must use the page/file glyph',
  );
  assert.match(
    overviewSource,
    /title="Navegadores"[\s\S]{0,180}?icon=\{AppWindow\}/,
    'browser rows must use a browser-window glyph',
  );
  assert.match(
    overviewSource,
    /title="Sistemas operacionais"[\s\S]{0,200}?icon=\{Monitor\}/,
    'operating-system rows must use a computer glyph',
  );
  assert.match(
    overviewSource,
    /title="Tracking IDs"[\s\S]{0,220}?itemIcon=\{Hash\}/,
    'Tracking ID rows must use an identifier glyph rather than remain unadorned',
  );
  assert.match(workspaceSource, /trackingTargets/);
  assert.match(workspaceSource, /pages/);
  assert.match(workspaceSource, /setAbTestsReload/, 'global refresh must reach the active A/B workspace');
  assert.match(
    workspaceSource,
    /const apiClient = useMemo\([\s\S]*?api\?\.funnelsUrl[\s\S]*?api\?\.overviewUrl[\s\S]*?api\?\.readOnly/,
    'the Analytics client must be memoized from stable configuration fields',
  );
  assert.doesNotMatch(
    workspaceSource,
    /const apiClient = useMemo\([\s\S]{0,180}?\[api\]/,
    'a fresh API config object from the editor autosave must not recreate the Analytics client',
  );
  assert.match(
    abTestsSource,
    /label="Visitante"[\s\S]*?columnsClassName="grid-cols-\[1\.16fr_\.84fr_1fr\]"[\s\S]*?description: 'Novos e recorrentes'[\s\S]*?descriptionClassName: 'whitespace-nowrap'/,
    'the longer all-visitors description must stay on one line without changing the other audience group',
  );

  const editorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  const liveDomHelpersSource = await readFile(
    path.join(root, 'lib/html-editor/editor-live-dom-helpers.ts'),
    'utf8',
  );
  assert.match(
    editorSource,
    /runtimePath:\s*publicRouteForProjectPage/,
    'funnel page options must persist the public pathname emitted by the tracker',
  );
  assert.match(
    liveDomHelpersSource,
    /querySelectorAll<HTMLElement>\('\[id\]'\)/,
    'the A/B target catalog must discover normal HTML IDs',
  );
  assert.match(
    liveDomHelpersSource,
    /querySelectorAll<HTMLElement>\('\[class\]'\)/,
    'the A/B target catalog must discover normal HTML classes',
  );
  assert.match(
    liveDomHelpersSource,
    /element\.tagName\.toLowerCase\(\)\s*===\s*'form'\s*\?\s*'submit'\s*:\s*'click'/,
    'tracked forms must be exposed as submit nodes to the funnel editor',
  );
  assert.match(editorSource, /initialExperimentId/);
  assert.match(editorSource, /initialVariantId/);
  assert.match(editorSource, /demoMode=\{topbarWp(?:\?\.|\.)analyticsDemoMode\}/);
  assert.doesNotMatch(
    editorSource,
    /\.find\(\(\{\s*variant\s*\}\)\s*=>\s*variant\.pagePath\s*===\s*requested\)/,
    'variant selection must never be inferred ambiguously from a shared page path',
  );

  const navigatorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlNavigator.tsx'),
    'utf8',
  );
  assert.match(
    navigatorSource,
    /onExperimentVariantSelect\(group\.experimentId,\s*variant\.id\)/,
    'Pages must open variants by their exact experiment/variant identity',
  );

  const shellSource = await readFile(
    path.join(root, 'Wordpress/kodety/templates/editor-shell.php'),
    'utf8',
  );
  assert.match(shellSource, /initialExperimentId/);
  assert.match(shellSource, /initialVariantId/);
  assert.match(
    shellSource,
    /\$analytics_demo_mode = \$resolved_app_view === 'analytics'[\s\S]*?\$_GET\['value'\][\s\S]*?=== 'teste'[\s\S]*?'analyticsDemoMode' => \$analytics_demo_mode/,
    'the WordPress shell must preserve value=teste in its typed client config',
  );
  assert.match(shellSource, /analyticsPageInsightsUrl/);

  const pageInsightsSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAnalyticsPageInsights.tsx'),
    'utf8',
  );
  assert.match(
    pageInsightsSource,
    /kodety-analytics-published-preview/,
    'the visual preview must identify its published runtime without changing the public URL',
  );
  assert.doesNotMatch(
    pageInsightsSource,
    /searchParams\.set\('kodety-analytics-preview'/,
    'the visual preview must load the exact published page URL',
  );
  assert.match(
    pageInsightsSource,
    /\[160,\s*700,\s*2200\]\.map/,
    'the page view must let the published animation runtime initialize before fitting the full document',
  );
  assert.match(
    pageInsightsSource,
    /const PAGE_VIEWPORTS:[\s\S]*?all:\s*\{\s*width:\s*1920,\s*height:\s*1080[\s\S]*?desktop:\s*\{\s*width:\s*1920,\s*height:\s*1080[\s\S]*?tablet:\s*\{\s*width:\s*768,\s*height:\s*1024[\s\S]*?mobile:\s*\{\s*width:\s*390,\s*height:\s*844/,
    'the published page view must provide a responsive logical viewport for every device filter',
  );
  assert.match(
    pageInsightsSource,
    /const viewport = PAGE_VIEWPORTS\[device\];[\s\S]*?const frameWidth = viewport\.width;[\s\S]*?const naturalViewportHeight = viewport\.height;/,
    'the device filter must control the published preview dimensions',
  );
  assert.match(
    pageInsightsSource,
    /function capPublishedViewportHeightSections\(documentNode: Document, viewportHeight: number\)[\s\S]*?Math\.min\(viewportHeight, pixels\)[\s\S]*?data-kodety-analytics-vh-capped[\s\S]*?capPublishedViewportHeightSections\(documentNode, naturalViewportHeight\)/,
    'viewport-height sections must be frozen against the selected device before the iframe expands to the full published document',
  );
  assert.match(
    pageInsightsSource,
    /data-page-preview-viewport=\{`\$\{frameWidth\}x\$\{naturalViewportHeight\}`\}[\s\S]*?key=\{`\$\{frameUrl\}:\$\{device\}:\$\{frameWidth\}:\$\{naturalViewportHeight\}`\}/,
    'changing the device filter must remount the published preview at the selected viewport',
  );
  assert.match(
    pageInsightsSource,
    /data-page-scroll-rail[\s\S]*?bg-\[var\(--kodety-panel\)\][\s\S]*?scrollRailTicks\.map[\s\S]*?scrollRailGradient\(item\.depth\)/,
    'the page view must expose a quiet tokenized scroll rail and progressive gradient depth bars',
  );
  assert.match(
    pageInsightsSource,
    /const PAGE_VIEW_RAIL_WIDTH = 18;[\s\S]*?\[\s*0,\s*25,\s*50,\s*75,\s*100,[\s\S]*?scrollRailTickColor\(reach\)/,
    'the scroll rail must stay compact and use only sparse, tokenized depth markers',
  );
  assert.match(
    pageInsightsSource,
    /data-page-scroll-fold-marker[\s\S]*?rounded-full[\s\S]*?data-page-scroll-average-marker[\s\S]*?rounded-full/,
    'fold and average-scroll markers must use compact rounded endpoints',
  );
  assert.doesNotMatch(
    pageInsightsSource,
    /border-l-\[7px\][\s\S]*?border-y-transparent/,
    'the scroll rail must not restore the oversized chamfered triangle marker',
  );
  assert.match(pageInsightsSource, /Dobra média/, 'the page view must expose average-fold depth');
  assert.match(pageInsightsSource, /Principais eventos/, 'the page view must list tracked interactions');

  const analyticsRuntimeSource = await readFile(
    path.join(root, 'Wordpress/kodety/includes/class-kodety-analytics.php'),
    'utf8',
  );
  assert.match(
    analyticsRuntimeSource,
    /window\.name\s*===\s*"kodety-analytics-published-preview"/,
    'the exact published preview must not record its own analytics session',
  );
  assert.match(
    analyticsRuntimeSource,
    /public function list_funnels[\s\S]*?rest_sanitize_boolean\(\$request->get_param\('summary'\)\)[\s\S]*?return \$this->private_response\(\$funnels\);[\s\S]*?\[\$start, \$end\] = \$this->date_range\(\$request\);[\s\S]*?calculate_funnel_graph/,
    'summary funnel requests must return definitions before any graph calculation or event scan',
  );

  assert.match(
    workspaceSource,
    /trackingTargets\.filter\(target\s*=>\s*!target\.selectorType\)/,
    'ID/class selector targets must not leak into the legacy funnel picker',
  );

  const funnelsSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAnalyticsFunnels.tsx'),
    'utf8',
  );
  assert.match(funnelsSource, /connectionDragRef/, 'funnel connections must expose a pointer-drag interaction');
  assert.match(funnelsSource, /document\.elementFromPoint/, 'connection drops must resolve the node under the pointer');
  assert.match(funnelsSource, /Space \+ arrastar para mover/, 'the canvas must teach its keyboard-assisted pan gesture');
  assert.match(funnelsSource, /aria-label="Enquadrar seleção"/, 'the canvas must focus a selected node or connection');
  assert.match(
    funnelsSource,
    /aria-label="Importar funil"[\s\S]*?aria-label="Exportar funil"/,
    'funnels must expose portable import and export actions in the workspace header',
  );
  assert.match(
    funnelsSource,
    /parseFunnelImport\(await file\.text\(\)\)[\s\S]*?setCreating\(true\)[\s\S]*?setDraft\(imported\)[\s\S]*?Importado como rascunho pausado/,
    'an imported funnel must open as a configurable unsaved draft instead of being persisted immediately',
  );
  assert.match(
    funnelsSource,
    /file\.size > 2 \* 1024 \* 1024[\s\S]*?serializeFunnelExport\(draft\)[\s\S]*?\.kodety-funnel\.json/,
    'portable funnel files must be size-limited and exported with a recognizable extension',
  );
  assert.doesNotMatch(funnelsSource, /value="send-campaign"/, 'the funnel UI must not offer automatic campaign delivery');
  assert.doesNotMatch(funnelsSource, /emailOptions\.campaigns/, 'the funnel UI must not load campaign send targets');
  assert.match(funnelsSource, /addNode\('webhook'\)/, 'the add-node menu must expose webhook actions');
  assert.match(funnelsSource, /X-Kodety-Signature/, 'the webhook editor must explain signed deliveries');
  assert.match(funnelsSource, /webhookSecretClear/, 'the webhook editor must support explicitly removing a saved secret');

  console.log('Analytics workspace tests passed.');
} finally {
  await server.close();
}
