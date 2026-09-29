export const SOCIAL_IMAGE_TEMPLATE_VERSION = 1 as const;

/**
 * These limits mirror the WordPress GD renderer. Keeping them in the shared
 * document model prevents the editor from saving geometry that the server
 * would clamp or discard later.
 */
export const SOCIAL_IMAGE_MAX_CANVAS_SIDE = 2_400;
export const SOCIAL_IMAGE_MIN_ELEMENT_SIDE = 1;
export const SOCIAL_IMAGE_MAX_ELEMENT_SIDE = 2_400;
export const SOCIAL_IMAGE_MAX_ELEMENT_POSITION = 2_400;
export const SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS = 24_000_000;
export const SOCIAL_IMAGE_MAX_SHADOW_BLUR = 64;
export const SOCIAL_IMAGE_MAX_SHADOW_OFFSET = 256;
export const SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES = 200;
export const SOCIAL_IMAGE_MIN_WIDTH_PERCENT = 1;
export const SOCIAL_IMAGE_MAX_WIDTH_PERCENT = 100;
const SOCIAL_IMAGE_MAX_LIBRARY_CANDIDATES =
  SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES * 10;

/** Bundled fallback available even when a project does not ship a font file. */
export const SOCIAL_IMAGE_FONT_FAMILIES = ['Geist'] as const;
export const SOCIAL_IMAGE_FONT_WEIGHTS = [
  100,
  200,
  300,
  400,
  500,
  600,
  700,
  800,
  900,
] as const;
export const SOCIAL_IMAGE_BROWSER_FONT_FACE = 'Kodety Social Geist';
export const SOCIAL_IMAGE_BROWSER_FONT_FAMILY = `"${SOCIAL_IMAGE_BROWSER_FONT_FACE}", sans-serif`;

export type SocialImageFontFamily = string;
export type SocialImageFontWeight = typeof SOCIAL_IMAGE_FONT_WEIGHTS[number];

