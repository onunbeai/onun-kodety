'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalyticsPeriod, AnalyticsTrackingTarget } from '@/lib/html-editor/analytics';
import {
  createExperiment,
  createExperimentVariant,
  deleteExperiment,
  deleteExperimentVariant,
  duplicateExperimentVariant,
  experimentClickGoalTrackingId,
  normalizeExperimentSettings,
  promoteExperimentVariant,
  readExperimentSettings,
  rebalanceExperimentTraffic,
  renameExperiment,
  renameExperimentVariant,
  setExperimentStatus,
  setExperimentVariantSlug,
  setExperimentVariantStatus,
  setExperimentVariantWeight,
  updateExperimentGoal,
  updateExperimentOptions,
  type HtmlExperiment,
} from '@/lib/html-editor/experiments';
import type { HtmlProject } from '@/lib/html-editor/types';
import { withRequestTimeout } from '@/lib/request-timeout';
import {
  HtmlAnalyticsAbTests,
  htmlExperimentToAbTestViewModel,
  normalizeAbTestStatus,
  type HtmlAbTestCreateInput,
  type HtmlAbTestRuntimeState,
  type HtmlAbTestViewModel,
  type HtmlAbVariantMetrics,
} from './HtmlAnalyticsAbTests';
import type { AnalyticsPageOption } from './HtmlAnalyticsFunnels';
import {
  AnalyticsPlanBanner,
  useAnalyticsFeatureAccess,
  type AnalyticsFeatureAccess,
} from './HtmlAnalyticsUi';

const ANALYTICS_EXPERIMENT_REQUEST_TIMEOUT_MS = 20_000;

interface ServerExperimentResult {
  variantId?: unknown;
  views?: unknown;
  conversions?: unknown;
  conversionRate?: unknown;
  lift?: unknown;
  confidence?: unknown;
}

interface ServerExperiment {
  databaseId?: unknown;
  id?: unknown;
  results?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  status?: unknown;
  variants?: unknown;
}

export interface HtmlProjectAnalyticsAbTestsProps {
  readOnly?: boolean;
  project: HtmlProject;
  pages: AnalyticsPageOption[];
  trackingTargets: AnalyticsTrackingTarget[];
  getProject?: () => HtmlProject;
  onCommit: (project: HtmlProject) => void;
  /**
   * Persist this exact analytics snapshot and resolve only after the native
   * WordPress workspace acknowledges it. A/B mutations cannot rely on the
   * editor-wide debounce because this panel lives on a separate route: a
   * refresh/back navigation could otherwise discard `analytics` before the
   * next publish package is assembled.
   */
  onFlush?: (project: HtmlProject) => Promise<void>;
  editorUrl: string;
  /** Public WordPress root, including a possible subdirectory. */
  siteUrl?: string;
  experimentsUrl?: string;
  experimentItemUrl?: string;
  nonce?: string;
  analyticsPeriod?: AnalyticsPeriod;
  analyticsRefreshKey?: number;
  featureAccess?: AnalyticsFeatureAccess;
}

function numericMetric(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function nonNegativeMetric(value: unknown): number | null {
  const numeric = numericMetric(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function boundedPercentMetric(value: unknown): number | null {
  const numeric = numericMetric(value);
  return numeric === null ? null : Math.max(0, Math.min(100, numeric));
}

function runtimeState(experiment?: ServerExperiment): HtmlAbTestRuntimeState {
  const startedAt = typeof experiment?.startedAt === 'string' && experiment.startedAt.trim()
    ? experiment.startedAt
    : null;
  const completedAt = typeof experiment?.endedAt === 'string' && experiment.endedAt.trim()
    ? experiment.endedAt
    : null;
  // The REST API serializes status in the client vocabulary ('active' for a
  // running experiment, 'archived' for a completed one). Normalize it to the
  // same vocabulary the local experiment model uses so publish reconciliation
  // (deployedStatus === status) actually matches — otherwise a running,
  // published test is stuck reporting "Aguardando publicação" forever.
  const deployedStatus = normalizeAbTestStatus(experiment?.status);
  // Capture the slug each variant is actually published under, so the editor can
  // flag a slug that was changed locally but not re-published (its public URL
  // would still 404 or point at the old value).
  const deployedVariantSlugs: Record<string, string> = {};
  if (Array.isArray(experiment?.variants)) {
    for (const variant of experiment.variants) {
      if (!variant || typeof variant !== 'object') continue;
      const id = (variant as { id?: unknown }).id;
      const slug = (variant as { slug?: unknown }).slug;
      if (typeof id === 'string' && id && typeof slug === 'string' && slug) deployedVariantSlugs[id] = slug;
    }
  }
  return { startedAt, completedAt, deployedStatus, deployedVariantSlugs };
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + .3275911 * x);
  const erf = sign * (1 - (
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592)
    * t * Math.exp(-x * x)
  ));
  return .5 * (1 + erf);
}

function confidenceAgainstControl(
  views: number | null,
  conversions: number | null,
  controlViews: number | null,
  controlConversions: number | null,
) {
  if (
    views === null
    || conversions === null
    || controlViews === null
    || controlConversions === null
    || views <= 0
    || controlViews <= 0
  ) return null;
  const rate = conversions / views;
  const controlRate = controlConversions / controlViews;
  const pooled = (conversions + controlConversions) / (views + controlViews);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / views + 1 / controlViews));
  if (!Number.isFinite(standardError) || standardError <= 0) return null;
  const z = Math.abs(rate - controlRate) / standardError;
  return Math.max(0, Math.min(100, (2 * normalCdf(z) - 1) * 100));
}

