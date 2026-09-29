import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { BRIDGE_NAME, createBridgeServer, LOOPBACK_HOST } from '../server.js';
import {
  createNetworkPolicy,
  fetchWithNetworkPolicy,
  isPrivateOrReservedIp,
  networkScopeOfIp,
  NetworkPolicyError,
  pinnedRequestOptions,
} from '../network-policy.js';
import { pinnedSocketOptions, startPinnedProxy } from '../pinned-proxy.js';
import { detectImageMime, inspectImageDataUrl } from '../browser.js';
import { isAllowedOrigin, validateImportRequest, ValidationError } from '../validation.js';

const TEST_TOKEN = 'test-token-1234567890';
const browserSource = await fs.readFile(new URL('../browser.js', import.meta.url), 'utf8');

function validInput(overrides = {}) {
  return {
    url: 'https://example.com/path?q=1',
    width: 1440,
    colorScheme: null,
    rootSelector: 'body',
    frameName: null,
    hybridSnapshot: false,
    ...overrides,
  };
}

async function listenForTest(server) {
  server.listen({ host: LOOPBACK_HOST, port: 0 });
  await once(server, 'listening');
  const address = server.address();
  return `http://${LOOPBACK_HOST}:${address.port}`;
}

async function closeForTest(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

test('validateImportRequest normalizes the supported request surface', () => {
  const result = validateImportRequest(validInput({
    url: ' https://example.com/hero ',
    rootSelector: ' #hero ',
    frameName: ' Landing ',
    colorScheme: 'dark',
    hybridSnapshot: true,
  }));
  assert.deepEqual(result, {
    url: 'https://example.com/hero',
    width: 1440,
    colorScheme: 'dark',
    rootSelector: '#hero',
    frameName: 'Landing',
    hybridSnapshot: true,
  });
  assert.ok(Object.isFrozen(result));
});

test('validateImportRequest rejects unsupported schemes, dimensions, themes, and fields', () => {
  for (const input of [
    validInput({ url: 'ftp://example.com/page' }),
    validInput({ url: 'data:text/plain,hello' }),
    validInput({ width: 319 }),
    validInput({ width: 3841 }),
    validInput({ width: 1024.5 }),
    validInput({ colorScheme: 'auto' }),
    validInput({ rootSelector: 'a'.repeat(513) }),
    validInput({ frameName: 'a'.repeat(513) }),
    validInput({ hybridSnapshot: 'yes' }),
    { ...validInput(), action: 'anything' },
  ]) {
    assert.throws(() => validateImportRequest(input), ValidationError);
  }
});

test('origin policy accepts only opaque, absent, or HTTPS Figma origins', () => {
  assert.equal(isAllowedOrigin(undefined), true);
  assert.equal(isAllowedOrigin('null'), true);
  assert.equal(isAllowedOrigin('https://www.figma.com'), true);
  assert.equal(isAllowedOrigin('https://desktop.figma.com'), true);
  assert.equal(isAllowedOrigin('http://www.figma.com'), false);
  assert.equal(isAllowedOrigin('https://figma.com.evil.example'), false);
  assert.equal(isAllowedOrigin('https://evil.example'), false);
});

test('network policy recognizes loopback, private, link-local, and reserved IPs', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.1.1',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ]) assert.equal(isPrivateOrReservedIp(address), true, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateOrReservedIp(address), false, address);
  }
  assert.equal(networkScopeOfIp('127.0.0.1'), 'loopback');
  assert.equal(networkScopeOfIp('::1'), 'loopback');
  assert.equal(networkScopeOfIp('192.168.1.1'), 'private');
  assert.equal(networkScopeOfIp('fd12::1'), 'private');
  assert.equal(networkScopeOfIp('169.254.169.254'), 'blocked');
  assert.equal(networkScopeOfIp('fe80::1'), 'blocked');
  assert.equal(networkScopeOfIp('1.1.1.1'), 'public');
});

test('public imports cannot redirect media into a private network', async () => {
  const lookup = async hostname => {
    if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
    throw new Error('Unexpected DNS lookup');
  };
  const policy = await createNetworkPolicy('https://example.com', { lookup });
  const requests = [];
  const requestImpl = async resolution => {
    requests.push({ url: resolution.url, address: resolution.address });
    return {
      status: 302,
      headers: new Headers({ Location: 'http://127.0.0.1/private-resource' }),
      body: { destroy() {} },
    };
  };
  await assert.rejects(
    fetchWithNetworkPolicy('https://example.com/image', { policy, requestImpl }),
    NetworkPolicyError,
  );
  assert.deepEqual(requests, [{ url: 'https://example.com/image', address: '93.184.216.34' }]);

  const privatePolicy = await createNetworkPolicy('http://localhost:3000', {
    lookup: async hostname => {
      if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
      throw new Error('Unexpected DNS lookup');
    },
  });
  assert.equal(privatePolicy.allowPrivate, true);
  assert.equal((await privatePolicy.assertAllowedUrl('http://127.0.0.2:4000/image.png')).addressScope, 'loopback');
  assert.equal((await privatePolicy.assertAllowedUrl('https://example.com/image.png')).scope, 'public');
  await assert.rejects(
    privatePolicy.assertAllowedUrl('http://192.168.1.20/image.png'),
    NetworkPolicyError,
  );
  await assert.rejects(
    privatePolicy.assertAllowedUrl('http://169.254.169.254/latest/meta-data'),
    NetworkPolicyError,
  );
});

