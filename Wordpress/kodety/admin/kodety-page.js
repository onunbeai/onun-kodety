/* global document, window, DataTransfer, Node */

(() => {
  'use strict';

  const root = document.querySelector('.kodety-site-project');
  // Native validation must reveal fields before the browser tries to focus them.
  root?.addEventListener('invalid', (event) => {
    let disclosure = event.target.closest('details');
    while (disclosure && root.contains(disclosure)) {
      disclosure.open = true;
      disclosure = disclosure.parentElement?.closest('details');
    }
  }, true);

  // Match the native exclusive accordion behavior in older supported browsers.
  const importMethods = root?.querySelectorAll('details[name="kodety-import-method"]') || [];
  importMethods.forEach((method) => method.addEventListener('toggle', () => {
    if (method.open) importMethods.forEach((other) => { if (other !== method) other.open = false; });
  }));

  const optimizationForm = root?.querySelector('[data-kodety-optimization-form]');
  if (optimizationForm) {
    let optimizationBusy = false;
    const buttons = Array.from(optimizationForm.querySelectorAll('button[type="submit"]'));
    const originals = buttons.map((button) => ({ button, disabled: button.disabled, label: button.querySelector('span'), text: button.querySelector('span')?.textContent }));
    optimizationForm.addEventListener('submit', (event) => {
      if (optimizationBusy) { event.preventDefault(); return; }
      optimizationBusy = true;
      optimizationForm.setAttribute('aria-busy', 'true');
      // Disabled submitters are omitted by native form serialization. Preserve
      // the selected operation before disabling duplicate submissions.
      const operation = document.createElement('input');
      operation.type = 'hidden'; operation.name = 'kodety_optimization_operation';
      operation.value = event.submitter?.value === 'apply' ? 'apply' : 'save';
      operation.dataset.kodetyPendingOperation = 'true'; optimizationForm.append(operation);
      const label = event.submitter?.querySelector('span');
      if (label) label.textContent = operation.value === 'apply' ? 'Aplicando à versão publicada…' : 'Salvando…';
      buttons.forEach((button) => { button.disabled = true; });
    });
    window.addEventListener('pageshow', () => {
      optimizationBusy = false; optimizationForm.removeAttribute('aria-busy');
      optimizationForm.querySelectorAll('[data-kodety-pending-operation]').forEach((input) => input.remove());
      originals.forEach(({ button, disabled, label, text }) => { button.disabled = disabled; if (label) label.textContent = text; });
    });
  }
  const form = root?.querySelector('.kodety-import-form');
  const input = form?.querySelector('#kodety_zip');
  const dropzone = form?.querySelector('.kodety-import-dropzone');
  const emptyState = form?.querySelector('[data-kodety-file-empty]');
  const selection = form?.querySelector('[data-kodety-file-selection]');
  const fileName = form?.querySelector('[data-kodety-file-name]');
  const fileMeta = form?.querySelector('[data-kodety-file-meta]');
  const error = form?.querySelector('[data-kodety-file-error]');
  const submit = form?.querySelector('[data-kodety-import-submit]');
  const submitLabel = form?.querySelector('[data-kodety-submit-label]');
  const replacementAcknowledged = form?.querySelector('[data-kodety-replace-acknowledged]');
  const replacementPhrase = form?.querySelector('[data-kodety-replace-phrase]');
  const importTarget = form?.querySelector('[data-kodety-import-target]');
  const newProject = form?.querySelector('[data-kodety-import-new-project]');
  const newProjectName = form?.querySelector('[data-kodety-import-new-project-name]');
  const replacementWarning = form?.querySelector('[data-kodety-replacement-confirmation]');
  const replacementTitle = form?.querySelector('[data-kodety-replacement-title]');
  const replacementProject = form?.querySelector('[data-kodety-replacement-project]');
  const replacementFile = form?.querySelector('[data-kodety-replacement-file]');
  const replacementSize = form?.querySelector('[data-kodety-replacement-size]');
  const replacementUpdated = form?.querySelector('[data-kodety-replacement-updated]');
  const backupAction = form?.querySelector('[data-kodety-download-backup]');
  const backupLabel = form?.querySelector('[data-kodety-backup-label]');

  const adminUiLocale = () => window.kodetyAdminI18n?.locale
    || document.documentElement.dataset.kodetyUiLocale
    || document.documentElement.lang
    || 'pt-BR';

  const formatSize = (bytes) => {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB'];
    let size = value / 1024;
    let unit = units[0];
    for (let index = 1; size >= 1024 && index < units.length; index += 1) {
      size /= 1024;
      unit = units[index];
    }
    return `${new Intl.NumberFormat(adminUiLocale(), { maximumFractionDigits: 1 }).format(size)} ${unit}`;
  };

  if (form && input && dropzone && submit) {
    const maxSize = Number(form.dataset.maxSize || 0);
    const directMaxSize = Number(form.dataset.directMaxSize || 0);
    const chunkUrl = form.dataset.chunkUrl || '';
    const chunkNonce = form.dataset.chunkNonce || '';
    const chunkSize = 4 * 1024 * 1024;
    let hasExistingProject = form.dataset.hasExistingProject === '1';
    const confirmationPhrase = form.dataset.confirmPhrase || 'SUBSTITUIR';
    let validFile = false;

    const creatingProject = () => importTarget?.value === 'new-project';

    const destinationIsValid = () => {
      if (!creatingProject()) return true;
      return Boolean(newProjectName?.value.trim());
    };

    const replacementIsConfirmed = () =>
      !hasExistingProject ||
      (Boolean(replacementAcknowledged?.checked) &&
        replacementPhrase?.value.trim() === confirmationPhrase);

    const updateSubmitState = () => {
      submit.disabled = !validFile || !destinationIsValid() || !replacementIsConfirmed();
    };

    const updateDestination = (resetConfirmation = false) => {
      const option = importTarget?.selectedOptions?.[0] || null;
      // In the retired Agency mode this value came from the destination
      // select. Single-project installs have no select, so preserve the
      // server-rendered data-has-existing-project flag instead of treating a
      // missing control as a new/empty project.
      if (importTarget) hasExistingProject = option?.dataset.existing === '1';
      form.dataset.hasExistingProject = hasExistingProject ? '1' : '0';

      if (replacementWarning) replacementWarning.hidden = !hasExistingProject;
      if (replacementAcknowledged) {
        if (resetConfirmation) replacementAcknowledged.checked = false;
        replacementAcknowledged.disabled = !hasExistingProject;
        replacementAcknowledged.required = hasExistingProject;
      }
      if (replacementPhrase) {
        if (resetConfirmation) replacementPhrase.value = '';
        replacementPhrase.disabled = !hasExistingProject;
        replacementPhrase.required = hasExistingProject;
        replacementPhrase.setCustomValidity('');
      }

      const isNew = creatingProject();
      if (newProject) newProject.hidden = !isNew;
      if (newProjectName) {
        newProjectName.disabled = !isNew;
        newProjectName.required = isNew;
        newProjectName.setCustomValidity(
          isNew && !newProjectName.value.trim() ? 'Informe o nome do novo projeto.' : '',
        );
      }

      if (hasExistingProject && option) {
        const projectName = option.dataset.projectName || 'Projeto escolhido';
        const originalName = option.dataset.originalName || 'projeto.zip';
        const size = Number(option.dataset.size || 0);
        const updated = option.dataset.updated || '';
        if (replacementTitle)
          replacementTitle.textContent = `O projeto “${projectName}” será substituído pelo novo ZIP`;
        if (replacementProject) replacementProject.textContent = projectName;
        if (replacementFile) replacementFile.textContent = `· ${originalName}`;
        if (replacementSize) {
          replacementSize.hidden = size <= 0;
          replacementSize.textContent = size > 0 ? `· ${formatSize(size)}` : '';
        }
        if (replacementUpdated) {
          replacementUpdated.hidden = !updated;
          replacementUpdated.textContent = updated ? `· atualizado em ${updated}` : '';
        }
        if (backupAction && option.dataset.backupUrl) {
          backupAction.href = option.dataset.backupUrl;
        }
        if (backupLabel) backupLabel.textContent = `Baixar backup de ${projectName}`;
      }

      updateSubmitState();
    };

    const validate = (file) => {
      if (!file) return 'Selecione um arquivo ZIP para continuar.';
      if (!/\.zip$/i.test(file.name))
        return 'O projeto deve ser enviado em um arquivo com extensão .zip.';
      if (file.size <= 0) return 'O arquivo selecionado está vazio.';
      if (maxSize > 0 && file.size > maxSize) {
        return `O arquivo ultrapassa o limite de ${formatSize(maxSize)}.`;
      }
      return '';
    };

    const uploadId = () => {
      if (typeof window.crypto?.randomUUID === 'function') {
        return window.crypto.randomUUID().replaceAll('-', '');
      }
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    };

    const uploadLargeProject = async (file) => {
      const id = uploadId();
      let finalResult = null;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const end = Math.min(file.size, offset + chunkSize);
        const response = await window.fetch(chunkUrl, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-WP-Nonce': chunkNonce,
            'X-Kodety-Admin-Import': '1',
            'X-Kodety-Upload-Id': id,
            'X-Kodety-Upload-Offset': String(offset),
            'X-Kodety-Upload-Total': String(file.size),
            'X-Kodety-Original-Name': encodeURIComponent(file.name),
            'X-Kodety-Agency-Target': importTarget?.value || '',
            'X-Kodety-New-Project-Name': encodeURIComponent(newProjectName?.value.trim() || ''),
            'X-Kodety-Replace-Acknowledged': replacementIsConfirmed() ? '1' : '0',
            'X-Kodety-Replace-Phrase': encodeURIComponent(replacementPhrase?.value.trim() || ''),
          },
          body: file.slice(offset, end),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(result?.message || 'O servidor recusou uma parte do ZIP.');
        }
        finalResult = result;
        const percent = Math.max(1, Math.min(100, Math.round((end / file.size) * 100)));
        if (submitLabel) submitLabel.textContent = `Enviando projeto… ${percent}%`;
      }
      if (!finalResult?.complete || !finalResult?.redirectUrl) {
        throw new Error('O servidor não confirmou o ZIP completo.');
      }
      return finalResult;
    };

    const renderFile = (file) => {
      const message = validate(file);
      validFile = Boolean(file) && message === '';
      updateSubmitState();
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      dropzone.classList.toggle('has-file', Boolean(file));
      dropzone.classList.toggle('has-error', Boolean(message && file));

      if (file) {
        emptyState.hidden = true;
        selection.hidden = false;
        fileName.textContent = file.name;
        fileName.setAttribute('title', file.name);
        fileMeta.textContent = message || `${formatSize(file.size)} · pronto para validar`;
        if (creatingProject() && newProjectName) {
          const suggestedName = file.name.replace(/\.zip$/i, '').trim();
          const previousSuggestion = newProjectName.dataset.suggestedName || '';
          if (!newProjectName.value.trim() || newProjectName.value === previousSuggestion) {
            newProjectName.value = suggestedName;
            newProjectName.dataset.suggestedName = suggestedName;
            newProjectName.setCustomValidity(
              suggestedName ? '' : 'Informe o nome do novo projeto.',
            );
          }
        }
      } else {
        emptyState.hidden = false;
        selection.hidden = true;
        fileName.removeAttribute('title');
      }

      error.hidden = !message || !file;
      error.textContent = message;
    };

    input.addEventListener('change', () => renderFile(input.files?.[0] || null));
    importTarget?.addEventListener('change', () => {
      updateDestination(true);
      renderFile(input.files?.[0] || null);
    });
    newProjectName?.addEventListener('input', () => {
      newProjectName.dataset.suggestedName = '';
      newProjectName.setCustomValidity(
        creatingProject() && !newProjectName.value.trim()
          ? 'Informe o nome do novo projeto.'
          : '',
      );
      updateSubmitState();
    });
    replacementAcknowledged?.addEventListener('change', updateSubmitState);
    replacementPhrase?.addEventListener('input', () => {
      const confirmed = replacementPhrase.value.trim() === confirmationPhrase;
      replacementPhrase.setCustomValidity(
        confirmed ? '' : `Digite ${confirmationPhrase} exatamente como exibido.`,
      );
      updateSubmitState();
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
        event.preventDefault();
        dropzone.classList.add('is-dragging');
      });
    });

    dropzone.addEventListener('dragleave', (event) => {
      if (event.relatedTarget instanceof Node && dropzone.contains(event.relatedTarget)) return;
      dropzone.classList.remove('is-dragging');
    });

    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        renderFile(file);
      } catch {
        error.hidden = false;
        error.textContent = 'Use “Selecionar arquivo ZIP” para escolher este projeto.';
      }
    });

    form.addEventListener('submit', async (event) => {
      const file = input.files?.[0] || null;
      renderFile(file);
      if (!validFile) {
        event.preventDefault();
        input.focus();
        return;
      }
      if (!destinationIsValid()) {
        event.preventDefault();
        newProjectName?.focus();
        return;
      }
      if (!replacementIsConfirmed()) {
        event.preventDefault();
        error.hidden = false;
        const selectedProject =
          importTarget?.selectedOptions?.[0]?.dataset.projectName || 'o projeto escolhido';
        error.textContent =
          `Conclua as duas confirmações e digite ${confirmationPhrase} para substituir ${selectedProject}.`;
        if (!replacementAcknowledged?.checked) replacementAcknowledged?.focus();
        else replacementPhrase?.focus();
        return;
      }

      form.setAttribute('aria-busy', 'true');
      submit.disabled = true;
      const useChunkedUpload = Boolean(
        chunkUrl && chunkNonce && directMaxSize > 0 && file.size > directMaxSize,
      );
      if (!useChunkedUpload) {
        if (submitLabel) submitLabel.textContent = 'Validando e publicando…';
        return;
      }

      event.preventDefault();
      error.hidden = true;
      if (submitLabel) submitLabel.textContent = 'Preparando upload…';
      try {
        const result = await uploadLargeProject(file);
        window.location.assign(result.redirectUrl);
      } catch (uploadError) {
        form.removeAttribute('aria-busy');
        error.hidden = false;
        error.textContent = uploadError instanceof Error
          ? uploadError.message
          : 'Não foi possível enviar o projeto.';
        if (submitLabel) {
          submitLabel.textContent = submitLabel.dataset.defaultLabel || 'Importar e publicar no Builder';
        }
        updateSubmitState();
      }
    });

    updateDestination(false);
    renderFile(input.files?.[0] || null);
  }

  const decodeBase64Text = (encoded) => {
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  };

  const captureRenderedUrlImport = (documentHtml, token, delay, viewportWidth = 1440, lightweight = false) =>
    new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        iframe.remove();
      };
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        callback();
      };
      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow || !event.data || event.data.token !== token) return;
        if (event.data.type === 'kodety-rendered-capture' && typeof event.data.html === 'string') {
          finish(() => resolve(event.data.html));
        } else if (event.data.type === 'kodety-rendered-capture-error') {
          finish(() => reject(new Error(event.data.message || 'A página não pôde ser capturada depois de renderizar.')));
        }
      };
      const timeout = window.setTimeout(
        () => finish(() => reject(new Error(`A página não terminou de renderizar em ${delay + 40}s.`))),
        (delay + 40) * 1000,
      );
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      Object.assign(iframe.style, {
        position: 'fixed',
        left: '-20000px',
        top: '0',
        width: `${Math.max(320, Math.min(2600, Math.round(viewportWidth)))}px`,
        height: '900px',
        border: '0',
        opacity: '0',
        pointerEvents: 'none',
      });
      window.addEventListener('message', onMessage);
      if (lightweight) {
        const captureDocument = new DOMParser().parseFromString(documentHtml, 'text/html');
        captureDocument.documentElement.setAttribute('data-kodety-breakpoint-capture', '');
        iframe.srcdoc = `<!doctype html>\n${captureDocument.documentElement.outerHTML}`;
      } else {
        iframe.srcdoc = documentHtml;
      }
      document.body.appendChild(iframe);
    });

  const readUrlImportBreakpoints = (documentHtml) => {
    try {
      const documentNode = new DOMParser().parseFromString(documentHtml, 'text/html');
      const source = documentNode.querySelector('#__framer__breakpoints')?.textContent;
      const parsed = source ? JSON.parse(source) : [];
      return parsed.flatMap((item) => {
        const hash = typeof item?.hash === 'string' ? item.hash.trim() : '';
        const mediaQuery = typeof item?.mediaQuery === 'string' ? item.mediaQuery.trim() : '';
        return hash && mediaQuery ? [{ hash, mediaQuery }] : [];
      });
    } catch {
      return [];
    }
  };

  const urlImportQueryMatchesWidth = (query, width) => {
    const min = query.match(/min-width\s*:\s*([0-9.]+)px/i);
    const max = query.match(/max-width\s*:\s*([0-9.]+)px/i);
    return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
  };

  const urlImportBreakpointKind = (width) => (width < 600 ? 'mobile' : width < 1000 ? 'tablet' : 'desktop');

  const urlImportCaptureWidths = (breakpoints, selected, baseWidth = 1440) => {
    const candidates = breakpoints.map((item) => {
      const min = item.mediaQuery.match(/min-width\s*:\s*([0-9.]+)px/i);
      const max = item.mediaQuery.match(/max-width\s*:\s*([0-9.]+)px/i);
      const minimum = min ? Number(min[1]) : null;
      const maximum = max ? Number(max[1]) : null;
      if (minimum !== null && maximum !== null) return Math.round((minimum + maximum) / 2);
      if (minimum !== null) return Math.round(minimum + 64);
      if (maximum !== null) return Math.round(Math.max(320, maximum - 48));
      return baseWidth;
    });
    const stateAt = (width) => breakpoints
      .filter((item) => urlImportQueryMatchesWidth(item.mediaQuery, width))
      .map((item) => item.hash)
      .sort()
      .join('|');
    const seen = new Set([stateAt(baseWidth)]);
    return candidates.flatMap((width) => {
      const safeWidth = Math.max(320, Math.min(2600, width));
      if (!selected.includes(urlImportBreakpointKind(safeWidth))) return [];
      const state = stateAt(safeWidth);
      if (!state || seen.has(state)) return [];
      seen.add(state);
      return [safeWidth];
    }).slice(0, 4);
  };

  const captureUrlImportVariants = async (documentHtml, token, delay, selected, primaryWidth) => {
    const breakpoints = readUrlImportBreakpoints(documentHtml);
    const widths = urlImportCaptureWidths(breakpoints, selected, primaryWidth);
    const captures = [];
    for (const width of widths) {
      try {
        captures.push({
          width,
          html: await captureRenderedUrlImport(documentHtml, token, delay, width, true),
        });
      } catch {
        // A captura principal continua utilizável se uma variante pesada expirar.
      }
    }
    return { breakpoints, captures: captures.sort((left, right) => right.width - left.width) };
  };

  const mergeUrlImportVariants = (primaryHtml, breakpoints, captures, primaryWidth = 1440) => {
    if (!captures.length || !breakpoints.length) return primaryHtml;
    const parser = new DOMParser();
    const primary = parser.parseFromString(primaryHtml, 'text/html');
    const documents = [
      { width: primaryWidth, documentNode: primary },
      ...captures.map((capture) => ({
        width: capture.width,
        documentNode: parser.parseFromString(capture.html, 'text/html'),
      })),
    ];
    const hashes = new Set(breakpoints.map((item) => item.hash));
    const primaryRoots = Array.from(primary.querySelectorAll('[data-layout-template], [data-framer-root]'));
    const responsiveRoots = primaryRoots.map((root, rootIndex) => {
      const selectorClass = `kodety-framer-responsive-root-${rootIndex + 1}`;
      root.classList.add(selectorClass);
      const variants = [];
      const seen = new Set();
      documents.forEach(({ documentNode }) => {
        const candidate = documentNode.querySelectorAll('[data-layout-template], [data-framer-root]')[rootIndex];
        if (!candidate) return;
        const hash = Array.from(candidate.classList)
          .map((className) => (className.startsWith('framer-') ? className.slice(7) : ''))
          .find((value) => hashes.has(value));
        const breakpoint = hash ? breakpoints.find((item) => item.hash === hash) : null;
        if (!breakpoint || seen.has(breakpoint.hash)) return;
        seen.add(breakpoint.hash);
        variants.push({ hash: breakpoint.hash, query: breakpoint.mediaQuery });
      });
      return { selector: `.${selectorClass}`, variants };
    }).filter((item) => item.variants.length > 1);

    const primaryStyleSources = new Set(
      Array.from(primary.querySelectorAll('style')).map((style) => style.textContent || ''),
    );
    captures.forEach(({ width, html }) => {
      const variant = parser.parseFromString(html, 'text/html');
      const activeQueries = breakpoints
        .filter((item) => urlImportQueryMatchesWidth(item.mediaQuery, width))
        .map((item) => item.mediaQuery);
      variant.querySelectorAll(
        'style[data-framer-css-ssr], style[data-framer-css-ssr-minified], style[data-framer-breakpoint-css], style[data-framer-html-style], style[data-kodety-framer-interactions]',
      ).forEach((style) => {
        const source = style.textContent || '';
        if (!source.trim() || primaryStyleSources.has(source)) return;
        const interaction = style.hasAttribute('data-kodety-framer-interactions');
        const key = interaction ? `interaction:${activeQueries.join('&&')}:${source}` : source;
        if (primaryStyleSources.has(key)) return;
        primaryStyleSources.add(key);
        primaryStyleSources.add(source);
        const imported = primary.createElement('style');
        imported.setAttribute('data-kodety-framer-breakpoint-capture', String(width));
        if (interaction) imported.setAttribute('data-kodety-framer-interactions', '');
        imported.textContent = interaction && activeQueries.length
          ? `@media ${activeQueries.join(' and ')} {\n${source}\n}`
          : source;
        primary.head.appendChild(imported);
      });
    });

    if (responsiveRoots.length) {
      const meta = primary.querySelector('meta[name="kodety-framer-import"]') || primary.createElement('meta');
      let manifest = { version: 1, source: 'framer-runtime' };
      try {
        if (meta.getAttribute('content')) manifest = JSON.parse(decodeURIComponent(meta.getAttribute('content')));
      } catch {
        // Mantém um manifesto mínimo válido.
      }
      const embedded = manifest.embedded && typeof manifest.embedded === 'object' ? manifest.embedded : {};
      manifest.embedded = {
        ...embedded,
        responsiveRoots,
        captureWidths: documents.map((item) => item.width),
      };
      meta.setAttribute('name', 'kodety-framer-import');
      meta.setAttribute('content', encodeURIComponent(JSON.stringify(manifest)));
      if (!meta.isConnected) primary.head.appendChild(meta);
    }
    return `<!doctype html>\n${primary.documentElement.outerHTML}`;
  };

  const urlImportForm = root?.querySelector('.kodety-import-url__form');
  if (urlImportForm) {
    const platformInputs = Array.from(urlImportForm.querySelectorAll('input[name="kodety_platform"]'));
    const framerMode = urlImportForm.querySelector('[data-kodety-url-framer-mode]');
    const elementorMode = urlImportForm.querySelector('[data-kodety-url-elementor-mode]');
    const elementorModeInputs = Array.from(
      urlImportForm.querySelectorAll('input[name="kodety_elementor_mode"]'),
    );
    const elementorModeError = urlImportForm.querySelector('[data-kodety-url-elementor-mode-error]');
    const captureDelay = urlImportForm.querySelector('[data-kodety-url-capture-delay]');
    const breakpointGroup = urlImportForm.querySelector('[data-kodety-url-breakpoints]');
    const breakpointInputs = Array.from(urlImportForm.querySelectorAll('input[name="kodety_breakpoints[]"]'));
    const breakpointError = urlImportForm.querySelector('[data-kodety-url-breakpoint-error]');
    const renderedHtml = urlImportForm.querySelector('[data-kodety-url-rendered-html]');
    const capturedSource = urlImportForm.querySelector('[data-kodety-url-captured-source]');
    const sourceUrlInput = urlImportForm.querySelector('input[name="kodety_url"]');
    const sourceUrlLabel = urlImportForm.querySelector('[data-kodety-url-field-label]');
    const sourceUrlHint = urlImportForm.querySelector('[data-kodety-url-primary-hint]');
    const submitButton = urlImportForm.querySelector('[data-kodety-url-import-submit]');
    const submitLabel = urlImportForm.querySelector('[data-kodety-url-import-submit-label]');
    const status = urlImportForm.querySelector('[data-kodety-url-import-status]');
    const statusLabel = status?.querySelector(':scope > span:last-child');
    const defaultSubmitLabel = submitLabel?.textContent || 'Importar e publicar';
    const defaultStatus = statusLabel?.textContent || '';
    let importRequestGeneration = 0;
    let importAbortController = null;

    const selectedPlatform = () => platformInputs.find((inputNode) => inputNode.checked)?.value || 'auto';
    const effectivePlatform = () => selectedPlatform() === 'auto'
      ? urlImportForm.dataset.detectedPlatform || 'auto'
      : selectedPlatform();
    const selectedElementorMode = () =>
      elementorModeInputs.find((inputNode) => inputNode.checked)?.value
        || 'visual';
    const elementorModeIsStructured = () =>
      ['native', 'structured'].includes(selectedElementorMode());
    const selectedDelay = () => Number(urlImportForm.querySelector('input[name="kodety_capture_delay"]:checked')?.value || 0);
    const selectedBreakpoints = () => breakpointInputs.filter((inputNode) => inputNode.checked).map((inputNode) => inputNode.value);
    const elementorIdleCopy = () => elementorModeIsStructured()
      ? {
          button: 'Converter para rascunho',
          status: 'Os elementos compatíveis do Elementor serão convertidos para um rascunho Onun Kodety. Nenhuma alteração será publicada.',
        }
      : {
          button: 'Importar página publicada',
          status: 'HTML, CSS, JavaScript, assets e widgets do Elementor serão copiados para um rascunho. Nenhuma alteração será publicada.',
        };
    const idleCopy = () => effectivePlatform() === 'elementor'
      ? elementorIdleCopy()
      : { button: defaultSubmitLabel, status: defaultStatus };
    const setImportWorking = (
      working,
      buttonText = defaultSubmitLabel,
      statusText = defaultStatus,
      statusState = '',
    ) => {
      urlImportForm.setAttribute('aria-busy', working ? 'true' : 'false');
      if (submitButton) submitButton.disabled = working;
      if (submitLabel) submitLabel.textContent = buttonText;
      if (statusLabel) statusLabel.textContent = statusText;
      status?.classList.toggle('is-error', statusState === 'error');
      status?.classList.toggle('is-draft', statusState === 'draft');
    };
    const validateElementorMode = () => {
      const required = effectivePlatform() === 'elementor';
      const availableInputs = elementorModeInputs.filter((inputNode) => !inputNode.disabled);
      const valid = !required || availableInputs.some((inputNode) => inputNode.checked);
      elementorModeInputs.forEach((inputNode) => inputNode.setCustomValidity(''));
      availableInputs[0]?.setCustomValidity(valid ? '' : 'Escolha como importar o site do Elementor.');
      if (elementorModeError) elementorModeError.hidden = valid;
      return valid;
    };
    const validateBreakpoints = () => {
      const required = ['auto', 'framer'].includes(selectedPlatform()) && selectedDelay() > 0;
      const valid = !required || selectedBreakpoints().length > 0;
      if (breakpointInputs[0]) breakpointInputs[0].setCustomValidity(valid ? '' : 'Selecione pelo menos um breakpoint.');
      if (breakpointError) breakpointError.hidden = valid;
      return valid;
    };
    const updateUrlImportOptions = () => {
      const platform = effectivePlatform();
      const supportsCapture = ['auto', 'framer'].includes(platform);
      if (framerMode) framerMode.hidden = platform !== 'framer';
      if (elementorMode) elementorMode.hidden = platform !== 'elementor';
      elementorModeInputs.forEach((inputNode) => {
        inputNode.disabled = platform !== 'elementor';
        inputNode.required = false;
      });
      const availableElementorModes = elementorModeInputs.filter((inputNode) => !inputNode.disabled);
      if (platform === 'elementor' && availableElementorModes[0]) availableElementorModes[0].required = true;
      if (captureDelay) captureDelay.hidden = !supportsCapture;
      if (breakpointGroup) breakpointGroup.hidden = !supportsCapture || selectedDelay() === 0;
      breakpointInputs.forEach((inputNode) => { inputNode.disabled = !supportsCapture || selectedDelay() === 0; });
      if (sourceUrlLabel) {
        sourceUrlLabel.textContent = platform === 'elementor'
          ? 'URL da página publicada no WordPress/Elementor'
          : 'URL do site ou do ZIP';
      }
      if (sourceUrlInput) {
        sourceUrlInput.placeholder = platform === 'elementor'
          ? 'https://seusite.com/pagina-elementor/'
          : 'https://seusite.com';
      }
      if (sourceUrlHint) {
        sourceUrlHint.textContent = platform === 'elementor'
          ? 'O Onun Kodety baixa o HTML publicado, CSS, JavaScript, imagens, fontes e arquivos usados pelos widgets. O resultado abre como rascunho no Builder.'
          : 'O processamento acontece fora do editor. CSS, imagens, fontes e mídias encontradas são salvos no projeto antes da publicação.';
      }
      validateBreakpoints();
      validateElementorMode();
      if (urlImportForm.getAttribute('aria-busy') !== 'true') {
        const copy = idleCopy();
        setImportWorking(false, copy.button, copy.status, platform === 'elementor' ? 'draft' : '');
      }
    };
    const invalidateUrlImportRequest = () => {
      importRequestGeneration += 1;
      importAbortController?.abort();
      importAbortController = null;
      urlImportForm.dataset.captureReady = '';
      urlImportForm.dataset.detectedPlatform = '';
      if (renderedHtml) renderedHtml.value = '';
      if (capturedSource) capturedSource.value = '';
      setImportWorking(false);
    };

    platformInputs.forEach((inputNode) => inputNode.addEventListener('change', () => {
      invalidateUrlImportRequest();
      updateUrlImportOptions();
    }));
    sourceUrlInput?.addEventListener('input', () => {
      const detectedPlatform = urlImportForm.dataset.detectedPlatform || '';
      if (detectedPlatform !== '') {
        const detectedInput = platformInputs.find((inputNode) => inputNode.value === detectedPlatform);
        const autoInput = platformInputs.find((inputNode) => inputNode.value === 'auto');
        if (detectedInput?.checked && autoInput) autoInput.checked = true;
      }
      invalidateUrlImportRequest();
      updateUrlImportOptions();
    });
    [...elementorModeInputs, ...breakpointInputs, ...urlImportForm.querySelectorAll('input[name="kodety_capture_delay"]')]
      .forEach((inputNode) => inputNode.addEventListener('change', updateUrlImportOptions));

    urlImportForm.addEventListener('submit', async (event) => {
      const sourceUrl = sourceUrlInput?.value.trim() || '';
      sourceUrlInput?.setCustomValidity('');
      if (urlImportForm.dataset.captureReady === '1') {
        if (effectivePlatform() === 'elementor') {
          setImportWorking(
            true,
            elementorModeIsStructured() ? 'Convertendo…' : 'Criando rascunho…',
            elementorModeIsStructured()
              ? 'Convertendo os elementos compatíveis do Elementor sem alterar o site publicado…'
              : 'Salvando HTML, CSS, JavaScript, assets e widgets do Elementor sem alterar o site publicado…',
            'draft',
          );
        } else {
          setImportWorking(true, 'Publicando…', 'Empacotando os arquivos e publicando o projeto…');
        }
        return;
      }
      if (!validateBreakpoints()) {
        event.preventDefault();
        breakpointInputs[0]?.reportValidity();
        return;
      }
      if (!validateElementorMode()) {
        event.preventDefault();
        elementorModeInputs.find((inputNode) => !inputNode.disabled)?.reportValidity();
        return;
      }
      const platform = selectedPlatform();
      const delay = selectedDelay();
      if (platform !== 'auto' && (platform !== 'framer' || delay === 0)) {
        if (effectivePlatform() === 'elementor') {
          setImportWorking(
            true,
            elementorModeIsStructured() ? 'Convertendo…' : 'Criando rascunho…',
            elementorModeIsStructured()
              ? 'Convertendo os elementos compatíveis do Elementor para um rascunho Onun Kodety…'
              : 'Baixando HTML, CSS, JavaScript, assets e widgets do Elementor para um rascunho Onun Kodety…',
            'draft',
          );
        } else {
          setImportWorking(true, 'Importando…', 'Baixando, empacotando e publicando o site…');
        }
        return;
      }

      event.preventDefault();
      const endpoint = urlImportForm.dataset.importRestUrl || '';
      const nonce = urlImportForm.dataset.importRestNonce || '';
      const mode = urlImportForm.querySelector('input[name="kodety_framer_mode"]:checked')?.value || 'animated';
      if (!endpoint || !nonce) {
        const copy = idleCopy();
        setImportWorking(false, copy.button, 'A captura avançada não está disponível. Recarregue a página e tente novamente.', 'error');
        return;
      }

      const requestGeneration = ++importRequestGeneration;
      importAbortController?.abort();
      const requestController = new AbortController();
      importAbortController = requestController;
      const requestIsCurrent = () => requestGeneration === importRequestGeneration
        && (sourceUrlInput?.value.trim() || '') === sourceUrl;
      setImportWorking(true, 'Analisando…', 'Detectando a plataforma e preparando a captura isolada…');
      try {
        const token = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replaceAll('-', '_');
        const response = await window.fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': nonce,
          },
          body: JSON.stringify({
            url: sourceUrl,
            captureDelay: delay,
            captureToken: token,
            platform,
            framerMode: mode,
            elementorMode: selectedElementorMode(),
          }),
          signal: requestController.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!requestIsCurrent()) return;
        if (!response.ok || !payload?.contentBase64) {
          throw new Error(payload?.message || 'Não foi possível analisar o site desta URL.');
        }
        const detectedPlatform = String(payload.platform || '').toLowerCase();
        if (platform === 'auto' && ['framer', 'webflow', 'code', 'elementor'].includes(detectedPlatform)) {
          urlImportForm.dataset.detectedPlatform = detectedPlatform;
          const detectedInput = platformInputs.find((inputNode) => inputNode.value === detectedPlatform);
          if (detectedInput) detectedInput.checked = true;
          updateUrlImportOptions();
        }
        if (payload.kind === 'capture') {
          const captureDocument = decodeBase64Text(payload.contentBase64);
          const selected = selectedBreakpoints();
          const primaryWidth = selected.includes('desktop') ? 1440 : selected.includes('tablet') ? 820 : 390;
          setImportWorking(true, 'Capturando…', `Renderizando o site Framer por ${delay}s e coletando interações…`);
          const primaryHtml = await captureRenderedUrlImport(captureDocument, token, delay, primaryWidth);
          if (!requestIsCurrent()) return;
          const responsive = await captureUrlImportVariants(captureDocument, token, delay, selected, primaryWidth);
          if (!requestIsCurrent()) return;
          if (renderedHtml) renderedHtml.value = mergeUrlImportVariants(
            primaryHtml,
            responsive.breakpoints,
            responsive.captures,
            primaryWidth,
          );
          if (capturedSource) capturedSource.value = payload.sourceUrl || sourceUrl;
        }
        urlImportForm.dataset.captureReady = '1';
        if (detectedPlatform === 'elementor') {
          updateUrlImportOptions();
          const copy = elementorIdleCopy();
          setImportWorking(
            false,
            copy.button,
            'Elementor detectado. A página publicada completa preserva HTML, CSS, JavaScript e widgets em um rascunho.',
            'draft',
          );
          return;
        }
        urlImportForm.requestSubmit();
      } catch (error) {
        if (error?.name === 'AbortError' || requestGeneration !== importRequestGeneration) return;
        urlImportForm.dataset.captureReady = '';
        const copy = idleCopy();
        setImportWorking(
          false,
          copy.button,
          error instanceof Error ? error.message : 'Não foi possível capturar o site.',
          'error',
        );
      } finally {
        if (requestGeneration === importRequestGeneration && importAbortController === requestController) {
          importAbortController = null;
        }
      }
    });

    updateUrlImportOptions();
  }

  const brandLogoInput = root?.querySelector('#kodety_brand_logo');
  const brandLogoPreview = root?.querySelector('[data-kodety-brand-logo-preview]');
  const brandLogoStatus = root?.querySelector('[data-kodety-brand-logo-status]');
  const brandLogoAction = root?.querySelector('[data-kodety-brand-logo-action]');
  const brandLogoRemove = root?.querySelector('[data-kodety-brand-logo-remove]');
  const brandForm = root?.querySelector('.kodety-brand-settings__form');
  const kodetyLogoChoice = brandForm?.querySelector(
    'input[name="kodety_editor_corner_icon"][value="kodety-logo"]',
  );
  const clientLogoChoice = brandForm?.querySelector(
    'input[name="kodety_editor_corner_icon"][value="client-logo"]',
  );
  let brandLogoObjectUrl = '';

  const setBrandLogoStatus = (message, state) => {
    if (!brandLogoStatus) return;
    brandLogoStatus.textContent = message;
    brandLogoStatus.classList.remove('is-empty', 'is-saved', 'is-selected', 'is-error', 'is-removing');
    brandLogoStatus.classList.add(state);
  };

  if (brandLogoInput && brandLogoPreview) {
    brandLogoInput.addEventListener('change', () => {
      const file = brandLogoInput.files?.[0] || null;
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        brandLogoInput.value = '';
        setBrandLogoStatus('Formato inválido. Use PNG, JPG ou WebP.', 'is-error');
        return;
      }
      if (brandLogoObjectUrl) URL.revokeObjectURL(brandLogoObjectUrl);
      brandLogoObjectUrl = URL.createObjectURL(file);
      const image = document.createElement('img');
      image.src = brandLogoObjectUrl;
      image.alt = '';
      brandLogoPreview.replaceChildren(image);
      brandLogoPreview.classList.add('has-image');
      if (brandLogoAction) brandLogoAction.textContent = 'Trocar seleção';
      if (brandLogoRemove) brandLogoRemove.checked = false;
      if (clientLogoChoice) clientLogoChoice.checked = true;
      setBrandLogoStatus(`${file.name} · ${formatSize(file.size)} · pronta para salvar`, 'is-selected');
    });
  }

  brandLogoRemove?.addEventListener('change', () => {
    if (brandLogoRemove.checked) {
      if (brandLogoInput) brandLogoInput.value = '';
      if (kodetyLogoChoice) kodetyLogoChoice.checked = true;
      setBrandLogoStatus('A logo será removida ao salvar', 'is-removing');
    } else {
      setBrandLogoStatus('Logo salva e disponível na interface', 'is-saved');
    }
  });

  brandForm?.addEventListener('submit', (event) => {
    const selectedClientLogo = Boolean(clientLogoChoice?.checked);
    const hasNewLogo = Boolean(brandLogoInput?.files?.[0]);
    const removingLogo = Boolean(brandLogoRemove?.checked);
    const hasSavedLogo = brandLogoStatus?.classList.contains('is-saved');
    if (selectedClientLogo && !hasNewLogo && (!hasSavedLogo || removingLogo)) {
      event.preventDefault();
      setBrandLogoStatus('Envie uma logo antes de selecionar Logo do cliente.', 'is-error');
      brandLogoInput?.focus();
    }
  });

  const loginImageInput = root?.querySelector('#kodety_login_image');
  const loginImagePreview = root?.querySelector('[data-kodety-login-image-preview]');
  const loginImageStatus = root?.querySelector('[data-kodety-login-image-status]');
  const loginImageAction = root?.querySelector('[data-kodety-login-image-action]');
  const loginImageRemove = root?.querySelector('[data-kodety-login-image-remove]');
  const loginImageMaxBytes = 1024 * 1024;
  const loginImageMaxPixels = 12 * 1000 * 1000;
  const loginImageMaxDimension = 4096;
  const loginImageRecommendedRatio = 30 / 23;
  const savedLoginImagePreviewNodes = loginImagePreview
    ? Array.from(loginImagePreview.childNodes, (node) => node.cloneNode(true))
    : [];
  const savedLoginImageHasImage = Boolean(loginImagePreview?.classList.contains('has-image'));
  const savedLoginImageAction = loginImageAction?.textContent || 'Escolher imagem';
  const savedLoginImageStatus = loginImageStatus?.textContent || 'Nenhuma imagem personalizada';
  const savedLoginImageStatusState = [
    'is-empty',
    'is-saved',
    'is-selected',
    'is-warning',
    'is-error',
    'is-removing',
  ].find((state) => loginImageStatus?.classList.contains(state)) || 'is-empty';
  let loginImageObjectUrl = '';

  const revokeLoginImageObjectUrl = () => {
    if (!loginImageObjectUrl) return;
    URL.revokeObjectURL(loginImageObjectUrl);
    loginImageObjectUrl = '';
  };

  const restoreSavedLoginImagePreview = () => {
    if (!loginImagePreview) return;
    loginImagePreview.replaceChildren(
      ...savedLoginImagePreviewNodes.map((node) => node.cloneNode(true)),
    );
    loginImagePreview.classList.toggle('has-image', savedLoginImageHasImage);
    loginImagePreview.classList.remove('is-removing');
    if (loginImageAction) loginImageAction.textContent = savedLoginImageAction;
  };

  const discardLoginImageSelection = () => {
    if (loginImageInput) loginImageInput.value = '';
    revokeLoginImageObjectUrl();
    restoreSavedLoginImagePreview();
  };

  const setLoginImageStatus = (message, state) => {
    if (!loginImageStatus) return;
    loginImageStatus.textContent = message;
    loginImageStatus.classList.remove(
      'is-empty',
      'is-saved',
      'is-selected',
      'is-warning',
      'is-error',
      'is-removing',
    );
    loginImageStatus.classList.add(state);
  };

  if (loginImageInput && loginImagePreview) {
    loginImageInput.addEventListener('change', () => {
      const file = loginImageInput.files?.[0] || null;
      if (!file) return;
      if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        discardLoginImageSelection();
        setLoginImageStatus('Formato inválido. Use PNG, JPG ou WebP.', 'is-error');
        return;
      }
      if (file.size > loginImageMaxBytes) {
        discardLoginImageSelection();
        setLoginImageStatus('A imagem deve ter no máximo 1 MB.', 'is-error');
        return;
      }

      revokeLoginImageObjectUrl();
      loginImageObjectUrl = URL.createObjectURL(file);
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('load', () => {
        if (image.naturalWidth > loginImageMaxDimension || image.naturalHeight > loginImageMaxDimension) {
          discardLoginImageSelection();
          setLoginImageStatus('A imagem deve ter no máximo 4096 px por lado.', 'is-error');
          return;
        }
        if (image.naturalWidth * image.naturalHeight > loginImageMaxPixels) {
          discardLoginImageSelection();
          setLoginImageStatus('A imagem deve ter no máximo 12 megapixels.', 'is-error');
          return;
        }
        const ratioDelta = Math.abs(image.naturalWidth / image.naturalHeight - loginImageRecommendedRatio)
          / loginImageRecommendedRatio;
        loginImagePreview.replaceChildren(image);
        loginImagePreview.classList.add('has-image');
        loginImagePreview.classList.remove('is-removing');
        if (loginImageAction) loginImageAction.textContent = 'Trocar imagem';
        if (loginImageRemove) loginImageRemove.checked = false;
        if (ratioDelta > 0.03) {
          setLoginImageStatus(
            'A imagem não usa a proporção recomendada de 30:23; ela será recortada para preencher a área.',
            'is-warning',
          );
          return;
        }
        setLoginImageStatus(
          `${file.name} · ${formatSize(file.size)} · pronta para salvar`,
          'is-selected',
        );
      }, { once: true });
      image.addEventListener('error', () => {
        discardLoginImageSelection();
        setLoginImageStatus('Não foi possível ler a imagem selecionada.', 'is-error');
      }, { once: true });
      image.src = loginImageObjectUrl;
    });
  }

  loginImageRemove?.addEventListener('change', () => {
    if (loginImageRemove.checked) {
      discardLoginImageSelection();
      loginImagePreview?.classList.add('is-removing');
      if (loginImageAction) loginImageAction.textContent = 'Escolher imagem';
      setLoginImageStatus('A imagem será removida ao salvar', 'is-removing');
    } else {
      restoreSavedLoginImagePreview();
      setLoginImageStatus(savedLoginImageStatus, savedLoginImageStatusState);
    }
  });

  window.addEventListener('pagehide', () => {
    if (brandLogoObjectUrl) URL.revokeObjectURL(brandLogoObjectUrl);
    revokeLoginImageObjectUrl();
  }, { once: true });

  const accentForm = root?.querySelector('[data-kodety-interface-accent-form]');
  const accentInput = accentForm?.querySelector('[data-kodety-interface-accent-input]');
  const accentPreview = accentForm?.querySelector('[data-kodety-interface-accent-preview]');
  const accentValue = accentForm?.querySelector('[data-kodety-interface-accent-value]');
  const accentStatus = accentForm?.querySelector('[data-kodety-interface-accent-status]');
  const accentSubmit = accentForm?.querySelector('[data-kodety-interface-accent-submit]');
  const interfacePreview = root?.querySelector('[data-kodety-interface-preview]');
  const accentPresets = accentForm?.querySelectorAll('[data-kodety-accent-preset]') || [];

  const blackTextContrast = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0;
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
      0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    return (luminance + 0.05) / 0.05;
  };

  const renderAccent = () => {
    if (!accentInput) return false;
    const color = accentInput.value.toLowerCase();
    const contrast = blackTextContrast(color);
    const valid = contrast >= 4.5;
    accentInput.setCustomValidity(
      valid ? '' : 'Escolha uma cor com contraste mínimo de 4,5:1 para texto preto.',
    );
    if (accentPreview) {
      accentPreview.style.background = color;
      accentPreview.style.color = '#000';
    }
    if (accentValue) accentValue.textContent = color.toUpperCase();
    interfacePreview?.style.setProperty('--preview-accent', color);
    accentPresets.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kodetyAccentPreset === color)));
    if (accentStatus) {
      accentStatus.textContent = valid
        ? `Contraste ${contrast.toFixed(2)}:1 — aprovado para texto preto.`
        : `Contraste ${contrast.toFixed(2)}:1 — escolha uma cor mais clara.`;
      accentStatus.classList.toggle('is-valid', valid);
      accentStatus.classList.toggle('is-invalid', !valid);
    }
    if (accentSubmit) accentSubmit.disabled = !valid;
    return valid;
  };

  accentPresets.forEach(button => button.addEventListener('click', () => {
    if (!accentInput) return;
    accentInput.value = button.dataset.kodetyAccentPreset;
    renderAccent();
  }));
  accentInput?.addEventListener('input', renderAccent);
  accentInput?.addEventListener('change', renderAccent);
  accentForm?.addEventListener('submit', (event) => {
    if (!renderAccent()) {
      event.preventDefault();
      accentInput?.reportValidity();
      accentInput?.focus();
      return;
    }
    accentForm.setAttribute('aria-busy', 'true');
    if (accentSubmit) accentSubmit.disabled = true;
  });
  renderAccent();

  const securityForm = root?.querySelector('[data-kodety-security-form]');
  const securitySlug = securityForm?.querySelector('[data-kodety-security-slug]');
  const securityLoginUrl = securityForm?.querySelector('[data-kodety-security-login-url]');
  const generateSecuritySlug = securityForm?.querySelector('[data-kodety-generate-security-slug]');

  const renderSecurityLoginUrl = () => {
    if (!securityLoginUrl || !securitySlug) return;
    const base = securityForm?.dataset.loginBase || '';
    securityLoginUrl.textContent = securitySlug.value.trim()
      ? `${base}${securitySlug.value.trim().replace(/^\/+|\/+$/g, '')}`
      : `${base}wp-login.php`;
  };

  generateSecuritySlug?.addEventListener('click', () => {
    if (!securitySlug || !window.crypto?.getRandomValues) return;
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const random = new Uint8Array(14);
    window.crypto.getRandomValues(random);
    securitySlug.value = `acesso-${Array.from(random, (value) => alphabet[value % alphabet.length]).join('')}`;
    securitySlug.dispatchEvent(new Event('input', { bubbles: true }));
    securitySlug.focus();
    securitySlug.select();
  });
  securitySlug?.addEventListener('input', renderSecurityLoginUrl);
  securityForm?.addEventListener('submit', () => {
    securityForm.setAttribute('aria-busy', 'true');
    const button = securityForm.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
  });
  renderSecurityLoginUrl();

  const extensionUploadForm = root?.querySelector('[data-kodety-extension-upload-form]');
  const extensionFile = extensionUploadForm?.querySelector('[data-kodety-extension-file]');
  const extensionFileLabel = extensionUploadForm?.querySelector(
    '[data-kodety-extension-file-label]',
  );
  const extensionInstall = extensionUploadForm?.querySelector('[data-kodety-extension-install]');
  const extensionInstallLabel = extensionUploadForm?.querySelector(
    '[data-kodety-extension-install-label]',
  );
  const extensionUploadError = extensionUploadForm?.querySelector(
    '[data-kodety-extension-upload-error]',
  );
  const extensionFeedback = root?.querySelector('[data-kodety-extension-feedback]');

  const announceExtension = (message) => {
    if (!extensionFeedback) return;
    extensionFeedback.hidden = false;
    extensionFeedback.textContent = message;
  };

  const renderExtensionFile = () => {
    if (!extensionFile || !extensionInstall) return false;
    const file = extensionFile.files?.[0] || null;
    const maxSize = Number(extensionUploadForm?.dataset.maxSize || 0);
    let message = '';
    if (file && !/\.zip$/i.test(file.name)) message = 'Use um arquivo ZIP de extensão ou bundle.';
    else if (file && file.size <= 0) message = 'O arquivo selecionado está vazio.';
    else if (file && maxSize > 0 && file.size > maxSize) {
      message = `O arquivo ultrapassa o limite de ${formatSize(maxSize)}.`;
    }

    extensionFile.setCustomValidity(message);
    extensionFile.setAttribute('aria-invalid', message ? 'true' : 'false');
    extensionInstall.disabled = !file || Boolean(message);
    if (extensionFileLabel) {
      extensionFileLabel.textContent = file
        ? `${file.name} · ${formatSize(file.size)}`
        : 'Nenhum arquivo selecionado';
      extensionFileLabel.setAttribute('title', file?.name || '');
    }
    if (extensionUploadError) {
      extensionUploadError.hidden = !message;
      extensionUploadError.textContent = message;
    }
    return Boolean(file) && !message;
  };

  extensionFile?.addEventListener('change', renderExtensionFile);
  extensionUploadForm?.addEventListener('submit', (event) => {
    if (!renderExtensionFile()) {
      event.preventDefault();
      extensionFile?.reportValidity();
      extensionFile?.focus();
      return;
    }
    extensionUploadForm.setAttribute('aria-busy', 'true');
    if (extensionInstall) extensionInstall.disabled = true;
    if (extensionInstallLabel) extensionInstallLabel.textContent = 'Instalando e validando…';
    announceExtension('Upload iniciado. O pacote está sendo validado e instalado.');
  });

  root?.querySelectorAll('[data-kodety-extension-upload-for]').forEach((button) => {
    button.addEventListener('click', () => {
      extensionFile?.click();
    });
  });

  root?.querySelectorAll('[data-kodety-extension-action]').forEach((actionForm) => {
    actionForm.addEventListener('submit', (event) => {
      const operation = actionForm.dataset.extensionOperation || '';
      const extensionName = actionForm.dataset.extensionName || 'a extensão';
      const confirmation = actionForm.dataset.confirmMessage || '';
      if (operation === 'remove' && confirmation && !window.confirm(confirmation)) {
        event.preventDefault();
        return;
      }

      actionForm.setAttribute('aria-busy', 'true');
      const button = actionForm.querySelector('button[type="submit"]');
      const label = actionForm.querySelector('[data-kodety-extension-action-label]');
      if (button) button.disabled = true;
      if (label) {
        label.textContent =
          operation === 'activate'
            ? 'Ativando…'
            : operation === 'deactivate'
              ? 'Desativando…'
              : 'Removendo…';
      }
      const actionText =
        operation === 'activate'
          ? 'Ativando'
          : operation === 'deactivate'
            ? 'Desativando'
            : 'Removendo';
      announceExtension(`${actionText} ${extensionName}…`);
    });
  });

  renderExtensionFile();

  window.KodetyIcons?.scan?.(root || document);

  const tabs = Array.from(document.querySelectorAll('[data-kodety-tab]'));
  const areas = Array.from(document.querySelectorAll('[data-kodety-area]'));
  const layout = root?.querySelector('.kodety-site-project__layout');
  const sectionPicker = root?.querySelector('[data-kodety-section-picker]');
  const hashAreas = {
    '#kodety-project': 'project',
    '#kodety-extensions': 'extensions',
    '#kodety-interface': 'interface',
    '#kodety-settings': 'settings',
    '#kodety-optimizations': 'optimizations',
    '#kodety-security': 'security',
    '#kodety-mcp': 'codex',
  };
  Object.entries(hashAreas).forEach(([hash, area]) => {
    hashAreas[hash.replace('#kodety-', '#kodety-area-')] = area;
  });

  const activateArea = (area, updateHash = true) => {
    // Toda aba renderizada precisa estar aqui: um nome ausente cai no fallback
    // e a aba nunca abre o próprio painel.
    if (!['project', 'extensions', 'interface', 'settings', 'optimizations', 'security', 'codex'].includes(area)) area = 'project';
    const changedArea = root?.dataset.activeArea && root.dataset.activeArea !== area;
    document.documentElement.dataset.kodetyProjectArea = area;
    if (sectionPicker) sectionPicker.value = area;
    tabs.forEach((tab) => {
      const selected = tab.dataset.kodetyTab === area;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    areas.forEach((panel) => { panel.hidden = panel.dataset.kodetyArea !== area; });
    layout?.classList.toggle('is-single-area', area !== 'project');
    root?.setAttribute('data-active-area', area);
    if (changedArea) window.scrollTo({ top: 0, behavior: 'instant' });
    if (updateHash && window.history?.replaceState) {
      const nextHash = area === 'codex' ? '#kodety-mcp' : `#kodety-${area}`;
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
    }
    window.dispatchEvent(new CustomEvent('kodety:project-area-change', { detail: { area } }));
  };

  sectionPicker?.addEventListener('change', () => activateArea(sectionPicker.value));

  if (tabs.length && areas.length) {
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateArea(tab.dataset.kodetyTab || 'project'));
      tab.addEventListener('keydown', (event) => {
        let nextIndex = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          nextIndex = (index + 1) % tabs.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = tabs.length - 1;
        }
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        activateArea(nextTab.dataset.kodetyTab || 'project');
        nextTab.focus({ preventScroll: true });
      });
    });
    activateArea(hashAreas[window.location.hash] || 'project', false);
    window.addEventListener('hashchange', () => {
      activateArea(hashAreas[window.location.hash] || 'project', false);
    });
  }

  document.querySelectorAll('[data-kodety-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.querySelector(button.getAttribute('data-kodety-copy') || '');
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent || '');
        const label = button.querySelector('[data-kodety-copy-label]');
        const previous = label?.textContent || button.textContent;
        if (label) label.textContent = 'Copiado';
        else button.textContent = 'Copiado';
        button.classList.add('is-copied');
        window.setTimeout(() => {
          if (label) label.textContent = previous;
          else button.textContent = previous;
          button.classList.remove('is-copied');
        }, 1600);
      } catch {
        window.prompt('Copie o comando:', target.textContent || '');
      }
    });
  });

  root?.querySelectorAll('[data-kodety-confirm]').forEach((control) => {
    control.addEventListener('click', (event) => {
      const message = control.getAttribute('data-kodety-confirm') || 'Continuar?';
      if (!window.confirm(message)) event.preventDefault();
    });
  });

  window.addEventListener('pagehide', () => {
    if (brandLogoObjectUrl) URL.revokeObjectURL(brandLogoObjectUrl);
  }, { once: true });
})();
