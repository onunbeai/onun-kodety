import type { Font } from "@/types";
import {
  buildAdobeFontStylesheetUrl,
  buildFontClassesCss,
  buildGoogleFontUrl,
  fontsReferencedBySources,
  getFontStylesheetResources,
} from "../font-utils";

export interface CanvasFontResource {
  provider: "google" | "adobe";
  family: string;
  href: string;
  classesCss: string;
  version?: string;
}

/** Font availability travels with live CSS; it must not require a new srcdoc. */
export function canvasFontResources(
  fonts: Font[],
  sources: string[],
): CanvasFontResource[] {
  const referencedFonts = fontsReferencedBySources(fonts, sources);
  return getFontStylesheetResources(referencedFonts).map((resource) => {
    const resourceFonts = resource.provider === "google"
      ? referencedFonts.filter((font) => (
          font.type === "google" && buildGoogleFontUrl(font) === resource.href
        ))
      : referencedFonts.filter((font) => (
          font.type === "adobe" && buildAdobeFontStylesheetUrl(font) === resource.href
        ));
    return {
      provider: resource.provider,
      family: resource.family,
      href: resource.href,
      classesCss: buildFontClassesCss(resourceFonts),
      ...(resource.version ? { version: resource.version } : {}),
    };
  });
}

export function withCanvasFontResources<T extends Record<string, unknown>>(
  message: T,
  fonts: Font[],
  sourceFallbacks: string[] = [],
): T & { fontResources?: CanvasFontResource[] } {
  if (
    ![
      "html-editor-view-state",
      "html-editor-live-style",
      "html-editor-live-structure",
      "html-editor-inline-range-style",
    ].includes(String(message.type))
  )
    return message;
  const state = (message.state || message) as Record<string, unknown>;
  const sources = [
    state.cssText,
    state.designTokenCssText,
    state.html,
    state.markup,
    state.value,
  ];
  for (const key of ["stylesheets", "patches", "attributes", "items"]) {
    const entries = state[key];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      sources.push(entry.cssText, entry.value, entry.markup, entry.html);
    });
  }
  const resources = canvasFontResources(fonts, [
    ...sources.filter((source): source is string => typeof source === "string"),
    ...sourceFallbacks,
  ]);
  return resources.length ? { ...message, fontResources: resources } : message;
}

/** Runs inside the opaque canvas, where parent font styles are not inherited. */
export const CANVAS_FONTS_RUNTIME = String.raw`
    const liveFontClasses = new Map();
    const applyCanvasFontResources = resources => {
      if (!Array.isArray(resources)) return;
      let classesChanged = false;
      resources.forEach(resource => {
        if (!resource || typeof resource.family !== 'string' || typeof resource.href !== 'string') return;
        let url;
        try { url = new URL(resource.href); } catch { return; }
        const provider = resource.provider === 'adobe' ? 'adobe' : 'google';
        const googleAllowed = provider === 'google'
          && url.protocol === 'https:'
          && url.hostname === 'fonts.googleapis.com'
          && /^\/css2?$/.test(url.pathname);
        const adobeAllowed = provider === 'adobe'
          && url.protocol === 'https:'
          && url.hostname === 'use.typekit.net'
          && /^\/[a-z0-9]{1,64}\.css$/.test(url.pathname)
          && Array.from(url.searchParams.keys()).every(key => key === 'v');
        if ((!googleAllowed && !adobeAllowed) || url.username || url.password || url.port || url.hash) return;
        if (typeof resource.classesCss === 'string' && liveFontClasses.get(resource.family) !== resource.classesCss) {
          liveFontClasses.set(resource.family, resource.classesCss);
          classesChanged = true;
        }
        let link = Array.from(document.querySelectorAll('link[data-html-editor-font-stylesheet][href], link[data-html-editor-google-font][href]'))
          .find(candidate => candidate.href === url.href);
        if (link?.getAttribute('data-html-editor-font-state') === 'error'
          || link?.getAttribute('data-html-editor-google-font-state') === 'error') {
          link.remove();
          link = null;
        }
        if (!link && provider === 'adobe') {
          Array.from(document.querySelectorAll('link[data-html-editor-font-provider="adobe"][href]'))
            .filter(candidate => {
              try { return new URL(candidate.href).pathname === url.pathname; } catch { return false; }
            })
            .forEach(candidate => candidate.remove());
        }
        const created = !link;
        if (!link) {
          link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = url.href;
          link.setAttribute('data-html-editor-font-stylesheet', '');
          link.setAttribute('data-html-editor-font-provider', provider);
          link.setAttribute('data-html-editor-font-state', 'pending');
          if (provider === 'google') {
            link.setAttribute('data-html-editor-google-font', '');
            link.setAttribute('data-html-editor-google-font-state', 'pending');
          }
        }
        if (!link.hasAttribute('data-html-editor-live-font-listening')) {
          link.setAttribute('data-html-editor-live-font-listening', '');
          const refresh = () => {
            if (!document.documentElement?.isConnected) return;
            document.documentElement.getBoundingClientRect();
            scheduleLiveStylePaintRefresh();
            refreshDirectControls();
            scheduleCanvasVisibilitySnapshot();
          };
          const loaded = () => {
            link.setAttribute('data-html-editor-font-state', 'loaded');
            if (provider === 'google') link.setAttribute('data-html-editor-google-font-state', 'loaded');
            // Flush CSS before observing fonts.ready, so it includes faces
            // requested by the current selection, including form controls.
            document.documentElement?.getBoundingClientRect();
            Promise.resolve(document.fonts?.ready).then(refresh, refresh);
          };
          link.addEventListener('load', loaded, { once: true });
          link.addEventListener('error', () => {
            link.setAttribute('data-html-editor-font-state', 'error');
            if (provider === 'google') link.setAttribute('data-html-editor-google-font-state', 'error');
            refresh();
          }, { once: true });
          if (link.sheet || link.getAttribute('data-html-editor-font-state') === 'loaded'
            || link.getAttribute('data-html-editor-google-font-state') === 'loaded') loaded();
        }
        // Live selection must not reuse srcdoc's print-only deferral or wait
        // for another canvas-ready signal to activate its font stylesheet.
        link.media = 'all';
        link.removeAttribute('data-html-editor-deferred-google-font');
        link.removeAttribute('data-html-editor-deferred-font');
        if (created) document.head.appendChild(link);
      });
      if (classesChanged) {
        let style = document.querySelector('style[data-html-editor-live-font-classes]');
        if (!style) {
          style = document.createElement('style');
          style.setAttribute('data-html-editor-live-font-classes', '');
          document.head.appendChild(style);
        }
        style.textContent = Array.from(liveFontClasses.values()).join('\n');
      }
    };
`;
