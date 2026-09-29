import type { HtmlProject } from './types';

export const PAGE_TRANSITIONS_DOCUMENT_PATH = '.incode/page-transitions.json';

export type PageTransitionEffect =
  | 'fade'
  | 'crossfade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'scale'
  | 'blur-zoom'
  | 'circle-reveal'
  | 'curtain'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down';

export type PageTransitionEasing =
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'cubic-bezier(0.22, 1, 0.36, 1)'
  | 'cubic-bezier(0.65, 0, 0.35, 1)';

export interface PageTransitionMotion {
  effect: PageTransitionEffect;
  duration: number;
  easing: PageTransitionEasing;
}

export interface UniversalPageTransition extends PageTransitionMotion {
  enabled: boolean;
  preload: boolean;
}

export interface PageTransitionRule extends PageTransitionMotion {
  id: string;
  enabled: boolean;
  from: string;
  to: string;
}

export interface PageTransitionDocument {
  version: 1;
  universal: UniversalPageTransition;
  rules: PageTransitionRule[];
}

export const PAGE_TRANSITION_EFFECTS: ReadonlyArray<{
  value: PageTransitionEffect;
  label: string;
  description: string;
}> = [
  { value: 'fade', label: 'Fade', description: 'Dissolve smoothly between pages' },
  { value: 'crossfade', label: 'Crossfade', description: 'Blend the outgoing and incoming pages together' },
  { value: 'slide-left', label: 'Slide left', description: 'Move content toward the left' },
  { value: 'slide-right', label: 'Slide right', description: 'Move content toward the right' },
  { value: 'slide-up', label: 'Slide up', description: 'Move content upward' },
  { value: 'slide-down', label: 'Slide down', description: 'Move content downward' },
  { value: 'scale', label: 'Scale', description: 'Combine a subtle zoom with opacity' },
  { value: 'blur-zoom', label: 'Blur zoom', description: 'Bring the next page into focus with a soft zoom' },
  { value: 'circle-reveal', label: 'Circle reveal', description: 'Open the next page from the center outward' },
  { value: 'curtain', label: 'Curtain', description: 'Reveal the next page from two vertical edges' },
  { value: 'wipe-left', label: 'Wipe left', description: 'Reveal the page with a horizontal wipe' },
  { value: 'wipe-right', label: 'Wipe right', description: 'Reveal the page from the opposite horizontal edge' },
  { value: 'wipe-up', label: 'Wipe up', description: 'Reveal the page with a vertical wipe' },
  { value: 'wipe-down', label: 'Wipe down', description: 'Reveal the page from the opposite vertical edge' },
];

