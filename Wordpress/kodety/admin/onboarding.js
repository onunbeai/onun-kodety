/* global document, window, navigator, URL */

(() => {
  'use strict';

  const root = document.querySelector('[data-kodety-onboarding]');
  if (!root) return;
  let config;
  try {
    config = JSON.parse(root.dataset.config || '{}');
  } catch {
    return; // Leave the complete native form usable if enhancement fails.
  }
  const form = root.querySelector('form');
  const steps = [...root.querySelectorAll('[data-kodety-step]')];
  if (!form || !steps.length || !config.login || !config.messages) return;

  const message = (key, values = {}) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    config.messages[key] || '',
  );
  const find = selector => root.querySelector(selector);
  const counter = find('[data-kodety-step-counter]');
  const progress = find('[data-kodety-progress]');
  const navigation = [...root.querySelectorAll('[data-kodety-step-go]')];
  const back = find('[data-kodety-back]');
  const next = find('[data-kodety-next]');
  const finish = find('[data-kodety-finish]');
  const nextLabel = find('[data-kodety-next-label]');
  const finishLabel = find('[data-kodety-finish-label]');
  const submitStatus = find('[data-kodety-submit-status]');
  const elementorInspect = find('[data-kodety-elementor-inspect]');
  const elementorPages = find('[data-kodety-elementor-pages]');
  const elementorPageInputs = [...root.querySelectorAll('[data-kodety-elementor-page]')];
  const elementorPageError = find('[data-kodety-elementor-page-error]');
  const elementorConfirm = find('[data-kodety-elementor-confirm]');
  const sourceInputs = [...root.querySelectorAll('input[name="kodety_project_source"]')];
  const projectName = find('[data-kodety-project-name]');
  const projectNameField = find('[data-kodety-project-name-field]');
  const originalProjectName = projectName.value;
  const projectError = find('[data-kodety-project-error]');
  const zipField = find('[data-kodety-onboarding-upload]');
  const zipInput = zipField?.querySelector('input[type="file"]');
  const zipName = find('[data-kodety-onboarding-filename]');
  const zipError = find('[data-kodety-zip-error]');
  const replaceWarning = find('[data-kodety-replace-warning]');
  const color = find('input[name="kodety_admin_accent_color"]');
  const colorControl = color?.closest('.kodety-onboarding__color-control');
  const colorValue = colorControl?.querySelector('output');
  const brandPreview = find('[data-kodety-brand-preview]');
  const namePreview = find('[data-kodety-name-preview]');
  const logoInput = find('input[name="kodety_admin_logo"]');
  const logoName = find('[data-kodety-logo-name]');
  const logoError = find('[data-kodety-logo-error]');
  const logoPreview = find('[data-kodety-logo-preview]');
  const originalLogo = logoPreview?.getAttribute('src') || '';
  const originalLogoLabel = logoName?.textContent || '';
  const slug = find('[data-kodety-login-slug]');
  const slugError = find('[data-kodety-slug-error]');
  const slugStatus = find('[data-kodety-slug-status]');
  const defaultSlug = find('[data-kodety-default-slug]');
  const loginUrl = find('[data-kodety-login-url]');
  const copy = find('[data-kodety-copy-login]');
  const copyStatus = find('[data-kodety-copy-status]');
  const saved = find('[data-kodety-login-saved]');
  const savedError = find('[data-kodety-saved-error]');
  const slugPattern = new RegExp(`^(?:${config.login.pattern})$`);
  let current = Math.max(1, Math.min(steps.length, Number(config.initialStep) || 1));
  let visited = current;
  let lastLoginUrl = null;
  let logoObjectUrl = '';
  let submitting = false;

  const setError = (field, target, text) => {
    if (field) {
      field.setCustomValidity(text);
      if (text) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    if (target) {
      target.textContent = text;
      target.hidden = !text;
    }
    return !text;
  };

  const source = () => sourceInputs.find(input => input.checked)?.value || 'blank';
  const slugProblem = () => {
    if (config.login.locked) return '';
    const value = slug?.value.trim() || '';
    if (!value) return message('emptySlug');
    if (value === config.login.currentSlug) return '';
    if (value.length > config.login.maxLength || !slugPattern.test(value)) return message('invalidSlug');
    if (config.login.reserved.includes(value)) return message('reservedSlug');
    return '';
  };

  const updateLogin = (revealError = false) => {
    const problem = slugProblem();
    if (revealError || slug?.getAttribute('aria-invalid') === 'true') setError(slug, slugError, problem);
    const value = slug?.value.trim() || '';
    const url = config.login.locked ? config.login.url : (problem ? '' : config.login.baseUrl + value);
    if (lastLoginUrl !== null && lastLoginUrl !== url) {
      saved.checked = false;
      setError(saved, savedError, '');
      copyStatus.textContent = message('copyHint');
      copyStatus.classList.remove('is-success');
    }
    lastLoginUrl = url;
    loginUrl.value = url;
    loginUrl.placeholder = problem ? message('invalidUrl') : '';
    copy.disabled = !url;
    saved.disabled = !url;
    if (slugStatus) {
      slugStatus.hidden = Boolean(problem);
      slugStatus.textContent = message(value === config.login.defaultSlug ? 'defaultSlug' : 'customSlug');
    }
    if (defaultSlug) defaultSlug.disabled = value === config.login.defaultSlug;
    return !problem;
  };

  const zipProblem = () => {
    if (source() !== 'import') return '';
    const file = zipInput?.files?.[0];
    return file && /\.zip$/i.test(file.name) ? '' : message('invalidZip');
  };
  const elementorProblem = () => {
    if (source() !== 'elementor') return '';
    return elementorPageInputs.some(input => input.checked)
      ? ''
      : message('selectElementorPage');
  };
  const validateElementorSelection = () => {
    const field = elementorPageInputs[0] || null;
    return setError(field, elementorPageError, elementorProblem());
  };
  const logoProblem = () => {
    const file = logoInput?.files?.[0];
    if (!file) return '';
    const supported = file.type ? ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) : /\.(?:png|jpe?g|webp)$/i.test(file.name);
    return supported ? '' : message('invalidLogo');
  };

  const validateStep = step => {
    let valid = true;
    if (step === 2) {
      valid = setError(projectName, projectError, source() !== 'blank' || projectName.value.trim() ? '' : message('emptyName'));
      valid = setError(zipInput, zipError, zipProblem()) && valid;
      valid = validateElementorSelection() && valid;
    }
    if (step === 3) valid = setError(logoInput, logoError, logoProblem());
    if (step === 4) {
      valid = updateLogin(true);
      if (valid) valid = setError(saved, savedError, saved.checked ? '' : message('acknowledge'));
    }
    return valid;
  };

  const show = (step, focus = true) => {
    current = Math.max(1, Math.min(steps.length, step));
    visited = Math.max(visited, current);
    steps.forEach(section => {
      const active = Number(section.dataset.kodetyStep) === current;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    });
    navigation.forEach(button => {
      const number = Number(button.dataset.kodetyStepGo);
      button.disabled = submitting || number > visited;
      button.classList.toggle('is-complete', number < current);
      if (number === current) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    counter.textContent = message('counter', { current, total: steps.length });
    progress.value = current;
    progress.setAttribute('aria-valuetext', counter.textContent);
    back.hidden = current === 1;
    back.disabled = submitting;
    next.hidden = current === steps.length;
    next.disabled = submitting;
    nextLabel.textContent = message(current === 1 ? 'start' : 'next');
    finish.hidden = current !== steps.length;
    if (focus) {
      const heading = steps[current - 1].querySelector('h1');
      heading?.focus({ preventScroll: true });
      const position = heading?.getBoundingClientRect();
      if (position && (position.top < 0 || position.bottom > window.innerHeight)) {
        heading.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    }
  };

  const focusInvalid = step => {
    const field = steps[step - 1].querySelector('[aria-invalid="true"]');
    field?.focus();
  };
  const go = target => {
    if (submitting) return;
    for (let step = current; step < target; step += 1) {
      if (!validateStep(step)) {
        show(step, false);
        focusInvalid(step);
        return;
      }
    }
    show(target);
  };

  next.addEventListener('click', () => go(current + 1));
  back.addEventListener('click', () => go(current - 1));
  navigation.forEach(button => button.addEventListener('click', () => go(Number(button.dataset.kodetyStepGo))));

  const updateSource = () => {
    const importing = source() === 'import';
    const usingElementor = source() === 'elementor';
    zipField.hidden = !importing;
    zipInput.required = importing;
    zipInput.disabled = !importing;
    if (!importing) setError(zipInput, zipError, '');
    if (replaceWarning) replaceWarning.hidden = source() === 'existing';
    projectNameField.hidden = source() !== 'blank';
    projectName.disabled = source() !== 'blank';
    projectName.required = source() === 'blank';
    if (source() !== 'blank') setError(projectName, projectError, '');
    if (elementorPages) elementorPages.hidden = !usingElementor;
    elementorPageInputs.forEach(input => {
      input.disabled = !usingElementor;
    });
    if (!usingElementor) setError(elementorPageInputs[0] || null, elementorPageError, '');
    if (elementorConfirm) {
      elementorConfirm.disabled = !usingElementor
        || !elementorPageInputs.some(input => input.checked);
    }
    updateName();
  };
  sourceInputs.forEach(input => input.addEventListener('change', updateSource));
  zipInput?.addEventListener('change', () => {
    zipName.textContent = zipInput.files?.[0]?.name || message('emptyFile');
    const problem = zipProblem();
    setError(zipInput, zipError, problem);
    zipField?.classList.toggle('has-file', Boolean(zipInput.files?.[0]) && !problem);
  });
  const updateName = () => {
    const name = source() === 'blank' ? projectName.value.trim() : (source() === 'existing' ? originalProjectName : '');
    if (namePreview) namePreview.textContent = name || message('projectPlaceholder');
    if (projectName.getAttribute('aria-invalid') === 'true') {
      setError(projectName, projectError, projectName.value.trim() ? '' : message('emptyName'));
    }
  };
  projectName.addEventListener('input', updateName);
  elementorInspect?.addEventListener('click', () => {
    const elementorSource = sourceInputs.find(input => input.value === 'elementor');
    if (elementorSource) elementorSource.checked = true;
    updateSource();
    show(2);
    window.setTimeout(() => {
      (elementorPageInputs.find(input => input.checked && !input.disabled)
        || elementorPageInputs.find(input => !input.disabled)
        || elementorPages)?.focus?.({ preventScroll: true });
    }, 0);
  });
  elementorPageInputs.forEach(input => input.addEventListener('change', () => {
    validateElementorSelection();
    updateSource();
  }));

  // Match the server's contrast rule: the admin uses dark text on its accent.
  // The picker still shows the selected color; the preview shows what saves.
  const updateColor = () => {
    if (!color) return;
    if (colorValue) colorValue.textContent = color.value.toUpperCase();
    colorControl?.style.setProperty('--kodety-onboarding-color', color.value);
    const channels = [1, 3, 5].map(offset => {
      const channel = parseInt(color.value.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    const previewColor = (luminance + 0.05) / 0.05 >= 4.5 ? color.value : config.defaultAccent;
    brandPreview?.style.setProperty('--kodety-onboarding-color', previewColor);
  };
  color?.addEventListener('input', updateColor);

  logoInput?.addEventListener('change', () => {
    if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
    logoObjectUrl = '';
    const file = logoInput.files?.[0];
    const valid = setError(logoInput, logoError, logoProblem());
    if (logoName) logoName.textContent = file?.name || originalLogoLabel;
    logoInput.closest('.kodety-onboarding__upload')?.classList.toggle('has-file', Boolean(file) && valid);
    if (file && valid) logoObjectUrl = URL.createObjectURL(file);
    if (logoPreview) logoPreview.src = logoObjectUrl || originalLogo;
  });

  slug?.addEventListener('input', () => updateLogin());
  slug?.addEventListener('blur', () => {
    slug.value = slug.value.trim();
    updateLogin(true);
  });
  defaultSlug?.addEventListener('click', () => {
    slug.value = config.login.defaultSlug;
    updateLogin(true);
    slug.focus();
  });
  saved.addEventListener('change', () => setError(saved, savedError, saved.checked ? '' : message('acknowledge')));

  copy.addEventListener('click', async () => {
    if (!updateLogin(true) || !loginUrl.value) {
      slug?.focus();
      return;
    }
    const url = loginUrl.value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(url);
      if (loginUrl.value === url) {
        copyStatus.textContent = message('copied');
        copyStatus.classList.add('is-success');
      }
    } catch {
      if (loginUrl.value !== url) return;
      loginUrl.focus();
      loginUrl.select();
      copyStatus.textContent = message('copyFallback');
      copyStatus.classList.remove('is-success');
    }
  });

  form.addEventListener('keydown', event => {
    if (
      event.key === 'Enter' && !event.isComposing
      && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      && current < steps.length && event.target.matches('input[type="text"]')
    ) {
      event.preventDefault();
      go(current + 1);
    }
  });

  form.addEventListener('submit', event => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    if (event.submitter?.matches('[data-kodety-elementor-confirm]')) {
      if (!validateElementorSelection()) {
        event.preventDefault();
        show(2, false);
        (elementorPageInputs.find(input => !input.disabled) || elementorConfirm)?.focus();
        return;
      }
      submitting = true;
      root.classList.add('is-submitting');
      form.setAttribute('aria-busy', 'true');
      elementorConfirm.disabled = true;
      const label = elementorConfirm.querySelector('span');
      if (label) label.textContent = message('convertingElementor');
      if (submitStatus) submitStatus.textContent = message('convertingElementor');
      return;
    }
    // Enter in an earlier field advances the wizard, never completes it.
    if (current < steps.length) {
      event.preventDefault();
      go(current + 1);
      return;
    }
    for (let step = 1; step <= steps.length; step += 1) {
      if (!validateStep(step)) {
        event.preventDefault();
        show(step, false);
        focusInvalid(step);
        return;
      }
    }
    submitting = true;
    root.classList.add('is-submitting');
    form.setAttribute('aria-busy', 'true');
    finish.disabled = true;
    back.disabled = true;
    next.disabled = true;
    navigation.forEach(button => { button.disabled = true; });
    finishLabel.textContent = message('submitting');
    if (submitStatus) submitStatus.textContent = message('submitting');
  });

  // A history restore must not leave an already submitted wizard disabled.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    submitting = false;
    root.classList.remove('is-submitting');
    form.removeAttribute('aria-busy');
    if (submitStatus) submitStatus.textContent = '';
    finish.disabled = false;
    finishLabel.textContent = message('finish');
    updateSource();
    updateName();
    updateColor();
    updateLogin();
    show(current, false);
  });

  form.noValidate = true;
  root.classList.add('is-enhanced');
  find('[data-kodety-navigation]').hidden = false;
  find('[data-kodety-progress-wrap]').hidden = false;
  updateSource();
  updateName();
  updateColor();
  updateLogin();
  show(current, false);
  find('[data-kodety-server-error]')?.focus();
})();
