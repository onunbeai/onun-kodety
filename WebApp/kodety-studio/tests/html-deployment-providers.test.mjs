import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import JSZip from "jszip";

const scratch = await mkdtemp(path.join(tmpdir(), "kodety-deployment-providers-"));
const require = createRequire(import.meta.url);
const modules = {};
for (const name of ["github", "direct", "auth"]) {
  const outfile = path.join(scratch, `${name}.cjs`);
  await build({ entryPoints: [fileURLToPath(new URL(`../src/html-deployment-${name}.ts`, import.meta.url))], outfile, platform: "node", format: "cjs", bundle: true, logLevel: "silent" });
  modules[name] = require(outfile);
}
after(() => rm(scratch, { recursive: true, force: true }));
const github = modules.github, direct = modules.direct, auth = modules.auth;
const source = [{ path: "index.html", content: "<h1>Olá</h1>" }, { path: "assets/logo.png", content: Uint8Array.from([0, 255, 127, 64]) }];
const config = { project: { id: "prj_website", name: "website" }, teamId: "team_example", target: "preview" };
const body = value => new Response(JSON.stringify(value), { status: 200 });

test("GitHub account discovery lists writable repositories, preserves pagination and fetches selected branches", async () => {
  const calls = [];
  const repository = { id: 1, name: "website", owner: { login: "org" }, default_branch: "release/site", permissions: { push: true }, private: true };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/user")) return body({ login: "person", name: "A Person", access_token: "never-return" });
    if (url.includes("/user/repos")) return body([repository, { ...repository, id: 2, archived: true }, ...Array.from({ length: 98 }, (_, index) => ({ ...repository, id: index + 3, permissions: { push: false } }))]);
    return body([{ name: "release/site" }, { name: "main" }]);
  };
  assert.deepEqual(await github.connectHtmlGitHub("token", fetcher), { login: "person", name: "A Person" });
  const page = await github.listHtmlGitHubRepositories("token", 2, fetcher);
  assert.deepEqual(page, { items: [{ id: 1, owner: "org", name: "website", fullName: "org/website", defaultBranch: "release/site", private: true }], nextPage: 3 });
  const branches = await github.listHtmlGitHubBranches({ owner: "org", repository: "website", branch: "release/site", directory: "", provider: "github" }, "token", 1, fetcher);
  assert.deepEqual(branches, { items: ["release/site", "main"], nextPage: null });
  assert.match(calls[1].url, /page=2&sort=updated/);
  assert.equal(calls.every(call => call.options.method === "GET" && call.options.credentials === "omit" && call.options.redirect === "error"), true);
  await assert.rejects(github.listHtmlGitHubRepositories("token", -1, fetcher));
  await assert.rejects(github.connectHtmlGitHub("token", async () => body({ login: "evil/path" })));
});

test("Vercel lists paginated projects for the selected team without exposing credentials in results", async () => {
  let called;
  const result = await direct.listHtmlVercelProjects("private-token", "team_example", 123, async (url, options) => {
    called = { url, options };
    return body({ projects: [{ id: "prj_website", name: "website", accessToken: "ignored" }], pagination: { next: 122 } });
  });
  assert.deepEqual(result, { items: [config.project], next: 122 });
  assert.equal(called.url, "https://api.vercel.com/v9/projects?limit=100&teamId=team_example&until=123");
  assert.equal(called.options.headers.Authorization, "Bearer private-token");
  assert.equal(called.options.credentials, "omit");
  await assert.rejects(direct.listHtmlVercelProjects("token", "team?outside=1", null, async () => { throw Error("must not fetch"); }), { code: "vercel-config" });
});

test("direct review freezes exact bytes, blocks private exports and detects edits before upload", async () => {
  const files = [{ path: "index.html", content: "<h1>Site</h1>" }, { path: "photo.bin", content: Uint8Array.from([7, 8]) }];
  const review = await direct.reviewHtmlDirectDeployment(files);
  assert.equal(Object.isFrozen(review.files), true);
  files[1].content[0] = 9;
  assert.deepEqual([...Buffer.from(review.files.find(file => file.path === "photo.bin").base64, "base64")], [7, 8]);
  await assert.rejects(direct.assertHtmlDirectFilesUnchanged(review, files), { code: "local-changed" });
  await assert.rejects(direct.reviewHtmlDirectDeployment([{ path: ".env", content: "secret" }]), { code: "private-path" });
  await assert.rejects(direct.reviewHtmlDirectDeployment([{ path: "nested/index.html", content: "Site" }]), { code: "direct-index" });
});

