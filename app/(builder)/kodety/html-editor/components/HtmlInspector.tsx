'use client';

import { cmsFetch, cmsHostConfig } from '@/lib/html-editor/cms-host';

import { DisclosureSummary } from '@/components/ui/disclosure-summary';

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Check, ChevronDown, ClipboardCopy, ClipboardPaste, Code2, Component, Crosshair, EyeOff, ImageIcon, Languages, Layers3, Link2, Pencil, Play, Plus, RotateCcw, Save, Trash2, Type, Upload, X } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TruncatedLabel } from '@/components/ui/truncated-label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import SettingsPanel from '@/app/(builder)/kodety/html-editor/ycode-style/SettingsPanel';
import { Button as YcodeButton } from '@/app/(builder)/kodety/html-editor/ycode-style/ui/button';
import { Input as YcodeInput } from '@/app/(builder)/kodety/html-editor/ycode-style/ui/input';
import { Label as YcodeLabel } from '@/app/(builder)/kodety/html-editor/ycode-style/ui/label';
import { Popover as YcodePopover, PopoverContent as YcodePopoverContent, PopoverTrigger as YcodePopoverTrigger } from '@/app/(builder)/kodety/html-editor/ycode-style/ui/popover';
import { Select as YcodeSelect, SelectContent as YcodeSelectContent, SelectItem as YcodeSelectItem, SelectTrigger as YcodeSelectTrigger, SelectValue as YcodeSelectValue } from '@/app/(builder)/kodety/html-editor/ycode-style/ui/select';
import { Slider as YcodeSlider } from '@/app/(builder)/kodety/html-editor/ycode-style/ui/slider';
import { Switch as YcodeSwitch } from '@/app/(builder)/kodety/html-editor/ycode-style/ui/switch';
import ColorPicker from '@/app/(builder)/kodety/html-editor/ycode-style/ColorPicker';
import type { HtmlProjectFile, SelectionSnapshot } from '@/lib/html-editor/types';
import type { UtmSavedProfile } from '@/lib/html-editor/utm';
import {
  canShowCmsFieldBinding,
  cmsFieldBindingContextType,
  cmsFieldBindingForTarget,
  type CmsFieldBindingKind,
  type CmsFieldBindingTarget,
} from '@/lib/html-editor/cms-field-binding';
import {
  interactionPropertyToCss,
  type InteractionKeyframeSelection,
  type InteractionDefinition,
  type SavedInteractionPreset,
} from '@/lib/html-editor/interactions';
import { parseStyleDeclarations, serializeStyleDeclarations, stripImportantPriority } from '@/lib/html-editor/style-utils';
import { readAttachedFiles } from '@/lib/html-editor/file-attachments';
import { cn } from '@/lib/utils';
import {
  HTML_INSPECTOR_ACTION_KEYS,
  htmlInspectorActions,
  materializeHtmlInspectorModel,
  type HtmlInspectorBridgeProps,
  type HtmlInspectorTab,
  useHtmlInspectorPanelStore,
} from '@/stores/useHtmlInspectorPanelStore';
import { useHtmlTimelineStore } from '@/stores/useHtmlTimelineStore';
import { useHtmlViewportStore } from '@/stores/useHtmlViewportStore';
import {
  HtmlKodetyBackgroundsControls,
  HtmlKodetyBorderControls,
  HtmlKodetyEffectControls,
  HtmlKodetyLayoutControls,
  HtmlKodetySelfLayoutControls,
  HtmlKodetySpacingControls,
  HtmlKodetyTypographyControls,
  HtmlKodetySizingControls,
  HtmlKodetyPositionControls,
  HtmlKodetyTransformControls,
  HtmlKodetyTransitionControls,
} from './HtmlKodetyStyleControls';
import CursorControls from '../ycode-style/CursorControls';
import { HtmlInteractionsPanel } from './HtmlInteractionsPanel';
import { HtmlPageTransitionsPanel } from './HtmlPageTransitionsPanel';
import { HtmlClassSelector } from './HtmlClassSelector';
import { HtmlBreakpointDeviceIcon } from './HtmlBreakpointDeviceIcon';
import { useHtmlStylePreviewTransaction } from './useHtmlStylePreviewTransaction';
import { HtmlCmsBindings, HtmlCmsFieldBinding, HtmlCmsFilterAction, HtmlCmsFormAction } from './HtmlCmsBindings';
import { HtmlFormUtmSettings } from './HtmlFormUtmSettings';
import type { AnalyticsFeatureAccess } from './HtmlAnalyticsUi';
import {
  MIN_BREAKPOINT_WIDTH,
  normalizeBreakpointWidth,
  type CssEditingContext,
  type CssDisplayRestoreState,
  type CssBreakpoint,
  type CssPseudoState,
  type Breakpoint,
  type BreakpointMode,
} from '@/lib/html-editor/css-patcher';
import { cssAuthoringOwnDeclarations } from '@/lib/html-editor/css-authoring-origin';
import {
  resolveInspectorCustomProperties,
  resolveInspectorStyleValues,
} from '@/lib/html-editor/inspector-style-values';
import {
  commitBreakpointDraft,
  createBreakpointDraft,
  editBreakpointDraft,
  type BreakpointDraft,
} from '@/lib/html-editor/breakpoint-manager';
import { transformResponsiveValue, type FluidResponsiveConfig, type ResponsiveConversionMode } from '@/lib/html-editor/fluid-responsive';
import { getElementOuterHtml, inspectSourceElementIndex, readSourceElementInlineStyles, patchCollectionModel, patchElementAttributes, patchInsertAdjacentElement, patchRemoveElement, patchReplaceElementOuterHtml } from '@/lib/html-editor/source-patcher';
import { toast } from 'sonner';
import { buildNativeLightboxMarkup, buildNativeModalMarkup, buildNativePopoverMarkup } from '@/lib/html-editor/native-components';
import {
  formatObjectPositionFocus,
  normalizeMediaFocusPoint,
  parseObjectPositionFocus,
  type MediaFocusPoint,
} from '@/lib/html-editor/media-focus';
import {
  ClipboardImageReadError,
  readClipboardImageFile,
} from '@/lib/html-editor/media-clipboard';
import {
  designTokenCssName,
  serializeHtmlDesignTokenCss,
  type HtmlDesignTokenDocument,
} from '@/lib/html-editor/design-tokens';
import {
  useHtmlDesignTokenConnector,
} from './HtmlDesignTokens';
import type { PageTransitionDocument } from '@/lib/html-editor/page-transitions';
import {
  createHtmlComponentId,
  htmlComponentVariableHasBinding,
  withHtmlComponentVariableBinding,
  withoutHtmlComponentVariableBinding,
  type HtmlComponentVariable,
  type HtmlComponentVariableType,
} from '@/lib/html-editor/html-components';
import { HtmlComponentVariableLabel } from './HtmlComponentSystem';
import {
  HtmlSettingsActionSlot,
  HtmlSettingsFieldGlyph,
  HtmlSettingsSelectControl,
  HtmlSettingsTextControl,
  HtmlSettingsToggleControl,
  inferHtmlSettingsFieldKind,
} from './HtmlSettingsControls';

export interface ScrollbarConfig {
  width: string;
  thumbColor: string;
  trackColor: string;
  radius: string;
}

export interface LinkPageOption {
  path: string;
  label: string;
  sections: Array<{ id: string; label: string }>;
}

export interface LinkApplyRequest {
  type: 'none' | 'url' | 'page' | 'asset' | 'email' | 'phone' | 'section';
  url?: string;
  page?: string;
  section?: string;
  asset?: string;
  email?: string;
  subject?: string;
  message?: string;
  phone?: string;
  newTab: boolean;
  download?: boolean;
  noFollow?: boolean;
  useNativeStyle: boolean;
}

export interface LocaleEditingContext {
  code: string;
  name: string;
  sourceLocale: string;
  isSource: boolean;
  /** This locale owns an override for the selected layer. */
  hasDirectOverride: boolean;
  /** The rendered value comes from another locale in the fallback chain. */
  inheritedFrom?: string;
  /** Layer was inserted only in this locale and has no source-locale peer. */
  exclusive?: boolean;
}

export interface HtmlInspectorProps {
  width: number;
  tabRequest?: {
    tab: 'design' | 'settings' | 'interactions';
    sequence: number;
  };
  /** Keep the complete Inspector navigable while preventing field mutation. */
  readOnly?: boolean;
  designTokens: HtmlDesignTokenDocument;
  onDesignTokensChange: (next: HtmlDesignTokenDocument) => void;
  onDesignTokenEdit: (tokenId: string) => void;
  /** A schema endpoint only exposes the CMS feature. This identifies a page
   * whose selected fields can actually resolve against a template item. */
  cmsTemplatePostType?: string;
  cmsAvailable?: boolean;
  /** Checkout models saved in Analytics → Central de UTMs. */
  utmProfiles?: UtmSavedProfile[];
  /** Server-derived Analytics plan used to gate UTM activation in forms. */
  analyticsFeatureAccess?: AnalyticsFeatureAccess;
  componentControls?: ReactNode;
  /**
   * Treat the selected HTML component instance as an atomic layer. Its exposed
   * properties are the only Settings authority; native element editors would
   * mutate the materialized DOM without updating component overrides.
   */
  htmlComponentInstanceSelected?: boolean;
  componentVariableContext?: {
    componentId: string;
    variables: HtmlComponentVariable[];
  };
  onComponentVariablesChange?: (variables: HtmlComponentVariable[]) => void;
  onManageComponentVariables?: (variableId?: string) => void;
  membershipControls?: ReactNode;
  membershipFocusKey?: string;
  /** Variant-aware Set Variant editor shown instead of DOM interactions. */
  componentInteractions?: ReactNode;
  selection: SelectionSnapshot | null;
  selectionCount?: number;
  onTextChange: (value: string) => void;
  containerLines: string[] | null;
  onContainerTextChange: (lines: string[]) => void;
  onAttributeChange: (name: string, value: string) => void;
  onAttributesChange: (changes: Record<string, string>) => void;
  localeEditing?: LocaleEditingContext;
  onResetLocaleOverride?: () => void;
  onStyleChange: (name: string, value: string) => void;
  onVisibilityChange?: (visible: boolean) => void;
  displayRestoreState?: CssDisplayRestoreState | null;
  /** Project/session/page and multi-selection identity for visual gestures. */
  styleEditScopeKey?: string;
  /** Paint a transient canvas-only value without touching source/history. */
  onStylePreview?: (name: string, value: string, flushImmediately?: boolean) => void;
  /** Clear all transient paint after Escape, pointer cancellation or unmount. */
  onStylePreviewCancel?: () => void;
  styleClipboard: Record<string, string> | null;
  onCopyStyleProperty: (property: string, value: string) => void;
  onCopyAllStyles: () => void;
  onPasteStyleProperty: (property: string) => void;
  onPasteAllStyles: () => void;
  keyframeStyles?: Record<string, string>;
  keyframeLabel?: string;
  source: string;
  onSourceChange: (source: string) => void;
  /** Selects/reveals another authored layer in the canvas and Layers panel. */
  onSelectPath?: (path: string) => void;
  onInteractionSourceChange?: (source: string) => void;
  savedAnimations?: SavedInteractionPreset[];
  onSaveAnimation?: (interaction: InteractionDefinition, name: string) => void;
  onRemoveSavedAnimation?: (presetId: string) => void;
  pageTransitions: PageTransitionDocument;
  homePage: string;
  onPageTransitionsChange: (document: PageTransitionDocument) => void;
  onTimelineOpen: (interactionId?: string, actionId?: string) => void;
  onBeginInteractionTargetPick: (onPick: (selection: SelectionSnapshot) => void) => void;
  onOpenEffectsLibrary?: () => void;
  cssFiles: string[];
  cssContext: CssEditingContext;
  cssRuleStyles: Record<string, string>;
  /** Same selector/pseudo but pinned to the base breakpoint — the inheritance fallback. */
  baseBreakpointStyles: Record<string, string>;
  onCssContextChange: (
    context: CssEditingContext | ((current: CssEditingContext) => CssEditingContext),
  ) => void;
  onRenameClass: (oldName: string, newName: string) => void;
  onDuplicateClass: (sourceName: string) => void;
  reusableClasses: string[];
  onRegisterReusableClass: (name: string) => boolean | void;
  onChangeTag: (newTag: string) => void;
  cssFileOptions: string[];
  jsFileOptions: string[];
  onAttachFile: (type: 'css' | 'js', filePath: string) => void;
  onDetachFile: (type: 'css' | 'js', filePath: string) => void;
  onCreateAndAttachFile: (type: 'css' | 'js', name: string) => void;
  primaryBreakpoint: Breakpoint;
  onPrimaryBreakpointChange: (next: Breakpoint) => void;
  breakpoints: Breakpoint[];
  onBreakpointsChange: (next: Breakpoint[]) => void;
  /** Which breakpoint the canvas is currently previewing ('base' = desktop). */
  activeBreakpoint: string;
  onSelectBreakpoint: (id: string) => void;
  selectionStyles: Record<string, string>;
  liveStyleValues?: Record<string, string>;
  onSelectionStyleChange: (property: string, value: string) => void;
  scrollbarStyles: ScrollbarConfig;
  onScrollbarChange: (next: ScrollbarConfig) => void;
  onResponsiveApply: (config: FluidResponsiveConfig, mode: ResponsiveConversionMode) => void;
  linkPages: LinkPageOption[];
  currentPage: string;
  onLinkApply: (request: LinkApplyRequest) => void;
  onScrollSectionApply: (id: string, offsetY: number) => void;
  mediaAssets: HtmlProjectFile[];
  currentMediaAssetPath: string | null;
  onMediaAssetSelect: (path: string) => void;
  onMediaSourceChange: (value: string) => void;
  onMediaUpload: (file: File) => void | string | Promise<void | string>;
  cmsPreview?: { item: { id: number; revision?: string; values: Record<string, unknown> } | null; items: Array<{ id: number; revision?: string; values: Record<string, unknown> }>; postType: string } | null;
  onCmsPreviewChange?: (payload: { item: { id: number; revision?: string; values: Record<string, unknown> } | null; items: Array<{ id: number; revision?: string; values: Record<string, unknown> }>; postType: string } | null) => void;
}

interface AuthoredOverlayOption {
  rootPath: string;
  surfacePath: string;
  id: string;
  kind: string;
  label: string;
  managed: boolean;
}

const OVERLAY_CONTROL_ATTRIBUTES = [
  'data-kodety-overlay-target',
  'data-kodety-overlay-toggle',
  'data-kodety-overlay-open',
  'data-kodety-overlay-trigger',
  'aria-controls',
] as const;

