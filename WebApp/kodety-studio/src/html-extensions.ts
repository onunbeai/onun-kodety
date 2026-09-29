import JSZip from 'jszip';
import { KODETY_PLUGIN_VERSION } from '../../../ChromeExtension/kodety-studio/src/product-versions';

export const HTML_LOCALIZATION_EXTENSION = 'kodety-localization';
const ARCHIVE_LIMIT = 256 * 1024 * 1024;
const FILE_LIMIT = 32 * 1024 * 1024;
const MANIFEST_LIMIT = 64 * 1024;
const ALLOWED_TYPES = new Set('php js mjs cjs css json html htm liquid svg png jpg jpeg gif webp avif ico woff woff2 ttf otf txt md csv xml yaml yml'.split(' '));

export interface HtmlExtensionManifest {
  schemaVersion: 1;
  type: 'extension';
  slug: typeof HTML_LOCALIZATION_EXTENSION;
  name: string;
  description: string;
  version: string;
  entry: string;
  requires: { kodety?: string; extensionApi?: string };
}
export interface InstalledHtmlExtension {
  manifest: HtmlExtensionManifest;
  active: boolean;
  installedAt: number;
  updatedAt: number;
  archive: ArrayBuffer;
}
export type HtmlExtensionSummary = Omit<InstalledHtmlExtension, 'archive'>;

export class HtmlExtensionError extends Error {
  constructor(message: string, public readonly portuguese: string) { super(message); }
}
export function htmlExtensionErrorMessage(error: unknown, language: 'pt' | 'en') {
  if (error instanceof HtmlExtensionError) return language === 'pt' ? error.portuguese : error.message;
  return language === 'pt'
    ? 'Não foi possível salvar a extensão. Verifique o armazenamento do navegador e tente novamente.'
    : 'Could not save the extension. Check browser storage and try again.';
}
function invalidArchive(): never {
  throw new HtmlExtensionError('Choose a valid Kodety extension ZIP.', 'Escolha um ZIP válido de extensão Kodety.');
}
function safePath(path: string) {
  return path.length > 0 && !/[\x00-\x1f\\:]/.test(path) && !path.startsWith('/') &&
    !path.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..');
}

/** Check the ZIP directory before inflating any entry. The limits and allowed
 * types match the WordPress package installer. ZIP64, encryption and symlinks
 * cannot be produced by the supported Kodety extension packager. */
function inspectArchive(data: ArrayBuffer) {
  const view = new DataView(data);
  if (view.byteLength < 22 || view.byteLength > ARCHIVE_LIMIT) invalidArchive();
  let end = view.byteLength - 22;
  for (; end >= Math.max(0, view.byteLength - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === view.byteLength) break;
  }
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) invalidArchive();
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
      view.getUint16(end + 8, true) !== count || !count || count > 2000 || cursor + size !== end) invalidArchive();
  const files = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) invalidArchive();
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const bytes = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || ![0, 8].includes(method) || bytes > FILE_LIMIT) invalidArchive();
    const unixMode = view.getUint32(cursor + 38, true) >>> 16;
    if ((unixMode & 0xf000) === 0xa000) invalidArchive();
    const name = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data, cursor + 46, nameLength));
    if (!safePath(name) || files.has(name)) invalidArchive();
    if (!name.endsWith('/')) {
      if (!ALLOWED_TYPES.has(name.split('.').at(-1)?.toLowerCase() || '')) invalidArchive();
      total += bytes;
      if (total > ARCHIVE_LIMIT) invalidArchive();
    }
    files.set(name, bytes);
    cursor = next;
  }
  if (cursor !== end) invalidArchive();
  return files;
}

function minimumVersionSatisfied(minimum: unknown, current: string) {
  if (minimum === undefined) return true;
  if (typeof minimum !== 'string' || !/^(?:>=)?\d+\.\d+\.\d+$/.test(minimum)) return false;
  const requested = minimum.replace(/^>=/, '').split('.').map(Number);
  const available = current.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (available[index] !== requested[index]) return available[index] > requested[index];
  }
  return true;
}

