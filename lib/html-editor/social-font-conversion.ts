import { sha256 } from 'js-sha256';
import { resolveProjectFontFile } from './project-fonts';
import type { HtmlProject, HtmlProjectFile } from './types';

// Must stay byte-for-byte aligned with Kodety_Social_Images::MAX_FONT_BYTES.
// Preparing a file the PHP renderer would later reject is never useful.
export const SOCIAL_FONT_MAX_SOURCE_BYTES = 20_000_000;
export const SOCIAL_FONT_MAX_SFNT_BYTES = 20_000_000;

const SOCIAL_FONT_DIRECTORY = '.kodety-social/fonts';
const WOFF2_HEADER_BYTES = 48;
const SFNT_HEADER_BYTES = 12;
const VITE_CONFIG_PATTERN = /(?:^|\/)vite\.config\.(?:[cm]?[jt]s)$/i;
let woff2DecompressionTail: Promise<void> = Promise.resolve();

type SocialSfntExtension = 'ttf' | 'otf';

export interface PreparedSocialFontFile {
  /** Project snapshot containing the immutable, content-addressed font. */
  project: HtmlProject;
  /** Public path persisted in the Social Image template. */
  fontFile: string;
  /** Canonical key of the derived file inside `project.files`. */
  storedPath: string;
}

function normalizePath(value: string) {
  const result: string[] = [];
  value.replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') result.pop();
    else result.push(part);
  });
  return result.join('/');
}

function joinPath(...parts: Array<string | undefined>) {
  return normalizePath(parts.filter(Boolean).join('/'));
}

function extension(value: string) {
  const name = value.split(/[?#]/, 1)[0]?.split('/').pop() || '';
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1).toLowerCase();
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] || 0);
  }
  return value;
}

function readUint16(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] || 0) * 0x1000000)
    + ((bytes[offset + 1] || 0) << 16)
    + ((bytes[offset + 2] || 0) << 8)
    + (bytes[offset + 3] || 0)
  ) >>> 0;
}

function assertSourceSize(bytes: Uint8Array, maxBytes: number) {
  if (!bytes.byteLength) throw new Error('O arquivo da fonte está vazio.');
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `A fonte excede o limite de ${Math.round(maxBytes / 1_000_000)} MB para imagens sociais.`,
    );
  }
}

function assertWoff2(bytes: Uint8Array) {
  assertSourceSize(bytes, SOCIAL_FONT_MAX_SOURCE_BYTES);
  if (bytes.byteLength < WOFF2_HEADER_BYTES || ascii(bytes, 0, 4) !== 'wOF2') {
    throw new Error('O arquivo WOFF2 selecionado possui uma assinatura inválida.');
  }
  const declaredLength = readUint32(bytes, 8);
  const tableCount = readUint16(bytes, 12);
  const declaredSfntSize = readUint32(bytes, 16);
  if (declaredLength !== bytes.byteLength || tableCount < 1 || tableCount > 4_096) {
    throw new Error('O cabeçalho da fonte WOFF2 está corrompido.');
  }
  if (
    declaredSfntSize < SFNT_HEADER_BYTES
    || declaredSfntSize > SOCIAL_FONT_MAX_SFNT_BYTES
  ) {
    throw new Error('O tamanho descompactado declarado pela fonte WOFF2 não é seguro.');
  }
}

function sfntExtension(bytes: Uint8Array): SocialSfntExtension {
  assertSourceSize(bytes, SOCIAL_FONT_MAX_SFNT_BYTES);
  if (bytes.byteLength < SFNT_HEADER_BYTES) {
    throw new Error('A fonte convertida está incompleta.');
  }
  const signature = ascii(bytes, 0, 4);
  const type: SocialSfntExtension | null = signature === 'OTTO' || signature === 'typ1'
    ? 'otf'
    : (
      (
        bytes[0] === 0x00
        && bytes[1] === 0x01
        && bytes[2] === 0x00
        && bytes[3] === 0x00
      )
      || signature === 'true'
    )
      ? 'ttf'
      : null;
  if (!type) {
    throw new Error('A fonte não contém um SFNT TTF/OTF compatível com o renderizador social.');
  }

  const tableCount = readUint16(bytes, 4);
  const directoryEnd = SFNT_HEADER_BYTES + (tableCount * 16);
  if (tableCount < 1 || tableCount > 4_096 || directoryEnd > bytes.byteLength) {
    throw new Error('O diretório de tabelas da fonte TTF/OTF está corrompido.');
  }

  const tables = new Set<string>();
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = SFNT_HEADER_BYTES + (index * 16);
    const tag = ascii(bytes, recordOffset, 4);
    const tableOffset = readUint32(bytes, recordOffset + 8);
    const tableLength = readUint32(bytes, recordOffset + 12);
    if (tableOffset > bytes.byteLength || tableLength > bytes.byteLength - tableOffset) {
      throw new Error('Uma tabela da fonte TTF/OTF aponta para dados fora do arquivo.');
    }
    tables.add(tag);
  }
  if (
    !tables.has('cmap')
    || !tables.has('head')
    || !tables.has('name')
    || (
      !tables.has('glyf')
      && !tables.has('CFF ')
      && !tables.has('CFF2')
      && !tables.has('typ1')
    )
  ) {
    throw new Error('A fonte TTF/OTF não contém as tabelas necessárias para renderizar texto.');
  }
  return type;
}

