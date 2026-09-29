import { parseFragment, serialize } from 'parse5';
import {
  isKodetyFigmaHtmlPayload,
  KODETY_FIGMA_SIGNATURE,
  KODETY_FIGMA_VERSION,
  type KodetyFigmaAsset,
  type KodetyFigmaFont,
  type KodetyFigmaHtmlPayload,
  type KodetyFigmaVariable,
} from './types';
import type { HtmlProject, HtmlProjectFile } from '../html-editor/types';
import {
  getElementChildCount,
  patchInsertAdjacentElement,
  patchInsertElement,
} from '../html-editor/source-patcher';
import { ensureCssLink } from '../html-editor/file-attachments';
import { discoverProjectFonts } from '../html-editor/project-fonts';
import {
  designTokenCssName,
  normalizeHtmlDesignTokens,
  updateProjectDesignTokens,
  type HtmlDesignToken,
  type HtmlDesignTokenCollection,
  type HtmlDesignTokenDocument,
  type HtmlDesignTokenType,
} from '../html-editor/design-tokens';
import { readEditorMetadata, projectGoogleFonts } from '../html-editor/project-io';
import type { FontLibraryGoogleFont } from '../editor-platform-services';
import { googleFontSupportsFigmaFace, registerFigmaGoogleFonts } from './google-fonts';

const MAX_CLIPBOARD_CHARACTERS = 96 * 1024 * 1024;
const MAX_HTML_CHARACTERS = 24 * 1024 * 1024;
const MAX_CSS_CHARACTERS = 32 * 1024 * 1024;
const MAX_ASSET_COUNT = 10_000;
const MAX_FONT_METADATA_COUNT = 10_000;
const MAX_VARIABLE_METADATA_COUNT = 100_000;
const MAX_WARNING_COUNT = 1_000;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 768 * 1024 * 1024;
const MAX_FRAGMENT_NODES = 100_000;
const MAX_FRAGMENT_TREE_NODES = 300_000;
const BASE64_DECODE_CHUNK_CHARACTERS = 4 * 1024 * 1024;
const BASE64_YIELD_BYTES = 8 * 1024 * 1024;
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'portal',
  'base',
  'meta',
  'link',
  'style',
  'html',
  'head',
  'body',
  'foreignobject',
  'template',
]);
const ALLOWED_ASSET_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
]);
const FONT_ASSET_MIME_TYPES = new Set([
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
]);

interface ParsedNode {
  nodeName?: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  content?: ParsedNode;
}

export type FigmaImportPlacement = 'inside' | 'after';

export interface ImportKodetyFigmaOptions {
  pagePath?: string;
  targetPath?: string | null;
  placement?: FigmaImportPlacement;
  preferredStylesheetPath?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: KodetyFigmaImportProgress) => void;
  googleFontsCatalog?: readonly FontLibraryGoogleFont[];
  googleFontsUnavailable?: boolean;
}

export interface KodetyFigmaImportProgress {
  phase: 'prepare' | 'assets' | 'commit';
  completed: number;
  total: number;
}

export interface KodetyFigmaImportResult {
  project: HtmlProject;
  pagePath: string;
  stylesheetPath: string;
  selectionPath: string;
  importedNodes: number;
  importedAssets: number;
  fonts: KodetyFigmaFont[];
  missingFonts: string[];
  googleFonts: string[];
  warnings: string[];
}

function normalizeProjectPath(value: string, label = 'O caminho') {
  if (
    !value
    || /[\u0000-\u001f\u007f]/.test(value)
    || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value)
  ) {
    throw new Error(`${label} não é válido para este projeto.`);
  }
  const parts: string[] = [];
  value.replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') {
      if (!parts.length) throw new Error(`${label} tenta sair da raiz do projeto.`);
      parts.pop();
      return;
    }
    parts.push(part);
  });
  const normalized = parts.join('/');
  if (!normalized) throw new Error(`${label} não é válido para este projeto.`);
  return normalized;
}