function experimentItemUrl(template: string, databaseId: string) {
  const encoded = encodeURIComponent(databaseId);
  if (template.includes('{id}')) return template.replaceAll('{id}', encoded);
  const url = new URL(template, window.location.href);
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute) url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}/${encoded}`);
  else url.pathname = `${url.pathname.replace(/\/$/, '')}/${encoded}`;
  return url.toString();
}

function experimentMetricsUrl(
  template: string,
  databaseId: string,
  period?: AnalyticsPeriod,
) {
  const url = new URL(experimentItemUrl(template, databaseId), window.location.href);
  if (period) {
    url.searchParams.set('preset', period.preset);
    url.searchParams.set('from', period.from);
    url.searchParams.set('to', period.to);
    if (period.timezone) url.searchParams.set('timezone', period.timezone);
  }
  return url.toString();
}

function serverMetrics(experiment: ServerExperiment) {
  const results = Array.isArray(experiment.results)
    ? experiment.results.filter((result): result is ServerExperimentResult => Boolean(result && typeof result === 'object'))
    : [];
  const control = results.find(result => Boolean((result as ServerExperimentResult & { isControl?: unknown }).isControl));
  const controlViews = nonNegativeMetric(control?.views);
  const controlConversions = nonNegativeMetric(control?.conversions);
  return Object.fromEntries(results.flatMap(result => {
    const variantId = typeof result.variantId === 'string' ? result.variantId.trim() : '';
    if (!variantId) return [];
    const views = nonNegativeMetric(result.views);
    const conversions = nonNegativeMetric(result.conversions);
    const suppliedConfidence = boundedPercentMetric(result.confidence);
    const metrics: HtmlAbVariantMetrics = {
      views,
      conversions,
      conversionRate: nonNegativeMetric(result.conversionRate),
      lift: numericMetric(result.lift),
      confidence: suppliedConfidence ?? confidenceAgainstControl(
        views,
        conversions,
        controlViews,
        controlConversions,
      ),
    };
    return [[variantId, metrics] as const];
  }));
}

function requireSingleActiveControl(project: HtmlProject, experimentId: string) {
  const experiment = readExperimentSettings(project).experiments
    .find(candidate => candidate.id === experimentId);
  if (!experiment) throw new Error('O teste A/B não foi encontrado.');
  const activeControls = experiment.variants.filter(
    variant => variant.kind === 'control' && variant.status === 'active',
  );
  if (activeControls.length !== 1) {
    throw new Error('Mantenha exatamente uma variante Control ativa antes de iniciar o teste.');
  }
  return project;
}

export async function commitAnalyticsProjectAndFlush(
  project: HtmlProject,
  onCommit: (project: HtmlProject) => void,
  onFlush?: (project: HtmlProject) => Promise<void>,
) {
  onCommit(project);
  await onFlush?.(project);
  return project;
}

/**
 * Binds the generic A/B workspace to the canonical HTML project. Project
 * metadata remains the authoring source of truth; WordPress only executes and
 * reports the last published configuration.
 */
export function HtmlProjectAnalyticsAbTests({
  readOnly = false,
  project,
  pages,
  trackingTargets,
  getProject,
  onCommit,
  onFlush,
  editorUrl,
  siteUrl,
  experimentsUrl,
  experimentItemUrl: itemUrlTemplate,
  nonce,
  analyticsPeriod,
  analyticsRefreshKey = 0,
  featureAccess: featureAccessOverride,
}: HtmlProjectAnalyticsAbTestsProps) {
  const featureAccess = useAnalyticsFeatureAccess(featureAccessOverride);
  const activationLocked = !featureAccess.abTests;
  const projectExperiments = useMemo(
    () => readExperimentSettings(project).experiments,
    [project],
  );
  const [serverExperiments, setServerExperiments] = useState<HtmlExperiment[]>([]);
  const experiments = readOnly && projectExperiments.length === 0
    ? serverExperiments
    : projectExperiments;
  const projectExperimentKey = projectExperiments.map(experiment => experiment.id).join('|');
  const [selectedId, setSelectedId] = useState<string | null>(experiments[0]?.id || null);
  const [saving, setSaving] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, Record<string, HtmlAbVariantMetrics>>>({});
  const [runtime, setRuntime] = useState<Record<string, HtmlAbTestRuntimeState>>({});
  const currentProject = useCallback(() => getProject?.() || project, [getProject, project]);

  useEffect(() => {
    if (selectedId && experiments.some(experiment => experiment.id === selectedId)) return;
    setSelectedId(experiments[0]?.id || null);
  }, [experiments, selectedId]);

  const loadMetrics = useCallback(async () => {
    if (activationLocked) {
      setServerExperiments([]);
      setMetrics({});
      setRuntime({});
      setLoadingMetrics(false);
      setError(null);
      return;
    }
    if (!experimentsUrl || !itemUrlTemplate) {
      setMetrics({});
      setRuntime({});
      return;
    }
    const headers = new Headers({ Accept: 'application/json' });
    if (nonce) headers.set('X-WP-Nonce', nonce);
    setLoadingMetrics(true);
    setError(null);
    try {
      const { response, payload } = await withRequestTimeout(async signal => {
        const nextResponse = await fetch(experimentsUrl, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers,
          signal,
        });
        return {
          response: nextResponse,
          payload: await nextResponse.json().catch(() => null),
        };
      }, {
        timeoutMs: ANALYTICS_EXPERIMENT_REQUEST_TIMEOUT_MS,
        timeoutMessage: 'A lista de testes A/B demorou demais para responder.',
      });
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && 'message' in payload
            ? String((payload as { message?: unknown }).message)
            : 'Não foi possível carregar os resultados dos testes.',
        );
      }
      const rows = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as { experiments?: unknown }).experiments)
          ? (payload as { experiments: unknown[] }).experiments
          : [];
      const fetchedExperiments = normalizeExperimentSettings({
        version: 3,
        experiments: rows,
      }).experiments;
      if (readOnly && projectExperiments.length === 0) {
        setServerExperiments(fetchedExperiments);
      }
      const metricExperiments = projectExperiments.length > 0
        ? projectExperiments
        : fetchedExperiments;
      const byExternalId = new Map<string, ServerExperiment>();
      rows.forEach(row => {
        if (!row || typeof row !== 'object') return;
        const candidate = row as ServerExperiment;
        if (typeof candidate.id === 'string') byExternalId.set(candidate.id, candidate);
      });
      const selectedExperiment = metricExperiments.find(experiment => experiment.id === selectedId)
        || metricExperiments[0];
      const detailExperiments = selectedExperiment ? [selectedExperiment] : [];
      const settled = await Promise.allSettled(detailExperiments.map(async experiment => {
        const server = byExternalId.get(experiment.id);
        const databaseId = typeof server?.databaseId === 'string' ? server.databaseId : '';
        if (!databaseId) {
          return {
            experimentId: experiment.id,
            metrics: {},
            runtime: runtimeState(server),
          };
        }
        const { detailResponse, detail } = await withRequestTimeout(async signal => {
          const nextResponse = await fetch(experimentMetricsUrl(
            itemUrlTemplate,
            databaseId,
            analyticsPeriod,
          ), {
            credentials: 'same-origin',
            cache: 'no-store',
            headers,
            signal,
          });
          return {
            detailResponse: nextResponse,
            detail: await nextResponse.json().catch(() => null),
          };
        }, {
          timeoutMs: ANALYTICS_EXPERIMENT_REQUEST_TIMEOUT_MS,
          timeoutMessage: `${experiment.name} demorou demais para responder.`,
        });
        if (!detailResponse.ok || !detail || typeof detail !== 'object') {
          const message = detail && typeof detail === 'object' && 'message' in detail
            ? String((detail as { message?: unknown }).message)
            : `HTTP ${detailResponse.status}`;
          throw new Error(`${experiment.name}: ${message}`);
        }
        return {
          experimentId: experiment.id,
          metrics: serverMetrics(detail as ServerExperiment),
          runtime: runtimeState(detail as ServerExperiment),
        };
      }));
      const nextMetrics: Record<string, Record<string, HtmlAbVariantMetrics>> = {};
      const nextRuntime: Record<string, HtmlAbTestRuntimeState> = Object.fromEntries(
        metricExperiments.map(experiment => [
          experiment.id,
          runtimeState(byExternalId.get(experiment.id)),
        ]),
      );
      const failures: string[] = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          nextMetrics[result.value.experimentId] = result.value.metrics;
          nextRuntime[result.value.experimentId] = result.value.runtime;
          return;
        }
        const experiment = detailExperiments[index];
        failures.push(
          result.reason instanceof Error
            ? result.reason.message
            : experiment?.name || 'Teste sem identificação',
        );
      });
      setMetrics(current => ({ ...current, ...nextMetrics }));
      setRuntime(current => ({ ...current, ...nextRuntime }));
      if (failures.length) {
        setError(
          `Métricas carregadas parcialmente. ${failures.length} teste(s) falharam: ${failures.join('; ')}`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os resultados dos testes.');
    } finally {
      setLoadingMetrics(false);
    }
  }, [
    analyticsPeriod?.from,
    analyticsPeriod?.preset,
    analyticsPeriod?.timezone,
    analyticsPeriod?.to,
    activationLocked,
    projectExperimentKey,
    projectExperiments,
    experimentsUrl,
    itemUrlTemplate,
    nonce,
    readOnly,
    selectedId,
  ]);

  useEffect(() => {
    void loadMetrics();
  }, [analyticsRefreshKey, loadMetrics]);

  const tests = useMemo(
    () => experiments.map(experiment => htmlExperimentToAbTestViewModel(
      experiment,
      activationLocked ? {} : metrics[experiment.id] || {},
      activationLocked ? {} : runtime[experiment.id] || {},
      trackingTargets,
    )),
    [activationLocked, experiments, metrics, runtime, trackingTargets],
  );

  const mutate = useCallback(async (operation: (source: HtmlProject) => HtmlProject) => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      await commitAnalyticsProjectAndFlush(
        operation(currentProject()),
        onCommit,
        onFlush,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o teste A/B.');
    } finally {
      setSaving(false);
    }
  }, [currentProject, onCommit, onFlush, readOnly]);

  const createTest = useCallback(async (input: HtmlAbTestCreateInput): Promise<HtmlAbTestViewModel> => {
    if (readOnly) throw new Error('Este link está em modo somente leitura.');
    setSaving(true);
    setError(null);
    try {
      const created = createExperiment(currentProject(), {
        name: input.name,
        pagePath: input.sourcePagePath,
        goal: {
          type: 'click',
          targetType: input.goalTargetType,
          targetValue: input.goalTargetValue,
          trackingId: experimentClickGoalTrackingId(input.goalTargetType, input.goalTargetValue),
        },
      });
      const withVariant = createExperimentVariant(created.project, created.experiment.id, {
        sourceVariantId: 'control',
        name: 'Variant B',
      });
      await commitAnalyticsProjectAndFlush(withVariant.project, onCommit, onFlush);
      const experiment = readExperimentSettings(withVariant.project).experiments
        .find(candidate => candidate.id === created.experiment.id);
      if (!experiment) throw new Error('O teste foi criado sem metadados válidos.');
      return htmlExperimentToAbTestViewModel(experiment, {}, {}, trackingTargets);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Não foi possível criar o teste A/B.';
      setError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  }, [currentProject, onCommit, onFlush, readOnly, trackingTargets]);

  const openVariant = useCallback(async (
    test: HtmlAbTestViewModel,
    variant: HtmlAbTestViewModel['variants'][number],
  ) => {
    setSaving(true);
    setError(null);
    try {
      if (!readOnly) await onFlush?.(currentProject());
      const url = new URL(editorUrl, window.location.href);
      url.searchParams.set('kodety_html', variant.pagePath);
      url.searchParams.set('kodety_experiment', test.id);
      url.searchParams.set('kodety_variant', variant.id);
      window.location.href = url.toString();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível abrir a variante.');
      setSaving(false);
    }
  }, [currentProject, editorUrl, onFlush, readOnly]);

  return (
    <div data-kodety-ab-activation-locked={activationLocked ? 'true' : undefined} className="flex h-full min-h-0 flex-col">
      {activationLocked ? (
        <div className="shrink-0 px-4 pt-4 sm:px-6">
          <AnalyticsPlanBanner
            access={featureAccess}
            compact
            showWhenLicensed
            title="Testes A/B no plano Pro"
            description="Você pode preparar testes e variantes como rascunho. Iniciar, retomar e consultar resultados exige uma licença Pro ativa."
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
      <HtmlAnalyticsAbTests
      tests={tests}
      pages={pages}
      trackingTargets={trackingTargets}
      siteUrl={siteUrl}
      selectedId={selectedId}
      loading={activationLocked ? false : loadingMetrics}
      saving={saving}
      error={error}
      onSelectedIdChange={setSelectedId}
      onRefresh={activationLocked ? undefined : loadMetrics}
      onCreateTest={readOnly ? undefined : createTest}
      onDeleteTest={readOnly ? undefined : id => mutate(source => deleteExperiment(source, id))}
      onRenameTest={readOnly ? undefined : (id, name) => mutate(source => renameExperiment(source, id, name))}
      onGoalChange={readOnly ? undefined : (id, trackingId, targetType, targetValue) => mutate(source => {
        const encodedTarget = /^(id|class):(.+)$/.exec(trackingId);
        const resolvedTargetType = targetType
          || (encodedTarget?.[1] === 'class' ? 'class' : 'id');
        const resolvedTargetValue = targetValue?.trim()
          || encodedTarget?.[2]?.trim()
          || trackingId.trim();
        return updateExperimentGoal(source, id, {
          type: 'click',
          targetType: resolvedTargetType,
          targetValue: resolvedTargetValue,
          trackingId: experimentClickGoalTrackingId(resolvedTargetType, resolvedTargetValue),
        });
      })}
      onOptionsChange={readOnly ? undefined : (id, options) => mutate(
        source => updateExperimentOptions(source, id, options),
      )}
      onCreateVariant={readOnly ? undefined : (id, sourceVariantId) => mutate(
        source => createExperimentVariant(source, id, { sourceVariantId }).project,
      )}
      onDuplicateVariant={readOnly ? undefined : (id, variantId) => mutate(
        source => duplicateExperimentVariant(source, id, variantId).project,
      )}
      onRemoveVariant={readOnly ? undefined : (id, variantId) => mutate(
        source => deleteExperimentVariant(source, id, variantId),
      )}
      onRenameVariant={readOnly ? undefined : (id, variantId, name) => mutate(
        source => renameExperimentVariant(source, id, variantId, name),
      )}
      onVariantSlugChange={readOnly ? undefined : (id, variantId, slug) => mutate(
        source => setExperimentVariantSlug(source, id, variantId, slug),
      )}
      onToggleVariant={readOnly || activationLocked ? undefined : (id, variantId, enabled) => mutate(source => {
        const experiment = readExperimentSettings(source).experiments
          .find(candidate => candidate.id === id);
        const variant = experiment?.variants.find(candidate => candidate.id === variantId);
        if (variant?.kind === 'control' && !enabled) {
          throw new Error('A variante Control deve permanecer ativa.');
        }
        return setExperimentVariantStatus(source, id, variantId, enabled ? 'active' : 'paused');
      })}
      onWeightChange={readOnly ? undefined : (id, variantId, weight) => mutate(
        source => setExperimentVariantWeight(source, id, variantId, weight),
      )}
      onEqualizeWeights={readOnly ? undefined : id => mutate(source => rebalanceExperimentTraffic(source, id))}
      onStart={readOnly || activationLocked ? undefined : id => mutate(source => setExperimentStatus(
        requireSingleActiveControl(source, id),
        id,
        'active',
      ))}
      onPause={readOnly ? undefined : id => mutate(source => setExperimentStatus(source, id, 'paused'))}
      onResume={readOnly || activationLocked ? undefined : id => mutate(source => setExperimentStatus(
        requireSingleActiveControl(source, id),
        id,
        'active',
      ))}
      onComplete={readOnly ? undefined : id => mutate(source => setExperimentStatus(source, id, 'archived'))}
      onPromoteWinner={readOnly || activationLocked ? undefined : (id, variantId) => mutate(source => {
        const result = promoteExperimentVariant(source, id, variantId);
        if (result.conflicts.length) {
          throw new Error(
            `A página Control mudou em ${result.conflicts.length} arquivo(s). Revise antes de promover a variante.`,
          );
        }
        return setExperimentStatus(result.project, id, 'archived');
      })}
      onOpenVariant={(test, variant) => { void openVariant(test, variant); }}
    />
      </div>
    </div>
  );
}