function cleanOverlayToken(value: string | undefined) {
  const token = (value || '').trim().split(/\s+/)[0] || '';
  return token.replace(/^#/, '');
}

function authoredOverlayOptions(source: string): AuthoredOverlayOption[] {
  // The overwhelming majority of pages do not author an overlay. Do not
  // build or scan a document tree for them on every source revision.
  if (!/\bdata-kodety-overlay(?=[\s=/>])/i.test(source)) return [];
  try {
    const elements = inspectSourceElementIndex(source).elements;
    const overlays: AuthoredOverlayOption[] = [];
    elements.forEach(node => {
      if (node.attributes['data-kodety-overlay'] === undefined) return;
      const descendantPrefix = `${node.path}/`;
      const surface = node.attributes['data-kodety-overlay-surface'] !== undefined
        ? node
        : elements.find(candidate => (
            candidate.path.startsWith(descendantPrefix)
            && candidate.attributes['data-kodety-overlay-surface'] !== undefined
          ));
      const kind = node.attributes['data-kodety-overlay'] || 'overlay';
      const id = surface?.attributes.id || node.attributes.id;
      if (!surface || !id) return;
      overlays.push({
        rootPath: node.path,
        surfacePath: surface.path,
        id,
        kind,
        label: node.attributes['data-label'] || `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
        managed: node.attributes['data-kodety-overlay-managed'] === 'true',
      });
    });
    return overlays;
  } catch {
    return [];
  }
}

function overlayLinkedToSelection(
  selection: SelectionSnapshot | null,
  overlays: AuthoredOverlayOption[],
) {
  if (!selection) return null;
  for (const attribute of OVERLAY_CONTROL_ATTRIBUTES) {
    const token = cleanOverlayToken(selection.attributes[attribute]);
    if (!token || token === 'true' || token === 'false') continue;
    const match = overlays.find(overlay => overlay.id === token);
    if (match) return match;
  }
  if (selection.attributes['data-kodefy-checkout'] !== undefined) {
    return overlays.find(overlay => overlay.kind === 'checkout') || null;
  }
  return null;
}

interface FieldRowProps {
  label: ReactNode;
  ariaLabel?: string;
  value: string;
  onCommit: (value: string) => void;
  tokenProperty?: string;
  multiline?: boolean;
  inherited?: boolean;
  action?: ReactNode;
  connected?: boolean;
  saving?: boolean;
  rowClassName?: string;
  inputClassName?: string;
  replacement?: ReactNode;
}

function FieldRow({ label, ariaLabel, value, onCommit, tokenProperty, multiline = false, inherited = false, action, connected = false, saving = false, rowClassName, inputClassName, replacement }: FieldRowProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (next = draft) => { if (next !== value) onCommit(next); };
  const fieldLabel = ariaLabel || (typeof label === 'string' ? label : 'Field');
  return (
    <div
      className={cn('grid grid-cols-3 items-start gap-x-2 gap-y-2', rowClassName)}
      data-design-token-property={tokenProperty}
    >
      <div className="flex min-w-0 items-center gap-1 pt-2">
        {typeof label === 'string' ? <YcodeLabel variant="muted">{label}</YcodeLabel> : label}
        {action}
      </div>
      <div className="relative col-span-2 min-w-0 *:w-full">
        {replacement || (
          <HtmlSettingsTextControl
            value={draft}
            label={fieldLabel}
            kind={inferHtmlSettingsFieldKind(fieldLabel)}
            multiline={multiline}
            inherited={inherited}
            connected={connected}
            onChange={setDraft}
            onCommit={next => { if (!connected) commit(next); }}
            inputClassName={inputClassName}
          />
        )}
        {connected && <YcodeButton
          type="button" size="xs"
          variant="secondary"
          className="mt-2 w-full"
          disabled={saving || draft === value}
          onClick={() => commit()}
                      ><Save className="size-3" /> {saving ? 'Saving…' : 'Save to WordPress'}</YcodeButton>}
      </div>
    </div>
  );
}

function KodetyClassFieldRow({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="mb-2.5 grid min-h-7 grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <div className="flex min-w-0 items-center gap-1 pt-1.5">
        <TruncatedLabel variant="muted" className="text-[10px]">Classes</TruncatedLabel>
      </div>
      <div className="relative min-w-0">
        <Input
          value={draft}
          aria-label="Classes"
          onChange={event => {
            const next = event.target.value;
            setDraft(next);
            onCommit(next);
          }}
          disableKeyboardStep
          className="h-7 rounded-[7px] bg-input/30 text-[10px]"
        />
      </div>
    </div>
  );
}

function MediaSourceRow({
  value,
  assets,
  currentAssetPath,
  onAssetSelect,
  onCommit,
  onUpload,
  accept,
  action,
  connected,
  saving,
  uploading,
  label = 'Source',
  replacement,
}: {
  value: string;
  assets: HtmlProjectFile[];
  currentAssetPath: string | null;
  onAssetSelect: (path: string) => void;
  onCommit: (value: string) => void;
  onUpload: (file: File) => void | string | Promise<void | string>;
  accept: string;
  action?: ReactNode;
  connected: boolean;
  saving: boolean;
  uploading: boolean;
  label?: ReactNode;
  replacement?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [uploadPending, setUploadPending] = useState(false);
  const [pasting, setPasting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  const currentAsset = assets.find(asset => asset.path === currentAssetPath);
  const displayValue = currentAsset?.path.split('/').pop() || value || 'Selecionar origem';
  const mediaKind = accept.includes('video') ? 'video' : accept.includes('audio') ? 'audio' : 'image';
  const mediaBusy = saving || uploading || uploadPending || pasting;
  const commit = () => {
    if (draft !== value) onCommit(draft);
    setOpen(false);
  };
  const applyUploadedFile = async (file: File) => {
    const uploadedAssetPath = await onUpload(file);
    if (uploadedAssetPath) {
      // Use the same proven source-update path as a manual click in the Assets
      // list. The upload callback has already installed the binary in Project.
      onAssetSelect(uploadedAssetPath);
      toast.success('Mídia adicionada e aplicada', { description: uploadedAssetPath });
    }
    setOpen(false);
  };
  const uploadSelectedFile = async (file: File) => {
    if (mediaBusy) return;
    setUploadPending(true);
    try {
      await applyUploadedFile(file);
    } catch (error) {
      toast.error('Não foi possível aplicar a mídia', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setUploadPending(false);
    }
  };
  const pasteClipboardImage = async () => {
    if (mediaBusy || mediaKind !== 'image') return;
    setPasting(true);
    try {
      const file = await readClipboardImageFile();
      await applyUploadedFile(file);
    } catch (error) {
      toast.error(
        error instanceof ClipboardImageReadError && error.code === 'empty'
          ? 'Nenhuma imagem'
          : 'Não foi possível aplicar a mídia',
      );
    } finally {
      setPasting(false);
    }
  };
  return (
    <div data-media-source-control className="grid grid-cols-3 items-start gap-x-2 gap-y-2">
      <div className="flex min-w-0 items-center gap-1 pt-2">
        {typeof label === 'string' ? <YcodeLabel variant="muted">{label}</YcodeLabel> : label}
        {action}
      </div>
      {replacement
        ? <div className="col-span-2 min-w-0 *:w-full">{replacement}</div>
        : <YcodePopover open={open} onOpenChange={setOpen}>
        <YcodePopoverTrigger asChild>
          <button
            type="button"
            aria-label="Select media source"
            className={cn(
              'col-span-2 flex h-9 min-w-0 items-center gap-0 overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] pr-2.5 text-left text-[11px] outline-none transition-colors',
              'hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075]',
              connected && 'border-[var(--kodety-accent-hover)]/20 bg-[var(--kodety-accent-hover)]/[0.06]',
            )}
          >
            <span className="mr-2 grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/32">
              {connected
                ? <Link2 className="size-3.5 text-[var(--kodety-accent-hover)]" />
                : <HtmlSettingsFieldGlyph kind={mediaKind} />}
            </span>
            <span data-kodety-no-i18n={currentAsset || value ? true : undefined} className="min-w-0 flex-1 truncate">{displayValue}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </YcodePopoverTrigger>
        <YcodePopoverContent align="end" className="w-72 overflow-hidden rounded-xl p-0">
          <div className="space-y-2 border-b border-border/60 p-2.5">
            <div>
              <p className="text-[11px] font-medium text-foreground">Origem da mídia</p>
              <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
                {connected ? 'Connected to CMS. Changes update the item without removing its binding.' : 'Paste a URL or choose a project asset.'}
              </p>
            </div>
            <div className="flex gap-1.5">
              <HtmlSettingsTextControl
                value={draft}
                label="Media URL or path"
                kind={mediaKind}
                placeholder="File URL or path"
                className="h-8 flex-1"
                onChange={setDraft}
                onCommit={commit}
              />
              <YcodeButton
                type="button"
                size="xs"
                className="h-8 shrink-0 rounded-[7px]"
                disabled={saving || draft === value}
                onClick={commit}
              >
                {saving ? 'Saving…' : connected ? 'Save' : 'Apply'}
              </YcodeButton>
            </div>
          </div>
          {!connected && (
            <div className="border-b border-border/60 p-1.5">
              <p className="px-2 pb-1 pt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Assets do projeto</p>
              <div className="max-h-44 overflow-y-auto">
                {assets.length ? assets.map(asset => (
                  <button
                    key={asset.path}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[10px] hover:bg-accent"
                    onClick={() => {
                      onAssetSelect(asset.path);
                      setOpen(false);
                    }}
                  >
                    <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" data-kodety-no-i18n>{asset.path.split('/').pop()}</span>
                    {asset.path === currentAssetPath && <Check className="size-3.5 shrink-0 text-[var(--kodety-accent-hover)]" />}
                  </button>
                )) : <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">No compatible assets.</p>}
              </div>
            </div>
          )}
          <button
            data-media-upload-trigger
            type="button"
            disabled={mediaBusy}
            className="flex h-10 w-full items-center gap-2 px-3 text-left text-[10px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5 text-muted-foreground" />
            {uploading || uploadPending ? 'Uploading to WordPress…' : connected ? 'Upload image to this item' : 'Upload new file'}
          </button>
          {mediaKind === 'image' && (
            <button
              data-media-clipboard-paste
              type="button"
              aria-label="Colar aqui"
              aria-busy={pasting}
              disabled={mediaBusy}
              className="flex h-10 w-full items-center gap-2 border-t border-border/60 px-3 text-left text-[10px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void pasteClipboardImage()}
            >
              <ClipboardPaste className="size-3.5 text-muted-foreground" />
              Colar aqui
            </button>
          )}
        </YcodePopoverContent>
          </YcodePopover>}
      {!replacement && (
        <input
          ref={fileInputRef}
          data-media-upload-input
          type="file"
          className="sr-only"
          accept={accept}
          disabled={mediaBusy}
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            if (file) void uploadSelectedFile(file);
            event.currentTarget.value = '';
          }}
        />
      )}
    </div>
  );
}

function CombinedTextEditor({ lines, onCommit }: { lines: string[]; onCommit: (lines: string[]) => void }) {
  const joined = lines.join('\n');
  const [draft, setDraft] = useState(joined);
  useEffect(() => setDraft(joined), [joined]);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2"><Type className="size-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Texto combinado · {lines.length} segmento{lines.length > 1 ? 's' : ''}</span></div>
      <HtmlSettingsTextControl
        value={draft}
        label="Texto combinado"
        kind="text"
        multiline
        onChange={nextDraft => {
          setDraft(nextDraft);
          const next = nextDraft.split('\n');
          if (next.join('\n') !== joined) onCommit(next);
        }}
        className="min-h-24"
        inputClassName="text-xs leading-relaxed"
      />
      <p className="text-[9px] leading-relaxed text-muted-foreground">Each line is a span and keeps its own style. Add or remove lines to change the segments.</p>
    </div>
  );
}

function DraftInput({ value, onCommit, className, placeholder }: { value: string; onCommit: (value: string) => void; className?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <YcodeInput
      value={draft}
      placeholder={placeholder ?? '—'}
      onChange={event => {
        const next = event.target.value;
        setDraft(next);
        onCommit(next);
      }}
      disableKeyboardStep
      className={className}
    />
  );
}

function AttributeSelectRow({ label, value, options, onChange, placeholder = '—' }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="grid grid-cols-3 items-center gap-2">
      <YcodeLabel variant="muted">{label}</YcodeLabel>
      <div className="col-span-2 *:w-full">
        <HtmlSettingsSelectControl
          label={label}
          value={value}
          onChange={onChange}
          options={options}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

function YcodeSettingsRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-3 items-center gap-2', className)}>
      {typeof label === 'string' ? <YcodeLabel variant="muted">{label}</YcodeLabel> : label}
      <div className="col-span-2 min-w-0 *:w-full">{children}</div>
    </div>
  );
}

function BooleanAttributeRow({ label, checked, onChange, description, alignSwitchEnd = false }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  alignSwitchEnd?: boolean;
}) {
  void alignSwitchEnd;
  return (
    <HtmlSettingsToggleControl
      label={label}
      description={description}
      checked={checked}
      onChange={onChange}
    />
  );
}

function readUrlParam(value: string, name: string) {
  try {
    const url = new URL(value, 'https://incode.local');
    return url.searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function patchUrlParam(value: string, name: string, nextValue: string) {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
    const url = new URL(value || '/', 'https://incode.local');
    if (nextValue) url.searchParams.set(name, nextValue); else url.searchParams.delete(name);
    return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function retainEmbedParams(nextValue: string, currentValue: string) {
  try {
    const next = new URL(nextValue);
    const current = new URL(currentValue);
    current.searchParams.forEach((value, name) => {
      if (!next.searchParams.has(name)) next.searchParams.set(name, value);
    });
    return next.toString();
  } catch {
    return nextValue;
  }
}

function normalizeYouTubeEmbed(value: string) {
  const input = value.trim();
  if (!input) return '';
  const idOnly = input.match(/^[A-Za-z0-9_-]{11}$/)?.[0];
  if (idOnly) return `https://www.youtube.com/embed/${idOnly}`;
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '');
    const videoId = host === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([^/?#]+)/)?.[1];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : input;
  } catch {
    return input;
  }
}

function youtubeControlValue(src: string) {
  const id = src.match(/youtube(?:-nocookie)?\.com\/embed\/([^?&#]+)/)?.[1];
  return id ? `https://youtu.be/${id}` : src;
}

function youtubeVideoId(src: string) {
  return src.match(/youtube(?:-nocookie)?\.com\/embed\/([^?&#]+)/)?.[1] || '';
}

function updateYouTubeVideo(currentSrc: string, value: string) {
  let next = normalizeYouTubeEmbed(value);
  if (!next) return '';
  next = retainEmbedParams(next, currentSrc);
  if (currentSrc.includes('youtube-nocookie.com')) {
    next = next.replace('youtube.com', 'youtube-nocookie.com');
  }
  if (readUrlParam(next, 'loop') === '1') {
    next = patchUrlParam(next, 'playlist', youtubeVideoId(next));
  }
  return next;
}

function patchYouTubeLoop(src: string, checked: boolean) {
  const next = patchUrlParam(src, 'loop', checked ? '1' : '0');
  return patchUrlParam(next, 'playlist', checked ? youtubeVideoId(next) : '');
}

function normalizeVimeoEmbed(value: string) {
  const input = value.trim();
  if (!input) return '';
  if (/^\d+$/.test(input)) return `https://player.vimeo.com/video/${input}`;
  try {
    const url = new URL(input);
    const videoId = url.pathname.split('/').filter(Boolean).reverse().find(part => /^\d+$/.test(part));
    if (!videoId) return input;
    const embed = new URL(`https://player.vimeo.com/video/${videoId}`);
    const privacyHash = url.searchParams.get('h');
    if (privacyHash) embed.searchParams.set('h', privacyHash);
    return embed.toString();
  } catch {
    return input;
  }
}

function vimeoControlValue(src: string) {
  const id = src.match(/player\.vimeo\.com\/video\/(\d+)/)?.[1];
  return id ? `https://vimeo.com/${id}` : src;
}

function updateVimeoVideo(currentSrc: string, value: string) {
  const next = normalizeVimeoEmbed(value);
  return next ? retainEmbedParams(next, currentSrc) : '';
}

interface TabsItem {
  id: string;
  label: string;
  content: string;
}

interface TabsModel {
  active: number;
  orientation: 'horizontal' | 'vertical';
  activation: 'auto' | 'manual';
  items: TabsItem[];
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function tabsSlug(value: string, index: number) {
  const slug = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `tab-${index + 1}`;
}

function readTabsModel(markup: string, attributes: Record<string, string>): TabsModel | null {
  if (!markup || !/\brole\s*=/i.test(markup) || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return null;
  const tabs = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
  if (!tabs.length) return null;
  const activeFromAttr = Number(attributes['data-tabs-active']);
  const activeFromDom = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  const active = Number.isFinite(activeFromAttr) ? activeFromAttr : Math.max(activeFromDom, 0);
  return {
    active: Math.min(Math.max(active, 0), tabs.length - 1),
    orientation: attributes['data-tabs-orientation'] === 'vertical' ? 'vertical' : 'horizontal',
    activation: attributes['data-tabs-activation'] === 'manual' ? 'manual' : 'auto',
    items: tabs.map((tab, index) => {
      const panelId = tab.getAttribute('aria-controls') || panels[index]?.id || `panel-${index + 1}`;
      const panel = panels.find(item => item.id === panelId) || panels[index];
      return {
        id: tab.id || tabsSlug(tab.textContent || '', index),
        label: tab.textContent?.trim() || `Tab ${index + 1}`,
        content: panel?.innerHTML?.trim() || `<p>Tab ${index + 1} content</p>`,
      };
    }),
  };
}

function serializeTabsModel(model: TabsModel) {
  const active = Math.min(Math.max(model.active, 0), Math.max(model.items.length - 1, 0));
  const flexDirection = model.orientation === 'vertical' ? 'column' : 'row';
  const tabs = model.items.map((item, index) => {
    const base = tabsSlug(item.label, index);
    const tabId = item.id || `${base}-tab`;
    const panelId = `${base}-panel`;
    const selected = index === active;
    return `<button id="${escapeHtmlAttribute(tabId)}" type="button" role="tab" aria-selected="${selected ? 'true' : 'false'}" aria-controls="${escapeHtmlAttribute(panelId)}" tabindex="${selected ? '0' : '-1'}" style="appearance: none; -webkit-appearance: none; margin: 0; padding: 8px 12px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; line-height: inherit; cursor: pointer;">${escapeHtml(item.label)}</button>`;
  }).join('');
  const panels = model.items.map((item, index) => {
    const base = tabsSlug(item.label, index);
    const tabId = item.id || `${base}-tab`;
    const panelId = `${base}-panel`;
    const selected = index === active;
    return `<div id="${escapeHtmlAttribute(panelId)}" role="tabpanel" aria-labelledby="${escapeHtmlAttribute(tabId)}"${selected ? '' : ' hidden'} style="padding-top: 12px;">${item.content || `<p>${escapeHtml(item.label)} content</p>`}</div>`;
  }).join('');
  return `<div data-label="Tabs" data-incode-component="tabs" data-tabs-active="${active}" data-tabs-orientation="${model.orientation}" data-tabs-activation="${model.activation}"><div role="tablist" aria-orientation="${model.orientation}" style="display: flex; flex-direction: ${flexDirection}; gap: 8px;">${tabs}</div>${panels}</div>`;
}

interface LinkItemModel {
  label: string;
  href: string;
  extra?: string;
}

function readLinkItems(markup: string) {
  if (!markup || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  return Array.from(doc.body.querySelectorAll<HTMLAnchorElement>('a')).map(anchor => ({
    label: anchor.textContent?.trim() || 'Link',
    href: anchor.getAttribute('href') || '#',
    extra: anchor.getAttribute('hreflang') || '',
  }));
}

function serializeLinkItems(items: LinkItemModel[], locale = false) {
  return items.map(item => `<li><a href="${escapeHtmlAttribute(item.href || '#')}"${locale && item.extra ? ` hreflang="${escapeHtmlAttribute(item.extra)}"` : ''}>${escapeHtml(item.label || 'Link')}</a></li>`).join('');
}

interface DropdownModel {
  label: string;
  open: boolean;
  items: LinkItemModel[];
}

function readDropdownModel(markup: string, attributes: Record<string, string>): DropdownModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const root = doc.body.querySelector('details');
  if (!root) return null;
  return {
    label: root.querySelector('summary')?.textContent?.trim() || 'Dropdown',
    open: 'open' in attributes,
    items: readLinkItems(markup),
  };
}

function serializeDropdownModel(model: DropdownModel) {
  return `<details data-label="Dropdown" data-incode-component="dropdown"${model.open ? ' open' : ''} style="display: inline-block; position: relative;"><summary style="cursor: pointer;">${escapeHtml(model.label || 'Dropdown')}</summary><div style="display: grid; gap: 8px; padding: 12px;">${model.items.map(item => `<a href="${escapeHtmlAttribute(item.href || '#')}">${escapeHtml(item.label || 'Option')}</a>`).join('')}</div></details>`;
}

interface NavbarModel {
  brand: LinkItemModel;
  items: LinkItemModel[];
}

function readNavbarModel(markup: string): NavbarModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const nav = doc.body.querySelector('nav');
  if (!nav) return null;
  const anchors = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a'));
  const brandAnchor = anchors.find(anchor => anchor.hasAttribute('data-nav-brand')) || anchors[0];
  return {
    brand: {
      label: brandAnchor?.textContent?.trim() || 'Brand',
      href: brandAnchor?.getAttribute('href') || '#',
    },
    items: anchors.filter(anchor => anchor !== brandAnchor).map(anchor => ({
      label: anchor.textContent?.trim() || 'Link',
      href: anchor.getAttribute('href') || '#',
    })),
  };
}

function serializeNavbarModel(model: NavbarModel) {
  return `<nav data-label="Navbar" data-incode-component="navbar" style="display: flex; align-items: center; justify-content: space-between; gap: 24px;"><a href="${escapeHtmlAttribute(model.brand.href || '#')}" data-nav-brand>${escapeHtml(model.brand.label || 'Brand')}</a><div data-nav-links style="display: flex; gap: 16px;">${model.items.map(item => `<a href="${escapeHtmlAttribute(item.href || '#')}">${escapeHtml(item.label || 'Link')}</a>`).join('')}</div></nav>`;
}

interface SliderModel {
  active: number;
  slides: string[];
}

function readSliderModel(markup: string, attributes: Record<string, string>): SliderModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return null;
  const slides = Array.from(root.querySelectorAll<HTMLElement>('[data-slide]')).map(slide => slide.innerHTML.trim() || '<div><h2>Slide</h2><p>Slide content</p></div>');
  if (!slides.length) return null;
  const active = Number(attributes['data-slider-active']);
  return { active: Number.isFinite(active) ? Math.min(Math.max(active, 0), slides.length - 1) : 0, slides };
}

function serializeSliderModel(model: SliderModel) {
  const active = Math.min(Math.max(model.active, 0), Math.max(model.slides.length - 1, 0));
  const buttonStyle = 'appearance: none; -webkit-appearance: none; display: inline-flex; align-items: center; justify-content: center; margin: 0; padding: 8px 12px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;';
  return `<section data-label="Slider" data-incode-component="slider" data-slider-active="${active}" style="overflow: hidden;">${model.slides.map((slide, index) => `<div data-label="Slide" data-slide${index === active ? '' : ' hidden'} style="min-height: 220px; display: grid; place-items: center;">${slide || `<div><h2>Slide ${index + 1}</h2><p>Slide content</p></div>`}</div>`).join('')}<div data-slider-controls style="display: flex; align-items: center; justify-content: space-between; gap: 8px;"><button type="button" data-slider-prev style="${buttonStyle}">Previous</button><span data-slider-status aria-live="polite">${active + 1} / ${model.slides.length}</span><button type="button" data-slider-next style="${buttonStyle}">Next</button></div></section>`;
}

interface PictureModel {
  mobile: string;
  desktop: string;
  src: string;
  alt: string;
  loading: string;
}

function readPictureModel(markup: string): PictureModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const picture = doc.body.querySelector('picture');
  if (!picture) return null;
  const sources = Array.from(picture.querySelectorAll('source'));
  const img = picture.querySelector('img');
  return {
    mobile: sources.find(source => source.getAttribute('media')?.includes('max-width'))?.getAttribute('srcset') || '',
    desktop: sources.find(source => source.getAttribute('media')?.includes('min-width'))?.getAttribute('srcset') || '',
    src: img?.getAttribute('src') || '',
    alt: img?.getAttribute('alt') || '',
    loading: img?.getAttribute('loading') || '',
  };
}

function serializePictureModel(model: PictureModel) {
  return `<picture data-label="Picture" data-incode-component="picture" style="display: block; width: 100%;"><source media="(max-width: 767px)" srcset="${escapeHtmlAttribute(model.mobile)}"><source media="(min-width: 768px)" srcset="${escapeHtmlAttribute(model.desktop)}"><img src="${escapeHtmlAttribute(model.src)}" alt="${escapeHtmlAttribute(model.alt)}"${model.loading ? ` loading="${escapeHtmlAttribute(model.loading)}"` : ''} style="display: block; width: 100%; height: auto;"></picture>`;
}

interface LightboxModel {
  href: string;
  src: string;
  alt: string;
}

function readLightboxModel(markup: string, attributes: Record<string, string>): LightboxModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const root = doc.body.querySelector<HTMLElement>('[data-kodety-lightbox], [data-incode-component="lightbox"]');
  if (!root) return null;
  const img = root.querySelector<HTMLImageElement>('[data-kodety-lightbox-thumb], img');
  return {
    href: root.getAttribute('data-kodety-lightbox-src') || attributes.href || '',
    src: img?.getAttribute('src') || '',
    alt: img?.getAttribute('alt') || '',
  };
}

function serializeLightboxModel(model: LightboxModel) {
  return buildNativeLightboxMarkup({
    fullSource: model.href,
    thumbnailSource: model.src,
    alt: model.alt,
  });
}

interface CodeBlockModel {
  language: string;
  code: string;
}

function readCodeBlockModel(markup: string): CodeBlockModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const pre = doc.body.querySelector('pre');
  const code = pre?.querySelector('code');
  if (!pre || !code) return null;
  return {
    language: Array.from(code.classList).find(className => className.startsWith('language-'))?.replace('language-', '') || '',
    code: code.textContent || '',
  };
}

function serializeCodeBlockModel(model: CodeBlockModel) {
  return `<pre data-label="Code Block" data-incode-component="code-block"><code${model.language ? ` class="language-${escapeHtmlAttribute(model.language)}"` : ''}>${escapeHtml(model.code)}</code></pre>`;
}

interface SelectOptionModel {
  label: string;
  value: string;
  selected: boolean;
  disabled: boolean;
}

function readSelectOptions(markup: string): SelectOptionModel[] {
  if (!markup || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  return Array.from(doc.body.querySelectorAll('select > option')).map(option => ({
    label: option.textContent || '',
    value: option.getAttribute('value') || '',
    selected: option.hasAttribute('selected'),
    disabled: option.hasAttribute('disabled'),
  }));
}

function SelectOptionChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="grid min-h-8 grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <Label variant="muted" className="text-[10px]">{label}</Label>
      <div className="grid grid-cols-2 rounded-[8px] bg-muted/70 p-0.5">
        <button
          type="button"
          className={cn(
            'h-7 rounded-[6px] text-[10px] font-medium text-muted-foreground transition-colors',
            value && 'bg-accent text-foreground shadow-sm ring-1 ring-border/70',
          )}
          onClick={() => onChange(true)}
        >
          Sim
        </button>
        <button
          type="button"
          className={cn(
            'h-7 rounded-[6px] text-[10px] font-medium text-muted-foreground transition-colors',
            !value && 'bg-accent text-foreground shadow-sm ring-1 ring-border/70',
          )}
          onClick={() => onChange(false)}
        >
          Não
        </button>
      </div>
    </div>
  );
}

function SelectOptionsEditor({
  options,
  onChange,
}: {
  options: SelectOptionModel[];
  onChange: (options: SelectOptionModel[]) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  useEffect(() => {
    if (openIndex !== null && openIndex >= options.length) setOpenIndex(options.length ? options.length - 1 : null);
  }, [openIndex, options.length]);

  const updateOption = (index: number, patch: Partial<SelectOptionModel>) => {
    onChange(options.map((option, optionIndex) => {
      if (optionIndex === index) return { ...option, ...patch };
      if (patch.selected === true) return { ...option, selected: false };
      return option;
    }));
  };
  const removeOption = (index: number) => {
    onChange(options.filter((_, optionIndex) => optionIndex !== index));
    setOpenIndex(current => current === index ? null : current !== null && current > index ? current - 1 : current);
  };
  const moveOption = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setOpenIndex(current => current === index ? target : current === target ? index : current);
  };
  const addOption = () => {
    const number = options.length + 1;
    const next = [
      ...options,
      {
        label: `Opção ${number}`,
        value: `option-${number}`,
        selected: options.length === 0,
        disabled: false,
      },
    ];
    onChange(next);
    setOpenIndex(next.length - 1);
  };

  return (
    <div data-select-options-editor className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2">
      <Label variant="muted" className="pt-2 text-[10px]">Opções</Label>
      <div className="min-w-0 space-y-1.5">
        {options.map((option, index) => (
          <Popover
            key={index}
            open={openIndex === index}
            onOpenChange={open => setOpenIndex(open ? index : null)}
          >
            <div className="group flex h-10 min-w-0 items-center rounded-[10px] border border-border/70 bg-transparent p-1 transition-colors hover:border-border">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                  aria-label={`Edit option ${option.label || index + 1}`}
                >
                  <span className={cn('grid size-7 shrink-0 place-items-center text-muted-foreground', option.selected && 'text-[var(--kodety-accent-hover)]', option.disabled && 'opacity-45')}>
                    <ChevronDown className="size-3.5 stroke-[2.5]" />
                  </span>
                  <span className={cn(
                    'min-w-0 flex-1 truncate text-[11px] font-medium',
                    option.disabled && 'text-muted-foreground line-through decoration-muted-foreground/50',
                  )}>
                    {option.label || 'Sem título'}
                  </span>
                </button>
              </PopoverTrigger>
              <button
                type="button"
                className="size-6 shrink-0 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
                aria-label={`Mover ${option.label || index + 1} para cima`}
                disabled={index === 0}
                onClick={() => moveOption(index, -1)}
              >↑</button>
              <button
                type="button"
                className="size-6 shrink-0 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
                aria-label={`Mover ${option.label || index + 1} para baixo`}
                disabled={index === options.length - 1}
                onClick={() => moveOption(index, 1)}
              >↓</button>
              <button
                type="button"
                className="grid size-7 shrink-0 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background/65 hover:text-foreground"
                aria-label={`Remove option ${option.label || index + 1}`}
                onClick={() => removeOption(index)}
              >
                <X className="size-3.5 stroke-[2.5]" />
              </button>
            </div>
            <PopoverContent
              side="left"
              align="start"
              sideOffset={12}
              className="w-72 overflow-hidden rounded-[16px] border-border/80 p-0 shadow-2xl"
            >
              <div className="flex h-12 items-center justify-between border-b border-border/60 px-3.5">
                <div>
                  <p className="text-[11px] font-semibold">Opção</p>
                  <p className="text-[9px] text-muted-foreground">Item {index + 1} do seletor</p>
                </div>
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Close option editor"
                  onClick={() => setOpenIndex(null)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="space-y-2.5 p-3.5">
                <FieldRow
                  label="Valor"
                  value={option.value}
                  onCommit={value => updateOption(index, { value })}
                />
                <FieldRow
                  label="Title"
                  value={option.label}
                  onCommit={label => updateOption(index, { label })}
                />
                <SelectOptionChoice
                  label="Habilitada"
                  value={!option.disabled}
                  onChange={enabled => updateOption(index, { disabled: !enabled })}
                />
                <SelectOptionChoice
                  label="Default"
                  value={option.selected}
                  onChange={selected => updateOption(index, { selected })}
                />
              </div>
            </PopoverContent>
          </Popover>
        ))}
        <button
          type="button"
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-[10px] border border-border/70 bg-transparent p-1 text-left text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          onClick={addOption}
        >
          <span className="grid size-7 shrink-0 place-items-center text-muted-foreground">
            <Plus className="size-3.5 stroke-[2.5]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">Add…</span>
        </button>
      </div>
    </div>
  );
}

interface ChoiceControlModel {
  label: string;
  name: string;
  value: string;
  checked: boolean;
  required: boolean;
  disabled: boolean;
}

function readChoiceControl(markup: string): ChoiceControlModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const root = doc.body.firstElementChild;
  const input = root?.matches('input') ? root : root?.querySelector('input');
  if (!root || !(input instanceof HTMLInputElement)) return null;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelector('input')?.remove();
  return {
    label: clone.textContent?.trim() || '',
    name: input.getAttribute('name') || '',
    value: input.getAttribute('value') || '',
    checked: input.hasAttribute('checked'),
    required: input.hasAttribute('required'),
    disabled: input.hasAttribute('disabled'),
  };
}

interface SearchComponentModel {
  action: string;
  method: string;
  queryName: string;
  placeholder: string;
  buttonLabel: string;
}

function readSearchComponent(markup: string): SearchComponentModel | null {
  if (!markup || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const form = doc.body.querySelector('form');
  const input = form?.querySelector('input[type="search"], input');
  const button = form?.querySelector('button');
  if (!form || !input) return null;
  return {
    action: form.getAttribute('action') || '',
    method: form.getAttribute('method') || 'get',
    queryName: input.getAttribute('name') || 'q',
    placeholder: input.getAttribute('placeholder') || '',
    buttonLabel: button?.textContent?.trim() || 'Search',
  };
}

function AdvancedPropertyRow({ property, value, inherited, onChange, onRemove }: { property: string; value: string; inherited?: boolean; onChange: (value: string) => void; onRemove: () => void }) {
  const control: AdvancedControl = ADVANCED_CONTROLS[property] || { type: 'text' };
  return (
    <div
      className="group grid grid-cols-3 items-center gap-2"
      data-design-token-property={property}
    >
      <Label variant="muted" className="flex min-w-0 items-center gap-1 truncate font-mono" data-kodety-no-i18n title={property}>
        {property}
        {inherited && <span className="size-1.5 shrink-0 rounded-full bg-amber-400" title="Herdado do breakpoint base" />}
      </Label>
      <div className="col-span-2 flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1 *:w-full">
          {control.type === 'enum' ? (
            <Select value={value || '__unset'} onValueChange={next => onChange(next === '__unset' ? '' : next)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__unset">—</SelectItem>
                {control.options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : control.type === 'color' ? (
            <ColorPicker value={value} onChange={onChange} onImmediateChange={onChange} solidOnly />
          ) : (
            <DraftInput
              value={value} onCommit={onChange}
              placeholder={control.placeholder} className="font-mono"
            />
          )}
        </div>
        <Button
          size="icon-xs" variant="ghost"
          className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title="Remove property"
          aria-label={`Remove property ${property}`}
          onClick={onRemove}
        ><Trash2 className="size-3.5" /></Button>
      </div>
    </div>
  );
}

/**
 * A property explicitly overridden in the current state (hover/focus/…). The
 * title reads purple — click it to see the override's value plus the base
 * (non-state) value, with a one-click reset that removes just this state's
 * declaration, falling back to the base value everywhere it's used.
 */
function StateOverrideChip({ property, value, original, onReset }: { property: string; value: string; original?: string; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md bg-purple-500/15 px-2 py-1 font-mono text-[10px] font-medium text-purple-300 hover:bg-purple-500/25"
        ><span data-kodety-no-i18n>{property}</span></button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-2 p-2.5">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Current state</p>
          <p className="truncate font-mono text-[11px] text-purple-300" data-kodety-no-i18n>{value}</p>
        </div>
        {original && (
          <div>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Original (base)</p>
            <p className="truncate font-mono text-[11px] text-foreground" data-kodety-no-i18n>{original}</p>
          </div>
        )}
        <Button
          size="xs" variant="destructive"
          className="w-full" onClick={() => { onReset(); setOpen(false); }}
        >Reset to original</Button>
      </PopoverContent>
    </Popover>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-3 items-center gap-2">
      <Label variant="muted">{label}</Label>
      <div className="col-span-2 min-w-0 *:w-full">
        <ColorPicker value={value} onChange={onChange} onImmediateChange={onChange} solidOnly />
      </div>
    </div>
  );
}

function AttachmentSection({ type, label, attached, options, onAttach, onDetach, onCreate }: {
  type: 'css' | 'js';
  label: string;
  attached: string[];
  options: string[];
  onAttach: (path: string) => void;
  onDetach: (path: string) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const available = options.filter(path => !attached.includes(path) && path.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className="grid grid-cols-3 items-start gap-2">
      <YcodeLabel variant="muted" className="h-8">{label}</YcodeLabel>
      <div className="col-span-2 flex min-w-0 flex-col gap-2">
        {attached.map(path => (
          <div key={path} className="flex h-8 min-w-0 items-center gap-1 rounded-lg bg-input pl-2 pr-1">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" data-kodety-no-i18n title={path}>{path}</span>
            <YcodeButton
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => onDetach(path)}
              aria-label={`Detach ${path}`}
              title={`Detach ${path}`}
            ><X /></YcodeButton>
          </div>
        ))}
        <YcodePopover open={open} onOpenChange={value => { setOpen(value); if (!value) setSearch(''); }}>
          <YcodePopoverTrigger asChild>
            <YcodeButton
              type="button"
              size="sm"
              variant="input"
              className="w-full justify-between px-2 font-normal"
              aria-label={`Attach ${type.toUpperCase()} file`}
            >
              <span>{attached.length ? `Attach another .${type}` : `Choose .${type} file`}</span>
              <Plus />
            </YcodeButton>
          </YcodePopoverTrigger>
          <YcodePopoverContent align="end" className="w-64 space-y-2 p-2">
            <YcodeInput
              autoFocus
              value={search}
              placeholder={`Search or create .${type} file`}
              aria-label={`Search or create ${type.toUpperCase()} file`}
              onChange={event => setSearch(event.target.value)}
              className="font-mono"
            />
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {available.map(path => (
                <button
                  key={path}
                  type="button"
                  onClick={() => { onAttach(path); setOpen(false); setSearch(''); }}
                  className="block h-8 w-full truncate rounded-lg px-2 text-left font-mono text-xs text-muted-foreground hover:bg-input hover:text-foreground"
                >{path}</button>
              ))}
              {!available.length && (
                <p className="px-2 py-2 text-xs text-muted-foreground">No matching .{type} files</p>
              )}
            </div>
            {search.trim() && !options.includes(search.trim()) && (
              <YcodeButton
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => { onCreate(search.trim()); setOpen(false); setSearch(''); }}
                className="w-full justify-start font-mono text-[var(--kodety-accent-hover)]"
              ><Plus /> Create {search.trim()}</YcodeButton>
            )}
          </YcodePopoverContent>
        </YcodePopover>
      </div>
    </div>
  );
}

function AdvancedStylePanel({ explicitStyles, ownStyles, styleValues, onStyleChange, description }: { explicitStyles: Record<string, string>; ownStyles?: Record<string, string>; styleValues: Record<string, string>; onStyleChange: (property: string, value: string) => void; description?: string }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const extraProps = useMemo(() => Array.from(new Set([
    ...Object.keys(explicitStyles).filter(property => !KNOWN_STYLE_PROPERTIES.has(property)),
    ...added,
  ])), [explicitStyles, added]);
  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ADVANCED_STYLE_SUGGESTIONS.filter((property, index, list) =>
      list.indexOf(property) === index && !extraProps.includes(property) && property.includes(query),
    ).slice(0, 24);
  }, [extraProps, search]);
  const addProperty = (property: string) => {
    const name = property.trim().toLowerCase();
    const isStandardProperty = /^-?[a-z][a-z0-9-]*$/.test(name);
    const isCustomProperty = /^--[a-z_][a-z0-9_-]*$/.test(name);
    if (!isStandardProperty && !isCustomProperty) return;
    if (!extraProps.includes(name)) setAdded(current => [...current, name]);
    setSearch('');
    setShowSearch(false);
  };
  return (
    <SettingsPanel
      title="CSS personalizado" isOpen={open}
      onboardingId="style-custom-css"
      onToggle={() => setOpen(value => !value)} collapsible
    >
      {extraProps.length === 0 && !showSearch && (
        <p className="text-xs leading-relaxed text-muted-foreground">{description || 'Qualquer propriedade CSS — blend, mask, clip-path, cursor, filtros e mais, com controle visual.'}</p>
      )}
      {extraProps.map(property => (
        <AdvancedPropertyRow
          key={property}
          property={property}
          value={styleValues[property] || ''}
          inherited={ownStyles ? !Object.hasOwn(ownStyles, property) : false}
          onChange={value => onStyleChange(property, value)}
          onRemove={() => { setAdded(current => current.filter(item => item !== property)); onStyleChange(property, ''); }}
        />
      ))}
      {showSearch ? (
        <div className="space-y-1.5 border-t border-border/55 pt-2">
          <Input
            autoFocus value={search}
            placeholder="Search or enter a property…"
            aria-label="Search or enter a CSS property"
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && search.trim()) addProperty(search); if (event.key === 'Escape') { setShowSearch(false); setSearch(''); } }}
            className="h-7 rounded-[7px] font-mono text-[10px]"
          />
          <div className="max-h-44 space-y-0.5 overflow-y-auto">
            {suggestions.map(property => (
              <button
                key={property} type="button"
                onClick={() => addProperty(property)}
                className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[10px] text-muted-foreground hover:bg-white/5 hover:text-foreground"
              ><span data-kodety-no-i18n>{property}</span></button>
            ))}
            {search.trim() && !suggestions.includes(search.trim().toLowerCase()) && (
              <button
                type="button" onClick={() => addProperty(search)}
                className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[10px] text-[var(--kodety-accent-hover)] hover:bg-white/5"
              >+ Add &ldquo;{search.trim().toLowerCase()}&rdquo;</button>
            )}
          </div>
        </div>
      ) : (
        <Button
          size="xs" variant="input"
          className="w-full justify-start text-muted-foreground" onClick={() => setShowSearch(true)}
        ><Plus className="mr-1 size-3" /> Add property</Button>
      )}
    </SettingsPanel>
  );
}

export interface BreakpointManagerProps {
  primaryBreakpoint: Breakpoint;
  onPrimaryChange: (next: Breakpoint) => void;
  breakpoints: Breakpoint[];
  onChange: (next: Breakpoint[]) => void;
  /** When provided, each row also gets a "use this breakpoint" affordance and
   *  a Desktop/base row is shown — the same manager doubles as a switcher
   *  (used by the canvas toolbar) as well as pure CRUD (used standalone here). */
  activeId?: string;
  onSelect?: (id: string) => void;
}

export function BreakpointManager({ primaryBreakpoint, onPrimaryChange, breakpoints, onChange, activeId, onSelect }: BreakpointManagerProps) {
  // Rows are read-only by default — clicking one selects it. Editing is an
  // explicit, opt-in action (the pencil icon) so a stray click never mutates
  // a breakpoint, and the read view never has to squeeze inputs into a row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [primaryDraft, setPrimaryDraft] = useState<{ label: string; width: string } | null>(null);
  const [breakpointDraft, setBreakpointDraft] = useState<BreakpointDraft | null>(null);
  const [breakpointError, setBreakpointError] = useState('');
  useEffect(() => {
    if (
      !editingId
      || editingId === 'base'
      || editingId === 'new'
      || breakpoints.some(breakpoint => breakpoint.id === editingId)
    ) return;
    setBreakpointDraft(null);
    setBreakpointError('');
    setEditingId(null);
  }, [breakpoints, editingId]);
  const remove = (id: string) => {
    const target = breakpoints.find(breakpoint => breakpoint.id === id);
    if (!target || !window.confirm(`Remove ${target.label} and the styles authored ${target.mode === 'max-width' ? 'up to' : 'from'} ${target.width}px?`)) return;
    onChange(breakpoints.filter(breakpoint => breakpoint.id !== id));
    setBreakpointDraft(null);
    setBreakpointError('');
    if (editingId === id) setEditingId(null);
  };
  const add = () => {
    setPrimaryDraft(null);
    setBreakpointDraft(createBreakpointDraft(breakpoints));
    setBreakpointError('');
    setEditingId('new');
  };
  const beginBreakpointEdit = (breakpoint: Breakpoint) => {
    setPrimaryDraft(null);
    setBreakpointDraft(editBreakpointDraft(breakpoint));
    setBreakpointError('');
    setEditingId(breakpoint.id);
  };
  const cancelBreakpointEdit = () => {
    setBreakpointDraft(null);
    setBreakpointError('');
    setEditingId(null);
  };
  const commitCustomBreakpointEdit = () => {
    if (!breakpointDraft) return;
    const result = commitBreakpointDraft(breakpointDraft, breakpoints);
    if (!result.ok) {
      setBreakpointError(result.error);
      return;
    }
    if (result.changed) onChange(result.breakpoints);
    if (breakpointDraft.intent === 'create') onSelect?.(result.breakpoint.id);
    setBreakpointDraft(null);
    setBreakpointError('');
    setEditingId(null);
  };
  const beginPrimaryEdit = () => {
    setBreakpointDraft(null);
    setPrimaryDraft({
      label: primaryBreakpoint.label,
      width: String(primaryBreakpoint.width),
    });
    setBreakpointError('');
    setEditingId('base');
  };
  const cancelPrimaryEdit = () => {
    setPrimaryDraft(null);
    setBreakpointError('');
    setEditingId(null);
  };
  const commitPrimaryEdit = () => {
    if (!primaryDraft) return;
    const widthText = primaryDraft.width.trim();
    const width = Number(widthText);
    if (!widthText || !Number.isFinite(width) || width < MIN_BREAKPOINT_WIDTH) {
      setBreakpointError(`A largura principal deve ser um número igual ou maior que ${MIN_BREAKPOINT_WIDTH}px.`);
      return;
    }
    onPrimaryChange({
      ...primaryBreakpoint,
      id: 'base',
      label: primaryDraft.label.trim() || primaryBreakpoint.label,
      width: normalizeBreakpointWidth(width, primaryBreakpoint.width),
    });
    setPrimaryDraft(null);
    setBreakpointError('');
    setEditingId(null);
  };
  const renderBreakpointEditor = (target: Breakpoint | null) => {
    if (!breakpointDraft) return null;
    const updateDraft = (patch: Partial<BreakpointDraft>) => {
      setBreakpointDraft(current => (current ? { ...current, ...patch } : current));
      setBreakpointError('');
    };
    return (
      <div
        key={target?.id || 'new-breakpoint'}
        className={cn(
          'grid items-center gap-1.5 border-b border-white/[.055] py-1.5',
          target
            ? 'grid-cols-[minmax(0,1fr)_auto_56px_auto_auto_auto]'
            : 'grid-cols-[minmax(0,1fr)_auto_56px_auto_auto]',
        )}
        onKeyDown={event => {
          if (event.key === 'Escape') cancelBreakpointEdit();
        }}
      >
        <Input
          value={breakpointDraft.label}
          autoFocus
          onChange={event => updateDraft({ label: event.target.value })}
          onKeyDown={event => {
            if (event.key === 'Enter') commitCustomBreakpointEdit();
          }}
          className="h-7 text-[11px]"
          title="Nome do breakpoint"
          aria-label="Nome do breakpoint"
        />
        <Select
          value={breakpointDraft.mode}
          onValueChange={mode => updateDraft({ mode: mode as BreakpointMode })}
        >
          <SelectTrigger
            size="sm"
            className="w-14"
            title="Direction"
            aria-label="Direção do breakpoint"
          ><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="max-width">≤</SelectItem>
            <SelectItem value="min-width">≥</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={breakpointDraft.width}
          onChange={event => updateDraft({ width: event.target.value })}
          onKeyDown={event => {
            if (event.key === 'Enter') commitCustomBreakpointEdit();
          }}
          inputMode="numeric"
          className="h-7 w-14 text-[11px]"
          title="Largura (px)"
          aria-label="Largura do breakpoint em pixels"
          disableKeyboardStep
        />
        <button
          type="button"
          className="text-emerald-400 hover:text-emerald-300"
          onClick={commitCustomBreakpointEdit}
          aria-label="Concluir edição do breakpoint"
        ><Check className="size-3.5" /></button>
        <button
          type="button"
          className="text-muted-foreground hover:text-white"
          onClick={cancelBreakpointEdit}
          aria-label="Cancelar edição do breakpoint"
        ><X className="size-3.5" /></button>
        {target && (
          <button
            type="button"
            className="text-muted-foreground hover:text-red-400"
            onClick={() => remove(target.id)}
            aria-label="Remove"
          ><Trash2 className="size-3.5" /></button>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-0.5">
      {editingId === 'base' ? (
        <div className="grid grid-cols-[1fr_64px_auto_auto] items-center gap-1.5 border-b border-white/8 py-2">
          <Input
            value={primaryDraft?.label ?? primaryBreakpoint.label} autoFocus
            onChange={event => setPrimaryDraft(current => ({
              label: event.target.value,
              width: current?.width ?? String(primaryBreakpoint.width),
            }))}
            onKeyDown={event => {
              if (event.key === 'Enter') commitPrimaryEdit();
              if (event.key === 'Escape') cancelPrimaryEdit();
            }}
            className="h-7 text-[11px]"
            aria-label="Primary breakpoint name"
          />
          <Input
            value={primaryDraft?.width ?? String(primaryBreakpoint.width)}
            onChange={event => setPrimaryDraft(current => ({
              label: current?.label ?? primaryBreakpoint.label,
              width: event.target.value,
            }))}
            onKeyDown={event => {
              if (event.key === 'Enter') commitPrimaryEdit();
              if (event.key === 'Escape') cancelPrimaryEdit();
            }}
            inputMode="numeric"
            className="h-7 text-[11px]"
            aria-label="Primary width in pixels"
            disableKeyboardStep
          />
          <button type="button" className="text-emerald-400 hover:text-emerald-300" onClick={commitPrimaryEdit} aria-label="Finish editing"><Check className="size-3.5" /></button>
          <button type="button" className="text-muted-foreground hover:text-white" onClick={cancelPrimaryEdit} aria-label="Cancel editing"><X className="size-3.5" /></button>
        </div>
      ) : (
        <div className={cn('group flex items-center gap-2 border-b border-white/8 py-2 text-left text-[11px]', activeId === 'base' && 'text-[var(--kodety-accent-hover)]')}>
          <button
            type="button"
            disabled={!onSelect}
            aria-pressed={onSelect ? activeId === 'base' : undefined}
            onClick={() => onSelect?.('base')}
            className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-ring', onSelect ? 'cursor-pointer' : 'cursor-default disabled:opacity-100')}
          >
            <HtmlBreakpointDeviceIcon width={primaryBreakpoint.width} className="size-3.5 shrink-0 text-[var(--kodety-accent-hover)]" />
            <span className="min-w-0 flex-1 truncate"><span className="font-medium" data-kodety-no-i18n>{primaryBreakpoint.label}</span> <span className="text-muted-foreground">· {primaryBreakpoint.width}px · global</span></span>
            {activeId === 'base' && <Check className="size-3 shrink-0 text-[var(--kodety-accent-hover)]" />}
          </button>
          <button type="button" className="shrink-0 rounded-sm text-muted-foreground opacity-0 outline-none transition group-hover:opacity-100 hover:text-white focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring" aria-label="Edit primary breakpoint" onClick={beginPrimaryEdit}><Pencil className="size-3" /></button>
        </div>
      )}
      {breakpoints.length === 0 && <p className="px-1.5 py-1 text-[9px] text-muted-foreground">No breakpoints. Add the first one.</p>}
      {breakpoints.map(breakpoint => {
        if (editingId === breakpoint.id && breakpointDraft?.originalId === breakpoint.id) {
          return renderBreakpointEditor(breakpoint);
        }
        return (
          <div
            key={breakpoint.id}
            className={cn(
              'group flex items-center gap-2 border-b border-white/[.055] py-2 text-left text-[11px]',
              activeId === breakpoint.id && 'text-[var(--kodety-accent-hover)]',
            )}
          >
            <button
              type="button"
              disabled={!onSelect}
              aria-pressed={onSelect ? activeId === breakpoint.id : undefined}
              onClick={() => onSelect?.(breakpoint.id)}
              className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-ring', onSelect ? 'cursor-pointer' : 'cursor-default disabled:opacity-100')}
            >
              <HtmlBreakpointDeviceIcon width={breakpoint.width} className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                <span data-kodety-no-i18n>{breakpoint.label}</span> <span className="text-muted-foreground">· {breakpoint.mode === 'max-width' ? '≤' : '≥'} {breakpoint.width}</span>
              </span>
              {activeId === breakpoint.id && <Check className="size-3.5 shrink-0 text-[var(--kodety-accent-hover)]" />}
            </button>
            <button type="button" className="shrink-0 rounded-sm text-muted-foreground opacity-0 outline-none transition group-hover:opacity-100 hover:text-white focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring" aria-label={`Edit ${breakpoint.label}`} onClick={() => beginBreakpointEdit(breakpoint)}><Pencil className="size-3" /></button>
          </div>
        );
      })}
      {editingId === 'new' && breakpointDraft?.intent === 'create' && renderBreakpointEditor(null)}
      {breakpointError && (
        <p role="alert" className="px-1 pt-1 text-[9px] leading-snug text-red-400">{breakpointError}</p>
      )}
      <button
        type="button"
        disabled={editingId !== null}
        className="flex items-center gap-1.5 pt-2 text-[10px] text-[var(--kodety-accent-hover)] hover:text-[var(--kodety-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={add}
      ><Plus className="size-3" /> Add breakpoint</button>
    </div>
  );
}

function AssetPreview({ file, tag }: { file: HtmlProjectFile; tag: 'img' | 'video' | 'audio' }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const content = file.text ?? file.data;
    if (!content) { setUrl(''); return; }
    const next = URL.createObjectURL(new Blob([content as BlobPart], { type: file.mimeType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">Preview indisponível</div>;
  if (tag === 'video') return <video
    src={url} muted
    playsInline className="h-32 w-full object-contain"
                              />;
  if (tag === 'audio') return <audio
    src={url} controls
    className="w-full"
                              />;
  // Object URLs represent user-owned local project assets.
  // eslint-disable-next-line @next/next/no-img-element
  return <img
    src={url} alt=""
    className="block h-auto w-full"
         />;
}

const KNOWN_STYLE_PROPERTIES = new Set([
  'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'display', 'flex-direction', 'justify-content', 'align-items', 'align-self', 'flex-wrap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'gap', 'column-gap', 'row-gap',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'object-fit', 'object-position',
  'opacity', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'overflow', 'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-style', 'border-color', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'box-shadow',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
  'text-transform', 'text-decoration', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset',
  'text-wrap', 'color', '-webkit-line-clamp',
  'translate', 'scale', 'rotate', 'transform-origin',
  'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
]);

/** Elements with no closing tag — swapping their tag makes no sense (nothing to reconcile). */
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']);

const TAG_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: 'div', label: 'Div', description: 'Contêiner genérico, sem significado semântico.' },
  { value: 'p', label: 'P (parágrafo)', description: 'Parágrafo de texto.' },
  { value: 'span', label: 'Span', description: 'Contêiner inline genérico.' },
  { value: 'h1', label: 'H1', description: 'Título principal da página.' },
  { value: 'h2', label: 'H2', description: 'Título de uma seção principal.' },
  { value: 'h3', label: 'H3', description: 'Título de uma subseção.' },
  { value: 'h4', label: 'H4', description: 'Título de quarto nível.' },
  { value: 'h5', label: 'H5', description: 'Título de quinto nível.' },
  { value: 'h6', label: 'H6', description: 'Título de sexto nível.' },
  { value: 'blockquote', label: 'Blockquote', description: 'Citação longa destacada.' },
  { value: 'section', label: 'Section', description: 'A standalone thematic section of the page.' },
  { value: 'article', label: 'Article', description: 'Conteúdo autocontido e reutilizável — post, card, notícia.' },
  { value: 'header', label: 'Header', description: 'Conteúdo introdutório ou de navegação da seção/página.' },
  { value: 'footer', label: 'Footer', description: 'Rodapé da seção ou da página.' },
  { value: 'nav', label: 'Nav', description: 'Bloco de links de navegação principal.' },
  { value: 'main', label: 'Main', description: 'The unique main content of the page.' },
  { value: 'aside', label: 'Aside', description: 'Conteúdo relacionado, tangencial ao principal.' },
  { value: 'address', label: 'Address', description: 'Informações de contato do autor ou dono da página.' },
  { value: 'figure', label: 'Figure', description: 'Self-contained media with an optional caption.' },
  { value: 'ul', label: 'Ul (lista)', description: 'Lista não ordenada.' },
  { value: 'ol', label: 'Ol (lista numerada)', description: 'Lista ordenada.' },
  { value: 'li', label: 'Li (item)', description: 'Item de lista.' },
  { value: 'a', label: 'A (link)', description: 'A link to another page or section. Set its destination in Link.' },
];

/**
 * Properties the browser resolves into something that is NOT safe to write
 * back as-is: `background-image`/`mask-image`/etc. come back as absolute
 * (often preview-only rewritten `data:`) URLs rather than the authored
 * `url(hero.jpg)`, and `cursor`/`content` can similarly carry resolved URLs.
 * Excluded only from the "inherited/computed" FALLBACK — an explicitly
 * authored declaration for these (real source text, read via postcss) is
 * always shown and always safe.
 */
const UNSAFE_COMPUTED_FALLBACK_PROPERTIES = new Set([
  'background-image', 'border-image-source', 'mask-image', 'list-style-image', 'cursor', 'content', 'src',
]);

function safeComputedFallback(computedStyle: Record<string, string> | undefined): Record<string, string> {
  if (!computedStyle) return {};
  return Object.fromEntries(Object.entries(computedStyle).filter(([key]) => !UNSAFE_COMPUTED_FALLBACK_PROPERTIES.has(key)));
}

type AdvancedControl = { type: 'enum'; options: string[] } | { type: 'color' } | { type: 'text'; placeholder?: string };

// Visual, no-code control per advanced CSS property: enums become dropdowns,
// colours get a swatch, the rest a hinted text field. Anything not listed falls
// back to a plain text field.
const ADVANCED_CONTROLS: Record<string, AdvancedControl> = {
  'mix-blend-mode': { type: 'enum', options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] },
  'background-blend-mode': { type: 'enum', options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] },
  isolation: { type: 'enum', options: ['auto', 'isolate'] },
  'image-rendering': { type: 'enum', options: ['auto', 'smooth', 'high-quality', 'crisp-edges', 'pixelated'] },
  cursor: { type: 'enum', options: ['auto', 'default', 'pointer', 'text', 'move', 'grab', 'grabbing', 'not-allowed', 'wait', 'progress', 'help', 'crosshair', 'zoom-in', 'zoom-out', 'ew-resize', 'ns-resize', 'nwse-resize', 'copy', 'cell', 'context-menu', 'none'] },
  'caret-color': { type: 'color' },
  'accent-color': { type: 'color' },
  'pointer-events': { type: 'enum', options: ['auto', 'none'] },
  'user-select': { type: 'enum', options: ['auto', 'none', 'text', 'all', 'contain'] },
  'scroll-behavior': { type: 'enum', options: ['auto', 'smooth'] },
  'scroll-snap-type': { type: 'enum', options: ['none', 'x mandatory', 'y mandatory', 'both mandatory', 'x proximity', 'y proximity'] },
  'scroll-snap-align': { type: 'enum', options: ['none', 'start', 'center', 'end'] },
  'overscroll-behavior': { type: 'enum', options: ['auto', 'contain', 'none'] },
  'object-fit': { type: 'enum', options: ['fill', 'contain', 'cover', 'none', 'scale-down'] },
  'aspect-ratio': { type: 'enum', options: ['auto', '1 / 1', '4 / 3', '3 / 2', '16 / 9', '21 / 9', '9 / 16'] },
  'writing-mode': { type: 'enum', options: ['horizontal-tb', 'vertical-rl', 'vertical-lr'] },
  appearance: { type: 'enum', options: ['auto', 'none'] },
  resize: { type: 'enum', options: ['none', 'both', 'horizontal', 'vertical'] },
  'transform-style': { type: 'enum', options: ['flat', 'preserve-3d'] },
  'backface-visibility': { type: 'enum', options: ['visible', 'hidden'] },
  'text-wrap': { type: 'enum', options: ['wrap', 'nowrap', 'balance', 'pretty', 'stable'] },
  'will-change': { type: 'enum', options: ['auto', 'transform', 'opacity', 'scroll-position', 'contents'] },
  'mask-repeat': { type: 'enum', options: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round'] },
  'mask-size': { type: 'enum', options: ['auto', 'cover', 'contain'] },
  'mask-mode': { type: 'enum', options: ['match-source', 'alpha', 'luminance'] },
  'mask-composite': { type: 'enum', options: ['add', 'subtract', 'intersect', 'exclude'] },
  'mask-origin': { type: 'enum', options: ['border-box', 'padding-box', 'content-box', 'fill-box', 'stroke-box', 'view-box'] },
  'mask-clip': { type: 'enum', options: ['border-box', 'padding-box', 'content-box', 'fill-box', 'stroke-box', 'view-box', 'no-clip'] },
  filter: { type: 'text', placeholder: 'blur(4px) brightness(1.1)' },
  'backdrop-filter': { type: 'text', placeholder: 'blur(8px)' },
  'clip-path': { type: 'text', placeholder: 'circle(50%) / inset(10px)' },
  'mask-image': { type: 'text', placeholder: 'linear-gradient(...)' },
  'mask-position': { type: 'text', placeholder: 'center' },
  'object-position': { type: 'text', placeholder: 'center' },
  'text-shadow': { type: 'text', placeholder: '0 2px 8px rgba(0,0,0,.3)' },
  outline: { type: 'text', placeholder: '1px solid #000' },
  'outline-offset': { type: 'text', placeholder: '2px' },
  'scroll-margin-top': { type: 'text', placeholder: '80px' },
  perspective: { type: 'text', placeholder: '800px' },
  'list-style': { type: 'text', placeholder: 'disc inside' },
  content: { type: 'text', placeholder: '"★"' },
};

// Curated CSS properties for the searchable "add property" menu, echoing the
// power of Framer's add-style menu. Selecting one adds an editable row; any
// custom property name can also be typed directly.
const ADVANCED_STYLE_SUGGESTIONS = [
  'mix-blend-mode', 'background-blend-mode', 'isolation', 'clip-path', 'mask-image', 'mask-mode', 'mask-size', 'mask-position', 'mask-repeat', 'mask-origin', 'mask-clip', 'mask-composite',
  'filter', 'backdrop-filter', 'image-rendering', 'cursor', 'caret-color', 'accent-color', 'pointer-events', 'user-select',
  'scroll-behavior', 'scroll-snap-type', 'scroll-snap-align', 'scroll-margin-top', 'overscroll-behavior', 'aspect-ratio',
  'object-fit', 'object-position', 'will-change', 'writing-mode', 'text-shadow', 'outline', 'outline-offset', 'appearance',
  'resize', 'list-style', 'content', 'mix-blend-mode', 'perspective', 'transform-style', 'backface-visibility', 'text-wrap',
];

type InspectorSlotName = 'componentControls' | 'membershipControls' | 'componentInteractions';

const HtmlInspectorSlot = memo(function HtmlInspectorSlot({ slot }: { slot: InspectorSlotName }) {
  return useHtmlInspectorPanelStore(state => state.slots[slot]) || null;
});

function createInspectorRenderProps(
  model: HtmlInspectorBridgeProps,
  tabRequest: HtmlInspectorProps['tabRequest'],
) {
  const renderProps = { ...model, tabRequest } as HtmlInspectorProps & Record<string, unknown>;
  const mutableProps = renderProps as Record<PropertyKey, unknown>;
  const stableActions = htmlInspectorActions as unknown as Record<PropertyKey, unknown>;
  HTML_INSPECTOR_ACTION_KEYS.forEach(key => {
    if (typeof model[key] === 'function') {
      mutableProps[key] = stableActions[key];
    }
  });
  renderProps.componentControls = model.componentControls
    ? <HtmlInspectorSlot slot="componentControls" />
    : undefined;
  renderProps.membershipControls = model.membershipControls
    ? <HtmlInspectorSlot slot="membershipControls" />
    : undefined;
  renderProps.componentInteractions = model.componentInteractions
    ? <HtmlInspectorSlot slot="componentInteractions" />
    : undefined;
  return renderProps;
}

export const HtmlInspector = memo(function HtmlInspector() {
  const sharedModel = useHtmlInspectorPanelStore(state => state.modelSlices?.shared || null);
  const activeModel = useHtmlInspectorPanelStore(state => (
    state.modelSlices?.[state.activeTab] || null
  ));
  const activeTab = useHtmlInspectorPanelStore(state => state.activeTab);
  const tabRequest = useHtmlInspectorPanelStore(state => state.tabRequest);
  const setActiveTab = useHtmlInspectorPanelStore(state => state.setActiveTab);
  const renderProps = useMemo(
    () => {
      if (!sharedModel || !activeModel) return null;
      const slices = useHtmlInspectorPanelStore.getState().modelSlices;
      if (!slices) return null;
      return createInspectorRenderProps(materializeHtmlInspectorModel(slices), tabRequest);
    },
    [activeModel, activeTab, sharedModel, tabRequest],
  );
  if (!renderProps) return null;
  return (
    <HtmlInspectorContent
      {...renderProps}
      inspectorActiveTab={activeTab}
      onInspectorActiveTabChange={setActiveTab}
    />
  );
});

export function HtmlInspectorBridge(props: Omit<HtmlInspectorBridgeProps, 'activeBreakpoint'>) {
  const ownerId = useId();
  const activeTimelineKeyframe = useHtmlTimelineStore(state => state.activeTimelineKeyframe);
  const activeBreakpoint = useHtmlViewportStore(state => state.viewport);
  const keyframeStyles = useMemo(
    () => timelineKeyframeStyles(activeTimelineKeyframe),
    [activeTimelineKeyframe],
  );
  const keyframeLabel = timelineKeyframeLabel(activeTimelineKeyframe);
  useLayoutEffect(() => {
    useHtmlInspectorPanelStore.getState().publish(ownerId, {
      ...props,
      styleEditScopeKey: JSON.stringify([
        props.styleEditScopeKey,
        activeTimelineKeyframe?.interactionId,
        activeTimelineKeyframe?.actionId,
        activeTimelineKeyframe?.keyframeId,
      ]),
      keyframeStyles,
      keyframeLabel,
      activeBreakpoint,
    });
  });
  useEffect(() => () => {
    useHtmlInspectorPanelStore.getState().resetOwner(ownerId);
  }, [ownerId]);
  return <HtmlInspector />;
}

function timelineKeyframeStyles(selection: InteractionKeyframeSelection | null) {
  if (!selection) return undefined;
  return Object.fromEntries(
    Object.entries(selection.values).map(([property, value]) => [
      interactionPropertyToCss(property),
      String(value),
    ]),
  );
}

function timelineKeyframeLabel(selection: InteractionKeyframeSelection | null) {
  if (!selection) return undefined;
  const position =
    selection.keyframeIndex === 0
      ? 'keyframe inicial'
      : selection.keyframeIndex === selection.keyframeCount - 1
        ? 'keyframe final'
        : `keyframe ${selection.keyframeIndex + 1}`;
  return `${position} · ${Math.round(selection.time * 1000)} ms`;
}

function HtmlInspectorContent({ width, tabRequest, readOnly = false, designTokens, onDesignTokensChange, onDesignTokenEdit, cmsAvailable = false, utmProfiles = [], analyticsFeatureAccess, cmsTemplatePostType = '', componentControls, htmlComponentInstanceSelected = false, componentVariableContext, onComponentVariablesChange, onManageComponentVariables, membershipControls, membershipFocusKey = '', componentInteractions, selection, selectionCount = 1, onTextChange, containerLines, onContainerTextChange, onAttributeChange, onAttributesChange, localeEditing, onResetLocaleOverride, onStyleChange, onVisibilityChange, displayRestoreState, styleEditScopeKey = '', onStylePreview, onStylePreviewCancel, styleClipboard, onCopyStyleProperty, onCopyAllStyles, onPasteStyleProperty, onPasteAllStyles, keyframeStyles, keyframeLabel, source, onSourceChange, onSelectPath, onInteractionSourceChange, savedAnimations = [], onSaveAnimation, onRemoveSavedAnimation, pageTransitions, homePage, onPageTransitionsChange, onTimelineOpen, onBeginInteractionTargetPick, onOpenEffectsLibrary, cssFiles, cssContext, cssRuleStyles, baseBreakpointStyles, onCssContextChange, onRenameClass, onDuplicateClass, reusableClasses, onRegisterReusableClass, onChangeTag, cssFileOptions, jsFileOptions, onAttachFile, onDetachFile, onCreateAndAttachFile, primaryBreakpoint, onPrimaryBreakpointChange, breakpoints, onBreakpointsChange, activeBreakpoint, onSelectBreakpoint, selectionStyles, liveStyleValues, onSelectionStyleChange, scrollbarStyles, onScrollbarChange, onResponsiveApply, linkPages, currentPage, onLinkApply, onScrollSectionApply, mediaAssets, currentMediaAssetPath, onMediaAssetSelect, onMediaSourceChange, onMediaUpload, cmsPreview, onCmsPreviewChange, inspectorActiveTab: activeTab, onInspectorActiveTabChange: setActiveTab }: HtmlInspectorProps & {
  inspectorActiveTab: HtmlInspectorTab;
  onInspectorActiveTabChange: (
    next: HtmlInspectorTab | ((current: HtmlInspectorTab) => HtmlInspectorTab),
  ) => void;
}) {
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'Scroll Section': false,
    'Seleção de texto': false,
    'Barra de rolagem': false,
    'Code Overrides': false,
    'Fluid Responsive': false,
  });
  const [newAttributeName, setNewAttributeName] = useState('');
  const [newAttributeValue, setNewAttributeValue] = useState('');
  const [fluidConfig, setFluidConfig] = useState<FluidResponsiveConfig>({ baseViewport: 1440, minViewport: 390, rootFontSize: 16, minScale: 0.6, preserveHairlines: true });
  const [showBreakpointManager, setShowBreakpointManager] = useState(false);
  const [fluidExclude, setFluidExclude] = useState('');
  const [fluidPreviewPx, setFluidPreviewPx] = useState('48');
  const effectiveFluidConfig = useMemo<FluidResponsiveConfig>(() => ({
    ...fluidConfig,
    excludedProperties: fluidExclude.split(',').map(part => part.trim()).filter(Boolean),
  }), [fluidConfig, fluidExclude]);
  const fluidPreview = useMemo(() => {
    const px = Number(fluidPreviewPx);
    if (!Number.isFinite(px) || px === 0) return '';
    return transformResponsiveValue(`${px}px`, effectiveFluidConfig, 'fluid');
  }, [effectiveFluidConfig, fluidPreviewPx]);
  const [linkType, setLinkType] = useState<LinkApplyRequest['type']>('url');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkPage, setLinkPage] = useState(currentPage);
  const [linkSection, setLinkSection] = useState('');
  const [linkAsset, setLinkAsset] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [linkSubject, setLinkSubject] = useState('');
  const [linkMessage, setLinkMessage] = useState('');
  const [linkPhone, setLinkPhone] = useState('');
  const [linkNewTab, setLinkNewTab] = useState(false);
  const [linkDownload, setLinkDownload] = useState(false);
  const [linkNoFollow, setLinkNoFollow] = useState(false);
  const [linkNativeStyle, setLinkNativeStyle] = useState(false);
  const [scrollSectionId, setScrollSectionId] = useState('');
  const [scrollOffsetY, setScrollOffsetY] = useState('0');
  const [mediaFocus, setMediaFocus] = useState<MediaFocusPoint>([50, 50]);
  const mediaFocusPointerRef = useRef<number | null>(null);
  const [newTabLabel, setNewTabLabel] = useState('');
  const [newComponentItemLabel, setNewComponentItemLabel] = useState('');
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
  const [cmsPreviewItem, setCmsPreviewItem] = useState<{ id: number; revision?: string; values: Record<string, unknown> } | null>(null);
  const [cmsPreviewItems, setCmsPreviewItems] = useState<Array<{ id: number; revision?: string; values: Record<string, unknown> }>>([]);
  const [cmsPreviewPostType, setCmsPreviewPostType] = useState('');
  const [cmsSavingTarget, setCmsSavingTarget] = useState('');
  const [cmsImageUploading, setCmsImageUploading] = useState(false);
  const blockReadOnlyControl = useCallback((event: SyntheticEvent<HTMLElement>) => {
    if (!readOnly) return;
    const target = event.target as HTMLElement | null;
    const control = target?.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [role="switch"], [role="combobox"], [role="tab"]',
    );
    if (!control || control.closest('[data-kodety-read-only-allow="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    toast.info('Somente leitura', {
      id: 'kodety-shared-read-only-control',
      description: 'Este controle pode ser consultado, mas não alterado neste link.',
    });
  }, [readOnly]);
  const isLocaleOverride = Boolean(localeEditing && !localeEditing.isSource);
  const componentNodeId = selection?.attributes['data-kodety-component-node'] || '';
  const componentVariables = componentVariableContext?.variables || [];
  const componentVariableFor = (
    types: HtmlComponentVariableType[],
    attribute: string,
  ) => componentVariables.find(variable =>
    htmlComponentVariableHasBinding(variable, componentNodeId, attribute)
    && types.includes(variable.type),
  );
  const updateComponentVariableBinding = (
    variableId: string,
    types: HtmlComponentVariableType[],
    attribute: string,
    currentValue: string,
  ) => {
    if (!componentNodeId || !onComponentVariablesChange) return;
    onComponentVariablesChange(componentVariables.map(variable => {
      if (variable.id === variableId) {
        return withHtmlComponentVariableBinding(variable, { targetNodeId: componentNodeId, attribute });
      }
      return htmlComponentVariableHasBinding(variable, componentNodeId, attribute)
        && types.includes(variable.type)
        ? withoutHtmlComponentVariableBinding(variable, componentNodeId, attribute)
        : variable;
    }));
  };
  const componentVariableLabel = (
    label: string,
    types: HtmlComponentVariableType[],
    attribute: string,
    currentValue: string,
  ): ReactNode => {
    if (!componentVariableContext || !componentNodeId || !onComponentVariablesChange) {
      return <YcodeLabel variant="muted">{label}</YcodeLabel>;
    }
    const linked = componentVariableFor(types, attribute);
    const compatible = componentVariables.filter(variable => types.includes(variable.type));
    return (
      <HtmlComponentVariableLabel
        label={label}
        variables={compatible}
        linkedVariableId={linked?.id}
        onLinkVariable={variableId => updateComponentVariableBinding(variableId, types, attribute, currentValue)}
        onUnlinkVariable={() => {
          if (!linked) return;
          onComponentVariablesChange(componentVariables.map(variable =>
            variable.id === linked.id
              ? withoutHtmlComponentVariableBinding(variable, componentNodeId, attribute)
              : variable,
          ));
        }}
        onCreateVariable={() => {
          const type = types[0] || 'text';
          const baseName = label.trim() || 'Variable';
          let name = baseName;
          let suffix = 2;
          const names = new Set(componentVariables.map(variable => variable.name.toLowerCase()));
          while (names.has(name.toLowerCase())) name = `${baseName} ${suffix++}`;
          const nextVariable: HtmlComponentVariable = {
            id: createHtmlComponentId('variable'),
            name,
            type,
            bindings: [{ targetNodeId: componentNodeId, attribute }],
            targetNodeId: componentNodeId,
            attribute,
            defaultValue: currentValue,
          };
          const unbound = componentVariables.map(variable =>
            htmlComponentVariableHasBinding(variable, componentNodeId, attribute)
              && types.includes(variable.type)
              ? withoutHtmlComponentVariableBinding(variable, componentNodeId, attribute)
              : variable,
          );
          onComponentVariablesChange([...unbound, nextVariable]);
          onManageComponentVariables?.(nextVariable.id);
        }}
        onManageVariables={() => onManageComponentVariables?.(linked?.id)}
      />
    );
  };
  const componentVariableLinkedValue = (
    types: HtmlComponentVariableType[],
    attribute: string,
  ) => {
    const linked = componentVariableFor(types, attribute);
    if (!linked || !onComponentVariablesChange) return null;
    return (
      <YcodeButton
        asChild
        variant="purple"
        className="h-8 justify-between px-2.5"
        onClick={() => onManageComponentVariables?.(linked.id)}
      >
        <div>
          <span className="flex min-w-0 items-center gap-1.5">
            <Component className="size-3 shrink-0 opacity-60" />
            <span className="truncate" data-kodety-no-i18n>{linked.name}</span>
          </span>
          <YcodeButton
            type="button"
            size="icon"
            variant="outline"
            className="size-5 shrink-0 p-0"
            aria-label={`Unlink ${linked.name}`}
            onClick={event => {
              event.stopPropagation();
              onComponentVariablesChange(componentVariables.map(variable => (
                variable.id === linked.id
                  ? withoutHtmlComponentVariableBinding(variable, componentNodeId, attribute)
                  : variable
              )));
            }}
          >
            <X className="size-2.5" />
          </YcodeButton>
        </div>
      </YcodeButton>
    );
  };
  useEffect(() => {
    // Keep the common link flow neutral by default. Native browser styling is
    // still available as an explicit opt-in from the toggle below.
    setLinkNativeStyle(false);
  }, [selection?.path, selection?.tag]);
  useEffect(() => {
    setCmsPreviewItem(cmsPreview?.item || null);
    setCmsPreviewItems(cmsPreview?.items || []);
    setCmsPreviewPostType(cmsPreview?.postType || '');
  }, [cmsPreview]);
  const selectionPath = selection?.path;
  const selectedOuterHtml = useMemo(() => {
    if (selectionPath === undefined) return '';
    try { return getElementOuterHtml(source, selectionPath); } catch { return ''; }
  }, [selectionPath, source]);
  const inlineStyles = useMemo(
    () => readSourceElementInlineStyles(source, selectionPath, selection?.attributes.style),
    [source, selectionPath, selection?.attributes.style],
  );
  const effectivePseudo = cssContext.pseudo;
  // A non-base breakpoint (tablet, mobile, custom…) only exists as a CSS rule.
  // When true, any property this breakpoint doesn't declare itself falls back
  // to the base breakpoint's value — real CSS cascade, made visible here.
  const isScopedBreakpoint = cssContext.breakpoint !== 'base';
  // What THIS exact context (selector + pseudo + breakpoint) declares on its
  // own — used to tell "own" from "inherited from base" apart.
  const ownStyles = cssAuthoringOwnDeclarations(cssRuleStyles);
  const confirmedStyleValues = keyframeStyles || ownStyles;
  const stylePreviewScopeKey = `${selection?.path || ''}:${cssContext.target}:${cssContext.selector}:${cssContext.pseudo}:${cssContext.breakpoint}:${activeBreakpoint}:${localeEditing?.code || ''}:${keyframeLabel || ''}:${currentPage}:${styleEditScopeKey}:${cssContext.cssFilePath}:${readOnly}`;
  const stylePreviewTransaction = useHtmlStylePreviewTransaction({
    onCommit: onStyleChange,
    onPreview: onStylePreview,
    onCancel: onStylePreviewCancel,
    scopeKey: stylePreviewScopeKey,
    confirmedValues: confirmedStyleValues,
  });
  const onVisualStyleChange = stylePreviewTransaction.change;
  const onVisualInteractionStart = onStylePreview
    ? stylePreviewTransaction.beginExternalInteraction
    : undefined;
  const onVisualInteractionEnd = onStylePreview
    ? stylePreviewTransaction.endExternalInteraction
    : undefined;
  const onVisualInteractionCancel = onStylePreview
    ? stylePreviewTransaction.cancel
    : undefined;
  const authoredStyleValues = useMemo(() => {
    // In a state (hover/active/focus/…) every field still shows the element's
    // current (resting) value as a fallback — never blank — so you can see what
    // you're changing instead of guessing. This is purely a DISPLAY fallback:
    // writing only ever happens on an actual edit (onChange from user input),
    // so leaving a field untouched never creates a spurious state override.
    // `ownStyles`/`cssRuleStyles` (used for the amber-dot/purple-chip "own"
    // markers) are unaffected — only what the state's own rule declares is
    // ever flagged as "own" or listed as a state override.
    // Infinite Canvas materializes viewport units as pixels so its iframe can
    // grow to the full document without turning `100svh` into the document
    // height. The selection snapshot carries the untouched authored sizing
    // declaration separately. It must win over the inspected rule/inline
    // snapshot; otherwise that editor-only pixel projection is presented as
    // `Fixed` even though the source is still `vh`/`svh`/`dvh`.
    return resolveInspectorStyleValues({
      pseudo: effectivePseudo,
      computedFallback: safeComputedFallback(selection?.computedStyle),
      inheritedBreakpointStyles: isScopedBreakpoint ? baseBreakpointStyles : undefined,
      inlineStyles,
      ruleStyles: cssRuleStyles,
      authoredProjectionStyles: selection?.authoredStyle,
      keyframeStyles,
      liveStyles: liveStyleValues,
      optimisticStyles: stylePreviewTransaction.optimisticValues,
    });
  }, [baseBreakpointStyles, cssRuleStyles, effectivePseudo, inlineStyles, isScopedBreakpoint, keyframeStyles, liveStyleValues, selection?.authoredStyle, selection?.computedStyle, stylePreviewTransaction.optimisticValues]);
  const styleValues = useMemo(() => {
    const customProperties = Object.fromEntries(
      Object.entries(authoredStyleValues)
        .filter(([property]) => property.startsWith('--'))
        .map(([property, value]) => [property, stripImportantPriority(value).trim()]),
    );
    designTokens.tokens.forEach(token => {
      customProperties[designTokenCssName(token.id)] = token.value;
    });
    return Object.fromEntries(
      Object.entries(authoredStyleValues).map(([property, value]) => {
        const visualValue = stripImportantPriority(value).trim();
        return [
          property,
          resolveInspectorCustomProperties(visualValue, customProperties),
        ];
      }),
    );
  }, [authoredStyleValues, designTokens]);
  // Explicitly authored declarations (not computed defaults) that fall outside
  // the fixed sections, plus any the user added this session — surfaced in an
  // "Advanced" panel so no CSS property is ever out of reach. Includes base
  // breakpoint properties when scoped, so they don't disappear from view.
  const explicitStyles = isScopedBreakpoint ? { ...baseBreakpointStyles, ...ownStyles } : ownStyles;
  const designTokenConnector = useHtmlDesignTokenConnector({
    document: designTokens,
    styleValues: authoredStyleValues,
    onDocumentChange: onDesignTokensChange,
    onBind: onVisualStyleChange,
    onEditToken: onDesignTokenEdit,
  });
  const setInspectorRootRef = useCallback((node: HTMLElement | null) => {
    stylePreviewTransaction.rootRef(node);
    designTokenConnector.rootRef(node);
  }, [designTokenConnector.rootRef, stylePreviewTransaction.rootRef]);
  const designTokenCss = useMemo(
    () => serializeHtmlDesignTokenCss(designTokens),
    [designTokens],
  );
  const designTokenRevision = useMemo(() => {
    let hash = 0;
    for (let index = 0; index < designTokenCss.length; index += 1) {
      hash = ((hash << 5) - hash + designTokenCss.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
  }, [designTokenCss]);
  const mediaObjectPosition = styleValues['object-position'] || '50% 50%';
  useEffect(() => {
    const next = parseObjectPositionFocus(mediaObjectPosition);
    setMediaFocus(current => (
      current[0] === next[0] && current[1] === next[1] ? current : next
    ));
  }, [mediaObjectPosition, selection?.path]);
  const applyMediaFocus = useCallback((point: MediaFocusPoint) => {
    const next = normalizeMediaFocusPoint(point);
    setMediaFocus(next);
    onVisualStyleChange('object-position', formatObjectPositionFocus(next));
  }, [onVisualStyleChange]);
  const mediaFocusFromPointer = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
  ): MediaFocusPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return mediaFocus;
    return normalizeMediaFocusPoint([
      ((event.clientX - rect.left) / rect.width) * 100,
      ((event.clientY - rect.top) / rect.height) * 100,
    ]);
  }, [mediaFocus]);
  const handleMediaFocusPointerDown = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    mediaFocusPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    onVisualInteractionStart?.();
    applyMediaFocus(mediaFocusFromPointer(event));
  }, [applyMediaFocus, mediaFocusFromPointer, onVisualInteractionStart]);
  const handleMediaFocusPointerMove = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (mediaFocusPointerRef.current !== event.pointerId) return;
    applyMediaFocus(mediaFocusFromPointer(event));
  }, [applyMediaFocus, mediaFocusFromPointer]);
  const handleMediaFocusPointerUp = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (mediaFocusPointerRef.current !== event.pointerId) return;
    applyMediaFocus(mediaFocusFromPointer(event));
    mediaFocusPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onVisualInteractionEnd?.();
  }, [applyMediaFocus, mediaFocusFromPointer, onVisualInteractionEnd]);
  const handleMediaFocusPointerCancel = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (mediaFocusPointerRef.current !== event.pointerId) return;
    mediaFocusPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onVisualInteractionCancel?.();
  }, [onVisualInteractionCancel]);
  const handleMediaFocusKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const delta = event.shiftKey ? 10 : 1;
    let next: MediaFocusPoint | null = null;
    if (event.key === 'ArrowLeft') next = [mediaFocus[0] - delta, mediaFocus[1]];
    if (event.key === 'ArrowRight') next = [mediaFocus[0] + delta, mediaFocus[1]];
    if (event.key === 'ArrowUp') next = [mediaFocus[0], mediaFocus[1] - delta];
    if (event.key === 'ArrowDown') next = [mediaFocus[0], mediaFocus[1] + delta];
    if (!next) return;
    event.preventDefault();
    applyMediaFocus(next);
  }, [applyMediaFocus, mediaFocus]);
  const inheritedCollection = useMemo(() => {
    if (selectionPath === undefined || !/\bdata-kodety-collection(?=[\s=/>])/i.test(source)) return null;
    // Reuse the exact parse5 path index used by selection and source patching.
    // Runtime computed-style messages can replace the SelectionSnapshot object
    // without changing this path and must not trigger another HTML parse.
    const index = inspectSourceElementIndex(source);
    const collectionFor = (candidatePath: string) => {
      const candidate = index.byPath.get(candidatePath);
      if (!candidate) return null;
      const type = candidate.attributes['data-kodety-collection'];
      if (!type) return null;
      return {
        type,
        path: candidatePath,
        label: candidate.attributes['data-label']
          || candidate.attributes.id
          || candidate.attributes.class?.split(/\s+/).find(Boolean)
          || candidate.tagName,
        orderby: candidate.attributes['data-kodety-orderby'] || 'date',
        order: candidate.attributes['data-kodety-order'] || 'DESC',
      };
    };
    if (selectionPath === '') return null;
    let nearest = collectionFor('');
    let path = '';
    for (const rawIndex of selectionPath.split('/').filter(Boolean).slice(0, -1)) {
      path = path ? `${path}/${rawIndex}` : rawIndex;
      nearest = collectionFor(path) || nearest;
    }
    return nearest;
  }, [selectionPath, source]);
  const canBeCollectionModel = useMemo(() => {
    if (selectionPath === undefined || !inheritedCollection) return false;
    return selectionPath !== inheritedCollection.path;
  }, [inheritedCollection, selectionPath]);
  const collectionModel = useMemo(() => {
    if (!selection?.attributes['data-kodety-collection'] || !selectedOuterHtml) return null;
    const parsed = new DOMParser().parseFromString(selectedOuterHtml, 'text/html');
    const model = parsed.body.firstElementChild?.querySelector('[data-kodety-collection-item]');
    if (!model) return null;
    return { label: model.getAttribute('data-label') || model.id || model.classList[0] || model.tagName.toLowerCase() };
  }, [selectedOuterHtml, selection?.attributes['data-kodety-collection']]);
  const handleCmsPreviewChange = useCallback((payload: { item: { id: number; revision?: string; values: Record<string, unknown> } | null; items: Array<{ id: number; revision?: string; values: Record<string, unknown> }>; postType: string } | null) => {
    setCmsPreviewItem(payload?.item || null);
    setCmsPreviewItems(payload?.items || []);
    setCmsPreviewPostType(payload?.postType || '');
    onCmsPreviewChange?.(payload);
  }, [onCmsPreviewChange]);
  const handleCollectionChange = useCallback((postType: string) => {
    if (!selection) return;
    if (postType && postType !== '__none') {
      onAttributesChange({
        'data-kodety-collection': postType,
        'data-kodety-repeat': selection.attributes['data-kodety-repeat'] || (selection.hasElementChildren ? 'child' : 'self'),
        'data-kodety-limit': selection.attributes['data-kodety-limit'] || '6',
        'data-kodety-orderby': selection.attributes['data-kodety-orderby'] || 'date',
        'data-kodety-order': selection.attributes['data-kodety-order'] || 'DESC',
      });
      return;
    }
    // Remove the collection through the DOM: a regex over the raw HTML could
    // also rewrite text content and markers that belong to nested collections.
    const parsed = new DOMParser().parseFromString(selectedOuterHtml, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!root) return;
    ['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat'].forEach(attribute => root.removeAttribute(attribute));
    root.querySelectorAll('[data-kodety-collection-item]').forEach(element => {
      if (!element.closest('[data-kodety-collection]')) element.removeAttribute('data-kodety-collection-item');
    });
    onSourceChange(patchReplaceElementOuterHtml(source, selection.path, root.outerHTML));
  }, [onAttributesChange, onSourceChange, selectedOuterHtml, selection, source]);
  const handleCollectionModelChange = useCallback((active: boolean) => {
    if (!selection || !inheritedCollection) return;
    try {
      onSourceChange(patchCollectionModel(
        source,
        inheritedCollection.path,
        active ? selection.path : null,
      ));
      toast.success(active ? 'Modelo da coleção definido.' : 'Repetição da coleção desativada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível alterar a repetição.');
    }
  }, [inheritedCollection, onSourceChange, selection, source]);
  const handleBindItemLink = useCallback(() => {
    if (!selection || !selectedOuterHtml) return;
    const parsed = new DOMParser().parseFromString(selectedOuterHtml, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!root) return;
    let target = root;
    if (root.tagName.toLowerCase() !== 'a') {
      // Turn the card into a real anchor so the whole element becomes the
      // click area for the item page, preserving attributes and content.
      const anchor = parsed.createElement('a');
      Array.from(root.attributes).forEach(attribute => anchor.setAttribute(attribute.name, attribute.value));
      while (root.firstChild) anchor.appendChild(root.firstChild);
      root.replaceWith(anchor);
      target = anchor;
    }
    target.setAttribute('data-kodety-bind-href', 'permalink');
    if (!target.getAttribute('href')) target.setAttribute('href', '#');
    const styles = parseStyleDeclarations(target.getAttribute('style') || '');
    if (!styles.color) styles.color = 'inherit';
    if (!styles['text-decoration']) styles['text-decoration'] = 'none';
    target.setAttribute('style', serializeStyleDeclarations(styles));
    target.setAttribute('data-kodety-neutral-link', 'true');
    onSourceChange(patchReplaceElementOuterHtml(source, selection.path, target.outerHTML));
    toast.success('Elemento conectado à página do item.');
  }, [onSourceChange, selectedOuterHtml, selection, source]);
  const handleCollectionRepeatSelf = useCallback(() => {
    if (!selection?.attributes['data-kodety-collection']) return;
    const parsed = new DOMParser().parseFromString(selectedOuterHtml, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!root) return;
    root.querySelectorAll('[data-kodety-collection-item]').forEach(element => element.removeAttribute('data-kodety-collection-item'));
    root.setAttribute('data-kodety-repeat', 'self');
    onSourceChange(patchReplaceElementOuterHtml(source, selection.path, root.outerHTML));
  }, [onSourceChange, selectedOuterHtml, selection, source]);
  const cmsBindingFor = useCallback((target: CmsFieldBindingTarget) => {
    if (!selection) return '';
    return cmsFieldBindingForTarget(selection, target);
  }, [selection]);
  const cmsFieldBindingContext = selection
    ? cmsFieldBindingContextType(selection, inheritedCollection?.type || '', cmsTemplatePostType)
    : '';
  const cmsFieldBindingAvailable = useCallback((target: CmsFieldBindingTarget) => canShowCmsFieldBinding({
    endpointAvailable: cmsAvailable,
    contextType: cmsFieldBindingContext,
    activeBinding: cmsBindingFor(target),
  }), [cmsAvailable, cmsBindingFor, cmsFieldBindingContext]);
  const cmsFieldBindingAction = (target: CmsFieldBindingTarget, kind: CmsFieldBindingKind) => {
    if (!selection || !cmsFieldBindingAvailable(target)) return undefined;
    return <HtmlCmsFieldBinding
      selection={selection}
      target={target}
      kind={kind}
      onAttributeChange={onAttributeChange}
      onAttributesChange={onAttributesChange}
      inheritedCollectionType={cmsFieldBindingContext}
    />;
  };
  const cmsValueFor = useCallback((target: 'content' | 'title' | 'href' | 'src' | 'alt', fallback: string) => {
    const binding = cmsBindingFor(target);
    const value = binding ? cmsPreviewItem?.values?.[binding] : undefined;
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return String(record.url ?? record.value ?? record.label ?? '');
    }
    return String(value);
  }, [cmsBindingFor, cmsPreviewItem]);
  const saveCmsProperty = useCallback(async (target: 'content' | 'title' | 'href' | 'src' | 'alt', value: unknown) => {
    const binding = cmsBindingFor(target);
    const postType = selection?.attributes['data-kodety-bind-type']
      || inheritedCollection?.type
      || selection?.attributes['data-kodety-collection']
      || cmsPreviewPostType
      || 'post';
    const wp = cmsHostConfig((window as typeof window & { kodetyWordPress?: { cmsItemsUrl?: string; mediaUploadUrl?: string; nonce?: string } }).kodetyWordPress);
    if (!binding || !cmsPreviewItem || !wp?.cmsItemsUrl) return;
    setCmsSavingTarget(target);
    try {
      const url = new URL(wp.cmsItemsUrl, window.location.href);
      const suffix = `/${encodeURIComponent(postType)}/${cmsPreviewItem.id}`;
      const restRoute = url.searchParams.get('rest_route');
      if (restRoute) url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}${suffix}`);
      else url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`;
      const response = await cmsFetch(url.toString(), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': wp.nonce || '' },
        body: JSON.stringify({ values: { [binding]: value }, expectedRevision: cmsPreviewItem.revision }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: number;
        values?: Record<string, unknown>;
        message?: string;
      } | null;
      if (!response.ok || !payload?.id || !payload.values) {
        throw new Error(payload?.message || 'Não foi possível salvar no CMS.');
      }
      const updated = payload as { id: number; revision?: string; values: Record<string, unknown> };
      const nextItems = cmsPreviewItems.length
        ? cmsPreviewItems.map(item => item.id === updated.id ? updated : item)
        : [updated];
      handleCmsPreviewChange({ item: updated, items: nextItems, postType: cmsPreviewPostType || postType });
      window.dispatchEvent(new CustomEvent('kodety-cms-item-updated', { detail: updated }));
      toast.success('Conteúdo salvo no CMS.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar no CMS.');
    } finally {
      setCmsSavingTarget('');
    }
  }, [cmsBindingFor, cmsPreviewItem, cmsPreviewItems, cmsPreviewPostType, handleCmsPreviewChange, inheritedCollection?.type, selection?.attributes]);
  const uploadCmsPropertyImage = useCallback(async (file: File) => {
    const wp = cmsHostConfig((window as typeof window & { kodetyWordPress?: { mediaUploadUrl?: string; nonce?: string } }).kodetyWordPress);
    if (!cmsBindingFor('src') || !wp?.mediaUploadUrl) return;
    setCmsImageUploading(true);
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      body.append('title', file.name.replace(/\.[^.]+$/, ''));
      const response = await cmsFetch(wp.mediaUploadUrl, { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': wp.nonce || '' }, body });
      if (!response.ok) throw new Error('Não foi possível enviar a imagem.');
      const attachment = await response.json() as { id?: number };
      if (!attachment.id) throw new Error('Mídia inválida.');
      await saveCmsProperty('src', attachment.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível enviar a imagem.');
    } finally {
      setCmsImageUploading(false);
    }
  }, [cmsBindingFor, saveCmsProperty]);
  const componentType = selection?.attributes['data-incode-component'] || '';
  const tabsModel = useMemo(() => (
    activeTab === 'settings' && selection && (
      componentType === 'tabs' || selection.attributes['data-label'] === 'Tabs' || selection.tag === 'div'
    ) ? readTabsModel(selectedOuterHtml, selection.attributes) : null
  ), [activeTab, componentType, selectedOuterHtml, selection]);
  const isOverlayComponent = componentType.startsWith('overlay-')
    || componentType === 'checkout-overlay'
    || selection?.attributes['data-kodety-overlay'] !== undefined;
  const authoredOverlays = useMemo(() => authoredOverlayOptions(source), [source]);
  const linkedOverlay = useMemo(
    () => overlayLinkedToSelection(selection, authoredOverlays),
    [authoredOverlays, selection],
  );
  const selectionInsideOverlay = useMemo(() => (
    Boolean(selection && authoredOverlays.some(overlay => (
      selection.path === overlay.rootPath
      || Boolean(overlay.rootPath && selection.path.startsWith(`${overlay.rootPath}/`))
    )))
  ), [authoredOverlays, selection]);
  const overlayMutationDisabled = readOnly || isLocaleOverride;
  const detachOverlay = useCallback(() => {
    if (!selection || overlayMutationDisabled) return;
    try {
      const detachedSource = patchElementAttributes(source, selection.path, {
        'data-kodety-overlay-target': '',
        'data-kodety-overlay-toggle': '',
        'data-kodety-overlay-open': '',
        'data-kodety-overlay-trigger': '',
        'data-kodefy-checkout': '',
        'aria-controls': '',
        'aria-expanded': '',
        'aria-haspopup': '',
      });
      const nextSource = linkedOverlay?.managed
        ? patchRemoveElement(detachedSource, linkedOverlay.rootPath)
        : detachedSource;
      onSourceChange(nextSource);
      setOverlayMenuOpen(false);
      toast.success(linkedOverlay?.managed ? 'Overlay removido.' : 'Overlay desconectado deste item.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível remover o overlay.');
    }
  }, [linkedOverlay, onSourceChange, overlayMutationDisabled, selection, source]);
  const attachOverlay = useCallback((overlay: AuthoredOverlayOption) => {
    if (!selection || overlayMutationDisabled) return;
    const checkout = overlay.kind === 'checkout';
    try {
      const next = patchElementAttributes(source, selection.path, {
        'data-kodety-overlay-target': overlay.id,
        'data-kodety-overlay-toggle': '',
        'data-kodety-overlay-open': checkout ? '' : overlay.id,
        'data-kodety-overlay-trigger': checkout ? overlay.id : '',
        'data-kodefy-checkout': checkout ? 'true' : '',
        'aria-controls': overlay.id,
        'aria-expanded': 'false',
        'aria-haspopup': ['modal', 'drawer', 'checkout', 'cart'].includes(overlay.kind) ? 'dialog' : 'true',
      });
      onSourceChange(next);
      setOverlayMenuOpen(false);
      window.requestAnimationFrame(() => onSelectPath?.(selection.path));
      toast.success(`${overlay.label} conectado ao item.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível conectar o overlay.');
    }
  }, [onSelectPath, onSourceChange, overlayMutationDisabled, selection, source]);
  const createAndAttachOverlay = useCallback((mode: 'relative' | 'fixed') => {
    if (!selection || overlayMutationDisabled) return;
    try {
      const prefix = mode === 'relative' ? 'kodety-relative-overlay' : 'kodety-fixed-overlay';
      let id = `${prefix}-${Date.now().toString(36)}`;
      let suffix = 2;
      while (source.includes(`id="${id}"`) || source.includes(`id='${id}'`)) {
        id = `${prefix}-${suffix}`;
        suffix += 1;
      }
      const markup = mode === 'relative'
        ? buildNativePopoverMarkup({ id, title: 'Popover', description: 'Edite este conteúdo diretamente no canvas.' })
        : buildNativeModalMarkup({ id, title: 'Modal', description: 'Edite este conteúdo diretamente no canvas.' });
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      const root = parsed.body.firstElementChild;
      if (!root) throw new Error('Não foi possível criar o overlay.');
      Array.from(root.children).find(child => child.hasAttribute('data-kodety-overlay-trigger'))?.remove();
      root.setAttribute('data-kodety-overlay-managed', 'true');
      root.setAttribute('data-kodety-overlay-mode', mode === 'relative' ? 'anchored' : 'fixed');
      root.setAttribute('data-label', mode === 'relative' ? 'Relative Overlay' : 'Fixed Overlay');

      const controlledSource = patchElementAttributes(source, selection.path, {
        'data-kodety-overlay-target': id,
        'data-kodety-overlay-toggle': '',
        'data-kodety-overlay-open': id,
        'data-kodety-overlay-trigger': '',
        'data-kodefy-checkout': '',
        'aria-controls': id,
        'aria-expanded': 'false',
        'aria-haspopup': mode === 'fixed' ? 'dialog' : 'true',
      });
      const inserted = patchInsertAdjacentElement(controlledSource, selection.path, root.outerHTML, 'after');
      onSourceChange(inserted.source);
      setOverlayMenuOpen(false);
      window.requestAnimationFrame(() => onSelectPath?.(selection.path));
      toast.success(mode === 'relative' ? 'Overlay relativo criado.' : 'Overlay fixo criado.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o overlay.');
    }
  }, [onSelectPath, onSourceChange, overlayMutationDisabled, selection, source]);
  const overlayDesignPanel = selection
    && !['body', 'html'].includes(selection.tag)
    && !selectionInsideOverlay
    && !isOverlayComponent ? (
      <SettingsPanel
        title="Overlays"
        isOpen
        onToggle={() => {}}
        action={(
          <YcodePopover open={overlayMenuOpen} onOpenChange={setOverlayMenuOpen}>
            <YcodePopoverTrigger asChild>
              <YcodeButton
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={overlayMutationDisabled}
                title={isLocaleOverride ? 'Overlays belong to the source content' : 'Add or connect overlay'}
                aria-label="Add overlay"
              >
                <Plus className="size-4" />
              </YcodeButton>
            </YcodePopoverTrigger>
            <YcodePopoverContent
              align="end"
              side="left"
              sideOffset={8}
              className="w-64 space-y-1 rounded-xl border-border/80 p-1.5 shadow-2xl"
            >
              <button
                type="button"
                className="group flex w-full items-center rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => createAndAttachOverlay('relative')}
              >
                <span className="min-w-0"><span className="block text-xs font-medium text-foreground">Relative</span><span className="block text-[10px] text-muted-foreground">Dropdowns, popovers</span></span>
              </button>
              <button
                type="button"
                className="group flex w-full items-center rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => createAndAttachOverlay('fixed')}
              >
                <span className="min-w-0"><span className="block text-xs font-medium text-foreground">Fixed</span><span className="block text-[10px] text-muted-foreground">Modals, drawers, videos</span></span>
              </button>
              {authoredOverlays.length > 0 && (
                <div className="mt-1 border-t border-border/65 pt-1">
                  <p className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Na página</p>
                  {authoredOverlays.map(overlay => (
                    <button
                      key={`${overlay.rootPath}:${overlay.id}`}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                      onClick={() => attachOverlay(overlay)}
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" data-kodety-no-i18n>{overlay.label}</span>
                      {linkedOverlay?.id === overlay.id && <Check className="size-3.5 shrink-0 text-[#72b5a3]" />}
                    </button>
                  ))}
                </div>
              )}
            </YcodePopoverContent>
          </YcodePopover>
        )}
      >
        {linkedOverlay && (
          <div className="grid min-h-10 grid-cols-[56px_minmax(0,1fr)] items-center gap-2" data-kodety-overlay-control>
            <span className="text-[11px] text-muted-foreground">Click</span>
            <div
              className="flex h-9 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.06] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]"
              onPointerDown={event => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 bg-transparent px-2.5 text-left outline-none"
                onClick={() => onSelectPath?.(linkedOverlay.surfacePath || linkedOverlay.rootPath)}
                title={`Open and edit ${linkedOverlay.label}`}
              >
                <Layers3 className="size-4 shrink-0 text-[#72b5a3]" />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" data-kodety-no-i18n={linkedOverlay.label ? true : undefined}>{linkedOverlay.label || 'Overlay'}</span>
              </button>
              <button
                type="button"
                disabled={overlayMutationDisabled}
                onClick={detachOverlay}
                title="Remove overlay from this item"
                aria-label="Remove overlay from this item"
                className="grid h-full w-8 shrink-0 place-items-center border-l border-white/[.055] bg-black/10 p-0 text-white/38 outline-none transition-[color,background-color] hover:bg-white/[.055] hover:text-white/68 focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)] disabled:pointer-events-none disabled:opacity-35"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </SettingsPanel>
    ) : null;
  const dropdownModel = useMemo(() => componentType === 'dropdown' && selection ? readDropdownModel(selectedOuterHtml, selection.attributes) : null, [componentType, selectedOuterHtml, selection]);
  const navbarModel = useMemo(() => componentType === 'navbar' ? readNavbarModel(selectedOuterHtml) : null, [componentType, selectedOuterHtml]);
  const sliderModel = useMemo(() => componentType === 'slider' && selection ? readSliderModel(selectedOuterHtml, selection.attributes) : null, [componentType, selectedOuterHtml, selection]);
  const pictureModel = useMemo(() => componentType === 'picture' ? readPictureModel(selectedOuterHtml) : null, [componentType, selectedOuterHtml]);
  const lightboxModel = useMemo(() => componentType === 'lightbox' && selection ? readLightboxModel(selectedOuterHtml, selection.attributes) : null, [componentType, selectedOuterHtml, selection]);
  const codeBlockModel = useMemo(() => componentType === 'code-block' ? readCodeBlockModel(selectedOuterHtml) : null, [componentType, selectedOuterHtml]);
  const selectOptions = useMemo(() => selection?.tag === 'select' ? readSelectOptions(selectedOuterHtml) : [], [selectedOuterHtml, selection?.tag]);
  const choiceModel = useMemo(() => ['checkbox', 'radio'].includes(componentType) ? readChoiceControl(selectedOuterHtml) : null, [componentType, selectedOuterHtml]);
  const searchModel = useMemo(() => componentType === 'search' ? readSearchComponent(selectedOuterHtml) : null, [componentType, selectedOuterHtml]);
  const prefersSettings = Boolean(
    selection && (
      componentControls
      || componentType
      || ['a', 'audio', 'button', 'canvas', 'details', 'dialog', 'form', 'iframe', 'img', 'input', 'label', 'option', 'picture', 'select', 'source', 'summary', 'textarea', 'track', 'video'].includes(selection.tag)
    ),
  );

  useEffect(() => {
    if (tabRequest) setActiveTab(tabRequest.tab);
  }, [tabRequest?.sequence, tabRequest?.tab]);
  useEffect(() => {
    if (!prefersSettings) return;
    setActiveTab(current => current === 'interactions' ? current : 'settings');
    const frame = window.requestAnimationFrame(() => {
      settingsScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [componentType, prefersSettings, selection?.path]);
  useEffect(() => {
    if (membershipFocusKey) setActiveTab('settings');
  }, [membershipFocusKey]);
  const hasComponentInteractions = Boolean(componentInteractions);
  const previousComponentInteractions = useRef(false);
  useEffect(() => {
    if (hasComponentInteractions && !previousComponentInteractions.current && !prefersSettings) {
      setActiveTab('interactions');
    }
    previousComponentInteractions.current = hasComponentInteractions;
  }, [hasComponentInteractions, prefersSettings]);

  useEffect(() => {
    setNewAttributeName('');
    setNewAttributeValue('');
    setNewTabLabel('');
    setNewComponentItemLabel('');
    const href = selection?.attributes.href || '';
    const emailHref = href.startsWith('mailto:');
    const phoneHref = href.startsWith('tel:');
    const assetHref = Boolean(href && mediaAssets.some(asset => asset.path === href));
    setLinkUrl(href && !href.startsWith('#') && !emailHref && !phoneHref && !assetHref ? href : '');
    setLinkType(
      !href
        ? 'none'
        : href.startsWith('#')
          ? 'section'
          : emailHref
            ? 'email'
            : phoneHref
              ? 'phone'
              : assetHref
                ? 'asset'
                : 'url',
    );
    setLinkSection(href.startsWith('#') ? href.slice(1) : '');
    setLinkAsset(assetHref ? href : '');
    if (emailHref) {
      const [address, query = ''] = href.slice(7).split('?');
      const params = new URLSearchParams(query);
      setLinkEmail(decodeURIComponent(address || ''));
      setLinkSubject(params.get('subject') || '');
      setLinkMessage(params.get('body') || '');
    } else {
      setLinkEmail('');
      setLinkSubject('');
      setLinkMessage('');
    }
    setLinkPhone(phoneHref ? href.slice(4) : '');
    setLinkNewTab(selection?.attributes.target === '_blank');
    setLinkDownload('download' in (selection?.attributes || {}));
    setLinkNoFollow((selection?.attributes.rel || '').split(/\s+/).includes('nofollow'));
    setScrollSectionId(selection?.attributes.id || '');
    const styles = parseStyleDeclarations(selection?.attributes.style || '');
    setScrollOffsetY((styles['scroll-margin-top'] || '0').replace(/px$/i, ''));
  }, [currentPage, mediaAssets, selection?.attributes.download, selection?.attributes.href, selection?.attributes.id, selection?.attributes.rel, selection?.attributes.style, selection?.attributes.target, selection?.path]);

  useEffect(() => {
    if (!linkPages.some(page => page.path === linkPage)) setLinkPage(currentPage || linkPages[0]?.path || '');
  }, [currentPage, linkPage, linkPages]);

  useEffect(() => {
    if (!cmsAvailable || !cmsBindingFor('href')) return;
    setLinkUrl(cmsValueFor('href', ''));
  }, [cmsAvailable, cmsBindingFor, cmsPreviewItem, cmsValueFor, selection?.path]);

  if (!selection) {
    return (
      <aside
        data-editor-sidebar-panel="right"
        data-ycode-html-inspector
        className="kodety-editor-design-sidebar flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--kodety-panel)]"
        style={{ width }}
      >
        {designTokenCss && <style data-kodety-design-token-editor>{designTokenCss}</style>}
        {componentControls && <div className="border-b border-border/55 px-3 py-2">{componentControls}</div>}
        <Tabs
          value="design"
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          <TabsList
            aria-label="Inspector panels"
            data-ycode-inspector-tabs
            data-kodety-i18n-root
            data-kodety-read-only-allow="true"
            className="kodety-editor-inspector-tabs"
          >
            <TabsTrigger value="design" data-kodety-onboarding="design-style" className="kodety-editor-inspector-tab">
              Style
            </TabsTrigger>
          </TabsList>
          <TabsContent value="design" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pb-12 text-center">
              <p className="text-[11px] leading-5 text-[var(--kodety-text-tertiary)]">
                Selecione um elemento no canvas ou veja as propriedades da página.
              </p>
              {onSelectPath && source.trim() && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-kodety-onboarding="design-select-page"
                  data-kodety-onboarding-reveal
                  data-kodety-read-only-allow="true"
                  onClick={() => onSelectPath('')}
                >
                  Selecionar página
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </aside>
    );
  }

  const isBodySelected = selection.tag.toLowerCase() === 'body';
  const isImage = selection.tag === 'img';
  const isVideo = selection.tag === 'video';
  const isAudio = selection.tag === 'audio';
  const isMedia = isImage || isVideo || isAudio;
  const cmsMediaSourceBinding = selection.attributes['data-kodety-bind-src']
    || ((selection.attributes['data-kodety-bind-target'] || (isMedia ? 'src' : 'content')) === 'src' ? selection.attributes['data-kodety-bind'] || '' : '');
  const isIframe = selection.tag === 'iframe';
  const iframeIdentity = `${componentType} ${selection.attributes.src || ''} ${selection.attributes.title || ''} ${selection.attributes['data-label'] || ''}`;
  const isYouTube = isIframe && (componentType === 'youtube' || /youtube(?:-nocookie)?\.com|youtu\.be/i.test(iframeIdentity));
  const isVimeo = isIframe && (componentType === 'vimeo' || /player\.vimeo\.com|vimeo\.com/i.test(iframeIdentity));
  const isForm = selection.tag === 'form';
  const isFilterForm = isForm && selection.attributes['data-kodety-form-mode'] === 'filter';
  const isMultiStepForm = isForm && selection.attributes['data-kodety-multistep'] === 'true';
  const isInput = selection.tag === 'input';
  const isTextarea = selection.tag === 'textarea';
  const isSelect = selection.tag === 'select';
  const isButton = selection.tag === 'button';
  const isButtonLike = isButton || (selection.tag === 'a' && ['link-block', 'button'].includes(selection.attributes['data-incode-component'] || ''));
  const hasWidgetControls = 'data-lottie-src' in selection.attributes || selection.tag === 'canvas' || ['Lottie Animation', 'Rive', 'Spline Scene'].includes(selection.attributes['data-label'] || '');
  const isTabs = Boolean(tabsModel && (selection.attributes['data-incode-component'] === 'tabs' || selection.attributes['data-label'] === 'Tabs' || selection.tag === 'div'));
  const isLink = selection.tag === 'a';
  const currentMediaAsset = mediaAssets.find(asset => asset.path === currentMediaAssetPath);
  const compatibleMediaAssets = mediaAssets.filter(asset => isImage ? asset.mimeType.startsWith('image/') : isVideo ? asset.mimeType.startsWith('video/') : asset.mimeType.startsWith('audio/'));
  const selectedLinkPage = linkPages.find(page => page.path === linkPage) || linkPages[0];
  const canEditText = !selection.hasElementChildren && !['img', 'video', 'input', 'source'].includes(selection.tag);
  const STATES: Array<{ value: CssPseudoState; label: string }> = [
    { value: 'base', label: 'Normal' },
    { value: 'hover', label: 'Hover' },
    { value: 'active', label: 'Active (pressed)' },
    { value: 'focus', label: 'Focus' },
    { value: 'focus-visible', label: 'Focus visible' },
    { value: 'selection', label: 'Text selection' },
    { value: 'placeholder', label: 'Placeholder' },
  ];
  const stateLabel = STATES.find(state => state.value === effectivePseudo)?.label || effectivePseudo;
  const defaultStateSelector = selection.classes[0] ? `.${selection.classes[0]}` : selection.id ? `#${selection.id}` : selection.tag;
  // States share the same class-only CSS authoring path as the base state.
  const applyState = (pseudo: CssPseudoState) => {
    // Finish the old state's edit while its CSS context is still authoritative,
    // then retire its transient control overlay before exposing the new state.
    // Otherwise a queued Hover sample can be committed as Normal after the
    // context ref advances, or visually cover the first Normal edit.
    stylePreviewTransaction.flush();
    onStylePreviewCancel?.();
    onCssContextChange(current => pseudo === 'base'
      ? { ...current, pseudo }
      : {
          ...current,
          pseudo,
          target: 'rule',
          breakpoint: activeBreakpoint || current.breakpoint || 'base',
          selector: current.selector.trim() || defaultStateSelector,
          cssFilePath: current.cssFilePath || cssFiles[0] || '',
        });
  };
  const commitTabsModel = (next: TabsModel) => {
    if (!selection) return;
    onSourceChange(patchReplaceElementOuterHtml(source, selection.path, serializeTabsModel(next)));
  };
  const replaceSelectedMarkup = (markup: string) => {
    if (!selection) return;
    onSourceChange(patchReplaceElementOuterHtml(source, selection.path, markup));
  };
  const mutateSelectedMarkup = (mutate: (root: HTMLElement) => void) => {
    if (!selection || typeof DOMParser === 'undefined') return;
    const doc = new DOMParser().parseFromString(selectedOuterHtml, 'text/html');
    const root = doc.body.firstElementChild as HTMLElement | null;
    if (!root) return;
    mutate(root);
    replaceSelectedMarkup(root.outerHTML);
  };
  const setFreeLayoutEnabled = (enabled: boolean) => mutateSelectedMarkup(root => {
    const storedPositionAttribute = 'data-kodety-free-layout-position';
    const storedPriorityAttribute = 'data-kodety-free-layout-position-priority';
    const emptyPosition = '__kodety_empty__';

    const rememberAndSetPosition = (element: HTMLElement, position: string) => {
      if (!element.hasAttribute(storedPositionAttribute)) {
        element.setAttribute(
          storedPositionAttribute,
          element.style.getPropertyValue('position') || emptyPosition,
        );
        const priority = element.style.getPropertyPriority('position');
        if (priority) element.setAttribute(storedPriorityAttribute, priority);
      }
      element.style.setProperty('position', position);
    };

    const restorePosition = (element: HTMLElement) => {
      const storedPosition = element.getAttribute(storedPositionAttribute);
      if (storedPosition === null) return;
      if (storedPosition === emptyPosition) {
        element.style.removeProperty('position');
      } else {
        element.style.setProperty(
          'position',
          storedPosition,
          element.getAttribute(storedPriorityAttribute) || '',
        );
      }
      element.removeAttribute(storedPositionAttribute);
      element.removeAttribute(storedPriorityAttribute);
      if (!root.getAttribute('style')?.trim()) root.removeAttribute('style');
      if (!element.getAttribute('style')?.trim()) element.removeAttribute('style');
    };

    const directChildren = Array.from(root.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );

    if (enabled) {
      root.setAttribute('data-kodety-free-layout', 'true');
      if (!styleValues.position || styleValues.position === 'static') {
        rememberAndSetPosition(root, 'relative');
      }
      directChildren.forEach(child => rememberAndSetPosition(child, 'absolute'));
      return;
    }

    root.removeAttribute('data-kodety-free-layout');
    restorePosition(root);
    directChildren.forEach(restorePosition);
  });
  const multiStepNodes = (root: HTMLElement) => Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-kodety-form-step'),
  );
  const multiStepDisplayAttribute = 'data-kodety-form-step-display';
  const multiStepDisplayPriorityAttribute = 'data-kodety-form-step-display-priority';
  const setMultiStepVisibility = (step: HTMLElement, visible: boolean) => {
    if (visible) {
      const storedDisplay = step.getAttribute(multiStepDisplayAttribute);
      if (storedDisplay !== null) {
        const priority = step.getAttribute(multiStepDisplayPriorityAttribute) || '';
        if (storedDisplay) step.style.setProperty('display', storedDisplay, priority);
        else step.style.removeProperty('display');
        step.removeAttribute(multiStepDisplayAttribute);
        step.removeAttribute(multiStepDisplayPriorityAttribute);
      }
      step.hidden = false;
      step.setAttribute('aria-hidden', 'false');
      return;
    }
    if (!step.hasAttribute(multiStepDisplayAttribute)) {
      step.setAttribute(multiStepDisplayAttribute, step.style.getPropertyValue('display'));
      const priority = step.style.getPropertyPriority('display');
      if (priority) step.setAttribute(multiStepDisplayPriorityAttribute, priority);
    }
    step.style.setProperty('display', 'none', 'important');
    step.hidden = true;
    step.setAttribute('aria-hidden', 'true');
  };
  const multiStepButtonStyle = 'appearance:none;display:inline-flex;box-sizing:border-box;min-height:44px;margin:0;padding:10px 16px;align-items:center;justify-content:center;border:0;border-radius:10px;background:#171717;color:#ffffff;font:600 14px/1.2 system-ui,sans-serif;cursor:pointer;';
  const multiStepBackStyle = 'appearance:none;display:inline-flex;box-sizing:border-box;min-height:44px;margin:0;padding:10px 16px;align-items:center;justify-content:center;border:1px solid #d4d4d4;border-radius:10px;background:#ffffff;color:#171717;font:600 14px/1.2 system-ui,sans-serif;cursor:pointer;';
  const ensureMultiStepStructure = (root: HTMLElement, requestedActive?: number) => {
    let steps = multiStepNodes(root);
    if (!steps.length) {
      const movable = Array.from(root.children).filter((child): child is HTMLElement => (
        child instanceof HTMLElement
        && !child.hasAttribute('data-kodety-form-success')
        && !child.hasAttribute('data-kodety-form-error')
        && !child.hasAttribute('data-kodety-form-status')
        && child.tagName.toLowerCase() !== 'script'
      ));
      const submitters = movable.filter(child => child.matches('button[type="submit"], input[type="submit"]'));
      const fields = movable.filter(child => !submitters.includes(child));
      const split = Math.max(1, Math.ceil(fields.length / 2));
      const first = document.createElement('div');
      const second = document.createElement('div');
      [first, second].forEach((step, index) => {
        step.setAttribute('data-kodety-form-step', String(index + 1));
        step.setAttribute('data-label', `Form Step ${index + 1}`);
        step.setAttribute('role', 'group');
        step.setAttribute('aria-label', `Step ${index + 1}`);
        step.style.cssText = 'box-sizing:border-box;display:grid;width:100%;gap:20px;';
      });
      fields.slice(0, split).forEach(child => first.appendChild(child));
      fields.slice(split).forEach(child => second.appendChild(child));
      submitters.forEach(child => second.appendChild(child));
      const insertionPoint = Array.from(root.children).find(child => (
        child instanceof HTMLElement
        && (child.hasAttribute('data-kodety-form-success') || child.hasAttribute('data-kodety-form-error'))
      )) || null;
      root.insertBefore(first, insertionPoint);
      root.insertBefore(second, insertionPoint);
      steps = [first, second];
    }

    let progress = Array.from(root.children).find(
      child => child instanceof HTMLElement && child.hasAttribute('data-kodety-form-progress'),
    ) as HTMLElement | undefined;
    if (!progress) {
      progress = document.createElement('div');
      progress.setAttribute('data-kodety-form-progress', 'true');
      progress.setAttribute('data-kodety-generated-step-progress', 'true');
      progress.setAttribute('role', 'progressbar');
      progress.style.cssText = 'box-sizing:border-box;display:grid;width:100%;gap:8px;';
      progress.innerHTML = '<div style="box-sizing:border-box;width:100%;height:6px;overflow:hidden;border-radius:999px;background:#e5e5e5;"><span data-kodety-form-progress-bar style="display:block;width:0%;height:100%;border-radius:inherit;background:#171717;transition:width .24s ease;"></span></div><span data-kodety-form-progress-text style="font:500 12px/1.3 system-ui,sans-serif;color:#737373;">Step 1 of 2</span>';
      root.insertBefore(progress, steps[0]);
    }

    steps = multiStepNodes(root);
    const last = steps[steps.length - 1];
    Array.from(root.querySelectorAll<HTMLElement>('button[type="submit"], input[type="submit"]')).forEach(control => {
      if (!control.closest('[data-kodety-form-step]') || control.closest('[data-kodety-form-step]') !== last) {
        last.appendChild(control);
      }
    });
    if (!last.querySelector('button[type="submit"], input[type="submit"]')) {
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'Submit';
      submit.style.cssText = multiStepButtonStyle;
      last.appendChild(submit);
    }

    steps.forEach((step, index) => {
      step.setAttribute('data-kodety-form-step', String(index + 1));
      step.setAttribute('aria-label', `Step ${index + 1}`);
      step.querySelectorAll<HTMLElement>('[data-kodety-generated-step-control]').forEach(control => {
        if (
          (control.hasAttribute('data-kodety-form-prev') && index === 0)
          || (control.hasAttribute('data-kodety-form-next') && index === steps.length - 1)
        ) control.remove();
      });
      if (index > 0 && !step.querySelector('[data-kodety-form-prev]')) {
        const back = document.createElement('button');
        back.type = 'button';
        back.textContent = 'Back';
        back.setAttribute('data-kodety-form-prev', 'true');
        back.setAttribute('data-kodety-generated-step-control', 'true');
        back.style.cssText = multiStepBackStyle;
        step.insertBefore(back, step.querySelector('button[type="submit"], input[type="submit"]'));
      }
      if (index < steps.length - 1 && !step.querySelector('[data-kodety-form-next]')) {
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = 'Next';
        next.setAttribute('data-kodety-form-next', 'true');
        next.setAttribute('data-kodety-generated-step-control', 'true');
        next.style.cssText = multiStepButtonStyle;
        step.appendChild(next);
      }
    });

    const active = Math.max(1, Math.min(steps.length, requestedActive || Number(root.dataset.kodetyStepActive) || 1));
    root.setAttribute('data-kodety-multistep', 'true');
    root.setAttribute('data-kodety-step-active', String(active));
    if (!root.hasAttribute('data-kodety-step-validation')) root.setAttribute('data-kodety-step-validation', 'true');
    steps.forEach((step, index) => {
      const visible = index === active - 1;
      setMultiStepVisibility(step, visible);
    });
    progress.setAttribute('aria-valuemin', '1');
    progress.setAttribute('aria-valuemax', String(steps.length));
    progress.setAttribute('aria-valuenow', String(active));
    progress.querySelector<HTMLElement>('[data-kodety-form-progress-bar]')?.style.setProperty('width', `${(active / steps.length) * 100}%`);
    const text = progress.querySelector<HTMLElement>('[data-kodety-form-progress-text]');
    if (text) text.textContent = `Step ${active} of ${steps.length}`;
  };
  const setMultiStepEnabled = (enabled: boolean) => mutateSelectedMarkup(root => {
    if (enabled) {
      ensureMultiStepStructure(root, 1);
      return;
    }
    multiStepNodes(root).forEach(step => {
      step.querySelectorAll('[data-kodety-generated-step-control]').forEach(control => control.remove());
      while (step.firstChild) root.insertBefore(step.firstChild, step);
      step.remove();
    });
    root.querySelectorAll<HTMLElement>('[data-kodety-form-next], [data-kodety-form-prev], [data-kodety-form-goto]').forEach(control => {
      control.removeAttribute('data-kodety-form-next');
      control.removeAttribute('data-kodety-form-prev');
      control.removeAttribute('data-kodety-form-goto');
    });
    root.querySelector<HTMLElement>('[data-kodety-generated-step-progress]')?.remove();
    ['data-kodety-multistep', 'data-kodety-step-active', 'data-kodety-step-validation'].forEach(attribute => root.removeAttribute(attribute));
  });
  const setActiveFormStep = (step: number) => mutateSelectedMarkup(root => ensureMultiStepStructure(root, step));
  const addFormStep = () => mutateSelectedMarkup(root => {
    ensureMultiStepStructure(root);
    const steps = multiStepNodes(root);
    const step = document.createElement('div');
    step.setAttribute('data-kodety-form-step', String(steps.length + 1));
    step.setAttribute('data-label', `Form Step ${steps.length + 1}`);
    step.setAttribute('role', 'group');
    step.style.cssText = 'box-sizing:border-box;display:grid;width:100%;min-height:80px;gap:20px;';
    const status = Array.from(root.children).find(child => child instanceof HTMLElement && (child.hasAttribute('data-kodety-form-success') || child.hasAttribute('data-kodety-form-error'))) || null;
    root.insertBefore(step, status);
    ensureMultiStepStructure(root, steps.length + 1);
  });
  const removeActiveFormStep = () => mutateSelectedMarkup(root => {
    ensureMultiStepStructure(root);
    const steps = multiStepNodes(root);
    if (steps.length <= 2) return;
    const active = Math.max(0, Math.min(steps.length - 1, Number(root.dataset.kodetyStepActive || '1') - 1));
    const removed = steps[active];
    const destination = steps[active > 0 ? active - 1 : 1];
    Array.from(removed.children).filter(child => !(child instanceof HTMLElement && child.hasAttribute('data-kodety-generated-step-control'))).forEach(child => destination.appendChild(child));
    removed.remove();
    ensureMultiStepStructure(root, Math.min(active + 1, steps.length - 1));
  });
  const assignMultiStepRole = (role: 'next' | 'prev' | 'progress') => {
    if (!selection) return;
    const formPath = selection.path;
    onBeginInteractionTargetPick(picked => {
      if (!picked.path.startsWith(`${formPath}/`)) {
        toast.error('Escolha um elemento dentro deste formulário.');
        return;
      }
      try {
        let next = source;
        next = patchElementAttributes(next, picked.path, {
          'data-kodety-form-next': role === 'next' ? 'true' : '',
          'data-kodety-form-prev': role === 'prev' ? 'true' : '',
          'data-kodety-form-progress': role === 'progress' ? 'true' : '',
          type: role === 'progress' ? picked.attributes.type || '' : 'button',
        });
        onSourceChange(next);
        toast.success(role === 'next' ? 'Elemento definido como Próximo.' : role === 'prev' ? 'Elemento definido como Voltar.' : 'Indicador de progresso definido.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível conectar o elemento.');
      }
    });
  };
  const updateNestedAttribute = (selector: string, name: string, value: string) => mutateSelectedMarkup(root => {
    const target = root.matches(selector) ? root : root.querySelector<HTMLElement>(selector);
    if (!target) return;
    if (value) target.setAttribute(name, value); else target.removeAttribute(name);
  });
  const updateNestedText = (selector: string, value: string) => mutateSelectedMarkup(root => {
    const target = root.matches(selector) ? root : root.querySelector<HTMLElement>(selector);
    if (target) target.textContent = value;
  });
  const commitSelectOptions = (options: SelectOptionModel[]) => mutateSelectedMarkup(root => {
    const select = root.matches('select') ? root : root.querySelector('select');
    if (!select) return;
    select.innerHTML = options.map(option => `<option${option.value ? ` value="${escapeHtmlAttribute(option.value)}"` : ''}${option.selected ? ' selected' : ''}${option.disabled ? ' disabled' : ''}>${escapeHtml(option.label || 'Option')}</option>`).join('');
  });
  const commitChoiceModel = (next: ChoiceControlModel) => mutateSelectedMarkup(root => {
    const input = root.matches('input') ? root : root.querySelector<HTMLInputElement>('input');
    if (!input) return;
    if (next.name) input.setAttribute('name', next.name); else input.removeAttribute('name');
    if (next.value) input.setAttribute('value', next.value); else input.removeAttribute('value');
    input.toggleAttribute('checked', next.checked);
    input.toggleAttribute('required', next.required);
    input.toggleAttribute('disabled', next.disabled);
    if (root.tagName.toLowerCase() === 'label') {
      Array.from(root.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
      root.append(document.createTextNode(` ${next.label || (componentType === 'radio' ? 'Radio' : 'Checkbox')}`));
    }
  });
  const commitSearchModel = (next: SearchComponentModel) => mutateSelectedMarkup(root => {
    if (next.action) root.setAttribute('action', next.action); else root.removeAttribute('action');
    root.setAttribute('method', next.method || 'get');
    const input = root.querySelector<HTMLInputElement>('input[type="search"], input');
    const button = root.querySelector<HTMLButtonElement>('button');
    if (input) {
      input.setAttribute('name', next.queryName || 'q');
      if (next.placeholder) input.setAttribute('placeholder', next.placeholder); else input.removeAttribute('placeholder');
    }
    if (button) button.textContent = next.buttonLabel || 'Search';
  });
  const commitDropdownModel = (next: DropdownModel) => replaceSelectedMarkup(serializeDropdownModel(next));
  const commitNavbarModel = (next: NavbarModel) => replaceSelectedMarkup(serializeNavbarModel(next));
  const commitSliderModel = (next: SliderModel) => replaceSelectedMarkup(serializeSliderModel(next));
  const commitPictureModel = (next: PictureModel) => replaceSelectedMarkup(serializePictureModel(next));
  const commitLightboxModel = (next: LightboxModel) => replaceSelectedMarkup(serializeLightboxModel(next));
  const commitCodeBlockModel = (next: CodeBlockModel) => replaceSelectedMarkup(serializeCodeBlockModel(next));
  const normalizeButtonContainer = () => {
    if (!selection || typeof DOMParser === 'undefined') return;
    const doc = new DOMParser().parseFromString(selectedOuterHtml, 'text/html');
    const root = doc.body.firstElementChild as HTMLElement | null;
    if (!root) return;
    if (!root.getAttribute('data-label')) root.setAttribute('data-label', root.tagName.toLowerCase() === 'a' ? 'Link Block' : 'Button');
    root.setAttribute('data-incode-component', root.tagName.toLowerCase() === 'a' ? 'link-block' : 'button');
    if (!root.children.length) root.innerHTML = `<span>${escapeHtml(root.textContent?.trim() || (root.tagName.toLowerCase() === 'a' ? 'Link Block' : 'Button'))}</span>`;
    const styles = parseStyleDeclarations(root.getAttribute('style') || '');
    root.setAttribute('style', serializeStyleDeclarations({
      appearance: styles.appearance || 'none',
      '-webkit-appearance': styles['-webkit-appearance'] || 'none',
      display: styles.display || 'inline-flex',
      'align-items': styles['align-items'] || 'center',
      'justify-content': styles['justify-content'] || 'center',
      gap: styles.gap || '8px',
      'box-sizing': styles['box-sizing'] || 'border-box',
      'min-height': styles['min-height'] || '44px',
      margin: styles.margin || '0',
      padding: styles.padding || '10px 16px',
      border: styles.border || '0',
      'border-radius': styles['border-radius'] || '0',
      background: styles.background || 'transparent',
      color: styles.color || 'inherit',
      font: styles.font || 'inherit',
      'line-height': styles['line-height'] || 'inherit',
      cursor: styles.cursor || 'pointer',
      ...styles,
    }));
    onSourceChange(patchReplaceElementOuterHtml(source, selection.path, root.outerHTML));
  };
  const customAttributes = Object.entries(selection.attributes).filter(([name]) => !name.startsWith('data-kodety-liquid-') && ![
    'id', 'class', 'title', 'style', 'href', 'target', 'rel', 'src', 'srcset', 'sizes', 'alt', 'loading', 'decoding', 'fetchpriority', 'poster', 'preload', 'crossorigin', 'controls', 'autoplay', 'loop', 'muted', 'playsinline', 'data-name', 'data-incode-animation-id', 'data-kodety-interaction-id', 'data-kodety-tracking-id',
    'name', 'type', 'placeholder', 'value', 'action', 'method', 'enctype', 'autocomplete', 'inputmode', 'pattern', 'capture', 'wrap', 'formaction', 'formmethod', 'novalidate', 'required', 'disabled', 'readonly', 'checked', 'multiple', 'accept', 'min', 'max', 'step', 'rows', 'cols', 'maxlength',
    'allow', 'allowfullscreen', 'sandbox', 'referrerpolicy', 'width', 'height', 'data-label', 'data-incode-component', 'data-slider-active', 'data-tabs-active', 'data-tabs-orientation', 'data-tabs-activation',
    'data-lottie-src', 'data-lottie-autoplay', 'data-lottie-loop', 'data-lottie-speed', 'data-lottie-direction', 'data-lottie-renderer',
    'data-rive-src', 'data-rive-state-machine', 'data-rive-artboard', 'data-rive-autoplay', 'data-rive-fit', 'data-rive-alignment', 'data-spline-src',
    'data-kodety-free-layout', 'data-kodety-free-layout-position', 'data-kodety-free-layout-position-priority',
    'data-kodety-cms-collection', 'data-kodety-cms-status', 'data-kodety-cms-map', 'data-kodety-cms-token',
    'data-kodety-form-mode', 'data-kodety-capture', 'data-kodety-success-action', 'data-kodety-success-message', 'data-kodety-error-message', 'data-kodety-redirect-url', 'data-kodety-utm-enabled', 'data-kodety-utm-config', 'data-kodety-success-target', 'data-kodety-error-target', 'data-kodety-reset-on-success', 'data-kodety-submitting-label', 'data-kodety-loading-label', 'data-kodety-range-output',
    'data-kodety-filter-collection', 'data-kodety-filter-map', 'data-kodety-filter-on', 'data-kodety-filter-url',
    'data-kodety-multistep', 'data-kodety-step-active', 'data-kodety-step-validation', 'data-kodety-form-step', 'data-kodety-form-step-display', 'data-kodety-form-step-display-priority', 'data-kodety-form-next', 'data-kodety-form-prev', 'data-kodety-form-goto', 'data-kodety-form-progress', 'data-kodety-form-progress-bar', 'data-kodety-form-progress-text', 'data-kodety-generated-step-control', 'data-kodety-generated-step-progress',
  ].includes(name));
  const formStepCount = isMultiStepForm
    ? Math.max(0, (selectedOuterHtml.match(/\bdata-kodety-form-step\s*=/gi) || []).length)
    : 0;
  const activeFormStep = Math.max(1, Math.min(formStepCount || 1, Number(selection.attributes['data-kodety-step-active']) || 1));
  const validNewAttribute = /^[A-Za-z_:][A-Za-z0-9:_.-]*$/.test(newAttributeName.trim());
  const copyablePropertyEntries = Object.entries(ownStyles).filter(([, value]) => value.trim());
  const elementInteractionsPanel = (
    <HtmlInteractionsPanel
      key={`${currentPage}\u0000${selection.path}`}
      source={source}
      selection={selection}
      scrollSections={linkPages.find(page => page.path === currentPage)?.sections || []}
      readOnly={readOnly || isLocaleOverride}
      savedAnimations={savedAnimations}
      onSourceChange={onInteractionSourceChange || onSourceChange}
      onSaveAnimation={onSaveAnimation}
      onRemoveSavedAnimation={onRemoveSavedAnimation}
      onOpenTimeline={(interactionId, actionId) => onTimelineOpen(interactionId, actionId)}
      onBeginTargetPick={onBeginInteractionTargetPick}
      onOpenEffectsLibrary={onOpenEffectsLibrary}
    />
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <aside
          ref={setInspectorRootRef}
          data-editor-sidebar-panel="right"
          data-kodety-onboarding="design-inspector-panel"
          data-ycode-html-inspector
          aria-label="Properties inspector"
          aria-readonly={readOnly}
          data-kodety-read-only={readOnly ? 'true' : undefined}
          className="kodety-editor-design-sidebar relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--kodety-panel)]"
          style={{ width }}
          {...stylePreviewTransaction.interactionProps}
          {...designTokenConnector.connectorProps}
          onPointerDownCapture={(event) => {
            blockReadOnlyControl(event);
            if (!event.defaultPrevented) {
              stylePreviewTransaction.interactionProps.onPointerDownCapture(event);
            }
          }}
          onKeyDownCapture={(event) => {
            blockReadOnlyControl(event);
            if (!event.defaultPrevented) {
              stylePreviewTransaction.interactionProps.onKeyDownCapture(event);
            }
          }}
        >
        {designTokenCss && <style data-kodety-design-token-editor>{designTokenCss}</style>}
        {designTokenConnector.overlay}
        <Tabs
          value={activeTab}
          onValueChange={value => setActiveTab(value as typeof activeTab)}
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
        >
        <TabsList
          aria-label="Inspector panels"
          data-kodety-onboarding="design-inspector-tabs"
          data-ycode-inspector-tabs
          data-kodety-i18n-root
          data-kodety-read-only-allow="true"
          className="kodety-editor-inspector-tabs"
        >
          <TabsTrigger
            value="design"
            data-kodety-onboarding="design-style"
            data-kodety-onboarding-reveal
            onClick={() => setActiveTab('design')}
            className="kodety-editor-inspector-tab"
          >Style</TabsTrigger>
          <TabsTrigger
            value="settings"
            data-kodety-onboarding="design-element-settings"
            data-kodety-onboarding-reveal
            onClick={() => setActiveTab('settings')}
            className="kodety-editor-inspector-tab"
          >Settings</TabsTrigger>
          <TabsTrigger
            value="interactions"
            data-kodety-onboarding="design-interactions"
            data-kodety-onboarding-reveal
            onClick={() => setActiveTab('interactions')}
            className="kodety-editor-inspector-tab"
          >Interactions</TabsTrigger>
        </TabsList>

        <TabsContent
          value="design"
          data-kodety-onboarding="design-style-panel"
          data-kodety-i18n-root
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          {keyframeLabel && (
            <button
              type="button" onClick={() => onTimelineOpen()}
              className="mx-3 mt-3 border-l-2 border-[var(--kodety-accent-hover)]/70 py-1 pl-2 text-left text-[10px] text-[var(--kodety-accent-hover)] transition-colors hover:border-[var(--kodety-accent-hover)]"
            >
              <span className="block font-medium">Editando {keyframeLabel}</span>
              <span className="text-[var(--kodety-accent-hover)]/60">Mudanças de Design serão gravadas somente neste keyframe.</span>
            </button>
          )}
          {localeEditing && !localeEditing.isSource && (
            <div
              data-locale-editing-context={localeEditing.code}
              className="mx-3 mt-3 border-l-2 border-[var(--kodety-accent-hover)]/70 py-0.5 pl-2.5"
            >
              <div className="flex min-h-5 items-center gap-1.5">
                <Languages className="size-3.5 shrink-0 text-[var(--kodety-accent-hover)]" />
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[var(--kodety-accent-hover)]">
                  Editando {localeEditing.name}
                </span>
                <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-accent-hover)]/75">
                  {localeEditing.exclusive
                    ? localeEditing.hasDirectOverride ? 'Exclusiva' : 'Exclusiva herdada'
                    : localeEditing.hasDirectOverride
                      ? 'Override'
                      : 'Herdado'}
                </span>
                {(localeEditing.hasDirectOverride || localeEditing.exclusive) && onResetLocaleOverride && (
                  <button
                    type="button"
                    onClick={onResetLocaleOverride}
                    className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center text-[var(--kodety-accent-hover)]/70 outline-none transition-colors hover:text-[var(--kodety-accent-hover)] focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]"
                    title={localeEditing.exclusive && !localeEditing.hasDirectOverride
                      ? `Ocultar esta seção herdada somente em ${localeEditing.code}`
                      : `Remove ${localeEditing.code} override and return to fallback`}
                    aria-label={localeEditing.exclusive && !localeEditing.hasDirectOverride
                      ? `Ocultar seção herdada em ${localeEditing.code}`
                      : `Remove ${localeEditing.code} override`}
                  >
                    {localeEditing.exclusive && !localeEditing.hasDirectOverride
                      ? <EyeOff className="size-3" />
                      : <RotateCcw className="size-3" />}
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[9px] leading-[1.45] text-[var(--kodety-accent-hover)]/60">
                {localeEditing.exclusive
                  ? localeEditing.hasDirectOverride
                    ? `Esta layer é própria de ${localeEditing.code}.`
                    : `This layer comes from ${localeEditing.inheritedFrom || 'a fallback language'}; override it or hide it only here.`
                  : localeEditing.hasDirectOverride
                    ? `Imagem, layout e visibilidade alterados aqui não modificam ${localeEditing.sourceLocale}.`
                    : localeEditing.inheritedFrom
                      ? `No local value; using ${localeEditing.inheritedFrom} as fallback.`
                      : `No local value; using the ${localeEditing.sourceLocale} source content.`}
              </p>
            </div>
          )}
          <div
            data-html-inspector-scroll-region
            data-ycode-style-panel
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden no-scrollbar"
          >
          <div
            data-html-inspector-selection-context
            className="border-b border-border/55 px-3 pb-3 pt-2.5"
          >
            <div className="mb-2 flex min-h-6 items-center gap-1.5">
              <span className="font-mono text-[11px] font-medium text-foreground" data-kodety-no-i18n>{selection.tag}</span>
              <span className="text-muted-foreground/35">/</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" data-kodety-no-i18n={selection.id ? true : undefined} title={selection.id ? `#${selection.id}` : 'element'}>{selection.id ? `#${selection.id}` : 'element'}</span>
              {selectionCount > 1 && <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{selectionCount} selected</span>}
            </div>
            {isLocaleOverride ? (
              <KodetyClassFieldRow
                value={selection.attributes.class || ''}
                onCommit={value => onAttributeChange('class', value)}
              />
            ) : (
              <div className="mb-2.5 space-y-2">
                <HtmlClassSelector
                  selection={selection} cssContext={cssContext}
                  onCssContextChange={onCssContextChange} onAttributeChange={onAttributeChange}
                  cssFiles={cssFiles} source={source}
                  onRenameClass={onRenameClass} onDuplicateClass={onDuplicateClass}
                  reusableClasses={reusableClasses}
                  onRegisterReusableClass={onRegisterReusableClass}
                />
                <div data-css-rule-context-control className="hidden" aria-hidden="true">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        tabIndex={-1}
                        className="flex min-h-7 w-full items-center justify-between gap-2 rounded-[7px] border border-border/70 bg-transparent px-2 text-left text-[10px] text-muted-foreground outline-none hover:border-border focus-visible:ring-1 focus-visible:ring-ring"
                        title="Arquivo CSS e breakpoint desta regra"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-mono" data-kodety-no-i18n={cssContext.cssFilePath ? true : undefined}>{cssContext.cssFilePath.split('/').pop() || 'no file'}</span>
                          {cssContext.breakpoint !== 'base' && <span data-kodety-no-i18n>{` · ${breakpoints.find(breakpoint => breakpoint.id === cssContext.breakpoint)?.label || cssContext.breakpoint}`}</span>}
                          {' · '}
                          {Object.keys(ownStyles).length
                            ? `${Object.keys(ownStyles).length} propriedade${Object.keys(ownStyles).length > 1 ? 's' : ''}`
                            : 'regra nova'}
                        </span>
                        <ChevronDown className="size-3 shrink-0 opacity-60" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 space-y-3 p-3">
                      <label className="block space-y-1 text-[9px] text-muted-foreground">
                        Arquivo CSS
                        <Select
                          value={cssContext.cssFilePath}
                          onValueChange={cssFilePath => onCssContextChange({ ...cssContext, cssFilePath })}
                        >
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>{cssFiles.map(path => <SelectItem key={path} value={path}><span data-kodety-no-i18n>{path}</span></SelectItem>)}</SelectContent>
                        </Select>
                      </label>
                      <label className="block space-y-1 text-[9px] text-muted-foreground">
                        Breakpoint
                        <Select
                          value={cssContext.breakpoint}
                          onValueChange={breakpoint => onCssContextChange({ ...cssContext, breakpoint: breakpoint as CssBreakpoint })}
                        >
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="base"><span data-kodety-no-i18n>{primaryBreakpoint.label}</span> · global · {primaryBreakpoint.width}px</SelectItem>
                            {breakpoints.map(breakpoint => (
                              <SelectItem key={breakpoint.id} value={breakpoint.id}>
                                <span data-kodety-no-i18n>{breakpoint.label}</span> · {breakpoint.mode === 'max-width' ? '≤' : '≥'} {breakpoint.width}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <Button
                        size="xs" variant="ghost"
                        className="w-full justify-start text-muted-foreground" onClick={() => setShowBreakpointManager(current => !current)}
                      >{showBreakpointManager ? 'Close manager' : 'Manage breakpoints'}</Button>
                      {showBreakpointManager && (
                        <BreakpointManager
                          primaryBreakpoint={primaryBreakpoint} onPrimaryChange={onPrimaryBreakpointChange}
                          breakpoints={breakpoints} onChange={onBreakpointsChange}
                          activeId={activeBreakpoint} onSelect={onSelectBreakpoint}
                        />
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
                {isScopedBreakpoint && (
                  <p className="border-l border-amber-400/50 py-0.5 pl-2 text-[9px] leading-relaxed text-muted-foreground">
                    No local value; this field inherits from wider breakpoints (<span className="mx-0.5 inline-block size-1.5 rounded-full bg-amber-400 align-middle" />). Editing writes only to <strong>{breakpoints.find(item => item.id === cssContext.breakpoint)?.label || cssContext.breakpoint}</strong>.
                  </p>
                )}
              </div>
            )}
            <div className="mb-2.5 grid min-h-7 grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
              <span className="shrink-0 text-[10px] text-muted-foreground">State</span>
              <div className="flex min-w-0 items-center gap-1.5">
                <Select
                  value={isLocaleOverride ? 'base' : effectivePseudo}
                  disabled={isLocaleOverride}
                  onValueChange={value => applyState(value as CssPseudoState)}
                >
                  <SelectTrigger
                    size="sm"
                    className={cn('h-8 min-w-0 flex-1 rounded-lg !border-transparent !bg-white/[.05] text-xs shadow-none hover:!bg-white/[.08] focus-visible:!border-ring', effectivePseudo !== 'base' && 'text-[var(--kodety-accent-hover)]')}
                    title={cssFiles.length ? 'Edit an interaction state' : 'Project CSS will be created automatically'}
                  ><SelectValue /></SelectTrigger>
                  <SelectContent>{STATES.map(state => <SelectItem key={state.value} value={state.value}>{state.label}</SelectItem>)}</SelectContent>
                </Select>
                {effectivePseudo !== 'base' && (
                  <Button
                    size="icon-xs" variant="ghost"
                    title="Return to base state" aria-label="Return to base state" onClick={() => applyState('base')}
                  ><X className="size-3.5" /></Button>
                )}
              </div>
            </div>
            {effectivePseudo !== 'base' && (
              <p className="mb-3 border-l-2 border-emerald-500/55 py-0.5 pl-2 text-[9px] leading-relaxed text-emerald-300/90">
                Editando <strong>{stateLabel}</strong> · só os estilos definidos aqui se aplicam nesse estado. Campos vazios herdam do base.
              </p>
            )}
            {effectivePseudo !== 'base' && Object.keys(ownStyles).length > 0 && (
              <div className="mb-3 space-y-1">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Substituído em {stateLabel}</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(ownStyles).map(([property, value]) => (
                    <StateOverrideChip
                      key={property} property={property}
                      value={value} original={selection.computedStyle[property]}
                      onReset={() => onVisualStyleChange(property, '')}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div
            data-html-design-property-widths
            style={{ '--html-design-control-label-width': '72px' } as React.CSSProperties}
          >
              <div className="px-3" style={{ '--html-design-control-label-width': '88px' } as React.CSSProperties}>
                <HtmlKodetyPositionControls
                  tag={selection.tag}
                  scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                  values={styleValues}
                  authoredValues={explicitStyles}
                  onChange={onVisualStyleChange}
                  onInteractionStart={onVisualInteractionStart}
                  onInteractionEnd={onVisualInteractionEnd}
                  onInteractionCancel={onVisualInteractionCancel}
                />
              </div>
              <div data-ycode-style-controls data-ycode-native-ui className="flex flex-col divide-y px-4">
              <HtmlKodetyLayoutControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
                visibleDisplay={displayRestoreState
                  ? resolveInspectorCustomProperties(displayRestoreState.previousValue || displayRestoreState.fallbackDisplay, styleValues)
                  : undefined}
                onVisibilityChange={onVisibilityChange ? visible => {
                  stylePreviewTransaction.flush();
                  onVisibilityChange(visible);
                } : undefined}
                freeLayout={selection.attributes['data-kodety-free-layout'] === 'true'}
                onFreeLayoutChange={setFreeLayoutEnabled}
              />
              <HtmlKodetySelfLayoutControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                parentDisplay={selection.parentDisplay}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <HtmlKodetySpacingControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <HtmlKodetySizingControls
                tag={selection.tag}
                values={styleValues}
                onChange={onVisualStyleChange}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                parentHasGrid={selection.parentDisplay?.includes('grid') ?? false}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <HtmlKodetyTypographyControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              {overlayDesignPanel && (
                <div data-ycode-native-ui>
                  {overlayDesignPanel}
                </div>
              )}
              <HtmlKodetyBackgroundsControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <HtmlKodetyBorderControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                authoredValues={explicitStyles}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <HtmlKodetyEffectControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <HtmlKodetyTransformControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <HtmlKodetyTransitionControls
                tag={selection.tag}
                scopeKey={`${stylePreviewScopeKey}:tokens-${designTokenRevision}`}
                values={styleValues}
                onChange={onVisualStyleChange}
                onInteractionStart={onVisualInteractionStart}
                onInteractionEnd={onVisualInteractionEnd}
                onInteractionCancel={onVisualInteractionCancel}
              />
              <CursorControls
                value={styleValues.cursor || 'auto'}
                onChange={value => onVisualStyleChange('cursor', value)}
              />
              <SettingsPanel
                title="Scroll Section"
                onboardingId="style-scroll-section"
                isOpen={Boolean(openSections['Scroll Section'])}
                onToggle={() => setOpenSections(current => ({ ...current, 'Scroll Section': !current['Scroll Section'] }))}
                collapsible
              >
                <p className="text-xs leading-relaxed text-muted-foreground">Create a navigable target that appears automatically in the project link selectors.</p>
                <YcodeSettingsRow label="Name">
                  <div className="relative min-w-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">#</span>
                    <YcodeInput
                      className="pl-5"
                      value={scrollSectionId}
                      onChange={event => setScrollSectionId(event.target.value.replace(/^#/, ''))}
                      placeholder="features"
                    />
                  </div>
                </YcodeSettingsRow>
                <YcodeSettingsRow label="Offset Y">
                  <div className="relative min-w-0">
                    <YcodeInput
                      className="pr-8"
                      type="number"
                      value={scrollOffsetY}
                      onChange={event => setScrollOffsetY(event.target.value)}
                      disableKeyboardStep
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">px</span>
                  </div>
                </YcodeSettingsRow>
                <YcodeButton
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={!scrollSectionId.trim()}
                  onClick={() => onScrollSectionApply(scrollSectionId, Number(scrollOffsetY) || 0)}
                >
                  Save scroll section
                </YcodeButton>
              </SettingsPanel>
            {isBodySelected && (
              <>
                <SettingsPanel
                  title="Text Selection" isOpen={Boolean(openSections['Seleção de texto'])}
                  onboardingId="style-text-selection"
                  onToggle={() => setOpenSections(current => ({ ...current, 'Seleção de texto': !current['Seleção de texto'] }))}
                  collapsible
                >
              <p className="text-xs leading-relaxed text-muted-foreground">
                    Cor ao selecionar texto (`::selection`) para a página inteira.
                  </p>
                  <ColorRow
                    label="Text" value={selectionStyles.color || ''}
                    onChange={value => onSelectionStyleChange('color', value)}
                  />
                  <ColorRow
                    label="Background" value={selectionStyles['background-color'] || ''}
                    onChange={value => onSelectionStyleChange('background-color', value)}
                  />
                </SettingsPanel>
                <SettingsPanel
                  title="Scrollbar" isOpen={Boolean(openSections['Barra de rolagem'])}
                  onboardingId="style-scrollbar"
                  onToggle={() => setOpenSections(current => ({ ...current, 'Barra de rolagem': !current['Barra de rolagem'] }))}
                  collapsible
                >
              <p className="text-xs leading-relaxed text-muted-foreground">
                    Scrollbar customizada (WebKit + Firefox) para a página inteira.
                  </p>
                  <YcodeSettingsRow label="Width">
                    <DraftInput
                      value={scrollbarStyles.width} onCommit={value => onScrollbarChange({ ...scrollbarStyles, width: value.replace(/[^\d.]/g, '') })}
                      placeholder="10px"
                    />
                  </YcodeSettingsRow>
                  <YcodeSettingsRow label="Radius">
                    <DraftInput
                      value={scrollbarStyles.radius} onCommit={value => onScrollbarChange({ ...scrollbarStyles, radius: value.replace(/[^\d.]/g, '') })}
                      placeholder="8px"
                    />
                  </YcodeSettingsRow>
                  <ColorRow
                    label="Thumb" value={scrollbarStyles.thumbColor}
                    onChange={value => onScrollbarChange({ ...scrollbarStyles, thumbColor: value })}
                  />
                  <ColorRow
                    label="Trilho" value={scrollbarStyles.trackColor}
                    onChange={value => onScrollbarChange({ ...scrollbarStyles, trackColor: value })}
                  />
                </SettingsPanel>
              </>
            )}
            <AdvancedStylePanel
              explicitStyles={explicitStyles} ownStyles={ownStyles}
              styleValues={styleValues} onStyleChange={onVisualStyleChange}
            />
            <SettingsPanel
              title="Code Overrides" isOpen={Boolean(openSections['Code Overrides'])}
              onboardingId="style-code-overrides"
              onToggle={() => setOpenSections(current => ({ ...current, 'Code Overrides': !current['Code Overrides'] }))}
              collapsible
            >
              <AttachmentSection
                type="css" label="CSS"
                attached={readAttachedFiles(selection.attributes['data-incode-css-files'])}
                options={cssFileOptions}
                onAttach={path => onAttachFile('css', path)}
                onDetach={path => onDetachFile('css', path)}
                onCreate={name => onCreateAndAttachFile('css', name)}
              />
              <AttachmentSection
                type="js" label="JavaScript"
                attached={readAttachedFiles(selection.attributes['data-incode-js-files'])}
                options={jsFileOptions}
                onAttach={path => onAttachFile('js', path)}
                onDetach={path => onDetachFile('js', path)}
                onCreate={name => onCreateAndAttachFile('js', name)}
              />
            </SettingsPanel>
            {isBodySelected && <SettingsPanel
              title="Fluid Responsive" isOpen={Boolean(openSections['Fluid Responsive'])}
              onboardingId="style-fluid"
              onToggle={() => setOpenSections(current => ({ ...current, 'Fluid Responsive': !current['Fluid Responsive'] }))}
              collapsible
            >
              <p className="text-xs leading-relaxed text-muted-foreground">Convert measurements on this layer and its descendants without changing CSS outside this scope.</p>
              <YcodeSettingsRow label="Base viewport">
                <YcodeInput value={fluidConfig.baseViewport} onChange={event => setFluidConfig(current => ({ ...current, baseViewport: Number(event.target.value) || 1440 }))} />
              </YcodeSettingsRow>
              <YcodeSettingsRow label="Minimum viewport">
                <YcodeInput value={fluidConfig.minViewport} onChange={event => setFluidConfig(current => ({ ...current, minViewport: Number(event.target.value) || 390 }))} />
              </YcodeSettingsRow>
              <YcodeSettingsRow label="Root font">
                <YcodeInput value={fluidConfig.rootFontSize} onChange={event => setFluidConfig(current => ({ ...current, rootFontSize: Number(event.target.value) || 16 }))} />
              </YcodeSettingsRow>
              <YcodeSettingsRow label="Minimum scale">
                <YcodeInput value={Math.round(fluidConfig.minScale * 100)} onChange={event => setFluidConfig(current => ({ ...current, minScale: Math.max(0.05, Math.min(1, (Number(event.target.value) || 60) / 100)) }))} />
              </YcodeSettingsRow>
              <YcodeSettingsRow label="Hairlines">
                <div className="flex min-h-8 items-center justify-end">
                  <YcodeSwitch size="sm" checked={fluidConfig.preserveHairlines} onCheckedChange={checked => setFluidConfig(current => ({ ...current, preserveHairlines: checked }))} />
                </div>
              </YcodeSettingsRow>
              <YcodeSettingsRow label="Ignore">
                <YcodeInput
                  value={fluidExclude} onChange={event => setFluidExclude(event.target.value)}
                  placeholder="letter-spacing, border-radius" className="font-mono"
                />
              </YcodeSettingsRow>
              <div className="rounded-md border border-dashed border-border/60 p-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground">Preview</span>
                  <YcodeInput
                    value={fluidPreviewPx} onChange={event => setFluidPreviewPx(event.target.value)}
                    className="h-6 w-16 text-[10px]" disableKeyboardStep
                  />
                  <span className="text-[9px] text-muted-foreground">px →</span>
                </div>
                <code className="mt-1 block break-all font-mono text-[9px] leading-relaxed text-emerald-400">{fluidPreview || '—'}</code>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <YcodeButton size="xs" onClick={() => onResponsiveApply(effectiveFluidConfig, 'fluid')}>Generate clamp()</YcodeButton>
                <YcodeButton
                  size="xs" variant="input"
                  onClick={() => onResponsiveApply(effectiveFluidConfig, 'rem')}
                >Convert to rem</YcodeButton>
              </div>
            </SettingsPanel>}
              </div>
          </div>
          </div>
        </TabsContent>

        <TabsContent
          ref={settingsScrollRef}
          value="settings"
          data-kodety-onboarding="design-element-settings-panel"
          data-html-inspector-settings-scroll
          data-ycode-settings-panel
          data-ycode-native-ui
          data-kodety-i18n-root
          className="mt-0 min-h-0 flex-1 overflow-y-auto px-4 no-scrollbar data-[state=inactive]:hidden"
        >
          <div className="flex flex-col divide-y">
          {componentControls && (
            <div className="min-w-0 empty:hidden">
              {componentControls}
            </div>
          )}
          {!htmlComponentInstanceSelected && (
          <>
          {membershipControls && (
            <div>
              {membershipControls}
            </div>
          )}
          <div data-kodety-onboarding="element-identity" className="flex flex-col gap-2 pb-5 pt-5">
            <FieldRow
              label="ID" value={selection.attributes.id || ''}
              onCommit={value => onAttributeChange('id', value)}
            />
            <YcodeSettingsRow label="Tag">
              <HtmlSettingsSelectControl
                label="Tag"
                kind="tag"
                value={selection.tag}
                onChange={onChangeTag}
                disabled={selection.tag === 'body'}
                allowUnset={false}
                options={[
                  ...(!TAG_OPTIONS.some(option => option.value === selection.tag)
                    ? [{ value: selection.tag, label: selection.tag }]
                    : []),
                  ...TAG_OPTIONS,
                ]}
              />
            </YcodeSettingsRow>
            <FieldRow
              label="Tracking ID" value={selection.attributes['data-kodety-tracking-id'] || ''}
              onCommit={value => onAttributeChange('data-kodety-tracking-id', value.trim())}
            />
            <FieldRow
              label={componentVariableLabel('Title', ['text'], 'title', selection.attributes.title || '')}
              ariaLabel="Title"
              value={cmsValueFor('title', selection.attributes.title || '')}
              replacement={componentVariableLinkedValue(['text'], 'title')}
              onCommit={value => {
                if (cmsBindingFor('title')) void saveCmsProperty('title', value);
                else onAttributeChange('title', value);
              }}
              action={cmsFieldBindingAction('title', 'text')}
              connected={Boolean(cmsBindingFor('title'))}
              saving={cmsSavingTarget === 'title'}
            />
          </div>
          {canEditText && (
            <SettingsPanel
              title="Element" isOpen
              onToggle={() => {}}
            >
              <FieldRow
                label={componentVariableLabel('Content', ['text', 'rich_text'], '', selection.text)}
                ariaLabel="Content"
                value={cmsValueFor('content', selection.text)}
                replacement={componentVariableLinkedValue(['text', 'rich_text'], '')}
                onCommit={value => {
                  if (cmsBindingFor('content')) void saveCmsProperty('content', value);
                  else onTextChange(value);
                }} multiline
                action={cmsFieldBindingAction('content', 'text')}
                connected={Boolean(cmsBindingFor('content'))}
                saving={cmsSavingTarget === 'content'}
              />
            </SettingsPanel>
          )}
          {!canEditText && containerLines && (
            <SettingsPanel
              title="Element" isOpen
              onToggle={() => {}}
            >
              <CombinedTextEditor lines={containerLines} onCommit={onContainerTextChange} />
            </SettingsPanel>
          )}
          {isButtonLike && (
            <SettingsPanel
              title={selection.tag === 'a' ? 'Link Button Container' : 'Button Container'} isOpen
              onToggle={() => {}}
            >
              <YcodeButton
                size="sm" variant="secondary"
                className="w-full"
                onClick={normalizeButtonContainer}
              >
                Make editable container
              </YcodeButton>
            </SettingsPanel>
          )}
          <SettingsPanel
            title="Link" isOpen
            onToggle={() => {}}
          >
            <YcodeSettingsRow label="Link to">
              <HtmlSettingsSelectControl
                label="Link to"
                kind="link"
                value={linkType}
                onChange={value => setLinkType(value as LinkApplyRequest['type'])}
                allowUnset={false}
                options={[
                  { value: 'none', label: 'No link' },
                  { value: 'page', label: 'Page' },
                  { value: 'asset', label: 'Asset' },
                  { value: 'url', label: 'URL' },
                  { value: 'email', label: 'Email' },
                  { value: 'phone', label: 'Phone' },
                  { value: 'section', label: 'Section on this page' },
                ]}
              />
            </YcodeSettingsRow>
            {linkType === 'url' && (
              <YcodeSettingsRow label={<div className="flex items-center gap-1">{componentVariableLabel('URL', ['link'], 'href', linkUrl)}{cmsFieldBindingAction('href', 'link')}</div>}>
                {componentVariableLinkedValue(['link'], 'href') || <HtmlSettingsTextControl
                  label="URL"
                  kind="link"
                  value={linkUrl}
                  onChange={setLinkUrl}
                  placeholder="https://example.com"
                />}
              </YcodeSettingsRow>
            )}
            {linkType === 'page' && (
              <>
                <YcodeSettingsRow label="Page">
                  <HtmlSettingsSelectControl
                    label="Page"
                    kind="link"
                    value={linkPage}
                    onChange={setLinkPage}
                    placeholder="Select page"
                    options={linkPages.map(page => ({ value: page.path, label: page.label, authoredLabel: true }))}
                  />
                </YcodeSettingsRow>
                <YcodeSettingsRow label="Section">
                  <HtmlSettingsSelectControl
                    label="Section"
                    kind="link"
                    value={linkSection}
                    onChange={setLinkSection}
                    placeholder="No anchor"
                    options={(selectedLinkPage?.sections || []).map(section => ({ value: section.id, label: `#${section.id} · ${section.label}`, authoredLabel: true }))}
                  />
                </YcodeSettingsRow>
              </>
            )}
            {linkType === 'asset' && (
              <YcodeSettingsRow label="Asset">
                <HtmlSettingsSelectControl
                  label="Asset"
                  kind="image"
                  value={linkAsset}
                  onChange={setLinkAsset}
                  placeholder="Select asset"
                  options={mediaAssets.map(asset => ({ value: asset.path, label: asset.path }))}
                />
              </YcodeSettingsRow>
            )}
            {linkType === 'email' && (
              <>
                <YcodeSettingsRow label="Email"><HtmlSettingsTextControl label="Email" kind="link" value={linkEmail} onChange={setLinkEmail} placeholder="name@example.com" /></YcodeSettingsRow>
                <YcodeSettingsRow label="Subject"><HtmlSettingsTextControl label="Subject" value={linkSubject} onChange={setLinkSubject} /></YcodeSettingsRow>
                <YcodeSettingsRow label="Message"><HtmlSettingsTextControl label="Message" value={linkMessage} onChange={setLinkMessage} multiline /></YcodeSettingsRow>
              </>
            )}
            {linkType === 'phone' && (
              <YcodeSettingsRow label="Phone"><HtmlSettingsTextControl label="Phone" kind="link" value={linkPhone} onChange={setLinkPhone} placeholder="+1 555 000 0000" /></YcodeSettingsRow>
            )}
            {linkType === 'section' && (
              <YcodeSettingsRow label="Section">
                <HtmlSettingsSelectControl
                  label="Section"
                  kind="link"
                  value={linkSection}
                  onChange={setLinkSection}
                  placeholder="Select section"
                  options={(linkPages.find(page => page.path === currentPage)?.sections || []).map(section => ({ value: section.id, label: `#${section.id} · ${section.label}`, authoredLabel: true }))}
                />
              </YcodeSettingsRow>
            )}
            {linkType !== 'none' && (
              <div className="grid grid-cols-3 items-start gap-2">
                <YcodeLabel variant="muted" className="pt-0.5">Behavior</YcodeLabel>
                <div className="col-span-2 grid gap-1.5">
                  <HtmlSettingsToggleControl label="New tab" kind="link" checked={linkNewTab} onChange={setLinkNewTab} />
                  <HtmlSettingsToggleControl label="Download" kind="link" checked={linkDownload} onChange={setLinkDownload} />
                  <HtmlSettingsToggleControl label="Nofollow" kind="link" checked={linkNoFollow} onChange={setLinkNoFollow} />
                  <HtmlSettingsToggleControl label="Native style" kind="link" checked={linkNativeStyle} onChange={setLinkNativeStyle} />
                </div>
              </div>
            )}
            <YcodeButton
              size="sm" variant={linkType === 'none' ? 'secondary' : 'default'} className="w-full"
              disabled={selection.tag === 'body' || (linkType === 'url' ? !linkUrl.trim() : linkType === 'page' ? !linkPage : linkType === 'asset' ? !linkAsset : linkType === 'email' ? !linkEmail.trim() : linkType === 'phone' ? !linkPhone.trim() : linkType === 'section' ? !linkSection : false)}
              onClick={() => {
                if (cmsBindingFor('href')) void saveCmsProperty('href', linkUrl.trim());
                else onLinkApply({ type: linkType, url: linkUrl.trim(), page: linkPage, section: linkSection, asset: linkAsset, email: linkEmail.trim(), subject: linkSubject, message: linkMessage, phone: linkPhone.trim(), newTab: linkNewTab, download: linkDownload, noFollow: linkNoFollow, useNativeStyle: linkNativeStyle });
              }}
            >
              {cmsBindingFor('href') ? <Save className="mr-2 size-3.5" /> : <Link2 className="mr-2 size-3.5" />}
              {cmsBindingFor('href') ? (cmsSavingTarget === 'href' ? 'Saving…' : 'Save link') : linkType === 'none' ? 'Remove link' : isLink ? 'Update link' : 'Add link'}
            </YcodeButton>
          </SettingsPanel>
          {isTabs && tabsModel && (
            <SettingsPanel
              title="Tabs" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                Accessible tabs component. Edit labels, panels, orientation and the active tab without changing the HTML manually.
              </p>
              <YcodeSettingsRow label="Active tab">
                <HtmlSettingsSelectControl
                  label="Active tab"
                  kind="option"
                  value={String(tabsModel.active)}
                  onChange={value => commitTabsModel({ ...tabsModel, active: Number(value) || 0 })}
                  allowUnset={false}
                  options={tabsModel.items.map((item, index) => ({
                    value: String(index),
                    label: `${index + 1}. ${item.label}`,
                    authoredLabel: true,
                  }))}
                />
              </YcodeSettingsRow>
              <AttributeSelectRow
                label="Direction"
                value={tabsModel.orientation}
                onChange={value => commitTabsModel({ ...tabsModel, orientation: value === 'vertical' ? 'vertical' : 'horizontal' })}
                options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]}
              />
              <AttributeSelectRow
                label="Activation"
                value={tabsModel.activation}
                onChange={value => commitTabsModel({ ...tabsModel, activation: value === 'manual' ? 'manual' : 'auto' })}
                options={[{ value: 'auto', label: 'Auto on focus' }, { value: 'manual', label: 'Manual click' }]}
              />
              <div className="space-y-2">
                {tabsModel.items.map((item, index) => (
                  <div
                    key={`${item.id}:${index}`}
                    className={cn(
                      'space-y-2 border-b border-border/55 py-2.5 last:border-b-0',
                      index === tabsModel.active && 'border-l-2 border-l-[var(--kodety-accent-hover)] pl-2',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">Tab {index + 1}</span>
                      <div className="flex items-center gap-1">
                        <YcodeButton
                          size="xs" variant={index === tabsModel.active ? 'secondary' : 'ghost'}
                          onClick={() => commitTabsModel({ ...tabsModel, active: index })}
                        >Active</YcodeButton>
                        <YcodeButton
                          size="xs" variant="ghost"
                          onClick={() => {
                            const clone = {
                              ...item,
                              id: `${tabsSlug(item.label, index)}-copy`,
                              label: `${item.label} copy`,
                            };
                            commitTabsModel({
                              ...tabsModel,
                              items: [...tabsModel.items.slice(0, index + 1), clone, ...tabsModel.items.slice(index + 1)],
                            });
                          }}
                        >Duplicate</YcodeButton>
                        <YcodeButton
                          size="icon-xs" variant="ghost"
                          disabled={tabsModel.items.length <= 1}
                          title="Remove tab"
                          onClick={() => {
                            const items = tabsModel.items.filter((_, itemIndex) => itemIndex !== index);
                            commitTabsModel({
                              ...tabsModel,
                              active: Math.min(tabsModel.active, items.length - 1),
                              items,
                            });
                          }}
                        ><Trash2 className="size-3.5" /></YcodeButton>
                      </div>
                    </div>
                    <FieldRow
                      label="Label"
                      value={item.label}
                      onCommit={value => commitTabsModel({
                        ...tabsModel,
                        items: tabsModel.items.map((nextItem, itemIndex) => itemIndex === index ? { ...nextItem, label: value || `Tab ${index + 1}` } : nextItem),
                      })}
                    />
                    <FieldRow
                      label="Panel"
                      value={item.content}
                      multiline
                      onCommit={value => commitTabsModel({
                        ...tabsModel,
                        items: tabsModel.items.map((nextItem, itemIndex) => itemIndex === index ? { ...nextItem, content: value || `<p>${escapeHtml(nextItem.label)} content</p>` } : nextItem),
                      })}
                    />
                  </div>
                ))}
              </div>
              <div className="border-t border-border/55 pt-2">
                <div className="flex items-center gap-2">
                  <HtmlSettingsTextControl
                    value={newTabLabel}
                    label="New tab"
                    kind="text"
                    onChange={setNewTabLabel}
                    placeholder="New tab"
                    className="flex-1"
                  />
                  <YcodeButton
                    size="sm"
                    disabled={!newTabLabel.trim()}
                    onClick={() => {
                      const label = newTabLabel.trim();
                      commitTabsModel({
                        ...tabsModel,
                        active: tabsModel.items.length,
                        items: [...tabsModel.items, {
                          id: tabsSlug(label, tabsModel.items.length),
                          label,
                          content: `<p>${escapeHtml(label)} content</p>`,
                        }],
                      });
                      setNewTabLabel('');
                    }}
                  ><Plus className="mr-1 size-3.5" />Add</YcodeButton>
                </div>
              </div>
            </SettingsPanel>
          )}
          {pictureModel && (
            <SettingsPanel
              title="Picture" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">Imagem responsiva com sources por breakpoint e fallback.</p>
              <FieldRow
                label="Mobile"
                value={pictureModel.mobile}
                onCommit={value => commitPictureModel({ ...pictureModel, mobile: value })}
              />
              <FieldRow
                label="Desktop"
                value={pictureModel.desktop}
                onCommit={value => commitPictureModel({ ...pictureModel, desktop: value })}
              />
              <FieldRow
                label="Fallback"
                value={pictureModel.src}
                onCommit={value => commitPictureModel({ ...pictureModel, src: value })}
              />
              <FieldRow
                label="Alt"
                value={pictureModel.alt}
                onCommit={value => commitPictureModel({ ...pictureModel, alt: value })}
              />
              <AttributeSelectRow
                label="Loading"
                value={pictureModel.loading}
                onChange={value => commitPictureModel({ ...pictureModel, loading: value })}
                options={[{ value: 'lazy', label: 'Lazy' }, { value: 'eager', label: 'Eager' }]}
              />
            </SettingsPanel>
          )}
          {lightboxModel && (
            <SettingsPanel
              title="Lightbox" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">Opens a real overlay and closes through its backdrop, close button or Escape.</p>
              <FieldRow
                label="Large image"
                value={lightboxModel.href}
                onCommit={value => commitLightboxModel({ ...lightboxModel, href: value })}
              />
              <FieldRow
                label="Thumbnail"
                value={lightboxModel.src}
                onCommit={value => commitLightboxModel({ ...lightboxModel, src: value })}
              />
              <FieldRow
                label="Alt"
                value={lightboxModel.alt}
                onCommit={value => commitLightboxModel({ ...lightboxModel, alt: value })}
              />
            </SettingsPanel>
          )}
          {isOverlayComponent && selection && (
            <SettingsPanel
              title={componentType === 'checkout-overlay' ? 'Checkout Overlay' : 'Overlay'} isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">Select Overlay, Surface, Backdrop or inner content in Layers to edit each part. The Surface is revealed in the canvas while its tree is selected.</p>
              <AttributeSelectRow
                label="Behavior"
                value={selection.attributes['data-kodety-overlay'] || 'modal'}
                onChange={value => {
                  const behavior = value || 'modal';
                  onAttributesChange({
                    'data-kodety-overlay': behavior,
                    // Retire the legacy page-load state whenever this component
                    // is touched. Every overlay now opens only via interaction.
                    'data-kodety-overlay-default-open': '',
                  });
                }}
                options={[
                  { value: 'modal', label: 'Modal' },
                  { value: 'drawer', label: 'Drawer' },
                  { value: 'popover', label: 'Popover' },
                  { value: 'menu', label: 'Compact menu' },
                  { value: 'tooltip', label: 'Tooltip' },
                  { value: 'checkout', label: 'Checkout' },
                ]}
              />
              <AttributeSelectRow
                label="Position"
                value={selection.attributes['data-kodety-overlay-mode'] || (['popover', 'tooltip', 'menu'].includes(selection.attributes['data-kodety-overlay'] || '') ? 'anchored' : 'fixed')}
                onChange={value => onAttributeChange('data-kodety-overlay-mode', value)}
                options={[{ value: 'fixed', label: 'Fixed viewport' }, { value: 'anchored', label: 'Relative to trigger' }]}
              />
              <AttributeSelectRow
                label="Placement"
                value={selection.attributes['data-kodety-overlay-placement'] || ''}
                placeholder="Automatic"
                onChange={value => onAttributeChange('data-kodety-overlay-placement', value)}
                options={[
                  { value: 'top-start', label: 'Top start' }, { value: 'top', label: 'Top center' }, { value: 'top-end', label: 'Top end' },
                  { value: 'right', label: 'Right' },
                  { value: 'bottom-start', label: 'Bottom start' }, { value: 'bottom', label: 'Bottom center' }, { value: 'bottom-end', label: 'Bottom end' },
                  { value: 'left', label: 'Left' },
                ]}
              />
              <BooleanAttributeRow
                label="Modal semantics"
                description="Keep focus inside the surface."
                checked={selection.attributes['data-kodety-overlay-modal'] === 'true' || ['modal', 'drawer', 'checkout', 'cart'].includes(selection.attributes['data-kodety-overlay'] || '')}
                onChange={checked => onAttributeChange('data-kodety-overlay-modal', checked ? 'true' : 'false')}
              />
              <BooleanAttributeRow
                label="Close with Escape"
                alignSwitchEnd
                checked={selection.attributes['data-kodety-overlay-close-escape'] !== 'false'}
                onChange={checked => onAttributeChange('data-kodety-overlay-close-escape', checked ? 'true' : 'false')}
              />
              <BooleanAttributeRow
                label="Close outside"
                alignSwitchEnd
                checked={selection.attributes['data-kodety-overlay-close-outside'] !== 'false'}
                onChange={checked => onAttributeChange('data-kodety-overlay-close-outside', checked ? 'true' : 'false')}
              />
              <BooleanAttributeRow
                label="Lock page scroll"
                alignSwitchEnd
                checked={selection.attributes['data-kodety-overlay-lock-scroll'] !== 'false'}
                onChange={checked => onAttributeChange('data-kodety-overlay-lock-scroll', checked ? 'true' : 'false')}
              />
            </SettingsPanel>
          )}
          {dropdownModel && (
            <SettingsPanel
              title="Dropdown" isOpen
              onToggle={() => {}}
            >
              <FieldRow
                label="Label"
                value={dropdownModel.label}
                onCommit={value => commitDropdownModel({ ...dropdownModel, label: value })}
              />
              <BooleanAttributeRow
                label="Open by default"
                checked={dropdownModel.open}
                onChange={checked => commitDropdownModel({ ...dropdownModel, open: checked })}
              />
              <div className="space-y-2">
                {dropdownModel.items.map((item, index) => (
                  <div key={`${item.label}:${index}`} className="space-y-2 border-b border-border/55 py-2.5 last:border-b-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Option {index + 1}</span>
                      <YcodeButton
                        size="icon-xs" variant="ghost"
                        disabled={dropdownModel.items.length <= 1}
                        aria-label={`Remove option ${index + 1}`}
                        onClick={() => commitDropdownModel({ ...dropdownModel, items: dropdownModel.items.filter((_, itemIndex) => itemIndex !== index) })}
                      ><Trash2 className="size-3.5" /></YcodeButton>
                    </div>
                    <FieldRow
                      label="Text"
                      value={item.label}
                      onCommit={value => commitDropdownModel({
                        ...dropdownModel,
                        items: dropdownModel.items.map((nextItem, itemIndex) => itemIndex === index ? { ...nextItem, label: value } : nextItem),
                      })}
                    />
                    <FieldRow
                      label="Href"
                      value={item.href}
                      onCommit={value => commitDropdownModel({
                        ...dropdownModel,
                        items: dropdownModel.items.map((nextItem, itemIndex) => itemIndex === index ? { ...nextItem, href: value } : nextItem),
                      })}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <HtmlSettingsTextControl
                  value={newComponentItemLabel}
                  label="New option"
                  kind="option"
                  onChange={setNewComponentItemLabel}
                  placeholder="New option"
                  className="flex-1"
                />
                <YcodeButton
                  size="sm"
                  disabled={!newComponentItemLabel.trim()}
                  onClick={() => {
                    commitDropdownModel({ ...dropdownModel, items: [...dropdownModel.items, { label: newComponentItemLabel.trim(), href: '#' }] });
                    setNewComponentItemLabel('');
                  }}
                ><Plus className="mr-1 size-3.5" />Add</YcodeButton>
              </div>
            </SettingsPanel>
          )}
          {navbarModel && (
            <SettingsPanel
              title="Navbar" isOpen
              onToggle={() => {}}
            >
              <FieldRow
                label="Brand"
                value={navbarModel.brand.label}
                onCommit={value => commitNavbarModel({ ...navbarModel, brand: { ...navbarModel.brand, label: value } })}
              />
              <FieldRow
                label="Brand URL"
                value={navbarModel.brand.href}
                onCommit={value => commitNavbarModel({ ...navbarModel, brand: { ...navbarModel.brand, href: value } })}
              />
              <div className="space-y-2">
                {navbarModel.items.map((item, index) => (
                  <div key={`${item.label}:${index}`} className="space-y-2 border-b border-border/55 py-2.5 last:border-b-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Link {index + 1}</span>
                      <YcodeButton
                        size="icon-xs" variant="ghost"
                        aria-label={`Remove link ${index + 1}`}
                        onClick={() => commitNavbarModel({ ...navbarModel, items: navbarModel.items.filter((_, itemIndex) => itemIndex !== index) })}
                      ><Trash2 className="size-3.5" /></YcodeButton>
                    </div>
                    <FieldRow
                      label="Text"
                      value={item.label}
                      onCommit={value => commitNavbarModel({
                        ...navbarModel,
                        items: navbarModel.items.map((nextItem, itemIndex) => itemIndex === index ? { ...nextItem, label: value } : nextItem),
                      })}
                    />
                    <FieldRow
                      label="Href"
                      value={item.href}
                      onCommit={value => commitNavbarModel({
                        ...navbarModel,
                        items: navbarModel.items.map((nextItem, itemIndex) => itemIndex === index ? { ...nextItem, href: value } : nextItem),
                      })}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <HtmlSettingsTextControl
                  value={newComponentItemLabel}
                  label="Novo link"
                  kind="link"
                  onChange={setNewComponentItemLabel}
                  placeholder="Novo link"
                  className="flex-1"
                />
                <YcodeButton
                  size="sm"
                  disabled={!newComponentItemLabel.trim()}
                  onClick={() => {
                    commitNavbarModel({ ...navbarModel, items: [...navbarModel.items, { label: newComponentItemLabel.trim(), href: '#' }] });
                    setNewComponentItemLabel('');
                  }}
                ><Plus className="mr-1 size-3.5" />Add</YcodeButton>
              </div>
            </SettingsPanel>
          )}
          {sliderModel && (
            <SettingsPanel
              title="Slider" isOpen
              onToggle={() => {}}
            >
              <YcodeSettingsRow label="Active slide">
                <HtmlSettingsSelectControl
                  label="Active slide"
                  kind="option"
                  value={String(sliderModel.active)}
                  onChange={value => commitSliderModel({ ...sliderModel, active: Number(value) || 0 })}
                  allowUnset={false}
                  options={sliderModel.slides.map((_, index) => ({ value: String(index), label: `Slide ${index + 1}` }))}
                />
              </YcodeSettingsRow>
              <div className="space-y-2">
                {sliderModel.slides.map((slide, index) => (
                  <div key={index} className="space-y-2 border-b border-border/55 py-2.5 last:border-b-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Slide {index + 1}</span>
                      <div className="flex items-center gap-1">
                        <YcodeButton
                          size="xs" variant={index === sliderModel.active ? 'secondary' : 'ghost'}
                          onClick={() => commitSliderModel({ ...sliderModel, active: index })}
                        >Ativo</YcodeButton>
                        <YcodeButton
                          size="icon-xs" variant="ghost"
                          disabled={sliderModel.slides.length <= 1}
                          aria-label={`Remove slide ${index + 1}`}
                          onClick={() => {
                            const slides = sliderModel.slides.filter((_, slideIndex) => slideIndex !== index);
                            commitSliderModel({ ...sliderModel, active: Math.min(sliderModel.active, slides.length - 1), slides });
                          }}
                        ><Trash2 className="size-3.5" /></YcodeButton>
                      </div>
                    </div>
                    <FieldRow
                      label="HTML"
                      value={slide}
                      multiline
                      onCommit={value => commitSliderModel({
                        ...sliderModel,
                        slides: sliderModel.slides.map((nextSlide, slideIndex) => slideIndex === index ? value : nextSlide),
                      })}
                    />
                  </div>
                ))}
              </div>
              <YcodeButton
                size="sm" variant="secondary"
                className="w-full"
                onClick={() => commitSliderModel({
                  ...sliderModel,
                  active: sliderModel.slides.length,
                  slides: [...sliderModel.slides, `<div><h2>Slide ${sliderModel.slides.length + 1}</h2><p>Slide content</p></div>`],
                })}
              ><Plus className="mr-1 size-3.5" />Add slide</YcodeButton>
            </SettingsPanel>
          )}
          {componentType === 'locales-list' && (
            <SettingsPanel
              title="Language Selector" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                Items stay synchronized with the active project languages. Without translations, the selector only shows the source language.
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Select the trigger, icon, label or an option on the canvas to style each part.
              </p>
            </SettingsPanel>
          )}
          {codeBlockModel && (
            <SettingsPanel
              title="Code Block" isOpen
              onToggle={() => {}}
            >
              <AttributeSelectRow
                label="Language"
                value={codeBlockModel.language}
                onChange={value => commitCodeBlockModel({ ...codeBlockModel, language: value })}
                options={['html', 'css', 'javascript', 'typescript', 'json', 'bash', 'plain'].map(value => ({ value, label: value }))}
              />
              <FieldRow
                label="Code"
                value={codeBlockModel.code}
                multiline
                onCommit={value => commitCodeBlockModel({ ...codeBlockModel, code: value })}
              />
            </SettingsPanel>
          )}
          {selection.tag === 'select' && (
            <SettingsPanel
              title="Select" isOpen
              onToggle={() => {}}
            >
              <SelectOptionsEditor options={selectOptions} onChange={commitSelectOptions} />
            </SettingsPanel>
          )}
          {choiceModel && (
            <SettingsPanel
              title={componentType === 'radio' ? 'Radio Button' : 'Checkbox'} isOpen
              onToggle={() => {}}
            >
              <FieldRow
                label="Label" value={choiceModel.label}
                onCommit={label => commitChoiceModel({ ...choiceModel, label })}
              />
              <FieldRow
                label="Name" value={choiceModel.name}
                onCommit={name => commitChoiceModel({ ...choiceModel, name })}
              />
              <FieldRow
                label="Value" value={choiceModel.value}
                onCommit={value => commitChoiceModel({ ...choiceModel, value })}
              />
              <BooleanAttributeRow
                label="Checked" checked={choiceModel.checked}
                onChange={checked => commitChoiceModel({ ...choiceModel, checked })}
              />
              <BooleanAttributeRow
                label="Required" checked={choiceModel.required}
                onChange={required => commitChoiceModel({ ...choiceModel, required })}
              />
              <BooleanAttributeRow
                label="Disabled" checked={choiceModel.disabled}
                onChange={disabled => commitChoiceModel({ ...choiceModel, disabled })}
              />
            </SettingsPanel>
          )}
          {searchModel && (
            <SettingsPanel
              title="Search" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">Configure a busca como um componente, mantendo input e botão editáveis separadamente nas Layers.</p>
              <FieldRow
                label="Action" value={searchModel.action}
                onCommit={action => commitSearchModel({ ...searchModel, action })}
              />
              <AttributeSelectRow
                label="Method" value={searchModel.method}
                onChange={method => commitSearchModel({ ...searchModel, method: method || 'get' })}
                options={[{ value: 'get', label: 'GET' }, { value: 'post', label: 'POST' }]}
              />
              <FieldRow
                label="Query name" value={searchModel.queryName}
                onCommit={queryName => commitSearchModel({ ...searchModel, queryName })}
              />
              <FieldRow
                label="Placeholder" value={searchModel.placeholder}
                onCommit={placeholder => commitSearchModel({ ...searchModel, placeholder })}
              />
              <FieldRow
                label="Button" value={searchModel.buttonLabel}
                onCommit={buttonLabel => commitSearchModel({ ...searchModel, buttonLabel })}
              />
            </SettingsPanel>
          )}
          {componentType === 'label' && (
            <SettingsPanel
              title="Form Label" isOpen
              onToggle={() => {}}
            >
              <FieldRow
                label="Text" value={selection.text}
                onCommit={onTextChange}
              />
              <FieldRow
                label="For / input ID" value={selection.attributes.for || ''}
                onCommit={value => onAttributeChange('for', value)}
              />
            </SettingsPanel>
          )}
          {componentType === 'map' && (
            <SettingsPanel
              title="Map" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">Use an address or paste an embed URL from any provider.</p>
              <FieldRow
                label="Address" value={readUrlParam(selection.attributes.src || '', 'q')}
                onCommit={value => onAttributeChange('src', `https://www.google.com/maps?q=${encodeURIComponent(value)}&output=embed`)}
              />
              <FieldRow
                label="Embed URL" value={selection.attributes.src || ''}
                onCommit={value => onAttributeChange('src', value)}
              />
              <FieldRow
                label={isYouTube || isVimeo ? 'Label' : 'Title'} value={selection.attributes.title || ''}
                onCommit={value => onAttributeChange('title', value)}
              />
              <AttributeSelectRow
                label="Loading" value={selection.attributes.loading || 'lazy'}
                onChange={value => onAttributeChange('loading', value || 'lazy')}
                options={[{ value: 'lazy', label: 'Lazy' }, { value: 'eager', label: 'Eager' }]}
              />
            </SettingsPanel>
          )}
          {componentType === 'social-link' && (
            <SettingsPanel
              title={/facebook/i.test(selection.attributes.href || '') ? 'Facebook Link' : 'X / Social Link'} isOpen
              onToggle={() => {}}
            >
              <FieldRow
                label="Profile URL" value={selection.attributes.href || ''}
                onCommit={value => onAttributeChange('href', value)}
              />
              <FieldRow
                label="Accessible label" value={selection.attributes['aria-label'] || selection.text}
                onCommit={value => onAttributeChange('aria-label', value)}
              />
              <BooleanAttributeRow
                label="New tab" checked={selection.attributes.target === '_blank'}
                onChange={checked => { onAttributeChange('target', checked ? '_blank' : ''); onAttributeChange('rel', checked ? 'noopener noreferrer' : ''); }}
              />
            </SettingsPanel>
          )}
          {componentType === 'custom-element' && (
            <SettingsPanel
              title="Custom Element" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">Change the tag without losing attributes and edit the inner content as HTML.</p>
              <FieldRow
                label="Tag" value={selection.tag}
                onCommit={value => onChangeTag(value.trim().toLowerCase() || 'div')}
              />
              <FieldRow
                label="Inner HTML" multiline
                value={(() => {
                  if (typeof DOMParser === 'undefined') return '';
                  const doc = new DOMParser().parseFromString(selectedOuterHtml, 'text/html');
                  return doc.body.firstElementChild?.innerHTML || '';
                })()}
                onCommit={value => mutateSelectedMarkup(root => { root.innerHTML = value; })}
              />
            </SettingsPanel>
          )}
          {isMedia && (
            <SettingsPanel
              title={isImage ? 'Image' : isVideo ? (componentType === 'background-video' ? 'Background Video' : 'Video') : 'Audio'} isOpen
              onToggle={() => {}}
            >
              <div className="overflow-hidden rounded-lg border border-border/70 bg-black/20">
                {currentMediaAsset ? <AssetPreview file={currentMediaAsset} tag={selection.tag as 'img' | 'video' | 'audio'} /> : (
                  <div className="flex h-28 flex-col items-center justify-center gap-2 text-muted-foreground">
                    {isImage ? <ImageIcon className="size-6" /> : <Play className="size-6" />}
                    <span className="max-w-[90%] truncate text-xs" data-kodety-no-i18n={selection.attributes.src ? true : undefined}>{selection.attributes.src || 'No media selected'}</span>
                  </div>
                )}
              </div>
              <MediaSourceRow
                value={cmsValueFor('src', selection.attributes.src || '')}
                assets={compatibleMediaAssets}
                currentAssetPath={currentMediaAssetPath}
                label={componentVariableLabel(
                  'Source',
                  [isImage ? 'image' : isVideo ? 'video' : 'audio'],
                  'src',
                  selection.attributes.src || '',
                )}
                replacement={componentVariableLinkedValue(
                  [isImage ? 'image' : isVideo ? 'video' : 'audio'],
                  'src',
                )}
                onAssetSelect={onMediaAssetSelect}
                onCommit={value => {
                  if (cmsBindingFor('src')) void saveCmsProperty('src', value);
                  else onMediaSourceChange(value);
                }}
                onUpload={file => {
                  if (cmsAvailable && cmsMediaSourceBinding) return uploadCmsPropertyImage(file);
                  return onMediaUpload(file);
                }}
                accept={isImage ? 'image/*' : isVideo ? 'video/*' : 'audio/*'}
                action={cmsFieldBindingAction('src', 'image')}
                connected={Boolean(cmsBindingFor('src'))}
                saving={cmsSavingTarget === 'src'}
                uploading={cmsImageUploading}
              />
              {!isAudio && (
                <>
                  <YcodeSettingsRow label="Fit">
                    <div
                      data-media-fit-control
                      className="grid h-8 min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] rounded-lg bg-input p-1"
                    >
                      {([['contain', 'Fit'], ['cover', 'Fill'], ['fill', 'Stretch']] as const).map(([value, label]) => (
                        <YcodeButton
                          key={value} size="xs"
                          className="min-w-0 w-full px-1"
                          variant={(styleValues['object-fit'] || 'contain') === value ? 'secondary' : 'ghost'} onClick={() => onVisualStyleChange('object-fit', value)}
                        >
                          {/* Keep the compact media-fit labels in English in both editor hosts. */}
                          <span data-kodety-no-i18n translate="no" lang="en">{label}</span>
                        </YcodeButton>
                      ))}
                    </div>
                  </YcodeSettingsRow>
                  <div className="space-y-2 border-t border-border/55 pt-2.5">
                    <div className="flex items-center justify-between">
                      <YcodeLabel variant="muted">Focus point</YcodeLabel>
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{Math.round(mediaFocus[0])} · {Math.round(mediaFocus[1])}</span>
                    </div>
                    <button
                      type="button"
                      data-media-focus-control
                      className="group relative h-24 w-full touch-none cursor-crosshair overflow-hidden rounded-xl border border-border/70 bg-secondary/45 shadow-inner outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
                      onPointerDown={handleMediaFocusPointerDown}
                      onPointerMove={handleMediaFocusPointerMove}
                      onPointerUp={handleMediaFocusPointerUp}
                      onPointerCancel={handleMediaFocusPointerCancel}
                      onKeyDown={handleMediaFocusKeyDown}
                      aria-label={`Selecionar ponto de foco, X ${Math.round(mediaFocus[0])}, Y ${Math.round(mediaFocus[1])}`}
                    >
                      <span
                        className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-white/20"
                        style={{ left: `${mediaFocus[0]}%` }}
                      />
                      <span
                        className="pointer-events-none absolute inset-x-0 h-px -translate-y-1/2 bg-white/20"
                        style={{ top: `${mediaFocus[1]}%` }}
                      />
                      <span
                        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-background shadow-[0_1px_6px_rgba(0,0,0,.55)] transition-transform group-hover:scale-110"
                        style={{ left: `${mediaFocus[0]}%`, top: `${mediaFocus[1]}%` }}
                      />
                    </button>
                    <YcodeSlider label="X"
                      value={[mediaFocus[0]]} min={0}
                      max={100} step={1} unit="%"
                      onValueChange={([x]) => applyMediaFocus([x, mediaFocus[1]])}
                    />
                    <YcodeSlider label="Y"
                      value={[mediaFocus[1]]} min={0}
                      max={100} step={1} unit="%"
                      onValueChange={([y]) => applyMediaFocus([mediaFocus[0], y])}
                    />
                  </div>
                </>
              )}
              {isImage && (
                <>
                  <FieldRow
                    label={componentVariableLabel('Alt', ['text'], 'alt', selection.attributes.alt || '')}
                    ariaLabel="Alt"
                    value={cmsValueFor('alt', selection.attributes.alt || '')}
                    replacement={componentVariableLinkedValue(['text'], 'alt')}
                    onCommit={value => {
                      if (cmsBindingFor('alt')) void saveCmsProperty('alt', value);
                      else onAttributeChange('alt', value);
                    }}
                    action={cmsFieldBindingAction('alt', 'text')}
                    connected={Boolean(cmsBindingFor('alt'))}
                    saving={cmsSavingTarget === 'alt'}
                  />
                  <FieldRow
                    label="Srcset" value={selection.attributes.srcset || ''}
                    onCommit={value => onAttributeChange('srcset', value)} multiline
                  />
                  <FieldRow
                    label="Sizes" value={selection.attributes.sizes || ''}
                    onCommit={value => onAttributeChange('sizes', value)}
                  />
                  <FieldRow
                    label={componentVariableLabel('Width', ['number'], 'width', selection.attributes.width || '')}
                    ariaLabel="Width" value={selection.attributes.width || ''}
                    replacement={componentVariableLinkedValue(['number'], 'width')}
                    onCommit={value => onAttributeChange('width', value)}
                  />
                  <FieldRow
                    label={componentVariableLabel('Height', ['number'], 'height', selection.attributes.height || '')}
                    ariaLabel="Height" value={selection.attributes.height || ''}
                    replacement={componentVariableLinkedValue(['number'], 'height')}
                    onCommit={value => onAttributeChange('height', value)}
                  />
                  <AttributeSelectRow
                    label="Loading" value={selection.attributes.loading || ''}
                    onChange={value => onAttributeChange('loading', value)}
                    options={[{ value: 'lazy', label: 'Lazy' }, { value: 'eager', label: 'Eager' }]}
                  />
                  <AttributeSelectRow
                    label="Decoding" value={selection.attributes.decoding || ''}
                    onChange={value => onAttributeChange('decoding', value)}
                    options={[{ value: 'async', label: 'Async' }, { value: 'sync', label: 'Sync' }, { value: 'auto', label: 'Auto' }]}
                  />
                  <AttributeSelectRow
                    label="Priority" value={selection.attributes.fetchpriority || ''}
                    onChange={value => onAttributeChange('fetchpriority', value)}
                    options={[{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }, { value: 'auto', label: 'Auto' }]}
                  />
                </>
              )}
              {isVideo && (
                <>
                  <FieldRow
                    label={componentVariableLabel('Poster', ['image'], 'poster', selection.attributes.poster || '')}
                    ariaLabel="Poster"
                    value={selection.attributes.poster || ''}
                    replacement={componentVariableLinkedValue(['image'], 'poster')}
                    onCommit={value => {
                      onAttributeChange('poster', value);
                    }}
                  />
                  {([['controls', 'Controls'], ['autoplay', 'Autoplay'], ['loop', 'Loop'], ['muted', 'Muted'], ['playsinline', 'Inline on mobile']] as const).map(([attribute, label]) => (
                    <BooleanAttributeRow
                      key={attribute}
                      label={label}
                      checked={attribute in selection.attributes}
                      onChange={checked => onAttributeChange(attribute, checked ? attribute : '')}
                    />
                  ))}
                  <AttributeSelectRow
                    label="Preload" value={selection.attributes.preload || ''}
                    onChange={value => onAttributeChange('preload', value)}
                    options={[{ value: 'none', label: 'None' }, { value: 'metadata', label: 'Metadata' }, { value: 'auto', label: 'Auto' }]}
                  />
                  <FieldRow
                    label={componentVariableLabel('Width', ['number'], 'width', selection.attributes.width || '')}
                    ariaLabel="Width" value={selection.attributes.width || ''}
                    replacement={componentVariableLinkedValue(['number'], 'width')}
                    onCommit={value => onAttributeChange('width', value)}
                  />
                  <FieldRow
                    label={componentVariableLabel('Height', ['number'], 'height', selection.attributes.height || '')}
                    ariaLabel="Height" value={selection.attributes.height || ''}
                    replacement={componentVariableLinkedValue(['number'], 'height')}
                    onCommit={value => onAttributeChange('height', value)}
                  />
                </>
              )}
              {isAudio && (
                <>
                  {([['controls', 'Controls'], ['autoplay', 'Autoplay'], ['loop', 'Loop'], ['muted', 'Muted']] as const).map(([attribute, label]) => (
                    <BooleanAttributeRow
                      key={attribute} label={label}
                      checked={attribute in selection.attributes}
                      onChange={checked => onAttributeChange(attribute, checked ? attribute : '')}
                    />
                  ))}
                  <AttributeSelectRow
                    label="Preload" value={selection.attributes.preload || ''}
                    onChange={value => onAttributeChange('preload', value)}
                    options={[{ value: 'none', label: 'None' }, { value: 'metadata', label: 'Metadata' }, { value: 'auto', label: 'Auto' }]}
                  />
                  <AttributeSelectRow
                    label="Cross origin" value={selection.attributes.crossorigin || ''}
                    onChange={value => onAttributeChange('crossorigin', value)}
                    options={[{ value: 'anonymous', label: 'Anonymous' }, { value: 'use-credentials', label: 'Use credentials' }]}
                  />
                </>
              )}
            </SettingsPanel>
          )}
          {isIframe && (
            <SettingsPanel
              title={isYouTube ? 'YouTube' : isVimeo ? 'Vimeo' : componentType === 'map' ? 'Map' : componentType === 'spline' ? 'Spline' : componentType === 'code-embed' ? 'Code Embed' : 'Embed'} isOpen
              onToggle={() => {}}
            >
              {isYouTube ? (
                <>
                  <FieldRow
                    label="Video"
                    value={youtubeControlValue(selection.attributes.src || '')}
                    onCommit={value => onAttributeChange('src', updateYouTubeVideo(selection.attributes.src || '', value))}
                  />
                  <div className="pt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">Playback</div>
                  {([['autoplay', 'Autoplay'], ['mute', 'Muted'], ['controls', 'Controls'], ['rel', 'Related']] as const).map(([parameter, label]) => {
                    const current = readUrlParam(selection.attributes.src || '', parameter);
                    const defaultEnabled = parameter === 'controls' || parameter === 'rel';
                    return <BooleanAttributeRow
                      key={parameter}
                      label={label}
                      checked={current ? current !== '0' : defaultEnabled}
                      onChange={checked => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', parameter, checked ? '1' : '0'))}
                    />;
                  })}
                  <BooleanAttributeRow
                    label="Loop"
                    checked={readUrlParam(selection.attributes.src || '', 'loop') === '1'}
                    onChange={checked => onAttributeChange('src', patchYouTubeLoop(selection.attributes.src || '', checked))}
                  />
                  <div className="pt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">Player</div>
                  <AttributeSelectRow
                    label="Theme"
                    value={readUrlParam(selection.attributes.src || '', 'color') || 'red'}
                    onChange={value => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', 'color', value))}
                    options={[{ value: 'red', label: 'Red' }, { value: 'white', label: 'White' }]}
                  />
                  <BooleanAttributeRow
                    label="Privacy"
                    description="youtube-nocookie.com"
                    checked={(selection.attributes.src || '').includes('youtube-nocookie.com')}
                    onChange={checked => {
                      const src = selection.attributes.src || '';
                      onAttributeChange('src', checked ? src.replace('youtube.com', 'youtube-nocookie.com') : src.replace('youtube-nocookie.com', 'youtube.com'));
                    }}
                  />
                  <FieldRow
                    label="Start" value={readUrlParam(selection.attributes.src || '', 'start')}
                    onCommit={value => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', 'start', value))}
                  />
                  <FieldRow
                    label="End" value={readUrlParam(selection.attributes.src || '', 'end')}
                    onCommit={value => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', 'end', value))}
                  />
                </>
              ) : isVimeo ? (
                <>
                  <FieldRow
                    label="URL"
                    value={vimeoControlValue(selection.attributes.src || '')}
                    onCommit={value => onAttributeChange('src', updateVimeoVideo(selection.attributes.src || '', value))}
                  />
                  <div className="pt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">Playback</div>
                  {([['controls', 'Controls', true], ['autoplay', 'Autoplay', false], ['loop', 'Loop', false], ['muted', 'Muted', false], ['background', 'Background', false]] as const).map(([parameter, label, defaultEnabled]) => {
                    const current = readUrlParam(selection.attributes.src || '', parameter);
                    return <BooleanAttributeRow
                      key={parameter}
                      label={label}
                      checked={current ? current !== '0' : defaultEnabled}
                      onChange={checked => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', parameter, checked ? '1' : '0'))}
                    />;
                  })}
                  <div className="pt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">Player</div>
                  <FieldRow
                    label="Accent"
                    value={`#${readUrlParam(selection.attributes.src || '', 'color') || '00adef'}`}
                    onCommit={value => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', 'color', value.replace(/^#/, '')))}
                  />
                  {([['title', 'Title'], ['byline', 'Byline'], ['portrait', 'Portrait']] as const).map(([parameter, label]) => {
                    const current = readUrlParam(selection.attributes.src || '', parameter);
                    return <BooleanAttributeRow
                      key={parameter}
                      label={label}
                      checked={current ? current !== '0' : true}
                      onChange={checked => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', parameter, checked ? '1' : '0'))}
                    />;
                  })}
                  <BooleanAttributeRow
                    label="Privacy"
                    description="Do not track"
                    checked={readUrlParam(selection.attributes.src || '', 'dnt') === '1'}
                    onChange={checked => onAttributeChange('src', patchUrlParam(selection.attributes.src || '', 'dnt', checked ? '1' : '0'))}
                  />
                </>
              ) : (
                <FieldRow
                  label="Source" value={selection.attributes.src || ''}
                  onCommit={value => onAttributeChange('src', value)}
                />
              )}
              <FieldRow
                label="Title" value={selection.attributes.title || ''}
                onCommit={value => onAttributeChange('title', value)}
              />
              <AttributeSelectRow
                label="Loading"
                value={selection.attributes.loading || ''}
                onChange={value => onAttributeChange('loading', value)}
                options={[{ value: 'lazy', label: 'Lazy' }, { value: 'eager', label: 'Eager' }]}
              />
              {!isYouTube && !isVimeo && (
                <>
                  <FieldRow
                    label="Name" value={selection.attributes.name || ''}
                    onCommit={value => onAttributeChange('name', value)}
                  />
                  <AttributeSelectRow
                    label="Referrer"
                    value={selection.attributes.referrerpolicy || ''}
                    onChange={value => onAttributeChange('referrerpolicy', value)}
                    options={[
                      { value: 'no-referrer', label: 'No referrer' },
                      { value: 'origin', label: 'Origin' },
                      { value: 'strict-origin-when-cross-origin', label: 'Strict origin' },
                      { value: 'no-referrer-when-downgrade', label: 'Browser default' },
                    ]}
                  />
                  <FieldRow
                    label="Allow" value={selection.attributes.allow || ''}
                    onCommit={value => onAttributeChange('allow', value)}
                    multiline
                  />
                  <FieldRow
                    label="Sandbox" value={selection.attributes.sandbox || ''}
                    onCommit={value => onAttributeChange('sandbox', value)}
                    multiline
                  />
                  <BooleanAttributeRow
                    label="Fullscreen"
                    checked={'allowfullscreen' in selection.attributes}
                    onChange={checked => onAttributeChange('allowfullscreen', checked ? 'allowfullscreen' : '')}
                  />
                </>
              )}
              <YcodeSettingsRow label="Aspect">
                <div className="grid grid-cols-4 rounded-lg bg-input p-1">
                  {(['16 / 9', '4 / 3', '1 / 1', '9 / 16'] as const).map(value => (
                    <YcodeButton
                      key={value} size="xs"
                      variant={styleValues['aspect-ratio'] === value ? 'secondary' : 'ghost'}
                      onClick={() => onVisualStyleChange('aspect-ratio', value)}
                    >{value}</YcodeButton>
                  ))}
                </div>
              </YcodeSettingsRow>
            </SettingsPanel>
          )}
          {(isForm || isInput || isTextarea || isSelect || isButton) && (
            <SettingsPanel
              title={isForm ? (componentType === 'search' ? 'Search Form' : 'Form') : isInput ? (componentType === 'file-upload' ? 'File Upload' : 'Input') : isTextarea ? 'Text Area' : isSelect ? 'Select' : componentType === 'button' && selection.attributes.type === 'submit' ? 'Form Button' : 'Button'} isOpen
              onToggle={() => {}}
            >
              {isForm && (
                <div className="flex flex-col gap-4">
                  <FieldRow
                    label="Form name" value={selection.attributes['data-name'] || selection.attributes.name || ''}
                    onCommit={value => onAttributesChange({ 'data-name': value, name: value })}
                  />
                  {!isFilterForm && (
                    <>
                      <div className="rounded-lg bg-input px-3 py-2.5">
                        <p className="text-xs font-medium text-foreground">Kodety Emails</p>
                        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">Submissions are securely captured in the native Inbox, including files and CMS mappings.</p>
                      </div>
                      <BooleanAttributeRow
                        label="Capture submissions"
                        description="Disable only when another service owns this form."
                          checked={selection.attributes['data-kodety-capture'] !== 'false'}
                        onChange={checked => onAttributeChange('data-kodety-capture', checked ? '' : 'false')}
                      />
                      <div className="space-y-3 border-t border-border/60 pt-4">
                        <YcodeLabel>Multi-step</YcodeLabel>
                        <BooleanAttributeRow
                          label="Enable"
                          description="Create native navigation, validation and progress, showing one field group at a time."
                          checked={isMultiStepForm}
                          onChange={setMultiStepEnabled}
                        />
                        {isMultiStepForm && (
                          <div className="space-y-2.5 rounded-lg border border-border/60 bg-input/20 p-2.5">
                            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                              {Array.from({ length: formStepCount }, (_, index) => index + 1).map(step => (
                                <YcodeButton
                                  key={step}
                                  type="button"
                                  size="xs"
                                  variant={activeFormStep === step ? 'secondary' : 'ghost'}
                                  className="min-w-7 px-2 tabular-nums"
                                  onClick={() => setActiveFormStep(step)}
                                >
                                  {step}
                                </YcodeButton>
                              ))}
                              <YcodeButton type="button" size="icon-xs" variant="ghost" aria-label="Add step" onClick={addFormStep}>
                                <Plus />
                              </YcodeButton>
                              <YcodeButton
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Remove current step"
                                disabled={formStepCount <= 2}
                                onClick={removeActiveFormStep}
                              >
                                <Trash2 />
                              </YcodeButton>
                            </div>
                            <p className="text-xs leading-4 text-muted-foreground">
                              Step {activeFormStep} of {formStepCount}. Only this step is visible on the canvas.
                            </p>
                            <BooleanAttributeRow
                              label="Validate before next"
                              description="Required and pattern fields block progression."
                                checked={selection.attributes['data-kodety-step-validation'] !== 'false'}
                              onChange={checked => onAttributeChange('data-kodety-step-validation', checked ? 'true' : 'false')}
                            />
                            <div className="grid grid-cols-3 gap-1.5 border-t border-border/50 pt-2">
                              <YcodeButton type="button" size="xs" variant="secondary" className="min-w-0 px-1.5 text-[9px]" onClick={() => assignMultiStepRole('prev')}>
                                <Crosshair /> Back
                              </YcodeButton>
                              <YcodeButton type="button" size="xs" variant="secondary" className="min-w-0 px-1.5 text-[9px]" onClick={() => assignMultiStepRole('next')}>
                                <Crosshair /> Next
                              </YcodeButton>
                              <YcodeButton type="button" size="xs" variant="secondary" className="min-w-0 px-1.5 text-[9px]" onClick={() => assignMultiStepRole('progress')}>
                                <Crosshair /> Progress
                              </YcodeButton>
                            </div>
                            <p className="text-xs leading-4 text-muted-foreground">Choose an action, then click the desired element directly on the canvas.</p>
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 border-t border-border/60 pt-4">
                        <YcodeLabel>After submission</YcodeLabel>
                        <AttributeSelectRow
                          label="Success" value={selection.attributes['data-kodety-success-action'] || 'message'}
                          onChange={value => onAttributeChange('data-kodety-success-action', value)}
                          options={[
                            { value: 'message', label: 'Show message' },
                            { value: 'element', label: 'Show element' },
                            { value: 'redirect', label: 'Redirect' },
                          ]}
                        />
                        {(selection.attributes['data-kodety-success-action'] || 'message') === 'redirect' && (
                          <div className="space-y-2.5">
                            {selection.attributes['data-kodety-utm-enabled'] !== 'true' ? (
                              <FieldRow
                                label="Redirect URL" value={selection.attributes['data-kodety-redirect-url'] || ''}
                                onCommit={value => onAttributeChange('data-kodety-redirect-url', value)}
                              />
                            ) : null}
                            <HtmlFormUtmSettings
                              attributes={selection.attributes}
                              selectedOuterHtml={selectedOuterHtml}
                              profiles={utmProfiles}
                              readOnly={readOnly}
                              featureAccess={analyticsFeatureAccess}
                              onAttributesChange={onAttributesChange}
                            />
                          </div>
                        )}
                        {(selection.attributes['data-kodety-success-action'] || 'message') === 'element' && (
                          <FieldRow
                            label="Element selector" value={selection.attributes['data-kodety-success-target'] || ''}
                            onCommit={value => onAttributeChange('data-kodety-success-target', value)}
                          />
                        )}
                        <FieldRow
                          label="Success message" value={selection.attributes['data-kodety-success-message'] || 'Thanks! Your message has been sent.'}
                          multiline
                          onCommit={value => onAttributeChange('data-kodety-success-message', value)}
                        />
                        <FieldRow
                          label="Error message" value={selection.attributes['data-kodety-error-message'] || 'Something went wrong. Please try again.'}
                          multiline
                          onCommit={value => onAttributeChange('data-kodety-error-message', value)}
                        />
                        <FieldRow
                          label="Error element" value={selection.attributes['data-kodety-error-target'] || ''}
                          onCommit={value => onAttributeChange('data-kodety-error-target', value)}
                        />
                        <BooleanAttributeRow
                          label="Reset fields on success"
                          checked={selection.attributes['data-kodety-reset-on-success'] !== 'false'}
                          onChange={checked => onAttributeChange('data-kodety-reset-on-success', checked ? 'true' : 'false')}
                        />
                      </div>
                      <div className="border-t border-border/60 pt-4">
                        <HtmlCmsFormAction
                          selection={selection}
                          selectedOuterHtml={selectedOuterHtml}
                          cmsAvailable={cmsAvailable}
                          onAttributesChange={onAttributesChange}
                        />
                      </div>
                    </>
                  )}
                  <HtmlCmsFilterAction
                    selection={selection}
                    selectedOuterHtml={selectedOuterHtml}
                    cmsAvailable={cmsAvailable}
                    onAttributesChange={onAttributesChange}
                  />
                  <details className="border-t border-border/60 pt-4">
                    <DisclosureSummary className="cursor-pointer text-xs font-medium text-muted-foreground">Native form settings</DisclosureSummary>
                    <div className="mt-2.5 space-y-2">
                      <FieldRow label="Action" value={selection.attributes.action || ''} onCommit={value => onAttributeChange('action', value)} />
                      <AttributeSelectRow
                        label="Method" value={selection.attributes.method || (isFilterForm ? 'get' : 'post')}
                        onChange={value => onAttributeChange('method', value)}
                        options={[{ value: 'get', label: 'GET' }, { value: 'post', label: 'POST' }, { value: 'dialog', label: 'Dialog' }]}
                      />
                      <AttributeSelectRow
                        label="Encoding" value={selection.attributes.enctype || 'multipart/form-data'}
                        onChange={value => onAttributeChange('enctype', value)}
                        options={[
                          { value: 'application/x-www-form-urlencoded', label: 'URL encoded' },
                          { value: 'multipart/form-data', label: 'Multipart / upload' },
                          { value: 'text/plain', label: 'Plain text' },
                        ]}
                      />
                      <AttributeSelectRow
                        label="Autocomplete" value={selection.attributes.autocomplete || 'on'}
                        onChange={value => onAttributeChange('autocomplete', value)}
                        options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
                      />
                      <BooleanAttributeRow
                        label="Disable validation"
                        checked={'novalidate' in selection.attributes}
                        onChange={checked => onAttributeChange('novalidate', checked ? 'novalidate' : '')}
                      />
                    </div>
                  </details>
                </div>
              )}
              {isInput && (
                <>
                  <AttributeSelectRow
                    label="Type" value={selection.attributes.type || 'text'}
                    onChange={value => onAttributeChange('type', value || 'text')}
                    options={[
                      'text', 'email', 'password', 'search', 'tel', 'url', 'number', 'file', 'checkbox', 'radio', 'range', 'date', 'time', 'color', 'hidden',
                    ].map(value => ({ value, label: value }))}
                  />
                  <FieldRow
                    label="Name" value={selection.attributes.name || ''}
                    onCommit={value => onAttributeChange('name', value)}
                  />
                  {!['checkbox', 'radio', 'file', 'color', 'hidden'].includes(selection.attributes.type || 'text') && <FieldRow
                    label={componentVariableLabel('Placeholder', ['text'], 'placeholder', selection.attributes.placeholder || '')}
                    ariaLabel="Placeholder" value={selection.attributes.placeholder || ''}
                    onCommit={value => onAttributeChange('placeholder', value)}
                  />}
                  {(selection.attributes.type || 'text') !== 'file' && <FieldRow
                    label={componentVariableLabel(
                      ['checkbox', 'radio'].includes(selection.attributes.type || 'text') ? 'Submitted value' : 'Default value',
                      ['number', 'range'].includes(selection.attributes.type || 'text') ? ['number'] : ['text'],
                      'value',
                      selection.attributes.value || '',
                    )}
                    ariaLabel={['checkbox', 'radio'].includes(selection.attributes.type || 'text') ? 'Submitted value' : 'Default value'} value={selection.attributes.value || ''}
                    onCommit={value => onAttributeChange('value', value)}
                  />}
                  {selection.attributes.type === 'range' && (
                    <FieldRow
                      label="Value output" value={selection.attributes['data-kodety-range-output'] || ''}
                      onCommit={value => onAttributeChange('data-kodety-range-output', value)}
                    />
                  )}
                  {(selection.attributes.type || 'text') === 'file' && <FieldRow
                    label="Accept" value={selection.attributes.accept || ''}
                    onCommit={value => onAttributeChange('accept', value)}
                  />}
                  {['text', 'email', 'password', 'search', 'tel', 'url'].includes(selection.attributes.type || 'text') && <FieldRow
                    label="Autocomplete" value={selection.attributes.autocomplete || ''}
                    onCommit={value => onAttributeChange('autocomplete', value)}
                  />}
                  {['text', 'email', 'password', 'search', 'tel', 'url'].includes(selection.attributes.type || 'text') && <FieldRow
                    label="Pattern" value={selection.attributes.pattern || ''}
                    onCommit={value => onAttributeChange('pattern', value)}
                  />}
                  {['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(selection.attributes.type || 'text') && <AttributeSelectRow
                    label="Input mode" value={selection.attributes.inputmode || ''}
                    onChange={value => onAttributeChange('inputmode', value)}
                    options={['text', 'decimal', 'numeric', 'tel', 'search', 'email', 'url', 'none'].map(value => ({ value, label: value }))}
                  />}
                  {['number', 'range', 'date', 'time'].includes(selection.attributes.type || 'text') && <div className="space-y-2">
                    <FieldRow
                      label={componentVariableLabel('Min', ['number'], 'min', selection.attributes.min || '')}
                      ariaLabel="Min" value={selection.attributes.min || ''}
                      onCommit={value => onAttributeChange('min', value)}
                    />
                    <FieldRow
                      label={componentVariableLabel('Max', ['number'], 'max', selection.attributes.max || '')}
                      ariaLabel="Max" value={selection.attributes.max || ''}
                      onCommit={value => onAttributeChange('max', value)}
                    />
                    <FieldRow
                      label={componentVariableLabel('Step', ['number'], 'step', selection.attributes.step || '')}
                      ariaLabel="Step" value={selection.attributes.step || ''}
                      onCommit={value => onAttributeChange('step', value)}
                    />
                  </div>}
                  {([['required', 'Required'], ['disabled', 'Disabled'], ['readonly', 'Read only'], ['checked', 'Checked'], ['multiple', 'Multiple files']] as const).filter(([attribute]) => {
                    const type = selection.attributes.type || 'text';
                    if (attribute === 'readonly') return !['file', 'checkbox', 'radio', 'color', 'hidden'].includes(type);
                    if (attribute === 'checked') return ['checkbox', 'radio'].includes(type);
                    if (attribute === 'multiple') return type === 'file';
                    return type !== 'hidden';
                  }).map(([attribute, label]) => (
                    <BooleanAttributeRow
                      key={attribute}
                      label={label}
                      checked={attribute in selection.attributes}
                      onChange={checked => onAttributeChange(attribute, checked ? attribute : '')}
                    />
                  ))}
                  {selection.attributes.type === 'file' && (
                    <AttributeSelectRow
                      label="Capture" value={selection.attributes.capture || ''}
                      onChange={value => onAttributeChange('capture', value)}
                      options={[{ value: 'user', label: 'Front camera' }, { value: 'environment', label: 'Back camera' }]}
                    />
                  )}
                </>
              )}
              {isTextarea && (
                <>
                  <FieldRow
                    label="Name" value={selection.attributes.name || ''}
                    onCommit={value => onAttributeChange('name', value)}
                  />
                  <FieldRow
                    label="Placeholder" value={selection.attributes.placeholder || ''}
                    onCommit={value => onAttributeChange('placeholder', value)}
                  />
                  <FieldRow
                    label="Rows" value={selection.attributes.rows || ''}
                    onCommit={value => onAttributeChange('rows', value)}
                  />
                  <FieldRow
                    label="Cols" value={selection.attributes.cols || ''}
                    onCommit={value => onAttributeChange('cols', value)}
                  />
                  <FieldRow
                    label="Max length" value={selection.attributes.maxlength || ''}
                    onCommit={value => onAttributeChange('maxlength', value)}
                  />
                  <AttributeSelectRow
                    label="Wrap" value={selection.attributes.wrap || ''}
                    onChange={value => onAttributeChange('wrap', value)}
                    options={[{ value: 'soft', label: 'Soft' }, { value: 'hard', label: 'Hard' }, { value: 'off', label: 'Off' }]}
                  />
                  {([['required', 'Required'], ['disabled', 'Disabled'], ['readonly', 'Read only']] as const).map(([attribute, label]) => (
                    <BooleanAttributeRow
                      key={attribute}
                      label={label}
                      checked={attribute in selection.attributes}
                      onChange={checked => onAttributeChange(attribute, checked ? attribute : '')}
                    />
                  ))}
                </>
              )}
              {isSelect && (
                <>
                  <FieldRow
                    label="Name" value={selection.attributes.name || ''}
                    onCommit={value => onAttributeChange('name', value)}
                  />
                  {([['required', 'Required'], ['disabled', 'Disabled'], ['multiple', 'Multiple']] as const).map(([attribute, label]) => (
                    <BooleanAttributeRow
                      key={attribute}
                      label={label}
                      checked={attribute in selection.attributes}
                      onChange={checked => onAttributeChange(attribute, checked ? attribute : '')}
                    />
                  ))}
                </>
              )}
              {isButton && (
                <>
                  <AttributeSelectRow
                    label="Type" value={selection.attributes.type || 'button'}
                    onChange={value => onAttributeChange('type', value || 'button')}
                    options={[{ value: 'button', label: 'Button' }, { value: 'submit', label: 'Submit' }, { value: 'reset', label: 'Reset' }]}
                  />
                  <FieldRow
                    label="Name" value={selection.attributes.name || ''}
                    onCommit={value => onAttributeChange('name', value)}
                  />
                  <FieldRow
                    label="Value" value={selection.attributes.value || ''}
                    onCommit={value => onAttributeChange('value', value)}
                  />
                  {(selection.attributes.type || 'button') === 'submit' && (
                    <FieldRow
                      label="Submitting label" value={selection.attributes['data-kodety-loading-label'] || 'Sending…'}
                      onCommit={value => onAttributeChange('data-kodety-loading-label', value)}
                    />
                  )}
                  <FieldRow
                    label="Form action" value={selection.attributes.formaction || ''}
                    onCommit={value => onAttributeChange('formaction', value)}
                  />
                  <AttributeSelectRow
                    label="Form method" value={selection.attributes.formmethod || ''}
                    onChange={value => onAttributeChange('formmethod', value)}
                    options={[{ value: 'get', label: 'GET' }, { value: 'post', label: 'POST' }, { value: 'dialog', label: 'Dialog' }]}
                  />
                  <BooleanAttributeRow
                    label="Disabled"
                    checked={'disabled' in selection.attributes}
                    onChange={checked => onAttributeChange('disabled', checked ? 'disabled' : '')}
                  />
                </>
              )}
            </SettingsPanel>
          )}
          {hasWidgetControls && (
            <SettingsPanel
              title="Interactive Widget" isOpen
              onToggle={() => {}}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                Visual properties for interactive embeds created through Insert. JavaScript and CSS files can still be attached below.
              </p>
              {('data-lottie-src' in selection.attributes || selection.attributes['data-label'] === 'Lottie Animation') && (
                <>
                  <FieldRow
                    label="Lottie JSON" value={selection.attributes['data-lottie-src'] || ''}
                    onCommit={value => onAttributeChange('data-lottie-src', value)}
                  />
                  <BooleanAttributeRow
                    label="Autoplay" checked={selection.attributes['data-lottie-autoplay'] !== 'false'}
                    onChange={checked => onAttributeChange('data-lottie-autoplay', checked ? 'true' : 'false')}
                  />
                  <BooleanAttributeRow
                    label="Loop" checked={selection.attributes['data-lottie-loop'] !== 'false'}
                    onChange={checked => onAttributeChange('data-lottie-loop', checked ? 'true' : 'false')}
                  />
                  <FieldRow
                    label="Speed" value={selection.attributes['data-lottie-speed'] || '1'}
                    onCommit={value => onAttributeChange('data-lottie-speed', value || '1')}
                  />
                  <AttributeSelectRow
                    label="Direction" value={selection.attributes['data-lottie-direction'] || '1'}
                    onChange={value => onAttributeChange('data-lottie-direction', value || '1')}
                    options={[{ value: '1', label: 'Forward' }, { value: '-1', label: 'Reverse' }]}
                  />
                  <AttributeSelectRow
                    label="Renderer" value={selection.attributes['data-lottie-renderer'] || 'svg'}
                    onChange={value => onAttributeChange('data-lottie-renderer', value || 'svg')}
                    options={[{ value: 'svg', label: 'SVG' }, { value: 'canvas', label: 'Canvas' }, { value: 'html', label: 'HTML' }]}
                  />
                </>
              )}
              {(selection.tag === 'canvas' || selection.attributes['data-label'] === 'Rive') && (
                <>
                  <FieldRow
                    label="Rive file" value={selection.attributes['data-rive-src'] || ''}
                    onCommit={value => onAttributeChange('data-rive-src', value)}
                  />
                  <FieldRow
                    label="State machine" value={selection.attributes['data-rive-state-machine'] || ''}
                    onCommit={value => onAttributeChange('data-rive-state-machine', value)}
                  />
                  <FieldRow
                    label="Artboard" value={selection.attributes['data-rive-artboard'] || ''}
                    onCommit={value => onAttributeChange('data-rive-artboard', value)}
                  />
                  <BooleanAttributeRow
                    label="Autoplay" checked={selection.attributes['data-rive-autoplay'] !== 'false'}
                    onChange={checked => onAttributeChange('data-rive-autoplay', checked ? 'true' : 'false')}
                  />
                  <AttributeSelectRow
                    label="Fit" value={selection.attributes['data-rive-fit'] || 'contain'}
                    onChange={value => onAttributeChange('data-rive-fit', value || 'contain')}
                    options={['contain', 'cover', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'none'].map(value => ({ value, label: value }))}
                  />
                  <AttributeSelectRow
                    label="Alignment" value={selection.attributes['data-rive-alignment'] || 'center'}
                    onChange={value => onAttributeChange('data-rive-alignment', value || 'center')}
                    options={['center', 'topLeft', 'topCenter', 'topRight', 'centerLeft', 'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight'].map(value => ({ value, label: value }))}
                  />
                </>
              )}
              {selection.attributes['data-label'] === 'Spline Scene' && (
                <>
                  <FieldRow
                    label="Spline URL" value={selection.attributes.src || selection.attributes['data-spline-src'] || ''}
                    onCommit={value => { onAttributeChange('data-spline-src', value); onAttributeChange('src', value); }}
                  />
                  <BooleanAttributeRow
                    label="Pointer events" checked={(styleValues['pointer-events'] || 'auto') !== 'none'}
                    onChange={checked => onVisualStyleChange('pointer-events', checked ? 'auto' : 'none')}
                  />
                  <AttributeSelectRow
                    label="Loading" value={selection.attributes.loading || 'lazy'}
                    onChange={value => onAttributeChange('loading', value || 'lazy')}
                    options={[{ value: 'lazy', label: 'Lazy' }, { value: 'eager', label: 'Eager' }]}
                  />
                </>
              )}
            </SettingsPanel>
          )}
          <SettingsPanel
            title="Attributes" isOpen
            onToggle={() => {}}
          >
            <p className="text-xs leading-relaxed text-muted-foreground">Atributos HTML, data attributes, ARIA e integrações de bibliotecas.</p>
            {customAttributes.map(([name, value]) => (
              <div key={name} className="grid grid-cols-3 items-center gap-2">
                <YcodeLabel variant="muted" className="truncate font-mono" data-kodety-no-i18n title={name}>{name}</YcodeLabel>
                <div className="col-span-2 min-w-0">
                  <HtmlSettingsTextControl
                    key={`${selection.path}:${name}`}
                    label={name}
                    kind="tag"
                    value={value}
                    onChange={next => onAttributeChange(name, next)}
                    action={(
                      <HtmlSettingsActionSlot>
                        <YcodeButton
                          size="icon-xs" variant="ghost"
                          title={`Remove ${name}`}
                          aria-label={`Remove ${name}`}
                          onClick={() => onAttributeChange(name, '')}
                        ><Trash2 /></YcodeButton>
                      </HtmlSettingsActionSlot>
                    )}
                  />
                </div>
              </div>
            ))}
            <div className="border-t border-border/55 pt-2">
              <div className="flex flex-col gap-2">
                <YcodeSettingsRow label="Name">
                  <HtmlSettingsTextControl
                    label="Attribute name"
                    kind="tag"
                    value={newAttributeName}
                    onChange={setNewAttributeName}
                    placeholder="data-name"
                    inputClassName="font-mono"
                  />
                </YcodeSettingsRow>
                <YcodeSettingsRow label="Value">
                  <HtmlSettingsTextControl
                    label="Attribute value"
                    kind="text"
                    value={newAttributeValue}
                    onChange={setNewAttributeValue}
                    placeholder="value"
                  />
                </YcodeSettingsRow>
              </div>
              <YcodeButton
                size="sm" variant="input"
                className="mt-2 w-full"
                disabled={!validNewAttribute}
                onClick={() => {
                  onAttributeChange(newAttributeName.trim(), newAttributeValue || newAttributeName.trim());
                  setNewAttributeName('');
                  setNewAttributeValue('');
                }}
              ><Plus /> Add attribute</YcodeButton>
            </div>
          </SettingsPanel>
          {cmsAvailable && (
            <HtmlCmsBindings
              selection={selection}
              currentPage={currentPage}
              onAttributeChange={onAttributeChange}
              onAttributesChange={onAttributesChange}
              onCollectionChange={handleCollectionChange}
              onCollectionModelChange={handleCollectionModelChange}
              onCollectionRepeatSelf={handleCollectionRepeatSelf}
              onBindItemLink={handleBindItemLink}
              integrated
              inheritedCollectionType={inheritedCollection?.type || ''}
              inheritedCollectionLabel={inheritedCollection?.label || ''}
              inheritedCollectionOrderby={inheritedCollection?.orderby || ''}
              inheritedCollectionOrder={inheritedCollection?.order || ''}
              canBeCollectionModel={canBeCollectionModel}
              collectionModelActive={'data-kodety-collection-item' in selection.attributes}
              collectionModelLabel={collectionModel?.label || ''}
              collectionRepeatMode={(selection.attributes['data-kodety-repeat'] === 'child' || collectionModel) ? 'child' : 'self'}
            />
          )}
          </>
          )}
          </div>
        </TabsContent>

        <TabsContent value="interactions" data-kodety-onboarding="design-interactions-panel" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          {componentInteractions || (
            isBodySelected ? (
              <Tabs defaultValue="element" className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
                <div className="shrink-0 px-3 pt-3" data-kodety-i18n-root>
                  <TabsList className="kodety-page-transition-tabs h-9 w-full grid-cols-2 rounded-[10px] p-[3px]">
                    <TabsTrigger value="element" className="h-full w-full rounded-[7px] px-2 text-[9px]">Interactions</TabsTrigger>
                    <TabsTrigger value="page-transitions" className="h-full w-full rounded-[7px] px-2 text-[9px]">Page transitions</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="element" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pt-2 data-[state=inactive]:hidden">
                  {elementInteractionsPanel}
                </TabsContent>
                <TabsContent value="page-transitions" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
                  <HtmlPageTransitionsPanel
                    document={pageTransitions}
                    pages={linkPages}
                    currentPage={currentPage}
                    homePage={homePage}
                    readOnly={readOnly || isLocaleOverride}
                    onChange={onPageTransitionsChange}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {elementInteractionsPanel}
              </div>
            )
          )}
        </TabsContent>
          </Tabs>
        </aside>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>Estilos da layer</ContextMenuLabel>
        <ContextMenuItem onSelect={onCopyAllStyles}>
          <ClipboardCopy /> Copiar estilos
          <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly || !styleClipboard} onSelect={onPasteAllStyles}>
          <ClipboardPaste /> Colar estilos
          <ContextMenuShortcut>⌘⇧V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!copyablePropertyEntries.length}>
            <ClipboardCopy /> Copiar propriedade
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 w-64 overflow-y-auto">
            {copyablePropertyEntries.map(([property, value]) => (
              <ContextMenuItem key={property} onSelect={() => onCopyStyleProperty(property, value)}>
                <span className="min-w-0 flex-1 truncate font-mono" data-kodety-no-i18n>{property}</span>
                <span className="max-w-24 truncate text-[10px] text-muted-foreground" data-kodety-no-i18n>{value}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={readOnly || !styleClipboard}>
            <ClipboardPaste /> Colar propriedade
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 w-64 overflow-y-auto">
            {Object.entries(styleClipboard || {}).map(([property, value]) => (
              <ContextMenuItem key={property} onSelect={() => onPasteStyleProperty(property)}>
                <span className="min-w-0 flex-1 truncate font-mono" data-kodety-no-i18n>{property}</span>
                <span className="max-w-24 truncate text-[10px] text-muted-foreground" data-kodety-no-i18n>{value}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}
