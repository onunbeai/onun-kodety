import { DEFAULT_BREAKPOINTS, type Breakpoint } from './css-patcher';
import {
  DEFAULT_INTERACTION,
  createInteractionAction,
  patchInteractionDocument,
  readInteractionDocument,
  type InteractionAction,
  type InteractionActionTarget,
  type InteractionDefinition,
  type InteractionKeyframe,
} from './interactions';
import { readEditorMetadata, updateEditorMetadata, updateTextFile } from './project-io';
import { isFramerProject } from './framer-project-detection';
import { ensureFramerVisualCleanup } from './framer-visual-cleanup';
import { inspectSourceElements, patchElementAttribute } from './source-patcher';
import type { HtmlProject } from './types';
export { isFramerProject, isHydratedFramerProject } from './framer-project-detection';

interface FramerRuntimeFrame {
  offset?: number;
  [property: string]: string | number | boolean | undefined;
}

interface FramerRuntimeAnimation {
  trigger: 'load' | 'hover' | 'active' | 'focus' | string;
  targetClass: string;
  elementLabel?: string;
  frames: FramerRuntimeFrame[];
  timing: {
    delay?: number;
    duration?: number;
    easing?: string;
    iterations?: number;
  };
}

interface FramerImportManifest {
  version: 1;
  nativeInteractionsVersion?: 1;
  nativeInteractionPages?: string[];
  source?: string;
  runtime?: boolean;
  breakpoints?: Array<Breakpoint & { query?: string }>;
  animations?: FramerRuntimeAnimation[];
  embedded?: {
    breakpoints?: unknown[];
    appear?: Record<string, unknown>;
    handoverRaw?: string;
    responsiveRoots?: Array<{
      selector: string;
      variants: Array<{ hash: string; query: string }>;
    }>;
    captureWidths?: number[];
    runtimeEntrypoints?: string[];
    runtimeModuleUrls?: string[];
    localizedRuntimeEntrypoint?: string;
    localizedRuntimeFiles?: string[];
  };
}

const CONTROL_KEYS = new Set(['offset', 'computedOffset', 'easing', 'composite']);

function readManifest(project: HtmlProject): FramerImportManifest | null {
  try {
    const source = project.files['.incode/framer-import.json']?.text;
    if (!source) return null;
    const parsed = JSON.parse(source) as FramerImportManifest;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function safeClassName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : '';
}

function frameValues(frame: FramerRuntimeFrame) {
  const values: Record<string, string | number | boolean> = {};
  Object.entries(frame).forEach(([key, value]) => {
    if (CONTROL_KEYS.has(key) || key.startsWith('--')) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = value;
  });
  return values;
}

function gsapEase(value = '') {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'linear' || normalized.startsWith('linear(')) return 'none';
  if (normalized === 'ease-in') return 'power1.in';
  if (normalized === 'ease-out') return 'power1.out';
  if (normalized === 'ease-in-out' || normalized === 'ease') return 'power1.inOut';
  if (normalized === 'spring') return 'back.out(1.2)';
  // GSAP does not consume WAAPI's arbitrary cubic-bezier()/linear() strings
  // without CustomEase. A neutral fallback preserves timing and keyframes.
  return 'power1.out';
}

function interactionTargetSelector(value: string) {
  return `[data-kodety-interaction-id="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function shortIdentityHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(5, '0').slice(-5);
}

function stableInteractionId(targetClass: string, used: Set<string>) {
  let attempt = 0;
  let candidate = '';
  do {
    candidate = `element-framer-${shortIdentityHash(`${targetClass}:${attempt++}`)}`;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

/**
 * Captured motion classes are implementation details and may be regenerated.
 * When one class identifies exactly one authored layer, promote it to the
 * Builder's durable element identity so the fallback animation stays editable.
 */
function stabilizeAnimationTargets(project: HtmlProject, animations: FramerRuntimeAnimation[]) {
  const page = project.files[project.mainHtmlPath]?.text;
  const targets = new Map<string, InteractionActionTarget>();
  if (!page) return { project, targets };

  const elements = inspectSourceElements(page);
  const idCounts = new Map<string, number>();
  elements.forEach(element => {
    const id = element.attributes['data-kodety-interaction-id'];
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  });
  const usedIds = new Set(idCounts.keys());
  let source = page;
  const targetClasses = Array.from(new Set(
    animations
      .filter(animation => animation.trigger === 'load')
      .map(animation => safeClassName(animation.targetClass || ''))
      .filter(Boolean),
  ));

  targetClasses.forEach(targetClass => {
    const matches = elements.filter(element => (
      element.attributes.class || ''
    ).split(/\s+/).includes(targetClass));
    if (matches.length !== 1) return;
    const element = matches[0];
    const authoredId = element.attributes['data-kodety-interaction-id'] || '';
    const canReuseAuthoredId = /^[A-Za-z0-9_-]{1,120}$/.test(authoredId)
      && idCounts.get(authoredId) === 1;
    const id = canReuseAuthoredId ? authoredId : stableInteractionId(targetClass, usedIds);
    try {
      if (id !== authoredId) source = patchElementAttribute(source, element.path, 'data-kodety-interaction-id', id);
      targets.set(targetClass, {
        selector: interactionTargetSelector(id),
        label: element.attributes['data-label'] || element.attributes['data-framer-name'] || targetClass,
        scope: 'document',
        mode: 'element',
      });
    } catch {
      // A malformed/changed path is safer as the original class target.
    }
  });

  return {
    project: source === page ? project : updateTextFile(project, project.mainHtmlPath, source),
    targets,
  };
}

function animationClip(
  animation: FramerRuntimeAnimation,
  index: number,
  stableTarget?: InteractionActionTarget,
): InteractionAction | null {
  const targetClass = safeClassName(animation.targetClass || '');
  const durationMs = Number(animation.timing?.duration) || 0;
  const delayMs = Math.max(0, Number(animation.timing?.delay) || 0);
  const iterations = Number(animation.timing?.iterations) || 1;
  if (!targetClass || animation.trigger !== 'load' || animation.frames?.length < 2) return null;
  if (iterations !== 1 || durationMs < 10 || durationMs > 20_000) return null;

  const frames = animation.frames
    .map((frame, frameIndex) => ({
      offset: typeof frame.offset === 'number' ? Math.max(0, Math.min(1, frame.offset)) : frameIndex / Math.max(1, animation.frames.length - 1),
      values: frameValues(frame),
    }))
    .filter(frame => Object.keys(frame.values).length > 0)
    .sort((a, b) => a.offset - b.offset);
  if (frames.length < 2) return null;

  const duration = durationMs / 1000;
  const keyframes: InteractionKeyframe[] = frames.map((frame, frameIndex) => ({
    id: `framer-${index}-keyframe-${frameIndex}`,
    time: frame.offset * duration,
    values: frame.values,
  }));
  return {
    ...createInteractionAction('animate'),
    id: `framer-load-${index}`,
    name: animation.elementLabel || `Framer animation ${index + 1}`,
    target: stableTarget || { selector: `.${targetClass}`, label: animation.elementLabel || targetClass, scope: 'document', mode: 'class' },
    start: delayMs / 1000,
    duration,
    ease: gsapEase(animation.timing?.easing),
    from: frames[0].values,
    to: frames.at(-1)!.values,
    keyframes,
  };
}

function validBreakpoints(items: FramerImportManifest['breakpoints']): Breakpoint[] {
  const seen = new Set<string>();
  return (items || []).flatMap(item => {
    const width = Math.round(Number(item.width));
    const mode = item.mode === 'min-width' ? 'min-width' : item.mode === 'max-width' ? 'max-width' : null;
    if (!mode || !Number.isFinite(width) || width < 1 || width > 10_000) return [];
    const key = `${mode}:${width}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: /^[-a-z0-9_]+$/i.test(item.id || '') ? item.id : `framer-${mode === 'max-width' ? 'max' : 'min'}-${width}`,
      label: String(item.label || `Framer ${width}px`).slice(0, 80),
      mode,
      width,
    }];
  });
}

