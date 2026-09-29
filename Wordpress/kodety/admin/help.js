(() => {
  'use strict';

  const root = document.querySelector('[data-kodety-help]');
  if (!root) return;

  const search = root.querySelector('[data-kodety-help-search]');
  const status = root.querySelector('[data-kodety-help-search-status]');
  const empty = root.querySelector('[data-kodety-help-empty]');
  const clear = root.querySelector('[data-kodety-help-clear]');
  const sections = Array.from(root.querySelectorAll('[data-kodety-help-section]'));
  const links = Array.from(root.querySelectorAll('[data-kodety-help-link]'));
  const groups = Array.from(root.querySelectorAll('[data-kodety-help-nav-group]'));
  const hashLinks = Array.from(root.querySelectorAll('a[href^="#"]'));
  const viewTabs = Array.from(root.querySelectorAll('[data-kodety-help-view]'));
  const viewPanels = Array.from(root.querySelectorAll('[data-kodety-help-view-panel]'));
  const skillTabs = Array.from(root.querySelectorAll('[data-kodety-skill-tab]'));
  const skillPanels = Array.from(root.querySelectorAll('[data-kodety-skill-panel]'));
  const copyButtons = Array.from(root.querySelectorAll('[data-kodety-skill-copy]'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeView = 'manual';
  let activeSkillDocument = 'skill';
  let queryActive = false;
  let navigationTargetId = '';
  let navigationReleaseTimer = 0;

  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  const updateHash = (hash, mode = 'push') => {
    if (!window.history?.pushState) return;
    const nextUrl = `${window.location.pathname}${window.location.search}#${encodeURIComponent(hash)}`;
    if (mode === 'replace' || window.location.hash === `#${hash}`) {
      window.history.replaceState(null, '', nextUrl);
    } else {
      window.history.pushState(null, '', nextUrl);
    }
  };

  const corpus = new Map(
    sections.map((section) => [
      section.id,
      normalize(`${section.dataset.search || ''} ${section.textContent || ''}`),
    ]),
  );

  const linkBySection = new Map(
    links.map((link) => [link.dataset.kodetyHelpLink || '', link]),
  );

  const setActive = (id) => {
    if (queryActive || activeView !== 'manual') return;
    links.forEach((link) => {
      const active = link.dataset.kodetyHelpLink === id;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  const activateHelpView = (nextView, options = {}) => {
    const view = viewTabs.some((tab) => tab.dataset.kodetyHelpView === nextView)
      ? nextView
      : 'manual';
    activeView = view;

    viewTabs.forEach((tab) => {
      const selected = tab.dataset.kodetyHelpView === view;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    viewPanels.forEach((panel) => {
      panel.hidden = panel.dataset.kodetyHelpViewPanel !== view;
    });

    if (options.focus) {
      viewPanels.find((panel) => panel.dataset.kodetyHelpViewPanel === view)?.focus({
        preventScroll: true,
      });
    }
    if (options.updateHash) {
      updateHash(view === 'skill' ? `skill-${activeSkillDocument}` : 'inicio');
    }
  };

  const activateSkillDocument = (nextDocument, options = {}) => {
    const documentId = skillTabs.some(
      (tab) => tab.dataset.kodetySkillTab === nextDocument,
    )
      ? nextDocument
      : 'skill';
    activeSkillDocument = documentId;

    skillTabs.forEach((tab) => {
      const selected = tab.dataset.kodetySkillTab === documentId;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    skillPanels.forEach((panel) => {
      panel.hidden = panel.dataset.kodetySkillPanel !== documentId;
    });

    if (options.focus) {
      skillPanels.find((panel) => panel.dataset.kodetySkillPanel === documentId)?.focus({
        preventScroll: true,
      });
    }
    if (options.updateHash) updateHash(`skill-${documentId}`);
  };

  const activateFromHash = () => {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (hash === 'skill' || hash.startsWith('skill-')) {
      const documentId = hash.replace(/^skill-?/, '') || 'skill';
      activateSkillDocument(documentId);
      activateHelpView('skill');
      return;
    }

    activateHelpView('manual');
    setActive(linkBySection.has(hash) ? hash : 'inicio');
  };

  const handleTabKeys = (event, tabs, currentIndex, activate) => {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    activate(nextTab);
    nextTab.focus();
  };

  viewTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      activateHelpView(tab.dataset.kodetyHelpView || 'manual', {
        updateHash: true,
      });
    });
    tab.addEventListener('keydown', (event) => {
      handleTabKeys(event, viewTabs, index, (nextTab) => {
        activateHelpView(nextTab.dataset.kodetyHelpView || 'manual', {
          updateHash: true,
        });
      });
    });
  });

  skillTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      activateSkillDocument(tab.dataset.kodetySkillTab || 'skill', {
        updateHash: true,
      });
    });
    tab.addEventListener('keydown', (event) => {
      handleTabKeys(event, skillTabs, index, (nextTab) => {
        activateSkillDocument(nextTab.dataset.kodetySkillTab || 'skill', {
          updateHash: true,
        });
      });
    });
  });

  copyButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const panel = button.closest('[data-kodety-skill-panel]');
      const source = panel?.querySelector('[data-kodety-skill-source]')?.textContent || '';
      if (!source || !navigator.clipboard?.writeText) return;
      const originalLabel = button.textContent;
      try {
        await navigator.clipboard.writeText(source);
        button.textContent = 'Copiado';
      } catch {
        button.textContent = 'Não foi possível copiar';
      }
      window.setTimeout(() => {
        button.textContent = originalLabel;
      }, 1600);
    });
  });

  const syncGroups = () => {
    groups.forEach((group) => {
      const hasVisibleLink = Array.from(group.querySelectorAll('li')).some(
        (item) => !item.hidden,
      );
      group.hidden = !hasVisibleLink;
    });
  };

  const applySearch = () => {
    const query = normalize(search?.value);
    queryActive = query !== '';
    let resultCount = 0;
    let firstResult = null;

    sections.forEach((section) => {
      const matches = !query || (corpus.get(section.id) || '').includes(query);
      section.hidden = !matches;
      if (matches) {
        resultCount += 1;
        if (!firstResult) firstResult = section;
      }

      const link = linkBySection.get(section.id);
      if (link?.parentElement) link.parentElement.hidden = !matches;
    });

    syncGroups();
    if (empty) empty.hidden = resultCount > 0 || !query;

    if (queryActive) {
      links.forEach((link) => {
        link.classList.remove('is-active');
        link.removeAttribute('aria-current');
      });
    } else {
      const hashId = window.location.hash.replace(/^#/, '');
      setActive(linkBySection.has(hashId) ? hashId : 'inicio');
    }

    if (status) {
      if (!query) status.textContent = 'Busca limpa. Todas as seções estão visíveis.';
      else if (resultCount === 0) status.textContent = `Nenhuma seção encontrada para “${search.value.trim()}”.`;
      else status.textContent = `${resultCount} ${resultCount === 1 ? 'seção encontrada' : 'seções encontradas'} para “${search.value.trim()}”.`;
    }

    return firstResult;
  };

  search?.addEventListener('input', applySearch);
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (search.value) {
        search.value = '';
        applySearch();
      } else {
        search.blur();
      }
      return;
    }

    if (event.key !== 'Enter' || !search.value.trim()) return;
    const firstResult = applySearch();
    if (!firstResult) return;
    event.preventDefault();
    firstResult.scrollIntoView({
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
      block: 'start',
    });
  });

  clear?.addEventListener('click', () => {
    if (!search) return;
    search.value = '';
    applySearch();
    search.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (
      activeView !== 'manual'
      || event.key !== '/'
      || event.metaKey
      || event.ctrlKey
      || event.altKey
      || event.defaultPrevented
    ) return;

    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || target?.isContentEditable
    ) return;

    event.preventDefault();
    search?.focus();
  });

  hashLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const id = (link.getAttribute('href') || '').replace(/^#/, '');
      const target = id ? document.getElementById(id) : null;
      if (!target) return;

      event.preventDefault();
      activateHelpView('manual');
      if (queryActive && search) {
        search.value = '';
        applySearch();
      }

      navigationTargetId = id;
      window.clearTimeout(navigationReleaseTimer);
      navigationReleaseTimer = window.setTimeout(() => {
        navigationTargetId = '';
      }, reducedMotion.matches ? 100 : 900);

      setActive(id);
      updateHash(id);
      target.scrollIntoView({
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  });

  if ('IntersectionObserver' in window) {
    const readingColumn = root.querySelector('.kodety-help-content');
    let observer;
    const observeReadingPosition = () => {
      observer?.disconnect();
      const readingRoot = readingColumn && getComputedStyle(readingColumn).overflowY === 'auto'
        ? readingColumn : null;
      const height = readingRoot?.clientHeight || window.innerHeight;
      const top = readingRoot ? 24 : 72;
      const intersecting = new Set();
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) intersecting.add(entry.target);
          else intersecting.delete(entry.target);
        });
        if (activeView !== 'manual' || queryActive || navigationTargetId) return;
        const visible = Array.from(intersecting)
          .filter((section) => !section.hidden)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const readingLine = (readingRoot?.getBoundingClientRect().top || 0) + top + 1;
        const current = visible.filter((section) => section.getBoundingClientRect().top <= readingLine).at(-1) || visible[0];
        if (current?.id) setActive(current.id);
      }, {
        root: readingRoot,
        // Pixel margins keep an 80px reading band independent of pane width.
        rootMargin: `-${top}px 0px -${Math.max(0, height - top - 80)}px 0px`,
        threshold: 0,
      });
      sections.forEach((section) => observer.observe(section));
    };
    observeReadingPosition();
    window.addEventListener('resize', observeReadingPosition);
  }

  window.addEventListener('hashchange', activateFromHash);

  applySearch();
  activateFromHash();
})();
