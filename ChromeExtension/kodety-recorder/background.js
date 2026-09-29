const sessionKey = tabId => `recording:${tabId}`;
const lastStatus = new Map();
const i18nMessage = key => chrome.i18n.getMessage(key) || key;
const encoder = new TextEncoder();
const MAX_CAPTURE_TEXT_CHARS = 12_000_000;
const MAX_CAPTURE_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_OFFSCREEN_MESSAGE_BYTES = 48 * 1024 * 1024;
const MAX_MHTML_BYTES = 4 * 1024 * 1024;
const PAGE_CAPTURE_TIMEOUT_MS = 8_000;
const DOWNLOAD_START_TIMEOUT_MS = 15_000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function jsonByteLength(value) {
  try { return encoder.encode(JSON.stringify(value)).byteLength; } catch { return Infinity; }
}

function fitsOffscreenMessageBudget(message, maxBytes = MAX_OFFSCREEN_MESSAGE_BYTES) {
  return jsonByteLength(message) <= maxBytes;
}

function isStatus(value) {
  return isRecord(value) && ['idle', 'recording', 'stopped'].includes(value.state) &&
    ['webflow', 'framer', 'code'].includes(value.platform) &&
    ['events', 'animations', 'mutations'].every(key => Number.isInteger(value[key]) && value[key] >= 0);
}

function isValidCapture(value, includeDownloads = false) {
  if (!isRecord(value)) return false;
  for (const field of ['html', 'css', 'responsiveCss', 'runtime']) {
    if (typeof value[field] !== 'string' || value[field].length > MAX_CAPTURE_TEXT_CHARS) return false;
  }
  if (!isRecord(value.manifest) || !isRecord(value.manifest.page) || !isRecord(value.framerManifest)) return false;
  const page = value.manifest.page;
  if (!isHttpUrl(page.url) || typeof page.hostname !== 'string' || page.hostname.length > 255 ||
      !['webflow', 'framer', 'code'].includes(page.platform)) return false;
  try { if (new URL(page.url).hostname !== page.hostname) return false; } catch { return false; }
  if (!Array.isArray(value.stylesheetUrls) || value.stylesheetUrls.length > 80 || value.stylesheetUrls.some(url => !isHttpUrl(url))) return false;
  if (includeDownloads && (value.externalCss !== '' || value.originalHtml !== '')) return false;
  return jsonByteLength(value) <= MAX_CAPTURE_PAYLOAD_BYTES;
}

function sameOrigin(first, second) {
  try { return new URL(first).origin === new URL(second).origin; } catch { return false; }
}

function buildOffscreenMessage(payload, mhtmlBytes, maxBytes = MAX_OFFSCREEN_MESSAGE_BYTES) {
  let mhtml = mhtmlBytes instanceof Uint8Array && mhtmlBytes.byteLength <= MAX_MHTML_BYTES ? Array.from(mhtmlBytes) : null;
  let message = { type: 'KODETY_OFFSCREEN_BUILD_ZIP', payload, mhtml };
  if (mhtml && !fitsOffscreenMessageBudget(message, maxBytes)) {
    mhtml = null;
    message = { type: 'KODETY_OFFSCREEN_BUILD_ZIP', payload, mhtml };
  }
  if (!fitsOffscreenMessageBudget(message, maxBytes)) throw new Error(i18nMessage('invalidCapturePayload'));
  return message;
}

async function tabCommand(tabId, type, payload) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, { type, payload });
  } catch {
    throw new Error(i18nMessage('reloadPage'));
  }
  if (typeof response?.error === 'string') throw new Error(response.error.slice(0, 500));
  return response;
}

async function recordingEnabled(tabId) {
  const stored = await chrome.storage.session.get(sessionKey(tabId));
  return stored[sessionKey(tabId)] === true;
}

async function setRecording(tabId, enabled) {
  if (enabled) await chrome.storage.session.set({ [sessionKey(tabId)]: true });
  else await chrome.storage.session.remove(sessionKey(tabId));
}

function saveAsMhtml(tabId) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, PAGE_CAPTURE_TIMEOUT_MS);
    chrome.pageCapture.saveAsMHTML({ tabId }, blob => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(chrome.runtime.lastError ? null : blob || null);
    });
  });
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(i18nMessage('downloadStartTimeout')));
    }, DOWNLOAD_START_TIMEOUT_MS);
    chrome.downloads.download(options, downloadId => {
      const error = chrome.runtime.lastError?.message;
      if (settled) {
        if (Number.isInteger(downloadId)) chrome.downloads.cancel(downloadId).catch(() => {});
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else if (!Number.isInteger(downloadId)) reject(new Error(i18nMessage('operationFailed')));
      else resolve(downloadId);
    });
  });
}

