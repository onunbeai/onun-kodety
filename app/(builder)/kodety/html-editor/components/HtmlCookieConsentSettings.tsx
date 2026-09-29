'use client';

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowsExpandHorizontal,
  Check,
  ChevronDown,
  ChevronsExpandToLines,
  Circle,
  Code2,
  CornerUpLeft,
  Database,
  Frames,
  Layers3,
  List,
  Lock,
  Palette,
  Plug,
  Plus,
  ScanSearch,
  Settings2,
  SlidersHorizontal,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  X,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CustomCodeSettings } from '@/lib/html-editor/custom-code';
import {
  DEFAULT_COOKIE_CONSENT_SETTINGS,
  cookieConsentSettingsIssues,
  type CookieConsentSettings,
  type CookieConsentValidationIssue,
} from '@/lib/html-editor/cookie-consent';
import type { SiteSeoSettings } from '@/lib/html-editor/seo-settings';
import type { HtmlProject, HtmlProjectFile } from '@/lib/html-editor/types';
import ColorPicker from '../../components/ColorPicker';
import {
  HtmlSettingsSelectControl,
  HtmlSettingsTextControl,
  HtmlSettingsToggleControl,
} from './HtmlSettingsControls';

type BannerType = 'simple' | 'advanced';
type ConsentTheme = 'light' | 'dark' | 'auto';
type ConsentPosition = 'bottom' | 'bottom-left' | 'bottom-right' | 'center-modal';

interface EditableConsentContent {
  title: string;
  description: string;
  acceptAllLabel: string;
  rejectAllLabel: string;
  settingsLabel: string;
  preferencesTitle: string;
  savePreferencesLabel: string;
  privacyPolicyLabel: string;
  cookiePolicyLabel: string;
  preferencesDescription: string;
  closeLabel: string;
  serviceDetailsLabel: string;
}

interface EditableConsentAppearance {
  background: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  border: string;
  borderWidth: number;
  borderRadius: number;
  buttonRadius: number;
  padding: number;
  maxWidth: number;
  shadow: 'none' | 'soft' | 'medium' | 'strong';
  overlay: boolean;
  fontFamily: 'system' | 'inter' | 'serif';
  fontSize: number;
}

interface EditableConsentCategory {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  required: boolean;
  allowVisitorControl: boolean;
  order: number;
  icon?: string;
}

interface EditableConsentService {
  id: string;
  name: string;
  provider: string;
  categoryId: string;
  description: string;
  privacyPolicyUrl: string;
  cookies: string[];
  dataRetention: string;
  enabledPages: string[];
  consentRequired: boolean;
  scriptIds: string[];
}

interface EditableConsentCookie {
  id: string;
  name: string;
  domain: string;
  provider: string;
  purpose: string;
  categoryId: string;
  duration: string;
  type: 'session' | 'persistent';
  party: 'first' | 'third';
}

interface EditableGoogleConsentMode {
  enabled: boolean;
  mode: 'basic' | 'advanced';
}

interface EditablePrivacyCenter {
  enabled: boolean;
  floatingButton: boolean;
  buttonLabel: string;
}

interface EditableAdvancedConsent {
  region: 'global' | 'eu' | 'uk' | 'brazil' | 'us' | 'custom';
  recordHistory: boolean;
  historyRetentionDays: number;
  debug: boolean;
  reconsentOnNewCategory: boolean;
  reconsentOnNewService: boolean;
  reconsentOnPolicyChange: boolean;
}

interface EditableCookieConsentSettings {
  version: 1;
  enabled: boolean;
  configurationVersion: number;
  bannerType: BannerType;
  theme: ConsentTheme;
  position: ConsentPosition;
  expirationDays: number;
  askAgainOnChange: boolean;
  privacyPolicyUrl: string;
  cookiePolicyUrl: string;
  disablePageInteraction: boolean;
  respectDnt: boolean;
  content: EditableConsentContent;
  appearance: EditableConsentAppearance;
  categories: EditableConsentCategory[];
  services: EditableConsentService[];
  cookies: EditableConsentCookie[];
  integrationCategories: Record<string, string>;
  googleConsentMode: EditableGoogleConsentMode;
  privacyCenter: EditablePrivacyCenter;
  advanced: EditableAdvancedConsent;
}

export interface HtmlCookieConsentSettingsProps {
  value: CookieConsentSettings;
  onChange(value: CookieConsentSettings): void;
  activationLocked?: boolean;
  upgradeUrl?: string;
  licenseUrl?: string;
  onActivate?: () => void;
  siteSettings?: SiteSeoSettings;
  customCode?: CustomCodeSettings;
  project?: Pick<HtmlProject, 'files'> | null;
  projectFiles?: Record<string, HtmlProjectFile>;
  className?: string;
}

const DEFAULT_CONTENT: EditableConsentContent = { ...DEFAULT_COOKIE_CONSENT_SETTINGS.content };
const DEFAULT_APPEARANCE: EditableConsentAppearance = { ...DEFAULT_COOKIE_CONSENT_SETTINGS.appearance };
const DEFAULT_CATEGORIES: EditableConsentCategory[] = DEFAULT_COOKIE_CONSENT_SETTINGS.categories.map(category => ({ ...category }));
const DEFAULT_INTEGRATION_CATEGORIES: Record<string, string> = { ...DEFAULT_COOKIE_CONSENT_SETTINGS.integrationCategories };
const MANAGED_CONSENT_COOKIE_IDS = new Set([
  'kodety_consent',
  'kodety_consent_analytics',
  'kodety_consent_marketing',
  'kodety_consent_experiments',
]);

const INTEGRATION_FIELDS = [
  { key: 'kodetyAnalytics', marker: 'kodety-analytics', label: 'Kodety Analytics (first-party)' },
  { key: 'googleAnalytics', marker: 'google-analytics', label: 'Google Analytics 4' },
  { key: 'googleTagManager', marker: 'google-tag-manager', label: 'Google Tag Manager' },
  { key: 'microsoftClarity', marker: 'microsoft-clarity', label: 'Microsoft Clarity' },
  { key: 'metaPixel', marker: 'meta-pixel', label: 'Meta Pixel' },
  { key: 'plausible', marker: 'plausible', label: 'Plausible' },
  { key: 'experiments', marker: 'experiments', label: 'A/B experiments' },
] as const;

const DEFAULT_EDITOR_SETTINGS: EditableCookieConsentSettings = {
  ...DEFAULT_COOKIE_CONSENT_SETTINGS,
  content: DEFAULT_CONTENT,
  appearance: DEFAULT_APPEARANCE,
  categories: DEFAULT_CATEGORIES,
  services: DEFAULT_COOKIE_CONSENT_SETTINGS.services.map(service => ({ ...service, cookies: [...service.cookies], enabledPages: [...service.enabledPages], scriptIds: [...service.scriptIds] })),
  cookies: DEFAULT_COOKIE_CONSENT_SETTINGS.cookies.map(cookie => ({ ...cookie })),
  integrationCategories: DEFAULT_INTEGRATION_CATEGORIES,
  googleConsentMode: { ...DEFAULT_COOKIE_CONSENT_SETTINGS.googleConsentMode },
  privacyCenter: { ...DEFAULT_COOKIE_CONSENT_SETTINGS.privacyCenter },
  advanced: { ...DEFAULT_COOKIE_CONSENT_SETTINGS.advanced },
};

type SectionId = 'general' | 'appearance' | 'content' | 'categories' | 'services' | 'cookies' | 'integrations' | 'advanced';

const SECTIONS: Array<{ id: SectionId; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'content', label: 'Content', icon: Type },
  { id: 'categories', label: 'Categories', icon: Layers3 },
  { id: 'services', label: 'Services', icon: Database },
  { id: 'cookies', label: 'Cookies', icon: List },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'advanced', label: 'Advanced', icon: Settings2 },
];

function editableSettings(value: CookieConsentSettings): EditableCookieConsentSettings {
  const source = (value || {}) as unknown as Partial<EditableCookieConsentSettings>;
  return {
    ...DEFAULT_EDITOR_SETTINGS,
    ...source,
    content: { ...DEFAULT_CONTENT, ...(source.content || {}) },
    appearance: { ...DEFAULT_APPEARANCE, ...(source.appearance || {}) },
    categories: Array.isArray(source.categories) && source.categories.length ? source.categories : DEFAULT_CATEGORIES,
    services: Array.isArray(source.services)
      ? source.services.map(service => ({ ...service, scriptIds: Array.isArray(service.scriptIds) ? service.scriptIds : [] }))
      : [],
    cookies: Array.isArray(source.cookies) ? source.cookies : DEFAULT_EDITOR_SETTINGS.cookies,
    integrationCategories: { ...DEFAULT_INTEGRATION_CATEGORIES, ...(source.integrationCategories || {}) },
    googleConsentMode: {
      ...DEFAULT_EDITOR_SETTINGS.googleConsentMode,
      ...(source.googleConsentMode || {}),
    },
    privacyCenter: { ...DEFAULT_EDITOR_SETTINGS.privacyCenter, ...(source.privacyCenter || {}) },
    advanced: { ...DEFAULT_EDITOR_SETTINGS.advanced, ...(source.advanced || {}) },
  };
}

