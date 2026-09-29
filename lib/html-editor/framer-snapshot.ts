export interface FramerHydratedSnapshot {
  version: 1;
  rootSelector: string;
  rootHtml: string;
  styles: Array<{ css: string; embeddedIndex?: number; sourcePath?: string; media?: string; disabled?: boolean; placement?: 'head' | 'body' | 'adopted' }>;
}

/** Wait for module evaluation and a quiet structural DOM, not an SSR first paint. */
export function waitForFramerHydration(document: Document, rootSelector: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let quietSince = started;
    const observer = new MutationObserver(() => { quietSince = Date.now(); });
    observer.observe(document.querySelector(rootSelector) || document.documentElement, { subtree: true, childList: true, characterData: true });
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - started >= 8000) {
        clearInterval(timer); observer.disconnect();
        reject(new Error('A hidratação Framer não estabilizou. Aguarde o conteúdo terminar de carregar e tente novamente.'));
      } else if (document.readyState === 'complete' && now - started >= 700 && now - quietSince >= 350) {
        clearInterval(timer); observer.disconnect(); resolve();
      }
    }, 50);
  });
}

/**
 * Runs inside the opaque Preview frame. Keep this function self-contained:
 * buildPreview serializes it into the existing generation-checked bridge.
 * Capture real DOM and CSSOM, never computed pixel layouts that flatten media
 * queries. Only the clone is touched; the running application is unchanged.
 */
