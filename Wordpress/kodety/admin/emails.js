(() => {
  'use strict';
  const all = document.querySelector('[data-kodety-check-all]');
  const itemCheckboxes = Array.from(
    document.querySelectorAll('input[name="submission_ids[]"]'),
  );
  if (all) {
    all.setAttribute('aria-label', 'Selecionar todos os envios desta página');
    const syncCheckAll = () => {
      const selected = itemCheckboxes.filter((input) => input.checked).length;
      all.checked = itemCheckboxes.length > 0 && selected === itemCheckboxes.length;
      all.indeterminate = selected > 0 && selected < itemCheckboxes.length;
    };
    all.addEventListener('change', () => {
      itemCheckboxes.forEach((input) => { input.checked = all.checked; });
      syncCheckAll();
    });
    itemCheckboxes.forEach((input) => {
      const contact = input.closest('tr')?.querySelector('.kodety-email-contact strong')?.textContent?.trim();
      input.setAttribute('aria-label', contact ? `Selecionar envio de ${contact}` : 'Selecionar envio');
      input.addEventListener('change', syncCheckAll);
    });
    syncCheckAll();
  }

  const tableRegion = document.querySelector('.kodety-email-table');
  if (tableRegion) {
    tableRegion.tabIndex = 0;
    tableRegion.setAttribute('role', 'region');
    tableRegion.setAttribute('aria-label', 'Envios recebidos');
    tableRegion.querySelector('.kodety-email-empty')?.setAttribute('role', 'status');
  }

  const bulkForm = document.querySelector('input[name="action"][value="kodety_emails_bulk"]')?.closest('form');
  bulkForm?.addEventListener('submit', (event) => {
    const action = bulkForm.querySelector('select[name="bulk_action"]')?.value;
    const selected = bulkForm.querySelectorAll('input[name="submission_ids[]"]:checked').length;
    if (action === 'delete' && selected > 0 && !window.confirm(`Excluir permanentemente ${selected} envio(s) e seus arquivos?`)) {
      event.preventDefault();
    }
  });

  const modal = document.querySelector('[data-kodety-connection-modal]');
  if (!modal) return;
  const modalForm = modal.closest('form');
  if (modalForm) document.body.appendChild(modalForm);
  const title = modal.querySelector('#kodety-connection-modal-title');
  const dialog = modal.querySelector('.kodety-connection-modal__dialog');
  const panels = Array.from(modal.querySelectorAll('[data-kodety-connection-panel]'));
  let opener = null;

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const visibleControls = () =>
    Array.from(dialog?.querySelectorAll(focusableSelector) || []).filter(
      (control) => !control.hidden && !control.closest('[hidden], [aria-hidden="true"]') && control.getClientRects().length,
    );

  modal.setAttribute('aria-hidden', 'true');
  if (dialog) dialog.tabIndex = -1;

  const closeModal = () => {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('kodety-connection-modal-open');
    panels.forEach((panel) => { panel.hidden = true; });
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  };

  const openModal = (button) => {
    const panelName = button.dataset.kodetyConnectionOpen;
    const panel = panels.find((candidate) => candidate.dataset.kodetyConnectionPanel === panelName);
    if (!panel) return;
    opener = button;
    panels.forEach((candidate) => { candidate.hidden = candidate !== panel; });
    if (title) title.textContent = `Configurar ${button.dataset.kodetyConnectionName || 'conexão'}`;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('kodety-connection-modal-open');
    const firstInput = panel.querySelector('input, textarea, select');
    window.requestAnimationFrame(() => {
      if (firstInput) firstInput.focus({ preventScroll: true });
      else dialog?.focus({ preventScroll: true });
    });
  };

  document.querySelectorAll('[data-kodety-connection-open]').forEach((button) => {
    button.addEventListener('click', () => openModal(button));
  });
  modal.querySelectorAll('[data-kodety-connection-close]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', (event) => {
    if (modal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = visibleControls();
    if (!controls.length) {
      event.preventDefault();
      dialog?.focus({ preventScroll: true });
      return;
    }
    const first = controls[0];
    const last = controls.at(-1);
    if (!dialog?.contains(document.activeElement) || document.activeElement === dialog) {
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
})();
