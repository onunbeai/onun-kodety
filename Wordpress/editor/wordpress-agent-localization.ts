import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import type { AgentNativeLifecycle, AgentNativeLifecycleContext, AgentNativeOperation } from '@/lib/html-editor/agent-native-tools';
import { withRequestTimeout } from '@/lib/request-timeout';
import {
  applyAgentLocalizationChanges, applyAgentLocalizationSettings, snapshotAgentLocalization,
  type AgentLocalizationChange, type AgentLocalizationSettingsArgs,
} from '@/lib/html-editor/agent-localization-tools';
import { defaultLocalization, ensureProjectLocalizationIds, normalizeLocalization } from '@/lib/html-editor/localization';
import { loadFullWordPressProject, persistWordPressProjectSurface } from './wordpress-project-surface';

/** Loaded only when a semantic language tool is used outside the Languages or
 * Design routes. It uses the same project revisions and native persistence. */
export async function invokeWordPressRemoteLocalization(
  tool: string,
  args: Record<string, unknown>,
  config: KodetyWordPressConfig,
  lifecycle: AgentNativeLifecycle & { assertCurrent: (mutating: boolean) => void; signal?: AbortSignal; timeoutMs?: number },
) {
  const mutating = tool !== 'kodety_localization_snapshot';
  if (mutating && !config.localizationSaveUrl) {
    throw Object.assign(new Error('Install and activate the Multi-language extension'), { code: 'kodety_localization_unavailable' });
  }
  const operation: AgentNativeOperation = {
    name: mutating ? 'localization_update' : 'localization_get',
    description: 'Semantic localization', method: mutating ? 'POST' : 'GET',
    route: '/kodety/v1/project/localization', inputSchema: {},
    readOnly: !mutating, destructive: args.action === 'remove', affectsWorkspace: mutating,
  };
  const contextFor = (signal: AbortSignal): AgentNativeLifecycleContext => ({
    signal,
    assertCurrent: () => { signal.throwIfAborted(); lifecycle.assertCurrent(mutating); },
  });
  lifecycle.assertCurrent(mutating);
  await withRequestTimeout(async signal => lifecycle.beforeNativeOperation?.(operation, contextFor(signal)), {
    signal: lifecycle.signal, timeoutMs: lifecycle.timeoutMs || 60_000,
    timeoutMessage: 'O salvamento pendente demorou demais. Leia o estado atual antes de continuar.',
  });
  const snapshot = await loadFullWordPressProject(config, lifecycle.signal);
  lifecycle.signal?.throwIfAborted();
  lifecycle.assertCurrent(mutating);
  const { readEditorMetadata, updateEditorMetadata } = await import('@/lib/html-editor/project-io');
  lifecycle.signal?.throwIfAborted();
  lifecycle.assertCurrent(mutating);
  const metadata = readEditorMetadata(snapshot.project);
  const settings = normalizeLocalization(metadata.localization || defaultLocalization(metadata.siteSettings?.language || 'pt-BR'));
  if (!mutating) return snapshotAgentLocalization(snapshot.project, settings, String(snapshot.workspaceRevision), args);
  if (String(args.expectedRevision) !== String(snapshot.workspaceRevision)) {
    throw Object.assign(new Error(`Conflito de revisão: a localização mudou para ${snapshot.workspaceRevision}. Leia o catálogo novamente.`), { retryable: true, status: 409 });
  }
  const result = tool === 'kodety_apply_localization_settings'
    ? applyAgentLocalizationSettings(settings, args as unknown as AgentLocalizationSettingsArgs)
    : applyAgentLocalizationChanges(snapshot.project, settings, typeof args.localeCode === 'string' ? args.localeCode : '',
      (Array.isArray(args.translations) ? args.translations : []) as AgentLocalizationChange[], args.overwrite === true);
  const changed = 'changed' in result ? result.changed : result.applied > 0;
  if (!changed) return { ...result, settings: undefined, revision: String(snapshot.workspaceRevision) };
  const nextProject = updateEditorMetadata(ensureProjectLocalizationIds(snapshot.project), current => ({ ...current, localization: result.settings }));
  lifecycle.assertCurrent(true);
  const saved = await withRequestTimeout(async signal => {
    contextFor(signal).assertCurrent();
    return persistWordPressProjectSurface(config, snapshot, nextProject, { surface: 'settings', allowArchiveFallback: true, signal });
  }, { signal: lifecycle.signal, timeoutMs: lifecycle.timeoutMs || 60_000, timeoutMessage: 'A operação nativa demorou demais para responder.' })
    .catch(cause => {
      if (cause instanceof TypeError || (cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name))) {
        throw Object.assign(new Error('O resultado da alteração não foi confirmado; ela pode ter sido salva. Consulte o recurso antes de tentar novamente.', { cause }), {
          code: 'KODETY_NATIVE_WRITE_UNCERTAIN', retryable: false,
        });
      }
      throw cause;
    });
  const output = { ...result, settings: undefined, revision: String(saved.workspaceRevision), workspaceRevision: saved.workspaceRevision };
  try {
    lifecycle.assertCurrent(true);
    await withRequestTimeout(async signal => lifecycle.afterNativeOperation?.(operation, output, contextFor(signal)), {
      signal: lifecycle.signal, timeoutMs: lifecycle.timeoutMs || 60_000,
      timeoutMessage: 'A alteração foi salva, mas a visualização demorou demais para atualizar.',
    });
  } catch (cause) {
    return { ...output, committed: true, refreshError: cause instanceof Error ? cause.message : 'A visualização precisa ser atualizada.',
      refreshDetails: cause && typeof cause === 'object' && 'data' in cause ? cause.data : undefined };
  }
  return output;
}
