export type WordPressPublishPayload = {
  release?: string;
  message?: string;
  cssDigest?: string;
  workspaceRevision?: number;
  publicationComplete?: boolean;
  releaseOnline?: boolean;
  syncPending?: boolean;
  warnings?: unknown;
  replayed?: boolean;
  code?: string;
  data?: { currentRevision?: number };
};

export type WordPressPublicationState = {
  complete: boolean;
  releaseOnline: boolean;
  warnings: string[];
};

/**
 * Newer WordPress runtimes can return HTTP 202 after activating a release when
 * native Media/Page reconciliation still needs an idempotent retry. Older
 * runtimes omit these fields and keep their original completed-publish contract.
 */
export function resolveWordPressPublicationState(
  payload: WordPressPublishPayload,
): WordPressPublicationState {
  const warnings = Array.isArray(payload.warnings)
    ? Array.from(new Set(
        payload.warnings
          .filter((warning): warning is string => typeof warning === 'string')
          .map(warning => warning.trim())
          .filter(Boolean),
      ))
    : [];
  const complete = payload.syncPending !== true && payload.publicationComplete !== false;
  const releaseOnline = payload.releaseOnline === true
    || (payload.releaseOnline !== false && typeof payload.release === 'string' && payload.release.trim() !== '');
  return { complete, releaseOnline, warnings };
}
