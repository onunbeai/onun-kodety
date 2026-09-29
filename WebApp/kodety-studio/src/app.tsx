import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { StudioI18nProvider } from "../../../ChromeExtension/kodety-studio/src/i18n";
import type { SecurityDirectoryStatus } from "../../../ChromeExtension/kodety-studio/src/backup-storage";
import {
  saveStudioPreferences,
  type KodetyStudioProject,
  type StudioLanguage,
  type WordPressLocale,
} from "../../../ChromeExtension/kodety-studio/src/storage";
import {
  KODETY_PHP_VERSION,
  KODETY_PLUGIN_VERSION,
  KODETY_WORDPRESS_VERSION,
} from "../../../ChromeExtension/kodety-studio/src/product-versions";
import {
  browserProjectRepository,
  LIBRARY_KEY,
  LIBRARY_EVENT,
  LibraryError,
  validateProjectName,
  visibleProjects,
  type StudioProject,
  type StudioProjectMode,
  type StudioProjectStorageMode,
} from "./project-library";
import {
  Dialog,
  Icon,
  Logo,
  Mark,
  Notice,
  Select,
  Spinner,
  type IconName,
} from "./ui";
import "./studio-shell.css";
import "./webapp.css";
import { Onboarding } from "./onboarding";
import { OfflineAvailability } from "./offline";
import { KodetyLoadingScreen } from "../../../components/ui/kodety-loading-screen";
import { bindHtmlDirectory, createManagedHtmlDirectory, pickHtmlDirectory, requestStoredHtmlDirectoryAccess, supportsHtmlDirectory } from "./html-directory";
import { projectForDeletion as resolveStoredProject } from "./project-deletion";
import { LOGIN_PROJECT_KEY, libraryRouteUrl, projectRouteUrl, restoredProjectRoute, wordpressProjectRouteUrl, type ProjectRoute } from "./project-route";
import { consumedStudioEntryUrl, loadStudioEntryPreferences } from "./studio-entry";
import {
  completeWebOnboarding,
  loadDefaultProjectMode,
  rememberDefaultProjectMode,
  shouldShowWebOnboarding,
  WEB_ONBOARDING_KEY,
  WEB_DEFAULT_PROJECT_MODE_KEY,
} from "./onboarding-state";

const ProjectWorkspace = lazy(() =>
  import("../../../ChromeExtension/kodety-studio/src/main").then((module) => ({
    default: module.ProjectWorkspace,
  })),
);
const HtmlWorkspace = lazy(() => import("./html-workspace"));

type Copy = (pt: string, en: string) => string;
type View = "overview" | "projects" | "favorites" | "settings" | "local";
type Layout = "grid" | "list";
const repository = browserProjectRepository();
const copyFor =
  (language: StudioLanguage): Copy =>
  (pt, en) =>
    language === "en" ? en : pt;
const currentView = (): View => {
  const value = window.location.hash.slice(1);
  return ["overview", "projects", "favorites", "settings", "local"].includes(value)
    ? (value as View)
    : "overview";
};
function initialProjectRoute(): ProjectRoute | null {
  let saved: string | null = null;
  try { saved = sessionStorage.getItem(LOGIN_PROJECT_KEY); } catch { /* Optional login return hint. */ }
  return restoredProjectRoute(window.location.href, saved);
}

function errorCopy(reason: unknown, l: Copy): string {
  if (reason instanceof LibraryError) {
    const messages: Record<LibraryError["code"], string> = {
      unreadable: l(
        "O navegador não permitiu ler os projetos. Verifique as permissões de armazenamento e tente novamente.",
        "The browser could not read your projects. Check storage permissions and try again.",
      ),
      corrupt: l(
        "Não foi possível ler o catálogo salvo. Os dados originais foram preservados. Tente novamente ou baixe o catálogo para recuperação.",
        "The saved catalog could not be read. The original data was preserved. Try again or download the catalog for recovery.",
      ),
      quota: l(
        "O armazenamento está cheio. Libere espaço no dispositivo e tente novamente. A alteração não foi salva.",
        "Storage is full. Free up space on your device and try again. The change was not saved.",
      ),
      unavailable: l(
        "Não foi possível salvar. Use uma janela normal de um navegador atualizado e permita o armazenamento local.",
        "Could not save. Use a regular window in an up-to-date browser and allow local storage.",
      ),
      missing: l(
        "Este projeto foi removido em outra aba. Atualize a biblioteca para continuar.",
        "This project was removed in another tab. Refresh the library to continue.",
      ),
      mode: l("Novos projetos são criados em HTML.", "New projects are created in HTML."),
      name: l(
        "Digite um nome válido de 1 a 80 caracteres.",
        "Enter a valid name between 1 and 80 characters.",
      ),
      duplicate: l(
        "Já existe um projeto com esse nome. Escolha outro nome.",
        "A project with this name already exists. Choose another name.",
      ),
    };
    return messages[reason.code];
  }
  if (reason instanceof Error && "code" in reason) {
    if (reason.code === "html_browser_storage_missing") return l(
      "Os arquivos deste projeto não foram encontrados neste navegador. Crie outro projeto HTML e use “Substituir projeto com ZIP…” no menu do Builder para recuperar seu backup.",
      "This project’s files were not found in this browser. Create another HTML project and use “Replace project with ZIP…” in the Builder menu to restore your backup.",
    );
    if (reason.code === "html_browser_storage_unavailable") return l(
      "O armazenamento deste navegador não está disponível. Verifique as permissões de armazenamento e o espaço livre, ou abra o Studio em outro navegador.",
      "Browser storage is unavailable. Check storage permissions and free space, or open Studio in another browser.",
    );
  }
  return reason instanceof Error
    ? reason.message
    : l(
        "Não foi possível concluir. Tente novamente.",
        "Could not complete this action. Please try again.",
      );
}

function relativeDate(
  timestamp: number | null,
  language: StudioLanguage,
  l: Copy,
) {
  if (!timestamp) return l("Ainda não aberto", "Not opened yet");
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return l("Agora mesmo", "Just now");
  const unit = diff < 3_600_000 ? "minute" : diff < 86_400_000 ? "hour" : "day";
  return new Intl.RelativeTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    numeric: "auto",
  }).format(
    -Math.floor(
      diff /
        (unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000),
    ),
    unit,
  );
}

