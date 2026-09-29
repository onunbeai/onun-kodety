(() => {
  'use strict';

  const GLOBAL_KEY = 'kodetyOsShell';
  const config = window.kodetyAdmin || {};
  const body = document.body;

  if (!body) return;

  if (window[GLOBAL_KEY]?.destroy) window[GLOBAL_KEY].destroy();

  const controller = new AbortController();
  const { signal } = controller;
  let mountController = null;
  let menuObserver = null;
  let bodyObserver = null;
  let mounted = false;
  let syncQueued = false;
  let menuWrap = null;
  let menu = null;
  let sidebarHeader = null;
  let sidebarFooter = null;
  let searchInput = null;
  let searchStatus = null;
  let createdBrand = null;
  let adoptedBrand = null;
  let adoptedBrandOrigin = null;
  let pageContext = null;
  let pageHeading = null;
  let pageDescription = null;
  let pageActions = [];
  let pageDescriptionCreated = false;
  let listSearchBox = null;
  const pageOrigins = new Map();

  const originalVisibility = new WeakMap();

  const svg = (paths, className = '') => {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    if (className) icon.setAttribute('class', className);

    paths.forEach(([name, attributes]) => {
      const node = document.createElementNS(namespace, name);
      Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
      icon.appendChild(node);
    });

    return icon;
  };

  const kodetyBrandIcon = () => {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 114 122');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    [
      'M51.1932 122L0 61L113.183 94.8289V122H51.1932Z',
      'M51.1932 0L0 61L113.183 27.1711V0H51.1932Z',
    ].forEach((pathData) => {
      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'currentColor');
      icon.appendChild(path);
    });
    return icon;
  };

  const icons = {
    kodety: kodetyBrandIcon,
    search: () =>
      svg([
        ['circle', { cx: '11', cy: '11', r: '7' }],
        ['path', { d: 'm20 20-4.2-4.2' }],
      ]),
    external: () =>
      svg([
        ['path', { d: 'M14 3h7v7' }],
        ['path', { d: 'm10 14 11-11' }],
        ['path', { d: 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5' }],
      ]),
    user: () =>
      svg([
        ['circle', { cx: '12', cy: '8', r: '4' }],
        ['path', { d: 'M4 21a8 8 0 0 1 16 0' }],
      ]),
    collapse: () =>
      svg([
        ['path', { d: 'm15 18-6-6 6-6' }],
        ['path', { d: 'M21 12H9' }],
      ]),
    breadcrumb: () =>
      svg([
        ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '4' }],
        ['path', { d: 'M8 12h8' }],
        ['path', { d: 'm13 9 3 3-3 3' }],
      ]),
  };

  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR');

  const textWithoutBadges = (root) => {
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll('.awaiting-mod, .update-plugins, .plugin-count, .screen-reader-text')
      .forEach((node) => node.remove());
    return clone.textContent?.replace(/\s+/g, ' ').trim() || '';
  };

  const rememberVisibility = (node) => {
    if (originalVisibility.has(node)) return;
    originalVisibility.set(node, {
      hidden: node.hidden,
      ariaHidden: node.getAttribute('aria-hidden'),
    });
  };

  const hideForFilter = (node) => {
    rememberVisibility(node);
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    node.dataset.kodetyOsFiltered = 'true';
  };

  const restoreFilterVisibility = (node) => {
    if (!node.dataset.kodetyOsFiltered) return;
    const original = originalVisibility.get(node);
    node.hidden = original?.hidden || false;
    if (original?.ariaHidden === null || original?.ariaHidden === undefined) {
      node.removeAttribute('aria-hidden');
    } else {
      node.setAttribute('aria-hidden', original.ariaHidden);
    }
    delete node.dataset.kodetyOsFiltered;
  };

  const isBlockEditor = () =>
    body.classList.contains('block-editor-page') || config.screen?.profile === 'block-editor';

  const isBlockEditorFullscreen = () =>
    isBlockEditor() &&
    (body.classList.contains('is-fullscreen-mode') ||
      document.documentElement.classList.contains('is-fullscreen-mode') ||
      Boolean(
        document.querySelector(
          '.interface-interface-skeleton.is-fullscreen-mode, .edit-post-layout.is-fullscreen-mode',
        ),
      ));

  const directMenuItems = () =>
    menu
      ? Array.from(menu.children).filter((item) =>
          item.matches('li.menu-top:not(.kodety-os-menu-group-label)'),
        )
      : [];

  const groupForItem = (item, currentGroup) => {
    const id = item.id;

    if (id === 'menu-dashboard') return 'workspace';
    if (
      id === 'menu-posts' ||
      id === 'menu-media' ||
      id === 'menu-pages' ||
      id === 'menu-comments' ||
      id.startsWith('menu-posts-')
    ) {
      return 'content';
    }
    if (id === 'toplevel_page_kodety' || id === 'menu-appearance') {
      return 'build';
    }
    if (
      id === 'menu-plugins' ||
      id === 'menu-users' ||
      id === 'menu-tools' ||
      id === 'menu-settings'
    ) {
      return 'system';
    }

    return currentGroup;
  };

  const groupLabels = {
    workspace: 'Workspace',
    content: 'Conteúdo',
    build: 'Construção',
    system: 'Sistema',
  };

  const buildMenuGroups = () => {
    if (!menu) return;

    menuObserver?.disconnect();
    menu.querySelectorAll(':scope > .kodety-os-menu-group-label').forEach((label) => label.remove());

    let currentGroup = 'workspace';
    const firstByGroup = new Map();

    menu.querySelectorAll(':scope > li.wp-menu-separator').forEach((separator) => {
      separator.classList.add('kodety-os-menu-separator');
    });

    directMenuItems().forEach((item) => {
      currentGroup = groupForItem(item, currentGroup);
      item.dataset.kodetyOsGroup = currentGroup;
      if (!firstByGroup.has(currentGroup)) firstByGroup.set(currentGroup, item);
    });

    Object.entries(groupLabels).forEach(([group, labelText]) => {
      const firstItem = firstByGroup.get(group);
      if (!firstItem) return;

      const label = document.createElement('li');
      label.className = 'kodety-os-menu-group-label';
      label.dataset.kodetyOsGroupLabel = group;
      label.setAttribute('role', 'separator');
      label.setAttribute('aria-label', labelText);

      const text = document.createElement('span');
      text.setAttribute('aria-hidden', 'true');
      text.textContent = labelText;
      label.appendChild(text);
      menu.insertBefore(label, firstItem);
    });

    menuObserver?.observe(menu, { childList: true });
    applyMenuFilter(searchInput?.value || '');
  };

  const updateGroupLabelVisibility = (hasQuery) => {
    if (!menu) return;

    menu.querySelectorAll(':scope > .kodety-os-menu-group-label').forEach((label) => {
      const group = label.dataset.kodetyOsGroupLabel;
      const hasVisibleItem = directMenuItems().some(
        (item) =>
          item.dataset.kodetyOsGroup === group && !item.hidden && !item.dataset.kodetyOsFiltered,
      );
      label.hidden = hasQuery && !hasVisibleItem;
    });
  };

  function applyMenuFilter(rawQuery) {
    if (!menu) return;

    const query = normalize(rawQuery);
    const items = directMenuItems();
    let visibleCount = 0;

    items.forEach((item) => {
      const menuName = textWithoutBadges(item.querySelector(':scope > a .wp-menu-name'));
      const submenuNames = Array.from(item.querySelectorAll(':scope > .wp-submenu a'))
        .map((link) => link.textContent || '')
        .join(' ');
      const matches = !query || normalize(`${menuName} ${submenuNames}`).includes(query);

      item.classList.toggle('kodety-os-menu-match', Boolean(query && matches));
      if (matches) {
        restoreFilterVisibility(item);
        if (!item.hidden) visibleCount += 1;
      } else {
        hideForFilter(item);
      }
    });

    menu.querySelectorAll(':scope > li.wp-menu-separator').forEach((separator) => {
      if (query) hideForFilter(separator);
      else restoreFilterVisibility(separator);
    });

    updateGroupLabelVisibility(Boolean(query));

    if (searchStatus) {
      searchStatus.textContent = query
        ? `${visibleCount} ${visibleCount === 1 ? 'seção encontrada' : 'seções encontradas'}`
        : '';
    }
  }

  const makeBrand = () => {
    const link = document.createElement('a');
    link.className = 'kodety-admin-brand kodety-os-brand';
    link.href = config.adminUrl || window.ajaxurl?.replace('admin-ajax.php', '') || '/wp-admin/';
    link.setAttribute('aria-label', 'Onun Kodety — painel principal');

    const mark = document.createElement('span');
    mark.className = 'kodety-brand-mark kodety-os-brand-mark';
    mark.appendChild(icons.kodety());

    const copy = document.createElement('span');
    copy.className = 'kodety-os-brand-copy';

    const name = document.createElement('span');
    name.className = 'kodety-brand-name kodety-os-brand-name';
    name.textContent = 'Onun Kodety';

    const descriptor = document.createElement('span');
    descriptor.className = 'kodety-os-brand-descriptor';
    descriptor.textContent = 'WordPress OS';

    copy.append(name, descriptor);
    link.append(mark, copy);
    return link;
  };

  const mountSidebarHeader = () => {
    menuWrap = document.querySelector('#adminmenuwrap');
    menu = document.querySelector('#adminmenu');
    if (!menuWrap || !menu) return;

    sidebarHeader = menuWrap.querySelector(':scope > .kodety-os-sidebar-header');
    if (!sidebarHeader) {
      sidebarHeader = document.createElement('header');
      sidebarHeader.className = 'kodety-os-sidebar-header';
      menuWrap.insertBefore(sidebarHeader, menuWrap.firstChild);
    }

    const existingBrand = Array.from(menuWrap.querySelectorAll('.kodety-admin-brand')).find(
      (brand) => !sidebarHeader.contains(brand),
    );
    if (existingBrand) {
      adoptedBrand = existingBrand;
      adoptedBrandOrigin = {
        parent: existingBrand.parentNode,
        next: existingBrand.nextSibling,
      };
      existingBrand.classList.add('kodety-os-brand');
      sidebarHeader.appendChild(existingBrand);
    } else {
      const brandInHeader = sidebarHeader.querySelector('.kodety-os-brand');
      if (!brandInHeader) {
        createdBrand = makeBrand();
        sidebarHeader.appendChild(createdBrand);
      }
    }

    if (!sidebarHeader.querySelector('.kodety-os-menu-search')) {
      const search = document.createElement('div');
      search.className = 'kodety-os-menu-search';
      search.setAttribute('role', 'search');

      const label = document.createElement('label');
      label.className = 'screen-reader-text';
      label.htmlFor = 'kodety-os-menu-search-input';
      label.textContent = 'Buscar uma seção no painel';

      const icon = document.createElement('span');
      icon.className = 'kodety-os-menu-search-icon';
      icon.appendChild(icons.search());

      searchInput = document.createElement('input');
      searchInput.id = 'kodety-os-menu-search-input';
      searchInput.className = 'kodety-os-menu-search-input';
      searchInput.type = 'search';
      searchInput.autocomplete = 'off';
      searchInput.spellcheck = false;
      searchInput.placeholder = 'Buscar no painel';
      searchInput.setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
      searchInput.setAttribute('aria-describedby', 'kodety-os-menu-search-status');

      const key = document.createElement('kbd');
      key.className = 'kodety-os-menu-search-key';
      key.setAttribute('aria-hidden', 'true');
      key.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

      searchStatus = document.createElement('span');
      searchStatus.id = 'kodety-os-menu-search-status';
      searchStatus.className = 'screen-reader-text';
      searchStatus.setAttribute('role', 'status');
      searchStatus.setAttribute('aria-live', 'polite');

      search.append(label, icon, searchInput, key, searchStatus);
      sidebarHeader.appendChild(search);

      searchInput.addEventListener('input', () => applyMenuFilter(searchInput.value), {
        signal: mountController.signal,
      });
      searchInput.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          if (searchInput.value) {
            searchInput.value = '';
            applyMenuFilter('');
          } else {
            searchInput.blur();
          }
        },
        { signal: mountController.signal },
      );
    } else {
      searchInput = sidebarHeader.querySelector('.kodety-os-menu-search-input');
      searchStatus = sidebarHeader.querySelector('#kodety-os-menu-search-status');
    }

    buildMenuGroups();

    menuObserver = new MutationObserver(() => {
      if (syncQueued) return;
      syncQueued = true;
      window.requestAnimationFrame(() => {
        syncQueued = false;
        if (mounted) buildMenuGroups();
      });
    });
    menuObserver.observe(menu, { childList: true });
  };

  const firstUsableHref = (selectors, fallback = '') => {
    for (const selector of selectors) {
      const href = document.querySelector(selector)?.getAttribute('href');
      if (href && href !== '#') return href;
    }
    return fallback;
  };

  const utilityLink = (label, href, iconFactory, external = false) => {
    const link = document.createElement('a');
    link.className = 'kodety-os-utility';
    link.href = href;
    if (external) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    link.appendChild(iconFactory());
    const text = document.createElement('span');
    text.textContent = label;
    link.appendChild(text);
    return link;
  };

  const mountSidebarFooter = () => {
    if (!menuWrap) return;
    if (menuWrap.querySelector(':scope > .kodety-os-sidebar-footer')) return;

    sidebarFooter = document.createElement('nav');
    sidebarFooter.className = 'kodety-os-sidebar-footer';
    sidebarFooter.setAttribute('aria-label', 'Atalhos do Onun Kodety');

    const siteUrl = firstUsableHref(
      ['#wp-admin-bar-site-name > .ab-item', '#wp-admin-bar-view-site > .ab-item'],
      config.homeUrl || '/',
    );
    sidebarFooter.appendChild(utilityLink('Ver site', siteUrl, icons.external, true));

    const profileUrl = firstUsableHref([
      '#wp-admin-bar-user-info > .ab-item',
      '#wp-admin-bar-edit-profile > .ab-item',
    ]);
    if (profileUrl) {
      sidebarFooter.appendChild(utilityLink('Minha conta', profileUrl, icons.user));
    }

    const nativeCollapse = document.querySelector('#collapse-button');
    if (nativeCollapse) {
      const collapse = document.createElement('button');
      collapse.className = 'kodety-os-utility kodety-os-collapse';
      collapse.type = 'button';
      collapse.setAttribute('aria-controls', 'adminmenu');
      collapse.setAttribute('aria-expanded', String(!body.classList.contains('folded')));
      collapse.appendChild(icons.collapse());
      const text = document.createElement('span');
      text.textContent = 'Recolher menu';
      collapse.appendChild(text);
      collapse.addEventListener(
        'click',
        () => {
          nativeCollapse.click();
          window.requestAnimationFrame(() => {
            const expanded = !body.classList.contains('folded');
            collapse.setAttribute('aria-expanded', String(expanded));
            text.textContent = expanded ? 'Recolher menu' : 'Expandir menu';
          });
        },
        { signal: mountController.signal },
      );
      sidebarFooter.appendChild(collapse);
    }

    menuWrap.appendChild(sidebarFooter);
  };

  const currentSectionName = () => {
    const selected = document.querySelector(
      '#adminmenu > li.current > a .wp-menu-name, #adminmenu > li.wp-has-current-submenu > a .wp-menu-name',
    );
    const section = textWithoutBadges(selected);
    if (section) return section;

    const profileNames = {
      list: 'Conteúdo',
      library: 'Mídia',
      gallery: 'Biblioteca',
      form: 'Edição',
      settings: 'Sistema',
      default: 'Workspace',
    };
    return profileNames[config.screen?.profile] || 'Workspace';
  };

  const screenDescription = () => {
    const id = String(config.screen?.id || '');
    const base = String(config.screen?.base || '');
    const descriptions = {
      'edit-page': 'Páginas codadas, conteúdo e estado de publicação.',
      edit: 'Conteúdo editorial, organização e publicação.',
      'edit-comments': 'Modere conversas, respostas e feedback do site.',
      upload: 'Assets do projeto e arquivos disponíveis para o site.',
      media: 'Envie um novo asset para a biblioteca do projeto.',
      plugins: 'Extensões, integrações e recursos ativos no projeto.',
      'plugin-install': 'Descubra e adicione novas integrações ao projeto.',
      themes: 'Tema Onun Kodety e biblioteca visual instalada.',
      'theme-install': 'Descubra e instale novas bases visuais.',
      users: 'Acessos, perfis e permissões do workspace.',
      'options-general': 'Identidade, endereço e comportamento geral do site.',
      'update-core': 'Versões, traduções e atualizações do sistema.',
      'site-health': 'Diagnóstico técnico e integridade do ambiente.',
    };

    if (descriptions[id]) return descriptions[id];
    if (descriptions[base]) return descriptions[base];

    const profileDescriptions = {
      list: 'Gerencie registros, estados e ações desta área.',
      library: 'Organize e reutilize os arquivos do projeto.',
      gallery: 'Gerencie a biblioteca visual e suas integrações.',
      form: 'Edite os dados e configurações deste registro.',
      settings: 'Configure o comportamento e a infraestrutura do site.',
      default: 'Ferramentas nativas do WordPress, organizadas pelo Onun Kodety.',
    };
    return profileDescriptions[config.screen?.profile] || profileDescriptions.default;
  };

  const rememberPageOrigin = (node) => {
    if (!node?.parentNode || pageOrigins.has(node)) return;
    const marker = document.createComment('kodety-os-origin');
    node.parentNode.insertBefore(marker, node);
    pageOrigins.set(node, marker);
  };

  const mountPageContext = () => {
    if (
      isBlockEditor() ||
      body.classList.contains('index-php') ||
      config.screen?.profile === 'dashboard' ||
      config.screen?.profile === 'fullscreen'
    ) {
      return;
    }

    const wrap = document.querySelector('#wpbody-content > .wrap');
    if (!wrap || wrap.querySelector(':scope > .kodety-os-page-header')) return;

    pageHeading = wrap.querySelector(':scope > h1, :scope > .wp-heading-inline');
    if (!pageHeading || pageHeading.closest('[data-kodety-react-root]')) return;

    pageHeading.classList.add('kodety-os-page-title');
    if (!pageHeading.id) {
      const screenId = normalize(config.screen?.id || 'page').replace(/[^a-z0-9]+/g, '-');
      pageHeading.id = `kodety-os-page-title-${screenId || 'page'}`;
      pageHeading.dataset.kodetyOsGeneratedId = 'true';
    }

    const actions = [];
    let sibling = pageHeading.nextElementSibling;
    while (sibling?.matches('.page-title-action, .add-new-h2')) {
      actions.push(sibling);
      sibling = sibling.nextElementSibling;
    }

    if (sibling?.matches('p:not(.search-box), .subtitle')) {
      pageDescription = sibling;
    }

    pageContext = document.createElement('header');
    pageContext.className = 'kodety-os-page-header';
    pageContext.setAttribute('aria-labelledby', pageHeading.id);

    const copy = document.createElement('div');
    copy.className = 'kodety-os-page-header__copy';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'kodety-os-page-header__eyebrow';
    eyebrow.appendChild(icons.breadcrumb());

    const product = document.createElement('span');
    product.className = 'kodety-os-page-product';
    product.textContent = 'Onun Kodety';

    const separator = document.createElement('span');
    separator.className = 'kodety-os-page-separator';
    separator.textContent = '/';

    const section = document.createElement('span');
    section.className = 'kodety-os-page-section';
    section.textContent = currentSectionName();

    eyebrow.append(product, separator, section);
    wrap.insertBefore(pageContext, pageHeading);
    wrap.classList.add('kodety-os-page');

    rememberPageOrigin(pageHeading);
    copy.append(eyebrow, pageHeading);

    if (!pageDescription) {
      pageDescription = document.createElement('p');
      pageDescription.textContent = screenDescription();
      pageDescriptionCreated = true;
    } else {
      rememberPageOrigin(pageDescription);
    }
    pageDescription.classList.add('kodety-os-page-description', 'kodety-os-page-header__description');
    copy.appendChild(pageDescription);
    pageContext.appendChild(copy);

    if (actions.length) {
      const actionArea = document.createElement('div');
      actionArea.className = 'kodety-os-page-header__actions';
      actions.forEach((action) => {
        rememberPageOrigin(action);
        action.classList.add('kodety-os-page-action');
        pageActions.push(action);
        actionArea.appendChild(action);
      });
      pageContext.appendChild(actionArea);
    }
  };

  const mountListToolbar = () => {
    if (config.screen?.profile !== 'list') return;

    const topNav = document.querySelector('.tablenav.top');
    listSearchBox = document.querySelector('.search-box');
    if (!topNav || !listSearchBox || topNav.contains(listSearchBox)) return;

    rememberPageOrigin(listSearchBox);
    listSearchBox.classList.add('kodety-os-toolbar-search');
    const pages = topNav.querySelector('.tablenav-pages');
    topNav.insertBefore(listSearchBox, pages || null);
  };

  const restoreMenu = () => {
    if (!menu) return;
    menuObserver?.disconnect();
    menuObserver = null;

    menu.querySelectorAll(':scope > .kodety-os-menu-group-label').forEach((label) => label.remove());
    menu.querySelectorAll(':scope > li').forEach((item) => {
      restoreFilterVisibility(item);
      item.classList.remove('kodety-os-menu-match', 'kodety-os-menu-separator');
      delete item.dataset.kodetyOsGroup;
    });
  };

  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    mountController?.abort();
    mountController = null;
    restoreMenu();

    sidebarFooter?.remove();
    sidebarFooter = null;

    if (adoptedBrand && adoptedBrandOrigin?.parent?.isConnected) {
      adoptedBrand.classList.remove('kodety-os-brand');
      adoptedBrandOrigin.parent.insertBefore(
        adoptedBrand,
        adoptedBrandOrigin.next?.isConnected ? adoptedBrandOrigin.next : null,
      );
    }
    adoptedBrand = null;
    adoptedBrandOrigin = null;
    createdBrand?.remove();
    createdBrand = null;
    sidebarHeader?.remove();
    sidebarHeader = null;
    searchInput = null;
    searchStatus = null;

    pageOrigins.forEach((marker, node) => {
      if (marker.parentNode) marker.parentNode.insertBefore(node, marker);
      marker.remove();
    });
    pageOrigins.clear();
    if (pageDescriptionCreated) pageDescription?.remove();
    pageDescriptionCreated = false;
    pageContext?.remove();
    pageContext = null;
    if (pageHeading) {
      pageHeading.classList.remove('kodety-os-page-title');
      if (pageHeading.dataset.kodetyOsGeneratedId) {
        pageHeading.removeAttribute('id');
        delete pageHeading.dataset.kodetyOsGeneratedId;
      }
      pageHeading.closest('.wrap')?.classList.remove('kodety-os-page');
    }
    pageHeading = null;
    pageDescription?.classList.remove(
      'kodety-os-page-description',
      'kodety-os-page-header__description',
    );
    pageDescription = null;
    pageActions.forEach((action) => action.classList.remove('kodety-os-page-action'));
    pageActions = [];
    listSearchBox?.classList.remove('kodety-os-toolbar-search');
    listSearchBox = null;
  };

  const mount = () => {
    if (mounted || isBlockEditorFullscreen()) return;
    mounted = true;
    mountController = new AbortController();
    mountSidebarHeader();
    mountSidebarFooter();
    mountPageContext();
    mountListToolbar();
  };

  const reconcile = () => {
    if (isBlockEditorFullscreen()) unmount();
    else mount();
  };

  const focusMenuSearch = () => {
    if (isBlockEditorFullscreen()) return;
    if (!mounted) mount();
    if (!searchInput) return;
    searchInput.focus({ preventScroll: true });
    searchInput.select();
  };

  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.key.toLocaleLowerCase() !== 'k' ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      focusMenuSearch();
    },
    { signal },
  );

  bodyObserver = new MutationObserver(reconcile);
  bodyObserver.observe(body, { attributes: true, attributeFilter: ['class'] });

  const destroy = () => {
    unmount();
    bodyObserver?.disconnect();
    bodyObserver = null;
    controller.abort();
    if (window[GLOBAL_KEY]?.destroy === destroy) delete window[GLOBAL_KEY];
  };

  window.addEventListener('pagehide', destroy, { once: true, signal });
  window[GLOBAL_KEY] = {
    destroy,
    refresh: () => {
      reconcile();
      if (mounted) buildMenuGroups();
    },
    focusSearch: focusMenuSearch,
  };

  reconcile();
})();
