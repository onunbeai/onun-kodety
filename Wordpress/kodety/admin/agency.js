/* global document, window */

(() => {
  'use strict';

  const host = document.querySelector('[data-kodety-agency-host]');
  let root = host?.querySelector('[data-kodety-agency]') || document.querySelector('[data-kodety-agency]');
  if (!root) return;

  if (host && !host.shadowRoot) {
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = host.dataset.kodetyAgencyStyle || '';
    shadowRoot.append(stylesheet, root);
    host.setAttribute('data-kodety-agency-isolated', 'true');

    const mountIcons = () => window.KodetyIcons?.scan?.(shadowRoot);
    mountIcons();
    document.addEventListener('kodety:icons-ready', mountIcons, { once: true });
  }

  const projectDialog = root.querySelector('[data-kodety-project-dialog]');
  const folderDialog = root.querySelector('[data-kodety-folder-dialog]');
  const renameDialog = root.querySelector('[data-kodety-rename-dialog]');
  const folderRenameDialog = root.querySelector('[data-kodety-folder-rename-dialog]');
  const routeDialog = root.querySelector('[data-kodety-route-dialog]');
  const search = root.querySelector('[data-kodety-agency-search]');
  const items = [...root.querySelectorAll('[data-agency-item]')];
  const folderFilter = root.querySelector('[data-kodety-folder-filter]');
  const folderFilterTrigger = folderFilter?.querySelector('[data-kodety-folder-filter-trigger]');
  const folderFilterMenu = folderFilter?.querySelector('.kodety-agency__filter-menu');
  const folderFilterLabel = folderFilter?.querySelector('[data-kodety-folder-filter-label]');
  const folderOptions = [...(folderFilter?.querySelectorAll('[data-kodety-folder-option]') || [])];
  const projectGrid = root.querySelector('.kodety-agency__project-grid');
  const projectItems = [...root.querySelectorAll('.kodety-agency__project')];
  const folderDropTargets = [...root.querySelectorAll('[data-kodety-folder-drop]')];
  let currentFolder = '';
  let draggedProject = null;
  let blockProjectClickUntil = 0;

  const openDialog = (dialog) => {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  root.querySelectorAll('[data-kodety-open-project]').forEach((button) =>
    button.addEventListener('click', () => openDialog(projectDialog)),
  );
  root.querySelectorAll('[data-kodety-open-folder]').forEach((button) =>
    button.addEventListener('click', () => openDialog(folderDialog)),
  );
  root.querySelectorAll('[data-kodety-close]').forEach((button) =>
    button.addEventListener('click', () => button.closest('dialog')?.close()),
  );
  root.querySelectorAll('dialog').forEach((dialog) =>
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    }),
  );

  const applyFilters = () => {
    const query = String(search?.value || '').trim().toLocaleLowerCase('pt-BR');
    items.forEach((item) => {
      const matchesSearch = !query || String(item.dataset.search || '').includes(query);
      const itemFolder = item.dataset.folderId || '';
      const matchesFolder =
        !currentFolder ||
        itemFolder === currentFolder ||
        (currentFolder === '__root' && (!itemFolder || itemFolder === '__root'));
      item.hidden = !matchesSearch || !matchesFolder;
    });
  };

  search?.addEventListener('input', applyFilters);
  const setFolderFilter = (value, label = '') => {
    currentFolder = value || '';
    if (folderFilterLabel) {
      folderFilterLabel.setAttribute('data-kodety-no-i18n', '');
      folderFilterLabel.textContent = label || 'Todos';
    }
    folderOptions.forEach((option) => {
      option.setAttribute('aria-selected', option.dataset.value === currentFolder ? 'true' : 'false');
    });
    if (folderFilterMenu) folderFilterMenu.hidden = true;
    folderFilterTrigger?.setAttribute('aria-expanded', 'false');
    applyFilters();
  };
  folderFilterTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!folderFilterMenu) return;
    const willOpen = folderFilterMenu.hidden;
    closeActionMenus();
    folderFilterMenu.hidden = !willOpen;
    folderFilterTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  folderOptions.forEach((option) =>
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      setFolderFilter(option.dataset.value || '', option.dataset.label || option.textContent || 'Todos');
    }),
  );
  root.querySelectorAll('.kodety-agency__folder-open[data-kodety-folder-filter-value]').forEach((button) =>
    button.addEventListener('click', () => {
      const value = button.dataset.kodetyFolderFilterValue || '';
      const label = button.querySelector('strong')?.textContent?.trim() || 'Todos';
      setFolderFilter(value, label);
      root.querySelector('.kodety-agency__projects')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }),
  );

  const sortProjects = () => {
    if (!projectGrid) return;
    projectItems
      .slice()
      .sort((left, right) => {
        const leftUpdated = Number(left.dataset.projectUpdated || 0);
        const rightUpdated = Number(right.dataset.projectUpdated || 0);
        return rightUpdated - leftUpdated;
      })
      .forEach((project) => projectGrid.appendChild(project));
  };
  sortProjects();

  const closeActionMenus = () => {
    root.querySelectorAll('.kodety-agency__menu').forEach((menu) => {
      menu.hidden = true;
    });
    root.querySelectorAll('.kodety-agency__more').forEach((candidate) =>
      candidate.setAttribute('aria-expanded', 'false'),
    );
    root.querySelectorAll('.is-menu-open').forEach((item) => item.classList.remove('is-menu-open'));
  };

  const clearProjectDrag = () => {
    if (draggedProject) {
      draggedProject.classList.remove('is-dragging');
      draggedProject.setAttribute('aria-grabbed', 'false');
    }
    folderDropTargets.forEach((folder) => folder.classList.remove('is-drop-target'));
    root.classList.remove('is-project-dragging');
    draggedProject = null;
  };

  const submitProjectMove = (projectId, folderId) => {
    const action = root.dataset.kodetyProjectAction || '';
    const nonce = root.dataset.kodetyProjectActionNonce || '';
    if (!action || !nonce || !projectId || !folderId) return;

    const form = document.createElement('form');
    form.method = 'post';
    form.action = action;
    form.hidden = true;
    [
      ['action', 'kodety_agency_project_action'],
      ['operation', 'move'],
      ['project_id', projectId],
      ['folder_id', folderId],
      ['kodety_agency_nonce', nonce],
    ].forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  };

  projectItems.forEach((project) => {
    project.addEventListener('dragstart', (event) => {
      if (event.target.closest('.kodety-agency__more, .kodety-agency__menu')) {
        event.preventDefault();
        return;
      }
      const projectId = project.dataset.projectId || '';
      if (!projectId || !event.dataTransfer) {
        event.preventDefault();
        return;
      }

      closeActionMenus();
      draggedProject = project;
      project.classList.add('is-dragging');
      project.setAttribute('aria-grabbed', 'true');
      root.classList.add('is-project-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-kodety-project', projectId);
      event.dataTransfer.setData('text/plain', projectId);
    });

    project.addEventListener('dragend', () => {
      blockProjectClickUntil = Date.now() + 300;
      clearProjectDrag();
    });
  });

  folderDropTargets.forEach((folder) => {
    folder.addEventListener('dragenter', (event) => {
      if (!draggedProject || draggedProject.dataset.folderId === folder.dataset.folderId) return;
      event.preventDefault();
      folder.classList.add('is-drop-target');
    });
    folder.addEventListener('dragover', (event) => {
      if (!draggedProject || draggedProject.dataset.folderId === folder.dataset.folderId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      folder.classList.add('is-drop-target');
    });
    folder.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !folder.contains(event.relatedTarget)) {
        folder.classList.remove('is-drop-target');
      }
    });
    folder.addEventListener('drop', (event) => {
      if (!draggedProject) return;
      event.preventDefault();
      event.stopPropagation();
      const projectId =
        event.dataTransfer?.getData('application/x-kodety-project') ||
        event.dataTransfer?.getData('text/plain') ||
        draggedProject.dataset.projectId ||
        '';
      const folderId = folder.dataset.folderId || '';
      const sameFolder = draggedProject.dataset.folderId === folderId;
      if (sameFolder) {
        clearProjectDrag();
        return;
      }
      draggedProject.classList.add('is-moving');
      folder.classList.add('is-receiving');
      submitProjectMove(projectId, folderId);
    });
  });

  root.addEventListener(
    'click',
    (event) => {
      if (
        Date.now() < blockProjectClickUntil &&
        event.target.closest('.kodety-agency__project-open')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  root.querySelectorAll('.kodety-agency__more').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = button.parentElement?.querySelector('.kodety-agency__menu');
      if (!menu) return;
      const willOpen = menu.hidden;
      closeActionMenus();
      if (folderFilterMenu) folderFilterMenu.hidden = true;
      folderFilterTrigger?.setAttribute('aria-expanded', 'false');
      menu.hidden = !willOpen;
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) button.closest('.kodety-agency__project, .kodety-agency__folder')?.classList.add('is-menu-open');
    }),
  );
  document.addEventListener('click', () => {
    closeActionMenus();
    if (folderFilterMenu) folderFilterMenu.hidden = true;
    folderFilterTrigger?.setAttribute('aria-expanded', 'false');
  });
  root.querySelectorAll('.kodety-agency__menu').forEach((menu) =>
    menu.addEventListener('click', (event) => event.stopPropagation()),
  );
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeActionMenus();
    if (folderFilterMenu) folderFilterMenu.hidden = true;
    folderFilterTrigger?.setAttribute('aria-expanded', 'false');
  });

  const resizeLiveCover = (frame) => {
    const preview = frame.closest('.kodety-agency__preview');
    if (!preview) return;
    const scale = Math.max(0.05, preview.clientWidth / 1200);
    frame.style.transform = `scale(${scale})`;
  };
  root.querySelectorAll('[data-kodety-live-cover]').forEach((frame) => resizeLiveCover(frame));
  if ('ResizeObserver' in window) {
    const liveCoverObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const frame = entry.target.querySelector('[data-kodety-live-cover]');
        if (frame) resizeLiveCover(frame);
      });
    });
    root.querySelectorAll('.kodety-agency__preview[data-kodety-live-cover-url]').forEach((preview) =>
      liveCoverObserver.observe(preview),
    );
  } else {
    window.addEventListener('resize', () =>
      root.querySelectorAll('[data-kodety-live-cover]').forEach((frame) => resizeLiveCover(frame)),
    );
  }

  root.querySelectorAll('[data-kodety-confirm]').forEach((control) =>
    control.addEventListener('click', (event) => {
      if (!window.confirm(control.dataset.kodetyConfirm || 'Continuar?')) event.preventDefault();
    }),
  );

  root.querySelectorAll('[data-kodety-rename-project]').forEach((button) =>
    button.addEventListener('click', () => {
      const id = renameDialog?.querySelector('[data-kodety-rename-id]');
      const input = renameDialog?.querySelector('[data-kodety-rename-input]');
      if (id) id.value = button.dataset.kodetyRenameProject || '';
      if (input) input.value = button.dataset.projectName || '';
      openDialog(renameDialog);
      window.setTimeout(() => input?.select(), 0);
    }),
  );
  root.querySelectorAll('[data-kodety-rename-folder]').forEach((button) =>
    button.addEventListener('click', () => {
      const id = folderRenameDialog?.querySelector('[data-kodety-folder-rename-id]');
      const input = folderRenameDialog?.querySelector('[data-kodety-folder-rename-input]');
      if (id) id.value = button.dataset.kodetyRenameFolder || '';
      if (input) input.value = button.dataset.folderName || '';
      openDialog(folderRenameDialog);
      window.setTimeout(() => input?.select(), 0);
    }),
  );

  root.querySelectorAll('[data-kodety-route-project]').forEach((button) =>
    button.addEventListener('click', () => {
      const id = routeDialog?.querySelector('[data-kodety-route-id]');
      const slug = routeDialog?.querySelector('[data-kodety-route-slug]');
      const rootToggle = routeDialog?.querySelector('[data-kodety-route-root]');
      const description = routeDialog?.querySelector('[data-kodety-route-description]');
      if (id) id.value = button.dataset.kodetyRouteProject || '';
      if (slug) slug.value = button.dataset.projectSlug || '';
      if (rootToggle) rootToggle.checked = button.dataset.projectRoot === '1';
      if (description) {
        const projectName = button.dataset.projectName || 'este projeto';
        description.setAttribute('data-kodety-no-i18n', '');
        description.textContent = typeof window.kodetyFormatMessage === 'function'
          ? window.kodetyFormatMessage('agency.route_description', { project: projectName })
          : `Defina o endereço de ${projectName}.`;
      }
      openDialog(routeDialog);
      window.setTimeout(() => slug?.select(), 0);
    }),
  );

  const sourceInputs = [...(projectDialog?.querySelectorAll('input[name="source"]') || [])];
  const zipField = projectDialog?.querySelector('[data-kodety-agency-zip]');
  const updateSource = () => {
    const importing = sourceInputs.find((input) => input.checked)?.value === 'import';
    if (zipField) zipField.hidden = !importing;
    const input = zipField?.querySelector('input');
    if (input) input.required = importing;
  };
  sourceInputs.forEach((input) => input.addEventListener('change', updateSource));
  updateSource();

  const createName = projectDialog?.querySelector('input[name="project_name"]');
  const createSlug = projectDialog?.querySelector('input[name="project_slug"]');
  let slugWasEdited = false;
  createSlug?.addEventListener('input', () => {
    slugWasEdited = createSlug.value.trim() !== '';
  });
  createName?.addEventListener('input', () => {
    if (!createSlug || slugWasEdited) return;
    createSlug.value = createName.value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  });
})();
