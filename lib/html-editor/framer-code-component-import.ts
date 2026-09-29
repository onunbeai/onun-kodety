import {
  MAX_PASTED_CODE_COMPONENT_SOURCE_LENGTH,
  suggestedCodeComponentName,
  type PastedCodeComponentCandidate,
} from './code-component-authoring';

const MAX_FRAMER_WRAPPER_BYTES = 64_000;
const MAX_FRAMER_MODULE_BYTES = 3_000_000;
const MAX_FRAMER_SOURCE_MAP_BYTES = 8_000_000;

export type FramerCodeComponentFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FramerCodeComponentUrlCandidate {
  url: string;
  slug: string;
  requestedVersion?: string;
}

export interface ImportedFramerCodeComponent extends PastedCodeComponentCandidate {
  sourceUrl: string;
  moduleUrl: string;
  sourceMapUrl: string;
  resolvedVersion: string;
}

export interface ImportFramerCodeComponentOptions {
  fetch?: FramerCodeComponentFetch;
  signal?: AbortSignal;
}

export class FramerCodeComponentImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FramerCodeComponentImportError';
    this.code = code;
  }
}

function framerImportError(code: string, message: string): never {
  throw new FramerCodeComponentImportError(code, message);
}

export function framerCodeComponentUrlCandidate(value: string): FramerCodeComponentUrlCandidate | null {
  const input = value.trim();
  if (!input || /[\r\n]/.test(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:'
    || (url.hostname !== 'framer.com' && url.hostname !== 'www.framer.com')
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
  ) return null;
  const match = url.pathname.match(/^\/m\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})\.js(?:@([A-Za-z0-9][A-Za-z0-9_-]{0,159}))?$/);
  if (!match) return null;
  const requestedVersion = match[2];
  return {
    url: `https://framer.com${url.pathname}`,
    slug: match[1],
    ...(requestedVersion ? { requestedVersion } : {}),
  };
}

function responseMediaType(response: Response) {
  return (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
  resourceLabel: string,
) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    framerImportError('framer-resource-too-large', `${resourceLabel} excede o limite seguro de importação.`);
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      framerImportError('framer-resource-too-large', `${resourceLabel} excede o limite seguro de importação.`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maxBytes) {
      void reader.cancel();
      framerImportError('framer-resource-too-large', `${resourceLabel} excede o limite seguro de importação.`);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchFramerText(
  fetcher: FramerCodeComponentFetch,
  url: string,
  options: {
    acceptedMediaTypes: string[];
    maxBytes: number;
    resourceLabel: string;
    signal?: AbortSignal;
  },
) {
  options.signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: options.acceptedMediaTypes.join(', ') },
      signal: options.signal,
    });
  } catch (error) {
    if (
      options.signal?.aborted
      || (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
    ) throw error;
    framerImportError('framer-fetch-failed', `Não foi possível baixar ${options.resourceLabel} do Framer.`);
  }
  if (!response.ok) {
    framerImportError('framer-fetch-status', `${options.resourceLabel} respondeu com HTTP ${response.status}.`);
  }
  if (response.redirected) {
    framerImportError('framer-fetch-redirect', `${options.resourceLabel} tentou redirecionar para uma origem não validada.`);
  }
  if (response.url && new URL(response.url).href !== new URL(url).href) {
    framerImportError('framer-fetch-url', `${options.resourceLabel} respondeu por uma URL diferente da validada.`);
  }
  const mediaType = responseMediaType(response);
  if (!options.acceptedMediaTypes.includes(mediaType)) {
    framerImportError('framer-content-type', `${options.resourceLabel} não retornou um tipo de conteúdo permitido.`);
  }
  return readLimitedResponseText(response, options.maxBytes, options.resourceLabel);
}

