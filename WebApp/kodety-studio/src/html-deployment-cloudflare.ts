import { blake3 } from "@noble/hashes/blake3.js";
import { HtmlDeploymentError, HTML_DEPLOYMENT_LIMITS, validateDeploymentPath } from "./html-deployment-github";
import type { HtmlDirectReview } from "./html-deployment-direct";

export type HtmlCloudflareProject = Readonly<{ name: string; productionBranch: string }>;
export type HtmlCloudflareConfig = Readonly<{ accountId: string; project: HtmlCloudflareProject; branch: string }>;
export type HtmlCloudflareDeployment = Readonly<{ id: string; url: string; state: "READY" | "ERROR" | "CANCELED" | "BUILDING" | "QUEUED" }>;
type Fetcher = typeof fetch;
type Envelope<T> = { success: boolean; result: T; result_info?: { page?: number; total_pages?: number; total_count?: number; per_page?: number } };
const PROJECT = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const DEPLOYMENT = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const HASH = /^[a-f\d]{32}$/;
const ERROR_MESSAGES: Record<string, string> = {
  "cloudflare-token": "Enter a valid Cloudflare API token.",
  "cloudflare-permission": "The token needs Cloudflare Pages Edit permission for this account.",
  "cloudflare-config": "Check the Cloudflare account, project and branch.",
  "cloudflare-config-size": "Studio supports _headers and _redirects files up to 1 MiB each.",
  "cloudflare-network": "Could not connect to Cloudflare Pages.",
  "cloudflare-request": "Cloudflare Pages could not complete this request.",
  "cloudflare-uncertain": "The deployment response was interrupted. Check Cloudflare Pages before retrying.",
  "cloudflare-unavailable": "Direct Cloudflare publishing requires the Studio Node/Docker server. Use the ZIP upload on a static host.",
  "cloudflare-rate-limit": "Cloudflare is busy. Wait a moment before trying again.",
  "cloudflare-project-exists": "This Pages project name is already in use. Select it or choose another name.",
  "cloudflare-functions": "Direct publishing supports static sites. Use Wrangler for Pages Functions, _worker.js or _routes.json.",
};
function fail(code: string, message = ERROR_MESSAGES[code] || ERROR_MESSAGES["cloudflare-request"]): never { throw new HtmlDeploymentError(code, message); }
function account(value: string): string {
  const result = value.trim();
  if (!/^[a-f\d]{32}$/i.test(result)) fail("cloudflare-config");
  return result;
}
function branch(value: string): string {
  if (typeof value !== "string" || !value || value.length > 255 || /[\s\u0000-\u001f\u007f]/.test(value)) fail("cloudflare-config");
  return value;
}
function project(value: { name?: string; production_branch?: string }): HtmlCloudflareProject {
  if (typeof value?.name !== "string" || !PROJECT.test(value.name)) fail("cloudflare-request");
  return Object.freeze({ name: value.name, productionBranch: branch(value.production_branch || "main") });
}
function projectRoute(config: HtmlCloudflareConfig): string {
  if (!config.project || !PROJECT.test(config.project.name)) fail("cloudflare-config");
  branch(config.branch); branch(config.project.productionBranch);
  return `/accounts/${account(config.accountId)}/pages/projects/${config.project.name}`;
}
async function request<T>(route: string, token: string, fetcher: Fetcher, body?: unknown, creation = false): Promise<Envelope<T>> {
  const credential = token.trim();
  if (!credential || credential.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(credential)) fail("cloudflare-token");
  let response: Response;
  try {
    response = await fetcher("/__kodety_deploy__/cloudflare/request", {
      method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", "X-Kodety-Deploy": "1", Accept: "application/json" },
      body: JSON.stringify({ route, method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body }) }),
      credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(120_000),
    });
  } catch { fail(creation ? "cloudflare-uncertain" : "cloudflare-network"); }
  if (response.status === 404 || response.status === 405 || !response.headers.get("content-type")?.includes("application/json")) fail("cloudflare-unavailable");
  let data: Envelope<T> & { code?: string };
  try { data = await response.json(); } catch { fail(creation ? "cloudflare-uncertain" : "cloudflare-request"); }
  if (!response.ok || !data || data.success !== true) {
    if (data?.code && Object.hasOwn(ERROR_MESSAGES, data.code)) fail(data.code);
    fail(response.status === 401 ? "cloudflare-token" : response.status === 403 ? "cloudflare-permission" : response.status === 429 ? "cloudflare-rate-limit" : creation && response.status >= 500 ? "cloudflare-uncertain" : "cloudflare-request");
  }
  return data;
}

