const RUNTIME_MARKER = 'data-kodety-infinite-canvas-runtime';
const RUNTIME_TAG_PATTERN = new RegExp(
  `<script\\b[^>]*\\b${RUNTIME_MARKER}(?:\\s|=|>)`,
  'i',
);

function inlineScriptSafe(source: string) {
  // HTML's script-data parser closes on a literal </script sequence even when
  // it appears inside a JavaScript string, regex or comment. Escaping the slash
  // preserves the JavaScript value while keeping the generated tag intact.
  return source.replace(/<\/script/gi, '<\\/script');
}

function appendRuntimeToDocument(html: string, runtime: string) {
  // Preview bridges contain complete HTML snippets such as
  // "<html><body>…</body></html>" inside their JavaScript. Replacing the first
  // </body> injects a nested script into that bridge; its closing tag then ends
  // the bridge early and the remaining runtime is painted as page text. The
  // serialized document's structural closing tag is necessarily the last one.
  const closingBodyPattern = /<\/body\s*>/gi;
  let closingBodyIndex = -1;
  for (
    let match = closingBodyPattern.exec(html);
    match;
    match = closingBodyPattern.exec(html)
  ) closingBodyIndex = match.index;
  if (closingBodyIndex >= 0) {
    return `${html.slice(0, closingBodyIndex)}${runtime}${html.slice(closingBodyIndex)}`;
  }

  const closingHtmlPattern = /<\/html\s*>/gi;
  let closingHtmlIndex = -1;
  for (
    let match = closingHtmlPattern.exec(html);
    match;
    match = closingHtmlPattern.exec(html)
  ) closingHtmlIndex = match.index;
  if (closingHtmlIndex >= 0) {
    return `${html.slice(0, closingHtmlIndex)}${runtime}${html.slice(closingHtmlIndex)}`;
  }
  return `${html}${runtime}`;
}

export interface InfiniteCanvasRuntimeOptions {
  defaultViewportHeight?: number;
}

/**
 * Device-like viewport height used before a section receives an explicit
 * editor simulation. The desktop/base frame may still opt into 1080 directly;
 * responsive frames follow common notebook, tablet and phone aspect ratios.
 */
export function defaultInfiniteCanvasViewportHeight(width: number) {
  const safeWidth = Number.isFinite(width) ? Math.max(240, width) : 768;
  if (safeWidth >= 1600) return 1080;
  if (safeWidth >= 1100) return 900;
  if (safeWidth >= 700) return 1080;
  if (safeWidth >= 430) return 932;
  if (safeWidth >= 390) return 844;
  if (safeWidth >= 375) return 812;
  if (safeWidth >= 350) return 800;
  return 667;
}

/**
 * Runs only inside an infinite-canvas srcdoc.
 *
 * The iframe is deliberately expanded to the page's real document height. To
 * avoid the usual `100vh -> taller iframe -> taller 100vh` feedback loop, the
 * winning authored viewport-height declarations are evaluated against the
 * device-like viewport passed with that frame. A selected section gets a
 * Framer-like handle that can change the simulation without touching source.
 */
