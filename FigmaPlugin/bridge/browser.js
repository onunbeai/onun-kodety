import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

import { createNetworkPolicy, fetchWithNetworkPolicy } from './network-policy.js';
import { startPinnedProxy } from './pinned-proxy.js';

const BRIDGE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DOM_TO_SPEC_PATH = path.join(BRIDGE_DIRECTORY, 'dom-to-spec.js');

const CAPTURE_LIMITS = Object.freeze({
  navigationMs: 45_000,
  settleMs: 700,
  imageFetchMs: 12_000,
  maxDepth: 40,
  maxNodes: 30_000,
  maxImages: 96,
  maxImageBytes: 8 * 1024 * 1024,
  maxTotalImageBytes: 48 * 1024 * 1024,
  maxSvgCharacters: 2 * 1024 * 1024,
  maxTextCharacters: 1024 * 1024,
  maxJsonBytes: 70 * 1024 * 1024,
});

const SOURCE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

const FIGMA_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);

function addWarning(warnings, message) {
  if (warnings.length < 100 && !warnings.includes(message)) warnings.push(message);
}

function abortError() {
  const error = new Error('Import cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function wait(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    function finish() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }),
  ]);
}

function executableCandidates() {
  const candidates = [];
  if (process.env.KODETY_CHROME_PATH) candidates.push(process.env.KODETY_CHROME_PATH);

  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(
        path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(base, 'Chromium', 'Application', 'chrome.exe'),
        path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      );
    }
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }
  return candidates;
}

export function findChromeExecutable() {
  for (const candidate of executableCandidates()) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue through the small, fixed candidate list.
    }
  }
  throw new Error('Chrome or Chromium was not found. Set KODETY_CHROME_PATH to its executable.');
}

function inspectSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('The rendered page did not produce a scene.');
  }
  let nodeCount = 0;
  const stack = [{ node: spec, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    const { node, depth } = current;
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('The rendered scene contains an invalid node.');
    }
    nodeCount += 1;
    if (nodeCount > CAPTURE_LIMITS.maxNodes) throw new Error('The rendered page has too many layers.');
    if (depth > CAPTURE_LIMITS.maxDepth) throw new Error('The rendered page is nested too deeply.');
    if (typeof node._svg === 'string' && node._svg.length > CAPTURE_LIMITS.maxSvgCharacters) {
      delete node._svg;
    }
    if (typeof node.characters === 'string' && node.characters.length > CAPTURE_LIMITS.maxTextCharacters) {
      node.characters = node.characters.slice(0, CAPTURE_LIMITS.maxTextCharacters);
    }
    if (node.children !== undefined && !Array.isArray(node.children)) {
      throw new Error('The rendered scene contains an invalid child list.');
    }
    for (const child of node.children || []) stack.push({ node: child, depth: depth + 1 });
  }
  return nodeCount;
}

function nodesInScene(spec) {
  const nodes = [];
  const stack = [spec];
  while (stack.length) {
    const node = stack.pop();
    nodes.push(node);
    for (const child of node.children || []) stack.push(child);
  }
  return nodes;
}

function mimeFromBytes(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a')) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 16 && bytes.subarray(4, 8).toString() === 'ftyp') {
    const declaredBoxSize = bytes.readUInt32BE(0);
    const boxEnd = Math.min(bytes.length, declaredBoxSize >= 16 ? declaredBoxSize : 32, 256);
    for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
      if (['avif', 'avis'].includes(bytes.subarray(offset, offset + 4).toString())) return 'image/avif';
    }
  }
  return null;
}

export function detectImageMime(bytes, headerMime = '') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const detected = mimeFromBytes(buffer);
  if (detected) return detected;
  const normalizedHeader = String(headerMime).split(';', 1)[0].trim().toLowerCase();
  return SOURCE_IMAGE_MIME_TYPES.has(normalizedHeader) ? normalizedHeader : null;
}

export function inspectImageDataUrl(value, allowedMimeTypes = SOURCE_IMAGE_MIME_TYPES) {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  const declaredMime = match[1].toLowerCase();
  const compact = match[2].replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(compact)) return null;
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor(compact.length * 0.75) - padding;
  const magicBytes = Buffer.from(compact.slice(0, 512), 'base64');
  const magicMime = mimeFromBytes(magicBytes);
  const mime = magicMime || declaredMime;
  if (!allowedMimeTypes.has(mime)) return null;
  return Object.freeze({
    mime,
    declaredMime,
    magicMime,
    bytes: byteLength,
    dataUrl: `data:${mime};base64,${compact}`,
  });
}

