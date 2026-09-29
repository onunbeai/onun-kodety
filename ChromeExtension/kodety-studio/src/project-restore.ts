import type { MountDescriptor, PlaygroundClient } from '@wp-playground/client';
import { opfsPathForProject, type StudioLanguage } from './storage';

const WORDPRESS_ROOT = '/wordpress';
const DATABASE_PATH = `${WORDPRESS_ROOT}/wp-content/database/.ht.sqlite`;
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');

type RestoreClient = Pick<PlaygroundClient, 'mountOpfs' | 'isFile' | 'readFileAsBuffer' | 'listFiles'>;

export type ProjectRestoreErrorCode =
  | 'INVALID_RESTORE_MOUNT'
  | 'PROJECT_FILES_MISSING'
  | 'PROJECT_FILES_INVALID'
  | 'PROJECT_FILES_UNREADABLE'
  | 'CUSTOM_DATABASE_PATH'
  | 'DATABASE_MISSING'
  | 'DATABASE_INVALID';

const messages: Record<ProjectRestoreErrorCode, Record<StudioLanguage, string>> = {
  INVALID_RESTORE_MOUNT: {
    pt: 'O armazenamento selecionado não corresponde a este projeto.',
    en: 'The selected storage does not match this project.',
  },
  PROJECT_FILES_MISSING: {
    pt: 'Arquivos necessários do WordPress não foram encontrados no projeto salvo.',
    en: 'Required WordPress files were not found in the saved project.',
  },
  PROJECT_FILES_INVALID: {
    pt: 'Um arquivo necessário do WordPress está vazio ou inválido no projeto salvo.',
    en: 'A required WordPress file is empty or invalid in the saved project.',
  },
  PROJECT_FILES_UNREADABLE: {
    pt: 'Não foi possível ler os arquivos salvos deste projeto.',
    en: 'The saved project files could not be read.',
  },
  CUSTOM_DATABASE_PATH: {
    pt: 'Este projeto usa um caminho de banco de dados personalizado que precisa ser verificado antes de abrir.',
    en: 'This project uses a custom database path that must be checked before opening.',
  },
  DATABASE_MISSING: {
    pt: 'O banco de dados não foi encontrado no projeto salvo. Restaure um backup para recuperar o projeto.',
    en: 'The database was not found in the saved project. Restore a backup to recover the project.',
  },
  DATABASE_INVALID: {
    pt: 'O arquivo do banco de dados salvo está incompleto ou não possui um cabeçalho SQLite válido.',
    en: 'The saved database file is incomplete or does not have a valid SQLite header.',
  },
};

export class ProjectRestoreError extends Error {
  readonly code: ProjectRestoreErrorCode;
  readonly projectId: string;
  readonly path?: string;

  constructor(code: ProjectRestoreErrorCode, projectId: string, language: StudioLanguage, path?: string, cause?: unknown) {
    super(messages[code][language], { cause });
    this.name = 'ProjectRestoreError';
    this.code = code;
    this.projectId = projectId;
    this.path = path;
  }
}

