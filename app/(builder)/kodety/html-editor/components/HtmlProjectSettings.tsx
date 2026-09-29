'use client';

import { cmsFetch } from '@/lib/html-editor/cms-host';

import { DisclosureChevron, DisclosureSummary } from '@/components/ui/disclosure-summary';

import { lazy, memo, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AGENT_NATIVE_CHANGED_EVENT, mergeAgentNativeSettings } from '@/lib/html-editor/agent-native-events';
import { OPEN_HTML_AGENT_PANEL_EVENT } from '@/lib/html-editor/agent-panel-events';
import type { AgentNativeOperation } from '@/lib/html-editor/agent-native-tools';
import {
  AlertTriangle,
  Archive,
  Bot,
  Braces,
  CheckCircle2,
  ChevronLeft,
  Code2,
  CircleHelp,
  Database,
  Download,
  Eye,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Route,
  SearchCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
  Upload,
  X,
} from '@/components/ui/gravity-icons';
import { ArchiveMinimalisticIcon } from '@solar-icons/react/bold-duotone/archive-minimalistic';
import { BotIcon as SolarBotIcon } from '@solar-icons/react/bold-duotone/bot';
import { DangerTriangleIcon } from '@solar-icons/react/bold-duotone/danger-triangle';
import { FileTextIcon } from '@solar-icons/react/bold-duotone/file-text';
import { Home2Icon } from '@solar-icons/react/bold-duotone/home-2';
import { MinimalisticMagnifierIcon } from '@solar-icons/react/bold-duotone/minimalistic-magnifier';
import { RouteIcon as SolarRouteIcon } from '@solar-icons/react/bold-duotone/route';
import { SidebarCodeIcon } from '@solar-icons/react/bold-duotone/sidebar-code';
import { ShieldCheckIcon } from '@solar-icons/react/bold-duotone/shield-check';
import { SettingsMinimalisticIcon } from '@solar-icons/react/bold-duotone/settings-minimalistic';
import { StarsMinimalisticIcon } from '@solar-icons/react/bold-duotone/stars-minimalistic';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import { editorLockHandoffUrl } from '@/Wordpress/editor/editor-lock-navigation';
import { registerWorkspaceNavigationGuard, WORKSPACE_NAVIGATION_CANCELLED_EVENT } from '@/lib/html-editor/workspace-navigation';
import { notifyWorkspaceDraftChanged } from '@/lib/html-editor/workspace-draft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DEFAULT_CUSTOM_CODE_SETTINGS,
  customCodeSettingsError,
  normalizeCustomCodeSettings,
  type CustomCodeSettings,
} from '@/lib/html-editor/custom-code';
import {
  DEFAULT_COOKIE_CONSENT_SETTINGS,
  cookieConsentSettingsError,
  normalizeCookieConsentSettings,
  type CookieConsentSettings,
} from '@/lib/html-editor/cookie-consent';
import {
  DEFAULT_REDIRECT_SETTINGS,
  normalizeRedirectSettings,
  redirectSettingsError,
  type RedirectSettings,
} from '@/lib/html-editor/redirects';
import {
  cmsSeoToken,
  jsonLdError,
  resolveCmsSeoTemplate,
  schemaStarter,
  type PageSeoSettings,
  type SeoSchemaType,
  type SiteSeoSettings,
} from '@/lib/html-editor/seo-settings';
import { resolveProjectPath } from '@/lib/html-editor/project-path';
import { isSettingsImageFile, settingsImageAssetUrl } from '@/lib/html-editor/settings-media';
import {
  SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES,
  SOCIAL_IMAGE_VARIABLE_GROUPS,
  canonicalizeSocialImageTemplateAssets,
  duplicateSocialImageTemplate,
  normalizeSocialImageTemplateId,
  normalizeSocialImageTemplateLibrary,
  upsertSocialImageTemplateLibrary,
  type SocialImageTemplate,
  type SocialImageVariableOption,
} from '@/lib/html-editor/social-image';
import type { HtmlProjectFile } from '@/lib/html-editor/types';
import { canonicalSettingsSignature, mergeCanonicalSettingsDraft, useCanonicalSettingsDraft } from '../hooks/use-canonical-settings-draft';
import { HtmlAdobeFontsSettings } from './HtmlAdobeFontsSettings';
import { HtmlAiProviderLogo } from './HtmlAiProviderLogo';
import { HtmlSearchConsoleSettings } from './HtmlSearchConsoleSettings';
import type { McpProjectConnectionSummary, McpStatusState } from './HtmlMcpSettingsContent';
import type { PublicationSnapshot } from './HtmlSnapshotPreview';
import { HtmlSettingsFieldGlyph, HtmlSettingsToggleControl, inferHtmlSettingsFieldKind } from './HtmlSettingsControls';
import { ProjectSettingsFieldControl } from './HtmlProjectSettingsFieldControl';
import { useHtmlProjectSettingsStore } from '@/stores/useHtmlProjectSettingsStore';
import type { HtmlLicenseSettings } from '@/lib/html-editor/license-settings';

const HtmlAgentSettings = lazy(() =>
  import('./HtmlAgentSettings').then(module => ({ default: module.HtmlAgentSettings })),
);
const HtmlSocialImageBuilder = lazy(() =>
  import('./HtmlSocialImageBuilder').then(module => ({
    default: module.HtmlSocialImageBuilder,
  })),
);
const HtmlCustomCodeSettings = lazy(() =>
  import('./HtmlCustomCodeSettings').then(module => ({
    default: module.HtmlCustomCodeSettings,
  })),
);
const HtmlCookieConsentSettings = lazy(() =>
  import('./HtmlCookieConsentSettings').then(module => ({
    default: module.HtmlCookieConsentSettings,
  })),
);
const HtmlRedirectSettings = lazy(() =>
  import('./HtmlRedirectSettings').then(module => ({
    default: module.HtmlRedirectSettings,
  })),
);
const HtmlSnapshotPreview = lazy(() =>
  import('./HtmlSnapshotPreview').then(module => ({
    default: module.HtmlSnapshotPreview,
  })),
);
const HtmlSitemapSettings = lazy(() =>
  import('./HtmlSitemapSettings').then(module => ({
    default: module.HtmlSitemapSettings,
  })),
);
const HtmlMcpSettingsContent = lazy(() =>
  import('./HtmlMcpSettingsContent').then(module => ({
    default: module.HtmlMcpSettingsContent,
  })),
);

export interface SettingsCmsField {
  key: string;
  label: string;
  type?: string;
  source?: string;
}
export interface SettingsCmsCollection {
  slug: string;
  name: string;
  restBase?: string;
  fields: SettingsCmsField[];
}

export interface SettingsWordPressConnection {
  product?: {
    edition: 'pro';
    licensed: boolean;
    licenseStatus?: string;
    licensePlan?: string;
    features: Record<string, boolean>;
    limits: Record<string, number | null>;
    upgradeUrl: string;
    licenseUrl: string;
  };
  statusUrl: string;
  settingsUrl: string;
  projectConnectionUrl?: string;
  nonce: string;
  enabled: boolean;
  studio?: {
    enabled?: boolean;
    studioOrigin?: string;
  } | null;
  canManageIntegrations?: boolean;
  storageUrl?: string;
  editorUrl?: string;
  dashboardUrl?: string;
  mediaUrl?: string;
  aiSettingsUrl?: string;
  aiGenerateUrl?: string;
  aiTestUrl?: string;
  adobeFontsLicensed?: boolean;
  adobeFontsUrl?: string;
  adobeFontsSettingsUrl?: string;
  adobeFontsSyncUrl?: string;
  searchConsoleUrl?: string;
  sitemapUrl?: string;
  metaCapiSettingsUrl?: string;
  metaCapiTestUrl?: string;
  shopifySettingsUrl?: string;
  shopifyConnectionTestUrl?: string;
  shopifyBuilderDataUrl?: string;
  shopifyDownloadKitUrl?: string;
  templatesUrl?: string;
  agentUrl?: string;
  agentNonce?: string;
}

interface AiSettingsState {
  provider: 'openai' | 'codex' | 'kimi' | 'openrouter' | 'custom';
  configured: boolean;
  configuredProviders?: Record<string, boolean>;
  model: string;
  baseUrl: string;
  temperature: number;
  language: string;
  tone: string;
  keyHint?: string;
}

const DEFAULT_AI_TEMPERATURE = 1;

function normalizeAiSettingsTemperature(settings: AiSettingsState): AiSettingsState {
  const temperature = typeof settings.temperature === 'number' ? settings.temperature : Number.NaN;
  return {
    ...settings,
    temperature:
      Number.isFinite(temperature) && temperature >= 0 && temperature <= 1.5
        ? temperature
        : DEFAULT_AI_TEMPERATURE,
  };
}

interface MetaCapiSettingsState {
  enabled: boolean;
  configured: boolean;
  pixelId: string;
  graphVersion: string;
  testEventCode: string;
  limitedDataUse: boolean;
  dataProcessingCountry: number;
  dataProcessingState: number;
  queuedEvents: number;
  lastResult?: {
    success: boolean;
    message: string;
    requestId?: string;
    httpStatus?: number;
    eventsReceived?: number;
    at?: string;
  } | null;
}

interface ShopifySettingsState {
  shopDomain: string;
  storefrontTokenType: 'public' | 'private';
  hasStorefrontToken: boolean;
  country: string;
  language: string;
  routes: Record<string, string>;
  templates: Record<string, string>;
  checkout: {
    provider: 'shopify' | 'appmax_shopify' | 'yampi' | 'cartpanda' | 'appmax' | 'custom';
    strategy: 'native' | 'link' | 'session';
    experience: 'redirect' | 'overlay';
    endpointUrl: string;
    linkTemplate: string;
    allowedHosts: string[];
    fallbackToShopify: boolean;
    openInNewTab: boolean;
    overlaySelector: string;
    returnPath: string;
    cancelPath: string;
    hasEndpointSecret: boolean;
  };
  apiVersion: string;
}

interface ShopifySyncState {
  configured: boolean;
  syncedAt?: string;
  productCount?: number;
  hasMoreProducts?: boolean;
  error?: string;
}

interface StorageManagementState {
  workspaceRevision: number;
  snapshots: {
    count: number;
    currentRelease: string;
    currentStored: boolean;
    items: PublicationSnapshot[];
  };
  project: {
    id: string;
    name: string;
    mode: 'single' | 'agency';
    isRoot: boolean;
    hasWorkspace: boolean;
    release: string;
  };
}

const AI_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT e modelos Codex',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-5.6-luna',
    models: [
      ['gpt-5.6-luna', 'GPT-5.6 Luna · rápido'],
      ['gpt-5.6-terra', 'GPT-5.6 Terra · equilibrado'],
      ['gpt-5.6-sol', 'GPT-5.6 Sol · máximo'],
      ['gpt-5.3-codex', 'GPT-5.3 Codex · código'],
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI para código',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-5.3-codex',
    models: [
      ['gpt-5.3-codex', 'GPT-5.3 Codex'],
      ['gpt-5.6-terra', 'GPT-5.6 Terra'],
    ],
  },
  {
    id: 'kimi',
    label: 'Kimi',
    description: 'Moonshot AI',
    endpoint: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
    models: [
      ['kimi-k2.6', 'Kimi K2.6'],
      ['kimi-k2.5', 'Kimi K2.5'],
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Centenas de modelos',
    endpoint: 'https://openrouter.ai/api/v1',
    model: '~openai/gpt-latest',
    models: [
      ['~openai/gpt-latest', 'OpenAI mais recente'],
      ['openrouter/auto', 'Roteamento automático'],
    ],
  },
  {
    id: 'custom',
    label: 'Personalizada',
    description: 'API compatível',
    endpoint: '',
    model: '',
    models: [],
  },
] as const;

const SHOPIFY_ROUTE_LABELS: Record<string, string> = {
  shop: 'Loja',
  product: 'Produto',
  collection: 'Coleção',
  cart: 'Carrinho',
  search: 'Busca',
  wishlist: 'Favoritos',
};

const SHOPIFY_CHECKOUT_PROVIDERS = [
  {
    id: 'shopify',
    label: 'Shopify Checkout',
    description: 'Checkout oficial retornado pelo carrinho da Storefront API.',
  },
  {
    id: 'appmax_shopify',
    label: 'Shopify + Appmax',
    description: 'Mantém o pedido no checkout Shopify e usa os meios de pagamento Appmax instalados na loja.',
  },
  {
    id: 'yampi',
    label: 'Yampi · conector',
    description:
      'Abre link Yampi criado pelo seu bridge; use o app oficial Yampi + Shopify para catálogo, estoque e pedidos.',
  },
  {
    id: 'cartpanda',
    label: 'CartPanda · link/conector',
    description:
      'Abre URL ou Link Bundler CartPanda; o conector oficial com Shopify é responsável por sincronizar pedidos.',
  },
  {
    id: 'appmax',
    label: 'Appmax API · avançado',
    description:
      'Usa um bridge server-to-server próprio. Tokenização e pagamento devem seguir o Appmax JS; sync de pedidos precisa ser implementado pelo conector.',
  },
  {
    id: 'custom',
    label: 'Checkout próprio · bridge',
    description:
      'Endpoint server-to-server ou link HTTPS compatível; o bridge assume criação, pagamento e reconciliação do pedido.',
  },
] as const;

export interface HtmlProjectSettingsProps {
  projectName: string;
  pages: string[];
  homePage: string;
  initialSection?: string;
  siteSettings: SiteSeoSettings;
  cookieConsent: CookieConsentSettings;
  customCode: CustomCodeSettings;
  redirects: RedirectSettings;
  pageSettings: Record<string, PageSeoSettings>;
  pageHtmlSources?: Record<string, string>;
  projectFiles?: Record<string, HtmlProjectFile>;
  loadProjectFile?: (path: string) => Promise<HtmlProjectFile | null>;
  onUploadProjectImage?: (file: File) => Promise<string>;
  projectRootPath?: string;
  hydratedFramerProject?: boolean;
  wordpress?: SettingsWordPressConnection;
  product?: SettingsWordPressConnection['product'];
  license?: HtmlLicenseSettings;
  settingsContent?: { mcp?: React.ReactNode; agents?: React.ReactNode };
  cmsCollections?: SettingsCmsCollection[];
  pageTemplates?: Record<string, string>;
  cmsItemsUrl?: string;
  cmsNonce?: string;
  onClose: () => void;
  onNavigate?: (href: string) => boolean | void | Promise<boolean | void>;
  standalone?: boolean;
  backHref?: string;
  readOnly?: boolean;
  onSaveSite: (settings: SiteSeoSettings) => void | Promise<void>;
  onSaveCookieConsent: (settings: CookieConsentSettings) => void | Promise<void>;
  onSaveCustomCode: (settings: CustomCodeSettings) => void | Promise<void>;
  onSaveRedirects: (settings: RedirectSettings) => void | Promise<void>;
  onSavePage: (path: string, settings: PageSeoSettings, nextPath?: string) => void | Promise<void>;
  onPrepareFontFile?: (fontFile: string) => Promise<string>;
}

type SettingsSaveScope = 'site' | 'cookie-consent' | 'custom-code' | 'redirects' | 'page' | 'media';
type SettingsSaveOrigin = 'auto' | 'manual';

interface SettingsSaveRequest {
  scope: SettingsSaveScope;
  /** Requests only replace pending work with the same explicit key. Omit for
   * dependency-sensitive transactions that must always reach the queue. */
  coalesceKey?: string;
  origin: SettingsSaveOrigin;
  signature: string;
  run: () => void | Promise<void>;
  onStart?: () => void;
  onSuccess?: () => void;
  onFailure?: () => void;
  failureMessage: string;
}

// Keep the two icon roles explicit: `sidebarIcon` is Solar Bold Duotone and
// belongs only to the information architecture; `icon` is Gravity stroke and
// is the only family rendered inside the selected section.
const SITE_SETTINGS_SECTIONS = [
  { id: 'general', label: 'Geral', icon: Settings2, sidebarIcon: SettingsMinimalisticIcon },
  { id: 'seo', label: 'SEO e descoberta', icon: SearchCheck, sidebarIcon: MinimalisticMagnifierIcon },
  { id: 'redirects', label: 'Redirects', icon: Route, sidebarIcon: SolarRouteIcon },
  { id: 'cookie-consent', label: 'Cookie Consent', icon: ShieldCheck, sidebarIcon: ShieldCheckIcon },
  { id: 'code', label: 'Custom Code', icon: Code2, sidebarIcon: SidebarCodeIcon },
  { id: 'mcp', label: 'Integrações e IA', icon: Bot, sidebarIcon: SolarBotIcon },
  { id: 'agents', label: 'Agentes', icon: Sparkles, sidebarIcon: StarsMinimalisticIcon },
  { id: 'storage', label: 'Armazenamento', icon: Archive, sidebarIcon: ArchiveMinimalisticIcon },
  { id: 'beta', label: 'Recursos experimentais', icon: AlertTriangle, sidebarIcon: DangerTriangleIcon },
] as const;
// Settings save only after the author has stopped typing. Manual Save still
// cancels this timer and persists immediately.
const SETTINGS_AUTOSAVE_IDLE_MS = 2000;

const CMS_SOCIAL_VARIABLE_ALIASES: Record<string, string> = {
  title: 'page.title',
  excerpt: 'page.excerpt',
  content: 'page.content',
  featured_image: 'page.featured_image',
  featured_image_alt: 'page.featured_image_alt',
  permalink: 'page.url',
  date: 'page.date',
  author: 'author.name',
  slug: 'page.slug',
};

const SCHEMA_TYPES: Array<[SeoSchemaType, string]> = [
  ['WebPage', 'Página'],
  ['AboutPage', 'Sobre'],
  ['ContactPage', 'Contato'],
  ['Article', 'Artigo'],
  ['BlogPosting', 'Post de blog'],
  ['NewsArticle', 'Notícia'],
  ['Product', 'Produto'],
  ['FAQPage', 'FAQ'],
  ['Event', 'Evento'],
  ['Service', 'Serviço'],
  ['LocalBusiness', 'Negócio local'],
  ['SoftwareApplication', 'Software'],
  ['Course', 'Curso'],
  ['Recipe', 'Receita'],
  ['JobPosting', 'Vaga'],
  ['Person', 'Pessoa'],
  ['Organization', 'Organização'],
  ['none', 'Sem dados estruturados'],
];

const CMS_SCHEMA_STANDARD_FIELDS: SettingsCmsField[] = [
  { key: 'title', label: 'Título', type: 'text' },
  { key: 'excerpt', label: 'Resumo', type: 'textarea' },
  { key: 'content', label: 'Conteúdo', type: 'richtext' },
  { key: 'featured_image', label: 'Imagem destacada', type: 'image' },
  { key: 'featured_image_alt', label: 'Texto alternativo', type: 'text' },
  { key: 'permalink', label: 'URL permanente', type: 'url' },
  { key: 'date', label: 'Data', type: 'date' },
  { key: 'author', label: 'Autor', type: 'text' },
  { key: 'slug', label: 'Slug', type: 'text' },
];

function cmsSocialVariableKey(fieldKey: string) {
  return CMS_SOCIAL_VARIABLE_ALIASES[fieldKey] || `field:${fieldKey}`;
}

function summarizeHtmlForAi(html: string): string {
  if (!html.trim() || typeof DOMParser === 'undefined') return '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, style, noscript, svg, template').forEach(node => node.remove());
  const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
  const sections: string[] = [];
  const title = clean(document.querySelector('title')?.textContent);
  const description = clean(document.querySelector('meta[name="description"]')?.getAttribute('content'));
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(node => clean(node.textContent))
    .filter(Boolean)
    .slice(0, 16);
  const copy = Array.from(document.querySelectorAll('main p, main li, article p, article li, body p'))
    .map(node => clean(node.textContent))
    .filter(value => value.length >= 24)
    .slice(0, 24);
  const actions = Array.from(document.querySelectorAll('a, button'))
    .map(node => clean(node.textContent))
    .filter(Boolean)
    .slice(0, 12);
  if (title) sections.push(`Título atual: ${title}`);
  if (description) sections.push(`Descrição atual: ${description}`);
  if (headings.length) sections.push(`Títulos e seções:\n- ${headings.join('\n- ')}`);
  if (copy.length) sections.push(`Conteúdo visível:\n- ${copy.join('\n- ')}`);
  if (actions.length) sections.push(`Ações e links: ${actions.join(' · ')}`);
  return sections.join('\n\n').slice(0, 12000);
}

