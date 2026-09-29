'use client';

import { DisclosureSummary } from '@/components/ui/disclosure-summary';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type SVGProps,
} from 'react';
import ColorPicker from '@/app/(builder)/kodety/components/ColorPicker';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowsExpandHorizontal,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Group,
  Hash,
  Heart,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  MoveVertical,
  Play,
  Plus,
  Redo2,
  Save,
  Scan,
  Search,
  Sparkles,
  Square,
  Star,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useFontsStore } from '@/stores/useFontsStore';
import type { ProjectFont, ProjectFontFace } from '@/lib/html-editor/project-fonts';
import { resolveProjectPath } from '@/lib/html-editor/project-path';
import { cn } from '@/lib/utils';
import socialImageGeistUrl from '@/lib/html-editor/fonts/geist/Geist-Regular.ttf?url';
import {
  SOCIAL_IMAGE_BROWSER_FONT_FACE,
  SOCIAL_IMAGE_BROWSER_FONT_FAMILY,
  SOCIAL_IMAGE_DIMENSION_PRESETS,
  SOCIAL_IMAGE_FONT_FAMILIES,
  SOCIAL_IMAGE_FONT_WEIGHTS,
  SOCIAL_IMAGE_MAX_CANVAS_SIDE,
  SOCIAL_IMAGE_MAX_ELEMENT_POSITION,
  SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
  SOCIAL_IMAGE_MAX_WIDTH_PERCENT,
  SOCIAL_IMAGE_MIN_WIDTH_PERCENT,
  SOCIAL_IMAGE_MAX_SHADOW_BLUR,
  SOCIAL_IMAGE_MAX_SHADOW_OFFSET,
  SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS,
  SOCIAL_IMAGE_MIN_ELEMENT_SIDE,
  SOCIAL_IMAGE_VARIABLE_GROUPS,
  convertSocialImageElementWidthUnit,
  createDefaultSocialImageTemplate,
  createSocialImageElement,
  materializeSocialImageStacks,
  normalizeSocialImageColor,
  normalizeSocialImageFontFamily,
  normalizeSocialImageFontWeight,
  normalizeSocialImageTemplate,
  reanchorSocialImageElement,
  resolveSocialImageValue,
  socialImageAutoHeightLimit,
  socialImageElementRect,
  socialImageElementWidthPixels,
  socialImageElementWithRect,
  socialImageLayerPixelBudget,
  socialImageStackRects,
  socialImageTemplateSignature,
  socialImageVariableToken,
  type SocialImageElement,
  type SocialImageElementRect,
  type SocialImageElementType,
  type SocialImageFontWeight,
  type SocialImageHorizontalAnchor,
  type SocialImageIconElement,
  type SocialImageIconName,
  type SocialImageImageElement,
  type SocialImageObjectFit,
  type SocialImageShapeElement,
  type SocialImageShapeKind,
  type SocialImageStack,
  type SocialImageStackDirection,
  type SocialImageTemplate,
  type SocialImageTextAlign,
  type SocialImageTextElement,
  type SocialImageVariableOption,
  type SocialImageVerticalAlign,
  type SocialImageVerticalAnchor,
  type SocialImageWidthUnit,
} from '@/lib/html-editor/social-image';
import type { HtmlProjectFile } from '@/lib/html-editor/types';

export interface SocialImageMediaConnection {
  mediaUrl?: string;
  nonce: string;
}

export interface SocialImageAssetPreviewContext {
  projectFiles?: Record<string, HtmlProjectFile>;
  projectRootPath?: string;
  referencePath?: string;
  publicBaseUrl?: string;
}

export interface HtmlSocialImageBuilderProps {
  template?: SocialImageTemplate | null;
  title: string;
  sampleVariables: Record<string, unknown>;
  dynamicVariables?: SocialImageVariableOption[];
  media?: SocialImageMediaConnection;
  assetPreview?: SocialImageAssetPreviewContext;
  /**
   * Produces a content-addressed TTF/OTF copy for the server renderer. Project
   * WOFF2 remains the browser source; this callback only runs when the author
   * chooses that family for a generated Social Image.
   */
  onPrepareFontFile?: (fontFile: string) => Promise<string>;
  onSave: (template: SocialImageTemplate) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export interface SocialImageTemplatePreviewProps {
  template: SocialImageTemplate;
  variables?: Record<string, unknown>;
  className?: string;
  scale?: number;
  assetPreview?: SocialImageAssetPreviewContext;
}

interface WordPressMediaItem {
  id: number;
  source_url: string;
  alt_text?: string;
  title?: { rendered?: string };
  media_details?: {
    sizes?: Record<string, { source_url?: string }>;
  };
}

interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionUnit {
  key: string;
  elements: SocialImageElement[];
  bounds: SelectionBounds | null;
  locked: boolean;
}

type GeometrySelectionUnit = SelectionUnit & { bounds: SelectionBounds };

type InspectorMode = 'canvas' | 'element';
type MediaTarget = { kind: 'background' } | { kind: 'element'; id: string };
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type SelectionAlignment = 'left' | 'horizontal-center' | 'right' | 'top' | 'vertical-center' | 'bottom';
type DistributionAxis = 'horizontal' | 'vertical';

interface CanvasGuide {
  id: string;
  axis: DistributionAxis;
  position: number;
}

interface GuideGesture {
  id: string;
  axis: DistributionAxis;
}

const ICON_COMPONENTS: Record<SocialImageIconName, ComponentType<SVGProps<SVGSVGElement>>> = {
  sparkles: Sparkles,
  star: Star,
  heart: Heart,
  'arrow-up-right': ArrowUpRight,
  check: Check,
  play: Play,
};

const ICON_LABELS: Record<SocialImageIconName, string> = {
  sparkles: 'Brilhos',
  star: 'Estrela',
  heart: 'Coração',
  'arrow-up-right': 'Seta diagonal',
  check: 'Check',
  play: 'Play',
};

const MIN_ELEMENT_SIZE = SOCIAL_IMAGE_MIN_ELEMENT_SIDE;
const MAX_HISTORY = 80;
let socialImageFontLoad: Promise<void> | null = null;

function ensureSocialImageFont() {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve();
  if (!socialImageFontLoad) {
    const face = new FontFace(
      SOCIAL_IMAGE_BROWSER_FONT_FACE,
      `url(${JSON.stringify(socialImageGeistUrl)}) format("truetype")`,
      { style: 'normal', weight: '400' },
    );
    socialImageFontLoad = face.load()
      .then(loaded => {
        document.fonts.add(loaded);
      })
      .catch(error => {
        socialImageFontLoad = null;
        throw error;
      });
  }
  return socialImageFontLoad;
}

function useSocialImageFont() {
  useEffect(() => {
    void ensureSocialImageFont().catch(() => {
      // The canonical family remains explicit. A browser-only fallback keeps
      // the editor usable, while PHP refuses to publish text without its TTF.
    });
  }, []);
}

function syntheticTextWeightShadow(weight: SocialImageTextElement['fontWeight']) {
  if (weight >= 800) return '1px 0 currentColor, 2px 0 currentColor';
  if (weight >= 600) return '1px 0 currentColor';
  return undefined;
}

function socialFontFaceWeightDistance(face: ProjectFontFace, target: number) {
  const normalized = face.weight.trim().toLowerCase();
  const weights = Array.from(normalized.matchAll(/\b([1-9]00)\b/g), match => Number(match[1]));
  if (weights.length >= 2) {
    const minimum = Math.min(weights[0], weights[1]);
    const maximum = Math.max(weights[0], weights[1]);
    if (target >= minimum && target <= maximum) return 0;
    return Math.min(Math.abs(target - minimum), Math.abs(target - maximum));
  }
  const weight = weights[0]
    ?? (normalized === 'bold' ? 700 : normalized === 'normal' ? 400 : 400);
  return Math.abs(target - weight);
}

function socialFontFaceWeight(
  face: ProjectFontFace,
  targetWeight: number,
): SocialImageFontWeight {
  const weights = Array.from(
    face.weight.matchAll(/\b([1-9]00)\b/g),
    match => Number(match[1]),
  );
  if (weights.length >= 2) {
    // FreeType's simple imagettftext API cannot select a variable-font axis.
    // Its default is conventionally Regular, clamped to the authored range;
    // synthetic weight then accounts for the requested value on the server.
    return normalizeSocialImageFontWeight(clamp(
      400,
      Math.min(weights[0], weights[1]),
      Math.max(weights[0], weights[1]),
    ));
  }
  return normalizeSocialImageFontWeight(weights[0] ?? face.weight);
}

function socialFontFaceCoveragePenalty(face: ProjectFontFace) {
  const range = (face.unicodeRange || '').toUpperCase();
  if (!range) return 0;
  if (
    /U\+0*0000\s*-\s*0*00FF/.test(range)
    || /U\+0*0020\s*-\s*0*007E/.test(range)
    || /U\+0{0,2}\?{2,4}/.test(range)
  ) return 0;
  if (
    /U\+0*0100\s*-\s*0*024F/.test(range)
    || /U\+0*1E00\s*-\s*0*1EFF/.test(range)
  ) return 1;
  return 4;
}

interface SocialProjectFontFace {
  path: string;
  weight: SocialImageFontWeight;
  face: ProjectFontFace;
}

function socialFontFaceFor(
  font: ProjectFont,
  targetWeight: number,
): SocialProjectFontFace | null {
  return font.faces
    .flatMap(face => face.sources
      .filter(source =>
        Boolean(source.filePath)
        && /\.(?:woff2|ttf|otf)$/i.test(source.filePath!)
        && !/(?:^|\/)(?:\.incode|\.kodety-social)(?:\/|$)/i.test(source.filePath!))
      .map((source, sourceIndex) => ({
        path: source.filePath!,
        face,
        weight: socialFontFaceWeight(face, targetWeight),
        distance: socialFontFaceWeightDistance(face, targetWeight),
        italic: face.style.toLowerCase() === 'italic',
        coverage: socialFontFaceCoveragePenalty(face),
        conversion: /\.woff2$/i.test(source.filePath!) ? 1 : 0,
        inferred: face.inferred ? 1 : 0,
        sourceIndex,
      })))
    .sort((left, right) =>
      Number(left.italic) - Number(right.italic)
      || left.coverage - right.coverage
      || left.distance - right.distance
      || left.conversion - right.conversion
      || left.inferred - right.inferred
      || left.sourceIndex - right.sourceIndex
      || left.path.localeCompare(right.path))[0] || null;
}

function socialTextFontStyle(element: SocialImageTextElement): CSSProperties {
  const usesProjectFont = Boolean(element.fontFile);
  return {
    fontFamily: usesProjectFont
      ? `"${element.fontFamily.replaceAll('"', '\\"')}", sans-serif`
      : SOCIAL_IMAGE_BROWSER_FONT_FAMILY,
    fontWeight: usesProjectFont ? element.fontWeight : 400,
    fontStyle: 'normal',
    textShadow: usesProjectFont
      ? undefined
      : syntheticTextWeightShadow(element.fontWeight),
  };
}

function newEditorId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
}

function round(value: number, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function numericValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="menu"]'),
  );
}

function resolvedElementRect(
  element: SocialImageElement,
  canvasWidth: number,
  canvasHeight: number,
  autoTextHeights?: ReadonlyMap<string, number>,
  stackRects?: ReadonlyMap<string, SocialImageElementRect>,
) {
  const stackRect = stackRects?.get(element.id);
  if (stackRect) return stackRect;
  const measuredHeight = element.type === 'text' && element.autoHeight
    ? autoTextHeights?.get(element.id)
    : undefined;
  return socialImageElementRect(
    element,
    canvasWidth,
    canvasHeight,
    measuredHeight,
  );
}

function elementBounds(
  elements: SocialImageElement[],
  canvasWidth: number,
  canvasHeight: number,
  autoTextHeights?: ReadonlyMap<string, number>,
  stackRects?: ReadonlyMap<string, SocialImageElementRect>,
): SelectionBounds | null {
  if (!elements.length) return null;
  const rects = elements.map(element =>
    resolvedElementRect(
      element,
      canvasWidth,
      canvasHeight,
      autoTextHeights,
      stackRects,
    ));
  const x = Math.min(...rects.map(rect => rect.x));
  const y = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x, y, width: Math.max(MIN_ELEMENT_SIZE, right - x), height: Math.max(MIN_ELEMENT_SIZE, bottom - y) };
}

function buildSelectionUnits(
  elements: SocialImageElement[],
  selectedIds: readonly string[],
  canvasWidth: number,
  canvasHeight: number,
  autoTextHeights?: ReadonlyMap<string, number>,
  stackRects?: ReadonlyMap<string, SocialImageElementRect>,
) {
  const selectedSet = new Set(selectedIds);
  const selectedGroupIds = new Set(
    elements
      .filter(element => selectedSet.has(element.id) && element.groupId)
      .map(element => element.groupId!),
  );
  const units = new Map<string, SocialImageElement[]>();
  elements.forEach(element => {
    if (
      !selectedSet.has(element.id)
      && (!element.groupId || !selectedGroupIds.has(element.groupId))
    ) return;
    const key = element.groupId ? `group:${element.groupId}` : `element:${element.id}`;
    units.set(key, [...(units.get(key) || []), element]);
  });
  return [...units.entries()].map(([key, unitElements]): SelectionUnit => ({
    key,
    elements: unitElements,
    bounds: elementBounds(
      unitElements.filter(element => element.visible),
      canvasWidth,
      canvasHeight,
      autoTextHeights,
      stackRects,
    ),
    locked: unitElements.some(element => element.locked),
  }));
}

function selectionBoundsUnion(bounds: SelectionBounds[]) {
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map(rect => rect.x));
  const y = Math.min(...bounds.map(rect => rect.y));
  const right = Math.max(...bounds.map(rect => rect.x + rect.width));
  const bottom = Math.max(...bounds.map(rect => rect.y + rect.height));
  return {
    x,
    y,
    width: Math.max(MIN_ELEMENT_SIZE, right - x),
    height: Math.max(MIN_ELEMENT_SIZE, bottom - y),
  };
}

function translateSocialImageElement(
  element: SocialImageElement,
  rect: SelectionBounds,
  deltaX: number,
  deltaY: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const translated = socialImageElementWithRect(
    element,
    {
      ...rect,
      x: round(rect.x + deltaX),
      y: round(rect.y + deltaY),
    },
    canvasWidth,
    canvasHeight,
  );
  return element.type === 'text' && element.autoHeight
    ? { ...translated, height: element.height }
    : translated;
}

