export const KODETY_FIGMA_SIGNATURE = '__kodety_figma__';

export type KodetyNodeClass = 'FrameNode' | 'TextNode' | 'ImageNode' | 'SvgNode';

/**
 * Absolute positioning for children that live inside a non-auto-layout parent.
 * Offsets are in px relative to the parent's top-left.
 */
export interface KodetyNodePosition {
  type: 'absolute';
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Semantic hints emitted by the plugin. The converter decides the final HTML
 * tag (`settings.tag`) using these hints plus heuristics.
 */
export interface KodetySemanticHints {
  isLink?: boolean;
  linkUrl?: string;
  looksLikeButton?: boolean;
  headingLevel?: number; // 1-6 when inferable from a text style name / hierarchy
}

/**
 * Maps a node design property to a token id in `payload.tokens`. The converter
 * replaces the literal value with `var(--<colorVariableId>)` after the token is
 * materialized.
 */
export interface KodetyBoundVariables {
  fillColor?: string; // token id
  borderColor?: string; // token id
  textColor?: string; // token id
}

export type KodetyOverrideValue =
  | { type: 'text'; value: string }
  | { type: 'richText'; html: string }
  | { type: 'image'; imageData: string }
  | { type: 'variant'; variantId: string }
  | { type: 'boolean'; value: boolean };

/** Reference to a component instance (Phase 2). */
export interface KodetyComponentInstanceRef {
  componentId: string; // -> payload.components[id]
  variantId?: string;
  overrides?: Record<string, KodetyOverrideValue>; // propertyKey -> value
}

export interface KodetyNode {
  __class: KodetyNodeClass;
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  width: number;
  height: number;
  widthType: 'fixed' | 'fill' | 'hug';
  heightType: 'fixed' | 'fill' | 'hug';
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  aspectRatio?: number | null;
  rotation?: number;
  opacity: number;
  fillEnabled: boolean;
  fillType: 'color' | 'gradient' | 'image' | 'none';
  fillColor?: string;
  fillGradient?: string;
  borderEnabled: boolean;
  borderWidth: number;
  borderColor?: string;
  borderStyle: string;
  borderPerSide: boolean;
  borderTop?: number;
  borderRight?: number;
  borderBottom?: number;
  borderLeft?: number;
  borderAlign?: string; // INSIDE | OUTSIDE | CENTER (Figma strokeAlign)
  radius: number;
  radiusPerCorner: boolean;
  radiusValue?: string;
  radiusTopLeft?: number;
  radiusTopRight?: number;
  radiusBottomRight?: number;
  radiusBottomLeft?: number;
  boxShadow?: string;
  blur?: number;
  backdropBlur?: number;
  blendMode?: string;
  overflow: 'visible' | 'hidden' | 'auto' | 'scroll';
  overflowX?: 'auto' | 'scroll';
  overflowY?: 'auto' | 'scroll';
  display?: 'flex' | 'grid' | 'block';
  flexDirection?: 'row' | 'column';
  flexWrap?: 'nowrap' | 'wrap';
  justifyContent?: string;
  alignItems?: string;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  textVerticalAlignment?: 'top' | 'center' | 'bottom';
  lineClamp?: number;
  html?: string;
  imageData?: string;
  svgData?: string;
  children?: KodetyNode[];

