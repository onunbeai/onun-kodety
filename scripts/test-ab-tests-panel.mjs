import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  ssr: { noExternal: ['@gravity-ui/icons'] },
  server: { middlewareMode: true },
});

try {
  const panel = await server.ssrLoadModule('/app/(builder)/kodety/html-editor/components/HtmlAnalyticsAbTests.tsx');
  const projectPanel = await server.ssrLoadModule('/app/(builder)/kodety/html-editor/components/HtmlProjectAnalyticsAbTests.tsx');
  const test = {
    id: 'home-headline',
    name: 'Homepage — headline',
    sourcePagePath: '/',
    goalTrackingId: 'get-started-hero',
    status: 'draft',
    variants: [
      { id: 'control', name: 'Control', pagePath: '/', isControl: true, enabled: true, weight: 10 },
      { id: 'variant-a', name: 'A', pagePath: '/__ab/a', isControl: false, enabled: true, weight: 10 },
      { id: 'variant-b', name: 'B', pagePath: '/__ab/b', isControl: false, enabled: true, weight: 10 },
      { id: 'disabled', name: 'Disabled', pagePath: '/__ab/off', isControl: false, enabled: false, weight: 70 },
    ],
  };

  assert.equal(panel.abTestEnabledWeight(test), 30, 'disabled variants must not count toward traffic allocation');
  assert.match(panel.validateAbTestForStart(test), /100%/);
  assert.deepEqual(
    panel.equalAbVariantWeights(test),
    { control: 33.33, 'variant-a': 33.33, 'variant-b': 33.34 },
    'equal distribution must be deterministic and total exactly 100%',
  );
  assert.equal(
    panel.validateAbTestForStart({
      ...test,
      variants: test.variants.map((variant) => ({
        ...variant,
        weight: panel.equalAbVariantWeights(test)[variant.id] ?? variant.weight,
      })),
    }),
    null,
  );
  assert.match(panel.validateAbTestForStart({ ...test, goalTrackingId: '' }), /ID ou classe/);
  assert.match(
    panel.validateAbTestForStart({
      ...test,
      variants: test.variants.map((variant, index) => ({ ...variant, enabled: index === 0, weight: index === 0 ? 100 : 0 })),
    }),
    /duas variantes/,
  );
  assert.match(
    panel.validateAbTestForStart({
      ...test,
      variants: test.variants.map((variant) => variant.isControl
        ? { ...variant, enabled: false, weight: 0 }
        : variant),
    }),
    /Control ativa/,
    'a test can never start without its active Control',
  );
  const adapted = panel.htmlExperimentToAbTestViewModel({
    id: 'canonical',
    name: 'Canonical experiment',
    pagePath: 'index.html',
    status: 'active',
    goal: { type: 'click', trackingId: 'hero-cta' },
    variants: [
      {
        id: 'control',
        name: 'Control',
        kind: 'control',
        status: 'active',
        weight: 50,
        pagePath: 'index.html',
        sourcePagePath: 'index.html',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
      {
        id: 'dark',
        name: 'Dark',
        kind: 'variant',
        status: 'paused',
        weight: 0,
        pagePath: '.incode/experiments/canonical/dark/project/index.html',
        sourcePagePath: 'index.html',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }, {}, { deployedStatus: 'paused', startedAt: '2026-07-23T01:00:00.000Z' }, [{
    id: 'hero-cta',
    label: 'Hero CTA',
    type: 'click',
    selectorType: 'class',
    selectorValue: 'hero-cta',
    matchCount: 2,
  }]);
  assert.equal(adapted.status, 'running');
  assert.equal(adapted.goalTrackingId, 'hero-cta');
  assert.equal(adapted.goalTargetType, 'class', 'legacy click goals may resolve selector metadata from the target catalog');
  assert.equal(adapted.goalTargetValue, 'hero-cta');
  assert.equal(adapted.variants[0].isControl, true);
  assert.equal(adapted.variants[1].enabled, false);
  assert.equal(adapted.variants[0].metrics, null, 'the canonical adapter must not invent variant metrics');
  assert.equal(adapted.deployedStatus, 'paused', 'the UI must distinguish local draft state from deployed runtime state');

  const explicitGoal = panel.htmlExperimentToAbTestViewModel({
    id: 'selector-goal',
    name: 'Selector goal',
    pagePath: 'index.html',
    status: 'draft',
    goal: {
      type: 'click',
      trackingId: 'class:pricing-card',
      targetType: 'class',
      targetValue: 'pricing-card',
    },
    variants: [],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }, {}, {}, [{
    id: 'pricing-card',
    label: 'Pricing card',
    type: 'click',
    selectorType: 'id',
    selectorValue: 'pricing-card',
  }]);
  assert.equal(explicitGoal.goalTargetType, 'class', 'goal metadata takes precedence over a conflicting catalog entry');
  assert.equal(explicitGoal.goalTargetValue, 'pricing-card');
  assert.equal(explicitGoal.goalTrackingId, 'class:pricing-card');

  const selectorTargets = [
    { id: 'legacy-cta', label: 'CTA legado', type: 'click' },
    { id: 'hero', label: 'Botão Herói', type: 'click', selectorType: 'id', selectorValue: 'hero', matchCount: 1 },
    { id: 'pricing-card', label: 'Cartão de preço', type: 'click', selectorType: 'class', selectorValue: 'pricing-card', matchCount: 3 },
    { id: 'hidden', label: 'Oculto', type: 'click', selectorType: 'class', selectorValue: 'hidden', enabled: false },
    { id: 'custom-event', label: 'Evento', type: 'custom' },
  ];
  assert.deepEqual(
    panel.filterAbGoalTargets(selectorTargets, 'id').map(target => target.id),
    ['hero'],
    'the new selector picker lists real HTML IDs instead of legacy tracking attributes',
  );
  assert.deepEqual(
    panel.filterAbGoalTargets(selectorTargets, 'class', 'preço').map(target => target.id),
    ['pricing-card'],
    'class targets are searchable with accent-insensitive labels',
  );
  assert.deepEqual(
    panel.filterAbGoalTargets(selectorTargets, 'class').map(target => target.id),
    ['pricing-card'],
    'disabled and custom-event targets are excluded',
  );

  const markup = renderToStaticMarkup(React.createElement(panel.HtmlAnalyticsAbTests, {
    tests: [],
    pages: [],
    trackingTargets: [],
  }));
  assert.match(markup, /Crie seu primeiro teste A\/B/);
  assert.doesNotMatch(markup, /[0-9]+(?:\\.[0-9]+)?%.*convers/i, 'empty state must not fabricate conversion metrics');

  // Results verdict: synthesize per-variant metrics into one recommendation.
  const withMetrics = (overrides = {}) => ({
    id: 'headline',
    name: 'Headline',
    sourcePagePath: '/',
    goalTrackingId: 'cta',
    status: 'running',
    deployedStatus: 'running',
    variants: [
      { id: 'control', name: 'Control', slug: 'control', isControl: true, enabled: true, weight: 50, metrics: { views: 1000, conversions: 100, conversionRate: 10, lift: null, confidence: null } },
      { id: 'variant-b', name: 'B', slug: 'home-b', isControl: false, enabled: true, weight: 50, metrics: { views: 1000, conversions: 150, conversionRate: 15, lift: 50, confidence: 98 } },
    ],
    ...overrides,
  });
  const significant = panel.summarizeAbTest(withMetrics());
  assert.equal(significant.verdict, 'significant', 'a confident, well-sampled leader is significant');
  assert.equal(significant.leader.id, 'variant-b', 'the higher conversion rate leads');
  assert.equal(Math.round(significant.uplift), 50, 'uplift is the relative lift over Control');
  assert.equal(significant.totalViews, 2000);
  assert.equal(significant.totalConversions, 250);

  const lowConfidence = panel.summarizeAbTest(withMetrics({
    variants: [
      { id: 'control', name: 'Control', slug: 'control', isControl: true, enabled: true, weight: 50, metrics: { views: 500, conversions: 50, conversionRate: 10, lift: null, confidence: null } },
      { id: 'variant-b', name: 'B', slug: 'home-b', isControl: false, enabled: true, weight: 50, metrics: { views: 500, conversions: 55, conversionRate: 11, lift: 10, confidence: 70 } },
    ],
  }));
  assert.equal(lowConfidence.verdict, 'leading', 'a leader below the confidence threshold only "leads"');

  const tiny = panel.summarizeAbTest(withMetrics({
    variants: [
      { id: 'control', name: 'Control', slug: 'control', isControl: true, enabled: true, weight: 50, metrics: { views: 20, conversions: 2, conversionRate: 10, lift: null, confidence: null } },
      { id: 'variant-b', name: 'B', slug: 'home-b', isControl: false, enabled: true, weight: 50, metrics: { views: 25, conversions: 6, conversionRate: 24, lift: 140, confidence: 99 } },
    ],
  }));
  assert.equal(tiny.verdict, 'insufficient', 'a tiny sample is never declared significant');

  const noData = panel.summarizeAbTest(withMetrics({ variants: [
    { id: 'control', name: 'Control', slug: 'control', isControl: true, enabled: true, weight: 100, metrics: null },
  ] }));
  assert.equal(noData.verdict, 'no-data', 'a test without traffic has no verdict');

  const significantMarkup = renderToStaticMarkup(React.createElement(panel.HtmlAnalyticsAbTests, {
    tests: [withMetrics()],
    selectedId: 'headline',
    pages: [],
    trackingTargets: [{
      id: 'cta',
      label: 'CTA',
      type: 'click',
      selectorType: 'id',
      selectorValue: 'cta',
      matchCount: 1,
    }],
  }));
  assert.match(significantMarkup, /B venceu/, 'the significant verdict headlines the winning variant');
  assert.match(significantMarkup, /Buscar IDs/, 'the selected goal uses the searchable selector picker');
  assert.match(significantMarkup, />Classe</, 'the picker exposes the ID/class toggle');
  assert.match(significantMarkup, /1 elemento/, 'the picker exposes selector match counts');
  assert.doesNotMatch(significantMarkup, /Tracking ID/, 'selector UI no longer exposes legacy Tracking ID terminology');
  assert.match(
    significantMarkup,
    /h-full min-h-0 overflow-y-auto overscroll-contain/,
    'the selected A/B test must own a bounded scroll viewport',
  );

  // A slug edited after the last publish must warn the user to republish so the
  // variant's public URL actually goes live (otherwise /caseb 404s silently).
  const driftedSlug = renderToStaticMarkup(React.createElement(panel.HtmlAnalyticsAbTests, {
    tests: [{
      id: 'headline',
      name: 'Headline',
      sourcePagePath: '/',
      goalTrackingId: 'cta',
      status: 'running',
      deployedStatus: 'running',
      variants: [
        { id: 'control', name: 'Control', slug: 'control', isControl: true, enabled: true, weight: 50 },
        { id: 'variant-b', name: 'B', slug: 'caseb', deployedSlug: 'variant-b', isControl: false, enabled: true, weight: 50 },
      ],
    }],
    selectedId: 'headline',
    pages: [],
    trackingTargets: [],
    siteUrl: 'https://example.test/wordpress/',
  }));
  assert.match(driftedSlug, /Publique para ativar a nova URL da variante/, 'an unpublished slug change must prompt a republish');
  assert.match(
    driftedSlug,
    /href="https:\/\/example\.test\/wordpress\/caseb"/,
    'variant links preserve the WordPress subdirectory',
  );

  const publishedSlug = renderToStaticMarkup(React.createElement(panel.HtmlAnalyticsAbTests, {
    tests: [{
      id: 'headline',
      name: 'Headline',
      sourcePagePath: '/',
      goalTrackingId: 'cta',
      status: 'running',
      deployedStatus: 'running',
      variants: [
        { id: 'control', name: 'Control', slug: 'control', isControl: true, enabled: true, weight: 50 },
        { id: 'variant-b', name: 'B', slug: 'caseb', deployedSlug: 'caseb', isControl: false, enabled: true, weight: 50 },
      ],
    }],
    selectedId: 'headline',
    pages: [],
    trackingTargets: [],
  }));
  assert.doesNotMatch(publishedSlug, /Aguardando publicação|Publique para ativar/, 'a slug matching the deployed value is not pending');

  // The REST API reports a running experiment with the client vocabulary
  // ('active'), so the shared normalizer must map it back to 'running'. Without
  // this a published, running test is stuck reporting "Aguardando publicação".
  assert.equal(panel.normalizeAbTestStatus('active'), 'running', 'a server "active" status must normalize to "running"');
  assert.equal(panel.normalizeAbTestStatus('archived'), 'completed', 'a server "archived" status must normalize to "completed"');
  assert.equal(panel.normalizeAbTestStatus('running'), 'running');
  assert.equal(panel.normalizeAbTestStatus('completed'), 'completed');
  assert.equal(panel.normalizeAbTestStatus('paused'), 'paused');
  assert.equal(panel.normalizeAbTestStatus('draft'), 'draft');
  assert.equal(panel.normalizeAbTestStatus('unknown'), null, 'an unrecognized status must not masquerade as a real status');
  assert.equal(panel.normalizeAbTestStatus(undefined), null);

  const runningTest = {
    id: 'home-headline',
    name: 'Homepage — headline',
    sourcePagePath: '/',
    goalTrackingId: 'hero-cta',
    status: 'running',
    deployedStatus: 'running',
    variants: [
      { id: 'control', name: 'Control', pagePath: '/', isControl: true, enabled: true, weight: 50 },
      { id: 'variant-b', name: 'B', pagePath: '/__ab/b', isControl: false, enabled: true, weight: 50 },
    ],
    startedAt: '2026-07-23T01:00:00.000Z',
  };
  const runningMarkup = renderToStaticMarkup(React.createElement(panel.HtmlAnalyticsAbTests, {
    tests: [runningTest],
    selectedId: runningTest.id,
    pages: [],
    trackingTargets: [],
  }));
  assert.doesNotMatch(
    runningMarkup,
    /Aguardando publicação/,
    'a running test whose deployed status matches must not report a pending publish',
  );

  const source = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlAnalyticsAbTests.tsx'),
    'utf8',
  );
  for (const callback of [
    'onCreateTest',
    'onDuplicateVariant',
    'onToggleVariant',
    'onWeightChange',
    'onStart',
    'onPause',
    'onComplete',
    'onPromoteWinner',
    'onOpenVariant',
  ]) assert.match(source, new RegExp(callback), `${callback} must remain part of the controlled panel contract`);
  assert.match(source, /GoalTargetPicker/);
  assert.doesNotMatch(source, /KODETY_TRACKING_ATTRIBUTE/);
  assert.match(
    source,
    /aria-label="Nome do teste A\/B"[\s\S]*?className="[^"]*\bpx-3\b[^"]*"/,
    'the editable A/B test name must keep horizontal input padding',
  );
  const audienceChoiceGroupSource = source.match(
    /function AudienceChoiceGroup[\s\S]*?\n}\n\nfunction AudienceRuleField/,
  )?.[0] || '';
  assert.match(
    audienceChoiceGroupSource,
    /flex h-fit min-h-11 min-w-0 flex-col/,
    'audience choice cards must size to their content while preserving a touch target',
  );
  assert.doesNotMatch(
    audienceChoiceGroupSource,
    /min-h-16/,
    'audience choices must not force a fixed minimum card height',
  );

  const projectPanelSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectAnalyticsAbTests.tsx'),
    'utf8',
  );
  assert.match(projectPanelSource, /experimentClickGoalTrackingId/);
  assert.match(projectPanelSource, /targetType:\s*resolvedTargetType/);
  assert.match(projectPanelSource, /targetValue:\s*resolvedTargetValue/);

  const analyticsSnapshot = { name: 'Analytics snapshot', files: {} };
  const persistenceOrder = [];
  let acknowledgePersistence;
  const persisted = projectPanel.commitAnalyticsProjectAndFlush(
    analyticsSnapshot,
    project => {
      assert.equal(project, analyticsSnapshot);
      persistenceOrder.push('commit');
    },
    project => {
      assert.equal(project, analyticsSnapshot, 'the persistence callback receives the exact committed snapshot');
      persistenceOrder.push('persist:start');
      return new Promise(resolve => {
        acknowledgePersistence = () => {
          persistenceOrder.push('persist:ack');
          resolve();
        };
      });
    },
  );
  await Promise.resolve();
  assert.deepEqual(
    persistenceOrder,
    ['commit', 'persist:start'],
    'an A/B mutation starts persistence immediately instead of entering the editor debounce',
  );
  acknowledgePersistence();
  assert.equal(
    await persisted,
    analyticsSnapshot,
    'the mutation resolves only after WordPress acknowledges the exact analytics snapshot',
  );
  assert.deepEqual(persistenceOrder, ['commit', 'persist:start', 'persist:ack']);

  console.log('A/B tests panel tests passed.');
} finally {
  await server.close();
}
