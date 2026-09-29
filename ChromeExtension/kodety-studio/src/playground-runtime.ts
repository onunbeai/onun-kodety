import {
  installPlugin,
  login,
  setSiteLanguage,
  startPlaygroundWeb,
  type MountDescriptor,
  type PlaygroundClient,
} from '@wp-playground/client';
import { studioText } from './i18n';
import { KODETY_PLUGIN_VERSION } from './product-versions';
import { restorePersistedProject, wordpressVersionFromSource } from './project-restore';
import { preparePlaygroundOfflineCache } from './offline-runtime';
import {
  opfsPathForProject,
  projectPathSlug,
  KODETY_STUDIO_RUNTIME_REVISION,
  type KodetyStudioProject,
  type StudioLanguage,
} from './storage';

export const PLAYGROUND_REMOTE_ORIGIN = 'https://playground.wordpress.net';
const PLAYGROUND_REMOTE_URL = `${PLAYGROUND_REMOTE_ORIGIN}/remote.html`;
const WORDPRESS_MOUNTPOINT = '/wordpress';
const WORDPRESS_ADMIN_PATH = '/wp-admin/';
const KODETY_BUILDER_PATH = '/kodety/editor/';
const STORAGE_PERSISTENCE_BRIDGE_PATH = '/wordpress/wp-content/mu-plugins/kodety-studio-storage-persistence.php';

