import { createHash } from 'node:crypto';

const DEFAULT_MAX_DIAGNOSTIC_LENGTH = 2_000;
const SENSITIVE_KEY_SOURCE = [
  'token', 'nonce', 'password', 'passwd', 'pwd', 'api[_-]?key', 'secret',
  'signature', 'authorization', 'cookie', 'set-cookie',
  'access[_-]?token', 'refresh[_-]?token', 'auth[_-]?token', 'id[_-]?token',
  'csrf[_-]?token', 'client[_-]?secret', 'wp[_-]?nonce', 'x[_-]?wp[_-]?nonce',
].join('|');
const QUOTED_SENSITIVE_VALUE = new RegExp(
  `(["'](?:${SENSITIVE_KEY_SOURCE})["']\\s*:\\s*["'])(.*?)(["'])`,
  'gi',
);
const UNQUOTED_SENSITIVE_VALUE = new RegExp(
  `\\b((?:${SENSITIVE_KEY_SOURCE})\\s*[:=]\\s*)([^\\s,;"']+)`,
  'gi',
);

function isSensitiveValueKey(key) {
  const normalized = String(key ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^(?:token|nonce|password|passwd|pwd|apikey|secret|signature|authorization|cookie|setcookie|accesstoken|refreshtoken|authtoken|idtoken|csrftoken|clientsecret|wpnonce|xwpnonce)$/.test(normalized);
}

const SAFE_PATH_SEGMENTS = new Map([
  'wp-admin', 'wp-content', 'wp-includes', 'wp-json', 'plugins', 'themes', 'uploads',
  'wp-login.php', 'index.php', 'admin.php', 'admin-ajax.php', 'admin-post.php',
  'load-scripts.php', 'load-styles.php', 'kodety', 'kodety-files', 'editor',
  'settings', 'cms', 'analytics', 'localization', 'v1', 'project', 'surface',
  'asset', 'chunk', 'delta', 'publish', 'assets',
].map(segment => [segment.toLowerCase(), segment]));

export function redactedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '[INVALID URL]';
    url.username = '';
    url.password = '';
    url.pathname = url.pathname.split('/').map(segment => {
      if (!segment) return '';
      const decoded = (() => {
        try { return decodeURIComponent(segment); } catch { return null; }
      })();
      if (
        decoded === null
        || /%[0-9a-f]{2}/i.test(decoded)
        || /[\\/\u0000-\u001f\u007f-\uffff]/.test(decoded)
      ) {
        return '[REDACTED]';
      }
      return SAFE_PATH_SEGMENTS.get(decoded.toLowerCase()) || '[REDACTED]';
    }).join('/');
    const queryCount = [...url.searchParams].length;
    url.search = '';
    for (let index = 0; index < queryCount; index += 1) {
      url.searchParams.append('redacted-' + (index + 1), '[REDACTED]');
    }
    url.hash = '';
    return url.href;
  } catch {
    return '[INVALID URL]';
  }
}

