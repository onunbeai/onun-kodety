import motionRuntimeSource from '../../node_modules/motion/dist/motion.js?raw';
import motionLicenseText from '../../licenses/MOTION-LICENSE.md?raw';
import motionEngineSource from './motion-runtime.js?raw';
import {
  getElementOuterHtml,
  patchElementAttribute,
} from './source-patcher';
import type { HtmlProject, SelectionSnapshot } from './types';

/**
 * Interaction definitions live in a project-owned document instead of being
 * serialized into each page's index.html. The page still receives a runtime
 * during preview/publication, but the editable source remains author code.
 */
export const INTERACTION_DOCUMENT_DIRECTORY = '.incode/animations';

/**
 * Pre-1.34 storage flattened and sanitized paths, which can collide
 * (`a/b.html` vs `a__b.html`, or `a b.html` vs `a-b.html`). Keep the legacy
 * resolver only for migration/read compatibility.
 */
export function legacyInteractionDocumentPath(htmlPath: string) {
  const safePath = htmlPath
    .replaceAll('\\', '/')
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/\//g, '__')
    .replace(/^[-.]+|[-.]+$/g, '') || 'index.html';
  return `${INTERACTION_DOCUMENT_DIRECTORY}/${safePath}.json`;
}

/**
 * Encode the complete normalized path into one reversible filename. Slashes
 * and literal percent signs receive distinct encodings, so two authored page
 * paths can never silently share the same animation document.
 */
function encodedInteractionDocumentName(htmlPath: string) {
  const normalized = htmlPath.replaceAll('\\', '/').replace(/^\/+/, '')
    || 'index.html';
  let wellFormed = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = normalized.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        wellFormed += normalized[index] + normalized[index + 1];
        index += 1;
      } else {
        wellFormed += '\uFFFD';
      }
    } else {
      wellFormed += code >= 0xDC00 && code <= 0xDFFF
        ? '\uFFFD'
        : normalized[index];
    }
  }
  const encoded = encodeURIComponent(wellFormed).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return encoded;
}

/**
 * A private page starts with `.incode/`. `encodeURIComponent` deliberately
 * leaves periods intact, which used to create a hidden filename such as
 * `.incode%2Fexperiments…json` inside the animations directory. WordPress
 * correctly rejects arbitrary hidden archive entries. Encode the leading dot
 * as data so the companion remains reversible without looking like a dotfile.
 */
export function interactionDocumentPath(htmlPath: string) {
  const encoded = encodedInteractionDocumentName(htmlPath);
  const safeName = encoded.startsWith('.') ? `%2E${encoded.slice(1)}` : encoded;
  return `${INTERACTION_DOCUMENT_DIRECTORY}/${safeName}.json`;
}

function legacyUnescapedInteractionDocumentPath(htmlPath: string) {
  return `${INTERACTION_DOCUMENT_DIRECTORY}/${encodedInteractionDocumentName(htmlPath)}.json`;
}

export function interactionDocumentPathCandidates(htmlPath: string) {
  return Array.from(new Set([
    interactionDocumentPath(htmlPath),
    legacyUnescapedInteractionDocumentPath(htmlPath),
    legacyInteractionDocumentPath(htmlPath),
  ]));
}

export type InteractionTrigger =
  | 'click'
  | 'click-start'
  | 'appear'
  | 'mouse-enter'
  | 'mouse-leave'
  | 'hover'
  | 'mouse-move'
  | 'load'
  | 'scroll'
  | 'custom';
export type InteractionTargetMode = 'element' | 'class' | 'selector';
export type InteractionTargetScope = 'document' | 'trigger' | 'children' | 'descendants' | 'parent' | 'closest' | 'siblings' | 'next' | 'previous';
export type InteractionActionKind = 'animate' | 'set' | 'class-add' | 'class-remove' | 'class-toggle' | 'variable' | 'component-variant' | 'lottie' | 'rive' | 'spline' | 'event';
export type InteractionTextSplit = 'none' | 'chars' | 'words' | 'lines';
export type InteractionBreakpoint = 'desktop' | 'tablet' | 'mobile';
export type InteractionReducedMotion = 'end' | 'skip' | 'allow';
export type InteractionBehaviorKind =
  | 'count-up'
  | 'magnetic'
  | 'text-roll'
  | 'ticker'
  | 'image-sequence'
  | 'video-scrub';
export type InteractionTextRollSplit = 'whole' | 'words' | 'chars';
export type InteractionTickerDirection = 'left' | 'right';
export type InteractionTickerHoverBehavior = 'none' | 'pause' | 'slow';

/** Ephemeral UI focus token; it is never serialized as an authored action ID. */
export const INTERACTION_ACTION_CATALOG_FOCUS_PREFIX =
  '__kodety_action_catalog_focus__:';

export interface InteractionKeyframe {
  id: string;
  time: number;
  values: Record<string, string | number | boolean>;
}

export interface InteractionActionTarget {
  selector: string;
  label: string;
  scope: InteractionTargetScope;
  mode: InteractionTargetMode;
}

export interface InteractionAction {
  id: string;
  name: string;
  kind: InteractionActionKind;
  target: InteractionActionTarget;
  start: number;
  duration: number;
  ease: string;
  from: Record<string, string | number | boolean>;
  to: Record<string, string | number | boolean>;
  keyframes: InteractionKeyframe[];
  repeat: number;
  repeatDelay: number;
  yoyo: boolean;
  stagger: number;
  staggerFrom: 'start' | 'center' | 'end' | 'edges' | 'random';
  textSplit: InteractionTextSplit;
  className: string;
  variableName: string;
  variableValue: string | number | boolean;
  eventName: string;
  inputName: string;
  inputValue: string | number | boolean;
  componentId: string;
  componentVariantId: string;
}

export interface InteractionScrollMilestone {
  id: string;
  selector: string;
  label: string;
  value: number;
  /** 0 = element top, .5 = center, 1 = bottom. */
  elementAnchor: number;
  /** 0 = viewport top, .5 = center, 1 = bottom. */
  viewportAnchor: number;
  offsetPx: number;
}

interface InteractionBehaviorBase {
  kind: InteractionBehaviorKind;
  target: InteractionActionTarget;
}

export interface InteractionCountUpBehavior extends InteractionBehaviorBase {
  kind: 'count-up';
  from: number;
  to: number;
  duration: number;
  decimals: number;
  prefix: string;
  suffix: string;
  locale: string;
  once: boolean;
}

export interface InteractionMagneticBehavior extends InteractionBehaviorBase {
  kind: 'magnetic';
  strength: number;
  radius: number;
  smoothing: number;
  returnDuration: number;
}

export interface InteractionTextRollBehavior extends InteractionBehaviorBase {
  kind: 'text-roll';
  split: InteractionTextRollSplit;
  duration: number;
  stagger: number;
  distance: number;
}

export interface InteractionTickerBehavior extends InteractionBehaviorBase {
  kind: 'ticker';
  direction: InteractionTickerDirection;
  speed: number;
  gap: number;
  hoverBehavior: InteractionTickerHoverBehavior;
  hoverSlowdown: number;
  hoverTransition: number;
  draggable: boolean;
  dragSensitivity: number;
  momentum: number;
}

export interface InteractionImageSequenceBehavior extends InteractionBehaviorBase {
  kind: 'image-sequence';
  urlTemplate: string;
  startIndex: number;
  endIndex: number;
  zeroPad: number;
  preloadRadius: number;
  viewportAnchor: number;
  milestones: InteractionScrollMilestone[];
}

export interface InteractionVideoScrubBehavior extends InteractionBehaviorBase {
  kind: 'video-scrub';
  startTime: number;
  endTime: number;
  smoothing: number;
  viewportAnchor: number;
  milestones: InteractionScrollMilestone[];
}

export type InteractionBehavior =
  | InteractionCountUpBehavior
  | InteractionMagneticBehavior
  | InteractionTextRollBehavior
  | InteractionTickerBehavior
  | InteractionImageSequenceBehavior
  | InteractionVideoScrubBehavior;

export interface InteractionDefinition {
  id: string;
  name: string;
  trigger: InteractionTrigger;
  triggerSelector: string;
  triggerLabel: string;
  triggerTargetMode: InteractionTargetMode;
  actions: InteractionAction[];
  enabled: boolean;
  repeat: number;
  yoyo: boolean;
  hoverInAction: 'play' | 'restart';
  hoverOutAction: 'reverse' | 'reset' | 'pause' | 'none';
  clickAction: 'toggle' | 'play' | 'restart' | 'reverse';
  mouseMoveAxis: 'x' | 'y' | 'both';
  mouseMoveReverse: boolean;
  mouseMoveSmoothing: number;
  scrollStart: string;
  scrollEnd: string;
  scrollScrub: boolean;
  scrollSmoothing: number;
  scrollToggleActions: string;
  /** Optional external section that drives this element's scroll timeline. */
  scrollTriggerSelector: string;
  scrollTriggerLabel: string;
  customEvent: string;
  /** User-authored animation body executed when the custom event fires. */
  customCode: string;
  reducedMotion: InteractionReducedMotion;
  enabledBreakpoints: InteractionBreakpoint[];
  /** Stable provenance for effects created from the official Library. */
  libraryEffectId: string;
  /** Stateful/continuous effects that cannot be represented as a plain timeline. */
  behavior: InteractionBehavior | null;
}

export interface InteractionDocument {
  version: 2;
  interactions: InteractionDefinition[];
  /** Marks an authoritative document stored at the collision-free path. */
  canonical?: true;
}

export type SavedInteractionDefinition = Omit<
  InteractionDefinition,
  'id' | 'triggerSelector' | 'triggerLabel' | 'triggerTargetMode'
>;

/**
 * A project/user-owned animation template with no binding to the element that
 * originally triggered it. Action targets outside that trigger remain intact.
 */
export interface SavedInteractionPreset {
  id: string;
  name: string;
  definition: SavedInteractionDefinition;
}

export interface InteractionKeyframeSelection {
  interactionId: string;
  actionId: string;
  keyframeId: string;
  keyframeIndex: number;
  keyframeCount: number;
  time: number;
  values: Record<string, string | number | boolean>;
}

export interface InteractionPropertyRequest {
  id: number;
  property: string;
  value: string | number;
}

export interface InteractionPropertyDefinition {
  key: string;
  label: string;
  group: InteractionPropertyGroup;
  type: 'number' | 'color' | 'length' | 'text';
  reset: string | number;
  unit?: string;
}

export type InteractionPropertyGroup =
  | 'Transform'
  | 'Layout'
  | 'Flex & Grid'
  | 'Size'
  | 'Position'
  | 'Spacing'
  | 'Typography'
  | 'Background'
  | 'Border'
  | 'Effects'
  | 'SVG'
  | 'Transitions';

export const INTERACTION_PROPERTY_GROUPS: InteractionPropertyGroup[] = [
  'Transform', 'Layout', 'Flex & Grid', 'Size', 'Position', 'Spacing',
  'Typography', 'Background', 'Border', 'Effects', 'SVG', 'Transitions',
];

