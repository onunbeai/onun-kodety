/* global AbortController, document, Element, localStorage, navigator, Node, URL, URLSearchParams, window */

import { mountNavigationLoading } from './navigation-loading.js';
import { mountNativeSelects } from './native-select.js';

(() => {
  'use strict';

  const body = document.body;
  const config = window.kodetyAdmin || {};
  const englishUi = String(config.uiLocale || '').toLowerCase().startsWith('en');
  const uiText = (portuguese, english) => (englishUi ? english : portuguese);
  const isAgencyWorkspace = config.workspaceMode === 'agency';
  const nativeMenu = document.querySelector('#adminmenu');
  const wpWrap = document.querySelector('#wpwrap');
  const globalKey = 'kodetyComponentShell';

  if (!body || body.classList.contains('block-editor-page')) return;

  // Unknown screens keep the native workflow when there is no mount target.
  if (!nativeMenu || !wpWrap) {
    body.classList.add('kodety-ui-admin-ready');
    return;
  }

  window[globalKey]?.destroy?.();

  const controller = new AbortController();
  const { signal } = controller;
  const movedNodes = new Map();
  const createdNodes = [];
  const enhancedNodes = new Set();
  const originalPlaceholders = new Map();
  const mobileQuery = window.matchMedia('(max-width: 782px)');
  const workspaceQuery = window.matchMedia('(max-width: 1100px)');
  let sidebar = null;
  let topbar = null;
  let searchInput = null;
  let searchStatus = null;
  let collapseButton = null;
  let collapseLabel = null;
  let mobileMenuButton = null;
  let createButton = null;
  let createMenu = null;
  let workspaceControl = null;
  let workspaceButton = null;
  let refreshContext = () => {};
  let navigationEmpty = null;
  let mobileSidebarFocusReturn = null;

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const visibleFocusable = (root) =>
    Array.from(root?.querySelectorAll(focusableSelector) || []).filter(
      (node) => !node.hidden && !node.closest('[hidden], [inert], [aria-hidden="true"]') && node.getClientRects().length,
    );

  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR');

  const translateNavigationLabel = (value) => {
    const clean = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    const translations = englishUi
      ? {
          Biblioteca: 'Library',
          'Adicionar mídia': 'Add Media',
          'Adicionar arquivo de mídia': 'Add Media',
          'Adicionar novo arquivo de mídia': 'Add Media',
          'Novo arquivo de mídia': 'Add Media',
          Painel: 'Dashboard',
          Mídia: 'Media',
          Mídias: 'Media',
          Páginas: 'Pages',
          Comentários: 'Comments',
          Aparência: 'Appearance',
          Usuários: 'Users',
          Ferramentas: 'Tools',
          Configurações: 'Settings',
          Importar: 'Import',
          Exportar: 'Export',
        }
      : {
          Library: 'Biblioteca',
          'Add New Media File': 'Adicionar mídia',
          'Adicionar arquivo de mídia': 'Adicionar mídia',
          'Adicionar novo arquivo de mídia': 'Adicionar mídia',
          'Novo arquivo de mídia': 'Adicionar mídia',
          Dashboard: 'Painel',
          Posts: 'Posts',
          Media: 'Mídia',
          Pages: 'Páginas',
          Comments: 'Comentários',
          Appearance: 'Aparência',
          Plugins: 'Plugins',
          Users: 'Usuários',
          Tools: 'Ferramentas',
          Settings: 'Configurações',
        };
    return translations[clean] || clean;
  };

  const iconNames = {
    'menu-dashboard': 'dashboard',
    'toplevel_page_kodety-manual': 'book',
    'menu-posts': 'posts',
    'menu-media': 'image',
    'toplevel_page_kodety-cms': 'database',
    'toplevel_page_kodety-analytics': 'analytics',
    'toplevel_page_kodety-media': 'image',
    'toplevel_page_kodety-members': 'users',
    'menu-pages': 'files',
    'menu-comments': 'comments',
    'toplevel_page_kodety-emails': 'mail',
    'toplevel_page_kodety-email-campaigns': 'marketing',
    toplevel_page_kodety: 'kodety',
    'menu-appearance': 'appearance',
    'menu-plugins': 'plugins',
    'menu-users': 'users',
    'menu-tools': 'tools',
    'menu-settings': 'settings',
  };

  const groups = [
    { id: 'workspace', label: '' },
    { id: 'wordpress', label: 'WordPress' },
  ];

  const kodetyModuleIds = [
    'toplevel_page_kodety-cms',
    'toplevel_page_kodety-media',
    'toplevel_page_kodety-analytics',
    'toplevel_page_kodety-members',
    'toplevel_page_kodety-emails',
    'toplevel_page_kodety-email-campaigns',
  ];

  const makeIcon = (name, className = '') => {
    const icon = document.createElement('span');
    icon.className = `kodety-ui-icon${className ? ` ${className}` : ''}`;
    icon.dataset.kodetyIcon = name;
    icon.setAttribute('aria-hidden', 'true');
    window.KodetyIcons?.mount?.(icon, name);
    return icon;
  };

  const makeKodetyLogo = () => {
    const namespace = 'http://www.w3.org/2000/svg';
    const logo = document.createElementNS(namespace, 'svg');
    logo.classList.add('kodety-ui-icon', 'kodety-ui-brand__kodety-logo');
    logo.setAttribute('viewBox', '0 0 114 122');
    logo.setAttribute('fill', 'none');
    logo.setAttribute('focusable', 'false');
    logo.setAttribute('aria-hidden', 'true');

    [
      'M51.1932 122L0 61L113.183 94.8289V122H51.1932Z',
      'M51.1932 0L0 61L113.183 27.1711V0H51.1932Z',
    ].forEach((pathData) => {
      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'currentColor');
      logo.appendChild(path);
    });

    return logo;
  };

  const hydrateIcons = () => window.KodetyIcons?.scan?.(document);

  const rememberAndMove = (node, target) => {
    if (!node || !target) return;
    if (!movedNodes.has(node)) {
      const marker = document.createComment('kodety-component-origin');
      node.parentNode?.insertBefore(marker, node);
      movedNodes.set(node, marker);
    }
    target.appendChild(node);
  };

  const menuLabel = (item) => {
    const label = item.querySelector(':scope > a .wp-menu-name')?.cloneNode(true);
    if (!label) return '';
    label
      .querySelectorAll('.awaiting-mod, .update-plugins, .plugin-count, .screen-reader-text')
      .forEach((node) => node.remove());
    if (item.id === 'menu-dashboard') return 'Dashboard';
    return translateNavigationLabel(label.textContent);
  };

  const submenuLabel = (link) => {
    const clone = link?.cloneNode(true);
    if (!clone) return '';
    clone
      .querySelectorAll(
        '.awaiting-mod, .update-plugins, .plugin-count, .count-0, .screen-reader-text',
      )
      .forEach((node) => node.remove());
    return translateNavigationLabel(clone.textContent);
  };

  const positiveCount = (item) => {
    const raw = item.querySelector(
      ':scope > a .awaiting-mod, :scope > a .update-plugins, :scope > a .plugin-count',
    )?.textContent;
    const count = Number.parseInt(String(raw || '').replace(/\D+/g, ''), 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  };

  const mountBrand = (parent) => {
    const brand = document.createElement('a');
    brand.className = 'kodety-ui-brand';
    brand.href = config.adminUrl || '/wp-admin/';
    brand.setAttribute('aria-label', uiText('Abrir visão geral do Onun Kodety', 'Open Onun Kodety overview'));

    const mark = document.createElement('span');
    mark.className = 'kodety-ui-brand__mark';
    mark.appendChild(makeKodetyLogo());
    const logo = document.createElement('img');
    logo.className = 'kodety-ui-brand__full';
    logo.alt = 'Onun Kodety';
    logo.width = 116;
    logo.height = 24;
    if (config.kodetyLogoUrl) logo.src = config.kodetyLogoUrl;
    else brand.classList.add('is-mark-only');
    logo.addEventListener('error', () => brand.classList.add('is-mark-only'), { once: true, signal });
    brand.append(logo, mark);
    parent.appendChild(brand);
  };

  const mountSearch = (parent) => {
    const search = document.createElement('div');
    search.className = 'kodety-ui-command';
    search.setAttribute('role', 'search');
    search.appendChild(makeIcon('search', 'kodety-ui-command__icon'));

    const label = document.createElement('label');
    label.className = 'screen-reader-text';
    label.htmlFor = 'kodety-ui-command-input';
    label.textContent = uiText('Buscar no painel', 'Search dashboard');

    searchInput = document.createElement('input');
    searchInput.id = 'kodety-ui-command-input';
    searchInput.type = 'search';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.placeholder = uiText('Buscar no painel', 'Search dashboard');
    searchInput.setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    searchInput.setAttribute('aria-describedby', 'kodety-ui-command-status');

    const shortcut = document.createElement('kbd');
    shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
    shortcut.setAttribute('aria-hidden', 'true');

    searchStatus = document.createElement('span');
    searchStatus.id = 'kodety-ui-command-status';
    searchStatus.className = 'screen-reader-text';
    searchStatus.setAttribute('role', 'status');
    searchStatus.setAttribute('aria-live', 'polite');

    search.append(label, searchInput, shortcut, searchStatus);
    parent.appendChild(search);
  };

  const matchesCurrentRoute = (href) => {
    try {
      const target = new URL(href, window.location.href);
      const current = new URL(window.location.href);
      if (current.searchParams.get('page') === 'kodety' && !current.hash) current.hash = '#kodety-project';
      return target.origin === current.origin &&
        target.pathname === current.pathname &&
        ['page', 'post_type', 'taxonomy'].every(key =>
          (target.searchParams.get(key) || '') === (current.searchParams.get(key) || '')
        ) && (!target.hash || target.hash.replace('#kodety-area-', '#kodety-') === current.hash.replace('#kodety-area-', '#kodety-'));
    } catch {
      return false;
    }
  };

  const activeWorkspace = () => {
    const screenId = String(config.screen?.id || '');
    const postType = String(config.screen?.postType || '');
    const page = new URLSearchParams(window.location.search).get('page') || '';
    if (page === 'kodety-editor') return 'builder';
    if (/^kodety-cms(?:-|$)/.test(page)) return 'cms';
    if (postType === 'page' || ['edit-page', 'page'].includes(screenId)) return 'pages';
    return 'operational';
  };

  const setWorkspaceMenu = (open, { focusLink = false, restoreFocus = false } = {}) => {
    if (!workspaceControl || !workspaceButton) return;
    const expanded = open && workspaceQuery.matches;
    workspaceControl.classList.toggle('is-open', expanded);
    workspaceButton.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      setCreateMenu(false);
      if (focusLink) {
        const link = workspaceControl.querySelector('[aria-current="page"]') ||
          workspaceControl.querySelector('.kodety-ui-workspace-tab');
        link?.focus({ preventScroll: true });
      }
    } else if (restoreFocus && workspaceQuery.matches) {
      workspaceButton.focus({ preventScroll: true });
    }
  };

  const mountWorkspaceTabs = (parent) => {
    workspaceControl = document.createElement('div');
    workspaceControl.className = 'kodety-ui-area-switcher';
    const nav = document.createElement('nav');
    nav.id = 'kodety-ui-workspaces';
    nav.className = 'kodety-ui-workspaces';
    nav.setAttribute('aria-label', uiText('Áreas do Onun Kodety', 'Onun Kodety areas'));
    const current = activeWorkspace();
    const dashboard = nativeMenu.querySelector('#menu-dashboard > a');
    const cms = nativeMenu.querySelector('#toplevel_page_kodety-cms > a');
    const pages = nativeMenu.querySelector('#menu-pages > a');
    const builder = Array.from(nativeMenu.querySelectorAll('#toplevel_page_kodety .wp-submenu a')).find(link =>
      /(?:[?&]page=kodety-editor(?:&|$)|\/kodety\/editor\/)/.test(link.href)
    );
    const items = [
      { id: 'operational', label: uiText('Operacional', 'Operational'), icon: 'dashboard', source: dashboard, href: dashboard?.href },
      { id: 'cms', label: 'CMS', icon: 'database', source: cms, href: config.cmsUrl || cms?.href },
      { id: 'pages', label: uiText('Páginas', 'Pages'), icon: 'files', source: pages, href: pages?.href, hiddenInAgency: true },
      { id: 'builder', label: 'Builder', icon: 'editor', source: builder, href: config.editorUrl || builder?.href },
    ];
    const available = items.filter((item) => item.source && item.href && !(isAgencyWorkspace && item.hiddenInAgency));
    const selected = available.find(item => item.id === current);
    workspaceButton = document.createElement('button');
    workspaceButton.type = 'button';
    workspaceButton.className = 'kodety-ui-area-switcher__button';
    workspaceButton.setAttribute('aria-expanded', 'false');
    workspaceButton.setAttribute('aria-controls', nav.id);
    workspaceButton.setAttribute('aria-label', uiText('Trocar área', 'Switch area') + ': ' +
      (selected?.label || uiText('Áreas do Onun Kodety', 'Onun Kodety areas')));
    const currentLabel = document.createElement('span');
    currentLabel.textContent = selected?.label || uiText('Áreas', 'Areas');
    workspaceButton.append(makeIcon(selected?.icon || 'dashboard'), currentLabel,
      makeIcon('chevron-down', 'kodety-ui-area-switcher__chevron'));

    available.forEach(item => {
      const link = document.createElement('a');
      link.className = 'kodety-ui-workspace-tab';
      link.href = item.href;
      link.dataset.workspace = item.id;
      if (item.source.target) link.target = item.source.target;
      if (item.source.rel) link.rel = item.source.rel;
      const label = document.createElement('span');
      label.textContent = item.label;
      link.append(makeIcon(item.icon), label);
      if (item.id === current) {
        link.classList.add('is-current');
        link.setAttribute('aria-current', 'page');
      }
      nav.appendChild(link);
    });
    workspaceButton.addEventListener('click', () => {
      setWorkspaceMenu(!workspaceControl.classList.contains('is-open'), { focusLink: true });
    }, { signal });
    workspaceButton.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      setWorkspaceMenu(true, { focusLink: true });
      if (event.key === 'ArrowUp') nav.lastElementChild?.focus({ preventScroll: true });
    }, { signal });
    nav.addEventListener('keydown', event => {
      const links = Array.from(nav.querySelectorAll('a'));
      const index = links.indexOf(document.activeElement);
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % links.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + links.length) % links.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = links.length - 1;
      if (next === null || !links.length) return;
      event.preventDefault();
      links[next].focus({ preventScroll: true });
    }, { signal });
    workspaceControl.addEventListener('focusout', event => {
      if (!workspaceControl.contains(event.relatedTarget)) setWorkspaceMenu(false);
    }, { signal });
    const closeWorkspaceOnResize = () => setWorkspaceMenu(false);
    workspaceQuery.addEventListener('change', closeWorkspaceOnResize, { signal });
    workspaceControl.append(workspaceButton, nav);
    parent.appendChild(workspaceControl);
  };

  const mountContext = (parent) => {
    const breadcrumb = document.createElement('nav');
    breadcrumb.className = 'kodety-ui-breadcrumb';
    breadcrumb.setAttribute('aria-label', uiText('Localização no painel', 'Dashboard location'));
    const current = nativeMenu.querySelector(':scope > li.current, :scope > li.wp-has-current-submenu');
    const project = current?.id === 'toplevel_page_kodety';
    const source = current?.querySelector(':scope > a');
    const submenu = Array.from(current?.querySelectorAll(':scope > .wp-submenu li > a') || []);
    const destination = submenu.find(link => matchesCurrentRoute(link.href)) ||
      submenu.find(link => link.parentElement.classList.contains('current'));
    const label = document.createElement('span');
    const fallbackLabel = destination && destination.href !== source?.href
      ? submenuLabel(destination)
      : project ? uiText('Meu projeto', 'My project')
      : current ? menuLabel(current) : uiText('Painel', 'Dashboard');
    refreshContext = () => {
      const areas = {
        project: uiText('Importar', 'Import'),
        extensions: uiText('Extensões', 'Extensions'),
        interface: uiText('Interface', 'Interface'),
        settings: uiText('Configurações', 'Settings'),
        optimizations: uiText('Otimizações', 'Optimizations'),
        security: uiText('Segurança', 'Security'),
        codex: 'Codex',
        mcp: 'Codex',
      };
      const area = window.location.hash.replace(/^#kodety-(?:area-)?/, '');
      label.textContent = project ? (areas[area] || areas.project) : fallbackLabel;
    };
    label.dataset.kodetyNoI18n = '';
    refreshContext();
    label.setAttribute('aria-current', 'page');
    breadcrumb.appendChild(label);
    parent.appendChild(breadcrumb);
  };

  const nativeCreateLinks = () => {
    const sources = Array.from(document.querySelectorAll('#wp-admin-bar-new-content-default > li > a'));
    const cms = nativeMenu.querySelector('#toplevel_page_kodety-cms .wp-submenu a[href*="page=kodety-cms-new-item"]');
    if (cms) sources.unshift(cms);
    const seen = new Set();
    return sources.filter(link => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    }).map(link => ({
      href: link.href, target: link.target, rel: link.rel,
      label: link === cms ? uiText('Novo item no CMS', 'New CMS item') : translateNavigationLabel(link.textContent),
    }));
  };

  const createMenuItems = () =>
    Array.from(createMenu?.querySelectorAll('[role="menuitem"]') || []).filter(
      (item) => !item.hidden && item.getAttribute('aria-disabled') !== 'true',
    );

  const focusCreateMenuItem = (position) => {
    const items = createMenuItems();
    if (!items.length) return;
    const index = position < 0 ? items.length - 1 : Math.min(position, items.length - 1);
    window.requestAnimationFrame(() => items[index]?.focus({ preventScroll: true }));
  };

  const setCreateMenu = (open, { focusPosition = null, restoreFocus = false } = {}) => {
    if (!createButton || !createMenu) return;
    if (open) setWorkspaceMenu(false);
    createMenu.hidden = !open;
    createButton.setAttribute('aria-expanded', String(open));
    if (open && focusPosition !== null) focusCreateMenuItem(focusPosition);
    if (!open && restoreFocus) createButton.focus({ preventScroll: true });
  };

  const mountCreateControl = (parent) => {
    const items = nativeCreateLinks();
    const builder = Array.from(nativeMenu.querySelectorAll('#toplevel_page_kodety .wp-submenu a')).find(link =>
      /(?:[?&]page=kodety-editor(?:&|$)|\/kodety\/editor\/)/.test(link.href)
    );
    if (!items.length && !builder) return;
    const control = document.createElement('div');
    control.className = 'kodety-ui-create';

    createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'kodety-ui-create__button';
    createButton.setAttribute('aria-label', uiText('Criar conteúdo', 'Create content'));
    createButton.setAttribute('aria-haspopup', 'menu');
    createButton.setAttribute('aria-expanded', 'false');
    createButton.setAttribute('aria-controls', 'kodety-ui-create-menu');
    createButton.append(makeIcon('plus'), document.createTextNode(uiText('Criar', 'Create')));

    createMenu = document.createElement('div');
    createMenu.id = 'kodety-ui-create-menu';
    createMenu.className = 'kodety-ui-create__menu';
    createMenu.setAttribute('role', 'menu');
    createMenu.setAttribute('aria-label', uiText('Criar conteúdo', 'Create content'));
    createMenu.hidden = true;
    items.forEach((item, index) => {
      const link = document.createElement('a');
      link.href = item.href;
      if (item.target) link.target = item.target;
      if (item.rel) link.rel = item.rel;
      link.setAttribute('role', 'menuitem');
      link.append(
        makeIcon(index === 2 ? 'image-plus' : index === 0 ? 'files' : 'posts'),
        document.createTextNode(item.label),
      );
      createMenu.appendChild(link);
    });
    if (builder) {
      const editor = document.createElement('a');
      editor.href = config.editorUrl || builder.href;
      editor.className = 'is-editor';
      editor.setAttribute('role', 'menuitem');
      if (builder.target) editor.target = builder.target;
      if (builder.rel) editor.rel = builder.rel;
      editor.append(makeIcon('sparkles'), document.createTextNode(uiText('Abrir editor Onun Kodety', 'Open Onun Kodety editor')));
      createMenu.appendChild(editor);
    }

    createButton.addEventListener('click', () => setCreateMenu(createMenu.hidden), { signal });
    createButton.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setCreateMenu(true, { focusPosition: event.key === 'ArrowUp' ? -1 : 0 });
        } else if (event.key === 'Escape' && !createMenu.hidden) {
          event.preventDefault();
          setCreateMenu(false, { restoreFocus: true });
        }
      },
      { signal },
    );
    createMenu.addEventListener(
      'keydown',
      (event) => {
        const items = createMenuItems();
        if (!items.length) return;
        const current = Math.max(0, items.indexOf(document.activeElement));
        let next = null;
        if (event.key === 'ArrowDown') next = (current + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else if (event.key === 'Escape') {
          event.preventDefault();
          setCreateMenu(false, { restoreFocus: true });
          return;
        } else if (event.key === 'Tab') {
          setCreateMenu(false);
          return;
        }
        if (next === null) return;
        event.preventDefault();
        items[next].focus({ preventScroll: true });
      },
      { signal },
    );
    control.append(createButton, createMenu);
    parent.appendChild(control);
  };

  const mountTopbar = () => {
    topbar = document.createElement('header');
    topbar.className = 'kodety-ui-topbar';

    const identity = document.createElement('div');
    identity.className = 'kodety-ui-topbar__identity';
    mountWorkspaceTabs(identity);
    mountContext(identity);

    const tools = document.createElement('div');
    tools.className = 'kodety-ui-topbar__tools';
    const nativeScreenLinks = document.querySelector('#screen-meta-links');
    if (nativeScreenLinks) {
      nativeScreenLinks.querySelectorAll('.show-settings').forEach((button) => {
        const icon = makeIcon(button.id === 'contextual-help-link' ? 'help' : 'settings');
        button.title = button.textContent.trim();
        button.prepend(icon);
        createdNodes.push(icon);
      });
      // Move the actual WordPress controls so their events, ARIA state and
      // panel IDs stay intact. Native screenMeta continues to own interaction.
      rememberAndMove(nativeScreenLinks, tools);
      nativeScreenLinks.addEventListener('click', () => {
        setWorkspaceMenu(false);
        setCreateMenu(false);
      }, { signal });
    }
    mountCreateControl(tools);

    const iconActions = document.createElement('div');
    iconActions.className = 'kodety-ui-topbar__icon-actions';

    const updates = document.createElement('a');
    updates.className = 'kodety-ui-circle-action';
    updates.href =
      document.querySelector('#wp-admin-bar-updates > a')?.href ||
      `${config.adminUrl || '/wp-admin/'}update-core.php`;
    updates.title = uiText('Atualizações e avisos', 'Updates and notices');
    updates.setAttribute('aria-label', uiText('Atualizações e avisos', 'Updates and notices'));
    updates.appendChild(makeIcon('bell'));
    const updateCount = Number.parseInt(
      document.querySelector('#wp-admin-bar-updates .ab-label')?.textContent || '0',
      10,
    );
    if (Number.isFinite(updateCount) && updateCount > 0) {
      const dot = document.createElement('span');
      dot.className = 'kodety-ui-circle-action__dot';
      dot.textContent = String(updateCount);
      updates.appendChild(dot);
    }

    const viewSite = document.createElement('a');
    viewSite.className = 'kodety-ui-circle-action';
    viewSite.href = config.homeUrl || '/';
    viewSite.target = '_blank';
    viewSite.rel = 'noopener noreferrer';
    viewSite.title = uiText('Ver site', 'View site');
    viewSite.setAttribute('aria-label', uiText('Ver site em uma nova aba', 'View site in a new tab'));
    viewSite.appendChild(makeIcon('website'));

    mobileMenuButton = document.createElement('button');
    mobileMenuButton.type = 'button';
    mobileMenuButton.className = 'kodety-ui-circle-action kodety-ui-topbar__menu';
    mobileMenuButton.setAttribute('aria-controls', 'kodety-ui-sidebar');
    mobileMenuButton.setAttribute('aria-label', uiText('Abrir navegação', 'Open navigation'));
    mobileMenuButton.setAttribute('aria-expanded', 'false');
    mobileMenuButton.appendChild(makeIcon('menu'));
    mobileMenuButton.addEventListener(
      'click',
      () => {
        setWorkspaceMenu(false);
        setCreateMenu(false);
        const open = !body.classList.contains('kodety-ui-sidebar-mobile-open');
        setMobileSidebar(open, { focusSidebar: open, restoreFocus: !open });
      },
      { signal },
    );

    iconActions.append(updates, viewSite);
    identity.prepend(mobileMenuButton);
    tools.appendChild(iconActions);
    topbar.append(identity, tools);
    wpWrap.prepend(topbar);
    createdNodes.push(topbar);
    document.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Node && !workspaceControl?.contains(event.target))
          setWorkspaceMenu(false);
        if (!createMenu || createMenu.hidden) return;
        if (event.target instanceof Node && createMenu.parentElement?.contains(event.target))
          return;
        setCreateMenu(false);
      },
      { signal },
    );
  };

  const mountNavigation = (parent) => {
    const nav = document.createElement('nav');
    nav.className = 'kodety-ui-navigation';
    nav.setAttribute('aria-label', uiText('Navegação principal', 'Main navigation'));

    const readDestination = (item) => {
      const source = item.querySelector(':scope > a');
      if (!source) return null;
      const children = Array.from(item.querySelectorAll(':scope > .wp-submenu li:not(.wp-submenu-head) > a')).map((link, index) => ({
        sourceId: `${item.id}-${index}`,
        href: link.href, target: link.target, rel: link.rel,
        label: submenuLabel(link), current: link.parentElement.classList.contains('current'),
        count: positiveCount(link.parentElement), children: [],
      })).filter(child => child.label && child.href !== source.href);
      return {
        sourceId: item.id, label: menuLabel(item), href: source.href,
        localized: item.id === 'menu-dashboard',
        target: source.target, rel: source.rel, icon: iconNames[item.id] || 'folder',
        current: item.matches('.current, .wp-has-current-submenu'), count: positiveCount(item), children,
      };
    };
    const nativeItems = Array.from(nativeMenu.children)
      .filter(item => item.matches('li.menu-top') && item.id !== 'toplevel_page_kodety-manual')
      .map(readDestination).filter(Boolean);
    const byId = new Map(nativeItems.map(item => [item.sourceId, item]));
    const project = byId.get('toplevel_page_kodety');
    const moduleLabels = ['CMS', uiText('Mídias', 'Media'), uiText('Análises', 'Analytics'), uiText('Membros', 'Members'), uiText('E-mails', 'Emails'), 'Marketing'];
    const hubChildren = kodetyModuleIds.map((id, index) => {
      const item = byId.get(id);
      return item ? { ...item, label: moduleLabels[index] } : null;
    }).filter(Boolean);
    if (project) {
      project.children.forEach(child => {
        const icon = /editor/.test(child.href) ? 'editor' : /license/.test(child.href) ? 'lock' : /updates/.test(child.href) ? 'refresh' : /settings/.test(child.href) ? 'settings' : 'files';
        hubChildren.push({ ...child, icon });
      });
      [
        ['import', 'project', uiText('Importar', 'Import'), 'upload'],
        ['extensions', 'extensions', uiText('Extensões', 'Extensions'), 'plugins'],
        ['settings', 'settings', uiText('Configurações', 'Settings'), 'settings'],
        ['optimizations', 'optimizations', uiText('Otimizações', 'Optimizations'), 'sparkles'],
        ['security', 'security', uiText('Segurança', 'Security'), 'shield'],
      ].forEach(([permission, area, label, icon]) => {
        if (permission !== 'settings' && !config.projectAreas?.[permission]) return;
        const target = new URL(project.href);
        target.hash = `kodety-${area}`;
        if (!hubChildren.some(child => child.href === target.href)) {
          hubChildren.push({ sourceId: `kodety-area-${area}`, label, href: target.href, icon, localized: true, children: [] });
        }
      });
    }
    nativeItems.filter(item => item.sourceId.startsWith('toplevel_page_kodety-') && !kodetyModuleIds.includes(item.sourceId))
      .forEach(item => hubChildren.push(item));

    const hubOrder = ['kodety-area-project', 'kodety-editor', 'kodety-cms', 'kodety-analytics', 'kodety-media', 'kodety-emails', 'kodety-email-campaigns', 'kodety-members', 'kodety-templates', 'kodety', 'kodety-area-extensions', 'kodety-area-optimizations', 'kodety-area-security', 'kodety-area-settings', 'kodety-updates', 'kodety-license'];
    const hubRank = (item) => {
      const key = item.sourceId.startsWith('kodety-area-') ? item.sourceId : new URL(item.href).searchParams.get('page');
      const rank = hubOrder.indexOf(key);
      return rank < 0 ? hubOrder.length : rank;
    };
    hubChildren.sort((a, b) => hubRank(a) - hubRank(b));
    const seenHubDestinations = new Set();
    hubChildren.splice(0, hubChildren.length, ...hubChildren.filter(item => {
      const url = new URL(item.href);
      url.hash = url.hash.replace('#kodety-area-', '#kodety-');
      if (seenHubDestinations.has(url.href)) return false;
      seenHubDestinations.add(url.href);
      return true;
    }));

    // Native menu permissions determine every available destination. Only the
    // visual hierarchy changes; the original URLs, targets and counts survive.
    const primary = [];
    if (byId.has('menu-dashboard')) primary.push(byId.get('menu-dashboard'));
    if (hubChildren.length) primary.push({ sourceId: 'kodety-hub', label: 'Onun Kodety', icon: 'kodety', persistentOpen: true, children: hubChildren });
    const wordpress = nativeItems.filter(item => item.sourceId !== 'menu-dashboard' && item.sourceId !== 'toplevel_page_kodety' && !item.sourceId.startsWith('toplevel_page_kodety-'));
    const trees = { workspace: primary, wordpress };
    const destinations = [];
    const collectDestinations = (items) => items.forEach(item => {
      if (item.href) destinations.push(item);
      collectDestinations(item.children || []);
    });
    collectDestinations([...primary, ...wordpress]);
    const selectDestination = () => {
      const exact = destinations.filter(item => matchesCurrentRoute(item.href));
      const selected = exact.find(item => new URL(item.href).hash) || exact.find(item => item.current) || exact[0] || [...destinations].reverse().find(item => item.current);
      destinations.forEach(item => { item.current = item === selected; });
    };
    selectDestination();
    const containsCurrent = item => item.current || (item.children || []).some(containsCurrent);
    const labelsFor = item => [item.label, ...(item.children || []).flatMap(labelsFor)];
    const bindings = [];

    const renderItem = (item, ancestors = []) => {
      const row = document.createElement('li');
      row.className = 'kodety-ui-nav-item';
      row.dataset.sourceId = item.sourceId;
      row.dataset.destination = String(Boolean(item.href));
      if (item.persistentOpen) row.dataset.persistentOpen = 'true';
      row.dataset.search = normalize([...ancestors, ...labelsFor(item)].join(' '));
      row.classList.toggle('is-current', Boolean(item.current));
      const children = item.children || [];
      const currentChild = children.some(containsCurrent);
      const expanded = Boolean(item.persistentOpen || (children.length && (currentChild || (item.current && item.sourceId !== 'menu-dashboard'))));
      row.classList.toggle('has-current-child', currentChild);
      row.classList.toggle('is-open', expanded);
      const head = document.createElement('div');
      head.className = 'kodety-ui-nav-item__head';
      const link = document.createElement(item.href ? 'a' : item.persistentOpen ? 'div' : 'button');
      link.className = 'kodety-ui-nav-link';
      if (item.localized) link.dataset.kodetyNoI18n = '';
      if (item.href) {
        link.href = item.href;
        if (item.target) link.target = item.target;
        if (item.rel) link.rel = item.rel;
      } else if (!item.persistentOpen) {
        link.type = 'button';
        link.classList.add('kodety-ui-nav-group');
      } else {
        link.classList.add('kodety-ui-nav-group', 'kodety-ui-nav-group--fixed');
        link.setAttribute('role', 'heading');
        link.setAttribute('aria-level', '2');
      }
      link.title = item.label;
      link.setAttribute('aria-label', item.label);
      if (item.current) link.setAttribute('aria-current', 'page');
      const name = document.createElement('span');
      name.className = 'kodety-ui-nav-link__label';
      name.textContent = item.label;
      if (item.icon) link.appendChild(makeIcon(item.icon, 'kodety-ui-nav-link__icon'));
      link.appendChild(name);
      if (item.count) {
        const badge = document.createElement('span');
        badge.className = 'kodety-ui-badge';
        badge.textContent = String(item.count);
        link.appendChild(badge);
      }
      head.appendChild(link);
      row.appendChild(head);
      if (children.length) {
        const submenu = document.createElement('ul');
        submenu.className = 'kodety-ui-submenu';
        submenu.id = `kodety-submenu-${item.sourceId}`;
        children.forEach(child => submenu.appendChild(renderItem(child, [...ancestors, item.label])));
        if (!item.persistentOpen) {
          const toggle = item.href ? document.createElement('button') : link;
          if (item.href) {
            toggle.type = 'button';
            toggle.className = 'kodety-ui-nav-toggle';
            toggle.setAttribute('aria-label', uiText(`Mostrar opções de ${item.label}`, `Show ${item.label} options`));
            head.appendChild(toggle);
          }
          toggle.setAttribute('aria-controls', submenu.id);
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.appendChild(makeIcon('chevron-down', item.href ? '' : 'kodety-ui-group-chevron'));
          toggle.addEventListener('click', () => {
            const collapsed = body.classList.contains('kodety-ui-sidebar-collapsed');
            if (collapsed) setSidebarCollapsed(false);
            const open = collapsed || !row.classList.contains('is-open');
            row.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', String(open));
          }, { signal });
        }
        row.appendChild(submenu);
      }
      bindings.push({ item, row, link });
      return row;
    };

    groups.forEach(group => {
      if (!trees[group.id].length) return;
      const section = document.createElement('section');
      section.className = 'kodety-ui-nav-section';
      section.dataset.section = group.id;
      if (group.label) {
        const title = document.createElement('h2');
        title.textContent = group.label;
        section.appendChild(title);
      }
      const list = document.createElement('ul');
      list.className = 'kodety-ui-nav-list';
      trees[group.id].forEach(item => list.appendChild(renderItem(item, group.label ? [group.label] : [])));
      section.appendChild(list);
      nav.appendChild(section);
    });
    navigationEmpty = document.createElement('p');
    navigationEmpty.className = 'kodety-ui-navigation__empty';
    navigationEmpty.textContent = uiText('Nenhuma área corresponde à busca.', 'No area matches your search.');
    navigationEmpty.hidden = true;
    nav.appendChild(navigationEmpty);
    parent.appendChild(nav);
    const syncSelection = () => {
      refreshContext();
      selectDestination();
      bindings.forEach(({ item, row, link }) => {
        row.classList.toggle('is-current', Boolean(item.current));
        if (item.current) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        if (item.persistentOpen || (item.children || []).some(containsCurrent)) {
          row.classList.add('is-open');
          row.querySelector(':scope > .kodety-ui-nav-item__head [aria-controls]')?.setAttribute('aria-expanded', 'true');
        }
      });
    };
    window.addEventListener('hashchange', syncSelection, { signal });
    window.addEventListener('kodety:project-area-change', syncSelection, { signal });
    ['click', 'keydown'].forEach(type => document.addEventListener(type, (event) => {
      if (type === 'keydown' && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      if (event.target instanceof Element && event.target.closest('[data-kodety-tab]')) syncSelection();
    }, { signal }));
  };

  const storedSidebarCollapsed = () => {
    try {
      return localStorage.getItem('kodety.sidebar.collapsed') === 'true';
    } catch {
      return false;
    }
  };

  const syncCollapseControl = () => {
    const mobile = mobileQuery.matches;
    const expanded = mobile
      ? body.classList.contains('kodety-ui-sidebar-mobile-open')
      : !body.classList.contains('kodety-ui-sidebar-collapsed');
    if (collapseButton && collapseLabel) {
      collapseButton.setAttribute('aria-expanded', String(expanded));
      collapseButton.setAttribute(
        'aria-label',
        mobile
          ? expanded
            ? uiText('Fechar navegação', 'Close navigation')
            : uiText('Abrir navegação', 'Open navigation')
          : expanded
            ? uiText('Recolher navegação', 'Collapse navigation')
            : uiText('Expandir navegação', 'Expand navigation'),
      );
      collapseLabel.textContent = mobile
        ? expanded
          ? uiText('Fechar', 'Close')
          : 'Menu'
        : expanded
          ? uiText('Recolher', 'Collapse')
          : uiText('Expandir', 'Expand');
      collapseButton
        .querySelector('[data-kodety-icon]')
        ?.setAttribute('data-kodety-icon', expanded ? 'panel-close' : 'panel-open');
    }
    if (mobileMenuButton) {
      mobileMenuButton.setAttribute('aria-expanded', String(expanded));
      mobileMenuButton.setAttribute(
        'aria-label',
        expanded
          ? uiText('Fechar navegação', 'Close navigation')
          : uiText('Abrir navegação', 'Open navigation'),
      );
      mobileMenuButton
        .querySelector('[data-kodety-icon]')
        ?.setAttribute('data-kodety-icon', expanded ? 'x' : 'menu');
    }
    hydrateIcons();
  };

  const setSidebarCollapsed = (collapsed) => {
    body.classList.toggle('kodety-ui-sidebar-collapsed', collapsed);
    syncCollapseControl();
    try {
      localStorage.setItem('kodety.sidebar.collapsed', String(collapsed));
    } catch {
      // Navigation works when private browsing denies preference storage.
    }
  };

  const focusNavigationSearch = () => {
    if (mobileQuery.matches) setMobileSidebar(true);
    else if (body.classList.contains('kodety-ui-sidebar-collapsed')) setSidebarCollapsed(false);
    window.requestAnimationFrame(() => {
      searchInput?.focus({ preventScroll: true });
      searchInput?.select();
    });
  };

  const setMobileSidebar = (open, { focusSidebar = false, restoreFocus = false } = {}) => {
    const nextOpen = Boolean(open);
    const wasOpen = body.classList.contains('kodety-ui-sidebar-mobile-open');
    if (nextOpen && !wasOpen) {
      mobileSidebarFocusReturn =
        document.activeElement instanceof Element ? document.activeElement : mobileMenuButton;
      setCreateMenu(false);
    }
    body.classList.toggle('kodety-ui-sidebar-mobile-open', nextOpen);
    if (sidebar && mobileQuery.matches) {
      sidebar.toggleAttribute('inert', !nextOpen);
      sidebar.setAttribute('aria-hidden', String(!nextOpen));
    }
    syncCollapseControl();
    if (nextOpen && focusSidebar) {
      window.requestAnimationFrame(() => {
        const target =
          sidebar?.querySelector('.kodety-ui-nav-item.is-current .kodety-ui-nav-link') ||
          visibleFocusable(sidebar)[0];
        target?.focus({ preventScroll: true });
      });
    } else if (!nextOpen) {
      const returnTarget = mobileSidebarFocusReturn;
      mobileSidebarFocusReturn = null;
      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
          else mobileMenuButton?.focus({ preventScroll: true });
        });
      }
    }
  };

  const syncSidebarMode = () => {
    if (mobileQuery.matches) {
      body.classList.remove('kodety-ui-sidebar-collapsed');
      setMobileSidebar(false);
      return;
    }
    body.classList.remove('kodety-ui-sidebar-mobile-open');
    body.classList.toggle('kodety-ui-sidebar-collapsed', storedSidebarCollapsed());
    if (sidebar) {
      sidebar.removeAttribute('inert');
      sidebar.setAttribute('aria-hidden', 'false');
    }
    syncCollapseControl();
  };

  const mountSidebarFooter = (parent) => {
    const footer = document.createElement('footer');
    footer.className = 'kodety-ui-sidebar-footer';
    const shortcuts = document.createElement('nav');
    shortcuts.className = 'kodety-ui-footer-shortcuts';
    shortcuts.setAttribute('aria-label', uiText('Ajuda', 'Help'));
    [['#toplevel_page_kodety-manual > a', uiText('Central de ajuda', 'Help center'), 'help']].forEach(([selector, label, icon]) => {
      const source = nativeMenu.querySelector(selector);
      if (!source) return;
      const link = document.createElement('a');
      link.href = source.href;
      link.title = label;
      link.setAttribute('aria-label', label);
      if (source.parentElement.matches('.current, .wp-has-current-submenu')) link.setAttribute('aria-current', 'page');
      const text = document.createElement('span');
      text.textContent = label;
      link.append(makeIcon(icon), text);
      shortcuts.appendChild(link);
    });
    footer.appendChild(shortcuts);

    const nativeAccount = document.querySelector('#wp-admin-bar-my-account > a');
    const nativeDisplayName =
      document.querySelector('#wp-admin-bar-user-info .display-name')?.textContent ||
      nativeAccount?.textContent ||
      uiText('Conta', 'Account');
    const displayName = String(nativeDisplayName)
      .replace(/^olá,?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const profileRow = document.createElement('div');
    profileRow.className = 'kodety-ui-profile-row';
    const profile = document.createElement('a');
    profile.className = 'kodety-ui-profile';
    profile.href = nativeAccount?.href || `${config.adminUrl || '/wp-admin/'}profile.php`;
    profile.setAttribute('aria-label', uiText(`Minha conta: ${displayName}`, `My account: ${displayName}`));
    profile.title = displayName;
    const avatar = document.createElement('span');
    avatar.className = 'kodety-ui-profile__avatar';
    const nativeAvatar =
      nativeAccount?.querySelector('img') || document.querySelector('#wp-admin-bar-user-info img');
    avatar.textContent = displayName.slice(0, 1).toLocaleUpperCase('pt-BR') || 'K';
    if (nativeAvatar?.src) {
      const image = document.createElement('img');
      image.src = nativeAvatar.src;
      image.alt = '';
      image.width = 32;
      image.height = 32;
      image.addEventListener('error', () => image.remove(), { once: true, signal });
      avatar.appendChild(image);
    } else {
      avatar.textContent = displayName.slice(0, 1).toLocaleUpperCase('pt-BR') || 'K';
    }
    const profileCopy = document.createElement('span');
    profileCopy.className = 'kodety-ui-profile__copy';
    const profileName = document.createElement('strong');
    profileName.textContent = displayName;
    const profileMeta = document.createElement('span');
    profileMeta.textContent = uiText('Conta WordPress', 'WordPress account');
    profileCopy.append(profileName, profileMeta);
    profile.append(avatar, profileCopy, makeIcon('chevron-right'));

    collapseButton = document.createElement('button');
    collapseButton.className = 'kodety-ui-collapse';
    collapseButton.type = 'button';
    collapseButton.setAttribute('aria-controls', 'kodety-ui-sidebar');
    collapseButton.setAttribute('aria-label', uiText('Recolher navegação', 'Collapse navigation'));
    collapseLabel = document.createElement('span');
    collapseLabel.textContent = uiText('Recolher', 'Collapse');
    collapseButton.append(makeIcon('panel-close'), collapseLabel);
    collapseButton.addEventListener(
      'click',
      () => {
        if (mobileQuery.matches) {
          const open = !body.classList.contains('kodety-ui-sidebar-mobile-open');
          setMobileSidebar(open, { focusSidebar: open, restoreFocus: !open });
          return;
        }
        setSidebarCollapsed(!body.classList.contains('kodety-ui-sidebar-collapsed'));
      },
      { signal },
    );

    // Signing out was only reachable through the native admin bar, which the
    // Onun Kodety shell hides. The nonce-bearing URL comes from PHP; the admin bar
    // link is the fallback while a cached page still carries the old config.
    const logoutHref =
      config.logoutUrl || document.querySelector('#wp-admin-bar-logout a')?.href || '';
    let logoutButton = null;
    if (logoutHref) {
      logoutButton = document.createElement('a');
      logoutButton.className = 'kodety-ui-collapse kodety-ui-logout';
      logoutButton.href = logoutHref;
      logoutButton.title = uiText('Sair', 'Log out');
      logoutButton.setAttribute('aria-label', uiText('Sair da conta', 'Log out of account'));
      const logoutLabel = document.createElement('span');
      logoutLabel.textContent = uiText('Sair', 'Log out');
      logoutButton.append(makeIcon('logout'), logoutLabel);
    }

    profileRow.append(profile, ...(logoutButton ? [logoutButton] : []), collapseButton);
    profileRow.classList.toggle('kodety-ui-profile-row--with-logout', Boolean(logoutButton));
    footer.appendChild(profileRow);
    parent.appendChild(footer);
  };

  const filterNavigation = (queryValue) => {
    if (!sidebar) return;
    const query = normalize(queryValue);
    let matchesCount = 0;
    sidebar.querySelectorAll('.kodety-ui-nav-item').forEach((item) => {
      const matches = item.dataset.persistentOpen === 'true' || !query || item.dataset.search.includes(query);
      item.hidden = !matches;
      if (query) {
        if (!Object.prototype.hasOwnProperty.call(item.dataset, 'kodetySearchWasOpen')) {
          item.dataset.kodetySearchWasOpen = String(item.classList.contains('is-open'));
        }
        if (matches) {
          if (item.dataset.destination === 'true') matchesCount += 1;
          item.classList.add('is-open');
        }
      } else if (Object.prototype.hasOwnProperty.call(item.dataset, 'kodetySearchWasOpen')) {
        item.classList.toggle('is-open', item.dataset.kodetySearchWasOpen === 'true');
        delete item.dataset.kodetySearchWasOpen;
      }
      if (item.dataset.persistentOpen === 'true') item.classList.add('is-open');
      item
        .querySelector(':scope > .kodety-ui-nav-item__head [aria-controls]')
        ?.setAttribute('aria-expanded', String(item.classList.contains('is-open')));
    });
    sidebar.querySelectorAll('.kodety-ui-nav-section').forEach((section) => {
      section.hidden = !Array.from(section.querySelectorAll('.kodety-ui-nav-item')).some(
        (item) => !item.hidden,
      );
    });
    if (navigationEmpty) navigationEmpty.hidden = !query || matchesCount > 0;
    if (searchStatus) {
      searchStatus.textContent = query
        ? matchesCount
          ? englishUi
            ? `${matchesCount} ${matchesCount === 1 ? 'result found' : 'results found'}.`
            : `${matchesCount} ${matchesCount === 1 ? 'resultado encontrado' : 'resultados encontrados'}.`
          : uiText('Nenhum resultado encontrado.', 'No results found.')
        : '';
    }
  };

  const mountSidebar = () => {
    sidebar = document.createElement('aside');
    sidebar.id = 'kodety-ui-sidebar';
    sidebar.className = 'kodety-ui-sidebar';
    sidebar.setAttribute('aria-label', 'Onun Kodety WordPress OS');
    sidebar.tabIndex = -1;

    const header = document.createElement('div');
    header.className = 'kodety-ui-sidebar-header';
    mountBrand(header);
    mountSearch(header);
    const searchToggle = document.createElement('button');
    searchToggle.type = 'button';
    searchToggle.className = 'kodety-ui-search-toggle';
    searchToggle.setAttribute('aria-label', uiText('Buscar no painel', 'Search dashboard'));
    searchToggle.title = uiText('Buscar no painel', 'Search dashboard');
    searchToggle.appendChild(makeIcon('search'));
    searchToggle.addEventListener('click', focusNavigationSearch, { signal });
    header.appendChild(searchToggle);
    sidebar.appendChild(header);

    mountNavigation(sidebar);
    mountSidebarFooter(sidebar);

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'kodety-ui-sidebar-backdrop';
    backdrop.setAttribute('aria-label', uiText('Fechar navegação', 'Close navigation'));
    backdrop.addEventListener(
      'click',
      () => {
        setMobileSidebar(false, { restoreFocus: true });
      },
      { signal },
    );

    wpWrap.prepend(backdrop, sidebar);
    createdNodes.push(backdrop, sidebar);
    syncSidebarMode();

    searchInput?.addEventListener('input', () => filterNavigation(searchInput.value), { signal });
    searchInput?.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        if (searchInput.value) {
          searchInput.value = '';
          filterNavigation('');
        } else if (mobileQuery.matches) {
          setMobileSidebar(false, { restoreFocus: true });
        } else {
          searchInput.blur();
        }
      },
      { signal },
    );

    sidebar.addEventListener(
      'click',
      (event) => {
        if (
          mobileQuery.matches &&
          event.target instanceof Element &&
          event.target.closest('a.kodety-ui-nav-link')
        ) {
          setMobileSidebar(false);
        }
      },
      { signal },
    );
  };

  const normalizePageHeading = (heading) => {
    const screen = String(config.screen?.base || config.screen?.id || '');
    const value = normalize(heading?.textContent);
    if (
      screen === 'media' &&
      ['upload media', 'add new media file', 'adicionar arquivo de midia'].includes(value)
    ) {
      heading.textContent = uiText('Enviar mídia', 'Upload media');
    }
  };

  const enhanceGallerySearch = () => {
    if (
      !body.classList.contains('themes-php') &&
      !body.classList.contains('theme-install-php') &&
      !body.classList.contains('plugin-install-php')
    ) {
      return;
    }

    document
      .querySelectorAll(
        '.search-form.search-themes input[type="search"], .search-form.search-plugins input[type="search"], #search-plugins',
      )
      .forEach((input) => {
        const form = input.closest('.search-form');
        if (!form || form.classList.contains('kodety-ui-gallery-search')) return;

        form.classList.add('kodety-ui-gallery-search');
        input.classList.add('kodety-ui-gallery-search__input');
        enhancedNodes.add(form);
        enhancedNodes.add(input);

        const field = input.closest('.search-box') || input.closest('label') || form;
        field.classList.add('kodety-ui-gallery-search__field');
        enhancedNodes.add(field);

        const label =
          input.closest('label') ||
          Array.from(form.querySelectorAll('label')).find((item) => item.htmlFor === input.id);
        label?.querySelector('span')?.classList.add('screen-reader-text');
        if (!input.getAttribute('aria-label') && !label) {
          input.setAttribute(
            'aria-label',
            body.classList.contains('plugin-install-php') ? 'Pesquisar plugins' : 'Pesquisar temas',
          );
        }

        if (!originalPlaceholders.has(input)) {
          originalPlaceholders.set(input, input.getAttribute('placeholder'));
        }
        input.placeholder = body.classList.contains('plugin-install-php')
          ? 'Pesquisar plugins'
          : 'Pesquisar temas';

        const icon = makeIcon('search', 'kodety-ui-gallery-search__icon');
        field.prepend(icon);
        createdNodes.push(icon);
      });
  };

  const ensurePageActions = (wrap, heading) => {
    if (
      body.classList.contains('edit-php') &&
      new URLSearchParams(window.location.search).get('post_type') === 'page' &&
      !wrap.querySelector('.kodety-ui-open-editor')
    ) {
      const editorLink = document.createElement('a');
      editorLink.className = 'page-title-action kodety-ui-open-editor';
      editorLink.href = config.editorUrl || '/kodety/editor/';
      editorLink.append(makeIcon('sparkles'), document.createTextNode(uiText('Abrir editor', 'Open editor')));
      heading.insertAdjacentElement('afterend', editorLink);
    }

  };

  const mountPageHeader = () => {
    if (body.classList.contains('index-php')) return;
    const wrap = document.querySelector('#wpbody-content > .wrap');
    const heading = wrap?.querySelector(':scope > h1, :scope > .wp-heading-inline');
    if (!wrap || !heading || wrap.querySelector(':scope > .kodety-ui-page-header')) return;

    normalizePageHeading(heading);
    ensurePageActions(wrap, heading);

    const header = document.createElement('header');
    header.className = 'kodety-ui-page-header';

    const copy = document.createElement('div');
    copy.className = 'kodety-ui-page-header__copy';

    rememberAndMove(heading, copy);
    const description = wrap.querySelector(':scope > .subtitle');
    if (description) {
      description.classList.add('kodety-ui-page-header__description');
      rememberAndMove(description, copy);
    }
    header.appendChild(copy);

    const actions = Array.from(
      wrap.querySelectorAll(':scope > .page-title-action, :scope > .add-new-h2'),
    );
    if (actions.length) {
      const actionArea = document.createElement('div');
      actionArea.className = 'kodety-ui-page-header__actions';
      actions.forEach((action) => {
        const label = normalize(action.textContent);
        if (
          [
            'add new media file',
            'adicionar arquivo de midia',
            'adicionar novo arquivo de midia',
          ].includes(label)
        ) {
          action.textContent = uiText('Adicionar mídia', 'Add media');
        }
        if (
          !action.querySelector('.kodety-ui-icon') &&
          /^(adicionar|add new|novo|nova)/.test(normalize(action.textContent))
        ) {
          action.prepend(makeIcon('plus'));
        }
        rememberAndMove(action, actionArea);
      });
      header.appendChild(actionArea);
    }

    wrap.prepend(header);
    createdNodes.push(header);
  };

  const destroy = () => {
    controller.abort();
    createdNodes.forEach((node) => node.remove());
    movedNodes.forEach((marker, node) => {
      if (marker.parentNode) marker.parentNode.insertBefore(node, marker);
      marker.remove();
    });
    originalPlaceholders.forEach((value, input) => {
      if (!input.isConnected) return;
      if (value === null) input.removeAttribute('placeholder');
      else input.setAttribute('placeholder', value);
    });
    enhancedNodes.forEach((node) => {
      node.classList?.remove(
        'kodety-ui-gallery-search',
        'kodety-ui-gallery-search__field',
        'kodety-ui-gallery-search__input',
      );
    });
    body.classList.remove(
      'kodety-ui-sidebar-collapsed',
      'kodety-ui-sidebar-mobile-open',
      'kodety-ui-shell-ready',
    );
    window.removeEventListener('kodety:icons-ready', hydrateIcons);
    if (typeof mobileQuery.removeEventListener !== 'function') {
      mobileQuery.removeListener?.(syncSidebarMode);
    }
    if (window[globalKey]?.destroy === destroy) delete window[globalKey];
  };

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && workspaceControl?.classList.contains('is-open')) {
        event.preventDefault();
        setWorkspaceMenu(false, { restoreFocus: true });
        return;
      }
      if (event.key === 'Escape' && createMenu && !createMenu.hidden) {
        event.preventDefault();
        setCreateMenu(false, { restoreFocus: true });
        return;
      }
      if (event.key === 'Escape') {
        const screenToggle = topbar?.querySelector('#screen-meta-links .show-settings[aria-expanded="true"]');
        if (screenToggle) {
          event.preventDefault();
          screenToggle.click();
          screenToggle.focus({ preventScroll: true });
          return;
        }
      }
      if (
        event.key === 'Escape' &&
        mobileQuery.matches &&
        body.classList.contains('kodety-ui-sidebar-mobile-open')
      ) {
        event.preventDefault();
        setMobileSidebar(false, { restoreFocus: true });
        return;
      }
      if (
        event.key === 'Tab' &&
        mobileQuery.matches &&
        body.classList.contains('kodety-ui-sidebar-mobile-open')
      ) {
        const focusable = visibleFocusable(sidebar);
        if (!focusable.length) {
          event.preventDefault();
          sidebar?.focus({ preventScroll: true });
          return;
        }
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!sidebar?.contains(document.activeElement) || document.activeElement === sidebar) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
        return;
      }
      if (
        event.defaultPrevented ||
        event.key.toLocaleLowerCase() !== 'k' ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      focusNavigationSearch();
    },
    { signal },
  );

  window.addEventListener('kodety:icons-ready', hydrateIcons, { signal });
  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', syncSidebarMode, { signal });
  } else {
    mobileQuery.addListener?.(syncSidebarMode);
  }

  // Publish cleanup before mounting so the bootstrap can restore moved native
  // controls even if a browser or plugin error interrupts construction.
  window[globalKey] = { destroy, refreshIcons: hydrateIcons };
  mountTopbar();
  mountSidebar();
  if (!config.nativePluginSurface) {
    mountPageHeader();
    enhanceGallerySearch();
  }
  hydrateIcons();
  body.classList.remove('kodety-shell-failed');
  body.classList.add('kodety-ui-shell-ready');
  body.classList.add('kodety-ui-admin-ready');

  mountNavigationLoading({ config, signal, uiText });
  mountNativeSelects({ config, signal });

})();