function parseFramerModuleWrapper(source: string) {
  const targets: Array<{ kind: 'all' | 'default'; url: string }> = [];
  const exportPattern = /\bexport\s+(\*|\{\s*default\s*\})\s+from\s*(["'])([^"'\r\n]+)\2\s*;?/g;
  const uncommented = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\r\n]*$/gm, '');
  const remaining = uncommented
    .replace(exportPattern, (_statement, clause: string, _quote: string, target: string) => {
      targets.push({ kind: clause === '*' ? 'all' : 'default', url: target });
      return '';
    })
    .replace(/[;\s]/g, '');
  if (
    remaining
    || targets.length !== 2
    || !targets.some(item => item.kind === 'all')
    || !targets.some(item => item.kind === 'default')
    || targets[0].url !== targets[1].url
  ) {
    framerImportError('framer-wrapper-invalid', 'O link não retornou o wrapper ESM oficial esperado do Framer.');
  }
  return targets[0].url;
}

function validateFramerModuleUrl(value: string, requestedVersion?: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return framerImportError('framer-module-url-invalid', 'O wrapper do Framer retornou uma URL de módulo inválida.');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'framerusercontent.com'
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
  ) {
    framerImportError('framer-module-origin', 'O wrapper tentou carregar código fora do CDN oficial do Framer.');
  }
  const match = url.pathname.match(/^\/modules\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})\/([A-Za-z0-9][A-Za-z0-9._-]{0,199}\.js)$/);
  if (!match) {
    framerImportError('framer-module-path', 'O wrapper retornou um caminho de módulo Framer fora do formato permitido.');
  }
  if (requestedVersion && requestedVersion !== match[2]) {
    framerImportError('framer-version-mismatch', 'A versão resolvida pelo Framer não corresponde à versão copiada.');
  }
  return { url: url.href, resolvedVersion: match[2], fileName: match[3] };
}

function sourceMapReference(moduleSource: string) {
  const references: Array<{ index: number; value: string }> = [];
  const linePattern = /^\s*\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*$/gm;
  const blockPattern = /\/\*[#@]\s*sourceMappingURL\s*=\s*([^*\s]+)\s*\*\//g;
  for (const pattern of [linePattern, blockPattern]) {
    for (const match of moduleSource.matchAll(pattern)) {
      references.push({ index: match.index || 0, value: match[1] });
    }
  }
  references.sort((left, right) => left.index - right.index);
  if (!references.length) {
    framerImportError('framer-source-map-missing', 'O módulo do Framer não publicou um source map editável.');
  }
  return references[references.length - 1].value;
}

function validateFramerSourceMapUrl(reference: string, moduleUrl: string) {
  let url: URL;
  try {
    url = new URL(reference, moduleUrl);
  } catch {
    return framerImportError('framer-source-map-url', 'O módulo publicou uma URL de source map inválida.');
  }
  const parent = new URL('./', moduleUrl);
  const relativePath = url.pathname.slice(parent.pathname.length);
  if (
    url.origin !== parent.origin
    || !url.pathname.startsWith(parent.pathname)
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || relativePath.includes('/')
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,219}\.map$/.test(relativePath)
  ) {
    framerImportError('framer-source-map-origin', 'O módulo tentou carregar um source map fora do diretório oficial validado.');
  }
  return url.href;
}

