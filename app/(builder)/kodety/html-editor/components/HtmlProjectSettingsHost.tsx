'use client';

import { cmsHostConfig } from '@/lib/html-editor/cms-host';

import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useMemo,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { SettingsMinimalisticIcon } from '@solar-icons/react/bold-duotone/settings-minimalistic';
import { KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  readEditorMetadata,
  updateEditorMetadata,
  updateTextFile,
} from '@/lib/html-editor/project-metadata';
import { isHydratedFramerProject } from '@/lib/html-editor/framer-project-detection';
import { addSettingsImageFile, readSettingsImageUpload } from '@/lib/html-editor/settings-media';
import {
  applySeoToHtml,
  readPageSeoFromHtml,
  readSiteSeoFromHtml,
  type PageSeoSettings,
  type SiteSeoSettings,
} from '@/lib/html-editor/seo-settings';
import {
  normalizeCustomCodeSettings,
  type CustomCodeSettings,
} from '@/lib/html-editor/custom-code';
import {
  DEFAULT_COOKIE_CONSENT_SETTINGS,
  cookieConsentRelevantSignature,
  cookieConsentSettingsError,
  normalizeCookieConsentSettings,
  type CookieConsentSettings,
} from '@/lib/html-editor/cookie-consent';
import {
  normalizeRedirectSettings,
  validateRedirectSettings,
  type RedirectSettings,
} from '@/lib/html-editor/redirects';
import {
  defaultLocalization,
  normalizeLocalization,
  setLocalizationSiteLanguage,
  siteLanguageLocaleCode,
} from '@/lib/html-editor/localization';
import type { HtmlProject } from '@/lib/html-editor/types';
import type { HtmlProjectFile } from '@/lib/html-editor/types';
import type { HtmlLicenseSettings } from '@/lib/html-editor/license-settings';
import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import type { ReactNode } from 'react';
import { useHtmlProjectSettingsStore } from '@/stores/useHtmlProjectSettingsStore';
import type {
  HtmlProjectSettingsProps,
  SettingsCmsCollection,
  SettingsWordPressConnection,
} from './HtmlProjectSettings';

const HtmlProjectSettings = lazy(() =>
  import('./HtmlProjectSettings').then(module => ({ default: module.HtmlProjectSettingsBridge })),
);

type AppView = 'editor' | 'cms' | 'settings' | 'localization' | 'templates' | 'analytics' | 'members' | 'kodefy';

export interface HtmlProjectSettingsWordPressSource {
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
  appView?: AppView;
  editorUrl?: string;
  siteUrl: string;
  nonce: string;
  mcpStatusUrl: string;
  mcpSettingsUrl: string;
  mcpProjectConnectionUrl?: string;
  mcpEnabled: boolean;
  studio?: {
    enabled?: boolean;
    studioOrigin?: string;
  } | null;
  storageUrl?: string;
  dashboardUrl?: string;
  canManageIntegrations?: boolean;
  mediaUploadUrl?: string;
  aiSettingsUrl?: string;
  aiGenerateUrl?: string;
  aiTestUrl?: string;
  adobeFontsLicensed?: boolean;
  adobeFontsUrl?: string;
  adobeFontsSettingsUrl?: string;
  adobeFontsSyncUrl?: string;
  searchConsoleUrl?: string;
  sitemapUrl?: string;
  canPublish?: boolean;
  metaCapiSettingsUrl?: string;
  metaCapiTestUrl?: string;
  kodefySettingsUrl?: string;
  kodefyConnectionTestUrl?: string;
  kodefyBuilderDataUrl?: string;
  kodefyDownloadKitUrl?: string;
  templatesUrl?: string;
  cmsItemsUrl?: string;
  agentUrl?: string;
  agentNonce?: string;
}

