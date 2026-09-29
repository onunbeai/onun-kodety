/**
 * Client-Side CSS Generator using Tailwind Browser CDN
 *
 * Uses @tailwindcss/browser in a hidden iframe to generate CSS
 * This avoids all WASM bundling issues
 */

'use client';

import type { Component, Layer } from '@/types';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';
import { TAILWIND_CUSTOM_VARIANTS } from '@/lib/tailwind-custom-variants';

const MAX_GENERATOR_CLASSES = 20_000;
const MAX_GENERATOR_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_GENERATED_CSS_BYTES = 8 * 1024 * 1024;

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createMessageToken(): string {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(16).padStart(8, '0')).join('');
}

/**
 * Extract all classes from layers recursively
 * Includes classes from layer.classes, layer.textStyles, and DEFAULT_TEXT_STYLES
 * Tracks processed componentIds to avoid duplicate extraction
 */
function extractClassesFromLayers(layers: Layer[]): Set<string> {
  const classes = new Set<string>();
  const processedComponentIds = new Set<string>();

  // Helper to extract classes from a string or array
  const extractClasses = (classValue: string | string[] | undefined) => {
    if (!classValue) return;

    if (Array.isArray(classValue)) {
      classValue.forEach(cls => {
        if (cls && typeof cls === 'string') {
          cls.split(/\s+/).forEach(c => c.trim() && classes.add(c.trim()));
        }
      });
    } else if (typeof classValue === 'string') {
      classValue.split(/\s+/).forEach(cls => cls.trim() && classes.add(cls.trim()));
    }
  };

  function processLayer(layer: Layer): void {
    if (layer.settings?.hidden) return;

    // Skip if we've already processed this component
    if (layer.componentId) {
      if (processedComponentIds.has(layer.componentId)) return;
      processedComponentIds.add(layer.componentId);
    }

    // Extract layer classes
    extractClasses(layer.classes);

    // Extract text style classes (from layer.textStyles)
    if (layer.textStyles) {
      Object.values(layer.textStyles).forEach(style => {
        extractClasses(style.classes);
      });
    }

    // Extract default text style classes (if layer has text content)
    if (layer.variables?.text) {
      Object.values(DEFAULT_TEXT_STYLES).forEach(style => {
        extractClasses(style.classes);
      });
    }

    if (layer.children && Array.isArray(layer.children)) {
      layer.children.forEach(child => processLayer(child));
    }
  }

  layers.forEach(layer => processLayer(layer));
  return classes;
}

/**
 * Generate CSS using Tailwind Browser CDN in a hidden iframe
 */
export async function generateCSS(layers: Layer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const classes = extractClassesFromLayers(layers);
    const classesArray = Array.from(classes);

    if (classesArray.length === 0) {
      resolve('/* No classes to generate */');
      return;
    }

    const inputBytes = classesArray.reduce((total, className) => total + className.length, 0);
    if (classesArray.length > MAX_GENERATOR_CLASSES || inputBytes > MAX_GENERATOR_INPUT_BYTES) {
      reject(new Error('Too many utility classes to generate CSS safely'));
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.referrerPolicy = 'no-referrer';
    const messageToken = createMessageToken();
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      iframe.remove();
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      callback();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('CSS generation timeout')));
    }, 30000);

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.token !== messageToken) return;

      if (event.data.type === 'css-ready') {
        if (typeof event.data.css !== 'string' || event.data.css.length > MAX_GENERATED_CSS_BYTES) {
          finish(() => reject(new Error('Generated CSS exceeded the safe response limit')));
          return;
        }
        finish(() => resolve(event.data.css));
      } else if (event.data.type === 'css-error') {
        const detail = typeof event.data.error === 'string'
          ? event.data.error.slice(0, 500)
          : 'Unknown CSS generation error';
        finish(() => reject(new Error(detail)));
      }
    };
    window.addEventListener('message', handleMessage);

    const htmlContent = classesArray
      .map(className => `<div class="${escapeHtmlAttribute(className)}"></div>`)
      .join('\n');

    iframe.srcdoc = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
    ${TAILWIND_CUSTOM_VARIANTS}
  </style>
