/* global document */

(() => {
  'use strict';

  document.querySelectorAll('[data-kodety-interface-form]').forEach((form) => {
    const toggle = form.querySelector('[data-kodety-interface-toggle]');
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector('[data-kodety-interface-status]');
    if (!toggle) return;

    let submitting = false;
    const markSubmitting = () => {
      if (submitting) return false;
      submitting = true;
      form.setAttribute('aria-busy', 'true');
      if (submit) submit.disabled = true;
      if (status) {
        status.textContent = toggle.checked
          ? form.dataset.enablingLabel || 'Ativando…'
          : form.dataset.disablingLabel || 'Desativando…';
      }
      return true;
    };

    toggle.addEventListener('change', () => {
      if (!markSubmitting()) return;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    });

    form.addEventListener('submit', markSubmitting);
  });
})();
