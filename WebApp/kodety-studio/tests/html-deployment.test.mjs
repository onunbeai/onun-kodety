import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const scratch = await mkdtemp(path.join(tmpdir(), "kodety-html-deployment-"));
await build({ entryPoints: [fileURLToPath(new URL("../src/html-deployment-github.ts", import.meta.url))], outfile: path.join(scratch, "deployment.mjs"), platform: "node", format: "esm", bundle: true, logLevel: "silent" });
const { assertDeploymentFilesUnchanged, gitBlobSha, loadDeploymentConfig, publishHtmlDeployment, reviewHtmlDeployment, saveDeploymentConfig, validateDeploymentConfig, validateDeploymentPath } = await import(pathToFileURL(path.join(scratch, "deployment.mjs")).href);
after(() => rm(scratch, { recursive: true, force: true }));

const config = { owner: "owner", repository: "website", branch: "release/site", directory: "public", provider: "vercel" };
const head = "a".repeat(40), treeSha = "b".repeat(40), newHead = "c".repeat(40);
const sha = (text) => { const bytes = Buffer.from(text); return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); };
const entry = (path, text = "remote", mode = "100644", type = "blob") => ({ path, sha: sha(text), mode, type });
const manifest = files => JSON.stringify({ version: 1, source: "kodety-studio-html", files: Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, sha: sha(content) })) }, null, 2) + "\n";
function fixture({ tree = [], truncated = false, status = 200, mutationError, fetchError = false, manifestText, manifestContent = manifestText } = {}) {
  const calls = [];
  if (manifestText !== undefined) tree = [...tree, entry("public/.kodety-deployment.json", manifestText)];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    if (fetchError) throw new Error("Sensitive injected transport details");
    if (status !== 200) return new Response(JSON.stringify({ message: "Sensitive injected token or body" }), { status });
    let body;
    if (url.endsWith("/git/ref/heads/release/site")) body = { object: { type: "commit", sha: head } };
    else if (url.endsWith(`/git/commits/${head}`)) body = { tree: { sha: treeSha } };
    else if (url.endsWith(`/git/trees/${treeSha}?recursive=1`)) body = { tree, truncated };
    else if (manifestText !== undefined && url.endsWith(`/git/blobs/${sha(manifestText)}`)) body = { content: Buffer.from(manifestContent).toString("base64"), encoding: "base64", sha: sha(manifestText), size: Buffer.byteLength(manifestContent) };
    else if (url === "https://api.github.com/graphql") body = mutationError ? { data: null, errors: [{ type: mutationError, message: "Do not surface raw errors" }] } : { data: { createCommitOnBranch: { commit: { oid: newHead } } } };
    else throw new Error(`Unexpected route ${url}`);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetcher };
}

test("validates repository, branches, traversal and sensitive paths before requests", async () => {
  for (const path of ["../index.html", "/index.html", "assets//app.js", "a/../b", "a\\b", ".env", ".git/config", "x/.env.production", ".kodety/project.json", ".github/workflows/deploy.yml", "keys/server.pem"]) assert.throws(() => validateDeploymentPath(path));
  for (const branch of ["refs/heads/main", "../main", "main..old", "x.lock", "x@{y", "foo?bar", "a//b"]) assert.throws(() => validateDeploymentConfig({ ...config, branch }));
  assert.equal(validateDeploymentPath("assets/My photo.svg"), "assets/My photo.svg");
  assert.throws(() => validateDeploymentConfig({ ...config, owner: "attacker.example/path" }));
  const f = fixture();
  await assert.rejects(reviewHtmlDeployment(config, [{ path: ".env", content: "secret" }], "token", f.fetcher), { code: "private-path" });
  assert.equal(f.calls.length, 0);
});

test("token and unknown config fields are never persisted", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  saveDeploymentConfig("project", { ...config, token: "secret", auth: "secret" }, storage);
  assert.deepEqual(loadDeploymentConfig("project", storage), config);
  assert.equal([...data.values()].some((value) => /secret|token|auth/.test(value)), false);
  assert.equal(loadDeploymentConfig("another-project", storage).owner, "");
  assert.equal(loadDeploymentConfig("project", { getItem() { throw new Error("blocked"); } }).branch, "main");
});

test("read-only review computes Git blob SHA correctly for UTF-8 and binary, preserves remote-only files", async () => {
  const bytes = Uint8Array.from([0, 255, 128, 13, 10]);
  assert.equal(await gitBlobSha(new TextEncoder().encode("Olá mundo")), sha("Olá mundo"));
  const f = fixture({ tree: [entry("public/index.html", "old"), entry("public/style.css", "same"), entry("public/old.html"), entry("README.md")] });
  const review = await reviewHtmlDeployment(config, [{ path: "index.html", content: "Olá" }, { path: "style.css", content: "same" }, { path: "assets/photo.png", content: bytes }], "test-token", f.fetcher);
  assert.deepEqual(review.additions, ["public/assets/photo.png", "public/.kodety-deployment.json"]);
  assert.deepEqual(review.updates, ["public/index.html"]);
  assert.deepEqual(review.unchanged, ["public/style.css"]);
  assert.deepEqual(review.preserved, ["public/old.html"]);
  assert.equal(review.head, head);
  assert.equal(f.calls.every((call) => call.method === "GET"), true);
  assert.equal(f.calls.every((call) => call.credentials === "omit" && call.redirect === "error" && call.cache === "no-store" && call.headers.Authorization === "Bearer test-token"), true);
  assert.equal(JSON.stringify(review).includes("test-token"), false);
  bytes[0] = 88;
  assert.equal(Buffer.from(review.files.find((file) => file.path.endsWith(".png")).base64, "base64")[0], 0);
  assert.throws(() => { review.config.owner = "other"; });
});