  // ─── v3 additions ─────────────────────────────────────────────────────────
  // Phase 1: structure & semantics
  position?: KodetyNodePosition;
  semantic?: KodetySemanticHints;
  // Phase 2: components
  isInstance?: boolean; // node was a Figma component instance
  instanceOf?: KodetyComponentInstanceRef;
  // Phase 3: styles & tokens
  textStyleId?: string; // -> payload.styles
  fillStyleId?: string; // -> payload.styles
  effectStyleId?: string; // -> payload.styles
  strokeStyleId?: string; // -> payload.styles
  boundVariables?: KodetyBoundVariables;
}

// ─── Payload-level design-system tables (v3) ──────────────────────────────────

export type FigmaStyleType = 'text' | 'fill' | 'effect' | 'stroke';

export interface FigmaStyleEntry {
  id: string;
  name: string;
  type: FigmaStyleType;
  /** Text styles: CSS-ish typography map (font-family, font-size, ...). */
  typography?: Record<string, string>;
  /** Fill / stroke styles: resolved CSS color. */
  color?: string;
  /** Effect styles: resolved CSS box-shadow. */
  boxShadow?: string;
}

export interface FigmaTokenEntry {
  id: string;
  name: string; // Figma variable name (e.g. "Brand/Primary")
  /** Value in Kodety color-variable stored format: `#hex` or `#hex/opacity`. */
  value: string;
}

export type FigmaComponentPropertyType = 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP' | 'VARIANT';

export interface FigmaComponentPropertyEntry {
  key: string;
  name: string;
  type: FigmaComponentPropertyType;
}

export interface FigmaComponentVariantEntry {
  id: string;
  name: string;
  nodes: KodetyNode[];
}

export interface FigmaComponentEntry {
  id: string;
  name: string;
  variants: FigmaComponentVariantEntry[];
  properties: FigmaComponentPropertyEntry[];
}

export interface KodetyImportOptions {
  createComponents?: boolean;
  extractStyles?: boolean;
  syncTokens?: boolean;
  responsive?: boolean;
  aggressiveResponsive?: boolean;
}

/** Legacy structured-node payload emitted by the first Figma bridge. */
export const KODETY_FIGMA_LEGACY_VERSION = 3;
/** Previous compiled HTML/CSS transport, retained for clipboard compatibility. */
export const KODETY_FIGMA_HTML_LEGACY_VERSION = 4;
/** Current transport: compiled HTML/CSS plus optional REST-scene metadata. */
export const KODETY_FIGMA_VERSION = 5;

export type KodetyFigmaAssetMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/svg+xml'
  | 'image/webp'
  | 'font/woff2'
  | 'font/woff'
  | 'font/ttf'
  | 'font/otf';

export interface KodetyFigmaAsset {
  id: string;
  name: string;
  mimeType: KodetyFigmaAssetMimeType;
  /** Raw binary encoded as base64. SVG assets may alternatively use `text`. */
  dataBase64?: string;
  text?: string;
  width?: number;
  height?: number;
}

export interface KodetyFigmaFont {
  family: string;
  style: string;
  weight: number;
  /** True when Figma reports that this exact face is unavailable locally. */
  missing?: boolean;
  /** Optional licensed font binary added by the user in the plugin UI. */
  assetId?: string;
}

export interface KodetyFigmaFontUsage extends KodetyFigmaFont {
  nodes: number;
  characters: number;
}

export interface KodetyFigmaVariable {
  id: string;
  name: string;
  cssName: string;
  type: 'color' | 'number' | 'string' | 'boolean';
  value: string | number | boolean;
  /** Native Kodety token id (the suffix after `--kodety-token-`). */
  tokenId?: string;
  /** Figma collection/mode provenance used to group native Builder tokens. */
  collectionId?: string;
  collectionName?: string;
  modeId?: string;
  modeName?: string;
}

export interface KodetyFigmaExportStats {
  nodes: number;
  assets: number;
  bytes: number;
  richTextSegments?: number;
  inferredAutoLayoutNodes?: number;
  geometryInferredAutoLayoutNodes?: number;
  missingFonts?: number;
  semanticNodes?: number;
  rasterizedNodes?: number;
  backgroundRasterizedNodes?: number;
  vectorFallbackNodes?: number;
  imageFallbackNodes?: number;
  responsiveRules?: number;
  restSnapshotRoots?: number;
  restSnapshotNodes?: number;
}

export type KodetyFigmaRestSceneFormat = 'JSON_REST_V1';

export interface KodetyFigmaEngine {
  version: typeof KODETY_FIGMA_VERSION;
  sceneFormat: KodetyFigmaRestSceneFormat;
}

export interface KodetyFigmaRestScene {
  version: 1;
  format: KodetyFigmaRestSceneFormat;
  roots: Record<string, unknown>[];
}

export interface KodetyFigmaExportOptions {
  responsiveMode: 'pixel' | 'safe' | 'smart';
  includeRestScene: boolean;
}

export interface KodetyFigmaProvenance {
  /** Present only when the plugin can safely expose the source file identity. */
  fileKey?: string;
  pageId: string;
  nodeIds: string[];
  sourceBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface KodetyFigmaHtmlPayloadBase {
  signature: typeof KODETY_FIGMA_SIGNATURE;
  source: 'figma-plugin';
  exportId: string;
  exportedAt: string;
  documentName: string;
  pageName: string;
  /** Self-contained fragment. It must not contain html/head/body/script tags. */
  html: string;
  /** Every selector is scoped by the plugin to this export id. */
  css: string;
  assets: KodetyFigmaAsset[];
  fonts: KodetyFigmaFont[];
  fontUsage?: KodetyFigmaFontUsage[];
  hasMissingFont?: boolean;
  variables: KodetyFigmaVariable[];
  stats: KodetyFigmaExportStats;
  warnings: string[];
}

export interface KodetyFigmaHtmlPayloadV4 extends KodetyFigmaHtmlPayloadBase {
  version: typeof KODETY_FIGMA_HTML_LEGACY_VERSION;
}

export interface KodetyFigmaHtmlPayloadV5 extends KodetyFigmaHtmlPayloadBase {
  version: typeof KODETY_FIGMA_VERSION;
  /** Converter build and source-scene dialect. Optional for tolerant v5 rollout. */
  engine?: KodetyFigmaEngine;
  /** Stable identity of the selected Figma source/document. */
  sourceId?: string;
  /** Optional, JSON-only REST-compatible scene retained for future rematerialization. */
  scene?: KodetyFigmaRestScene | null;
  /** Export intent; responsive behavior itself remains materialized in the CSS. */
  options?: KodetyFigmaExportOptions;
  /** Safe source identity and selection geometry for diagnostics/reconciliation. */
  provenance?: KodetyFigmaProvenance;
  /** Local review only; deliberately omitted from the clipboard projection. */
  preview?: { width: number; height: number; referenceDataUrl?: string };
  diagnostics?: Array<{
    nodeId: string;
    nodeName: string;
    code: string;
    severity: 'info' | 'warning';
    message: string;
  }>;
}

export type KodetyFigmaHtmlPayload = KodetyFigmaHtmlPayloadV4 | KodetyFigmaHtmlPayloadV5;

export interface KodetyFigmaLegacyPayload {
  signature: typeof KODETY_FIGMA_SIGNATURE;
  version: typeof KODETY_FIGMA_LEGACY_VERSION;
  source: 'figma-plugin';
  nodes: KodetyNode[];
  styles?: Record<string, FigmaStyleEntry>;
  tokens?: Record<string, FigmaTokenEntry>;
  components?: Record<string, FigmaComponentEntry>;
  options?: KodetyImportOptions;
}

export type KodetyFigmaPayload = KodetyFigmaLegacyPayload | KodetyFigmaHtmlPayload;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isOptionalBoundedString(value: unknown, maximum: number) {
  return value === undefined || (typeof value === 'string' && value.length <= maximum);
}

const MAX_REST_SCENE_ROOTS = 10_000;
const MAX_REST_SCENE_VALUES = 3_000_000;
const MAX_REST_SCENE_DEPTH = 160;

/** Validate the optional scene iteratively so malformed direct callers cannot overflow the stack. */
function isSafeRestSceneValue(value: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const visited = new Set<object>();
  let values = 0;
  while (stack.length) {
    const current = stack.pop()!;
    values += 1;
    if (values > MAX_REST_SCENE_VALUES || current.depth > MAX_REST_SCENE_DEPTH) return false;
    if (
      current.value === null
      || typeof current.value === 'string'
      || typeof current.value === 'boolean'
    ) continue;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (!current.value || typeof current.value !== 'object') return false;
    if (visited.has(current.value)) return false;
    visited.add(current.value);
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!isPlainObject(current.value)) return false;
    for (const [key, child] of Object.entries(current.value)) {
      if (key.length > 1024) return false;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function isKodetyFigmaEngine(value: unknown): value is KodetyFigmaEngine {
  return isPlainObject(value)
    && value.version === KODETY_FIGMA_VERSION
    && value.sceneFormat === 'JSON_REST_V1';
}

function isKodetyFigmaRestScene(value: unknown): value is KodetyFigmaRestScene {
  return isPlainObject(value)
    && value.version === 1
    && value.format === 'JSON_REST_V1'
    && Array.isArray(value.roots)
    && value.roots.length <= MAX_REST_SCENE_ROOTS
    && value.roots.every(isPlainObject)
    && isSafeRestSceneValue(value.roots);
}

function isKodetyFigmaExportOptions(value: unknown): value is KodetyFigmaExportOptions {
  return isPlainObject(value)
    && ['pixel', 'safe', 'smart'].includes(String(value.responsiveMode))
    && typeof value.includeRestScene === 'boolean';
}

function isSafeSourceIdentifier(value: unknown) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isKodetyFigmaProvenance(value: unknown): value is KodetyFigmaProvenance {
  if (!isPlainObject(value) || !isPlainObject(value.sourceBounds)) return false;
  const bounds = value.sourceBounds;
  return (
    (value.fileKey === undefined || isSafeSourceIdentifier(value.fileKey))
    && isSafeSourceIdentifier(value.pageId)
    && Array.isArray(value.nodeIds)
    && value.nodeIds.length > 0
    && value.nodeIds.length <= 10_000
    && value.nodeIds.every(isSafeSourceIdentifier)
    && new Set(value.nodeIds).size === value.nodeIds.length
    && typeof bounds.x === 'number'
    && Number.isFinite(bounds.x)
    && typeof bounds.y === 'number'
    && Number.isFinite(bounds.y)
    && isFiniteNonNegativeNumber(bounds.width)
    && isFiniteNonNegativeNumber(bounds.height)
  );
}

function isKodetyFigmaAsset(value: unknown): value is KodetyFigmaAsset {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.id)
    && typeof value.name === 'string'
    && value.name.length > 0
    && value.name.length <= 1024
    && [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/svg+xml',
      'image/webp',
      'font/woff2',
      'font/woff',
      'font/ttf',
      'font/otf',
    ].includes(String(value.mimeType))
    && (value.dataBase64 === undefined || typeof value.dataBase64 === 'string')
    && (value.text === undefined || typeof value.text === 'string')
    && (value.width === undefined || isFiniteNonNegativeNumber(value.width))
    && (value.height === undefined || isFiniteNonNegativeNumber(value.height))
  );
}

function isKodetyFigmaFont(value: unknown): value is KodetyFigmaFont {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.family === 'string'
    && value.family.trim().length > 0
    && value.family.length <= 512
    && typeof value.style === 'string'
    && value.style.length <= 256
    && typeof value.weight === 'number'
    && Number.isFinite(value.weight)
    && value.weight >= 1
    && value.weight <= 1000
    && (value.missing === undefined || typeof value.missing === 'boolean')
    && (
      value.assetId === undefined
      || (
        typeof value.assetId === 'string'
        && value.assetId.length > 0
        && value.assetId.length <= 256
        && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.assetId)
      )
    )
  );
}

