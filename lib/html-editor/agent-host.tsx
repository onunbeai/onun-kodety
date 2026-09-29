'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AgentBackendBinding } from './agent-backend';

export interface HtmlWorkspaceAgentHost {
  kind?: 'html' | 'wordpress';
  licensed: boolean;
  /** Recheck the Builder's license source; never a separate Agent activation. */
  checkLicense?(): Promise<boolean>;
  agent?: AgentBackendBinding;
  execution?: {
    selected: 'server' | 'browser';
    changing: boolean;
    select(mode: 'server' | 'browser'): Promise<void>;
  };
  onOpenSettings(section: 'mcp' | 'license' | 'agents'): void;
}

const HtmlWorkspaceAgentContext = createContext<HtmlWorkspaceAgentHost | null>(null);

export function HtmlWorkspaceAgentProvider({ children, ...host }: HtmlWorkspaceAgentHost & { children: ReactNode }) {
  return <HtmlWorkspaceAgentContext.Provider value={host}>{children}</HtmlWorkspaceAgentContext.Provider>;
}

export function useHtmlWorkspaceAgentHost() { return useContext(HtmlWorkspaceAgentContext); }