export function redactDiagnostic(
  rawValue,
  secrets,
  maximum = DEFAULT_MAX_DIAGNOSTIC_LENGTH,
) {
  let value = String(rawValue ?? '');
  for (const secret of secrets) {
    if (secret) value = value.split(secret).join('[REDACTED]');
  }
  value = value
    .replace(/https?:\/\/[^\s"'<>]+/gi, candidate => redactedUrl(candidate))
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(QUOTED_SENSITIVE_VALUE, '$1[REDACTED]$3')
    .replace(
      /\b((?:set-cookie|cookie)\s*[:=]\s*)([^\r\n]+)/gi,
      '$1[REDACTED]',
    )
    .replace(
      /\b(wordpress_(?:logged_in|sec)_[^=\s;,]+|wp-settings-\d+)\s*=\s*[^;\s,]+/gi,
      '$1=[REDACTED]',
    )
    .replace(/([?&][^=\s&#"'<>]+)=([^&#\s"'<>]*)/g, '$1=[REDACTED]')
    .replace(UNQUOTED_SENSITIVE_VALUE, '$1[REDACTED]');
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}…[TRUNCATED]`;
}

export function diagnosticFingerprint(rawValue, secrets = []) {
  const diagnostic = redactDiagnostic(rawValue, secrets, DEFAULT_MAX_DIAGNOSTIC_LENGTH);
  const normalized = diagnostic.toLowerCase();
  const category = diagnostic.length === 0
    ? 'empty'
    : /\b(?:timeout|timed out|tempo esgotado|prazo)\b/.test(normalized)
      ? 'timeout'
      : /\b(?:bearer|basic|authorization|nonce|cookie|forbidden|unauthorized)\b/.test(normalized)
        ? 'authorization'
        : /\b(?:http|status|response|resposta|[45]\d\d)\b/.test(normalized)
          ? 'http'
          : /\b(?:network|fetch|request|socket|dns|rede|conexão)\b/.test(normalized)
            ? 'network'
            : 'other';
  return Object.freeze({
    category,
    sizeBytes: Buffer.byteLength(diagnostic, 'utf8'),
    sha256: createHash('sha256').update(diagnostic, 'utf8').digest('hex'),
  });
}

function normalizeSecretPolicy(policy) {
  if (Array.isArray(policy)) {
    const values = policy.filter(Boolean);
    return { redact: values, forbid: values };
  }
  return {
    redact: Array.isArray(policy?.redact) ? policy.redact.filter(Boolean) : [],
    forbid: Array.isArray(policy?.forbid) ? policy.forbid.filter(Boolean) : [],
  };
}

export function serializeRedactedArtifact(value, secretPolicy = []) {
  const secrets = normalizeSecretPolicy(secretPolicy);
  const forbiddenPayloadKeys = new Set([
    'postData', 'requestBody', 'responseBody', 'requestHeaders', 'responseHeaders',
  ]);
  const sanitize = (candidate, key = '') => {
    if (typeof candidate === 'string') {
      if (isSensitiveValueKey(key)) return '[REDACTED]';
      if (key === 'url') {
        const url = new URL(redactedUrl(candidate));
        for (const secret of secrets.redact) {
          if (secret) url.pathname = url.pathname.split(secret).join('[REDACTED]');
        }
        return url.href;
      }
      return redactDiagnostic(candidate, secrets.redact, 20_000);
    }
    if (Array.isArray(candidate)) return candidate.map(item => sanitize(item, key));
    if (!candidate || typeof candidate !== 'object') return candidate;
    return Object.fromEntries(
      Object.entries(candidate).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey),
      ]),
    );
  };
  const safeValue = sanitize(value);
  const visit = (candidate, key = '') => {
    if (forbiddenPayloadKeys.has(key)) {
      throw new Error(`Artefato bloqueado pelo campo sensível ${key}.`);
    }
    if ((key === 'headers' || key === 'cookies') && Array.isArray(candidate) && candidate.length > 0) {
      throw new Error(`Artefato bloqueado por ${key} não vazio.`);
    }
    if (typeof candidate === 'string') {
      for (const secret of secrets.forbid) {
        if (secret && candidate.includes(secret)) {
          throw new Error('Artefato bloqueado porque ainda contém uma credencial literal.');
        }
      }
      if (/\b(?:Bearer|Basic)\s+(?!\[REDACTED\])\S+/i.test(candidate)) {
        throw new Error('Artefato bloqueado porque ainda contém Authorization não redigido.');
      }
      if (isSensitiveValueKey(key) && candidate !== '[REDACTED]') {
        throw new Error(`Artefato bloqueado porque ${key} não foi redigido.`);
      }
      if (key === 'url') {
        const url = new URL(candidate);
        for (const queryValue of url.searchParams.values()) {
          if (queryValue !== '[REDACTED]') {
            throw new Error('Artefato bloqueado porque ainda contém valor de query string.');
          }
        }
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, key);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [childKey, childValue] of Object.entries(candidate)) visit(childValue, childKey);
  };
  visit(safeValue);
  return `${JSON.stringify(safeValue, null, 2)}\n`;
}
