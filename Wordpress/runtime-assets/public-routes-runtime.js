(function () {
  'use strict';

  var configElement = document.getElementById('kodety-public-routes-config');
  if (!configElement) return;

  var config;
  try {
    config = JSON.parse(configElement.textContent || '{}');
  } catch (error) {
    return;
  }

  var routes = config.routes && typeof config.routes === 'object' ? config.routes : {};
  var routeAliases = config.routeAliases && typeof config.routeAliases === 'object' ? config.routeAliases : {};
  var currentFile = String(config.currentFile || '').replace(/^\/+|\/+$/g, '');
  var currentUrl = String(config.currentUrl || window.location.href);
  var publicBase = String(config.publicBase || window.location.origin + '/');
  var assetRoot = String(config.assetRoot || '');
  var webRoot = String(config.webRoot || '').replace(/^\/+|\/+$/g, '');
  var localization = config.localization && typeof config.localization === 'object' ? config.localization : {};
  var localeOptions = Array.isArray(localization.options) ? localization.options : [];
  var localeCodes = localeOptions.reduce(function (codes, option) {
    var code = String(option && option.code || '');
    if (code) codes[code.toLowerCase()] = code;
    return codes;
  }, {});
  var navigationAttributes = [
    'href',
    'action',
    'data-href',
    'data-url',
    'data-case-href',
    'data-reference-href',
    'data-case-destination',
  ];

  function splitReference(reference) {
    var hashIndex = reference.indexOf('#');
    var beforeHash = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference;
    var hash = hashIndex >= 0 ? reference.slice(hashIndex) : '';
    var queryIndex = beforeHash.indexOf('?');
    return {
      path: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
      query: queryIndex >= 0 ? beforeHash.slice(queryIndex) : '',
      hash: hash,
    };
  }

  function normalizeProjectPath(reference) {
    var base = reference.charAt(0) === '/'
      ? []
      : currentFile.split('/').slice(0, -1).filter(Boolean);
    String(reference || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/').forEach(function (segment) {
      if (!segment || segment === '.') return;
      if (segment === '..') base.pop();
      else base.push(segment);
    });
    return base.join('/');
  }

  function publicUrlForUnmappedHtml(candidate) {
    var path = candidate.replace(/^\/+|\/+$/g, '');
    if (webRoot && (path === webRoot || path.indexOf(webRoot + '/') === 0)) {
      path = path.slice(webRoot.length).replace(/^\/+/, '');
    }
    path = path.replace(/(?:^|\/)index\.html?$/i, '').replace(/\.html?$/i, '').replace(/^\/+|\/+$/g, '');
    try {
      return new URL(path, publicBase).href;
    } catch (error) {
      return '';
    }
  }

  function candidateFromAbsolute(reference) {
    if (!assetRoot) return null;
    try {
      var absolute = new URL(reference, document.baseURI);
      var root = new URL(assetRoot, document.baseURI);
      if (absolute.origin !== root.origin || absolute.pathname.indexOf(root.pathname) !== 0) return null;
      return {
        path: absolute.pathname.slice(root.pathname.length).replace(/^\/+/, ''),
        query: absolute.search,
        hash: absolute.hash,
      };
    } catch (error) {
      return null;
    }
  }

  function resolvePublicReference(rawReference) {
    var raw = String(rawReference || '').trim();
    if (!raw) return '';
    if (raw.charAt(0) === '#') return currentUrl.replace(/#.*$/, '') + raw;
    if (raw.indexOf('//') === 0) return '';

    var absoluteCandidate = candidateFromAbsolute(raw);
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !absoluteCandidate) return '';
    var parts = absoluteCandidate || splitReference(raw);
    if (!parts.path) return '';
    if (!absoluteCandidate && parts.path.charAt(0) === '/') return '';

    var candidate = (absoluteCandidate ? parts.path : normalizeProjectPath(parts.path)).replace(/^\/+|\/+$/g, '');
    var key = candidate.toLowerCase();
    var target = routes[key] || routeAliases[key] || '';
    if (!target && /\.html?$/i.test(candidate)) target = publicUrlForUnmappedHtml(candidate);
    if (!target) return '';

    try {
      var url = new URL(target, publicBase);
      if (parts.query) url.search = parts.query.slice(1);
      if (parts.hash) url.hash = parts.hash.slice(1);
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function rewriteAttribute(element, attribute) {
    if (!element || !element.getAttribute || !element.hasAttribute(attribute)) return;
    var current = element.getAttribute(attribute);
    var resolved = resolvePublicReference(current);
    if (resolved && resolved !== current) element.setAttribute(attribute, resolved);
  }

  function rewriteElement(element) {
    navigationAttributes.forEach(function (attribute) { rewriteAttribute(element, attribute); });
  }

  function rememberLocaleChoice(rawCode) {
    var code = localeCodes[String(rawCode || '').toLowerCase()] || '';
    if (!code) return;
    var cookiePath = String(localization.cookiePath || '/');
    if (cookiePath.charAt(0) !== '/' || /[;\r\n]/.test(cookiePath)) cookiePath = '/';
    var lifetime = localization.rememberLocale === false ? '' : '; Max-Age=31536000';
    var secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = 'kodety_locale_choice=' + encodeURIComponent(code)
      + '; Path=' + cookiePath + '; SameSite=Lax' + lifetime + secure;
  }

  function materializeLocaleSelector(selector) {
    if (!selector || selector.getAttribute('data-kodety-locale-runtime-ready') === 'true' || !localeOptions.length) return;
    var current = localeOptions.find(function (option) { return option && option.current; }) || localeOptions[0];
    var currentLabel = selector.querySelector('[data-kodety-locale-current]');
    if (currentLabel) currentLabel.textContent = String(current.name || current.code || '');
    var optionsRoot = selector.querySelector('[data-kodety-locale-options]');
    if (!optionsRoot) return;
    var template = optionsRoot.querySelector('[data-kodety-locale-option], a');
    optionsRoot.textContent = '';
    localeOptions.forEach(function (locale) {
      var option = template ? template.cloneNode(true) : document.createElement('a');
      var code = String(locale && locale.code || '');
      if (!code) return;
      option.textContent = String(locale.name || code);
      option.setAttribute('data-kodety-locale-option', '');
      option.setAttribute('href', String(locale.url || '#'));
      option.setAttribute('hreflang', code);
      option.setAttribute('lang', code);
      option.setAttribute('dir', locale.direction === 'rtl' ? 'rtl' : 'ltr');
      if (locale.current) option.setAttribute('aria-current', 'page');
      else option.removeAttribute('aria-current');
      optionsRoot.appendChild(option);
    });
    selector.setAttribute('data-kodety-locale-runtime-ready', 'true');
  }

  function materializeLocaleSelectors(root) {
    if (!root || root.nodeType !== 1 || !localeOptions.length) return;
    if (root.matches && root.matches('[data-kodety-locale-selector], [data-incode-component="locales-list"]')) {
      materializeLocaleSelector(root);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('[data-kodety-locale-selector], [data-incode-component="locales-list"]')
        .forEach(materializeLocaleSelector);
    }
  }

  function rewriteTree(root) {
    if (!root || root.nodeType !== 1) return;
    materializeLocaleSelectors(root);
    rewriteElement(root);
    if (!root.querySelectorAll) return;
    root.querySelectorAll(navigationAttributes.map(function (attribute) { return '[' + attribute + ']'; }).join(','))
      .forEach(rewriteElement);
  }

  function rewriteDocument() {
    rewriteTree(document.documentElement);
  }

  document.addEventListener('click', function (event) {
    var localeOption = event.target && event.target.closest
      ? event.target.closest('[data-kodety-locale-option][hreflang]')
      : null;
    if (localeOption) rememberLocaleChoice(localeOption.getAttribute('hreflang'));
    var link = event.target && event.target.closest ? event.target.closest('a[href], area[href]') : null;
    if (link) rewriteAttribute(link, 'href');
  }, true);
  document.addEventListener('submit', function (event) {
    if (event.target && event.target.matches && event.target.matches('form')) rewriteAttribute(event.target, 'action');
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rewriteDocument, { once: true });
  else rewriteDocument();

  if ('MutationObserver' in window) {
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === 'attributes') rewriteElement(record.target);
        else record.addedNodes.forEach(rewriteTree);
      });
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: navigationAttributes,
    });
  }
})();
