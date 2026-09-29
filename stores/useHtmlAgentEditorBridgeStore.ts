import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AgentNativeLifecycle } from '@/lib/html-editor/agent-native-tools';

export interface HtmlAgentToolCallMeta {
  requestId: string;
  callId: string;
  threadId: string;
  turnId: string;
  signal?: AbortSignal;
  assertCurrent?: () => void;
}

export interface HtmlAgentActivityTarget {
  pagePath: string;
  path: string;
}

export interface HtmlAgentTurnActivity {
  id: string;
  label: string;
  startedAt: number;
}

export interface HtmlAgentEditorBridge extends AgentNativeLifecycle {
  readOnly?: boolean;
  getScope?: () => string;
  invoke: (
    tool: string,
    args: Record<string, unknown>,
    meta: HtmlAgentToolCallMeta,
  ) => unknown | Promise<unknown>;
}

interface HtmlAgentEditorBridgeState {
  ownerId: string;
  available: boolean;
  readOnly: boolean;
  activityTargets: HtmlAgentActivityTarget[];
  turnActivity: HtmlAgentTurnActivity | null;
  markActivity: (targets: HtmlAgentActivityTarget[]) => void;
  clearActivity: () => void;
  startTurnActivity: (id: string, label?: string) => void;
  updateTurnActivity: (label: string) => void;
  finishTurnActivity: (id?: string) => void;
  publish: (ownerId: string, bridge: HtmlAgentEditorBridge) => void;
  resetOwner: (ownerId: string) => void;
}

interface HtmlAgentEditorBridgeRuntime {
  activeOwnerId: string;
  activeBridge: HtmlAgentEditorBridge | null;
  store?: UseBoundStore<StoreApi<HtmlAgentEditorBridgeState>>;
  invocationChain?: Promise<void>;
  nativeController?: AbortController;
  invocations?: Map<string, { fingerprint: string; result: Promise<unknown> }>;
}

type HtmlAgentEditorBridgeRuntimeHost = {
  __kodetyHtmlAgentEditorBridgeRuntimeV1?: HtmlAgentEditorBridgeRuntime;
};

// The private Localization extension and its Agent panel can be evaluated from
// independently authenticated module URLs. Keep the callback and Zustand store
// on `window` so both module graphs always publish/read the same live bridge.
// During SSR use an ephemeral host to avoid sharing editor callbacks between
// requests.
const bridgeRuntimeHost = (
  typeof window === 'undefined' ? {} : window
) as HtmlAgentEditorBridgeRuntimeHost;
const bridgeRuntime: HtmlAgentEditorBridgeRuntime = bridgeRuntimeHost.__kodetyHtmlAgentEditorBridgeRuntimeV1 || {
  activeOwnerId: '',
  activeBridge: null,
};
bridgeRuntimeHost.__kodetyHtmlAgentEditorBridgeRuntimeV1 = bridgeRuntime;

/**
 * Execute against the editor that currently owns the Builder surface. The
 * bridge object itself deliberately stays outside Zustand: callbacks may read
 * large project refs and must never turn the virtual project into a second
 * reactive source of truth.
 */
export async function invokeHtmlAgentEditorTool(
  tool: string,
  args: Record<string, unknown>,
  meta: HtmlAgentToolCallMeta,
) {
  if (!bridgeRuntime.activeBridge) throw new Error('O editor Kodety não está disponível para o agente.');
  const ownerId = bridgeRuntime.activeOwnerId;
  const scope = bridgeRuntime.activeBridge.getScope?.() || '';
  const session = typeof window === 'undefined' ? '' : (window as Window & { kodetyEditorSession?: string }).kodetyEditorSession || '';
  const key = JSON.stringify([ownerId, scope, session, meta.threadId, meta.turnId, meta.callId || meta.requestId]);
  const fingerprint = JSON.stringify([tool, args]);
  const invocations = bridgeRuntime.invocations || (bridgeRuntime.invocations = new Map());
  const existing = invocations.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error('A identificação da chamada já pertence a outra operação.');
    return existing.result;
  }
  const assertCurrent = () => {
    if (bridgeRuntime.activeOwnerId !== ownerId || !bridgeRuntime.activeBridge
      || (bridgeRuntime.activeBridge.getScope?.() || '') !== scope
      || (typeof window === 'undefined' ? '' : (window as Window & { kodetyEditorSession?: string }).kodetyEditorSession || '') !== session) {
      throw new Error('A área do agente mudou. Leia o contexto atual antes de continuar.');
    }
  };
  // Queue every call, including reads. A read following a write must see its
  // acknowledgement, and repeated delivery must join the in-flight promise.
  const result = (bridgeRuntime.invocationChain || Promise.resolve()).then(async () => {
    assertCurrent();
    const bridge = bridgeRuntime.activeBridge!;
    if (tool === 'kodety_native_catalog' || tool === 'kodety_native_call') {
      const [{ invokeAgentNativeTool }, { wordpressConfig }] = await Promise.all([
        import('@/lib/html-editor/agent-native-tools'),
        import('@/lib/html-editor/editor-wordpress-helpers'),
      ]);
      assertCurrent();
      const config = wordpressConfig();
      if (!config) throw new Error('As operações nativas exigem uma conexão WordPress.');
      const controller = new AbortController();
      bridgeRuntime.nativeController = controller;
      return invokeAgentNativeTool(tool, args, {
        config, assertCurrent,
        signal: controller.signal,
        readOnly: () => bridgeRuntime.activeBridge?.readOnly === true,
        beforeNativeOperation: (operation, context) => bridgeRuntime.activeBridge?.beforeNativeOperation?.(operation, context),
        afterNativeOperation: (operation, output, context) => bridgeRuntime.activeBridge?.afterNativeOperation?.(operation, output, context),
      }).finally(() => {
        if (bridgeRuntime.nativeController === controller) bridgeRuntime.nativeController = undefined;
      });
    }
    const controller = new AbortController();
    bridgeRuntime.nativeController = controller;
    let output: unknown;
    try {
      output = await bridge.invoke(tool, args, {
        ...meta, signal: controller.signal,
        assertCurrent: () => { controller.signal.throwIfAborted(); assertCurrent(); },
      });
    } finally {
      if (bridgeRuntime.nativeController === controller) bridgeRuntime.nativeController = undefined;
    }
    if (tool !== 'kodety_editor_context' || !output || typeof output !== 'object') return output;
    const { wordpressConfig } = await import('@/lib/html-editor/editor-wordpress-helpers');
    if (!wordpressConfig()) return output;
    const context = output as Record<string, unknown>;
    const editor = context.editor as Record<string, unknown> | undefined;
    const panel = editor?.nativePanel as Record<string, unknown> | undefined;
    const tools = ['kodety_native_catalog', 'kodety_native_call'];
    return {
      ...context,
      nativeOperations: { tools, workspaceRequired: false, discoveryRequired: true },
      editor: { ...editor, ...(panel ? { nativePanel: { ...panel, tools: [...new Set([...(Array.isArray(panel.tools) ? panel.tools : []), ...tools])] } } : {}) },
    };
  });
  bridgeRuntime.invocationChain = result.then(() => undefined, () => undefined);
  invocations.set(key, { fingerprint, result });
  if (invocations.size > 200) {
    const oldest = invocations.keys().next().value;
    if (oldest) void result.finally(() => invocations.delete(oldest)).catch(() => undefined);
  }
  return result;
}

