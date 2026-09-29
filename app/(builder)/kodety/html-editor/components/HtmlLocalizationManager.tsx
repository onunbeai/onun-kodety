'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GlobalIcon } from '@solar-icons/react/bold-duotone/global';
import {
  ArrowLeft,
  Check,
  FileText,
  Globe2,
  Languages,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from '@/components/ui/gravity-icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DisclosureChevron } from '@/components/ui/disclosure-summary';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { localeFlagAssetUrl } from '@/lib/html-editor/locale-flag-assets';
import { builderOnboardingDialogProps, useBuilderOnboardingActive } from '@/lib/html-editor/onboarding-active';
import type { HtmlProject } from '@/lib/html-editor/types';
import { readEditorMetadata } from '@/lib/html-editor/project-io';
import {
  COMMON_LOCALES,
  assertLocalizationForPersistence,
  canonicalLocaleCode,
  createLocale,
  extractLocalizableEntries,
  isLocalizationPageFile,
  isValidLocaleCode,
  localeSlug,
  normalizeLocalization,
  setDefaultLocale,
  translationValueForEntry,
  updateTranslation,
  type LocalizationLocale,
  type LocalizationSettings,
} from '@/lib/html-editor/localization';
import { HtmlSettingsFieldControl } from './HtmlProjectSettingsFieldControl';
import {
  HtmlSettingsSelectControl,
  HtmlSettingsTextControl,
  HtmlSettingsToggleControl,
} from './HtmlSettingsControls';

interface HtmlLocalizationManagerProps {
  logoMenu?: ReactNode;
  project: HtmlProject;
  settings: LocalizationSettings;
  backHref: string;
  aiGenerateUrl?: string;
  aiSettingsPageUrl?: string;
  nonce?: string;
  readOnly?: boolean;
  topbarActions?: ReactNode;
  onChange: (settings: LocalizationSettings) => void | Promise<void>;
  onNavigate?: (href: string) => void;
}

type TranslationFilter = 'all' | 'missing' | 'translated';
type SettingsPane = 'general' | string;
type LocalizationCommitResult = 'saved' | 'queued' | false;

const LOCALIZATION_CONTROL_CLASS = 'h-9 w-full min-w-0 rounded-[9px] border border-transparent bg-white/[.055] text-[11px] shadow-none transition-[border-color,background-color] hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075] focus-visible:ring-0 data-[state=open]:border-[var(--kodety-focus)]/75 data-[state=open]:bg-white/[.075]';
const LOCALIZATION_ICON_BUTTON_CLASS = 'inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-transparent bg-transparent text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.06] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:text-[var(--kodety-accent-hover)]';
const LOCALIZATION_DESCRIPTION_CLASS = 'text-balance text-[10px] leading-4 text-[var(--kodety-info-copy)]';
const translationFieldClassName = 'min-h-9 w-full border-0 bg-transparent px-0 text-[11px] leading-4 text-[var(--kodety-text)] outline-none shadow-none placeholder:text-white/28 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50';
const AI_TRANSLATION_BATCH_ITEMS = 24;
const AI_TRANSLATION_BATCH_CHARACTERS = 12_000;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function aiTranslationErrorMessage(payload: Record<string, unknown>) {
  const details = isJsonObject(payload.data) ? payload.data : null;
  const candidates = [payload.message, details?.message];
  const message = candidates.find((candidate) => (
    typeof candidate === 'string' && candidate.trim().length > 0
  ));
  return typeof message === 'string' ? message.trim() : '';
}

function aiTranslationConfigurationRequired(payload: Record<string, unknown>) {
  const details = isJsonObject(payload.data) ? payload.data : null;
  return payload.code === 'kodety_ai_configuration_required'
    || details?.reason === 'no_provider_credentials'
    || details?.reason === 'selected_provider_credentials_missing';
}

class AiTranslationConfigurationError extends Error {
  override readonly name = 'AiTranslationConfigurationError';
}

async function readAiTranslationResponse(response: Response) {
  const body = await response.text();
  const normalizedBody = body.replace(/^\uFEFF/, '').trim();
  let parsed: unknown = null;
  if (normalizedBody) {
    try {
      parsed = JSON.parse(normalizedBody);
    } catch {
      // WordPress and reverse proxies may return an HTML error or login page.
    }
  }
  if (isJsonObject(parsed)) return parsed;

  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const looksLikeHtml = contentType.includes('text/html')
    || /^(?:<!doctype\s+html|<html\b)/i.test(normalizedBody);
  const statusLabel = response.status ? ` (HTTP ${response.status})` : '';
  if (looksLikeHtml) {
    throw new Error(
      `O WordPress devolveu uma página HTML em vez da resposta da IA${statusLabel}. Recarregue a página e tente novamente.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `O WordPress não conseguiu concluir a tradução${statusLabel}. Recarregue a página e tente novamente.`,
    );
  }
  throw new Error('A IA respondeu em um formato inválido. Tente novamente.');
}

function aiTranslationBatches(items: Array<{ key: string; source: string }>) {
  const batches: Array<Array<{ key: string; source: string }>> = [];
  let batch: Array<{ key: string; source: string }> = [];
  let characters = 0;
  items.forEach((item) => {
    const itemCharacters = item.key.length + item.source.length;
    if (
      batch.length
      && (batch.length >= AI_TRANSLATION_BATCH_ITEMS
        || characters + itemCharacters > AI_TRANSLATION_BATCH_CHARACTERS)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(item);
    characters += itemCharacters;
  });
  if (batch.length) batches.push(batch);
  return batches;
}

type LocaleIdentity = Pick<LocalizationLocale, 'code' | 'language' | 'region' | 'name'>;

function localeRegion(locale: LocaleIdentity) {
  const explicit = locale.region?.trim().toUpperCase() || '';
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  try {
    const inferred = new Intl.Locale(locale.code).maximize().region?.toUpperCase() || '';
    if (/^[A-Z]{2}$/.test(inferred)) return inferred;
  } catch {
    // Custom locales remain valid without a flag; the globe fallback below
    // keeps the UI stable while their BCP 47 code is being edited.
  }
  const common = COMMON_LOCALES.find((candidate) => candidate.language === locale.language)?.region || '';
  return /^[A-Z]{2}$/.test(common) ? common : '';
}

function LocaleFlag({
  className = '',
  locale,
  size = 'sm',
}: {
  className?: string;
  locale: LocaleIdentity;
  size?: 'sm' | 'md' | 'lg';
}) {
  const region = localeRegion(locale);
  const assetUrl = localeFlagAssetUrl(region);
  const dimensions = size === 'lg'
    ? 'h-[30px] w-10'
    : size === 'md'
      ? 'h-[21px] w-7'
      : 'h-[18px] w-6';
  if (!assetUrl) {
    const iconSize = size === 'lg' ? 'size-5' : size === 'md' ? 'size-4' : 'size-3.5';
    return (
      <Globe2
        className={`shrink-0 text-muted-foreground ${iconSize} ${className}`}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      src={assetUrl}
      alt=""
      className={`block shrink-0 object-cover rounded-[3px] ${dimensions} ${className}`}
      title={region ? `Região ${region}` : 'Locale internacional'}
      aria-hidden="true"
      draggable={false}
    />
  );
}

function LocaleSelect({
  ariaLabel,
  disabled = false,
  locales,
  onValueChange,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  locales: LocalizationLocale[];
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          LOCALIZATION_CONTROL_CLASS,
          'group gap-0 overflow-hidden !p-0 !pr-2.5',
        )}
      >
        <span className="mr-2 grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 transition-colors group-data-[state=open]:text-[var(--kodety-accent-hover)]">
          <Globe2 className="size-3.5" />
        </span>
        <SelectValue placeholder="Selecione um idioma" />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[var(--radix-select-trigger-width)]">
        {locales.map((locale) => (
          <SelectItem key={locale.code} value={locale.code}>
            <LocaleFlag locale={locale} />
            <span className="min-w-0 truncate">{locale.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CustomLocaleCodeControl({
  onChange,
  onUse,
  value,
}: {
  onChange: (value: string) => void;
  onUse: () => void;
  value: string;
}) {
  const valid = isValidLocaleCode(value);
  return (
    <div>
      <label className="mb-1.5 block text-[9px] font-medium text-[var(--kodety-text-tertiary)]">Código personalizado</label>
      <div
        data-html-settings-control
        data-kodety-settings-control
        data-kodety-localization-custom-code
        className={cn(
        'flex h-9 overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/75 focus-within:bg-white/[.075]',
        Boolean(value) && !valid && 'border-[var(--kodety-danger)]',
        )}
      >
        <Input
          data-kodety-settings-control-inner
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="ca-ES"
          className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-[11px] shadow-none focus-visible:ring-0"
          disableKeyboardStep
          aria-label="Código personalizado"
          aria-invalid={Boolean(value) && !valid}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid) {
              event.preventDefault();
              onUse();
            }
          }}
        />
        <button
          type="button"
          className="shrink-0 border-l border-[var(--kodety-divider)] bg-transparent px-3 text-[9px] font-medium text-[var(--kodety-text-secondary)] outline-none transition-colors hover:bg-white/[.045] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!valid}
          onClick={onUse}
        >
          Usar
        </button>
      </div>
    </div>
  );
}

function pageLabel(path: string) {
  const name = path.split('/').pop()?.replace(/\.html?$/i, '') || path;
  return name.toLowerCase() === 'index' ? 'Home' : name.replaceAll('-', ' ');
}

function pageSeoSource(html: string) {
  if (typeof DOMParser === 'undefined') return { title: '', description: '' };
  const document = new DOMParser().parseFromString(html, 'text/html');
  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
  };
}

function matchesTranslation(
  query: string,
  filter: TranslationFilter,
  original: string,
  translation: string,
  context = '',
) {
  const isTranslated = Boolean(translation.trim());
  if (filter === 'missing' && isTranslated) return false;
  if (filter === 'translated' && !isTranslated) return false;
  const search = query.trim().toLocaleLowerCase();
  return !search || `${original} ${translation} ${context}`.toLocaleLowerCase().includes(search);
}

function localeDraft(locale: LocalizationLocale, sourceLocale: string): LocalizationLocale {
  return {
    ...locale,
    fallback: locale.fallback || sourceLocale,
    slug: locale.slug || localeSlug(locale.code),
  };
}

function SettingsField({
  children,
  hint,
  label,
  onboardingId,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
  onboardingId?: string;
}) {
  return (
    <div data-kodety-onboarding={onboardingId} className="grid min-h-12 grid-cols-1 gap-1.5 border-t border-[var(--kodety-divider)] py-1.5 first:border-t-0 sm:grid-cols-[124px_minmax(0,1fr)] sm:items-start sm:gap-4">
      <span className="min-w-0 pt-1.5">
        <span className="block text-[11px] font-medium text-[var(--kodety-text-secondary)]">{label}</span>
        {hint && <span className="mt-1 block text-balance text-[9px] leading-3.5 text-[var(--kodety-info-copy)]">{hint}</span>}
      </span>
      <span className="block min-w-0">{children}</span>
    </div>
  );
}

function TranslationStatus({
  translated,
}: {
  translated: boolean;
}) {
  if (translated) return null;
  return (
    <span
      className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 text-[8px] font-medium text-[var(--kodety-warning)]"
      title="Tradução pendente"
      aria-hidden="true"
    >
      <span className="size-1 rounded-full bg-current" />
      Novo
    </span>
  );
}

function TranslationRow({
  disabled = false,
  direction,
  fieldLabel,
  multiline = true,
  onChange,
  original,
  onboardingId,
  targetLocale,
  value,
}: {
  disabled?: boolean;
  direction: 'ltr' | 'rtl';
  fieldLabel?: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  original: string;
  onboardingId?: string;
  targetLocale: string;
  value: string;
}) {
  const translated = Boolean(value.trim());
  const inputLabel = fieldLabel
    ? `${fieldLabel} em ${targetLocale}`
    : `Tradução de “${original.slice(0, 64)}” para ${targetLocale}`;

  return (
    <div
      data-kodety-onboarding={onboardingId}
      className="group grid min-h-16 grid-cols-1 border-b border-[var(--kodety-divider)] transition-colors last:border-b-0 md:grid-cols-2"
      data-kodety-translation-state={translated ? 'translated' : 'missing'}
      title={translated ? 'Tradução preenchida' : 'Tradução pendente'}
    >
      <div className="min-w-0 px-4 py-3 md:border-r md:border-[var(--kodety-divider)] sm:px-5">
        <span className="mb-1 flex items-center gap-3 md:hidden">
          <span className="text-[9px] font-medium text-[var(--kodety-text-tertiary)]">
            Original
          </span>
        </span>
        {fieldLabel && (
          <span className="block text-[9px] font-medium text-[var(--kodety-text-tertiary)]">
            {fieldLabel}
          </span>
        )}
        <span
          className={`${fieldLabel ? 'mt-1 ' : ''}block text-balance break-words text-[11px] leading-4 text-[var(--kodety-info-copy)]`}
          dir="auto"
        >
          {original || '—'}
        </span>
      </div>
      <label
        data-kodety-localization-translation-editor
        className="relative flex min-h-16 min-w-0 flex-col items-stretch border-b border-transparent px-4 py-3 transition-[border-color] focus-within:border-[var(--kodety-focus)]/72 sm:px-5"
      >
        <span className="sr-only">{inputLabel}</span>
        <span className="mb-1 block truncate text-[9px] font-medium text-[var(--kodety-text-tertiary)] md:hidden" dir="auto">{targetLocale}</span>
        {multiline ? (
          <textarea
            data-kodety-localization-translation-input
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Adicionar tradução…"
            rows={1}
            className={cn(translationFieldClassName, 'min-h-8 flex-1 resize-y pr-14')}
            aria-label={inputLabel}
            aria-readonly={disabled}
            dir={direction}
            spellCheck
          />
        ) : (
          <Input
            data-kodety-localization-translation-input
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Adicionar tradução…"
            className={cn(translationFieldClassName, 'h-8 flex-1 pr-14')}
            disableKeyboardStep
            aria-label={inputLabel}
            aria-readonly={disabled}
            dir={direction}
          />
        )}
        <TranslationStatus translated={translated} />
        <span className="sr-only">{translated ? 'Traduzido' : 'Pendente'}</span>
      </label>
    </div>
  );
}

export function HtmlLocalizationManager({
  logoMenu,
  project,
  settings: rawSettings,
  backHref,
  aiGenerateUrl,
  aiSettingsPageUrl,
  nonce,
  readOnly = false,
  topbarActions,
  onChange,
  onNavigate,
}: HtmlLocalizationManagerProps) {
  const onboardingActive = useBuilderOnboardingActive();
  const settings = useMemo(() => normalizeLocalization(rawSettings), [rawSettings]);
  const targetLocales = useMemo(
    () => settings.locales.filter((locale) => locale.code !== settings.sourceLocale),
    [settings],
  );
  const [selectedLocale, setSelectedLocale] = useState(targetLocales[0]?.code || '');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TranslationFilter>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>('general');
  const [addingLocale, setAddingLocale] = useState(false);
  const [addingLocalePending, setAddingLocalePending] = useState(false);
  const [localeSearch, setLocaleSearch] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [draftLocale, setDraftLocale] = useState<LocalizationLocale | null>(null);
  const [translationScope, setTranslationScope] = useState<'all' | string | null>(null);
  const translating = translationScope !== null;
  const [editFeedback, setEditFeedback] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const settingsRef = useRef(settings);
  const renderedSettingsSignature = JSON.stringify(settings);
  const renderedSettingsSignatureRef = useRef(renderedSettingsSignature);
  const editFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRevisionRef = useRef(0);
  const addingLocalePendingRef = useRef(false);
  const settingsContentRef = useRef<HTMLDivElement>(null);
  const addLocaleDetailsRef = useRef<HTMLDivElement>(null);
  if (renderedSettingsSignatureRef.current !== renderedSettingsSignature) {
    renderedSettingsSignatureRef.current = renderedSettingsSignature;
    settingsRef.current = settings;
  }
  const translationAbortRef = useRef<AbortController | null>(null);
  const activeLocale = settings.locales.find((locale) => locale.code === selectedLocale) || targetLocales[0];
  const sourceLocale = settings.locales.find((locale) => locale.code === settings.sourceLocale)
    || createLocale(settings.sourceLocale);
  const pages = useMemo(
    () => Object.values(project.files).filter(
      (file): file is typeof file & { text: string } => isLocalizationPageFile(file),
    ),
    [project.files],
  );
  const allGroups = useMemo(
    () => pages.map((page) => ({
      page,
      entries: extractLocalizableEntries(page.text),
      seo: pageSeoSource(page.text),
    })),
    [pages],
  );
  const progressByLocale = useMemo(
    () => Object.fromEntries(targetLocales.map((locale) => {
      const total = allGroups.reduce((sum, group) => sum + group.entries.length, 0);
      const translated = allGroups.reduce((sum, group) => {
        const values = settings.translations[locale.code]?.pages?.[group.page.path]?.entries || {};
        return sum + group.entries.filter((entry) => (
          translationValueForEntry(values, entry)?.trim()
        )).length;
      }, 0);
      return [locale.code, {
        total,
        translated,
        percent: total ? Math.round((translated / total) * 100) : 100,
      }];
    })),
    [allGroups, settings.translations, targetLocales],
  );
  const progress = activeLocale
    ? progressByLocale[activeLocale.code] || { total: 0, translated: 0, percent: 0 }
    : { total: 0, translated: 0, percent: 0 };
  const metadata = readEditorMetadata(project);
  const aiPendingCount = useMemo(() => {
    if (!activeLocale) return 0;
    const localeTranslation = settings.translations[activeLocale.code];
    let count = 0;
    if ((metadata.siteSettings?.siteTitle || project.name).trim() && !localeTranslation?.siteTitle?.trim()) count += 1;
    if (metadata.siteSettings?.description?.trim() && !localeTranslation?.siteDescription?.trim()) count += 1;
    allGroups.forEach((group) => {
      const translatedPage = localeTranslation?.pages?.[group.page.path];
      count += group.entries.filter((entry) => !translationValueForEntry(
        translatedPage?.entries || {},
        entry,
      )?.trim()).length;
      if (group.seo.title.trim() && !translatedPage?.title?.trim()) count += 1;
      if (group.seo.description.trim() && !translatedPage?.description?.trim()) count += 1;
      if (
        settings.translatePagePaths
        && settings.includePathsInAi
        && !translatedPage?.path?.trim()
      ) count += 1;
    });
    return count;
  }, [
    activeLocale,
    allGroups,
    metadata.siteSettings?.description,
    metadata.siteSettings?.siteTitle,
    project.name,
    settings.includePathsInAi,
    settings.translatePagePaths,
    settings.translations,
  ]);

  const commitSettings = async (nextSettings: LocalizationSettings): Promise<LocalizationCommitResult> => {
    if (readOnly) return false;
    const normalizedSettings = normalizeLocalization(nextSettings);
    try {
      assertLocalizationForPersistence(normalizedSettings);
    } catch (error) {
      setEditFeedback('error');
      toast.error(error instanceof Error ? error.message : 'A configuração de idiomas é inválida.', {
        id: 'kodety-localization-save-error',
      });
      return false;
    }
    // React may batch two input events before the parent project snapshot is
    // rendered back as props. Advance the local mutation base immediately so
    // a second field/keystroke composes with the first instead of replacing it.
    settingsRef.current = normalizedSettings;
    const revision = ++saveRevisionRef.current;
    setEditFeedback('saving');
    if (editFeedbackTimerRef.current) clearTimeout(editFeedbackTimerRef.current);
    try {
      await onChange(normalizedSettings);
    } catch (error) {
      if (
        error
        && typeof error === 'object'
        && 'retryable' in error
        && (error as { retryable?: unknown }).retryable === true
      ) {
        if (revision === saveRevisionRef.current) setEditFeedback('saving');
        return 'queued';
      }
      if (revision === saveRevisionRef.current) {
        setEditFeedback('error');
        toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a localização.', {
          id: 'kodety-localization-save-error',
        });
      }
      return false;
    }
    if (revision === saveRevisionRef.current) {
      toast.dismiss('kodety-localization-save-error');
      setEditFeedback('saved');
      editFeedbackTimerRef.current = setTimeout(() => {
        editFeedbackTimerRef.current = null;
        setEditFeedback('idle');
      }, 1800);
    }
    return 'saved';
  };

  const selectLocale = (code: string) => {
    translationAbortRef.current?.abort();
    setSelectedLocale(code);
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groups = useMemo(
    () => allGroups.map(({ page, entries, seo }) => {
      const translatedPage = activeLocale
        ? settings.translations[activeLocale.code]?.pages?.[page.path]
        : undefined;
      const seoRows: Array<{
        field: 'path' | 'title' | 'description';
        original: string;
        label: string;
      }> = [
        { field: 'title', original: seo.title, label: 'Título SEO' },
        { field: 'description', original: seo.description, label: 'Descrição SEO' },
        ...(settings.translatePagePaths
          ? [{
              field: 'path' as const,
              original: pageLabel(page.path).toLowerCase().replaceAll(' ', '-'),
              label: 'URL localizada',
            }]
          : []),
      ];
      const aiPendingCount = activeLocale
        ? entries.filter((entry) => !translationValueForEntry(
            translatedPage?.entries || {},
            entry,
          )?.trim()).length
          + seoRows.filter((row) => (
            row.original.trim()
            && (row.field !== 'path' || settings.includePathsInAi)
            && !translatedPage?.[row.field]?.trim()
          )).length
        : 0;
      return {
        page,
        aiPendingCount,
        seoRows: seoRows.filter((row) => matchesTranslation(
          query,
          filter,
          row.original,
          translatedPage?.[row.field] || '',
          `${row.label} ${page.path}`,
        )),
        entries: entries.filter((entry) => {
          const translated = activeLocale
            ? translationValueForEntry(
              settings.translations[activeLocale.code]?.pages?.[page.path]?.entries || {},
              entry,
            ) || ''
            : '';
          return matchesTranslation(query, filter, entry.source, translated, `${entry.label} ${page.path}`);
        }),
      };
    }).filter((group) => group.entries.length || group.seoRows.length),
    [activeLocale, allGroups, filter, query, settings.includePathsInAi, settings.translatePagePaths, settings.translations],
  );

  const siteRows = useMemo(() => {
    if (!activeLocale) return [];
    const rows = [
      {
        field: 'siteTitle' as const,
        original: metadata.siteSettings?.siteTitle || project.name,
        label: 'Título do site',
      },
      {
        field: 'siteDescription' as const,
        original: metadata.siteSettings?.description || '',
        label: 'Descrição do site',
      },
    ];
    return rows.filter((row) => matchesTranslation(
      query,
      filter,
      row.original,
      settings.translations[activeLocale.code]?.[row.field] || '',
      row.label,
    ));
  }, [activeLocale, filter, metadata.siteSettings?.description, metadata.siteSettings?.siteTitle, project.name, query, settings.translations]);

  const availableLocales = useMemo(() => {
    const search = localeSearch.trim().toLocaleLowerCase();
    return COMMON_LOCALES
      .filter((locale) => !settings.locales.some((candidate) => candidate.code.toLowerCase() === locale.code.toLowerCase()))
      .filter((locale) => !search || `${locale.name} ${locale.code} ${locale.language} ${locale.region || ''}`.toLocaleLowerCase().includes(search));
  }, [localeSearch, settings.locales]);

  const openAddLocale = () => {
    if (readOnly) return;
    const first = COMMON_LOCALES.find((locale) => (
      !settings.locales.some((candidate) => candidate.code.toLowerCase() === locale.code.toLowerCase())
    ));
    setDraftLocale(first ? localeDraft(createLocale(first.code), settings.sourceLocale) : null);
    setLocaleSearch('');
    setCustomCode('');
    setAddingLocale(true);
  };

  const selectDraftLocale = (locale: LocalizationLocale) => {
    setDraftLocale(locale);
    requestAnimationFrame(() => addLocaleDetailsRef.current?.scrollTo({ top: 0 }));
  };

  useEffect(() => {
    if (!showSettings) return;
    settingsContentRef.current?.scrollTo({ top: 0 });
  }, [settingsPane, showSettings]);

  const addLocale = async (locale: LocalizationLocale) => {
    if (readOnly || addingLocalePendingRef.current) return;
    const currentSettings = settingsRef.current;
    const code = locale.code.trim();
    const canonicalCode = canonicalLocaleCode(code);
    if (!canonicalCode) {
      toast.error('Use um código BCP 47 válido, como en-US ou pt-BR.');
      return;
    }
    if (currentSettings.locales.some((candidate) => candidate.code.toLowerCase() === canonicalCode.toLowerCase())) {
      toast.error('Este idioma já foi adicionado.');
      return;
    }
    const normalized = createLocale(canonicalCode);
    const next = {
      ...normalized,
      ...locale,
      code: normalized.code,
      language: normalized.language,
      region: locale.region?.trim().toUpperCase() || normalized.region,
      name: locale.name.trim() || normalized.name,
      fallback: locale.fallback || currentSettings.sourceLocale,
      slug: localeSlug(locale.slug || normalized.code),
    };
    addingLocalePendingRef.current = true;
    setAddingLocalePending(true);
    try {
      const saved = await commitSettings({
        ...currentSettings,
        locales: [...currentSettings.locales, next],
      });
      if (!saved) return;
      setSelectedLocale(next.code);
      setAddingLocale(false);
      setDraftLocale(null);
      setCustomCode('');
      if (saved === 'queued') {
        toast.info(`${next.name} adicionado`, {
          description: 'A alteração foi preservada e será sincronizada assim que a conexão responder.',
        });
      } else {
        toast.success(`${next.name} adicionado`, {
          description: 'A tradução começa como rascunho e só vai ao ar quando você publicar.',
        });
      }
    } finally {
      addingLocalePendingRef.current = false;
      setAddingLocalePending(false);
    }
  };

  const removeLocale = async (code: string) => {
    const currentSettings = settingsRef.current;
    const locale = currentSettings.locales.find((candidate) => candidate.code === code);
    if (!locale || code === currentSettings.sourceLocale || !window.confirm(`Remover ${locale.name} e suas traduções?`)) return;
    translationAbortRef.current?.abort();
    const translations = { ...currentSettings.translations };
    delete translations[code];
    const locales = currentSettings.locales.filter((candidate) => candidate.code !== code);
    const saved = await commitSettings(normalizeLocalization({
      ...currentSettings,
      locales,
      translations,
      defaultLocale: code === currentSettings.defaultLocale
        ? currentSettings.sourceLocale
        : currentSettings.defaultLocale,
    }));
    if (!saved) return;
    const nextLocale = locales.find((candidate) => candidate.code !== currentSettings.sourceLocale)?.code || '';
    setSelectedLocale(nextLocale);
    setSettingsPane(nextLocale || 'general');
  };

  const updateLocale = (code: string, patch: Partial<LocalizationLocale>) => {
    const currentSettings = settingsRef.current;
    commitSettings({
      ...currentSettings,
      locales: currentSettings.locales.map((locale) => locale.code === code ? { ...locale, ...patch } : locale),
    });
  };

  const changeDefaultLocale = async (code: string) => {
    const currentSettings = settingsRef.current;
    const locale = currentSettings.locales.find((candidate) => candidate.code === code);
    if (!locale) return;
    const saved = await commitSettings(setDefaultLocale(currentSettings, code));
    if (!saved) return;
    if (saved === 'queued') {
      toast.info('Idioma padrão atualizado localmente', {
        description: 'A alteração será sincronizada assim que a conexão responder.',
      });
    } else {
      toast.success('Idioma padrão atualizado', {
        description: `${locale.name} passa a usar as URLs sem prefixo.`,
      });
    }
  };

  const updatePageField = (
    localeCode: string,
    pagePath: string,
    field: 'path' | 'title' | 'description',
    value: string,
  ) => {
    const currentSettings = settingsRef.current;
    const locale = currentSettings.translations[localeCode] || { pages: {} };
    const page = locale.pages[pagePath] || { entries: {} };
    commitSettings({
      ...currentSettings,
      translations: {
        ...currentSettings.translations,
        [localeCode]: {
          ...locale,
          pages: { ...locale.pages, [pagePath]: { ...page, [field]: value } },
        },
      },
    });
  };

  const updateSiteField = (
    localeCode: string,
    field: 'siteTitle' | 'siteDescription',
    value: string,
  ) => {
    const currentSettings = settingsRef.current;
    const locale = currentSettings.translations[localeCode] || { pages: {} };
    commitSettings({
      ...currentSettings,
      translations: {
        ...currentSettings.translations,
        [localeCode]: { ...locale, [field]: value },
      },
    });
  };

  const translateWithAi = async (pagePath?: string) => {
    if (readOnly) return;
    if (!activeLocale) return;
    const showAiConfigurationRequired = (message: string) => {
      const canConfigure = Boolean(aiSettingsPageUrl && onNavigate);
      toast.error(message, {
        id: 'kodety-localization-ai-configuration-required',
        duration: 10_000,
        description: canConfigure
          ? 'Conecte um provedor e salve uma API Key em Settings para gerar traduções.'
          : 'Peça a um administrador para configurar um provedor de IA.',
        action: canConfigure
          ? {
              label: 'Configurar IA',
              onClick: () => onNavigate?.(aiSettingsPageUrl || ''),
            }
          : undefined,
      });
    };
    if (!aiGenerateUrl) {
      showAiConfigurationRequired('Configure a IA em Settings para gerar rascunhos de tradução.');
      return;
    }
    const scopedGroups = pagePath
      ? allGroups.filter((group) => group.page.path === pagePath)
      : allGroups;
    if (pagePath && !scopedGroups.length) return;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    const localeCode = activeLocale.code;
    const localeName = activeLocale.name;
    const scopeLabel = pagePath ? pageLabel(pagePath) : 'o projeto';
    setTranslationScope(pagePath || 'all');
    let applied = 0;
    const generationStatus = { queued: false };
    try {
      const requestBatch = async (items: Array<{ key: string; source: string }>) => {
        const allowedKeys = new Set(items.map((item) => item.key));
        const response = await fetch(aiGenerateUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-WP-Nonce': nonce || '',
          },
          body: JSON.stringify({
            task: 'translation',
            prompt: `Traduza os valores de ${scopeLabel} para ${localeName}. Preserve nomes próprios, placeholders e o sentido. Para chaves de URL, responda apenas com um caminho curto sem barra inicial. Retorne todas as chaves.`,
            context: JSON.stringify(Object.fromEntries(items.map((item) => [item.key, item.source]))),
            language: localeCode,
          }),
          signal: controller.signal,
        });
        const result = await readAiTranslationResponse(response);
        if (!response.ok) {
          const message = aiTranslationErrorMessage(result) || 'A IA não conseguiu traduzir o conteúdo.';
          if (aiTranslationConfigurationRequired(result)) {
            throw new AiTranslationConfigurationError(message);
          }
          throw new Error(message);
        }
        const draft = isJsonObject(result.draft) ? result.draft : null;
        const values = draft?.translations;
        if (!isJsonObject(values)) return [];
        return Object.entries(values).flatMap(([key, value]) => (
          allowedKeys.has(key) && (typeof value === 'string' || typeof value === 'number')
            ? [{ key, value: String(value) }]
            : []
        ));
      };

      const persistGenerated = async (candidate: LocalizationSettings, count: number) => {
        if (!count) return true;
        const commitResult = await commitSettings(candidate);
        if (!commitResult) return false;
        if (commitResult === 'queued') generationStatus.queued = true;
        applied += count;
        return true;
      };

      type MetadataTarget =
        | { kind: 'site'; field: 'siteTitle' | 'siteDescription' }
        | { kind: 'page'; pagePath: string; field: 'path' | 'title' | 'description' };

      const translateMetadata = async (
        items: Array<{ key: string; source: string }>,
        targets: Map<string, MetadataTarget>,
      ) => {
        for (const batch of aiTranslationBatches(items)) {
          const values = await requestBatch(batch);
          let candidate = settingsRef.current;
          let batchApplied = 0;
          values.forEach(({ key, value }) => {
            const target = targets.get(key);
            if (!target) return;
            const cleanValue = target.kind === 'page' && target.field === 'path'
              ? value.trim().replace(/^\/+|\/+$/g, '').replace(/\s+/g, '-')
              : value.trim();
            if (!cleanValue) return;
            const localeTranslation = candidate.translations[localeCode] || { pages: {} };
            let nextCandidate: LocalizationSettings;
            if (target.kind === 'site') {
              if (localeTranslation[target.field]?.trim()) return;
              nextCandidate = {
                ...candidate,
                translations: {
                  ...candidate.translations,
                  [localeCode]: { ...localeTranslation, [target.field]: cleanValue },
                },
              };
            } else {
              const page = localeTranslation.pages[target.pagePath] || { entries: {} };
              if (page[target.field]?.trim()) return;
              nextCandidate = {
                ...candidate,
                translations: {
                  ...candidate.translations,
                  [localeCode]: {
                    ...localeTranslation,
                    pages: {
                      ...localeTranslation.pages,
                      [target.pagePath]: { ...page, [target.field]: cleanValue },
                    },
                  },
                },
              };
            }
            try {
              assertLocalizationForPersistence(nextCandidate);
              candidate = nextCandidate;
              batchApplied += 1;
            } catch {
              // A model may suggest an unsafe or colliding URL. Skip only
              // that suggestion and preserve every valid value in the batch.
            }
          });
          if (!await persistGenerated(candidate, batchApplied)) return false;
        }
        return true;
      };

      if (!pagePath) {
        const siteTargets = new Map<string, MetadataTarget>();
        const siteItems: Array<{ key: string; source: string }> = [];
        const currentLocaleTranslation = settingsRef.current.translations[localeCode];
        const addSiteItem = (
          key: string,
          source: string,
          field: 'siteTitle' | 'siteDescription',
          currentValue: unknown,
        ) => {
          if (!source.trim() || (typeof currentValue === 'string' && currentValue.trim())) return;
          siteTargets.set(key, { kind: 'site', field });
          siteItems.push({ key, source });
        };
        addSiteItem(
          '__kodety_site_title',
          metadata.siteSettings?.siteTitle || project.name,
          'siteTitle',
          currentLocaleTranslation?.siteTitle,
        );
        addSiteItem(
          '__kodety_site_description',
          metadata.siteSettings?.description || '',
          'siteDescription',
          currentLocaleTranslation?.siteDescription,
        );
        if (!await translateMetadata(siteItems, siteTargets)) return;
      }

      for (const [groupIndex, group] of scopedGroups.entries()) {
        const currentSettings = settingsRef.current;
        const missing = group.entries.filter((entry) => (
          !translationValueForEntry(
            currentSettings.translations[localeCode]?.pages?.[group.page.path]?.entries || {},
            entry,
          )
        ));
        for (const batch of aiTranslationBatches(
          missing.map((entry) => ({ key: entry.key, source: entry.source })),
        )) {
          const values = await requestBatch(batch.map((entry) => ({ key: entry.key, source: entry.source })));
          let candidate = settingsRef.current;
          let batchApplied = 0;
          values.forEach(({ key, value }) => {
            const currentValue = candidate.translations[localeCode]
              ?.pages?.[group.page.path]?.entries?.[key] || '';
            // A reviewer may type while generation is in flight. Never
            // overwrite a value that became non-empty after the request.
            if (currentValue) return;
            candidate = updateTranslation(candidate, localeCode, group.page.path, key, value);
            batchApplied += 1;
          });
          if (!await persistGenerated(candidate, batchApplied)) return;
        }
        const latestLocaleTranslation = settingsRef.current.translations[localeCode];
        const translatedPage = latestLocaleTranslation?.pages?.[group.page.path];
        const metadataTargets = new Map<string, MetadataTarget>();
        const metadataItems: Array<{ key: string; source: string }> = [];
        const addPageItem = (
          key: string,
          source: string,
          field: 'path' | 'title' | 'description',
          currentValue: unknown,
        ) => {
          if (!source.trim() || (typeof currentValue === 'string' && currentValue.trim())) return;
          metadataTargets.set(key, { kind: 'page', pagePath: group.page.path, field });
          metadataItems.push({ key, source });
        };
        addPageItem(
          `__kodety_page_${groupIndex}_title`,
          group.seo.title,
          'title',
          translatedPage?.title,
        );
        addPageItem(
          `__kodety_page_${groupIndex}_description`,
          group.seo.description,
          'description',
          translatedPage?.description,
        );
        if (settingsRef.current.translatePagePaths && settingsRef.current.includePathsInAi) {
          addPageItem(
            `__kodety_page_${groupIndex}_path`,
            pageLabel(group.page.path),
            'path',
            translatedPage?.path,
          );
        }
        if (!await translateMetadata(metadataItems, metadataTargets)) return;
      }
      toast.success(pagePath ? `${pageLabel(pagePath)} traduzida com IA` : 'Rascunhos gerados', {
        description: applied
          ? `${applied} ${applied === 1 ? 'tradução aplicada' : 'traduções aplicadas'}. ${
              generationStatus.queued
                ? 'A sincronização continuará em segundo plano.'
                : 'Revise antes de publicar.'
            }`
          : 'Nenhum campo vazio precisou ser alterado.',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (applied) {
          toast.info('Geração interrompida', {
            description: `${applied} ${applied === 1 ? 'tradução foi preservada' : 'traduções foram preservadas'}.`,
          });
        }
      } else if (error instanceof AiTranslationConfigurationError) {
        showAiConfigurationRequired(error.message);
      } else {
        toast.error(error instanceof Error ? error.message : 'Não foi possível traduzir.', {
          id: 'kodety-localization-ai-error',
          description: applied
            ? `${applied} ${applied === 1 ? 'tradução anterior foi preservada' : 'traduções anteriores foram preservadas'}.`
            : undefined,
        });
      }
    } finally {
      if (translationAbortRef.current === controller) {
        translationAbortRef.current = null;
        setTranslationScope(null);
      }
    }
  };

  useEffect(() => {
    if (!readOnly) return;
    saveRevisionRef.current += 1;
    settingsRef.current = settings;
    translationAbortRef.current?.abort();
    addingLocalePendingRef.current = false;
    setAddingLocalePending(false);
    setEditFeedback('idle');
    setAddingLocale(false);
    setShowSettings(false);
  }, [readOnly, settings]);

  useEffect(() => {
    if (!targetLocales.length) {
      if (selectedLocale) setSelectedLocale('');
      return;
    }
    if (!targetLocales.some((locale) => locale.code === selectedLocale)) {
      setSelectedLocale(targetLocales[0].code);
    }
  }, [selectedLocale, targetLocales]);

  useEffect(() => () => {
    translationAbortRef.current?.abort();
    if (editFeedbackTimerRef.current) clearTimeout(editFeedbackTimerRef.current);
  }, []);

  const configuredLocale = settingsPane === 'general'
    ? null
    : settings.locales.find((locale) => locale.code === settingsPane) || null;

  return (
    <main
      data-kodety-localization
      data-kodety-onboarding="localization-workspace"
      data-kodety-read-only={readOnly ? 'true' : undefined}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--kodety-panel)] text-[var(--kodety-text)]"
      style={{ isolation: 'isolate' }}
    >
      <header className="relative flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kodety-divider)] bg-[var(--kodety-chrome)] px-2.5 sm:px-3">
        {logoMenu && <div className="-ml-2.5 shrink-0 sm:-ml-3">{logoMenu}</div>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" asChild className="rounded-[8px]">
              <a
                href={backHref}
                aria-label="Voltar ao Builder"
                onClick={(event) => {
                  if (
                    !onNavigate
                    || event.metaKey
                    || event.ctrlKey
                    || event.shiftKey
                    || event.altKey
                  ) return;
                  event.preventDefault();
                  onNavigate(backHref);
                }}
              >
                <ArrowLeft />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Voltar ao Builder</TooltipContent>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--kodety-divider)]" aria-hidden="true" />
        <Languages className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
        <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--kodety-text)]">Languages</span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {topbarActions}
          {readOnly && (
            <span className="mr-1 rounded-full bg-white/[.055] px-2 py-1 text-[8px] font-medium text-[var(--kodety-text-tertiary)]">
              Somente leitura
            </span>
          )}
          {editFeedback !== 'idle' && <span
            className="mr-1 inline-flex min-h-6 items-center gap-1.5 px-1 text-[8px] text-[var(--kodety-text-tertiary)]"
            aria-live="polite"
          >
            {editFeedback === 'saving'
              ? <LoaderCircle className="size-2.5 animate-spin" />
              : editFeedback === 'saved'
                ? <Check className="size-2.5 text-[var(--kodety-success)]" />
                : editFeedback === 'error'
                  ? <X className="size-2.5 text-[var(--kodety-danger)]" />
                  : null}
            <span className="hidden sm:inline">
              {editFeedback === 'saving'
                ? 'Salvando…'
                : editFeedback === 'saved'
                  ? 'Alterações salvas'
                  : editFeedback === 'error'
                    ? 'Falha ao salvar'
                    : ''}
            </span>
          </span>}
          {!readOnly && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={LOCALIZATION_ICON_BUTTON_CLASS}
                  aria-label="Configurar localização"
                  data-kodety-onboarding="localization-settings"
                  data-kodety-onboarding-reveal
                  data-kodety-onboarding-navigation
                  data-kodety-onboarding-toggle
                  aria-expanded={showSettings}
                  onClick={() => {
                    if (!showSettings) setSettingsPane(activeLocale?.code || 'general');
                    setShowSettings(current => !current);
                  }}
                >
                  <Settings2 className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Configurar localização</TooltipContent>
            </Tooltip>
          )}
          {!readOnly && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button data-kodety-onboarding="localization-add" className="h-8 rounded-[8px] px-2" size="xs" onClick={openAddLocale} aria-label="Adicionar idioma">
                  <Plus />
                  <span className="hidden sm:inline">Idioma</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Adicionar idioma</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="hidden shrink-0 flex-col border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)] md:flex md:w-[180px] xl:w-[188px]">
          <div className="flex h-11 shrink-0 items-center border-b border-[var(--kodety-divider)] px-3">
            <GlobalIcon className="mr-2 size-[15px] shrink-0 text-[var(--kodety-text-tertiary)]" aria-hidden="true" />
            <span className="truncate text-[10px] font-semibold text-[var(--kodety-text)]">Idiomas</span>
            <span className="ml-auto text-[8px] tabular-nums text-[var(--kodety-info-copy)]">{settings.locales.length}</span>
          </div>
          <nav data-kodety-onboarding="localization-languages" className="kodety-compact-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label="Idiomas do projeto">
            {settings.locales.map((locale) => {
              const isSource = locale.code === settings.sourceLocale;
              const isActive = activeLocale?.code === locale.code;
              const localeProgress = isSource ? 100 : progressByLocale[locale.code]?.percent || 0;
              return (
                <button
                  key={locale.code}
                  type="button"
                  disabled={isSource}
                  onClick={() => selectLocale(locale.code)}
                  className={`group relative h-9 w-full min-w-0 overflow-hidden rounded-[8px] border border-transparent px-2 text-left outline-none transition-[background-color,color] focus-visible:border-[var(--kodety-focus)]/70 ${
                    isActive
                      ? 'bg-white/[.085] text-[var(--kodety-text)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-[1px] before:bg-[var(--kodety-accent-hover)]'
                      : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.05] hover:text-[var(--kodety-text)]'
                  } ${isSource ? 'cursor-default opacity-75' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  title={`${locale.name} · ${localeProgress}%`}
                >
                  <span className="flex h-full items-center gap-2">
                    <LocaleFlag locale={locale} />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium" dir="auto">{locale.name}</span>
                    <span className="shrink-0 text-[9px] font-medium tabular-nums text-[var(--kodety-text-tertiary)]">{localeProgress}%</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section data-kodety-onboarding="localization-content" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--kodety-panel)]">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--kodety-divider)] px-2 md:hidden">
            {activeLocale ? (
              <LocaleSelect
                ariaLabel="Idioma em edição"
                value={activeLocale.code}
                locales={targetLocales}
                onValueChange={selectLocale}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--kodety-text-tertiary)]">Nenhum idioma de destino</span>
            )}
          </div>
          {activeLocale ? (
            <>
              <div className="grid min-h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5 border-b border-[var(--kodety-divider)] px-2.5 py-2 sm:grid-cols-[minmax(180px,1fr)_112px_auto] sm:px-3" data-kodety-onboarding="localization-filters">
                <div className="relative col-span-2 min-w-0 sm:col-span-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-white/30" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && query) {
                        event.preventDefault();
                        setQuery('');
                      }
                    }}
                    placeholder="Buscar traduções…"
                    className={cn(LOCALIZATION_CONTROL_CLASS, 'pl-9 pr-9')}
                    disableKeyboardStep
                    aria-label="Buscar traduções"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-[5px] text-white/30 outline-none hover:bg-white/[.06] hover:text-white/70 focus-visible:text-[var(--kodety-accent-hover)]"
                      aria-label="Limpar busca"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                <Select value={filter} onValueChange={(value) => setFilter(value as TranslationFilter)}>
                  <SelectTrigger aria-label="Filtrar traduções" className={cn(LOCALIZATION_CONTROL_CLASS, 'w-full min-w-0')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" className="min-w-36 rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)]">
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="missing">Pendentes</SelectItem>
                    <SelectItem value="translated">Traduzidos</SelectItem>
                  </SelectContent>
                </Select>
                {!readOnly && <button
                  type="button"
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-transparent bg-white/[.055] px-2.5 text-[9px] font-medium text-[var(--kodety-text-secondary)] outline-none transition-colors hover:bg-white/[.07] hover:text-white focus-visible:border-[var(--kodety-focus)]/70 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={translating ? 'Cancelar geração de rascunhos' : `Gerar ${aiPendingCount} rascunhos vazios`}
                  disabled={!activeLocale || (!aiPendingCount && !translating)}
                  onClick={() => {
                    if (translating) translationAbortRef.current?.abort();
                    else void translateWithAi();
                  }}
                  title={translating ? 'Cancelar geração' : 'Gerar traduções para campos vazios'}
                  data-kodety-onboarding="localization-ai"
                >
                  {translating ? <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-3" />}
                  <span className="hidden sm:inline">{translating ? 'Cancelar' : 'Gerar'}</span>
                  {!translating && aiPendingCount > 0 && <span className="tabular-nums text-[var(--kodety-text-tertiary)]">{aiPendingCount}</span>}
                </button>}
              </div>
              <div className="hidden h-10 shrink-0 grid-cols-2 border-b border-[var(--kodety-divider)] text-[10px] font-medium text-[var(--kodety-text-tertiary)] md:grid">
                <div className="flex items-center gap-2 border-r border-[var(--kodety-divider)] px-5">
                  <LocaleFlag locale={sourceLocale} />
                  <span className="text-[var(--kodety-text-secondary)]">Original</span>
                  <span className="font-normal">{settings.sourceLocale}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 px-4">
                  <LocaleFlag locale={activeLocale} />
                  <span className="truncate text-[var(--kodety-text-secondary)]" dir="auto">{activeLocale.name}</span>
                  <span className="shrink-0 font-normal">{activeLocale.code}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-white/[.045] px-2 py-1 text-[8px] font-medium tabular-nums text-[var(--kodety-text-secondary)]">{progress.translated}/{progress.total}</span>
                </div>
              </div>
              <div data-kodety-onboarding="localization-translations" className="kodety-compact-scrollbar min-h-0 flex-1 overflow-auto">
                {siteRows.length > 0 && (
                  <section className="border-b border-[var(--kodety-divider)]">
                    <button
                      type="button"
                      data-kodety-localization-group-header
                      className="sticky top-0 z-[80] flex h-12 w-full items-center justify-between gap-2.5 border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-4 text-left outline-none transition-colors hover:bg-white/[.025] focus-visible:bg-white/[.035] focus-visible:text-[var(--kodety-text)]"
                      onClick={() => toggleGroup('__site__')}
                      aria-expanded={!collapsedGroups.has('__site__')}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-white/[.045]">
                          <Globe2 className="size-3.5 text-white/38" />
                        </span>
                        <span data-kodety-localization-group-title className="relative z-10 min-w-0">
                          <span className="block text-[11px] font-medium text-[var(--kodety-text)]">Site</span>
                          <span className="mt-0.5 block truncate text-[8px] text-[var(--kodety-info-copy)]">Conteúdo global</span>
                        </span>
                        <span className="ml-auto rounded-full bg-white/[.04] px-2 py-1 text-[8px] tabular-nums text-[var(--kodety-text-tertiary)]">{siteRows.length}</span>
                      </span>
                      <DisclosureChevron expanded={!collapsedGroups.has('__site__')} className="size-3 text-[var(--kodety-text-tertiary)]" />
                    </button>
                    {!collapsedGroups.has('__site__') && siteRows.map(({ field, original, label }) => (
                      <TranslationRow
                        key={field}
                        onboardingId="localization-global-translation"
                        disabled={readOnly}
                        direction={activeLocale.direction}
                        fieldLabel={label}
                        multiline={field === 'siteDescription'}
                        onChange={(value) => updateSiteField(activeLocale.code, field, value)}
                        original={original}
                        targetLocale={activeLocale.name}
                        value={settings.translations[activeLocale.code]?.[field] || ''}
                      />
                    ))}
                  </section>
                )}

                {groups.map(({ page, aiPendingCount: pageAiPendingCount, entries, seoRows }) => {
                  const translatedPage = settings.translations[activeLocale.code]?.pages?.[page.path];
                  const collapsed = collapsedGroups.has(page.path);
                  const visibleRows = entries.length + seoRows.length;
                  const pageIsTranslating = translationScope === page.path;
                  return (
                    <section key={page.path} className="border-b border-[var(--kodety-divider)]">
                      <div
                        data-kodety-localization-group-header
                        className="sticky top-0 z-[80] flex h-12 w-full min-w-0 items-center justify-between border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] pl-2 pr-9 transition-colors hover:bg-white/[.025]"
                      >
                        <button
                          type="button"
                          className="absolute inset-0 flex h-full w-full items-center justify-end px-4 text-left outline-none focus-visible:bg-white/[.035]"
                          onClick={() => toggleGroup(page.path)}
                          aria-label={`${pageLabel(page.path)} · ${page.path}`}
                          aria-expanded={!collapsed}
                        >
                          <DisclosureChevron expanded={!collapsed} className="size-3 text-[var(--kodety-text-tertiary)]" />
                        </button>
                        <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5 px-2">
                          <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-white/[.045]">
                            <FileText className="size-3.5 shrink-0 text-white/38" />
                          </span>
                          <span data-kodety-localization-group-title className="relative z-10 min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium capitalize text-[var(--kodety-text)]">{pageLabel(page.path)}</span>
                            <span className="mt-0.5 block truncate text-[8px] text-[var(--kodety-info-copy)]">{page.path}</span>
                          </span>
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            className="relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-transparent bg-white/[.04] px-2 text-[9px] font-medium text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.07] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/70 disabled:cursor-not-allowed disabled:opacity-35"
                            disabled={(!pageAiPendingCount && !pageIsTranslating) || (translating && !pageIsTranslating)}
                            onClick={() => {
                              if (pageIsTranslating) translationAbortRef.current?.abort();
                              else void translateWithAi(page.path);
                            }}
                            aria-label={pageIsTranslating
                              ? `Cancelar tradução de ${pageLabel(page.path)}`
                              : `Traduzir ${pageLabel(page.path)} com IA`}
                            title={pageIsTranslating
                              ? 'Cancelar tradução desta página'
                              : pageAiPendingCount
                                ? `Traduzir ${pageAiPendingCount} campos pendentes desta página`
                                : 'Esta página já está traduzida'}
                          >
                            {pageIsTranslating
                              ? <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
                              : <Sparkles className="size-3" />}
                            <span className="hidden xl:inline">{pageIsTranslating ? 'Cancelar' : 'Traduzir página'}</span>
                            {!pageIsTranslating && pageAiPendingCount > 0 && (
                              <span className="tabular-nums text-[var(--kodety-text-secondary)]">{pageAiPendingCount}</span>
                            )}
                          </button>
                        )}
                        <span className="pointer-events-none relative ml-2 shrink-0 rounded-full bg-white/[.04] px-2 py-1 text-[8px] tabular-nums text-[var(--kodety-text-tertiary)]">{visibleRows}</span>
                      </div>
                      {!collapsed && seoRows.map(({ field, original, label }) => (
                        <TranslationRow
                          key={field}
                          onboardingId={field === 'path' ? 'localization-page-url' : 'localization-page-seo'}
                          disabled={readOnly}
                          direction={activeLocale.direction}
                          fieldLabel={label}
                          multiline={field === 'description'}
                          onChange={(value) => updatePageField(activeLocale.code, page.path, field, value)}
                          original={original}
                          targetLocale={activeLocale.name}
                          value={translatedPage?.[field] || ''}
                        />
                      ))}
                      {!collapsed && entries.map((entry) => (
                        <TranslationRow
                          key={entry.key}
                          onboardingId="localization-page-text"
                          disabled={readOnly}
                          direction={activeLocale.direction}
                          onChange={(value) => commitSettings(updateTranslation(
                            settingsRef.current,
                            activeLocale.code,
                            page.path,
                            entry.key,
                            value,
                          ))}
                          original={entry.source}
                          targetLocale={activeLocale.name}
                          value={translationValueForEntry(
                            settings.translations[activeLocale.code]?.pages?.[page.path]?.entries || {},
                            entry,
                          ) || ''}
                        />
                      ))}
                    </section>
                  );
                })}

                {!groups.length && !siteRows.length && (
                  <div role="status" className="grid h-full min-h-72 place-items-center px-6 text-center">
                    <div className="max-w-xs">
                      <span className="mx-auto grid size-10 place-items-center rounded-[10px] bg-white/[.045] text-white/35">
                        <Search className="size-4" />
                      </span>
                      <p className="mt-3 text-[12px] font-medium text-[var(--kodety-text)]">Nenhum texto neste filtro</p>
                      <p className={cn('mx-auto mt-1 max-w-56', LOCALIZATION_DESCRIPTION_CLASS)}>Ajuste a busca ou escolha outro status.</p>
                      {(query || filter !== 'all') && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuery('');
                            setFilter('all');
                          }}
                          className="mt-3 rounded-[7px] bg-white/[.045] px-2.5 py-1.5 text-[9px] font-medium text-[var(--kodety-text-secondary)] outline-none hover:bg-white/[.07] hover:text-white focus-visible:text-[var(--kodety-accent-hover)]"
                        >
                          Limpar filtros
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center px-6 text-center">
              <div className="max-w-sm">
                <span className="mx-auto grid size-11 place-items-center rounded-[11px] bg-white/[.045] text-white/35">
                  <Languages className="size-5" />
                </span>
                <h2 className="mt-3 text-[12px] font-semibold text-[var(--kodety-text)]">Adicione um idioma</h2>
                <p className={cn('mx-auto mt-1 max-w-64', LOCALIZATION_DESCRIPTION_CLASS)}>Cada idioma ganha uma versão revisável, sempre ligada ao conteúdo original.</p>
                {!readOnly && (
                  <Button className="mt-4 h-8 rounded-[8px]" size="xs" onClick={openAddLocale}>
                    <Plus />
                    Adicionar idioma
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <Dialog open={showSettings} onOpenChange={setShowSettings} modal={!onboardingActive}>
        <DialogContent
          {...builderOnboardingDialogProps(onboardingActive)}
          data-kodety-localization-surface
          data-kodety-localization-dialog="settings"
          data-kodety-onboarding="localization-settings-body"
          data-kodety-onboarding-navigation-draft="localization-settings"
          showCloseButton
          width="min(560px, calc(100vw - 1.5rem))"
          className="max-h-[calc(100dvh-1.5rem)] gap-0 overflow-hidden rounded-[14px] border-white/[.08] bg-[var(--kodety-panel)] p-0 shadow-[var(--kodety-shadow-popover)]"
          aria-describedby="localization-settings-description"
        >
          <header
            data-kodety-localization-dialog-region="header"
            className="min-h-14 shrink-0 border-b border-[var(--kodety-divider)] py-2.5"
          >
            <div className="mx-auto flex w-full max-w-[560px] items-center gap-3 px-4 pr-12 sm:px-5 sm:pr-12">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/38">
                <Languages className="size-4" />
              </span>
              <span className="min-w-0">
                <DialogTitle className="text-[13px] font-semibold text-[var(--kodety-text)]">Configurações de localização</DialogTitle>
                <DialogDescription id="localization-settings-description" className="mt-0.5 text-balance text-[9px] text-[var(--kodety-info-copy)]">
                  Idiomas, rotas e publicação.
                </DialogDescription>
              </span>
            </div>
          </header>
          <div
            data-kodety-localization-dialog-region="navigation"
            className="min-h-11 shrink-0 border-b border-[var(--kodety-divider)] py-1.5"
          >
            <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 sm:px-5">
              <div className="min-w-0 max-w-60 flex-1">
                <HtmlSettingsSelectControl
                  label="Seção de localização"
                  kind="option"
                  value={settingsPane}
                  onChange={setSettingsPane}
                  allowUnset={false}
                  options={[
                    { value: 'general', label: 'Geral' },
                    ...settings.locales.map((locale) => ({
                      value: locale.code,
                      label: `${locale.name}${locale.code === settings.sourceLocale ? ' · Fonte' : ''}`,
                    })),
                  ]}
                />
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto h-8 shrink-0 rounded-[8px]"
                  onClick={() => {
                    setShowSettings(false);
                    openAddLocale();
                  }}
                >
                  <Plus />
                  <span className="hidden sm:inline">Adicionar idioma</span>
                </Button>
              )}
            </div>
          </div>

          <div
            ref={settingsContentRef}
            data-kodety-localization-dialog-region="body"
            data-kodety-onboarding-draft={editFeedback === 'saving' || editFeedback === 'error' ? 'localization-settings' : undefined}
            className="kodety-compact-scrollbar min-h-0 overflow-y-auto overscroll-contain"
          >
              {settingsPane === 'general' ? (
                <section className="mx-auto max-w-[560px] px-4 py-3 sm:px-5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/38">
                      <Globe2 className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <h3 className="text-[13px] font-semibold text-[var(--kodety-text)]">Geral</h3>
                      <p className={cn('mt-1 max-w-md', LOCALIZATION_DESCRIPTION_CLASS)}>O idioma padrão usa a URL sem prefixo.</p>
                    </span>
                  </div>
                  <div data-kodety-onboarding="localization-source-default" className="mt-3 border-y border-[var(--kodety-divider)]">
                    <SettingsField label="Idioma fonte" hint="Conteúdo original">
                      <HtmlSettingsTextControl
                        label="Idioma fonte"
                        kind="option"
                        value={`${sourceLocale.name || settings.sourceLocale} · ${settings.sourceLocale}`}
                        onChange={() => {}}
                        disabled
                      />
                    </SettingsField>
                    <SettingsField label="Idioma padrão" hint="URL sem prefixo">
                      <LocaleSelect
                        ariaLabel="Idioma padrão"
                        value={settings.defaultLocale}
                        locales={settings.locales.filter((locale) => locale.enabled)}
                        disabled={readOnly}
                        onValueChange={changeDefaultLocale}
                      />
                    </SettingsField>
                  </div>
                  <div data-kodety-onboarding="localization-routing-behavior" className="mt-2 grid gap-2 sm:grid-cols-2">
                    <HtmlSettingsToggleControl
                      checked={settings.automaticLocale}
                      disabled={readOnly}
                      label="Idioma automático"
                      description="Usa o país; sem versão local, abre em inglês ou no idioma padrão."
                      onChange={(checked) => commitSettings({ ...settingsRef.current, automaticLocale: checked })}
                    />
                    <HtmlSettingsToggleControl
                      checked={settings.rememberLocale}
                      disabled={readOnly}
                      label="Lembrar escolha"
                      description="Mantém a escolha nas próximas visitas."
                      onChange={(checked) => commitSettings({ ...settingsRef.current, rememberLocale: checked })}
                    />
                    <HtmlSettingsToggleControl
                      checked={settings.translatePagePaths}
                      disabled={readOnly}
                      label="URLs localizadas"
                      description="Traduz caminhos e preserva canonical e hreflang."
                      onChange={(checked) => commitSettings({ ...settingsRef.current, translatePagePaths: checked })}
                    />
                    <HtmlSettingsToggleControl
                      checked={settings.includePathsInAi}
                      disabled={readOnly}
                      label="Incluir URLs nos rascunhos"
                      description="A IA também sugere caminhos de página."
                      onChange={(checked) => commitSettings({ ...settingsRef.current, includePathsInAi: checked })}
                    />
                  </div>
                </section>
              ) : configuredLocale ? (
                <section className="mx-auto max-w-[560px] px-4 py-3 sm:px-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-10 shrink-0 place-items-center">
                      <LocaleFlag locale={configuredLocale} size="md" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[13px] font-semibold text-[var(--kodety-text)]" dir="auto">{configuredLocale.name}</h3>
                      <p className={cn('mt-1', LOCALIZATION_DESCRIPTION_CLASS)}>
                        {configuredLocale.code === settings.sourceLocale
                          ? 'Idioma fonte do conteúdo original.'
                          : 'Identidade, URL, direção e fallback.'}
                      </p>
                    </div>
                    {!readOnly && configuredLocale.code !== settings.sourceLocale && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeLocale(configuredLocale.code)}
                      >
                        <Trash2 />
                        Remover
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 border-y border-[var(--kodety-divider)]">
                    <SettingsField label="Nome">
                      <HtmlSettingsTextControl
                        label="Nome"
                        kind="text"
                        value={configuredLocale.name}
                        disabled={readOnly || configuredLocale.code === settings.sourceLocale}
                        onChange={(name) => updateLocale(configuredLocale.code, { name })}
                      />
                    </SettingsField>
                    <SettingsField onboardingId="localization-locale-code" label="Código" hint="BCP 47">
                      <HtmlSettingsTextControl label="Código" kind="code" value={configuredLocale.code} onChange={() => {}} disabled />
                    </SettingsField>
                    <SettingsField label="Região">
                      <HtmlSettingsTextControl
                        label="Região"
                        kind="option"
                        value={configuredLocale.region || ''}
                        disabled={readOnly || configuredLocale.code === settings.sourceLocale}
                        onChange={(region) => updateLocale(configuredLocale.code, { region: region.toUpperCase() })}
                      />
                    </SettingsField>
                    <SettingsField
                      onboardingId="localization-locale-prefix"
                      label="Prefixo da URL"
                      hint={configuredLocale.code === settings.defaultLocale ? 'Vazio no idioma padrão' : 'Prefixo publicado'}
                    >
                      <HtmlSettingsTextControl
                        label="Prefixo da URL"
                        kind="link"
                        value={configuredLocale.slug}
                        disabled={readOnly || configuredLocale.code === settings.defaultLocale || configuredLocale.code === settings.sourceLocale}
                        onChange={(slug) => updateLocale(configuredLocale.code, { slug: localeSlug(slug) })}
                      />
                    </SettingsField>
                    <SettingsField onboardingId="localization-locale-fallback" label="Fallback">
                      <LocaleSelect
                        ariaLabel="Idioma de fallback"
                        value={configuredLocale.fallback || settings.sourceLocale}
                        locales={settings.locales.filter((locale) => locale.code !== configuredLocale.code)}
                        disabled={readOnly || configuredLocale.code === settings.sourceLocale}
                        onValueChange={(fallback) => updateLocale(configuredLocale.code, { fallback })}
                      />
                    </SettingsField>
                    <SettingsField onboardingId="localization-locale-direction" label="Direção">
                      <HtmlSettingsSelectControl
                        label="Direção"
                        kind="option"
                        value={configuredLocale.direction}
                        disabled={readOnly || configuredLocale.code === settings.sourceLocale}
                        onChange={(direction) => updateLocale(configuredLocale.code, { direction: direction as 'ltr' | 'rtl' })}
                        allowUnset={false}
                        options={[
                          { value: 'ltr', label: 'Esquerda para direita' },
                          { value: 'rtl', label: 'Direita para esquerda' },
                        ]}
                      />
                    </SettingsField>
                  </div>
                  {configuredLocale.code !== settings.sourceLocale && (
                    <div data-kodety-onboarding="localization-locale-publication" className="mt-2">
                      <HtmlSettingsToggleControl
                        checked={configuredLocale.enabled}
                        disabled={readOnly}
                        label="Publicar idioma"
                        description="Inclui esta versão na próxima publicação."
                        onChange={(checked) => updateLocale(configuredLocale.code, { enabled: checked })}
                      />
                    </div>
                  )}
                </section>
              ) : null}
          </div>
          <footer
            data-kodety-localization-dialog-region="footer"
            className="min-h-12 shrink-0 border-t border-[var(--kodety-divider)] py-2"
          >
            <div className="mx-auto flex w-full max-w-[560px] items-center justify-end px-4 sm:px-5">
              <Button className="h-8 rounded-[8px]" size="xs" onClick={() => setShowSettings(false)}>Concluir</Button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addingLocale}
        modal={!onboardingActive}
        onOpenChange={(open) => {
          if (!open && addingLocalePendingRef.current) return;
          setAddingLocale(open);
          if (!open) {
            setDraftLocale(null);
            setLocaleSearch('');
            setCustomCode('');
          }
        }}
      >
        <DialogContent
          data-kodety-localization-surface
          data-kodety-localization-dialog="add"
          {...builderOnboardingDialogProps(onboardingActive)}
          data-kodety-onboarding-navigation-draft="localization-new-locale"
          showCloseButton={!addingLocalePending}
          width="min(780px, calc(100vw - 1.5rem))"
          className="h-[min(540px,calc(100dvh-1.5rem))] gap-0 overflow-hidden rounded-[14px] border-white/[.08] bg-[var(--kodety-panel)] p-0 shadow-[var(--kodety-shadow-popover)]"
          aria-describedby="add-locale-description"
          aria-busy={addingLocalePending}
        >
          <header
            data-kodety-localization-dialog-region="header"
            className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--kodety-divider)] py-2.5 pl-4 pr-12"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/38">
              <Languages className="size-4" />
            </span>
            <span className="min-w-0">
              <DialogTitle className="text-[13px] font-semibold text-[var(--kodety-text)]">Adicionar idioma</DialogTitle>
              <DialogDescription id="add-locale-description" className="mt-0.5 text-balance text-[9px] text-[var(--kodety-info-copy)]">
                Escolha um idioma ou use um código BCP 47.
              </DialogDescription>
            </span>
          </header>
          <div
            data-kodety-localization-dialog-region="body"
            data-kodety-localization-add-layout
            className={`grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,clamp(120px,32dvh,190px))_minmax(0,1fr)] md:grid-cols-[208px_minmax(0,1fr)] md:grid-rows-1 ${
            addingLocalePending ? 'pointer-events-none opacity-70' : ''
            }`}
          >
            <div
              data-kodety-localization-locale-rail
              className="flex min-h-0 flex-col border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] md:border-b-0 md:border-r"
            >
              <div className="relative m-2.5 mb-1.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-white/30" />
                <Input
                  value={localeSearch}
                  onChange={(event) => setLocaleSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && localeSearch) {
                      event.preventDefault();
                      setLocaleSearch('');
                    }
                  }}
                  placeholder="Buscar idioma ou código…"
                  className={cn(LOCALIZATION_CONTROL_CLASS, 'pl-9 pr-3')}
                  disableKeyboardStep
                  aria-label="Buscar idioma ou código"
                />
              </div>
              <div className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 pt-1.5" role="group" aria-label="Idiomas disponíveis">
                {availableLocales.map((locale) => {
                  const selected = draftLocale?.code.toLowerCase() === locale.code.toLowerCase();
                  return (
                    <button
                      key={locale.code}
                      type="button"
                      onClick={() => selectDraftLocale(localeDraft(createLocale(locale.code), settings.sourceLocale))}
                      className={`relative flex h-10 w-full items-center gap-2 rounded-[8px] border border-transparent px-2 text-left text-[10px] outline-none transition-colors focus-visible:border-[var(--kodety-focus)]/70 ${
                        selected
                          ? 'bg-white/[.085] text-[var(--kodety-text)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-[var(--kodety-accent-hover)]'
                          : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.045] hover:text-[var(--kodety-text)]'
                      }`}
                      aria-pressed={selected}
                    >
                      <LocaleFlag locale={locale} />
                      <span className="min-w-0 flex-1 truncate font-medium" dir="auto">{locale.name}</span>
                      <span className="shrink-0 text-[8px] font-normal text-[var(--kodety-info-copy)]">{locale.code}</span>
                      {selected && <Check className="size-3 shrink-0 text-[var(--kodety-text-secondary)]" />}
                    </button>
                  );
                })}
                {!availableLocales.length && (
                  <p className="px-2 py-5 text-balance text-center text-[10px] text-[var(--kodety-info-copy)]">Nenhum idioma encontrado.</p>
                )}
              </div>
              <div className="hidden border-t border-[var(--kodety-divider)] p-2.5 md:block">
                <CustomLocaleCodeControl
                  value={customCode}
                  onChange={setCustomCode}
                  onUse={() => selectDraftLocale(localeDraft(createLocale(customCode.trim()), settings.sourceLocale))}
                />
              </div>
            </div>

            <div
              ref={addLocaleDetailsRef}
              data-kodety-localization-locale-details
              className="kodety-compact-scrollbar min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain"
            >
              <div className="shrink-0 border-b border-[var(--kodety-divider)] p-2.5 md:hidden">
                <CustomLocaleCodeControl
                  value={customCode}
                  onChange={setCustomCode}
                  onUse={() => selectDraftLocale(localeDraft(createLocale(customCode.trim()), settings.sourceLocale))}
                />
              </div>
              {draftLocale ? (
                <section className="mx-auto w-full max-w-[540px] min-w-0 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-8 w-10 shrink-0 place-items-center">
                      <LocaleFlag locale={draftLocale} size="md" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <h3 className="min-w-0 break-words text-[13px] font-semibold text-[var(--kodety-text)]" dir="auto">{draftLocale.name}</h3>
                    </span>
                  </div>
                  <div className="mt-3 border-y border-[var(--kodety-divider)]">
                    <SettingsField label="Nome">
                      <HtmlSettingsTextControl
                        label="Nome"
                        kind="text"
                        value={draftLocale.name}
                        onChange={(name) => setDraftLocale({ ...draftLocale, name })}
                      />
                    </SettingsField>
                    <SettingsField onboardingId="localization-locale-code" label="Código" hint="BCP 47 · ex.: en-US">
                      <div>
                        <HtmlSettingsFieldControl label="Código" kind="code">
                          <Input
                            value={draftLocale.code}
                            onChange={(event) => {
                              const code = event.target.value;
                              const canonicalCode = canonicalLocaleCode(code);
                              const inferred = canonicalCode ? createLocale(canonicalCode) : null;
                              const language = inferred?.language || code.split('-')[0]?.toLowerCase() || '';
                              setDraftLocale({
                                ...draftLocale,
                                code,
                                language,
                                region: inferred?.region || '',
                                slug: localeSlug(code),
                                direction: inferred?.direction
                                  || (['ar', 'fa', 'he', 'ur'].includes(language) ? 'rtl' : 'ltr'),
                              });
                            }}
                            aria-invalid={!isValidLocaleCode(draftLocale.code)}
                            aria-describedby={!isValidLocaleCode(draftLocale.code) ? 'draft-locale-code-hint' : undefined}
                            disableKeyboardStep
                          />
                        </HtmlSettingsFieldControl>
                        {!isValidLocaleCode(draftLocale.code) && (
                          <span id="draft-locale-code-hint" className="mt-1 block text-balance text-[9px] text-destructive">
                            Use um código como en-US ou pt-BR.
                          </span>
                        )}
                      </div>
                    </SettingsField>
                    <SettingsField label="Região">
                      <HtmlSettingsTextControl
                        label="Região"
                        kind="option"
                        value={draftLocale.region || ''}
                        onChange={(region) => setDraftLocale({ ...draftLocale, region: region.toUpperCase() })}
                      />
                    </SettingsField>
                    <SettingsField onboardingId="localization-locale-prefix" label="Prefixo da URL">
                      <HtmlSettingsTextControl
                        label="Prefixo da URL"
                        kind="link"
                        value={draftLocale.slug}
                        onChange={(slug) => setDraftLocale({ ...draftLocale, slug: localeSlug(slug) })}
                      />
                    </SettingsField>
                    <SettingsField onboardingId="localization-locale-fallback" label="Fallback">
                      <LocaleSelect
                        ariaLabel="Idioma de fallback"
                        value={draftLocale.fallback || settings.sourceLocale}
                        locales={settings.locales}
                        onValueChange={(fallback) => setDraftLocale({ ...draftLocale, fallback })}
                      />
                    </SettingsField>
                    <SettingsField onboardingId="localization-locale-direction" label="Direção">
                      <HtmlSettingsSelectControl
                        label="Direção"
                        kind="option"
                        value={draftLocale.direction}
                        onChange={(direction) => setDraftLocale({ ...draftLocale, direction: direction as 'ltr' | 'rtl' })}
                        allowUnset={false}
                        options={[
                          { value: 'ltr', label: 'Esquerda para direita' },
                          { value: 'rtl', label: 'Direita para esquerda' },
                        ]}
                      />
                    </SettingsField>
                  </div>
                  <div data-kodety-onboarding="localization-locale-publication" className="mt-2">
                    <HtmlSettingsToggleControl
                      checked={draftLocale.enabled}
                      label="Disponibilizar ao publicar"
                      description="Inclui o idioma na próxima publicação."
                      onChange={(checked) => setDraftLocale({ ...draftLocale, enabled: checked })}
                    />
                  </div>
                </section>
              ) : (
                <div className="grid min-h-44 place-items-center px-6 py-5 text-center md:h-full">
                  <div className="max-w-xs">
                    <span className="mx-auto grid size-11 place-items-center rounded-[11px] bg-white/[.045] text-white/35">
                      <Globe2 className="size-5" />
                    </span>
                    <p className="mt-3 text-[12px] font-medium text-[var(--kodety-text)]">Selecione um idioma</p>
                    <p className={cn('mx-auto mt-1 max-w-56', LOCALIZATION_DESCRIPTION_CLASS)}>Revise os detalhes antes de adicionar.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <footer
            data-kodety-localization-dialog-region="footer"
            className="flex min-h-12 shrink-0 items-center justify-end gap-2 border-t border-[var(--kodety-divider)] px-3 py-2"
          >
            <Button
              variant="ghost"
              size="xs"
              className="h-8 rounded-[8px]"
              disabled={addingLocalePending}
              onClick={() => setAddingLocale(false)}
            >
              Cancelar
            </Button>
            <Button
              size="xs"
              className="h-8 rounded-[8px]"
              disabled={addingLocalePending || !draftLocale || !isValidLocaleCode(draftLocale.code)}
              onClick={() => { if (draftLocale) void addLocale(draftLocale); }}
            >
              {addingLocalePending && <LoaderCircle className="animate-spin" />}
              {addingLocalePending ? 'Salvando idioma…' : 'Adicionar idioma'}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </main>
  );
}