function projectFileByPath(project: HtmlProject, requestedPath: string) {
  const exact = project.files[requestedPath];
  if (exact) return exact;
  const lower = normalizePath(requestedPath).toLowerCase();
  return Object.values(project.files).find(file =>
    normalizePath(file.path).toLowerCase() === lower,
  );
}

function sourceFontFile(project: HtmlProject, requestedPath: string) {
  const normalized = normalizePath(requestedPath.replace(/[?#].*$/, '').replace(/^\/+/, ''));
  const generatedPrefix = `${SOCIAL_FONT_DIRECTORY}/`;
  const generatedName = normalized.startsWith(generatedPrefix)
    ? normalized.slice(generatedPrefix.length)
    : '';
  const generatedPath = generatedName
    ? joinPath(socialFontStorageDirectory(project), generatedName)
    : '';
  const resolvedPath = projectFileByPath(project, normalized)?.path
    || (generatedPath ? projectFileByPath(project, generatedPath)?.path : '')
    || resolveProjectFontFile(project, project.mainHtmlPath, requestedPath);
  const file = resolvedPath ? projectFileByPath(project, resolvedPath) : undefined;
  if (!file) throw new Error('A fonte selecionada não foi encontrada nos arquivos do projeto.');
  if (!(file.data instanceof Uint8Array)) {
    throw new Error('A fonte selecionada não contém dados binários válidos.');
  }
  return file;
}

function viteConfig(project: HtmlProject) {
  const root = normalizePath(project.rootPath);
  const rootPrefix = root ? `${root}/` : '';
  const exact = Object.values(project.files).find(file =>
    VITE_CONFIG_PATTERN.test(file.path)
    && normalizePath(file.path).toLowerCase().startsWith(rootPrefix.toLowerCase())
    && !normalizePath(file.path).slice(rootPrefix.length).includes('/'),
  );
  if (exact) return exact;
  const candidates = Object.values(project.files).filter(file =>
    VITE_CONFIG_PATTERN.test(file.path)
    && !file.path.startsWith('.incode/')
    && !file.path.startsWith('kodety-build/'),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function packageUsesVite(project: HtmlProject) {
  const root = normalizePath(project.rootPath);
  const candidates = [
    joinPath(root, 'package.json'),
    'package.json',
  ];
  for (const candidate of candidates) {
    const text = projectFileByPath(project, candidate)?.text;
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        scripts?: Record<string, unknown>;
      };
      if (parsed.dependencies?.vite || parsed.devDependencies?.vite) return true;
      if (Object.values(parsed.scripts || {}).some(value =>
        typeof value === 'string' && /(?:^|\s|&&|\|\|)vite(?:\s|$)/.test(value),
      )) return true;
    } catch {
      // A malformed package.json is unrelated to font preparation.
    }
  }
  return false;
}

function vitePublicDirectory(project: HtmlProject, config?: HtmlProjectFile) {
  if (!config?.text) return 'public';
  const match = config.text.match(
    /\bpublicDir\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/,
  );
  const authored = match?.[2]?.trim().replaceAll('\\', '/') || '';
  if (
    !authored
    || authored === '.'
    || authored.startsWith('/')
    || /^[a-z]:/i.test(authored)
    || authored.split('/').includes('..')
  ) return 'public';
  return normalizePath(authored);
}

function socialFontStorageDirectory(project: HtmlProject) {
  const root = normalizePath(project.rootPath);
  const config = viteConfig(project);
  if (!config && !packageUsesVite(project)) return joinPath(root, SOCIAL_FONT_DIRECTORY);
  return joinPath(root, vitePublicDirectory(project, config), SOCIAL_FONT_DIRECTORY);
}

async function woff2ToSfnt(source: Uint8Array) {
  assertWoff2(source);
  try {
    // wawoff2 exposes a view backed by one shared WASM heap. Serialize calls
    // and copy the result before another conversion can reuse that memory.
    const conversion = woff2DecompressionTail.then(async () => {
      const { default: decompress } = await import('wawoff2/decompress');
      return Uint8Array.from(await decompress(source));
    });
    woff2DecompressionTail = conversion.then(() => undefined, () => undefined);
    const converted = await conversion;
    if (converted.byteLength > SOCIAL_FONT_MAX_SFNT_BYTES) {
      throw new Error('A fonte WOFF2 descompactada excede o limite permitido.');
    }
    return converted;
  } catch (error) {
    if (error instanceof Error && /limite|assinatura|cabeçalho|tamanho/i.test(error.message)) {
      throw error;
    }
    throw new Error('Não foi possível converter a fonte WOFF2 para TTF/OTF.', {
      cause: error,
    });
  }
}

/**
 * Makes a project font safe for the PHP/GD Social Image renderer.
 *
 * WOFF2 is decompressed to its original SFNT payload. Existing TTF/OTF files
 * pass through the same validation and content-addressed copy so templates
 * never depend on an authored filename moving later. Vite sources keep the
 * immutable file in their public directory; static projects keep it directly
 * below the project root.
 */
export async function prepareSocialFontFile(
  project: HtmlProject,
  requestedFontFile: string,
): Promise<PreparedSocialFontFile> {
  const source = sourceFontFile(project, requestedFontFile);
  const sourceExtension = extension(source.path);
  let bytes: Uint8Array;
  if (sourceExtension === 'woff2') {
    bytes = await woff2ToSfnt(source.data!);
  } else if (sourceExtension === 'ttf' || sourceExtension === 'otf') {
    assertSourceSize(source.data!, SOCIAL_FONT_MAX_SFNT_BYTES);
    bytes = Uint8Array.from(source.data!);
  } else {
    throw new Error('Imagens sociais aceitam fontes WOFF2, TTF ou OTF do projeto.');
  }

  const sfntType = sfntExtension(bytes);
  const hash = sha256(bytes);
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('Não foi possível calcular um identificador seguro para a fonte.');
  }
  const fontFile = `${SOCIAL_FONT_DIRECTORY}/${hash}.${sfntType}`;
  const storedPath = joinPath(socialFontStorageDirectory(project), `${hash}.${sfntType}`);
  const existing = project.files[storedPath];
  if (existing) {
    if (
      !(existing.data instanceof Uint8Array)
      || existing.mimeType !== `font/${sfntType}`
      || !bytesEqual(existing.data, bytes)
    ) {
      throw new Error('O arquivo imutável da fonte já existe com conteúdo diferente.');
    }
    return { project, fontFile, storedPath };
  }

  const derived: HtmlProjectFile = {
    path: storedPath,
    mimeType: `font/${sfntType}`,
    data: bytes,
  };
  return {
    project: {
      ...project,
      files: {
        ...project.files,
        [storedPath]: derived,
      },
    },
    fontFile,
    storedPath,
  };
}

/**
 * Rebases a completed conversion onto the newest editor snapshot. Decompression
 * is asynchronous, so unrelated authoring edits may land while the WASM decoder
 * is running; only the derived file is merged and no newer project state is
 * discarded.
 */
export function mergePreparedSocialFontFile(
  project: HtmlProject,
  prepared: PreparedSocialFontFile,
) {
  const derived = prepared.project.files[prepared.storedPath];
  if (!derived?.data) throw new Error('A fonte preparada não contém o arquivo derivado.');
  const existing = project.files[prepared.storedPath];
  if (existing) {
    if (
      !(existing.data instanceof Uint8Array)
      || existing.mimeType !== derived.mimeType
      || !bytesEqual(existing.data, derived.data)
    ) {
      throw new Error('O arquivo imutável da fonte já existe com conteúdo diferente.');
    }
    return project;
  }
  return {
    ...project,
    files: {
      ...project.files,
      [prepared.storedPath]: derived,
    },
  };
}
