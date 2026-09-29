(() => {
  const adminConfig = window.kodetyAdmin || {};
  const svg = (content) =>
    `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
  const kodetyBrandSvg = `<svg aria-hidden="true" viewBox="0 0 114 122" fill="none"><path d="M51.1932 122L0 61L113.183 94.8289V122H51.1932Z" fill="currentColor"/><path d="M51.1932 0L0 61L113.183 27.1711V0H51.1932Z" fill="currentColor"/></svg>`;
  const icons = {
    dashboard: svg(
      '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    ),
    posts: svg(
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    ),
    media: svg(
      '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    ),
    pages: svg(
      '<path d="M8 2h8l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M16 2v5h5M3 6v14a2 2 0 0 0 2 2h11"/>',
    ),
    comments: svg('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>'),
    kodety: kodetyBrandSvg,
    appearance: svg(
      '<path d="M12 22a10 10 0 1 1 10-10c0 2-1 3-3 3h-2.2a1.8 1.8 0 0 0-1.5 2.8l.2.3c.8 1.3-.1 3-1.6 3.5-.6.2-1.2.4-1.9.4Z"/><circle cx="7.5" cy="10.5" r=".8" fill="currentColor"/><circle cx="10" cy="6.5" r=".8" fill="currentColor"/><circle cx="15" cy="7" r=".8" fill="currentColor"/>',
    ),
    plugins: svg('<path d="M8.5 3v4M15.5 3v4M6 7h12v3a6 6 0 0 1-6 6v0a6 6 0 0 1-6-6V7ZM12 16v5"/>'),
    users: svg(
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    ),
    tools: svg(
      '<path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L20 16.4a2.1 2.1 0 0 1-3 3l-7.7-7.7"/>',
    ),
    settings: svg(
      '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    ),
    home: svg('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>'),
    refresh: svg(
      '<path d="M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6.8 6.4L4 11M5.5 15A7 7 0 0 0 17.2 17.6L20 13"/>',
    ),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5"/>'),
    generic: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>'),
  };

  const menuIcons = {
    'menu-dashboard': 'dashboard',
    'menu-posts': 'posts',
    'menu-media': 'media',
    'menu-pages': 'pages',
    'menu-comments': 'comments',
    toplevel_page_kodety: 'kodety',
    'menu-appearance': 'appearance',
    'menu-plugins': 'plugins',
    'menu-users': 'users',
    'menu-tools': 'tools',
    'menu-settings': 'settings',
  };

  const menuWrap = document.querySelector('#adminmenuwrap');
  if (menuWrap && !menuWrap.querySelector('.kodety-admin-brand')) {
    const brand = document.createElement('a');
    brand.className = 'kodety-admin-brand';
    brand.href =
      adminConfig.adminUrl ||
      (window.ajaxurl ? window.ajaxurl.replace('admin-ajax.php', '') : '/wp-admin/');
    brand.innerHTML = `<span class="kodety-brand-mark">${icons.kodety}</span><span class="kodety-os-brand-copy"><span class="kodety-brand-name">Onun Kodety</span><span class="kodety-os-brand-descriptor">WordPress OS</span></span>`;
    menuWrap.prepend(brand);
  }

  document.querySelectorAll('#adminmenu > li.menu-top').forEach((item) => {
    const target = item.querySelector(':scope > a .wp-menu-image');
    const name = menuIcons[item.id];
    if (!target || !name) return;
    target.classList.add('kodety-menu-icon');
    target.innerHTML = icons[name];
  });

  const wpLogo = document.querySelector('#wp-admin-bar-wp-logo > .ab-item');
  if (wpLogo) {
    wpLogo.classList.add('kodety-toolbar-logo');
    wpLogo.innerHTML = icons.kodety;
    wpLogo.setAttribute('aria-label', 'Onun Kodety');
  }

  const toolbarIcons = {
    '#wp-admin-bar-site-name .ab-icon': 'home',
    '#wp-admin-bar-updates .ab-icon': 'refresh',
    '#wp-admin-bar-comments .ab-icon': 'comments',
    '#wp-admin-bar-new-content .ab-icon': 'plus',
    '#wp-admin-bar-search .ab-icon': 'search',
  };
  Object.entries(toolbarIcons).forEach(([selector, icon]) => {
    const target = document.querySelector(selector);
    if (!target) return;
    target.classList.add('kodety-toolbar-icon');
    target.innerHTML = icons[icon];
  });

  if (document.body.classList.contains('update-core-php')) {
    const wrap = document.querySelector('#wpbody-content > .wrap');
    const coreStart = wrap?.querySelector(':scope > .wp-current-version');
    const coreEnd = wrap?.querySelector(':scope > .core-updates');
    if (wrap && coreStart && coreEnd && !wrap.querySelector('.kodety-update-grid')) {
      const grid = document.createElement('div');
      grid.className = 'kodety-update-grid';
      wrap.insertBefore(grid, coreStart);
      const moveRange = (start, end, featured = false) => {
        const card = document.createElement('section');
        card.className = `kodety-update-card${featured ? ' is-featured' : ''}`;
        let current = start;
        while (current) {
          const next = current.nextElementSibling;
          card.appendChild(current);
          if (current === end) break;
          current = next;
        }
        grid.appendChild(card);
      };
      moveRange(coreStart, coreEnd, true);
      let heading = wrap.querySelector(':scope > h2');
      while (heading) {
        let end = heading;
        while (end.nextElementSibling && end.nextElementSibling.tagName !== 'H2')
          end = end.nextElementSibling;
        moveRange(heading, end);
        heading = wrap.querySelector(':scope > h2');
      }
    }
  }

  if (
    document.body.classList.contains('edit-php') &&
    new URLSearchParams(window.location.search).get('post_type') === 'page'
  ) {
    const addPage = document.querySelector('.wrap .page-title-action');
    if (addPage && !document.querySelector('.kodety-open-editor')) {
      const editorLink = document.createElement('a');
      editorLink.className = 'page-title-action kodety-open-editor';
      editorLink.href = adminConfig.editorUrl || '/kodety/editor/';
      editorLink.textContent = 'Abrir no editor';
      addPage.insertAdjacentElement('afterend', editorLink);
    }
  }

  if (document.body.classList.contains('themes-php')) {
    const config = window.kodetyThemeAdmin;
    const addTheme = document.querySelector('.wrap .page-title-action');
    if (config && addTheme && !document.querySelector('.kodety-delete-themes')) {
      const remove = document.createElement('a');
      remove.className = `page-title-action kodety-delete-themes${config.unusedCount ? '' : ' is-disabled'}`;
      remove.href = config.unusedCount ? config.deleteUrl : '#';
      remove.innerHTML = `${icons.trash}<span>Remover ${config.unusedCount} inativo${config.unusedCount === 1 ? '' : 's'}</span>`;
      if (config.unusedCount)
        remove.addEventListener('click', (event) => {
          if (
            !window.confirm(
              `Remover permanentemente ${config.unusedCount} ${config.unusedCount === 1 ? 'tema inativo' : 'temas inativos'}? O tema ativo será preservado.`,
            )
          )
            event.preventDefault();
        });
      else remove.addEventListener('click', (event) => event.preventDefault());
      addTheme.insertAdjacentElement('afterend', remove);
    }
    const mountActiveThemeCover = () => {
      const screenshot = document.querySelector('.theme.active .theme-screenshot');
      const image = screenshot?.querySelector('img');
      const isBlank =
        screenshot?.classList.contains('blank') || !image || !image.getAttribute('src');
      if (!screenshot || !isBlank || screenshot.querySelector('.kodety-theme-cover')) return false;
      const cover = document.createElement('div');
      cover.className = 'kodety-theme-cover';
      cover.innerHTML = `${icons.kodety}<span>Tema Onun Kodety</span><small>Gerenciado pelo editor visual</small>`;
      screenshot.appendChild(cover);
      return true;
    };
    mountActiveThemeCover();
    const themeObserver = new MutationObserver(mountActiveThemeCover);
    themeObserver.observe(document.querySelector('.theme-browser') || document.body, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('pagehide', () => themeObserver.disconnect(), { once: true });
  }

  document.documentElement.classList.add('kodety-admin-ready');
})();