export async function listHtmlCloudflareProjects(token: string, accountId: string, page = 1, fetcher: Fetcher = fetch): Promise<{ items: HtmlCloudflareProject[]; next: number | null }> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) fail("cloudflare-config");
  const data = await request<Array<{ name: string; production_branch: string; source?: unknown }>>(`/accounts/${account(accountId)}/pages/projects?page=${page}&per_page=100`, token, fetcher);
  if (!Array.isArray(data.result) || data.result.length > 100) fail("cloudflare-request");
  const totalPages = data.result_info?.total_pages;
  const hasMore = typeof totalPages === "number" && Number.isSafeInteger(totalPages) ? totalPages > page : data.result.length === 100;
  return { items: data.result.map(project), next: hasMore && page < 10000 ? page + 1 : null };
}

export async function createHtmlCloudflareProject(token: string, accountId: string, name: string, productionBranch = "main", fetcher: Fetcher = fetch): Promise<HtmlCloudflareProject> {
  if (!PROJECT.test(name)) fail("cloudflare-config");
  const data = await request<{ name: string; production_branch: string }>(`/accounts/${account(accountId)}/pages/projects`, token, fetcher, { name, production_branch: branch(productionBranch) }, true);
  return project(data.result);
}

export function validateHtmlCloudflareReview(review: HtmlDirectReview): void {
  if (!review.files.length || review.files.length > HTML_DEPLOYMENT_LIMITS.files || review.bytes > HTML_DEPLOYMENT_LIMITS.totalBytes) fail("cloudflare-config", "This deployment exceeds Studio's file or total size limit.");
  let bytes = 0;
  const seen = new Set<string>();
  for (const file of review.files) {
    validateDeploymentPath(file.path);
    if (/^(?:functions(?:\/|$)|_worker(?:\.[^/]+)?(?:\/|$)|_routes\.json$)/i.test(file.path)) fail("cloudflare-functions");
    if (seen.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > HTML_DEPLOYMENT_LIMITS.fileBytes) fail("cloudflare-config");
    if (typeof file.base64 !== "string" || file.base64.length !== Math.ceil(file.size / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) fail("cloudflare-config");
    const padding = file.base64.endsWith("==") ? 2 : file.base64.endsWith("=") ? 1 : 0;
    if (file.base64.length / 4 * 3 - padding !== file.size) fail("cloudflare-config");
    if (["_headers", "_redirects"].includes(file.path) && file.size > 1024 * 1024) fail("cloudflare-config-size");
    bytes += file.size; seen.add(file.path);
  }
  if (bytes !== review.bytes || bytes > HTML_DEPLOYMENT_LIMITS.totalBytes || !seen.has("index.html")) fail("cloudflare-config");
}
const MIME_TYPES: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "application/javascript", mjs: "application/javascript", json: "application/json", webmanifest: "application/manifest+json", xml: "application/xml", txt: "text/plain", csv: "text/csv", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", wasm: "application/wasm", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", zip: "application/zip", map: "application/json",
};
function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1), dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}
function deployment(data: { id?: string; url?: string; latest_stage?: { name?: string; status?: string } }, creation = false): HtmlCloudflareDeployment {
  const code = creation ? "cloudflare-uncertain" : "cloudflare-request";
  if (!data || typeof data.id !== "string" || !DEPLOYMENT.test(data.id) || typeof data.url !== "string" || !/^https:\/\/[a-z\d](?:[a-z\d.-]*[a-z\d])?\.pages\.dev\/?$/i.test(data.url)) fail(code);
  const stage = data.latest_stage;
  const state = stage?.status === "failure" ? "ERROR" : ["canceled", "cancelled"].includes(stage?.status || "") ? "CANCELED" : stage?.name === "deploy" && stage.status === "success" ? "READY" : ["active", "success"].includes(stage?.status || "") ? "BUILDING" : stage?.status === "idle" ? "QUEUED" : null;
  if (!state) fail(code);
  return Object.freeze({ id: data.id, url: data.url, state });
}