test("Vercel uploads raw binary SHA1 then creates exactly one preview deployment with all reviewed files", async () => {
  const calls = [];
  const review = await direct.reviewHtmlDirectDeployment(source);
  const result = await direct.publishHtmlVercelDeployment(review, config, "secret", async (url, options) => {
    calls.push({ url, options });
    return url.includes("/v2/files") ? new Response(null, { status: 200 }) : body({ id: "dpl_created", url: "website-123.vercel.app", readyState: "QUEUED" });
  });
  assert.deepEqual(result, { id: "dpl_created", url: "https://website-123.vercel.app", state: "QUEUED" });
  assert.equal(calls.length, source.length + 1);
  const uploads = calls.slice(0, -1);
  for (const [index, call] of uploads.entries()) {
    assert.equal(call.options.headers["x-vercel-digest"], createHash("sha1").update(call.options.body).digest("hex"));
    assert.equal(call.options.headers["Content-Type"], "application/octet-stream");
    assert.equal(call.options.body.length, review.files[index].size);
  }
  const create = JSON.parse(calls.at(-1).options.body);
  assert.equal(create.project, "prj_website");
  assert.equal(create.target, undefined, "preview is the default; production is never inferred");
  assert.equal(create.files.length, source.length);
  assert.deepEqual(create.projectSettings, { framework: null, buildCommand: "", installCommand: "", outputDirectory: ".", rootDirectory: null });
  assert.equal(calls.every(call => call.options.redirect === "error" && call.options.credentials === "omit" && call.options.cache === "no-store"), true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("Vercel production is explicit and deployment status is verified independently", async () => {
  const review = await direct.reviewHtmlDirectDeployment(source);
  let target;
  await direct.publishHtmlVercelDeployment(review, { ...config, target: "production" }, "token", async (url, options) => {
    if (url.includes("/v2/files")) return new Response(null, { status: 200 });
    target = JSON.parse(options.body).target;
    return body({ id: "dpl_created", url: "website.vercel.app", readyState: "BUILDING" });
  });
  assert.equal(target, "production");
  const result = await direct.getHtmlVercelDeployment("dpl_created", "token", "team_example", async (url, options) => {
    assert.equal(url, "https://api.vercel.com/v13/deployments/dpl_created?teamId=team_example");
    assert.equal(options.method, "GET");
    return body({ id: "dpl_created", url: "website.vercel.app", readyState: "ERROR", errorMessage: "sensitive" });
  });
  assert.equal(result.state, "ERROR");
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
});

test("upload failure never creates a deployment; uncertain creation is not retried and unsafe result URLs are rejected", async () => {
  const review = await direct.reviewHtmlDirectDeployment(source);
  let calls = 0;
  await assert.rejects(direct.publishHtmlVercelDeployment(review, config, "token", async () => { calls++; throw new Error("token-secret"); }), { code: "vercel-network" });
  assert.equal(calls, 1);
  let creations = 0;
  await assert.rejects(direct.publishHtmlVercelDeployment(review, config, "token", async url => {
    if (url.includes("/v2/files")) return new Response(null, { status: 200 });
    creations++; throw Error("upstream secret");
  }), error => error.code === "vercel-uncertain" && !error.message.includes("secret"));
  assert.equal(creations, 1);
  await assert.rejects(direct.getHtmlVercelDeployment("dpl_created", "token", "", async () => body({ id: "dpl_created", url: "evil.vercel.app@example.org", readyState: "READY" })), { code: "vercel-request" });
});

test("Cloudflare upload ZIP preserves reviewed site paths and binary bytes and refuses uncompiled functions", async () => {
  const review = await direct.reviewHtmlDirectDeployment(source);
  const blob = await direct.createHtmlCloudflareUpload(review);
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.deepEqual(Object.values(archive.files).filter(file => !file.dir).map(file => file.name).sort(), source.map(file => file.path).sort());
  assert.equal(await archive.file("index.html").async("string"), source[0].content);
  assert.deepEqual(await archive.file("assets/logo.png").async("uint8array"), source[1].content);
  await assert.rejects(direct.createHtmlCloudflareUpload(await direct.reviewHtmlDirectDeployment([...source, { path: "functions/api.js", content: "export function onRequest() {}" }])), { code: "cloudflare-functions" });
});

test("GitHub device login uses the configured same-origin broker and validates sign-in responses", async () => {
  const calls = [];
  const session = { sessionId: "local-session", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", interval: 5, expiresAt: Date.now() + 600_000 };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/config")) return body({ available: true });
    if (url.endsWith("/start")) return body(session);
    if (url.endsWith("/poll")) return body({ status: "complete", accessToken: "session-token" });
    return body({ status: "canceled" });
  };
  assert.equal(await auth.htmlGitHubLoginAvailable(undefined, fetcher), true);
  assert.deepEqual(await auth.startHtmlGitHubLogin(undefined, fetcher), session);
  assert.deepEqual(await auth.pollHtmlGitHubLogin(session.sessionId, undefined, fetcher), { status: "complete", accessToken: "session-token" });
  await auth.cancelHtmlGitHubLogin(session.sessionId, fetcher);
  assert.equal(calls.every(call => call.url.startsWith("/__kodety_deploy__/github/") && call.options.credentials === "same-origin" && call.options.redirect === "error" && call.options.headers["X-Kodety-Deploy"] === "1"), true);
  assert.equal(calls.some(call => call.options.body?.includes("session-token")), false);
  assert.equal(await auth.htmlGitHubLoginAvailable(undefined, async () => new Response("<html>Static site</html>")), false);
  await assert.rejects(auth.startHtmlGitHubLogin(undefined, async () => body({ ...session, verificationUri: "https://github.example/login" })), { code: "github-login" });
  await assert.rejects(auth.pollHtmlGitHubLogin("session", undefined, async () => new Response(null, { status: 410 })), { code: "github-login-expired" });
});
