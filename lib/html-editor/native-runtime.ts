const NATIVE_RUNTIME_MARKER = 'data-kodety-native-components-runtime';
const NATIVE_STYLE_MARKER = 'data-kodety-native-components-style';

/**
 * Overlay markup intentionally keeps its authored `display` declaration so the
 * Builder can edit the real flex/grid surface. The published document therefore
 * needs an author-level, important closed-state rule: the browser's native
 * `[hidden]` presentation can otherwise lose to that inline declaration before
 * the delegated controller starts.
 */
export const NATIVE_COMPONENTS_STYLES = String.raw`
[data-kodety-overlay]:not([data-kodety-overlay-ready="true"]) [data-kodety-overlay-surface],
[data-kodety-overlay][data-kodety-overlay-surface]:not([data-kodety-overlay-ready="true"]),
[data-kodety-overlay]:not([data-kodety-overlay-ready="true"]) [data-kodety-overlay-backdrop],
[data-kodety-overlay][data-kodety-overlay-backdrop]:not([data-kodety-overlay-ready="true"]),
[data-kodety-overlay]:not([data-state="open"]) [data-kodety-overlay-surface],
[data-kodety-overlay][data-kodety-overlay-surface]:not([data-state="open"]),
[data-kodety-overlay]:not([data-state="open"]) [data-kodety-overlay-backdrop],
[data-kodety-overlay][data-kodety-overlay-backdrop]:not([data-state="open"]),
[data-kodety-overlay] [hidden],
[data-kodety-overlay][hidden] {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

/**
 * Runtime authored components carry only semantic data attributes. This
 * delegated controller makes exported HTML self-contained without copying a
 * script into every modal, drawer or tooltip instance.
 */
export const NATIVE_COMPONENTS_RUNTIME = String.raw`(() => {
  if (window.__KODETY_NATIVE_COMPONENTS_VERSION__ === 2 && window.KodetyOverlays?.refresh) {
    window.KodetyOverlays.refresh();
    return;
  }
  window.__KODETY_NATIVE_COMPONENTS__ = true;
  window.__KODETY_NATIVE_COMPONENTS_VERSION__ = 2;
  const ROOT_SELECTOR = '[data-kodety-overlay]';
  const SURFACE_SELECTOR = '[data-kodety-overlay-surface]';
  const BACKDROP_SELECTOR = '[data-kodety-overlay-backdrop]';
  const CONTROL_SELECTOR = '[data-kodety-overlay-trigger], [data-kodety-overlay-open], [data-kodety-overlay-toggle]';
  const ACTION_SELECTOR = '[data-kodety-overlay-close], [data-kodety-overlay-open], [data-kodety-overlay-toggle], [data-kodety-overlay-trigger], [data-kodety-overlay-backdrop]';
  const roots = () => Array.from(document.querySelectorAll(ROOT_SELECTOR));
  const opened = [];
  const initialized = new WeakSet();
  const initializedSurfaces = new WeakMap();
  const initializedBackdrops = new WeakMap();
  const initializedDialogSurfaces = new WeakSet();
  const dialogOwners = new WeakMap();
  const tooltipTriggers = new WeakSet();
  const tooltipSurfaces = new WeakSet();
  const tooltipTimers = new WeakMap();
  const clearTooltipTimer = root => {
    const timerState = tooltipTimers.get(root);
    if (!timerState) return;
    clearTimeout(timerState.value);
    timerState.value = 0;
  };
  const restoreTargets = new WeakMap();
  const topLayerRestores = new WeakMap();
  const positionRestores = new WeakMap();
  const scrollLockedRoots = new WeakSet();
  let locks = 0;
  let savedOverflow = '';
  const nearestRoot = element => element && element.closest && element.closest(ROOT_SELECTOR);
  const owned = (root, selector) => root && Array.from(root.querySelectorAll(selector)).find(node => nearestRoot(node) === root) || null;
  const surfaceForRoot = root => root && (root.matches(SURFACE_SELECTOR)
    ? root
    : owned(root, SURFACE_SELECTOR) || (!root.querySelector(CONTROL_SELECTOR + ', ' + BACKDROP_SELECTOR) ? root : null));
  const tokensForControl = control => [
    'data-kodety-overlay-target',
    'data-kodety-overlay-toggle',
    'data-kodety-overlay-open',
    'data-kodety-overlay-trigger',
    'data-kodety-overlay-close',
    'aria-controls',
  ].flatMap(name => {
    const value = control && control.getAttribute(name) || '';
    return value && !['true', 'false'].includes(value.trim().toLowerCase())
      ? value.trim().split(/\s+/).map(token => token.replace(/^#/, '')).filter(Boolean)
      : [];
  });
  const rootForToken = rawToken => {
    const token = String(rawToken || '').replace(/^#/, '').trim();
    if (!token) return null;
    for (const root of roots()) {
      const surface = surfaceForRoot(root);
      if (root.id === token || root.getAttribute('data-kodety-overlay') === token || surface && surface.id === token) return root;
    }
    return nearestRoot(document.getElementById(token));
  };
  const resolve = control => {
    for (const token of tokensForControl(control)) {
      const root = rootForToken(token);
      if (root) return root;
    }
    return nearestRoot(control);
  };
  const controlsForRoot = root => Array.from(document.querySelectorAll(CONTROL_SELECTOR)).filter(control => nearestRoot(control) === root || resolve(control) === root);
  const showTopLayer = (element, zIndex) => {
    if (!(element instanceof HTMLElement)) return;
    if (!topLayerRestores.has(element)) topLayerRestores.set(element, {
      popover: element.getAttribute('popover'),
      zIndex: element.style.getPropertyValue('z-index'),
      zIndexPriority: element.style.getPropertyPriority('z-index'),
    });
    element.style.setProperty('z-index', String(zIndex));
    if (element instanceof HTMLDialogElement || typeof element.showPopover !== 'function') return;
    element.setAttribute('popover', 'manual');
    try { element.showPopover(); } catch (_) {}
  };
  const hideTopLayer = element => {
    if (!(element instanceof HTMLElement)) return;
    if (!(element instanceof HTMLDialogElement) && typeof element.hidePopover === 'function') {
      try { element.hidePopover(); } catch (_) {}
    }
    const restore = topLayerRestores.get(element);
    if (!restore) return;
    if (restore.popover === null) element.removeAttribute('popover');
    else element.setAttribute('popover', restore.popover);
    if (restore.zIndex) element.style.setProperty('z-index', restore.zIndex, restore.zIndexPriority);
    else element.style.removeProperty('z-index');
    topLayerRestores.delete(element);
  };
  const liveParts = root => ({
    surface: surfaceForRoot(root),
    backdrop: root && (root.matches(BACKDROP_SELECTOR) ? root : owned(root, BACKDROP_SELECTOR)),
    triggers: root ? controlsForRoot(root) : [],
  });
  const cachedPartForRoot = (root, part) => {
    if (!(root instanceof Element) || !(part instanceof HTMLElement)) return null;
    if (part === root) return part;
    if (!root.contains(part)) return null;
    const owner = nearestRoot(part);
    return !owner || owner === root ? part : null;
  };
  const parts = root => {
    const live = liveParts(root);
    return {
      surface: live.surface || cachedPartForRoot(root, initializedSurfaces.get(root)),
      backdrop: live.backdrop || cachedPartForRoot(root, initializedBackdrops.get(root)),
      triggers: live.triggers,
    };
  };
  const modal = root => {
    const kind = root && root.getAttribute('data-kodety-overlay') || '';
    const configured = root && root.getAttribute('data-kodety-overlay-modal');
    if (configured !== null && configured !== undefined) return !['0', 'false', 'no', 'off'].includes(configured.trim().toLowerCase());
    return ['modal', 'drawer', 'checkout', 'cart'].includes(kind);
  };
  const lock = () => {
    if (locks++ > 0) return;
    savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  };
  const unlock = () => {
    locks = Math.max(0, locks - 1);
    if (!locks) document.documentElement.style.overflow = savedOverflow;
  };
  const findRoot = target => {
    if (target instanceof Element) {
      if (target.matches(ROOT_SELECTOR) || initialized.has(target) || opened.includes(target)) return target;
      return resolve(target) || nearestRoot(target);
    }
    if (typeof target !== 'string' || !target) return null;
    const byToken = rootForToken(target);
    if (byToken) return byToken;
    try {
      const selected = document.querySelector(target);
      if (selected) return selected.matches(ROOT_SELECTOR) ? selected : nearestRoot(selected);
    } catch (_) {}
    return null;
  };
  const position = root => {
    if (!root || root.dataset.state !== 'open') return;
    const kind = root.getAttribute('data-kodety-overlay') || '';
    const mode = (root.getAttribute('data-kodety-overlay-mode') || root.getAttribute('data-kodety-overlay-position') || '').trim().toLowerCase();
    if (mode ? mode !== 'anchored' : !['popover', 'tooltip', 'menu'].includes(kind)) return;
    const overlay = parts(root);
    const trigger = overlay.triggers.find(node => node.getAttribute('aria-expanded') === 'true') || overlay.triggers[0];
    if (!(overlay.surface instanceof HTMLElement) || !(trigger instanceof HTMLElement)) return;
    const surface = overlay.surface;
    if (!positionRestores.has(surface)) positionRestores.set(surface, Object.fromEntries(
      ['position', 'inset', 'top', 'right', 'bottom', 'left', 'margin', 'transform']
        .map(property => [property, surface.style.getPropertyValue(property)]),
    ));
    surface.style.position = 'fixed';
    surface.style.inset = 'auto';
    surface.style.right = 'auto';
    surface.style.bottom = 'auto';
    surface.style.transform = 'none';
    const gap = 8;
    const margin = 8;
    const anchor = trigger.getBoundingClientRect();
    const box = surface.getBoundingClientRect();
    let placement = root.getAttribute('data-kodety-overlay-placement') || (kind === 'tooltip' ? 'top' : 'bottom-start');
    const room = { top: anchor.top - margin, bottom: innerHeight - anchor.bottom - margin, left: anchor.left - margin, right: innerWidth - anchor.right - margin };
    if (placement.startsWith('bottom') && room.bottom < box.height + gap && room.top > room.bottom) placement = placement.replace('bottom', 'top');
    if (placement.startsWith('top') && room.top < box.height + gap && room.bottom > room.top) placement = placement.replace('top', 'bottom');
    if (placement.startsWith('right') && room.right < box.width + gap && room.left > room.right) placement = placement.replace('right', 'left');
    if (placement.startsWith('left') && room.left < box.width + gap && room.right > room.left) placement = placement.replace('left', 'right');
    const side = placement.split('-')[0];
    const alignment = placement.split('-')[1] || 'center';
    let top = anchor.top + (anchor.height - box.height) / 2;
    let left = anchor.left + (anchor.width - box.width) / 2;
    if (side === 'top') top = anchor.top - box.height - gap;
    else if (side === 'bottom') top = anchor.bottom + gap;
    else if (side === 'left') left = anchor.left - box.width - gap;
    else if (side === 'right') left = anchor.right + gap;
    if (side === 'top' || side === 'bottom') {
      if (alignment === 'start') left = anchor.left;
      else if (alignment === 'end') left = anchor.right - box.width;
    } else {
      if (alignment === 'start') top = anchor.top;
      else if (alignment === 'end') top = anchor.bottom - box.height;
    }
    surface.style.top = Math.max(margin, Math.min(innerHeight - box.height - margin, top)) + 'px';
    surface.style.left = Math.max(margin, Math.min(innerWidth - box.width - margin, left)) + 'px';
    root.setAttribute('data-kodety-overlay-resolved-placement', placement);
  };
  const restorePosition = surface => {
    if (!(surface instanceof HTMLElement)) return;
    const restore = positionRestores.get(surface);
    if (!restore) return;
    Object.entries(restore).forEach(([property, value]) => {
      if (value) surface.style.setProperty(property, value);
      else surface.style.removeProperty(property);
    });
    positionRestores.delete(surface);
  };
  const setPartOpen = (element, zIndex) => {
    if (!(element instanceof HTMLElement)) return;
    element.hidden = false;
    element.removeAttribute('inert');
    element.removeAttribute('data-html-editor-overlay-forced-open');
    element.setAttribute('aria-hidden', 'false');
    element.setAttribute('data-state', 'open');
    showTopLayer(element, zIndex);
  };
  const setPartClosed = element => {
    if (!(element instanceof HTMLElement)) return;
    if (element instanceof HTMLDialogElement) {
      if (element.open) {
        try { element.close(); } catch (_) { element.removeAttribute('open'); }
      } else {
        element.removeAttribute('open');
      }
    }
    hideTopLayer(element);
    restorePosition(element);
    element.hidden = true;
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('data-state', 'closed');
    element.removeAttribute('data-html-editor-overlay-forced-open');
  };
  const setOverlayPartsOpen = (root, overlay) => {
    setPartOpen(overlay.backdrop, 2147483646);
    setPartOpen(overlay.surface, 2147483647);
    if (overlay.surface instanceof HTMLDialogElement && !overlay.surface.open) {
      try { modal(root) ? overlay.surface.showModal() : overlay.surface.show(); }
      catch (_) { overlay.surface.setAttribute('open', ''); }
    }
    overlay.triggers.forEach(node => {
      node.setAttribute('aria-expanded', 'true');
      node.setAttribute('data-state', 'open');
    });
  };
  const open = (target, opener) => {
    const root = findRoot(target);
    if (!(root instanceof HTMLElement) || !root.isConnected || !root.matches(ROOT_SELECTOR)) return false;
    clearTooltipTimer(root);
    initializeRoot(root);
    if (root.getAttribute('data-kodety-overlay') === 'checkout'
      && root.getAttribute('data-kodefy-checkout-ready') !== 'true') return false;
    const overlay = parts(root);
    if (!(overlay.surface instanceof HTMLElement)) return false;
    if (opened.includes(root)) {
      root.dataset.state = 'open';
      root.setAttribute('data-kodety-overlay-ready', 'true');
      setOverlayPartsOpen(root, overlay);
      position(root);
      return true;
    }
    restoreTargets.set(root, opener instanceof HTMLElement ? opener : document.activeElement);
    root.dataset.state = 'open';
    root.setAttribute('data-kodety-overlay-ready', 'true');
    root.removeAttribute('data-html-editor-overlay-forced-open');
    setOverlayPartsOpen(root, overlay);
    opened.push(root);
    if (modal(root) && root.getAttribute('data-kodety-overlay-lock-scroll') !== 'false') {
      lock();
      scrollLockedRoots.add(root);
    }
    position(root);
    if (modal(root) && root.getAttribute('data-kodety-overlay-autofocus') !== 'false') {
      requestAnimationFrame(() => {
        const focus = overlay.surface.querySelector('[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]') || overlay.surface;
        if (focus && focus.focus) focus.focus({ preventScroll: true });
      });
    }
    root.dispatchEvent(new CustomEvent('kodety:overlay-open', { bubbles: true, detail: { root, surface: overlay.surface, opener } }));
    return true;
  };
  const close = (target, options = {}) => {
    const root = findRoot(target);
    if (!root) return false;
    clearTooltipTimer(root);
    const overlay = parts(root);
    const openIndex = opened.lastIndexOf(root);
    const wasOpen = openIndex >= 0;
    while (opened.includes(root)) opened.splice(opened.lastIndexOf(root), 1);
    root.dataset.state = 'closed';
    root.removeAttribute('data-html-editor-overlay-forced-open');
    setPartClosed(overlay.surface);
    setPartClosed(overlay.backdrop);
    overlay.triggers.forEach(node => {
      node.setAttribute('aria-expanded', 'false');
      node.setAttribute('data-state', 'closed');
    });
    if (wasOpen && scrollLockedRoots.has(root)) unlock();
    scrollLockedRoots.delete(root);
    const restore = restoreTargets.get(root);
    restoreTargets.delete(root);
    if (wasOpen
      && root.getAttribute('data-kodety-overlay') !== 'tooltip'
      && options.restoreFocus !== false
      && restore instanceof HTMLElement
      && restore.isConnected) restore.focus({ preventScroll: true });
    if (wasOpen && options.silent !== true) root.dispatchEvent(new CustomEvent('kodety:overlay-close', { bubbles: true, detail: { root, surface: overlay.surface } }));
    return true;
  };
  const toggle = (target, opener) => {
    const root = findRoot(target);
    return root && opened.includes(root) ? close(root) : open(root, opener);
  };
  const installDialogHandlers = (root, surface) => {
    if (!(surface instanceof HTMLDialogElement)) return;
    dialogOwners.set(surface, root);
    if (initializedDialogSurfaces.has(surface)) return;
    initializedDialogSurfaces.add(surface);
    const syncNativeClose = () => {
      const owner = dialogOwners.get(surface);
      if (owner && opened.includes(owner) && !surface.open) close(owner);
    };
    surface.addEventListener('close', syncNativeClose);
    surface.addEventListener('cancel', () => queueMicrotask(syncNativeClose));
  };
  const forgetInitializedParts = root => {
    const surface = initializedSurfaces.get(root);
    if (surface && dialogOwners.get(surface) === root) dialogOwners.delete(surface);
    initializedSurfaces.delete(root);
    initializedBackdrops.delete(root);
    initialized.delete(root);
  };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const action = target.closest(ACTION_SELECTOR);
    if (action) {
      const bareKodefyCheckout = action.hasAttribute('data-kodefy-checkout')
        && action.hasAttribute('data-kodety-overlay-trigger')
        && !action.hasAttribute('data-kodety-overlay-open')
        && !action.hasAttribute('data-kodety-overlay-toggle')
        && !action.hasAttribute('data-kodety-overlay-close');
      if (bareKodefyCheckout) return;
      const root = resolve(action);
      if (root) {
        event.preventDefault();
        if (action.hasAttribute('data-kodety-overlay-close') || action.matches(BACKDROP_SELECTOR)) close(root);
        else if (action.hasAttribute('data-kodety-overlay-toggle') || action.hasAttribute('data-kodety-overlay-trigger') && !action.hasAttribute('data-kodety-overlay-open')) toggle(root, action);
        else open(root, action);
        return;
      }
    }
    const lightboxOpen = target.closest('[data-kodety-lightbox-open]');
    if (lightboxOpen) {
      event.preventDefault();
      const root = lightboxOpen.closest('[data-kodety-lightbox]');
      const dialog = root && root.querySelector('[data-kodety-lightbox-dialog]');
      const thumb = root && root.querySelector('[data-kodety-lightbox-thumb]');
      const image = dialog && dialog.querySelector('[data-kodety-lightbox-image]');
      const source = root && root.getAttribute('data-kodety-lightbox-src') || thumb && (thumb.currentSrc || thumb.getAttribute('src')) || '';
      if (image instanceof HTMLImageElement) { if (source) image.src = source; else image.removeAttribute('src'); image.alt = thumb && thumb.getAttribute('alt') || ''; }
      if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
      return;
    }
    const lightboxClose = target.closest('[data-kodety-lightbox-close]');
    if (lightboxClose) { event.preventDefault(); const dialog = lightboxClose.closest('dialog'); if (dialog && dialog.close) dialog.close(); return; }
    document.querySelectorAll('[data-kodety-locale-selector][open]').forEach(selector => { if (!selector.contains(target)) selector.removeAttribute('open'); });
    for (const root of opened.slice().reverse()) {
      if (root.contains(target) || controlsForRoot(root).some(control => control.contains(target))) return;
      const outside = root.getAttribute('data-kodety-overlay-close-outside');
      if (outside !== null && ['0', 'false', 'no', 'off'].includes(outside.trim().toLowerCase())) return;
      close(root, { restoreFocus: false });
      return;
    }
  });
  document.addEventListener('keydown', event => {
    const root = opened[opened.length - 1];
    if (!root) return;
    if (event.key === 'Escape' && root.getAttribute('data-kodety-overlay-close-escape') !== 'false') { event.preventDefault(); close(root); return; }
    if (event.key !== 'Tab' || !modal(root)) return;
    const surface = root.querySelector('[data-kodety-overlay-surface]');
    if (!(surface instanceof HTMLElement)) return;
    const focusable = Array.from(surface.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(node => !node.hidden);
    if (!focusable.length) { event.preventDefault(); surface.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  let frame = 0;
  const reposition = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => opened.forEach(position)); };
  addEventListener('resize', reposition, { passive: true });
  addEventListener('scroll', reposition, { passive: true, capture: true });
  const installTooltipHandlers = (root, overlay) => {
    if (root.getAttribute('data-kodety-overlay') !== 'tooltip') return;
    let timerState = tooltipTimers.get(root);
    if (!timerState) {
      timerState = { value: 0 };
      tooltipTimers.set(root, timerState);
    }
    const show = event => {
      clearTooltipTimer(root);
      timerState.value = setTimeout(() => open(root, event.currentTarget), 80);
    };
    const hide = () => {
      clearTooltipTimer(root);
      timerState.value = setTimeout(() => close(root, { restoreFocus: false }), 100);
    };
    overlay.triggers.forEach(trigger => {
      if (tooltipTriggers.has(trigger)) return;
      tooltipTriggers.add(trigger);
      trigger.addEventListener('pointerenter', show);
      trigger.addEventListener('pointerleave', hide);
      trigger.addEventListener('focus', show);
      trigger.addEventListener('blur', hide);
    });
    if (overlay.surface && !tooltipSurfaces.has(overlay.surface)) {
      tooltipSurfaces.add(overlay.surface);
      overlay.surface.addEventListener('pointerenter', () => clearTooltipTimer(root));
      overlay.surface.addEventListener('pointerleave', hide);
    }
  };
  function initializeRoot(root) {
    if (!(root instanceof HTMLElement)) return;
    const overlay = liveParts(root);
    const previousSurface = initializedSurfaces.get(root);
    const previousBackdrop = initializedBackdrops.get(root);
    if (!(overlay.surface instanceof HTMLElement)) {
      if (initialized.has(root) || opened.includes(root)) close(root, { restoreFocus: false, silent: true });
      forgetInitializedParts(root);
      return;
    }
    if (previousSurface && previousSurface !== overlay.surface) {
      if (cachedPartForRoot(root, previousSurface)) setPartClosed(previousSurface);
      if (dialogOwners.get(previousSurface) === root) dialogOwners.delete(previousSurface);
      // An incrementally inserted wrapper can briefly be mistaken for a
      // root-as-surface overlay. Once its real surface arrives the wrapper must
      // regain normal layout so its trigger remains usable.
      if (previousSurface === root) {
        root.hidden = false;
        root.removeAttribute('inert');
        root.removeAttribute('aria-hidden');
      }
    }
    initializedSurfaces.set(root, overlay.surface);
    installDialogHandlers(root, overlay.surface);
    if (previousBackdrop && previousBackdrop !== overlay.backdrop && cachedPartForRoot(root, previousBackdrop)) {
      setPartClosed(previousBackdrop);
    }
    if (overlay.backdrop instanceof HTMLElement) initializedBackdrops.set(root, overlay.backdrop);
    else initializedBackdrops.delete(root);
    root.removeAttribute('data-kodety-overlay-default-open');
    root.removeAttribute('data-html-editor-overlay-forced-open');
    if (!initialized.has(root)) {
      initialized.add(root);
      close(root, { restoreFocus: false, silent: true });
    } else if (opened.includes(root)) {
      root.dataset.state = 'open';
      setOverlayPartsOpen(root, overlay);
      position(root);
    } else {
      close(root, { restoreFocus: false, silent: true });
    }
    root.setAttribute('data-kodety-overlay-ready', 'true');
    installTooltipHandlers(root, parts(root));
  }
  const refresh = (scope = document) => {
    const candidates = [];
    if (scope instanceof Element) {
      const owner = scope.matches(ROOT_SELECTOR) ? scope : nearestRoot(scope);
      if (owner) candidates.push(owner);
    }
    if (scope && typeof scope.querySelectorAll === 'function') {
      candidates.push(...scope.querySelectorAll(ROOT_SELECTOR));
    }
    Array.from(new Set(candidates)).forEach(initializeRoot);
    document.documentElement.setAttribute('data-kodety-native-components-ready', 'true');
  };
  window.KodetyOverlays = { open, close, toggle, position, refresh };
  refresh();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(mutations => {
      let refreshNeeded = false;
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (mutation.attributeName === 'data-kodety-overlay'
            && target instanceof HTMLElement
            && initialized.has(target)
            && !target.matches(ROOT_SELECTOR)) {
            close(target, { restoreFocus: false, silent: true });
            forgetInitializedParts(target);
          }
          refreshNeeded = true;
          return;
        }
        mutation.removedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          refreshNeeded = true;
          const removedRoots = node.matches(ROOT_SELECTOR)
            ? [node, ...node.querySelectorAll(ROOT_SELECTOR)]
            : Array.from(node.querySelectorAll(ROOT_SELECTOR));
          removedRoots.forEach(root => {
            close(root, { restoreFocus: false, silent: true });
            forgetInitializedParts(root);
          });
        });
        if (Array.from(mutation.addedNodes).some(node => node instanceof Element)) refreshNeeded = true;
      });
      if (refreshNeeded) refresh();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-kodety-overlay',
        'data-kodety-overlay-surface',
        'data-kodety-overlay-backdrop',
        'data-kodety-overlay-trigger',
        'data-kodety-overlay-open',
        'data-kodety-overlay-toggle',
        'data-kodety-overlay-target',
        'aria-controls',
      ],
    });
  }
})();`;

export function injectNativeComponentsRuntime(html: string, force = false): string {
  if (!force && !/(?:data-kodety-overlay|data-kodety-lightbox|data-kodety-locale-selector)/.test(html)) return html;
  const currentRuntime = new RegExp(`<script\\b(?=[^>]*\\b${NATIVE_RUNTIME_MARKER}\\s*=\\s*(["'])2\\1)[^>]*>`, 'i');
  const currentStyle = new RegExp(`<style\\b(?=[^>]*\\b${NATIVE_STYLE_MARKER}\\s*=\\s*(["'])2\\1)[^>]*>`, 'i');
  if (currentRuntime.test(html) && currentStyle.test(html)) return html;
  const markedRuntime = new RegExp(`<script\\b(?=[^>]*\\b${NATIVE_RUNTIME_MARKER}(?:\\s*=|\\s|>))[^>]*>[\\s\\S]*?<\\/script\\s*>`, 'gi');
  const markedStyle = new RegExp(`<style\\b(?=[^>]*\\b${NATIVE_STYLE_MARKER}(?:\\s*=|\\s|>))[^>]*>[\\s\\S]*?<\\/style\\s*>`, 'gi');
  let materialized = html.replace(markedRuntime, '').replace(markedStyle, '');
  const style = `<style ${NATIVE_STYLE_MARKER}="2">${NATIVE_COMPONENTS_STYLES}</style>`;
  if (/<\/head\s*>/i.test(materialized)) {
    materialized = materialized.replace(/<\/head\s*>/i, `${style}</head>`);
  } else if (/<html\b[^>]*>/i.test(materialized)) {
    materialized = materialized.replace(/<html\b[^>]*>/i, match => `${match}<head>${style}</head>`);
  } else if (/<!doctype\b[^>]*>/i.test(materialized)) {
    materialized = materialized.replace(/<!doctype\b[^>]*>/i, match => `${match}${style}`);
  } else if (/<body\b[^>]*>/i.test(materialized)) {
    materialized = materialized.replace(/<body\b[^>]*>/i, match => `${style}${match}`);
  } else {
    materialized = `${style}${materialized}`;
  }
  const runtime = `<script ${NATIVE_RUNTIME_MARKER}="2">${NATIVE_COMPONENTS_RUNTIME}</script>`;
  return /<\/body\s*>/i.test(materialized)
    ? materialized.replace(/<\/body\s*>/i, `${runtime}</body>`)
    : `${materialized}${runtime}`;
}
