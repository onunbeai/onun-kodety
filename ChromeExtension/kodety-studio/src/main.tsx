import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { TOAST_PROPS } from '../../../lib/html-editor/toast-config';
import { AltArrowLeftIcon } from '@solar-icons/react/bold-duotone/alt-arrow-left';
import { CheckCircleIcon } from '@solar-icons/react/bold-duotone/check-circle';
import { ClockCircleIcon } from '@solar-icons/react/bold-duotone/clock-circle';
import { CloseCircleIcon } from '@solar-icons/react/bold-duotone/close-circle';
import { CrownStarIcon } from '@solar-icons/react/bold-duotone/crown-star';
import { DangerTriangleIcon } from '@solar-icons/react/bold-duotone/danger-triangle';
import { DownloadMinimalisticIcon } from '@solar-icons/react/bold-duotone/download-minimalistic';
import { FolderOpenIcon } from '@solar-icons/react/bold-duotone/folder-open';
import { FolderSecurityIcon } from '@solar-icons/react/bold-duotone/folder-security';
import { GlobalIcon } from '@solar-icons/react/bold-duotone/global';
import { InfoCircleIcon } from '@solar-icons/react/bold-duotone/info-circle';
import { MinimalisticMagnifierIcon } from '@solar-icons/react/bold-duotone/minimalistic-magnifier';
import { PenNewSquareIcon } from '@solar-icons/react/bold-duotone/pen-new-square';
import { ServerSquareCloudIcon } from '@solar-icons/react/bold-duotone/server-square-cloud';
import { SettingsMinimalisticIcon } from '@solar-icons/react/bold-duotone/settings-minimalistic';
import { ShieldCheckIcon } from '@solar-icons/react/bold-duotone/shield-check';
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold-duotone/trash-bin-minimalistic';
import { Widget5Icon } from '@solar-icons/react/bold-duotone/widget-5';
import {
  connectSecurityDirectory,
  captureProjectSnapshot,
  downloadProjectSnapshot,
  getSecurityDirectoryStatus,
  requestSecurityDirectoryAccess,
  saveProjectSnapshot,
  type ProjectBackupResult,
  type SecurityDirectoryStatus,
} from './backup-storage';
import { createBackupScheduler, type BackupProgress } from './backup-scheduler';
import { isProjectRuntimeMessageSource } from './runtime-message';
import { createStudioAgentNetworkBridge } from '../../../lib/html-editor/browser-agent-studio-network';
import {
  bootProject,
  destroyProjectData,
  flushProject,
  navigateProject,
  PLAYGROUND_REMOTE_ORIGIN,
  projectLockName,
  type RuntimeStage,
} from './playground-runtime';
import { respondToStudioPreviewRequest, studioPreviewChannelName, studioSitePreviewUrl } from './preview-bridge';
import { StudioI18nProvider, studioText, useStudioI18n } from './i18n';
import {
  loadProjects,
  loadStudioPreferences,
  newProject,
  saveStudioPreferences,
  saveProjects,
  STUDIO_ONBOARDING_VERSION,
  wordpressLocaleForLanguage,
  type KodetyStudioPreferences,
  type KodetyStudioProject,
  type StudioLanguage,
  type WordPressLocale,
} from './storage';
import type { PlaygroundClient } from '@wp-playground/client';
import { connectStudioMcpRelay } from './mcp-relay';

type AppView = 'projects' | 'workspace';
type StoragePersistenceStatus = 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported' | 'error';
const WORDPRESS_TOASTER_ID = 'kodety-wordpress-workspace';

const storagePersistencePriority: Record<StoragePersistenceStatus, number> = {
  checking: 0,
  error: 0,
  prompt: 1,
  unsupported: 2,
  denied: 2,
  granted: 3,
};

function strongerStoragePersistenceStatus(
  current: StoragePersistenceStatus,
  incoming: StoragePersistenceStatus,
): StoragePersistenceStatus {
  return storagePersistencePriority[incoming] >= storagePersistencePriority[current] ? incoming : current;
}

const stageOrder: RuntimeStage[] = ['runtime', 'wordpress', 'kodety', 'storage', 'ready'];

function playgroundSiteUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  const scope = url.pathname.match(/\/scope:[^/]+/)?.[0];
  url.pathname = scope ? `${scope}/` : '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

const stageLabelSources: Record<RuntimeStage, string> = {
  runtime: 'Preparando o ambiente',
  wordpress: 'Instalando o WordPress',
  kodety: 'Ativando o Kodety',
  storage: 'Salvando o projeto',
  ready: 'Tudo pronto',
};

const restoreStageLabelSources: Record<RuntimeStage, string> = {
  runtime: 'Carregando o ambiente',
  wordpress: 'Abrindo o WordPress',
  kodety: 'Verificando o Kodety',
  storage: 'Restaurando os dados locais',
  ready: 'Projeto carregado',
};

