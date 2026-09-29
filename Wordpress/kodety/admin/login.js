/* global document, MutationObserver, queueMicrotask, URL, window */

(() => {
  'use strict';

  const body = document.body;
  const login = document.querySelector('#login');
  if (!body?.classList.contains('kodety-login') || !login || body.dataset.kodetyLoginReady === 'true') return;
  const initiallyFocused = login.contains(document.activeElement) ? document.activeElement : null;
  const loginAssetBaseUrl = document.currentScript?.src
    || document.querySelector('script[src*="/admin/login.js"]')?.src
    || document.querySelector('link[href*="/admin/login.css"]')?.href;
  const configuredAssets = window.kodetyLoginConfig || {};
  const resolveLoginAsset = (key, fallbackPath) => {
    if (typeof configuredAssets[key] === 'string' && configuredAssets[key]) return configuredAssets[key];
    return loginAssetBaseUrl ? new URL(fallbackPath, loginAssetBaseUrl).href : '';
  };
  const showcaseUrl = resolveLoginAsset('showcaseUrl', 'images/login-showcase.webp');
  const fallbackShowcaseUrl = resolveLoginAsset('fallbackShowcaseUrl', 'images/login-showcase.webp');
  const fullLogoUrl = resolveLoginAsset('fullLogoUrl', 'images/kodety-logo-full.svg');

  // Informative icons use Onun Kodety's Solar Bold Duotone family. Direct actions
  // such as password visibility remain Gravity stroke icons so their state is
  // immediately legible. The small local subset avoids a React or network
  // dependency on this standalone WordPress surface.
  const ICONS = {
    arrowRight: '<path fill="currentColor" fill-rule="evenodd" d="M3.25 12A.75.75 0 0 1 4 11.25h9.25v1.5H4a.75.75 0 0 1-.75-.75" clip-rule="evenodd" opacity=".5"/><path fill="currentColor" d="M13.25 12.75V18a.75.75 0 0 0 1.28.53l6-6a.75.75 0 0 0 0-1.06l-6-6A.75.75 0 0 0 13.25 6v6.75Z"/>',
    chevronDown: '<path fill="currentColor" d="M11.293 8H5.57c-.528 0-.771.791-.37 1.205l2.406 2.481L11.293 8Z" opacity=".5"/><path fill="currentColor" d="m8.303 12.404 3.327 3.431a.51.51 0 0 0 .74 0l6.43-6.63C19.2 8.79 18.958 8 18.43 8h-5.723l-4.404 4.404Z"/>',
    envelope: '<path fill="currentColor" d="M14.2 3H9.8C5.652 3 3.577 3 2.289 4.318 1 5.636 1 7.757 1 12s0 6.364 1.289 7.682C3.577 21 5.652 21 9.8 21h4.4c4.148 0 6.223 0 7.511-1.318C23 18.364 23 16.243 23 12s0-6.364-1.289-7.682C20.423 3 18.348 3 14.2 3Z" opacity=".5"/><path fill="currentColor" d="M19.128 8.033a.825.825 0 1 0-1.056-1.268l-2.375 1.98c-1.026.855-1.738 1.446-2.34 1.833-.582.375-.977.5-1.357.5s-.774-.125-1.357-.5c-.601-.387-1.314-.978-2.34-1.834l-2.375-1.98a.825.825 0 0 0-1.056 1.269l2.416 2.013c.975.813 1.765 1.472 2.463 1.92.726.467 1.434.763 2.249.763s1.523-.296 2.25-.763c.697-.448 1.487-1.107 2.462-1.92l2.416-2.013Z"/>',
    eye: '<path fill="currentColor" fill-rule="evenodd" d="M1.87 8.515 1.641 8l.229-.515a6.708 6.708 0 0 1 12.26 0l.228.515-.229.515a6.708 6.708 0 0 1-12.259 0M.5 6.876l-.26.585a1.33 1.33 0 0 0 0 1.079l.26.584a8.208 8.208 0 0 0 15 0l.26-.584a1.33 1.33 0 0 0 0-1.08l-.26-.584a8.208 8.208 0 0 0-15 0M9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0" clip-rule="evenodd"/>',
    eyeSlash: '<path fill="currentColor" fill-rule="evenodd" d="M3.03 1.97a.75.75 0 0 0-1.06 1.06l.83.83A8.2 8.2 0 0 0 .5 6.876l-.26.585a1.33 1.33 0 0 0 0 1.079l.26.585a8.21 8.21 0 0 0 11.434 3.87l1.036 1.035a.75.75 0 1 0 1.06-1.06zm7.788 9.908-1.294-1.293a3 3 0 0 1-4.109-4.109L3.866 4.927A6.7 6.7 0 0 0 1.87 7.486L1.641 8l.23.515a6.71 6.71 0 0 0 8.947 3.363M6.55 7.611A1.502 1.502 0 0 0 8.389 9.45zm1.658-2.604 2.784 2.784a3 3 0 0 0-2.784-2.784m5.92 3.508a6.7 6.7 0 0 1-.915 1.496l1.065 1.066A8.2 8.2 0 0 0 15.5 9.125l.26-.585a1.33 1.33 0 0 0 0-1.08l-.26-.584A8.21 8.21 0 0 0 5.572 2.37L6.81 3.61a6.71 6.71 0 0 1 7.32 3.877l.228.514z" clip-rule="evenodd"/>',
    globe: '<g fill="currentColor" opacity=".5"><path d="M12 3.396c-.275 0-.63.117-1.043.495-.416.38-.833.977-1.201 1.79-.366.808-.663 1.784-.867 2.873a18.8 18.8 0 0 0-.296 2.696h6.814a18.8 18.8 0 0 0-.296-2.696c-.204-1.09-.501-2.065-.867-2.873-.368-.813-.784-1.41-1.2-1.79-.414-.378-.769-.495-1.044-.495Z"/><path d="M8.889 15.446c.204 1.09.501 2.065.867 2.873.368.813.785 1.41 1.2 1.79.414.379.769.496 1.044.496s.63-.117 1.043-.495c.416-.381.833-.978 1.201-1.791.366-.808.663-1.783.867-2.873.161-.858.261-1.768.296-2.696H8.593c.035.928.135 1.838.296 2.696Z"/></g><path fill="currentColor" fill-rule="evenodd" d="M2.028 11.25C2.41 6.077 6.73 2 12 2c-.831 0-1.57.364-2.179.921-.606.554-1.117 1.328-1.531 2.242-.416.92-.74 1.996-.959 3.163a20 20 0 0 0-.318 2.924H2.028Zm0 1.5h4.985c.036 1.002.143 1.988.318 2.924.219 1.167.543 2.243.959 3.163.414.914.925 1.688 1.531 2.242.609.557 1.348.921 2.179.921C6.73 22 2.41 17.923 2.028 12.75Z" clip-rule="evenodd"/><path fill="currentColor" d="M12 2c.831 0 1.57.364 2.179.921.606.554 1.117 1.328 1.531 2.242.417.92.74 1.996.959 3.163.175.936.282 1.923.318 2.924h4.985C21.589 6.077 17.271 2 12 2ZM16.669 15.674c-.219 1.167-.542 2.243-.959 3.163-.414.914-.925 1.688-1.531 2.242C13.57 21.636 12.831 22 12 22c5.271 0 9.589-4.077 9.972-9.25h-4.985a20 20 0 0 1-.318 2.924Z"/>',
    lock: '<path fill="currentColor" d="M2 16c0-2.828 0-4.243.879-5.121C3.757 10 5.172 10 8 10h8c2.828 0 4.243 0 5.121.879C22 11.757 22 13.172 22 16s0 4.243-.879 5.121C20.243 22 18.828 22 16 22H8c-2.828 0-4.243 0-5.121-.879C2 20.243 2 18.828 2 16Z" opacity=".5"/><path fill="currentColor" d="M12.75 14a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0v-4ZM6.75 8a5.25 5.25 0 0 1 10.5 0v2.004c.567.005 1.064.018 1.5.05V8a6.75 6.75 0 0 0-13.5 0v2.055c.437-.033.933-.046 1.5-.051V8Z"/>',
    person: '<ellipse cx="12" cy="17" rx="7" ry="4" fill="currentColor" opacity=".5"/><circle cx="12" cy="6" r="4" fill="currentColor"/>',
    questionCircle: '<path fill="currentColor" d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10Z" opacity=".5"/><path fill="currentColor" d="M12 6.25a2.625 2.625 0 0 0-2.625 2.625.75.75 0 0 0 1.5 0 1.125 1.125 0 1 1 1.932.784c-.057.059-.123.124-.193.194-.234.233-.521.52-.75.814-.309.397-.614.927-.614 1.583V13a.75.75 0 0 0 1.5 0v-.75c0-.173.079-.38.298-.662.166-.213.355-.402.571-.617.084-.084.172-.172.264-.267A2.625 2.625 0 0 0 12 6.25ZM13 16a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',
    shieldCheck: '<path fill="currentColor" d="M3.378 5.082C3 5.62 3 7.22 3 10.417v1.574c0 5.638 4.239 8.375 6.899 9.536C10.62 21.842 10.981 22 12 22s1.38-.158 2.101-.473C16.761 20.366 21 17.629 21 11.991v-1.574c0-3.198 0-4.797-.378-5.335-.377-.537-1.88-1.052-4.887-2.081l-.573-.196C13.595 2.268 12.811 2 12 2s-1.595.268-3.162.805l-.573.196c-3.007 1.029-4.51 1.544-4.887 2.081Z" opacity=".5"/><path fill="currentColor" d="M15.06 10.5a.75.75 0 1 0-1.12-.999l-3.011 3.373-.87-.973a.75.75 0 1 0-1.118.999l1.428 1.6a.75.75 0 0 0 1.119 0l3.571-4Z"/>',
  };

  const DUOTONE_ICONS = new Set([
    'arrowRight',
    'chevronDown',
    'envelope',
    'globe',
    'lock',
    'person',
    'questionCircle',
    'shieldCheck',
  ]);

  const iconMarkup = (name, className = '') => {
    const duotone = DUOTONE_ICONS.has(name);
    const classes = [className, duotone ? 'kodety-login-icon--duotone' : ''].filter(Boolean).join(' ');
    return `<svg class="${classes}" viewBox="0 0 ${duotone ? '24 24' : '16 16'}" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${ICONS[name]}</svg>`;
  };

  const contexts = [
    {
      bodyClass: 'login-action-lostpassword',
      title: 'Esqueceu sua senha?',
      description: 'Informe seu usuário ou email. O WordPress enviará um link seguro para você continuar.',
    },
    {
      bodyClass: 'login-action-retrievepassword',
      title: 'Esqueceu sua senha?',
      description: 'Informe seu usuário ou email. O WordPress enviará um link seguro para você continuar.',
    },
    {
      bodyClass: 'login-action-register',
      title: 'Crie sua conta',
      description: 'Preencha seus dados para começar a construir com o Onun Kodety.',
    },
    {
      bodyClass: 'login-action-resetpass',
      title: 'Defina uma nova senha',
      description: 'Escolha uma senha forte para proteger o seu workspace.',
    },
    {
      bodyClass: 'login-action-rp',
      title: 'Defina uma nova senha',
      description: 'Escolha uma senha forte para proteger o seu workspace.',
    },
    {
      bodyClass: 'login-action-checkemail',
      title: 'O próximo passo está na sua caixa de entrada',
      description: 'Abra a mensagem enviada pelo WordPress para concluir com segurança.',
    },
    {
      bodyClass: 'login-action-confirm_admin_email',
      title: 'Confirme o email administrativo',
      description: 'Revise o endereço antes de continuar para manter a conta protegida.',
    },
    {
      bodyClass: 'login-action-confirmaction',
      title: 'Ação concluída',
      description: 'A confirmação foi registrada com segurança.',
    },
  ];
  const loginContext = {
    title: body.classList.contains('interim-login') ? 'Entre novamente' : 'Boas-vindas de volta',
    description: body.classList.contains('interim-login')
      ? 'Sua sessão terminou. Entre para continuar de onde parou.'
      : 'Entre para continuar criando, publicando e evoluindo seus projetos.',
  };
  const resetComplete = (
    (body.classList.contains('login-action-resetpass') || body.classList.contains('login-action-rp'))
    && !login.querySelector('#resetpassform')
  );
  const interimComplete = body.classList.contains('interim-login-success');
  const confirmedAction = body.classList.contains('login-action-confirmaction');
  const context = interimComplete
    ? {
        title: 'Acesso confirmado',
        description: 'Você já pode continuar de onde parou.',
      }
    : resetComplete
    ? {
        title: 'Tudo pronto',
        description: 'Sua nova senha já está ativa. Entre novamente para continuar.',
      }
    : contexts.find(item => body.classList.contains(item.bodyClass)) || loginContext;

  const createShell = () => {
    const shell = document.createElement('main');
    shell.className = 'kodety-login-shell';
    shell.setAttribute('aria-label', 'Acesso ao Onun Kodety');

    const stage = document.createElement('aside');
    stage.className = 'kodety-login-stage';
    stage.setAttribute('aria-hidden', 'true');
    const stageImage = document.createElement('img');
    stageImage.className = 'kodety-login-stage__image';
    stageImage.alt = '';
    stageImage.width = 1920;
    stageImage.height = 1472;
    stageImage.decoding = 'async';
    stageImage.fetchPriority = 'high';
    stageImage.addEventListener('error', () => {
      if (!fallbackShowcaseUrl || stageImage.dataset.kodetyFallbackAttempted === 'true') return;
      stageImage.dataset.kodetyFallbackAttempted = 'true';
      stageImage.src = fallbackShowcaseUrl;
    });
    const stageMedia = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 861px) and (forced-colors: none)')
      : null;
    const loadStageImage = () => {
      if (showcaseUrl && (!stageMedia || stageMedia.matches) && !stageImage.src) {
        stageImage.src = showcaseUrl;
      }
    };
    loadStageImage();
    stageMedia?.addEventListener('change', loadStageImage);
    window.addEventListener('pagehide', () => stageMedia?.removeEventListener('change', loadStageImage), { once: true });
    stage.append(stageImage);

    const panel = document.createElement('section');
    panel.className = 'kodety-login-panel';
    panel.setAttribute('aria-labelledby', 'kodety-login-title');

    login.parentNode.insertBefore(shell, login);
    shell.append(stage, panel);
    panel.append(login);

    const languageSwitcher = document.querySelector('.language-switcher');
    if (languageSwitcher) {
      panel.append(languageSwitcher);
      enhanceLanguageSwitcher(languageSwitcher);
    }

    const assurance = document.createElement('p');
    assurance.className = 'kodety-login-assurance';
    assurance.innerHTML = `${iconMarkup('shieldCheck')}<span>Acesso protegido pelo WordPress</span>`;
    panel.append(assurance);
  };

  const createBrandAndIntro = () => {
    const logo = login.querySelector('h1 a');
    if (logo) {
      logo.setAttribute('aria-label', 'Onun Kodety');
      logo.removeAttribute('title');
      logo.textContent = '';

      const fullLogo = document.createElement('img');
      fullLogo.className = 'kodety-login-brand__logo';
      fullLogo.alt = '';
      fullLogo.width = 209;
      fullLogo.height = 43;
      fullLogo.decoding = 'async';
      if (fullLogoUrl) fullLogo.src = fullLogoUrl;
      logo.append(fullLogo);
    }

    const intro = document.createElement('div');
    intro.className = 'kodety-login-intro';

    const title = document.createElement(
      body.classList.contains('login-action-confirm_admin_email') ? 'h1' : 'h2',
    );
    title.id = 'kodety-login-title';
    title.className = 'kodety-login-intro__title';
    title.textContent = context.title;

    const description = document.createElement('p');
    description.className = 'kodety-login-intro__description';
    description.textContent = context.description;

    intro.append(title, description);
    const logoHeading = login.querySelector('h1');
    if (logoHeading) logoHeading.after(intro);
    else login.prepend(intro);
  };

  const enhanceLanguageSwitcher = languageSwitcher => {
    if (languageSwitcher.dataset.kodetyLanguage === 'true') return;

    const form = languageSwitcher.querySelector('form');
    const select = languageSwitcher.querySelector('select');
    if (!form || !select) return;

    languageSwitcher.dataset.kodetyLanguage = 'true';
    languageSwitcher.classList.add('kodety-login-language');
    form.classList.add('kodety-login-language__form');

    const label = Array.from(form.querySelectorAll('label')).find(item => item.htmlFor === select.id)
      || form.querySelector('label');
    label?.classList.add('kodety-login-language__label');

    const surface = document.createElement('span');
    surface.className = 'kodety-login-language__surface';
    select.parentNode.insertBefore(surface, select);

    const glyph = document.createElement('span');
    glyph.className = 'kodety-login-language__icon';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = iconMarkup('globe');

    const chevron = document.createElement('span');
    chevron.className = 'kodety-login-language__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = iconMarkup('chevronDown');

    select.classList.add('kodety-login-language__select');
    surface.append(glyph, select, chevron);
    form.querySelector('.button')?.classList.add('kodety-login-language__submit');
  };

  const arrangeLoginActions = () => {
    login.querySelector('#backtoblog')?.remove();

    const form = login.querySelector('#loginform');
    const remember = form?.querySelector('.forgetmenot');
    const helpToggle = remember?.querySelector('.wp-tooltip__toggle');
    if (helpToggle && helpToggle.dataset.kodetyIcon !== 'true') {
      helpToggle.dataset.kodetyIcon = 'true';
      helpToggle.innerHTML = iconMarkup('questionCircle', 'kodety-login-help-icon');
    }
    const navigation = login.querySelector('#nav');
    if (!form || !remember || !navigation) return;

    const recoveryLink = Array.from(navigation.querySelectorAll('a')).find(link => {
      try {
        return new URL(link.href, window.location.href).searchParams.get('action') === 'lostpassword';
      } catch {
        return false;
      }
    });
    if (!recoveryLink) return;

    const row = document.createElement('div');
    row.className = 'kodety-login-account-row';
    remember.parentNode.insertBefore(row, remember);
    recoveryLink.classList.add('kodety-login-account-row__recovery');
    row.append(remember, recoveryLink);

    if (!navigation.querySelector('a')) navigation.remove();
  };

  const fieldIconFor = input => {
    if (input.type === 'password') return 'lock';
    if (input.type === 'email' || /email/i.test(input.id || input.name || '')) return 'envelope';
    if (/(?:otp|one.?time|2fa|verification|auth(?:entication)?[_-]?code|token)/i.test(`${input.id} ${input.name} ${input.autocomplete}`)) {
      return 'shieldCheck';
    }
    return 'person';
  };

  const textFieldTypes = new Set(['', 'text', 'email', 'password', 'search', 'tel', 'url', 'number']);

  const labelFor = (form, input) => {
    if (!input.id) return null;
    return Array.from(form.querySelectorAll('label')).find(label => label.htmlFor === input.id) || null;
  };

  const movePasswordFeedbackOutside = surface => {
    const feedback = Array.from(surface.querySelectorAll('#pass-strength-result, .caps-warning'));
    feedback.reverse().forEach(item => surface.after(item));
  };

  const observePasswordFeedback = surface => {
    const observer = new MutationObserver(() => movePasswordFeedbackOutside(surface));
    observer.observe(surface, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };

  const enhancePasswordToggle = (button, input) => {
    if (button.dataset.kodetyPasswordToggle === 'true') return;
    button.dataset.kodetyPasswordToggle = 'true';
    button.classList.add('kodety-login-field__action');

    const icon = document.createElement('span');
    icon.className = 'kodety-login-password-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `${iconMarkup('eye', 'kodety-login-password-icon__show')}${iconMarkup('eyeSlash', 'kodety-login-password-icon__hide')}`;
    button.append(icon);

    const syncState = () => {
      const visible = input.type === 'text';
      button.setAttribute('aria-pressed', String(visible));
      button.title = button.getAttribute('aria-label') || (visible ? 'Ocultar senha' : 'Mostrar senha');
    };
    button.addEventListener('click', () => queueMicrotask(syncState));
    new MutationObserver(syncState).observe(input, { attributes: true, attributeFilter: ['type'] });
    syncState();
  };

  const enhanceField = (form, input) => {
    if (input.dataset.kodetyLoginField === 'true') return;
    input.dataset.kodetyLoginField = 'true';
    input.classList.add('kodety-login-field__input');

    const label = labelFor(form, input);
    label?.classList.add('kodety-login-field__label');
    const root = input.closest('.user-pass-wrap, .user-pass1-wrap, .user-pass2-wrap, p') || input.parentElement;
    root?.classList.add('kodety-login-field');

    let surface = input.closest('.wp-pwd');
    if (surface) {
      surface.classList.add('kodety-login-field__surface');
    } else {
      surface = document.createElement('div');
      surface.className = 'kodety-login-field__surface';
      input.parentNode.insertBefore(surface, input);
      surface.append(input);
    }

    const previousBreak = surface.previousElementSibling;
    if (previousBreak?.tagName === 'BR') previousBreak.remove();

    const glyph = document.createElement('span');
    glyph.className = 'kodety-login-field__icon';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = iconMarkup(fieldIconFor(input));
    surface.prepend(glyph);

    if (input.getAttribute('aria-describedby')?.split(/\s+/).includes('login_error')) {
      surface.dataset.invalid = 'true';
    }

    const passwordToggle = surface.querySelector('.wp-hide-pw');
    if (passwordToggle) enhancePasswordToggle(passwordToggle, input);
    movePasswordFeedbackOutside(surface);
    if (surface.classList.contains('wp-pwd')) observePasswordFeedback(surface);
  };

  const enhanceSubmit = (form, submit) => {
    if (submit.dataset.kodetySubmit === 'true') return;
    submit.dataset.kodetySubmit = 'true';

    const control = document.createElement('span');
    control.className = 'kodety-login-submit';
    submit.parentNode.insertBefore(control, submit);
    control.append(submit);

    const visibleContent = document.createElement('span');
    visibleContent.className = 'kodety-login-submit__content';
    visibleContent.setAttribute('aria-hidden', 'true');

    const visibleLabel = document.createElement('span');
    visibleLabel.className = 'kodety-login-submit__label';
    const syncVisibleLabel = () => {
      const nextLabel = String(submit.value || submit.textContent || '').trim();
      if (nextLabel && visibleLabel.textContent !== nextLabel) visibleLabel.textContent = nextLabel;
    };
    syncVisibleLabel();

    const affordance = document.createElement('span');
    affordance.className = 'kodety-login-submit__icon';
    affordance.setAttribute('aria-hidden', 'true');
    affordance.innerHTML = iconMarkup('arrowRight');
    visibleContent.append(visibleLabel, affordance);
    control.append(visibleContent);

    const labelObserver = new MutationObserver(syncVisibleLabel);
    labelObserver.observe(submit, {
      attributes: true,
      attributeFilter: ['value'],
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener('pagehide', () => labelObserver.disconnect(), { once: true });

    let previousState = null;
    const restoreAttribute = (element, name, value) => {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    };
    const reset = () => {
      if (previousState) {
        restoreAttribute(form, 'aria-busy', previousState.formBusy);
        restoreAttribute(submit, 'aria-disabled', previousState.submitDisabled);
      }
      previousState = null;
      delete form.dataset.kodetySubmitPending;
      delete form.dataset.kodetySubmitting;
    };
    form.addEventListener('submit', event => {
      if (form.dataset.kodetySubmitting === 'true' || form.dataset.kodetySubmitPending === 'true') {
        event.preventDefault();
        return;
      }
      form.dataset.kodetySubmitPending = 'true';
      queueMicrotask(() => {
        delete form.dataset.kodetySubmitPending;
        if (event.defaultPrevented) return;
        previousState = {
          formBusy: form.getAttribute('aria-busy'),
          submitDisabled: submit.getAttribute('aria-disabled'),
        };
        form.setAttribute('aria-busy', 'true');
        form.dataset.kodetySubmitting = 'true';
        submit.setAttribute('aria-disabled', 'true');
      });
    });
    window.addEventListener('pageshow', reset);
  };

  const enhanceForms = () => {
    login.querySelectorAll('form').forEach(form => {
      if (form.id === 'language-switcher') return;
      if (!form.hasAttribute('aria-labelledby') && !form.hasAttribute('aria-label')) {
        form.setAttribute('aria-labelledby', 'kodety-login-title');
      }

      form.querySelectorAll('input.input').forEach(input => {
        const type = (input.getAttribute('type') || '').toLowerCase();
        if (!textFieldTypes.has(type)) return;
        enhanceField(form, input);
      });

      const primarySubmit = form.querySelector('input[type="submit"].button-primary, button[type="submit"].button-primary');
      if (primarySubmit) enhanceSubmit(form, primarySubmit);
    });

  };

  const enhanceNotices = () => {
    login.querySelectorAll('.notice, .message, #login_error').forEach(notice => {
      notice.classList.add('kodety-login-notice');
      if ((resetComplete || interimComplete || confirmedAction) && notice.id !== 'login_error') {
        notice.classList.add('notice-success');
      }
      if (notice.id === 'login_error' || notice.classList.contains('notice-error')) {
        notice.setAttribute('role', 'alert');
        notice.setAttribute('aria-live', 'assertive');
      } else {
        if (!notice.hasAttribute('role')) notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
      }
    });
  };

  createShell();
  createBrandAndIntro();
  arrangeLoginActions();
  enhanceNotices();
  enhanceForms();
  const loginObserver = new MutationObserver(mutations => {
    if (!mutations.some(mutation => mutation.addedNodes.length > 0)) return;
    enhanceNotices();
    enhanceForms();
  });
  loginObserver.observe(login, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => loginObserver.disconnect(), { once: true });
  if (initiallyFocused?.isConnected && typeof initiallyFocused.focus === 'function') {
    initiallyFocused.focus({ preventScroll: true });
  }
  body.dataset.kodetyLoginReady = 'true';
  body.classList.add('kodety-login--ready');
})();