function browserSupport(
  l: Copy,
  mode: StudioProjectMode = "html",
): string | null {
  if (!window.isSecureContext)
    return l(
      "Abra o Studio por HTTPS para criar projetos.",
      "Open Studio over HTTPS to create projects.",
    );
  if (
    !("indexedDB" in window) ||
    !navigator.locks?.request
  ) {
    return l(
      "O armazenamento local não está disponível. Use uma janela normal de um navegador atualizado e permita salvar os dados deste site.",
      "Local storage is unavailable. Use a regular window in an up-to-date browser and allow this site to store data.",
    );
  }
  if (
    ((!supportsHtmlDirectory() || mode === "wordpress") && !navigator.storage?.getDirectory) ||
    (mode === "wordpress" && typeof WebAssembly === "undefined")
  ) {
    return l(
      "Este navegador não oferece os recursos de armazenamento necessários. Abra o Studio em uma versão atual do Chrome, Edge, Firefox ou Safari.",
      "This browser does not provide the required storage features. Open Studio in an up-to-date Chrome, Edge, Firefox or Safari.",
    );
  }
  return null;
}

function ManualBackupConfirmation({ l, checked, onChange, disabled = false }: {
  l: Copy; checked: boolean; onChange(value: boolean): void; disabled?: boolean;
}) {
  return <div className="web-manual-backup-confirmation">
    <div className="web-manual-backup-heading"><Icon name="download" /><strong>{l("Backup por ZIP", "ZIP backups")}</strong><span>{l("Manual", "Manual")}</span></div>
    <p>{l("O projeto ficará salvo neste navegador. Limpar os dados do site, usar uma janela privada ou perder o armazenamento pode apagar seu trabalho.", "Your project will be saved in this browser. Clearing site data, using a private window or losing browser storage may erase your work.")}</p>
    <p>{l("Baixe o backup ZIP regularmente e salve-o em uma pasta de segurança no seu dispositivo. O Kodety não atualiza essa cópia automaticamente.", "Download the backup ZIP regularly and save it in a safety folder on your device. Kodety does not update that copy automatically.")}</p>
    <label className="web-manual-backup-consent"><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span>{l("Entendi o risco e vou guardar meus backups ZIP fora do navegador.", "I understand the risk and will keep my ZIP backups outside the browser.")}</span></label>
  </div>;
}