function safeSegment(value: string, fallback: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : fallback;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeNativeTokenId(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function deterministicNativeId(prefix: string, label: string, identity: string) {
  const hash = stableHash(identity);
  const fixed = `${prefix}-${hash}`;
  const availableLabelCharacters = Math.max(0, 80 - fixed.length - 1);
  const safeLabel = safeNativeTokenId(label).slice(0, availableLabelCharacters);
  return safeLabel ? `${prefix}-${safeLabel}-${hash}` : fixed;
}

function escapeCssStringToken(value: string) {
  return `"${value
    .replace(/\0/g, '\ufffd')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?|\n|\f/g, '\\A ')
    .replace(/</g, '\\3C ')
    .replace(/>/g, '\\3E ')}"`;
}

function nativeTokenValue(variable: KodetyFigmaVariable) {
  if (variable.type === 'string') return escapeCssStringToken(String(variable.value));
  if (variable.type === 'boolean') return Boolean(variable.value) ? '1' : '0';
  if (variable.type === 'number') {
    const number = Number(variable.value);
    return String(Object.is(number, -0) ? 0 : number);
  }
  const color = String(variable.value).trim();
  if (!color || /[{};]/.test(color) || /\/\*|\*\//.test(color) || /!important\b/i.test(color)) {
    throw new Error(`A variable de cor "${variable.name}" contém um valor CSS inválido.`);
  }
  return color;
}

function nativeTokenType(variable: KodetyFigmaVariable): HtmlDesignTokenType {
  if (variable.type === 'boolean') return 'number';
  return variable.type;
}

function figmaPayloadSourceId(payload: KodetyFigmaHtmlPayload) {
  if (payload.version === KODETY_FIGMA_VERSION && payload.sourceId?.trim()) {
    return payload.sourceId.trim();
  }
  return `${payload.documentName.trim()}\u0000${payload.pageName.trim()}`;
}

function nativeTokenId(payload: KodetyFigmaHtmlPayload, variable: KodetyFigmaVariable) {
  if (variable.tokenId) return variable.tokenId;
  const nativeCssName = variable.cssName.match(/^--kodety-token-([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})$/);
  if (nativeCssName) return nativeCssName[1];
  const sourceId = figmaPayloadSourceId(payload);
  return deterministicNativeId(
    'figma',
    variable.name || 'variable',
    `${sourceId}\u0000${variable.collectionId || ''}\u0000${variable.id}`,
  );
}

function nativeCollection(
  payload: KodetyFigmaHtmlPayload,
  variable: KodetyFigmaVariable,
): HtmlDesignTokenCollection {
  const sourceId = figmaPayloadSourceId(payload);
  const sourceCollectionId = variable.collectionId?.trim() || 'default';
  const collectionName = variable.collectionName?.trim()
    || `${payload.documentName.trim() || 'Figma'} variables`;
  return {
    id: deterministicNativeId(
      'figma',
      collectionName,
      `${sourceId}\u0000${sourceCollectionId}`,
    ),
    name: collectionName.slice(0, 80),
  };
}

function nativeTokenDescription(
  payload: KodetyFigmaHtmlPayload,
  variable: KodetyFigmaVariable,
) {
  const marker = figmaTokenProvenance(payload, variable);
  return [
    marker,
    'Figma',
    payload.documentName.trim(),
    variable.collectionName?.trim(),
    variable.modeName?.trim() ? `Mode: ${variable.modeName.trim()}` : '',
  ].filter(Boolean).join(' · ').slice(0, 240);
}

function figmaTokenProvenance(
  payload: KodetyFigmaHtmlPayload,
  variable: KodetyFigmaVariable,
) {
  return `[kodety-figma:${stableHash(figmaPayloadSourceId(payload))}:${stableHash(variable.id)}]`;
}

function tokenHasFigmaProvenance(token: HtmlDesignToken, marker: string) {
  return token.description === marker || token.description?.startsWith(`${marker} · `) === true;
}

function disambiguatedTokenId(baseId: string, identity: string, attempt: number) {
  return deterministicNativeId(
    'figma',
    baseId,
    attempt ? `${identity}\u0000${attempt}` : identity,
  );
}

interface FigmaVariableMaterialization {
  document: HtmlDesignTokenDocument;
  cssNames: Map<string, string>;
}

/**
 * Merge Figma variables without replacing project-owned tokens. Reimports
 * refresh only tokens carrying the exact same source-variable provenance;
 * unrelated collisions receive a stable, rewritten Figma id.
 */
function mergeFigmaVariables(
  project: HtmlProject,
  payload: KodetyFigmaHtmlPayload,
): FigmaVariableMaterialization {
  const existing = normalizeHtmlDesignTokens(readEditorMetadata(project).designTokens);
  const existingCollectionIds = new Set(existing.collections.map(collection => collection.id));
  const tokens = [...existing.tokens];
  const tokenIndexById = new Map(tokens.map((token, index) => [token.id, index]));
  const incomingVariableIds = new Set<string>();
  const incomingRequestedTokenIds = new Set<string>();
  const incomingResolvedTokenIds = new Set<string>();
  const cssNames = new Map<string, string>();
  const pendingCollections = new Map<string, HtmlDesignTokenCollection>();
  const pendingTokens: HtmlDesignToken[] = [];

  payload.variables.forEach(variable => {
    if (incomingVariableIds.has(variable.id)) {
      throw new Error(`O pacote contém a variable duplicada "${variable.id}".`);
    }
    incomingVariableIds.add(variable.id);
    const requestedTokenId = nativeTokenId(payload, variable);
    if (!requestedTokenId) throw new Error(`A variable "${variable.name}" não possui uma identidade válida.`);
    if (incomingRequestedTokenIds.has(requestedTokenId)) {
      throw new Error(`O pacote mapeia mais de uma variable para o token "${requestedTokenId}".`);
    }
    incomingRequestedTokenIds.add(requestedTokenId);
    const marker = figmaTokenProvenance(payload, variable);
    const provenanceIdentity = `${figmaPayloadSourceId(payload)}\u0000${variable.id}`;
    let tokenId = requestedTokenId;
    let existingIndex = tokenIndexById.get(tokenId);
    if (existingIndex !== undefined && !tokenHasFigmaProvenance(tokens[existingIndex], marker)) {
      let resolved = false;
      for (let attempt = 0; attempt < 10_000; attempt += 1) {
        const candidate = disambiguatedTokenId(requestedTokenId, provenanceIdentity, attempt);
        const candidateIndex = tokenIndexById.get(candidate);
        if (candidateIndex === undefined || tokenHasFigmaProvenance(tokens[candidateIndex], marker)) {
          tokenId = candidate;
          existingIndex = candidateIndex;
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        throw new Error(`Não foi possível desambiguar o token "${requestedTokenId}" com segurança.`);
      }
    }
    if (incomingResolvedTokenIds.has(tokenId)) {
      throw new Error(`O pacote produz a identidade de token duplicada "${tokenId}".`);
    }
    incomingResolvedTokenIds.add(tokenId);
    const nativeCssName = designTokenCssName(tokenId);
    const previousCssMapping = cssNames.get(variable.cssName);
    if (previousCssMapping && previousCssMapping !== nativeCssName) {
      throw new Error(`O pacote reutiliza o nome CSS "${variable.cssName}" em variables diferentes.`);
    }
    cssNames.set(variable.cssName, nativeCssName);

    const collection = nativeCollection(payload, variable);
    if (!existingCollectionIds.has(collection.id)) pendingCollections.set(collection.id, collection);
    const importedToken: HtmlDesignToken = {
      id: tokenId,
      collectionId: collection.id,
      name: variable.name.trim().slice(0, 120) || 'Figma variable',
      type: nativeTokenType(variable),
      value: nativeTokenValue(variable),
      description: nativeTokenDescription(payload, variable),
    };
    if (existingIndex !== undefined) {
      // Only a token carrying this exact source+variable marker is owned by
      // the importer. Reimports refresh it while user-authored collisions are
      // preserved under their original id.
      tokens[existingIndex] = importedToken;
      return;
    }
    pendingTokens.push(importedToken);
  });

  const collections = [
    ...existing.collections,
    ...Array.from(pendingCollections.values()).sort((left, right) => left.id.localeCompare(right.id)),
  ];
  const mergedTokens = [
    ...tokens,
    ...pendingTokens.sort((left, right) => left.id.localeCompare(right.id)),
  ];
  return { document: { version: 1, collections, tokens: mergedTokens }, cssNames };
}

function replaceFigmaVariableReferences(value: string, names: Map<string, string>) {
  let result = value;
  Array.from(names.entries())
    .sort(([left], [right]) => right.length - left.length || left.localeCompare(right))
    .forEach(([source, target]) => {
      if (source === target) return;
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`${escaped}(?![a-zA-Z0-9_-])`, 'g'), target);
    });
  return result;
}

function scopedExportId(value: string) {
  const trimmed = value.trim();
  const safe = safeSegment(trimmed, 'export');
  return safe === trimmed ? safe : `${safe}-${stableHash(trimmed)}`;
}

function extensionForAsset(asset: KodetyFigmaAsset) {
  if (asset.mimeType === 'image/jpeg') return 'jpg';
  if (asset.mimeType === 'image/gif') return 'gif';
  if (asset.mimeType === 'image/svg+xml') return 'svg';
  if (asset.mimeType === 'image/webp') return 'webp';
  if (asset.mimeType === 'font/woff2') return 'woff2';
  if (asset.mimeType === 'font/woff') return 'woff';
  if (asset.mimeType === 'font/ttf') return 'ttf';
  if (asset.mimeType === 'font/otf') return 'otf';
  return 'png';
}

function isFontAsset(asset: KodetyFigmaAsset) {
  return FONT_ASSET_MIME_TYPES.has(asset.mimeType);
}

function abortIfRequested(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Importação cancelada.', 'AbortError');
}

function compactBase64(asset: KodetyFigmaAsset) {
  if (!asset.dataBase64) throw new Error(`O asset "${asset.name}" não contém dados.`);
  const compact = asset.dataBase64.replace(/\s+/g, '');
  if (
    !compact
    || compact.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)
  ) {
    throw new Error(`O asset "${asset.name}" possui base64 inválido.`);
  }
  return compact;
}

