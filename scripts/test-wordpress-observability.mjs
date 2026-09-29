import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wordpressEntrySource = await readFile(
  path.join(root, "Wordpress/editor/main.tsx"),
  "utf8",
);
assert.match(wordpressEntrySource, /observedRequest\?\.retry\(\)/);
assert.match(wordpressEntrySource, /observedRequest\?\.settle\(response\)/);
assert.doesNotMatch(
  wordpressEntrySource,
  /observedRequest\?\.finish\(response\.status\)/,
  "the fetch wrapper must not finish a network span at response headers",
);
assert.match(wordpressEntrySource, /html-editor-buffer-visuals-ready/);
assert.match(wordpressEntrySource, /frame\.contentWindow === event\.source/);
const server = await createServer({
  root,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const observabilityModule = await server.ssrLoadModule(
    "/Wordpress/editor/wordpress-observability.ts",
  );
  const {
    createWordPressObservability,
    initializeWordPressObservability,
    isKodetyOperationId,
    sanitizeWordPressObservabilityFields,
    wordpressObservability,
  } = observabilityModule;

  let disabledAccesses = 0;
  const hostile = new Proxy(
    {},
    {
      get() {
        disabledAccesses += 1;
        throw new Error("disabled observability touched a runtime dependency");
      },
    },
  );
  const disabled = createWordPressObservability(null, hostile, hostile);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.begin("surface"), null);
  assert.equal(
    disabled.startRequest("https://secret.example/project", "GET"),
    null,
  );
  disabled.finish(null, { nonce: "never-read" });
  assert.deepEqual(disabled.entries(), []);
  assert.equal(
    disabledAccesses,
    0,
    "debug-off must return before endpoint, crypto, performance, console or storage access",
  );

  for (let index = 0; index < 10_000; index += 1) disabled.begin("surface");
  const disabledBenchmarkStartedAt = process.hrtime.bigint();
  for (let index = 0; index < 250_000; index += 1) disabled.begin("surface");
  const disabledBenchmarkMs =
    Number(process.hrtime.bigint() - disabledBenchmarkStartedAt) / 1e6;
  assert.ok(
    disabledBenchmarkMs < 250,
    `debug-off no-op path exceeded its broad 250 ms/250k budget (${disabledBenchmarkMs.toFixed(2)} ms)`,
  );

  const traceId = "trace-1234567890abcdef1234567890abcdef";
  const requestOperationId = `obs-${"b".repeat(32)}`;
  const calls = [];
  const snapshots = [];
  let clock = 0;
  const environment = {
    performance: {
      now: () => {
        clock += 2.5;
        return clock;
      },
      mark: (name) => calls.push(["mark", name]),
      measure: (name, start, end) => calls.push(["measure", name, start, end]),
      clearMarks: (name) => calls.push(["clearMarks", name]),
      clearMeasures: (name) => calls.push(["clearMeasures", name]),
    },
    crypto: {
      randomUUID: () => "12345678-1234-1234-1234-123456789abc",
    },
    exposeEntries: (entries) => snapshots.push(entries.slice()),
  };
  const endpoints = {
    projectSurfaceUrl: "https://kodety.test/wp-json/kodety/v1/project/surface",
    projectSurfaceAssetUrl:
      "https://kodety.test/wp-json/kodety/v1/project/surface/asset",
    projectUrl: "https://kodety.test/wp-json/kodety/v1/project",
    projectChunkUrl: "https://kodety.test/wp-json/kodety/v1/project/chunk",
    projectDeltaUrl: "https://kodety.test/wp-json/kodety/v1/project/delta",
    projectDownloadUrl:
      "https://kodety.test/wp-admin/admin-post.php?action=kodety_download_editor_project&_wpnonce=private",
    publishUrl: "https://kodety.test/wp-json/kodety/v1/publish",
  };
  const enabled = initializeWordPressObservability(
    { enabled: true, traceId },
    endpoints,
    environment,
  );
  assert.equal(enabled.enabled, true);
  assert.equal(
    wordpressObservability(),
    enabled,
    "lazy surfaces must share the initialized module-local observer",
  );

  const requestCases = [
    [
      "/wp-json/kodety/v1/project/surface?surface=settings&revision=7",
      "GET",
      null,
      "surface",
    ],
    [
      "/wp-json/kodety/v1/project/surface/asset?path=private",
      "GET",
      null,
      "asset",
    ],
    ["/wp-json/kodety/v1/project", "GET", null, "project_download"],
    ["/wp-json/kodety/v1/project", "POST", null, "save"],
    ["/wp-json/kodety/v1/project/chunk", "POST", null, "save"],
    ["/wp-json/kodety/v1/project/delta", "POST", null, "save"],
    [
      "/wp-json/kodety/v1/publish?optimizations=private",
      "POST",
      requestOperationId,
      "publish",
    ],
    [
      "/wp-admin/admin-post.php?action=kodety_download_editor_project&_wpnonce=never-log",
      "GET",
      null,
      "project_download",
    ],
  ];
  for (const [
    requestPath,
    method,
    requestedId,
    expectedOperation,
  ] of requestCases) {
    const observed = enabled.startRequest(
      new URL(requestPath, "https://kodety.test").href,
      method,
      requestedId,
    );
    assert.ok(
      observed,
      `configured endpoint must be observed: ${expectedOperation}`,
    );
    if (requestedId) assert.equal(observed.operationId, requestedId);
    observed.finish(expectedOperation === "surface" ? 304 : 200);
    // A nonce refresh or caller retry that reuses this logical observer must
    // never close or emit the same span twice.
    observed.finish(200);
  }
  assert.equal(enabled.entries().length, requestCases.length);
  assert.deepEqual(
    enabled.entries().map((entry) => entry.operation),
    requestCases.map(([, , , operation]) => operation),
  );
  assert.equal(enabled.entries()[0].result, "not_modified");
  assert.equal(enabled.entries()[0].revision, 7);
  assert.equal(enabled.entries()[0].cache, "hit");
  assert.equal(enabled.entries()[0].fallback, "none");
  assert.ok(
    enabled.entries().slice(1).every((entry) => entry.cache === "miss"),
    "successful network requests must expose cache misses explicitly",
  );
  assert.ok(
    enabled.entries().every((entry) => entry.fallback === "none"),
    "requests without a fallback must expose the closed none state",
  );
  assert.ok(
    calls.some((call) => call[0] === "measure" && call[1] === "kodety:surface"),
  );

  const streamedRequest = enabled.startRequest(
    "https://kodety.test/wp-json/kodety/v1/project/surface",
    "GET",
  );
  assert.ok(streamedRequest);
  streamedRequest.retry();
  let releaseStream;
  const streamedBody = new ReadableStream({
    start(controller) {
      releaseStream = () => {
        controller.enqueue(new TextEncoder().encode("surface-body"));
        controller.close();
      };
    },
  });
  const entriesBeforeStream = enabled.entries().length;
  const streamedSettlement = streamedRequest.settle(new Response(streamedBody, {
    status: 200,
    headers: { "X-Kodety-Operation-Id": streamedRequest.operationId },
  }));
  await Promise.resolve();
  assert.equal(
    enabled.entries().length,
    entriesBeforeStream,
    "the request span must remain open until the response body completes",
  );
  releaseStream();
  await streamedSettlement;
  const streamedEntry = enabled.entries().at(-1);
  assert.equal(streamedEntry.result, "ok");
  assert.equal(streamedEntry.attempt, 2);
  assert.equal(streamedEntry.bytes, 12);
  assert.equal(streamedEntry.cache, "miss");
  assert.equal(streamedEntry.fallback, "none");

  const uncorrelatedRequest = enabled.startRequest(
    "https://kodety.test/wp-json/kodety/v1/project/surface",
    "GET",
  );
  assert.ok(uncorrelatedRequest);
  await uncorrelatedRequest.settle(new Response(null, { status: 204 }));
  assert.equal(enabled.entries().at(-1).result, "correlation_error");

  const invalidCandidate =
    "Bearer secret@example.com https://private.test/project?token=abc";
  const invalidRequest = enabled.startRequest(
    "https://kodety.test/wp-json/kodety/v1/project/surface",
    "GET",
    invalidCandidate,
  );
  assert.ok(invalidRequest);
  assert.notEqual(invalidRequest.operationId, invalidCandidate);
  assert.ok(isKodetyOperationId(invalidRequest.operationId));
  invalidRequest.fail();
  for (const encodedSecret of [
    "obs-c2VjcmV0LXRva2VuLXByb2R1Y3Rpb24",
    "obs-12345678-1234-1234-1234-123456789abc",
    `obs-${"A".repeat(32)}`,
    "publish-12345678-1234-1234-1234-123456789abc",
  ]) {
    assert.equal(isKodetyOperationId(encodedSecret), false);
  }

  const redacted = sanitizeWordPressObservabilityFields({
    result: "https://private.test/?token=secret",
    status: 204,
    revision: 7,
    bytes: 1024,
    attempt: 2,
    cache: "hit",
    fallback: "full_project",
    transport: "surface",
    nonce: "nonce-secret",
    token: "token-secret",
    url: "https://private.test",
    path: "/Users/private/project",
    digest: "a".repeat(64),
    message: "customer@example.com",
    html: "<main>private project</main>",
  });
  assert.deepEqual(redacted, {
    status: 204,
    revision: 7,
    bytes: 1024,
    attempt: 2,
    cache: "hit",
    fallback: "full_project",
    transport: "surface",
  });
  const serializedEntries = JSON.stringify(enabled.entries());
  for (const secret of [
    "nonce-secret",
    "token-secret",
    "private.test",
    "/Users/private",
    "customer@example.com",
    "<main>",
    "_wpnonce",
  ]) {
    assert.equal(
      serializedEntries.includes(secret),
      false,
      `redacted entries leaked ${secret}`,
    );
  }

  // unzip/parse are intentionally exposed as closed-schema local spans. Their
  // project import call sites are wired separately because this helper must not
  // inspect archive contents, file names or arbitrary parser errors.
  for (const operation of ["unzip", "parse"]) {
    const span = enabled.begin(operation, {
      bytes: 4096,
      path: "/private/project.zip",
      message: "private parser error",
    });
    enabled.finish(span, { result: "ok" });
  }
  assert.deepEqual(
    enabled
      .entries()
      .slice(-2)
      .map((entry) => entry.operation),
    ["unzip", "parse"],
  );
  assert.equal(
    JSON.stringify(enabled.entries()).includes("/private/project.zip"),
    false,
  );

  const countBeforeForgedSpan = enabled.entries().length;
  enabled.finish(
    {
      operation: "surface",
      operationId: requestOperationId,
      startedAt: 0,
      startMark: `kodety:surface:${requestOperationId}:start`,
      fields: { message: "private parser error" },
    },
    { result: "ok" },
  );
  assert.equal(
    enabled.entries().length,
    countBeforeForgedSpan,
    "forged or mutated span tokens must be rejected before Performance API access",
  );

  const unrelated = enabled.startRequest(
    "https://kodety.test/wp-json/wp/v2/users",
    "GET",
  );
  assert.equal(unrelated, null, "non-allowlisted routes must not be observed");
  assert.ok(
    snapshots.length > 0,
    "enabled mode must expose its bounded local ring",
  );

  const capped = createWordPressObservability(
    { enabled: true, traceId },
    {},
    environment,
  );
  for (let index = 0; index < 205; index += 1) {
    const span = capped.begin("bootstrap", { attempt: index });
    capped.finish(span, { result: "ok" });
  }
  assert.equal(
    capped.entries().length,
    200,
    "the local debug ring must stay bounded",
  );

  console.log(
    `WordPress observability browser contracts passed (debug-off 250k calls: ${disabledBenchmarkMs.toFixed(2)} ms).`,
  );
} finally {
  await server.close();
}
