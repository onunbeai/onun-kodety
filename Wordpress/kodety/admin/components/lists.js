/**
 * Onun Kodety list primitives for the classic WordPress admin.
 *
 * This module deliberately keeps native forms, inputs, links and row actions in
 * place. It adds a stable component boundary around them and uses synchronized
 * controls only when WordPress renders incompatible form boundaries or native
 * popovers that cannot carry the Onun Kodety design system. That gives Onun Kodety full
 * visual control without replacing WordPress capabilities or request semantics.
 */
/* global document, window, Element, MutationObserver, Node */
(function kodetyListComponents() {
  'use strict';

  const UI = 'kodety-ui';
  const englishUi = String(window.kodetyAdmin?.uiLocale || '').toLowerCase().startsWith('en');
  const SELECTORS = {
    listForm: 'form',
    table: '.wp-list-table',
    tabs: '.subsubsub, .nav-tab-wrapper',
    topToolbar: '.tablenav.top',
    bottomToolbar: '.tablenav.bottom',
    pagination: '.tablenav-pages',
    search: '.search-box',
  };

  const state = {
    frame: 0,
    observer: null,
    selectCounter: 0,
  };

  const screen = () => {
    const body = document.body;
    const query = new window.URLSearchParams(window.location.search);

    if (body.classList.contains('edit-comments-php')) return 'comments';
    if (body.classList.contains('plugins-php')) return 'plugins';
    if (body.classList.contains('users-php')) return 'users';
    if (body.classList.contains('edit-tags-php')) return 'taxonomies';
    if (body.classList.contains('edit-php')) {
      return query.get('post_type') === 'page' ? 'pages' : 'posts';
    }

    return 'content';
  };

  const screenCopy = () => {
    const copies = englishUi
      ? {
          comments: ['comments', 'Search comments'],
          plugins: ['plugins', 'Search plugins'],
          users: ['users', 'Search users'],
          taxonomies: ['terms', 'Search terms'],
          pages: ['pages', 'Search pages'],
          posts: ['posts', 'Search posts'],
          content: ['items', 'Search content'],
        }
      : {
          comments: ['comentários', 'Buscar comentários'],
          plugins: ['plugins', 'Buscar plugins'],
          users: ['usuários', 'Buscar usuários'],
          taxonomies: ['termos', 'Buscar termos'],
          pages: ['páginas', 'Buscar páginas'],
          posts: ['posts', 'Buscar posts'],
          content: ['itens', 'Buscar conteúdo'],
        };

    return copies[screen()] || copies.content;
  };

  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const element = (tag, className, attributes = {}) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.entries(attributes).forEach(([name, value]) => {
      if (value !== null && value !== undefined) node.setAttribute(name, String(value));
    });
    return node;
  };

  const numberFrom = (value) => {
    const normalized = String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[^\d-]/g, '');
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const directTabLinks = (source) => {
    if (source.classList.contains('subsubsub')) {
      return all(':scope > li > a', source);
    }
    return all(':scope > a.nav-tab', source);
  };

  class TabsComponent {
    constructor(source) {
      this.source = source;
    }

    mount() {
      if (this.source.dataset.kodetyUiTabs === 'mounted') return;

      const links = directTabLinks(this.source);
      if (!links.length) return;

      const label = this.source.getAttribute('aria-label') || 'Filtros da listagem';
      const tabs = element('nav', `${UI}-tabs`, {
        'aria-label': label,
        'data-kodety-ui-component': 'tabs',
        role: 'navigation',
      });

      links.forEach((nativeLink) => {
        const link = nativeLink.cloneNode(true);
        const current =
          nativeLink.classList.contains('current') ||
          nativeLink.classList.contains('nav-tab-active') ||
          nativeLink.getAttribute('aria-current') === 'page';

        link.className = `${UI}-tab${current ? ` ${UI}-tab--active` : ''}`;
        link.removeAttribute('style');
        link.setAttribute('data-kodety-ui-tab', '');
        link.removeAttribute('id');
        if (current) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');

        all('.count', link).forEach((count) => count.classList.add(`${UI}-tab__count`));
        tabs.appendChild(link);
      });

      this.source.before(tabs);
      this.source.classList.add(`${UI}-native-tabs`);
      this.source.setAttribute('aria-hidden', 'true');
      this.source.setAttribute('inert', '');
      links.forEach((nativeLink) => nativeLink.setAttribute('tabindex', '-1'));
      this.source.dataset.kodetyUiTabs = 'mounted';
    }
  }

  class PaginationComponent {
    constructor(root) {
      this.root = root;
    }

    getTotalPages() {
      const explicitTotal = this.root.querySelector('.total-pages');
      const input = this.root.querySelector('input.current-page');
      const candidates = [
        explicitTotal?.textContent,
        input?.getAttribute('max'),
        this.root.dataset.totalPages,
      ];

      for (const candidate of candidates) {
        const value = numberFrom(candidate);
        if (value !== null && value > 0) return value;
      }

      const enabledNavigation = this.root.querySelector(
        'a.first-page, a.prev-page, a.next-page, a.last-page',
      );
      return enabledNavigation ? 2 : 1;
    }

    mount() {
      this.root.classList.add(`${UI}-pagination`);
      this.root.setAttribute('aria-label', 'Paginação da listagem');
      this.root.dataset.kodetyUiComponent = 'pagination';

      const totalPages = this.getTotalPages();
      const isSinglePage = totalPages <= 1;
      this.root.classList.toggle(`${UI}-pagination--single`, isSinglePage);

      const labels = {
        'first-page': ['Primeira página', 'chevrons-left'],
        'prev-page': ['Página anterior', 'chevron-left'],
        'next-page': ['Próxima página', 'chevron-right'],
        'last-page': ['Última página', 'chevrons-right'],
      };

      Object.entries(labels).forEach(([className, [label, icon]]) => {
        all(`.${className}`, this.root).forEach((control) => {
          control.setAttribute('aria-label', label);
          control.dataset.kodetyIcon = icon;
          control.classList.add(`${UI}-icon-button`);

          if (control.matches('.tablenav-pages-navspan')) {
            control.setAttribute('aria-disabled', 'true');
          }

          let accessibleText = control.querySelector(`.${UI}-sr-only`);
          if (!accessibleText) {
            accessibleText = element('span', `${UI}-sr-only`);
            accessibleText.textContent = label;
            control.appendChild(accessibleText);
          }
        });
      });

      const pageInput = this.root.querySelector('input.current-page');
      if (pageInput) {
        pageInput.setAttribute('aria-label', 'Página atual');
        pageInput.classList.add(`${UI}-pagination__input`);
      }

      const amount = this.root.querySelector('.displaying-num');
      if (amount) amount.classList.add(`${UI}-pagination__amount`);

      const links = this.root.querySelector('.pagination-links');
      if (links) {
        links.classList.add(`${UI}-pagination__controls`);
        links.hidden = isSinglePage;
        links.setAttribute('aria-hidden', isSinglePage ? 'true' : 'false');
      }

      all('.tablenav-paging-text', this.root).forEach((text) => {
        text.classList.add(`${UI}-pagination__status`);
        text.hidden = isSinglePage;
      });
    }
  }

  class SelectComponent {
    constructor(select) {
      this.select = select;
      this.wrapper = null;
      this.trigger = null;
      this.label = null;
      this.list = null;
      this.typeahead = '';
      this.typeaheadTimer = 0;
      this.optionObserver = null;
    }

    static supports(select) {
      return (
        select &&
        !select.multiple &&
        Number(select.getAttribute('size') || 1) <= 1 &&
        !select.classList.contains('select2-hidden-accessible') &&
        !select.classList.contains('components-select-control__input')
      );
    }

    optionItems() {
      return all(`.${UI}-select__option`, this.list);
    }

    enabledItems() {
      return this.optionItems().filter((item) => item.getAttribute('aria-disabled') !== 'true');
    }

    buildOptions() {
      this.list.replaceChildren();
      const groups = new Map();

      Array.from(this.select.options).forEach((option, index) => {
        let parent = this.list;
        const optionGroup = option.closest('optgroup');

        if (optionGroup) {
          if (!groups.has(optionGroup)) {
            const group = element('div', `${UI}-select__group`, {
              role: 'group',
              'aria-label': optionGroup.label,
            });
            const groupLabel = element('span', `${UI}-select__group-label`, {
              'aria-hidden': 'true',
            });
            groupLabel.textContent = optionGroup.label;
            group.appendChild(groupLabel);
            groups.set(optionGroup, group);
            this.list.appendChild(group);
          }
          parent = groups.get(optionGroup);
        }

        const item = element('button', `${UI}-select__option`, {
          id: `${this.list.id}-option-${index}`,
          type: 'button',
          role: 'option',
          tabindex: '-1',
          'data-index': index,
          'aria-selected': option.selected ? 'true' : 'false',
          'aria-disabled': option.disabled || optionGroup?.disabled ? 'true' : 'false',
        });
        item.textContent = option.textContent.trim();
        item.classList.toggle(
          `${UI}-select__option--placeholder`,
          index === 0 && option.value === '-1',
        );
        parent.appendChild(item);
      });
    }

    sync() {
      const selected = this.select.options[this.select.selectedIndex] || this.select.options[0];
      this.label.textContent = selected?.textContent?.trim() || 'Selecionar';
      if (!this.select.labels?.length && this.select.getAttribute('aria-label')) {
        this.trigger.setAttribute(
          'aria-label',
          `${this.select.getAttribute('aria-label')}: ${this.label.textContent}`,
        );
      }
      this.trigger.disabled = this.select.disabled;
      this.trigger.setAttribute('aria-disabled', String(this.select.disabled));
      this.wrapper.classList.toggle(`${UI}-select--disabled`, this.select.disabled);

      ['aria-describedby', 'aria-errormessage', 'aria-invalid'].forEach((attribute) => {
        const value = this.select.getAttribute(attribute);
        if (value) this.trigger.setAttribute(attribute, value);
        else this.trigger.removeAttribute(attribute);
      });
      this.trigger.setAttribute(
        'aria-required',
        String(this.select.required || this.select.getAttribute('aria-required') === 'true'),
      );

      this.optionItems().forEach((item) => {
        const selectedItem = Number(item.dataset.index) === this.select.selectedIndex;
        item.setAttribute('aria-selected', selectedItem ? 'true' : 'false');
      });
    }

    focusItem(item) {
      if (!item) return;
      this.optionItems().forEach((candidate) => candidate.setAttribute('tabindex', '-1'));
      item.setAttribute('tabindex', '0');
      item.focus({ preventScroll: true });
    }

    open(direction = 1) {
      if (this.trigger.disabled) return;
      this.buildOptions();
      this.sync();
      this.list.hidden = false;
      this.trigger.setAttribute('aria-expanded', 'true');
      this.wrapper.classList.add(`${UI}-select--open`);

      const selected = this.list.querySelector(
        `.${UI}-select__option[data-index="${this.select.selectedIndex}"]:not([aria-disabled="true"])`,
      );
      const enabled = this.enabledItems();
      const target = selected || (direction < 0 ? enabled.at(-1) : enabled[0]);
      window.requestAnimationFrame(() => this.focusItem(target));
    }

    close({ restoreFocus = false } = {}) {
      this.list.hidden = true;
      this.trigger.setAttribute('aria-expanded', 'false');
      this.wrapper.classList.remove(`${UI}-select--open`);
      if (restoreFocus) this.trigger.focus({ preventScroll: true });
    }

    selectIndex(index) {
      const option = this.select.options[index];
      const optionGroup = option?.closest('optgroup');
      if (!option || option.disabled || optionGroup?.disabled) return;

      this.select.selectedIndex = index;
      this.select.dispatchEvent(new window.Event('input', { bubbles: true }));
      this.select.dispatchEvent(new window.Event('change', { bubbles: true }));
      this.sync();
      this.close({ restoreFocus: true });
    }

    moveFocus(delta) {
      const enabled = this.enabledItems();
      if (!enabled.length) return;
      const current = Math.max(0, enabled.indexOf(document.activeElement));
      const next = (current + delta + enabled.length) % enabled.length;
      this.focusItem(enabled[next]);
    }

    matchTypeahead(key) {
      window.clearTimeout(this.typeaheadTimer);
      this.typeahead += key.toLocaleLowerCase('pt-BR');
      this.typeaheadTimer = window.setTimeout(() => {
        this.typeahead = '';
      }, 650);

      const normalize = (value) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('pt-BR');
      const query = normalize(this.typeahead);
      const match = this.enabledItems().find((item) =>
        normalize(item.textContent).startsWith(query),
      );
      if (match) this.focusItem(match);
    }

    mount() {
      if (!SelectComponent.supports(this.select)) return;
      if (this.select.kodetyUiSelectInstance) {
        this.select.kodetyUiSelectInstance.buildOptions();
        this.select.kodetyUiSelectInstance.sync();
        return;
      }

      state.selectCounter += 1;
      const id = `${UI}-select-${state.selectCounter}`;
      this.wrapper = element('div', `${UI}-select`, {
        'data-kodety-ui-component': 'select',
      });
      this.trigger = element('button', `${UI}-select__trigger`, {
        type: 'button',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        'aria-controls': `${id}-listbox`,
      });
      this.label = element('span', `${UI}-select__value`, {
        id: `${id}-value`,
      });
      const chevron = element('span', `${UI}-select__chevron`, {
        'aria-hidden': 'true',
        'data-kodety-icon': 'chevron-down',
      });
      this.list = element('div', `${UI}-select__list`, {
        id: `${id}-listbox`,
        role: 'listbox',
        hidden: '',
      });

      this.trigger.append(this.label, chevron);
      const nativeLabel = this.select.labels?.[0];
      if (nativeLabel) {
        if (!nativeLabel.id) nativeLabel.id = `${id}-label`;
        this.trigger.setAttribute('aria-labelledby', `${nativeLabel.id} ${id}-value`);
      } else if (this.select.getAttribute('aria-labelledby')) {
        this.trigger.setAttribute(
          'aria-labelledby',
          `${this.select.getAttribute('aria-labelledby')} ${id}-value`,
        );
      }
      this.wrapper.append(this.trigger, this.list);
      this.select.after(this.wrapper);
      this.select.classList.add(`${UI}-select__native`);
      this.select.dataset.kodetyUiSelect = 'mounted';
      this.select.setAttribute('aria-hidden', 'true');
      this.select.setAttribute('tabindex', '-1');
      this.select.hidden = true;
      this.select.kodetyUiSelectInstance = this;

      this.buildOptions();
      this.sync();

      this.trigger.addEventListener('click', () => {
        if (this.list.hidden) this.open();
        else this.close({ restoreFocus: true });
      });
      this.trigger.addEventListener('keydown', (event) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          this.open(event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1);
        } else if (event.key === 'Escape') {
          this.close({ restoreFocus: true });
        }
      });
      this.list.addEventListener('click', (event) => {
        const item =
          event.target instanceof Element
            ? event.target.closest(`.${UI}-select__option`)
            : null;
        if (item) this.selectIndex(Number(item.dataset.index));
      });
      this.list.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.moveFocus(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.moveFocus(-1);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const enabled = this.enabledItems();
          this.focusItem(event.key === 'Home' ? enabled[0] : enabled.at(-1));
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const item = document.activeElement.closest?.(`.${UI}-select__option`);
          if (item) this.selectIndex(Number(item.dataset.index));
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.close({ restoreFocus: true });
        } else if (event.key === 'Tab') {
          this.close();
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          this.matchTypeahead(event.key);
        }
      });
      this.select.addEventListener('change', () => this.sync());
      this.select.form?.addEventListener('reset', () => {
        window.requestAnimationFrame(() => this.sync());
      });
      document.addEventListener('pointerdown', (event) => {
        if (!this.wrapper.contains(event.target)) this.close();
      });
      window.addEventListener('resize', () => this.close());

      this.optionObserver = new MutationObserver(() => {
        this.buildOptions();
        this.sync();
      });
      this.optionObserver.observe(this.select, {
        attributes: true,
        attributeFilter: [
          'aria-describedby',
          'aria-errormessage',
          'aria-invalid',
          'aria-required',
          'disabled',
          'label',
          'required',
          'selected',
        ],
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
  }

  class ExternalSearchComponent {
    constructor(trailing) {
      this.trailing = trailing;
    }

    source() {
      if (screen() !== 'plugins') return null;
      const form = document.querySelector('form.search-form.search-plugins');
      const input = form?.querySelector('input[type="search"], input[name="s"]');
      return form && input ? { form, input } : null;
    }

    mount() {
      const source = this.source();
      if (!source) return false;

      const existing = document.querySelector(`[data-kodety-search-proxy="plugins"]`);
      if (existing) {
        const proxyInput = existing.querySelector(`.${UI}-search__input`);
        if (proxyInput && document.activeElement !== proxyInput)
          proxyInput.value = source.input.value;
        this.trailing.prepend(existing);
        return true;
      }

      const [, placeholder] = screenCopy();
      const proxy = element('div', `${UI}-search ${UI}-search--proxy`, {
        role: 'search',
        'aria-label': placeholder,
        'data-kodety-search-proxy': 'plugins',
        'data-kodety-ui-component': 'search',
      });
      const searchButton = element('button', `${UI}-search__icon ${UI}-search__icon-button`, {
        type: 'button',
        'aria-label': 'Pesquisar',
        'data-kodety-icon': 'search',
      });
      const proxyInput = element('input', `${UI}-search__input`, {
        type: 'search',
        placeholder,
        'aria-label': placeholder,
        autocomplete: 'off',
      });
      proxyInput.value = source.input.value;
      proxy.append(searchButton, proxyInput);

      const submit = () => {
        source.input.value = proxyInput.value;
        source.input.dispatchEvent(new window.Event('input', { bubbles: true }));
        if (typeof source.form.requestSubmit === 'function') source.form.requestSubmit();
        else window.HTMLFormElement.prototype.submit.call(source.form);
      };

      proxyInput.addEventListener('input', () => {
        source.input.value = proxyInput.value;
      });
      proxyInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
      });
      searchButton.addEventListener('click', submit);
      source.form.addEventListener('submit', () => {
        source.input.value = proxyInput.value;
      });

      source.form.classList.add(`${UI}-search-source`);
      source.form.setAttribute('aria-hidden', 'true');
      source.input.setAttribute('tabindex', '-1');
      source.form.dataset.kodetyUiSearchSource = 'mounted';
      this.trailing.prepend(proxy);
      return true;
    }
  }

  class ToolbarComponent {
    constructor(form, toolbar) {
      this.form = form;
      this.toolbar = toolbar;
    }

    findSearch() {
      const local = this.toolbar.querySelector(SELECTORS.search);
      if (local) return local;

      return all(SELECTORS.search, this.form).find(
        (candidate) =>
          !candidate.closest(`.${UI}-native-tabs`) &&
          !candidate.closest(`.${UI}-data-grid`) &&
          candidate.closest('form') === this.form,
      );
    }

    mountSearch(search, trailing) {
      if (!search || !trailing) return;

      search.classList.add(`${UI}-search`);
      const label = search.querySelector('label');
      if (label) label.classList.add(`${UI}-sr-only`);

      const input = search.querySelector('input[type="search"], input[name="s"]');
      if (input) {
        input.classList.add(`${UI}-search__input`);
        const [, placeholder] = screenCopy();
        if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', placeholder);
        if (!input.getAttribute('placeholder')) input.setAttribute('placeholder', placeholder);

        if (!search.querySelector(`.${UI}-search__icon`)) {
          const icon = element('span', `${UI}-search__icon`, {
            'aria-hidden': 'true',
            'data-kodety-icon': 'search',
          });
          search.insertBefore(icon, input);
        }
      }

      const submit = search.querySelector('input[type="submit"], button[type="submit"]');
      if (submit) {
        submit.classList.add(`${UI}-search__native-submit`);
        submit.setAttribute('tabindex', '-1');
        submit.setAttribute('aria-hidden', 'true');
      }

      trailing.appendChild(search);
    }

    mountSearchControl(trailing) {
      const search = this.findSearch();
      if (search) this.mountSearch(search, trailing);
      else new ExternalSearchComponent(trailing).mount();
    }

    mountSelectControls() {
      all('select', this.toolbar).forEach((select) => new SelectComponent(select).mount());
    }

    mount() {
      if (this.toolbar.dataset.kodetyUiToolbar === 'mounted') {
        const trailing =
          this.toolbar.querySelector(`:scope > .${UI}-toolbar__trailing`) ||
          element('div', `${UI}-toolbar__trailing`);

        this.mountSearchControl(trailing);
        all(SELECTORS.pagination, this.toolbar).forEach((pagination) => {
          new PaginationComponent(pagination).mount();
          trailing.appendChild(pagination);
        });
        if (trailing.childElementCount && trailing.parentElement !== this.toolbar) {
          this.toolbar.appendChild(trailing);
        }
        this.mountSelectControls();
        return;
      }

      this.toolbar.dataset.kodetyUiToolbar = 'mounted';
      this.toolbar.dataset.kodetyUiComponent = 'toolbar';
      this.toolbar.classList.add(`${UI}-toolbar`);
      this.toolbar.setAttribute('role', 'region');
      this.toolbar.setAttribute('aria-label', 'Controles da listagem');
      this.toolbar.classList.add(`${UI}-toolbar--${screen()}`);

      const primary = element('div', `${UI}-toolbar__primary`);
      const trailing = element('div', `${UI}-toolbar__trailing`);
      const actions = all(':scope > .alignleft.actions', this.toolbar);

      actions.forEach((action) => {
        action.classList.add(`${UI}-toolbar__actions`);
        const meaningfulControls = action.querySelectorAll('select, input, button, a').length;
        action.classList.toggle(`${UI}-toolbar__actions--empty`, meaningfulControls === 0);
        primary.appendChild(action);
      });

      this.mountSearchControl(trailing);

      all(':scope > .tablenav-pages', this.toolbar).forEach((pagination) => {
        new PaginationComponent(pagination).mount();
        trailing.appendChild(pagination);
      });

      all(':scope > br.clear', this.toolbar).forEach((clear) => clear.remove());
      if (primary.childElementCount) this.toolbar.prepend(primary);
      if (trailing.childElementCount) this.toolbar.appendChild(trailing);
      this.mountSelectControls();
      this.toolbar.classList.toggle(`${UI}-toolbar--actions-empty`, !primary.childElementCount);
    }
  }

  class DataGridComponent {
    constructor(table) {
      this.table = table;
    }

    enhanceRows() {
      all('tbody > tr', this.table).forEach((row) => {
        row.classList.add(`${UI}-table__row`);
        row.classList.toggle(`${UI}-table__row--empty`, row.classList.contains('no-items'));
        row.classList.toggle(
          `${UI}-table__row--inline-edit`,
          row.matches('.inline-edit-row, .quick-edit-row, .bulk-edit-row'),
        );
        row.classList.toggle(`${UI}-table__row--active`, row.classList.contains('active'));
        row.classList.toggle(`${UI}-table__row--inactive`, row.classList.contains('inactive'));
        row.classList.toggle(
          `${UI}-table__row--pending`,
          row.matches('.unapproved, .status-unapproved, .pending'),
        );

        const title = row
          .querySelector('.row-title, .plugin-title strong, .column-primary strong')
          ?.textContent?.trim();
        const actions = row.querySelector('.row-actions');
        if (actions) {
          actions.classList.add(`${UI}-row-actions`);
          actions.setAttribute('role', 'group');
          actions.setAttribute('aria-label', title ? `Ações para ${title}` : 'Ações da linha');
        }
      });

      all('.toggle-row', this.table).forEach((toggle) => {
        const syncToggle = () => {
          const expanded = toggle.closest('tr')?.classList.contains('is-expanded') || false;
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute(
            'aria-label',
            expanded ? 'Ocultar detalhes desta linha' : 'Mostrar detalhes desta linha',
          );
        };
        syncToggle();
        toggle.setAttribute('data-kodety-icon', 'chevron-down');
        toggle.classList.add(`${UI}-table__toggle`);
        if (toggle.dataset.kodetyUiToggle !== 'mounted') {
          toggle.dataset.kodetyUiToggle = 'mounted';
          toggle.addEventListener('click', () => window.requestAnimationFrame(syncToggle));
        }
      });
    }

    mount() {
      if (this.table.dataset.kodetyUiGrid === 'mounted') {
        this.enhanceRows();
        return;
      }

      const wrapper = element('div', `${UI}-data-grid`, {
        'data-kodety-ui-component': 'data-grid',
        role: 'region',
        tabindex: '0',
      });
      const caption = this.table.querySelector('caption')?.textContent?.trim();
      const [itemName] = screenCopy();
      wrapper.setAttribute('aria-label', caption || `Lista de ${itemName}`);

      this.table.before(wrapper);
      wrapper.appendChild(this.table);
      this.table.classList.add(`${UI}-table`);
      this.table.classList.add(`${UI}-table--${screen()}`);
      wrapper.classList.add(`${UI}-data-grid--${screen()}`);
      this.table.dataset.kodetyUiGrid = 'mounted';

      all('thead th', this.table).forEach((header) => {
        if (!header.getAttribute('scope')) header.setAttribute('scope', 'col');
      });

      const footer = this.table.querySelector('tfoot');
      if (footer) {
        footer.classList.add(`${UI}-table__duplicate-footer`);
        footer.hidden = true;
        footer.setAttribute('aria-hidden', 'true');
      }

      this.enhanceRows();

      all('tbody tr.no-items td', this.table).forEach((emptyCell) => {
        emptyCell.setAttribute('role', 'status');
      });
    }
  }

  const hideZeroBadges = () => {
    all('#adminmenu .awaiting-mod, #adminmenu .update-plugins, #adminmenu .plugin-count').forEach(
      (badge) => {
        const count = numberFrom(badge.textContent);
        const empty = count === 0;
        badge.classList.toggle(`${UI}-badge--empty`, empty);
        badge.hidden = empty;
        if (empty) badge.setAttribute('aria-hidden', 'true');
        else badge.removeAttribute('aria-hidden');
      },
    );
  };

  const mountTabs = () => {
    all(SELECTORS.tabs).forEach((tabs) => {
      if (tabs.closest('.media-frame, .block-editor, .interface-interface-skeleton')) return;
      if (tabs.classList.contains('nav-tab-wrapper') && !document.querySelector(SELECTORS.table)) {
        return;
      }
      new TabsComponent(tabs).mount();
    });
  };

  const mountForms = () => {
    const forms = all(SELECTORS.listForm).filter((form, index, formsList) => {
      return formsList.indexOf(form) === index && form.querySelector(SELECTORS.table);
    });

    forms.forEach((form) => {
      form.classList.add(`${UI}-list-form`);
      form.dataset.kodetyUiComponent = 'list-form';

      const toolbar = form.querySelector(SELECTORS.topToolbar);
      if (toolbar) new ToolbarComponent(form, toolbar).mount();

      all(SELECTORS.bottomToolbar, form).forEach((bottom) => {
        bottom.classList.add(`${UI}-toolbar--duplicate`);
        bottom.hidden = true;
        bottom.setAttribute('aria-hidden', 'true');
      });

      all(SELECTORS.table, form).forEach((table) => new DataGridComponent(table).mount());
    });
  };

  const mount = () => {
    if (!document.body) return;
    hideZeroBadges();
    mountTabs();
    mountForms();
    document.body.classList.add(`${UI}-lists-ready`);
    window.KodetyIcons?.scan?.(document);
  };

  const scheduleMount = () => {
    if (state.frame) return;
    state.frame = window.requestAnimationFrame(() => {
      state.frame = 0;
      mount();
    });
  };

  const boot = () => {
    mount();
    state.observer = new MutationObserver((mutations) => {
      const requiresMount = mutations.some((mutation) => {
        if (mutation.type === 'characterData') {
          return Boolean(mutation.target.parentElement?.closest('#adminmenu'));
        }
        return Array.from(mutation.addedNodes).some(
          (node) =>
            node.nodeType === Node.ELEMENT_NODE &&
            (node.matches?.(
              `${SELECTORS.table}, ${SELECTORS.tabs}, ${SELECTORS.topToolbar}, ${SELECTORS.search}, #adminmenu`,
            ) ||
              node.closest?.(`${SELECTORS.table}, ${SELECTORS.search}, #adminmenu`) ||
              node.querySelector?.(
                `${SELECTORS.table}, ${SELECTORS.tabs}, ${SELECTORS.topToolbar}, ${SELECTORS.search}, #adminmenu`,
              )),
        );
      });
      if (requiresMount) scheduleMount();
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