test("publish creates exactly one atomic commit pinned to the reviewed head, without deleting or touching unchanged files", async () => {
  const f = fixture({ tree: [entry("public/index.html", "old"), entry("public/style.css", "same"), entry("public/old.html")] });
  const files = [{ path: "index.html", content: "new" }, { path: "style.css", content: "same" }];
  const review = await reviewHtmlDeployment(config, files, "test-token", f.fetcher);
  await assertDeploymentFilesUnchanged(review, files);
  const result = await publishHtmlDeployment(review, "test-token", " Publish site ", f.fetcher);
  const writes = f.calls.filter((call) => call.method === "POST");
  assert.equal(writes.length, 1);
  const input = writes[0].body.variables.input;
  assert.equal(input.expectedHeadOid, head);
  assert.deepEqual(input.branch, { repositoryNameWithOwner: "owner/website", branchName: "release/site" });
  assert.deepEqual(input.fileChanges, { additions: [{ path: "public/index.html", contents: Buffer.from("new").toString("base64") }, { path: "public/.kodety-deployment.json", contents: Buffer.from(manifest({ "index.html": "new", "style.css": "same" })).toString("base64") }], deletions: [] });
  assert.deepEqual(result, { sha: newHead, url: `https://github.com/owner/website/commit/${newHead}` });
});

test("remote concurrent changes reject publication with no retry or force", async () => {
  const f = fixture({ mutationError: "STALE_DATA" });
  const review = await reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher);
  await assert.rejects(publishHtmlDeployment(review, "token", "Publish", f.fetcher), { code: "remote-changed" });
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});

test("local edits, additions and removals after review require a fresh review", async () => {
  const f = fixture();
  const original = [{ path: "index.html", content: "new" }];
  const review = await reviewHtmlDeployment(config, original, "token", f.fetcher);
  for (const files of [[{ path: "index.html", content: "edited" }], [...original, { path: "extra.js", content: "" }], [{ path: "renamed.html", content: "new" }]]) await assert.rejects(assertDeploymentFilesUnchanged(review, files), { code: "local-changed" });
});

test("truncated trees and file/directory, symlink, executable and submodule conflicts stop before mutation", async () => {
  for (const tree of [[entry("public", "", "100644")], [entry("public/index.html", "", "040000", "tree")], [entry("public/index.html", "", "120000")], [entry("public/index.html", "", "100755")], [entry("public", "", "160000", "commit")]]) {
    const f = fixture({ tree });
    await assert.rejects(reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher), { code: "path-conflict" });
    assert.equal(f.calls.some((call) => call.method !== "GET"), false);
  }
  const f = fixture({ truncated: true });
  await assert.rejects(reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher), { code: "truncated-tree" });
});

test("empty and duplicate exports fail without requests; no-op review cannot create commits", async () => {
  const f = fixture({ tree: [entry("public/index.html", "same")], manifestText: manifest({ "index.html": "same" }) });
  await assert.rejects(reviewHtmlDeployment(config, [], "token", f.fetcher), { code: "empty" });
  await assert.rejects(reviewHtmlDeployment(config, [{ path: "a", content: "" }, { path: "a", content: "" }], "token", f.fetcher), { code: "duplicate-path" });
  await assert.rejects(reviewHtmlDeployment(config, [{ path: "a", content: "" }, { path: "a/b", content: "" }], "token", f.fetcher), { code: "path-conflict" });
  assert.equal(f.calls.length, 0);
  const review = await reviewHtmlDeployment(config, [{ path: "index.html", content: "same" }], "token", f.fetcher);
  await assert.rejects(publishHtmlDeployment(review, "token", "Publish", f.fetcher), { code: "unchanged" });
  assert.equal(f.calls.some((call) => call.method === "POST"), false);
});