export function captureFramerHydratedSnapshot(
  document: Document,
  rootSelector: string,
  aliases: Record<string, string>,
  baseFile: string,
  rewriteCss: typeof rewriteCssAssetUrls = rewriteCssAssetUrls,
  parseSrcset: typeof parseSrcsetCandidates = parseSrcsetCandidates,
): FramerHydratedSnapshot {
  const root = document.querySelector(rootSelector);
  if (!root || !root.children.length) throw new Error('O conteúdo Framer ainda não terminou de carregar.');
  if (root.querySelectorAll('*').length > 50_000) throw new Error('A página excede o limite de captura segura.');
  const relativePath = (path: string) => {
    const directory = baseFile.split('/').slice(0, -1);
    const target = path.split('/');
    while (directory.length && target.length && directory[0] === target[0]) {
      directory.shift();
      target.shift();
    }
    return [...directory.map(() => '..'), ...target].map(part => encodeURIComponent(part)).join('/');
  };
  const restoreUrl = (value: string): string => {
    if (aliases[value]) return relativePath(aliases[value]);
    const hashIndex = value.indexOf('#');
    const plain = hashIndex < 0 ? value : value.slice(0, hashIndex);
    const hash = hashIndex < 0 ? '' : value.slice(hashIndex);
    let path = aliases[plain];
    if (!path && plain.startsWith('data:,kodety-runtime-asset-')) {
      try { path = decodeURIComponent(plain.slice('data:,kodety-runtime-asset-'.length)); } catch { /* rejected below */ }
    }
    if (path) return relativePath(path) + hash;
    if (/^(?:blob:|data:,kodety-runtime-asset-)/.test(value)) throw new Error('Um asset temporário ainda não pode ser salvo. Aguarde o carregamento e tente novamente.');
    return value;
  };
  const restoreCss = (css: string) => rewriteCss(css, restoreUrl);
  const restoreAttribute = (name: string, value: string) => {
    if (name === 'style') return restoreCss(value);
    if (/^(?:srcset|imagesrcset|data-srcset)$/.test(name)) return parseSrcset(value)
      .map(candidate => `${restoreUrl(candidate.url)}${candidate.descriptor ? ` ${candidate.descriptor}` : ''}`).join(', ');
    if (name === 'data-video-urls') return value.split(',').map(url => restoreUrl(url.trim())).join(',');
    return restoreUrl(value);
  };
  const liveElements = [root, ...Array.from(root.querySelectorAll('*'))];
  const clone = root.cloneNode(true) as Element;
  const all = [clone, ...Array.from(clone.querySelectorAll('*'))];
  const restingFrames = new Map<Element, Record<string, unknown>>();
  document.getAnimations?.().forEach(animation => {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!target || !root.contains(target) || target.getAttribute('data-kodety-framer-motion') !== 'load'
      || target.closest('[hidden],[aria-hidden="true"]')) return;
    const timing = effect.getTiming();
    if (timing.iterations !== 1 || timing.direction !== 'normal') return;
    const final = effect.getKeyframes().at(-1);
    if (final) restingFrames.set(target, final);
  });
  all.forEach((element, index) => {
    const attributes = Array.from(element.attributes);
    const injected = attributes.some(attribute => /^data-html-editor-/.test(attribute.name)
      && !/^data-html-editor-(?:original-|frozen-script-type)/.test(attribute.name));
    if ((element.tagName === 'SCRIPT' || element.tagName === 'STYLE') && injected) {
      element.remove();
      return;
    }
    if (element.hasAttribute('data-html-editor-agent-activity-root')
      || /^__kodety-(?:direct-overlay|direct-size-label|overlay-link-badge|draw-overlay|draw-label|tool-hint)$/.test(element.id)) {
      element.remove();
      return;
    }
    // Runtime may replace media/navigation on an existing SSR node. Preserve
    // the current value; old markers are only a fallback for absent URLs or
    // the editor's executable-script projection into data/blob modules.
    attributes.forEach(attribute => {
      if (/^data-html-editor-original-(?:src|srcset|imagesrcset|href|poster|srcdoc|data-video-urls|data-src|data-srcset|data-lazy-src|data-original|data-poster|data-poster-url)$/.test(attribute.name)) {
        const name = attribute.name.slice('data-html-editor-original-'.length);
        const current = element.getAttribute(name);
        if (current === null || (element.tagName === 'SCRIPT' && name === 'src' && /^(?:data:|blob:)/i.test(current))) {
          element.setAttribute(name, attribute.value);
        }
      }
    });
    attributes.forEach(attribute => {
      if (/^(?:data-html-editor-|data-editor-)/.test(attribute.name)) element.removeAttribute(attribute.name);
    });
    Array.from(element.attributes).forEach(attribute => {
      if (/^(?:src|srcset|imagesrcset|href|poster|style|xlink:href|data-video-urls|data-src|data-srcset|data-lazy-src|data-original|data-poster|data-poster-url)$/.test(attribute.name)) {
        element.setAttribute(attribute.name, restoreAttribute(attribute.name, attribute.value));
      }
    });
    if (element.tagName === 'STYLE') {
      const live = liveElements[index] as HTMLStyleElement | undefined;
      const sheet = live?.sheet;
      element.textContent = restoreCss(sheet
        ? Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')
        : element.textContent || '').replace(/<\/style/gi, '<\\/style');
      if (sheet?.disabled) element.setAttribute('media', 'not all');
    }
    const live = liveElements[index];
    if (live.getAttribute('data-kodety-framer-motion') === 'load' && !live.closest('[hidden],[aria-hidden="true"]')) {
      const baseline = document.createElement('div');
      baseline.setAttribute('style', live.getAttribute('data-html-editor-original-style') || '');
      const targetStyle = (element as HTMLElement).style;
      if (targetStyle && Number(targetStyle.opacity) === 0 && Number(baseline.style.opacity) > 0) {
        ['opacity', 'transform', 'translate', 'scale', 'rotate', 'filter', 'visibility'].forEach(property => {
          const value = baseline.style.getPropertyValue(property);
          if (value) targetStyle.setProperty(property, value, baseline.style.getPropertyPriority(property));
        });
      }
      const final = restingFrames.get(live);
      if (targetStyle && final) Object.entries(final).forEach(([property, value]) => {
        if (!/^(?:opacity|transform|translate|scale|rotate|filter|clipPath|visibility)$/.test(property)
          || (typeof value !== 'string' && typeof value !== 'number')) return;
        targetStyle.setProperty(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), String(value));
      });
    }
    if (element.tagName === 'INPUT') {
      const input = live as HTMLInputElement;
      if (!['password', 'file'].includes(input.type)) element.setAttribute('value', input.value);
      if (['checkbox', 'radio'].includes(input.type)) element.toggleAttribute('checked', input.checked);
    } else if (element.tagName === 'TEXTAREA') {
      element.textContent = (live as HTMLTextAreaElement).value;
    } else if (element.tagName === 'OPTION') {
      element.toggleAttribute('selected', (live as HTMLOptionElement).selected);
    }
  });
  const styles: FramerHydratedSnapshot['styles'] = [];
  const rootStyles = new Set(Array.from(root.querySelectorAll('style')));
  Array.from(document.styleSheets).forEach(sheet => {
    const owner = sheet.ownerNode as HTMLStyleElement | null;
    if (!owner || owner.tagName !== 'STYLE' || rootStyles.has(owner)) return;
    const embedded = owner.getAttribute('data-editor-embedded-source');
    const sourcePath = owner.getAttribute('data-editor-source') || '';
    if (owner.hasAttribute('data-kodety-framer-visual-cleanup')) return;
    if (Array.from(owner.attributes).some(attribute => attribute.name.startsWith('data-html-editor-')
      || (embedded === null && !sourcePath && attribute.name.startsWith('data-kodety-') && !attribute.name.startsWith('data-kodety-framer-')))) return;
    let css = '';
    try { css = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'); } catch { return; }
    // Both insertRule and replacement of textContent are runtime mutations.
    // Preserve the entire current author-owned sheet at its source position;
    // comparing CSSOM against the already-mutated text would lose the latter.
    styles.push({ css: restoreCss(css), media: owner.media || '', disabled: sheet.disabled,
      placement: document.head.contains(owner) ? 'head' : 'body',
      ...(sourcePath ? { sourcePath } : {}),
      ...(embedded !== null && /^\d+$/.test(embedded) ? { embeddedIndex: Number(embedded) } : {}) });
  });
  Array.from(document.adoptedStyleSheets || []).forEach(sheet => {
    const css = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
    styles.push({ css: restoreCss(css), media: sheet.media.mediaText, disabled: sheet.disabled, placement: 'adopted' });
  });
  // The Preview asset bridge intercepts DOM setters even on detached clones;
  // normalize the final string as well so it cannot turn restored paths back
  // into its own data/blob URLs while the clone is being serialized.
  const decoder = document.createElement('textarea');
  const normalizeTag = (tag: string) => tag.replace(/(\s(src|srcset|imagesrcset|href|poster|style|xlink:href|data-video-urls|data-src|data-srcset|data-lazy-src|data-original|data-poster|data-poster-url)\s*=\s*)"([^"]*)"/gi,
    (_match, prefix: string, name: string, value: string) => {
      decoder.innerHTML = value;
      const normalized = restoreAttribute(name.toLowerCase(), decoder.value);
      return `${prefix}"${normalized.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
    });
  const rootHtml = clone.outerHTML.replace(/<!--[^]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[^]*?<\/script\s*>|<style\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[^]*?<\/style\s*>|<\/?[A-Za-z](?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
    token => {
      if (token.startsWith('<!--')) return token;
      if (/^<(?:script|style)\b/i.test(token)) {
        const opening = token.match(/^<(?:script|style)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i)![0];
        const closing = token.match(/<\/(?:script|style)\s*>$/i)![0];
        const content = token.slice(opening.length, -closing.length);
        return normalizeTag(opening) + (/^<style\b/i.test(token) ? restoreCss(content) : content) + closing;
      }
      return normalizeTag(token);
    });
  const snapshot: FramerHydratedSnapshot = { version: 1, rootSelector, rootHtml, styles };
  if (JSON.stringify(snapshot).length > 12 * 1024 * 1024) throw new Error('A página excede o limite de captura segura.');
  return snapshot;
}

export function requestFramerHydratedSnapshot(
  frame: Window,
  generation: string,
  revision: number,
  rootSelector: string,
  host: Window = window,
  timeoutMs = 12_000,
  assetAliases: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<FramerHydratedSnapshot> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('A conversão foi cancelada.')); return; }
    const requestId = host.crypto.randomUUID();
    const finish = (error?: Error, snapshot?: FramerHydratedSnapshot) => {
      host.clearTimeout(timer);
      host.removeEventListener('message', receive);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(snapshot!);
    };
    const abort = () => finish(new Error('A conversão foi cancelada.'));
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== frame || data?.type !== 'html-editor-framer-snapshot'
        || data.generation !== generation || data.requestId !== requestId) return;
      if (data.error) return finish(new Error(String(data.error).slice(0, 300)));
      const snapshot = data.snapshot;
      if (data.revision !== revision || snapshot?.version !== 1 || snapshot.rootSelector !== rootSelector
        || typeof snapshot.rootHtml !== 'string' || !Array.isArray(snapshot.styles)
        || snapshot.styles.length > 2000 || JSON.stringify(snapshot).length > 12 * 1024 * 1024) {
        return finish(new Error('O Preview mudou durante a captura. Aguarde e tente novamente.'));
      }
      finish(undefined, snapshot);
    };
    const timer = host.setTimeout(() => finish(new Error('O Preview ainda não está pronto para conversão. Aguarde e tente novamente.')), timeoutMs);
    host.addEventListener('message', receive);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      frame.postMessage({ type: 'html-editor-framer-snapshot-request', generation, revision, rootSelector, requestId, assetAliases }, '*');
    } catch (error) { finish(error instanceof Error ? error : new Error('Não foi possível acessar o Preview.')); }
  });
}
import { parseSrcsetCandidates, rewriteCssAssetUrls } from './asset-reference-syntax';