function decodedBase64ByteLength(compact: string) {
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return (compact.length / 4) * 3 - padding;
}

async function decodeBase64(
  compact: string,
  expectedBytes: number,
  signal?: AbortSignal,
) {
  const bytes = new Uint8Array(expectedBytes);
  let outputOffset = 0;
  let bytesSinceYield = 0;
  for (let offset = 0; offset < compact.length; offset += BASE64_DECODE_CHUNK_CHARACTERS) {
    abortIfRequested(signal);
    const binary = globalThis.atob(compact.slice(offset, offset + BASE64_DECODE_CHUNK_CHARACTERS));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[outputOffset + index] = binary.charCodeAt(index);
    }
    outputOffset += binary.length;
    bytesSinceYield += binary.length;
    if (bytesSinceYield >= BASE64_YIELD_BYTES) {
      bytesSinceYield = 0;
      await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
    }
  }
  if (outputOffset !== expectedBytes) throw new Error('O tamanho decodificado do asset não corresponde ao pacote.');
  return bytes;
}

function relativeHref(fromFile: string, toFile: string) {
  const from = normalizeProjectPath(fromFile, 'O arquivo de origem').split('/');
  from.pop();
  const to = normalizeProjectPath(toFile, 'O arquivo de destino').split('/');
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => '..'), ...to].join('/') || './';
}

function decodeProtocolEscapes(value: string) {
  const character = (raw: string, radix: number) => {
    const codePoint = Number.parseInt(raw, radix);
    return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : '';
  };
  return value
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_match, hex, decimal) =>
      character(hex || decimal, hex ? 16 : 10))
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, code) =>
      character(code, 16))
    .replace(/\\(.)/g, '$1')
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase();
}

