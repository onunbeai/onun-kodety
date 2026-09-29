(() => {
  'use strict';
  let activeStop;
  const mount = config => {
  if (!config || !config.locale || !config.messages || !config.aliases) return () => {};
  activeStop?.();
  let stopped = false;
  const previous = {
    translate: window.kodetyTranslate,
    format: window.kodetyFormatMessage,
    locale: document.documentElement?.dataset.kodetyUiLocale,
    lang: document.documentElement?.lang,
    dir: document.documentElement?.dir,
    dialogs: window.__kodetyI18nDialogsTranslated,
  };
  const translatedText = new Map();
  const translatedAttributes = new Map();
  const dialogRestorers = [];

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const exact = new Map();
  const patterns = [];
  let patternOrder = 0;
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternFor = source => {
    const names = [];
    let expression = '';
    let cursor = 0;
    const marker = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
    let match;
    while ((match = marker.exec(source))) {
      expression += escapeRegex(source.slice(cursor, match.index));
      expression += '(.+?)';
      names.push(match[1]);
      cursor = match.index + match[0].length;
    }
    if (!names.length) return null;
    expression += escapeRegex(source.slice(cursor));
    return {
      regex: new RegExp('^' + expression + '$', 'u'),
      names,
      specificity: source.replace(marker, '').length,
      order: patternOrder++,
    };
  };

  const registerSources = (sources, target) => {
    if (typeof target !== 'string') return;
    sources = Array.isArray(sources) ? sources : [sources];
    sources.forEach(source => {
      if (typeof source !== 'string') return;
      const normalized = normalize(source);
      const pattern = patternFor(normalized);
      if (pattern) patterns.push({ ...pattern, target });
      else exact.set(normalized, target);
    });
  };
  Object.entries(config.aliases).forEach(([key, aliases]) => {
    registerSources(aliases, config.messages[key]);
  });
  Object.entries(config.direct || {}).forEach(([source, target]) => registerSources(source, target));
  // A generic pattern such as "{count} de {total}" must not shadow a
  // complete phrase such as "{count} de {total} enviados".
  patterns.sort((left, right) => (
    right.specificity - left.specificity
    || right.order - left.order
  ));

  const translate = value => {
    const source = normalize(value);
    if (!source) return value;
    if (exact.has(source)) return exact.get(source);
    for (const pattern of patterns) {
      const match = source.match(pattern.regex);
      if (!match) continue;
      const replacements = Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]));
      return pattern.target.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (marker, name) => (
        Object.hasOwn(replacements, name) ? replacements[name] : marker
      ));
    }
    // Never translate fragments word by word. Partial replacement produced
    // broken bilingual copy (for example "Choice o símbolo"). A phrase is
    // translated only when the catalog has an exact or placeholder-aware map.
    return value;
  };
  const formatMessage = (key, replacements = {}) => {
    const template = typeof config.messages[key] === 'string' ? config.messages[key] : key;
    // Values are opaque data. A project named "{total}" must not expand again.
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (marker, name) => (
      Object.hasOwn(replacements, name) ? String(replacements[name]) : marker
    ));
  };
  window.kodetyFormatMessage = formatMessage;
  // Available during module initialization, before the DOM observer starts.
  window.kodetyTranslate = translate;

  const skipped = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'SVG', 'PATH', 'CANVAS']);
  const adminScopeSelector = '[data-kodety-i18n-root], [data-kodety-agency-host], [data-plugin="kodety/kodety.php"], [data-plugin*="kodefy"], [class*="kodety-"], [id^="kodety-"], [class*="kodefy-"], [id^="kodefy-"], #toplevel_page_kodety, #toplevel_page_kodety-cms, #toplevel_page_kodety-analytics, #toplevel_page_kodefy';
  // Menu entries and plugin rows may appear on unrelated wp-admin screens.
  // Only a real application root is allowed to wrap native browser dialogs.
  const dialogScopeSelector = '[data-kodety-i18n-root], [data-kodety-agency-host], #kodety-root, #kodety-email-root, .wrap[class*="kodety-"], .wrap[class*="kodefy-"], [data-kodety-media-app], [data-kodety-help], [data-kodety-onboarding], [data-kodety-members-config]';
  const closestComposed = (element, selector) => {
    let current = element;
    while (current instanceof Element) {
      const match = current.closest(selector);
      if (match) return match;
      const root = current.getRootNode?.();
      current = root?.host instanceof Element ? root.host : null;
    }
    return null;
  };
  const canTranslateElement = (element, forAttributes = false) => {
    if (!(element instanceof Element)) return false;
    const textareaAttributes = forAttributes && element.tagName === 'TEXTAREA';
    if (skipped.has(element.tagName) && !textareaAttributes) return false;
    const literalAncestor = closestComposed(element, 'script, style, code, pre, textarea, svg, canvas');
    if (literalAncestor && !(textareaAttributes && literalAncestor === element)) return false;
    // User-authored/project data opts out at its nearest wrapper. Walk through
    // open shadow hosts too, so the contract is preserved by isolated apps.
    if (closestComposed(element, '[data-kodety-no-i18n], [contenteditable="true"]')) return false;
    if (config.scope === 'document' || config.scope === 'login') return true;
    return Boolean(closestComposed(element, adminScopeSelector));
  };
  const hasTranslatableScope = () => (
    config.scope === 'document'
    || config.scope === 'login'
    || Boolean(document.querySelector(dialogScopeSelector))
  );

  const translateTextNode = node => {
    const parent = node.parentElement;
    if (!parent || !canTranslateElement(parent)) return;
    const original = node.nodeValue || '';
    // Leading/trailing matches overlap when the node is only whitespace. If
    // processed, each observer pass duplicates that whitespace and schedules
    // another mutation forever.
    if (!normalize(original)) return;
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    const translated = translate(original);
    const next = leading + normalize(translated) + trailing;
    // Comparing the normalized translation with the raw text made indented
    // nodes look changed forever. MutationObserver then requeued the same node
    // continuously and could freeze every wp-admin screen.
    if (config.restoreOnStop && next !== original) {
      const recorded = translatedText.get(node);
      translatedText.set(node, { original: recorded?.translated === original ? recorded.original : original, translated: next });
    }
    if (next !== original) node.nodeValue = next;
  };
  const translateElement = element => {
    if (!canTranslateElement(element, true)) return;
    (config.attributes || []).forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      if (attribute === 'value' && (
        !(element instanceof HTMLInputElement)
        || !['button', 'reset', 'submit'].includes(element.type)
      )) return;
      const original = element.getAttribute(attribute) || '';
      const translated = translate(original);
      if (translated !== original) {
        if (config.restoreOnStop) {
          let recorded = translatedAttributes.get(element);
          if (!recorded) translatedAttributes.set(element, recorded = new Map());
          const previous = recorded.get(attribute);
          recorded.set(attribute, { original: previous?.translated === original ? previous.original : original, translated });
        }
        element.setAttribute(attribute, translated);
      }
    });
    Array.from(element.childNodes).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
    });
  };
  const observedRoots = new WeakSet();
  let mutationObserver;
  const observeRoot = root => {
    if (!mutationObserver || observedRoots.has(root)) return;
    mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: config.attributes || [],
    });
    observedRoots.add(root);
  };
  const translateTree = root => {
    if (root instanceof Text) return translateTextNode(root);
    if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) return;
    const elements = [];
    if (root instanceof Element) elements.push(root);
    root.querySelectorAll('*').forEach(element => elements.push(element));
    elements.forEach(element => {
      translateElement(element);
      if (!element.shadowRoot) return;
      observeRoot(element.shadowRoot);
      translateTree(element.shadowRoot);
    });
  };
  const translateNativeDialogs = () => {
    if (window.__kodetyI18nDialogsTranslated) return;
    window.__kodetyI18nDialogsTranslated = true;
    ['alert', 'confirm', 'prompt'].forEach(name => {
      const original = window[name];
      if (typeof original !== 'function') return;
      const wrapped = function (message, ...rest) {
        return original.call(window, translate(message), ...rest);
      };
      window[name] = wrapped;
      dialogRestorers.push(() => { if (window[name] === wrapped) window[name] = original; });
    });
  };
  const start = () => {
    if (stopped) return;
    document.documentElement.dataset.kodetyUiLocale = config.locale;
    if (config.scope === 'document' || (config.scope === 'login' && config.documentLocale !== false)) {
      document.documentElement.lang = config.locale;
      document.documentElement.dir = config.direction || 'ltr';
    } else if (config.scope === 'login') {
      const loginShell = document.querySelector('.kodety-login-shell');
      if (loginShell) {
        loginShell.lang = config.locale;
        loginShell.dir = config.direction || 'ltr';
      }
    }
    if (hasTranslatableScope()) {
      translateNativeDialogs();
    }
    mutationObserver = new MutationObserver(mutations => {
      if (stopped) return;
      mutations.forEach(mutation => {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        if (mutation.type === 'attributes') translateElement(mutation.target);
        mutation.addedNodes?.forEach(translateTree);
      });
    });
    observeRoot(document.documentElement);
    translateTree(document);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener?.('DOMContentLoaded', start);
    mutationObserver?.disconnect();
    // HTML hosts change routes without unloading the document. Restore only
    // values still owned by this runtime, preserving subsequent authored edits.
    translatedText.forEach((value, node) => {
      if (node.nodeValue === value.translated) node.nodeValue = value.original;
    });
    translatedAttributes.forEach((attributes, element) => {
      attributes.forEach((value, name) => {
        if (element.getAttribute(name) === value.translated) element.setAttribute(name, value.original);
      });
    });
    translatedText.clear();
    translatedAttributes.clear();
    dialogRestorers.forEach(restore => restore());
    if (dialogRestorers.length) {
      if (previous.dialogs === undefined) delete window.__kodetyI18nDialogsTranslated;
      else window.__kodetyI18nDialogsTranslated = previous.dialogs;
    }
    if (window.kodetyTranslate === translate) {
      if (previous.translate === undefined) delete window.kodetyTranslate;
      else window.kodetyTranslate = previous.translate;
    }
    if (window.kodetyFormatMessage === formatMessage) {
      if (previous.format === undefined) delete window.kodetyFormatMessage;
      else window.kodetyFormatMessage = previous.format;
    }
    if (document.documentElement.dataset.kodetyUiLocale === config.locale) {
      if (previous.locale === undefined) delete document.documentElement.dataset.kodetyUiLocale;
      else document.documentElement.dataset.kodetyUiLocale = previous.locale;
    }
    if (document.documentElement.lang === config.locale) document.documentElement.lang = previous.lang;
    if (document.documentElement.dir === (config.direction || 'ltr')) document.documentElement.dir = previous.dir;
    if (activeStop === stop) activeStop = undefined;
  };
  activeStop = stop;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  return stop;
  };
  // WordPress still auto-starts from its PHP-injected configuration. Other
  // hosts mount the exact same runtime with the shared JSON catalogs.
  window.kodetyMountAdminI18n = mount;
  if (window.kodetyAdminI18n) mount(window.kodetyAdminI18n);
})();