function infiniteCanvasRuntimeBootstrap(configuration: InfiniteCanvasRuntimeOptions = {}) {
  const MIN_VIEWPORT_HEIGHT = 240;
  const MAX_VIEWPORT_HEIGHT = 10000;
  const configuredViewportHeight = Number(configuration.defaultViewportHeight);
  let defaultViewportHeight = Number.isFinite(configuredViewportHeight)
    ? Math.max(
      MIN_VIEWPORT_HEIGHT,
      Math.min(MAX_VIEWPORT_HEIGHT, Math.round(configuredViewportHeight)),
    )
    : 1080;
  const HEIGHT_PROPERTIES = [
    'height',
    'min-height',
    'max-height',
    'block-size',
    'min-block-size',
    'max-block-size',
  ];
  const HEIGHT_PROPERTY_SET = new Set(HEIGHT_PROPERTIES);
  const VIEWPORT_UNIT_PATTERN = /(-?(?:\d+|\d*\.\d+))(dvh|svh|lvh|vh)\b/gi;
  const nativeClock = (
    window as Window & {
      __KODETY_EDITOR_NATIVE_CLOCK__?: {
        requestAnimationFrame?: typeof window.requestAnimationFrame;
        cancelAnimationFrame?: typeof window.cancelAnimationFrame;
        setTimeout?: typeof window.setTimeout;
      };
    }
  ).__KODETY_EDITOR_NATIVE_CLOCK__;
  const requestStructuralFrame = nativeClock?.requestAnimationFrame
    || window.requestAnimationFrame.bind(window);
  const setStructuralTimeout = nativeClock?.setTimeout
    || window.setTimeout.bind(window);
  const simulations = new Map<string, number>();
  const simulatedElements = new Map<Element, string[]>();
  const appliedProperties = new Map<Element, Set<string>>();
  const appliedOriginalValues = new Map<
    Element,
    Map<string, { value: string; priority: string }>
  >();
  const appliedRuntimeValues = new Map<
    Element,
    Map<string, { value: string; priority: string }>
  >();
  const originalMediaConditions = new WeakMap<CSSMediaRule, string>();
  const simulatedMediaConditions = new WeakMap<CSSMediaRule, string>();
  const styleProbe = document.createElement('span');
  let observer: MutationObserver | null = null;
  let scanFrame = 0;
  let measureFrame = 0;
  let lastHeight = 0;
  let fixedRootElements: Element[] = [];
  let lastObservedWidth = window.innerWidth;

  const clampHeight = (value: unknown) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return defaultViewportHeight;
    return Math.max(MIN_VIEWPORT_HEIGHT, Math.min(MAX_VIEWPORT_HEIGHT, Math.round(number)));
  };
  const post = (message: Record<string, unknown>) => {
    const generation = (window as Window & { __KODETY_EDITOR_GENERATION__?: string })
      .__KODETY_EDITOR_GENERATION__;
    if (!generation) return;
    parent.postMessage({ ...message, generation }, '*');
  };
  const restoreAppliedProperties = () => {
    appliedProperties.forEach((properties, element) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
      const captured = appliedOriginalValues.get(element);
      properties.forEach(property => {
        const fallback = captured?.get(property);
        const value = fallback?.value || '';
        const priority = fallback?.priority || '';
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      });
      element.removeAttribute('data-kodety-vh-simulated');
      element.removeAttribute('data-kodety-vh-properties');
      element.removeAttribute('data-kodety-vh-authored-style');
    });
    appliedProperties.clear();
    appliedOriginalValues.clear();
    appliedRuntimeValues.clear();
    simulatedElements.clear();
  };
  const splitSelectorList = (selector: string) => {
    const result: string[] = [];
    let current = '';
    let depth = 0;
    for (const character of selector) {
      if (character === '(' || character === '[') depth += 1;
      else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
      if (character === ',' && depth === 0) {
        if (current.trim()) result.push(current.trim());
        current = '';
      } else current += character;
    }
    if (current.trim()) result.push(current.trim());
    return result;
  };
  // A complete Selectors Level 4 parser would be excessive here, but this
  // preserves the cascade order needed by real section selectors: ids,
  // class/attribute/pseudo selectors and element names are compared
  // lexicographically, while :where() intentionally contributes zero.
  const specificity = (selector: string, element: Element) => {
    const branches = splitSelectorList(selector).filter(candidate => {
      try { return element.matches(candidate); } catch { return false; }
    });
    return (branches.length ? branches : [selector]).reduce((maximum, branch) => {
      const withoutWhere = branch.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
      const ids = (withoutWhere.match(/#[\w-]+/g) || []).length;
      const classes = (
        withoutWhere.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g)
        || []
      ).length;
      const elements = (
        withoutWhere
          .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, ' ')
          .match(/(^|[\s>+~])(?:[a-z][\w-]*|\*)/gi)
        || []
      ).filter(token => !token.trim().endsWith('*')).length;
      return Math.max(maximum, ids * 1_000_000 + classes * 1_000 + elements);
    }, 0);
  };
  interface DeclarationCandidate {
    value: string;
    important: boolean;
    specificity: number;
    order: number;
    mediaConditions: string[];
  }
  const candidateWins = (
    next: DeclarationCandidate,
    current: DeclarationCandidate | undefined,
  ) => !current
    || Number(next.important) > Number(current.important)
    || (
      next.important === current.important
      && (
        next.specificity > current.specificity
        || (next.specificity === current.specificity && next.order >= current.order)
      )
    );
  const activeConditionalRule = (rule: CSSRule) => {
    if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
      try { return CSS.supports(rule.conditionText); } catch { return false; }
    }
    return true;
  };
  const rewriteMediaConditionAtHeight = (condition: string, viewportHeight: number) => {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const mediaLength = (rawValue: string, rawUnit: string) => {
      const value = Number(rawValue);
      const unit = rawUnit.toLowerCase();
      return unit === 'px'
        ? value
        : unit === 'em' || unit === 'rem'
          ? value * rootFontSize
          : value * viewportHeight / 100;
    };
    const truthyQuery = (matches: boolean) =>
      matches ? '(min-width: 0px)' : '(max-width: -1px)';
    let rewritten = condition.replace(
      /\(\s*(min|max)-height\s*:\s*(-?(?:\d+|\d*\.\d+))(px|rem|em|dvh|svh|lvh|vh)\s*\)/gi,
      (_match, boundary: string, rawValue: string, rawUnit: string) => {
        const threshold = mediaLength(rawValue, rawUnit);
        const matches = boundary.toLowerCase() === 'min'
          ? viewportHeight >= threshold
          : viewportHeight <= threshold;
        return truthyQuery(matches);
      },
    );
    rewritten = rewritten.replace(
      /\(\s*height\s*(<=|>=|<|>)\s*(-?(?:\d+|\d*\.\d+))(px|rem|em|dvh|svh|lvh|vh)\s*\)/gi,
      (_match, operator: string, rawValue: string, rawUnit: string) => {
        const threshold = mediaLength(rawValue, rawUnit);
        return truthyQuery(
          operator === '<' ? viewportHeight < threshold
            : operator === '<=' ? viewportHeight <= threshold
              : operator === '>' ? viewportHeight > threshold
                : viewportHeight >= threshold,
        );
      },
    );
    rewritten = rewritten.replace(
      /\(\s*(-?(?:\d+|\d*\.\d+))(px|rem|em|dvh|svh|lvh|vh)\s*(<=|>=|<|>)\s*height\s*\)/gi,
      (_match, rawValue: string, rawUnit: string, operator: string) => {
        const threshold = mediaLength(rawValue, rawUnit);
        return truthyQuery(
          operator === '<' ? threshold < viewportHeight
            : operator === '<=' ? threshold <= viewportHeight
              : operator === '>' ? threshold > viewportHeight
                : threshold >= viewportHeight,
        );
      },
    );
    rewritten = rewritten.replace(
      /\(\s*orientation\s*:\s*(portrait|landscape)\s*\)/gi,
      (_match, orientation: string) => {
        const portrait = innerWidth <= viewportHeight;
        const matches = orientation.toLowerCase() === 'portrait' ? portrait : !portrait;
        return truthyQuery(matches);
      },
    );
    return rewritten;
  };
  const mediaMatchesAtHeight = (condition: string, viewportHeight: number) => {
    try {
      return matchMedia(rewriteMediaConditionAtHeight(condition, viewportHeight)).matches;
    } catch {
      return false;
    }
  };
  const viewportPixels = (value: string, viewportHeight: number) =>
    value.replace(VIEWPORT_UNIT_PATTERN, (_match, amount: string) =>
      `${Number(amount) * viewportHeight / 100}px`);
  const containsViewportUnit = (value: string) => {
    VIEWPORT_UNIT_PATTERN.lastIndex = 0;
    return VIEWPORT_UNIT_PATTERN.test(value);
  };
  const resolveCustomProperties = (element: Element, value: string, depth = 0): string => {
    if (depth >= 8 || !value.includes('var(')) return value;
    const computed = getComputedStyle(element);
    let resolved = '';
    let cursor = 0;
    while (cursor < value.length) {
      const start = value.indexOf('var(', cursor);
      if (start < 0) {
        resolved += value.slice(cursor);
        break;
      }
      resolved += value.slice(cursor, start);
      let index = start + 4;
      let nesting = 1;
      for (; index < value.length && nesting > 0; index += 1) {
        if (value[index] === '(') nesting += 1;
        else if (value[index] === ')') nesting -= 1;
      }
      if (nesting !== 0) {
        resolved += value.slice(start);
        break;
      }
      const body = value.slice(start + 4, index - 1);
      let comma = -1;
      let innerDepth = 0;
      for (let offset = 0; offset < body.length; offset += 1) {
        if (body[offset] === '(') innerDepth += 1;
        else if (body[offset] === ')') innerDepth = Math.max(0, innerDepth - 1);
        else if (body[offset] === ',' && innerDepth === 0) {
          comma = offset;
          break;
        }
      }
      const name = (comma < 0 ? body : body.slice(0, comma)).trim();
      const fallback = comma < 0 ? '' : body.slice(comma + 1).trim();
      const customValue = /^--[\w-]+$/.test(name)
        ? computed.getPropertyValue(name).trim()
        : '';
      resolved += customValue || fallback || `var(${body})`;
      cursor = index;
    }
    return resolved === value
      ? value
      : resolveCustomProperties(element, resolved, depth + 1);
  };
  const applyRuntimeValue = (
    element: HTMLElement | SVGElement,
    property: string,
    value: string,
  ) => {
    let properties = appliedProperties.get(element);
    if (!properties) {
      properties = new Set();
      appliedProperties.set(element, properties);
    }
    let originals = appliedOriginalValues.get(element);
    if (!originals) {
      originals = new Map();
      appliedOriginalValues.set(element, originals);
    }
    if (!properties.has(property)) {
      originals.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      });
    }
    properties.add(property);
    element.style.setProperty(property, value);
    let runtimeValues = appliedRuntimeValues.get(element);
    if (!runtimeValues) {
      runtimeValues = new Map();
      appliedRuntimeValues.set(element, runtimeValues);
    }
    runtimeValues.set(property, { value, priority: '' });
  };

  const scan = () => {
    scanFrame = 0;
    observer?.disconnect();
    restoreAppliedProperties();
    const winners = new Map<Element, Map<string, DeclarationCandidate>>();
    const fixedCandidates = new Set<Element>();
    const mediaMatchCache = new Map<string, boolean>();
    let order = 0;
    const accept = (
      element: Element,
      property: string,
      candidate: DeclarationCandidate,
    ) => {
      if (
        candidate.mediaConditions.some(condition => {
          let matches = mediaMatchCache.get(condition);
          if (matches === undefined) {
            matches = mediaMatchesAtHeight(condition, defaultViewportHeight);
            mediaMatchCache.set(condition, matches);
          }
          return !matches;
        })
      ) return;
      let properties = winners.get(element);
      if (!properties) {
        properties = new Map();
        winners.set(element, properties);
      }
      if (candidateWins(candidate, properties.get(property))) {
        properties.set(property, candidate);
      }
    };
    const walkRules = (rules: CSSRuleList, mediaConditions: string[] = []) => {
      Array.from(rules).forEach(rule => {
        order += 1;
        if (!activeConditionalRule(rule)) return;
        if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
          const currentCondition = rule.conditionText;
          const previousSimulation = simulatedMediaConditions.get(rule);
          if (!previousSimulation || currentCondition !== previousSimulation) {
            originalMediaConditions.set(rule, currentCondition);
          }
          const authoredCondition = originalMediaConditions.get(rule) || currentCondition;
          const simulatedCondition = rewriteMediaConditionAtHeight(
            authoredCondition,
            defaultViewportHeight,
          );
          try {
            if (rule.media.mediaText !== simulatedCondition) {
              rule.media.mediaText = simulatedCondition;
            }
            simulatedMediaConditions.set(rule, rule.conditionText);
          } catch {
            // Some constructable/cross-origin sheets expose a read-only list.
          }
          walkRules(rule.cssRules, [...mediaConditions, authoredCondition]);
          return;
        }
        if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
          const selector = rule.selectorText;
          const authoredDeclarations = Array.from(rule.style)
            .map(property => ({
              property,
              value: rule.style.getPropertyValue(property),
            }))
            .filter(declaration => Boolean(declaration.value));
          const declarations = authoredDeclarations.filter(declaration =>
            containsViewportUnit(declaration.value)
            || declaration.value.includes('var('));
          const mayDeclareFixed = authoredDeclarations.some(declaration =>
            declaration.property === 'position'
            && (
              declaration.value.trim().toLowerCase() === 'fixed'
              || declaration.value.includes('var(')
            ));
          // Most imported stylesheets contain thousands of declarations that
          // cannot possibly depend on viewport height. Do not query the whole
          // document for those selectors.
          if (!declarations.length && !mayDeclareFixed) return;
          let elements: Element[] = [];
          try {
            elements = Array.from(document.querySelectorAll(selector));
          } catch {
            return;
          }
          if (mayDeclareFixed) {
            elements.forEach(element => fixedCandidates.add(element));
          }
          const specificityByElement = new Map<Element, number>();
          declarations.forEach(({ property, value }) => {
            elements.forEach(element => accept(element, property, {
              value,
              important: rule.style.getPropertyPriority(property) === 'important',
              specificity: specificityByElement.get(element)
                ?? (() => {
                  const resolved = specificity(selector, element);
                  specificityByElement.set(element, resolved);
                  return resolved;
                })(),
              order,
              mediaConditions,
            }));
          });
          return;
        }
        const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
        if (nested) walkRules(nested, mediaConditions);
      });
    };
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        if (sheet.disabled || !sheet.cssRules) return;
        walkRules(sheet.cssRules);
      } catch {
        // Cross-origin author styles remain untouched. Imported project CSS is
        // inlined by the preview builder and is therefore fully inspectable.
      }
    });
    document.querySelectorAll('[style]').forEach(element => {
      if (
        !(element instanceof HTMLElement || element instanceof SVGElement)
        || element.closest(
          '[data-kodety-infinite-canvas-chrome], [data-kodety-studio-chrome]',
        )
      ) return;
      const inlineStyle = element.getAttribute('style') || '';
      if (
        !containsViewportUnit(inlineStyle)
        && !inlineStyle.includes('var(')
        && !/\bposition\s*:/i.test(inlineStyle)
      ) return;
      styleProbe.style.cssText = inlineStyle;
      const inlinePosition = styleProbe.style.getPropertyValue('position');
      if (
        inlinePosition.trim().toLowerCase() === 'fixed'
        || inlinePosition.includes('var(')
      ) fixedCandidates.add(element);
      Array.from(styleProbe.style).forEach(property => {
        const value = styleProbe.style.getPropertyValue(property);
        if (
          !value
          || (
            !containsViewportUnit(value)
            && !value.includes('var(')
          )
        ) return;
        accept(element, property, {
          value,
          important: styleProbe.style.getPropertyPriority(property) === 'important',
          specificity: 1_000_000_000,
          order: Number.MAX_SAFE_INTEGER,
          mediaConditions: [],
        });
      });
    });
    const prepared: Array<{
      element: HTMLElement | SVGElement;
      property: string;
      value: string;
      authoredValue: string;
      viewportHeight: number;
    }> = [];
    winners.forEach((properties, element) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
      const path = element.getAttribute('data-html-editor-path') || '';
      const viewportHeight = simulations.get(path) || defaultViewportHeight;
      Array.from(properties.entries()).forEach(([property, candidate]) => {
        const resolvedValue = resolveCustomProperties(element, candidate.value);
        if (!resolvedValue) return;
        VIEWPORT_UNIT_PATTERN.lastIndex = 0;
        if (!VIEWPORT_UNIT_PATTERN.test(resolvedValue)) return;
        prepared.push({
          element,
          property,
          value: viewportPixels(resolvedValue, viewportHeight),
          authoredValue: candidate.value,
          viewportHeight,
        });
      });
    });
    const authoredStyles = new Map<Element, Record<string, string>>();
    prepared.forEach(({ element, property, value, authoredValue, viewportHeight }) => {
      applyRuntimeValue(element, property, value);
      authoredStyles.set(element, {
        ...(authoredStyles.get(element) || {}),
        [property]: authoredValue,
      });
      if (!HEIGHT_PROPERTY_SET.has(property)) return;
      const properties = new Set(simulatedElements.get(element) || []);
      properties.add(property);
      simulatedElements.set(element, Array.from(properties));
      element.setAttribute('data-kodety-vh-simulated', String(viewportHeight));
      element.setAttribute('data-kodety-vh-properties', Array.from(properties).join(','));
    });
    authoredStyles.forEach((styles, element) => {
      element.setAttribute('data-kodety-vh-authored-style', JSON.stringify(styles));
    });

    // A common responsive gate uses `position: fixed; inset: 0` together with
    // `html, body { height: 100%; overflow: hidden }`. It has no literal vh,
    // yet its containing block is still the physical full-page iframe and can
    // become 10,000px tall. Treat that implicit fullscreen box as one simulated
    // viewport as well.
    const nextFixedRoots: Element[] = [];
    fixedCandidates.forEach(element => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
      if (element.closest('[data-kodety-infinite-canvas-chrome], [data-kodety-studio-chrome]')) {
        return;
      }
      const computed = getComputedStyle(element);
      if (computed.position !== 'fixed') return;
      nextFixedRoots.push(element);
      const rect = element.getBoundingClientRect();
      const top = Number.parseFloat(computed.top);
      const bottom = Number.parseFloat(computed.bottom);
      const viewportBound = Number.isFinite(top)
        && Number.isFinite(bottom)
        && rect.height >= Math.max(1, innerHeight - 2);
      if (!viewportBound) return;
      const path = element.getAttribute('data-html-editor-path') || '';
      const viewportHeight = simulations.get(path) || defaultViewportHeight;
      applyRuntimeValue(element, 'height', `${viewportHeight}px`);
      applyRuntimeValue(element, 'min-height', '0px');
      applyRuntimeValue(element, 'max-height', `${viewportHeight}px`);
      applyRuntimeValue(element, 'block-size', `${viewportHeight}px`);
      applyRuntimeValue(element, 'min-block-size', '0px');
      applyRuntimeValue(element, 'max-block-size', `${viewportHeight}px`);
      simulatedElements.set(element, ['height']);
      element.setAttribute('data-kodety-vh-simulated', String(viewportHeight));
      element.setAttribute('data-kodety-vh-properties', 'height');
    });
    fixedRootElements = nextFixedRoots;
    observer?.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'class',
        'id',
        'style',
        'media',
        'data-html-editor-selected',
        'data-html-editor-original-style',
      ],
    });
    refreshControl();
    scheduleMeasure();
  };
  const scheduleScan = () => {
    if (scanFrame) return;
    scanFrame = requestStructuralFrame(scan);
  };
  const installStylesheetMutationHooks = () => {
    if (typeof CSSStyleSheet === 'undefined') return;
    const prototype = CSSStyleSheet.prototype as CSSStyleSheet & {
      __kodetyViewportMutationHooks?: boolean;
    };
    if (prototype.__kodetyViewportMutationHooks) return;
    Object.defineProperty(prototype, '__kodetyViewportMutationHooks', {
      configurable: true,
      value: true,
    });
    const nativeInsertRule = prototype.insertRule;
    prototype.insertRule = function insertRule(rule: string, index?: number) {
      const result = nativeInsertRule.call(this, rule, index);
      scheduleScan();
      return result;
    };
    const nativeDeleteRule = prototype.deleteRule;
    prototype.deleteRule = function deleteRule(index: number) {
      nativeDeleteRule.call(this, index);
      scheduleScan();
    };
    const nativeReplaceSync = prototype.replaceSync;
    if (nativeReplaceSync) {
      prototype.replaceSync = function replaceSync(text: string) {
        nativeReplaceSync.call(this, text);
        scheduleScan();
      };
    }
    const nativeReplace = prototype.replace;
    if (nativeReplace) {
      prototype.replace = function replace(text: string) {
        return nativeReplace.call(this, text).then(sheet => {
          scheduleScan();
          return sheet;
        });
      };
    }
  };
  installStylesheetMutationHooks();
  const measure = () => {
    measureFrame = 0;
    const body = document.body;
    let height = defaultViewportHeight;
    if (!body) return;
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(body);
    const clipsVertically = (style: CSSStyleDeclaration) =>
      style.overflowY === 'hidden' || style.overflowY === 'clip';
    const fillsPhysicalViewport = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.height - innerHeight) <= 2;
    };
    const boundedViewportShell = clipsVertically(rootStyle)
      && clipsVertically(bodyStyle)
      && fillsPhysicalViewport(root)
      && fillsPhysicalViewport(body);

    // scrollHeight/offsetHeight on html/body are always at least the iframe's
    // current viewport. Feeding that value back into the iframe height makes a
    // stale or late measurement impossible to shrink and is the source of the
    // giant white regions seen while frames load. Measure authored content
    // bounds instead; the device-like viewport is the stable minimum.
    const editorElements = Array.from(
      body.querySelectorAll('[data-html-editor-path]'),
    );
    const contentElements = boundedViewportShell
      ? []
      : editorElements.length
        ? editorElements
        : Array.from(body.children);
    const insideFixedRoot = (element: Element) => {
      let current: Element | null = element;
      while (current && current !== body) {
        if (fixedRootElements.includes(current)) return true;
        current = current.parentElement;
      }
      return false;
    };
    contentElements.forEach(element => {
      if (
        element.closest(
          '[data-kodety-infinite-canvas-chrome], [data-kodety-studio-chrome]',
        )
        || insideFixedRoot(element)
        || /^(?:SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(element.tagName)
      ) return;
      const rect = element.getBoundingClientRect();
      const bottom = rect.bottom + window.scrollY;
      if (
        !Number.isFinite(bottom)
        || bottom <= height
        || (rect.width <= 0 && rect.height <= 0)
      ) return;
      // Computed style is expensive on a long document. Read it only for an
      // element that can actually extend the current lower bound.
      const computed = getComputedStyle(element);
      if (
        computed.display === 'none'
        || computed.visibility === 'hidden'
      ) return;
      const marginBottom = Number.parseFloat(computed.marginBottom);
      height = Math.max(
        height,
        bottom
          + (Number.isFinite(marginBottom) ? Math.max(0, marginBottom) : 0),
      );
    });
    height = Math.max(
      defaultViewportHeight,
      Math.min(1_000_000, Math.ceil(height)),
    );
    if (Math.abs(height - lastHeight) < 1) return;
    lastHeight = height;
    post({ type: 'html-editor-infinite-canvas-height', height });
  };
  const scheduleMeasure = () => {
    if (measureFrame) return;
    measureFrame = requestStructuralFrame(measure);
  };
  const findSimulatedSection = () => {
    let element = document.querySelector('[data-html-editor-selected]');
    while (element && element !== document.documentElement) {
      if (simulatedElements.has(element)) return element;
      element = element.parentElement?.closest('[data-html-editor-path]') || null;
    }
    return null;
  };

  const control = document.createElement('div');
  control.id = '__kodety-vh-control';
  control.setAttribute('data-kodety-infinite-canvas-chrome', '');
  control.hidden = true;
  control.innerHTML = `
    <span aria-hidden="true" data-kodety-vh-grip>↕</span>
    <span>Viewport</span>
    <input data-kodety-vh-input type="number" min="${MIN_VIEWPORT_HEIGHT}" max="${MAX_VIEWPORT_HEIGHT}" step="10" aria-label="Altura de viewport simulada">
    <span>px</span>
  `;
  const style = document.createElement('style');
  style.setAttribute('data-kodety-infinite-canvas-runtime', '');
  style.textContent = `
    #__kodety-vh-control {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 9px;
      border: 1px solid rgba(255,255,255,.35);
      border-radius: 10px;
      background: #9393FF;
      color: black;
      box-sizing: border-box;
      box-shadow: 0 8px 24px rgba(0,0,0,.28);
      font: 600 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      transform: translate(-50%, -50%);
      cursor: ns-resize;
      touch-action: none;
      user-select: none;
      white-space: nowrap;
    }
    #__kodety-vh-control[hidden] { display: none; }
    #__kodety-vh-control [data-kodety-vh-grip] { font-size: 16px; opacity: .9; }
    #__kodety-vh-control input {
      width: 56px;
      height: 23px;
      border: 0;
      border-radius: 6px;
      outline: 0;
      background: rgba(0,0,0,.2);
      color: white;
      font: inherit;
      text-align: right;
      cursor: text;
      appearance: textfield;
    }
    #__kodety-vh-control input::-webkit-inner-spin-button { appearance: none; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(control);
  const input = control.querySelector<HTMLInputElement>('[data-kodety-vh-input]')!;
  let controlledSection: Element | null = null;
  const setSimulation = (element: Element, height: number, notify = true) => {
    const path = element.getAttribute('data-html-editor-path');
    if (path === null) return;
    const next = clampHeight(height);
    simulations.set(path, next);
    input.value = String(next);
    scheduleScan();
    if (notify) {
      post({
        type: 'html-editor-viewport-height-simulation',
        path,
        height: next,
      });
    }
  };
  function refreshControl() {
    controlledSection = findSimulatedSection();
    if (!controlledSection) {
      control.hidden = true;
      return;
    }
    const rect = controlledSection.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.bottom) || rect.width < 1) {
      control.hidden = true;
      return;
    }
    const path = controlledSection.getAttribute('data-html-editor-path') || '';
    const height = simulations.get(path) || defaultViewportHeight;
    input.value = String(height);
    control.style.left = `${Math.max(72, Math.min(innerWidth - 72, rect.left + rect.width / 2))}px`;
    control.style.top = `${Math.max(18, Math.min(innerHeight - 18, rect.bottom))}px`;
    control.title = `Simular viewport da seção em ${height}px. Arraste verticalmente ou digite um valor.`;
    control.hidden = false;
  }
  let controlFrame = 0;
  const scheduleControlRefresh = () => {
    if (controlFrame) return;
    controlFrame = requestStructuralFrame(() => {
      controlFrame = 0;
      refreshControl();
    });
  };
  const commitInputHeight = () => {
    if (controlledSection) setSimulation(controlledSection, Number(input.value));
  };
  input.addEventListener('change', commitInputHeight);
  input.addEventListener('blur', commitInputHeight);
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commitInputHeight();
    input.blur();
  });
  control.addEventListener('dblclick', event => {
    if (event.target === input || !controlledSection) return;
    event.preventDefault();
    setSimulation(controlledSection, defaultViewportHeight);
  });
  control.addEventListener('pointerdown', event => {
    if (event.target === input || !controlledSection) return;
    event.preventDefault();
    const section = controlledSection;
    const path = section.getAttribute('data-html-editor-path') || '';
    const startHeight = simulations.get(path) || defaultViewportHeight;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    try { control.setPointerCapture(pointerId); } catch { /* Window fallback below. */ }
    const move = (moveEvent: PointerEvent) => {
      setSimulation(section, startHeight + moveEvent.clientY - startY);
      refreshControl();
    };
    const finish = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
      try {
        if (control.hasPointerCapture(pointerId)) control.releasePointerCapture(pointerId);
      } catch { /* Already released. */ }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', finish);
  });

  addEventListener('message', event => {
    if (event.source !== parent) return;
    const generation = (window as Window & { __KODETY_EDITOR_GENERATION__?: string })
      .__KODETY_EDITOR_GENERATION__;
    if (!generation || event.data?.generation !== generation) return;
    if (event.data?.type === 'html-editor-infinite-canvas-default-height') {
      defaultViewportHeight = clampHeight(event.data.height);
      lastHeight = 0;
      scheduleScan();
      scheduleMeasure();
      refreshControl();
      return;
    }
    if (event.data?.type === 'html-editor-infinite-canvas-refresh-height') {
      lastHeight = 0;
      scheduleMeasure();
      return;
    }
    if (event.data?.type !== 'html-editor-viewport-height-simulations') return;
    const values = event.data.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return;
    simulations.clear();
    Object.entries(values).slice(0, 2048).forEach(([path, value]) => {
      if (path.length <= 2048) simulations.set(path, clampHeight(value));
    });
    scheduleScan();
  });
  observer = new MutationObserver(mutations => {
    // A runtime may replace a simulated inline declaration after load
    // (`element.style.height = '100dvh'`, GSAP set(), React style props, etc.).
    // Preserve that new authored/runtime value before removing our previous
    // editor-only override for the next cascade scan.
    mutations.forEach(mutation => {
      const target = mutation.target;
      if (
        mutation.type !== 'attributes'
        || mutation.attributeName !== 'style'
        || !(
          target instanceof HTMLElement
          || target instanceof SVGElement
        )
      ) return;
      const runtimeValues = appliedRuntimeValues.get(target);
      const originals = appliedOriginalValues.get(target);
      if (!runtimeValues || !originals) return;
      runtimeValues.forEach((runtimeValue, property) => {
        const current = {
          value: target.style.getPropertyValue(property),
          priority: target.style.getPropertyPriority(property),
        };
        if (
          current.value !== runtimeValue.value
          || current.priority !== runtimeValue.priority
        ) {
          originals.set(property, current);
        }
      });
    });
    const needsScan = mutations.some(mutation =>
      mutation.type === 'childList'
      || (
        mutation.type === 'attributes'
        && mutation.attributeName !== 'data-html-editor-selected'
      ));
    if (needsScan) {
      // The cascade scan schedules one structural measurement after it has
      // restored/reapplied viewport-unit overrides. Measuring before it would
      // duplicate the O(N) walk against stale geometry.
      scheduleScan();
    } else refreshControl();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'class',
      'id',
      'style',
      'media',
      'data-html-editor-selected',
      'data-html-editor-original-style',
    ],
  });
  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => {
      refreshControl();
      scheduleMeasure();
    });
  if (resizeObserver) {
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  }
  document.addEventListener('scroll', () => {
    // Scroll (including a nested overflow scroller) moves the selected
    // section's editor chrome, but does not change the document's structural
    // extent. Resize/load/font/mutation observers own height invalidation.
    scheduleControlRefresh();
  }, true);
  addEventListener('resize', () => {
    refreshControl();
    // Parent height fitting fires resize repeatedly. Only a width change can
    // change responsive selectors and therefore requires another cascade scan.
    if (Math.abs(window.innerWidth - lastObservedWidth) >= 1) {
      lastObservedWidth = window.innerWidth;
      scheduleScan();
    }
    scheduleMeasure();
  });
  document.addEventListener('load', scheduleMeasure, true);
  document.fonts?.ready?.then(() => {
    scheduleScan();
    scheduleMeasure();
  }).catch(() => {});
  // Yield once before the first cascade walk so the iframe can finish parsing,
  // fire load/canvas-ready and make the active breakpoint interactive. Its
  // initial physical height already equals the simulated device viewport, so
  // authored vh units are visually correct until this first structural frame.
  scheduleScan();
  [120, 600].forEach(delay => setStructuralTimeout(() => {
    scheduleScan();
    scheduleMeasure();
  }, delay));
}

/**
 * Lightweight runtime used by read-only breakpoint references.
 *
 * The editable frame needs the full cascade/element simulation above because
 * it exposes per-section controls and exact authored-style provenance. A
 * reference frame only needs to render the same document at another width and
 * report its complete height. Rewriting viewport units directly in their
 * original CSS declarations preserves cascade order without the expensive
 * selector -> element -> specificity walk in every iframe.
 */
function infiniteCanvasPassiveRuntimeBootstrap() {
  const MIN_VIEWPORT_HEIGHT = 240;
  const MAX_VIEWPORT_HEIGHT = 10000;
  const VIEWPORT_VARIABLE = '--kodety-passive-viewport-unit';
  const VIEWPORT_UNIT_PATTERN = /(-?(?:\d+|\d*\.\d+))(dvh|svh|lvh|vh)\b/gi;
  const nativeClock = (
    window as Window & {
      __KODETY_EDITOR_NATIVE_CLOCK__?: {
        requestAnimationFrame?: typeof window.requestAnimationFrame;
        setTimeout?: typeof window.setTimeout;
      };
    }
  ).__KODETY_EDITOR_NATIVE_CLOCK__;
  const requestStructuralFrame = nativeClock?.requestAnimationFrame
    || window.requestAnimationFrame.bind(window);
  const setStructuralTimeout = nativeClock?.setTimeout
    || window.setTimeout.bind(window);
  const declarationOriginals = new WeakMap<
    CSSStyleDeclaration,
    Map<string, { value: string; priority: string }>
  >();
  const declarationApplications = new WeakMap<
    CSSStyleDeclaration,
    Map<string, { value: string; priority: string }>
  >();
  const originalMediaConditions = new WeakMap<CSSMediaRule, string>();
  const simulatedMediaConditions = new WeakMap<CSSMediaRule, string>();
  let defaultViewportHeight = Math.max(
    MIN_VIEWPORT_HEIGHT,
    Math.min(MAX_VIEWPORT_HEIGHT, Math.round(window.innerHeight || 1080)),
  );
  let observer: MutationObserver | null = null;
  let scanFrame = 0;
  let measureFrame = 0;
  let lastHeight = 0;
  let lastObservedWidth = window.innerWidth;
  let simulations: Record<string, number> = {};

  const clampHeight = (value: unknown) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return defaultViewportHeight;
    return Math.max(
      MIN_VIEWPORT_HEIGHT,
      Math.min(MAX_VIEWPORT_HEIGHT, Math.round(number)),
    );
  };
  const post = (message: Record<string, unknown>) => {
    const generation = (window as Window & { __KODETY_EDITOR_GENERATION__?: string })
      .__KODETY_EDITOR_GENERATION__;
    if (!generation) return;
    parent.postMessage({ ...message, generation }, '*');
  };
  const runtimeNode = (node: Node | null) => {
    const element = node instanceof Element ? node : node?.parentElement;
    return Boolean(element?.closest(
      '[data-kodety-infinite-canvas-passive-style], [data-kodety-infinite-canvas-chrome], [data-kodety-studio-chrome]',
    ));
  };
  const cssString = (value: string) => value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\a ');
  const containsViewportUnit = (value: string) => {
    VIEWPORT_UNIT_PATTERN.lastIndex = 0;
    return VIEWPORT_UNIT_PATTERN.test(value);
  };
  const rewriteViewportValue = (value: string) => {
    VIEWPORT_UNIT_PATTERN.lastIndex = 0;
    return value.replace(
      VIEWPORT_UNIT_PATTERN,
      (_match, amount: string) => `calc(${Number(amount)} * var(${VIEWPORT_VARIABLE}))`,
    );
  };

  const baseStyle = document.createElement('style');
  baseStyle.setAttribute('data-kodety-infinite-canvas-passive-style', 'base');
  const simulationStyle = document.createElement('style');
  simulationStyle.setAttribute('data-kodety-infinite-canvas-passive-style', 'simulations');
  const refreshRuntimeStyles = () => {
    baseStyle.textContent = `:root{${VIEWPORT_VARIABLE}:${defaultViewportHeight / 100}px}html,body{height:auto!important}`;
    simulationStyle.textContent = Object.entries(simulations)
      .map(([path, height]) => (
        `[data-html-editor-path="${cssString(path)}"]{${VIEWPORT_VARIABLE}:${clampHeight(height) / 100}px!important}`
      ))
      .join('');
  };
  document.head.append(baseStyle, simulationStyle);
  refreshRuntimeStyles();

  const rewriteDeclarations = (style: CSSStyleDeclaration) => {
    const applied = declarationApplications.get(style) || new Map();
    const properties = new Set<string>([
      ...Array.from(style),
      ...Array.from(applied.keys()),
    ]);
    properties.forEach(property => {
      const current = {
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property),
      };
      const previousApplication = applied.get(property);
      const candidate = containsViewportUnit(current.value)
        || (property === 'position' && current.value.trim().toLowerCase() === 'fixed')
        || Boolean(previousApplication);
      if (!candidate) return;

      let originals = declarationOriginals.get(style);
      if (!originals) {
        originals = new Map();
        declarationOriginals.set(style, originals);
      }
      if (
        !previousApplication
        || current.value !== previousApplication.value
        || current.priority !== previousApplication.priority
      ) {
        originals.set(property, current);
      }
      const authored = originals.get(property) || current;
      const nextValue = containsViewportUnit(authored.value)
        ? rewriteViewportValue(authored.value)
        : property === 'position' && authored.value.trim().toLowerCase() === 'fixed'
          ? 'absolute'
          : authored.value;
      if (nextValue === authored.value) {
        if (
          previousApplication
          && current.value === previousApplication.value
          && current.priority === previousApplication.priority
        ) {
          if (authored.value) style.setProperty(property, authored.value, authored.priority);
          else style.removeProperty(property);
        }
        applied.delete(property);
        return;
      }
      if (current.value !== nextValue || current.priority !== authored.priority) {
        style.setProperty(property, nextValue, authored.priority);
      }
      applied.set(property, { value: nextValue, priority: authored.priority });
    });
    if (applied.size) declarationApplications.set(style, applied);
    else declarationApplications.delete(style);
  };

  const rewriteMediaConditionAtHeight = (condition: string) => {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const mediaLength = (rawValue: string, rawUnit: string) => {
      const value = Number(rawValue);
      const unit = rawUnit.toLowerCase();
      return unit === 'px'
        ? value
        : unit === 'em' || unit === 'rem'
          ? value * rootFontSize
          : value * defaultViewportHeight / 100;
    };
    const truthyQuery = (matches: boolean) => (
      matches ? '(min-width: 0px)' : '(max-width: -1px)'
    );
    let rewritten = condition.replace(
      /\(\s*(min|max)-height\s*:\s*(-?(?:\d+|\d*\.\d+))(px|rem|em|dvh|svh|lvh|vh)\s*\)/gi,
      (_match, boundary: string, rawValue: string, rawUnit: string) => {
        const threshold = mediaLength(rawValue, rawUnit);
        return truthyQuery(
          boundary.toLowerCase() === 'min'
            ? defaultViewportHeight >= threshold
            : defaultViewportHeight <= threshold,
        );
      },
    );
    rewritten = rewritten.replace(
      /\(\s*height\s*(<=|>=|<|>)\s*(-?(?:\d+|\d*\.\d+))(px|rem|em|dvh|svh|lvh|vh)\s*\)/gi,
      (_match, operator: string, rawValue: string, rawUnit: string) => {
        const threshold = mediaLength(rawValue, rawUnit);
        return truthyQuery(
          operator === '<' ? defaultViewportHeight < threshold
            : operator === '<=' ? defaultViewportHeight <= threshold
              : operator === '>' ? defaultViewportHeight > threshold
                : defaultViewportHeight >= threshold,
        );
      },
    );
    rewritten = rewritten.replace(
      /\(\s*(-?(?:\d+|\d*\.\d+))(px|rem|em|dvh|svh|lvh|vh)\s*(<=|>=|<|>)\s*height\s*\)/gi,
      (_match, rawValue: string, rawUnit: string, operator: string) => {
        const threshold = mediaLength(rawValue, rawUnit);
        return truthyQuery(
          operator === '<' ? threshold < defaultViewportHeight
            : operator === '<=' ? threshold <= defaultViewportHeight
              : operator === '>' ? threshold > defaultViewportHeight
                : threshold >= defaultViewportHeight,
        );
      },
    );
    return rewritten.replace(
      /\(\s*orientation\s*:\s*(portrait|landscape)\s*\)/gi,
      (_match, orientation: string) => {
        const portrait = window.innerWidth <= defaultViewportHeight;
        return truthyQuery(
          orientation.toLowerCase() === 'portrait' ? portrait : !portrait,
        );
      },
    );
  };

  const walkRules = (rules: CSSRuleList) => {
    Array.from(rules).forEach(rule => {
      if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) {
        try {
          if (rule.styleSheet?.cssRules) walkRules(rule.styleSheet.cssRules);
        } catch {
          // Cross-origin imports cannot be rewritten; local project CSS is inlined.
        }
        return;
      }
      if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
        const currentCondition = rule.conditionText;
        const previousSimulation = simulatedMediaConditions.get(rule);
        if (!previousSimulation || currentCondition !== previousSimulation) {
          originalMediaConditions.set(rule, currentCondition);
        }
        const authoredCondition = originalMediaConditions.get(rule) || currentCondition;
        const nextCondition = rewriteMediaConditionAtHeight(authoredCondition);
        try {
          if (rule.media.mediaText !== nextCondition) rule.media.mediaText = nextCondition;
          simulatedMediaConditions.set(rule, rule.conditionText);
        } catch {
          // Some constructable stylesheets expose a read-only MediaList.
        }
      }
      const style = (rule as CSSRule & { style?: CSSStyleDeclaration }).style;
      if (style) rewriteDeclarations(style);
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (nested) walkRules(nested);
    });
  };

  const observe = () => observer?.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'id', 'style', 'media', 'hidden'],
  });
  const scan = () => {
    scanFrame = 0;
    observer?.disconnect();
    Array.from(document.styleSheets).forEach(sheet => {
      if (runtimeNode(sheet.ownerNode)) return;
      try {
        if (!sheet.disabled && sheet.cssRules) walkRules(sheet.cssRules);
      } catch {
        // Cross-origin stylesheets remain browser-owned.
      }
    });
    document.querySelectorAll<HTMLElement | SVGElement>(
      '[style*="vh" i], [style*="position" i]',
    ).forEach(element => {
      if (!runtimeNode(element)) rewriteDeclarations(element.style);
    });
    observe();
    scheduleMeasure();
  };
  const scheduleScan = () => {
    if (scanFrame) return;
    scanFrame = requestStructuralFrame(scan);
  };

  const measure = () => {
    measureFrame = 0;
    const body = document.body;
    if (!body) return;
    const root = document.documentElement;
    // Viewport units were already detached from the physical iframe height,
    // so scrollHeight is stable here. This is the inexpensive complete-page
    // measurement used by the passive references; only top-level children are
    // sampled as a fallback for transformed/absolutely-positioned overflow.
    const physicalHeight = Math.max(1, root.clientHeight, window.innerHeight);
    const scrollExtent = Math.max(root.scrollHeight, body.scrollHeight);
    let height = scrollExtent > physicalHeight + 1
      ? Math.max(defaultViewportHeight, scrollExtent)
      : defaultViewportHeight;
    Array.from(body.children).forEach(element => {
      if (
        runtimeNode(element)
        || /^(?:SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(element.tagName)
      ) return;
      const rect = element.getBoundingClientRect();
      const bottom = rect.bottom + window.scrollY;
      if (
        !Number.isFinite(bottom)
        || bottom <= height
        || (rect.width <= 0 && rect.height <= 0)
      ) return;
      height = bottom;
    });
    height = Math.max(defaultViewportHeight, Math.min(1_000_000, Math.ceil(height)));
    if (Math.abs(height - lastHeight) < 1) return;
    lastHeight = height;
    post({ type: 'html-editor-infinite-canvas-height', height });
  };
  function scheduleMeasure() {
    if (measureFrame) return;
    measureFrame = requestStructuralFrame(measure);
  }

  const installStylesheetMutationHooks = () => {
    if (typeof CSSStyleSheet === 'undefined') return;
    const prototype = CSSStyleSheet.prototype as CSSStyleSheet & {
      __kodetyPassiveViewportMutationHooks?: boolean;
    };
    if (prototype.__kodetyPassiveViewportMutationHooks) return;
    Object.defineProperty(prototype, '__kodetyPassiveViewportMutationHooks', {
      configurable: true,
      value: true,
    });
    const nativeInsertRule = prototype.insertRule;
    prototype.insertRule = function insertRule(rule: string, index?: number) {
      const result = nativeInsertRule.call(this, rule, index);
      scheduleScan();
      return result;
    };
    const nativeDeleteRule = prototype.deleteRule;
    prototype.deleteRule = function deleteRule(index: number) {
      nativeDeleteRule.call(this, index);
      scheduleScan();
    };
    const nativeReplaceSync = prototype.replaceSync;
    if (nativeReplaceSync) {
      prototype.replaceSync = function replaceSync(text: string) {
        nativeReplaceSync.call(this, text);
        scheduleScan();
      };
    }
    const nativeReplace = prototype.replace;
    if (nativeReplace) {
      prototype.replace = function replace(text: string) {
        return nativeReplace.call(this, text).then(sheet => {
          scheduleScan();
          return sheet;
        });
      };
    }
  };
  installStylesheetMutationHooks();

  observer = new MutationObserver(mutations => {
    let needsScan = false;
    let needsMeasure = false;
    mutations.forEach(mutation => {
      if (runtimeNode(mutation.target)) return;
      needsMeasure = true;
      if (mutation.type === 'attributes' && (
        mutation.attributeName === 'style'
        || mutation.attributeName === 'media'
      )) needsScan = true;
      if (mutation.type === 'childList') {
        const changedStylesheet = [
          ...Array.from(mutation.addedNodes),
          ...Array.from(mutation.removedNodes),
        ].some(node => (
          node instanceof HTMLStyleElement
          || node instanceof HTMLLinkElement
          || Boolean(node instanceof Element && node.querySelector('style,link[rel="stylesheet"]'))
        ));
        if (changedStylesheet || mutation.target instanceof HTMLStyleElement) needsScan = true;
      }
    });
    if (needsScan) scheduleScan();
    else if (needsMeasure) scheduleMeasure();
  });
  observe();

  addEventListener('message', event => {
    if (event.source !== parent) return;
    const generation = (window as Window & { __KODETY_EDITOR_GENERATION__?: string })
      .__KODETY_EDITOR_GENERATION__;
    if (!generation || event.data?.generation !== generation) return;
    if (event.data?.type === 'html-editor-infinite-canvas-default-height') {
      defaultViewportHeight = clampHeight(event.data.height);
      lastHeight = 0;
      refreshRuntimeStyles();
      scheduleScan();
      scheduleMeasure();
      return;
    }
    if (event.data?.type === 'html-editor-infinite-canvas-refresh-height') {
      lastHeight = 0;
      scheduleMeasure();
      return;
    }
    if (event.data?.type !== 'html-editor-viewport-height-simulations') return;
    const values = event.data.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return;
    simulations = Object.fromEntries(
      Object.entries(values)
        .slice(0, 2048)
        .filter(([path]) => path.length <= 2048)
        .map(([path, value]) => [path, clampHeight(value)]),
    );
    refreshRuntimeStyles();
    lastHeight = 0;
    scheduleMeasure();
  });
  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(scheduleMeasure);
  if (resizeObserver) {
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  }
  addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastObservedWidth) >= 1) {
      lastObservedWidth = window.innerWidth;
      scheduleScan();
    }
    scheduleMeasure();
  });
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLLinkElement) scheduleScan();
    scheduleMeasure();
  }, true);
  document.fonts?.ready?.then(() => {
    scheduleScan();
    scheduleMeasure();
  }).catch(() => {});
  scheduleScan();
  [80, 320].forEach(delay => setStructuralTimeout(() => {
    scheduleScan();
    scheduleMeasure();
  }, delay));
}

export function injectInfiniteCanvasRuntime(
  html: string,
  options: InfiniteCanvasRuntimeOptions = {},
) {
  // The motion-freeze bootstrap names this marker in its safe-script list.
  // Looking for the raw text therefore produced a false positive and skipped
  // the actual runtime injection, reopening the 100vh/frame-height feedback
  // loop. Only an existing marker *attribute on a script tag* is idempotent.
  if (!html || RUNTIME_TAG_PATTERN.test(html)) return html;
  const configuredViewportHeight = Number(options.defaultViewportHeight);
  const configuration = Number.isFinite(configuredViewportHeight)
    ? {
      defaultViewportHeight: Math.max(
        240,
        Math.min(10000, Math.round(configuredViewportHeight)),
      ),
    }
    : {};
  const bootstrap = inlineScriptSafe(infiniteCanvasRuntimeBootstrap.toString());
  const runtime = `<script ${RUNTIME_MARKER}>(${bootstrap})(${JSON.stringify(configuration)});</script>`;
  return appendRuntimeToDocument(html, runtime);
}

export function injectInfiniteCanvasPassiveRuntime(html: string) {
  if (!html || RUNTIME_TAG_PATTERN.test(html)) return html;
  const bootstrap = inlineScriptSafe(infiniteCanvasPassiveRuntimeBootstrap.toString());
  const runtime = `<script ${RUNTIME_MARKER}>(${bootstrap})();</script>`;
  return appendRuntimeToDocument(html, runtime);
}