export const SOCIAL_IMAGE_DIMENSION_PRESETS = [
  { id: 'open-graph', label: 'Open Graph · 1200 × 630', width: 1200, height: 630 },
  { id: 'square', label: 'Quadrado · 1080 × 1080', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Retrato · 1080 × 1350', width: 1080, height: 1350 },
  { id: 'x-card', label: 'Twitter/X · 1200 × 675', width: 1200, height: 675 },
] as const;

export const SOCIAL_IMAGE_VARIABLE_GROUPS = [
  {
    label: 'Página',
    variables: [
      { key: 'page.title', label: 'Título' },
      { key: 'page.excerpt', label: 'Resumo' },
      { key: 'page.featured_image', label: 'Imagem destacada', kind: 'image' },
      { key: 'page.url', label: 'URL' },
      { key: 'page.date', label: 'Data' },
    ],
  },
  {
    label: 'Autor',
    variables: [
      { key: 'author.name', label: 'Nome' },
      { key: 'author.avatar', label: 'Avatar', kind: 'image' },
    ],
  },
  {
    label: 'Site',
    variables: [
      { key: 'site.name', label: 'Nome' },
      { key: 'site.logo', label: 'Logo', kind: 'image' },
    ],
  },
  {
    label: 'Conteúdo',
    variables: [
      { key: 'product.price', label: 'Preço do produto' },
      { key: 'product.image', label: 'Imagem do produto', kind: 'image' },
      { key: 'category.name', label: 'Categoria' },
    ],
  },
] as const;

export type SocialImageElementType = 'text' | 'image' | 'shape' | 'icon';
export type SocialImageTextAlign = 'left' | 'center' | 'right';
export type SocialImageVerticalAlign = 'top' | 'middle' | 'bottom';
export type SocialImageWidthUnit = 'px' | 'percent';
export type SocialImageHorizontalAnchor = 'left' | 'center' | 'right';
export type SocialImageVerticalAnchor = 'top' | 'center' | 'bottom';
export type SocialImageObjectFit = 'cover' | 'contain' | 'fill';
export type SocialImageShapeKind = 'rectangle' | 'ellipse' | 'line';
export type SocialImageIconName = 'sparkles' | 'star' | 'heart' | 'arrow-up-right' | 'check' | 'play';
export type SocialImageStackDirection = 'horizontal' | 'vertical';
export type SocialImageStackAlignment = 'start' | 'center' | 'end';

export interface SocialImageGradient {
  enabled: boolean;
  angle: number;
  from: string;
  to: string;
}

export interface SocialImageBackground {
  color: string;
  gradient: SocialImageGradient;
  image: string;
  imageAttachmentId?: number;
  imageFit: SocialImageObjectFit;
  imageOpacity: number;
}

export interface SocialImageBorder {
  color: string;
  width: number;
  radius: number;
}

export interface SocialImageShadow {
  enabled: boolean;
  color: string;
  opacity: number;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface SocialImageElementBase {
  id: string;
  type: SocialImageElementType;
  name: string;
  x: number;
  y: number;
  /**
   * `x`/`y` are offsets from these anchors. Left/top are insets from the
   * leading canvas edges, right/bottom are positive insets from the trailing
   * edges, and center offsets are signed from the canvas center.
   */
  horizontalAnchor: SocialImageHorizontalAnchor;
  verticalAnchor: SocialImageVerticalAnchor;
  /** `width` is expressed in this unit. Legacy documents default to pixels. */
  widthUnit: SocialImageWidthUnit;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  groupId?: string;
  border: SocialImageBorder;
  shadow: SocialImageShadow;
}

export interface SocialImageTextElement extends SocialImageElementBase {
  type: 'text';
  text: string;
  color: string;
  fontFamily: SocialImageFontFamily;
  /** Portable local TTF/OTF used by both browser preview and PHP/GD. */
  fontFile?: string;
  /** Actual weight encoded by `fontFile`, independent from the requested weight. */
  fontFileWeight?: SocialImageFontWeight;
  fontSize: number;
  fontWeight: SocialImageFontWeight;
  lineHeight: number;
  letterSpacing: number;
  align: SocialImageTextAlign;
  verticalAlign: SocialImageVerticalAlign;
  /** Fit content vertically while preserving `verticalAnchor`. */
  autoHeight: boolean;
  /** Legacy templates may contain this key; normalization disables it. */
  italic: boolean;
}

export interface SocialImageImageElement extends SocialImageElementBase {
  type: 'image';
  source: string;
  attachmentId?: number;
  fit: SocialImageObjectFit;
  focalX: number;
  focalY: number;
}

export interface SocialImageShapeElement extends SocialImageElementBase {
  type: 'shape';
  shape: SocialImageShapeKind;
  fill: string;
}

export interface SocialImageIconElement extends SocialImageElementBase {
  type: 'icon';
  icon: SocialImageIconName;
  color: string;
  strokeWidth: number;
}

export type SocialImageElement =
  | SocialImageTextElement
  | SocialImageImageElement
  | SocialImageShapeElement
  | SocialImageIconElement;

export interface SocialImageStack {
  /** Also used as the atomic selection group ID in the editor. */
  id: string;
  /** Stable visual order, independent from z-index/layer order. */
  elementIds: string[];
  direction: SocialImageStackDirection;
  gap: number;
  /** Cross-axis alignment inside the original selection bounds. */
  align: SocialImageStackAlignment;
  /**
   * Main-axis point preserved when dynamic text changes size. Center is the
   * design-tool default: a growing description expands the complete block in
   * both directions, so the title above it moves up naturally.
   */
  anchor: SocialImageStackAlignment;
}

export interface SocialImageTemplate {
  version: typeof SOCIAL_IMAGE_TEMPLATE_VERSION;
  id: string;
  name: string;
  width: number;
  height: number;
  background: SocialImageBackground;
  elements: SocialImageElement[];
  stacks: SocialImageStack[];
}

export interface SocialImageVariableOption {
  key: string;
  label: string;
  kind?: string;
  group?: string;
}

const DEFAULT_BORDER: SocialImageBorder = {
  color: '#FFFFFF',
  width: 0,
  radius: 0,
};

const DEFAULT_SHADOW: SocialImageShadow = {
  enabled: false,
  color: '#000000',
  opacity: 0.3,
  blur: 24,
  offsetX: 0,
  offsetY: 12,
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value);
  const resolved = Number.isFinite(number) ? number : fallback;
  return Math.max(min, Math.min(max, resolved));
}

function cleanString(value: unknown, fallback = '', max = 4_000) {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function cleanTemplateId(value: unknown) {
  return cleanString(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

const RESERVED_TEMPLATE_IDS = new Set(['__none__', '__inherit__']);

function usableTemplateId(value: unknown) {
  const id = cleanTemplateId(value);
  return RESERVED_TEMPLATE_IDS.has(id) ? '' : id;
}

export function normalizeSocialImageTemplateId(value: unknown) {
  return usableTemplateId(value);
}

function stableTemplateHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function createSocialImageTemplateId(prefix = 'social-template') {
  const safePrefix = usableTemplateId(prefix) || 'social-template';
  return `${safePrefix}-${globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
}

function normalizeAttachmentId(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  const id = Math.abs(Math.trunc(number));
  return id > 0 && Number.isSafeInteger(id) ? id : undefined;
}

export function normalizeSocialImageFontFamily(value: unknown): SocialImageFontFamily {
  const family = cleanString(value, 'Geist', 160)
    .replace(/[\u0000-\u001F\u007F{};]/g, '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return family || 'Geist';
}

export function normalizeSocialImageFontFile(value: unknown) {
  const path = cleanString(value, '', 1_024)
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path).replaceAll('\\', '/');
  } catch {
    // Keep the authored path for the normal validation below. A malformed
    // escape sequence cannot gain special filesystem meaning in PHP either.
  }
  if (
    !path
    || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(decodedPath)
    || /(?:^|\/)\.\.(?:\/|$)/.test(decodedPath)
    || decodedPath.split('/').some(segment => segment.toLowerCase() === '.incode')
    || !/\.(?:ttf|otf)$/i.test(path)
  ) return '';
  return path;
}

const SOCIAL_IMAGE_FONT_WEIGHT_KEYWORDS: Record<string, SocialImageFontWeight> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  roman: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

export function normalizeSocialImageFontWeight(value: unknown): SocialImageFontWeight {
  const normalizedKeyword = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s_-]+/g, '')
    : '';
  const keywordWeight = SOCIAL_IMAGE_FONT_WEIGHT_KEYWORDS[normalizedKeyword];
  const candidate = keywordWeight
    ?? (typeof value === 'number' ? value : Number(value));
  const weight = Number.isFinite(candidate) ? candidate : 600;
  return (
    Math.round(Math.max(100, Math.min(900, weight)) / 100) * 100
  ) as SocialImageFontWeight;
}

export function inferSocialImageFontFileWeight(value: unknown): SocialImageFontWeight | undefined {
  const file = cleanString(value)
    .replaceAll('\\', '/')
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .toLowerCase() || '';
  const numeric = file.match(/(?:^|[^0-9])([1-9]00)(?=[^0-9]|$)/);
  if (numeric) return normalizeSocialImageFontWeight(numeric[1]);
  const compact = file.replace(/[\s_-]+/g, '');
  const orderedKeywords: Array<[RegExp, SocialImageFontWeight]> = [
    [/(?:thin|hairline)/, 100],
    [/(?:extralight|ultralight)/, 200],
    [/light/, 300],
    [/(?:book|regular|normal|roman)/, 400],
    [/medium/, 500],
    [/(?:semibold|demibold)/, 600],
    [/(?:extrabold|ultrabold)/, 800],
    [/(?:black|heavy)/, 900],
    [/bold/, 700],
  ];
  return orderedKeywords.find(([pattern]) => pattern.test(compact))?.[1];
}

export function normalizeSocialImageColor(value: unknown, fallback = '#000000') {
  const candidate = cleanString(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(candidate)) {
    return `#${candidate.slice(1).split('').map(character => character.repeat(2)).join('')}`.toUpperCase();
  }
  return fallback;
}

function elementId(value: unknown, index: number, seen: Set<string>) {
  const preferred = cleanString(value, '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96);
  const base = preferred || `social-element-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (seen.has(id)) id = `${base}-${suffix++}`;
  seen.add(id);
  return id;
}

export interface SocialImageElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function socialImageElementWidthPixels(
  element: Pick<SocialImageElementBase, 'width' | 'widthUnit'>,
  canvasWidth: number,
) {
  const safeCanvasWidth = clamp(
    canvasWidth,
    320,
    SOCIAL_IMAGE_MAX_CANVAS_SIDE,
    1_200,
  );
  const pixels = element.widthUnit === 'percent'
    ? safeCanvasWidth * clamp(
      element.width,
      SOCIAL_IMAGE_MIN_WIDTH_PERCENT,
      SOCIAL_IMAGE_MAX_WIDTH_PERCENT,
      50,
    ) / 100
    : clamp(
      element.width,
      SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
      SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
      SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
    );
  return Math.round(Math.max(
    SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
    Math.min(SOCIAL_IMAGE_MAX_ELEMENT_SIDE, pixels),
  ));
}

/**
 * Resolve the stored anchor offsets into the top-left pixel rectangle used by
 * renderers and selection geometry.
 */
export function socialImageElementRect(
  element: Pick<
    SocialImageElementBase,
    'x' | 'y' | 'width' | 'widthUnit' | 'height' | 'horizontalAnchor' | 'verticalAnchor'
  >,
  canvasWidth: number,
  canvasHeight: number,
  heightOverride?: number,
): SocialImageElementRect {
  const width = socialImageElementWidthPixels(element, canvasWidth);
  const height = Math.round(clamp(
    heightOverride,
    SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
    SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
    element.height,
  ));
  const x = element.horizontalAnchor === 'center'
    ? canvasWidth / 2 + element.x - width / 2
    : element.horizontalAnchor === 'right'
      ? canvasWidth - element.x - width
      : element.x;
  const y = element.verticalAnchor === 'center'
    ? canvasHeight / 2 + element.y - height / 2
    : element.verticalAnchor === 'bottom'
      ? canvasHeight - element.y - height
      : element.y;
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/**
 * Convert a visual pixel rectangle back to the element's stored anchor
 * offsets and width unit. This keeps drag/resize math independent from the
 * chosen pin.
 */
export function socialImageElementWithRect<T extends SocialImageElement>(
  element: T,
  rect: SocialImageElementRect,
  canvasWidth: number,
  canvasHeight: number,
): T {
  const requestedWidth = clamp(
    rect.width,
    SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
    SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
    SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
  );
  const safeWidth = element.widthUnit === 'percent'
    ? Math.min(Math.max(1, canvasWidth), requestedWidth)
    : requestedWidth;
  const width = element.widthUnit === 'percent'
    ? clamp(
      safeWidth / Math.max(1, canvasWidth) * 100,
      SOCIAL_IMAGE_MIN_WIDTH_PERCENT,
      SOCIAL_IMAGE_MAX_WIDTH_PERCENT,
      SOCIAL_IMAGE_MIN_WIDTH_PERCENT,
    )
    : safeWidth;
  const x = element.horizontalAnchor === 'center'
    ? rect.x + safeWidth / 2 - canvasWidth / 2
    : element.horizontalAnchor === 'right'
      ? canvasWidth - rect.x - safeWidth
      : rect.x;
  const safeHeight = clamp(
    rect.height,
    SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
    SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
    SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
  );
  const y = element.verticalAnchor === 'center'
    ? rect.y + safeHeight / 2 - canvasHeight / 2
    : element.verticalAnchor === 'bottom'
      ? canvasHeight - rect.y - safeHeight
      : rect.y;
  return {
    ...element,
    x: clamp(
      x,
      -SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      element.x,
    ),
    y: clamp(
      y,
      -SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      element.y,
    ),
    width,
    height: safeHeight,
  };
}

function socialImageRectUnion(rects: SocialImageElementRect[]) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map(rect => rect.x));
  const y = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

/**
 * Resolves persistent Stack constraints into absolute child rectangles.
 *
 * Stored element rectangles are the baseline frame/anchor. Runtime heights
 * may come from browser measurement or PHP text wrapping; the stack preserves
 * its configured main-axis anchor while reflowing every visible child.
 */
export function socialImageStackRects(
  template: Pick<SocialImageTemplate, 'width' | 'height' | 'elements' | 'stacks'>,
  heightOverrides?: ReadonlyMap<string, number>,
) {
  const result = new Map<string, SocialImageElementRect>();
  const elements = new Map(template.elements.map(element => [element.id, element]));
  const claimed = new Set<string>();

  template.stacks.forEach(stack => {
    const members = stack.elementIds
      .map(id => elements.get(id))
      .filter((element): element is SocialImageElement => Boolean(
        element
        && element.visible
        && !claimed.has(element.id),
      ));
    if (!members.length) return;
    const baselineRects = members.map(element =>
      socialImageElementRect(element, template.width, template.height));
    const baselineBounds = socialImageRectUnion(baselineRects);
    if (!baselineBounds) return;
    const actualRects = members.map(element =>
      socialImageElementRect(
        element,
        template.width,
        template.height,
        element.type === 'text' && element.autoHeight
          ? heightOverrides?.get(element.id)
          : undefined,
      ));
    const vertical = stack.direction === 'vertical';
    const totalMainSize = actualRects.reduce(
      (sum, rect) => sum + (vertical ? rect.height : rect.width),
      0,
    ) + Math.max(0, members.length - 1) * stack.gap;
    const baselineStart = vertical ? baselineBounds.y : baselineBounds.x;
    const baselineSize = vertical ? baselineBounds.height : baselineBounds.width;
    const anchorPoint = stack.anchor === 'start'
      ? baselineStart
      : stack.anchor === 'end'
        ? baselineStart + baselineSize
        : baselineStart + baselineSize / 2;
    let cursor = stack.anchor === 'start'
      ? anchorPoint
      : stack.anchor === 'end'
        ? anchorPoint - totalMainSize
        : anchorPoint - totalMainSize / 2;

    members.forEach((element, index) => {
      const actual = actualRects[index];
      const crossStart = vertical ? baselineBounds.x : baselineBounds.y;
      const crossSize = vertical ? baselineBounds.width : baselineBounds.height;
      const elementCrossSize = vertical ? actual.width : actual.height;
      const cross = stack.align === 'start'
        ? crossStart
        : stack.align === 'end'
          ? crossStart + crossSize - elementCrossSize
          : crossStart + (crossSize - elementCrossSize) / 2;
      const rect = vertical
        ? { ...actual, x: Math.round(cross), y: Math.round(cursor) }
        : { ...actual, x: Math.round(cursor), y: Math.round(cross) };
      result.set(element.id, rect);
      claimed.add(element.id);
      cursor += (vertical ? actual.height : actual.width) + stack.gap;
    });
  });
  return result;
}

/**
 * Writes the currently resolved Stack rectangles back to the flat layer model.
 * Used before saving or removing a stack so the visual composition never
 * jumps when constraints are materialized.
 */
export function materializeSocialImageStacks(
  template: SocialImageTemplate,
  heightOverrides?: ReadonlyMap<string, number>,
): SocialImageTemplate {
  const rects = socialImageStackRects(template, heightOverrides);
  if (!rects.size) return template;
  return {
    ...template,
    elements: template.elements.map(element => {
      const rect = rects.get(element.id);
      if (!rect) return element;
      const materialized = socialImageElementWithRect(
        element,
        rect,
        template.width,
        template.height,
      );
      return element.type === 'text' && element.autoHeight
        ? { ...materialized, autoHeight: true }
        : materialized;
    }),
  };
}

export function reanchorSocialImageElement<T extends SocialImageElement>(
  element: T,
  horizontalAnchor: SocialImageHorizontalAnchor,
  verticalAnchor: SocialImageVerticalAnchor,
  canvasWidth: number,
  canvasHeight: number,
  heightOverride?: number,
): T {
  const rect = socialImageElementRect(
    element,
    canvasWidth,
    canvasHeight,
    heightOverride,
  );
  return socialImageElementWithRect(
    { ...element, horizontalAnchor, verticalAnchor },
    rect,
    canvasWidth,
    canvasHeight,
  );
}

export function convertSocialImageElementWidthUnit<T extends SocialImageElement>(
  element: T,
  widthUnit: SocialImageWidthUnit,
  canvasWidth: number,
): T {
  if (element.widthUnit === widthUnit) return element;
  const resolvedWidth = socialImageElementWidthPixels(element, canvasWidth);
  return {
    ...element,
    widthUnit,
    width: widthUnit === 'percent'
      ? clamp(
        resolvedWidth / Math.max(1, canvasWidth) * 100,
        SOCIAL_IMAGE_MIN_WIDTH_PERCENT,
        SOCIAL_IMAGE_MAX_WIDTH_PERCENT,
        SOCIAL_IMAGE_MIN_WIDTH_PERCENT,
      )
      : resolvedWidth,
  };
}

/** Maximum fit-content height that can grow from the selected vertical pin
 * without crossing the opposite canvas edge. */
export function socialImageAutoHeightLimit(
  element: Pick<SocialImageElementBase, 'y' | 'verticalAnchor'>,
  canvasHeight: number,
) {
  const anchorLine = element.verticalAnchor === 'center'
    ? canvasHeight / 2 + element.y
    : element.verticalAnchor === 'bottom'
      ? canvasHeight - element.y
      : element.y;
  const available = element.verticalAnchor === 'center'
    ? 2 * Math.min(anchorLine, canvasHeight - anchorLine)
    : element.verticalAnchor === 'bottom'
      ? anchorLine
      : canvasHeight - anchorLine;
  return Math.max(
    SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
    Math.min(SOCIAL_IMAGE_MAX_ELEMENT_SIDE, available),
  );
}

function normalizeBorder(value: unknown): SocialImageBorder {
  const candidate = value && typeof value === 'object' ? value as Partial<SocialImageBorder> : {};
  return {
    color: normalizeSocialImageColor(candidate.color, DEFAULT_BORDER.color),
    width: clamp(candidate.width, 0, 40, DEFAULT_BORDER.width),
    radius: clamp(candidate.radius, 0, 600, DEFAULT_BORDER.radius),
  };
}

function normalizeShadow(value: unknown): SocialImageShadow {
  const candidate = value && typeof value === 'object' ? value as Partial<SocialImageShadow> : {};
  return {
    enabled: candidate.enabled === true,
    color: normalizeSocialImageColor(candidate.color, DEFAULT_SHADOW.color),
    opacity: clamp(candidate.opacity, 0, 1, DEFAULT_SHADOW.opacity),
    blur: Math.round(clamp(candidate.blur, 0, SOCIAL_IMAGE_MAX_SHADOW_BLUR, DEFAULT_SHADOW.blur)),
    offsetX: clamp(
      candidate.offsetX,
      -SOCIAL_IMAGE_MAX_SHADOW_OFFSET,
      SOCIAL_IMAGE_MAX_SHADOW_OFFSET,
      DEFAULT_SHADOW.offsetX,
    ),
    offsetY: clamp(
      candidate.offsetY,
      -SOCIAL_IMAGE_MAX_SHADOW_OFFSET,
      SOCIAL_IMAGE_MAX_SHADOW_OFFSET,
      DEFAULT_SHADOW.offsetY,
    ),
  };
}

function normalizeElement(
  value: unknown,
  index: number,
  width: number,
  height: number,
  seen: Set<string>,
): SocialImageElement | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SocialImageElement>;
  const rawType = candidate.type;
  if (!['text', 'image', 'shape', 'icon'].includes(rawType || '')) return null;
  const type = rawType as SocialImageElementType;
  const widthUnit: SocialImageWidthUnit = candidate.widthUnit === 'percent'
    ? 'percent'
    : 'px';
  const base = {
    id: elementId(candidate.id, index, seen),
    type,
    name: cleanString(candidate.name, type === 'text' ? 'Texto' : type === 'image' ? 'Imagem' : type === 'shape' ? 'Forma' : 'Ícone', 160),
    x: clamp(
      candidate.x,
      -SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      80 + index * 12,
    ),
    y: clamp(
      candidate.y,
      -SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
      80 + index * 12,
    ),
    horizontalAnchor: ['left', 'center', 'right'].includes(candidate.horizontalAnchor || '')
      ? candidate.horizontalAnchor as SocialImageHorizontalAnchor
      : 'left',
    verticalAnchor: ['top', 'center', 'bottom'].includes(candidate.verticalAnchor || '')
      ? candidate.verticalAnchor as SocialImageVerticalAnchor
      : 'top',
    widthUnit,
    width: widthUnit === 'percent'
      ? Math.round(clamp(
        candidate.width,
        SOCIAL_IMAGE_MIN_WIDTH_PERCENT,
        SOCIAL_IMAGE_MAX_WIDTH_PERCENT,
        type === 'text' ? 46.67 : 20,
      ) * 100) / 100
      : Math.round(clamp(
      candidate.width,
      SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
      SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
      type === 'text' ? 560 : 240,
      )),
    height: Math.round(clamp(
      candidate.height,
      SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
      SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
      type === 'text' ? 140 : 240,
    )),
    rotation: clamp(candidate.rotation, -360, 360, 0),
    opacity: clamp(candidate.opacity, 0, 1, 1),
    visible: candidate.visible !== false,
    locked: candidate.locked === true,
    ...(cleanString(candidate.groupId).trim() ? { groupId: cleanString(candidate.groupId).trim().slice(0, 96) } : {}),
    border: normalizeBorder(candidate.border),
    shadow: normalizeShadow(candidate.shadow),
  } satisfies SocialImageElementBase;

  if (type === 'text') {
    const text = candidate as Partial<SocialImageTextElement>;
    const autoHeight = text.autoHeight === true;
    const fontFile = normalizeSocialImageFontFile(text.fontFile);
    const requestedFontFamily = normalizeSocialImageFontFamily(text.fontFamily);
    const fontFamily = fontFile || requestedFontFamily === 'Geist'
      ? requestedFontFamily
      : 'Geist';
    const fontWeight = normalizeSocialImageFontWeight(text.fontWeight);
    const authoredFontFileWeight = text.fontFileWeight !== undefined
      && text.fontFileWeight !== null
      ? normalizeSocialImageFontWeight(text.fontFileWeight)
      : undefined;
    const fontFileWeight = fontFile
      ? authoredFontFileWeight ?? inferSocialImageFontFileWeight(fontFile)
      : undefined;
    return {
      ...base,
      type,
      height: autoHeight
        ? Math.min(base.height, socialImageAutoHeightLimit(base, height))
        : base.height,
      text: cleanString(text.text, 'Novo texto'),
      color: normalizeSocialImageColor(text.color, '#FFFFFF'),
      fontFamily,
      ...(fontFile ? { fontFile } : {}),
      ...(fontFileWeight ? { fontFileWeight } : {}),
      fontSize: clamp(text.fontSize, 8, 400, 64),
      fontWeight,
      lineHeight: clamp(text.lineHeight, 0.7, 3, 1.05),
      letterSpacing: clamp(text.letterSpacing, -20, 100, 0),
      align: ['left', 'center', 'right'].includes(text.align || '') ? text.align as SocialImageTextAlign : 'left',
      verticalAlign: ['top', 'middle', 'bottom'].includes(text.verticalAlign || '') ? text.verticalAlign as SocialImageVerticalAlign : 'top',
      autoHeight,
      italic: false,
    };
  }

  if (type === 'image') {
    const image = candidate as Partial<SocialImageImageElement>;
    const source = cleanString(image.source);
    const attachmentId = normalizeAttachmentId(image.attachmentId);
    return {
      ...base,
      type,
      source,
      ...(attachmentId && !source.includes('{{') ? { attachmentId } : {}),
      fit: ['cover', 'contain', 'fill'].includes(image.fit || '') ? image.fit as SocialImageObjectFit : 'cover',
      focalX: clamp(image.focalX, 0, 100, 50),
      focalY: clamp(image.focalY, 0, 100, 50),
    };
  }

  if (type === 'shape') {
    const shape = candidate as Partial<SocialImageShapeElement>;
    return {
      ...base,
      type,
      shape: ['rectangle', 'ellipse', 'line'].includes(shape.shape || '') ? shape.shape as SocialImageShapeKind : 'rectangle',
      fill: normalizeSocialImageColor(shape.fill, '#2997FF'),
    };
  }

  const icon = candidate as Partial<SocialImageIconElement>;
  return {
    ...base,
    type: 'icon',
    icon: ['sparkles', 'star', 'heart', 'arrow-up-right', 'check', 'play'].includes(icon.icon || '')
      ? icon.icon as SocialImageIconName
      : 'sparkles',
    color: normalizeSocialImageColor(icon.color, '#FFFFFF'),
    strokeWidth: clamp(icon.strokeWidth, 1, 8, 2),
  };
}

export function normalizeSocialImageTemplate(value: unknown): SocialImageTemplate {
  const candidate = value && typeof value === 'object' ? value as Partial<SocialImageTemplate> : {};
  const width = Math.round(clamp(candidate.width, 320, SOCIAL_IMAGE_MAX_CANVAS_SIDE, 1_200));
  const height = Math.round(clamp(candidate.height, 320, SOCIAL_IMAGE_MAX_CANVAS_SIDE, 630));
  const rawBackground = candidate.background && typeof candidate.background === 'object'
    ? candidate.background as Partial<SocialImageBackground>
    : {};
  const rawGradient = rawBackground.gradient && typeof rawBackground.gradient === 'object'
    ? rawBackground.gradient as Partial<SocialImageGradient>
    : {};
  const backgroundImage = cleanString(rawBackground.image);
  const backgroundAttachmentId = normalizeAttachmentId(rawBackground.imageAttachmentId);
  const seen = new Set<string>();
  let remainingLayerPixels = SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS;
  const elements: SocialImageElement[] = [];
  (Array.isArray(candidate.elements) ? candidate.elements : [])
    .slice(0, 100)
    .forEach((element, index) => {
      const normalized = normalizeElement(element, index, width, height, seen);
      if (!normalized) return;
      const budgetHeight = normalized.type === 'text' && normalized.autoHeight
        ? socialImageAutoHeightLimit(normalized, height)
        : normalized.height;
      const pixels = Math.round(
        socialImageElementWidthPixels(normalized, width),
      ) * Math.round(budgetHeight);
      if (pixels > remainingLayerPixels) return;
      remainingLayerPixels -= pixels;
      elements.push(normalized);
    });
  const validElementIds = new Set(elements.map(element => element.id));
  const claimedElementIds = new Set<string>();
  const seenStackIds = new Set<string>();
  const stacks: SocialImageStack[] = [];
  (Array.isArray(candidate.stacks) ? candidate.stacks : [])
    .slice(0, 50)
    .forEach((value, index) => {
      if (!value || typeof value !== 'object') return;
      const raw = value as Partial<SocialImageStack>;
      const elementIds = Array.from(new Set(
        (Array.isArray(raw.elementIds) ? raw.elementIds : [])
          .map(id => cleanString(id).trim())
          .filter(id => validElementIds.has(id) && !claimedElementIds.has(id)),
      ));
      if (elementIds.length < 2) return;
      const preferredId = cleanString(raw.id).trim().slice(0, 96);
      let id = preferredId || `stack-${index + 1}`;
      let suffix = 2;
      while (seenStackIds.has(id)) {
        id = `${preferredId || `stack-${index + 1}`}-${suffix}`;
        suffix += 1;
      }
      seenStackIds.add(id);
      elementIds.forEach(elementId => claimedElementIds.add(elementId));
      stacks.push({
        id,
        elementIds,
        direction: raw.direction === 'horizontal' ? 'horizontal' : 'vertical',
        gap: Math.round(clamp(
          raw.gap,
          0,
          SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
          24,
        ) * 100) / 100,
        align: ['start', 'center', 'end'].includes(raw.align || '')
          ? raw.align as SocialImageStackAlignment
          : 'start',
        anchor: ['start', 'center', 'end'].includes(raw.anchor || '')
          ? raw.anchor as SocialImageStackAlignment
          : 'center',
      });
    });
  const stackIdForElement = new Map(
    stacks.flatMap(stack => stack.elementIds.map(elementId => [elementId, stack.id] as const)),
  );
  const normalizedElements = elements.map(element => {
    const stackId = stackIdForElement.get(element.id);
    return stackId && element.groupId !== stackId
      ? { ...element, groupId: stackId }
      : element;
  });
  const normalized = {
    version: SOCIAL_IMAGE_TEMPLATE_VERSION,
    name: cleanString(candidate.name, 'Social Image', 160),
    width,
    height,
    background: {
      color: normalizeSocialImageColor(rawBackground.color, '#0B1020'),
      gradient: {
        enabled: rawGradient.enabled === true,
        angle: clamp(rawGradient.angle, -360, 360, 135),
        from: normalizeSocialImageColor(rawGradient.from, '#0B1020'),
        to: normalizeSocialImageColor(rawGradient.to, '#172A46'),
      },
      image: backgroundImage,
      ...(backgroundAttachmentId && !backgroundImage.includes('{{')
        ? { imageAttachmentId: backgroundAttachmentId }
        : {}),
      imageFit: ['cover', 'contain', 'fill'].includes(rawBackground.imageFit || '')
        ? rawBackground.imageFit as SocialImageObjectFit
        : 'cover',
      imageOpacity: clamp(rawBackground.imageOpacity, 0, 1, 1),
    },
    elements: normalizedElements,
    stacks,
  };
  const preferredId = usableTemplateId(candidate.id);
  return {
    version: SOCIAL_IMAGE_TEMPLATE_VERSION,
    id: preferredId || `social-template-${stableTemplateHash(JSON.stringify(normalized))}`,
    name: normalized.name,
    width: normalized.width,
    height: normalized.height,
    background: normalized.background,
    elements: normalized.elements,
    stacks: normalized.stacks,
  };
}

export interface SocialImageLayerPixelBudget {
  limit: number;
  used: number;
  requested: number;
  overflow: number;
  rejectedElementIds: string[];
}

/**
 * Reports the same cumulative pixel accounting used by the server. The editor
 * can use this before normalization to explain why a layer would be omitted.
 */
export function socialImageLayerPixelBudget(
  elements: readonly Pick<
    SocialImageElementBase,
    'id' | 'type' | 'width' | 'widthUnit' | 'height' | 'y' | 'verticalAnchor'
  >[],
  canvasWidth = SOCIAL_IMAGE_MAX_CANVAS_SIDE,
  canvasHeight = SOCIAL_IMAGE_MAX_CANVAS_SIDE,
): SocialImageLayerPixelBudget {
  let used = 0;
  let requested = 0;
  const rejectedElementIds: string[] = [];
  elements.slice(0, 100).forEach(element => {
    const width = Math.round(socialImageElementWidthPixels(element, canvasWidth));
    const autoHeight = element.type === 'text'
      && (element as Partial<SocialImageTextElement>).autoHeight === true;
    const height = Math.round(autoHeight
      ? socialImageAutoHeightLimit(element, canvasHeight)
      : clamp(
        element.height,
        SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
        SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
        SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
      ));
    const pixels = width * height;
    requested += pixels;
    if (used + pixels > SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS) {
      rejectedElementIds.push(element.id);
      return;
    }
    used += pixels;
  });
  return {
    limit: SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS,
    used,
    requested,
    overflow: Math.max(0, requested - SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS),
    rejectedElementIds,
  };
}

function newElementId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
}

function socialImageColorLuminance(value: string) {
  const normalized = normalizeSocialImageColor(value, '#0B1020');
  const channels = [1, 3, 5].map(index => Number.parseInt(
    normalized.slice(index, index + 2),
    16,
  ) / 255);
  const linear = channels.map(channel =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function socialImageTextColorForBackground(
  background: SocialImageBackground | undefined,
) {
  const colors = background?.gradient.enabled
    ? [background.gradient.from, background.gradient.to]
    : [background?.color || '#0B1020'];
  const luminance = colors.reduce(
    (total, color) => total + socialImageColorLuminance(color),
    0,
  ) / colors.length;
  return luminance > 0.179 ? '#000000' : '#FFFFFF';
}

export function createSocialImageElement(
  type: SocialImageElementType,
  template: Pick<SocialImageTemplate, 'width' | 'height'>
    & Partial<Pick<SocialImageTemplate, 'background'>>,
): SocialImageElement {
  const size = Math.min(template.width, template.height);
  const base: SocialImageElementBase = {
    id: newElementId(type),
    type,
    name: type === 'text' ? 'Texto' : type === 'image' ? 'Imagem' : type === 'shape' ? 'Forma' : 'Ícone',
    x: Math.round((template.width - Math.min(520, template.width * 0.6)) / 2),
    y: Math.round((template.height - Math.min(180, template.height * 0.28)) / 2),
    horizontalAnchor: 'left',
    verticalAnchor: 'top',
    widthUnit: 'px',
    width: Math.min(520, template.width * 0.6),
    height: Math.min(180, template.height * 0.28),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    border: { ...DEFAULT_BORDER },
    shadow: { ...DEFAULT_SHADOW },
  };
  if (type === 'text') {
    return {
      ...base,
      type,
      text: 'Novo texto',
      color: socialImageTextColorForBackground(template.background),
      fontFamily: 'Geist',
      fontSize: Math.round(size * 0.08),
      fontWeight: 600,
      lineHeight: 1.05,
      letterSpacing: 0,
      align: 'left',
      verticalAlign: 'top',
      autoHeight: true,
      italic: false,
    };
  }
  if (type === 'image') {
    return {
      ...base,
      type,
      source: '{{page.featured_image}}',
      fit: 'cover',
      focalX: 50,
      focalY: 50,
      border: { ...DEFAULT_BORDER, radius: 32 },
    };
  }
  if (type === 'shape') {
    return {
      ...base,
      type,
      shape: 'rectangle',
      fill: '#2997FF',
      width: Math.round(size * 0.28),
      height: Math.round(size * 0.28),
    };
  }
  return {
    ...base,
    type: 'icon',
    icon: 'sparkles',
    color: '#FFFFFF',
    strokeWidth: 2,
    width: Math.round(size * 0.16),
    height: Math.round(size * 0.16),
  };
}

export function createDefaultSocialImageTemplate(
  name = 'Social Image',
  width = 1_200,
  height = 630,
): SocialImageTemplate {
  const template = normalizeSocialImageTemplate({
    version: 1,
    id: createSocialImageTemplateId(),
    name,
    width,
    height,
    background: {
      color: '#FFFFFF',
      gradient: { enabled: false, angle: 135, from: '#FFFFFF', to: '#FFFFFF' },
      image: '',
      imageFit: 'cover',
      imageOpacity: 1,
    },
    elements: [],
    stacks: [],
  });
  const contentWidth = Math.max(1, template.width - 144);
  const site = createSocialImageElement('text', template) as SocialImageTextElement;
  Object.assign(site, {
    name: 'Nome do site',
    x: 72,
    y: 64,
    width: contentWidth,
    height: 44,
    text: '{{site.name}}',
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: 0,
    color: '#000000',
  });
  const title = createSocialImageElement('text', template) as SocialImageTextElement;
  Object.assign(title, {
    name: 'Título',
    x: 72,
    y: Math.round(template.height * 0.28),
    width: contentWidth,
    height: Math.round(template.height * 0.38),
    text: '{{page.title}}',
    fontSize: 68,
    fontWeight: 800,
    lineHeight: 1,
    color: '#000000',
  });
  const excerpt = createSocialImageElement('text', template) as SocialImageTextElement;
  Object.assign(excerpt, {
    name: 'Resumo',
    x: 72,
    y: Math.round(template.height * 0.73),
    verticalAnchor: 'top',
    width: contentWidth,
    height: 92,
    text: '{{page.excerpt}}',
    fontSize: 24,
    fontWeight: 400,
    lineHeight: 1.25,
    color: '#000000',
  });
  return normalizeSocialImageTemplate({
    ...template,
    elements: [site, title, excerpt],
  });
}

export function duplicateSocialImageTemplate(
  value: SocialImageTemplate,
  name = `${value.name} · cópia`,
) {
  return normalizeSocialImageTemplate({
    ...value,
    id: createSocialImageTemplateId(),
    name,
    elements: value.elements.map(element => ({
      ...element,
      border: { ...element.border },
      shadow: { ...element.shadow },
    })),
    stacks: value.stacks.map(stack => ({
      ...stack,
      elementIds: [...stack.elementIds],
    })),
    background: {
      ...value.background,
      gradient: { ...value.background.gradient },
    },
  });
}

export function normalizeSocialImageTemplateLibrary(value: unknown) {
  if (!Array.isArray(value)) return [];
  const order: string[] = [];
  const templates = new Map<string, SocialImageTemplate>();
  value.slice(0, SOCIAL_IMAGE_MAX_LIBRARY_CANDIDATES).forEach(candidate => {
    if (!candidate || typeof candidate !== 'object') return;
    const authoredId = usableTemplateId(
      (candidate as Partial<SocialImageTemplate>).id,
    );
    if (
      order.length >= SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES
      && (!authoredId || !templates.has(authoredId))
    ) {
      return;
    }
    const template = normalizeSocialImageTemplate(candidate);
    if (!templates.has(template.id)) {
      if (order.length >= SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES) return;
      order.push(template.id);
    }
    templates.set(template.id, template);
  });
  return order.map(id => templates.get(id)!);
}

export function upsertSocialImageTemplateLibrary(
  library: readonly SocialImageTemplate[],
  value: SocialImageTemplate,
) {
  const template = normalizeSocialImageTemplate(value);
  const normalized = normalizeSocialImageTemplateLibrary(library);
  const index = normalized.findIndex(candidate => candidate.id === template.id);
  if (index < 0) {
    return normalized.length < SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES
      ? [...normalized, template]
      : normalized;
  }
  return normalized.map((candidate, candidateIndex) =>
    candidateIndex === index ? template : candidate);
}

/** Browser object URLs only live for the document that created them. They may
 * be used by a preview, but must never enter project metadata or public HTML. */
export function persistableMediaUrl(value: unknown): string {
  const source = typeof value === 'string' ? value.trim() : '';
  return /^blob:/i.test(source) ? '' : source;
}

/** Remove transient preview URLs without normalizing any other template data. */
export function sanitizeSocialImageTemplateMediaUrls(
  template: SocialImageTemplate,
): SocialImageTemplate {
  if (!template || typeof template !== 'object') return template;
  const background = template.background && typeof template.background === 'object'
    && /^blob:/i.test(typeof template.background.image === 'string' ? template.background.image.trim() : '')
    ? { ...template.background, image: '' }
    : template.background;
  const elements = Array.isArray(template.elements)
    ? template.elements.map(element => {
      if (!element || typeof element !== 'object') return element;
      if (
        element.type === 'image'
        && /^blob:/i.test(typeof element.source === 'string' ? element.source.trim() : '')
      ) return { ...element, source: '' };
      if (
        element.type === 'text'
        && /^blob:/i.test(typeof element.fontFile === 'string' ? element.fontFile.trim() : '')
      ) return { ...element, fontFile: '' };
      return element;
    })
    : template.elements;
  return {
    ...template,
    background,
    elements,
  };
}

function canonicalProjectAssetPath(
  value: string,
  referencePath: string,
  projectRootPath: string,
) {
  const source = value.trim().replaceAll('&amp;', '&');
  if (/^blob:/i.test(source)) return '';
  if (
    !source
    || source.includes('{{')
    || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(source)
    || /^\d+$/.test(source)
  ) return value;
  const suffix = source.match(/[?#].*$/)?.[0] || '';
  let relative = source.slice(0, source.length - suffix.length);
  try { relative = decodeURIComponent(relative); } catch { /* Keep the authored encoding. */ }
  const normalizedRoot = projectRootPath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const absolutePath = relative.replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    relative.startsWith('/')
    && normalizedRoot
    && (absolutePath === normalizedRoot || absolutePath.startsWith(`${normalizedRoot}/`))
  ) {
    return `/${absolutePath}${suffix}`;
  }
  const base = relative.startsWith('/')
    ? normalizedRoot
    : referencePath.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
  const stack = base.split('/').filter(Boolean);
  relative.split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  const resolved = stack.join('/');
  return resolved ? `/${resolved}${suffix}` : value;
}

/**
 * Converts page-relative local images into project-root paths before a
 * template enters the shared library. URLs, variables and attachment IDs stay
 * untouched, so the same template can safely render on nested pages.
 */
export function canonicalizeSocialImageTemplateAssets(
  value: unknown,
  referencePath: string,
  projectRootPath = '',
) {
  const authoredId = value && typeof value === 'object'
    ? usableTemplateId((value as Partial<SocialImageTemplate>).id)
    : '';
  const template = normalizeSocialImageTemplate(value);
  return normalizeSocialImageTemplate({
    ...template,
    id: authoredId || undefined,
    background: {
      ...template.background,
      image: canonicalProjectAssetPath(
        template.background.image,
        referencePath,
        projectRootPath,
      ),
    },
    elements: template.elements.map(element => element.type === 'image'
      ? {
        ...element,
        source: canonicalProjectAssetPath(element.source, referencePath, projectRootPath),
      }
      : element),
  });
}

export function socialImageVariableToken(key: string) {
  return `{{${key}}}`;
}

const VARIABLE_ALIASES: Record<string, string[]> = {
  'page.title': ['title'],
  'page.excerpt': ['excerpt', 'description'],
  'page.featured_image': ['featured_image'],
  'page.url': ['permalink', 'url'],
  'page.date': ['date'],
  'author.name': ['author'],
  'site.name': ['site_name'],
  'product.image': ['featured_image'],
};

export function resolveSocialImageValue(
  value: string,
  variables: Record<string, unknown>,
  keepUnknown = false,
) {
  return value.replace(/\{\{([^{}]+)\}\}/g, (token, rawKey: string) => {
    const key = rawKey.trim();
    if (
      !key
      || key.split(/[.:]/).some(part => ['__proto__', 'prototype', 'constructor'].includes(part))
    ) return keepUnknown ? token : '';
    const aliases = VARIABLE_ALIASES[key] || [];
    const resolvedKey = [key, ...aliases].find(candidate =>
      Object.prototype.hasOwnProperty.call(variables, candidate)
      && variables[candidate] !== undefined
    );
    if (!resolvedKey) return keepUnknown ? token : '';
    const resolved = variables[resolvedKey];
    if (Array.isArray(resolved)) return resolved.map(String).join(', ');
    if (resolved && typeof resolved === 'object') {
      const object = resolved as Record<string, unknown>;
      return String(object.url ?? object.value ?? object.label ?? '');
    }
    return resolved === undefined || resolved === null ? '' : String(resolved);
  });
}

export function socialImageTemplateSignature(template: SocialImageTemplate | undefined) {
  return template ? JSON.stringify(normalizeSocialImageTemplate(template)) : '';
}
