(function () {
  'use strict';

  var config = window.KodetyRocketAdmin || {};
  var validSections = ['overview', 'cache', 'assets', 'delivery', 'diagnostics', 'advanced'];
  var validLocales = ['en_US', 'pt_BR', 'es_ES'];

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Signed user-meta persistence remains available when storage is blocked.
    }
  }

  function normalizeLocale(locale) {
    var aliases = {
      en: 'en_US',
      'en-US': 'en_US',
      en_US: 'en_US',
      pt: 'pt_BR',
      'pt-BR': 'pt_BR',
      pt_BR: 'pt_BR',
      es: 'es_ES',
      'es-ES': 'es_ES',
      es_ES: 'es_ES'
    };
    var normalized = aliases[locale] || config.defaultLocale || 'en_US';

    return validLocales.indexOf(normalized) === -1 ? 'en_US' : normalized;
  }

  /**
   * Mirrors Kodety's own admin isolation contract. While the internal style
   * loads, the slot keeps the progressively enhanced light DOM visible. A
   * failed stylesheet leaves that fallback intact and usable.
   */
  function mountIsolated(host, root) {
    if (!host || !host.attachShadow || host.shadowRoot) {
      return;
    }

    var styleUrl = host.getAttribute('data-kodety-rocket-style') || config.styleUrl || '';
    if (!styleUrl) {
      return;
    }

    var shadow = host.attachShadow({ mode: 'open' });
    var stylesheet = document.createElement('link');
    var fallbackSlot = document.createElement('slot');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = styleUrl;
    stylesheet.setAttribute('data-kodety-rocket-shadow-styles', '');

    stylesheet.addEventListener('load', function () {
      if (root.parentNode === host) {
        shadow.appendChild(root);
      }
      fallbackSlot.remove();
      host.setAttribute('data-kodety-rocket-isolated', 'true');
    }, { once: true });

    stylesheet.addEventListener('error', function () {
      stylesheet.remove();
      host.setAttribute('data-kodety-rocket-isolated', 'fallback');
    }, { once: true });

    shadow.append(stylesheet, fallbackSlot);
  }

  function init() {
    var host = document.querySelector('[data-kodety-rocket-host]');
    var root = host ? host.querySelector('[data-kodety-rocket]') : document.querySelector('[data-kodety-rocket]');
    if (!root || root.getAttribute('data-js-ready') === 'true') {
      return;
    }

    root.setAttribute('data-js-ready', 'true');
    root.classList.add('is-js');

    var keys = config.storageKeys || {};
    var themeKey = keys.theme || 'kodetyRocketTheme';
    var localeKey = keys.locale || 'kodetyRocketLocale';
    var sectionKey = keys.section || 'kodetyRocketSection';
    var currentLocale = normalizeLocale(storageGet(localeKey) || config.locale);
    var currentTheme = storageGet(themeKey) || config.theme || 'dark';
    var activeSection = 'overview';
    if (currentTheme !== 'light' && currentTheme !== 'dark') {
      currentTheme = 'dark';
    }

    function translation(key) {
      var catalogues = config.catalogues || {};
      var active = catalogues[currentLocale] || {};
      var fallback = catalogues[config.defaultLocale || 'en_US'] || {};

      return active[key] || fallback[key] || key;
    }

    function updateSectionLabel() {
      var label = root.querySelector('[data-current-section-label]');
      if (label) {
        label.setAttribute('data-i18n', 'nav.' + activeSection);
        label.textContent = translation('nav.' + activeSection);
      }
    }

    function translateInterface() {
      root.querySelectorAll('[data-i18n]').forEach(function (node) {
        node.textContent = translation(node.getAttribute('data-i18n'));
      });
      root.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) {
        node.setAttribute('placeholder', translation(node.getAttribute('data-i18n-placeholder')));
      });
      root.querySelectorAll('[data-i18n-aria-label]').forEach(function (node) {
        node.setAttribute('aria-label', translation(node.getAttribute('data-i18n-aria-label')));
      });
      root.querySelectorAll('[data-i18n-title]').forEach(function (node) {
        node.setAttribute('title', translation(node.getAttribute('data-i18n-title')));
      });
      root.setAttribute('lang', currentLocale.replace('_', '-'));
      root.dataset.locale = currentLocale;
      updateSectionLabel();
    }

    var preferenceForm = root.querySelector('#kr-preferences-form');
    var localeSelect = root.querySelector('#kr-locale');
    var themeInput = root.querySelector('#kr-theme-value');
    var themeToggle = root.querySelector('[data-theme-toggle]');

    function savePreferences() {
      if (!preferenceForm || !window.fetch || !window.FormData) {
        return;
      }

      var data = new window.FormData(preferenceForm);
      data.set('locale', currentLocale);
      data.set('theme', currentTheme);
      data.set('kodety_rocket_async', '1');

      window.fetch(preferenceForm.action, {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).catch(function () {
        // Local persistence keeps theme and language usable if the POST fails.
      });
    }

    function applyTheme(theme, persist) {
      currentTheme = theme === 'light' ? 'light' : 'dark';
      root.dataset.theme = currentTheme;
      if (themeInput) {
        themeInput.value = currentTheme;
      }
      if (themeToggle) {
        var switchesToLight = currentTheme === 'dark';
        var labelKey = switchesToLight ? 'top.theme_light' : 'top.theme_dark';
        var use = themeToggle.querySelector('use');
        themeToggle.setAttribute('aria-label', translation(labelKey));
        themeToggle.setAttribute('title', translation(labelKey));
        themeToggle.setAttribute('aria-pressed', currentTheme === 'light' ? 'true' : 'false');
        if (use) {
          use.setAttribute('href', switchesToLight ? '#kr-keyline-sun' : '#kr-keyline-moon');
        }
      }
      if (persist) {
        storageSet(themeKey, currentTheme);
        savePreferences();
      }
    }

    if (localeSelect) {
      localeSelect.value = currentLocale;
      localeSelect.addEventListener('change', function () {
        currentLocale = normalizeLocale(localeSelect.value);
        storageSet(localeKey, currentLocale);
        translateInterface();
        applyTheme(currentTheme, false);
        savePreferences();
      });
    }
    if (themeToggle) {
      themeToggle.addEventListener('click', function () {
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark', true);
      });
    }

    var navItems = Array.prototype.slice.call(root.querySelectorAll('[data-section]'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('[data-panel]'));
    var sectionInput = root.querySelector('[data-current-section]');

    function sectionFromHash() {
      var prefix = '#kodety-rocket-';
      if (window.location.hash.indexOf(prefix) !== 0) {
        return '';
      }

      return window.location.hash.slice(prefix.length);
    }

    function activateSection(section, historyMode) {
      if (validSections.indexOf(section) === -1) {
        section = 'overview';
      }
      activeSection = section;

      panels.forEach(function (panel) {
        var isActive = panel.dataset.panel === section;
        panel.hidden = !isActive;
        panel.classList.toggle('is-active', isActive);
      });
      navItems.forEach(function (item) {
        var isActive = item.dataset.section === section;
        item.classList.toggle('is-active', isActive);
        if (isActive) {
          item.setAttribute('aria-current', 'page');
        } else {
          item.removeAttribute('aria-current');
        }
      });
      if (sectionInput) {
        sectionInput.value = section;
      }
      storageSet(sectionKey, section);
      updateSectionLabel();

      var hash = '#kodety-rocket-' + section;
      if (historyMode === 'push' && window.location.hash !== hash) {
        window.history.pushState({ kodetyRocketSection: section }, '', hash);
      } else if (historyMode === 'replace' && window.location.hash !== hash) {
        window.history.replaceState({ kodetyRocketSection: section }, '', hash);
      }
    }

    translateInterface();
    applyTheme(currentTheme, false);
    activateSection(sectionFromHash() || storageGet(sectionKey) || 'overview', 'none');

    navItems.forEach(function (item) {
      item.addEventListener('click', function (event) {
        event.preventDefault();
        activateSection(item.dataset.section, 'push');
      });
    });
    window.addEventListener('popstate', function () {
      activateSection(sectionFromHash() || 'overview', 'none');
    });
    window.addEventListener('hashchange', function () {
      activateSection(sectionFromHash() || 'overview', 'none');
    });

    root.querySelectorAll('.kr-setting-row--toggle input[type="checkbox"]').forEach(function (input) {
      function updateRow() {
        var row = input.closest('.kr-setting-row');
        if (row) {
          row.classList.toggle('is-enabled', input.checked);
        }
      }
      input.addEventListener('change', updateRow);
      updateRow();
    });

    root.querySelectorAll('form').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        var submitter = event.submitter;
        var confirmation = submitter && submitter.getAttribute('data-confirm');
        if (confirmation && !window.confirm(translation('confirm.' + confirmation))) {
          event.preventDefault();
          return;
        }

        if (form.id === 'kr-settings-form') {
          root.querySelectorAll('[form="kr-settings-form"], #kr-settings-form [type="submit"]').forEach(function (button) {
            button.setAttribute('aria-disabled', 'true');
          });
          root.querySelectorAll('[data-save-button] [data-i18n], .kr-top-save [data-i18n]').forEach(function (label) {
            label.textContent = translation('action.saving');
          });
        }
      });
    });

    var settingsForm = root.querySelector('#kr-settings-form');
    if (settingsForm) {
      settingsForm.addEventListener('input', function () {
        settingsForm.classList.add('is-dirty');
      });
      settingsForm.addEventListener('change', function () {
        settingsForm.classList.add('is-dirty');
      });
    }

    mountIsolated(host, root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
