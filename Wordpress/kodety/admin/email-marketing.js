/* Email Marketing — interações da tela de saúde e configurações. */
(function () {
  'use strict';

  function adminUiLocale() {
    return window.kodetyAdminI18n?.locale
      || document.documentElement.dataset.kodetyUiLocale
      || document.documentElement.lang
      || 'pt-BR';
  }

  /**
   * wp-admin roda em http em muitas instalações locais, onde
   * navigator.clipboard não existe. O fallback mantém o botão útil lá.
   */
  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }

    return new Promise(function (resolve, reject) {
      var field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();

      var copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      document.body.removeChild(field);
      copied ? resolve() : reject(new Error('copy_failed'));
    });
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-kodety-copy]');
    if (!button) return;

    event.preventDefault();
    var label = button.textContent;

    copyText(button.getAttribute('data-kodety-copy') || '').then(
      function () {
        button.textContent = 'Copiado';
        button.classList.add('is-copied');
        window.setTimeout(function () {
          button.textContent = label;
          button.classList.remove('is-copied');
        }, 1800);
      },
      function () {
        button.textContent = 'Copie manualmente';
        window.setTimeout(function () {
          button.textContent = label;
        }, 2400);
      }
    );
  });

  /**
   * Acompanhamento ativo da fila.
   *
   * A aba antecipa ticks para dar retorno imediato; os eventos individuais e
   * o watchdog do WP-Cron continuam a fila quando o painel é fechado.
   */
  function driveCampaign(panel) {
    var url = panel.getAttribute('data-kodety-tick');
    var nonce = panel.getAttribute('data-kodety-nonce');
    var bar = panel.querySelector('[data-kodety-progress-bar]');
    var track = panel.querySelector('[data-kodety-progress-track]');
    var label = panel.querySelector('[data-kodety-progress-label]');
    var meta = panel.querySelector('[data-kodety-progress-meta]');
    var stopped = false;
    var retries = 0;

    function paint(data) {
      var total = data.total || 0;
      var sent = data.sent || 0;
      var percent = total > 0 ? Math.round((sent / total) * 100) : 0;

      if (bar) bar.style.width = percent + '%';
      if (track) track.setAttribute('aria-valuenow', String(percent));
      if (label) {
        label.textContent = sent.toLocaleString(adminUiLocale()) + ' de ' + total.toLocaleString(adminUiLocale()) + ' enviados';
      }
      if (!meta) return;

      if (data.status === 'paused') {
        meta.textContent = 'A fila foi pausada com segurança. Atualizando os detalhes…';
      } else if (data.throttled) {
        meta.textContent = 'Aguardando o limite de envio por minuto. Isso protege a reputação do domínio.';
      } else if (data.done) {
        meta.textContent = 'Envio concluído.';
      } else if (data.failed > 0) {
        meta.textContent = data.failed + ' falha(s) até agora. Você pode sair desta tela; a fila continua em segundo plano.';
      } else {
        meta.textContent = 'A fila continua em segundo plano; esta tela só antecipa e acompanha o progresso.';
      }
    }

    function tick() {
      if (stopped) return;

      fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': nonce }
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (!response.ok) {
              var error = new Error(data.message || 'Não foi possível continuar o envio.');
              error.status = response.status;
              throw error;
            }
            return data;
          });
        })
        .then(function (data) {
          retries = 0;
          paint(data);

          if (data.done || data.status === 'paused') {
            stopped = true;
            // Recarrega uma vez para trazer o relatório final consolidado.
            if (data.done) window.setTimeout(function () { window.location.reload(); }, 1200);
            else if (data.status === 'paused') window.setTimeout(function () { window.location.reload(); }, 500);
            return;
          }
          window.setTimeout(tick, Math.max(1, data.retry_after || 2) * 1000);
        })
        .catch(function (error) {
          retries += 1;
          if (error.status === 401 || error.status === 403) {
            stopped = true;
            if (meta) meta.textContent = 'Sua sessão expirou. Recarregue a página para retomar o envio.';
            return;
          }

          var delay = Math.min(30, 5 * Math.pow(2, Math.min(retries - 1, 3)));
          if (meta) {
            meta.textContent = (error.message || 'Conexão interrompida.') +
              ' Nova tentativa em ' + delay + ' segundos (tentativa ' + retries + ').';
          }
          window.setTimeout(tick, delay * 1000);
        });
    }

    // Sair da página não perde nada: o que não foi enviado continua pendente
    // na fila e é retomado ao reabrir a campanha.
    window.addEventListener('beforeunload', function () { stopped = true; });
    tick();
  }

  var progressPanel = document.querySelector('[data-kodety-campaign]');
  if (progressPanel && progressPanel.getAttribute('data-kodety-status') === 'sending') {
    driveCampaign(progressPanel);
  }

  /**
   * Busca local para tabelas e grades pequenas. O servidor continua sendo a
   * fonte dos dados; aqui só reduzimos o que já está visível na página.
   */
  function normalizeSearch(value) {
    var text = String(value || '').toLocaleLowerCase('pt-BR');
    return typeof text.normalize === 'function'
      ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      : text;
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-kodety-filter-scope]'), function (scope) {
    var search = scope.querySelector('[data-kodety-table-search]');
    var status = scope.querySelector('[data-kodety-status-filter]');
    var rows = Array.prototype.slice.call(scope.querySelectorAll('[data-kodety-filter-row]'));
    var empty = scope.querySelector('[data-kodety-table-empty]');

    function filterRows() {
      var query = normalizeSearch(search ? search.value : '');
      var selectedStatus = status ? status.value : '';
      var visible = 0;

      rows.forEach(function (row) {
        var matchesText = !query || normalizeSearch(row.getAttribute('data-kodety-search')).indexOf(query) !== -1;
        var matchesStatus = !selectedStatus || row.getAttribute('data-kodety-status') === selectedStatus;
        var show = matchesText && matchesStatus;
        row.classList.toggle('is-filter-hidden', !show);
        visible += show ? 1 : 0;
      });

      if (empty) empty.hidden = visible > 0;
    }

    if (search) search.addEventListener('input', filterRows);
    if (status) status.addEventListener('change', filterRows);
    filterRows();
  });

  /**
   * Ações em massa na tela de Contatos.
   *
   * A caixa do cabeçalho marca só a página atual; para agir sobre o filtro
   * inteiro existe uma segunda caixa explícita, porque "selecionar tudo"
   * significando coisas diferentes conforme a paginação é uma armadilha.
   */
  var bulkForm = document.querySelector('[data-kodety-bulk]');
  if (bulkForm) {
    var checkAll = bulkForm.querySelector('[data-kodety-check-all]');
    var boxes = Array.prototype.slice.call(
      bulkForm.querySelectorAll('input[name="contact_ids[]"]')
    );
    var actionSelect = bulkForm.querySelector('[data-kodety-bulk-action]');
    var listSelect = bulkForm.querySelector('[data-kodety-bulk-list]');
    var allRow = bulkForm.querySelector('[data-kodety-bulk-all-row]');
    var allBox = allRow ? allRow.querySelector('input[type="checkbox"]') : null;
    var counter = bulkForm.querySelector('[data-kodety-bulk-count]');
    var applyButton = bulkForm.querySelector('[data-kodety-bulk-apply]');

    var needsList = function () {
      var value = actionSelect ? actionSelect.value : '';
      return value === 'add_to_list' || value === 'remove_from_list';
    };

    var selectedCount = function () {
      return boxes.filter(function (box) { return box.checked; }).length;
    };

    var sync = function () {
      var selected = selectedCount();

      if (checkAll) {
        checkAll.checked = boxes.length > 0 && selected === boxes.length;
        checkAll.indeterminate = selected > 0 && selected < boxes.length;
      }
      if (allRow) {
        var showAllRow = boxes.length > 0 && selected === boxes.length;
        allRow.hidden = !showAllRow;
        if (!showAllRow && allBox) allBox.checked = false;
      }
      if (listSelect) {
        listSelect.disabled = !needsList();
        listSelect.style.opacity = listSelect.disabled ? '0.45' : '';
      }
      if (counter) {
        var total = allBox && allBox.checked ? 'todos do filtro' : selected + ' selecionado(s)';
        counter.textContent = selected === 0 && !(allBox && allBox.checked)
          ? counter.getAttribute('data-kodety-default') || counter.textContent
          : total;
      }
    };

    if (counter && !counter.getAttribute('data-kodety-default')) {
      counter.setAttribute('data-kodety-default', counter.textContent);
    }

    if (checkAll) {
      checkAll.addEventListener('change', function () {
        boxes.forEach(function (box) { box.checked = checkAll.checked; });
        sync();
      });
    }
    boxes.forEach(function (box) { box.addEventListener('change', sync); });
    if (actionSelect) actionSelect.addEventListener('change', sync);
    if (allBox) allBox.addEventListener('change', sync);

    if (applyButton) {
      applyButton.addEventListener('click', function (event) {
        var action = actionSelect ? actionSelect.value : '';
        var selected = selectedCount();
        var everything = allBox && allBox.checked;

        if (!action) {
          event.preventDefault();
          window.alert('Escolha uma ação em massa.');
          return;
        }
        if (!selected && !everything) {
          event.preventDefault();
          window.alert('Selecione ao menos um contato.');
          return;
        }
        if (needsList() && listSelect && !listSelect.value) {
          event.preventDefault();
          window.alert('Escolha a lista de destino.');
          return;
        }
        // Apagar contato não tem desfazer.
        if (action === 'delete') {
          var target = everything ? 'todos os contatos do filtro' : selected + ' contato(s)';
          if (!window.confirm('Apagar ' + target + ' definitivamente?')) event.preventDefault();
        }
      });
    }

    sync();
  }

  /**
   * Teste e disparo usam o snapshot salvo pelo backend. Se o editor estiver
   * sujo, bloquear essas ações evita enviar assunto, template ou listas
   * diferentes do que a tela aparenta.
   */
  var campaignForm = document.querySelector('[data-kodety-campaign-form]');
  if (campaignForm) {
    var dirtyNotice = document.querySelector('[data-kodety-campaign-dirty]');
    var saveButton = campaignForm.querySelector('[data-kodety-campaign-save]');
    var dependentForms = Array.prototype.slice.call(
      document.querySelectorAll('[data-kodety-requires-saved-form]')
    );
    var submittingCampaign = false;
    var ignoredFields = ['action', 'campaign_id', 'expected_revision', '_wpnonce', '_wp_http_referer'];
    var recoveryPending = campaignForm.getAttribute('data-kodety-recovered') === '1';

    function campaignSnapshot() {
      var values = [];
      new FormData(campaignForm).forEach(function (value, key) {
        if (ignoredFields.indexOf(key) !== -1) return;
        values.push(key + '=' + String(value));
      });
      return values.sort().join('&');
    }

    var savedSnapshot = campaignSnapshot();
    var campaignIsDirty = recoveryPending;

    function syncCampaignState() {
      campaignIsDirty = recoveryPending || campaignSnapshot() !== savedSnapshot;
      if (dirtyNotice) dirtyNotice.hidden = !campaignIsDirty;

      dependentForms.forEach(function (form) {
        var button = form.querySelector('[data-kodety-requires-saved]');
        if (!button || button.disabled) return;
        button.classList.toggle('is-awaiting-save', campaignIsDirty);
        if (campaignIsDirty) button.setAttribute('aria-disabled', 'true');
        else button.removeAttribute('aria-disabled');
      });
    }

    campaignForm.addEventListener('input', syncCampaignState);
    campaignForm.addEventListener('change', syncCampaignState);
    campaignForm.addEventListener('submit', function () {
      submittingCampaign = true;
    });

    dependentForms.forEach(function (form) {
      form.addEventListener('submit', function (event) {
        if (campaignIsDirty) {
          event.preventDefault();
          if (dirtyNotice) {
            dirtyNotice.hidden = false;
            dirtyNotice.setAttribute('tabindex', '-1');
            dirtyNotice.focus({ preventScroll: true });
            dirtyNotice.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else if (saveButton) {
            saveButton.focus();
          }
          return;
        }

        var blockedReason = form.getAttribute('data-kodety-blocked');
        if (blockedReason) {
          event.preventDefault();
          window.alert(blockedReason);
          var review = document.getElementById('kodety-review-title');
          if (review) {
            review.setAttribute('tabindex', '-1');
            review.focus({ preventScroll: true });
            review.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return;
        }

        var confirmation = form.getAttribute('data-kodety-confirm');
        if (confirmation && !window.confirm(confirmation)) event.preventDefault();
      });
    });

    window.addEventListener('beforeunload', function (event) {
      if (!campaignIsDirty || submittingCampaign) return;
      event.preventDefault();
      event.returnValue = '';
    });

    syncCampaignState();
  }

  // Destaque do modo de entrega selecionado e contexto dos campos SMTP.
  var options = document.querySelectorAll('.kodety-transport-option input[type="radio"]');
  var smtpPanel = document.querySelector('[data-kodety-transport-panel="smtp"]');

  function syncTransportOptions() {
    var selected = '';
    Array.prototype.forEach.call(options, function (option) {
      option.closest('.kodety-transport-option').classList.toggle('is-current', option.checked);
      if (option.checked) selected = option.value;
    });
    if (smtpPanel) smtpPanel.classList.toggle('is-context-inactive', selected !== 'smtp');
  }

  Array.prototype.forEach.call(options, function (input) {
    input.addEventListener('change', syncTransportOptions);
  });
  syncTransportOptions();

})();