/** Convert inert data left by the sandboxed Framer capture into native Builder data. */
export function applyFramerImportManifest(project: HtmlProject, options: { initializeGeneratedBreakpoints?: boolean; skipVisualCleanup?: boolean } = {}): HtmlProject {
  if (!isFramerProject(project)) return project;
  const manifest = readManifest(project);
  let next = project;
  if (!options.skipVisualCleanup) Object.values(project.files).forEach(file => {
    if (/\.html?$/i.test(file.path) && typeof file.text === 'string') {
      next = updateTextFile(next, file.path, ensureFramerVisualCleanup(file.text));
    }
  });
  if (!manifest) return next;
  const breakpoints = validBreakpoints(manifest.breakpoints);
  if (breakpoints.length) {
    const existing = readEditorMetadata(next).breakpoints || [];
    const generatedDefaults = options.initializeGeneratedBreakpoints
      && JSON.stringify(existing) === JSON.stringify(DEFAULT_BREAKPOINTS);
    if (!existing.length || generatedDefaults) next = updateEditorMetadata(next, metadata => ({ ...metadata, breakpoints }));
  }
  // Recorder v2 ships an executable, editable runtime with the imported ZIP.
  // Keep animations/components as code instead of duplicating only part of the
  // behavior natively. Breakpoint controls remain native and editable above.
  if (manifest.runtime) return next;
  if (manifest.nativeInteractionsVersion === 1
    && (!Array.isArray(manifest.nativeInteractionPages) || manifest.nativeInteractionPages.includes(project.mainHtmlPath))) return next;

  // Once captured motion has become native, subsequent ZIP imports/reopens
  // must keep the author's edited keyframes, target IDs and timing intact.
  const existingPage = next.files[next.mainHtmlPath]?.text;
  const markNativeConversion = (value: HtmlProject) => updateTextFile(value, '.incode/framer-import.json', JSON.stringify({
    ...manifest, nativeInteractionsVersion: 1,
    nativeInteractionPages: [...new Set([...(manifest.nativeInteractionPages || []), project.mainHtmlPath])],
  }, null, 2));
  if (existingPage && readInteractionDocument(existingPage).interactions.some(interaction => interaction.id === 'framer-load')) return markNativeConversion(next);

  const animations = (manifest.animations || []).slice(0, 350);
  const stabilized = stabilizeAnimationTargets(next, animations);
  next = stabilized.project;
  const clips = animations
    .map((animation, index) => animationClip(animation, index, stabilized.targets.get(animation.targetClass)))
    .filter((clip): clip is InteractionAction => Boolean(clip));
  if (!clips.length) return markNativeConversion(next);

  const definition: InteractionDefinition = {
    ...DEFAULT_INTERACTION,
    id: 'framer-load',
    name: 'Framer · Load',
    trigger: 'load',
    triggerSelector: 'body',
    triggerLabel: 'Body',
    triggerTargetMode: 'selector',
    actions: clips,
  };
  const page = next.files[next.mainHtmlPath]?.text;
  if (!page) return next;
  const interactions = readInteractionDocument(page).interactions.filter(interaction => interaction.id !== definition.id);
  return markNativeConversion(updateTextFile(next, next.mainHtmlPath, patchInteractionDocument(page, { version: 2, interactions: [...interactions, definition] })));
}
