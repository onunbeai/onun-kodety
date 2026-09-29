(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  const encoder = new TextEncoder();
  const MAX_CAPTURE_HTML_CHARS = 12_000_000;
  const MAX_CAPTURE_PAYLOAD_BYTES = 32 * 1024 * 1024;
  const EARLY_ANIMATION_WINDOW_MS = 30_000;
  const MAX_EVENTS = 1500, MAX_MUTATIONS = 2500, MAX_ANIMATIONS = 3000;
  const STYLE_PROPERTIES = [
    'opacity', 'transform', 'transformOrigin', 'backgroundColor', 'color', 'borderColor',
    'borderRadius', 'boxShadow', 'filter', 'backdropFilter', 'clipPath', 'visibility',
    'width', 'height', 'maxWidth', 'maxHeight', 'translate', 'rotate', 'scale',
  ];
  const SAFE_RUNTIME_STYLES = new Set([
    'opacity', 'transform', 'transformOrigin', 'backgroundColor', 'color', 'borderColor',
    'borderRadius', 'boxShadow', 'filter', 'backdropFilter', 'clipPath', 'visibility',
    'translate', 'rotate', 'scale',
  ]);
  const CONTROL_KEYS = new Set(['offset', 'computedOffset', 'easing', 'composite']);
  const session = {
    state: 'idle', startedAt: null, stoppedAt: null, events: [], animations: [],
    mutations: [], viewports: [], breakpoints: [], assets: [], pages: [], initialHtml: '',
  };
  const baseline = new Map();
  const animationKeys = new Set();
  const earlyAnimationKeys = new Set();
  let seenAnimationObjects = new WeakSet();
  const earlyAnimations = [];
  let idCounter = 0, observer = null, mutationSuppressed = 0, lastHover = null, animationFrame = 0, detectedPlatform = null;
  let earlyAnimationBufferActive = true;
  const earlyAnimationDeadline = Date.now() + EARLY_ANIMATION_WINDOW_MS;
  let recentTrigger = { type: 'load', id: '', expires: 0 };

  function status() {
    return { state: session.state, platform: detectPlatform().id, events: session.events.length, animations: session.animations.length, mutations: session.mutations.length };
  }
  function publishStatus() {
    chrome.runtime.sendMessage({ type: 'KODETY_BACKGROUND_PAGE_STATUS', status: status() }).catch(() => {});
  }
  function suppress(task) { mutationSuppressed++; try { return task(); } finally { mutationSuppressed--; } }
  function captureId(element) {
    if (!(element instanceof Element)) return '';
    let id = element.getAttribute('data-kodety-capture-id');
    if (id) return id;
    id = `k${++idCounter}`;
    suppress(() => element.setAttribute('data-kodety-capture-id', id));
    return id;
  }
  function selectorFor(element) { const id = captureId(element); return id ? `[data-kodety-capture-id="${id}"]` : ''; }
  function labelFor(element) {
    return element.getAttribute('data-framer-name') || element.getAttribute('aria-label') || element.id ||
      String(element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) || element.tagName.toLowerCase();
  }
  function styleSnapshot(element) {
    try {
      const style = getComputedStyle(element), values = {};
      STYLE_PROPERTIES.forEach(property => { values[property] = style[property]; });
      return values;
    } catch { return {}; }
  }
  function elementSnapshot(element) {
    return {
      id: captureId(element), tag: element.tagName.toLowerCase(), label: labelFor(element),
      styles: styleSnapshot(element), className: element.getAttribute('class') || '',
      hidden: element.hidden, ariaHidden: element.getAttribute('aria-hidden'),
    };
  }
  function snapshotTree(root, limit = 45) {
    if (!(root instanceof Element)) return [];
    return [root, ...Array.from(root.querySelectorAll('*')).slice(0, limit - 1)].map(elementSnapshot);
  }
  function diffSnapshots(before, after) {
    const previous = new Map(before.map(item => [item.id, item])), changes = [];
    after.forEach(item => {
      const old = previous.get(item.id); if (!old) return;
      const styles = {};
      STYLE_PROPERTIES.forEach(property => { if (old.styles[property] !== item.styles[property]) styles[property] = item.styles[property]; });
      const attributes = {};
      if (old.className !== item.className) attributes.class = item.className;
      if (old.hidden !== item.hidden) attributes.hidden = item.hidden;
      if (old.ariaHidden !== item.ariaHidden) attributes['aria-hidden'] = item.ariaHidden;
      if (Object.keys(styles).length || Object.keys(attributes).length) {
        const previousStyles = {}, previousAttributes = {};
        Object.keys(styles).forEach(property => { previousStyles[property] = old.styles[property]; });
        Object.keys(attributes).forEach(attribute => {
          previousAttributes[attribute] = attribute === 'class' ? old.className : attribute === 'hidden' ? old.hidden : old.ariaHidden;
        });
        changes.push({ targetId: item.id, label: item.label, styles, attributes, previousStyles, previousAttributes });
      }
    });
    return changes;
  }
  function interactiveTarget(node) {
    if (!(node instanceof Element)) return null;
    return node.closest('a,button,input,textarea,select,summary,[role="button"],[tabindex],[data-framer-name],[data-kodety-capture]') || node;
  }
  function taskDelay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function setRecentTrigger(type, element) {
    recentTrigger = { type, id: captureId(element), expires: Date.now() + 1500 };
  }
  async function recordState(type, trigger, delay = 110) {
    if (session.state !== 'recording' || !(trigger instanceof Element) || session.events.length >= MAX_EVENTS) return;
    const triggerId = captureId(trigger);
    const scope = type === 'click' ? (trigger.closest('[data-framer-name],[data-kodety-component-id]') || document.body) : trigger;
    const before = type === 'hover' ? (baseline.get(triggerId) || snapshotTree(scope, 350)) : snapshotTree(scope, type === 'click' ? 2200 : 350);
    setRecentTrigger(type, trigger);
    const animationsBefore = new Set(document.getAnimations?.() || []);
    await taskDelay(delay);
    if (session.state !== 'recording' || !trigger.isConnected) return;
    const after = snapshotTree(scope, type === 'click' ? 2200 : 350), changes = diffSnapshots(before, after);
    const animations = Array.from(document.getAnimations?.() || []).filter(animation => !animationsBefore.has(animation));
    animations.forEach(animation => captureAnimation(animation, type, triggerId));
    if (!changes.length && !animations.length && type !== 'click' && type !== 'scroll') return;
    session.events.push({
      id: `event-${session.events.length + 1}`, type, timestamp: Date.now(), triggerId,
      selector: selectorFor(trigger), label: labelFor(trigger), changes,
      viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY },
      component: trigger.closest('[data-framer-name],[data-kodety-component-id]')?.getAttribute('data-framer-name') || null,
    });
    publishStatus();
  }

  function cleanFrames(effect, input) {
    let frames = [];
    try { frames = effect?.getKeyframes?.() || (Array.isArray(input) ? input : []); } catch { frames = Array.isArray(input) ? input : []; }
    return frames.map((frame, index) => {
      const clean = {};
      Object.keys(frame || {}).forEach(key => { if (!CONTROL_KEYS.has(key) && frame[key] != null) clean[key] = frame[key]; });
      const offset = frame?.computedOffset ?? frame?.offset;
      clean.offset = typeof offset === 'number' ? offset : index / Math.max(1, frames.length - 1);
      return clean;
    }).filter(frame => Object.keys(frame).length > 1);
  }
  function animationRecordKey(record) {
    return `${record.trigger}|${record.targetId}|${JSON.stringify(record.frames)}|${JSON.stringify(record.timing)}`;
  }
  function bufferingEarlyAnimations() {
    if (!earlyAnimationBufferActive || session.state !== 'idle') return false;
    if (Date.now() < earlyAnimationDeadline) return true;
    earlyAnimationBufferActive = false;
    return false;
  }
  function captureAnimation(animation, forcedTrigger, forcedTriggerId, input, options) {
    if (animation && seenAnimationObjects.has(animation) && !forcedTrigger) return null;
    if (animation) seenAnimationObjects.add(animation);
    const effect = animation?.effect, target = effect?.target;
    if (!(target instanceof Element)) return null;
    const frames = cleanFrames(effect, input);
    if (frames.length < 2) return null;
    let timing = {}, computed = {};
    try { timing = effect.getTiming?.() || (typeof options === 'object' ? options : {}) || {}; } catch {}
    try { computed = effect.getComputedTiming?.() || {}; } catch {}
    const active = Date.now() < recentTrigger.expires ? recentTrigger : { type: 'load', id: '' };
    const trigger = forcedTrigger || active.type || 'load', targetId = captureId(target);
    const motionClass = `kodety-framer-motion-${targetId}`;
    suppress(() => target.classList.add(motionClass));
    const record = {
      trigger, triggerId: forcedTriggerId || active.id || targetId, targetId,
      targetClass: motionClass, elementLabel: labelFor(target), frames,
      kind: animation?.constructor?.name || 'Animation', capturedAt: Date.now(),
      timing: {
        delay: Number(timing.delay) || Number(computed.delay) || 0,
        duration: Number(timing.duration) || Number(computed.duration) || Number(computed.endTime) || 0,
        easing: String(timing.easing || 'linear'),
        iterations: Number(timing.iterations) || Number(computed.iterations) || 1,
        fill: String(timing.fill || 'none'),
        direction: String(timing.direction || 'normal'),
      },
    };
    const key = animationRecordKey(record);
    if (session.state === 'recording') {
      if (animationKeys.has(key)) return record;
      animationKeys.add(key);
      if (session.animations.length < MAX_ANIMATIONS) session.animations.push(record);
    } else if (bufferingEarlyAnimations() && !earlyAnimationKeys.has(key) && earlyAnimations.length < 250) {
      earlyAnimationKeys.add(key);
      earlyAnimations.push({ ...record, capturedAt: Date.now() });
    }
    return record;
  }

  function scanAnimations(forcedTrigger, forcedTriggerId) {
    try {
      Array.from(document.getAnimations?.({ subtree: true }) || []).forEach(animation => {
        captureAnimation(animation, forcedTrigger, forcedTriggerId);
      });
    } catch {}
  }

  function startAnimationScanner() {
    cancelAnimationFrame(animationFrame);
    const scanFrame = () => {
      if (session.state !== 'recording' && !bufferingEarlyAnimations()) { animationFrame = 0; return; }
      scanAnimations();
      animationFrame = requestAnimationFrame(scanFrame);
    };
    scanFrame();
  }

  ['animationstart', 'transitionrun'].forEach(eventName => {
    document.addEventListener(eventName, event => {
      if ((session.state !== 'recording' && !bufferingEarlyAnimations()) || !(event.target instanceof Element)) return;
      const active = Date.now() < recentTrigger.expires ? recentTrigger : { type: 'load', id: captureId(event.target) };
      queueMicrotask(() => scanAnimations(active.type, active.id));
    }, true);
  });

  function collectBreakpoints() {
    const queries = new Set();
    function walk(rules) {
      Array.from(rules || []).forEach(rule => {
        try {
          if (rule.conditionText && /(?:min|max)-width\s*:/.test(rule.conditionText)) queries.add(rule.conditionText);
          if (rule.cssRules) walk(rule.cssRules);
        } catch {}
      });
    }
    Array.from(document.styleSheets || []).forEach(sheet => { try { walk(sheet.cssRules); } catch {} });
    return Array.from(queries).map(query => {
      const min = query.match(/min-width\s*:\s*([0-9.]+)px/i), max = query.match(/max-width\s*:\s*([0-9.]+)px/i);
      const mode = max ? 'max-width' : 'min-width', width = Math.round(Number((max || min)?.[1] || 0));
      return { id: `recorded-${mode === 'max-width' ? 'max' : 'min'}-${width}`, label: min && max ? `Recorded ${Math.round(Number(min[1]))}–${Math.round(Number(max[1]))}` : `Recorded ${width}`, mode, width, query };
    }).filter(item => item.width > 0);
  }
  function collectAssets() {
    const urls = new Set();
    performance.getEntriesByType('resource').forEach(entry => { if (/^https?:/i.test(entry.name)) urls.add(entry.name); });
    document.querySelectorAll('[src],[href],[poster],[srcset]').forEach(element => {
      ['src', 'href', 'poster'].forEach(name => {
        const value = element.getAttribute(name); if (!value) return;
        try { const url = new URL(value, location.href).href; if (/^https?:/i.test(url)) urls.add(url); } catch {}
      });
      const srcset = element.getAttribute('srcset') || '';
      srcset.split(',').forEach(candidate => { try { const url = new URL(candidate.trim().split(/\s+/, 1)[0], location.href).href; if (/^https?:/i.test(url)) urls.add(url); } catch {} });
    });
    return Array.from(urls).slice(0, 1500);
  }
  function detectPlatform() {
    if (detectedPlatform) return detectedPlatform;
    const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
    if (/webflow/i.test(generator) || document.documentElement.hasAttribute('data-wf-page') || document.querySelector('[data-w-id],.w-nav,.w-form')) {
      return (detectedPlatform = { id: 'webflow', label: 'Webflow', preserveRuntime: true });
    }
    if (/framer/i.test(generator) || /framer/i.test(document.documentElement.innerHTML.slice(0, 50_000)) || document.querySelector('[data-framer-name]')) {
      return (detectedPlatform = { id: 'framer', label: 'Framer', preserveRuntime: false });
    }
    const fallback = { id: 'code', label: 'Code', preserveRuntime: true };
    if (document.readyState !== 'loading') detectedPlatform = fallback;
    return fallback;
  }
  function sampleViewport(reason) {
    const sample = { reason, timestamp: Date.now(), width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY };
    const last = session.viewports.at(-1);
    if (!last || last.width !== sample.width || last.height !== sample.height || reason === 'start') session.viewports.push(sample);
  }
  function seedBaselines() {
    baseline.clear();
    Array.from(document.querySelectorAll('*')).slice(0, 6000).forEach(captureId);
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,summary,[role="button"],[tabindex],[data-framer-name]')).slice(0, 800);
    candidates.forEach(element => baseline.set(captureId(element), snapshotTree(element)));
  }
  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(mutations => {
      if (session.state !== 'recording' || mutationSuppressed || session.mutations.length >= MAX_MUTATIONS) return;
      mutations.forEach(mutation => {
        if (session.mutations.length >= MAX_MUTATIONS || !(mutation.target instanceof Element)) return;
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-kodety-capture-id') return;
        const target = mutation.target;
        const active = Date.now() < recentTrigger.expires ? recentTrigger : { type: 'load', id: '' };
        session.mutations.push({
          timestamp: Date.now(), type: mutation.type, targetId: captureId(target), selector: selectorFor(target),
          trigger: active.type, triggerId: active.id,
          attribute: mutation.attributeName || null,
          value: mutation.attributeName ? target.getAttribute(mutation.attributeName) : null,
          added: mutation.type === 'childList' ? Array.from(mutation.addedNodes).filter(node => node instanceof Element).slice(0, 8).map(node => node.outerHTML.slice(0, 20_000)) : [],
          removed: mutation.type === 'childList' ? Array.from(mutation.removedNodes).filter(node => node instanceof Element).slice(0, 20).map(node => captureId(node)) : [],
        });
      });
      publishStatus();
    });
    const root = document.documentElement;
    if (root) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-framer-name', 'data-framer-variant'] });
    else addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  document.addEventListener('pointerover', event => {
    const target = interactiveTarget(event.target); if (!target || target === lastHover) return;
    lastHover = target; recordState('hover', target, 150);
  }, true);
  document.addEventListener('pointerout', event => {
    const target = interactiveTarget(event.target); if (!target) return;
    setTimeout(() => { if (target.isConnected) baseline.set(captureId(target), snapshotTree(target)); if (lastHover === target) lastHover = null; }, 180);
  }, true);
  document.addEventListener('pointerdown', event => { const target = interactiveTarget(event.target); if (target) recordState('active', target, 80); }, true);
  document.addEventListener('focusin', event => { const target = interactiveTarget(event.target); if (target) recordState('focus', target, 100); }, true);
  document.addEventListener('click', event => { const target = interactiveTarget(event.target); if (target) recordState('click', target, 180); }, true);
  let scrollTimer = 0;
  addEventListener('scroll', () => {
    if (session.state !== 'recording' || scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = 0; recordState('scroll', document.documentElement, 80); }, 120);
  }, { passive: true, capture: true });
  addEventListener('resize', () => { if (session.state === 'recording') sampleViewport('resize'); }, { passive: true });

  function start(resume = false) {
    earlyAnimationBufferActive = false;
    if (!resume) {
      session.events.length = session.animations.length = session.mutations.length = session.viewports.length = 0;
      session.initialHtml = '';
      animationKeys.clear();
    }
    session.state = 'recording';
    if (!resume || !session.startedAt) session.startedAt = new Date().toISOString();
    session.stoppedAt = null;
    earlyAnimations.filter(item => Date.now() - item.capturedAt < 30_000).forEach(item => {
      const { capturedAt: _capturedAt, ...record } = item;
      const key = animationRecordKey(record);
      if (!animationKeys.has(key) && session.animations.length < MAX_ANIMATIONS) {
        animationKeys.add(key); session.animations.push(record);
      }
    });
    earlyAnimations.length = 0;
    earlyAnimationKeys.clear();
    seenAnimationObjects = new WeakSet();
    seedBaselines(); sampleViewport('start'); startObserver(); startAnimationScanner();
    const captureInitialHtml = () => setTimeout(() => {
      if (!session.initialHtml && document.documentElement) {
        Array.from(document.querySelectorAll('*')).slice(0, 6000).forEach(captureId);
        const html = document.documentElement.outerHTML;
        session.initialHtml = html.length <= MAX_CAPTURE_HTML_CHARS ? html : '';
      }
    }, 350);
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', captureInitialHtml, { once: true });
    else captureInitialHtml();
    publishStatus(); return status();
  }
  function stop() { earlyAnimationBufferActive = false; session.state = 'stopped'; session.stoppedAt = new Date().toISOString(); observer?.disconnect(); cancelAnimationFrame(animationFrame); animationFrame = 0; publishStatus(); return status(); }
  function clear() {
    earlyAnimationBufferActive = false; observer?.disconnect(); cancelAnimationFrame(animationFrame); animationFrame = 0; session.state = 'idle'; session.startedAt = session.stoppedAt = null; session.initialHtml = '';
    session.events.length = session.animations.length = session.mutations.length = session.viewports.length = 0;
    earlyAnimations.length = 0; baseline.clear(); animationKeys.clear(); earlyAnimationKeys.clear(); publishStatus(); return status();
  }
  function cssName(property) { return property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`); }
  function compileCss() {
    const rules = new Map();
    session.events.filter(event => ['hover', 'active', 'focus'].includes(event.type)).forEach(event => {
      event.changes.forEach(change => {
        if (!Object.keys(change.styles || {}).length) return;
        const pseudo = event.type === 'active' ? 'active' : event.type;
        const trigger = `[data-kodety-capture-id="${event.triggerId}"]`, target = `[data-kodety-capture-id="${change.targetId}"]`;
        const selector = `${trigger}:${pseudo}${event.triggerId === change.targetId ? '' : ` ${target}`}`;
        const declarations = rules.get(selector) || {};
        Object.entries(change.styles).forEach(([property, value]) => {
          if (SAFE_RUNTIME_STYLES.has(property)) declarations[cssName(property)] = value;
        });
        if (!Object.keys(declarations).length) return;
        declarations.transition = declarations.transition || 'all 180ms ease'; rules.set(selector, declarations);
      });
    });
    return ['/* Generated by Kodety Interaction Recorder. */', ...Array.from(rules, ([selector, declarations]) => `${selector} { ${Object.entries(declarations).map(([property, value]) => `${property}: ${value};`).join(' ')} }`)].join('\n');
  }
  function compileResponsiveCss() {
    const rules = new Set();
    function walk(items) {
      Array.from(items || []).forEach(rule => {
        try {
          const text = String(rule.cssText || '');
          if (/^@(media|container)\b/i.test(text)) rules.add(text);
          else if (rule.cssRules) walk(rule.cssRules);
        } catch {}
      });
    }
    Array.from(document.styleSheets || []).forEach(sheet => { try { walk(sheet.cssRules); } catch {} });
    return ['/* Media queries preservadas pelo Onun Kodety Recorder. */', ...rules].join('\n\n');
  }
  function compileRuntime() {
    const platform = detectPlatform();
    const events = session.events.map(event => ({
      ...event,
      changes: (event.changes || []).map(change => ({
        ...change,
        styles: Object.fromEntries(Object.entries(change.styles || {}).filter(([property]) => SAFE_RUNTIME_STYLES.has(property))),
        previousStyles: Object.fromEntries(Object.entries(change.previousStyles || {}).filter(([property]) => SAFE_RUNTIME_STYLES.has(property))),
      })),
    }));
    const animations = session.animations.flatMap(animation => {
      // CSS animations/transitions are already restored by the captured CSS.
      // Replaying them again through WAAPI causes duplicate transforms/flicker.
      if (/^CSS(?:Animation|Transition)$/i.test(animation.kind || '')) return [];
      const frames = (animation.frames || []).map(frame => Object.fromEntries(Object.entries(frame).filter(([property]) => property === 'offset' || SAFE_RUNTIME_STYLES.has(property))));
      return frames.some(frame => Object.keys(frame).length > 1) ? [{ ...animation, frames }] : [];
    });
    const data = JSON.stringify({ version: 3, platform: platform.id, preserveRuntime: platform.preserveRuntime, events, animations, mutations: session.mutations });
    return `(() => {
  const recording = ${data};
  if (recording.preserveRuntime) {
    window.__KODETY_RECORDED_RUNTIME__ = { recording, mode: 'native-preserved' };
    return;
  }
  const byId = id => id ? document.querySelector('[data-kodety-capture-id="' + CSS.escape(id) + '"]') : null;
  const eventGroups = new Map();
  const cursors = new Map();
  for (const event of recording.events || []) {
    const key = event.type + '|' + event.triggerId;
    if (!eventGroups.has(key)) eventGroups.set(key, []);
    eventGroups.get(key).push(event);
  }
  const findGroup = (type, target) => {
    for (const [key, events] of eventGroups) {
      if (!key.startsWith(type + '|')) continue;
      const trigger = byId(events[0].triggerId);
      if (trigger && (trigger === target || trigger.contains(target))) return { key, events, trigger };
    }
    return null;
  };
  const setAttribute = (element, name, value) => {
    if (name === 'hidden') element.hidden = value === true || value === '' || value === 'true';
    else if (value == null || value === false) element.removeAttribute(name);
    else element.setAttribute(name, String(value));
  };
  const applyChanges = (changes, previous = false) => {
    for (const change of changes || []) {
      const target = byId(change.targetId); if (!target) continue;
      const styles = previous ? change.previousStyles : change.styles;
      for (const [property, value] of Object.entries(styles || {})) target.style[property] = value == null ? '' : String(value);
      const attributes = previous ? change.previousAttributes : change.attributes;
      for (const [name, value] of Object.entries(attributes || {})) setAttribute(target, name, value);
    }
  };
  const playAnimations = (type, triggerId) => {
    for (const animation of recording.animations || []) {
      if (animation.trigger !== type || (triggerId && animation.triggerId && animation.triggerId !== triggerId)) continue;
      const target = byId(animation.targetId); if (!target || !target.animate || animation.frames?.length < 2) continue;
      const timing = animation.timing || {};
      try { target.animate(animation.frames, { delay: timing.delay || 0, duration: Math.max(1, timing.duration || 1), easing: timing.easing || 'linear', iterations: timing.iterations || 1, fill: timing.fill || 'none', direction: timing.direction || 'normal' }); }
      catch { target.animate(animation.frames, { duration: Math.max(1, timing.duration || 1), fill: timing.fill || 'none' }); }
    }
  };
  const applyMutations = (type, triggerId) => {
    for (const mutation of recording.mutations || []) {
      if (mutation.trigger !== type || (mutation.triggerId && mutation.triggerId !== triggerId)) continue;
      const target = byId(mutation.targetId); if (!target) continue;
      if (mutation.type === 'attributes' && mutation.attribute && mutation.attribute !== 'style') setAttribute(target, mutation.attribute, mutation.value);
    }
  };
  const activate = (type, target) => {
    const group = findGroup(type, target); if (!group) return null;
    const cursor = cursors.get(group.key) || 0;
    const event = group.events[cursor % group.events.length];
    if (type === 'click') cursors.set(group.key, cursor + 1);
    applyChanges(event.changes);
    applyMutations(type, event.triggerId);
    playAnimations(type, event.triggerId);
    return { event, trigger: group.trigger };
  };
  document.addEventListener('pointerover', event => {
    const active = activate('hover', event.target);
    if (!active || active.trigger.contains(event.relatedTarget)) return;
    active.trigger.addEventListener('pointerleave', () => applyChanges(active.event.changes, true), { once: true });
  }, true);
  document.addEventListener('pointerdown', event => {
    const active = activate('active', event.target);
    if (active) addEventListener('pointerup', () => applyChanges(active.event.changes, true), { once: true });
  }, true);
  document.addEventListener('focusin', event => {
    const active = activate('focus', event.target);
    if (active) active.trigger.addEventListener('focusout', () => applyChanges(active.event.changes, true), { once: true });
  }, true);
  document.addEventListener('click', event => activate('click', event.target), true);
  let scrollQueued = false;
  addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; activate('scroll', document.documentElement); playAnimations('scroll', ''); });
  }, { passive: true });
  const start = () => requestAnimationFrame(() => requestAnimationFrame(() => playAnimations('load', '')));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  window.__KODETY_RECORDED_RUNTIME__ = { recording, activate, playAnimations };
})();`;
  }
  function absolutizeDocumentUrls(root) {
    root.querySelectorAll('[src],[href],[poster],[action]').forEach(element => {
      ['src', 'href', 'poster', 'action'].forEach(attribute => {
        const value = element.getAttribute(attribute);
        if (!value || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) return;
        try { element.setAttribute(attribute, new URL(value, location.href).href); } catch {}
      });
    });
    root.querySelectorAll('[srcset]').forEach(element => {
      const value = element.getAttribute('srcset') || '';
      const normalized = value.split(',').map(candidate => {
        const parts = candidate.trim().split(/\s+/); if (!parts[0] || /^data:/i.test(parts[0])) return candidate;
        try { parts[0] = new URL(parts[0], location.href).href; } catch {}
        return parts.join(' ');
      }).join(', ');
      element.setAttribute('srcset', normalized);
    });
  }
  function exportHtml() {
    const platform = detectPlatform();
    // Webflow and authored-code sites keep their original runtime, so their
    // earlier DOM is the correct hydration input. Framer uses the settled DOM.
    const source = platform.preserveRuntime && session.initialHtml ? session.initialHtml : document.documentElement.outerHTML;
    if (source.length > MAX_CAPTURE_HTML_CHARS) throw new Error('KODETY_CAPTURE_TOO_LARGE');
    const parsed = new DOMParser().parseFromString(`<!doctype html>${source}`, 'text/html');
    const clone = parsed.documentElement;
    const removable = platform.preserveRuntime
      ? 'noscript,base,meta[http-equiv="Content-Security-Policy" i]'
      : 'script,noscript,base,meta[http-equiv="Content-Security-Policy" i],link[rel="modulepreload"],link[rel="prefetch"]';
    clone.querySelectorAll(removable).forEach(node => node.remove());
    absolutizeDocumentUrls(clone);
    let head = clone.querySelector('head');
    if (!head) { head = parsed.createElement('head'); clone.insertBefore(head, clone.firstChild); }
    ['styles/kodety-recorded-external.css', 'styles/kodety-recorded-responsive.css', 'styles/kodety-recorded-interactions.css'].forEach(href => {
      const link = parsed.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.kodetyRecorderStyles = 'true'; head.appendChild(link);
    });
    const runtime = parsed.createElement('script'); runtime.src = 'scripts/kodety-recorded-runtime.js'; runtime.defer = true; runtime.dataset.kodetyRecorderRuntime = 'true'; head.appendChild(runtime);
    if (!head.querySelector('meta[charset]')) { const meta = parsed.createElement('meta'); meta.setAttribute('charset', 'utf-8'); head.insertBefore(meta, head.firstChild); }
    clone.querySelectorAll('[srcset]').forEach(element => { if (/data:image\//i.test(element.getAttribute('srcset') || '')) element.removeAttribute('srcset'); });
    return `<!doctype html>\n${clone.outerHTML}`;
  }
  function exportRecording() {
    scanAnimations(); session.breakpoints = collectBreakpoints(); session.assets = collectAssets(); sampleViewport('export');
    const platform = detectPlatform();
    const css = compileCss(), responsiveCss = compileResponsiveCss(), runtime = compileRuntime();
    const manifest = {
      version: 1, generator: 'kodety-chrome-recorder', startedAt: session.startedAt, stoppedAt: session.stoppedAt,
      page: { url: location.href, title: document.title, hostname: location.hostname, platform: platform.id },
      events: session.events, animations: session.animations, mutations: session.mutations, viewports: session.viewports,
      breakpoints: session.breakpoints, assets: session.assets,
    };
    const framerManifest = { version: 1, source: 'kodety-chrome-recorder', platform: platform.id, runtime: true, breakpoints: session.breakpoints, animations: session.animations };
    const recording = { html: exportHtml(), css, responsiveCss, runtime, stylesheetUrls: [], manifest, framerManifest };
    let payloadBytes = Infinity;
    try { payloadBytes = encoder.encode(JSON.stringify(recording)).byteLength; } catch {}
    if (payloadBytes > MAX_CAPTURE_PAYLOAD_BYTES) throw new Error('KODETY_CAPTURE_TOO_LARGE');
    return recording;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  const runtimeCommands = {
    KODETY_CONTENT_START: 'START',
    KODETY_CONTENT_STOP: 'STOP',
    KODETY_CONTENT_CLEAR: 'CLEAR',
    KODETY_CONTENT_STATUS: 'STATUS',
    KODETY_CONTENT_EXPORT: 'EXPORT',
  };

  function isRuntimeCommand(message) {
    if (!isRecord(message) || !runtimeCommands[message.type]) return false;
    if (message.type === 'KODETY_CONTENT_START') {
      return message.payload == null || (isRecord(message.payload) && Object.keys(message.payload).every(key => key === 'resume') &&
        (message.payload.resume === undefined || typeof message.payload.resume === 'boolean'));
    }
    return message.payload == null;
  }

  function recorderError(error) {
    const code = String(error?.message || '');
    if (code === 'KODETY_CAPTURE_TOO_LARGE') return chrome.i18n.getMessage('capturePayloadTooLarge');
    return code.slice(0, 500) || chrome.i18n.getMessage('operationFailed');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || !isRuntimeCommand(message)) return false;
    Promise.resolve().then(() => {
      const command = runtimeCommands[message.type];
      if (command === 'START') return start(Boolean(message.payload?.resume));
      if (command === 'STOP') return stop();
      if (command === 'CLEAR') return clear();
      if (command === 'STATUS') return status();
      return exportRecording();
    }).then(sendResponse).catch(error => sendResponse({ error: recorderError(error) }));
    return true;
  });

  startAnimationScanner();
  chrome.runtime.sendMessage({ type: 'KODETY_BACKGROUND_CONTENT_READY' }).then(response => {
    if (response?.recording === true) start(true);
  }).catch(() => {});
})();