function createId(prefix: string) {
  return globalThis.crypto?.randomUUID?.()
    ? `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`
    : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeInternalId(value: string) {
  return value.trim().toLocaleLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function csv(value: string) {
  return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)));
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5" data-invalid={error ? 'true' : undefined}>
      <span className={cn('block text-[10px] font-medium', error ? 'text-destructive' : 'text-[var(--kodety-text-secondary)]')}>{label}</span>
      {children}
      {error && <p className="flex items-start gap-1.5 text-[9px] leading-4 text-destructive" role="alert"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{error}</p>}
      {hint && <p className="kodety-info-copy text-[9px] leading-4">{hint}</p>}
    </div>
  );
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-start gap-4 border-b border-[var(--kodety-divider)] pb-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-xs font-semibold text-[var(--kodety-text)]">{title}</h2>
        <p className="kodety-info-copy mt-1 max-w-2xl text-[10px] leading-4">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid min-h-9 w-full gap-0.5 rounded-[9px] bg-white/[.055] p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-w-0 truncate rounded-[7px] px-2 py-1.5 text-[10px] outline-none transition-colors',
              active ? 'bg-white/[.13] text-white' : 'text-muted-foreground hover:bg-white/[.055] hover:text-foreground',
              'focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return (
    <Field label={label}>
      <ColorPicker
        value={value}
        defaultValue={value}
        colorVariableCapability={null}
        solidOnly
        placeholder="Add…"
        onChange={onChange}
        onImmediateChange={onChange}
        triggerClassName="h-9 rounded-[9px]"
        popoverContentClassName="z-[2147483646]"
      />
    </Field>
  );
}

interface ConsentDiagnostics {
  integrations: Array<{ id: string; pages: string[]; count: number }>;
  embeds: Array<{ provider: string; pages: string[]; count: number }>;
  uncategorizedScripts: Array<{ src: string; page: string }>;
}

function projectDiagnostics(files: Record<string, HtmlProjectFile> | undefined): ConsentDiagnostics {
  const integrationPages = new Map<string, string[]>();
  const embedPages = new Map<string, string[]>();
  const uncategorizedScripts: Array<{ src: string; page: string }> = [];
  Object.entries(files || {}).forEach(([path, file]) => {
    if (!/\.html?$/i.test(path) || typeof file.text !== 'string' || path.startsWith('.incode/')) return;
    for (const match of file.text.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = match[1] || '';
      const integration = attrs.match(/\bdata-kodety-integration\s*=\s*["']([^"']+)["']/i)?.[1];
      const category = attrs.match(/\b(?:data-category|data-kodety-consent)\s*=\s*["']([^"']+)["']/i)?.[1];
      const src = attrs.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)?.[1] || 'inline script';
      if (integration) integrationPages.set(integration, [...(integrationPages.get(integration) || []), path]);
      else if (!category && src !== 'inline script') uncategorizedScripts.push({ src, page: path });
    }
    for (const match of file.text.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      const src = match[1];
      const provider = /youtube(?:-nocookie)?\.com/i.test(src) ? 'YouTube'
        : /player\.vimeo\.com/i.test(src) ? 'Vimeo'
          : /(?:google\.[^/]+|googleapis\.com)\/maps|maps\.google/i.test(src) ? 'Google Maps'
            : /open\.spotify\.com/i.test(src) ? 'Spotify'
              : '';
      if (provider) embedPages.set(provider, [...(embedPages.get(provider) || []), path]);
    }
  });
  const summarize = (map: Map<string, string[]>) => Array.from(map, ([id, pages]) => ({ id, pages: Array.from(new Set(pages)), count: pages.length }));
  return {
    integrations: summarize(integrationPages),
    embeds: summarize(embedPages).map(item => ({ provider: item.id, pages: item.pages, count: item.count })),
    uncategorizedScripts,
  };
}

type ConsentPreviewState = 'initial' | 'preferences' | 'accepted' | 'rejected' | 'embedded-blocked';
type ConsentPreviewViewport = 'desktop' | 'tablet' | 'mobile';
const COOKIE_CONSENT_STACKED_ACTIONS_MAX_WIDTH = 460;

