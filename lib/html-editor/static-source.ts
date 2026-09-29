import type { HtmlProject, HtmlProjectFile } from './types';

export const STATIC_SOURCE_MANIFEST = '.incode/static-source.json';
const SOURCE_PREFIX = '.incode/static-source/';
type SourceEntry = { path: string; mimeType: string; kind: 'text' | 'binary'; override?: string };
type SourceManifest = { kind: 'kodety-static-source-v1'; files: SourceEntry[] };

function safePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 1024 &&
    !/[\\\u0000-\u001f\u007f]/.test(path) && !/^[a-z]:/i.test(path) &&
    path.split('/').every(part => Boolean(part) && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
}
function sameFile(left: HtmlProjectFile | undefined, right: HtmlProjectFile): boolean {
  if (!left || left.text !== right.text || left.mimeType !== right.mimeType) return false;
  if (left.data === right.data) return true;
  return Boolean(left.data && right.data && left.data.length === right.data.length && left.data.every((byte, index) => byte === right.data![index]));
}

/** The root of the ZIP remains a deployable static site. Only source files
 * changed/removed by compilation are copied into private portable metadata;
 * unchanged binary assets are stored once. Import restores the source set. */
export function attachStaticHtmlSource(source: HtmlProject, published: HtmlProject): HtmlProject {
  for (const path of Object.keys(source.files)) {
    if (!safePath(path)) throw new Error(`Caminho de origem inválido: ${path}`);
    if (path === STATIC_SOURCE_MANIFEST || path.startsWith(SOURCE_PREFIX)) throw new Error('O projeto usa um caminho reservado para a cópia editável do ZIP.');
  }
  const files = { ...published.files };
  const entries: SourceEntry[] = [];
  for (const [path, file] of Object.entries(source.files)) {
    const entry: SourceEntry = { path, mimeType: file.mimeType, kind: file.text !== undefined ? 'text' : 'binary' };
    // Always snapshot metadata: projectToZipBlob updates the root metadata
    // while packaging the public root, including a possibly translated home.
    if (path === '.incode/project.json' || !sameFile(published.files[path], file)) {
      entry.override = `${entries.length}.${entry.kind === 'text' ? 'txt' : 'bin'}`;
      const storagePath = SOURCE_PREFIX + entry.override;
      if (files[storagePath]) throw new Error(`O arquivo ${storagePath} conflita com a cópia editável do ZIP.`);
      files[storagePath] = { ...file, path: storagePath };
    }
    entries.push(entry);
  }
  if (files[STATIC_SOURCE_MANIFEST]) throw new Error('O ZIP já contém outra cópia editável.');
  const manifest: SourceManifest = { kind: 'kodety-static-source-v1', files: entries };
  files[STATIC_SOURCE_MANIFEST] = { path: STATIC_SOURCE_MANIFEST, mimeType: 'application/json', text: JSON.stringify(manifest) };
  if (Object.keys(files).length > 10_000) throw new Error('O ZIP com a cópia editável ultrapassa o limite de 10.000 arquivos. Publique na pasta e mantenha a pasta original como fonte.');
  return { ...published, files };
}

export function restoreStaticHtmlSource(files: Record<string, HtmlProjectFile>): Record<string, HtmlProjectFile> {
  const stored = files[STATIC_SOURCE_MANIFEST];
  if (!stored) return files;
  let manifest: SourceManifest;
  try {
    manifest = JSON.parse(stored.text || 'null');
    if (!manifest || manifest.kind !== 'kodety-static-source-v1' || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10_000) throw new Error('Invalid manifest');
  } catch {
    throw new Error('A cópia editável deste ZIP está inválida. Importe novamente o ZIP original exportado pelo Kodety.');
  }
  const restored: Record<string, HtmlProjectFile> = Object.create(null);
  for (const entry of manifest.files) {
    if (!entry || !safePath(entry.path) || entry.path === STATIC_SOURCE_MANIFEST || entry.path.startsWith(SOURCE_PREFIX) || Object.hasOwn(restored, entry.path) || typeof entry.mimeType !== 'string' || !['text', 'binary'].includes(entry.kind) || (entry.override !== undefined && !/^\d+\.(?:txt|bin)$/.test(entry.override))) throw new Error('A cópia editável deste ZIP contém caminhos inválidos.');
    const original = files[entry.override ? SOURCE_PREFIX + entry.override : entry.path];
    if (!original) throw new Error(`O ZIP não contém a origem editável de “${entry.path}”.`);
    restored[entry.path] = {
      path: entry.path,
      mimeType: entry.mimeType,
      ...(entry.kind === 'text'
        ? { text: original.text ?? new TextDecoder().decode(original.data || new Uint8Array()) }
        : { data: original.data ?? new TextEncoder().encode(original.text || '') }),
    };
  }
  return restored;
}
