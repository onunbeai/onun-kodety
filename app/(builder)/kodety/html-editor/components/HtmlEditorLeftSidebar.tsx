'use client';

import {
  memo,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SVGProps,
} from 'react';
import {
  ClipboardCopy,
  Eye,
  Lock,
  Plus,
  Settings2,
  UsersRound,
} from '@/components/ui/gravity-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import { cn } from '@/lib/utils';
import { SIDEBAR_LIMITS, SIDEBAR_RAIL_BUTTON_CLASS } from '@/lib/html-editor/editor-constants';
import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import type { EditorMode } from '@/lib/html-editor/types';
import { experimentPublicEditPath, type HtmlExperimentEditSession } from '@/lib/html-editor/experiments';
import { useHtmlEditorChromeStore } from '@/stores/useHtmlEditorChromeStore';
import { HtmlDesignTokenPanel } from './HtmlDesignTokens';
import { HtmlInsertMenu } from './HtmlInsertMenu';
import { HtmlInteractionLibrary } from './HtmlInteractionLibrary';
import { HtmlMembershipPreviewSelector } from './HtmlMembershipRuleEditor';
import { HtmlNavigator, HtmlNavigatorRailTab } from './HtmlNavigator';
import {
  HtmlProjectSettingsRailLink,
} from './HtmlProjectSettingsHost';
import { ProgrammingIcon } from '@solar-icons/react/bold-duotone/programming';
import { GlobalIcon } from '@solar-icons/react/bold-duotone/global';
import { Tuning2Icon } from '@solar-icons/react/bold-duotone/tuning-2';

type InsertMenuProps = Omit<ComponentProps<typeof HtmlInsertMenu>, 'width' | 'onClose' | 'onOpenEffects'>;
type InteractionLibraryProps = Omit<
  ComponentProps<typeof HtmlInteractionLibrary>,
  'panelWidth' | 'onBack' | 'onOpenInsert'
>;
type DesignTokenPanelProps = Omit<
  ComponentProps<typeof HtmlDesignTokenPanel>,
  'width' | 'onClose' | 'editTokenId' | 'onEditTokenHandled'
>;

function McpLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 180 180"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M18 84.8528 85.8822 16.9706c9.3726-9.37262 24.5688-9.37262 33.9408 0 9.373 9.3725 9.373 24.5685 0 33.9411L68.5581 102.177"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="m69.2652 101.47 50.5578-50.5583c9.373-9.3726 24.569-9.3726 33.942 0l.353.3535c9.373 9.3726 9.373 24.5686 0 33.9411L92.7248 146.6a8 8 0 0 0 0 11.313l12.6062 12.607"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M102.853 33.9411 52.6482 84.1457c-9.3726 9.3726-9.3726 24.5683 0 33.9413 9.3726 9.372 24.5685 9.372 33.9411 0l50.2047-50.2048"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
    </svg>
  );
}

const DISCORD_COMMUNITY_URL = 'https://discord.gg/PfHSRE7Faj';

function DiscordLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export interface HtmlEditorLeftSidebarProps {
  onOpenSettings?: () => void;
  onOpenMcpSettings?: () => void;
  onOpenLocalization?: () => void;
  isPreviewing: boolean;
  framerRuntimeReadOnly: boolean;
  membershipExtensionActive: boolean;
  topbarWp?: KodetyWordPressConfig;
  interceptSavedNavigation: (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => void;
  mode: EditorMode;
  experimentEditSession: HtmlExperimentEditSession | null;
  openGlobalCodeEditor: () => void;
  mcpConnected: boolean;
  mcpActivityVisible: boolean;
  mcpActivityLabel: string;
  mcpTargetName: string;
  mcpTargetDetail: string;
  membershipEnabled: boolean;
  membershipPreviewLayer: string;
  membershipPreviewLabel: string;
  membershipPreviewProps: ComponentProps<typeof HtmlMembershipPreviewSelector>;
  leftSidebarWidth: number;
  selectionAvailable: boolean;
  insertMenuProps: InsertMenuProps;
  interactionLibraryProps: InteractionLibraryProps | null;
  designTokenPanelProps: DesignTokenPanelProps;
  navigatorProps: Omit<ComponentProps<typeof HtmlNavigator>, 'width' | 'activeCodeFile'>;
  navigatorInteractionSelectors: string[];
  startSidebarResize: (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => void;
  resizeSidebarWithKeyboard: (side: 'left' | 'right', event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

function HtmlEditorLeftSidebarImpl({
  onOpenSettings,
  onOpenMcpSettings,
  onOpenLocalization,
  isPreviewing,
  framerRuntimeReadOnly,
  membershipExtensionActive,
  topbarWp,
  interceptSavedNavigation,
  mode,
  experimentEditSession,
  openGlobalCodeEditor,
  mcpConnected,
  mcpActivityVisible,
  mcpActivityLabel,
  mcpTargetName,
  mcpTargetDetail,
  membershipEnabled,
  membershipPreviewLayer,
  membershipPreviewLabel,
  membershipPreviewProps,
  leftSidebarWidth,
  selectionAvailable,
  insertMenuProps,
  interactionLibraryProps,
  designTokenPanelProps,
  navigatorProps,
  navigatorInteractionSelectors,
  startSidebarResize,
  resizeSidebarWithKeyboard,
}: HtmlEditorLeftSidebarProps) {
  const insertPanelOpen = useHtmlEditorChromeStore(state => state.insertPanelOpen);
  const setInsertPanelOpen = useHtmlEditorChromeStore(state => state.setInsertPanelOpen);
  const effectsLibraryOpen = useHtmlEditorChromeStore(state => state.effectsLibraryOpen);
  const setEffectsLibraryOpen = useHtmlEditorChromeStore(state => state.setEffectsLibraryOpen);
  const variablesPanelOpen = useHtmlEditorChromeStore(state => state.variablesPanelOpen);
  const setVariablesPanelOpen = useHtmlEditorChromeStore(state => state.setVariablesPanelOpen);
  const variableEditorTokenId = useHtmlEditorChromeStore(state => state.variableEditorTokenId);
  const setVariableEditorTokenId = useHtmlEditorChromeStore(state => state.setVariableEditorTokenId);
  const closeNavigatorOverlays = useHtmlEditorChromeStore(state => state.closeNavigatorOverlays);
  const showCode = useHtmlEditorChromeStore(state => state.showCode);
  const setShowCode = useHtmlEditorChromeStore(state => state.setShowCode);
  const codeFilePath = useHtmlEditorChromeStore(state => state.codeFilePath);
  const overlaysOpen = insertPanelOpen || effectsLibraryOpen || variablesPanelOpen;
  const communityLabel = getAdminUiLocale().toLowerCase().startsWith('pt')
    ? 'Comunidade'
    : 'Community';
  const mcpSettingsHref = onOpenMcpSettings ? '#mcp' : topbarWp?.mcpSettingsUrl || topbarWp?.mcpAdminUrl;
  const openMcpSettings = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (onOpenMcpSettings) {
      event.preventDefault();
      onOpenMcpSettings();
    } else interceptSavedNavigation(event, event.currentTarget.href);
  };

  // Em modo preview (aba de review) os painéis são desmontados, não escondidos:
  // assim navigator, camadas e overlays param de executar por baixo do preview.
  if (isPreviewing) return null;

  return (
    <div className={isPreviewing ? 'hidden' : 'contents'} data-editor-panel-region="left">
      <aside
        data-builder-sidebar-rail
        data-kodety-onboarding="design-tools"
        aria-label="Ferramentas laterais"
        className="relative z-[80] flex w-[50px] shrink-0 flex-col items-center gap-1 overflow-visible border-r border-[var(--kodety-divider)] bg-[var(--kodety-chrome)] py-2"
      >
        <button
          type="button"
          data-insert-panel-trigger
          data-kodety-onboarding="design-insert"
          data-kodety-onboarding-reveal
          data-kodety-onboarding-toggle
          data-tooltip="Insert"
          aria-label="Insert"
          aria-pressed={insertPanelOpen}
          aria-controls="html-editor-insert-panel"
          className={cn(SIDEBAR_RAIL_BUTTON_CLASS, insertPanelOpen && 'bg-white/[0.09] text-[var(--kodety-accent-hover)]')}
          disabled={framerRuntimeReadOnly}
          onClick={() => {
            setVariablesPanelOpen(false);
            setEffectsLibraryOpen(false);
            setInsertPanelOpen(value => !value);
          }}
        >
          <Plus />
        </button>
        <span className="my-1 h-px w-7 bg-[var(--kodety-divider)]" aria-hidden="true" />
        <HtmlNavigatorRailTab
          panel="layers"
          className={SIDEBAR_RAIL_BUTTON_CLASS}
          navigationVisible={!overlaysOpen}
          onActivate={closeNavigatorOverlays}
        />
        <HtmlNavigatorRailTab
          panel="pages"
          className={SIDEBAR_RAIL_BUTTON_CLASS}
          navigationVisible={!overlaysOpen}
          onActivate={closeNavigatorOverlays}
        />
        <HtmlNavigatorRailTab
          panel="assets"
          className={SIDEBAR_RAIL_BUTTON_CLASS}
          navigationVisible={!overlaysOpen}
          onActivate={closeNavigatorOverlays}
        />
        <button
          type="button"
          data-variables-panel-trigger
          data-kodety-onboarding="design-variables"
          data-kodety-onboarding-reveal
          data-kodety-onboarding-toggle
          data-tooltip="Variables"
          aria-label="Variables"
          aria-pressed={variablesPanelOpen}
          aria-controls="html-editor-variables-panel"
          className={cn(
            SIDEBAR_RAIL_BUTTON_CLASS,
            variablesPanelOpen && 'bg-white/[0.09] text-[var(--kodety-accent-hover)]',
          )}
          disabled={framerRuntimeReadOnly}
          onClick={() => {
            setInsertPanelOpen(false);
            setEffectsLibraryOpen(false);
            setVariablesPanelOpen(value => !value);
          }}
        >
          <Tuning2Icon />
        </button>
        {membershipExtensionActive &&
          topbarWp?.canViewMembers &&
          (topbarWp.membersUrl ? (
            <a
              href={topbarWp.membersUrl}
              data-kodety-workspace-navigation="native"
              data-tooltip="Membership"
              data-kodety-onboarding="design-members"
              aria-label="Membership"
              className={SIDEBAR_RAIL_BUTTON_CLASS}
            >
              <UsersRound />
            </a>
          ) : null)}
        <button
          type="button"
          data-tooltip="Code"
          data-kodety-onboarding="design-code"
          data-kodety-onboarding-reveal
          data-kodety-onboarding-toggle
          aria-label="Code"
          aria-pressed={showCode}
          className={cn(SIDEBAR_RAIL_BUTTON_CLASS, showCode && 'bg-white/[0.09] text-[var(--kodety-accent-hover)]')}
          disabled={mode !== 'design' || framerRuntimeReadOnly}
          onClick={() => {
            setInsertPanelOpen(false);
            setVariablesPanelOpen(false);
            showCode ? setShowCode(false) : openGlobalCodeEditor();
          }}
        >
          <ProgrammingIcon />
        </button>
        {(topbarWp?.localizationUrl || onOpenLocalization) && (
          <a
            href={topbarWp?.localizationUrl || "#localization"}
            onClick={onOpenLocalization ? event => { event.preventDefault(); onOpenLocalization(); } : undefined}
            data-kodety-workspace-navigation="native"
            data-tooltip="Languages"
            data-kodety-onboarding="design-localization"
            aria-label="Languages"
            className={SIDEBAR_RAIL_BUTTON_CLASS}
          >
            <GlobalIcon />
          </a>
        )}

        <div
          data-builder-sidebar-utility-group
          className="mt-auto flex w-full flex-col items-center gap-1 border-t border-[var(--kodety-divider)] pt-2"
        >
          {(onOpenMcpSettings || topbarWp?.mcpAdminUrl) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    SIDEBAR_RAIL_BUTTON_CLASS,
                    mcpConnected && 'text-emerald-400',
                    mcpActivityVisible && 'bg-[var(--kodety-accent-hover)]/10 text-[var(--kodety-accent-hover)]',
                  )}
                  data-mcp-state={mcpActivityVisible ? 'active' : mcpConnected ? 'connected' : 'disconnected'}
                  data-tooltip={`${mcpActivityLabel} · ${mcpTargetName}`}
                  aria-label={`${mcpActivityLabel}. Projeto alvo: ${mcpTargetName}`}
                >
                  <span className="relative">
                    <McpLogo className={cn(mcpActivityVisible && 'animate-pulse')} />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute -right-1 -top-1 size-1.5 rounded-full ring-2 ring-[#171717]',
                        mcpConnected ? 'bg-emerald-400' : 'bg-zinc-600',
                        mcpActivityVisible && 'bg-[var(--kodety-accent-hover)] animate-ping',
                      )}
                    />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                sideOffset={8}
                className="kodety-editor-sidebar-overlay z-[9000] w-72"
              >
                <div className="px-2 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-2 rounded-full',
                        mcpConnected ? 'bg-emerald-400' : 'bg-zinc-600',
                        mcpActivityVisible && 'bg-[var(--kodety-accent-hover)]',
                      )}
                    />
                    {mcpActivityLabel}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-zinc-100">{mcpTargetName}</p>
                  <p className="truncate text-xs text-zinc-500">{mcpTargetDetail}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href={mcpSettingsHref}
                    onClick={openMcpSettings}
                  >
                    <ClipboardCopy className="size-4" />
                    Copiar conexão deste projeto
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href={mcpSettingsHref}
                    onClick={openMcpSettings}
                  >
                    <Settings2 className="size-4" />
                    Configurar MCP
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <a
            href={DISCORD_COMMUNITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-kodety-community-link
            data-tooltip={communityLabel}
            aria-label={`${communityLabel} · Discord`}
            className={cn(
              SIDEBAR_RAIL_BUTTON_CLASS,
              'hover:text-[var(--kodety-accent-hover)] focus-visible:text-[var(--kodety-accent-hover)]',
            )}
          >
            <DiscordLogo />
          </a>

          {membershipExtensionActive && membershipEnabled && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    SIDEBAR_RAIL_BUTTON_CLASS,
                    membershipPreviewLayer !== 'base' && 'bg-white/[0.09] text-[var(--kodety-accent-hover)]',
                  )}
                  data-tooltip={`Visualizar como ${membershipPreviewLabel}`}
                  aria-label={`Visualizar como ${membershipPreviewLabel}`}
                >
                  <Eye />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="end"
                sideOffset={8}
                className="kodety-editor-sidebar-overlay z-[9000] w-[420px] max-w-[calc(100vw-70px)] border-0 bg-transparent p-0 shadow-none"
              >
                <HtmlMembershipPreviewSelector {...membershipPreviewProps} />
              </PopoverContent>
            </Popover>
          )}

          {(topbarWp?.settingsUrl || onOpenSettings) ? (
            <HtmlProjectSettingsRailLink
              href={topbarWp?.settingsUrl || "#settings"}
              onOpen={onOpenSettings}
              className={SIDEBAR_RAIL_BUTTON_CLASS}
            />
          ) : null}
        </div>
      </aside>
      <div
        data-editor-sidebar-panel="left"
        data-kodety-onboarding="design-left-panel"
        className={cn(
          'kodety-editor-left-sidebar relative min-h-0 shrink-0 self-stretch overflow-hidden',
          overlaysOpen && 'z-[70] overflow-visible',
        )}
        style={{ width: leftSidebarWidth }}
      >
        {insertPanelOpen ? (
          <HtmlInsertMenu
            {...insertMenuProps}
            width={leftSidebarWidth}
            onClose={() => setInsertPanelOpen(false)}
            onOpenEffects={() => {
              if (!selectionAvailable) {
                toast.info('Selecione um elemento para aplicar um efeito.');
                return;
              }
              setInsertPanelOpen(false);
              setEffectsLibraryOpen(true);
            }}
          />
        ) : effectsLibraryOpen && interactionLibraryProps ? (
          <HtmlInteractionLibrary
            {...interactionLibraryProps}
            panelWidth={leftSidebarWidth}
            onBack={() => setEffectsLibraryOpen(false)}
            onOpenInsert={() => {
              setEffectsLibraryOpen(false);
              setInsertPanelOpen(true);
            }}
          />
        ) : variablesPanelOpen ? (
          <HtmlDesignTokenPanel
            {...designTokenPanelProps}
            width={leftSidebarWidth}
            editTokenId={variableEditorTokenId}
            onEditTokenHandled={() => setVariableEditorTokenId(null)}
            onClose={() => {
              setVariableEditorTokenId(null);
              setVariablesPanelOpen(false);
            }}
          />
        ) : (
          <>
            <div
              className={cn(
                'h-full min-h-0 overflow-hidden',
                framerRuntimeReadOnly && 'pointer-events-none select-none opacity-55',
              )}
            >
              <HtmlNavigator
                {...navigatorProps}
                width={leftSidebarWidth}
                activeCodeFile={
                  experimentEditSession && codeFilePath
                    ? experimentPublicEditPath(experimentEditSession, codeFilePath)
                    : codeFilePath
                }
                interactionSelectors={navigatorInteractionSelectors}
              />
            </div>
            {framerRuntimeReadOnly && (
              <div className="absolute inset-x-3 top-3 z-30 rounded-xl border border-amber-500/25 bg-[#191713]/95 p-3 shadow-xl backdrop-blur">
                <div className="flex items-start gap-2.5">
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                  <div>
                    <p className="text-[11px] font-semibold text-amber-100">Layers somente leitura</p>
                    <p className="mt-1 text-[10px] leading-4 text-amber-100/55">
                      O runtime Framer é a fonte visual deste projeto.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div
        role="separator"
        aria-label="Resize layers sidebar"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_LIMITS.left.min}
        aria-valuemax={SIDEBAR_LIMITS.left.max}
        aria-valuenow={leftSidebarWidth}
        tabIndex={0}
        onPointerDown={event => startSidebarResize('left', event)}
        onKeyDown={event => resizeSidebarWithKeyboard('left', event)}
        className={cn(
          'group relative z-20 w-px shrink-0 cursor-col-resize bg-[var(--kodety-divider)] transition-colors hover:bg-[var(--kodety-accent)] focus-visible:bg-[var(--kodety-focus)] focus-visible:outline-none',
          overlaysOpen && 'pointer-events-none opacity-0',
        )}
      >
        <span className="absolute inset-y-0 -left-1 -right-1" />
      </div>
    </div>
  );
}

export const HtmlEditorLeftSidebar = memo(HtmlEditorLeftSidebarImpl);
