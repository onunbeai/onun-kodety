import type { ShareAccessInvitation } from '@/app/(builder)/kodety/html-editor/components/HtmlShareDialog';
import type { KodetyUpdateClientConfig } from '@/app/(builder)/kodety/html-editor/components/HtmlKodetyUpdates';
import type { CanvasComputedStyleExpectation } from '@/lib/html-editor/canvas-protocol';
import type {
  CanvasViewAttributePatch,
  CanvasViewPropertyOwnershipPatch,
  CanvasViewStylePatch,
  CanvasViewTextPatch,
} from '@/lib/html-editor/canvas-view-state';
import type { InteractionDocument } from '@/lib/html-editor/interactions';
import type { HtmlMembershipWordPressConfig } from '@/lib/html-editor/membership-client';
import type { HtmlProject } from '@/lib/html-editor/types';
import type { HtmlLicenseSettings } from './license-settings';
import type { ReactNode } from 'react';

export type Viewport = string;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface LocaleLiveStructureContext {
  renderedSource: string;
  nextRenderedSource: string;
  insertionPath: string;
  resultPath: string;
  localizedResultPath: string;
  canonicalSource: string;
  nextCanonicalSource: string;
}

export interface LiveStructureProjection {
  message: Record<string, unknown>;
  remapPath: (path: string) => string | null;
}

export interface LiveHistoryProjection extends LiveStructureProjection {
  source: string;
}

export interface LiveHistoryTransition {
  previous: HtmlProject;
  /** Locale, audience and document that own the positional DOM commands. */
  surfaceKey: string;
  forward: LiveHistoryProjection;
  backward: LiveHistoryProjection;
}

export interface McpProjectTarget {
  workspaceMode: 'single';
  workspaceProjectId?: string;
  name?: string;
  siteUrl?: string;
  builderUrl?: string;
}

export interface BuilderTemplateField {
  key: string;
  label: string;
  type?: 'text' | 'richtext' | 'image' | 'url' | 'number' | 'date';
  group?: string;
  description?: string;
}

/**
 * Optional Builder template surface supplied through kodety_editor_shell_config.
 * Core only knows the provider contract; its data, persistence and public
 * rendering remain owned by the active extension.
 */
export interface BuilderTemplateProvider {
  id: string;
  name: string;
  templatePath: string;
  templatesUrl: string;
  fields: BuilderTemplateField[];
  actions?: Array<{ id: string; label: string }>;
}