/** Use Wrangler's BLAKE3(base64 + extension) asset keys and its multipart manifest protocol. */
export async function publishHtmlCloudflareDeployment(review: HtmlDirectReview, config: HtmlCloudflareConfig, token: string, fetcher: Fetcher = fetch, onProgress?: (done: number, total: number) => void): Promise<HtmlCloudflareDeployment> {
  const route = projectRoute(config);
  validateHtmlCloudflareReview(review);
  const files = review.files.filter(file => file.path !== "_headers" && file.path !== "_redirects");
  const assets = files.map(file => {
    const ext = extension(file.path);
    const digest = blake3(new TextEncoder().encode(file.base64 + ext));
    const key = Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
    return { file, key, metadata: { contentType: MIME_TYPES[ext.toLowerCase()] || "application/octet-stream" } };
  });
  const hashes = [...new Set(assets.map(asset => asset.key))];
  const upload = await request<{ jwt: string }>(`${route}/upload-token`, token, fetcher);
  if (typeof upload.result?.jwt !== "string" || !upload.result.jwt || upload.result.jwt.length > 4096) fail("cloudflare-request");
  const missing = await request<string[]>("/pages/assets/check-missing", upload.result.jwt, fetcher, { hashes });
  if (!Array.isArray(missing.result) || missing.result.some(hash => !HASH.test(hash) || !hashes.includes(hash))) fail("cloudflare-request");
  const missingSet = new Set(missing.result), uploaded = new Set<string>();
  let done = 0;
  onProgress?.(done, review.files.length);
  for (const asset of assets) {
    if (missingSet.has(asset.key) && !uploaded.has(asset.key)) {
      await request("/pages/assets/upload", upload.result.jwt, fetcher, [{ key: asset.key, value: asset.file.base64, metadata: asset.metadata, base64: true }]);
      uploaded.add(asset.key);
    }
    onProgress?.(++done, review.files.length);
  }
  await request("/pages/assets/upsert-hashes", upload.result.jwt, fetcher, { hashes });
  const manifest = Object.fromEntries(assets.map(asset => [`/${asset.file.path}`, asset.key]));
  const headers = review.files.find(file => file.path === "_headers"), redirects = review.files.find(file => file.path === "_redirects");
  const result = deployment((await request<Parameters<typeof deployment>[0]>(`${route}/deployments`, token, fetcher, { manifest, branch: config.branch, ...(headers ? { headers: headers.base64 } : {}), ...(redirects ? { redirects: redirects.base64 } : {}) }, true)).result, true);
  onProgress?.(review.files.length, review.files.length);
  return result;
}

export async function getHtmlCloudflareDeployment(id: string, config: HtmlCloudflareConfig, token: string, fetcher: Fetcher = fetch): Promise<HtmlCloudflareDeployment> {
  if (!DEPLOYMENT.test(id)) fail("cloudflare-config");
  return deployment((await request<Parameters<typeof deployment>[0]>(`${projectRoute(config)}/deployments/${id}`, token, fetcher)).result);
}