function isUnsafeResource(value: string, blockExternal: boolean) {
  const normalized = decodeProtocolEscapes(value.replace(/^['"]|['"]$/g, ''));
  if (/^(?:javascript|vbscript|file|filesystem):/.test(normalized)) return true;
  if (/^data:(?!image\/(?:png|jpeg|jpg|gif|webp)(?:;|,))/i.test(normalized)) return true;
  return blockExternal && /^(?:https?:|ftp:|\/\/)/.test(normalized);
}

function sanitizeCss(css: string, blockExternal = true) {
  return css
    .replace(/@import\b[^;]*(?:;|$)/gi, '')
    .replace(/expression\s*\(/gi, '/* blocked-expression */(')
    .replace(/url\s*\(\s*([^)]*?)\s*\)/gi, (match, raw: string) =>
      isUnsafeResource(raw.trim(), blockExternal) ? 'none' : match)
    .replace(/KODETY_FIGMA:/gi, 'KODETY-FIGMA:')
    .replace(/<\/style/gi, '<\\/style');
}

function sanitizeSvg(svg: string) {
  const sanitized = svg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/\s*>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (match, doubleQuoted, singleQuoted, bare) =>
        isUnsafeResource(doubleQuoted ?? singleQuoted ?? bare ?? '', true) ? '' : match,
    )
    .replace(
      /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
      (_match, doubleQuoted, singleQuoted) => {
        const quote = doubleQuoted !== undefined ? '"' : "'";
        return ` style=${quote}${sanitizeCss(doubleQuoted ?? singleQuoted ?? '', true)}${quote}`;
      },
    )
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_match, open, css, close) =>
      `${open}${sanitizeCss(css, true)}${close}`);
  // Inline SVG can inherit its namespace from HTML, but these assets are
  // loaded as standalone XML images. Missing SVG/XLink namespaces otherwise
  // turn valid paths, masks or <use> references into a broken image.
  return sanitized.replace(/<svg(?=[\s>])([^>]*)>/i, (tag, attributes: string) => {
    let result = tag;
    if (!/\sxmlns\s*=/i.test(attributes)) {
      result = result.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (/\bxlink:href\s*=/i.test(sanitized) && !/\sxmlns:xlink\s*=/i.test(attributes)) {
      result = result.replace(/^<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }
    return result;
  });
}

async function decodedAsset(
  asset: KodetyFigmaAsset,
  expectedBytes: number,
  compact: string | null,
  signal?: AbortSignal,
) {
  abortIfRequested(signal);
  if (asset.mimeType === 'image/svg+xml' && typeof asset.text === 'string') {
    return new TextEncoder().encode(sanitizeSvg(asset.text));
  }
  if (!compact) throw new Error(`O asset "${asset.name}" não contém dados.`);
  const decoded = await decodeBase64(compact, expectedBytes, signal);
  if (isFontAsset(asset)) {
    assertFontSignature(asset, decoded);
    return decoded;
  }
  if (asset.mimeType !== 'image/svg+xml') return decoded;
  let svg: string;
  try {
    svg = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch {
    throw new Error(`O SVG "${asset.name}" não está codificado em UTF-8.`);
  }
  return new TextEncoder().encode(sanitizeSvg(svg));
}

function assertFontSignature(asset: KodetyFigmaAsset, bytes: Uint8Array) {
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  const trueTypeSignature = (
    (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00)
    || signature === 'true'
    || signature === 'typ1'
    || signature === 'ttcf'
  );
  const valid = (
    (asset.mimeType === 'font/woff2' && signature === 'wOF2')
    || (asset.mimeType === 'font/woff' && signature === 'wOFF')
    || (asset.mimeType === 'font/otf' && signature === 'OTTO')
    || (asset.mimeType === 'font/ttf' && trueTypeSignature)
  );
  if (!valid) {
    throw new Error(
      `O arquivo "${asset.name}" não corresponde ao formato ${extensionForAsset(asset).toUpperCase()} informado.`,
    );
  }
}

function sanitizeFragment(html: string) {
  const fragment = parseFragment(html) as unknown as ParsedNode;
  let elementCount = 0;
  let treeNodeCount = 0;
  let normalizedButtonGroups = 0;
  const visit = (node: ParsedNode, insideButton = false) => {
    treeNodeCount += 1;
    if (treeNodeCount > MAX_FRAGMENT_TREE_NODES) {
      throw new Error('O HTML do design possui uma árvore excessivamente complexa.');
    }
    if (node.tagName) elementCount += 1;
    if (elementCount > MAX_FRAGMENT_NODES) {
      throw new Error('O design excede o limite de 100.000 nós por colagem.');
    }
    // Earlier plugin exports used div for visual groups even inside a button.
    // Repair only identified Figma groups, keeping classes, assets and children
    // editable. All other HTML (including interactive nesting) still passes
    // through the Builder's unchanged structural validator.
    if (insideButton && node.tagName === 'div'
      && node.attrs?.some(attribute => attribute.name === 'data-figma-id' && attribute.value)) {
      node.tagName = 'span';
      node.nodeName = 'span';
      node.attrs.push({ name: 'data-kodety-figma-block', value: '' });
      normalizedButtonGroups += 1;
    }
    const children = node.childNodes || [];
    node.childNodes = children.filter(child => {
      const tag = (child.tagName || '').toLowerCase();
      return !FORBIDDEN_ELEMENTS.has(tag);
    });
    node.attrs = (node.attrs || []).filter(attribute => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) return false;
      if (name === 'style') {
        attribute.value = sanitizeCss(attribute.value, true);
        return true;
      }
      if (
        ['action', 'formaction', 'href', 'poster', 'src', 'xlink:href'].includes(name)
        && isUnsafeResource(attribute.value, false)
      ) return false;
      if (
        name === 'srcset'
        && attribute.value.split(',').some(candidate =>
          isUnsafeResource(candidate.trim().split(/\s+/)[0] || '', false))
      ) return false;
      return name !== 'srcdoc';
    });
    const target = node.attrs?.find(attribute => attribute.name.toLowerCase() === 'target')?.value;
    if (target?.toLowerCase() === '_blank') {
      const rel = node.attrs?.find(attribute => attribute.name.toLowerCase() === 'rel');
      const tokens = new Set((rel?.value || '').split(/\s+/).filter(Boolean));
      tokens.add('noopener');
      tokens.add('noreferrer');
      if (rel) rel.value = Array.from(tokens).join(' ');
      else node.attrs?.push({ name: 'rel', value: Array.from(tokens).join(' ') });
    }
    const buttonContext = insideButton || node.tagName === 'button';
    node.childNodes.forEach(child => visit(child, buttonContext));
    if (node.content) visit(node.content, buttonContext);
  };
  visit(fragment);
  return {
    html: serialize(fragment as never),
    nodeCount: elementCount,
    normalizedButtonGroups,
    // Preserve a div's default box without overriding authored flex/grid CSS.
    compatibilityCss: normalizedButtonGroups
      ? ':where(span[data-kodety-figma-block]){display:block;}\n'
      : '',
  };
}

function replaceAssetReferences(
  value: string,
  assetPaths: Map<string, string>,
  fromPath: string,
) {
  const unresolved = new Set<string>();
  const result = value.replace(
    /figma-asset:\/\/([A-Za-z0-9][A-Za-z0-9._:-]{0,255})/g,
    (_match, id: string) => {
      const path = assetPaths.get(id);
      if (!path) {
        unresolved.add(id);
        return `figma-asset://${id}`;
      }
      return relativeHref(fromPath, path);
    },
  );
  return { result, unresolved };
}

function assertResolvedAssets(unresolved: Set<string>) {
  if (!unresolved.size) return;
  const examples = Array.from(unresolved).slice(0, 3).map(id => `"${id}"`).join(', ');
  throw new Error(
    `O pacote referencia ${unresolved.size} asset(s) ausente(s): ${examples}. Copie a seleção novamente no Figma.`,
  );
}

function uniqueAssetPath(
  directory: string,
  stem: string,
  extension: string,
  assetId: string,
  usedPaths: Set<string>,
) {
  const candidates = [
    `${directory}/${stem}.${extension}`,
    `${directory}/${stem}-${safeSegment(assetId, 'asset')}.${extension}`,
  ];
  let suffix = 2;
  let candidate = candidates.shift()!;
  while (usedPaths.has(candidate)) {
    candidate = candidates.shift() || `${directory}/${stem}-${suffix++}.${extension}`;
  }
  usedPaths.add(candidate);
  return candidate;
}

function figmaCssBlockPattern(exportId: string) {
  const escaped = exportId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\/\\* KODETY_FIGMA:${escaped}:START \\*\\/[\\s\\S]*?\\/\\* KODETY_FIGMA:${escaped}:END \\*\\/`,
    'g',
  );
}

function removeCssBlock(currentCss: string, exportId: string) {
  return currentCss
    .replace(figmaCssBlockPattern(exportId), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function replaceCssBlock(currentCss: string, exportId: string, block: string) {
  const withoutPrevious = removeCssBlock(currentCss, exportId);
  return `${withoutPrevious}${withoutPrevious.trim() ? '\n\n' : ''}${block}\n`;
}

function normalizedFonts(fonts: KodetyFigmaFont[]) {
  const seen = new Set<string>();
  return fonts.flatMap(font => {
    const normalized = {
      family: font.family.trim().replace(/\s+/g, ' ').slice(0, 256),
      style: font.style.trim().replace(/\s+/g, ' ').slice(0, 128) || 'Regular',
      weight: Math.max(1, Math.min(1000, Math.round(font.weight))),
      missing: Boolean(font.missing),
      ...(font.assetId ? { assetId: font.assetId } : {}),
    };
    const identity = `${normalized.family.toLocaleLowerCase()}\u0000${normalized.style.toLocaleLowerCase()}\u0000${normalized.weight}`;
    if (!normalized.family || seen.has(identity)) return [];
    seen.add(identity);
    return [normalized];
  });
}

function normalizedFontFamily(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizedFontStyle(value: string) {
  if (/italic/i.test(value)) return 'italic';
  if (/oblique/i.test(value)) return 'oblique';
  return 'normal';
}

function fontFaceIdentity(font: KodetyFigmaFont) {
  return [
    normalizedFontFamily(font.family),
    normalizedFontStyle(font.style),
    Math.max(1, Math.min(1000, Math.round(font.weight))),
  ].join('\u0000');
}

function faceSupportsWeight(value: string | undefined, requestedWeight: number) {
  const normalized = String(value || 'normal').trim().toLowerCase();
  if (normalized === 'normal') return requestedWeight === 400;
  if (normalized === 'bold') return requestedWeight === 700;
  const weights = normalized.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (weights.length >= 2) {
    return requestedWeight >= Math.min(...weights) && requestedWeight <= Math.max(...weights);
  }
  return weights.length === 1 && Math.round(weights[0]) === requestedWeight;
}

function missingProjectFontFaces(
  project: HtmlProject,
  fonts: KodetyFigmaFont[],
  attachedFaces: Set<string>,
) {
  const systemFamilies = new Set([
    'arial',
    'helvetica',
    'times new roman',
    'times',
    'courier new',
    'courier',
    'georgia',
    'verdana',
    'tahoma',
    'trebuchet ms',
    'system-ui',
    'sans-serif',
    'serif',
    'monospace',
  ]);
  const catalog = discoverProjectFonts(project);
  const googleFonts = projectGoogleFonts(project);
  return Array.from(new Set(fonts.flatMap(font => {
    const family = font.family.trim();
    const normalizedFamily = normalizedFontFamily(family);
    if (
      !family
      || systemFamilies.has(normalizedFamily)
      || attachedFaces.has(fontFaceIdentity(font))
    ) return [];
    if (googleFonts.some(candidate => normalizedFontFamily(candidate.family) === normalizedFamily
      && googleFontSupportsFigmaFace(candidate, font))) return [];
    const installedFamily = catalog.fonts.find(candidate =>
      [candidate.family, ...(candidate.aliases || [])]
        .some(alias => normalizedFontFamily(alias) === normalizedFamily));
    if (!installedFamily) return [family];
    const requestedStyle = normalizedFontStyle(font.style);
    const hasFace = installedFamily.faces.some(face => {
      const faceStyle = normalizedFontStyle(face.style || 'normal');
      return (
        faceStyle === requestedStyle
        && faceSupportsWeight(face.weight, Math.round(font.weight))
      );
    });
    return hasFace
      ? []
      : [`${family} · ${font.style || 'Regular'} · ${Math.round(font.weight)}`];
  })));
}

function escapeCssString(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n|\f/g, ' ');
}

function fontFormat(asset: KodetyFigmaAsset) {
  if (asset.mimeType === 'font/woff2') return 'woff2';
  if (asset.mimeType === 'font/woff') return 'woff';
  if (asset.mimeType === 'font/otf') return 'opentype';
  return 'truetype';
}

function attachedFontFaceCss(
  fonts: KodetyFigmaFont[],
  assetsById: Map<string, KodetyFigmaAsset>,
  assetPaths: Map<string, string>,
  stylesheetPath: string,
) {
  const attachedFaces = new Set<string>();
  const rules: string[] = [];
  fonts.forEach(font => {
    if (!font.assetId) return;
    const asset = assetsById.get(font.assetId);
    const path = assetPaths.get(font.assetId);
    if (!asset || !path) {
      throw new Error(
        `A fonte "${font.family} · ${font.style}" referencia um arquivo ausente no pacote.`,
      );
    }
    if (!isFontAsset(asset)) {
      throw new Error(
        `A fonte "${font.family} · ${font.style}" está ligada a um asset que não é uma fonte.`,
      );
    }
    const identity = fontFaceIdentity(font);
    if (attachedFaces.has(identity)) return;
    attachedFaces.add(identity);
    const source = escapeCssString(relativeHref(stylesheetPath, path));
    rules.push(
      `@font-face{font-family:"${escapeCssString(font.family)}";`
      + `src:url("${source}") format("${fontFormat(asset)}");`
      + `font-style:${normalizedFontStyle(font.style)};`
      + `font-weight:${Math.max(1, Math.min(1000, Math.round(font.weight)))};`
      + 'font-display:swap;}',
    );
  });
  return { css: rules.join('\n'), attachedFaces };
}

function chooseStylesheetPath(
  project: HtmlProject,
  preferredPath: string | null | undefined,
) {
  const preferred = preferredPath
    ? normalizeProjectPath(preferredPath, 'O caminho do stylesheet')
    : '';
  if (preferred && project.files[preferred]?.text !== undefined && /\.css$/i.test(preferred)) {
    return preferred;
  }
  const existing = Object.values(project.files).find(
    file => file.text !== undefined && (file.mimeType === 'text/css' || /\.css$/i.test(file.path)),
  );
  return existing?.path || 'stylesheets/figma-imports.css';
}

function cssBlock(exportId: string, css: string) {
  return `/* KODETY_FIGMA:${exportId}:START */\n${css.trim()}\n/* KODETY_FIGMA:${exportId}:END */`;
}

export function parseKodetyFigmaClipboard(
  text: string,
  html = '',
): KodetyFigmaHtmlPayload | null {
  const candidates = [text, html].filter(Boolean);
  for (const candidate of candidates) {
    if (
      candidate.length > MAX_CLIPBOARD_CHARACTERS
      || !candidate.includes(KODETY_FIGMA_SIGNATURE)
    ) continue;
    const trimmed = candidate.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isKodetyFigmaHtmlPayload(parsed)) return parsed;
    } catch {
      // Another clipboard flavor may still contain the valid JSON.
    }
  }
  return null;
}

export async function importKodetyFigmaPayload(
  project: HtmlProject,
  payload: KodetyFigmaHtmlPayload,
  options: ImportKodetyFigmaOptions = {},
): Promise<KodetyFigmaImportResult> {
  const reportProgress = (progress: KodetyFigmaImportProgress) => {
    try {
      options.onProgress?.(progress);
    } catch {
      // Import callbacks are observational and must never break the transaction.
    }
  };
  abortIfRequested(options.signal);
  if (!isKodetyFigmaHtmlPayload(payload)) {
    throw new Error('O pacote do Figma não é compatível com esta versão do Kodety.');
  }
  if (payload.html.length > MAX_HTML_CHARACTERS || payload.css.length > MAX_CSS_CHARACTERS) {
    throw new Error('O HTML ou CSS do design excede o limite seguro de importação.');
  }
  if (payload.assets.length > MAX_ASSET_COUNT) {
    throw new Error('O design excede o limite de 10.000 assets por colagem.');
  }
  if (payload.fonts.length > MAX_FONT_METADATA_COUNT) {
    throw new Error('O design excede o limite de 10.000 referências de fontes.');
  }
  if (payload.variables.length > MAX_VARIABLE_METADATA_COUNT) {
    throw new Error('O design excede o limite de 100.000 variables.');
  }
  if (payload.warnings.length > MAX_WARNING_COUNT) {
    throw new Error('O pacote contém avisos demais e não pôde ser validado.');
  }
  const variableMaterialization = mergeFigmaVariables(project, payload);

  const pagePath = normalizeProjectPath(
    options.pagePath || project.mainHtmlPath,
    'O caminho da página',
  );
  const pageFile = project.files[pagePath];
  if (pageFile?.text === undefined || !/\.html?$/i.test(pagePath)) {
    throw new Error('A página HTML atual não está disponível para receber o design.');
  }
  const placement = options.placement || 'inside';
  if (placement !== 'inside' && placement !== 'after') {
    throw new Error('A posição escolhida para a colagem não é válida.');
  }
  const targetPath = options.targetPath?.trim() || null;
  if (targetPath && !/^\d+(?:\/\d+)*$/.test(targetPath)) {
    throw new Error('A layer selecionada não possui um caminho válido.');
  }
  if (placement === 'after' && !targetPath) {
    throw new Error('Selecione uma layer antes de colar o design ao lado dela.');
  }

  reportProgress({ phase: 'prepare', completed: 0, total: payload.assets.length });
  const exportId = scopedExportId(payload.exportId);
  const assetDirectory = `assets/figma/${exportId}`;
  const assetPaths = new Map<string, string>();
  const assetsById = new Map<string, KodetyFigmaAsset>();
  const usedAssetPaths = new Set<string>();
  const seenAssetIds = new Set<string>();
  const fonts = normalizedFonts(payload.fonts);
  const preparedAssets: Array<{
    asset: KodetyFigmaAsset;
    expectedBytes: number;
    compact: string | null;
    path: string;
  }> = [];
  let estimatedTotalAssetBytes = 0;
  payload.assets.forEach((asset, index) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(asset.id)) {
      throw new Error(`O identificador do asset ${index + 1} não é válido.`);
    }
    if (seenAssetIds.has(asset.id)) {
      throw new Error(`O pacote contém o asset duplicado "${asset.id}".`);
    }
    seenAssetIds.add(asset.id);
    assetsById.set(asset.id, asset);
    if (!ALLOWED_ASSET_MIME_TYPES.has(asset.mimeType)) {
      throw new Error(`O formato do asset "${asset.name}" não é permitido.`);
    }
    const textSvg = asset.mimeType === 'image/svg+xml' && typeof asset.text === 'string';
    const compact = textSvg ? null : compactBase64(asset);
    const expectedBytes = textSvg
      ? new TextEncoder().encode(asset.text).byteLength
      : decodedBase64ByteLength(compact!);
    if (expectedBytes > MAX_ASSET_BYTES) {
      throw new Error(`O asset "${asset.name}" excede 256 MB.`);
    }
    estimatedTotalAssetBytes += expectedBytes;
    if (estimatedTotalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
      throw new Error('Os assets do design excedem 768 MB no total.');
    }
    const stem = safeSegment(asset.name.replace(/\.[a-z0-9]+$/i, ''), `asset-${index + 1}`);
    const destinationDirectory = isFontAsset(asset)
      ? `${assetDirectory}/fonts`
      : assetDirectory;
    const path = uniqueAssetPath(
      destinationDirectory,
      stem,
      extensionForAsset(asset),
      asset.id,
      usedAssetPaths,
    );
    assetPaths.set(asset.id, path);
    preparedAssets.push({ asset, expectedBytes, compact, path });
  });

  const sanitized = sanitizeFragment(
    replaceFigmaVariableReferences(payload.html, variableMaterialization.cssNames),
  );
  if (!sanitized.html.trim() || !sanitized.nodeCount) {
    throw new Error('O design do Figma não contém elementos visíveis.');
  }
  const stylesheetPath = chooseStylesheetPath(project, options.preferredStylesheetPath);
  const attachedFonts = attachedFontFaceCss(
    fonts,
    assetsById,
    assetPaths,
    stylesheetPath,
  );
  const markupReferences = replaceAssetReferences(sanitized.html, assetPaths, pagePath);
  const cssReferences = replaceAssetReferences(
    sanitizeCss(
      sanitized.compatibilityCss + replaceFigmaVariableReferences(payload.css, variableMaterialization.cssNames),
      true,
    ),
    assetPaths,
    stylesheetPath,
  );
  const unresolved = new Set([
    ...markupReferences.unresolved,
    ...cssReferences.unresolved,
  ]);
  assertResolvedAssets(unresolved);

  const decodedFiles: Array<HtmlProjectFile> = [];
  let decodedTotalAssetBytes = 0;
  for (let index = 0; index < preparedAssets.length; index += 1) {
    abortIfRequested(options.signal);
    const prepared = preparedAssets[index];
    const data = await decodedAsset(
      prepared.asset,
      prepared.expectedBytes,
      prepared.compact,
      options.signal,
    );
    if (data.byteLength > MAX_ASSET_BYTES) {
      throw new Error(`O asset "${prepared.asset.name}" excede 256 MB após a sanitização.`);
    }
    decodedTotalAssetBytes += data.byteLength;
    if (decodedTotalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
      throw new Error('Os assets do design excedem 768 MB no total.');
    }
    decodedFiles.push({
      path: prepared.path,
      mimeType: prepared.asset.mimeType,
      data,
    });
    reportProgress({
      phase: 'assets',
      completed: index + 1,
      total: preparedAssets.length,
    });
  }

  abortIfRequested(options.signal);
  reportProgress({
    phase: 'commit',
    completed: preparedAssets.length,
    total: preparedAssets.length,
  });
  const files: Record<string, HtmlProjectFile> = { ...project.files };
  Object.keys(files).forEach(path => {
    if (path.startsWith(`${assetDirectory}/`)) delete files[path];
  });
  decodedFiles.forEach(file => {
    files[file.path] = file;
  });
  const currentCss = files[stylesheetPath]?.text || '';
  files[stylesheetPath] = {
    path: stylesheetPath,
    mimeType: 'text/css',
    text: replaceCssBlock(
      currentCss,
      exportId,
      cssBlock(
        exportId,
        [attachedFonts.css, cssReferences.result].filter(Boolean).join('\n'),
      ),
    ),
  };

  const linkedSource = ensureCssLink(pageFile.text, relativeHref(pagePath, stylesheetPath));
  let nextSource: string;
  let selectionPath: string;
  if (placement === 'after' && targetPath) {
    const inserted = patchInsertAdjacentElement(
      linkedSource,
      targetPath,
      markupReferences.result,
      'after',
    );
    nextSource = inserted.source;
    selectionPath = inserted.path;
  } else {
    const childIndex = getElementChildCount(linkedSource, targetPath);
    nextSource = patchInsertElement(linkedSource, targetPath, markupReferences.result);
    selectionPath = targetPath ? `${targetPath}/${childIndex}` : String(childIndex);
  }
  files[pagePath] = { ...pageFile, text: nextSource };

  const importedProjectWithoutVariables = { ...project, files };
  const projectWithVariables = payload.variables.length
    ? updateProjectDesignTokens(importedProjectWithoutVariables, variableMaterialization.document)
    : importedProjectWithoutVariables;
  const importedProject = registerFigmaGoogleFonts(projectWithVariables, fonts, options.googleFontsCatalog || []);
  const missingFonts = missingProjectFontFaces(
    importedProject,
    fonts,
    attachedFonts.attachedFaces,
  );
  const missingFontExamples = missingFonts.slice(0, 5).map(font => `"${font}"`).join(', ');
  const additionalMissingFonts = Math.max(0, missingFonts.length - 5);
  const warnings = Array.from(new Set([
    ...payload.warnings.map(item => item.trim()).filter(Boolean).map(item => item.slice(0, 500)),
    ...(options.googleFontsUnavailable && missingFonts.length
      ? ['Não foi possível consultar o Google Fonts agora. As famílias originais foram preservadas; reconverta/cole com conexão ou anexe as fontes para carregar a tipografia exata.']
      : []),
    ...(sanitized.normalizedButtonGroups
      ? [`${sanitized.normalizedButtonGroups} grupo(s) de uma exportação anterior foram normalizados para HTML válido dentro de botões, preservando as layers e o CSS.`]
      : []),
    ...(missingFonts.length
      ? [`${missingFonts.length === 1 ? 'A face' : 'As faces'} ${missingFontExamples}${additionalMissingFonts ? ` e mais ${additionalMissingFonts}` : ''} ${missingFonts.length === 1 ? 'não está disponível' : 'não estão disponíveis'} no projeto. O Builder manterá a família declarada e usará o fallback do CSS apenas para essas faces.`]
      : []),
  ]));

  return {
    project: importedProject,
    pagePath,
    stylesheetPath,
    selectionPath,
    importedNodes: Math.max(1, Math.round(payload.stats.nodes) || sanitized.nodeCount),
    importedAssets: payload.assets.length,
    fonts,
    missingFonts,
    googleFonts: projectGoogleFonts(importedProject)
      .filter(font => fonts.some(face => normalizedFontFamily(face.family) === normalizedFontFamily(font.family)))
      .map(font => font.family),
    warnings,
  };
}