function reserveDataUrl(dataUrl, quota) {
  const measured = inspectImageDataUrl(dataUrl, FIGMA_IMAGE_MIME_TYPES);
  if (!measured?.magicMime) return false;
  if (quota.count >= CAPTURE_LIMITS.maxImages) return false;
  if (measured.bytes > CAPTURE_LIMITS.maxImageBytes) return false;
  if (quota.bytes + measured.bytes > CAPTURE_LIMITS.maxTotalImageBytes) return false;
  quota.count += 1;
  quota.bytes += measured.bytes;
  return true;
}

async function normalizeImageDataUrl(page, source) {
  const measured = inspectImageDataUrl(source, SOURCE_IMAGE_MIME_TYPES);
  if (!measured || measured.bytes > 32 * 1024 * 1024) return null;
  return page.evaluate(async ({ dataUrl, sourceMime, acceptedMimeTypes, maximumDimension, preserveOriginal }) => {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Image decode timed out.')), 10_000);
      image.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Image decode failed.'));
      };
      image.src = dataUrl;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return null;
    if (
      preserveOriginal
      && acceptedMimeTypes.includes(sourceMime)
      && width <= maximumDimension
      && height <= maximumDimension
    ) {
      return dataUrl;
    }
    const scale = Math.min(1, maximumDimension / width, maximumDimension / height);
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    let result = canvas.toDataURL('image/png');
    if (result.length > 11_000_000) result = canvas.toDataURL('image/jpeg', 0.9);
    canvas.width = 1;
    canvas.height = 1;
    return result;
  }, {
    dataUrl: measured.dataUrl,
    sourceMime: measured.mime,
    acceptedMimeTypes: [...FIGMA_IMAGE_MIME_TYPES],
    maximumDimension: 4096,
    preserveOriginal: Boolean(
      measured.magicMime
      && FIGMA_IMAGE_MIME_TYPES.has(measured.mime)
      && measured.bytes <= CAPTURE_LIMITS.maxImageBytes
    ),
  }).catch(() => null);
}

async function readResponseBytes(response, limit) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error('Image exceeds the per-file limit.');
  }
  if (!response.body) throw new Error('Image response has no body.');
  const chunks = [];
  let total = 0;
  if (typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error('Image exceeds the per-file limit.');
      }
      chunks.push(Buffer.from(result.value));
    }
  } else {
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > limit) {
        response.body.destroy?.();
        throw new Error('Image exceeds the per-file limit.');
      }
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks, total);
}

async function fetchImage(source, parentSignal, networkPolicy) {
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPTURE_LIMITS.imageFetchMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  try {
    const response = await fetchWithNetworkPolicy(parsed.href, {
      policy: networkPolicy,
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Kodety-Figma-URL-Bridge/1.0',
      },
    });
    if (!response.ok) return null;
    const bytes = await readResponseBytes(response, CAPTURE_LIMITS.maxImageBytes);
    const headerMime = response.headers.get('content-type') || '';
    const mime = detectImageMime(bytes, headerMime);
    if (!mime) return null;
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch (error) {
    if (parentSignal?.aborted) throw abortError();
    if (error?.name === 'AbortError') return null;
    return null;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function normalizeEmbeddedImages(page, spec, quota, warnings) {
  for (const node of nodesInScene(spec)) {
    if (typeof node._imageBytes !== 'string') continue;
    const normalized = await normalizeImageDataUrl(page, node._imageBytes);
    if (normalized && reserveDataUrl(normalized, quota)) node._imageBytes = normalized;
    else {
      delete node._imageBytes;
      addWarning(warnings, 'An embedded image was skipped because it could not be normalized for Figma.');
    }
  }
}

async function embedRemoteImages(page, spec, quota, signal, warnings, networkPolicy) {
  const candidates = nodesInScene(spec).filter(node => typeof node._bgUrl === 'string');
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      throwIfAborted(signal);
      const node = candidates[cursor];
      cursor += 1;
      if (node._imageBytes) {
        delete node._bgUrl;
        continue;
      }
      if (quota.count >= CAPTURE_LIMITS.maxImages || quota.bytes >= CAPTURE_LIMITS.maxTotalImageBytes) {
        delete node._bgUrl;
        continue;
      }
      const dataUrl = node._bgUrl.startsWith('data:')
        ? node._bgUrl
        : await fetchImage(node._bgUrl, signal, networkPolicy);
      const normalized = dataUrl ? await normalizeImageDataUrl(page, dataUrl) : null;
      if (normalized && reserveDataUrl(normalized, quota)) node._imageBytes = normalized;
      else if (dataUrl) addWarning(warnings, 'An image was skipped because it could not be normalized for Figma.');
      delete node._bgUrl;
    }
  });
  await Promise.all(workers);
}