const STORAGE_PERSISTENCE_BRIDGE = `<?php
/**
 * Requests durable browser storage from the exact origin that owns Playground's
 * OPFS. The Studio shell runs on a different origin when the public Playground
 * runtime is embedded, so requesting persistence only in the parent would not
 * protect the WordPress filesystem.
 */
defined('ABSPATH') || exit;

if (!function_exists('kodety_studio_storage_persistence_markup')) {
    function kodety_studio_storage_persistence_markup(): string {
        $runtime = get_option('kodety_browser_runtime', null);
        if (
            !is_array($runtime)
            || empty($runtime['enabled'])
            || ($runtime['kind'] ?? '') !== 'kodety-studio-browser'
            || empty($runtime['projectId'])
            || empty($runtime['studioOrigin'])
        ) return '';
        $project_id = sanitize_text_field((string) $runtime['projectId']);
        $markup = <<<'KODETY_STORAGE_MARKUP'
        <script id="kodety-studio-storage-persistence">
        (() => {
          if (window.__kodetyStudioStoragePersistenceLoaded) return;
          window.__kodetyStudioStoragePersistenceLoaded = true;
          const projectId = __KODETY_STUDIO_PROJECT_ID__;
          // A new server-rendered document has replaced the previous admin
          // form. This does not claim that a ZIP was created or is current.
          try {
            window.top.postMessage({ source: 'kodety-studio-wordpress', version: 1, type: 'admin-document-ready', projectId }, '*');
          } catch (_) {}
          // WordPress forms can contain unsaved edits before a request or
          // navigation occurs. Only user input inside wp-admin invalidates the
          // ZIP here; the Builder reports its own persistent project changes.
          if (__KODETY_STUDIO_IS_ADMIN__) {
            const reportAdminChange = event => {
              if (!event.isTrusted) return;
              try {
                window.top.postMessage({ source: 'kodety-studio-wordpress', version: 1, type: 'project-changed', projectId, pendingAdminDraft: true }, '*');
              } catch (_) {}
            };
            for (const eventType of ['input', 'change', 'submit']) {
              document.addEventListener(eventType, reportAdminChange, { capture: true });
            }
          }
          const report = status => {
            try {
              window.top.postMessage({
                source: 'kodety-studio-wordpress',
                version: 1,
                type: 'storage-persistence',
                projectId,
                status,
              }, '*');
            } catch (_) {}
          };
          const inspect = async () => {
            if (!navigator.storage || typeof navigator.storage.persisted !== 'function') {
              report('unsupported');
              return;
            }
            try {
              report(await navigator.storage.persisted() ? 'granted' : 'prompt');
            } catch (_) {
              report('error');
            }
          };
          const request = async () => {
            if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
              report('unsupported');
              return;
            }
            try {
              if (typeof navigator.storage.persisted === 'function' && await navigator.storage.persisted()) {
                report('granted');
                return;
              }
              report(await navigator.storage.persist() ? 'granted' : 'denied');
            } catch (_) {
              report('denied');
            }
          };
          void inspect();
          const prepareOffline = ${preparePlaygroundOfflineCache.toString()};
          void prepareOffline(__KODETY_STUDIO_PHP_VERSION__).then(result => {
            window.top.postMessage({ source: 'kodety-studio-wordpress', version: 1, type: 'offline-cache', projectId, status: 'ready', files: result.files }, '*');
          }).catch(error => {
            window.top.postMessage({ source: 'kodety-studio-wordpress', version: 1, type: 'offline-cache', projectId, status: 'error', message: error instanceof Error ? error.message : 'Não foi possível preparar o WordPress offline.' }, '*');
          });
          window.addEventListener('pointerdown', () => void request(), { once: true, capture: true });
        })();
        </script>
KODETY_STORAGE_MARKUP;
        return str_replace(
            ['__KODETY_STUDIO_PROJECT_ID__', '__KODETY_STUDIO_PHP_VERSION__', '__KODETY_STUDIO_IS_ADMIN__'],
            [(string) wp_json_encode($project_id), (string) wp_json_encode(PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION), is_admin() ? 'true' : 'false'],
            $markup
        );
    }

    function kodety_studio_render_storage_persistence_bridge(): void {
        echo kodety_studio_storage_persistence_markup();
    }

    function kodety_studio_inject_storage_persistence_bridge(string $html): string {
        if (stripos($html, '<html') === false || stripos($html, '</head>') === false) return $html;
        if (strpos($html, 'id="kodety-studio-storage-persistence"') !== false) return $html;
        $markup = kodety_studio_storage_persistence_markup();
        if ($markup === '') return $html;
        return (string) preg_replace('~</head>~i', $markup . '</head>', $html, 1);
    }

    function kodety_studio_buffer_custom_app_bridge(): void {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) return;
        if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') return;
        $path = (string) wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
        if (!preg_match('~/kodety(?:/|$)~', $path)) return;
        ob_start('kodety_studio_inject_storage_persistence_bridge');
    }
    function kodety_studio_buffer_custom_admin_bridge(): void {
        if (wp_doing_ajax() || strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') return;
        $page = isset($_GET['page']) && is_string($_GET['page']) ? $_GET['page'] : '';
        if (strpos($page, 'kodety') !== 0) return;
        // Kodety onboarding renders a full document on load-$hook and exits
        // before WordPress calls admin_head. Buffer that document as well.
        ob_start('kodety_studio_inject_storage_persistence_bridge');
    }
    add_action('wp_head', 'kodety_studio_render_storage_persistence_bridge', 1);
    add_action('admin_head', 'kodety_studio_render_storage_persistence_bridge', 1);
    add_action('login_head', 'kodety_studio_render_storage_persistence_bridge', 1);
    add_action('template_redirect', 'kodety_studio_buffer_custom_app_bridge', 0);
    add_action('admin_init', 'kodety_studio_buffer_custom_admin_bridge', 0);
}
`;

export function projectLockName(projectId: string): string {
  return `kodety-studio:project:${projectId}`;
}

export type RuntimeStage =
  | 'runtime'
  | 'wordpress'
  | 'kodety'
  | 'storage'
  | 'ready';