export interface HtmlProjectSettingsHostProps {
  project: HtmlProject;
  projectRef: RefObject<HtmlProject | null>;
  pages: string[];
  homePage: string;
  redirects: RedirectSettings;
  cmsCollections: SettingsCmsCollection[];
  pageTemplateCollections: Array<{ slug: string; name: string }>;
  pageTemplates: Record<string, string>;
  wordpress?: HtmlProjectSettingsWordPressSource;
  product?: KodetyWordPressConfig['product'];
  license?: HtmlLicenseSettings;
  settingsContent?: { mcp?: ReactNode; agents?: ReactNode };
  readOnly: boolean;
  commitProject: (
    next: HtmlProject,
    record?: boolean,
    refreshCanvas?: boolean,
    canvasAlreadySynchronized?: boolean,
    persist?: boolean,
  ) => void;
  persistExactDraft: (next: HtmlProject, replacePending?: boolean) => Promise<void>;
  clearCanvasSelection: () => void;
  setActiveLocale: Dispatch<SetStateAction<string>>;
  setCodeFilePath: Dispatch<SetStateAction<string>>;
  setPageTemplate: (path: string, postType: string, removing?: boolean) => Promise<boolean>;
  navigateAfterSave: (href: string) => Promise<boolean | void>;
  blockGlobalPageMutation: (project: HtmlProject, action: string) => boolean;
  /** Lightweight hosts can hydrate a referenced binary only when a feature
   * (currently social-font conversion) actually needs its bytes. */
  loadProjectFile?: (path: string) => Promise<HtmlProjectFile | null>;
}

function SettingsLoadingFallback({ overlay = false }: { overlay?: boolean }) {
  return (
    <KodetyLoadingScreen
      label="Carregando configurações"
      className={overlay ? 'fixed inset-0 z-[590] min-h-0' : 'h-full min-h-0'}
    />
  );
}

function settingsWordPressConnection(
  wordpress: HtmlProjectSettingsWordPressSource | undefined,
): SettingsWordPressConnection | undefined {
  if (!wordpress) return undefined;
  return {
    product: wordpress.product,
    statusUrl: wordpress.mcpStatusUrl,
    settingsUrl: wordpress.mcpSettingsUrl,
    projectConnectionUrl: wordpress.mcpProjectConnectionUrl,
    storageUrl: wordpress.storageUrl,
    editorUrl: wordpress.editorUrl,
    dashboardUrl: wordpress.dashboardUrl,
    nonce: wordpress.nonce,
    enabled: wordpress.mcpEnabled,
    studio: wordpress.studio,
    canManageIntegrations: wordpress.canManageIntegrations,
    mediaUrl: wordpress.mediaUploadUrl,
    aiSettingsUrl: wordpress.aiSettingsUrl,
    aiGenerateUrl: wordpress.aiGenerateUrl,
    aiTestUrl: wordpress.aiTestUrl,
    adobeFontsLicensed: wordpress.adobeFontsLicensed,
    adobeFontsUrl: wordpress.adobeFontsUrl,
    adobeFontsSettingsUrl: wordpress.adobeFontsSettingsUrl,
    adobeFontsSyncUrl: wordpress.adobeFontsSyncUrl,
    searchConsoleUrl: wordpress.searchConsoleUrl,
    sitemapUrl: wordpress.canPublish ? wordpress.sitemapUrl : undefined,
    metaCapiSettingsUrl: wordpress.metaCapiSettingsUrl,
    metaCapiTestUrl: wordpress.metaCapiTestUrl,
    shopifySettingsUrl: wordpress.kodefySettingsUrl,
    shopifyConnectionTestUrl: wordpress.kodefyConnectionTestUrl,
    shopifyBuilderDataUrl: wordpress.kodefyBuilderDataUrl,
    shopifyDownloadKitUrl: wordpress.kodefyDownloadKitUrl,
    templatesUrl: wordpress.templatesUrl,
    agentUrl: wordpress.agentUrl,
    agentNonce: wordpress.agentNonce,
  };
}

