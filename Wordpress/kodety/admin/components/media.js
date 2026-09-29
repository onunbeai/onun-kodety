/* global AbortController, document, MutationObserver, NodeFilter, window */

(() => {
  'use strict';

  const GLOBAL_KEY = 'kodetyMediaUi';
  const body = document.body;

  if (!body) return;

  window[GLOBAL_KEY]?.destroy?.();

  const translatedTextNodes = new Map();
  const originalPlaceholders = new Map();
  const generatedCaptions = new Set();
  const generatedDecorations = new Set();
  const controller = new AbortController();
  const { signal } = controller;
  let observer = null;
  let frame = 0;
  let revealFrame = 0;

  const translations = new Map([
    ['Library', 'Biblioteca'],
    ['Media Library', 'Biblioteca de mídia'],
    ['Add New Media File', 'Adicionar mídia'],
    ['All media items', 'Todas as mídias'],
    ['All dates', 'Todas as datas'],
    ['Bulk select', 'Seleção em massa'],
    ['Search Media', 'Pesquisar mídia'],
    ['Load more', 'Carregar mais'],
    ['Jump to first loaded item', 'Ir para o primeiro item carregado'],
  ]);

  const classNames = [
    'kodety-ui-media-menu',
    'kodety-ui-media-submenu',
    'kodety-ui-media-submenu-item',
    'kodety-ui-media-submenu-link',
    'kodety-ui-media-browser',
    'kodety-ui-media-toolbar',
    'kodety-ui-media-toolbar-primary',
    'kodety-ui-media-toolbar-secondary',
    'kodety-ui-media-search',
    'kodety-ui-media-search-label',
    'kodety-ui-media-search-icon',
    'kodety-ui-media-view-switch',
    'kodety-ui-media-view-button',
    'kodety-ui-media-view-icon',
    'kodety-ui-media-grid',
    'kodety-ui-media-card',
    'kodety-ui-media-pagination',
    'kodety-ui-media-modal-icon-button',
    'kodety-ui-media-modal-icon',
    'kodety-ui-media-action-button',
    'kodety-ui-media-action-icon',
    'kodety-ui-media-copy-button',
  ];

  const isHidden = (element) => !element || element.hidden || element.classList.contains('hidden');

  const translateText = (root) => {
    if (!root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return translations.has(node.nodeValue?.trim() || '')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
      const source = node.nodeValue || '';
      const key = source.trim();
      const translation = translations.get(key);
      if (!translation) return;

      if (!translatedTextNodes.has(node)) translatedTextNodes.set(node, source);
      const leading = source.match(/^\s*/)?.[0] || '';
      const trailing = source.match(/\s*$/)?.[0] || '';
      const nextValue = `${leading}${translation}${trailing}`;
      if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
    });
  };

  const setSearchPlaceholder = (input) => {
    if (!input) return;
    if (!originalPlaceholders.has(input)) {
      originalPlaceholders.set(input, input.getAttribute('placeholder'));
    }

    input.classList.add('kodety-ui-media-search');
    if (input.getAttribute('placeholder') !== 'Pesquisar mídia') {
      input.setAttribute('placeholder', 'Pesquisar mídia');
    }
  };

  const makeDecorationIcon = (name, className) => {
    const icon = document.createElement('span');
    icon.className = className;
    icon.dataset.kodetyIcon = name;
    icon.dataset.kodetyIconSize = '14';
    icon.setAttribute('aria-hidden', 'true');
    generatedDecorations.add(icon);
    return icon;
  };

  const enhanceToolbarIcons = (primary, secondary) => {
    const searchInput = primary?.querySelector('input[type="search"]');
    const searchLabel = primary?.querySelector('label[for="media-search-input"]');
    searchLabel?.classList.add('kodety-ui-media-search-label');

    if (primary && searchInput && !primary.querySelector('.kodety-ui-media-search-icon')) {
      primary.insertBefore(makeDecorationIcon('search', 'kodety-ui-media-search-icon'), searchInput);
    }

    const viewSwitch = secondary?.querySelector('.view-switch');
    if (!viewSwitch) return;
    viewSwitch.classList.add('kodety-ui-media-view-switch');

    [
      ['.view-list', 'list'],
      ['.view-grid', 'grid'],
    ].forEach(([selector, iconName]) => {
      const control = viewSwitch.querySelector(selector);
      if (!control) return;
      control.classList.add('kodety-ui-media-view-button');
      if (!control.querySelector('.kodety-ui-media-view-icon')) {
        control.appendChild(makeDecorationIcon(iconName, 'kodety-ui-media-view-icon'));
      }
    });
  };

  const decorateButton = (control, iconName, buttonClass, iconClass) => {
    if (!control) return;
    control.classList.add(buttonClass);
    if (control.querySelector(`.${iconClass}`)) return;
    control.prepend(makeDecorationIcon(iconName, iconClass));
  };

  const enhanceMediaModal = () => {
    document.querySelectorAll('.media-modal').forEach((modal) => {
      decorateButton(
        modal.querySelector('.edit-media-header .left'),
        'chevron-left',
        'kodety-ui-media-modal-icon-button',
        'kodety-ui-media-modal-icon',
      );
      decorateButton(
        modal.querySelector('.edit-media-header .right'),
        'chevron-right',
        'kodety-ui-media-modal-icon-button',
        'kodety-ui-media-modal-icon',
      );
      decorateButton(
        modal.querySelector('.media-modal-close'),
        'x',
        'kodety-ui-media-modal-icon-button',
        'kodety-ui-media-modal-icon',
      );
      decorateButton(
        modal.querySelector('.edit-attachment'),
        'pencil',
        'kodety-ui-media-action-button',
        'kodety-ui-media-action-icon',
      );

      const copyButton = modal.querySelector('.copy-attachment-url');
      decorateButton(
        copyButton,
        'copy',
        'kodety-ui-media-copy-button',
        'kodety-ui-media-action-icon',
      );
    });
  };

  const enhanceMenu = () => {
    const menu = document.querySelector('#menu-media');
    if (!menu) return;

    menu.classList.add('kodety-ui-media-menu');
    const submenu = menu.querySelector(':scope > .wp-submenu');
    if (!submenu) return;

    submenu.classList.add('kodety-ui-media-submenu');
    translateText(submenu);

    submenu.querySelectorAll(':scope > li').forEach((item) => {
      item.classList.add('kodety-ui-media-submenu-item');
      const link = item.querySelector(':scope > a');
      link?.classList.add('kodety-ui-media-submenu-link');
    });
  };

  const getAttachmentName = (attachment) => {
    const ariaLabel = attachment.getAttribute('aria-label')?.trim();
    if (ariaLabel) return ariaLabel;

    return (
      attachment.querySelector('.filename')?.textContent?.replace(/\s+/g, ' ').trim() ||
      'Item de mídia'
    );
  };

  const enhanceAttachment = (attachment) => {
    attachment.classList.add('kodety-ui-media-card');

    const name = getAttachmentName(attachment);
    let caption = attachment.querySelector(':scope > .kodety-ui-media-card__caption');

    if (!caption) {
      caption = document.createElement('div');
      caption.className = 'kodety-ui-media-card__caption';
      caption.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      caption.appendChild(label);
      caption.addEventListener(
        'click',
        () => attachment.querySelector(':scope > .js--select-attachment')?.click(),
        { signal },
      );

      const checkButton = attachment.querySelector(':scope > .check');
      attachment.insertBefore(caption, checkButton || null);
      generatedCaptions.add(caption);
    }

    const label = caption.querySelector('span');
    if (label && label.textContent !== name) label.textContent = name;
    if (label && label.getAttribute('title') !== name) label.setAttribute('title', name);
  };

  const enhanceLoadMore = (wrapper) => {
    wrapper.classList.add('kodety-ui-media-pagination');
    translateText(wrapper);

    const count = wrapper.querySelector('.load-more-count');
    const loadButton = wrapper.querySelector('.load-more');
    const jumpButton = wrapper.querySelector('.load-more-jump');
    const spinner = wrapper.querySelector('.spinner');
    const canLoadMore = Boolean(loadButton && !isHidden(loadButton) && !loadButton.disabled);
    const canJump = Boolean(jumpButton && !isHidden(jumpButton) && !jumpButton.disabled);
    const hasCount = Boolean(count && !isHidden(count) && count.textContent?.trim());
    const isLoading = Boolean(spinner?.classList.contains('is-active'));

    wrapper.classList.toggle('is-complete', hasCount && !canLoadMore);
    wrapper.classList.toggle('is-loading', isLoading);
    wrapper.classList.toggle('is-idle', !hasCount && !canLoadMore && !canJump && !isLoading);

    if (count) {
      count.setAttribute('aria-live', 'polite');
      count.setAttribute('aria-atomic', 'true');
    }
  };

  const enhanceBrowser = (browser) => {
    browser.classList.add('kodety-ui-media-browser');

    const toolbar = browser.querySelector(':scope > .media-toolbar');
    if (toolbar) {
      toolbar.classList.add('kodety-ui-media-toolbar');
      toolbar.setAttribute('aria-label', 'Filtros da biblioteca de mídia');
      translateText(toolbar);

      const primary = toolbar.querySelector(':scope > .media-toolbar-primary');
      const secondary = toolbar.querySelector(':scope > .media-toolbar-secondary');
      primary?.classList.add('kodety-ui-media-toolbar-primary');
      secondary?.classList.add('kodety-ui-media-toolbar-secondary');
      setSearchPlaceholder(primary?.querySelector('input[type="search"]'));
      enhanceToolbarIcons(primary, secondary);
    }

    const grid = browser.querySelector(
      '.attachments-wrapper > .attachments, :scope > .attachments',
    );
    if (grid) {
      grid.classList.add('kodety-ui-media-grid');
      if (!grid.hasAttribute('aria-label')) {
        grid.setAttribute('aria-label', 'Itens da biblioteca de mídia');
      }
      grid.querySelectorAll(':scope > .attachment').forEach(enhanceAttachment);
    }

    browser.querySelectorAll('.load-more-wrapper').forEach(enhanceLoadMore);
  };

  const enhance = () => {
    frame = 0;

    enhanceMediaModal();

    const isLibraryScreen = body.classList.contains('upload-php');
    body.classList.toggle('kodety-ui-media-screen', isLibraryScreen);
    if (!isLibraryScreen) return;

    enhanceMenu();

    // The list view uses WordPress' standalone `.wp-filter` instead of the
    // grid media-frame toolbar. Enhance it with the same controls so changing
    // modes never swaps back to Dashicons or different dimensions.
    enhanceToolbarIcons(null, document.querySelector('.wp-filter'));

    document
      .querySelectorAll(
        '.media-frame.mode-grid .attachments-browser, body.upload-php .attachments-browser',
      )
      .forEach(enhanceBrowser);

    document.querySelectorAll('.media-router').forEach(translateText);
  };

  const revealInterface = () => {
    if (body.classList.contains('kodety-ui-admin-ready') || revealFrame) return;
    revealFrame = window.requestAnimationFrame(() => {
      revealFrame = 0;
      window.clearTimeout(window.kodetyAdminRevealTimer);
      body.classList.add('kodety-ui-admin-ready');
    });
  };

  const scheduleEnhance = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      enhance();
      revealInterface();
    });
  };

  const destroy = () => {
    controller.abort();
    observer?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    if (revealFrame) window.cancelAnimationFrame(revealFrame);

    translatedTextNodes.forEach((value, node) => {
      if (node.isConnected) node.nodeValue = value;
    });
    originalPlaceholders.forEach((value, input) => {
      if (!input.isConnected) return;
      if (value === null) input.removeAttribute('placeholder');
      else input.setAttribute('placeholder', value);
    });
    generatedCaptions.forEach((caption) => caption.remove());
    generatedDecorations.forEach((decoration) => decoration.remove());

    body.classList.remove('kodety-ui-media-screen', 'kodety-ui-admin-ready');
    document.querySelectorAll('.kodety-ui-media-pagination').forEach((node) => {
      node.classList.remove('is-complete', 'is-loading', 'is-idle');
    });
    document.querySelectorAll(classNames.map((name) => `.${name}`).join(',')).forEach((node) => {
      node.classList.remove(...classNames);
    });

    if (window[GLOBAL_KEY]?.destroy === destroy) delete window[GLOBAL_KEY];
  };

  observer = new MutationObserver(scheduleEnhance);
  observer.observe(body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-label', 'disabled', 'placeholder'],
  });

  document.addEventListener('wp-updates-notice-added', scheduleEnhance, { signal });
  window.addEventListener('pageshow', scheduleEnhance, { signal });

  window[GLOBAL_KEY] = { destroy, refresh: scheduleEnhance };
  enhance();
  revealInterface();
})();
