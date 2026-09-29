(function () {
  'use strict';

  var config = window.kodetyMembership || {};
  var bound = new WeakSet();
  var publicActions = new Set(['login', 'register', 'forgot-password', 'reset-password']);
  var actionAliases = {
    'member-login': 'login',
    'member-register': 'register',
    'member-forgot': 'forgot-password',
    'member-forgot-password': 'forgot-password',
    'member-reset': 'reset-password',
    'member-reset-password': 'reset-password',
    'member-profile': 'profile',
    'member-logout': 'logout',
    forgot: 'forgot-password',
    forgot_password: 'forgot-password',
    reset: 'reset-password',
    reset_password: 'reset-password',
    account: 'profile',
    me: 'profile',
  };

  function normalizeAction(value) {
    var action = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
    return actionAliases[action] || action;
  }

  function endpoint(action) {
    var endpoints = config.endpoints || {};
    return endpoints[action] || '';
  }

  function formValue(data, names) {
    for (var index = 0; index < names.length; index += 1) {
      var value = data.get(names[index]);
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return '';
  }

  function hasFormValue(data, names) {
    return names.some(function (name) { return data.has(name); });
  }

  function queryValue(names) {
    var query = new URLSearchParams(window.location.search);
    for (var index = 0; index < names.length; index += 1) {
      var value = query.get(names[index]);
      if (value) return value;
    }
    return '';
  }

  function payloadFor(form, action) {
    var data = new FormData(form);
    var password = formValue(data, ['password', 'user_password', 'pass']);
    var confirmation = formValue(data, [
      'passwordConfirmation',
      'password_confirmation',
      'confirm_password',
      'password_confirm',
    ]);
    if (confirmation && password !== confirmation) {
      throw new Error('As senhas informadas não são iguais.');
    }
    if (action === 'login') {
      return {
        login: formValue(data, ['login', 'email', 'username', 'user_login']),
        password: password,
        remember: data.has('remember') || data.has('rememberme'),
      };
    }
    if (action === 'register') {
      return {
        email: formValue(data, ['email', 'user_email']),
        password: password,
        displayName: formValue(data, ['displayName', 'display_name', 'name']),
      };
    }
    if (action === 'forgot-password') {
      return { login: formValue(data, ['login', 'email', 'username', 'user_login']) };
    }
    if (action === 'reset-password') {
      return {
        login: formValue(data, ['login', 'username', 'user_login', 'user'])
          || form.dataset.kodetyResetLogin
          || (window.kodetyMembershipReset || {}).login
          || queryValue(['login']),
        key: formValue(data, ['key', 'reset_key', 'token'])
          || form.dataset.kodetyResetKey
          || (window.kodetyMembershipReset || {}).key
          || queryValue(['key']),
        password: password,
      };
    }
    if (action === 'profile') {
      var profile = {};
      var displayNames = ['displayName', 'display_name', 'name'];
      var firstNames = ['firstName', 'first_name'];
      var lastNames = ['lastName', 'last_name'];
      if (hasFormValue(data, displayNames)) profile.displayName = formValue(data, displayNames);
      if (hasFormValue(data, firstNames)) profile.firstName = formValue(data, firstNames);
      if (hasFormValue(data, lastNames)) profile.lastName = formValue(data, lastNames);
      return profile;
    }
    return {};
  }

  function statusTargets(form) {
    var wrapper = form.closest('.w-form');
    return {
      done: wrapper ? wrapper.querySelector('.w-form-done') : null,
      fail: wrapper ? wrapper.querySelector('.w-form-fail') : null,
    };
  }

  function showStatus(form, ok, message) {
    var targets = statusTargets(form);
    if (targets.done) {
      targets.done.style.display = ok ? 'block' : 'none';
      if (ok && message) (targets.done.querySelector('div') || targets.done).textContent = message;
    }
    if (targets.fail) {
      targets.fail.style.display = ok ? 'none' : 'block';
      if (!ok && message) (targets.fail.querySelector('div') || targets.fail).textContent = message;
    }
    var status = form.querySelector(
      '[data-kodety-member-form-status], [data-kodety-member-status]',
    );
    if (!status && !targets.done && !targets.fail) {
      status = document.createElement('div');
      status.setAttribute('data-kodety-member-status', '');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      form.appendChild(status);
    }
    if (status) {
      status.textContent = message || '';
      status.dataset.state = ok ? 'success' : 'error';
    }
  }

  function setBusy(form, busy) {
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach(function (control) {
      control.disabled = busy;
    });
  }

  function challenge() {
    if (!config.challengeUrl) return Promise.reject(new Error('O login não foi configurado.'));
    return fetch(config.challengeUrl, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    }).then(readResponse).then(function (body) {
      if (!body.csrfToken) throw new Error('A sessão de segurança não pôde ser iniciada.');
      return body.csrfToken;
    });
  }

  function readResponse(response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok) {
        var message = body && typeof body.message === 'string'
          ? body.message
          : 'Não foi possível concluir esta operação.';
        var error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return body || {};
    });
  }

  function submit(form, action) {
    var url = endpoint(action);
    if (!url) return Promise.reject(new Error('Este formulário de membros não foi configurado.'));
    var payload;
    try {
      payload = payloadFor(form, action);
    } catch (error) {
      return Promise.reject(error);
    }
    var publicAction = publicActions.has(action);
    var security = publicAction ? challenge() : Promise.resolve('');
    return security.then(function (csrfToken) {
      var headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-Kodety-CSRF'] = csrfToken;
      if (!publicAction && config.memberCsrf) {
        headers['X-Kodety-Member-CSRF'] = config.memberCsrf;
      }
      return fetch(url, {
        method: action === 'profile' ? 'PUT' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: headers,
        body: JSON.stringify(payload),
      }).then(readResponse);
    });
  }

  function successMessage(action, body) {
    if (body && typeof body.message === 'string') return body.message;
    if (action === 'login') return 'Login realizado com sucesso.';
    if (action === 'register') return 'Conta criada com sucesso.';
    if (action === 'forgot-password') return 'Se a conta existir, as instruções serão enviadas.';
    if (action === 'reset-password') return 'Senha redefinida com sucesso.';
    if (action === 'profile') return 'Perfil atualizado.';
    if (action === 'logout') return 'Sessão encerrada.';
    return 'Operação concluída.';
  }

  function redirectTarget(form, action) {
    if (action === 'login' || action === 'register') {
      var requested = queryValue(['redirect_to']);
      if (requested) return requested;
    }
    var authored = String(form.getAttribute('data-kodety-success-url') || '').trim();
    if (authored) return authored;
    if (action === 'login' || action === 'register') return config.afterLoginUrl || '';
    if (action === 'logout') return config.afterLogoutUrl || '';
    return '';
  }

  function safeRedirect(target) {
    if (!target) return false;
    try {
      var url = new URL(target, window.location.href);
      if (url.origin !== window.location.origin) return false;
      window.location.assign(url.href);
      return true;
    } catch (error) {
      return false;
    }
  }

  function bind(form) {
    if (!(form instanceof HTMLFormElement) || bound.has(form)) return;
    var action = normalizeAction(
      form.getAttribute('data-kodety-member-form')
      || form.getAttribute('data-kodety-form-action'),
    );
    bound.add(form);
    form.dataset.kodetyMemberBound = 'true';
    if (action === 'reset-password') {
      form.dataset.kodetyResetKey = (window.kodetyMembershipReset || {}).key || queryValue(['key']);
      form.dataset.kodetyResetLogin = (window.kodetyMembershipReset || {}).login || queryValue(['login']);
      if (window.kodetyMembershipReset) {
        window.kodetyMembershipReset.key = '';
        window.kodetyMembershipReset.login = '';
      }
      if (form.dataset.kodetyResetKey || form.dataset.kodetyResetLogin) {
        try {
          var cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('key');
          cleanUrl.searchParams.delete('login');
          window.history.replaceState(window.history.state, '', cleanUrl.href);
        } catch (error) {
          // The reset still works from the in-memory values above.
        }
      }
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.getAttribute('aria-busy') === 'true') return;
      setBusy(form, true);
      showStatus(form, true, '');
      submit(form, action).then(function (body) {
        if (body && typeof body.memberCsrf === 'string' && body.memberCsrf) {
          config.memberCsrf = body.memberCsrf;
        }
        var message = successMessage(action, body);
        showStatus(form, true, message);
        form.dispatchEvent(new CustomEvent('kodety:member-form:success', {
          bubbles: true,
          detail: { action: action, response: body },
        }));
        var redirected = false;
        if (
          (action === 'login' || action === 'register')
          && body
          && typeof body.redirect_to === 'string'
        ) {
          redirected = safeRedirect(body.redirect_to.trim());
        }
        if (!redirected) redirected = safeRedirect(redirectTarget(form, action));
        if (!redirected && action === 'logout') {
          window.location.reload();
        }
      }).catch(function (error) {
        var message = error instanceof Error
          ? error.message
          : 'Não foi possível concluir esta operação.';
        showStatus(form, false, message);
        form.dispatchEvent(new CustomEvent('kodety:member-form:error', {
          bubbles: true,
          detail: { action: action, message: message },
        }));
      }).finally(function () {
        setBusy(form, false);
      });
    }, true);
  }

  function initialize(root) {
    if (root instanceof HTMLFormElement) bind(root);
    (root || document).querySelectorAll(
      'form[data-kodety-member-form], form[data-kodety-form-action]',
    ).forEach(bind);
  }

  document.addEventListener('kodety:member-form:ready', function (event) {
    if (event.target instanceof HTMLFormElement) bind(event.target);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initialize(document); });
  } else {
    initialize(document);
  }
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) {
        if (node instanceof Element) initialize(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
