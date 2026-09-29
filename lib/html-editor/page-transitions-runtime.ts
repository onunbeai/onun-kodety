import motionLicenseSource from '../../licenses/MOTION-LICENSE.md?raw';
import motionRuntimeSource from '../../node_modules/motion/dist/motion.js?raw';
import swupRuntimeSource from '../../node_modules/swup/dist/Swup.umd.js?raw';
import swupHeadPluginSource from '../../node_modules/@swup/head-plugin/dist/index.umd.js?raw';
import swupA11yPluginSource from '../../node_modules/@swup/a11y-plugin/dist/index.umd.js?raw';
import swupPreloadPluginSource from '../../node_modules/@swup/preload-plugin/dist/index.umd.js?raw';
import type { HtmlProject, HtmlProjectFile } from './types';
import { projectPublicDirectoryNames } from './coded-project';
import { publicRouteForProjectPage } from './redirects';
import {
  normalizePagePath,
  pageTransitionKeyframes,
  pageTransitionMotionEase,
  readPageTransitionDocument,
  type PageTransitionRule,
  type UniversalPageTransition,
} from './page-transitions';

export const PAGE_TRANSITIONS_RUNTIME_PATH = 'kodety-runtime/page-transitions-v1.js';

const PAGE_TRANSITIONS_STYLES = String.raw`
[data-kodety-page-transition-container] { min-height: 100%; }
@media (prefers-reduced-motion: reduce) {
  html::view-transition-old(root), html::view-transition-new(root) { animation: none !important; }
}
`;

