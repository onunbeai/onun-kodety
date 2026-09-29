import {
  DEFAULT_ACTION_TARGET,
  addInteraction,
  createInteractionAction,
  ensureInteractionSelector,
  interactionSelectorExistsInSource,
  readInteractionDocument,
  updateInteraction,
  type InteractionAction,
  type InteractionBehavior,
  type InteractionDefinition,
  type InteractionScrollMilestone,
} from './interactions';
import type { SelectionSnapshot } from './types';

export type InteractionLibraryEffectId =
  | 'fade-in'
  | 'fade-up'
  | 'fade-down'
  | 'fade-left'
  | 'fade-right'
  | 'scale-in'
  | 'zoom-out'
  | 'rotate-in'
  | 'blur-reveal'
  | 'mask-reveal'
  | 'clip-up'
  | 'text-words'
  | 'text-chars'
  | 'text-lines'
  | 'text-blur-words'
  | 'text-roll-whole'
  | 'text-roll-words'
  | 'text-roll-chars'
  | 'stagger-children'
  | 'hover-lift'
  | 'hover-scale'
  | 'parallax-y'
  | 'scroll-scale'
  | 'scroll-rotate'
  | 'count-up'
  | 'magnetic'
  | 'ticker-infinite'
  | 'ticker-infinite-reverse'
  | 'image-sequence'
  | 'video-scrub';

export type InteractionLibraryCategory =
  | 'Reveal'
  | 'Text'
  | 'Pointer'
  | 'Data'
  | 'Scroll';

export type InteractionLibraryActivation =
  | 'entrance'
  | 'hover'
  | 'cursor'
  | 'continuous'
  | 'scroll';

export interface InteractionLibraryCatalogItem {
  id: InteractionLibraryEffectId;
  name: string;
  description: string;
  category: InteractionLibraryCategory;
  activation: InteractionLibraryActivation;
  engine: 'timeline' | 'behavior';
  targetHint: string;
}

