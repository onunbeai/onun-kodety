import http from 'node:http';
import net from 'node:net';

import { NetworkPolicyError, pinnedRequestOptions } from './network-policy.js';

export const PROXY_HOST = '127.0.0.1';

function safeResponse(response, statusCode, message) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(message),
    Connection: 'close',
  });
  response.end(message);
}

function sanitizedHeaders(headers) {
  const result = { ...headers };
  for (const name of [
    'connection',
    'proxy-connection',
    'proxy-authorization',
    'x-kodety-bridge-token',
  ]) delete result[name];
  return result;
}

function authorityUrl(authority) {
  if (typeof authority !== 'string' || !authority || /[\s/@]/.test(authority)) {
    throw new NetworkPolicyError('Proxy tunnel target is invalid.');
  }
  let parsed;
  try {
    parsed = new URL(`https://${authority}/`);
  } catch {
    throw new NetworkPolicyError('Proxy tunnel target is invalid.');
  }
  const port = parsed.port ? Number(parsed.port) : 443;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new NetworkPolicyError('Proxy tunnel port is invalid.');
  }
  return parsed.href;
}

export function pinnedSocketOptions(resolution) {
  if (!resolution?.address || !net.isIP(resolution.address)) {
    throw new TypeError('A pinned network resolution is required.');
  }
  return Object.freeze({
    host: resolution.address,
    port: resolution.port,
    family: resolution.family,
  });
}

function trackSocket(socket, sockets) {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  return socket;
}

export async function startPinnedProxy(policy, {
  host = PROXY_HOST,
  port = 0,
  connectImpl = net.connect,
} = {}) {
  if (!policy?.resolveUrl) throw new TypeError('A pinned network policy is required.');
  if (host !== PROXY_HOST) throw new TypeError('The capture proxy must bind to IPv4 loopback.');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError('Proxy port is invalid.');

  const sockets = new Set();
  const server = http.createServer((request, response) => {
    void (async () => {
      let parsed;
      try {
        parsed = new URL(request.url || '');
      } catch {
        throw new NetworkPolicyError('Proxy request URL is invalid.');
      }
      if (parsed.protocol !== 'http:') {
        throw new NetworkPolicyError('Secure proxy requests must use a CONNECT tunnel.');
      }
      const resolution = await policy.resolveUrl(parsed.href);
      const options = pinnedRequestOptions(resolution, {
        method: request.method || 'GET',
        headers: sanitizedHeaders(request.headers),
      });
      const upstream = http.request(options, upstreamResponse => {
        const responseHeaders = sanitizedHeaders(upstreamResponse.headers);
        response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
        upstreamResponse.pipe(response);
      });
      upstream.once('socket', socket => trackSocket(socket, sockets));
      upstream.once('error', () => safeResponse(response, 502, 'Pinned upstream connection failed.'));
      request.once('aborted', () => upstream.destroy());
      response.once('close', () => {
        if (!response.writableEnded) upstream.destroy();
      });
      request.pipe(upstream);
    })().catch(error => {
      const statusCode = error instanceof NetworkPolicyError ? 403 : 502;
      safeResponse(response, statusCode, statusCode === 403 ? 'Network target blocked.' : 'Proxy request failed.');
    });
  });

  server.on('connect', (request, clientSocket, head) => {
    void (async () => {
      const targetUrl = authorityUrl(request.url);
      const resolution = await policy.resolveUrl(targetUrl);
      const upstreamSocket = trackSocket(connectImpl(pinnedSocketOptions(resolution)), sockets);
      trackSocket(clientSocket, sockets);
      upstreamSocket.setTimeout(15_000, () => upstreamSocket.destroy());
      upstreamSocket.once('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upstreamSocket.write(head);
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
      });
      upstreamSocket.once('error', () => {
        if (clientSocket.writable) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      });
      clientSocket.once('error', () => upstreamSocket.destroy());
    })().catch(() => {
      if (clientSocket.writable) clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    });
  });

  server.on('upgrade', (_request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  server.on('connection', socket => trackSocket(socket, sockets));
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  await new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port, exclusive: true });
  });

  const address = server.address();
  const proxyPort = typeof address === 'object' && address ? address.port : 0;
  let closePromise = null;
  return Object.freeze({
    host,
    port: proxyPort,
    url: `http://${host}:${proxyPort}`,
    close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(() => resolve()));
      })();
      return closePromise;
    },
  });
}