function HtmlProjectSettingsController({
  initialSection,
  standalone,
  project,
  projectRef,
  pages,
  homePage,
  redirects,
  cmsCollections,
  pageTemplateCollections,
  pageTemplates,
  wordpress,
  product,
  license,
  settingsContent,
  readOnly,
  commitProject,
  persistExactDraft,
  clearCanvasSelection,
  setActiveLocale,
  setCodeFilePath,
  setPageTemplate,
  navigateAfterSave,
  blockGlobalPageMutation,
  loadProjectFile,
}: HtmlProjectSettingsHostProps & { initialSection: string; standalone: boolean }) {
  const siteSettings = useMemo<SiteSeoSettings>(() => {
    const stored = readEditorMetadata(project).siteSettings || {};
    const imported = readSiteSeoFromHtml(project.files[homePage]?.text || '');
    const resolved = {
      siteTitle: imported.siteTitle || project.name,
      language: 'pt-BR',
      baseUrl: wordpress?.siteUrl || '',
      titleTemplate: '%page% · %site%',
      reducedMotion: true,
      defaultIndex: true,
      defaultFollow: true,
      ...imported,
      ...stored,
    };
    return {
      ...resolved,
      language: siteLanguageLocaleCode(resolved.language || 'pt-BR'),
    };
  }, [homePage, project, wordpress?.siteUrl]);

  const customCode = useMemo<CustomCodeSettings>(
    () => normalizeCustomCodeSettings(readEditorMetadata(project).customCode),
    [project],
  );

  const cookieConsent = useMemo<CookieConsentSettings>(
    () => normalizeCookieConsentSettings(
      readEditorMetadata(project).cookieConsent || DEFAULT_COOKIE_CONSENT_SETTINGS,
    ),
    [project],
  );

  const pageSettings = useMemo<Record<string, PageSeoSettings>>(() => {
    const stored = readEditorMetadata(project).pageSettings || {};
    return Object.fromEntries(
      pages.map(path => [
        path,
        {
          ...readPageSeoFromHtml(project.files[path]?.text || ''),
          ...(stored[path] || {}),
        },
      ]),
    );
  }, [pages, project]);

  const pageHtmlSources = useMemo(
    () => Object.fromEntries(pages.map(path => [path, project.files[path]?.text || ''])),
    [pages, project],
  );

  const wordpressConnection = useMemo(() => settingsWordPressConnection(wordpress), [wordpress]);
  const hydratedFramerProject = useMemo(() => isHydratedFramerProject(project), [project]);

  const saveCustomCode = useCallback(
    async (settings: CustomCodeSettings) => {
      const current = projectRef.current;
      if (!current) throw new Error('O projeto não está disponível.');
      const next = updateEditorMetadata(current, metadata => ({
        ...metadata,
        customCode: normalizeCustomCodeSettings(settings),
      }));
      await persistExactDraft(next, true);
      commitProject(next);
    },
    [commitProject, persistExactDraft, projectRef],
  );

  const saveCookieConsent = useCallback(
    async (settings: CookieConsentSettings) => {
      const current = projectRef.current;
      if (!current) throw new Error('O projeto não está disponível.');
      const metadata = readEditorMetadata(current);
      const previousStored = metadata.cookieConsent;
      const previous = normalizeCookieConsentSettings(
        previousStored || DEFAULT_COOKIE_CONSENT_SETTINGS,
      );
      const normalized = normalizeCookieConsentSettings(settings);
      const validationError = cookieConsentSettingsError(normalized);
      if (validationError) throw new Error(validationError);
      const relevantChanged = cookieConsentRelevantSignature(previous)
        !== cookieConsentRelevantSignature(normalized);
      const configurationVersion = relevantChanged
        ? previous.configurationVersion + 1
        : previous.configurationVersion;
      const nextSettings = normalizeCookieConsentSettings({
        ...normalized,
        configurationVersion,
      });
      const next = updateEditorMetadata(current, value => ({
        ...value,
        cookieConsent: nextSettings,
      }));
      await persistExactDraft(next, true);
      commitProject(next);
    },
    [commitProject, persistExactDraft, projectRef],
  );

  const saveRedirects = useCallback(
    async (settings: RedirectSettings) => {
      const current = projectRef.current;
      if (!current) throw new Error('O projeto não está disponível.');
      const normalized = normalizeRedirectSettings(settings);
      const issue = validateRedirectSettings(normalized)[0];
      if (issue) throw new Error(issue.message);
      const next = updateEditorMetadata(current, metadata => ({
        ...metadata,
        redirects: normalized,
      }));
      await persistExactDraft(next, true);
      commitProject(next);
    },
    [commitProject, persistExactDraft, projectRef],
  );

  const saveSiteSettings = useCallback(
    async (settings: SiteSeoSettings) => {
      const current = projectRef.current;
      if (!current) throw new Error('O projeto não está disponível.');
      const metadata = readEditorMetadata(current);
      const previousLocalization = normalizeLocalization(
        metadata.localization || defaultLocalization(metadata.siteSettings?.language || 'pt-BR'),
      );
      const synchronizedLocalization = setLocalizationSiteLanguage(
        previousLocalization,
        settings.language || previousLocalization.sourceLocale,
      );
      const normalizedSettings = {
        ...settings,
        language: synchronizedLocalization.sourceLocale,
      };
      const languageChanged = previousLocalization.sourceLocale !== synchronizedLocalization.sourceLocale;
      const storedPages = metadata.pageSettings || {};
      const resolvedPages: Record<string, PageSeoSettings> = {};
      let next = current;
      pages.forEach(path => {
        const currentPageSettings = {
          ...readPageSeoFromHtml(next.files[path]?.text || ''),
          ...(storedPages[path] || {}),
        };
        resolvedPages[path] = currentPageSettings;
        next = updateTextFile(
          next,
          path,
          applySeoToHtml(next.files[path]?.text || '', path, normalizedSettings, currentPageSettings),
        );
      });
      next = updateEditorMetadata(next, value => ({
        ...value,
        siteSettings: normalizedSettings,
        pageSettings: resolvedPages,
        localization: synchronizedLocalization,
      }));
      await persistExactDraft(next, true);
      commitProject(next);
      if (languageChanged) {
        clearCanvasSelection();
        setActiveLocale(synchronizedLocalization.sourceLocale);
      }
    },
    [clearCanvasSelection, commitProject, pages, persistExactDraft, projectRef, setActiveLocale],
  );

  const savePageSettings = useCallback(
    async (path: string, settings: PageSeoSettings, requestedPath?: string) => {
      const current = projectRef.current;
      if (!current) throw new Error('O projeto não está disponível.');
      if (blockGlobalPageMutation(current, 'Salvar configurações da página')) {
        throw new Error('Feche a variante A/B antes de salvar configurações globais da página.');
      }
      let nextPath = requestedPath?.trim() || path;
      let next = current;
      try {
        if (nextPath !== path) {
          const { renameProjectPage } = await import('@/lib/html-editor/page-rename');
          const renamed = renameProjectPage(next, path, nextPath);
          next = renamed.project;
          nextPath = renamed.path;
        }
        const currentSiteSettings = {
          ...siteSettings,
          ...(readEditorMetadata(current).siteSettings || {}),
        };
        next = updateTextFile(
          next,
          nextPath,
          applySeoToHtml(next.files[nextPath]?.text || '', nextPath, currentSiteSettings, settings),
        );
        next = updateEditorMetadata(next, metadata => {
          const storedPages = { ...(metadata.pageSettings || {}) };
          storedPages[nextPath] = settings;
          return {
            ...metadata,
            pageSettings: storedPages,
            customCode: normalizeCustomCodeSettings(metadata.customCode),
            redirects: normalizeRedirectSettings(metadata.redirects),
          };
        });
        await persistExactDraft(next, true);
        commitProject(next);
        setCodeFilePath(value => (value === path ? nextPath : value));
        useHtmlProjectSettingsStore.getState().open(nextPath);
        if (wordpress?.appView === 'settings' || wordpress?.appView === 'kodefy') {
          const url = new URL(window.location.href);
          url.searchParams.set('section', nextPath);
          window.history.replaceState({}, '', url);
        }
        await Promise.all(
          pageTemplateCollections
            .filter(collection => pageTemplates[collection.slug] === path)
            .map(collection => setPageTemplate(nextPath, collection.slug)),
        );
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error('Não foi possível salvar a página.');
        toast.error('Não foi possível salvar a página', {
          description: normalized.message,
        });
        throw normalized;
      }
    },
    [
      blockGlobalPageMutation,
      commitProject,
      pageTemplateCollections,
      pageTemplates,
      persistExactDraft,
      projectRef,
      setCodeFilePath,
      setPageTemplate,
      siteSettings,
      wordpress?.appView,
    ],
  );

  const prepareSocialImageFontFile = useCallback(
    async (fontFile: string) => {
      let sourceProject = projectRef.current;
      if (!sourceProject) throw new Error('Nenhum projeto está aberto para preparar esta fonte.');
      const sourceFile = sourceProject.files[fontFile];
      if (
        (!sourceFile || (sourceFile.data === undefined && sourceFile.text === undefined))
        && loadProjectFile
      ) {
        const loadedFile = await loadProjectFile(fontFile);
        if (loadedFile) {
          sourceProject = {
            ...sourceProject,
            files: { ...sourceProject.files, [loadedFile.path]: loadedFile },
          };
          projectRef.current = sourceProject;
        }
      }
      const { mergePreparedSocialFontFile, prepareSocialFontFile } = await import('@/lib/html-editor/social-font-conversion');
      const prepared = await prepareSocialFontFile(sourceProject, fontFile);
      const latestProject = projectRef.current || sourceProject;
      const nextProject = mergePreparedSocialFontFile(latestProject, prepared);
      if (nextProject !== latestProject) {
        commitProject(nextProject, false, false, true);
      }
      return prepared.fontFile;
    },
    [commitProject, loadProjectFile, projectRef],
  );

  const uploadProjectImage = useCallback(async (file: File) => {
    if (readOnly) throw new Error('Este projeto está em modo somente leitura.');
    const openedAt = projectRef.current?.openedAt;
    const image = await readSettingsImageUpload(file);
    const current = projectRef.current;
    if (!current || current.openedAt !== openedAt) throw new Error('O projeto mudou durante o envio. Tente novamente.');
    const added = addSettingsImageFile(current, image);
    // Install before flushing so another settings save also includes the new
    // binary. Select its persistent project path only after storage succeeds.
    commitProject(added.project, true, false, true, false);
    await persistExactDraft(added.project, true);
    return added.file.path;
  }, [commitProject, persistExactDraft, projectRef, readOnly]);

  const close = useCallback(() => {
    if (standalone) {
      void navigateAfterSave(wordpress?.editorUrl || '/kodety/editor/');
      return;
    }
    useHtmlProjectSettingsStore.getState().close();
  }, [navigateAfterSave, standalone, wordpress?.editorUrl]);

  const model: HtmlProjectSettingsProps = {
    standalone,
    readOnly,
    backHref: standalone ? wordpress?.editorUrl || '/kodety/editor/' : undefined,
    projectName: project.name,
    pages,
    homePage,
    initialSection,
    siteSettings,
    cookieConsent,
    customCode,
    redirects,
    pageSettings,
    pageHtmlSources,
    projectFiles: project.files,
    loadProjectFile,
    onUploadProjectImage: wordpressConnection?.mediaUrl ? undefined : uploadProjectImage,
    projectRootPath: project.rootPath,
    hydratedFramerProject,
    cmsCollections,
    pageTemplates,
    cmsItemsUrl: cmsHostConfig(wordpress)?.cmsItemsUrl,
    cmsNonce: cmsHostConfig(wordpress)?.nonce,
    wordpress: wordpressConnection,
    product,
    license,
    settingsContent,
    onClose: close,
    onNavigate: navigateAfterSave,
    onSaveSite: saveSiteSettings,
    onSaveCookieConsent: saveCookieConsent,
    onSaveCustomCode: saveCustomCode,
    onSaveRedirects: saveRedirects,
    onSavePage: savePageSettings,
    onPrepareFontFile: prepareSocialImageFontFile,
  };

  return (
    <Suspense fallback={<SettingsLoadingFallback overlay={!standalone} />}>
      <HtmlProjectSettings {...model} />
    </Suspense>
  );
}

