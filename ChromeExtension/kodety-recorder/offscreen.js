const encoder = new TextEncoder();
const MAX_CAPTURE_TEXT_CHARS = 12_000_000;
const MAX_CAPTURE_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_OFFSCREEN_MESSAGE_BYTES = 48 * 1024 * 1024;
const MAX_MHTML_BYTES = 4 * 1024 * 1024;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonByteLength(value) {
  try { return encoder.encode(JSON.stringify(value)).byteLength; } catch { return Infinity; }
}

function isValidBuildMessage(message, maxBytes = MAX_OFFSCREEN_MESSAGE_BYTES) {
  if (!isRecord(message) || message.type !== 'KODETY_OFFSCREEN_BUILD_ZIP' || !isRecord(message.payload)) return false;
  const payload = message.payload;
  for (const field of ['html', 'css', 'externalCss', 'responsiveCss', 'runtime', 'originalHtml']) {
    if (typeof payload[field] !== 'string' || payload[field].length > MAX_CAPTURE_TEXT_CHARS) return false;
  }
  if (payload.externalCss !== '' || payload.originalHtml !== '') return false;
  if (!isRecord(payload.manifest) || !isRecord(payload.manifest.page) || !isRecord(payload.framerManifest)) return false;
  if (message.mhtml != null && (!Array.isArray(message.mhtml) || message.mhtml.length > MAX_MHTML_BYTES ||
      message.mhtml.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))) return false;
  return jsonByteLength(payload) <= MAX_CAPTURE_PAYLOAD_BYTES && jsonByteLength(message) <= maxBytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size); let offset = 0;
  parts.forEach(part => { output.set(part, offset); offset += part.length; });
  return output;
}

function zipStore(files) {
  const localParts = [], centralParts = []; let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    localParts.push(local);
    centralParts.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const central = concat(centralParts);
  return concat([...localParts, central, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
}

function filename(hostname) {
  const host = String(hostname || 'site').replace(/[^a-z0-9.-]+/gi, '-').replace(/^-|-$/g, '');
  return `kodety-capture-${host}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'KODETY_OFFSCREEN_BUILD_ZIP') return false;
  if (sender?.id !== chrome.runtime.id || sender.tab || !isValidBuildMessage(message)) {
    sendResponse({ ok: false, message: chrome.i18n.getMessage('invalidCapturePayload') });
    return false;
  }
  try {
    const payload = message.payload;
    const files = [
      { name: 'index.html', data: payload.html || '' },
      { name: 'styles/kodety-recorded-interactions.css', data: payload.css || '' },
      { name: 'styles/kodety-recorded-external.css', data: payload.externalCss || '' },
      { name: 'styles/kodety-recorded-responsive.css', data: payload.responsiveCss || '' },
      { name: 'scripts/kodety-recorded-runtime.js', data: payload.runtime || '' },
      { name: '.incode/framer-import.json', data: JSON.stringify(payload.framerManifest || { version: 1 }, null, 2) },
      { name: '.incode/kodety-recorder.json', data: JSON.stringify(payload.manifest || {}, null, 2) },
    ];
    if (message.mhtml?.length) files.push({ name: 'source/original-page.mhtml', data: new Uint8Array(message.mhtml) });
    const zip = zipStore(files), url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    // Offscreen documents do not expose chrome.downloads. The service worker
    // receives this extension-scoped Blob URL and starts the actual download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    sendResponse({ ok: true, url, filename: filename(payload.manifest?.page?.hostname) });
  } catch (error) { sendResponse({ ok: false, message: error.message }); }
  return false;
});
