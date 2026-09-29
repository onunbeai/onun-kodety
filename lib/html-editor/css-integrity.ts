import type { HtmlProject } from './types';

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: Uint8Array) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador não oferece SHA-256 para validar o CSS.');
  }
  // Copy into a guaranteed ArrayBuffer-backed view. Newer TypeScript DOM
  // definitions reject views that could theoretically wrap SharedArrayBuffer.
  const buffer = Uint8Array.from(value).buffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(digest));
}

function projectFileBytes(file: HtmlProject['files'][string]) {
  return file.text !== undefined
    ? new TextEncoder().encode(file.text)
    : file.data || new Uint8Array();
}

/**
 * Produces a path-sensitive digest of the complete editable transport graph.
 *
 * The compatibility ZIP is allowed to become authoritative only after
 * WordPress extracts this exact set of paths and bytes. Hash files
 * sequentially so a rare large-project fallback never duplicates every media
 * buffer in memory at once.
 */
export async function projectTransportDigest(project: HtmlProject) {
  const encoder = new TextEncoder();
  const records: string[] = [];
  for (const file of Object.values(project.files)) {
    const bytes = projectFileBytes(file);
    records.push(`${await sha256(encoder.encode(file.path))}\0${bytes.byteLength}\0${await sha256(bytes)}`);
  }
  records.sort();
  return sha256(encoder.encode(records.join('\0')));
}

/**
 * Produces a path-independent digest of every stylesheet and HTML payload in the editable
 * project. The server computes the same value from the received ZIP and again
 * from the staged theme, so a successful publish proves that no stylesheet was
 * dropped, no inline style was lost, and neither was replaced by an older
 * autosave or corrupted in transit.
 */
export async function projectCssDigest(project: HtmlProject) {
  const encoder = new TextEncoder();
  const fileDigests = await Promise.all(
    Object.values(project.files)
      .filter((file) => /\.(?:css|html?)$/i.test(file.path))
      .map((file) => sha256(file.text !== undefined ? encoder.encode(file.text) : file.data || new Uint8Array())),
  );
  fileDigests.sort();
  return sha256(encoder.encode(fileDigests.join('\0')));
}