function formatRelativeDate(timestamp: number | null, language: StudioLanguage, neverLabel: string): string {
  if (!timestamp) return neverLabel;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(language === 'en' ? 'en-US' : 'pt-BR', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  const months = Math.round(days / 30);
  return formatter.format(months, 'month');
}

function formatBackupDate(timestamp: number | null, language: StudioLanguage, emptyLabel: string): string {
  if (!timestamp) return emptyLabel;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

const emptySecurityDirectoryStatus: SecurityDirectoryStatus = {
  supported: typeof window !== 'undefined' && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
  connected: false,
  needsPermission: false,
  directoryName: null,
  lastBackupAt: null,
};

function BrandMark({ className = '' }: { className?: string }) {
  return <img className={className} src="./assets/kodety-mark.svg" alt="" />;
}

function DiscordLogo({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function StrokeArrowUpRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function StrokeRefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 8.2A7 7 0 0 1 18.6 7L20 12" />
      <path d="M17.9 15.8A7 7 0 0 1 5.4 17L4 12" />
    </svg>
  );
}

function StrokePlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function StrokeEllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </svg>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  className = '',
  expanded,
}: {
  label: string;
  children: ReactNode;
  onClick(): void;
  disabled?: boolean;
  className?: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      data-tooltip={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function LanguageSwitcher({
  onChange,
  compact = false,
}: {
  onChange(language: StudioLanguage): void;
  compact?: boolean;
}) {
  const { language, t } = useStudioI18n();
  return (
    <div className={compact ? 'language-switcher is-compact' : 'language-switcher'} role="group" aria-label={t('Selecionar idioma')}>
      <button
        type="button"
        className={language === 'pt' ? 'is-active' : ''}
        aria-pressed={language === 'pt'}
        title={t('Interface em português')}
        onClick={() => onChange('pt')}
      >PT</button>
      <button
        type="button"
        className={language === 'en' ? 'is-active' : ''}
        aria-pressed={language === 'en'}
        title={t('Interface in English')}
        onClick={() => onChange('en')}
      >EN</button>
    </div>
  );
}

function AppTopbar({ onLanguageChange }: { onLanguageChange(language: StudioLanguage): void }) {
  const { t } = useStudioI18n();
  return (
    <header className="studio-topbar">
      <div className="studio-brand-cell" aria-hidden="true">
        <BrandMark />
      </div>
      <div className="studio-product-name">
        <strong>Onun Kodety</strong>
      </div>
      <div className="studio-runtime-pill">
        <span className="runtime-dot" />
        {t('WordPress no navegador')}
      </div>
      <div className="studio-topbar-actions">
        <LanguageSwitcher onChange={onLanguageChange} compact />
      </div>
    </header>
  );
}

function Sidebar({ projectCount }: { projectCount: number }) {
  const { t } = useStudioI18n();
  return (
    <aside className="studio-sidebar">
      <nav className="sidebar-nav" aria-label={t('Navegação principal')}>
        <button type="button" className="sidebar-item is-active">
          <FolderOpenIcon />
          <span>{t('Projetos')}</span>
          <small>{projectCount}</small>
        </button>
      </nav>

      <div className="sidebar-section">
        <p className="sidebar-label">{t('Ambiente')}</p>
        <div className="runtime-card">
          <div className="runtime-card-icon"><ServerSquareCloudIcon /></div>
          <div>
            <strong>{t('Runtime local')}</strong>
            <span>PHP 8.3 · SQLite</span>
          </div>
          <span className="runtime-card-status" title={t('Disponível')} />
        </div>
      </div>

      <div className="sidebar-local-card">
        <span><ShieldCheckIcon /></span>
        <div>
          <strong>{t('Local por padrão')}</strong>
          <p>{t('Seus projetos ficam salvos somente neste perfil do navegador.')}</p>
        </div>
      </div>
    </aside>
  );
}

function ProjectPreview({ thumbnailDataUrl }: { thumbnailDataUrl?: string }) {
  return (
    <div className="project-preview" aria-hidden="true">
      {thumbnailDataUrl ? (
        <img className="project-preview-thumbnail" src={thumbnailDataUrl} alt="" />
      ) : (
        <div className="project-preview-placeholder"><BrandMark /></div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onRename,
  onDelete,
}: {
  project: KodetyStudioProject;
  onOpen(): void;
  onRename(): void;
  onDelete(): void;
}) {
  const { language, t } = useStudioI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  return (
    <article className="project-card">
      <button type="button" className="project-open-surface" onClick={onOpen} aria-label={t('Abrir {name}', { name: project.name })}>
        <ProjectPreview thumbnailDataUrl={project.thumbnailDataUrl} />
        <div className="project-card-copy">
          <div className="project-card-title-row">
            <div>
              <strong>{project.name}</strong>
              <small>{t('WordPress local')} · {project.wordpressLocale === 'pt_BR' ? 'PT-BR' : 'EN-US'}</small>
            </div>
            <span className={project.initialized ? 'project-state is-ready' : 'project-state'}>
              {project.initialized ? t('Pronto') : t('Novo')}
            </span>
          </div>
          <div className="project-meta">
            <span><ClockCircleIcon /> {formatRelativeDate(project.lastOpenedAt, language, t('Nunca aberto'))}</span>
            <span className="project-version">WP {project.wordpressVersion} · Kodety {project.kodetyVersion}</span>
          </div>
        </div>
      </button>
      <div className="project-menu" ref={menuRef}>
        <IconButton
          label={t('Opções de {name}', { name: project.name })}
          expanded={menuOpen}
          onClick={() => setMenuOpen(current => !current)}
        >
          <StrokeEllipsisIcon />
        </IconButton>
        {menuOpen && (
          <div className="context-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpen(); }}>
              <GlobalIcon /> {t('Abrir projeto')}
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRename(); }}>
              <PenNewSquareIcon /> {t('Renomear')}
            </button>
            <div className="context-separator" />
            <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); onDelete(); }}>
              <TrashBinMinimalisticIcon /> {t('Excluir')}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function EmptyProjects({ onCreate }: { onCreate(): void }) {
  const { t } = useStudioI18n();
  return (
    <section className="empty-projects">
      <div className="empty-projects-icon"><FolderOpenIcon /></div>
      <h2>{t('Seu primeiro projeto começa aqui')}</h2>
      <p>{t('Crie um WordPress isolado com o Kodety já instalado. Tudo roda e fica salvo no navegador.')}</p>
      <button type="button" className="primary-button" onClick={onCreate}>
        <StrokePlusIcon /> {t('Criar primeiro projeto')}
      </button>
    </section>
  );
}

function ProjectsDashboard({
  projects,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onLanguageChange,
}: {
  projects: KodetyStudioProject[];
  onCreate(): void;
  onOpen(project: KodetyStudioProject): void;
  onRename(project: KodetyStudioProject): void;
  onDelete(project: KodetyStudioProject): void;
  onLanguageChange(language: StudioLanguage): void;
}) {
  const { language, t } = useStudioI18n();
  const [query, setQuery] = useState('');
  const filteredProjects = useMemo(() => {
    const locale = language === 'en' ? 'en-US' : 'pt-BR';
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return projects;
    return projects.filter(project => project.name.toLocaleLowerCase(locale).includes(normalized));
  }, [language, projects, query]);

  return (
    <div className="dashboard-shell">
      <AppTopbar onLanguageChange={onLanguageChange} />
      <Sidebar projectCount={projects.length} />
      <main className="dashboard-main">
        <section className="dashboard-content">
          <header className="projects-header">
            <div className="projects-heading">
              <p className="eyebrow">{t('Workspace local')}</p>
              <h1>{t('Seus projetos')}</h1>
              <span>{t('Crie, abra e edite sites Kodety sem instalar um servidor.')}</span>
              <div className="workspace-facts" aria-label={t('Resumo do ambiente local')}>
                <span><FolderOpenIcon /> {t(projects.length === 1 ? '{count} projeto local' : '{count} projetos locais', { count: projects.length })}</span>
                <span><ShieldCheckIcon /> {t('Dados neste dispositivo')}</span>
                <span><ServerSquareCloudIcon /> PHP 8.3 · SQLite</span>
              </div>
            </div>
            <div className="projects-header-actions">
              <button type="button" className="primary-button" onClick={onCreate}>
                <StrokePlusIcon /> {t('Novo projeto')}
              </button>
            </div>
          </header>

          {projects.length > 0 && (
            <div className="projects-toolbar">
              <label className="search-control">
                <MinimalisticMagnifierIcon />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={t('Buscar projetos')}
                  aria-label={t('Buscar projetos')}
                />
              </label>
              <span>{t(filteredProjects.length === 1 ? '{count} projeto' : '{count} projetos', { count: filteredProjects.length })}</span>
            </div>
          )}

          {projects.length === 0 ? (
            <EmptyProjects onCreate={onCreate} />
          ) : filteredProjects.length === 0 ? (
            <div className="no-results">
              <MinimalisticMagnifierIcon />
              <strong>{t('Nenhum projeto encontrado')}</strong>
              <span>{t('Tente buscar usando outro nome.')}</span>
            </div>
          ) : (
            <section className="projects-grid" aria-label={t('Projetos locais')}>
              {filteredProjects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => onOpen(project)}
                  onRename={() => onRename(project)}
                  onDelete={() => onDelete(project)}
                />
              ))}
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

function Modal({ children, onClose, label }: { children: ReactNode; onClose(): void; label: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []);
    if (!dialog?.contains(document.activeElement)) (focusable()[0] || dialog)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
    </div>
  );
}

function NewProjectDialog({
  defaultWordPressLocale,
  onClose,
  onCreate,
}: {
  defaultWordPressLocale: WordPressLocale;
  onClose(): void;
  onCreate(name: string, wordpressLocale: WordPressLocale): void;
}) {
  const { t } = useStudioI18n();
  const [name, setName] = useState('');
  const [wordpressLocale, setWordPressLocale] = useState<WordPressLocale>(defaultWordPressLocale);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate(name, wordpressLocale);
  };

  return (
    <Modal onClose={onClose} label={t('Criar novo projeto')}>
      <form onSubmit={submit}>
        <header className="modal-header">
          <div className="modal-icon"><StrokePlusIcon /></div>
          <div>
            <h2>{t('Novo projeto')}</h2>
            <p>{t('Um WordPress completo, isolado e pronto para o Kodety.')}</p>
          </div>
          <IconButton label={t('Fechar')} onClick={onClose}><CloseCircleIcon /></IconButton>
        </header>
        <div className="modal-body">
          <label className="field-label" htmlFor="project-name">{t('Nome do projeto')}</label>
          <input
            id="project-name"
            className="text-input"
            value={name}
            onChange={event => setName(event.target.value)}
            autoFocus
            maxLength={80}
            placeholder={t('Ex.: Landing da Clínica')}
          />
          <fieldset className="language-choice-fieldset">
            <legend className="field-label">{t('Idioma do WordPress')}</legend>
            <div className="project-language-options">
              <label className={wordpressLocale === 'pt_BR' ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="wordpress-locale"
                  value="pt_BR"
                  checked={wordpressLocale === 'pt_BR'}
                  onChange={() => setWordPressLocale('pt_BR')}
                />
                <span><strong>{t('Português (Brasil)')}</strong><small>pt_BR</small></span>
                <CheckCircleIcon />
              </label>
              <label className={wordpressLocale === 'en_US' ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="wordpress-locale"
                  value="en_US"
                  checked={wordpressLocale === 'en_US'}
                  onChange={() => setWordPressLocale('en_US')}
                />
                <span><strong>{t('English (US)')}</strong><small>en_US</small></span>
                <CheckCircleIcon />
              </label>
            </div>
            <small className="field-help">{t('O WordPress e a interface interna do Kodety serão instalados neste idioma.')}</small>
          </fieldset>
          <div className="environment-summary">
            <div><GlobalIcon /><span><strong>WordPress</strong><small>{t('Versão estável validada pelo Kodety')}</small></span><b>7.1</b></div>
            <div><ServerSquareCloudIcon /><span><strong>{t('PHP + SQLite')}</strong><small>{t('Executado dentro do navegador')}</small></span><b>8.3</b></div>
            <div><Widget5Icon /><span><strong>{t('Onun Kodety Builder')}</strong><small>{t('Instalado e ativado para você')}</small></span><b>{t('Incluído')}</b></div>
          </div>
          <p className="modal-hint"><InfoCircleIcon /> {t('É preciso internet para carregar o runtime; o WordPress executa e fica salvo localmente.')}</p>
        </div>
        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>{t('Cancelar')}</button>
          <button type="submit" className="primary-button" disabled={!name.trim()}>
            {t('Criar e abrir')} <StrokePlusIcon />
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function RenameProjectDialog({
  project,
  onClose,
  onRename,
}: {
  project: KodetyStudioProject;
  onClose(): void;
  onRename(name: string): void;
}) {
  const { t } = useStudioI18n();
  const [name, setName] = useState(project.name);
  return (
    <Modal onClose={onClose} label={t('Renomear projeto')}>
      <form onSubmit={event => { event.preventDefault(); onRename(name); }}>
        <header className="modal-header is-compact">
          <div className="modal-icon"><PenNewSquareIcon /></div>
          <div><h2>{t('Renomear projeto')}</h2><p>{t('O conteúdo e os arquivos não serão alterados.')}</p></div>
          <IconButton label={t('Fechar')} onClick={onClose}><CloseCircleIcon /></IconButton>
        </header>
        <div className="modal-body">
          <label className="field-label" htmlFor="rename-project">{t('Nome do projeto')}</label>
          <input id="rename-project" className="text-input" value={name} onChange={event => setName(event.target.value)} autoFocus maxLength={80} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>{t('Cancelar')}</button>
          <button type="submit" className="primary-button" disabled={!name.trim() || name.trim() === project.name}>{t('Salvar nome')}</button>
        </footer>
      </form>
    </Modal>
  );
}

function TransferProjectDialog({
  project,
  onClose,
  onTransfer,
}: {
  project: KodetyStudioProject;
  onClose(): void;
  onTransfer(): Promise<void>;
}) {
  const { t } = useStudioI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (!busy) onClose();
  };

  const confirmTransfer = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onTransfer();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Não foi possível preparar o ZIP de transferência.'));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={close} label={t('Transferir projeto para hospedagem')}>
      <div className="modal-header transfer-modal-header">
        <div className="modal-icon"><ServerSquareCloudIcon /></div>
        <div>
          <h2>{t('Transferir para hospedagem')}</h2>
          <p>{t('Baixe o projeto “{name}” pronto para levar ao seu WordPress.', { name: project.name })}</p>
        </div>
        <IconButton label={t('Fechar')} onClick={close} disabled={busy}><CloseCircleIcon /></IconButton>
      </div>
      <div className="modal-body transfer-modal-body">
        <div className="transfer-callout">
          <DownloadMinimalisticIcon />
          <div>
            <strong>{t('O Studio vai baixar um ZIP completo do projeto.')}</strong>
            <p>{t('Depois, no WordPress da sua hospedagem, abra o Kodety e importe esse mesmo arquivo ZIP.')}</p>
          </div>
        </div>
        <div className="transfer-includes">
          <p>{t('O pacote leva tudo que faz parte do projeto:')}</p>
          <div>
            <span><CheckCircleIcon /> {t('Páginas e mídia')}</span>
            <span><CheckCircleIcon /> {t('SEO e redirects')}</span>
            <span><CheckCircleIcon /> {t('Animações e interações')}</span>
            <span><CheckCircleIcon /> {t('Componentes e estilos')}</span>
            <span><CheckCircleIcon /> {t('CMS e templates')}</span>
            <span><CheckCircleIcon /> {t('Configurações portáteis')}</span>
          </div>
        </div>
        <ol className="transfer-steps">
          <li><span>1</span><div><strong>{t('Baixe o ZIP')}</strong><small>{t('Não extraia nem altere o arquivo.')}</small></div></li>
          <li><span>2</span><div><strong>{t('Abra o Kodety hospedado')}</strong><small>{t('Entre na área de projeto do plugin.')}</small></div></li>
          <li><span>3</span><div><strong>{t('Importe o mesmo ZIP')}</strong><small>{t('O Kodety reconstrói o projeto para continuar editando.')}</small></div></li>
        </ol>
        {error && <p className="delete-error" role="alert"><DangerTriangleIcon /> {error}</p>}
        <p className="transfer-note"><InfoCircleIcon /> {t('Licenças, senhas, usuários e credenciais privadas da hospedagem não entram no ZIP.')}</p>
      </div>
      <footer className="modal-footer">
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>{t('Cancelar')}</button>
        <button type="button" className="primary-button" onClick={() => void confirmTransfer()} disabled={busy}>
          <DownloadMinimalisticIcon /> {busy ? t('Preparando ZIP…') : t('Baixar ZIP para transferir')}
        </button>
      </footer>
    </Modal>
  );
}

function SecurityFolderDialog({
  project,
  status,
  manualBackup = false,
  lastZipBackupAt = null,
  backupFailure = '',
  storageProtection,
  offlineReadiness,
  onClose,
  onConnect,
  onRequestAccess,
  onSave,
  onDownload,
}: {
  project: KodetyStudioProject;
  status: SecurityDirectoryStatus;
  manualBackup?: boolean;
  lastZipBackupAt?: number | null;
  backupFailure?: string;
  storageProtection?: { label: string; description: string };
  offlineReadiness?: { label: string; error: string; retry(): void };
  onClose(): void;
  onConnect(): Promise<SecurityDirectoryStatus>;
  onRequestAccess(): Promise<SecurityDirectoryStatus>;
  onSave(): Promise<ProjectBackupResult>;
  onDownload(): Promise<void>;
}) {
  const { language, t } = useStudioI18n();
  const [busy, setBusy] = useState<'connect' | 'permission' | 'save' | 'download' | null>(null);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState<ProjectBackupResult | null>(null);

  const close = () => {
    if (!busy) onClose();
  };

  const reportError = (reason: unknown) => {
    if (reason instanceof DOMException && reason.name === 'AbortError') return;
    setError(reason instanceof Error ? t(reason.message) : t('Não foi possível criar o backup local.'));
  };

  const connectAndSave = async () => {
    setBusy('connect');
    setError('');
    setLastResult(null);
    try {
      await onConnect();
      setBusy('save');
      setLastResult(await onSave());
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  };

  const authorizeAndSave = async () => {
    setBusy('permission');
    setError('');
    setLastResult(null);
    try {
      const nextStatus = await onRequestAccess();
      if (!nextStatus.connected) throw new Error(t('O navegador não permitiu gravar na pasta de segurança.'));
      setBusy('save');
      setLastResult(await onSave());
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError('');
    setLastResult(null);
    try {
      setLastResult(await onSave());
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy('download');
    setError('');
    try {
      await onDownload();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(null);
    }
  };

  const lastBackupAt = lastResult?.createdAt || status.lastBackupAt;
  const manualView = manualBackup || !status.supported;

  return (
    <Modal onClose={close} label={manualView ? t('Backup manual em ZIP') : t('Pasta de segurança')}>
      <div className="modal-header security-folder-header">
        <div className="modal-icon"><FolderSecurityIcon /></div>
        <div>
          <h2>{manualView ? t('Backup manual em ZIP') : t('Pasta de segurança')}</h2>
          <p>{t('Mantenha cópias de “{name}” fora do armazenamento interno do navegador.', { name: project.name })}</p>
        </div>
        <IconButton label={t('Fechar')} onClick={close} disabled={Boolean(busy)}><CloseCircleIcon /></IconButton>
      </div>
      <div className="modal-body security-folder-body">
        <div className="security-folder-callout">
          <ShieldCheckIcon />
          <div>
            <strong>{t('Uma segunda cópia, ainda totalmente local.')}</strong>
            <p>{manualView
              ? t('Baixe um ZIP completo deste WordPress e guarde o arquivo no computador. O backup é criado quando você solicita o download.')
              : t('O Studio cria latest.zip e mantém os cinco snapshots mais recentes na pasta escolhida. Nada é enviado ao Kodety.')}</p>
          </div>
        </div>

        {!manualView ? (
          <div className={status.connected ? 'security-folder-state is-connected' : 'security-folder-state'}>
            <FolderOpenIcon />
            <div>
              <strong>{status.directoryName || t('Nenhuma pasta conectada')}</strong>
              <span>{status.connected
                ? t('Último backup: {date}', { date: formatBackupDate(lastBackupAt, language, t('ainda não criado')) })
                : status.needsPermission
                  ? t('Autorize novamente o acesso para continuar salvando snapshots.')
                  : t('Escolha ou crie uma pasta como Documentos/Onun Kodety.')}</span>
            </div>
            {status.connected && <CheckCircleIcon />}
          </div>
        ) : (
          <div className="security-folder-unsupported">
            <InfoCircleIcon />
            <p>{manualBackup
              ? t('Suas alterações ficam neste navegador. Baixe novos ZIPs durante o trabalho para manter uma cópia atualizada fora dele.')
              : t('Este navegador não permite conectar uma pasta. Você ainda pode baixar um backup ZIP manualmente.')}</p>
          </div>
        )}

        {lastResult && (
          <div className="security-folder-success" role="status">
            <CheckCircleIcon />
            <div><strong>{t('Snapshot salvo com segurança')}</strong><span>{lastResult.directoryName}/snapshots/{lastResult.snapshotName}</span></div>
          </div>
        )}
        {lastZipBackupAt && <p className="security-folder-note" role="status"><DownloadMinimalisticIcon /> {t('Último ZIP gerado: {date}', { date: formatBackupDate(lastZipBackupAt, language, '') })}</p>}
        {(error || backupFailure) && <p className="delete-error security-folder-error" role="alert"><DangerTriangleIcon /> {error || t(backupFailure)}</p>}
        {storageProtection && <div className="security-folder-state">
          <ShieldCheckIcon /><div><strong>{storageProtection.label}</strong><span>{storageProtection.description}</span></div>
        </div>}
        {offlineReadiness && <div className="security-folder-state">
          <GlobalIcon /><div><strong>{offlineReadiness.label}</strong>{offlineReadiness.error && <span>{offlineReadiness.error}</span>}</div>
          {offlineReadiness.error && <button type="button" className="secondary-button" onClick={offlineReadiness.retry} disabled={Boolean(busy)}>{t('Tentar novamente')}</button>}
        </div>}
        <p className="security-folder-note"><InfoCircleIcon /> {manualView
          ? t('Confira o arquivo na pasta de downloads. Alterações posteriores não atualizam o ZIP que você já baixou.')
          : t('Apagar os dados do navegador não apaga os arquivos desta pasta. Perder ou apagar a própria pasta continua removendo os backups.')}</p>
      </div>
      <footer className="modal-footer security-folder-footer">
        <button type="button" className="secondary-button" onClick={close} disabled={Boolean(busy)}>{t('Fechar')}</button>
        {!manualView && status.directoryName && (
          <button type="button" className="secondary-button" onClick={() => void connectAndSave()} disabled={Boolean(busy)}>
            <FolderOpenIcon /> {t('Trocar pasta')}
          </button>
        )}
          <button type="button" className={manualView ? 'primary-button' : 'secondary-button'} onClick={() => void download()} disabled={Boolean(busy)}>
            <DownloadMinimalisticIcon /> {busy === 'download' ? t('Preparando backup…') : t('Baixar backup ZIP')}
          </button>
        {!manualView && status.needsPermission && (
          <button type="button" className="primary-button" onClick={() => void authorizeAndSave()} disabled={Boolean(busy)}>
            <FolderSecurityIcon /> {busy ? t('Salvando snapshot…') : t('Autorizar e salvar')}
          </button>
        )}
        {!manualView && !status.connected && !status.needsPermission && (
          <button type="button" className="primary-button" onClick={() => void connectAndSave()} disabled={Boolean(busy)}>
            <FolderSecurityIcon /> {busy ? t('Salvando snapshot…') : t('Conectar pasta de segurança')}
          </button>
        )}
        {!manualView && status.connected && (
          <button type="button" className="primary-button" onClick={() => void save()} disabled={Boolean(busy)}>
            <FolderSecurityIcon /> {busy ? t('Salvando snapshot…') : t('Salvar snapshot agora')}
          </button>
        )}
      </footer>
    </Modal>
  );
}

function ExitProjectDialog({
  project,
  securityStatus,
  manualBackup = false,
  manualBackupPending = true,
  onClose,
  onOpenSecurityFolder,
  onSaveAndExit,
  onDownloadAndExit,
  onExitWithoutBackup,
}: {
  project: KodetyStudioProject;
  securityStatus: SecurityDirectoryStatus;
  manualBackup?: boolean;
  manualBackupPending?: boolean;
  onClose(): void;
  onOpenSecurityFolder(): void;
  onSaveAndExit(): Promise<void>;
  onDownloadAndExit(): Promise<void>;
  onExitWithoutBackup(): Promise<void>;
}) {
  const { t } = useStudioI18n();
  const [busy, setBusy] = useState<'save' | 'download' | 'exit' | null>(null);
  const [error, setError] = useState('');

  const close = () => {
    if (!busy) onClose();
  };

  const run = async (action: 'save' | 'download' | 'exit', callback: () => Promise<void>) => {
    setBusy(action);
    setError('');
    try {
      await callback();
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Não foi possível concluir o backup antes de sair.'));
      setBusy(null);
    }
  };

  return (
    <Modal onClose={close} label={t('Sair do projeto')}>
      <div className="modal-header exit-project-header">
        <div className="modal-icon"><DownloadMinimalisticIcon /></div>
        <div>
          <h2>{manualBackup && !manualBackupPending ? t('Sair do projeto') : t('Baixe um backup antes de sair')}</h2>
          <p>{manualBackup
            ? t('Guarde o ZIP de “{name}” na sua pasta de segurança depois do download. Salvar no navegador não substitui essa cópia.', { name: project.name })
            : t('O projeto “{name}” continua salvo no navegador, mas uma cópia externa deixa seu trabalho protegido.', { name: project.name })}</p>
        </div>
        <IconButton label={t('Fechar')} onClick={close} disabled={Boolean(busy)}><CloseCircleIcon /></IconButton>
      </div>
      <div className="modal-body exit-project-body">
        {!manualBackup && securityStatus.connected ? (
          <div className="exit-backup-state is-protected">
            <FolderSecurityIcon />
            <div><strong>{t('Pasta de segurança conectada')}</strong><span>{securityStatus.directoryName}</span></div>
            <CheckCircleIcon />
          </div>
        ) : (
          <div className="exit-backup-state">
            <FolderSecurityIcon />
            <div><strong>{manualBackup ? manualBackupPending ? t('Backup ZIP pendente') : t('ZIP gerado nesta sessão') : t('Sem pasta de segurança conectada')}</strong><span>{!manualBackup && securityStatus.supported
              ? t('Você pode baixar um ZIP agora ou conectar uma pasta para snapshots recorrentes.')
              : t('Baixe um backup ZIP para manter uma cópia deste WordPress fora do navegador.')}</span></div>
          </div>
        )}
        {!manualBackup && !securityStatus.connected && securityStatus.supported && (
          <button type="button" className="exit-connect-folder" onClick={onOpenSecurityFolder} disabled={Boolean(busy)}>
            <FolderSecurityIcon /> {t('Conectar pasta de segurança')}
          </button>
        )}
        {error && <p className="delete-error security-folder-error" role="alert"><DangerTriangleIcon /> {error}</p>}
        <p className="exit-project-note"><InfoCircleIcon /> {t('Sair não publica o site e não envia seus arquivos para o servidor do Kodety.')}</p>
      </div>
      <footer className="modal-footer exit-project-footer">
        <button type="button" className="secondary-button" onClick={close} disabled={Boolean(busy)}>{t('Continuar editando')}</button>
        <button type="button" className="secondary-button" onClick={() => void run('exit', onExitWithoutBackup)} disabled={Boolean(busy)}>
          {busy === 'exit' ? t('Salvando no navegador…') : manualBackup ? t('Sair sem baixar') : t('Sair sem novo backup')}
        </button>
        {!manualBackup && securityStatus.connected ? (
          <button type="button" className="primary-button" onClick={() => void run('save', onSaveAndExit)} disabled={Boolean(busy)}>
            <FolderSecurityIcon /> {busy === 'save' ? t('Salvando snapshot…') : t('Salvar na pasta e sair')}
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={() => void run('download', onDownloadAndExit)} disabled={Boolean(busy)}>
            <DownloadMinimalisticIcon /> {busy === 'download' ? t('Preparando backup…') : manualBackup ? t('Baixar ZIP e sair') : t('Baixar backup e sair')}
          </button>
        )}
      </footer>
    </Modal>
  );
}

export function DeleteProjectDialog({
  project,
  onClose,
  onDelete,
}: {
  project: KodetyStudioProject;
  onClose(): void;
  onDelete(iframe: HTMLIFrameElement, onStage: (detail: string) => void): Promise<void>;
}) {
  const { t } = useStudioI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');

  const close = () => {
    if (!busy) onClose();
  };

  const confirmDelete = async () => {
    const iframe = iframeRef.current;
    if (!iframe || busy) return;
    setBusy(true);
    setError('');
    setDetail(t('Preparando a exclusão'));
    try {
      await onDelete(iframe, setDetail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Não foi possível excluir este projeto.'));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={close} label={t('Excluir projeto')}>
      <div className="modal-header is-compact">
        <div className="modal-icon is-danger"><DangerTriangleIcon /></div>
        <div><h2>{t('Excluir “{name}”?', { name: project.name })}</h2><p>{t('Essa ação apaga permanentemente os arquivos deste projeto salvos no navegador.')}</p></div>
        <IconButton label={t('Fechar')} onClick={close} disabled={busy}><CloseCircleIcon /></IconButton>
      </div>
      <div className="modal-body delete-copy">
        <p>{t('Antes de excluir, exporte o ZIP pelo Kodety caso queira levar esse trabalho para outra instalação.')}</p>
        {busy && (
          <div className="delete-progress" role="status" aria-live="polite">
            <span className="delete-progress-spinner" />
            <span><strong>{t('Excluindo projeto…')}</strong><small>{detail}</small></span>
          </div>
        )}
        {error && <p className="delete-error" role="alert"><DangerTriangleIcon /> {error} {t('O projeto continua na biblioteca; tente novamente.')}</p>}
        <iframe
          ref={iframeRef}
          className="deletion-runtime-frame"
          title={t('Runtime de exclusão do projeto')}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
        />
      </div>
      <footer className="modal-footer">
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>{t('Cancelar')}</button>
        <button type="button" className="danger-button" onClick={() => void confirmDelete()} disabled={busy}>
          <TrashBinMinimalisticIcon /> {busy ? t('Excluindo…') : t('Excluir projeto')}
        </button>
      </footer>
    </Modal>
  );
}

function RuntimeLoading({
  stage,
  detail,
  restoring,
}: {
  stage: RuntimeStage;
  detail: string;
  restoring: boolean;
}) {
  const { t } = useStudioI18n();
  const currentIndex = stageOrder.indexOf(stage);
  const labels = restoring ? restoreStageLabelSources : stageLabelSources;
  return (
    <div className="runtime-loading">
      <div className="loading-brand"><BrandMark /></div>
      <div className="loading-copy">
        <h2>{stage === 'ready' ? t(restoring ? 'Projeto carregado' : 'Projeto pronto') : t(restoring ? 'Carregando seu projeto' : 'Preparando seu projeto')}</h2>
        <p>{detail}</p>
      </div>
      <div className="loading-progress-track"><span style={{ width: `${Math.max(9, ((currentIndex + 1) / stageOrder.length) * 100)}%` }} /></div>
      <ol className="loading-steps">
        {stageOrder.slice(0, -1).map((item, index) => (
          <li key={item} className={index < currentIndex ? 'is-done' : index === currentIndex ? 'is-active' : ''}>
            <span>{index < currentIndex ? <CheckCircleIcon /> : index + 1}</span>
            {t(labels[item])}
          </li>
        ))}
      </ol>
      <small>{t(restoring
        ? 'Abrindo os dados já salvos neste navegador.'
        : 'Você não precisa instalar PHP, MySQL ou qualquer outro programa.')}</small>
    </div>
  );
}

function StudioOnboarding({
  onLanguageChange,
  onComplete,
}: {
  onLanguageChange(language: StudioLanguage): void;
  onComplete(): void;
}) {
  const { t } = useStudioI18n();
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);
  const steps = [
    { title: t('Seu Studio local'), copy: t('Projetos e prévia') },
    { title: t('Transferência'), copy: t('ZIP e segurança') },
  ];
  const lastStep = step === steps.length - 1;
  const advance = () => {
    if (lastStep) onComplete();
    else setStep(current => Math.min(steps.length - 1, current + 1));
  };

  return (
    <main className="studio-onboarding-shell">
      <aside className="studio-onboarding-rail">
        <div className="studio-onboarding-brand"><BrandMark /><strong>Onun Kodety</strong></div>
        <nav aria-label={t('Etapas da configuração')}>
          {steps.map((item, index) => (
            <button
              type="button"
              key={item.title}
              className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}
              aria-current={index === step ? 'step' : undefined}
              aria-controls="studio-onboarding-panel"
              aria-label={`${t('Etapa {current} de {total}', { current: index + 1, total: steps.length })}: ${item.title}`}
              onClick={() => setStep(index)}
            >
              <span aria-hidden="true">{index < step ? <CheckCircleIcon /> : index + 1}</span>
              <span><strong>{item.title}</strong><small>{item.copy}</small></span>
            </button>
          ))}
        </nav>
        <div className="studio-onboarding-rail-note">
          <SettingsMinimalisticIcon />
          <p>{t('Você pode ajustar estas preferências depois na área de projetos.')}</p>
        </div>
      </aside>

      <section id="studio-onboarding-panel" className="studio-onboarding-stage" aria-labelledby="studio-onboarding-title">
        <div className="studio-onboarding-content" ref={contentRef}>
          {step === 0 && (
            <section className="studio-onboarding-page">
              <p className="eyebrow">{t('Seu Studio local')}</p>
              <h1 id="studio-onboarding-title" ref={headingRef} tabIndex={-1}>{t('Seu WordPress local começa aqui.')}</h1>
              <p className="studio-onboarding-intro">{t('O Onun Kodety abre pela web, mas executa cada projeto dentro deste navegador. Nenhum WordPress é hospedado no servidor do Kodety.')}</p>
              <div className="studio-onboarding-callout">
                <ShieldCheckIcon />
                <div><strong>{t('Local por padrão')}</strong><p>{t('Seus projetos não são enviados ao banco de dados do Kodety.')}</p></div>
              </div>
              <div className="studio-onboarding-setting" aria-labelledby="studio-language-title">
                <div><strong id="studio-language-title">{t('Idioma do Studio e do WordPress')}</strong><p>{t('Novos projetos WordPress serão instalados no idioma escolhido aqui.')}</p></div>
                <LanguageSwitcher onChange={onLanguageChange} />
              </div>
              <div className="studio-onboarding-detail-list">
                <div><ServerSquareCloudIcon /><span><strong>{t('Um WordPress completo por projeto')}</strong><small>{t('PHP 8.3, WordPress, SQLite e Kodety rodam isolados no navegador.')}</small></span></div>
                <div><GlobalIcon /><span><strong>{t('Builder aberto, prévia em nova guia')}</strong><small>{t('A aba Site mostra a versão publicada localmente sem desmontar o seu trabalho no Builder.')}</small></span></div>
                <div><FolderSecurityIcon /><span><strong>{t('Proteção local e pasta de segurança')}</strong><small>{t('O Studio solicita armazenamento persistente e também permite manter snapshots em uma pasta real do computador.')}</small></span></div>
              </div>
              <div className="studio-onboarding-warning" role="note"><InfoCircleIcon /><div><strong>{t('Os dados pertencem a este perfil')}</strong><p>{t('Limpar os dados do site, usar navegação privada, trocar de perfil ou perder o computador pode remover o acesso aos projetos locais.')}</p></div></div>
            </section>
          )}

          {step === 1 && (
            <section className="studio-onboarding-page">
              <p className="eyebrow">{t('Transferência')}</p>
              <h1 id="studio-onboarding-title" ref={headingRef} tabIndex={-1}>{t('Leve tudo para sua hospedagem.')}</h1>
              <p className="studio-onboarding-intro">{t('Quando o projeto estiver pronto, gere um único ZIP e importe esse arquivo no Kodety instalado no WordPress final.')}</p>
              <div className="studio-onboarding-callout">
                <DownloadMinimalisticIcon />
                <div><strong>{t('O ZIP leva o projeto completo')}</strong><p>{t('Páginas, mídias, SEO, redirects, animações, componentes, estilos e configurações portáteis seguem juntos.')}</p></div>
              </div>
              <ol className="studio-onboarding-transfer-steps">
                <li><span>1</span><div><strong>{t('Clique em Transferir para hospedagem')}</strong><small>{t('O Studio prepara a cópia portátil do projeto local.')}</small></div></li>
                <li><span>2</span><div><strong>{t('Baixe e mantenha o ZIP intacto')}</strong><small>{t('Não extraia nem altere o arquivo gerado.')}</small></div></li>
                <li><span>3</span><div><strong>{t('Importe no Kodety da hospedagem')}</strong><small>{t('O WordPress final reconstrói o projeto para você continuar editando.')}</small></div></li>
              </ol>
              <p className="studio-onboarding-inline-note"><InfoCircleIcon /> {t('Até você transferir, nada do projeto é enviado ao servidor do Kodety.')}</p>
            </section>
          )}
        </div>

        <footer className="studio-onboarding-footer">
          <button type="button" className="studio-onboarding-back" onClick={() => setStep(current => Math.max(0, current - 1))} disabled={step === 0}>
            <AltArrowLeftIcon /> {t('Voltar')}
          </button>
          <span>{t('Etapa {current} de {total}', { current: step + 1, total: steps.length })}</span>
          <button type="button" className="primary-button" onClick={advance}>
            {t(lastStep ? 'Abrir o Studio' : 'Continuar')} <AltArrowLeftIcon className="onboarding-forward-icon" />
          </button>
        </footer>
      </section>
    </main>
  );
}

export function ProjectWorkspace({
  project,
  language,
  onBack,
  onProjectReady,
  requireSecurityDirectory: requestedSecurityDirectory = false,
  manualBackup = false,
  cloudSnapshotEnabled = false,
  onCloudSnapshot,
  onCloudSnapshotError,
  restoreFirstBoot,
}: {
  project: KodetyStudioProject;
  language: StudioLanguage;
  onBack(): void;
  onProjectReady(project: KodetyStudioProject): Promise<void>;
  requireSecurityDirectory?: boolean;
  manualBackup?: boolean;
  cloudSnapshotEnabled?: boolean;
  onCloudSnapshot?(project: KodetyStudioProject, archive: Blob): Promise<void>;
  onCloudSnapshotError?(reason: unknown): void;
  restoreFirstBoot?(client: PlaygroundClient): Promise<void>;
}) {
  const requireSecurityDirectory = requestedSecurityDirectory && !manualBackup;
  const protectWorkspaceDraft = requireSecurityDirectory || manualBackup;
  const { t } = useStudioI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const clientRef = useRef<PlaygroundClient | null>(null);
  const studioBridgeWindowRef = useRef<Window | null>(null);
  const studioBridgeReadyRef = useRef(false);
  const studioBridgeWaitersRef = useRef(new Set<() => void>());
  const currentProjectRef = useRef(project);
  const persistedProjectRef = useRef<KodetyStudioProject | null>(null);
  const initialRestoringRef = useRef(project.initialized);
  const onProjectReadyRef = useRef(onProjectReady);
  const cloudRef = useRef({ cloudSnapshotEnabled, onCloudSnapshot, onCloudSnapshotError, restoreFirstBoot });
  cloudRef.current = { cloudSnapshotEnabled, onCloudSnapshot, onCloudSnapshotError, restoreFirstBoot };
  const thumbnailCaptureRef = useRef<Promise<void> | null>(null);
  currentProjectRef.current = project;
  onProjectReadyRef.current = onProjectReady;
  const [stage, setStage] = useState<RuntimeStage>('runtime');
  const [detail, setDetail] = useState(t('Iniciando o ambiente seguro'));
  const [error, setError] = useState('');
  const [runtimeKey, setRuntimeKey] = useState(0);
  const [lockKey, setLockKey] = useState(0);
  const [lockState, setLockState] = useState<'waiting' | 'acquired' | 'denied'>('waiting');
  const [currentPath, setCurrentPath] = useState('/kodety/editor/');
  const [transferOpen, setTransferOpen] = useState(false);
  const [securityFolderOpen, setSecurityFolderOpen] = useState(false);
  const [exitProjectOpen, setExitProjectOpen] = useState(false);
  const [securityDirectoryStatus, setSecurityDirectoryStatus] = useState<SecurityDirectoryStatus>(emptySecurityDirectoryStatus);
  const [directoryBootState, setDirectoryBootState] = useState<'checking' | 'required' | 'allowed'>(requireSecurityDirectory ? 'checking' : 'allowed');
  const [backupProgress, setBackupProgress] = useState<BackupProgress>('idle');
  const [backupError, setBackupError] = useState('');
  const [backupReady, setBackupReady] = useState(false);
  const [zipBackupBusy, setZipBackupBusy] = useState(false);
  const [zipBackupError, setZipBackupError] = useState('');
  const workspaceNotifications = useMemo(() => ({
    active: true,
    ids: { zip: `wordpress:${project.id}:zip`, folder: `wordpress:${project.id}:folder`, offline: `wordpress:${project.id}:offline` },
    folderState: '',
    offlineState: '',
    offlineFailed: false,
  }), [project.id]);
  useEffect(() => {
    workspaceNotifications.active = true;
    return () => {
      workspaceNotifications.active = false;
      Object.values(workspaceNotifications.ids).forEach(id => toast.dismiss(id));
    };
  }, [workspaceNotifications]);
  const [lastZipBackup, setLastZipBackup] = useState<{ projectId: string; createdAt: number } | null>(null);
  const zipBackupPromiseRef = useRef<Promise<void> | null>(null);
  // OPFS persistence and a user-generated ZIP are separate checkpoints. This
  // object is read synchronously by beforeunload, including before React paints.
  const manualBackupRevisions = useMemo(() => ({ current: 0, exported: -1, hasChangeSignals: false, pendingAdminDraftSources: new Set<MessageEventSource>() }), [project.id]);
  const [manualBackupPending, setManualBackupPending] = useState(true);
  const markManualBackupChange = useCallback(() => {
    if (!manualBackup) return;
    manualBackupRevisions.current += 1;
    setManualBackupPending(true);
  }, [manualBackup, manualBackupRevisions]);
  useEffect(() => {
    if (!manualBackup) return;
    manualBackupRevisions.exported = -1;
    setManualBackupPending(true);
  }, [manualBackup, manualBackupRevisions]);
  const lastZipBackupAt = lastZipBackup?.projectId === project.id ? lastZipBackup.createdAt : null;
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [offlineRuntimeStatus, setOfflineRuntimeStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [offlineRuntimeError, setOfflineRuntimeError] = useState('');
  const [storagePersistence, setStoragePersistence] = useState<StoragePersistenceStatus>('checking');
  const securityDirectoryStatusRef = useRef(securityDirectoryStatus);
  securityDirectoryStatusRef.current = securityDirectoryStatus;
  const backupScheduler = useMemo(() => createBackupScheduler({
    save: async () => {
      const client = clientRef.current;
      if (!client) throw new Error(t('O projeto ainda não terminou de abrir.'));
      const result = await saveProjectSnapshot(client, currentProjectRef.current, { requireProjectDirectory: requireSecurityDirectory });
      setSecurityDirectoryStatus(current => ({
        ...current,
        connected: true,
        needsPermission: false,
        directoryName: result.directoryName.split('/')[0] || current.directoryName,
        lastBackupAt: result.createdAt,
      }));
      setBackupReady(true);
      return result;
    },
    onProgress: (progress, reason) => {
      setBackupProgress(progress);
      if (progress === 'saved' || progress === 'saving' || progress === 'pending') setBackupError('');
      if (progress === 'error') {
        setBackupError(reason instanceof Error ? reason.message : t('Não foi possível atualizar a pasta de segurança.'));
        void getSecurityDirectoryStatus(project.id, { requireProjectDirectory: requireSecurityDirectory })
          .then(setSecurityDirectoryStatus)
          .catch(() => undefined);
      }
    },
  }), [project.id, requireSecurityDirectory]);

  useEffect(() => () => backupScheduler.dispose(), [backupScheduler]);
  const cloudScheduler = useMemo(() => createBackupScheduler({
    save: async () => {
      const cloud = cloudRef.current;
      const client = clientRef.current;
      if (!cloud.cloudSnapshotEnabled || !cloud.onCloudSnapshot || !client) return;
      const snapshot = await captureProjectSnapshot(client, currentProjectRef.current);
      await cloud.onCloudSnapshot(currentProjectRef.current, snapshot);
    },
    onProgress: (progress, reason) => { if (progress === 'error') cloudRef.current.onCloudSnapshotError?.(reason); },
  }), [project.id]);
  useEffect(() => () => cloudScheduler.dispose(), [cloudScheduler]);


  useEffect(() => {
    const watchManualBackup = manualBackup && stage === 'ready';
    if (!watchManualBackup && !zipBackupBusy && backupProgress !== 'pending' && backupProgress !== 'saving') return;
    const warnWhileWriting = (event: BeforeUnloadEvent) => {
      const manualZipMissing = watchManualBackup && manualBackupRevisions.current > manualBackupRevisions.exported;
      if (!manualZipMissing && !zipBackupPromiseRef.current && backupProgress !== 'pending' && backupProgress !== 'saving') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnWhileWriting);
    return () => window.removeEventListener('beforeunload', warnWhileWriting);
  }, [backupProgress, zipBackupBusy, manualBackup, stage, manualBackupRevisions]);

  const openSitePreview = () => {
    const studioPreviewUrl = studioSitePreviewUrl(project, language);
    if (studioPreviewUrl) {
      window.open(studioPreviewUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    // The extension build cannot use the web app's Service Worker proxy. Keep
    // its best-effort direct Playground fallback isolated from the web flow.
    const previewWindow = window.open('about:blank', '_blank');
    const client = clientRef.current;
    if (!previewWindow || !client) {
      previewWindow?.close();
      return;
    }
    previewWindow.opener = null;
    void client.getCurrentURL()
      .then(url => previewWindow.location.replace(playgroundSiteUrl(url)))
      .catch(() => previewWindow.close());
  };

  useEffect(() => {
    if (manualBackup) {
      setSecurityDirectoryStatus({ ...emptySecurityDirectoryStatus, connected: false });
      setDirectoryBootState('allowed');
      return;
    }
    let disposed = false;
    void getSecurityDirectoryStatus(project.id, { requireProjectDirectory: requireSecurityDirectory })
      .then(status => {
        if (!disposed) {
          setSecurityDirectoryStatus(status);
          setDirectoryBootState(!requireSecurityDirectory || status.connected ? 'allowed' : 'required');
        }
      })
      .catch(reason => {
        if (!disposed) {
          setDirectoryBootState(requireSecurityDirectory ? 'required' : 'allowed');
          setBackupError(reason instanceof Error ? reason.message : t('Não foi possível verificar a pasta de segurança.'));
        }
      });
    return () => {
      disposed = true;
    };
  }, [project.id, requireSecurityDirectory, manualBackup]);

  useEffect(() => {
    const handlePreviewRequest = (event: MessageEvent) => {
      const client = clientRef.current;
      if (!client) return;
      void respondToStudioPreviewRequest(event, client, project.id);
    };
    const channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(studioPreviewChannelName(project.id));
    const handleBroadcastRequest = (event: MessageEvent) => {
      const client = clientRef.current;
      if (!client || !channel) return;
      void respondToStudioPreviewRequest(event, client, project.id, channel);
    };
    channel?.addEventListener('message', handleBroadcastRequest);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', handlePreviewRequest);
    return () => {
      channel?.removeEventListener('message', handleBroadcastRequest);
      channel?.close();
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', handlePreviewRequest);
    };
  }, [project.id]);

  const agentNetwork = useMemo(createStudioAgentNetworkBridge, [project.id]);
  useEffect(() => () => agentNetwork.dispose(), [agentNetwork]);
  useEffect(() => {
    const capturePublishedThumbnail = () => {
      const client = clientRef.current;
      if (!client || thumbnailCaptureRef.current) return;
      const operation = new Promise<void>(resolve => window.setTimeout(resolve, 450))
        .then(() => client.captureSiteThumbnail())
        .then(async thumbnail => {
          if (
            !/^image\/(?:png|jpe?g|webp|avif)$/i.test(thumbnail.mime)
            || !/^[a-z0-9+/=]+$/i.test(thumbnail.data)
            || thumbnail.data.length > 1_100_000
          ) return;
          const latest = currentProjectRef.current;
          await onProjectReadyRef.current({
            ...latest,
            thumbnailDataUrl: `data:${thumbnail.mime};base64,${thumbnail.data}`,
            thumbnailUpdatedAt: Date.now(),
            updatedAt: Date.now(),
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (thumbnailCaptureRef.current === operation) thumbnailCaptureRef.current = null;
        });
      thumbnailCaptureRef.current = operation;
    };
    const handleRuntimeMessage = (event: MessageEvent) => {
      if (event.origin !== PLAYGROUND_REMOTE_ORIGIN) return;
      if (!isProjectRuntimeMessageSource(event.source, iframeRef.current?.contentWindow || null)) return;
      const message = event.data as {
        source?: string;
        version?: number;
        type?: string;
        projectId?: string;
        surface?: string;
        path?: string;
        status?: string;
        message?: string;
        pendingAdminDraft?: boolean;
      } | null;
      if (
        !message
        || message.source !== 'kodety-studio-wordpress'
        || message.version !== 1
        || message.projectId !== project.id
      ) return;
      if (message.type === 'agent-network') { agentNetwork.receive(event); return; }
      if (message.type === 'admin-document-ready') {
        // The replacement must belong to the same frame as the edited form.
        // Reloading a nested site preview cannot acknowledge an admin draft.
        if (event.source) manualBackupRevisions.pendingAdminDraftSources.delete(event.source);
        return;
      }
      if (message.type === 'storage-persistence' && message.status && message.status in storagePersistencePriority) {
        setStoragePersistence(current => strongerStoragePersistenceStatus(current, message.status as StoragePersistenceStatus));
        return;
      }
      if (message.type === 'offline-cache' && ['ready', 'error'].includes(message.status || '')) {
        const status = message.status as 'ready' | 'error';
        setOfflineRuntimeStatus(status);
        setOfflineRuntimeError(status === 'error' ? message.message || t('Não foi possível preparar o WordPress offline.') : '');
        window.dispatchEvent(new CustomEvent('kodety-studio:wordpress-offline', { detail: { projectId: project.id, status } }));
        return;
      }
      if (message.type === 'bridge-ready' && event.source) {
        studioBridgeWindowRef.current = event.source as Window;
        studioBridgeReadyRef.current = true;
        studioBridgeWaitersRef.current.forEach(resolve => resolve());
        studioBridgeWaitersRef.current.clear();
        return;
      }
      if (message.type === 'project-published') {
        if (cloudRef.current.cloudSnapshotEnabled) cloudScheduler.schedule();
        markManualBackupChange();
        capturePublishedThumbnail();
        if (!manualBackup && (requireSecurityDirectory || securityDirectoryStatusRef.current.connected)) backupScheduler.schedule();
        return;
      }
      if (message.type === 'project-saved') {
        if (cloudRef.current.cloudSnapshotEnabled) cloudScheduler.schedule();
        // Older Builder bundles only announce completed saves. New bundles
        // announce edits before autosave; a delayed save acknowledgement must
        // neither clear their warning nor invalidate an already current ZIP.
        if (!manualBackupRevisions.hasChangeSignals) markManualBackupChange();
        if (!manualBackup && (requireSecurityDirectory || securityDirectoryStatusRef.current.connected)) backupScheduler.schedule();
        return;
      }
      if (message.type === 'project-changed') {
        manualBackupRevisions.hasChangeSignals = true;
        if (message.pendingAdminDraft === true && event.source) manualBackupRevisions.pendingAdminDraftSources.add(event.source);
        markManualBackupChange();
        return;
      }
      if (message.type === 'navigate' && message.surface === 'site' && message.path === '/') {
        openSitePreview();
      }
    };
    window.addEventListener('message', handleRuntimeMessage);
    return () => {
      window.removeEventListener('message', handleRuntimeMessage);
      studioBridgeWindowRef.current = null;
      studioBridgeReadyRef.current = false;
      studioBridgeWaitersRef.current.clear();
    };
  }, [project.id, agentNetwork, backupScheduler, requireSecurityDirectory, manualBackup, manualBackupRevisions, markManualBackupChange]);

  useEffect(() => {
    let disposed = false;
    let releaseLock: () => void = () => {};
    const holdLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    setLockState('waiting');
    setStage('runtime');
    setDetail(t('Reservando o armazenamento deste projeto'));
    setError('');

    void navigator.locks.request(
      projectLockName(project.id),
      { mode: 'exclusive', ifAvailable: true },
      async lock => {
        if (!lock) {
          if (!disposed) {
            setLockState('denied');
            setError(t('Este projeto já está aberto em outra aba do Onun Kodety. Feche a outra aba e tente novamente.'));
          }
          return;
        }

        if (disposed) return;
        setLockState('acquired');
        await holdLock;
      },
    ).catch(reason => {
      if (!disposed) {
        setLockState('denied');
        setError(reason instanceof Error ? reason.message : t('Não foi possível reservar este projeto para edição.'));
      }
    });

    return () => {
      disposed = true;
      releaseLock();
    };
  }, [project.id, lockKey]);

  useEffect(() => {
    if (lockState !== 'acquired' || directoryBootState !== 'allowed') return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    clientRef.current = null;
    // Replacing the complete runtime discards its old documents; opening the
    // replacement still marks the project as needing a fresh ZIP below.
    manualBackupRevisions.pendingAdminDraftSources.clear();
    const controller = new AbortController();
    const startupTimeout = window.setTimeout(() => {
      if (disposed || clientRef.current) return;
      controller.abort();
      iframe.src = 'about:blank';
      setError(t('O ambiente demorou para responder. Verifique sua conexão e tente novamente.'));
    }, 180_000);
    setStage('runtime');
    setDetail(t('Iniciando o ambiente seguro'));
    setError('');
    setStoragePersistence('checking');
    setOfflineRuntimeStatus('checking');
    setOfflineRuntimeError('');

    void bootProject({
      iframe,
      project: persistedProjectRef.current?.id === project.id ? { ...project, initialized: true } : project,
      language,
      prepareOffline: protectWorkspaceDraft,
      restoreFirstBoot: client => cloudRef.current.restoreFirstBoot?.(client) || Promise.resolve(),
      signal: controller.signal,
      onPersisted: async persistedProject => {
        if (!disposed && !controller.signal.aborted) {
          persistedProjectRef.current = persistedProject;
          currentProjectRef.current = persistedProject;
          await onProjectReadyRef.current(persistedProject);
        }
      },
      onStage: (nextStage, nextDetail) => {
        if (disposed || controller.signal.aborted) return;
        setStage(nextStage);
        if (nextDetail) setDetail(nextDetail);
      },
    }).then(async result => {
      window.clearTimeout(startupTimeout);
      if (disposed || controller.signal.aborted) return;
      clientRef.current = result.client;
      await result.client.onNavigation(url => {
        try {
          const nextPath = new URL(url).pathname;
          setCurrentPath(nextPath);
          if (!nextPath.startsWith('/kodety')) {
            // WordPress administration can persist changes through ordinary
            // form navigation without a Builder autosave notification.
            markManualBackupChange();
            if (cloudRef.current.cloudSnapshotEnabled) cloudScheduler.schedule();
            studioBridgeWindowRef.current = null;
            studioBridgeReadyRef.current = false;
          }
        } catch {
          setCurrentPath(url);
        }
      });
      const readyProject = result.initializedNow
        ? { ...project, ...result.runtimeVersions, runtimeRevision: result.runtimeRevision, initialized: true, updatedAt: Date.now(), lastOpenedAt: Date.now() }
        : { ...project, ...result.runtimeVersions, runtimeRevision: result.runtimeRevision, lastOpenedAt: Date.now() };
      currentProjectRef.current = readyProject;
      await onProjectReadyRef.current(readyProject);
      if (disposed) return;
      markManualBackupChange();
      if (!manualBackup && (requireSecurityDirectory || securityDirectoryStatusRef.current.connected)) {
        setDetail(t('Criando a cópia inicial na pasta de segurança'));
        await backupScheduler.flush().catch(() => undefined);
        if (disposed) return;
      }
      setStage('ready');
      setDetail(t('Projeto pronto'));
      if (cloudRef.current.cloudSnapshotEnabled) cloudScheduler.schedule();
    }).catch(reason => {
      window.clearTimeout(startupTimeout);
      if (!disposed && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : t('Não foi possível abrir este projeto.'));
    });

    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void flushProject(clientRef.current).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(startupTimeout);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      void flushProject(clientRef.current).catch(() => undefined);
      clientRef.current = null;
      iframe.src = 'about:blank';
    };
  }, [project.id, runtimeKey, lockState, directoryBootState, backupScheduler, requireSecurityDirectory, manualBackup, protectWorkspaceDraft, markManualBackupChange]);

  useEffect(() => {
    if (stage !== 'ready' || !clientRef.current) return;
    return connectStudioMcpRelay(clientRef.current, project.id);
  }, [project.id, runtimeKey, stage]);

  const flushBuilderDraft = async () => {
    const bridgeWindow = studioBridgeWindowRef.current;
    if (!bridgeWindow || !studioBridgeReadyRef.current || !currentPath.startsWith('/kodety/editor')) return;
    const channel = new MessageChannel();
    const requestId = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        channel.port1.close();
        reject(new Error(t('O Builder não confirmou o salvamento. Aguarde o salvamento automático e tente novamente.')));
      }, 90_000);
      channel.port1.onmessage = (event: MessageEvent) => {
        const message = event.data as { type?: string; requestId?: string; message?: string } | null;
        if (!message || message.requestId !== requestId || !['done', 'error'].includes(message.type || '')) return;
        window.clearTimeout(timer);
        channel.port1.close();
        if (message.type === 'done') resolve();
        else reject(new Error(message.message || t('O Builder não confirmou o salvamento.')));
      };
      channel.port1.start();
      bridgeWindow.postMessage({
        source: 'kodety-studio', version: 1, type: 'project-save.request', projectId: project.id, requestId,
      }, PLAYGROUND_REMOTE_ORIGIN, [channel.port2]);
    });
  };

  const assertAdminDraftSaved = () => {
    if (manualBackup && manualBackupRevisions.pendingAdminDraftSources.size > 0) {
      throw new Error(t('Salve as alterações no WordPress antes de baixar o backup. Se a tela salva sem recarregar, recarregue a página depois de salvar.'));
    }
  };

  const finishLeavingWorkspace = async (allowBackupFailure = false, flushDraft = true, requireCurrentManualZip = false) => {
    if (protectWorkspaceDraft && flushDraft) await flushBuilderDraft();
    await zipBackupPromiseRef.current?.catch(reason => { if (!allowBackupFailure) throw reason; });
    await backupScheduler.finish().catch(reason => {
      if (!allowBackupFailure) throw reason;
    });
    await flushProject(clientRef.current);
    // Capture the final persisted database even when a native WordPress admin
    // screen saved without a Builder autosave message. Cloud failure cannot
    // undo the local save or prevent returning to the library.
    if (cloudRef.current.cloudSnapshotEnabled) await cloudScheduler.flush().catch(() => undefined);
    if (requireCurrentManualZip) assertAdminDraftSaved();
    if (requireCurrentManualZip && manualBackup && manualBackupRevisions.current > manualBackupRevisions.exported) {
      throw new Error(t('O projeto mudou enquanto o ZIP era gerado. Baixe um novo ZIP antes de sair.'));
    }
    onBack();
  };

  const openExitProject = () => {
    if (!clientRef.current || stage !== 'ready') {
      void finishLeavingWorkspace().catch(reason => setError(reason instanceof Error ? reason.message : t('Não foi possível salvar o projeto. Tente novamente.')));
      return;
    }
    setExitProjectOpen(true);
  };

  const connectBackupFolder = async (): Promise<SecurityDirectoryStatus> => {
    const status = await connectSecurityDirectory(project.id);
    setSecurityDirectoryStatus(status);
    setBackupReady(false);
    setDirectoryBootState('allowed');
    return status;
  };

  const requestBackupFolderAccess = async (): Promise<SecurityDirectoryStatus> => {
    const status = await requestSecurityDirectoryAccess(project.id, { requireProjectDirectory: requireSecurityDirectory });
    setSecurityDirectoryStatus(status);
    if (status.connected) setDirectoryBootState('allowed');
    return status;
  };

  const saveBackupToFolder = async (): Promise<ProjectBackupResult> => {
    if (protectWorkspaceDraft) await flushBuilderDraft();
    return backupScheduler.flush();
  };

  const prepareRequiredDirectory = async (action: 'connect' | 'permission' | 'retry') => {
    setDirectoryBusy(true);
    setBackupError('');
    try {
      if (action === 'connect') await connectBackupFolder();
      if (action === 'permission') {
        const status = await requestBackupFolderAccess();
        if (!status.connected) throw new Error(t('O navegador não permitiu gravar na pasta de segurança.'));
      }
      if (clientRef.current) await saveBackupToFolder();
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setBackupError(reason instanceof Error ? reason.message : t('Não foi possível conectar a pasta de segurança.'));
      }
    } finally {
      setDirectoryBusy(false);
    }
  };

  const downloadBackup = (): Promise<void> => {
    if (zipBackupPromiseRef.current) return zipBackupPromiseRef.current;
    setZipBackupBusy(true);
    setZipBackupError('');
    const toastOptions = { id: workspaceNotifications.ids.zip, toasterId: WORDPRESS_TOASTER_ID, action: undefined, description: undefined };
    if (workspaceNotifications.active) toast.loading(t('Preparando backup…'), toastOptions);
    const operation = (async () => {
      try {
        const client = clientRef.current;
        if (!client) throw new Error(t('O projeto ainda não terminou de abrir.'));
        assertAdminDraftSaved();
        if (protectWorkspaceDraft) await flushBuilderDraft();
        // ZIP remains available if a folder write failed, but does not export
        // the same WordPress while an earlier snapshot is still being made.
        await backupScheduler.finish().catch(() => undefined);
        assertAdminDraftSaved();
        const exportedRevision = manualBackupRevisions.current;
        const result = await downloadProjectSnapshot(client, currentProjectRef.current);
        manualBackupRevisions.exported = exportedRevision;
        setManualBackupPending(manualBackupRevisions.current > exportedRevision);
        setLastZipBackup({ projectId: project.id, createdAt: result.createdAt });
        if (workspaceNotifications.active) {
          if (manualBackup && manualBackupRevisions.current > exportedRevision) {
            toast.warning(t('ZIP gerado. Há alterações mais recentes.'), {
              ...toastOptions,
              duration: 8000,
              action: { label: t('Baixar novo ZIP'), onClick: event => {
                event.preventDefault();
                void downloadBackup().catch(() => undefined);
              } },
            });
          } else toast.success(t('Backup ZIP gerado'), {
            ...toastOptions,
            description: t('Confira o arquivo na pasta de downloads.'),
            duration: 3200,
          });
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : t('Não foi possível criar o backup local.');
        setZipBackupError(message);
        if (workspaceNotifications.active) toast.error(t(message), {
          ...toastOptions,
          duration: 8000,
          action: { label: t('Tentar novamente'), onClick: event => {
            // Sonner otherwise dismisses the same toast just updated to loading.
            event.preventDefault();
            void downloadBackup().catch(() => undefined);
          } },
        });
        throw reason;
      } finally {
        setZipBackupBusy(false);
      }
    })();
    zipBackupPromiseRef.current = operation;
    void operation.finally(() => { if (zipBackupPromiseRef.current === operation) zipBackupPromiseRef.current = null; }).catch(() => undefined);
    return operation;
  };

  const saveBackupAndExit = async () => {
    await saveBackupToFolder();
    await finishLeavingWorkspace(false, false);
  };

  const downloadBackupAndExit = async () => {
    await downloadBackup();
    await finishLeavingWorkspace(true, false, true);
  };

  const reloadRuntime = async () => {
    try {
      if (protectWorkspaceDraft) await flushBuilderDraft();
      await zipBackupPromiseRef.current;
      await backupScheduler.finish();
      await flushProject(clientRef.current);
      setRuntimeKey(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Não foi possível salvar o projeto. Tente novamente.'));
    }
  };

  const retryRuntime = async () => {
    if (lockState === 'denied') {
      setLockKey(value => value + 1);
      return;
    }
    await reloadRuntime();
  };

  const waitForStudioBridge = async (): Promise<Window> => {
    if (studioBridgeReadyRef.current && studioBridgeWindowRef.current) return studioBridgeWindowRef.current;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        studioBridgeWaitersRef.current.delete(done);
        resolve();
      };
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        studioBridgeWaitersRef.current.delete(done);
        reject(new Error(t('O projeto ainda não terminou de abrir.')));
      }, 20_000);
      studioBridgeWaitersRef.current.add(done);
    });
    if (!studioBridgeWindowRef.current) throw new Error(t('O projeto ainda não terminou de abrir.'));
    return studioBridgeWindowRef.current;
  };

  const transferProject = async () => {
    if (!clientRef.current) throw new Error(t('O projeto ainda não terminou de abrir.'));
    if (!currentPath.startsWith('/kodety/editor') || !studioBridgeReadyRef.current) {
      studioBridgeReadyRef.current = false;
      studioBridgeWindowRef.current = null;
      await navigateProject(clientRef.current, '/kodety/editor/');
    }
    const bridgeWindow = await waitForStudioBridge();
    const channel = new MessageChannel();
    const requestId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        channel.port1.close();
        reject(new Error(t('Não foi possível preparar o ZIP de transferência.')));
      }, 180_000);
      channel.port1.onmessage = (event: MessageEvent) => {
        const message = event.data as { type?: string; requestId?: string; message?: string } | null;
        if (!message || message.requestId !== requestId) return;
        if (message.type === 'done') {
          window.clearTimeout(timer);
          channel.port1.close();
          resolve();
        } else if (message.type === 'error') {
          window.clearTimeout(timer);
          channel.port1.close();
          reject(new Error(message.message || t('Não foi possível preparar o ZIP de transferência.')));
        }
      };
      channel.port1.start();
      bridgeWindow.postMessage({
        source: 'kodety-studio',
        version: 1,
        type: 'project-export.request',
        projectId: project.id,
        requestId,
      }, PLAYGROUND_REMOTE_ORIGIN, [channel.port2]);
    });
  };

  const navigate = (path: string) => void navigateProject(clientRef.current, path).catch(reason => {
    setError(reason instanceof Error ? reason.message : t('Não foi possível abrir este projeto.'));
  });
  const directoryGate = requireSecurityDirectory && (
    directoryBootState !== 'allowed'
    || (stage === 'ready' && (!securityDirectoryStatus.connected || !backupReady))
  );
  const ready = stage === 'ready' && !error && !directoryGate;
  const activeArea = currentPath.startsWith('/wp-admin') ? 'wordpress' : currentPath.startsWith('/kodety') ? 'builder' : 'site';
  const persistenceRejected = storagePersistence === 'denied' || storagePersistence === 'unsupported';
  const persistenceLabel = storagePersistence === 'granted'
    ? t('Proteção local ativa')
    : persistenceRejected
      ? t('Proteção automática não concedida')
      : t('Salvo no navegador');
  const persistenceTooltip = storagePersistence === 'granted'
    ? t('O navegador protege este WordPress contra remoção automática por falta de espaço.')
    : persistenceRejected
      ? manualBackup
        ? t('O navegador não concedeu persistência automática. Baixe um backup ZIP para manter uma cópia fora dele.')
        : t('O navegador não concedeu persistência automática. Use a pasta de segurança para manter uma cópia fora dele.')
      : t('Clique dentro do WordPress para solicitar proteção contra remoção automática por falta de espaço.');
  const safetyCopyCurrent = securityDirectoryStatus.connected && backupReady && backupProgress === 'saved' && !backupError;
  const securityFolderLabel = backupError
    ? t('Backup precisa de atenção')
    : backupProgress === 'saving'
      ? t('Atualizando pasta…')
      : backupProgress === 'pending'
        ? t('Backup pendente…')
        : safetyCopyCurrent
          ? t('Pasta atualizada')
          : t('Pasta de segurança');
  const offlineLabel = offlineRuntimeStatus === 'ready' ? t('WordPress disponível offline') : offlineRuntimeStatus === 'error' ? t('WordPress offline precisa de atenção') : t('Preparando WordPress offline…');
  const workspaceStatusTooltip = [persistenceLabel, persistenceTooltip, protectWorkspaceDraft ? offlineLabel : ''].filter(Boolean).join('\n');

  useEffect(() => {
    const state = `${backupProgress}:${backupError}:${directoryGate}`;
    if (workspaceNotifications.folderState === state) return;
    workspaceNotifications.folderState = state;
    if (!workspaceNotifications.active || manualBackup) return;
    const options = { id: workspaceNotifications.ids.folder, toasterId: WORDPRESS_TOASTER_ID };
    if (backupError) {
      if (!directoryGate) toast.error(t('A cópia na pasta de segurança não está atualizada.'), {
        ...options,
        duration: 8000,
        action: { label: t('Revisar pasta'), onClick: event => {
          event.preventDefault();
          setSecurityFolderOpen(true);
        } },
      });
      else toast.dismiss(options.id);
    } else if (backupProgress === 'pending' || backupProgress === 'saving') {
      toast.loading(backupProgress === 'pending' ? t('Backup pendente…') : t('Atualizando pasta…'), { ...options, action: undefined });
    } else if (backupProgress === 'saved') {
      toast.success(t('Pasta atualizada'), { ...options, action: undefined, duration: 3200 });
    }
  }, [backupProgress, backupError, directoryGate, manualBackup, workspaceNotifications, t]);

  useEffect(() => {
    const state = `${offlineRuntimeStatus}:${offlineRuntimeError}`;
    if (workspaceNotifications.offlineState === state) return;
    workspaceNotifications.offlineState = state;
    if (!workspaceNotifications.active || !protectWorkspaceDraft) return;
    const options = { id: workspaceNotifications.ids.offline, toasterId: WORDPRESS_TOASTER_ID };
    if (offlineRuntimeStatus === 'error') {
      workspaceNotifications.offlineFailed = true;
      toast.warning(t('WordPress offline precisa de atenção'), {
        ...options,
        duration: 8000,
        action: { label: t('Revisar'), onClick: event => {
          event.preventDefault();
          setSecurityFolderOpen(true);
        } },
      });
    } else if (workspaceNotifications.offlineFailed && offlineRuntimeStatus === 'ready') {
      workspaceNotifications.offlineFailed = false;
      toast.success(t('WordPress disponível offline'), { ...options, action: undefined, duration: 3200 });
    } else if (workspaceNotifications.offlineFailed && offlineRuntimeStatus === 'checking') {
      toast.loading(t('Preparando WordPress offline…'), { ...options, action: undefined });
    }
  }, [offlineRuntimeStatus, offlineRuntimeError, protectWorkspaceDraft, workspaceNotifications, t]);

  return (
    <>
    <Toaster {...TOAST_PROPS} id={WORDPRESS_TOASTER_ID} containerAriaLabel={t('Notificações do WordPress')} />
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <IconButton label={t('Voltar aos projetos')} className="workspace-back" onClick={openExitProject}>
          <AltArrowLeftIcon />
        </IconButton>
        <div className="workspace-brand"><BrandMark /></div>
        <div className="workspace-project-title">
          <strong>{project.name}</strong>
          <span title={ready ? workspaceStatusTooltip : undefined}>
            <i className={ready ? 'is-ready' : error ? 'is-error' : ''} /> {ready ? t('WordPress no navegador') : error ? t('Falha ao iniciar') : detail}
          </span>
        </div>

        <nav className="workspace-nav" aria-label={t('Navegação do projeto')}>
          <button type="button" title={t('Abrir o Builder')} className={activeArea === 'builder' ? 'is-active' : ''} onClick={() => navigate('/kodety/editor/')} disabled={!ready}>
            <Widget5Icon /> Builder
          </button>
          <button type="button" title={t('Abrir a visualização local do site em uma nova guia')} onClick={openSitePreview} disabled={!ready}>
            <GlobalIcon /> Site <StrokeArrowUpRightIcon className="workspace-nav-external" />
          </button>
          <button type="button" title={t('Abrir o painel do WordPress')} className={activeArea === 'wordpress' ? 'is-active' : ''} onClick={() => navigate('/wp-admin/')} disabled={!ready}>
            <SettingsMinimalisticIcon /> WordPress
          </button>
        </nav>

        <div className="workspace-actions">
          <IconButton label={t('Reiniciar o WordPress local')} onClick={() => void reloadRuntime()} disabled={!ready && !error}>
            <StrokeRefreshIcon />
          </IconButton>
          <button
            type="button"
            className={safetyCopyCurrent ? 'toolbar-button security-folder-toolbar-button is-connected' : 'toolbar-button security-folder-toolbar-button'}
            title={manualBackup ? t('Último ZIP gerado: {date}', { date: formatBackupDate(lastZipBackupAt, language, t('ainda não criado')) }) : backupError || t('Último backup: {date}', { date: formatBackupDate(securityDirectoryStatus.lastBackupAt, language, t('ainda não criado')) })}
            onClick={() => manualBackup ? void downloadBackup().catch(() => undefined) : setSecurityFolderOpen(true)}
            disabled={!ready || zipBackupBusy}
          >
            {manualBackup ? <DownloadMinimalisticIcon /> : <FolderSecurityIcon />} {manualBackup ? zipBackupBusy ? t('Preparando backup…') : t('Baixar backup ZIP') : securityFolderLabel}
          </button>
          {manualBackup && <IconButton label={t('Opções de backup')} onClick={() => setSecurityFolderOpen(true)} disabled={!ready || zipBackupBusy}><FolderSecurityIcon /></IconButton>}
          <button
            type="button"
            className="toolbar-button transfer-toolbar-button"
            title={t('Baixar o ZIP para levar este projeto à hospedagem')}
            onClick={() => setTransferOpen(true)}
            disabled={!ready}
          >
            <DownloadMinimalisticIcon /> {t('Transferir para hospedagem')}
          </button>
        </div>
      </header>

      <main className="workspace-main">
        <iframe
          key={runtimeKey}
          ref={iframeRef}
          className={ready ? 'playground-frame is-ready' : 'playground-frame'}
          title={t('WordPress local — {name}', { name: project.name })}
          allow="clipboard-read *; clipboard-write *; cross-origin-isolated *"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
        />
          {!ready && !error && !directoryGate && <RuntimeLoading stage={stage} detail={detail} restoring={initialRestoringRef.current} />}
        {directoryGate && !error && (
          <div className="runtime-error workspace-directory-gate">
            <div className="runtime-error-icon"><FolderSecurityIcon /></div>
            <h2>{t('Este projeto precisa de uma pasta de segurança')}</h2>
            <p>{t('Selecione uma pasta deste computador. O salvamento automático do Builder atualizará a cópia do WordPress nela.')}</p>
            {directoryBootState === 'checking' ? <p role="status">{t('Verificando acesso à pasta…')}</p> : (
              <>
                {securityDirectoryStatus.directoryName && <p><strong>{securityDirectoryStatus.directoryName}</strong></p>}
                {!securityDirectoryStatus.supported && <p>{t('A seleção de pastas não está disponível. Volte aos projetos e escolha continuar com backups manuais em ZIP.')}</p>}
                {backupError && <p role="alert" className="security-folder-error">{backupError}</p>}
                <div>
                  <button type="button" className="secondary-button" onClick={() => void finishLeavingWorkspace(true).catch(reason => setBackupError(String(reason)))} disabled={directoryBusy}>{t('Voltar')}</button>
                  {securityDirectoryStatus.supported && <button type="button" className="primary-button" onClick={() => void prepareRequiredDirectory('connect')} disabled={directoryBusy}>{directoryBusy ? t('Preparando pasta…') : t('Selecionar pasta')}</button>}
                  {securityDirectoryStatus.needsPermission && <button type="button" className="primary-button" onClick={() => void prepareRequiredDirectory('permission')} disabled={directoryBusy}>{t('Autorizar acesso')}</button>}
                  {stage === 'ready' && securityDirectoryStatus.connected && <button type="button" className="primary-button" onClick={() => void prepareRequiredDirectory('retry')} disabled={directoryBusy}>{t('Tentar backup novamente')}</button>}
                </div>
              </>
            )}
          </div>
        )}
        {error && (
          <div className="runtime-error">
            <div className="runtime-error-icon"><DangerTriangleIcon /></div>
            <h2>{t('Não foi possível abrir o projeto')}</h2>
            <p>{error}</p>
            <div>
              <button type="button" className="secondary-button" onClick={() => void finishLeavingWorkspace().catch(reason => setError(reason instanceof Error ? reason.message : t('Não foi possível salvar o projeto. Tente novamente.')))}>{t('Voltar')}</button>
              <button type="button" className="primary-button" onClick={() => void retryRuntime()}><StrokeRefreshIcon /> {t('Tentar novamente')}</button>
            </div>
          </div>
        )}
      </main>
    </div>
    {transferOpen && (
      <TransferProjectDialog
        project={project}
        onClose={() => setTransferOpen(false)}
        onTransfer={transferProject}
      />
    )}
    {securityFolderOpen && (
      <SecurityFolderDialog
        project={project}
        status={securityDirectoryStatus}
        manualBackup={manualBackup}
        lastZipBackupAt={lastZipBackupAt}
        backupFailure={zipBackupError || backupError}
        storageProtection={{ label: persistenceLabel, description: persistenceTooltip }}
        offlineReadiness={protectWorkspaceDraft ? { label: offlineLabel, error: offlineRuntimeError, retry: () => void reloadRuntime() } : undefined}
        onClose={() => setSecurityFolderOpen(false)}
        onConnect={connectBackupFolder}
        onRequestAccess={requestBackupFolderAccess}
        onSave={saveBackupToFolder}
        onDownload={downloadBackup}
      />
    )}
    {exitProjectOpen && (
      <ExitProjectDialog
        project={project}
        securityStatus={securityDirectoryStatus}
        manualBackup={manualBackup}
        manualBackupPending={manualBackupPending}
        onClose={() => setExitProjectOpen(false)}
        onOpenSecurityFolder={() => {
          setExitProjectOpen(false);
          setSecurityFolderOpen(true);
        }}
        onSaveAndExit={saveBackupAndExit}
        onDownloadAndExit={downloadBackupAndExit}
        onExitWithoutBackup={() => finishLeavingWorkspace(true)}
      />
    )}
    </>
  );
}

