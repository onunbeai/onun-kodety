import type { AgentRuntimeRequestOptions } from './agent-runtime-setup';
import type { AgentTransportError } from './agent-transport';

export interface AgentBackendCapabilities {
  attachments?: boolean;
  skills?: boolean;
  figma?: boolean;
}

/** UI-facing Agent protocol; availability and capabilities come from config. */
export interface AgentBackend {
  readonly remote: boolean;
  request(suffix: string, options?: AgentRuntimeRequestOptions): Promise<unknown>;
  uploadAttachment(file: File): Promise<unknown>;
  cancelAll(): void;
}

export interface AgentBackendCallbacks {
  /** Runtime configuration only; preference-only POST responses must not reset it. */
  onConfig?: (config: Record<string, unknown>) => void;
  onDenied?: (error: AgentTransportError) => void;
}

export interface AgentBackendBinding {
  /** Stable account/project scope for notifications; it is not an HTTP endpoint. */
  key: string;
  /** Each mounted consumer owns its requests. cancelAll must not stop sibling clients. */
  createBackend(callbacks: AgentBackendCallbacks): AgentBackend;
}
