import { inlinePreviewCssImports, rewritePreviewSrcset } from './preview-content';
import { parseSrcsetCandidates, rewriteCssAssetUrls } from './asset-reference-syntax';
import { captureFramerHydratedSnapshot, waitForFramerHydration } from './framer-snapshot';
import { isFramerProject } from './framer-project-detection';
import { FRAMER_VISUAL_CLEANUP_CSS } from './framer-visual-cleanup';
import type { EditorElement, HtmlProject, HtmlProjectFile } from './types';
import type { Font } from '@/types';
import { CANVAS_FONTS_RUNTIME } from './canvas-fonts';
import {
  CODE_COMPONENT_REACT_RUNTIME_SOURCE,
  codeComponentReactImportMap,
} from '@coday/component-runtime/vendor';
import {
  buildFontClassesCss,
  fontsReferencedBySources,
  getFontStylesheetResources,
} from '../font-utils';
import { applyCustomCodeToHtml } from './custom-code';
import { prepareCookieConsentProjectForTransport } from './cookie-consent';
import { projectGoogleFonts, readEditorMetadata } from './project-io';
import {
  patchInteractionDocument,
  readInteractionDocumentFile,
} from './interactions';
import {
  isBareModuleSpecifier,
  moduleCdnUrl,
  projectDependencyVersions,
  projectPublicDirectoryNames,
  projectPublicFilePath,
  replaceViteImportMetaEnv,
} from './coded-project';
import {
  discoverProjectFonts,
  type ProjectFontFace,
} from './project-fonts';
import {
  injectHtmlComponentRuntimeRegistry,
  normalizeHtmlComponentLibrary,
  refreshHtmlComponentInstancesInSource,
  runtimeHtmlComponentLibrary,
} from './html-components';
import { attachHtmlComponentStylesheets } from './component-bundle';
import { compileHtmlComponentInstanceInteractions } from './component-interaction-runtime';
import { resolveProjectPath } from './project-path';
import { BUILDER_HIDDEN_ATTRIBUTE } from './builder-visibility';
import { CSS_SHORTHAND_LONGHANDS } from './style-utils';
export { resolveProjectPath } from './project-path';

/**
 * A Primary/base rule participates in every rendered viewport; an authored
 * child rule is confined to the frame for that exact breakpoint.
 */
export function canvasPseudoStatePreviewTargetsBreakpoint(
  authoringBreakpoint: string | null | undefined,
  frameBreakpoint: string | null | undefined,
) {
  const authored = authoringBreakpoint || 'base';
  return authored === 'base' || authored === (frameBreakpoint || 'base');
}

/**
 * Adds CDN fallbacks without replacing runtime-owned module aliases.
 *
 * Code Component bundles legitimately import React and `@coday/components`.
 * Their aliases point at the single runtime embedded in the canvas. Replacing
 * those entries with esm.sh URLs creates a second React runtime and, for the
 * private SDK package, a guaranteed 404. Publication never took that path,
 * which is why the same component could render after publish but not here.
 */
export function addPreviewBareModuleImports(
  imports: Record<string, string>,
  specifiers: Iterable<string>,
  versions: Record<string, string>,
) {
  for (const specifier of specifiers) {
    if (Object.prototype.hasOwnProperty.call(imports, specifier)) continue;
    imports[specifier] = moduleCdnUrl(specifier, versions);
  }
  return imports;
}

interface PreviewCmsItem {
  id: number;
  values: Record<string, unknown>;
}

interface PreviewCmsPayload {
  item: PreviewCmsItem | null;
  items: PreviewCmsItem[];
  postType: string;
  collections?: Record<string, PreviewCmsItem[]>;
}

interface PreviewKodefyMoney {
  amount?: string | number;
  currencyCode?: string;
}

interface PreviewKodefyImage {
  url?: string;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
}

interface PreviewKodefyVariant {
  id?: string;
  title?: string;
  availableForSale?: boolean;
  quantityAvailable?: number | null;
  price?: PreviewKodefyMoney | null;
  compareAtPrice?: PreviewKodefyMoney | null;
  image?: PreviewKodefyImage | null;
}

interface PreviewKodefyProduct {
  id?: string;
  handle?: string;
  title?: string;
  vendor?: string;
  productType?: string;
  description?: string;
  descriptionHtml?: string;
  availableForSale?: boolean;
  featuredImage?: PreviewKodefyImage | null;
  images?: { nodes?: PreviewKodefyImage[] } | null;
  priceRange?: { minVariantPrice?: PreviewKodefyMoney | null } | null;
  variants?: { nodes?: PreviewKodefyVariant[] } | null;
}

interface PreviewKodefyCollection {
  id?: string;
  handle?: string;
  title?: string;
  description?: string;
  descriptionHtml?: string;
  image?: PreviewKodefyImage | null;
  products?: { nodes?: Array<{ id?: string; handle?: string }> } | null;
}

export interface PreviewKodefyPayload {
  schemaVersion?: number;
  configured?: boolean;
  shopDomain?: string;
  shop?: string;
  currency?: string;
  routes?: Record<string, string>;
  syncedAt?: string;
  products?: {
    nodes?: PreviewKodefyProduct[];
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  };
  collections?: {
    nodes?: PreviewKodefyCollection[];
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  };
}

interface PreviewScrollPosition {
  x: number;
  y: number;
}

type PreviewScrollPositions = Readonly<Record<string, PreviewScrollPosition>>;

function normalizePreviewScrollPositions(
  positions?: PreviewScrollPositions,
): Record<string, PreviewScrollPosition> {
  const normalized: Record<string, PreviewScrollPosition> = {};
  Object.entries(positions || {}).slice(0, 1024).forEach(([key, position]) => {
    if (
      (key !== '__document__' && !/^\d+(?:\/\d+)*$/.test(key))
      || !position
      || typeof position.x !== 'number'
      || typeof position.y !== 'number'
      || !Number.isFinite(position.x)
      || !Number.isFinite(position.y)
    ) return;
    normalized[key] = {
      x: Math.max(-1e9, Math.min(1e9, position.x)),
      y: Math.max(-1e9, Math.min(1e9, position.y)),
    };
  });
  return normalized;
}

const CMS_BINDING_SELECTOR = '[data-kodety-bind],[data-kodety-bind-content],[data-kodety-bind-title],[data-kodety-bind-href],[data-kodety-bind-src],[data-kodety-bind-alt]';
// These are maximum waits, never minimum delays: a healthy local project still
// reveals on its first settled paint. Slow styles/fonts/hero media keep the
// branded loader visible instead of exposing an unfinished white canvas.
const PREVIEW_SCROLL_RESTORE_FAIL_OPEN_MS = 600;
const PREVIEW_RUNTIME_FONT_SETTLE_MS = 300;
const PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS = 500;
const PREVIEW_SURFACE_DOM_SETTLE_MS = 1_500;
const PREVIEW_SURFACE_STYLE_SETTLE_MS = 3_000;
const PREVIEW_SURFACE_FONT_SETTLE_MS = 2_500;
const PREVIEW_SURFACE_MEDIA_SETTLE_MS = 5_000;
// Individual media waits may be restarted by authored DOM mutations. Keep one
// absolute deadline so streaming/broken remote media cannot hold the Builder's
// first-paint shield forever.
const PREVIEW_SURFACE_TOTAL_SETTLE_MS = 8_000;

/**
 * Browser defaults render an image at its intrinsic width. Inside a visual
 * builder that routinely leaves an otherwise unstyled image occupying only
 * part of its layer, while a fixed inherited height can silently distort it.
 *
 * Image defaults stay at zero specificity and precede authored styles, so an
 * authored sizing decision remains authoritative. The overlay closed-state
 * rules are the deliberate exception: their important visibility guard must
 * beat the surfaces' own inline `display: grid/block` until interaction opens
 * them. Background images are unaffected because image defaults only target
 * replaced <img> content.
 */
export const PROPORTIONAL_IMAGE_DEFAULTS_CSS = `
  :where(img:not([width])) { width: 100%; }
  :where(img:not([height])) { height: auto; }
  :where(img:not([hidden])) { display: block; }
  :where(picture:not([hidden])) { display: block; width: 100%; }
  :where([data-incode-component="lightbox"]:not([hidden])) { display: block; width: 100%; }
  :where([data-kodety-lightbox-dialog]:not([open])) { display: none; }
  :where([data-kodety-locale-trigger])::-webkit-details-marker { display: none; }
  :where([data-kodety-overlay] [data-kodety-overlay-surface]),
  :where([data-kodety-overlay][data-kodety-overlay-surface]) {
    box-sizing: border-box;
    z-index: var(--kodety-overlay-z-index, 9999);
  }
  :where([data-kodety-overlay] [data-kodety-overlay-backdrop]) {
    position: fixed;
    z-index: var(--kodety-overlay-backdrop-z-index, 9998);
    inset: 0;
  }
  :where([data-kodety-overlay]:not([data-state="open"]):not([data-html-editor-overlay-forced-open]) [data-kodety-overlay-surface]),
  :where([data-kodety-overlay][data-kodety-overlay-surface]:not([data-state="open"]):not([data-html-editor-overlay-forced-open])),
  :where([data-kodety-overlay]:not([data-state="open"]):not([data-html-editor-overlay-forced-open]) [data-kodety-overlay-backdrop]) {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  :where([data-kodety-overlay][data-html-editor-overlay-forced-open] [data-kodety-overlay-surface]),
  :where([data-kodety-overlay][data-kodety-overlay-surface][data-html-editor-overlay-forced-open]),
  :where([data-kodety-overlay][data-html-editor-overlay-forced-open] [data-kodety-overlay-backdrop]) {
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
    content-visibility: visible !important;
  }
  /* showPopover() moves fixed Design overlays into the browser top layer.
     Neutralize only the UA popover box defaults there; zero specificity keeps
     every authored surface/backdrop declaration authoritative. */
  :where([data-kodety-overlay][data-html-editor-overlay-forced-open] [data-kodety-overlay-surface][popover]),
  :where([data-kodety-overlay][data-kodety-overlay-surface][data-html-editor-overlay-forced-open][popover]) {
    inset: auto;
    width: auto;
    height: auto;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: visible;
    color: inherit;
    background: transparent;
  }
  :where([data-kodety-overlay][data-html-editor-overlay-forced-open] [data-kodety-overlay-backdrop][popover]) {
    width: auto;
    height: auto;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: visible;
    color: inherit;
    background: transparent;
  }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="block"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="block"] { display: block !important; }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="grid"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="grid"] { display: grid !important; }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="flex"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="flex"] { display: flex !important; }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="inline-block"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="inline-block"] { display: inline-block !important; }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="inline-flex"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="inline-flex"] { display: inline-flex !important; }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="table"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="table"] { display: table !important; }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="flow-root"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="flow-root"] { display: flow-root !important; }
  [data-kodety-overlay][data-html-editor-overlay-forced-open] [data-html-editor-overlay-projected-display="contents"],
  [data-kodety-overlay][data-html-editor-overlay-forced-open][data-html-editor-overlay-projected-display="contents"] { display: contents !important; }
  :where([data-kodety-overlay][data-html-editor-overlay-forced-open] [data-kodefy-checkout-item][data-kodefy-template]) {
    display: grid;
  }
  :where([data-kodety-overlay][data-html-editor-overlay-forced-open] dialog[data-kodety-overlay-surface]:not([open])),
  :where(dialog[data-kodety-overlay][data-kodety-overlay-surface][data-html-editor-overlay-forced-open]:not([open])) {
    display: block;
  }
`;

const NATIVE_OVERLAY_BOOT_GUARD_CSS = `
  :where(html:not([data-kodety-native-overlays-ready]) [data-kodety-overlay] [data-kodety-overlay-surface]),
  :where(html:not([data-kodety-native-overlays-ready]) [data-kodety-overlay][data-kodety-overlay-surface]),
  :where(html:not([data-kodety-native-overlays-ready]) [data-kodety-overlay] [data-kodety-overlay-backdrop]) {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
`;

/**
 * Runtime for authored overlays in the real Preview. Keeping this as a typed,
 * self-contained bootstrap (rather than a handwritten script string) lets the
 * browser contract be type-checked while still embedding it in the srcdoc.
 */
function nativeOverlayRuntimeBootstrap() {
  type OverlayState = {
    root: HTMLElement;
    surface: HTMLElement;
    backdrop: HTMLElement | null;
    open: boolean;
    trigger: HTMLElement | null;
    restoreFocusTo: HTMLElement | null;
    scrollLocked: boolean;
    resizeObserver: ResizeObserver | null;
    positionStyles: Record<string, string> | null;
    temporaryTabIndex: boolean;
    tooltipTimer: number | null;
  };
  type OverlayWindow = Window & typeof globalThis & {
    __KODETY_NATIVE_OVERLAYS__?: boolean;
    KodetyOverlays?: {
      open(target: string | Element, trigger?: Element | null): boolean;
      close(target: string | Element, restoreFocus?: boolean): boolean;
      toggle(target: string | Element, trigger?: Element | null): boolean;
      refresh(root?: ParentNode): void;
    };
  };
  type TopLayerRestore = {
    popover: string | null;
    zIndex: string;
    zIndexPriority: string;
  };

  const overlayWindow = window as OverlayWindow;
  if (overlayWindow.__KODETY_NATIVE_OVERLAYS__) {
    document.documentElement.setAttribute('data-kodety-native-overlays-ready', '');
    return;
  }
  overlayWindow.__KODETY_NATIVE_OVERLAYS__ = true;

  const ROOT_SELECTOR = '[data-kodety-overlay]';
  const SURFACE_SELECTOR = '[data-kodety-overlay-surface]';
  const BACKDROP_SELECTOR = '[data-kodety-overlay-backdrop]';
  const CONTROL_SELECTOR = [
    '[data-kodety-overlay-trigger]',
    '[data-kodety-overlay-open]',
    '[data-kodety-overlay-toggle]',
  ].join(',');
  const ACTION_SELECTOR = [
    '[data-kodety-overlay-close]',
    '[data-kodety-overlay-open]',
    '[data-kodety-overlay-toggle]',
    '[data-kodety-overlay-trigger]',
    BACKDROP_SELECTOR,
  ].join(',');
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    'audio[controls]',
    'video[controls]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const anchoredKinds = new Set(['popover', 'menu', 'tooltip']);
  const modalKinds = new Set(['modal', 'drawer', 'cart', 'checkout']);
  const states = new WeakMap<HTMLElement, OverlayState>();
  const initializedStates = new WeakSet<OverlayState>();
  const topLayerRestores = new WeakMap<HTMLElement, TopLayerRestore>();
  const openStack: OverlayState[] = [];
  let generatedSurfaceId = 0;
  let scrollLockCount = 0;
  let savedHtmlOverflow = '';
  let savedBodyOverflow = '';
  let savedBodyPaddingRight = '';
  let positionFrame = 0;
  let redirectingFocus = false;

  const htmlElements = (value: Iterable<Element>): HTMLElement[] => (
    Array.from(value).filter((element): element is HTMLElement => element instanceof HTMLElement)
  );
  const nearestRoot = (element: Element | null): HTMLElement | null => {
    const root = element?.closest?.(ROOT_SELECTOR);
    return root instanceof HTMLElement ? root : null;
  };
  const ownedDescendant = (
    root: HTMLElement,
    selector: string,
  ): HTMLElement | null => htmlElements(root.querySelectorAll(selector))
    .find(element => nearestRoot(element) === root) || null;
  const surfaceForRoot = (root: HTMLElement): HTMLElement | null => {
    if (root.matches(SURFACE_SELECTOR)) return root;
    const surface = ownedDescendant(root, SURFACE_SELECTOR);
    if (surface) return surface;
    // A wrapper may be attached one render before its surface. Do not hide the
    // whole wrapper (and its trigger) while that incremental DOM is settling.
    if (root.querySelector(CONTROL_SELECTOR + ',' + BACKDROP_SELECTOR)) return null;
    return root;
  };
  const backdropForRoot = (root: HTMLElement): HTMLElement | null => (
    ownedDescendant(root, BACKDROP_SELECTOR)
  );
  const overlayKind = (root: HTMLElement, surface: HTMLElement) => (
    surface.getAttribute('data-kodety-overlay-kind')
    || root.getAttribute('data-kodety-overlay-kind')
    || root.getAttribute('data-kodety-overlay')
    || ''
  ).trim().toLowerCase();
  const configuredValue = (
    root: HTMLElement,
    surface: HTMLElement,
    name: string,
  ): string | null => surface.getAttribute(name) ?? root.getAttribute(name);
  const configuredBoolean = (
    root: HTMLElement,
    surface: HTMLElement,
    name: string,
    fallback: boolean,
  ) => {
    const raw = configuredValue(root, surface, name);
    if (raw === null) return fallback;
    return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
  };
  const showInOverlayTopLayer = (element: HTMLElement | null, zIndex: number) => {
    if (!element) return;
    if (!topLayerRestores.has(element)) {
      topLayerRestores.set(element, {
        popover: element.getAttribute('popover'),
        zIndex: element.style.getPropertyValue('z-index'),
        zIndexPriority: element.style.getPropertyPriority('z-index'),
      });
    }
    element.style.setProperty('z-index', String(zIndex));
    if (element instanceof HTMLDialogElement || typeof element.showPopover !== 'function') return;
    element.setAttribute('popover', 'manual');
    try { element.showPopover(); } catch {}
  };
  const hideFromOverlayTopLayer = (element: HTMLElement | null) => {
    if (!element) return;
    if (!(element instanceof HTMLDialogElement) && typeof element.hidePopover === 'function') {
      try { element.hidePopover(); } catch {}
    }
    const restore = topLayerRestores.get(element);
    if (!restore) return;
    if (restore.popover === null) element.removeAttribute('popover');
    else element.setAttribute('popover', restore.popover);
    if (restore.zIndex) element.style.setProperty('z-index', restore.zIndex, restore.zIndexPriority);
    else element.style.removeProperty('z-index');
    topLayerRestores.delete(element);
  };
  const isModalState = (state: OverlayState) => {
    const kind = overlayKind(state.root, state.surface);
    return configuredBoolean(
      state.root,
      state.surface,
      'data-kodety-overlay-modal',
      modalKinds.has(kind)
        || state.surface.getAttribute('aria-modal') === 'true',
    );
  };
  const isAnchoredState = (state: OverlayState) => {
    const mode = (
      configuredValue(state.root, state.surface, 'data-kodety-overlay-mode')
      || configuredValue(state.root, state.surface, 'data-kodety-overlay-position')
      || ''
    ).trim().toLowerCase();
    if (mode) return mode === 'anchored';
    return anchoredKinds.has(overlayKind(state.root, state.surface));
  };
  const isFocusable = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return (
      !element.hasAttribute('disabled')
      && element.getAttribute('aria-hidden') !== 'true'
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && element.getClientRects().length > 0
    );
  };
  const focusableElements = (surface: HTMLElement) => (
    htmlElements(surface.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isFocusable)
  );
  const controlsForRoot = (root: HTMLElement): HTMLElement[] => (
    htmlElements(document.querySelectorAll(CONTROL_SELECTOR)).filter(control => {
      if (nearestRoot(control) === root) return true;
      return rootForControl(control) === root;
    })
  );
  const tokenValuesForControl = (control: HTMLElement): string[] => {
    const values = [
      control.getAttribute('data-kodety-overlay-target'),
      control.getAttribute('data-kodety-overlay-toggle'),
      control.getAttribute('data-kodety-overlay-open'),
      control.getAttribute('data-kodety-overlay-trigger'),
      control.getAttribute('data-kodety-overlay-close'),
      control.getAttribute('aria-controls'),
    ];
    return values.flatMap(value => (
      value && !['true', 'false'].includes(value.trim().toLowerCase())
        ? value.trim().split(/\s+/).map(token => token.replace(/^#/, '')).filter(Boolean)
        : []
    ));
  };
  const rootForToken = (rawToken: string): HTMLElement | null => {
    const token = rawToken.replace(/^#/, '').trim();
    if (!token) return null;
    for (const root of htmlElements(document.querySelectorAll(ROOT_SELECTOR))) {
      const surface = surfaceForRoot(root);
      if (
        root.id === token
        || root.getAttribute('data-kodety-overlay') === token
        || surface?.id === token
      ) return root;
    }
    const controlled = document.getElementById(token);
    return controlled instanceof Element ? nearestRoot(controlled) : null;
  };
  function rootForControl(control: HTMLElement): HTMLElement | null {
    for (const token of tokenValuesForControl(control)) {
      const targeted = rootForToken(token);
      if (targeted) return targeted;
    }
    return nearestRoot(control);
  }
  const stateForRoot = (root: HTMLElement): OverlayState | null => {
    const surface = surfaceForRoot(root);
    if (!surface) return null;
    const current = states.get(root);
    if (current?.surface === surface) return current;
    if (current) {
      if (current.scrollLocked) releaseScrollLock(current);
      current.resizeObserver?.disconnect();
      if (current.tooltipTimer !== null) window.clearTimeout(current.tooltipTimer);
      const index = openStack.indexOf(current);
      if (index >= 0) openStack.splice(index, 1);
    }
    const state: OverlayState = {
      root,
      surface,
      backdrop: backdropForRoot(root),
      open: false,
      trigger: null,
      restoreFocusTo: null,
      scrollLocked: false,
      resizeObserver: null,
      positionStyles: null,
      temporaryTabIndex: false,
      tooltipTimer: null,
    };
    states.set(root, state);
    if (!surface.id) {
      generatedSurfaceId += 1;
      surface.id = 'kodety-overlay-surface-' + generatedSurfaceId;
    }
    if (surface instanceof HTMLDialogElement) {
      surface.addEventListener('cancel', event => {
        if (!state.open) return;
        event.preventDefault();
        closeState(state, true);
      });
      surface.addEventListener('close', () => {
        if (state.open) closeState(state, true);
      });
    }
    surface.addEventListener('toggle', event => {
      const toggleEvent = event as Event & { newState?: string };
      if (state.open && toggleEvent.newState === 'closed') closeState(state, true);
    });
    return state;
  };
  const stateForTarget = (target: string | Element): OverlayState | null => {
    const root = typeof target === 'string'
      ? rootForToken(target)
      : target instanceof HTMLElement && target.matches(ROOT_SELECTOR)
        ? target
        : target instanceof HTMLElement
          ? rootForControl(target) || nearestRoot(target) || rootForToken(target.id || '')
          : null;
    return root ? stateForRoot(root) : null;
  };
  const updateControlState = (state: OverlayState) => {
    controlsForRoot(state.root).forEach(control => {
      control.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      control.setAttribute('data-state', state.open ? 'open' : 'closed');
      if (!control.hasAttribute('aria-controls')) {
        control.setAttribute('aria-controls', state.surface.id);
      }
    });
  };
  const acquireScrollLock = (state: OverlayState) => {
    if (state.scrollLocked) return;
    state.scrollLocked = true;
    scrollLockCount += 1;
    if (scrollLockCount !== 1) return;
    const body = document.body;
    savedHtmlOverflow = document.documentElement.style.overflow;
    savedBodyOverflow = body?.style.overflow || '';
    savedBodyPaddingRight = body?.style.paddingRight || '';
    const scrollbarWidth = Math.max(0, innerWidth - document.documentElement.clientWidth);
    document.documentElement.style.overflow = 'hidden';
    if (body) {
      const currentPadding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.overflow = 'hidden';
      if (scrollbarWidth) body.style.paddingRight = currentPadding + scrollbarWidth + 'px';
    }
  };
  function releaseScrollLock(state: OverlayState) {
    if (!state.scrollLocked) return;
    state.scrollLocked = false;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount) return;
    document.documentElement.style.overflow = savedHtmlOverflow;
    if (document.body) {
      document.body.style.overflow = savedBodyOverflow;
      document.body.style.paddingRight = savedBodyPaddingRight;
    }
  }
  const rememberPositionStyles = (state: OverlayState) => {
    if (state.positionStyles) return;
    state.positionStyles = Object.fromEntries(
      ['position', 'inset', 'top', 'right', 'bottom', 'left', 'margin', 'transform']
        .map(property => [property, state.surface.style.getPropertyValue(property)]),
    );
  };
  const restorePositionStyles = (state: OverlayState) => {
    if (!state.positionStyles) return;
    Object.entries(state.positionStyles).forEach(([property, value]) => {
      if (value) state.surface.style.setProperty(property, value);
      else state.surface.style.removeProperty(property);
    });
    state.positionStyles = null;
    state.surface.removeAttribute('data-placement');
  };
  const matchingTrigger = (state: OverlayState) => (
    state.trigger?.isConnected
      ? state.trigger
      : controlsForRoot(state.root).find(control => (
        control.hasAttribute('data-kodety-overlay-trigger')
        || control.hasAttribute('data-kodety-overlay-open')
        || control.hasAttribute('data-kodety-overlay-toggle')
      )) || null
  );
  const normalizedPlacement = (state: OverlayState) => {
    const authored = (
      configuredValue(state.root, state.surface, 'data-kodety-overlay-placement')
      || (overlayKind(state.root, state.surface) === 'tooltip' ? 'top' : 'bottom-start')
    ).trim().toLowerCase();
    const [rawSide, rawAlignment] = authored.split('-');
    const side = ['top', 'right', 'bottom', 'left'].includes(rawSide) ? rawSide : 'bottom';
    const alignment = ['start', 'end'].includes(rawAlignment) ? rawAlignment : 'center';
    return { side, alignment };
  };
  const positionAnchoredState = (state: OverlayState) => {
    if (!state.open || !isAnchoredState(state)) return;
    const trigger = matchingTrigger(state);
    if (!trigger) return;
    rememberPositionStyles(state);
    const surface = state.surface;
    surface.style.position = 'fixed';
    surface.style.inset = 'auto';
    surface.style.top = '0px';
    surface.style.right = 'auto';
    surface.style.bottom = 'auto';
    surface.style.left = '0px';
    surface.style.margin = '0';
    surface.style.transform = 'none';
    const triggerRect = trigger.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth, innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight, innerHeight || 0);
    const viewportMargin = 8;
    const configuredOffset = Number.parseFloat(
      configuredValue(state.root, surface, 'data-kodety-overlay-offset') || '',
    );
    const gap = Number.isFinite(configuredOffset) ? configuredOffset : 8;
    let { side, alignment } = normalizedPlacement(state);
    const available = {
      top: triggerRect.top - viewportMargin,
      right: viewportWidth - triggerRect.right - viewportMargin,
      bottom: viewportHeight - triggerRect.bottom - viewportMargin,
      left: triggerRect.left - viewportMargin,
    };
    const required = (side === 'top' || side === 'bottom')
      ? surfaceRect.height + gap
      : surfaceRect.width + gap;
    const opposite: Record<string, string> = {
      top: 'bottom', right: 'left', bottom: 'top', left: 'right',
    };
    const oppositeSide = opposite[side];
    if (available[side as keyof typeof available] < required
      && available[oppositeSide as keyof typeof available] > available[side as keyof typeof available]) {
      side = oppositeSide;
    }
    let left = triggerRect.left + (triggerRect.width - surfaceRect.width) / 2;
    let top = triggerRect.top + (triggerRect.height - surfaceRect.height) / 2;
    if (side === 'top') top = triggerRect.top - surfaceRect.height - gap;
    else if (side === 'bottom') top = triggerRect.bottom + gap;
    else if (side === 'left') left = triggerRect.left - surfaceRect.width - gap;
    else left = triggerRect.right + gap;
    if (side === 'top' || side === 'bottom') {
      if (alignment === 'start') left = triggerRect.left;
      else if (alignment === 'end') left = triggerRect.right - surfaceRect.width;
    } else {
      if (alignment === 'start') top = triggerRect.top;
      else if (alignment === 'end') top = triggerRect.bottom - surfaceRect.height;
    }
    const maxLeft = Math.max(viewportMargin, viewportWidth - surfaceRect.width - viewportMargin);
    const maxTop = Math.max(viewportMargin, viewportHeight - surfaceRect.height - viewportMargin);
    left = Math.min(Math.max(viewportMargin, left), maxLeft);
    top = Math.min(Math.max(viewportMargin, top), maxTop);
    surface.style.left = Math.round(left) + 'px';
    surface.style.top = Math.round(top) + 'px';
    surface.setAttribute('data-placement', side + (alignment === 'center' ? '' : '-' + alignment));
  };
  const scheduleAnchoredPositions = () => {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      openStack.forEach(positionAnchoredState);
    });
  };
  const setVisibleState = (state: OverlayState) => {
    state.root.setAttribute('data-state', 'open');
    state.surface.setAttribute('data-state', 'open');
    state.surface.removeAttribute('hidden');
    state.surface.removeAttribute('inert');
    state.surface.setAttribute('aria-hidden', 'false');
    if (state.backdrop) {
      state.backdrop.setAttribute('data-state', 'open');
      state.backdrop.removeAttribute('hidden');
      state.backdrop.removeAttribute('inert');
      state.backdrop.setAttribute('aria-hidden', 'false');
      showInOverlayTopLayer(state.backdrop, 2147483646);
    }
    showInOverlayTopLayer(state.surface, 2147483647);
    if (state.surface instanceof HTMLDialogElement && !state.surface.open) {
      try {
        if (isModalState(state)) state.surface.showModal();
        else state.surface.show();
      } catch {
        state.surface.setAttribute('open', '');
      }
    }
    updateControlState(state);
  };
  const setHiddenState = (state: OverlayState) => {
    state.root.removeAttribute('data-html-editor-overlay-forced-open');
    state.root.setAttribute('data-state', 'closed');
    state.surface.removeAttribute('data-html-editor-overlay-forced-open');
    state.surface.setAttribute('data-state', 'closed');
    if (state.surface instanceof HTMLDialogElement && state.surface.open) {
      try { state.surface.close(); } catch { state.surface.removeAttribute('open'); }
    }
    hideFromOverlayTopLayer(state.surface);
    state.surface.setAttribute('hidden', '');
    state.surface.setAttribute('inert', '');
    state.surface.setAttribute('aria-hidden', 'true');
    if (state.backdrop) {
      state.backdrop.removeAttribute('data-html-editor-overlay-forced-open');
      hideFromOverlayTopLayer(state.backdrop);
      state.backdrop.setAttribute('data-state', 'closed');
      state.backdrop.setAttribute('hidden', '');
      state.backdrop.setAttribute('inert', '');
      state.backdrop.setAttribute('aria-hidden', 'true');
    }
    updateControlState(state);
  };
  const focusInside = (state: OverlayState) => {
    if (!state.open || !isModalState(state)) return;
    const preferred = state.surface.querySelector<HTMLElement>(
      '[data-kodety-overlay-autofocus], [autofocus]',
    );
    const target = (preferred && isFocusable(preferred) ? preferred : null)
      || focusableElements(state.surface)[0]
      || state.surface;
    if (target === state.surface && !state.surface.hasAttribute('tabindex')) {
      state.surface.setAttribute('tabindex', '-1');
      state.temporaryTabIndex = true;
    }
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  };
  const openState = (
    state: OverlayState,
    trigger: HTMLElement | null,
    focus = true,
  ) => {
    if (overlayKind(state.root, state.surface) === 'checkout'
      && state.root.getAttribute('data-kodefy-checkout-ready') !== 'true') return;
    if (state.tooltipTimer !== null) {
      window.clearTimeout(state.tooltipTimer);
      state.tooltipTimer = null;
    }
    if (state.open) {
      if (trigger) state.trigger = trigger;
      setVisibleState(state);
      scheduleAnchoredPositions();
      return;
    }
    state.open = true;
    state.trigger = trigger || matchingTrigger(state);
    state.restoreFocusTo = (
      trigger
      || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    );
    openStack.push(state);
    setVisibleState(state);
    const lockByDefault = isModalState(state);
    if (configuredBoolean(
      state.root,
      state.surface,
      'data-kodety-overlay-lock-scroll',
      lockByDefault,
    )) acquireScrollLock(state);
    if (isAnchoredState(state) && typeof ResizeObserver === 'function') {
      state.resizeObserver = new ResizeObserver(scheduleAnchoredPositions);
      state.resizeObserver.observe(state.surface);
      if (state.trigger) state.resizeObserver.observe(state.trigger);
    }
    scheduleAnchoredPositions();
    if (focus && isModalState(state)) requestAnimationFrame(() => focusInside(state));
    state.root.dispatchEvent(new CustomEvent('kodety:overlay-open', {
      bubbles: true,
      detail: { root: state.root, surface: state.surface, trigger: state.trigger },
    }));
  };
  function closeState(state: OverlayState, restoreFocus = true) {
    if (state.tooltipTimer !== null) {
      window.clearTimeout(state.tooltipTimer);
      state.tooltipTimer = null;
    }
    if (!state.open) {
      setHiddenState(state);
      return;
    }
    state.open = false;
    const stackIndex = openStack.indexOf(state);
    if (stackIndex >= 0) openStack.splice(stackIndex, 1);
    state.resizeObserver?.disconnect();
    state.resizeObserver = null;
    releaseScrollLock(state);
    restorePositionStyles(state);
    setHiddenState(state);
    if (state.temporaryTabIndex) {
      state.surface.removeAttribute('tabindex');
      state.temporaryTabIndex = false;
    }
    const focusTarget = state.restoreFocusTo;
    state.restoreFocusTo = null;
    state.root.dispatchEvent(new CustomEvent('kodety:overlay-close', {
      bubbles: true,
      detail: { root: state.root, surface: state.surface },
    }));
    if (
      restoreFocus
      && overlayKind(state.root, state.surface) !== 'tooltip'
      && focusTarget?.isConnected
    ) {
      requestAnimationFrame(() => {
        try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
      });
    }
  }
  const toggleState = (state: OverlayState, trigger: HTMLElement | null) => {
    if (state.open) closeState(state, true);
    else openState(state, trigger, true);
  };
  const initializeRoot = (root: HTMLElement) => {
    const state = stateForRoot(root);
    if (!state) return;
    if (initializedStates.has(state)) {
      updateControlState(state);
      if (state.open) scheduleAnchoredPositions();
      return;
    }
    initializedStates.add(state);
    // Published/Preview overlays are fail-closed. Authored runtime residue such
    // as data-state="open", <dialog open> or the retired default-open flag must
    // never make a surface visible before an actual trigger/API interaction.
    state.root.removeAttribute('data-kodety-overlay-default-open');
    setHiddenState(state);
  };
  const refresh = (scope: ParentNode = document) => {
    const roots: HTMLElement[] = [];
    if (scope instanceof HTMLElement) {
      const owner = nearestRoot(scope);
      if (owner) roots.push(owner);
    }
    htmlElements(scope.querySelectorAll(ROOT_SELECTOR)).forEach(root => roots.push(root));
    Array.from(new Set(roots)).forEach(initializeRoot);
  };
  const eventElement = (event: Event): HTMLElement | null => {
    const firstElement = event.composedPath().find(node => node instanceof HTMLElement);
    return firstElement instanceof HTMLElement ? firstElement : null;
  };
  const actionControl = (target: HTMLElement): HTMLElement | null => {
    const control = target.closest(ACTION_SELECTOR);
    return control instanceof HTMLElement ? control : null;
  };
  const clickIsInsideState = (event: MouseEvent, state: OverlayState) => {
    const path = event.composedPath();
    if (path.includes(state.surface)) return true;
    return controlsForRoot(state.root).some(control => path.includes(control));
  };
  const isBareKodefyCheckoutControl = (control: HTMLElement) => (
    control.hasAttribute('data-kodefy-checkout')
    && control.hasAttribute('data-kodety-overlay-trigger')
    && !control.hasAttribute('data-kodety-overlay-open')
    && !control.hasAttribute('data-kodety-overlay-toggle')
    && !control.hasAttribute('data-kodety-overlay-close')
  );
  const tooltipStateForControl = (control: HTMLElement): OverlayState | null => {
    const root = rootForControl(control);
    const state = root ? stateForRoot(root) : null;
    return state && overlayKind(state.root, state.surface) === 'tooltip' ? state : null;
  };
  const clearTooltipTimer = (state: OverlayState) => {
    if (state.tooltipTimer === null) return;
    window.clearTimeout(state.tooltipTimer);
    state.tooltipTimer = null;
  };
  const scheduleTooltipOpen = (state: OverlayState, control: HTMLElement) => {
    clearTooltipTimer(state);
    state.tooltipTimer = window.setTimeout(() => {
      state.tooltipTimer = null;
      openState(state, control, false);
    }, 80);
  };
  const scheduleTooltipClose = (state: OverlayState) => {
    clearTooltipTimer(state);
    state.tooltipTimer = window.setTimeout(() => {
      state.tooltipTimer = null;
      closeState(state, false);
    }, 100);
  };
  const targetBelongsToState = (target: EventTarget | null, state: OverlayState) => {
    if (!(target instanceof Node)) return false;
    if (state.surface.contains(target)) return true;
    return controlsForRoot(state.root).some(control => control.contains(target));
  };

  document.addEventListener('click', event => {
    const target = eventElement(event);
    if (!target) return;
    const control = actionControl(target);
    if (control && !control.matches(':disabled,[aria-disabled="true"]')) {
      // Kodefy hydrates this intentionally bare trigger with authoritative cart
      // data before opening the editable checkout overlay. Let that integration
      // own the click instead of flashing the authored placeholders first.
      if (isBareKodefyCheckoutControl(control)) return;
      const root = rootForControl(control);
      const state = root ? stateForRoot(root) : null;
      if (state) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (control.hasAttribute('data-kodety-overlay-close')
          || control.hasAttribute('data-kodety-overlay-backdrop')) {
          closeState(state, true);
        } else if (control.hasAttribute('data-kodety-overlay-toggle')
          || (control.hasAttribute('data-kodety-overlay-trigger')
            && !control.hasAttribute('data-kodety-overlay-open'))) {
          toggleState(state, control);
        } else {
          openState(state, control, true);
        }
        return;
      }
    }
    for (let index = openStack.length - 1; index >= 0; index -= 1) {
      const state = openStack[index];
      if (!state.open) continue;
      if (clickIsInsideState(event, state)) return;
      const closeOutside = configuredBoolean(
        state.root,
        state.surface,
        'data-kodety-overlay-close-outside',
        true,
      );
      if (closeOutside) closeState(state, true);
      return;
    }
  }, true);
  document.addEventListener('pointerover', event => {
    const target = eventElement(event);
    if (!target) return;
    const control = target.closest(CONTROL_SELECTOR);
    if (control instanceof HTMLElement) {
      const state = tooltipStateForControl(control);
      if (!state || targetBelongsToState(event.relatedTarget, state)) return;
      scheduleTooltipOpen(state, control);
      return;
    }
    const root = nearestRoot(target);
    const state = root ? stateForRoot(root) : null;
    if (state && overlayKind(state.root, state.surface) === 'tooltip' && state.surface.contains(target)) {
      clearTooltipTimer(state);
    }
  }, true);
  document.addEventListener('pointerout', event => {
    const target = eventElement(event);
    if (!target) return;
    const control = target.closest(CONTROL_SELECTOR);
    const root = control instanceof HTMLElement ? rootForControl(control) : nearestRoot(target);
    const state = root ? stateForRoot(root) : null;
    if (!state || overlayKind(state.root, state.surface) !== 'tooltip') return;
    if (targetBelongsToState(event.relatedTarget, state)) return;
    if ((control instanceof HTMLElement && control.contains(target)) || state.surface.contains(target)) {
      scheduleTooltipClose(state);
    }
  }, true);
  document.addEventListener('keydown', event => {
    const topState = [...openStack].reverse().find(state => state.open);
    if (!topState) return;
    if (event.key === 'Escape') {
      if (!configuredBoolean(
        topState.root,
        topState.surface,
        'data-kodety-overlay-close-escape',
        true,
      )) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeState(topState, true);
      return;
    }
    if (event.key !== 'Tab') return;
    const modalState = [...openStack].reverse().find(state => state.open && isModalState(state));
    if (!modalState) return;
    const focusable = focusableElements(modalState.surface);
    if (!focusable.length) {
      event.preventDefault();
      focusInside(modalState);
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modalState.surface.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modalState.surface.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }, true);
  document.addEventListener('focusin', event => {
    const target = eventElement(event);
    const control = target?.closest(CONTROL_SELECTOR);
    if (control instanceof HTMLElement) {
      const tooltipState = tooltipStateForControl(control);
      if (tooltipState) scheduleTooltipOpen(tooltipState, control);
    }
    if (redirectingFocus) return;
    const modalState = [...openStack].reverse().find(state => state.open && isModalState(state));
    if (!modalState || !target || modalState.surface.contains(target)) return;
    redirectingFocus = true;
    focusInside(modalState);
    queueMicrotask(() => { redirectingFocus = false; });
  }, true);
  document.addEventListener('focusout', event => {
    const target = eventElement(event);
    const control = target?.closest(CONTROL_SELECTOR);
    if (!(control instanceof HTMLElement)) return;
    const state = tooltipStateForControl(control);
    if (!state || targetBelongsToState(event.relatedTarget, state)) return;
    scheduleTooltipClose(state);
  }, true);
  addEventListener('resize', scheduleAnchoredPositions, { passive: true });
  document.addEventListener('scroll', scheduleAnchoredPositions, { capture: true, passive: true });
  new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node instanceof HTMLElement) refresh(node);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });

  overlayWindow.KodetyOverlays = {
    open(target, trigger) {
      const state = stateForTarget(target);
      if (!state) return false;
      openState(state, trigger instanceof HTMLElement ? trigger : null, true);
      return true;
    },
    close(target, restoreFocus = true) {
      const state = stateForTarget(target);
      if (!state) return false;
      closeState(state, restoreFocus);
      return true;
    },
    toggle(target, trigger) {
      const state = stateForTarget(target);
      if (!state) return false;
      toggleState(state, trigger instanceof HTMLElement ? trigger : null);
      return true;
    },
    refresh,
  };
  refresh();
  document.documentElement.setAttribute('data-kodety-native-overlays-ready', '');
}

function materializeNativeLocaleSelectors(document: Document, project: HtmlProject) {
  const settings = readEditorMetadata(project).localization;
  const locales = (settings?.locales || []).filter(locale => locale.enabled !== false && locale.code);
  if (!locales.length) return;
  const documentLocale = document.documentElement.getAttribute('lang') || '';
  const activeLocale = locales.some(locale => locale.code === documentLocale)
    ? documentLocale
    : settings?.sourceLocale || settings?.defaultLocale || locales[0].code;
  const currentLocale = locales.find(locale => locale.code === activeLocale) || locales[0];

  document.querySelectorAll<HTMLElement>('[data-kodety-locale-selector], [data-incode-component="locales-list"]').forEach(root => {
    const current = root.querySelector<HTMLElement>('[data-kodety-locale-current]');
    if (current) current.textContent = currentLocale.name || currentLocale.code;
    const options = root.querySelector<HTMLElement>('[data-kodety-locale-options]');
    if (!options) return;
    const authoredTemplate = options.querySelector<HTMLAnchorElement>('[data-kodety-locale-option], a');
    if (!authoredTemplate) return;
    const fragment = document.createDocumentFragment();
    locales.forEach(locale => {
      const option = authoredTemplate.cloneNode(true) as HTMLAnchorElement;
      option.textContent = locale.name || locale.code;
      option.setAttribute('href', '#');
      option.setAttribute('hreflang', locale.code);
      option.setAttribute('lang', locale.code);
      option.setAttribute('dir', locale.direction || 'ltr');
      option.setAttribute('data-kodety-locale-option', '');
      if (locale.code === currentLocale.code) option.setAttribute('aria-current', 'page');
      else option.removeAttribute('aria-current');
      fragment.appendChild(option);
    });
    options.replaceChildren(fragment);
  });
}

function materializeInitialCmsPreview(document: Document, payload?: PreviewCmsPayload | null) {
  if (!payload) return;
  const collections = payload.collections && typeof payload.collections === 'object'
    ? payload.collections
    : { [payload.postType]: payload.items };
  const normalize = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(normalize).filter(Boolean).join(', ');
    if (typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return String(object.url || object.value || object.label || '');
    }
    return String(value);
  };
  const previewItemForType = (postType: string, fallback: PreviewCmsItem | null) => {
    if (!postType) return fallback;
    if (postType === payload.postType && payload.item) return payload.item;
    return collections[postType]?.[0] || null;
  };
  const applyBindings = (
    root: Element | Document,
    item: PreviewCmsItem | null,
    collectionType = '',
  ) => {
    const elements: Element[] = [];
    if (root instanceof Element && root.matches(CMS_BINDING_SELECTOR)) elements.push(root);
    root.querySelectorAll(CMS_BINDING_SELECTOR).forEach(element => elements.push(element));
    elements.forEach(element => {
      const bindingType = element.getAttribute('data-kodety-bind-type') || '';
      const bindingItem = bindingType && bindingType !== collectionType
        ? previewItemForType(bindingType, item)
        : item;
      const bindings: Record<string, string> = {};
      const legacyField = element.getAttribute('data-kodety-bind');
      if (legacyField) {
        bindings[element.getAttribute('data-kodety-bind-target') || (element.tagName === 'A' ? 'href' : ['IMG', 'SOURCE', 'VIDEO'].includes(element.tagName) ? 'src' : 'content')] = legacyField;
      }
      ['content', 'title', 'href', 'src', 'alt'].forEach(target => {
        const field = element.getAttribute(`data-kodety-bind-${target}`);
        if (field) bindings[target] = field;
      });
      Object.entries(bindings).forEach(([target, field]) => {
        const raw = bindingItem?.values
          ? (target === 'href' && field === 'slug' ? bindingItem.values.permalink : bindingItem.values[field])
          : undefined;
        if (raw === undefined || raw === null) return;
        const value = normalize(raw);
        if (target === 'content') element.innerHTML = value;
        else if (target === 'alt' && typeof raw === 'object' && raw && !Array.isArray(raw)) element.setAttribute(target, String((raw as Record<string, unknown>).alt || ''));
        else if (value) element.setAttribute(target, value);
        else element.removeAttribute(target);
        if (target === 'src') element.removeAttribute('srcset');
      });
    });
  };

  applyBindings(document, payload.item, payload.postType);
  // Capture the authored containers before inserting any repeated siblings so
  // nested/adjacent collections do not enter this initialization pass twice.
  const containers = Array.from(document.querySelectorAll('[data-kodety-collection]'));
  containers.forEach(container => {
    const collectionType = container.getAttribute('data-kodety-collection') || '';
    const items = collections[collectionType];
    if (!Array.isArray(items)) return;
    const collectionLimit = Math.max(1, Math.min(100, Number(container.getAttribute('data-kodety-limit')) || 6));
    const filterable = Array.from(document.querySelectorAll('form[data-kodety-form-mode="filter"]')).some(
      form => form.getAttribute('data-kodety-filter-collection') === collectionType,
    );
    const limited = items.slice(0, filterable ? 100 : collectionLimit);
    const belongsToContainer = (candidate: Element) => candidate.parentElement?.closest('[data-kodety-collection]') === container;
    const explicitTemplate = Array.from(container.querySelectorAll('[data-kodety-collection-item]')).find(belongsToContainer) || null;
    const repeatSelf = !explicitTemplate && container.getAttribute('data-kodety-repeat') !== 'child';
    if (repeatSelf) {
      const parent = container.parentNode;
      if (!parent) return;
      if (!limited.length) {
        if (!container.hasAttribute('data-html-editor-original-hidden')) {
          container.toggleAttribute('hidden', !container.querySelector('[data-kodety-empty-state]'));
        }
        return;
      }
      limited.forEach((item, itemIndex) => {
        const clone = container.cloneNode(true) as Element;
        ['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat', 'data-kodety-collection-item', 'data-html-editor-cms-snapshot-id'].forEach(attribute => clone.removeAttribute(attribute));
        clone.setAttribute('data-kodety-preview-clone', 'true');
        clone.setAttribute('data-kodety-preview-item-id', String(item.id || ''));
        clone.setAttribute('data-kodety-rendered-item', collectionType);
        clone.setAttribute('data-kodety-filter-limit', String(collectionLimit));
        clone.setAttribute('data-kodety-filter-values', JSON.stringify(item.values || {}));
        if (!clone.hasAttribute('data-html-editor-original-hidden')) clone.removeAttribute('hidden');
        if (itemIndex >= collectionLimit) clone.setAttribute('hidden', '');
        clone.querySelectorAll('[data-kodety-empty-state]').forEach(element => element.remove());
        applyBindings(clone, item, collectionType);
        parent.insertBefore(clone, container);
      });
      container.setAttribute('hidden', '');
      return;
    }
    const template = explicitTemplate || Array.from(container.children).find(child => !child.hasAttribute('data-kodety-empty-state')) || null;
    if (!template || !template.parentNode) return;
    const parent = template.parentNode;
    const anchor = template.nextSibling;
    if (!limited.length) {
      parent.removeChild(template);
      container.querySelectorAll('[data-kodety-empty-state]').forEach(element => {
        if (!element.hasAttribute('data-html-editor-original-hidden')) element.removeAttribute('hidden');
      });
      return;
    }
    limited.forEach((item, itemIndex) => {
      const clone = template.cloneNode(true) as Element;
      clone.removeAttribute('data-kodety-collection-item');
      clone.setAttribute('data-kodety-preview-item-id', String(item.id || ''));
      clone.setAttribute('data-kodety-rendered-item', collectionType);
      clone.setAttribute('data-kodety-filter-limit', String(collectionLimit));
      clone.setAttribute('data-kodety-filter-values', JSON.stringify(item.values || {}));
      if (itemIndex >= collectionLimit) clone.setAttribute('hidden', '');
      clone.querySelectorAll('[data-kodety-empty-state]').forEach(element => element.remove());
      applyBindings(clone, item, collectionType);
      parent.insertBefore(clone, anchor);
    });
    parent.removeChild(template);
    container.querySelectorAll('[data-kodety-empty-state]').forEach(element => element.setAttribute('hidden', ''));
  });
}

/** Materialize the server-synchronized Shopify snapshot before page scripts run. */
function materializeInitialKodefyPreview(document: Document, payload?: PreviewKodefyPayload | null) {
  if (!payload?.configured || !Array.isArray(payload.products?.nodes)) return;
  const products = payload.products.nodes.filter(product => product && product.title);
  if (!products.length) return;
  const routes = payload.routes || {};
  const route = (name: string, handle = '') => {
    const base = routes[name] || `/${name}/`;
    return handle
      ? `${base.replace(/\/+$/, '')}/${encodeURIComponent(handle)}/`
      : base;
  };
  const money = (value?: PreviewKodefyMoney | null) => {
    if (!value) return '';
    const amount = Number(value.amount || 0);
    const currency = value.currencyCode || payload.currency || 'BRL';
    try {
      return new Intl.NumberFormat(document.documentElement.lang || 'pt-BR', {
        style: 'currency',
        currency,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  };
  const firstVariant = (product: PreviewKodefyProduct) => {
    const variants = product.variants?.nodes || [];
    return variants.find(variant => variant.availableForSale) || variants[0] || null;
  };
  const productPrice = (product: PreviewKodefyProduct) =>
    firstVariant(product)?.price || product.priceRange?.minVariantPrice || null;
  const setText = (root: Element, selector: string, value: unknown) => {
    root.querySelectorAll(selector).forEach(node => {
      node.textContent = value === undefined || value === null ? '' : String(value);
    });
  };
  const productImage = (product: PreviewKodefyProduct) =>
    product.featuredImage || product.images?.nodes?.[0] || null;
  const applyImage = (node: Element | null, image: PreviewKodefyImage | null, fallbackAlt: string) => {
    if (!(node instanceof HTMLImageElement) || !image?.url) return;
    node.src = image.url;
    node.alt = image.altText || fallbackAlt;
    if (image.width) node.width = image.width;
    if (image.height) node.height = image.height;
    node.removeAttribute('srcset');
  };
  const bindCard = (card: Element, product: PreviewKodefyProduct) => {
    const handle = product.handle || '';
    const variant = firstVariant(product);
    card.removeAttribute('data-kodefy-template');
    if (handle) card.setAttribute('data-kodefy-product-handle', handle);
    card.setAttribute('data-kodety-preview-item-id', product.id || handle || product.title || 'product');
    card.setAttribute('data-kodefy-builder-product', 'true');
    setText(card, '[data-kodefy-product-title]', product.title || 'Produto');
    setText(card, '[data-kodefy-product-vendor]', product.vendor || product.productType || 'Shopify');
    setText(card, '[data-kodefy-product-price]', money(productPrice(product)));
    card.querySelectorAll('[data-kodefy-product-link]').forEach(link => {
      if (handle) link.setAttribute('href', route('product', handle));
    });
    applyImage(card.querySelector('[data-kodefy-product-image]'), productImage(product), product.title || 'Produto');
    card.querySelectorAll<HTMLElement>('[data-kodefy-add]').forEach(button => {
      button.dataset.variantId = variant?.id || '';
      button.dataset.productHandle = handle;
      if (button instanceof HTMLButtonElement) {
        button.disabled = !variant?.availableForSale;
        if (button.disabled) button.textContent = 'Indisponível';
      }
    });
    card.querySelectorAll<HTMLElement>('[data-kodefy-wishlist-toggle]').forEach(button => {
      button.dataset.productHandle = handle;
    });
  };
  const renderCards = (root: Element, availableProducts = products) => {
    const template = root.querySelector('[data-kodefy-product-card]');
    if (!template) return;
    const limit = Math.max(1, Math.min(50, Number(root.getAttribute('data-limit')) || 12));
    const fragment = document.createDocumentFragment();
    availableProducts.slice(0, limit).forEach(product => {
      const card = template.cloneNode(true) as Element;
      bindCard(card, product);
      fragment.appendChild(card);
    });
    root.replaceChildren(fragment);
    root.setAttribute('data-kodefy-ready', 'true');
    root.setAttribute('data-kodefy-builder-snapshot', payload.syncedAt || 'true');
  };

  const listRoots = new Set<Element>();
  document.querySelectorAll(
    '[data-kodefy-products], [data-kodefy-search-results], [data-kodefy-wishlist-products]',
  ).forEach(root => listRoots.add(root));
  listRoots.forEach(root => renderCards(root));

  const collections = Array.isArray(payload.collections?.nodes) ? payload.collections.nodes : [];
  document.querySelectorAll('[data-kodefy-collection]').forEach(root => {
    const requestedHandle = root.getAttribute('data-handle') || root.getAttribute('data-collection-handle') || '';
    const collection = collections.find(candidate => candidate.handle === requestedHandle) || collections[0] || null;
    if (collection) {
      setText(root, '[data-kodefy-collection-title]', collection.title || 'Coleção');
      setText(root, '[data-kodefy-collection-description]', collection.description || '');
      applyImage(root.querySelector('[data-kodefy-collection-image]'), collection.image || null, collection.title || 'Coleção');
    }
    const handles = new Set((collection?.products?.nodes || []).map(product => product.handle).filter(Boolean));
    const collectionProducts = handles.size
      ? products.filter(product => product.handle && handles.has(product.handle))
      : products;
    const productsRoot = root.querySelector('[data-kodefy-collection-products]');
    if (productsRoot) renderCards(productsRoot, collectionProducts.length ? collectionProducts : products);
    root.setAttribute('data-kodefy-ready', 'true');
    root.setAttribute('data-kodefy-builder-snapshot', payload.syncedAt || 'true');
  });

  document.querySelectorAll('[data-kodefy-product-detail]').forEach(root => {
    const requestedHandle = root.getAttribute('data-handle') || root.getAttribute('data-product-handle') || '';
    const product = products.find(candidate => candidate.handle === requestedHandle) || products[0];
    if (!product) return;
    const variant = firstVariant(product);
    const image = variant?.image || productImage(product);
    root.setAttribute('data-kodefy-ready', 'true');
    root.setAttribute('data-kodefy-builder-snapshot', payload.syncedAt || 'true');
    if (product.handle) root.setAttribute('data-product-handle', product.handle);
    setText(root, '[data-kodefy-product-title]', product.title || 'Produto');
    setText(root, '[data-kodefy-product-vendor]', product.vendor || product.productType || 'Shopify');
    setText(root, '[data-kodefy-product-price]', money(variant?.price || productPrice(product)));
    const compare = root.querySelector<HTMLElement>('[data-kodefy-product-compare-price]');
    if (compare) {
      compare.textContent = money(variant?.compareAtPrice);
      compare.hidden = !variant?.compareAtPrice;
    }
    const description = root.querySelector('[data-kodefy-product-description]');
    if (description && (product.descriptionHtml || product.description)) {
      const template = document.createElement('template');
      template.innerHTML = product.descriptionHtml || product.description || '';
      template.content.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
      template.content.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(attribute => {
          if (/^on/i.test(attribute.name) || attribute.name === 'style') node.removeAttribute(attribute.name);
        });
      });
      description.replaceChildren(template.content.cloneNode(true));
    }
    applyImage(root.querySelector('[data-kodefy-gallery-main]'), image, product.title || 'Produto');
    const select = root.querySelector<HTMLSelectElement>('[data-kodefy-variant]');
    if (select) {
      const options = document.createDocumentFragment();
      (product.variants?.nodes || []).forEach(candidate => {
        const option = document.createElement('option');
        option.value = candidate.id || '';
        option.textContent = `${candidate.title || 'Opção'} — ${money(candidate.price)}${candidate.availableForSale ? '' : ' · Indisponível'}`;
        option.disabled = !candidate.availableForSale;
        option.selected = candidate === variant;
        options.appendChild(option);
      });
      select.replaceChildren(options);
    }
    const inventory = root.querySelector('[data-kodefy-inventory]');
    if (inventory) {
      const quantity = Number(variant?.quantityAvailable);
      inventory.textContent = !variant?.availableForSale
        ? 'Sem estoque'
        : Number.isFinite(quantity) && quantity <= 5
          ? `Últimas ${quantity} unidades`
          : 'Em estoque';
    }
    root.querySelectorAll<HTMLElement>('[data-kodefy-add]').forEach(button => {
      button.dataset.variantId = variant?.id || '';
      button.dataset.productHandle = product.handle || '';
      if (button instanceof HTMLButtonElement) button.disabled = !variant?.availableForSale;
    });
  });
}

function dirname(path: string) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function normalizeAssetPath(path: string) {
  const stack: string[] = [];
  path.replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  return stack.join('/');
}

function motionFrozenSvgBytes(file: HtmlProjectFile) {
  const input = file.text ?? new TextDecoder().decode(file.data || new Uint8Array());
  try {
    const svg = new DOMParser().parseFromString(input, 'image/svg+xml');
    if (svg.querySelector('parsererror')) throw new Error('Invalid SVG');
    svg.querySelectorAll('script, animate, animateMotion, animateTransform, discard, set')
      .forEach(element => element.remove());
    svg.querySelectorAll('*').forEach(element => {
      Array.from(element.attributes).forEach(attribute => {
        if (/^on[a-z]/i.test(attribute.name)) element.removeAttribute(attribute.name);
      });
    });
    const style = svg.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = '*,*::before,*::after{animation:none;animation-play-state:paused;transition:none}';
    svg.documentElement.insertBefore(style, svg.documentElement.firstChild);
    return new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
  } catch {
    return new TextEncoder().encode(input);
  }
}

/**
 * Vite serves `public/foo.png` as `/foo.png`, while the Builder deliberately
 * retains the original project tree. Static preview rewriting therefore
 * records the canonical file as `public/foo.png`, but runtime-created elements
 * continue to use the authored web-root path. Keep this mapping explicit so
 * every binary consumer (img/video/font/fetch/etc.) reaches the same file.
 */
export function runtimeAssetPathAliases(project: HtmlProject, canonicalPaths: string[]) {
  const aliases: Record<string, string> = {};
  const root = normalizeAssetPath(project.previewRootPath ?? project.rootPath ?? '');
  projectPublicDirectoryNames(project).forEach(directory => {
    const publicPrefix = `${root ? `${root}/` : ''}${directory}/`;
    canonicalPaths.forEach(rawCanonical => {
      const canonical = normalizeAssetPath(rawCanonical);
      if (!canonical.startsWith(publicPrefix)) return;
      const relative = canonical.slice(publicPrefix.length);
      if (!relative) return;
      aliases[normalizeAssetPath(`${root ? `${root}/` : ''}${relative}`)] = rawCanonical;
    });
  });
  return aliases;
}

/**
 * Paths that authored runtime code may request after the HTML/module graph was
 * built. Keeping only this lightweight manifest in srcdoc lets the iframe ask
 * for a dynamic frame, JSON file or detached Image source on demand instead of
 * cloning every large project asset into every canvas up front.
 */
const runtimeAssetAvailablePathCache = new WeakMap<object, Map<string, string[]>>();

function cachedRuntimeAssetAvailablePaths(project: HtmlProject) {
  const root = normalizeAssetPath(project.previewRootPath ?? project.rootPath ?? '');
  let roots = runtimeAssetAvailablePathCache.get(project.files);
  if (!roots) {
    roots = new Map();
    runtimeAssetAvailablePathCache.set(project.files, roots);
  }
  const cached = roots.get(root);
  if (cached) return cached;
  const paths = Object.keys(project.files).filter(rawPath => {
    const path = normalizeAssetPath(rawPath);
    const relative = root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? path.slice(root.length + 1)
      : path;
    const lower = relative.toLowerCase();
    const basename = lower.split('/').pop() || '';
    if (
      lower.startsWith('.incode/')
      || lower.startsWith('kodety-build/')
      || lower.startsWith('node_modules/')
      || lower.startsWith('.git/')
    ) return false;
    return !(
      /^package(?:-lock)?\.json$/.test(basename)
      || /^(?:vite|vitest|webpack|rollup|tsconfig|jsconfig)\b.*\.(?:[cm]?[jt]s|json)$/.test(basename)
    );
  });
  roots.set(root, paths);
  return paths;
}

export function runtimeAssetAvailablePaths(project: HtmlProject) {
  // Public inspection callers may sort/filter this list. Keep the cache owned
  // by preview construction immutable from the outside.
  return [...cachedRuntimeAssetAvailablePaths(project)];
}

export function buildElementTree(source: string): EditorElement[] {
  const document = new DOMParser().parseFromString(source, 'text/html');

  const editable = (element: Element) => !['script', 'style', 'link', 'meta', 'noscript', 'template'].includes(element.tagName.toLowerCase());
  const isTechnicalImportNode = (element: Element) => {
    const id = element.id.toLowerCase();
    const classes = Array.from(element.classList, value => value.toLowerCase());
    // Framer appends an enormous, aria-hidden SVG symbol warehouse after the
    // real page. It is runtime infrastructure, not an authored layer. Parsing
    // it into the Layers panel both hides the useful root in noise and can
    // synchronously allocate tens of thousands of editor nodes.
    if (id === 'svg-templates' || id === 'template-overlay' || id === '__framer__handoverdata') return true;
    if (classes.includes('svg-templates') || element.hasAttribute('data-framer-svg-template')) return true;
    return false;
  };
  const walkMany = (element: Element, path: string): EditorElement[] => {
    if (!editable(element) || isTechnicalImportNode(element)) return [];
    // An SVG is one editable visual layer. Exposing every path/clipPath/defs
    // child adds thousands of rows on Framer pages without giving the author a
    // useful HTML-level editing target.
    const children = element.tagName.toLowerCase() === 'svg'
      ? []
      : Array.from(element.children).flatMap((child, index) =>
        walkMany(child, path ? `${path}/${index}` : String(index)),
      );
    const tag = element.tagName.toLowerCase();
    // A BR is meaningful inside its text host, but it has no independent
    // visual/style editing surface. Keep its real child index in every sibling
    // path while omitting only the noisy Layers row.
    if (tag === 'br') return [];
    const text = children.length ? '' : (element.textContent || '').trim();
    return [{
      path, tag, id: element.id, classes: Array.from(element.classList), text,
      hasElementChildren: children.length > 0,
      label: element.getAttribute('data-label') || element.id || element.classList[0] || text.slice(0, 28) || tag,
      attributes: Object.fromEntries(Array.from(element.attributes)
        .filter(attr => !attr.name.startsWith('data-kodety-liquid-'))
        .map(attr => [attr.name, attr.value])),
      children,
    }];
  };
  return walkMany(document.body, '');
}

function runtimeAssetPlaceholder(path: string) {
  return `data:,kodety-runtime-asset-${encodeURIComponent(path)}`;
}

/**
 * Prepares an authored stylesheet for use inside the srcdoc canvas. Live CSS
 * edits must resolve assets exactly like the initial preview; otherwise
 * relative @font-face and background URLs resolve against srcdoc and silently
 * fall back even though Preview and the published site remain correct.
 */
export function resolvePreviewStylesheet(project: HtmlProject, cssPath: string, cssText: string) {
  const objectUrls: string[] = [];
  const missingAssets = new Set<string>();
  const urlCache = new Map<string, string>();
  const rootPath = project.previewRootPath ?? project.rootPath ?? dirname(project.mainHtmlPath);
  const findFile = (path: string) => {
    const canonical = projectPublicFilePath(project, path);
    return canonical ? project.files[canonical] : undefined;
  };
  const urlFor = (path: string) => {
    const canonical = projectPublicFilePath(project, path);
    if (!canonical) {
      missingAssets.add(path);
      return null;
    }
    const cached = urlCache.get(canonical);
    if (cached) return cached;
    const file = project.files[canonical];
    const svgFrozen = (
      /image\/svg\+xml/i.test(file.mimeType)
      || /\.svg(?:[?#]|$)/i.test(canonical)
    );
    const bytes = svgFrozen
      ? motionFrozenSvgBytes(file)
      : file.data ?? new TextEncoder().encode(file.text ?? '');
    if (file.data) {
      // Live CSS is posted into an opaque-origin iframe. A Blob URL created in
      // this parent realm cannot be loaded there, regardless of file size.
      // Use the same transferable marker as the initial preview so the iframe
      // can reuse/request its own local Blob before applying @font-face.
      const placeholder = runtimeAssetPlaceholder(canonical);
      urlCache.set(canonical, placeholder);
      return placeholder;
    }
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const url = `data:${file.mimeType};base64,${btoa(binary)}`;
    urlCache.set(canonical, url);
    return url;
  };
  const resolveCss = (css: string, currentCssPath: string, visited = new Set<string>()): string => {
    if (visited.has(currentCssPath)) return '';
    const nextVisited = new Set(visited).add(currentCssPath);
    const withImports = inlinePreviewCssImports(css, importValue => {
      const importPath = resolveProjectPath(currentCssPath, importValue, rootPath);
      const imported = importPath ? findFile(importPath)?.text : null;
      if (!importPath || imported == null) {
        if (importPath) missingAssets.add(importPath);
        return null;
      }
      return resolveCss(imported, importPath, nextVisited);
    });
    return rewriteCssAssetUrls(withImports, rawValue => {
      const value = rawValue.trim();
      const assetPath = resolveProjectPath(currentCssPath, value, rootPath);
      const url = assetPath ? urlFor(assetPath) : null;
      const hash = value.includes('#') ? `#${value.split('#').slice(1).join('#')}` : '';
      return url ? `${url}${hash}` : null;
    });
  };
  return {
    cssText: resolveCss(cssText, cssPath),
    objectUrls,
    missingAssets: Array.from(missingAssets),
  };
}

interface ProjectFontPreviewStylesheet {
  cssText: string;
  assetPaths: string[];
  families: string[];
}

function normalizedFontFamilyKey(value: string) {
  return value
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function safeFontDescriptor(value: string | undefined, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized && !/[;{}]/.test(normalized) ? normalized : fallback;
}

/**
 * Builds the project-font sheet used by the opaque iframe.
 *
 * The application-wide font store owns parent-document Blob URLs, which an
 * opaque srcdoc sandbox cannot read. The preview therefore emits the same
 * faces with runtime-asset placeholders; transferred binaries are replaced by
 * iframe-owned Blob URLs before the canvas is revealed.
 *
 * Families form an alias graph. A project commonly declares only one regular
 * face as "Rubrika Neue Haas", while the remaining ZIP files expose the
 * internal family "Neue Haas Grotesk Display". Emitting every face under every
 * name in that connected component gives the authored canonical name all
 * weights/styles instead of asking Chromium to synthesize the sole declared
 * face.
 */
export function createProjectFontPreviewStylesheet(
  project: HtmlProject,
  resolveLocalFontUrl: (path: string) => string | null,
): ProjectFontPreviewStylesheet {
  const catalog = discoverProjectFonts(project);
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const current = parent.get(key);
    if (!current) {
      parent.set(key, key);
      return key;
    }
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  catalog.fonts.forEach(font => {
    const key = normalizedFontFamilyKey(font.family);
    if (!key) return;
    find(key);
    font.aliases.forEach(alias => {
      const aliasKey = normalizedFontFamilyKey(alias);
      if (aliasKey) union(key, aliasKey);
    });
  });

  const components = new Map<string, typeof catalog.fonts>();
  catalog.fonts.forEach(font => {
    const key = normalizedFontFamilyKey(font.family);
    if (!key) return;
    const root = find(key);
    const members = components.get(root) || [];
    members.push(font);
    components.set(root, members);
  });

  const assetPaths = new Set<string>();
  const allFamilies = new Set<string>();
  const emittedRules = new Set<string>();
  const rules: string[] = [];
  components.forEach(componentFonts => {
    const names = new Map<string, string>();
    const faces: ProjectFontFace[] = [];
    componentFonts.forEach(font => {
      [font.family, ...font.aliases].forEach(name => {
        const key = normalizedFontFamilyKey(name);
        if (key && !names.has(key)) names.set(key, name.trim());
      });
      faces.push(...font.faces);
    });
    // Include face names as a final recovery for old drafts whose catalog
    // aliases were persisted before internal SFNT family discovery existed.
    faces.forEach(face => {
      const key = normalizedFontFamilyKey(face.family);
      if (key && !names.has(key)) names.set(key, face.family.trim());
    });

    faces.forEach(face => {
      const sources = face.sources.flatMap(source => {
        let url = '';
        if (source.filePath) {
          url = resolveLocalFontUrl(source.filePath) || '';
          if (url) assetPaths.add(source.filePath);
        } else if (/^(?:https?:|data:|blob:|\/\/)/i.test(source.url)) {
          url = source.url;
        }
        if (!url) return [];
        return [
          `url(${JSON.stringify(url)})${
            source.format ? ` format(${JSON.stringify(source.format)})` : ''
          }`,
        ];
      });
      if (!sources.length) return;
      names.forEach(name => {
        const declarations = [
          `font-family:${JSON.stringify(name)}`,
          `src:${sources.join(',')}`,
          `font-weight:${safeFontDescriptor(face.weight, '400')}`,
          `font-style:${safeFontDescriptor(face.style, 'normal')}`,
          face.stretch
            ? `font-stretch:${safeFontDescriptor(face.stretch)}`
            : '',
          `font-display:${safeFontDescriptor(face.display, 'swap')}`,
          face.unicodeRange
            ? `unicode-range:${safeFontDescriptor(face.unicodeRange)}`
            : '',
        ].filter(Boolean);
        const rule = `@font-face{${declarations.join(';')}}`;
        if (emittedRules.has(rule)) return;
        emittedRules.add(rule);
        rules.push(rule);
        allFamilies.add(name);
      });
    });
  });

  return {
    cssText: rules.join('\n'),
    assetPaths: Array.from(assetPaths),
    families: Array.from(allFamilies),
  };
}

interface ProjectInstalledFontReferenceCacheEntry {
  installedFonts: Font[];
  referencedFonts: Font[];
}

// Page navigation retains the exact project.files snapshot. Public CSS/runtime
// sources can be large, and fontsReferencedBySources joins all of them into a
// second giant string. Cache that project-wide half of font discovery by the
// immutable files object; each page build then scans only its active HTML.
const projectInstalledFontReferenceCache = new WeakMap<
  object,
  Map<string, ProjectInstalledFontReferenceCacheEntry>
>();

function projectReferencedInstalledFonts(project: HtmlProject, installedFonts: Font[]) {
  let roots = projectInstalledFontReferenceCache.get(project.files);
  if (!roots) {
    roots = new Map();
    projectInstalledFontReferenceCache.set(project.files, roots);
  }
  const root = project.previewRootPath ?? project.rootPath ?? '';
  const cached = roots.get(root);
  if (cached?.installedFonts === installedFonts) return cached.referencedFonts;
  const sources = Object.values(project.files).flatMap(file => {
    if (file.text === undefined) return [];
    const publicPath = projectPublicFilePath(project, file.path);
    return publicPath && /\.(?:css|mjs|cjs|js|jsx|ts|tsx)$/i.test(publicPath)
      ? [file.text]
      : [];
  });
  const referencedFonts = fontsReferencedBySources(installedFonts, sources);
  roots.set(root, { installedFonts, referencedFonts });
  return referencedFonts;
}

export function buildPreview(
  project: HtmlProject,
  inspectionEnabled = true,
  lockedPaths: string[] = [],
  contentEditing = false,
  selectedPaths: string[] = [],
  freezeMotion = false,
  initialCmsPreview?: PreviewCmsPayload | null,
  canvasGeneration = '',
  canvasRevision = 0,
  infiniteCanvasNavigation = false,
  initialScrollPositions?: PreviewScrollPositions,
  installedFonts: Font[] = [],
  initialKodefyPreview?: PreviewKodefyPayload | null,
  previewSiteUrl = '',
) {
  const metadata = readEditorMetadata(project);
  if (metadata.googleFonts?.length) {
    installedFonts = [
      ...installedFonts.filter(font => font.type !== 'google'),
      ...projectGoogleFonts(project, installedFonts),
    ];
  }
  const authoredSource = project.files[project.mainHtmlPath]?.text || '';
  // Match the publication compiler order exactly: custom-code placements are
  // part of the disposable runtime document, then every component instance in
  // that final authored surface is hydrated and receives scoped interactions.
  const authoredRuntimeSource = applyCustomCodeToHtml(
    authoredSource,
    metadata.customCode,
    project.mainHtmlPath,
  );
  const componentEditorCanvas = inspectionEnabled
    && /<body\b[^>]*\bdata-kodety-component-editor\s*=/i.test(authoredSource);
  const sourceHasHtmlComponentInstances = /\bdata-kodety-component-id\s*=/i.test(authoredRuntimeSource);
  const needsHtmlComponentLibrary = !inspectionEnabled || sourceHasHtmlComponentInstances;
  const htmlComponentLibrary = needsHtmlComponentLibrary
    ? normalizeHtmlComponentLibrary(metadata.components)
    : { version: 1 as const, components: [] };
  // Component masters are parsed once and shared by page hydration and the
  // runtime registry. Previously both stages rebuilt the same complete
  // library, and hydration rebuilt it again for every instance.
  // A plain master has no instances to hydrate and Design does not execute the
  // interactions runtime that consumes the registry. Do not parse/serialize
  // every component in the project merely to open that isolated canvas.
  const htmlComponentRuntime = htmlComponentLibrary.components.length
    && (!inspectionEnabled || sourceHasHtmlComponentInstances)
    ? runtimeHtmlComponentLibrary(project, htmlComponentLibrary)
    : undefined;
  // Component masters are the visual authority. Hydrate the disposable canvas
  // document from them on every canonical build so a stale/partial materialized
  // instance can never become an empty box until the master editor is opened.
  const componentSource = refreshHtmlComponentInstancesInSource(
    authoredRuntimeSource,
    project,
    htmlComponentLibrary,
    htmlComponentRuntime,
  );
  let source = attachHtmlComponentStylesheets(
    componentSource,
    project,
    htmlComponentLibrary,
    project.mainHtmlPath,
  );
  // Only executable Preview consumes this payload (through its interactions
  // runtime). Design already receives fully materialized instances, so a JSON
  // copy of every master only bloats and delays srcdoc parsing.
  if (!inspectionEnabled) {
    source = injectHtmlComponentRuntimeRegistry(
      source,
      project,
      htmlComponentLibrary,
      htmlComponentRuntime,
    );
  }
  // Interaction timelines are authored in a dedicated project document. The
  // editor needs its generated runtime in Design so the Timeline can scrub
  // and play against the frozen canvas. Authored project scripts remain
  // inert; only the explicitly marked editor runtime is allowed through.
  const pageAnimationDocument = readInteractionDocumentFile(
    project,
    project.mainHtmlPath,
  );
  const animationDocument = pageAnimationDocument
    ? compileHtmlComponentInstanceInteractions(
        project,
        componentSource,
        htmlComponentLibrary,
        pageAnimationDocument,
      )
    : pageAnimationDocument;
  if (animationDocument?.interactions.length) {
    source = patchInteractionDocument(
      source,
      animationDocument,
      false,
    );
  }
  // Design canvases remain inspection-only and must not mount a consent UI or
  // persist visitor choices. Executable Preview compiles consent only after
  // Custom Code, component hydration/registry and scoped interactions have all
  // reached the disposable HTML, matching the publication compiler boundary.
  if (!inspectionEnabled) {
    const consentPreviewProject = prepareCookieConsentProjectForTransport(
      {
        ...project,
        files: {
          [project.mainHtmlPath]: {
            ...(project.files[project.mainHtmlPath] || {
              path: project.mainHtmlPath,
              mimeType: 'text/html',
            }),
            text: source,
          },
        },
      },
      metadata.cookieConsent,
      { inlineAssets: true },
    );
    source = consentPreviewProject.files[project.mainHtmlPath]?.text || source;
  }
  const document = new DOMParser().parseFromString(source, 'text/html');
  if (isFramerProject(project)) {
    // Legacy WordPress drafts and read-only shares also need the resting
    // highlight fix. This is a disposable preview document, never a draft
    // mutation or a side effect of acquiring an editor lock.
    const cleanups = Array.from(document.querySelectorAll('style[data-kodety-framer-visual-cleanup]'));
    const cleanup = cleanups.shift() || document.createElement('style');
    cleanup.setAttribute('data-kodety-framer-visual-cleanup', '');
    cleanup.textContent = FRAMER_VISUAL_CLEANUP_CSS;
    cleanups.forEach(node => node.remove());
    if (!cleanup.parentNode) document.head.appendChild(cleanup);
  }
  // Preserve provenance for authored inline <style> blocks before the editor
  // installs any projection/inspection stylesheets. Linked local styles receive
  // data-editor-source below; both markers let the CSSOM owner probe exclude
  // Builder chrome while still seeing every authored rule.
  document.querySelectorAll('style').forEach((style, index) => {
    style.setAttribute('data-editor-embedded-source', String(index));
  });
  // Locale options are runtime data. Materialize them in the real Preview,
  // while Design mode keeps the authored template so generated options never
  // acquire source paths that do not exist in the editable HTML.
  if (!inspectionEnabled) materializeNativeLocaleSelectors(document, project);
  // This preview-only baseline must precede every project stylesheet. Its zero
  // specificity makes it a fallback, never a replacement for an authored
  // sizing decision, and it also covers images inserted later by CMS/runtime.
  const proportionalImageDefaults = document.createElement('style');
  proportionalImageDefaults.setAttribute('data-kodety-proportional-image-defaults', '');
  proportionalImageDefaults.textContent = PROPORTIONAL_IMAGE_DEFAULTS_CSS;
  document.head.insertBefore(proportionalImageDefaults, document.head.firstChild);
  // Multi-step groups commonly carry an authored inline `display:grid/flex`.
  // That declaration can outrank the browser's native [hidden] presentation,
  // making every step visible in Design mode. Keep the semantic active step
  // authoritative without altering the author's layout for the visible group.
  const multiStepVisibility = document.createElement('style');
  multiStepVisibility.setAttribute('data-kodety-multistep-visibility', '');
  multiStepVisibility.textContent = 'form[data-kodety-multistep="true"] > [data-kodety-form-step][hidden]{display:none!important;}';
  document.head.insertBefore(multiStepVisibility, proportionalImageDefaults.nextSibling);
  if (componentEditorCanvas) {
    // Old component masters may still contain the former 100vh body style.
    // Project the master at intrinsic size only in its editor document; page
    // instances retain their authored fill/fixed sizing unchanged.
    const componentEditorProjection = document.createElement('style');
    componentEditorProjection.setAttribute('data-kodety-component-editor-projection-runtime', '');
    componentEditorProjection.textContent = 'html{width:100%;min-width:0;min-height:0;background:transparent!important;overflow-x:hidden;overflow-y:visible}body[data-kodety-component-editor]{display:flow-root!important;width:100%!important;max-width:100%!important;height:max-content!important;min-width:0!important;min-height:0!important;margin:0!important;box-sizing:border-box;background:transparent!important;overflow-x:hidden;overflow-y:visible}body[data-kodety-component-editor]>:first-child{position:relative!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;inset-block-start:auto!important;inset-block-end:auto!important;inset-inline-start:auto!important;inset-inline-end:auto!important}';
    document.head.appendChild(componentEditorProjection);
  }
  if (!inspectionEnabled && document.querySelector('[data-kodety-overlay]')) {
    // This guard is parsed before any surface markup, so even legacy HTML that
    // persisted an open state cannot flash over the page before the delegated
    // runtime synchronously normalizes every overlay to closed.
    const overlayBootGuard = document.createElement('style');
    overlayBootGuard.setAttribute('data-kodety-native-overlays-guard', '');
    overlayBootGuard.textContent = NATIVE_OVERLAY_BOOT_GUARD_CSS;
    document.head.insertBefore(overlayBootGuard, proportionalImageDefaults.nextSibling);
  }
  // Visibility set by the author is canonical. Runtime animation/CMS helpers
  // may temporarily reveal their own hidden nodes, but must never remove a
  // `hidden`/`aria-hidden` value that came from the editable source.
  document.querySelectorAll('[hidden]').forEach(element => {
    element.setAttribute('data-html-editor-original-hidden', '');
  });
  document.querySelectorAll('[aria-hidden]').forEach(element => {
    element.setAttribute(
      'data-html-editor-original-aria-hidden',
      element.getAttribute('aria-hidden') || '',
    );
  });
  const objectUrls: string[] = [];
  const missingAssets = new Set<string>();
  const urlCache = new Map<string, string>();
  const rootPath = project.previewRootPath ?? project.rootPath ?? dirname(project.mainHtmlPath);
  const findFile = (path: string) => {
    const canonical = projectPublicFilePath(project, path);
    return canonical ? project.files[canonical] : undefined;
  };
  const frozenSvgCache = new Map<string, Uint8Array>();
  const frozenSvgBytes = (canonical: string, file: HtmlProject['files'][string]) => {
    const cached = frozenSvgCache.get(canonical);
    if (cached) return cached;
    const bytes = motionFrozenSvgBytes(file);
    frozenSvgCache.set(canonical, bytes);
    return bytes;
  };
  const urlFor = (path: string, forceObjectUrl = false) => {
    const canonical = projectPublicFilePath(project, path);
    if (!canonical) {
      missingAssets.add(path);
      return null;
    }
    const cached = urlCache.get(canonical);
    if (cached) return cached;
    const file = project.files[canonical];
    const svgFrozen = freezeMotion && (
      /image\/svg\+xml/i.test(file.mimeType)
      || /\.svg(?:[?#]|$)/i.test(canonical)
    );
    const bytes = svgFrozen
      ? frozenSvgBytes(canonical, file)
      : file.data ?? new TextEncoder().encode(file.text ?? '');
    // Binary assets should never be serialized into srcdoc. Besides keeping the
    // document small, transferring blobs avoids repeating encoded bytes in
    // every responsive image candidate.
    if (!svgFrozen && (file.data || forceObjectUrl)) {
      // Every canvas is deliberately an opaque-origin sandbox. A blob URL
      // created by the authenticated parent document cannot be loaded there.
      // Keep srcdoc compact with a unique inert marker; once the bridge starts,
      // the parent transfers only referenced bytes and the iframe creates blobs
      // that belong to its isolated origin.
      const placeholder = runtimeAssetPlaceholder(canonical);
      urlCache.set(canonical, placeholder);
      return placeholder;
    }
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const url = `data:${file.mimeType};base64,${btoa(binary)}`;
    urlCache.set(canonical, url);
    return url;
  };

  const resolveCss = (css: string, cssPath: string, visited = new Set<string>()): string => {
    if (visited.has(cssPath)) return '';
    const nextVisited = new Set(visited).add(cssPath);
    const withImports = inlinePreviewCssImports(css, importValue => {
      const importPath = resolveProjectPath(cssPath, importValue, rootPath);
      const imported = importPath ? findFile(importPath)?.text : null;
      if (!importPath || imported == null) {
        if (importPath) missingAssets.add(importPath);
        return null;
      }
      return resolveCss(imported, importPath, nextVisited);
    });
    return rewriteCssAssetUrls(withImports, rawValue => {
      const value = rawValue.trim();
      const assetPath = resolveProjectPath(cssPath, value, rootPath);
      const url = assetPath ? urlFor(assetPath) : null;
      const hash = value.includes('#') ? `#${value.split('#').slice(1).join('#')}` : '';
      return url ? `${url}${hash}` : null;
    });
  };

  // The parent font store cannot be reused here: this document intentionally
  // has an opaque origin, so parent-created Blob URLs are unreadable. Rebuild
  // every discovered/inferred face with the same transferable placeholders as
  // images and other project assets. This also expands declared/internal
  // family aliases so every imported weight is available under the authored
  // canonical family.
  const projectFontPreview = createProjectFontPreviewStylesheet(
    project,
    path => urlFor(path),
  );
  const projectFontRuntimeAssetPaths = Array.from(new Set(
    projectFontPreview.assetPaths.map(path =>
      projectPublicFilePath(project, path) || path,
    ),
  ));
  if (projectFontPreview.cssText) {
    const projectFontsStyle = document.createElement('style');
    projectFontsStyle.setAttribute('data-html-editor-project-fonts', '');
    // Runtime-owned font files are represented by inert transfer markers while
    // srcdoc is parsed. Do not let the browser decode those marker strings as
    // fonts. The bridge enables this sheet only after every real Blob URL has
    // been installed inside this opaque-origin iframe.
    if (projectFontRuntimeAssetPaths.length) {
      projectFontsStyle.media = 'not all';
    }
    projectFontsStyle.textContent = projectFontPreview.cssText;
    document.head.appendChild(projectFontsStyle);
  }
  if (projectFontRuntimeAssetPaths.length) {
    document.documentElement.setAttribute('data-html-editor-fonts-pending', '');
  }

  const projectInstalledFonts = projectReferencedInstalledFonts(project, installedFonts);
  const pageInstalledFonts = fontsReferencedBySources(installedFonts, [source]);
  const referencedInstalledFonts = new Set([...projectInstalledFonts, ...pageInstalledFonts]);
  const surfaceInstalledFonts = installedFonts.filter(font => referencedInstalledFonts.has(font));

  // Installed Google fonts live in the parent application store, while Canvas
  // deliberately runs in an opaque-origin iframe. Materialize their links in
  // every srcdoc so a newly opened/background tab does not depend on whether
  // its font picker happened to initialize the parent document first. The
  // catalog itself can be large, so only materialize families referenced by
  // this surface or its public CSS/runtime sources.
  const fontStylesheetResources = getFontStylesheetResources(surfaceInstalledFonts);
  if (fontStylesheetResources.some(resource => resource.provider === 'google')) {
    const googlePreconnect = document.createElement('link');
    googlePreconnect.rel = 'preconnect';
    googlePreconnect.href = 'https://fonts.googleapis.com';
    googlePreconnect.setAttribute('data-html-editor-font-preconnect', '');
    document.head.appendChild(googlePreconnect);

    const staticPreconnect = document.createElement('link');
    staticPreconnect.rel = 'preconnect';
    staticPreconnect.href = 'https://fonts.gstatic.com';
    staticPreconnect.crossOrigin = 'anonymous';
    staticPreconnect.setAttribute('data-html-editor-font-preconnect', '');
    document.head.appendChild(staticPreconnect);

  }
  if (fontStylesheetResources.some(resource => resource.provider === 'adobe')) {
    const adobePreconnect = document.createElement('link');
    adobePreconnect.rel = 'preconnect';
    adobePreconnect.href = 'https://use.typekit.net';
    adobePreconnect.crossOrigin = 'anonymous';
    adobePreconnect.setAttribute('data-html-editor-font-preconnect', '');
    document.head.appendChild(adobePreconnect);
  }
  if (fontStylesheetResources.length) {
    fontStylesheetResources.forEach(resource => {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = resource.href;
      // A stylesheet in <head> blocks the classic editor bridge at the end of
      // body. Slow/offline Google Fonts therefore used to hold the buffered
      // frame on white even though all authored DOM was already available.
      // Fetch it non-blocking and enable it immediately after the first-content
      // signal; the retained canvas absorbs the later font metric settlement.
      stylesheet.media = 'print';
      stylesheet.setAttribute('data-html-editor-deferred-font', '');
      stylesheet.setAttribute('data-html-editor-font-stylesheet', '');
      stylesheet.setAttribute('data-html-editor-font-provider', resource.provider);
      stylesheet.setAttribute('data-html-editor-font-state', 'pending');
      if (resource.provider === 'google') {
        stylesheet.setAttribute('data-html-editor-deferred-google-font', '');
        stylesheet.setAttribute('data-html-editor-google-font', '');
        stylesheet.setAttribute('data-html-editor-google-font-state', 'pending');
      }
      stylesheet.addEventListener('load', () => {
        stylesheet.setAttribute('data-html-editor-font-state', 'loaded');
        if (resource.provider === 'google') {
          stylesheet.setAttribute('data-html-editor-google-font-state', 'loaded');
        }
      }, { once: true });
      stylesheet.addEventListener('error', () => {
        stylesheet.setAttribute('data-html-editor-font-state', 'error');
        if (resource.provider === 'google') {
          stylesheet.setAttribute('data-html-editor-google-font-state', 'error');
        }
      }, { once: true });
      document.head.appendChild(stylesheet);
    });
  }
  const installedFontClasses = buildFontClassesCss(surfaceInstalledFonts);
  if (installedFontClasses) {
    const classesStyle = document.createElement('style');
    classesStyle.setAttribute('data-html-editor-installed-font-classes', '');
    classesStyle.textContent = installedFontClasses;
    document.head.appendChild(classesStyle);
  }

  const encodeModule = (code: string) => {
    const bytes = new TextEncoder().encode(code);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return `data:text/javascript;base64,${btoa(binary)}`;
  };
  // A Framer export is a cyclic ESM graph. Recursively turning every file into
  // a data URL breaks as soon as A imports B and B imports A, because relative
  // imports have no useful base inside a data/blob module. Give every project
  // module a stable bare specifier and resolve the whole graph through one
  // import map instead. This also handles Framer's backtick dynamic imports.
  // Design freezes ordinary authored scripts. Building and base64-encoding the
  // complete ESM graph in that mode is pure waste unless a structural runtime
  // (Code Components / imported responsive layout) actually needs it. Large
  // imported sites can contain hundreds of chunks; skipping that graph makes
  // page/component surface switches paint without blocking the editor thread.
  const needsCanvasModuleGraph = !freezeMotion || Boolean(document.querySelector(
    '[data-coday-code-instance], script[data-coday-code-components-runtime], script[data-kodety-framer-responsive-runtime]',
  ));
  const modulePaths = needsCanvasModuleGraph
    ? Object.keys(project.files).filter(path => /\.(?:m?js)$/i.test(path) && typeof findFile(path)?.text === 'string')
    : [];
  const moduleSpecifiers = new Map(modulePaths.map((path, index) => [path, `@kodety-module/${index}`]));
  const moduleUrls = new Map<string, string>();
  const dependencyVersions = projectDependencyVersions(project);
  const bareModuleSpecifiers = new Set<string>();
  const moduleStylePaths = new Set<string>();
  const collectModuleSpecifier = (fromPath: string, specifier: string) => {
    if (isBareModuleSpecifier(specifier)) {
      bareModuleSpecifiers.add(specifier);
      return;
    }
    if (!/\.css(?:[?#]|$)/i.test(specifier)) return;
    const resolved = resolveProjectPath(fromPath, specifier, rootPath);
    const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
    if (canonical && findFile(canonical)?.text !== undefined) moduleStylePaths.add(canonical);
  };
  modulePaths.forEach(path => {
    const code = findFile(path)?.text || '';
    code.replace(/((?:from|import)\s*)(["'`])([^"'`]+)\2/g, (_match, _before: string, _quote: string, specifier: string) => {
      collectModuleSpecifier(path, specifier);
      return _match;
    });
    code.replace(/(import\s*\(\s*)(["'`])([^"'`]+)\2(\s*\))/g, (_match, _before: string, _quote: string, specifier: string) => {
      collectModuleSpecifier(path, specifier);
      return _match;
    });
  });
  document.querySelectorAll<HTMLScriptElement>('script[type="module"]:not([src])').forEach(script => {
    const code = script.textContent || '';
    code.replace(/((?:from|import)\s*)(["'`])([^"'`]+)\2/g, (_match, _before: string, _quote: string, specifier: string) => {
      collectModuleSpecifier(project.mainHtmlPath, specifier);
      return _match;
    });
  });
  moduleStylePaths.forEach(path => {
    const css = findFile(path)?.text;
    if (css === undefined) return;
    const style = document.createElement('style');
    style.dataset.editorSource = path;
    style.setAttribute('data-kodety-coded-style', path);
    style.textContent = resolveCss(css, path);
    document.head.appendChild(style);
  });
  const hasCodeComponentModules = modulePaths.some(path => /(?:^|\/)\.coday\/components\//.test(path));
  let moduleRegistryReady = false;
  const canonicalModulePath = (path: string) => {
    if (moduleSpecifiers.has(path)) return path;
    const lower = path.toLowerCase();
    return modulePaths.find(candidate => candidate.toLowerCase() === lower) || null;
  };
  const resolveModuleDependency = (fromPath: string, specifier: string) => {
    const resolved = resolveProjectPath(fromPath, specifier, rootPath);
    const canonical = resolved ? canonicalModulePath(resolved) : null;
    if (canonical) return canonical;
    // Older drafts stored generated modules at the archive root even when the
    // authored pages lived below rootPath. Resolve their stable `.coday/...`
    // suffix so those projects recover in preview without requiring reimport.
    const clean = specifier.replaceAll('\\', '/').split('#')[0].split('?')[0];
    const marker = clean.toLowerCase().indexOf('.coday/');
    if (marker < 0) return null;
    const suffix = clean.slice(marker).toLowerCase();
    return modulePaths.find(candidate => {
      const normalized = candidate.toLowerCase();
      return normalized === suffix || normalized.endsWith(`/${suffix}`);
    }) || null;
  };
  const ensureModuleRegistry = () => {
    if (moduleRegistryReady) return;
    moduleRegistryReady = true;
    const imports: Record<string, string> = hasCodeComponentModules
      ? codeComponentReactImportMap(encodeModule(CODE_COMPONENT_REACT_RUNTIME_SOURCE))
      : {};
    addPreviewBareModuleImports(imports, bareModuleSpecifiers, dependencyVersions);
    modulePaths.forEach(path => {
      const file = findFile(path);
      if (!file?.text) return;
      const replaceSpecifier = (specifier: string) => {
        if (specifier.includes('${')) return specifier;
        const dependencyPath = resolveModuleDependency(path, specifier);
        return dependencyPath ? moduleSpecifiers.get(dependencyPath) || specifier : specifier;
      };
      let code = replaceViteImportMetaEnv(file.text);
      code = code.replace(
        /(^|[;\n]\s*)import\s*(["'])([^"']+\.css(?:[?#][^"']*)?)\2\s*;?/gm,
        '$1/* CSS extracted by Kodety preview */',
      );
      code = code.replace(/((?:from|import)\s*)(["'`])([^"'`]+)\2/g, (_match, before: string, quote: string, specifier: string) => `${before}${quote}${replaceSpecifier(specifier)}${quote}`);
      code = code.replace(/(import\s*\(\s*)(["'`])([^"'`]+)\2(\s*\))/g, (_match, before: string, quote: string, specifier: string, after: string) => `${before}${quote}${replaceSpecifier(specifier)}${quote}${after}`);
      code = code.replace(/new\s+URL\(\s*(["'`])([^"'`]+)\1\s*,\s*import\.meta\.url\s*\)/g, (match, _quote: string, assetValue: string) => {
        if (assetValue.includes('${')) return match;
        const assetPath = resolveProjectPath(path, assetValue, rootPath);
        const url = assetPath ? urlFor(assetPath, true) : null;
        return url ? `new URL(${JSON.stringify(url)})` : match;
      });
      // Framer component chunks also keep image/video/font paths as ordinary
      // string props (rather than new URL()). Resolve only strings that point
      // to a real local project asset. This records them for the selective
      // iframe transfer and gives runtime-created elements a replaceable alias.
      code = code.replace(/(["'`])([^"'`\r\n]+)\1/g, (match, quote: string, assetValue: string) => {
        if (assetValue.includes('${')) return match;
        const assetPath = resolveProjectPath(path, assetValue, rootPath);
        const assetFile = assetPath ? findFile(assetPath) : null;
        // Resolve by actual project membership, not by an extension allowlist.
        // This covers modern/less-common uploads (AVIF sequences, WASM-backed
        // media, model formats, custom font containers, and future formats)
        // while leaving authored source-module strings untouched.
        if (
          !assetPath
          || !assetFile
          || (!assetFile.data && /\.(?:[cm]?[jt]sx?|css|html?)$/i.test(assetPath))
        ) return match;
        const url = urlFor(assetPath, true);
        return url ? `${quote}${url}${quote}` : match;
      });
      // Active Preview intentionally runs in an opaque sandbox. Blob URLs made
      // by the parent are unreadable there, while data modules remain portable.
      // Each module is encoded once in the import map, so cyclic graphs no
      // longer duplicate entire dependency subtrees.
      const url = encodeModule(code);
      moduleUrls.set(path, url);
      const specifier = moduleSpecifiers.get(path);
      if (specifier) imports[specifier] = url;
    });
    if (Object.keys(imports).length) {
      const importMap = document.createElement('script');
      importMap.type = 'importmap';
      importMap.setAttribute('data-html-editor-module-map', '');
      importMap.textContent = JSON.stringify({ imports });
      document.head.insertBefore(importMap, document.head.firstChild);
    }
  };
  const moduleUrlFor = (path: string): string | null => {
    ensureModuleRegistry();
    const canonical = canonicalModulePath(path);
    return canonical ? moduleUrls.get(canonical) || null : urlFor(path);
  };

  // Code Component runtimes are inline modules. They can be the only module
  // script in a document, so waiting for a script[src] rewrite would leave the
  // React import map unregistered. Build the registry before serializing the
  // preview and point inline local imports at the same stable module aliases.
  if (hasCodeComponentModules || document.querySelector('script[type="module"]:not([src])')) {
    ensureModuleRegistry();
    // The authored map points at deploy-time relative URLs. The disposable
    // opaque-origin srcdoc must use the self-contained data modules above.
    document.querySelectorAll('script[data-coday-code-components-importmap]').forEach(script => script.remove());
    document.querySelectorAll<HTMLScriptElement>('script[type="module"]:not([src])').forEach(script => {
      const replaceSpecifier = (specifier: string) => {
        if (specifier.includes('${')) return specifier;
        const dependencyPath = resolveModuleDependency(project.mainHtmlPath, specifier);
        return dependencyPath ? moduleSpecifiers.get(dependencyPath) || specifier : specifier;
      };
      let code = replaceViteImportMetaEnv(script.textContent || '');
      code = code.replace(
        /(^|[;\n]\s*)import\s*(["'])([^"']+\.css(?:[?#][^"']*)?)\2\s*;?/gm,
        '$1/* CSS extracted by Kodety preview */',
      );
      code = code.replace(/((?:from|import)\s*)(["'`])([^"'`]+)\2/g, (_match, before: string, quote: string, specifier: string) => `${before}${quote}${replaceSpecifier(specifier)}${quote}`);
      code = code.replace(/(import\s*\(\s*)(["'`])([^"'`]+)\2(\s*\))/g, (_match, before: string, quote: string, specifier: string, after: string) => `${before}${quote}${replaceSpecifier(specifier)}${quote}${after}`);
      script.textContent = code;
    });
  }

  // Preview-only cleanup. A CSP authored for the deployed origin commonly
  // rejects the editor's self-contained data: assets. The original meta tag
  // remains untouched in the project source and in exported ZIPs.
  document.querySelectorAll('base, meta[http-equiv="Content-Security-Policy" i]').forEach(element => element.remove());

  // Third-party player documents inherit the Preview iframe's sandboxed-origin
  // flag. Vimeo/YouTube can therefore stay visually present while never
  // reaching the provider-specific `playing`/ready event that an authored page
  // uses to dismiss its own full-screen loader. Mirror Design's disposable
  // loader projection only for those player pages: the saved HTML, publication
  // and ordinary Preview pages keep their authored loading behavior unchanged.
  const externalPlayerPreview = !inspectionEnabled && Array.from(
    document.querySelectorAll('iframe[src], iframe[data-src], iframe[data-lazy-src]'),
  ).some(frame => {
    const source = frame.getAttribute('src')
      || frame.getAttribute('data-src')
      || frame.getAttribute('data-lazy-src')
      || '';
    if (!source.trim()) return false;
    try {
      const host = new URL(source, 'https://kodety-preview.invalid/').hostname.toLowerCase();
      return host === 'vimeo.com'
        || host.endsWith('.vimeo.com')
        || host === 'youtube.com'
        || host.endsWith('.youtube.com')
        || host === 'youtube-nocookie.com'
        || host.endsWith('.youtube-nocookie.com')
        || host === 'youtu.be'
        || host.endsWith('.youtu.be');
    } catch {
      return false;
    }
  });
  if (externalPlayerPreview) {
    const previewPlayerLoadingGateClass = /^(?:(?:is|has)[-_])?(?:(?:page|site|app)[-_])?(?:loading|preloading|loader[-_]active|preloader[-_]active)$|^(?:.+[-_])?(?:entrance|animation|motion)[-_]pending$/i;
    const previewPlayerLoadingOverlayClass = /(?:^|[-_])(?:page[-_])?(?:preloader|loader|transition[-_](?:overlay|screen))(?:$|[-_])/i;
    const releasePreviewPlayerLoadingGate = (element: Element | null | undefined) => {
      if (!element) return;
      Array.from(element.classList).forEach(className => {
        if (previewPlayerLoadingGateClass.test(className)) element.classList.remove(className);
      });
    };
    const markPreviewPlayerLoadingOverlays = (root: ParentNode | null | undefined) => {
      if (!root) return;
      const candidates = root.querySelectorAll(
        '[class*="loader" i], [class*="preloader" i], [class*="loading" i], '
        + '[class*="transition-overlay" i], [class*="transition-screen" i]',
      );
      candidates.forEach(element => {
        if (!Array.from(element.classList).some(className => previewPlayerLoadingOverlayClass.test(className))) return;
        element.setAttribute('data-html-editor-preview-player-loading-overlay', '');
        element.setAttribute('aria-hidden', 'true');
      });
    };

    document.documentElement.setAttribute('data-html-editor-preview-player-loader-bypass', '');
    document.documentElement.classList.add('app-ready');
    releasePreviewPlayerLoadingGate(document.documentElement);
    releasePreviewPlayerLoadingGate(document.body);
    markPreviewPlayerLoadingOverlays(document.body);

    const previewPlayerLoadingStyle = document.createElement('style');
    previewPlayerLoadingStyle.setAttribute('data-html-editor-preview-player-loading-style', '');
    previewPlayerLoadingStyle.textContent = `
      :root[data-html-editor-preview-player-loader-bypass]
      [data-html-editor-preview-player-loading-overlay] {
        display: none !important;
        pointer-events: none !important;
      }
    `;
    document.head.insertBefore(previewPlayerLoadingStyle, document.head.firstChild);

    // A framework may create its initial loader after parsing the authored
    // markup. Observe only through the first DOMContentLoaded paint, then leave
    // later route/interaction loaders entirely under project control.
    const previewPlayerLoadingBootstrap = document.createElement('script');
    previewPlayerLoadingBootstrap.setAttribute('data-html-editor-preview-player-loading-bootstrap', '');
    previewPlayerLoadingBootstrap.textContent = `(() => {
      const gateClass = /^(?:(?:is|has)[-_])?(?:(?:page|site|app)[-_])?(?:loading|preloading|loader[-_]active|preloader[-_]active)$|^(?:.+[-_])?(?:entrance|animation|motion)[-_]pending$/i;
      const overlayClass = /(?:^|[-_])(?:page[-_])?(?:preloader|loader|transition[-_](?:overlay|screen))(?:$|[-_])/i;
      const overlaySelector = '[class*="loader" i], [class*="preloader" i], [class*="loading" i], [class*="transition-overlay" i], [class*="transition-screen" i]';
      const releaseGate = element => {
        if (!element) return;
        Array.from(element.classList || []).forEach(className => {
          if (gateClass.test(className)) element.classList.remove(className);
        });
      };
      const markOverlays = root => {
        if (!root) return;
        const candidates = [];
        if (root instanceof Element && root.matches(overlaySelector)) candidates.push(root);
        root.querySelectorAll?.(overlaySelector).forEach(element => candidates.push(element));
        candidates.forEach(element => {
          if (!Array.from(element.classList || []).some(className => overlayClass.test(className))) return;
          element.setAttribute('data-html-editor-preview-player-loading-overlay', '');
          element.setAttribute('aria-hidden', 'true');
        });
      };
      const releaseInitialPlayerLoader = root => {
        document.documentElement.classList.add('app-ready');
        releaseGate(document.documentElement);
        releaseGate(document.body);
        markOverlays(root || document.body);
      };
      releaseInitialPlayerLoader(document);
      if (document.readyState !== 'loading') return;
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          if (mutation.type === 'attributes') releaseGate(mutation.target);
          mutation.addedNodes.forEach(node => {
            if (node instanceof Element) markOverlays(node);
          });
        });
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      addEventListener('DOMContentLoaded', () => {
        releaseInitialPlayerLoader(document);
        requestAnimationFrame(() => {
          releaseInitialPlayerLoader(document);
          observer.disconnect();
        });
      }, { once: true });
    })();`;
    document.head.insertBefore(previewPlayerLoadingBootstrap, document.head.firstChild);
  }

  // Keep animated layers in their readable resting state while authoring. The
  // bootstrap executes before project scripts and settles Web Animations/GSAP;
  // the stylesheet settles CSS animations and transitions. Neither is added to
  // the real Preview or to exported/published project files.
  if (freezeMotion) {
    document.documentElement.setAttribute('data-html-editor-motion-frozen', '');

    // Unlock the authored document before it ever reaches the iframe. Projects
    // commonly hide the whole body behind a loading class until their animation
    // bundle finishes. That bundle is deliberately inert in the design canvas,
    // so relying on another script to reveal the page can leave a permanently
    // blank canvas when script execution is restricted or delayed.
    const canvasLoadingGateClass = /^(?:(?:is|has)[-_])?(?:(?:page|site|app)[-_])?(?:loading|preloading|loader[-_]active|preloader[-_]active)$|^(?:.+[-_])?(?:entrance|animation|motion)[-_]pending$/i;
    const canvasLoadingOverlayClass = /(?:^|[-_])(?:page[-_])?(?:preloader|loader|transition[-_](?:overlay|screen))(?:$|[-_])/i;
    const releaseCanvasLoadingGate = (element: Element | null | undefined) => {
      if (!element) return;
      Array.from(element.classList).forEach(className => {
        if (canvasLoadingGateClass.test(className)) element.classList.remove(className);
      });
    };
    document.documentElement.classList.add('app-ready');
    releaseCanvasLoadingGate(document.documentElement);
    releaseCanvasLoadingGate(document.body);
    Array.from(document.body?.children || []).forEach(element => {
      if (Array.from(element.classList).some(className => canvasLoadingOverlayClass.test(className))) {
        element.setAttribute('data-html-editor-canvas-loading-overlay', '');
      }
    });
    // Loaders can be nested inside an app/root shell. They have no useful
    // state in a visual editor because the authored runtime that dismisses
    // them is intentionally inert. Mark every recognisable loading overlay in
    // the disposable canvas without touching the saved HTML.
    document.body?.querySelectorAll(
      '[class*="loader" i], [class*="preloader" i], [class*="loading" i], '
      + '[class*="transition-overlay" i], [class*="transition-screen" i]',
    ).forEach(element => {
      if (Array.from(element.classList).some(className => canvasLoadingOverlayClass.test(className))) {
        element.setAttribute('data-html-editor-canvas-loading-overlay', '');
      }
    });

    // Author scripts are intentionally inert in the design canvas. Animation
    // bundles frequently create their timelines during module evaluation,
    // before a library can be discovered or paused from the outside. Trying to
    // undo those mutations afterwards is inherently lossy (and can also race
    // with CMS cloning). The authoring canvas therefore renders the authored
    // HTML/CSS as a stable document and leaves every executable project script
    // for real Preview/publication, where it runs unchanged. Editor bridges are
    // appended later and remain executable.
    document.querySelectorAll('script').forEach(script => {
      // These editor-owned runtimes are safe in Design mode. Code Components
      // need their bootstrap to render the selected instance and the imported
      // Framer breakpoint switcher only chooses an SSR layout. The interaction
      // runtime and its bundled dependencies must also execute: authored motion
      // stays frozen, while Timeline play/scrub renders through the private
      // editor clock and explicitly marks only the active interaction targets.
      if (
        script.hasAttribute('data-kodety-framer-responsive-runtime')
        || script.hasAttribute('data-coday-code-components-runtime')
        || script.hasAttribute('data-kodety-interactions-runtime')
        || script.hasAttribute('data-kodety-interactions-dependency')
      ) {
        if (
          script.hasAttribute('data-kodety-framer-responsive-runtime')
          || script.hasAttribute('data-coday-code-components-runtime')
        ) {
          // Structural renderers get the private native clock for responsive
          // layout. The interaction runtime already owns its dedicated editor
          // clock, so rewriting its scheduler would break Timeline playback.
          script.textContent = (script.textContent || '')
            .replace(/\brequestAnimationFrame\b/g, 'window.__KODETY_EDITOR_STRUCTURAL_RAF__')
            .replace(/\bcancelAnimationFrame\b/g, 'window.__KODETY_EDITOR_STRUCTURAL_CANCEL_RAF__');
        }
        return;
      }
      const type = (script.getAttribute('type') || '').trim().toLowerCase();
      const executable = !type
        || type === 'module'
        || type === 'text/javascript'
        || type === 'application/javascript'
        || type === 'application/ecmascript'
        || type === 'text/ecmascript';
      if (!executable) return;
      script.setAttribute('data-html-editor-frozen-script-type', type || 'classic');
      script.setAttribute('type', 'application/x-kodety-frozen-script');
      script.removeAttribute('nomodule');
    });

    // Native media autoplay starts during parsing, before the iframe bridge can
    // call pause(). Embedded players are even more expensive: loading Vimeo or
    // YouTube in every visible/pending/passive srcdoc creates several complete
    // players and lets their cookie/feature-policy failures loop forever in the
    // console. Design owns a static projection only; real Preview/publication
    // keeps every authored URL and permission unchanged.
    const preserveCanvasMediaAttribute = (element: Element, name: string) => {
      if (!element.hasAttribute(name) || element.hasAttribute(`data-html-editor-original-${name}`)) return;
      element.setAttribute(`data-html-editor-original-${name}`, element.getAttribute(name) || '');
    };
    document.querySelectorAll('iframe').forEach(element => {
      ['src', 'srcdoc', 'allow', 'allowfullscreen'].forEach(name => preserveCanvasMediaAttribute(element, name));
      const authoredSource = element.getAttribute('src')
        || element.getAttribute('data-src')
        || element.getAttribute('data-lazy-src')
        || '';
      const provider = /vimeo/i.test(authoredSource)
        ? 'Vimeo'
        : /youtu(?:\.be|be\.com)/i.test(authoredSource)
          ? 'YouTube'
          : element.getAttribute('title')?.trim() || 'Embed';
      const providerLabel = provider.replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[character] || character);
      if (!element.hasAttribute('srcdoc')) element.setAttribute('data-html-editor-canvas-generated-srcdoc', '');
      element.setAttribute('data-html-editor-canvas-static-embed', provider);
      element.removeAttribute('src');
      element.removeAttribute('allow');
      element.removeAttribute('allowfullscreen');
      element.setAttribute('srcdoc', `<!doctype html><html><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#aaa;font:12px system-ui,sans-serif"><span>${providerLabel} · quadro estático no canvas</span></body></html>`);
    });
    document.querySelectorAll('video, audio').forEach(element => {
      preserveCanvasMediaAttribute(element, 'src');
      preserveCanvasMediaAttribute(element, 'autoplay');
      element.removeAttribute('src');
      element.removeAttribute('autoplay');
      element.setAttribute('data-html-editor-canvas-static-media', '');
      element.querySelectorAll('source').forEach(source => {
        preserveCanvasMediaAttribute(source, 'src');
        preserveCanvasMediaAttribute(source, 'srcset');
        source.removeAttribute('src');
        source.removeAttribute('srcset');
      });
    });
    document.querySelectorAll('svg animate, svg animateMotion, svg animateTransform, svg discard, svg set')
      .forEach(element => element.remove());

    // Inline event attributes are executable project code as well. Leaving an
    // onmouseover/onload handler active made motion appear "randomly" unfrozen
    // even though every <script> tag was inert.
    document.querySelectorAll('*').forEach(element => {
      Array.from(element.attributes).forEach(attribute => {
        if (!/^on[a-z]/i.test(attribute.name)) return;
        element.setAttribute(`data-html-editor-original-${attribute.name}`, attribute.value);
        element.removeAttribute(attribute.name);
      });
    });

    // Declarative Shadow DOM is created by the HTML parser before attachShadow
    // can be intercepted. Seed its template with the same invariant so CSS
    // animations, SMIL/media and inline handlers cannot escape the light-DOM
    // freeze once the shadow root is materialized.
    const freezeDeclarativeShadowTemplate = (template: HTMLTemplateElement) => {
      const shadowStyle = document.createElement('style');
      shadowStyle.setAttribute('data-html-editor-shadow-motion-freeze', '');
      shadowStyle.textContent = `
        :host, *, *::before, *::after {
          animation: none;
          animation-play-state: paused;
          transition: none;
          scroll-behavior: auto;
        }
      `;
      template.content.prepend(shadowStyle);
      template.content.querySelectorAll('script').forEach(script => {
        const type = (script.getAttribute('type') || '').trim().toLowerCase();
        if (type && !['module', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'].includes(type)) return;
        script.setAttribute('data-html-editor-frozen-script-type', type || 'classic');
        script.setAttribute('type', 'application/x-kodety-frozen-script');
        script.removeAttribute('src');
      });
      template.content.querySelectorAll('*').forEach(element => {
        Array.from(element.attributes).forEach(attribute => {
          if (!/^on[a-z]/i.test(attribute.name)) return;
          element.setAttribute(`data-html-editor-original-${attribute.name}`, attribute.value);
          element.removeAttribute(attribute.name);
        });
      });
      template.content.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]')
        .forEach(freezeDeclarativeShadowTemplate);
    };
    document.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]')
      .forEach(freezeDeclarativeShadowTemplate);

    const motionStyle = document.createElement('style');
    motionStyle.setAttribute('data-html-editor-motion-freeze', '');
    motionStyle.textContent = `
      :root[data-html-editor-motion-frozen] *,
      :root[data-html-editor-motion-frozen] *::before,
      :root[data-html-editor-motion-frozen] *::after {
        animation: none;
        animation-play-state: paused;
        transition-property: none;
        transition-duration: 0s;
        transition-delay: 0s;
        scroll-behavior: auto;
      }
      :root[data-html-editor-motion-frozen] [data-html-editor-canvas-loading-overlay] {
        display: none !important;
        pointer-events: none !important;
      }
      /*
       * Design owns pointer selection. An authored cursor:none!important
       * must never hide the system pointer or replace it with site chrome.
       * Editor controls are injected later and opt back into their own cursor.
       */
      :root[data-html-editor-motion-frozen] body *:not([class^="__kodety-"]):not([class*=" __kodety-"]) {
        cursor: auto !important;
      }
      :root[data-html-editor-motion-frozen] [data-html-editor-canvas-custom-cursor] {
        display: none !important;
        pointer-events: none !important;
      }
      /*
       * Chromium can otherwise raster a very tall, scaled iframe as one giant
       * surface and stop painting around its texture-size boundary. Runtime
       * geometry chooses bounded page regions for this marker. The
       * Opacity is enough to request an independent compositor surface in
       * Chromium. Avoid will-change:transform: even without an authored
       * transform it creates a containing block for fixed/absolute descendants
       * and would change the site's geometry inside the editor.
       */
      :root[data-html-editor-motion-frozen] [data-html-editor-canvas-paint-chunk] {
        will-change: opacity;
      }
      :root[data-html-editor-motion-frozen] body.is-loading,
      :root[data-html-editor-motion-frozen] body.is-loading * {
        animation: none;
        transition: none;
      }
      :root[data-html-editor-motion-frozen] body.is-loading:not([data-html-editor-canvas-author-visibility]):not([data-html-editor-canvas-rule-visibility]),
      :root[data-html-editor-motion-frozen] body.is-loading *:not([data-html-editor-canvas-author-visibility]):not([data-html-editor-canvas-rule-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *) {
        opacity: 1;
        visibility: visible;
        clip-path: none;
      }
      :root[data-html-editor-motion-frozen] [data-incode-animation-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-incode-motion-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-interaction-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-w-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-motion]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-framer-motion]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [class*="kodety-framer-motion-"]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-aos]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] .aos-init:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] .wow:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-collection]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-collection] *:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-bind]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-content]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-title]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-href]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-src]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-alt]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]) {
        opacity: 1;
      }
      :root[data-html-editor-motion-frozen] [data-incode-animation-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-incode-motion-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-interaction-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-w-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-motion]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-framer-motion]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [class*="kodety-framer-motion-"]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-aos]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] .aos-init:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] .wow:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-collection]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-collection] *:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-bind]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-content]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-title]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-href]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-src]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *),
      :root[data-html-editor-motion-frozen] [data-kodety-bind-alt]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-visibility] *):not([data-html-editor-canvas-rule-visibility] *) {
        visibility: visible;
      }
      :root[data-html-editor-motion-frozen] [data-w-id]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]),
      :root[data-html-editor-motion-frozen] [data-kodety-framer-motion]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]),
      :root[data-html-editor-motion-frozen] [class*="kodety-framer-motion-"]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]),
      :root[data-html-editor-motion-frozen] [data-aos]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]),
      :root[data-html-editor-motion-frozen] .aos-init:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]),
      :root[data-html-editor-motion-frozen] .wow:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]) {
        transform: none;
        translate: none;
        rotate: none;
        scale: none;
        filter: none;
        clip-path: none;
      }
      :root[data-html-editor-motion-frozen] [data-html-editor-canvas-reveal]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]):not([data-html-editor-canvas-author-property-content-visibility]):not([data-html-editor-canvas-rule-property-content-visibility]) {
        /* Entrance libraries put their initial frame directly on the node.
         * This canvas-only rule must beat that inline frame; the untouched
         * source is still used by Preview/export/publish. */
        opacity: 1 !important;
        visibility: visible !important;
        content-visibility: visible !important;
      }
      :root[data-html-editor-motion-frozen] [data-html-editor-canvas-reveal-motion]:not([data-html-editor-interaction-preview]):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]) {
        transform: none !important;
        translate: none !important;
        rotate: none !important;
        scale: none !important;
        filter: none !important;
        clip-path: none !important;
      }
    `;
    document.head.appendChild(motionStyle);

    // Component masters also use the editor-owned interaction runtime when a
    // Timeline is open. Keep the same private clock/bootstrap in both page and
    // component Design canvases; only authored page scripts stay quarantined.
    if (freezeMotion) {
      const motionBootstrap = document.createElement('script');
      motionBootstrap.setAttribute('data-html-editor-motion-freeze', '');
      motionBootstrap.textContent = `(() => {
      window.__KODETY_EDITOR_MOTION_FROZEN__ = true;
      document.documentElement.classList.add('app-ready');
      const nativeClock = {
        requestAnimationFrame: window.requestAnimationFrame?.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame?.bind(window),
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
        setInterval: window.setInterval.bind(window),
        clearInterval: window.clearInterval.bind(window),
        requestIdleCallback: window.requestIdleCallback?.bind(window),
        cancelIdleCallback: window.cancelIdleCallback?.bind(window),
      };
      window.__KODETY_EDITOR_NATIVE_CLOCK__ = nativeClock;
      window.__KODETY_EDITOR_STRUCTURAL_RAF__ = nativeClock.requestAnimationFrame;
      window.__KODETY_EDITOR_STRUCTURAL_CANCEL_RAF__ = nativeClock.cancelAnimationFrame;
      /*
       * Structural renderers retained by Design mode may use
       * IntersectionObserver for reveal/lazy initialization. The authoring
       * canvas represents the complete page, not one visitor scroll position,
       * so every observed target is delivered once as fully intersecting.
       * Preview/publication never receive this bootstrap.
       */
      const NativeIntersectionObserver = window.IntersectionObserver;
      class CanvasIntersectionObserver {
        constructor(callback, options = {}) {
          if (typeof callback !== 'function') throw new TypeError('IntersectionObserver callback is required');
          this.callback = callback;
          this.root = options.root || null;
          this.rootMargin = String(options.rootMargin || '0px');
          const threshold = Array.isArray(options.threshold) ? options.threshold : [options.threshold ?? 0];
          this.thresholds = Array.from(new Set(threshold.map(value => Math.max(0, Math.min(1, Number(value) || 0))))).sort();
          this.observed = new Set();
          this.pending = new Set();
          this.scheduled = false;
        }
        entry(target) {
          const rect = target.getBoundingClientRect();
          const rootRect = this.root?.getBoundingClientRect?.() || {
            x: 0, y: 0, top: 0, left: 0,
            right: innerWidth, bottom: innerHeight,
            width: innerWidth, height: innerHeight,
          };
          return {
            time: performance.now(),
            target,
            rootBounds: rootRect,
            boundingClientRect: rect,
            intersectionRect: rect,
            isIntersecting: true,
            intersectionRatio: 1,
          };
        }
        flush() {
          this.scheduled = false;
          const targets = Array.from(this.pending).filter(target => this.observed.has(target) && target.isConnected);
          this.pending.clear();
          if (targets.length) this.callback(targets.map(target => this.entry(target)), this);
        }
        schedule() {
          if (this.scheduled) return;
          this.scheduled = true;
          queueMicrotask(() => this.flush());
        }
        observe(target) {
          if (!(target instanceof Element)) throw new TypeError('IntersectionObserver target must be an Element');
          this.observed.add(target);
          this.pending.add(target);
          this.schedule();
        }
        unobserve(target) {
          this.observed.delete(target);
          this.pending.delete(target);
        }
        disconnect() {
          this.observed.clear();
          this.pending.clear();
        }
        takeRecords() {
          const targets = Array.from(this.pending).filter(target => this.observed.has(target) && target.isConnected);
          this.pending.clear();
          return targets.map(target => this.entry(target));
        }
      }
      if (NativeIntersectionObserver) {
        window.__KODETY_EDITOR_NATIVE_INTERSECTION_OBSERVER__ = NativeIntersectionObserver;
      }
      window.IntersectionObserver = CanvasIntersectionObserver;
      let frozenCallbackActive = false;
      // One public callback is enough for a retained Code Component to paint a
      // deferred first frame. Every Kodety-owned structural runtime uses the
      // private clock below; authored loops never receive a second tick.
      let publicClockBudget = 1;
      const oncePerCallback = new WeakSet();
      const pendingPublicFrames = new Set();
      const pendingPublicTimers = new Set();
      const pendingPublicIdleCallbacks = new Set();
      const scheduleFrozenCallback = (callback, scheduler, fallbackDelay = 0) => {
        if (
          typeof callback !== 'function'
          || oncePerCallback.has(callback)
          || !scheduler
          || publicClockBudget <= 0
        ) return 0;
        publicClockBudget -= 1;
        oncePerCallback.add(callback);
        return scheduler(timestamp => {
          if (frozenCallbackActive) return;
          frozenCallbackActive = true;
          try { callback(timestamp); } finally { frozenCallbackActive = false; }
        }, fallbackDelay);
      };
      // Canvas/application loops only receive one initialization frame/timer
      // per callback. Recurring callbacks never advance, while synchronous
      // component mounting can still draw its stable first frame.
      window.requestAnimationFrame = callback => {
        let id = 0;
        id = scheduleFrozenCallback(
          callback,
          handler => nativeClock.requestAnimationFrame?.(timestamp => {
            pendingPublicFrames.delete(id);
            handler(timestamp);
          }),
        );
        if (id) pendingPublicFrames.add(id);
        return id;
      };
      window.cancelAnimationFrame = id => {
        pendingPublicFrames.delete(id);
        nativeClock.cancelAnimationFrame?.(id);
      };
      window.setTimeout = (callback, delay = 0, ...args) => {
        if (
          typeof callback !== 'function'
          || oncePerCallback.has(callback)
          || publicClockBudget <= 0
        ) return 0;
        publicClockBudget -= 1;
        oncePerCallback.add(callback);
        let id = 0;
        id = nativeClock.setTimeout(() => {
          pendingPublicTimers.delete(id);
          if (frozenCallbackActive) return;
          frozenCallbackActive = true;
          try { callback(...args); } finally { frozenCallbackActive = false; }
        }, Math.max(0, Number(delay) || 0));
        pendingPublicTimers.add(id);
        return id;
      };
      window.clearTimeout = id => {
        pendingPublicTimers.delete(id);
        nativeClock.clearTimeout(id);
      };
      window.setInterval = () => 0;
      window.clearInterval = id => nativeClock.clearInterval(id);
      if (nativeClock.requestIdleCallback) {
        window.requestIdleCallback = callback => {
          let id = 0;
          id = scheduleFrozenCallback(
            callback,
            handler => nativeClock.requestIdleCallback?.(deadline => {
              pendingPublicIdleCallbacks.delete(id);
              handler(deadline);
            }),
          );
          if (id) pendingPublicIdleCallbacks.add(id);
          return id;
        };
        window.cancelIdleCallback = id => {
          pendingPublicIdleCallbacks.delete(id);
          nativeClock.cancelIdleCallback?.(id);
        };
      }
      const sealPublicClock = () => {
        publicClockBudget = 0;
        pendingPublicFrames.forEach(id => nativeClock.cancelAnimationFrame?.(id));
        pendingPublicTimers.forEach(id => nativeClock.clearTimeout(id));
        pendingPublicIdleCallbacks.forEach(id => nativeClock.cancelIdleCallback?.(id));
        pendingPublicFrames.clear();
        pendingPublicTimers.clear();
        pendingPublicIdleCallbacks.clear();
      };
      // Deferred/module evaluation completes before DOMContentLoaded. Close the
      // public page clock at that boundary so recursive loops that manufacture
      // a fresh closure each frame cannot consume an unbounded canvas loop.
      addEventListener('DOMContentLoaded', sealPublicClock, { once: true });
      addEventListener('pagehide', sealPublicClock, { once: true });
      const safeCanvasScript = script => script instanceof HTMLScriptElement && (
        script.hasAttribute('data-html-editor-motion-freeze')
        || script.hasAttribute('data-html-editor-bridge')
        || script.hasAttribute('data-kodety-native-overlays-runtime')
        || script.hasAttribute('data-kodety-interactions-runtime')
        || script.hasAttribute('data-kodety-interactions-dependency')
        || script.hasAttribute('data-kodety-framer-responsive-runtime')
        || script.hasAttribute('data-coday-code-components-runtime')
        || script.hasAttribute('data-kodety-infinite-canvas-runtime')
      );
      const executableScript = script => {
        const type = (script.getAttribute('type') || '').trim().toLowerCase();
        return !type
          || type === 'module'
          || type === 'text/javascript'
          || type === 'application/javascript'
          || type === 'application/ecmascript'
          || type === 'text/ecmascript';
      };
      const freezeScript = script => {
        if (!(script instanceof HTMLScriptElement) || safeCanvasScript(script) || !executableScript(script)) return;
        const type = (script.getAttribute('type') || '').trim().toLowerCase();
        if (!script.hasAttribute('data-html-editor-frozen-script-type')) {
          script.setAttribute('data-html-editor-frozen-script-type', type || 'classic');
        }
        if (script.hasAttribute('src') && !script.hasAttribute('data-html-editor-original-src')) {
          script.setAttribute('data-html-editor-original-src', script.getAttribute('src') || '');
        }
        script.type = 'application/x-kodety-frozen-script';
        script.removeAttribute('src');
        script.removeAttribute('nomodule');
      };
      const staticEmbedDocument = '<!doctype html><html><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#aaa;font:12px system-ui,sans-serif"><span>Embed · quadro estático no canvas</span></body></html>';
      const freezeCanvasEmbed = element => {
        if (!(element instanceof HTMLIFrameElement)) return;
        ['src', 'srcdoc', 'allow', 'allowfullscreen'].forEach(name => {
          if (element.hasAttribute(name) && !element.hasAttribute('data-html-editor-original-' + name)) {
            element.setAttribute('data-html-editor-original-' + name, element.getAttribute(name) || '');
          }
        });
        if (!element.hasAttribute('srcdoc')) element.setAttribute('data-html-editor-canvas-generated-srcdoc', '');
        element.setAttribute('data-html-editor-canvas-static-embed', element.getAttribute('data-html-editor-canvas-static-embed') || 'Embed');
        element.removeAttribute('src');
        element.removeAttribute('allow');
        element.removeAttribute('allowfullscreen');
        if (element.getAttribute('srcdoc') !== staticEmbedDocument) element.setAttribute('srcdoc', staticEmbedDocument);
      };
      const freezeScriptTree = node => {
        if (node instanceof HTMLScriptElement) freezeScript(node);
        node.querySelectorAll?.('script').forEach(freezeScript);
        if (node instanceof HTMLIFrameElement) freezeCanvasEmbed(node);
        node.querySelectorAll?.('iframe').forEach(freezeCanvasEmbed);
      };
      const nativeCreateElement = Document.prototype.createElement;
      Document.prototype.createElement = function(tagName, options) {
        const element = nativeCreateElement.call(this, tagName, options);
        if (String(tagName).toLowerCase() === 'script') freezeScript(element);
        return element;
      };
      // document.write bypasses normal DOM insertion hooks and can execute a
      // parser-inserted script immediately. It has no legitimate role in the
      // already-materialized authoring canvas.
      document.write = () => {};
      document.writeln = () => {};
      // Property handlers (node.onmouseover = fn) do not create attributes and
      // therefore evade the static on* cleanup. Editor infrastructure uses
      // addEventListener, so property assignment can be made inert globally in
      // this isolated design document without affecting selection controls.
      const neutralizeEventProperties = prototype => {
        if (!prototype) return;
        Object.getOwnPropertyNames(prototype).forEach(name => {
          if (!/^on[a-z]/i.test(name)) return;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
          if (!descriptor?.configurable) return;
          try {
            Object.defineProperty(prototype, name, {
              configurable: true,
              enumerable: descriptor.enumerable,
              get: () => null,
              set: () => {},
            });
          } catch {}
        });
      };
      [
        typeof Window === 'undefined' ? null : Window.prototype,
        typeof Document === 'undefined' ? null : Document.prototype,
        typeof HTMLElement === 'undefined' ? null : HTMLElement.prototype,
        typeof SVGElement === 'undefined' ? null : SVGElement.prototype,
      ].forEach(neutralizeEventProperties);
      // A structural runtime can append a dependency after initial parsing.
      // MutationObserver runs after an inline script has already evaluated, so
      // neutralize common DOM insertion paths synchronously.
      ['appendChild', 'insertBefore', 'replaceChild'].forEach(method => {
        const original = Node.prototype[method];
        if (typeof original !== 'function') return;
        Node.prototype[method] = function(node, ...rest) {
          freezeScriptTree(node);
          return original.call(this, node, ...rest);
        };
      });
      const freezeMany = nodes => {
        Array.from(nodes || []).forEach(freezeScriptTree);
      };
      [
        [Element.prototype, 'append'],
        [Element.prototype, 'prepend'],
        [Element.prototype, 'before'],
        [Element.prototype, 'after'],
        [Element.prototype, 'replaceWith'],
        [typeof DocumentFragment === 'undefined' ? null : DocumentFragment.prototype, 'append'],
        [typeof DocumentFragment === 'undefined' ? null : DocumentFragment.prototype, 'prepend'],
      ].forEach(([prototype, method]) => {
        const original = prototype?.[method];
        if (typeof original !== 'function') return;
        prototype[method] = function(...nodes) {
          freezeMany(nodes);
          return original.apply(this, nodes);
        };
      });
      let documentUnlocked = false;
      const canvasLoadingGateClass = /^(?:(?:is|has)[-_])?(?:(?:page|site|app)[-_])?(?:loading|preloading|loader[-_]active|preloader[-_]active)$|^(?:.+[-_])?(?:entrance|animation|motion)[-_]pending$/i;
      const canvasLoadingOverlayClass = /(?:^|[-_])(?:page[-_])?(?:preloader|loader|transition[-_](?:overlay|screen))(?:$|[-_])/i;
      const canvasCustomCursorClass = /(?:^|[-_])(?:custom[-_])?cursor(?:$|[-_])/i;
      const releaseCanvasLoadingGate = element => {
        if (!element) return;
        Array.from(element.classList || []).forEach(className => {
          if (canvasLoadingGateClass.test(className)) element.classList.remove(className);
        });
      };
      const unlockDocument = () => {
        if (!document.documentElement.classList.contains('app-ready')) {
          document.documentElement.classList.add('app-ready');
        }
        if (documentUnlocked || !document.body) return;
        releaseCanvasLoadingGate(document.documentElement);
        releaseCanvasLoadingGate(document.body);
        document.body.querySelectorAll(
          '[class*="loader" i], [class*="preloader" i], [class*="loading" i], '
          + '[class*="transition-overlay" i], [class*="transition-screen" i], '
          + '[class*="cursor" i]',
        ).forEach(element => {
          if (Array.from(element.classList || []).some(className => canvasLoadingOverlayClass.test(className))) {
            element.setAttribute('data-html-editor-canvas-loading-overlay', '');
          }
          if (
            Array.from(element.classList || []).some(className => canvasCustomCursorClass.test(className))
            && (
              element.getAttribute('aria-hidden') === 'true'
              || element.hasAttribute('data-cursor-state')
              || element.hasAttribute('data-cursor-label')
              || Boolean(element.querySelector?.('canvas, [aria-hidden="true"], [data-cursor-state], [data-cursor-label]'))
            )
          ) element.setAttribute('data-html-editor-canvas-custom-cursor', '');
        });
        documentUnlocked = true;
      };
      const pauseMedia = root => {
        const media = [];
        if (root instanceof HTMLMediaElement) media.push(root);
        root?.querySelectorAll?.('video, audio').forEach(element => media.push(element));
        media.forEach(element => {
          try {
            element.removeAttribute('autoplay');
            element.pause?.();
          } catch {}
        });
        const svgRoots = [];
        if (root instanceof SVGSVGElement) svgRoots.push(root);
        root?.querySelectorAll?.('svg').forEach(element => svgRoots.push(element));
        svgRoots.forEach(element => {
          try { element.pauseAnimations?.(); } catch {}
        });
        const marquees = [];
        if (typeof HTMLMarqueeElement !== 'undefined' && root instanceof HTMLMarqueeElement) marquees.push(root);
        root?.querySelectorAll?.('marquee').forEach(element => marquees.push(element));
        marquees.forEach(element => {
          try { element.stop?.(); } catch {}
        });
      };
      const shadowMotionCss = \`
        :host, *, *::before, *::after {
          animation: none;
          animation-play-state: paused;
          transition: none;
          scroll-behavior: auto;
        }
        :is([data-w-id], [data-kodety-framer-motion], [class*="kodety-framer-motion-"], [data-aos], .aos-init, .wow):not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]) {
          opacity: 1;
        }
        :is([data-w-id], [data-kodety-framer-motion], [class*="kodety-framer-motion-"], [data-aos], .aos-init, .wow):not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]) {
          visibility: visible;
        }
        :is([data-w-id], [data-kodety-framer-motion], [class*="kodety-framer-motion-"], [data-aos], .aos-init, .wow):not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]) {
          transform: none;
          translate: none;
          rotate: none;
          scale: none;
          filter: none;
          clip-path: none;
        }
        [data-html-editor-canvas-reveal]:not([data-html-editor-canvas-author-property-opacity]):not([data-html-editor-canvas-rule-property-opacity]) {
          opacity: 1;
        }
        [data-html-editor-canvas-reveal]:not([data-html-editor-canvas-author-property-visibility]):not([data-html-editor-canvas-rule-property-visibility]) {
          visibility: visible;
        }
        [data-html-editor-canvas-reveal]:not([data-html-editor-canvas-author-property-content-visibility]):not([data-html-editor-canvas-rule-property-content-visibility]) {
          content-visibility: visible;
        }
        [data-html-editor-canvas-reveal-motion]:not([data-html-editor-canvas-author-transform]):not([data-html-editor-canvas-rule-transform]) {
          transform: none;
          translate: none;
          rotate: none;
          scale: none;
          filter: none;
          clip-path: none;
        }
      \`;
      const shadowObservers = new Set();
      let handleMotionMutations = () => {};
      const installShadowFreeze = root => {
        if (!root || root.querySelector?.('style[data-html-editor-shadow-motion-freeze]')) return;
        const style = nativeCreateElement.call(document, 'style');
        style.setAttribute('data-html-editor-shadow-motion-freeze', '');
        style.textContent = shadowMotionCss;
        root.prepend(style);
        freezeScriptTree(root);
        pauseMedia(root);
        const observer = new MutationObserver(mutations => handleMotionMutations(mutations));
        observer.observe(root, { subtree: true, childList: true, attributes: true });
        shadowObservers.add(observer);
      };
      const nativeAttachShadow = Element.prototype.attachShadow;
      if (typeof nativeAttachShadow === 'function') {
        Element.prototype.attachShadow = function(options) {
          const root = nativeAttachShadow.call(this, options);
          installShadowFreeze(root);
          return root;
        };
      }
      // Keep native autoplay/play() calls inert even when a structural
      // component runtime invokes them after DOMContentLoaded.
      if (typeof HTMLMediaElement !== 'undefined') {
        HTMLMediaElement.prototype.play = function() {
          try { this.pause?.(); } catch {}
          return Promise.resolve();
        };
      }
      // Web Animations can be created without a script tag (or from a retained
      // Code Component renderer). Complete them synchronously and leave the
      // resulting frame paused so no timeline can advance in Design mode.
      const nativeElementAnimate = Element.prototype.animate;
      if (typeof nativeElementAnimate === 'function') {
        Element.prototype.animate = function(keyframes, options) {
          const frozenOptions = typeof options === 'number'
            ? { duration: 0, fill: 'both' }
            : { ...(options || {}), delay: 0, endDelay: 0, duration: 0, iterations: 1, fill: options?.fill || 'both' };
          const animation = nativeElementAnimate.call(this, keyframes, frozenOptions);
          if (canvasOwnsAnyMotion(this)) {
            try { animation.cancel?.(); } catch {}
            return animation;
          }
          try { animation.finish?.(); } catch {}
          try { animation.pause?.(); } catch {}
          return animation;
        };
      }
      const nativeAnimationPlay = typeof Animation !== 'undefined' ? Animation.prototype.play : null;
      if (nativeAnimationPlay) {
        Animation.prototype.play = function() {
          try {
            if (canvasOwnsAnyMotion(this.effect?.target)) {
              this.cancel?.();
              return;
            }
            const timing = this.effect?.getComputedTiming?.();
            if (Number.isFinite(timing?.endTime)) this.currentTime = timing.endTime;
            this.pause?.();
          } catch { try { this.cancel?.(); } catch {} }
        };
      }
      const settleAnimation = animation => {
        try {
          if (canvasOwnsAnyMotion(animation.effect?.target)) {
            animation.cancel?.();
            return;
          }
          const timing = animation.effect?.getComputedTiming?.();
          if (Number.isFinite(timing?.endTime)) animation.currentTime = timing.endTime;
          else animation.cancel();
          animation.pause?.();
        } catch { try { animation.cancel?.(); } catch {} }
      };
      let interactionPreviewElements = new Set();
      const freezeKnownRuntimes = () => {
        if (interactionPreviewElements.size) return;
        try {
          window.gsap?.globalTimeline?.progress?.(1);
          window.gsap?.globalTimeline?.pause?.();
          window.gsap?.ticker?.sleep?.();
        } catch {}
        try {
          (window.ScrollTrigger?.getAll?.() || []).forEach(trigger => {
            try { trigger.disable?.(false, true); } catch {}
          });
        } catch {}
        try { window.lenis?.stop?.(); } catch {}
        try { window.Lenis?.stop?.(); } catch {}
        try { window.lottie?.freeze?.(); } catch {}
      };
      const motionSelector = '[data-incode-animation-id], [data-incode-motion-id], [data-kodety-interaction-id], [data-kodety-component-id], [data-w-id], [data-kodety-motion], [data-kodety-framer-motion], [class*="kodety-framer-motion-"], [data-aos], .aos-init, .wow, [data-kodety-collection], [data-kodety-bind], [data-kodety-bind-content], [data-kodety-bind-title], [data-kodety-bind-href], [data-kodety-bind-src], [data-kodety-bind-alt]';
      const revealSignalAttributes = [
        'data-reveal',
        'data-scroll-reveal',
        'data-animate',
        'data-animation',
        'data-appear',
        'data-inview',
        'data-in-view',
      ];
      const revealClassPattern = /(?:^|[-_])(reveal|scroll-reveal|animate-on-scroll|appear|inview|in-view|aos|wow)(?:$|[-_])/i;
      const stateClassPattern = /(?:^|[-_])(?:active|current|selected|open|visible|playing)(?:$|[-_])/i;
      const conditionalUiPattern = /(?:^|[-_])(modal|dialog|popover|tooltip|drawer|dropdown|submenu|offcanvas|lightbox|toast|cursor|page-transition|route-transition|transition-overlay|transition-screen|preloader|loader|carousel|slider|tab-panel|accordion)(?:$|[-_])/i;
      const hasActivePeer = element => {
        const stableClasses = Array.from(element.classList).filter(name =>
          !stateClassPattern.test(name) && !/^(?:is-)?(?:inactive|hidden)$/.test(name),
        );
        if (!stableClasses.length || !element.parentElement) return false;
        return Array.from(element.parentElement.children).some(peer =>
          peer !== element
          && Array.from(peer.classList).some(name => stateClassPattern.test(name))
          && stableClasses.some(name => peer.classList.contains(name)),
        );
      };
      const authoredHidden = element => (
        element.hasAttribute('data-html-editor-original-hidden')
        || element.getAttribute('data-html-editor-original-aria-hidden') === 'true'
        || element.closest?.('[data-html-editor-original-hidden], [data-html-editor-original-aria-hidden="true"]')
      );
      const canvasOwnsMotionProperty = (element, property) => Boolean(
        element instanceof Element
        && (
          element.hasAttribute('data-html-editor-canvas-author-property-' + property)
          || element.hasAttribute('data-html-editor-canvas-rule-property-' + property)
        )
      );
      const canvasOwnsVisibility = element => Boolean(
        element instanceof Element
        && (
          canvasOwnsMotionProperty(element, 'visibility')
          || element.closest?.(
            '[data-html-editor-canvas-author-property-visibility], '
            + '[data-html-editor-canvas-rule-property-visibility], '
            + '[data-html-editor-canvas-author-visibility], '
            + '[data-html-editor-canvas-rule-visibility]',
          )
        )
      );
      const canvasOwnsAnyMotion = element => {
        if (!(element instanceof Element)) return false;
        if (authoredHidden(element)) return true;
        return Array.from(element.attributes).some(attribute => (
          attribute.name.startsWith('data-html-editor-canvas-author-property-')
          || attribute.name.startsWith('data-html-editor-canvas-rule-property-')
          || attribute.name === 'data-html-editor-canvas-author-transform'
          || attribute.name === 'data-html-editor-canvas-rule-transform'
          || attribute.name === 'data-html-editor-canvas-author-visibility'
          || attribute.name === 'data-html-editor-canvas-rule-visibility'
        ));
      };
      const revealSignal = element => (
        revealSignalAttributes.some(name => element.hasAttribute(name))
        || Array.from(element.classList).some(name => revealClassPattern.test(name))
      );
      const pageRegion = element => (
        ['MAIN', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER'].includes(element.tagName)
        || element.getAttribute('role') === 'region'
        || element.hasAttribute('data-section')
      );
      const conditionalUi = element => {
        let current = element;
        while (current && current !== document.documentElement) {
          if (
            current.matches?.(
              '[inert], [role="dialog"], [role="alertdialog"], [role="menu"], '
              + '[role="listbox"], [role="tabpanel"], [role="tooltip"]',
            )
            || Array.from(current.classList || []).some(name => conditionalUiPattern.test(name))
          ) return true;
          current = current.parentElement;
        }
        if (element.closest?.('details:not([open])')) return true;
        const id = element.id;
        if (!id) return false;
        try {
          return Boolean(document.querySelector(
            '[aria-expanded="false"][aria-controls~="' + CSS.escape(id) + '"]',
          ));
        } catch {
          return false;
        }
      };
      const activeMotionValue = value => Boolean(
        value
        && value !== 'none'
        && value !== 'normal'
        && value !== 'auto'
        && value !== '0'
        && value !== '1',
      );
      const authoredMotionHint = element => {
        const style = element.getAttribute('data-html-editor-original-style')
          || element.getAttribute('style')
          || '';
        return /(?:^|;)\s*(?:animation(?:-[a-z-]+)?|transition(?:-[a-z-]+)?|transform(?:-[a-z-]+)?|translate|rotate|scale|filter|clip-path|will-change)\s*:/i.test(style);
      };
      const staticContentCandidate = element => (
        element.matches?.(
          'h1, h2, h3, h4, h5, h6, p, blockquote, figcaption, '
          + 'img, picture, video, svg, canvas',
        )
        || (
          element.childElementCount === 0
          && element.textContent?.trim()
          && element.matches?.('span, strong, em, small, mark, code, li')
        )
      );
      // Resting-state detection used to walk every DOM node and call
      // getComputedStyle(), which turns a large imported page into one long
      // synchronous layout task. These are the only nodes that can reasonably
      // represent an entrance/reveal frame; ordinary wrappers keep authored
      // layout and never need motion inspection.
      const revealCandidateSelector = motionSelector
        + ', main, section, article, header, footer, [role="region"], [data-section]'
        + ', h1, h2, h3, h4, h5, h6, p, blockquote, figcaption'
        + ', img, picture, video, svg, canvas, span, strong, em, small, mark, code, li'
        + ', [data-reveal], [data-scroll-reveal], [data-animate], [data-animation]'
        + ', [data-appear], [data-inview], [data-in-view]';
      const materializeRevealState = element => {
        if (
          !(element instanceof HTMLElement)
          || authoredHidden(element)
          || element.closest(
            '[data-html-editor-canvas-author-visibility], '
            + '[data-html-editor-canvas-rule-visibility]',
          )
          || element.hasAttribute('data-html-editor-interaction-preview')
        ) return;
        try {
          const computed = getComputedStyle(element);
          if (computed.display === 'none') return;
          // Exported GSAP/Framer markup commonly uses 0.001 instead of zero to
          // avoid browser optimisations. Treat the whole effectively-invisible
          // range as an entrance state in Design so text never stays stuck
          // between split-word frames.
          const opacityHidden = Number.parseFloat(computed.opacity || '1') <= 0.01;
          const visibilityHidden = computed.visibility === 'hidden'
            || computed.visibility === 'collapse';
          const hiddenByCss = opacityHidden
            || visibilityHidden;
          const motionOffset = activeMotionValue(computed.transform)
            || activeMotionValue(computed.translate)
            || activeMotionValue(computed.rotate)
            || activeMotionValue(computed.scale)
            || activeMotionValue(computed.filter)
            || activeMotionValue(computed.clipPath)
            || /(?:opacity|transform|translate|rotate|scale|filter|clip-path)/i.test(
              computed.willChange || '',
            )
            || authoredMotionHint(element);
          const inheritedVisibility = visibilityHidden
            && element.parentElement
            && (
              getComputedStyle(element.parentElement).visibility === 'hidden'
              || getComputedStyle(element.parentElement).visibility === 'collapse'
            );
          const signaled = revealSignal(element);
          const importedFramerEntrance = hiddenByCss
            && element.hasAttribute('data-kodety-framer-node');
          const likelyEntranceState = !inheritedVisibility && hiddenByCss && (
            importedFramerEntrance
            || motionOffset
            || staticContentCandidate(element)
          );
          if (!signaled && !(pageRegion(element) && hiddenByCss) && !likelyEntranceState) return;
          if (
            conditionalUi(element)
            || hasActivePeer(element)
          ) return;
          if (!element.hasAttribute('data-html-editor-canvas-reveal')) {
            element.setAttribute('data-html-editor-canvas-reveal', '');
          }
          if (
            signaled
            || likelyEntranceState
            || computed.transform !== 'none'
            || computed.clipPath !== 'none'
            || computed.filter !== 'none'
          ) {
            if (!element.hasAttribute('data-html-editor-canvas-reveal-motion')) {
              element.setAttribute('data-html-editor-canvas-reveal-motion', '');
            }
          }
          if (element.hidden && !element.hasAttribute('data-html-editor-original-hidden')) element.hidden = false;
          if (
            element.getAttribute('aria-hidden') === 'true'
            && element.getAttribute('data-html-editor-original-aria-hidden') !== 'true'
          ) element.removeAttribute('aria-hidden');
        } catch {}
      };
      const PAINT_CHUNK_MAX_HEIGHT = 6144;
      const PAINT_CHUNK_COMPLEX_SURFACE_MIN_HEIGHT = 1536;
      const PAINT_CHUNK_MIN_HEIGHT = 32;
      const PAINT_CHUNK_LIMIT = 24;
      const PAINT_CHUNK_SCAN_LIMIT = 96;
      const PAINT_CHUNK_MAX_DEPTH = 2;
      const paintChunkNeedsSubdivision = (element, height) => (
        height >= PAINT_CHUNK_COMPLEX_SURFACE_MIN_HEIGHT
        && Boolean(
          element.matches('video, iframe, canvas')
          || element.querySelector('video, iframe, canvas')
        )
      );
      const paintChunkElements = new Set();
      let paintResizeObserver = null;
      let observedPaintBody = null;
      const observePaintBody = () => {
        if (!paintResizeObserver || !document.body || observedPaintBody === document.body) return;
        if (observedPaintBody) {
          try { paintResizeObserver.unobserve(observedPaintBody); } catch {}
        }
        observedPaintBody = document.body;
        paintResizeObserver.observe(observedPaintBody);
      };
      const materializePaintChunks = () => {
        observePaintBody();
        const candidates = [];
        const pending = Array.from(document.body?.children || [], element => ({ element, depth: 0 })).reverse();
        let inspected = 0;
        while (pending.length && inspected < PAINT_CHUNK_SCAN_LIMIT) {
          const entry = pending.pop();
          const element = entry?.element;
          if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
          if (element.matches('script, style, link, meta, noscript, template, [hidden]')) continue;
          inspected += 1;
          const rect = element.getBoundingClientRect();
          const height = rect.height;
          const width = rect.width;
          if (height < PAINT_CHUNK_MIN_HEIGHT || width < 1) {
            continue;
          }
          if (
            height <= PAINT_CHUNK_MAX_HEIGHT
            && !paintChunkNeedsSubdivision(element, height)
          ) {
            const top = rect.top + (window.scrollY || 0);
            candidates.push({ element, center: top + (height / 2), height });
            continue;
          }
          // Split only a bounded top-level shell. This also keeps a tall
          // video/embed/canvas scene from becoming one promoted texture around
          // its own masks, blends and sticky descendants. Deep recursive
          // measurement was the dominant Design layout cost on imported React
          // documents.
          if (entry.depth < PAINT_CHUNK_MAX_DEPTH) {
            const children = Array.from(element.children);
            for (let index = children.length - 1; index >= 0; index -= 1) {
              pending.push({ element: children[index], depth: entry.depth + 1 });
            }
          }
        }
        const nextPaintChunkElements = new Set(
          candidates
            .sort((a, b) => a.center - b.center)
            .slice(0, PAINT_CHUNK_LIMIT)
            .map(candidate => candidate.element),
        );
        paintChunkElements.forEach(element => {
          if (!nextPaintChunkElements.has(element) && element.isConnected) {
            element.removeAttribute('data-html-editor-canvas-paint-chunk');
          }
        });
        nextPaintChunkElements.forEach(element => {
          if (!paintChunkElements.has(element)) {
            element.setAttribute('data-html-editor-canvas-paint-chunk', '');
          }
        });
        paintChunkElements.clear();
        nextPaintChunkElements.forEach(element => paintChunkElements.add(element));
      };
      let paintChunkFrame = 0;
      const schedulePaintChunkRefresh = () => {
        if (paintChunkFrame) return;
        paintChunkFrame = nativeClock.requestAnimationFrame?.(() => {
          paintChunkFrame = 0;
          materializePaintChunks();
        }) || 0;
        if (!paintChunkFrame) materializePaintChunks();
      };
      window.__KODETY_REFRESH_EDITOR_PAINT_CHUNKS__ = schedulePaintChunkRefresh;
      let settling = false;
      const setRuntimeStyle = (element, property, value) => {
        if (element.style.getPropertyValue(property) === value && !element.style.getPropertyPriority(property)) return;
        element.style.setProperty(property, value);
      };
      const freezePreviewCssMotion = element => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
        // Native Timeline owns its GSAP clock and animated values. Authored
        // CSS animations/transitions must remain inert even if its style
        // snapshot restoration removes the normal Design freeze overrides.
        setRuntimeStyle(element, 'animation-name', 'none');
        setRuntimeStyle(element, 'animation-play-state', 'paused');
        setRuntimeStyle(element, 'transition-property', 'none');
      };
      const revealMotionElement = element => {
        if (
          !(element instanceof HTMLElement)
          || element.hasAttribute('data-html-editor-interaction-preview')
        ) return;
        const owns = property => canvasOwnsMotionProperty(element, property);
        try {
          // Setting the animation shorthand would reset play-state to running
          // on every pass, then paused below would trigger another observed
          // style mutation forever. Disable names without resetting state.
          setRuntimeStyle(element, 'animation-name', 'none');
          setRuntimeStyle(element, 'animation-play-state', 'paused');
          setRuntimeStyle(element, 'transition-property', 'none');
          if (element._gsap) {
            if (!owns('transform')) setRuntimeStyle(element, 'transform', 'none');
            if (!owns('translate')) setRuntimeStyle(element, 'translate', 'none');
            if (!owns('rotate')) setRuntimeStyle(element, 'rotate', 'none');
            if (!owns('scale')) setRuntimeStyle(element, 'scale', 'none');
            if (!owns('filter')) setRuntimeStyle(element, 'filter', 'none');
            if (!owns('clip-path')) setRuntimeStyle(element, 'clip-path', 'none');
          }
          const computed = getComputedStyle(element);
          if (Number.parseFloat(computed.opacity || '1') <= 0.01 && !owns('opacity')) {
            setRuntimeStyle(element, 'opacity', '1');
          }
          if (computed.visibility === 'hidden' && !canvasOwnsVisibility(element)) {
            setRuntimeStyle(element, 'visibility', 'visible');
          }
          if (element.hidden && !authoredHidden(element)) element.hidden = false;
          if (
            element.getAttribute('aria-hidden') === 'true'
            && element.getAttribute('data-html-editor-original-aria-hidden') !== 'true'
          ) element.removeAttribute('aria-hidden');
        } catch {}
      };
      const finishMotionSettlement = () => {
        document.getAnimations?.().forEach(settleAnimation);
        freezeKnownRuntimes();
        // These runtimes can materialize frames anywhere in the document.
        // Restore editor authority once per batch, after every root settles.
        window.__KODETY_REAPPLY_EDITOR_LIVE_STATE__?.(document, true, false);
      };
      const settleMotion = (root, includeDescendants = true, deferGlobalReplay = false) => {
        if (settling) return;
        settling = true;
        try {
          unlockDocument();
          freezeScriptTree(root);
          pauseMedia(root);
          if (root?.matches?.(motionSelector) || root?._gsap) revealMotionElement(root);
          if (includeDescendants) root?.querySelectorAll?.(motionSelector).forEach(revealMotionElement);
          if (root instanceof Element) materializeRevealState(root);
          if (includeDescendants) root?.querySelectorAll?.(revealCandidateSelector).forEach(materializeRevealState);
          if (!deferGlobalReplay) finishMotionSettlement();
          if (root === document || (root instanceof Element && pageRegion(root))) {
            schedulePaintChunkRefresh();
          }
        } finally {
          settling = false;
        }
      };
      const previewStyleProperties = [
        'animation',
        'animation-play-state',
        'transition-property',
        'transform',
        'translate',
        'rotate',
        'scale',
        'filter',
        'clip-path',
        'opacity',
        'visibility',
      ];
      const restoreAuthoredPreviewStyle = element => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
        const authored = document.createElement('span');
        authored.setAttribute('style', element.getAttribute('data-html-editor-original-style') || '');
        previewStyleProperties.forEach(property => {
          const value = authored.style.getPropertyValue(property);
          if (value) {
            element.style.setProperty(
              property,
              value,
              authored.style.getPropertyPriority(property),
            );
          } else {
            element.style.removeProperty(property);
          }
        });
      };
      const endInteractionPreview = () => {
        if (!interactionPreviewElements.size) return;
        const previous = Array.from(interactionPreviewElements);
        interactionPreviewElements = new Set();
        previous.forEach(element => {
          element.removeAttribute?.('data-html-editor-interaction-preview');
        });
        previous.forEach(element => {
          if (element.isConnected) settleMotion(element, true, true);
        });
        finishMotionSettlement();
      };
      window.__KODETY_END_EDITOR_INTERACTION_PREVIEW__ = endInteractionPreview;
      window.__KODETY_BEGIN_EDITOR_INTERACTION_PREVIEW__ = elements => {
        endInteractionPreview();
        interactionPreviewElements = new Set(
          Array.from(elements || []).filter(element => (
            element instanceof HTMLElement || element instanceof SVGElement
          )),
        );
        interactionPreviewElements.forEach(element => {
          element.setAttribute('data-html-editor-interaction-preview', '');
          element.removeAttribute('data-html-editor-canvas-reveal');
          element.removeAttribute('data-html-editor-canvas-reveal-motion');
          restoreAuthoredPreviewStyle(element);
          freezePreviewCssMotion(element);
        });
      };
      // Authored scripts are inert in design mode. CMS/component clones can
      // still appear later, so retain the public hook the bridge already calls.
      window.__KODETY_CAPTURE_EDITOR_MOTION_BASE__ = root => settleMotion(root || document);
      window.__KODETY_SETTLE_EDITOR_MOTION__ = root => {
        const target = root || document;
        settleMotion(target);
        window.__KODETY_REBIND_EDITOR_SELECTION__?.();
      };
      const pendingRoots = new Map();
      let settleFrame = 0;
      const flushChanged = () => {
        settleFrame = 0;
        const roots = Array.from(pendingRoots.entries()).filter(([root]) => root.isConnected);
        pendingRoots.clear();
        const subtreeRoots = new Set(roots
          .filter(([, includeDescendants]) => includeDescendants)
          .map(([root]) => root));
        roots.forEach(([root, includeDescendants]) => {
          for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (subtreeRoots.has(ancestor)) return;
          }
          settleMotion(root, includeDescendants, true);
        });
        if (roots.length) {
          finishMotionSettlement();
          window.__KODETY_REBIND_EDITOR_SELECTION__?.();
        }
      };
      const scheduleRoot = (root, includeDescendants = false) => {
        if (!(root instanceof Element)) return;
        pendingRoots.set(
          root,
          Boolean(includeDescendants || pendingRoots.get(root)),
        );
        if (!settleFrame) settleFrame = nativeClock.requestAnimationFrame?.(flushChanged) || 0;
      };
      handleMotionMutations = mutations => {
        let paintChunksDirty = false;
        mutations.forEach(mutation => {
          if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (
              target instanceof HTMLIFrameElement
              && ['src', 'srcdoc', 'allow', 'allowfullscreen'].includes(mutation.attributeName || '')
            ) {
              freezeCanvasEmbed(target);
            }
            if (
              target instanceof Element
              && (
                target.hasAttribute('data-html-editor-interaction-preview')
                || target.closest('[data-html-editor-interaction-preview]')
              )
            ) {
              if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
                freezePreviewCssMotion(target);
              }
              return;
            }
            if (
              target instanceof Element
              && ['style', 'class', 'hidden', 'aria-hidden'].includes(
                mutation.attributeName || '',
              )
              && canvasOwnsAnyMotion(target)
            ) return;
            let needsSettle = false;
            if (
              mutation.attributeName
              && (
                ['hidden', 'class', 'style'].includes(mutation.attributeName)
                && target instanceof Element
                && (target.matches('[data-html-editor-canvas-paint-chunk]') || pageRegion(target))
              )
            ) paintChunksDirty = true;
            if (
              mutation.attributeName
              && /^on[a-z]/i.test(mutation.attributeName)
              && target instanceof Element
              && target.hasAttribute(mutation.attributeName)
            ) {
              const value = target.getAttribute(mutation.attributeName) || '';
              target.setAttribute('data-html-editor-original-' + mutation.attributeName, value);
              target.removeAttribute(mutation.attributeName);
              needsSettle = true;
            }
            if (
              target instanceof Element
              && (
                (mutation.attributeName === 'autoplay' && target instanceof HTMLMediaElement)
                || (
                  ['src', 'srcset', 'data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'data-lazy-srcset', 'loading'].includes(mutation.attributeName || '')
                  && target.matches('img, source, video, iframe')
                )
                || (
                  ['style', 'class', 'hidden', 'aria-hidden'].includes(mutation.attributeName || '')
                  && (
                    target.matches(motionSelector)
                    || target.hasAttribute('data-kodety-framer-node')
                    || target._gsap
                    || (target instanceof HTMLElement && (revealSignal(target) || pageRegion(target)))
                  )
                )
              )
            ) needsSettle = true;
            if (needsSettle) scheduleRoot(
              target,
              // Ancestor CSS changes can reveal/hide descendants through
              // selectors, inherited values and custom properties. Preserve
              // that normalization while coalescing overlapping roots above.
              ['style', 'class', 'hidden', 'aria-hidden'].includes(mutation.attributeName || ''),
            );
            return;
          }
          paintChunksDirty = true;
          mutation.addedNodes.forEach(node => {
            if (!(node instanceof Element)) return;
            freezeScriptTree(node);
            if (node.shadowRoot) installShadowFreeze(node.shadowRoot);
            scheduleRoot(node, true);
          });
        });
        if (paintChunksDirty) schedulePaintChunkRefresh();
      };
      const observer = new MutationObserver(handleMotionMutations);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      paintResizeObserver = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => schedulePaintChunkRefresh());
      if (paintResizeObserver) {
        paintResizeObserver.observe(document.documentElement);
        observePaintBody();
      }
      addEventListener('resize', schedulePaintChunkRefresh);
      addEventListener('load', schedulePaintChunkRefresh, { once: true });
      document.fonts?.ready?.then(schedulePaintChunkRefresh).catch?.(() => {});
      addEventListener('pagehide', () => {
        observer.disconnect();
        paintResizeObserver?.disconnect();
        observedPaintBody = null;
        removeEventListener('resize', schedulePaintChunkRefresh);
        if (paintChunkFrame) nativeClock.cancelAnimationFrame?.(paintChunkFrame);
        paintChunkFrame = 0;
        shadowObservers.forEach(shadowObserver => shadowObserver.disconnect());
        shadowObservers.clear();
      }, { once: true });
      const ready = () => {
        unlockDocument();
        observePaintBody();
        settleMotion(document);
      };
      if (document.readyState === 'loading') addEventListener('DOMContentLoaded', ready, { once: true });
      else ready();
    })()`;
      document.head.insertBefore(motionBootstrap, document.head.firstChild);
    }
  }

  const rememberAttribute = (element: Element, name: string) => {
    const value = element.getAttribute(name);
    if (value !== null) element.setAttribute(`data-html-editor-original-${name}`, value);
  };

  document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
    const path = resolveProjectPath(project.mainHtmlPath, link.getAttribute('href') || '', rootPath);
    const css = path ? findFile(path)?.text : null;
    if (!path || css == null) {
      if (path) missingAssets.add(path);
      return;
    }
    const style = document.createElement('style');
    style.dataset.editorSource = path;
    style.media = link.getAttribute('media') || '';
    style.textContent = resolveCss(css, path);
    link.replaceWith(style);
  });

  document.querySelectorAll('style').forEach(style => {
    if (!style.dataset.editorSource) style.textContent = resolveCss(style.textContent || '', project.mainHtmlPath);
  });

  document.querySelectorAll('[style]').forEach(element => {
    rememberAttribute(element, 'style');
    element.setAttribute('style', resolveCss(element.getAttribute('style') || '', project.mainHtmlPath));
  });

  document.querySelectorAll('[src]').forEach(element => {
    // A frozen author script must remain a tiny inert placeholder. Embedding
    // its full JS file as a base64 data URL can inflate srcdoc by megabytes and
    // make Chromium abort the iframe before the editor bridge starts.
    if (element.tagName === 'SCRIPT' && element.hasAttribute('data-html-editor-frozen-script-type')) {
      rememberAttribute(element, 'src');
      element.removeAttribute('src');
      return;
    }
    const path = resolveProjectPath(project.mainHtmlPath, element.getAttribute('src') || '', rootPath);
    const isModule = element.tagName === 'SCRIPT' && element.getAttribute('type') === 'module';
    const url = path ? (isModule ? moduleUrlFor(path) : urlFor(path)) : null;
    if (url) {
      rememberAttribute(element, 'src');
      element.setAttribute('src', url);
    }
  });

  document.querySelectorAll('[poster]').forEach(element => {
    const path = resolveProjectPath(project.mainHtmlPath, element.getAttribute('poster') || '', rootPath);
    const url = path ? urlFor(path) : null;
    if (url) {
      rememberAttribute(element, 'poster');
      element.setAttribute('poster', url);
    }
  });

  document.querySelectorAll('[data-src], [data-lazy-src], [data-original], [data-poster], [data-poster-url]').forEach(element => {
    ['data-src', 'data-lazy-src', 'data-original', 'data-poster', 'data-poster-url'].forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const path = resolveProjectPath(project.mainHtmlPath, element.getAttribute(attribute) || '', rootPath);
      const url = path ? urlFor(path) : null;
      if (!url) return;
      rememberAttribute(element, attribute);
      element.setAttribute(attribute, url);
    });
  });

  const rewriteProjectAssetAttribute = (element: Element, attribute: string) => {
    const authored = element.getAttribute(attribute) || '';
    const path = resolveProjectPath(project.mainHtmlPath, authored, rootPath);
    const url = path ? urlFor(path) : null;
    if (!url) return;
    const hash = authored.includes('#') ? `#${authored.split('#').slice(1).join('#')}` : '';
    rememberAttribute(element, attribute);
    element.setAttribute(attribute, `${url}${hash}`);
  };
  document.querySelectorAll('object[data]').forEach(element => rewriteProjectAssetAttribute(element, 'data'));
  document.querySelectorAll('[background]').forEach(element => rewriteProjectAssetAttribute(element, 'background'));
  document.querySelectorAll('image[href], use[href]').forEach(element => rewriteProjectAssetAttribute(element, 'href'));
  document.querySelectorAll('image[xlink\\:href], use[xlink\\:href]').forEach(element => rewriteProjectAssetAttribute(element, 'xlink:href'));

  const rewriteSrcsetAttribute = (element: Element, attribute: string) => {
    rememberAttribute(element, attribute);
    const rewritten = rewritePreviewSrcset(element.getAttribute(attribute) || '', value => {
      const path = resolveProjectPath(project.mainHtmlPath, value, rootPath);
      const url = path ? urlFor(path, true) : null;
      const hash = value.includes('#') ? `#${value.split('#').slice(1).join('#')}` : '';
      return url ? `${url}${hash}` : null;
    });
    element.setAttribute(attribute, rewritten);
  };
  document.querySelectorAll('[srcset], [data-srcset], [data-lazy-srcset], [imagesrcset]').forEach(element => {
    ['srcset', 'data-srcset', 'data-lazy-srcset', 'imagesrcset'].forEach(attribute => {
      if (element.hasAttribute(attribute)) rewriteSrcsetAttribute(element, attribute);
    });
  });

  document.querySelectorAll('[data-video-urls]').forEach(element => {
    rememberAttribute(element, 'data-video-urls');
    const rewritten = (element.getAttribute('data-video-urls') || '').split(',').map(value => {
      const path = resolveProjectPath(project.mainHtmlPath, value.trim(), rootPath);
      return (path ? urlFor(path) : null) || value;
    });
    element.setAttribute('data-video-urls', rewritten.join(','));
  });

  document.querySelectorAll('[data-incode-js-files]').forEach(element => {
    rememberAttribute(element, 'data-incode-js-files');
    let files: string[] = [];
    try {
      const parsed = JSON.parse(element.getAttribute('data-incode-js-files') || '[]') as unknown;
      if (Array.isArray(parsed)) files = parsed.filter((item): item is string => typeof item === 'string');
    } catch { /* malformed attribute, treat as no attachments */ }
    const resolved = files.map(file => {
      const path = resolveProjectPath(project.mainHtmlPath, file, rootPath);
      return (path ? moduleUrlFor(path) : null) || file;
    });
    element.setAttribute('data-incode-js-files', JSON.stringify(resolved));
  });

  document.querySelectorAll('link[href]:not([rel="stylesheet"])').forEach(link => {
    const path = resolveProjectPath(project.mainHtmlPath, link.getAttribute('href') || '', rootPath);
    const url = path ? urlFor(path) : null;
    if (url) {
      rememberAttribute(link, 'href');
      link.setAttribute('href', url);
    }
  });

  const lockedSet = new Set(lockedPaths);
  const inlineTextTags = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'em',
    'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong',
    'sub', 'sup', 'time', 'u', 'var', 'wbr',
  ]);
  const richTextHostTags = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figcaption',
    'button', 'label', 'li', 'dt', 'dd', 'td', 'th', 'caption', 'div',
  ]);
  interface AnnotationSummary {
    /** Every element in this subtree is an inline text tag. */
    allInlineText: boolean;
    /** The subtree contains authored non-whitespace text or a line break. */
    hasTextOrBreak: boolean;
  }
  const skippedAnnotationSummary: AnnotationSummary = {
    allInlineText: false,
    hasTextOrBreak: false,
  };
  const annotate = (
    element: Element,
    path: string,
    parentLocked = false,
    parentSsrVariant = false,
  ): AnnotationSummary => {
    const tag = element.tagName.toLowerCase();
    const technicalId = element.id.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'noscript', 'template'].includes(tag)) {
      return skippedAnnotationSummary;
    }
    if (
      technicalId === 'svg-templates'
      || technicalId === 'template-overlay'
      || element.hasAttribute('data-framer-svg-template')
    ) return skippedAnnotationSummary;
    const ssrVariant = parentSsrVariant || element.classList.contains('ssr-variant');
    element.setAttribute('data-html-editor-path', path);
    if (inspectionEnabled && ssrVariant && element instanceof HTMLElement) {
      // Framer's SSR variant wrappers deliberately disable hit-testing while
      // React decides which variant owns interaction. In Design mode React is
      // frozen, so keeping that pointer contract makes every authored child
      // impossible to select. Override only the disposable preview DOM; the
      // original style is retained in data-html-editor-original-style and is
      // what snapshot()/publication sees.
      element.setAttribute('data-html-editor-ssr-variant', '');
      element.style.pointerEvents = 'auto';
      if (element.children.length === 0 && (element.textContent || '').trim()) {
        element.style.userSelect = 'text';
      }
    }
    // In preview mode nothing is outlined — the canvas must look exactly like the
    // published page so interactions can be tested for real.
    if (inspectionEnabled && selectedPaths.includes(path)) {
      element.setAttribute('data-html-editor-selected', '');
    }
    const locked = parentLocked || lockedSet.has(path);
    if (locked) element.setAttribute('data-html-editor-locked', '');
    const directText = Array.from(element.childNodes).some(node => (
      node.nodeType === 3 && Boolean((node.textContent || '').trim())
    ));
    const children = Array.from(element.children);
    const childSummaries = tag === 'svg'
      ? []
      : children.map((child, index) => annotate(
          child,
          path ? `${path}/${index}` : String(index),
          locked,
          ssrVariant,
        ));
    const hasTextOrBreak = tag === 'br'
      || directText
      || childSummaries.some(summary => summary.hasTextOrBreak);
    const allInlineText = inlineTextTags.has(tag)
      && tag !== 'svg'
      && childSummaries.every(summary => summary.allInlineText);

    // Marked before any runtime script runs, so it reflects the AUTHOR's source
    // structure. Deriving rich-text eligibility bottom-up makes this walk O(N):
    // the former textContent/querySelectorAll call rescanned every descendant
    // for each nested div and became quadratic on deeply composed pages.
    if (children.length === 0) {
      element.setAttribute('data-html-editor-leaf', '');
    } else if (
      richTextHostTags.has(tag)
      && hasTextOrBreak
      && childSummaries.every(summary => summary.allInlineText)
    ) {
      element.setAttribute('data-html-editor-rich-text', '');
    }
    return { allInlineText, hasTextOrBreak };
  };
  annotate(document.body, '');

  // Editor chrome (hover/selection outlines, cursors) is only injected while
  // inspecting. Preview mode renders the page bare, like production.
  if (inspectionEnabled) {
    const editorStyle = document.createElement('style');
    editorStyle.textContent = `
      /*
       * Canvas-only visibility authority. Imported runtimes frequently write
       * display/hidden after the editor command. The marker is projected from
       * View State, never serialized into the project, and keeps Hide painted
       * while the committed DOM atoms are reasserted in the same render turn.
       */
      [data-html-editor-canvas-visibility-hidden] {
        display: none;
      }
      /*
       * Persistent Builder-only visibility. Unlike the View State marker
       * above, this attribute is authored so the state survives reopening the
       * project. Its behavior lives exclusively in this inspection stylesheet;
       * Preview and the published site receive no matching visibility rule.
       */
      [${BUILDER_HIDDEN_ATTRIBUTE}="true"] {
        display: none !important;
      }
      /*
       * Overlay visibility in Design mode is derived exclusively from the
       * current selection. Runtime state (data-state="open", popover/dialog
       * top-layer state, or an authored default-open flag) must not strand a
       * surface over unrelated content after the author selects another layer.
       *
       * The relational selector also handles multi-selection and nested overlays:
       * every overlay containing at least one selected layer remains editable;
       * every other surface/backdrop is suppressed without touching source.
       */
      [data-kodety-overlay]:not([data-html-editor-selected]):not(:has([data-html-editor-selected])) [data-kodety-overlay-surface],
      [data-kodety-overlay][data-kodety-overlay-surface]:not([data-html-editor-selected]):not(:has([data-html-editor-selected])),
      [data-kodety-overlay]:not([data-html-editor-selected]):not(:has([data-html-editor-selected])) [data-kodety-overlay-backdrop] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      :where(button[data-incode-component="button"]) {
        appearance: none;
        -webkit-appearance: none;
        border-style: none;
        border-radius: 0;
        background-image: none;
        font: inherit;
      }
      :root {
        --kodety-direct-selection-color: #00d1b8;
        --kodety-direct-selection-soft: rgba(0, 209, 184, .35);
      }
      :root[data-html-editor-agent-selection-active] {
        --kodety-direct-selection-color: #a78bfa;
        --kodety-direct-selection-soft: rgba(167, 139, 250, .4);
      }
      [data-html-editor-path] { cursor: default; }
      [data-html-editor-locked] { cursor: not-allowed; }
      [data-html-editor-selected][data-html-editor-position-draggable] { cursor: move; }
      [data-html-editor-hover] {
        outline: var(--kodety-direct-outline-hover, 1px) solid rgba(0, 209, 184, .72);
        outline-offset: var(--kodety-direct-hover-outline-offset, 1px);
      }
      [data-html-editor-selected] {
        outline: var(--kodety-direct-outline-selected, 1px) solid var(--kodety-direct-selection-color);
        outline-offset: var(--kodety-direct-outline-offset, 0px);
      }
      [data-html-editor-insert-drop="before"] { box-shadow: inset 0 2px 0 #00d1b8; }
      [data-html-editor-insert-drop="after"] { box-shadow: inset 0 -2px 0 #00d1b8; }
      [data-html-editor-insert-drop="inside"] { outline: 2px dashed #00d1b8; outline-offset: -3px; }
      #__kodety-direct-overlay {
        position: fixed; z-index: 2147483646; pointer-events: none;
        border: var(--kodety-direct-overlay-border, 1px) solid var(--kodety-direct-selection-color); box-sizing: border-box;
        overflow: visible;
      }
      #__kodety-direct-overlay[hidden] { display: none; }
      .__kodety-direct-layer {
        position: absolute; inset: 0; overflow: visible; pointer-events: none;
      }
      .__kodety-spacing-region {
        position: absolute; box-sizing: border-box; pointer-events: none;
        opacity: 0; transition: opacity 90ms ease;
      }
      .__kodety-spacing-region[data-spacing-kind^="padding-"] {
        background: rgba(255, 111, 224, .25);
      }
      .__kodety-spacing-region[data-spacing-kind^="margin-"] {
        background: rgba(254, 156, 7, .25);
      }
      #__kodety-direct-overlay[data-spacing-preview="padding-top"] [data-spacing-kind="padding-top"],
      #__kodety-direct-overlay[data-spacing-preview="padding-right"] [data-spacing-kind="padding-right"],
      #__kodety-direct-overlay[data-spacing-preview="padding-bottom"] [data-spacing-kind="padding-bottom"],
      #__kodety-direct-overlay[data-spacing-preview="padding-left"] [data-spacing-kind="padding-left"] {
        opacity: 1;
      }
      #__kodety-direct-overlay[data-show-margins] [data-spacing-kind^="margin-"] {
        opacity: 1;
      }
      html[data-kodety-direct-dragging] #__kodety-direct-overlay[data-spacing-preview] [data-spacing-kind^="padding-"] {
        background: rgba(255, 111, 224, .5);
      }
      .__kodety-gap-control {
        position: absolute; min-width: 0; min-height: 0; margin: 0; padding: 0;
        border: 0; border-radius: var(--kodety-direct-gap-radius, 3px); background: rgba(255, 111, 224, .12);
        box-shadow: inset 0 0 0 1px rgba(255, 111, 224, .3);
        pointer-events: auto; touch-action: none; appearance: none;
      }
      .__kodety-gap-control::before {
        content: ""; position: absolute; left: 50%; top: 50%;
        width: var(--kodety-direct-gap-marker-long, 12px); height: var(--kodety-direct-gap-marker-short, 3px); border-radius: 999px;
        background: #ff6fe0;
        transform: translate(-50%,-50%);
      }
      .__kodety-gap-control[data-gap-axis="horizontal"] { cursor: ew-resize; }
      .__kodety-gap-control[data-gap-axis="horizontal"]::before {
        width: var(--kodety-direct-gap-marker-short, 3px); height: var(--kodety-direct-gap-marker-long, 12px);
      }
      .__kodety-gap-control[data-gap-axis="vertical"] { cursor: ns-resize; }
      .__kodety-gap-control:hover,
      .__kodety-gap-control:focus-visible {
        outline: var(--kodety-direct-gap-outline, 2px) solid rgba(255, 111, 224, .78);
        outline-offset: calc(-1 * var(--kodety-direct-gap-outline, 2px));
        background: rgba(255, 111, 224, .25);
      }
      html[data-kodety-direct-dragging] .__kodety-gap-control { background: rgba(255, 111, 224, .5); }
      .__kodety-direct-handle {
        position: absolute; width: var(--kodety-direct-handle-size, 8px); height: var(--kodety-direct-handle-size, 8px); padding: 0;
        border: var(--kodety-direct-handle-border, 1px) solid var(--kodety-direct-selection-color); border-radius: 999px; background: #fff;
        box-shadow: none; pointer-events: auto;
        touch-action: none; appearance: none; opacity: .9;
      }
      .__kodety-direct-handle::before {
        content: ""; position: absolute; inset: var(--kodety-direct-handle-hit-inset, -4px);
        border-radius: inherit;
      }
      .__kodety-direct-handle:hover,
      .__kodety-direct-handle:focus-visible {
        opacity: 1;
        outline: var(--kodety-direct-handle-outline, 2px) solid var(--kodety-direct-selection-soft);
        outline-offset: var(--kodety-direct-handle-outline-offset, 2px);
      }
      .__kodety-direct-handle[data-direct-kind="padding-top"] { left: 50%; top: var(--kodety-direct-padding-inset, 9px); transform: translate(-50%,-50%); cursor: ns-resize; }
      .__kodety-direct-handle[data-direct-kind="padding-right"] { right: var(--kodety-direct-padding-inset, 9px); top: 50%; transform: translate(50%,-50%); cursor: ew-resize; }
      .__kodety-direct-handle[data-direct-kind="padding-bottom"] { left: 50%; bottom: var(--kodety-direct-padding-inset, 9px); transform: translate(-50%,50%); cursor: ns-resize; }
      .__kodety-direct-handle[data-direct-kind="padding-left"] { left: var(--kodety-direct-padding-inset, 9px); top: 50%; transform: translate(-50%,-50%); cursor: ew-resize; }
      .__kodety-direct-handle[data-direct-kind^="padding-"] {
        width: var(--kodety-direct-padding-long, 20px); height: var(--kodety-direct-padding-short, 2px);
        border: 0; border-radius: 999px; background: #ff6fe0;
        box-shadow: none;
        opacity: 0; pointer-events: none;
        transition: opacity 90ms ease, width 90ms ease, height 90ms ease;
      }
      .__kodety-direct-handle[data-direct-kind="padding-right"],
      .__kodety-direct-handle[data-direct-kind="padding-left"] {
        width: var(--kodety-direct-padding-short, 2px); height: var(--kodety-direct-padding-long, 20px);
      }
      #__kodety-direct-overlay[data-selected-hover] .__kodety-direct-handle[data-direct-kind^="padding-"],
      #__kodety-direct-overlay[data-spacing-preview] .__kodety-direct-handle[data-direct-kind^="padding-"],
      .__kodety-direct-handle[data-direct-kind^="padding-"]:focus-visible {
        opacity: 1; pointer-events: auto;
      }
      .__kodety-direct-handle[data-direct-kind="border-width"] {
        right: 0; top: 0; transform: translate(55%,-55%);
        width: var(--kodety-direct-corner-size, 8px); height: var(--kodety-direct-corner-size, 8px);
        border-color: #fe9c07; border-radius: 999px; background: #fff; cursor: nwse-resize;
      }
      .__kodety-direct-handle[data-direct-kind="border-radius"] {
        left: var(--kodety-direct-radius-offset, 9px); top: var(--kodety-direct-radius-offset, 9px);
        width: var(--kodety-direct-corner-size, 8px); height: var(--kodety-direct-corner-size, 8px);
        transform: translate(-50%,-50%); cursor: nwse-resize;
        border-color: var(--kodety-direct-selection-color); background: #fff;
      }
      .__kodety-direct-handle[data-direct-kind="resize-width"] {
        right: var(--kodety-direct-edge-hit-offset, -4px); top: 0; transform: none; cursor: ew-resize;
        width: var(--kodety-direct-edge-hit-size, 8px); height: 100%;
        border: 0; border-radius: 0; background: transparent; box-shadow: none; opacity: 0;
      }
      .__kodety-direct-handle[data-direct-kind="resize-height"] {
        left: 0; bottom: var(--kodety-direct-edge-hit-offset, -4px); transform: none; cursor: ns-resize;
        width: 100%; height: var(--kodety-direct-edge-hit-size, 8px);
        border: 0; border-radius: 0; background: transparent; box-shadow: none; opacity: 0;
      }
      .__kodety-direct-handle[data-direct-kind="resize-width"]:hover,
      .__kodety-direct-handle[data-direct-kind="resize-width"]:focus-visible,
      .__kodety-direct-handle[data-direct-kind="resize-height"]:hover,
      .__kodety-direct-handle[data-direct-kind="resize-height"]:focus-visible {
        opacity: 0; outline: none; background: transparent;
      }
      .__kodety-direct-corner {
        position: absolute; z-index: 2;
        width: var(--kodety-direct-corner-size, 8px); height: var(--kodety-direct-corner-size, 8px);
        border: var(--kodety-direct-corner-border, 1px) solid var(--kodety-direct-selection-color);
        border-radius: var(--kodety-direct-corner-radius, 999px);
        box-sizing: border-box; background: #fff; pointer-events: none;
      }
      .__kodety-direct-corner[data-corner="top-left"] { left: 0; top: 0; transform: translate(-50%,-50%); }
      .__kodety-direct-corner[data-corner="top-right"] { right: 0; top: 0; transform: translate(50%,-50%); }
      .__kodety-direct-corner[data-corner="bottom-right"] { right: 0; bottom: 0; transform: translate(50%,50%); }
      .__kodety-direct-corner[data-corner="bottom-left"] { left: 0; bottom: 0; transform: translate(-50%,50%); }
      .__kodety-direct-handle[data-direct-kind="rotate"] {
        z-index: 3; width: var(--kodety-direct-rotate-size, 20px); height: var(--kodety-direct-rotate-size, 20px);
        border: 0; border-radius: 0; background: transparent; box-shadow: none;
        opacity: 1;
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cpath d='M15.5 8A6 6 0 1 0 16 12' fill='none' stroke='%23fff' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M15.5 8A6 6 0 1 0 16 12' fill='none' stroke='%23111418' stroke-width='1.6' stroke-linecap='round'/%3E%3Cpath d='M12.4 7.9h3.4V4.5' fill='none' stroke='%23fff' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M12.4 7.9h3.4V4.5' fill='none' stroke='%23111418' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 10 10, crosshair;
      }
      .__kodety-direct-handle[data-direct-kind="rotate"]::before { inset: 0; }
      .__kodety-direct-handle[data-direct-kind="rotate"]:hover,
      .__kodety-direct-handle[data-direct-kind="rotate"]:focus-visible { outline: none; }
      .__kodety-direct-handle[data-rotate-corner="top-left"] { left: 0; top: 0; transform: translate(-100%,-100%); }
      .__kodety-direct-handle[data-rotate-corner="top-right"] { right: 0; top: 0; transform: translate(100%,-100%); }
      .__kodety-direct-handle[data-rotate-corner="bottom-right"] { right: 0; bottom: 0; transform: translate(100%,100%); }
      .__kodety-direct-handle[data-rotate-corner="bottom-left"] { left: 0; bottom: 0; transform: translate(-100%,100%); }
      #__kodety-direct-size-label {
        position: absolute; z-index: 3; left: 50%; bottom: var(--kodety-direct-size-label-offset, -9px); transform: translate(-50%,100%);
        display: inline-flex; align-items: center; justify-content: center;
        min-width: var(--kodety-direct-size-label-min-width, 40px); width: max-content;
        height: var(--kodety-direct-size-label-height, 20px); box-sizing: border-box;
        padding: 0 var(--kodety-direct-size-label-pad-x, 6px);
        border-radius: var(--kodety-direct-size-label-radius, 4px);
        color: #fff; background: var(--kodety-direct-selection-color);
        font: 600 var(--kodety-direct-size-label-font, 10px)/1.2 ui-sans-serif,system-ui,sans-serif;
        box-shadow: 0 1px 3px rgba(0,0,0,.28); pointer-events: none;
      }
      #__kodety-direct-size-label[data-feedback-kind^="padding-"],
      #__kodety-direct-size-label[data-feedback-kind="gap"] { background: #ff6fe0; }
      #__kodety-direct-size-label[data-feedback-kind="border-width"] { background: #fe9c07; }
      #__kodety-direct-size-label:empty { display: none; }
      #__kodety-overlay-link-badge {
        position: absolute; z-index: 4; right: -1px; top: var(--kodety-direct-label-offset, -12px); transform: translateY(-100%);
        display: inline-flex; min-width: max-content; align-items: center; gap: 5px;
        color: #72b5a3;
        font: 600 10px/1.2 ui-sans-serif,system-ui,sans-serif;
        text-shadow: 0 1px 2px rgba(0,0,0,.65); pointer-events: none;
      }
      #__kodety-overlay-link-badge::before { content: ""; width: 5px; height: 5px; border-radius: 999px; background: currentColor; }
      #__kodety-overlay-link-badge[hidden] { display: none; }
      html[data-kodety-direct-dragging] *, html[data-kodety-direct-dragging] { user-select: none; cursor: grabbing; }
      [data-html-editor-editing] {
        outline: none !important;
        cursor: text !important;
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      html[data-kodety-text-editing] #__kodety-direct-overlay { display: none !important; }
      html[data-kodety-canvas-tool="frame"],
      html[data-kodety-canvas-tool="frame"] *,
      html[data-kodety-canvas-tool="stack"],
      html[data-kodety-canvas-tool="stack"] *,
      html[data-kodety-canvas-tool="grid"],
      html[data-kodety-canvas-tool="grid"] *,
      html[data-kodety-canvas-tool="masonry"],
      html[data-kodety-canvas-tool="masonry"] *,
      html[data-kodety-canvas-tool="image"],
      html[data-kodety-canvas-tool="image"] *,
      html[data-kodety-canvas-tool="video"],
      html[data-kodety-canvas-tool="video"] *,
      html[data-kodety-canvas-tool="text-block"],
      html[data-kodety-canvas-tool="text-block"] * { cursor: crosshair; }
      html[data-kodety-canvas-tool],
      html[data-kodety-canvas-tool] body {
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      #__kodety-draw-overlay {
        position: fixed; z-index: 2147483647; display: none; box-sizing: border-box;
        min-width: 1px; min-height: 1px; pointer-events: none;
        border: 1.5px solid #9393FF; background: rgba(147, 147, 255, .11);
        box-shadow: 0 0 0 1px rgba(255,255,255,.6), inset 0 0 0 1px rgba(147,147,255,.15);
      }
      #__kodety-draw-overlay[data-active] { display: block; }
      #__kodety-draw-label {
        position: absolute; left: 0; top: -8px; transform: translateY(-100%);
        min-width: max-content; padding: 4px 7px; border-radius: 5px;
        background: #111318; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35);
        font: 600 10px/1.2 ui-sans-serif,system-ui,sans-serif;
      }
      #__kodety-tool-hint {
        display: none !important;
      }
    `;
    document.head.appendChild(editorStyle);
  }

  // Preserve authored direct-binding values before the initial CMS payload is
  // materialized. The persistent canvas later uses these baselines when a
  // binding is changed or removed through View State, without rebuilding the
  // document just to recover the authored text/attribute.
  const authoredCmsBindingSnapshots = Array.from(
    document.querySelectorAll(CMS_BINDING_SELECTOR),
  ).map(element => ({
    path: element.getAttribute('data-html-editor-path') || '',
    html: element.innerHTML,
    attributes: Object.fromEntries(
      Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]),
    ),
    styles: Object.fromEntries(
      ['object-position', 'aspect-ratio', 'object-fit'].map(property => [
        property,
        {
          value: (element as HTMLElement).style?.getPropertyValue(property) || '',
          priority: (element as HTMLElement).style?.getPropertyPriority(property) || '',
        },
      ]),
    ),
  }));

  // CMS data reaches the iframe through postMessage, after authored scripts
  // have already started. Animation runtimes commonly apply their hidden
  // `from` state to the collection template during that gap. If the CMS bridge
  // later clones the live template, every clone inherits that hidden state but
  // is not part of the timeline that would reveal it. Keep an inert, pristine
  // copy of each collection after preview asset/path rewriting and consume it
  // before deferred/module project scripts run. <template> contents do not
  // participate in document selectors, layout or authored animations.
  document.querySelectorAll('[data-kodety-collection]').forEach((container, index) => {
    const snapshotId = `collection-${index}`;
    container.setAttribute('data-html-editor-cms-snapshot-id', snapshotId);
    const snapshot = document.createElement('template');
    snapshot.setAttribute('data-html-editor-cms-snapshot', snapshotId);
    snapshot.innerHTML = container.outerHTML;
    document.body.appendChild(snapshot);
  });

  // The published runtime renders CMS rows before page JavaScript starts.
  // Match that ordering in the iframe so GSAP/ScrollTrigger includes the real
  // rows when it resolves selectors and creates timelines.
  materializeInitialCmsPreview(document, initialCmsPreview);
  materializeInitialKodefyPreview(document, initialKodefyPreview);

  const normalizedInitialScrollPositions =
    normalizePreviewScrollPositions(initialScrollPositions);
  const hasGuardedInitialScroll = inspectionEnabled
    && !infiniteCanvasNavigation
    && Object.keys(normalizedInitialScrollPositions).length > 0;
  if (hasGuardedInitialScroll) {
    // This marker and stylesheet are present in the serialized document, so
    // the bridge restores the captured viewport with instant scroll semantics.
    // The parent now keeps the previous iframe painted until this generation
    // loads, so hiding this document would only create a white handoff.
    document.documentElement.setAttribute(
      'data-html-editor-scroll-restore-pending',
      '',
    );
    const scrollRestoreGuardStyle = document.createElement('style');
    scrollRestoreGuardStyle.setAttribute(
      'data-html-editor-scroll-restore-guard',
      '',
    );
    scrollRestoreGuardStyle.textContent = `
      :root[data-html-editor-scroll-restore-pending] {
        scroll-behavior: auto;
      }
      :root[data-html-editor-scroll-restore-pending] * {
        scroll-behavior: auto;
      }
    `;
    document.head.insertBefore(
      scrollRestoreGuardStyle,
      document.head.firstChild,
    );
    // Fail open if an unexpected bridge/runtime error prevents the normal
    // two-frame restoration from completing. This never runs on the healthy
    // path because the bridge clears the timer before revealing the canvas.
    const scrollRestoreFallback = document.createElement('script');
    scrollRestoreFallback.setAttribute(
      'data-html-editor-scroll-restore-fallback',
      '',
    );
    scrollRestoreFallback.textContent = `window.__KODETY_EDITOR_SCROLL_RESTORE_FALLBACK__ = window.setTimeout(() => {
      document.documentElement.removeAttribute('data-html-editor-scroll-restore-pending');
    }, ${PREVIEW_SCROLL_RESTORE_FAIL_OPEN_MS});`;
    document.head.insertBefore(
      scrollRestoreFallback,
      document.head.firstChild,
    );
  }

  const serializedInitialCmsPreview = JSON.stringify(initialCmsPreview || null).replace(/</g, '\\u003c');
  const serializedAuthoredCmsBindingSnapshots = JSON
    .stringify(authoredCmsBindingSnapshots)
    .replace(/</g, '\\u003c');
  const serializedInitialScrollPositions = JSON
    .stringify(
      hasGuardedInitialScroll ? normalizedInitialScrollPositions : {},
    )
    .replace(/</g, '\\u003c');
  const serializedCanvasGeneration = JSON.stringify(canvasGeneration).replace(/</g, '\\u003c');
  const serializedCanvasRevision = JSON.stringify(
    Number.isSafeInteger(canvasRevision) && canvasRevision >= 0 ? canvasRevision : 0,
  );
  const serializedPreviewSiteUrl = JSON.stringify(previewSiteUrl).replace(/</g, '\\u003c');
  const serializedCssShorthandLonghands = JSON.stringify(CSS_SHORTHAND_LONGHANDS)
    .replace(/</g, '\\u003c');

  // Author scripts run inside a srcdoc document, where a RELATIVE url assigned
  // Only references actually encountered in HTML, CSS or the ESM graph need
  // to cross the iframe boundary. Framer packages may contain hundreds of
  // unused responsive variants; eagerly cloning all of them made the canvas
  // unresponsive and amplified duplicate assets on every preview rebuild.
  const runtimeAssetUrls = Object.fromEntries(
    // A placeholder means the iframe must receive bytes and create the Blob in
    // its own opaque origin. Detect that protocol directly instead of trying
    // to predict every possible asset extension.
    Array.from(urlCache.entries()).filter(([, url]) => url.startsWith('data:,kodety-runtime-asset-')),
  );
  // The isolated component master has no authored runtime. Its statically
  // referenced files are already present in runtimeAssetUrls, so serializing
  // the complete project manifest into every master srcdoc is pure overhead.
  const availableRuntimeAssetPaths = componentEditorCanvas
    ? Object.keys(runtimeAssetUrls)
    : cachedRuntimeAssetAvailablePaths(project);
  const runtimeAssetAliases = {
    ...runtimeAssetPathAliases(project, availableRuntimeAssetPaths),
    ...runtimeAssetPathAliases(project, Object.keys(runtimeAssetUrls)),
  };
  const serializedRuntimeAssets = JSON.stringify({
    urls: runtimeAssetUrls,
    pathAliases: runtimeAssetAliases,
    availablePaths: availableRuntimeAssetPaths,
    baseFile: project.mainHtmlPath,
    rootPath,
  }).replace(/</g, '\\u003c');
  const serializedRuntimeFontAssetPaths = JSON.stringify(
    projectFontRuntimeAssetPaths,
  ).replace(/</g, '\\u003c');

  const bridge = document.createElement('script');
  bridge.textContent = `(() => {
    // Code Components read RenderTarget during module evaluation. This classic
    // bridge runs before deferred modules, so Design receives Canvas while the
    // executable Preview keeps normal pointer behavior.
    globalThis.__CODAY_RENDER_TARGET__ = ${inspectionEnabled ? "'canvas'" : "'preview'"};
    // Motion-frozen canvases replace the page's scheduling clocks. The editor
    // bridge keeps private access to the native clock so selection overlays,
    // CMS refresh and direct-manipulation feedback remain fully responsive.
    const editorClock = window.__KODETY_EDITOR_NATIVE_CLOCK__ || {};
    const requestAnimationFrame = editorClock.requestAnimationFrame || window.requestAnimationFrame.bind(window);
    const cancelAnimationFrame = editorClock.cancelAnimationFrame || window.cancelAnimationFrame.bind(window);
    const setTimeout = editorClock.setTimeout || window.setTimeout.bind(window);
    const clearTimeout = editorClock.clearTimeout || window.clearTimeout.bind(window);
    const setInterval = editorClock.setInterval || window.setInterval.bind(window);
    const clearInterval = editorClock.clearInterval || window.clearInterval.bind(window);
    const requestIdleCallback = editorClock.requestIdleCallback || window.requestIdleCallback?.bind(window);
    const cancelIdleCallback = editorClock.cancelIdleCallback || window.cancelIdleCallback?.bind(window);
    window.parent.postMessage({ type: 'html-editor-buffer-ready' }, '*');
    // This classic bridge is parsed after the authored body but before deferred
    // module scripts. Capture the real, pre-animation inline state now; GSAP
    // modules loaded by the project cannot overwrite the authoring canvas with
    // their hidden/from state afterwards.
    window.__KODETY_CAPTURE_EDITOR_MOTION_BASE__?.(document.body);
    const startEditorBridge = () => {
    const passiveBreakpointPreview = document.documentElement.hasAttribute('data-kodety-passive-breakpoint-preview');
    // Reference breakpoints need live CSS/data projection, asset hydration and
    // generation validation, but never selection snapshots, direct controls or
    // editable chrome. Keeping those paths asleep is what lets every reference
    // mount together without multiplying the active editor's runtime cost.
    const inspectionEnabled = ${inspectionEnabled ? 'true' : 'false'} && !passiveBreakpointPreview;
    const contentEditing = ${contentEditing ? 'true' : 'false'} && !passiveBreakpointPreview;
    const interactivePreview = !inspectionEnabled && !passiveBreakpointPreview;
    const motionFrozen = ${freezeMotion ? 'true' : 'false'};
    const infiniteCanvasNavigation = ${infiniteCanvasNavigation ? 'true' : 'false'};
    const initialScrollPositions = ${serializedInitialScrollPositions};
    const editorGeneration = ${serializedCanvasGeneration};
    const editorRevision = ${serializedCanvasRevision};
    let framerRuntimeLoadError = false;
    addEventListener('error', event => {
      if (event.target?.tagName === 'SCRIPT' && event.target.hasAttribute('data-kodety-framer-compat-runtime')) framerRuntimeLoadError = true;
    }, true);
    const previewSiteUrl = ${serializedPreviewSiteUrl};
    const cssShorthandLonghands = ${serializedCssShorthandLonghands};
    // Unlike generation (which changes only when srcDoc is rebuilt), this
    // revision advances after each ACK-able live mutation. Every selection
    // snapshot carries it so the parent can reject an older view of the same
    // element instead of rolling its Inspector back.
    let appliedEditorRevision = editorRevision;
    // This identifier expires whenever srcDoc is rebuilt. It prevents queued
    // messages from an older iframe from mutating the current editor, but is
    // intentionally not treated as a secret because authored code shares this
    // isolated iframe realm.
    window.__KODETY_EDITOR_GENERATION__ = editorGeneration;
    if (interactivePreview) {
      document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const opener = target.closest('[data-kodety-lightbox-open]');
        if (opener) {
          event.preventDefault();
          const root = opener.closest('[data-kodety-lightbox]');
          const dialog = root?.querySelector('[data-kodety-lightbox-dialog]');
          const thumbnail = root?.querySelector('[data-kodety-lightbox-thumb]');
          const fullImage = dialog?.querySelector('[data-kodety-lightbox-image]');
          const fullSource = root?.getAttribute('data-kodety-lightbox-src')
            || thumbnail?.currentSrc
            || thumbnail?.getAttribute('src')
            || '';
          if (fullImage instanceof HTMLImageElement) {
            if (fullSource) fullImage.src = fullSource;
            else fullImage.removeAttribute('src');
            fullImage.alt = thumbnail?.getAttribute('alt') || '';
          }
          if (dialog instanceof HTMLDialogElement && !dialog.open) {
            dialog.showModal();
            dialog.querySelector('[data-kodety-lightbox-close]:last-child')?.focus?.();
          }
          return;
        }
        const closer = target.closest('[data-kodety-lightbox-close]');
        if (closer) {
          event.preventDefault();
          closer.closest('dialog')?.close?.();
          return;
        }
        document.querySelectorAll('[data-kodety-locale-selector][open]').forEach(selector => {
          if (!selector.contains(target)) selector.removeAttribute('open');
        });
        const localeOption = target.closest('[data-kodety-locale-option]');
        if (localeOption?.getAttribute('href') === '#') event.preventDefault();
      });
    }
    const normalizeRuntimeStyleProperty = property => {
      const normalized = String(property || '').trim();
      return normalized.startsWith('--') ? normalized : normalized.toLowerCase();
    };
    const postEditorMessage = message => parent.postMessage({ ...message, generation: editorGeneration }, '*');
    // Authored interaction runtimes are generated before this bridge and must
    // never post unscoped data straight at the editor. Expose the same
    // generation-bound channel used by every other canvas message.
    window.__KODETY_POST_EDITOR_MESSAGE__ = postEditorMessage;
    const isCurrentEditorMessage = event => event.source === parent
      && event.data
      && typeof event.data === 'object'
      && event.data.generation === editorGeneration
      && typeof event.data.type === 'string';
    const editorMessageListeners = [];
    const registerEditorMessageListener = listener => {
      editorMessageListeners.push(listener);
      addEventListener('message', listener, true);
    };
    if (infiniteCanvasNavigation) {
      // Navigation is owned by the outer design plane. Content-height fitting
      // and the editor-only per-section viewport simulation are appended by
      // injectInfiniteCanvasRuntime(), after this common preview bridge.
      document.addEventListener('wheel', event => {
        event.preventDefault();
        postEditorMessage({
          type: 'html-editor-infinite-canvas-wheel',
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          zoom: event.ctrlKey || event.metaKey,
          pan: event.altKey,
          x: event.clientX,
          y: event.clientY,
        });
      }, { capture: true, passive: false });
      const acceptsSpace = target => !(
        target instanceof Element
        && target.closest('button, a, input, textarea, select, [role], [contenteditable="true"]')
      );
      document.addEventListener('keydown', event => {
        if (event.code !== 'Space' || event.repeat || !acceptsSpace(event.target)) return;
        event.preventDefault();
        postEditorMessage({ type: 'html-editor-infinite-canvas-space', pressed: true });
      }, true);
      document.addEventListener('keyup', event => {
        if (event.code !== 'Space') return;
        postEditorMessage({ type: 'html-editor-infinite-canvas-space', pressed: false });
      }, true);
      addEventListener('blur', () => {
        postEditorMessage({ type: 'html-editor-infinite-canvas-space', pressed: false });
      });
    }
    const resumeAutoplayMedia = (root = document) => {
      if (motionFrozen) return;
      const media = [];
      if (root instanceof HTMLMediaElement && root.matches('[autoplay]')) media.push(root);
      root.querySelectorAll?.('video[autoplay],audio[autoplay]').forEach(element => media.push(element));
      media.forEach(element => {
        // The muted content attribute is not consistently reflected by the
        // runtime property after srcdoc parsing. Autoplay policy checks the
        // property, so restore it before asking the browser to play.
        if (element.hasAttribute('muted')) {
          element.defaultMuted = true;
          element.muted = true;
        }
        const attempt = () => {
          if (!element.isConnected || !element.hasAttribute('autoplay')) return;
          element.play?.().catch?.(() => {});
        };
        attempt();
        if (element.readyState < 2) element.addEventListener('loadeddata', attempt, { once: true });
      });
    };
    if (!motionFrozen) {
      resumeAutoplayMedia(document);
      addEventListener('DOMContentLoaded', () => resumeAutoplayMedia(document), { once: true });
      addEventListener('load', () => {
        resumeAutoplayMedia(document);
        setTimeout(() => resumeAutoplayMedia(document), 160);
      }, { once: true });
      new MutationObserver(mutations => mutations.forEach(mutation =>
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) resumeAutoplayMedia(node);
        })
      )).observe(document.documentElement, { subtree: true, childList: true });
    }
    // Runtime-assigned relative urls resolve against about:srcdoc and 404.
    // Rewrite them to the object urls the parent prepared for every project
    // media asset, so lazy-loaded videos/images and fetched local JSON render
    // in the canvas exactly like in real Preview.
    const runtimeAssets = ${serializedRuntimeAssets};
    const runtimeFontAssetPaths = ${serializedRuntimeFontAssetPaths};
    const availableRuntimeAssetPaths = Array.isArray(runtimeAssets.availablePaths)
      ? runtimeAssets.availablePaths
      : Object.keys(runtimeAssets.urls || {});
    const availableRuntimeAssetPathSet = new Set(availableRuntimeAssetPaths);
    const availableRuntimeAssetPathByLower = new Map(
      availableRuntimeAssetPaths.map(path => [String(path).toLowerCase(), path]),
    );
    const runtimeAssetAliasByLower = new Map(
      Object.entries(runtimeAssets.pathAliases || {}).map(([alias, canonical]) => [
        String(alias).toLowerCase(),
        canonical,
      ]),
    );
    // Runtime-created URLs are resolved repeatedly by attribute observers,
    // CSS sweeps and lazy media. Keep exact/basename lookups O(1), and memoize
    // the uncommon suffix fallback after its first scan. Ambiguous names stay
    // unresolved exactly as before instead of choosing an arbitrary file.
    const runtimeAssetUniqueBasenameByLower = new Map();
    const ambiguousRuntimeAssetBasenames = new Set();
    const runtimeAssetUniqueSuffixCache = new Map();
    const indexRuntimeAssetBasename = path => {
      const normalized = String(path || '').replace(/\\\\/g, '/').toLowerCase();
      const basename = normalized.split('/').pop();
      if (!basename || ambiguousRuntimeAssetBasenames.has(basename)) return;
      const existing = runtimeAssetUniqueBasenameByLower.get(basename);
      if (existing && existing !== path) {
        runtimeAssetUniqueBasenameByLower.delete(basename);
        ambiguousRuntimeAssetBasenames.add(basename);
        return;
      }
      runtimeAssetUniqueBasenameByLower.set(basename, path);
    };
    availableRuntimeAssetPaths.forEach(indexRuntimeAssetBasename);
    const uniqueRuntimeAssetSuffix = normalizedRaw => {
      if (runtimeAssetUniqueSuffixCache.has(normalizedRaw)) {
        return runtimeAssetUniqueSuffixCache.get(normalizedRaw) || null;
      }
      let match = null;
      for (const candidate of availableRuntimeAssetPaths) {
        const normalized = String(candidate).replace(/\\\\/g, '/').toLowerCase();
        if (normalized !== normalizedRaw && !normalized.endsWith('/' + normalizedRaw)) continue;
        if (match !== null) {
          match = '';
          break;
        }
        match = candidate;
      }
      runtimeAssetUniqueSuffixCache.set(normalizedRaw, match || '');
      return match || null;
    };
    const registerRuntimeAssetPath = path => {
      const normalized = String(path || '').replace(/\\\\/g, '/').replace(/^\\/+/, '');
      if (!normalized) return;
      if (!availableRuntimeAssetPathSet.has(normalized)) {
        availableRuntimeAssetPaths.push(normalized);
        availableRuntimeAssetPathSet.add(normalized);
        indexRuntimeAssetBasename(normalized);
        runtimeAssetUniqueSuffixCache.clear();
      }
      availableRuntimeAssetPathByLower.set(normalized.toLowerCase(), normalized);
      runtimeAssets.availablePaths = availableRuntimeAssetPaths;
    };
    const registerRuntimeAssetAliases = aliases => {
      Object.entries(aliases || {}).forEach(([alias, canonical]) => {
        if (!alias || typeof canonical !== 'string' || !canonical) return;
        runtimeAssets.pathAliases = runtimeAssets.pathAliases || {};
        runtimeAssets.pathAliases[alias] = canonical;
        runtimeAssetAliasByLower.set(String(alias).toLowerCase(), canonical);
      });
    };
    const resolveRuntimeAssetPath = (raw, allowUnregistered = false) => {
      if (!raw || String(raw).length > 4096) return null;
      const runtimeMarker = 'data:,kodety-runtime-asset-';
      if (String(raw).startsWith(runtimeMarker)) {
        let markedPath = String(raw).slice(runtimeMarker.length);
        try { markedPath = decodeURIComponent(markedPath); } catch {}
        if (availableRuntimeAssetPathSet.has(markedPath)) return markedPath;
        const directMarked = availableRuntimeAssetPathByLower.get(markedPath.toLowerCase());
        if (directMarked) return directMarked;
        const markedAlias = runtimeAssetAliasByLower.get(markedPath.toLowerCase());
        return markedAlias && availableRuntimeAssetPathSet.has(markedAlias)
          ? markedAlias
          : null;
      }
      let value = String(raw);
      let sameBaseAbsolute = false;
      if (/^(?:https?:)?\\/\\//i.test(value)) {
        // Reading image.src turns a relative project path into an absolute
        // Builder URL because srcdoc inherits its embedding document's base.
        // Treat only that same-base projection as local; genuine remote assets
        // keep their network semantics and are never shadowed by a same-named
        // project file.
        try {
          const absolute = new URL(value, document.baseURI);
          const base = new URL(document.baseURI);
          const baseDirectory = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
          if (
            !/^https?:$/i.test(absolute.protocol)
            || !/^https?:$/i.test(base.protocol)
            || absolute.origin !== base.origin
            || !absolute.pathname.startsWith(baseDirectory)
          ) return null;
          value = absolute.pathname.slice(baseDirectory.length);
          sameBaseAbsolute = true;
        } catch {
          return null;
        }
      }
      if (/^(data:|blob:|#|mailto:|tel:|javascript:|about:)/i.test(value)) return null;
      value = value.split('#')[0].split('?')[0];
      try { value = decodeURIComponent(value); } catch {}
      const dirOf = p => p.split('/').slice(0, -1).join('/');
      const stack = (value.startsWith('/') ? runtimeAssets.rootPath : dirOf(runtimeAssets.baseFile)).split('/').filter(Boolean);
      value.split('/').forEach(part => {
        if (part === '..') stack.pop();
        else if (part !== '.' && part) stack.push(part);
      });
      const path = stack.join('/');
      if (availableRuntimeAssetPathSet.has(path)) return path;
      const alias = runtimeAssets.pathAliases?.[path];
      if (alias && availableRuntimeAssetPathSet.has(alias)) return alias;
      const lower = path.toLowerCase();
      const direct = availableRuntimeAssetPathByLower.get(lower);
      if (direct) return direct;
      const canonical = runtimeAssetAliasByLower.get(lower);
      if (canonical && availableRuntimeAssetPathSet.has(canonical)) return canonical;
      if (sameBaseAbsolute) {
        return allowUnregistered
          && path
          && (path.startsWith('assets/') || path.includes('/assets/'))
          ? path
          : null;
      }
      // Runtime-created CSS/FontFace values may be evaluated from a data:
      // module and lose the original stylesheet directory. Recover the exact
      // ZIP asset only when its suffix/basename is unique, mirroring the
      // forgiving project resolver used while building the initial document.
      const normalizedRaw = value.replace(/^\\/+/, '').replace(/\\\\/g, '/').toLowerCase();
      const suffixMatch = uniqueRuntimeAssetSuffix(normalizedRaw);
      if (suffixMatch) return suffixMatch;
      const basename = normalizedRaw.split('/').pop();
      if (basename && !ambiguousRuntimeAssetBasenames.has(basename)) {
        const basenameMatch = runtimeAssetUniqueBasenameByLower.get(basename);
        if (basenameMatch) return basenameMatch;
      }
      // A Code Component upload can race its transferable asset message. Its
      // new path is not in availableRuntimeAssetPaths yet, but the parent has
      // already committed the project file. Allow only the Builder-owned asset
      // namespace here; the parent performs the final exact project lookup.
      if (
        allowUnregistered
        && path
        && (path.startsWith('assets/') || path.includes('/assets/'))
      ) return path;
      return null;
    };
    const runtimeAssetAliases = {};
    const pendingRuntimeAssetRequests = new Set();
    const runtimeAssetWaiters = new Map();
    const queuedRuntimeAssetRequests = new Set();
    let runtimeAssetRequestFlushScheduled = false;
    const flushRuntimeAssetRequests = () => {
      runtimeAssetRequestFlushScheduled = false;
      const paths = Array.from(queuedRuntimeAssetRequests);
      queuedRuntimeAssetRequests.clear();
      if (!paths.length) return;
      // Both Design and Preview can discover several assets in one parser
      // task. The parent already accepts bounded batches, so collapse them into
      // one message and one content-dedupe pass instead of one transfer setup
      // per file. Keep the protocol cap when authored code queues a large set.
      for (let offset = 0; offset < paths.length; offset += 1024) {
        postEditorMessage({
          type: 'html-editor-runtime-assets-request',
          paths: paths.slice(offset, offset + 1024),
        });
      }
    };
    const enqueueRuntimeAssetRequest = path => {
      queuedRuntimeAssetRequests.add(path);
      if (runtimeAssetRequestFlushScheduled) return;
      runtimeAssetRequestFlushScheduled = true;
      queueMicrotask(flushRuntimeAssetRequests);
    };
    let scheduleBufferedVisualAssetSettlement = () => {};
    const usableRuntimeAssetUrl = path => {
      const value = runtimeAssets.urls[path];
      return value && !String(value).startsWith('data:,kodety-runtime-asset-') ? value : null;
    };
    const runtimeAssetUrl = raw => {
      const aliasedPath = runtimeAssetAliases[String(raw || '')];
      const hash = String(raw || '').includes('#') ? '#' + String(raw).split('#').slice(1).join('#') : '';
      const aliasedUrl = aliasedPath ? usableRuntimeAssetUrl(aliasedPath) : null;
      if (aliasedUrl) return aliasedUrl + hash;
      const path = resolveRuntimeAssetPath(raw);
      const url = path ? usableRuntimeAssetUrl(path) : null;
      return url ? url + hash : null;
    };
    const requestRuntimeAssetUrl = (raw, apply, allowUnregistered = false) => {
      const path = resolveRuntimeAssetPath(raw, allowUnregistered);
      if (!path) return false;
      const current = runtimeAssetUrl(raw);
      if (current) {
        apply(current);
        return true;
      }
      const waiters = runtimeAssetWaiters.get(path) || [];
      const waiter = () => {
        const resolved = runtimeAssetUrl(raw);
        if (resolved) apply(resolved);
      };
      waiter.__kodetyRuntimeAssetApply = apply;
      waiters.push(waiter);
      runtimeAssetWaiters.set(path, waiters);
      if (!pendingRuntimeAssetRequests.has(path)) {
        pendingRuntimeAssetRequests.add(path);
        enqueueRuntimeAssetRequest(path);
      }
      return true;
    };
    const cancelRuntimeAssetUrlRequest = (raw, apply, allowUnregistered = false) => {
      const path = resolveRuntimeAssetPath(raw, allowUnregistered);
      if (!path) return;
      const waiters = runtimeAssetWaiters.get(path) || [];
      const remaining = waiters.filter(waiter => waiter.__kodetyRuntimeAssetApply !== apply);
      if (remaining.length) {
        runtimeAssetWaiters.set(path, remaining);
        return;
      }
      runtimeAssetWaiters.delete(path);
      pendingRuntimeAssetRequests.delete(path);
      queuedRuntimeAssetRequests.delete(path);
    };
    const resolveRuntimeAssetUrlForComponent = raw => {
      if (typeof raw !== 'string' || !raw) return Promise.resolve(raw);
      const current = runtimeAssetUrl(raw);
      if (current) return Promise.resolve(current);
      return new Promise(resolve => {
        let settled = false;
        let failOpenTimer = 0;
        const finish = value => {
          if (settled) return;
          settled = true;
          if (failOpenTimer) clearTimeout(failOpenTimer);
          resolve(typeof value === 'string' && value ? value : raw);
        };
        const accepted = requestRuntimeAssetUrl(raw, finish, true);
        if (!accepted) {
          finish(raw);
          return;
        }
        // Missing optional media must not hold the React instance forever. A
        // valid freshly uploaded asset normally arrives in the next task; this
        // is only the bounded fail-open for a stale/missing project reference.
        failOpenTimer = setTimeout(() => {
          cancelRuntimeAssetUrlRequest(raw, finish, true);
          finish(runtimeAssetUrl(raw) || raw);
        }, 2500);
      });
    };
    globalThis.__KODETY_RESOLVE_RUNTIME_ASSET_URL__ = resolveRuntimeAssetUrlForComponent;
    const runtimeStyleRewriteScheduled = new WeakSet();
    const runtimeStyleElements = new Set();
    let runtimeStyleRefreshScheduled = false;
    const rewriteRuntimeAssetCssTokens = ${rewriteCssAssetUrls.toString()};
    const rewriteRuntimeCssText = (value, retry, requestMissing = !motionFrozen) => rewriteRuntimeAssetCssTokens(String(value || ''), authored => {
      const mapped = runtimeAssetUrl(authored);
      if (mapped) return mapped;
      if (requestMissing) requestRuntimeAssetUrl(authored, retry);
      return null;
    });
    const rewriteRuntimeStyle = style => {
      if (!(style instanceof HTMLStyleElement)) return;
      runtimeStyleElements.add(style);
      const current = style.textContent || '';
      const retry = () => {
        if (!style.isConnected || runtimeStyleRewriteScheduled.has(style)) return;
        runtimeStyleRewriteScheduled.add(style);
        queueMicrotask(() => {
          runtimeStyleRewriteScheduled.delete(style);
          rewriteRuntimeStyle(style);
        });
      };
      const next = rewriteRuntimeCssText(current, retry);
      if (next !== current) style.textContent = next;
    };
    const scheduleRuntimeStyleRefresh = () => {
      if (runtimeStyleRefreshScheduled) return;
      runtimeStyleRefreshScheduled = true;
      queueMicrotask(() => {
        runtimeStyleRefreshScheduled = false;
        runtimeStyleElements.forEach(style => {
          if (style.isConnected) rewriteRuntimeStyle(style);
          else runtimeStyleElements.delete(style);
        });
      });
    };
    const sweepRuntimeStyles = root => {
      if (root instanceof HTMLStyleElement) rewriteRuntimeStyle(root);
      root.querySelectorAll?.('style').forEach(rewriteRuntimeStyle);
    };
    const settleRuntimeAssetWaiters = path => {
      pendingRuntimeAssetRequests.delete(path);
      const waiters = runtimeAssetWaiters.get(path) || [];
      runtimeAssetWaiters.delete(path);
      waiters.forEach(waiter => {
        try { waiter(); } catch {}
      });
      scheduleBufferedVisualAssetSettlement();
    };
    const parseRuntimeSrcset = ${parseSrcsetCandidates.toString()};
    const runtimeSrcsetCandidate = (element, value) => {
      const candidates = parseRuntimeSrcset(value);
      if (!candidates.length) return null;
      if (!motionFrozen || candidates.length === 1) return candidates[0];
      const target = element instanceof HTMLSourceElement
        ? element.closest('picture')?.querySelector('img') || element.closest('picture') || element
        : element;
      const rect = target.getBoundingClientRect?.();
      const renderedWidth = Math.max(
        1,
        rect?.width || target.clientWidth || document.documentElement.clientWidth || innerWidth || 1,
      );
      const density = Math.max(1, Math.min(3, Number(devicePixelRatio) || 1));
      const widthCandidates = candidates
        .map(candidate => ({ ...candidate, width: Number.parseFloat(candidate.descriptor) }))
        .filter(candidate => /w$/i.test(candidate.descriptor) && Number.isFinite(candidate.width))
        .sort((a, b) => a.width - b.width);
      if (widthCandidates.length) {
        const requiredWidth = renderedWidth * density;
        return widthCandidates.find(candidate => candidate.width >= requiredWidth)
          || widthCandidates[widthCandidates.length - 1];
      }
      const densityCandidates = candidates
        .map(candidate => ({ ...candidate, density: Number.parseFloat(candidate.descriptor) || 1 }))
        .filter(candidate => !candidate.descriptor || /x$/i.test(candidate.descriptor))
        .sort((a, b) => a.density - b.density);
      return densityCandidates.find(candidate => candidate.density >= density)
        || densityCandidates[densityCandidates.length - 1]
        || candidates[0];
    };
    const rewriteRuntimeSrcset = (value, element) => {
      const candidates = motionFrozen && element
        ? [runtimeSrcsetCandidate(element, value)].filter(Boolean)
        : parseRuntimeSrcset(value);
      return candidates.map(candidate => {
        const mapped = runtimeAssetUrl(candidate.url);
        return (mapped || candidate.url) + (candidate.descriptor ? ' ' + candidate.descriptor : '');
      }).join(', ');
    };
    const RUNTIME_ASSET_ATTRIBUTES = ['src', 'poster', 'imagesrcset', 'data-video-urls', 'srcset', 'data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'data-lazy-srcset', 'data-poster', 'data-poster-url', 'data', 'background', 'href', 'xlink:href'];
    const RUNTIME_ASSET_SELECTOR = '[src], [poster], [imagesrcset], [data-video-urls], [srcset], [data-src], [data-lazy-src], [data-original], [data-srcset], [data-lazy-srcset], [data-poster], [data-poster-url], object[data], [background], image[href], use[href], image[xlink\\\\:href], use[xlink\\\\:href]';
    const runtimeAttributeApplies = (element, name) => {
      const tag = element.tagName.toLowerCase();
      if (name === 'data') return tag === 'object';
      if (name === 'href' || name === 'xlink:href') return tag === 'image' || tag === 'use';
      return true;
    };
    const designMediaPayload = (element, name) => {
      if (!motionFrozen) return false;
      const media = element instanceof HTMLMediaElement
        ? element
        : element instanceof HTMLSourceElement
          ? element.closest('video, audio')
          : null;
      if (!media) return false;
      if (
        media instanceof HTMLVideoElement
        && ['poster', 'data-poster', 'data-poster-url'].includes(name)
      ) return false;
      return [
        'src',
        'srcset',
        'data-src',
        'data-lazy-src',
        'data-original',
        'data-srcset',
        'data-lazy-srcset',
        'autoplay',
      ].includes(name);
    };
    const designEmbedPayload = (element, name) => (
      motionFrozen
      && element instanceof HTMLIFrameElement
      && ['src', 'srcdoc', 'allow', 'allowfullscreen'].includes(name)
    );
    const preferredPictureSource = picture => {
      const sources = Array.from(picture?.querySelectorAll?.(':scope > source') || []);
      return sources.find(source => {
        const media = source.getAttribute('media');
        if (!media) return true;
        try { return matchMedia(media).matches; } catch { return false; }
      }) || null;
    };
    const designAssetViewportTarget = element => {
      if (element instanceof HTMLSourceElement) {
        return element.closest('picture')?.querySelector('img')
          || element.closest('picture, video, audio')
          || element;
      }
      if (element instanceof SVGElement) return element.ownerSVGElement || element;
      return element;
    };
    const designAssetNearViewport = element => {
      if (!motionFrozen) return true;
      const target = designAssetViewportTarget(element);
      if (!(target instanceof Element) || !target.isConnected) return false;
      if (target.hasAttribute('data-html-editor-selected')) return true;
      const rect = target.getBoundingClientRect();
      const viewportWidth = Math.max(1, document.documentElement.clientWidth || innerWidth || 1);
      const viewportHeight = Math.max(1, document.documentElement.clientHeight || innerHeight || 1);
      return (
        rect.width > 0
        && rect.height > 0
        && rect.bottom >= -viewportHeight
        && rect.top <= viewportHeight * 2
        && rect.right >= -viewportWidth
        && rect.left <= viewportWidth * 2
      );
    };
    const releasedDesignAssetElements = new WeakSet();
    const deferredDesignAssetsByTarget = new Map();
    const NativeAssetIntersectionObserver = window.__KODETY_EDITOR_NATIVE_INTERSECTION_OBSERVER__;
    let designAssetObserver = null;
    let rewriteRuntimeElement = () => {};
    const releaseDeferredDesignAssetTarget = target => {
      const elements = deferredDesignAssetsByTarget.get(target);
      if (!elements) return;
      deferredDesignAssetsByTarget.delete(target);
      designAssetObserver?.unobserve?.(target);
      elements.forEach(element => {
        if (!element.isConnected) return;
        releasedDesignAssetElements.add(element);
        rewriteRuntimeElement(element, true);
      });
    };
    if (motionFrozen && typeof NativeAssetIntersectionObserver === 'function') {
      designAssetObserver = new NativeAssetIntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) releaseDeferredDesignAssetTarget(entry.target);
        });
      }, { rootMargin: '100% 50%', threshold: 0 });
    }
    const deferDesignRuntimeElement = element => {
      if (!motionFrozen || releasedDesignAssetElements.has(element)) return false;
      const target = designAssetViewportTarget(element);
      if (!(target instanceof Element) || !target.isConnected) return true;
      // Native IntersectionObserver performs this visibility test without a
      // synchronous getBoundingClientRect() for every image in the document.
      // The geometric check remains only as a fallback for older WebViews.
      if (!designAssetObserver && designAssetNearViewport(element)) {
        releasedDesignAssetElements.add(element);
        return false;
      }
      const elements = deferredDesignAssetsByTarget.get(target) || new Set();
      elements.add(element);
      deferredDesignAssetsByTarget.set(target, elements);
      designAssetObserver?.observe?.(target);
      return true;
    };
    const designPreferredImageAttribute = element => {
      const srcsetName = ['data-srcset', 'data-lazy-srcset', 'srcset']
        .find(name => element.hasAttribute(name));
      if (srcsetName) return srcsetName;
      return ['data-src', 'data-lazy-src', 'data-original', 'src']
        .find(name => element.hasAttribute(name)) || null;
    };
    const designAttributeAllowed = (element, name) => {
      if (!motionFrozen) return true;
      if (name === 'data-video-urls' || name === 'imagesrcset') return false;
      if (designMediaPayload(element, name)) return false;
      if (element instanceof HTMLSourceElement && element.closest('picture')) {
        if (preferredPictureSource(element.closest('picture')) !== element) return false;
        return designPreferredImageAttribute(element) === name;
      }
      if (element instanceof HTMLImageElement) {
        if (preferredPictureSource(element.closest('picture'))) return false;
        return designPreferredImageAttribute(element) === name;
      }
      if (element instanceof HTMLVideoElement) {
        const preferredPoster = ['data-poster', 'data-poster-url', 'poster']
          .find(attribute => element.hasAttribute(attribute));
        return preferredPoster === name;
      }
      return true;
    };
    const applyRuntimeAttributeValue = (element, name, resolved, descriptor = '') => {
      const srcset = name === 'srcset' || name === 'data-srcset' || name === 'data-lazy-srcset';
      const renderedValue = srcset
        ? resolved + (descriptor ? ' ' + descriptor : '')
        : resolved;
      if (element.getAttribute(name) !== renderedValue) element.setAttribute(name, renderedValue);
      if (!motionFrozen) return;
      if (srcset) {
        if (element.getAttribute('srcset') !== renderedValue) element.setAttribute('srcset', renderedValue);
        return;
      }
      if (
        element instanceof HTMLImageElement
        && ['data-src', 'data-lazy-src', 'data-original'].includes(name)
      ) {
        if (!element.hasAttribute('src')) {
          element.setAttribute('data-html-editor-canvas-generated-src', '');
        }
        if (element.getAttribute('src') !== resolved) element.setAttribute('src', resolved);
      }
      if (
        element instanceof HTMLVideoElement
        && ['data-poster', 'data-poster-url'].includes(name)
        && element.getAttribute('poster') !== resolved
      ) element.setAttribute('poster', resolved);
    };
    rewriteRuntimeElement = (element, forceDesign = false) => {
      if (!(element instanceof Element) || element.tagName === 'SCRIPT') return;
      if (motionFrozen && !forceDesign && deferDesignRuntimeElement(element)) return;
      let sourceChanged = false;
      RUNTIME_ASSET_ATTRIBUTES.forEach(name => {
        if (!runtimeAttributeApplies(element, name)) return;
        if (!designAttributeAllowed(element, name)) return;
        const value = element.getAttribute(name);
        if (!value) return;
        // Static preview rewriting keeps the authored value in this marker.
        // In the isolated runtime sandbox the parent-created blob URL itself is
        // unreadable, so resolve from the authored path after the iframe has
        // created its own local blobs.
        const authoredValue = element.getAttribute('data-html-editor-canvas-promoted-' + name)
          || element.getAttribute('data-html-editor-original-' + name)
          || value;
        if (name === 'data-video-urls' || name === 'imagesrcset' || (!motionFrozen && ['srcset', 'data-srcset', 'data-lazy-srcset'].includes(name))) {
          const candidates = name === 'data-video-urls'
            ? authoredValue.split(',').map(url => ({ url: url.trim(), descriptor: '' }))
            : parseRuntimeSrcset(authoredValue);
          const refresh = () => {
            if (!element.isConnected) return;
            const currentAuthored = element.getAttribute('data-html-editor-canvas-promoted-' + name)
              || element.getAttribute('data-html-editor-original-' + name) || authoredValue;
            if (currentAuthored !== authoredValue) return;
            const rendered = candidates.map(candidate => (runtimeAssetUrl(candidate.url) || candidate.url)
              + (candidate.descriptor ? ' ' + candidate.descriptor : '')).join(name === 'data-video-urls' ? ',' : ', ');
            if (element.getAttribute(name) !== rendered) element.setAttribute(name, rendered);
          };
          candidates.forEach(candidate => {
            if (!runtimeAssetUrl(candidate.url)) requestRuntimeAssetUrl(candidate.url, refresh);
          });
          refresh();
          return;
        }
        if (name === 'srcset' || name === 'data-srcset' || name === 'data-lazy-srcset') {
          const candidate = runtimeSrcsetCandidate(element, authoredValue);
          if (!candidate) return;
          const mapped = runtimeAssetUrl(candidate.url);
          if (mapped) applyRuntimeAttributeValue(element, name, mapped, candidate.descriptor);
          else requestRuntimeAssetUrl(candidate.url, resolved => {
            if (!element.isConnected) return;
            applyRuntimeAttributeValue(element, name, resolved, candidate.descriptor);
          });
          return;
        }
        const mapped = runtimeAssetUrl(authoredValue);
        if (mapped && mapped !== value) {
          applyRuntimeAttributeValue(element, name, mapped);
          if (element.tagName === 'SOURCE') sourceChanged = true;
        } else if (!mapped) {
          requestRuntimeAssetUrl(authoredValue, resolved => {
            if (!element.isConnected && !['IMG', 'VIDEO', 'AUDIO', 'SOURCE'].includes(element.tagName)) return;
            applyRuntimeAttributeValue(element, name, resolved);
            if (!motionFrozen && element.tagName === 'SOURCE') element.closest('video, audio')?.load?.();
          });
        }
      });
      if (!motionFrozen && sourceChanged) element.closest('video, audio')?.load?.();
    };
    const sweepRuntimeAssets = root => {
      rewriteRuntimeElement(root);
      root.querySelectorAll?.(RUNTIME_ASSET_SELECTOR).forEach(rewriteRuntimeElement);
    };
    const designCssAssetProperties = [
      'backgroundImage',
      'borderImageSource',
      'maskImage',
      'webkitMaskImage',
      'listStyleImage',
      'content',
    ];
    const rewriteRuntimeInlineStyle = element => {
      const current = element.getAttribute?.('style') || '';
      if (!current || !current.includes('kodety-runtime-asset-')) return;
      const next = rewriteRuntimeCssText(current, () => rewriteRuntimeInlineStyle(element), false);
      if (next !== current) element.setAttribute('style', next);
    };
    const requestDesignCssValue = (value, element) => {
      rewriteRuntimeAssetCssTokens(String(value || ''), authored => {
        requestRuntimeAssetUrl(authored, () => {
          rewriteRuntimeInlineStyle(element);
          scheduleRuntimeStyleRefresh();
        });
        return null;
      });
    };
    let visibleDesignAssetFrame = 0;
    const discoverVisibleDesignAssets = () => {
      visibleDesignAssetFrame = 0;
      if (!motionFrozen || !document.body) return;
      // Native IntersectionObserver already owns the potentially large target
      // set. Walking it with getBoundingClientRect() on every scroll defeats
      // the observer and recreates the layout thrash this path is meant to
      // avoid. Only legacy WebViews use the bounded geometric fallback.
      if (!designAssetObserver) {
        deferredDesignAssetsByTarget.forEach((_elements, target) => {
          if (designAssetNearViewport(target)) releaseDeferredDesignAssetTarget(target);
        });
      }
      const candidates = new Set([document.documentElement, document.body]);
      const viewportWidth = Math.max(1, document.documentElement.clientWidth || innerWidth || 1);
      const viewportHeight = Math.max(1, document.documentElement.clientHeight || innerHeight || 1);
      const step = Math.max(160, Math.min(320, Math.round(viewportWidth / 6)));
      for (let y = Math.min(step / 2, viewportHeight - 1); y < viewportHeight; y += step) {
        for (let x = Math.min(step / 2, viewportWidth - 1); x < viewportWidth; x += step) {
          document.elementsFromPoint?.(x, y).forEach(element => {
            let current = element;
            for (let depth = 0; current && depth < 5; depth += 1) {
              candidates.add(current);
              current = current.parentElement;
            }
          });
        }
      }
      document.querySelectorAll('[data-html-editor-selected]').forEach(element => candidates.add(element));
      candidates.forEach(element => {
        ['', '::before', '::after'].forEach(pseudo => {
          let style;
          try { style = getComputedStyle(element, pseudo || null); } catch { return; }
          designCssAssetProperties.forEach(property => {
            const value = style?.[property];
            if (value && value.includes('kodety-runtime-asset-')) {
              requestDesignCssValue(value, element);
            }
          });
        });
        rewriteRuntimeInlineStyle(element);
      });
    };
    const scheduleVisibleDesignAssetDiscovery = () => {
      if (!motionFrozen || visibleDesignAssetFrame) return;
      visibleDesignAssetFrame = requestAnimationFrame(discoverVisibleDesignAssets);
      if (!visibleDesignAssetFrame) discoverVisibleDesignAssets();
    };
    window.__KODETY_REQUEST_VISIBLE_EDITOR_ASSETS__ = scheduleVisibleDesignAssetDiscovery;
    if (motionFrozen) {
      addEventListener('scroll', scheduleVisibleDesignAssetDiscovery, { passive: true });
      addEventListener('resize', scheduleVisibleDesignAssetDiscovery);
    }
    // Modules often preload a sequence through detached elements
    // (const image = new Image(); image.src = frameUrl(i)). A document
    // MutationObserver can never see those assignments. Intercept the native
    // URL setters long enough to request the exact project file, then delegate
    // to the browser setter with an iframe-owned Blob URL. A per-property token
    // prevents a late response from overwriting a newer authored assignment.
    const runtimePropertyAssignments = new WeakMap();
    const assignRuntimeProperty = (element, property, raw, assign) => {
      const state = runtimePropertyAssignments.get(element) || {};
      const token = (state[property]?.token || 0) + 1;
      state[property] = { token, raw: String(raw || '') };
      runtimePropertyAssignments.set(element, state);
      const handled = requestRuntimeAssetUrl(raw, resolved => {
        const current = runtimePropertyAssignments.get(element)?.[property];
        if (!current || current.token !== token || current.raw !== String(raw || '')) return;
        assign(resolved);
      });
      if (!handled) assign(raw);
    };
    const patchRuntimeUrlProperty = (prototype, property) => {
      if (!prototype) return;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor?.set || descriptor.set.__kodetyRuntimeAssetSetter) return;
      const nativeSetter = descriptor.set;
      const wrappedSetter = function(value) {
        if (motionFrozen && designMediaPayload(this, property)) {
          // Design renders video/audio as a poster-only static surface. Never
          // hand an authored media URL to the network-capable native setter.
          return;
        }
        assignRuntimeProperty(this, property, value, resolved => nativeSetter.call(this, resolved));
      };
      wrappedSetter.__kodetyRuntimeAssetSetter = true;
      try {
        Object.defineProperty(prototype, property, { ...descriptor, set: wrappedSetter });
      } catch {}
    };
    [
      [globalThis.HTMLImageElement?.prototype, 'src'],
      [globalThis.HTMLMediaElement?.prototype, 'src'],
      [globalThis.HTMLVideoElement?.prototype, 'poster'],
      [globalThis.HTMLSourceElement?.prototype, 'src'],
      [globalThis.HTMLScriptElement?.prototype, 'src'],
      [globalThis.HTMLLinkElement?.prototype, 'href'],
      [globalThis.HTMLIFrameElement?.prototype, 'src'],
      [globalThis.HTMLObjectElement?.prototype, 'data'],
    ].forEach(([prototype, property]) => patchRuntimeUrlProperty(prototype, property));
    // Code Components and design runtimes frequently create <style> nodes or
    // construct CSSStyleSheet instances after the initial srcdoc pass. Route
    // their local @font-face/background URLs through the same iframe-owned
    // asset channel instead of letting them resolve against about:srcdoc.
    const nativeInsertRule = globalThis.CSSStyleSheet?.prototype?.insertRule;
    if (nativeInsertRule) {
      CSSStyleSheet.prototype.insertRule = function(rule, index) {
        let insertedIndex = -1;
        const retry = () => queueMicrotask(() => {
          try {
            const current = this.cssRules?.[insertedIndex]?.cssText;
            if (!current) return;
            const next = rewriteRuntimeCssText(current, retry);
            if (next === current) return;
            this.deleteRule(insertedIndex);
            nativeInsertRule.call(this, next, insertedIndex);
          } catch {}
        });
        const next = rewriteRuntimeCssText(rule, retry);
        insertedIndex = nativeInsertRule.call(this, next, index);
        return insertedIndex;
      };
    }
    const nativeReplaceSync = globalThis.CSSStyleSheet?.prototype?.replaceSync;
    if (nativeReplaceSync) {
      CSSStyleSheet.prototype.replaceSync = function(value) {
        const retry = () => queueMicrotask(() => {
          try {
            nativeReplaceSync.call(
              this,
              rewriteRuntimeCssText(
                Array.from(this.cssRules || [], rule => rule.cssText).join('\\n'),
                retry,
              ),
            );
          } catch {}
        });
        return nativeReplaceSync.call(this, rewriteRuntimeCssText(value, retry));
      };
    }
    const nativeReplace = globalThis.CSSStyleSheet?.prototype?.replace;
    if (nativeReplace) {
      CSSStyleSheet.prototype.replace = function(value) {
        const retry = () => queueMicrotask(() => {
          try {
            nativeReplace.call(
              this,
              rewriteRuntimeCssText(
                Array.from(this.cssRules || [], rule => rule.cssText).join('\\n'),
                retry,
              ),
            ).catch?.(() => {});
          } catch {}
        });
        return nativeReplace.call(this, rewriteRuntimeCssText(value, retry));
      };
    }
    const nativeSetAttribute = Element.prototype.setAttribute;
    const requestableRuntimeAttributes = new Set(['src', 'poster', 'data']);
    Element.prototype.setAttribute = function(name, value) {
      const normalizedName = String(name || '').toLowerCase();
      if (motionFrozen && designMediaPayload(this, normalizedName)) {
        // Preserve the editable authored value in its existing original/
        // promoted marker, while keeping the disposable Design media inert.
        return;
      }
      if (
        requestableRuntimeAttributes.has(normalizedName)
        && runtimeAttributeApplies(this, normalizedName)
      ) {
        assignRuntimeProperty(this, 'attribute:' + normalizedName, value, resolved => {
          nativeSetAttribute.call(this, name, resolved);
        });
        return;
      }
      nativeSetAttribute.call(this, name, value);
    };
${CANVAS_FONTS_RUNTIME}
    const refreshRuntimeFonts = () => {
      try {
        // Runtime font files arrive after srcdoc parsing. Explicitly ask each
        // face to load again after its blob URL is installed, then force one
        // layout read so text painted during the fallback frame is refreshed.
        const loads = Array.from(document.fonts || []).map(face => {
          try {
            return face.status === 'loaded'
              ? Promise.resolve(face)
              : Promise.resolve(face.load?.()).catch(() => null);
          } catch {
            return Promise.resolve(null);
          }
        });
        return Promise.allSettled(loads).then(() => document.fonts?.ready).then(() => {
          document.documentElement?.getBoundingClientRect();
        }).catch(() => {});
      } catch {
        // Font loading is progressive; a missing/invalid optional face must
        // never prevent the rest of the preview from rendering.
        return Promise.resolve();
      }
    };
    let bridgeMessageListenersReady = false;
    let canvasReadySent = false;
    let canvasReadyRequested = false;
    let firstContentReadySent = false;
    let firstContentReadyRequested = false;
    let bufferedVisualsReadySent = false;
    let bufferedFontsSettled = !runtimeFontAssetPaths.length;
    let runtimeFontSettlementPending = false;
    let bufferedInitialAssetSweepComplete = !availableRuntimeAssetPaths.length;
    let bufferedVisibleImagesSettled = false;
    let bufferedImageSettlementGeneration = 0;
    let fontSettlementGeneration = 0;
    let fontFailOpenTimer = 0;
    let bufferedVisualsFailOpenTimer = 0;
    let componentInitialSizeReported = true;
    let surfaceAssetsReady = false;
    let surfacePaintSettled = false;
    let surfacePaintHandshakeStarted = false;
    const visualSettlementTimeoutReasons = new Set();
    const waitForDomReady = () => {
      if (document.readyState !== 'loading') return Promise.resolve();
      return new Promise(resolve => {
        let timer = 0;
        let finished = false;
        const loaded = () => finish(false);
        const finish = timedOut => {
          if (finished) return;
          finished = true;
          removeEventListener('DOMContentLoaded', loaded);
          if (timer) clearTimeout(timer);
          if (timedOut) visualSettlementTimeoutReasons.add('dom');
          resolve();
        };
        addEventListener('DOMContentLoaded', loaded, { once: true });
        // This bridge is the final body child, so a timeout means only that a
        // deferred/module script held DOMContentLoaded; the authored DOM itself
        // has already parsed and is safe to paint.
        timer = setTimeout(() => finish(true), ${PREVIEW_SURFACE_DOM_SETTLE_MS});
      });
    };
    const activateDeferredFontStylesheets = () => {
      document.querySelectorAll('link[data-html-editor-deferred-font], link[data-html-editor-deferred-google-font]').forEach(link => {
        link.media = 'all';
        link.removeAttribute('data-html-editor-deferred-font');
        link.removeAttribute('data-html-editor-deferred-google-font');
      });
    };
    const waitForStylesheets = () => {
      const pending = Array.from(
        document.querySelectorAll('link[rel~="stylesheet"][href]'),
      ).filter(link => {
        const fontState = link.getAttribute('data-html-editor-font-state')
          || link.getAttribute('data-html-editor-google-font-state');
        return fontState !== 'loaded'
          && fontState !== 'error'
          && !link.sheet
          && link.media !== 'not all';
      });
      if (!pending.length) return Promise.resolve();
      return new Promise(resolve => {
        let remaining = pending.length;
        let timer = 0;
        let finished = false;
        const cleanups = [];
        const finish = timedOut => {
          if (finished) return;
          finished = true;
          cleanups.splice(0).forEach(cleanup => cleanup());
          if (timer) clearTimeout(timer);
          if (timedOut) visualSettlementTimeoutReasons.add('stylesheets');
          resolve();
        };
        pending.forEach(link => {
          const settled = () => {
            remaining -= 1;
            if (!remaining) finish(false);
          };
          link.addEventListener('load', settled, { once: true });
          link.addEventListener('error', settled, { once: true });
          cleanups.push(() => {
            link.removeEventListener('load', settled);
            link.removeEventListener('error', settled);
          });
        });
        timer = setTimeout(() => finish(true), ${PREVIEW_SURFACE_STYLE_SETTLE_MS});
      });
    };
    const waitForDocumentFonts = () => {
      const ready = document.fonts?.ready;
      if (!ready || typeof ready.then !== 'function') return Promise.resolve();
      return Promise.race([
        Promise.resolve(ready).then(() => false).catch(() => false),
        new Promise(resolve => setTimeout(
          () => resolve(true),
          ${PREVIEW_SURFACE_FONT_SETTLE_MS},
        )),
      ]).then(timedOut => {
        if (timedOut) visualSettlementTimeoutReasons.add('fonts');
      });
    };
    const waitForTwoPaintFrames = () => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const flushSurfaceReadySignals = () => {
      if (
        !surfacePaintSettled
        || !bridgeMessageListenersReady
        || !componentInitialSizeReported
      ) return;
      if (firstContentReadyRequested && !firstContentReadySent) {
        firstContentReadySent = true;
        postEditorMessage({ type: 'html-editor-first-content-ready' });
      }
      if (canvasReadyRequested && !canvasReadySent) {
        canvasReadySent = true;
        postEditorMessage({ type: 'html-editor-canvas-ready', revision: editorRevision });
        // Layers derives its eye state from the painted canvas, not from stale
        // inline/hidden source fallbacks. Sample after the same settle barrier
        // that makes this generation eligible for promotion.
        scheduleCanvasVisibilitySnapshot();
      }
      maybeSignalBufferedVisualsReady();
    };
    const startSurfacePaintHandshake = () => {
      if (
        surfacePaintHandshakeStarted
        || !surfaceAssetsReady
        || !bridgeMessageListenersReady
      ) return;
      surfacePaintHandshakeStarted = true;
      waitForDomReady()
        .then(() => {
          // Subscribe before switching the preloaded Google stylesheets from
          // print to all. A cached CSS response can otherwise finish between
          // activation and listener registration, forcing the full stylesheet
          // and document-font timeout sequence even though the font arrived.
          const stylesheetSettlement = waitForStylesheets();
          activateDeferredFontStylesheets();
          return stylesheetSettlement;
        })
        .then(waitForDocumentFonts)
        // A layout read commits final font/style metrics before the two
        // compositor boundaries that define the iframe's paint-ready signal.
        .then(() => document.documentElement?.getBoundingClientRect())
        .then(waitForTwoPaintFrames)
        .then(() => {
          surfacePaintSettled = true;
          flushSurfaceReadySignals();
        });
    };
    const signalFirstContentReady = () => {
      firstContentReadyRequested = true;
      startSurfacePaintHandshake();
      flushSurfaceReadySignals();
    };
    const maybeSignalBufferedVisualsReady = () => {
      if (
        bufferedVisualsReadySent
        || !surfacePaintSettled
        || !bufferedFontsSettled
        || !bufferedInitialAssetSweepComplete
        || !bufferedVisibleImagesSettled
      ) return;
      bufferedVisualsReadySent = true;
      if (bufferedVisualsFailOpenTimer) {
        clearTimeout(bufferedVisualsFailOpenTimer);
        bufferedVisualsFailOpenTimer = 0;
      }
      const timeoutReasons = Array.from(visualSettlementTimeoutReasons);
      postEditorMessage({
        type: 'html-editor-buffer-visuals-ready',
        timedOut: timeoutReasons.length > 0,
        timeoutReasons,
      });
    };
    scheduleBufferedVisualAssetSettlement = () => {
      if (
        !bufferedInitialAssetSweepComplete
        || pendingRuntimeAssetRequests.size
      ) return;
      const generation = ++bufferedImageSettlementGeneration;
      bufferedVisibleImagesSettled = false;
      const visibleImages = Array.from(document.images || []).filter(image => {
        if (!image.isConnected) return false;
        const style = getComputedStyle(image);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || Number(style.opacity || 1) <= 0
        ) return false;
        const rect = image.getBoundingClientRect();
        return (
          rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < innerHeight
          && rect.left < innerWidth
        );
      });
      const waitForImage = image => {
        const loaded = image.complete
          ? Promise.resolve()
          : new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          });
        return loaded.then(() => {
          try {
            return typeof image.decode === 'function'
              ? image.decode().catch(() => {})
              : undefined;
          } catch {
            return undefined;
          }
        });
      };
      Promise.race([
        Promise.allSettled(visibleImages.map(waitForImage)).then(() => false),
        // Media is progressive. A broken/streaming image must never keep the
        // optional visuals signal pending forever or hold a retained surface.
        new Promise(resolve => setTimeout(
          () => resolve(true),
          ${PREVIEW_SURFACE_MEDIA_SETTLE_MS},
        )),
      ]).then(timedOut => {
        if (generation !== bufferedImageSettlementGeneration) return;
        if (timedOut) visualSettlementTimeoutReasons.add('visible-images');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (generation !== bufferedImageSettlementGeneration) return;
          bufferedVisibleImagesSettled = true;
          maybeSignalBufferedVisualsReady();
        }));
      });
    };
    const revealCanvasAndSignalReady = () => {
      if (!bridgeMessageListenersReady) return;
      canvasReadyRequested = true;
      surfaceAssetsReady = true;
      if (fontFailOpenTimer) {
        clearTimeout(fontFailOpenTimer);
        fontFailOpenTimer = 0;
      }
      document.documentElement.removeAttribute('data-html-editor-fonts-pending');
      startSurfacePaintHandshake();
      flushSurfaceReadySignals();
    };
    const settleRuntimeFontsAndCanvas = () => {
      const generation = ++fontSettlementGeneration;
      const settle = refreshRuntimeFonts();
      settle.then(() => {
        if (generation !== fontSettlementGeneration) return;
        runtimeFontSettlementPending = false;
        bufferedFontsSettled = true;
        maybeSignalBufferedVisualsReady();
      });
      Promise.race([
        settle.then(() => false),
        new Promise(resolve => setTimeout(
          () => resolve(true),
          ${PREVIEW_RUNTIME_FONT_SETTLE_MS},
        )),
      ]).then(timedOut => {
        if (generation !== fontSettlementGeneration) return;
        runtimeFontSettlementPending = false;
        if (timedOut) visualSettlementTimeoutReasons.add('runtime-fonts');
        bufferedFontsSettled = true;
        maybeSignalBufferedVisualsReady();
        revealCanvasAndSignalReady();
      });
    };
    const activateProjectFontStyles = () => {
      sweepRuntimeStyles(document.documentElement);
      document.querySelectorAll('style[data-html-editor-project-fonts][media="not all"]')
        .forEach(style => style.removeAttribute('media'));
    };
    const maybeSettleRuntimeFontsAndCanvas = () => {
      if (!runtimeFontAssetPaths.length) {
        bufferedFontsSettled = true;
        maybeSignalBufferedVisualsReady();
        revealCanvasAndSignalReady();
        return;
      }
      if (bufferedFontsSettled || runtimeFontSettlementPending) return;
      if (runtimeFontAssetPaths.every(path => Boolean(usableRuntimeAssetUrl(path)))) {
        runtimeFontSettlementPending = true;
        activateProjectFontStyles();
        settleRuntimeFontsAndCanvas();
      }
    };
    const iframeRuntimeObjectUrls = new Map();
    const animatedRuntimeAssetBlobs = new Map();
    const runtimeAssetInstallGenerations = new Map();
    const beginRuntimeAssetInstall = path => {
      const generation = (runtimeAssetInstallGenerations.get(path) || 0) + 1;
      runtimeAssetInstallGenerations.set(path, generation);
      return generation;
    };
    const asciiAt = (source, offset, length) => {
      let value = '';
      for (let index = 0; index < length; index += 1) value += String.fromCharCode(source[offset + index] || 0);
      return value;
    };
    const pngHasAnimation = bytes => {
      const source = new Uint8Array(bytes);
      if (source.length < 20 || asciiAt(source, 1, 3) !== 'PNG') return false;
      const view = new DataView(bytes);
      let offset = 8;
      while (offset + 12 <= source.length) {
        const length = view.getUint32(offset);
        const type = asciiAt(source, offset + 4, 4);
        if (type === 'acTL') return true;
        if (type === 'IDAT' || type === 'IEND') return false;
        offset += 12 + length;
      }
      return false;
    };
    const webpHasAnimation = bytes => {
      const source = new Uint8Array(bytes);
      if (source.length < 16 || asciiAt(source, 0, 4) !== 'RIFF' || asciiAt(source, 8, 4) !== 'WEBP') return false;
      const view = new DataView(bytes);
      let offset = 12;
      while (offset + 8 <= source.length) {
        const type = asciiAt(source, offset, 4);
        const length = view.getUint32(offset + 4, true);
        if (type === 'ANIM') return true;
        if (type === 'VP8X' && offset + 9 <= source.length && (source[offset + 8] & 0x02)) return true;
        offset += 8 + length + (length % 2);
      }
      return false;
    };
    const isAnimatedRasterAsset = asset => {
      const mime = String(asset?.mimeType || '').toLowerCase();
      const path = String(asset?.path || '').split(/[?#]/)[0].toLowerCase();
      if (mime === 'image/gif' || path.endsWith('.gif')) return true;
      if (!(asset?.bytes instanceof ArrayBuffer)) return false;
      // APNG advertises an acTL chunk; animated WebP has an ANIM chunk.
      return (
        (mime === 'image/png' || path.endsWith('.png')) && pngHasAnimation(asset.bytes)
      ) || (
        (mime === 'image/webp' || path.endsWith('.webp')) && webpHasAnimation(asset.bytes)
      );
    };
    const replaceRuntimeAssetReferencesInStyles = replacements => {
      if (!replacements.length) return;
      const replaceValue = value => {
        let next = value;
        replacements.forEach(([oldUrl, nextUrl]) => {
          if (next.includes(oldUrl)) next = next.split(oldUrl).join(nextUrl);
        });
        return next;
      };
      runtimeStyleElements.forEach(style => {
        const value = style.textContent || '';
        const next = replaceValue(value);
        if (next !== value) style.textContent = next;
      });
      if (!motionFrozen) {
        // One DOM walk for the complete batch. Large projects commonly carry
        // dozens of inline backgrounds; walking them once per transferred
        // asset made an otherwise batched response quadratic again.
        document.querySelectorAll('[style]').forEach(element => {
          const value = element.getAttribute('style') || '';
          const next = replaceValue(value);
          if (next !== value) element.setAttribute('style', next);
        });
      }
    };
    const replaceRuntimeAssetUrl = (path, oldUrl, nextUrl, aliases = {}, refreshDocument = true) => {
      if (!path || !nextUrl) return;
      if (oldUrl) runtimeAssetAliases[oldUrl] = path;
      runtimeAssets.urls[path] = nextUrl;
      Object.entries({ ...(runtimeAssets.pathAliases || {}), ...(aliases || {}) }).forEach(([alias, canonical]) => {
        if (canonical === path) runtimeAssets.urls[alias] = nextUrl;
      });
      settleRuntimeAssetWaiters(path);
      if (oldUrl && oldUrl !== nextUrl) {
        if (refreshDocument) replaceRuntimeAssetReferencesInStyles([[oldUrl, nextUrl]]);
      }
      // Asset waiters update exactly the elements that asked for this path.
      // Rewalking the whole imported document for every response was quadratic.
      // A transferred batch suppresses this per-path refresh and performs one
      // consolidated sweep after every Blob URL and alias has been installed.
      if (!refreshDocument) return;
      if (motionFrozen) {
        scheduleRuntimeStyleRefresh();
        scheduleVisibleDesignAssetDiscovery();
      } else {
        sweepRuntimeStyles(document.documentElement);
        sweepRuntimeAssets(document.documentElement);
      }
    };
    const runtimeAssetPayloadIncludesFont = (assets, aliases = {}) => {
      if (!runtimeFontAssetPaths.length) return false;
      const installedPaths = new Set(
        (Array.isArray(assets) ? assets : [])
          .map(asset => typeof asset?.path === 'string' ? asset.path : '')
          .filter(Boolean),
      );
      Object.keys(aliases || {}).forEach(path => installedPaths.add(path));
      return runtimeFontAssetPaths.some(path => installedPaths.has(path));
    };
    const rasterizeFrozenFirstFrame = async (asset, aliases, installGeneration) => {
      const blob = new Blob([asset.bytes], { type: asset.mimeType || 'application/octet-stream' });
      let drawable = null;
      let fallbackUrl = '';
      try {
        if (typeof createImageBitmap === 'function') {
          drawable = await createImageBitmap(blob);
        } else {
          fallbackUrl = URL.createObjectURL(blob);
          const image = new Image();
          await new Promise((resolve, reject) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', reject, { once: true });
            image.src = fallbackUrl;
          });
          drawable = image;
        }
        const width = Math.max(1, drawable.width || drawable.naturalWidth || 1);
        const height = Math.max(1, drawable.height || drawable.naturalHeight || 1);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(drawable, 0, 0, width, height);
        const frozenBlob = await new Promise((resolve, reject) => {
          canvas.toBlob(value => value ? resolve(value) : reject(new Error('Raster snapshot failed')), 'image/png');
        });
        const frozenUrl = URL.createObjectURL(frozenBlob);
        if (installGeneration !== runtimeAssetInstallGenerations.get(asset.path)) {
          URL.revokeObjectURL(frozenUrl);
          return;
        }
        const previousObjectUrl = iframeRuntimeObjectUrls.get(asset.path);
        if (previousObjectUrl && previousObjectUrl !== frozenUrl) {
          URL.revokeObjectURL(previousObjectUrl);
        }
        iframeRuntimeObjectUrls.set(asset.path, frozenUrl);
        const previous = runtimeAssets.urls[asset.path];
        replaceRuntimeAssetUrl(asset.path, previous, frozenUrl, aliases);
      } catch {
        // Never fall back to the animated source in Design. A failed optional
        // decoder leaves the inert placeholder in place instead of violating
        // the canvas-wide freeze contract.
      } finally {
        try { drawable?.close?.(); } catch {}
        if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
      }
    };
    const installTransferredRuntimeAssets = (assets, aliases) => {
      const transferredAssets = Array.isArray(assets) ? assets : [];
      if (runtimeAssetPayloadIncludesFont(transferredAssets, aliases)) {
        // A later replacement of an authored font path must start one fresh
        // settlement. Image-only batches leave the settled/pending state
        // untouched and therefore never rescan document.fonts.
        bufferedFontsSettled = false;
        runtimeFontSettlementPending = false;
      }
      registerRuntimeAssetAliases(aliases);
      const previousUrls = { ...runtimeAssets.urls };
      Object.entries(previousUrls).forEach(([path, url]) => {
        if (url) runtimeAssetAliases[url] = path;
      });
      transferredAssets.forEach(asset => {
        if (!asset || typeof asset.path !== 'string' || !(asset.bytes instanceof ArrayBuffer)) return;
        registerRuntimeAssetPath(asset.path);
        const installGeneration = beginRuntimeAssetInstall(asset.path);
        const blob = new Blob([asset.bytes], {
          type: asset.mimeType || 'application/octet-stream',
        });
        const animated = isAnimatedRasterAsset(asset);
        if (animated) animatedRuntimeAssetBlobs.set(asset.path, blob);
        else animatedRuntimeAssetBlobs.delete(asset.path);
        if (motionFrozen && animated) {
          void rasterizeFrozenFirstFrame(asset, aliases, installGeneration);
          return;
        }
        const url = URL.createObjectURL(blob);
        const previousObjectUrl = iframeRuntimeObjectUrls.get(asset.path);
        if (previousObjectUrl && previousObjectUrl !== url) {
          URL.revokeObjectURL(previousObjectUrl);
        }
        iframeRuntimeObjectUrls.set(asset.path, url);
        runtimeAssets.urls[asset.path] = url;
      });
      Object.entries(aliases || {}).forEach(([alias, canonical]) => {
        if (typeof canonical === 'string' && runtimeAssets.urls[canonical]) {
          runtimeAssets.urls[alias] = runtimeAssets.urls[canonical];
          // Requests are keyed by the path resolved before the parent replies.
          // A duplicate path may then be represented only by its canonical
          // asset in the transfer. Settle both keys so aliases never remain in
          // pendingRuntimeAssetRequests and block canvas readiness forever.
          settleRuntimeAssetWaiters(alias);
        }
      });
      transferredAssets.forEach(asset => {
        if (asset && typeof asset.path === 'string' && usableRuntimeAssetUrl(asset.path)) {
          settleRuntimeAssetWaiters(asset.path);
        }
      });
      // CSS/background assets were resolved before the iframe existed. Swap
      // those parent blob references in-place as well as img/video attributes.
      const styleUrlReplacements = [];
      Object.entries(previousUrls).forEach(([path, oldUrl]) => {
        const nextUrl = runtimeAssets.urls[path];
        if (!oldUrl || !nextUrl || oldUrl === nextUrl) return;
        styleUrlReplacements.push([oldUrl, nextUrl]);
        replaceRuntimeAssetUrl(path, oldUrl, nextUrl, aliases, false);
      });
      replaceRuntimeAssetReferencesInStyles(styleUrlReplacements);
      if (motionFrozen) {
        scheduleRuntimeStyleRefresh();
        scheduleVisibleDesignAssetDiscovery();
      } else {
        sweepRuntimeAssets(document.documentElement);
        sweepRuntimeStyles(document.documentElement);
      }
      maybeSettleRuntimeFontsAndCanvas();
    };
    const restartAnimatedRuntimeAssets = () => {
      if (motionFrozen || !animatedRuntimeAssetBlobs.size) return;
      const staleObjectUrls = [];
      animatedRuntimeAssetBlobs.forEach((blob, path) => {
        const previousObjectUrl = iframeRuntimeObjectUrls.get(path);
        const nextUrl = URL.createObjectURL(blob);
        iframeRuntimeObjectUrls.set(path, nextUrl);
        replaceRuntimeAssetUrl(
          path,
          previousObjectUrl || runtimeAssets.urls[path],
          nextUrl,
          runtimeAssets.pathAliases,
        );
        if (previousObjectUrl && previousObjectUrl !== nextUrl) {
          staleObjectUrls.push(previousObjectUrl);
        }
      });
      // A hidden buffered iframe has already decoded and advanced animated
      // rasters before it is promoted. New object URLs start every GIF/APNG/
      // animated WebP at frame zero exactly when that iframe becomes visible.
      // Keep the old URLs briefly for detached runtime preloaders.
      if (staleObjectUrls.length) {
        setTimeout(() => staleObjectUrls.forEach(url => URL.revokeObjectURL(url)), 2000);
      }
    };
    const installTransferredRuntimeAsset = (asset, aliases) => {
      if (!asset || typeof asset.path !== 'string' || !(asset.bytes instanceof ArrayBuffer)) return;
      registerRuntimeAssetAliases(aliases);
      registerRuntimeAssetPath(asset.path);
      if (usableRuntimeAssetUrl(asset.path)) {
        settleRuntimeAssetWaiters(asset.path);
        return;
      }
      if (runtimeAssetPayloadIncludesFont([asset], aliases)) {
        bufferedFontsSettled = false;
        runtimeFontSettlementPending = false;
      }
      const installGeneration = beginRuntimeAssetInstall(asset.path);
      const blob = new Blob([asset.bytes], {
        type: asset.mimeType || 'application/octet-stream',
      });
      const animated = isAnimatedRasterAsset(asset);
      if (animated) animatedRuntimeAssetBlobs.set(asset.path, blob);
      else animatedRuntimeAssetBlobs.delete(asset.path);
      if (motionFrozen && animated) {
        void rasterizeFrozenFirstFrame(asset, aliases, installGeneration);
        return;
      }
      const url = URL.createObjectURL(blob);
      const previousObjectUrl = iframeRuntimeObjectUrls.get(asset.path);
      if (previousObjectUrl && previousObjectUrl !== url) {
        URL.revokeObjectURL(previousObjectUrl);
      }
      iframeRuntimeObjectUrls.set(asset.path, url);
      runtimeAssets.urls[asset.path] = url;
      Object.entries({ ...(runtimeAssets.pathAliases || {}), ...(aliases || {}) })
        .forEach(([alias, canonical]) => {
          if (canonical === asset.path) runtimeAssets.urls[alias] = url;
        });
      settleRuntimeAssetWaiters(asset.path);
      if (motionFrozen) {
        scheduleRuntimeStyleRefresh();
        scheduleVisibleDesignAssetDiscovery();
      } else {
        sweepRuntimeAssets(document.documentElement);
        sweepRuntimeStyles(document.documentElement);
      }
      maybeSettleRuntimeFontsAndCanvas();
    };
    // Authored/imported runtimes may install bubbling message listeners and
    // stop propagation. The editor command channel is infrastructure, so read
    // it during capture before page code can swallow Layers/Inspector actions.
    registerEditorMessageListener(event => {
      if (!isCurrentEditorMessage(event)) return;
      if (event.data?.type === 'html-editor-runtime-assets') {
        installTransferredRuntimeAssets(event.data.assets, event.data.aliases);
      } else if (event.data?.type === 'html-editor-runtime-asset') {
        installTransferredRuntimeAsset(event.data.asset, event.data.aliases);
      } else if (event.data?.type === 'html-editor-runtime-assets-refresh') {
        // Passive Infinite Canvas references can discover assets before the
        // editable frame establishes generation authority in the parent. The
        // original request remains pending here; replay only that bounded set
        // instead of rescanning the complete document in every reference.
        pendingRuntimeAssetRequests.forEach(enqueueRuntimeAssetRequest);
        flushRuntimeAssetRequests();
      } else if (event.data?.type === 'html-editor-buffer-promoted') {
        restartAnimatedRuntimeAssets();
        // Hidden buffered documents announce their MessagePort before the
        // parent exposes them as the active iframe, so that first announcement
        // cannot be associated with an active node. Announce again now that the
        // atomic promotion completed; otherwise all following editor commands
        // fall back to Window.postMessage in the browsers that need this port.
        window.__KODETY_ANNOUNCE_EDITOR_COMMAND_CHANNEL__?.();
        // Hidden buffered generations receive fonts only. Requests for images,
        // video and other binary assets may have been emitted while that frame
        // was not yet the active command target, so replay them after atomic
        // promotion instead of cloning every asset into every hidden iframe.
        pendingRuntimeAssetRequests.forEach(enqueueRuntimeAssetRequest);
        flushRuntimeAssetRequests();
        if (motionFrozen) {
          scheduleRuntimeStyleRefresh();
          scheduleVisibleDesignAssetDiscovery();
        } else {
          sweepRuntimeAssets(document.documentElement);
          sweepRuntimeStyles(document.documentElement);
        }
      }
    }, true);
    // Ask as soon as the bridge is parsed, before deferred/module animation
    // scripts normally execute. The parent also has an iframe-load fallback.
    postEditorMessage({ type: 'html-editor-runtime-assets-ready' });
    if (availableRuntimeAssetPaths.length) {
      new MutationObserver(mutations => mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          rewriteRuntimeElement(mutation.target);
          if (mutation.attributeName === 'style' && mutation.target instanceof Element) {
            rewriteRuntimeInlineStyle(mutation.target);
            scheduleVisibleDesignAssetDiscovery();
          }
          if (mutation.target instanceof HTMLStyleElement) rewriteRuntimeStyle(mutation.target);
          return;
        }
        const style = mutation.target instanceof HTMLStyleElement
          ? mutation.target
          : mutation.target.parentElement?.closest?.('style');
        if (style instanceof HTMLStyleElement) rewriteRuntimeStyle(style);
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          sweepRuntimeAssets(node);
          sweepRuntimeStyles(node);
        });
      })).observe(document.documentElement, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: [...RUNTIME_ASSET_ATTRIBUTES, 'style'],
      });
      addEventListener('DOMContentLoaded', () => {
        sweepRuntimeAssets(document.documentElement);
        sweepRuntimeStyles(document.documentElement);
        scheduleVisibleDesignAssetDiscovery();
        refreshRuntimeFonts();
        bufferedInitialAssetSweepComplete = true;
        scheduleBufferedVisualAssetSettlement();
      }, { once: true });
      const originalFetch = window.fetch?.bind(window);
      if (originalFetch) window.fetch = (input, init) => {
        if (typeof input !== 'string') return originalFetch(input, init);
        const mapped = runtimeAssetUrl(input);
        if (mapped) return originalFetch(mapped, init);
        if (!resolveRuntimeAssetPath(input)) return originalFetch(input, init);
        return new Promise((resolve, reject) => {
          const accepted = requestRuntimeAssetUrl(input, resolved => {
            originalFetch(resolved, init).then(resolve, reject);
          });
          if (!accepted) originalFetch(input, init).then(resolve, reject);
        });
      };
      const originalXhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        const mapped = typeof url === 'string' ? runtimeAssetUrl(url) : null;
        return originalXhrOpen.call(this, method, mapped || url, ...rest);
      };
    }
    let selected = Array.from(document.querySelectorAll('[data-html-editor-selected]')).at(-1) || null;
    const editorPathElements = path => Array.from(document.querySelectorAll(
      '[data-html-editor-path="' + CSS.escape(String(path || '')) + '"]',
    ));
    const previewItemIdForElement = element => element?.closest?.(
      '[data-kodety-preview-clone], [data-kodety-preview-item-id]',
    )?.getAttribute('data-kodety-preview-item-id') || '';
    const previewProjectionDepth = element => {
      let depth = 0;
      let current = element;
      while (current instanceof Element) {
        if (current.matches(
          '[data-kodety-preview-clone], [data-kodety-preview-item-id]',
        )) depth += 1;
        current = current.parentElement;
      }
      return depth;
    };
    const isDormantPreviewTemplate = (element, pathCandidates) => {
      const path = element?.getAttribute?.('data-html-editor-path') || '';
      if (!path) return false;
      const ownDepth = previewProjectionDepth(element);
      const candidates = Array.isArray(pathCandidates)
        ? pathCandidates
        : editorPathElements(path);
      const hasDeeperProjection = candidates.some(candidate => (
        candidate !== element
        && previewProjectionDepth(candidate) > ownDepth
      ));
      if (!hasDeeperProjection) return false;
      const hiddenRuntimeAncestor = element.closest?.('[hidden]');
      return Boolean(
        hiddenRuntimeAncestor
        && !hiddenRuntimeAncestor.hasAttribute('data-html-editor-original-hidden'),
      );
    };
    const editorVisualElements = path => {
      const candidates = editorPathElements(path);
      // Collection templates and their rendered instances intentionally carry
      // the same authored path. Once instances exist, only those instances are
      // visual mutation/check targets; the dormant template keeps its
      // runtime-owned hidden state and future instances are healed by the
      // compact journal when they are materialized.
      const visualCandidates = candidates.filter(element => (
        !isDormantPreviewTemplate(element, candidates)
      ));
      return visualCandidates.length ? visualCandidates : candidates;
    };
    let visibilitySnapshotFrame = 0;
    let visibilitySnapshotSequence = 0;
    const publishCanvasVisibilitySnapshot = () => {
      visibilitySnapshotFrame = 0;
      if (!inspectionEnabled) return;
      const elementsByPath = new Map();
      document.querySelectorAll('[data-html-editor-path]').forEach(element => {
        const path = element.getAttribute('data-html-editor-path');
        if (path === null) return;
        const candidates = elementsByPath.get(path) || [];
        candidates.push(element);
        elementsByPath.set(path, candidates);
      });
      const hiddenPaths = [];
      elementsByPath.forEach((candidates, path) => {
        const visualCandidates = candidates.filter(element => (
          !isDormantPreviewTemplate(element, candidates)
        ));
        const targets = visualCandidates.length ? visualCandidates : candidates;
        if (!targets.length) return;
        const hidden = targets.every(element => {
          const computed = getComputedStyle(element);
          return computed.display === 'none'
            || computed.visibility === 'hidden'
            || computed.visibility === 'collapse'
            || computed.contentVisibility === 'hidden';
        });
        if (hidden) hiddenPaths.push(path);
      });
      hiddenPaths.sort();
      // The protocol treats absence from hiddenPaths as effectively visible,
      // so a truncated set would be worse than no update. Keep the previous
      // complete snapshot when an exceptionally large document exceeds the
      // bounded bridge contract.
      if (hiddenPaths.length > 8192) return;
      postEditorMessage({
        type: 'html-editor-visibility-snapshot',
        breakpointId: canvasViewBreakpointId || 'base',
        hiddenPaths,
        revision: appliedEditorRevision,
        sequence: ++visibilitySnapshotSequence,
      });
    };
    const scheduleCanvasVisibilitySnapshot = () => {
      if (!inspectionEnabled || visibilitySnapshotFrame) return;
      visibilitySnapshotFrame = requestAnimationFrame(publishCanvasVisibilitySnapshot);
    };
    addEventListener('resize', scheduleCanvasVisibilitySnapshot, { passive: true });
    addEventListener('pagehide', () => {
      if (visibilitySnapshotFrame) cancelAnimationFrame(visibilitySnapshotFrame);
      visibilitySnapshotFrame = 0;
    }, { once: true });
    const preferredEditorPathElement = (path, previewItemId = '') => {
      const candidates = editorVisualElements(path);
      if (
        selected?.isConnected
        && selected.getAttribute('data-html-editor-path') === path
        && candidates.includes(selected)
      ) return selected;
      if (previewItemId) {
        const matchingInstance = candidates.find(element => (
          previewItemIdForElement(element) === previewItemId
        ));
        if (matchingInstance) return matchingInstance;
      }
      return candidates.find(element => {
        const computed = getComputedStyle(element);
        return element.getClientRects().length > 0
          && computed.display !== 'none'
          && computed.visibility !== 'hidden';
      }) || candidates[0] || null;
    };
    // Agent activity is editor-owned UI, never authored markup. Keeping the
    // ring inside each iframe makes it naturally follow that breakpoint's
    // layout and the Infinite Canvas transform without rebuilding srcDoc.
    const agentActivityController = (() => {
      let paths = [];
      let sectionIds = [];
      let agentActive = false;
      let frame = 0;
      let root = null;
      const observedTargets = new Set();
      const style = document.createElement('style');
      style.setAttribute('data-html-editor-agent-activity-style', '');
      style.textContent = '@property --kodety-agent-angle{syntax:"<angle>";initial-value:0deg;inherits:false}'
        + '@keyframes kodety-agent-shine{to{--kodety-agent-angle:360deg}}'
        + '[data-html-editor-agent-activity-root]{position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;contain:strict}'
        + '.kodety-agent-activity-stroke{position:absolute;box-sizing:border-box;border:1px solid rgba(139,92,246,.72);border-radius:5px;pointer-events:none;'
        + 'box-shadow:0 0 0 1px rgba(196,181,253,.08),0 0 14px rgba(124,58,237,.18);will-change:transform,width,height}'
        + '.kodety-agent-activity-stroke::after{content:"";position:absolute;inset:-2px;box-sizing:border-box;padding:2px;border-radius:inherit;pointer-events:none;'
        + 'background:conic-gradient(from var(--kodety-agent-angle),transparent 0deg,transparent 248deg,rgba(167,139,250,.16) 274deg,#ddd6fe 302deg,#fff 316deg,#a78bfa 334deg,transparent 360deg);'
        + '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;'
        + 'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;'
        + 'filter:drop-shadow(0 0 4px rgba(196,181,253,.86));animation:kodety-agent-shine 1.75s linear infinite}'
        + '@media (prefers-reduced-motion:reduce){.kodety-agent-activity-stroke::after{animation:none;--kodety-agent-angle:310deg}}';
      document.head.append(style);
      const ensureRoot = () => {
        if (root?.isConnected) return root;
        root = document.createElement('div');
        root.setAttribute('data-html-editor-agent-activity-root', '');
        root.hidden = true;
        document.body.append(root);
        return root;
      };
      const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => schedule())
        : null;
      const update = () => {
        frame = 0;
        const overlay = ensureRoot();
        const sectionTargets = sectionIds.flatMap(sectionId => (
          Array.from(document.querySelectorAll('[data-kodety-section-id]')).filter(element => (
            element.getAttribute('data-kodety-section-id') === sectionId
          ))
        ));
        const targets = Array.from(new Set([
          ...paths.flatMap(path => editorVisualElements(path)),
          ...sectionTargets,
        ])).filter(element => element?.isConnected && !overlay.contains(element));
        observedTargets.forEach(element => {
          if (targets.includes(element)) return;
          resizeObserver?.unobserve(element);
          observedTargets.delete(element);
        });
        targets.forEach(element => {
          if (observedTargets.has(element)) return;
          observedTargets.add(element);
          resizeObserver?.observe(element);
        });
        while (overlay.children.length < targets.length) {
          const stroke = document.createElement('div');
          stroke.className = 'kodety-agent-activity-stroke';
          overlay.append(stroke);
        }
        Array.from(overlay.children).forEach((stroke, index) => {
          const target = targets[index];
          if (!target) {
            stroke.hidden = true;
            return;
          }
          const rect = target.getBoundingClientRect();
          const computed = getComputedStyle(target);
          stroke.hidden = rect.width <= 0 || rect.height <= 0;
          stroke.style.transform = 'translate3d(' + (rect.left - 2) + 'px,' + (rect.top - 2) + 'px,0)';
          stroke.style.width = (rect.width + 4) + 'px';
          stroke.style.height = (rect.height + 4) + 'px';
          stroke.style.borderRadius = computed.borderRadius || '5px';
        });
        overlay.hidden = targets.length === 0;
      };
      const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(update);
      };
      const mutationObserver = new MutationObserver(mutations => {
        if (root && mutations.every(mutation => root.contains(mutation.target))) return;
        schedule();
      });
      mutationObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
      resizeObserver?.observe(document.documentElement);
      resizeObserver?.observe(document.body);
      addEventListener('scroll', schedule, true);
      addEventListener('resize', schedule, { passive: true });
      return {
        setTargets(nextPaths, nextSectionIds, nextAgentActive) {
          paths = Array.from(new Set(nextPaths));
          sectionIds = Array.from(new Set(nextSectionIds));
          agentActive = nextAgentActive === true;
          document.documentElement.toggleAttribute(
            'data-html-editor-agent-selection-active',
            agentActive,
          );
          schedule();
        },
        schedule,
      };
    })();
    // Every custom property (--foo) declared anywhere in the page's stylesheets.
    // getComputedStyle never enumerates custom properties on its own, so they
    // must be looked up by name explicitly. The catalog starts from the parsed
    // document and keeps learning from every live stylesheet/token/inline patch;
    // Infinite Canvas deliberately avoids reloads, so a load-only snapshot would
    // otherwise stay stale for the rest of the editing session.
    const customPropertyNames = new Set();
    const learnCustomPropertiesFromRules = rules => {
      for (const rule of rules || []) {
        if (rule.style) {
          for (let i = 0; i < rule.style.length; i++) {
            const property = rule.style[i];
            if (property.startsWith('--')) customPropertyNames.add(property);
          }
        }
        if (rule.cssRules) learnCustomPropertiesFromRules(rule.cssRules);
      }
    };
    const learnCustomPropertiesFromCssText = cssText => {
      for (const match of String(cssText || '').matchAll(/(--[-_a-zA-Z0-9]+)\\s*:/g)) {
        customPropertyNames.add(match[1]);
      }
    };
    const learnCustomPropertiesFromStyleElement = style => {
      if (!(style instanceof HTMLStyleElement)) return;
      learnCustomPropertiesFromCssText(style.textContent || '');
      try {
        if (style.sheet?.cssRules) {
          learnCustomPropertiesFromRules(style.sheet.cssRules);
        }
      } catch {
        // A live editor-owned style is expected to be readable. The text scan
        // above still preserves generated token names if a browser blocks CSSOM.
      }
    };
    if (!passiveBreakpointPreview) {
      for (const sheet of document.styleSheets) {
        try {
          if (sheet.cssRules) learnCustomPropertiesFromRules(sheet.cssRules);
        } catch {
          // Cross-origin stylesheet; unreadable without changing authored policy.
        }
      }
    }
    let editorRevealedLocaleSelector = null;
    let editorRevealedLocaleSelectorWasOpen = false;
    const syncEditorRevealedLocaleSelector = el => {
      const options = el?.closest?.('[data-kodety-locale-options]');
      const next = options?.closest?.(
        'details[data-kodety-locale-selector], details[data-incode-component="locales-list"]'
      ) || null;
      if (next === editorRevealedLocaleSelector) return;
      if (editorRevealedLocaleSelector) {
        if (!editorRevealedLocaleSelectorWasOpen) editorRevealedLocaleSelector.open = false;
        editorRevealedLocaleSelector.removeAttribute('data-html-editor-locale-forced-open');
      }
      editorRevealedLocaleSelector = next;
      editorRevealedLocaleSelectorWasOpen = Boolean(next?.open);
      if (next) {
        next.open = true;
        next.setAttribute('data-html-editor-locale-forced-open', '');
      }
    };
    let editorRevealedOverlays = [];
    let editorRevealedOverlayAttributes = new Map();
    let editorSuppressedOverlayAttributes = new Map();
    // The first pass inventories the document. Later selection changes touch
    // only the old/new overlay roots instead of rescanning every overlay.
    let editorOverlayStructureDirty = true;
    const editorOverlayOwnedDescendant = (root, selector) => (
      Array.from(root.querySelectorAll(selector)).find(element => (
        element.closest('[data-kodety-overlay]') === root
      )) || null
    );
    const editorOverlaySurface = root => (
      root?.matches?.('[data-kodety-overlay-surface]')
        ? root
        : editorOverlayOwnedDescendant(root, '[data-kodety-overlay-surface]') || root
    );
    const editorOverlayRootForToken = rawToken => {
      const token = String(rawToken || '').replace(/^#/, '').trim();
      if (!token) return null;
      for (const root of document.querySelectorAll('[data-kodety-overlay]')) {
        const surface = editorOverlaySurface(root);
        if (
          root.id === token
          || root.getAttribute('data-kodety-overlay') === token
          || surface?.id === token
        ) return root;
      }
      return document.getElementById(token)?.closest?.('[data-kodety-overlay]') || null;
    };
    const editorOverlayRootForElement = el => {
      if (!(el instanceof Element)) return null;
      const closestRoot = el.closest('[data-kodety-overlay]');
      if (closestRoot) return closestRoot;
      const control = el.closest(
        '[data-kodety-overlay-target], [data-kodety-overlay-trigger], [data-kodety-overlay-open], [data-kodety-overlay-toggle], [data-kodety-overlay-close], [data-kodefy-checkout], [aria-controls]'
      );
      if (!control) return null;
      const rawTargets = [
        control.getAttribute('data-kodety-overlay-target'),
        control.getAttribute('data-kodety-overlay-toggle'),
        control.getAttribute('data-kodety-overlay-open'),
        control.getAttribute('data-kodety-overlay-trigger'),
        control.getAttribute('data-kodety-overlay-close'),
        control.getAttribute('aria-controls'),
      ];
      for (const rawTarget of rawTargets) {
        if (!rawTarget || ['true', 'false'].includes(rawTarget.trim().toLowerCase())) continue;
        for (const token of rawTarget.trim().split(/\\s+/)) {
          const root = editorOverlayRootForToken(token);
          if (root) return root;
        }
      }
      return null;
    };
    const rememberEditorOverlayAttribute = (element, name) => {
      if (!(element instanceof Element)) return;
      let attributes = editorRevealedOverlayAttributes.get(element);
      if (!attributes) {
        attributes = new Map();
        editorRevealedOverlayAttributes.set(element, attributes);
      }
      if (attributes.has(name)) return;
      attributes.set(name, {
        existed: element.hasAttribute(name),
        value: element.getAttribute(name) || '',
      });
    };
    const setEditorOverlayAttribute = (element, name, value) => {
      if (!(element instanceof Element)) return;
      const alreadyMatches = value === null
        ? !element.hasAttribute(name)
        : element.hasAttribute(name) && element.getAttribute(name) === value;
      if (alreadyMatches) return;
      rememberEditorOverlayAttribute(element, name);
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    };
    const rememberEditorSuppressedOverlayAttribute = (root, element, name) => {
      if (!(root instanceof Element) || !(element instanceof Element)) return;
      let record = editorSuppressedOverlayAttributes.get(element);
      if (!record) {
        record = { root, attributes: new Map() };
        editorSuppressedOverlayAttributes.set(element, record);
      }
      if (record.attributes.has(name)) return;
      record.attributes.set(name, {
        existed: element.hasAttribute(name),
        value: element.getAttribute(name) || '',
      });
    };
    const setEditorSuppressedOverlayAttribute = (root, element, name, value) => {
      if (!(element instanceof Element)) return;
      const alreadyMatches = value === null
        ? !element.hasAttribute(name)
        : element.hasAttribute(name) && element.getAttribute(name) === value;
      if (alreadyMatches) return;
      rememberEditorSuppressedOverlayAttribute(root, element, name);
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    };
    const showEditorOverlayTopLayer = element => {
      if (!(element instanceof HTMLElement)) return false;
      if (typeof element.showPopover !== 'function') return false;
      setEditorOverlayAttribute(element, 'popover', 'manual');
      try {
        if (element.matches(':popover-open')) return true;
        element.showPopover();
        return true;
      } catch {
        return false;
      }
    };
    const editorOverlayDisplayValues = new Set([
      'block', 'grid', 'flex', 'inline-block', 'inline-flex', 'table', 'flow-root', 'contents',
    ]);
    const editorOverlayProjectedDisplay = element => {
      if (!(element instanceof HTMLElement)) return 'block';
      const inlineDisplay = element.style.getPropertyValue('display').trim().toLowerCase();
      if (inlineDisplay !== 'none' && editorOverlayDisplayValues.has(inlineDisplay)) return inlineDisplay;
      const computedDisplay = getComputedStyle(element).display.trim().toLowerCase();
      if (computedDisplay !== 'none' && editorOverlayDisplayValues.has(computedDisplay)) return computedDisplay;
      if (element.matches('[data-kodefy-checkout-item][data-kodefy-template]')) return 'grid';
      return 'block';
    };
    const editorOverlayUsesAnchoredLayout = (root, surface) => {
      const mode = (
        surface?.getAttribute?.('data-kodety-overlay-mode')
        || root?.getAttribute?.('data-kodety-overlay-mode')
        || root?.getAttribute?.('data-kodety-overlay-position')
        || ''
      ).trim().toLowerCase();
      if (mode) return mode === 'anchored';
      return ['popover', 'tooltip', 'menu'].includes(
        (root?.getAttribute?.('data-kodety-overlay') || '').trim().toLowerCase(),
      );
    };
    const restoreEditorSuppressedOverlayElement = (element, record) => {
      record.attributes.forEach((entry, name) => {
        if (entry.existed) element.setAttribute(name, entry.value);
        else element.removeAttribute(name);
      });
      editorSuppressedOverlayAttributes.delete(element);
    };
    const restoreEditorSuppressedOverlay = root => {
      editorSuppressedOverlayAttributes.forEach((record, element) => {
        if (record.root === root) restoreEditorSuppressedOverlayElement(element, record);
      });
    };
    const editorSuppressedOverlayElementStillOwned = (element, record) => {
      const root = record.root;
      if (!root.isConnected || !root.matches('[data-kodety-overlay]')) return false;
      if (element === root) return true;
      if (!element.isConnected || element.closest('[data-kodety-overlay]') !== root) return false;
      if (element.matches('[data-kodety-overlay-surface]')) return editorOverlaySurface(root) === element;
      if (element.matches('[data-kodety-overlay-backdrop]')) {
        return editorOverlayOwnedDescendant(root, '[data-kodety-overlay-backdrop]') === element;
      }
      return element.matches(
        '[data-kodety-overlay-trigger], [data-kodety-overlay-open], [data-kodety-overlay-toggle]'
      );
    };
    const reconcileEditorSuppressedOverlayAttributes = () => {
      editorSuppressedOverlayAttributes.forEach((record, element) => {
        if (!editorSuppressedOverlayElementStillOwned(element, record)) {
          restoreEditorSuppressedOverlayElement(element, record);
        }
      });
    };
    const suppressEditorOverlay = root => {
      if (!(root instanceof Element)) return;
      const surface = editorOverlaySurface(root);
      const backdrop = editorOverlayOwnedDescendant(root, '[data-kodety-overlay-backdrop]');
      [surface, backdrop].forEach(element => {
        if (!(element instanceof Element)) return;
        if (element instanceof HTMLElement && typeof element.hidePopover === 'function') {
          try { element.hidePopover(); } catch {}
        }
        setEditorSuppressedOverlayAttribute(root, element, 'data-state', 'closed');
        setEditorSuppressedOverlayAttribute(root, element, 'hidden', '');
        setEditorSuppressedOverlayAttribute(root, element, 'inert', '');
        setEditorSuppressedOverlayAttribute(root, element, 'aria-hidden', 'true');
        if (element.tagName === 'DIALOG') {
          setEditorSuppressedOverlayAttribute(root, element, 'open', null);
        }
      });
      setEditorSuppressedOverlayAttribute(root, root, 'data-state', 'closed');
      setEditorSuppressedOverlayAttribute(
        root,
        root,
        'data-html-editor-overlay-forced-open',
        null,
      );
      root.querySelectorAll(
        '[data-kodety-overlay-trigger], [data-kodety-overlay-open], [data-kodety-overlay-toggle]'
      ).forEach(control => {
        if (control.closest('[data-kodety-overlay]') !== root) return;
        setEditorSuppressedOverlayAttribute(root, control, 'data-state', 'closed');
        setEditorSuppressedOverlayAttribute(root, control, 'aria-expanded', 'false');
      });
    };
    const restoreEditorRevealedOverlay = () => {
      editorRevealedOverlayAttributes.forEach((_attributes, element) => {
        if (element instanceof HTMLElement && typeof element.hidePopover === 'function') {
          try { element.hidePopover(); } catch {}
        }
      });
      editorRevealedOverlayAttributes.forEach((attributes, element) => {
        attributes.forEach((entry, name) => {
          if (entry.existed) element.setAttribute(name, entry.value);
          else element.removeAttribute(name);
        });
      });
      editorRevealedOverlayAttributes = new Map();
      editorRevealedOverlays = [];
    };
    const forceEditorOverlayOpen = root => {
      const surface = editorOverlaySurface(root);
      const backdrop = editorOverlayOwnedDescendant(root, '[data-kodety-overlay-backdrop]');
      const checkoutTemplates = Array.from(root.querySelectorAll('[data-kodefy-checkout-item][data-kodefy-template]'));
      const visibleElements = Array.from(new Set([root, surface, backdrop, ...checkoutTemplates].filter(Boolean)));
      setEditorOverlayAttribute(root, 'data-html-editor-overlay-forced-open', '');
      visibleElements.forEach(element => {
        setEditorOverlayAttribute(element, 'data-state', 'open');
        setEditorOverlayAttribute(element, 'hidden', null);
        setEditorOverlayAttribute(element, 'inert', null);
        setEditorOverlayAttribute(element, 'aria-hidden', 'false');
      });
      // Resolve the open-state layout only after state/hidden projection. CSS
      // such as [data-state="open"] .surface { display:grid } must be allowed
      // to participate before the Design-only priority marker is chosen.
      visibleElements.forEach(element => {
        setEditorOverlayAttribute(
          element,
          'data-html-editor-overlay-projected-display',
          editorOverlayProjectedDisplay(element),
        );
      });
      showEditorOverlayTopLayer(backdrop);
      const surfaceInTopLayer = editorOverlayUsesAnchoredLayout(root, surface)
        ? false
        : showEditorOverlayTopLayer(surface);
      if (surface?.tagName === 'DIALOG' && !surfaceInTopLayer) {
        // The content attribute reveals a non-modal dialog without invoking
        // top-layer focus, scroll locking or showModal() inside Design mode.
        setEditorOverlayAttribute(surface, 'open', '');
      }
      root.querySelectorAll(
        '[data-kodety-overlay-trigger], [data-kodety-overlay-open], [data-kodety-overlay-toggle]'
      ).forEach(control => {
        if (control.closest('[data-kodety-overlay]') !== root) return;
        setEditorOverlayAttribute(control, 'data-state', 'open');
        setEditorOverlayAttribute(control, 'aria-expanded', 'true');
      });
    };
    const editorOverlayRootForSelection = el => (
      el instanceof Element ? el.closest('[data-kodety-overlay]') : null
    );
    const editorOverlayRootsForSelection = elements => {
      const roots = [];
      elements.forEach(element => {
        const chain = [];
        let root = editorOverlayRootForSelection(element);
        while (root) {
          chain.unshift(root);
          root = root.parentElement?.closest?.('[data-kodety-overlay]') || null;
        }
        chain.forEach(candidate => {
          if (!roots.includes(candidate)) roots.push(candidate);
        });
      });
      return roots;
    };
    const syncEditorRevealedOverlay = (el, dirtyRoots = []) => {
      // Preview has its own interaction runtime. Selection-only projection is
      // strictly a Design-mode concern and must never race a real trigger.
      if (!inspectionEnabled) return;
      reconcileEditorSuppressedOverlayAttributes();
      // An explicit null is the Layers bridge's pre-selection close command.
      // Otherwise derive the union from every selected marker so additive
      // selection can keep independent and nested overlay trees editable.
      const selectedElements = el instanceof Element
        ? Array.from(document.querySelectorAll('[data-html-editor-selected]'))
        : [];
      const next = editorOverlayRootsForSelection(selectedElements);
      const previous = editorRevealedOverlays.slice();
      const structureDirty = editorOverlayStructureDirty;
      const unchanged = !structureDirty
        && next.length === editorRevealedOverlays.length
        && next.every((root, index) => root === editorRevealedOverlays[index]);
      editorOverlayStructureDirty = false;
      if (!unchanged) restoreEditorRevealedOverlay();
      const selectedRoots = unchanged ? editorRevealedOverlays : next;
      const rootsToSync = structureDirty
        ? Array.from(document.querySelectorAll('[data-kodety-overlay]'))
        : Array.from(new Set([...previous, ...selectedRoots, ...dirtyRoots]));
      rootsToSync.forEach(root => {
        if (!(root instanceof Element) || !root.isConnected) return;
        if (selectedRoots.includes(root)) restoreEditorSuppressedOverlay(root);
        else suppressEditorOverlay(root);
      });
      editorRevealedOverlays = selectedRoots;
      editorRevealedOverlays.forEach(root => {
        forceEditorOverlayOpen(root);
      });
    };
    const syncEditorRevealedTransientSurface = el => {
      syncEditorRevealedLocaleSelector(el);
      syncEditorRevealedOverlay(el);
    };
    const applyEditorOverlayAuthoredAttributes = (element, attributes) => {
      const originals = editorRevealedOverlayAttributes.get(element);
      originals?.forEach((entry, name) => {
        if (entry.existed) attributes[name] = entry.value;
        else delete attributes[name];
      });
      const suppressed = editorSuppressedOverlayAttributes.get(element)?.attributes;
      suppressed?.forEach((entry, name) => {
        if (entry.existed) attributes[name] = entry.value;
        else delete attributes[name];
      });
    };
    syncEditorRevealedLocaleSelector(selected);
    syncEditorRevealedOverlay(selected);
    let editorOverlaySuppressionQueued = false;
    const pendingEditorOverlayRoots = new Set();
    if (inspectionEnabled) {
      const editorOverlaySuppressionObserver = new MutationObserver(mutations => {
        const structuralAttributeNames = new Set([
          'data-kodety-overlay',
          'data-kodety-overlay-surface',
          'data-kodety-overlay-backdrop',
          'data-kodety-overlay-trigger',
          'data-kodety-overlay-open',
          'data-kodety-overlay-toggle',
        ]);
        const structuralSelector = [
          '[data-kodety-overlay]',
          '[data-kodety-overlay-surface]',
          '[data-kodety-overlay-backdrop]',
          '[data-kodety-overlay-trigger]',
          '[data-kodety-overlay-open]',
          '[data-kodety-overlay-toggle]',
        ].join(', ');
        const structuralMutation = mutations.some(mutation => {
          if (mutation.type === 'attributes') {
            return structuralAttributeNames.has(mutation.attributeName || '');
          }
          if (mutation.type !== 'childList') return false;
          return [...mutation.addedNodes, ...mutation.removedNodes].some(node => (
            node instanceof Element
            && (node.matches(structuralSelector) || Boolean(node.querySelector(structuralSelector)))
          ));
        });
        const selectedNodeRemoved = mutations.some(mutation => (
          mutation.type === 'childList'
          && Array.from(mutation.removedNodes).some(node => (
            node instanceof Element
            && (
              node.matches('[data-html-editor-selected]')
              || Boolean(node.querySelector('[data-html-editor-selected]'))
            )
          ))
        ));
        if (structuralMutation) editorOverlayStructureDirty = true;
        const overlayMutation = selectedNodeRemoved || mutations.some(mutation => {
          const target = mutation.target instanceof Element ? mutation.target : null;
          if (mutation.type === 'attributes') {
            if (structuralAttributeNames.has(mutation.attributeName || '')) return true;
            return Boolean(target && (
              target.matches(
                '[data-kodety-overlay], [data-kodety-overlay-surface], [data-kodety-overlay-backdrop], [data-kodety-overlay-trigger], [data-kodety-overlay-open], [data-kodety-overlay-toggle]'
              )
              || editorRevealedOverlayAttributes.has(target)
              || editorSuppressedOverlayAttributes.has(target)
            ));
          }
          if (mutation.type !== 'childList') return false;
          return structuralMutation;
        });
        if (overlayMutation && !structuralMutation) {
          mutations.forEach(mutation => {
            const target = mutation.target instanceof Element ? mutation.target : null;
            const suppressedRoot = target
              ? editorSuppressedOverlayAttributes.get(target)?.root
              : null;
            const root = suppressedRoot || target?.closest?.('[data-kodety-overlay]');
            if (root instanceof Element) pendingEditorOverlayRoots.add(root);
          });
        }
        if (!overlayMutation || editorOverlaySuppressionQueued) return;
        editorOverlaySuppressionQueued = true;
        queueMicrotask(() => {
          editorOverlaySuppressionQueued = false;
          const dirtyRoots = Array.from(pendingEditorOverlayRoots);
          pendingEditorOverlayRoots.clear();
          syncEditorRevealedOverlay(selected, dirtyRoots);
        });
      });
      editorOverlaySuppressionObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'data-state',
          'data-html-editor-overlay-forced-open',
          'hidden',
          'inert',
          'aria-hidden',
          'aria-expanded',
          'open',
          'popover',
          'data-kodety-overlay',
          'data-kodety-overlay-surface',
          'data-kodety-overlay-backdrop',
          'data-kodety-overlay-trigger',
          'data-kodety-overlay-open',
          'data-kodety-overlay-toggle',
        ],
      });
    }
    const viewportSizingProperties = new Set([
      'width', 'min-width', 'max-width',
      'height', 'min-height', 'max-height',
      'inline-size', 'min-inline-size', 'max-inline-size',
      'block-size', 'min-block-size', 'max-block-size',
    ]);
    const viewportSizingUnitPattern = /(?:^|[^a-z])(dvw|dvh|svw|svh|lvw|lvh|vw|vh|vmin|vmax)\\b/i;
    const splitViewportSelectorList = selector => {
      const result = [];
      let current = '';
      let depth = 0;
      for (const character of selector) {
        if (character === '(' || character === '[') depth += 1;
        else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
        if (character === ',' && depth === 0) {
          if (current.trim()) result.push(current.trim());
          current = '';
        } else current += character;
      }
      if (current.trim()) result.push(current.trim());
      return result;
    };
    const viewportSelectorSpecificity = (selector, element) => {
      const branches = splitViewportSelectorList(selector).filter(candidate => {
        try { return element.matches(candidate); } catch { return false; }
      });
      return branches.reduce((maximum, branch) => {
        const withoutWhere = branch.replace(/:where\\((?:[^()]|\\([^()]*\\))*\\)/g, '');
        const ids = (withoutWhere.match(/#[\\w-]+/g) || []).length;
        const classes = (withoutWhere.match(/\\.[\\w-]+|\\[[^\\]]+\\]|:(?!:)[\\w-]+(?:\\([^)]*\\))?/g) || []).length;
        const elements = (
          withoutWhere
            .replace(/#[\\w-]+|\\.[\\w-]+|\\[[^\\]]+\\]|::?[\\w-]+(?:\\([^)]*\\))?/g, ' ')
            .match(/(^|[\\s>+~])(?:[a-z][\\w-]*|\\*)/gi)
          || []
        ).filter(token => !token.trim().endsWith('*')).length;
        return Math.max(maximum, ids * 1000000 + classes * 1000 + elements);
      }, 0);
    };
    const resolveViewportSizingVariables = (element, value) => {
      let resolved = value;
      const computed = getComputedStyle(element);
      for (let depth = 0; depth < 8 && resolved.includes('var('); depth += 1) {
        const next = resolved.replace(/var\\(\\s*(--[\\w-]+)\\s*(?:,\\s*([^()]*))?\\)/g, (_match, name, fallback) => (
          computed.getPropertyValue(name).trim() || String(fallback || '').trim()
        ));
        if (next === resolved) break;
        resolved = next;
      }
      return resolved;
    };
    const readAuthoredViewportSizingStyle = element => {
      const winners = new Map();
      let order = 0;
      const accept = (property, value, important, specificity) => {
        if (!viewportSizingProperties.has(property)) return;
        const next = { value, important, specificity, order };
        const current = winners.get(property);
        if (
          !current
          || Number(next.important) > Number(current.important)
          || (
            next.important === current.important
            && (
              next.specificity > current.specificity
              || (next.specificity === current.specificity && next.order >= current.order)
            )
          )
        ) winners.set(property, next);
      };
      const walkRules = rules => {
        Array.from(rules || []).forEach(rule => {
          order += 1;
          if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
            try {
              if (!matchMedia(rule.conditionText).matches) return;
            } catch {
              return;
            }
            walkRules(rule.cssRules);
            return;
          }
          if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
            try {
              if (!CSS.supports(rule.conditionText)) return;
            } catch {
              return;
            }
            walkRules(rule.cssRules);
            return;
          }
          if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
            let matches = false;
            try { matches = element.matches(rule.selectorText); } catch { matches = false; }
            if (!matches) return;
            const specificity = viewportSelectorSpecificity(rule.selectorText, element);
            Array.from(rule.style).forEach(property => {
              accept(
                property,
                rule.style.getPropertyValue(property).trim(),
                rule.style.getPropertyPriority(property) === 'important',
                specificity,
              );
            });
            return;
          }
          if (rule.cssRules) walkRules(rule.cssRules);
        });
      };
      Array.from(document.styleSheets).forEach(sheet => {
        try {
          if (!sheet.disabled) walkRules(sheet.cssRules);
        } catch {
          // Imported project styles are inlined. Cross-origin stylesheets that
          // remain opaque simply keep their browser-computed fallback.
        }
      });
      const originalInlineStyle = element.getAttribute('data-html-editor-original-style');
      if (originalInlineStyle !== null) {
        const probe = document.createElement('span');
        probe.setAttribute('style', originalInlineStyle);
        order += 1;
        Array.from(probe.style).forEach(property => {
          accept(
            property,
            probe.style.getPropertyValue(property).trim(),
            probe.style.getPropertyPriority(property) === 'important',
            1000000000,
          );
        });
      }
      const result = {};
      winners.forEach((candidate, property) => {
        const resolved = resolveViewportSizingVariables(element, candidate.value);
        if (viewportSizingUnitPattern.test(candidate.value)) result[property] = candidate.value;
        else if (viewportSizingUnitPattern.test(resolved)) result[property] = resolved;
      });
      return result;
    };
    // The Inspector has a finite visual surface. Reading every property exposed
    // by CSSStyleDeclaration forced a full style/layout flush plus hundreds of
    // bridge fields for every click. Keep the computed fallback broad enough
    // for every built-in/advanced control while authored declarations continue
    // to come from the source parser in the parent.
    const selectionComputedProperties = Array.from(new Set((
      'position top right bottom left inset inset-block inset-inline z-index display box-sizing float clear visibility ' +
      'flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content align-items align-content align-self order ' +
      'grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows grid-auto-flow grid-column grid-row place-items place-content gap column-gap row-gap ' +
      'margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left ' +
      'width height min-width max-width min-height max-height inline-size block-size min-inline-size max-inline-size min-block-size max-block-size aspect-ratio object-fit object-position ' +
      'opacity overflow overflow-x overflow-y clip-path background-color background-image background-size background-position background-repeat background-attachment background-blend-mode ' +
      'border border-width border-top-width border-right-width border-bottom-width border-left-width border-style border-top-style border-right-style border-bottom-style border-left-style border-color border-top-color border-right-color border-bottom-color border-left-color border-radius border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius border-image-source ' +
      'box-shadow ' +
      'font font-family font-size font-weight font-style line-height letter-spacing text-align text-transform text-decoration text-decoration-color text-decoration-thickness text-underline-offset text-wrap text-shadow white-space word-break overflow-wrap color -webkit-line-clamp ' +
      'translate scale rotate transform transform-origin transform-style perspective backface-visibility filter backdrop-filter mix-blend-mode isolation mask-image mask-mode mask-size mask-position mask-repeat mask-origin mask-clip mask-composite -webkit-mask-image -webkit-mask-size -webkit-mask-position -webkit-mask-repeat -webkit-mask-origin -webkit-mask-clip -webkit-mask-composite -webkit-mask-source-type ' +
      'transition transition-property transition-duration transition-timing-function transition-delay animation animation-name animation-duration animation-timing-function animation-delay animation-iteration-count animation-direction animation-fill-mode animation-play-state ' +
      'image-rendering cursor caret-color accent-color pointer-events user-select scroll-behavior scroll-snap-type scroll-snap-align scroll-margin-top overscroll-behavior appearance resize list-style content contain content-visibility will-change'
    ).split(' ')));
    const cssOriginDescendants = property => {
      const result = new Set([property]);
      const visit = current => {
        (cssShorthandLonghands[current] || []).forEach(child => {
          if (result.has(child)) return;
          result.add(child);
          visit(child);
        });
      };
      visit(property);
      return result;
    };
    const cssOriginAffectedProperties = declaredProperty => {
      if (declaredProperty === 'all') {
        return selectionComputedProperties.filter(property => !property.startsWith('--'));
      }
      return Array.from(cssOriginDescendants(declaredProperty));
    };
    const cssOriginRuleDeclarations = style => {
      const winners = new Map();
      Array.from(style || []).forEach((declaredProperty, declarationOrder) => {
        const property = normalizeRuntimeStyleProperty(declaredProperty);
        if (!property || property.startsWith('--kodety-origin-probe-')) return;
        const value = style.getPropertyValue(property).trim().toLowerCase();
        // These values intentionally delegate ownership to another cascade
        // tier. Let that lower candidate win the probe instead of returning a
        // locator which cannot be patched deterministically.
        if (value === 'revert' || value === 'revert-layer') return;
        const important = style.getPropertyPriority(property) === 'important';
        cssOriginAffectedProperties(property).forEach(affectedProperty => {
          const current = winners.get(affectedProperty);
          if (
            !current
            || Number(important) > Number(current.important)
            || (important === current.important && declarationOrder >= current.declarationOrder)
          ) {
            winners.set(affectedProperty, {
              property,
              important,
              declarationOrder,
            });
          }
        });
      });
      return winners;
    };
    /**
     * Ask the browser cascade itself which authored declaration owns each
     * property. A temporary custom property is written beside every candidate
     * with the same selector, layer, scope, source order and priority. One
     * getComputedStyle read then gives us the real winner without attempting
     * to reimplement specificity/@layer/@scope/@container in the parent.
     */
    const readAuthoredStyleOrigins = element => {
      const candidates = [];
      const candidateByToken = new Map();
      const probes = new Map();
      const changes = [];
      let tokenSequence = 0;
      const probeFor = property => {
        let probe = probes.get(property);
        if (!probe) {
          probe = '--kodety-origin-probe-' + probes.size;
          probes.set(property, probe);
        }
        return probe;
      };
      const matchingSelector = selectorText => {
        // Selection snapshots describe the Base authoring state. Pointer/focus
        // state can change while the user moves between Canvas and Inspector;
        // never let that incidental state redirect a base edit into :hover.
        if (/(^|[^:]):(?:hover|focus|focus-visible|active)\\b/i.test(selectorText)) return '';
        // Most project rules do not match the selected node. Let the native
        // selector engine reject the complete list before allocating/parsing
        // every branch; retain the exact branch/provenance resolution below
        // only for candidates which can actually participate in this cascade.
        try { if (!element.matches(selectorText)) return ''; } catch { return ''; }
        if (!selectorText.includes(',')) return selectorText.trim();
        const branches = splitViewportSelectorList(selectorText).filter(candidate => {
          try { return element.matches(candidate); } catch { return false; }
        });
        // A grouped source rule may target unrelated siblings. Route the edit
        // through the strongest branch matching this element; the source
        // patcher finds that branch in the group and isolates it in place.
        return branches.sort((left, right) => (
          viewportSelectorSpecificity(right, element)
          - viewportSelectorSpecificity(left, element)
        ))[0] || '';
      };
      const collectRule = (rule, cssPath) => {
        if (typeof CSSStyleRule === 'undefined' || !(rule instanceof CSSStyleRule)) return;
        const selector = matchingSelector(rule.selectorText || '');
        if (!selector) return;
        cssOriginRuleDeclarations(rule.style).forEach((declaration, property) => {
          const token = 'c' + (++tokenSequence);
          const candidate = {
            token,
            property,
            sourceProperty: declaration.property,
            selector,
            cssPath,
            important: declaration.important,
            inline: false,
            style: rule.style,
          };
          candidates.push(candidate);
          candidateByToken.set(token, candidate);
        });
      };
      const walkRules = (rules, cssPath) => {
        Array.from(rules || []).forEach(rule => {
          collectRule(rule, cssPath);
          if (rule.cssRules) walkRules(rule.cssRules, cssPath);
        });
      };
      Array.from(document.styleSheets).forEach(sheet => {
        const owner = sheet.ownerNode;
        if (!(owner instanceof Element) || sheet.disabled) return;
        const cssPath = owner.getAttribute('data-editor-source') || '';
        const embedded = owner.hasAttribute('data-editor-embedded-source');
        if ((!cssPath && !embedded) || cssPath === '.kodety/canvas-style-preview.css') return;
        try { walkRules(sheet.cssRules, cssPath); } catch {
          // Opaque cross-origin sheets have no safe source locator. The parent
          // will use its bounded authoritative fallback for those declarations.
        }
      });
      const originalInlineStyle = element.getAttribute('data-html-editor-original-style');
      if (originalInlineStyle !== null) {
        const probeElement = document.createElement('span');
        probeElement.setAttribute('style', originalInlineStyle);
        cssOriginRuleDeclarations(probeElement.style).forEach((declaration, property) => {
          const token = 'c' + (++tokenSequence);
          const candidate = {
            token,
            property,
            sourceProperty: declaration.property,
            selector: '',
            cssPath: '',
            important: declaration.important,
            inline: true,
            style: element.style,
          };
          candidates.push(candidate);
          candidateByToken.set(token, candidate);
        });
      }
      if (!candidates.length) return {};
      try {
        candidates.forEach(candidate => {
          const probe = probeFor(candidate.property);
          const style = candidate.style;
          changes.push({
            style,
            probe,
            value: style.getPropertyValue(probe),
            priority: style.getPropertyPriority(probe),
          });
          style.setProperty(
            probe,
            candidate.token,
            candidate.important ? 'important' : '',
          );
        });
        const computed = getComputedStyle(element);
        const result = {};
        probes.forEach((probe, property) => {
          const token = computed.getPropertyValue(probe).trim();
          const winner = candidateByToken.get(token);
          if (!winner) return;
          result[property] = {
            selector: winner.selector,
            cssPath: winner.cssPath,
            property: winner.sourceProperty,
            important: winner.important,
            inline: winner.inline,
          };
        });
        return result;
      } finally {
        changes.reverse().forEach(change => {
          if (change.value) {
            change.style.setProperty(change.probe, change.value, change.priority);
          } else {
            change.style.removeProperty(change.probe);
          }
        });
      }
    };
    const authoredViewportSizingStyleCache = new WeakMap();
    const snapshotIdentity = el => {
      let authoredStyle = {};
      try {
        authoredStyle = JSON.parse(el.getAttribute('data-kodety-vh-authored-style') || '{}');
      } catch {
        authoredStyle = {};
      }
      const attributes = Object.fromEntries(Array.from(el.attributes)
        .filter(a => !a.name.startsWith('data-html-editor-') && !a.name.startsWith('data-kodety-liquid-'))
        .map(a => [a.name, a.value]));
      ['src','srcdoc','srcset','imagesrcset','data-video-urls','poster','href','style','allow','allowfullscreen','autoplay','loading','data-src','data-lazy-src','data-original','data-srcset','data-lazy-srcset','data-poster','data-poster-url','data-incode-js-files'].forEach(name => {
        const original = el.getAttribute('data-html-editor-original-' + name);
        if (original !== null) attributes[name] = original;
      });
      ['src','srcdoc','srcset','poster','loading'].forEach(name => {
        if (el.hasAttribute('data-html-editor-canvas-generated-' + name)) delete attributes[name];
      });
      Array.from(el.attributes).forEach(attribute => {
        const match = attribute.name.match(/^data-html-editor-original-(on[a-z].*)$/i);
        if (match) attributes[match[1]] = attribute.value;
      });
      // Design-mode overlay visibility is a projection only. Snapshots must
      // report the authored hidden/ARIA/state attributes, never this reveal.
      applyEditorOverlayAuthoredAttributes(el, attributes);
      // Every element that was AUTHORED with an inline style received an
      // original-style marker at build time. A style attribute without that
      // marker was injected afterwards by runtime animation code (GSAP, AOS…);
      // reporting it as authored would flip the editing target to Inline and
      // let mid-animation values leak into the stylesheet on migration.
      if (attributes.style !== undefined && el.getAttribute('data-html-editor-original-style') === null) delete attributes.style;
      // Editability follows the source structure (data-html-editor-leaf), not the
      // live DOM, so runtime GSAP span-splitting never blocks editing the text.
      const isLeaf = el.hasAttribute('data-html-editor-leaf');
      return {
        path: el.dataset.htmlEditorPath, tag: el.tagName.toLowerCase(), id: el.id,
        classes: Array.from(el.classList).filter(name => !name.startsWith('html-editor-')),
        attributes,
        text: isLeaf ? (el.textContent || '').trim() : '', hasElementChildren: !isLeaf,
        computedStyle: {},
        authoredStyle,
        parentDisplay: '',
        parentPosition: '',
      };
    };
    const snapshot = el => {
      const payload = snapshotIdentity(el);
      const computed = getComputedStyle(el);
      const computedStyle = {};
      selectionComputedProperties.forEach(property => {
        computedStyle[property] = computed.getPropertyValue(property);
      });
      let customPropertyCount = 0;
      customPropertyNames.forEach(name => {
        // A malicious/imported stylesheet can declare an unbounded variable
        // catalog. Explicit declarations still come from source; this bounded
        // fallback keeps one selection message below the protocol budget.
        if (customPropertyCount >= 512) return;
        computedStyle[name] = computed.getPropertyValue(name);
        customPropertyCount += 1;
      });
      let authoredStyle = payload.authoredStyle;
      if (
        !Object.keys(authoredStyle).length
        && (
          el.hasAttribute('data-kodety-vh-simulated')
          || el.hasAttribute('data-kodety-vh-properties')
        )
      ) {
        // Normally the Infinite Canvas marker above is the zero-cost path.
        // Cache the compatibility fallback so an old runtime marker can never
        // rescan every stylesheet on each selection hydration.
        authoredStyle = authoredViewportSizingStyleCache.get(el);
        if (!authoredStyle) {
          authoredStyle = readAuthoredViewportSizingStyle(el);
          authoredViewportSizingStyleCache.set(el, authoredStyle);
        }
      }
      const parentComputed = el.parentElement ? getComputedStyle(el.parentElement) : null;
      // CSSStyleDeclaration is live: defer neither getter until after the
      // origin probe restores stylesheet declarations. That restoration
      // invalidates style again across matching elements; reading these fields
      // afterwards forced a second synchronous document-wide resolution.
      const parentDisplay = parentComputed?.display || '';
      const parentPosition = parentComputed?.position || '';
      return {
        ...payload,
        computedStyle,
        authoredStyle,
        styleOrigins: readAuthoredStyleOrigins(el),
        parentDisplay,
        parentPosition,
      };
    };
    let selectionSnapshotSequence = 0;
    let selectionDetailFrame = 0;
    let selectionDetailIdle = 0;
    let selectionDetailTimer = 0;
    let selectionDetailResumeTimer = 0;
    let selectionDetailSuspended = false;
    let pendingSelectionDetail = null;
    const clearScheduledSelectionDetail = () => {
      if (selectionDetailFrame) cancelAnimationFrame(selectionDetailFrame);
      if (selectionDetailIdle && cancelIdleCallback) cancelIdleCallback(selectionDetailIdle);
      if (selectionDetailTimer) clearTimeout(selectionDetailTimer);
      selectionDetailFrame = 0;
      selectionDetailIdle = 0;
      selectionDetailTimer = 0;
    };
    const runSelectionDetailWhenIdle = callback => {
      if (requestIdleCallback) {
        selectionDetailIdle = requestIdleCallback(() => {
          selectionDetailIdle = 0;
          callback();
        }, { timeout: 240 });
      } else {
        selectionDetailTimer = setTimeout(() => {
          selectionDetailTimer = 0;
          callback();
        }, 0);
      }
    };
    const schedulePendingSelectionDetail = () => {
      clearScheduledSelectionDetail();
      if (selectionDetailSuspended || !pendingSelectionDetail) return;
      const pending = pendingSelectionDetail;
      // Return from the click/command task and let Chrome paint the native
      // selected marker before any overlay discovery or computed-style read.
      selectionDetailFrame = requestAnimationFrame(() => {
        selectionDetailFrame = 0;
        runSelectionDetailWhenIdle(() => {
          if (
            selectionDetailSuspended
            || pendingSelectionDetail !== pending
            || pending.sequence !== selectionSnapshotSequence
            || selected !== pending.element
          ) return;
          syncEditorRevealedTransientSurface(pending.element);
          if (!pending.element) {
            pendingSelectionDetail = null;
            refreshDirectControls();
            return;
          }
          if (!pending.element.isConnected) return;
          // Selection may target <body> or a section containing hundreds of
          // off-screen images. Release only that element; viewport discovery
          // remains responsible for descendants.
          releasedDesignAssetElements.add(pending.element);
          rewriteRuntimeElement(pending.element, true);
          scheduleVisibleDesignAssetDiscovery();
          refreshDirectControls();
          // Overlay projection writes attributes. Yield one more paint before
          // asking computed style to resolve those writes.
          selectionDetailFrame = requestAnimationFrame(() => {
            selectionDetailFrame = 0;
            runSelectionDetailWhenIdle(() => {
              if (
                selectionDetailSuspended
                || pendingSelectionDetail !== pending
                || pending.sequence !== selectionSnapshotSequence
                || selected !== pending.element
                || !pending.element.isConnected
              ) return;
              try {
                const elements = Array.from(document.querySelectorAll('[data-html-editor-selected]'));
                postEditorMessage({
                  type: 'html-editor-selection',
                  breakpointId: canvasViewBreakpointId || 'base',
                  payload: snapshot(pending.element),
                  selectedPaths: elements
                    .map(item => item.dataset.htmlEditorPath)
                    .filter(path => typeof path === 'string'),
                  revision: appliedEditorRevision,
                  selectionSequence: pending.sequence,
                  detail: 'computed',
                  ...(pending.origin ? { origin: pending.origin } : {}),
                });
              } catch {
                // The identity snapshot is already authoritative for selection;
                // a hostile CSSOM must never make the canvas unselectable.
              }
              if (pendingSelectionDetail === pending) pendingSelectionDetail = null;
            });
          });
        });
      });
    };
    const prioritizeInteractionControl = action => {
      if (selectionDetailResumeTimer) clearTimeout(selectionDetailResumeTimer);
      selectionDetailResumeTimer = 0;
      if (action === 'play' || action === 'restart' || action === 'reverse') {
        selectionDetailSuspended = true;
        clearScheduledSelectionDetail();
        clearDirectDetail();
        if (directOverlay) directOverlay.hidden = true;
        return;
      }
      if (action === 'seek') {
        selectionDetailSuspended = true;
        clearScheduledSelectionDetail();
        clearDirectDetail();
        if (directOverlay) directOverlay.hidden = true;
        selectionDetailResumeTimer = setTimeout(() => {
          selectionDetailResumeTimer = 0;
          selectionDetailSuspended = false;
          schedulePendingSelectionDetail();
          refreshDirectControls();
        }, 96);
        return;
      }
      if (action === 'pause' || action === 'reset' || action === 'release') {
        selectionDetailSuspended = false;
        schedulePendingSelectionDetail();
        refreshDirectControls();
      }
    };
    const selectElement = (el, additive, origin = 'canvas') => {
      const wasSelected = el.hasAttribute('data-html-editor-selected');
      if (!additive) document.querySelectorAll('[data-html-editor-selected]').forEach(item => item.removeAttribute('data-html-editor-selected'));
      if (additive && wasSelected) el.removeAttribute('data-html-editor-selected');
      else el.setAttribute('data-html-editor-selected', '');
      const elements = Array.from(document.querySelectorAll('[data-html-editor-selected]'));
      selected = el.hasAttribute('data-html-editor-selected') ? el : elements.at(-1) || null;
      const sequence = ++selectionSnapshotSequence;
      let payload = null;
      if (selected) {
        try {
          payload = snapshotIdentity(selected);
        } catch {
          // Imported pages can expose non-standard CSSOM/attribute objects.
          // Selection itself must remain usable even when one of those host
          // values cannot be serialized for the rich Inspector snapshot.
          payload = {
            path: selected.dataset.htmlEditorPath || '',
            tag: selected.tagName.toLowerCase(),
            id: selected.id || '',
            classes: Array.from(selected.classList || []),
            attributes: {},
            text: selected.hasAttribute('data-html-editor-leaf')
              ? (selected.textContent || '').trim()
              : '',
            hasElementChildren: !selected.hasAttribute('data-html-editor-leaf'),
            computedStyle: {},
            authoredStyle: {},
            parentDisplay: '',
            parentPosition: '',
          };
        }
      }
      postEditorMessage({
        type: 'html-editor-selection',
        breakpointId: canvasViewBreakpointId || 'base',
        payload,
        selectedPaths: elements.map(item => item.dataset.htmlEditorPath).filter(path => typeof path === 'string'),
        revision: appliedEditorRevision,
        selectionSequence: sequence,
        detail: 'identity',
        origin,
      });
      pendingSelectionDetail = { element: selected, sequence, origin };
      schedulePendingSelectionDetail();
      refreshDirectControls();
    };
    const directOverlay = inspectionEnabled ? document.createElement('div') : null;
    let directSizeLabel = null;
    let directOverlayBadge = null;
    let directGapLayer = null;
    let directSpacingLayer = null;
    let directFrame = 0;
    let directDetailFrame = 0;
    let directDetailIdle = 0;
    let directDetailTimer = 0;
    let directDetailSequence = 0;
    let directSyncFrame = 0;
    let directDrag = null;
    let directPositionElement = null;
    let pendingDirectMove = null;
    let pendingDirectCommit = null;
    let directGestureSequence = 0;
    let directViewScale = 1;
    let suppressDirectClick = false;
    let canvasTool = 'select';
    const directHandleKinds = [
      'padding-top','padding-right','padding-bottom','padding-left',
      'border-width','border-radius','resize-width','resize-height',
    ];
    const directProperty = {
      'padding-top': 'padding-top', 'padding-right': 'padding-right',
      'padding-bottom': 'padding-bottom', 'padding-left': 'padding-left',
      'border-width': 'border-width', 'border-radius': 'border-radius',
      'resize-width': 'width', 'resize-height': 'height', rotate: 'rotate',
    };
    const directNumber = value => {
      const number = parseFloat(value || '0');
      return Number.isFinite(number) ? number : 0;
    };
    const directPixels = value => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized.endsWith('px')) return null;
      const number = Number(normalized.slice(0, -2));
      return Number.isFinite(number) ? number : null;
    };
    const directGestureLabel = (drag, value) => {
      if (!drag) return '';
      if (drag.kind === 'position' && drag.styles?.length) {
        const shortName = { top: 'T', right: 'R', bottom: 'B', left: 'L' };
        return drag.styles
          .map(style => shortName[style.property] + ' ' + Math.round(style.value * 100) / 100)
          .join(' · ');
      }
      if (!Number.isFinite(value)) return '';
      const rounded = Math.round(value * 100) / 100;
      if (drag.kind === 'border-radius') return 'Radius ' + rounded + ' px';
      if (drag.kind === 'resize-width') return 'Width ' + rounded + ' px';
      if (drag.kind === 'resize-height') return 'Height ' + rounded + ' px';
      if (drag.kind === 'rotate') return 'Rotation ' + rounded + '°';
      if (drag.kind === 'border-width') return 'Border ' + rounded + ' px';
      if (drag.kind === 'gap') return 'Gap ' + rounded + ' px';
      if (drag.kind.startsWith('padding-')) return 'Padding ' + rounded + ' px';
      return rounded + ' px';
    };
    const axisAlignedGeometry = element => {
      for (let node = element; node instanceof Element; node = node.parentElement) {
        const transform = getComputedStyle(node).transform;
        if (!transform || transform === 'none') continue;
        if (transform.startsWith('matrix(')) {
          const values = transform.slice(7, -1).split(',').map(Number);
          if (values.length !== 6 || values.some(value => !Number.isFinite(value))) return false;
          if (Math.abs(values[1]) > .0001 || Math.abs(values[2]) > .0001) return false;
          continue;
        }
        if (transform.startsWith('matrix3d(')) {
          const values = transform.slice(9, -1).split(',').map(Number);
          const offAxis = [1,2,3,4,6,7,8,9,11];
          if (values.length !== 16 || values.some(value => !Number.isFinite(value)) || offAxis.some(index => Math.abs(values[index]) > .0001)) return false;
          continue;
        }
        return false;
      }
      return true;
    };
    const directScale = (element, rect) => {
      const layoutWidth = Number(element.offsetWidth);
      const layoutHeight = Number(element.offsetHeight);
      const x = layoutWidth > 0 ? rect.width / layoutWidth : 1;
      const y = layoutHeight > 0 ? rect.height / layoutHeight : 1;
      return {
        x: Number.isFinite(x) && x > .01 ? x : 1,
        y: Number.isFinite(y) && y > .01 ? y : 1,
      };
    };
    const placeSpacingRegion = (kind, left, top, width, height, supported = true) => {
      const region = directSpacingLayer?.querySelector('[data-spacing-kind="' + kind + '"]');
      if (!region) return;
      const visible = supported
        && [left, top, width, height].every(value => Number.isFinite(value))
        && width > .5
        && height > .5;
      region.hidden = !visible;
      if (!visible) return;
      region.style.left = left + 'px';
      region.style.top = top + 'px';
      region.style.width = width + 'px';
      region.style.height = height + 'px';
    };
    const renderSpacingGeometry = (rect, computed, scale, supported) => {
      if (!directSpacingLayer) return;
      if (!supported) {
        directSpacingLayer.querySelectorAll('[data-spacing-kind]').forEach(region => { region.hidden = true; });
        return;
      }
      const borderTop = (directPixels(computed.borderTopWidth) || 0) * scale.y;
      const borderRight = (directPixels(computed.borderRightWidth) || 0) * scale.x;
      const borderBottom = (directPixels(computed.borderBottomWidth) || 0) * scale.y;
      const borderLeft = (directPixels(computed.borderLeftWidth) || 0) * scale.x;
      const paddingTop = (directPixels(computed.paddingTop) || 0) * scale.y;
      const paddingRight = (directPixels(computed.paddingRight) || 0) * scale.x;
      const paddingBottom = (directPixels(computed.paddingBottom) || 0) * scale.y;
      const paddingLeft = (directPixels(computed.paddingLeft) || 0) * scale.x;
      const innerWidth = Math.max(0, rect.width - borderLeft - borderRight);
      const innerHeight = Math.max(0, rect.height - borderTop - borderBottom);
      placeSpacingRegion('padding-top', borderLeft, borderTop, innerWidth, paddingTop);
      placeSpacingRegion('padding-right', rect.width - borderRight - paddingRight, borderTop, paddingRight, innerHeight);
      placeSpacingRegion('padding-bottom', borderLeft, rect.height - borderBottom - paddingBottom, innerWidth, paddingBottom);
      placeSpacingRegion('padding-left', borderLeft, borderTop, paddingLeft, innerHeight);

      const marginTop = Math.max(0, directPixels(computed.marginTop) || 0) * scale.y;
      const marginRight = Math.max(0, directPixels(computed.marginRight) || 0) * scale.x;
      const marginBottom = Math.max(0, directPixels(computed.marginBottom) || 0) * scale.y;
      const marginLeft = Math.max(0, directPixels(computed.marginLeft) || 0) * scale.x;
      const parentDisplay = selected?.parentElement ? getComputedStyle(selected.parentElement).display : '';
      const verticalMarginSupported = parentDisplay.includes('flex')
        || parentDisplay.includes('grid')
        || computed.position === 'absolute'
        || computed.position === 'fixed'
        || computed.float !== 'none';
      placeSpacingRegion('margin-top', 0, -marginTop, rect.width, marginTop, verticalMarginSupported);
      placeSpacingRegion('margin-right', rect.width, 0, marginRight, rect.height);
      placeSpacingRegion('margin-bottom', 0, rect.height, rect.width, marginBottom, verticalMarginSupported);
      placeSpacingRegion('margin-left', -marginLeft, 0, marginLeft, rect.height);
    };
    const gapGeometry = (element, rect, computed, scale) => {
      if (!computed.display.includes('flex') && !computed.display.includes('grid')) return [];
      const items = Array.from(element.children).slice(0, 48).map((child, index) => {
        const childComputed = getComputedStyle(child);
        const childRect = child.getBoundingClientRect();
        if (
          childComputed.display === 'none'
          || childComputed.visibility === 'hidden'
          || childComputed.position === 'absolute'
          || childComputed.position === 'fixed'
          || childRect.width < .5
          || childRect.height < .5
          || ![childRect.left, childRect.top, childRect.right, childRect.bottom].every(value => Number.isFinite(value))
        ) return null;
        return { index, rect: childRect };
      }).filter(Boolean);
      if (items.length < 2) return [];

      const zones = [];
      const fingerprints = new Set();
      const appendNearest = (item, axis) => {
        const horizontal = axis === 'horizontal';
        const property = horizontal ? 'column-gap' : 'row-gap';
        const gap = directPixels(computed.getPropertyValue(property));
        const expected = gap === null ? null : gap * (horizontal ? scale.x : scale.y);
        // A zero/normal gap has no physical region to manipulate. It remains
        // available in the inspector instead of inventing geometry on-canvas.
        if (expected === null || expected < 3) return;
        let nearest = null;
        let nearestDistance = Infinity;
        let nearestOverlap = 0;
        items.forEach(candidate => {
          if (candidate === item) return;
          const distance = horizontal
            ? candidate.rect.left - item.rect.right
            : candidate.rect.top - item.rect.bottom;
          const overlap = horizontal
            ? Math.min(item.rect.bottom, candidate.rect.bottom) - Math.max(item.rect.top, candidate.rect.top)
            : Math.min(item.rect.right, candidate.rect.right) - Math.max(item.rect.left, candidate.rect.left);
          if (distance < -.5 || overlap < 3) return;
          if (distance < nearestDistance - .5 || (Math.abs(distance - nearestDistance) <= .5 && overlap > nearestOverlap)) {
            nearest = candidate;
            nearestDistance = distance;
            nearestOverlap = overlap;
          }
        });
        // Margins and distributed alignment can also create empty space. Only
        // expose the band when its measured size resolves to the computed gap.
        if (!nearest || Math.abs(nearestDistance - expected) > Math.max(1.5, expected * .1)) return;
        const left = horizontal ? item.rect.right : Math.max(item.rect.left, nearest.rect.left);
        const top = horizontal ? Math.max(item.rect.top, nearest.rect.top) : item.rect.bottom;
        const width = horizontal ? nearestDistance : nearestOverlap;
        const height = horizontal ? nearestOverlap : nearestDistance;
        const fingerprint = [
          property,
          Math.round(left),
          Math.round(top),
          Math.round(width),
          Math.round(height),
        ].join(':');
        if (fingerprints.has(fingerprint)) return;
        fingerprints.add(fingerprint);
        zones.push({
          property,
          axis,
          gap,
          left,
          top,
          width,
          height,
          key: property + ':' + Math.min(item.index, nearest.index)
            + ':' + Math.max(item.index, nearest.index),
        });
      };
      items.forEach(item => {
        appendNearest(item, 'horizontal');
        appendNearest(item, 'vertical');
      });
      return zones.slice(0, 64);
    };
    const paintGapHandle = (handle, zone, rect) => {
        const rawLeft = zone.left - rect.left;
        const rawTop = zone.top - rect.top;
        const left = Math.max(0, rawLeft);
        const top = Math.max(0, rawTop);
        const right = Math.min(rect.width, rawLeft + zone.width);
        const bottom = Math.min(rect.height, rawTop + zone.height);
        const visible = right - left >= 2 && bottom - top >= 2;
        handle.hidden = !visible;
        if (!visible) return false;
        handle.dataset.directKind = 'gap';
        handle.dataset.gapAxis = zone.axis;
        handle.dataset.gapProperty = zone.property;
        handle.dataset.gapKey = zone.key;
        handle.style.left = left + 'px';
        handle.style.top = top + 'px';
        handle.style.width = (right - left) + 'px';
        handle.style.height = (bottom - top) + 'px';
        const label = zone.property === 'column-gap' ? 'gap horizontal' : 'gap vertical';
        const readableValue = Math.round(zone.gap * 100) / 100;
        handle.setAttribute('aria-label', 'Ajustar ' + label + ', ' + readableValue + ' pixels');
        handle.title = label + ' · ' + readableValue + ' px';
        return true;
    };
    const createGapHandle = () => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = '__kodety-gap-control';
      return handle;
    };
    const renderGapGeometry = (rect, computed, scale, supported) => {
      if (!directGapLayer) return;
      const zones = supported ? gapGeometry(selected, rect, computed, scale) : [];
      if (directDrag?.kind === 'gap') {
        // Do not replace the captured pointer target during a gesture. Reuse
        // each stable child-pair handle and repaint its geometry after the
        // browser has laid out the new gap, so both the content and every pink
        // gap band visibly follow the pointer on the same animation frame.
        const existing = Array.from(
          directGapLayer.querySelectorAll('[data-direct-kind="gap"]'),
        );
        const byKey = new Map(existing.map(handle => [handle.dataset.gapKey, handle]));
        const used = new Set();
        zones.forEach(zone => {
          let handle = byKey.get(zone.key);
          if (!handle) {
            handle = createGapHandle();
            directGapLayer.appendChild(handle);
          }
          used.add(handle);
          paintGapHandle(handle, zone, rect);
        });
        existing.forEach(handle => {
          if (!used.has(handle)) handle.hidden = true;
        });
        return;
      }
      directGapLayer.replaceChildren();
      if (!supported) return;
      const fragment = document.createDocumentFragment();
      zones.forEach(zone => {
        const handle = createGapHandle();
        if (paintGapHandle(handle, zone, rect)) fragment.appendChild(handle);
      });
      directGapLayer.appendChild(fragment);
    };
    const setDirectPositionElement = element => {
      if (directPositionElement === element) return;
      directPositionElement?.removeAttribute('data-html-editor-position-draggable');
      directPositionElement = element || null;
      directPositionElement?.setAttribute('data-html-editor-position-draggable', '');
    };
    const clearDirectDetail = () => {
      directDetailSequence += 1;
      if (directDetailFrame) cancelAnimationFrame(directDetailFrame);
      if (directDetailIdle && cancelIdleCallback) cancelIdleCallback(directDetailIdle);
      if (directDetailTimer) clearTimeout(directDetailTimer);
      directDetailFrame = 0;
      directDetailIdle = 0;
      directDetailTimer = 0;
    };
    const renderDirectDetail = (element, rect, sequence) => {
      if (
        sequence !== directDetailSequence
        || selectionDetailSuspended
        || selected !== element
        || !element.isConnected
      ) return;
      const computed = getComputedStyle(element);
      setDirectPositionElement(
        computed.position === 'absolute' || computed.position === 'fixed' ? element : null,
      );
      const supported = axisAlignedGeometry(element);
      const scale = directScale(element, rect);
      directOverlay.querySelectorAll('.__kodety-direct-handle').forEach(handle => {
        handle.hidden = !supported && handle.dataset.directKind !== 'rotate';
      });
      if (directSpacingLayer) directSpacingLayer.hidden = false;
      if (directGapLayer) directGapLayer.hidden = false;
      renderSpacingGeometry(rect, computed, scale, supported);
      renderGapGeometry(rect, computed, scale, supported);
      const radius = directOverlay.querySelector('[data-direct-kind="border-radius"]');
      if (radius && supported) {
        const values = [computed.borderTopLeftRadius, computed.borderTopRightRadius, computed.borderBottomRightRadius, computed.borderBottomLeftRadius].map(directNumber);
        radius.hidden = Math.max(...values) < 1;
      }
    };
    const scheduleDirectDetail = (element, rect) => {
      clearDirectDetail();
      const sequence = directDetailSequence;
      if (selectionDetailSuspended) return;
      if (directDrag) {
        renderDirectDetail(element, rect, sequence);
        return;
      }
      // The border/size feedback paints first. Spacing, transformed-ancestor
      // inspection and child-gap measurement are optional detail and therefore
      // run only after that frame has been presented.
      directDetailFrame = requestAnimationFrame(() => {
        directDetailFrame = 0;
        const run = () => {
          directDetailIdle = 0;
          directDetailTimer = 0;
          renderDirectDetail(element, rect, sequence);
        };
        if (requestIdleCallback) {
          directDetailIdle = requestIdleCallback(run, { timeout: 120 });
        } else {
          directDetailTimer = setTimeout(run, 0);
        }
      });
    };
    const refreshDirectControls = () => {
      if (!directOverlay) return;
      cancelAnimationFrame(directFrame);
      clearDirectDetail();
      if (selectionDetailSuspended) {
        setDirectPositionElement(null);
        directOverlay.hidden = true;
        return;
      }
      directFrame = requestAnimationFrame(() => {
        if (!selected || !selected.isConnected || directDrag?.kind === 'move') {
          setDirectPositionElement(null);
          directOverlay.hidden = !directDrag;
          return;
        }
        const rect = selected.getBoundingClientRect();
        directOverlay.hidden = rect.width < 2 || rect.height < 2;
        directOverlay.style.left = rect.left + 'px';
        directOverlay.style.top = rect.top + 'px';
        directOverlay.style.width = rect.width + 'px';
        directOverlay.style.height = rect.height + 'px';
        if (directSizeLabel) {
          directSizeLabel.dataset.feedbackKind = directDrag?.kind || 'size';
          const gestureValue = directDrag?.value ?? directDrag?.startValue;
          if (directDrag && directDrag.kind !== 'move' && Number.isFinite(gestureValue)) {
            directSizeLabel.textContent = directGestureLabel(directDrag, gestureValue);
          } else {
            directSizeLabel.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height) + ' px';
          }
        }
        if (directOverlayBadge) {
          const overlayLinked = [
            'data-kodety-overlay-target',
            'data-kodety-overlay-toggle',
            'data-kodety-overlay-open',
            'data-kodety-overlay-trigger',
          ].some(attribute => selected.hasAttribute(attribute) && selected.getAttribute(attribute));
          const checkoutLinked = selected.hasAttribute('data-kodefy-checkout');
          directOverlayBadge.hidden = !overlayLinked && !checkoutLinked;
          directOverlayBadge.textContent = checkoutLinked ? 'Checkout overlay' : 'Overlay';
        }
        if (directSpacingLayer) directSpacingLayer.hidden = true;
        if (directGapLayer) directGapLayer.hidden = true;
        scheduleDirectDetail(selected, rect);
      });
    };
    const directChromeTokens = [
      ['--kodety-direct-outline-hover', 1],
      ['--kodety-direct-hover-outline-offset', 1],
      ['--kodety-direct-outline-selected', 1],
      ['--kodety-direct-outline-offset', 0],
      ['--kodety-direct-overlay-border', 1],
      ['--kodety-direct-gap-marker-long', 10],
      ['--kodety-direct-gap-marker-short', 2],
      ['--kodety-direct-gap-outline', 1],
      ['--kodety-direct-gap-radius', 2],
      ['--kodety-direct-handle-size', 8],
      ['--kodety-direct-handle-border', 1],
      ['--kodety-direct-handle-hit-inset', -6],
      ['--kodety-direct-handle-outline', 1],
      ['--kodety-direct-handle-outline-offset', 1],
      ['--kodety-direct-padding-inset', 9],
      ['--kodety-direct-padding-long', 20],
      ['--kodety-direct-padding-short', 2],
      ['--kodety-direct-corner-size', 8],
      ['--kodety-direct-corner-border', 1],
      ['--kodety-direct-corner-radius', 999],
      ['--kodety-direct-edge-hit-size', 8],
      ['--kodety-direct-edge-hit-offset', -4],
      ['--kodety-direct-radius-offset', 9],
      ['--kodety-direct-rotate-size', 20],
      ['--kodety-direct-label-offset', -9],
      ['--kodety-direct-size-label-offset', -9],
      ['--kodety-direct-size-label-min-width', 40],
      ['--kodety-direct-size-label-height', 20],
      ['--kodety-direct-size-label-pad-x', 6],
      ['--kodety-direct-size-label-radius', 4],
      ['--kodety-direct-size-label-font', 10],
    ];
    const applyDirectViewScale = rawScale => {
      const nextScale = Number(rawScale);
      if (!Number.isFinite(nextScale)) return;
      // Above 35% the chrome remains physically constant. Below that point it
      // may shrink with the page instead of creating enormous inverse-scaled
      // controls inside a tiny iframe.
      directViewScale = Math.max(.02, Math.min(2.4, nextScale));
      const chromeScale = 1 / Math.max(.35, directViewScale);
      const rootStyle = document.documentElement.style;
      directChromeTokens.forEach(([property, value]) => {
        rootStyle.setProperty(
          property,
          Math.round(value * chromeScale * 100) / 100 + 'px',
        );
      });
      refreshDirectControls();
    };
    const releaseDirectCommitPreview = (gestureId, canonical = true) => {
      const drag = pendingDirectCommit;
      if (!drag || (gestureId && drag.gestureId !== gestureId)) return;
      pendingDirectCommit = null;
      if (!drag.element?.isConnected || !drag.inlineBefore) return;
      if (!canonical) {
        restoreDirectPreview(drag);
        refreshDirectControls();
        return;
      }
      // The ACK has installed the canonical stylesheet before it releases this
      // preview. Remove the temporary inline priority now so it cannot shadow
      // later breakpoint/state edits or be mistaken for authored source.
      restoreDirectPreview(drag);
      refreshDirectControls();
    };
    const clearMovePreview = () => {
      document.querySelectorAll('[data-html-editor-insert-drop]').forEach(el => el.removeAttribute('data-html-editor-insert-drop'));
    };
    const moveTargetFromPoint = (x, y) => {
      if (!selected) return null;
      directOverlay.style.pointerEvents = 'none';
      const node = document.elementFromPoint(x, y);
      directOverlay.style.pointerEvents = '';
      let target = node?.closest?.('[data-html-editor-path]') || null;
      if (!target || target === selected || selected.contains(target) || target.closest('[data-html-editor-locked]')) return null;
      const rect = target.getBoundingClientRect();
      const ratio = (y - rect.top) / Math.max(1, rect.height);
      const tag = target.tagName.toLowerCase();
      const canContain = canContainTags.has(tag);
      const position = ratio < .28 && tag !== 'body' ? 'before' : ratio > .72 && tag !== 'body' ? 'after' : canContain ? 'inside' : 'after';
      return { target, position };
    };
    const previewDirectMove = (x, y) => {
      clearMovePreview();
      const destination = moveTargetFromPoint(x, y);
      if (destination) destination.target.setAttribute('data-html-editor-insert-drop', destination.position);
      directDrag.destination = destination;
    };
    const positionedDragEntries = (element, computed, rect) => {
      const entries = [];
      const appendAxis = (leading, trailing, axis, fallback) => {
        const leadingValue = directPixels(computed.getPropertyValue(leading));
        const trailingValue = directPixels(computed.getPropertyValue(trailing));
        if (leadingValue !== null) entries.push({
          property: leading,
          axis,
          direction: 1,
          startValue: leadingValue,
        });
        if (trailingValue !== null) entries.push({
          property: trailing,
          axis,
          direction: -1,
          startValue: trailingValue,
        });
        if (leadingValue === null && trailingValue === null) entries.push({
          property: leading,
          axis,
          direction: 1,
          startValue: fallback,
        });
      };
      const offsetLeft = Number(element.offsetLeft);
      const offsetTop = Number(element.offsetTop);
      const useViewportFallback = computed.position === 'fixed' || !element.offsetParent;
      appendAxis(
        'left',
        'right',
        'x',
        useViewportFallback || !Number.isFinite(offsetLeft) ? rect.left : offsetLeft,
      );
      appendAxis(
        'top',
        'bottom',
        'y',
        useViewportFallback || !Number.isFinite(offsetTop) ? rect.top : offsetTop,
      );
      return entries;
    };
    const startDirectDrag = (event) => {
      const handle = event.target.closest?.('[data-direct-kind]');
      if (!handle || event.button !== 0 || !selected || selected.closest('[data-html-editor-locked]')) return;
      event.preventDefault(); event.stopPropagation();
      const kind = handle.dataset.directKind;
      const computed = getComputedStyle(selected);
      const sideProperty = kind === 'gap' ? handle.dataset.gapProperty : directProperty[kind];
      if (!sideProperty) return;
      const pairedPadding = kind.startsWith('padding-') && !(event.altKey || event.ctrlKey);
      const verticalPadding = kind === 'padding-top' || kind === 'padding-bottom';
      const property = kind === 'gap'
        ? sideProperty
        : pairedPadding
          ? (verticalPadding ? 'padding-block' : 'padding-inline')
          : sideProperty;
      const startValue = kind === 'rotate'
        ? (() => {
          const value = computed.getPropertyValue('rotate').trim();
          if (!value || value === 'none') return 0;
          const match = value.match(/(-?(?:\\d+|\\d*\\.\\d+))deg/);
          return match ? Number(match[1]) : 0;
        })()
        : directPixels(computed.getPropertyValue(sideProperty));
      if (startValue === null) return;
      const rect = selected.getBoundingClientRect();
      const scale = directScale(selected, rect);
      const previewProperties = pairedPadding
        ? verticalPadding
          ? ['padding-top', 'padding-bottom']
          : ['padding-left', 'padding-right']
        : [property];
      if (kind === 'border-width') previewProperties.push('border-style');
      const inlineBefore = Object.fromEntries(previewProperties.map(name => [name, {
        value: selected.style.getPropertyValue(name),
        priority: selected.style.getPropertyPriority(name),
      }]));
      directDrag = {
        kind, property, sideProperty, pairedPadding, verticalPadding,
        gestureId: 'direct:' + (++directGestureSequence),
        breakpointId: canvasViewBreakpointId || 'base',
        startX: event.clientX, startY: event.clientY,
        startValue, scaleX: scale.x, scaleY: scale.y, inlineBefore,
        path: selected.dataset.htmlEditorPath, element: selected, destination: null,
        verticalGap: kind === 'gap' && handle.dataset.gapAxis === 'vertical',
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        startPointerAngle: kind === 'rotate'
          ? Math.atan2(
            event.clientY - (rect.top + rect.height / 2),
            event.clientX - (rect.left + rect.width / 2),
          ) * 180 / Math.PI
          : 0,
      };
      document.documentElement.setAttribute('data-kodety-direct-dragging', '');
      if (kind.startsWith('padding-')) directOverlay.dataset.spacingPreview = kind;
      handle.setPointerCapture?.(event.pointerId);
      refreshDirectControls();
    };
    const queueDirectMove = (event) => {
      if (canvasTool !== 'select' || directDrag || event.button !== 0 || !selected || selected.closest('[data-html-editor-locked]')) return;
      if (event.target.closest?.('[data-html-editor-editing]')) return;
      if (event.target.closest?.('[data-direct-kind]')) return;
      const element = event.target.closest?.('[data-html-editor-path]');
      if (element !== selected) return;
      pendingDirectMove = {
        startX: event.clientX, startY: event.clientY,
        pointerId: event.pointerId, path: selected.dataset.htmlEditorPath,
        breakpointId: canvasViewBreakpointId || 'base',
      };
    };
    const updateDirectDrag = (event) => {
      if (!directDrag && pendingDirectMove) {
        const moveX = event.clientX - pendingDirectMove.startX;
        const moveY = event.clientY - pendingDirectMove.startY;
        if (Math.hypot(moveX, moveY) < 4) return;
        const computed = getComputedStyle(selected);
        if (computed.position === 'absolute' || computed.position === 'fixed') {
          const rect = selected.getBoundingClientRect();
          const scale = directScale(selected, rect);
          const entries = positionedDragEntries(selected, computed, rect);
          const inlineBefore = Object.fromEntries(entries.map(entry => [entry.property, {
            value: selected.style.getPropertyValue(entry.property),
            priority: selected.style.getPropertyPriority(entry.property),
          }]));
          directDrag = {
            kind: 'position', property: null,
            gestureId: 'direct:' + (++directGestureSequence),
            breakpointId: pendingDirectMove.breakpointId,
            startX: pendingDirectMove.startX, startY: pendingDirectMove.startY,
            startValue: 0, scaleX: scale.x, scaleY: scale.y,
            path: pendingDirectMove.path, element: selected,
            entries,
            styles: entries.map(entry => ({
              property: entry.property,
              value: entry.startValue,
              startValue: entry.startValue,
            })),
            inlineBefore,
          };
        } else {
          directDrag = {
            kind: 'move', property: null,
            breakpointId: pendingDirectMove.breakpointId,
            startX: pendingDirectMove.startX, startY: pendingDirectMove.startY,
            startValue: 0, path: pendingDirectMove.path, destination: null,
          };
        }
        pendingDirectMove = null;
        suppressDirectClick = true;
        document.documentElement.setAttribute('data-kodety-direct-dragging', '');
        selected.setPointerCapture?.(event.pointerId);
      }
      if (!directDrag || !selected) return;
      event.preventDefault(); event.stopPropagation();
      if (directDrag.kind === 'move') {
        directOverlay.hidden = true;
        previewDirectMove(event.clientX, event.clientY);
        return;
      }
      const dx = event.clientX - directDrag.startX;
      const dy = event.clientY - directDrag.startY;
      const scaledX = dx / Math.max(.01, directDrag.scaleX || 1);
      const scaledY = dy / Math.max(.01, directDrag.scaleY || 1);
      if (directDrag.kind === 'position') {
        let positionX = scaledX;
        let positionY = scaledY;
        if (event.shiftKey) {
          if (Math.abs(positionX) >= Math.abs(positionY)) positionY = 0;
          else positionX = 0;
        }
        const liveValues = {};
        directDrag.styles = directDrag.entries.map(entry => {
          const delta = entry.axis === 'x' ? positionX : positionY;
          const value = Math.max(
            -100000,
            Math.min(100000, Math.round((entry.startValue + delta * entry.direction) * 10) / 10),
          );
          selected.style.setProperty(entry.property, value + 'px', 'important');
          liveValues[entry.property] = value + 'px';
          return {
            property: entry.property,
            value,
            startValue: entry.startValue,
          };
        });
        directDrag.value = Math.round(Math.hypot(positionX, positionY) * 10) / 10;
        cancelAnimationFrame(directSyncFrame);
        directSyncFrame = requestAnimationFrame(() => postEditorMessage({
          type: 'html-editor-direct-style-preview',
          breakpointId: directDrag?.breakpointId || 'base',
          path: directDrag?.path || selected?.dataset.htmlEditorPath,
          values: liveValues,
        }));
        refreshDirectControls();
        return;
      }
      if (directDrag.kind === 'rotate') {
        const pointerAngle = Math.atan2(
          event.clientY - directDrag.centerY,
          event.clientX - directDrag.centerX,
        ) * 180 / Math.PI;
        let value = directDrag.startValue + pointerAngle - directDrag.startPointerAngle;
        if (event.shiftKey) value = Math.round(value / 15) * 15;
        else value = Math.round(value * 10) / 10;
        while (value > 180) value -= 360;
        while (value <= -180) value += 360;
        selected.style.setProperty('rotate', value + 'deg', 'important');
        directDrag.value = value;
        cancelAnimationFrame(directSyncFrame);
        directSyncFrame = requestAnimationFrame(() => postEditorMessage({
          type: 'html-editor-direct-style-preview',
          breakpointId: directDrag?.breakpointId || 'base',
          path: directDrag?.path || selected?.dataset.htmlEditorPath,
          values: { rotate: value + 'deg' },
        }));
        refreshDirectControls();
        return;
      }
      const delta = directDrag.kind === 'padding-top' ? scaledY
        : directDrag.kind === 'padding-bottom' ? -scaledY
        : directDrag.kind === 'padding-left' ? scaledX
        : directDrag.kind === 'padding-right' ? -scaledX
        : directDrag.kind === 'gap' ? (directDrag.verticalGap ? scaledY : scaledX)
        : directDrag.kind === 'resize-width' ? scaledX
        : directDrag.kind === 'resize-height' ? scaledY
        : Math.max(scaledX, scaledY);
      const resizing = directDrag.kind === 'resize-width' || directDrag.kind === 'resize-height';
      const maximum = directDrag.kind === 'border-width' ? 80 : resizing ? 10000 : 1000;
      const minimum = resizing ? 8 : 0;
      const increment = event.shiftKey && resizing ? 8 : 1;
      const value = Math.max(
        minimum,
        Math.min(maximum, Math.round((directDrag.startValue + delta) / increment) * increment),
      );
      if (directDrag.pairedPadding) {
        if (directDrag.verticalPadding) {
          selected.style.setProperty('padding-top', value + 'px', 'important');
          selected.style.setProperty('padding-bottom', value + 'px', 'important');
        } else {
          selected.style.setProperty('padding-left', value + 'px', 'important');
          selected.style.setProperty('padding-right', value + 'px', 'important');
        }
      } else selected.style.setProperty(directDrag.property, value + 'px', 'important');
      if (directDrag.kind === 'border-width' && getComputedStyle(selected).borderStyle === 'none') {
        selected.style.setProperty('border-style', 'solid', 'important');
      }
      directDrag.value = value;
      const liveValues = directDrag.pairedPadding
        ? directDrag.verticalPadding
          ? { 'padding-top': value + 'px', 'padding-bottom': value + 'px' }
          : { 'padding-left': value + 'px', 'padding-right': value + 'px' }
        : { [directDrag.property]: value + 'px' };
      if (directDrag.kind === 'border-width') liveValues['border-style'] = getComputedStyle(selected).borderStyle || 'solid';
      cancelAnimationFrame(directSyncFrame);
      directSyncFrame = requestAnimationFrame(() => postEditorMessage({
        type: 'html-editor-direct-style-preview',
        breakpointId: directDrag?.breakpointId || 'base',
        path: directDrag?.path || selected?.dataset.htmlEditorPath,
        values: liveValues,
      }));
      refreshDirectControls();
    };
    const restoreDirectPreview = drag => {
      if (!drag?.element || !drag.inlineBefore) return;
      Object.entries(drag.inlineBefore).forEach(([property, previous]) => {
        if (previous.value) drag.element.style.setProperty(property, previous.value, previous.priority);
        else drag.element.style.removeProperty(property);
      });
    };
    const finishDirectDrag = (event) => {
      if (!directDrag) { pendingDirectMove = null; return; }
      event?.preventDefault?.(); event?.stopPropagation?.();
      const drag = directDrag;
      directDrag = null;
      cancelAnimationFrame(directSyncFrame);
      directSyncFrame = 0;
      pendingDirectMove = null;
      document.documentElement.removeAttribute('data-kodety-direct-dragging');
      directOverlay.removeAttribute('data-spacing-preview');
      if (drag.kind === 'move') {
        clearMovePreview();
        directOverlay.hidden = false;
        if (drag.destination) postEditorMessage({
          type: 'html-editor-move-element', sourcePath: drag.path,
          targetPath: drag.destination.target.dataset.htmlEditorPath,
          position: drag.destination.position,
        });
      } else if (drag.kind === 'position' && drag.styles?.length) {
        // Keep both axes, plus opposing anchors when authored, in a single
        // undoable mutation so stretched absolute/fixed layers retain size.
        pendingDirectCommit = drag;
        postEditorMessage({
          type: 'html-editor-direct-style-batch',
          breakpointId: drag.breakpointId || 'base',
          path: drag.path,
          gestureId: drag.gestureId,
          styles: drag.styles.map(style => ({
            property: style.property,
            sourceProperty: style.property,
            value: style.value + 'px',
            startPx: style.startValue,
            valuePx: style.value,
          })),
        });
      } else if (Number.isFinite(drag.value)) {
        // Keep the final visual sample in place until the parent has applied
        // the canonical inline/rule mutation. Clearing it here caused a visible
        // snap-back that lasted until the iframe was rebuilt.
        pendingDirectCommit = drag;
        postEditorMessage({
          type: 'html-editor-direct-style',
          breakpointId: drag.breakpointId || 'base',
          path: drag.path,
          property: drag.property, sourceProperty: drag.sideProperty,
          value: drag.value + (drag.kind === 'rotate' ? 'deg' : 'px'),
          ensureBorder: drag.kind === 'border-width',
          gestureId: drag.gestureId,
          ...(drag.kind === 'rotate'
            ? {}
            : { startPx: drag.startValue, valuePx: drag.value }),
        });
      }
      refreshDirectControls();
    };
    if (directOverlay) {
      directOverlay.id = '__kodety-direct-overlay';
      directOverlay.hidden = true;
      directSpacingLayer = document.createElement('div');
      directSpacingLayer.className = '__kodety-direct-layer';
      [
        'padding-top','padding-right','padding-bottom','padding-left',
        'margin-top','margin-right','margin-bottom','margin-left',
      ].forEach(kind => {
        const region = document.createElement('span');
        region.className = '__kodety-spacing-region';
        region.dataset.spacingKind = kind;
        region.hidden = true;
        directSpacingLayer.appendChild(region);
      });
      directOverlay.appendChild(directSpacingLayer);
      directGapLayer = document.createElement('div');
      directGapLayer.className = '__kodety-direct-layer';
      directOverlay.appendChild(directGapLayer);
      directHandleKinds.forEach(kind => {
        const handle = document.createElement('button');
        handle.type = 'button'; handle.className = '__kodety-direct-handle';
        handle.dataset.directKind = kind;
        handle.setAttribute('aria-label', kind === 'move' ? 'Mover layer' : 'Ajustar ' + kind);
        directOverlay.appendChild(handle);
      });
      ['top-left','top-right','bottom-right','bottom-left'].forEach(corner => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = '__kodety-direct-handle';
        handle.dataset.directKind = 'rotate';
        handle.dataset.rotateCorner = corner;
        handle.setAttribute('aria-label', 'Girar layer');
        directOverlay.appendChild(handle);
      });
      ['top-left','top-right','bottom-right','bottom-left'].forEach(corner => {
        const handle = document.createElement('span');
        handle.className = '__kodety-direct-corner';
        handle.dataset.corner = corner;
        directOverlay.appendChild(handle);
      });
      directSizeLabel = document.createElement('span');
      directSizeLabel.id = '__kodety-direct-size-label';
      directOverlay.appendChild(directSizeLabel);
      directOverlayBadge = document.createElement('span');
      directOverlayBadge.id = '__kodety-overlay-link-badge';
      directOverlayBadge.hidden = true;
      directOverlay.appendChild(directOverlayBadge);
      document.body.appendChild(directOverlay);
      directOverlay.addEventListener('pointerdown', startDirectDrag, true);
      const showDirectFeedback = handle => {
        if (!handle || !selected || directDrag) return;
        const kind = handle.dataset.directKind;
        if (kind.startsWith('padding-')) directOverlay.dataset.spacingPreview = kind;
      };
      const clearDirectFeedback = () => {
        if (directDrag) return;
        directOverlay.removeAttribute('data-spacing-preview');
      };
      directOverlay.addEventListener('pointerover', event => showDirectFeedback(event.target.closest?.('[data-direct-kind]')), true);
      directOverlay.addEventListener('pointerout', clearDirectFeedback, true);
      directOverlay.addEventListener('focusin', event => showDirectFeedback(event.target.closest?.('[data-direct-kind]')), true);
      directOverlay.addEventListener('focusout', clearDirectFeedback, true);
      registerEditorMessageListener(event => {
        if (!isCurrentEditorMessage(event)) return;
        if (event.data?.type === 'html-editor-canvas-view-scale') {
          applyDirectViewScale(event.data.scale);
          return;
        }
        if (event.data?.type === 'html-editor-direct-style-release') {
          releaseDirectCommitPreview(event.data.gestureId);
        }
      });
      document.addEventListener('pointerdown', queueDirectMove, true);
      document.addEventListener('pointermove', updateDirectDrag, true);
      document.addEventListener('pointerup', finishDirectDrag, true);
      document.addEventListener('pointercancel', finishDirectDrag, true);
      document.addEventListener('dragstart', event => {
        if (pendingDirectMove || directDrag?.kind === 'move') event.preventDefault();
      }, true);
      document.addEventListener('click', event => {
        if (!suppressDirectClick) return;
        suppressDirectClick = false;
        event.preventDefault(); event.stopImmediatePropagation();
      }, true);
      document.addEventListener('pointerover', event => {
        const hoveringSelection = event.target instanceof Node && (
          selected?.contains?.(event.target) || directOverlay.contains(event.target)
        );
        if (!directDrag && hoveringSelection) {
          directOverlay.setAttribute('data-selected-hover', '');
          directOverlay.setAttribute('data-show-margins', '');
        }
      }, true);
      document.addEventListener('pointerout', event => {
        const remainsOverSelection = event.relatedTarget instanceof Node && (
          selected?.contains?.(event.relatedTarget) || directOverlay.contains(event.relatedTarget)
        );
        if (!remainsOverSelection) {
          directOverlay.removeAttribute('data-selected-hover');
          directOverlay.removeAttribute('data-show-margins');
        }
      }, true);
      addEventListener('resize', refreshDirectControls);
      document.addEventListener('scroll', refreshDirectControls, true);
      refreshDirectControls();
    }
    // elementsFromPoint() deliberately omits pointer-events:none boxes. Keep
    // an editor-only rule in this iframe bridge's own runtime scope for one
    // synchronous inclusive point query. This style is created at runtime, so
    // toggling its non-reflected disabled property cannot trigger the canvas
    // MutationObserver or leak into a rebuilt srcdoc.
    const authoredPointHitTestStyle = inspectionEnabled
      ? (() => {
          const style = document.createElement('style');
          style.textContent = '[data-html-editor-path] { pointer-events: auto !important; }';
          document.head.appendChild(style);
          // The disabled setter is effective only after a CSSStyleSheet is
          // associated with the element.
          style.disabled = true;
          return style;
        })()
      : null;
    // Framer frequently puts pointer-events:none on text wrappers while the
    // clickable component lives on an ancestor. event.target then points to
    // the ancestor even though the user clicked directly over an editable <p>
    // or <span>. Resolve the visually deepest authored box at that coordinate
    // so every source text layer remains selectable without changing its CSS.
    const selectableFromEvent = (event, preferText = false) => {
      const direct = event.target?.closest?.('[data-html-editor-path]');
      const paintedOverlayRoot = event.target?.closest?.('[data-kodety-overlay]') || null;
      const candidates = new Set();
      const addAuthoredAncestors = node => {
        let current = node instanceof Element ? node : node?.parentElement;
        while (current) {
          if (current.hasAttribute('data-html-editor-path')) candidates.add(current);
          current = current.parentElement;
        }
      };
      addAuthoredAncestors(event.target);

      // The browser already owns the exact paint-order hit test. Reuse that
      // bounded stack and its authored ancestors instead of forcing layout for
      // every layer in the document on each click. elementsFromPoint also
      // preserves overlapping responsive variants and sibling overlays.
      let completePointStack = false;
      try {
        if (typeof document.elementsFromPoint === 'function') {
          const pointStack = document.elementsFromPoint(
            event.clientX,
            event.clientY,
          );
          pointStack.forEach(addAuthoredAncestors);
          completePointStack = true;
        } else {
          addAuthoredAncestors(document.elementFromPoint(event.clientX, event.clientY));
        }
      } catch {
        // A legacy WebView can reject point queries while its document moves.
      }

      // caretPositionFromPoint/caretRangeFromPoint can see rendered text even
      // when an imported wrapper uses pointer-events:none. This keeps Framer
      // text selectable without scanning every authored box for its rect.
      let caretPointAvailable = false;
      let caretNode = null;
      try {
        if (typeof document.caretPositionFromPoint === 'function') {
          caretPointAvailable = true;
          caretNode = document.caretPositionFromPoint(
            event.clientX,
            event.clientY,
          )?.offsetNode || null;
        } else if (typeof document.caretRangeFromPoint === 'function') {
          caretPointAvailable = true;
          caretNode = document.caretRangeFromPoint(
            event.clientX,
            event.clientY,
          )?.startContainer || null;
        }
      } catch {
        // Fall through to the compatibility scan below.
      }
      addAuthoredAncestors(caretNode);

      const authoredTextCandidate = candidate => {
        const tag = candidate.tagName.toLowerCase();
        return (candidate.hasAttribute('data-html-editor-leaf')
          || candidate.hasAttribute('data-html-editor-rich-text'))
          && !nonTextTags.has(tag)
          && Boolean((candidate.textContent || '').trim());
      };
      // Toggling this rule invalidates pointer-event hit testing across the
      // authored canvas. A normal point/caret stack that already contains a
      // selectable text layer has the same winner (text receives the dominant
      // score below), so a second global-rule query would only add work. Keep
      // the inclusive query for non-text coordinates, where it is required to
      // recover pointer-events:none images, SVG and decorative wrappers. A
      // direct authored leaf is already the exact browser hit; only an absent
      // direct hit or an authored ancestor can be hiding a transparent child.
      const directMayHideAuthoredDescendant = !direct
        || Boolean(direct.querySelector('[data-html-editor-path]'));
      const needsInclusivePointHitTest = Boolean(authoredPointHitTestStyle)
        && completePointStack
        && directMayHideAuthoredDescendant
        && !Array.from(candidates).some(authoredTextCandidate);
      if (needsInclusivePointHitTest) {
        try {
          authoredPointHitTestStyle.disabled = false;
          document.elementsFromPoint(event.clientX, event.clientY)
            .forEach(addAuthoredAncestors);
        } catch {
          // Keep candidates from the normal stack if the document moved.
        } finally {
          authoredPointHitTestStyle.disabled = true;
        }
      }
      // Keep the former full-document algorithm only for old/partial DOM
      // implementations that cannot expose the painted stack or caret text.
      // Modern Chromium stays on the bounded path above even on huge pages.
      const needsLegacyGlobalHitTest = !completePointStack
        || (!caretPointAvailable
          && !Array.from(candidates).some(authoredTextCandidate));
      if (needsLegacyGlobalHitTest) {
        // Recreate the former document-order candidate list exactly so tie
        // behavior also remains stable in the compatibility path.
        candidates.clear();
        document.querySelectorAll('[data-html-editor-path]')
          .forEach(candidate => candidates.add(candidate));
      }
      let best = direct || null;
      let bestScore = -Infinity;
      candidates.forEach(candidate => {
        if (candidate.closest('[data-html-editor-locked]')) return;
        // Once an overlay is painted in the top layer, coordinates can also
        // intersect deep text leaves from the page underneath. Keep hit
        // testing inside the actually clicked overlay tree so selecting its
        // content cannot immediately deselect and hide that same surface.
        if (paintedOverlayRoot && candidate.closest('[data-kodety-overlay]') !== paintedOverlayRoot) return;
        const rect = candidate.getBoundingClientRect();
        if (rect.width < .5 || rect.height < .5 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
        const computed = getComputedStyle(candidate);
        if (computed.display === 'none' || computed.visibility === 'hidden') return;
        const depth = String(candidate.dataset.htmlEditorPath || '').split('/').filter(Boolean).length;
        const isText = authoredTextCandidate(candidate);
        // A real text leaf wins over an overlapping variant/container even on
        // the first click. Double-click raises that preference further so it
        // enters editing instead of stopping at a decorative wrapper.
        const textBonus = isText ? (preferText ? 2000000000 : 1000000000) : 0;
        const score = textBonus + depth * 1000000 - Math.min(rect.width * rect.height, 999999);
        if (score > bestScore) { best = candidate; bestScore = score; }
      });
      return best;
    };
    document.addEventListener('contextmenu', event => {
      if (!inspectionEnabled) return;
      // The editor owns right-click while inspecting. Prevent Chrome's page
      // menu inside srcdoc and ask the parent shell to show element actions at
      // the equivalent screen position instead.
      event.preventDefault();
      event.stopImmediatePropagation();
      const el = selectableFromEvent(event);
      if (!el || el.closest('[data-html-editor-locked]')) return;
      selectElement(el, false);
      postEditorMessage({
        type: 'html-editor-context-menu',
        path: el.dataset.htmlEditorPath,
        x: event.clientX,
        y: event.clientY,
      });
    }, true);
    if (inspectionEnabled) {
      // Native form/media controls may open browser-owned popovers on
      // mousedown, before the editor's click-selection handler can cancel the
      // interaction. Besides being unexpected in Design mode, those popovers
      // are rendered outside the scaled canvas and therefore look enormous.
      // Keep the authored control selectable, but reserve interaction for
      // Preview where inspectionEnabled is false.
      const nativeControlSelector = 'input, textarea, select, video, audio';
      document.addEventListener('mousedown', event => {
        if (!event.target?.closest?.(nativeControlSelector)) return;
        event.preventDefault();
      }, true);
      document.addEventListener('keydown', event => {
        if (!event.target?.closest?.(nativeControlSelector)) return;
        if (!['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
      }, true);
      document.addEventListener('keydown', event => {
        const textEditingSelector = 'input, textarea, select, [data-html-editor-editing], [contenteditable]:not([contenteditable="false"])';
        const activeTextEditor = event.target?.closest?.(textEditingSelector)
          || document.activeElement?.closest?.(textEditingSelector);
        if (event.repeat || activeTextEditor) return;
        const modifier = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        let requestedTool = '';
        if (!modifier && !event.altKey) {
          if (!event.shiftKey && key === 'f') requestedTool = 'frame';
          else if (!event.shiftKey && key === 's') requestedTool = 'stack';
          else if (event.shiftKey && key === 'g') requestedTool = 'grid';
          else if (event.shiftKey && key === 'm') requestedTool = 'masonry';
          else if (event.shiftKey && key === 'i') requestedTool = 'image';
          else if (event.shiftKey && key === 'v') requestedTool = 'video';
          else if (!event.shiftKey && key === 't') requestedTool = 'text-block';
          else if (!event.shiftKey && key === 'v') requestedTool = 'select';
        }
        if (requestedTool) {
          event.preventDefault();
          event.stopImmediatePropagation();
          postEditorMessage({
            type: 'html-editor-canvas-tool-request',
            tool: requestedTool,
          });
          return;
        }
        let command = '';
        if (!modifier && (event.key === 'Delete' || event.key === 'Backspace')) {
          command = 'delete-selection';
        } else if (!modifier && event.key === 'ArrowUp') {
          command = event.shiftKey ? 'move-selection-first' : 'move-selection-up';
        } else if (!modifier && event.key === 'ArrowDown') {
          command = event.shiftKey ? 'move-selection-last' : 'move-selection-down';
        } else if (modifier && key === 'z' && !event.shiftKey) {
          command = 'undo';
        } else if (modifier && (key === 'y' || (key === 'z' && event.shiftKey))) {
          command = 'redo';
        } else if (modifier && event.shiftKey && key === 'c') {
          command = 'copy-selection-styles';
        } else if (modifier && event.shiftKey && key === 'v') {
          command = 'paste-selection-styles';
        } else if (modifier && key === 'c') {
          command = 'copy-selection';
        } else if (modifier && key === 'v') {
          // The paste event owns plain Cmd/Ctrl+V so it can inspect an SVG
          // payload before falling back to the internal layer clipboard.
          return;
        } else if (modifier && key === 'd') {
          command = 'duplicate-selection';
        } else if (modifier && key === 'k') {
          command = 'open-insert';
        }
        if (!command) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        postEditorMessage({ type: 'html-editor-command', command });
      }, true);
    }
    const canContainTags = new Set(['body','main','section','div','article','aside','nav','header','footer','form','ul','ol','li','picture','select','details','summary','blockquote','pre','button','a','label']);
    let insertDropElement = null;
    const clearInsertDrop = () => {
      if (!insertDropElement) return;
      insertDropElement.removeAttribute('data-html-editor-insert-drop');
      insertDropElement = null;
    };
    const insertionFromElement = (key, el, clientY) => {
      if (!key || !el || el.closest('[data-html-editor-locked]')) return null;
      const bounds = el.getBoundingClientRect();
      const ratio = (clientY - bounds.top) / Math.max(1, bounds.height);
      const tag = el.tagName.toLowerCase();
      const canContain = canContainTags.has(tag);
      const position = ratio < 0.22 && tag !== 'body' ? 'before' : ratio > 0.78 && tag !== 'body' ? 'after' : canContain ? 'inside' : 'after';
      return { key, el, position };
    };
    const insertionFromPoint = (key, x, y) => {
      const node = document.elementFromPoint(x, y);
      // Canvas chrome and selection overlays can be the topmost hit target. Fall
      // back to the authored body so drawing on visually empty canvas space is
      // just as reliable as drawing directly over an authored child.
      const el = node?.closest?.('[data-html-editor-path]')
        || (document.body?.matches?.('[data-html-editor-path]') ? document.body : null);
      return insertionFromElement(key, el, y);
    };
    const previewInsertDrop = (insertion) => {
      clearInsertDrop();
      if (!insertion) return false;
      insertDropElement = insertion.el;
      insertDropElement.setAttribute('data-html-editor-insert-drop', insertion.position);
      return true;
    };
    const commitInsertDrop = (insertion) => {
      clearInsertDrop();
      if (!insertion) return false;
      postEditorMessage({
        type: 'html-editor-insert-drop',
        key: insertion.key,
        targetPath: insertion.el.dataset.htmlEditorPath,
        position: insertion.position,
      });
      return true;
    };
    const drawOverlay = inspectionEnabled ? document.createElement('div') : null;
    const drawLabel = inspectionEnabled ? document.createElement('span') : null;
    const toolHint = inspectionEnabled ? document.createElement('span') : null;
    const canvasDrawTools = new Set(['frame', 'stack', 'grid', 'masonry', 'image', 'video', 'text-block']);
    const canvasToolLabels = {
      frame: 'Rectangle',
      stack: 'Stack',
      grid: 'Grid',
      masonry: 'Masonry',
      image: 'Image',
      video: 'Video',
      'text-block': 'Text',
    };
    let drawGesture = null;
    const paintDrawGesture = (event) => {
      if (!drawGesture || !drawOverlay || !drawLabel) return;
      let startX = drawGesture.startX;
      let startY = drawGesture.startY;
      let endX = Math.max(0, Math.min(innerWidth, event.clientX));
      let endY = Math.max(0, Math.min(innerHeight, event.clientY));
      if (event.shiftKey) {
        const distance = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
        endX = startX + (endX < startX ? -distance : distance);
        endY = startY + (endY < startY ? -distance : distance);
      }
      if (event.altKey) {
        const radiusX = Math.abs(endX - startX);
        const radiusY = Math.abs(endY - startY);
        startX -= radiusX;
        startY -= radiusY;
        endX = drawGesture.startX + radiusX;
        endY = drawGesture.startY + radiusY;
      }
      const rawWidth = Math.abs(endX - startX);
      const rawHeight = Math.abs(endY - startY);
      const bypassSnap = event.metaKey || event.ctrlKey;
      const snap = value => bypassSnap ? Math.round(value) : Math.round(value / 8) * 8;
      const width = Math.max(1, snap(rawWidth));
      const height = Math.max(1, snap(rawHeight));
      const left = Math.max(0, Math.min(startX, endX));
      const top = Math.max(0, Math.min(startY, endY));
      drawGesture.width = width;
      drawGesture.height = height;
      drawGesture.moved = Math.hypot(event.clientX - drawGesture.startX, event.clientY - drawGesture.startY) >= 4;
      drawOverlay.style.left = left + 'px';
      drawOverlay.style.top = top + 'px';
      drawOverlay.style.width = width + 'px';
      drawOverlay.style.height = height + 'px';
      drawLabel.textContent = width + ' × ' + height
        + (event.shiftKey ? ' · proporção 1:1' : '')
        + (event.altKey ? ' · do centro' : '');
    };
    const resetDrawGesture = () => {
      drawGesture = null;
      clearInsertDrop();
      drawOverlay?.removeAttribute('data-active');
    };
    const setCanvasTool = (tool) => {
      canvasTool = canvasDrawTools.has(tool) ? tool : 'select';
      pendingDirectMove = null;
      resetDrawGesture();
      if (canvasTool === 'select') {
        document.documentElement.removeAttribute('data-kodety-canvas-tool');
        refreshDirectControls();
      } else {
        document.documentElement.dataset.kodetyCanvasTool = canvasTool;
        if (directOverlay) directOverlay.hidden = true;
        if (toolHint) {
          toolHint.textContent = (canvasToolLabels[canvasTool] || 'Elemento')
            + ' · clique ou arraste para criar · Shift: proporção 1:1 · Alt: centro · Esc: cancelar';
        }
      }
    };
    if (drawOverlay && drawLabel && toolHint) {
      drawOverlay.id = '__kodety-draw-overlay';
      drawLabel.id = '__kodety-draw-label';
      drawOverlay.appendChild(drawLabel);
      toolHint.id = '__kodety-tool-hint';
      document.body.append(drawOverlay, toolHint);
      registerEditorMessageListener(event => {
        if (!isCurrentEditorMessage(event) || event.data?.type !== 'html-editor-canvas-tool') return;
        setCanvasTool(event.data.tool);
      });
      document.addEventListener('pointerdown', event => {
        if (canvasTool === 'select' || event.button !== 0) return;
        const insertion = insertionFromPoint(canvasTool, event.clientX, event.clientY);
        if (!insertion) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        pendingDirectMove = null;
        suppressDirectClick = true;
        drawGesture = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          width: 1,
          height: 1,
          moved: false,
          insertion,
          targetPath: insertion.el.dataset.htmlEditorPath,
          position: insertion.position,
          tool: canvasTool,
          // Capture on a stable editor-owned node. Authored targets can be
          // replaced by runtimes during the gesture, which used to silently
          // interrupt pointermove/pointerup and leave the tool feeling random.
          captureTarget: document.documentElement,
        };
        previewInsertDrop(insertion);
        drawOverlay.setAttribute('data-active', '');
        paintDrawGesture(event);
        try { drawGesture.captureTarget.setPointerCapture?.(event.pointerId); } catch {}
      }, true);
      document.addEventListener('pointermove', event => {
        if (!drawGesture || drawGesture.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        paintDrawGesture(event);
      }, true);
      const finishDrawGesture = (event, cancelled = false) => {
        if (!drawGesture || event?.pointerId !== undefined && drawGesture.pointerId !== event.pointerId) return;
        event?.preventDefault?.();
        event?.stopImmediatePropagation?.();
        const gesture = drawGesture;
        // Clear first: releasePointerCapture emits lostpointercapture and must
        // never be able to commit the same gesture twice.
        drawGesture = null;
        clearInsertDrop();
        drawOverlay?.removeAttribute('data-active');
        if (!cancelled) {
          const defaults = gesture.tool === 'text-block'
            ? { width: 200, height: 36 }
            : gesture.tool === 'image' || gesture.tool === 'video'
              ? { width: 320, height: 180 }
              : { width: 320, height: 240 };
          postEditorMessage({
            type: 'html-editor-draw-insert',
            key: gesture.tool,
            targetPath: gesture.targetPath,
            position: gesture.position,
            width: Math.max(8, gesture.moved ? gesture.width : defaults.width),
            height: Math.max(8, gesture.moved ? gesture.height : defaults.height),
          });
        }
        try { gesture.captureTarget?.releasePointerCapture?.(gesture.pointerId); } catch {}
        setCanvasTool('select');
      };
      document.addEventListener('pointerup', event => finishDrawGesture(event), true);
      document.addEventListener('pointercancel', event => finishDrawGesture(event, true), true);
      document.documentElement.addEventListener('lostpointercapture', event => {
        if (!drawGesture || drawGesture.pointerId !== event.pointerId) return;
        finishDrawGesture(event);
      }, true);
      addEventListener('blur', () => finishDrawGesture(undefined, true));
      document.addEventListener('keydown', event => {
        if (canvasTool === 'select' || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setCanvasTool('select');
        postEditorMessage({ type: 'html-editor-canvas-tool-cancel' });
      }, true);
    }
    const activateTabs = (root, nextIndex, focusTab = false) => {
      const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
      const panels = Array.from(root.querySelectorAll('[role="tabpanel"]'));
      if (!tabs.length) return;
      const index = Math.max(0, Math.min(nextIndex, tabs.length - 1));
      root.setAttribute('data-tabs-active', String(index));
      tabs.forEach((tab, tabIndex) => {
        const selected = tabIndex === index;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.setAttribute('tabindex', selected ? '0' : '-1');
        const panelId = tab.getAttribute('aria-controls');
        const panel = panelId ? root.querySelector('#' + CSS.escape(panelId)) : panels[tabIndex];
        if (panel) {
          if (selected) panel.removeAttribute('hidden');
          else panel.setAttribute('hidden', '');
        }
      });
      if (focusTab) tabs[index]?.focus?.();
    };
    document.querySelectorAll('[data-incode-component="tabs"]').forEach(root => {
      const active = Number(root.getAttribute('data-tabs-active') || '0');
      activateTabs(root, Number.isFinite(active) ? active : 0);
    });
    document.addEventListener('click', event => {
      const tab = event.target.closest?.('[data-incode-component="tabs"] [role="tab"]');
      if (!tab) return;
      const root = tab.closest('[data-incode-component="tabs"]');
      const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
      activateTabs(root, tabs.indexOf(tab), false);
      if (!inspectionEnabled) event.preventDefault();
    }, true);
    document.addEventListener('keydown', event => {
      const tab = event.target.closest?.('[data-incode-component="tabs"] [role="tab"]');
      if (!tab) return;
      const root = tab.closest('[data-incode-component="tabs"]');
      const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(tab);
      const vertical = root.getAttribute('data-tabs-orientation') === 'vertical';
      const keyMap = vertical
        ? { ArrowDown: 1, ArrowUp: -1 }
        : { ArrowRight: 1, ArrowLeft: -1 };
      let next = current;
      if (event.key in keyMap) next = (current + keyMap[event.key] + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key === 'Enter' || event.key === ' ') activateTabs(root, current, false);
      else return;
      event.preventDefault();
      if (next !== current) activateTabs(root, root.getAttribute('data-tabs-activation') === 'manual' ? current : next, true);
    }, true);
    const activateSlider = (root, nextIndex) => {
      const slides = Array.from(root.querySelectorAll(':scope > [data-slide]'));
      if (!slides.length) return;
      const index = (nextIndex + slides.length) % slides.length;
      root.setAttribute('data-slider-active', String(index));
      slides.forEach((slide, slideIndex) => {
        if (slideIndex === index) slide.removeAttribute('hidden');
        else slide.setAttribute('hidden', '');
      });
      const status = root.querySelector('[data-slider-status]');
      if (status) status.textContent = String(index + 1) + ' / ' + String(slides.length);
    };
    document.querySelectorAll('[data-incode-component="slider"]').forEach(root => activateSlider(root, Number(root.getAttribute('data-slider-active') || '0')));
    document.addEventListener('click', event => {
      const control = event.target.closest?.('[data-slider-prev], [data-slider-next]');
      if (!control) return;
      const root = control.closest('[data-incode-component="slider"]');
      if (!root) return;
      const active = Number(root.getAttribute('data-slider-active') || '0');
      activateSlider(root, active + (control.hasAttribute('data-slider-prev') ? -1 : 1));
      event.preventDefault();
      // Design owns the click so it does not select a child halfway through a
      // control gesture. Preview must still bubble to authored analytics,
      // animation and carousel listeners exactly like the published page.
      if (inspectionEnabled) event.stopPropagation();
    }, true);
    if (inspectionEnabled) {
      document.addEventListener('mouseover', event => {
        const el = event.target.closest('[data-html-editor-path]');
        if (el && !el.closest('[data-html-editor-locked]')) {
          el.setAttribute('data-html-editor-hover', '');
          refreshCanvasPropertyOwnershipMarkers();
        }
      }, true);
      document.addEventListener('mouseout', event => {
        event.target.closest?.('[data-html-editor-path]')?.removeAttribute('data-html-editor-hover');
        refreshCanvasPropertyOwnershipMarkers();
      }, true);
      ['focusin', 'focusout', 'pointerdown', 'pointerup'].forEach(type => {
        document.addEventListener(type, () => {
          queueMicrotask(refreshCanvasPropertyOwnershipMarkers);
        }, true);
      });
      const insertionFromEvent = (event) => {
        const key = event.dataTransfer?.getData('application/x-incode-insert') || event.dataTransfer?.getData('text/plain');
        if (!key) return null;
        const el = event.target.closest?.('[data-html-editor-path]');
        return insertionFromElement(key, el, event.clientY);
      };
      document.addEventListener('dragover', event => {
        const insertion = insertionFromEvent(event);
        if (!insertion) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        previewInsertDrop(insertion);
      }, true);
      document.addEventListener('dragleave', event => {
        if (!insertDropElement || event.relatedTarget && insertDropElement.contains(event.relatedTarget)) return;
        clearInsertDrop();
      }, true);
      document.addEventListener('drop', event => {
        const insertion = insertionFromEvent(event);
        if (!insertion) return;
        event.preventDefault();
        event.stopPropagation();
        commitInsertDrop(insertion);
      }, true);
    }
    document.addEventListener('click', event => {
      // Runtime Preview is a real website surface. It must never enter the
      // selection/direct-manipulation path below or cancel the site's own
      // carousel, accordion, form and interaction handlers.
      if (!inspectionEnabled) return;
      if (canvasTool !== 'select') return;
      if (event.target?.closest?.('[data-kodety-infinite-canvas-chrome]')) return;
      // Once an inline session is open, clicks belong to the native editing
      // selection/caret. Re-selecting the layer here used to throw the caret
      // back to the start and made replacing a selected word appear ignored.
      if (event.target?.closest?.('[data-html-editor-editing]')) {
        event.stopPropagation();
        return;
      }
      // React-rendered descendants are implementation details of one placed
      // Code Component. Always target its authored wrapper on a normal click.
      const codeComponent = event.target?.closest?.(
        '[data-coday-code-instance][data-html-editor-path]',
      );
      const el = codeComponent || selectableFromEvent(event);
      if (!el) return;
      if (el.closest('[data-html-editor-locked]')) { event.preventDefault(); event.stopPropagation(); return; }
      event.preventDefault(); event.stopPropagation();
      clearInlineTextRange();
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const soleCodeComponentSelection = Boolean(
        codeComponent
        && !additive
        && selected === codeComponent
        && document.querySelectorAll('[data-html-editor-selected]').length === 1,
      );
      if (!soleCodeComponentSelection) selectElement(el, additive);
    }, true);
    document.addEventListener('dblclick', event => {
      if (!inspectionEnabled) return;
      const codeComponent = event.target?.closest?.(
        '[data-coday-code-instance][data-html-editor-path]',
      );
      if (codeComponent && !codeComponent.closest('[data-html-editor-locked]')) {
        // This capture listener runs before the inline-text double-click path.
        // One placed Code Component is atomic, even when React rendered text or
        // controls below the pointer.
        event.preventDefault();
        event.stopImmediatePropagation();
        clearInlineTextRange();
        if (
          selected !== codeComponent
          || document.querySelectorAll('[data-html-editor-selected]').length !== 1
        ) selectElement(codeComponent, false);
        postEditorMessage({
          type: 'html-editor-edit-code-component',
          path: codeComponent.dataset.htmlEditorPath,
          instanceId: codeComponent.dataset.codayCodeInstance,
          componentId: codeComponent.dataset.codayCodeComponent,
          componentVersion: codeComponent.dataset.codayCodeVersion,
        });
        return;
      }
      const component = event.target?.closest?.(
        '[data-kodety-component-id][data-html-editor-path]',
      );
      if (!component || component.closest('[data-html-editor-locked]')) return;
      // A page instance is atomic. Open its master before the later inline-text
      // dblclick listener can turn one of its materialized descendants into a
      // local contenteditable copy.
      event.preventDefault();
      event.stopImmediatePropagation();
      clearInlineTextRange();
      selectElement(component, false);
      postEditorMessage({
        type: 'html-editor-edit-component',
        path: component.dataset.htmlEditorPath,
      });
    }, true);
    if (interactivePreview) {
      // Project links cannot navigate from about:srcdoc, so hand them to the
      // parent after authored handlers have run. A capture guard temporarily
      // gives eligible links an inert same-document href: if an authored
      // handler stops propagation without cancelling the default, srcdoc still
      // cannot resolve it against WordPress/admin. Modified clicks and named
      // targets ask the parent to open a user-activated context before any
      // asynchronous packaging. Downloads are materialized by the parent. Hashes,
      // special protocols and external origins remain native. composedPath
      // keeps open-Shadow-DOM anchors reachable.
      const pendingPreviewLinks = new WeakMap();
      let previewLinkRequestSequence = 0;
      const previewLinkRequestId = () => {
        let entropy = '';
        try {
          const values = new Uint32Array(4);
          crypto.getRandomValues(values);
          entropy = Array.from(values, value => value.toString(36)).join('');
        } catch {
          entropy = Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
        return 'preview-link-' + (++previewLinkRequestSequence) + '-' + entropy.slice(0, 64);
      };
      const previewLinkAnchor = event => {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        for (const node of path) {
          if (node instanceof Element && node.matches('a[href],area[href]')) return node;
        }
        const eventElement = event.target instanceof Element
          ? event.target
          : event.target?.parentElement;
        return eventElement?.closest?.('a[href],area[href]') || null;
      };
      const previewProjectLink = (event, anchor = previewLinkAnchor(event)) => {
        const primaryClick = event.type === 'click' && event.button === 0;
        const auxiliaryClick = event.type === 'auxclick' && event.button === 1;
        if (event.defaultPrevented || (!primaryClick && !auxiliaryClick)) return null;
        if (!anchor) return null;
        const href = (anchor.getAttribute('href') || '').trim();
        const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] || '';
        if (!href || href.startsWith('#') || (scheme && !/^https?$/i.test(scheme))) return null;
        if (scheme || href.startsWith('//')) {
          if (!previewSiteUrl) return null;
          try {
            const site = new URL(previewSiteUrl);
            const destination = new URL(href, site);
            if (!/^https?:$/i.test(destination.protocol) || destination.origin !== site.origin) return null;
          } catch { return null; }
        }
        return { anchor, href };
      };
      const previewLinkDisposition = (event, anchor) => {
        if (anchor.hasAttribute('download') || event.altKey) {
          return {
            disposition: 'download',
            download: (anchor.getAttribute('download') || '').trim(),
          };
        }
        const target = (anchor.getAttribute('target') || '').trim();
        if (
          event.type === 'auxclick'
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || (target && target.toLowerCase() !== '_self')
        ) {
          return { disposition: 'new-context' };
        }
        return { disposition: 'self' };
      };
      const maskPreviewLinkShield = pending => {
        const anchor = pending.anchor;
        const nativeGetAttribute = Element.prototype.getAttribute;
        const authoredAbsoluteHref = anchor.href;
        const authoredGetAttribute = anchor.getAttribute;
        const ownHref = Object.getOwnPropertyDescriptor(anchor, 'href');
        const ownGetAttribute = Object.getOwnPropertyDescriptor(anchor, 'getAttribute');
        let prototype = Object.getPrototypeOf(anchor);
        let hrefDescriptor = null;
        while (prototype && !hrefDescriptor) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'href');
          if (descriptor?.get && descriptor?.set) hrefDescriptor = descriptor;
          prototype = Object.getPrototypeOf(prototype);
        }
        let maskedGetAttribute = false;
        let maskedHref = false;
        try {
          Object.defineProperty(anchor, 'getAttribute', {
            configurable: true,
            writable: true,
            value(name) {
              const value = nativeGetAttribute.call(this, name);
              if (
                String(name).toLowerCase() === 'href'
                && value === pending.shield
              ) return pending.href;
              return authoredGetAttribute.call(this, name);
            },
          });
          maskedGetAttribute = true;
          if (hrefDescriptor) {
            Object.defineProperty(anchor, 'href', {
              configurable: true,
              get() {
                return nativeGetAttribute.call(this, 'href') === pending.shield
                  ? authoredAbsoluteHref
                  : hrefDescriptor.get.call(this);
              },
              set(value) { hrefDescriptor.set.call(this, value); },
            });
            maskedHref = true;
          }
        } catch {}
        return () => {
          if (maskedHref) {
            if (ownHref) Object.defineProperty(anchor, 'href', ownHref);
            else delete anchor.href;
          }
          if (maskedGetAttribute) {
            if (ownGetAttribute) Object.defineProperty(anchor, 'getAttribute', ownGetAttribute);
            else delete anchor.getAttribute;
          }
        };
      };
      const restorePreviewLink = pending => {
        if (Element.prototype.getAttribute.call(pending.anchor, 'href') === pending.shield) {
          Element.prototype.setAttribute.call(pending.anchor, 'href', pending.href);
        }
        pending.unmask?.();
        pending.unmask = null;
      };
      const finishPreviewLink = (event, pending, cancelDefault = false) => {
        if (pending.handled) return;
        pending.handled = true;
        restorePreviewLink(pending);
        if (event.defaultPrevented) return;
        // An authored handler may deliberately rewrite the destination. Use
        // the final internal href (or leave a now-external/hash link native)
        // rather than replaying the capture-time value.
        const link = previewProjectLink(event, pending.anchor);
        if (!link) return;
        const intent = previewLinkDisposition(event, pending.anchor);
        if (cancelDefault) event.preventDefault();
        postEditorMessage({
          type: 'html-editor-link',
          href: link.href,
          disposition: intent.disposition,
          trusted: Boolean(event.isTrusted),
          ...(intent.disposition === 'new-context' ? { requestId: pending.requestId } : {}),
          ...(intent.disposition === 'download' ? { download: intent.download } : {}),
        });
      };
      const capturePreviewLink = event => {
        const link = previewProjectLink(event);
        if (!link) return;
        const intent = previewLinkDisposition(event, link.anchor);
        const requestId = intent.disposition === 'new-context' ? previewLinkRequestId() : '';
        const shield = '#__kodety-preview-navigation-pending';
        const pending = { ...link, ...intent, requestId, shield, handled: false };
        pendingPreviewLinks.set(event, pending);
        pending.unmask = maskPreviewLinkShield(pending);
        Element.prototype.setAttribute.call(link.anchor, 'href', shield);
        // The timer is the stopPropagation fallback. The inert href owns the
        // browser default before this task runs, while defaultPrevented still
        // reflects only the authored handlers (the guard never cancels it).
        setTimeout(() => finishPreviewLink(event, pending), 0);
      };
      const finishCapturedPreviewLink = event => {
        const pending = pendingPreviewLinks.get(event);
        if (!pending) return;
        restorePreviewLink(pending);
        if (event.defaultPrevented) {
          pending.handled = true;
          return;
        }
        // Cancel only at the final bubble boundary. Authored target/document
        // handlers have already observed a normal, uncancelled click.
        finishPreviewLink(event, pending, true);
      };
      ['click', 'auxclick'].forEach(type => {
        window.addEventListener(type, capturePreviewLink, true);
        window.addEventListener(type, finishCapturedPreviewLink, false);
      });
      registerEditorMessageListener(event => {
        if (!isCurrentEditorMessage(event)) return;
        if (event.data?.type !== 'html-editor-preview-scroll-to-hash') return;
        const rawHash = String(event.data.hash || '').replace(/^#/, '');
        const nextHash = rawHash ? '#' + rawHash : '';
        try {
          if (location.hash !== nextHash) location.hash = nextHash;
        } catch {}
        if (!rawHash) {
          scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        let id = rawHash;
        try { id = decodeURIComponent(rawHash); } catch {}
        const target = document.getElementById(id) || document.querySelector('[name="' + CSS.escape(id) + '"]');
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    const nonTextTags = new Set(['img','video','audio','input','source','br','hr','iframe','canvas','svg','embed','object','select','textarea','picture']);
    const inlineEditSessions = new WeakMap();
    let inlineTextRange = null;
    let inlineTextRangePath = '';
    const publishInlineTextRange = active => {
      if (!inlineTextRangePath) return;
      postEditorMessage({ type: 'html-editor-text-range', path: inlineTextRangePath, active });
    };
    const clearInlineTextRange = () => {
      if (inlineTextRange && inlineTextRangePath) publishInlineTextRange(false);
      inlineTextRange = null;
      inlineTextRangePath = '';
    };
    const captureInlineTextRange = () => {
      const selection = getSelection();
      const editing = document.querySelector('[data-html-editor-editing]');
      if (!editing || !selection?.rangeCount || selection.isCollapsed) {
        // A blur to the parent Design panel deliberately retains the last
        // range. A caret collapse inside the active editor does not.
        if (editing) clearInlineTextRange();
        return;
      }
      const range = selection.getRangeAt(0);
      if (!editing.contains(range.startContainer) || !editing.contains(range.endContainer)) {
        clearInlineTextRange();
        return;
      }
      inlineTextRange = range.cloneRange();
      inlineTextRangePath = editing.dataset.htmlEditorPath || '';
      publishInlineTextRange(true);
    };
    document.addEventListener('selectionchange', captureInlineTextRange);
    const editPointRange = (x, y) => {
      if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(x, y);
        if (!position) return null;
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        return range;
      }
      return document.caretRangeFromPoint?.(x, y)?.cloneRange?.() || null;
    };
    const selectWordAtPoint = (el, x, y) => {
      const range = editPointRange(x, y);
      const selection = getSelection();
      if (!range || !selection || !el.contains(range.startContainer)) return false;
      let node = range.startContainer;
      let offset = range.startOffset;
      if (node.nodeType !== Node.TEXT_NODE) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        node = walker.nextNode();
        offset = 0;
      }
      if (!node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
        selection.removeAllRanges();
        selection.addRange(range);
        return false;
      }
      const text = node.nodeValue || '';
      let start = Math.min(offset, text.length);
      let end = start;
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text));
        const segment = segments.find(item => item.isWordLike && start >= item.index && start <= item.index + item.segment.length)
          || segments.find(item => item.isWordLike && item.index >= start);
        if (segment) {
          start = segment.index;
          end = segment.index + segment.segment.length;
        }
      }
      if (end === start) {
        const isWord = character => /[0-9A-Za-zÀ-ÖØ-öø-ÿ_]/.test(character || '');
        if (start === text.length && start > 0) start -= 1;
        if (!isWord(text[start]) && start > 0 && isWord(text[start - 1])) start -= 1;
        end = start;
        while (start > 0 && isWord(text[start - 1])) start -= 1;
        while (end < text.length && isWord(text[end])) end += 1;
      }
      range.setStart(node, start);
      range.setEnd(node, Math.max(start, end));
      selection.removeAllRanges();
      selection.addRange(range);
      return !range.collapsed;
    };
    const insertAtSelection = node => {
      const selection = getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const cleanEditableInnerHtml = el => {
      const clone = el.cloneNode(true);
      // Source descendants were all path-annotated before authored animation
      // code ran. A pathless span below a rich host is therefore a runtime text
      // splitter fragment, not markup the author created; unwrap it while
      // preserving its edited text.
      Array.from(clone.querySelectorAll(
        'span:not([data-html-editor-path]):not([data-html-editor-inline-style-range])'
      )).reverse().forEach(node => {
        node.replaceWith(...Array.from(node.childNodes));
      });
      [clone, ...clone.querySelectorAll('*')].forEach(node => {
        const originals = [];
        Array.from(node.attributes).forEach(attribute => {
          const match = attribute.name.match(/^data-html-editor-original-(.+)$/);
          if (match) originals.push([match[1], attribute.value]);
        });
        originals.forEach(([name, value]) => node.setAttribute(name, value));
        Array.from(node.attributes).forEach(attribute => {
          const name = attribute.name;
          if (name.startsWith('data-html-editor-') || name === 'contenteditable') node.removeAttribute(name);
        });
        if (node.classList) {
          Array.from(node.classList).filter(name => name.startsWith('html-editor-')).forEach(name => node.classList.remove(name));
          if (!node.classList.length) node.removeAttribute('class');
        }
      });
      return clone.innerHTML;
    };
    const applyInlineTextRangeStyle = (path, property, value) => {
      if (!inlineTextRange || inlineTextRangePath !== path || inlineTextRange.collapsed) return false;
      const host = preferredEditorPathElement(path);
      if (
        !host
        || !inlineTextRange.startContainer?.isConnected
        || !inlineTextRange.endContainer?.isConnected
        || !host.contains(inlineTextRange.startContainer)
        || !host.contains(inlineTextRange.endContainer)
      ) {
        clearInlineTextRange();
        return false;
      }
      const common = inlineTextRange.commonAncestorContainer;
      const commonElement = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
      let span = commonElement?.closest?.('span[data-html-editor-inline-style-range]');
      if (!span) {
        const authoredSpan = commonElement?.closest?.('span');
        if (authoredSpan && host.contains(authoredSpan)) {
          const authoredRange = document.createRange();
          authoredRange.selectNodeContents(authoredSpan);
          if (
            inlineTextRange.compareBoundaryPoints(Range.START_TO_START, authoredRange) === 0
            && inlineTextRange.compareBoundaryPoints(Range.END_TO_END, authoredRange) === 0
          ) {
            span = authoredSpan;
            span.setAttribute('data-html-editor-inline-style-range', '');
          }
        }
      }
      if (!span || !host.contains(span)) {
        span = document.createElement('span');
        span.setAttribute('data-html-editor-inline-style-range', '');
        const fragment = inlineTextRange.extractContents();
        if (!fragment.textContent && !fragment.querySelector?.('br')) return false;
        span.appendChild(fragment);
        inlineTextRange.insertNode(span);
      }
      const normalizedProperty = normalizeRuntimeStyleProperty(property);
      if (!normalizedProperty) return false;
      if (value) span.style.setProperty(normalizedProperty, value);
      else span.style.removeProperty(normalizedProperty);
      host.setAttribute('data-html-editor-rich-text', '');
      const nextRange = document.createRange();
      nextRange.selectNodeContents(span);
      inlineTextRange = nextRange.cloneRange();
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
      publishInlineTextRange(true);
      postEditorMessage({
        type: 'html-editor-text-change',
        path,
        value: host.textContent || '',
        html: cleanEditableInnerHtml(host),
        rangeStyle: true,
      });
      return true;
    };
    registerEditorMessageListener(event => {
      if (!isCurrentEditorMessage(event) || event.data?.type !== 'html-editor-inline-range-style') return;
      applyInlineTextRangeStyle(
        String(event.data.path || ''),
        String(event.data.property || ''),
        String(event.data.value || ''),
      );
    });
    const beginInlineTextEdit = (el, event) => {
      const open = document.querySelector('[data-html-editor-editing]');
      if (open && open !== el) open.blur();
      clearInlineTextRange();
      if (inspectionEnabled && selected !== el) selectElement(el, false);
      const rich = el.hasAttribute('data-html-editor-rich-text');
      inlineEditSessions.set(el, {
        html: el.innerHTML,
        text: el.textContent || '',
        rich,
        insertedMarkup: false,
        cancelled: false,
        spellcheck: el.getAttribute('spellcheck'),
      });
      el.contentEditable = rich ? 'true' : 'plaintext-only';
      el.setAttribute('data-html-editor-editing', '');
      el.setAttribute('spellcheck', 'true');
      document.documentElement.setAttribute('data-kodety-text-editing', '');
      if (directOverlay) directOverlay.hidden = true;
      el.focus({ preventScroll: true });
      selectWordAtPoint(el, event.clientX, event.clientY);
    };
    document.addEventListener('dblclick', event => {
      if (!contentEditing) return;
      // Prefer the authored rich-text host over the nested span under the
      // pointer. This keeps one paragraph/heading editable as a continuous
      // range while preserving every authored inline style and <br>.
      const richHost = event.target.closest?.('[data-html-editor-rich-text]');
      const el = richHost || selectableFromEvent(event, true);
      if (
        !el
        || el.closest('[data-html-editor-locked]')
        || (!el.hasAttribute('data-html-editor-leaf') && !el.hasAttribute('data-html-editor-rich-text'))
        || nonTextTags.has(el.tagName.toLowerCase())
      ) return;
      event.preventDefault();
      event.stopPropagation();
      beginInlineTextEdit(el, event);
    }, true);
    const standaloneClipboardSvg = value => {
      const normalized = String(value || '')
        .replace(/^\\uFEFF/, '')
        .replace(/<\\?xml[\\s\\S]*?\\?>/gi, '')
        .replace(/<!doctype\\s+svg(?:\\s[^>]*)?>/gi, '')
        .trim();
      // Clipboard HTML commonly wraps the actual vector in meta/div nodes.
      // Extract the candidate here; the parent performs the canonical parse,
      // sanitization and single-root validation before persistence.
      // A structured package can embed SVG asset strings without being an SVG
      // document itself. Never cut one of those strings out of JSON.
      if (normalized.startsWith('{') || normalized.startsWith('[')) return '';
      return normalized.match(/<svg(?:\\s|>)[\\s\\S]*<\\/svg>/i)?.[0] || '';
    };
    document.addEventListener('paste', event => {
      const el = event.target?.closest?.('[data-html-editor-editing]');
      if (el) {
        event.preventDefault();
        insertAtSelection(document.createTextNode(event.clipboardData?.getData('text/plain') || ''));
        return;
      }
      const nativeEditingField = event.target?.closest?.(
        'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])'
      );
      if (nativeEditingField) return;
      if (!inspectionEnabled || !selected || !event.clipboardData) return;
      const targetPath = selected.dataset.htmlEditorPath || '';
      const clipboardText = event.clipboardData.getData('text/plain') || '';
      const clipboardHtml = event.clipboardData.getData('text/html') || '';
      // Figma packages contain SVG assets, but have their own protocol and
      // size budget. Route them before considering standalone vector pastes.
      if (clipboardText.includes('__kodety_figma__') || clipboardHtml.includes('__kodety_figma__')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const withinFigmaBudget = clipboardText.length + clipboardHtml.length <= 96 * 1024 * 1024;
        postEditorMessage({
          type: 'html-editor-figma-paste',
          text: withinFigmaBudget ? clipboardText : '__kodety_figma__',
          html: withinFigmaBudget ? clipboardHtml : '',
          targetPath,
        });
        return;
      }
      const directSvg = standaloneClipboardSvg(event.clipboardData.getData('image/svg+xml'));
      const textSvg = standaloneClipboardSvg(clipboardText);
      const htmlSvg = standaloneClipboardSvg(clipboardHtml);
      const svgFile = Array.from(event.clipboardData.files || []).find(file =>
        file.type.toLowerCase() === 'image/svg+xml' || /\\.svg$/i.test(file.name)
      ) || Array.from(event.clipboardData.items || [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .find(file => file && (file.type.toLowerCase() === 'image/svg+xml' || /\\.svg$/i.test(file.name)));
      const svg = directSvg || textSvg || htmlSvg;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (svg || svgFile) {
        const postSvg = source => postEditorMessage({
          type: 'html-editor-svg-paste',
          svg: source.length <= 384 * 1024 ? source : '',
          targetPath,
        });
        if (svg) postSvg(svg);
        else if (svgFile.size > 384 * 1024) postSvg('');
        else svgFile.text().then(postSvg, () => postSvg(''));
        return;
      }
      postEditorMessage({ type: 'html-editor-command', command: 'paste-selection' });
    }, true);
    document.addEventListener('keydown', event => {
      const el = event.target.closest?.('[data-html-editor-editing]');
      if (!el) return;
      const session = inlineEditSessions.get(el);
      if (event.key === 'Escape') {
        event.preventDefault();
        clearInlineTextRange();
        if (session) {
          el.innerHTML = session.html;
          session.cancelled = true;
        }
        el.blur();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        clearInlineTextRange();
        el.blur();
      } else if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        if (session) session.insertedMarkup = true;
        insertAtSelection(document.createElement('br'));
      }
    }, true);
    document.addEventListener('blur', event => {
      const el = event.target.closest?.('[data-html-editor-editing]');
      if (!el) return;
      const session = inlineEditSessions.get(el);
      const cancelled = Boolean(session?.cancelled);
      const value = el.textContent || '';
      el.removeAttribute('data-html-editor-editing');
      el.removeAttribute('contenteditable');
      if (session?.spellcheck === null || session?.spellcheck === undefined) el.removeAttribute('spellcheck');
      else el.setAttribute('spellcheck', session.spellcheck);
      document.documentElement.removeAttribute('data-kodety-text-editing');
      inlineEditSessions.delete(el);
      if (directOverlay) directOverlay.hidden = false;
      refreshDirectControls();
      if (!cancelled) postEditorMessage({
        type: 'html-editor-text-change',
        path: el.dataset.htmlEditorPath,
        value,
        ...(session?.rich || session?.insertedMarkup ? { html: cleanEditableInnerHtml(el) } : {}),
      });
    }, true);
    const knownScrollKeys = new Set([
      '__document__',
      ...Object.keys(initialScrollPositions),
    ]);
    const scrollTargetForKey = key => {
      if (key === '__document__') {
        return document.scrollingElement || document.documentElement;
      }
      return preferredEditorPathElement(key);
    };
    const postCurrentScrollState = key => {
      const target = scrollTargetForKey(key);
      if (!(target instanceof Element)) return;
      postEditorMessage({
        type: 'html-editor-scroll-state',
        key,
        x: target.scrollLeft || 0,
        y: target.scrollTop || 0,
      });
    };
    let scrollFrame = 0;
    document.addEventListener('scroll', event => {
      const rawTarget = event.target;
      const scrollingElement = document.scrollingElement || document.documentElement;
      const target = rawTarget === document ? scrollingElement : rawTarget;
      if (!(target instanceof Element)) return;
      const pathElement = target.closest?.('[data-html-editor-path]');
      const key = target === scrollingElement ? '__document__' : pathElement?.dataset.htmlEditorPath;
      if (!key) return;
      knownScrollKeys.add(key);
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        postCurrentScrollState(key);
      });
    }, true);
    let canvasScrollRestoreVersion = 0;
    const forcedScrollBehavior = new Map();
    const forceInstantScroll = element => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
      if (!forcedScrollBehavior.has(element)) {
        forcedScrollBehavior.set(element, {
          value: element.style.getPropertyValue('scroll-behavior'),
          priority: element.style.getPropertyPriority('scroll-behavior'),
        });
      }
      element.style.setProperty('scroll-behavior', 'auto');
    };
    const releaseForcedScrollBehavior = () => {
      forcedScrollBehavior.forEach((previous, element) => {
        // Do not roll back an authored live edit that arrived during the
        // two-frame settle window.
        if (
          element.style.getPropertyValue('scroll-behavior') !== 'auto'
          || element.style.getPropertyPriority('scroll-behavior')
        ) return;
        if (previous.value) {
          element.style.setProperty(
            'scroll-behavior',
            previous.value,
            previous.priority,
          );
        } else {
          element.style.removeProperty('scroll-behavior');
        }
      });
      forcedScrollBehavior.clear();
    };
    const finishCanvasScrollRestore = version => {
      if (version !== canvasScrollRestoreVersion) return;
      releaseForcedScrollBehavior();
      document.documentElement.removeAttribute(
        'data-html-editor-scroll-restore-pending',
      );
      if (window.__KODETY_EDITOR_SCROLL_RESTORE_FALLBACK__) {
        clearTimeout(window.__KODETY_EDITOR_SCROLL_RESTORE_FALLBACK__);
        window.__KODETY_EDITOR_SCROLL_RESTORE_FALLBACK__ = 0;
      }
    };
    const normalizedCanvasScrollEntries = positions => Object
      .entries(positions && typeof positions === 'object' ? positions : {})
      .slice(0, 1024)
      .filter(([key, position]) => (
        (key === '__document__' || /^\\d+(?:\\/\\d+)*$/.test(key))
        && position
        && typeof position === 'object'
        && typeof position.x === 'number'
        && typeof position.y === 'number'
        && Number.isFinite(position.x)
        && Number.isFinite(position.y)
      ));
    const restoreCanvasScrollPositions = positions => {
      const version = ++canvasScrollRestoreVersion;
      const entries = normalizedCanvasScrollEntries(positions);
      const restore = () => {
        const scrollingElement =
          document.scrollingElement || document.documentElement;
        forceInstantScroll(document.documentElement);
        forceInstantScroll(document.body);
        forceInstantScroll(scrollingElement);
        entries.forEach(([key, position]) => {
          knownScrollKeys.add(key);
          const x = Math.max(-1e9, Math.min(1e9, position.x));
          const y = Math.max(-1e9, Math.min(1e9, position.y));
          if (key === '__document__') {
            try {
              window.scrollTo({ left: x, top: y, behavior: 'instant' });
            } catch {
              window.scrollTo(x, y);
            }
            return;
          }
          const target = scrollTargetForKey(key);
          if (!(target instanceof Element)) return;
          forceInstantScroll(target);
          target.scrollLeft = x;
          target.scrollTop = y;
        });
      };
      try {
        // The first application is synchronous: there is no visible frame at
        // y=0 before the saved viewport is in place.
        restore();
      } catch {
        finishCanvasScrollRestore(version);
        return;
      }
      requestAnimationFrame(() => {
        if (version !== canvasScrollRestoreVersion) return;
        try {
          restore();
        } catch {
          finishCanvasScrollRestore(version);
          return;
        }
        requestAnimationFrame(() => {
          if (version !== canvasScrollRestoreVersion) return;
          try {
            restore();
          } finally {
            finishCanvasScrollRestore(version);
          }
        });
      });
    };
    const cmsOriginal = new WeakMap();
    const cmsAppliedTargets = new WeakMap();
    const authoredCmsBindingOriginals = new Map(
      ${serializedAuthoredCmsBindingSnapshots}.map(snapshot => [snapshot.path, snapshot]),
    );
    const cmsPristineCollections = new Map();
    document.querySelectorAll('template[data-html-editor-cms-snapshot]').forEach(snapshot => {
      const id = snapshot.getAttribute('data-html-editor-cms-snapshot');
      const pristine = snapshot.content?.firstElementChild;
      if (id && pristine) cmsPristineCollections.set(id, pristine.cloneNode(true));
      snapshot.remove();
    });
    const collectionOriginal = new WeakMap();
    const collectionHidden = new WeakMap();
    const ensureCmsCollectionOriginal = container => {
      const existing = collectionOriginal.get(container);
      if (existing) return existing;
      const snapshotId = container.getAttribute('data-html-editor-cms-snapshot-id') || '';
      const pristine = cmsPristineCollections.get(snapshotId);
      const original = {
        innerHTML: pristine?.innerHTML ?? container.innerHTML,
        element: pristine || container.cloneNode(true),
      };
      collectionOriginal.set(container, original);
      return original;
    };
    const initialCmsPayload = ${serializedInitialCmsPreview};
    const initialCmsSignature = JSON.stringify(initialCmsPayload);
    let lastCmsPayload = initialCmsPayload;
    let cmsInitialHydrated = Boolean(initialCmsPayload);
    let cmsRefreshTimer = 0;
    const pendingCmsViewStatePaths = new Set();
    let applyingCmsPreview = false;
    let cmsMutationsSuppressedUntil = 0;
    const cmsSelector = '[data-kodety-bind],[data-kodety-bind-content],[data-kodety-bind-title],[data-kodety-bind-href],[data-kodety-bind-src],[data-kodety-bind-alt]';
    // Mirrors kodety_cms_scalar_value() in the theme runtime so the canvas and
    // the published site render the same value for the same field.
    const normalizeCmsValue = value => {
      if (value === undefined || value === null) return '';
      if (Array.isArray(value)) return value.map(normalizeCmsValue).filter(Boolean).join(', ');
      if (typeof value === 'object') return String(value.url || value.value || value.label || '');
      return String(value);
    };
    const belongsToCollection = (node, container) => node.parentElement && node.parentElement.closest('[data-kodety-collection]') === container;
    const settleCmsPreviewMotion = root => {
      if (!(root instanceof Element)) return;
      // CMS materialization must not settle the document motion runtime. The
      // old path forced opacity/visibility/transition on every descendant and
      // also paused document-wide animations, leaking one collection's state
      // into unrelated sections and exposing hover-only layers. CMS clones are
      // created from the pristine authored snapshot, so only reapply the
      // editor's scoped state atoms here.
      window.__KODETY_REAPPLY_EDITOR_LIVE_STATE__?.(root, true, false);
    };
    const cmsBindingsFromAttributes = (attributes, tagName = '') => {
      const bindings = {};
      const legacyField = attributes['data-kodety-bind'];
      if (legacyField) {
        const legacyTarget = attributes['data-kodety-bind-target']
          || (tagName === 'A' ? 'href' : ['IMG', 'SOURCE', 'VIDEO'].includes(tagName) ? 'src' : 'content');
        bindings[legacyTarget] = legacyField;
      }
      ['content', 'title', 'href', 'src', 'alt'].forEach(target => {
        const field = attributes['data-kodety-bind-' + target];
        if (field) bindings[target] = field;
      });
      return bindings;
    };
    const cmsBindingsForElement = element => cmsBindingsFromAttributes(
      Object.fromEntries(
        Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]),
      ),
      element.tagName,
    );
    const cmsBindingOwnsTarget = (element, target) => {
      const bindings = cmsBindingsForElement(element);
      if (Object.prototype.hasOwnProperty.call(bindings, target)) return true;
      return target === 'srcset' && Object.prototype.hasOwnProperty.call(bindings, 'src');
    };
    const captureCmsOriginal = element => {
      if (cmsOriginal.has(element)) return cmsOriginal.get(element);
      const path = element.getAttribute('data-html-editor-path') || '';
      const authored = authoredCmsBindingOriginals.get(path);
      const original = authored
        ? {
            html: authored.html,
            attributes: { ...authored.attributes },
            styles: { ...authored.styles },
          }
        : {
            html: element.innerHTML,
            attributes: Object.fromEntries(
              Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]),
            ),
            styles: Object.fromEntries(
              ['object-position', 'aspect-ratio', 'object-fit'].map(property => [
                property,
                {
                  value: element.style?.getPropertyValue(property) || '',
                  priority: element.style?.getPropertyPriority(property) || '',
                },
              ]),
            ),
          };
      cmsOriginal.set(element, original);
      return original;
    };
    const restoreCmsBindingTarget = (element, original, target) => {
      if (target === 'content') {
        if (element.innerHTML !== original.html) element.innerHTML = original.html;
        return;
      }
      if (Object.prototype.hasOwnProperty.call(original.attributes, target)) {
        element.setAttribute(target, original.attributes[target]);
      } else {
        element.removeAttribute(target);
      }
      if (target !== 'src') return;
      if (Object.prototype.hasOwnProperty.call(original.attributes, 'srcset')) {
        element.setAttribute('srcset', original.attributes.srcset);
      } else {
        element.removeAttribute('srcset');
      }
      Object.entries(original.styles || {}).forEach(([property, entry]) => {
        if (entry.value) element.style?.setProperty(property, entry.value, entry.priority || '');
        else element.style?.removeProperty(property);
      });
    };
    const applyCmsBindingElement = (element, item) => {
      const original = captureCmsOriginal(element);
      const bindings = cmsBindingsForElement(element);
      const previousTargets = cmsAppliedTargets.get(element)
        || new Set(Object.keys(cmsBindingsFromAttributes(original.attributes, element.tagName)));
      previousTargets.forEach(target => {
        if (!Object.prototype.hasOwnProperty.call(bindings, target)) {
          restoreCmsBindingTarget(element, original, target);
        }
      });
      if (!item) {
        Object.keys(bindings).forEach(target => restoreCmsBindingTarget(element, original, target));
        cmsAppliedTargets.delete(element);
        return;
      }
      const appliedTargets = new Set();
      Object.entries(bindings).forEach(([target, field]) => {
        const value = item?.values && field
          ? (target === 'href' && field === 'slug' ? item.values.permalink : item.values[field])
          : undefined;
        if (value === undefined || value === null) {
          restoreCmsBindingTarget(element, original, target);
          return;
        }
        const normalized = normalizeCmsValue(value);
        if (target === 'content') element.innerHTML = normalized;
        else if (target === 'alt' && typeof value === 'object' && value && !Array.isArray(value)) element.setAttribute(target, String(value.alt || ''));
        else if (normalized) element.setAttribute(target, normalized);
        else element.removeAttribute(target);
        if (target === 'src') {
          element.removeAttribute('srcset');
          // A previous structured image may have installed crop/focal styles.
          // Reset those to the authored baseline before projecting the next
          // value so switching to a plain URL cannot retain a stale crop.
          Object.entries(original.styles || {}).forEach(([property, entry]) => {
            if (entry.value) element.style?.setProperty(property, entry.value, entry.priority || '');
            else element.style?.removeProperty(property);
          });
          if (typeof value === 'object' && value && !Array.isArray(value)) {
            element.style.objectPosition = Number(value.focalX ?? 50) + '% ' + Number(value.focalY ?? 50) + '%';
            const ratios = { square: '1 / 1', landscape: '16 / 9', portrait: '4 / 5' };
            if (ratios[value.crop]) { element.style.aspectRatio = ratios[value.crop]; element.style.objectFit = 'cover'; }
            else { element.style.removeProperty('aspect-ratio'); element.style.removeProperty('object-fit'); }
          }
        }
        appliedTargets.add(target);
      });
      if (appliedTargets.size) cmsAppliedTargets.set(element, appliedTargets);
      else cmsAppliedTargets.delete(element);
    };
    const applyCmsBindings = (root, item, collectionType = '', itemForType = null) => {
      const elements = [];
      if (root.matches?.(cmsSelector)) elements.push(root);
      root.querySelectorAll?.(cmsSelector).forEach(element => elements.push(element));
      elements.forEach(element => {
        const bindingType = element.getAttribute?.('data-kodety-bind-type') || '';
        const bindingItem = bindingType && bindingType !== collectionType && typeof itemForType === 'function'
          ? itemForType(bindingType)
          : item;
        applyCmsBindingElement(element, bindingItem);
      });
      settleCmsPreviewMotion(root);
    };
    const cmsFilterComparable = value => String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    const cmsFilterControlValues = (form, name) => {
      const controls = Array.from(form.elements || []).filter(control => control?.name === name && !control.disabled);
      if (!controls.length) return [];
      const first = controls[0];
      if (first.type === 'checkbox' || first.type === 'radio') return controls.filter(control => control.checked).map(control => control.value);
      if (first.tagName === 'SELECT' && first.multiple) return Array.from(first.options).filter(option => option.selected).map(option => option.value);
      return [first.value];
    };
    const cmsFilterCandidates = value => {
      if (Array.isArray(value)) return value.flatMap(cmsFilterCandidates);
      if (value && typeof value === 'object') return cmsFilterCandidates(value.value || value.label || value.title || value.url || '');
      return [value];
    };
    const cmsFilterMatches = (raw, query, operator) => {
      const queries = (Array.isArray(query) ? query : [query]).filter(value => cmsFilterComparable(value) !== '');
      if (!queries.length) return true;
      return queries.some(queryValue => cmsFilterCandidates(raw).some(candidate => {
        const left = cmsFilterComparable(candidate);
        const right = cmsFilterComparable(queryValue);
        if (operator === 'equals') return left === right;
        if (operator === 'starts_with') return left.startsWith(right);
        if (operator === 'gte' || operator === 'lte') {
          const leftNumber = Number(candidate);
          const rightNumber = Number(queryValue);
          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return operator === 'gte' ? leftNumber >= rightNumber : leftNumber <= rightNumber;
          return operator === 'gte' ? left >= right : left <= right;
        }
        return left.includes(right);
      }));
    };
    const applyCmsFilterForm = form => {
      const collection = form.getAttribute('data-kodety-filter-collection') || '';
      let mapping = {};
      try { mapping = JSON.parse(form.getAttribute('data-kodety-filter-map') || '{}') || {}; } catch { mapping = {}; }
      const items = Array.from(document.querySelectorAll('[data-kodety-rendered-item]')).filter(
        item => item.getAttribute('data-kodety-rendered-item') === collection,
      );
      Object.entries(mapping).forEach(([name, rule]) => {
        if (rule?.options !== 'cms' || !rule.field) return;
        const select = Array.from(form.elements || []).find(control => control?.name === name && control.tagName === 'SELECT');
        if (!select) return;
        const options = [];
        items.forEach(item => {
          let values = {};
          try { values = JSON.parse(item.getAttribute('data-kodety-filter-values') || '{}') || {}; } catch { values = {}; }
          cmsFilterCandidates(values[rule.field]).forEach(value => {
            if (value == null || cmsFilterComparable(value) === '') return;
            const label = String(value);
            if (!options.some(entry => cmsFilterComparable(entry) === cmsFilterComparable(label))) options.push(label);
          });
        });
        options.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
        const signature = JSON.stringify(options);
        if (select.getAttribute('data-kodety-cms-options-signature') === signature) return;
        const selected = select.value;
        const placeholder = Array.from(select.options).find(option => option.value === '');
        select.replaceChildren();
        if (placeholder) select.appendChild(placeholder);
        options.forEach(value => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          select.appendChild(option);
        });
        select.value = selected;
        select.setAttribute('data-kodety-cms-options-signature', signature);
      });
      const limit = items.length ? Math.max(1, Number(items[0].getAttribute('data-kodety-filter-limit')) || items.length) : 0;
      let visible = 0;
      items.forEach(item => {
        let values = {};
        try { values = JSON.parse(item.getAttribute('data-kodety-filter-values') || '{}') || {}; } catch { values = {}; }
        const matches = Object.entries(mapping).every(([name, rule]) => (
          !rule?.field || cmsFilterMatches(values[rule.field], cmsFilterControlValues(form, name), rule.operator || 'contains')
        ));
        item.hidden = !(matches && visible < limit);
        if (matches && visible < limit) visible += 1;
      });
      document.querySelectorAll('[data-kodety-filter-count]').forEach(element => {
        const target = element.getAttribute('data-kodety-filter-count');
        if (!target || target === collection) element.textContent = String(visible);
      });
    };
    const applyCmsFilters = () => {
      document.querySelectorAll('form[data-kodety-form-mode="filter"][data-kodety-filter-collection]').forEach(form => {
        if (form.getAttribute('data-kodety-filter-bound') !== 'true') {
          form.setAttribute('data-kodety-filter-bound', 'true');
          let timer = 0;
          const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(() => applyCmsFilterForm(form), 120);
          };
          form.addEventListener('submit', event => { event.preventDefault(); applyCmsFilterForm(form); }, true);
          form.addEventListener('reset', () => setTimeout(() => applyCmsFilterForm(form), 0));
          if (form.getAttribute('data-kodety-filter-on') !== 'submit') {
            form.addEventListener('input', schedule);
            form.addEventListener('change', schedule);
          }
          form.querySelectorAll('input[type="range"][data-kodety-range-output]').forEach(control => {
            const updateOutput = () => {
              try {
                const output = document.querySelector(control.getAttribute('data-kodety-range-output') || '');
                if (output) output.textContent = control.value;
              } catch {}
            };
            control.addEventListener('input', updateOutput);
            updateOutput();
          });
        }
        applyCmsFilterForm(form);
      });
    };
    const applyCmsPreview = payload => {
      if (applyingCmsPreview) return;
      applyingCmsPreview = true;
      cmsMutationsSuppressedUntil = performance.now() + 80;
      if (payload !== undefined) lastCmsPayload = payload;
      payload = lastCmsPayload;
      try {
      const item = payload?.item || null;
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const postType = payload?.postType || '';
      const collections = payload?.collections && typeof payload.collections === 'object'
        ? payload.collections
        : (postType ? { [postType]: items } : {});
      const itemForType = type => {
        if (!type) return item;
        if (type === postType && item) return item;
        return Array.isArray(collections[type]) ? collections[type][0] || null : null;
      };
      const collectionSelector = '[data-kodety-collection]';
      document.querySelectorAll('[data-kodety-preview-clone]').forEach(clone => clone.remove());
      document.querySelectorAll(collectionSelector).forEach(container => {
        ensureCmsCollectionOriginal(container);
        if (!collectionHidden.has(container)) collectionHidden.set(container, container.hidden);
        container.innerHTML = collectionOriginal.get(container).innerHTML;
        container.hidden = collectionHidden.get(container);
        container.removeAttribute('data-kodety-preview-empty');
      });
      applyCmsBindings(document, item, postType, itemForType);
      if (!payload) return;
      document.querySelectorAll(collectionSelector).forEach(container => {
        const containerType = container.getAttribute('data-kodety-collection') || '';
        const collectionItems = Array.isArray(collections[containerType]) ? collections[containerType] : null;
        if (!collectionItems) return;
        const originalCollection = collectionOriginal.get(container);
        container.innerHTML = originalCollection.innerHTML;
        const limit = Math.max(1, Math.min(100, Number(container.getAttribute('data-kodety-limit')) || 6));
        const filterable = Array.from(document.querySelectorAll('form[data-kodety-form-mode="filter"]')).some(
          form => form.getAttribute('data-kodety-filter-collection') === containerType,
        );
        const limited = collectionItems.slice(0, filterable ? 100 : limit);
        // Only a template whose nearest collection ancestor is THIS container
        // counts — a nested collection's item marker must not leak outward.
        const explicitTemplate = Array.from(container.querySelectorAll('[data-kodety-collection-item]')).find(candidate => belongsToCollection(candidate, container)) || null;
        const repeatSelf = !explicitTemplate && container.getAttribute('data-kodety-repeat') !== 'child';
        if (repeatSelf) {
          const parent = container.parentNode;
          if (!parent) return;
          if (!limited.length) {
            // Mirror the runtime: an empty collection keeps only its declared
            // empty-state elements; without one it disappears entirely.
            if (container.querySelector('[data-kodety-empty-state]')) {
              Array.from(container.children).forEach(child => { if (!child.hasAttribute('data-kodety-empty-state')) child.hidden = true; });
              container.setAttribute('data-kodety-preview-empty', 'true');
              if (!container.hasAttribute('data-html-editor-original-hidden')) container.hidden = false;
            } else {
              container.hidden = true;
            }
            return;
          }
          limited.forEach((collectionItem, itemIndex) => {
            // Clone the authored collection, not the live node potentially
            // mutated to opacity:0/visibility:hidden by GSAP before CMS data
            // arrived. These late clones have no corresponding original
            // timeline, so their correct resting state is the authored state.
            const clone = originalCollection.element.cloneNode(true);
            ['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat', 'data-kodety-collection-item', 'data-html-editor-cms-snapshot-id'].forEach(attribute => clone.removeAttribute?.(attribute));
            clone.setAttribute?.('data-kodety-preview-clone', 'true');
            clone.setAttribute?.('data-kodety-preview-item-id', String(collectionItem.id || ''));
            clone.setAttribute?.('data-kodety-rendered-item', containerType);
            clone.setAttribute?.('data-kodety-filter-limit', String(limit));
            clone.setAttribute?.('data-kodety-filter-values', JSON.stringify(collectionItem.values || {}));
            if (!clone.hasAttribute('data-html-editor-original-hidden')) clone.hidden = false;
            if (itemIndex >= limit) clone.hidden = true;
            clone.querySelectorAll?.('[data-kodety-empty-state]').forEach(element => element.remove());
            applyCmsBindings(clone, collectionItem, containerType, itemForType);
            parent.insertBefore(clone, container);
            settleCmsPreviewMotion(clone);
          });
          container.hidden = true;
          return;
        }
        const template = explicitTemplate || Array.from(container.children).find(child => !child.hasAttribute('data-kodety-empty-state')) || null;
        if (!template || !template.parentNode) return;
        const parent = template.parentNode;
        const anchor = template.nextSibling;
        if (!limited.length) {
          parent.removeChild(template);
          container.querySelectorAll('[data-kodety-empty-state]').forEach(element => {
            if (!element.hasAttribute('data-html-editor-original-hidden')) element.hidden = false;
          });
          container.setAttribute('data-kodety-preview-empty', 'true');
          return;
        }
        limited.forEach((collectionItem, itemIndex) => {
          const clone = template.cloneNode(true);
          clone.removeAttribute?.('data-kodety-collection-item');
          clone.setAttribute?.('data-kodety-preview-item-id', String(collectionItem.id || ''));
          clone.setAttribute?.('data-kodety-rendered-item', containerType);
          clone.setAttribute?.('data-kodety-filter-limit', String(limit));
          clone.setAttribute?.('data-kodety-filter-values', JSON.stringify(collectionItem.values || {}));
          if (itemIndex >= limit) clone.hidden = true;
          clone.querySelectorAll?.('[data-kodety-empty-state]').forEach(element => element.remove());
          applyCmsBindings(clone, collectionItem, containerType, itemForType);
          parent.insertBefore(clone, anchor);
          settleCmsPreviewMotion(clone);
        });
        parent.removeChild(template);
        container.querySelectorAll('[data-kodety-empty-state]').forEach(element => { element.hidden = true; });
      });
      applyCmsFilters();
      requestAnimationFrame(() => {
        applyCmsFilters();
      });
      } finally {
        // innerHTML and collection cloning replace descendants even though
        // their source paths are unchanged. Each changed root is restored by
        // its scoped motion settle; after all clones exist, only the selection
        // anchor needs a document-level reconciliation.
        window.__KODETY_REBIND_EDITOR_SELECTION__?.();
        applyingCmsPreview = false;
      }
    };
    const cmsItemForBoundElement = (element, payload = lastCmsPayload) => {
      if (!(element instanceof Element) || !payload) return null;
      const postType = payload?.postType || '';
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const collections = payload?.collections && typeof payload.collections === 'object'
        ? payload.collections
        : (postType ? { [postType]: items } : {});
      const bindingType = element.getAttribute('data-kodety-bind-type') || '';
      const renderedRoot = element.closest('[data-kodety-rendered-item], [data-kodety-preview-item-id]');
      const renderedType = renderedRoot?.getAttribute('data-kodety-rendered-item') || '';
      const renderedId = renderedRoot?.getAttribute('data-kodety-preview-item-id') || '';
      if (renderedType && (!bindingType || bindingType === renderedType)) {
        const renderedItems = Array.isArray(collections[renderedType]) ? collections[renderedType] : [];
        const renderedItem = renderedItems.find(candidate => String(candidate?.id || '') === renderedId);
        if (renderedItem) return renderedItem;
      }
      if ((!bindingType || bindingType === postType) && payload?.item) return payload.item;
      const typedItems = Array.isArray(collections[bindingType]) ? collections[bindingType] : [];
      return typedItems[0] || null;
    };
    const refreshCmsBindingElement = element => {
      if (!(element instanceof Element) || !lastCmsPayload) return;
      if (!element.matches(cmsSelector) && !cmsOriginal.has(element) && !cmsAppliedTargets.has(element)) return;
      applyCmsBindingElement(element, cmsItemForBoundElement(element));
    };
    const refreshCmsSourceBindings = () => {
      document.querySelectorAll(cmsSelector).forEach(element => {
        if (element.closest('[data-kodety-preview-clone], [data-kodety-rendered-item]')) return;
        refreshCmsBindingElement(element);
      });
    };
    const scheduleCmsRefresh = (delay = 0) => {
      if (!lastCmsPayload) return;
      clearTimeout(cmsRefreshTimer);
      cmsRefreshTimer = setTimeout(() => {
        // A generic runtime refresh must never cancel a more precise View
        // State refresh that still owes an authored-value restoration.
        if (pendingCmsViewStatePaths.size) {
          scheduleCmsViewStateRefresh(Array.from(pendingCmsViewStatePaths));
          return;
        }
        applyCmsPreview(lastCmsPayload);
      }, delay);
    };
    const cmsRuntimeAttributeNames = new Set([
      'data-kodety-collection',
      'data-kodety-collection-item',
      'data-kodety-limit',
      'data-kodety-orderby',
      'data-kodety-order',
      'data-kodety-repeat',
    ]);
    const isCmsRuntimeAttribute = name => {
      const normalized = String(name || '').trim().toLowerCase();
      return normalized === 'data-kodety-bind'
        || normalized.startsWith('data-kodety-bind-')
        || normalized === 'data-kodety-form-mode'
        || normalized.startsWith('data-kodety-filter-')
        || cmsRuntimeAttributeNames.has(normalized);
    };
    const mirrorCmsAttributeToCollectionOriginal = (element, patch) => {
      if (!isCmsRuntimeAttribute(patch.name)) return;
      let container = element.matches?.('[data-kodety-collection]')
        ? element
        : element.closest?.('[data-kodety-collection]');
      let original = container ? ensureCmsCollectionOriginal(container) : null;
      const path = element.getAttribute('data-html-editor-path') || '';
      if (!original) {
        container = Array.from(document.querySelectorAll('[data-kodety-collection]')).find(candidate => {
          const candidateOriginal = ensureCmsCollectionOriginal(candidate);
          if (!candidateOriginal?.element) return false;
          const rootPath = candidateOriginal.element.getAttribute?.('data-html-editor-path') || '';
          return rootPath === path || Boolean(candidateOriginal.element.querySelector?.(
            '[data-html-editor-path="' + CSS.escape(path) + '"]',
          ));
        }) || null;
        original = container ? collectionOriginal.get(container) : null;
      }
      if (!original?.element) return;
      const originalPath = original.element.getAttribute?.('data-html-editor-path') || '';
      const target = originalPath === path
        ? original.element
        : original.element.querySelector?.(
            '[data-html-editor-path="' + CSS.escape(path) + '"]',
          );
      if (!target) return;
      if (patch.value === null) target.removeAttribute(patch.name);
      else target.setAttribute(patch.name, patch.value);
      original.innerHTML = original.element.innerHTML;
    };
    const scheduleCmsViewStateRefresh = (paths, delay = 0) => {
      if (!lastCmsPayload || !paths?.length) return;
      paths.forEach(path => pendingCmsViewStatePaths.add(path));
      clearTimeout(cmsRefreshTimer);
      cmsRefreshTimer = setTimeout(() => {
        const refreshedPaths = Array.from(pendingCmsViewStatePaths);
        pendingCmsViewStatePaths.clear();
        // Update live source nodes and pristine collection templates before
        // rebuilding rows. That makes limit/order/repeat and binding changes
        // effective in this refresh rather than one refresh later.
        refreshedPaths.forEach(path => {
          editorPathElements(path).forEach(element => {
            reapplyEditorLiveState(element, true, false);
          });
        });
        applyCmsPreview(lastCmsPayload);
        refreshedPaths.forEach(path => {
          editorPathElements(path).forEach(element => {
            const originalCollection = collectionOriginal.get(element);
            if (originalCollection && !element.matches('[data-kodety-collection]')) {
              element.innerHTML = originalCollection.innerHTML;
              element.hidden = collectionHidden.get(element) || false;
              element.removeAttribute('data-kodety-preview-empty');
              collectionOriginal.delete(element);
              collectionHidden.delete(element);
            }
            // applyCmsPreview already materialized each collection clone with
            // its own item. Only an element whose binding was removed needs a
            // targeted authored-value restore here.
            if (
              !element.matches(cmsSelector)
              && (cmsOriginal.has(element) || authoredCmsBindingOriginals.has(path))
            ) {
              applyCmsBindingElement(element, null);
            }
            // Reapply styles and unrelated authored atoms to fresh descendants.
            // The replayer skips targets currently owned by CMS bindings.
            reapplyEditorLiveState(element, true, false);
          });
        });
        window.__KODETY_REBIND_EDITOR_SELECTION__?.();
      }, delay);
    };
    let liveStylePaintRefreshScheduled = false;
    let previewPropertyVersions = new Map();
    const liveStyleAtomRevisions = new Map();
    const visibilityAttributeNames = new Set([
      'hidden',
      'aria-hidden',
      'data-kodety-hidden-display',
    ]);
    const liveStyleAtom = (path, property) => {
      const normalized = normalizeRuntimeStyleProperty(property);
      return normalized === 'display'
        ? 'visibility\\u0000' + path
        : 'style\\u0000' + path + '\\u0000' + normalized;
    };
    const liveAttributeAtom = (path, name) => {
      const normalized = String(name || '').trim().toLowerCase();
      return visibilityAttributeNames.has(normalized)
        ? 'visibility\\u0000' + path
        : 'attribute\\u0000' + path + '\\u0000' + normalized;
    };
    const isSupersededLiveAtom = (atom, revision) =>
      Number.isSafeInteger(revision)
      && (liveStyleAtomRevisions.get(atom) ?? -1) > revision;
    const markLiveAtom = (atom, revision) => {
      if (!Number.isSafeInteger(revision)) return;
      liveStyleAtomRevisions.set(
        atom,
        Math.max(liveStyleAtomRevisions.get(atom) ?? -1, revision),
      );
    };
    const authoredMotionProperties = new Set([
      'opacity',
      'visibility',
      'transform',
      'translate',
      'rotate',
      'scale',
      'filter',
      'clip-path',
      'content-visibility',
    ]);
    const authoredTransformProperties = new Set([
      'transform',
      'translate',
      'rotate',
      'scale',
      'filter',
      'clip-path',
    ]);
    const committedPathStyles = new Map();
    const committedPathAttributes = new Map();
    const committedPathTexts = new Map();
    const committedVisibilityPaths = new Set();
    const transientPathStyles = new Map();
    // Canvas View State v2 is a complete, one-way projection owned by the
    // editor. It deliberately lives beside the legacy mutation journal while
    // the parent migrates: v2 always paints last and never emits an ACK.
    const canvasViewPathStyles = new Map();
    const canvasViewPathAttributes = new Map();
    const canvasViewPathTexts = new Map();
    const canvasViewPropertyOwnerships = new Map();
    const transientPropertyOwnerships = new Map();
    const canvasRuleOwnedElements = new Set();
    const canvasViewStylesheets = new Map();
    let canvasViewBreakpointId = 'base';
    let canvasViewDesignTokenCssText;
    let canvasViewInteractionDocument;
    let canvasViewInteractionSignature = '';
    let canvasViewHasInteractionSnapshot = false;
    let canvasViewInteractionPending = false;
    let canvasViewInteractionRetryTimer = 0;
    let canvasViewInteractionRetryDelay = 16;
    let canvasViewEpoch = -1;
    let canvasViewVersion = -1;
    let reapplyCanvasViewDocumentState = () => {};
    const canvasViewElementBaselines = new WeakMap();
    const canvasViewTouchedElements = new Set();
    const canvasViewStylesheetBaselines = new Map();
    const canvasViewDesignTokenBaseline = {
      captured: false,
      existed: false,
      cssText: '',
    };
    const setLiveAttribute = (element, name, value = '') => {
      if (element.getAttribute(name) === value) return;
      element.setAttribute(name, value);
    };
    const removeLiveAttribute = (element, name) => {
      if (!element.hasAttribute(name)) return;
      element.removeAttribute(name);
    };
    // Timeline preview owns animated inline styles temporarily. Its release
    // hook removes this marker before settling/replaying the latest Design
    // snapshot; attribute, CMS and text updates remain independent.
    const interactionPreviewOwnsStyles = element => Boolean(
      element?.closest?.('[data-html-editor-interaction-preview]'),
    );
    const CANVAS_HIDDEN_MARKER = 'data-html-editor-canvas-visibility-hidden';
    const setCanvasHiddenAuthority = (element, hidden) => {
      if (!(element instanceof Element)) return;
      if (hidden) setLiveAttribute(element, CANVAS_HIDDEN_MARKER);
      else removeLiveAttribute(element, CANVAS_HIDDEN_MARKER);
    };
    const propertyOwnershipKey = patch => [
      patch.scope,
      patch.target,
      patch.property,
      patch.breakpoint || 'base',
      patch.pseudo || 'base',
    ].join('\\u0000');
    const ownershipContextApplies = (element, patch) => {
      const breakpoint = patch.breakpoint || 'base';
      if (breakpoint !== 'base' && breakpoint !== canvasViewBreakpointId) return false;
      const pseudo = patch.pseudo || 'base';
      if (pseudo === 'base') return true;
      if (
        ['selection', 'placeholder', '-webkit-scrollbar', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track']
          .includes(pseudo)
      ) return false;
      if (pseudo === 'hover' && element.hasAttribute('data-html-editor-hover')) return true;
      try {
        return element.matches(':' + pseudo);
      } catch {
        return false;
      }
    };
    const ownershipMatchesElement = (element, patch) => {
      if (!ownershipContextApplies(element, patch)) return false;
      if (patch.scope === 'path') {
        return element.getAttribute('data-html-editor-path') === patch.target;
      }
      try {
        return element.matches(patch.target);
      } catch {
        return false;
      }
    };
    const applyCanvasRuleOwnershipMarkersToElement = element => {
      if (!(element instanceof Element)) return;
      if (interactionPreviewOwnsStyles(element)) return;
      if (
        !canvasViewPropertyOwnerships.size
        && !transientPropertyOwnerships.size
        && !canvasRuleOwnedElements.has(element)
        && !element.hasAttribute('data-html-editor-canvas-rule-visibility')
        && !element.hasAttribute('data-html-editor-canvas-rule-transform')
      ) return;
      const properties = new Set();
      const transientProperties = new Set();
      const collect = ownerships => {
        ownerships.forEach(patch => {
          if (patch.owned && ownershipMatchesElement(element, patch)) {
            properties.add(patch.property);
          }
        });
      };
      collect(canvasViewPropertyOwnerships);
      transientPropertyOwnerships.forEach(patch => {
        if (patch.owned && ownershipMatchesElement(element, patch)) {
          properties.add(patch.property);
          transientProperties.add(patch.property);
        }
      });
      const previousProperties = new Set(
        Array.from(element.attributes)
          .filter(attribute => (
            attribute.name.startsWith('data-html-editor-canvas-rule-property-')
          ))
          .map(attribute => (
            attribute.name.slice('data-html-editor-canvas-rule-property-'.length)
          )),
      );
      // GSAP/WAAPI and the Design motion settler both materialize frames as
      // inline styles. A rule cannot be authoritative while either inline
      // value remains. Keep the canonical inline declaration in the original
      // marker, remove it only for the lifetime of ownership, then restore it
      // exactly if the transient edit is cancelled/released.
      let authoredStyle;
      properties.forEach(property => {
        if (!element.style) return;
        if (
          !transientProperties.has(property)
          && element.hasAttribute(
            'data-html-editor-canvas-author-property-' + property,
          )
        ) return;
        if (element.style.getPropertyValue(property)) element.style.removeProperty(property);
      });
      previousProperties.forEach(property => {
        if (properties.has(property) || !element.style) return;
        if (!authoredStyle) {
          authoredStyle = document.createElement('span');
          authoredStyle.setAttribute(
            'style',
            element.getAttribute('data-html-editor-original-style') || '',
          );
        }
        const authoredValue = authoredStyle.style.getPropertyValue(property);
        const authoredPriority = authoredStyle.style.getPropertyPriority(property);
        if (authoredValue) {
          if (
            element.style.getPropertyValue(property) !== authoredValue
            || element.style.getPropertyPriority(property) !== authoredPriority
          ) element.style.setProperty(property, authoredValue, authoredPriority);
        } else if (element.style.getPropertyValue(property)) {
          element.style.removeProperty(property);
        }
      });
      previousProperties.forEach(property => {
        if (!properties.has(property)) {
          removeLiveAttribute(element, 'data-html-editor-canvas-rule-property-' + property);
        }
      });
      properties.forEach(property => {
        setLiveAttribute(
          element,
          'data-html-editor-canvas-rule-property-' + property,
        );
      });
      const ownsTransform = Array.from(properties).some(property => (
        authoredTransformProperties.has(property)
      ));
      if (ownsTransform) {
        setLiveAttribute(element, 'data-html-editor-canvas-rule-transform');
      } else {
        removeLiveAttribute(element, 'data-html-editor-canvas-rule-transform');
      }
      if (properties.size) {
        setLiveAttribute(element, 'data-html-editor-canvas-rule-visibility');
        removeLiveAttribute(element, 'data-html-editor-canvas-reveal');
        removeLiveAttribute(element, 'data-html-editor-canvas-reveal-motion');
        canvasRuleOwnedElements.add(element);
      } else {
        removeLiveAttribute(element, 'data-html-editor-canvas-rule-visibility');
        canvasRuleOwnedElements.delete(element);
      }
    };
    const ownershipTargetElements = patch => {
      const breakpoint = patch.breakpoint || 'base';
      if (breakpoint !== 'base' && breakpoint !== canvasViewBreakpointId) return [];
      if (patch.scope === 'path') return editorVisualElements(patch.target);
      try {
        const elements = Array.from(document.querySelectorAll(patch.target));
        if (document.documentElement.matches(patch.target)) {
          elements.unshift(document.documentElement);
        }
        return elements;
      } catch {
        return [];
      }
    };
    const refreshCanvasPropertyOwnershipMarkers = () => {
      const candidates = new Set(canvasRuleOwnedElements);
      const collect = ownerships => {
        ownerships.forEach(patch => {
          if (!patch.owned) return;
          ownershipTargetElements(patch).forEach(element => candidates.add(element));
        });
      };
      collect(canvasViewPropertyOwnerships);
      collect(transientPropertyOwnerships);
      candidates.forEach(applyCanvasRuleOwnershipMarkersToElement);
      canvasRuleOwnedElements.forEach(element => {
        if (!element.isConnected) canvasRuleOwnedElements.delete(element);
      });
    };
    const applyLiveStylePatchToElement = (element, patch) => {
      if (!element?.style) return false;
      const rawValue = typeof patch.value === 'string' ? patch.value : '';
      const value = rawValue.replace(/\s*!\s*important\b/gi, '').trim();
      const priority = patch.priority === 'important' || /!\s*important\b/i.test(rawValue)
        ? 'important'
        : '';
      const property = normalizeRuntimeStyleProperty(patch.property);
      const normalizedProperty = property.toLowerCase();
      if (property.startsWith('--')) customPropertyNames.add(property);
      if (normalizedProperty === 'display') {
        setCanvasHiddenAuthority(
          element,
          value.trim().toLowerCase() === 'none',
        );
      }
      // display intentionally stays outside this marker. Showing an imported
      // animated child must retain the Design canvas' settled opacity/transform
      // state; only an explicit edit of those motion properties owns them.
      if (authoredMotionProperties.has(normalizedProperty)) {
        const marker = 'data-html-editor-canvas-author-property-' + normalizedProperty;
        if (value) setLiveAttribute(element, marker);
        else removeLiveAttribute(element, marker);
        const hasAuthoredMotionProperty = Array.from(element.attributes).some(attribute => (
          attribute.name.startsWith('data-html-editor-canvas-author-property-')
        ));
        const hasAuthoredTransformProperty = Array.from(authoredTransformProperties).some(
          transformProperty => element.hasAttribute(
            'data-html-editor-canvas-author-property-' + transformProperty,
          ),
        );
        if (hasAuthoredTransformProperty) {
          setLiveAttribute(element, 'data-html-editor-canvas-author-transform');
        } else {
          removeLiveAttribute(element, 'data-html-editor-canvas-author-transform');
        }
        if (hasAuthoredMotionProperty) {
          setLiveAttribute(element, 'data-html-editor-canvas-author-visibility');
          removeLiveAttribute(element, 'data-html-editor-canvas-reveal');
          removeLiveAttribute(element, 'data-html-editor-canvas-reveal-motion');
        } else {
          removeLiveAttribute(element, 'data-html-editor-canvas-author-visibility');
        }
      }
      const currentValue = element.style.getPropertyValue(property);
      const currentPriority = element.style.getPropertyPriority(property);
      if (value) {
        if (
          currentValue.trim() !== value
          || currentPriority !== priority
        ) element.style.setProperty(property, value, priority);
      } else if (currentValue || currentPriority) {
        element.style.removeProperty(property);
      }
      const acceptedValue = element.style.getPropertyValue(property);
      const acceptedPriority = element.style.getPropertyPriority(property);
      const accepted = !(
        (value && !acceptedValue.trim())
        || (!value && acceptedValue.trim())
        || (value && acceptedPriority !== priority)
      );
      const authored = document.createElement('span');
      authored.setAttribute(
        'style',
        element.getAttribute('data-html-editor-original-style') || '',
      );
      if (value) authored.style.setProperty(property, value, priority);
      else authored.style.removeProperty(property);
      setLiveAttribute(
        element,
        'data-html-editor-original-style',
        authored.getAttribute('style') || '',
      );
      return accepted;
    };
    const applyLiveAttributePatchToElement = (element, patch) => {
      const name = patch.name;
      // A Design overlay projects temporary state/ARIA/hidden attributes onto
      // the same nodes that receive live authored patches. Update the saved
      // authored baseline before repainting the projection so deselection
      // restores the new edit, not the value from when selection began.
      const updateOverlayAuthoredBaseline = attributes => {
        const entry = attributes?.get(name);
        if (!entry) return;
        entry.existed = patch.value !== null;
        entry.value = patch.value || '';
      };
      updateOverlayAuthoredBaseline(editorRevealedOverlayAttributes.get(element));
      updateOverlayAuthoredBaseline(
        editorSuppressedOverlayAttributes.get(element)?.attributes,
      );
      const promotedName = 'data-html-editor-canvas-promoted-' + name;
      const generatedName = 'data-html-editor-canvas-generated-' + name;
      const runtimeAssetAttribute = (
        RUNTIME_ASSET_ATTRIBUTES.includes(name)
        && runtimeAttributeApplies(element, name)
      );
      const originalName = 'data-html-editor-original-' + name;
      if (
        designMediaPayload(element, name)
        && (runtimeAssetAttribute || name === 'autoplay')
      ) {
        // Live View State is applied after canonical media isolation. Preserve
        // the authored value in inert editor markers, but never let a later
        // patch restore a network-capable media attribute in Design.
        removeLiveAttribute(element, generatedName);
        removeLiveAttribute(element, name);
        if (patch.value === null) {
          removeLiveAttribute(element, promotedName);
          removeLiveAttribute(element, originalName);
        } else {
          // HTMLMediaElement.setAttribute is guarded above, so write editor
          // metadata through the captured native setter rather than mistaking
          // the marker itself for a media payload.
          nativeSetAttribute.call(element, promotedName, patch.value);
          nativeSetAttribute.call(element, originalName, patch.value);
        }
        return true;
      }
      if (designEmbedPayload(element, name)) {
        // A static Canvas embed must not oscillate between its inert srcdoc
        // and a View State patch that restores Vimeo/YouTube navigation. Keep
        // the editable authored attribute in the original marker while the
        // disposable iframe retains its static projection.
        if (patch.value === null) {
          removeLiveAttribute(element, promotedName);
          removeLiveAttribute(element, originalName);
        } else {
          if (runtimeAssetAttribute) setLiveAttribute(element, promotedName, patch.value);
          setLiveAttribute(element, originalName, patch.value);
        }
        if (name === 'srcdoc') {
          if (patch.value === null) setLiveAttribute(element, generatedName);
          else removeLiveAttribute(element, generatedName);
        }
        if (name !== 'srcdoc') removeLiveAttribute(element, name);
        return true;
      }
      if (runtimeAssetAttribute && patch.value !== null) {
        // The authored project path is the source of truth, while an opaque
        // srcdoc iframe must render an iframe-owned Blob URL. Keep both sides
        // explicitly instead of making View State and the asset rewriter fight
        // over the same DOM attribute forever.
        removeLiveAttribute(element, generatedName);
        setLiveAttribute(element, promotedName, patch.value);
        const applyResolvedValue = value => {
          if (!element.isConnected && !['IMG', 'VIDEO', 'AUDIO', 'SOURCE'].includes(element.tagName)) {
            return;
          }
          if (element.getAttribute(promotedName) !== patch.value) return;
          if (element.getAttribute(name) !== value) {
            nativeSetAttribute.call(element, name, value);
          }
          if (element.tagName === 'SOURCE') element.closest('video, audio')?.load?.();
        };
        if (name === 'srcset' || name === 'data-srcset' || name === 'data-lazy-srcset') {
          const resolvedValue = rewriteRuntimeSrcset(patch.value, element);
          applyResolvedValue(resolvedValue);
          const candidate = runtimeSrcsetCandidate(element, patch.value);
          if (candidate) {
            requestRuntimeAssetUrl(candidate.url, () => {
              if (element.getAttribute(promotedName) !== patch.value) return;
              applyResolvedValue(rewriteRuntimeSrcset(patch.value, element));
            });
          }
          return true;
        }
        const resolvedValue = runtimeAssetUrl(patch.value);
        if (resolvedValue) {
          applyResolvedValue(resolvedValue);
        } else if (!requestRuntimeAssetUrl(patch.value, applyResolvedValue)) {
          applyResolvedValue(patch.value);
        }
        // A requested project asset is accepted while its local Blob URL is in
        // flight. The callback above is tokened by the authored marker, so an
        // older response can never overwrite a newer View State snapshot.
        return true;
      }
      removeLiveAttribute(element, promotedName);
      removeLiveAttribute(element, generatedName);
      if (name === 'hidden') {
        const authorOwned = element.hasAttribute('data-html-editor-original-hidden');
        const runtimeOwned = element.hasAttribute('hidden') && !authorOwned;
        const dormantTemplate = runtimeOwned && isDormantPreviewTemplate(element);
        if (patch.value === null) {
          setCanvasHiddenAuthority(element, false);
          if (authorOwned || (runtimeOwned && !dormantTemplate)) {
            removeLiveAttribute(element, 'hidden');
            removeLiveAttribute(element, 'data-html-editor-original-hidden');
          }
          // A hidden runtime template is not the authored layer's visibility.
          // Keep it inert while visible clones sharing this path are revealed.
        } else {
          setCanvasHiddenAuthority(element, true);
          setLiveAttribute(element, 'hidden', patch.value);
          if (!dormantTemplate) {
            setLiveAttribute(element, 'data-html-editor-original-hidden');
          }
        }
        return true;
      }
      if (name === 'aria-hidden') {
        const authorOwned = element.hasAttribute('data-html-editor-original-aria-hidden');
        const runtimeOwned = element.getAttribute('aria-hidden') === 'true' && !authorOwned;
        const dormantTemplate = runtimeOwned && isDormantPreviewTemplate(element);
        if (patch.value === null) {
          if (authorOwned || (runtimeOwned && !dormantTemplate)) {
            removeLiveAttribute(element, 'aria-hidden');
            removeLiveAttribute(element, 'data-html-editor-original-aria-hidden');
          }
        } else {
          setLiveAttribute(element, 'aria-hidden', patch.value);
          if (!dormantTemplate) {
            setLiveAttribute(
              element,
              'data-html-editor-original-aria-hidden',
              patch.value,
            );
          }
        }
        return true;
      }
      if (patch.value === null) removeLiveAttribute(element, name);
      else setLiveAttribute(element, name, patch.value);
      return patch.value === null
        ? !element.hasAttribute(name)
        : element.getAttribute(name) === patch.value;
    };
    const applyLiveTextPatchToElement = (element, patch) => {
      if (!element.hasAttribute('data-html-editor-leaf')) return false;
      if (element.textContent !== patch.value) element.textContent = patch.value;
      return true;
    };
    const canvasViewBaselineForElement = element => {
      let baseline = canvasViewElementBaselines.get(element);
      if (baseline) {
        // A runtime may temporarily detach and later reinsert the same node.
        // The strong set is pruned every replay, so restore tracking must be
        // reacquired when that node becomes part of the live canvas again.
        canvasViewTouchedElements.add(element);
        return baseline;
      }
      baseline = {
        styles: new Map(),
        attributes: new Map(),
        textCaptured: false,
        text: '',
        originalStyleCaptured: false,
        originalStyleExisted: false,
        originalStyle: '',
        motionMarkers: null,
      };
      canvasViewElementBaselines.set(element, baseline);
      canvasViewTouchedElements.add(element);
      return baseline;
    };
    const captureCanvasViewStyleBaseline = (element, property) => {
      if (!element?.style) return;
      const baseline = canvasViewBaselineForElement(element);
      const normalized = normalizeRuntimeStyleProperty(property);
      if (!normalized) return;
      if (!baseline.styles.has(normalized)) {
        baseline.styles.set(normalized, {
          value: element.style.getPropertyValue(normalized),
          priority: element.style.getPropertyPriority(normalized),
        });
      }
      if (!baseline.originalStyleCaptured) {
        baseline.originalStyleCaptured = true;
        baseline.originalStyleExisted = element.hasAttribute('data-html-editor-original-style');
        baseline.originalStyle = element.getAttribute('data-html-editor-original-style') || '';
      }
      if (baseline.motionMarkers === null) {
        baseline.motionMarkers = Array.from(element.attributes)
          .filter(attribute => (
            attribute.name.startsWith('data-html-editor-canvas-author-')
            || attribute.name === 'data-html-editor-canvas-reveal'
            || attribute.name === 'data-html-editor-canvas-reveal-motion'
            || attribute.name === CANVAS_HIDDEN_MARKER
          ))
          .map(attribute => [attribute.name, attribute.value]);
      }
    };
    const canvasViewRelatedAttributeNames = name => {
      const normalized = String(name || '').trim().toLowerCase();
      const names = new Set([
        normalized,
        'data-html-editor-canvas-promoted-' + normalized,
        'data-html-editor-canvas-generated-' + normalized,
      ]);
      if (normalized === 'hidden') {
        names.add('data-html-editor-original-hidden');
        names.add(CANVAS_HIDDEN_MARKER);
      }
      if (normalized === 'aria-hidden') names.add('data-html-editor-original-aria-hidden');
      return names;
    };
    const captureCanvasViewAttributeBaseline = (element, name) => {
      const baseline = canvasViewBaselineForElement(element);
      canvasViewRelatedAttributeNames(name).forEach(attributeName => {
        if (baseline.attributes.has(attributeName)) return;
        baseline.attributes.set(attributeName, {
          existed: element.hasAttribute(attributeName),
          value: element.getAttribute(attributeName) || '',
        });
      });
    };
    const captureCanvasViewTextBaseline = element => {
      const baseline = canvasViewBaselineForElement(element);
      if (baseline.textCaptured) return;
      baseline.textCaptured = true;
      baseline.text = element.textContent || '';
    };
    const applyCanvasViewStylePatchToElement = (element, patch) => {
      captureCanvasViewStyleBaseline(element, patch.property);
      return applyLiveStylePatchToElement(element, patch);
    };
    const applyCanvasViewAttributePatchToElement = (element, patch) => {
      captureCanvasViewAttributeBaseline(element, patch.name);
      mirrorCmsAttributeToCollectionOriginal(element, patch);
      const applied = applyLiveAttributePatchToElement(element, patch);
      if (
        applied
        && (
          patch.name === 'data-kodety-bind'
          || String(patch.name || '').startsWith('data-kodety-bind-')
        )
      ) refreshCmsBindingElement(element);
      return applied;
    };
    const applyCanvasViewTextPatchToElement = (element, patch) => {
      captureCanvasViewTextBaseline(element);
      return applyLiveTextPatchToElement(element, patch);
    };
    const restoreCanvasViewElement = element => {
      const baseline = canvasViewElementBaselines.get(element);
      if (!baseline) return;
      baseline.styles.forEach((entry, property) => {
        if (entry.value) {
          element.style.setProperty(property, entry.value, entry.priority || '');
        } else {
          element.style.removeProperty(property);
        }
      });
      if (baseline.originalStyleCaptured) {
        if (baseline.originalStyleExisted) {
          setLiveAttribute(element, 'data-html-editor-original-style', baseline.originalStyle);
        } else {
          removeLiveAttribute(element, 'data-html-editor-original-style');
        }
      }
      if (baseline.motionMarkers !== null) {
        Array.from(element.attributes).forEach(attribute => {
          if (
            attribute.name.startsWith('data-html-editor-canvas-author-')
            || attribute.name === 'data-html-editor-canvas-reveal'
            || attribute.name === 'data-html-editor-canvas-reveal-motion'
            || attribute.name === CANVAS_HIDDEN_MARKER
          ) removeLiveAttribute(element, attribute.name);
        });
        baseline.motionMarkers.forEach(([name, value]) => {
          setLiveAttribute(element, name, value);
        });
      }
      baseline.attributes.forEach((entry, name) => {
        if (entry.existed) setLiveAttribute(element, name, entry.value);
        else removeLiveAttribute(element, name);
      });
      if (baseline.textCaptured && element.textContent !== baseline.text) {
        element.textContent = baseline.text;
      }
      canvasViewElementBaselines.delete(element);
      canvasViewTouchedElements.delete(element);
    };
    const pruneDisconnectedCanvasViewElements = () => {
      canvasViewTouchedElements.forEach(element => {
        if (element.isConnected) return;
        // Restore while detached so a later reinsertion starts from authored
        // DOM, then captures a fresh baseline before the current snapshot is
        // projected onto it again.
        restoreCanvasViewElement(element);
      });
    };
    const applyCanvasViewStateToElement = element => {
      if (!(element instanceof Element) || !element.isConnected) return;
      const path = element.getAttribute('data-html-editor-path') || '';
      if (!path && path !== '') return;
      if (!interactionPreviewOwnsStyles(element)) {
        canvasViewPathStyles.get(path)?.forEach(patch => {
          applyCanvasViewStylePatchToElement(element, patch);
        });
      }
      const attributePatches = canvasViewPathAttributes.get(path);
      // Binding configuration must land before authored fallback targets so
      // the same transaction can establish the correct ownership boundary.
      attributePatches?.forEach(patch => {
        if (isCmsRuntimeAttribute(patch.name)) {
          applyCanvasViewAttributePatchToElement(element, patch);
        }
      });
      attributePatches?.forEach(patch => {
        if (
          !isCmsRuntimeAttribute(patch.name)
          && !cmsBindingOwnsTarget(element, patch.name)
        ) {
          applyCanvasViewAttributePatchToElement(element, patch);
        }
      });
      const textPatch = canvasViewPathTexts.get(path);
      if (textPatch && !cmsBindingOwnsTarget(element, 'content')) {
        applyCanvasViewTextPatchToElement(element, textPatch);
      }
      applyCanvasRuleOwnershipMarkersToElement(element);
    };
    const rememberPathPatch = (journal, path, key, patch) => {
      const entries = journal.get(path) || new Map();
      entries.set(key, { ...patch });
      journal.set(path, entries);
    };
    const forgetPathPatch = (journal, path, key) => {
      const entries = journal.get(path);
      if (!entries) return;
      entries.delete(key);
      if (!entries.size) journal.delete(path);
    };
    const rebindEditorSelection = () => {
      if (!selected || selected.isConnected) return;
      const path = selected.getAttribute?.('data-html-editor-path') || '';
      const previewItemId = previewItemIdForElement(selected);
      const replacement = !path
        ? null
        : previewItemId
          ? editorVisualElements(path).find(element => (
            previewItemIdForElement(element) === previewItemId
          )) || null
          : preferredEditorPathElement(path);
      if (!replacement) return;
      setLiveAttribute(replacement, 'data-html-editor-selected');
      selected = replacement;
      const sequence = ++selectionSnapshotSequence;
      const selectedElements = Array.from(
        document.querySelectorAll('[data-html-editor-selected]'),
      );
      postEditorMessage({
        type: 'html-editor-selection',
        breakpointId: canvasViewBreakpointId || 'base',
        payload: snapshotIdentity(selected),
        selectedPaths: selectedElements
          .map(item => item.dataset.htmlEditorPath)
          .filter(pathValue => typeof pathValue === 'string'),
        revision: appliedEditorRevision,
        selectionSequence: sequence,
        detail: 'identity',
      });
      pendingSelectionDetail = { element: selected, sequence };
      schedulePendingSelectionDetail();
      refreshDirectControls();
    };
    // Runtime libraries may replace an authored subtree after the source DOM
    // was annotated above. Recreate only missing paths, top-down, using the
    // exact parent-path + live child-index contract of the initial annotator.
    // Existing paths are authoritative and are never rewritten.
    const isRuntimeEditorAnnotatableElement = element => {
      if (!(element instanceof Element)) return false;
      if (element.closest('[data-html-editor-agent-activity-root]')) return false;
      const tag = element.tagName.toLowerCase();
      const technicalId = String(element.id || '').toLowerCase();
      if (['script', 'style', 'link', 'meta', 'noscript', 'template'].includes(tag)) return false;
      if (
        technicalId === 'svg-templates'
        || technicalId === 'template-overlay'
        || technicalId.startsWith('__kodety-')
        || element.hasAttribute('data-framer-svg-template')
      ) return false;
      return true;
    };
    const annotateEditorRuntimeSubtree = root => {
      if (!(root instanceof Element)) return 0;
      let annotated = 0;
      const visit = element => {
        if (!isRuntimeEditorAnnotatableElement(element)) return;
        // The authored wrapper is the complete editable Code Component layer.
        // React descendants do not have a source path in the page document and
        // must stay opaque to selection, inline editing and structural tools.
        if (element.parentElement?.closest?.('[data-coday-code-instance]')) return;
        // Authored leaves stay leaves even when GSAP/SplitText (or another
        // runtime) injects spans below them. Those implementation nodes must
        // never become editable source paths.
        if (element.parentElement?.closest?.('[data-html-editor-leaf]')) return;

        let path = element.getAttribute('data-html-editor-path');
        if (path === null) {
          const parent = element.parentElement;
          const parentPath = parent?.getAttribute?.('data-html-editor-path');
          if (parent && parentPath !== null) {
            const index = Array.prototype.indexOf.call(parent.children, element);
            if (index >= 0) {
              path = parentPath ? parentPath + '/' + index : String(index);
              setLiveAttribute(element, 'data-html-editor-path', path);
              if (parent.hasAttribute('data-html-editor-locked')) {
                setLiveAttribute(element, 'data-html-editor-locked');
              }
              if (inspectionEnabled && (
                element.classList.contains('ssr-variant')
                || parent.closest('[data-html-editor-ssr-variant], .ssr-variant')
              )) {
                setLiveAttribute(element, 'data-html-editor-ssr-variant');
                if (element instanceof HTMLElement) {
                  element.style.pointerEvents = 'auto';
                  if (element.children.length === 0 && (element.textContent || '').trim()) {
                    element.style.userSelect = 'text';
                  }
                }
              }
              if (element.children.length === 0) {
                setLiveAttribute(element, 'data-html-editor-leaf');
              }
              annotated += 1;
            }
          }
        }

        // A pathless studio shell can still contain already-annotated authored
        // descendants, so traverse it. SVG and source leaves intentionally keep
        // their runtime internals opaque, matching the initial annotation pass.
        if (element.hasAttribute('data-html-editor-leaf')) return;
        if (element.tagName.toLowerCase() === 'svg') return;
        Array.from(element.children).forEach(visit);
      };
      visit(root);
      return annotated;
    };
    window.__KODETY_ANNOTATE_EDITOR_SUBTREE__ = annotateEditorRuntimeSubtree;
    // Catch replacements performed synchronously by authored scripts before
    // this bridge and its MutationObserver were installed.
    annotateEditorRuntimeSubtree(document.body);
    const reapplyEditorLiveState = (
      root,
      includeDescendants = true,
      shouldRebindSelection = true,
    ) => {
      const elements = [];
      if (root?.matches?.('[data-html-editor-path]')) elements.push(root);
      if (includeDescendants) {
        root?.querySelectorAll?.('[data-html-editor-path]').forEach(element => {
          elements.push(element);
        });
      }
      elements.forEach(element => {
        const path = element.getAttribute('data-html-editor-path') || '';
        if (!interactionPreviewOwnsStyles(element)) {
          committedPathStyles.get(path)?.forEach(patch => {
            applyLiveStylePatchToElement(element, patch);
          });
          transientPathStyles.get(path)?.forEach(patch => {
            applyLiveStylePatchToElement(element, patch);
          });
        }
        committedPathAttributes.get(path)?.forEach(patch => {
          if (!cmsBindingOwnsTarget(element, patch.name)) {
            applyLiveAttributePatchToElement(element, patch);
          }
        });
        const textPatch = committedPathTexts.get(path);
        if (textPatch && !cmsBindingOwnsTarget(element, 'content')) {
          applyLiveTextPatchToElement(element, textPatch);
        }
        // V2 is the editor's complete latest snapshot and therefore always
        // paints after the compatibility journal.
        applyCanvasViewStateToElement(element);
      });
      if (
        canvasViewPropertyOwnerships.size
        || transientPropertyOwnerships.size
      ) {
        if (root instanceof Element && !root.hasAttribute('data-html-editor-path')) {
          applyCanvasRuleOwnershipMarkersToElement(root);
        }
        if (includeDescendants) {
          root?.querySelectorAll?.(':not([data-html-editor-path])').forEach(element => {
            applyCanvasRuleOwnershipMarkersToElement(element);
          });
        }
      }
      if (shouldRebindSelection) rebindEditorSelection();
    };
    window.__KODETY_REBIND_EDITOR_SELECTION__ = rebindEditorSelection;
    window.__KODETY_REAPPLY_EDITOR_LIVE_STATE__ = reapplyEditorLiveState;
    // The editor owns every atom it has committed, not only visibility. Site
    // runtimes also mutate the DOM continuously, though, so observing a change
    // must not mean repainting an unrelated authored subtree. Attribute/text
    // changes replay one exact path; only newly inserted subtrees receive a
    // descendant pass.
    const pendingCommittedStateRoots = new Set();
    const pendingCommittedStateSubtrees = new Set();
    let pendingCanvasViewDocumentReplay = false;
    let committedStateReplayFrame = 0;
    const hasCommittedElementState = () => (
      committedPathStyles.size
      || committedPathAttributes.size
      || committedPathTexts.size
      || transientPathStyles.size
      || canvasViewPathStyles.size
      || canvasViewPathAttributes.size
      || canvasViewPathTexts.size
      || canvasViewPropertyOwnerships.size
      || transientPropertyOwnerships.size
    );
    const hasCommittedCanvasState = () => (
      hasCommittedElementState()
      || canvasViewStylesheets.size
      || canvasViewDesignTokenCssText !== undefined
      || canvasViewInteractionPending
    );
    const pathHasCommittedStyleAtom = path => Boolean(
      committedPathStyles.get(path)?.size
      || transientPathStyles.get(path)?.size
      || canvasViewPathStyles.get(path)?.size
    );
    const pathHasCommittedTextAtom = path => Boolean(
      committedPathTexts.has(path)
      || canvasViewPathTexts.has(path)
    );
    const pathHasCommittedAttributeAtom = path => Boolean(
      committedPathAttributes.get(path)?.size
      || canvasViewPathAttributes.get(path)?.size
    );
    const pathHasCommittedElementAtom = path => (
      pathHasCommittedStyleAtom(path)
      || pathHasCommittedAttributeAtom(path)
      || pathHasCommittedTextAtom(path)
    );
    const subtreeHasCommittedElementAtom = root => {
      if (!(root instanceof Element)) return false;
      if (
        canvasViewPropertyOwnerships.size
        || transientPropertyOwnerships.size
      ) return true;
      const rootPath = root.getAttribute('data-html-editor-path');
      if (rootPath !== null && pathHasCommittedElementAtom(rootPath)) return true;
      return Array.from(root.querySelectorAll?.('[data-html-editor-path]') || [])
        .some(element => {
          const path = element.getAttribute('data-html-editor-path');
          return path !== null && pathHasCommittedElementAtom(path);
        });
    };
    const attributeEntriesOwnMutation = (entries, attributeName) => {
      if (!entries?.size) return false;
      const normalizedAttribute = String(attributeName || '').trim().toLowerCase();
      let owned = false;
      entries.forEach(patch => {
        if (owned) return;
        const names = canvasViewRelatedAttributeNames(patch.name);
        if (names.has(normalizedAttribute)) owned = true;
      });
      return owned;
    };
    const pathOwnsCommittedAttributeMutation = (path, attributeName) => (
      attributeEntriesOwnMutation(
        committedPathAttributes.get(path),
        attributeName,
      )
      || attributeEntriesOwnMutation(
        canvasViewPathAttributes.get(path),
        attributeName,
      )
    );
    const isStyleImplementationAttribute = attributeName => {
      const normalized = String(attributeName || '').trim().toLowerCase();
      return (
        normalized === 'style'
        || normalized === 'data-html-editor-original-style'
        || normalized === 'data-html-editor-canvas-reveal'
        || normalized === 'data-html-editor-canvas-reveal-motion'
        || normalized === CANVAS_HIDDEN_MARKER
        || normalized.startsWith('data-html-editor-canvas-author-')
        || normalized.startsWith('data-html-editor-canvas-rule-')
      );
    };
    const canvasViewDocumentStyleForElement = element => {
      if (!(element instanceof Element)) return null;
      const style = element.matches?.(
        'style[data-editor-source], style[data-kodety-design-tokens]',
      )
        ? element
        : element.closest?.(
          'style[data-editor-source], style[data-kodety-design-tokens]',
        );
      if (!(style instanceof Element)) return null;
      if (style.hasAttribute('data-kodety-design-tokens')) {
        return canvasViewDesignTokenCssText !== undefined ? style : null;
      }
      const path = style.getAttribute('data-editor-source') || '';
      return canvasViewStylesheets.has(path) ? style : null;
    };
    const subtreeHasCanvasViewDocumentStyle = root => {
      if (!(root instanceof Element)) return false;
      if (canvasViewDocumentStyleForElement(root)) return true;
      return Array.from(root.querySelectorAll?.(
        'style[data-editor-source], style[data-kodety-design-tokens]',
      ) || []).some(style => Boolean(canvasViewDocumentStyleForElement(style)));
    };
    const cmsConfigurationSignature = (root, includeDescendants) => {
      if (!(root instanceof Element)) return '';
      const elements = [root];
      if (includeDescendants) {
        root.querySelectorAll?.('*').forEach(element => elements.push(element));
      }
      return elements.flatMap(element => Array.from(element.attributes)
        .filter(attribute => isCmsRuntimeAttribute(attribute.name))
        .map(attribute => [
          element.getAttribute('data-html-editor-path') || '',
          attribute.name,
          attribute.value,
        ].join('\\u0000')))
        .sort()
        .join('\\u0001');
    };
    const queueCommittedStateReplayFrame = () => {
      if (committedStateReplayFrame) return;
      committedStateReplayFrame = requestAnimationFrame(() => {
        committedStateReplayFrame = 0;
        pruneDisconnectedCanvasViewElements();
        const queuedSubtreeRoots = Array.from(pendingCommittedStateSubtrees);
        const queuedSubtreeRootSet = new Set(queuedSubtreeRoots);
        const subtreeRoots = queuedSubtreeRoots.filter(rootElement => {
          let ancestor = rootElement.parentElement;
          while (ancestor) {
            if (queuedSubtreeRootSet.has(ancestor)) return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        });
        const subtreeRootSet = new Set(subtreeRoots);
        const roots = Array.from(pendingCommittedStateRoots);
        const replayDocument = pendingCanvasViewDocumentReplay;
        pendingCommittedStateSubtrees.clear();
        pendingCommittedStateRoots.clear();
        pendingCanvasViewDocumentReplay = false;
        let replayedElementState = false;
        const replayedCmsPaths = new Set();
        subtreeRoots.forEach(rootElement => {
          if (!rootElement.isConnected) return;
          const cmsBefore = cmsConfigurationSignature(rootElement, true);
          replayedElementState = true;
          reapplyEditorLiveState(rootElement, true, false);
          if (cmsBefore !== cmsConfigurationSignature(rootElement, true)) {
            cmsViewStatePathsInSubtree(rootElement).forEach(path => {
              replayedCmsPaths.add(path);
            });
          }
        });
        roots.forEach(rootElement => {
          if (!rootElement.isConnected) return;
          let ancestor = rootElement.parentElement;
          while (ancestor && !subtreeRootSet.has(ancestor)) {
            ancestor = ancestor.parentElement;
          }
          if (ancestor) return;
          const cmsBefore = cmsConfigurationSignature(rootElement, false);
          replayedElementState = true;
          reapplyEditorLiveState(rootElement, false, false);
          if (cmsBefore !== cmsConfigurationSignature(rootElement, false)) {
            cmsViewStatePathsInSubtree(rootElement).forEach(path => {
              replayedCmsPaths.add(path);
            });
          }
        });
        if (replayedElementState) rebindEditorSelection();
        // Runtime frameworks can recreate authored nodes with stale binding
        // configuration. The replay above installs/removes the current View
        // State atoms; rematerialize those exact paths after that projection.
        if (replayedCmsPaths.size) {
          scheduleCmsViewStateRefresh(Array.from(replayedCmsPaths));
        }
        if (replayDocument || canvasViewInteractionPending) {
          reapplyCanvasViewDocumentState();
        }
        pruneDisconnectedCanvasViewElements();
      });
    };
    const scheduleCommittedStateReplay = (root, includeDescendants = false) => {
      if (!(root instanceof Element)) return;
      if (includeDescendants) {
        pendingCommittedStateRoots.delete(root);
        pendingCommittedStateSubtrees.add(root);
      } else if (!pendingCommittedStateSubtrees.has(root)) {
        pendingCommittedStateRoots.add(root);
      }
      queueCommittedStateReplayFrame();
    };
    const scheduleCanvasViewDocumentReplay = () => {
      pendingCanvasViewDocumentReplay = true;
      queueCommittedStateReplayFrame();
    };
    const committedStateObserver = new MutationObserver(mutations => {
      const hasCommittedState = Boolean(hasCommittedCanvasState());
      const hasCommittedElements = Boolean(hasCommittedElementState());
      let removedNodesObserved = false;
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          const element = mutation.target;
          if (!(element instanceof Element)) return;
          const attributeName = mutation.attributeName || '';
          if (
            isStyleImplementationAttribute(attributeName)
            && interactionPreviewOwnsStyles(element)
          ) return;
          if (
            inspectionEnabled
            && (
              editorRevealedOverlayAttributes.get(element)?.has(attributeName)
              || editorSuppressedOverlayAttributes.get(element)?.attributes.has(attributeName)
            )
          ) return;
          if (
            attributeName === 'data-html-editor-path'
            && !element.hasAttribute('data-html-editor-path')
          ) {
            annotateEditorRuntimeSubtree(element);
          }
          if (!hasCommittedState) return;
          const path = element.getAttribute('data-html-editor-path');
          if (path === null) return;
          if (
            (
              isStyleImplementationAttribute(attributeName)
              && (
                pathHasCommittedStyleAtom(path)
                || canvasRuleOwnedElements.has(element)
              )
            )
            || pathOwnsCommittedAttributeMutation(path, attributeName)
          ) {
            scheduleCommittedStateReplay(element, false);
          }
          return;
        }
        if (mutation.type === 'characterData') {
          const element = mutation.target.parentElement;
          if (!(element instanceof Element) || !hasCommittedState) return;
          if (canvasViewDocumentStyleForElement(element)) {
            scheduleCanvasViewDocumentReplay();
            return;
          }
          const path = element.getAttribute('data-html-editor-path');
          if (path !== null && pathHasCommittedTextAtom(path)) {
            scheduleCommittedStateReplay(element, false);
          }
          return;
        }
        if (mutation.removedNodes.length) removedNodesObserved = true;
        const childListTarget = mutation.target;
        if (childListTarget instanceof Element && hasCommittedState) {
          if (canvasViewDocumentStyleForElement(childListTarget)) {
            // style.textContent = '' may be a removal-only mutation.
            scheduleCanvasViewDocumentReplay();
          }
          const targetPath = childListTarget.getAttribute('data-html-editor-path');
          if (targetPath !== null && pathHasCommittedTextAtom(targetPath)) {
            // SplitText/React may replace a leaf's text node with implementation
            // spans. Repaint only that exact leaf, never its surrounding tree.
            scheduleCommittedStateReplay(childListTarget, false);
          }
        }
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            // Exactly one annotation pass per inserted subtree. The replay
            // below only applies state and never annotates it a second time.
            annotateEditorRuntimeSubtree(node);
            if (!hasCommittedState) return;
            if (subtreeHasCanvasViewDocumentStyle(node)) {
              scheduleCanvasViewDocumentReplay();
            }
            if (hasCommittedElements && subtreeHasCommittedElementAtom(node)) {
              scheduleCommittedStateReplay(node, true);
            } else if (canvasViewInteractionPending) {
              scheduleCanvasViewDocumentReplay();
            }
            return;
          }
          const element = node.parentElement;
          if (!(element instanceof Element) || !hasCommittedState) return;
          if (canvasViewDocumentStyleForElement(element)) {
            scheduleCanvasViewDocumentReplay();
            return;
          }
          const path = element.getAttribute('data-html-editor-path');
          if (path !== null && pathHasCommittedTextAtom(path)) {
            scheduleCommittedStateReplay(element, false);
          }
        });
      });
      // Detached nodes must not be retained by the strong restore set. Queue a
      // maintenance frame even when a removal has no state-bearing additions.
      if (removedNodesObserved && canvasViewTouchedElements.size) {
        queueCommittedStateReplayFrame();
      }
    });
    committedStateObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const beginPreviewPropertyHandoff = (cssPath, releases) => {
      if (typeof cssPath !== 'string' || !Array.isArray(releases)) return null;
      const previewStyle = Array.from(document.querySelectorAll('style[data-editor-source]'))
        .find(candidate => candidate.getAttribute('data-editor-source') === cssPath);
      const changes = [];
      const committed = [];
      releases.forEach(release => {
        if (
          !release
          || typeof release.property !== 'string'
          || !Number.isSafeInteger(release.version)
        ) return;
        const property = normalizeRuntimeStyleProperty(release.property);
        if (!property || previewPropertyVersions.get(property) !== release.version) return;
        committed.push({ property, version: release.version });
        Array.from(previewStyle?.sheet?.cssRules || []).forEach(rule => {
          if (!rule.style) return;
          const value = rule.style.getPropertyValue(property);
          if (!value) return;
          changes.push({
            rule,
            property,
            value,
            priority: rule.style.getPropertyPriority(property),
          });
          rule.style.removeProperty(property);
        });
      });
      return {
        commit: () => {
          committed.forEach(({ property, version }) => {
            if (previewPropertyVersions.get(property) === version) {
              previewPropertyVersions.delete(property);
            }
          });
        },
        rollback: () => {
          changes.forEach(({ rule, property, value, priority }) => {
            rule.style.setProperty(property, value, priority);
          });
        },
      };
    };
    const scheduleLiveStylePaintRefresh = () => {
      if (liveStylePaintRefreshScheduled) return;
      liveStylePaintRefreshScheduled = true;
      const run = () => {
        liveStylePaintRefreshScheduled = false;
        window.__KODETY_REFRESH_EDITOR_PAINT_CHUNKS__?.();
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 240 });
      } else {
        setTimeout(run, 80);
      }
    };
    const isCmsSourceNode = node => {
      if (!(node instanceof Element)) return false;
      if (node.matches('[data-kodety-preview-clone], [data-kodety-preview-item-id]') || node.closest('[data-kodety-preview-clone], [data-kodety-preview-item-id]')) return false;
      return node.matches('[data-kodety-collection], ' + cmsSelector) || Boolean(node.querySelector('[data-kodety-collection], ' + cmsSelector));
    };
    const cmsViewStatePathsInSubtree = node => {
      if (!(node instanceof Element)) return [];
      const elements = [];
      if (node.matches('[data-html-editor-path]')) elements.push(node);
      node.querySelectorAll?.('[data-html-editor-path]').forEach(element => elements.push(element));
      return Array.from(new Set(elements.flatMap(element => {
        const path = element.getAttribute('data-html-editor-path');
        if (path === null) return [];
        const entries = [
          ...(committedPathAttributes.get(path)?.values() || []),
          ...(canvasViewPathAttributes.get(path)?.values() || []),
        ];
        return entries.some(patch => isCmsRuntimeAttribute(patch.name)) ? [path] : [];
      })));
    };
    const cmsRuntimeObserver = new MutationObserver(mutations => {
      if (applyingCmsPreview || performance.now() < cmsMutationsSuppressedUntil || !lastCmsPayload) return;
      let replacedCmsDom = false;
      const viewStatePaths = new Set();
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          if (isCmsSourceNode(node)) replacedCmsDom = true;
          cmsViewStatePathsInSubtree(node).forEach(path => viewStatePaths.add(path));
        });
      });
      if (viewStatePaths.size) scheduleCmsViewStateRefresh(Array.from(viewStatePaths));
      else if (replacedCmsDom) scheduleCmsRefresh(0);
    });
    cmsRuntimeObserver.observe(document.documentElement, { subtree: true, childList: true });
    addEventListener('load', () => {
      if (cmsInitialHydrated) return;
      [0, 32, 100, 250, 600].forEach(delay => setTimeout(() => applyCmsPreview(lastCmsPayload), delay));
    }, { once: true });
    let pinnedInteractionPreview = null;
    const interactionControlIds = payload => Array.from(new Set(
      (
        Array.isArray(payload?.interactionIds)
          ? payload.interactionIds
          : [payload?.interactionId]
      ).flatMap(value => (
        typeof value === 'string' && value.trim()
          ? [value.trim()]
          : []
      )),
    )).slice(0, 512);
    let pendingInteractionControl = null;
    let interactionControlRetryTimer = 0;
    let interactionControlRetryCount = 0;
    const appliedInteractionControlCommandIds = new Set();
    const appliedTimelineControlSequences = new Set();
    let latestObservedTimelineControlSequence = 0;
    let queuedInteractionSeek = null;
    let queuedInteractionSeekFrame = 0;
    const acknowledgeInteractionControl = payload => {
      const timelineSequence = payload?.__kodetyTimelineSequence;
      if (
        !Number.isSafeInteger(timelineSequence)
        || timelineSequence < 1
      ) return;
      appliedTimelineControlSequences.add(timelineSequence);
      if (appliedTimelineControlSequences.size > 512) {
        appliedTimelineControlSequences.delete(
          appliedTimelineControlSequences.values().next().value,
        );
      }
      postEditorMessage({
        type: 'html-editor-interaction-control-applied',
        timelineSequence,
      });
    };
    const rememberAppliedInteractionControl = payload => {
      const commandId = typeof payload?.__kodetyCommandId === 'string'
        ? payload.__kodetyCommandId
        : '';
      if (!commandId) return;
      appliedInteractionControlCommandIds.add(commandId);
      if (appliedInteractionControlCommandIds.size > 512) {
        appliedInteractionControlCommandIds.delete(
          appliedInteractionControlCommandIds.values().next().value,
        );
      }
    };
    const clearInteractionControlRetry = () => {
      if (interactionControlRetryTimer) clearTimeout(interactionControlRetryTimer);
      interactionControlRetryTimer = 0;
      interactionControlRetryCount = 0;
      pendingInteractionControl = null;
    };
    const applyInteractionControl = payload => {
      const action = payload?.action;
      const interactionIds = interactionControlIds(payload);
      if (!interactionIds.length || typeof action !== 'string') return true;
      prioritizeInteractionControl(action);
      const time = Number.isFinite(payload.time)
        ? Math.max(0, payload.time)
        : null;
      try {
        // The grouped controller is also the atomic single-interaction path.
        // It accepts the requested playback time, so a Play command remains
        // complete even when an earlier Seek was coalesced during iframe setup.
        if (window.__kodetyInteractions?.control?.(
          interactionIds,
          action,
          time,
        )) return true;
        if (interactionIds.length > 1) return false;
        const interaction = window.__kodetyInteractions?.get?.(
          interactionIds[0],
        );
        if (action === 'release') {
          if (interaction?.release) interaction.release();
          else window.__KODETY_END_EDITOR_INTERACTION_PREVIEW__?.();
          return true;
        }
        if (!interaction) return false;
        if (action === 'restart') interaction.restart();
        else if (action === 'play') {
          if (time !== null) (interaction.seek || interaction.pause)?.(time);
          interaction.play();
        } else if (action === 'reverse') {
          if (time !== null) (interaction.seek || interaction.pause)?.(time);
          interaction.reverse();
        } else if (action === 'reset') interaction.reset?.();
        else if (action === 'pause') interaction.pause(time === null ? undefined : time);
        else if (action === 'seek') (interaction.seek || interaction.pause)(time ?? 0);
        else return true;
        return true;
      } catch {
        return false;
      }
    };
    const scheduleInteractionControlRetry = () => {
      if (
        !pendingInteractionControl
        || interactionControlRetryTimer
        || interactionControlRetryCount >= 120
      ) return;
      interactionControlRetryCount += 1;
      const expectedCommandId = pendingInteractionControl.commandId;
      interactionControlRetryTimer = setTimeout(() => {
        interactionControlRetryTimer = 0;
        if (
          !pendingInteractionControl
          || pendingInteractionControl.commandId !== expectedCommandId
        ) return;
        if (applyInteractionControl(pendingInteractionControl.payload)) {
          rememberAppliedInteractionControl(pendingInteractionControl.payload);
          acknowledgeInteractionControl(pendingInteractionControl.payload);
          clearInteractionControlRetry();
          return;
        }
        scheduleInteractionControlRetry();
      }, Math.min(500, Math.max(16, interactionControlRetryCount * 16)));
    };
    const queueInteractionControlRetry = payload => {
      if (interactionControlRetryTimer) clearTimeout(interactionControlRetryTimer);
      interactionControlRetryTimer = 0;
      interactionControlRetryCount = 0;
      pendingInteractionControl = {
        commandId: typeof payload?.__kodetyCommandId === 'string'
          ? payload.__kodetyCommandId
          : 'interaction-control:' + performance.now(),
        payload,
      };
      scheduleInteractionControlRetry();
    };
    const clearQueuedInteractionSeek = (acknowledgeSuperseded = false) => {
      const superseded = queuedInteractionSeek;
      queuedInteractionSeek = null;
      if (queuedInteractionSeekFrame) cancelAnimationFrame(queuedInteractionSeekFrame);
      queuedInteractionSeekFrame = 0;
      if (acknowledgeSuperseded && superseded) acknowledgeInteractionControl(superseded);
    };
    const flushQueuedInteractionSeek = () => {
      queuedInteractionSeekFrame = 0;
      const payload = queuedInteractionSeek;
      queuedInteractionSeek = null;
      if (!payload) return;
      const timelineSequence = payload?.__kodetyTimelineSequence;
      if (
        Number.isSafeInteger(timelineSequence)
        && timelineSequence < latestObservedTimelineControlSequence
      ) {
        acknowledgeInteractionControl(payload);
        return;
      }
      if (applyInteractionControl(payload)) {
        rememberAppliedInteractionControl(payload);
        acknowledgeInteractionControl(payload);
        clearInteractionControlRetry();
      } else queueInteractionControlRetry(payload);
    };
    const queueInteractionSeek = payload => {
      if (queuedInteractionSeek) {
        const queuedSequence = queuedInteractionSeek?.__kodetyTimelineSequence;
        const nextSequence = payload?.__kodetyTimelineSequence;
        if (
          Number.isSafeInteger(queuedSequence)
          && Number.isSafeInteger(nextSequence)
          && queuedSequence < nextSequence
        ) acknowledgeInteractionControl(queuedInteractionSeek);
      }
      queuedInteractionSeek = payload;
      if (!queuedInteractionSeekFrame) {
        // Use the private editor clock captured before authored animation code
        // can freeze/replace rAF. A drag may emit hundreds of samples, but only
        // the newest sample for this paint can possibly be visible.
        queuedInteractionSeekFrame = requestAnimationFrame(flushQueuedInteractionSeek);
      }
    };
    const replayPinnedInteractionPreview = () => {
      if (!pinnedInteractionPreview) return;
      const payload = {
        type: 'html-editor-interaction-control',
        interactionIds: pinnedInteractionPreview.interactionIds,
        action: 'seek',
        time: pinnedInteractionPreview.time,
      };
      if (!applyInteractionControl(payload)) queueInteractionControlRetry(payload);
    };
    addEventListener('pagehide', () => {
      clearInteractionControlRetry();
      clearQueuedInteractionSeek();
    }, { once: true });
    const scheduleCanvasViewInteractionRetry = () => {
      if (!canvasViewInteractionPending || canvasViewInteractionRetryTimer) return;
      const delay = canvasViewInteractionRetryDelay;
      canvasViewInteractionRetryTimer = setTimeout(() => {
        canvasViewInteractionRetryTimer = 0;
        applyPendingCanvasViewInteraction();
      }, delay);
      canvasViewInteractionRetryDelay = Math.min(500, Math.max(16, delay * 2));
    };
    const applyPendingCanvasViewInteraction = () => {
      if (!canvasViewInteractionPending) return true;
      const interactionDocument = canvasViewInteractionDocument
        || { version: 2, interactions: [] };
      let applied = false;
      try {
        applied = window.__kodetyInteractions?.update?.(interactionDocument) === true;
      } catch {
        applied = false;
      }
      if (!applied) {
        scheduleCanvasViewInteractionRetry();
        return false;
      }
      canvasViewInteractionPending = false;
      canvasViewInteractionRetryDelay = 16;
      if (canvasViewInteractionRetryTimer) {
        clearTimeout(canvasViewInteractionRetryTimer);
        canvasViewInteractionRetryTimer = 0;
      }
      replayPinnedInteractionPreview();
      return true;
    };
    const queueCanvasViewInteraction = (
      interactionDocument,
      interactionSignature,
      force = false,
    ) => {
      const changed = (
        !canvasViewHasInteractionSnapshot
        || interactionSignature !== canvasViewInteractionSignature
      );
      if (changed || force) {
        canvasViewInteractionDocument = interactionDocument;
        canvasViewInteractionSignature = interactionSignature;
        canvasViewHasInteractionSnapshot = true;
        canvasViewInteractionPending = true;
        canvasViewInteractionRetryDelay = 16;
        if (canvasViewInteractionRetryTimer) {
          clearTimeout(canvasViewInteractionRetryTimer);
          canvasViewInteractionRetryTimer = 0;
        }
      }
      // A same-content newer snapshot must not erase an older failed attempt.
      // The helper reads the current desired document, so a newer snapshot
      // always wins even if a retry from the previous one was already queued.
      applyPendingCanvasViewInteraction();
    };
    const canvasViewStyleElements = path => Array.from(
      document.querySelectorAll('style[data-editor-source]'),
    ).filter(candidate => candidate.getAttribute('data-editor-source') === path);
    const captureCanvasViewStylesheetBaseline = path => {
      if (canvasViewStylesheetBaselines.has(path)) return;
      const styles = canvasViewStyleElements(path);
      canvasViewStylesheetBaselines.set(path, {
        cssTexts: styles.map(style => style.textContent || ''),
      });
    };
    const applyCanvasViewStylesheet = (path, cssText) => {
      captureCanvasViewStylesheetBaseline(path);
      let styles = canvasViewStyleElements(path);
      if (!styles.length) {
        const style = document.createElement('style');
        style.setAttribute('data-editor-source', path);
        document.head.append(style);
        styles = [style];
      }
      const desired = rewriteRuntimeCssText(
        cssText,
        reapplyCanvasViewDocumentState,
      );
      // Imported projects can legitimately contain the same source stylesheet
      // more than once (for example a runtime-cloned document shell). They all
      // represent one editor atom and must never diverge visually.
      styles.forEach(style => {
        if (style.textContent !== desired) style.textContent = desired;
        learnCustomPropertiesFromStyleElement(style);
      });
    };
    const restoreCanvasViewStylesheet = path => {
      const baseline = canvasViewStylesheetBaselines.get(path);
      if (!baseline) return;
      const styles = canvasViewStyleElements(path);
      baseline.cssTexts.forEach((cssText, index) => {
        let target = styles[index];
        if (!target) {
          target = document.createElement('style');
          target.setAttribute('data-editor-source', path);
          document.head.append(target);
        }
        if (target.textContent !== cssText) {
          target.textContent = cssText;
        }
      });
      styles.slice(baseline.cssTexts.length).forEach(style => style.remove());
      canvasViewStylesheetBaselines.delete(path);
    };
    const captureCanvasViewDesignTokenBaseline = () => {
      if (canvasViewDesignTokenBaseline.captured) return;
      const style = document.querySelector('style[data-kodety-design-tokens]');
      canvasViewDesignTokenBaseline.captured = true;
      canvasViewDesignTokenBaseline.existed = Boolean(style);
      canvasViewDesignTokenBaseline.cssText = style?.textContent || '';
    };
    const applyCanvasViewDesignTokens = cssText => {
      captureCanvasViewDesignTokenBaseline();
      let style = document.querySelector('style[data-kodety-design-tokens]');
      if (!style) {
        style = document.createElement('style');
        style.setAttribute('data-kodety-design-tokens', '');
        document.head.append(style);
      }
      const desired = rewriteRuntimeCssText(
        cssText,
        reapplyCanvasViewDocumentState,
      );
      if (style.textContent !== desired) style.textContent = desired;
      learnCustomPropertiesFromStyleElement(style);
    };
    const restoreCanvasViewDesignTokens = () => {
      if (!canvasViewDesignTokenBaseline.captured) return;
      const style = document.querySelector('style[data-kodety-design-tokens]');
      if (canvasViewDesignTokenBaseline.existed) {
        let target = style;
        if (!target) {
          target = document.createElement('style');
          target.setAttribute('data-kodety-design-tokens', '');
          document.head.append(target);
        }
        if (target.textContent !== canvasViewDesignTokenBaseline.cssText) {
          target.textContent = canvasViewDesignTokenBaseline.cssText;
        }
      } else {
        style?.remove();
      }
      canvasViewDesignTokenBaseline.captured = false;
      canvasViewDesignTokenBaseline.existed = false;
      canvasViewDesignTokenBaseline.cssText = '';
    };
    reapplyCanvasViewDocumentState = () => {
      canvasViewStylesheets.forEach((cssText, path) => {
        applyCanvasViewStylesheet(path, cssText);
      });
      if (canvasViewDesignTokenCssText !== undefined) {
        applyCanvasViewDesignTokens(canvasViewDesignTokenCssText);
      }
      applyPendingCanvasViewInteraction();
    };
    const normalizeCanvasViewState = state => {
      const rawOwnerships = state?.ownerships === undefined
        ? []
        : state.ownerships;
      const kind = state?.kind === 'delta'
        ? 'delta'
        : state?.kind === 'snapshot' || state?.kind === undefined
          ? 'snapshot'
          : null;
      if (
        !state
        || typeof state !== 'object'
        || !kind
        || state.protocol !== 1
        || !Number.isSafeInteger(state.epoch)
        || state.epoch < 0
        || !Number.isSafeInteger(state.version)
        || state.version < 0
        || !Number.isSafeInteger(state.revision)
        || state.revision < 0
        || !Array.isArray(state.stylesheets)
        || !Array.isArray(state.patches)
        || !Array.isArray(state.attributes)
        || !Array.isArray(state.texts)
        || !Array.isArray(rawOwnerships)
        || state.stylesheets.length > 4096
        || state.patches.length > 20000
        || state.attributes.length > 20000
        || state.texts.length > 20000
        || rawOwnerships.length > 20000
      ) return null;
      const validPath = path => (
        typeof path === 'string'
        && path.length <= 2048
        && /^(?:\\d+(?:\\/\\d+)*)?$/.test(path)
      );
      const stylesheets = new Map();
      for (const entry of state.stylesheets) {
        if (
          !entry
          || typeof entry !== 'object'
          || typeof entry.path !== 'string'
          || !entry.path
          || entry.path.length > 2048
          || typeof entry.cssText !== 'string'
        ) continue;
        stylesheets.delete(entry.path);
        stylesheets.set(entry.path, entry.cssText);
      }
      const patches = new Map();
      for (const patch of state.patches) {
        if (
          !patch
          || typeof patch !== 'object'
          || !validPath(patch.path)
          || typeof patch.property !== 'string'
          || !patch.property.trim()
          || patch.property.length > 512
          || typeof patch.value !== 'string'
          || (
            patch.priority !== undefined
            && patch.priority !== ''
            && patch.priority !== 'important'
          )
        ) continue;
        const property = normalizeRuntimeStyleProperty(patch.property);
        const normalized = {
          path: patch.path,
          property,
          value: patch.value,
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        };
        patches.set(patch.path + '\\u0000' + property, normalized);
      }
      const attributes = new Map();
      for (const patch of state.attributes) {
        if (
          !patch
          || typeof patch !== 'object'
          || !validPath(patch.path)
          || typeof patch.name !== 'string'
          || !/^[^\\s"'<>\\/=]+$/.test(patch.name)
          || patch.name === 'style'
          || patch.name === 'data-html-editor-path'
          || (patch.value !== null && typeof patch.value !== 'string')
        ) continue;
        const name = patch.name.trim().toLowerCase();
        const normalized = { path: patch.path, name, value: patch.value };
        attributes.set(patch.path + '\\u0000' + name, normalized);
      }
      const texts = new Map();
      for (const patch of state.texts) {
        if (
          !patch
          || typeof patch !== 'object'
          || !validPath(patch.path)
          || typeof patch.value !== 'string'
        ) continue;
        texts.set(patch.path, { path: patch.path, value: patch.value });
      }
      const ownerships = new Map();
      for (const patch of rawOwnerships) {
        if (
          !patch
          || typeof patch !== 'object'
          || (patch.scope !== 'path' && patch.scope !== 'selector')
          || typeof patch.target !== 'string'
          || !patch.target.trim()
          || patch.target.length > 4096
          || typeof patch.property !== 'string'
          || !authoredMotionProperties.has(normalizeRuntimeStyleProperty(patch.property))
          || typeof patch.owned !== 'boolean'
          || (
            patch.scope === 'path'
            && !validPath(patch.target.trim())
          )
          || (
            patch.scope === 'selector'
            && /[{}]/.test(patch.target)
          )
          || (
            patch.breakpoint !== undefined
            && (
              typeof patch.breakpoint !== 'string'
              || !patch.breakpoint
              || patch.breakpoint.length > 256
            )
          )
          || (
            patch.pseudo !== undefined
            && (
              typeof patch.pseudo !== 'string'
              || !patch.pseudo
              || patch.pseudo.length > 64
            )
          )
        ) continue;
        const normalized = {
          scope: patch.scope,
          target: patch.target.trim(),
          property: normalizeRuntimeStyleProperty(patch.property),
          owned: patch.owned,
          breakpoint: patch.breakpoint || 'base',
          pseudo: patch.pseudo || 'base',
        };
        ownerships.set(propertyOwnershipKey(normalized), normalized);
      }
      const hasDesignTokenCssText = Object.prototype.hasOwnProperty.call(
        state,
        'designTokenCssText',
      ) && typeof state.designTokenCssText === 'string';
      const hasInteractionDocument = Object.prototype.hasOwnProperty.call(
        state,
        'interactionDocument',
      ) && Boolean(
        state.interactionDocument
        && typeof state.interactionDocument === 'object'
        && Array.isArray(state.interactionDocument.interactions),
      );
      return {
        kind,
        epoch: state.epoch,
        version: state.version,
        revision: state.revision,
        stylesheets,
        hasDesignTokenCssText,
        designTokenCssText: hasDesignTokenCssText
          ? state.designTokenCssText
          : undefined,
        patches,
        attributes,
        texts,
        ownerships,
        hasInteractionDocument,
        interactionDocument: hasInteractionDocument
          ? state.interactionDocument
          : undefined,
      };
    };
    const canvasViewPatchMapsByPath = normalized => {
      const styles = new Map();
      normalized.patches.forEach(patch => {
        rememberPathPatch(styles, patch.path, patch.property, patch);
      });
      const attributes = new Map();
      normalized.attributes.forEach(patch => {
        rememberPathPatch(attributes, patch.path, patch.name, patch);
      });
      return { styles, attributes };
    };
    const applyCanvasViewState = rawState => {
      const normalized = normalizeCanvasViewState(rawState);
      if (!normalized) return;
      const cmsRefreshPaths = Array.from(new Set(
        Array.from(normalized.attributes.values())
          .filter(patch => isCmsRuntimeAttribute(patch.name))
          .map(patch => patch.path),
      ));
      if (
        normalized.epoch < canvasViewEpoch
        || (
          normalized.epoch === canvasViewEpoch
          && normalized.version <= canvasViewVersion
        )
      ) return;
      if (normalized.kind === 'delta') {
        // A delta is valid only after this exact semantic surface accepted its
        // initial snapshot. postMessage is ordered for a mounted frame; newly
        // mounted/replaced frames hydrate from the full snapshot on ready.
        if (normalized.epoch !== canvasViewEpoch) return;
        const changedPaths = new Set();
        normalized.stylesheets.forEach((cssText, path) => {
          canvasViewStylesheets.set(path, cssText);
          applyCanvasViewStylesheet(path, cssText);
        });
        if (normalized.hasDesignTokenCssText) {
          canvasViewDesignTokenCssText = normalized.designTokenCssText;
          applyCanvasViewDesignTokens(canvasViewDesignTokenCssText);
        }
        normalized.patches.forEach(patch => {
          rememberPathPatch(
            canvasViewPathStyles,
            patch.path,
            patch.property,
            patch,
          );
          changedPaths.add(patch.path);
        });
        normalized.attributes.forEach(patch => {
          rememberPathPatch(
            canvasViewPathAttributes,
            patch.path,
            patch.name,
            patch,
          );
          changedPaths.add(patch.path);
        });
        normalized.texts.forEach((patch, path) => {
          canvasViewPathTexts.set(path, patch);
          changedPaths.add(path);
        });
        normalized.ownerships.forEach((patch, key) => {
          if (patch.owned) canvasViewPropertyOwnerships.set(key, patch);
          else canvasViewPropertyOwnerships.delete(key);
        });
        refreshCanvasPropertyOwnershipMarkers();
        changedPaths.forEach(path => {
          editorVisualElements(path).forEach(element => {
            reapplyEditorLiveState(element, false);
          });
        });
        scheduleCmsViewStateRefresh(cmsRefreshPaths);
        if (normalized.hasInteractionDocument) {
          try {
            queueCanvasViewInteraction(
              normalized.interactionDocument,
              JSON.stringify(normalized.interactionDocument),
            );
          } catch {
            // A malformed interaction atom cannot discard the other visual
            // atoms from the same internally-produced transaction.
          }
        }
        canvasViewVersion = normalized.version;
        appliedEditorRevision = Math.max(
          appliedEditorRevision,
          normalized.revision,
        );
        pruneDisconnectedCanvasViewElements();
        refreshRuntimeFonts();
        scheduleLiveStylePaintRefresh();
        requestAnimationFrame(refreshDirectControls);
        return;
      }
      const epochChanged = normalized.epoch > canvasViewEpoch;

      const nextByPath = canvasViewPatchMapsByPath(normalized);
      const changedPaths = new Set();
      const removedPaths = new Set();
      const collectChangedAtoms = (current, next, atomPath) => {
        current.forEach((entry, key) => {
          const replacement = next.get(key);
          if (!replacement) {
            removedPaths.add(atomPath(entry));
            changedPaths.add(atomPath(entry));
          } else if (JSON.stringify(entry) !== JSON.stringify(replacement)) {
            changedPaths.add(atomPath(replacement));
          }
        });
        next.forEach((entry, key) => {
          if (!current.has(key)) changedPaths.add(atomPath(entry));
        });
      };

      const nextStyleAtoms = new Map();
      nextByPath.styles.forEach(entries => {
        entries.forEach(patch => {
          nextStyleAtoms.set(patch.path + '\\u0000' + patch.property, patch);
        });
      });
      const currentStyleAtoms = new Map();
      canvasViewPathStyles.forEach(entries => {
        entries.forEach(patch => {
          currentStyleAtoms.set(patch.path + '\\u0000' + patch.property, patch);
        });
      });
      collectChangedAtoms(currentStyleAtoms, nextStyleAtoms, entry => entry.path);

      const nextAttributeAtoms = new Map();
      nextByPath.attributes.forEach(entries => {
        entries.forEach(patch => {
          nextAttributeAtoms.set(patch.path + '\\u0000' + patch.name, patch);
        });
      });
      const currentAttributeAtoms = new Map();
      canvasViewPathAttributes.forEach(entries => {
        entries.forEach(patch => {
          currentAttributeAtoms.set(patch.path + '\\u0000' + patch.name, patch);
        });
      });
      collectChangedAtoms(
        currentAttributeAtoms,
        nextAttributeAtoms,
        entry => entry.path,
      );
      collectChangedAtoms(
        canvasViewPathTexts,
        normalized.texts,
        entry => entry.path,
      );

      if (epochChanged) {
        canvasViewTouchedElements.forEach(element => {
          restoreCanvasViewElement(element);
        });
        canvasViewStylesheetBaselines.forEach((_baseline, path) => {
          restoreCanvasViewStylesheet(path);
        });
        restoreCanvasViewDesignTokens();
        changedPaths.clear();
        nextByPath.styles.forEach((_entries, path) => changedPaths.add(path));
        nextByPath.attributes.forEach((_entries, path) => changedPaths.add(path));
        normalized.texts.forEach((_patch, path) => changedPaths.add(path));
      } else {
        removedPaths.forEach(path => {
          editorVisualElements(path).forEach(restoreCanvasViewElement);
        });
      }

      const previousStylesheetPaths = new Set(canvasViewStylesheets.keys());
      canvasViewStylesheets.clear();
      normalized.stylesheets.forEach((cssText, path) => {
        canvasViewStylesheets.set(path, cssText);
        previousStylesheetPaths.delete(path);
        applyCanvasViewStylesheet(path, cssText);
      });
      previousStylesheetPaths.forEach(restoreCanvasViewStylesheet);

      const previousDesignTokenCssText = canvasViewDesignTokenCssText;
      canvasViewDesignTokenCssText = normalized.hasDesignTokenCssText
        ? normalized.designTokenCssText
        : undefined;
      if (canvasViewDesignTokenCssText !== undefined) {
        applyCanvasViewDesignTokens(canvasViewDesignTokenCssText);
      } else if (previousDesignTokenCssText !== undefined) {
        restoreCanvasViewDesignTokens();
      }

      canvasViewPathStyles.clear();
      nextByPath.styles.forEach((entries, path) => {
        canvasViewPathStyles.set(path, entries);
      });
      canvasViewPathAttributes.clear();
      nextByPath.attributes.forEach((entries, path) => {
        canvasViewPathAttributes.set(path, entries);
      });
      canvasViewPathTexts.clear();
      normalized.texts.forEach((patch, path) => {
        canvasViewPathTexts.set(path, patch);
      });
      canvasViewPropertyOwnerships.clear();
      normalized.ownerships.forEach((patch, key) => {
        if (patch.owned) canvasViewPropertyOwnerships.set(key, patch);
      });
      refreshCanvasPropertyOwnershipMarkers();
      changedPaths.forEach(path => {
        editorVisualElements(path).forEach(element => {
          // Restore-on-removal may have removed legacy atoms too. The common
          // replayer reinstalls compatibility state first and v2 last.
          reapplyEditorLiveState(element, false);
        });
      });
      scheduleCmsViewStateRefresh(cmsRefreshPaths);

      let interactionSignature = '';
      if (normalized.hasInteractionDocument) {
        try {
          interactionSignature = JSON.stringify(normalized.interactionDocument);
        } catch {
          interactionSignature = '';
        }
      }
      if (normalized.hasInteractionDocument) {
        queueCanvasViewInteraction(
          normalized.interactionDocument,
          interactionSignature,
          epochChanged,
        );
      } else if (epochChanged) {
        // A fresh canonical canvas already booted the interaction document
        // embedded by buildPreview(). Absence of a View State override means
        // “keep that runtime”, not “replace it with an empty document”.
        //
        // Explicit removals still arrive as
        // { version: 2, interactions: [] } and take the branch above. This
        // distinction prevents the first editor snapshot from destroying every
        // controller until an arbitrary Class/Selector edit sends them again.
        canvasViewInteractionDocument = undefined;
        canvasViewInteractionSignature = '';
        canvasViewHasInteractionSnapshot = false;
        canvasViewInteractionPending = false;
        canvasViewInteractionRetryDelay = 16;
        if (canvasViewInteractionRetryTimer) {
          clearTimeout(canvasViewInteractionRetryTimer);
          canvasViewInteractionRetryTimer = 0;
        }
      }

      canvasViewEpoch = normalized.epoch;
      canvasViewVersion = normalized.version;
      appliedEditorRevision = Math.max(
        appliedEditorRevision,
        normalized.revision,
      );
      pruneDisconnectedCanvasViewElements();
      refreshRuntimeFonts();
      scheduleLiveStylePaintRefresh();
      requestAnimationFrame(refreshDirectControls);
    };
    const remapEditorPathAfterRemoval = (path, removedPath) => {
      const parts = String(path || '').split('/').filter(Boolean).map(Number);
      const removed = String(removedPath || '').split('/').filter(Boolean).map(Number);
      if (!removed.length) return null;
      const startsWith = (candidate, prefix) => prefix.every((value, index) => candidate[index] === value);
      if (startsWith(parts, removed)) return null;
      const parent = removed.slice(0, -1);
      const removedIndex = removed[removed.length - 1];
      if (
        startsWith(parts, parent)
        && parts.length > parent.length
        && parts[parent.length] > removedIndex
      ) parts[parent.length] -= 1;
      return parts.join('/');
    };
    const remapEditorPathAfterRemovals = (path, removedPaths) => {
      let next = String(path || '');
      for (const removedPath of removedPaths) {
        next = remapEditorPathAfterRemoval(next, removedPath);
        if (next === null) return null;
      }
      return next;
    };
    const remapNestedPathMap = (map, remapPath) => {
      const next = new Map();
      map.forEach((entries, path) => {
        const remapped = remapPath(path);
        if (remapped === null) return;
        const nextEntries = new Map();
        entries.forEach((patch, key) => nextEntries.set(key, { ...patch, path: remapped }));
        next.set(remapped, nextEntries);
      });
      map.clear();
      next.forEach((entries, path) => map.set(path, entries));
    };
    const remapTextPathMap = (map, remapPath) => {
      const next = new Map();
      map.forEach((patch, path) => {
        const remapped = remapPath(path);
        if (remapped !== null) next.set(remapped, { ...patch, path: remapped });
      });
      map.clear();
      next.forEach((patch, path) => map.set(path, patch));
    };
    const remapPathSet = (set, remapPath) => {
      const next = new Set();
      set.forEach(path => {
        const remapped = remapPath(path);
        if (remapped !== null) next.add(remapped);
      });
      set.clear();
      next.forEach(path => set.add(path));
    };
    const remapOwnershipMap = (map, remapPath) => {
      const next = new Map();
      map.forEach(patch => {
        if (patch.scope !== 'path') {
          next.set(propertyOwnershipKey(patch), patch);
          return;
        }
        const target = remapPath(patch.target);
        if (target === null) return;
        const remapped = { ...patch, target };
        next.set(propertyOwnershipKey(remapped), remapped);
      });
      map.clear();
      next.forEach((patch, key) => map.set(key, patch));
    };
    const remapAllEditorPathState = (remapPath, remapElements = true) => {
      if (remapElements) document.querySelectorAll('[data-html-editor-path]').forEach(element => {
        const path = element.getAttribute('data-html-editor-path') || '';
        const remapped = remapPath(path);
        if (remapped === null) element.remove();
        else if (remapped !== path) setLiveAttribute(element, 'data-html-editor-path', remapped);
      });
      remapNestedPathMap(committedPathStyles, remapPath);
      remapNestedPathMap(committedPathAttributes, remapPath);
      remapTextPathMap(committedPathTexts, remapPath);
      remapPathSet(committedVisibilityPaths, remapPath);
      remapNestedPathMap(transientPathStyles, remapPath);
      remapNestedPathMap(canvasViewPathStyles, remapPath);
      remapNestedPathMap(canvasViewPathAttributes, remapPath);
      remapTextPathMap(canvasViewPathTexts, remapPath);
      remapOwnershipMap(canvasViewPropertyOwnerships, remapPath);
      remapOwnershipMap(transientPropertyOwnerships, remapPath);
    };
    const finalizeLiveStructure = message => {
      if (!selected?.isConnected) selected = null;
      editorOverlayStructureDirty = true;
      pruneDisconnectedCanvasViewElements();
      if (message.interactionDocument && Array.isArray(message.interactionDocument.interactions)) {
        window.__kodetyInteractions?.update?.(message.interactionDocument);
      }
      if (Number.isSafeInteger(message.revision)) {
        appliedEditorRevision = Math.max(appliedEditorRevision, message.revision);
      }
      const selectPath = typeof message.selectPath === 'string' ? message.selectPath : '';
      if (selectPath) {
        const nextSelection = preferredEditorPathElement(selectPath);
        if (nextSelection) selectElement(nextSelection, false, 'editor');
      } else {
        pendingSelectionDetail = {
          element: selected,
          sequence: selectionSnapshotSequence,
        };
        schedulePendingSelectionDetail();
      }
      scheduleLiveStylePaintRefresh();
      requestAnimationFrame(refreshDirectControls);
      scheduleCanvasVisibilitySnapshot();
    };
    const applyLiveElementRemoval = message => {
      const paths = Array.from(new Set(
        (Array.isArray(message.paths) ? message.paths : [])
          .filter(path => typeof path === 'string' && path.trim())
          .map(path => path.trim()),
      ));
      if (!paths.length) return false;

      const authoredElements = Array.from(document.querySelectorAll('[data-html-editor-path]'));
      let removed = 0;
      authoredElements.forEach(element => {
        const path = element.getAttribute('data-html-editor-path') || '';
        if (!paths.some(target => path === target || path.startsWith(target + '/'))) return;
        element.remove();
        removed += 1;
      });
      if (!removed) return false;
      remapAllEditorPathState(path => remapEditorPathAfterRemovals(path, paths));
      finalizeLiveStructure(message);
      return true;
    };
    const remapEditorPathAfterInsert = (path, insertedPath) => {
      const parts = String(path || '').split('/').filter(Boolean).map(Number);
      const inserted = String(insertedPath || '').split('/').filter(Boolean).map(Number);
      if (!inserted.length) return String(path || '');
      const parent = inserted.slice(0, -1);
      const insertedIndex = inserted[inserted.length - 1];
      if (
        parent.every((value, index) => parts[index] === value)
        && parts.length > parent.length
        && parts[parent.length] >= insertedIndex
      ) parts[parent.length] += 1;
      return parts.join('/');
    };
    const annotateLiveInsertedTree = (root, rootPath) => {
      const visit = (element, path) => {
        setLiveAttribute(element, 'data-html-editor-path', path);
        if (element.hasAttribute('style')) {
          setLiveAttribute(element, 'data-html-editor-original-style', element.getAttribute('style') || '');
        }
        Array.from(element.attributes).forEach(attribute => {
          if (/^on[a-z]+$/i.test(attribute.name)) {
            setLiveAttribute(element, 'data-html-editor-original-' + attribute.name, attribute.value);
          }
        });
        const children = Array.from(element.children).filter(isRuntimeEditorAnnotatableElement);
        if (!children.length) setLiveAttribute(element, 'data-html-editor-leaf');
        else removeLiveAttribute(element, 'data-html-editor-leaf');
        children.forEach((child, index) => visit(child, path ? path + '/' + index : String(index)));
      };
      visit(root, rootPath);
    };
    const liveMarkupRoot = (markup, insertedPath) => {
      if (typeof markup !== 'string' || !markup.trim()) return null;
      const template = document.createElement('template');
      template.innerHTML = markup.trim();
      const roots = Array.from(template.content.children);
      // Executable/multi-root snippets require the canonical compiler. Normal
      // Builder inserts and copied layers are one authored element.
      if (roots.length !== 1 || template.content.querySelector('script, style, link[rel]')) return null;
      const root = roots[0];
      annotateLiveInsertedTree(root, insertedPath);
      return root;
    };
    const applyLiveElementInsert = message => {
      const targetPath = typeof message.targetPath === 'string' ? message.targetPath : '';
      const insertedPath = typeof message.insertedPath === 'string' ? message.insertedPath : '';
      const position = message.position;
      if (!insertedPath || !['before', 'after', 'inside'].includes(position)) return false;
      const targets = editorVisualElements(targetPath);
      if (!targets.length) return false;
      const probe = liveMarkupRoot(message.markup, insertedPath);
      if (!probe) return false;

      remapAllEditorPathState(path => remapEditorPathAfterInsert(path, insertedPath));
      let inserted = 0;
      targets.forEach((target, index) => {
        if (!target.isConnected) return;
        const root = index === 0 ? probe : liveMarkupRoot(message.markup, insertedPath);
        if (!root) return;
        if (position === 'inside') target.append(root);
        else if (position === 'before') target.before(root);
        else target.after(root);
        reapplyEditorLiveState(root);
        inserted += 1;
      });
      if (!inserted) return false;
      finalizeLiveStructure(message);
      return true;
    };
    const applyLiveElementReplace = (message, finalize = true) => {
      const path = typeof message.path === 'string' ? message.path : '';
      const targets = editorVisualElements(path);
      if (!targets.length) return false;
      const probe = liveMarkupRoot(message.markup, path);
      if (!probe) return false;

      // Root-level editor state can survive because the authored path remains
      // the same. Descendant state belongs to the removed subtree and must not
      // leak into unrelated markup the Agent just supplied.
      remapAllEditorPathState(candidate => {
        if (candidate === path) return candidate;
        if (!path || candidate.startsWith(path + '/')) return null;
        return candidate;
      });
      let replaced = 0;
      targets.forEach((target, index) => {
        if (!target.isConnected) return;
        const root = index === 0 ? probe : liveMarkupRoot(message.markup, path);
        if (!root) return;
        [
          'data-kodety-preview-clone',
          'data-kodety-preview-item-id',
          'data-kodety-rendered-item',
          'data-kodety-filter-limit',
          'data-kodety-filter-values',
        ].forEach(attribute => {
          const value = target.getAttribute(attribute);
          if (value !== null && !root.hasAttribute(attribute)) {
            setLiveAttribute(root, attribute, value);
          }
        });
        target.replaceWith(root);
        reapplyEditorLiveState(root);
        replaced += 1;
      });
      if (!replaced) return false;
      if (finalize) finalizeLiveStructure(message);
      return true;
    };
    const applyLiveElementReplaceMany = message => {
      if (
        !Array.isArray(message.replacements)
        || !message.replacements.length
        || message.replacements.length > 2048
      ) return false;
      const paths = new Set();
      for (const replacement of message.replacements) {
        if (
          !replacement
          || typeof replacement !== 'object'
          || typeof replacement.path !== 'string'
          || !replacement.path
          || paths.has(replacement.path)
          || typeof replacement.markup !== 'string'
          || !replacement.markup.trim()
        ) return false;
        paths.add(replacement.path);
      }
      // Replacements are independent top-level component roots. The ordinary
      // replace primitive already preserves clone metadata, selection and View
      // State while re-annotating the new subtree; one bridge transaction keeps
      // every instance on the page visually atomic.
      const applied = message.replacements.every(replacement => applyLiveElementReplace({
        ...message,
        operation: 'replace',
        path: replacement.path,
        markup: replacement.markup,
        selectPath: undefined,
      }, false));
      if (applied) finalizeLiveStructure(message);
      return applied;
    };
    const applyLiveDocumentBodyReplace = message => {
      if (typeof message.markup !== 'string') return false;
      const template = document.createElement('template');
      template.innerHTML = message.markup;
      if (
        template.content.querySelector('script, style, link, meta, base, noscript, template')
        || Array.from(template.content.childNodes).some(node => (
          node.nodeType === Node.TEXT_NODE && Boolean(String(node.nodeValue || '').trim())
        ))
      ) return false;
      const bodyAttributes = Array.isArray(message.bodyAttributes) ? message.bodyAttributes : [];
      const bodyStyles = Array.isArray(message.bodyStyles) ? message.bodyStyles : [];
      if (
        !bodyAttributes.every(patch => (
          patch
          && typeof patch.name === 'string'
          && /^[^\\s"'<>/=]+$/.test(patch.name)
          && patch.name !== 'style'
          && patch.name !== 'data-html-editor-path'
          && (patch.value === null || typeof patch.value === 'string')
        ))
        || !bodyStyles.every(patch => (
          patch
          && typeof patch.property === 'string'
          && typeof patch.value === 'string'
        ))
      ) return false;
      if (
        !bodyAttributes.every(patch => applyLiveAttributePatchToElement(document.body, { ...patch, path: '' }))
        || !bodyStyles.every(patch => applyLiveStylePatchToElement(document.body, { ...patch, path: '' }))
      ) return false;
      const roots = Array.from(template.content.children);
      roots.forEach((element, index) => annotateLiveInsertedTree(element, String(index)));
      const previousTextNodes = Array.from(document.body.childNodes).filter(node => node.nodeType === Node.TEXT_NODE);
      const currentRoots = Array.from(document.body.children).filter(element => {
        if (!isRuntimeEditorAnnotatableElement(element)) return false;
        const path = element.getAttribute('data-html-editor-path');
        return typeof path === 'string' && path !== '' && !path.includes('/');
      });
      const anchor = currentRoots[0]
        || document.querySelector('[data-html-editor-agent-activity-root]')
        || null;
      const fragment = document.createDocumentFragment();
      roots.forEach(root => fragment.append(root));
      document.body.insertBefore(fragment, anchor);
      currentRoots.forEach(root => root.remove());
      previousTextNodes.forEach(node => node.remove());
      // Roots have already been replaced. Clear old path-bound state without
      // deleting the new roots or the bridge-bearing body itself.
      remapAllEditorPathState(() => null, false);
      roots.forEach(root => reapplyEditorLiveState(root));
      finalizeLiveStructure(message);
      agentActivityController.schedule();
      return true;
    };
    const remapEditorPathAfterMove = (path, sourcePath, movedPath) => {
      const parts = String(path || '').split('/').filter(Boolean).map(Number);
      const source = String(sourcePath || '').split('/').filter(Boolean).map(Number);
      const moved = String(movedPath || '').split('/').filter(Boolean).map(Number);
      const startsWith = (candidate, prefix) => prefix.every((value, index) => candidate[index] === value);
      if (startsWith(parts, source)) return [...moved, ...parts.slice(source.length)].join('/');
      const next = [...parts];
      const sourceParent = source.slice(0, -1);
      const sourceIndex = source[source.length - 1];
      if (startsWith(next, sourceParent) && next.length > sourceParent.length && next[sourceParent.length] > sourceIndex) {
        next[sourceParent.length] -= 1;
      }
      const movedParent = moved.slice(0, -1);
      const movedIndex = moved[moved.length - 1];
      if (startsWith(next, movedParent) && next.length > movedParent.length && next[movedParent.length] >= movedIndex) {
        next[movedParent.length] += 1;
      }
      return next.join('/');
    };
    const applyLiveElementMove = message => {
      const sourcePath = typeof message.sourcePath === 'string' ? message.sourcePath : '';
      const targetPath = typeof message.targetPath === 'string' ? message.targetPath : '';
      const movedPath = typeof message.movedPath === 'string' ? message.movedPath : '';
      const codeComponentInstanceId = typeof message.codeComponentInstanceId === 'string'
        ? message.codeComponentInstanceId.trim()
        : '';
      const position = message.position;
      if (!sourcePath || !movedPath || !['before', 'after', 'inside'].includes(position)) return false;
      if (
        message.codeComponentInstanceId !== undefined
        && (!codeComponentInstanceId || codeComponentInstanceId.length > 256)
      ) return false;
      const sources = editorVisualElements(sourcePath);
      const targets = editorVisualElements(targetPath);
      if (!sources.length || !targets.length) return false;
      if (
        codeComponentInstanceId
        && sources.some(source => source.getAttribute('data-coday-code-instance') !== codeComponentInstanceId)
      ) return false;

      let movedCount = 0;
      sources.forEach((source, index) => {
        const itemId = previewItemIdForElement(source);
        const target = (itemId
          ? targets.find(candidate => previewItemIdForElement(candidate) === itemId)
          : targets[index] || targets[0]);
        if (!source.isConnected || !target?.isConnected || source === target || source.contains(target)) return;
        if (position === 'inside') target.append(source);
        else if (position === 'before') target.before(source);
        else target.after(source);
        movedCount += 1;
      });
      if (!movedCount) return false;
      remapAllEditorPathState(path => remapEditorPathAfterMove(path, sourcePath, movedPath));
      finalizeLiveStructure(message);
      return true;
    };
    const remapEditorPathAfterWrap = (path, wrappedPath) => {
      const parts = String(path || '').split('/').filter(Boolean);
      const wrapped = String(wrappedPath || '').split('/').filter(Boolean);
      if (!wrapped.every((value, index) => parts[index] === value)) return String(path || '');
      return [...wrapped, '0', ...parts.slice(wrapped.length)].join('/');
    };
    const applyLiveElementWrap = message => {
      const path = typeof message.path === 'string' ? message.path : '';
      const targets = editorVisualElements(path);
      if (!targets.length || typeof message.wrapperMarkup !== 'string') return false;
      const probe = liveMarkupRoot(message.wrapperMarkup, path);
      if (!probe || probe.children.length) return false;

      remapAllEditorPathState(candidate => remapEditorPathAfterWrap(candidate, path));
      let wrapped = 0;
      targets.forEach((target, index) => {
        if (!target.isConnected) return;
        const wrapper = index === 0 ? probe : liveMarkupRoot(message.wrapperMarkup, path);
        if (!wrapper || wrapper.children.length) return;
        target.before(wrapper);
        wrapper.append(target);
        removeLiveAttribute(wrapper, 'data-html-editor-leaf');
        reapplyEditorLiveState(wrapper);
        wrapped += 1;
      });
      if (!wrapped) return false;
      finalizeLiveStructure(message);
      return true;
    };
    const remapEditorPathAfterUnwrap = (path, unwrappedPath, childCount) => {
      const parts = String(path || '').split('/').filter(Boolean).map(Number);
      const unwrapped = String(unwrappedPath || '').split('/').filter(Boolean).map(Number);
      const startsWith = (candidate, prefix) => prefix.every((value, index) => candidate[index] === value);
      if (!unwrapped.length || childCount < 1) return null;
      if (parts.length === unwrapped.length && startsWith(parts, unwrapped)) return null;
      const parent = unwrapped.slice(0, -1);
      const wrapperIndex = unwrapped[unwrapped.length - 1];
      if (startsWith(parts, unwrapped)) {
        const childIndex = parts[unwrapped.length];
        return [...parent, wrapperIndex + childIndex, ...parts.slice(unwrapped.length + 1)].join('/');
      }
      const next = [...parts];
      if (startsWith(next, parent) && next.length > parent.length && next[parent.length] > wrapperIndex) {
        next[parent.length] += childCount - 1;
      }
      return next.join('/');
    };
    const applyLiveElementUnwrap = message => {
      const path = typeof message.path === 'string' ? message.path : '';
      const childCount = Number(message.childCount);
      const targets = editorVisualElements(path);
      if (!targets.length || !Number.isSafeInteger(childCount) || childCount < 1) return false;
      let unwrapped = 0;
      targets.forEach(target => {
        if (!target.isConnected) return;
        const authoredChildren = Array.from(target.children).filter(isRuntimeEditorAnnotatableElement);
        if (authoredChildren.length !== childCount) return;
        target.before(...Array.from(target.childNodes));
        target.remove();
        unwrapped += 1;
      });
      if (!unwrapped) return false;
      remapAllEditorPathState(candidate => remapEditorPathAfterUnwrap(candidate, path, childCount));
      finalizeLiveStructure(message);
      return true;
    };
    const applyLiveElementRetag = message => {
      const path = typeof message.path === 'string' ? message.path : '';
      const tag = typeof message.tag === 'string' ? message.tag.trim().toLowerCase() : '';
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) return false;
      const targets = editorVisualElements(path);
      if (!targets.length) return false;
      let replaced = 0;
      targets.forEach(target => {
        if (!target.isConnected || target.tagName.toLowerCase() === tag) return;
        const replacement = document.createElement(tag);
        Array.from(target.attributes).forEach(attribute => setLiveAttribute(replacement, attribute.name, attribute.value));
        replacement.append(...Array.from(target.childNodes));
        target.replaceWith(replacement);
        reapplyEditorLiveState(replacement);
        replaced += 1;
      });
      if (!replaced) return false;
      finalizeLiveStructure(message);
      return true;
    };
    const applyLiveElementRestore = message => {
      const items = (Array.isArray(message.items) ? message.items : [])
        .filter(item => item && typeof item.path === 'string' && typeof item.markup === 'string');
      if (!items.length) return false;
      let restored = 0;
      items.forEach(item => {
        const parts = item.path.split('/').filter(Boolean).map(Number);
        if (!parts.length) return;
        const parentPath = parts.slice(0, -1).join('/');
        const insertionIndex = parts[parts.length - 1];
        const parents = editorVisualElements(parentPath);
        const probe = liveMarkupRoot(item.markup, item.path);
        if (!parents.length || !probe) return;
        remapAllEditorPathState(path => remapEditorPathAfterInsert(path, item.path));
        parents.forEach((parent, index) => {
          if (!parent.isConnected) return;
          const root = index === 0 ? probe : liveMarkupRoot(item.markup, item.path);
          if (!root) return;
          const children = Array.from(parent.children).filter(isRuntimeEditorAnnotatableElement);
          parent.insertBefore(root, children[insertionIndex] || null);
          reapplyEditorLiveState(root);
          restored += 1;
        });
      });
      if (!restored) return false;
      finalizeLiveStructure(message);
      return true;
    };
    const applyLiveElementRelocate = message => {
      const sourcePath = typeof message.sourcePath === 'string' ? message.sourcePath : '';
      const destinationPath = typeof message.destinationPath === 'string' ? message.destinationPath : '';
      const codeComponentInstanceId = typeof message.codeComponentInstanceId === 'string'
        ? message.codeComponentInstanceId.trim()
        : '';
      const destination = destinationPath.split('/').filter(Boolean).map(Number);
      if (!sourcePath || !destination.length) return false;
      if (
        message.codeComponentInstanceId !== undefined
        && (!codeComponentInstanceId || codeComponentInstanceId.length > 256)
      ) return false;
      const parentPath = destination.slice(0, -1).join('/');
      const destinationIndex = destination[destination.length - 1];
      const sources = editorVisualElements(sourcePath);
      const parents = editorVisualElements(parentPath);
      if (!sources.length || !parents.length) return false;
      if (
        codeComponentInstanceId
        && sources.some(source => source.getAttribute('data-coday-code-instance') !== codeComponentInstanceId)
      ) return false;
      let relocated = 0;
      sources.forEach((source, index) => {
        const itemId = previewItemIdForElement(source);
        const parent = itemId
          ? parents.find(candidate => previewItemIdForElement(candidate) === itemId) || parents[index] || parents[0]
          : parents[index] || parents[0];
        if (!source.isConnected || !parent?.isConnected || source === parent || source.contains(parent)) return;
        source.remove();
        const children = Array.from(parent.children).filter(isRuntimeEditorAnnotatableElement);
        parent.insertBefore(source, children[destinationIndex] || null);
        relocated += 1;
      });
      if (!relocated) return false;
      remapAllEditorPathState(path => remapEditorPathAfterMove(path, sourcePath, destinationPath));
      finalizeLiveStructure(message);
      return true;
    };
    // Run the main structural/selection command listener in capture as well.
    // In particular, Framer runtimes may consume bubbling Window messages
    // before this bridge sees a Layers selection request.
    const receiveMainEditorMessage = (event, fromEditorPort = false) => {
      const validPortMessage = fromEditorPort
        && event.data
        && typeof event.data === 'object'
        && event.data.generation === editorGeneration
        && typeof event.data.type === 'string';
      if (!validPortMessage && !isCurrentEditorMessage(event)) return;
      applyCanvasFontResources(event.data?.fontResources);
      if (event.data?.type === 'html-editor-framer-snapshot-request') {
        const request = event.data;
        if (typeof request.requestId !== 'string' || request.requestId.length > 100
          || !['#main', '[data-framer-root]', 'body'].includes(request.rootSelector)) return;
        void (async () => { try {
          if (!interactivePreview || request.revision !== appliedEditorRevision) {
            throw new Error('Abra o Preview atualizado antes de converter o projeto Framer.');
          }
          await (${waitForFramerHydration.toString()})(document, request.rootSelector);
          if (framerRuntimeLoadError) throw new Error('O runtime Framer falhou ao carregar. Nenhuma conversão foi aplicada.');
          const aliases = { ...runtimeAssetAliases };
          Object.entries(request.assetAliases || {}).slice(0, 10_000).forEach(([url, path]) => {
            if (typeof path === 'string' && availableRuntimeAssetPathSet.has(path)) aliases[url] = path;
          });
          Object.entries(runtimeAssets.urls || {}).forEach(([path, url]) => {
            if (typeof url === 'string' && url) aliases[url] = path;
          });
          const snapshot = (${captureFramerHydratedSnapshot.toString()})(document, request.rootSelector, aliases, runtimeAssets.baseFile, (${rewriteCssAssetUrls.toString()}), (${parseSrcsetCandidates.toString()}));
          postEditorMessage({ type: 'html-editor-framer-snapshot', requestId: request.requestId, revision: appliedEditorRevision, snapshot });
        } catch (error) {
          postEditorMessage({ type: 'html-editor-framer-snapshot', requestId: request.requestId, revision: appliedEditorRevision, error: String(error?.message || error) });
        } })();
        return;
      }
      if (event.data?.type === 'html-editor-code-component-update') {
        const instance = event.data.instance;
        const revision = event.data.revision;
        if (
          !Number.isSafeInteger(revision)
          || revision < 0
          || !instance
          || typeof instance !== 'object'
          || typeof instance.id !== 'string'
          || typeof instance.componentId !== 'string'
          || typeof instance.componentVersion !== 'string'
          || !instance.props
          || typeof instance.props !== 'object'
          || Array.isArray(instance.props)
        ) return;
        try {
          if (JSON.stringify(instance).length > 512 * 1024) return;
        } catch {
          return;
        }
        dispatchEvent(new CustomEvent('coday:code-component-instance-update', {
          detail: { instance, revision },
        }));
        return;
      }
      if (event.data?.type === 'html-editor-live-structure') {
        try {
          const applied = event.data.operation === 'remove'
            ? applyLiveElementRemoval(event.data)
            : event.data.operation === 'insert'
              ? applyLiveElementInsert(event.data)
              : event.data.operation === 'replace'
                ? applyLiveElementReplace(event.data)
                : event.data.operation === 'replace-many'
                  ? applyLiveElementReplaceMany(event.data)
                  : event.data.operation === 'replace-body'
                    ? applyLiveDocumentBodyReplace(event.data)
              : event.data.operation === 'move'
                  ? applyLiveElementMove(event.data)
                  : event.data.operation === 'wrap'
                    ? applyLiveElementWrap(event.data)
                    : event.data.operation === 'unwrap'
                      ? applyLiveElementUnwrap(event.data)
                      : event.data.operation === 'retag'
                        ? applyLiveElementRetag(event.data)
                        : event.data.operation === 'restore'
                          ? applyLiveElementRestore(event.data)
                          : event.data.operation === 'relocate'
                            ? applyLiveElementRelocate(event.data)
                            : false;
          postEditorMessage({
            type: applied
              ? 'html-editor-live-structure-applied'
              : 'html-editor-live-structure-rejected',
            mutationId: event.data.mutationId,
            revision: event.data.revision,
          });
        } catch {
          postEditorMessage({
            type: 'html-editor-live-structure-rejected',
            mutationId: event.data.mutationId,
            revision: event.data.revision,
          });
        }
        return;
      }
      if (event.data?.type === 'html-editor-agent-activity') {
        const paths = Array.isArray(event.data.paths)
          ? Array.from(new Set(event.data.paths.filter(path => (
              typeof path === 'string'
              && path.length > 0
              && path.length <= 1200
            )))).slice(0, 128)
          : [];
        const sectionIds = Array.isArray(event.data.sectionIds)
          ? Array.from(new Set(event.data.sectionIds.filter(sectionId => (
              typeof sectionId === 'string'
              && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(sectionId)
            )))).slice(0, 32)
          : [];
        agentActivityController.setTargets(paths, sectionIds, event.data.agentActive === true);
        return;
      }
      if (event.data?.type === 'html-editor-view-state') {
        const nextBreakpointId = typeof event.data.breakpointId === 'string'
          && event.data.breakpointId
          ? event.data.breakpointId
          : 'base';
        const breakpointChanged = nextBreakpointId !== canvasViewBreakpointId;
        canvasViewBreakpointId = nextBreakpointId;
        applyCanvasViewState(event.data.state);
        if (breakpointChanged) refreshCanvasPropertyOwnershipMarkers();
        // The iframe generation is retained across breakpoint changes. Media
        // rules and the projected stylesheet can therefore change effective
        // visibility without any source-tree or React identity change.
        scheduleCanvasVisibilitySnapshot();
        return;
      }
      if (event.data?.type === 'html-editor-design-tokens') {
        if (typeof event.data.cssText !== 'string') return;
        let style = document.querySelector('style[data-kodety-design-tokens]');
        if (!style) {
          style = document.createElement('style');
          style.setAttribute('data-kodety-design-tokens', '');
          document.head.append(style);
        }
        style.textContent = event.data.cssText;
        learnCustomPropertiesFromStyleElement(style);
        scheduleLiveStylePaintRefresh();
        requestAnimationFrame(refreshDirectControls);
        scheduleCanvasVisibilitySnapshot();
        return;
      }
      if (event.data?.type === 'html-editor-pseudo-state-preview') {
        const cssText = event.data.cssText;
        if (typeof cssText !== 'string' || cssText.length > 512 * 1024) return;
        let style = document.querySelector('style[data-html-editor-pseudo-state-preview]');
        const refreshPseudoStateInspection = () => requestAnimationFrame(refreshDirectControls);
        if (!cssText) {
          style?.remove();
          refreshPseudoStateInspection();
          scheduleCanvasVisibilitySnapshot();
          return;
        }
        if (!style) {
          style = document.createElement('style');
          style.setAttribute('data-html-editor-pseudo-state-preview', '');
          document.head.append(style);
        }
        // The parent serializes only the declarations of the chosen state on
        // editor path selectors. Omitting the native pseudo-class intentionally
        // pins that visual state without synthesizing pointer/focus activity.
        // This disposable sheet is absent from snapshots and publication.
        style.textContent = cssText;
        refreshPseudoStateInspection();
        scheduleCanvasVisibilitySnapshot();
        return;
      }
      if (event.data?.type === 'html-editor-capture-scroll') {
        if (typeof event.data.requestId !== 'string') return;
        if (scrollFrame) {
          cancelAnimationFrame(scrollFrame);
          scrollFrame = 0;
        }
        // These posts are deliberately synchronous and ordered. The parent
        // receives every exact offset before the checkpoint and can safely
        // rebuild srcdoc only after that barrier.
        knownScrollKeys.forEach(postCurrentScrollState);
        postEditorMessage({
          type: 'html-editor-scroll-checkpoint',
          requestId: event.data.requestId,
        });
        return;
      }
      if (event.data?.type === 'html-editor-live-style') {
        const transientPreview = event.data.transientPreview === true;
        const mutationRevision = Number.isSafeInteger(event.data.revision)
          ? event.data.revision
          : null;
        if (transientPreview) {
          canvasViewBreakpointId = typeof event.data.breakpointId === 'string'
            && event.data.breakpointId
            ? event.data.breakpointId
            : canvasViewBreakpointId;
          const versions = event.data.previewPropertyVersions;
          previewPropertyVersions = versions && typeof versions === 'object'
            ? new Map(
              Object.entries(versions).filter(([property, version]) => (
                typeof property === 'string'
                && Number.isSafeInteger(version)
                && version >= 0
              )),
            )
            : new Map();
          transientPropertyOwnerships.clear();
          const rawOwnerships = Array.isArray(event.data.ownerships)
            ? event.data.ownerships
            : [];
          rawOwnerships.forEach(patch => {
            if (
              !patch
              || (patch.scope !== 'path' && patch.scope !== 'selector')
              || typeof patch.target !== 'string'
              || !patch.target.trim()
              || typeof patch.property !== 'string'
              || !authoredMotionProperties.has(normalizeRuntimeStyleProperty(patch.property))
              || patch.owned !== true
            ) return;
            const normalized = {
              scope: patch.scope,
              target: patch.target.trim(),
              property: normalizeRuntimeStyleProperty(patch.property),
              owned: true,
              breakpoint: typeof patch.breakpoint === 'string'
                ? patch.breakpoint
                : 'base',
              pseudo: typeof patch.pseudo === 'string'
                ? patch.pseudo
                : 'base',
            };
            transientPropertyOwnerships.set(
              propertyOwnershipKey(normalized),
              normalized,
            );
          });
          // Mark first, then install the transient stylesheet. Motion settling
          // can no longer win even for the single paint between both steps.
          refreshCanvasPropertyOwnershipMarkers();
        }
        const patches = Array.isArray(event.data.patches) ? event.data.patches : [];
        const attributePatches = Array.isArray(event.data.attributes) ? event.data.attributes : [];
        const textPatches = Array.isArray(event.data.texts) ? event.data.texts : [];
        let appliedEveryPatch = true;
        let staleStylesheet = false;
        if (event.data.designTokenCssText !== undefined) {
          if (typeof event.data.designTokenCssText !== 'string') {
            appliedEveryPatch = false;
          } else {
            const atom = 'design-tokens';
            if (!transientPreview && isSupersededLiveAtom(atom, mutationRevision)) {
              // A retry of an older token document is already represented by
              // the newer cumulative source and must never repaint it.
            } else {
            let tokenStyle = document.querySelector('style[data-kodety-design-tokens]');
            if (!tokenStyle) {
              tokenStyle = document.createElement('style');
              tokenStyle.setAttribute('data-kodety-design-tokens', '');
              document.head.append(tokenStyle);
            }
            tokenStyle.textContent = event.data.designTokenCssText;
            learnCustomPropertiesFromStyleElement(tokenStyle);
            if (tokenStyle.textContent !== event.data.designTokenCssText) {
              appliedEveryPatch = false;
            } else if (!transientPreview) {
              markLiveAtom(atom, mutationRevision);
            }
            }
          }
        }
        patches.forEach(patch => {
          if (!patch || typeof patch.path !== 'string' || typeof patch.property !== 'string') {
            appliedEveryPatch = false;
            return;
          }
          const atom = liveStyleAtom(patch.path, patch.property);
          if (
            !transientPreview
            && isSupersededLiveAtom(atom, mutationRevision)
          ) return;
          const elements = editorVisualElements(patch.path);
          if (!elements.length) {
            appliedEveryPatch = false;
            return;
          }
          let acceptedEveryTarget = true;
          elements.forEach(element => {
            // Runtime sections may clone the same authored child into several
            // variants. Every clone carrying the path is the same source atom;
            // accepting only the first leaves the currently visible instance
            // stale even though persistence succeeded.
            const accepted = applyLiveStylePatchToElement(element, patch);
            if (!accepted) {
              acceptedEveryTarget = false;
              appliedEveryPatch = false;
            }
          });
          if (acceptedEveryTarget) {
            if (transientPreview) {
              rememberPathPatch(
                transientPathStyles,
                patch.path,
                normalizeRuntimeStyleProperty(patch.property),
                patch,
              );
            } else {
              rememberPathPatch(
                committedPathStyles,
                patch.path,
                normalizeRuntimeStyleProperty(patch.property),
                patch,
              );
              forgetPathPatch(
                transientPathStyles,
                patch.path,
                normalizeRuntimeStyleProperty(patch.property),
              );
              if (normalizeRuntimeStyleProperty(patch.property) === 'display') {
                committedVisibilityPaths.add(patch.path);
              }
              markLiveAtom(atom, mutationRevision);
            }
          }
        });
        attributePatches.forEach(patch => {
          if (
            !patch
            || typeof patch.path !== 'string'
            || typeof patch.name !== 'string'
            || !/^[^\s"'<>/=]+$/.test(patch.name)
            || patch.name === 'style'
            || patch.name === 'data-html-editor-path'
            || (patch.value !== null && typeof patch.value !== 'string')
          ) {
            appliedEveryPatch = false;
            return;
          }
          const atom = liveAttributeAtom(patch.path, patch.name);
          if (
            !transientPreview
            && isSupersededLiveAtom(atom, mutationRevision)
          ) return;
          const elements = editorVisualElements(patch.path);
          if (!elements.length) {
            appliedEveryPatch = false;
            return;
          }
          let acceptedEveryTarget = true;
          elements.forEach(element => {
            if (!applyLiveAttributePatchToElement(element, patch)) {
              acceptedEveryTarget = false;
              appliedEveryPatch = false;
            }
          });
          if (acceptedEveryTarget && !transientPreview) {
            rememberPathPatch(
              committedPathAttributes,
              patch.path,
              patch.name,
              patch,
            );
            if (visibilityAttributeNames.has(patch.name.trim().toLowerCase())) {
              committedVisibilityPaths.add(patch.path);
            }
            markLiveAtom(atom, mutationRevision);
          }
        });
        textPatches.forEach(patch => {
          if (
            !patch
            || typeof patch.path !== 'string'
            || typeof patch.value !== 'string'
          ) {
            appliedEveryPatch = false;
            return;
          }
          const atom = 'text\\u0000' + patch.path;
          if (
            !transientPreview
            && isSupersededLiveAtom(atom, mutationRevision)
          ) return;
          const elements = editorVisualElements(patch.path);
          if (!elements.length) {
            appliedEveryPatch = false;
            return;
          }
          let appliedEveryTextTarget = true;
          elements.forEach(element => {
            // Text edits target authored leaves. Replacing children also
            // removes disposable GSAP/SplitText fragments on every runtime
            // clone while retaining the exact authored path.
            if (!applyLiveTextPatchToElement(element, patch)) {
              appliedEveryTextTarget = false;
              appliedEveryPatch = false;
            }
          });
          if (appliedEveryTextTarget && !transientPreview) {
            committedPathTexts.set(patch.path, { ...patch });
            markLiveAtom(atom, mutationRevision);
          }
        });
        if (event.data.interactionDocument !== undefined) {
          const interactionDocument = event.data.interactionDocument;
          const atom = 'interaction-document';
          if (
            !transientPreview
            && isSupersededLiveAtom(atom, mutationRevision)
          ) {
            // The newer interaction document is cumulative.
          } else if (
            !interactionDocument
            || !Array.isArray(interactionDocument.interactions)
            || window.__kodetyInteractions?.update?.(interactionDocument) !== true
          ) {
            appliedEveryPatch = false;
          } else {
            // Updating the interaction document destroys and recreates every
            // controller. Reapply the editor-owned pinned seek synchronously so
            // no later ACK or paint can snap the paused canvas back to rest.
            replayPinnedInteractionPreview();
            if (!transientPreview) markLiveAtom(atom, mutationRevision);
          }
        }
        if (typeof event.data.cssPath === 'string' && typeof event.data.cssText === 'string') {
          const atom = 'stylesheet\\u0000' + event.data.cssPath;
          staleStylesheet = !transientPreview
            && isSupersededLiveAtom(atom, mutationRevision);
          if (!staleStylesheet) {
          let styles = Array.from(document.querySelectorAll('style[data-editor-source]'))
            .filter(candidate => candidate.getAttribute('data-editor-source') === event.data.cssPath);
          // A newly selected/created stylesheet may not have existed when the
          // iframe document was built. Materialize it immediately instead of
          // accepting the source change while leaving the canvas visually stale.
          if (!styles.length) {
            const style = document.createElement('style');
            style.setAttribute('data-editor-source', event.data.cssPath);
            document.head.append(style);
            styles = [style];
          }
          styles.forEach(style => {
            style.textContent = event.data.cssText;
            const runtimeCssText = rewriteRuntimeCssText(
              style.textContent,
              () => rewriteRuntimeStyle(style),
            );
            if (runtimeCssText !== style.textContent) {
              style.textContent = runtimeCssText;
            }
            learnCustomPropertiesFromStyleElement(style);
          });
          refreshRuntimeFonts();
          if (!transientPreview) markLiveAtom(atom, mutationRevision);
          }
        }
        // Re-indexing paint chunks walks and measures the page. The confirmed
        // mutation does that once; transient scrub samples keep the existing
        // chunk map so the main thread stays inside the frame budget.
        if (!transientPreview) scheduleLiveStylePaintRefresh();
        const previewHandoff = !transientPreview && appliedEveryPatch
          ? beginPreviewPropertyHandoff(
            event.data.clearPreviewCssPath,
            event.data.clearPreviewProperties,
          )
          : null;
        const computedChecks = Array.isArray(event.data.checks) ? event.data.checks : [];
        computedChecks.forEach(check => {
          if (
            !check
            || typeof check.path !== 'string'
            || typeof check.property !== 'string'
            || typeof check.value !== 'string'
            || (check.mode !== undefined && check.mode !== 'equals' && check.mode !== 'not-equals')
          ) {
            appliedEveryPatch = false;
            return;
          }
          const atom = liveStyleAtom(check.path, check.property);
          if (
            !transientPreview
            && (
              staleStylesheet
              || isSupersededLiveAtom(atom, mutationRevision)
            )
          ) return;
          const elements = editorVisualElements(check.path);
          if (!elements.length) {
            appliedEveryPatch = false;
            return;
          }
          const expected = check.value.trim().replace(/\s+/g, ' ').toLowerCase();
          const matchesEveryTarget = elements.every(element => {
            const actual = getComputedStyle(element)
              .getPropertyValue(check.property)
              .trim()
              .replace(/\s+/g, ' ')
              .toLowerCase();
            return check.mode === 'not-equals'
              ? actual !== expected
              : actual === expected;
          });
          if (!matchesEveryTarget) appliedEveryPatch = false;
        });
        if (appliedEveryPatch) previewHandoff?.commit();
        else previewHandoff?.rollback();
        if (
          appliedEveryPatch
          && Number.isSafeInteger(event.data.revision)
          && event.data.revision >= 0
        ) {
          appliedEditorRevision = Math.max(appliedEditorRevision, event.data.revision);
          if (!transientPreview) scheduleCanvasVisibilitySnapshot();
        }
        requestAnimationFrame(() => {
          refreshDirectControls();
          // A transient inspector sample is superseded on the next RAF and is
          // deliberately outside project state. Re-snapshotting the selected
          // subtree for every scrub/color sample would send redundant work
          // back to React and reintroduce the lag this channel avoids.
          if (transientPreview) return;
          if (!selected?.isConnected) return;
          pendingSelectionDetail = {
            element: selected,
            sequence: selectionSnapshotSequence,
          };
          schedulePendingSelectionDetail();
        });
        if (
          appliedEveryPatch
          && typeof event.data.mutationId === 'string'
          && Number.isSafeInteger(event.data.revision)
        ) {
          postEditorMessage({
            type: 'html-editor-live-style-applied',
            mutationId: event.data.mutationId,
            revision: event.data.revision,
          });
        } else if (
          !transientPreview
          && typeof event.data.mutationId === 'string'
          && Number.isSafeInteger(event.data.revision)
        ) {
          // A negative acknowledgement keeps Infinite Canvas repairable. The
          // parent can back off and retry the exact canonical mutation instead
          // of silently quarantining it forever after a missing path or a
          // runtime rule that briefly won the computed-style check.
          postEditorMessage({
            type: 'html-editor-live-style-rejected',
            mutationId: event.data.mutationId,
            revision: event.data.revision,
          });
        }
        return;
      }
      if (event.data?.type === 'html-editor-cms-preview') {
        const nextPayload = event.data.payload || null;
        // The initial rows are already in the parsed document and may now be
        // owned by active animation timelines. Do not replace them with late
        // clones when the parent echoes the same payload on iframe load.
        if (cmsInitialHydrated && JSON.stringify(nextPayload) === initialCmsSignature) {
          // The payload may be identical while the user has just connected a
          // new field. Keep existing collection rows/timelines intact, but
          // project that already-loaded CMS item into the new binding now.
          refreshCmsSourceBindings();
          return;
        }
        cmsInitialHydrated = false;
        applyCmsPreview(nextPayload);
        [32, 100, 250, 600].forEach(delay => setTimeout(() => applyCmsPreview(lastCmsPayload), delay));
        return;
      }
      if (event.data?.type === 'html-editor-restore-scroll') {
        restoreCanvasScrollPositions(event.data.positions);
        return;
      }
      if (event.data?.type === 'html-editor-motion-control') {
        const timeline = window.__incodeMotionTimelines?.[event.data.timelineId];
        if (!timeline) return;
        prioritizeInteractionControl(event.data.action);
        if (event.data.action === 'restart') timeline.restart();
        else if (event.data.action === 'play') timeline.play();
        else if (event.data.action === 'reverse') timeline.reverse();
        else if (event.data.action === 'reset') timeline.reset?.();
        else if (event.data.action === 'pause') timeline.pause();
        else if (event.data.action === 'seek') (timeline.seek || timeline.pause)(event.data.time || 0);
        return;
      }
      if (event.data?.type === 'html-editor-interaction-control') {
        const timelineSequence = event.data.__kodetyTimelineSequence;
        if (
          Number.isSafeInteger(timelineSequence)
          && appliedTimelineControlSequences.has(timelineSequence)
        ) {
          acknowledgeInteractionControl(event.data);
          return;
        }
        if (Number.isSafeInteger(timelineSequence)) {
          if (timelineSequence < latestObservedTimelineControlSequence) {
            // Window.postMessage and MessagePort preserve order independently,
            // not relative to each other. A late bootstrap Seek must never
            // cancel a newer Play that crossed the other transport.
            acknowledgeInteractionControl(event.data);
            return;
          }
          if (timelineSequence === latestObservedTimelineControlSequence) {
            // This is a retry of work that is already queued on the native
            // paint clock or retry loop. Its eventual application owns the ACK.
            return;
          }
          latestObservedTimelineControlSequence = timelineSequence;
          // A newer timeline sample semantically supersedes an older command
          // still waiting for runtime bootstrap.
          clearInteractionControlRetry();
        }
        const commandId = typeof event.data.__kodetyCommandId === 'string'
          ? event.data.__kodetyCommandId
          : '';
        if (commandId && appliedInteractionControlCommandIds.has(commandId)) {
          acknowledgeInteractionControl(event.data);
          return;
        }
        const action = event.data.action;
        const interactionIds = interactionControlIds(event.data);
        const time = Number.isFinite(event.data.time)
          ? Math.max(0, event.data.time)
          : null;
        if ((action === 'seek' || action === 'pause') && interactionIds.length && time !== null) {
          pinnedInteractionPreview = { interactionIds, time };
        } else if (
          action === 'play'
          || action === 'restart'
          || action === 'reverse'
          || action === 'reset'
          || action === 'release'
        ) {
          pinnedInteractionPreview = null;
        }
        if (action === 'seek') {
          queueInteractionSeek(event.data);
          return;
        }
        // Play/Pause/Reset are transport barriers: they must take effect now
        // and prevent a Seek queued by the previous UI sample from repainting
        // over the new playback state one frame later.
        clearQueuedInteractionSeek(true);
        if (applyInteractionControl(event.data)) {
          rememberAppliedInteractionControl(event.data);
          acknowledgeInteractionControl(event.data);
          clearInteractionControlRetry();
        } else queueInteractionControlRetry(event.data);
        return;
      }
      if (event.data?.type === 'html-editor-insert-preview-at-point') {
        previewInsertDrop(insertionFromPoint(event.data.key, event.data.x, event.data.y));
        return;
      }
      if (event.data?.type === 'html-editor-insert-at-point') {
        commitInsertDrop(insertionFromPoint(event.data.key, event.data.x, event.data.y));
        return;
      }
      if (event.data?.type === 'html-editor-insert-clear-preview') {
        clearInsertDrop();
        return;
      }
      if (event.data?.type !== 'html-editor-select') return;
      // The exact target selection below updates the native marker first. Its
      // deferred detail pass then closes/reopens projected overlays, so Layers
      // navigation cannot put a whole-overlay scan in front of first paint.
      const findByPath = p => preferredEditorPathElement(p);
      let el = findByPath(event.data.path);
      // After a code edit the exact path may be gone. When re-selecting we walk
      // up to the nearest surviving ancestor so selection never silently targets
      // a different element; a plain user request stays exact.
      if (!el && event.data.fallbackToAncestor) {
        const parts = String(event.data.path).split('/').filter(Boolean);
        for (let length = parts.length - 1; length >= 0 && !el; length--) {
          el = findByPath(parts.slice(0, length).join('/'));
        }
      }
      if (!el) {
        document.querySelectorAll('[data-html-editor-selected]').forEach(item => {
          item.removeAttribute('data-html-editor-selected');
        });
        selected = null;
        const sequence = ++selectionSnapshotSequence;
        pendingSelectionDetail = { element: null, sequence };
        schedulePendingSelectionDetail();
        refreshDirectControls();
        // Nothing to select: clear any stale selection in the app.
        if (event.data.fallbackToAncestor) {
          postEditorMessage({
            type: 'html-editor-selection',
            breakpointId: canvasViewBreakpointId || 'base',
            payload: null,
            selectedPaths: [],
            revision: appliedEditorRevision,
            selectionSequence: sequence,
            detail: 'identity',
          });
        }
        return;
      }
      if (el.closest('[data-html-editor-locked]')) {
        return;
      }
      selectElement(el, Boolean(event.data.additive), 'editor');
      const selectionNeedsReveal = element => {
        const rect = element.getBoundingClientRect();
        // Hidden/technical zero-size nodes cannot be revealed by scrolling.
        // More importantly, a sticky or fixed layer may already be painted in
        // the viewport even though its authored flow position is elsewhere.
        // Calling scrollIntoView for that layer scrolls the page underneath it
        // and can temporarily hide sibling navigation while selecting Layers.
        if (rect.width <= 0 && rect.height <= 0) return false;
        const viewportWidth = Math.max(
          0,
          document.documentElement?.clientWidth || window.innerWidth || 0,
        );
        const viewportHeight = Math.max(
          0,
          document.documentElement?.clientHeight || window.innerHeight || 0,
        );
        if (!viewportWidth || !viewportHeight) return false;
        return (
          rect.bottom <= 0
          || rect.top >= viewportHeight
          || rect.right <= 0
          || rect.left >= viewportWidth
        );
      };
      if (
        event.data.reveal !== false
        && selectionNeedsReveal(el)
      ) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    const forwardCodeComponentUpdateAck = event => {
      const detail = event?.detail;
      if (
        !detail
        || typeof detail.instanceId !== 'string'
        || !detail.instanceId
        || !Number.isSafeInteger(detail.revision)
        || detail.revision < 0
      ) return;
      postEditorMessage({
        type: 'html-editor-code-component-applied',
        instanceId: detail.instanceId,
        revision: detail.revision,
      });
    };
    const forwardCodeComponentUpdateRejection = event => {
      const detail = event?.detail;
      if (
        !detail
        || typeof detail.instanceId !== 'string'
        || !detail.instanceId
        || !Number.isSafeInteger(detail.revision)
        || detail.revision < 0
      ) return;
      postEditorMessage({
        type: 'html-editor-code-component-rejected',
        instanceId: detail.instanceId,
        revision: detail.revision,
      });
    };
    addEventListener('coday:code-component-instance-applied', forwardCodeComponentUpdateAck);
    addEventListener('coday:code-component-instance-rejected', forwardCodeComponentUpdateRejection);
    addEventListener('message', receiveMainEditorMessage, true);
    // Opaque srcdoc frames can reliably send messages to the parent, while a
    // few embedded WebViews fail to deliver commands in the opposite direction.
    // Establish an iframe-owned MessagePort and redispatch its commands through
    // the same generation-checked listeners used by the normal Window channel.
    const deliveredEditorCommandIds = new Set();
    const deliverEditorCommand = data => {
      if (
        !data
        || typeof data !== 'object'
        || data.generation !== editorGeneration
        || typeof data.type !== 'string'
      ) return;
      const commandId = typeof data.__kodetyCommandId === 'string'
        ? data.__kodetyCommandId
        : '';
      if (commandId && deliveredEditorCommandIds.has(commandId)) return;
      if (commandId) {
        deliveredEditorCommandIds.add(commandId);
        if (deliveredEditorCommandIds.size > 512) {
          deliveredEditorCommandIds.delete(deliveredEditorCommandIds.values().next().value);
        }
      }
      const commandEvent = { data, source: parent };
      editorMessageListeners.forEach(listener => {
        try {
          listener(commandEvent);
        } catch {
          // One optional canvas subsystem must never block selection/styles.
        }
      });
      try {
        receiveMainEditorMessage(commandEvent, true);
      } catch {
        // The command channel remains alive for the next operation.
      }
    };
    const announceEditorCommandChannel = () => {
      const editorCommandChannel = new MessageChannel();
      // Keep the receiving endpoint rooted for the full document lifetime.
      window.__KODETY_EDITOR_COMMAND_PORT__?.close?.();
      window.__KODETY_EDITOR_COMMAND_PORT__ = editorCommandChannel.port1;
      editorCommandChannel.port1.addEventListener('message', event => {
        deliverEditorCommand(event.data);
      });
      editorCommandChannel.port1.start();
      parent.postMessage({
        type: 'html-editor-command-channel',
        generation: editorGeneration,
      }, '*', [editorCommandChannel.port2]);
    };
    window.__KODETY_ANNOUNCE_EDITOR_COMMAND_CHANNEL__ = announceEditorCommandChannel;
    announceEditorCommandChannel();
    if (Object.keys(initialScrollPositions).length) {
      restoreCanvasScrollPositions(initialScrollPositions);
    }
    // Sent only after every editor message listener above is installed. The
    // parent may now replay mutations that were committed while this srcdoc was
    // navigating, and can discard mutations already included in this revision.
    // When the ZIP supplies fonts, readiness additionally waits for the
    // transferred iframe-owned faces. This prevents fallback metrics from
    // becoming the initial selection/resize snapshot. Fail open if a corrupt
    // optional font never settles.
    bridgeMessageListenersReady = true;
    bufferedVisualsFailOpenTimer = setTimeout(() => {
      if (bufferedVisualsReadySent) return;
      visualSettlementTimeoutReasons.add('total');
      // Optional assets keep loading through their normal replacement paths;
      // this deadline only releases the already-rendered canvas to the user.
      surfacePaintSettled = true;
      bufferedFontsSettled = true;
      bufferedInitialAssetSweepComplete = true;
      bufferedVisibleImagesSettled = true;
      maybeSignalBufferedVisualsReady();
    }, ${PREVIEW_SURFACE_TOTAL_SETTLE_MS});
    // The authored DOM is complete because this bridge is appended at the end
    // of body. Hand it to the buffered canvas now; fonts, images and runtime
    // assets continue settling progressively instead of holding the old page
    // (or a white first frame) for several seconds.
    if (document.body.hasAttribute('data-kodety-component-editor')) {
      const componentRoot = Array.from(document.body.children).find(element => (
        (element instanceof HTMLElement || element instanceof SVGElement)
        && element.tagName !== 'SCRIPT'
        && element.tagName !== 'STYLE'
        && !element.hasAttribute('data-html-editor-bridge')
      ));
      if (componentRoot instanceof HTMLElement || componentRoot instanceof SVGElement) {
        componentInitialSizeReported = false;
        // Height that merely fills the page viewport is useful on an instance,
        // but it must not make the isolated master look hundreds of pixels
        // taller than its actual contents. Detect that one root dimension with
        // a bounded computed-style read; width deliberately stays untouched so
        // text continues wrapping at the active breakpoint.
        const rootRectBeforeProjection = componentRoot.getBoundingClientRect();
        const rootStyleBeforeProjection = getComputedStyle(componentRoot);
        const viewportHeightBeforeProjection = innerHeight
          || document.documentElement.clientHeight
          || 0;
        const fillHeightValue = value => !value
          || /^(?:auto|stretch|fill|100(?:\.0+)?%|100(?:d|s|l)?vh)$/i.test(String(value).trim());
        const inlineHeight = componentRoot.style.getPropertyValue('height').trim();
        const inlineMinHeight = componentRoot.style.getPropertyValue('min-height').trim();
        const classSignalsFillHeight = /(?:^|\s)(?:h-full|h-screen|min-h-full|min-h-screen)(?:\s|$)/i.test(
          componentRoot.getAttribute('class') || '',
        );
        const fillWidthValue = value => /^(?:auto|stretch|fill|100(?:\.0+)?%|100(?:d|s|l)?vw)$/i.test(
          String(value).trim(),
        );
        const computedHeightFillsViewport = viewportHeightBeforeProjection > 0
          && (
            Math.abs(rootRectBeforeProjection.height - viewportHeightBeforeProjection) <= 2
            || Number.parseFloat(rootStyleBeforeProjection.minHeight || '0') >= viewportHeightBeforeProjection - 2
          );
        if (
          classSignalsFillHeight
          || (computedHeightFillsViewport && fillHeightValue(inlineHeight) && fillHeightValue(inlineMinHeight))
          || (!inlineHeight && /^(?:100(?:\.0+)?%|100(?:d|s|l)?vh)$/i.test(rootStyleBeforeProjection.height))
        ) {
          componentRoot.setAttribute('data-html-editor-component-fit-height', '');
          const intrinsicHeightProjection = document.createElement('style');
          intrinsicHeightProjection.setAttribute('data-html-editor-component-intrinsic-height', '');
          intrinsicHeightProjection.textContent = '[data-html-editor-component-fit-height]{height:fit-content!important;min-height:0!important;max-height:none!important;flex-grow:0!important;flex-basis:auto!important}';
          document.head.appendChild(intrinsicHeightProjection);
        }
        let componentSizeFrame = 0;
        let lastComponentWidth = -1;
        let lastComponentHeight = -1;
        let lastComponentLayoutWidth = -1;
        let lastComponentLayoutHeight = -1;
        const reportComponentSize = (force = false) => {
          componentSizeFrame = 0;
          if (!componentRoot.isConnected) return;
          // O(1) geometry: ResizeObserver has already told us layout changed.
          // Walking every descendant and forcing computed style/rect for each
          // attribute mutation made typing in a large master quadratic.
          const rect = componentRoot.getBoundingClientRect();
          // innerWidth/innerHeight describe the actual iframe layout viewport
          // and remain stable when document scrollbars appear. clientWidth is
          // content-derived in this context, so feeding it back to the parent
          // can make a full-width component oscillate by the scrollbar width.
          const layoutViewportWidth = Math.max(1, Math.round(
            Number(innerWidth) || document.documentElement.clientWidth || rect.width,
          ));
          const layoutViewportHeight = Math.max(1, Math.round(
            Number(innerHeight) || document.documentElement.clientHeight || rect.height,
          ));
          const bodyRect = document.body.getBoundingClientRect();
          const layoutContentWidth = bodyRect.width || layoutViewportWidth;
          const rootFillsLayoutWidth = /(?:^|\s)(?:w-full|w-screen|min-w-full|min-w-screen|flex-1|grow)(?:\s|$)/i.test(
            componentRoot.getAttribute('class') || '',
          )
            || fillWidthValue(componentRoot.style.getPropertyValue('width'))
            || fillWidthValue(componentRoot.getAttribute('width'))
            || Math.abs(rect.width - layoutContentWidth) <= 2;
          const rootScrollWidth = Number(componentRoot.scrollWidth) || 0;
          const rootOffsetWidth = Number(componentRoot.offsetWidth) || 0;
          const intrinsicWidth = Math.max(
            rect.right - Math.min(0, rect.left),
            rootScrollWidth,
            rootOffsetWidth,
          );
          const width = Math.max(1, Math.min(100000, Math.ceil(
            rootFillsLayoutWidth ? layoutViewportWidth : intrinsicWidth,
          )));
          const rootScrollHeight = Number(componentRoot.scrollHeight) || 0;
          const rootOffsetHeight = Number(componentRoot.offsetHeight) || 0;
          const height = Math.max(1, Math.min(100000, Math.ceil(Math.max(
            rect.bottom - Math.min(0, rect.top),
            rootScrollHeight,
            rootOffsetHeight,
          ))));
          if (!Number.isFinite(width) || !Number.isFinite(height)) return;
          if (
            !force
            && width === lastComponentWidth
            && height === lastComponentHeight
            && layoutViewportWidth === lastComponentLayoutWidth
            && layoutViewportHeight === lastComponentLayoutHeight
          ) return;
          lastComponentWidth = width;
          lastComponentHeight = height;
          lastComponentLayoutWidth = layoutViewportWidth;
          lastComponentLayoutHeight = layoutViewportHeight;
          postEditorMessage({
            type: 'html-editor-component-size',
            width,
            height,
            layoutWidth: layoutViewportWidth,
            layoutHeight: layoutViewportHeight,
          });
          if (!componentInitialSizeReported) {
            componentInitialSizeReported = true;
            // Buffered promotion must use the component's real responsive
            // viewport from its very first visible frame. Emitting ready before
            // this size made the iframe flash at its stale/default dimensions.
            signalFirstContentReady();
          }
        };
        const scheduleComponentSize = () => {
          if (componentSizeFrame) return;
          componentSizeFrame = requestAnimationFrame(reportComponentSize);
        };
        const componentResizeObserver = typeof ResizeObserver === 'function'
          ? new ResizeObserver(scheduleComponentSize)
          : null;
        componentResizeObserver?.observe(componentRoot);
        componentResizeObserver?.observe(document.body);
        const componentMutationObserver = new MutationObserver(scheduleComponentSize);
        componentMutationObserver.observe(componentRoot, {
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden', 'width', 'height', 'src'],
          childList: true,
          characterData: true,
          subtree: true,
        });
        document.fonts?.ready?.then(scheduleComponentSize).catch(() => {});
        addEventListener('pagehide', () => {
          componentResizeObserver?.disconnect();
          componentMutationObserver.disconnect();
          if (componentSizeFrame) cancelAnimationFrame(componentSizeFrame);
        }, { once: true });
        // The bridge is at the end of body, so one bounded synchronous layout
        // read is enough to establish the first stable component viewport.
        // Later image/font/content changes stay asynchronous via ResizeObserver.
        reportComponentSize(true);
        requestAnimationFrame(() => {
          // Re-post even when geometry is unchanged. During a React commit the
          // new iframe can execute before the parent's generation-aware message
          // listener has committed; two paint-boundary retries prevent that
          // race from leaving visualReady permanently false.
          reportComponentSize(true);
          requestAnimationFrame(() => reportComponentSize(true));
        });
      } else {
        // Empty masters, text-only bodies and uncommon namespace roots (for
        // example MathML) must still release the parent's visual-ready gate.
        // Use the body as a bounded fallback surface instead of leaving the
        // buffered iframe permanently hidden while waiting for a root size
        // message that can never exist.
        let fallbackSizeFrame = 0;
        let lastFallbackSize = '';
        const reportFallbackComponentSize = (force = false) => {
          fallbackSizeFrame = 0;
          const bodyRect = document.body.getBoundingClientRect();
          const layoutWidth = Math.max(1, Math.round(
            Number(innerWidth) || document.documentElement.clientWidth || bodyRect.width,
          ));
          const layoutHeight = Math.max(1, Math.round(
            Number(innerHeight) || document.documentElement.clientHeight || bodyRect.height,
          ));
          const height = Math.max(1, Math.min(100000, Math.ceil(bodyRect.height)));
          const signature = layoutWidth + ':' + layoutHeight + ':' + height;
          if (!force && signature === lastFallbackSize) return;
          lastFallbackSize = signature;
          postEditorMessage({
            type: 'html-editor-component-size',
            width: layoutWidth,
            height,
            layoutWidth,
            layoutHeight,
          });
        };
        const scheduleFallbackComponentSize = () => {
          if (fallbackSizeFrame) return;
          fallbackSizeFrame = requestAnimationFrame(reportFallbackComponentSize);
        };
        const fallbackResizeObserver = typeof ResizeObserver === 'function'
          ? new ResizeObserver(scheduleFallbackComponentSize)
          : null;
        fallbackResizeObserver?.observe(document.body);
        const fallbackMutationObserver = new MutationObserver(scheduleFallbackComponentSize);
        fallbackMutationObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden', 'width', 'height', 'src'],
          childList: true,
          characterData: true,
          subtree: true,
        });
        addEventListener('pagehide', () => {
          fallbackResizeObserver?.disconnect();
          fallbackMutationObserver.disconnect();
          if (fallbackSizeFrame) cancelAnimationFrame(fallbackSizeFrame);
        }, { once: true });
        reportFallbackComponentSize(true);
        requestAnimationFrame(() => {
          reportFallbackComponentSize(true);
          requestAnimationFrame(() => reportFallbackComponentSize(true));
        });
      }
    }
    signalFirstContentReady();
    setTimeout(signalFirstContentReady, 0);
    if (runtimeFontAssetPaths.length) {
      fontFailOpenTimer = setTimeout(
        () => {
          visualSettlementTimeoutReasons.add('runtime-fonts');
          bufferedFontsSettled = true;
          revealCanvasAndSignalReady();
        },
        ${PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS},
      );
    }
    maybeSettleRuntimeFontsAndCanvas();
    // Always inspect visible images, including remote URLs that are not part
    // of the project asset manifest. The strong buffered-visuals signal waits
    // for them only up to its bounded media deadline.
    scheduleBufferedVisualAssetSettlement();
    };
    let editorBridgeStarted = false;
    const startEditorBridgeOnce = () => {
      if (editorBridgeStarted) return;
      editorBridgeStarted = true;
      startEditorBridge();
    };
    // Start immediately. A background tab may throttle both rAF and timers
    // before its first visible paint; deferring bootstrap there leaves the
    // asset/font and interaction message listeners absent, so the same project
    // can appear healthy in one tab and uninitialized in another.
    startEditorBridgeOnce();
  })()`;
  bridge.setAttribute('data-html-editor-bridge', '');
  if (!inspectionEnabled) {
    const nativeOverlaysRuntime = document.createElement('script');
    nativeOverlaysRuntime.setAttribute('data-kodety-native-overlays-runtime', '');
    nativeOverlaysRuntime.textContent = `(${nativeOverlayRuntimeBootstrap.toString()})();`;
    // Register delegated overlay actions before the Preview bridge installs
    // its own capture listener for link handoff and canvas inspection.
    document.body.appendChild(nativeOverlaysRuntime);
  }
  document.body.appendChild(bridge);
  const html = '<!doctype html>\n' + document.documentElement.outerHTML;
  let passiveHtml = '';
  if (infiniteCanvasNavigation) {
    // Only Infinite Canvas mounts passive reference breakpoints. Cloning,
    // walking and serializing a large imported document here for the ordinary
    // single-frame Canvas duplicated the heaviest part of every Display,
    // Undo/Redo and section-move refresh on the Builder's main thread.
    //
    // Keep the Infinite Canvas projection byte-for-byte equivalent, but avoid
    // constructing it at all until that mode is actually active.
    const passiveDocument = document.cloneNode(true) as Document;
    passiveDocument.documentElement.setAttribute('data-kodety-passive-breakpoint-preview', '');
    passiveDocument.documentElement.removeAttribute(
      'data-html-editor-scroll-restore-pending',
    );
    passiveDocument
      .querySelectorAll('[data-html-editor-scroll-restore-guard]')
      .forEach(element => element.remove());
    passiveDocument
      .querySelectorAll('[data-html-editor-selected], [data-html-editor-hover]')
      .forEach(element => {
        element.removeAttribute('data-html-editor-selected');
        element.removeAttribute('data-html-editor-hover');
    });
    passiveDocument
      .querySelectorAll('script:not([data-html-editor-bridge]):not([data-html-editor-motion-freeze]), link[rel="modulepreload"], link[rel="preload"][as="script"]')
      .forEach(element => element.remove());
    passiveDocument.querySelectorAll('*').forEach(element => {
      Array.from(element.attributes).forEach(attribute => {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      });
    });
    passiveHtml = '<!doctype html>\n' + passiveDocument.documentElement.outerHTML;
  }
  return {
    html,
    passiveHtml,
    objectUrls,
    // Kept in the parent as ordinary strings, sent only for an explicit
    // Framer capture. Re-embedding data assets into every srcdoc would double
    // their size merely to make this rare conversion reversible.
    captureAssetAliases: Object.fromEntries(Array.from(urlCache, ([path, url]) => [url, path])
      .filter(([, path]) => /^(?:image|audio|video|font)\//.test(project.files[path]?.mimeType || ''))),
    missingAssets: Array.from(missingAssets),
    runtimeAssetPaths: Object.keys(runtimeAssetUrls),
    runtimeFontAssetPaths: projectFontRuntimeAssetPaths,
    runtimeAssetAvailablePaths: availableRuntimeAssetPaths,
    generation: canvasGeneration,
    revision: canvasRevision,
  };
}