function hasCustomDatabasePath(config: string): boolean {
  // Preserve strings while removing PHP comments, so examples in comments do
  // not look like active definitions. Never execute the saved configuration.
  const code = config.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|#[^\r\n]*/g,
    token => /^(?:\/\*|\/\/|#)/.test(token) ? ' ' : token,
  );
  return /\bdefine\s*\(\s*(['"])(?:DB_DIR|DB_FILE|FQDBDIR|FQDB|WP_CONTENT_DIR)\1\s*,|\bconst\s+(?:DB_DIR|DB_FILE|FQDBDIR|FQDB|WP_CONTENT_DIR)\s*=/i.test(code);
}

export function wordpressVersionFromSource(source: string): string | null {
  return source.match(/\$wp_version\s*=\s*(['"])([^'"]+)\1/)?.[2] || null;
}

/**
 * Restore persisted files after a temporary, unmounted Playground bootstrap.
 * The caller must finish bootstrap requests and define its runtime marker first.
 * OPFS-to-MEMFS replaces /wordpress before copying; temporary files must never
 * be copied into, or used to fill gaps in, a saved project.
 *
 * This validates file presence and the SQLite header, not database integrity.
 * It deliberately runs no PHP, installer, migration, or database repair.
 */
export async function restorePersistedProject(
  client: RestoreClient,
  mount: MountDescriptor,
  { projectId, language = 'pt' }: { projectId: string; language?: StudioLanguage },
): Promise<{ databasePath: string; databaseBytes: number; wordpressVersion: string }> {
  const fail = (code: ProjectRestoreErrorCode, path?: string, cause?: unknown): never => {
    throw new ProjectRestoreError(code, projectId, language, path, cause);
  };
  if (
    !/^[a-z0-9-]{8,80}$/i.test(projectId)
    || mount.initialSyncDirection !== 'opfs-to-memfs'
    || mount.mountpoint !== WORDPRESS_ROOT
    || mount.device.type !== 'opfs'
    || mount.device.path !== opfsPathForProject(projectId)
  ) fail('INVALID_RESTORE_MOUNT');

  try {
    await client.mountOpfs(mount);
  } catch (cause) {
    fail('PROJECT_FILES_UNREADABLE', WORDPRESS_ROOT, cause);
  }

  const isFile = async (path: string): Promise<boolean> => {
    try {
      return await client.isFile(path);
    } catch (cause) {
      return fail('PROJECT_FILES_UNREADABLE', path, cause);
    }
  };
  const readFile = async (path: string): Promise<Uint8Array> => {
    try {
      return await client.readFileAsBuffer(path);
    } catch (cause) {
      return fail('PROJECT_FILES_UNREADABLE', path, cause);
    }
  };

  const coreFiles = ['wp-config.php', 'wp-load.php', 'wp-includes/version.php'];
  const missingCoreFiles: string[] = [];
  for (const relativePath of coreFiles) {
    if (!await isFile(`${WORDPRESS_ROOT}/${relativePath}`)) missingCoreFiles.push(relativePath);
  }
  // Inspect the saved database even when core files are absent. A missing
  // wp-config alone and an unavailable project directory require different
  // recovery decisions. These probes do not execute PHP or modify any files.
  const databasePath = await isFile(DATABASE_PATH)
    ? DATABASE_PATH
    : await isFile(`${DATABASE_PATH}.php`) ? `${DATABASE_PATH}.php` : null;
  if (missingCoreFiles.length) {
    const error = new ProjectRestoreError('PROJECT_FILES_MISSING', projectId, language,
      `${WORDPRESS_ROOT}/${missingCoreFiles[0]}`);
    error.message += language === 'pt'
      ? ` Arquivos ausentes: ${missingCoreFiles.join(', ')}. Banco SQLite: ${databasePath ? 'encontrado' : 'não encontrado'}.`
      : ` Missing files: ${missingCoreFiles.join(', ')}. SQLite database: ${databasePath ? 'found' : 'not found'}.`;
    try {
      // A bounded, non-recursive inventory distinguishes an empty root from a
      // WordPress tree stored in a nested directory. Never read file contents.
      const entries = await client.listFiles(WORDPRESS_ROOT);
      const names = entries.slice(0, 30).map(name => name.replace(/[\r\n\0]/g, ' ').slice(0, 80));
      const inventory = names.join(', ') + (entries.length > names.length ? ', …' : '');
      error.message += language === 'pt'
        ? ` Conteúdo na raiz: ${inventory || 'vazia'}.`
        : ` Root entries: ${inventory || 'empty'}.`;
    } catch {
      // Inventory is optional; its failure must not replace the original error.
    }
    throw error;
  }
  let config = '';
  let wordpressVersion = '';
  for (const relativePath of coreFiles) {
    const path = `${WORDPRESS_ROOT}/${relativePath}`;
    const source = new TextDecoder().decode(await readFile(path));
    if (!/^\s*<\?php\s+\S/.test(source)) fail('PROJECT_FILES_INVALID', path);
    if (relativePath === 'wp-includes/version.php') {
      const version = wordpressVersionFromSource(source);
      wordpressVersion = version || fail('PROJECT_FILES_INVALID', path);
    }
    if (relativePath === 'wp-config.php') config = source;
  }
  if (hasCustomDatabasePath(config)) fail('CUSTOM_DATABASE_PATH', `${WORDPRESS_ROOT}/wp-config.php`);

  // Prefer the current filename. A corrupt current file must not be hidden by
  // selecting a legacy file; the SQLite driver itself also prefers this path.
  if (!databasePath) return fail('DATABASE_MISSING', DATABASE_PATH);
  const database = await readFile(databasePath);
  if (database.byteLength < 100 || !SQLITE_HEADER.every((byte, index) => database[index] === byte)) {
    fail('DATABASE_INVALID', databasePath);
  }
  return { databasePath, databaseBytes: database.byteLength, wordpressVersion };
}