export type BootProjectOptions = {
  iframe: HTMLIFrameElement;
  project: KodetyStudioProject;
  language: StudioLanguage;
  onStage(stage: RuntimeStage, detail?: string): void;
  signal?: AbortSignal;
  onPersisted?(project: KodetyStudioProject): Promise<void>;
  prepareOffline?: boolean;
  restoreFirstBoot?(client: PlaygroundClient): Promise<void>;
};

export type BootedProject = {
  client: PlaygroundClient;
  initializedNow: boolean;
  runtimeVersions: Pick<KodetyStudioProject, 'phpVersion' | 'wordpressVersion' | 'kodetyVersion' | 'wordpressLocale'>;
  runtimeRevision: number;
};

export type DestroyProjectOptions = {
  iframe: HTMLIFrameElement;
  project: KodetyStudioProject;
  language: StudioLanguage;
  onStage(detail: string): void;
};

function mountDescriptor(project: KodetyStudioProject, initialSyncDirection: MountDescriptor['initialSyncDirection']): MountDescriptor {
  return {
    device: {
      type: 'opfs',
      path: opfsPathForProject(project.id),
    },
    mountpoint: WORDPRESS_MOUNTPOINT,
    initialSyncDirection,
  };
}

function errorMessage(error: unknown, language: StudioLanguage): string {
  if (error instanceof Error && error.message) {
    if (/missing the MySQL extension|mysqli|Requirements Not Met/i.test(error.message)) {
      return studioText(language, 'A integração SQLite deste projeto não foi carregada. O Studio vai repará-la ao tentar novamente.');
    }
    return error.message.length > 520
      ? `${error.message.slice(0, 517)}…`
      : error.message;
  }
  return studioText(language, 'Não foi possível iniciar o WordPress local.');
}

function encodeBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function needsBundledPlugin(installedVersion: string, runtimeRevision: number): boolean {
  const installed = installedVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)?.slice(1).map(Number);
  const bundled = KODETY_PLUGIN_VERSION.split('.').map(Number);
  if (!installed) return true;
  for (let index = 0; index < bundled.length; index++) {
    if (installed[index] > bundled[index]) return false;
    if (installed[index] < bundled[index]) return true;
  }
  return runtimeRevision < KODETY_STUDIO_RUNTIME_REVISION;
}

export async function recoverInterruptedMaintenance(client: PlaygroundClient, language: StudioLanguage): Promise<void> {
  const marker = '/wordpress/.maintenance';
  if (!await client.fileExists(marker)) return;
  const source = await client.readFileAsText(marker);
  // A newly acquired project runtime has no updater running. Preserve the
  // standard marker of an interrupted update instead of letting wp-load exit
  // before it can inspect the database. Do not execute or alter custom markers.
  if (!/^\s*<\?php\s+\$upgrading\s*=\s*\d+\s*;\s*(?:\?>\s*)?$/.test(source)) {
    throw new Error(language === 'pt'
      ? 'O projeto contém um modo de manutenção personalizado. Seus arquivos foram preservados; verifique a atualização interrompida.'
      : 'The project contains a custom maintenance mode. Its files were preserved; check the interrupted update.');
  }
  await client.mv(marker, `${marker}.kodety-interrupted-${Date.now()}-${crypto.randomUUID()}`);
}

async function installStoragePersistenceBridge(client: PlaygroundClient): Promise<void> {
  const muPluginsDirectory = '/wordpress/wp-content/mu-plugins';
  if (!await client.isDir(muPluginsDirectory)) await client.mkdir(muPluginsDirectory);
  await client.writeFile(STORAGE_PERSISTENCE_BRIDGE_PATH, new TextEncoder().encode(STORAGE_PERSISTENCE_BRIDGE));
}