const createHtmlAgentEditorBridgeStore = () => create<HtmlAgentEditorBridgeState>(set => ({
  ownerId: '',
  available: false,
  readOnly: false,
  activityTargets: [],
  turnActivity: null,
  markActivity: targets => set(current => {
    const merged = new Map(
      current.activityTargets.map(target => [`${target.pagePath}\0${target.path}`, target]),
    );
    targets.forEach(target => {
      const pagePath = target.pagePath.trim();
      const path = target.path.trim();
      if (!pagePath || !path) return;
      merged.set(`${pagePath}\0${path}`, { pagePath, path });
    });
    const activityTargets = Array.from(merged.values()).slice(-128);
    if (
      activityTargets.length === current.activityTargets.length
      && activityTargets.every((target, index) => (
        target.pagePath === current.activityTargets[index]?.pagePath
        && target.path === current.activityTargets[index]?.path
      ))
    ) return current;
    return { activityTargets };
  }),
  clearActivity: () => set(current => (
    current.activityTargets.length ? { activityTargets: [] } : current
  )),
  startTurnActivity: (id, label = 'Agente trabalhando') => set(current => {
    const normalizedId = id.trim();
    if (!normalizedId) return current;
    if (
      current.turnActivity?.id === normalizedId
      && current.turnActivity.label === label
    ) return current;
    return {
      turnActivity: {
        id: normalizedId,
        label: label.trim() || 'Agente trabalhando',
        startedAt: current.turnActivity?.id === normalizedId
          ? current.turnActivity.startedAt
          : Date.now(),
      },
    };
  }),
  updateTurnActivity: label => set(current => {
    const normalized = label.trim();
    if (!current.turnActivity || !normalized || current.turnActivity.label === normalized) return current;
    return { turnActivity: { ...current.turnActivity, label: normalized } };
  }),
  finishTurnActivity: id => set(current => {
    if (!current.turnActivity || (id && current.turnActivity.id !== id)) return current;
    return { turnActivity: null };
  }),
  publish: (ownerId, bridge) => {
    if (bridgeRuntime.activeOwnerId && bridgeRuntime.activeOwnerId !== ownerId) bridgeRuntime.nativeController?.abort();
    bridgeRuntime.activeOwnerId = ownerId;
    bridgeRuntime.activeBridge = bridge;
    set(current => (
      current.ownerId === ownerId && current.available && current.readOnly === (bridge.readOnly === true)
        ? current
        : { ownerId, available: true, readOnly: bridge.readOnly === true }
    ));
  },
  resetOwner: ownerId => {
    if (bridgeRuntime.activeOwnerId !== ownerId) return;
    bridgeRuntime.nativeController?.abort();
    bridgeRuntime.activeOwnerId = '';
    bridgeRuntime.activeBridge = null;
    set(current => (
      current.ownerId === ownerId
        ? { ownerId: '', available: false, readOnly: false, activityTargets: [], turnActivity: null }
        : current
    ));
  },
}));

export const useHtmlAgentEditorBridgeStore = bridgeRuntime.store
  || (bridgeRuntime.store = createHtmlAgentEditorBridgeStore());
