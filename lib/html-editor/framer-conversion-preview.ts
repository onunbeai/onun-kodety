import { buildPreview } from './preview';
import { framerConversionRootSelector } from './framer-conversion';
import { requestFramerHydratedSnapshot, type FramerHydratedSnapshot } from './framer-snapshot';
import type { HtmlProject } from './types';

/**
 * Render another page without changing the editor's active page, revision or
 * write authority. Every temporary frame and listener is released on success,
 * timeout or cancellation; project bytes are copied before transfer.
 */
export async function captureFramerPagePreview(
  project: HtmlProject,
  path: string,
  options: { width: number; revision: number; signal?: AbortSignal; host?: Window },
): Promise<FramerHydratedSnapshot> {
  const host = options.host || window;
  options.signal?.throwIfAborted();
  const pageProject = { ...project, mainHtmlPath: path };
  const generation = `framer-conversion-${host.crypto.randomUUID()}`;
  const preview = buildPreview(pageProject, false, [], false, [], false, null, generation, options.revision);
  const iframe = host.document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText = `position:fixed;left:0;top:0;z-index:-1;width:${Math.max(320, Math.min(4000, options.width))}px;height:900px;opacity:0;pointer-events:none;border:0`;
  const sent = new Set<string>();
  const sendAssets = (requested: string[]) => {
    const assets: Array<{ path: string; mimeType: string; bytes: ArrayBuffer }> = [];
    for (const assetPath of requested.slice(0, 1000)) {
      const file = project.files[assetPath];
      if (!file || sent.has(assetPath)) continue;
      const bytes = new Uint8Array(file.data || new TextEncoder().encode(file.text || '')).buffer;
      assets.push({ path: assetPath, mimeType: file.mimeType, bytes });
      sent.add(assetPath);
    }
    if (assets.length) iframe.contentWindow?.postMessage({ type: 'html-editor-runtime-assets', generation, assets, aliases: {} }, '*', assets.map(asset => asset.bytes));
  };
  let timer = 0;
  let receive: ((event: MessageEvent) => void) | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      receive = event => {
        if (event.source !== iframe.contentWindow || event.data?.generation !== generation) return;
        const data = event.data;
        if (data.type === 'html-editor-runtime-assets-ready') {
          sendAssets(preview.runtimeAssetPaths);
          // The snapshot request itself waits for module load and a settled
          // DOM. A hidden frame need not be promoted/painted as editor canvas.
          resolve();
        }
        if (data.type === 'html-editor-runtime-assets-request' && Array.isArray(data.paths)) sendAssets(data.paths.filter((value: unknown): value is string => typeof value === 'string'));
        if (data.type === 'html-editor-runtime-asset-request' && typeof data.path === 'string') sendAssets([data.path]);
        if (data.type === 'html-editor-canvas-ready') resolve();
      };
      abort = () => reject(new Error('A conversão foi cancelada. Nenhum rascunho foi alterado.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      timer = host.setTimeout(() => reject(new Error(`A página ${path} não terminou de carregar para conversão.`)), 15_000);
      host.addEventListener('message', receive);
      iframe.srcdoc = preview.html;
      host.document.body.appendChild(iframe);
    });
    host.clearTimeout(timer);
    options.signal?.throwIfAborted();
    const snapshot = await requestFramerHydratedSnapshot(iframe.contentWindow!, generation, options.revision,
      framerConversionRootSelector(project.files[path]?.text || ''), host, 12_000, preview.captureAssetAliases, options.signal);
    options.signal?.throwIfAborted();
    return snapshot;
  } finally {
    host.clearTimeout(timer);
    if (receive) host.removeEventListener('message', receive);
    if (abort) options.signal?.removeEventListener('abort', abort);
    iframe.remove();
    preview.objectUrls.forEach(url => URL.revokeObjectURL(url));
  }
}
