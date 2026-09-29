"use client";

import { WordPressEditorLockStatus } from '@/Wordpress/editor/WordPressEditorLockStatus';

import {
  type ComponentProps,
  memo,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';
import {
  Archive,
  Cable,
  ChevronDown,
  ChevronLeft,
  Copy,
  Download,
  Eye,
  FilePlus2,
  Globe,
  History,
  House,
  Lock,
  Maximize2,
  Monitor,
  Pencil,
  Play,
  Redo2,
  RefreshCw,
  Save,
  Smartphone,
  Sparkles,
  Square,
  Undo2,
  Upload,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EditorCornerMenuGlyph } from '@/lib/html-editor/EditorChromeBits';
import {
  MAX_CANVAS_VIEWPORT_HEIGHT,
  MAX_CANVAS_VIEWPORT_WIDTH,
  MIN_CANVAS_VIEWPORT_SIZE,
  TOPBAR_ICON_CLASS,
} from '@/lib/html-editor/editor-constants';
import type { KodetyWordPressConfig, Viewport, ViewportSize } from '@/lib/html-editor/editor-types';
import { importFolder, isShopifyThemeProject } from '@/lib/html-editor/project-io';
import type { Breakpoint } from '@/lib/html-editor/css-patcher';
import type { HtmlProject } from '@/lib/html-editor/types';
import { cn } from '@/lib/utils';
import {
  resolveHtmlViewportSize,
  useHtmlViewportStore,
} from '@/stores/useHtmlViewportStore';
import { HtmlKodetyUpdateIndicator, HtmlKodetyUpdateMenuItems } from './HtmlKodetyUpdates';
import { HtmlOnboardingMenuItem, useOnboardingMenuLaunch } from './HtmlOnboardingMenuItem';

const PREVIEW_CONTROL_SURFACE_CLASS =
  'flex h-8 min-w-0 items-center gap-[2px] overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] p-[2px] text-[var(--kodety-text-secondary)] transition-[border-color,background-color] duration-100 ease-[var(--kodety-ease-ui)] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065] has-[[data-state=open]]:border-[var(--kodety-focus)]/70 has-[[data-state=open]]:bg-white/[.065]';

const PREVIEW_CONTROL_DIVIDER_CLASS = 'h-4 w-px shrink-0 bg-white/[.055]';

function previewUrlDisplayLabel(value: string) {
  if (!value) return 'Preview ativo';
  try {
    const url = new URL(value);
    const path = url.pathname;
    return `${url.host}${path === '/' ? '' : path.replace(/\/$/, '')}`;
  } catch {
    return value.replace(/^https?:\/\//i, '').replace(/\/$/, '') || 'Preview ativo';
  }
}

function PreviewToolbarIconButton({
  children,
  className,
  tooltip,
  'aria-label': ariaLabel,
  ...buttonProps
}: Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  'aria-label': string;
  children: ReactNode;
  tooltip?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          {...buttonProps}
          type={buttonProps.type || 'button'}
          aria-label={ariaLabel}
          className={cn(
            'grid size-[26px] shrink-0 place-items-center rounded-[6px] border-0 bg-transparent p-0 text-[var(--kodety-text-tertiary)] shadow-none outline-none transition-[background-color,color] duration-100 ease-[var(--kodety-ease-ui)] hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)] focus-visible:ring-0 focus-visible:ring-offset-0 [&_svg]:size-3.5',
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="z-[10020] border border-white/[.08] [--tooltip-surface:var(--kodety-panel)] text-[var(--kodety-text)] shadow-[var(--kodety-shadow-popover)]"
      >
        {tooltip || ariaLabel}
      </TooltipContent>
    </Tooltip>
  );
}

export interface HtmlEditorTopbarProps {
  backupAction?: ReactNode;
  onBack?: () => void;
  onPublish?: () => void;
  onManageExtensions?: () => void;
  breakpoints: Breakpoint[];
  convertFramerToEditable: () => Promise<void>;
  copyPurePreviewUrl: () => void;
  createNewProject: () => void;
  editingProjectName: boolean;
  enterFocusedPreview: (requestedViewport?: Viewport) => void;
  exportProjectArchive: () => Promise<void>;
  exportProjectAsShopifyTheme: () => Promise<void>;
  finishInlineProjectRename: () => void;
  fitCanvas: () => void;
  framerEditingEnabled: boolean;
  framerRuntimeReadOnly: boolean;
  hasDivergentLocalRecovery: boolean;
  history: HtmlProject[];
  historyIndex: number;
  hostedPreviewAvailable: boolean;
  hostedPreviewUrl: string;
  hydratedFramerProject: boolean;
  invitationRequiresActivation: boolean;
  isImporting: boolean;
  isConvertingFramer: boolean;
  isPreviewing: boolean;
  isPublishing: boolean;
  publishReady: boolean;
  leaveFocusedPreview: () => void;
  loadZipFile: (file: File) => Promise<void>;
  navigateAfterWordPressSave: (href: string) => Promise<boolean>;
  openKodetyUpdates: () => void;
  openStudioSite: () => void;
  openProject: (next: HtmlProject, directoryHandle?: FileSystemDirectoryHandle | null, replaceWordPressWorkspace?: boolean) => void;
  primaryBreakpoint: Breakpoint;
  project: HtmlProject;
  projectNameDraft: string;
  redo: () => void;
  refreshFocusedPreview: () => void;
  renameCurrentProject: () => void;
  savedAt: number | null;
  saveProjectNow: () => Promise<void>;
  selectPreviewViewport: (id: string) => void;
  setEditingProjectName: Dispatch<SetStateAction<boolean>>;
  setFolderInput: (node: HTMLInputElement | null) => void;
  setInvitationAccessOpen: Dispatch<SetStateAction<boolean>>;
  setProjectNameDraft: Dispatch<SetStateAction<string>>;
  setPublishPanelOpen: Dispatch<SetStateAction<boolean>>;
  setRecoveryConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setShareDialogOpen: Dispatch<SetStateAction<boolean>>;
  editorLockBlocked: boolean;
  sharedReadOnly: boolean;
  sharedSession: boolean;
  startInlineProjectRename: () => void;
  topbarSiteLabel: string;
  topbarWp: KodetyWordPressConfig | undefined;
  product?: KodetyWordPressConfig['product'];
  onActivateLicense?: () => void;
  undo: () => void;
  workspacePrimaryNavigation: (activeArea: 'design' | 'cms' | 'insights' | null) => ReactNode;
  workspaceReadOnly: boolean;
  zipInput: RefObject<HTMLInputElement | null>;
}

function HtmlEditorTopbarImpl({
  backupAction,
  onBack,
  onPublish,
  onManageExtensions,
  breakpoints,
  convertFramerToEditable,
  copyPurePreviewUrl,
  createNewProject,
  editingProjectName,
  enterFocusedPreview,
  exportProjectArchive,
  exportProjectAsShopifyTheme,
  finishInlineProjectRename,
  fitCanvas,
  framerEditingEnabled,
  framerRuntimeReadOnly,
  hasDivergentLocalRecovery,
  history,
  historyIndex,
  hostedPreviewAvailable,
  hostedPreviewUrl,
  hydratedFramerProject,
  invitationRequiresActivation,
  isImporting,
  isConvertingFramer,
  isPreviewing,
  isPublishing,
  publishReady,
  leaveFocusedPreview,
  loadZipFile,
  navigateAfterWordPressSave,
  openKodetyUpdates,
  openStudioSite,
  openProject,
  primaryBreakpoint,
  project,
  projectNameDraft,
  redo,
  refreshFocusedPreview,
  renameCurrentProject,
  savedAt,
  saveProjectNow,
  selectPreviewViewport,
  setEditingProjectName,
  setFolderInput,
  setInvitationAccessOpen,
  setProjectNameDraft,
  setPublishPanelOpen,
  setRecoveryConfirmOpen,
  setShareDialogOpen,
  editorLockBlocked,
  sharedReadOnly,
  sharedSession,
  startInlineProjectRename,
  topbarSiteLabel,
  topbarWp,
  product = topbarWp?.product,
  onActivateLicense,
  undo,
  workspacePrimaryNavigation,
  workspaceReadOnly,
  zipInput,
}: HtmlEditorTopbarProps) {
  const onboardingMenu = useOnboardingMenuLaunch();
  const viewport = useHtmlViewportStore(state => state.viewport);
  const viewportSizes = useHtmlViewportStore(state => state.viewportSizes);
  const setViewportSizes = useHtmlViewportStore(state => state.setViewportSizes);
  const currentViewport = resolveHtmlViewportSize(viewport, viewportSizes, breakpoints, primaryBreakpoint);
  const previewViewportLabel =
    viewport === 'base'
      ? primaryBreakpoint.label
      : breakpoints.find(breakpoint => breakpoint.id === viewport)?.label || 'Personalizado';
  const hostedPreviewDisplayLabel = previewUrlDisplayLabel(hostedPreviewUrl);
  const updateViewportSize = (property: keyof ViewportSize, value: number) => {
    const limits =
      property === 'width'
        ? [MIN_CANVAS_VIEWPORT_SIZE, MAX_CANVAS_VIEWPORT_WIDTH]
        : [MIN_CANVAS_VIEWPORT_SIZE, MAX_CANVAS_VIEWPORT_HEIGHT];
    const next = Math.max(limits[0], Math.min(limits[1], Math.round(value)));
    setViewportSizes(current => ({
      ...current,
      [viewport]: {
        ...resolveHtmlViewportSize(viewport, current, breakpoints, primaryBreakpoint),
        [property]: next,
      },
    }));
  };
  return (
    <header
            className="kodety-editor-topbar relative z-30 flex h-[50px] shrink-0 items-center gap-1.5 border-b border-[var(--kodety-divider)] bg-[var(--kodety-chrome)] pl-0 pr-2"
            style={{ height: 50 }}
          >
            {(!isPreviewing || framerRuntimeReadOnly) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={onboardingMenu.triggerRef}
                    type="button"
                    data-editor-corner-menu-trigger
                    data-kodety-onboarding="onboarding-menu"
                    className="group grid h-[50px]! w-[50px]! shrink-0 appearance-none place-items-center overflow-hidden rounded-none! border-0 border-r border-[var(--kodety-divider)] bg-transparent p-0 text-[var(--kodety-text)] shadow-none outline-none"
                    style={{ width: 50, height: 50, borderRadius: 0 }}
                    title="Abrir menu do Onun Kodety"
                  >
                    <span
                      data-editor-corner-menu-surface
                      className="grid size-9 place-items-center rounded-[7px] transition-colors group-hover:bg-white/[0.055] group-data-[state=open]:bg-white/[0.09] group-focus-visible:ring-1 group-focus-visible:ring-inset group-focus-visible:ring-[var(--kodety-focus)]"
                    >
                      <EditorCornerMenuGlyph
                        name={topbarWp?.editorCornerIcon}
                        logoUrl={topbarWp?.brandLogoUrl}
                        menuOnly={topbarWp?.studio?.enabled === true}
                      />
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  data-kodety-logo-menu
                  onCloseAutoFocus={onboardingMenu.onCloseAutoFocus}
                  align="start"
                  sideOffset={8}
                  collisionPadding={12}
                  className="kodety-editor-topbar-overlay z-[10010] w-64 rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-[var(--kodety-shadow-popover)]"
                >
                  {onBack ? <DropdownMenuItem onSelect={() => onBack()}>
                    <House /> Voltar ao painel
                  </DropdownMenuItem> : <DropdownMenuItem asChild>
                    <a
                      href={topbarWp?.dashboardUrl || '/kodety/'}
                      data-kodety-workspace-navigation="native"
                    >
                      <House /> Voltar ao painel
                    </a>
                  </DropdownMenuItem>}
                  {onManageExtensions && <DropdownMenuItem onClick={onManageExtensions}>
                    <Archive /> Extensões
                  </DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">
                    Projeto
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={renameCurrentProject} disabled={workspaceReadOnly}>
                    <Pencil /> Renomear projeto
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={createNewProject} disabled={workspaceReadOnly || isPublishing}>
                    <FilePlus2 /> {onBack ? 'Projetos e novo projeto' : 'Criar novo projeto'}
                  </DropdownMenuItem>
                  {hasDivergentLocalRecovery && (
                    <DropdownMenuItem onClick={() => setRecoveryConfirmOpen(true)} disabled={isPublishing}>
                      <History /> Recuperar cópia local
                      <span className="ml-auto text-[9px] text-amber-300">Diferente</span>
                    </DropdownMenuItem>
                  )}
                  {topbarWp?.storageUrl && topbarWp.settingsUrl && !sharedSession && (
                    <DropdownMenuItem
                      disabled={isPublishing || isImporting}
                      onClick={() => {
                        const url = new URL(topbarWp.settingsUrl!, window.location.href);
                        url.searchParams.set('section', 'storage');
                        void navigateAfterWordPressSave(url.toString());
                      }}
                    >
                      <History /> Snapshots
                    </DropdownMenuItem>
                  )}
                  {/*
                  "Abrir HTML" saiu do menu: com um projeto aberto, trocar tudo por
                  um arquivo solto é destrutivo demais para um clique. O caminho
                  continua na tela inicial (sem projeto) e no arrastar-e-soltar,
                  que é onde ele realmente serve.
                */}
                  {/*
                  Opening a folder stays fully supported, just off the menu: it is
                  reached at /kodety/editor/folder, which triggers the same picker on
                  load. Keep openSyncedFolder wired — hiding the entry must not
                  remove the capability.
                */}
                  <DropdownMenuItem
                    onClick={() => {
                      // Inside WordPress the upload area is the complete path: it
                      // installs, publishes and — for a coded project — comes back
                      // here to run the build. Importing in the browser instead
                      // would leave the release half-done.
                      if (topbarWp?.importZipUrl) {
                        void navigateAfterWordPressSave(topbarWp.importZipUrl);
                        return;
                      }
                      zipInput.current?.click();
                    }}
                    disabled={sharedSession || isImporting || isPublishing}
                  >
                    <Archive /> {onBack ? 'Substituir projeto com ZIP…' : 'Importar projeto ZIP'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">
                    Editar
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={undo} disabled={workspaceReadOnly || historyIndex <= 0}>
                    <Undo2 /> Desfazer
                    <span className="ml-auto text-[10px] text-muted-foreground">⌘Z</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={redo} disabled={workspaceReadOnly || historyIndex >= history.length - 1}>
                    <Redo2 /> Refazer
                    <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧Z</span>
                  </DropdownMenuItem>
                  {hydratedFramerProject && (
                    <DropdownMenuItem
                      onClick={() => void convertFramerToEditable()}
                      disabled={sharedReadOnly || editorLockBlocked || isImporting || isPublishing || isConvertingFramer}
                    >
                      <Pencil /> {isConvertingFramer ? 'Convertendo conteúdo Framer…' : 'Converter Framer para Onun Kodety editável'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void saveProjectNow()} disabled={sharedReadOnly}>
                    <Save /> Salvar agora
                    {savedAt && <span className="ml-auto text-[10px] text-muted-foreground">Salvo</span>}
                  </DropdownMenuItem>
                  {topbarWp?.activeExtensions?.includes('kodefy-shopify') ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Download /> {onBack ? 'Exportar ZIP editável' : 'Exportar projeto ZIP'}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        data-kodety-logo-menu
                        className="kodety-editor-topbar-overlay z-[10010] min-w-56 rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-[var(--kodety-shadow-popover)]"
                      >
                        <DropdownMenuItem onClick={() => void exportProjectArchive()} disabled={sharedSession}>
                          <Download /> Exportar ZIP normal
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void exportProjectAsShopifyTheme()} disabled={sharedSession}>
                          <Cable /> Converter para Shopify
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : (
                    <DropdownMenuItem onClick={() => void exportProjectArchive()} disabled={sharedSession}>
                      <Download /> {onBack ? 'Exportar ZIP editável' : 'Exportar projeto ZIP'}
                    </DropdownMenuItem>
                  )}
                  {topbarWp?.updates && (
                    <>
                      <DropdownMenuSeparator />
                      <HtmlKodetyUpdateMenuItems
                        config={topbarWp.updates}
                        nonce={topbarWp.nonce}
                        onOpenUpdates={openKodetyUpdates}
                      />
                    </>
                  )}
                  <HtmlOnboardingMenuItem onRequest={onboardingMenu.requestOnboarding} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {!isPreviewing && workspacePrimaryNavigation('design')}

            {isPreviewing && !framerRuntimeReadOnly && (
              <Button
                size="sm"
                variant="secondary"
                className="ml-2 h-8 min-w-0 shrink-0 gap-1.5 rounded-[8px] border border-transparent bg-white/[.05] px-2.5 text-[11px] font-medium text-[var(--kodety-text-secondary)] shadow-none transition-[border-color,background-color,color] duration-100 ease-[var(--kodety-ease-ui)] hover:bg-white/[.065] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:bg-white/[.065] focus-visible:text-[var(--kodety-text)] focus-visible:ring-0 focus-visible:ring-offset-0"
                onClick={leaveFocusedPreview}
                data-kodety-onboarding="preview-exit"
                aria-label="Voltar à edição"
              >
                <ChevronLeft className="size-3.5" />
                <span className="min-w-0 truncate">Voltar à edição</span>
              </Button>
            )}

            <input
              ref={setFolderInput}
              type="file"
              multiple
              className="hidden"
              aria-label="Selecionar outra pasta local"
              disabled={Boolean(onBack)}
              onChange={async event => {
                if (onBack) {
                  event.target.value = '';
                  onBack();
                  return;
                }
                if (sharedSession) {
                  event.target.value = '';
                  return;
                }
                if (event.target.files?.length)
                  try {
                    openProject(await importFolder(event.target.files), null, true);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Pasta inválida');
                  }
              }}
            />
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              aria-label="Importar outro projeto ZIP"
              disabled={sharedSession || isImporting || isPublishing}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void loadZipFile(file);
                event.target.value = '';
              }}
            />

            {!isPreviewing && (
              <div className="absolute left-1/2 hidden max-w-[34vw] -translate-x-1/2 items-center gap-1.5 truncate text-[11px] min-[1180px]:flex">
                {editingProjectName ? (
                  <Input
                    autoFocus
                    value={projectNameDraft}
                    maxLength={80}
                    aria-label="Nome do projeto"
                    className="h-7 w-44 border-[var(--kodety-accent)]/60 bg-black/30 px-2 text-center text-[11px] font-medium"
                    onChange={event => setProjectNameDraft(event.target.value)}
                    onBlur={finishInlineProjectRename}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingProjectName(false);
                        setProjectNameDraft(project.name);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    data-kodety-no-i18n
                    disabled={workspaceReadOnly}
                    onDoubleClick={startInlineProjectRename}
                    title={
                      sharedReadOnly
                        ? 'Nome disponível apenas para consulta'
                        : framerRuntimeReadOnly
                          ? 'Projeto Framer em modo somente leitura'
                          : 'Duplo clique para renomear o projeto'
                    }
                    className="min-w-0 truncate rounded px-1 font-medium text-foreground transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    {project.name}
                  </button>
                )}
                <span className="text-muted-foreground">·</span>
                {topbarWp?.studio?.enabled ? (
                  <button
                    type="button"
                    data-kodety-no-i18n
                    onClick={openStudioSite}
                    title="Abrir a prévia local na aba Site"
                    className="truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  >
                    {topbarSiteLabel}
                  </button>
                ) : topbarWp?.siteUrl ? (
                  <a
                    href={topbarWp.siteUrl}
                    data-kodety-no-i18n
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir site em nova guia"
                    className="truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  >
                    {topbarSiteLabel}
                  </a>
                ) : (
                  <span data-kodety-no-i18n className="truncate text-muted-foreground">{topbarSiteLabel}</span>
                )}
                {hydratedFramerProject && !framerEditingEnabled && (
                  <span className="text-[8px] font-medium uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
                    Framer · somente leitura
                  </span>
                )}
              </div>
            )}

            {isPreviewing && (
              <div
                data-preview-viewport-toolbar
                role="toolbar"
                className={cn(
                  PREVIEW_CONTROL_SURFACE_CLASS,
                  'absolute left-1/2 z-10 hidden max-w-[calc(100vw-24rem)] -translate-x-1/2 min-[760px]:flex',
                )}
                aria-label="Configurações do viewport de preview"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-full w-[clamp(5.5rem,13vw,9rem)] min-w-0 shrink items-center gap-1.5 rounded-[6px] border-0 bg-transparent px-2 text-[10px] font-medium text-[var(--kodety-text-secondary)] shadow-none outline-none transition-[background-color,color] duration-100 ease-[var(--kodety-ease-ui)] hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-text)] focus-visible:ring-0 data-[state=open]:bg-white/[.13] data-[state=open]:text-[var(--kodety-text)]"
                      aria-label="Selecionar dispositivo de preview"
                    >
                      {currentViewport.width <= 480 ? (
                        <Smartphone className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
                      ) : currentViewport.width <= 900 ? (
                        <Square className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
                      ) : (
                        <Monitor className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-left">{previewViewportLabel}</span>
                      <ChevronDown className="size-3 shrink-0 text-[var(--kodety-text-tertiary)]" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="center"
                    className="kodety-editor-topbar-overlay z-[10010] min-w-52 rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-[var(--kodety-shadow-popover)]"
                  >
                    <DropdownMenuRadioGroup value={viewport} onValueChange={selectPreviewViewport}>
                      <DropdownMenuRadioItem
                        value="base"
                        className="h-8 min-w-0 rounded-[6px] px-2 pr-7 focus:bg-white/[.055] focus:text-[var(--kodety-text)] data-[state=checked]:bg-white/[.035] data-[state=checked]:text-[var(--kodety-text)] [&>span:last-child]:text-[var(--kodety-accent-hover)] [&>span:last-child_svg]:opacity-100"
                      >
                        <Monitor className="text-[var(--kodety-text-tertiary)]" />
                        <span className="min-w-0 flex-1 truncate">{primaryBreakpoint.label}</span>
                        <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--kodety-text-tertiary)]">{primaryBreakpoint.width}</span>
                      </DropdownMenuRadioItem>
                      {breakpoints.map(breakpoint => (
                        <DropdownMenuRadioItem
                          key={breakpoint.id}
                          value={breakpoint.id}
                          className="h-8 min-w-0 rounded-[6px] px-2 pr-7 focus:bg-white/[.055] focus:text-[var(--kodety-text)] data-[state=checked]:bg-white/[.035] data-[state=checked]:text-[var(--kodety-text)] [&>span:last-child]:text-[var(--kodety-accent-hover)] [&>span:last-child_svg]:opacity-100"
                        >
                          {breakpoint.width <= 480 ? (
                            <Smartphone className="text-[var(--kodety-text-tertiary)]" />
                          ) : breakpoint.width <= 900 ? (
                            <Square className="text-[var(--kodety-text-tertiary)]" />
                          ) : (
                            <Monitor className="text-[var(--kodety-text-tertiary)]" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{breakpoint.label}</span>
                          <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--kodety-text-tertiary)]">{breakpoint.width}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span aria-hidden="true" className={PREVIEW_CONTROL_DIVIDER_CLASS} />
                <div className="hidden h-full min-w-0 items-center gap-[2px] min-[1040px]:flex">
                  <label className="flex h-full w-[clamp(3.75rem,6vw,4.5rem)] min-w-0 items-center gap-1 rounded-[6px] px-2 text-[9px] text-[var(--kodety-text-tertiary)] transition-colors hover:bg-white/[.035]">
                    <span aria-hidden="true" className="shrink-0 font-medium">W</span>
                    <input
                      key={`${viewport}-preview-width-${currentViewport.width}`}
                      type="number"
                      min={MIN_CANVAS_VIEWPORT_SIZE}
                      max={MAX_CANVAS_VIEWPORT_WIDTH}
                      defaultValue={currentViewport.width}
                      inputMode="numeric"
                      aria-label="Largura do viewport de preview"
                      className="min-w-0 flex-1 bg-transparent text-right text-[10px] tabular-nums text-[var(--kodety-text)] shadow-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      onBlur={event => {
                        const rawValue = event.currentTarget.value.trim();
                        const value = Number(rawValue);
                        if (rawValue && Number.isFinite(value)) updateViewportSize('width', value);
                        else event.currentTarget.value = String(currentViewport.width);
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          event.currentTarget.value = String(currentViewport.width);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <span aria-hidden="true" className={PREVIEW_CONTROL_DIVIDER_CLASS} />
                  <label className="flex h-full w-[clamp(3.75rem,6vw,4.5rem)] min-w-0 items-center gap-1 rounded-[6px] px-2 text-[9px] text-[var(--kodety-text-tertiary)] transition-colors hover:bg-white/[.035]">
                    <span aria-hidden="true" className="shrink-0 font-medium">H</span>
                    <input
                      key={`${viewport}-preview-height-${currentViewport.height}`}
                      type="number"
                      min={MIN_CANVAS_VIEWPORT_SIZE}
                      max={MAX_CANVAS_VIEWPORT_HEIGHT}
                      defaultValue={currentViewport.height}
                      inputMode="numeric"
                      aria-label="Altura do viewport de preview"
                      className="min-w-0 flex-1 bg-transparent text-right text-[10px] tabular-nums text-[var(--kodety-text)] shadow-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      onBlur={event => {
                        const rawValue = event.currentTarget.value.trim();
                        const value = Number(rawValue);
                        if (rawValue && Number.isFinite(value)) updateViewportSize('height', value);
                        else event.currentTarget.value = String(currentViewport.height);
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          event.currentTarget.value = String(currentViewport.height);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <span aria-hidden="true" className={PREVIEW_CONTROL_DIVIDER_CLASS} />
                </div>
                <PreviewToolbarIconButton
                  data-preview-fit
                  aria-label="Ajustar preview ao espaço disponível"
                  tooltip="Ajustar preview"
                  onClick={fitCanvas}
                >
                  <Maximize2 className="size-3.5" />
                </PreviewToolbarIconButton>
                <span aria-hidden="true" className={PREVIEW_CONTROL_DIVIDER_CLASS} />
                <PreviewToolbarIconButton
                  data-kodety-onboarding="preview-refresh"
                  aria-label="Recarregar preview"
                  tooltip="Recarregar preview"
                  onClick={refreshFocusedPreview}
                >
                  <RefreshCw className="size-3.5" />
                </PreviewToolbarIconButton>
              </div>
            )}

            <div className="ml-auto flex items-center gap-1">
              {backupAction}
              {!isPreviewing && <WordPressEditorLockStatus />}
              {!isPreviewing && (
                <>
                  {sharedSession &&
                    (invitationRequiresActivation ? (
                      <button
                        type="button"
                        className="ml-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-[var(--kodety-accent)]/30 bg-[var(--kodety-accent)]/10 px-2 text-[9px] font-medium text-[var(--kodety-accent-hover)] transition-colors hover:bg-[var(--kodety-accent)]/15"
                        title="Criar senha ou entrar para editar"
                        onClick={() => setInvitationAccessOpen(true)}
                      >
                        <Lock className="size-3" /> Ativar edição
                      </button>
                    ) : (
                      <span
                        className="ml-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.09] bg-white/[0.045] px-2 text-[9px] font-medium text-zinc-300"
                        title={sharedReadOnly ? 'Este link não permite alterações' : 'Acesso autorizado por link privado'}
                      >
                        {sharedReadOnly ? <Eye className="size-3" /> : <Pencil className="size-3" />}
                        {sharedReadOnly ? 'Somente leitura' : 'Acesso de edição'}
                      </span>
                    ))}
                </>
              )}

              {topbarWp?.updates && (
                <HtmlKodetyUpdateIndicator
                  config={topbarWp.updates}
                  nonce={topbarWp.nonce}
                  onOpenUpdates={openKodetyUpdates}
                  topbarClassName={TOPBAR_ICON_CLASS}
                />
              )}

              {!isPreviewing && (
                framerRuntimeReadOnly ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className={TOPBAR_ICON_CLASS}
                    disabled
                    data-tooltip="Preview sempre ativo"
                    aria-label="Preview sempre ativo em sites Framer"
                  >
                    <Lock />
                  </Button>
                ) : (
                  <div className="flex h-[32px] min-h-[32px] max-h-[32px] shrink-0 overflow-visible rounded-[8px] bg-[#292929] shadow-[inset_0_0_0_1px_rgba(255,255,255,.035)]">
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      className={cn(
                        TOPBAR_ICON_CLASS,
                        'h-[32px] min-h-[32px] max-h-[32px] w-[32px] rounded-[8px] bg-[#292929] text-zinc-100 shadow-none hover:bg-[#333333]',
                        hostedPreviewAvailable && 'rounded-r-none',
                      )}
                      onClick={() => enterFocusedPreview()}
                      data-tooltip="Preview"
                      data-kodety-onboarding="design-preview"
                      aria-label="Abrir Preview"
                    >
                      <Play className="!size-3.5" />
                    </Button>
                    {hostedPreviewAvailable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="relative grid h-[32px] min-h-[32px] max-h-[32px] w-[20px] shrink-0 place-items-center rounded-r-[8px] border-0 border-l border-white/[0.07] bg-[#292929] p-0 text-zinc-400 outline-none transition-colors hover:bg-[#333333] hover:text-zinc-100 focus-visible:bg-[#333333] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                            title="URL Preview"
                            aria-label="URL Preview"
                          >
                            <ChevronDown className="size-2.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          sideOffset={7}
                          className="kodety-editor-topbar-overlay z-[10010] min-w-36"
                        >
                          <DropdownMenuItem onClick={copyPurePreviewUrl}>
                            <Copy />
                            Copy URL
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )
              )}

              {isPreviewing && (
                <div
                  data-preview-status-toolbar
                  role="toolbar"
                  className={cn(PREVIEW_CONTROL_SURFACE_CLASS, 'max-w-[min(16.25rem,28vw)] shrink-0')}
                  aria-label="Status e link do preview"
                >
                  {hostedPreviewUrl ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-preview-url
                          data-kodety-no-i18n
                          aria-label="Abrir preview limpo em nova guia"
                          onClick={() => window.open(hostedPreviewUrl, '_blank', 'noopener,noreferrer')}
                          className="flex h-full min-w-0 items-center gap-1.5 rounded-[6px] border-0 bg-transparent px-2 text-[10px] font-medium text-[var(--kodety-text-secondary)] shadow-none outline-none transition-[background-color,color] duration-100 ease-[var(--kodety-ease-ui)] hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-text)] focus-visible:ring-0"
                        >
                          <span className="relative grid size-4 shrink-0 place-items-center text-[var(--kodety-text-tertiary)]">
                            <Globe className="size-3.5" />
                            <span
                              aria-hidden="true"
                              className="absolute right-0 top-0 size-1.5 rounded-full bg-[var(--kodety-success)]"
                            />
                          </span>
                          <span className="hidden min-w-0 max-w-40 truncate min-[1380px]:block">
                            {hostedPreviewDisplayLabel}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className="z-[10020] max-w-80 border border-white/[.08] [--tooltip-surface:var(--kodety-panel)] text-[var(--kodety-text)] shadow-[var(--kodety-shadow-popover)]"
                      >
                        Abrir preview limpo em nova guia
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span
                      role="status"
                      aria-label="Preview ativo"
                      className="flex h-full min-w-0 items-center gap-1.5 px-2 text-[10px] font-medium text-[var(--kodety-text-secondary)]"
                    >
                      <span className="relative grid size-4 shrink-0 place-items-center text-[var(--kodety-text-tertiary)]">
                        <Globe className="size-3.5" />
                        <span
                          aria-hidden="true"
                          className="absolute right-0 top-0 size-1.5 rounded-full bg-[var(--kodety-success)]"
                        />
                      </span>
                      <span className="hidden min-w-0 truncate min-[1040px]:block">Preview ativo</span>
                    </span>
                  )}
                  {hostedPreviewUrl && (
                    <>
                      <span aria-hidden="true" className={PREVIEW_CONTROL_DIVIDER_CLASS} />
                      <PreviewToolbarIconButton
                        aria-label="Copiar link do preview"
                        tooltip="Copiar link do preview"
                        onClick={() => {
                          void navigator.clipboard.writeText(hostedPreviewUrl).then(
                            () => toast.success('Link do preview copiado'),
                            () => toast.error('Não foi possível copiar o link do preview'),
                          );
                        }}
                      >
                        <Copy />
                      </PreviewToolbarIconButton>
                    </>
                  )}
                </div>
              )}

              {topbarWp?.sharingUrl && !sharedSession && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 rounded-[8px] px-3 text-[11px]"
                  onClick={() => setShareDialogOpen(true)}
                >
                  Convidar
                </Button>
              )}

              {(onPublish || (topbarWp?.canPublish && !sharedReadOnly && !isShopifyThemeProject(project))) && (
                <Button
                  data-publish-trigger
                  size="sm"
                  variant="default"
                  disabled={!publishReady || isPublishing}
                  className="h-8 gap-1.5 rounded-[7px] bg-[var(--kodety-accent)] px-2.5 text-white shadow-none hover:bg-[var(--kodety-accent-hover)]"
                  onClick={onPublish || (() => setPublishPanelOpen(value => !value))}
                >
                  <Upload className="!size-3" /> {isPublishing ? 'Publicando…' : 'Publicar'}{' '}
                  <ChevronDown className="!size-3 opacity-70" />
                </Button>
              )}
            </div>
          </header>
  );
}

export const HtmlEditorTopbar = memo(HtmlEditorTopbarImpl);