async function embedIframeScreenshots(page, spec, quota, warnings) {
  const iframes = await page.$$('iframe');
  for (const node of nodesInScene(spec)) {
    if (!Number.isInteger(node._iframeIdx) || node._iframeIdx < 0 || !iframes[node._iframeIdx]) continue;
    try {
      const base64 = await iframes[node._iframeIdx].screenshot({ type: 'png', encoding: 'base64' });
      const dataUrl = await normalizeImageDataUrl(page, `data:image/png;base64,${base64}`);
      if (dataUrl && reserveDataUrl(dataUrl, quota)) node._imageBytes = dataUrl;
      else addWarning(warnings, 'An embedded frame snapshot exceeded the import media quota.');
    } catch {
      addWarning(warnings, 'A protected embedded frame could not be captured.');
    }
    delete node._iframeIdx;
  }
  await Promise.all(iframes.map(handle => handle.dispose().catch(() => undefined)));
}

async function addHybridSnapshot(page, spec, rootSelector, quota, warnings) {
  let base64;
  try {
    if (rootSelector === 'body' || rootSelector === 'html') {
      base64 = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 82, encoding: 'base64' });
    } else {
      const root = await page.$(rootSelector);
      if (!root) throw new Error('Root element disappeared before capture.');
      try {
        base64 = await root.screenshot({ type: 'jpeg', quality: 82, encoding: 'base64' });
      } finally {
        await root.dispose();
      }
    }
    const dataUrl = await normalizeImageDataUrl(page, `data:image/jpeg;base64,${base64}`);
    if (dataUrl && reserveDataUrl(dataUrl, quota)) {
      spec._imageBytes = dataUrl;
      spec.bgScaleMode = 'FILL';
      spec._hasReferenceSnapshot = true;
    } else {
      addWarning(warnings, 'The reference snapshot exceeded the import media quota.');
    }
  } catch {
    addWarning(warnings, 'The reference snapshot could not be captured.');
  }
}