function StudioApp() {
  const [preferences, setPreferences] = useState<KodetyStudioPreferences>(() => loadStudioPreferences());
  const [projects, setProjects] = useState<KodetyStudioProject[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [view, setView] = useState<AppView>('projects');
  const [activeProject, setActiveProject] = useState<KodetyStudioProject | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [renamingProject, setRenamingProject] = useState<KodetyStudioProject | null>(null);
  const [deletingProject, setDeletingProject] = useState<KodetyStudioProject | null>(null);
  const language = preferences.language;
  const t = (source: string, replacements?: Record<string, string | number>) => studioText(language, source, replacements);

  const updatePreferences = (next: KodetyStudioPreferences) => {
    saveStudioPreferences(next);
    setPreferences(next);
  };

  const changeLanguage = (nextLanguage: StudioLanguage) => {
    updatePreferences({ ...preferences, language: nextLanguage });
  };

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en-US' : 'pt-BR';
    document.title = 'Onun Kodety';
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) {
      description.content = language === 'en'
        ? 'Create WordPress projects locally in your browser with Kodety.'
        : 'Crie projetos WordPress localmente no navegador com o Kodety.';
    }
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) manifest.href = language === 'en' ? './manifest.en.webmanifest' : './manifest.webmanifest';
  }, [language]);

  useEffect(() => {
    setLoaded(false);
    setLoadError('');
    void loadProjects()
      .then(storedProjects => setProjects(storedProjects))
      .catch(reason => setLoadError(
        reason instanceof Error ? reason.message : 'Não foi possível ler os projetos salvos neste navegador.',
      ))
      .finally(() => setLoaded(true));
  }, [loadAttempt]);

  const commitProjects = async (nextProjects: KodetyStudioProject[]) => {
    const sorted = [...nextProjects].sort((left, right) => (right.lastOpenedAt || right.updatedAt) - (left.lastOpenedAt || left.updatedAt));
    await saveProjects(sorted);
    setProjects(sorted);
  };

  const openProject = async (project: KodetyStudioProject) => {
    const opened = { ...project, lastOpenedAt: Date.now() };
    await commitProjects(projects.map(item => item.id === project.id ? opened : item));
    setActiveProject(opened);
    setView('workspace');
  };

  const createProject = async (name: string, wordpressLocale: WordPressLocale) => {
    const project = newProject(name, wordpressLocale);
    setNewProjectOpen(false);
    await commitProjects([project, ...projects]);
    setActiveProject(project);
    setView('workspace');
  };

  const updateReadyProject = async (readyProject: KodetyStudioProject) => {
    await commitProjects(projects.map(project => project.id === readyProject.id ? readyProject : project));
    setActiveProject(readyProject);
  };

  const renameProject = async (project: KodetyStudioProject, name: string) => {
    const renamed = { ...project, name: name.trim(), updatedAt: Date.now() };
    await commitProjects(projects.map(item => item.id === project.id ? renamed : item));
    setRenamingProject(null);
    if (activeProject?.id === project.id) setActiveProject(renamed);
  };

  const deleteProject = async (
    project: KodetyStudioProject,
    iframe: HTMLIFrameElement,
    onStage: (detail: string) => void,
  ) => {
    await destroyProjectData({ iframe, project, language, onStage });
    await commitProjects(projects.filter(item => item.id !== project.id));
    setDeletingProject(null);
  };

  if (!loaded) {
    return (
      <StudioI18nProvider language={language}>
        <div className="app-boot-screen">
          <BrandMark />
          <div><span /></div>
          <p>{t('Abrindo o Onun Kodety')}</p>
        </div>
      </StudioI18nProvider>
    );
  }

  if (loadError) {
    return (
      <StudioI18nProvider language={language}>
        <div className="runtime-error app-storage-error">
          <div className="runtime-error-icon"><DangerTriangleIcon /></div>
          <h2>{t('Não foi possível abrir a biblioteca')}</h2>
          <p>{t('{error} Nenhum projeto foi alterado.', { error: studioText(language, loadError) })}</p>
          <div>
            <button type="button" className="primary-button" onClick={() => setLoadAttempt(value => value + 1)}>
              <StrokeRefreshIcon /> {t('Tentar novamente')}
            </button>
          </div>
        </div>
      </StudioI18nProvider>
    );
  }

  if (preferences.onboardingVersion < STUDIO_ONBOARDING_VERSION) {
    return (
      <StudioI18nProvider language={language}>
        <StudioOnboarding
          onLanguageChange={changeLanguage}
          onComplete={() => updatePreferences({
            ...preferences,
            onboardingVersion: STUDIO_ONBOARDING_VERSION,
          })}
        />
      </StudioI18nProvider>
    );
  }

  return (
    <StudioI18nProvider language={language}>
      {view === 'workspace' && activeProject ? (
        <ProjectWorkspace
          project={activeProject}
          language={language}
          onBack={() => { setView('projects'); setActiveProject(null); }}
          onProjectReady={updateReadyProject}
        />
      ) : (
        <ProjectsDashboard
          projects={projects}
          onCreate={() => setNewProjectOpen(true)}
          onOpen={project => void openProject(project)}
          onRename={setRenamingProject}
          onDelete={setDeletingProject}
          onLanguageChange={changeLanguage}
        />
      )}

      {newProjectOpen && (
        <NewProjectDialog
          defaultWordPressLocale={wordpressLocaleForLanguage(language)}
          onClose={() => setNewProjectOpen(false)}
          onCreate={(name, wordpressLocale) => void createProject(name, wordpressLocale)}
        />
      )}
      {renamingProject && (
        <RenameProjectDialog
          project={renamingProject}
          onClose={() => setRenamingProject(null)}
          onRename={name => void renameProject(renamingProject, name)}
        />
      )}
      {deletingProject && (
        <DeleteProjectDialog
          project={deletingProject}
          onClose={() => setDeletingProject(null)}
          onDelete={(iframe, onStage) => deleteProject(deletingProject, iframe, onStage)}
        />
      )}
    </StudioI18nProvider>
  );
}

export function renderStudioApp(): void {
  const root = document.getElementById('kodety-studio-root');
  if (!root) throw new Error('Onun Kodety root element was not found.');
  createRoot(root).render(<StudioApp />);
}