export async function bootProject({ iframe, project, language, onStage, signal, onPersisted, prepareOffline = false, restoreFirstBoot }: BootProjectOptions): Promise<BootedProject> {
  const isFirstBoot = !project.initialized;
  let shouldInstallKodety = isFirstBoot;
  const t = (source: string, replacements?: Record<string, string | number>) => studioText(language, source, replacements);
  onStage('runtime', t('Carregando PHP WebAssembly'));

  try {
    signal?.throwIfAborted();
    let client: PlaygroundClient | null = null;
    let bootstrapWordpressVersion = project.wordpressVersion;
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      const bootedClient = await startPlaygroundWeb({
        iframe,
        remoteUrl: PLAYGROUND_REMOTE_URL,
        scope: `kodety-studio-${project.id.replace(/[^a-z0-9]/gi, '').slice(0, 28)}`,
        disableProgressBar: true,
        detailedProgressCaptions: true,
        // Bootstrap the runtime without mounting any saved project. Playground's
        // installer and generic database preflight must never operate on saved
        // files: a maintenance marker or PHP failure can otherwise be mistaken
        // for an uninstalled database. Restore only after SQLite is ready.
        wordpressInstallMode: 'download-and-install',
        blueprint: {
          preferredVersions: {
            php: project.phpVersion,
            wp: bootstrapWordpressVersion,
          },
          features: {
            networking: true,
          },
          login: isFirstBoot,
          // Wait for bootstrap prefetch before replacing /wordpress in memory.
          landingPage: isFirstBoot ? '/wp-admin/' : '/wp-admin/kodety-studio-bootstrap.html',
          ...(isFirstBoot
            ? {
              siteOptions: {
                blogname: project.name,
              },
              steps: project.wordpressLocale === 'pt_BR'
                ? [{ step: 'setSiteLanguage' as const, language: 'pt_BR' }]
                : [],
            }
            : {
              // The temporary landing document is inert while /wordpress is
              // replaced. Its admin path also makes Playground await prefetch.
              steps: [{
                step: 'writeFile' as const,
                path: '/wordpress/wp-admin/kodety-studio-bootstrap.html',
                data: '<!doctype html><meta charset="utf-8"><title>Onun Kodety</title>',
              }],
            }),
        },
      });

      signal?.throwIfAborted();
      // Only /internal runtime state changes here; no project files are mounted.
      await bootedClient.defineConstant('KODETY_BROWSER_STUDIO_RUNTIME', project.id);
      onStage('wordpress', isFirstBoot ? t('Instalando WordPress e SQLite') : t('Abrindo arquivos do projeto'));
      if (isFirstBoot) {
        client = bootedClient;
        break;
      }

      // Playground fixes its remote static-asset mapping during bootstrap.
      // A native WordPress update can leave shell metadata on an older version.
      // Read both version files without running the saved WordPress, and align
      // the temporary runtime before any maintenance recovery or plugin writes.
      const temporaryVersion = wordpressVersionFromSource(
        await bootedClient.readFileAsText('/wordpress/wp-includes/version.php'),
      );
      if (!temporaryVersion) throw new Error(t('Não foi possível iniciar o WordPress local.'));
      signal?.throwIfAborted();
      const restored = await restorePersistedProject(
        bootedClient,
        mountDescriptor(project, 'opfs-to-memfs'),
        { projectId: project.id, language },
      );
      signal?.throwIfAborted();
      if (restored.wordpressVersion === temporaryVersion) {
        client = bootedClient;
        break;
      }

      // Restoration performed reads only. The mount journal is empty, so
      // unmounting discards this runtime without copying temporary site files
      // or changing the saved project before retrying with its actual version.
      await bootedClient.unmountOpfs(WORDPRESS_MOUNTPOINT);
      iframe.src = 'about:blank';
      signal?.throwIfAborted();
      if (attempt === 1) {
        throw new Error(language === 'pt'
          ? 'A versão do WordPress carregada não corresponde aos arquivos salvos. O projeto foi preservado; tente novamente quando essa versão estiver disponível.'
          : 'The loaded WordPress version does not match the saved files. The project was preserved; try again when that version is available.');
      }
      bootstrapWordpressVersion = restored.wordpressVersion;
      onStage('runtime', t('Carregando PHP WebAssembly'));
    }
    if (!client) throw new Error(t('Não foi possível iniciar o WordPress local.'));

    // The marker lives only in PHP-WASM memory, never OPFS or a transfer ZIP.
    if (!isFirstBoot) {
      await recoverInterruptedMaintenance(client, language);
      // Native updates can change the installed version before shell metadata
      // is refreshed. Inspect the plugin itself to avoid undoing those updates.
      const pluginPath = '/wordpress/wp-content/plugins/kodety/kodety.php';
      const installedVersion = await client.fileExists(pluginPath)
        ? (await client.readFileAsText(pluginPath)).match(/^[ \t/*#@]*Version:\s*(\S+)/mi)?.[1] || ''
        : '';
      shouldInstallKodety = needsBundledPlugin(installedVersion, project.runtimeRevision);
    }

    if (isFirstBoot) {
      if (project.wordpressLocale === 'pt_BR') {
        onStage('wordpress', t('Configurando Português do Brasil'));
        // The Blueprint step is authoritative. This explicit check keeps the
        // locale deterministic if a Playground release ever skips Blueprint
        // steps while installing a fresh OPFS site.
        const localeCheck = await client.run({
          code: `<?php require_once '/wordpress/wp-load.php'; echo get_locale();`,
        });
        const activeLocale = new TextDecoder().decode(localeCheck.bytes).trim();
        if (activeLocale !== 'pt_BR') await setSiteLanguage(client, { language: 'pt_BR' });
      }
    }

    if (isFirstBoot && restoreFirstBoot) {
      signal?.throwIfAborted();
      await restoreFirstBoot(client);
      signal?.throwIfAborted();
    }

    if (shouldInstallKodety) {
      signal?.throwIfAborted();
      onStage('kodety', t(isFirstBoot ? 'Instalando e ativando o Kodety' : 'Atualizando o Kodety local'));
      const pluginResponse = await fetch('./assets/kodety.zip', { signal });
      if (!pluginResponse.ok) {
        throw new Error(t('O pacote do Kodety não foi encontrado ({status}).', { status: pluginResponse.status }));
      }
      const pluginFile = new File([await pluginResponse.arrayBuffer()], 'kodety.zip', {
        type: 'application/zip',
      });
      await installPlugin(client, {
        pluginData: pluginFile,
        ifAlreadyInstalled: 'overwrite',
        options: {
          activate: true,
          targetFolderName: 'kodety',
          humanReadableName: 'Kodety',
          onError: 'throw',
        },
      });

    }

    if (isFirstBoot) {
      signal?.throwIfAborted();
      onStage('storage', t('Criando o armazenamento persistente'));
      await client.mountOpfs(mountDescriptor(project, 'memfs-to-opfs'));
      await client.flushOpfs(WORDPRESS_MOUNTPOINT);
      signal?.throwIfAborted();
      // Record the durable filesystem before later setup. A retry must restore
      // these files, never overwrite them with another fresh installation.
      await onPersisted?.({ ...project, initialized: true, updatedAt: Date.now() });
    }

    if (prepareOffline) {
      signal?.throwIfAborted();
      onStage('storage', t('Preparando arquivos do WordPress para uso offline'));
      // Minified Playground builds omit many wp-admin static files and fetch
      // them lazily. Store them in the project before an offline session can
      // navigate to an administration screen it has never opened before.
      await client.backfillStaticFilesRemovedFromMinifiedBuild();
      signal?.throwIfAborted();
    }

    // This must live inside WordPress, not only in the Studio parent page. The
    // rendered script runs on Playground's origin and therefore asks the browser
    // to protect the same storage bucket that owns this project's OPFS files.
    await installStoragePersistenceBridge(client);
    signal?.throwIfAborted();

    const health = await client.run({
      code: `<?php
        require_once '/wordpress/wp-load.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        global $wp_version;
        echo 'KODETY_HEALTH:' . base64_encode(wp_json_encode([
          'active' => is_plugin_active('kodety/kodety.php'),
          'kodetyVersion' => defined('KODETY_VERSION') ? KODETY_VERSION : '',
          'wordpressVersion' => (string) $wp_version,
          'phpVersion' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
          'wordpressLocale' => get_locale() === 'pt_BR' ? 'pt_BR' : 'en_US',
        ]));
      `,
    });
    const healthText = new TextDecoder().decode(health.bytes);
    const healthPayload = healthText.match(/KODETY_HEALTH:([A-Za-z0-9+/=]+)/)?.[1];
    const runtimeVersions = healthPayload
      ? JSON.parse(atob(healthPayload)) as Pick<KodetyStudioProject, 'phpVersion' | 'wordpressVersion' | 'kodetyVersion' | 'wordpressLocale'> & { active: boolean }
      : null;
    if (health.exitCode !== 0 || !runtimeVersions?.active) {
      const phpError = (health.errors || '').trim();
      throw new Error(phpError || t('O WordPress abriu, mas o plugin Kodety não ficou ativo.'));
    }

    const projectSlug = projectPathSlug(project);
    signal?.throwIfAborted();
    const browserRuntimePayload = encodeBase64Json({
      kind: 'kodety-studio-browser',
      enabled: true,
      projectId: project.id,
      projectName: project.name,
      projectSlug,
      displayPath: `/${projectSlug}`,
      studioOrigin: window.location.origin,
      studioLanguage: language,
      wordpressLocale: project.wordpressLocale,
    });
    const runtimeConfig = await client.run({
      code: `<?php
        require_once '/wordpress/wp-load.php';
        $payload = json_decode(base64_decode('${browserRuntimePayload}'), true);
        if (
          !is_array($payload)
          || empty($payload['enabled'])
          || ($payload['kind'] ?? '') !== 'kodety-studio-browser'
          || empty($payload['projectSlug'])
          || empty($payload['studioOrigin'])
        ) {
          fwrite(STDERR, 'Invalid Onun Kodety runtime metadata.');
          exit(1);
        }
        update_option('kodety_browser_runtime', $payload, false);
        echo 'KODETY_STUDIO_RUNTIME_READY';
      `,
    });
    if (runtimeConfig.exitCode !== 0) {
      throw new Error(t('Não foi possível iniciar o WordPress local.'));
    }

    try {
      await login(client, { username: 'admin', password: 'password' });
    } catch {
      // Playground usually preserves the authenticated session. A failed
      // explicit login must not hide an otherwise healthy persisted project.
    }

    // Persist the runtime bridge, plugin update and metadata before reporting ready.
    await client.flushOpfs(WORDPRESS_MOUNTPOINT);
    signal?.throwIfAborted();
    await client.goTo(isFirstBoot ? WORDPRESS_ADMIN_PATH : KODETY_BUILDER_PATH);
    return {
      client,
      initializedNow: isFirstBoot,
      runtimeVersions: {
        phpVersion: runtimeVersions.phpVersion,
        wordpressVersion: runtimeVersions.wordpressVersion,
        kodetyVersion: runtimeVersions.kodetyVersion,
        wordpressLocale: runtimeVersions.wordpressLocale,
      },
      runtimeRevision: KODETY_STUDIO_RUNTIME_REVISION,
    };
  } catch (error) {
    throw new Error(errorMessage(error, language), { cause: error });
  }
}

export async function flushProject(client: PlaygroundClient | null): Promise<void> {
  if (!client) return;
  await client.flushOpfs(WORDPRESS_MOUNTPOINT);
}

/**
 * Removes a project's persisted filesystem without ever installing WordPress.
 *
 * Deletion happens through the same remote origin that owns the OPFS data. The
 * caller must only remove the project's metadata after this promise resolves;
 * every failure is surfaced so a project can never silently disappear from the
 * library while its persistent data is still present.
 */
async function destroyProjectDataWithRuntime({ iframe, project, language, onStage }: DestroyProjectOptions): Promise<void> {
  const t = (source: string) => studioText(language, source);
  let client: PlaygroundClient | null = null;
  // An unreachable embedded origin or stalled RPC must return control to the
  // dialog. Await each operation through the deadline so a late bootstrap can
  // never continue into deletion after the user has already seen a failure.
  const waitForStorage = async <T,>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(t('A exclusão demorou para responder. Verifique sua conexão e tente novamente.'))), 60_000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  };

  try {
    onStage(t('Abrindo o armazenamento isolado'));
    client = await waitForStorage(startPlaygroundWeb({
      iframe,
      remoteUrl: PLAYGROUND_REMOTE_URL,
      scope: `kodety-studio-${project.id.replace(/[^a-z0-9]/gi, '').slice(0, 28)}`,
      disableProgressBar: true,
      detailedProgressCaptions: false,
      wordpressInstallMode: 'do-not-attempt-installing',
      blueprint: {
        preferredVersions: {
          php: project.phpVersion,
          // Deleting files must also work for incomplete WordPress imports,
          // arbitrary local folders and empty projects. Do not boot their PHP.
          wp: false,
        },
      },
    }));
    if (!await waitForStorage(client.isDir(WORDPRESS_MOUNTPOINT))) {
      await waitForStorage(client.mkdir(WORDPRESS_MOUNTPOINT));
    }
    await waitForStorage(client.mountOpfs(mountDescriptor(project, 'opfs-to-memfs')));

    onStage(t('Apagando arquivos do projeto'));
    const entries = await waitForStorage(client.listFiles(WORDPRESS_MOUNTPOINT, { prependPath: true }));
    const children = entries.filter(path => (
      path !== WORDPRESS_MOUNTPOINT && path.startsWith(`${WORDPRESS_MOUNTPOINT}/`)
    ));

    for (const path of children) {
      if (await waitForStorage(client.isDir(path))) {
        await waitForStorage(client.rmdir(path, { recursive: true }));
      } else {
        await waitForStorage(client.unlink(path));
      }
    }

    const remainingEntries = await waitForStorage(client.listFiles(WORDPRESS_MOUNTPOINT, { prependPath: true }));
    if (remainingEntries.some(path => path !== WORDPRESS_MOUNTPOINT)) {
      throw new Error(t('Alguns arquivos do projeto não puderam ser apagados.'));
    }

    onStage(t('Confirmando a exclusão no navegador'));
    await waitForStorage(client.flushOpfs(WORDPRESS_MOUNTPOINT));
    await waitForStorage(client.unmountOpfs(WORDPRESS_MOUNTPOINT));
    iframe.src = 'about:blank';
  } catch (error) {
    // Do not flush or unmount here: both operations can persist a partially
    // completed in-memory deletion. Discarding the iframe abandons that runtime
    // and leaves metadata untouched so the user can safely retry.
    iframe.src = 'about:blank';
    const message = errorMessage(error, language);
    throw new Error(message === t('Não foi possível iniciar o WordPress local.')
      ? t('Não foi possível limpar os dados locais deste projeto.')
      : message, { cause: error });
  }
}

export async function destroyProjectData(options: DestroyProjectOptions): Promise<void> {
  return navigator.locks.request(
    projectLockName(options.project.id),
    { mode: 'exclusive', ifAvailable: true },
    async lock => {
      if (!lock) {
        throw new Error(studioText(options.language, 'Este projeto está aberto em outra aba. Feche a outra aba antes de excluí-lo.'));
      }
      await destroyProjectDataWithRuntime(options);
    },
  );
}

export async function navigateProject(client: PlaygroundClient | null, path: string): Promise<void> {
  if (!client) return;
  await client.goTo(path);
}