function isKodetyFigmaFontUsage(value: unknown): value is KodetyFigmaFontUsage {
  if (!isKodetyFigmaFont(value) || !isPlainObject(value)) return false;
  return (
    isFiniteNonNegativeNumber(value.nodes)
    && isFiniteNonNegativeNumber(value.characters)
  );
}

function isKodetyFigmaVariable(value: unknown): value is KodetyFigmaVariable {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 512
    && typeof value.name === 'string'
    && value.name.length <= 1024
    && typeof value.cssName === 'string'
    && /^--[a-zA-Z0-9_-]{1,240}$/.test(value.cssName)
    && ['color', 'number', 'string', 'boolean'].includes(String(value.type))
    && (
      (value.type === 'color' && typeof value.value === 'string')
      || (value.type === 'number' && typeof value.value === 'number' && Number.isFinite(value.value))
      || (value.type === 'string' && typeof value.value === 'string')
      || (value.type === 'boolean' && typeof value.value === 'boolean')
    )
    && (typeof value.value !== 'string' || value.value.length <= 4000)
    && (
      value.tokenId === undefined
      || (
        typeof value.tokenId === 'string'
        && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value.tokenId)
      )
    )
    && isOptionalBoundedString(value.collectionId, 512)
    && isOptionalBoundedString(value.collectionName, 1024)
    && isOptionalBoundedString(value.modeId, 512)
    && isOptionalBoundedString(value.modeName, 1024)
  );
}