export interface KodetyWordPressConfig extends HtmlMembershipWordPressConfig {
  /** Browser-local Kodety Studio context. The real `siteUrl` remains the
   * internal WordPress runtime URL; this object controls only presentation and
   * communication with the Studio shell. */
  studio?: {
    enabled: boolean;
    studioOrigin?: string;
    projectId: string;
    projectSlug: string;
    displayPath: string;
    previewUrl?: string;
    /** Same-origin browser proxy for WordPress routes that must open in a
     * real top-level tab (including Builder's unpublished review mode). */
    proxyBaseUrl?: string;
    studioLanguage?: 'pt' | 'en';
    wordpressLocale?: 'pt_BR' | 'en_US';
  };
  edition?: 'pro';
  product?: {
    edition: 'pro';
    licensed: boolean;
    licenseStatus?: string;
    licensePlan?: string;
    licenseIsTrial?: boolean;
    licenseTrialExpired?: boolean;
    licenseExpiresAt?: string;
    licenseServerTime?: string;
    licenseStatusUrl?: string;
    unlicensedFeatures?: Record<string, boolean>;
    unlicensedLimits?: Record<string, number | null>;
    features: Record<string, boolean>;
    limits: Record<string, number | null>;
    upgradeUrl: string;
    licenseUrl: string;
  };
  appView?: 'editor' | 'cms' | 'settings' | 'localization' | 'templates' | 'analytics' | 'members' | 'kodefy';
  editorUrl?: string;
  cmsUrl?: string;
  membersUrl?: string;
  settingsUrl?: string;
  localizationUrl?: string;
  analyticsUrl?: string;
  /** Explicit visual-demo flag resolved by the WordPress request shell. */
  analyticsDemoMode?: boolean;
  templatesUrl?: string;
  templatesCatalogUrl?: string;
  templatesApplyUrl?: string;
  templatesUploadUrl?: string;
  kodefyUrl?: string;
  kodefySettingsUrl?: string;
  kodefyConnectionTestUrl?: string;
  kodefyBuilderDataUrl?: string;
  kodefyDownloadKitUrl?: string;
  analyticsOverviewUrl?: string;
  analyticsPageInsightsUrl?: string;
  analyticsFunnelsUrl?: string;
  analyticsFunnelItemUrl?: string;
  analyticsEmailOptionsUrl?: string;
  analyticsExperimentsUrl?: string;
  analyticsExperimentItemUrl?: string;
  analyticsStateUrl?: string;
  searchConsoleUrl?: string;
  sitemapUrl?: string;
  metaCapiSettingsUrl?: string;
  metaCapiTestUrl?: string;
  projectUrl?: string;
  /** Text-only bootstrap used by lightweight Settings and Analytics surfaces. */
  projectSurfaceUrl?: string;
  /** Lazy, single-file reader for assets referenced by lightweight Settings. */
  projectSurfaceAssetUrl?: string;
  projectDownloadUrl?: string;
  projectChunkUrl?: string;
  /** Transactional whole-file draft changes. Its presence advertises v1. */
  projectDeltaUrl?: string;
  /** Metadata-only localization save endpoint supplied by the extension. */
  localizationSaveUrl?: string;
  projectName?: string;
  publishUrl: string;
  /** The server can rebuild a release-only materialized overlay on top of the
   * exact editable workspace it already acknowledged. */
  materializedPublishOverlay?: boolean;
  previewUrl?: string;
  youtubeEmbedUrl?: string;
  cachePurgeUrl?: string;
  releasesUrl: string;
  storageUrl?: string;
  nonce: string;
  canPublish: boolean;
  canEditWorkspace?: boolean;
  canAccessCms?: boolean;
  canManageCmsSchema?: boolean;
  canManageCmsTemplates?: boolean;
  canUseAi?: boolean;
  canViewAnalytics?: boolean;
  canManageAnalytics?: boolean;
  canManageIntegrations?: boolean;
  activeExtensions?: string[];
  templateProviders?: BuilderTemplateProvider[];
  updates?: KodetyUpdateClientConfig | null;
  /** Personal tour preference; never stored in the project or share state. */
  onboarding?: {
    userId: number;
    preference: 'unseen' | 'offered' | 'dismissed' | 'started' | 'completed';
    preferenceUrl: string;
  } | null;
  dashboardUrl: string;
  siteUrl: string;
  logoutUrl: string;
  /** Set when a wp-admin ZIP import should open the manual publish review panel. */
  openPublishAfterImport?: boolean;
  /** A restored snapshot must bypass the previous local project on startup. */
  restoredSnapshot?: boolean;
  /** A Shopify theme import opens in maintenance mode and must not auto-publish to WordPress. */
  shopifyThemeImport?: boolean;
  /** Set by /kodety/editor/folder, the address that replaced the menu entry. */
  folderPicker?: boolean;
  /** Set when "Adicionar página" in wp-admin handed page creation to the builder. */
  newPage?: boolean;
  importZipUrl?: string;
  initialHtmlPath?: string;
  initialExperimentId?: string;
  initialVariantId?: string;
  mcpStatusUrl: string;
  mcpSettingsUrl: string;
  mcpAdminUrl?: string;
  mcpProjectConnectionUrl?: string;
  mcpTarget?: McpProjectTarget | null;
  mcpEnabled: boolean;
  brandLogoUrl: string;
  editorCornerIcon: 'kodety-logo' | 'client-logo';
  cmsSchemaUrl?: string;
  cmsTemplatesUrl?: string;
  cmsItemsUrl?: string;
  cmsCollectionsUrl?: string;
  mediaUploadUrl?: string;
  aiSettingsUrl?: string;
  aiSettingsPageUrl?: string;
  aiGenerateUrl?: string;
  aiTestUrl?: string;
  adobeFontsLicensed?: boolean;
  adobeFontsUrl?: string;
  adobeFontsSettingsUrl?: string;
  adobeFontsSyncUrl?: string;
  /** Base REST endpoint for the authenticated Codex App Server bridge. */
  agentUrl?: string;
  /** Optional nonce dedicated to agent routes; falls back to the editor nonce. */
  agentNonce?: string;
  optimizationsUrl?: string;
  canViewMembers?: boolean;
  canManageMembers?: boolean;
  sharingUrl?: string;
  editorLockUrl?: string;
  readOnly?: boolean;
  share?: {
    active: boolean;
    mode: 'view' | 'edit';
    authRequired: boolean;
    token: string;
    projectId: string;
    invitation?: ShareAccessInvitation | null;
  } | null;
}

