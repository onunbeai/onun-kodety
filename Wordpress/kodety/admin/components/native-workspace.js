/* global document, window */
(() => {
  'use strict';
  const body = document.body;
  const config = window.kodetyAdmin || {};
  try {
    if (!body?.classList.contains('kodety-os') || body.classList.contains('block-editor-page')) return;
    if (config.adminSurface && config.adminSurface !== 'native') return;
    const wrap = document.querySelector('#wpbody-content > .wrap');
    if (!wrap || wrap.dataset.kodetyWorkspace === 'ready' || config.nativePluginSurface) return;
    if (String(config.screen?.id || '').includes('_page_')) return;

    const en = String(config.uiLocale || document.documentElement.lang).toLowerCase().startsWith('en');
    const text = (pt, english) => en ? english : pt;
    const create = (tag, className, content) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (content) node.textContent = content;
      return node;
    };
    const icon = name => {
      const node = create('span', 'kdw-icon');
      node.dataset.kodetyIcon = name;
      node.setAttribute('aria-hidden', 'true');
      window.KodetyIcons?.mount?.(node, name);
      return node;
    };
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const direct = (root, selector) => Array.from(root.children).filter(node => node.matches(selector));
    const header = wrap.querySelector(':scope > .kodety-ui-page-header');
    header?.classList.add('kdw-header');
    wrap.classList.add('kdw-workspace');
    wrap.dataset.kodetyWorkspace = 'ready';

    const pageContext = body.matches('.edit-comments-php')
      ? text('Acompanhe conversas e gerencie a moderação do seu conteúdo.', 'Follow conversations and manage moderation across your content.')
      : body.matches('.plugins-php')
        ? text('Gerencie as extensões e os recursos disponíveis no seu site.', 'Manage the extensions and capabilities available on your site.')
        : body.matches('.users-php')
          ? text('Organize as pessoas e os níveis de acesso ao seu site.', 'Manage people and their level of access to your site.')
          : body.matches('.edit-php')
            ? text('Organize, edite e publique o conteúdo do seu site.', 'Organize, edit and publish your site content.')
            : '';
    if (pageContext && header && !header.querySelector('.kodety-ui-page-header__description')) {
      header.querySelector('.kodety-ui-page-header__copy')?.append(create('p', 'kodety-ui-page-header__description kdw-page-context', pageContext));
    }

    const makeCard = (label, symbol = 'files', modifier = '') => {
      const card = create('section', `kdw-card ${modifier}`.trim());
      const head = create('header', 'kdw-card__head');
      head.append(icon(symbol), create('h2', 'kdw-card__title', label));
      const content = create('div', 'kdw-card__body');
      card.append(head, content);
      return {card, head, content};
    };

    const arrangeUpdates = () => {
      if (!body.classList.contains('update-core-php')) return;
      const version = wrap.querySelector(':scope > .wp-current-version');
      if (!version) return; // Core upgrade progress and confirmation are native flows.
      const checked = wrap.querySelector(':scope > .update-last-checked');
      const automatic = wrap.querySelector(':scope > .auto-update-status');
      const response = wrap.querySelector(':scope > h2.response');
      const nodes = Array.from(wrap.childNodes);
      const layout = create('div', 'kdw-update-layout');
      const main = create('div', 'kdw-update-main');
      const rail = create('aside', 'kdw-context-rail');
      rail.setAttribute('aria-label', text('Contexto das atualizações', 'Update information'));
      layout.append(main, rail);
      wrap.append(layout);

      const platform = makeCard('WordPress', 'globe', 'kdw-platform-card');
      version.classList.add('kdw-platform-version');
      platform.head.append(version);
      main.append(platform.card);
      if (response) {
        const state = create('div', 'kdw-update-status');
        state.append(icon('refresh'), response);
        platform.content.append(state);
      }
      if (checked) {
        const review = makeCard(text('Última verificação', 'Last checked'), 'refresh', 'kdw-context-card');
        review.content.append(checked);
        rail.append(review.card);
      }
      if (automatic) {
        const policy = makeCard(text('Atualizações automáticas', 'Automatic updates'), 'shield', 'kdw-context-card');
        policy.content.append(automatic);
        rail.append(policy.card);
      }

      let current = platform;
      let coreStarted = false;
      for (const node of nodes) {
        if (node === header || node === version || node === checked || node === automatic || node === response) {
          if (node === response || node === version) coreStarted = true;
          continue;
        }
        if (node.nodeType === 3) {
          if (coreStarted && clean(node.textContent)) current.content.append(node);
          continue;
        }
        if (!(node instanceof window.Element) || node.matches('h1,.wp-header-end,script,style,.notice,.updated,.error') || !coreStarted) continue;
        if (node.matches('h2') && !node.classList.contains('response')) {
          const label = clean(node.textContent);
          const kind = /plugin/i.test(label) ? 'plugins' : /theme|tema/i.test(label) ? 'appearance' : 'globe';
          current = makeCard(label, kind, 'kdw-update-section');
          current.head.querySelector('h2').replaceWith(node);
          node.classList.add('kdw-card__title');
          main.append(current.card);
        } else {
          current.content.append(node);
        }
      }
      const reinstall = platform.content.querySelector('form[action*="do-core-reinstall"]');
      if (reinstall && !platform.content.querySelector('form[action*="do-core-upgrade"]')) {
        platform.card.classList.add('is-current');
        const statusIcon = platform.card.querySelector('.kdw-update-status > .kdw-icon');
        if (statusIcon) {
          statusIcon.dataset.kodetyIcon = 'check';
          window.KodetyIcons?.mount?.(statusIcon, 'check');
        }
      }
      for (const card of main.querySelectorAll('.kdw-update-section')) {
        if (!card.querySelector('form,table')) card.classList.add('is-summary');
      }
    };

    const arrangeLists = () => {
      const surfaces = [];
      let serial = 0;
      let active = null;
      const items = menu => Array.from(menu.querySelectorAll('a[href],button')).filter(node => !node.disabled && !node.closest('.hidden,[hidden]') && node.getClientRects().length);
      const close = (restore = false) => {
        if (!active) return;
        const {menu, trigger} = active;
        active = null;
        if (typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) menu.hidePopover();
        menu.removeAttribute('popover');
        menu.classList.remove('is-open');
        if ((restore || menu.contains(document.activeElement)) && trigger.isConnected) trigger.focus();
        menu.setAttribute('aria-hidden', 'true');
        menu.querySelectorAll('a[href],button').forEach(node => { node.tabIndex = -1; });
        trigger.setAttribute('aria-expanded', 'false');
      };
      const open = (trigger, focus = true) => {
        const menu = document.getElementById(trigger.dataset.kdwMenu);
        if (!menu) return;
        close();
        const details = menu.querySelector('.kdw-row-details');
        if (details) {
          const expanded = details.closest('tr').classList.contains('is-expanded');
          details.setAttribute('aria-expanded', String(expanded));
          const label = details.querySelector('span');
          if (label) label.textContent = expanded ? text('Ocultar detalhes', 'Hide details') : text('Mostrar detalhes', 'Show details');
        }
        active = {menu, trigger};
        menu.classList.add('is-open');
        menu.setAttribute('aria-hidden', 'false');
        trigger.setAttribute('aria-expanded', 'true');
        if (typeof menu.showPopover === 'function') {
          menu.setAttribute('popover', 'manual');
          menu.showPopover();
        }
        const anchor = trigger.getBoundingClientRect();
        const bounds = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8)) + 'px';
        if (focus) items(menu)[0]?.focus();
      };
      const enhanceRecordTitles = root => {
        root.querySelectorAll('tbody > tr:not(.inline-edit-row) .column-title > strong').forEach(title => {
          if (title.classList.contains('kdw-record-heading')) return;
          const states = Array.from(title.children).filter(node => node.classList.contains('post-state'));
          const symbol = title.querySelector(':scope > .kdw-record-icon');
          // WordPress prints the dash outside state spans and the list separator
          // inside each preceding span. Neither is part of the state label.
          const separator = states[0]?.previousSibling;
          if (separator?.nodeType === 3 && /^[\s\u00a0\u2014]+$/.test(separator.textContent)) separator.textContent = '';
          states.slice(0, -1).forEach(state => {
            const tail = state.lastChild;
            if (tail?.nodeType === 3) tail.textContent = tail.textContent.replace(/\s*[,;\u060c\u3001\uff0c]\s*$/, '');
          });
          const copy = create('span', 'kdw-record-copy');
          const name = create('span', 'kdw-record-name');
          Array.from(title.childNodes).forEach(node => {
            if (node !== symbol && !states.includes(node)) name.append(node);
          });
          copy.append(name);
          if (states.length) {
            const status = create('span', 'kdw-record-states');
            states.forEach((state, index) => {
              if (index) status.append(document.createTextNode(' '));
              status.append(state);
            });
            copy.append(document.createTextNode(' '), status);
          }
          title.append(copy);
          title.classList.add('kdw-record-heading');
        });
      };
      const enhance = root => {
        root.querySelectorAll('tbody > tr[data-plugin] .plugin-title > strong').forEach(title => {
          let status = title.querySelector('.kdw-plugin-status');
          if (!status) {
            title.dataset.kdwName = clean(title.textContent);
            status = create('span', 'kdw-plugin-status');
            title.append(status);
          }
          const active = title.closest('tr').classList.contains('active');
          status.textContent = active ? text('Ativo', 'Active') : text('Inativo', 'Inactive');
          status.classList.toggle('is-active', active);
        });
        root.querySelectorAll('tbody > tr.comment').forEach(row => {
          row.classList.add('kdw-comment-row');
          const state = row.classList.contains('unapproved') ? text('Pendente', 'Pending') : row.classList.contains('spam') ? 'Spam' : row.classList.contains('trash') ? text('Lixeira', 'Trash') : text('Aprovado', 'Approved');
          row.querySelectorAll('.column-author > strong,.comment-author > strong').forEach(author => {
            let status = author.querySelector('.kdw-comment-status');
            if (!status) { author.dataset.kdwName = clean(author.textContent); status = create('span', 'kdw-comment-status'); author.append(status); }
            status.textContent = state;
            if (!author.parentElement.querySelector('.kdw-author-contact')) {
              const contacts = create('div', 'kdw-author-contact');
              Array.from(author.parentElement.childNodes).forEach(node => { if (node !== author) contacts.append(node); });
              author.after(contacts);
            }
          });
        });
        root.querySelectorAll('tbody > tr:not(.inline-edit-row) .row-actions:not(.kdw-row-menu)').forEach(menu => {
          const row = menu.closest('tr');
          if (!menu.querySelector('a[href],button') || row.closest('tbody')?.classList.contains('hidden')) return;
          menu.classList.add('kdw-row-menu');
          menu.id ||= `kdw-row-menu-${++serial}`;
          menu.setAttribute('role', 'menu');
          menu.setAttribute('aria-hidden', 'true');
          menu.childNodes.forEach(node => { if (node.nodeType === 3 && /^[\s|]*$/.test(node.textContent)) node.textContent = ''; });
          const details = row.querySelector('.toggle-row');
          if (details && !row.closest('table.plugins')) {
            details.classList.add('kdw-row-details');
            const label = details.querySelector('.screen-reader-text');
            if (label) { label.classList.remove('screen-reader-text'); label.textContent = text('Mostrar detalhes', 'Show details'); }
            menu.append(details);
          }
          menu.querySelectorAll('a[href],button').forEach(node => { node.setAttribute('role', 'menuitem'); node.tabIndex = -1; });
          const trigger = create('button', 'kdw-row-trigger');
          trigger.type = 'button';
          trigger.id = `${menu.id}-trigger`;
          menu.setAttribute('aria-labelledby', trigger.id);
          trigger.dataset.kdwMenu = menu.id;
          const titleNode = row.querySelector('.row-title,.plugin-title strong,.column-author strong,.column-primary strong');
          const name = titleNode?.dataset.kdwName || clean(titleNode?.textContent);
          trigger.setAttribute('aria-label', text('Ações', 'Actions') + (name ? `: ${name}` : ''));
          trigger.setAttribute('aria-haspopup', 'menu');
          trigger.setAttribute('aria-expanded', 'false');
          trigger.setAttribute('aria-controls', menu.id);
          trigger.append(icon('more'));
          let actions = row.querySelector(':scope > .kdw-column-actions');
          if (!actions) { actions = create('td', 'kdw-column-actions'); row.append(actions); }
          actions.dataset.colname = text('Ações', 'Actions');
          actions.append(trigger);
          row.classList.add('kdw-data-row');
          const title = row.querySelector('.column-title > strong,.plugin-title > strong');
          if (title && !title.querySelector('.kdw-record-icon')) {
            const symbol = icon(row.matches('[data-plugin]') ? 'plugins' : 'file');
            symbol.classList.add('kdw-record-icon');
            title.prepend(symbol);
          }
        });
        enhanceRecordTitles(root);
        const tables = new Set(root.querySelectorAll('table.wp-list-table'));
        if (root.closest('table.wp-list-table')) tables.add(root.closest('table.wp-list-table'));
        tables.forEach(table => {
          if (!table.querySelector('.kdw-column-actions')) return;
          table.querySelectorAll('thead > tr,tfoot > tr').forEach(row => {
            if (row.querySelector('.kdw-column-actions')) return;
            const column = create('th', 'kdw-column-actions');
            column.scope = 'col';
            column.append(create('span', 'screen-reader-text', text('Ações', 'Actions')));
            row.append(column);
          });
          table.querySelectorAll('tbody > tr').forEach(row => {
            const spanning = row.querySelector(':scope > [colspan]');
            if (spanning) {
              spanning.colSpan = Math.max(spanning.colSpan, (table.querySelector('thead tr')?.children.length || 0) - row.children.length + 1);
            } else if (!row.querySelector('.kdw-column-actions')) row.append(create('td', 'kdw-column-actions'));
          });
        });
      };
      const selection = () => surfaces.forEach(surface => {
        // Match core selection: cached/hidden comments do not participate.
        const fields = Array.from(surface.querySelectorAll('.kdw-list-table > tbody:first-of-type > tr > .check-column input[type="checkbox"]:not(:disabled)')).filter(field => field.getClientRects().length);
        const count = fields.filter(field => field.checked).length;
        const total = fields.length;
        surface.classList.toggle('kdw-list-empty', !surface.querySelector('.kdw-list-table > tbody:first-of-type > tr:not(.no-items):not(.inline-edit-row):not(#replyrow)'));
        surface.querySelectorAll('thead .check-column input,tfoot .check-column input').forEach(field => { field.indeterminate = count > 0 && count < total; });
        const bar = surface.querySelector('.kdw-list-selection');
        if (!bar) return;
        bar.hidden = count === 0;
        bar.querySelector('output').textContent = text(`${count} selecionado${count === 1 ? '' : 's'}`, `${count} selected`);
      });
      const prepare = () => {
      for (let i = surfaces.length - 1; i >= 0; i--) if (!surfaces[i].isConnected) surfaces.splice(i, 1);
      for (const table of wrap.querySelectorAll('table.wp-list-table')) {
        if (table.closest('.kdw-list-surface,.kdw-update-layout')) continue;
        const form = table.closest('form');
        const parent = table.parentElement;
        if (!form || parent.closest('table')) continue;
        const nativeTop = direct(parent, '.tablenav.top')[0];
        const top = nativeTop || create('div', 'tablenav top');
        const bottom = direct(parent, '.tablenav.bottom')[0] || create('div', 'tablenav bottom');
        const surface = create('section', 'kdw-list-surface');
        surface.setAttribute('aria-label', clean(wrap.querySelector('h1')?.textContent) || text('Conteúdo', 'Content'));
        (nativeTop || table).before(surface);
        const tabs = wrap.querySelector(':scope > .subsubsub') || direct(form, '.subsubsub')[0];
        if (tabs && !tabs.querySelector('input,select,button,textarea')) {
          tabs.classList.add('kdw-tabs');
          tabs.setAttribute('aria-label', text('Filtrar conteúdo', 'Filter content'));
          if (form.id === 'bulk-action-form') {
            tabs.classList.add('kdw-tabs-detached'); // Plugin search replaces the entire bulk form.
            const searchForm = wrap.querySelector('form.search-plugins');
            searchForm?.classList.add('kdw-search-detached');
            if (!form.closest('.kdw-plugin-workspace')) {
              const workspace = create('section', 'kdw-plugin-workspace');
              tabs.before(workspace);
              workspace.append(tabs);
              if (searchForm) workspace.append(searchForm);
              workspace.append(form);
            }
            const search = searchForm?.querySelector('.search-box');
            if (search && !search.classList.contains('kdw-list-search')) {
              search.classList.add('kdw-list-search');
              search.prepend(icon('search'));
              const field = search.querySelector('input[name="s"]');
              if (field && !field.placeholder) field.placeholder = clean(search.querySelector('label')?.textContent);
            }
          } else (top || surface).prepend(tabs);
        }
        if (top) {
          top.classList.add('kdw-list-toolbar');
          surface.append(top);
          const search = form.querySelector('.search-box');
          if (search && search.closest('form') === form) {
            search.classList.add('kdw-list-search');
            const field = search.querySelector('input[name="s"]');
            if (field && !field.placeholder) field.placeholder = text('Buscar nesta lista…', 'Search this list…');
            search.prepend(icon('search'));
            if (tabs?.parentElement === top) tabs.after(search); else top.prepend(search);
          }
          const bulk = top.querySelector('.bulkactions');
          const role = top.querySelector('select[name="new_role"]')?.closest('.actions');
          if (bulk || role) {
            const bar = create('div', 'kdw-list-selection');
            const count = create('output');
            count.setAttribute('aria-live', 'polite');
            bar.append(count);
            if (bulk) bar.append(bulk);
            if (role) bar.append(role);
            surface.append(bar);
          }
          const pages = top.querySelector('.tablenav-pages');
          if (pages) {
            bottom.querySelector('.tablenav-pages')?.classList.add('kdw-pagination-duplicate');
            bottom.append(pages);
          }
          const filters = direct(top, '.actions').filter(group => group.querySelector('select,input:not([type="hidden"]),button'));
          if (filters.length) {
            const disclosure = create('details', 'kdw-list-filters');
            const summary = create('summary');
            summary.append(icon('sliders'), create('span', '', text('Filtros', 'Filters')), icon('chevron-down'));
            const panel = create('div', 'kdw-list-filter-panel');
            panel.append(...filters);
            disclosure.append(summary, panel);
            top.append(disclosure);
            const changed = filters.flatMap(group => Array.from(group.querySelectorAll('select'))).filter(field => field.value && field.value !== '0').length;
            if (changed) summary.append(create('span', 'kdw-filter-count', String(changed)));
          }
        }
        const scroll = create('div', 'kdw-list-scroll');
        surface.append(scroll);
        scroll.append(table);
        table.classList.add('kdw-list-table');
        if (table.classList.contains('comments')) {
          const primaryHeading = table.querySelector('thead .column-comment');
          const selectAll = table.querySelector('thead input[type="checkbox"]');
          if (primaryHeading && selectAll?.id) {
            const label = create('label', 'kdw-select-all', text('Selecionar todos', 'Select all'));
            label.htmlFor = selectAll.id;
            primaryHeading.replaceChildren(label);
          }
          const sort = create('details', 'kdw-list-sort');
          const summary = create('summary');
          summary.append(icon('sort'), create('span', '', text('Ordenar', 'Sort')), icon('chevron-down'));
          const panel = create('div', 'kdw-list-sort-panel');
          table.querySelectorAll('thead .sortable,thead .sorted').forEach(column => {
            const link = column.querySelector('a');
            if (!link) return;
            const label = clean(link.querySelector('span:not(.screen-reader-text,.sorting-indicators)')?.textContent || link.textContent);
            column.append(create('span', 'kdw-sort-column-label', label));
            link.dataset.kdwSort = column.id;
            link.dataset.kdwSortDirection = column.classList.contains('asc') ? 'asc' : 'desc';
            if (column.classList.contains('sorted')) link.setAttribute('aria-current', 'true');
            panel.append(link);
          });
          sort.append(summary, panel);
          top?.append(sort);
        }
        table.querySelectorAll('.column-comments .vers').forEach(node => {
          node.dataset.kodetyIcon = 'comments';
          window.KodetyIcons?.mount?.(node, 'comments');
        });
        bottom.classList.add('kdw-list-footer');
        surface.append(bottom);
        surfaces.push(surface);
      }
      };
      prepare();
      if (!surfaces.length) return;
      surfaces.forEach(enhance);
      selection();
      const refresh = () => { close(); prepare(); surfaces.forEach(enhance); selection(); };
      wrap.addEventListener('pointerover', event => {
        const row = event.target.closest('.kdw-list-table tbody > tr');
        if (row?.querySelector('.row-actions:not(.kdw-row-menu)')) enhance(row.parentElement);
      });
      wrap.addEventListener('focusin', event => {
        const menu = event.target.closest('.kdw-row-menu');
        if (menu && active?.menu !== menu) open(menu.nextElementSibling, false);
      });
      wrap.addEventListener('click', event => {
        const trigger = event.target.closest('.kdw-row-trigger');
        if (trigger) {
          event.preventDefault();
          if (active?.trigger === trigger) close(true); else open(trigger);
        } else if (event.target.closest('.kdw-row-menu a,.kdw-row-menu button')) {
          close();
        }
      });
      wrap.addEventListener('change', event => {
        if (event.target.matches('input[type="checkbox"]')) selection();
      });
      document.addEventListener('pointerdown', event => {
        if (active && !active.menu.contains(event.target) && !active.trigger.contains(event.target)) close();
        wrap.querySelectorAll('.kdw-list-filters[open],.kdw-list-sort[open]').forEach(panel => { if (!panel.contains(event.target)) panel.open = false; });
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') wrap.querySelectorAll('.kdw-list-filters[open],.kdw-list-sort[open]').forEach(panel => { panel.open = false; panel.querySelector('summary').focus(); });
        if (!active) return;
        if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
        if (event.key === 'Tab') { close(true); return; }
        if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
        const choices = items(active.menu);
        const index = choices.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
        event.preventDefault();
        choices[next]?.focus();
      });
      window.addEventListener('resize', () => close());
      document.addEventListener('scroll', event => { if (active && !active.menu.contains(event.target)) close(); }, true);
      if (window.jQuery) {
        window.jQuery(wrap).on('wpListAddEnd.kdw wpListDelEnd.kdw wpListDimEnd.kdw', refresh);
        window.jQuery(document).on('wp-plugin-update-success.kdw wp-plugin-activate-success.kdw wp-plugin-delete-success.kdw', refresh);
        window.jQuery(document).on('ajaxComplete.kdw', (_event, _request, settings) => {
          if (/(?:action=|"action":")(?:inline-save(?:-tax)?|edit-comment|replyto-comment|fetch-list|search-plugins)/.test(String(settings.data || ''))) refresh();
        });
      }
    };

    const rowGroup = row => {
      if (body.classList.contains('options-reading-php')) {
        if (row.querySelector('[name="show_on_front"],#page_on_front,#page_for_posts')) return ['homepage', text('Página inicial', 'Homepage')];
        if (row.querySelector('#posts_per_page,#posts_per_rss,[name="rss_use_excerpt"]')) return ['feeds', text('Conteúdo e feeds', 'Content and feeds')];
        if (row.querySelector('#blog_public')) return ['visibility', text('Visibilidade', 'Visibility')];
      }
      if (row.querySelector('#blogname,#blogdescription,#site_icon')) return ['identity', text('Identidade do site', 'Site identity')];
      if (row.querySelector('#siteurl,#home,#admin_email,#new_admin_email')) return ['addresses', text('Endereços e contato', 'Addresses and contact')];
      if (row.querySelector('#users_can_register,#default_role')) return ['access', text('Acesso ao site', 'Site access')];
      if (row.querySelector('#WPLANG,#timezone_string,#gmt_offset,[name="date_format"],[name="time_format"],#start_of_week')) return ['regional', text('Idioma e região', 'Language and region')];
      return null;
    };

    const arrangeForms = () => {
      if (!body.matches('.options-general-php,.options-writing-php,.options-reading-php,.options-discussion-php,.options-media-php,.options-permalink-php,.options-privacy-php,.profile-php,.user-edit-php,.user-new-php,.site-settings-php,.site-info-php')) return;
      wrap.classList.add('kdw-settings-workspace');
      if (body.classList.contains('options-discussion-php')) {
        wrap.querySelectorAll('.form-table fieldset > input[type="checkbox"]').forEach(field => {
          const label = field.nextElementSibling;
          if (!label?.matches('label') || label.htmlFor !== field.id) return;
          const line = create('div', 'kdw-checkline');
          field.before(line);
          line.append(field, label);
        });
      }
      for (const table of wrap.querySelectorAll('.form-table')) {
        if (table.closest('.kdw-form-card,.postbox')) continue;
        const previous = table.previousElementSibling;
        const heading = previous?.matches('h2,h3') ? previous : previous?.matches('p') && previous.previousElementSibling?.matches('h2,h3') ? previous.previousElementSibling : null;
        const section = create('section', 'kdw-form-card');
        const label = create('header', 'kdw-form-card__head');
        const content = create('div', 'kdw-form-card__body');
        (heading || table).before(section);
        section.append(label, content);
        if (heading) {
          label.append(heading);
          if (previous !== heading && previous?.matches('p')) label.append(previous);
        } else {
          label.append(create('h2', '', text('Preferências', 'Preferences')));
        }
        content.append(table);
        if (body.matches('.options-general-php,.options-reading-php')) {
          section.classList.add('kdw-form-card--grouped');
          label.querySelector('h2').textContent = text('Configurações do site', 'Site settings');
          let lastGroup = '';
          let groupBody = null;
          const rows = Array.from(table.rows);
          for (const row of rows) {
            const group = rowGroup(row);
            if (group && group[0] !== lastGroup) {
              lastGroup = group[0];
              groupBody = create('tbody', 'kdw-form-group');
              const divider = create('tr', 'kdw-form-divider');
              const cell = create('th');
              cell.colSpan = 2;
              cell.append(create('h3', '', group[1]));
              const descriptions = {
                identity: text('Nome e apresentação usados para identificar seu site.', 'The name and appearance used to identify your site.'),
                addresses: text('Endereços do site e contato para administração.', 'Your website addresses and administrative contact.'),
                access: text('Defina quem pode se cadastrar e o acesso inicial.', 'Choose who can register and their initial access.'),
                regional: text('Idioma, fuso horário e formatos de exibição.', 'Language, time zone and display formats.'),
                homepage: text('Escolha o conteúdo apresentado na entrada do site.', 'Choose the content shown when visitors arrive on your site.'),
                feeds: text('Quantidade e apresentação das publicações.', 'How many posts to show and how they are presented.'),
                visibility: text('Preferência de indexação nos mecanismos de busca.', 'Your preference for search engine indexing.')
              };
              cell.append(create('p', '', descriptions[lastGroup]));
              divider.append(cell);
              groupBody.append(divider);
              table.append(groupBody);
            }
            if (groupBody) groupBody.append(row);
          }
          table.querySelectorAll('tbody:not(.kdw-form-group)').forEach(tbody => { if (!tbody.rows.length) tbody.remove(); });
        }
      }
      for (const footer of wrap.querySelectorAll('form > p.submit')) footer.classList.add('kdw-form-footer');
    };

    const arrangeProfile = () => {
      if (!body.matches('.profile-php,.user-edit-php')) return;
      const form = wrap.querySelector('#your-profile');
      if (!form) return;
      form.classList.add('kdw-profile-form');
      const sections = direct(form, '.kdw-form-card');
      const index = create('nav', 'kdw-profile-index');
      index.setAttribute('aria-label', text('Seções do perfil', 'Profile sections'));
      const content = create('div', 'kdw-profile-content');
      const layout = create('div', 'kdw-profile-layout');
      sections[0]?.before(layout);
      layout.append(index, content);
      const groups = [
        ['.user-user-login-wrap', 'identity', 'user', text('Dados pessoais', 'Personal details'), text('Seu nome e como você aparece no site.', 'Your name and how you appear on the site.')],
        ['.user-email-wrap', 'contact', 'mail', text('Contato', 'Contact'), text('Endereços para contato e notificações.', 'Addresses for contact and notifications.')],
        ['.user-description-wrap', 'about', 'file', text('Sobre você', 'About you'), text('Biografia e imagem do seu perfil.', 'Your biography and profile image.')],
        ['.user-pass1-wrap', 'security', 'shield', text('Segurança', 'Security'), text('Senha e sessões conectadas à sua conta.', 'Password and sessions connected to your account.')],
        ['.user-admin-color-wrap', 'preferences', 'sliders', text('Preferências', 'Preferences'), text('Personalize sua experiência no painel.', 'Customize your dashboard experience.')],
      ];
      const appendSection = (section, id, symbol, label, description) => {
        section.id ||= `kdw-profile-${id}`;
        section.classList.add('kdw-profile-section');
        const head = section.querySelector('.kdw-form-card__head');
        if (head) {
          const heading = head.querySelector('h2,h3');
          if (heading) heading.textContent = label;
          if (description) head.append(create('p', '', description));
        }
        const link = create('a');
        link.href = `#${section.id}`;
        link.append(icon(symbol), create('span', '', label));
        index.append(link);
        content.append(section);
      };
      for (const [selector, id, symbol, label, description] of groups) {
        const section = sections.find(node => node.querySelector(selector));
        if (section) appendSection(section, id, symbol, label, description);
      }
      sections.filter(section => !content.contains(section)).forEach((section, i) => appendSection(section, `extra-${i}`, 'settings', clean(section.querySelector('h2,h3')?.textContent), ''));
      const passwords = form.querySelector('#application-passwords-section');
      if (passwords) appendSection(passwords, 'applications', 'lock', text('Aplicativos', 'Applications'), '');
      const footer = direct(form, '.submit')[0];
      if (footer) content.append(footer);
      const updateIndex = () => index.querySelectorAll('a').forEach((link, i) => {
        if (link.hash === window.location.hash || (!window.location.hash && i === 0)) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      window.addEventListener('hashchange', updateIndex);
      updateIndex();
    };

    const arrangeCatalog = () => {
      if (!body.matches('.themes-php,.theme-install-php')) return;
      const fillPreviews = () => {
        wrap.querySelectorAll('.theme-overlay .theme-header:not(:has(.kdw-theme-dialog-label))').forEach(head => {
          const label = create('span', 'kdw-theme-dialog-label');
          label.append(icon('appearance'), create('span', '', text('Detalhes do tema', 'Theme details')));
          head.prepend(label);
        });
        wrap.querySelectorAll('.theme-screenshot:not(:has(img)),.theme-overlay .screenshot.blank').forEach(preview => {
        if (preview.classList.contains('kdw-preview-empty') || preview.closest('.add-new-theme')) return;
        preview.classList.add('kdw-preview-empty');
        preview.append(icon('appearance'), create('span', '', text('Prévia indisponível', 'Preview unavailable')));
        });
      };
      fillPreviews();
      new MutationObserver(fillPreviews).observe(wrap, {childList: true, subtree: true});
    };


    arrangeUpdates();
    arrangeLists();
    arrangeForms();
    arrangeProfile();
    arrangeCatalog();
    window.KodetyNativeTools?.({ body, wrap, config, header, text, create, icon, direct });
    window.KodetyIcons?.scan?.(wrap);
    body.classList.add('kodety-native-workspace-ready');
  } finally {
    window.kodetyNativeReveal?.();
    document.documentElement.classList.remove('kodety-native-pending');
  }
})();
