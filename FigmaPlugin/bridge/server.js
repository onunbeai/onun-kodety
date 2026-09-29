import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  IMPORT_LIMITS,
  ValidationError,
  corsOrigin,
  isAllowedOrigin,
  validateImportRequest,
} from './validation.js';

export const LOOPBACK_HOST = '127.0.0.1';
export const BRIDGE_PORTS = Object.freeze(Array.from({ length: 10 }, (_, index) => 7331 + index));
export const BRIDGE_NAME = 'kodety-figma-bridge';

const DEFAULT_IMPORT_TIMEOUT_MS = 120_000;

export function generateBridgeToken() {
  return randomBytes(24).toString('base64url');
}

function validatedBridgeToken(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256 || /\s/.test(value)) {
    throw new TypeError('Bridge token must contain 16 to 256 non-whitespace characters.');
  }
  return value;
}

function tokenMatches(expected, received) {
  if (typeof received !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function applyCommonHeaders(response, origin) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Origin');
  const allowedOrigin = corsOrigin(origin);
  if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
}

function writeJson(response, statusCode, value, origin) {
  if (response.writableEnded || response.destroyed) return;
  const body = JSON.stringify(value);
  applyCommonHeaders(response, origin);
  response.statusCode = statusCode;
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function writePreflight(request, response, origin) {
  applyCommonHeaders(response, origin);
  response.statusCode = 204;
  response.removeHeader('Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Kodety-Client, X-Kodety-Bridge-Token');
  response.setHeader('Access-Control-Max-Age', '600');
  if (request.headers['access-control-request-private-network'] === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  response.end();
}

async function readJsonBody(request) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > IMPORT_LIMITS.maxRequestBytes) {
    throw new HttpError(413, 'Request body is too large.');
  }

  const chunks = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > IMPORT_LIMITS.maxRequestBytes) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) throw new HttpError(413, 'Request body is too large.');
  if (!chunks.length) throw new HttpError(400, 'Request body is empty.');

  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

async function defaultCapture(options, context) {
  const { captureUrl } = await import('./browser.js');
  return captureUrl(options, context);
}

function normalizedCaptureResult(result) {
  if (result?.spec && typeof result.spec === 'object') {
    return { spec: result.spec, meta: result.meta || {} };
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { spec: result, meta: {} };
  }
  throw new Error('The renderer returned an invalid scene.');
}

async function captureWithSignal(capture, options, signal) {
  let removeAbortListener = () => {};
  const aborted = new Promise((_, reject) => {
    const onAbort = () => {
      const error = new Error('URL capture was cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => capture(options, { signal })),
      aborted,
    ]);
  } finally {
    removeAbortListener();
  }
}

export function createBridgeServer({
  capture = defaultCapture,
  maxConcurrent = 1,
  importTimeoutMs = DEFAULT_IMPORT_TIMEOUT_MS,
  token = generateBridgeToken(),
} = {}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) {
    throw new TypeError('maxConcurrent must be an integer from 1 to 4.');
  }
  if (!Number.isInteger(importTimeoutMs) || importTimeoutMs < 1_000 || importTimeoutMs > 300_000) {
    throw new TypeError('importTimeoutMs must be an integer from 1000 to 300000.');
  }
  const bridgeToken = validatedBridgeToken(token);

  let activeImports = 0;
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin)) {
      writeJson(response, 403, { ok: false, error: 'Origin is not allowed.' }, null);
      return;
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url || '/', `http://${LOOPBACK_HOST}`);
    } catch {
      writeJson(response, 400, { ok: false, error: 'Invalid request path.' }, origin);
      return;
    }

    const knownPath = requestUrl.pathname === '/health' || requestUrl.pathname === '/import';
    if (request.method === 'OPTIONS' && knownPath) {
      writePreflight(request, response, origin);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(response, 200, {
        ok: true,
        name: BRIDGE_NAME,
        version: '1.0.0',
        activeImports,
        pairingRequired: true,
      }, origin);
      return;
    }

    if (requestUrl.pathname !== '/import') {
      writeJson(response, 404, { ok: false, error: 'Not found.' }, origin);
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS');
      writeJson(response, 405, { ok: false, error: 'Method not allowed.' }, origin);
      return;
    }
    if (request.headers['x-kodety-client'] !== 'figma-plugin') {
      writeJson(response, 403, { ok: false, error: 'Kodety client header is required.' }, origin);
      return;
    }
    if (!tokenMatches(bridgeToken, request.headers['x-kodety-bridge-token'])) {
      writeJson(response, 401, { ok: false, error: 'Bridge pairing token is invalid or missing.' }, origin);
      return;
    }
    if (activeImports >= maxConcurrent) {
      response.setHeader('Retry-After', '2');
      writeJson(response, 429, { ok: false, error: 'Another URL import is already running.' }, origin);
      return;
    }

    let options;
    try {
      options = validateImportRequest(await readJsonBody(request));
    } catch (error) {
      const statusCode = error instanceof ValidationError || error instanceof HttpError
        ? error.statusCode
        : 400;
      writeJson(response, statusCode, { ok: false, error: error.message || 'Invalid request.' }, origin);
      return;
    }

    activeImports += 1;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, importTimeoutMs);
    const abortDisconnectedClient = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', abortDisconnectedClient);
    response.once('close', abortDisconnectedClient);

    try {
      const captured = normalizedCaptureResult(
        await captureWithSignal(capture, options, controller.signal),
      );
      writeJson(response, 200, { ok: true, spec: captured.spec, meta: captured.meta }, origin);
    } catch (error) {
      if (timedOut) {
        writeJson(response, 504, { ok: false, error: 'URL capture timed out.' }, origin);
      } else if (controller.signal.aborted) {
        writeJson(response, 499, { ok: false, error: 'URL capture was cancelled.' }, origin);
      } else {
        writeJson(response, 502, {
          ok: false,
          error: error instanceof Error ? error.message : 'URL capture failed.',
        }, origin);
      }
    } finally {
      clearTimeout(timeout);
      request.removeListener('aborted', abortDisconnectedClient);
      response.removeListener('close', abortDisconnectedClient);
      activeImports -= 1;
    }
  });

  server.requestTimeout = importTimeoutMs + 10_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  Object.defineProperty(server, 'bridgeToken', { value: bridgeToken, enumerable: false });
  return server;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
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
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true });
  });
}

export async function startBridge({ ports = BRIDGE_PORTS, ...serverOptions } = {}) {
  const token = validatedBridgeToken(
    serverOptions.token || process.env.KODETY_BRIDGE_TOKEN || generateBridgeToken(),
  );
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) continue;
    const server = createBridgeServer({ ...serverOptions, token });
    try {
      await listen(server, port);
      return { server, port, host: LOOPBACK_HOST, token };
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No free Kodety bridge port was found from 7331 through 7340.');
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const { server, port, token } = await startBridge();
  process.stdout.write(`Figma to Kodety bridge ready at http://${LOOPBACK_HOST}:${port}\n`);
  process.stdout.write(`Pairing token: ${token}\n`);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await closeServer(server);
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