export function isKodetyFigmaHtmlPayload(data: unknown): data is KodetyFigmaHtmlPayload {
  if (!isPlainObject(data)) return false;
  const obj = data;
  const stats = isPlainObject(obj.stats) ? obj.stats : null;
  const currentVersion = obj.version === KODETY_FIGMA_VERSION;
  return (
    obj.signature === KODETY_FIGMA_SIGNATURE &&
    (currentVersion || obj.version === KODETY_FIGMA_HTML_LEGACY_VERSION) &&
    obj.source === 'figma-plugin' &&
    typeof obj.exportId === 'string' &&
    obj.exportId.trim().length > 0 &&
    obj.exportId.length <= 512 &&
    typeof obj.exportedAt === 'string' &&
    typeof obj.documentName === 'string' &&
    typeof obj.pageName === 'string' &&
    typeof obj.html === 'string' &&
    typeof obj.css === 'string' &&
    Array.isArray(obj.assets) &&
    obj.assets.every(isKodetyFigmaAsset) &&
    Array.isArray(obj.fonts) &&
    obj.fonts.every(isKodetyFigmaFont) &&
    (
      obj.fontUsage === undefined
      || (
        Array.isArray(obj.fontUsage)
        && obj.fontUsage.every(isKodetyFigmaFontUsage)
      )
    ) &&
    (obj.hasMissingFont === undefined || typeof obj.hasMissingFont === 'boolean') &&
    Array.isArray(obj.variables) &&
    obj.variables.every(isKodetyFigmaVariable) &&
    Boolean(stats) &&
    isFiniteNonNegativeNumber(stats?.nodes) &&
    isFiniteNonNegativeNumber(stats?.assets) &&
    isFiniteNonNegativeNumber(stats?.bytes) &&
    (
      stats?.richTextSegments === undefined
      || isFiniteNonNegativeNumber(stats.richTextSegments)
    ) &&
    (
      stats?.inferredAutoLayoutNodes === undefined
      || isFiniteNonNegativeNumber(stats.inferredAutoLayoutNodes)
    ) &&
    (
      stats?.geometryInferredAutoLayoutNodes === undefined
      || isFiniteNonNegativeNumber(stats.geometryInferredAutoLayoutNodes)
    ) &&
    (
      stats?.missingFonts === undefined
      || isFiniteNonNegativeNumber(stats.missingFonts)
    ) &&
    (
      stats?.semanticNodes === undefined
      || isFiniteNonNegativeNumber(stats.semanticNodes)
    ) &&
    (
      stats?.rasterizedNodes === undefined
      || isFiniteNonNegativeNumber(stats.rasterizedNodes)
    ) &&
    (
      stats?.vectorFallbackNodes === undefined
      || isFiniteNonNegativeNumber(stats.vectorFallbackNodes)
    ) &&
    (
      stats?.imageFallbackNodes === undefined
      || isFiniteNonNegativeNumber(stats.imageFallbackNodes)
    ) &&
    (
      stats?.responsiveRules === undefined
      || isFiniteNonNegativeNumber(stats.responsiveRules)
    ) &&
    (
      stats?.restSnapshotRoots === undefined
      || isFiniteNonNegativeNumber(stats.restSnapshotRoots)
    ) &&
    (
      stats?.restSnapshotNodes === undefined
      || isFiniteNonNegativeNumber(stats.restSnapshotNodes)
    ) &&
    Array.isArray(obj.warnings) &&
    obj.warnings.every(item => typeof item === 'string') &&
    (
      !currentVersion
      || (
        (obj.engine === undefined || isKodetyFigmaEngine(obj.engine))
        && (
          obj.sourceId === undefined
          || isSafeSourceIdentifier(obj.sourceId)
        )
        && (
          obj.scene === undefined
          || obj.scene === null
          || isKodetyFigmaRestScene(obj.scene)
        )
        && (obj.options === undefined || isKodetyFigmaExportOptions(obj.options))
        && (obj.provenance === undefined || isKodetyFigmaProvenance(obj.provenance))
      )
    )
  );
}

export function isKodetyFigmaPayload(data: unknown): data is KodetyFigmaPayload {
  if (isKodetyFigmaHtmlPayload(data)) return true;
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.signature === KODETY_FIGMA_SIGNATURE &&
    obj.version === KODETY_FIGMA_LEGACY_VERSION &&
    obj.source === 'figma-plugin' &&
    Array.isArray(obj.nodes)
  );
}