function BannerPreview({ settings }: { settings: EditableCookieConsentSettings }) {
  const [state, setState] = useState<ConsentPreviewState>('initial');
  const [viewport, setViewport] = useState<ConsentPreviewViewport>('desktop');
  const [visualTheme, setVisualTheme] = useState<'light' | 'dark'>(() => settings.theme === 'dark' ? 'dark' : 'light');
  const [previewBannerType, setPreviewBannerType] = useState<BannerType>(settings.bannerType);
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(settings.categories.filter(category => category.required || category.defaultEnabled).map(category => category.id)));
  useEffect(() => {
    setVisualTheme(settings.theme === 'dark' ? 'dark' : 'light');
  }, [settings.theme]);
  useEffect(() => {
    setPreviewBannerType(settings.bannerType);
  }, [settings.bannerType]);
  useEffect(() => {
    setAccepted(previous => new Set([
      ...Array.from(previous).filter(id => settings.categories.some(category => category.id === id)),
      ...settings.categories.filter(category => category.required).map(category => category.id),
    ]));
  }, [settings.categories]);
  const appearance = settings.appearance;
  const shadow = appearance.shadow === 'none' ? 'none'
    : appearance.shadow === 'soft' ? '0 10px 30px rgba(0,0,0,.12)'
      : appearance.shadow === 'strong' ? '0 24px 70px rgba(0,0,0,.28)'
        : '0 18px 48px rgba(0,0,0,.2)';
  const colorsAreDefaults = appearance.background === DEFAULT_APPEARANCE.background
    && appearance.text === DEFAULT_APPEARANCE.text
    && appearance.mutedText === DEFAULT_APPEARANCE.mutedText
    && appearance.border === DEFAULT_APPEARANCE.border;
  const palette = visualTheme === 'dark' && colorsAreDefaults
    ? { background: '#171719', text: '#f6f6f7', mutedText: '#aaaab2', border: '#303036' }
    : { background: appearance.background, text: appearance.text, mutedText: appearance.mutedText, border: appearance.border };
  const secondarySurface = visualTheme === 'dark' ? 'rgba(255,255,255,.075)' : 'rgba(23,23,23,.06)';
  const accentSurface = `color-mix(in srgb, ${appearance.accent} 9%, ${palette.background})`;
  const accentBorder = `color-mix(in srgb, ${appearance.accent} 34%, ${palette.border})`;
  const siteBackground = visualTheme === 'dark' ? '#111114' : '#f5f5f6';
  const siteInk = visualTheme === 'dark' ? '#f5f5f7' : '#232326';
  const previewWidth = viewport === 'mobile' ? 360 : viewport === 'tablet' ? 560 : 760;
  const positionClass = settings.position === 'center-modal'
    ? 'items-center justify-center'
    : settings.position === 'bottom-left'
      ? 'items-end justify-start'
      : settings.position === 'bottom-right'
        ? 'items-end justify-end'
        : 'items-end justify-center';
  const panelMaxWidth = Math.min(appearance.maxWidth, previewWidth - 32);
  const actionsAreStacked = panelMaxWidth <= COOKIE_CONSENT_STACKED_ACTIONS_MAX_WIDTH;
  const panelStyle = {
    maxWidth: panelMaxWidth,
    borderRadius: appearance.borderRadius,
    borderWidth: appearance.borderWidth,
    borderColor: palette.border,
    background: palette.background,
    color: palette.text,
    boxShadow: shadow,
    fontSize: appearance.fontSize,
    fontFamily: appearance.fontFamily === 'serif' ? 'Georgia, serif' : appearance.fontFamily === 'inter' ? 'Inter, sans-serif' : 'system-ui, sans-serif',
    overflow: 'hidden',
  };
  const contentPadding = Math.max(18, appearance.padding);
  const sortedCategories = [...settings.categories].sort((a, b) => a.order - b.order);
  const embeddedCategory = sortedCategories.find(category => category.id === 'embedded_content');
  const resetAccepted = (granted: boolean) => {
    setAccepted(new Set(sortedCategories.filter(category => category.required || granted).map(category => category.id)));
    setState(granted ? 'accepted' : 'rejected');
  };
  return (
    <div className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[var(--kodety-workspace)]">
      <div className="flex min-h-11 flex-wrap items-end gap-2 border-b border-white/[.06] bg-black/[.12] px-3 py-2">
        <div className="min-w-[190px] flex-1 space-y-1">
          <span className="block text-[8px] font-medium uppercase tracking-[.08em] text-muted-foreground">State</span>
          <HtmlSettingsSelectControl label="Preview state" value={state} allowUnset={false} onChange={value => setState(value as ConsentPreviewState)} options={[{ value: 'initial', label: 'Initial' }, { value: 'preferences', label: 'Preferences open' }, { value: 'accepted', label: 'Accepted' }, { value: 'rejected', label: 'Rejected' }, { value: 'embedded-blocked', label: 'Embedded content blocked' }]} />
        </div>
        <div className="w-[202px] space-y-1">
          <span className="block text-[8px] font-medium uppercase tracking-[.08em] text-muted-foreground">Viewport</span>
          <Segmented<ConsentPreviewViewport> label="Preview viewport" value={viewport} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'mobile', label: 'Mobile' }]} onChange={setViewport} />
        </div>
        <div className="w-[130px] space-y-1">
          <span className="block text-[8px] font-medium uppercase tracking-[.08em] text-muted-foreground">Visual theme</span>
          <Segmented<'light' | 'dark'> label="Preview visual theme" value={visualTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={setVisualTheme} />
        </div>
        <div className="w-[142px] space-y-1">
          <span className="block text-[8px] font-medium uppercase tracking-[.08em] text-muted-foreground">Banner type</span>
          <Segmented<BannerType> label="Preview banner type" value={previewBannerType} options={[{ value: 'simple', label: 'Simple' }, { value: 'advanced', label: 'Advanced' }]} onChange={setPreviewBannerType} />
        </div>
      </div>
      <div className={cn('relative mx-auto flex min-h-[390px] overflow-hidden p-4 transition-[max-width]', positionClass)} style={{ maxWidth: previewWidth }}>
        <div className="absolute inset-0 opacity-95" style={{ background: siteBackground, color: siteInk }} />
        <div className="absolute inset-x-7 top-9 space-y-3 opacity-25" style={{ color: siteInk }}>
          <div className="h-5 w-2/5 rounded bg-current" />
          <div className="h-2.5 w-4/5 rounded bg-current" />
          <div className="h-2.5 w-3/5 rounded bg-current" />
          <div className="mt-8 grid grid-cols-3 gap-3"><div className="h-24 rounded bg-current" /><div className="h-24 rounded bg-current" /><div className="h-24 rounded bg-current" /></div>
        </div>
        {(appearance.overlay || settings.disablePageInteraction) && (state === 'initial' || state === 'preferences') && <div className="absolute inset-0 bg-black/45" />}
        {(state === 'initial' || state === 'preferences') && <div
          className={cn('relative z-10 w-full border text-left', state === 'preferences' ? 'max-h-[350px] overflow-y-auto' : '', viewport === 'mobile' ? 'max-w-[328px]' : '')}
          style={{ ...panelStyle, padding: state === 'preferences' ? appearance.padding : 0 }}
        >
          {state === 'initial' ? (
            <>
              <div style={{ padding: contentPadding, paddingBottom: Math.max(16, contentPadding - 2) }}>
                <div className="text-[15px] font-semibold leading-tight tracking-[-.025em]">{settings.content.title}</div>
                <p className="mt-2.5 max-w-[66ch] text-[11px] leading-[1.58]" style={{ color: palette.mutedText }}>{settings.content.description}</p>
              </div>
              <div
                data-kodety-cookie-consent-actions-layout={actionsAreStacked ? 'vertical' : 'horizontal'}
                className="grid gap-2.5 border-t"
                style={{
                  borderColor: palette.border,
                  gridTemplateColumns: actionsAreStacked ? '1fr' : `repeat(${previewBannerType === 'advanced' ? 3 : 2}, minmax(0, 1fr))`,
                  padding: `16px ${contentPadding}px 12px`,
                }}
              >
                <button type="button" className="min-h-[46px] w-full overflow-hidden text-ellipsis whitespace-nowrap px-3 text-[10px] font-semibold tracking-[-.01em] outline-none transition-transform hover:-translate-y-px" style={{ borderRadius: appearance.buttonRadius, background: appearance.accent, color: appearance.accentText }} onClick={() => resetAccepted(true)}>{settings.content.acceptAllLabel}</button>
                <button type="button" className="min-h-[46px] w-full overflow-hidden text-ellipsis whitespace-nowrap border px-3 text-[10px] font-semibold tracking-[-.01em] outline-none" style={{ borderRadius: appearance.buttonRadius, borderColor: palette.border, background: 'transparent', color: palette.text }} onClick={() => resetAccepted(false)}>{settings.content.rejectAllLabel}</button>
                {previewBannerType === 'advanced' && <button type="button" className="min-h-[46px] w-full overflow-hidden text-ellipsis whitespace-nowrap border px-3 text-[10px] font-semibold tracking-[-.01em] outline-none" style={{ borderRadius: appearance.buttonRadius, borderColor: accentBorder, background: accentSurface, color: palette.text }} onClick={() => setState('preferences')}>{settings.content.settingsLabel}</button>}
              </div>
              {(settings.privacyPolicyUrl || settings.cookiePolicyUrl) && <div className="flex flex-wrap gap-x-4 gap-y-1 px-0 pb-0 text-[8px] font-medium" style={{ color: palette.mutedText, margin: `0 ${contentPadding}px ${Math.max(14, contentPadding - 4)}px` }}>
                {settings.privacyPolicyUrl && <a href={settings.privacyPolicyUrl} onClick={event => event.preventDefault()} className="opacity-80 underline-offset-2 hover:underline hover:opacity-100">{settings.content.privacyPolicyLabel}</a>}
                {settings.cookiePolicyUrl && <a href={settings.cookiePolicyUrl} onClick={event => event.preventDefault()} className="opacity-80 underline-offset-2 hover:underline hover:opacity-100">{settings.content.cookiePolicyLabel}</a>}
              </div>}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-[15px] font-semibold">{settings.content.preferencesTitle}</div>
                <button type="button" aria-label={settings.content.closeLabel} title={settings.content.closeLabel} className="grid size-8 place-items-center rounded-[8px]" style={{ background: secondarySurface }} onClick={() => setState('initial')}><X className="size-3.5" /></button>
              </div>
              <p className="mt-1.5 text-[9px] leading-4" style={{ color: palette.mutedText }}>{settings.content.preferencesDescription}</p>
              <div className="mt-3 space-y-2">
                {sortedCategories.map(category => {
                  const checked = category.required || accepted.has(category.id);
                  return (
                    <div key={category.id} className="flex items-center gap-3 border p-3" style={{ borderRadius: appearance.buttonRadius, borderColor: palette.border, background: secondarySurface }}>
                      <span className="grid size-5 shrink-0 place-items-center rounded-full" style={{ background: appearance.accent, color: appearance.accentText }}><ChevronDown className="size-3 stroke-[2.4]" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[11px] font-semibold">{category.name}{category.required && <Lock className="size-3 opacity-50" />}</div>
                        <p className="mt-1 text-[9px] leading-4" style={{ color: palette.mutedText }}>{category.description}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        aria-label={`${category.name}: ${checked ? 'allowed' : 'denied'}`}
                        disabled={category.required || !category.allowVisitorControl}
                        className="relative h-5 w-9 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ background: checked ? appearance.accent : palette.border }}
                        onClick={() => setAccepted(previous => {
                          const next = new Set(previous);
                          if (next.has(category.id)) next.delete(category.id); else next.add(category.id);
                          return next;
                        })}
                      >
                        <span className={cn(
                          'absolute left-0.5 top-0.5 size-4 grid place-items-center rounded-full bg-white transition-transform',
                          checked ? 'translate-x-4' : 'translate-x-0',
                        )}>{category.required && <Check className="size-2.5 stroke-[2.5]" style={{ color: appearance.accent }} />}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="mt-3 min-h-9 w-full px-3 text-[10px] font-semibold" style={{ borderRadius: appearance.buttonRadius, background: appearance.accent, color: appearance.accentText }} onClick={() => setState('accepted')}>{settings.content.savePreferencesLabel}</button>
            </>
          )}
        </div>}
        {(state === 'accepted' || state === 'rejected') && <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
          <div className="border px-5 py-4" style={{ ...panelStyle, width: '100%', padding: 16 }}>
            <div className="text-[12px] font-semibold">{state === 'accepted' ? 'Preferences accepted' : 'Optional cookies rejected'}</div>
            <p className="mt-1 text-[9px] leading-4" style={{ color: palette.mutedText }}>{state === 'accepted' ? 'The banner closes and the allowed services can load.' : 'Only required services remain active. The visitor can change this later.'}</p>
          </div>
          {settings.privacyCenter.enabled && <button type="button" className="min-h-9 border px-3 text-[10px] font-semibold" style={{ borderRadius: appearance.buttonRadius, borderColor: palette.border, background: palette.background, color: palette.text }} onClick={() => setState('preferences')}>{settings.privacyCenter.buttonLabel}</button>}
        </div>}
        {state === 'embedded-blocked' && <div className="relative z-10 flex min-h-[220px] w-full max-w-[560px] flex-col items-center justify-center border px-6 text-center" style={{ borderRadius: appearance.borderRadius, borderColor: palette.border, background: palette.background, color: palette.text, boxShadow: shadow }}>
          <div className="grid size-10 place-items-center rounded-full" style={{ background: secondarySurface }}><Lock className="size-4 opacity-65" /></div>
          <div className="mt-4 text-[13px] font-semibold">This content requires {embeddedCategory?.name || 'Embedded Content'} cookies.</div>
          <p className="mt-1 max-w-[38ch] text-[9px] leading-4" style={{ color: palette.mutedText }}>The external provider remains blocked until the visitor grants this category.</p>
          <button type="button" className="mt-4 min-h-9 px-4 text-[10px] font-semibold" style={{ borderRadius: appearance.buttonRadius, background: appearance.accent, color: appearance.accentText }} onClick={() => {
            if (embeddedCategory) setAccepted(previous => new Set(previous).add(embeddedCategory.id));
            setState('accepted');
          }}>Allow and view</button>
        </div>}
      </div>
      <div className="border-t border-white/[.05] px-3 py-2 text-[8px] leading-3 text-muted-foreground">Preview only · {settings.theme === 'auto' ? 'Auto theme can be inspected in Light and Dark' : `${settings.theme[0].toUpperCase()}${settings.theme.slice(1)} draft theme`} · simulation does not change the draft.</div>
    </div>
  );
}

function EditorList({ children }: { children: ReactNode }) {
  return <div className="max-h-[560px] space-y-1 overflow-y-auto overscroll-contain p-1.5">{children}</div>;
}

function EditorListButton({ active, invalid = false, title, meta, icon: Icon, onClick }: {
  active: boolean;
  invalid?: boolean;
  title: string;
  meta: string;
  icon: ComponentType<{ className?: string }>;
  onClick(): void;
}) {
  return (
    <button type="button" aria-current={active ? 'true' : undefined} aria-invalid={invalid || undefined} onClick={onClick} className={cn('group flex min-h-14 w-full min-w-0 items-stretch overflow-hidden rounded-[9px] border text-left outline-none transition-colors focus-visible:border-[var(--kodety-focus)]/70', active ? 'border-white/[.05] bg-white/[.075]' : 'border-transparent text-muted-foreground hover:bg-white/[.045] hover:text-foreground', invalid && 'border-destructive/35 bg-destructive/[.055]')}>
      <span className={cn('grid w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.06] text-white/30', active && 'text-[var(--kodety-accent-hover)]', invalid && 'text-destructive')}><Icon className="size-3.5" /></span>
      <span className="min-w-0 flex-1 px-2.5 py-2"><span className="flex min-w-0 items-center gap-1.5"><span className="block min-w-0 flex-1 truncate text-[11px] font-medium">{title}</span>{invalid && <AlertTriangle className="size-3 shrink-0 text-destructive" />}</span><span className={cn('mt-1 block truncate text-[9px] text-muted-foreground', invalid && 'text-destructive/80')}>{invalid ? 'Dados obrigatórios pendentes' : meta}</span></span>
    </button>
  );
}

export function HtmlCookieConsentSettings({
  value,
  onChange,
  activationLocked = false,
  upgradeUrl,
  licenseUrl,
  onActivate,
  siteSettings,
  customCode,
  project,
  projectFiles,
  className,
}: HtmlCookieConsentSettingsProps) {
  const settings = useMemo(() => editableSettings(value), [value]);
  const [section, setSection] = useState<SectionId>('general');
  const [selectedCategoryId, setSelectedCategoryId] = useState(settings.categories[0]?.id || '');
  const [selectedServiceId, setSelectedServiceId] = useState(settings.services[0]?.id || '');
  const [selectedCookieId, setSelectedCookieId] = useState(settings.cookies[0]?.id || '');
  const diagnostics = useMemo(() => projectDiagnostics(projectFiles || project?.files), [project?.files, projectFiles]);
  const validationIssues = useMemo(
    () => cookieConsentSettingsIssues(settings as unknown as CookieConsentSettings),
    [settings],
  );
  const issueCounts = useMemo(() => validationIssues.reduce((counts, issue) => {
    counts.set(issue.section, (counts.get(issue.section) || 0) + 1);
    return counts;
  }, new Map<SectionId, number>()), [validationIssues]);
  const categoryOptions = settings.categories.map(category => ({ value: category.id, label: category.name }));
  const configuredIntegrations = useMemo(() => new Set([
    'kodety-analytics',
    siteSettings?.googleAnalyticsId ? 'google-analytics' : '',
    siteSettings?.googleTagManagerId ? 'google-tag-manager' : '',
    siteSettings?.microsoftClarityId ? 'microsoft-clarity' : '',
    siteSettings?.metaPixelId ? 'meta-pixel' : '',
    siteSettings?.plausibleDomain ? 'plausible' : '',
  ].filter(Boolean)), [siteSettings]);
  const gatedCustomCodeCount = customCode?.entries.filter(entry => entry.enabled && entry.consent === 'required').length || 0;

  useEffect(() => {
    if (!settings.categories.some(category => category.id === selectedCategoryId)) setSelectedCategoryId(settings.categories[0]?.id || '');
  }, [selectedCategoryId, settings.categories]);
  useEffect(() => {
    if (!settings.services.some(service => service.id === selectedServiceId)) setSelectedServiceId(settings.services[0]?.id || '');
  }, [selectedServiceId, settings.services]);
  useEffect(() => {
    if (!settings.cookies.some(cookie => cookie.id === selectedCookieId)) setSelectedCookieId(settings.cookies[0]?.id || '');
  }, [selectedCookieId, settings.cookies]);

  const commit = (next: EditableCookieConsentSettings) => onChange(next as unknown as CookieConsentSettings);
  const patch = (update: Partial<EditableCookieConsentSettings>) => commit({ ...settings, ...update });
  const patchContent = (update: Partial<EditableConsentContent>) => patch({ content: { ...settings.content, ...update } });
  const patchAppearance = (update: Partial<EditableConsentAppearance>) => patch({ appearance: { ...settings.appearance, ...update } });
  const patchGoogle = (update: Partial<EditableGoogleConsentMode>) => patch({ googleConsentMode: { ...settings.googleConsentMode, ...update } });
  const patchPrivacyCenter = (update: Partial<EditablePrivacyCenter>) => patch({ privacyCenter: { ...settings.privacyCenter, ...update } });
  const patchAdvanced = (update: Partial<EditableAdvancedConsent>) => patch({ advanced: { ...settings.advanced, ...update } });

  const updateCategory = (id: string, update: Partial<EditableConsentCategory>) => patch({ categories: settings.categories.map(category => category.id === id ? { ...category, ...update } : category) });
  const updateService = (id: string, update: Partial<EditableConsentService>) => patch({ services: settings.services.map(service => service.id === id ? { ...service, ...update } : service) });
  const updateCookie = (id: string, update: Partial<EditableConsentCookie>) => patch({ cookies: settings.cookies.map(cookie => cookie.id === id ? { ...cookie, ...update } : cookie) });

  const addCategory = () => {
    const id = createId('category');
    patch({ categories: [...settings.categories, { id, name: 'New category', description: '', defaultEnabled: false, required: false, allowVisitorControl: true, order: settings.categories.length }] });
    setSelectedCategoryId(id);
  };
  const renameCategory = (category: EditableConsentCategory, rawId: string) => {
    const id = normalizeInternalId(rawId);
    if (!id || id === category.id || settings.categories.some(item => item.id === id)) return;
    patch({
      categories: settings.categories.map(item => item.id === category.id ? { ...item, id } : item),
      services: settings.services.map(service => service.categoryId === category.id ? { ...service, categoryId: id } : service),
      cookies: settings.cookies.map(cookie => cookie.categoryId === category.id ? { ...cookie, categoryId: id } : cookie),
      integrationCategories: Object.fromEntries(Object.entries(settings.integrationCategories).map(([key, current]) => [key, current === category.id ? id : current])),
    });
    setSelectedCategoryId(id);
  };
  const removeCategory = (category: EditableConsentCategory) => {
    if (category.required || !window.confirm(`Remove “${category.name}”? Linked services and cookies will need another category.`)) return;
    const fallback = settings.categories.find(item => item.required)?.id || 'necessary';
    patch({
      categories: settings.categories.filter(item => item.id !== category.id),
      services: settings.services.map(service => service.categoryId === category.id ? { ...service, categoryId: fallback } : service),
      cookies: settings.cookies.map(cookie => cookie.categoryId === category.id ? { ...cookie, categoryId: fallback } : cookie),
      integrationCategories: Object.fromEntries(Object.entries(settings.integrationCategories).map(([key, id]) => [key, id === category.id ? fallback : id])),
    });
  };
  const addService = () => {
    const id = createId('service');
    patch({ services: [...settings.services, { id, name: 'New service', provider: '', categoryId: settings.categories.find(category => !category.required)?.id || settings.categories[0]?.id || 'necessary', description: '', privacyPolicyUrl: '', cookies: [], dataRetention: '', enabledPages: [], consentRequired: true, scriptIds: [] }] });
    setSelectedServiceId(id);
  };
  const removeService = (service: EditableConsentService) => {
    if (!window.confirm(`Remove “${service.name}”?`)) return;
    patch({ services: settings.services.filter(item => item.id !== service.id) });
  };
  const addCookie = () => {
    const id = createId('cookie');
    patch({ cookies: [...settings.cookies, { id, name: '', domain: '', provider: '', purpose: '', categoryId: settings.categories.find(category => !category.required)?.id || 'analytics', duration: '', type: 'persistent', party: 'first' }] });
    setSelectedCookieId(id);
  };
  const removeCookie = (cookie: EditableConsentCookie) => {
    if (!window.confirm(`Remove cookie “${cookie.name || 'unnamed'}”?`)) return;
    patch({ cookies: settings.cookies.filter(item => item.id !== cookie.id) });
  };

  const selectedCategory = settings.categories.find(category => category.id === selectedCategoryId) || null;
  const selectedService = settings.services.find(service => service.id === selectedServiceId) || null;
  const selectedCookie = settings.cookies.find(cookie => cookie.id === selectedCookieId) || null;
  const selectedCookieIsManaged = selectedCookie ? MANAGED_CONSENT_COOKIE_IDS.has(selectedCookie.id) : false;
  const fieldError = (targetSection: CookieConsentValidationIssue['section'], field: string, itemId?: string) => validationIssues.find(issue =>
    issue.section === targetSection
      && issue.fields.includes(field)
      && (itemId === undefined || issue.itemId === itemId),
  )?.message;
  const reviewIssue = (issue: CookieConsentValidationIssue) => {
    setSection(issue.section);
    if (issue.section === 'categories' && issue.itemId) setSelectedCategoryId(issue.itemId);
    if (issue.section === 'services' && issue.itemId) setSelectedServiceId(issue.itemId);
    if (issue.section === 'cookies' && issue.itemId) setSelectedCookieId(issue.itemId);
  };

  return (
    <div data-kodety-cookie-consent-settings className={cn('min-w-0 border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)]', className)}>
      {validationIssues.length > 0 && (
        <div className="flex min-w-0 items-start gap-3 border-b border-destructive/30 bg-destructive/[.055] px-4 py-3 sm:px-6" role="alert">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-destructive">{validationIssues.length} {validationIssues.length === 1 ? 'pendência precisa' : 'pendências precisam'} de revisão</p>
            <p className="mt-0.5 text-[9px] leading-4 text-destructive/80">{validationIssues[0].message} O item e o campo exatos estão destacados.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-destructive hover:text-destructive" onClick={() => reviewIssue(validationIssues[0])}>Revisar</Button>
        </div>
      )}
      <div className="grid min-h-[720px] min-w-0 lg:grid-cols-[168px_minmax(0,1fr)]">
        <nav aria-label="Cookie Consent settings" className="min-w-0 border-b border-[var(--kodety-divider)] p-1.5 lg:border-b-0 lg:border-r">
          <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
            {SECTIONS.map(item => {
              const Icon = item.icon;
              const active = item.id === section;
              const issueCount = issueCounts.get(item.id) || 0;
              return (
                <button key={item.id} type="button" data-kodety-onboarding={`settings-cookies-${item.id}-tab`} data-kodety-onboarding-reveal={(item.id === 'services' && !settings.services.length) || (item.id === 'cookies' && !settings.cookies.length) ? undefined : ''} aria-current={active ? 'page' : undefined} aria-label={issueCount ? `${item.label}, ${issueCount} pendência${issueCount === 1 ? '' : 's'}` : item.label} onClick={() => setSection(item.id)} className={cn('flex h-9 min-w-[128px] items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] outline-none transition-colors lg:w-full lg:min-w-0', active ? 'bg-white/[.13] text-white' : 'text-muted-foreground hover:bg-white/[.055] hover:text-foreground', issueCount && 'text-destructive', 'focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]')}>
                  <Icon className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{item.label}</span>{issueCount > 0 && <span className="grid min-w-4 shrink-0 place-items-center rounded-full bg-destructive px-1 text-[8px] font-semibold leading-4 text-white">{issueCount}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        <div data-kodety-onboarding={(section === 'services' && !selectedService) || (section === 'cookies' && !selectedCookie) ? undefined : `settings-cookies-${section}`} className="min-w-0 px-3 py-4 sm:px-5 lg:px-6">
          {section === 'general' && (
            <div className="space-y-5">
              <SectionHeader title="Cookie Consent" description="Control when non-essential services can execute on the published site." />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <HtmlSettingsToggleControl label="Enable Cookie Consent" description="Publish the banner and gate mapped scripts, integrations and embeds." checked={settings.enabled} onChange={enabled => patch({ enabled })} />
                </div>
                <Field label="Banner type"><Segmented label="Banner type" value={settings.bannerType} options={[{ value: 'simple', label: 'Simple' }, { value: 'advanced', label: 'Advanced' }]} onChange={bannerType => patch({ bannerType })} /></Field>
                <Field label="Theme"><Segmented label="Theme" value={settings.theme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Auto' }]} onChange={theme => patch({ theme })} /></Field>
                <Field label="Position"><HtmlSettingsSelectControl label="Position" value={settings.position} allowUnset={false} onChange={position => patch({ position: position as ConsentPosition })} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'center-modal', label: 'Center modal' }]} /></Field>
                <Field label="Consent expiration" hint="Number of days before the visitor is asked again."><HtmlSettingsTextControl label="Consent expiration" kind="time" value={String(settings.expirationDays)} onChange={value => patch({ expirationDays: Math.max(1, Math.min(3650, Number(value) || 1)) })} /></Field>
                <Field label="Configuration version" hint="Managed automatically. Kodety increments this version when a material consent configuration change is published."><HtmlSettingsTextControl label="Configuration version" kind="number" value={String(settings.configurationVersion)} onChange={() => undefined} scrubbable={false} disabled /></Field>
                <div className="sm:col-span-2"><HtmlSettingsToggleControl label="Ask again when configuration changes" description="Invalidates prior consent when a material category, service or policy change is published." checked={settings.askAgainOnChange} onChange={askAgainOnChange => patch({ askAgainOnChange })} /></div>
                <Field label="Privacy Policy URL" error={fieldError('general', 'privacyPolicyUrl')}><HtmlSettingsTextControl label="Privacy Policy URL" kind="link" value={settings.privacyPolicyUrl} onChange={privacyPolicyUrl => patch({ privacyPolicyUrl })} placeholder="/privacy" /></Field>
                <Field label="Cookie Policy URL" error={fieldError('general', 'cookiePolicyUrl')}><HtmlSettingsTextControl label="Cookie Policy URL" kind="link" value={settings.cookiePolicyUrl} onChange={cookiePolicyUrl => patch({ cookiePolicyUrl })} placeholder="/cookies" /></Field>
                <HtmlSettingsToggleControl label="Block page interaction" description="Use an overlay and focus trap until a decision is made." checked={settings.disablePageInteraction} onChange={disablePageInteraction => patch({ disablePageInteraction })} />
                <HtmlSettingsToggleControl label="Respect DNT / Global Privacy Control" description="Keep optional categories denied when the browser requests privacy." checked={settings.respectDnt} onChange={respectDnt => patch({ respectDnt })} />
              </div>
              <BannerPreview settings={settings} />
            </div>
          )}

          {section === 'appearance' && (
            <div className="space-y-5">
              <SectionHeader title="Appearance" description="The published banner starts with a refined Kodety look and remains fully customizable." />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ColorField label="Background" value={settings.appearance.background} onChange={background => patchAppearance({ background })} />
                <ColorField label="Text" value={settings.appearance.text} onChange={text => patchAppearance({ text })} />
                <ColorField label="Muted text" value={settings.appearance.mutedText} onChange={mutedText => patchAppearance({ mutedText })} />
                <ColorField label="Primary / accent" value={settings.appearance.accent} onChange={accent => patchAppearance({ accent })} />
                <ColorField label="Accent text" value={settings.appearance.accentText} onChange={accentText => patchAppearance({ accentText })} />
                <ColorField label="Border" value={settings.appearance.border} onChange={border => patchAppearance({ border })} />
                <Field label="Border width"><HtmlSettingsTextControl label="Border width" kind="size" glyph={Square} value={`${settings.appearance.borderWidth}px`} onChange={value => patchAppearance({ borderWidth: Math.max(0, Math.min(12, Number.parseFloat(value) || 0)) })} /></Field>
                <Field label="Border radius"><HtmlSettingsTextControl label="Border radius" kind="size" glyph={CornerUpLeft} value={`${settings.appearance.borderRadius}px`} onChange={value => patchAppearance({ borderRadius: Math.max(0, Math.min(48, Number.parseFloat(value) || 0)) })} /></Field>
                <Field label="Button radius"><HtmlSettingsTextControl label="Button radius" kind="size" glyph={Circle} value={`${settings.appearance.buttonRadius}px`} onChange={value => patchAppearance({ buttonRadius: Math.max(0, Math.min(32, Number.parseFloat(value) || 0)) })} /></Field>
                <Field label="Padding"><HtmlSettingsTextControl label="Padding" kind="size" glyph={ChevronsExpandToLines} value={`${settings.appearance.padding}px`} onChange={value => patchAppearance({ padding: Math.max(8, Math.min(48, Number.parseFloat(value) || 8)) })} /></Field>
                <Field label="Max width"><HtmlSettingsTextControl label="Max width" kind="size" glyph={ArrowsExpandHorizontal} value={`${settings.appearance.maxWidth}px`} onChange={value => patchAppearance({ maxWidth: Math.max(280, Math.min(900, Number.parseFloat(value) || 280)) })} /></Field>
                <Field label="Shadow"><HtmlSettingsSelectControl label="Shadow" glyph={Layers3} value={settings.appearance.shadow} allowUnset={false} onChange={shadow => patchAppearance({ shadow: shadow as EditableConsentAppearance['shadow'] })} options={[{ value: 'none', label: 'None' }, { value: 'soft', label: 'Soft' }, { value: 'medium', label: 'Medium' }, { value: 'strong', label: 'Strong' }]} /></Field>
                <Field label="Font family"><HtmlSettingsSelectControl label="Font family" glyph={Type} value={settings.appearance.fontFamily} allowUnset={false} onChange={fontFamily => patchAppearance({ fontFamily: fontFamily as EditableConsentAppearance['fontFamily'] })} options={[{ value: 'system', label: 'System' }, { value: 'inter', label: 'Inter' }, { value: 'serif', label: 'Serif' }]} /></Field>
                <Field label="Font size"><HtmlSettingsTextControl label="Font size" kind="size" glyph={TextCursorInput} value={`${settings.appearance.fontSize}px`} onChange={value => patchAppearance({ fontSize: Math.max(12, Math.min(22, Number.parseFloat(value) || 12)) })} /></Field>
                <div className="sm:col-span-2 lg:col-span-3"><HtmlSettingsToggleControl label="Overlay behind preferences" glyph={Frames} checked={settings.appearance.overlay} onChange={overlay => patchAppearance({ overlay })} /></div>
              </div>
              <BannerPreview settings={settings} />
            </div>
          )}

          {section === 'content' && (
            <div className="space-y-5">
              <SectionHeader title="Content" description="Edit visitor-facing copy and action labels. The preview updates immediately." />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title" error={fieldError('content', 'title')}><HtmlSettingsTextControl label="Title" value={settings.content.title} onChange={title => patchContent({ title })} /></Field>
                <Field label="Preferences title"><HtmlSettingsTextControl label="Preferences title" value={settings.content.preferencesTitle} onChange={preferencesTitle => patchContent({ preferencesTitle })} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Description" error={fieldError('content', 'description')} hint="Explain purposes plainly; avoid implying that optional tracking is required."><HtmlSettingsTextControl label="Description" value={settings.content.description} onChange={description => patchContent({ description })} multiline /></Field>
                <Field label="Preferences description" hint="Shown when the visitor opens the detailed consent panel."><HtmlSettingsTextControl label="Preferences description" value={settings.content.preferencesDescription} onChange={preferencesDescription => patchContent({ preferencesDescription })} multiline /></Field>
              </div>
              <div className="grid gap-3 border-t border-[var(--kodety-divider)] pt-4 sm:grid-cols-2">
                <Field label="Accept button label" error={fieldError('content', 'acceptAllLabel')}><HtmlSettingsTextControl label="Accept button label" value={settings.content.acceptAllLabel} onChange={acceptAllLabel => patchContent({ acceptAllLabel })} /></Field>
                <Field label="Reject button label" error={fieldError('content', 'rejectAllLabel')}><HtmlSettingsTextControl label="Reject button label" value={settings.content.rejectAllLabel} onChange={rejectAllLabel => patchContent({ rejectAllLabel })} /></Field>
                <Field label="Settings button label" error={fieldError('content', 'settingsLabel')}><HtmlSettingsTextControl label="Settings button label" value={settings.content.settingsLabel} onChange={settingsLabel => patchContent({ settingsLabel })} /></Field>
                <Field label="Save preferences label"><HtmlSettingsTextControl label="Save preferences label" value={settings.content.savePreferencesLabel} onChange={savePreferencesLabel => patchContent({ savePreferencesLabel })} /></Field>
                <Field label="Privacy Policy link label"><HtmlSettingsTextControl label="Privacy Policy link label" value={settings.content.privacyPolicyLabel} onChange={privacyPolicyLabel => patchContent({ privacyPolicyLabel })} /></Field>
                <Field label="Cookie Policy link label"><HtmlSettingsTextControl label="Cookie Policy link label" value={settings.content.cookiePolicyLabel} onChange={cookiePolicyLabel => patchContent({ cookiePolicyLabel })} /></Field>
                <Field label="Close label"><HtmlSettingsTextControl label="Close label" value={settings.content.closeLabel} onChange={closeLabel => patchContent({ closeLabel })} /></Field>
                <Field label="Service details label"><HtmlSettingsTextControl label="Service details label" value={settings.content.serviceDetailsLabel} onChange={serviceDetailsLabel => patchContent({ serviceDetailsLabel })} /></Field>
              </div>
              <BannerPreview settings={settings} />
            </div>
          )}

          {section === 'categories' && (
            <div className="space-y-4">
              <SectionHeader title="Consent categories" description="Necessary stays required. Add purpose-specific categories for every optional script or service." action={<Button className="h-9 rounded-[9px]" onClick={addCategory}><Plus />Add category</Button>} />
              <div className="min-h-[540px] overflow-hidden rounded-[10px] border border-white/[.06] lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="border-b border-[var(--kodety-divider)] lg:border-b-0 lg:border-r"><EditorList>{[...settings.categories].sort((a, b) => a.order - b.order).map(category => <EditorListButton key={category.id} active={category.id === selectedCategory?.id} invalid={validationIssues.some(issue => issue.section === 'categories' && issue.itemId === category.id)} title={category.name || 'Unnamed category'} meta={category.required ? 'Required' : category.defaultEnabled ? 'Default on' : 'Default off'} icon={category.required ? Lock : Layers3} onClick={() => setSelectedCategoryId(category.id)} />)}</EditorList></div>
                {selectedCategory ? <div className="min-w-0 space-y-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name" error={fieldError('categories', 'name', selectedCategory.id)}><HtmlSettingsTextControl label="Category name" value={selectedCategory.name} onChange={name => updateCategory(selectedCategory.id, { name })} /></Field>
                    <Field label="Internal ID" error={fieldError('categories', 'id', selectedCategory.id)} hint="Stable ID used by scripts and the Developer API."><HtmlSettingsTextControl label="Category internal ID" kind="id" value={selectedCategory.id} disabled={selectedCategory.required} onChange={raw => renameCategory(selectedCategory, raw)} /></Field>
                    <div className="sm:col-span-2"><Field label="Description" error={fieldError('categories', 'description', selectedCategory.id)}><HtmlSettingsTextControl label="Category description" value={selectedCategory.description} onChange={description => updateCategory(selectedCategory.id, { description })} multiline /></Field></div>
                    <HtmlSettingsToggleControl label="Required" description="Visitors cannot disable this category." checked={selectedCategory.required} disabled={selectedCategory.id === 'necessary'} onChange={required => updateCategory(selectedCategory.id, { required, defaultEnabled: required || selectedCategory.defaultEnabled, allowVisitorControl: required ? false : selectedCategory.allowVisitorControl })} />
                    <HtmlSettingsToggleControl label="Allow visitor control" checked={selectedCategory.allowVisitorControl} disabled={selectedCategory.required} onChange={allowVisitorControl => updateCategory(selectedCategory.id, { allowVisitorControl })} />
                    <HtmlSettingsToggleControl label="Enabled by default" checked={selectedCategory.defaultEnabled} disabled={selectedCategory.required} onChange={defaultEnabled => updateCategory(selectedCategory.id, { defaultEnabled })} />
                    <Field label="Order"><HtmlSettingsTextControl label="Category order" kind="number" value={String(selectedCategory.order)} onChange={value => updateCategory(selectedCategory.id, { order: Math.max(0, Math.round(Number(value) || 0)) })} /></Field>
                  </div>
                  {!selectedCategory.required && <div className="flex justify-end border-t border-[var(--kodety-divider)] pt-3"><Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeCategory(selectedCategory)}><Trash2 />Remove category</Button></div>}
                </div> : <div className="grid min-h-64 place-items-center text-[11px] text-muted-foreground">Select a category.</div>}
              </div>
            </div>
          )}

          {section === 'services' && (
            <div className="space-y-4">
              <SectionHeader title="Services" description="Explain providers, purposes, retention and linked integrations inside each category." action={<Button className="h-9 rounded-[9px]" onClick={addService}><Plus />Add service</Button>} />
              <div className="min-h-[540px] overflow-hidden rounded-[10px] border border-white/[.06] lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="border-b border-[var(--kodety-divider)] lg:border-b-0 lg:border-r"><EditorList>{settings.services.length ? settings.services.map(service => <EditorListButton key={service.id} active={service.id === selectedService?.id} invalid={validationIssues.some(issue => issue.section === 'services' && issue.itemId === service.id)} title={service.name || 'Unnamed service'} meta={`${service.provider || 'No provider'} · ${settings.categories.find(category => category.id === service.categoryId)?.name || 'Uncategorized'}`} icon={Database} onClick={() => setSelectedServiceId(service.id)} />) : <p className="px-3 py-10 text-center text-[10px] text-muted-foreground">No services yet.</p>}</EditorList></div>
                {selectedService ? <div className="min-w-0 space-y-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name" error={fieldError('services', 'name', selectedService.id)}><HtmlSettingsTextControl label="Service name" value={selectedService.name} onChange={name => updateService(selectedService.id, { name })} /></Field>
                    <Field label="Provider"><HtmlSettingsTextControl label="Service provider" value={selectedService.provider} onChange={provider => updateService(selectedService.id, { provider })} /></Field>
                    <Field label="Category" error={fieldError('services', 'categoryId', selectedService.id)}><HtmlSettingsSelectControl label="Service category" value={selectedService.categoryId} allowUnset={false} options={categoryOptions} onChange={categoryId => updateService(selectedService.id, { categoryId })} /></Field>
                    <Field label="Privacy Policy URL" error={fieldError('services', 'privacyPolicyUrl', selectedService.id)}><HtmlSettingsTextControl label="Service Privacy Policy URL" kind="link" value={selectedService.privacyPolicyUrl} onChange={privacyPolicyUrl => updateService(selectedService.id, { privacyPolicyUrl })} /></Field>
                    <div className="sm:col-span-2"><Field label="Description"><HtmlSettingsTextControl label="Service description" value={selectedService.description} onChange={description => updateService(selectedService.id, { description })} multiline /></Field></div>
                    <Field label="Data retention"><HtmlSettingsTextControl label="Service data retention" kind="time" value={selectedService.dataRetention} onChange={dataRetention => updateService(selectedService.id, { dataRetention })} placeholder="Ex.: 14 months" /></Field>
                    <Field label="Cookies used"><HtmlSettingsTextControl label="Service cookies used" value={selectedService.cookies.join(', ')} onChange={value => updateService(selectedService.id, { cookies: csv(value) })} /></Field>
                    <Field label="Enabled pages"><HtmlSettingsTextControl label="Service enabled pages" kind="link" value={selectedService.enabledPages.join(', ')} onChange={value => updateService(selectedService.id, { enabledPages: csv(value) })} placeholder="Empty = all pages" /></Field>
                    <div className="sm:col-span-2"><HtmlSettingsToggleControl label="Consent required" checked={selectedService.consentRequired} onChange={consentRequired => updateService(selectedService.id, { consentRequired })} /></div>
                    {customCode?.entries.some(entry => entry.enabled && entry.consent === 'required') && (
                      <div className="space-y-2 sm:col-span-2">
                        <span className="block text-[10px] font-medium text-[var(--kodety-text-secondary)]">Linked Custom Code</span>
                        <div className="space-y-1 rounded-[9px] border border-[var(--kodety-divider)] p-2">
                          {customCode.entries.filter(entry => entry.enabled && entry.consent === 'required').map(entry => (
                            <HtmlSettingsToggleControl
                              key={entry.id}
                              label={entry.name}
                              description={`${entry.placement} · ${entry.scope === 'all' ? 'All pages' : `${entry.pages.length} page(s)`}`}
                              checked={selectedService.scriptIds.includes(entry.id)}
                              onChange={linked => updateService(selectedService.id, {
                                scriptIds: linked
                                  ? Array.from(new Set([...selectedService.scriptIds, entry.id]))
                                  : selectedService.scriptIds.filter(id => id !== entry.id),
                              })}
                            />
                          ))}
                        </div>
                        <p className="kodety-info-copy text-[9px] leading-4">Linked snippets inherit this service category and remain inert until the visitor allows it.</p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end border-t border-[var(--kodety-divider)] pt-3"><Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeService(selectedService)}><Trash2 />Remove service</Button></div>
                </div> : <div className="grid min-h-64 place-items-center text-[11px] text-muted-foreground">Add or select a service.</div>}
              </div>
            </div>
          )}

          {section === 'cookies' && (
            <div className="space-y-4">
              <SectionHeader title="Cookie inventory" description="Document responsibility, purpose and duration. Published preferences expose this inventory to visitors." action={<Button className="h-9 rounded-[9px]" onClick={addCookie}><Plus />Add cookie</Button>} />
              <div className="min-h-[540px] overflow-hidden rounded-[10px] border border-white/[.06] lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="border-b border-[var(--kodety-divider)] lg:border-b-0 lg:border-r"><EditorList>{settings.cookies.length ? settings.cookies.map(cookie => <EditorListButton key={cookie.id} active={cookie.id === selectedCookie?.id} invalid={validationIssues.some(issue => issue.section === 'cookies' && issue.itemId === cookie.id)} title={cookie.name || 'Unnamed cookie'} meta={`${cookie.provider || 'Unknown provider'} · ${cookie.duration || cookie.type}`} icon={List} onClick={() => setSelectedCookieId(cookie.id)} />) : <p className="px-3 py-10 text-center text-[10px] text-muted-foreground">No cookies documented.</p>}</EditorList></div>
                {selectedCookie ? <div className="min-w-0 space-y-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Cookie name" error={fieldError('cookies', 'name', selectedCookie.id)}><HtmlSettingsTextControl label="Cookie name" kind="code" value={selectedCookie.name} onChange={name => updateCookie(selectedCookie.id, { name })} placeholder="_ga" /></Field>
                    <Field label="Domain"><HtmlSettingsTextControl label="Cookie domain" kind="link" value={selectedCookie.domain} onChange={domain => updateCookie(selectedCookie.id, { domain })} /></Field>
                    <Field label="Provider"><HtmlSettingsTextControl label="Cookie provider" value={selectedCookie.provider} onChange={provider => updateCookie(selectedCookie.id, { provider })} /></Field>
                    <Field label="Category" error={fieldError('cookies', 'categoryId', selectedCookie.id)}><HtmlSettingsSelectControl label="Cookie category" value={selectedCookie.categoryId} allowUnset={false} options={categoryOptions} onChange={categoryId => updateCookie(selectedCookie.id, { categoryId })} /></Field>
                    <Field label="Duration"><HtmlSettingsTextControl label="Cookie duration" kind="time" value={selectedCookie.duration} onChange={duration => updateCookie(selectedCookie.id, { duration })} placeholder="Ex.: 2 years" /></Field>
                    <Field label="Type"><Segmented label="Cookie type" value={selectedCookie.type} options={[{ value: 'session', label: 'Session' }, { value: 'persistent', label: 'Persistent' }]} onChange={type => updateCookie(selectedCookie.id, { type })} /></Field>
                    <Field label="Party"><Segmented label="Cookie party" value={selectedCookie.party} options={[{ value: 'first', label: 'First-party' }, { value: 'third', label: 'Third-party' }]} onChange={party => updateCookie(selectedCookie.id, { party })} /></Field>
                    <div className="sm:col-span-2"><Field label="Purpose" error={fieldError('cookies', 'purpose', selectedCookie.id)}><HtmlSettingsTextControl label="Cookie purpose" value={selectedCookie.purpose} onChange={purpose => updateCookie(selectedCookie.id, { purpose })} multiline /></Field></div>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-[var(--kodety-divider)] pt-3">
                    {selectedCookieIsManaged ? <p className="kodety-info-copy text-[9px] leading-4">Managed by Kodety because the consent runtime always uses this cookie.</p> : <span />}
                    {!selectedCookieIsManaged && <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeCookie(selectedCookie)}><Trash2 />Remove cookie</Button>}
                  </div>
                </div> : <div className="grid min-h-64 place-items-center text-[11px] text-muted-foreground">Add or select a cookie.</div>}
              </div>
            </div>
          )}

          {section === 'integrations' && (
            <div className="space-y-5">
              <SectionHeader title="Integrations & Consent Mode" description="Map integrations to a consent purpose. Unmapped scripts are never silently categorized." />
              <div className="grid gap-3 sm:grid-cols-2">
                {INTEGRATION_FIELDS.map(integration => {
                  const detected = diagnostics.integrations.find(item => item.id === integration.marker);
                  const configured = configuredIntegrations.has(integration.marker);
                  return <Field key={integration.key} label={integration.label} hint={detected ? `Detected on ${detected.pages.length} page(s).` : configured ? 'Configured in Settings → Integrations.' : undefined}>
                    <HtmlSettingsSelectControl label={`${integration.label} category`} value={settings.integrationCategories[integration.key] || ''} options={categoryOptions.filter(option => !settings.categories.find(category => category.id === option.value)?.required)} onChange={categoryId => patch({ integrationCategories: { ...settings.integrationCategories, [integration.key]: categoryId } })} placeholder="Unmapped" />
                  </Field>
                })}
              </div>
              <div className="space-y-3 border-t border-[var(--kodety-divider)] pt-4">
                <HtmlSettingsToggleControl label="Enable Google Consent Mode v2" description="Send default and updated storage signals alongside script blocking." checked={settings.googleConsentMode.enabled} onChange={enabled => patchGoogle({ enabled })} />
                {settings.googleConsentMode.enabled && <>
                  <Field label="Consent Mode"><Segmented label="Google Consent Mode" value={settings.googleConsentMode.mode} options={[{ value: 'basic', label: 'Basic' }, { value: 'advanced', label: 'Advanced' }]} onChange={mode => patchGoogle({ mode })} /></Field>
                  <p className="kodety-info-copy text-[9px] leading-4">Analytics, advertising, functionality, personalization and security storage states follow the category mappings above. Basic mode holds Google tags; Advanced mode loads them with denied defaults and updates them after the visitor decides.</p>
                </>}
              </div>
              <div className="rounded-[10px] border border-white/[.065] bg-white/[.025] p-3">
                <div className="flex items-center gap-2"><ScanSearch className="size-4 text-[var(--kodety-accent-hover)]" /><h3 className="text-[11px] font-semibold">Local project diagnosis</h3></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-[8px] bg-white/[.045] p-3"><div className="text-lg font-semibold tabular-nums">{diagnostics.integrations.reduce((total, item) => total + item.count, 0)}</div><div className="text-[9px] text-muted-foreground">integration tags</div></div>
                  <div className="rounded-[8px] bg-white/[.045] p-3"><div className="text-lg font-semibold tabular-nums">{diagnostics.embeds.reduce((total, item) => total + item.count, 0)}</div><div className="text-[9px] text-muted-foreground">known embeds</div></div>
                  <div className="rounded-[8px] bg-white/[.045] p-3"><div className={cn('text-lg font-semibold tabular-nums', diagnostics.uncategorizedScripts.length && 'text-[var(--kodety-warning)]')}>{diagnostics.uncategorizedScripts.length}</div><div className="text-[9px] text-muted-foreground">unmapped external scripts</div></div>
                  <div className="rounded-[8px] bg-white/[.045] p-3"><div className="text-lg font-semibold tabular-nums">{gatedCustomCodeCount}</div><div className="text-[9px] text-muted-foreground">consent-gated custom codes</div></div>
                </div>
                {(diagnostics.embeds.length > 0 || diagnostics.uncategorizedScripts.length > 0) && <div className="mt-3 space-y-1 border-t border-white/[.055] pt-3 text-[9px] leading-4 text-muted-foreground">{diagnostics.embeds.map(embed => <p key={embed.provider}><span className="text-foreground">{embed.provider}</span> · {embed.count} embed(s) · gated by Embedded Content</p>)}{diagnostics.uncategorizedScripts.slice(0, 5).map(item => <p key={`${item.page}:${item.src}`} className="truncate"><span className="text-[var(--kodety-warning)]">Needs category</span> · {item.src} · {item.page}</p>)}</div>}
              </div>
            </div>
          )}

          {section === 'advanced' && (
            <div className="space-y-5">
              <SectionHeader title="Advanced privacy controls" description="Regional presets are operational defaults, not a promise of automatic legal compliance." />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Regional preset"><HtmlSettingsSelectControl label="Regional preset" value={settings.advanced.region} allowUnset={false} onChange={region => patchAdvanced({ region: region as EditableAdvancedConsent['region'] })} options={[{ value: 'global', label: 'Global' }, { value: 'eu', label: 'European Union' }, { value: 'uk', label: 'United Kingdom' }, { value: 'brazil', label: 'Brazil' }, { value: 'us', label: 'United States' }, { value: 'custom', label: 'Custom' }]} /></Field>
                <HtmlSettingsToggleControl label="Consent history" description="Keep an anonymous, local record of consent state changes." checked={settings.advanced.recordHistory} onChange={recordHistory => patchAdvanced({ recordHistory })} />
                {settings.advanced.recordHistory && <Field label="History retention"><HtmlSettingsTextControl label="History retention" kind="time" value={String(settings.advanced.historyRetentionDays)} onChange={value => patchAdvanced({ historyRetentionDays: Math.max(1, Math.min(3650, Number(value) || 1)) })} /></Field>}
                <HtmlSettingsToggleControl label="Debug mode" description="Expose current, loaded and blocked consent sources to the local debugger." checked={settings.advanced.debug} onChange={debug => patchAdvanced({ debug })} />
                <HtmlSettingsToggleControl label="Re-consent for new categories" checked={settings.advanced.reconsentOnNewCategory} onChange={reconsentOnNewCategory => patchAdvanced({ reconsentOnNewCategory })} />
                <HtmlSettingsToggleControl label="Re-consent for new services" checked={settings.advanced.reconsentOnNewService} onChange={reconsentOnNewService => patchAdvanced({ reconsentOnNewService })} />
                <HtmlSettingsToggleControl label="Re-consent after policy changes" checked={settings.advanced.reconsentOnPolicyChange} onChange={reconsentOnPolicyChange => patchAdvanced({ reconsentOnPolicyChange })} />
              </div>
              <div className="space-y-3 border-t border-[var(--kodety-divider)] pt-4">
                <HtmlSettingsToggleControl label="Permanent Privacy Center" description="Allow visitors to reopen their preferences after the initial decision." checked={settings.privacyCenter.enabled} onChange={enabled => patchPrivacyCenter({ enabled })} />
                {settings.privacyCenter.enabled && <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Link label"><HtmlSettingsTextControl label="Privacy Center link label" value={settings.privacyCenter.buttonLabel} onChange={buttonLabel => patchPrivacyCenter({ buttonLabel })} /></Field>
                  <div className="sm:col-span-2"><HtmlSettingsToggleControl label="Floating preferences button" checked={settings.privacyCenter.floatingButton} onChange={floatingButton => patchPrivacyCenter({ floatingButton })} /></div>
                  <p className="kodety-info-copy sm:col-span-2 text-[9px] leading-4">Use <code className="rounded bg-black/20 px-1.5 py-0.5 text-[var(--kodety-accent-hover)]">#cookie-preferences</code> as the URL of any footer link or button to reopen this panel on the published site.</p>
                </div>}
              </div>
              <div className="rounded-[10px] border border-[var(--kodety-accent-border)] bg-[var(--kodety-accent-muted)] p-3">
                <div className="flex items-center gap-2 text-[var(--kodety-accent-hover)]"><Code2 className="size-4" /><h3 className="text-[11px] font-semibold">Developer API</h3></div>
                <pre className="mt-3 overflow-x-auto rounded-[8px] bg-black/25 p-3 text-[10px] leading-5 text-white/75"><code>{`kodety.consent.has("analytics")\nkodety.consent.get()\nkodety.consent.open()\nkodety.consent.on("change", consent => {\n  // ...\n})`}</code></pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HtmlCookieConsentSettings;
