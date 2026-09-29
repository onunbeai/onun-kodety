const isSelectOptionEnabled = option => !option.disabled && !option.hidden && !option.closest('optgroup')?.disabled && !option.closest('optgroup')?.hidden;

/** Resolve keyboard navigation against current native options, including groups. */
export function resolveSelectOption(items, index, key, query = '') {
  const choices = items.filter(item => isSelectOptionEnabled(item.option));
  const current = choices.findIndex(item => item.index === index);
  if (key === 'ArrowDown') return choices[Math.min(current + 1, choices.length - 1)];
  if (key === 'ArrowUp') return choices[Math.max(0, current - 1)];
  if (key === 'Home') return choices[0];
  if (key === 'End') return choices.at(-1);
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const normalized = normalize(query);
  if (!normalized) return;
  const needle = [...normalized].every(letter => letter === normalized[0]) ? normalized[0] : normalized;
  const ordered = needle.length === 1 ? [...choices.slice(current + 1), ...choices.slice(0, current + 1)] : choices;
  return ordered.find(item => normalize(item.option.label || item.option.textContent).trim().startsWith(needle));
}

/** Keep a handled key and its release away from ancestor save/cancel shortcuts. */
export function consumeSelectKey(event, state) {
  if (event.type === 'keyup') {
    if (state.consumedKey !== event.key) return false;
    state.consumedKey = '';
  } else state.consumedKey = event.key;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/* Native select remains the value, validation and form submission owner. */
export function mountNativeSelects({ config = {}, signal } = {}) {
  const body = document.body;
  if (!body?.classList.contains('kodety-os') || body.classList.contains('block-editor-page')) return;
  const states = new Map();
  const nativeLists = new Set();
  const eventOptions = signal ? { signal } : undefined;
  let active = null, serial = 0, search = '', searchedAt = 0;
  const element = (tag, className) => Object.assign(document.createElement(tag), { className });
  const attr = (node, key, value) => {
    if (value == null) { if (node.hasAttribute(key)) node.removeAttribute(key); }
    else if (node.getAttribute(key) !== String(value)) node.setAttribute(key, String(value));
  };
  const popup = element('div', 'kdw-select-popup');
  popup.hidden = true;
  popup.setAttribute('role', 'listbox');
  popup.id = 'kdw-select-options';
  body.append(popup);
  const allowed = select => {
    if (!select.isConnected || select.closest('.block-editor,.interface-interface-skeleton,.components-select-control,.components-combobox-control,.components-custom-select-control,.selectize-control,.mce-window,[data-kodety-native-select],[data-kodety-select-managed]')) return false;
    if (select.matches('.select2-hidden-accessible,.select2,.selectWoo,[data-select2-id],[aria-hidden="true"]:not(.kdw-select__native)') || select.nextElementSibling?.matches('.select2,.select2-container,.chosen-container')) return false;
    if (select.closest('.kodety-ui-topbar,.kodety-ui-sidebar')) return true;
    return config.adminSurface !== 'third-party' && !!select.closest('#wpbody-content,#screen-meta,.media-modal,.kodety-connection-modal,.kodety-media-modal,.kodety-modal');
  };
  const enabled = isSelectOptionEnabled;
  const close = (restore = false) => {
    const previous = active;
    if (!previous) return;
    active = null;
    if (typeof popup.hidePopover === 'function' && popup.matches(':popover-open')) popup.hidePopover();
    popup.hidden = true;
    attr(previous.button, 'aria-expanded', 'false');
    attr(previous.button, 'aria-activedescendant', null);
    if (restore && previous.button.isConnected) previous.button.focus({ preventScroll: true });
  };
  const position = () => {
    if (!active) return;
    if (!active.select.isConnected || !active.button.getClientRects().length) return close();
    const rect = active.button.getBoundingClientRect(), viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const below = top + height - rect.bottom - 12, above = rect.top - top - 12;
    const upwards = below < 180 && above > below;
    popup.style.width = Math.min(Math.max(rect.width, 180), width - 16) + 'px';
    popup.style.maxHeight = Math.max(48, Math.min(300, upwards ? above : below)) + 'px';
    popup.style.left = Math.max(left + 8, Math.min(getComputedStyle(active.button).direction === 'rtl' ? rect.right - popup.offsetWidth : rect.left, left + width - popup.offsetWidth - 8)) + 'px';
    popup.style.top = Math.max(top + 8, upwards ? rect.top - popup.offsetHeight - 6 : rect.bottom + 6) + 'px';
  };
  const highlight = index => {
    if (!active) return;
    const item = active.items.find(item => item.index === index && enabled(item.option)) || active.items.find(item => enabled(item.option));
    active.index = item?.index ?? -1;
    for (const entry of active.items) entry.node.classList.toggle('is-active', entry === item);
    attr(active.button, 'aria-activedescendant', item?.node.id || null);
    item?.node.scrollIntoView({ block: 'nearest' });
  };
  const render = state => {
    popup.replaceChildren();
    state.items = [];
    let group = null, destination = popup;
    [...state.select.options].forEach((option, index) => {
      if (option.hidden || option.closest('optgroup')?.hidden) return;
      const parent = option.closest('optgroup');
      if (parent !== group) {
        group = parent;
        destination = popup;
        if (parent) {
          destination = element('div', 'kdw-select-popup__group');
          destination.setAttribute('role', 'group');
          destination.setAttribute('aria-label', parent.label);
          const heading = element('div', 'kdw-select-popup__heading');
          heading.textContent = parent.label;
          heading.setAttribute('aria-hidden', 'true');
          destination.append(heading);
          popup.append(destination);
        }
      }
      const node = element('div', 'kdw-select-popup__option');
      node.id = state.button.id + '-option-' + index;
      node.dataset.index = String(index);
      node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', String(option.selected));
      node.setAttribute('aria-disabled', String(!enabled(option)));
      node.textContent = option.label || option.textContent;
      destination.append(node);
      state.items.push({ option, node, index });
    });
    attr(popup, 'aria-labelledby', state.button.id);
    position();
    highlight(state.index >= 0 ? state.index : state.select.selectedIndex);
  };
  const sync = state => {
    const { select, button, value } = state;
    const label = select.selectedOptions[0]?.label || select.selectedOptions[0]?.textContent || '';
    if (value.textContent !== label) value.textContent = label;
    if (button.disabled !== select.matches(':disabled')) button.disabled = select.matches(':disabled');
    state.wrapper.hidden = select.hidden || getComputedStyle(select).display === 'none';
    if (select.hasAttribute('aria-label')) attr(button, 'aria-label', select.getAttribute('aria-label'));
    attr(button, 'aria-required', select.required ? 'true' : null);
    if (select.validity.valid && !state.error.hidden) { state.error.hidden = true; state.error.textContent = ''; }
    attr(button, 'aria-invalid', state.error.hidden ? select.getAttribute('aria-invalid') : 'true');
    attr(button, 'aria-describedby', [select.getAttribute('aria-describedby'), state.error.hidden ? '' : state.error.id].filter(Boolean).join(' ') || null);
    if (active === state) {
      if (button.disabled || !allowed(select)) close();
      else render(state);
    }
  };
  const open = state => {
    sync(state);
    if (state.button.disabled) return;
    close();
    active = state;
    state.index = state.select.selectedIndex;
    search = '';
    popup.hidden = false;
    if (typeof popup.showPopover === 'function') { popup.setAttribute('popover', 'manual'); popup.showPopover(); }
    attr(state.button, 'aria-expanded', 'true');
    render(state);
  };
  const commit = index => {
    if (!active) return;
    const state = active, option = state.select.options[index];
    if (!option || !enabled(option)) return;
    const changed = state.select.selectedIndex !== index;
    state.select.selectedIndex = index;
    close(true);
    sync(state);
    if (changed) {
      state.select.dispatchEvent(new Event('input', { bubbles: true }));
      state.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  const keydown = (event, state) => {
    if (event.ctrlKey || event.metaKey || (event.altKey && !['ArrowUp', 'ArrowDown'].includes(event.key))) return;
    if (event.key === 'Escape') { if (active === state) { consumeSelectKey(event, state); close(true); } return; }
    if (event.key === 'Tab') { close(); return; }
    if (['Enter', ' '].includes(event.key) && !(event.key === ' ' && search && Date.now() - searchedAt < 700)) {
      consumeSelectKey(event, state);
      if (active === state) commit(state.index); else open(state);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.key.length !== 1 || event.altKey)) return;
    consumeSelectKey(event, state);
    if (active !== state) open(state);
    if (active !== state) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const now = Date.now();
      search = now - searchedAt < 700 ? search + event.key : event.key;
      searchedAt = now;
    }
    const next = resolveSelectOption(state.items, state.index, event.key, search);
    if (next) highlight(next.index);
  };
  const restore = state => {
    if (active === state) close();
    state.controller.abort();
    if (state.select.parentElement === state.wrapper) state.wrapper.before(state.select);
    state.wrapper.remove();
    state.select.classList.remove('kdw-select__native');
    if (!state.select.matches('.select2-hidden-accessible,[data-select2-id]')) {
      attr(state.select, 'tabindex', state.tabindex);
      attr(state.select, 'aria-hidden', state.hidden);
    }
    delete state.select.dataset.kdwSelectTabindex;
    states.delete(state.select);
  };
  const enhance = select => {
    // Core quick-edit clones hidden rows. Rebuild cloned controls without
    // retaining duplicated trigger IDs or closures bound to the original row.
    if (!states.has(select) && select.parentElement?.classList.contains('kdw-select')) {
      const stale = select.parentElement;
      stale.before(select);
      stale.remove();
      select.classList.remove('kdw-select__native');
      select.removeAttribute('aria-hidden');
      attr(select, 'tabindex', select.dataset.kdwSelectTabindex || null);
      delete select.dataset.kdwSelectTabindex;
    }
    if (!allowed(select) || select.multiple || select.size > 1) {
      if (states.has(select)) restore(states.get(select));
      if (allowed(select) && (select.multiple || select.size > 1)) { if (!select.classList.contains('kdw-select-multiple')) select.classList.add('kdw-select-multiple'); nativeLists.add(select); }
      return;
    }
    if (nativeLists.has(select)) { nativeLists.delete(select); select.classList.remove('kdw-select-multiple'); }
    if (states.has(select)) { sync(states.get(select)); return; }
    const wrapper = element('span', 'kdw-select'), button = element('button', 'kdw-select__trigger');
    const value = element('span', 'kdw-select__value'), error = element('span', 'kdw-select__error');
    const rect = select.getBoundingClientRect();
    wrapper.style.width = select.style.width || (rect.width ? rect.width + 'px' : '100%');
    button.type = 'button';
    button.id = 'kdw-select-' + ++serial;
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', popup.id);
    value.id = button.id + '-value';
    const labels = [...select.labels];
    const ids = select.getAttribute('aria-labelledby') || labels.map((label, index) => { if (!label.id || label.id.startsWith('kdw-select-')) label.id = button.id + '-label-' + index; return label.id; }).join(' ');
    if (select.hasAttribute('aria-label')) attr(button, 'aria-label', select.getAttribute('aria-label'));
    else if (ids) attr(button, 'aria-labelledby', ids + ' ' + value.id);
    else if (select.title || select.name) attr(button, 'aria-label', select.title || select.name);
    error.id = button.id + '-error';
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const controller = new AbortController(), localOptions = { signal: controller.signal };
    const state = { select, wrapper, button, value, error, controller, index: -1, items: [], tabindex: select.getAttribute('tabindex'), hidden: select.getAttribute('aria-hidden') };
    states.set(select, state);
    button.append(value);
    select.before(wrapper);
    wrapper.append(select, button, error);
    select.dataset.kdwSelectTabindex = state.tabindex || '';
    select.classList.add('kdw-select__native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    button.addEventListener('click', () => active === state ? close() : open(state), localOptions);
    button.addEventListener('keydown', event => keydown(event, state), localOptions);
    button.addEventListener('keyup', event => consumeSelectKey(event, state), localOptions);
    button.addEventListener('blur', () => { state.consumedKey = ''; }, localOptions);
    button.addEventListener('focus', () => sync(state), localOptions);
    select.addEventListener('change', () => sync(state), localOptions);
    select.addEventListener('input', () => sync(state), localOptions);
    select.addEventListener('focus', () => button.focus(), localOptions);
    select.addEventListener('invalid', event => {
      event.preventDefault();
      error.textContent = select.validationMessage;
      error.hidden = false;
      attr(button, 'aria-invalid', 'true');
      attr(button, 'aria-describedby', [select.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
      button.focus();
    }, localOptions);
    labels.forEach(label => label.addEventListener('click', event => {
      if (event.target.closest('a,button,input,textarea,select')) return;
      event.preventDefault();
      button.focus();
    }, localOptions));
    sync(state);
  };
  const scan = root => {
    if (root.matches?.('select')) enhance(root);
    root.querySelectorAll?.('select').forEach(enhance);
  };
  // A portaled option is still inside its owning filter or modal.
  for (const type of ['pointerdown', 'mousedown']) popup.addEventListener(type, event => { event.preventDefault(); event.stopPropagation(); }, eventOptions);
  popup.addEventListener('click', event => {
    event.stopPropagation();
    const option = event.target.closest('[data-index]');
    if (option) commit(Number(option.dataset.index));
  }, eventOptions);
  document.addEventListener('pointerdown', event => { if (active && !active.wrapper.contains(event.target) && !popup.contains(event.target)) close(); }, { ...eventOptions, capture: true });
  document.addEventListener('focusin', event => { if (active && !active.wrapper.contains(event.target) && !popup.contains(event.target)) close(); }, eventOptions);
  document.addEventListener('reset', () => setTimeout(() => { states.forEach(sync); }, 0), eventOptions);
  window.addEventListener('resize', position, eventOptions);
  document.addEventListener('scroll', event => { if (!popup.contains(event.target)) position(); }, { ...eventOptions, capture: true, passive: true });
  window.visualViewport?.addEventListener('resize', position, eventOptions);
  window.visualViewport?.addEventListener('scroll', position, eventOptions);
  const observer = new MutationObserver(records => {
    const affected = new Set();
    for (const record of records) {
      const select = record.target.closest?.('select');
      if (select) affected.add(select);
      else if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node.nodeType === 1 && !node.closest('.kdw-select-popup')) affected.add(node);
      } else if (!record.target.closest?.('.kdw-select-popup,.kdw-select')) affected.add(record.target);
    }
    affected.forEach(scan);
    states.forEach(state => { if (!state.select.isConnected) restore(state); });
    nativeLists.forEach(select => { if (!select.isConnected) nativeLists.delete(select); });
  });
  scan(document);
  observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'value', 'hidden', 'class', 'style', 'multiple', 'size', 'required', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid'] });
  signal?.addEventListener('abort', () => {
    observer.disconnect();
    close();
    popup.remove();
    states.forEach(restore);
    nativeLists.forEach(select => select.classList.remove('kdw-select-multiple'));
  }, { once: true });
}