async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
  const contexts = await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts?.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: i18nMessage('offscreenJustification'),
  });
}

async function exportCapture(tabId) {
  const recording = await tabCommand(tabId, 'KODETY_CONTENT_EXPORT');
  if (!isValidCapture(recording)) throw new Error(i18nMessage('invalidCapturePayload'));
  const tab = await chrome.tabs.get(tabId);
  if (!sameOrigin(tab?.url, recording.manifest.page.url)) throw new Error(i18nMessage('invalidCaptureOrigin'));
  const mhtml = await saveAsMhtml(tabId);
  const mhtmlBytes = mhtml && mhtml.size <= MAX_MHTML_BYTES ? new Uint8Array(await mhtml.arrayBuffer()) : null;
  recording.externalCss = '';
  recording.originalHtml = '';
  if (!isValidCapture(recording, true)) throw new Error(i18nMessage('invalidCapturePayload'));
  await ensureOffscreen();
  const compiled = await chrome.runtime.sendMessage(buildOffscreenMessage(recording, mhtmlBytes));
  if (!compiled?.ok || !compiled.url) throw new Error(compiled?.message || i18nMessage('compileZipFailed'));
  const downloadId = await downloadFile({ url: compiled.url, filename: compiled.filename, saveAs: true });
  return { ok: true, downloadId };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRecord(message) || sender?.id !== chrome.runtime.id || message.type === 'KODETY_OFFSCREEN_BUILD_ZIP') return false;
  const contentMessages = new Set(['KODETY_BACKGROUND_CONTENT_READY', 'KODETY_BACKGROUND_PAGE_STATUS']);
  const popupMessages = new Set([
    'KODETY_BACKGROUND_START', 'KODETY_BACKGROUND_STOP', 'KODETY_BACKGROUND_CLEAR',
    'KODETY_BACKGROUND_STATUS', 'KODETY_BACKGROUND_EXPORT',
  ]);
  const fromContent = contentMessages.has(message.type) && Number.isInteger(sender.tab?.id);
  const fromPopup = popupMessages.has(message.type) && sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  if (!fromContent && !fromPopup) return false;
  (async () => {
    const tabId = fromContent ? sender.tab.id : Number(message.tabId || 0);
    if (message.type === 'KODETY_BACKGROUND_CONTENT_READY') return { recording: tabId ? await recordingEnabled(tabId) : false };
    if (message.type === 'KODETY_BACKGROUND_PAGE_STATUS') {
      if (!isStatus(message.status)) throw new Error(i18nMessage('invalidCapturePayload'));
      if (tabId) lastStatus.set(tabId, message.status);
      return { ok: true };
    }
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error(i18nMessage('activeTabNotFound'));
    if (message.type === 'KODETY_BACKGROUND_START') {
      const status = await tabCommand(tabId, 'KODETY_CONTENT_START');
      if (!isStatus(status)) throw new Error(i18nMessage('invalidCapturePayload'));
      await setRecording(tabId, true);
      lastStatus.set(tabId, status);
      return status;
    }
    if (message.type === 'KODETY_BACKGROUND_STOP') {
      const status = await tabCommand(tabId, 'KODETY_CONTENT_STOP');
      if (!isStatus(status)) throw new Error(i18nMessage('invalidCapturePayload'));
      await setRecording(tabId, false);
      lastStatus.set(tabId, status);
      return status;
    }
    if (message.type === 'KODETY_BACKGROUND_CLEAR') {
      const status = await tabCommand(tabId, 'KODETY_CONTENT_CLEAR');
      if (!isStatus(status)) throw new Error(i18nMessage('invalidCapturePayload'));
      await setRecording(tabId, false);
      lastStatus.set(tabId, status);
      return status;
    }
    if (message.type === 'KODETY_BACKGROUND_STATUS') {
      try {
        const status = await tabCommand(tabId, 'KODETY_CONTENT_STATUS');
        if (!isStatus(status)) throw new Error(i18nMessage('invalidCapturePayload'));
        lastStatus.set(tabId, status);
        return status;
      } catch {
        return lastStatus.get(tabId) || { state: await recordingEnabled(tabId) ? 'recording' : 'idle' };
      }
    }
    if (message.type === 'KODETY_BACKGROUND_EXPORT') return exportCapture(tabId);
    return null;
  })().then(sendResponse).catch(error => sendResponse({ ok: false, message: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  lastStatus.delete(tabId);
  chrome.storage.session.remove(sessionKey(tabId)).catch(() => {});
});
