import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { AgentNativeLifecycle } from '@/lib/html-editor/agent-native-tools';
import { wordpressConfig } from '@/lib/html-editor/editor-wordpress-helpers';
import {
  actOnAgentPanel,
  snapshotAgentPanel,
  type AgentPanelAction,
} from '@/lib/html-editor/agent-panel-tools';
import {
  useHtmlAgentEditorBridgeStore,
  type HtmlAgentToolCallMeta,
} from '@/stores/useHtmlAgentEditorBridgeStore';

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

/** Keep the existing Agent panel contract without booting the Builder bridge. */
export function useWordPressNativePanelAgent(surface: 'settings' | 'analytics' | 'cms', readOnly: boolean, lifecycle: AgentNativeLifecycle = {}) {
  const ownerId = useId();
  const mutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const mutationResultsRef = useRef(new Map<string, unknown>());
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;

  useLayoutEffect(() => {
    const invoke = async (
      tool: string,
      args: Record<string, unknown>,
      meta: HtmlAgentToolCallMeta,
    ) => {
      if (tool === 'kodety_editor_context') {
        return {
          revision: snapshotAgentPanel(surface).revision,
          editor: {
            workspace: surface,
            readOnly,
            nativePanel: {
              required: true,
              surface,
              tools: ['kodety_native_catalog', 'kodety_native_call', 'kodety_localization_snapshot', 'kodety_apply_localization_settings', 'kodety_apply_localization_translations', 'kodety_panel_snapshot', 'kodety_panel_action'],
              directSourceMutationAllowed: false,
            },
          },
          selection: null,
          selectedPaths: [],
        };
      }
      if (['kodety_localization_snapshot', 'kodety_apply_localization_settings', 'kodety_apply_localization_translations'].includes(tool)) {
        const config = wordpressConfig();
        if (!config) throw new Error('A conexão WordPress não está disponível.');
        const { invokeWordPressRemoteLocalization } = await import('./wordpress-agent-localization');
        return invokeWordPressRemoteLocalization(tool, args, config, {
          signal: meta.signal,
          beforeNativeOperation: (operation, context) => lifecycleRef.current.beforeNativeOperation?.(operation, context),
          afterNativeOperation: (operation, result, context) => lifecycleRef.current.afterNativeOperation?.(operation, result, context),
          assertCurrent: mutating => {
            meta.assertCurrent?.();
            const state = useHtmlAgentEditorBridgeStore.getState();
            if (state.ownerId !== ownerId || !state.available) throw new Error('A área do agente mudou. Leia o contexto novamente.');
            if (mutating && state.readOnly) throw new Error('Esta área está em modo somente leitura.');
          },
        });
      }
      if (tool === 'kodety_panel_snapshot') return snapshotAgentPanel(surface, args);
      if (tool !== 'kodety_panel_action') {
        throw new Error(`A área ${surface} deve ser operada pelo painel visual.`);
      }
      if (readOnly) throw new Error('Esta área está em modo somente leitura.');
      if (mutationResultsRef.current.has(meta.callId)) {
        return mutationResultsRef.current.get(meta.callId);
      }
      const run = mutationChainRef.current.then(async () => {
        if (mutationResultsRef.current.has(meta.callId)) return mutationResultsRef.current.get(meta.callId);
        const result = await actOnAgentPanel(surface, {
          expectedRevision: stringValue(args.expectedRevision),
          controlId: stringValue(args.controlId),
          action: stringValue(args.action) as AgentPanelAction['action'],
          ...(typeof args.value === 'string' ? { value: args.value } : {}),
          ...(typeof args.checked === 'boolean' ? { checked: args.checked } : {}),
          ...(args.confirmDestructive === true ? { confirmDestructive: true } : {}),
        });
        mutationResultsRef.current.set(meta.callId, result);
        if (mutationResultsRef.current.size > 100) {
          const oldest = mutationResultsRef.current.keys().next().value;
          if (oldest) mutationResultsRef.current.delete(oldest);
        }
        return result;
      });
      mutationChainRef.current = run.then(() => undefined, () => undefined);
      return run;
    };
    useHtmlAgentEditorBridgeStore.getState().publish(ownerId, {
      readOnly, invoke, ...lifecycle,
      getScope: () => {
        const config = wordpressConfig();
        return JSON.stringify([config?.siteUrl, config?.share?.projectId, config?.projectUrl]);
      },
    });
  });

  useEffect(() => () => {
    useHtmlAgentEditorBridgeStore.getState().resetOwner(ownerId);
  }, [ownerId]);
}