function pageTransitionsRuntime() {
  const dependencies = [
    swupRuntimeSource,
    swupHeadPluginSource,
    swupA11yPluginSource,
    swupPreloadPluginSource,
  ].map(source => source.replace(/<\/script/gi, '<\\/script')).join(';\n');
  const motionVendor = motionRuntimeSource.replace(/<\/script/gi, '<\\/script');
  const motionBootstrap = `(() => {
    if (window.__ONUN_MOTION__) return;
    const own = Object.prototype.hasOwnProperty.call(window, 'Motion');
    const descriptor = Object.getOwnPropertyDescriptor(window, 'Motion');
    try { /*!\n${motionLicenseSource}\n*/\n${motionVendor}; window.__ONUN_MOTION__ = window.Motion; }
    finally { if (own && descriptor) Object.defineProperty(window, 'Motion', descriptor); else delete window.Motion; }
  })();`;
  const helpers = `${pageTransitionKeyframes.toString()}\n${pageTransitionMotionEase.toString()}`;
  return `${dependencies};\n${motionBootstrap}\n${String.raw`
(() => {
  if (window.__KODETY_PAGE_TRANSITIONS__ || typeof window.Swup !== 'function') return;
  const Motion = window.__ONUN_MOTION__;
__ONUN_PAGE_MOTION_HELPERS__
  const CONFIG_SELECTOR = 'script[data-kodety-page-transitions-config]';
  const CONTAINER_SELECTOR = '[data-kodety-page-transition-container]';
  const normalizeRoute = value => {
    const route = String(value || '/').split(/[?#]/, 1)[0].replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (!route || route === '/') return '/';
    return '/' + route.replace(/^\/+|\/+$/g, '');
  };
  const readConfig = (doc = document) => {
    try { return JSON.parse(doc.querySelector(CONFIG_SELECTOR)?.textContent || 'null'); }
    catch { return null; }
  };
  let config = readConfig();
  if (!config || !Array.isArray(config.routes)) return;
  const currentRoute = normalizeRoute(config.currentRoute);
  const currentPath = normalizeRoute(window.location.pathname);
  const basePath = currentRoute === '/'
    ? currentPath
    : currentPath.endsWith(currentRoute)
      ? normalizeRoute(currentPath.slice(0, -currentRoute.length))
      : '/';
  const routeForUrl = value => {
    let pathname;
    try { pathname = new URL(value, window.location.href).pathname; }
    catch { return ''; }
    const normalized = normalizeRoute(pathname);
    if (basePath !== '/') {
      if (normalized === basePath) return '/';
      if (!normalized.startsWith(basePath + '/')) return '';
      return normalizeRoute(normalized.slice(basePath.length));
    }
    return normalized;
  };
  const routes = new Set(config.routes.map(item => normalizeRoute(item.route)));
  const reverseEffect = effect => ({
    'slide-left': 'slide-right',
    'slide-right': 'slide-left',
    'slide-up': 'slide-down',
    'slide-down': 'slide-up',
    'wipe-left': 'wipe-right',
    'wipe-right': 'wipe-left',
    'wipe-up': 'wipe-down',
    'wipe-down': 'wipe-up',
  })[effect] || effect;
  const reverseMotion = motion => motion ? { ...motion, effect: reverseEffect(motion.effect) } : null;
  const motionFor = (from, to, reverseUniversal = false) => {
    const exact = (config.rules || []).find(rule => rule.enabled !== false
      && normalizeRoute(rule.fromRoute) === from
      && normalizeRoute(rule.toRoute) === to);
    if (exact) return exact;
    const reverse = (config.rules || []).find(rule => rule.enabled !== false
      && normalizeRoute(rule.fromRoute) === to
      && normalizeRoute(rule.toRoute) === from);
    if (reverse) return reverseMotion(reverse);
    if (!config.universal?.enabled) return null;
    return reverseUniversal ? reverseMotion(config.universal) : config.universal;
  };
  const motionForVisit = (fromUrl, toUrl, reverseUniversal = false) => {
    const from = routeForUrl(fromUrl);
    const to = routeForUrl(toUrl);
    if (!from || !to || from === to || !routes.has(from) || !routes.has(to)) return null;
    return motionFor(from, to, reverseUniversal);
  };
  const applyMotion = motion => {
    const root = document.documentElement;
    if (!motion) {
      delete root.dataset.kodetyPageTransitionEffect;
      root.style.removeProperty('--kodety-page-transition-duration');
      root.style.removeProperty('--kodety-page-transition-easing');
      return;
    }
    root.dataset.kodetyPageTransitionEffect = motion.effect || 'fade';
    root.style.setProperty('--kodety-page-transition-duration', Math.max(.1, Math.min(3, Number(motion.duration) || .42)) + 's');
    root.style.setProperty('--kodety-page-transition-easing', motion.easing || 'ease');
  };
  const plugins = [
    new window.SwupHeadPlugin({ awaitAssets: true, persistTags: 'script[data-kodety-page-transitions-runtime]' }),
    new window.SwupA11yPlugin({ respectReducedMotion: true }),
  ];
  if (config.universal?.preload && typeof window.SwupPreloadPlugin === 'function') {
    plugins.push(new window.SwupPreloadPlugin());
  }
  const swup = new window.Swup({
    containers: [CONTAINER_SELECTOR],
    animationSelector: false,
    animateHistoryBrowsing: true,
    native: false,
    plugins,
    ignoreVisit: (url, { el } = {}) => Boolean(
      el?.closest?.('[data-no-swup]')
      || !motionForVisit(window.location.href, url)
    ),
  });
  swup.hooks.on('visit:start', visit => {
    const motion = motionForVisit(
      visit.from.url,
      visit.to.url,
      visit.history.direction === 'backwards',
    );
    visit.meta.kodetyPageTransition = motion;
    if (!motion) visit.animation.animate = false;
    applyMotion(motion);
    document.dispatchEvent(new CustomEvent('kodety:page-transition-start', {
      detail: { from: visit.from.url, to: visit.to.url, motion },
    }));
  });
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animationCleanup = new Set();
  const animatePhase = async (visit, phase) => {
    if (visit.meta.onunViewTransition || !visit.animation.animate || reducedMotion()) return;
    const motion = visit.meta.kodetyPageTransition;
    const element = document.querySelector(CONTAINER_SELECTOR);
    if (!motion || !element || !Motion?.animate) return;
    const frames = pageTransitionKeyframes(motion.effect)[phase];
    const previous = Object.fromEntries(Object.keys(frames).map(key => [key, element.style[key]]));
    const animation = Motion.animate(element, frames, { duration: motion.duration, ease: pageTransitionMotionEase(motion.easing) });
    animationCleanup.add(() => { animation.cancel(); Object.assign(element.style, previous); });
    await animation.finished;
  };
  swup.hooks.replace('animation:out:await', visit => animatePhase(visit, 'outgoing'));
  swup.hooks.replace('animation:in:await', visit => animatePhase(visit, 'incoming'));
  swup.hooks.replace('visit:transition', async (visit, args, defaultHandler) => {
    const motion = visit.meta.kodetyPageTransition;
    if (!motion || !visit.animation.animate || reducedMotion() || !document.startViewTransition || !Motion?.animateView) {
      return defaultHandler(visit, args);
    }
    // Wrap the entire navigation update, including head assets, scroll and
    // interaction reinitialization, so both snapshots represent complete pages.
    visit.meta.onunViewTransition = true;
    const frames = pageTransitionKeyframes(motion.effect);
    let updatePromise;
    const update = () => updatePromise || (updatePromise = Promise.resolve().then(() => defaultHandler(visit, args)));
    try {
      const animation = await Motion.animateView(update, { duration: motion.duration, ease: pageTransitionMotionEase(motion.easing) })
        .old(frames.outgoing).new(frames.incoming);
      await animation.finished;
    } catch (error) {
      // Browser support/capture failures must not swallow or duplicate navigation.
      await update();
    }
  });
  swup.hooks.before('content:replace', () => {
    window.__kodetyInteractions?.destroy?.();
    document.dispatchEvent(new CustomEvent('kodety:page-before-replace'));
  });
  swup.hooks.on('page:view', visit => {
    config = readConfig(visit.to.document) || config;
    const interactionScript = visit.to.document?.querySelector('script[data-kodety-interactions-runtime]');
    if (interactionScript?.textContent) {
      const executable = document.createElement('script');
      executable.setAttribute('data-kodety-page-transition-reinitialized', 'true');
      executable.textContent = interactionScript.textContent;
      document.head.appendChild(executable);
      executable.remove();
    }
    window.KodetyOverlays?.refresh?.();
    document.dispatchEvent(new CustomEvent('kodety:page-view', {
      detail: { from: visit.from.url, to: visit.to.url },
    }));
  });
  const cleanup = () => { animationCleanup.forEach(clean => clean()); animationCleanup.clear(); applyMotion(null); };
  swup.hooks.on('visit:end', cleanup);
  swup.hooks.on('visit:abort', cleanup);
  window.__KODETY_PAGE_TRANSITIONS__ = { engine: 'motion', swup, config: () => config, destroy: () => { cleanup(); swup.destroy(); } };
})();
`}`.replace('__ONUN_PAGE_MOTION_HELPERS__', () => helpers);
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeInlineJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function relativeRuntimePath(htmlPath: string) {
  const depth = normalizePagePath(htmlPath).split('/').slice(0, -1).filter(Boolean).length;
  return `${'../'.repeat(depth)}${PAGE_TRANSITIONS_RUNTIME_PATH}`;
}

function dirname(path: string) {
  return normalizePagePath(path).split('/').slice(0, -1).join('/');
}

function publishedPagePath(project: HtmlProject, page: string, homeHtmlPath: string) {
  let path = normalizePagePath(page);
  const webRoot = dirname(homeHtmlPath);
  [webRoot, ...projectPublicDirectoryNames(project)].forEach(directory => {
    const normalized = normalizePagePath(directory);
    if (!normalized) return;
    if (path === normalized) path = '';
    else if (path.toLowerCase().startsWith(`${normalized.toLowerCase()}/`)) {
      path = path.slice(normalized.length + 1);
    }
  });
  return path;
}

function publishedPageRoute(project: HtmlProject, page: string, homeHtmlPath: string) {
  return publicRouteForProjectPage(
    publishedPagePath(project, page, homeHtmlPath),
    publishedPagePath(project, homeHtmlPath, homeHtmlPath),
  );
}

interface RuntimePageTransitionConfig {
  version: 1;
  currentRoute: string;
  universal: UniversalPageTransition;
  routes: Array<{ page: string; route: string }>;
  rules: Array<PageTransitionRule & { fromRoute: string; toRoute: string }>;
}

function replaceUniqueTaggedMarkup(html: string, pattern: RegExp, markup: string) {
  let found = false;
  const text = html.replace(pattern, () => {
    if (found) return '';
    found = true;
    return markup;
  });
  return { found, text };
}

function appendBeforeBodyClose(html: string, markup: string) {
  const closingPattern = /<\/body\s*>/gi;
  let bodyClose: RegExpExecArray | null = null;
  for (let match = closingPattern.exec(html); match; match = closingPattern.exec(html)) bodyClose = match;
  if (!bodyClose || bodyClose.index === undefined) return html;
  return `${html.slice(0, bodyClose.index)}\n${markup}\n${html.slice(bodyClose.index)}`;
}

export function injectPageTransitionsMarkup(
  html: string,
  htmlPath: string,
  config: RuntimePageTransitionConfig,
) {
  if (!/<body\b[^>]*>/i.test(html) || !/<\/body\s*>/i.test(html)) return html;
  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  if (!bodyOpen || bodyOpen.index === undefined) return html;
  const closingPattern = /<\/body\s*>/gi;
  let bodyClose: RegExpExecArray | null = null;
  for (let match = closingPattern.exec(html); match; match = closingPattern.exec(html)) bodyClose = match;
  if (!bodyClose || bodyClose.index <= bodyOpen.index + bodyOpen[0].length) return html;
  const configMarkup = `<script type="application/json" data-kodety-page-transitions-config>${escapeInlineJson(config)}</script>`;
  const runtimeMarkup = `<script defer data-kodety-page-transitions-runtime src="${escapeHtmlAttribute(relativeRuntimePath(htmlPath))}"></script>`;
  const style = `<style data-kodety-page-transitions-style>${PAGE_TRANSITIONS_STYLES}</style>`;

  let materialized = html;
  if (!/<body\b[^>]*\bdata-kodety-page-transition-container(?=\s|=|>)[^>]*>/i.test(materialized)) {
    materialized = materialized.replace(
      /<body\b[^>]*>/i,
      match => match.replace(/>$/, ' data-kodety-page-transition-container>'),
    );
  }

  const configResult = replaceUniqueTaggedMarkup(
    materialized,
    /<script\b[^>]*\bdata-kodety-page-transitions-config(?=\s|=|>)[^>]*>[\s\S]*?<\/script\s*>/gi,
    configMarkup,
  );
  materialized = configResult.text;
  const runtimeResult = replaceUniqueTaggedMarkup(
    materialized,
    /<script\b[^>]*\bdata-kodety-page-transitions-runtime(?=\s|=|>)[^>]*>[\s\S]*?<\/script\s*>/gi,
    runtimeMarkup,
  );
  materialized = runtimeResult.text;
  const missingBodyMarkup = [
    configResult.found ? '' : configMarkup,
    runtimeResult.found ? '' : runtimeMarkup,
  ].filter(Boolean).join('\n');
  if (missingBodyMarkup) materialized = appendBeforeBodyClose(materialized, missingBodyMarkup);

  const styleResult = replaceUniqueTaggedMarkup(
    materialized,
    /<style\b[^>]*\bdata-kodety-page-transitions-style(?=\s|=|>)[^>]*>[\s\S]*?<\/style\s*>/gi,
    style,
  );
  materialized = styleResult.text;
  if (!styleResult.found) {
    materialized = /<\/head\s*>/i.test(materialized)
      ? materialized.replace(/<\/head\s*>/i, `${style}</head>`)
      : `${style}${materialized}`;
  }
  return materialized;
}

export function preparePageTransitionsForTransport(
  project: HtmlProject,
  homeHtmlPath: string,
): HtmlProject {
  const document = readPageTransitionDocument(project);
  const htmlPaths = Object.keys(project.files)
    .filter(path => !path.startsWith('.incode/') && /\.html?$/i.test(path));
  const pages = new Set(htmlPaths);
  const rules = document.rules.filter(rule => (
    rule.enabled && pages.has(rule.from) && pages.has(rule.to)
  ));
  if (!document.universal.enabled && !rules.length) return project;
  const routes = htmlPaths.map(page => ({
    page,
    route: publishedPageRoute(project, page, homeHtmlPath),
  }));
  const routeByPage = new Map(routes.map(item => [item.page, item.route]));
  const runtimeRules = rules.map(rule => ({
    ...rule,
    fromRoute: routeByPage.get(rule.from) || '/',
    toRoute: routeByPage.get(rule.to) || '/',
  }));
  let files: Record<string, HtmlProjectFile> = {
    ...project.files,
    [PAGE_TRANSITIONS_RUNTIME_PATH]: {
      path: PAGE_TRANSITIONS_RUNTIME_PATH,
      mimeType: 'application/javascript',
      text: pageTransitionsRuntime(),
    },
  };
  htmlPaths.forEach(htmlPath => {
    const file = files[htmlPath];
    if (file.text === undefined) return;
    const config: RuntimePageTransitionConfig = {
      version: 1,
      currentRoute: routeByPage.get(htmlPath) || '/',
      universal: document.universal,
      routes,
      rules: runtimeRules,
    };
    const text = injectPageTransitionsMarkup(file.text, htmlPath, config);
    if (text !== file.text) files[htmlPath] = { ...file, text };
  });
  return { ...project, files };
}
