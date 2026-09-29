/**
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) Onun Kodety contributors.
 *
 * Onun Kodety's project timeline engine, backed by Motion's MIT-licensed
 * animate, mix and cubicBezier primitives. The document format and scheduler
 * belong to Onun; no commercial animation runtime is bundled or emulated.
 * @param {any} Motion
 * @param {any} host
 */
export function createOnunMotionRuntime(Motion, host = globalThis) {
  const transforms = new WeakMap();
  const active = new WeakMap();
  const authoredStyles = new WeakMap();
  const namedEasings = new Map();
  const controls = new Set(['duration', 'delay', 'ease', 'repeat', 'repeatDelay', 'yoyo', 'stagger', 'paused', 'overwrite', 'onUpdate', 'onComplete', 'onStart', 'onReverseComplete', 'immediateRender']);
  const transformKeys = new Set(['x', 'y', 'z', 'xPercent', 'yPercent', 'scale', 'scaleX', 'scaleY', 'rotation', 'rotationX', 'rotationY', 'rotationZ', 'rotate', 'skewX', 'skewY', 'transformPerspective']);
  const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'order', 'scale', 'scaleX', 'scaleY', 'strokeOpacity', 'fillOpacity']);
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const list = target => typeof target === 'string' ? Array.from(host.document.querySelectorAll(target)) : Array.isArray(target) ? target.flatMap(list) : target && typeof target.length === 'number' && !target.nodeType ? Array.from(target) : target ? [target] : [];
  const dom = target => Boolean(target?.style && target?.nodeType === 1);
  const cssName = name => name.startsWith('--') ? name : name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const transformState = element => {
    let state = transforms.get(element);
    if (state) return state;
    state = { x: 0, y: 0, z: 0, xPercent: 0, yPercent: 0, scaleX: 1, scaleY: 1, rotation: 0, rotationX: 0, rotationY: 0, skewX: 0, skewY: 0, transformPerspective: 0 };
    try {
      const value = host.getComputedStyle(element).transform;
      if (value && value !== 'none' && host.DOMMatrix) {
        const matrix = new host.DOMMatrix(value);
        state.x = matrix.m41; state.y = matrix.m42; state.z = matrix.m43;
        state.scaleX = Math.hypot(matrix.m11, matrix.m12, matrix.m13) || 1;
        state.scaleY = Math.hypot(matrix.m21, matrix.m22, matrix.m23) || 1;
        if (matrix.is2D) {
          state.rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
          state.scaleY = (matrix.a * matrix.d - matrix.b * matrix.c) / state.scaleX;
          state.skewX = Math.atan2(matrix.a * matrix.c + matrix.b * matrix.d, state.scaleX * state.scaleX) * 180 / Math.PI;
        } else {
          state.rotationY = Math.asin(clamp(-matrix.m13 / state.scaleX, -1, 1)) * 180 / Math.PI;
          state.rotationX = Math.atan2(matrix.m23, matrix.m33) * 180 / Math.PI;
          state.rotation = Math.atan2(matrix.m12, matrix.m11) * 180 / Math.PI;
        }
      }
    } catch { /* An unresolvable authored transform starts from identity. */ }
    transforms.set(element, state);
    return state;
  };
  const unit = (value, suffix) => typeof value === 'number' ? `${Math.abs(value) < 1e-8 ? 0 : value}${suffix}` : String(value);
  const renderTransform = (element, state) => {
    const result = [];
    if (number(state.transformPerspective)) result.push(`perspective(${unit(state.transformPerspective, 'px')})`);
    if (number(state.xPercent) || number(state.yPercent)) result.push(`translate(${unit(state.xPercent, '%')}, ${unit(state.yPercent, '%')})`);
    result.push(`translate3d(${unit(state.x, 'px')}, ${unit(state.y, 'px')}, ${unit(state.z, 'px')})`);
    if (parseFloat(state.rotation)) result.push(`rotate(${unit(state.rotation, 'deg')})`);
    if (parseFloat(state.rotationX)) result.push(`rotateX(${unit(state.rotationX, 'deg')})`);
    if (parseFloat(state.rotationY)) result.push(`rotateY(${unit(state.rotationY, 'deg')})`);
    if (parseFloat(state.skewX)) result.push(`skewX(${unit(state.skewX, 'deg')})`);
    if (parseFloat(state.skewY)) result.push(`skewY(${unit(state.skewY, 'deg')})`);
    result.push(`scale(${state.scaleX}, ${state.scaleY})`);
    element.style.transform = result.join(' ');
  };
  const read = (target, key) => {
    if (!dom(target)) return typeof target[key] === 'function' ? target[key]() : target[key] ?? 0;
    if (transformKeys.has(key)) {
      const state = transformState(target);
      return key === 'scale' ? state.scaleX : state[key === 'rotationZ' || key === 'rotate' ? 'rotation' : key] ?? 0;
    }
    if (key === 'autoAlpha') key = 'opacity';
    const value = host.getComputedStyle(target).getPropertyValue(cssName(key)).trim();
    return value || (key === 'opacity' ? 1 : 0);
  };
  const write = (target, key, value) => {
    if (!dom(target)) { if (typeof target[key] === 'function') target[key](value); else target[key] = value; return; }
    if (key !== 'clearProps' && !authoredStyles.has(target)) authoredStyles.set(target, target.getAttribute('style'));
    if (transformKeys.has(key)) {
      const state = transformState(target);
      if (key === 'scale') state.scaleX = state.scaleY = value;
      else state[key === 'rotationZ' || key === 'rotate' ? 'rotation' : key] = value;
      renderTransform(target, state); return;
    }
    if (key === 'autoAlpha') { target.style.opacity = String(value); target.style.visibility = number(value) <= 0 ? 'hidden' : 'inherit'; return; }
    if (key === 'clearProps') {
      if (String(value).trim() === 'all') {
        const original = authoredStyles.get(target);
        if (original === null) target.removeAttribute('style');
        else if (original !== undefined) target.setAttribute('style', original);
        authoredStyles.delete(target);
      } else for (const property of String(value).split(',')) target.style.removeProperty(cssName(property.trim()));
      transforms.delete(target); return;
    }
    const result = typeof value === 'number' && !unitless.has(key) && !key.startsWith('--') ? `${value}px` : String(value);
    target.style.setProperty(cssName(key), result);
  };
  const resolveValue = (value, from) => {
    if (typeof value !== 'string' || !/^[+-]=/.test(value)) return value;
    const delta = parseFloat(value.slice(2)) * (value[0] === '-' ? -1 : 1);
    const suffix = String(from).replace(/^[+-]?(?:\d*\.)?\d+/, '');
    const result = (parseFloat(from) || 0) + delta;
    return suffix ? `${result}${suffix}` : result;
  };
  const mixer = (from, to, key, target) => {
    to = resolveValue(to, from);
    if (dom(target) && transformKeys.has(key)) {
      if (/^(rotation|rotate|skew)/.test(key)) {
        const degrees = value => typeof value !== 'string' ? value : parseFloat(value) * (value.endsWith('rad') ? 180 / Math.PI : value.endsWith('turn') ? 360 : 1);
        from = degrees(from); to = degrees(to);
      } else if (/^(scale|[xy]Percent)/.test(key)) { from = parseFloat(from); to = parseFloat(to); }
      else {
        const suffix = typeof to === 'string' ? to.match(/[a-z%]+$/i)?.[0] : typeof from === 'string' ? from.match(/[a-z%]+$/i)?.[0] : '';
        if (suffix) { if (typeof from === 'number') from = `${from}${suffix}`; if (typeof to === 'number') to = `${to}${suffix}`; }
      }
    }
    if (dom(target) && !transformKeys.has(key) && key !== 'autoAlpha') {
      const suffix = !unitless.has(key) && !key.startsWith('--') ? 'px' : '';
      if (typeof from === 'number') from = `${from}${suffix}`;
      if (typeof to === 'number') to = `${to}${suffix}`;
    }
    if (typeof from === 'string' && typeof to === 'number' && Number.isFinite(Number(from))) from = Number(from);
    try { return Motion.mix(from, to); } catch { return progress => progress < 1 ? from : to; }
  };
  const bounce = value => {
    const n = 7.5625, d = 2.75;
    if (value < 1 / d) return n * value * value;
    if (value < 2 / d) return n * (value -= 1.5 / d) * value + .75;
    if (value < 2.5 / d) return n * (value -= 2.25 / d) * value + .9375;
    return n * (value -= 2.625 / d) * value + .984375;
  };
  const easing = raw => {
    if (typeof raw === 'function') return raw;
    if (Array.isArray(raw)) return Motion.cubicBezier(...raw);
    const name = String(raw || 'power1.out');
    if (namedEasings.has(name)) return namedEasings.get(name);
    const cubic = name.match(/^cubic-bezier\(([^)]+)\)$/);
    if (cubic) return Motion.cubicBezier(...cubic[1].split(',').map(Number));
    if (name === 'none' || name === 'linear') return value => value;
    if (typeof Motion[name] === 'function' && /^(ease|circ|back|anticipate)/.test(name)) return Motion[name];
    const [family, direction = 'out'] = name.split('.');
    const args = (name.match(/\(([^)]+)\)/)?.[1] || '').split(',').map(Number);
    let inside;
    if (/^power\d$/.test(family)) inside = value => Math.pow(value, Number(family.slice(5)) + 1);
    else if (family === 'sine') inside = value => 1 - Math.cos(value * Math.PI / 2);
    else if (family === 'expo') inside = value => value === 0 ? 0 : Math.pow(2, 10 * value - 10);
    else if (family === 'circ') inside = value => 1 - Math.sqrt(1 - value * value);
    else if (family === 'back') { const overshoot = args[0] || 1.70158; inside = value => (overshoot + 1) * value ** 3 - overshoot * value ** 2; }
    else if (family === 'bounce') inside = value => 1 - bounce(1 - value);
    else if (family === 'elastic') { const amplitude = Math.max(1, args[0] || 1), period = args[1] || .3; inside = value => value === 0 || value === 1 ? value : -amplitude * Math.pow(2, 10 * value - 10) * Math.sin((value - 1 - period / (2 * Math.PI) * Math.asin(1 / amplitude)) * 2 * Math.PI / period); }
    else return value => 1 - (1 - value) ** 2;
    if (direction.startsWith('inOut')) return value => value < .5 ? inside(value * 2) / 2 : 1 - inside(2 - value * 2) / 2;
    if (direction.startsWith('in')) return inside;
    return value => 1 - inside(1 - value);
  };
  const span = clip => clip.repeat === -1 ? Infinity : clip.duration * (clip.repeat + 1) + clip.repeatDelay * clip.repeat;
  const sample = (clip, time) => {
    const elapsed = Math.max(0, time - clip.start);
    if (!clip.duration) return 1;
    const total = span(clip), interval = clip.duration + clip.repeatDelay;
    const cycle = elapsed >= total && Number.isFinite(total) ? clip.repeat : Math.floor(elapsed / Math.max(.000001, interval));
    let progress = elapsed >= total && Number.isFinite(total) ? 1 : clamp((elapsed - cycle * interval) / clip.duration);
    if (clip.yoyo && cycle % 2) progress = 1 - progress;
    return clip.ease(progress);
  };
  const staggerOffsets = (stagger, length) => {
    const each = typeof stagger === 'number' ? stagger : stagger?.amount !== undefined ? number(stagger.amount) / Math.max(1, length - 1) : number(stagger?.each);
    const from = stagger?.from || 'start';
    const middle = (length - 1) / 2;
    let order = Array.from({ length }, (_, index) => index);
    if (from === 'end') order.reverse();
    else if (from === 'center') order.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
    else if (from === 'edges') order.sort((a, b) => Math.min(a, length - 1 - a) - Math.min(b, length - 1 - b));
    else if (from === 'random') { // Stable per authored target list, including reverse/seek.
      order.sort((a, b) => ((a * 9301 + 49297) % 233280) - ((b * 9301 + 49297) % 233280));
    }
    const offsets = Array(length).fill(0);
    order.forEach((index, rank) => offsets[index] = Math.abs(each) * (each < 0 ? length - 1 - rank : rank));
    return offsets;
  };

  class ProjectTimeline {
    /** @param {any} options */
    constructor(options = {}) {
      this.options = options; this.clips = []; this.calls = []; this.updates = []; this.spans = []; this.base = new Map(); this.callbacks = {};
      this.clock = null; this.position = 0; this.backward = false; this.killed = false; this.playing = false; this.rendered = false; this.lastLocal = 0; this.lastCycle = 0;
      this.rate = 1;
      for (const name of ['onUpdate', 'onComplete', 'onStart', 'onReverseComplete']) if (options[name]) this.callbacks[name] = options[name];
    }
    positionOf(position) {
      if (typeof position === 'number') return Math.max(0, position);
      if (typeof position === 'string' && /^[+-]=/.test(position)) return Math.max(0, this.duration() + parseFloat(position.slice(2)) * (position[0] === '-' ? -1 : 1));
      return this.duration();
    }
    baseValue(target, key) {
      if (!this.base.has(target)) this.base.set(target, new Map());
      const values = this.base.get(target);
      if (!values.has(key)) values.set(key, read(target, key));
      return values.get(key);
    }
    valueAt(target, key, time) {
      let value = this.baseValue(target, key);
      for (const clip of [...this.clips].sort((a, b) => a.start - b.start || a.order - b.order)) {
        if (clip.target === target && clip.key === key && time >= clip.start) value = clip.mix(sample(clip, time));
      }
      return value;
    }
    /** @param {any} targets @param {any} from @param {any} values @param {any} position */
    add(targets, from, values, position) {
      const elements = list(targets), offsets = staggerOffsets(values.stagger, elements.length);
      const start = this.positionOf(position) + Math.max(0, number(values.delay));
      elements.forEach((target, index) => {
        Object.keys(values).filter(key => !controls.has(key)).forEach(key => {
          const at = start + offsets[index];
          const prior = this.valueAt(target, key, at);
          const initial = from && Object.prototype.hasOwnProperty.call(from, key) ? from[key] : prior;
          const destination = resolveValue(typeof values[key] === 'function' ? values[key](index, target, elements) : values[key], initial);
          const duration = Math.max(0, number(values.duration, .5));
          this.clips.push({ target, key, start: at, duration, repeat: number(values.repeat), repeatDelay: Math.max(0, number(values.repeatDelay)), yoyo: Boolean(values.yoyo), ease: easing(values.ease), mix: mixer(initial, destination, key, target), order: this.clips.length });
        });
      });
      const duration = Math.max(0, number(values.duration, .5));
      const repeat = number(values.repeat);
      const length = repeat === -1 ? Infinity : duration * (repeat + 1) + Math.max(0, number(values.repeatDelay)) * repeat;
      const end = start + Math.max(0, ...offsets) + length;
      this.spans.push({ end, cycleEnd: start + Math.max(0, ...offsets) + duration + Math.max(0, number(values.repeatDelay)) });
      if (typeof values.onStart === 'function') this.calls.push({ fn: values.onStart, start });
      if (typeof values.onComplete === 'function' && Number.isFinite(end)) this.calls.push({ fn: values.onComplete, start: end, forwardsOnly: true });
      if (typeof values.onUpdate === 'function') this.updates.push({ fn: values.onUpdate, start, end });
      return this;
    }
    /** @param {any} targets @param {any} values @param {any} position */
    to(targets, values, position = undefined) { return this.add(targets, null, values, position); }
    /** @param {any} targets @param {any} from @param {any} values @param {any} position */
    fromTo(targets, from, values, position = undefined) { return this.add(targets, from, values, position); }
    /** @param {any} targets @param {any} values @param {any} position */
    from(targets, values, position = undefined) {
      list(targets).forEach(target => {
        const destination = { ...values };
        for (const key of Object.keys(values).filter(key => !controls.has(key))) destination[key] = read(target, key);
        this.add(target, values, destination, position);
        if (values.immediateRender !== false) set(target, values);
      }); return this;
    }
    /** @param {any} targets @param {any} values @param {any} position */
    set(targets, values, position = undefined) { return this.add(targets, null, { ...values, duration: 0 }, position); }
    /** @param {any} fn @param {any} args @param {any} position */
    call(fn, args = undefined, position = undefined) { this.calls.push({ fn, args, start: this.positionOf(position) }); return this; }
    duration() { return Math.max(.001, ...this.spans.map(item => Number.isFinite(item.end) ? item.end : item.cycleEnd), ...this.calls.map(call => call.start)); }
    totalDuration() { return this.options.repeat === -1 || this.spans.some(item => !Number.isFinite(item.end)) ? Infinity : this.duration() * (Math.max(0, number(this.options.repeat)) + 1); }
    local(total) {
      const duration = this.duration(), last = this.totalDuration();
      if (this.spans.some(item => !Number.isFinite(item.end))) return { time: total, cycle: 0 };
      const cycle = total >= last && Number.isFinite(last) ? Math.max(0, number(this.options.repeat)) : Math.floor(total / duration);
      let time = total >= last && Number.isFinite(last) ? duration : total - cycle * duration;
      if (this.options.yoyo && cycle % 2) time = duration - time;
      return { time, cycle };
    }
    render(total, suppress = false) {
      const previousTotal = this.position, wasRendered = this.rendered;
      this.position = clamp(number(total), 0, this.totalDuration());
      const { time, cycle } = this.local(this.position);
      for (const [target, values] of this.base) for (const [key, value] of values) write(target, key, value);
      for (const clip of [...this.clips].sort((a, b) => a.start - b.start || a.order - b.order)) {
        if (time >= clip.start) write(clip.target, clip.key, clip.mix(sample(clip, time)));
      }
      if (!suppress) {
        const backwards = cycle === this.lastCycle ? time < this.lastLocal : Boolean(this.options.yoyo && cycle % 2);
        const epsilon = 1e-9;
        const moved = Math.abs(time - this.lastLocal) > epsilon || cycle !== this.lastCycle;
        const wrapped = cycle !== this.lastCycle;
        const wasBackwards = Boolean(this.options.yoyo && this.lastCycle % 2);
        const crossed = call => !wasRendered ? call.start <= time + epsilon : !moved ? false : wrapped
          ? ((wasBackwards ? call.start < this.lastLocal - epsilon : call.start > this.lastLocal + epsilon)
            || (backwards ? call.start >= time - epsilon : call.start <= time + epsilon))
          : backwards ? call.start <= this.lastLocal + epsilon && call.start >= time - epsilon
          : call.start >= this.lastLocal - epsilon && call.start <= time + epsilon && (call.start > this.lastLocal + epsilon || previousTotal === 0);
        const ordered = [...this.calls].sort((a, b) => backwards ? b.start - a.start : a.start - b.start);
        for (const call of ordered) if (crossed(call) && !(backwards && call.forwardsOnly)) call.fn.apply(this, call.args || []);
        for (const update of this.updates) if (time >= update.start && time <= update.end) update.fn();
        this.callbacks.onUpdate?.();
      }
      this.lastLocal = time; this.lastCycle = cycle; this.rendered = true;
      return this;
    }
    /** @param {any} value */
    totalTime(value = undefined, suppress = false) { return value === undefined ? this.position : this.render(value, suppress); }
    /** @param {any} value */
    time(value = undefined, suppress = false) { return value === undefined ? this.local(this.position).time : this.render(value, suppress); }
    /** @param {any} value */
    progress(value = undefined, suppress = false) { return value === undefined ? this.local(this.position).time / this.duration() : this.render(clamp(number(value)) * this.duration(), suppress); }
    iteration() { return this.local(this.position).cycle + 1; }
    reversed() { return this.backward; }
    isActive() { return this.playing; }
    /** @param {any} value */
    timeScale(value = undefined) { if (value === undefined) return this.rate; this.rate = Math.max(.001, number(value, 1)); if (this.playing) this.drive(); return this; }
    stopClock() { this.clock?.stop?.(); this.clock = null; this.playing = false; }
    drive() {
      if (this.killed) return this;
      this.stopClock();
      const limit = this.totalDuration();
      const end = this.backward ? 0 : Number.isFinite(limit) ? limit : this.position + this.duration();
      const distance = Math.abs(end - this.position);
      this.playing = true; this.callbacks.onStart?.();
      this.render(this.position);
      if (distance <= .000001) { this.playing = false; return this; }
      this.clock = Motion.animate(this.position, end, {
        duration: distance / this.rate, ease: 'linear',
        onUpdate: value => { if (!this.killed) this.render(value); },
        onComplete: () => {
          if (this.killed) return;
          this.render(end); this.playing = false;
          if (!Number.isFinite(limit) && !this.backward) this.drive();
          else (this.backward ? this.callbacks.onReverseComplete : this.callbacks.onComplete)?.();
        },
      }); return this;
    }
    /** @param {any} at */
    play(at = undefined) { if (at !== undefined) this.render(at); this.backward = false; return this.drive(); }
    /** @param {any} at */
    reverse(at = undefined) { if (at !== undefined) this.render(at); this.backward = true; return this.drive(); }
    /** @param {any} at */
    pause(at = undefined) { this.stopClock(); if (at !== undefined) this.render(at); return this; }
    restart() { this.stopClock(); this.rendered = false; this.render(0, true); this.backward = false; return this.drive(); }
    invalidate() { for (const target of this.base.keys()) transforms.delete(target); return this; }
    kill() { this.stopClock(); this.killed = true; return this; }
    eventCallback(name, fn) { if (fn === undefined) return this.callbacks[name]; this.callbacks[name] = fn; return this; }
  }
  /** @param {any} targets @param {any} values */
  function set(targets, values) {
    for (const target of list(targets)) for (const key of Object.keys(values).filter(key => !controls.has(key))) write(target, key, values[key]);
  }
  /** @param {any} targets @param {any} values @param {any} from */
  function tween(targets, values, from = null) {
    if (values.overwrite) for (const target of list(targets)) active.get(target)?.kill();
    const timeline = new ProjectTimeline({ paused: values.paused, onReverseComplete: values.onReverseComplete });
    timeline.add(targets, from, values, 0);
    for (const target of list(targets)) active.set(target, timeline);
    if (!values.paused) timeline.play();
    return timeline;
  }
  const customEasing = {
    create(name, data) {
      const values = String(data).split(',').map(Number);
      if (values.length === 4 && values.every(Number.isFinite)) namedEasings.set(name, Motion.cubicBezier(...values));
      else {
        const points = Array.from(String(data).matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g), match => [Number(match[1]), Number(match[2])]);
        if (points.length < 2) throw new Error('Invalid easing samples.');
        namedEasings.set(name, progress => {
          let index = 1;
          while (index < points.length - 1 && points[index][0] < progress) index++;
          const before = points[index - 1], after = points[index];
          return before[1] + (after[1] - before[1]) * clamp((progress - before[0]) / Math.max(.000001, after[0] - before[0]));
        });
      }
      return namedEasings.get(name);
    },
  };
  const scroll = {
    create(config) {
      const element = list(config.trigger)[0];
      if (!element) return { kill() {}, refresh() {} };
      let previous = null, smoothing = null;
      const actions = String(config.toggleActions || 'play none none reverse').split(/\s+/);
      const coordinate = (token, extent) => token === 'top' || token === 'left' ? 0 : token === 'center' ? extent / 2 : token === 'bottom' || token === 'right' ? extent : token.endsWith('%') ? parseFloat(token) / 100 * extent : parseFloat(token) || 0;
      const threshold = (value, bounds, start = 0) => {
        if (typeof value === 'number') return value;
        if (/^\+=/.test(value)) return start + coordinate(value.slice(2), host.innerHeight);
        const [target = 'top', viewport = 'top'] = String(value).trim().split(/\s+/);
        return host.scrollY + bounds.top + coordinate(target, bounds.height) - coordinate(viewport, host.innerHeight);
      };
      const act = action => {
        if (action === 'none') return;
        if (action === 'reset') config.animation.pause(0);
        else if (action === 'complete') config.animation.progress(1).pause();
        else if (action === 'resume') config.animation.play();
        else config.animation[action]?.();
      };
      const update = () => {
        const bounds = element.getBoundingClientRect();
        const start = threshold(config.start || 'top bottom', bounds);
        const end = threshold(config.end || 'bottom top', bounds, start);
        const raw = (host.scrollY - start) / Math.max(.001, end - start), progress = clamp(raw);
        if (config.scrub) {
          config.animation.pause();
          if (typeof config.scrub === 'number' && previous !== null) { smoothing?.kill(); smoothing = tween(config.animation, { progress, duration: config.scrub, ease: 'power1.out' }); }
          else config.animation.progress(progress);
        } else if (previous === null) { if (raw >= 0) act(actions[0]); }
        else if (raw > previous) { if (previous < 0 && raw >= 0) act(actions[0]); if (previous < 1 && raw >= 1) act(actions[1]); }
        else { if (previous > 1 && raw <= 1) act(actions[2]); if (previous > 0 && raw <= 0) act(actions[3]); }
        previous = raw;
      };
      host.addEventListener('scroll', update, { passive: true }); host.addEventListener('resize', update); update();
      return { refresh: update, kill() { smoothing?.kill(); host.removeEventListener('scroll', update); host.removeEventListener('resize', update); } };
    },
  };
  return {
    timeline: (options = {}) => new ProjectTimeline(options), set,
    to: (targets, values) => tween(targets, values),
    fromTo: (targets, from, values) => tween(targets, values, from),
    from: (targets, values) => { const timeline = new ProjectTimeline({ paused: values.paused, onReverseComplete: values.onReverseComplete }).from(targets, values, 0); if (!values.paused) timeline.play(); return timeline; },
    invalidateElement: element => { transforms.delete(element); authoredStyles.delete(element); },
    easing: customEasing, scroll,
    engine: 'Motion', license: 'MIT',
  };
}