async function primeLazyContent(page) {
  await page.evaluate(async () => {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const maximum = Math.min(scrollingElement.scrollHeight, 30_000);
    const step = Math.max(500, Math.round(window.innerHeight * 0.8));
    for (let position = 0; position < maximum; position += step) {
      window.scrollTo(0, position);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  });
}

export async function captureUrl(options, { signal, executablePath } = {}) {
  throwIfAborted(signal);
  const warnings = [];
  const quota = { count: 0, bytes: 0 };
  const networkPolicy = await createNetworkPolicy(options.url);
  let captureProxy;
  let browser;
  let context;
  let page;

  const closeOnAbort = () => {
    void page?.close().catch(() => undefined);
    void context?.close().catch(() => undefined);
    void browser?.close().catch(() => undefined);
    void captureProxy?.close().catch(() => undefined);
  };
  signal?.addEventListener('abort', closeOnAbort, { once: true });

  try {
    captureProxy = await startPinnedProxy(networkPolicy);
    throwIfAborted(signal);
    const browserEnvironment = { ...process.env };
    delete browserEnvironment.KODETY_BRIDGE_TOKEN;
    browser = await withAbort(puppeteer.launch({
      executablePath: executablePath || findChromeExecutable(),
      headless: true,
      pipe: true,
      env: browserEnvironment,
      ignoreDefaultArgs: ['--disable-popup-blocking'],
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-quic',
        '--disable-sync',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--metrics-recording-only',
        '--no-first-run',
        `--proxy-server=${captureProxy.url}`,
        '--proxy-bypass-list=<-loopback>',
      ],
    }), signal);
    context = typeof browser.createBrowserContext === 'function'
      ? await browser.createBrowserContext()
      : await browser.createIncognitoBrowserContext();
    page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
      class BlockedNetworkTransport {
        constructor() {
          throw new DOMException('Direct browser transports are disabled during design capture.', 'SecurityError');
        }
      }
      for (const property of ['WebSocket', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection']) {
        try {
          Object.defineProperty(globalThis, property, {
            configurable: false,
            enumerable: false,
            writable: false,
            value: BlockedNetworkTransport,
          });
        } catch {
          // The property may not exist or may already be locked by the browser.
        }
      }
    });
    await page.setBypassServiceWorker(true);
    await page.setCacheEnabled(false);
    await page.setViewport({ width: options.width, height: 900, deviceScaleFactor: 1 });
    await page.emulateMediaType('screen');
    if (options.colorScheme) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: options.colorScheme }]);
    }
    page.setDefaultNavigationTimeout(CAPTURE_LIMITS.navigationMs);
    page.on('dialog', dialog => void dialog.dismiss().catch(() => undefined));
    await page.setRequestInterception(true);
    page.on('request', request => {
      void (async () => {
        const requestUrl = request.url();
        let protocol;
        try {
          protocol = new URL(requestUrl).protocol;
        } catch {
          protocol = '';
        }
        if (protocol === 'data:' || protocol === 'blob:' || protocol === 'about:') {
          await request.continue();
          return;
        }
        try {
          await networkPolicy.assertAllowedUrl(requestUrl, { allowWebSocket: true });
          await request.continue();
        } catch {
          addWarning(warnings, 'A request to a private, reserved, or unsupported network address was blocked.');
          await request.abort('blockedbyclient');
        }
      })().catch(() => undefined);
    });

    const response = await withAbort(page.goto(options.url, {
      waitUntil: 'domcontentloaded',
      timeout: CAPTURE_LIMITS.navigationMs,
    }), signal);
    if (!response) throw new Error('The page did not return a navigation response.');
    const finalUrl = new URL(page.url());
    if (finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') {
      throw new Error('The page redirected to an unsupported URL scheme.');
    }
    if (!response.ok() && response.status() >= 400) {
      throw new Error(`The page returned HTTP ${response.status()}.`);
    }

    try {
      await withAbort(page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 }), signal);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      addWarning(warnings, 'The page kept network connections open; capture continued after the settle window.');
    }
    await withAbort(primeLazyContent(page), signal);
    await wait(CAPTURE_LIMITS.settleMs, signal);
    // Preserve the website's own CSP while it loads. Bypass it only for the
    // local, fixed extractor script after navigation and settling are done.
    await page.setBypassCSP(true);
    try {
      await page.addScriptTag({ path: DOM_TO_SPEC_PATH });
    } finally {
      await page.setBypassCSP(false);
    }

    const spec = await withAbort(page.evaluate(importOptions => window.domToSpec(importOptions), {
      rootSelector: options.rootSelector,
      maxDepth: 30,
      viewport: options.width,
      name: options.frameName || undefined,
      embedImages: false,
    }), signal);
    const nodeCount = inspectSpec(spec);

    await normalizeEmbeddedImages(page, spec, quota, warnings);
    await embedRemoteImages(page, spec, quota, signal, warnings, networkPolicy);
    await embedIframeScreenshots(page, spec, quota, warnings);
    if (options.hybridSnapshot) {
      await addHybridSnapshot(page, spec, options.rootSelector, quota, warnings);
    }

    spec._sourceUrl = options.url;
    spec._captureViewport = options.width;
    if (warnings.length) spec._importWarnings = warnings.slice(0, 50);

    const jsonBytes = Buffer.byteLength(JSON.stringify(spec));
    if (jsonBytes > CAPTURE_LIMITS.maxJsonBytes) {
      throw new Error('The rendered scene is too large to transfer safely.');
    }

    return {
      spec,
      meta: {
        finalUrl: page.url(),
        nodeCount,
        imageCount: quota.count,
        imageBytes: quota.bytes,
        warnings,
      },
    };
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await captureProxy?.close().catch(() => undefined);
  }
}

export { CAPTURE_LIMITS };