function importedSourceScore(sourceName: string, source: string, moduleFileName: string) {
  const fileName = sourceName.replaceAll('\\', '/').split('/').pop() || '';
  const sourceStem = fileName.replace(/\.(?:tsx?|jsx?)$/i, '').toLowerCase();
  const moduleStem = moduleFileName.replace(/\.js$/i, '').toLowerCase();
  let score = sourceStem === moduleStem ? 100 : 0;
  if (/\.tsx$/i.test(fileName)) score += 40;
  else if (/\.jsx$/i.test(fileName)) score += 30;
  else if (/\.ts$/i.test(fileName)) score += 20;
  else if (/\.js$/i.test(fileName)) score += 10;
  if (/\baddPropertyControls\s*\(/.test(source)) score += 30;
  if (/\bfrom\s*["']framer["']/.test(source)) score += 20;
  if (/\bexport\s+default\s+(?:function\s+)?[A-Z][$\w]*/.test(source)) score += 20;
  return score;
}

function sourceFromFramerSourceMap(sourceMapText: string, moduleFileName: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceMapText);
  } catch {
    return framerImportError('framer-source-map-json', 'O source map do Framer não contém JSON válido.');
  }
  if (!parsed || typeof parsed !== 'object') {
    return framerImportError('framer-source-map-shape', 'O source map do Framer possui um formato inválido.');
  }
  const sourceMap = parsed as { version?: unknown; sources?: unknown; sourcesContent?: unknown };
  if (
    sourceMap.version !== 3
    || !Array.isArray(sourceMap.sources)
    || !sourceMap.sources.every(item => typeof item === 'string' && item.length <= 1_000)
    || !Array.isArray(sourceMap.sourcesContent)
    || sourceMap.sources.length !== sourceMap.sourcesContent.length
  ) {
    framerImportError('framer-source-map-shape', 'O source map do Framer não expõe sourcesContent válido.');
  }
  const sourceNames = sourceMap.sources as string[];
  const sourceContents = sourceMap.sourcesContent as unknown[];
  const candidates = sourceContents.flatMap((entry, index) => {
    if (typeof entry !== 'string') return [];
    const source = entry.trim();
    if (!source || !/\bexport\s+default\b/.test(source)) return [];
    return [{
      source,
      sourceName: sourceNames[index],
      bytes: new TextEncoder().encode(source).byteLength,
      score: importedSourceScore(sourceNames[index], source, moduleFileName),
    }];
  }).sort((left, right) => right.score - left.score);
  if (!candidates.length) {
    framerImportError('framer-source-missing', 'O source map do Framer não contém o código-fonte editável do componente.');
  }
  if (candidates[0].bytes > MAX_PASTED_CODE_COMPONENT_SOURCE_LENGTH) {
    framerImportError('framer-resource-too-large', 'O código-fonte editável do componente excede o limite seguro de importação.');
  }
  return candidates[0];
}

export async function importFramerCodeComponentFromUrl(
  value: string,
  options: ImportFramerCodeComponentOptions = {},
): Promise<ImportedFramerCodeComponent> {
  const candidate = framerCodeComponentUrlCandidate(value);
  if (!candidate) {
    return framerImportError('framer-url-invalid', 'Cole uma URL oficial no formato https://framer.com/m/Componente.js@versão.');
  }
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') {
    return framerImportError('framer-fetch-unavailable', 'Este navegador não oferece suporte ao import por URL.');
  }
  const wrapperSource = await fetchFramerText(fetcher, candidate.url, {
    acceptedMediaTypes: ['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'],
    maxBytes: MAX_FRAMER_WRAPPER_BYTES,
    resourceLabel: 'o wrapper do componente',
    signal: options.signal,
  });
  const module = validateFramerModuleUrl(parseFramerModuleWrapper(wrapperSource), candidate.requestedVersion);
  const moduleSource = await fetchFramerText(fetcher, module.url, {
    acceptedMediaTypes: ['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'],
    maxBytes: MAX_FRAMER_MODULE_BYTES,
    resourceLabel: 'o módulo do componente',
    signal: options.signal,
  });
  const sourceMapUrl = validateFramerSourceMapUrl(sourceMapReference(moduleSource), module.url);
  const sourceMap = await fetchFramerText(fetcher, sourceMapUrl, {
    acceptedMediaTypes: ['application/json', 'application/source-map', 'text/plain'],
    maxBytes: MAX_FRAMER_SOURCE_MAP_BYTES,
    resourceLabel: 'o source map do componente',
    signal: options.signal,
  });
  const importedSource = sourceFromFramerSourceMap(sourceMap, module.fileName);
  return {
    source: importedSource.source,
    suggestedName: suggestedCodeComponentName(importedSource.source, importedSource.sourceName || candidate.slug),
    sourceUrl: candidate.url,
    moduleUrl: module.url,
    sourceMapUrl,
    resolvedVersion: module.resolvedVersion,
  };
}
