/* global document, fetch, FormData, navigator, URLSearchParams, window */
(() => {
  'use strict';

  const root = document.querySelector('[data-kodety-media-app]');
  const config = window.kodetyMediaLibrary || {};
  if (!root || !config.endpoint) return;

  const adminUiLocale = () => window.kodetyAdminI18n?.locale
    || document.documentElement.dataset.kodetyUiLocale
    || document.documentElement.lang
    || 'pt-BR';

  const grid = root.querySelector('[data-kodety-media-grid]');
  const empty = root.querySelector('[data-kodety-media-empty]');
  const emptyTitle = root.querySelector('[data-kodety-media-empty-title]');
  const emptyMessage = root.querySelector('[data-kodety-media-empty-message]');
  const emptyAction = root.querySelector('[data-kodety-media-empty-action]');
  const loading = root.querySelector('[data-kodety-media-loading]');
  const more = root.querySelector('[data-kodety-media-more]');
  const search = root.querySelector('[data-kodety-media-search]');
  const type = root.querySelector('[data-kodety-media-type]');
  const order = root.querySelector('[data-kodety-media-order]');
  const resultCount = root.querySelector('[data-kodety-media-result-count]');
  const input = root.querySelector('[data-kodety-media-file-input]');
  const selectionBar = root.querySelector('[data-kodety-media-selection]');
  const selectAll = root.querySelector('[data-kodety-media-select-all]');
  const selectionCount = root.querySelector('[data-kodety-media-selection-count]');
  const clearSelectionButton = root.querySelector('[data-kodety-media-clear-selection]');
  const bulkDelete = root.querySelector('[data-kodety-media-bulk-delete]');
  const folderList = root.querySelector('[data-kodety-media-folder-list]');
  const folderItems = root.querySelector('[data-kodety-media-folder-items]');
  const newFolderButton = root.querySelector('[data-kodety-media-new-folder]');
  const reloadFoldersButton = root.querySelector('[data-kodety-media-reload-folders]');
  const folderForm = root.querySelector('[data-kodety-media-folder-form]');
  const folderName = root.querySelector('[data-kodety-media-folder-name]');
  const folderCancel = root.querySelector('[data-kodety-media-folder-cancel]');
  const folderSelect = root.querySelector('[data-kodety-media-folder-select]');
  const moveButton = root.querySelector('[data-kodety-media-move]');
  const dropzone = root.querySelector('[data-kodety-media-dropzone]');
  const detail = root.querySelector('[data-kodety-media-detail]');
  const detailPanel = detail?.querySelector('.kodety-media-detail__panel');
  const detailContent = detail?.querySelector('.kodety-media-detail__content');
  const preview = detail?.querySelector('[data-kodety-media-preview]');
  const detailTitle = detail?.querySelector('#kodety-media-detail-title');
  const form = detail?.querySelector('[data-kodety-media-form]');
  const meta = detail?.querySelector('[data-kodety-media-meta]');
  const save = detail?.querySelector('[data-kodety-media-save]');
  const remove = detail?.querySelector('[data-kodety-media-delete]');
  const replaceButton = detail?.querySelector('[data-kodety-media-replace]');
  const replaceInput = detail?.querySelector('[data-kodety-media-replace-input]');
  const toast = root.querySelector('[data-kodety-media-toast]');

  const requiredElements = [
    grid,
    empty,
    emptyTitle,
    emptyMessage,
    emptyAction,
    loading,
    more,
    search,
    type,
    order,
    resultCount,
    input,
    selectionBar,
    selectAll,
    selectionCount,
    clearSelectionButton,
    folderList,
    folderItems,
    newFolderButton,
    folderForm,
    folderName,
    folderCancel,
    folderSelect,
    moveButton,
    dropzone,
    detail,
    detailPanel,
    detailContent,
    preview,
    detailTitle,
    form,
    meta,
    save,
    remove,
    replaceButton,
    replaceInput,
    toast,
  ];
  if (requiredElements.some((element) => !element)) return;

  const state = {
    page: 1,
    totalPages: 1,
    total: 0,
    items: [],
    selected: null,
    selectedIds: new Set(),
    busy: false,
    loading: false,
    mutating: false,
    dragDepth: 0,
    loadToken: 0,
    controller: null,
    focusReturn: null,
    emptyMode: 'empty',
    folder: '',
    folders: [],
    cacheBust: new Map(),
  };
  let searchTimer = 0;
  let toastTimer = 0;
  let deleteTimer = 0;
  let bulkDeleteTimer = 0;

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const visibleDetailControls = () =>
    Array.from(detailPanel.querySelectorAll(focusableSelector)).filter(
      (element) => !element.hidden && !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length,
    );

  // Escape transformed wp-admin containers so fixed overlays always use the viewport.
  [dropzone, detail, toast].forEach((node) => document.body.appendChild(node));

  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');
  loading.setAttribute('aria-label', 'Carregando mídias');
  grid.removeAttribute('aria-live');
  grid.setAttribute('aria-label', 'Arquivos da biblioteca de mídia');
  resultCount.setAttribute('aria-live', 'polite');
  resultCount.setAttribute('aria-atomic', 'true');
  empty.setAttribute('role', 'status');
  dropzone.setAttribute('role', 'status');
  dropzone.setAttribute('aria-live', 'polite');
  detail.setAttribute('aria-hidden', 'true');

  const icon = (name) => {
    const node = document.createElement('span');
    node.dataset.kodetyIcon = name;
    node.setAttribute('aria-hidden', 'true');
    return node;
  };

  const decode = (value) => {
    const area = document.createElement('textarea');
    area.innerHTML = String(value || '');
    return area.value;
  };

  const rawText = (field) => decode(field?.raw ?? field?.rendered ?? field ?? '');
  const titleFor = (item) => rawText(item.title) || item.slug || `Arquivo ${item.id}`;
  const humanSize = (bytes) => {
    const value = Number(bytes) || 0;
    if (!value) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / (1024 ** power)).toFixed(power ? 1 : 0)} ${units[power]}`;
  };

  const notify = (message, isError = false) => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, isError ? 5200 : 3400);
  };

  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'X-WP-Nonce': config.nonce, Accept: 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Não foi possível concluir a operação.');
    return { body, response };
  };

  const setBusy = (busy, channel = 'loading') => {
    state[channel] = busy;
    state.busy = state.loading || state.mutating;
    root.setAttribute('aria-busy', String(state.busy));
    grid.setAttribute('aria-busy', String(state.loading));
    loading.hidden = !state.loading;
    more.disabled = state.busy;
    updateSelectionUi();
  };

  const renderFileFallback = (frame, item) => {
    frame.replaceChildren();
    frame.classList.remove('is-font');
    frame.classList.add('is-file');
    const symbol = document.createElement('span');
    symbol.className = 'kodety-media-card__file-symbol';
    symbol.append(icon(item.media_type === 'video' ? 'video' : item.media_type === 'audio' ? 'audio' : 'file'));
    window.KodetyIcons?.scan?.(symbol);
    symbol.setAttribute('aria-hidden', 'true');
    const badge = document.createElement('small');
    badge.textContent = (String(item.source_url || '').split('?')[0].match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'Arquivo').toUpperCase();
    frame.append(symbol, badge);
  };

  const FONT_MIME_TYPES = new Set([
    'font/otf', 'font/ttf', 'font/woff', 'font/woff2', 'font/sfnt',
    'application/x-font-otf', 'application/x-font-ttf', 'application/x-font-truetype',
    'application/x-font-opentype', 'application/font-woff', 'application/font-woff2',
    'application/vnd.ms-opentype', 'application/font-sfnt',
  ]);
  const FONT_EXTENSIONS = new Set(['otf', 'ttf', 'woff', 'woff2']);
  // A font either decodes once or never; remembering the outcome keeps the grid
  // from re-fetching the same file on every re-render.
  const fontPreviewState = new Map();

  const fileExtension = (item) => {
    const path = String(item.source_url || '').split(/[?#]/)[0];
    const dot = path.lastIndexOf('.');
    return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
  };

  const isFontItem = (item) => FONT_MIME_TYPES.has(String(item.mime_type || '').toLowerCase())
    || FONT_EXTENSIONS.has(fileExtension(item));

  const renderFontPreview = (frame, item) => {
    const url = bustCache(item, item.source_url);
    const family = `kodety-media-font-${Number(item.id)}`;
    if (!url || typeof window.FontFace !== 'function' || !document.fonts) {
      renderFileFallback(frame, item);
      return;
    }
    if (fontPreviewState.get(family) === 'failed') {
      renderFileFallback(frame, item);
      return;
    }

    frame.replaceChildren();
    frame.classList.remove('is-file');
    frame.classList.add('is-font');
    const sample = document.createElement('span');
    sample.className = 'kodety-media-card__font-sample';
    sample.textContent = 'Aa';
    const badge = document.createElement('small');
    badge.textContent = (fileExtension(item) || String(item.mime_type || '').split('/').pop() || 'fonte');
    frame.append(sample, badge);

    const apply = () => { sample.style.fontFamily = `"${family}", system-ui, sans-serif`; };
    if (fontPreviewState.get(family) === 'loaded') { apply(); return; }

    const face = new window.FontFace(family, `url("${url.replaceAll('"', '%22')}")`);
    face.load().then((loaded) => {
      document.fonts.add(loaded);
      fontPreviewState.set(family, 'loaded');
      apply();
    }).catch(() => {
      // The browser refused the file (corrupt, or served cross-origin without
      // CORS). Showing "Aa" in a substitute face would be a lie about the font.
      fontPreviewState.set(family, 'failed');
      renderFileFallback(frame, item);
    });
  };

  // URLs não mudam ao substituir um arquivo; o carimbo força o navegador a rebaixar o cache.
  const bustCache = (item, url) => {
    const stamp = state.cacheBust.get(Number(item.id));
    if (!stamp || !url) return url;
    return `${url}${url.includes('?') ? '&' : '?'}v=${stamp}`;
  };

  const cardPreview = (item) => {
    const frame = document.createElement('span');
    frame.className = 'kodety-media-card__preview';
    if (item.media_type === 'image' && item.source_url) {
      const image = document.createElement('img');
      image.src = bustCache(item, item.media_details?.sizes?.medium?.source_url || item.media_details?.sizes?.thumbnail?.source_url || item.source_url);
      image.alt = item.alt_text || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => renderFileFallback(frame, item), { once: true });
      frame.appendChild(image);
    } else if (isFontItem(item)) {
      renderFontPreview(frame, item);
    } else {
      renderFileFallback(frame, item);
    }
    return frame;
  };

  const resetBulkDelete = () => {
    window.clearTimeout(bulkDeleteTimer);
    if (!bulkDelete) return;
    bulkDelete.dataset.confirming = 'false';
    bulkDelete.textContent = 'Excluir';
  };

  const updateSelectionUi = () => {
    const loadedIds = state.items.map((item) => Number(item.id));
    const selectedLoaded = loadedIds.filter((id) => state.selectedIds.has(id)).length;
    const count = state.selectedIds.size;
    selectionCount.textContent = `${count.toLocaleString(adminUiLocale())} ${count === 1 ? 'selecionado' : 'selecionados'}`;
    selectAll.checked = loadedIds.length > 0 && selectedLoaded === loadedIds.length;
    selectAll.indeterminate = selectedLoaded > 0 && selectedLoaded < loadedIds.length;
    grid.querySelectorAll('[data-media-id]').forEach((card) => {
      const selected = state.selectedIds.has(Number(card.dataset.mediaId));
      card.classList.toggle('is-selected', selected);
      const checkbox = card.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = selected;
    });
    const disabled = count === 0 || state.busy;
    clearSelectionButton.disabled = disabled;
    folderSelect.disabled = disabled;
    moveButton.disabled = disabled || folderSelect.value === '';
    if (bulkDelete) bulkDelete.disabled = disabled;
    selectionBar.classList.toggle('has-selection', count > 0);
    resetBulkDelete();
  };

  const clearSelection = () => {
    state.selectedIds.clear();
    updateSelectionUi();
  };

  const toggleSelection = (id, selected) => {
    if (selected) state.selectedIds.add(Number(id));
    else state.selectedIds.delete(Number(id));
    updateSelectionUi();
  };

  const createCard = (item) => {
    const card = document.createElement('article');
    card.className = 'kodety-media-card';
    card.dataset.mediaId = item.id;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'kodety-media-card__open';
    open.setAttribute('aria-label', `Abrir detalhes de ${titleFor(item)}`);
    open.appendChild(cardPreview(item));
    const information = document.createElement('span');
    information.className = 'kodety-media-card__info';
    const title = document.createElement('strong');
    title.textContent = titleFor(item);
    title.title = title.textContent;
    const mime = document.createElement('small');
    const extension = String(item.source_url || '').split('?')[0].match(/\.([a-z0-9]{1,8})$/i)?.[1];
    mime.textContent = [extension?.toUpperCase() || item.mime_type || 'Arquivo', item.media_details?.filesize ? humanSize(item.media_details.filesize) : ''].filter(Boolean).join(' · ');
    information.append(title, mime);
    open.appendChild(information);
    open.addEventListener('click', () => openDetail(item, open));

    const selector = document.createElement('label');
    selector.className = 'kodety-media-card__select';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedIds.has(Number(item.id));
    checkbox.setAttribute('aria-label', `Selecionar ${titleFor(item)}`);
    checkbox.addEventListener('change', () => toggleSelection(item.id, checkbox.checked));
    const visual = document.createElement('span');
    visual.setAttribute('aria-hidden', 'true');
    selector.append(checkbox, visual);
    card.append(open, selector);
    return card;
  };

  const setEmptyState = (mode) => {
    state.emptyMode = mode;
    const failed = mode === 'error';
    emptyTitle.textContent = failed ? 'Não foi possível carregar as mídias' : 'Nenhuma mídia encontrada';
    emptyMessage.textContent = failed ? 'Verifique sua conexão e tente novamente.' : 'Tente outro filtro ou adicione o primeiro arquivo.';
    emptyAction.textContent = failed ? 'Tentar novamente' : 'Adicionar arquivos';
    emptyAction.dataset.mode = failed ? 'retry' : 'upload';
  };

  const render = (append = false) => {
    if (!append) grid.replaceChildren();
    const fragment = document.createDocumentFragment();
    state.items.forEach((item) => {
      if (append && grid.querySelector(`[data-media-id="${item.id}"]`)) return;
      fragment.appendChild(createCard(item));
    });
    grid.appendChild(fragment);
    const hasItems = state.items.length > 0;
    empty.hidden = hasItems;
    grid.hidden = !hasItems;
    more.hidden = state.page >= state.totalPages || !hasItems;
    resultCount.textContent = `${state.total.toLocaleString(adminUiLocale())} ${state.total === 1 ? 'arquivo' : 'arquivos'}`;
    updateSelectionUi();
    window.KodetyIcons?.scan?.(document);
  };

  const cardControlFor = (id) =>
    grid.querySelector(`[data-media-id="${Number(id)}"] .kodety-media-card__open`);

  const listUrl = () => {
    const params = new URLSearchParams({ context: 'edit', per_page: '40', page: String(state.page), orderby: 'date', order: 'desc' });
    const query = search.value.trim();
    if (query) params.set('search', query);
    if (type.value === 'document') params.set('kodety_media_kind', 'document');
    else if (type.value) params.set('media_type', type.value);
    if (state.folder !== '') params.set('kodety_folder', state.folder);
    const [orderby, direction] = order.value.split('-');
    params.set('orderby', orderby);
    params.set('order', direction);
    return `${config.endpoint}?${params.toString()}`;
  };

  const selectFolder = (folder) => {
    state.folder = String(folder);
    folderList.querySelectorAll('[data-kodety-media-folder]').forEach((button) => {
      const current = button.dataset.kodetyMediaFolder === state.folder;
      button.classList.toggle('is-current', current);
      button.setAttribute('aria-pressed', String(current));
    });
    refresh();
  };

  const startFolderEdit = (row, folder) => {
    if (row.querySelector('form')) return;
    const editor = document.createElement('form');
    editor.className = 'kodety-media-folder-edit';
    const field = document.createElement('input');
    field.value = folder.name;
    field.maxLength = 80;
    field.setAttribute('aria-label', `Renomear ${folder.name}`);
    const currentName = document.createElement('small');
    currentName.textContent = `Nome atual: ${folder.name}`;
    const saveName = document.createElement('button');
    saveName.type = 'submit';
    saveName.textContent = 'Salvar';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    editor.append(currentName, field, saveName, cancel);
    Array.from(row.children).forEach((child) => { child.hidden = true; });
    row.appendChild(editor);
    cancel.addEventListener('click', () => {
      editor.remove();
      Array.from(row.children).forEach((child) => { child.hidden = false; });
      row.querySelector('[aria-label^="Renomear "]')?.focus({ preventScroll: true });
    });
    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = field.value.trim();
      if (!name) return;
      saveName.disabled = true;
      try {
        await request(`${config.foldersEndpoint}/${folder.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, expectedRevision: folder.revision }),
        });
        notify('Pasta renomeada.');
        await loadFolders();
      } catch (error) {
        notify(error.message, true);
        saveName.disabled = false;
      }
    });
    field.focus();
    field.select();
  };

  const createFolderRow = (folder) => {
    const row = document.createElement('div');
    row.className = 'kodety-media-folder-row';
    row.dataset.folderId = folder.id;
    const open = document.createElement('button');
    open.type = 'button';
    open.dataset.kodetyMediaFolder = folder.id;
    open.classList.toggle('is-current', state.folder === String(folder.id));
    const name = document.createElement('span');
    name.textContent = folder.name;
    const count = document.createElement('strong');
    count.textContent = Number(folder.count || 0).toLocaleString(adminUiLocale());
    open.append(name, count);
    open.addEventListener('click', () => selectFolder(folder.id));

    row.append(open);
    if (config.canManageFolders) {
      const actions = document.createElement('span');
      actions.className = 'kodety-media-folder-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.textContent = '✎';
      rename.setAttribute('aria-label', `Renomear ${folder.name}`);
      rename.addEventListener('click', () => startFolderEdit(row, folder));
      const removeFolder = document.createElement('button');
      removeFolder.type = 'button';
      removeFolder.textContent = '×';
      removeFolder.setAttribute('aria-label', `Excluir ${folder.name}`);
      let confirmationTimer = 0;
      removeFolder.addEventListener('click', async () => {
        if (removeFolder.dataset.confirming !== 'true') {
          removeFolder.dataset.confirming = 'true';
          removeFolder.textContent = '!';
          removeFolder.setAttribute('aria-label', `Confirmar exclusão de ${folder.name}`);
          confirmationTimer = window.setTimeout(() => {
            removeFolder.dataset.confirming = 'false';
            removeFolder.textContent = '×';
            removeFolder.setAttribute('aria-label', `Excluir ${folder.name}`);
          }, 5000);
          return;
        }
        window.clearTimeout(confirmationTimer);
        removeFolder.disabled = true;
        try {
          await request(`${config.foldersEndpoint}/${folder.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedDeleteRevision: folder.deleteRevision }),
          });
          if (state.folder === String(folder.id)) state.folder = '';
          notify('Pasta excluída. Os arquivos continuam na biblioteca.');
          await loadFolders();
          refresh();
        } catch (error) {
          notify(error.message, true);
          removeFolder.disabled = false;
        }
      });
      actions.append(rename, removeFolder);
      row.append(actions);
    }
    return row;
  };

  const renderFolders = () => {
    folderItems.replaceChildren(...state.folders.map(createFolderRow));
    const selectedDestination = folderSelect.value;
    folderSelect.replaceChildren();
    const placeholder = new Option('Mover para…', '');
    const unfiled = new Option('Sem pasta', '0');
    folderSelect.append(placeholder, unfiled);
    state.folders.forEach((folder) => folderSelect.appendChild(new Option(folder.name, String(folder.id))));
    if (Array.from(folderSelect.options).some((option) => option.value === selectedDestination)) folderSelect.value = selectedDestination;
    folderList.querySelectorAll('[data-kodety-media-folder]').forEach((button) => {
      const current = button.dataset.kodetyMediaFolder === state.folder;
      button.classList.toggle('is-current', current);
      button.setAttribute('aria-pressed', String(current));
    });
    updateSelectionUi();
  };

  const loadFolders = async (preserveEdits = false) => {
    if (!config.foldersEndpoint) return;
    const edits = preserveEdits ? Array.from(folderItems.querySelectorAll('[data-folder-id]')).flatMap(row => {
      const field = row.querySelector('.kodety-media-folder-edit input');
      return field ? [{ id: Number(row.dataset.folderId), name: field.value }] : [];
    }) : [];
    try {
      const { body } = await request(config.foldersEndpoint);
      state.folders = Array.isArray(body) ? body : [];
      renderFolders();
      for (const edit of edits) {
        const folder = state.folders.find(candidate => Number(candidate.id) === edit.id);
        const row = folderItems.querySelector(`[data-folder-id="${edit.id}"]`);
        if (!folder || !row) continue;
        startFolderEdit(row, folder);
        row.querySelector('.kodety-media-folder-edit input').value = edit.name;
      }
    } catch (error) {
      notify('Não foi possível carregar as pastas.', true);
    }
  };

  const moveSelected = async () => {
    const ids = Array.from(state.selectedIds);
    if (!ids.length || folderSelect.value === '' || state.busy) return;
    setBusy(true, 'mutating');
    moveButton.textContent = 'Movendo…';
    try {
      const { body } = await request(config.moveEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids, folder_id: Number(folderSelect.value),
          expectedFolders: Object.fromEntries(ids.map(id => [id, state.items.find(item => Number(item.id) === id)?.kodety_folder_ids])),
        }),
      });
      const failed = Array.isArray(body.failed) ? body.failed.length : 0;
      notify(failed ? `${body.moved} movidos; ${failed} não puderam ser movidos.` : `${body.moved} ${body.moved === 1 ? 'arquivo movido' : 'arquivos movidos'}.`, failed > 0);
      folderSelect.value = '';
      clearSelection();
      await loadFolders();
      refresh();
    } catch (error) {
      notify(error.message, true);
    } finally {
      moveButton.textContent = 'Mover';
      setBusy(false, 'mutating');
    }
  };

  const load = async (append = false) => {
    if (append && state.busy) return;
    state.controller?.abort();
    const controller = new AbortController();
    const token = ++state.loadToken;
    state.controller = controller;
    setBusy(true, 'loading');
    try {
      const { body, response } = await request(listUrl(), { signal: controller.signal });
      if (token !== state.loadToken) return;
      const items = Array.isArray(body) ? body : [];
      state.items = append ? [...state.items, ...items] : items;
      state.total = Number(response.headers.get('X-WP-Total')) || items.length;
      state.totalPages = Number(response.headers.get('X-WP-TotalPages')) || 1;
      setEmptyState('empty');
      render(append);
    } catch (error) {
      if (error.name === 'AbortError' || token !== state.loadToken) return;
      if (append) state.page = Math.max(1, state.page - 1);
      else {
        state.items = [];
        state.total = 0;
        setEmptyState('error');
        render();
      }
      notify(error.message, true);
    } finally {
      if (token === state.loadToken) setBusy(false, 'loading');
    }
  };

  const refresh = () => {
    clearSelection();
    state.page = 1;
    state.items = [];
    load(false);
  };

  const addMeta = (label, value) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value || '—';
    row.append(term, description);
    meta.appendChild(row);
  };

  const resetDelete = () => {
    window.clearTimeout(deleteTimer);
    remove.dataset.confirming = 'false';
    remove.textContent = 'Excluir';
  };

  const openDetail = (item, source) => {
    state.selected = item;
    state.focusReturn = source || null;
    resetDelete();
    detailTitle.textContent = titleFor(item);
    preview.replaceChildren(cardPreview(item));
    form.elements.title.value = titleFor(item);
    form.elements.alt_text.value = item.alt_text || '';
    form.elements.caption.value = rawText(item.caption);
    form.elements.description.value = rawText(item.description);
    form.elements.source_url.value = item.source_url || '';
    form.querySelector('[name="alt_text"]').closest('label').hidden = item.media_type !== 'image';
    meta.replaceChildren();
    addMeta('Tipo', item.mime_type);
    addMeta('Tamanho', humanSize(item.media_details?.filesize));
    if (item.media_details?.width && item.media_details?.height) addMeta('Dimensões', `${item.media_details.width} × ${item.media_details.height}px`);
    const date = new Date(item.date);
    addMeta('Enviado em', Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(adminUiLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date));
    remove.hidden = !config.canDelete;
    replaceButton.hidden = !config.canUpload;
    const extension = String(item.source_url || '').split('?')[0].split('.').pop();
    replaceInput.accept = extension ? `.${extension.toLowerCase()}` : '';
    detailContent.scrollTop = 0;
    detail.hidden = false;
    detail.setAttribute('aria-hidden', 'false');
    document.body.classList.add('kodety-media-detail-open');
    window.requestAnimationFrame(() => detailPanel.focus());
  };

  const closeDetail = () => {
    detail.hidden = true;
    detail.setAttribute('aria-hidden', 'true');
    state.selected = null;
    document.body.classList.remove('kodety-media-detail-open');
    resetDelete();
    if (state.focusReturn && document.contains(state.focusReturn)) state.focusReturn.focus();
    state.focusReturn = null;
  };

  const updateSelected = async () => {
    if (!state.selected || save.disabled) return;
    save.disabled = true;
    remove.disabled = true;
    save.textContent = 'Salvando…';
    try {
      const { body } = await request(`${config.endpoint}/${state.selected.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.elements.title.value.trim(),
          alt_text: form.elements.alt_text.value.trim(),
          caption: form.elements.caption.value.trim(),
          description: form.elements.description.value.trim(),
        }),
      });
      state.selected = body;
      state.items = state.items.map((item) => item.id === body.id ? body : item);
      render();
      state.focusReturn = cardControlFor(body.id) || state.focusReturn;
      detailTitle.textContent = titleFor(body);
      notify('Alterações salvas.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      save.disabled = false;
      remove.disabled = false;
      save.textContent = 'Salvar alterações';
    }
  };

  const replaceSelected = async (file) => {
    if (!state.selected || !file || replaceButton.disabled) return;
    if (file.size > config.maxUploadSize) {
      notify(`Escolha um arquivo de até ${config.maxUploadLabel}.`, true);
      replaceInput.value = '';
      return;
    }
    replaceButton.disabled = true;
    save.disabled = true;
    remove.disabled = true;
    replaceButton.textContent = 'Substituindo…';
    try {
      const data = new FormData();
      data.append('file', file, file.name);
      const { body } = await request(`${config.replaceEndpoint}/${state.selected.id}`, { method: 'POST', body: data });
      if (body.id) state.cacheBust.set(Number(body.id), Date.now());
      if (body.source_url) {
        state.items = state.items.map((item) => item.id === body.id ? body : item);
        openDetail(body, state.focusReturn);
        render();
        state.focusReturn = cardControlFor(body.id) || state.focusReturn;
      } else {
        refresh();
        closeDetail();
      }
      notify('Arquivo substituído. A URL permanece a mesma.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      replaceButton.disabled = false;
      save.disabled = false;
      remove.disabled = false;
      replaceButton.textContent = 'Substituir arquivo';
      replaceInput.value = '';
    }
  };

  const deleteSelected = async () => {
    if (!state.selected || remove.disabled) return;
    if (remove.dataset.confirming !== 'true') {
      remove.dataset.confirming = 'true';
      remove.textContent = 'Confirmar exclusão';
      deleteTimer = window.setTimeout(resetDelete, 5000);
      return;
    }
    remove.disabled = true;
    save.disabled = true;
    try {
      await request(`${config.endpoint}/${state.selected.id}?force=true`, { method: 'DELETE' });
      closeDetail();
      notify('Arquivo excluído.');
      await loadFolders();
      refresh();
    } catch (error) {
      notify(error.message, true);
    } finally {
      remove.disabled = false;
      save.disabled = false;
    }
  };

  const deleteInBulk = async () => {
    const ids = Array.from(state.selectedIds);
    if (!ids.length || state.busy || !bulkDelete) return;
    if (bulkDelete.dataset.confirming !== 'true') {
      bulkDelete.dataset.confirming = 'true';
      bulkDelete.textContent = `Confirmar exclusão de ${ids.length}`;
      bulkDeleteTimer = window.setTimeout(resetBulkDelete, 6000);
      return;
    }

    window.clearTimeout(bulkDeleteTimer);
    setBusy(true, 'mutating');
    bulkDelete.textContent = 'Excluindo…';
    let cursor = 0;
    let deleted = 0;
    const failures = [];
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          await request(`${config.endpoint}/${id}?force=true`, { method: 'DELETE' });
          deleted++;
        } catch (error) {
          failures.push({ id, message: error.message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    if (state.selected && ids.includes(Number(state.selected.id)) && !failures.some((failure) => failure.id === Number(state.selected.id))) closeDetail();
    setBusy(false, 'mutating');
    clearSelection();
    if (failures.length) notify(`${deleted} excluídos; ${failures.length} não puderam ser removidos.`, true);
    else notify(`${deleted} ${deleted === 1 ? 'arquivo excluído' : 'arquivos excluídos'}.`);
    await loadFolders();
    refresh();
  };

  const uploadFiles = async (files) => {
    const candidates = Array.from(files || []);
    if (state.mutating) {
      notify('Aguarde a operação atual terminar antes de enviar novos arquivos.', true);
      input.value = '';
      return;
    }
    const accepted = candidates.filter((file) => file.size <= config.maxUploadSize);
    const oversized = candidates.length - accepted.length;
    if (!accepted.length) {
      notify(`Escolha arquivos de até ${config.maxUploadLabel}.`, true);
      input.value = '';
      return;
    }
    setBusy(true, 'mutating');
    let uploaded = 0;
    const failures = [];
    const uploadedIds = [];
    const uploadedFolders = {};
    // Capture the destination before the asynchronous loop so navigation while
    // uploading cannot split one selection across multiple folders.
    const destinationFolder = Number(state.folder) > 0 ? Number(state.folder) : 0;
    for (const file of accepted) {
      const data = new FormData();
      data.append('file', file, file.name);
      data.append('title', file.name.replace(/\.[^.]+$/, ''));
      try {
        const { body } = await request(config.endpoint, { method: 'POST', body: data });
        if (body.id) {
          uploadedIds.push(Number(body.id));
          uploadedFolders[body.id] = body.kodety_folder_ids;
        }
        uploaded++;
      } catch (error) {
        failures.push(file.name);
      }
    }
    let misplaced = 0;
    if (destinationFolder > 0 && uploadedIds.length) {
      try {
        const { body } = await request(config.moveEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: uploadedIds, folder_id: destinationFolder, expectedFolders: uploadedFolders }),
        });
        misplaced = Array.isArray(body.failed)
          ? body.failed.length
          : Math.max(0, uploadedIds.length - Number(body.moved || 0));
      } catch (error) {
        // The files exist even when folder assignment fails. Report that exact
        // partial result instead of claiming the upload itself failed.
        misplaced = uploadedIds.length;
      }
    }
    setBusy(false, 'mutating');
    input.value = '';
    if (misplaced) notify(`${uploaded} enviados; ${misplaced} não puderam ser colocados na pasta.`, true);
    else if (failures.length || oversized) notify(`${uploaded} enviados; ${failures.length + oversized} ignorados ou com erro.`, true);
    else notify(`${uploaded} ${uploaded === 1 ? 'arquivo enviado' : 'arquivos enviados'}.`);
    if (uploaded) { await loadFolders(); refresh(); }
  };

  root.querySelectorAll('[data-kodety-media-upload]').forEach((button) => button.addEventListener('click', () => input.click()));
  emptyAction.addEventListener('click', () => state.emptyMode === 'error' ? refresh() : input.click());
  input.addEventListener('change', () => uploadFiles(input.files));
  search.addEventListener('input', () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(refresh, 280); });
  type.addEventListener('change', () => {
    const activeStat = type.value || 'all';
    root.querySelectorAll('[data-kodety-media-stat]').forEach((button) => {
      const current = button.dataset.kodetyMediaStat === activeStat;
      button.classList.toggle('is-active', current);
      button.setAttribute('aria-pressed', String(current));
    });
    refresh();
  });
  order.addEventListener('change', refresh);
  more.addEventListener('click', () => { state.page++; load(true); });
  folderList.querySelectorAll(':scope > button[data-kodety-media-folder]').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.kodetyMediaFolder === state.folder),
    );
    button.addEventListener('click', () => selectFolder(button.dataset.kodetyMediaFolder));
  });
  newFolderButton.addEventListener('click', () => {
    folderForm.hidden = false;
    newFolderButton.disabled = true;
    folderName.focus();
  });
  reloadFoldersButton?.addEventListener('click', async () => {
    reloadFoldersButton.disabled = true;
    await loadFolders(true);
    refresh();
    reloadFoldersButton.disabled = false;
  });
  folderCancel.addEventListener('click', () => {
    folderForm.hidden = true;
    folderName.value = '';
    newFolderButton.disabled = false;
    newFolderButton.focus({ preventScroll: true });
  });
  folderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = folderName.value.trim();
    if (!name) return;
    const submit = folderForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const { body } = await request(config.foldersEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      folderName.value = '';
      folderForm.hidden = true;
      newFolderButton.disabled = false;
      notify('Pasta criada.');
      await loadFolders();
      selectFolder(body.id);
    } catch (error) {
      notify(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
  selectAll.addEventListener('change', () => {
    state.items.forEach((item) => {
      if (selectAll.checked) state.selectedIds.add(Number(item.id));
      else state.selectedIds.delete(Number(item.id));
    });
    updateSelectionUi();
  });
  clearSelectionButton.addEventListener('click', clearSelection);
  folderSelect.addEventListener('change', updateSelectionUi);
  moveButton.addEventListener('click', moveSelected);
  bulkDelete?.addEventListener('click', deleteInBulk);
  root.querySelectorAll('[data-kodety-media-stat]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('is-active')));
    button.addEventListener('click', () => {
      root.querySelectorAll('[data-kodety-media-stat]').forEach((candidate) => {
        const current = candidate === button;
        candidate.classList.toggle('is-active', current);
        candidate.setAttribute('aria-pressed', String(current));
      });
      type.value = button.dataset.kodetyMediaStat === 'all' ? '' : button.dataset.kodetyMediaStat;
      refresh();
    });
  });
  detail.querySelectorAll('[data-kodety-media-close]').forEach((button) => button.addEventListener('click', closeDetail));
  detail.querySelector('[data-kodety-media-copy]').addEventListener('click', async () => {
    const value = form.elements.source_url.value;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      } else {
        form.elements.source_url.select();
        copied = document.execCommand('copy');
      }
    } catch (error) {
      copied = false;
    }
    notify(copied ? 'URL copiada.' : 'Não foi possível copiar a URL.', !copied);
  });
  form.addEventListener('submit', (event) => { event.preventDefault(); updateSelected(); });
  save.addEventListener('click', updateSelected);
  remove.addEventListener('click', deleteSelected);
  replaceButton.addEventListener('click', () => replaceInput.click());
  replaceInput.addEventListener('change', () => replaceSelected(replaceInput.files?.[0]));
  document.addEventListener('keydown', (event) => {
    if (detail.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDetail();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = visibleDetailControls();
    if (!controls.length) {
      event.preventDefault();
      detailPanel.focus({ preventScroll: true });
      return;
    }
    const first = controls[0];
    const last = controls.at(-1);
    if (!detailPanel.contains(document.activeElement) || document.activeElement === detailPanel) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  });
  document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    state.dragDepth++;
    dropzone.hidden = false;
  });
  document.addEventListener('dragleave', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) dropzone.hidden = true;
  });
  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    state.dragDepth = 0;
    dropzone.hidden = true;
    uploadFiles(event.dataTransfer.files);
  });

  loadFolders();
  load();
})();