export const INTERACTION_PROPERTIES: InteractionPropertyDefinition[] = [
  // Transform properties stored in the version 2 interaction document.
  { key: 'x', label: 'Move X', group: 'Transform', type: 'number', reset: 0, unit: 'px' },
  { key: 'y', label: 'Move Y', group: 'Transform', type: 'number', reset: 0, unit: 'px' },
  { key: 'z', label: 'Move Z', group: 'Transform', type: 'number', reset: 0, unit: 'px' },
  { key: 'xPercent', label: 'Move X %', group: 'Transform', type: 'number', reset: 0, unit: '%' },
  { key: 'yPercent', label: 'Move Y %', group: 'Transform', type: 'number', reset: 0, unit: '%' },
  { key: 'scale', label: 'Scale', group: 'Transform', type: 'number', reset: 1 },
  { key: 'scaleX', label: 'Scale X', group: 'Transform', type: 'number', reset: 1 },
  { key: 'scaleY', label: 'Scale Y', group: 'Transform', type: 'number', reset: 1 },
  { key: 'rotation', label: 'Rotate', group: 'Transform', type: 'number', reset: 0, unit: '°' },
  { key: 'rotationX', label: 'Rotate X', group: 'Transform', type: 'number', reset: 0, unit: '°' },
  { key: 'rotationY', label: 'Rotate Y', group: 'Transform', type: 'number', reset: 0, unit: '°' },
  { key: 'rotationZ', label: 'Rotate Z', group: 'Transform', type: 'number', reset: 0, unit: '°' },
  { key: 'skewX', label: 'Skew X', group: 'Transform', type: 'number', reset: 0, unit: '°' },
  { key: 'skewY', label: 'Skew Y', group: 'Transform', type: 'number', reset: 0, unit: '°' },
  { key: 'transformOrigin', label: 'Transform origin', group: 'Transform', type: 'text', reset: '50% 50%' },
  { key: 'transformPerspective', label: 'Transform perspective', group: 'Transform', type: 'number', reset: 0, unit: 'px' },
  { key: 'perspective', label: 'Perspective', group: 'Transform', type: 'length', reset: 'none' },
  { key: 'translate', label: 'CSS translate', group: 'Transform', type: 'text', reset: 'none' },
  { key: 'rotate', label: 'CSS rotate', group: 'Transform', type: 'text', reset: 'none' },
  { key: 'transformStyle', label: 'Transform style', group: 'Transform', type: 'text', reset: 'flat' },
  { key: 'backfaceVisibility', label: 'Backface visibility', group: 'Transform', type: 'text', reset: 'visible' },

  // Layout and visibility.
  { key: 'display', label: 'Display', group: 'Layout', type: 'text', reset: 'block' },
  { key: 'visibility', label: 'Visibility', group: 'Layout', type: 'text', reset: 'visible' },
  { key: 'pointerEvents', label: 'Pointer events', group: 'Layout', type: 'text', reset: 'auto' },
  { key: 'overflow', label: 'Overflow', group: 'Layout', type: 'text', reset: 'visible' },
  { key: 'overflowX', label: 'Overflow X', group: 'Layout', type: 'text', reset: 'visible' },
  { key: 'overflowY', label: 'Overflow Y', group: 'Layout', type: 'text', reset: 'visible' },
  { key: 'objectFit', label: 'Object fit', group: 'Layout', type: 'text', reset: 'fill' },
  { key: 'objectPosition', label: 'Object position', group: 'Layout', type: 'text', reset: '50% 50%' },
  { key: 'contain', label: 'Contain', group: 'Layout', type: 'text', reset: 'none' },
  { key: 'isolation', label: 'Isolation', group: 'Layout', type: 'text', reset: 'auto' },

  // Every Flex/Grid field in Design, plus child placement controls.
  { key: 'flexDirection', label: 'Flex direction', group: 'Flex & Grid', type: 'text', reset: 'row' },
  { key: 'flexWrap', label: 'Flex wrap', group: 'Flex & Grid', type: 'text', reset: 'nowrap' },
  { key: 'justifyContent', label: 'Justify content', group: 'Flex & Grid', type: 'text', reset: 'normal' },
  { key: 'alignItems', label: 'Align items', group: 'Flex & Grid', type: 'text', reset: 'normal' },
  { key: 'alignContent', label: 'Align content', group: 'Flex & Grid', type: 'text', reset: 'normal' },
  { key: 'alignSelf', label: 'Align self', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'justifySelf', label: 'Justify self', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'placeItems', label: 'Place items', group: 'Flex & Grid', type: 'text', reset: 'normal' },
  { key: 'placeContent', label: 'Place content', group: 'Flex & Grid', type: 'text', reset: 'normal' },
  { key: 'placeSelf', label: 'Place self', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gap', label: 'Gap', group: 'Flex & Grid', type: 'length', reset: '0px' },
  { key: 'rowGap', label: 'Row gap', group: 'Flex & Grid', type: 'length', reset: '0px' },
  { key: 'columnGap', label: 'Column gap', group: 'Flex & Grid', type: 'length', reset: '0px' },
  { key: 'flex', label: 'Flex', group: 'Flex & Grid', type: 'text', reset: '0 1 auto' },
  { key: 'flexBasis', label: 'Flex basis', group: 'Flex & Grid', type: 'length', reset: 'auto' },
  { key: 'flexGrow', label: 'Flex grow', group: 'Flex & Grid', type: 'number', reset: 0 },
  { key: 'flexShrink', label: 'Flex shrink', group: 'Flex & Grid', type: 'number', reset: 1 },
  { key: 'order', label: 'Order', group: 'Flex & Grid', type: 'number', reset: 0 },
  { key: 'gridTemplateColumns', label: 'Grid columns', group: 'Flex & Grid', type: 'text', reset: 'none' },
  { key: 'gridTemplateRows', label: 'Grid rows', group: 'Flex & Grid', type: 'text', reset: 'none' },
  { key: 'gridTemplateAreas', label: 'Grid areas', group: 'Flex & Grid', type: 'text', reset: 'none' },
  { key: 'gridAutoColumns', label: 'Grid auto columns', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gridAutoRows', label: 'Grid auto rows', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gridAutoFlow', label: 'Grid auto flow', group: 'Flex & Grid', type: 'text', reset: 'row' },
  { key: 'gridColumn', label: 'Grid column', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gridRow', label: 'Grid row', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gridColumnStart', label: 'Grid column start', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gridColumnEnd', label: 'Grid column end', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gridRowStart', label: 'Grid row start', group: 'Flex & Grid', type: 'text', reset: 'auto' },
  { key: 'gridRowEnd', label: 'Grid row end', group: 'Flex & Grid', type: 'text', reset: 'auto' },

  // Sizing.
  { key: 'width', label: 'Width', group: 'Size', type: 'length', reset: 'auto' },
  { key: 'height', label: 'Height', group: 'Size', type: 'length', reset: 'auto' },
  { key: 'minWidth', label: 'Min width', group: 'Size', type: 'length', reset: '0px' },
  { key: 'minHeight', label: 'Min height', group: 'Size', type: 'length', reset: '0px' },
  { key: 'maxWidth', label: 'Max width', group: 'Size', type: 'length', reset: 'none' },
  { key: 'maxHeight', label: 'Max height', group: 'Size', type: 'length', reset: 'none' },
  { key: 'aspectRatio', label: 'Aspect ratio', group: 'Size', type: 'text', reset: 'auto' },
  { key: 'boxSizing', label: 'Box sizing', group: 'Size', type: 'text', reset: 'content-box' },

  // Positioning.
  { key: 'position', label: 'Position', group: 'Position', type: 'text', reset: 'static' },
  { key: 'top', label: 'Top', group: 'Position', type: 'length', reset: 'auto' },
  { key: 'right', label: 'Right', group: 'Position', type: 'length', reset: 'auto' },
  { key: 'bottom', label: 'Bottom', group: 'Position', type: 'length', reset: 'auto' },
  { key: 'left', label: 'Left', group: 'Position', type: 'length', reset: 'auto' },
  { key: 'inset', label: 'Inset', group: 'Position', type: 'text', reset: 'auto' },
  { key: 'zIndex', label: 'Z index', group: 'Position', type: 'number', reset: 0 },
  { key: 'offsetPath', label: 'Motion path', group: 'Position', type: 'text', reset: 'none' },
  { key: 'offsetDistance', label: 'Path distance', group: 'Position', type: 'length', reset: '0%' },
  { key: 'offsetRotate', label: 'Path rotation', group: 'Position', type: 'text', reset: 'auto' },

  // Spacing.
  { key: 'margin', label: 'Margin', group: 'Spacing', type: 'text', reset: '0px' },
  { key: 'marginTop', label: 'Margin top', group: 'Spacing', type: 'length', reset: '0px' },
  { key: 'marginRight', label: 'Margin right', group: 'Spacing', type: 'length', reset: '0px' },
  { key: 'marginBottom', label: 'Margin bottom', group: 'Spacing', type: 'length', reset: '0px' },
  { key: 'marginLeft', label: 'Margin left', group: 'Spacing', type: 'length', reset: '0px' },
  { key: 'padding', label: 'Padding', group: 'Spacing', type: 'text', reset: '0px' },
  { key: 'paddingTop', label: 'Padding top', group: 'Spacing', type: 'length', reset: '0px' },
  { key: 'paddingRight', label: 'Padding right', group: 'Spacing', type: 'length', reset: '0px' },
  { key: 'paddingBottom', label: 'Padding bottom', group: 'Spacing', type: 'length', reset: '0px' },
  { key: 'paddingLeft', label: 'Padding left', group: 'Spacing', type: 'length', reset: '0px' },

  // Typography.
  { key: 'color', label: 'Text color', group: 'Typography', type: 'color', reset: '#000000' },
  { key: 'fontFamily', label: 'Font family', group: 'Typography', type: 'text', reset: 'inherit' },
  { key: 'fontSize', label: 'Font size', group: 'Typography', type: 'length', reset: '16px' },
  { key: 'fontWeight', label: 'Font weight', group: 'Typography', type: 'number', reset: 400 },
  { key: 'fontStyle', label: 'Font style', group: 'Typography', type: 'text', reset: 'normal' },
  { key: 'fontStretch', label: 'Font stretch', group: 'Typography', type: 'text', reset: 'normal' },
  { key: 'lineHeight', label: 'Line height', group: 'Typography', type: 'text', reset: 'normal' },
  { key: 'letterSpacing', label: 'Letter spacing', group: 'Typography', type: 'length', reset: '0px' },
  { key: 'textAlign', label: 'Text align', group: 'Typography', type: 'text', reset: 'start' },
  { key: 'textTransform', label: 'Text transform', group: 'Typography', type: 'text', reset: 'none' },
  { key: 'textDecoration', label: 'Text decoration', group: 'Typography', type: 'text', reset: 'none' },
  { key: 'textDecorationColor', label: 'Decoration color', group: 'Typography', type: 'color', reset: '#000000' },
  { key: 'textDecorationThickness', label: 'Decoration thickness', group: 'Typography', type: 'length', reset: 'auto' },
  { key: 'textUnderlineOffset', label: 'Underline offset', group: 'Typography', type: 'length', reset: 'auto' },
  { key: 'textIndent', label: 'Text indent', group: 'Typography', type: 'length', reset: '0px' },
  { key: 'textShadow', label: 'Text shadow', group: 'Typography', type: 'text', reset: 'none' },
  { key: 'whiteSpace', label: 'White space', group: 'Typography', type: 'text', reset: 'normal' },
  { key: 'wordBreak', label: 'Word break', group: 'Typography', type: 'text', reset: 'normal' },
  { key: 'overflowWrap', label: 'Overflow wrap', group: 'Typography', type: 'text', reset: 'normal' },
  { key: 'textOverflow', label: 'Text overflow', group: 'Typography', type: 'text', reset: 'clip' },
  { key: 'verticalAlign', label: 'Vertical align', group: 'Typography', type: 'text', reset: 'baseline' },
  { key: 'WebkitLineClamp', label: 'Line clamp', group: 'Typography', type: 'number', reset: 0 },

  // Background.
  { key: 'backgroundColor', label: 'Background color', group: 'Background', type: 'color', reset: '#ffffff' },
  { key: 'backgroundImage', label: 'Background image / gradient', group: 'Background', type: 'text', reset: 'none' },
  { key: 'backgroundPosition', label: 'Background position', group: 'Background', type: 'text', reset: '0% 0%' },
  { key: 'backgroundSize', label: 'Background size', group: 'Background', type: 'text', reset: 'auto' },
  { key: 'backgroundRepeat', label: 'Background repeat', group: 'Background', type: 'text', reset: 'repeat' },
  { key: 'backgroundAttachment', label: 'Background attachment', group: 'Background', type: 'text', reset: 'scroll' },
  { key: 'backgroundOrigin', label: 'Background origin', group: 'Background', type: 'text', reset: 'padding-box' },
  { key: 'backgroundClip', label: 'Background clip', group: 'Background', type: 'text', reset: 'border-box' },
  { key: 'backgroundBlendMode', label: 'Background blend', group: 'Background', type: 'text', reset: 'normal' },

  // Border and outline.
  { key: 'borderColor', label: 'Border color', group: 'Border', type: 'color', reset: '#000000' },
  { key: 'borderStyle', label: 'Border style', group: 'Border', type: 'text', reset: 'none' },
  { key: 'borderWidth', label: 'Border width', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderTopWidth', label: 'Border top width', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderRightWidth', label: 'Border right width', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderBottomWidth', label: 'Border bottom width', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderLeftWidth', label: 'Border left width', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderTopColor', label: 'Border top color', group: 'Border', type: 'color', reset: '#000000' },
  { key: 'borderRightColor', label: 'Border right color', group: 'Border', type: 'color', reset: '#000000' },
  { key: 'borderBottomColor', label: 'Border bottom color', group: 'Border', type: 'color', reset: '#000000' },
  { key: 'borderLeftColor', label: 'Border left color', group: 'Border', type: 'color', reset: '#000000' },
  { key: 'borderRadius', label: 'Border radius', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderTopLeftRadius', label: 'Top left radius', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderTopRightRadius', label: 'Top right radius', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderBottomRightRadius', label: 'Bottom right radius', group: 'Border', type: 'length', reset: '0px' },
  { key: 'borderBottomLeftRadius', label: 'Bottom left radius', group: 'Border', type: 'length', reset: '0px' },
  { key: 'outlineColor', label: 'Outline color', group: 'Border', type: 'color', reset: '#000000' },
  { key: 'outlineStyle', label: 'Outline style', group: 'Border', type: 'text', reset: 'none' },
  { key: 'outlineWidth', label: 'Outline width', group: 'Border', type: 'length', reset: '0px' },
  { key: 'outlineOffset', label: 'Outline offset', group: 'Border', type: 'length', reset: '0px' },

  // Visual effects.
  { key: 'opacity', label: 'Opacity', group: 'Effects', type: 'number', reset: 1 },
  { key: 'filter', label: 'Filter / blur', group: 'Effects', type: 'text', reset: 'none' },
  { key: 'backdropFilter', label: 'Backdrop filter', group: 'Effects', type: 'text', reset: 'none' },
  { key: 'boxShadow', label: 'Box shadow', group: 'Effects', type: 'text', reset: 'none' },
  { key: 'clipPath', label: 'Clip path', group: 'Effects', type: 'text', reset: 'inset(0%)' },
  { key: 'maskImage', label: 'Mask image', group: 'Effects', type: 'text', reset: 'none' },
  { key: 'maskPosition', label: 'Mask position', group: 'Effects', type: 'text', reset: '0% 0%' },
  { key: 'maskSize', label: 'Mask size', group: 'Effects', type: 'text', reset: 'auto' },
  { key: 'maskRepeat', label: 'Mask repeat', group: 'Effects', type: 'text', reset: 'repeat' },
  { key: 'mixBlendMode', label: 'Blend mode', group: 'Effects', type: 'text', reset: 'normal' },
  { key: 'cursor', label: 'Cursor', group: 'Effects', type: 'text', reset: 'auto' },
  { key: 'userSelect', label: 'User select', group: 'Effects', type: 'text', reset: 'auto' },
  { key: 'appearance', label: 'Appearance', group: 'Effects', type: 'text', reset: 'auto' },
  { key: 'accentColor', label: 'Accent color', group: 'Effects', type: 'color', reset: '#000000' },
  { key: 'caretColor', label: 'Caret color', group: 'Effects', type: 'color', reset: '#000000' },

  // SVG presentation.
  { key: 'fill', label: 'Fill', group: 'SVG', type: 'color', reset: '#000000' },
  { key: 'fillOpacity', label: 'Fill opacity', group: 'SVG', type: 'number', reset: 1 },
  { key: 'stroke', label: 'Stroke', group: 'SVG', type: 'color', reset: '#000000' },
  { key: 'strokeWidth', label: 'Stroke width', group: 'SVG', type: 'length', reset: '1px' },
  { key: 'strokeOpacity', label: 'Stroke opacity', group: 'SVG', type: 'number', reset: 1 },
  { key: 'strokeDasharray', label: 'Stroke dash array', group: 'SVG', type: 'text', reset: 'none' },
  { key: 'strokeDashoffset', label: 'Stroke dash offset', group: 'SVG', type: 'length', reset: '0px' },

  // Design's transition fields are useful for Set actions and class combos.
  { key: 'transitionProperty', label: 'Transition property', group: 'Transitions', type: 'text', reset: 'all' },
  { key: 'transitionDuration', label: 'Transition duration', group: 'Transitions', type: 'text', reset: '0s' },
  { key: 'transitionTimingFunction', label: 'Transition easing', group: 'Transitions', type: 'text', reset: 'ease' },
  { key: 'transitionDelay', label: 'Transition delay', group: 'Transitions', type: 'text', reset: '0s' },
];

const PROPERTY_MAP = new Map(INTERACTION_PROPERTIES.map(property => [property.key, property]));

export function interactionProperty(key: string): InteractionPropertyDefinition {
  return PROPERTY_MAP.get(key) || { key, label: key, group: 'Effects', type: 'text', reset: '' };
}

export function interactionResetValue(key: string): string | number {
  return PROPERTY_MAP.get(key)?.reset ?? 0;
}

export function cssPropertyToInteraction(property: string) {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function interactionPropertyToCss(property: string) {
  return property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const EMPTY_INTERACTION_DOCUMENT: InteractionDocument = { version: 2, interactions: [] };

export const DEFAULT_INTERACTION: Omit<InteractionDefinition, 'id' | 'name' | 'trigger' | 'triggerSelector' | 'triggerLabel' | 'triggerTargetMode'> = {
  actions: [], enabled: true, repeat: 0, yoyo: false,
  hoverInAction: 'restart', hoverOutAction: 'reverse', clickAction: 'toggle',
  mouseMoveAxis: 'both', mouseMoveReverse: true, mouseMoveSmoothing: 0.18,
  scrollStart: 'top 80%', scrollEnd: 'bottom 20%', scrollScrub: false,
  scrollSmoothing: 0, scrollToggleActions: 'play none none reverse',
  scrollTriggerSelector: '', scrollTriggerLabel: 'Animated element',
  customEvent: 'kodety-interaction', customCode: '', reducedMotion: 'end',
  enabledBreakpoints: ['desktop', 'tablet', 'mobile'],
  libraryEffectId: '', behavior: null,
};

const CUSTOM_INTERACTION_CODE_START = '/* kodety:animation:start */';
const CUSTOM_INTERACTION_CODE_END = '/* kodety:animation:end */';
const CUSTOM_INTERACTION_CODE_PLACEHOLDER = '// Add your animation here.';

function indentCustomInteractionCode(source: string) {
  return source.split('\n').map(line => `    ${line}`).join('\n');
}

/**
 * Builds the editable custom-event scaffold while keeping selector/event lines
 * managed by the inspector. Only customCode is persisted from this view.
 */
export function customInteractionCodeScaffold(
  interaction: Pick<InteractionDefinition, 'triggerSelector' | 'customEvent' | 'customCode'>,
) {
  const selector = interaction.triggerSelector.trim() || 'body';
  const eventName = interaction.customEvent.trim() || DEFAULT_INTERACTION.customEvent;
  const body = interaction.customCode || CUSTOM_INTERACTION_CODE_PLACEHOLDER;
  return `const elements = document.querySelectorAll(${JSON.stringify(selector)});

document.addEventListener(${JSON.stringify(eventName)}, (event) => {
  elements.forEach((element) => {
    ${CUSTOM_INTERACTION_CODE_START}
${indentCustomInteractionCode(body)}
    ${CUSTOM_INTERACTION_CODE_END}
  });
});`;
}

/** Extracts only the author-owned body from the managed scaffold. */
export function customInteractionCodeBody(source: string, fallback = '') {
  const start = source.indexOf(CUSTOM_INTERACTION_CODE_START);
  const end = source.indexOf(
    CUSTOM_INTERACTION_CODE_END,
    start + CUSTOM_INTERACTION_CODE_START.length,
  );
  if (start < 0 || end < 0) return fallback;
  const managedBody = source
    .slice(start + CUSTOM_INTERACTION_CODE_START.length, end)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n[ \t]*$/, '');
  return managedBody
    .split(/\r?\n/)
    .map(line => line.startsWith('    ') ? line.slice(4) : line)
    .join('\n');
}

export const DEFAULT_ACTION_TARGET: InteractionActionTarget = {
  selector: '', label: 'Trigger element', scope: 'trigger', mode: 'element',
};

export function createInteractionAction(kind: InteractionActionKind = 'animate', target: Partial<InteractionActionTarget> = {}): InteractionAction {
  const actionId = id('action');
  return {
    id: actionId,
    name: kind === 'animate' ? 'Custom animation' : kind === 'set' ? 'Set values' : kind.replace('-', ' '),
    kind,
    target: { ...DEFAULT_ACTION_TARGET, ...target },
    start: 0, duration: kind === 'set' ? 0 : 0.5, ease: 'power1.out',
    from: {}, to: kind === 'animate' ? { opacity: 1 } : {},
    keyframes: [], repeat: 0, repeatDelay: 0, yoyo: false,
    stagger: 0, staggerFrom: 'start', textSplit: 'none',
    className: '', variableName: '--motion-value', variableValue: 1,
    eventName: 'kodety-action', inputName: '', inputValue: true,
    componentId: '', componentVariantId: '',
  };
}

export interface InteractionPreset {
  id: string;
  label: string;
  group: 'Basic' | 'Slide' | 'Scale' | 'Stagger';
  from: Record<string, string | number | boolean>;
  to: Record<string, string | number | boolean>;
  duration: number;
  ease: string;
  stagger?: number;
  staggerFrom?: InteractionAction['staggerFrom'];
}

export const INTERACTION_PRESETS: InteractionPreset[] = [
  { id: 'fade-in', label: 'Fade in', group: 'Basic', from: { opacity: 0 }, to: { opacity: 1 }, duration: 0.5, ease: 'power1.out' },
  { id: 'fade-out', label: 'Fade out', group: 'Basic', from: { opacity: 1 }, to: { opacity: 0 }, duration: 0.5, ease: 'power1.out' },
  { id: 'slide-left', label: 'Slide in left', group: 'Slide', from: { opacity: 0, x: -64 }, to: { opacity: 1, x: 0 }, duration: 0.55, ease: 'power2.out' },
  { id: 'slide-right', label: 'Slide out right', group: 'Slide', from: { opacity: 1, x: 0 }, to: { opacity: 0, x: 64 }, duration: 0.55, ease: 'power2.in' },
  { id: 'slide-up', label: 'Slide in up', group: 'Slide', from: { opacity: 0, y: 64 }, to: { opacity: 1, y: 0 }, duration: 0.55, ease: 'power2.out' },
  { id: 'slide-down', label: 'Slide out down', group: 'Slide', from: { opacity: 1, y: 0 }, to: { opacity: 0, y: 64 }, duration: 0.55, ease: 'power2.in' },
  { id: 'scale-in', label: 'Scale in', group: 'Scale', from: { opacity: 0, scale: 0.75 }, to: { opacity: 1, scale: 1 }, duration: 0.45, ease: 'back.out(1.5)' },
  { id: 'pop-in', label: 'Pop in', group: 'Scale', from: { opacity: 0, scale: 0.4 }, to: { opacity: 1, scale: 1 }, duration: 0.55, ease: 'back.out(2)' },
  { id: 'drop-in', label: 'Drop in', group: 'Scale', from: { opacity: 0, y: -90, scale: 0.85 }, to: { opacity: 1, y: 0, scale: 1 }, duration: 0.65, ease: 'bounce.out' },
  { id: 'stagger-fade-in', label: 'Stagger fade in', group: 'Stagger', from: { opacity: 0 }, to: { opacity: 1 }, duration: 0.45, ease: 'power1.out', stagger: 0.08 },
  { id: 'stagger-fade-out', label: 'Stagger fade out', group: 'Stagger', from: { opacity: 1 }, to: { opacity: 0 }, duration: 0.45, ease: 'power1.out', stagger: 0.08 },
  { id: 'stagger-drop-in', label: 'Stagger drop in', group: 'Stagger', from: { opacity: 0, y: -48 }, to: { opacity: 1, y: 0 }, duration: 0.55, ease: 'back.out(1.4)', stagger: 0.09 },
  { id: 'stagger-fall-out', label: 'Stagger fall out', group: 'Stagger', from: { opacity: 1, y: 0 }, to: { opacity: 0, y: 64 }, duration: 0.5, ease: 'power2.in', stagger: 0.08 },
  { id: 'random-stagger', label: 'Random stagger', group: 'Stagger', from: { opacity: 0, scale: 0.8 }, to: { opacity: 1, scale: 1 }, duration: 0.5, ease: 'power2.out', stagger: 0.08, staggerFrom: 'random' },
];

export function actionFromPreset(presetId: string, target: Partial<InteractionActionTarget> = {}): InteractionAction {
  const preset = INTERACTION_PRESETS.find(item => item.id === presetId) || INTERACTION_PRESETS[0];
  return {
    ...createInteractionAction('animate', target),
    name: preset.label,
    from: { ...preset.from },
    to: { ...preset.to },
    duration: preset.duration,
    ease: preset.ease,
    stagger: preset.stagger || 0,
    staggerFrom: preset.staggerFrom || 'start',
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseEncoded(value: string | undefined) {
  if (!value) return null;
  try { return JSON.parse(decodeURIComponent(value)) as unknown; } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && values.includes(value as T)
    ? value as T
    : fallback;
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function interactionScalar(
  value: unknown,
  fallback: string | number | boolean,
): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function normalizeInteractionValues(
  value: unknown,
): Record<string, string | number | boolean> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, string | number | boolean> = {};
  Object.entries(value).forEach(([key, entry]) => {
    // Early Interactions builds stored the visual blur control as a standalone
    // `blur` key. GSAP has no such CSS property; keep old documents working by
    // migrating that value to the canonical filter syntax below.
    if (key === 'blur') return;
    if (typeof entry === 'string' || typeof entry === 'boolean') {
      normalized[key] = entry;
    } else if (typeof entry === 'number' && Number.isFinite(entry)) {
      normalized[key] = entry;
    }
  });
  if (!Object.prototype.hasOwnProperty.call(normalized, 'filter')) {
    const legacyBlur = value.blur;
    if (typeof legacyBlur === 'number' && Number.isFinite(legacyBlur)) {
      normalized.filter = `blur(${Math.max(0, legacyBlur)}px)`;
    } else if (typeof legacyBlur === 'string') {
      const blur = legacyBlur.trim();
      if (blur === 'none' || /^blur\(.+\)$/i.test(blur)) {
        normalized.filter = blur;
      } else if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax|%)?$/i.test(blur)) {
        normalized.filter = `blur(${/[a-z%]$/i.test(blur) ? blur : `${blur}px`})`;
      }
    }
  }
  return normalized;
}

const INTERACTION_TRIGGERS: readonly InteractionTrigger[] = [
  'click', 'click-start', 'appear', 'mouse-enter', 'mouse-leave', 'hover',
  'mouse-move', 'load', 'scroll', 'custom',
];
const INTERACTION_TARGET_MODES: readonly InteractionTargetMode[] = [
  'element', 'class', 'selector',
];
const INTERACTION_TARGET_SCOPES: readonly InteractionTargetScope[] = [
  'document', 'trigger', 'children', 'descendants', 'parent', 'closest',
  'siblings', 'next', 'previous',
];
const INTERACTION_ACTION_KINDS: readonly InteractionActionKind[] = [
  'animate', 'set', 'class-add', 'class-remove', 'class-toggle', 'variable',
  'component-variant', 'lottie', 'rive', 'spline', 'event',
];
const INTERACTION_TEXT_SPLITS: readonly InteractionTextSplit[] = [
  'none', 'chars', 'words', 'lines',
];
const INTERACTION_BREAKPOINTS: readonly InteractionBreakpoint[] = [
  'desktop', 'tablet', 'mobile',
];
const INTERACTION_BEHAVIOR_KINDS: readonly InteractionBehaviorKind[] = [
  'count-up', 'magnetic', 'text-roll', 'ticker', 'image-sequence', 'video-scrub',
];

export function normalizeInteractionRepeat(value: unknown) {
  const repeat = Number(value);
  if (!Number.isFinite(repeat)) return 0;
  if (repeat === -1) return -1;
  return Math.max(0, Math.floor(repeat));
}

function normalizeNonNegativeTiming(value: unknown, fallback = 0) {
  const timing = Number(value);
  return Number.isFinite(timing) ? Math.max(0, timing) : fallback;
}

const INTERACTION_ELEMENT_LABEL_TAGS = new Set([
  'a', 'article', 'aside', 'audio', 'body', 'button', 'canvas', 'div',
  'figure', 'footer', 'form', 'header', 'img', 'input', 'label', 'li',
  'main', 'nav', 'ol', 'option', 'p', 'picture', 'section', 'select',
  'source', 'span', 'svg', 'table', 'tbody', 'td', 'textarea', 'tfoot',
  'th', 'thead', 'tr', 'ul', 'video',
]);

function interactionElementLabel(label: string) {
  const normalized = label.trim();
  return (
    normalized.startsWith('#')
    || normalized.startsWith('.')
    || INTERACTION_ELEMENT_LABEL_TAGS.has(normalized.toLowerCase())
  );
}

function simpleClassSelector(selector: string) {
  const normalized = selector.trim();
  if (!normalized.startsWith('.')) return '';
  const identifier = cssIdentifierAt(normalized, 1);
  return identifier.value && identifier.end === normalized.length
    ? identifier.value
    : '';
}

/**
 * Reconciles a persisted target mode with the selector that will actually run.
 *
 * Older/imported documents can declare `element` while carrying an explicit
 * CSS selector (or `class` while carrying a compound selector). Keep explicit
 * Selector choices sticky, but repair incompatible declarations so opening,
 * previewing or publishing an interaction never depends on manually toggling
 * the segmented control first.
 */
export function inferInteractionTargetMode(
  selector: string,
  label: string,
  declaredMode: InteractionTargetMode,
  scope: InteractionTargetScope = 'document',
): InteractionTargetMode {
  const normalized = selector.trim();
  if (!normalized) {
    return scope === 'trigger' ? 'element' : declaredMode;
  }
  if (declaredMode === 'selector') return 'selector';

  const className = simpleClassSelector(normalized);
  if (className) return 'class';
  if (declaredMode === 'class') return 'selector';

  const identity = stableSelectorIdentity(normalized);
  if (identity.startsWith('data-kodety-interaction-id\u0000')) {
    const interactionId = identity.slice(identity.indexOf('\u0000') + 1);
    const generatedElementId = /^element-[a-z0-9]+-[a-z0-9]{5}$/i.test(
      interactionId,
    );
    if (generatedElementId || interactionElementLabel(label)) {
      return 'element';
    }
  }
  return 'selector';
}

function normalizeActionTarget(raw: unknown): InteractionActionTarget {
  const value = isRecord(raw) ? raw : {};
  const scope = enumValue(
    value.scope,
    INTERACTION_TARGET_SCOPES,
    DEFAULT_ACTION_TARGET.scope,
  );
  const selector = stringValue(value.selector, DEFAULT_ACTION_TARGET.selector);
  const label = stringValue(
    value.label,
    scope === 'trigger' ? DEFAULT_ACTION_TARGET.label : selector,
  );
  const declaredMode = enumValue(
    value.mode,
    INTERACTION_TARGET_MODES,
    DEFAULT_ACTION_TARGET.mode,
  );
  return {
    selector,
    label,
    scope,
    mode: inferInteractionTargetMode(selector, label, declaredMode, scope),
  };
}

function normalizeScrollMilestone(
  raw: unknown,
  index: number,
): InteractionScrollMilestone | null {
  const value = isRecord(raw) ? raw : {};
  const selector = stringValue(value.selector).trim();
  if (!selector) return null;
  return {
    id: stringValue(value.id).trim() || `milestone-${index + 1}`,
    selector,
    label: stringValue(value.label).trim() || selector,
    value: finiteNumber(value.value),
    elementAnchor: Math.max(0, Math.min(1, finiteNumber(value.elementAnchor))),
    viewportAnchor: Math.max(0, Math.min(1, finiteNumber(value.viewportAnchor, 0.5))),
    offsetPx: finiteNumber(value.offsetPx),
  };
}

function normalizeBehavior(raw: unknown): InteractionBehavior | null {
  if (!isRecord(raw)) return null;
  const kind = enumValue(
    raw.kind,
    INTERACTION_BEHAVIOR_KINDS,
    '' as InteractionBehaviorKind,
  );
  if (!kind) return null;
  const target = normalizeActionTarget(raw.target);
  if (kind === 'count-up') {
    return {
      kind,
      target,
      from: finiteNumber(raw.from),
      to: finiteNumber(raw.to),
      duration: Math.max(0.01, normalizeNonNegativeTiming(raw.duration, 1.4)),
      decimals: Math.max(0, Math.min(8, Math.floor(finiteNumber(raw.decimals)))),
      prefix: stringValue(raw.prefix),
      suffix: stringValue(raw.suffix),
      locale: stringValue(raw.locale).trim() || 'pt-BR',
      once: booleanValue(raw.once, true),
    };
  }
  if (kind === 'magnetic') {
    return {
      kind,
      target,
      strength: Math.max(0, Math.min(1, finiteNumber(raw.strength, 0.28))),
      radius: Math.max(0, finiteNumber(raw.radius, 120)),
      smoothing: Math.max(0.01, normalizeNonNegativeTiming(raw.smoothing, 0.28)),
      returnDuration: Math.max(0.01, normalizeNonNegativeTiming(raw.returnDuration, 0.55)),
    };
  }
  if (kind === 'text-roll') {
    return {
      kind,
      target,
      split: enumValue(raw.split, ['whole', 'words', 'chars'] as const, 'words'),
      duration: Math.max(0.01, normalizeNonNegativeTiming(raw.duration, 0.36)),
      stagger: Math.max(0, Math.min(0.5, finiteNumber(raw.stagger, 0.035))),
      distance: Math.max(20, Math.min(200, finiteNumber(raw.distance, 112))),
    };
  }
  if (kind === 'ticker') {
    return {
      kind,
      target,
      direction: enumValue(raw.direction, ['left', 'right'] as const, 'left'),
      speed: Math.max(4, Math.min(1000, finiteNumber(raw.speed, 56))),
      gap: Math.max(0, Math.min(1024, finiteNumber(raw.gap, 32))),
      hoverBehavior: enumValue(
        raw.hoverBehavior,
        ['none', 'pause', 'slow'] as const,
        'slow',
      ),
      hoverSlowdown: Math.max(0.02, Math.min(1, finiteNumber(raw.hoverSlowdown, 0.18))),
      hoverTransition: Math.max(0.01, Math.min(2, finiteNumber(raw.hoverTransition, 0.24))),
      draggable: booleanValue(raw.draggable, true),
      dragSensitivity: Math.max(0.1, Math.min(4, finiteNumber(raw.dragSensitivity, 1))),
      momentum: Math.max(0, Math.min(0.98, finiteNumber(raw.momentum, 0.86))),
    };
  }
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.slice(0, 256).flatMap((milestone, index) => {
      const normalized = normalizeScrollMilestone(milestone, index);
      return normalized ? [normalized] : [];
    })
    : [];
  const viewportAnchor = Math.max(0, Math.min(1, finiteNumber(raw.viewportAnchor, 0.5)));
  if (kind === 'image-sequence') {
    const startIndex = Math.max(0, Math.floor(finiteNumber(raw.startIndex)));
    const endIndex = Math.max(startIndex, Math.floor(finiteNumber(raw.endIndex, startIndex)));
    return {
      kind,
      target,
      urlTemplate: stringValue(raw.urlTemplate).trim(),
      startIndex,
      endIndex,
      zeroPad: Math.max(0, Math.min(12, Math.floor(finiteNumber(raw.zeroPad)))),
      preloadRadius: Math.max(0, Math.min(24, Math.floor(finiteNumber(raw.preloadRadius, 3)))),
      viewportAnchor,
      milestones,
    };
  }
  return {
    kind: 'video-scrub',
    target,
    startTime: Math.max(0, finiteNumber(raw.startTime)),
    endTime: Math.max(0, finiteNumber(raw.endTime)),
    smoothing: Math.max(0, normalizeNonNegativeTiming(raw.smoothing, 0.12)),
    viewportAnchor,
    milestones,
  };
}

function normalizeKeyframe(raw: unknown): InteractionKeyframe {
  const value = isRecord(raw) ? raw : {};
  return {
    id: stringValue(value.id) || id('keyframe'),
    time: normalizeNonNegativeTiming(value.time),
    values: normalizeInteractionValues(value.values),
  };
}

function normalizeAction(raw: unknown): InteractionAction {
  const value = isRecord(raw) ? raw : {};
  const kind = enumValue(value.kind, INTERACTION_ACTION_KINDS, 'animate');
  const base = createInteractionAction(kind);
  return {
    id: stringValue(value.id) || base.id,
    name: stringValue(value.name) || base.name,
    kind,
    target: normalizeActionTarget(value.target),
    start: normalizeNonNegativeTiming(value.start, base.start),
    duration: normalizeNonNegativeTiming(value.duration, base.duration),
    ease: stringValue(value.ease) || base.ease,
    from: normalizeInteractionValues(value.from),
    to: normalizeInteractionValues(value.to),
    keyframes: Array.isArray(value.keyframes)
      ? value.keyframes.map(normalizeKeyframe)
        .sort((left, right) => left.time - right.time)
      : [],
    repeat: normalizeInteractionRepeat(value.repeat),
    repeatDelay: normalizeNonNegativeTiming(value.repeatDelay, base.repeatDelay),
    yoyo: booleanValue(value.yoyo, base.yoyo),
    stagger: finiteNumber(value.stagger, base.stagger),
    staggerFrom: enumValue(
      value.staggerFrom,
      ['start', 'center', 'end', 'edges', 'random'] as const,
      base.staggerFrom,
    ),
    textSplit: enumValue(
      value.textSplit,
      INTERACTION_TEXT_SPLITS,
      base.textSplit,
    ),
    className: stringValue(value.className, base.className),
    variableName: stringValue(value.variableName) || base.variableName,
    variableValue: interactionScalar(value.variableValue, base.variableValue),
    eventName: stringValue(value.eventName) || base.eventName,
    inputName: stringValue(value.inputName, base.inputName),
    inputValue: interactionScalar(value.inputValue, base.inputValue),
    componentId: stringValue(value.componentId, base.componentId),
    componentVariantId: stringValue(value.componentVariantId, base.componentVariantId),
  };
}

function normalizeInteraction(raw: unknown): InteractionDefinition {
  const value = isRecord(raw) ? raw : {};
  const hasTriggerSelector = Object.prototype.hasOwnProperty.call(
    value,
    'triggerSelector',
  );
  const triggerSelector = hasTriggerSelector
    ? stringValue(value.triggerSelector)
    : 'body';
  const hasTriggerLabel = Object.prototype.hasOwnProperty.call(
    value,
    'triggerLabel',
  );
  const triggerLabel = hasTriggerLabel
    ? stringValue(value.triggerLabel)
    : triggerSelector || 'Target';
  const declaredTriggerTargetMode = enumValue(
    value.triggerTargetMode,
    INTERACTION_TARGET_MODES,
    'element',
  );
  const enabledBreakpoints = Array.isArray(value.enabledBreakpoints)
    ? Array.from(new Set(value.enabledBreakpoints.flatMap((breakpoint) => (
      typeof breakpoint === 'string'
        && INTERACTION_BREAKPOINTS.includes(breakpoint as InteractionBreakpoint)
        ? [breakpoint as InteractionBreakpoint]
        : []
    ))))
    : [...DEFAULT_INTERACTION.enabledBreakpoints];
  const behavior = normalizeBehavior(value.behavior);
  return {
    id: stringValue(value.id) || id('interaction'),
    name: stringValue(value.name) || 'Interaction',
    trigger: enumValue(value.trigger, INTERACTION_TRIGGERS, 'click'),
    triggerSelector,
    triggerLabel,
    triggerTargetMode: inferInteractionTargetMode(
      triggerSelector,
      triggerLabel,
      declaredTriggerTargetMode,
    ),
    // Library behaviors own their runtime lifecycle. Keeping imported timeline
    // actions beside one would make the interaction appear editable while the
    // behavior controller silently wins, so canonical documents make the two
    // modes mutually exclusive.
    actions: !behavior && Array.isArray(value.actions)
      ? value.actions.map(normalizeAction)
      : [],
    enabled: booleanValue(value.enabled, DEFAULT_INTERACTION.enabled),
    repeat: normalizeInteractionRepeat(value.repeat),
    yoyo: booleanValue(value.yoyo, DEFAULT_INTERACTION.yoyo),
    hoverInAction: enumValue(
      value.hoverInAction,
      ['play', 'restart'] as const,
      DEFAULT_INTERACTION.hoverInAction,
    ),
    hoverOutAction: enumValue(
      value.hoverOutAction,
      ['reverse', 'reset', 'pause', 'none'] as const,
      DEFAULT_INTERACTION.hoverOutAction,
    ),
    clickAction: enumValue(
      value.clickAction,
      ['toggle', 'play', 'restart', 'reverse'] as const,
      DEFAULT_INTERACTION.clickAction,
    ),
    mouseMoveAxis: enumValue(
      value.mouseMoveAxis,
      ['x', 'y', 'both'] as const,
      DEFAULT_INTERACTION.mouseMoveAxis,
    ),
    mouseMoveReverse: booleanValue(
      value.mouseMoveReverse,
      DEFAULT_INTERACTION.mouseMoveReverse,
    ),
    mouseMoveSmoothing: normalizeNonNegativeTiming(
      value.mouseMoveSmoothing,
      DEFAULT_INTERACTION.mouseMoveSmoothing,
    ),
    scrollStart: stringValue(value.scrollStart) || DEFAULT_INTERACTION.scrollStart,
    scrollEnd: stringValue(value.scrollEnd) || DEFAULT_INTERACTION.scrollEnd,
    scrollScrub: booleanValue(value.scrollScrub, DEFAULT_INTERACTION.scrollScrub),
    scrollSmoothing: normalizeNonNegativeTiming(
      value.scrollSmoothing,
      DEFAULT_INTERACTION.scrollSmoothing,
    ),
    scrollToggleActions: stringValue(value.scrollToggleActions)
      || DEFAULT_INTERACTION.scrollToggleActions,
    scrollTriggerSelector: stringValue(
      value.scrollTriggerSelector,
      DEFAULT_INTERACTION.scrollTriggerSelector,
    ),
    scrollTriggerLabel: stringValue(value.scrollTriggerLabel)
      || DEFAULT_INTERACTION.scrollTriggerLabel,
    customEvent: stringValue(value.customEvent) || DEFAULT_INTERACTION.customEvent,
    customCode: stringValue(value.customCode, DEFAULT_INTERACTION.customCode),
    reducedMotion: enumValue(
      value.reducedMotion,
      ['end', 'skip', 'allow'] as const,
      DEFAULT_INTERACTION.reducedMotion,
    ),
    enabledBreakpoints,
    libraryEffectId: stringValue(value.libraryEffectId).trim(),
    behavior,
  };
}

function reservedIdentifiers(values: unknown[]) {
  return new Set(values.flatMap(value => {
    if (!isRecord(value)) return [];
    const identifier = stringValue(value.id).trim();
    return identifier ? [identifier] : [];
  }));
}

function uniqueDocumentIdentifier(
  rawIdentifier: unknown,
  fallback: string,
  used: Set<string>,
  reserved: Set<string>,
) {
  const preferred = stringValue(rawIdentifier).trim();
  if (preferred && !used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const base = preferred || fallback;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate) || reserved.has(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Runtime controllers and grouped previews address definitions by ID. Keep
 * malformed/imported documents deterministic and collision-free so reopening
 * them cannot silently replace one controller with another in the runtime Map.
 */
function normalizeInteractionList(raw: unknown): InteractionDefinition[] {
  if (!Array.isArray(raw)) return [];
  const interactionIds = new Set<string>();
  const reservedInteractionIds = reservedIdentifiers(raw);
  const allRawActions = raw.flatMap(rawInteraction => (
    isRecord(rawInteraction) && Array.isArray(rawInteraction.actions)
      ? rawInteraction.actions
      : []
  ));
  const actionIds = new Set<string>();
  const reservedActionIds = reservedIdentifiers(allRawActions);
  const allRawKeyframes = allRawActions.flatMap(rawAction => (
    isRecord(rawAction) && Array.isArray(rawAction.keyframes)
      ? rawAction.keyframes
      : []
  ));
  const keyframeIds = new Set<string>();
  const reservedKeyframeIds = reservedIdentifiers(allRawKeyframes);
  return raw.map((rawInteraction, interactionIndex) => {
    const interaction = normalizeInteraction(rawInteraction);
    const rawInteractionRecord = isRecord(rawInteraction)
      ? rawInteraction
      : {};
    const rawActions = Array.isArray(rawInteractionRecord.actions)
      ? rawInteractionRecord.actions
      : [];
    const actions = interaction.actions.map((action, actionIndex) => {
      const rawAction = rawActions[actionIndex];
      const rawActionRecord = isRecord(rawAction) ? rawAction : {};
      const rawKeyframes = Array.isArray(rawActionRecord.keyframes)
        ? rawActionRecord.keyframes
        : [];
      const keyframes = rawKeyframes.map((rawKeyframe, keyframeIndex) => {
        const rawKeyframeRecord = isRecord(rawKeyframe)
          ? rawKeyframe
          : {};
        return {
          ...normalizeKeyframe(rawKeyframe),
          id: uniqueDocumentIdentifier(
            rawKeyframeRecord.id,
            `keyframe-${interactionIndex + 1}-${actionIndex + 1}-${keyframeIndex + 1}`,
            keyframeIds,
            reservedKeyframeIds,
          ),
        };
      }).sort((left, right) => left.time - right.time);
      return {
        ...action,
        id: uniqueDocumentIdentifier(
          rawActionRecord.id,
          `action-${interactionIndex + 1}-${actionIndex + 1}`,
          actionIds,
          reservedActionIds,
        ),
        keyframes,
      };
    });
    return {
      ...interaction,
      id: uniqueDocumentIdentifier(
        rawInteractionRecord.id,
        `interaction-${interactionIndex + 1}`,
        interactionIds,
        reservedInteractionIds,
      ),
      actions,
    };
  });
}

function stableSelectorIdentity(selector: string) {
  const normalized = selector.trim();
  if (!normalized) return '';
  if (normalized.startsWith('#')) {
    const identifier = cssIdentifierAt(normalized, 1);
    return identifier.value && identifier.end === normalized.length
      ? `id\u0000${identifier.value}`
      : '';
  }
  const attribute = normalized.match(
    /^\[\s*(id|data-kodety-interaction-id)\s*=\s*(?:(["'])((?:\\.|(?!\2)[\s\S])*)\2|([^\]\s]+))\s*\]$/i,
  );
  if (!attribute) return '';
  const value = decodeCssEscapedValue(attribute[3] ?? attribute[4] ?? '');
  return value ? `${attribute[1].toLowerCase()}\u0000${value}` : '';
}

function actionTargetsInteractionTrigger(
  action: InteractionAction,
  triggerSelector: string,
  source = '',
) {
  if (action.target.scope === 'trigger') return true;
  if (action.target.scope !== 'document') return false;
  const triggerIdentity = stableSelectorIdentity(triggerSelector);
  const actionIdentity = stableSelectorIdentity(action.target.selector);
  if (!triggerIdentity || triggerIdentity !== actionIdentity) return false;
  const dom = source ? selectionDomForSource(source)?.document : null;
  if (!dom) return true;
  const triggerElements = interactionDomSafeQuery(dom, triggerSelector);
  const actionElements = interactionDomSafeQuery(dom, action.target.selector);
  return triggerElements.length === 1
    && actionElements.length === 1
    && triggerElements[0] === actionElements[0];
}

function portableAction(
  rawAction: unknown,
  triggerSelector: string,
  freshIds: boolean,
  source = '',
): InteractionAction {
  const action = normalizeAction(rawAction);
  const target = actionTargetsInteractionTrigger(
    action,
    triggerSelector,
    source,
  )
    ? { ...DEFAULT_ACTION_TARGET }
    : { ...action.target };
  return {
    ...action,
    id: freshIds ? id('action') : action.id,
    target,
    from: { ...action.from },
    to: { ...action.to },
    keyframes: action.keyframes.map(keyframe => ({
      ...keyframe,
      id: freshIds ? id('keyframe') : keyframe.id,
      values: { ...keyframe.values },
    })),
  };
}

function savedDefinitionFromInteraction(
  rawInteraction: unknown,
  freshIds: boolean,
  source = '',
): SavedInteractionDefinition {
  const interaction = normalizeInteraction(rawInteraction);
  const {
    id: _id,
    triggerSelector,
    triggerLabel: _triggerLabel,
    triggerTargetMode: _triggerTargetMode,
    ...definition
  } = interaction;
  return {
    ...definition,
    actions: interaction.actions.map(action => portableAction(
      action,
      triggerSelector,
      freshIds,
      source,
    )),
    // A Scroll Section is page-specific. Reused motion starts from the newly
    // bound element until the author deliberately picks another section.
    scrollTriggerSelector: '',
    scrollTriggerLabel: DEFAULT_INTERACTION.scrollTriggerLabel,
    enabledBreakpoints: [...interaction.enabledBreakpoints],
  };
}

export function normalizeSavedInteractionPresets(
  raw: unknown,
): SavedInteractionPreset[] {
  const candidates = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.presets)
      ? raw.presets
      : [];
  const usedIds = new Set<string>();
  return candidates.flatMap((candidate, index) => {
    if (!isRecord(candidate) || !isRecord(candidate.definition)) return [];
    const legacyTriggerSelector = stringValue(
      candidate.definition.triggerSelector,
    );
    const definition = savedDefinitionFromInteraction({
      ...candidate.definition,
      triggerSelector: legacyTriggerSelector,
    }, false);
    let presetId = stringValue(candidate.id).trim();
    const baseId = presetId || `animation-preset-imported-${index + 1}`;
    presetId = baseId;
    let suffix = 2;
    while (usedIds.has(presetId)) presetId = `${baseId}-${suffix++}`;
    usedIds.add(presetId);
    return [{
      id: presetId,
      name: stringValue(candidate.name).trim()
        || definition.name
        || 'Saved animation',
      definition,
    }];
  });
}

export function createSavedInteractionPreset(
  interaction: InteractionDefinition,
  name: string,
  source = '',
): SavedInteractionPreset {
  const normalized = normalizeInteraction(interaction);
  return {
    id: id('animation-preset'),
    name: name.trim() || normalized.name || 'Saved animation',
    definition: savedDefinitionFromInteraction(normalized, true, source),
  };
}

function legacyInteractions(source: string): InteractionDefinition[] {
  const timelines: InteractionDefinition[] = [];
  for (const match of source.matchAll(/<script\b[^>]*data-incode-motion-timeline=["']([^"']+)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const encoded = match[2].match(
      /incode-motion-timeline:((?:(?!\*\/)\S)+)/,
    )?.[1];
    const raw = parseEncoded(encoded) as Record<string, unknown> | null;
    if (!raw) continue;
    const trigger = (raw.trigger === 'load' || raw.trigger === 'scroll' || raw.trigger === 'hover' || raw.trigger === 'click' || raw.trigger === 'custom') ? raw.trigger : 'click';
    const clips = Array.isArray(raw.clips) ? raw.clips as Array<Record<string, unknown>> : [];
    const actions = clips.map((clip, clipIndex) => {
      const actionId = String(
        clip.id || `${match[1]}-action-${clipIndex + 1}`,
      );
      return normalizeAction({
        id: actionId,
        name: String(clip.name || 'Animation'),
        kind: String(clip.actionType || '').startsWith('class-') ? clip.actionType as InteractionActionKind : clip.actionType === 'set' ? 'set' : 'animate',
        target: {
          selector: String(clip.selector || ''), label: String(clip.elementLabel || clip.selector || 'Target'),
          scope: (clip.targetScope || 'document') as InteractionTargetScope,
          mode: 'selector',
        },
        start: Number(clip.start) || 0, duration: Number(clip.duration) || 0.5,
        ease: String(clip.ease || 'power1.out'),
        from: clip.from as InteractionAction['from'] || {}, to: clip.to as InteractionAction['to'] || {},
        keyframes: Array.isArray(clip.keyframes)
          ? clip.keyframes.map((keyframe, keyframeIndex) => ({
            ...(isRecord(keyframe) ? keyframe : {}),
            id: isRecord(keyframe) && stringValue(keyframe.id).trim()
              ? stringValue(keyframe.id)
              : `${actionId}-keyframe-${keyframeIndex + 1}`,
          }))
          : [],
        textSplit: (clip.textSplit || 'none') as InteractionTextSplit,
        stagger: Number(clip.stagger) || 0,
        staggerFrom: (clip.staggerFrom || 'start') as InteractionAction['staggerFrom'],
        className: String(clip.className || ''),
      });
    });
    timelines.push(normalizeInteraction({
      id: String(raw.id || match[1]), name: String(raw.name || 'Migrated interaction'), trigger,
      triggerSelector: String(raw.triggerSelector || actions[0]?.target.selector || 'body'),
      triggerLabel: String(raw.name || 'Migrated trigger'), triggerTargetMode: 'selector', actions,
      repeat: Number(raw.repeat) || 0, yoyo: Boolean(raw.yoyo),
      scrollStart: String(raw.scrollStart || DEFAULT_INTERACTION.scrollStart),
      scrollEnd: String(raw.scrollEnd || DEFAULT_INTERACTION.scrollEnd),
      scrollScrub: Boolean(raw.scrub), scrollSmoothing: Number(raw.scrubSmoothing) || 0,
      scrollToggleActions: String(raw.scrollToggleActions || DEFAULT_INTERACTION.scrollToggleActions),
      customEvent: String(raw.customEvent || DEFAULT_INTERACTION.customEvent),
      customCode: String(raw.customCode || ''),
      hoverInAction: (raw.hoverInAction || 'restart') as InteractionDefinition['hoverInAction'],
      hoverOutAction: (raw.hoverOutAction || 'reverse') as InteractionDefinition['hoverOutAction'],
      clickAction: (raw.clickAction || 'toggle') as InteractionDefinition['clickAction'],
      reducedMotion: (raw.reducedMotion || 'end') as InteractionReducedMotion,
      enabledBreakpoints: raw.enabledBreakpoints as InteractionBreakpoint[] || DEFAULT_INTERACTION.enabledBreakpoints,
    }));
  }
  for (const match of source.matchAll(/<script\b[^>]*data-incode-gsap=["']([^"']+)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = parseEncoded(match[2].match(
      /incode-gsap-config:((?:(?!\*\/)\S)+)/,
    )?.[1]) as Record<string, unknown> | null;
    if (!raw || raw.codeMode === 'custom') continue;
    const selector = `[data-incode-animation-id="${match[1]}"]`;
    const trigger = (raw.trigger === 'load' || raw.trigger === 'scroll' || raw.trigger === 'hover' || raw.trigger === 'click') ? raw.trigger : 'load';
    const motion = {
      opacity: Number(raw.opacity ?? 0), x: Number(raw.x ?? 0), y: Number(raw.y ?? 0), scale: Number(raw.scale ?? 1),
      rotation: Number(raw.rotate ?? 0), skewX: Number(raw.skewX ?? 0), skewY: Number(raw.skewY ?? 0),
      transformOrigin: String(raw.transformOrigin || '50% 50%'),
      ...(Number(raw.blur) ? { filter: `blur(${Number(raw.blur)}px)` } : {}),
    };
    const clean = Object.fromEntries(Object.keys(motion).map(key => [key, interactionResetValue(key)]));
    const entering = raw.phase !== 'exit';
    const action = normalizeAction({
      id: `${match[1]}-action-1`,
      name: 'Migrated animation', kind: 'animate', target: { selector, label: selector, scope: 'document', mode: 'selector' },
      start: Number(raw.delay) || 0, duration: Number(raw.duration) || 0.5, ease: String(raw.ease || 'power1.out'),
      from: entering ? motion : clean, to: entering ? clean : motion,
      repeat: Number(raw.repeat) || 0, repeatDelay: Number(raw.repeatDelay) || 0,
      yoyo: Boolean(raw.yoyo), stagger: Number(raw.stagger) || 0, textSplit: (raw.textSplit || 'none') as InteractionTextSplit,
    });
    timelines.push(normalizeInteraction({
      id: match[1],
      name: `Migrated ${trigger}`, trigger, triggerSelector: selector, triggerLabel: selector,
      triggerTargetMode: 'selector', actions: [action], scrollStart: String(raw.scrollStart || DEFAULT_INTERACTION.scrollStart),
      scrollEnd: String(raw.scrollEnd || DEFAULT_INTERACTION.scrollEnd), scrollScrub: Boolean(raw.scrub),
      scrollToggleActions: String(raw.toggleActions || DEFAULT_INTERACTION.scrollToggleActions),
    }));
  }
  return timelines;
}

export function readInteractionDocument(source: string): InteractionDocument {
  const script = source.match(/<script\b[^>]*data-kodety-interactions-runtime[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  const encoded = script?.match(
    /kodety-interactions:((?:(?!\*\/)\S)+)/,
  )?.[1];
  const parsed = parseEncoded(encoded) as Partial<InteractionDocument> | null;
  const normalized = parsed && Array.isArray(parsed.interactions)
    ? { version: 2 as const, interactions: normalizeInteractionList(parsed.interactions) }
    : null;
  if (normalized) return normalized;
  return { version: 2, interactions: normalizeInteractionList(legacyInteractions(source)) };
}

export function parseInteractionDocumentText(text: string | undefined | null): InteractionDocument | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<InteractionDocument>;
    if (!Array.isArray(parsed.interactions)) return null;
    return {
      version: 2,
      interactions: normalizeInteractionList(parsed.interactions),
      ...(parsed.canonical === true ? { canonical: true as const } : {}),
    };
  } catch {
    return null;
  }
}

export function serializeInteractionDocument(
  document: InteractionDocument,
  options: { canonical?: boolean } = {},
) {
  return JSON.stringify({
    version: 2,
    ...(
      options.canonical === true || document.canonical === true
        ? { canonical: true }
        : {}
    ),
    interactions: normalizeInteractionList(document.interactions),
  }, null, 2);
}

export function readInteractionDocumentFile(project: HtmlProject, htmlPath = project.mainHtmlPath): InteractionDocument {
  const canonicalPath = interactionDocumentPath(htmlPath);
  const legacyPath = legacyInteractionDocumentPath(htmlPath);
  const canonical = parseInteractionDocumentText(
    project.files[canonicalPath]?.text,
  );
  if (canonical?.interactions.length || canonical?.canonical) {
    return canonical;
  }

  const legacy = legacyPath === canonicalPath
    ? null
    : parseInteractionDocumentText(project.files[legacyPath]?.text);
  const sharedLegacyPath = legacyPath !== canonicalPath
    && Object.keys(project.files).some(candidate => (
      candidate !== htmlPath
      && /\.html?$/i.test(candidate)
      && interactionDocumentPathCandidates(candidate).includes(legacyPath)
    ));
  if (legacy?.interactions.length && !sharedLegacyPath) return legacy;

  // Projects created before the dedicated animation document stored the same
  // payload inside the page runtime. Prefer that recoverable source over an
  // absent or accidentally empty JSON file. This also makes Preview resilient
  // while the first edit migrates the legacy payload into `.incode/animations`.
  const embedded = readInteractionDocument(project.files[htmlPath]?.text || '');
  if (embedded.interactions.length) return embedded;

  // A shared pre-canonical path is ambiguous, but remains the only recoverable
  // payload until either colliding page materializes its own canonical file.
  if (legacy?.interactions.length && !canonical) return legacy;

  return canonical || { version: 2, interactions: [] };
}

/**
 * Draft HTML deliberately omits generated motion. Publishing that workspace
 * directly is safe only when none of its pages needs an interaction runtime.
 * Include internal pages, component masters and experiment variants, and use
 * the same canonical/legacy resolution as Preview and the release compiler.
 */
export function projectHasNativeInteractions(project: HtmlProject): boolean {
  return Object.values(project.files).some(file => (
    /\.html?$/i.test(file.path)
    && file.text !== undefined
    && readInteractionDocumentFile(project, file.path).interactions.length > 0
  ));
}

export function stripInteractionRuntime(source: string) {
  return source
    .replace(/\s*<script\b[^>]*data-kodety-interactions-runtime[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<script\b[^>]*data-kodety-interactions-initial-paint[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<script\b[^>]*data-kodety-interactions-dependency[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<script\b[^>]*data-incode-motion-timeline=["'][^"']+["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<script\b[^>]*data-incode-gsap=["'][^"']+["'][^>]*>[\s\S]*?<\/script>/gi, full => {
      const encoded = full.match(
        /incode-gsap-config:((?:(?!\*\/)\S)+)/,
      )?.[1];
      const config = parseEncoded(encoded) as Record<string, unknown> | null;
      // The old native visual action is migrated above. A user-authored custom
      // code block remains code and is deliberately outside the new editor-
      // managed document, so migrations never rewrite or delete it.
      return config?.codeMode === 'custom' ? full : '';
    });
}

/** Use identical target resolution before first paint and during timeline setup. */
function interactionTargetRuntime() {
  return `
    const isTemporarySplitPart = element => {
      let parent = element?.parentElement;
      while (parent) {
        if (parent.hasAttribute?.('data-kodety-interaction-split')) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };
    const plainTargetReference = selector => (
      /^[-_a-z0-9\\u0080-\\uFFFF]+$/i.test(String(selector || '').trim())
    );
    const legacyModeQuery = (root, selector, mode) => {
      const normalized = String(selector || '').trim();
      if (!normalized || !plainTargetReference(normalized)) return [];
      if (mode === 'class') {
        return Array.from(root.getElementsByClassName?.(normalized) || [])
          .filter(element => !isTemporarySplitPart(element));
      }
      if (mode === 'element') {
        return Array.from(
          root.querySelectorAll?.('[data-kodety-interaction-id], [id]') || [],
        ).filter(element => (
          !isTemporarySplitPart(element)
          && (
            element.getAttribute('data-kodety-interaction-id') === normalized
            || element.id === normalized
          )
        ));
      }
      return [];
    };
    const safeQuery = (root, selector, mode = 'selector') => {
      try {
        const legacyMatches = legacyModeQuery(root, selector, mode);
        if (legacyMatches.length) return legacyMatches;
        return selector
          ? Array.from(root.querySelectorAll(selector))
            .filter(element => !isTemporarySplitPart(element))
          : [];
      } catch {
        return [];
      }
    };
    const safeMatches = (element, selector, mode = 'selector') => {
      try {
        const normalized = String(selector || '').trim();
        if (plainTargetReference(normalized)) {
          if (mode === 'class') {
            return (
              !isTemporarySplitPart(element)
              && element.classList?.contains(normalized)
            );
          }
          if (mode === 'element') {
            return (
              !isTemporarySplitPart(element)
              && (
                element.getAttribute?.('data-kodety-interaction-id') === normalized
                || element.id === normalized
              )
            );
          }
        }
        return !isTemporarySplitPart(element)
          && (!selector || element.matches(selector));
      } catch {
        return false;
      }
    };
    const baseTargetsFor = (target, triggerElement) => {
      const selector = target.selector || '';
      const mode = target.mode || 'selector';
      let elements = [];
      if (target.scope === 'trigger') elements = triggerElement ? [triggerElement] : [];
      else if (target.scope === 'children') elements = triggerElement ? Array.from(triggerElement.children).filter(element => safeMatches(element, selector, mode)) : [];
      else if (target.scope === 'descendants') elements = triggerElement ? safeQuery(triggerElement, selector || '*', mode) : [];
      else if (target.scope === 'parent') elements = triggerElement?.parentElement && safeMatches(triggerElement.parentElement, selector, mode) ? [triggerElement.parentElement] : [];
      else if (target.scope === 'closest') { try { const found = triggerElement?.parentElement?.closest(selector || '*'); elements = found ? [found] : []; } catch { elements = []; } }
      else if (target.scope === 'siblings') elements = triggerElement?.parentElement ? Array.from(triggerElement.parentElement.children).filter(element => element !== triggerElement && safeMatches(element, selector, mode)) : [];
      else if (target.scope === 'next') elements = triggerElement?.nextElementSibling && safeMatches(triggerElement.nextElementSibling, selector, mode) ? [triggerElement.nextElementSibling] : [];
      else if (target.scope === 'previous') elements = triggerElement?.previousElementSibling && safeMatches(triggerElement.previousElementSibling, selector, mode) ? [triggerElement.previousElementSibling] : [];
      else elements = safeQuery(document, selector, mode);
      return elements.filter(element => (
        !isTemporarySplitPart(element)
        && !element.closest?.('[data-kodety-ticker-clone]')
      ));
    };
`;
}

/**
 * Author HTML stays visible without JavaScript. With motion enabled, protect
 * only its real targets while the parser builds the body: DOMContentLoaded is
 * too late to prevent a paint in the authored (usually final) state. Visibility
 * preserves layout for scroll measurement and line splitting without replacing the
 * opacity/transform values GSAP must read from the author stylesheet.
 */
function interactionInitialPaintRuntime(document: InteractionDocument) {
  const definitions = document.interactions.filter(interaction => interaction.enabled).map(interaction => ({
    triggerSelector: interaction.triggerSelector,
    triggerTargetMode: interaction.triggerTargetMode,
    trigger: interaction.trigger,
    enabledBreakpoints: interaction.enabledBreakpoints,
    targets: interaction.behavior
      ? [interaction.behavior.target]
      : interaction.actions.filter(action => (
          action.kind === 'set'
          || (action.kind === 'animate' && (
            Object.keys(action.from).length > 0 || action.keyframes.length > 1
          ))
          || (
            interaction.trigger === 'load'
            && (
              action.kind === 'variable'
              || action.kind === 'component-variant'
              || action.kind.startsWith('class-')
            )
          )
        )).map(action => action.target),
  })).filter(interaction => interaction.targets.length && interaction.enabledBreakpoints.length);
  if (!definitions.length) return '';
  const encoded = encodeURIComponent(JSON.stringify(definitions)).replace(/\*/g, '%2A');
  return `<script data-kodety-interactions-initial-paint>
(() => {
  if (window.__KODETY_EDITOR_MOTION_FROZEN__ || typeof MutationObserver !== 'function') return;
  const breakpoint = innerWidth < 768 ? 'mobile' : innerWidth < 992 ? 'tablet' : 'desktop';
  const definitions = JSON.parse(decodeURIComponent(${JSON.stringify(encoded)}))
    .filter(interaction => interaction.enabledBreakpoints.includes(breakpoint));
  if (!definitions.length) return;
  window.__kodetyInteractionsInitialPaint?.release?.();
${interactionTargetRuntime()}
  const attribute = 'data-kodety-interactions-pending';
  const pending = new Set();
  const style = document.createElement('style');
  style.setAttribute('data-kodety-interactions-initial-paint', '');
  style.textContent = '[' + attribute + '],[' + attribute + '] *{visibility:hidden!important;transition:none!important}';
  document.head.appendChild(style);
  const protectTargets = () => {
    definitions.forEach(interaction => {
      let triggers = safeQuery(document, interaction.triggerSelector, interaction.triggerTargetMode);
      if (!triggers.length && !interaction.triggerSelector.trim()
        && (interaction.trigger === 'load' || interaction.trigger === 'custom') && document.body) {
        triggers = [document.body];
      }
      triggers.forEach(trigger => interaction.targets.forEach(target => {
        baseTargetsFor(target, trigger).forEach(element => {
          if (element.hasAttribute(attribute)) return;
          pending.add(element);
          element.setAttribute(attribute, '');
        });
      }));
    });
  };
  const observer = new MutationObserver(protectTargets);
  let timer = 0;
  let released = false;
  const guard = {
    expired: false,
    prepare: () => {
      // Setup is synchronous. Restore authored visibility for GSAP getters
      // (notably autoAlpha), but keep CSS transitions off until From commits.
      if (!released) style.textContent = '[' + attribute + '],[' + attribute + '] *{transition:none!important}';
    },
    release: (expired = false) => {
      if (released) return;
      released = true;
      guard.expired = expired;
      clearTimeout(timer);
      observer.disconnect();
      // Commit From without authored CSS transitions before revealing it.
      if (!expired) document.documentElement?.getBoundingClientRect?.();
      pending.forEach(element => element.removeAttribute(attribute));
      pending.clear();
      style.remove();
    },
  };
  window.__kodetyInteractionsInitialPaint = guard;
  // A missing/broken body runtime must never leave the page concealed. If it
  // eventually arrives, it finishes visual actions without replaying From.
  timer = setTimeout(() => guard.release(true), 4000);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  protectTargets();
})();
</script>`;
}

function interactionRuntime(document: InteractionDocument) {
  const encoded = encodeURIComponent(JSON.stringify(document))
    .replace(/\*/g, '%2A');
  return `<script data-kodety-interactions-runtime>
/* kodety-interactions:${encoded} */
(() => {
  let documentDefinition = JSON.parse(decodeURIComponent(${JSON.stringify(encoded)}));
  let setupRetryTimer = 0;
  let setupRetryCount = 0;
  const scheduleSetupRetry = setup => {
    if (setupRetryTimer || setupRetryCount >= 120) return;
    setupRetryCount += 1;
    const clock = window.__KODETY_EDITOR_NATIVE_CLOCK__ || {};
    const schedule = clock.setTimeout || window.setTimeout.bind(window);
    setupRetryTimer = schedule(() => {
      setupRetryTimer = 0;
      setup();
    }, Math.min(500, 16 * setupRetryCount));
  };
  const setup = () => {
    const editorFrozen = Boolean(window.__KODETY_EDITOR_MOTION_FROZEN__);
    const initialPaint = window.__kodetyInteractionsInitialPaint;
    const skipStartupMotion = !editorFrozen && Boolean(initialPaint?.expired);
    const motionEngine = window.__ONUN_MOTION_ENGINE__;
    const MotionEase = motionEngine?.easing;
    const MotionScroll = motionEngine?.scroll;
    if (!motionEngine || typeof motionEngine.timeline !== 'function') {
      scheduleSetupRetry(setup);
      return false;
    }
    setupRetryCount = 0;
    initialPaint?.prepare?.();
    window.__kodetyInteractions?.destroy?.();
    const cleanups = [];
    const controllers = new Map();
    const customEaseCache = new Map();
    const clampEaseNumber = (value, minimum, maximum, fallback) => {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.min(maximum, Math.max(minimum, number))
        : fallback;
    };
    const springEasePath = (values, duration) => {
      const stiffness = clampEaseNumber(values[0], 20, 500, 320);
      const damping = clampEaseNumber(values[1], 1, 60, 28);
      const mass = clampEaseNumber(values[2], .1, 3, 1);
      const activeDuration = Math.max(.001, Number(duration) || .5);
      const omega0 = Math.sqrt(stiffness / mass);
      const zeta = damping / (2 * Math.sqrt(stiffness * mass));
      const samples = [];
      for (let index = 0; index < 60; index += 1) {
        const progress = index / 59;
        const time = progress * activeDuration;
        let result;
        if (zeta < 1) {
          const omegaD = omega0 * Math.sqrt(Math.max(.0001, 1 - zeta * zeta));
          result = 1 - Math.exp(-zeta * omega0 * time) * (
            Math.cos(omegaD * time)
            + (zeta * omega0 / omegaD) * Math.sin(omegaD * time)
          );
        } else if (Math.abs(zeta - 1) < .001) {
          result = 1 - Math.exp(-omega0 * time) * (1 + omega0 * time);
        } else {
          const root = Math.sqrt(zeta * zeta - 1);
          const r1 = -omega0 * (zeta - root);
          const r2 = -omega0 * (zeta + root);
          const a = r2 / (r1 - r2);
          const b = -1 - a;
          result = 1 + a * Math.exp(r1 * time) + b * Math.exp(r2 * time);
        }
        if (index === 0) result = 0;
        if (index === 59) result = 1;
        samples.push((index ? 'L' : 'M') + progress.toFixed(5) + ',' + Number(result.toFixed(5)));
      }
      return samples.join(' ');
    };
    const runtimeEase = (rawValue, duration) => {
      const value = String(rawValue || 'power1.out').trim();
      const custom = value.match(/^cubic-bezier\\(\\s*([^,]+)\\s*,\\s*([^,]+)\\s*,\\s*([^,]+)\\s*,\\s*([^)]+)\\s*\\)$/i);
      const spring = value.match(/^spring\\(\\s*([^,]+)\\s*,\\s*([^,]+)\\s*,\\s*([^)]+)\\s*\\)$/i);
      if (!custom && !spring) return value;
      if (!MotionEase || typeof MotionEase.create !== 'function') return 'power1.out';
      const cacheKey = spring ? value + '@' + Math.max(.001, Number(duration) || .5) : value;
      if (customEaseCache.has(cacheKey)) return customEaseCache.get(cacheKey);
      let hash = 0;
      for (let index = 0; index < cacheKey.length; index += 1) {
        hash = ((hash << 5) - hash + cacheKey.charCodeAt(index)) | 0;
      }
      const name = 'kodety-ease-' + Math.abs(hash);
      const data = custom
        ? custom.slice(1).map(Number).join(',')
        : springEasePath(spring.slice(1).map(Number), duration);
      try {
        MotionEase.create(name, data);
        customEaseCache.set(cacheKey, name);
        return name;
      } catch {
        return 'power1.out';
      }
    };
    const definitionNeedsMotionEase = definition => Boolean(
      definition?.interactions?.some?.(interaction => interaction.actions?.some?.(action => (
        /^\\s*(?:cubic-bezier|spring)\\s*\\(/i.test(String(action.ease || ''))
      )))
    );
    const individualPreviewKey = interactionId => (
      'single:' + JSON.stringify(interactionId)
    );
    const editorClock = window.__KODETY_EDITOR_NATIVE_CLOCK__ || {};
    const editorRequestFrame = editorClock.requestAnimationFrame || window.requestAnimationFrame.bind(window);
    const editorCancelFrame = editorClock.cancelAnimationFrame || window.cancelAnimationFrame.bind(window);
    const editorNow = () => {
      const time = window.performance?.now?.();
      return Number.isFinite(time) ? time : Date.now();
    };
    const previewDelta = (now, previous) => {
      const rawDelta = Math.max(0, now - previous);
      // Match the Motion engine's default lag smoothing: a long suspended frame advances by
      // roughly one normal frame instead of jumping the animation to the end.
      return rawDelta > 500 ? 33 : rawDelta;
    };
    let groupedPreviewFrame = 0;
    const cancelGroupedPreviewFrame = () => {
      if (groupedPreviewFrame) editorCancelFrame(groupedPreviewFrame);
      groupedPreviewFrame = 0;
    };
${interactionTargetRuntime()}
    const classTokens = value => String(value || '')
      .split(/\\s+/)
      .filter(Boolean);
    const normalizeRepeat = value => {
      const repeat = Number(value);
      if (!Number.isFinite(repeat)) return 0;
      if (repeat === -1) return -1;
      return Math.max(0, Math.floor(repeat));
    };
    const runtimeRepeat = value => {
      const repeat = normalizeRepeat(value);
      // Infinite motion remains infinite on the published site. In the Design
      // canvas one finite cycle is the only useful, seekable representation.
      return editorFrozen && repeat === -1 ? 0 : repeat;
    };
    const nonNegativeTiming = value => {
      const timing = Number(value);
      return Number.isFinite(timing) ? Math.max(0, timing) : 0;
    };
    const scaleRatio = value => {
      if (typeof value === 'string') {
        const normalized = value.trim().replace(',', '.');
        if (normalized.endsWith('%')) {
          const percent = Number(normalized.slice(0, -1));
          return Number.isFinite(percent) ? percent / 100 : 1;
        }
        const numeric = Number(normalized);
        return Number.isFinite(numeric) ? numeric : 1;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 1;
    };
    const motionValues = rawValues => {
      const values = { ...(rawValues || {}) };
      const hasOwn = key => Object.prototype.hasOwnProperty.call(values, key);
      if (hasOwn('scale')) {
        // Scale is a uniform design property. Materialize both axes so the Motion engine
        // cannot inherit a stale/non-uniform axis from the element's authored
        // transform and distort images while scrubbing or publishing.
        const uniformScale = scaleRatio(values.scale);
        delete values.scale;
        values.scaleX = uniformScale;
        values.scaleY = uniformScale;
      } else {
        if (hasOwn('scaleX')) values.scaleX = scaleRatio(values.scaleX);
        if (hasOwn('scaleY')) values.scaleY = scaleRatio(values.scaleY);
      }
      return values;
    };
    const setupInlineStyleSnapshots = new Map();
    const setupClassTokenSnapshots = new Map();
    const splitTextSnapshots = new Map();
    const splitTextConflicts = new Set();
    let previewSession = null;
    let teardownActiveFrozenPreview = () => false;
    const captureInlineStyle = (snapshots, element) => {
      if (snapshots.has(element)) return;
      snapshots.set(element, {
        style: element.getAttribute?.('style') ?? null,
        transform: element.getAttribute?.('transform') ?? null,
        svgOrigin: element.getAttribute?.('data-svg-origin') ?? null,
      });
    };
    const restoreInlineStyles = snapshots => {
      snapshots.forEach((snapshot, element) => {
        if (!element?.setAttribute) return;
        [
          ['style', snapshot.style],
          ['transform', snapshot.transform],
          ['data-svg-origin', snapshot.svgOrigin],
        ].forEach(([name, value]) => {
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        });
        motionEngine.invalidateElement?.(element);
      });
    };
    const captureClassToken = (snapshots, element, className) => {
      if (!className || !element?.classList) return;
      let tokens = snapshots.get(element);
      if (!tokens) {
        tokens = new Map();
        snapshots.set(element, tokens);
      }
      if (!tokens.has(className)) {
        tokens.set(className, element.classList.contains(className));
      }
    };
    const restoreClassTokens = snapshots => {
      snapshots.forEach((tokens, element) => {
        if (!element?.classList) return;
        tokens.forEach((present, className) => {
          element.classList[present ? 'add' : 'remove'](className);
        });
      });
    };
    const capturePreviewSession = (key, targets, classTargets) => {
      const styles = new Map();
      const classes = new Map();
      Array.from(new Set(targets || [])).forEach(element => {
        captureInlineStyle(styles, element);
      });
      (classTargets || []).forEach(entry => {
        entry.elements.forEach(element => {
          captureClassToken(classes, element, entry.className);
        });
      });
      previewSession = { key, styles, classes };
    };
    const restorePreviewSession = expectedKey => {
      if (
        !previewSession
        || (expectedKey !== undefined && previewSession.key !== expectedKey)
      ) return false;
      restoreInlineStyles(previewSession.styles);
      restoreClassTokens(previewSession.classes);
      previewSession = null;
      return true;
    };
    const restoreSplitText = () => {
      splitTextSnapshots.forEach((snapshot, element) => {
        if (!element?.setAttribute) return;
        const currentMarker = element.getAttribute(
          'data-kodety-interaction-split',
        );
        const currentNodes = Array.from(element.childNodes || []);
        const ownsGeneratedTree = (
          currentMarker === snapshot.mode
          && currentNodes.length === snapshot.ownedNodes.length
          && currentNodes.every((node, index) => (
            node === snapshot.ownedNodes[index]
          ))
          && currentNodes.every((node, index) => (
            (node.textContent || '') === snapshot.ownedText[index]
          ))
        );
        if (ownsGeneratedTree) element.innerHTML = snapshot.html;
        if (element.getAttribute('aria-label') === snapshot.runtimeAriaLabel) {
          if (snapshot.ariaLabel === null) element.removeAttribute('aria-label');
          else element.setAttribute('aria-label', snapshot.ariaLabel);
        }
        if (currentMarker === snapshot.mode) {
          if (snapshot.splitMarker === null) {
            element.removeAttribute('data-kodety-interaction-split');
          } else {
            element.setAttribute(
              'data-kodety-interaction-split',
              snapshot.splitMarker,
            );
          }
        }
      });
      splitTextSnapshots.clear();
    };
    const splitText = (element, mode) => {
      if (mode === 'none') return [element];
      // Splitting a group/container would delete its authored child tree.
      // Existing runtime splits are shared between actions; otherwise only a
      // leaf text element is safe to replace with generated spans.
      if (element.hasAttribute?.('data-kodety-interaction-split')) {
        const activeMode = element.getAttribute(
          'data-kodety-interaction-split',
        );
        if (activeMode !== mode) {
          const conflictKey = String(activeMode) + '->' + String(mode);
          if (!splitTextConflicts.has(conflictKey)) {
            splitTextConflicts.add(conflictKey);
            console.warn(
              '[Kodety Interactions] Conflicting text split modes; the later action targets the complete element.',
              activeMode,
              mode,
            );
          }
          return [element];
        }
        const children = Array.from(element.children || []);
        return children.length ? children : [element];
      }
      if (element.children?.length) return [element];
      const snapshot = {
        html: element.innerHTML,
        ariaLabel: element.getAttribute?.('aria-label') ?? null,
        splitMarker: element.getAttribute?.(
          'data-kodety-interaction-split',
        ) ?? null,
        runtimeAriaLabel: element.textContent || '',
        mode,
        ownedNodes: [],
        ownedText: [],
      };
      splitTextSnapshots.set(element, snapshot);
      const text = element.textContent || '';
      element.setAttribute('data-kodety-interaction-split', mode);
      element.setAttribute('aria-label', text);
      element.textContent = '';
      const finishSplit = targets => {
        snapshot.ownedNodes = Array.from(element.childNodes || []);
        snapshot.ownedText = snapshot.ownedNodes.map(
          node => node.textContent || '',
        );
        return targets;
      };
      if (mode === 'lines') {
        const words = text.trim().split(/\\s+/).filter(Boolean);
        if (!words.length) {
          element.innerHTML = snapshot.html;
          if (snapshot.ariaLabel === null) element.removeAttribute('aria-label');
          else element.setAttribute('aria-label', snapshot.ariaLabel);
          if (snapshot.splitMarker === null) {
            element.removeAttribute('data-kodety-interaction-split');
          } else {
            element.setAttribute(
              'data-kodety-interaction-split',
              snapshot.splitMarker,
            );
          }
          splitTextSnapshots.delete(element);
          return [element];
        }
        const probes = words.map((word, index) => {
          const span = document.createElement('span');
          span.setAttribute('aria-hidden', 'true');
          span.style.display = 'inline-block';
          span.style.whiteSpace = 'pre';
          span.textContent = word;
          element.appendChild(span);
          if (index < words.length - 1) {
            element.appendChild(document.createTextNode(' '));
          }
          return span;
        });
        const lines = [];
        probes.forEach(span => {
          const top = span.getBoundingClientRect().top;
          const current = lines[lines.length - 1];
          if (!current || Math.abs(current.top - top) > 1) {
            lines.push({ top, words: [span.textContent || ''] });
          } else {
            current.words.push(span.textContent || '');
          }
        });
        element.textContent = '';
        return finishSplit(lines.map(line => {
          const span = document.createElement('span');
          span.setAttribute('aria-hidden', 'true');
          span.style.display = 'block';
          span.style.whiteSpace = 'pre-wrap';
          span.textContent = line.words.join(' ');
          element.appendChild(span);
          return span;
        }));
      }
      const parts = mode === 'chars' ? Array.from(text) : text.split(/(\\s+)/);
      return finishSplit(parts.map(part => {
        const span = document.createElement('span');
        span.setAttribute('aria-hidden', 'true');
        span.style.display = 'inline-block';
        span.style.whiteSpace = 'pre';
        span.textContent = part;
        element.appendChild(span);
        return span;
      }));
    };
    const targetsFor = (target, triggerElement, split) => {
      const elements = baseTargetsFor(target, triggerElement);
      return split === 'none' ? elements : elements.flatMap(element => splitText(element, split));
    };
    const uniqueElements = values => Array.from(new Set(
      (values || []).filter(element => element?.nodeType === 1),
    ));
    const behaviorTargetsFor = (behavior, triggerElements) => uniqueElements(
      triggerElements.flatMap(triggerElement => (
        baseTargetsFor(behavior.target || { scope: 'trigger' }, triggerElement)
      )),
    );
    const behaviorController = ({
      interaction,
      targets,
      duration = 1,
      render = () => {},
      play = null,
      pause = null,
      release = null,
      cleanup = () => {},
    }) => {
      let time = 0;
      let killed = false;
      let playbackFrame = 0;
      const renderTime = nextTime => {
        time = Math.max(0, Math.min(duration, Number(nextTime) || 0));
        render(duration > 0 ? time / duration : 1);
      };
      const stopPlayback = () => {
        if (playbackFrame) editorCancelFrame(playbackFrame);
        playbackFrame = 0;
      };
      const animateTo = targetTime => {
        stopPlayback();
        const destination = Math.max(0, Math.min(duration, targetTime));
        if (Math.abs(time - destination) < 0.0001) {
          renderTime(destination);
          return;
        }
        let previous = editorNow();
        const tick = now => {
          playbackFrame = 0;
          const delta = previewDelta(now, previous) / 1000;
          previous = now;
          const direction = destination >= time ? 1 : -1;
          renderTime(time + direction * delta);
          if (Math.abs(time - destination) > 0.0001) {
            playbackFrame = editorRequestFrame(tick);
          } else renderTime(destination);
        };
        playbackFrame = editorRequestFrame(tick);
      };
      const prepare = () => ({
        triggerElements: targets,
        targets,
        classTargets: [],
      });
      const releasePreview = () => {
        stopPlayback();
        pause?.();
        time = 0;
        if (release) release();
        else renderTime(0);
      };
      return {
        __previewTargets: () => targets,
        __classTargets: () => [],
        __prepareFrozenPreview: prepare,
        __buildFrozenPreview: () => {},
        __teardownFrozenPreview: releasePreview,
        __pauseFrozenPlayback: () => { stopPlayback(); pause?.(); },
        __renderPreviewTime: renderTime,
        __previewDuration: () => duration,
        __measurePreviewDuration: () => duration,
        __previewTime: () => time,
        __seedPreviewStates: () => renderTime(0),
        __publishPreviewDuration: () => {
          if (!editorFrozen) return;
          window.__KODETY_POST_EDITOR_MESSAGE__?.({
            type: 'html-editor-interaction-duration',
            interactionId: interaction.id,
            signature: JSON.stringify(interaction),
            duration,
          });
        },
        play: () => { if (play) play(false); else animateTo(duration); },
        restart: () => {
          if (play) play(true);
          else { renderTime(0); animateTo(duration); }
        },
        reverse: () => { pause?.(); animateTo(0); },
        pause: nextTime => {
          stopPlayback();
          pause?.();
          if (nextTime !== undefined) renderTime(nextTime);
        },
        seek: nextTime => {
          stopPlayback();
          pause?.();
          renderTime(nextTime);
        },
        reset: releasePreview,
        release: releasePreview,
        kill: () => {
          if (killed) return;
          killed = true;
          stopPlayback();
          cleanup();
        },
      };
    };
    const milestonePoints = behavior => {
      const pageY = window.scrollY || window.pageYOffset || 0;
      return (behavior.milestones || []).flatMap(milestone => {
        const element = safeQuery(document, milestone.selector, 'selector')[0];
        if (!element) return [];
        const bounds = element.getBoundingClientRect();
        const elementAnchor = Math.max(0, Math.min(1, Number(milestone.elementAnchor) || 0));
        const viewportAnchor = Math.max(0, Math.min(1,
          Number.isFinite(Number(milestone.viewportAnchor))
            ? Number(milestone.viewportAnchor)
            : Number(behavior.viewportAnchor) || 0.5,
        ));
        return [{
          position: bounds.top + pageY + bounds.height * elementAnchor
            - innerHeight * viewportAnchor + (Number(milestone.offsetPx) || 0),
          value: Number(milestone.value) || 0,
        }];
      }).sort((left, right) => left.position - right.position);
    };
    const valueAcrossMilestones = (points, scrollPosition) => {
      if (!points.length) return 0;
      if (points.length === 1 || scrollPosition <= points[0].position) return points[0].value;
      const last = points[points.length - 1];
      if (scrollPosition >= last.position) return last.value;
      for (let index = 1; index < points.length; index += 1) {
        const next = points[index];
        if (scrollPosition > next.position) continue;
        const previous = points[index - 1];
        const span = Math.max(1, next.position - previous.position);
        const progress = Math.max(0, Math.min(1, (scrollPosition - previous.position) / span));
        return previous.value + (next.value - previous.value) * progress;
      }
      return last.value;
    };
    const sequenceUrl = (template, index, zeroPad) => String(template || '').replace(
      /\\{index(?::(\\d+))?\\}/g,
      (match, inlinePadding) => String(Math.round(index)).padStart(
        Math.max(0, Math.min(12, Number(inlinePadding) || Number(zeroPad) || 0)),
        '0',
      ),
    );
    const installCountUpBehavior = (interaction, behavior, targets) => {
      const textTargets = targets.filter(element => !element.children?.length);
      if (!textTargets.length) return null;
      const snapshots = textTargets.map(element => ({
        element,
        text: element.textContent || '',
        lastText: null,
      }));
      const state = { value: Number(behavior.from) || 0 };
      let animationFrame = 0;
      let observer = null;
      let played = false;
      const formatter = (() => {
        try {
          return new Intl.NumberFormat(behavior.locale || undefined, {
            minimumFractionDigits: Math.max(0, Number(behavior.decimals) || 0),
            maximumFractionDigits: Math.max(0, Number(behavior.decimals) || 0),
          });
        } catch {
          return new Intl.NumberFormat(undefined, {
            minimumFractionDigits: Math.max(0, Number(behavior.decimals) || 0),
            maximumFractionDigits: Math.max(0, Number(behavior.decimals) || 0),
          });
        }
      })();
      const renderValue = value => {
        const text = String(behavior.prefix || '') + formatter.format(value) + String(behavior.suffix || '');
        snapshots.forEach(snapshot => {
          snapshot.element.textContent = text;
          snapshot.lastText = text;
        });
      };
      const render = progress => {
        const from = Number(behavior.from) || 0;
        const to = Number(behavior.to) || 0;
        const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 2);
        state.value = from + (to - from) * eased;
        renderValue(state.value);
      };
      const stop = () => {
        if (animationFrame) editorCancelFrame(animationFrame);
        animationFrame = 0;
      };
      const restore = () => {
        stop();
        played = false;
        snapshots.forEach(snapshot => {
          if (snapshot.lastText !== null && snapshot.element.textContent === snapshot.lastText) {
            snapshot.element.textContent = snapshot.text;
          }
          snapshot.lastText = null;
        });
      };
      const run = restart => {
        if (behavior.once && played && !restart) return;
        played = true;
        stop();
        render(0);
        const durationMs = Math.max(10, (Number(behavior.duration) || 1.4) * 1000);
        let elapsed = 0;
        let previous = editorNow();
        const tick = now => {
          animationFrame = 0;
          elapsed += previewDelta(now, previous);
          previous = now;
          const progress = Math.max(0, Math.min(1, elapsed / durationMs));
          render(progress);
          if (progress < 1) animationFrame = editorRequestFrame(tick);
        };
        animationFrame = editorRequestFrame(tick);
      };
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!editorFrozen) {
        if (reduced && interaction.reducedMotion === 'end') render(1);
        else if (!(reduced && interaction.reducedMotion === 'skip')) {
          render(0);
          if (typeof IntersectionObserver === 'function') {
            observer = new IntersectionObserver(entries => {
              if (!entries.some(entry => entry.isIntersecting)) return;
              run(false);
              if (behavior.once) observer?.disconnect();
            }, { threshold: 0.12 });
            textTargets.forEach(element => observer.observe(element));
          } else run(false);
        }
      }
      return behaviorController({
        interaction,
        targets: textTargets,
        duration: Math.max(0.01, Number(behavior.duration) || 1.4),
        render,
        pause: stop,
        release: restore,
        cleanup: () => {
          observer?.disconnect();
          restore();
        },
      });
    };
    const installMagneticBehavior = (interaction, behavior, targets) => {
      if (!targets.length) return null;
      const splitTranslate = value => {
        const parts = [];
        let current = '';
        let depth = 0;
        Array.from(String(value || '')).forEach(character => {
          if (character === '(') depth += 1;
          if (character === ')') depth = Math.max(0, depth - 1);
          if (/\\s/.test(character) && depth === 0) {
            if (current) parts.push(current);
            current = '';
          } else current += character;
        });
        if (current) parts.push(current);
        return parts;
      };
      const snapshots = targets.map(element => ({
        element,
        translate: element.style.translate,
        willChange: element.style.willChange,
        baseTranslate: (() => {
          const value = getComputedStyle(element).translate;
          return value && value !== 'none' ? value : '0px 0px';
        })(),
        offset: { x: 0, y: 0 },
      }));
      const snapshotByElement = new Map(snapshots.map(snapshot => [snapshot.element, snapshot]));
      let activeTweens = [];
      let pointerFrame = 0;
      let pointerX = 0;
      let pointerY = 0;
      const magnetized = new Set();
      const applyOffset = snapshot => {
        const parts = splitTranslate(snapshot.baseTranslate || '0px 0px');
        const baseX = parts[0] || '0px';
        const baseY = parts[1] || '0px';
        const baseZ = parts[2] || '';
        const x = Math.abs(snapshot.offset.x) < 0.001
          ? baseX
          : 'calc(' + baseX + ' + ' + snapshot.offset.x + 'px)';
        const y = Math.abs(snapshot.offset.y) < 0.001
          ? baseY
          : 'calc(' + baseY + ' + ' + snapshot.offset.y + 'px)';
        snapshot.element.style.translate = x + ' ' + y + (baseZ ? ' ' + baseZ : '');
      };
      const returnSnapshot = snapshot => {
        magnetized.delete(snapshot.element);
        activeTweens.push(motionEngine.to(snapshot.offset, {
          x: 0,
          y: 0,
          duration: Math.max(0.01, Number(behavior.returnDuration) || 0.55),
          ease: 'power3.out',
          overwrite: true,
          onUpdate: () => applyOffset(snapshot),
          onComplete: () => {
            snapshot.element.style.translate = snapshot.translate;
            snapshot.element.style.willChange = snapshot.willChange;
          },
        }));
      };
      const reset = () => {
        if (pointerFrame) editorCancelFrame(pointerFrame);
        pointerFrame = 0;
        activeTweens.splice(0).forEach(tween => tween?.kill?.());
        snapshots.forEach(returnSnapshot);
      };
      const renderPointer = () => {
        pointerFrame = 0;
        targets.forEach(element => {
          const snapshot = snapshotByElement.get(element);
          if (!snapshot) return;
          const bounds = element.getBoundingClientRect();
          const centerX = bounds.left + bounds.width / 2 - snapshot.offset.x;
          const centerY = bounds.top + bounds.height / 2 - snapshot.offset.y;
          const dx = pointerX - centerX;
          const dy = pointerY - centerY;
          const distance = Math.hypot(dx, dy);
          const radius = Math.max(bounds.width, bounds.height) / 2 + Math.max(0, Number(behavior.radius) || 0);
          if (distance > radius) {
            if (magnetized.has(element)) {
              returnSnapshot(snapshot);
            }
            return;
          }
          magnetized.add(element);
          const falloff = 1 - distance / Math.max(1, radius);
          const strength = Math.max(0, Math.min(1, Number(behavior.strength) || 0));
          element.style.willChange = 'translate';
          activeTweens.push(motionEngine.to(snapshot.offset, {
            x: dx * strength * falloff,
            y: dy * strength * falloff,
            duration: Math.max(0.01, Number(behavior.smoothing) || 0.28),
            ease: 'power2.out',
            overwrite: true,
            onUpdate: () => applyOffset(snapshot),
          }));
          if (activeTweens.length > 32) activeTweens.splice(0, 16).forEach(tween => tween?.kill?.());
        });
      };
      const move = event => {
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (!pointerFrame) pointerFrame = editorRequestFrame(renderPointer);
      };
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (!editorFrozen && finePointer && !(reduced && interaction.reducedMotion !== 'allow')) {
        window.addEventListener('pointermove', move, { passive: true });
        window.addEventListener('blur', reset);
        document.documentElement.addEventListener('pointerleave', reset);
      }
      return behaviorController({
        interaction,
        targets,
        duration: 1,
        cleanup: () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('blur', reset);
          document.documentElement.removeEventListener('pointerleave', reset);
          if (pointerFrame) editorCancelFrame(pointerFrame);
          activeTweens.splice(0).forEach(tween => tween?.kill?.());
          snapshots.forEach(snapshot => {
            snapshot.element.style.translate = snapshot.translate;
            snapshot.element.style.willChange = snapshot.willChange;
          });
        },
      });
    };
    const installTextRollBehavior = (interaction, behavior, targets) => {
      const textTargets = targets.filter(element => (
        !element.children?.length && Boolean((element.textContent || '').trim())
      ));
      if (!textTargets.length) return null;
      const splitParts = text => {
        if (behavior.split === 'chars') {
          const Segmenter = globalThis.Intl?.Segmenter;
          if (typeof Segmenter === 'function') {
            return Array.from(
              new Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
              segment => segment.segment,
            );
          }
          return Array.from(text);
        }
        if (behavior.split === 'words') return text.match(/\\S+\\s*/g) || [text];
        return [text];
      };
      const snapshots = textTargets.map(element => ({
        element,
        html: element.innerHTML,
        text: (element.textContent || '').trim(),
        ariaLabel: element.getAttribute('aria-label'),
      }));
      const duration = Math.max(0.05, Number(behavior.duration) || 0.36);
      const stagger = Math.max(0, Math.min(0.5, Number(behavior.stagger) || 0));
      const distance = Math.max(20, Math.min(200, Number(behavior.distance) || 112));
      const previewDuration = Math.max(
        duration,
        ...snapshots.map(snapshot => (
          duration + Math.max(0, splitParts(snapshot.text).length - 1) * stagger
        )),
      );
      const records = [];
      let active = false;
      const createLine = (parts, copy) => {
        const line = document.createElement('span');
        // Keep the primary line in the accessibility tree; only the visual
        // duplicate is hidden, so generic inline targets retain their name.
        if (copy) line.setAttribute('aria-hidden', 'true');
        line.style.gridArea = '1 / 1';
        line.style.display = 'inline-flex';
        line.style.alignItems = 'center';
        line.style.whiteSpace = 'pre';
        const pieces = parts.map(part => {
          const piece = document.createElement('span');
          piece.style.display = 'inline-block';
          piece.style.whiteSpace = 'pre';
          piece.style.willChange = 'transform, opacity';
          piece.textContent = part;
          line.appendChild(piece);
          return piece;
        });
        if (copy) line.dataset.kodetyTextRollCopy = '';
        return { line, pieces };
      };
      const activate = () => {
        if (active) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced && interaction.reducedMotion !== 'allow') return;
        active = true;
        snapshots.forEach(snapshot => {
          const parts = splitParts(snapshot.text);
          const primary = createLine(parts, false);
          const copy = createLine(parts, true);
          const root = document.createElement('span');
          root.dataset.kodetyTextRoll = '';
          root.style.display = 'inline-grid';
          root.style.height = '1em';
          root.style.placeItems = 'center start';
          root.style.overflow = 'hidden';
          root.style.lineHeight = '1';
          root.style.verticalAlign = 'middle';
          root.append(primary.line, copy.line);
          snapshot.element.textContent = '';
          snapshot.element.appendChild(root);
          const timeline = motionEngine.timeline({ paused: true });
          timeline.to(primary.pieces, {
            opacity: 0,
            yPercent: -distance,
            duration,
            stagger,
            ease: 'power3.inOut',
          }, 0);
          timeline.fromTo(copy.pieces, {
            opacity: 0,
            yPercent: distance,
          }, {
            opacity: 1,
            yPercent: 0,
            duration,
            stagger,
            ease: 'power3.inOut',
          }, 0.01);
          const eventTarget = snapshot.element.closest?.('button, a, [tabindex]') || snapshot.element;
          let hovered = false;
          let focused = !editorFrozen && eventTarget === document.activeElement;
          const syncPointerState = () => (hovered || focused ? timeline.play() : timeline.reverse());
          const enter = () => { hovered = true; syncPointerState(); };
          const leave = () => { hovered = false; syncPointerState(); };
          const focus = () => { focused = true; syncPointerState(); };
          const blur = () => { focused = false; syncPointerState(); };
          if (!editorFrozen) {
            if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
              eventTarget.addEventListener('pointerenter', enter);
              eventTarget.addEventListener('pointerleave', leave);
            }
            eventTarget.addEventListener('focus', focus);
            eventTarget.addEventListener('blur', blur);
            if (focused) timeline.play();
          }
          records.push({ snapshot, root, timeline, eventTarget, enter, leave, focus, blur });
        });
      };
      const deactivate = () => {
        records.splice(0).forEach(record => {
          record.timeline.kill?.();
          record.eventTarget.removeEventListener('pointerenter', record.enter);
          record.eventTarget.removeEventListener('pointerleave', record.leave);
          record.eventTarget.removeEventListener('focus', record.focus);
          record.eventTarget.removeEventListener('blur', record.blur);
          if (
            record.snapshot.element.childNodes.length === 1
            && record.snapshot.element.firstChild === record.root
          ) {
            record.snapshot.element.innerHTML = record.snapshot.html;
            if (record.snapshot.ariaLabel === null) record.snapshot.element.removeAttribute('aria-label');
            else record.snapshot.element.setAttribute('aria-label', record.snapshot.ariaLabel);
          }
        });
        active = false;
      };
      const render = progress => {
        activate();
        records.forEach(record => record.timeline.progress(progress).pause());
      };
      if (!editorFrozen) activate();
      return behaviorController({
        interaction,
        targets: textTargets,
        duration: previewDuration,
        render,
        pause: () => records.forEach(record => record.timeline.pause()),
        release: deactivate,
        cleanup: deactivate,
      });
    };
    const installTickerBehavior = (interaction, behavior, targets) => {
      const tickerTargets = targets.filter(element => (
        !/^(?:AREA|BASE|BR|COL|EMBED|HR|IMG|INPUT|LINK|META|PARAM|SOURCE|TRACK|WBR)$/.test(element.tagName)
        && element.childNodes?.length
      ));
      if (!tickerTargets.length) return null;
      const speed = Math.max(4, Math.min(1000, Number(behavior.speed) || 56));
      const gap = Math.max(0, Math.min(1024, Number(behavior.gap) || 0));
      const direction = behavior.direction === 'right' ? -1 : 1;
      const hoverBehavior = ['none', 'pause', 'slow'].includes(behavior.hoverBehavior)
        ? behavior.hoverBehavior
        : 'slow';
      const hoverSlowdown = Math.max(0.02, Math.min(1, Number(behavior.hoverSlowdown) || 0.18));
      const hoverTransition = Math.max(0.01, Math.min(2, Number(behavior.hoverTransition) || 0.24));
      const draggable = behavior.draggable !== false;
      const dragSensitivity = Math.max(0.1, Math.min(4, Number(behavior.dragSensitivity) || 1));
      const momentum = Math.max(0, Math.min(0.98, Number(behavior.momentum) || 0));
      const records = [];
      let playbackFrame = 0;
      let measureFrame = 0;
      let previousTime = 0;
      let running = false;
      let active = false;
      let destroyed = false;
      const positiveModulo = (value, divisor) => (
        divisor > 0 ? ((value % divisor) + divisor) % divisor : 0
      );
      const scrubDuplicateIdentity = clone => {
        clone.dataset.kodetyTickerClone = '';
        clone.setAttribute('aria-hidden', 'true');
        clone.inert = true;
        clone.style.pointerEvents = 'none';
        Array.from(clone.querySelectorAll('[id], [data-kodety-interaction-id]')).forEach(element => {
          element.removeAttribute('id');
          element.removeAttribute('data-kodety-interaction-id');
        });
        return clone;
      };
      const renderRecord = record => {
        if (!record.cycleWidth) return;
        const wrapped = positiveModulo(record.phase, record.cycleWidth);
        const x = -record.baseOffset - wrapped;
        record.track.style.transform = 'translate3d(' + x + 'px, 0, 0)';
      };
      const refreshRecord = record => {
        if (destroyed || !record.target.isConnected || !record.group.isConnected) return;
        const groupWidth = record.group.getBoundingClientRect().width;
        const cycleWidth = groupWidth + gap;
        if (!(cycleWidth > 0.5)) return;
        const sideCopies = Math.max(
          2,
          Math.ceil(Math.max(1, record.target.clientWidth) / cycleWidth) + 1,
        );
        const before = Array.from({ length: sideCopies }, () => (
          scrubDuplicateIdentity(record.group.cloneNode(true))
        ));
        const after = Array.from({ length: sideCopies }, () => (
          scrubDuplicateIdentity(record.group.cloneNode(true))
        ));
        record.mutationObserver?.disconnect();
        record.track.replaceChildren(...before, record.group, ...after);
        record.cycleWidth = cycleWidth;
        record.baseOffset = sideCopies * cycleWidth;
        record.phase = positiveModulo(record.phase, cycleWidth);
        record.mutationObserver?.observe(record.group, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        renderRecord(record);
      };
      const scheduleMeasure = () => {
        if (destroyed || measureFrame) return;
        measureFrame = editorRequestFrame(() => {
          measureFrame = 0;
          records.forEach(refreshRecord);
        });
      };
      const activate = () => {
        if (active || destroyed) return;
        active = true;
        tickerTargets.forEach(target => {
          const styleSnapshot = {
            overflow: target.style.overflow,
            touchAction: target.style.touchAction,
            cursor: target.style.cursor,
            userSelect: target.style.userSelect,
          };
          const originalNodes = Array.from(target.childNodes);
          const track = document.createElement('div');
          const group = document.createElement('div');
          track.dataset.kodetyTickerTrack = '';
          group.dataset.kodetyTickerGroup = '';
          track.style.display = 'flex';
          track.style.alignItems = 'center';
          track.style.width = 'max-content';
          track.style.maxWidth = 'none';
          track.style.gap = gap + 'px';
          track.style.willChange = 'transform';
          track.style.transform = 'translate3d(0, 0, 0)';
          group.style.display = 'flex';
          group.style.flex = '0 0 auto';
          group.style.alignItems = 'center';
          group.style.width = 'max-content';
          group.style.maxWidth = 'none';
          group.style.gap = gap + 'px';
          group.append(...originalNodes);
          track.appendChild(group);
          target.replaceChildren(track);
          target.style.overflow = 'hidden';
          if (draggable) {
            target.style.touchAction = 'pan-y';
            target.style.cursor = 'grab';
            target.style.userSelect = 'none';
          }
          const record = {
            target,
            track,
            group,
            styleSnapshot,
            cycleWidth: 0,
            baseOffset: 0,
            phase: 0,
            hoverRate: 1,
            hovered: false,
            dragging: false,
            pointerId: null,
            pointerX: 0,
            pointerTime: 0,
            dragDistance: 0,
            dragVelocity: 0,
            momentumVelocity: 0,
            suppressClickUntil: 0,
            resizeObserver: null,
            mutationObserver: null,
          };
          const enter = () => { record.hovered = true; };
          const leave = () => { record.hovered = false; };
          const down = event => {
            if (!draggable || record.dragging || (event.button !== undefined && event.button !== 0)) return;
            record.dragging = true;
            record.pointerId = event.pointerId;
            record.pointerX = event.clientX;
            record.pointerTime = event.timeStamp || editorNow();
            record.dragDistance = 0;
            record.dragVelocity = 0;
            record.momentumVelocity = 0;
            record.target.style.cursor = 'grabbing';
            try { record.target.setPointerCapture?.(event.pointerId); } catch {}
          };
          const move = event => {
            if (!record.dragging || event.pointerId !== record.pointerId) return;
            const now = event.timeStamp || editorNow();
            const deltaX = event.clientX - record.pointerX;
            const deltaTime = Math.max(8, Math.min(80, now - record.pointerTime)) / 1000;
            record.pointerX = event.clientX;
            record.pointerTime = now;
            record.dragDistance += Math.abs(deltaX);
            record.phase -= deltaX * dragSensitivity;
            const velocity = (-deltaX * dragSensitivity) / deltaTime;
            record.dragVelocity = record.dragVelocity * 0.62 + velocity * 0.38;
            if (record.dragDistance > 3) event.preventDefault();
            renderRecord(record);
          };
          const finishDrag = event => {
            if (!record.dragging || (event.pointerId !== undefined && event.pointerId !== record.pointerId)) return;
            const moved = record.dragDistance > 3;
            record.dragging = false;
            record.pointerId = null;
            record.momentumVelocity = moved ? record.dragVelocity * momentum : 0;
            record.target.style.cursor = draggable ? 'grab' : styleSnapshot.cursor;
            if (moved) record.suppressClickUntil = editorNow() + 280;
            try {
              if (event.pointerId !== undefined && record.target.hasPointerCapture?.(event.pointerId)) {
                record.target.releasePointerCapture(event.pointerId);
              }
            } catch {}
          };
          const click = event => {
            if (editorNow() >= record.suppressClickUntil) return;
            event.preventDefault();
            event.stopImmediatePropagation();
          };
          record.enter = enter;
          record.leave = leave;
          record.down = down;
          record.move = move;
          record.finishDrag = finishDrag;
          record.click = click;
          if (!editorFrozen) {
            target.addEventListener('pointerenter', enter, { passive: true });
            target.addEventListener('pointerleave', leave, { passive: true });
            if (draggable) {
              target.addEventListener('pointerdown', down);
              target.addEventListener('pointermove', move);
              target.addEventListener('pointerup', finishDrag);
              target.addEventListener('pointercancel', finishDrag);
              target.addEventListener('lostpointercapture', finishDrag);
              target.addEventListener('click', click, true);
            }
          }
          if (typeof ResizeObserver === 'function') {
            record.resizeObserver = new ResizeObserver(scheduleMeasure);
            record.resizeObserver.observe(target);
            record.resizeObserver.observe(group);
          }
          if (typeof MutationObserver === 'function') {
            record.mutationObserver = new MutationObserver(scheduleMeasure);
            record.mutationObserver.observe(group, {
              childList: true,
              subtree: true,
              characterData: true,
              attributes: true,
            });
          }
          records.push(record);
          refreshRecord(record);
        });
        document.fonts?.ready?.then(() => {
          if (!destroyed) scheduleMeasure();
        });
      };
      const stop = () => {
        running = false;
        previousTime = 0;
        if (playbackFrame) editorCancelFrame(playbackFrame);
        playbackFrame = 0;
      };
      const tick = now => {
        playbackFrame = 0;
        if (!running || destroyed) return;
        const delta = previousTime
          ? Math.max(0, Math.min(0.08, previewDelta(now, previousTime) / 1000))
          : 0;
        previousTime = now;
        records.forEach(record => {
          if (!record.cycleWidth || record.dragging) return;
          const hoverTarget = !record.hovered || hoverBehavior === 'none'
            ? 1
            : hoverBehavior === 'pause'
              ? 0
              : hoverSlowdown;
          const blend = delta > 0 ? 1 - Math.exp(-delta / hoverTransition) : 1;
          record.hoverRate += (hoverTarget - record.hoverRate) * blend;
          record.phase += direction * speed * record.hoverRate * delta;
          if (Math.abs(record.momentumVelocity) > 0.1) {
            record.phase += record.momentumVelocity * delta;
            record.momentumVelocity *= Math.pow(Math.max(0.001, momentum), delta * 60);
          } else record.momentumVelocity = 0;
          renderRecord(record);
        });
        playbackFrame = editorRequestFrame(tick);
      };
      const start = restart => {
        activate();
        if (restart) records.forEach(record => {
          record.phase = 0;
          record.momentumVelocity = 0;
          renderRecord(record);
        });
        if (running || destroyed) return;
        running = true;
        previousTime = 0;
        playbackFrame = editorRequestFrame(tick);
      };
      const deactivate = () => {
        stop();
        if (measureFrame) editorCancelFrame(measureFrame);
        measureFrame = 0;
        records.splice(0).forEach(record => {
          record.resizeObserver?.disconnect();
          record.mutationObserver?.disconnect();
          record.target.removeEventListener('pointerenter', record.enter);
          record.target.removeEventListener('pointerleave', record.leave);
          record.target.removeEventListener('pointerdown', record.down);
          record.target.removeEventListener('pointermove', record.move);
          record.target.removeEventListener('pointerup', record.finishDrag);
          record.target.removeEventListener('pointercancel', record.finishDrag);
          record.target.removeEventListener('lostpointercapture', record.finishDrag);
          record.target.removeEventListener('click', record.click, true);
          if (record.target.childNodes.length === 1 && record.target.firstChild === record.track) {
            record.target.replaceChildren(...Array.from(record.group.childNodes));
          }
          record.target.style.overflow = record.styleSnapshot.overflow;
          record.target.style.touchAction = record.styleSnapshot.touchAction;
          record.target.style.cursor = record.styleSnapshot.cursor;
          record.target.style.userSelect = record.styleSnapshot.userSelect;
        });
        active = false;
      };
      const render = progress => {
        activate();
        records.forEach(record => {
          record.phase = record.cycleWidth * Math.max(0, Math.min(1, progress));
          renderRecord(record);
        });
      };
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!editorFrozen && !(reduced && interaction.reducedMotion !== 'allow')) start(false);
      return behaviorController({
        interaction,
        targets: tickerTargets,
        duration: Math.max(1, 640 / speed),
        render,
        play: start,
        pause: stop,
        release: deactivate,
        cleanup: () => {
          destroyed = true;
          deactivate();
        },
      });
    };
    const installImageSequenceBehavior = (interaction, behavior, targets) => {
      const images = uniqueElements(targets.flatMap(element => (
        element.tagName === 'IMG' ? [element] : Array.from(element.querySelectorAll?.('img') || []).slice(0, 1)
      )));
      if (!images.length || !/\\{index(?::\\d+)?\\}/.test(String(behavior.urlTemplate || ''))) return null;
      const snapshots = images.map(element => ({
        element,
        src: element.getAttribute('src'),
        srcset: element.getAttribute('srcset'),
        lastSrc: null,
      }));
      const cache = new Map();
      const cacheOrder = [];
      const loadQueue = [];
      let points = [];
      let desiredIndex = null;
      let frameRequest = 0;
      let activeLoads = 0;
      let destroyed = false;
      let lastMeasurement = 0;
      const startIndex = Math.max(0, Math.floor(Number(behavior.startIndex) || 0));
      const endIndex = Math.max(startIndex, Math.floor(Number(behavior.endIndex) || startIndex));
      const clampedIndex = value => Math.max(startIndex, Math.min(endIndex, Math.round(value)));
      const pumpLoads = () => {
        while (!destroyed && activeLoads < 6 && loadQueue.length) {
          const job = loadQueue.shift();
          if (cache.get(job.index) !== job.promise) {
            job.resolve('');
            continue;
          }
          activeLoads += 1;
          const loader = new Image();
          let settled = false;
          const finish = url => {
            if (settled) return;
            settled = true;
            activeLoads = Math.max(0, activeLoads - 1);
            job.resolve(destroyed ? '' : url);
            pumpLoads();
          };
          loader.onload = () => {
            const decoded = typeof loader.decode === 'function'
              ? loader.decode().catch(() => {})
              : Promise.resolve();
            decoded.then(() => finish(job.url));
          };
          loader.onerror = () => finish('');
          loader.src = job.url;
        }
      };
      const loadFrame = (index, priority = false) => {
        const normalizedIndex = clampedIndex(index);
        if (cache.has(normalizedIndex)) {
          if (priority) {
            const queuedIndex = loadQueue.findIndex(job => job.index === normalizedIndex);
            if (queuedIndex > 0) loadQueue.unshift(loadQueue.splice(queuedIndex, 1)[0]);
          }
          return cache.get(normalizedIndex);
        }
        const url = sequenceUrl(behavior.urlTemplate, normalizedIndex, behavior.zeroPad);
        let resolveFrame = () => {};
        const promise = new Promise(resolve => { resolveFrame = resolve; });
        cache.set(normalizedIndex, promise);
        cacheOrder.push({ index: normalizedIndex, promise });
        const job = { index: normalizedIndex, url, promise, resolve: resolveFrame };
        if (priority) loadQueue.unshift(job);
        else loadQueue.push(job);
        while (loadQueue.length > 96) {
          const skipped = loadQueue.pop();
          if (cache.get(skipped.index) === skipped.promise) cache.delete(skipped.index);
          skipped.resolve('');
        }
        while (cacheOrder.length > 64) {
          const expired = cacheOrder.shift();
          if (cache.get(expired.index) === expired.promise) cache.delete(expired.index);
        }
        pumpLoads();
        return promise;
      };
      const showFrame = rawIndex => {
        const index = clampedIndex(rawIndex);
        if (desiredIndex === index) return;
        desiredIndex = index;
        const radius = Math.max(0, Math.min(24, Number(behavior.preloadRadius) || 0));
        const desiredFrame = loadFrame(index, true);
        for (let distance = 1; distance <= radius; distance += 1) {
          loadFrame(index + distance);
          loadFrame(index - distance);
        }
        desiredFrame.then(url => {
          if (destroyed || !url || desiredIndex !== index) return;
          snapshots.forEach(snapshot => {
            snapshot.element.removeAttribute('srcset');
            snapshot.element.setAttribute('src', url);
            snapshot.lastSrc = url;
          });
        });
      };
      const refreshPoints = () => {
        points = milestonePoints(behavior);
        lastMeasurement = Date.now();
      };
      const renderScroll = () => {
        frameRequest = 0;
        if (Date.now() - lastMeasurement > 500) refreshPoints();
        showFrame(valueAcrossMilestones(points, window.scrollY || window.pageYOffset || 0));
      };
      const schedule = () => {
        if (!frameRequest) frameRequest = editorRequestFrame(renderScroll);
      };
      const resize = () => { refreshPoints(); schedule(); };
      const render = progress => showFrame(startIndex + (endIndex - startIndex) * progress);
      const restore = () => {
        desiredIndex = null;
        snapshots.forEach(snapshot => {
          if (snapshot.lastSrc !== null && snapshot.element.getAttribute('src') === snapshot.lastSrc) {
            if (snapshot.src === null) snapshot.element.removeAttribute('src');
            else snapshot.element.setAttribute('src', snapshot.src);
            if (snapshot.srcset === null) snapshot.element.removeAttribute('srcset');
            else snapshot.element.setAttribute('srcset', snapshot.srcset);
          }
          snapshot.lastSrc = null;
        });
      };
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!editorFrozen) {
        refreshPoints();
        if (reduced && interaction.reducedMotion === 'end') render(1);
        else if (!(reduced && interaction.reducedMotion === 'skip')) {
          window.addEventListener('scroll', schedule, { passive: true });
          window.addEventListener('resize', resize, { passive: true });
          window.addEventListener('load', resize, { once: true });
          document.fonts?.ready?.then(() => { if (!destroyed) resize(); });
          renderScroll();
        }
      }
      return behaviorController({
        interaction,
        targets: images,
        duration: 1,
        render,
        release: restore,
        cleanup: () => {
          destroyed = true;
          window.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', resize);
          window.removeEventListener('load', resize);
          if (frameRequest) editorCancelFrame(frameRequest);
          loadQueue.splice(0).forEach(job => job.resolve(''));
          restore();
          cache.clear();
        },
      });
    };
    const installVideoScrubBehavior = (interaction, behavior, targets) => {
      const videos = uniqueElements(targets.flatMap(element => (
        element.tagName === 'VIDEO' ? [element] : Array.from(element.querySelectorAll?.('video') || []).slice(0, 1)
      )));
      if (!videos.length) return null;
      const snapshots = videos.map(element => ({
        element,
        time: Number(element.currentTime) || 0,
        preload: element.getAttribute('preload'),
        muted: Boolean(element.muted),
        defaultMuted: Boolean(element.defaultMuted),
        playsInline: element.getAttribute('playsinline'),
        paused: Boolean(element.paused),
      }));
      const snapshotByVideo = new Map(snapshots.map(snapshot => [snapshot.element, snapshot]));
      let points = [];
      let frameRequest = 0;
      let targetTime = Number(behavior.startTime) || 0;
      let destroyed = false;
      let activated = false;
      let unlocked = false;
      let unlocking = false;
      let activationToken = 0;
      let lastMeasurement = 0;
      let controllerPaused = false;
      const fpsStep = 1 / 30;
      const maxTimeFor = video => {
        const authored = Math.max(0, Number(behavior.endTime) || 0);
        return Number.isFinite(video.duration) && video.duration > 0
          ? Math.max(0, Math.min(authored, video.duration - fpsStep))
          : authored;
      };
      const desiredTimeFor = video => Math.max(0, Math.min(maxTimeFor(video), targetTime));
      const advanceVideo = video => {
        if (destroyed || !activated || controllerPaused || video.readyState < 2 || video.seeking) return;
        const desired = desiredTimeFor(video);
        const delta = desired - (Number(video.currentTime) || 0);
        if (Math.abs(delta) < fpsStep) return;
        const smoothing = Math.max(0, Number(behavior.smoothing) || 0);
        const ratio = smoothing > 0 ? Math.max(0.18, Math.min(0.78, 1 - smoothing)) : 1;
        const step = smoothing > 0
          ? Math.min(Math.abs(delta), Math.max(Math.abs(delta) * ratio, fpsStep), 0.9)
          : Math.abs(delta);
        try { video.currentTime += Math.sign(delta) * step; } catch {}
      };
      const needsAdvance = video => (
        activated
        && !controllerPaused
        && video.readyState >= 2
        && !video.seeking
        && Math.abs((Number(video.currentTime) || 0) - desiredTimeFor(video)) >= fpsStep
      );
      const tick = () => {
        frameRequest = 0;
        videos.forEach(advanceVideo);
        if (videos.some(needsAdvance)) {
          frameRequest = editorRequestFrame(tick);
        }
      };
      const scheduleTick = () => {
        if (activated && !destroyed && !controllerPaused && !frameRequest) frameRequest = editorRequestFrame(tick);
      };
      const seeked = () => scheduleTick();
      const loaded = () => {
        if (destroyed || !activated) return;
        videos.forEach(video => video.pause?.());
        scheduleTick();
      };
      const detachUnlock = () => {
        document.removeEventListener('pointerdown', unlock);
        document.removeEventListener('touchstart', unlock);
      };
      const unlock = () => {
        if (editorFrozen || destroyed || !activated || unlocked || unlocking) return;
        unlocking = true;
        const token = activationToken;
        const attempts = videos.map(video => {
          video.muted = true;
          video.defaultMuted = true;
          video.setAttribute('playsinline', '');
          try {
            const promise = video.play?.();
            if (promise?.then) return promise.then(() => {
              if (destroyed || token !== activationToken || !activated) {
                if (snapshotByVideo.get(video)?.paused) video.pause?.();
                return false;
              }
              video.pause?.();
              return true;
            }).catch(() => false);
            video.pause?.();
            return Promise.resolve(true);
          } catch {
            return Promise.resolve(false);
          }
        });
        Promise.all(attempts).then(results => {
          if (destroyed || token !== activationToken) return;
          unlocked = results.some(Boolean);
          unlocking = false;
          if (unlocked) detachUnlock();
        });
      };
      const activate = () => {
        if (destroyed || activated) return;
        activated = true;
        activationToken += 1;
        videos.forEach(video => {
          video.pause?.();
          video.setAttribute('preload', 'auto');
          video.setAttribute('playsinline', '');
          video.addEventListener('loadedmetadata', loaded);
          video.addEventListener('loadeddata', loaded);
          video.addEventListener('seeked', seeked);
        });
        if (!editorFrozen) {
          document.addEventListener('pointerdown', unlock, { passive: true });
          document.addEventListener('touchstart', unlock, { passive: true });
        }
        if (videos.some(video => video.readyState >= 2)) scheduleTick();
      };
      const deactivate = () => {
        if (!activated) return;
        activated = false;
        activationToken += 1;
        unlocked = false;
        unlocking = false;
        controllerPaused = false;
        detachUnlock();
        if (frameRequest) editorCancelFrame(frameRequest);
        frameRequest = 0;
        snapshots.forEach(snapshot => {
          snapshot.element.pause?.();
          snapshot.element.removeEventListener('loadedmetadata', loaded);
          snapshot.element.removeEventListener('loadeddata', loaded);
          snapshot.element.removeEventListener('seeked', seeked);
          if (snapshot.preload === null) snapshot.element.removeAttribute('preload');
          else snapshot.element.setAttribute('preload', snapshot.preload);
          snapshot.element.muted = snapshot.muted;
          snapshot.element.defaultMuted = snapshot.defaultMuted;
          if (snapshot.playsInline === null) snapshot.element.removeAttribute('playsinline');
          else snapshot.element.setAttribute('playsinline', snapshot.playsInline);
          try { snapshot.element.currentTime = snapshot.time; } catch {}
          if (!editorFrozen && !snapshot.paused) {
            try { snapshot.element.play?.()?.catch?.(() => {}); } catch {}
          }
        });
      };
      const setTime = value => {
        targetTime = Math.max(0, Number(value) || 0);
        controllerPaused = false;
        activate();
        scheduleTick();
      };
      const refreshPoints = () => {
        points = milestonePoints(behavior);
        lastMeasurement = Date.now();
      };
      const renderScroll = () => {
        if (Date.now() - lastMeasurement > 500) refreshPoints();
        setTime(valueAcrossMilestones(points, window.scrollY || window.pageYOffset || 0));
      };
      const scroll = () => renderScroll();
      const resize = () => { refreshPoints(); renderScroll(); };
      const render = progress => {
        const start = Math.max(0, Number(behavior.startTime) || 0);
        const end = Math.max(0, Number(behavior.endTime) || 0);
        setTime(start + (end - start) * progress);
      };
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!editorFrozen) {
        refreshPoints();
        if (reduced && interaction.reducedMotion === 'end') render(1);
        else if (!(reduced && interaction.reducedMotion === 'skip')) {
          activate();
          window.addEventListener('scroll', scroll, { passive: true });
          window.addEventListener('resize', resize, { passive: true });
          window.addEventListener('load', resize, { once: true });
          document.fonts?.ready?.then(() => { if (!destroyed) resize(); });
          renderScroll();
        }
      }
      return behaviorController({
        interaction,
        targets: videos,
        duration: 1,
        render,
        pause: () => {
          controllerPaused = true;
          if (frameRequest) editorCancelFrame(frameRequest);
          frameRequest = 0;
        },
        release: deactivate,
        cleanup: () => {
          destroyed = true;
          window.removeEventListener('scroll', scroll);
          window.removeEventListener('resize', resize);
          window.removeEventListener('load', resize);
          deactivate();
        },
      });
    };
    const installBehavior = (interaction, triggerElements) => {
      const behavior = interaction.behavior;
      if (!behavior) return null;
      const targets = behaviorTargetsFor(behavior, triggerElements);
      if (behavior.kind === 'count-up') return installCountUpBehavior(interaction, behavior, targets);
      if (behavior.kind === 'magnetic') return installMagneticBehavior(interaction, behavior, targets);
      if (behavior.kind === 'text-roll') return installTextRollBehavior(interaction, behavior, targets);
      if (behavior.kind === 'ticker') return installTickerBehavior(interaction, behavior, targets);
      if (behavior.kind === 'image-sequence') return installImageSequenceBehavior(interaction, behavior, targets);
      if (behavior.kind === 'video-scrub') return installVideoScrubBehavior(interaction, behavior, targets);
      return null;
    };
    let componentRegistryCache;
    const componentRegistry = () => {
      if (componentRegistryCache !== undefined) return componentRegistryCache;
      try {
        componentRegistryCache = JSON.parse(
          document.querySelector('script[data-kodety-component-registry]')?.textContent || '{"version":1,"components":[]}',
        );
      } catch {
        componentRegistryCache = { version: 1, components: [] };
      }
      return componentRegistryCache;
    };
    const decodeComponentOverrides = value => {
      if (!value) return {};
      try {
        const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
        const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const decoded = JSON.parse(new TextDecoder().decode(bytes));
        return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {};
      } catch {
        return {};
      }
    };
    const componentNode = (root, id) => {
      if (!id) return root;
      if (root.getAttribute?.('data-kodety-component-node') === id) return root;
      return Array.from(root.querySelectorAll?.('[data-kodety-component-node]') || [])
        .find(element => element.getAttribute('data-kodety-component-node') === id) || null;
    };
    const componentVariableBindings = variable => {
      const bindings = Array.isArray(variable.bindings) && variable.bindings.length
        ? variable.bindings
        : variable.targetNodeId
          ? [{ targetNodeId: variable.targetNodeId, attribute: variable.attribute || '' }]
          : [];
      const seen = new Set();
      return bindings.filter(binding => {
        if (!binding?.targetNodeId) return false;
        const key = String(binding.targetNodeId) + '\u0000' + String(binding.attribute || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const componentRootVariantVariable = component => component.variables?.find?.(
      variable => variable.type === 'variant' && componentVariableBindings(variable).length === 0,
    );
    const applyComponentVariable = (root, variable, value) => {
      const authored = value ?? variable.defaultValue ?? '';
      const next = variable.runtimeValues?.[String(authored)] ?? authored;
      const bindings = componentVariableBindings(variable);
      if (variable.type === 'variant' && !bindings.length) return;
      bindings.forEach(binding => {
        const target = componentNode(root, binding.targetNodeId);
        if (!target) return;
        if (variable.type === 'variant') {
          if (!target.hasAttribute('data-kodety-component-id')) return;
          const attribute = binding.attribute || 'data-kodety-component-variant';
          if (next === '') target.removeAttribute(attribute);
          else target.setAttribute(attribute, String(next));
        }
        else if (variable.type === 'rich_text') {
          if (binding.attribute) {
            if (next === '') target.removeAttribute(binding.attribute);
            else target.setAttribute(binding.attribute, String(next));
          } else target.innerHTML = String(next);
        }
        else if (variable.type === 'text' || variable.type === 'number') {
          if (binding.attribute) {
            if (next === '') target.removeAttribute(binding.attribute);
            else target.setAttribute(binding.attribute, String(next));
          } else target.textContent = String(next);
        }
        else {
          const attribute = binding.attribute
            || (variable.type === 'link' ? 'href' : variable.type === 'icon' ? 'data-icon' : 'src');
          if (next === '') target.removeAttribute(attribute);
          else target.setAttribute(attribute, String(next));
        }
      });
    };
    const componentEditorRootFor = element => {
      const body = document.body?.hasAttribute?.('data-kodety-component-editor')
        ? document.body
        : null;
      if (!body) return { body: null, root: null };
      const root = body.firstElementChild;
      if (!root) return { body, root: null };
      return (
        element === body
        || element === root
        || root.contains?.(element)
      ) ? { body, root } : { body, root: null };
    };
    const effectiveComponentVariantId = (root, component, editorBody) => {
      const variantExists = id => Boolean(
        id && component.variants?.some?.(variant => variant.id === id)
      );
      const runtimeVariantId = root.__kodetyComponentRuntimeVariantId || '';
      if (variantExists(runtimeVariantId)) return runtimeVariantId;
      const overrides = decodeComponentOverrides(
        root.getAttribute('data-kodety-component-overrides') || '',
      );
      const variantVariable = componentRootVariantVariable(component);
      const overrideVariantId = variantVariable
        && Object.prototype.hasOwnProperty.call(overrides, variantVariable.id)
        ? overrides[variantVariable.id]
        : '';
      if (variantExists(overrideVariantId)) return overrideVariantId;
      const editorVariantId = editorBody?.getAttribute(
        'data-kodety-component-variant-editor',
      ) || '';
      if (variantExists(editorVariantId)) return editorVariantId;
      const authoredVariantId = root.getAttribute('data-kodety-component-variant') || '';
      if (variantExists(authoredVariantId)) return authoredVariantId;
      if (variantExists(variantVariable?.defaultValue)) return variantVariable.defaultValue;
      return component.variants?.[0]?.id || '';
    };
    let componentVariantTransitionSequence = 0;
    const componentVariantCssEase = value => {
      const ease = String(value || '').trim();
      if (/^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/i.test(ease)) return ease;
      if (
        (ease.startsWith('cubic-bezier(') || ease.startsWith('steps('))
        && ease.endsWith(')')
      ) return ease;
      return 'cubic-bezier(.22, 1, .36, 1)';
    };
    const animateComponentVariantMutation = (root, action, mutation) => {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const duration = Math.max(180, (Number(action.duration) || .3) * 1000);
      if (reduced) {
        mutation();
        return;
      }
      const startViewTransition = document.startViewTransition?.bind(document);
      if (startViewTransition) {
        root.__kodetyComponentViewTransition?.skipTransition?.();
        componentVariantTransitionSequence += 1;
        const transitionName = 'kodety-component-' + componentVariantTransitionSequence;
        const previousName = root.style.viewTransitionName;
        root.style.viewTransitionName = transitionName;
        const style = document.createElement('style');
        style.textContent =
          '::view-transition-old(' + transitionName + '),'
          + '::view-transition-new(' + transitionName + '){'
          + 'animation-duration:' + duration + 'ms;'
          + 'animation-timing-function:' + componentVariantCssEase(action.ease) + ';'
          + '}';
        document.head.append(style);
        try {
          const transition = startViewTransition(mutation);
          root.__kodetyComponentViewTransition = transition;
          // Starting a newer component transition deliberately skips the
          // previous one. The View Transition API rejects the ready promise
          // with an AbortError even though the mutation still completed.
          // Mark both lifecycle promises as observed so a normal replacement
          // never escapes as an unhandledrejection in the canvas/editor.
          transition.ready.catch(() => undefined);
          transition.updateCallbackDone.catch(() => undefined);
          const cleanup = () => {
            if (root.__kodetyComponentViewTransition === transition) {
              root.__kodetyComponentViewTransition = null;
            }
            root.style.viewTransitionName = previousName;
            style.remove();
          };
          transition.finished.then(cleanup, cleanup);
          return;
        } catch {
          style.remove();
          root.style.viewTransitionName = previousName;
        }
      }
      mutation();
      // Safari/older Chromium fallback: the state still changes immediately,
      // but its painted arrival is eased instead of flashing abruptly.
      root.animate?.([
        { opacity: .55, transform: 'translateZ(0) scale(.995)' },
        { opacity: 1, transform: 'translateZ(0) scale(1)' },
      ], {
        duration,
        easing: componentVariantCssEase(action.ease),
        fill: 'both',
      });
    };
    const materializeNestedComponentRoots = (ownerRoot, stack = []) => {
      const nestedRoots = Array.from(
        ownerRoot.querySelectorAll?.('[data-kodety-component-id]') || [],
      ).filter(element => (
        element.parentElement?.closest?.('[data-kodety-component-id]') === ownerRoot
      ));
      nestedRoots.forEach(element => {
        const nestedComponentId = element.getAttribute('data-kodety-component-id') || '';
        if (!nestedComponentId || stack.includes(nestedComponentId)) return;
        const nestedComponent = componentRegistry().components?.find?.(
          item => item.id === nestedComponentId,
        );
        if (!nestedComponent) return;
        const encodedOverrides = element.getAttribute('data-kodety-component-overrides') || '';
        const overrides = decodeComponentOverrides(encodedOverrides);
        const rootVariantVariable = componentRootVariantVariable(nestedComponent);
        const variantExists = id => Boolean(
          id && nestedComponent.variants?.some?.(variant => variant.id === id)
        );
        const authoredVariantId = element.getAttribute('data-kodety-component-variant') || '';
        const baseVariantId = variantExists(authoredVariantId)
          ? authoredVariantId
          : variantExists(rootVariantVariable?.defaultValue)
            ? rootVariantVariable.defaultValue
            : nestedComponent.variants?.[0]?.id || '';
        const overrideVariantId = rootVariantVariable
          && Object.prototype.hasOwnProperty.call(overrides, rootVariantVariable.id)
          ? overrides[rootVariantVariable.id]
          : '';
        const stateVariantId = variantExists(overrideVariantId)
          ? overrideVariantId
          : baseVariantId;
        const variant = nestedComponent.variants?.find?.(
          item => item.id === stateVariantId,
        );
        if (!variant?.markup) return;
        const template = document.createElement('template');
        template.innerHTML = variant.markup.trim();
        const replacement = template.content.firstElementChild;
        if (!replacement) return;
        (nestedComponent.variables || []).forEach(variable => {
          applyComponentVariable(
            replacement,
            variable,
            Object.prototype.hasOwnProperty.call(overrides, variable.id)
              ? overrides[variable.id]
              : variable.defaultValue,
          );
        });
        replacement.setAttribute('data-kodety-component-id', nestedComponent.id);
        replacement.setAttribute('data-kodety-component-variant', baseVariantId);
        replacement.setAttribute('data-kodety-component-state-variant', stateVariantId);
        replacement.setAttribute(
          'data-kodety-component-instance',
          element.getAttribute('data-kodety-component-instance')
            || nestedComponent.id + '-' + Math.random().toString(36).slice(2),
        );
        replacement.setAttribute('data-label', nestedComponent.name || 'Component');
        if (encodedOverrides) {
          replacement.setAttribute('data-kodety-component-overrides', encodedOverrides);
        }
        materializeNestedComponentRoots(replacement, [...stack, nestedComponentId]);
        element.replaceWith(replacement);
      });
    };
    const switchComponentVariant = (element, action, reversing) => {
      const editorComponent = componentEditorRootFor(element);
      const root = element.closest?.('[data-kodety-component-id]')
        || (element.matches?.('[data-kodety-component-id]') ? element : null)
        // A component master intentionally has no instance attributes. Runtime
        // Preview still owns a concrete component root: the first child of its
        // data-kodety-component-editor body.
        || editorComponent.root;
      if (!root) return;
      const componentId = root.getAttribute('data-kodety-component-id')
        || editorComponent.body?.getAttribute('data-kodety-component-editor')
        || '';
      // A Set Variant action is scoped to one component definition. Never let
      // an action authored for component A replace an instance of component B,
      // even when a broad/custom target selector happens to match both.
      if (!componentId || (action.componentId && action.componentId !== componentId)) return;
      const component = componentRegistry().components?.find?.(item => item.id === componentId);
      if (!component) return;
      const variantSnapshots = root.__kodetyComponentVariantSnapshots instanceof Map
        ? root.__kodetyComponentVariantSnapshots
        : new Map();
      root.__kodetyComponentVariantSnapshots = variantSnapshots;
      const currentVariantId = effectiveComponentVariantId(
        root,
        component,
        editorComponent.body,
      );
      if (!reversing && !variantSnapshots.has(action.id)) {
        variantSnapshots.set(action.id, currentVariantId);
      }
      const requestedVariantId = reversing
        ? variantSnapshots.get(action.id) || ''
        : action.componentVariantId;
      if (!requestedVariantId) return;
      // Deleted/renamed targets are stale authored actions. Do not silently
      // jump to the first variant: that makes hover-out and click-toggle mutate
      // the layout to an unrelated state and conceals the broken reference.
      const variant = component.variants?.find?.(item => item.id === requestedVariantId);
      if (!variant?.markup) return;
      const template = document.createElement('template');
      template.innerHTML = variant.markup.trim();
      const replacement = template.content.firstElementChild;
      if (!replacement) return;
      const instanceId = root.getAttribute('data-kodety-component-instance') || '';
      const encodedOverrides = root.getAttribute('data-kodety-component-overrides') || '';
      const controllingInteractionId = root.getAttribute('data-kodety-interaction-id') || '';
      const overrides = decodeComponentOverrides(encodedOverrides);
      (component.variables || []).forEach(variable => {
        applyComponentVariable(
          replacement,
          variable,
          Object.prototype.hasOwnProperty.call(overrides, variable.id)
            ? overrides[variable.id]
            : variable.defaultValue,
        );
      });
      replacement.setAttribute('data-kodety-component-id', component.id);
      replacement.setAttribute('data-kodety-component-variant', variant.id);
      replacement.setAttribute('data-kodety-component-state-variant', variant.id);
      if (instanceId) replacement.setAttribute('data-kodety-component-instance', instanceId);
      if (encodedOverrides) replacement.setAttribute('data-kodety-component-overrides', encodedOverrides);
      replacement.setAttribute('data-label', component.name || 'Component');
      materializeNestedComponentRoots(replacement, [component.id]);
      // Keep the pre-transition state on the live root so reverse can restore
      // it after hover-out or the second click of a toggle interaction.
      replacement.__kodetyComponentVariantSnapshots = variantSnapshots;
      animateComponentVariantMutation(root, action, () => {
        // State variants keep one live component root. Morphing its attributes
        // and children preserves the hover/click listeners and the exact instance
        // identity even if a variant was authored with a different root tag.
        // The component returns to its authored tag on the next canonical render.
        Array.from(root.attributes).forEach(attribute => root.removeAttribute(attribute.name));
        Array.from(replacement.attributes).forEach(attribute => root.setAttribute(attribute.name, attribute.value));
        // Compatibility for quick events authored before the stable master-root
        // selector existed: retain the controller's root identity across the
        // morph so its hover-out / second toggle click can still reverse.
        if (controllingInteractionId) {
          root.setAttribute('data-kodety-interaction-id', controllingInteractionId);
        }
        root.innerHTML = replacement.innerHTML;
        root.__kodetyComponentRuntimeVariantId = variant.id;
        root.dispatchEvent(new CustomEvent('kodety:component-variant', {
          bubbles: true,
          detail: { componentId: component.id, variantId: variant.id, instanceId },
        }));
      });
      if (reversing) variantSnapshots.delete(action.id);
    };
    const perform = (action, elements, reversing) => {
      const actionClassTokens = action.kind.startsWith('class-')
        ? classTokens(action.className)
        : [];
      if (action.kind.startsWith('class-') && !actionClassTokens.length) {
        return;
      }
      if (
        reversing
        && (
          action.kind === 'event'
          || action.kind === 'lottie'
          || action.kind === 'rive'
          || action.kind === 'spline'
        )
      ) return;
      if (action.kind === 'class-add') elements.forEach(element => {
        actionClassTokens.forEach(className => {
          element.classList[reversing ? 'remove' : 'add'](className);
        });
      });
      else if (action.kind === 'class-remove') elements.forEach(element => {
        actionClassTokens.forEach(className => {
          element.classList[reversing ? 'add' : 'remove'](className);
        });
      });
      else if (action.kind === 'class-toggle') elements.forEach(element => {
        actionClassTokens.forEach(className => {
          element.classList.toggle(className);
        });
      });
      else if (action.kind === 'event') elements.forEach(element => element.dispatchEvent(new CustomEvent(action.eventName, { bubbles: true, detail: { interaction: action.id } })));
      else if (action.kind === 'lottie') elements.forEach(element => { const player = element.getLottie?.() || element; player[action.inputName || 'play']?.(); });
      else if (action.kind === 'rive') elements.forEach(element => {
        const input = element.rive?.stateMachineInputs?.find?.(item => item.name === action.inputName);
        if (!input) return;
        if (typeof input.fire === 'function' && action.inputValue === true) input.fire(); else input.value = action.inputValue;
      });
      else if (action.kind === 'spline') elements.forEach(element => { if (element.spline?.setVariable) element.spline.setVariable(action.inputName, action.inputValue); });
      else if (action.kind === 'component-variant') elements.forEach(element => switchComponentVariant(element, action, reversing));
    };
    const timelineFor = (
      interaction,
      triggerElement,
      previewTargets,
      classTargets,
    ) => {
      const timeline = motionEngine.timeline({ paused: true, repeat: runtimeRepeat(interaction.repeat), yoyo: interaction.yoyo });
      timeline.__kodetyTraversalBackward = false;
      timeline.__kodetyLastRenderedTime = 0;
      timeline.__kodetyLastRenderedIteration = 1;
      const initialStates = [];
      try {
        interaction.actions.forEach(action => {
        const elements = targetsFor(action.target, triggerElement, action.textSplit || 'none');
        if (!elements.length) return;
        elements.forEach(element => {
          previewTargets.add(element);
          captureInlineStyle(setupInlineStyleSnapshots, element);
        });
        if (action.kind.startsWith('class-')) {
          classTokens(action.className).forEach(className => {
            classTargets.push({
              elements,
              className,
            });
            elements.forEach(element => {
              captureClassToken(
                setupClassTokenSnapshots,
                element,
                className,
              );
            });
          });
        }
        const start = nonNegativeTiming(action.start);
        const repeat = runtimeRepeat(action.repeat);
        const repeatDelay = nonNegativeTiming(action.repeatDelay);
        const actionDuration = nonNegativeTiming(action.duration);
        const staggerEach = Number.isFinite(Number(action.stagger)) ? Number(action.stagger) : 0;
        const stagger = staggerEach ? { each: staggerEach, from: action.staggerFrom || 'start' } : 0;
        if (action.kind === 'animate') {
          if (skipStartupMotion) {
            const lastFrame = [...(action.keyframes || [])].sort((a, b) => a.time - b.time).pop();
            timeline.set(elements, motionValues(lastFrame?.values || action.to), start);
            return;
          }
          if (action.keyframes?.length > 1) {
            const frames = [...action.keyframes].sort((a, b) => a.time - b.time);
            const initialValues = motionValues(frames[0].values);
            initialStates.push({ elements, values: initialValues });
            // Animation actions use fill:both semantics. Seed the first
            // keyframe immediately so delayed actions already expose their
            // authored start state before their active range begins.
            motionEngine.set(elements, initialValues);
            timeline.set(elements, initialValues, start + nonNegativeTiming(frames[0].time));
            frames.slice(1).forEach((frame, index) => {
              const segmentDuration = Math.max(.001, nonNegativeTiming(frame.time) - nonNegativeTiming(frames[index].time));
              timeline.to(elements, {
                ...motionValues(frame.values), duration: segmentDuration, ease: runtimeEase(action.ease, segmentDuration),
                repeat, repeatDelay, yoyo: action.yoyo, stagger,
              }, start + nonNegativeTiming(frames[index].time));
            });
          } else {
            const initialValues = motionValues(action.from);
            initialStates.push({ elements, values: initialValues });
            motionEngine.set(elements, initialValues);
            timeline.fromTo(elements, initialValues, {
              ...motionValues(action.to), duration: actionDuration, ease: runtimeEase(action.ease, actionDuration),
              repeat, repeatDelay, yoyo: action.yoyo, stagger,
            }, start);
          }
        } else if (action.kind === 'set') timeline.set(elements, motionValues(action.to), start);
        else if (action.kind === 'variable') timeline.to(elements, { [action.variableName]: action.variableValue, duration: actionDuration, ease: runtimeEase(action.ease, actionDuration) }, start);
        else {
          timeline.call(() => {
            const localTime = Number(timeline.time?.()) || 0;
            const iteration = Number(timeline.iteration?.()) || 1;
            const inferredBackward = iteration === timeline.__kodetyLastRenderedIteration
              ? localTime < timeline.__kodetyLastRenderedTime
              : Boolean(interaction.yoyo && iteration % 2 === 0);
            perform(
              action,
              elements,
              Boolean(
                timeline.__kodetyTraversalBackward
                || timeline.reversed()
                || inferredBackward
              ),
            );
          }, undefined, start);
          // the Motion engine drops a zero-length call-only timeline at its boundary. Keep a
          // tiny reversible span so hover-out and click-toggle cross the call
          // again and restore component variant state deterministically.
          if (action.kind === 'component-variant') {
            timeline.call(() => {}, undefined, start + Math.max(.001, actionDuration));
          }
        }
        });
        if (typeof timeline.eventCallback === 'function') {
          timeline.eventCallback('onUpdate', () => {
            timeline.__kodetyLastRenderedTime = Number(timeline.time?.()) || 0;
            timeline.__kodetyLastRenderedIteration = (
              Number(timeline.iteration?.()) || 1
            );
          });
        }
        timeline.__kodetyInitialStates = initialStates;
        return timeline;
      } catch (error) {
        timeline.kill?.();
        throw error;
      }
    };
    const run = (timeline, action) => {
      if (action === 'play') timeline.play();
      else if (action === 'restart') {
        // A restart jumps the playhead from the previous end back to zero.
        // Do not mistake that intentional jump for reverse traversal when a
        // call-based action (Set Variant, class, event) sits at time zero.
        timeline.__kodetyTraversalBackward = false;
        timeline.__kodetyLastRenderedTime = 0;
        timeline.__kodetyLastRenderedIteration = 1;
        timeline.restart();
      }
      else if (action === 'reverse') timeline.reverse();
      else if (action === 'reset') timeline.pause(0);
      else if (action === 'pause') timeline.pause();
    };
    const compileCustomAnimation = interaction => {
      const source = String(interaction.customCode || '').trim();
      if (!source) return null;
      try {
        return Function(
          'element',
          'elements',
          'event',
          'motion',
          'document',
          'window',
          // A local alias keeps existing authored custom snippets readable.
          // It is our adapter, never the removed proprietary runtime.
          'gsap',
          '"use strict";\\n' + source,
        );
      } catch (error) {
        console.error('[Kodety Interactions] Invalid custom animation:', interaction.name, error);
        return null;
      }
    };
    const breakpoint = innerWidth < 768 ? 'mobile' : innerWidth < 992 ? 'tablet' : 'desktop';
    documentDefinition.interactions.filter(interaction => interaction.enabled && interaction.enabledBreakpoints.includes(breakpoint)).forEach(interaction => {
      try {
      const triggerElementsForInteraction = () => {
        const triggerElements = safeQuery(
          document,
          interaction.triggerSelector,
          interaction.triggerTargetMode,
        );
        return triggerElements.length
          ? triggerElements
          : (
            !interaction.triggerSelector.trim()
            && (
              interaction.trigger === 'load'
              || interaction.trigger === 'custom'
            )
          )
            ? [document.body]
            : [];
      };
      const elements = triggerElementsForInteraction();
      if (interaction.behavior) {
        if (skipStartupMotion) return;
        const controller = installBehavior(interaction, elements);
        if (controller) {
          controllers.set(interaction.id, controller);
          controller.__publishPreviewDuration();
        }
        return;
      }
      const instances = [];
      const scrollTriggers = [];
      const previewTargets = new Set();
      const classTargets = [];
      let measuredPreviewDuration = null;
      let previewFrame = 0;
      const register = element => {
        const timeline = timelineFor(
          interaction,
          element,
          previewTargets,
          classTargets,
        );
        instances.push(timeline);
        return timeline;
      };
      // Variant swaps morph the stable component root but replace its
      // descendants. Reconcile event bindings after that morph so interactions
      // authored on descendant layers remain usable without disturbing the
      // root timeline whose hover-out still needs to reverse.
      const dynamicTriggerBindings = new Map();
      const removeDynamicTriggerBinding = element => {
        const binding = dynamicTriggerBindings.get(element);
        if (!binding) return;
        binding.detach();
        const index = instances.indexOf(binding.timeline);
        if (index >= 0) instances.splice(index, 1);
        binding.timeline.kill?.();
        dynamicTriggerBindings.delete(element);
      };
      const installDynamicTriggerBindings = attach => {
        let stopped = false;
        const reconcile = () => {
          if (stopped) return;
          const current = new Set(triggerElementsForInteraction());
          Array.from(dynamicTriggerBindings.keys()).forEach(element => {
            if (!current.has(element) || !element.isConnected) {
              removeDynamicTriggerBinding(element);
            }
          });
          current.forEach(element => {
            if (dynamicTriggerBindings.has(element)) return;
            const timeline = register(element);
            dynamicTriggerBindings.set(element, {
              timeline,
              detach: attach(element, timeline),
            });
          });
        };
        let queued = false;
        const variantChanged = () => {
          if (queued) return;
          queued = true;
          Promise.resolve().then(() => {
            queued = false;
            reconcile();
          });
        };
        reconcile();
        document.addEventListener('kodety:component-variant', variantChanged);
        cleanups.push(() => {
          stopped = true;
          document.removeEventListener('kodety:component-variant', variantChanged);
          Array.from(dynamicTriggerBindings.keys()).forEach(removeDynamicTriggerBinding);
        });
      };
      const pauseFrozenPlayback = () => {
        if (previewFrame) editorCancelFrame(previewFrame);
        previewFrame = 0;
        instances.forEach(timeline => timeline.pause());
      };
      const prepareFrozenPreview = () => {
        const triggerElements = triggerElementsForInteraction();
        const targets = new Set();
        const classes = [];
        interaction.actions.forEach(action => {
          triggerElements.forEach(triggerElement => {
            const actionTargets = baseTargetsFor(
              action.target,
              triggerElement,
            );
            actionTargets.forEach(element => targets.add(element));
            if (action.kind.startsWith('class-')) {
              classTokens(action.className).forEach(className => {
                classes.push({
                  elements: actionTargets,
                  className,
                });
              });
            }
          });
        });
        return {
          triggerElements,
          targets: Array.from(targets),
          classTargets: classes,
        };
      };
      const teardownFrozenInstances = () => {
        pauseFrozenPlayback();
        instances.splice(0).forEach(timeline => timeline.kill());
        scrollTriggers.splice(0).forEach(item => item.kill());
        previewTargets.clear();
        classTargets.length = 0;
      };
      const buildFrozenInstances = triggerElements => {
        teardownFrozenInstances();
        triggerElements.forEach(register);
        measuredPreviewDuration = Math.max(
          0,
          ...instances.map(previewTimelineDuration),
        );
        // These maps only protect timeline construction. The active preview
        // session was captured from the current DOM before immediateRender.
        setupInlineStyleSnapshots.clear();
        setupClassTokenSnapshots.clear();
      };
      const seedPreviewStates = () => {
        instances.forEach(timeline => {
          (timeline.__kodetyInitialStates || []).forEach(state => {
            motionEngine.set(state.elements, state.values);
          });
        });
      };
      const activatePreview = () => {
        if (!editorFrozen) return false;
        const previewKey = individualPreviewKey(interaction.id);
        if (window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ === previewKey) {
          return true;
        }
        cancelGroupedPreviewFrame();
        controllers.forEach(controller => controller.__pauseFrozenPlayback());
        teardownActiveFrozenPreview();
        const prepared = prepareFrozenPreview();
        window.__KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__?.(
          prepared.targets,
        );
        capturePreviewSession(
          previewKey,
          prepared.targets,
          prepared.classTargets,
        );
        window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ = previewKey;
        try {
          buildFrozenInstances(prepared.triggerElements);
          measuredPreviewDuration = Math.max(
            0,
            ...instances.map(previewTimelineDuration),
          );
        } catch (error) {
          teardownActiveFrozenPreview(previewKey);
          console.error(
            '[Kodety Interactions] Failed to build frozen preview',
            interaction.id,
            error,
          );
          return false;
        }
        // BEGIN restores the authored canvas styles. Re-seed every action's
        // first state afterwards so a seek before a delayed clip renders its
        // backwards fill instead of the static Design value.
        seedPreviewStates();
        publishPreviewDuration();
        return true;
      };
      const previewTimelineDuration = timeline => {
        const total = Number(timeline.totalDuration());
        if (Number.isFinite(total)) return Math.max(0, total);
        const cycle = Number(timeline.duration());
        return Number.isFinite(cycle) ? Math.max(0, cycle) : 0;
      };
      const renderPreviewTime = time => {
        const safeTime = Math.max(0, Number(time) || 0);
        instances.forEach(timeline => {
          const targetTime = Math.min(
            previewTimelineDuration(timeline),
            safeTime,
          );
          const currentTime = Number(timeline.totalTime()) || 0;
          timeline.__kodetyTraversalBackward = targetTime < currentTime;
          timeline.pause();
          try {
            timeline.totalTime(targetTime, false);
          } finally {
            timeline.__kodetyTraversalBackward = false;
          }
        });
      };
      const definitionPreviewDuration = () => {
        const authoredCycle = Math.max(
          .5,
          ...interaction.actions.map(action => {
            const repeat = runtimeRepeat(action.repeat);
            const finiteRepeat = repeat > 0 ? repeat : 0;
            const repeatDelay = nonNegativeTiming(action.repeatDelay);
            const repeatedSpan = duration => (
              duration * (finiteRepeat + 1)
              + repeatDelay * finiteRepeat
            );
            if (action.keyframes?.length > 1) {
              const frames = [...action.keyframes].sort(
                (left, right) => left.time - right.time,
              );
              const firstTime = nonNegativeTiming(frames[0]?.time);
              const keyframeEnd = frames.slice(1).reduce(
                (latest, frame, index) => {
                  const previousTime = Math.max(
                    firstTime,
                    nonNegativeTiming(frames[index]?.time),
                  );
                  const frameTime = Math.max(
                    previousTime,
                    nonNegativeTiming(frame.time),
                  );
                  return Math.max(
                    latest,
                    previousTime + repeatedSpan(
                      frameTime - previousTime,
                    ),
                  );
                },
                firstTime,
              );
              return nonNegativeTiming(action.start) + keyframeEnd;
            }
            return nonNegativeTiming(action.start)
              + repeatedSpan(nonNegativeTiming(action.duration));
          }),
        );
        const repeat = runtimeRepeat(interaction.repeat);
        return authoredCycle * ((repeat > 0 ? repeat : 0) + 1);
      };
      const previewDuration = () => instances.length
        ? Math.max(0, ...instances.map(previewTimelineDuration))
        : measuredPreviewDuration !== null
          ? measuredPreviewDuration
          : definitionPreviewDuration();
      const measureFrozenPreview = () => {
        if (!editorFrozen || instances.length) return previewDuration();
        // Measuring is synchronous and rolled back before paint. Never disturb
        // a preview session currently owned by another interaction/group.
        if (window.__KODETY_ACTIVE_INTERACTION_PREVIEW__) {
          return previewDuration();
        }
        const prepared = prepareFrozenPreview();
        const styles = new Map();
        const classes = new Map();
        prepared.targets.forEach(element => {
          captureInlineStyle(styles, element);
        });
        prepared.classTargets.forEach(entry => {
          entry.elements.forEach(element => {
            captureClassToken(classes, element, entry.className);
          });
        });
        try {
          buildFrozenInstances(prepared.triggerElements);
          measuredPreviewDuration = Math.max(
            0,
            ...instances.map(previewTimelineDuration),
          );
        } catch (error) {
          console.error(
            '[Kodety Interactions] Failed to measure frozen preview',
            interaction.id,
            error,
          );
        } finally {
          teardownFrozenInstances();
          restoreInlineStyles(styles);
          restoreClassTokens(classes);
          restoreSplitText();
          setupInlineStyleSnapshots.clear();
          setupClassTokenSnapshots.clear();
        }
        return previewDuration();
      };
      const runFrozenPreview = (from, action) => {
        if (!activatePreview()) return;
        pauseFrozenPlayback();
        const duration = previewDuration();
        const start = Math.max(0, Math.min(duration, Number(from) || 0));
        const direction = action === 'reverse' ? -1 : 1;
        let elapsed = 0;
        let previous = editorNow();
        renderPreviewTime(start);
        const tick = frameTime => {
          const now = Number.isFinite(frameTime) ? frameTime : editorNow();
          elapsed += previewDelta(now, previous);
          previous = now;
          const next = start + (elapsed / 1000) * direction;
          const complete = direction > 0 ? next >= duration : next <= 0;
          renderPreviewTime(
            complete ? (direction > 0 ? duration : 0) : next,
          );
          if (complete) {
            previewFrame = 0;
            return;
          }
          previewFrame = editorRequestFrame(tick);
        };
        // Design freezes the page clock, so native timeline.play() cannot paint
        // reliably here. Advance the exact same the Motion engine totalTime() path used by
        // Timeline scrubbing on the editor's private frame clock instead.
        previewFrame = editorRequestFrame(tick);
      };
      const releasePreview = () => {
        const previewKey = individualPreviewKey(interaction.id);
        if (
          editorFrozen
          && (
            window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ !== previewKey
            || previewSession?.key !== previewKey
          )
        ) return false;
        if (editorFrozen) return teardownActiveFrozenPreview(
          previewKey,
        );
        pauseFrozenPlayback();
        renderPreviewTime(0);
        return true;
      };
      const publishPreviewDuration = () => {
        if (!editorFrozen) return;
        window.__KODETY_POST_EDITOR_MESSAGE__?.({
          type: 'html-editor-interaction-duration',
          interactionId: interaction.id,
          signature: JSON.stringify(interaction),
          duration: previewDuration(),
        });
      };
      if (editorFrozen) {
        // Text splitting and the Motion engine immediateRender both mutate the DOM. Build
        // frozen timelines only after an explicit Play/Seek, then tear them
        // down when that preview session ends.
      }
      else if (interaction.trigger === 'load') elements.forEach(element => register(element).play());
      else if (interaction.trigger === 'scroll' && MotionScroll) {
        const externalScrollElements = interaction.scrollTriggerSelector
          ? safeQuery(document, interaction.scrollTriggerSelector)
          : [];
        elements.forEach((element, index) => {
          const timeline = register(element);
          const scrollElement = externalScrollElements[index] || externalScrollElements[0] || element;
          scrollTriggers.push(MotionScroll.create({ animation: timeline, trigger: scrollElement, start: interaction.scrollStart, end: interaction.scrollEnd, scrub: interaction.scrollScrub ? interaction.scrollSmoothing || true : false, toggleActions: interaction.scrollToggleActions }));
        });
      } else if (interaction.trigger === 'hover') {
        installDynamicTriggerBindings((element, timeline) => {
          const enter = () => run(timeline, interaction.hoverInAction);
          const leave = () => interaction.hoverOutAction !== 'none' && run(timeline, interaction.hoverOutAction);
          element.addEventListener('mouseenter', enter);
          element.addEventListener('mouseleave', leave);
          return () => {
            element.removeEventListener('mouseenter', enter);
            element.removeEventListener('mouseleave', leave);
          };
        });
      }
      else if (interaction.trigger === 'click') {
        installDynamicTriggerBindings((element, timeline) => {
          let active = false;
          const click = () => {
            if (interaction.clickAction === 'toggle') {
              active = !active;
              active ? timeline.play() : timeline.reverse();
            } else run(timeline, interaction.clickAction);
          };
          element.addEventListener('click', click);
          return () => element.removeEventListener('click', click);
        });
      }
      else if (interaction.trigger === 'click-start') {
        installDynamicTriggerBindings((element, timeline) => {
          const start = event => {
            if (event.isPrimary === false) return;
            if (Number.isFinite(event.button) && event.button !== 0) return;
            run(timeline, 'restart');
          };
          element.addEventListener('pointerdown', start);
          return () => element.removeEventListener('pointerdown', start);
        });
      }
      else if (interaction.trigger === 'appear') {
        installDynamicTriggerBindings((element, timeline) => {
          let activated = false;
          const appear = () => {
            if (activated) return;
            activated = true;
            run(timeline, 'restart');
          };
          if (typeof IntersectionObserver !== 'function') {
            appear();
            return () => {};
          }
          const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.target === element && entry.isIntersecting)) return;
            observer.disconnect();
            appear();
          }, { threshold: 0.01 });
          observer.observe(element);
          return () => observer.disconnect();
        });
      }
      else if (
        interaction.trigger === 'mouse-enter'
        || interaction.trigger === 'mouse-leave'
      ) {
        installDynamicTriggerBindings((element, timeline) => {
          const eventName = interaction.trigger === 'mouse-enter'
            ? 'mouseenter'
            : 'mouseleave';
          const activate = () => run(timeline, 'restart');
          element.addEventListener(eventName, activate);
          return () => element.removeEventListener(eventName, activate);
        });
      }
      else if (interaction.trigger === 'mouse-move') {
        installDynamicTriggerBindings((element, timeline) => {
          const move = event => {
            const bounds = element.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
            const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
            const progress = interaction.mouseMoveAxis === 'x' ? x : interaction.mouseMoveAxis === 'y' ? y : (x + y) / 2;
            motionEngine.to(timeline, { progress, duration: interaction.mouseMoveSmoothing, ease: 'power1.out' });
          };
          const leave = () => interaction.mouseMoveReverse && motionEngine.to(timeline, { progress: 0, duration: interaction.mouseMoveSmoothing });
          element.addEventListener('mousemove', move);
          element.addEventListener('mouseleave', leave);
          return () => {
            element.removeEventListener('mousemove', move);
            element.removeEventListener('mouseleave', leave);
          };
        });
      }
      else if (interaction.trigger === 'custom') {
        const timelines = elements.map(register);
        const customAnimation = compileCustomAnimation(interaction);
        const custom = event => {
          timelines.forEach(timeline => run(timeline, 'restart'));
          if (!customAnimation) return;
          elements.forEach(element => {
            try {
              customAnimation.call(
                element,
                element,
                elements,
                event,
                motionEngine,
                document,
                window,
                motionEngine,
              );
            } catch (error) {
              console.error('[Kodety Interactions] Custom animation failed:', interaction.name, error);
            }
          });
        };
        document.addEventListener(interaction.customEvent, custom); cleanups.push(() => document.removeEventListener(interaction.customEvent, custom));
      }
      if (
        !editorFrozen
        && matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        if (interaction.reducedMotion === 'skip') {
          instances.forEach(timeline => timeline.pause());
        }
        if (interaction.reducedMotion === 'end') {
          instances.forEach(timeline => {
            // the Motion engine's suppressEvents flag keeps call-based component, class,
            // event and player actions dormant while visual tracks settle at
            // the authored end state.
            timeline.progress(1, true).pause();
          });
        }
      }
      controllers.set(interaction.id, {
        __previewTargets: () => Array.from(previewTargets),
        __classTargets: () => classTargets,
        __prepareFrozenPreview: prepareFrozenPreview,
        __buildFrozenPreview: buildFrozenInstances,
        __teardownFrozenPreview: teardownFrozenInstances,
        __pauseFrozenPlayback: pauseFrozenPlayback,
        __renderPreviewTime: renderPreviewTime,
        __previewDuration: previewDuration,
        __measurePreviewDuration: measureFrozenPreview,
        __previewTime: () => Number(instances[0]?.totalTime?.()) || 0,
        __seedPreviewStates: seedPreviewStates,
        __publishPreviewDuration: publishPreviewDuration,
        play: () => {
          if (editorFrozen) runFrozenPreview(instances[0]?.totalTime?.() || 0, 'play');
          else instances.forEach(timeline => timeline.play());
        },
        restart: () => {
          if (editorFrozen) runFrozenPreview(0, 'restart');
          else instances.forEach(timeline => run(timeline, 'restart'));
        },
        reverse: () => {
          if (editorFrozen) {
            runFrozenPreview(
              instances[0]?.totalTime?.() || previewDuration(),
              'reverse',
            );
          }
          else instances.forEach(timeline => timeline.reverse());
        },
        pause: time => {
          pauseFrozenPlayback();
          if (time !== undefined) {
            if (editorFrozen && !activatePreview()) return;
            renderPreviewTime(time);
          } else {
            if (editorFrozen) measureFrozenPreview();
            instances.forEach(timeline => timeline.pause());
          }
          publishPreviewDuration();
        },
        seek: time => {
          if (editorFrozen && !activatePreview()) return;
          pauseFrozenPlayback();
          renderPreviewTime(time);
        },
        reset: releasePreview,
        release: releasePreview,
        kill: teardownFrozenInstances,
      });
      publishPreviewDuration();
      } catch (error) {
        if (editorFrozen) {
          restoreInlineStyles(setupInlineStyleSnapshots);
          restoreClassTokens(setupClassTokenSnapshots);
        }
        // One malformed selector/value must not prevent every other controller
        // from registering. Keep the valid timelines usable in Canvas, Preview
        // and publication while exposing the isolated failure to diagnostics.
        console.error('[Kodety Interactions] Failed to register interaction', interaction.id, error);
      }
    });
    if (editorFrozen) {
      // Construction snapshots exist only to undo the Motion engine's immediateRender seeds.
      // Preview sessions capture the latest live DOM when the author presses
      // Play/Seek, so later Design edits are never replaced by setup-time state.
      setupInlineStyleSnapshots.clear();
      setupClassTokenSnapshots.clear();
    }
    teardownActiveFrozenPreview = expectedKey => {
      if (!editorFrozen) return false;
      const activeKey = window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ || '';
      if (
        !activeKey
        || previewSession?.key !== activeKey
        || (expectedKey !== undefined && activeKey !== expectedKey)
      ) return false;
      cancelGroupedPreviewFrame();
      controllers.forEach(controller => {
        controller.__pauseFrozenPlayback();
        // Call-based actions (notably Set Variant) own reversible state that is
        // not represented by the style/class preview snapshots. Cross their
        // callbacks backwards before killing the timelines so Reset/Release
        // returns the live Design DOM to its pre-preview state.
        controller.__renderPreviewTime(0);
        controller.__teardownFrozenPreview();
      });
      restorePreviewSession(activeKey);
      restoreSplitText();
      setupInlineStyleSnapshots.clear();
      setupClassTokenSnapshots.clear();
      window.__KODETY_END_EDITOR_INTERACTION_PREVIEW__?.();
      window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ = '';
      return true;
    };
    const groupedControllersFor = rawIds => {
      if (!Array.isArray(rawIds)) return [];
      const seen = new Set();
      rawIds.slice(0, 512).forEach(rawId => {
        const id = typeof rawId === 'string' ? rawId.trim() : '';
        if (!id) return;
        seen.add(id);
      });
      return Array.from(controllers.entries()).flatMap(([id, controller]) => (
        seen.has(id) ? [{ id, controller }] : []
      ));
    };
    const groupedPreviewKey = entries => (
      'group:' + JSON.stringify(entries.map(entry => entry.id).sort())
    );
    const groupedPreviewDuration = entries => Math.max(
      0,
      ...entries.map(entry => entry.controller.__previewDuration()),
    );
    const renderGroupedPreviewTime = (entries, time) => {
      entries.forEach(entry => entry.controller.__renderPreviewTime(time));
    };
    const measureGroupedPreview = entries => {
      if (!editorFrozen || window.__KODETY_ACTIVE_INTERACTION_PREVIEW__) {
        return groupedPreviewDuration(entries);
      }
      const preparedEntries = entries.map(entry => ({
        entry,
        prepared: entry.controller.__prepareFrozenPreview(),
      }));
      const styles = new Map();
      const classes = new Map();
      preparedEntries.forEach(item => {
        item.prepared.targets.forEach(element => {
          captureInlineStyle(styles, element);
        });
        item.prepared.classTargets.forEach(classTarget => {
          classTarget.elements.forEach(element => {
            captureClassToken(
              classes,
              element,
              classTarget.className,
            );
          });
        });
      });
      try {
        preparedEntries.forEach(item => {
          item.entry.controller.__buildFrozenPreview(
            item.prepared.triggerElements,
          );
        });
      } catch (error) {
        console.error(
          '[Kodety Interactions] Failed to measure grouped frozen preview',
          entries.map(entry => entry.id),
          error,
        );
      } finally {
        entries.forEach(entry => {
          entry.controller.__teardownFrozenPreview();
        });
        restoreInlineStyles(styles);
        restoreClassTokens(classes);
        restoreSplitText();
        setupInlineStyleSnapshots.clear();
        setupClassTokenSnapshots.clear();
      }
      return groupedPreviewDuration(entries);
    };
    const activateGroupedPreview = entries => {
      if (!editorFrozen) return false;
      const key = groupedPreviewKey(entries);
      if (window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ === key) return true;
      cancelGroupedPreviewFrame();
      controllers.forEach(controller => controller.__pauseFrozenPlayback());
      teardownActiveFrozenPreview();
      const preparedEntries = entries.map(entry => ({
        entry,
        prepared: entry.controller.__prepareFrozenPreview(),
      }));
      const targets = preparedEntries.flatMap(
        item => item.prepared.targets,
      );
      const classTargets = preparedEntries.flatMap(
        item => item.prepared.classTargets,
      );
      window.__KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__?.(targets);
      capturePreviewSession(key, targets, classTargets);
      window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ = key;
      try {
        preparedEntries.forEach(item => {
          item.entry.controller.__buildFrozenPreview(
            item.prepared.triggerElements,
          );
        });
      } catch (error) {
        teardownActiveFrozenPreview(key);
        console.error(
          '[Kodety Interactions] Failed to build grouped frozen preview',
          entries.map(entry => entry.id),
          error,
        );
        return false;
      }
      // BEGIN restores authored styles once for the complete target union.
      // Seed every controller only after that shared reset so delayed clips
      // from one timeline cannot erase the first frame of another.
      entries.forEach(entry => {
        entry.controller.__seedPreviewStates();
        entry.controller.__publishPreviewDuration();
      });
      return true;
    };
    const releaseGroupedPreview = entries => {
      const key = groupedPreviewKey(entries);
      if (
        editorFrozen
        && (
          window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ !== key
          || previewSession?.key !== key
        )
      ) return false;
      if (editorFrozen) return teardownActiveFrozenPreview(key);
      cancelGroupedPreviewFrame();
      entries.forEach(entry => entry.controller.__pauseFrozenPlayback());
      renderGroupedPreviewTime(entries, 0);
      return true;
    };
    const runGroupedFrozenPreview = (entries, from, action) => {
      if (!activateGroupedPreview(entries)) return;
      cancelGroupedPreviewFrame();
      entries.forEach(entry => entry.controller.__pauseFrozenPlayback());
      const duration = groupedPreviewDuration(entries);
      const start = Math.max(0, Math.min(duration, Number(from) || 0));
      const direction = action === 'reverse' ? -1 : 1;
      let elapsed = 0;
      let previous = editorNow();
      renderGroupedPreviewTime(entries, start);
      const tick = frameTime => {
        const now = Number.isFinite(frameTime) ? frameTime : editorNow();
        elapsed += previewDelta(now, previous);
        previous = now;
        const next = start + (elapsed / 1000) * direction;
        const complete = direction > 0 ? next >= duration : next <= 0;
        renderGroupedPreviewTime(
          entries,
          complete ? (direction > 0 ? duration : 0) : next,
        );
        if (complete) {
          groupedPreviewFrame = 0;
          return;
        }
        groupedPreviewFrame = editorRequestFrame(tick);
      };
      groupedPreviewFrame = editorRequestFrame(tick);
    };
    const controlGroupedPreview = (rawIds, action, time) => {
      const entries = groupedControllersFor(rawIds);
      if (!entries.length) return false;
      const safeTime = Number.isFinite(time) ? Math.max(0, time) : null;
      if (!editorFrozen) {
        entries.forEach(({ controller }) => {
          if (action === 'restart') controller.restart();
          else if (action === 'play') controller.play();
          else if (action === 'reverse') controller.reverse();
          else if (action === 'reset') controller.reset?.();
          else if (action === 'release') controller.release?.();
          else if (action === 'pause') controller.pause(
            safeTime === null ? undefined : safeTime,
          );
          else if (action === 'seek') controller.seek(
            safeTime === null ? 0 : safeTime,
          );
        });
        return true;
      }
      if (action === 'release' || action === 'reset') {
        releaseGroupedPreview(entries);
        return true;
      }
      if (action === 'pause' && safeTime === null) {
        cancelGroupedPreviewFrame();
        entries.forEach(entry => entry.controller.__pauseFrozenPlayback());
        measureGroupedPreview(entries);
        entries.forEach(
          entry => entry.controller.__publishPreviewDuration(),
        );
        return true;
      }
      if (action === 'seek' || action === 'pause') {
        if (!activateGroupedPreview(entries)) return false;
        cancelGroupedPreviewFrame();
        entries.forEach(entry => entry.controller.__pauseFrozenPlayback());
        renderGroupedPreviewTime(entries, safeTime === null ? 0 : safeTime);
        // Duration is invariant while scrubbing and is already published when
        // the frozen preview is activated. Echoing it for every Seek doubles
        // the cross-frame traffic and can make dense timelines fall behind.
        if (action === 'pause') {
          entries.forEach(entry => entry.controller.__publishPreviewDuration());
        }
        return true;
      }
      if (action === 'restart') {
        runGroupedFrozenPreview(entries, 0, 'restart');
        return true;
      }
      if (action === 'play') {
        const currentTime = safeTime === null
          ? entries[0].controller.__previewTime()
          : safeTime;
        runGroupedFrozenPreview(entries, currentTime, 'play');
        return true;
      }
      if (action === 'reverse') {
        const currentTime = safeTime === null
          ? entries[0].controller.__previewTime() || groupedPreviewDuration(entries)
          : safeTime;
        runGroupedFrozenPreview(entries, currentTime, 'reverse');
        return true;
      }
      return false;
    };
    window.__kodetyInteractions = {
      get: id => controllers.get(id),
      control: controlGroupedPreview,
      update: nextDocument => {
        if (!nextDocument || !Array.isArray(nextDocument.interactions)) return false;
        // A document can switch from presets to a custom curve while the
        // Canvas is using the lightweight live-patch path. Force one rebuild
        // so the conditional MotionEase dependency is installed first.
        if (definitionNeedsMotionEase(nextDocument) && !MotionEase) return false;
        documentDefinition = nextDocument;
        return setup() !== false;
      },
      destroy: () => {
        if (setupRetryTimer) {
          const clock = window.__KODETY_EDITOR_NATIVE_CLOCK__ || {};
          const cancel = clock.clearTimeout || window.clearTimeout.bind(window);
          cancel(setupRetryTimer);
          setupRetryTimer = 0;
        }
        cancelGroupedPreviewFrame();
        controllers.forEach(controller => controller.kill());
        cleanups.splice(0).forEach(cleanup => cleanup());
        controllers.clear();
        restorePreviewSession();
        restoreInlineStyles(setupInlineStyleSnapshots);
        restoreClassTokens(setupClassTokenSnapshots);
        setupInlineStyleSnapshots.clear();
        setupClassTokenSnapshots.clear();
        restoreSplitText();
        if (editorFrozen) {
          window.__KODETY_END_EDITOR_INTERACTION_PREVIEW__?.();
          window.__KODETY_ACTIVE_INTERACTION_PREVIEW__ = '';
        }
      },
    };
    initialPaint?.release();
    if (window.__kodetyInteractionsInitialPaint === initialPaint) {
      delete window.__kodetyInteractionsInitialPaint;
    }
    return true;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
})();
</script>`;
}

export function interactionDocumentNeedsScrollTrigger(
  document: InteractionDocument,
) {
  return document.interactions.some(interaction => (
    interaction.enabled
    && interaction.enabledBreakpoints.length > 0
    && interaction.trigger === 'scroll'
    && interaction.actions.length > 0
  ));
}

export function interactionDocumentNeedsCustomEase(
  document: InteractionDocument,
) {
  return document.interactions.some(interaction => interaction.actions.some(action => (
    /^\s*(?:cubic-bezier|spring)\s*\(/i.test(action.ease || '')
  )));
}

function injectDependencies(source: string, document: InteractionDocument, forceRuntime = false) {
  if (!document.interactions.length && !forceRuntime) return source;
  const inlineDependency = (
    engine: string,
    runtime: string,
    globalName: string,
    privateGlobalName: string,
    globalNames: string[],
    prerequisite = '',
  ) => {
    const safeRuntime = runtime.replace(/<\/script/gi, '<\\/script');
    return `<script data-kodety-interactions-dependency data-kodety-interactions-engine="${engine}">
(() => {
if (window.${privateGlobalName}) return;
const names = ${JSON.stringify(globalNames)};
const snapshots = names.map(name => ({
  name,
  own: Object.prototype.hasOwnProperty.call(window, name),
  descriptor: Object.getOwnPropertyDescriptor(window, name),
}));
try {
${prerequisite}
${safeRuntime}
window.${privateGlobalName} = window.${globalName};
} finally {
  snapshots.reverse().forEach(snapshot => {
    try {
      if (snapshot.own && snapshot.descriptor) {
        Object.defineProperty(window, snapshot.name, snapshot.descriptor);
      } else {
        delete window[snapshot.name];
      }
    } catch {
      window[snapshot.name] = snapshot.own
        ? snapshot.descriptor?.value
        : undefined;
    }
  });
}
})();
</script>`;
  };
  const dependencies = [
    inlineDependency('motion', `/*! Motion — MIT License\n${motionLicenseText.replace(/\*\//g, '* /')}\n*/\n${motionRuntimeSource}`, 'Motion', '__ONUN_MOTION__', ['Motion']),
    `<script data-kodety-interactions-dependency data-kodety-interactions-engine="onun-motion">
(() => {
if (window.__ONUN_MOTION_ENGINE__) return;
${motionEngineSource.replace(/^export /gm, '').replace(/<\/script/gi, '<\\/script')}
window.__ONUN_MOTION_ENGINE__ = createOnunMotionRuntime(window.__ONUN_MOTION__, window);
})();
</script>`,
  ];
  const markup = `  ${dependencies.join('\n  ')}\n${interactionInitialPaintRuntime(document)}\n`;
  return /<\/head\s*>/i.test(source)
    ? source.replace(/<\/head\s*>/i, () => `${markup}</head>`)
    : `${markup}${source}`;
}

export function patchInteractionDocument(
  source: string,
  rawDocument: InteractionDocument,
  forceRuntime = false,
) {
  const document: InteractionDocument = {
    version: 2,
    interactions: normalizeInteractionList(rawDocument.interactions),
  };
  let next = stripInteractionRuntime(source);
  if (!document.interactions.length && !forceRuntime) return next;
  next = injectDependencies(next, document, forceRuntime);
  const runtime = interactionRuntime(document);
  return /<\/body\s*>/i.test(next)
    ? next.replace(/<\/body\s*>/i, () => `  ${runtime}\n</body>`)
    : `${next}\n${runtime}\n`;
}

function quotedAttributeSelector(name: string, value: string) {
  return `[${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/** CSS.escape-compatible identifier escaping for environments without CSSOM. */
function escapeCssIdentifier(value: string) {
  const string = String(value);
  const length = string.length;
  let result = '';
  const firstCodeUnit = string.charCodeAt(0);
  for (let index = 0; index < length; index += 1) {
    const codeUnit = string.charCodeAt(index);
    if (codeUnit === 0x0000) {
      result += '\uFFFD';
      continue;
    }
    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f)
      || codeUnit === 0x007f
      || (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039)
      || (
        index === 1
        && codeUnit >= 0x0030
        && codeUnit <= 0x0039
        && firstCodeUnit === 0x002d
      )
    ) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }
    if (index === 0 && codeUnit === 0x002d && length === 1) {
      result += '\\-';
      continue;
    }
    if (
      codeUnit >= 0x0080
      || codeUnit === 0x002d
      || codeUnit === 0x005f
      || (codeUnit >= 0x0030 && codeUnit <= 0x0039)
      || (codeUnit >= 0x0041 && codeUnit <= 0x005a)
      || (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }
    result += `\\${string.charAt(index)}`;
  }
  return result;
}

function openingTagMarkup(markup: string) {
  let quote = '';
  let escaped = false;
  for (let index = 0; index < markup.length; index += 1) {
    const character = markup[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return markup.slice(0, index + 1);
  }
  return markup;
}

function openingTagAttribute(
  openingTag: string,
  attributeName: string,
) {
  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(attributeName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  );
  const match = openingTag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

function authoredElementIdentity(source: string, path: string) {
  try {
    const openingTag = openingTagMarkup(getElementOuterHtml(source, path));
    const classValue = openingTagAttribute(openingTag, 'class');
    return {
      resolved: true,
      tag: openingTag.match(/^<\s*([^\s/>]+)/)?.[1] || '',
      htmlId: openingTagAttribute(openingTag, 'id'),
      interactionId: openingTagAttribute(
        openingTag,
        'data-kodety-interaction-id',
      ),
      componentInstanceId: openingTagAttribute(
        openingTag,
        'data-kodety-component-instance',
      ),
      classes: classValue === undefined
        ? []
        : classValue.split(/\s+/).filter(Boolean),
    };
  } catch {
    return {
      resolved: false,
      tag: '',
      htmlId: undefined,
      interactionId: undefined,
      componentInstanceId: undefined,
      classes: [] as string[],
    };
  }
}

function authoredAttributeValueCount(
  source: string,
  attributeName: string,
  attributeValue: string,
) {
  if (!attributeValue) return 0;
  const authoredSource = stripInteractionRuntime(source);
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(
        authoredSource,
        'text/html',
      );
      return parsed.querySelectorAll(
        quotedAttributeSelector(attributeName, attributeValue),
      ).length;
    } catch {}
  }
  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(attributeName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'gi',
  );
  return Array.from(authoredSource.matchAll(pattern)).filter(match => (
    (match[1] ?? match[2] ?? match[3] ?? '') === attributeValue
  )).length;
}

/** Validates the selector against the authored page, with an ID fallback for SSR/tests. */
export function interactionSelectorExistsInSource(source: string, selector: string) {
  const normalized = selector.trim();
  if (!normalized) return false;
  const authoredSource = stripInteractionRuntime(source);
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(authoredSource, 'text/html');
      return parsed.querySelectorAll(normalized).length > 0;
    } catch {
      return false;
    }
  }
  const idSelector = normalized.match(/^\[id="((?:\\.|[^"])*)"\]$/);
  if (!idSelector) return false;
  const idValue = idSelector[1].replace(/\\([\\"])/g, '$1');
  return authoredAttributeValueCount(authoredSource, 'id', idValue) > 0;
}

function uniqueAuthoredInteractionElementId(source: string) {
  let candidate = id('element');
  while (authoredAttributeValueCount(
    source,
    'data-kodety-interaction-id',
    candidate,
  )) candidate = id('element');
  return candidate;
}

export function ensureInteractionSelector(source: string, path: string, selection: SelectionSnapshot, mode: InteractionTargetMode) {
  const authored = authoredElementIdentity(source, path);
  const classes = authored.resolved ? authored.classes : selection.classes;
  if (
    mode === 'element'
    && path === '0'
    && /<body\b[^>]*\bdata-kodety-component-editor(?:\s*=|\s|>)/i.test(
      stripInteractionRuntime(source),
    )
  ) {
    // The master root is morphed in place when its variant changes. Target its
    // stable structural position instead of an attribute that may exist only
    // in variant A; hover-out/click-toggle can then always reverse B back to A.
    // The component compiler rebases this document selector to the concrete
    // instance root on pages and publication.
    return {
      source,
      selector: 'body > :first-child',
      label: authored.tag || selection.tag || 'Component root',
      mode: 'selector' as const,
    };
  }
  if (mode === 'class' && classes[0]) {
    const className = escapeCssIdentifier(classes[0]);
    return { source, selector: `.${className}`, label: `.${classes[0]}`, mode };
  }
  const htmlId = authored.resolved
    ? authored.htmlId || ''
    : selection.id;
  if (mode === 'selector' && htmlId) {
    return {
      source,
      selector: quotedAttributeSelector('id', htmlId),
      label: `#${htmlId}`,
      mode,
    };
  }
  // A component instance already owns a durable, editor-managed identity.
  // Reuse it instead of stamping a generated interaction id on the materialized
  // root: component refreshes and variant changes rebuild that root from the
  // master, while `data-kodety-component-instance` is deliberately preserved.
  const componentInstanceId = authored.resolved
    ? authored.componentInstanceId || ''
    : selection.attributes['data-kodety-component-instance'] || '';
  if (
    mode === 'element'
    && componentInstanceId
    && authoredAttributeValueCount(
      source,
      'data-kodety-component-instance',
      componentInstanceId,
    ) === 1
  ) {
    return {
      source,
      selector: quotedAttributeSelector(
        'data-kodety-component-instance',
        componentInstanceId,
      ),
      label: authored.tag || selection.tag || 'Component instance',
      mode,
    };
  }
  const authoredInteractionId = authored.interactionId || '';
  const snapshotInteractionId = authored.resolved
    ? ''
    : selection.attributes['data-kodety-interaction-id'];
  const duplicateAuthoredId = Boolean(
    authoredInteractionId
    && authoredAttributeValueCount(
      source,
      'data-kodety-interaction-id',
      authoredInteractionId,
    ) > 1,
  );
  const elementId = duplicateAuthoredId
    ? uniqueAuthoredInteractionElementId(source)
    : authoredInteractionId
      || snapshotInteractionId
      || uniqueAuthoredInteractionElementId(source);
  const next = authoredInteractionId && !duplicateAuthoredId
    ? source
    : patchElementAttribute(
      source,
      path,
      'data-kodety-interaction-id',
      elementId,
    );
  const selector = quotedAttributeSelector('data-kodety-interaction-id', elementId);
  return {
    source: next,
    selector,
    label: mode === 'selector'
      ? selector
      : htmlId
        ? `#${htmlId}`
        : classes[0]
          ? `.${classes[0]}`
          : authored.tag || selection.tag,
    mode: mode === 'selector' ? 'selector' as const : 'element' as const,
  };
}

export function addInteraction(source: string, path: string, selection: SelectionSnapshot, trigger: InteractionTrigger, mode: InteractionTargetMode = 'element') {
  const resolved = ensureInteractionSelector(source, path, selection, mode);
  const document = readInteractionDocument(resolved.source);
  const triggerName = trigger === 'mouse-move'
    ? 'Mouse move'
    : trigger === 'click-start'
      ? 'Click Start'
      : trigger === 'mouse-enter'
        ? 'Mouse Enter'
        : trigger === 'mouse-leave'
          ? 'Mouse Leave'
          : trigger === 'appear'
            ? 'Appear'
            : trigger === 'load'
              ? 'Page load'
              : trigger === 'custom'
                ? 'Custom event'
                : `${trigger[0].toUpperCase()}${trigger.slice(1)}`;
  const interaction: InteractionDefinition = normalizeInteraction({
    id: id('interaction'),
    name: `${triggerName} interaction`,
    trigger, triggerSelector: resolved.selector, triggerLabel: resolved.label, triggerTargetMode: resolved.mode,
    actions: [],
  });
  return { source: patchInteractionDocument(resolved.source, { ...document, interactions: [...document.interactions, interaction] }), interaction };
}

export function addInteractionFromSavedPreset(
  source: string,
  path: string,
  selection: SelectionSnapshot,
  preset: SavedInteractionPreset,
  triggerOverride?: InteractionTrigger,
) {
  const normalizedPreset = normalizeSavedInteractionPresets([preset])[0];
  if (!normalizedPreset) throw new Error('Invalid saved interaction preset.');
  const resolved = ensureInteractionSelector(
    source,
    path,
    selection,
    'element',
  );
  const document = readInteractionDocument(resolved.source);
  const trigger = enumValue(
    triggerOverride,
    INTERACTION_TRIGGERS,
    normalizedPreset.definition.trigger,
  );
  const interaction = normalizeInteraction({
    ...normalizedPreset.definition,
    id: id('interaction'),
    name: normalizedPreset.name || normalizedPreset.definition.name,
    trigger,
    triggerSelector: resolved.selector,
    triggerLabel: resolved.label,
    triggerTargetMode: resolved.mode,
    actions: normalizedPreset.definition.actions.map(action => portableAction(
      action,
      '',
      true,
    )),
    scrollTriggerSelector: '',
    scrollTriggerLabel: DEFAULT_INTERACTION.scrollTriggerLabel,
    enabledBreakpoints: [...normalizedPreset.definition.enabledBreakpoints],
  });
  return {
    source: patchInteractionDocument(resolved.source, {
      ...document,
      interactions: [...document.interactions, interaction],
    }),
    interaction,
  };
}

export function updateInteraction(source: string, interactionId: string, updater: (interaction: InteractionDefinition) => InteractionDefinition) {
  const document = readInteractionDocument(source);
  return patchInteractionDocument(source, { ...document, interactions: document.interactions.map(interaction => interaction.id === interactionId ? normalizeInteraction(updater(interaction)) : interaction) });
}

export function removeInteraction(source: string, interactionId: string) {
  const document = readInteractionDocument(source);
  return patchInteractionDocument(source, { ...document, interactions: document.interactions.filter(interaction => interaction.id !== interactionId) });
}

export function patchInteractionKeyframeValue(source: string, interactionId: string, actionId: string, keyframeId: string, property: string, value: string | number | boolean) {
  return updateInteraction(source, interactionId, interaction => ({
    ...interaction,
    actions: interaction.actions.map(action => action.id !== actionId ? action : {
      ...action,
      keyframes: action.keyframes.map(keyframe => {
        if (keyframe.id !== keyframeId) return keyframe;
        const values = { ...keyframe.values };
        if (value === '') delete values[property]; else values[property] = value;
        return { ...keyframe, values };
      }),
    }),
  }));
}

function repeatedInteractionSpan(duration: number, repeat: number, repeatDelay: number) {
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  // Infinite repeat remains a finite, editable cycle in the authoring timeline.
  const normalizedRepeat = normalizeInteractionRepeat(repeat);
  const safeRepeat = normalizedRepeat > 0 ? normalizedRepeat : 0;
  const safeDelay = Math.max(0, Number.isFinite(repeatDelay) ? repeatDelay : 0);
  return safeDuration + safeRepeat * (safeDuration + safeDelay);
}

export function interactionKeyframesForDuration(
  action: InteractionAction,
  duration: number,
) {
  if (action.keyframes.length < 2) return action.keyframes;
  const nextDuration = Math.max(
    0,
    Number.isFinite(duration) ? duration : action.duration,
  );
  const ordered = action.keyframes
    .map((keyframe, index) => ({ keyframe, index }))
    .sort((left, right) => (
      left.keyframe.time - right.keyframe.time
      || left.index - right.index
    ));
  const previousSpan = Math.max(
    0.001,
    ...ordered.map(({ keyframe }) => (
      Number.isFinite(keyframe.time) ? Math.max(0, keyframe.time) : 0
    )),
  );
  return ordered.map(({ keyframe }, index) => ({
    ...keyframe,
    time: index === ordered.length - 1
      ? nextDuration
      : Math.min(
        nextDuration,
        Math.max(0, (keyframe.time / previousSpan) * nextDuration),
      ),
  }));
}

export function interactionActionEnd(action: InteractionAction) {
  const start = Math.max(0, Number.isFinite(action.start) ? action.start : 0);
  if (action.keyframes.length > 1) {
    const frames = [...action.keyframes].sort((left, right) => left.time - right.time);
    const firstTime = Math.max(0, frames[0]?.time || 0);
    const segmentEnd = frames.slice(1).reduce((latest, frame, index) => {
      const previousTime = Math.max(firstTime, frames[index]?.time || 0);
      const frameTime = Math.max(previousTime, frame.time);
      const segment = repeatedInteractionSpan(
        frameTime - previousTime,
        action.repeat,
        action.repeatDelay,
      );
      return Math.max(latest, previousTime + segment);
    }, firstTime);
    return start + segmentEnd;
  }
  const duration = Math.max(
    action.duration,
    ...action.keyframes.map(frame => frame.time),
    0,
  );
  return start + repeatedInteractionSpan(duration, action.repeat, action.repeatDelay);
}

export function interactionDuration(interaction: InteractionDefinition) {
  const authoredCycle = Math.max(0.5, ...interaction.actions.map(interactionActionEnd));
  const normalizedRepeat = normalizeInteractionRepeat(interaction.repeat);
  const repeat = normalizedRepeat > 0 ? normalizedRepeat : 0;
  return authoredCycle * (repeat + 1);
}

function selectorUsesAttributeIdentity(
  selector: string,
  attributeName: 'data-kodety-interaction-id' | 'data-kodety-component-instance',
  identities: Set<string>,
) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = selector.match(new RegExp(`^\\[${escapedName}=["']([^"']+)["']\\]$`, 'i'));
  return Boolean(match && identities.has(match[1]));
}

export function pruneInteractionTargets(
  source: string,
  elementIds: Iterable<string>,
  interactionDocument?: InteractionDocument,
  componentInstanceIds: Iterable<string> = [],
) {
  const ids = new Set(elementIds);
  const instanceIds = new Set(componentInstanceIds);
  if (!ids.size && !instanceIds.size) return source;
  const selectorWasRemoved = (selector: string) => (
    selectorUsesAttributeIdentity(selector, 'data-kodety-interaction-id', ids)
    || selectorUsesAttributeIdentity(selector, 'data-kodety-component-instance', instanceIds)
  );
  const document = interactionDocument || readInteractionDocument(source);
  let changed = false;
  const interactions = document.interactions.flatMap(interaction => {
    if (selectorWasRemoved(interaction.triggerSelector)) {
      changed = true;
      return [];
    }
    const actions = interaction.actions.filter(action => !selectorWasRemoved(action.target.selector));
    if (actions.length !== interaction.actions.length) changed = true;
    return [{ ...interaction, actions }];
  });
  if (!changed) return source;
  return patchInteractionDocument(source, { ...document, interactions });
}

function cssEscapeEnd(value: string, slashIndex: number) {
  let index = slashIndex + 1;
  if (index >= value.length) return slashIndex;
  let hexadecimalLength = 0;
  while (
    index < value.length
    && hexadecimalLength < 6
    && /[0-9a-f]/i.test(value[index])
  ) {
    hexadecimalLength += 1;
    index += 1;
  }
  if (hexadecimalLength && index < value.length && /\s/.test(value[index])) {
    index += 1;
  } else if (!hexadecimalLength) {
    index += 1;
  }
  return index - 1;
}

function selectorSubjectCompounds(selector: string) {
  const subjects: string[] = [];
  let subjectStart = 0;
  let squareDepth = 0;
  let roundDepth = 0;
  let quote = '';
  const appendSubject = (end: number) => {
    const subject = selector.slice(subjectStart, end).trim();
    if (subject) subjects.push(subject);
  };
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '\\') {
      index = cssEscapeEnd(selector, index);
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') {
      squareDepth += 1;
      continue;
    }
    if (character === ']') {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (character === '(') {
      roundDepth += 1;
      continue;
    }
    if (character === ')') {
      roundDepth = Math.max(0, roundDepth - 1);
      continue;
    }
    if (squareDepth || roundDepth) continue;
    if (character === ',') {
      appendSubject(index);
      subjectStart = index + 1;
      continue;
    }
    if (character === '>' || character === '+' || character === '~') {
      subjectStart = index + 1;
      continue;
    }
    if (/\s/.test(character)) {
      let next = index + 1;
      while (next < selector.length && /\s/.test(selector[next])) next += 1;
      if (next < selector.length && selector[next] !== ',') {
        subjectStart = next;
      }
    }
  }
  appendSubject(selector.length);
  return subjects;
}

function decodeCssEscapedValue(value: string) {
  return value.replace(
    /\\([0-9a-f]{1,6})(?:\s)?|\\([^\n\r\f])/gi,
    (_match, hexadecimal: string | undefined, character: string | undefined) => {
      if (!hexadecimal) return character || '';
      const codePoint = Number.parseInt(hexadecimal, 16);
      return (
        Number.isFinite(codePoint)
        && codePoint > 0
        && codePoint <= 0x10FFFF
        && !(codePoint >= 0xD800 && codePoint <= 0xDFFF)
      )
        ? String.fromCodePoint(codePoint)
        : '\uFFFD';
    },
  );
}

function functionalPseudos(selector: string) {
  const pseudos: Array<{ name: string; argument: string }> = [];
  let base = '';
  let segmentStart = 0;
  let squareDepth = 0;
  let quote = '';
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '\\') {
      index = cssEscapeEnd(selector, index);
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') {
      squareDepth += 1;
      continue;
    }
    if (character === ']') {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (squareDepth || character !== ':') continue;
    const nameMatch = selector.slice(index + 1).match(/^([a-z-]+)\(/i);
    if (!nameMatch) continue;
    const openIndex = index + 1 + nameMatch[0].length - 1;
    let depth = 1;
    let innerQuote = '';
    let closeIndex = -1;
    for (let cursor = openIndex + 1; cursor < selector.length; cursor += 1) {
      const innerCharacter = selector[cursor];
      if (innerCharacter === '\\') {
        cursor = cssEscapeEnd(selector, cursor);
        continue;
      }
      if (innerQuote) {
        if (innerCharacter === innerQuote) innerQuote = '';
        continue;
      }
      if (innerCharacter === '"' || innerCharacter === "'") {
        innerQuote = innerCharacter;
        continue;
      }
      if (innerCharacter === '(') depth += 1;
      else if (innerCharacter === ')') {
        depth -= 1;
        if (!depth) {
          closeIndex = cursor;
          break;
        }
      }
    }
    if (closeIndex < 0) continue;
    base += selector.slice(segmentStart, index);
    pseudos.push({
      name: nameMatch[1].toLowerCase(),
      argument: selector.slice(openIndex + 1, closeIndex),
    });
    segmentStart = closeIndex + 1;
    index = closeIndex;
  }
  base += selector.slice(segmentStart);
  return { base, pseudos };
}

function cssIdentifierAt(value: string, start: number) {
  let index = start;
  let encoded = '';
  while (index < value.length) {
    const character = value[index];
    if (character === '\\') {
      const end = cssEscapeEnd(value, index);
      encoded += value.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (!/[-_a-z0-9\u0080-\uFFFF]/i.test(character)) break;
    encoded += character;
    index += 1;
  }
  return {
    end: index,
    value: decodeCssEscapedValue(encoded),
  };
}

/**
 * Renames one class token in a CSS selector without touching strings,
 * attribute-selector values, comments or longer identifiers. Persisted
 * Interaction selectors are authored CSS, so a textual `.old` replacement
 * would corrupt values such as `[data-label=".old"]` and `.oldest`.
 */
export function renameInteractionSelectorClassToken(
  selector: string,
  oldName: string,
  newName: string,
) {
  let segmentStart = 0;
  let result = '';
  let quote = '';
  let squareDepth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '\\') {
      index = cssEscapeEnd(selector, index);
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && selector[index + 1] === '*') {
      const close = selector.indexOf('*/', index + 2);
      index = close < 0 ? selector.length : close + 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') {
      squareDepth += 1;
      continue;
    }
    if (character === ']') {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (squareDepth || character !== '.') continue;
    const identifier = cssIdentifierAt(selector, index + 1);
    if (!identifier.value) continue;
    if (identifier.value === oldName) {
      result += selector.slice(segmentStart, index + 1);
      result += escapeCssIdentifier(newName);
      segmentStart = identifier.end;
    }
    index = identifier.end - 1;
  }
  return result ? result + selector.slice(segmentStart) : selector;
}

function renameInteractionClassListReference(
  value: string,
  oldName: string,
  newName: string,
) {
  return value.replace(/\S+/g, token => token === oldName ? newName : token);
}

function renameInteractionSelectorTarget(
  target: InteractionActionTarget,
  oldName: string,
  newName: string,
) {
  const selector = renameInteractionSelectorClassToken(
    target.selector,
    oldName,
    newName,
  );
  const label = target.label === target.selector
    ? selector
    : target.label === `.${oldName}`
      ? `.${newName}`
      : target.label;
  return selector === target.selector && label === target.label
    ? target
    : { ...target, selector, label };
}

/**
 * Purely rewrites every structured class reference owned by an Interactions v2
 * document. Custom JavaScript is deliberately left untouched: parsing and
 * rewriting arbitrary user code would change a different authoring contract.
 */
export function renameInteractionClassReferences(
  document: InteractionDocument,
  oldName: string,
  newName: string,
): InteractionDocument {
  if (
    !oldName
    || !newName
    || oldName === newName
    || /\s/.test(oldName)
    || /\s/.test(newName)
  ) return document;

  const interactions = document.interactions.map(interaction => {
    const triggerSelector = renameInteractionSelectorClassToken(
      interaction.triggerSelector,
      oldName,
      newName,
    );
    const triggerLabel = interaction.triggerLabel === interaction.triggerSelector
      ? triggerSelector
      : interaction.triggerLabel === `.${oldName}`
        ? `.${newName}`
        : interaction.triggerLabel;
    const scrollTriggerSelector = renameInteractionSelectorClassToken(
      interaction.scrollTriggerSelector,
      oldName,
      newName,
    );
    const scrollTriggerLabel = interaction.scrollTriggerLabel
      === interaction.scrollTriggerSelector
      ? scrollTriggerSelector
      : interaction.scrollTriggerLabel === `.${oldName}`
        ? `.${newName}`
        : interaction.scrollTriggerLabel;
    const actions = interaction.actions.map(action => {
      const target = renameInteractionSelectorTarget(
        action.target,
        oldName,
        newName,
      );
      const className = action.kind.startsWith('class-')
        ? renameInteractionClassListReference(
            action.className,
            oldName,
            newName,
          )
        : action.className;
      return target === action.target && className === action.className
        ? action
        : { ...action, target, className };
    });
    let behavior = interaction.behavior;
    if (behavior) {
      const target = renameInteractionSelectorTarget(
        behavior.target,
        oldName,
        newName,
      );
      if (
        behavior.kind === 'image-sequence'
        || behavior.kind === 'video-scrub'
      ) {
        const mediaBehavior = behavior;
        const milestones = mediaBehavior.milestones.map(milestone => {
          const selector = renameInteractionSelectorClassToken(
            milestone.selector,
            oldName,
            newName,
          );
          const label = milestone.label === milestone.selector
            ? selector
            : milestone.label === `.${oldName}`
              ? `.${newName}`
              : milestone.label;
          return selector === milestone.selector && label === milestone.label
            ? milestone
            : { ...milestone, selector, label };
        });
        if (
          target !== mediaBehavior.target
          || milestones.some((milestone, index) => (
            milestone !== mediaBehavior.milestones[index]
          ))
        ) behavior = { ...mediaBehavior, target, milestones };
      } else if (target !== behavior.target) {
        behavior = { ...behavior, target };
      }
    }
    const changed = (
      triggerSelector !== interaction.triggerSelector
      || triggerLabel !== interaction.triggerLabel
      || scrollTriggerSelector !== interaction.scrollTriggerSelector
      || scrollTriggerLabel !== interaction.scrollTriggerLabel
      || actions.some((action, index) => action !== interaction.actions[index])
      || behavior !== interaction.behavior
    );
    return changed
      ? {
          ...interaction,
          triggerSelector,
          triggerLabel,
          scrollTriggerSelector,
          scrollTriggerLabel,
          actions,
          behavior,
        }
      : interaction;
  });
  return interactions.some((interaction, index) => (
    interaction !== document.interactions[index]
  ))
    ? { ...document, interactions }
    : document;
}

export interface RenameProjectInteractionClassReferencesResult {
  /** Original snapshot on a no-op; immutable replacement after a change. */
  project: HtmlProject;
  /** Stable, sorted companion paths changed by this transaction. */
  changedFilePaths: string[];
}

/**
 * Renames structured class references in every canonical/legacy companion for
 * the supplied HTML files. All documents are parsed and prepared first; an
 * invalid companion aborts without mutating the input project.
 */
export function renameProjectInteractionClassReferences(
  project: HtmlProject,
  htmlFilePaths: readonly string[],
  oldName: string,
  newName: string,
): RenameProjectInteractionClassReferencesResult {
  if (
    !oldName
    || !newName
    || oldName === newName
    || /\s/.test(oldName)
    || /\s/.test(newName)
  ) return { project, changedFilePaths: [] };

  const companionPaths = Array.from(new Set(
    htmlFilePaths
      .filter(path => /\.html?$/i.test(path) && project.files[path]?.text !== undefined)
      .flatMap(path => interactionDocumentPathCandidates(path))
      .filter(path => project.files[path]?.text !== undefined),
  )).sort();
  const prepared = new Map<string, string>();
  companionPaths.forEach(path => {
    const source = project.files[path].text || '';
    const document = parseInteractionDocumentText(source);
    if (!document) throw new Error(`Documento de interações inválido: ${path}`);
    const renamed = renameInteractionClassReferences(document, oldName, newName);
    if (renamed === document) return;
    prepared.set(path, serializeInteractionDocument(renamed, {
      canonical: document.canonical === true,
    }));
  });

  const changedFilePaths = [...prepared.keys()];
  if (!changedFilePaths.length) return { project, changedFilePaths };
  const files = { ...project.files };
  prepared.forEach((text, path) => {
    files[path] = { ...files[path], text };
  });
  return {
    project: { ...project, files },
    changedFilePaths,
  };
}

function selectionAttribute(
  selection: SelectionSnapshot,
  attributeName: string,
) {
  const normalizedName = attributeName.toLowerCase();
  const entry = Object.entries(selection.attributes).find(
    ([name]) => name.toLowerCase() === normalizedName,
  );
  if (normalizedName === 'id') {
    return entry ? entry[1] : selection.id || undefined;
  }
  if (normalizedName === 'class') {
    return entry
      ? entry[1]
      : selection.classes.length
        ? selection.classes.join(' ')
        : undefined;
  }
  return entry?.[1];
}

function compoundWithoutAttributes(
  compound: string,
  selection: SelectionSnapshot,
) {
  let result = '';
  let segmentStart = 0;
  for (let index = 0; index < compound.length; index += 1) {
    if (compound[index] === '\\') {
      index = cssEscapeEnd(compound, index);
      continue;
    }
    if (compound[index] !== '[') continue;
    let quote = '';
    let closeIndex = -1;
    for (let cursor = index + 1; cursor < compound.length; cursor += 1) {
      const character = compound[cursor];
      if (character === '\\') {
        cursor = cssEscapeEnd(compound, cursor);
        continue;
      }
      if (quote) {
        if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === ']') {
        closeIndex = cursor;
        break;
      }
    }
    if (closeIndex < 0) return null;
    const condition = compound.slice(index + 1, closeIndex).trim();
    const match = condition.match(
      /^([^\s~|^$*=\]]+)\s*(?:(~=|\|=|\^=|\$=|\*=|=)\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+))\s*([is])?)?$/i,
    );
    if (!match) return null;
    const attributeName = decodeCssEscapedValue(match[1]);
    const actual = selectionAttribute(selection, attributeName);
    if (actual === undefined) return null;
    const operator = match[2];
    if (operator) {
      const expected = decodeCssEscapedValue(
        match[3] ?? match[4] ?? match[5] ?? '',
      );
      const insensitive = match[6]?.toLowerCase() === 'i';
      const left = insensitive ? actual.toLowerCase() : actual;
      const right = insensitive ? expected.toLowerCase() : expected;
      const matches = operator === '='
        ? left === right
        : operator === '~='
          ? left.split(/\s+/).includes(right)
          : operator === '|='
            ? left === right || left.startsWith(`${right}-`)
            : operator === '^='
              ? left.startsWith(right)
              : operator === '$='
                ? left.endsWith(right)
                : left.includes(right);
      if (!matches) return null;
    }
    result += compound.slice(segmentStart, index);
    segmentStart = closeIndex + 1;
    index = closeIndex;
  }
  result += compound.slice(segmentStart);
  return result;
}

function compoundMatchesSelection(
  compound: string,
  selection: SelectionSnapshot,
): boolean {
  const extracted = functionalPseudos(compound);
  for (const pseudo of extracted.pseudos) {
    const matchesArgument = selectorSubjectCompounds(pseudo.argument)
      .some(subject => compoundMatchesSelection(subject, selection));
    if (pseudo.name === 'not') {
      if (matchesArgument) return false;
    } else if (pseudo.name === 'is' || pseudo.name === 'where') {
      if (!matchesArgument) return false;
    } else {
      // Structural/relational functional pseudos need the authored DOM. The
      // snapshot-only fallback stays conservative instead of claiming a layer.
      return false;
    }
  }
  const withoutAttributes = compoundWithoutAttributes(
    extracted.base,
    selection,
  );
  if (withoutAttributes === null) return false;
  const simple = withoutAttributes
    .replace(/::?[-_a-z][-_a-z0-9]*/gi, '')
    .trim();
  let index = 0;
  if (simple[index] === '*') {
    index += 1;
  } else {
    const tag = cssIdentifierAt(simple, index);
    if (tag.value) {
      if (tag.value.toLowerCase() !== selection.tag.toLowerCase()) return false;
      index = tag.end;
    }
  }
  while (index < simple.length) {
    const prefix = simple[index];
    if (prefix !== '.' && prefix !== '#') {
      if (!/\s/.test(prefix)) return false;
      index += 1;
      continue;
    }
    const identifier = cssIdentifierAt(simple, index + 1);
    if (!identifier.value) return false;
    if (
      prefix === '#'
        ? selection.id !== identifier.value
        : !selection.classes.includes(identifier.value)
    ) return false;
    index = identifier.end;
  }
  return true;
}

function selectorMatchesSelection(selector: string, selection: SelectionSnapshot) {
  const normalized = selector.trim();
  if (!normalized) return false;
  if (normalized === selection.path) return true;
  return selectorSubjectCompounds(normalized)
    .some(subject => compoundMatchesSelection(subject, selection));
}

let interactionSelectionDomCache: {
  source: string;
  document: Document;
  paths: Map<Element, string>;
  elementsByPath: Map<string, Element>;
} | null = null;

function selectionDomForSource(source: string) {
  if (typeof DOMParser === 'undefined') return null;
  const authoredSource = stripInteractionRuntime(source);
  if (interactionSelectionDomCache?.source === authoredSource) {
    return interactionSelectionDomCache;
  }
  const parsed = new DOMParser().parseFromString(authoredSource, 'text/html');
  const paths = new Map<Element, string>();
  const elementsByPath = new Map<string, Element>();
  const annotate = (element: Element, path: string) => {
    paths.set(element, path);
    elementsByPath.set(path, element);
    if (element.tagName.toLowerCase() === 'svg') return;
    Array.from(element.children).forEach((child, index) => {
      annotate(child, path ? `${path}/${index}` : String(index));
    });
  };
  annotate(parsed.body, '');
  interactionSelectionDomCache = {
    source: authoredSource,
    document: parsed,
    paths,
    elementsByPath,
  };
  return interactionSelectionDomCache;
}

function interactionDomSafeQuery(
  root: Document | Element,
  selector: string,
  mode: InteractionTargetMode = 'selector',
) {
  if (!selector) return [] as Element[];
  const normalized = selector.trim();
  if (/^[-_a-z0-9\u0080-\uFFFF]+$/i.test(normalized)) {
    if (mode === 'class') {
      const matches = Array.from(root.getElementsByClassName(normalized));
      if (matches.length) return matches;
    } else if (mode === 'element') {
      const matches = Array.from(
        root.querySelectorAll('[data-kodety-interaction-id], [id]'),
      ).filter(element => (
        element.getAttribute('data-kodety-interaction-id') === normalized
        || element.id === normalized
      ));
      if (matches.length) return matches;
    }
  }
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [] as Element[];
  }
}

function interactionDomSafeMatches(
  element: Element,
  selector: string,
  mode: InteractionTargetMode = 'selector',
) {
  const normalized = selector.trim();
  if (/^[-_a-z0-9\u0080-\uFFFF]+$/i.test(normalized)) {
    if (mode === 'class') return element.classList.contains(normalized);
    if (mode === 'element') {
      return (
        element.getAttribute('data-kodety-interaction-id') === normalized
        || element.id === normalized
      );
    }
  }
  try {
    return !selector || element.matches(selector);
  } catch {
    return false;
  }
}

function interactionDomTriggerElements(
  parsed: Document,
  interaction: InteractionDefinition,
) {
  const queried = interactionDomSafeQuery(
    parsed,
    interaction.triggerSelector,
    interaction.triggerTargetMode,
  );
  return queried.length
    ? queried
    : interaction.trigger === 'load' || interaction.trigger === 'custom'
      ? [parsed.body]
      : [];
}

function interactionDomActionTargets(
  parsed: Document,
  action: InteractionAction,
  triggerElement: Element,
): Element[] {
  const { selector, scope, mode } = action.target;
  if (scope === 'trigger') return [triggerElement];
  if (scope === 'children') {
    return Array.from(triggerElement.children)
      .filter(element => interactionDomSafeMatches(element, selector, mode));
  }
  if (scope === 'descendants') {
    return interactionDomSafeQuery(triggerElement, selector || '*', mode);
  }
  if (scope === 'parent') {
    return triggerElement.parentElement
      && interactionDomSafeMatches(triggerElement.parentElement, selector, mode)
      ? [triggerElement.parentElement]
      : [];
  }
  if (scope === 'closest') {
    try {
      const closest = triggerElement.parentElement?.closest(selector || '*');
      return closest ? [closest] : [];
    } catch {
      return [];
    }
  }
  if (scope === 'siblings') {
    return triggerElement.parentElement
      ? Array.from(triggerElement.parentElement.children)
        .filter(element => (
          element !== triggerElement
          && interactionDomSafeMatches(element, selector, mode)
        ))
      : [];
  }
  if (scope === 'next') {
    return triggerElement.nextElementSibling
      && interactionDomSafeMatches(
        triggerElement.nextElementSibling,
        selector,
        mode,
      )
      ? [triggerElement.nextElementSibling]
      : [];
  }
  if (scope === 'previous') {
    return triggerElement.previousElementSibling
      && interactionDomSafeMatches(
        triggerElement.previousElementSibling,
        selector,
        mode,
      )
      ? [triggerElement.previousElementSibling]
      : [];
  }
  return interactionDomSafeQuery(parsed, selector, mode);
}

/**
 * Exact, source-aware trigger ownership for inspector decisions. Unlike the
 * snapshot-only fallback, this resolves combinators and relative DOM position
 * against the authored page.
 */
export function interactionTriggerMatchesSelectionPath(
  source: string,
  interaction: InteractionDefinition,
  selectionPath: string,
) {
  const dom = selectionDomForSource(source);
  const selectedElement = dom?.elementsByPath.get(selectionPath);
  if (!dom || !selectedElement) return false;
  return interactionDomTriggerElements(dom.document, interaction)
    .includes(selectedElement);
}

/**
 * Exact, source-aware action-target ownership for one selected layer. Relative
 * scopes are resolved from the interaction's real trigger elements, so a
 * same-class copy elsewhere on the page cannot claim the action.
 */
export function interactionActionTargetMatchesSelectionPath(
  source: string,
  interaction: InteractionDefinition,
  action: InteractionAction,
  selectionPath: string,
) {
  const dom = selectionDomForSource(source);
  const selectedElement = dom?.elementsByPath.get(selectionPath);
  if (!dom || !selectedElement) return false;
  return interactionDomTriggerElements(dom.document, interaction)
    .some(triggerElement => (
      interactionDomActionTargets(dom.document, action, triggerElement)
        .includes(selectedElement)
    ));
}

function interactionTimelineForSelectionPath(
  source: string,
  interaction: InteractionDefinition,
  selectionPath: string,
): InteractionDefinition | null | undefined {
  if (
    selectionPath
    && !/^\d+(?:\/\d+)*$/.test(selectionPath)
  ) return undefined;
  const dom = selectionDomForSource(source);
  if (!dom) return undefined;
  const selectedElement = dom.elementsByPath.get(selectionPath);
  if (!selectedElement) return null;
  const triggerElements = interactionDomTriggerElements(
    dom.document,
    interaction,
  );
  if (triggerElements.includes(selectedElement)) return interaction;
  const matchingActions = interaction.actions.filter(action => (
    triggerElements.some(triggerElement => (
      interactionDomActionTargets(dom.document, action, triggerElement)
        .includes(selectedElement)
    ))
  ));
  if (!matchingActions.length) return null;
  if (matchingActions.length === interaction.actions.length) return interaction;
  return { ...interaction, actions: matchingActions };
}

export function interactionMatchesSelection(
  interaction: InteractionDefinition,
  selection: SelectionSnapshot,
  source?: string,
) {
  return interactionTimelineForSelection(
    interaction,
    selection,
    source,
  ) !== null;
}

/**
 * Produces the part of an interaction that belongs to one selected layer.
 * Selecting the interaction trigger keeps its complete timeline; selecting an
 * action target keeps only the actions that actually target that layer.
 */
export function interactionTimelineForSelection(
  interaction: InteractionDefinition,
  selection: SelectionSnapshot,
  source?: string,
): InteractionDefinition | null {
  if (source !== undefined) {
    const resolved = interactionTimelineForSelectionPath(
      source,
      interaction,
      selection.path,
    );
    if (resolved !== undefined) return resolved;
  }
  const triggerMatches = selectorMatchesSelection(interaction.triggerSelector, selection);
  const matchingActions = interaction.actions.filter(action => (
    action.target.scope === 'trigger'
      ? triggerMatches
      : selectorMatchesSelection(action.target.selector, selection)
  ));
  if (!triggerMatches && !matchingActions.length) return null;
  if (triggerMatches || matchingActions.length === interaction.actions.length) return interaction;
  return { ...interaction, actions: matchingActions };
}

/**
 * Resolves editor-managed interactions against the authored DOM and returns
 * the in-scope part of every timeline that starts from or animates an element
 * inside the selected subtree. The returned definitions are shallow projected
 * views; the authored document remains unchanged.
 */
export function interactionsInSelectionSubtree(
  source: string,
  interactions: InteractionDefinition[],
  selectionPath: string,
) {
  if (
    !interactions.length
    || (selectionPath && !/^\d+(?:\/\d+)*$/.test(selectionPath))
  ) return [];
  const dom = selectionDomForSource(source);
  if (!dom || !dom.elementsByPath.has(selectionPath)) return [];

  const isInsideSelection = (element: Element | null | undefined) => {
    if (!element) return false;
    const path = dom.paths.get(element);
    if (path === undefined) return false;
    return selectionPath === ''
      || path === selectionPath
      || path.startsWith(`${selectionPath}/`);
  };
  return interactions.flatMap(interaction => {
    const triggerElements = interactionDomTriggerElements(
      dom.document,
      interaction,
    );
    const triggerInside = triggerElements.some(isInsideSelection);
    const actions = interaction.actions.filter(action => (
      triggerElements.some(triggerElement => (
        interactionDomActionTargets(dom.document, action, triggerElement)
          .some(isInsideSelection)
      ))
    ));
    if (!triggerInside && !actions.length) return [];
    return [{
      ...interaction,
      actions,
    }];
  });
}

/**
 * A projected timeline can safely control its canonical runtime only when the
 * projection contains every authored action and every trigger/target instance
 * resolved by that runtime stays inside the selected subtree.
 */
export function interactionProjectionIsCompleteForSelectionSubtree(
  source: string,
  interaction: InteractionDefinition,
  projection: InteractionDefinition,
  selectionPath: string,
) {
  if (
    interaction.id !== projection.id
    || interaction.actions.length !== projection.actions.length
    || interaction.actions.some((action, index) => (
      projection.actions[index]?.id !== action.id
    ))
  ) return false;
  const dom = selectionDomForSource(source);
  if (!dom || !dom.elementsByPath.has(selectionPath)) return false;
  const isInsideSelection = (element: Element | null | undefined) => {
    if (!element) return false;
    const path = dom.paths.get(element);
    if (path === undefined) return false;
    return selectionPath === ''
      || path === selectionPath
      || path.startsWith(`${selectionPath}/`);
  };
  const triggerElements = interactionDomTriggerElements(
    dom.document,
    interaction,
  );
  if (
    !triggerElements.length
    || triggerElements.some(triggerElement => !isInsideSelection(triggerElement))
  ) return false;
  return interaction.actions.every(action => (
    triggerElements.every(triggerElement => {
      const targets = interactionDomActionTargets(
        dom.document,
        action,
        triggerElement,
      );
      return targets.length > 0 && targets.every(isInsideSelection);
    })
  ));
}
