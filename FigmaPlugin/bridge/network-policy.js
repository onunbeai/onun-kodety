import { lookup as systemLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export class NetworkPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkPolicyError';
  }
}

function ipv4Parts(address) {
  if (net.isIP(address) !== 4) return null;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function expandedIpv6Parts(address) {
  if (net.isIP(address) !== 6) return null;
  let normalized = address.toLowerCase().split('%', 1)[0];
  const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (ipv4Tail) {
    const parts = ipv4Parts(ipv4Tail[1]);
    if (!parts) return null;
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    normalized = normalized.slice(0, -ipv4Tail[1].length) + `${high}:${low}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map(part => Number.parseInt(part, 16));
}

function ipv6BigInt(address) {
  const parts = expandedIpv6Parts(address);
  if (!parts) return null;
  return parts.reduce((value, part) => (value << 16n) | BigInt(part), 0n);
}

function prefixMatch(value, base, prefixLength) {
  const shift = 128n - BigInt(prefixLength);
  return (value >> shift) === (base >> shift);
}

function ipv6Base(address) {
  return ipv6BigInt(address);
}

export function networkScopeOfIp(address) {
  const ipv4 = ipv4Parts(address);
  if (ipv4) {
    const [a, b, c] = ipv4;
    if (a === 127) return 'loopback';
    if (
      a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
    ) return 'private';
    if (
      a === 0
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224
    ) return 'blocked';
    return 'public';
  }

  const value = ipv6BigInt(address);
  if (value === null) return 'blocked';
  if (value === 1n) return 'loopback';
  if (value === 0n) return 'blocked';

  const mappedIpv4 = ipv6Base('::ffff:0:0');
  if (prefixMatch(value, mappedIpv4, 96)) {
    const low = Number(value & 0xffffffffn);
    return networkScopeOfIp([
      (low >>> 24) & 255,
      (low >>> 16) & 255,
      (low >>> 8) & 255,
      low & 255,
    ].join('.'));
  }

  if (prefixMatch(value, ipv6Base('fc00::'), 7)) return 'private';
  if (prefixMatch(value, ipv6Base('fe80::'), 10)) return 'blocked';
  if (prefixMatch(value, ipv6Base('ff00::'), 8)) return 'blocked';
  if (prefixMatch(value, ipv6Base('2001:db8::'), 32)) return 'blocked';
  if (prefixMatch(value, ipv6Base('2001::'), 32)) return 'blocked';
  if (prefixMatch(value, ipv6Base('2001:2::'), 48)) return 'blocked';
  if (prefixMatch(value, ipv6Base('2002::'), 16)) return 'blocked';
  return prefixMatch(value, ipv6Base('2000::'), 3) ? 'public' : 'blocked';
}

export function isPrivateOrReservedIp(address) {
  return networkScopeOfIp(address) !== 'public';
}

function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost' || normalized.endsWith('.localhost');
}

function normalizedHostname(hostname) {
  let normalized = hostname.toLowerCase().replace(/\.$/, '');
  if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1);
  return normalized;
}

function isExplicitPrivateHostname(hostname) {
  const normalized = normalizedHostname(hostname);
  if (isLocalHostname(normalized)) return true;
  const family = net.isIP(normalized);
  return Boolean(family && ['loopback', 'private'].includes(networkScopeOfIp(normalized)));
}

function parsedNetworkUrl(value, allowedProtocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new NetworkPolicyError('A page requested an invalid network URL.');
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new NetworkPolicyError('A page requested an unsupported network scheme.');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new NetworkPolicyError('A page requested an unsafe network URL.');
  }
  return parsed;
}

export async function createNetworkPolicy(initialUrl, {
  lookup = systemLookup,
} = {}) {
  const cache = new Map();

  async function resolveHostname(hostname) {
    const normalized = normalizedHostname(hostname);
    if (isLocalHostname(normalized)) {
      return Object.freeze({
        hostname: normalized,
        address: '127.0.0.1',
        family: 4,
        scope: 'private',
        addressScope: 'loopback',
        addresses: Object.freeze([{ address: '127.0.0.1', family: 4 }]),
      });
    }
    if (net.isIP(normalized)) {
      const family = net.isIP(normalized);
      return Object.freeze({
        hostname: normalized,
        address: normalized,
        family,
        scope: isPrivateOrReservedIp(normalized) ? 'private' : 'public',
        addressScope: networkScopeOfIp(normalized),
        addresses: Object.freeze([{ address: normalized, family }]),
      });
    }

    const cached = cache.get(normalized);
    if (cached) return cached;

    const pending = (async () => {
      let resolved;
      try {
        resolved = await lookup(normalized, { all: true, verbatim: true });
      } catch {
        throw new NetworkPolicyError(`Could not resolve ${normalized}.`);
      }
      const rawAddresses = Array.isArray(resolved) ? resolved : [resolved];
      const seen = new Set();
      const addresses = [];
      for (const entry of rawAddresses) {
        if (!entry?.address || !net.isIP(entry.address) || seen.has(entry.address)) continue;
        seen.add(entry.address);
        addresses.push(Object.freeze({ address: entry.address, family: net.isIP(entry.address) }));
      }
      if (!addresses.length) throw new NetworkPolicyError(`Could not resolve ${normalized}.`);
      const addressScopes = new Set(addresses.map(entry => networkScopeOfIp(entry.address)));
      if (addressScopes.size !== 1) {
        throw new NetworkPolicyError(`DNS for ${normalized} mixed network address scopes.`);
      }
      const addressScope = addressScopes.values().next().value;
      if (addressScope === 'blocked') {
        throw new NetworkPolicyError(`DNS for ${normalized} resolved to a reserved network address.`);
      }
      const scope = addressScope === 'public' ? 'public' : 'private';
      const eligible = addresses;
      const pinned = eligible.find(entry => entry.family === 4) || eligible[0];
      return Object.freeze({
        hostname: normalized,
        address: pinned.address,
        family: pinned.family,
        scope,
        addressScope,
        addresses: Object.freeze(addresses),
      });
    })();
    cache.set(normalized, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(normalized);
      throw error;
    }
  }

  const initial = parsedNetworkUrl(initialUrl, ['http:', 'https:']);
  const initialResolution = await resolveHostname(initial.hostname);
  if (initialResolution.addressScope === 'blocked') {
    throw new NetworkPolicyError('Reserved and link-local addresses cannot be imported.');
  }
  if (initialResolution.scope === 'private' && !isExplicitPrivateHostname(initial.hostname)) {
    throw new NetworkPolicyError('Private imports must use localhost or a literal private IP address.');
  }
  const initialScope = initialResolution.scope;
  const allowPrivate = initialScope === 'private';

  async function resolveUrl(value, { allowWebSocket = false } = {}) {
    const protocols = allowWebSocket ? ['http:', 'https:', 'ws:', 'wss:'] : ['http:', 'https:'];
    const parsed = parsedNetworkUrl(value, protocols);
    const resolution = await resolveHostname(parsed.hostname);
    if (resolution.addressScope === 'blocked') {
      throw new NetworkPolicyError('Reserved and link-local network addresses are always blocked.');
    }
    if (!allowPrivate && resolution.scope === 'private') {
      throw new NetworkPolicyError('A public page tried to access a private or reserved network address.');
    }
    if (allowPrivate && resolution.scope === 'private') {
      if (initialResolution.addressScope === 'loopback' && resolution.addressScope !== 'loopback') {
        throw new NetworkPolicyError('A loopback page tried to access a non-loopback private address.');
      }
      if (
        initialResolution.addressScope === 'private'
        && (resolution.addressScope !== 'private' || resolution.address !== initialResolution.address)
      ) {
        throw new NetworkPolicyError('A private page tried to access a different private host.');
      }
    }
    return Object.freeze({
      url: parsed.href,
      protocol: parsed.protocol,
      hostname: resolution.hostname,
      port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 443 : 80),
      address: resolution.address,
      family: resolution.family,
      scope: resolution.scope,
      addressScope: resolution.addressScope,
      addresses: resolution.addresses,
    });
  }

  return Object.freeze({
    initialScope,
    initialResolution,
    allowPrivate,
    resolveUrl,
    assertAllowedUrl: resolveUrl,
  });
}

export function pinnedRequestOptions(resolution, { method = 'GET', headers = {} } = {}) {
  if (!resolution?.url || !resolution.address || !net.isIP(resolution.address)) {
    throw new TypeError('A pinned URL resolution is required.');
  }
  const parsed = new URL(resolution.url);
  const originalHostname = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  const forwardedHeaders = { ...headers, Host: parsed.host };
  delete forwardedHeaders.host;
  delete forwardedHeaders.Connection;
  delete forwardedHeaders.connection;
  delete forwardedHeaders['Proxy-Authorization'];
  delete forwardedHeaders['proxy-authorization'];
  const options = {
    protocol: parsed.protocol,
    hostname: resolution.address,
    family: resolution.family,
    port: resolution.port,
    method,
    path: `${parsed.pathname}${parsed.search}`,
    headers: forwardedHeaders,
    agent: false,
  };
  if (parsed.protocol === 'https:') {
    if (!net.isIP(originalHostname)) options.servername = originalHostname;
    options.checkServerIdentity = (_hostname, certificate) => tls.checkServerIdentity(originalHostname, certificate);
  }
  return options;
}

export function requestPinnedUrl(resolution, { signal, headers, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Request cancelled.');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const options = pinnedRequestOptions(resolution, { method, headers });
    const transport = options.protocol === 'https:' ? https : http;
    let response;
    const cleanupAbort = () => signal?.removeEventListener('abort', onAbort);
    const request = transport.request(options, incoming => {
      response = incoming;
      incoming.once('close', cleanupAbort);
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      resolve({
        status: incoming.statusCode || 0,
        ok: (incoming.statusCode || 0) >= 200 && (incoming.statusCode || 0) < 300,
        headers: responseHeaders,
        body: incoming,
        url: resolution.url,
      });
    });
    const onAbort = () => {
      const error = new Error('Request cancelled.');
      error.name = 'AbortError';
      request.destroy(error);
      response?.destroy(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    request.once('close', () => { if (!response) cleanupAbort(); });
    request.once('error', error => {
      cleanupAbort();
      reject(error);
    });
    request.end();
  });
}

export async function fetchWithNetworkPolicy(url, {
  policy,
  requestImpl = requestPinnedUrl,
  signal,
  headers,
  maxRedirects = 5,
} = {}) {
  if (!policy?.resolveUrl) throw new TypeError('A network policy is required.');
  let current = url;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const allowed = await policy.resolveUrl(current);
    const response = await requestImpl(allowed, { signal, headers, method: 'GET' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new NetworkPolicyError('An image redirect did not include a destination.');
    if (redirects === maxRedirects) throw new NetworkPolicyError('An image exceeded the redirect limit.');
    response.body?.destroy();
    current = new URL(location, allowed.url).href;
    await policy.resolveUrl(current);
  }
  throw new NetworkPolicyError('An image exceeded the redirect limit.');
}
