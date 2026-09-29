'use client';

import {
  memo,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Lock, Settings2, Unlock } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HtmlDesignTokenProvider } from '@/lib/html-editor/design-token-context';
import type { HtmlDesignTokenDocument } from '@/lib/html-editor/design-tokens';
import { clearHtmlAgentPanelRequest, OPEN_HTML_AGENT_PANEL_EVENT, requestedHtmlAgentPanel } from '@/lib/html-editor/agent-panel-events';
import { SIDEBAR_LIMITS } from '@/lib/html-editor/editor-constants';
import { HtmlAgentPanel, HtmlHumanAgentToggle } from './HtmlAgentPanel';

export interface HtmlEditorRightSidebarProps {
  isPreviewing: boolean;
  framerRuntimeReadOnly: boolean;
  rightSidebarWidth: number;
  designTokens: HtmlDesignTokenDocument;
  onDesignTokensChange: (next: HtmlDesignTokenDocument) => void;
  canUnlockFramerEditing: boolean;
  onUnlockFramerEditing: () => void;
  settingsHref?: string;
  onNavigate: (href: string) => void;
  inspector: ReactNode;
  startSidebarResize: (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => void;
  resizeSidebarWithKeyboard: (side: 'left' | 'right', event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

function HtmlEditorRightSidebarImpl({
  isPreviewing,
  framerRuntimeReadOnly,
  rightSidebarWidth,
  designTokens,
  onDesignTokensChange,
  canUnlockFramerEditing,
  onUnlockFramerEditing,
  settingsHref,
  onNavigate,
  inspector,
  startSidebarResize,
  resizeSidebarWithKeyboard,
}: HtmlEditorRightSidebarProps) {
  const [panelMode, setPanelMode] = useState<'human' | 'agent'>(() => typeof window === 'undefined' ? 'human' : requestedHtmlAgentPanel(window.location.href));

  useEffect(() => {
    if (requestedHtmlAgentPanel(window.location.href) === 'agent') {
      try { window.history.replaceState(window.history.state, '', clearHtmlAgentPanelRequest(window.location.href)); }
      catch { /* Opening the chat does not depend on cleaning up the URL. */ }
    }
    const openAgentPanel = () => setPanelMode('agent');
    window.addEventListener(OPEN_HTML_AGENT_PANEL_EVENT, openAgentPanel);
    return () => window.removeEventListener(OPEN_HTML_AGENT_PANEL_EVENT, openAgentPanel);
  }, []);

  return (
    <>
      {!isPreviewing && (
        <div
          role="separator"
          aria-label="Resize design sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_LIMITS.right.min}
          aria-valuemax={SIDEBAR_LIMITS.right.max}
          aria-valuenow={rightSidebarWidth}
          tabIndex={0}
          onPointerDown={event => startSidebarResize('right', event)}
          onKeyDown={event => resizeSidebarWithKeyboard('right', event)}
          className="group relative z-20 w-px shrink-0 cursor-col-resize bg-[var(--kodety-divider)] transition-colors hover:bg-[var(--kodety-accent)] focus-visible:bg-[var(--kodety-focus)] focus-visible:outline-none"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}
      <div
        data-editor-panel-region="right"
        data-kodety-onboarding="design-inspector"
        data-editor-sidebar-panel="right"
        className={cn(
          'kodety-editor-design-sidebar min-h-0 shrink-0 self-stretch overflow-hidden bg-[var(--kodety-panel)]',
          isPreviewing && 'hidden',
        )}
        style={{ width: rightSidebarWidth }}
      >
        {!isPreviewing && <HtmlHumanAgentToggle value={panelMode} onChange={setPanelMode} inspectorAvailable={!framerRuntimeReadOnly} />}
        <div className={cn('h-[calc(100%_-_3rem)] min-h-0', (isPreviewing || panelMode !== 'human') && 'hidden')}>
          {framerRuntimeReadOnly ? (
            <div className="flex h-full min-h-0 flex-col overflow-auto p-4">
              <div className="border-b border-[var(--kodety-divider)] pb-4">
                <div className="flex items-center gap-2 text-amber-300">
                  <Lock className="size-3.5" />
                  <h2 className="text-[11px] font-semibold text-[var(--kodety-text)]">Site Framer somente leitura</h2>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                  O canvas executa o runtime Framer local para manter animações, variantes e componentes fiéis. A edição
                  visual começa protegida, mas pode ser desbloqueada para este projeto.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="xs"
                    disabled={!canUnlockFramerEditing}
                    onClick={onUnlockFramerEditing}
                  >
                    <Unlock /> Desbloquear edição
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={!settingsHref}
                    onClick={() => {
                      if (!settingsHref) return;
                      const url = new URL(settingsHref, window.location.href);
                      url.searchParams.set('section', 'beta');
                      onNavigate(url.toString());
                    }}
                  >
                    <Settings2 /> Preferência
                  </Button>
                </div>
              </div>
              <p className="mt-3 text-[9px] leading-4 text-[var(--kodety-text-tertiary)]">
                No Design, o Builder reconcilia suas alterações com o Framer. Preview e publicação continuam usando o
                runtime animado local.
              </p>
            </div>
          ) : !isPreviewing ? (
            <HtmlDesignTokenProvider document={designTokens} onChange={onDesignTokensChange}>
              {inspector}
            </HtmlDesignTokenProvider>
          ) : null}
        </div>
        {/* A hidden Agent panel remains mounted so polling can resolve a pending
            item/tool/call after the user switches back to Canvas or Preview. */}
        <div className={cn('h-[calc(100%_-_3rem)] min-h-0', (isPreviewing || panelMode !== 'agent') && 'hidden')}>
          <HtmlAgentPanel visible={!isPreviewing && panelMode === 'agent'} onNavigate={onNavigate} />
        </div>
      </div>
    </>
  );
}

export const HtmlEditorRightSidebar = memo(HtmlEditorRightSidebarImpl);
