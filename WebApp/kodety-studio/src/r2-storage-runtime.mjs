/** Private, stateless signing process in the shared WebContainer.
 * Credentials arrive only over stdin and never touch its filesystem or network.
 * Protocol: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */
import { createHash, createHmac } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const R2_PREFIX = 'kodety-studio/v1/';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const invalid = () => { throw new Error('r2-invalid-config'); };

export function validateR2Config(value) {
  if (!value || typeof value !== 'object') invalid();
  const config = Object.fromEntries(['accountId', 'accessKeyId', 'secretAccessKey', 'bucket'].map(key => [key, typeof value[key] === 'string' ? value[key].trim() : '']));
  if (!/^[a-f\d]{32}$/i.test(config.accountId)
    || !/^[a-f\d]{32}$/i.test(config.accessKeyId)
    || !/^[a-f\d]{64}$/i.test(config.secretAccessKey)
    || !/^[a-z\d][a-z\d-]{1,61}[a-z\d]$/.test(config.bucket)
    || config.bucket.startsWith('xn--') || config.bucket.endsWith('-s3alias') || config.bucket.endsWith('--ol-s3')) invalid();
  return config;
}

export function validateR2Key(key) {
  if (typeof key !== 'string' || !key.startsWith(R2_PREFIX) || Buffer.byteLength(key, 'utf8') > 1024
    || /[\\\x00-\x1f\x7f]/.test(key) || key.split('/').some(segment => segment === '.' || segment === '..')) invalid();
  return key;
}

/** Payload digest is calculated in the parent browser, keeping large ZIPs out of
 * stdin. All HMAC/key derivation occurs here; this module never calls fetch. */
export function signR2Request(input, now = new Date()) {
  const config = validateR2Config(input.config);
  const method = input.method;
  if (!['GET', 'HEAD', 'PUT', 'DELETE'].includes(method) || !/^[a-f\d]{64}$/.test(input.payloadHash)) invalid();
  const query = input.query || {};
  if (!query || typeof query !== 'object' || Array.isArray(query)) invalid();
  if (input.key !== undefined) {
    validateR2Key(input.key);
    if (Object.keys(query).length) invalid();
  } else {
    if (method !== 'GET' || query['list-type'] !== '2') invalid();
    validateR2Key(query.prefix);
    if (Object.keys(query).some(key => !['list-type', 'prefix', 'continuation-token', 'max-keys'].includes(key))
      || Object.values(query).some(value => typeof value !== 'string' || value.length > 8192)
      || query['max-keys'] && !/^(?:[1-9]\d{0,2}|1000)$/.test(query['max-keys'])) invalid();
  }
  const host = `${config.accountId.toLowerCase()}.r2.cloudflarestorage.com`;
  const uri = `/${config.bucket}${input.key === undefined ? '' : `/${input.key.split('/').map(encode).join('/')}`}`;
  const canonicalQuery = Object.entries(query).map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('&');
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const headers = { host, 'x-amz-date': date, 'x-amz-content-sha256': input.payloadHash };
  if (input.contentType !== undefined) {
    if (typeof input.contentType !== 'string' || !input.contentType || input.contentType.length > 200 || /[\r\n]/.test(input.contentType)) invalid();
    headers['content-type'] = input.contentType.trim();
  }
  for (const [key, value] of Object.entries(input.headers || {})) {
    if (!['if-match', 'if-none-match'].includes(key.toLowerCase()) || typeof value !== 'string' || !value || value.length > 256 || /[\r\n]/.test(value)) invalid();
    headers[key.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map(key => `${key}:${headers[key]}\n`).join('');
  const canonicalRequest = [method, uri, canonicalQuery, canonicalHeaders, signedHeaders, input.payloadHash].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  // Overwrite binary intermediates after this one operation. No credentials are
  // cached on the process, logged or returned to the parent.
  for (const key of [dateKey, regionKey, serviceKey, signingKey]) key.fill(0);
  delete headers.host; // The browser supplies this forbidden request header.
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `https://${host}${uri}${canonicalQuery ? `?${canonicalQuery}` : ''}`, method, headers };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    let command;
    try {
      if (line.length > 24_000) return;
      command = JSON.parse(line);
      if (typeof command.id !== 'string' || command.id.length > 100) return;
      const result = signR2Request(command.request);
      process.stdout.write(JSON.stringify({ channel: 'kodety-r2', id: command.id, result }) + '\n');
    } catch {
      if (typeof command?.id === 'string') process.stdout.write(JSON.stringify({ channel: 'kodety-r2', id: command.id, error: 'r2-invalid-config' }) + '\n');
    }
  });
  lines.on('close', () => process.exit(0));
  process.stdout.write(JSON.stringify({ channel: 'kodety-r2', ready: true }) + '\n');
}