export const INTERACTION_LIBRARY_CATALOG: InteractionLibraryCatalogItem[] = [
  { id: 'fade-in', name: 'Fade In', description: 'Entrada limpa por opacidade.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Qualquer layer' },
  { id: 'fade-up', name: 'Fade Up', description: 'Opacidade com deslocamento vertical.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Qualquer layer' },
  { id: 'fade-down', name: 'Fade Down', description: 'Entrada suave vinda de cima.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Qualquer layer' },
  { id: 'fade-left', name: 'Fade Left', description: 'Entrada horizontal vinda da direita.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Qualquer layer' },
  { id: 'fade-right', name: 'Fade Right', description: 'Entrada horizontal vinda da esquerda.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Qualquer layer' },
  { id: 'scale-in', name: 'Scale In', description: 'Entrada com escala e desaceleração.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Qualquer layer' },
  { id: 'zoom-out', name: 'Zoom Out', description: 'Assenta a layer a partir de uma escala maior.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Imagem, mídia ou container' },
  { id: 'rotate-in', name: 'Rotate In', description: 'Entrada curta com rotação e escala.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Card, mídia ou destaque' },
  { id: 'blur-reveal', name: 'Blur Reveal', description: 'Desfoca e revela suavemente.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Texto, mídia ou container' },
  { id: 'mask-reveal', name: 'Mask Reveal', description: 'Wipe por recorte, ideal para logos.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Imagem, logo ou container' },
  { id: 'clip-up', name: 'Clip Up', description: 'Revela verticalmente por uma máscara limpa.', category: 'Reveal', activation: 'entrance', engine: 'timeline', targetHint: 'Imagem, logo ou container' },
  { id: 'text-words', name: 'Words Reveal', description: 'Revela o texto palavra por palavra.', category: 'Text', activation: 'entrance', engine: 'timeline', targetHint: 'Texto simples' },
  { id: 'text-chars', name: 'Characters Reveal', description: 'Revela o texto caractere por caractere.', category: 'Text', activation: 'entrance', engine: 'timeline', targetHint: 'Texto simples' },
  { id: 'text-lines', name: 'Lines Reveal', description: 'Revela o texto linha por linha.', category: 'Text', activation: 'entrance', engine: 'timeline', targetHint: 'Parágrafo ou heading simples' },
  { id: 'text-blur-words', name: 'Blur Words', description: 'Palavras entram com blur e profundidade.', category: 'Text', activation: 'entrance', engine: 'timeline', targetHint: 'Texto simples' },
  { id: 'text-roll-whole', name: 'Text Roll', description: 'Duplica e troca o label inteiro no hover.', category: 'Text', activation: 'hover', engine: 'behavior', targetHint: 'Layer simples de texto dentro do botão ou link' },
  { id: 'text-roll-words', name: 'Words Roll', description: 'Duplica e troca o label palavra por palavra.', category: 'Text', activation: 'hover', engine: 'behavior', targetHint: 'Layer simples de texto dentro do botão ou link' },
  { id: 'text-roll-chars', name: 'Characters Roll', description: 'Duplica e troca o label caractere por caractere.', category: 'Text', activation: 'hover', engine: 'behavior', targetHint: 'Layer simples de texto dentro do botão ou link' },
  { id: 'stagger-children', name: 'Stagger Children', description: 'Revela os filhos diretos em cascata.', category: 'Text', activation: 'entrance', engine: 'timeline', targetHint: 'Lista, grid ou grupo de cards' },
  { id: 'hover-lift', name: 'Hover Lift', description: 'Eleva a layer com sombra no hover.', category: 'Pointer', activation: 'hover', engine: 'timeline', targetHint: 'Card, botão ou link' },
  { id: 'hover-scale', name: 'Hover Scale', description: 'Amplia sutilmente a layer no hover.', category: 'Pointer', activation: 'hover', engine: 'timeline', targetHint: 'Card, botão, link ou mídia' },
  { id: 'parallax-y', name: 'Parallax Y', description: 'Movimento vertical contínuo ligado ao scroll.', category: 'Scroll', activation: 'scroll', engine: 'timeline', targetHint: 'Imagem, mídia ou camada decorativa' },
  { id: 'scroll-scale', name: 'Scroll Scale', description: 'Escala continuamente durante a passagem.', category: 'Scroll', activation: 'scroll', engine: 'timeline', targetHint: 'Imagem, card ou seção' },
  { id: 'scroll-rotate', name: 'Scroll Rotate', description: 'Rotação sutil e contínua por scroll.', category: 'Scroll', activation: 'scroll', engine: 'timeline', targetHint: 'Imagem ou elemento decorativo' },
  { id: 'count-up', name: 'Count Up', description: 'Anima de zero até o valor da layer.', category: 'Data', activation: 'entrance', engine: 'behavior', targetHint: 'Layer de texto numérico' },
  { id: 'magnetic', name: 'Magnetic', description: 'Atrai o elemento em direção ao cursor.', category: 'Pointer', activation: 'cursor', engine: 'behavior', targetHint: 'Botão, link ou container' },
  { id: 'ticker-infinite', name: 'Ticker Infinito', description: 'Loop horizontal contínuo, com hover e arraste sem salto visual.', category: 'Pointer', activation: 'continuous', engine: 'behavior', targetHint: 'Container com itens repetíveis' },
  { id: 'ticker-infinite-reverse', name: 'Ticker Infinito · Reverso', description: 'Ticker contínuo no sentido oposto, com os mesmos controles de interação.', category: 'Pointer', activation: 'continuous', engine: 'behavior', targetHint: 'Container com itens repetíveis' },
  { id: 'image-sequence', name: 'Image Sequence', description: 'Scrub de frames por marcos de Scroll Sections.', category: 'Scroll', activation: 'scroll', engine: 'behavior', targetHint: 'Layer de imagem' },
  { id: 'video-scrub', name: 'Video Scrub', description: 'Mapeia Scroll Sections para segundos do vídeo.', category: 'Scroll', activation: 'scroll', engine: 'behavior', targetHint: 'Layer de vídeo' },
];

export interface NumericTextParts {
  value: number;
  decimals: number;
  prefix: string;
  suffix: string;
}

/** Best-effort parsing that keeps common currency/percentage decoration. */
export function parseNumericLayerText(text: string): NumericTextParts {
  const match = text.match(/[-+]?\d[\d\s.,]*/);
  if (!match) return { value: 0, decimals: 0, prefix: '', suffix: '' };
  const leadingWhitespace = match[0].length - match[0].trimStart().length;
  const trailingWhitespace = match[0].length - match[0].trimEnd().length;
  const raw = match[0].trim();
  const compact = raw.replace(/\s/gu, '');
  const numericStart = (match.index || 0) + leadingWhitespace;
  const numericEnd = (match.index || 0) + match[0].length - trailingWhitespace;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  const trailingDigits = decimalIndex >= 0
    ? compact.slice(decimalIndex + 1).replace(/\D/g, '').length
    : 0;
  const hasBothSeparators = lastComma >= 0 && lastDot >= 0;
  const decimalSeparator = decimalIndex >= 0
    && (hasBothSeparators || trailingDigits > 0 && trailingDigits <= 2)
    ? compact[decimalIndex]
    : '';
  const normalized = compact
    .split('')
    .filter((character, index) => /\d|[-+]/.test(character) || (
      decimalSeparator
      && character === decimalSeparator
      && index === decimalIndex
    ))
    .join('')
    .replace(decimalSeparator, decimalSeparator ? '.' : '');
  const value = Number(normalized);
  return {
    value: Number.isFinite(value) ? value : 0,
    decimals: decimalSeparator ? trailingDigits : 0,
    prefix: text.slice(0, numericStart),
    suffix: text.slice(numericEnd),
  };
}