function cmsItemsEndpoint(base: string, postType: string) {
  const url = new URL(base, window.location.href);
  const suffix = `/${encodeURIComponent(postType)}`;
  const route = url.searchParams.get('rest_route');
  if (route) url.searchParams.set('rest_route', `${route.replace(/\/$/, '')}${suffix}`);
  else url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`;
  url.searchParams.set('per_page', '1');
  return url.toString();
}

function CmsBindingInput({
  value,
  onChange,
  fields,
  multiline = false,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  fields: SettingsCmsField[];
  multiline?: boolean;
  placeholder?: string;
}) {
  const bindings = Array.from(value.matchAll(/\{\{([^{}]+)\}\}/g)).map(match => match[1]);
  const control = multiline ? (
    <Textarea
      value={value}
      onChange={event => onChange(event.target.value)}
      className="min-h-24 pr-28"
      placeholder={placeholder}
    />
  ) : (
    <Input value={value} onChange={event => onChange(event.target.value)} className="pr-28" placeholder={placeholder} />
  );
  return (
    <div className="space-y-2">
      <div className="relative">
        <ProjectSettingsFieldControl label="Conteúdo CMS">{control}</ProjectSettingsFieldControl>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              className="absolute right-1.5 top-1.5 gap-1 text-[10px]"
            >
              <Braces className="size-3" /> Dados CMS
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-auto">
            <DropdownMenuLabel>Inserir valor da collection</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {fields.map(field => (
              <DropdownMenuItem
                key={field.key}
                onClick={() => onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${cmsSeoToken(field.key)}`)}
              >
                <Database className="size-3.5 text-[var(--kodety-accent-hover)]" />
                <span className="min-w-0 flex-1 truncate">{field.label}</span>
                <span className="text-[9px] text-muted-foreground">{field.type || 'texto'}</span>
              </DropdownMenuItem>
            ))}
            {bindings.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-400"
                  onClick={() => onChange(value.replace(/\s*\{\{[^{}]+\}\}\s*/g, ' ').trim())}
                >
                  <Unlink /> Remover dados dinâmicos
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {bindings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bindings.map((binding, index) => {
            const field = fields.find(item => item.key === binding);
            return (
              <span
                key={`${binding}-${index}`}
                className="inline-flex items-center gap-1 rounded-[9px] border border-[var(--kodety-accent)]/20 bg-[var(--kodety-accent)]/10 px-2 py-1 text-[10px] text-[var(--kodety-accent-hover)]"
              >
                <Database className="size-3" />
                {field?.label || binding}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FieldTip({ children }: { children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-[7px] text-muted-foreground outline-none transition-colors hover:bg-white/[.045] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]/70"
          aria-label={children}
        >
          <CircleHelp className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs leading-5">{children}</TooltipContent>
    </Tooltip>
  );
}

function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="py-1.5">
      <HtmlSettingsToggleControl label={title} description={description} checked={checked} onChange={onCheckedChange} />
    </div>
  );
}

function Field({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-[11px] font-medium">{label}</Label>
        {tip && <FieldTip>{tip}</FieldTip>}
      </div>
      <ProjectSettingsFieldControl label={label}>{children}</ProjectSettingsFieldControl>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
  className = '',
  collapsible = false,
  defaultOpen = true,
  forceOpen = false,
  collapseId,
  onboardingId,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  collapseId?: string;
  onboardingId?: string;
}) {
  const storageKey = `kodety-settings-section:${collapseId || title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const [open, setOpen] = useState(() => {
    if (!collapsible || typeof window === 'undefined') return defaultOpen;
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      return stored === null ? defaultOpen : stored === 'open';
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    if (!collapsible || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(storageKey, open ? 'open' : 'closed');
    } catch {
      // Storage can be unavailable in privacy-restricted embeds. The section
      // still works; it simply returns to its default state next time.
    }
  }, [collapsible, open, storageKey]);

  useEffect(() => {
    if (!collapsible || !collapseId || typeof window === 'undefined') return;
    const focusHashTarget = () => {
      if (window.location.hash !== `#${collapseId}`) return;
      setOpen(true);
      window.requestAnimationFrame(() => {
        document.getElementById(collapseId)?.scrollIntoView({ block: 'start' });
      });
    };
    focusHashTarget();
    window.addEventListener('hashchange', focusHashTarget);
    return () => window.removeEventListener('hashchange', focusHashTarget);
  }, [collapseId, collapsible]);

  const expanded = forceOpen || open;
  const sectionKind = inferHtmlSettingsFieldKind(`${title} ${description || ''}`);

  if (collapsible) {
    return (
      <section id={collapseId} data-kodety-onboarding={expanded ? onboardingId : undefined} className={`scroll-mt-4 border-t border-[var(--kodety-divider)] ${className}`}>
        <button
          type="button"
          data-kodety-onboarding={onboardingId ? `${onboardingId}-disclosure` : undefined}
          data-kodety-onboarding-reveal={onboardingId && !forceOpen ? '' : undefined}
          data-kodety-onboarding-toggle={onboardingId && !forceOpen ? '' : undefined}
          className="group relative flex w-full items-start justify-between gap-3 py-4 text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]/70"
          aria-expanded={expanded}
          onClick={() => {
            if (!forceOpen) setOpen(current => !current);
          }}
        >
          <span className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/35 transition-colors group-hover:text-white/60">
              <HtmlSettingsFieldGlyph kind={sectionKind} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">{title}</span>
              {description && (
                <span
                  data-kodety-settings-description
                  className="mt-1 block max-w-2xl text-balance text-[11px] leading-[1.5] text-muted-foreground"
                >
                  {description}
                </span>
              )}
            </span>
          </span>
          <DisclosureChevron expanded={expanded} className="mt-2 text-muted-foreground" />
        </button>
        {expanded && <div className="pb-5">{children}</div>}
      </section>
    );
  }

  return (
    <section data-kodety-onboarding={onboardingId} className={`border-t border-[var(--kodety-divider)] ${className}`}>
      <div className="grid gap-4 py-5 md:grid-cols-[minmax(148px,0.3fr)_minmax(0,1fr)] md:gap-8 lg:gap-10">
        <div className="flex min-w-0 flex-col items-start md:pt-0.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/35">
            <HtmlSettingsFieldGlyph kind={sectionKind} />
          </span>
          <div className="mt-3 min-w-0">
            <h2 className="text-xs font-semibold text-foreground">{title}</h2>
            {description && (
              <p
                data-kodety-settings-description
                className="mt-1.5 max-w-52 text-balance text-[11px] leading-[1.5] text-muted-foreground"
              >
                {description}
              </p>
            )}
          </div>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function LicenseFeatureGate({ children }: {
  locked: boolean; title: string; description: string; licenseUrl?: string;
  upgradeUrl?: string; onActivate?: () => void; children: React.ReactNode;
}) {
  return <>{children}</>;
}

function LicenseSettingsContent({ english }: { license: HtmlLicenseSettings; english: boolean }) {
  return <SettingsHeader eyebrow="Onun Kodety" title={english ? 'Open source' : 'Código aberto'}
    description={english ? 'All editor features are included under GPL-3.0-only.' : 'Todos os recursos do editor estão incluídos sob GPL-3.0-only.'} />;
}

function SettingsField({
  label,
  tip,
  description,
  children,
  onboardingId,
}: {
  label: string;
  tip?: string;
  description?: string;
  children: React.ReactNode;
  onboardingId?: string;
}) {
  return (
    <div data-kodety-onboarding={onboardingId} className="grid gap-1.5 border-t border-[var(--kodety-divider)] py-3 first:border-t-0 md:grid-cols-[minmax(154px,0.4fr)_minmax(0,1fr)] md:gap-5">
      <div className="min-w-0 pt-1.5">
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] font-medium">{label}</Label>
          {tip && <FieldTip>{tip}</FieldTip>}
        </div>
        {description && (
          <p
            data-kodety-settings-description
            className="mt-0.5 text-balance text-[10px] leading-[1.45] text-muted-foreground [overflow-wrap:anywhere]"
          >
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">
        <ProjectSettingsFieldControl label={label}>{children}</ProjectSettingsFieldControl>
      </div>
    </div>
  );
}

function SettingsHeader({
  eyebrow,
  eyebrowDetail,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  eyebrowDetail?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  const matchedSection = SITE_SETTINGS_SECTIONS.find(item => item.label === title);
  const HeaderIcon = eyebrow.startsWith('Page Settings') ? FileCode2 : matchedSection?.icon || null;
  return (
    <header className="flex min-h-24 flex-col justify-end gap-3 border-b border-[var(--kodety-divider)] pb-5 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-muted-foreground">
          <span>{eyebrow}</span>
          {eyebrowDetail && <> · <span data-kodety-no-i18n>{eyebrowDetail}</span></>}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {HeaderIcon && (
            <HeaderIcon aria-hidden="true" className="size-4 shrink-0 text-[var(--kodety-text-tertiary)]" />
          )}
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-[-0.015em]">{title}</h1>
        </div>
        <p
          data-kodety-settings-description
          className="mt-1 max-w-2xl text-balance text-xs leading-5 text-muted-foreground"
        >
          {description}
        </p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </header>
  );
}

function SeoScoreMeter({ score }: { score: number }) {
  const boundedScore = Math.max(0, Math.min(100, score));
  const tone =
    boundedScore >= 80 ? 'text-emerald-400' : boundedScore >= 50 ? 'text-amber-400' : 'text-muted-foreground';
  const fill = boundedScore >= 80 ? 'bg-emerald-400' : boundedScore >= 50 ? 'bg-amber-400' : 'bg-white/35';

  return (
    <div
      role="meter"
      aria-label={`Pontuação SEO: ${boundedScore}%`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedScore}
      className="flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-white/[.045] bg-white/[.035] px-2.5"
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
        SEO
      </span>
      <span aria-hidden="true" className="h-1 w-8 overflow-hidden rounded-full bg-white/[.08]">
        <span
          className={`block h-full rounded-full transition-[width] ${fill}`}
          style={{ width: `${boundedScore}%` }}
        />
      </span>
      <span className={`min-w-7 text-right text-[10px] font-semibold tabular-nums ${tone}`}>{boundedScore}%</span>
    </div>
  );
}

function SaveBar({
  host,
  dirty,
  label,
  onSave,
  saving = false,
  error,
}: {
  host: HTMLElement | null;
  dirty: boolean;
  label: string;
  onSave: () => void | Promise<void>;
  saving?: boolean;
  error?: string;
}) {
  if (!host) return null;
  return createPortal(
    <div data-kodety-onboarding="settings-save" className="pointer-events-auto flex min-h-14 w-full items-center justify-between gap-4 border-t border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)] px-4 py-2.5 sm:px-7 lg:px-8">
      <div className="min-w-0">
        <p className={`flex items-center gap-2 text-[11px] ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
          <span
            className={`size-1.5 shrink-0 rounded-full ${error ? 'bg-destructive' : dirty ? 'bg-amber-400' : 'bg-emerald-400'}`}
          />
          <span className="truncate">{error || (dirty ? 'Alterações não salvas' : 'Tudo salvo')}</span>
        </p>
      </div>
      <Button size="sm" onClick={() => void onSave()} disabled={saving || !dirty || Boolean(error)} aria-busy={saving}>
        {saving && <Loader2 className="animate-spin" />}
        {label}
      </Button>
    </div>,
    host,
  );
}

function AnalyticsIntegration({
  name,
  description,
  value,
  placeholder,
  valid,
  onChange,
}: {
  name: string;
  description: string;
  value: string;
  placeholder: string;
  valid: (value: string) => boolean;
  onChange: (value: string) => void;
}) {
  const configured = Boolean(value.trim());
  const isValid = !configured || valid(value.trim());
  return (
    <div className="grid gap-2 border-t border-[var(--kodety-divider)] py-3 first:border-t-0 md:grid-cols-[minmax(154px,0.4fr)_minmax(0,1fr)] md:items-center md:gap-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium">{name}</h3>
          {configured && (
            <span className={`text-[10px] ${isValid ? 'text-emerald-400' : 'text-destructive'}`}>
              {isValid ? 'Configurado' : 'ID inválido'}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[10px] leading-[1.45] text-muted-foreground">{description}</p>
      </div>
      <ProjectSettingsFieldControl label={`${name} tracking`}>
        <Input
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={!isValid}
          className={`font-mono text-xs ${configured && !isValid ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
        />
      </ProjectSettingsFieldControl>
    </div>
  );
}

interface WordPressMediaItem {
  id: number | string;
  source_url: string;
  alt_text?: string;
  title?: { rendered?: string };
  media_details?: {
    sizes?: {
      thumbnail?: { source_url?: string };
      medium?: { source_url?: string };
    };
  };
}

function useSettingsImagePreview(
  value: string,
  projectFiles: Record<string, HtmlProjectFile> | undefined,
  referencePath: string,
  projectRootPath: string,
  publicBaseUrl: string,
  loadProjectFile?: (path: string) => Promise<HtmlProjectFile | null>,
) {
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => {
    const raw = value.trim().replaceAll('&amp;', '&');
    if (!raw || raw.includes('{{')) {
      setPreviewUrl('');
      return;
    }
    if (/^(?:https?:|data:|blob:)/i.test(raw)) {
      setPreviewUrl(raw);
      return;
    }
    if (raw.startsWith('//')) {
      setPreviewUrl(`${window.location.protocol}${raw}`);
      return;
    }

    const resolvedPath = resolveProjectPath(referencePath || 'index.html', raw, projectRootPath || '');
    const cleanPath = raw.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
    const file =
      (resolvedPath ? projectFiles?.[resolvedPath] : undefined) ||
      projectFiles?.[cleanPath] ||
      Object.values(projectFiles || {}).find(candidate => candidate.path === cleanPath);
    if (file && (file.data || file.text !== undefined)) {
      const body = file.data ? new Uint8Array(file.data) : file.text || '';
      const objectUrl = URL.createObjectURL(new Blob([body], { type: file.mimeType || 'application/octet-stream' }));
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }

    if (file && loadProjectFile) {
      let cancelled = false;
      let objectUrl = '';
      setPreviewUrl('');
      void loadProjectFile(file.path).then(loaded => {
        if (cancelled || !loaded || (loaded.data === undefined && loaded.text === undefined)) return;
        const body = loaded.data ? new Uint8Array(loaded.data) : loaded.text || '';
        objectUrl = URL.createObjectURL(new Blob([body], { type: loaded.mimeType || 'application/octet-stream' }));
        setPreviewUrl(objectUrl);
      }).catch(() => { if (!cancelled) setPreviewUrl(''); });
      return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }

    try {
      setPreviewUrl(new URL(raw, publicBaseUrl.trim() || window.location.origin).toString());
    } catch {
      setPreviewUrl(raw);
    }
  }, [loadProjectFile, projectFiles, projectRootPath, publicBaseUrl, referencePath, value]);
  return previewUrl;
}

function ProportionalSocialImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} indisponível`}
        className="flex min-h-24 w-full flex-col items-center justify-center gap-1.5 bg-black/20 px-4 py-6 text-center text-muted-foreground"
      >
        <ImageIcon aria-hidden="true" className="size-5" />
        <span className="text-[10px]">Não foi possível carregar esta imagem.</span>
      </div>
    );
  }

  return (
    <div className="relative w-full bg-black/20">
      {!loaded && (
        <div aria-hidden="true" className="flex min-h-24 w-full items-center justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className="block h-auto w-full max-w-full"
        style={loaded ? undefined : { position: 'absolute', inset: 0, visibility: 'hidden' }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function SocialImageTemplateThumbnail({ template, className }: { template?: SocialImageTemplate; className: string }) {
  const background = template
    ? template.background.gradient.enabled
      ? `linear-gradient(${template.background.gradient.angle}deg, ${template.background.gradient.from}, ${template.background.gradient.to})`
      : template.background.color
    : 'rgb(255 255 255 / 0.065)';

  return (
    <div
      aria-hidden="true"
      className={`grid shrink-0 place-items-center overflow-hidden rounded-[7px] border border-white/[.065] text-white/32 ${className}`}
      style={{ background }}
    >
      <ImageIcon className="size-4" />
    </div>
  );
}

function SettingsMediaThumbnail({ item, projectFiles, projectRootPath, referencePath, publicBaseUrl, loadProjectFile }: {
  item: WordPressMediaItem;
  projectFiles?: Record<string, HtmlProjectFile>;
  projectRootPath: string;
  referencePath: string;
  publicBaseUrl: string;
  loadProjectFile?: (path: string) => Promise<HtmlProjectFile | null>;
}) {
  const source = item.media_details?.sizes?.medium?.source_url || item.media_details?.sizes?.thumbnail?.source_url || item.source_url;
  const preview = useSettingsImagePreview(source, projectFiles, referencePath, projectRootPath, publicBaseUrl, loadProjectFile);
  return preview ? <img src={preview} alt={item.alt_text || ''} loading="lazy" className="block h-auto max-h-full w-auto max-w-full object-contain" /> : <ImageIcon className="size-5 text-muted-foreground" />;
}

function SettingsMediaPicker({
  value,
  onChange,
  connection,
  fallbackPlaceholder,
  mode = 'social',
  themeLabel,
  projectFiles,
  projectRootPath = '',
  referencePath = 'index.html',
  publicBaseUrl = '',
  loadProjectFile,
  onUploadProjectImage,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  connection?: SettingsWordPressConnection;
  fallbackPlaceholder: string;
  mode?: 'social' | 'favicon';
  themeLabel?: string;
  projectFiles?: Record<string, HtmlProjectFile>;
  projectRootPath?: string;
  referencePath?: string;
  publicBaseUrl?: string;
  loadProjectFile?: (path: string) => Promise<HtmlProjectFile | null>;
  onUploadProjectImage?: (file: File) => Promise<string>;
  disabled?: boolean;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WordPressMediaItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const previewUrl = useSettingsImagePreview(value, projectFiles, referencePath, projectRootPath, publicBaseUrl, loadProjectFile);
  const localLibrary = !connection?.mediaUrl;
  const canUpload = Boolean(connection?.mediaUrl || onUploadProjectImage);
  const localItems = useMemo<WordPressMediaItem[]>(() => Object.values(projectFiles || {})
    .filter(file => isSettingsImageFile(file) && file.path.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(file => ({ id: file.path, source_url: settingsImageAssetUrl(file.path, projectRootPath), title: { rendered: file.path.split('/').at(-1) || file.path } })), [projectFiles, projectRootPath, search]);
  const visibleItems = localLibrary ? localItems : items;
  useEffect(() => { if (open) setImageUrl(value); }, [open, value]);

  useEffect(() => {
    if (!open || !connection?.mediaUrl) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const endpoint = new URL(connection.mediaUrl!, window.location.href);
      endpoint.searchParams.set('media_type', 'image');
      endpoint.searchParams.set('per_page', '48');
      endpoint.searchParams.set('orderby', 'date');
      endpoint.searchParams.set('order', 'desc');
      if (search.trim()) endpoint.searchParams.set('search', search.trim());
      setLoading(true);
      fetch(endpoint, {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': connection.nonce },
        signal: controller.signal,
      })
        .then(response =>
          response.ok ? response.json() : Promise.reject(new Error('Não foi possível abrir a Biblioteca de Mídia.')),
        )
        .then((media: WordPressMediaItem[]) => setItems(media))
        .catch(error => {
          if (!(error instanceof DOMException && error.name === 'AbortError'))
            toast.error(error instanceof Error ? error.message : 'Biblioteca indisponível.');
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [connection?.mediaUrl, connection?.nonce, open, search]);

  const upload = async (file?: File) => {
    if (!file || !canUpload || uploading || disabled) return;
    setUploading(true);
    try {
      if (localLibrary && onUploadProjectImage) {
        const path = await onUploadProjectImage(file);
        onChange(settingsImageAssetUrl(path, projectRootPath));
        setOpen(false);
        toast.success('Imagem enviada e selecionada.');
        return;
      }
      const body = new FormData();
      body.append('file', file, file.name);
      body.append('title', file.name.replace(/\.[^.]+$/, ''));
      const response = await fetch(connection!.mediaUrl!, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': connection!.nonce },
        body,
      });
      const media = (await response.json()) as WordPressMediaItem & {
        message?: string;
      };
      if (!response.ok || !media.source_url) throw new Error(media.message || 'Não foi possível enviar a imagem.');
      onChange(media.source_url);
      setItems(current => [media, ...current.filter(item => item.id !== media.id)]);
      setOpen(false);
      toast.success('Imagem enviada e selecionada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao enviar imagem.');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  return (
    <>
      <div
        data-kodety-settings-control
        className="overflow-hidden rounded-[9px] border border-transparent bg-white/[.045] transition-[border-color,background-color] hover:bg-white/[.055] focus-within:border-[var(--kodety-focus)]/70"
      >
        {value ? (
          <div
            className={
              mode === 'favicon'
                ? `relative flex h-28 items-center justify-center overflow-hidden ${themeLabel === 'Dark' ? 'bg-[#090b0e]' : 'bg-white'}`
                : 'relative w-full overflow-hidden bg-black/20'
            }
          >
            {mode === 'favicon' ? (
              <span className="flex size-14 items-center justify-center">
                <img
                  src={previewUrl || value}
                  alt={`Prévia do favicon ${themeLabel || ''}`}
                  className="size-9 object-contain"
                />
              </span>
            ) : (
              <ProportionalSocialImage src={previewUrl || value} alt="Prévia da imagem social" />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-2 top-2 bg-background/75 backdrop-blur"
              disabled={disabled || uploading}
              onClick={() => onChange('')}
              aria-label="Remover imagem"
            >
              <X />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => setOpen(true)}
            className={`flex h-24 w-full flex-col items-center justify-center gap-1.5 text-muted-foreground outline-none transition-colors focus-visible:ring-0 ${
              mode === 'favicon'
                ? themeLabel === 'Dark'
                  ? 'bg-[#090b0e] hover:bg-[#0c0f13] hover:text-foreground'
                  : 'bg-white text-black/50 hover:bg-white hover:text-black/70'
                : 'hover:bg-white/[.035] hover:text-foreground'
            }`}
          >
            <ImageIcon className="size-4" />
            <span className="text-[11px]">{mode === 'favicon' ? 'Selecionar favicon' : 'Escolher imagem social'}</span>
          </button>
        )}
        <div className="flex min-h-10 items-center gap-1 border-t border-white/[.055] pr-2">
          <span className="mr-1 grid min-h-10 w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.06] text-white/30">
            <ImageIcon className="size-3.5" />
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={disabled || uploading} onClick={() => setOpen(true)}>
            <ImageIcon /> {value ? 'Trocar' : 'Biblioteca'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || uploading || !canUpload}
            onClick={() => uploadRef.current?.click()}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Enviar
          </Button>
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              void upload(event.target.files?.[0]);
            }}
          />
          {value && (
            <span className="ml-auto max-w-48 truncate px-1 text-[10px] text-muted-foreground" title={value}>
              {themeLabel || (localLibrary ? 'Arquivos do projeto' : 'Biblioteca do WordPress')}
            </span>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={next => { if (!uploading) setOpen(next); }}>
        <DialogContent
          data-kodety-project-settings
          className="flex h-[min(76vh,720px)] max-w-4xl flex-col overflow-hidden p-0"
        >
          <div className="border-b border-[var(--kodety-divider)] px-5 py-4">
            <DialogTitle>Biblioteca de Mídia</DialogTitle>
            <DialogDescription>{localLibrary ? 'Escolha uma imagem do projeto ou envie uma nova para a pasta do site.' : 'Escolha uma imagem existente ou envie uma nova para o WordPress.'}</DialogDescription>
            <div className="mt-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <ProjectSettingsFieldControl label="Buscar imagens">
                  <Input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Buscar imagens…"
                  />
                </ProjectSettingsFieldControl>
              </div>
              <Button type="button" onClick={() => uploadRef.current?.click()} disabled={disabled || uploading || !canUpload}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Enviar imagem
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!localLibrary && loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 animate-spin" /> Carregando biblioteca…
              </div>
            ) : visibleItems.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {visibleItems.map(item => {
                  return (
                    <button
                      type="button"
                      key={item.id}
                      disabled={disabled || uploading}
                      onClick={() => {
                        onChange(item.source_url);
                        setOpen(false);
                      }}
                      className="group overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.025] text-left outline-none transition-[border-color,background-color] hover:border-white/[.09] hover:bg-white/[.04] focus-visible:border-[var(--kodety-focus)]/70"
                    >
                      <div className="flex aspect-square items-center justify-center overflow-hidden bg-black/20">
                        <SettingsMediaThumbnail item={item} projectFiles={projectFiles} projectRootPath={projectRootPath} referencePath={referencePath} publicBaseUrl={publicBaseUrl} loadProjectFile={loadProjectFile} />
                      </div>
                      <p className="truncate px-2 py-1.5 text-[10px]">{item.title?.rendered || `Imagem #${item.id}`}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageIcon className="size-8" />
                <p className="text-sm">Nenhuma imagem encontrada.</p>
              </div>
            )}
          </div>
          <div className="flex items-end gap-2 border-t border-[var(--kodety-divider)] px-5 py-4">
            <div className="min-w-0 flex-1">
              <ProjectSettingsFieldControl label="URL ou caminho da imagem">
                <Input value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder={fallbackPlaceholder} disabled={disabled || uploading} />
              </ProjectSettingsFieldControl>
            </div>
            <Button type="button" variant="secondary" disabled={disabled || uploading || !imageUrl.trim()} onClick={() => {
              const next = imageUrl.trim();
              if (/^[a-z][a-z\d+.-]*:/i.test(next) && !/^(?:https?:|data:image\/)/i.test(next)) {
                toast.error('Use o caminho de uma imagem do projeto ou uma URL HTTP/HTTPS.');
                return;
              }
              onChange(next);
              setOpen(false);
            }}>Usar imagem</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function pageLabel(path: string, homePage: string) {
  if (path === homePage) return 'Home';
  return (
    path
      .split('/')
      .pop()
      ?.replace(/\.html?$/i, '') || path
  );
}

function urlError(value: string, label: string, allowRelative = false) {
  const normalized = value.trim();
  if (!normalized || normalized.includes('{{')) return '';
  try {
    const parsed = new URL(normalized, allowRelative ? 'https://example.invalid' : undefined);
    if (!['http:', 'https:'].includes(parsed.protocol)) return `${label} deve usar http ou https.`;
    if (!allowRelative && !/^https?:\/\//i.test(normalized)) return `${label} deve ser uma URL completa.`;
    return '';
  } catch {
    return `${label} inválida.`;
  }
}

export function HtmlProjectSettingsBridge(props: HtmlProjectSettingsProps) {
  const ownerId = useId();
  useLayoutEffect(() => {
    useHtmlProjectSettingsStore.getState().publish(ownerId, props);
  });
  useEffect(
    () => () => {
    useHtmlProjectSettingsStore.getState().resetOwner(ownerId);
    },
    [ownerId],
  );
  return <HtmlProjectSettings />;
}

export const HtmlProjectSettings = memo(function HtmlProjectSettings() {
  const model = useHtmlProjectSettingsStore(state => state.model);
  if (!model) return null;
  return <HtmlProjectSettingsContent {...model} />;
});

function HtmlProjectSettingsContent({
  projectName,
  pages,
  homePage,
  initialSection,
  siteSettings,
  cookieConsent,
  customCode,
  redirects,
  pageSettings,
  pageHtmlSources = {},
  projectFiles,
  loadProjectFile,
  onUploadProjectImage,
  projectRootPath = '',
  hydratedFramerProject = false,
  wordpress,
  product,
  license,
  settingsContent,
  cmsCollections = [],
  pageTemplates = {},
  cmsItemsUrl,
  cmsNonce,
  onClose,
  onNavigate,
  standalone = false,
  backHref,
  readOnly = false,
  onSaveSite,
  onSaveCookieConsent,
  onSaveCustomCode,
  onSaveRedirects,
  onSavePage,
  onPrepareFontFile,
}: HtmlProjectSettingsProps) {
  const englishUi = getAdminUiLocale().toLowerCase().startsWith('en');
  const [section, setSection] = useState(initialSection || 'general');
  const [saveBarHost, setSaveBarHost] = useState<HTMLDivElement | null>(null);
  const {
    draft: siteDraft,
    setDraft: setSiteDraft,
    draftSignature: siteDraftSignature,
    dirty: siteDirty,
    isSavedSignature: isSiteSavedSignature,
    saveLifecycle: siteSaveLifecycle,
  } = useCanonicalSettingsDraft(siteSettings);
  const normalizedCookieConsent = useMemo(
    () => normalizeCookieConsentSettings(cookieConsent || DEFAULT_COOKIE_CONSENT_SETTINGS),
    [cookieConsent],
  );
  const {
    draft: cookieConsentDraft,
    setDraft: setCookieConsentDraft,
    draftSignature: cookieConsentDraftSignature,
    dirty: cookieConsentDirty,
    isSavedSignature: isCookieConsentSavedSignature,
    saveLifecycle: cookieConsentSaveLifecycle,
  } = useCanonicalSettingsDraft(normalizedCookieConsent);
  const normalizedCustomCode = useMemo(
    () => normalizeCustomCodeSettings(customCode || DEFAULT_CUSTOM_CODE_SETTINGS),
    [customCode],
  );
  const {
    draft: customCodeDraft,
    setDraft: setCustomCodeDraft,
    draftSignature: customCodeDraftSignature,
    dirty: customCodeDirty,
    isSavedSignature: isCustomCodeSavedSignature,
    saveLifecycle: customCodeSaveLifecycle,
  } = useCanonicalSettingsDraft(normalizedCustomCode);
  const normalizedRedirects = useMemo(
    () => normalizeRedirectSettings(redirects || DEFAULT_REDIRECT_SETTINGS),
    [redirects],
  );
  const {
    draft: redirectDraft,
    setDraft: setRedirectDraft,
    draftSignature: redirectDraftSignature,
    dirty: redirectDirty,
    isSavedSignature: isRedirectSavedSignature,
    saveLifecycle: redirectSaveLifecycle,
  } = useCanonicalSettingsDraft(normalizedRedirects);
  const selectedPage = pages.includes(section) ? section : '';
  const [pageDraft, setPageDraft] = useState<PageSeoSettings>(() =>
    selectedPage ? pageSettings[selectedPage] || {} : {},
  );
  const [pagePath, setPagePath] = useState(selectedPage);
  const canonicalPageDraft = useMemo(
    () =>
      selectedPage
        ? {
            selectedPage,
            pagePath: selectedPage,
            settings: pageSettings[selectedPage] || {},
          }
        : null,
    [pageSettings, selectedPage],
  );
  const {
    savedSignature: pageSavedSignature,
    isSavedSignature: isPageSavedSignature,
    saveLifecycle: pageSaveLifecycle,
  } =
    useCanonicalSettingsDraft(canonicalPageDraft);
  const [socialImageBuilderTarget, setSocialImageBuilderTarget] = useState<'site' | 'page' | null>(null);
  const [socialImageBuilderTemplate, setSocialImageBuilderTemplate] = useState<SocialImageTemplate | undefined>();
  const [mcpStatus, setMcpStatus] = useState<McpStatusState | null>(wordpress ? { enabled: wordpress.enabled } : null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpCommand, setMcpCommand] = useState('');
  const [mcpRemoteConfig, setMcpRemoteConfig] = useState('');
  const [mcpProjectConnections, setMcpProjectConnections] = useState<McpProjectConnectionSummary[]>([]);
  const [mcpProjectConnectionsLoading, setMcpProjectConnectionsLoading] = useState(false);
  const [mcpProjectConnectionsError, setMcpProjectConnectionsError] = useState('');
  const [mcpRevokingProjectConnectionId, setMcpRevokingProjectConnectionId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettingsState>({
    provider: 'openai',
    configured: false,
    model: 'gpt-5.6-luna',
    baseUrl: 'https://api.openai.com/v1',
    temperature: DEFAULT_AI_TEMPERATURE,
    language: 'Português do Brasil',
    tone: 'claro, humano e profissional',
  });
  const [aiKey, setAiKey] = useState('');
  const aiCanonicalRef = useRef(aiSettings);
  const [aiLoading, setAiLoading] = useState(false);
  const [shopifySettings, setShopifySettings] = useState<ShopifySettingsState | null>(null);
  const [shopifyStorefrontToken, setShopifyStorefrontToken] = useState('');
  const [shopifyCheckoutSecret, setShopifyCheckoutSecret] = useState('');
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyTesting, setShopifyTesting] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifySync, setShopifySync] = useState<ShopifySyncState | null>(null);
  const [metaCapi, setMetaCapi] = useState<MetaCapiSettingsState>({
    enabled: false,
    configured: false,
    pixelId: '',
    graphVersion: 'v23.0',
    testEventCode: '',
    limitedDataUse: false,
    dataProcessingCountry: 0,
    dataProcessingState: 0,
    queuedEvents: 0,
    lastResult: null,
  });
  const [metaCapiToken, setMetaCapiToken] = useState('');
  const metaCapiCanonicalRef = useRef(metaCapi);
  useEffect(() => {
    const updateNativeSettings = (event: Event) => {
      const { operation, result } = (event as CustomEvent<{ operation: AgentNativeOperation; result: unknown }>).detail || {};
      if (!operation || !result || typeof result !== 'object') return;
      if (operation.name === 'ai_settings_update') {
        const remote = normalizeAiSettingsTemperature(result as AiSettingsState);
        const base = aiCanonicalRef.current;
        aiCanonicalRef.current = remote;
        setAiSettings(current => mergeAgentNativeSettings(base, current, remote));
      }
      if (operation.name === 'meta_capi_update') {
        const remote = result as MetaCapiSettingsState;
        const base = metaCapiCanonicalRef.current;
        metaCapiCanonicalRef.current = remote;
        setMetaCapi(current => mergeAgentNativeSettings(base, current, remote));
      }
    };
    window.addEventListener(AGENT_NATIVE_CHANGED_EVENT, updateNativeSettings);
    return () => window.removeEventListener(AGENT_NATIVE_CHANGED_EVENT, updateNativeSettings);
  }, []);
  const [metaCapiLoading, setMetaCapiLoading] = useState(false);
  const [storageState, setStorageState] = useState<StorageManagementState | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [storageOperation, setStorageOperation] = useState<'snapshots' | 'project' | 'restore' | null>(null);
  const [snapshotPreview, setSnapshotPreview] = useState<PublicationSnapshot | null>(null);
  const requestedSnapshotOpenedRef = useRef(false);
  const [includePublishedSnapshot, setIncludePublishedSnapshot] = useState(false);
  const [storageConfirmation, setStorageConfirmation] = useState<'snapshots' | 'project' | null>(null);
  const [projectConfirmation, setProjectConfirmation] = useState('');
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState<'site' | 'page'>('site');
  const [aiBrief, setAiBrief] = useState('');
  const [aiIncludePage, setAiIncludePage] = useState(true);
  const [savingScope, setSavingScope] = useState<SettingsSaveScope | null>(null);
  const [leavingSettings, setLeavingSettings] = useState(false);
  const leavingSettingsRef = useRef(false);
  const leavePreparationPromiseRef = useRef<Promise<boolean> | null>(null);
  const prepareSettingsLeaveRef = useRef<(destination?: string) => Promise<boolean>>(async () => true);
  const sectionNavigationRef = useRef(false);
  const activeSaveRequestRef = useRef<SettingsSaveRequest | null>(null);
  const activeSavePromiseRef = useRef<Promise<void> | null>(null);
  const saveQueueRef = useRef<SettingsSaveRequest[]>([]);
  const drainSaveQueueRef = useRef<() => void>(() => undefined);
  const autosaveTimerRef = useRef<number | null>(null);
  const pageDraftOwnerRef = useRef(selectedPage);
  const pageCanonicalSettingsRef = useRef<PageSeoSettings>(selectedPage ? pageSettings[selectedPage] || {} : {});
  const lastPageSettingsSignatureRef = useRef(
    selectedPage ? canonicalSettingsSignature(pageSettings[selectedPage] || {}) : '',
  );
  const drainSaveQueue = useCallback(() => {
    if (activeSaveRequestRef.current) return;
    const request = saveQueueRef.current.shift();
    if (!request) return;

    activeSaveRequestRef.current = request;
    setSavingScope(request.scope);
    const operation = Promise.resolve()
      .then(() => {
        request.onStart?.();
        return request.run();
      })
      .then(() => request.onSuccess?.())
      .catch(error => {
        request.onFailure?.();
        toast.error(request.failureMessage, {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        activeSavePromiseRef.current = null;
        activeSaveRequestRef.current = null;
        setSavingScope(null);
        drainSaveQueueRef.current();
      });
    activeSavePromiseRef.current = operation;
  }, []);
  drainSaveQueueRef.current = drainSaveQueue;

  const enqueueSave = useCallback(
    (request: SettingsSaveRequest) => {
      if (readOnly) return;
      const activeRequest = activeSaveRequestRef.current;
      if (
        request.origin === 'auto' &&
        activeRequest?.scope === request.scope &&
        activeRequest.signature === request.signature
      ) {
        return;
      }

      const pendingIndex = request.coalesceKey
        ? saveQueueRef.current.findIndex(pending => pending.coalesceKey === request.coalesceKey)
        : -1;
      if (pendingIndex >= 0) {
        const pending = saveQueueRef.current[pendingIndex];
        saveQueueRef.current[pendingIndex] = {
          ...request,
          // A later draft replaces the payload, but an explicit click must stay
          // explicit so it is never cancelled as a redundant autosave.
          origin: pending.origin === 'manual' || request.origin === 'manual' ? 'manual' : 'auto',
        };
      } else {
        saveQueueRef.current.push(request);
      }
      drainSaveQueue();
    },
    [drainSaveQueue, readOnly],
  );
  const uploadSettingsImage = useCallback((file: File): Promise<string> => {
    if (readOnly || !onUploadProjectImage) return Promise.reject(new Error('O envio de imagens não está disponível.'));
    return new Promise((resolve, reject) => {
      // Asset persistence shares the Settings queue so an older in-flight
      // metadata snapshot cannot commit after the image and remove its bytes.
      enqueueSave({
        scope: 'media', origin: 'manual', signature: `${file.name}:${file.size}:${file.lastModified}`,
        run: async () => {
          try { resolve(await onUploadProjectImage(file)); }
          catch (error) { reject(error); }
        },
        failureMessage: 'Não foi possível enviar a imagem.',
      });
    });
  }, [enqueueSave, onUploadProjectImage, readOnly]);
  const selectedAiProvider = AI_PROVIDERS.find(provider => provider.id === aiSettings.provider) || AI_PROVIDERS[0];
  const productAccess = product ?? wordpress?.product;
  const productFeatures = productAccess?.features || {};
  const licenseInactive = false;
  const advancedSeo = true;
  const socialImageLocked = false;
  const redirectsLocked = false;
  const integrationsLocked = false;
  const cookieConsentActivationLocked = false;
  const infiniteCanvasLocked = false;
  const licenseUrl = productAccess?.licenseUrl;
  const upgradeUrl = productAccess?.upgradeUrl;
  const visibleSiteSettingsSections = SITE_SETTINGS_SECTIONS.filter(
    item =>
      (item.id !== 'storage' || Boolean(wordpress?.storageUrl)) &&
      (item.id !== 'agents' || Boolean(wordpress?.agentUrl || settingsContent?.agents)) &&
      (item.id !== 'beta' || productFeatures.experiments !== false),
  );

  const selectAiProvider = (provider: (typeof AI_PROVIDERS)[number]) => {
    setAiKey('');
    setAiSettings(current => ({
      ...current,
      provider: provider.id,
      model: provider.model,
      baseUrl: provider.endpoint,
      configured: Boolean(current.configuredProviders?.[provider.id]),
    }));
  };
  const templateCollection = cmsCollections.find(collection => pageTemplates[collection.slug] === selectedPage);
  const schemaBindingFields = useMemo(() => {
    const fields = [...CMS_SCHEMA_STANDARD_FIELDS, ...(templateCollection?.fields || [])];
    return fields.filter((field, index) => fields.findIndex(candidate => candidate.key === field.key) === index);
  }, [templateCollection]);
  const [cmsSample, setCmsSample] = useState<Record<string, unknown>>({});
  const aiSourcePath = aiTarget === 'site' ? homePage : selectedPage;
  const aiHtmlSummary = useMemo(
    () => summarizeHtmlForAi(pageHtmlSources[aiSourcePath] || ''),
    [aiSourcePath, pageHtmlSources],
  );

  useEffect(() => {
    if (!templateCollection || !cmsItemsUrl) {
      setCmsSample({});
      return;
    }
    const controller = new AbortController();
    cmsFetch(cmsItemsEndpoint(cmsItemsUrl, templateCollection.slug), {
      credentials: 'same-origin',
      headers: { 'X-WP-Nonce': cmsNonce || '' },
      signal: controller.signal,
    })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('CMS preview unavailable'))))
      .then((payload: { items?: Array<{ values?: Record<string, unknown> }> }) =>
        setCmsSample(payload.items?.[0]?.values || {}),
      )
      .catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setCmsSample({});
      });
    return () => controller.abort();
  }, [cmsItemsUrl, cmsNonce, templateCollection?.slug]);

  const incomingPageSettingsSignature = selectedPage
    ? canonicalSettingsSignature(pageSettings[selectedPage] || {})
    : '';
  useEffect(() => setSection(initialSection || 'general'), [initialSection]);
  useEffect(() => {
    if (!selectedPage) {
      pageDraftOwnerRef.current = '';
      lastPageSettingsSignatureRef.current = '';
      pageCanonicalSettingsRef.current = {};
      return;
    }
    if (pageDraftOwnerRef.current !== selectedPage) {
      pageDraftOwnerRef.current = selectedPage;
      lastPageSettingsSignatureRef.current = incomingPageSettingsSignature;
      pageCanonicalSettingsRef.current = pageSettings[selectedPage] || {};
      setPageDraft(pageSettings[selectedPage] || {});
      setPagePath(selectedPage);
      return;
    }
    const previousCanonical = pageCanonicalSettingsRef.current;
    lastPageSettingsSignatureRef.current = incomingPageSettingsSignature;
    pageCanonicalSettingsRef.current = pageSettings[selectedPage] || {};
    setPageDraft(current =>
      mergeCanonicalSettingsDraft(previousCanonical, current, pageSettings[selectedPage] || {}),
    );
    setPagePath(current => (current === selectedPage ? selectedPage : current));
  }, [incomingPageSettingsSignature, pageSettings, selectedPage]);

  const storedSocialImageTemplates = useMemo(
    () => normalizeSocialImageTemplateLibrary(siteDraft.socialImageTemplates),
    [siteDraft.socialImageTemplates],
  );
  const legacySiteSocialImageTemplate = useMemo(
    () =>
      siteDraft.socialImageTemplate
        ? canonicalizeSocialImageTemplateAssets(siteDraft.socialImageTemplate, homePage, projectRootPath)
        : undefined,
    [homePage, projectRootPath, siteDraft.socialImageTemplate],
  );
  const legacyPageSocialImageTemplate = useMemo(
    () =>
      pageDraft.socialImageTemplate
        ? canonicalizeSocialImageTemplateAssets(
            pageDraft.socialImageTemplate,
            selectedPage || homePage,
            projectRootPath,
          )
        : undefined,
    [homePage, pageDraft.socialImageTemplate, projectRootPath, selectedPage],
  );
  const socialImageTemplateLibrary = useMemo(() => {
    const storedIds = new Set(storedSocialImageTemplates.map(template => template.id));
    const legacyTemplates = normalizeSocialImageTemplateLibrary([
      ...(legacySiteSocialImageTemplate ? [legacySiteSocialImageTemplate] : []),
      ...Object.entries(pageSettings).flatMap(([path, settings]) =>
        settings.socialImageTemplate
          ? [canonicalizeSocialImageTemplateAssets(settings.socialImageTemplate, path, projectRootPath)]
          : [],
      ),
      ...(legacyPageSocialImageTemplate ? [legacyPageSocialImageTemplate] : []),
    ]);
    return normalizeSocialImageTemplateLibrary([
      ...storedSocialImageTemplates,
      ...legacyTemplates.filter(template => !storedIds.has(template.id)),
    ]);
  }, [
    legacyPageSocialImageTemplate,
    legacySiteSocialImageTemplate,
    pageSettings,
    projectRootPath,
    storedSocialImageTemplates,
  ]);
  const templateFromLibrary = (id: string | undefined) => {
    const normalizedId = normalizeSocialImageTemplateId(id);
    return normalizedId ? socialImageTemplateLibrary.find(template => template.id === normalizedId) : undefined;
  };
  const siteAssignedSocialImageTemplate =
    templateFromLibrary(siteDraft.socialImageTemplateId) || legacySiteSocialImageTemplate;
  const pageAssignedSocialImageTemplate =
    templateFromLibrary(pageDraft.socialImageTemplateId) || legacyPageSocialImageTemplate;
  const effectivePageSocialImageTemplate = pageAssignedSocialImageTemplate || siteAssignedSocialImageTemplate;
  const pageHasOwnSocialImageTemplate = Boolean(pageAssignedSocialImageTemplate);
  const pageHasOwnManualSocialImage = Boolean(pageDraft.socialImage?.trim());
  const pageInheritsManualSocialImage = !pageHasOwnManualSocialImage && Boolean(siteDraft.socialImage?.trim());

  const seoScore = useMemo(() => {
    if (!selectedPage) return 0;
    const checks = [
      Boolean(pageDraft.title?.trim()),
      Boolean(pageDraft.description?.trim()),
      (pageDraft.description?.trim().length || 0) >= 70,
      Boolean(pageDraft.canonicalUrl?.trim() || siteDraft.baseUrl?.trim()),
      Boolean(effectivePageSocialImageTemplate || pageDraft.socialImage?.trim() || siteDraft.socialImage?.trim()),
      pageDraft.schemaType !== 'none',
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [effectivePageSocialImageTemplate, pageDraft, selectedPage, siteDraft]);
  const liveSocialTitle =
    resolveCmsSeoTemplate(pageDraft.socialTitle || pageDraft.title || pageLabel(selectedPage, homePage), cmsSample) ||
    siteDraft.siteTitle ||
    projectName;
  const liveSocialDescription = resolveCmsSeoTemplate(
    pageDraft.socialDescription ||
      pageDraft.description ||
      siteDraft.description ||
      'Adicione uma descrição para controlar o compartilhamento desta página.',
    cmsSample,
  );
  const liveSocialImage = resolveCmsSeoTemplate(pageDraft.socialImage || siteDraft.socialImage || '', cmsSample);
  const liveSocialImagePreview = useSettingsImagePreview(
    liveSocialImage,
    projectFiles,
    selectedPage || homePage,
    projectRootPath,
    siteDraft.baseUrl || '',
    loadProjectFile,
  );
  const socialImageVariables = useMemo<SocialImageVariableOption[]>(() => {
    const standard = SOCIAL_IMAGE_VARIABLE_GROUPS.flatMap(group =>
      group.variables.map(variable => ({ ...variable, group: group.label })),
    );
    const standardKeys = new Set<string>(standard.map(variable => variable.key));
    const collection =
      templateCollection?.fields
        .map(field => ({ field, key: cmsSocialVariableKey(field.key) }))
        .filter(({ key }) => !standardKeys.has(key))
        .map(({ field, key }) => ({
          key,
          label: field.label,
          kind: field.type === 'image' ? 'image' : field.type,
          group: templateCollection.name,
        })) || [];
    return [...standard, ...collection];
  }, [templateCollection]);
  const socialImageSampleVariables = useMemo<Record<string, unknown>>(() => {
    const canonicalUrl = resolveCmsSeoTemplate(
      pageDraft.canonicalUrl ||
        `${siteDraft.baseUrl || 'https://seusite.com'}/${(selectedPage || homePage).replace(/index\.html?$/i, '').replace(/\.html?$/i, '')}`,
      cmsSample,
    );
    const featuredImage = cmsSample.featured_image || cmsSample['field:image'] || liveSocialImage;
    const productPrice = cmsSample['field:price'] || cmsSample.price || cmsSample['field:product_price'] || '';
    const categoryName = cmsSample['field:category'] || cmsSample.category || '';
    const collectionValues = Object.fromEntries(
      (templateCollection?.fields || []).map(field => {
        const dynamicKey = cmsSocialVariableKey(field.key);
        const value = cmsSample[`field:${field.key}`] ?? cmsSample[field.key] ?? '';
        return [dynamicKey, value];
      }),
    );
    return {
      ...cmsSample,
      ...collectionValues,
      'page.title': liveSocialTitle || pageLabel(selectedPage || homePage, homePage),
      'page.excerpt': liveSocialDescription,
      'page.featured_image': featuredImage,
      'page.url': canonicalUrl,
      'page.date': cmsSample.date || new Intl.DateTimeFormat(siteDraft.language || 'pt-BR').format(new Date()),
      'author.name': cmsSample.author || 'Autor',
      'author.avatar': cmsSample.author_avatar || '',
      'site.name': siteDraft.siteTitle || projectName,
      'site.logo': siteDraft.faviconLight || siteDraft.faviconDark || '',
      'product.price': productPrice,
      'product.image': cmsSample.product_image || featuredImage,
      'category.name': categoryName,
    };
  }, [
    cmsSample,
    homePage,
    liveSocialDescription,
    liveSocialImage,
    liveSocialTitle,
    pageDraft.canonicalUrl,
    projectName,
    selectedPage,
    siteDraft.baseUrl,
    siteDraft.faviconDark,
    siteDraft.faviconLight,
    siteDraft.language,
    siteDraft.siteTitle,
    templateCollection,
  ]);
  const activeSocialImageTemplate = socialImageBuilderTemplate;
  const pageDraftSignature = canonicalSettingsSignature({
    selectedPage,
    pagePath,
    settings: pageDraft,
  });
  const pageDirty = selectedPage ? pageDraftSignature !== pageSavedSignature : false;
  const settingsDirty = siteDirty || cookieConsentDirty || customCodeDirty || redirectDirty || pageDirty;
  useEffect(() => {
    if (settingsDirty && !readOnly && storageOperation !== 'restore') notifyWorkspaceDraftChanged();
  }, [settingsDirty, readOnly, storageOperation, siteDraftSignature, cookieConsentDraftSignature, customCodeDraftSignature, redirectDraftSignature, pageDraftSignature]);
  const baseUrlError = urlError(siteDraft.baseUrl || '', 'URL pública');
  const invalidAnalytics = [
    siteDraft.googleAnalyticsId?.trim() && !/^G-[A-Z0-9]+$/i.test(siteDraft.googleAnalyticsId.trim())
      ? 'Google Analytics'
      : '',
    siteDraft.googleTagManagerId?.trim() && !/^GTM-[A-Z0-9]+$/i.test(siteDraft.googleTagManagerId.trim())
      ? 'Google Tag Manager'
      : '',
    siteDraft.microsoftClarityId?.trim() && !/^[a-z0-9]+$/i.test(siteDraft.microsoftClarityId.trim())
      ? 'Microsoft Clarity'
      : '',
    siteDraft.metaPixelId?.trim() && !/^\d+$/.test(siteDraft.metaPixelId.trim()) ? 'Meta Pixel' : '',
    siteDraft.plausibleDomain?.trim() && !/^[a-z0-9.-]+$/i.test(siteDraft.plausibleDomain.trim()) ? 'Plausible' : '',
  ].filter(Boolean);
  const siteSchemaError = jsonLdError(siteDraft.globalSchemaJsonLd);
  const siteSaveError =
    baseUrlError || siteSchemaError || (invalidAnalytics.length ? `Revise: ${invalidAnalytics.join(', ')}.` : '');
  const cookieConsentSaveError = cookieConsentSettingsError(cookieConsentDraft);
  const customCodeSaveError = customCodeSettingsError(customCodeDraft);
  const redirectSaveError = redirectSettingsError(redirectDraft);
  const duplicatePagePath =
    selectedPage &&
    pages.some(path => path !== selectedPage && path.toLocaleLowerCase() === pagePath.trim().toLocaleLowerCase());
  const canonicalUrlError = urlError(pageDraft.canonicalUrl || '', 'URL canônica', true);
  const pageSchemaError = jsonLdError(pageDraft.schemaJsonLd);
  const pageSaveError = !pagePath.trim()
    ? 'A URL da página não pode ficar vazia.'
    : duplicatePagePath
      ? 'Já existe uma página com esta URL.'
      : canonicalUrlError || pageSchemaError;
  const settingsLeaveDraftRef = useRef({
    siteDraft,
    siteDraftSignature,
    siteSaveError,
    cookieConsentDraft,
    cookieConsentDraftSignature,
    cookieConsentSaveError,
    customCodeDraft,
    customCodeDraftSignature,
    customCodeSaveError,
    redirectDraft,
    redirectDraftSignature,
    redirectSaveError,
    selectedPage,
    pageDraft,
    pageDraftSignature,
    pagePath,
    pageSaveError,
  });
  settingsLeaveDraftRef.current = {
    siteDraft,
    siteDraftSignature,
    siteSaveError,
    cookieConsentDraft,
    cookieConsentDraftSignature,
    cookieConsentSaveError,
    customCodeDraft,
    customCodeDraftSignature,
    customCodeSaveError,
    redirectDraft,
    redirectDraftSignature,
    redirectSaveError,
    selectedPage,
    pageDraft,
    pageDraftSignature,
    pagePath,
    pageSaveError,
  };

  useEffect(() => {
    if (readOnly) return;
    const beforeSettingsUnload = (event: BeforeUnloadEvent) => {
      const latest = settingsLeaveDraftRef.current;
      // Read acknowledgements synchronously: React may not have painted the
      // final saved state when a guarded document navigation starts.
      const pending = activeSavePromiseRef.current || saveQueueRef.current.length
        || !isSiteSavedSignature(latest.siteDraftSignature)
        || !isCookieConsentSavedSignature(latest.cookieConsentDraftSignature)
        || !isCustomCodeSavedSignature(latest.customCodeDraftSignature)
        || !isRedirectSavedSignature(latest.redirectDraftSignature)
        || (latest.selectedPage && !isPageSavedSignature(latest.pageDraftSignature));
      if (!pending) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeSettingsUnload);
    return () => window.removeEventListener('beforeunload', beforeSettingsUnload);
  }, [readOnly, isSiteSavedSignature, isCookieConsentSavedSignature, isCustomCodeSavedSignature, isRedirectSavedSignature, isPageSavedSignature]);

  const cancelScheduledAutosave = () => {
    if (autosaveTimerRef.current === null) return;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  };

  const persistSite = (origin: SettingsSaveOrigin = 'manual') => {
    if (!siteDirty || siteSaveError) return;
    if (origin === 'manual') cancelScheduledAutosave();
    const draft = siteDraft;
    enqueueSave({
      scope: 'site',
      coalesceKey: 'site',
      origin,
      signature: siteDraftSignature,
      ...siteSaveLifecycle(siteDraftSignature),
      run: () => onSaveSite(draft),
      failureMessage: 'Não foi possível salvar as configurações.',
    });
  };

  const updateSiteLanguage = (language: string) => {
    const next = { ...siteDraft, language };
    const signature = canonicalSettingsSignature(next);
    cancelScheduledAutosave();
    setSiteDraft(next);
    enqueueSave({
      scope: 'site',
      coalesceKey: 'site',
      origin: 'manual',
      signature,
      ...siteSaveLifecycle(signature),
      run: () => onSaveSite(next),
      failureMessage: 'Não foi possível atualizar o idioma do site.',
    });
  };

  const persistPage = (origin: SettingsSaveOrigin = 'manual') => {
    if (!selectedPage || !pageDirty || pageSaveError) return;
    if (origin === 'manual') cancelScheduledAutosave();
    const path = selectedPage;
    const draft = pageDraft;
    const nextPath = pagePath.trim();
    enqueueSave({
      scope: 'page',
      coalesceKey: `page:${path}`,
      origin,
      signature: pageDraftSignature,
      ...pageSaveLifecycle(pageDraftSignature),
      run: () => onSavePage(path, draft, nextPath),
      failureMessage: 'Não foi possível salvar a página.',
    });
  };

  const persistCustomCode = (origin: SettingsSaveOrigin = 'manual') => {
    if (!customCodeDirty || customCodeSaveError) return;
    if (origin === 'manual') cancelScheduledAutosave();
    const draft = customCodeDraft;
    enqueueSave({
      scope: 'custom-code',
      coalesceKey: 'custom-code',
      origin,
      signature: customCodeDraftSignature,
      ...customCodeSaveLifecycle(customCodeDraftSignature),
      run: () => onSaveCustomCode(draft),
      failureMessage: 'Não foi possível salvar o Custom Code.',
    });
  };

  const persistCookieConsent = (origin: SettingsSaveOrigin = 'manual') => {
    if (!cookieConsentDirty || cookieConsentSaveError) return;
    if (origin === 'manual') cancelScheduledAutosave();
    const draft = cookieConsentDraft;
    enqueueSave({
      scope: 'cookie-consent',
      coalesceKey: 'cookie-consent',
      origin,
      signature: cookieConsentDraftSignature,
      ...cookieConsentSaveLifecycle(cookieConsentDraftSignature),
      run: () => onSaveCookieConsent(draft),
      failureMessage: 'Não foi possível salvar o Cookie Consent.',
    });
  };

  const persistRedirects = (origin: SettingsSaveOrigin = 'manual') => {
    if (!redirectDirty || redirectSaveError) return;
    if (origin === 'manual') cancelScheduledAutosave();
    const draft = redirectDraft;
    enqueueSave({
      scope: 'redirects',
      coalesceKey: 'redirects',
      origin,
      signature: redirectDraftSignature,
      ...redirectSaveLifecycle(redirectDraftSignature),
      run: () => onSaveRedirects(draft),
      failureMessage: 'Não foi possível salvar os redirects.',
    });
  };

  const enqueueSocialImageSiteSave = (next: SiteSeoSettings) => {
    const signature = canonicalSettingsSignature(next);
    setSiteDraft(next);
    enqueueSave({
      scope: 'site',
      coalesceKey: 'site',
      origin: 'manual',
      signature,
      ...siteSaveLifecycle(signature),
      run: () => onSaveSite(next),
      failureMessage: 'Não foi possível salvar a biblioteca de Social Image.',
    });
  };

  const enqueueSocialImagePageSave = (next: PageSeoSettings) => {
    if (!selectedPage) return;
    const path = selectedPage;
    const nextPath = pagePath.trim();
    const signature = canonicalSettingsSignature({
      selectedPage: path,
      pagePath: nextPath,
      settings: next,
    });
    setPageDraft(next);
    enqueueSave({
      scope: 'page',
      coalesceKey: `page:${path}`,
      origin: 'manual',
      signature,
      ...pageSaveLifecycle(signature),
      run: () => onSavePage(path, next, nextPath),
      failureMessage: 'Não foi possível salvar a atribuição de Social Image.',
    });
  };

  const enqueueSocialImageSiteAndPageSave = (nextSite: SiteSeoSettings, nextPage: PageSeoSettings) => {
    if (!selectedPage) return;
    const path = selectedPage;
    const nextPath = pagePath.trim();
    const siteSignature = canonicalSettingsSignature(nextSite);
    const pageSignature = canonicalSettingsSignature({
      selectedPage: path,
      pagePath: nextPath,
      settings: nextPage,
    });
    const siteLifecycle = siteSaveLifecycle(siteSignature);
    const pageLifecycle = pageSaveLifecycle(pageSignature);
    setSiteDraft(nextSite);
    setPageDraft(nextPage);
    enqueueSave({
      scope: 'page',
      // This transaction creates the catalog entry that the page assignment
      // depends on. A later ordinary page save must never replace it.
      origin: 'manual',
      signature: canonicalSettingsSignature({
        site: nextSite,
        selectedPage: path,
        pagePath: nextPath,
        settings: nextPage,
      }),
      onStart: () => {
        siteLifecycle.onStart();
        pageLifecycle.onStart();
      },
      onSuccess: () => {
        siteLifecycle.onSuccess();
        pageLifecycle.onSuccess();
      },
      onFailure: () => {
        siteLifecycle.onFailure();
        pageLifecycle.onFailure();
      },
      run: async () => {
        await onSaveSite(nextSite);
        await onSavePage(path, nextPage, nextPath);
      },
      failureMessage: 'Não foi possível salvar o template e sua atribuição.',
    });
  };

  const openSocialImageBuilder = (target: 'site' | 'page') => {
    const template =
      target === 'site'
        ? siteAssignedSocialImageTemplate
        : pageAssignedSocialImageTemplate ||
          (siteAssignedSocialImageTemplate
            ? duplicateSocialImageTemplate(
                siteAssignedSocialImageTemplate,
                `${siteAssignedSocialImageTemplate.name} · ${pageLabel(selectedPage || homePage, homePage)}`,
              )
            : undefined);
    setSocialImageBuilderTemplate(template);
    setSocialImageBuilderTarget(target);
  };

  const reportSocialImageLibraryLimit = () => {
    toast.error('A biblioteca de Social Image está cheia.', {
      description: `O limite é de ${SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES} templates. Nenhuma atribuição foi alterada.`,
    });
  };

  const assignSocialImageTemplate = (target: 'site' | 'page', templateId: string | undefined) => {
    cancelScheduledAutosave();
    const selectedTemplate = templateFromLibrary(templateId);
    if (templateId && !selectedTemplate) {
      toast.error('O template selecionado não está disponível.', {
        description: 'Nenhuma atribuição foi alterada.',
      });
      return false;
    }
    let nextLibrary = storedSocialImageTemplates;
    const currentTemplate = target === 'site' ? siteAssignedSocialImageTemplate : pageAssignedSocialImageTemplate;
    for (const templateToKeep of [currentTemplate, selectedTemplate]) {
      if (!templateToKeep) continue;
      nextLibrary = upsertSocialImageTemplateLibrary(nextLibrary, templateToKeep);
      if (!nextLibrary.some(template => template.id === templateToKeep.id)) {
        reportSocialImageLibraryLimit();
        return false;
      }
    }
    if (target === 'site') {
      const {
        socialImageTemplate: _legacyTemplate,
        socialImageTemplateId: _previousTemplateId,
        ...siteRest
      } = siteDraft;
      enqueueSocialImageSiteSave({
        ...siteRest,
        socialImageTemplates: nextLibrary,
        ...(selectedTemplate ? { socialImageTemplateId: selectedTemplate.id } : {}),
      });
      return true;
    }
    if (!selectedPage) return false;
    const { socialImageTemplate: _legacyTemplate, socialImageTemplateId: _previousTemplateId, ...pageRest } = pageDraft;
    const nextPage = {
      ...pageRest,
      ...(selectedTemplate ? { socialImageTemplateId: selectedTemplate.id } : {}),
    };
    if (JSON.stringify(nextLibrary) !== JSON.stringify(storedSocialImageTemplates)) {
      enqueueSocialImageSiteAndPageSave({ ...siteDraft, socialImageTemplates: nextLibrary }, nextPage);
    } else {
      enqueueSocialImagePageSave(nextPage);
    }
    return true;
  };

  const persistSocialImageTemplate = (target: 'site' | 'page', template: SocialImageTemplate | undefined) => {
    cancelScheduledAutosave();
    if (!template) {
      if (!assignSocialImageTemplate(target, undefined)) return;
      setSocialImageBuilderTarget(null);
      setSocialImageBuilderTemplate(undefined);
      return;
    }
    const referencePath = target === 'page' ? selectedPage || homePage : homePage;
    const canonicalTemplate = canonicalizeSocialImageTemplateAssets(template, referencePath, projectRootPath);
    const nextLibrary = upsertSocialImageTemplateLibrary(storedSocialImageTemplates, canonicalTemplate);
    if (!nextLibrary.some(template => template.id === canonicalTemplate.id)) {
      reportSocialImageLibraryLimit();
      return;
    }
    if (target === 'site') {
      const {
        socialImageTemplate: _legacyTemplate,
        socialImageTemplateId: _previousTemplateId,
        ...siteRest
      } = siteDraft;
      enqueueSocialImageSiteSave({
        ...siteRest,
        socialImageTemplates: nextLibrary,
        socialImageTemplateId: canonicalTemplate.id,
      });
      setSocialImageBuilderTarget(null);
      setSocialImageBuilderTemplate(undefined);
      return;
    }
    if (!selectedPage) return;
    const { socialImageTemplate: _legacyTemplate, socialImageTemplateId: _previousTemplateId, ...pageRest } = pageDraft;
    enqueueSocialImageSiteAndPageSave(
      {
        ...siteDraft,
        socialImageTemplates: nextLibrary,
      },
      {
        ...pageRest,
        socialImageTemplateId: canonicalTemplate.id,
      },
    );
    setSocialImageBuilderTarget(null);
    setSocialImageBuilderTemplate(undefined);
  };

  const waitForSaveQueue = async () => {
    while (activeSavePromiseRef.current || saveQueueRef.current.length) {
      if (!activeSavePromiseRef.current) drainSaveQueueRef.current();
      const active = activeSavePromiseRef.current;
      if (active) await active;
      else await Promise.resolve();
    }
  };

  /**
   * The autosave timer is cancelled when this component unmounts. Flush the
   * current drafts before closing/navigating so a quick move from Settings to
   * Languages cannot reopen the older workspace metadata.
   */
  const flushSettingsBeforeLeave = async () => {
    cancelScheduledAutosave();
    await waitForSaveQueue();
    const latest = settingsLeaveDraftRef.current;

    // Queue callbacks update their acknowledgement refs synchronously. Read
    // those refs only after the queue drains so leaving does not write the same
    // snapshot twice and advance the WordPress workspace revision needlessly.
    const siteNeedsSave = !isSiteSavedSignature(latest.siteDraftSignature);
    const cookieConsentNeedsSave = !isCookieConsentSavedSignature(latest.cookieConsentDraftSignature);
    const customCodeNeedsSave = !isCustomCodeSavedSignature(latest.customCodeDraftSignature);
    const redirectNeedsSave = !isRedirectSavedSignature(latest.redirectDraftSignature);
    const pageNeedsSave = Boolean(latest.selectedPage) && !isPageSavedSignature(latest.pageDraftSignature);
    const blockingError =
      (siteNeedsSave && latest.siteSaveError) ||
      (cookieConsentNeedsSave && latest.cookieConsentSaveError) ||
      (customCodeNeedsSave && latest.customCodeSaveError) ||
      (redirectNeedsSave && latest.redirectSaveError) ||
      (pageNeedsSave && latest.pageSaveError) ||
      '';
    if (blockingError) {
      throw new Error(blockingError);
    }
    if (siteNeedsSave) await onSaveSite(latest.siteDraft);
    if (cookieConsentNeedsSave) await onSaveCookieConsent(latest.cookieConsentDraft);
    if (customCodeNeedsSave) await onSaveCustomCode(latest.customCodeDraft);
    if (redirectNeedsSave) await onSaveRedirects(latest.redirectDraft);
    if (latest.selectedPage && pageNeedsSave) {
      await onSavePage(latest.selectedPage, latest.pageDraft, latest.pagePath.trim());
    }
  };

  const prepareSettingsLeave = async (destination?: string) => {
    if (leavePreparationPromiseRef.current) {
      const existing = leavePreparationPromiseRef.current;
      const prepared = await existing;
      if (destination === 'backup' && leavePreparationPromiseRef.current === existing) {
        leavePreparationPromiseRef.current = null;
        leavingSettingsRef.current = false;
        setLeavingSettings(false);
      }
      return prepared;
    }
    leavingSettingsRef.current = true;
    setLeavingSettings(true);
    const preparation = flushSettingsBeforeLeave()
      .then(() => true)
      .catch(error => {
        toast.error('Revise as configurações antes de sair.', {
          description: error instanceof Error ? error.message : undefined,
        });
        leavingSettingsRef.current = false;
        setLeavingSettings(false);
        return false;
      });
    leavePreparationPromiseRef.current = preparation;
    const prepared = await preparation;
    // A backup flushes these drafts but keeps Settings mounted. Its caller
    // owns the surrounding busy state and must be able to resume after failure.
    if (destination === 'backup' && leavePreparationPromiseRef.current === preparation) {
      leavePreparationPromiseRef.current = null;
      leavingSettingsRef.current = false;
      setLeavingSettings(false);
    }
    if (!prepared && leavePreparationPromiseRef.current === preparation) {
      leavePreparationPromiseRef.current = null;
    }
    return prepared;
  };
  prepareSettingsLeaveRef.current = prepareSettingsLeave;

  useEffect(
    () => registerWorkspaceNavigationGuard(destination => prepareSettingsLeaveRef.current(destination)),
    [],
  );

  useEffect(() => {
    const resume = () => {
      leavePreparationPromiseRef.current = null;
      leavingSettingsRef.current = false;
      setLeavingSettings(false);
    };
    window.addEventListener(WORKSPACE_NAVIGATION_CANCELLED_EVENT, resume);
    return () => window.removeEventListener(WORKSPACE_NAVIGATION_CANCELLED_EVENT, resume);
  }, []);

  const leaveSettings = async (href?: string) => {
    const prepared = await prepareSettingsLeave();
    if (!prepared) return;
    try {
      if (href && onNavigate) {
        const navigated = await onNavigate(href);
        if (navigated === false) throw new Error('O projeto ainda não confirmou o salvamento para sair.');
      }
      else if (href) window.location.assign(href);
      else onClose();
    } catch (error) {
      toast.error('Revise as configurações antes de sair.', {
        description: error instanceof Error ? error.message : undefined,
      });
      leavePreparationPromiseRef.current = null;
      leavingSettingsRef.current = false;
      setLeavingSettings(false);
    }
  };
  const requestSection = async (id: string) => {
    if (id === section || sectionNavigationRef.current) return;
    if (selectedPage && pageDirty) {
      if (pageSaveError) {
        toast.error('Revise a página antes de mudar de seção.', {
          description: pageSaveError,
        });
        return;
      }
      sectionNavigationRef.current = true;
      cancelScheduledAutosave();
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      try {
        await waitForSaveQueue();
        await onSavePage(selectedPage, pageDraft, pagePath.trim());
      } catch (error) {
        toast.error('Não foi possível salvar a página antes de mudar de seção.', {
          description: error instanceof Error ? error.message : undefined,
        });
        sectionNavigationRef.current = false;
        return;
      }
      sectionNavigationRef.current = false;
    }
    setSection(id);
    if (standalone) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', id);
      window.history.replaceState(window.history.state, '', url);
    }
  };

  useEffect(() => {
    if (!settingsDirty || storageOperation === 'restore') {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      // Save one scope at a time. Parent callbacks update the canonical
      // project synchronously, which makes the next dirty scope run on the
      // following render without racing a second ZIP/draft write.
      if (siteDirty && !siteSaveError) persistSite('auto');
      else if (cookieConsentDirty && !cookieConsentSaveError) persistCookieConsent('auto');
      else if (customCodeDirty && !customCodeSaveError) persistCustomCode('auto');
      else if (redirectDirty && !redirectSaveError) persistRedirects('auto');
      else if (pageDirty && !pageSaveError) persistPage('auto');
    }, SETTINGS_AUTOSAVE_IDLE_MS);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
    // The save functions intentionally stay out of this dependency list: they
    // are recreated by React, while these draft/error signals are the actual
    // changes that should schedule a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cookieConsentDirty,
    cookieConsentSaveError,
    customCodeDirty,
    customCodeSaveError,
    pageDirty,
    pageSaveError,
    redirectDirty,
    redirectSaveError,
    settingsDirty,
    siteDirty,
    siteSaveError,
    storageOperation,
  ]);

  const loadStorageStatus = async () => {
    if (!wordpress?.storageUrl) return;
    setStorageLoading(true);
    setStorageError('');
    try {
      const response = await fetch(wordpress.storageUrl, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível consultar o armazenamento.');
      setStorageState(payload as StorageManagementState);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Não foi possível consultar o armazenamento.');
      toast.error('Falha ao consultar o armazenamento', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    if (!standalone || !storageState || requestedSnapshotOpenedRef.current) return;
    const requested = new URLSearchParams(window.location.search).get('snapshot');
    if (!requested) return;
    requestedSnapshotOpenedRef.current = true;
    const snapshot = storageState.snapshots.items.find(item => item.id === requested);
    if (snapshot?.previewUrl) setSnapshotPreview(snapshot);
    else toast.error('Este snapshot não está mais disponível.');
    const url = new URL(window.location.href);
    url.searchParams.delete('snapshot');
    window.history.replaceState(window.history.state, '', url);
  }, [standalone, storageState]);

  const restoreSnapshot = async () => {
    if (!wordpress || !snapshotPreview?.restoreUrl || readOnly || storageOperation || leavingSettingsRef.current)
      return;
    if (!Number.isInteger(storageState?.workspaceRevision))
      throw new Error('Atualize a lista de snapshots antes de restaurar.');
    setStorageOperation('restore');
    leavingSettingsRef.current = true;
    cancelScheduledAutosave();
    try {
      await flushSettingsBeforeLeave();
      const response = await fetch(snapshotPreview.restoreUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({
          expectedWorkspaceRevision: storageState!.workspaceRevision,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true || payload.releaseOnline !== true) {
        if (response.status === 409) await loadStorageStatus();
        throw new Error(
          payload.message || 'Não foi possível confirmar a restauração. Atualize o Builder antes de tentar novamente.',
        );
      }
      // Do not run the normal leave/save path after rollback: its local model
      // still describes the version that was just replaced on the server.
      const destination = new URL(wordpress.editorUrl || '/kodety/editor/', window.location.href);
      destination.searchParams.set('kodety_restored_snapshot', '1');
      window.location.replace(editorLockHandoffUrl(destination.toString()));
    } catch (error) {
      leavingSettingsRef.current = false;
      setStorageOperation(null);
      throw error;
    }
  };

  const deleteStorageSnapshots = async () => {
    if (!wordpress?.storageUrl || readOnly) return;
    setStorageOperation('snapshots');
    try {
      const response = await fetch(wordpress.storageUrl, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({
          operation: 'delete_snapshots',
          includeCurrent: includePublishedSnapshot,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível apagar os snapshots.');
      if (payload.snapshots) {
        setStorageState(current => (current ? { ...current, snapshots: payload.snapshots } : current));
      } else {
        await loadStorageStatus();
      }
      setStorageConfirmation(null);
      toast.success('Snapshots apagados', {
        description: payload.deletedCount
          ? `${payload.deletedCount} ${payload.deletedCount === 1 ? 'snapshot removido' : 'snapshots removidos'} em massa.`
          : 'Nenhum snapshot elegível precisava ser removido.',
      });
    } catch (error) {
      toast.error('Falha ao apagar snapshots', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setStorageOperation(null);
    }
  };

  const deleteCurrentProject = async () => {
    if (!wordpress?.storageUrl || !storageState?.project || readOnly) return;
    setStorageOperation('project');
    try {
      const response = await fetch(wordpress.storageUrl, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({
          operation: 'delete_project',
          confirmation: projectConfirmation,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível excluir o projeto.');
      toast.success('Projeto excluído');
      window.location.assign(payload.redirectUrl || wordpress.dashboardUrl || '/wp-admin/');
    } catch (error) {
      toast.error('Falha ao excluir projeto', {
        description: error instanceof Error ? error.message : undefined,
      });
      setStorageOperation(null);
    }
  };

  const loadMcpStatus = async () => {
    if (!wordpress) return;
    setMcpLoading(true);
    try {
      const response = await fetch(wordpress.statusUrl, {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      if (!response.ok) throw new Error('Não foi possível consultar o WordPress.');
      setMcpStatus(await response.json());
    } catch (error) {
      toast.error('Falha ao consultar MCP', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setMcpLoading(false);
    }
  };

  const loadMcpProjectConnections = async () => {
    if (!wordpress?.projectConnectionUrl || !wordpress.canManageIntegrations || integrationsLocked) {
      setMcpProjectConnections([]);
      setMcpProjectConnectionsError('');
      return;
    }
    setMcpProjectConnectionsLoading(true);
    setMcpProjectConnectionsError('');
    try {
      const response = await fetch(wordpress.projectConnectionUrl, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = (await response.json().catch(() => null)) as {
        connections?: McpProjectConnectionSummary[];
        message?: string;
      } | null;
      if (!response.ok || !Array.isArray(payload?.connections)) {
        throw new Error(payload?.message || 'Não foi possível consultar as conexões MCP.');
      }
      setMcpProjectConnections(
        payload.connections.filter(connection => typeof connection?.id === 'string' && connection.id.trim() !== ''),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível consultar as conexões MCP.';
      setMcpProjectConnectionsError(message);
      toast.error('Falha ao consultar conexões MCP', { description: message });
    } finally {
      setMcpProjectConnectionsLoading(false);
    }
  };

  const loadAiSettings = async () => {
    if (!wordpress?.aiSettingsUrl) return;
    try {
      const response = await fetch(wordpress.aiSettingsUrl, {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = (await response.json()) as AiSettingsState & { message?: string };
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível consultar a IA.');
      aiCanonicalRef.current = normalizeAiSettingsTemperature(payload);
      setAiSettings(aiCanonicalRef.current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Configuração de IA indisponível.');
    }
  };

  const loadShopifySettings = async () => {
    if (!wordpress?.shopifySettingsUrl) return;
    setShopifyLoading(true);
    try {
      const response = await fetch(wordpress.shopifySettingsUrl, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = (await response.json().catch(() => null)) as (ShopifySettingsState & { message?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.message || 'Não foi possível carregar a Shopify.');
      setShopifySettings(payload);
    } catch (error) {
      toast.error('Shopify indisponível', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setShopifyLoading(false);
    }
  };

  const loadShopifySync = async (force = false): Promise<ShopifySyncState | null> => {
    if (!wordpress?.shopifyBuilderDataUrl) return null;
    setShopifySyncing(true);
    try {
      const response = await fetch(wordpress.shopifyBuilderDataUrl, {
        method: force ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = (await response.json().catch(() => null)) as {
        configured?: boolean;
        syncedAt?: string;
        products?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } };
        message?: string;
      } | null;
      if (!response.ok || !payload) throw new Error(payload?.message || 'Não foi possível sincronizar o catálogo.');
      const next = {
        configured: Boolean(payload.configured),
        syncedAt: payload.syncedAt || '',
        productCount: payload.products?.nodes?.length || 0,
        hasMoreProducts: Boolean(payload.products?.pageInfo?.hasNextPage),
      };
      setShopifySync(next);
      return next;
    } finally {
      setShopifySyncing(false);
    }
  };

  const saveShopifySettings = async (clear: 'storefront' | 'checkout' | null = null) => {
    if (!wordpress?.shopifySettingsUrl || !shopifySettings) return;
    setShopifyLoading(true);
    try {
      const response = await fetch(wordpress.shopifySettingsUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({
          ...shopifySettings,
          storefrontToken: shopifyStorefrontToken,
          clearStorefrontToken: clear === 'storefront',
          checkout: {
            ...shopifySettings.checkout,
            endpointSecret: shopifyCheckoutSecret,
            clearEndpointSecret: clear === 'checkout',
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        sync?: ShopifySyncState;
      } | null;
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível salvar a Shopify.');
      setShopifyStorefrontToken('');
      setShopifyCheckoutSecret('');
      if (payload?.sync) setShopifySync(payload.sync);
      await loadShopifySettings();
      if (clear) {
        toast.success(clear === 'storefront' ? 'Token Storefront removido' : 'Segredo do checkout removido');
      } else if (payload?.sync?.error) {
        toast.warning('Conexão salva; sincronização pendente', {
          description: payload.sync.error,
        });
      } else {
        toast.success('Configuração da Shopify salva', {
          description: payload?.sync?.configured
            ? `${payload.sync.productCount || 0} produtos sincronizados com o Builder.`
            : undefined,
        });
      }
    } catch (error) {
      toast.error('Configuração não salva', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setShopifyLoading(false);
    }
  };

  const testShopifyConnection = async () => {
    if (!wordpress?.shopifyConnectionTestUrl) return;
    setShopifyTesting(true);
    try {
      const response = await fetch(wordpress.shopifyConnectionTestUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = (await response.json().catch(() => null)) as {
        shop?: string;
        currency?: string;
        message?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.message || 'A Shopify recusou a conexão.');
      toast.success(`Conectado a ${payload?.shop || 'Shopify'}`, {
        description: payload?.currency ? `Moeda: ${payload.currency}` : undefined,
      });
    } catch (error) {
      toast.error('Falha no teste da Shopify', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setShopifyTesting(false);
    }
  };

  const refreshShopifyCatalog = async () => {
    try {
      const result = await loadShopifySync(true);
      toast.success('Catálogo sincronizado', {
        description: `${result?.productCount || 0} produtos disponíveis no Builder.`,
      });
    } catch (error) {
      toast.error('Falha na sincronização', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const loadMetaCapi = async () => {
    if (!wordpress?.metaCapiSettingsUrl) return;
    setMetaCapiLoading(true);
    try {
      const response = await fetch(wordpress.metaCapiSettingsUrl, {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível consultar a Meta CAPI.');
      metaCapiCanonicalRef.current = payload;
      setMetaCapi(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Meta CAPI indisponível.');
    } finally {
      setMetaCapiLoading(false);
    }
  };

  const saveMetaCapi = async (options: { clearToken?: boolean; quiet?: boolean } = {}): Promise<boolean> => {
    if (!wordpress?.metaCapiSettingsUrl) return false;
    const pixelId = siteDraft.metaPixelId?.trim() || '';
    if (!/^\d{5,32}$/.test(pixelId)) {
      toast.error('Informe um Meta Pixel ID válido antes de configurar a CAPI.');
      return false;
    }
    setMetaCapiLoading(true);
    try {
      const response = await fetch(wordpress.metaCapiSettingsUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({
          ...metaCapi,
          enabled: options.clearToken ? false : metaCapi.enabled,
          pixelId,
          accessToken: metaCapiToken,
          clearToken: Boolean(options.clearToken),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível salvar a Meta CAPI.');
      metaCapiCanonicalRef.current = payload;
      setMetaCapi(payload);
      setMetaCapiToken('');
      if (!options.quiet)
        toast.success(options.clearToken ? 'Token da Meta removido' : 'Meta CAPI salva com segurança');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar Meta CAPI.');
      return false;
    } finally {
      setMetaCapiLoading(false);
    }
  };

  const testMetaCapi = async () => {
    if (!wordpress?.metaCapiTestUrl || !(await saveMetaCapi({ quiet: true }))) return;
    setMetaCapiLoading(true);
    try {
      const response = await fetch(wordpress.metaCapiTestUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'A Meta recusou o evento de teste.');
      metaCapiCanonicalRef.current = payload;
      setMetaCapi(payload);
      toast.success(payload.message || 'Evento aceito pela Meta');
    } catch (error) {
      toast.error('Teste da Meta CAPI falhou', {
        description: error instanceof Error ? error.message : undefined,
      });
      void loadMetaCapi();
    } finally {
      setMetaCapiLoading(false);
    }
  };

  const saveAiSettings = async (): Promise<boolean> => {
    if (!wordpress?.aiSettingsUrl) return false;
    setAiLoading(true);
    try {
      const response = await fetch(wordpress.aiSettingsUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({ ...aiSettings, apiKey: aiKey }),
      });
      const payload = (await response.json()) as AiSettingsState & { message?: string };
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível salvar a IA.');
      aiCanonicalRef.current = normalizeAiSettingsTemperature(payload);
      setAiSettings(aiCanonicalRef.current);
      setAiKey('');
      toast.success('Configuração de IA salva');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar IA.');
      return false;
    } finally {
      setAiLoading(false);
    }
  };

  const testAi = async () => {
    if (!wordpress?.aiTestUrl) return;
    if (!(await saveAiSettings())) return;
    setAiLoading(true);
    try {
      const response = await fetch(wordpress.aiTestUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Teste de IA falhou.');
      toast.success(payload.message || 'Conexão com IA pronta');
      void loadAiSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Teste de IA falhou.');
    } finally {
      setAiLoading(false);
    }
  };

  const openAiPrompt = (target: 'site' | 'page') => {
    setAiTarget(target);
    setAiBrief('');
    setAiIncludePage(true);
    setAiPromptOpen(true);
  };

  const generateSeo = async () => {
    if (!wordpress?.aiGenerateUrl || !aiBrief.trim()) return;
    const metadata =
      aiTarget === 'site'
        ? `Projeto: ${projectName}. Organização: ${siteDraft.organizationName || 'não informada'}. Descrição atual: ${siteDraft.description || 'não informada'}.`
        : `Página: ${pageLabel(selectedPage, homePage)}. Título atual: ${pageDraft.title || 'não informado'}. Descrição atual: ${pageDraft.description || 'não informada'}.`;
    const context = [metadata, aiIncludePage && aiHtmlSummary ? `Resumo extraído do HTML atual:\n${aiHtmlSummary}` : '']
      .filter(Boolean)
      .join('\n\n');
    setAiLoading(true);
    try {
      const prompt = `${aiBrief.trim()}\n\nRegra factual: use somente informações presentes no briefing e no contexto enviado. Se um dado não estiver confirmado, omita-o em vez de completar ou supor.`;
      const response = await fetch(wordpress.aiGenerateUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({ task: 'seo', prompt, context }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível gerar os textos.');
      const draft = payload.draft || {};
      if (aiTarget === 'site')
        setSiteDraft(current => ({
          ...current,
          siteTitle: draft.seoTitle || current.siteTitle,
          description: draft.seoDescription || current.description,
        }));
      else
        setPageDraft(current => ({
          ...current,
          title: draft.seoTitle || current.title,
          description: draft.seoDescription || current.description,
          socialTitle: draft.seoTitle || current.socialTitle,
          socialDescription: draft.seoDescription || current.socialDescription,
        }));
      setAiPromptOpen(false);
      toast.success('Sugestões aplicadas', {
        description: 'Revise os textos antes de salvar.',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao gerar textos.');
    } finally {
      setAiLoading(false);
    }
  };

  const generateSchemaWithAi = async (target: 'site' | 'page') => {
    if (!wordpress?.aiGenerateUrl) return;
    const schemaHtmlSummary = summarizeHtmlForAi(pageHtmlSources[target === 'site' ? homePage : selectedPage] || '');
    const cmsContext =
      target === 'page' && templateCollection
        ? `Este é um template da collection "${templateCollection.name}". Use expressões dinâmicas literais no formato {{campo}}. Campos permitidos: ${schemaBindingFields.map(field => `${field.key} (${field.type || 'text'})`).join(', ')}.`
        : '';
    const currentType =
      target === 'page' ? pageDraft.schemaType || 'WebPage' : siteDraft.organizationType || 'Organization';
    const prompt =
      target === 'site'
        ? `Gere o Schema.org principal da organização e do site. Tipo preferido: ${currentType}. Use apenas dados confirmados e não crie avaliações, endereços, preços ou perfis sociais inexistentes.`
        : `Gere um JSON-LD completo e elegível para rich results para esta página. Tipo preferido: ${currentType}. ${cmsContext}`;
    const context =
      target === 'site'
        ? [
            `Site: ${siteDraft.siteTitle || projectName}`,
            `Descrição: ${siteDraft.description || ''}`,
            `Organização: ${siteDraft.organizationName || ''}`,
            `URL: ${siteDraft.baseUrl || ''}`,
            `Perfis confirmados: ${(siteDraft.organizationSameAs || []).join(', ')}`,
            schemaHtmlSummary,
          ]
            .filter(Boolean)
            .join('\n')
        : [
            `Página: ${pageLabel(selectedPage, homePage)}`,
            `Título: ${pageDraft.title || ''}`,
            `Descrição: ${pageDraft.description || ''}`,
            `URL: ${pageDraft.canonicalUrl || ''}`,
            cmsContext,
            schemaHtmlSummary,
          ]
            .filter(Boolean)
            .join('\n');
    setAiLoading(true);
    try {
      const response = await fetch(wordpress.aiGenerateUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({ task: 'schema', prompt, context }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível gerar o Schema.');
      const draft = payload.draft || {};
      if (!draft.schema || typeof draft.schema !== 'object') throw new Error('A IA não retornou um Schema válido.');
      const json = JSON.stringify(draft.schema, null, 2);
      if (target === 'site') {
        setSiteDraft(current => ({ ...current, globalSchemaJsonLd: json }));
      } else {
        const suggestedType = SCHEMA_TYPES.some(([type]) => type === draft.schemaType)
          ? (draft.schemaType as SeoSchemaType)
          : pageDraft.schemaType || 'WebPage';
        setPageDraft(current => ({
          ...current,
          schemaType: suggestedType,
          schemaJsonLd: json,
        }));
      }
      toast.success('Schema gerado e aplicado', {
        description: 'Revise os dados antes de salvar.',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao gerar Schema.');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (section === 'mcp' && !integrationsLocked) {
      void loadMcpStatus();
      void loadMcpProjectConnections();
      void loadAiSettings();
      void loadMetaCapi();
      void loadShopifySettings();
      void loadShopifySync().catch(error =>
        setShopifySync({
          configured: false,
          error: error instanceof Error ? error.message : 'Falha na sincronização.',
        }),
      );
    }
    if (section === 'storage') void loadStorageStatus();
    // The status URL only changes when the editor shell changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    section,
    wordpress?.statusUrl,
    wordpress?.projectConnectionUrl,
    wordpress?.canManageIntegrations,
    wordpress?.aiSettingsUrl,
    wordpress?.metaCapiSettingsUrl,
    wordpress?.shopifySettingsUrl,
    wordpress?.shopifyBuilderDataUrl,
    wordpress?.storageUrl,
    integrationsLocked,
  ]);

  const changeMcp = async (operation: 'enable' | 'rotate' | 'disable') => {
    if (
      !wordpress?.canManageIntegrations
      || integrationsLocked
    ) return;
    setMcpLoading(true);
    try {
      const endpoint = new URL(wordpress.statusUrl, window.location.href);
      const route = endpoint.searchParams.get('rest_route');
      if (route) endpoint.searchParams.set('rest_route', route.replace(/\/status$/, '/settings'));
      else endpoint.pathname = endpoint.pathname.replace(/\/status$/, '/settings');
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: JSON.stringify({ operation }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível alterar a conexão.');
      setMcpStatus(payload);
      setMcpCommand(payload.command || '');
      setMcpRemoteConfig(payload.remoteConfig || '');
      await loadMcpProjectConnections();
      toast.success(operation === 'disable' ? 'MCP desativado' : 'Conexão MCP pronta');
    } catch (error) {
      toast.error('Falha ao configurar MCP', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setMcpLoading(false);
    }
  };

  const createProjectMcpConnection = async () => {
    if (
      !wordpress?.projectConnectionUrl
      || !wordpress.canManageIntegrations
      || integrationsLocked
    ) return;
    setMcpLoading(true);
    try {
      const response = await fetch(wordpress.projectConnectionUrl, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wordpress.nonce,
        },
        body: '{}',
      });
      const payload = (await response.json().catch(() => null)) as (McpStatusState & { message?: string }) | null;
      if (!response.ok || !payload?.remoteConfig) {
        throw new Error(payload?.message || 'Não foi possível gerar a conexão deste projeto.');
      }
      setMcpStatus(payload);
      setMcpCommand('');
      setMcpRemoteConfig(payload.remoteConfig);
      await loadMcpProjectConnections();
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(payload.remoteConfig);
          copied = true;
        } catch {
          // Keep the one-time configuration visible below for manual copying.
        }
      }
      toast.success(copied ? 'Conexão deste projeto copiada' : 'Conexão deste projeto gerada', {
        description: copied
          ? 'Agora conecte a IA e volte para copiar o prompt das skills oficiais.'
          : 'Copie manualmente a configuração exibida abaixo; a credencial aparece somente nesta sessão.',
      });
    } catch (error) {
      toast.error('Não foi possível criar a conexão MCP', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setMcpLoading(false);
    }
  };

  const revokeProjectMcpConnection = async (connectionId: string) => {
    if (
      !wordpress?.projectConnectionUrl
      || !wordpress.canManageIntegrations
      || integrationsLocked
      || mcpRevokingProjectConnectionId !== null
    ) return;
    setMcpRevokingProjectConnectionId(connectionId);
    setMcpProjectConnectionsError('');
    try {
      const connectionUrl = `${wordpress.projectConnectionUrl.replace(/\/$/, '')}/${encodeURIComponent(connectionId)}`;
      const response = await fetch(connectionUrl, {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-WP-Nonce': wordpress.nonce },
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message || 'Não foi possível revogar esta conexão MCP.');
      }
      setMcpProjectConnections(current => current.filter(connection => connection.id !== connectionId));
      toast.success('Conexão MCP revogada', {
        description: 'As demais conexões continuam ativas.',
      });
      await loadMcpProjectConnections();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível revogar esta conexão MCP.';
      setMcpProjectConnectionsError(message);
      toast.error('Falha ao revogar conexão MCP', { description: message });
    } finally {
      setMcpRevokingProjectConnectionId(null);
    }
  };

  const copyMcpSkillInstallPrompt = async () => {
    const prompt = mcpStatus?.skills?.installPrompt || '';
    if (!prompt) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('O navegador bloqueou a cópia automática.');
      await navigator.clipboard.writeText(prompt);
      toast.success('Prompt de instalação copiado', {
        description: 'Cole no Codex ou Claude depois que a conexão MCP estiver ativa.',
      });
    } catch (error) {
      toast.error('Não foi possível copiar o prompt', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const navButton = (id: string, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      data-kodety-onboarding={`settings-section-${id}`}
      data-kodety-onboarding-page-reveal={pages.includes(id) ? '' : undefined}
      data-kodety-onboarding-reveal={
        !settingsDirty && !leavingSettings && !storageOperation && !sectionNavigationRef.current
          ? '' : undefined
      }
      onClick={() => requestSection(id)}
      aria-current={section === id ? 'page' : undefined}
      title={label}
      className={`group flex h-9 min-w-max items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[11px] outline-none transition-[background-color,color] lg:w-full ${
        section === id
          ? 'bg-white/[.09] font-medium text-foreground'
          : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.055] hover:text-foreground'
      } focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]/70`}
    >
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center text-current transition-colors group-hover:text-foreground group-aria-[current=page]:text-[var(--kodety-accent-hover)] [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {((id === 'cookie-consent'
        ? cookieConsentDirty
        : id === 'code'
          ? customCodeDirty
          : id === 'redirects'
            ? redirectDirty
            : visibleSiteSettingsSections.some(item => item.id === id) && siteDirty) ||
        (id === selectedPage && pageDirty)) && (
        <span className="size-1.5 shrink-0 rounded-full bg-amber-400" aria-label="Alterações não salvas" />
      )}
    </button>
  );

  return (
    <div
      data-kodety-project-settings
      data-kodety-onboarding="settings-workspace"
      aria-busy={leavingSettings || undefined}
      inert={leavingSettings}
      className={`${standalone ? 'absolute inset-0 z-40' : 'absolute inset-x-0 bottom-0 top-12 z-40'} flex min-h-0 flex-col overflow-hidden bg-[var(--kodety-panel)] lg:flex-row`}
    >
      <div className="shrink-0 border-b border-[var(--kodety-divider)] bg-background px-3 py-2 lg:hidden">
        <div className="mb-2 flex h-8 items-center gap-2">
          {backHref ? (
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={backHref}
                onClick={event => {
                  event.preventDefault();
                  void leaveSettings(backHref);
                }}
                aria-label="Voltar ao Builder"
              >
                <ChevronLeft />
              </a>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={leavingSettings}
              onClick={() => {
                void leaveSettings();
              }}
              aria-label="Voltar ao Builder"
            >
              <ChevronLeft />
            </Button>
          )}
          <span className="text-xs font-semibold">Settings</span>
          {settingsDirty && <span className="size-1.5 rounded-full bg-amber-400" aria-label="Alterações não salvas" />}
        </div>
        <Select value={section} onValueChange={requestSection}>
          <SelectTrigger data-kodety-onboarding="settings-mobile-navigation" className="h-8 w-full text-xs" aria-label="Seção de configurações">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibleSiteSettingsSections.map(item => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
            {pages.map(path => (
              <SelectItem key={path} value={path}>
                Página · {pageLabel(path, homePage)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <aside data-kodety-onboarding="settings-navigation" className="hidden w-56 shrink-0 flex-col border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)] p-3 lg:flex">
        {backHref ? (
          <Button variant="ghost" size="sm" className="mb-3 justify-start gap-2 px-2" asChild>
            <a
              href={backHref}
              onClick={event => {
                event.preventDefault();
                void leaveSettings(backHref);
              }}
            >
              <ChevronLeft /> Settings
            </a>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 justify-start gap-2 px-2"
            disabled={leavingSettings}
            onClick={() => {
              void leaveSettings();
            }}
          >
            <ChevronLeft /> Settings
          </Button>
        )}
        <p className="mb-1.5 px-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
          Site Settings
        </p>
        <div className="space-y-1">
          {visibleSiteSettingsSections.map(({ id, label, sidebarIcon: Icon }) => navButton(id, label, <Icon />))}
        </div>
        <div className="my-3 border-t border-[var(--kodety-divider)]" />
        <p className="mb-1.5 px-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
          Page Settings
        </p>
        <div data-kodety-onboarding="settings-pages" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {pages.map(path =>
            navButton(path, pageLabel(path, homePage), path === homePage ? <Home2Icon /> : <FileTextIcon />),
          )}
        </div>
        <div className="mt-3 flex min-h-8 items-center gap-2 border-t border-[var(--kodety-divider)] px-2.5 pt-3 text-[10px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${settingsDirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          {settingsDirty ? 'Alterações não salvas' : 'Tudo salvo'}
        </div>
      </aside>

      <fieldset
        data-kodety-onboarding="settings-content"
        data-kodety-onboarding-section={section}
        disabled={(readOnly && section !== 'storage') || storageOperation === 'restore'}
        data-kodety-read-only={readOnly ? 'true' : undefined}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain border-0 p-0"
      >
        {readOnly && (
          <div className="sticky top-0 z-20 border-b border-violet-400/20 bg-[#17141d]/95 px-4 py-2 text-center text-[10px] font-medium text-violet-200 backdrop-blur">
            Somente leitura · configurações e páginas podem ser consultadas, mas não alteradas.
          </div>
        )}
        <div
          className={`mx-auto w-full px-4 pb-20 pt-6 sm:px-7 sm:pt-8 lg:px-8 lg:pt-10 ${section === 'cookie-consent' || section === 'code' || section === 'redirects' ? 'max-w-6xl' : 'max-w-4xl'}`}
        >
          {section === 'license' && license && <LicenseSettingsContent license={license} english={englishUi} />}
          {section === 'general' && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                eyebrowDetail={projectName}
                title="Geral"
                description="Identidade pública, imagens e comportamento compartilhados por todo o site."
                actions={
                  wordpress?.aiGenerateUrl && (
                    <Button size="sm" variant="secondary" disabled={aiLoading} onClick={() => openAiPrompt('site')}>
                      {aiLoading ? <Loader2 className="animate-spin" /> : <Sparkles />} Criar rascunho
                    </Button>
                  )
                }
              />
              <SettingsSection onboardingId="settings-identity" title="Identidade" description="Padrões para páginas, busca e integrações.">
                <SettingsField label="Nome do site" tip="Usado no título das páginas e nos dados estruturados.">
                  <Input
                    value={siteDraft.siteTitle || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        siteTitle: event.target.value,
                      })
                    }
                    placeholder={projectName}
                  />
                </SettingsField>
                <SettingsField label="Idioma">
                  <Select value={siteDraft.language || 'pt-BR'} onValueChange={updateSiteLanguage}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                      <SelectItem value="en-US">English (US)</SelectItem>
                      <SelectItem value="es-ES">Español</SelectItem>
                      <SelectItem value="fr-FR">Français</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsField>
                <SettingsField
                  label="Descrição geral"
                  tip="Fallback para páginas que não tiverem uma descrição própria."
                >
                  <Textarea
                    value={siteDraft.description || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        description: event.target.value,
                      })
                    }
                    placeholder="Explique o propósito do site em uma frase clara."
                    className="min-h-24"
                  />
                </SettingsField>
                <SettingsField onboardingId="settings-public-url" label="URL pública" tip="Base usada para gerar URLs canônicas. Ex.: https://meusite.com">
                  <Input
                    value={siteDraft.baseUrl || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        baseUrl: event.target.value,
                      })
                    }
                    placeholder="https://meusite.com"
                    aria-invalid={Boolean(baseUrlError)}
                  />
                  {baseUrlError && (
                    <p role="alert" className="mt-1 text-[10px] text-destructive">
                      {baseUrlError}
                    </p>
                  )}
                </SettingsField>
              </SettingsSection>

              <SettingsSection
                title="Imagens do site"
                onboardingId="settings-favicons"
                description="Favicons em PNG, SVG ou ICO, a partir de 64 × 64 px."
              >
                <SettingsField
                  label="Tema claro"
                  tip="Exibido quando o navegador ou sistema está no tema claro. Também funciona como fallback geral."
                >
                  <SettingsMediaPicker
                    value={siteDraft.faviconLight || ''}
                    onChange={faviconLight => setSiteDraft(current => ({ ...current, faviconLight }))}
                    connection={wordpress}
                    fallbackPlaceholder="URL do favicon claro"
                    loadProjectFile={loadProjectFile}
                    onUploadProjectImage={onUploadProjectImage ? uploadSettingsImage : undefined}
                    disabled={readOnly}
                    mode="favicon"
                    themeLabel="Light"
                    projectFiles={projectFiles}
                    projectRootPath={projectRootPath}
                    referencePath={homePage}
                    publicBaseUrl={siteDraft.baseUrl || ''}
                  />
                </SettingsField>
                <SettingsField
                  label="Tema escuro"
                  tip="Versão otimizada para abas e interfaces escuras. Se ficar vazio, o favicon claro será usado."
                >
                  <SettingsMediaPicker
                    value={siteDraft.faviconDark || ''}
                    onChange={faviconDark => setSiteDraft(current => ({ ...current, faviconDark }))}
                    connection={wordpress}
                    fallbackPlaceholder="Usar o favicon Light"
                    loadProjectFile={loadProjectFile}
                    onUploadProjectImage={onUploadProjectImage ? uploadSettingsImage : undefined}
                    disabled={readOnly}
                    mode="favicon"
                    themeLabel="Dark"
                    projectFiles={projectFiles}
                    projectRootPath={projectRootPath}
                    referencePath={homePage}
                    publicBaseUrl={siteDraft.baseUrl || ''}
                  />
                </SettingsField>
              </SettingsSection>

              <LicenseFeatureGate
                locked={socialImageLocked}
                title="Social Image exige licença ativa"
                description="Veja a biblioteca, os templates dinâmicos e o gerador visual que serão liberados assim que sua serial for ativada."
                licenseUrl={licenseUrl}
                onActivate={license ? () => void requestSection('license') : undefined}
                upgradeUrl={upgradeUrl}
              >
                <SettingsSection
                  title="Social Image padrão"
                  onboardingId="settings-social-defaults"
                  description="Imagem e modelo usados quando o conteúdo não define os próprios."
                >
                <SettingsField
                  label="Imagem padrão"
                  description="Fallback geral para Open Graph e Twitter/X. Continua disponível se o template dinâmico não puder ser renderizado."
                  tip={
                    wordpress
                      ? 'Escolha uma imagem da Biblioteca de Mídia ou envie uma nova diretamente para o WordPress.'
                      : 'Escolha uma imagem do projeto ou envie uma nova para a pasta do site.'
                  }
                >
                  <SettingsMediaPicker
                    value={siteDraft.socialImage || ''}
                    onChange={socialImage => setSiteDraft(current => ({ ...current, socialImage }))}
                    connection={wordpress}
                    fallbackPlaceholder="https://…/social.jpg"
                    loadProjectFile={loadProjectFile}
                    onUploadProjectImage={onUploadProjectImage ? uploadSettingsImage : undefined}
                    disabled={readOnly}
                    projectFiles={projectFiles}
                    projectRootPath={projectRootPath}
                    referencePath={homePage}
                    publicBaseUrl={siteDraft.baseUrl || ''}
                  />
                </SettingsField>
                <SettingsField
                  label="Social Image Builder"
                  description="Escolha um template reutilizável da biblioteca. Editá-lo atualiza todas as páginas vinculadas."
                >
                  <div className="space-y-2">
                    <ProjectSettingsFieldControl label="Template padrão" kind="image">
                      <Select
                        value={siteAssignedSocialImageTemplate?.id || '__none__'}
                        onValueChange={value =>
                          assignSocialImageTemplate('site', value === '__none__' ? undefined : value)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecionar template da biblioteca" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem template padrão</SelectItem>
                          {socialImageTemplateLibrary.map(template => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name} · {template.width} × {template.height}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </ProjectSettingsFieldControl>
                      <div
                        data-kodety-settings-card
                        className="flex min-h-20 flex-col gap-3 p-3 sm:flex-row sm:items-center"
                      >
                      <SocialImageTemplateThumbnail
                        template={siteAssignedSocialImageTemplate}
                        className="h-12 w-20"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-xs font-medium">
                            {siteAssignedSocialImageTemplate?.name || 'Nenhum template atribuído'}
                          </p>
                          {siteAssignedSocialImageTemplate && (
                            <span className="rounded-full bg-[var(--kodety-accent)]/10 px-2 py-0.5 text-[9px] font-medium text-[var(--kodety-accent-hover)]">
                              Padrão do site
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                          {siteAssignedSocialImageTemplate
                            ? `${siteAssignedSocialImageTemplate.width} × ${siteAssignedSocialImageTemplate.height} · ${siteAssignedSocialImageTemplate.elements.length} layers`
                            : 'Crie um template ou escolha um layout já salvo na biblioteca.'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={siteAssignedSocialImageTemplate ? 'secondary' : 'default'}
                        onClick={() => openSocialImageBuilder('site')}
                      >
                        <ImageIcon />
                        {siteAssignedSocialImageTemplate ? 'Editar Social Image' : 'Criar Social Image'}
                      </Button>
                    </div>
                  </div>
                </SettingsField>
                </SettingsSection>
              </LicenseFeatureGate>

              <SettingsSection title="Comportamento" description="Acessibilidade e navegação do projeto.">
                <SettingRow
                  title="Respeitar movimento reduzido"
                  description="Permite desativar movimentos quando o visitante usa a preferência de acessibilidade do sistema."
                  checked={siteDraft.reducedMotion ?? true}
                  onCheckedChange={reducedMotion => setSiteDraft({ ...siteDraft, reducedMotion })}
                />
                <SettingRow
                  title="Preservar parâmetros da URL"
                  description="Mantém UTMs e outros parâmetros durante a navegação interna."
                  checked={siteDraft.preserveQueryParameters ?? false}
                  onCheckedChange={preserveQueryParameters => setSiteDraft({ ...siteDraft, preserveQueryParameters })}
                />
                <SettingRow
                  title="Layout da direita para a esquerda"
                  description="Use para sites em árabe, hebraico e outros idiomas RTL."
                  checked={siteDraft.rightToLeft ?? false}
                  onCheckedChange={rightToLeft => setSiteDraft({ ...siteDraft, rightToLeft })}
                />
              </SettingsSection>
              <SaveBar
                host={saveBarHost}
                dirty={siteDirty}
                label="Salvar configurações"
                onSave={persistSite}
                saving={savingScope === 'site'}
                error={siteSaveError}
              />
            </div>
          )}

          {section === 'seo' && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                title="SEO e descoberta"
                description="Padrões compartilhados para busca, rastreamento e dados estruturados. Cada página pode sobrescrever estes valores."
              />
              <SettingsSection
                title="Metadados padrão"
                onboardingId="settings-seo-metadata"
                description="Valores usados quando a página não define os próprios."
              >
                <SettingsField
                  label="Modelo de título"
                  tip="Use %page% e %site%. O Builder mostra o resultado antes de publicar."
                >
                  <Input
                    value={siteDraft.titleTemplate || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        titleTemplate: event.target.value,
                      })
                    }
                    placeholder="%page% · %site%"
                  />
                </SettingsField>
              </SettingsSection>
              <SettingsSection onboardingId="settings-seo-preview" title="Prévia de busca" description="Prévia com os padrões atuais do site.">
                <div data-kodety-settings-preview className="w-full overflow-hidden">
                  <div className="flex h-9 items-center gap-2 border-b border-white/[.045] bg-black/[.06] px-3 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
                    <SearchCheck className="size-3.5" /> Resultado padrão
                  </div>
                  <div className="px-4 py-3">
                    <p className="truncate text-[15px] text-[var(--kodety-accent-hover)]">
                      Página · {siteDraft.siteTitle || projectName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-emerald-400">
                      {siteDraft.baseUrl || 'https://seusite.com'}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {siteDraft.description ||
                        'A descrição geral será exibida aqui quando uma página não tiver texto próprio.'}
                    </p>
                  </div>
                </div>
              </SettingsSection>
              <HtmlSearchConsoleSettings
                baseUrl={wordpress?.searchConsoleUrl}
                nonce={wordpress?.nonce}
                readOnly={readOnly}
                locked={!advancedSeo}
              />
              <LicenseFeatureGate
                locked={!advancedSeo}
                title="SEO avançado exige licença ativa"
                description="Robots avançado, Schema, rich results e verificações permanecem visíveis para você conhecer o fluxo antes de ativar a serial."
                licenseUrl={licenseUrl}
                onActivate={license ? () => void requestSection('license') : undefined}
                upgradeUrl={upgradeUrl}
              >
                <SettingsSection onboardingId="settings-seo-indexing" title="Robots e indexação" description="Padrões de indexação, sitemap e rastreamento.">
                <SettingRow
                  title="Indexar novas páginas"
                  description="Permite que mecanismos de busca mostrem novas páginas por padrão."
                  checked={siteDraft.defaultIndex ?? true}
                  onCheckedChange={defaultIndex => setSiteDraft({ ...siteDraft, defaultIndex })}
                />
                <SettingRow
                  title="Seguir links por padrão"
                  description="Permite que robôs descubram destinos ligados por páginas novas."
                  checked={siteDraft.defaultFollow ?? true}
                  onCheckedChange={defaultFollow => setSiteDraft({ ...siteDraft, defaultFollow })}
                />
                <SettingRow
                  title="Publicar sitemap XML"
                  description="Gera o sitemap próprio do Kodety em cada publicação, respeitando as URLs públicas e as exclusões de indexação."
                  checked={siteDraft.sitemapEnabled ?? true}
                  onCheckedChange={sitemapEnabled => setSiteDraft({ ...siteDraft, sitemapEnabled })}
                />
                {wordpress?.sitemapUrl && (
                  <Suspense fallback={<Loader2 className="size-4 animate-spin" aria-hidden="true" />}>
                    <HtmlSitemapSettings endpoint={wordpress.sitemapUrl} nonce={wordpress.nonce} />
                  </Suspense>
                )}
                <SettingRow
                  title="Bloquear robôs de treinamento de IA"
                  description="Adiciona regras para GPTBot, Google-Extended, CCBot, ClaudeBot e anthropic-ai sem bloquear mecanismos de busca."
                  checked={siteDraft.blockAiTrainingBots ?? false}
                  onCheckedChange={blockAiTrainingBots => setSiteDraft({ ...siteDraft, blockAiTrainingBots })}
                />
                <SettingRow
                  title="Não armazenar cópia em cache"
                  description="Adiciona noarchive às novas páginas."
                  checked={siteDraft.defaultRobots?.noArchive ?? false}
                  onCheckedChange={noArchive =>
                    setSiteDraft({
                      ...siteDraft,
                      defaultRobots: {
                        ...(siteDraft.defaultRobots || {}),
                        noArchive,
                      },
                    })
                  }
                />
                <SettingRow
                  title="Não indexar imagens"
                  description="Adiciona noimageindex às novas páginas."
                  checked={siteDraft.defaultRobots?.noImageIndex ?? false}
                  onCheckedChange={noImageIndex =>
                    setSiteDraft({
                      ...siteDraft,
                      defaultRobots: {
                        ...(siteDraft.defaultRobots || {}),
                        noImageIndex,
                      },
                    })
                  }
                />
                <SettingRow
                  title="Não oferecer tradução"
                  description="Adiciona notranslate às novas páginas."
                  checked={siteDraft.defaultRobots?.noTranslate ?? false}
                  onCheckedChange={noTranslate =>
                    setSiteDraft({
                      ...siteDraft,
                      defaultRobots: {
                        ...(siteDraft.defaultRobots || {}),
                        noTranslate,
                      },
                    })
                  }
                />
                <div className="grid gap-3 border-t border-[var(--kodety-divider)] py-4 md:grid-cols-3">
                  <Field label="Prévia de imagem" tip="large é recomendado para Discover e resultados visuais.">
                    <Select
                      value={siteDraft.defaultRobots?.maxImagePreview || 'large'}
                      onValueChange={(maxImagePreview: 'none' | 'standard' | 'large') =>
                        setSiteDraft({
                          ...siteDraft,
                          defaultRobots: {
                            ...(siteDraft.defaultRobots || {}),
                            maxImagePreview,
                          },
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="large">Grande</SelectItem>
                        <SelectItem value="standard">Padrão</SelectItem>
                        <SelectItem value="none">Nenhuma</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Máx. texto" tip="-1 permite qualquer tamanho; 0 remove o snippet.">
                    <Input
                      type="number"
                      min="-1"
                      value={siteDraft.defaultRobots?.maxSnippet ?? -1}
                      onChange={event =>
                        setSiteDraft({
                          ...siteDraft,
                          defaultRobots: {
                            ...(siteDraft.defaultRobots || {}),
                            maxSnippet: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Máx. vídeo" tip="-1 permite qualquer duração de prévia.">
                    <Input
                      type="number"
                      min="-1"
                      value={siteDraft.defaultRobots?.maxVideoPreview ?? -1}
                      onChange={event =>
                        setSiteDraft({
                          ...siteDraft,
                          defaultRobots: {
                            ...(siteDraft.defaultRobots || {}),
                            maxVideoPreview: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                <SettingsField
                  label="Regras adicionais de robots.txt"
                  onboardingId="settings-seo-robots-rules"
                  description="Use somente diretivas User-agent, Allow, Disallow, Crawl-delay, Sitemap e Host."
                >
                  <Textarea
                    className="min-h-28 font-mono text-[11px]"
                    value={siteDraft.robotsTxtRules || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        robotsTxtRules: event.target.value,
                      })
                    }
                    placeholder={'User-agent: *\nDisallow: /busca-interna/'}
                  />
                </SettingsField>
              </SettingsSection>
              <SettingsSection
                title="Identidade e Schema"
                onboardingId="settings-seo-schema"
                description="Entidades estruturadas compartilhadas pelo site."
              >
                <div className="mb-3 flex justify-end">
                  {wordpress?.aiGenerateUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={aiLoading}
                      onClick={() => void generateSchemaWithAi('site')}
                    >
                      {aiLoading ? <Loader2 className="animate-spin" /> : <Sparkles />} Gerar Schema com IA
                    </Button>
                  )}
                </div>
                <SettingsField label="Tipo de organização">
                  <Select
                    value={siteDraft.organizationType || 'Organization'}
                    onValueChange={(organizationType: NonNullable<SiteSeoSettings['organizationType']>) =>
                      setSiteDraft({ ...siteDraft, organizationType })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Organization">Organização</SelectItem>
                      <SelectItem value="Corporation">Empresa</SelectItem>
                      <SelectItem value="LocalBusiness">Negócio local</SelectItem>
                      <SelectItem value="ProfessionalService">Serviço profissional</SelectItem>
                      <SelectItem value="NGO">ONG</SelectItem>
                      <SelectItem value="EducationalOrganization">Instituição educacional</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsField>
                <SettingsField label="Nome da entidade">
                  <Input
                    value={siteDraft.organizationName || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        organizationName: event.target.value,
                      })
                    }
                    placeholder={siteDraft.siteTitle || projectName}
                  />
                </SettingsField>
                <SettingsField label="URL oficial">
                  <Input
                    value={siteDraft.organizationUrl || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        organizationUrl: event.target.value,
                      })
                    }
                    placeholder={siteDraft.baseUrl || 'https://seusite.com'}
                  />
                </SettingsField>
                <SettingsField label="Logo oficial">
                  <Input
                    value={siteDraft.organizationLogo || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        organizationLogo: event.target.value,
                      })
                    }
                    placeholder="https://seusite.com/logo.png"
                  />
                </SettingsField>
                <SettingsField
                  label="Perfis oficiais"
                  description="Uma URL por linha para sameAs: redes sociais, Wikidata, Crunchbase e perfis institucionais."
                >
                  <Textarea
                    className="min-h-24"
                    value={(siteDraft.organizationSameAs || []).join('\n')}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        organizationSameAs: event.target.value
                          .split(/\r?\n/)
                          .map(value => value.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={'https://www.linkedin.com/company/...\nhttps://www.instagram.com/...'}
                  />
                </SettingsField>
                <SettingRow
                  title="Publicar entidade WebSite"
                  description="Relaciona páginas, organização e ações de busca ao site principal."
                  checked={siteDraft.websiteSchema ?? true}
                  onCheckedChange={websiteSchema => setSiteDraft({ ...siteDraft, websiteSchema })}
                />
                <SettingsField
                  label="Busca interna"
                  tip="Use {search_term_string} onde o termo deve entrar. Deixe vazio quando o site não possui busca pública."
                >
                  <Input
                    value={siteDraft.websiteSearchUrlTemplate || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        websiteSearchUrlTemplate: event.target.value,
                      })
                    }
                    placeholder="https://seusite.com/busca?q={search_term_string}"
                  />
                </SettingsField>
                <SettingsField
                  label="JSON-LD global"
                  onboardingId="settings-seo-json-ld"
                  description="Entidades adicionais entram no mesmo @graph, sem duplicar Organization ou WebSite."
                >
                  <Textarea
                    className="min-h-48 font-mono text-[11px]"
                    value={siteDraft.globalSchemaJsonLd || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        globalSchemaJsonLd: event.target.value,
                      })
                    }
                    placeholder={'{\n  "@type": "Brand",\n  "name": "Minha marca"\n}'}
                    aria-invalid={Boolean(siteSchemaError)}
                  />
                  {siteSchemaError && (
                    <p role="alert" className="mt-1 text-[10px] text-destructive">
                      {siteSchemaError}
                    </p>
                  )}
                </SettingsField>
              </SettingsSection>
              <SettingsSection
                title="Verificação de buscadores"
                onboardingId="settings-seo-verification"
                description="Tags de verificação aplicadas a todas as páginas."
              >
                <SettingsField label="Google Search Console">
                  <Input
                    value={siteDraft.googleSiteVerification || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        googleSiteVerification: event.target.value,
                      })
                    }
                    placeholder="Código da meta tag"
                  />
                </SettingsField>
                <SettingsField label="Bing Webmaster Tools">
                  <Input
                    value={siteDraft.bingSiteVerification || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        bingSiteVerification: event.target.value,
                      })
                    }
                    placeholder="Código msvalidate.01"
                  />
                </SettingsField>
                <SettingsField label="Pinterest">
                  <Input
                    value={siteDraft.pinterestSiteVerification || ''}
                    onChange={event =>
                      setSiteDraft({
                        ...siteDraft,
                        pinterestSiteVerification: event.target.value,
                      })
                    }
                    placeholder="Código p:domain_verify"
                  />
                </SettingsField>
              </SettingsSection>
              </LicenseFeatureGate>
              <SaveBar
                host={saveBarHost}
                dirty={siteDirty}
                label="Aplicar padrões"
                onSave={persistSite}
                saving={savingScope === 'site'}
                error={siteSaveError}
              />
            </div>
          )}

          {section === 'cookie-consent' && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                title="Cookie Consent"
                description="Configure o banner, as preferências de privacidade e as categorias que controlam integrações e códigos publicados."
              />
              <Suspense
                fallback={
                  <div
                    className="grid min-h-[480px] place-items-center border-b border-[var(--kodety-divider)]"
                    role="status"
                  >
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <HtmlCookieConsentSettings
                  value={cookieConsentDraft}
                  activationLocked={cookieConsentActivationLocked}
                  upgradeUrl={upgradeUrl}
                  licenseUrl={licenseUrl}
                onActivate={license ? () => void requestSection('license') : undefined}
                  siteSettings={siteDraft}
                  customCode={customCodeDraft}
                  projectFiles={projectFiles}
                  onChange={setCookieConsentDraft}
                />
              </Suspense>
              <SaveBar
                host={saveBarHost}
                dirty={cookieConsentDirty}
                label="Salvar Cookie Consent"
                onSave={persistCookieConsent}
                saving={savingScope === 'cookie-consent'}
                error={cookieConsentSaveError}
              />
            </div>
          )}

          {section === 'code' && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                title="Custom Code"
                description="Insira scripts, estilos, tags de verificação e integrações no documento publicado, com controle de posição, páginas e execução."
              />
              <div className="flex items-start gap-2 border-b border-[var(--kodety-divider)] py-3 text-[10px] leading-4 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  Os códigos ficam isolados nos metadados do projeto e são materializados no HTML de forma
                  determinística ao publicar.
                </p>
              </div>
              <Suspense
                fallback={
                  <div
                    className="grid min-h-[360px] place-items-center border-b border-[var(--kodety-divider)]"
                    role="status"
                  >
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <HtmlCustomCodeSettings
                  value={customCodeDraft}
                  pages={pages}
                  homePage={homePage}
                  consentCategories={cookieConsentDraft.categories}
                  cookieConsentEnabled={cookieConsentDraft.enabled}
                  onChange={setCustomCodeDraft}
                />
              </Suspense>
              <SaveBar
                host={saveBarHost}
                dirty={customCodeDirty}
                label="Salvar Custom Code"
                onSave={persistCustomCode}
                saving={savingScope === 'custom-code'}
                error={customCodeSaveError}
              />
            </div>
          )}

          {section === 'redirects' && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                title="Redirects"
                description={license
                  ? englishUi
                    ? 'Redirect old or alternative URLs on your published HTML site. Rules take effect on your next deployment.'
                    : 'Redirecione URLs antigas ou alternativas no seu site HTML publicado. As regras entram em vigor no próximo deploy.'
                  : 'Redirecione URLs antigas ou alternativas. A ordem define a prioridade e as alterações entram no ar na próxima publicação.'}
              />
              <LicenseFeatureGate
                locked={redirectsLocked}
                title="Redirects exigem licença ativa"
                description="A tabela, as validações de ciclo e as regras 301/302/307/308 ficam disponíveis após ativar sua serial."
                licenseUrl={licenseUrl}
                onActivate={license ? () => void requestSection('license') : undefined}
                upgradeUrl={upgradeUrl}
              >
              <div className="flex items-start gap-2 border-b border-[var(--kodety-divider)] py-3 text-[10px] leading-4 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  {license
                    ? englishUi
                      ? 'Export includes redirect rules for Vercel and Cloudflare Pages. Conflicts and loops must be fixed before saving.'
                      : 'A exportação inclui regras de redirecionamento para Vercel e Cloudflare Pages. Conflitos e ciclos precisam ser corrigidos antes de salvar.'
                    : 'Rotas administrativas, APIs e arquivos internos do WordPress são protegidos. Conflitos e ciclos precisam ser corrigidos antes de salvar.'}
                </p>
              </div>
              <Suspense
                  fallback={
                    <div
                      className="grid min-h-[360px] place-items-center border-b border-[var(--kodety-divider)]"
                      role="status"
                    >
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                  }
              >
                <HtmlRedirectSettings
                  value={redirectDraft}
                  onChange={setRedirectDraft}
                  hostMode={license ? 'html' : 'wordpress'}
                  language={englishUi ? 'en' : 'pt'}
                />
              </Suspense>
              <SaveBar
                host={saveBarHost}
                dirty={redirectDirty}
                label="Salvar redirects"
                onSave={persistRedirects}
                saving={savingScope === 'redirects'}
                error={redirectSaveError}
              />
              </LicenseFeatureGate>
            </div>
          )}

          {section === 'mcp' && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                title="Integrações e IA"
                description="Medição, conexões administrativas e serviços assistidos usados pelo projeto."
              />
              <LicenseFeatureGate
                locked={integrationsLocked}
                title="Integrações, MCP e IA exigem licença ativa"
                description="Confira os provedores, conexões MCP, automações e configurações disponíveis. Ative a serial para configurar e executar estes recursos."
                licenseUrl={licenseUrl}
                onActivate={license ? () => void requestSection('license') : undefined}
                upgradeUrl={upgradeUrl}
              >
              <SettingsSection
                title="Analytics"
                onboardingId="settings-integration-analytics"
                description="Medição sem scripts manuais, com privacidade centralizada."
                collapsible
                defaultOpen={false}
                forceOpen={integrationsLocked}
                collapseId="integrations-analytics"
              >
                <AnalyticsIntegration
                  name="Google Analytics 4"
                  description="Tráfego, aquisição, eventos e conversões."
                  value={siteDraft.googleAnalyticsId || ''}
                  placeholder="G-XXXXXXXXXX"
                  valid={value => /^G-[A-Z0-9]+$/i.test(value)}
                  onChange={googleAnalyticsId => setSiteDraft({ ...siteDraft, googleAnalyticsId })}
                />
                <AnalyticsIntegration
                  name="Google Tag Manager"
                  description="Tags e pixels gerenciados pelo contêiner."
                  value={siteDraft.googleTagManagerId || ''}
                  placeholder="GTM-XXXXXXX"
                  valid={value => /^GTM-[A-Z0-9]+$/i.test(value)}
                  onChange={googleTagManagerId => setSiteDraft({ ...siteDraft, googleTagManagerId })}
                />
                <AnalyticsIntegration
                  name="Microsoft Clarity"
                  description="Mapas de calor e gravações de sessão."
                  value={siteDraft.microsoftClarityId || ''}
                  placeholder="Project ID"
                  valid={value => /^[a-z0-9]+$/i.test(value)}
                  onChange={microsoftClarityId => setSiteDraft({ ...siteDraft, microsoftClarityId })}
                />
                <AnalyticsIntegration
                  name="Meta Pixel"
                  description="PageView, públicos e conversões da Meta."
                  value={siteDraft.metaPixelId || ''}
                  placeholder="123456789012345"
                  valid={value => /^\d+$/.test(value)}
                  onChange={metaPixelId => setSiteDraft({ ...siteDraft, metaPixelId })}
                />
                <div className="border-t border-[var(--kodety-divider)] py-4">
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xs font-medium">Meta Conversions API</h3>
                        <span
                          className={`text-[10px] ${metaCapi.enabled && metaCapi.configured ? 'text-emerald-400' : 'text-muted-foreground'}`}
                        >
                          {metaCapi.enabled && metaCapi.configured
                            ? 'Server-side ativo'
                            : metaCapi.configured
                              ? 'Configurado'
                              : 'Não configurado'}
                        </span>
                      </div>
                      <p className="mt-1 max-w-2xl text-[10px] leading-[1.5] text-muted-foreground">
                          Envia eventos pelo WordPress, deduplica com o Pixel pelo mesmo event_id, aplica hash SHA-256
                          aos dados de correspondência e tenta novamente em falhas temporárias.
                      </p>
                    </div>
                    <div className="min-w-[148px]">
                      <HtmlSettingsToggleControl
                        label={metaCapi.enabled ? 'Ativa' : 'Inativa'}
                        checked={metaCapi.enabled}
                        onChange={enabled => setMetaCapi(current => ({ ...current, enabled }))}
                        disabled={!wordpress?.metaCapiSettingsUrl || metaCapiLoading}
                      />
                    </div>
                  </div>
                  {!wordpress?.metaCapiSettingsUrl ? (
                      <p
                        data-kodety-settings-card
                        className="mt-3 px-3 py-2 text-[10px] leading-4 text-muted-foreground"
                      >
                      A CAPI server-side fica disponível quando o projeto está conectado ao plugin WordPress.
                    </p>
                  ) : (
                    <div data-kodety-settings-card className="mt-4 space-y-3 p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field
                          label="Token de acesso"
                          tip="Criado no Gerenciador de Eventos da Meta. É criptografado no WordPress e nunca é incluído no HTML ou no ZIP."
                        >
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={metaCapiToken}
                            onChange={event => setMetaCapiToken(event.target.value)}
                            placeholder={metaCapi.configured ? 'Token salvo — deixe vazio para manter' : 'EAA…'}
                            className="font-mono text-xs"
                          />
                        </Field>
                        <Field
                          label="Versão da Graph API"
                          tip="Mantenha explícita para que atualizações da Meta não alterem a integração sem revisão."
                        >
                          <Input
                            value={metaCapi.graphVersion}
                            onChange={event =>
                              setMetaCapi(current => ({
                                ...current,
                                graphVersion: event.target.value,
                              }))
                            }
                            placeholder="v23.0"
                            className="font-mono text-xs"
                          />
                        </Field>
                      </div>
                      <Field
                        label="Código de evento de teste"
                        tip="Opcional. Copie o código da aba Testar eventos no Gerenciador de Eventos para validar sem misturar com os dados de produção."
                      >
                        <Input
                          value={metaCapi.testEventCode}
                          onChange={event =>
                            setMetaCapi(current => ({
                              ...current,
                              testEventCode: event.target.value.toUpperCase(),
                            }))
                          }
                          placeholder="TEST12345"
                          className="font-mono text-xs"
                        />
                      </Field>
                      <SettingRow
                        title="Limited Data Use (LDU)"
                        description="Adiciona as opções de processamento de dados da Meta. País e estado em 0 permitem a geolocalização da Meta."
                        checked={metaCapi.limitedDataUse}
                        onCheckedChange={limitedDataUse =>
                          setMetaCapi(current => ({
                            ...current,
                            limitedDataUse,
                          }))
                        }
                      />
                      {metaCapi.limitedDataUse && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <Field label="País (código Meta)">
                            <Input
                              type="number"
                              min={0}
                              value={metaCapi.dataProcessingCountry}
                              onChange={event =>
                                setMetaCapi(current => ({
                                  ...current,
                                  dataProcessingCountry: Number(event.target.value) || 0,
                                }))
                              }
                            />
                          </Field>
                          <Field label="Estado (código Meta)">
                            <Input
                              type="number"
                              min={0}
                              value={metaCapi.dataProcessingState}
                              onChange={event =>
                                setMetaCapi(current => ({
                                  ...current,
                                  dataProcessingState: Number(event.target.value) || 0,
                                }))
                              }
                            />
                          </Field>
                        </div>
                      )}
                      {metaCapi.lastResult && (
                        <div
                          className={`rounded-[9px] border px-3 py-2 text-[10px] leading-4 ${metaCapi.lastResult.success ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}
                        >
                          <p className="font-medium">
                            {metaCapi.lastResult.success ? 'Último envio aceito' : 'Último envio falhou'}
                          </p>
                          <p className="mt-0.5 opacity-80">
                            {metaCapi.lastResult.message}
                            {metaCapi.lastResult.requestId ? ` · ${metaCapi.lastResult.requestId}` : ''}
                            {metaCapi.queuedEvents ? ` · ${metaCapi.queuedEvents} na fila` : ''}
                          </p>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        {metaCapi.configured && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={metaCapiLoading}
                            onClick={() => void saveMetaCapi({ clearToken: true })}
                          >
                            Remover token
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={metaCapiLoading}
                          onClick={() => void testMetaCapi()}
                        >
                          {metaCapiLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                          Enviar evento de teste
                        </Button>
                        <Button size="sm" disabled={metaCapiLoading} onClick={() => void saveMetaCapi()}>
                          {metaCapiLoading && <Loader2 className="animate-spin" />}
                          Salvar CAPI
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <AnalyticsIntegration
                  name="Plausible Analytics"
                  description="Medição leve e focada em privacidade."
                  value={siteDraft.plausibleDomain || ''}
                  placeholder="meusite.com"
                  valid={value => /^[a-z0-9.-]+$/i.test(value)}
                  onChange={plausibleDomain => setSiteDraft({ ...siteDraft, plausibleDomain })}
                />
                <SettingsField
                  label="Carregamento"
                  description="No modo consentimento, use kodetyAnalyticsConsent(true) ou o evento kodety:analytics-consent."
                >
                  <Select
                    value={siteDraft.analyticsConsentMode || 'immediate'}
                    onValueChange={(analyticsConsentMode: 'immediate' | 'consent') =>
                      setSiteDraft({ ...siteDraft, analyticsConsentMode })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Imediatamente</SelectItem>
                      <SelectItem value="consent">Após consentimento</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsField>
                <SettingRow
                  title="Respeitar Do Not Track"
                  description="Não carrega integrações quando o navegador envia o sinal global de não rastreamento."
                  checked={siteDraft.analyticsRespectDnt ?? true}
                  onCheckedChange={analyticsRespectDnt => setSiteDraft({ ...siteDraft, analyticsRespectDnt })}
                />
              </SettingsSection>
              <SettingsSection
                title="MCP"
                onboardingId="settings-integration-mcp"
                description="Acesso restrito ao projeto para agentes compatíveis."
                collapsible
                defaultOpen={false}
                forceOpen={integrationsLocked}
                collapseId="integrations-mcp"
              >
                {settingsContent?.mcp || (!wordpress ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    A conexão MCP está disponível dentro do plugin WordPress.
                  </p>
                ) : (
                  <Suspense
                    fallback={
                      <p data-kodety-mcp-settings-loading className="py-3 text-sm text-muted-foreground">
                        Carregando MCP…
                      </p>
                    }
                  >
                    <HtmlMcpSettingsContent
                      wordpress={wordpress}
                      status={mcpStatus}
                      loading={mcpLoading}
                      command={mcpCommand}
                      remoteConfig={mcpRemoteConfig}
                      projectConnections={mcpProjectConnections}
                      projectConnectionsLoading={mcpProjectConnectionsLoading}
                      projectConnectionsError={mcpProjectConnectionsError}
                      revokingProjectConnectionId={mcpRevokingProjectConnectionId}
                      onRefresh={loadMcpStatus}
                      onRefreshProjectConnections={loadMcpProjectConnections}
                      onCreateProjectConnection={createProjectMcpConnection}
                      onRevokeProjectConnection={revokeProjectMcpConnection}
                      onCopySkillInstallPrompt={copyMcpSkillInstallPrompt}
                      onChangeConnection={changeMcp}
                    />
                  </Suspense>
                ))}
              </SettingsSection>
              {(integrationsLocked || Boolean(wordpress?.aiSettingsUrl)) && (
                <SettingsSection
                  title="IA de conteúdo"
                  onboardingId="settings-integration-ai"
                  description="Provedor usado pelo CMS e pelas ações assistidas."
                  collapsible
                  defaultOpen={false}
                  forceOpen={integrationsLocked}
                  collapseId="integrations-ai"
                >
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <p className="text-sm font-medium">Provedor</p>
                    <span
                      className={`text-[11px] ${aiSettings.configured ? 'text-emerald-400' : 'text-muted-foreground'}`}
                    >
                      {aiSettings.configured ? 'Conectado' : 'Não conectado'}
                    </span>
                  </div>
                  <div role="radiogroup" aria-label="Provedor de IA" className="space-y-2">
                    {AI_PROVIDERS.map(provider => {
                      const active = provider.id === aiSettings.provider;
                      const connected = aiSettings.configuredProviders?.[provider.id];
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => selectAiProvider(provider)}
                          className={`group/provider flex min-h-14 w-full items-stretch overflow-hidden rounded-[9px] border text-left outline-none transition-[border-color,background-color] ${active ? 'border-white/[.065] bg-white/[.075] text-foreground' : 'border-white/[.025] bg-white/[.025] text-muted-foreground hover:border-white/[.045] hover:bg-white/[.05] hover:text-foreground'} focus-visible:border-[var(--kodety-focus)]/70`}
                        >
                            <span
                              className={`grid w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.06] transition-colors ${active ? 'text-[var(--kodety-accent-hover)]' : 'text-white/30 group-hover/provider:text-white/60'}`}
                            >
                            <HtmlAiProviderLogo provider={provider.id} />
                          </span>
                          <span className="min-w-0 flex-1 px-3 py-2">
                            <span className="block text-sm font-medium">{provider.label}</span>
                            <span className="mt-0.5 block text-[11px]">{provider.description}</span>
                          </span>
                            {connected && (
                              <span className="self-center px-3 text-[10px] text-emerald-400">Chave salva</span>
                            )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-5">
                    <SettingsField onboardingId="settings-ai-model" label="Modelo">
                      {selectedAiProvider.models.length ? (
                        <Select
                          value={aiSettings.model}
                            onValueChange={model =>
                              setAiSettings(current => ({
                                ...current,
                                model,
                              }))
                            }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedAiProvider.models.map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={aiSettings.model}
                          onChange={event =>
                            setAiSettings(current => ({
                              ...current,
                              model: event.target.value,
                            }))
                          }
                          placeholder="ID do modelo"
                        />
                      )}
                    </SettingsField>
                    <SettingsField
                      label="Chave da API"
                      onboardingId="settings-ai-api-key"
                      description={`${selectedAiProvider.id === 'codex' ? 'O perfil Codex usa a chave da OpenAI. ' : ''}Criptografada no WordPress.`}
                    >
                      <Input
                        type="password"
                        value={aiKey}
                        onChange={event => setAiKey(event.target.value)}
                        placeholder={
                          aiSettings.configured
                            ? '••••••••  Chave salva'
                            : `Cole a chave de ${selectedAiProvider.label}`
                        }
                        autoComplete="new-password"
                      />
                    </SettingsField>
                    {aiSettings.provider === 'custom' && (
                      <SettingsField label="Endpoint">
                        <Input
                          value={aiSettings.baseUrl}
                          onChange={event =>
                            setAiSettings(current => ({
                              ...current,
                              baseUrl: event.target.value,
                            }))
                          }
                          placeholder="https://seu-provedor.com/v1"
                        />
                      </SettingsField>
                    )}
                  </div>
                  <details data-kodety-settings-disclosure className="group border-t border-[var(--kodety-divider)] py-2">
                    <DisclosureSummary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-transparent px-2 text-[11px] font-medium text-muted-foreground outline-none hover:bg-white/[.035] hover:text-foreground focus-visible:border-[var(--kodety-focus)]/70">
                      <span>Preferências de escrita</span>
                    </DisclosureSummary>
                    <div className="mt-2 border-t border-[var(--kodety-divider)] pb-2">
                      <SettingsField label="Idioma">
                        <Input
                          value={aiSettings.language}
                          onChange={event =>
                            setAiSettings(current => ({
                              ...current,
                              language: event.target.value,
                            }))
                          }
                        />
                      </SettingsField>
                      <SettingsField label="Tom">
                        <Input
                          value={aiSettings.tone}
                          onChange={event =>
                            setAiSettings(current => ({
                              ...current,
                              tone: event.target.value,
                            }))
                          }
                        />
                      </SettingsField>
                      <SettingsField label="Criatividade">
                        <Slider
                          min={0}
                          max={1.5}
                          step={0.1}
                          value={[aiSettings.temperature]}
                          onValueChange={([temperature]) =>
                              setAiSettings(current => ({
                                ...current,
                                temperature,
                              }))
                          }
                        />
                      </SettingsField>
                    </div>
                  </details>
                  <div className="flex flex-col gap-3 border-t border-[var(--kodety-divider)] pt-4 sm:flex-row sm:items-center">
                    <p className="min-w-0 flex-1 text-[11px] leading-5 text-muted-foreground">
                      <ShieldCheck className="mr-1 inline size-3" />A chave não aparece no navegador, nas páginas
                      publicadas ou nas respostas do MCP.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={aiLoading || (!aiSettings.configured && !aiKey)}
                        onClick={() => void testAi()}
                      >
                        {aiLoading ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Testar
                      </Button>
                      <Button
                        disabled={aiLoading || (!aiSettings.configured && !aiKey)}
                        onClick={() => void saveAiSettings()}
                      >
                        Salvar provedor
                      </Button>
                    </div>
                  </div>
                </SettingsSection>
              )}
              {(integrationsLocked
                || wordpress?.adobeFontsLicensed !== undefined
                || Boolean(wordpress?.adobeFontsSettingsUrl)) && (
                <SettingsSection
                  title="Adobe Fonts"
                  onboardingId="settings-integration-fonts"
                  description="Famílias do seu Web Project disponíveis no catálogo de fontes."
                  collapsible
                  defaultOpen={false}
                  forceOpen={integrationsLocked}
                  collapseId="integrations-adobe-fonts"
                >
                  <HtmlAdobeFontsSettings
                    licensed={wordpress?.adobeFontsLicensed}
                    settingsUrl={wordpress?.adobeFontsSettingsUrl}
                    syncUrl={wordpress?.adobeFontsSyncUrl}
                    nonce={wordpress?.nonce}
                    readOnly={readOnly || wordpress?.canManageIntegrations === false}
                  />
                </SettingsSection>
              )}
              {wordpress?.shopifySettingsUrl && (
                <SettingsSection
                  title="Shopify"
                  onboardingId="settings-integration-shopify"
                  description="Catálogo, carrinho e checkout conectados ao projeto."
                  collapsible
                  defaultOpen={false}
                  collapseId="integrations-shopify"
                >
                  {!shopifySettings ? (
                    <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                      {shopifyLoading && <Loader2 className="size-3.5 animate-spin" />}
                      Carregando configuração da Shopify…
                    </p>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-4 border-b border-[var(--kodety-divider)] pb-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Conexão da loja</p>
                          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            O token fica criptografado no WordPress e nunca entra no projeto publicado.
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] ${shopifySettings.hasStorefrontToken ? 'text-emerald-400' : 'text-muted-foreground'}`}
                        >
                          {shopifySettings.hasStorefrontToken ? 'Conectada' : 'Não conectada'}
                        </span>
                      </div>

                      <SettingsField onboardingId="settings-shopify-domain" label="Domínio permanente" description="Use o domínio myshopify.com da loja.">
                        <Input
                          value={shopifySettings.shopDomain}
                          onChange={event =>
                            setShopifySettings({
                              ...shopifySettings,
                              shopDomain: event.target.value,
                            })
                          }
                          placeholder="minha-loja.myshopify.com"
                          autoComplete="off"
                        />
                      </SettingsField>
                      <SettingsField
                        label="Token Storefront"
                        onboardingId="settings-shopify-token"
                        description="A Storefront API fornece produtos, variantes, disponibilidade, carrinho e checkout."
                      >
                        <div className="space-y-2">
                          <ProjectSettingsFieldControl label="Tipo de token" kind="option">
                            <Select
                              value={shopifySettings.storefrontTokenType}
                              onValueChange={(storefrontTokenType: 'public' | 'private') =>
                                setShopifySettings({
                                  ...shopifySettings,
                                  storefrontTokenType,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="public">Público</SelectItem>
                                <SelectItem value="private">Privado via WordPress</SelectItem>
                              </SelectContent>
                            </Select>
                          </ProjectSettingsFieldControl>
                          <ProjectSettingsFieldControl label="Token Storefront" kind="code">
                            <Input
                              type="password"
                              value={shopifyStorefrontToken}
                              onChange={event => setShopifyStorefrontToken(event.target.value)}
                              autoComplete="new-password"
                              placeholder={
                                shopifySettings.hasStorefrontToken
                                  ? 'Token salvo — deixe vazio para preservar'
                                  : 'Cole o token da Storefront API'
                              }
                            />
                          </ProjectSettingsFieldControl>
                          {shopifySettings.hasStorefrontToken && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={shopifyLoading}
                              onClick={() => void saveShopifySettings('storefront')}
                            >
                              Remover token Storefront
                            </Button>
                          )}
                        </div>
                      </SettingsField>
                      <SettingsField
                        label="Mercado"
                        onboardingId="settings-shopify-market"
                        description="País e idioma usados nas consultas da Storefront API."
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="grid gap-1.5 text-[10px] text-muted-foreground">
                            <span>País (ISO)</span>
                            <ProjectSettingsFieldControl label="País (ISO)" kind="option">
                              <Input
                                maxLength={2}
                                value={shopifySettings.country}
                                onChange={event =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    country: event.target.value.toUpperCase(),
                                  })
                                }
                              />
                            </ProjectSettingsFieldControl>
                          </label>
                          <label className="grid gap-1.5 text-[10px] text-muted-foreground">
                            <span>Idioma (ISO)</span>
                            <ProjectSettingsFieldControl label="Idioma (ISO)" kind="option">
                              <Input
                                maxLength={2}
                                value={shopifySettings.language}
                                onChange={event =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    language: event.target.value.toUpperCase(),
                                  })
                                }
                              />
                            </ProjectSettingsFieldControl>
                          </label>
                        </div>
                      </SettingsField>
                      <SettingsField
                        label="Rotas no WordPress"
                        onboardingId="settings-shopify-routes"
                        description="Endereços públicos usados pela loja e pelos itens dinâmicos."
                      >
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {Object.entries(SHOPIFY_ROUTE_LABELS).map(([key, label]) => (
                            <label key={key} className="grid gap-1.5 text-[10px] text-muted-foreground">
                              <span>{label}</span>
                              <ProjectSettingsFieldControl label={label} kind="link">
                                <Input
                                  value={shopifySettings.routes[key] || `/${key}/`}
                                  onChange={event =>
                                    setShopifySettings({
                                      ...shopifySettings,
                                      routes: {
                                        ...shopifySettings.routes,
                                        [key]: event.target.value,
                                      },
                                    })
                                  }
                                />
                              </ProjectSettingsFieldControl>
                            </label>
                          ))}
                        </div>
                      </SettingsField>
                      <SettingsField
                        label="Templates dinâmicos"
                        onboardingId="settings-shopify-templates"
                        description="Rota da página do Builder usada para renderizar cada produto ou coleção."
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="grid gap-1.5 text-[10px] text-muted-foreground">
                            <span>Produto</span>
                            <ProjectSettingsFieldControl label="Template de produto" kind="component">
                              <Input
                                value={shopifySettings.templates?.product || 'product'}
                                onChange={event =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    templates: {
                                      ...(shopifySettings.templates || {}),
                                      product: event.target.value,
                                    },
                                  })
                                }
                                placeholder="product"
                              />
                            </ProjectSettingsFieldControl>
                          </label>
                          <label className="grid gap-1.5 text-[10px] text-muted-foreground">
                            <span>Coleção</span>
                            <ProjectSettingsFieldControl label="Template de coleção" kind="collection">
                              <Input
                                value={shopifySettings.templates?.collection || 'collection'}
                                onChange={event =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    templates: {
                                      ...(shopifySettings.templates || {}),
                                      collection: event.target.value,
                                    },
                                  })
                                }
                                placeholder="collection"
                              />
                            </ProjectSettingsFieldControl>
                          </label>
                        </div>
                      </SettingsField>
                        <details
                          data-kodety-settings-disclosure
                          className="group border-y border-[var(--kodety-divider)] py-2"
                          open
                        >
                        <DisclosureSummary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-transparent px-2 text-xs font-medium outline-none hover:bg-white/[.035] hover:text-foreground focus-visible:border-[var(--kodety-focus)]/70">
                          <span className="min-w-0 flex-1">Checkout headless</span>
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {
                              SHOPIFY_CHECKOUT_PROVIDERS.find(item => item.id === shopifySettings.checkout.provider)
                                ?.label
                            }
                          </span>
                        </DisclosureSummary>
                        <div className="mt-2 border-t border-[var(--kodety-divider)] pb-3">
                          <SettingsField
                            label="Provedor"
                            description="O estoque e o carrinho continuam na Shopify; apenas a etapa final é entregue ao provedor escolhido."
                          >
                            <div className="space-y-3">
                              <Select
                                value={shopifySettings.checkout.provider}
                                onValueChange={(provider: ShopifySettingsState['checkout']['provider']) =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    checkout: {
                                      ...shopifySettings.checkout,
                                      provider,
                                      strategy: ['shopify', 'appmax_shopify'].includes(provider)
                                        ? 'native'
                                        : shopifySettings.checkout.strategy === 'native'
                                          ? 'session'
                                          : shopifySettings.checkout.strategy,
                                    },
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {SHOPIFY_CHECKOUT_PROVIDERS.map(provider => (
                                    <SelectItem key={provider.id} value={provider.id}>
                                      {provider.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-[10px] leading-4 text-muted-foreground">
                                {
                                    SHOPIFY_CHECKOUT_PROVIDERS.find(
                                      item => item.id === shopifySettings.checkout.provider,
                                    )?.description
                                }
                              </p>
                            </div>
                          </SettingsField>
                          {!['shopify', 'appmax_shopify'].includes(shopifySettings.checkout.provider) && (
                            <SettingsField
                              label="Integração"
                              description="Bridge envia o carrinho autoritativo pelo servidor; link monta uma URL HTTPS com placeholders."
                            >
                              <Select
                                value={shopifySettings.checkout.strategy}
                                onValueChange={(strategy: 'link' | 'session') =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    checkout: {
                                      ...shopifySettings.checkout,
                                      strategy,
                                    },
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="session">Bridge/API server-to-server</SelectItem>
                                  <SelectItem value="link">Link seguro parametrizado</SelectItem>
                                </SelectContent>
                              </Select>
                            </SettingsField>
                          )}
                          {!['shopify', 'appmax_shopify'].includes(shopifySettings.checkout.provider) &&
                            shopifySettings.checkout.strategy === 'session' && (
                              <>
                                <SettingsField
                                  label="Endpoint de sessão"
                                  description="O WordPress envia um snapshot autoritativo do carrinho por POST; a resposta deve conter url ou checkoutUrl."
                                >
                                  <Input
                                    value={shopifySettings.checkout.endpointUrl}
                                    onChange={event =>
                                      setShopifySettings({
                                        ...shopifySettings,
                                        checkout: {
                                          ...shopifySettings.checkout,
                                          endpointUrl: event.target.value,
                                        },
                                      })
                                    }
                                    placeholder="https://checkout.exemplo.com/api/sessions"
                                    autoComplete="off"
                                  />
                                </SettingsField>
                                <SettingsField
                                  label="Segredo do endpoint"
                                  description="Enviado como Bearer e usado para assinar o payload HMAC. Fica criptografado no WordPress."
                                >
                                  <div className="space-y-2">
                                    <Input
                                      type="password"
                                      value={shopifyCheckoutSecret}
                                      onChange={event => setShopifyCheckoutSecret(event.target.value)}
                                      autoComplete="new-password"
                                      placeholder={
                                        shopifySettings.checkout.hasEndpointSecret
                                          ? 'Segredo salvo — deixe vazio para preservar'
                                          : 'Segredo Bearer/HMAC'
                                      }
                                    />
                                    {shopifySettings.checkout.hasEndpointSecret && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={shopifyLoading}
                                        onClick={() => void saveShopifySettings('checkout')}
                                      >
                                        Remover segredo
                                      </Button>
                                    )}
                                  </div>
                                </SettingsField>
                              </>
                            )}
                          {!['shopify', 'appmax_shopify'].includes(shopifySettings.checkout.provider) &&
                            shopifySettings.checkout.strategy === 'link' && (
                              <SettingsField
                                label="Template do link"
                                description="Placeholders: {cart_id}, {checkout_url}, {shop_domain}, {return_url}, {cancel_url}, {currency}, {total} e {items_b64}."
                              >
                                <Input
                                  value={shopifySettings.checkout.linkTemplate}
                                  onChange={event =>
                                    setShopifySettings({
                                      ...shopifySettings,
                                      checkout: {
                                        ...shopifySettings.checkout,
                                        linkTemplate: event.target.value,
                                      },
                                    })
                                  }
                                  placeholder="https://checkout.exemplo.com/iniciar?cart={cart_id}&items={items_b64}"
                                  autoComplete="off"
                                />
                              </SettingsField>
                            )}
                          {!['shopify', 'appmax_shopify'].includes(shopifySettings.checkout.provider) && (
                            <SettingsField
                              label="Hosts de checkout permitidos"
                              onboardingId="settings-shopify-checkout-hosts"
                              description="Uma linha por domínio. A navegação é recusada se a API ou o link apontar para outro host."
                            >
                              <Textarea
                                rows={3}
                                value={(shopifySettings.checkout.allowedHosts || []).join('\n')}
                                onChange={event =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    checkout: {
                                      ...shopifySettings.checkout,
                                      allowedHosts: event.target.value
                                        .split(/[\n,;]+/)
                                        .map(value => value.trim())
                                        .filter(Boolean),
                                    },
                                  })
                                }
                                placeholder="checkout.sualoja.com.br"
                              />
                            </SettingsField>
                          )}
                          <SettingsField
                            label="Experiência"
                            description="O Checkout Overlay editável revisa carrinho e transição; dados sensíveis continuam sempre no ambiente seguro do provedor."
                          >
                            <div className="space-y-3">
                              <Select
                                value={shopifySettings.checkout.experience}
                                onValueChange={(experience: 'redirect' | 'overlay') =>
                                  setShopifySettings({
                                    ...shopifySettings,
                                    checkout: {
                                      ...shopifySettings.checkout,
                                      experience,
                                    },
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="redirect">Redirecionar imediatamente</SelectItem>
                                  <SelectItem value="overlay">Confirmar em overlay editável</SelectItem>
                                </SelectContent>
                              </Select>
                              {shopifySettings.checkout.experience === 'overlay' && (
                                <label className="grid gap-1.5 text-[10px] text-muted-foreground">
                                  <span>Seletor do overlay</span>
                                  <ProjectSettingsFieldControl label="Seletor do overlay" kind="code">
                                    <Input
                                      value={shopifySettings.checkout.overlaySelector}
                                      onChange={event =>
                                        setShopifySettings({
                                          ...shopifySettings,
                                          checkout: {
                                            ...shopifySettings.checkout,
                                            overlaySelector: event.target.value,
                                          },
                                        })
                                      }
                                      placeholder="[data-kodefy-checkout-overlay]"
                                    />
                                  </ProjectSettingsFieldControl>
                                </label>
                              )}
                            </div>
                          </SettingsField>
                          <SettingsField
                            label="Retorno ao WordPress"
                            onboardingId="settings-shopify-return"
                            description="URLs locais entregues ao checkout próprio para sucesso/cancelamento."
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="grid gap-1.5 text-[10px] text-muted-foreground">
                                <span>Retorno</span>
                                <ProjectSettingsFieldControl label="Retorno" kind="link">
                                  <Input
                                    value={shopifySettings.checkout.returnPath}
                                    onChange={event =>
                                      setShopifySettings({
                                        ...shopifySettings,
                                        checkout: {
                                          ...shopifySettings.checkout,
                                          returnPath: event.target.value,
                                        },
                                      })
                                    }
                                    placeholder="/"
                                  />
                                </ProjectSettingsFieldControl>
                              </label>
                              <label className="grid gap-1.5 text-[10px] text-muted-foreground">
                                <span>Cancelamento</span>
                                <ProjectSettingsFieldControl label="Cancelamento" kind="link">
                                  <Input
                                    value={shopifySettings.checkout.cancelPath}
                                    onChange={event =>
                                      setShopifySettings({
                                        ...shopifySettings,
                                        checkout: {
                                          ...shopifySettings.checkout,
                                          cancelPath: event.target.value,
                                        },
                                      })
                                    }
                                    placeholder="/cart/"
                                  />
                                </ProjectSettingsFieldControl>
                              </label>
                            </div>
                          </SettingsField>
                          <div className="grid gap-2 border-t border-[var(--kodety-divider)] py-4 sm:grid-cols-2">
                            <HtmlSettingsToggleControl
                              label="Fallback Shopify"
                              description="Usar checkout oficial se o provedor falhar."
                              checked={shopifySettings.checkout.fallbackToShopify}
                              onChange={fallbackToShopify =>
                                setShopifySettings({
                                  ...shopifySettings,
                                  checkout: {
                                    ...shopifySettings.checkout,
                                    fallbackToShopify,
                                  },
                                })
                              }
                            />
                            <HtmlSettingsToggleControl
                              label="Nova aba"
                              description="Mantém a loja aberta durante o checkout."
                              checked={shopifySettings.checkout.openInNewTab}
                              onChange={openInNewTab =>
                                setShopifySettings({
                                  ...shopifySettings,
                                  checkout: {
                                    ...shopifySettings.checkout,
                                    openInNewTab,
                                  },
                                })
                              }
                            />
                          </div>
                        </div>
                      </details>
                      {shopifySync && (
                        <div
                          data-kodety-settings-card
                          className={`px-3 py-3 text-[11px] leading-5 ${shopifySync.error ? 'text-amber-300' : 'text-muted-foreground'}`}
                        >
                          {shopifySync.error ||
                            (shopifySync.configured
                              ? `${shopifySync.productCount || 0}${shopifySync.hasMoreProducts ? '+' : ''} produtos sincronizados com o Builder${shopifySync.syncedAt ? ` · ${new Date(shopifySync.syncedAt).toLocaleString(getAdminUiLocale())}` : ''}.`
                              : 'Conecte a Shopify para sincronizar o catálogo com o Builder.')}
                        </div>
                      )}

                      <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                          {wordpress.templatesUrl && (
                            <Button type="button" size="sm" variant="ghost" asChild>
                              <a href={wordpress.templatesUrl}>Abrir templates</a>
                            </Button>
                          )}
                          {wordpress.shopifyDownloadKitUrl && (
                            <Button type="button" size="sm" variant="ghost" asChild>
                              <a href={wordpress.shopifyDownloadKitUrl}>Baixar kit</a>
                            </Button>
                          )}
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={shopifyTesting || !shopifySettings.hasStorefrontToken}
                            onClick={() => void testShopifyConnection()}
                          >
                            {shopifyTesting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Testar
                          </Button>
                          {wordpress.shopifyBuilderDataUrl && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={shopifySyncing || !shopifySettings.hasStorefrontToken}
                              onClick={() => void refreshShopifyCatalog()}
                            >
                              {shopifySyncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            disabled={shopifyLoading}
                            onClick={() => void saveShopifySettings()}
                          >
                            {shopifyLoading && <Loader2 className="animate-spin" />} Salvar Shopify
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </SettingsSection>
              )}
              <SaveBar
                host={saveBarHost}
                dirty={siteDirty}
                label="Salvar integrações"
                onSave={persistSite}
                saving={savingScope === 'site'}
                error={siteSaveError}
              />
              </LicenseFeatureGate>
            </div>
          )}

          {section === 'agents' && settingsContent?.agents}
          {section === 'agents' && !settingsContent?.agents && wordpress?.agentUrl && (
            <div>
              <SettingsHeader
                eyebrow="Settings · Integrações"
                title="Agentes"
                description="Conta, integrações e skills usadas pelo modo Agent dentro do Builder."
              />
              <Suspense fallback={<Loader2 className="size-4 animate-spin" aria-hidden="true" />}>
                <HtmlAgentSettings
                  agentUrl={wordpress.agentUrl}
                  nonce={wordpress.agentNonce || wordpress.nonce}
                  readOnly={readOnly}
                  onUseMcp={() => void requestSection('mcp')}
                  onAccountConnected={() => {
                    void (async () => {
                      if (wordpress.editorUrl) {
                        const destination = new URL(wordpress.editorUrl, window.location.href);
                        destination.searchParams.set('kodety_panel', 'agent');
                        await leaveSettings(destination.toString());
                        return;
                      }
                      if (!await prepareSettingsLeave()) return;
                      window.dispatchEvent(new Event(OPEN_HTML_AGENT_PANEL_EVENT));
                      await leaveSettings();
                    })();
                  }}
                />
              </Suspense>
            </div>
          )}

          {section === 'storage' && wordpress?.storageUrl && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                title="Armazenamento"
                description="Visualize e restaure snapshots de publicação ou gerencie o armazenamento do projeto."
                actions={
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={storageLoading || Boolean(storageOperation)}
                    onClick={() => void loadStorageStatus()}
                  >
                    <RefreshCw className={storageLoading ? 'animate-spin' : ''} /> Atualizar
                  </Button>
                }
              />
              <SettingsSection
                title="Snapshots de publicação"
                onboardingId="settings-storage-snapshots"
                description="Visualize uma versão antes de restaurar ou baixe seus arquivos em ZIP. A prévia e o download não alteram o projeto aberto nem o site publicado."
              >
                <div data-kodety-settings-card className="divide-y divide-white/[.045] px-3 text-xs">
                  <div className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]">
                    <span className="text-muted-foreground">Snapshots armazenados</span>
                    <span className="font-medium tabular-nums">
                      {storageState ? storageState.snapshots.count : storageLoading ? 'Consultando…' : 'Indisponível'}
                    </span>
                  </div>
                  <div className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]">
                    <span className="text-muted-foreground">Release publicada</span>
                    <span className="break-all font-medium">
                      {storageState ? storageState.snapshots.currentRelease || 'Nenhuma publicação registrada' : '—'}
                    </span>
                  </div>
                </div>
                {storageError && (
                  <p role="alert" className="mt-4 text-xs text-destructive">
                    {storageError}
                  </p>
                )}
                {storageLoading && !storageState && (
                  <p role="status" className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Carregando snapshots…
                  </p>
                )}
                {storageState &&
                  (storageState.snapshots.items.length > 0 ? (
                    <ul
                      aria-label="Snapshots disponíveis"
                      className="mt-4 divide-y divide-[var(--kodety-divider)] rounded-[9px] border border-[var(--kodety-divider)]"
                    >
                      {storageState.snapshots.items.map(snapshot => (
                        <li key={snapshot.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div className="min-w-0 space-y-1">
                            <p className="break-all text-xs font-medium">{snapshot.id}</p>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <time dateTime={snapshot.modified}>
                                {new Date(snapshot.modified).toLocaleString(getAdminUiLocale())}
                              </time>
                              {snapshot.current && (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                                  Publicação atual
                    </span>
                              )}
                  </div>
                </div>
                          <div className="flex flex-wrap gap-2">
                            {snapshot.previewUrl && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={Boolean(storageOperation)}
                                onClick={() => setSnapshotPreview(snapshot)}
                              >
                                <Eye /> Visualizar
                              </Button>
                            )}
                            {snapshot.downloadUrl ? (
                              storageOperation ? (
                                <Button type="button" size="sm" variant="secondary" disabled>
                                  <Download /> Baixar ZIP
                                </Button>
                              ) : (
                                <Button size="sm" variant="secondary" asChild>
                                  <a
                                    href={snapshot.downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Baixar snapshot ${snapshot.id} em ZIP`}
                                    data-kodety-snapshot-download
                                  >
                                    <Download /> Baixar ZIP
                                  </a>
                                </Button>
                              )
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Arquivos indisponíveis</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 rounded-[9px] border border-dashed border-[var(--kodety-divider)] p-4 text-xs leading-5 text-muted-foreground">
                      Nenhum snapshot disponível. Novos snapshots são criados ao publicar o projeto.
                    </p>
                  ))}
                <div className="mt-4 border-y border-[var(--kodety-divider)] py-3">
                  <HtmlSettingsToggleControl
                    label="Incluir o snapshot atualmente publicado"
                    description="Remove também o ponto de restauração da release atual. O site que já está no ar continua funcionando."
                    checked={includePublishedSnapshot}
                    disabled={readOnly || !storageState?.snapshots.currentStored || Boolean(storageOperation)}
                    onChange={setIncludePublishedSnapshot}
                  />
                </div>
                <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-[11px] leading-5 text-muted-foreground">
                    {includePublishedSnapshot
                      ? 'Todos os snapshots privados serão apagados em uma única operação.'
                      : 'A release publicada será preservada; todos os outros snapshots serão apagados.'}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={readOnly || storageLoading || Boolean(storageOperation) || !storageState?.snapshots.count}
                    onClick={() => setStorageConfirmation('snapshots')}
                  >
                    {storageOperation === 'snapshots' ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Apagar snapshots em massa
                  </Button>
                </div>
              </SettingsSection>
              <SettingsSection title="Zona de perigo" description="Exclui o projeto aberto e seus snapshots.">
                <div className="rounded-[9px] border border-destructive/30 bg-destructive/[0.035] p-4">
                  <div className="grid gap-2 text-xs sm:grid-cols-[150px_1fr]">
                    <span className="text-muted-foreground">Projeto aberto</span>
                    <span className="break-all font-medium">{storageState?.project.name || projectName}</span>
                    <span className="text-muted-foreground">Endereço</span>
                    <span className="font-medium">
                      {storageState?.project.isRoot ? 'Raiz do domínio' : 'Subrota própria'}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 border-t border-destructive/20 pt-4 sm:flex-row sm:items-center">
                    <p className="min-w-0 flex-1 text-[11px] leading-5 text-muted-foreground">
                      A exclusão remove o projeto aberto e seus pontos de restauração. Esta ação não pode ser desfeita.
                    </p>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={
                        readOnly || storageLoading || Boolean(storageOperation) || !storageState?.project.hasWorkspace
                      }
                      onClick={() => {
                        setProjectConfirmation('');
                        setStorageConfirmation('project');
                      }}
                    >
                      {storageOperation === 'project' ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      Excluir este projeto
                    </Button>
                  </div>
                </div>
              </SettingsSection>
            </div>
          )}

          {section === 'beta' && (
            <div>
              <SettingsHeader
                eyebrow="Site Settings"
                title="Recursos experimentais"
                description="Ative somente para testes controlados. Recursos Alpha e Beta podem mudar de comportamento entre versões."
              />
              <div data-kodety-settings-card className="my-5 flex items-start gap-2 px-3 py-3 text-xs leading-5 text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <p>
                  Todos os recursos abaixo ficam desativados por padrão. Os dados existentes são preservados quando uma
                  opção é desligada.
                </p>
              </div>
              {hydratedFramerProject && (
                <SettingsSection title="Importações Framer" description="Beta · edição de sites Framer animados.">
                  <SettingRow
                    title="Permitir edição de sites Framer"
                    description="Libera seleção, layers, código e controles visuais. Ao desligar, o import volta ao modo fiel, animado e somente leitura. Não se aplica a imports estáticos, que são sempre editáveis."
                    checked={siteDraft.betaFeatures?.framerSiteEditing ?? false}
                    onCheckedChange={framerSiteEditing =>
                      setSiteDraft({
                        ...siteDraft,
                        betaFeatures: {
                          ...(siteDraft.betaFeatures || {}),
                          framerSiteEditing,
                        },
                      })
                    }
                  />
                </SettingsSection>
              )}
              <LicenseFeatureGate
                locked={infiniteCanvasLocked}
                title="Canvas Infinito exige uma licença Pro ativa"
                description="Ative a licença para disponibilizar este recurso Beta no Builder."
                licenseUrl={licenseUrl}
                onActivate={license ? () => void requestSection('license') : undefined}
                upgradeUrl={upgradeUrl}
              >
                <SettingsSection title="Canvas Infinito" description="Beta · múltiplos breakpoints no mesmo canvas.">
                  <SettingRow
                    title="Disponibilizar Canvas Infinito"
                    description="Este modo ainda é instável e pode apresentar falhas de sincronização. Ative somente se quiser testá-lo por sua conta e risco. O Builder continuará abrindo no canvas normal."
                    checked={siteDraft.betaFeatures?.infiniteCanvas ?? false}
                    onCheckedChange={(infiniteCanvas) => {
                      if (infiniteCanvas && infiniteCanvasLocked) return;
                      setSiteDraft({
                        ...siteDraft,
                        betaFeatures: {
                          ...(siteDraft.betaFeatures || {}),
                          infiniteCanvas,
                        },
                      });
                    }}
                  />
                </SettingsSection>
              </LicenseFeatureGate>
              <SaveBar
                host={saveBarHost}
                dirty={siteDirty}
                label="Salvar experimentos"
                onSave={persistSite}
                saving={savingScope === 'site'}
                error={siteSaveError}
              />
            </div>
          )}

          {selectedPage && (
            <div>
              <SettingsHeader
                eyebrow={`Page Settings · ${selectedPage}`}
                title={pageLabel(selectedPage, homePage)}
                description={
                  templateCollection
                    ? `Metadados dinâmicos conectados à collection ${templateCollection.name}.`
                    : 'Metadados, descoberta e compartilhamento desta página.'
                }
                actions={
                  <>
                    <SeoScoreMeter score={seoScore} />
                    {wordpress?.aiGenerateUrl && (
                      <Button size="sm" variant="secondary" disabled={aiLoading} onClick={() => openAiPrompt('page')}>
                        {aiLoading ? <Loader2 className="animate-spin" /> : <Sparkles />} Criar rascunho
                      </Button>
                    )}
                  </>
                }
              />
              {templateCollection && (
                <SettingsSection
                  title={`CMS · ${templateCollection.name}`}
                  description="Combine texto e campos. A prévia usa o primeiro item."
                >
                  <div className="flex justify-end pb-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setPageDraft({
                          ...pageDraft,
                          title: '{{title}}',
                          description: '{{excerpt}}',
                          canonicalUrl: '{{permalink}}',
                          socialTitle: '{{title}}',
                          socialDescription: '{{excerpt}}',
                          socialImage: '{{featured_image}}',
                        })
                      }
                    >
                      Conectar campos padrão
                    </Button>
                  </div>
                  <SettingsField label="Título dinâmico">
                    <CmsBindingInput
                      value={pageDraft.title || ''}
                      onChange={title => setPageDraft({ ...pageDraft, title })}
                      fields={templateCollection.fields}
                      placeholder="Ex.: Nome do projeto · Minha marca"
                    />
                  </SettingsField>
                  <SettingsField label="Descrição">
                    <CmsBindingInput
                      multiline
                      value={pageDraft.description || ''}
                      onChange={description => setPageDraft({ ...pageDraft, description })}
                      fields={templateCollection.fields.filter(
                        field => !['image', 'gallery', 'file'].includes(field.type || ''),
                      )}
                      placeholder="Escolha os campos que descrevem cada item"
                    />
                  </SettingsField>
                  <SettingsField label="URL de cada item">
                    <CmsBindingInput
                      value={pageDraft.canonicalUrl || ''}
                      onChange={canonicalUrl => setPageDraft({ ...pageDraft, canonicalUrl })}
                      fields={templateCollection.fields.filter(
                        field =>
                          ['permalink', 'slug'].includes(field.key) || ['url', 'link'].includes(field.type || ''),
                      )}
                      placeholder="{{permalink}}"
                    />
                  </SettingsField>
                  <SettingsField
                    label="Imagem social (fallback)"
                    description={
                      pageHasOwnManualSocialImage
                        ? 'Esta collection sobrescreve a imagem padrão definida em Geral.'
                        : 'Vazio: cada item herda a imagem padrão definida em Geral.'
                    }
                  >
                    <CmsBindingInput
                      value={pageDraft.socialImage || ''}
                      onChange={socialImage => setPageDraft({ ...pageDraft, socialImage })}
                      fields={templateCollection.fields.filter(
                        field => ['featured_image'].includes(field.key) || ['image', 'url'].includes(field.type || ''),
                      )}
                      placeholder={
                        siteDraft.socialImage ? 'Herdar imagem padrão de Geral' : 'Escolha uma imagem da collection'
                      }
                    />
                  </SettingsField>
                  <div data-kodety-settings-card className="mt-4 divide-y divide-white/[.045] px-3 text-xs">
                    <div className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]">
                      <span className="text-muted-foreground">Rota publicada</span>
                      <span className="truncate font-medium">
                        /{templateCollection.restBase || templateCollection.slug}
                        /:slug
                      </span>
                    </div>
                    <div className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]">
                      <span className="text-muted-foreground">Campos disponíveis</span>
                      <span>{templateCollection.fields.length}</span>
                    </div>
                    <div className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]">
                      <span className="text-muted-foreground">Item da prévia</span>
                      <span className="truncate">{String(cmsSample.title || 'Nenhum item publicado')}</span>
                    </div>
                  </div>
                </SettingsSection>
              )}
              {!templateCollection && (
                <SettingsSection onboardingId="settings-page-metadata" title="Metadados" description="Título, URL e descrição da página.">
                  <SettingsField label="Título da página" tip="Recomendado: entre 30 e 60 caracteres.">
                    <Input
                      value={pageDraft.title || ''}
                      onChange={event =>
                        setPageDraft({
                          ...pageDraft,
                          title: event.target.value,
                        })
                      }
                      placeholder="Título claro e específico"
                    />
                    <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
                      {pageDraft.title?.length || 0}/60
                    </p>
                  </SettingsField>
                  <SettingsField label="URL" tip="Renomear a URL também renomeia o arquivo publicado.">
                    <Input
                      value={pagePath}
                      disabled={selectedPage === homePage}
                      onChange={event => setPagePath(event.target.value)}
                      aria-invalid={Boolean(pageSaveError && (!pagePath.trim() || duplicatePagePath))}
                    />
                    {pageSaveError && (!pagePath.trim() || duplicatePagePath) && (
                      <p role="alert" className="mt-1 text-[10px] text-destructive">
                        {pageSaveError}
                      </p>
                    )}
                  </SettingsField>
                  <SettingsField label="Descrição" tip="Recomendado: entre 120 e 160 caracteres.">
                    <Textarea
                      value={pageDraft.description || ''}
                      onChange={event =>
                        setPageDraft({
                          ...pageDraft,
                          description: event.target.value,
                        })
                      }
                      className="min-h-24"
                      placeholder="Resuma o conteúdo e o benefício desta página."
                    />
                    <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
                      {pageDraft.description?.length || 0}/160
                    </p>
                  </SettingsField>
                  <SettingsField
                    label="URL canônica"
                    tip="Deixe vazio para gerar automaticamente usando a URL pública do site."
                  >
                    <Input
                      value={pageDraft.canonicalUrl || ''}
                      onChange={event =>
                        setPageDraft({
                          ...pageDraft,
                          canonicalUrl: event.target.value,
                        })
                      }
                      placeholder="Automática"
                      aria-invalid={Boolean(canonicalUrlError)}
                    />
                    {canonicalUrlError && (
                      <p role="alert" className="mt-1 text-[10px] text-destructive">
                        {canonicalUrlError}
                      </p>
                    )}
                  </SettingsField>
                </SettingsSection>
              )}
              <LicenseFeatureGate
                locked={!advancedSeo}
                title="SEO avançado da página exige licença ativa"
                description="Descoberta avançada, Schema, metadados sociais e Social Image serão liberados após a ativação."
                licenseUrl={licenseUrl}
                onActivate={license ? () => void requestSection('license') : undefined}
                upgradeUrl={upgradeUrl}
              >
              <SettingsSection onboardingId="settings-page-indexing" title="Descoberta" description="Controle a indexação desta página.">
                <SettingRow
                  title="Aparecer nos mecanismos de busca"
                  description="Gera index ou noindex na página publicada."
                  checked={pageDraft.index ?? siteDraft.defaultIndex ?? true}
                  onCheckedChange={index => setPageDraft({ ...pageDraft, index })}
                />
                <SettingRow
                  title="Permitir que robôs sigam os links"
                  description="Gera follow ou nofollow na página publicada."
                  checked={pageDraft.follow ?? siteDraft.defaultFollow ?? true}
                  onCheckedChange={follow => setPageDraft({ ...pageDraft, follow })}
                />
                <SettingRow
                  title="Incluir no sitemap"
                  description="Inclui a URL pública desta página no sitemap gerado na publicação, quando a indexação estiver permitida."
                  checked={pageDraft.includeInSitemap ?? true}
                  onCheckedChange={includeInSitemap => setPageDraft({ ...pageDraft, includeInSitemap })}
                />
                <details className="group border-t border-[var(--kodety-divider)]">
                  <DisclosureSummary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground">
                    Diretivas avançadas
                  </DisclosureSummary>
                  <div className="border-t border-[var(--kodety-divider)]">
                    <SettingRow
                      title="Não armazenar em cache"
                      description="Adiciona noarchive somente nesta página."
                      checked={pageDraft.robots?.noArchive ?? siteDraft.defaultRobots?.noArchive ?? false}
                      onCheckedChange={noArchive =>
                        setPageDraft({
                          ...pageDraft,
                          robots: { ...(pageDraft.robots || {}), noArchive },
                        })
                      }
                    />
                    <SettingRow
                      title="Não indexar imagens"
                      description="Adiciona noimageindex somente nesta página."
                      checked={pageDraft.robots?.noImageIndex ?? siteDraft.defaultRobots?.noImageIndex ?? false}
                      onCheckedChange={noImageIndex =>
                        setPageDraft({
                          ...pageDraft,
                            robots: {
                              ...(pageDraft.robots || {}),
                              noImageIndex,
                            },
                        })
                      }
                    />
                    <SettingRow
                      title="Sem snippet"
                      description="Remove texto e vídeo de prévia desta página."
                      checked={pageDraft.robots?.noSnippet ?? false}
                      onCheckedChange={noSnippet =>
                        setPageDraft({
                          ...pageDraft,
                          robots: { ...(pageDraft.robots || {}), noSnippet },
                        })
                      }
                    />
                    <SettingRow
                      title="Não oferecer tradução"
                      description="Adiciona notranslate somente nesta página."
                      checked={pageDraft.robots?.noTranslate ?? siteDraft.defaultRobots?.noTranslate ?? false}
                      onCheckedChange={noTranslate =>
                        setPageDraft({
                          ...pageDraft,
                            robots: {
                              ...(pageDraft.robots || {}),
                              noTranslate,
                            },
                        })
                      }
                    />
                    <div className="grid gap-3 py-4 md:grid-cols-3">
                      <Field label="Prévia de imagem">
                        <Select
                          value={
                            pageDraft.robots?.maxImagePreview || siteDraft.defaultRobots?.maxImagePreview || 'large'
                          }
                          onValueChange={(maxImagePreview: 'none' | 'standard' | 'large') =>
                            setPageDraft({
                              ...pageDraft,
                              robots: {
                                ...(pageDraft.robots || {}),
                                maxImagePreview,
                              },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="large">Grande</SelectItem>
                            <SelectItem value="standard">Padrão</SelectItem>
                            <SelectItem value="none">Nenhuma</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Máx. texto">
                        <Input
                          type="number"
                          min="-1"
                          value={pageDraft.robots?.maxSnippet ?? siteDraft.defaultRobots?.maxSnippet ?? -1}
                          onChange={event =>
                            setPageDraft({
                              ...pageDraft,
                              robots: {
                                ...(pageDraft.robots || {}),
                                maxSnippet: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </Field>
                      <Field label="Máx. vídeo">
                        <Input
                          type="number"
                          min="-1"
                          value={pageDraft.robots?.maxVideoPreview ?? siteDraft.defaultRobots?.maxVideoPreview ?? -1}
                          onChange={event =>
                            setPageDraft({
                              ...pageDraft,
                              robots: {
                                ...(pageDraft.robots || {}),
                                maxVideoPreview: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </Field>
                    </div>
                  </div>
                </details>
              </SettingsSection>
              <SettingsSection
                title="Schema e rich results"
                onboardingId="settings-page-schema"
                description={
                  templateCollection
                    ? `JSON-LD dinâmico para itens de ${templateCollection.name}.`
                    : 'Dados estruturados validados no @graph do site.'
                }
              >
                <div className="mb-3 flex flex-wrap justify-end gap-2">
                  {pageDraft.schemaType !== 'none' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setPageDraft({
                          ...pageDraft,
                          schemaJsonLd: JSON.stringify(
                            schemaStarter(
                              (pageDraft.schemaType || 'WebPage') as Exclude<SeoSchemaType, 'none'>,
                              Boolean(templateCollection),
                            ),
                            null,
                            2,
                          ),
                        })
                      }
                    >
                      <Braces /> Usar modelo
                    </Button>
                  )}
                  {wordpress?.aiGenerateUrl && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={aiLoading}
                      onClick={() => void generateSchemaWithAi('page')}
                    >
                      {aiLoading ? <Loader2 className="animate-spin" /> : <Sparkles />} Gerar em um clique
                    </Button>
                  )}
                </div>
                <SettingsField label="Tipo principal">
                  <Select
                    value={pageDraft.schemaType || 'WebPage'}
                    onValueChange={value =>
                      setPageDraft({
                        ...pageDraft,
                        schemaType: value as SeoSchemaType,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEMA_TYPES.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsField>
                {pageDraft.schemaType !== 'none' && (
                  <SettingsField
                    label={templateCollection ? 'JSON-LD conectado' : 'JSON-LD personalizado'}
                    description={
                      templateCollection
                        ? 'Insira campos em qualquer propriedade. O runtime resolve os valores do item antes de responder ao crawler.'
                        : 'Vazio usa o Schema automático. Ao preencher, este objeto substitui somente a entidade da página.'
                    }
                  >
                    {templateCollection ? (
                      <CmsBindingInput
                        multiline
                        value={pageDraft.schemaJsonLd || ''}
                        onChange={schemaJsonLd => setPageDraft({ ...pageDraft, schemaJsonLd })}
                        fields={schemaBindingFields}
                        placeholder={
                          '{\n  "@context": "https://schema.org",\n  "@type": "Article",\n  "headline": "{{title}}"\n}'
                        }
                      />
                    ) : (
                      <Textarea
                        className="min-h-64 font-mono text-[11px]"
                        value={pageDraft.schemaJsonLd || ''}
                        onChange={event =>
                          setPageDraft({
                            ...pageDraft,
                            schemaJsonLd: event.target.value,
                          })
                        }
                          placeholder={
                            englishUi
                              ? 'Empty: generate automatically from the selected type'
                              : 'Vazio: gerar automaticamente pelo tipo selecionado'
                          }
                        aria-invalid={Boolean(pageSchemaError)}
                      />
                    )}
                    {pageSchemaError && (
                      <p role="alert" className="mt-1 text-[10px] text-destructive">
                        {pageSchemaError}
                      </p>
                    )}
                  </SettingsField>
                )}
              </SettingsSection>
              <SettingsSection
                title="Compartilhamento"
                onboardingId="settings-page-sharing"
                description="Título, descrição e imagem para compartilhamento."
              >
                <SettingsField label="Título social">
                  {templateCollection ? (
                    <CmsBindingInput
                      value={pageDraft.socialTitle || ''}
                      onChange={socialTitle => setPageDraft({ ...pageDraft, socialTitle })}
                      fields={templateCollection.fields}
                      placeholder="Usar título dinâmico"
                    />
                  ) : (
                    <Input
                      value={pageDraft.socialTitle || ''}
                      onChange={event =>
                        setPageDraft({
                          ...pageDraft,
                          socialTitle: event.target.value,
                        })
                      }
                      placeholder="Usar título da página"
                    />
                  )}
                </SettingsField>
                <SettingsField label="Descrição social">
                  {templateCollection ? (
                    <CmsBindingInput
                      multiline
                      value={pageDraft.socialDescription || ''}
                      onChange={socialDescription => setPageDraft({ ...pageDraft, socialDescription })}
                      fields={templateCollection.fields.filter(
                        field => !['image', 'gallery', 'file'].includes(field.type || ''),
                      )}
                      placeholder="Usar descrição dinâmica"
                    />
                  ) : (
                    <Textarea
                      value={pageDraft.socialDescription || ''}
                      onChange={event =>
                        setPageDraft({
                          ...pageDraft,
                          socialDescription: event.target.value,
                        })
                      }
                      placeholder={englishUi ? 'Use page description' : 'Usar descrição da página'}
                    />
                  )}
                </SettingsField>
                {!templateCollection && (
                  <SettingsField
                    label="Imagem manual (fallback)"
                    description={
                      pageHasOwnManualSocialImage
                        ? 'Imagem exclusiva desta página. Remova para voltar a herdar o padrão de Geral.'
                        : pageInheritsManualSocialImage
                          ? 'Herdando automaticamente a imagem padrão definida em Geral.'
                          : 'Defina uma imagem aqui ou configure o padrão do site em Geral.'
                    }
                  >
                    <div className="space-y-2">
                      <SettingsMediaPicker
                        value={pageDraft.socialImage || ''}
                        onChange={socialImage => setPageDraft(current => ({ ...current, socialImage }))}
                        connection={wordpress}
                        fallbackPlaceholder="Herdar imagem padrão de Geral"
                        loadProjectFile={loadProjectFile}
                        onUploadProjectImage={onUploadProjectImage ? uploadSettingsImage : undefined}
                        disabled={readOnly}
                        projectFiles={projectFiles}
                        projectRootPath={projectRootPath}
                        referencePath={selectedPage || homePage}
                        publicBaseUrl={siteDraft.baseUrl || ''}
                      />
                      {pageInheritsManualSocialImage && (
                        <div className="flex items-center gap-2 rounded-[9px] border border-[var(--kodety-accent)]/20 bg-[var(--kodety-accent)]/5 px-2.5 py-2 text-[10px] text-muted-foreground">
                          <ImageIcon className="size-3.5 shrink-0 text-[var(--kodety-accent-hover)]" />
                          <span className="min-w-0 flex-1 truncate" title={siteDraft.socialImage}>
                            Imagem padrão de Geral
                          </span>
                          <span className="shrink-0 rounded-full bg-[var(--kodety-accent)]/10 px-2 py-0.5 font-medium text-[var(--kodety-accent-hover)]">
                            Herdada
                          </span>
                        </div>
                      )}
                    </div>
                  </SettingsField>
                )}
                <div data-kodety-settings-preview className="mt-3 w-full overflow-hidden">
                  <div className="flex h-9 items-center gap-2 border-b border-white/[.045] bg-black/[.06] px-3 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
                    <ImageIcon className="size-3.5" /> Prévia de compartilhamento
                  </div>
                  {liveSocialImagePreview && (
                    <div className="w-full overflow-hidden bg-black/20">
                      <ProportionalSocialImage
                        src={liveSocialImagePreview}
                        alt="Prévia da imagem social no cartão de compartilhamento"
                      />
                    </div>
                  )}
                  <div className="space-y-0.5 px-3 py-2.5">
                    <p className="truncate text-xs font-medium">{liveSocialTitle}</p>
                      <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                        {liveSocialDescription}
                      </p>
                    <p className="truncate pt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                      {siteDraft.baseUrl || 'https://seusite.com'}
                    </p>
                  </div>
                </div>
              </SettingsSection>
              <SettingsSection
                title="Social Image"
                onboardingId="settings-page-social-image"
                description={
                  templateCollection
                    ? `Um modelo para cada item de ${templateCollection.name}.`
                    : 'Herde o padrão do site ou personalize esta página.'
                }
              >
                <div className="mb-2">
                  <ProjectSettingsFieldControl label="Template da Social Image" kind="image">
                    <Select
                      value={pageAssignedSocialImageTemplate?.id || '__inherit__'}
                      onValueChange={value =>
                        assignSocialImageTemplate('page', value === '__inherit__' ? undefined : value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecionar template da biblioteca" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__inherit__">
                          Herdar do site
                          {siteAssignedSocialImageTemplate ? ` · ${siteAssignedSocialImageTemplate.name}` : ''}
                        </SelectItem>
                        {socialImageTemplateLibrary.map(template => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name} · {template.width} × {template.height}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </ProjectSettingsFieldControl>
                </div>
                  <div
                    data-kodety-settings-card
                    className="flex min-h-20 flex-col gap-3 p-3 sm:flex-row sm:items-center"
                  >
                    <SocialImageTemplateThumbnail template={effectivePageSocialImageTemplate} className="h-14 w-24" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-xs font-medium">
                        {effectivePageSocialImageTemplate?.name || 'Nenhum template criado'}
                      </p>
                      {!pageHasOwnSocialImageTemplate && siteAssignedSocialImageTemplate && (
                        <span className="rounded-full bg-[var(--kodety-accent)]/10 px-2 py-0.5 text-[9px] font-medium text-[var(--kodety-accent-hover)]">
                          Herdado do site
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                      {pageAssignedSocialImageTemplate
                        ? `${pageAssignedSocialImageTemplate.width} × ${pageAssignedSocialImageTemplate.height} · template compartilhado`
                        : siteAssignedSocialImageTemplate
                          ? 'Personalizar cria uma cópia com novo ID sem alterar o padrão do site.'
                          : 'Adicione layers e conecte variáveis dinâmicas do conteúdo.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={pageHasOwnSocialImageTemplate ? 'secondary' : 'default'}
                    onClick={() => openSocialImageBuilder('page')}
                  >
                    <ImageIcon />
                    {pageHasOwnSocialImageTemplate
                      ? 'Editar Social Image'
                      : siteAssignedSocialImageTemplate
                        ? 'Personalizar Social Image'
                        : 'Criar Social Image'}
                  </Button>
                </div>
              </SettingsSection>
              </LicenseFeatureGate>
              <SettingsSection
                title="Prévia de busca"
                description={
                  templateCollection
                    ? 'Prévia com o primeiro item publicado.'
                    : 'Prévia aproximada nos resultados de busca.'
                }
              >
                <div data-kodety-settings-preview className="w-full overflow-hidden">
                  <div className="flex h-9 items-center gap-2 border-b border-white/[.045] bg-black/[.06] px-3 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
                    <SearchCheck className="size-3.5" /> Resultado da página
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[15px] leading-5 text-[var(--kodety-accent-hover)]">
                      {resolveCmsSeoTemplate(pageDraft.title || pageLabel(selectedPage, homePage), cmsSample)}
                      {siteDraft.siteTitle ? ` · ${siteDraft.siteTitle}` : ''}
                    </p>
                    <p className="mt-0.5 break-all text-[11px] text-emerald-400">
                      {resolveCmsSeoTemplate(
                        pageDraft.canonicalUrl ||
                          `${siteDraft.baseUrl || 'https://seusite.com'}/${selectedPage.replace(/index\.html?$/i, '').replace(/\.html?$/i, '')}`,
                        cmsSample,
                      )}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                      {resolveCmsSeoTemplate(
                        pageDraft.description ||
                          siteDraft.description ||
                          'Adicione uma descrição para controlar como esta página aparece nos resultados.',
                        cmsSample,
                      )}
                    </p>
                  </div>
                </div>
              </SettingsSection>
              <SaveBar
                host={saveBarHost}
                dirty={pageDirty}
                label="Salvar página"
                onSave={persistPage}
                saving={savingScope === 'page'}
                error={pageSaveError}
              />
            </div>
          )}
        </div>
      </fieldset>
      {snapshotPreview && wordpress && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[10029] grid place-items-center bg-black/60" role="status">
              <Loader2 className="size-5 animate-spin" />
              <span className="sr-only">Preparando prévia…</span>
            </div>
          }
        >
          <HtmlSnapshotPreview
            key={snapshotPreview.id}
            snapshot={snapshotPreview}
            nonce={wordpress.nonce}
            readOnly={readOnly}
            restoring={storageOperation === 'restore'}
            onRestore={restoreSnapshot}
            onClose={() => setSnapshotPreview(null)}
      />
        </Suspense>
      )}
      <div ref={setSaveBarHost} className="pointer-events-none absolute inset-x-0 bottom-0 z-30 lg:left-56" />
      {!socialImageLocked && socialImageBuilderTarget && (
        <Suspense
          fallback={
            <div
              className="fixed inset-0 z-[590] grid place-items-center bg-[#050505] text-white"
              role="status"
              aria-label="Carregando Social Image Builder"
            >
              <Loader2 className="size-5 animate-spin" />
            </div>
          }
        >
          <HtmlSocialImageBuilder
            title={
              socialImageBuilderTarget === 'site'
                ? `Social Image · ${projectName}`
                : `Social Image · ${pageLabel(selectedPage || homePage, homePage)}`
            }
            template={activeSocialImageTemplate}
            sampleVariables={socialImageSampleVariables}
            dynamicVariables={socialImageVariables}
            media={wordpress ? { mediaUrl: wordpress.mediaUrl, nonce: wordpress.nonce } : undefined}
            assetPreview={{
              projectFiles,
              projectRootPath,
              referencePath: socialImageBuilderTarget === 'page' ? selectedPage || homePage : homePage,
              publicBaseUrl: siteDraft.baseUrl || '',
            }}
            onPrepareFontFile={onPrepareFontFile}
            onClose={() => {
              setSocialImageBuilderTarget(null);
              setSocialImageBuilderTemplate(undefined);
            }}
            onSave={(template: SocialImageTemplate) => persistSocialImageTemplate(socialImageBuilderTarget, template)}
            onDelete={
              socialImageBuilderTarget === 'site'
                ? siteAssignedSocialImageTemplate
                  ? () => persistSocialImageTemplate('site', undefined)
                  : undefined
                : pageHasOwnSocialImageTemplate
                  ? () => persistSocialImageTemplate('page', undefined)
                  : undefined
            }
          />
        </Suspense>
      )}
      <Dialog
        open={storageConfirmation !== null}
        onOpenChange={open => {
          if (!open && !storageOperation) {
            setStorageConfirmation(null);
            setProjectConfirmation('');
          }
        }}
      >
        <DialogContent data-kodety-project-settings className="max-w-lg">
          {storageConfirmation === 'snapshots' ? (
            <>
              <DialogTitle>Apagar snapshots em massa?</DialogTitle>
              <DialogDescription>
                {includePublishedSnapshot
                  ? 'Todos os snapshots privados, inclusive o da release atualmente publicada, serão removidos.'
                  : 'Todos os snapshots privados serão removidos, exceto o da release atualmente publicada.'}
              </DialogDescription>
              <div className="rounded-[9px] border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-amber-100">
                O site que já está no ar não será interrompido. Você apenas perderá os pontos de restauração
                selecionados.
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={Boolean(storageOperation)}
                  onClick={() => setStorageConfirmation(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  disabled={readOnly || Boolean(storageOperation)}
                  onClick={() => void deleteStorageSnapshots()}
                >
                  {storageOperation === 'snapshots' ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Apagar agora
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogTitle>Excluir definitivamente o projeto?</DialogTitle>
              <DialogDescription>
                Workspace e snapshots serão removidos. No modo agência, a cópia publicada vinculada também será
                excluída, mesmo quando o projeto ocupa a raiz.
              </DialogDescription>
              <div className="space-y-1.5">
                <Label htmlFor="kodety-project-delete-confirmation">
                  <span>Digite</span>
                  {' “'}
                  <span data-kodety-no-i18n>{storageState?.project.name || projectName}</span>
                  {'” '}
                  <span>para confirmar</span>
                </Label>
                <ProjectSettingsFieldControl label="Confirmação do projeto" kind="text">
                  <Input
                    id="kodety-project-delete-confirmation"
                    value={projectConfirmation}
                    disabled={Boolean(storageOperation)}
                    onChange={event => setProjectConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </ProjectSettingsFieldControl>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={Boolean(storageOperation)}
                  onClick={() => setStorageConfirmation(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    readOnly ||
                    Boolean(storageOperation) ||
                    projectConfirmation !== (storageState?.project.name || projectName)
                  }
                  onClick={() => void deleteCurrentProject()}
                >
                  {storageOperation === 'project' ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Excluir projeto
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={aiPromptOpen} onOpenChange={setAiPromptOpen}>
        <DialogContent data-kodety-project-settings className="max-h-[min(82vh,680px)] max-w-xl overflow-y-auto">
          <DialogTitle>
            {aiTarget === 'site' ? 'Gerar identidade com IA' : `Otimizar ${pageLabel(selectedPage, homePage)} com IA`}
          </DialogTitle>
          <DialogDescription>
            Informe os fatos e o objetivo. A IA recebe somente este briefing e o contexto que você autorizar.
          </DialogDescription>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Contexto e informações confirmadas</Label>
              <ProjectSettingsFieldControl label="Contexto e informações confirmadas" kind="text">
                <Textarea
                  value={aiBrief}
                  onChange={event => setAiBrief(event.target.value)}
                  className="min-h-28"
                  placeholder="Descreva o negócio ou a página, público, objetivo, diferenciais reais, localização, produtos e qualquer informação que não pode ser inventada…"
                />
              </ProjectSettingsFieldControl>
              <p className="text-[10px] text-muted-foreground">
                Escreva apenas fatos confirmados. Informações ausentes serão omitidas.
              </p>
            </div>
            <div className="border-y border-[var(--kodety-divider)]">
              <div className="py-3">
                <HtmlSettingsToggleControl
                  label="Usar conteúdo da página atual"
                  description="Extrai títulos, textos visíveis e ações do HTML, removendo scripts e estilos."
                  checked={aiIncludePage}
                  onChange={setAiIncludePage}
                  disabled={!aiHtmlSummary}
                  kind="code"
                />
              </div>
              {aiIncludePage && aiHtmlSummary && (
                <details className="group border-t border-[var(--kodety-divider)]">
                  <DisclosureSummary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[10px] text-muted-foreground">
                    Ver resumo que será enviado
                  </DisclosureSummary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-[var(--kodety-divider)] py-4 text-[10px] leading-5 text-muted-foreground">
                    {aiHtmlSummary}
                  </pre>
                </details>
              )}
              {!aiHtmlSummary && (
                <p className="border-t border-[var(--kodety-divider)] py-3 text-[10px] text-muted-foreground">
                  Nenhum HTML disponível para esta página. Somente o briefing será enviado.
                </p>
              )}
            </div>
            <div className="flex items-start gap-2 text-[10px] leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                A IA recebe uma regra explícita para não completar nomes, números, datas, recursos ou promessas que não
                apareçam nas fontes autorizadas.
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAiPromptOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={aiLoading || !aiBrief.trim()} onClick={() => void generateSeo()}>
              {aiLoading ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {aiLoading ? 'Gerando…' : 'Gerar rascunho'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