export async function validateHtmlExtensionArchive(archive: ArrayBuffer): Promise<HtmlExtensionManifest> {
  let entries: Map<string, number>;
  try { entries = inspectArchive(archive); } catch { invalidArchive(); }
  const manifests = [...entries.keys()].filter(path => path.split('/').at(-1) === 'kodety-extension.json');
  if (manifests.length !== 1 || manifests[0].split('/').length > 2 || (entries.get(manifests[0]) || 0) > MANIFEST_LIMIT) invalidArchive();
  const root = manifests[0].slice(0, -'kodety-extension.json'.length);
  if ([...entries.keys()].some(path => root && path !== root && !path.startsWith(root))) invalidArchive();
  let manifest: Record<string, unknown>;
  try {
    const zip = await JSZip.loadAsync(archive);
    const text = await zip.file(manifests[0])!.async('string');
    if (new TextEncoder().encode(text).byteLength > MANIFEST_LIMIT) invalidArchive();
    manifest = JSON.parse(text);
  } catch { invalidArchive(); }
  if (!manifest || manifest.schemaVersion !== 1 || manifest.type !== 'extension' ||
      typeof manifest.slug !== 'string' || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 120 ||
      typeof manifest.description !== 'string' || manifest.description.length > 500 ||
      typeof manifest.version !== 'string' || !/^\d[\w.+-]{0,63}$/.test(manifest.version) ||
      typeof manifest.entry !== 'string' || !safePath(manifest.entry) || !manifest.entry.endsWith('.php') ||
      !entries.has(root + manifest.entry)) invalidArchive();
  if (manifest.slug !== HTML_LOCALIZATION_EXTENSION) {
    throw new HtmlExtensionError('This extension requires WordPress. HTML workspaces support the Localization extension ZIP.', 'Esta extensão precisa de WordPress. Workspaces HTML aceitam o ZIP da extensão Localization.');
  }
  if (!entries.get(root + 'assets/localization.js')) {
    throw new HtmlExtensionError('The ZIP is missing the compiled Localization extension. Use the distributed extension ZIP.', 'O ZIP não contém a extensão Localization compilada. Use o ZIP distribuído da extensão.');
  }
  const requires = manifest.requires;
  if (requires !== undefined && (!requires || typeof requires !== 'object' || Array.isArray(requires))) invalidArchive();
  const requirements = (requires || {}) as Record<string, unknown>;
  if (!minimumVersionSatisfied(requirements.kodety, KODETY_PLUGIN_VERSION) || !minimumVersionSatisfied(requirements.extensionApi, '1.0.0')) {
    throw new HtmlExtensionError('Update Onun Kodety before installing this extension version.', 'Atualize o Onun Kodety antes de instalar esta versão da extensão.');
  }
  if (manifest.dependencies !== undefined && (!Array.isArray(manifest.dependencies) || manifest.dependencies.length)) {
    throw new HtmlExtensionError('This package has extension dependencies that are unavailable in HTML mode.', 'Este pacote depende de extensões indisponíveis no modo HTML.');
  }
  return {
    schemaVersion: 1, type: 'extension', slug: HTML_LOCALIZATION_EXTENSION,
    name: manifest.name.trim(), description: manifest.description,
    version: manifest.version, entry: manifest.entry,
    requires: { kodety: requirements.kodety as string | undefined, extensionApi: requirements.extensionApi as string | undefined },
  };
}

export interface HtmlExtensionStorage {
  read(projectId: string): Promise<InstalledHtmlExtension[]>;
  update(projectId: string, change: (current: InstalledHtmlExtension[]) => InstalledHtmlExtension[]): Promise<InstalledHtmlExtension[]>;
}
const summary = ({ archive: _archive, ...record }: InstalledHtmlExtension): HtmlExtensionSummary => record;

/** Extension state is workspace-local, never written into the published site
 * or editable project metadata. Disabling/removing cannot erase translations. */
export function createHtmlExtensionRepository(storage: HtmlExtensionStorage) {
  const key = (projectId: string) => {
    if (!/^[a-z0-9-]{8,80}$/i.test(projectId)) throw new Error('Invalid HTML workspace ID.');
    return projectId;
  };
  return {
    async list(projectId: string) { return (await storage.read(key(projectId))).map(summary); },
    async install(projectId: string, file: Blob) {
      key(projectId);
      if (!file.size || file.size > ARCHIVE_LIMIT) invalidArchive();
      const archive = await file.arrayBuffer();
      const manifest = await validateHtmlExtensionArchive(archive);
      return (await storage.update(projectId, current => {
        const previous = current.find(item => item.manifest.slug === manifest.slug);
        const now = Date.now();
        return [...current.filter(item => item.manifest.slug !== manifest.slug), {
          manifest, archive, active: previous?.active === true,
          installedAt: previous?.installedAt || now, updatedAt: now,
        }];
      })).map(summary);
    },
    async setActive(projectId: string, slug: string, active: boolean) {
      return (await storage.update(key(projectId), current => {
        if (!current.some(item => item.manifest.slug === slug)) throw new HtmlExtensionError('Install the extension ZIP first.', 'Instale o ZIP da extensão primeiro.');
        return current.map(item => item.manifest.slug === slug ? { ...item, active, updatedAt: Date.now() } : item);
      })).map(summary);
    },
    async remove(projectId: string, slug: string) {
      return (await storage.update(key(projectId), current => current.filter(item => item.manifest.slug !== slug))).map(summary);
    },
  };
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('kodetyStudioHtmlExtensionsV1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Extension storage is blocked.'));
  });
}
async function transaction(projectId: string, change?: (current: InstalledHtmlExtension[]) => InstalledHtmlExtension[]) {
  const db = await database();
  return new Promise<InstalledHtmlExtension[]>((resolve, reject) => {
    const transaction = db.transaction('workspaces', change ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('workspaces');
    let result: InstalledHtmlExtension[] = [];
    let failure: unknown;
    const request = store.get(projectId);
    request.onsuccess = () => {
      try {
        const current = request.result || [];
        result = change ? change(current) : current;
        if (change) store.put(result, projectId);
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(failure || transaction.error); };
  });
}
export const htmlExtensions = createHtmlExtensionRepository({ read: id => transaction(id), update: (id, change) => transaction(id, change) });