export interface CmsPreviewItem {
  id: number;
  revision?: string;
  type?: string;
  label?: string;
  status?: string;
  editUrl?: string;
  dateIso?: string;
  modifiedIso?: string;
  values: Record<string, unknown>;
}

export interface CmsPreviewPayload {
  item: CmsPreviewItem | null;
  items: CmsPreviewItem[];
  postType: string;
  collections?: Record<string, CmsPreviewItem[]>;
}

export interface CmsTemplateCollection {
  slug: string;
  name: string;
}

export interface CmsTemplateSchema {
  types?: Array<{
    slug?: string;
    name?: string;
    restBase?: string;
    fields?: Array<{
      key: string;
      label: string;
      type?: string;
      source?: string;
    }>;
  }>;
  templates?: Record<string, string>;
}

export type McpActivityPhase = 'reading' | 'writing' | 'generating';

export interface McpRuntimeActivityTarget {
  page?: string;
  sectionId?: string;
  path?: string;
  postId?: number;
  postType?: string;
}

export interface McpRuntimeActivity {
  id?: string;
  active?: boolean;
  phase?: McpActivityPhase;
  tool?: string;
  target?: McpRuntimeActivityTarget;
  startedAt?: string;
  completedAt?: string;
  visibleUntil?: number;
  expiresAt?: number;
  success?: boolean;
  message?: string;
  result?: {
    release?: string;
    siteUrl?: string;
    page?: string;
    sectionId?: string;
    operation?: string;
  };
}

export interface McpRuntimeStatus {
  enabled: boolean;
  configured: boolean;
  activity: McpRuntimeActivity | null;
  target: McpProjectTarget | null;
}

export interface FramerCaptureBreakpoint {
  hash: string;
  mediaQuery: string;
}

export interface FramerBreakpointCapture {
  width: number;
  html: string;
}

export type CanvasDesignTool =
  | 'select'
  | 'frame'
  | 'stack'
  | 'grid'
  | 'masonry'
  | 'image'
  | 'video'
  | 'text-block';