const libraryId = (prefix: string) => (
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
);

export function sectionMilestone(
  section: { id: string; label: string },
  value: number,
  viewportAnchor = 0.5,
): InteractionScrollMilestone {
  return {
    id: libraryId('milestone'),
    selector: sectionSelector(section.id),
    label: section.label || `#${section.id}`,
    value,
    elementAnchor: 0,
    viewportAnchor,
    offsetPx: 0,
  };
}

export function sectionSelector(id: string) {
  return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

export interface InteractionLibraryDraft {
  effectId: InteractionLibraryEffectId;
  target: SelectionSnapshot;
  /** Existing interactions keep their persisted selector until the picker changes it. */
  targetChanged: boolean;
  targetLabel: string;
  enabled: boolean;
  countFrom: number;
  countTo: number;
  countDuration: number;
  countDecimals: number;
  countPrefix: string;
  countSuffix: string;
  countLocale: string;
  magneticStrength: number;
  magneticRadius: number;
  magneticSmoothing: number;
  magneticReturnDuration: number;
  textRollSplit: 'whole' | 'words' | 'chars';
  textRollDuration: number;
  textRollStagger: number;
  textRollDistance: number;
  tickerDirection: 'left' | 'right';
  tickerSpeed: number;
  tickerGap: number;
  tickerHoverBehavior: 'none' | 'pause' | 'slow';
  tickerHoverSlowdown: number;
  tickerHoverTransition: number;
  tickerDraggable: boolean;
  tickerDragSensitivity: number;
  tickerMomentum: number;
  imageUrlTemplate: string;
  imageStartIndex: number;
  imageEndIndex: number;
  imageZeroPad: number;
  imagePreloadRadius: number;
  videoStartTime: number;
  videoEndTime: number;
  videoSmoothing: number;
  viewportAnchor: number;
  milestones: InteractionScrollMilestone[];
}

export function interactionLibraryTargetLabel(target: SelectionSnapshot) {
  if (target.id) return `#${target.id}`;
  if (target.classes[0]) return `.${target.classes[0]}`;
  return target.tag.toLowerCase();
}

export function createInteractionLibraryDraft(
  effectId: InteractionLibraryEffectId,
  target: SelectionSnapshot,
  _sections: Array<{ id: string; label: string }> = [],
): InteractionLibraryDraft {
  const numeric = parseNumericLayerText(target.text || '');
  const imageStartIndex = 0;
  const imageEndIndex = 120;
  const videoStartTime = 0;
  const videoEndTime = 10;
  return {
    effectId,
    target,
    targetChanged: true,
    targetLabel: interactionLibraryTargetLabel(target),
    enabled: true,
    countFrom: 0,
    countTo: numeric.value,
    countDuration: 1.4,
    countDecimals: numeric.decimals,
    countPrefix: numeric.prefix,
    countSuffix: numeric.suffix,
    countLocale: 'pt-BR',
    magneticStrength: 0.28,
    magneticRadius: 120,
    magneticSmoothing: 0.28,
    magneticReturnDuration: 0.55,
    textRollSplit: effectId === 'text-roll-chars'
      ? 'chars'
      : effectId === 'text-roll-whole'
        ? 'whole'
        : 'words',
    textRollDuration: 0.36,
    textRollStagger: effectId === 'text-roll-whole' ? 0 : 0.035,
    textRollDistance: 112,
    tickerDirection: effectId === 'ticker-infinite-reverse' ? 'right' : 'left',
    tickerSpeed: 56,
    tickerGap: 32,
    tickerHoverBehavior: 'slow',
    tickerHoverSlowdown: 0.18,
    tickerHoverTransition: 0.24,
    tickerDraggable: true,
    tickerDragSensitivity: 1,
    tickerMomentum: 0.9,
    imageUrlTemplate: '',
    imageStartIndex,
    imageEndIndex,
    imageZeroPad: 0,
    imagePreloadRadius: 3,
    videoStartTime,
    videoEndTime,
    videoSmoothing: 0.12,
    viewportAnchor: 0.5,
    milestones: [],
  };
}

export function retargetInteractionLibraryDraft(
  draft: InteractionLibraryDraft,
  target: SelectionSnapshot,
): InteractionLibraryDraft {
  const next = {
    ...draft,
    target,
    targetChanged: true,
    targetLabel: interactionLibraryTargetLabel(target),
  };
  if (draft.effectId !== 'count-up') return next;
  const numeric = parseNumericLayerText(target.text || '');
  return {
    ...next,
    countTo: numeric.value,
    countDecimals: numeric.decimals,
    countPrefix: numeric.prefix,
    countSuffix: numeric.suffix,
  };
}

export function interactionLibraryDraftFromDefinition(
  interaction: InteractionDefinition,
  target: SelectionSnapshot,
): InteractionLibraryDraft {
  const persistedEffect = INTERACTION_LIBRARY_CATALOG.find(
    item => item.id === interaction.libraryEffectId,
  )?.id;
  const behaviorEffect = interaction.behavior?.kind === 'text-roll'
    ? interaction.behavior.split === 'chars'
      ? 'text-roll-chars'
      : interaction.behavior.split === 'whole'
        ? 'text-roll-whole'
        : 'text-roll-words'
    : interaction.behavior?.kind === 'ticker'
      ? persistedEffect === 'ticker-infinite' || persistedEffect === 'ticker-infinite-reverse'
        ? persistedEffect
        : interaction.behavior.direction === 'right'
          ? 'ticker-infinite-reverse'
          : 'ticker-infinite'
      : interaction.behavior
        ? INTERACTION_LIBRARY_CATALOG.find(item => item.id === interaction.behavior?.kind)?.id
        : undefined;
  const effectId = behaviorEffect || persistedEffect || 'fade-in';
  const draft = {
    ...createInteractionLibraryDraft(effectId, target),
    targetChanged: false,
    targetLabel: interaction.triggerLabel || interaction.triggerSelector || 'Target',
    enabled: interaction.enabled,
  };
  const behavior = interaction.behavior;
  if (!behavior) return draft;
  if (behavior.kind === 'count-up') return {
    ...draft,
    countFrom: behavior.from,
    countTo: behavior.to,
    countDuration: behavior.duration,
    countDecimals: behavior.decimals,
    countPrefix: behavior.prefix,
    countSuffix: behavior.suffix,
    countLocale: behavior.locale,
  };
  if (behavior.kind === 'magnetic') return {
    ...draft,
    magneticStrength: behavior.strength,
    magneticRadius: behavior.radius,
    magneticSmoothing: behavior.smoothing,
    magneticReturnDuration: behavior.returnDuration,
  };
  if (behavior.kind === 'text-roll') return {
    ...draft,
    textRollSplit: behavior.split,
    textRollDuration: behavior.duration,
    textRollStagger: behavior.stagger,
    textRollDistance: behavior.distance,
  };
  if (behavior.kind === 'ticker') return {
    ...draft,
    tickerDirection: behavior.direction,
    tickerSpeed: behavior.speed,
    tickerGap: behavior.gap,
    tickerHoverBehavior: behavior.hoverBehavior,
    tickerHoverSlowdown: behavior.hoverSlowdown,
    tickerHoverTransition: behavior.hoverTransition,
    tickerDraggable: behavior.draggable,
    tickerDragSensitivity: behavior.dragSensitivity,
    tickerMomentum: behavior.momentum,
  };
  if (behavior.kind === 'image-sequence') return {
    ...draft,
    imageUrlTemplate: behavior.urlTemplate,
    imageStartIndex: behavior.startIndex,
    imageEndIndex: behavior.endIndex,
    imageZeroPad: behavior.zeroPad,
    imagePreloadRadius: behavior.preloadRadius,
    viewportAnchor: behavior.viewportAnchor,
    milestones: behavior.milestones.map(milestone => ({ ...milestone })),
  };
  return {
    ...draft,
    videoStartTime: behavior.startTime,
    videoEndTime: behavior.endTime,
    videoSmoothing: behavior.smoothing,
    viewportAnchor: behavior.viewportAnchor,
    milestones: behavior.milestones.map(milestone => ({ ...milestone })),
  };
}

function standardAction(
  name: string,
  from: InteractionAction['from'],
  to: InteractionAction['to'],
  duration: number,
  ease: string,
  textSplit: InteractionAction['textSplit'] = 'none',
  stagger = 0,
) {
  return {
    ...createInteractionAction('animate'),
    name,
    from,
    to,
    duration,
    ease,
    textSplit,
    stagger,
  };
}

function timelineActions(effectId: InteractionLibraryEffectId): InteractionAction[] {
  switch (effectId) {
    case 'fade-in':
      return [standardAction('Fade in', { opacity: 0 }, { opacity: 1 }, 0.65, 'power2.out')];
    case 'fade-up':
      return [standardAction('Fade up', { opacity: 0, y: 32 }, { opacity: 1, y: 0 }, 0.7, 'power3.out')];
    case 'fade-down':
      return [standardAction('Fade down', { opacity: 0, y: -32 }, { opacity: 1, y: 0 }, 0.7, 'power3.out')];
    case 'fade-left':
      return [standardAction('Fade left', { opacity: 0, x: 42 }, { opacity: 1, x: 0 }, 0.72, 'power3.out')];
    case 'fade-right':
      return [standardAction('Fade right', { opacity: 0, x: -42 }, { opacity: 1, x: 0 }, 0.72, 'power3.out')];
    case 'scale-in':
      return [standardAction('Scale in', { opacity: 0, scale: 0.88 }, { opacity: 1, scale: 1 }, 0.65, 'back.out(1.4)')];
    case 'zoom-out':
      return [standardAction('Zoom out', { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1 }, 0.85, 'power3.out')];
    case 'rotate-in':
      return [standardAction('Rotate in', { opacity: 0, rotation: -6, scale: 0.96 }, { opacity: 1, rotation: 0, scale: 1 }, 0.78, 'power3.out')];
    case 'blur-reveal':
      return [standardAction('Blur reveal', { opacity: 0, y: 18, filter: 'blur(12px)' }, { opacity: 1, y: 0, filter: 'blur(0px)' }, 0.8, 'power3.out')];
    case 'mask-reveal':
      return [standardAction('Mask reveal', { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }, 1, 'power3.inOut')];
    case 'clip-up':
      return [standardAction('Clip up', { opacity: 0, y: 24, clipPath: 'inset(100% 0% 0% 0%)' }, { opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)' }, 0.9, 'power3.inOut')];
    case 'text-words':
      return [standardAction('Words reveal', { opacity: 0, yPercent: 115 }, { opacity: 1, yPercent: 0 }, 0.55, 'power3.out', 'words', 0.055)];
    case 'text-chars':
      return [standardAction('Characters reveal', { opacity: 0, yPercent: 110, rotation: 3 }, { opacity: 1, yPercent: 0, rotation: 0 }, 0.48, 'power3.out', 'chars', 0.022)];
    case 'text-lines':
      return [standardAction('Lines reveal', { opacity: 0, yPercent: 110 }, { opacity: 1, yPercent: 0 }, 0.62, 'power3.out', 'lines', 0.09)];
    case 'text-blur-words':
      return [standardAction('Blur words', { opacity: 0, y: 12, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)' }, 0.62, 'power3.out', 'words', 0.06)];
    case 'stagger-children': {
      const action = standardAction('Stagger children', { opacity: 0, y: 24 }, { opacity: 1, y: 0 }, 0.58, 'power3.out', 'none', 0.08);
      return [{
        ...action,
        target: {
          ...DEFAULT_ACTION_TARGET,
          selector: '*',
          label: 'Direct children',
          scope: 'children',
          mode: 'selector',
        },
      }];
    }
    case 'hover-lift':
      return [standardAction('Hover lift', { y: 0, boxShadow: '0 0 0 rgba(0,0,0,0)' }, { y: -8, boxShadow: '0 18px 42px rgba(0,0,0,0.18)' }, 0.32, 'power2.out')];
    case 'hover-scale':
      return [standardAction('Hover scale', { scale: 1 }, { scale: 1.035 }, 0.28, 'power2.out')];
    case 'parallax-y':
      return [standardAction('Parallax Y', { y: -70 }, { y: 70 }, 1, 'none')];
    case 'scroll-scale':
      return [standardAction('Scroll scale', { scale: 0.86 }, { scale: 1.06 }, 1, 'none')];
    case 'scroll-rotate':
      return [standardAction('Scroll rotate', { rotation: -7 }, { rotation: 7 }, 1, 'none')];
    default:
      return [];
  }
}

const HOVER_LIBRARY_EFFECTS = new Set<InteractionLibraryEffectId>([
  'hover-lift',
  'hover-scale',
  'text-roll-whole',
  'text-roll-words',
  'text-roll-chars',
]);

const SCRUB_LIBRARY_EFFECTS = new Set<InteractionLibraryEffectId>([
  'parallax-y',
  'scroll-scale',
  'scroll-rotate',
]);

function triggerForLibraryEffect(effectId: InteractionLibraryEffectId) {
  if (effectId === 'magnetic') return 'mouse-move' as const;
  if (effectId === 'ticker-infinite' || effectId === 'ticker-infinite-reverse') return 'load' as const;
  if (HOVER_LIBRARY_EFFECTS.has(effectId)) return 'hover' as const;
  return 'scroll' as const;
}

function behaviorFromDraft(draft: InteractionLibraryDraft): InteractionBehavior | null {
  const target = { ...DEFAULT_ACTION_TARGET };
  if (draft.effectId === 'count-up') return {
    kind: 'count-up', target,
    from: draft.countFrom, to: draft.countTo,
    duration: draft.countDuration, decimals: draft.countDecimals,
    prefix: draft.countPrefix, suffix: draft.countSuffix,
    locale: draft.countLocale || 'pt-BR', once: true,
  };
  if (draft.effectId === 'magnetic') return {
    kind: 'magnetic', target,
    strength: draft.magneticStrength,
    radius: draft.magneticRadius,
    smoothing: draft.magneticSmoothing,
    returnDuration: draft.magneticReturnDuration,
  };
  if (
    draft.effectId === 'text-roll-whole'
    || draft.effectId === 'text-roll-words'
    || draft.effectId === 'text-roll-chars'
  ) return {
    kind: 'text-roll',
    target,
    split: draft.textRollSplit,
    duration: draft.textRollDuration,
    stagger: draft.textRollStagger,
    distance: draft.textRollDistance,
  };
  if (draft.effectId === 'ticker-infinite' || draft.effectId === 'ticker-infinite-reverse') return {
    kind: 'ticker',
    target,
    direction: draft.tickerDirection,
    speed: draft.tickerSpeed,
    gap: draft.tickerGap,
    hoverBehavior: draft.tickerHoverBehavior,
    hoverSlowdown: draft.tickerHoverSlowdown,
    hoverTransition: draft.tickerHoverTransition,
    draggable: draft.tickerDraggable,
    dragSensitivity: draft.tickerDragSensitivity,
    momentum: draft.tickerMomentum,
  };
  if (draft.effectId === 'image-sequence') return {
    kind: 'image-sequence', target,
    urlTemplate: draft.imageUrlTemplate.replace(/\{index:\d+\}/, '{index}'),
    startIndex: draft.imageStartIndex,
    endIndex: draft.imageEndIndex,
    zeroPad: Math.max(
      draft.imageZeroPad,
      Number(draft.imageUrlTemplate.match(/\{index:(\d+)\}/)?.[1]) || 0,
    ),
    preloadRadius: draft.imagePreloadRadius,
    viewportAnchor: draft.viewportAnchor,
    milestones: draft.milestones.map(milestone => ({ ...milestone })),
  };
  if (draft.effectId === 'video-scrub') return {
    kind: 'video-scrub', target,
    startTime: draft.videoStartTime,
    endTime: draft.videoEndTime,
    smoothing: draft.videoSmoothing,
    viewportAnchor: draft.viewportAnchor,
    milestones: draft.milestones.map(milestone => ({ ...milestone })),
  };
  return null;
}

function validateTarget(draft: InteractionLibraryDraft) {
  const tag = draft.target.tag.toLowerCase();
  if (draft.effectId === 'image-sequence' && tag !== 'img') {
    throw new Error('Selecione diretamente uma layer de imagem para a sequência.');
  }
  if (draft.effectId === 'video-scrub' && tag !== 'video') {
    throw new Error('Selecione diretamente uma layer de vídeo para o scrub.');
  }
  if (draft.effectId === 'count-up') {
    if (draft.target.hasElementChildren) {
      throw new Error('Selecione uma layer de texto numérico sem elementos filhos.');
    }
    if (!/\d/.test(draft.target.text || '')) {
      throw new Error('A layer selecionada precisa conter um valor numérico.');
    }
  }
  if (
    draft.effectId === 'text-roll-whole'
    || draft.effectId === 'text-roll-words'
    || draft.effectId === 'text-roll-chars'
  ) {
    if (draft.target.hasElementChildren || !(draft.target.text || '').trim()) {
      throw new Error('Selecione uma layer simples de texto, sem elementos filhos.');
    }
  }
  if (
    (draft.effectId === 'ticker-infinite' || draft.effectId === 'ticker-infinite-reverse')
    && !draft.target.hasElementChildren
  ) {
    throw new Error('Selecione um container com elementos filhos para criar o ticker contínuo.');
  }
  if (
    (
      draft.effectId === 'text-words'
      || draft.effectId === 'text-chars'
      || draft.effectId === 'text-lines'
      || draft.effectId === 'text-blur-words'
    )
    && draft.target.hasElementChildren
  ) {
    throw new Error('Selecione uma layer de texto simples, sem elementos filhos.');
  }
  if (draft.effectId === 'stagger-children' && !draft.target.hasElementChildren) {
    throw new Error('Selecione um grupo que possua elementos filhos para aplicar o stagger.');
  }
}

function validateImageSequenceDraft(draft: InteractionLibraryDraft) {
  const tokens = draft.imageUrlTemplate.match(/\{index(?::\d+)?\}/g) || [];
  if (tokens.length !== 1) {
    throw new Error('A URL da sequência precisa conter exatamente um {index}.');
  }
  const inlinePadding = Number(draft.imageUrlTemplate.match(/\{index:(\d+)\}/)?.[1]) || 0;
  if (inlinePadding > 12) {
    throw new Error('O zero padding inline precisa ficar entre 0 e 12.');
  }
  const normalized = draft.imageUrlTemplate.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(normalized);
  const isHttps = /^https:\/\//i.test(normalized);
  if (
    !normalized
    || /\s/.test(normalized)
    || normalized.startsWith('/')
    || normalized.startsWith('\\')
    || (hasScheme && !isHttps)
  ) {
    throw new Error('Use uma URL https:// ou um caminho relativo do projeto para os frames.');
  }
  if (isHttps) {
    try {
      const url = new URL(normalized);
      if (!url.hostname || url.username || url.password) throw new Error('invalid');
    } catch {
      throw new Error('A URL https:// informada para os frames não é válida.');
    }
  }
  if (
    !Number.isInteger(draft.imageStartIndex)
    || !Number.isInteger(draft.imageEndIndex)
    || draft.imageStartIndex < 0
    || draft.imageEndIndex < draft.imageStartIndex
  ) {
    throw new Error('O último frame precisa ser maior ou igual ao primeiro.');
  }
  if (!Number.isInteger(draft.imageZeroPad) || draft.imageZeroPad < 0 || draft.imageZeroPad > 12) {
    throw new Error('Zero padding precisa ser um inteiro entre 0 e 12.');
  }
  if (!Number.isInteger(draft.imagePreloadRadius) || draft.imagePreloadRadius < 0 || draft.imagePreloadRadius > 24) {
    throw new Error('Preload precisa ser um inteiro entre 0 e 24 frames.');
  }
}

function validateScrollMilestones(source: string, draft: InteractionLibraryDraft) {
  if (draft.milestones.length < 2) {
    throw new Error('Adicione pelo menos duas Scroll Sections à sequência.');
  }
  const anchors = new Set<string>();
  draft.milestones.forEach((milestone, index) => {
    const selector = milestone.selector.trim();
    const values = [
      milestone.value,
      milestone.elementAnchor,
      milestone.viewportAnchor,
      milestone.offsetPx,
    ];
    if (!selector || values.some(value => !Number.isFinite(value))) {
      throw new Error(`O checkpoint ${index + 1} possui valores inválidos.`);
    }
    if (!interactionSelectorExistsInSource(source, selector)) {
      throw new Error(`A Scroll Section do checkpoint ${index + 1} não existe mais na página.`);
    }
    if (
      milestone.elementAnchor < 0
      || milestone.elementAnchor > 1
      || milestone.viewportAnchor < 0
      || milestone.viewportAnchor > 1
    ) {
      throw new Error(`Os anchors do checkpoint ${index + 1} precisam ficar entre 0% e 100%.`);
    }
    const anchorKey = [
      selector,
      milestone.elementAnchor,
      milestone.viewportAnchor,
      milestone.offsetPx,
    ].join('\u0000');
    if (anchors.has(anchorKey)) {
      throw new Error('Dois checkpoints não podem ocupar exatamente o mesmo anchor.');
    }
    anchors.add(anchorKey);
    if (draft.effectId === 'image-sequence' && (
      !Number.isInteger(milestone.value)
      || milestone.value < draft.imageStartIndex
      || milestone.value > draft.imageEndIndex
    )) {
      throw new Error(`O frame do checkpoint ${index + 1} precisa estar dentro do intervalo configurado.`);
    }
    if (draft.effectId === 'video-scrub' && (
      milestone.value < draft.videoStartTime
      || milestone.value > draft.videoEndTime
    )) {
      throw new Error(`O tempo do checkpoint ${index + 1} precisa estar dentro do intervalo configurado.`);
    }
  });
}

function validateLibraryDraft(
  source: string,
  draft: InteractionLibraryDraft,
  item: InteractionLibraryCatalogItem,
  validatePickedTarget: boolean,
) {
  if (validatePickedTarget) validateTarget(draft);
  if (draft.effectId === 'image-sequence') validateImageSequenceDraft(draft);
  if (draft.effectId === 'ticker-infinite' || draft.effectId === 'ticker-infinite-reverse') {
    const tickerValues = [
      draft.tickerSpeed,
      draft.tickerGap,
      draft.tickerHoverSlowdown,
      draft.tickerHoverTransition,
      draft.tickerDragSensitivity,
      draft.tickerMomentum,
    ];
    if (
      tickerValues.some(value => !Number.isFinite(value))
      || draft.tickerSpeed < 4
      || draft.tickerGap < 0
      || draft.tickerHoverSlowdown < 0.02
      || draft.tickerHoverSlowdown > 1
      || draft.tickerHoverTransition < 0.01
      || draft.tickerDragSensitivity < 0.1
      || draft.tickerMomentum < 0
      || draft.tickerMomentum > 0.98
    ) {
      throw new Error('Revise velocidade, espaçamento, hover e arraste do ticker.');
    }
  }
  if (draft.effectId === 'video-scrub' && (
    !Number.isFinite(draft.videoStartTime)
    || !Number.isFinite(draft.videoEndTime)
    || draft.videoStartTime < 0
    || draft.videoEndTime < draft.videoStartTime
  )) {
    throw new Error('O tempo final do vídeo precisa ser maior ou igual ao tempo inicial.');
  }
  if (draft.effectId === 'image-sequence' || draft.effectId === 'video-scrub') {
    validateScrollMilestones(source, draft);
  }
  if (item.engine === 'behavior' && !behaviorFromDraft(draft)) {
    throw new Error('As configurações desse efeito não são válidas.');
  }
  if (item.engine === 'timeline' && !timelineActions(draft.effectId).length) {
    throw new Error('A timeline desse efeito não está disponível.');
  }
}

export function addInteractionFromLibrary(
  source: string,
  draft: InteractionLibraryDraft,
) {
  const catalogItem = INTERACTION_LIBRARY_CATALOG.find(item => item.id === draft.effectId);
  if (!catalogItem) throw new Error('Efeito da Library não encontrado.');
  validateLibraryDraft(source, draft, catalogItem, true);
  const trigger = triggerForLibraryEffect(draft.effectId);
  const scrub = SCRUB_LIBRARY_EFFECTS.has(draft.effectId);
  const created = addInteraction(
    source,
    draft.target.path,
    draft.target,
    trigger,
    'element',
  );
  const actions = timelineActions(draft.effectId);
  const behavior = behaviorFromDraft(draft);
  const nextSource = updateInteraction(created.source, created.interaction.id, interaction => ({
    ...interaction,
    name: catalogItem.name,
    trigger,
    actions,
    libraryEffectId: draft.effectId,
    behavior,
    enabled: draft.enabled,
    scrollStart: scrub ? 'top bottom' : 'top 82%',
    scrollEnd: scrub ? 'bottom top' : 'bottom 18%',
    scrollScrub: scrub,
    scrollSmoothing: scrub ? 0.12 : 0,
    reducedMotion: behavior?.kind === 'magnetic' || behavior?.kind === 'text-roll' || behavior?.kind === 'ticker' ? 'skip' : 'end',
  }));
  const interaction = readInteractionDocument(nextSource).interactions.find(
    candidate => candidate.id === created.interaction.id,
  ) as InteractionDefinition;
  return { source: nextSource, interaction };
}

export function updateInteractionFromLibrary(
  source: string,
  interactionId: string,
  draft: InteractionLibraryDraft,
) {
  const catalogItem = INTERACTION_LIBRARY_CATALOG.find(item => item.id === draft.effectId);
  if (!catalogItem) throw new Error('Efeito da Library não encontrado.');
  validateLibraryDraft(source, draft, catalogItem, draft.targetChanged);
  const currentInteraction = readInteractionDocument(source).interactions.find(
    candidate => candidate.id === interactionId,
  );
  if (!currentInteraction) throw new Error('A interação não pôde ser atualizada.');
  const resolved = draft.targetChanged
    ? ensureInteractionSelector(source, draft.target.path, draft.target, 'element')
    : {
      source,
      selector: currentInteraction.triggerSelector,
      label: currentInteraction.triggerLabel,
      mode: currentInteraction.triggerTargetMode,
    };
  const behavior = behaviorFromDraft(draft);
  const actions = timelineActions(draft.effectId);
  const trigger = triggerForLibraryEffect(draft.effectId);
  const scrub = SCRUB_LIBRARY_EFFECTS.has(draft.effectId);
  const nextSource = updateInteraction(resolved.source, interactionId, interaction => ({
    ...interaction,
    name: catalogItem.name,
    trigger,
    triggerSelector: resolved.selector,
    triggerLabel: resolved.label,
    triggerTargetMode: resolved.mode,
    actions,
    libraryEffectId: draft.effectId,
    behavior,
    enabled: draft.enabled,
    scrollStart: scrub ? 'top bottom' : 'top 82%',
    scrollEnd: scrub ? 'bottom top' : 'bottom 18%',
    scrollScrub: scrub,
    scrollSmoothing: scrub ? 0.12 : 0,
    reducedMotion: behavior?.kind === 'magnetic' || behavior?.kind === 'text-roll' || behavior?.kind === 'ticker' ? 'skip' : 'end',
  }));
  const interaction = readInteractionDocument(nextSource).interactions.find(
    candidate => candidate.id === interactionId,
  );
  if (!interaction) throw new Error('A interação não pôde ser atualizada.');
  return { source: nextSource, interaction };
}