function elementShadow(element: SocialImageElement) {
  if (!element.shadow.enabled) return undefined;
  const alpha = clamp(element.shadow.opacity, 0, 1);
  const color = normalizeSocialImageColor(element.shadow.color, '#000000');
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `${element.shadow.offsetX}px ${element.shadow.offsetY}px ${element.shadow.blur}px rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function canvasBackground(template: SocialImageTemplate): CSSProperties {
  const { background } = template;
  return {
    backgroundColor: background.color,
    backgroundImage: background.gradient.enabled
      ? `linear-gradient(${background.gradient.angle}deg, ${background.gradient.from}, ${background.gradient.to})`
      : undefined,
  };
}

function resolvedImageSource(source: string, variables: Record<string, unknown>) {
  return resolveSocialImageValue(source, variables, false).trim();
}

function normalizedAssetSource(source: string) {
  return source.trim().replaceAll('&amp;', '&');
}

function findProjectAsset(
  source: string,
  context: SocialImageAssetPreviewContext | undefined,
) {
  const raw = normalizedAssetSource(source);
  if (
    !raw
    || raw.includes('{{')
    || /^(?:https?:|data:|blob:)/i.test(raw)
    || raw.startsWith('//')
  ) return undefined;
  const projectFiles = context?.projectFiles;
  if (!projectFiles) return undefined;
  const resolvedPath = resolveProjectPath(
    context?.referencePath || 'index.html',
    raw,
    context?.projectRootPath || '',
  );
  const cleanPath = raw.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
  return (resolvedPath ? projectFiles[resolvedPath] : undefined)
    || projectFiles[cleanPath]
    || Object.values(projectFiles).find(candidate => candidate.path === cleanPath);
}

function publicAssetPreviewUrl(
  source: string,
  context: SocialImageAssetPreviewContext | undefined,
) {
  const raw = normalizedAssetSource(source);
  if (!raw || raw.includes('{{')) return '';
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
  const fallbackOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const base = context?.publicBaseUrl?.trim() || fallbackOrigin;
  if (!base) return raw;
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

/**
 * Resolves editor-only preview URLs while preserving the authored source in
 * the template. Project files become short-lived blob URLs; public relative
 * paths use the site's configured base URL rather than the builder/admin URL.
 */
function useSocialImageAssetPreview(
  source: string,
  context: SocialImageAssetPreviewContext | undefined,
) {
  const file = useMemo(
    () => findProjectAsset(source, context),
    [
      context?.projectFiles,
      context?.projectRootPath,
      context?.referencePath,
      source,
    ],
  );
  const [objectUrl, setObjectUrl] = useState('');
  useEffect(() => {
    if (!file || (file.data === undefined && file.text === undefined)) {
      setObjectUrl('');
      return;
    }
    const body = file.data !== undefined ? new Uint8Array(file.data) : file.text || '';
    const next = URL.createObjectURL(new Blob([body], {
      type: file.mimeType || 'application/octet-stream',
    }));
    setObjectUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return file ? objectUrl : publicAssetPreviewUrl(source, context);
}

function elementVisualStyle(
  element: SocialImageElement,
  canvasWidth: number,
  canvasHeight: number,
  layoutRect?: SocialImageElementRect,
): CSSProperties {
  const rect = layoutRect
    || socialImageElementRect(element, canvasWidth, canvasHeight);
  const autoHeight = element.type === 'text' && element.autoHeight;
  const translateY = autoHeight && !layoutRect && element.verticalAnchor === 'center'
    ? 'translateY(-50%) '
    : '';
  return {
    position: 'absolute',
    left: rect.x,
    top: layoutRect
      ? rect.y
      : autoHeight
      ? element.verticalAnchor === 'bottom'
        ? undefined
        : element.verticalAnchor === 'center'
          ? canvasHeight / 2 + element.y
          : element.y
      : rect.y,
    bottom: !layoutRect && autoHeight && element.verticalAnchor === 'bottom'
      ? element.y
      : undefined,
    width: rect.width,
    height: autoHeight ? 'fit-content' : rect.height,
    minHeight: autoHeight ? MIN_ELEMENT_SIZE : undefined,
    maxHeight: autoHeight
      ? socialImageAutoHeightLimit(element, canvasHeight)
      : undefined,
    opacity: element.opacity,
    transform: `${translateY}rotate(${element.rotation}deg)`,
    transformOrigin: 'center',
    borderColor: element.border.color,
    borderWidth: element.border.width,
    borderStyle: element.border.width > 0 ? 'solid' : undefined,
    borderRadius: element.border.radius,
    boxShadow: elementShadow(element),
  };
}

function ElementVisual({
  element,
  canvasWidth,
  canvasHeight,
  variables,
  assetPreview,
  interactive = false,
  interactionScale = 1,
  selected = false,
  layoutRect,
  onPointerDown,
  onAutoHeightChange,
}: {
  element: SocialImageElement;
  canvasWidth: number;
  canvasHeight: number;
  variables: Record<string, unknown>;
  assetPreview?: SocialImageAssetPreviewContext;
  interactive?: boolean;
  interactionScale?: number;
  selected?: boolean;
  layoutRect?: SocialImageElementRect;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, element: SocialImageElement) => void;
  onAutoHeightChange?: (elementId: string, height: number) => void;
}) {
  const visualRef = useRef<HTMLDivElement>(null);
  const authoredImageSource = element.type === 'image'
    ? resolvedImageSource(element.source, variables)
    : '';
  const previewImageSource = useSocialImageAssetPreview(authoredImageSource, assetPreview);
  const autoHeight = element.type === 'text' && element.autoHeight;
  useEffect(() => {
    if (!autoHeight || !onAutoHeightChange || !visualRef.current) return;
    const node = visualRef.current;
    const measure = () => {
      onAutoHeightChange(
        element.id,
        clamp(
          node.offsetHeight,
          MIN_ELEMENT_SIZE,
          socialImageAutoHeightLimit(element, canvasHeight),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    autoHeight,
    canvasHeight,
    element,
    onAutoHeightChange,
  ]);
  if (!element.visible) return null;
  const commonClassName = cn(
    'absolute select-none',
    interactive && (element.locked ? 'cursor-not-allowed' : 'cursor-move'),
    selected && 'outline outline-[var(--kodety-focus)]/70',
  );
  const commonStyle = {
    ...elementVisualStyle(element, canvasWidth, canvasHeight, layoutRect),
    outlineWidth: selected ? 1 / Math.max(0.01, interactionScale) : undefined,
  };
  const commonProps = {
    ref: visualRef,
    'data-social-element-id': element.id,
    className: commonClassName,
    style: commonStyle,
    onPointerDown: interactive && onPointerDown
      ? (event: ReactPointerEvent<HTMLDivElement>) => onPointerDown(event, element)
      : undefined,
  };

  if (element.type === 'text') {
    const resolved = resolveSocialImageValue(element.text, variables, true);
    const justifyContent: CSSProperties['justifyContent'] = element.autoHeight
      ? 'flex-start'
      : element.verticalAlign === 'middle'
      ? 'center'
      : element.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'flex-start';
    return (
      <div {...commonProps} className={cn(commonClassName, 'flex overflow-hidden whitespace-pre-wrap break-words')}>
        <div
          className={cn(
            'flex w-full overflow-hidden',
            element.autoHeight ? 'h-auto' : 'h-full',
          )}
          style={{
            color: element.color,
            ...socialTextFontStyle(element),
            fontSize: element.fontSize,
            lineHeight: element.lineHeight,
            letterSpacing: element.letterSpacing,
            textAlign: element.align,
            justifyContent,
            flexDirection: 'column',
          }}
        >
          <span className="block w-full">{resolved || '\u00a0'}</span>
        </div>
      </div>
    );
  }

  if (element.type === 'image') {
    const source = previewImageSource;
    return (
      <div {...commonProps} className={cn(commonClassName, 'overflow-hidden bg-black/10')}>
        {source ? (
          <img
            src={source}
            alt=""
            draggable={false}
            className="pointer-events-none size-full"
            style={{
              objectFit: element.fit,
              objectPosition: `${element.focalX}% ${element.focalY}%`,
            }}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-white/5 px-4 text-center text-white/55">
            <ImageIcon className="size-10" />
            <span className="max-w-full truncate text-[18px]">{element.source || 'Escolha uma imagem'}</span>
          </div>
        )}
      </div>
    );
  }

  if (element.type === 'shape') {
    if (element.shape === 'line') {
      return (
        <div
          {...commonProps}
          className={cn(commonClassName, 'flex items-center')}
          style={{ ...commonStyle, borderWidth: 0 }}
        >
          <div
            className="w-full"
            style={{
              height: Math.max(1, element.border.width || Math.min(element.height, 4)),
              backgroundColor: element.fill,
              borderRadius: element.border.radius,
            }}
          />
        </div>
      );
    }
    return (
      <div
        {...commonProps}
        style={{
          ...commonStyle,
          backgroundColor: element.fill,
          borderRadius: element.shape === 'ellipse' ? '9999px' : element.border.radius,
        }}
      />
    );
  }

  const IconComponent = ICON_COMPONENTS[element.icon];
  return (
    <div {...commonProps} className={cn(commonClassName, 'flex items-center justify-center overflow-hidden')}>
      <IconComponent
        aria-hidden="true"
        className="size-full"
        color={element.color}
        fill="none"
        strokeWidth={element.strokeWidth}
      />
    </div>
  );
}

/**
 * Lightweight renderer for settings cards and other read-only previews.
 * It renders at the template's native dimensions and uses `scale` only on
 * the outer viewport, so text metrics match the editor/server model.
 */
export function SocialImageTemplatePreview({
  template: value,
  variables = {},
  className,
  scale = 1,
  assetPreview,
}: SocialImageTemplatePreviewProps) {
  useSocialImageFont();
  const template = useMemo(() => normalizeSocialImageTemplate(value), [value]);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const authoredBackgroundSource = resolvedImageSource(template.background.image, variables);
  const backgroundSource = useSocialImageAssetPreview(authoredBackgroundSource, assetPreview);
  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{ width: template.width * safeScale, height: template.height * safeScale }}
    >
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{
          ...canvasBackground(template),
          width: template.width,
          height: template.height,
          transform: `scale(${safeScale})`,
          transformOrigin: 'top left',
        }}
      >
        {backgroundSource && (
          <img
            src={backgroundSource}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full"
            style={{
              objectFit: template.background.imageFit,
              opacity: template.background.imageOpacity,
            }}
          />
        )}
        {template.elements.map(element => (
          <ElementVisual
            key={element.id}
            element={element}
            canvasWidth={template.width}
            canvasHeight={template.height}
            variables={variables}
            assetPreview={assetPreview}
          />
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group mx-2 mt-2 overflow-hidden rounded-xl border border-border/65 bg-card/35 shadow-sm"
      open={defaultOpen}
    >
      <DisclosureSummary className="flex cursor-pointer list-none items-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground">
        <span className="flex items-center gap-2">
          {title}
        </span>
      </DisclosureSummary>
      <div className="space-y-3 border-t border-border/50 px-3 py-3">{children}</div>
    </details>
  );
}

function Field({
  label,
  children,
  horizontal = false,
}: {
  label: string;
  children: React.ReactNode;
  horizontal?: boolean;
}) {
  return (
    <div className={cn(horizontal ? 'flex items-center justify-between gap-3' : 'space-y-1.5')}>
      <Label variant="muted" className="shrink-0 text-[10px]">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  inlineLabel = true,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  inlineLabel?: boolean;
}) {
  return (
    <label className="relative min-w-0 flex-1">
      {inlineLabel && (
        <span className="absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[9px] font-medium uppercase text-muted-foreground">
          {label}
        </span>
      )}
      <Input
        aria-label={label}
        type="number"
        value={round(value, 2)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={cn(
          'h-8 pr-6 text-right text-xs',
          inlineLabel
            ? label.length > 3
              ? 'pl-14'
              : label.length > 1
                ? 'pl-9'
                : 'pl-7'
            : 'pl-3',
        )}
        onChange={event => onChange(clamp(
          numericValue(event.target.value, value),
          min ?? Number.NEGATIVE_INFINITY,
          max ?? Number.POSITIVE_INFINITY,
        ))}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">
          {suffix}
        </span>
      )}
    </label>
  );
}

const HORIZONTAL_ANCHOR_LABELS: Record<SocialImageHorizontalAnchor, string> = {
  left: 'Esquerda',
  center: 'Centro',
  right: 'Direita',
};

const VERTICAL_ANCHOR_LABELS: Record<SocialImageVerticalAnchor, string> = {
  top: 'Topo',
  center: 'Centro',
  bottom: 'Base',
};

function AnchorGrid({
  horizontal,
  vertical,
  onChange,
}: {
  horizontal: SocialImageHorizontalAnchor;
  vertical: SocialImageVerticalAnchor;
  onChange: (
    horizontal: SocialImageHorizontalAnchor,
    vertical: SocialImageVerticalAnchor,
  ) => void;
}) {
  const horizontalValues: SocialImageHorizontalAnchor[] = ['left', 'center', 'right'];
  const verticalValues: SocialImageVerticalAnchor[] = ['top', 'center', 'bottom'];
  return (
    <div
      className="grid w-fit grid-cols-3 gap-0.5 rounded-lg border border-border/70 bg-muted/50 p-1"
      role="group"
      aria-label="Âncora do elemento"
    >
      {verticalValues.flatMap(verticalValue =>
        horizontalValues.map(horizontalValue => {
          const active = horizontal === horizontalValue && vertical === verticalValue;
          const label = `${HORIZONTAL_ANCHOR_LABELS[horizontalValue]} · ${VERTICAL_ANCHOR_LABELS[verticalValue]}`;
          return (
            <button
              key={`${horizontalValue}-${verticalValue}`}
              type="button"
              aria-label={`Ancorar em ${label}`}
              aria-pressed={active}
              title={label}
              className={cn(
                'flex size-6 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--kodety-focus)]',
                active ? 'border border-[var(--kodety-accent-hover)]/30 bg-[var(--kodety-accent)]/14 text-[var(--kodety-accent-hover)] shadow-sm' : 'text-muted-foreground hover:bg-background hover:text-foreground',
              )}
              onClick={() => onChange(horizontalValue, verticalValue)}
            >
              <span className={cn('size-1.5 rounded-full', active ? 'bg-[var(--kodety-accent-hover)]' : 'bg-current')} />
            </button>
          );
        }),
      )}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const normalized = normalizeSocialImageColor(value, '#000000');
  return (
    <Field label={label}>
      <div className="min-w-0 *:w-full">
        <ColorPicker
          value={normalized}
          onChange={next => onChange(/^#[0-9a-f]{6}$/i.test(next) ? next.toUpperCase() : next)}
          onImmediateChange={next => onChange(/^#[0-9a-f]{6}$/i.test(next) ? next.toUpperCase() : next)}
          colorVariableCapability={null}
          solidOnly
        />
      </div>
    </Field>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label variant="muted" className="text-[10px]">{label}</Label>
      <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function VariableMenu({
  variables,
  onInsert,
  imageOnly = false,
  label = 'Inserir variável',
}: {
  variables: SocialImageVariableOption[];
  onInsert: (token: string) => void;
  imageOnly?: boolean;
  label?: string;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, SocialImageVariableOption[]>();
    variables
      .filter(variable => !imageOnly || variable.kind === 'image')
      .forEach(variable => {
        const group = variable.group || 'Personalizadas';
        groups.set(group, [...(groups.get(group) || []), variable]);
      });
    return [...groups.entries()];
  }, [imageOnly, variables]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} title={label}>
          <Braces />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        {grouped.length ? grouped.map(([group, options], groupIndex) => (
          <div key={group}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {options.map(variable => (
              <DropdownMenuItem
                key={variable.key}
                onSelect={() => onInsert(socialImageVariableToken(variable.key))}
              >
                <span className="min-w-0 flex-1 truncate">{variable.label}</span>
                <code className="text-[9px] text-muted-foreground">{variable.key}</code>
              </DropdownMenuItem>
            ))}
          </div>
        )) : (
          <DropdownMenuItem disabled>Nenhuma variável de imagem</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </Field>
  );
}

function imageItemPreview(item: WordPressMediaItem) {
  return item.media_details?.sizes?.medium?.source_url
    || item.media_details?.sizes?.thumbnail?.source_url
    || item.source_url;
}

function WordPressMediaDialog({
  open,
  onOpenChange,
  connection,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: SocialImageMediaConnection;
  onSelect: (media: Pick<WordPressMediaItem, 'id' | 'source_url'>) => void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<WordPressMediaItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !connection?.mediaUrl) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const endpoint = new URL(connection.mediaUrl!, window.location.href);
      endpoint.searchParams.set('media_type', 'image');
      endpoint.searchParams.set('per_page', '48');
      endpoint.searchParams.set('orderby', 'date');
      endpoint.searchParams.set('order', 'desc');
      if (search.trim()) endpoint.searchParams.set('search', search.trim());
      setLoading(true);
      setError('');
      fetch(endpoint, {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': connection.nonce },
        signal: controller.signal,
      })
        .then(async response => {
          const data = await response.json() as unknown;
          if (!response.ok) {
            const message = data && typeof data === 'object' && 'message' in data
              ? String((data as { message?: unknown }).message || '')
              : '';
            throw new Error(message || 'Não foi possível abrir a Biblioteca de Mídia.');
          }
          return Array.isArray(data) ? data as WordPressMediaItem[] : [];
        })
        .then(setItems)
        .catch(fetchError => {
          if (!(fetchError instanceof DOMException && fetchError.name === 'AbortError')) {
            setError(fetchError instanceof Error ? fetchError.message : 'Biblioteca indisponível.');
          }
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [connection?.mediaUrl, connection?.nonce, open, search]);

  const upload = async (file?: File) => {
    if (!file || !connection?.mediaUrl) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      body.append('title', file.name.replace(/\.[^.]+$/, ''));
      const response = await fetch(connection.mediaUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': connection.nonce },
        body,
      });
      const media = await response.json() as WordPressMediaItem & { message?: string };
      if (!response.ok || !media.source_url) {
        throw new Error(media.message || 'Não foi possível enviar a imagem.');
      }
      setItems(current => [media, ...current.filter(item => item.id !== media.id)]);
      onSelect(media);
      onOpenChange(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Falha ao enviar a imagem.');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[130] flex h-[min(76vh,720px)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        showCloseButton={!uploading}
      >
        <div className="border-b border-border/70 px-5 py-4">
          <DialogTitle>Biblioteca de Mídia</DialogTitle>
          <DialogDescription className="mt-1">
            Selecione uma imagem do WordPress ou envie um novo arquivo.
          </DialogDescription>
        </div>
        <div className="flex items-center gap-2 border-b border-border/70 p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Pesquisar imagens…"
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={uploading}
            onClick={() => uploadRef.current?.click()}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            Enviar
          </Button>
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => void upload(event.target.files?.[0])}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error && (
            <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : items.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted outline-none hover:border-[var(--kodety-accent)] focus-visible:ring-2 focus-visible:ring-[var(--kodety-focus)]"
                  onClick={() => {
                    onSelect(item);
                    onOpenChange(false);
                  }}
                  title={item.title?.rendered || item.alt_text || 'Selecionar imagem'}
                >
                  <img
                    src={imageItemPreview(item)}
                    alt={item.alt_text || ''}
                    className="block h-auto max-h-full w-auto max-w-full object-contain transition-transform group-hover:scale-105"
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-1 text-left text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {item.title?.rendered || `Imagem ${item.id}`}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <ImageIcon className="size-7" />
              <p className="text-xs">{search ? 'Nenhuma imagem encontrada.' : 'A Biblioteca de Mídia está vazia.'}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CanvasInspector({
  template,
  variables,
  mediaAvailable,
  onChange,
  onOpenMedia,
}: {
  template: SocialImageTemplate;
  variables: SocialImageVariableOption[];
  mediaAvailable: boolean;
  onChange: (updater: (template: SocialImageTemplate) => SocialImageTemplate) => void;
  onOpenMedia: () => void;
}) {
  const currentPreset = SOCIAL_IMAGE_DIMENSION_PRESETS.find(
    preset => preset.width === template.width && preset.height === template.height,
  )?.id || 'custom';

  const updateBackground = (
    updater: (background: SocialImageTemplate['background']) => SocialImageTemplate['background'],
  ) => onChange(current => ({ ...current, background: updater(current.background) }));

  return (
    <>
      <Section title="Documento">
        <Field label="Nome do template">
          <Input
            value={template.name}
            onChange={event => onChange(current => ({ ...current, name: event.target.value }))}
            placeholder="Social Image"
          />
        </Field>
        <SelectField
          label="Tamanho do canvas"
          value={currentPreset}
          onValueChange={value => {
            const preset = SOCIAL_IMAGE_DIMENSION_PRESETS.find(item => item.id === value);
            if (preset) onChange(current => ({ ...current, width: preset.width, height: preset.height }));
          }}
        >
          {SOCIAL_IMAGE_DIMENSION_PRESETS.map(preset => (
            <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>
          ))}
          {currentPreset === 'custom' && <SelectItem value="custom">Personalizado</SelectItem>}
        </SelectField>
        <div className="flex gap-2">
          <NumberField
            label="W"
            value={template.width}
            min={320}
            max={SOCIAL_IMAGE_MAX_CANVAS_SIDE}
            onChange={width => onChange(current => ({ ...current, width: Math.round(width) }))}
          />
          <NumberField
            label="H"
            value={template.height}
            min={320}
            max={SOCIAL_IMAGE_MAX_CANVAS_SIDE}
            onChange={height => onChange(current => ({ ...current, height: Math.round(height) }))}
          />
        </div>
      </Section>

      <Section title="Background">
        <ColorField
          label="Cor base"
          value={template.background.color}
          onChange={color => updateBackground(background => ({ ...background, color }))}
        />
        <ToggleRow
          label="Usar gradiente"
          checked={template.background.gradient.enabled}
          onCheckedChange={enabled => updateBackground(background => ({
            ...background,
            gradient: { ...background.gradient, enabled },
          }))}
        />
        {template.background.gradient.enabled && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <ColorField
                label="Início"
                value={template.background.gradient.from}
                onChange={from => updateBackground(background => ({
                  ...background,
                  gradient: { ...background.gradient, from },
                }))}
              />
              <ColorField
                label="Fim"
                value={template.background.gradient.to}
                onChange={to => updateBackground(background => ({
                  ...background,
                  gradient: { ...background.gradient, to },
                }))}
              />
            </div>
            <NumberField
              label="Ângulo"
              value={template.background.gradient.angle}
              min={-360}
              max={360}
              suffix="°"
              onChange={angle => updateBackground(background => ({
                ...background,
                gradient: { ...background.gradient, angle },
              }))}
            />
          </>
        )}
      </Section>

      <Section title="Imagem de fundo">
        <Field label="Fonte">
          <div className="flex gap-1">
            <Input
              value={template.background.image}
              onChange={event => updateBackground(background => ({
                ...background,
                image: event.target.value,
                imageAttachmentId: undefined,
              }))}
              placeholder="Asset, mídia ou {{site.logo}}"
              className="min-w-0 flex-1"
            />
            <VariableMenu
              variables={variables}
              imageOnly
              onInsert={token => updateBackground(background => ({
                ...background,
                image: token,
                imageAttachmentId: undefined,
              }))}
            />
            {mediaAvailable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onOpenMedia}
                aria-label="Abrir Biblioteca de Mídia"
                title="Biblioteca de Mídia"
              >
                <ImageIcon />
              </Button>
            )}
          </div>
        </Field>
        {/^\s*https?:\/\//i.test(template.background.image) && (
          <p className="text-[10px] leading-4 text-amber-300/85">
            Se a URL não pertence à Biblioteca de Mídia do WordPress, importe a imagem antes de gerar no servidor.
          </p>
        )}
        {template.background.image && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => updateBackground(background => ({
              ...background,
              image: '',
              imageAttachmentId: undefined,
            }))}
          >
            <X /> Remover imagem
          </Button>
        )}
        <SelectField
          label="Ajuste"
          value={template.background.imageFit}
          onValueChange={imageFit => updateBackground(background => ({
            ...background,
            imageFit: imageFit as SocialImageObjectFit,
          }))}
        >
          <SelectItem value="cover">Cobrir</SelectItem>
          <SelectItem value="contain">Conter</SelectItem>
          <SelectItem value="fill">Esticar</SelectItem>
        </SelectField>
        <Field label="Opacidade">
          <Slider
            value={[template.background.imageOpacity * 100]}
            min={0}
            max={100}
            step={1}
            unit="%"
            onValueChange={values => updateBackground(background => ({
              ...background,
              imageOpacity: (values[0] || 0) / 100,
            }))}
          />
        </Field>
      </Section>
    </>
  );
}

function ElementInspector({
  element,
  selectedIds,
  canvasWidth,
  canvasHeight,
  autoTextHeights,
  variables,
  projectFonts,
  onPrepareFontFile,
  mediaAvailable,
  onUpdate,
  onOpenMedia,
}: {
  element: SocialImageElement;
  selectedIds: string[];
  canvasWidth: number;
  canvasHeight: number;
  autoTextHeights: ReadonlyMap<string, number>;
  variables: SocialImageVariableOption[];
  projectFonts: ProjectFont[];
  onPrepareFontFile?: (fontFile: string) => Promise<string>;
  mediaAvailable: boolean;
  onUpdate: (
    ids: string[],
    updater: (element: SocialImageElement) => SocialImageElement,
  ) => void;
  onOpenMedia: (elementId: string) => void;
}) {
  const updateAll = (updater: (current: SocialImageElement) => SocialImageElement) => {
    onUpdate(selectedIds, updater);
  };
  const updateType = <T extends SocialImageElement['type']>(
    type: T,
    updater: (current: Extract<SocialImageElement, { type: T }>) => Extract<SocialImageElement, { type: T }>,
  ) => {
    onUpdate(selectedIds, current => current.type === type
      ? updater(current as Extract<SocialImageElement, { type: T }>)
      : current);
  };
  const fontPreparationRequest = useRef(0);
  const [fontPreparation, setFontPreparation] = useState<{
    loading: boolean;
    error: string;
  }>({ loading: false, error: '' });
  useEffect(() => {
    fontPreparationRequest.current += 1;
    setFontPreparation({ loading: false, error: '' });
  }, [element.id]);
  const socialProjectFonts = useMemo(
    () => projectFonts.filter(font => Boolean(socialFontFaceFor(font, element.type === 'text'
      ? element.fontWeight
      : 400))),
    [element, projectFonts],
  );
  const availableFontFamilies = useMemo(() => {
    const families = new Set<string>(SOCIAL_IMAGE_FONT_FAMILIES);
    socialProjectFonts.forEach(font => families.add(font.family));
    if (element.type === 'text' && element.fontFile) families.add(element.fontFamily);
    return [...families];
  }, [element, socialProjectFonts]);

  const prepareProjectFont = async (
    font: ProjectFont,
    requestedWeight: SocialImageFontWeight,
  ) => {
    const selectedFace = socialFontFaceFor(font, requestedWeight);
    if (!selectedFace) {
      setFontPreparation({
        loading: false,
        error: 'Esta família não contém um arquivo WOFF2, TTF ou OTF utilizável.',
      });
      return;
    }
    const request = fontPreparationRequest.current + 1;
    fontPreparationRequest.current = request;
    setFontPreparation({ loading: true, error: '' });
    try {
      const fontFile = onPrepareFontFile
        ? await onPrepareFontFile(selectedFace.path)
        : /\.(?:ttf|otf)$/i.test(selectedFace.path)
          ? selectedFace.path
          : '';
      if (!fontFile) {
        throw new Error('A fonte WOFF2 não pôde ser preparada para o render publicado.');
      }
      if (fontPreparationRequest.current !== request) return;
      updateType('text', current => ({
        ...current,
        fontFamily: font.family,
        fontFile,
        fontFileWeight: selectedFace.weight,
        fontWeight: requestedWeight,
      }));
      setFontPreparation({ loading: false, error: '' });
    } catch (error) {
      if (fontPreparationRequest.current !== request) return;
      setFontPreparation({
        loading: false,
        error: error instanceof Error
          ? error.message
          : 'Não foi possível preparar esta fonte para publicação.',
      });
    }
  };

  return (
    <>
      <Section title={selectedIds.length > 1 ? `${selectedIds.length} elementos` : 'Layout'}>
        {selectedIds.length > 1 ? (
          <div className="rounded-lg border border-[var(--kodety-accent)]/20 bg-[var(--kodety-accent)]/8 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
            Use <span className="font-medium text-foreground">Alinhar</span> na barra superior para organizar a seleção. Posição, tamanho e âncora continuam individuais.
          </div>
        ) : (
          <>
          <Field label="Nome da camada">
          <Input
            value={element.name}
            onChange={event => updateAll(current => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 p-2">
          <div>
            <p className="text-[10px] font-medium text-foreground">Âncora</p>
            <p className="mt-0.5 text-[9px] leading-3.5 text-muted-foreground">
              Mantém esta referência ao redimensionar.
            </p>
          </div>
          <AnchorGrid
            horizontal={element.horizontalAnchor}
            vertical={element.verticalAnchor}
            onChange={(horizontalAnchor, verticalAnchor) => updateAll(current =>
              reanchorSocialImageElement(
                current,
                horizontalAnchor,
                verticalAnchor,
                canvasWidth,
                canvasHeight,
                current.type === 'text' && current.autoHeight
                  ? autoTextHeights.get(current.id)
                  : undefined,
              ))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={element.horizontalAnchor === 'left' ? 'L' : element.horizontalAnchor === 'right' ? 'R' : 'ΔX'}
            value={element.x}
            min={-SOCIAL_IMAGE_MAX_ELEMENT_POSITION}
            max={SOCIAL_IMAGE_MAX_ELEMENT_POSITION}
            onChange={x => updateAll(current => ({ ...current, x }))}
          />
          <NumberField
            label={element.verticalAnchor === 'top' ? 'T' : element.verticalAnchor === 'bottom' ? 'B' : 'ΔY'}
            value={element.y}
            min={-SOCIAL_IMAGE_MAX_ELEMENT_POSITION}
            max={SOCIAL_IMAGE_MAX_ELEMENT_POSITION}
            onChange={y => updateAll(current => ({ ...current, y }))}
          />
          <NumberField
            label="W"
            value={element.width}
            min={element.widthUnit === 'percent' ? SOCIAL_IMAGE_MIN_WIDTH_PERCENT : MIN_ELEMENT_SIZE}
            max={element.widthUnit === 'percent' ? SOCIAL_IMAGE_MAX_WIDTH_PERCENT : SOCIAL_IMAGE_MAX_ELEMENT_SIDE}
            step={element.widthUnit === 'percent' ? 0.1 : 1}
            suffix={element.widthUnit === 'percent' ? '%' : 'px'}
            onChange={width => updateAll(current => ({ ...current, width }))}
          />
          <NumberField
            label="H"
            value={element.type === 'text' && element.autoHeight
              ? autoTextHeights.get(element.id) || element.height
              : element.height}
            min={MIN_ELEMENT_SIZE}
            max={SOCIAL_IMAGE_MAX_ELEMENT_SIDE}
            suffix="px"
            disabled={element.type === 'text' && element.autoHeight}
            onChange={height => updateAll(current => ({ ...current, height }))}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5">
            {(['px', 'percent'] as SocialImageWidthUnit[]).map(widthUnit => (
              <Button
                key={widthUnit}
                type="button"
                variant={element.widthUnit === widthUnit ? 'secondary' : 'ghost'}
                size="xs"
                className="h-6 min-w-10 px-2 text-[9px]"
                onClick={() => updateAll(current =>
                  convertSocialImageElementWidthUnit(current, widthUnit, canvasWidth))}
              >
                {widthUnit === 'px' ? 'px' : '%'}
              </Button>
            ))}
          </div>
          <span className="text-[9px] text-muted-foreground">
            {Math.round(socialImageElementWidthPixels(element, canvasWidth))} px resolvidos
          </span>
        </div>
          {element.type === 'text' && (
          <ToggleRow
            label="Altura automática"
            checked={element.autoHeight}
            onCheckedChange={autoHeight => updateType('text', current => ({
              ...current,
              autoHeight,
              ...(!autoHeight
                ? { height: autoTextHeights.get(current.id) || current.height }
                : {}),
            }))}
          />
          )}
          </>
        )}
        <NumberField
          label="Rotação"
          value={element.rotation}
          min={-360}
          max={360}
          suffix="°"
          onChange={rotation => updateAll(current => ({ ...current, rotation }))}
        />
        <Field label="Opacidade">
          <Slider
            value={[element.opacity * 100]}
            min={0}
            max={100}
            step={1}
            unit="%"
            onValueChange={values => updateAll(current => ({ ...current, opacity: (values[0] || 0) / 100 }))}
          />
        </Field>
        <ToggleRow
          label="Visível"
          checked={element.visible}
          onCheckedChange={visible => updateAll(current => ({ ...current, visible }))}
        />
        <ToggleRow
          label="Bloqueado"
          checked={element.locked}
          onCheckedChange={locked => updateAll(current => ({ ...current, locked }))}
        />
      </Section>

      {element.type === 'text' && (
        <Section title="Texto">
          <Field label="Conteúdo">
            <div className="relative">
              <Textarea
                value={element.text}
                onChange={event => updateType('text', current => ({ ...current, text: event.target.value }))}
                className="min-h-24 pr-9"
              />
              <div className="absolute right-1.5 top-1.5">
                <VariableMenu
                  variables={variables}
                  onInsert={token => updateType('text', current => ({
                    ...current,
                    text: `${current.text}${current.text && !/\s$/.test(current.text) ? ' ' : ''}${token}`,
                  }))}
                />
              </div>
            </div>
          </Field>
          <SelectField
            label="Fonte"
            value={element.fontFamily}
            onValueChange={fontFamily => {
              const normalizedFamily = normalizeSocialImageFontFamily(fontFamily);
              const projectFont = socialProjectFonts.find(font => font.family === normalizedFamily);
              if (projectFont) {
                void prepareProjectFont(projectFont, element.fontWeight);
                return;
              }
              fontPreparationRequest.current += 1;
              setFontPreparation({ loading: false, error: '' });
              updateType('text', current => {
                const next = { ...current, fontFamily: normalizedFamily };
                delete next.fontFile;
                delete next.fontFileWeight;
                return next;
              });
            }}
          >
            {availableFontFamilies.map(font => (
              <SelectItem key={font} value={font}>{font}</SelectItem>
            ))}
          </SelectField>
          {fontPreparation.loading && (
            <p className="flex items-center gap-1.5 text-[9px] text-[var(--kodety-accent-hover)]">
              <Loader2 className="size-3 animate-spin" />
              Preparando a fonte do projeto para publicação…
            </p>
          )}
          {fontPreparation.error && (
            <p className="flex items-start gap-1.5 text-[9px] leading-4 text-destructive">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {fontPreparation.error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tamanho">
              <NumberField
                label="Tamanho"
                value={element.fontSize}
                min={8}
                max={400}
                inlineLabel={false}
                onChange={fontSize => updateType('text', current => ({ ...current, fontSize }))}
              />
            </Field>
            <Field label="Peso">
              <Select
                value={String(element.fontWeight)}
                onValueChange={value => {
                  const fontWeight = normalizeSocialImageFontWeight(Number(value));
                  const projectFont = socialProjectFonts.find(
                    font => font.family === element.fontFamily,
                  );
                  if (projectFont) {
                    void prepareProjectFont(projectFont, fontWeight);
                    return;
                  }
                  updateType('text', current => ({ ...current, fontWeight }));
                }}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOCIAL_IMAGE_FONT_WEIGHTS.map(weight => (
                    <SelectItem key={weight} value={String(weight)}>
                      {({
                        100: 'Thin',
                        200: 'Extra Light',
                        300: 'Light',
                        400: 'Regular',
                        500: 'Medium',
                        600: 'Semibold',
                        700: 'Bold',
                        800: 'Extra Bold',
                        900: 'Black',
                      } as Record<SocialImageFontWeight, string>)[weight]} · {weight}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <ColorField
            label="Cor"
            value={element.color}
            onChange={color => updateType('text', current => ({ ...current, color }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Linha"
              value={element.lineHeight}
              min={0.7}
              max={3}
              step={0.05}
              onChange={lineHeight => updateType('text', current => ({ ...current, lineHeight }))}
            />
            <NumberField
              label="Letras"
              value={element.letterSpacing}
              min={-20}
              max={100}
              step={0.1}
              onChange={letterSpacing => updateType('text', current => ({ ...current, letterSpacing }))}
            />
          </div>
          <Field label="Alinhamento">
            <div className="flex rounded-lg bg-input p-0.5">
              {([
                ['left', AlignLeft, 'Esquerda'],
                ['center', AlignCenter, 'Centro'],
                ['right', AlignRight, 'Direita'],
              ] as const).map(([value, IconComponent, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={element.align === value ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  className="flex-1"
                  aria-label={label}
                  onClick={() => updateType('text', current => ({ ...current, align: value as SocialImageTextAlign }))}
                >
                  <IconComponent />
                </Button>
              ))}
            </div>
          </Field>
          {!element.autoHeight && (
            <SelectField
              label="Alinhamento vertical"
              value={element.verticalAlign}
              onValueChange={verticalAlign => updateType('text', current => ({
                ...current,
                verticalAlign: verticalAlign as SocialImageVerticalAlign,
              }))}
            >
              <SelectItem value="top">Topo</SelectItem>
              <SelectItem value="middle">Centro</SelectItem>
              <SelectItem value="bottom">Base</SelectItem>
            </SelectField>
          )}
          <p className="text-[9px] leading-relaxed text-muted-foreground">
            {socialProjectFonts.length
              ? `${socialProjectFonts.length} ${socialProjectFonts.length === 1 ? 'fonte do projeto disponível' : 'fontes do projeto disponíveis'}. WOFF2 é preparado automaticamente para o render publicado.`
              : 'Geist e seus pesos sintéticos são empacotados para manter preview e publicação consistentes.'}
          </p>
        </Section>
      )}

      {element.type === 'image' && (
        <Section title="Imagem">
          <Field label="Fonte">
            <div className="flex gap-1">
              <Input
                value={element.source}
                onChange={event => updateType('image', current => ({
                  ...current,
                  source: event.target.value,
                  attachmentId: undefined,
                }))}
                placeholder="Asset, mídia ou {{page.featured_image}}"
                className="min-w-0 flex-1"
              />
              <VariableMenu
                variables={variables}
                imageOnly
                onInsert={source => updateType('image', current => ({
                  ...current,
                  source,
                  attachmentId: undefined,
                }))}
              />
              {mediaAvailable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onOpenMedia(element.id)}
                  aria-label="Abrir Biblioteca de Mídia"
                  title="Biblioteca de Mídia"
                >
                  <ImageIcon />
                </Button>
              )}
            </div>
          </Field>
          {/^\s*https?:\/\//i.test(element.source) && (
            <p className="text-[10px] leading-4 text-amber-300/85">
              Se a URL não pertence à Biblioteca de Mídia do WordPress, importe a imagem antes de gerar no servidor.
            </p>
          )}
          <SelectField
            label="Ajuste"
            value={element.fit}
            onValueChange={fit => updateType('image', current => ({ ...current, fit: fit as SocialImageObjectFit }))}
          >
            <SelectItem value="cover">Cobrir</SelectItem>
            <SelectItem value="contain">Conter</SelectItem>
            <SelectItem value="fill">Esticar</SelectItem>
          </SelectField>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Foco X"
              value={element.focalX}
              min={0}
              max={100}
              suffix="%"
              onChange={focalX => updateType('image', current => ({ ...current, focalX }))}
            />
            <NumberField
              label="Foco Y"
              value={element.focalY}
              min={0}
              max={100}
              suffix="%"
              onChange={focalY => updateType('image', current => ({ ...current, focalY }))}
            />
          </div>
        </Section>
      )}

      {element.type === 'shape' && (
        <Section title="Forma">
          <SelectField
            label="Tipo"
            value={element.shape}
            onValueChange={shape => updateType('shape', current => ({ ...current, shape: shape as SocialImageShapeKind }))}
          >
            <SelectItem value="rectangle">Retângulo</SelectItem>
            <SelectItem value="ellipse">Elipse</SelectItem>
            <SelectItem value="line">Linha</SelectItem>
          </SelectField>
          <ColorField
            label="Preenchimento"
            value={element.fill}
            onChange={fill => updateType('shape', current => ({ ...current, fill }))}
          />
        </Section>
      )}

      {element.type === 'icon' && (
        <Section title="Ícone">
          <SelectField
            label="Símbolo"
            value={element.icon}
            onValueChange={icon => updateType('icon', current => ({ ...current, icon: icon as SocialImageIconName }))}
          >
            {(Object.keys(ICON_LABELS) as SocialImageIconName[]).map(icon => (
              <SelectItem key={icon} value={icon}>{ICON_LABELS[icon]}</SelectItem>
            ))}
          </SelectField>
          <ColorField
            label="Cor"
            value={element.color}
            onChange={color => updateType('icon', current => ({ ...current, color }))}
          />
          <NumberField
            label="Traço"
            value={element.strokeWidth}
            min={1}
            max={8}
            step={0.25}
            onChange={strokeWidth => updateType('icon', current => ({ ...current, strokeWidth }))}
          />
        </Section>
      )}

      <Section title="Borda">
        <ColorField
          label="Cor"
          value={element.border.color}
          onChange={color => updateAll(current => ({
            ...current,
            border: { ...current.border, color },
          }))}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Largura"
            value={element.border.width}
            min={0}
            max={40}
            onChange={width => updateAll(current => ({
              ...current,
              border: { ...current.border, width },
            }))}
          />
          <NumberField
            label="Raio"
            value={element.border.radius}
            min={0}
            max={600}
            onChange={radius => updateAll(current => ({
              ...current,
              border: { ...current.border, radius },
            }))}
          />
        </div>
      </Section>

      <Section title="Sombra">
        <ToggleRow
          label="Ativar sombra"
          checked={element.shadow.enabled}
          onCheckedChange={enabled => updateAll(current => ({
            ...current,
            shadow: { ...current.shadow, enabled },
          }))}
        />
        {element.shadow.enabled && (
          <>
            <ColorField
              label="Cor"
              value={element.shadow.color}
              onChange={color => updateAll(current => ({
                ...current,
                shadow: { ...current.shadow, color },
              }))}
            />
            <Field label="Opacidade">
              <Slider
                value={[element.shadow.opacity * 100]}
                min={0}
                max={100}
                step={1}
                unit="%"
                onValueChange={values => updateAll(current => ({
                  ...current,
                  shadow: { ...current.shadow, opacity: (values[0] || 0) / 100 },
                }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Blur"
                value={element.shadow.blur}
                min={0}
                max={SOCIAL_IMAGE_MAX_SHADOW_BLUR}
                onChange={blur => updateAll(current => ({
                  ...current,
                  shadow: { ...current.shadow, blur },
                }))}
              />
              <NumberField
                label="X"
                value={element.shadow.offsetX}
                min={-SOCIAL_IMAGE_MAX_SHADOW_OFFSET}
                max={SOCIAL_IMAGE_MAX_SHADOW_OFFSET}
                onChange={offsetX => updateAll(current => ({
                  ...current,
                  shadow: { ...current.shadow, offsetX },
                }))}
              />
              <NumberField
                label="Y"
                value={element.shadow.offsetY}
                min={-SOCIAL_IMAGE_MAX_SHADOW_OFFSET}
                max={SOCIAL_IMAGE_MAX_SHADOW_OFFSET}
                onChange={offsetY => updateAll(current => ({
                  ...current,
                  shadow: { ...current.shadow, offsetY },
                }))}
              />
            </div>
          </>
        )}
      </Section>
    </>
  );
}

function LayerTypeIcon({ type }: { type: SocialImageElementType }) {
  if (type === 'text') return <Type />;
  if (type === 'image') return <ImageIcon />;
  if (type === 'shape') return <Square />;
  return <Sparkles />;
}

function LayersPanel({
  elements,
  selectedIds,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onMove,
}: {
  elements: SocialImageElement[];
  selectedIds: string[];
  onSelect: (id: string, additive: boolean) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
}) {
  return (
    <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-border/70 bg-background/95">
      <div className="flex h-11 items-center gap-2 border-b border-border/70 px-3">
        <Layers3 className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">Camadas</span>
        <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{elements.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {[...elements].reverse().map((element, reverseIndex) => {
          const actualIndex = elements.length - 1 - reverseIndex;
          const selected = selectedIds.includes(element.id);
          return (
            <div
              key={element.id}
              className={cn(
                'group mb-0.5 flex h-9 items-center gap-1 rounded-md border border-transparent px-1',
                selected ? 'border-[var(--kodety-accent)]/35 bg-[var(--kodety-accent)]/12 text-foreground' : 'hover:bg-accent/60',
                !element.visible && 'opacity-55',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={event => onSelect(element.id, event.shiftKey || event.metaKey || event.ctrlKey)}
              >
                <span className="text-muted-foreground [&>svg]:size-3">
                  <LayerTypeIcon type={element.type} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px]">{element.name}</span>
                {element.groupId && <Group className="size-2.5 text-muted-foreground" />}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={() => onMove(element.id, 'up')}
                disabled={actualIndex === elements.length - 1}
                aria-label={`Mover ${element.name} para cima`}
                title="Trazer para frente"
              >
                <ChevronUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={() => onMove(element.id, 'down')}
                disabled={actualIndex === 0}
                aria-label={`Mover ${element.name} para baixo`}
                title="Enviar para trás"
              >
                <ChevronDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onToggleLock(element.id)}
                aria-label={element.locked ? `Desbloquear ${element.name}` : `Bloquear ${element.name}`}
                title={element.locked ? 'Desbloquear' : 'Bloquear'}
              >
                {element.locked ? <Lock /> : <Unlock className="opacity-45" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onToggleVisibility(element.id)}
                aria-label={element.visible ? `Ocultar ${element.name}` : `Mostrar ${element.name}`}
                title={element.visible ? 'Ocultar' : 'Mostrar'}
              >
                {element.visible ? <Eye /> : <EyeOff />}
              </Button>
            </div>
          );
        })}
        {!elements.length && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <Layers3 className="size-6 opacity-50" />
            <p className="text-[11px]">Adicione elementos pela barra superior.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function rulerMajorStep(scale: number) {
  const candidates = [10, 20, 25, 50, 100, 200, 250, 500, 1_000];
  return candidates.find(candidate => candidate * scale >= 56) || candidates.at(-1)!;
}

function rulerMarks(length: number, step: number) {
  return Array.from(
    { length: Math.floor(length / step) + 1 },
    (_, index) => round(index * step, 2),
  );
}

function CanvasRulers({
  width,
  height,
  scale,
  selection,
  guides,
  onBeginGuide,
}: {
  width: number;
  height: number;
  scale: number;
  selection: SelectionBounds | null;
  guides: CanvasGuide[];
  onBeginGuide: (
    event: ReactPointerEvent<HTMLDivElement>,
    axis: DistributionAxis,
  ) => void;
}) {
  const majorStep = rulerMajorStep(scale);
  const minorStep = majorStep / 4;
  const horizontalMarks = rulerMarks(width, minorStep);
  const verticalMarks = rulerMarks(height, minorStep);

  return (
    <>
      <div
        className="absolute -left-6 -top-6 z-20 size-6 rounded-tl-md border-b border-r border-border/70 bg-background/95 shadow-sm"
        aria-hidden="true"
      />
      <div
        className="absolute -top-6 left-0 z-20 h-6 w-full cursor-col-resize overflow-hidden border-b border-border/70 bg-background/95 text-muted-foreground shadow-sm"
        title="Arraste da régua para criar uma guia vertical"
        onPointerDown={event => onBeginGuide(event, 'vertical')}
      >
        {selection && (
          <span
            className="pointer-events-none absolute bottom-0 h-0.5 bg-[var(--kodety-accent)]"
            style={{
              left: selection.x * scale,
              width: selection.width * scale,
            }}
          />
        )}
        {guides.filter(guide => guide.axis === 'vertical').map(guide => (
          <span
            key={guide.id}
            className="pointer-events-none absolute bottom-0 h-2 w-px bg-fuchsia-500"
            style={{ left: guide.position * scale }}
          />
        ))}
        {horizontalMarks.map((position, index) => {
          const major = index % 4 === 0;
          return (
            <span
              key={position}
              className={cn(
                'pointer-events-none absolute bottom-0 w-px bg-muted-foreground/55',
                major ? 'h-2.5' : 'h-1.5',
              )}
              style={{ left: position * scale }}
            >
              {major && (
                <span className="absolute bottom-2.5 left-1 font-mono text-[8px] leading-none">
                  {position}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div
        className="absolute -left-6 top-0 z-20 h-full w-6 cursor-row-resize overflow-hidden border-r border-border/70 bg-background/95 text-muted-foreground shadow-sm"
        title="Arraste da régua para criar uma guia horizontal"
        onPointerDown={event => onBeginGuide(event, 'horizontal')}
      >
        {selection && (
          <span
            className="pointer-events-none absolute right-0 w-0.5 bg-[var(--kodety-accent)]"
            style={{
              top: selection.y * scale,
              height: selection.height * scale,
            }}
          />
        )}
        {guides.filter(guide => guide.axis === 'horizontal').map(guide => (
          <span
            key={guide.id}
            className="pointer-events-none absolute right-0 h-px w-2 bg-fuchsia-500"
            style={{ top: guide.position * scale }}
          />
        ))}
        {verticalMarks.map((position, index) => {
          const major = index % 4 === 0;
          return (
            <span
              key={position}
              className={cn(
                'pointer-events-none absolute right-0 h-px bg-muted-foreground/55',
                major ? 'w-2.5' : 'w-1.5',
              )}
              style={{ top: position * scale }}
            >
              {major && (
                <span
                  className="absolute right-2.5 origin-bottom-right -rotate-90 font-mono text-[8px] leading-none"
                  style={{ bottom: 1 }}
                >
                  {position}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </>
  );
}

function CanvasGuides({
  guides,
  scale,
  onBeginGuide,
  onRemoveGuide,
}: {
  guides: CanvasGuide[];
  scale: number;
  onBeginGuide: (
    event: ReactPointerEvent<HTMLButtonElement>,
    guide: CanvasGuide,
  ) => void;
  onRemoveGuide: (id: string) => void;
}) {
  return (
    <>
      {guides.map(guide => guide.axis === 'vertical' ? (
        <button
          key={guide.id}
          type="button"
          className="group absolute bottom-0 top-0 z-30 w-3 -translate-x-1/2 cursor-col-resize outline-none"
          style={{ left: guide.position * scale }}
          aria-label={`Guia vertical em ${round(guide.position)} pixels`}
          title="Arraste para mover · clique duplo para remover"
          onPointerDown={event => onBeginGuide(event, guide)}
          onDoubleClick={() => onRemoveGuide(guide.id)}
        >
          <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-fuchsia-500 shadow-[0_0_0_1px_rgba(255,255,255,.35)] group-focus-visible:w-0.5" />
          <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded bg-fuchsia-600 px-1 py-0.5 font-mono text-[8px] leading-none text-white opacity-0 shadow-sm group-hover:opacity-100 group-focus-visible:opacity-100">
            {round(guide.position)}
          </span>
        </button>
      ) : (
        <button
          key={guide.id}
          type="button"
          className="group absolute left-0 right-0 z-30 h-3 -translate-y-1/2 cursor-row-resize outline-none"
          style={{ top: guide.position * scale }}
          aria-label={`Guia horizontal em ${round(guide.position)} pixels`}
          title="Arraste para mover · clique duplo para remover"
          onPointerDown={event => onBeginGuide(event, guide)}
          onDoubleClick={() => onRemoveGuide(guide.id)}
        >
          <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-fuchsia-500 shadow-[0_0_0_1px_rgba(255,255,255,.35)] group-focus-visible:h-0.5" />
          <span className="absolute left-1 top-1/2 -translate-y-1/2 rounded bg-fuchsia-600 px-1 py-0.5 font-mono text-[8px] leading-none text-white opacity-0 shadow-sm group-hover:opacity-100 group-focus-visible:opacity-100">
            {round(guide.position)}
          </span>
        </button>
      ))}
    </>
  );
}

function SelectionToolbar({
  selectedCount,
  movableCount,
  gapMovableCount,
  activeStack,
  gap,
  onGapChange,
  onAlign,
  onDistribute,
  onApplyGap,
  onStack,
  onRemoveStack,
}: {
  selectedCount: number;
  movableCount: number;
  gapMovableCount: number;
  activeStack?: SocialImageStack;
  gap: number;
  onGapChange: (value: number) => void;
  onAlign: (alignment: SelectionAlignment) => void;
  onDistribute: (axis: DistributionAxis) => void;
  onApplyGap: (axis: DistributionAxis) => void;
  onStack: (direction: SocialImageStackDirection) => void;
  onRemoveStack: () => void;
}) {
  const alignmentButtons: Array<{
    alignment: SelectionAlignment;
    label: string;
    icon: React.ReactNode;
  }> = [
    { alignment: 'left', label: 'Alinhar à esquerda', icon: <AlignLeft /> },
    { alignment: 'horizontal-center', label: 'Alinhar ao centro horizontal', icon: <AlignCenter /> },
    { alignment: 'right', label: 'Alinhar à direita', icon: <AlignRight /> },
    { alignment: 'top', label: 'Alinhar ao topo', icon: <ArrowUp /> },
    { alignment: 'vertical-center', label: 'Alinhar ao centro vertical', icon: <Minus /> },
    { alignment: 'bottom', label: 'Alinhar à base', icon: <ArrowDown /> },
  ];
  return (
    <div
      className="pointer-events-auto flex max-w-[min(940px,calc(100vw-32px))] items-center gap-0.5 overflow-x-auto rounded-xl border border-border/80 bg-background/95 p-1 shadow-[0_10px_32px_rgba(0,0,0,.24)] backdrop-blur"
      role="toolbar"
      aria-label="Ferramentas da seleção"
    >
      <span
        className="mx-1 flex h-6 shrink-0 items-center rounded-md border border-[var(--kodety-accent-hover)]/25 bg-[var(--kodety-accent)]/12 px-2 text-[9px] font-semibold text-[var(--kodety-accent-hover)]"
        title="Use Shift para adicionar ou remover itens da seleção"
      >
        {selectedCount} {selectedCount === 1 ? 'item' : 'itens'}
      </span>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
      {alignmentButtons.map(button => (
        <Button
          key={button.alignment}
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7 shrink-0"
          disabled={!movableCount}
          aria-label={button.label}
          title={button.label}
          onClick={() => onAlign(button.alignment)}
        >
          {button.icon}
        </Button>
      ))}
      <span className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-7 shrink-0"
        disabled={selectedCount < 3 || !movableCount}
        aria-label="Distribuir horizontalmente"
        title="Distribuir horizontalmente com espaços iguais"
        onClick={() => onDistribute('horizontal')}
      >
        <ArrowsExpandHorizontal />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-7 shrink-0"
        disabled={selectedCount < 3 || !movableCount}
        aria-label="Distribuir verticalmente"
        title="Distribuir verticalmente com espaços iguais"
        onClick={() => onDistribute('vertical')}
      >
        <MoveVertical />
      </Button>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
      <label className="flex h-7 shrink-0 items-center rounded-md border border-border/70 bg-muted/25 pl-2">
        <span className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">Gap</span>
        <input
          type="number"
          value={round(gap, 2)}
          min={0}
          max={SOCIAL_IMAGE_MAX_ELEMENT_SIDE}
          step={1}
          disabled={selectedCount < 2 || gapMovableCount < 2}
          aria-label="Espaço entre elementos"
          className="h-full w-12 bg-transparent px-1 text-right font-mono text-[9px] outline-none disabled:opacity-45"
          onChange={event => onGapChange(clamp(
            numericValue(event.target.value, gap),
            0,
            SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
          ))}
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-7 shrink-0 px-2 text-[9px]"
        disabled={selectedCount < 2 || gapMovableCount < 2}
        aria-label="Aplicar gap horizontal"
        title="Aplicar gap horizontal"
        onClick={() => onApplyGap('horizontal')}
      >
        H
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-7 shrink-0 px-2 text-[9px]"
        disabled={selectedCount < 2 || gapMovableCount < 2}
        aria-label="Aplicar gap vertical"
        title="Aplicar gap vertical"
        onClick={() => onApplyGap('vertical')}
      >
        V
      </Button>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          'h-7 shrink-0 gap-1 px-2 text-[9px]',
          activeStack?.direction === 'horizontal' && 'border border-[var(--kodety-accent-hover)]/25 bg-[var(--kodety-accent)]/12 text-[var(--kodety-accent-hover)]',
        )}
        disabled={selectedCount < 2 || gapMovableCount < 2}
        aria-label="Criar Stack horizontal"
        title="Stack horizontal: mantém as layers juntas e adapta o layout ao conteúdo"
        onClick={() => onStack('horizontal')}
      >
        <Layers3 /> Stack H
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          'h-7 shrink-0 gap-1 px-2 text-[9px]',
          activeStack?.direction === 'vertical' && 'border border-[var(--kodety-accent-hover)]/25 bg-[var(--kodety-accent)]/12 text-[var(--kodety-accent-hover)]',
        )}
        disabled={selectedCount < 2 || gapMovableCount < 2}
        aria-label="Criar Stack vertical"
        title="Stack vertical: título e descrição refluem juntos quando o texto cresce"
        onClick={() => onStack('vertical')}
      >
        <Layers3 /> Stack V
      </Button>
      {activeStack && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7 shrink-0"
          aria-label="Remover Stack"
          title="Remover Stack sem alterar a posição visual"
          onClick={onRemoveStack}
        >
          <Ungroup />
        </Button>
      )}
    </div>
  );
}

interface MoveGesture {
  kind: 'move';
  before: SocialImageTemplate;
  elementIds: string[];
  startClientX: number;
  startClientY: number;
  scale: number;
  activated: boolean;
  initialRects: Map<string, SelectionBounds>;
}

interface ResizeGesture {
  kind: 'resize';
  before: SocialImageTemplate;
  elementIds: string[];
  startClientX: number;
  startClientY: number;
  scale: number;
  corner: ResizeCorner;
  selectionUnitCount: number;
  bounds: SelectionBounds;
  initialRects: Map<string, SelectionBounds>;
}

type CanvasGesture = MoveGesture | ResizeGesture;

export function HtmlSocialImageBuilder({
  template,
  title,
  sampleVariables,
  dynamicVariables = [],
  media,
  assetPreview,
  onPrepareFontFile,
  onSave,
  onDelete,
  onClose,
}: HtmlSocialImageBuilderProps) {
  useSocialImageFont();
  const projectFonts = useFontsStore(state => state.projectFonts);
  const projectFiles = assetPreview?.projectFiles;
  const projectRootPath = assetPreview?.projectRootPath || '';
  const projectReferencePath = assetPreview?.referencePath || '';
  useEffect(() => {
    if (!projectFiles) return;
    const mainHtmlPath = projectReferencePath
      || Object.keys(projectFiles).find(path => /(?:^|\/)index\.html?$/i.test(path))
      || Object.keys(projectFiles).find(path => /\.html?$/i.test(path))
      || '';
    useFontsStore.getState().syncProjectFonts({
      name: 'Social Image',
      files: projectFiles,
      mainHtmlPath,
      rootPath: projectRootPath,
      openedAt: 0,
    });
  }, [projectFiles, projectReferencePath, projectRootPath]);
  const initialTemplateRef = useRef<SocialImageTemplate | null>(null);
  if (!initialTemplateRef.current) {
    initialTemplateRef.current = template
      ? normalizeSocialImageTemplate(template)
      : createDefaultSocialImageTemplate(title || 'Social Image');
  }

  const [draft, setDraftState] = useState<SocialImageTemplate>(initialTemplateRef.current);
  const draftRef = useRef(draft);
  const pastRef = useRef<SocialImageTemplate[]>([]);
  const futureRef = useRef<SocialImageTemplate[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('canvas');
  const [canvasScale, setCanvasScale] = useState(0.5);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showRulers, setShowRulers] = useState(true);
  const [guides, setGuides] = useState<CanvasGuide[]>([]);
  const [selectionGap, setSelectionGap] = useState(24);
  const [preparingFontFiles, setPreparingFontFiles] = useState(0);
  const [autoTextHeights, setAutoTextHeights] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaTarget, setMediaTarget] = useState<MediaTarget>({ kind: 'background' });
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<CanvasGesture | null>(null);
  const guideGestureRef = useRef<GuideGesture | null>(null);
  const incomingSignature = socialImageTemplateSignature(template || undefined);
  const incomingSignatureRef = useRef(incomingSignature);

  const setDraftLive = useCallback((next: SocialImageTemplate) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const prepareFontFileForInspector = useCallback(async (fontFile: string) => {
    if (!onPrepareFontFile) return fontFile;
    setPreparingFontFiles(current => current + 1);
    try {
      return await onPrepareFontFile(fontFile);
    } finally {
      setPreparingFontFiles(current => Math.max(0, current - 1));
    }
  }, [onPrepareFontFile]);

  const recordPrevious = useCallback((previous: SocialImageTemplate) => {
    const nextPast = [...pastRef.current, previous];
    pastRef.current = nextPast.length > MAX_HISTORY ? nextPast.slice(-MAX_HISTORY) : nextPast;
    futureRef.current = [];
    setHistoryVersion(version => version + 1);
  }, []);

  const commit = useCallback((
    updater: (current: SocialImageTemplate) => SocialImageTemplate,
  ) => {
    const previous = draftRef.current;
    const next = updater(previous);
    if (next === previous || socialImageTemplateSignature(next) === socialImageTemplateSignature(previous)) return;
    recordPrevious(previous);
    setDraftLive(next);
  }, [recordPrevious, setDraftLive]);

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, draftRef.current].slice(-MAX_HISTORY);
    setDraftLive(previous);
    setSelectedIds(current => current.filter(id => previous.elements.some(element => element.id === id)));
    setHistoryVersion(version => version + 1);
  }, [setDraftLive]);

  const redo = useCallback(() => {
    const next = futureRef.current.at(-1);
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, draftRef.current].slice(-MAX_HISTORY);
    setDraftLive(next);
    setSelectedIds(current => current.filter(id => next.elements.some(element => element.id === id)));
    setHistoryVersion(version => version + 1);
  }, [setDraftLive]);

  useEffect(() => {
    if (incomingSignatureRef.current === incomingSignature) return;
    incomingSignatureRef.current = incomingSignature;
    const next = template
      ? normalizeSocialImageTemplate(template)
      : createDefaultSocialImageTemplate(title || 'Social Image');
    pastRef.current = [];
    futureRef.current = [];
    setSelectedIds([]);
    setGuides([]);
    setAutoTextHeights(new Map());
    setInspectorMode('canvas');
    setDraftLive(next);
    setHistoryVersion(version => version + 1);
  }, [incomingSignature, setDraftLive, template, title]);

  const fitCanvas = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const width = Math.max(120, viewport.clientWidth - 72);
    const height = Math.max(120, viewport.clientHeight - 72);
    setCanvasScale(clamp(
      Math.min(
        width / draftRef.current.width,
        height / draftRef.current.height,
        1,
      ),
      0.06,
      1,
    ));
  }, []);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    fitCanvas();
    const observer = new ResizeObserver(fitCanvas);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [draft.width, draft.height, fitCanvas]);

  const zoomCanvas = useCallback((direction: -1 | 1) => {
    setCanvasScale(current => clamp(
      round(current + direction * Math.max(0.05, current * 0.2), 2),
      0.06,
      2,
    ));
  }, []);

  const variables = useMemo<SocialImageVariableOption[]>(() => {
    const builtIn = SOCIAL_IMAGE_VARIABLE_GROUPS.flatMap(group => group.variables.map(variable => ({
      key: variable.key,
      label: variable.label,
      kind: 'kind' in variable ? variable.kind : undefined,
      group: group.label,
    })));
    const unique = new Map<string, SocialImageVariableOption>();
    [...builtIn, ...dynamicVariables].forEach(variable => {
      if (variable.key.trim()) unique.set(variable.key, variable);
    });
    return [...unique.values()];
  }, [dynamicVariables]);

  const selectedElements = useMemo(
    () => selectedIds
      .map(id => draft.elements.find(element => element.id === id))
      .filter((element): element is SocialImageElement => Boolean(element)),
    [draft.elements, selectedIds],
  );
  const stackRects = useMemo(
    () => socialImageStackRects(draft, autoTextHeights),
    [autoTextHeights, draft],
  );
  const activeStack = useMemo(() => {
    if (selectedElements.length < 2) return undefined;
    const selectedSet = new Set(selectedElements.map(element => element.id));
    return draft.stacks.find(stack =>
      stack.elementIds.length === selectedSet.size
      && stack.elementIds.every(elementId => selectedSet.has(elementId)));
  }, [draft.stacks, selectedElements]);
  const selectedUnits = useMemo(
    () => buildSelectionUnits(
      draft.elements,
      selectedIds,
      draft.width,
      draft.height,
      autoTextHeights,
      stackRects,
    ),
    [
      autoTextHeights,
      draft.elements,
      draft.height,
      draft.width,
      selectedIds,
      stackRects,
    ],
  );
  const primaryElement = selectedElements.at(-1);
  const visibleSelectedElements = selectedUnits
    .flatMap(unit => unit.elements)
    .filter(element => element.visible);
  const movableSelectedCount = selectedUnits.filter(unit => unit.bounds && !unit.locked).length;
  const gapMovableCount = selectedElements.filter(
    element => element.visible && !element.locked,
  ).length;
  const selectionBounds = elementBounds(
    visibleSelectedElements,
    draft.width,
    draft.height,
    autoTextHeights,
    stackRects,
  );
  const visibleMovableSelectedElements = selectedUnits
    .filter(unit => !unit.locked)
    .flatMap(unit => unit.elements)
    .filter(element => element.visible);
  const selectionHasGroupedAutoHeight = visibleMovableSelectedElements.length > 1
    && visibleMovableSelectedElements.some(element =>
      element.type === 'text' && element.autoHeight);

  useEffect(() => {
    if (activeStack) setSelectionGap(activeStack.gap);
  }, [activeStack]);

  const recordAutoTextHeight = useCallback((elementId: string, height: number) => {
    setAutoTextHeights(current => {
      if (current.get(elementId) === height) return current;
      const next = new Map(current);
      next.set(elementId, height);
      return next;
    });
  }, []);

  const materializeAutoTextHeights = useCallback((
    templateValue: SocialImageTemplate,
  ): SocialImageTemplate => {
    const stacked = materializeSocialImageStacks(
      templateValue,
      autoTextHeights,
    );
    return {
      ...stacked,
      elements: stacked.elements.map(element => {
      if (element.type !== 'text' || !element.autoHeight) return element;
      const measured = autoTextHeights.get(element.id);
      return measured
        ? {
          ...element,
          height: Math.min(
            measured,
            socialImageAutoHeightLimit(element, templateValue.height),
          ),
        }
        : element;
      }),
    };
  }, [autoTextHeights]);

  const updateElements = useCallback((
    ids: string[],
    updater: (element: SocialImageElement) => SocialImageElement,
  ) => {
    const idSet = new Set(ids);
    commit(current => ({
      ...current,
      elements: current.elements.map(element => idSet.has(element.id) ? updater(element) : element),
    }));
  }, [commit]);

  const selectElement = useCallback((id: string, additive = false) => {
    const current = draftRef.current;
    const selected = current.elements.find(element => element.id === id);
    if (!selected) return;
    const relatedIds = selected.groupId
      ? current.elements.filter(element => element.groupId === selected.groupId).map(element => element.id)
      : [id];
    setSelectedIds(previous => {
      if (!additive) return relatedIds;
      const allAlreadySelected = relatedIds.every(relatedId => previous.includes(relatedId));
      return allAlreadySelected
        ? previous.filter(previousId => !relatedIds.includes(previousId))
        : [...previous.filter(previousId => !relatedIds.includes(previousId)), ...relatedIds];
    });
    setInspectorMode('element');
  }, []);

  const addElement = useCallback((type: SocialImageElementType) => {
    if (draftRef.current.elements.length >= 100) return;
    const element = createSocialImageElement(type, draftRef.current);
    commit(current => ({ ...current, elements: [...current.elements, element] }));
    setSelectedIds([element.id]);
    setInspectorMode('element');
  }, [commit]);

  const deleteSelected = useCallback(() => {
    const selectedSet = new Set(selectedIds);
    const deletable = draftRef.current.elements
      .filter(element => selectedSet.has(element.id) && !element.locked)
      .map(element => element.id);
    if (!deletable.length) return;
    const deletableSet = new Set(deletable);
    commit(current => {
      const remainingStacks = current.stacks
        .map(stack => ({
          ...stack,
          elementIds: stack.elementIds.filter(id => !deletableSet.has(id)),
        }))
        .filter(stack => stack.elementIds.length >= 2);
      const remainingStackIds = new Set(remainingStacks.map(stack => stack.id));
      return {
        ...current,
        elements: current.elements
          .filter(element => !deletableSet.has(element.id))
          .map(element => {
            if (!element.groupId || remainingStackIds.has(element.groupId)) return element;
            const removedStack = current.stacks.some(stack =>
              stack.id === element.groupId && stack.elementIds.includes(element.id));
            if (!removedStack) return element;
            const { groupId: _groupId, ...rest } = element;
            return rest as SocialImageElement;
          }),
        stacks: remainingStacks,
      };
    });
    setSelectedIds(current => current.filter(id => !deletableSet.has(id)));
  }, [commit, selectedIds]);

  const duplicateSelected = useCallback(() => {
    const selectedSet = new Set(selectedIds);
    const currentTemplate = draftRef.current;
    const originals = currentTemplate.elements.filter(element => selectedSet.has(element.id) && !element.locked);
    if (!originals.length) return;
    const groupIds = new Map<string, string>();
    const cloneIds = new Map<string, string>();
    const availableSlots = Math.max(0, 100 - currentTemplate.elements.length);
    if (!availableSlots) return;
    const clones = originals.slice(0, availableSlots).map(element => {
      const groupId = element.groupId
        ? groupIds.get(element.groupId) || (() => {
          const next = newEditorId('group');
          groupIds.set(element.groupId!, next);
          return next;
        })()
        : undefined;
      const cloneId = newEditorId(element.type);
      cloneIds.set(element.id, cloneId);
      const clone = {
        ...element,
        id: cloneId,
        name: `${element.name} cópia`,
        ...(groupId ? { groupId } : {}),
      } as SocialImageElement;
      const rect = resolvedElementRect(
        element,
        currentTemplate.width,
        currentTemplate.height,
        autoTextHeights,
        stackRects,
      );
      return socialImageElementWithRect(
        clone,
        { ...rect, x: rect.x + 24, y: rect.y + 24 },
        currentTemplate.width,
        currentTemplate.height,
      );
    });
    const clonedStacks = currentTemplate.stacks.flatMap(stack => {
      const elementIds = stack.elementIds
        .map(elementId => cloneIds.get(elementId))
        .filter((elementId): elementId is string => Boolean(elementId));
      if (elementIds.length !== stack.elementIds.length) return [];
      return [{
        ...stack,
        id: groupIds.get(stack.id) || newEditorId('stack'),
        elementIds,
      }];
    });
    commit(current => ({
      ...current,
      elements: [...current.elements, ...clones],
      stacks: [...current.stacks, ...clonedStacks],
    }));
    setSelectedIds(clones.map(element => element.id));
    setInspectorMode('element');
  }, [autoTextHeights, commit, selectedIds, stackRects]);

  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    const groupId = newEditorId('group');
    const selectedSet = new Set(selectedIds);
    commit(current => {
      const materialized = materializeSocialImageStacks(current, autoTextHeights);
      const removedStacks = materialized.stacks.filter(stack =>
        stack.elementIds.some(elementId => selectedSet.has(elementId)));
      const removedStackIds = new Set(removedStacks.map(stack => stack.id));
      return {
        ...materialized,
        elements: materialized.elements.map(element => {
          const withoutRemovedStack = element.groupId && removedStackIds.has(element.groupId)
            ? (() => {
              const { groupId: _groupId, ...rest } = element;
              return rest as SocialImageElement;
            })()
            : element;
          return selectedSet.has(element.id)
            ? { ...withoutRemovedStack, groupId }
            : withoutRemovedStack;
        }),
        stacks: materialized.stacks.filter(stack => !removedStackIds.has(stack.id)),
      };
    });
  }, [autoTextHeights, commit, selectedIds]);

  const ungroupSelected = useCallback(() => {
    if (!selectedElements.some(element => element.groupId)) return;
    const selectedSet = new Set(selectedIds);
    commit(current => {
      const materialized = materializeSocialImageStacks(current, autoTextHeights);
      const removedStackIds = new Set(
        materialized.stacks
          .filter(stack => stack.elementIds.some(elementId => selectedSet.has(elementId)))
          .map(stack => stack.id),
      );
      return {
        ...materialized,
        elements: materialized.elements.map(element => {
          if (
            !selectedSet.has(element.id)
            && (!element.groupId || !removedStackIds.has(element.groupId))
          ) return element;
          const { groupId: _groupId, ...rest } = element;
          return rest as SocialImageElement;
        }),
        stacks: materialized.stacks.filter(stack => !removedStackIds.has(stack.id)),
      };
    });
  }, [autoTextHeights, commit, selectedElements, selectedIds]);

  const stackSelected = useCallback((direction: SocialImageStackDirection) => {
    const current = draftRef.current;
    const members = selectedIds
      .map(id => current.elements.find(element => element.id === id))
      .filter((element): element is SocialImageElement => Boolean(element));
    if (members.length < 2 || members.some(element => element.locked)) return;
    const currentRects = socialImageStackRects(current, autoTextHeights);
    const orderedIds = [...members]
      .sort((first, second) => {
        const firstRect = currentRects.get(first.id)
          || socialImageElementRect(first, current.width, current.height);
        const secondRect = currentRects.get(second.id)
          || socialImageElementRect(second, current.width, current.height);
        return direction === 'horizontal'
          ? firstRect.x - secondRect.x || firstRect.y - secondRect.y
          : firstRect.y - secondRect.y || firstRect.x - secondRect.x;
      })
      .map(element => element.id);
    const selectedSet = new Set(orderedIds);
    commit(templateValue => {
      const materialized = materializeSocialImageStacks(templateValue, autoTextHeights);
      const exactStack = materialized.stacks.find(stack =>
        stack.elementIds.length === selectedSet.size
        && stack.elementIds.every(elementId => selectedSet.has(elementId)));
      const overlappingStackIds = new Set(
        materialized.stacks
          .filter(stack => stack.elementIds.some(elementId => selectedSet.has(elementId)))
          .map(stack => stack.id),
      );
      const stackId = exactStack?.id || newEditorId('stack');
      const nextStack: SocialImageStack = {
        id: stackId,
        elementIds: orderedIds,
        direction,
        gap: selectionGap,
        align: exactStack?.align || 'start',
        anchor: exactStack?.anchor || 'center',
      };
      const withStack: SocialImageTemplate = {
        ...materialized,
        elements: materialized.elements.map(element => {
          const removePreviousGroup = element.groupId && overlappingStackIds.has(element.groupId);
          const base = removePreviousGroup
            ? (() => {
              const { groupId: _groupId, ...rest } = element;
              return rest as SocialImageElement;
            })()
            : element;
          return selectedSet.has(element.id) ? { ...base, groupId: stackId } : base;
        }),
        stacks: [
          ...materialized.stacks.filter(stack => !overlappingStackIds.has(stack.id)),
          nextStack,
        ],
      };
      return materializeSocialImageStacks(withStack, autoTextHeights);
    });
  }, [autoTextHeights, commit, selectedIds, selectionGap]);

  const removeSelectedStack = useCallback(() => {
    if (!activeStack) return;
    commit(current => {
      const materialized = materializeSocialImageStacks(current, autoTextHeights);
      return {
        ...materialized,
        elements: materialized.elements.map(element => {
          if (element.groupId !== activeStack.id) return element;
          const { groupId: _groupId, ...rest } = element;
          return rest as SocialImageElement;
        }),
        stacks: materialized.stacks.filter(stack => stack.id !== activeStack.id),
      };
    });
  }, [activeStack, autoTextHeights, commit]);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    commit(current => {
      const index = current.elements.findIndex(element => element.id === id);
      const targetIndex = direction === 'up' ? index + 1 : index - 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.elements.length) return current;
      const elements = [...current.elements];
      [elements[index], elements[targetIndex]] = [elements[targetIndex], elements[index]];
      return { ...current, elements };
    });
  }, [commit]);

  const toggleVisibility = useCallback((id: string) => {
    updateElements([id], element => ({ ...element, visible: !element.visible }));
  }, [updateElements]);

  const toggleLock = useCallback((id: string) => {
    updateElements([id], element => ({ ...element, locked: !element.locked }));
  }, [updateElements]);

  const nudgeSelected = useCallback((deltaX: number, deltaY: number) => {
    const movableIds = selectedUnits
      .filter(unit => !unit.locked)
      .flatMap(unit => unit.elements.map(element => element.id));
    if (!movableIds.length) return;
    const current = draftRef.current;
    updateElements(movableIds, element => {
      const rect = resolvedElementRect(
        element,
        current.width,
        current.height,
        autoTextHeights,
        stackRects,
      );
      return translateSocialImageElement(
        element,
        rect,
        deltaX,
        deltaY,
        current.width,
        current.height,
      );
    });
  }, [autoTextHeights, selectedUnits, stackRects, updateElements]);

  const alignSelected = useCallback((
    alignment: SelectionAlignment,
  ) => {
    const current = draftRef.current;
    const units = selectedUnits.filter(
      (unit): unit is GeometrySelectionUnit => Boolean(unit.bounds),
    );
    const bounds = selectionBoundsUnion(units.map(unit => unit.bounds));
    if (!bounds) return;
    const target = units.length === 1
      ? { x: 0, y: 0, width: current.width, height: current.height }
      : bounds;
    const deltas = new Map<string, { x: number; y: number }>();
    units.filter(unit => !unit.locked).forEach(unit => {
      let deltaX = 0;
      let deltaY = 0;
      if (alignment === 'left') {
        deltaX = target.x - unit.bounds.x;
      } else if (alignment === 'horizontal-center') {
        deltaX = target.x + target.width / 2 - (unit.bounds.x + unit.bounds.width / 2);
      } else if (alignment === 'right') {
        deltaX = target.x + target.width - (unit.bounds.x + unit.bounds.width);
      } else if (alignment === 'top') {
        deltaY = target.y - unit.bounds.y;
      } else if (alignment === 'vertical-center') {
        deltaY = target.y + target.height / 2 - (unit.bounds.y + unit.bounds.height / 2);
      } else {
        deltaY = target.y + target.height - (unit.bounds.y + unit.bounds.height);
      }
      unit.elements.forEach(element => deltas.set(element.id, { x: deltaX, y: deltaY }));
    });
    updateElements([...deltas.keys()], element => {
      const delta = deltas.get(element.id);
      if (!delta) return element;
      const rect = resolvedElementRect(
        element,
        current.width,
        current.height,
        autoTextHeights,
        stackRects,
      );
      return translateSocialImageElement(
        element,
        rect,
        delta.x,
        delta.y,
        current.width,
        current.height,
      );
    });
  }, [autoTextHeights, selectedUnits, stackRects, updateElements]);

  const distributeSelected = useCallback((axis: DistributionAxis) => {
    const current = draftRef.current;
    const units = selectedUnits
      .filter((unit): unit is GeometrySelectionUnit => Boolean(unit.bounds))
      .sort((first, second) => axis === 'horizontal'
        ? first.bounds.x - second.bounds.x || first.bounds.y - second.bounds.y
        : first.bounds.y - second.bounds.y || first.bounds.x - second.bounds.x);
    if (units.length < 3) return;
    const bounds = selectionBoundsUnion(units.map(unit => unit.bounds));
    if (!bounds) return;
    const totalSize = units.reduce(
      (sum, unit) => sum + (axis === 'horizontal' ? unit.bounds.width : unit.bounds.height),
      0,
    );
    const availableSize = axis === 'horizontal' ? bounds.width : bounds.height;
    const gap = (availableSize - totalSize) / (units.length - 1);
    let cursor = axis === 'horizontal' ? bounds.x : bounds.y;
    const deltas = new Map<string, { x: number; y: number }>();
    units.forEach(unit => {
      const delta = round(cursor - (axis === 'horizontal' ? unit.bounds.x : unit.bounds.y));
      if (!unit.locked) {
        unit.elements.forEach(element => deltas.set(element.id, axis === 'horizontal'
          ? { x: delta, y: 0 }
          : { x: 0, y: delta }));
      }
      cursor += (axis === 'horizontal' ? unit.bounds.width : unit.bounds.height) + gap;
    });
    updateElements([...deltas.keys()], element => {
      const delta = deltas.get(element.id);
      if (!delta) return element;
      const rect = resolvedElementRect(
        element,
        current.width,
        current.height,
        autoTextHeights,
        stackRects,
      );
      return translateSocialImageElement(
        element,
        rect,
        delta.x,
        delta.y,
        current.width,
        current.height,
      );
    });
    if (gap >= 0) setSelectionGap(round(gap));
  }, [autoTextHeights, selectedUnits, stackRects, updateElements]);

  const applySelectionGap = useCallback((axis: DistributionAxis) => {
    const current = draftRef.current;
    if (activeStack) {
      commit(templateValue => ({
        ...templateValue,
        stacks: templateValue.stacks.map(stack => stack.id === activeStack.id
          ? { ...stack, direction: axis, gap: selectionGap }
          : stack),
      }));
      return;
    }
    const units: GeometrySelectionUnit[] = selectedElements
      .filter(element => element.visible)
      .map(element => ({
        key: `element:${element.id}`,
        elements: [element],
        bounds: resolvedElementRect(
          element,
          current.width,
          current.height,
          autoTextHeights,
          stackRects,
        ),
        locked: element.locked,
      }))
      .sort((first, second) => axis === 'horizontal'
        ? first.bounds.x - second.bounds.x || first.bounds.y - second.bounds.y
        : first.bounds.y - second.bounds.y || first.bounds.x - second.bounds.x);
    if (units.length < 2) return;
    let cursor = axis === 'horizontal' ? units[0].bounds.x : units[0].bounds.y;
    const deltas = new Map<string, { x: number; y: number }>();
    units.forEach(unit => {
      const delta = round(cursor - (axis === 'horizontal' ? unit.bounds.x : unit.bounds.y));
      if (!unit.locked) {
        unit.elements.forEach(element => deltas.set(element.id, axis === 'horizontal'
          ? { x: delta, y: 0 }
          : { x: 0, y: delta }));
      }
      cursor += (axis === 'horizontal' ? unit.bounds.width : unit.bounds.height) + selectionGap;
    });
    updateElements([...deltas.keys()], element => {
      const delta = deltas.get(element.id);
      if (!delta) return element;
      const rect = resolvedElementRect(
        element,
        current.width,
        current.height,
        autoTextHeights,
        stackRects,
      );
      return translateSocialImageElement(
        element,
        rect,
        delta.x,
        delta.y,
        current.width,
        current.height,
      );
    });
  }, [
    activeStack,
    autoTextHeights,
    commit,
    selectedElements,
    selectionGap,
    stackRects,
    updateElements,
  ]);

  const changeSelectionGap = useCallback((value: number) => {
    setSelectionGap(value);
    if (!activeStack) return;
    commit(current => ({
      ...current,
      stacks: current.stacks.map(stack =>
        stack.id === activeStack.id ? { ...stack, gap: value } : stack),
    }));
  }, [activeStack, commit]);

  const finishGesture = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    if (socialImageTemplateSignature(gesture.before) !== socialImageTemplateSignature(draftRef.current)) {
      recordPrevious(gesture.before);
    }
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [recordPrevious]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      event.preventDefault();
      const clientDeltaX = event.clientX - gesture.startClientX;
      const clientDeltaY = event.clientY - gesture.startClientY;

      if (gesture.kind === 'move') {
        if (!gesture.activated) {
          if (Math.hypot(clientDeltaX, clientDeltaY) < 3) return;
          gesture.activated = true;
        }
        const deltaX = clientDeltaX / gesture.scale;
        const deltaY = clientDeltaY / gesture.scale;
        const idSet = new Set(gesture.elementIds);
        const next: SocialImageTemplate = {
          ...gesture.before,
          elements: gesture.before.elements.map(element => {
            const initial = gesture.initialRects.get(element.id);
            if (!idSet.has(element.id) || !initial) return element;
            return translateSocialImageElement(
              element,
              initial,
              deltaX,
              deltaY,
              gesture.before.width,
              gesture.before.height,
            );
          }),
        };
        setDraftLive(next);
        return;
      }

      const deltaX = clientDeltaX / gesture.scale;
      const deltaY = clientDeltaY / gesture.scale;
      const { bounds, corner } = gesture;
      const west = corner === 'nw' || corner === 'sw';
      const north = corner === 'nw' || corner === 'ne';
      const nextX = west ? Math.min(bounds.x + deltaX, bounds.x + bounds.width - MIN_ELEMENT_SIZE) : bounds.x;
      const nextY = north ? Math.min(bounds.y + deltaY, bounds.y + bounds.height - MIN_ELEMENT_SIZE) : bounds.y;
      const nextWidth = west
        ? bounds.x + bounds.width - nextX
        : Math.max(MIN_ELEMENT_SIZE, bounds.width + deltaX);
      const nextHeight = north
        ? bounds.y + bounds.height - nextY
        : Math.max(MIN_ELEMENT_SIZE, bounds.height + deltaY);
      const scaleX = nextWidth / bounds.width;
      const scaleY = nextHeight / bounds.height;
      const idSet = new Set(gesture.elementIds);
      const next: SocialImageTemplate = {
        ...gesture.before,
        elements: gesture.before.elements.map(element => {
          const initial = gesture.initialRects.get(element.id);
          if (!idSet.has(element.id) || !initial) return element;
          const nextElementWidth = round(clamp(
            initial.width * scaleX,
            MIN_ELEMENT_SIZE,
            SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
          ));
          const nextElementHeight = round(clamp(
            initial.height * scaleY,
            MIN_ELEMENT_SIZE,
            SOCIAL_IMAGE_MAX_ELEMENT_SIDE,
          ));
          if (gesture.selectionUnitCount === 1 && gesture.elementIds.length === 1) {
            const resizedFromAnchor = socialImageElementWithRect(
              element,
              {
                ...initial,
                width: nextElementWidth,
                height: nextElementHeight,
              },
              gesture.before.width,
              gesture.before.height,
            );
            return {
              ...resizedFromAnchor,
              // A single element grows from its authored pin. Its stored
              // offsets therefore remain stable while dimensions change.
              x: element.x,
              y: element.y,
              ...(element.type === 'text' && element.autoHeight
                ? { height: element.height, autoHeight: true }
                : {}),
            };
          }
          const resized = socialImageElementWithRect(
            element,
            {
              x: round(nextX + (initial.x - bounds.x) * scaleX),
              y: round(nextY + (initial.y - bounds.y) * scaleY),
              width: nextElementWidth,
              height: nextElementHeight,
            },
            gesture.before.width,
            gesture.before.height,
          );
          return resized;
        }),
      };
      setDraftLive(next);
    };
    const handlePointerUp = () => finishGesture();
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      gestureRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [finishGesture, setDraftLive]);

  const beginMove = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    element: SocialImageElement,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const current = draftRef.current;
    const groupedIds = element.groupId
      ? current.elements.filter(candidate => candidate.groupId === element.groupId).map(candidate => candidate.id)
      : [element.id];
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const removesClickedUnit = additive
      && groupedIds.every(id => selectedIds.includes(id));
    let nextSelection: string[];
    if (additive) {
      nextSelection = removesClickedUnit
        ? selectedIds.filter(id => !groupedIds.includes(id))
        : [...selectedIds.filter(id => !groupedIds.includes(id)), ...groupedIds];
    } else if (selectedIds.includes(element.id)) {
      nextSelection = selectedIds;
    } else {
      nextSelection = groupedIds;
    }
    if (!nextSelection.length && !removesClickedUnit) nextSelection = groupedIds;
    setSelectedIds(nextSelection);
    setInspectorMode(nextSelection.length ? 'element' : 'canvas');
    if (
      removesClickedUnit
      || current.elements.some(candidate => groupedIds.includes(candidate.id) && candidate.locked)
    ) return;
    const movable = buildSelectionUnits(
      current.elements,
      nextSelection,
      current.width,
      current.height,
      autoTextHeights,
      stackRects,
    )
      .filter(unit => !unit.locked)
      .flatMap(unit => unit.elements);
    if (!movable.length) return;
    gestureRef.current = {
      kind: 'move',
      before: current,
      elementIds: movable.map(candidate => candidate.id),
      startClientX: event.clientX,
      startClientY: event.clientY,
      scale: canvasScale,
      activated: false,
      initialRects: new Map(movable.map(candidate => [
        candidate.id,
        resolvedElementRect(
          candidate,
          current.width,
          current.height,
          autoTextHeights,
          stackRects,
        ),
      ])),
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'move';
  }, [autoTextHeights, canvasScale, selectedIds, stackRects]);

  const beginResize = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    corner: ResizeCorner,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const current = draftRef.current;
    const units = buildSelectionUnits(
      current.elements,
      selectedIds,
      current.width,
      current.height,
      autoTextHeights,
      stackRects,
    );
    const referenceUnits = units.filter(
      (unit): unit is GeometrySelectionUnit => Boolean(unit.bounds),
    );
    const resizable = referenceUnits
      .filter(unit => !unit.locked)
      .flatMap(unit => unit.elements);
    if (
      resizable.filter(element => element.visible).length > 1
      && resizable.some(element => element.visible && element.type === 'text' && element.autoHeight)
    ) return;
    const bounds = selectionBoundsUnion(referenceUnits.map(unit => unit.bounds));
    if (!bounds || !resizable.length) return;
    gestureRef.current = {
      kind: 'resize',
      before: current,
      elementIds: resizable.map(element => element.id),
      startClientX: event.clientX,
      startClientY: event.clientY,
      scale: canvasScale,
      corner,
      selectionUnitCount: referenceUnits.length,
      bounds,
      initialRects: new Map(resizable.map(element => [
        element.id,
        resolvedElementRect(
          element,
          current.width,
          current.height,
          autoTextHeights,
          stackRects,
        ),
      ])),
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = `${corner}-resize`;
  }, [autoTextHeights, canvasScale, selectedIds, stackRects]);

  const guidePositionFromPointer = useCallback((
    axis: DistributionAxis,
    clientX: number,
    clientY: number,
  ) => {
    const frame = canvasFrameRef.current;
    if (!frame) return 0;
    const rect = frame.getBoundingClientRect();
    return round(
      axis === 'vertical'
        ? (clientX - rect.left) / canvasScale
        : (clientY - rect.top) / canvasScale,
    );
  }, [canvasScale]);

  const beginGuideFromRuler = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    axis: DistributionAxis,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const guide: CanvasGuide = {
      id: newEditorId('guide'),
      axis,
      position: guidePositionFromPointer(axis, event.clientX, event.clientY),
    };
    setGuides(current => [...current, guide]);
    guideGestureRef.current = { id: guide.id, axis };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = axis === 'vertical' ? 'col-resize' : 'row-resize';
  }, [guidePositionFromPointer]);

  const beginGuideMove = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    guide: CanvasGuide,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    guideGestureRef.current = { id: guide.id, axis: guide.axis };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = guide.axis === 'vertical' ? 'col-resize' : 'row-resize';
  }, []);

  const removeGuide = useCallback((id: string) => {
    setGuides(current => current.filter(guide => guide.id !== id));
  }, []);

  useEffect(() => {
    const handleGuidePointerMove = (event: PointerEvent) => {
      const gesture = guideGestureRef.current;
      if (!gesture) return;
      event.preventDefault();
      const position = guidePositionFromPointer(
        gesture.axis,
        event.clientX,
        event.clientY,
      );
      setGuides(current => current.map(guide => guide.id === gesture.id
        ? { ...guide, position }
        : guide));
    };
    const finishGuideGesture = (event: PointerEvent) => {
      const gesture = guideGestureRef.current;
      if (!gesture) return;
      const position = guidePositionFromPointer(
        gesture.axis,
        event.clientX,
        event.clientY,
      );
      const limit = gesture.axis === 'vertical'
        ? draftRef.current.width
        : draftRef.current.height;
      setGuides(current => position < 0 || position > limit
        ? current.filter(guide => guide.id !== gesture.id)
        : current.map(guide => guide.id === gesture.id
          ? { ...guide, position: clamp(position, 0, limit) }
          : guide));
      guideGestureRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', handleGuidePointerMove, { passive: false });
    window.addEventListener('pointerup', finishGuideGesture);
    window.addEventListener('pointercancel', finishGuideGesture);
    return () => {
      window.removeEventListener('pointermove', handleGuidePointerMove);
      window.removeEventListener('pointerup', finishGuideGesture);
      window.removeEventListener('pointercancel', finishGuideGesture);
      guideGestureRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [guidePositionFromPointer]);

  useEffect(() => {
    setGuides(current => {
      const next = current.filter(guide => guide.position >= 0 && guide.position <= (
        guide.axis === 'vertical' ? draft.width : draft.height
      ));
      return next.length === current.length ? current : next;
    });
  }, [draft.height, draft.width]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected();
        else groupSelected();
        return;
      }
      if (modifier && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        zoomCanvas(1);
        return;
      }
      if (modifier && event.key === '-') {
        event.preventDefault();
        zoomCanvas(-1);
        return;
      }
      if (modifier && event.key === '0') {
        event.preventDefault();
        fitCanvas();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      const amount = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        nudgeSelected(-amount, 0);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        nudgeSelected(amount, 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        nudgeSelected(0, -amount);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        nudgeSelected(0, amount);
      } else if (event.key === 'Escape') {
        setSelectedIds([]);
        setInspectorMode('canvas');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    deleteSelected,
    duplicateSelected,
    fitCanvas,
    groupSelected,
    nudgeSelected,
    redo,
    undo,
    ungroupSelected,
    zoomCanvas,
  ]);

  const openMediaForBackground = useCallback(() => {
    setMediaTarget({ kind: 'background' });
    setMediaOpen(true);
  }, []);

  const openMediaForElement = useCallback((id: string) => {
    setMediaTarget({ kind: 'element', id });
    setMediaOpen(true);
  }, []);

  const selectMedia = useCallback((selectedMedia: Pick<WordPressMediaItem, 'id' | 'source_url'>) => {
    if (mediaTarget.kind === 'background') {
      commit(current => ({
        ...current,
        background: {
          ...current.background,
          image: selectedMedia.source_url,
          imageAttachmentId: selectedMedia.id,
        },
      }));
      return;
    }
    updateElements([mediaTarget.id], element => element.type === 'image'
      ? {
        ...element,
        source: selectedMedia.source_url,
        attachmentId: selectedMedia.id,
      }
      : element);
  }, [commit, mediaTarget, updateElements]);

  const authoredBackgroundImage = resolvedImageSource(draft.background.image, sampleVariables);
  const normalizedBackgroundImage = useSocialImageAssetPreview(authoredBackgroundImage, assetPreview);
  const layerPixelBudget = useMemo(
    () => socialImageLayerPixelBudget(
      draft.elements,
      draft.width,
      draft.height,
    ),
    [draft.elements, draft.height, draft.width],
  );
  const hasHistory = pastRef.current.length > 0;
  const hasFuture = futureRef.current.length > 0;
  void historyVersion;

  return (
    <div
      data-kodety-fullscreen-surface="social-image-builder"
      className="fixed inset-0 z-[100] flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label={`Social Image Builder · ${title}`}
    >
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-border/70 bg-background/95 px-2.5 shadow-sm backdrop-blur">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm">
              <Plus /> Adicionar <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={() => addElement('text')}><Type /> Adicionar texto</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addElement('image')}><ImageIcon /> Adicionar imagem</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addElement('shape')}><Square /> Adicionar forma</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addElement('icon')}><Sparkles /> Adicionar ícone</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/35 p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={undo}
            disabled={!hasHistory}
            aria-label="Desfazer"
            title="Desfazer · ⌘Z"
          >
            <Undo2 />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={redo}
            disabled={!hasFuture}
            aria-label="Refazer"
            title="Refazer · ⇧⌘Z"
          >
            <Redo2 />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!selectedIds.length}
              aria-label="Ações da seleção"
            >
              <MoreHorizontal /> <span className="hidden xl:inline">Ações</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={duplicateSelected}><Copy /> Duplicar · ⌘D</DropdownMenuItem>
            <DropdownMenuItem onSelect={groupSelected} disabled={selectedIds.length < 2}><Group /> Agrupar · ⌘G</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={ungroupSelected}
              disabled={!selectedElements.some(element => element.groupId)}
            >
              <Ungroup /> Desagrupar · ⇧⌘G
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={deleteSelected}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 /> Excluir seleção
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant={showRulers ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setShowRulers(current => !current)}
            aria-pressed={showRulers}
            aria-label="Alternar réguas e guias"
            title="Réguas e guias"
          >
            <Hash />
          </Button>
          <Button
            type="button"
            variant={showSafeArea ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setShowSafeArea(current => !current)}
            aria-pressed={showSafeArea}
            aria-label="Alternar área segura"
            title="Área segura · 5%"
          >
            <Scan />
          </Button>
          <div className="hidden items-center rounded-lg border border-border/60 bg-muted/35 p-0.5 sm:flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => zoomCanvas(-1)}
              aria-label="Diminuir zoom"
              title="Diminuir zoom · ⌘−"
            >
              <ZoomOut />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="min-w-14 px-1 font-mono text-[9px]"
              onClick={fitCanvas}
              aria-label="Ajustar canvas"
              title="Ajustar canvas · ⌘0"
            >
              <Maximize2 className="size-3" />
              {Math.round(canvasScale * 100)}%
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => zoomCanvas(1)}
              aria-label="Aumentar zoom"
              title="Aumentar zoom · ⌘+"
            >
              <ZoomIn />
            </Button>
          </div>
          {layerPixelBudget.rejectedElementIds.length > 0 && (
            <span
              className="flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-1 text-[9px] text-amber-300 xl:px-2"
              title={`O renderizador aceita até ${SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS.toLocaleString(getAdminUiLocale())} pixels somados. Reduza W/H ou remova camadas; as excedentes serão ignoradas ao salvar.`}
            >
              <AlertTriangle className="size-3" />
              <span className="hidden xl:inline">Limite de render</span>
            </span>
          )}
          <span className="hidden rounded-md bg-muted px-2 py-1 font-mono text-[9px] text-muted-foreground lg:inline">
            {draft.width} × {draft.height}
          </span>
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm('Desvincular este template? Ele continuará disponível na biblioteca.')) onDelete();
              }}
              aria-label="Desvincular template"
              title="Desvincular template"
            >
              <Trash2 />
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X /> <span className="hidden lg:inline">Fechar</span>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={preparingFontFiles > 0}
            title={preparingFontFiles > 0
              ? 'Aguarde a preparação da fonte do projeto'
              : 'Salvar Social Image'}
            onClick={() => {
              const normalized = normalizeSocialImageTemplate(
                materializeAutoTextHeights(draftRef.current),
              );
              setDraftLive(normalized);
              onSave(normalized);
            }}
          >
            <Save /> Salvar
          </Button>
        </div>
      </header>

      {selectedIds.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-[calc(50%_-_2rem)] z-[70] -translate-x-1/2">
          <SelectionToolbar
            selectedCount={selectedElements.length}
            movableCount={movableSelectedCount}
            gapMovableCount={gapMovableCount}
            activeStack={activeStack}
            gap={selectionGap}
            onGapChange={changeSelectionGap}
            onAlign={alignSelected}
            onDistribute={distributeSelected}
            onApplyGap={applySelectionGap}
            onStack={stackSelected}
            onRemoveStack={removeSelectedStack}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <LayersPanel
          elements={draft.elements}
          selectedIds={selectedIds}
          onSelect={selectElement}
          onToggleVisibility={toggleVisibility}
          onToggleLock={toggleLock}
          onMove={moveLayer}
        />

        <main
          ref={canvasViewportRef}
          className="relative flex min-w-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_center,hsl(var(--muted-foreground)/0.12)_1px,transparent_1px)] bg-[length:20px_20px] p-9"
          onPointerDown={event => {
            if (event.target !== event.currentTarget) return;
            setSelectedIds([]);
            setInspectorMode('canvas');
          }}
        >
          <div
            ref={canvasFrameRef}
            className="relative m-auto shrink-0 ring-1 ring-black/30"
            style={{ width: draft.width * canvasScale, height: draft.height * canvasScale }}
            onPointerDown={event => {
              if (event.target !== event.currentTarget) return;
              setSelectedIds([]);
              setInspectorMode('canvas');
            }}
          >
            {showRulers && (
              <CanvasRulers
                width={draft.width}
                height={draft.height}
                scale={canvasScale}
                selection={selectionBounds}
                guides={guides}
                onBeginGuide={beginGuideFromRuler}
              />
            )}
            <div
              className="absolute left-0 top-0 overflow-hidden"
              style={{
                ...canvasBackground(draft),
                width: draft.width,
                height: draft.height,
                transform: `scale(${canvasScale})`,
                transformOrigin: 'top left',
              }}
              onPointerDown={event => {
                if (event.target !== event.currentTarget) return;
                setSelectedIds([]);
                setInspectorMode('canvas');
              }}
            >
              {normalizedBackgroundImage && (
                <img
                  src={normalizedBackgroundImage}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 size-full"
                  style={{
                    objectFit: draft.background.imageFit,
                    opacity: draft.background.imageOpacity,
                  }}
                />
              )}
              {showSafeArea && (
                <div
                  className="pointer-events-none absolute border border-dashed border-white/55"
                  style={{
                    left: draft.width * 0.05,
                    top: draft.height * 0.05,
                    width: draft.width * 0.9,
                    height: draft.height * 0.9,
                    boxShadow: '0 0 0 1px rgba(0,0,0,.18)',
                  }}
                >
                  <span className="absolute left-1 top-1 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/75">
                    Área segura · 5%
                  </span>
                </div>
              )}
              {draft.elements.map(element => (
                <ElementVisual
                  key={element.id}
                  element={element}
                  canvasWidth={draft.width}
                  canvasHeight={draft.height}
                  variables={sampleVariables}
                  assetPreview={assetPreview}
                  interactive
                  interactionScale={canvasScale}
                  selected={selectedIds.includes(element.id)}
                  layoutRect={stackRects.get(element.id)}
                  onPointerDown={beginMove}
                  onAutoHeightChange={recordAutoTextHeight}
                />
              ))}
              {selectionBounds && (
                <div
                  className="pointer-events-none absolute border-solid border-[var(--kodety-accent)]"
                  style={{
                    left: selectionBounds.x,
                    top: selectionBounds.y,
                    width: selectionBounds.width,
                    height: selectionBounds.height,
                    borderWidth: 2 / canvasScale,
                    boxShadow: `0 0 0 ${1 / canvasScale}px rgba(255,255,255,.8)`,
                  }}
                >
                  {movableSelectedCount > 0 && !selectionHasGroupedAutoHeight && ([
                    'nw',
                    'ne',
                    'sw',
                    'se',
                  ] as ResizeCorner[]).map(corner => (
                    <button
                      key={corner}
                      type="button"
                      aria-label={`Redimensionar por ${corner}`}
                      className={cn(
                        'pointer-events-auto absolute border-solid border-[var(--kodety-accent)] bg-white shadow-sm',
                        corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
                      )}
                      style={{
                        width: 12 / canvasScale,
                        height: 12 / canvasScale,
                        borderWidth: 2 / canvasScale,
                        borderRadius: 3 / canvasScale,
                        top: corner.includes('n') ? -6 / canvasScale : undefined,
                        bottom: corner.includes('s') ? -6 / canvasScale : undefined,
                        left: corner.includes('w') ? -6 / canvasScale : undefined,
                        right: corner.includes('e') ? -6 / canvasScale : undefined,
                      }}
                      onPointerDown={event => beginResize(event, corner)}
                    />
                  ))}
                  {selectionHasGroupedAutoHeight && (
                    <span className="absolute left-1/2 top-1/2 w-max -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--kodety-accent-hover)]/30 bg-[linear-gradient(rgb(147_147_255/.14),rgb(147_147_255/.14)),rgb(20_20_22/.94)] px-2 py-1 text-[9px] font-medium text-[var(--kodety-accent-hover)] shadow backdrop-blur-sm">
                      Redimensione textos automáticos separadamente
                    </span>
                  )}
                </div>
              )}
            </div>
            {showRulers && (
              <CanvasGuides
                guides={guides}
                scale={canvasScale}
                onBeginGuide={beginGuideMove}
                onRemoveGuide={removeGuide}
              />
            )}
          </div>
          {!draft.elements.length && (
            <button
              type="button"
              className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-xl border border-dashed border-white/25 bg-black/25 px-6 py-5 text-white/70 backdrop-blur"
              onClick={() => addElement('text')}
            >
              <MousePointer2 className="size-5" />
              <span className="text-xs">Adicione o primeiro elemento</span>
            </button>
          )}
        </main>

        <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border/70 bg-background/97 shadow-[-8px_0_24px_rgba(0,0,0,0.06)]">
          <div className="grid h-12 shrink-0 grid-cols-2 gap-1 border-b border-border/70 bg-muted/20 p-1.5">
            <Button
              type="button"
              variant={inspectorMode === 'canvas' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setInspectorMode('canvas')}
            >
              <Square /> Canvas
            </Button>
            <Button
              type="button"
              variant={inspectorMode === 'element' ? 'secondary' : 'ghost'}
              size="xs"
              disabled={!primaryElement}
              onClick={() => setInspectorMode('element')}
            >
              <MousePointer2 /> Elemento
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {inspectorMode === 'element' && primaryElement ? (
              <ElementInspector
                element={primaryElement}
                selectedIds={selectedIds}
                canvasWidth={draft.width}
                canvasHeight={draft.height}
                autoTextHeights={autoTextHeights}
                variables={variables}
                projectFonts={projectFonts}
                onPrepareFontFile={onPrepareFontFile
                  ? prepareFontFileForInspector
                  : undefined}
                mediaAvailable={Boolean(media?.mediaUrl)}
                onUpdate={updateElements}
                onOpenMedia={openMediaForElement}
              />
            ) : (
              <CanvasInspector
                template={draft}
                variables={variables}
                mediaAvailable={Boolean(media?.mediaUrl)}
                onChange={commit}
                onOpenMedia={openMediaForBackground}
              />
            )}
          </div>
        </aside>
      </div>

      <WordPressMediaDialog
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        connection={media}
        onSelect={selectMedia}
      />
    </div>
  );
}