export const PAGE_TRANSITION_EASINGS: ReadonlyArray<{
  value: PageTransitionEasing;
  label: string;
}> = [
  { value: 'ease', label: 'Ease' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in out' },
  { value: 'cubic-bezier(0.22, 1, 0.36, 1)', label: 'Smooth out' },
  { value: 'cubic-bezier(0.65, 0, 0.35, 1)', label: 'Smooth in out' },
];

export const DEFAULT_PAGE_TRANSITION_MOTION: PageTransitionMotion = {
  effect: 'fade',
  duration: 0.42,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

export const DEFAULT_PAGE_TRANSITION_DOCUMENT: PageTransitionDocument = {
  version: 1,
  universal: {
    ...DEFAULT_PAGE_TRANSITION_MOTION,
    enabled: false,
    preload: true,
  },
  rules: [],
};

const EFFECTS = new Set<PageTransitionEffect>(PAGE_TRANSITION_EFFECTS.map(item => item.value));
const EASINGS = new Set<PageTransitionEasing>(PAGE_TRANSITION_EASINGS.map(item => item.value));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizePagePath(value: unknown) {
  return typeof value === 'string'
    ? value.trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')
    : '';
}

function normalizeDuration(value: unknown, fallback = DEFAULT_PAGE_TRANSITION_MOTION.duration) {
  const duration = Number(value);
  return Number.isFinite(duration)
    ? Math.round(Math.max(0.1, Math.min(3, duration)) * 100) / 100
    : fallback;
}

function normalizeMotion(value: unknown): PageTransitionMotion {
  const candidate = record(value);
  const effect = typeof candidate.effect === 'string' && EFFECTS.has(candidate.effect as PageTransitionEffect)
    ? candidate.effect as PageTransitionEffect
    : DEFAULT_PAGE_TRANSITION_MOTION.effect;
  const easing = typeof candidate.easing === 'string' && EASINGS.has(candidate.easing as PageTransitionEasing)
    ? candidate.easing as PageTransitionEasing
    : DEFAULT_PAGE_TRANSITION_MOTION.easing;
  return {
    effect,
    duration: normalizeDuration(candidate.duration),
    easing,
  };
}

function createRuleId(index = 0) {
  return globalThis.crypto?.randomUUID?.()
    || `page-transition-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizePageTransitionDocument(value: unknown): PageTransitionDocument {
  const candidate = record(value);
  const universal = record(candidate.universal);
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const rules = (Array.isArray(candidate.rules) ? candidate.rules : [])
    .slice(0, 500)
    .flatMap((rawRule, index): PageTransitionRule[] => {
      const rule = record(rawRule);
      const from = normalizePagePath(rule.from);
      const to = normalizePagePath(rule.to);
      if (!from || !to || from === to) return [];
      const pair = `${from}\u0000${to}`;
      if (pairs.has(pair)) return [];
      pairs.add(pair);
      let id = typeof rule.id === 'string' ? rule.id.trim() : '';
      if (!id || ids.has(id)) id = createRuleId(index);
      ids.add(id);
      return [{
        id,
        enabled: rule.enabled !== false,
        from,
        to,
        ...normalizeMotion(rule),
      }];
    });
  return {
    version: 1,
    universal: {
      enabled: universal.enabled === true,
      preload: universal.preload !== false,
      ...normalizeMotion(universal),
    },
    rules,
  };
}

export function parsePageTransitionDocument(text: string | undefined | null) {
  if (!text?.trim()) return DEFAULT_PAGE_TRANSITION_DOCUMENT;
  try {
    return normalizePageTransitionDocument(JSON.parse(text));
  } catch {
    return DEFAULT_PAGE_TRANSITION_DOCUMENT;
  }
}

export function serializePageTransitionDocument(document: PageTransitionDocument) {
  return `${JSON.stringify(normalizePageTransitionDocument(document), null, 2)}\n`;
}

export function readPageTransitionDocument(project: HtmlProject) {
  return parsePageTransitionDocument(project.files[PAGE_TRANSITIONS_DOCUMENT_PATH]?.text);
}

export function writePageTransitionDocument(
  project: HtmlProject,
  document: PageTransitionDocument,
): HtmlProject {
  const text = serializePageTransitionDocument(document);
  const current = project.files[PAGE_TRANSITIONS_DOCUMENT_PATH];
  if (current?.text === text) return project;
  return {
    ...project,
    files: {
      ...project.files,
      [PAGE_TRANSITIONS_DOCUMENT_PATH]: {
        path: PAGE_TRANSITIONS_DOCUMENT_PATH,
        mimeType: 'application/json',
        text,
      },
    },
  };
}

export function remapPageTransitionPage(
  project: HtmlProject,
  currentPath: string,
  nextPath: string,
): HtmlProject {
  if (!project.files[PAGE_TRANSITIONS_DOCUMENT_PATH] || currentPath === nextPath) return project;
  const document = readPageTransitionDocument(project);
  if (!document.rules.some(rule => rule.from === currentPath || rule.to === currentPath)) return project;
  return writePageTransitionDocument(project, {
    ...document,
    rules: document.rules.map(rule => ({
      ...rule,
      from: rule.from === currentPath ? nextPath : rule.from,
      to: rule.to === currentPath ? nextPath : rule.to,
    })),
  });
}

export function removePageTransitionPage(
  project: HtmlProject,
  pagePath: string,
): HtmlProject {
  if (!project.files[PAGE_TRANSITIONS_DOCUMENT_PATH]) return project;
  const document = readPageTransitionDocument(project);
  const rules = document.rules.filter(rule => rule.from !== pagePath && rule.to !== pagePath);
  if (rules.length === document.rules.length) return project;
  return writePageTransitionDocument(project, { ...document, rules });
}

export function pageTransitionMotionForNavigation(
  document: PageTransitionDocument,
  fromPage: string,
  toPage: string,
): PageTransitionMotion | null {
  const from = normalizePagePath(fromPage);
  const to = normalizePagePath(toPage);
  if (!from || !to || from === to) return null;
  const exact = document.rules.find(rule => (
    rule.enabled
    && normalizePagePath(rule.from) === from
    && normalizePagePath(rule.to) === to
  ));
  if (exact) return { effect: exact.effect, duration: exact.duration, easing: exact.easing };
  const reverse = document.rules.find(rule => (
    rule.enabled
    && normalizePagePath(rule.from) === to
    && normalizePagePath(rule.to) === from
  ));
  if (reverse) return reversePageTransitionMotion(reverse);
  return document.universal.enabled
    ? {
        effect: document.universal.effect,
        duration: document.universal.duration,
        easing: document.universal.easing,
      }
    : null;
}

export function reversePageTransitionEffect(effect: PageTransitionEffect): PageTransitionEffect {
  switch (effect) {
    case 'slide-left': return 'slide-right';
    case 'slide-right': return 'slide-left';
    case 'slide-up': return 'slide-down';
    case 'slide-down': return 'slide-up';
    case 'wipe-left': return 'wipe-right';
    case 'wipe-right': return 'wipe-left';
    case 'wipe-up': return 'wipe-down';
    case 'wipe-down': return 'wipe-up';
    default: return effect;
  }
}

export function reversePageTransitionMotion(motion: PageTransitionMotion): PageTransitionMotion {
  return { ...motion, effect: reversePageTransitionEffect(motion.effect) };
}

export function createPageTransitionRule(
  from: string,
  to: string,
  motion: PageTransitionMotion = DEFAULT_PAGE_TRANSITION_MOTION,
): PageTransitionRule {
  return normalizePageTransitionDocument({
    rules: [{ id: createRuleId(), enabled: true, from, to, ...motion }],
  }).rules[0];
}

/** Shared Motion keyframes for exported pages and the buffered editor preview. */
export function pageTransitionKeyframes(effect: string): {
  outgoing: Record<string, [string | number, string | number]>;
  incoming: Record<string, [string | number, string | number]>;
} {
  const fade = { outgoing: { opacity: [1, 0] as [number, number] }, incoming: { opacity: [0, 1] as [number, number] } };
  switch (effect) {
    case 'slide-left': return { outgoing: { opacity: [1, 0], transform: ['none', 'translateX(-5%)'] }, incoming: { opacity: [0, 1], transform: ['translateX(5%)', 'none'] } };
    case 'slide-right': return { outgoing: { opacity: [1, 0], transform: ['none', 'translateX(5%)'] }, incoming: { opacity: [0, 1], transform: ['translateX(-5%)', 'none'] } };
    case 'slide-up': return { outgoing: { opacity: [1, 0], transform: ['none', 'translateY(-5%)'] }, incoming: { opacity: [0, 1], transform: ['translateY(5%)', 'none'] } };
    case 'slide-down': return { outgoing: { opacity: [1, 0], transform: ['none', 'translateY(5%)'] }, incoming: { opacity: [0, 1], transform: ['translateY(-5%)', 'none'] } };
    case 'scale': return { outgoing: { opacity: [1, 0], transform: ['scale(1)', 'scale(.965)'] }, incoming: { opacity: [0, 1], transform: ['scale(1.035)', 'scale(1)'] } };
    case 'blur-zoom': return { outgoing: { opacity: [1, 0], filter: ['blur(0px)', 'blur(10px)'], transform: ['scale(1)', 'scale(1.04)'] }, incoming: { opacity: [0, 1], filter: ['blur(10px)', 'blur(0px)'], transform: ['scale(.96)', 'scale(1)'] } };
    case 'circle-reveal': return { outgoing: { opacity: [1, 1] }, incoming: { clipPath: ['circle(0% at 50% 50%)', 'circle(150% at 50% 50%)'] } };
    case 'curtain': return { outgoing: { opacity: [1, 1] }, incoming: { clipPath: ['inset(0% 50% 0% 50%)', 'inset(0% 0% 0% 0%)'] } };
    case 'wipe-left': return { outgoing: { opacity: [1, 1] }, incoming: { clipPath: ['inset(0% 0% 0% 100%)', 'inset(0% 0% 0% 0%)'] } };
    case 'wipe-right': return { outgoing: { opacity: [1, 1] }, incoming: { clipPath: ['inset(0% 100% 0% 0%)', 'inset(0% 0% 0% 0%)'] } };
    case 'wipe-up': return { outgoing: { opacity: [1, 1] }, incoming: { clipPath: ['inset(100% 0% 0% 0%)', 'inset(0% 0% 0% 0%)'] } };
    case 'wipe-down': return { outgoing: { opacity: [1, 1] }, incoming: { clipPath: ['inset(0% 0% 100% 0%)', 'inset(0% 0% 0% 0%)'] } };
    default: return fade;
  }
}

export function pageTransitionMotionEase(value: string): [number, number, number, number] {
  const bezier = value.match(/^cubic-bezier\(([^)]+)\)$/);
  if (bezier) {
    const values = bezier[1].split(',').map(Number);
    if (values.length === 4 && values.every(Number.isFinite)) return values as [number, number, number, number];
  }
  switch (value) {
    case 'ease-in': return [.42, 0, 1, 1];
    case 'ease-out': return [0, 0, .58, 1];
    case 'ease-in-out': return [.42, 0, .58, 1];
    default: return [.25, .1, .25, 1];
  }
}