</head>
<body>
  ${htmlContent}
  <script>
    let retryCount = 0;
    const maxRetries = 100;

    function extractCSS() {
      try {
        retryCount++;
        const styleTags = Array.from(document.querySelectorAll('style'));

        const tailwindStyle = styleTags.find(style => {
          const css = style.textContent || '';
          return css.length > 100 && (
            css.includes('*,::after,::before') ||
            css.includes('tailwindcss') ||
            css.includes('--tw-')
          );
        });

        if (tailwindStyle && tailwindStyle.textContent) {
          window.parent.postMessage({
            type: 'css-ready',
            token: ${JSON.stringify(messageToken)},
            css: tailwindStyle.textContent
          }, '*');
        } else if (retryCount >= maxRetries) {
          window.parent.postMessage({
            type: 'css-error',
            token: ${JSON.stringify(messageToken)},
            error: 'CSS generation timeout'
          }, '*');
        } else {
          setTimeout(extractCSS, 100);
        }
      } catch (error) {
        window.parent.postMessage({
          type: 'css-error',
          token: ${JSON.stringify(messageToken)},
          error: error.message || 'Unknown error'
        }, '*');
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(extractCSS, 1000);
      });
    } else {
      setTimeout(extractCSS, 1000);
    }
  </script>
</body>
</html>
    `;
    document.body.appendChild(iframe);
  });
}

/**
 * Save CSS to settings via API and update the settings store
 */
export async function saveCSS(css: string, key: 'draft_css' | 'published_css'): Promise<void> {
  const response = await fetch(`/kodety/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: css }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save CSS: ${response.statusText}`);
  }

  // Update settings store to keep it in sync
  const { useSettingsStore } = await import('@/stores/useSettingsStore');
  useSettingsStore.getState().updateSetting(key, css);
}

/**
 * Collect all layers including component layers for CSS generation
 * Includes both saved components and component drafts (unsaved edits)
 */
async function collectAllLayers(pageLayers: Layer[]): Promise<Layer[]> {
  const { useComponentsStore } = await import('@/stores/useComponentsStore');
  const { components, componentDrafts } = useComponentsStore.getState();

  // `componentDrafts` is keyed by component id then variant id since the
  // variants refactor (`Record<componentId, Record<variantId, Layer[]>>`).
  // Track which components have any working draft at all.
  const draftComponentIds = new Set(Object.keys(componentDrafts));

  // Collect layers from all components (prefer drafts over saved versions)
  const componentLayers: Layer[] = [];

  // Add component drafts first (these are the latest edits). Walk every
  // variant so classes that only appear in non-primary variants make it into
  // the compiled stylesheet.
  Object.values(componentDrafts).forEach((variantMap) => {
    if (!variantMap || typeof variantMap !== 'object') return;
    Object.values(variantMap).forEach((variantLayers) => {
      if (Array.isArray(variantLayers)) {
        componentLayers.push(...variantLayers);
      }
    });
  });

  // Add saved components that don't have drafts. Same reason as above:
  // include every variant so e.g. `bg-[#35b7d4]` on Variant 3 is compiled.
  components.forEach((component: Component) => {
    if (draftComponentIds.has(component.id)) return;
    if (component.variants && component.variants.length > 0) {
      component.variants.forEach((variant) => {
        if (Array.isArray(variant.layers)) componentLayers.push(...variant.layers);
      });
    } else if (Array.isArray(component.layers)) {
      componentLayers.push(...component.layers);
    }
  });

  // Combine page layers and component layers
  return [...pageLayers, ...componentLayers];
}

/**
 * Generate CSS and save it to draft_css
 * Automatically includes component layers for comprehensive CSS generation
 */
export async function generateAndSaveCSS(layers: Layer[]): Promise<string> {
  // Collect all layers including component layers
  const allLayers = await collectAllLayers(layers);
  const css = await generateCSS(allLayers);
  await saveCSS(css, 'draft_css');
  return css;
}