function ProjectForm({ project, projects, language, onClose, onSubmit }: {
  project?: StudioProject;
  projects: StudioProject[];
  language: StudioLanguage;
  initialMode: StudioProjectMode;
  onClose(): void;
  onSubmit(name: string, locale: WordPressLocale, mode: StudioProjectMode, directory: FileSystemDirectoryHandle | null, storageMode: StudioProjectStorageMode): Promise<void>;
}) {
  const l = copyFor(language);
  const [name, setName] = useState(project?.name || "");
  const [storageMode, setStorageMode] = useState<"browser" | "folder">("browser");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); if (project) input.current?.select(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const directory = !project && storageMode === "folder" ? await pickHtmlDirectory() : null;
      await onSubmit(validateProjectName(name, projects, project?.id), project?.wordpressLocale || (language === "en" ? "en_US" : "pt_BR"), project?.mode || "html", directory, project?.storageMode || storageMode);
    } catch (reason) { setError(errorCopy(reason, l)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Dialog title={project ? l("Renomear projeto", "Rename project") : l("Criar novo projeto", "Create a new project")}
    description={project ? l("Um novo nome para o mesmo trabalho.", "A new name for the same work.") : l("Seus arquivos ficam no navegador ou em uma pasta do seu computador.", "Your files stay in this browser or a folder on your computer.")}
    closeLabel={l("Fechar", "Close")} onClose={onClose} busy={busy} className="web-project-dialog">
    <form className="web-project-form" onSubmit={event => void submit(event)}>
      <div className="web-form-body">
        <label className="web-field" htmlFor="web-project-name"><span>{l("Nome do projeto", "Project name")}</span>
          <input ref={input} id="web-project-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required autoComplete="off" disabled={busy}
            placeholder={l("Ex.: Portfólio, site da clínica…", "e.g. Portfolio, clinic website…")} aria-invalid={!!error} />
          <small>{l("Você pode alterar o nome depois.", "You can change the name later.")}<span>{name.length}/80</span></small>
        </label>
        {!project && <>
          <label className="web-field" htmlFor="web-project-storage"><span>{l("Salvar em", "Save in")}</span>
            <select id="web-project-storage" value={storageMode} onChange={event => setStorageMode(event.target.value as "browser" | "folder")} disabled={busy}>
              <option value="browser">{l("Neste navegador", "This browser")}</option>
              {supportsHtmlDirectory() && <option value="folder">{l("Pasta do computador", "Computer folder")}</option>}
            </select>
          </label>
          <div className="web-local-note"><Icon name="shield" /><p>{l("Sem conta e sem assinatura. Baixe backups ZIP regularmente: limpar os dados do navegador também remove os projetos salvos nele.", "No account or subscription. Download ZIP backups regularly: clearing browser data also removes projects stored there.")}</p></div>
        </>}
        {error && <Notice>{error}</Notice>}
      </div>
      <footer className="web-dialog-footer"><button type="button" className="web-button" onClick={onClose} disabled={busy}>{l("Cancelar", "Cancel")}</button>
        <button type="submit" className="web-button is-primary" disabled={busy || !name.trim() || (!!project && name.trim() === project.name)}>{busy ? <Spinner /> : <Icon name={project ? "check" : "plus"} />}{busy ? l("Salvando…", "Saving…") : project ? l("Salvar nome", "Save name") : l("Criar e abrir projeto", "Create and open project")}</button>
      </footer>
    </form>
  </Dialog>;
}

function ProjectTile({
  project,
  language,
  busy,
  onOpen,
  onRename,
  onDelete,
  onFavorite,
}: {
  project: StudioProject;
  language: StudioLanguage;
  busy: boolean;
  onOpen(): void;
  onRename(): void;
  onDelete(): void;
  onFavorite(): void;
}) {
  const l = copyFor(language);
  return (
    <article className="web-project-card">
      <button
        type="button"
        className="web-project-open"
        onClick={onOpen}
        disabled={busy}
        aria-label={l(`Abrir ${project.name}`, `Open ${project.name}`)}
      >
        <div
          className={`web-project-preview ${project.thumbnailDataUrl ? "has-thumbnail" : ""}`}
        >
          {project.thumbnailDataUrl ? (
            <img src={project.thumbnailDataUrl} alt="" loading="lazy" />
          ) : (
            <Logo className="web-project-logo" />
          )}
          <span className="web-preview-open">
            <Icon name="arrow" />
            {l("Abrir projeto", "Open project")}
          </span>
        </div>
        <div className="web-project-info">
          <div className="web-project-title">
            <h3>{project.name}</h3>
            <span
              className={
                project.initialized ? "web-badge is-ready" : "web-badge"
              }
            >
              <i />
              {project.initialized
                ? l("Pronto", "Ready")
                : l("Preparar", "Set up")}
            </span>
          </div>
          <p>
            <Icon name="globe" />
            <span className={`web-project-mode is-${project.mode}`}>
              {project.mode === "html" ? "HTML" : "WordPress"}
            </span>
            {" · "}
            {project.wordpressLocale === "pt_BR" ? "PT-BR" : "EN-US"}
          </p>
          <small>
            <Icon name="clock" />
            {relativeDate(project.lastOpenedAt, language, l)}
          </small>
        </div>
      </button>
      <div className="web-project-actions">
        <button
          className={`web-icon-button ${project.favorite ? "is-favorite" : ""}`}
          aria-label={
            project.favorite
              ? l(`Desfavoritar ${project.name}`, `Unfavorite ${project.name}`)
              : l(`Favoritar ${project.name}`, `Favorite ${project.name}`)
          }
          title={l("Favorito", "Favorite")}
          aria-pressed={!!project.favorite}
          onClick={onFavorite}
          disabled={busy}
        >
          <Icon name="star" />
        </button>
        <button
          className="web-icon-button"
          title={l("Renomear", "Rename")}
          aria-label={l(`Renomear ${project.name}`, `Rename ${project.name}`)}
          onClick={onRename}
          disabled={busy}
        >
          <Icon name="edit" />
        </button>
        <button
          className="web-icon-button is-danger"
          title={l("Excluir", "Delete")}
          aria-label={l(`Excluir ${project.name}`, `Delete ${project.name}`)}
          onClick={onDelete}
          disabled={busy}
        >
          <Icon name="trash" />
        </button>
      </div>
    </article>
  );
}

function Settings({
  language,
  onLanguageChange,
  layout,
  onLayout,
  projects,
}: {
  language: StudioLanguage;
  onLanguageChange(language: StudioLanguage): void;
  layout: Layout;
  onLayout(layout: Layout): void;
  projects: StudioProject[];
}) {
  const l = copyFor(language);
  const [directory, setDirectory] = useState<SecurityDirectoryStatus | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const backupRef = useRef<
    | typeof import("../../../ChromeExtension/kodety-studio/src/backup-storage")
    | null
  >(null);
  useEffect(() => {
    let disposed = false;
    void import("../../../ChromeExtension/kodety-studio/src/backup-storage")
      .then(async (module) => {
        backupRef.current = module;
        return module.getSecurityDirectoryStatus("");
      })
      .then((status) => {
        if (!disposed) setDirectory(status);
      })
      .catch((reason) => {
        if (!disposed) setError(errorCopy(reason, l));
      });
    return () => {
      disposed = true;
    };
  }, []);
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const backup = backupRef.current;
      if (!backup)
        throw new Error(
          l(
            "Aguarde o carregamento e tente novamente.",
            "Wait for loading to finish and try again.",
          ),
        );
      setDirectory(
        directory?.needsPermission
          ? await backup.requestSecurityDirectoryAccess("")
          : await backup.connectSecurityDirectory(),
      );
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError"))
        setError(errorCopy(reason, l));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="web-settings">
      <section className="web-settings-section">
        <header>
          <span className="web-tile-icon">
            <Icon name="settings" />
          </span>
          <h2>{l("Preferências", "Preferences")}</h2>
          <p>{l("Deixe o Studio do seu jeito.", "Make Studio your own.")}</p>
        </header>
        <div className="web-setting-fields">
          <div className="web-setting-row">
            <div>
              <label htmlFor="web-language">
                {l("Idioma da interface", "Interface language")}
              </label>
              <p>
                {l(
                  "Não altera o idioma dos projetos existentes.",
                  "Does not change the language of existing projects.",
                )}
              </p>
            </div>
            <Select<StudioLanguage>
              id="web-language"
              label={l("Idioma da interface", "Interface language")}
              value={language}
              onValueChange={onLanguageChange}
              options={[
                { value: "pt", label: "Português (Brasil)" },
                { value: "en", label: "English (US)" },
              ]}
            />
          </div>
          <div className="web-setting-row">
            <div>
              <label htmlFor="web-layout">
                {l("Visualização dos projetos", "Project view")}
              </label>
              <p>
                {l(
                  "Escolha como sua biblioteca é exibida.",
                  "Choose how your library is displayed.",
                )}
              </p>
            </div>
            <Select<Layout>
              id="web-layout"
              label={l("Visualização dos projetos", "Project view")}
              value={layout}
              onValueChange={onLayout}
              options={[
                {
                  value: "grid",
                  label: l("Grade de projetos", "Project grid"),
                },
                { value: "list", label: l("Lista compacta", "Compact list") },
              ]}
            />
          </div>
        </div>
      </section>
      <section className="web-settings-section">
        <header>
          <span className="web-tile-icon">
            <Icon name="shield" />
          </span>
          <h2>{l("Armazenamento e backup", "Storage and backup")}</h2>
          <p>
            {l("Seu trabalho pertence a você.", "Your work belongs to you.")}
          </p>
        </header>
        <div className="web-setting-fields">
          <div className="web-setting-row">
            <div>
              <strong>
                {l("Biblioteca neste navegador", "Library in this browser")}
              </strong>
              <p>
                {l(
                  projects.length === 1
                    ? "1 projeto associado a este perfil."
                    : `${projects.length} projetos associados a este perfil.`,
                  projects.length === 1
                    ? "1 project linked to this profile."
                    : `${projects.length} projects linked to this profile.`,
                )}
              </p>
            </div>
            <span className="web-badge">{l("Local", "Local")}</span>
          </div>
          <div className="web-setting-row">
            <div>
              <strong>{l("Pasta de segurança", "Safety folder")}</strong>
              <p>
                {directory?.connected
                  ? directory.directoryName
                  : l(
                      supportsHtmlDirectory() ? "Conecte uma pasta para guardar cópias dos projetos." : "Abra um projeto para baixar seu backup ZIP.",
                      supportsHtmlDirectory() ? "Connect a folder to keep copies of your projects." : "Open a project to download its backup ZIP.",
                    )}
              </p>
            </div>
            {directory === null ? (
              <Spinner />
            ) : directory.supported ? (
              <button
                className="web-button"
                disabled={busy}
                onClick={() => void connect()}
              >
                {busy ? <Spinner /> : <Icon name="folder" />}
                {directory.connected
                  ? l("Alterar pasta", "Change folder")
                  : directory.needsPermission
                    ? l("Autorizar pasta", "Allow folder")
                    : l("Conectar pasta", "Connect folder")}
              </button>
            ) : (
              <span className="web-badge">
                {l("Use o backup em ZIP", "Use ZIP backup")}
              </span>
            )}
          </div>
          <div className="web-setting-note">
            <Icon name="shield" />
            <p>
              {l(
                "Com uma pasta conectada, o Studio atualiza seus arquivos ou backups automaticamente. Com backup manual, abra o projeto, baixe o ZIP e guarde-o numa pasta de segurança. Limpar os dados do navegador pode apagar os projetos sem uma cópia externa.",
                "With a connected folder, Studio updates your files or backups automatically. With manual backups, open the project, download its ZIP and keep it in a safety folder. Clearing browser data may erase projects without an external copy.",
              )}
            </p>
          </div>
          {error && <Notice>{error}</Notice>}
        </div>
      </section>
      <section className="web-settings-section">
        <header>
          <span className="web-tile-icon">
            <Icon name="server" />
          </span>
          <h2>{l("Sobre o Studio", "About Studio")}</h2>
          <p>
            {l(
              "O ambiente incluído em novos projetos.",
              "The environment included in new projects.",
            )}
          </p>
        </header>
        <div className="web-setting-fields">
          <div className="web-version-row">
            <span>Onun Kodety Builder</span>
            <code>{KODETY_PLUGIN_VERSION}</code>
          </div>
          <div className="web-version-row">
            <span>WordPress</span>
            <code>{KODETY_WORDPRESS_VERSION}</code>
          </div>
          <div className="web-version-row">
            <span>PHP · SQLite</span>
            <code>{KODETY_PHP_VERSION}</code>
          </div>
          <div className="web-setting-note">
            <Icon name="globe" />
            <p>
              {l(
                "É preciso estar online para iniciar o ambiente WordPress.",
                "An internet connection is needed to start the WordPress environment.",
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function WebApp() {
  const [preferences, setPreferences] = useState(() =>
    loadStudioEntryPreferences(),
  );
  const language = preferences.language;
  const l = copyFor(language);
  const [localProjects, setProjects] = useState<StudioProject[]>([]);
  const [requestedRoute, setRequestedRoute] = useState(initialProjectRoute);
  const [routeOpening, setRouteOpening] = useState(Boolean(requestedRoute));
  const [routeError, setRouteError] = useState("");
  useEffect(() => {
    try { saveStudioPreferences(preferences); } catch { /* Optional preference. */ }
    const consumedUrl = consumedStudioEntryUrl(window.location.href);
    if (consumedUrl !== window.location.href) history.replaceState(history.state, '', consumedUrl);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(currentView);
  const projects = localProjects;
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return localStorage.getItem("kodetyStudioWebLayout") === "list"
        ? "list"
        : "grid";
    } catch {
      return "grid";
    }
  });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "created">("recent");
  const [online, setOnline] = useState(navigator.onLine);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<StudioProject | null>(
    null,
  );
  const [form, setForm] = useState<"create" | StudioProject | null>(null);
  const [manualBackupProject, setManualBackupProject] = useState<StudioProject | null>(null);
  const [manualBackupConfirmed, setManualBackupConfirmed] = useState(false);
  const [deleting, setDeleting] = useState<StudioProject | null>(null);
  const [busy, setBusy] = useState(false);
  const operationRef = useRef(false);
  const [defaultProjectMode, setDefaultProjectMode] = useState<StudioProjectMode>(loadDefaultProjectMode);
  const [onboarding, setOnboarding] = useState(shouldShowWebOnboarding);
  const showOnboarding = onboarding && !requestedRoute;
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const refresh = () => {
    try {
      setProjects(repository.read());
      setLoadError("");
    } catch (reason) {
      setLoadError(errorCopy(reason, l));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    refresh();
    const storageChanged = (event: StorageEvent) => {
      if (!event.key || event.key === LIBRARY_KEY) refresh();
      if (!event.key || event.key === WEB_DEFAULT_PROJECT_MODE_KEY) setDefaultProjectMode(loadDefaultProjectMode());
      if (event.key === WEB_ONBOARDING_KEY && !shouldShowWebOnboarding()) {
        setOnboarding(false);
      }
    };
    const connectionChanged = () => setOnline(navigator.onLine);
    const hashChanged = () => {
      setView(currentView());
      setMenuOpen(false);
      setQuery("");
    };
    window.addEventListener("storage", storageChanged);
    window.addEventListener(LIBRARY_EVENT, refresh);
    window.addEventListener("online", connectionChanged);
    window.addEventListener("offline", connectionChanged);
    window.addEventListener("hashchange", hashChanged);
    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(LIBRARY_EVENT, refresh);
      window.removeEventListener("online", connectionChanged);
      window.removeEventListener("offline", connectionChanged);
      window.removeEventListener("hashchange", hashChanged);
    };
  }, [language]);
  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en-US" : "pt-BR";
    document.title = activeProject
      ? `${activeProject.name} — Onun Kodety`
      : "Onun Kodety";
    const manifest = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    if (manifest)
      manifest.href =
        language === "en"
          ? "./manifest.en.webmanifest"
          : "./manifest.webmanifest";
  }, [language, activeProject?.name]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "k" &&
        !activeProject &&
        !showOnboarding &&
        !form &&
        !deleting &&
        !manualBackupProject
      ) {
        event.preventDefault();
        if (view === "settings") navigate("projects");
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [view, activeProject, form, deleting, showOnboarding, manualBackupProject]);
  const navigate = (next: View) => {
    if (requestedRoute) {
      history.replaceState(history.state, '', libraryRouteUrl(window.location.href, next));
      setRequestedRoute(null); setRouteError(""); setRouteOpening(false);
    } else window.location.hash = next;
    setView(next);
    setMenuOpen(false);
    setQuery("");
    mainRef.current?.scrollTo(0, 0);
  };
  const changeLanguage = (next: StudioLanguage) => {
    const updated = { ...preferences, language: next };
    setPreferences(updated);
    try {
      saveStudioPreferences(updated);
    } catch (reason) {
      setError(
        errorCopy(new LibraryError("unavailable", { cause: reason }), l),
      );
    }
  };
  const changeLayout = (next: Layout) => {
    try {
      localStorage.setItem("kodetyStudioWebLayout", next);
      setLayout(next);
    } catch (reason) {
      setError(
        errorCopy(new LibraryError("unavailable", { cause: reason }), l),
      );
    }
  };
  const action = async (operation: () => Promise<void>) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(errorCopy(reason, l));
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  };
  const enterProject = (project: StudioProject) => {
    window.location.assign(project.mode === "html"
      ? projectRouteUrl(window.location.href, { id: project.id, source: "local" })
      : wordpressProjectRouteUrl(window.location.href, project.id));
  };
  const openConfirmed = (project: StudioProject) =>
    void action(async () => {
      // Older catalogs omitted HTML mode. Resolve their existing binding before
      // choosing a workspace or offering the WordPress backup fallback.
      const target = project.mode === "html" ? project : await resolveStoredProject(project);
      if (target.mode === "wordpress" && target.storageMode !== "browser" && !supportsHtmlDirectory()) {
        setManualBackupConfirmed(false);
        setManualBackupProject(target);
        return;
      }
      const unsupported = browserSupport(l, target.mode);
      if (unsupported) throw new Error(unsupported);
      // Keep this request in the Open click's activation. The workspace only
      // queries on mount; explicit HTML projects do not await legacy detection.
      if (target.mode === "html") await requestStoredHtmlDirectoryAccess(target.id);
      if (target.mode !== "html" && !target.initialized && !navigator.onLine)
        throw new Error(
          l(
            "Conecte-se à internet para iniciar o ambiente deste projeto.",
            "Connect to the internet to start this project environment.",
          ),
        );
      const latest = await repository.patch(project.id, {
        lastOpenedAt: Date.now(),
      });
      setProjects(latest);
      enterProject({ ...latest.find((item) => item.id === project.id)!, mode: target.mode, storageMode: target.storageMode });
    });
  const open = (project: StudioProject) => {
    openConfirmed(project);
  };
  const submitProject = async (
    name: string,
    locale: WordPressLocale,
    mode: StudioProjectMode,
    directory: FileSystemDirectoryHandle | null,
    storageMode: StudioProjectStorageMode,
  ) => {
    if (form && form !== "create") {
      setProjects(await repository.patch(form.id, { name, updatedAt: Date.now() }));
      setForm(null); return;
    }
    if (mode !== "html") throw new LibraryError("mode");
    const result = await repository.create(name, locale, {
      mode: "html", storageMode,
      directoryName: directory?.name,
      prepare: async created => {
        if (storageMode === "folder" && directory) await bindHtmlDirectory(created.id, directory);
        else await createManagedHtmlDirectory(created.id);
      },
    });
    setProjects(result.projects);
    setForm(null);
    enterProject(result.project);
  };

  const updateRuntimeProject = async (ready: KodetyStudioProject) => {
    // Only runtime-owned fields: a thumbnail callback from an old render must
    // not undo a rename/favorite changed in another tab.
    const patch = {
      initialized: ready.initialized,
      phpVersion: ready.phpVersion,
      wordpressVersion: ready.wordpressVersion,
      kodetyVersion: ready.kodetyVersion,
      wordpressLocale: ready.wordpressLocale,
      runtimeRevision: ready.runtimeRevision,
      lastOpenedAt: ready.lastOpenedAt,
      updatedAt: ready.updatedAt,
      ...(ready.thumbnailDataUrl
        ? {
            thumbnailDataUrl: ready.thumbnailDataUrl,
            thumbnailUpdatedAt: ready.thumbnailUpdatedAt,
          }
        : {}),
    };
    const latest = await repository.patch(ready.id, patch);
    setProjects(latest);
    setActiveProject(current => {
      const updated = latest.find((item) => item.id === ready.id);
      // Keep the resolved storage binding in memory without migrating legacy
      // catalog fields or switching the editor after its first save.
      return current?.id === ready.id && updated
        ? { ...updated, mode: current.mode, storageMode: current.storageMode }
        : current;
    });
  };
  const downloadCatalog = () => {
    try {
      const blob = new Blob([localStorage.getItem(LIBRARY_KEY) || "[]"], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "kodety-project-catalog-recovery.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(errorCopy(reason, l));
    }
  };

  useEffect(() => {
    if (!requestedRoute || activeProject || !loaded) return;
    let cancelled = false;
    const target = requestedRoute.source === "local"
      ? localProjects.find(item => item.id === requestedRoute.id)
      : undefined;
    // Restore the destination lost by the login's fixed callback URL, keeping
    // the project identity in the address bar on every subsequent reload.
    if (!new URL(window.location.href).searchParams.has("project")) {
      history.replaceState(history.state, '', projectRouteUrl(window.location.href, requestedRoute));
    }
    try { sessionStorage.removeItem(LOGIN_PROJECT_KEY); } catch { /* Optional login return hint. */ }
    if (!target) {
      setRouteOpening(false);
      setRouteError(requestedRoute.source === "local"
        ? l("Este projeto não foi encontrado neste dispositivo. Abra o link no navegador em que ele foi salvo.", "This project was not found on this device. Open the link in the browser where it was saved.")
        : l("Projetos da antiga nuvem precisam ser exportados como ZIP e importados no Onun Kodety.", "Export projects from the former cloud as ZIP files and import them into Onun Kodety."));
      return;
    }
    setRouteOpening(true); setRouteError(""); setOnboarding(false);
    void (async () => {
      const resolved = target.mode === "html" ? target : await resolveStoredProject(target);
      if (cancelled) return;
      if (resolved.mode !== "html") {
        // WordPress retains its separate DIP document and persistent runtime.
        window.location.replace(wordpressProjectRouteUrl(window.location.href, resolved.id));
        return;
      }
      setActiveProject({ ...target, mode: resolved.mode, storageMode: resolved.storageMode });
      setRouteOpening(false);
    })().catch(cause => { if (!cancelled) { setRouteError(errorCopy(cause, l)); setRouteOpening(false); } });
    return () => { cancelled = true; };
  }, [requestedRoute, activeProject, loaded, localProjects, language]);

  const visible = useMemo(
    () =>
      visibleProjects(
        projects,
        query,
        view === "favorites" ? "favorites" : "all",
        sort,
      ),
    [projects, query, view, sort],
  );
  const displayed =
    view === "overview" && !query ? visible.slice(0, 6) : visible;
  const favorites = projects.filter((project) => project.favorite).length;
  const readyCount = projects.filter(
    (project) => project.initialized,
  ).length;
  const unsupported = browserSupport(l);
  const pages: { id: View; label: string; icon: IconName; count?: number }[] = [
    { id: "overview", label: l("Visão geral", "Overview"), icon: "widget" },
    {
      id: "projects",
      label: l("Todos os projetos", "All projects"),
      icon: "folder",
      count: projects.length,
    },
    {
      id: "favorites",
      label: l("Favoritos", "Favorites"),
      icon: "star",
      count: favorites,
    },
    ...(localProjects.length || view === "local" ? [{ id: "local" as View, label: l("Neste dispositivo", "On this device"), icon: "folder" as IconName, count: localProjects.length }] : []),
    { id: "settings", label: l("Configurações", "Settings"), icon: "settings" },
  ];
  const page = pages.find((item) => item.id === view)!;

  if (!activeProject && (!loaded || routeOpening)) {
    return <KodetyLoadingScreen className="h-dvh" label={l("Carregando Studio", "Loading Studio")} />;
  }

  if (showOnboarding && !activeProject)
    return (
      <Onboarding
        initialMode={defaultProjectMode}
        language={language}
        onLanguageChange={changeLanguage}
        onClose={(mode) => {
          try {
            rememberDefaultProjectMode(mode);
            completeWebOnboarding();
          } catch (reason) {
            setError(errorCopy(new LibraryError("unavailable", { cause: reason }), l));
          }
          setDefaultProjectMode(mode);
          setQuery("");
          setForm(null);
          setView("overview");
          setOnboarding(false);
        }}
        onComplete={(mode) => {
          rememberDefaultProjectMode(mode);
          completeWebOnboarding();
          setDefaultProjectMode(mode);
          setOnboarding(false);
          setForm("create");
        }}
      />
    );

  return (
    <StudioI18nProvider language={language}>
      <div className={activeProject?.mode === "html" ? "web-builder-host" : "web-app"}>
        <Suspense
          fallback={
            <KodetyLoadingScreen className="h-dvh" label={l("Carregando projeto", "Loading project")} />
          }
        >
          {activeProject ? (
            activeProject.mode === "html" ? (
              <HtmlWorkspace
                key={activeProject.id}
                project={activeProject}
                language={language}
                onBack={() => {
                  window.location.assign(libraryRouteUrl(window.location.href));
                }}
                onProjectReady={updateRuntimeProject}
              />
            ) : (
              <ProjectWorkspace
                key={activeProject.id}
                project={activeProject}
                language={language}
                requireSecurityDirectory={activeProject.storageMode !== "browser"}
                manualBackup={activeProject.storageMode === "browser"}
                onBack={() => {
                  window.location.assign(libraryRouteUrl(window.location.href));
                }}
                onProjectReady={updateRuntimeProject}
              />
            )
          ) : (
            <div className="web-shell">
              <a
                className="web-skip-link"
                href="#web-main"
                onClick={(event) => {
                  event.preventDefault();
                  mainRef.current?.focus();
                }}
              >
                {l("Pular para o conteúdo", "Skip to content")}
              </a>
              {menuOpen && (
                <button
                  className="web-sidebar-scrim"
                  aria-label={l("Fechar navegação", "Close navigation")}
                  onClick={() => setMenuOpen(false)}
                />
              )}
              <aside
                id="web-sidebar"
                className={`web-sidebar ${menuOpen ? "is-open" : ""}`}
              >
                <button
                  className="web-brand"
                  onClick={() => navigate("overview")}
                  aria-label="Onun Kodety"
                >
                  <Logo className="web-brand-logo" />
                  <small>Studio</small>
                </button>
                <p className="web-nav-label">WORKSPACE</p>
                <nav aria-label={l("Navegação principal", "Main navigation")}>
                  {pages.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.id)}
                      className={`web-nav-item ${view === item.id ? "is-active" : ""}`}
                      aria-current={view === item.id ? "page" : undefined}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      {item.count !== undefined && <small>{item.count}</small>}
                    </button>
                  ))}
                </nav>
                <div className="web-sidebar-bottom">
                  <div className="web-safety-card">
                    <span className="web-safety-icon">
                      <Icon name="shield" />
                    </span>
                    <strong>
                      {l(
                        "Crie aqui. Leve para onde quiser.",
                        "Create here. Take it anywhere.",
                      )}
                    </strong>
                    <p>
                      {l(
                        "Seus projetos ficam neste dispositivo. Exporte HTML ou leve o ZIP para o WordPress.",
                        "Your projects stay on this device. Export HTML or take a ZIP to WordPress.",
                      )}
                    </p>
                    <button
                      onClick={() => setForm("create")}
                      disabled={!loaded || !!loadError || busy || !!unsupported}
                    >
                      {l("Novo projeto", "New project")}
                      <Icon name="arrow" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="web-sidebar-link"
                    onClick={() => {
                      setMenuOpen(false);
                      setOnboarding(true);
                    }}
                  >
                    <Icon name="help" />
                    {l("Como funciona", "How it works")}
                    <Icon name="arrow" />
                  </button>

                </div>
              </aside>
              <div className="web-content-shell">
                <header className="web-topbar">
                  <button
                    className="web-icon-button web-mobile-menu"
                    aria-label={l("Abrir navegação", "Open navigation")}
                    aria-controls="web-sidebar"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((value) => !value)}
                  >
                    <Icon name="menu" />
                  </button>
                  <div className="web-breadcrumb">
                    <span>Workspace</span>
                    <Icon name="chevron" />
                    <strong>{page.label}</strong>
                  </div>
                  <div className="web-topbar-actions">
                    <button
                      className="web-language-button"
                      title={l("Mudar para inglês", "Switch to Portuguese")}
                      aria-label={l(
                        "Mudar para inglês",
                        "Switch to Portuguese",
                      )}
                      onClick={() =>
                        changeLanguage(language === "pt" ? "en" : "pt")
                      }
                    >
                      <Icon name="globe" />
                      {language === "pt" ? "PT" : "EN"}
                    </button>
                  </div>
                </header>
                <main
                  id="web-main"
                  className="web-main"
                  ref={mainRef}
                  tabIndex={-1}
                >
                  <div className="web-content">
                    <header className="web-page-heading">
                      <div>
                        <span className="web-tile-icon">
                          <Icon name={page.icon} />
                        </span>
                        <h1>{page.label}</h1>
                        <p>
                          {view === "overview"
                            ? l(
                                "Um espaço para suas ideias virarem projetos.",
                                "A space to turn your ideas into projects.",
                              )
                            : view === "settings"
                              ? l(
                                  "Preferências, ambiente e proteção do seu trabalho.",
                                  "Preferences, environment and protection for your work.",
                                )
                              : view === "favorites"
                                ? l(
                                    "Seus projetos essenciais, sempre por perto.",
                                    "Your essential projects, always close by.",
                                  )
                                : l(
                                    "Organize, encontre e continue de onde parou.",
                                    "Organize, find and pick up where you left off.",
                                  )}
                        </p>
                      </div>
                      {view !== "settings" && (
                        <button
                          className="web-button is-primary"
                          onClick={() => setForm("create")}
                          disabled={
                            !loaded || !!loadError || busy || !!unsupported
                          }
                        >
                          <Icon name="plus" />
                          {l("Novo projeto", "New project")}
                        </button>
                      )}
                    </header>
                    {view === "local" && <Notice tone="info">{l("Projetos anteriores deste dispositivo. Eles continuam salvos como antes e não são enviados à nuvem automaticamente.", "Existing projects on this device. They remain saved as before and are not uploaded automatically.")}</Notice>}
                    {routeError && <Notice>{routeError} <button type="button" className="web-text-button" onClick={() => navigate("projects")}>{l("Todos os projetos", "All projects")}</button></Notice>}
                    <OfflineAvailability language={language} />
                    {!online && (
                      <Notice tone="info">
                        {l(
                          "Você está offline. Abra um projeto já preparado para continuar editando. Publicações e serviços externos precisam de internet.",
                          "You are offline. Open a prepared project to keep editing. Publishing and external services need internet.",
                        )}
                      </Notice>
                    )}
                    {unsupported && <Notice>{unsupported}</Notice>}
                    {error && (
                      <div className="web-dismissible-notice">
                        <Notice>{error}</Notice>
                        <button
                          className="web-icon-button"
                          aria-label={l("Dispensar aviso", "Dismiss notice")}
                          onClick={() => setError("")}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    )}
                    {!loaded ? (
                      <KodetyLoadingScreen className="min-h-[280px]" label={l("Carregando projetos", "Loading projects")} />
                    ) : loadError ? (
                      <div className="web-library-error">
                        <Notice>{loadError}</Notice>
                        <div>
                          <button className="web-button" onClick={refresh}>
                            <Icon name="refresh" />
                            {l("Tentar novamente", "Try again")}
                          </button>
                          <button
                            className="web-button"
                            onClick={downloadCatalog}
                          >
                            <Icon name="download" />
                            {l(
                              "Baixar catálogo original",
                              "Download original catalog",
                            )}
                          </button>
                        </div>
                      </div>
                    ) : view === "settings" ? (
                      <Settings
                        language={language}
                        onLanguageChange={changeLanguage}
                        layout={layout}
                        onLayout={changeLayout}
                        projects={localProjects}
                      />
                    ) : (
                      <>
                        {view === "overview" && (
                          <section
                            className="web-metrics"
                            aria-label={l(
                              "Resumo da biblioteca",
                              "Library summary",
                            )}
                          >
                            <div>
                              <span>
                                <Icon name="folder" />
                                {l("Total de projetos", "Total projects")}
                              </span>
                              <strong>
                                {projects.length
                                  .toString()
                                  .padStart(2, "0")}
                              </strong>
                              <small>
                                {l(
                                  "Seus projetos na mesma biblioteca",
                                  "Your projects in one library",
                                )}
                              </small>
                            </div>
                            <div>
                              <span>
                                <Icon name="check" />
                                {l("Prontos para editar", "Ready to edit")}
                              </span>
                              <strong>
                                {readyCount.toString().padStart(2, "0")}
                              </strong>
                              <small>
                                {l(
                                  "Projetos já preparados para o Builder",
                                  "Projects already prepared for the Builder",
                                )}
                              </small>
                            </div>
                            <div>
                              <span>
                                <Icon name="star" />
                                {l("Favoritos", "Favorites")}
                              </span>
                              <strong>
                                {favorites.toString().padStart(2, "0")}
                              </strong>
                              <small>
                                {l(
                                  "Acesso rápido ao que importa",
                                  "Quick access to what matters",
                                )}
                              </small>
                            </div>
                          </section>
                        )}
                        <section className="web-library">
                          <header className="web-library-heading">
                            <h2>
                              {view === "overview"
                                ? l("Projetos recentes", "Recent projects")
                                : page.label}
                              <span>
                                {view === "favorites"
                                  ? favorites
                                  : projects.length}
                              </span>
                            </h2>
                            {view === "overview" && projects.length > 6 && (
                              <button
                                className="web-text-button"
                                onClick={() => navigate("projects")}
                              >
                                {l("Ver todos", "View all")}
                                <Icon name="arrow" />
                              </button>
                            )}
                          </header>
                          <div className="web-library-toolbar">
                            <label className="web-search">
                              <Icon name="search" />
                              <input
                                ref={searchRef}
                                placeholder={l(
                                  "Buscar projetos…",
                                  "Search projects…",
                                )}
                                aria-label={l(
                                  "Buscar projetos",
                                  "Search projects",
                                )}
                                value={query}
                                onChange={(event) =>
                                  setQuery(event.target.value)
                                }
                              />
                              {query ? (
                                <button
                                  className="web-icon-button"
                                  aria-label={l("Limpar busca", "Clear search")}
                                  onClick={() => {
                                    setQuery("");
                                    searchRef.current?.focus();
                                  }}
                                >
                                  <Icon name="close" />
                                </button>
                              ) : (
                                <kbd>⌘ K</kbd>
                              )}
                            </label>
                            <div className="web-toolbar-options">
                              <Select<typeof sort>
                                label={l("Ordenar projetos", "Sort projects")}
                                value={sort}
                                onValueChange={setSort}
                                options={[
                                  {
                                    value: "recent",
                                    label: l("Mais recentes", "Most recent"),
                                  },
                                  {
                                    value: "name",
                                    label: l("Nome: A–Z", "Name: A–Z"),
                                  },
                                  {
                                    value: "created",
                                    label: l("Data de criação", "Date created"),
                                  },
                                ]}
                              />
                              <div
                                className="web-layout-toggle"
                                role="group"
                                aria-label={l("Visualização", "View")}
                              >
                                <button
                                  className="web-icon-button"
                                  aria-label={l(
                                    "Visualização em grade",
                                    "Grid view",
                                  )}
                                  aria-pressed={layout === "grid"}
                                  onClick={() => changeLayout("grid")}
                                >
                                  <Icon name="grid" />
                                </button>
                                <button
                                  className="web-icon-button"
                                  aria-label={l(
                                    "Visualização em lista",
                                    "List view",
                                  )}
                                  aria-pressed={layout === "list"}
                                  onClick={() => changeLayout("list")}
                                >
                                  <Icon name="list" />
                                </button>
                              </div>
                            </div>
                          </div>
                          {displayed.length === 0 ? (
                            <div
                              className={`web-empty ${projects.length ? "is-filtered" : ""}`}
                            >
                              <div className="web-empty-art" aria-hidden="true">
                                <span />
                                <span />
                                <div>
                                  <Icon
                                    name={
                                      query
                                        ? "search"
                                        : view === "favorites"
                                          ? "star"
                                          : "folder"
                                    }
                                  />
                                </div>
                              </div>
                              <h2>
                                {query
                                  ? l(
                                      "Nenhum projeto encontrado",
                                      "No projects found",
                                    )
                                  : view === "favorites"
                                    ? l(
                                        "Seus favoritos começam aqui",
                                        "Your favorites start here",
                                      )
                                    : l(
                                        "Seu próximo projeto começa aqui",
                                        "Your next project starts here",
                                      )}
                              </h2>
                              <p>
                                {query
                                  ? l(
                                      "Tente outro nome ou limpe a busca para ver sua biblioteca.",
                                      "Try another name or clear the search to see your library.",
                                    )
                                  : view === "favorites"
                                    ? l(
                                        "Marque a estrela em um projeto para encontrá-lo aqui.",
                                        "Star a project to find it here.",
                                      )
                                    : l(
                                        "Crie um projeto local e exporte um ZIP para continuar em outro dispositivo.",
                                        "Create a local project and export a ZIP to continue on another device.",
                                      )}
                              </p>
                              {query ? (
                                <button
                                  className="web-button"
                                  onClick={() => setQuery("")}
                                >
                                  {l("Limpar busca", "Clear search")}
                                </button>
                              ) : view === "favorites" ? (
                                <button
                                  className="web-button"
                                  onClick={() => navigate("projects")}
                                >
                                  {l("Explorar projetos", "Explore projects")}
                                  <Icon name="arrow" />
                                </button>
                              ) : (
                                <button
                                  className="web-button is-primary"
                                  onClick={() => setForm("create")}
                                  disabled={busy || !!unsupported}
                                >
                                  <Icon name="plus" />
                                  {l(
                                    "Criar meu primeiro projeto",
                                    "Create my first project",
                                  )}
                                </button>
                              )}
                              {!query && view !== "favorites" && (
                                <div className="web-empty-features">
                                  <span>
                                    <Icon name="shield" />
                                    {l("Armazenamento local", "Local storage")}
                                  </span>
                                  <span>
                                    <Icon name="widget" />
                                    {l("Builder incluído", "Builder included")}
                                  </span>
                                  <span>
                                    <Icon name="external" />
                                    {l(
                                      "Pronto para exportar",
                                      "Ready to export",
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div
                              className={`web-projects is-${layout}`}
                              aria-label={l(
                                view === "local" ? "Projetos locais" : "Projetos",
                                view === "local" ? "Local projects" : "Projects",
                              )}
                            >
                              {displayed.map((project) => (
                                <ProjectTile
                                  key={project.id}
                                  project={project}
                                  language={language}
                                  busy={busy}
                                  onOpen={() => open(project)}
                                  onRename={() => setForm(project)}
                                  onDelete={() => void action(async () => {
                                    const { projectForDeletion } = await import("./project-deletion");
                                    const target = await projectForDeletion(project);
                                    if (target.mode === "html") setDeleting(target);
                                    else {
                                      const url = new URL("./project-storage.html", window.location.href);
                                      url.searchParams.set("project", target.id);
                                      window.location.assign(url.href);
                                    }
                                  })}
                                  onFavorite={() =>
                                    void action(async () => {
                                      setProjects(
                                        await repository.patch(project.id, {
                                          favorite: !project.favorite,
                                        }),
                                      );
                                    })
                                  }
                                />
                              ))}
                            </div>
                          )}
                          {query && (
                            <p className="web-result-count" role="status">
                              {l(
                                visible.length === 1
                                  ? "1 projeto encontrado"
                                  : `${visible.length} projetos encontrados`,
                                visible.length === 1
                                  ? "1 project found"
                                  : `${visible.length} projects found`,
                              )}
                            </p>
                          )}
                        </section>
                        <footer className="web-content-footer">
                          <span>
                            <Icon name="shield" />
                            {l(
                              "Seu projeto é privado. Publicar e exportar continuam sendo escolhas suas.",
                              "Your project is private. You choose when to publish or export.",
                            )}
                          </span>
                        </footer>
                      </>
                    )}
                  </div>
                </main>
              </div>
            </div>
          )}
          {manualBackupProject && <Dialog title={l("Continuar com backup ZIP?", "Continue with ZIP backups?")} description={manualBackupProject.name} closeLabel={l("Fechar", "Close")} onClose={() => setManualBackupProject(null)} busy={busy}>
            <div className="web-form-body"><ManualBackupConfirmation l={l} checked={manualBackupConfirmed} onChange={setManualBackupConfirmed} disabled={busy} />{error && <Notice>{error}</Notice>}</div>
            <footer className="web-dialog-footer">
              <button className="web-button" disabled={busy} onClick={() => setManualBackupProject(null)}>{l("Cancelar", "Cancel")}</button>
              <button className="web-button is-primary" disabled={busy || !manualBackupConfirmed} onClick={() => void action(async () => {
                const unsupported = browserSupport(l, manualBackupProject.mode);
                if (unsupported) throw new Error(unsupported);
                if (!manualBackupProject.initialized && !navigator.onLine) throw new Error(l("Conecte-se à internet para iniciar o ambiente deste projeto.", "Connect to the internet to start this project environment."));
                const latest = await repository.patch(manualBackupProject.id, {storageMode:"browser",manualBackupAcknowledgedAt:Date.now(),lastOpenedAt:Date.now()});
                setProjects(latest);enterProject(latest.find(item=>item.id===manualBackupProject.id)!);setManualBackupProject(null);
              })}>{l("Confirmar e continuar", "Confirm and continue")}</button>
            </footer>
          </Dialog>}
          {form && (
            <ProjectForm
              key={form === "create" ? "create" : form.id}
              project={form === "create" ? undefined : form}
              projects={projects}
              language={language}
              initialMode={defaultProjectMode}
              onClose={() => setForm(null)}
              onSubmit={submitProject}
            />
          )}
          {deleting?.mode === "html" ? (
            <Dialog
              title={l("Remover da biblioteca", "Remove from library")}
              description={deleting.name}
              closeLabel={l("Fechar", "Close")}
              onClose={() => setDeleting(null)}
              busy={busy}
            >
              <div className="web-form-body">
                <p>
                  {deleting.storageMode === "browser" ? l("O projeto salvo neste navegador será apagado. Baixe o backup ZIP antes de remover; os ZIPs já baixados permanecem no seu dispositivo.", "The project saved in this browser will be deleted. Download a backup ZIP before removing it; previously downloaded ZIPs stay on your device.") : l(
                    "Os arquivos HTML permanecem na sua pasta. Apenas o vínculo com a biblioteca será removido.",
                    "Your HTML files stay in your folder. Only the library entry is removed.",
                  )}
                </p>
                {error && <Notice>{error}</Notice>}
              </div>
              <footer className="web-dialog-footer">
                <button
                  className="web-button"
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  {l("Cancelar", "Cancel")}
                </button>
                <button
                  className="web-button is-primary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const { forgetHtmlDirectory } =
                        await import("./html-directory");
                      await forgetHtmlDirectory(deleting.id);
                      setProjects(await repository.remove(deleting.id));
                      setDeleting(null);
                    })
                  }
                >
                  {busy ? l("Removendo…", "Removing…") : l("Remover da biblioteca", "Remove from library")}
                </button>
              </footer>
            </Dialog>
          ) : null}
        </Suspense>
      </div>
    </StudioI18nProvider>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    const l = copyFor(loadStudioEntryPreferences().language);
    return this.state.error ? (
      <div className="web-fatal">
        <Mark />
        <h1>{l("Não foi possível abrir o Studio", "Could not open Studio")}</h1>
        <p>
          {l(
            "Recarregue a página para tentar novamente.",
            "Reload the page to try again.",
          )}
        </p>
        <button
          className="web-button is-primary"
          onClick={() => window.location.reload()}
        >
          {l("Recarregar", "Reload")}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function StudioWebApp() {
  return (
    <AppErrorBoundary>
      <WebApp />
    </AppErrorBoundary>
  );
}
