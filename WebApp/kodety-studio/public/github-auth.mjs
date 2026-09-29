import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export const GITHUB_AUTH_PREFIX = '/__kodety_deploy__/github/';

/** Optional, same-origin GitHub App device authorization. No credentials on disk. */
export function createGitHubAuth({ clientId = process.env.KODETY_GITHUB_CLIENT_ID || '', trustProxy = process.env.KODETY_GITHUB_TRUST_PROXY === '1', fetch: fetcher = globalThis.fetch, now = Date.now } = {}) {
  const sessions = new Map();
  const starts = new Map();
  let starting = 0;
  const configured = /^[A-Za-z0-9_.-]{4,100}$/.test(clientId);
  function send(response, status, payload) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    response.end(JSON.stringify(payload));
  }
  async function github(endpoint, fields) {
    const response = await fetcher(`https://github.com/login/${endpoint}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, ...fields }).toString(),
    });
    if (!response.ok) throw new Error('GitHub authorization unavailable.');
    const result = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid GitHub response.');
    return result;
  }
  function prune() {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
    for (const [ip, entry] of starts) if (entry.until <= now()) starts.delete(ip);
  }
  return {
    clear() { sessions.clear(); starts.clear(); },
    async handle(request, response, pathname, origin) {
      if (!pathname.startsWith(GITHUB_AUTH_PREFIX)) return false;
      const action = pathname.slice(GITHUB_AUTH_PREFIX.length);
      try {
        prune();
        if (action === 'config' && request.method === 'GET') {
          send(response, 200, { available: configured });
          return true;
        }
        // Browsers cannot send this header cross-origin without a preflight,
        // and these routes deliberately do not grant CORS access.
        if (request.method !== 'POST') { send(response, 405, { error: 'Method not allowed.' }); return true; }
        if (request.headers.origin !== origin || request.headers['x-kodety-deploy'] !== '1'
          || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
          send(response, 403, { error: 'GitHub authorization origin denied.' }); return true;
        }
        if (!configured) { send(response, 503, { error: 'GitHub login is not configured on this host.' }); return true; }
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString('utf8');
          if (Buffer.byteLength(body) > 2048) { send(response, 413, { error: 'Request too large.' }); return true; }
        }
        let input;
        try { input = JSON.parse(body || '{}'); } catch { send(response, 400, { error: 'Invalid JSON.' }); return true; }
        if (!input || typeof input !== 'object' || Array.isArray(input)) { send(response, 400, { error: 'Invalid request.' }); return true; }
        if (action === 'start') {
          // Opt-in only: the deployment must restrict backend access to a proxy
          // that overwrites X-Forwarded-For with exactly one validated client IP.
          const forwarded = request.headers['x-forwarded-for'];
          const ip = trustProxy && typeof forwarded === 'string' && isIP(forwarded.trim())
            ? forwarded.trim() : request.socket.remoteAddress || 'unknown';
          const rate = starts.get(ip) || { count: 0, until: now() + 60_000 };
          if (rate.count >= 5 || sessions.size + starting >= 128 || starts.size >= 1024 && !starts.has(ip)) {
            send(response, 429, { error: 'Too many login attempts. Please wait a minute.' }); return true;
          }
          rate.count += 1;
          starts.set(ip, rate);
          starting += 1;
          let result;
          try { result = await github('device/code', {}); } finally { starting -= 1; }
          if (result.error) { send(response, 502, { error: result.error === 'device_flow_disabled' ? 'Enable device flow in the GitHub App settings.' : 'GitHub could not start authorization.' }); return true; }
          if (typeof result.device_code !== 'string' || !result.device_code || result.device_code.length > 256
            || !/^[A-Z0-9-]{6,20}$/.test(result.user_code || '') || result.verification_uri !== 'https://github.com/login/device'
            || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error('Invalid authorization response.');
          const sessionId = randomBytes(32).toString('base64url');
          const interval = Math.max(5, Math.min(60, Number(result.interval) || 5));
          const expiresAt = now() + Math.min(900, result.expires_in) * 1000;
          sessions.set(sessionId, { deviceCode: result.device_code, origin, expiresAt, interval, nextPoll: now() + interval * 1000, busy: false });
          send(response, 200, { sessionId, userCode: result.user_code, verificationUri: result.verification_uri, interval, expiresAt });
          return true;
        }
        if (!['poll', 'cancel'].includes(action)) { send(response, 404, { error: 'Unknown authorization route.' }); return true; }
        const session = typeof input.sessionId === 'string' ? sessions.get(input.sessionId) : null;
        if (!session || session.origin !== origin) { send(response, 410, { error: 'This login expired. Start again.' }); return true; }
        if (action === 'cancel') { sessions.delete(input.sessionId); send(response, 200, { status: 'cancelled' }); return true; }
        if (session.busy || now() < session.nextPoll) {
          send(response, 200, { status: 'pending', interval: Math.max(session.interval, Math.ceil((session.nextPoll - now()) / 1000)) }); return true;
        }
        session.busy = true;
        session.nextPoll = now() + session.interval * 1000;
        let result;
        try {
          result = await github('oauth/access_token', { device_code: session.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        } finally { session.busy = false; }
        if (sessions.get(input.sessionId) !== session || session.expiresAt <= now()) { send(response, 410, { error: 'This login expired or was cancelled.' }); return true; }
        if (result.error === 'authorization_pending') { send(response, 200, { status: 'pending', interval: session.interval }); return true; }
        if (result.error === 'slow_down') {
          session.interval = Math.max(session.interval + 5, Math.min(900, Number(result.interval) || 0));
          session.nextPoll = now() + session.interval * 1000;
          send(response, 200, { status: 'slow_down', interval: session.interval }); return true;
        }
        sessions.delete(input.sessionId);
        if (result.error) {
          send(response, 400, { error: result.error === 'access_denied' ? 'GitHub authorization was declined.' : 'GitHub authorization expired or failed. Start again.' }); return true;
        }
        if (typeof result.access_token !== 'string' || !/^[A-Za-z0-9_]+$/.test(result.access_token) || result.token_type?.toLowerCase() !== 'bearer') throw new Error('Invalid access token response.');
        // Deliver once to the initiating tab. Discard refresh tokens entirely.
        send(response, 200, { status: 'complete', accessToken: result.access_token });
      } catch {
        send(response, 502, { error: 'Unable to reach GitHub authorization. Please try again.' });
      }
      return true;
    },
  };
}