test("removing a locale deletes only its previously published exact blobs in the reviewed atomic commit", async () => {
  const f = fixture({
    tree: [entry("public/index.html", "same"), entry("public/es/index.html", "Hola"), entry("public/es/about/index.html", "Nosotros"), entry("public/author-only.html", "Unrelated"), entry("README.md", "Documentation")],
    manifestText: manifest({ "index.html": "same", "es/index.html": "Hola", "es/about/index.html": "Nosotros" }),
  });
  const review = await reviewHtmlDeployment(config, [{ path: "index.html", content: "same" }], "token", f.fetcher);
  assert.deepEqual(review.deletions, ["public/es/about/index.html", "public/es/index.html"]);
  assert.deepEqual(review.preserved, ["public/author-only.html"]);
  assert.deepEqual(review.updates, ["public/.kodety-deployment.json"]);
  assert.equal(f.calls.every(call => call.method === "GET"), true);
  await publishHtmlDeployment(review, "token", "Remove Spanish locale", f.fetcher);
  const writes = f.calls.filter(call => call.method === "POST");
  assert.equal(writes.length, 1);
  const input = writes[0].body.variables.input;
  assert.equal(input.expectedHeadOid, head);
  assert.deepEqual(input.fileChanges.deletions, [{ path: "public/es/about/index.html" }, { path: "public/es/index.html" }]);
  assert.deepEqual(JSON.parse(Buffer.from(input.fileChanges.additions[0].contents, "base64").toString()), JSON.parse(manifest({ "index.html": "same" })));
});

test("remote changes to owned files block both overwriting and deletion before any mutation", async () => {
  for (const changed of [entry("public/es/index.html", "Edited on GitHub"), entry("public/es/index.html", "Hola", "120000"), entry("public/es/index.html", "Hola", "100755"), entry("public/es/index.html", "Hola", "040000", "tree")]) {
    for (const include of [false, true]) {
      const f = fixture({ tree: [entry("public/index.html", "same"), changed], manifestText: manifest({ "index.html": "same", "es/index.html": "Hola" }) });
      const files = [{ path: "index.html", content: "same" }, ...(include ? [{ path: "es/index.html", content: "Local update" }] : [])];
      await assert.rejects(reviewHtmlDeployment(config, files, "token", f.fetcher), { code: "owned-remote-changed" });
      assert.equal(f.calls.some(call => call.method === "POST"), false);
    }
  }
  const missing = fixture({ tree: [], manifestText: manifest({ "index.html": "old" }) });
  await assert.rejects(reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", missing.fetcher), { code: "owned-remote-changed" });
});

test("ownership metadata cannot delete paths outside the selected folder or private files", async () => {
  for (const text of ["author's existing file", manifest({ "../README.md": "Documentation" }), manifest({ ".github/workflows/test.yml": "Workflow" }), manifest({ ".kodety-deployment.json": "recursive" }), JSON.stringify({ version: 1, source: "other-application", files: [] })]) {
    const f = fixture({ tree: [entry("README.md", "Documentation")], manifestText: text });
    await assert.rejects(reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher), { code: "ownership-manifest" });
    assert.equal(f.calls.some(call => call.method === "POST"), false);
  }
  const f = fixture({ manifestText: manifest({ "old.html": "old" }), manifestContent: manifest({ "other.html": "other" }) });
  await assert.rejects(reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher), { code: "ownership-manifest" });
  await assert.rejects(reviewHtmlDeployment(config, [{ path: ".kodety-deployment.json", content: "fake" }], "token", fixture().fetcher), { code: "reserved-path" });
});

test("a branch change after deletion review cannot delete files or force a retry", async () => {
  const f = fixture({ tree: [entry("public/old.html", "old")], manifestText: manifest({ "old.html": "old" }), mutationError: "STALE_DATA" });
  const review = await reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher);
  assert.deepEqual(review.deletions, ["public/old.html"]);
  await assert.rejects(publishHtmlDeployment(review, "token", "Remove page", f.fetcher), { code: "remote-changed" });
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("permission/network errors do not echo response data or token, and uncertain publish is not retried", async () => {
  for (const status of [401, 403, 404, 409, 422, 429, 500]) {
    const f = fixture({ status });
    await assert.rejects(reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token-secret", f.fetcher), (error) => !/Sensitive|secret/.test(error.message));
  }
  const f = fixture();
  const review = await reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher);
  const broken = fixture({ fetchError: true });
  await assert.rejects(publishHtmlDeployment(review, "token-secret", "Publish", broken.fetcher), { code: "publish-uncertain" });
  assert.equal(broken.calls.length, 1);
});

test("branch-history conflicts and invalid read queries do not claim a commit was rejected", async () => {
  for (const [status, code] of [[409, "branch-history-unavailable"], [422, "invalid-github-query"], [404, "missing-branch"]]) {
    const f = fixture({ status });
    await assert.rejects(reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher), { code });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, "GET");
  }
});

test("known GraphQL rejection types preserve their cause without exposing raw messages or retrying", async () => {
  for (const [type, code] of [["FORBIDDEN", "permission"], ["UNAUTHORIZED", "authentication"], ["NOT_FOUND", "missing-branch"], ["RATE_LIMITED", "rate-limit"], ["UNPROCESSABLE", "rejected"]]) {
    const f = fixture({ mutationError: type });
    const review = await reviewHtmlDeployment(config, [{ path: "index.html", content: "new" }], "token", f.fetcher);
    await assert.rejects(publishHtmlDeployment(review, "token", "Publish", f.fetcher), error => error.code === code && !/Do not surface/.test(error.message));
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  }
});
