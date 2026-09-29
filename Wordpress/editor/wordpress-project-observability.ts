import {
  isKodetyOperationId,
  wordpressObservability,
  type KodetyPerformanceSpan,
  type KodetyWordPressObservability,
} from './wordpress-observability';

export const KODETY_WORDPRESS_PROJECT_OBSERVABILITY_GLOBAL =
  '__kodetyWordPressProjectObservability' as const;

export const KODETY_WORDPRESS_PROJECT_PHASES = [
  'project_download_body',
  'project_unzip',
  'project_parse',
  'project_first_canvas_visual_ready',
] as const;

export type KodetyWordPressProjectPhase =
  typeof KODETY_WORDPRESS_PROJECT_PHASES[number];
export type KodetyWordPressProjectPhaseOutcome = 'ok' | 'error' | 'aborted';
export type KodetyWordPressProjectCacheState = 'hit' | 'miss' | 'bypass';

export interface KodetyWordPressProjectPhaseToken {
  readonly phase: KodetyWordPressProjectPhase;
  readonly operationId: string;
}

export interface KodetyWordPressProjectObservabilityBridge {
  /** Start one project-open lifecycle. Invalid/free-form ids are never reused. */
  start(operationId?: string | null): void;
  /**
   * Begin one closed phase. The optional cache state is the only phase payload;
   * URLs, filenames, project/editor ids, headers and raw errors are impossible
   * to pass through this signature.
   */
  begin(
    phase: KodetyWordPressProjectPhase,
    cache?: KodetyWordPressProjectCacheState,
  ): KodetyWordPressProjectPhaseToken | null;
  /** Close a token once with a closed, content-free outcome. */
  finish(
    token: KodetyWordPressProjectPhaseToken | null,
    outcome: KodetyWordPressProjectPhaseOutcome,
  ): void;
}

declare global {
  // Optional and debug-gated: generic import code sees a typed no-op boundary
  // when the WordPress entry has not installed the bridge.
  var __kodetyWordPressProjectObservability:
    KodetyWordPressProjectObservabilityBridge | undefined;
}

interface InternalPhaseToken extends KodetyWordPressProjectPhaseToken {
  readonly epoch: number;
  readonly order: number;
  readonly span: KodetyPerformanceSpan;
}

const PHASE_SET = new Set<string>(KODETY_WORDPRESS_PROJECT_PHASES);
const CACHE_SET = new Set<string>(['hit', 'miss', 'bypass']);
const OUTCOME_SET = new Set<string>(['ok', 'error', 'aborted']);

export function createWordPressProjectObservabilityBridge(
  observability: KodetyWordPressObservability = wordpressObservability(),
): KodetyWordPressProjectObservabilityBridge {
  let epoch = 0;
  let lastStartedOrder = -1;
  let lifecycleOperationId: string | null = null;
  const issuedTokens = new WeakSet<KodetyWordPressProjectPhaseToken>();
  const finishedTokens = new WeakSet<KodetyWordPressProjectPhaseToken>();
  const activeTokens = new Set<InternalPhaseToken>();

  const bridge: KodetyWordPressProjectObservabilityBridge = {
    start(operationId?: string | null) {
      for (const token of activeTokens) {
        finishedTokens.add(token);
        observability.finish(token.span, { result: 'aborted' });
      }
      activeTokens.clear();
      epoch += 1;
      lastStartedOrder = -1;
      lifecycleOperationId = isKodetyOperationId(operationId) ? operationId : null;
    },
    begin(
      phase: KodetyWordPressProjectPhase,
      cache: KodetyWordPressProjectCacheState = 'bypass',
    ) {
      if (!observability.enabled || !PHASE_SET.has(phase)) return null;
      const order = KODETY_WORDPRESS_PROJECT_PHASES.indexOf(phase);
      if (order < lastStartedOrder) return null;
      const safeCache = CACHE_SET.has(cache) ? cache : 'bypass';
      const span = observability.begin(
        phase,
        { cache: safeCache },
        lifecycleOperationId,
      );
      if (!span) return null;
      lifecycleOperationId = span.operationId;
      lastStartedOrder = order;
      const token = Object.freeze({
        phase,
        operationId: span.operationId,
        epoch,
        order,
        span,
      }) as InternalPhaseToken;
      issuedTokens.add(token);
      activeTokens.add(token);
      return token;
    },
    finish(
      token: KodetyWordPressProjectPhaseToken | null,
      outcome: KodetyWordPressProjectPhaseOutcome,
    ) {
      if (
        !token
        || !issuedTokens.has(token)
        || finishedTokens.has(token)
        || !OUTCOME_SET.has(outcome)
      ) return;
      const internal = token as InternalPhaseToken;
      if (internal.epoch !== epoch || internal.phase !== KODETY_WORDPRESS_PROJECT_PHASES[internal.order]) {
        return;
      }
      finishedTokens.add(token);
      activeTokens.delete(internal);
      observability.finish(internal.span, { result: outcome });
    },
  };
  return Object.freeze(bridge);
}

/** Install the content-free bridge consumed by the Builder and project importer. */
export function installWordPressProjectObservabilityBridge(
  observability: KodetyWordPressObservability = wordpressObservability(),
) {
  const bridge = createWordPressProjectObservabilityBridge(observability);
  globalThis.__kodetyWordPressProjectObservability = bridge;
  return bridge;
}

/** Generic code can discover the bridge without importing a WordPress entry. */
export function wordpressProjectObservabilityBridge() {
  return globalThis.__kodetyWordPressProjectObservability || null;
}