test('private imports cannot expand their authorized private network scope', async () => {
  await assert.rejects(
    createNetworkPolicy('http://private-name.example', {
      lookup: async () => [{ address: '192.168.1.20', family: 4 }],
    }),
    NetworkPolicyError,
  );
  await assert.rejects(createNetworkPolicy('http://169.254.169.254/'), NetworkPolicyError);
  await assert.rejects(createNetworkPolicy('http://0.0.0.0/'), NetworkPolicyError);

  const policy = await createNetworkPolicy('http://192.168.1.20:3000/');
  assert.equal((await policy.resolveUrl('http://192.168.1.20:5173/app.js')).address, '192.168.1.20');
  await assert.rejects(policy.resolveUrl('http://192.168.1.21/app.js'), NetworkPolicyError);
  await assert.rejects(policy.resolveUrl('http://127.0.0.1/admin'), NetworkPolicyError);
  await assert.rejects(policy.resolveUrl('http://169.254.169.254/latest/meta-data'), NetworkPolicyError);
});

test('DNS is resolved once and every HTTP or CONNECT dial stays pinned to the validated IP', async () => {
  let lookups = 0;
  const lookup = async () => {
    lookups += 1;
    return lookups === 1
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  };
  const policy = await createNetworkPolicy('https://rebind.example/start', { lookup });
  const dials = [];
  let responseNumber = 0;
  const requestImpl = async resolution => {
    dials.push({ url: resolution.url, address: resolution.address });
    responseNumber += 1;
    return responseNumber === 1
      ? {
          status: 302,
          headers: new Headers({ Location: '/next' }),
          body: { destroy() {} },
        }
      : { status: 200, headers: new Headers(), body: { destroy() {} } };
  };
  await fetchWithNetworkPolicy('https://rebind.example/image', { policy, requestImpl });
  const resolution = await policy.resolveUrl('https://rebind.example/tunnel');
  const httpOptions = pinnedRequestOptions(resolution);
  const socketOptions = pinnedSocketOptions(resolution);

  assert.equal(lookups, 1);
  assert.deepEqual(dials, [
    { url: 'https://rebind.example/image', address: '93.184.216.34' },
    { url: 'https://rebind.example/next', address: '93.184.216.34' },
  ]);
  assert.equal(httpOptions.hostname, '93.184.216.34');
  assert.equal(httpOptions.servername, 'rebind.example');
  assert.equal(httpOptions.headers.Host, 'rebind.example');
  assert.deepEqual(socketOptions, { host: '93.184.216.34', port: 443, family: 4 });
});

test('capture proxy CONNECT dials the pinned address even if DNS would later rebind', async () => {
  let lookups = 0;
  const policy = await createNetworkPolicy('https://proxy-rebind.example', {
    lookup: async () => {
      lookups += 1;
      return lookups === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    },
  });
  let dialOptions;
  const proxy = await startPinnedProxy(policy, {
    connectImpl(options) {
      dialOptions = options;
      const socket = new PassThrough();
      socket.setTimeout = () => socket;
      setImmediate(() => socket.emit('connect'));
      return socket;
    },
  });
  try {
    const client = net.connect({ host: proxy.host, port: proxy.port });
    await once(client, 'connect');
    client.write('CONNECT proxy-rebind.example:443 HTTP/1.1\r\nHost: proxy-rebind.example:443\r\n\r\n');
    const [chunk] = await once(client, 'data');
    assert.match(chunk.toString(), /^HTTP\/1\.1 200 Connection Established/);
    client.destroy();
  } finally {
    await proxy.close();
  }
  assert.equal(lookups, 1);
  assert.deepEqual(dialOptions, { host: '93.184.216.34', port: 443, family: 4 });
});

test('mixed public/private DNS answers fail closed before any dial', async () => {
  const lookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.8', family: 4 },
  ];
  await assert.rejects(
    createNetworkPolicy('https://mixed.example', { lookup }),
    NetworkPolicyError,
  );
});