export const HtmlProjectSettingsOverlayHost = memo(function HtmlProjectSettingsOverlayHost(
  props: HtmlProjectSettingsHostProps & { previewing: boolean },
) {
  const section = useHtmlProjectSettingsStore(state => state.section);
  if (!section || props.previewing) return null;
  return <HtmlProjectSettingsController {...props} initialSection={section} standalone={false} />;
});

export const HtmlProjectSettingsStandaloneHost = memo(function HtmlProjectSettingsStandaloneHost(
  props: HtmlProjectSettingsHostProps,
) {
  const storeSection = useHtmlProjectSettingsStore(state => state.section);
  const requestedSection =
    new URLSearchParams(window.location.search).get('section') ||
    storeSection ||
    (props.wordpress?.appView === 'kodefy' ? 'mcp' : 'general');
  return <HtmlProjectSettingsController {...props} initialSection={requestedSection} standalone />;
});

export const HtmlProjectSettingsRailButton = memo(function HtmlProjectSettingsRailButton({
  className,
}: {
  className?: string;
}) {
  const open = useHtmlProjectSettingsStore(state => state.section !== null);
  return (
    <button
      type="button"
      className={cn(className, open && 'bg-white/[0.09] text-[var(--kodety-accent-hover)]')}
      data-tooltip="Settings"
      data-kodety-onboarding="design-settings"
      aria-label="Settings"
      aria-pressed={open}
      onClick={() => useHtmlProjectSettingsStore.getState().toggle('general')}
    >
      <SettingsMinimalisticIcon />
    </button>
  );
});

export const HtmlProjectSettingsRailLink = memo(function HtmlProjectSettingsRailLink({
  className,
  href,
  onOpen,
}: {
  className?: string;
  href: string;
  onOpen?: () => void;
}) {
  const open = useHtmlProjectSettingsStore(state => state.section !== null);
  return (
    <a
      href={href}
      onClick={onOpen ? event => { event.preventDefault(); onOpen(); } : undefined}
      data-kodety-workspace-navigation="native"
      data-tooltip="Settings"
      data-kodety-onboarding="design-settings"
      aria-label="Settings"
      className={cn(className, open && 'bg-white/[0.09] text-[var(--kodety-accent-hover)]')}
    >
      <SettingsMinimalisticIcon />
    </a>
  );
});
