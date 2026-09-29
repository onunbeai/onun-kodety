(function () {
  'use strict';

  var SERVER_CONFIG_PREFIX = '__kodetyFormsServerConfig_';
  var SUBMISSION_TIMEOUT_MS = 12000;

  function runtimeBootstrapToken(script) {
    if (!script || typeof script.src !== 'string' || !script.src) return '';
    try {
      var token = new URL(script.src, window.location.href).hash.replace(/^#kodety-forms-bootstrap=/, '');
      return /^[a-f0-9]{32}$/i.test(token) ? token.toLowerCase() : '';
    } catch (error) {
      return '';
    }
  }

  // The server installs this snapshot immediately before this script. The
  // per-response token rejects a same-name object planted by authored code,
  // and capturing it here prevents later global mutations from changing the
  // license boundary (or the submission endpoint) after boot.
  var bootstrapToken = runtimeBootstrapToken(document.currentScript);
  var serverConfig = bootstrapToken ? window[SERVER_CONFIG_PREFIX + bootstrapToken] : null;
  var initialConfig = bootstrapToken
    && serverConfig
    && typeof serverConfig === 'object'
    && !Array.isArray(serverConfig)
    && typeof Object.isFrozen === 'function'
    && Object.isFrozen(serverConfig)
    && typeof serverConfig.bootstrapToken === 'string'
    && serverConfig.bootstrapToken.toLowerCase() === bootstrapToken
      ? serverConfig
      : {};
  var utmRuntimeEnabled = initialConfig.utmEnabled === true;

  function runtimeConfig() {
    return initialConfig;
  }

  function actionIsLocal(form) {
    var raw = (form.getAttribute('action') || '').trim();
    if (!raw || raw === '#') return true;
    try {
      var target = new URL(raw, window.location.href);
      var current = new URL(window.location.href);
      return target.origin === current.origin && target.pathname === current.pathname;
    } catch (error) {
      return false;
    }
  }

  function formKey(form) {
    return form.getAttribute('data-name') || form.getAttribute('name') || form.id || 'form';
  }

  function isMemberForm(form) {
    return form.hasAttribute('data-kodety-member-form') || form.hasAttribute('data-kodety-form-action');
  }

  function isFilterForm(form) {
    return form.dataset.kodetyFormMode === 'filter' && Boolean(form.dataset.kodetyFilterCollection);
  }

  function multiStepItems(form) {
    return Array.prototype.filter.call(form.children || [], function (element) {
      return element && element.hasAttribute && element.hasAttribute('data-kodety-form-step');
    });
  }

  function setMultiStepVisibility(step, visible) {
    var displayAttribute = 'data-kodety-form-step-display';
    var priorityAttribute = 'data-kodety-form-step-display-priority';
    if (visible) {
      var storedDisplay = step.getAttribute(displayAttribute);
      if (storedDisplay !== null) {
        var storedPriority = step.getAttribute(priorityAttribute) || '';
        if (storedDisplay) step.style.setProperty('display', storedDisplay, storedPriority);
        else step.style.removeProperty('display');
        step.removeAttribute(displayAttribute);
        step.removeAttribute(priorityAttribute);
      }
      step.hidden = false;
      step.setAttribute('aria-hidden', 'false');
      step.removeAttribute('inert');
      return;
    }
    if (!step.hasAttribute(displayAttribute)) {
      step.setAttribute(displayAttribute, step.style.getPropertyValue('display'));
      var priority = step.style.getPropertyPriority('display');
      if (priority) step.setAttribute(priorityAttribute, priority);
    }
    step.style.setProperty('display', 'none', 'important');
    step.hidden = true;
    step.setAttribute('aria-hidden', 'true');
    step.setAttribute('inert', '');
  }

  function validateStep(form, step) {
    if (form.dataset.kodetyStepValidation === 'false') return true;
    var controls = Array.prototype.filter.call(step.querySelectorAll('input, select, textarea'), function (control) {
      return !control.disabled && control.type !== 'hidden';
    });
    for (var index = 0; index < controls.length; index += 1) {
      if (typeof controls[index].checkValidity === 'function' && !controls[index].checkValidity()) {
        if (typeof controls[index].reportValidity === 'function') controls[index].reportValidity();
        if (typeof controls[index].focus === 'function') controls[index].focus({ preventScroll: true });
        if (typeof controls[index].scrollIntoView === 'function') controls[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
      }
    }
    return true;
  }

  function updateMultiStepProgress(form, active, total) {
    form.querySelectorAll('[data-kodety-form-progress]').forEach(function (progress) {
      var percent = total ? ((active + 1) / total) * 100 : 100;
      progress.setAttribute('role', progress.getAttribute('role') || 'progressbar');
      progress.setAttribute('aria-valuemin', '1');
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(active + 1));
      if (progress.tagName === 'PROGRESS') {
        progress.max = total;
        progress.value = active + 1;
      }
      var bar = progress.querySelector('[data-kodety-form-progress-bar]');
      if (bar) bar.style.width = percent + '%';
      var text = progress.querySelector('[data-kodety-form-progress-text]');
      if (text) text.textContent = 'Step ' + (active + 1) + ' of ' + total;
    });
  }

  function showMultiStep(form, requested, options) {
    var steps = multiStepItems(form);
    if (!steps.length) return false;
    var active = Math.max(0, Math.min(steps.length - 1, Number(requested) || 0));
    steps.forEach(function (step, index) {
      var visible = index === active;
      setMultiStepVisibility(step, visible);
    });
    form.dataset.kodetyStepActive = String(active + 1);
    updateMultiStepProgress(form, active, steps.length);
    form.dispatchEvent(new CustomEvent('kodety:form:step', {
      bubbles: true,
      detail: { form: form, step: active + 1, total: steps.length, direction: options && options.direction || 'direct' },
    }));
    if (options && options.focus) {
      var focusTarget = steps[active].querySelector('[autofocus], input:not([type="hidden"]), select, textarea, button, a[href]');
      if (focusTarget && typeof focusTarget.focus === 'function') window.setTimeout(function () { focusTarget.focus({ preventScroll: true }); }, 0);
    }
    return true;
  }

  function bindMultiStep(form) {
    if (form.dataset.kodetyMultistep !== 'true' || form.dataset.kodetyMultistepBound === 'true') return;
    var steps = multiStepItems(form);
    if (!steps.length) return;
    form.dataset.kodetyMultistepBound = 'true';
    showMultiStep(form, Math.max(0, (Number(form.dataset.kodetyStepActive) || 1) - 1));
    form.addEventListener('click', function (event) {
      var control = event.target && event.target.closest
        ? event.target.closest('[data-kodety-form-next], [data-kodety-form-prev], [data-kodety-form-goto]')
        : null;
      if (!control || !form.contains(control) || control.disabled) return;
      var current = Math.max(0, (Number(form.dataset.kodetyStepActive) || 1) - 1);
      var direction = control.hasAttribute('data-kodety-form-prev') ? 'back' : 'next';
      var target = control.hasAttribute('data-kodety-form-goto')
        ? Math.max(0, Number(control.getAttribute('data-kodety-form-goto')) - 1)
        : current + (direction === 'back' ? -1 : 1);
      if (direction !== 'back' && target > current && !validateStep(form, steps[current])) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      showMultiStep(form, target, { direction: direction, focus: true });
    });
    form.addEventListener('submit', function (event) {
      var current = Math.max(0, (Number(form.dataset.kodetyStepActive) || 1) - 1);
      if (current >= steps.length - 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (validateStep(form, steps[current])) showMultiStep(form, current + 1, { direction: 'next', focus: true });
    }, true);
    form.addEventListener('reset', function () {
      window.setTimeout(function () { showMultiStep(form, 0); }, 0);
    });
  }

  function routeMemberForm(form) {
    if (form.dataset.kodetyFormsRoute === 'member') return;
    form.dataset.kodetyFormsRoute = 'member';
    var action = (form.getAttribute('data-kodety-form-action') || form.getAttribute('data-kodety-member-form') || '').trim();
    form.dispatchEvent(new CustomEvent('kodety:member-form:ready', {
      bubbles: true,
      detail: { action: action, form: form },
    }));
  }

  function parseJson(value, fallback) {
    try {
      var parsed = JSON.parse(value || '');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function comparable(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function valuesForControl(form, name) {
    var controls = Array.prototype.filter.call(form.elements || [], function (control) {
      return control && control.name === name && !control.disabled;
    });
    if (!controls.length) return [];
    var first = controls[0];
    if (first.type === 'checkbox' || first.type === 'radio') {
      return controls.filter(function (control) { return control.checked; }).map(function (control) { return control.value; });
    }
    if (first.tagName === 'SELECT' && first.multiple) {
      return Array.prototype.filter.call(first.options, function (option) { return option.selected; }).map(function (option) { return option.value; });
    }
    return [first.value];
  }

  function candidateValues(raw) {
    if (Array.isArray(raw)) return raw.reduce(function (all, value) { return all.concat(candidateValues(value)); }, []);
    if (raw && typeof raw === 'object') return candidateValues(raw.value || raw.label || raw.title || raw.url || '');
    return [raw];
  }

  function matchesFilter(raw, query, operator) {
    var queries = Array.isArray(query) ? query.filter(function (value) { return comparable(value) !== ''; }) : [query];
    if (!queries.length || queries.every(function (value) { return comparable(value) === ''; })) return true;
    var candidates = candidateValues(raw);
    return queries.some(function (queryValue) {
      return candidates.some(function (candidate) {
        var left = comparable(candidate);
        var right = comparable(queryValue);
        if (operator === 'equals') return left === right;
        if (operator === 'starts_with') return left.indexOf(right) === 0;
        if (operator === 'gte' || operator === 'lte') {
          var leftNumber = Number(candidate);
          var rightNumber = Number(queryValue);
          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return operator === 'gte' ? leftNumber >= rightNumber : leftNumber <= rightNumber;
          return operator === 'gte' ? left >= right : left <= right;
        }
        return left.indexOf(right) !== -1;
      });
    });
  }

  function filterItems(collection) {
    return Array.prototype.filter.call(document.querySelectorAll('[data-kodety-rendered-item]'), function (item) {
      return item.dataset.kodetyRenderedItem === collection;
    });
  }

  function populateFilterOptions(form, mapping, items) {
    Object.keys(mapping).forEach(function (name) {
      var rule = mapping[name] || {};
      if (rule.options !== 'cms' || !rule.field) return;
      var select = Array.prototype.find.call(form.elements || [], function (control) {
        return control && control.name === name && control.tagName === 'SELECT';
      });
      if (!select) return;
      var values = [];
      items.forEach(function (item) {
        var payload = parseJson(item.dataset.kodetyFilterValues, {});
        candidateValues(payload[rule.field]).forEach(function (value) {
          if (value == null || comparable(value) === '') return;
          var label = String(value);
          if (!values.some(function (entry) { return comparable(entry) === comparable(label); })) values.push(label);
        });
      });
      values.sort(function (left, right) { return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }); });
      var signature = JSON.stringify(values);
      if (select.dataset.kodetyCmsOptionsSignature === signature) return;
      var selected = select.value;
      var placeholder = Array.prototype.find.call(select.options, function (option) { return option.value === ''; });
      select.replaceChildren();
      if (placeholder) select.appendChild(placeholder);
      values.forEach(function (value) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
      select.value = selected;
      select.dataset.kodetyCmsOptionsSignature = signature;
    });
  }

  function syncFilterUrl(form, mapping) {
    if (form.dataset.kodetyFilterUrl === 'false' || !window.history || !window.history.replaceState) return;
    var url = new URL(window.location.href);
    Object.keys(mapping).forEach(function (name) {
      var values = valuesForControl(form, name).filter(function (value) { return comparable(value) !== ''; });
      url.searchParams.delete(name);
      values.forEach(function (value) { url.searchParams.append(name, value); });
    });
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }

  function applyFilters(form) {
    var collection = form.dataset.kodetyFilterCollection || '';
    var mapping = parseJson(form.dataset.kodetyFilterMap, {});
    var items = filterItems(collection);
    populateFilterOptions(form, mapping, items);
    var visible = 0;
    var limit = items.length ? Math.max(1, Number(items[0].dataset.kodetyFilterLimit) || items.length) : 0;
    items.forEach(function (item) {
      var values = parseJson(item.dataset.kodetyFilterValues, {});
      var matches = Object.keys(mapping).every(function (name) {
        var rule = mapping[name] || {};
        if (!rule.field) return true;
        return matchesFilter(values[rule.field], valuesForControl(form, name), rule.operator || 'contains');
      });
      if (matches && visible < limit) {
        item.hidden = false;
        visible += 1;
      } else {
        item.hidden = true;
      }
    });
    document.querySelectorAll('[data-kodety-filter-count]').forEach(function (element) {
      var target = element.getAttribute('data-kodety-filter-count');
      if (!target || target === collection) element.textContent = String(visible);
    });
    document.querySelectorAll('[data-kodety-filter-empty]').forEach(function (element) {
      var target = element.getAttribute('data-kodety-filter-empty');
      if (!target || target === collection) element.hidden = visible !== 0;
    });
    syncFilterUrl(form, mapping);
    form.dispatchEvent(new CustomEvent('kodety:filter:change', { bubbles: true, detail: { collection: collection, visible: visible } }));
  }

  function bindFilter(form) {
    if (form.dataset.kodetyFilterBound === 'true') return;
    form.dataset.kodetyFilterBound = 'true';
    var mapping = parseJson(form.dataset.kodetyFilterMap, {});
    var initialUrl = new URL(window.location.href);
    Object.keys(mapping).forEach(function (name) {
      var fromUrl = initialUrl.searchParams.getAll(name);
      if (!fromUrl.length) return;
      Array.prototype.forEach.call(form.elements || [], function (control) {
        if (!control || control.name !== name) return;
        if (control.type === 'checkbox' || control.type === 'radio') control.checked = fromUrl.indexOf(control.value) !== -1;
        else control.value = fromUrl[0];
      });
    });
    var timer = 0;
    var schedule = function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { applyFilters(form); }, 140);
    };
    form.addEventListener('submit', function (event) { event.preventDefault(); applyFilters(form); }, true);
    form.addEventListener('reset', function () { window.setTimeout(function () { applyFilters(form); }, 0); });
    if (form.dataset.kodetyFilterOn !== 'submit') {
      form.addEventListener('input', schedule);
      form.addEventListener('change', schedule);
    }
    form.querySelectorAll('input[type="range"][data-kodety-range-output]').forEach(function (control) {
      var updateOutput = function () {
        try {
          var output = document.querySelector(control.dataset.kodetyRangeOutput);
          if (output) output.textContent = control.value;
        } catch (error) {}
      };
      control.addEventListener('input', updateOutput);
      updateOutput();
    });
    applyFilters(form);
  }

  function statusElements(form) {
    var wrapper = form.closest('.w-form');
    return {
      done: form.querySelector('[data-kodety-form-success]') || (wrapper ? wrapper.querySelector('.w-form-done') : null),
      fail: form.querySelector('[data-kodety-form-error]') || (wrapper ? wrapper.querySelector('.w-form-fail') : null),
    };
  }

  function revealElement(target, message) {
    if (!target) return null;
    target.hidden = false;
    target.removeAttribute('aria-hidden');
    target.removeAttribute('inert');
    target.setAttribute('data-kodety-form-revealed', 'true');
    if (target.style) {
      var inlineDisplay = typeof target.style.getPropertyValue === 'function'
        ? target.style.getPropertyValue('display')
        : target.style.display;
      if (inlineDisplay === 'none' && typeof target.style.removeProperty === 'function') target.style.removeProperty('display');
      if (typeof window.getComputedStyle === 'function' && window.getComputedStyle(target).display === 'none') {
        target.style.setProperty('display', target.getAttribute('data-kodety-form-display') || 'block', 'important');
      }
    }
    var messageTarget = target.hasAttribute('data-kodety-form-message')
      ? target
      : target.querySelector('[data-kodety-form-message]');
    if (message && messageTarget) messageTarget.textContent = message;
    return target;
  }

  function revealTarget(selector, message) {
    if (!selector) return null;
    try {
      return revealElement(document.querySelector(selector), message);
    } catch (error) {
      return null;
    }
  }

  function targetContains(target, element) {
    return Boolean(target && element && (target === element || (typeof target.contains === 'function' && target.contains(element))));
  }

  function setStatusVisibility(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    if (visible) {
      element.removeAttribute('aria-hidden');
      element.removeAttribute('inert');
      if (element.style && element.style.display === 'none') element.style.display = '';
      return;
    }
    element.setAttribute('aria-hidden', 'true');
    if (element.style) element.style.display = 'none';
  }

  function showStatus(form, ok, message) {
    var elements = statusElements(form);
    var successAction = form.dataset.kodetySuccessAction || 'message';
    var targetSelector = ok ? form.dataset.kodetySuccessTarget : form.dataset.kodetyErrorTarget;
    var wantsExplicitTarget = Boolean(targetSelector && (!ok || successAction === 'element'));
    var explicitTarget = wantsExplicitTarget ? revealTarget(targetSelector, message) : null;
    if (ok && successAction === 'element' && !explicitTarget && elements.done) {
      explicitTarget = revealElement(elements.done, message);
    }
    var doneVisible = ok && (!explicitTarget || targetContains(explicitTarget, elements.done));
    var failVisible = !ok && (!explicitTarget || targetContains(explicitTarget, elements.fail));
    if (elements.done) {
      setStatusVisibility(elements.done, doneVisible);
      if (doneVisible && message && !targetContains(explicitTarget, elements.done)) {
        (elements.done.querySelector('[data-kodety-form-message]') || elements.done).textContent = message;
      }
    }
    if (elements.fail) {
      setStatusVisibility(elements.fail, failVisible);
      if (failVisible && message && !targetContains(explicitTarget, elements.fail)) {
        (elements.fail.querySelector('[data-kodety-form-message]') || elements.fail).textContent = message;
      }
    }
    if (!elements.done && !elements.fail && !explicitTarget) {
      var status = form.querySelector('[data-kodety-form-status]');
      if (!status) {
        status = document.createElement('div');
        status.setAttribute('data-kodety-form-status', '');
        status.setAttribute('role', 'status');
        status.style.cssText = 'box-sizing:border-box;width:100%;padding:12px 14px;border:1px solid;border-radius:12px;font:500 14px/1.45 system-ui,sans-serif;';
        form.appendChild(status);
      }
      status.textContent = message || '';
      status.dataset.state = ok ? 'success' : 'error';
      status.style.borderColor = ok ? '#a7e8c7' : '#fecaca';
      status.style.background = ok ? '#ecfdf5' : '#fef2f2';
      status.style.color = ok ? '#065f46' : '#991b1b';
    }
  }

  function setBusy(form, busy) {
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach(function (control) {
      control.disabled = busy;
      var isInput = control.tagName === 'INPUT';
      var current = isInput ? control.value : control.innerHTML;
      if (busy) {
        control.dataset.kodetyOriginalLabel = current || '';
        var loading = control.dataset.kodetyLoadingLabel || form.dataset.kodetySubmittingLabel || 'Sending…';
        if (isInput) control.value = loading; else control.textContent = loading;
      } else if (control.dataset.kodetyOriginalLabel !== undefined) {
        if (isInput) control.value = control.dataset.kodetyOriginalLabel; else control.innerHTML = control.dataset.kodetyOriginalLabel;
        delete control.dataset.kodetyOriginalLabel;
      }
    });
  }

  var REDIRECT_UTM_PARAMETERS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var REDIRECT_SESSION_KEY = 'kodety-form-utms-v1';
  var REDIRECT_MAPPING_LIMIT = 40;
  var REDIRECT_PARAMETER_NAME_LIMIT = 64;
  var REDIRECT_SOURCE_NAME_LIMIT = 128;
  var REDIRECT_VALUE_LIMIT = 1000;
  var REDIRECT_UTM_VALUE_LIMIT = 500;
  var REDIRECT_TEMPLATE_LIMIT = 1000;
  // 40 canonical mappings can legitimately exceed 16 KiB once IDs, source
  // names and escaped template values are serialized into the data attribute.
  var REDIRECT_CONFIG_LIMIT = 131072;
  var REDIRECT_SESSION_LIMIT = 8192;
  var REDIRECT_BASE_URL_LIMIT = 4096;
  var REDIRECT_URL_LIMIT = 8192;
  var REDIRECT_PROVIDER_PRESETS = {
    hotmart: {
      supportedUtms: REDIRECT_UTM_PARAMETERS.slice(),
      supported: REDIRECT_UTM_PARAMETERS.concat(['name', 'email', 'phoneac', 'phonenumber', 'doc', 'zip', 'src', 'sck', 'checkoutmode', 'off', 'offdiscount', 'bid']),
      protected: ['checkoutmode', 'src', 'sck', 'off', 'offdiscount', 'bid'],
    },
    ticto: {
      supportedUtms: REDIRECT_UTM_PARAMETERS.slice(),
      supported: REDIRECT_UTM_PARAMETERS.concat(['name', 'email', 'phonenumber', 'doc', 'zip', 'src', 'sck', 'pid', 'kdt_ref', 'offer', 'product']),
      protected: ['pid', 'src', 'sck', 'kdt_ref', 'offer', 'product'],
    },
    kiwify: {
      supportedUtms: REDIRECT_UTM_PARAMETERS.slice(),
      supported: REDIRECT_UTM_PARAMETERS.concat(['name', 'email', 'phone', 'cpf', 'region', 'src', 'sck', 's1', 's2', 's3', 'afid', 'coupon', 'offer', 'product', 'checkout']),
      protected: ['afid', 'coupon', 'src', 'sck', 'offer', 'product', 'checkout'],
    },
    eduzz: {
      supportedUtms: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'],
      supported: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'name', 'email', 'phone', 'doc', 'zip', 'country', 'num', 'comp', 'state', 'city', 'street', 'district', 'a', 'cupom', 'currency', 'installments', 'p', 'pf', 'np', 'skip'],
      protected: ['a', 'cupom', 'currency', 'installments', 'p', 'pf', 'np', 'skip'],
    },
    custom: { supportedUtms: REDIRECT_UTM_PARAMETERS.slice(), supported: null, protected: [] },
  };

  function owns(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function redirectParameterName(value) {
    var name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > REDIRECT_PARAMETER_NAME_LIMIT) return '';
    return /^[A-Za-z][A-Za-z0-9_.:\[\]\-]*$/.test(name) ? name : '';
  }

  function redirectSourceName(value) {
    var name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > REDIRECT_SOURCE_NAME_LIMIT) return '';
    return /[\u0000-\u001f\u007f]/.test(name) ? '' : name;
  }

  function redirectText(value, limit) {
    if (value == null) return '';
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
    return String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit || REDIRECT_VALUE_LIMIT);
  }

  function redirectLookup(values) {
    var lookup = Object.create(null);
    (values || []).forEach(function (value) {
      var name = redirectParameterName(value);
      if (name) lookup[name.toLowerCase()] = true;
    });
    return lookup;
  }

  function addRedirectLookupValues(lookup, values) {
    if (values == null) return true;
    if (!Array.isArray(values) || values.length > REDIRECT_MAPPING_LIMIT) return false;
    for (var index = 0; index < values.length; index += 1) {
      var name = redirectParameterName(values[index]);
      if (!name) return false;
      lookup[name.toLowerCase()] = true;
    }
    return true;
  }

  function redirectDntEnabled() {
    var navigatorValue = window.navigator || {};
    return [navigatorValue.doNotTrack, navigatorValue.msDoNotTrack, window.doNotTrack].some(function (value) {
      return value === '1' || String(value || '').toLowerCase() === 'yes';
    });
  }

  function redirectUtmsFromPage(pageUrl) {
    var values = Object.create(null);
    REDIRECT_UTM_PARAMETERS.forEach(function (name) {
      var value = redirectText(pageUrl.searchParams.get(name), REDIRECT_UTM_VALUE_LIMIT);
      if (value !== '') values[name] = value;
    });
    return values;
  }

  function redirectUtmsFromStored(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
    var values = Object.create(null);
    REDIRECT_UTM_PARAMETERS.forEach(function (name) {
      var stored = redirectText(value[name], REDIRECT_UTM_VALUE_LIMIT);
      if (stored !== '') values[name] = stored;
    });
    return values;
  }

  function redirectSessionUtms(pageUrl, rememberSession) {
    var current = redirectUtmsFromPage(pageUrl);
    if (rememberSession !== true || redirectDntEnabled()) return current;
    var hasCurrent = Object.keys(current).length > 0;
    try {
      if (hasCurrent) {
        window.sessionStorage.setItem(REDIRECT_SESSION_KEY, JSON.stringify(current));
        return current;
      }
      var raw = window.sessionStorage.getItem(REDIRECT_SESSION_KEY) || '';
      if (!raw || raw.length > REDIRECT_SESSION_LIMIT) return current;
      return redirectUtmsFromStored(JSON.parse(raw));
    } catch (error) {
      return current;
    }
  }

  function redirectFormSnapshot(data, rememberSession) {
    var fields = Object.create(null);
    data.forEach(function (value, name) {
      if (typeof value !== 'string' || typeof name !== 'string') return;
      if (!owns(fields, name)) fields[name] = [];
      if (fields[name].length < REDIRECT_MAPPING_LIMIT) fields[name].push(redirectText(value));
    });
    var pageUrl;
    try {
      pageUrl = new URL(window.location.href);
    } catch (error) {
      return null;
    }
    return { fields: fields, pageUrl: pageUrl, utms: redirectSessionUtms(pageUrl, rememberSession) };
  }

  function redirectFirstFieldValue(snapshot, name) {
    if (!snapshot || !owns(snapshot.fields, name)) return '';
    var values = snapshot.fields[name];
    for (var index = 0; index < values.length; index += 1) {
      if (values[index] !== '') return values[index];
    }
    return values.length ? values[0] : '';
  }

  function redirectUtmName(value) {
    var name = redirectParameterName(value).toLowerCase();
    return REDIRECT_UTM_PARAMETERS.indexOf(name) !== -1 ? name : '';
  }

  function redirectSnapshotValue(snapshot, type, rawName) {
    var name = redirectSourceName(rawName);
    if (!name) return null;
    if (type === 'field') return redirectFirstFieldValue(snapshot, name);
    if (type === 'utm') {
      var utmName = redirectUtmName(name);
      return utmName ? redirectText(snapshot.utms[utmName], REDIRECT_UTM_VALUE_LIMIT) : null;
    }
    if (type === 'query') {
      var queryName = redirectParameterName(name);
      return queryName ? redirectText(snapshot.pageUrl.searchParams.get(queryName)) : null;
    }
    return null;
  }

  function renderRedirectTemplate(template, snapshot) {
    if (typeof template !== 'string' || template.length > REDIRECT_TEMPLATE_LIMIT) return null;
    var resolve = function (match, type, name) {
      var value = redirectSnapshotValue(snapshot, String(type).toLowerCase(), name);
      return value == null ? match : value;
    };
    var rendered = template
      .replace(/\{\{\s*(field|utm|query)\s*[:.]\s*([A-Za-z0-9_.:\-\[\]]+)\s*\}\}/gi, resolve)
      .replace(/\{\s*(field|utm|query)\s*:\s*([A-Za-z0-9_.:\-\[\]]+)\s*\}/gi, resolve)
      .replace(/\{\s*(utm_(?:source|medium|campaign|content|term))\s*\}/gi, function (match, name) {
        return resolve(match, 'utm', name);
      })
      .replace(/\[\s*(field|utm|query)\s+id\s*=\s*(["'])([^"']+)\2\s*\]/gi, function (match, type, quote, name) {
        return resolve(match, type, name);
      });
    if (/\{\{|\}\}|\{\s*(?:field|utm|query)\s*:|\{\s*utm_(?:source|medium|campaign|content|term)\s*\}|\[\s*(?:field|utm|query)\b/i.test(rendered)) return null;
    return redirectText(rendered);
  }

  function normalizeRedirectMapping(mapping) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return null;
    var nestedSource = mapping.source && typeof mapping.source === 'object' && !Array.isArray(mapping.source)
      ? mapping.source
      : mapping.origin && typeof mapping.origin === 'object' && !Array.isArray(mapping.origin)
        ? mapping.origin
        : {};
    var source = typeof mapping.source === 'string' ? mapping.source : nestedSource.type;
    var sourceKey = mapping.sourceKey || mapping.key || nestedSource.key || nestedSource.name || nestedSource.field || nestedSource.parameter || '';
    var value = owns(mapping, 'value')
      ? mapping.value
      : owns(nestedSource, 'template')
        ? nestedSource.template
        : owns(nestedSource, 'value') ? nestedSource.value : '';
    return {
      parameter: mapping.parameter || mapping.param || mapping.target || mapping.name,
      source: typeof source === 'string' ? source.trim().toLowerCase() : '',
      sourceKey: sourceKey,
      value: value,
      transform: mapping.transform || nestedSource.transform || 'trim',
      conflict: mapping.conflict === 'replace' ? 'replace' : 'preserve',
    };
  }

  function redirectSourceValue(mapping, snapshot) {
    var type = mapping.source;
    if (type === 'fixed') {
      return redirectText(mapping.value);
    }
    if (type === 'template') {
      return renderRedirectTemplate(mapping.value, snapshot);
    }
    if (type !== 'field' && type !== 'utm' && type !== 'query') return null;
    return redirectSnapshotValue(snapshot, type, mapping.sourceKey);
  }

  function redirectPhoneDigits(value) {
    var digits = String(value || '').replace(/\D+/g, '');
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    if ((digits.length === 12 || digits.length === 13) && digits.indexOf('55') === 0) digits = digits.slice(2);
    return digits;
  }

  function transformRedirectValue(value, transform) {
    var mode = typeof transform === 'string' && transform ? transform.trim().toLowerCase() : 'none';
    var text = redirectText(value);
    if (mode === 'none') return text;
    if (mode === 'trim') return text.trim();
    if (mode === 'digits') return text.replace(/\D+/g, '');
    if (mode === 'phone_area') {
      var areaDigits = redirectPhoneDigits(text);
      if (areaDigits.length === 2) return areaDigits;
      return areaDigits.length >= 10 ? areaDigits.slice(0, 2) : '';
    }
    if (mode === 'phone_number') {
      var phoneDigits = redirectPhoneDigits(text);
      return phoneDigits.length >= 10 ? phoneDigits.slice(2) : phoneDigits;
    }
    if (mode === 'slug') {
      return text.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, REDIRECT_VALUE_LIMIT);
    }
    return null;
  }

  function redirectSearchNames(parameters, requestedName) {
    var wanted = requestedName.toLowerCase();
    var found = [];
    parameters.forEach(function (value, name) {
      if (name.toLowerCase() === wanted && found.indexOf(name) === -1) found.push(name);
    });
    return found;
  }

  function setRedirectParameter(parameters, name, value, protectedLookup, conflict) {
    var existingNames = redirectSearchNames(parameters, name);
    if (existingNames.length && (protectedLookup[name.toLowerCase()] || conflict !== 'replace')) return false;
    existingNames.forEach(function (existingName) { parameters.delete(existingName); });
    parameters.set(name, redirectText(value));
    return true;
  }

  function parseUtmRedirectConfig(form) {
    if (!utmRuntimeEnabled) return null;
    if (form.getAttribute('data-kodety-utm-enabled') !== 'true') return null;
    var raw = form.getAttribute('data-kodety-utm-config') || '';
    if (!raw || raw.length > REDIRECT_CONFIG_LIMIT) return null;
    try {
      var config = JSON.parse(raw);
      if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
      if (config.version != null && Number(config.version) !== 1) return null;
      return config;
    } catch (error) {
      return null;
    }
  }

  function buildUtmRedirect(form, data) {
    var config = parseUtmRedirectConfig(form);
    if (!config) return null;
    var providerName = typeof config.provider === 'string' ? config.provider : config.preset;
    providerName = typeof providerName === 'string' && providerName ? providerName.trim().toLowerCase() : 'custom';
    if (!owns(REDIRECT_PROVIDER_PRESETS, providerName)) return null;
    var preset = REDIRECT_PROVIDER_PRESETS[providerName];
    var supportedLookup = preset.supported ? redirectLookup(preset.supported) : null;
    if (providerName === 'custom' && config.supportedParams != null) {
      supportedLookup = redirectLookup(REDIRECT_UTM_PARAMETERS);
      if (!addRedirectLookupValues(supportedLookup, config.supportedParams)) return null;
    }
    var protectedLookup = redirectLookup(preset.protected);
    if (!addRedirectLookupValues(protectedLookup, config.protectedParams)) return null;
    var rawBaseUrl = typeof config.url === 'string' && config.url
      ? config.url
      : typeof config.baseUrl === 'string' && config.baseUrl
        ? config.baseUrl
        : form.getAttribute('data-kodety-redirect-url') || '';
    if (!rawBaseUrl || rawBaseUrl.length > REDIRECT_BASE_URL_LIMIT) return null;
    var redirectUrl;
    try {
      redirectUrl = new URL(rawBaseUrl, window.location.href);
    } catch (error) {
      return null;
    }
    if (!/^https?:$/.test(redirectUrl.protocol)) return null;
    var snapshot = redirectFormSnapshot(data, config.rememberSession === true);
    if (!snapshot) return null;
    var parameters = new URLSearchParams(redirectUrl.search);
    var mappings = config.mappings == null ? [] : config.mappings;
    if (!Array.isArray(mappings) || mappings.length > REDIRECT_MAPPING_LIMIT) return null;
    var seenParameters = Object.create(null);
    for (var index = 0; index < mappings.length; index += 1) {
      var mapping = normalizeRedirectMapping(mappings[index]);
      if (!mapping) return null;
      var parameter = redirectParameterName(mapping.parameter);
      if (!parameter) return null;
      var normalizedParameter = parameter.toLowerCase();
      if (seenParameters[normalizedParameter]) return null;
      seenParameters[normalizedParameter] = true;
      if (supportedLookup && !supportedLookup[normalizedParameter]) return null;
      var rawValue = redirectSourceValue(mapping, snapshot);
      if (rawValue == null) return null;
      var value = transformRedirectValue(rawValue, mapping.transform || 'none');
      if (value == null) return null;
      if (value !== '') setRedirectParameter(parameters, parameter, value, protectedLookup, mapping.conflict);
    }
    if (config.forwardUtms === true) {
      preset.supportedUtms.forEach(function (name) {
        var value = redirectText(snapshot.utms[name], REDIRECT_UTM_VALUE_LIMIT);
        if (value !== '') setRedirectParameter(parameters, name, value, protectedLookup, 'preserve');
      });
    }
    redirectUrl.search = parameters.toString();
    return redirectUrl.href.length <= REDIRECT_URL_LIMIT ? redirectUrl.href : null;
  }

  function resolveUtmRedirect(form, data) {
    try {
      return buildUtmRedirect(form, data);
    } catch (error) {
      return null;
    }
  }

  function safeRedirect(raw) {
    if (!raw) return false;
    try {
      var url = new URL(raw, window.location.href);
      if (!/^https?:$/.test(url.protocol)) return false;
      window.location.assign(url.href);
      return true;
    } catch (error) {
      return false;
    }
  }

  function canCaptureSubmission(form) {
    return Boolean(runtimeConfig().endpoint)
      && form.dataset.kodetyCapture !== 'false'
      && actionIsLocal(form);
  }

  function submitForm(form, event) {
    if (!canCaptureSubmission(form)) return;
    var config = runtimeConfig();
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.getAttribute('aria-busy') === 'true') return;
    var unnamedFileIndex = 0;
    form.querySelectorAll('input[type="file"]:not([name])').forEach(function (input) {
      unnamedFileIndex += 1;
      input.name = unnamedFileIndex === 1 ? 'file' : 'file_' + unnamedFileIndex;
    });
    var data = new FormData(form);
    var utmRedirectUrl = resolveUtmRedirect(form, data);
    data.set('_kodety_form', formKey(form));
    data.set('_kodety_page_url', window.location.href);
    data.set('_kodety_referrer', document.referrer || '');
    data.set('_kodety_started', form.dataset.kodetyStarted || String(Date.now()));
    if (!data.has('_kodety_hp')) data.set('_kodety_hp', '');
    if (form.dataset.kodetyCmsCollection && form.dataset.kodetyCmsStatus && form.dataset.kodetyCmsMap && form.dataset.kodetyCmsToken) {
      data.set('_kodety_cms_collection', form.dataset.kodetyCmsCollection);
      data.set('_kodety_cms_status', form.dataset.kodetyCmsStatus);
      data.set('_kodety_cms_map', form.dataset.kodetyCmsMap);
      data.set('_kodety_cms_token', form.dataset.kodetyCmsToken);
    }
    setBusy(form, true);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var requestTimedOut = false;
    var timeoutId = controller ? window.setTimeout(function () {
      requestTimedOut = true;
      controller.abort();
    }, SUBMISSION_TIMEOUT_MS) : 0;
    var requestOptions = {
      method: 'POST', body: data, credentials: 'same-origin', headers: { Accept: 'application/json' },
    };
    if (controller) requestOptions.signal = controller.signal;
    var request;
    try {
      request = fetch(config.endpoint, requestOptions);
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(function (response) {
      return response.json().catch(function () {
        throw new Error(config.errorMessage || 'The server returned an invalid response. Please try again.');
      }).then(function (body) {
        if (!response.ok || !body || body.success !== true) throw new Error(body && body.message || config.errorMessage || 'Could not submit the form.');
        return body;
      });
    }).then(function (body) {
      var message = form.dataset.kodetySuccessMessage || body.message || config.successMessage || 'Thanks! Your message has been sent.';
      var action = form.dataset.kodetySuccessAction || 'message';
      showStatus(form, true, message);
      if (form.dataset.kodetyResetOnSuccess !== 'false') form.reset();
      form.dispatchEvent(new CustomEvent('kodety:form:success', { bubbles: true, detail: body }));
      if (action === 'redirect') safeRedirect(utmRedirectUrl || form.dataset.kodetyRedirectUrl || '');
    }).catch(function (error) {
      var transportMessage = requestTimedOut
        ? 'The connection took too long. Check your internet connection and try again.'
        : window.navigator && window.navigator.onLine === false
          ? 'You appear to be offline. Reconnect and try again.'
          : error && error.message;
      var message = form.dataset.kodetyErrorMessage || transportMessage || config.errorMessage || 'Something went wrong. Please try again.';
      showStatus(form, false, message);
      form.dispatchEvent(new CustomEvent('kodety:form:error', { bubbles: true, detail: { message: message } }));
    }).finally(function () {
      if (timeoutId) window.clearTimeout(timeoutId);
      setBusy(form, false);
    });
  }

  function bindSubmission(form) {
    if (!canCaptureSubmission(form) || form.__kodetySubmissionBound === true) return;
    form.__kodetySubmissionBound = true;
    form.dataset.kodetyFormsBound = 'true';
    form.addEventListener('submit', function (event) {
      submitForm(form, event);
    }, true);
  }

  function bind(form) {
    if (isMemberForm(form)) { routeMemberForm(form); return; }
    if (!form.dataset.kodetyStarted) form.dataset.kodetyStarted = String(Date.now());
    bindMultiStep(form);
    if (isFilterForm(form)) { bindFilter(form); return; }
    bindSubmission(form);
  }

  function initialize(root) {
    if (root && root.matches && root.matches('form')) bind(root);
    (root || document).querySelectorAll('form').forEach(bind);
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.matches || !form.matches('form')) return;
    if (form.__kodetySubmissionBound === true || isMemberForm(form) || isFilterForm(form)) return;
    var steps = multiStepItems(form);
    var activeStep = Math.max(0, (Number(form.dataset.kodetyStepActive) || 1) - 1);
    if (steps.length && activeStep < steps.length - 1) return;
    submitForm(form, event);
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { initialize(document); }, { once: true });
  else initialize(document);
  window.addEventListener('load', function () { initialize(document); }, { once: true });
  if ('MutationObserver' in window) {
    new MutationObserver(function (records) {
      records.forEach(function (record) { record.addedNodes.forEach(function (node) { if (node.nodeType === 1) initialize(node); }); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