test('image magic bytes override a misleading Content-Type', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
  const avif = Buffer.alloc(24);
  avif.writeUInt32BE(24, 0);
  avif.write('ftypmif1', 4, 'ascii');
  avif.write('avif', 16, 'ascii');
  assert.equal(detectImageMime(webp, 'image/png'), 'image/webp');
  assert.equal(detectImageMime(avif, 'image/png'), 'image/avif');
  assert.equal(detectImageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/webp'), 'image/png');

  const disguisedWebp = inspectImageDataUrl(`data:image/png;base64,${webp.toString('base64')}`);
  assert.equal(disguisedWebp.mime, 'image/webp');
  assert.equal(disguisedWebp.magicMime, 'image/webp');
  assert.match(disguisedWebp.dataUrl, /^data:image\/webp;base64,/);
  assert.equal(
    inspectImageDataUrl(`data:image/png;base64,${webp.toString('base64')}`, new Set(['image/png'])),
    null,
  );
});

test('page CSP remains enforced until the fixed local extractor is injected', () => {
  const navigationIndex = browserSource.indexOf('page.goto(options.url');
  const settleIndex = browserSource.indexOf('await wait(CAPTURE_LIMITS.settleMs');
  const bypassIndex = browserSource.indexOf('await page.setBypassCSP(true)');
  const injectionIndex = browserSource.indexOf('await page.addScriptTag({ path: DOM_TO_SPEC_PATH })');
  const restoreIndex = browserSource.indexOf('await page.setBypassCSP(false)');
  assert.ok(navigationIndex >= 0);
  assert.ok(navigationIndex < settleIndex);
  assert.ok(settleIndex < bypassIndex);
  assert.ok(bypassIndex < injectionIndex);
  assert.ok(injectionIndex < restoreIndex);
});

test('server exposes health and a validated import route with scoped CORS', async t => {
  let received;
  const server = createBridgeServer({
    token: TEST_TOKEN,
    capture: async options => {
      received = options;
      return {
        spec: { type: 'frame', name: 'Captured', width: options.width, children: [] },
        meta: { nodeCount: 1 },
      };
    },
  });
  t.after(() => closeForTest(server));
  const base = await listenForTest(server);

  const health = await fetch(`${base}/health`, { headers: { Origin: 'null' } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), 'null');
  const healthPayload = await health.json();
  assert.equal(healthPayload.name, BRIDGE_NAME);
  assert.equal(healthPayload.pairingRequired, true);
  assert.equal(JSON.stringify(healthPayload).includes(TEST_TOKEN), false);

  const preflight = await fetch(`${base}/import`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://www.figma.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-kodety-client',
      'Access-Control-Request-Private-Network': 'true',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://www.figma.com');
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Kodety-Bridge-Token/i);

  const imported = await fetch(`${base}/import`, {
    method: 'POST',
    headers: {
      Origin: 'https://www.figma.com',
      'Content-Type': 'application/json',
      'X-Kodety-Client': 'figma-plugin',
      'X-Kodety-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(validInput({ width: 768, colorScheme: 'light' })),
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.headers.get('access-control-allow-origin'), 'https://www.figma.com');
  const payload = await imported.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.spec.name, 'Captured');
  assert.equal(received.width, 768);
  assert.equal(received.colorScheme, 'light');

  const rejectedOrigin = await fetch(`${base}/import`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/json',
      'X-Kodety-Client': 'figma-plugin',
      'X-Kodety-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(validInput()),
  });
  assert.equal(rejectedOrigin.status, 403);
  assert.equal(rejectedOrigin.headers.get('access-control-allow-origin'), null);

  const missingClient = await fetch(`${base}/import`, {
    method: 'POST',
    headers: { Origin: 'null', 'Content-Type': 'application/json' },
    body: JSON.stringify(validInput()),
  });
  assert.equal(missingClient.status, 403);

  const missingToken = await fetch(`${base}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kodety-Client': 'figma-plugin' },
    body: JSON.stringify(validInput()),
  });
  assert.equal(missingToken.status, 401);
});

test('server enforces single-import concurrency', async t => {
  let releaseCapture;
  let captureStarted;
  const started = new Promise(resolve => { captureStarted = resolve; });
  const server = createBridgeServer({
    token: TEST_TOKEN,
    capture: async options => {
      captureStarted();
      return new Promise(resolve => {
        releaseCapture = () => resolve({
          spec: { type: 'frame', width: options.width, children: [] },
          meta: {},
        });
      });
    },
  });
  t.after(() => closeForTest(server));
  const base = await listenForTest(server);
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Kodety-Client': 'figma-plugin',
      'X-Kodety-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(validInput()),
  };

  const first = fetch(`${base}/import`, requestOptions);
  await started;
  const second = await fetch(`${base}/import`, requestOptions);
  assert.equal(second.status, 429);
  releaseCapture();
  assert.equal((await first).status, 200);
});

test('server timeout returns even when a renderer ignores cancellation', async t => {
  const server = createBridgeServer({
    token: TEST_TOKEN,
    importTimeoutMs: 1_000,
    capture: async () => new Promise(() => {}),
  });
  t.after(() => closeForTest(server));
  const base = await listenForTest(server);
  const response = await fetch(`${base}/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Kodety-Client': 'figma-plugin',
      'X-Kodety-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(validInput()),
  });
  assert.equal(response.status, 504);
});