export interface HtmlProjectEditorProps {
  /** Enables guards that are specific to the iframe-based WordPress shell.
   * The standalone editor intentionally keeps its existing behavior. */
  runtime?: 'standalone' | 'wordpress';
  /** A host can supply its own mandatory persistence without forking the
   * shared Builder or relying on the standalone browser recovery database. */
  workspace?: {
    initialProject: HtmlProject;
    product?: KodetyWordPressConfig['product'];
    license?: HtmlLicenseSettings;
    settingsContent?: { mcp?: ReactNode; agents?: ReactNode };
    /** Native host transport for the shared MCP launcher and connection status. */
    mcp?: { status: McpRuntimeStatus; onOpenSettings(): void };
    directoryName?: string;
    storageMode?: 'browser' | 'folder' | 'cloud';
    backup?: { label: string; busy: boolean; onDownload(): void };
    /** Installed and explicitly activated host extensions. Missing means none.
     * Project localization metadata remains portable independently of this UI gate. */
    activeExtensions?: readonly string[];
    /** Local hosts can open the same review UI from their own persisted source.
     * WordPress keeps its native editor route and draft/preview endpoints. */
    previewUrl?: string;
    preparePreview?(project: HtmlProject): Promise<void>;
    reloadPreview?(): Promise<HtmlProject>;
    onManageExtensions?(): void;
    view?: 'editor' | 'settings' | 'localization' | 'cms';
    onNavigateView(view: 'editor' | 'settings' | 'localization' | 'cms'): boolean | void | Promise<boolean | void>;
    /** A cloud host can flush its durable draft before changing the canvas page. */
    beforeNavigatePage?(): Promise<boolean>;
    /** Explicit Save can upload immediately while autosave remains local. */
    syncProject?(): Promise<void>;
    onOpenSettingsSection?(section: 'mcp' | 'license' | 'beta'): void;
    saveProject(project: HtmlProject): Promise<void>;
    exportProject(project: HtmlProject): Promise<void>;
    onProjectChange(project: HtmlProject): void;
    onReady(api: { getProject(): HtmlProject | null; applyProject(project: HtmlProject): void }): void;
    onBack(): void;
    onPublish(): void;
    onWordPressFeature(feature: 'CMS' | 'Analytics'): void;
  };
}

export type CanvasLiveStylePatch = CanvasViewStylePatch;

export type CanvasLiveAttributePatch = CanvasViewAttributePatch;

export type CanvasLiveTextPatch = CanvasViewTextPatch;

export type CanvasLivePropertyOwnershipPatch = CanvasViewPropertyOwnershipPatch;

export interface CanvasStylePreviewRelease {
  property: string;
  version: number;
}

export interface CanvasLiveStyleEnqueueMessage {
  cssPath?: string;
  cssText?: string;
  designTokenCssText?: string;
  patches?: CanvasLiveStylePatch[];
  attributes?: CanvasLiveAttributePatch[];
  texts?: CanvasLiveTextPatch[];
  ownerships?: CanvasLivePropertyOwnershipPatch[];
  checks?: CanvasComputedStyleExpectation[];
  interactionDocument?: InteractionDocument;
  clearPreviewProperties?: string[];
  directGestureIds?: string[];
}

export interface CanvasLiveStyleBatch {
  recordHistory: boolean;
  /** Every linked root touched by one compound authoring command. */
  stylesheets: Map<string, string>;
  designTokenCssText?: string;
  patches: Map<string, CanvasLiveStylePatch>;
  attributes: Map<string, CanvasLiveAttributePatch>;
  texts: Map<string, CanvasLiveTextPatch>;
  ownerships: Map<string, CanvasLivePropertyOwnershipPatch>;
  checks: Map<string, CanvasComputedStyleExpectation>;
  interactionDocument?: InteractionDocument;
  clearPreviewProperties: Set<string>;
  directGestureIds: Set<string>;
}

export interface PendingCanvasLiveStyle {
  mutationId: string;
  revision: number;
  cssPath?: string;
  cssText?: string;
  designTokenCssText?: string;
  patches: CanvasLiveStylePatch[];
  attributes: CanvasLiveAttributePatch[];
  texts: CanvasLiveTextPatch[];
  checks: CanvasComputedStyleExpectation[];
  interactionDocument?: InteractionDocument;
  clearPreviewProperties: CanvasStylePreviewRelease[];
  directGestureIds: string[];
  attempts: number;
  repairing?: boolean;
}

export interface CanvasLiveStyleJournal {
  css: Map<string, { revision: number; cssText: string }>;
  designTokens: { revision: number; cssText: string } | null;
  patches: Map<string, { revision: number; patch: CanvasLiveStylePatch }>;
  attributes: Map<string, { revision: number; patch: CanvasLiveAttributePatch }>;
  texts: Map<string, { revision: number; patch: CanvasLiveTextPatch }>;
  interactionDocument: {
    revision: number;
    document: InteractionDocument;
  } | null;
}
