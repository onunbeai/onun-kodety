import { HtmlDeploymentError, snapshotDeploymentFiles, type HtmlDeploymentFile, type HtmlDeploymentSnapshotFile } from "./html-deployment-github";

export type HtmlVercelProject = Readonly<{ id: string; name: string }>;
export type HtmlVercelConfig = Readonly<{ project: HtmlVercelProject; teamId: string; target: "preview" | "production" }>;
export type HtmlDirectReview = Readonly<{ files: readonly HtmlDeploymentSnapshotFile[]; bytes: number }>;
export type HtmlVercelDeployment = Readonly<{ id: string; url: string; state: string }>;
type Fetcher = typeof fetch;
function fail(code: string, message: string): never { throw new HtmlDeploymentError(code, message); }

function teamQuery(teamId: string): string {
  const value = teamId.trim();
  if (value && !/^[a-z\d_-]{1,100}$/i.test(value)) fail("vercel-config", "Invalid Vercel team ID.");
  return value ? `teamId=${encodeURIComponent(value)}` : "";
}

function projectConfig(config: HtmlVercelConfig): HtmlVercelConfig {
  if (!/^prj_[a-z\d_-]+$/i.test(config.project.id) || !/^[a-z\d][a-z\d._-]{0,99}$/i.test(config.project.name) || !["preview", "production"].includes(config.target)) fail("vercel-config", "Select a Vercel project and deployment environment.");
  teamQuery(config.teamId);
  return config;
}

async function vercelRequest(route: string, token: string, fetcher: Fetcher, options: { body?: BodyInit; digest?: string; creation?: boolean } = {}): Promise<Response> {
  const value = token.trim();
  if (!value || /[\s\u0000-\u001f\u007f]/.test(value)) fail("vercel-token", "Enter a Vercel access token.");
  let response: Response;
  try {
    response = await fetcher(`https://api.vercel.com${route}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${value}`, Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": options.digest ? "application/octet-stream" : "application/json" }), ...(options.digest ? { "x-vercel-digest": options.digest } : {}) },
      body: options.body, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(90_000),
    });
  } catch { fail(options.creation ? "vercel-uncertain" : "vercel-network", options.creation ? "The deployment response was interrupted. Check Vercel before retrying." : "Could not connect to Vercel."); }
  if (!response.ok) fail(response.status === 401 ? "vercel-token" : response.status === 403 ? "vercel-permission" : options.creation && response.status >= 500 ? "vercel-uncertain" : "vercel-request", `Vercel request failed (${response.status}).`);
  return response;
}

async function json<T>(response: Response, creation = false): Promise<T> {
  try { return await response.json() as T; }
  catch { fail(creation ? "vercel-uncertain" : "vercel-request", "Vercel returned an unreadable response."); }
}

export async function listHtmlVercelProjects(token: string, teamId = "", until: number | null = null, fetcher: Fetcher = fetch): Promise<{ items: HtmlVercelProject[]; next: number | null }> {
  if (until !== null && (!Number.isSafeInteger(until) || until < 0)) fail("vercel-config", "Invalid Vercel page.");
  const response = await json<{ projects: Array<{ id: string; name: string }>; pagination?: { next?: number | null } }>(await vercelRequest(`/v9/projects?limit=100&${teamQuery(teamId)}${until === null ? "" : `&until=${until}`}`, token, fetcher));
  if (!Array.isArray(response.projects)) fail("vercel-request", "Vercel returned an invalid project list.");
  const items = response.projects.map(project => {
    projectConfig({ project, teamId, target: "preview" });
    return Object.freeze({ id: project.id, name: project.name });
  });
  const next = response.pagination?.next;
  return { items, next: typeof next === "number" && Number.isSafeInteger(next) && next >= 0 && next !== until ? next : null };
}

export async function reviewHtmlDirectDeployment(files: HtmlDeploymentFile[]): Promise<HtmlDirectReview> {
  const snapshot = await snapshotDeploymentFiles({ directory: "" }, files);
  if (!snapshot.some(file => file.path === "index.html")) fail("direct-index", "A static deployment needs index.html at the site root.");
  return Object.freeze({ files: snapshot, bytes: snapshot.reduce((total, file) => total + file.size, 0) });
}

export async function assertHtmlDirectFilesUnchanged(review: HtmlDirectReview, files: HtmlDeploymentFile[]): Promise<void> {
  const current = await reviewHtmlDirectDeployment(files);
  if (current.files.length !== review.files.length || current.files.some((file, index) => file.path !== review.files[index].path || file.sha !== review.files[index].sha)) fail("local-changed", "The project changed after review.");
}

function deploymentResult(data: { id?: string; url?: string; readyState?: string; status?: string }, creation = false): HtmlVercelDeployment {
  if (typeof data.id !== "string" || !/^dpl_[a-z\d_-]+$/i.test(data.id) || typeof data.url !== "string" || !/^[a-z\d][a-z\d.-]*\.vercel\.app$/i.test(data.url)) fail(creation ? "vercel-uncertain" : "vercel-request", "Vercel returned an invalid deployment.");
  const state = data.readyState || data.status;
  if (typeof state !== "string" || !["QUEUED", "INITIALIZING", "BUILDING", "READY", "ERROR", "CANCELED"].includes(state)) fail(creation ? "vercel-uncertain" : "vercel-request", "Vercel returned an invalid deployment state.");
  return Object.freeze({ id: data.id, url: `https://${data.url}`, state });
}

/** Upload exact reviewed static files, then issue a single deployment creation request. */
export async function publishHtmlVercelDeployment(review: HtmlDirectReview, input: HtmlVercelConfig, token: string, fetcher: Fetcher = fetch, onProgress?: (done: number, total: number) => void): Promise<HtmlVercelDeployment> {
  const config = projectConfig(input);
  const query = teamQuery(config.teamId);
  const files: { file: string; sha: string; size: number }[] = [];
  for (const file of review.files) {
    const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
    // Vercel expects SHA-1 of raw file bytes, unlike Git's header-prefixed blob hash.
    const digest = await crypto.subtle.digest("SHA-1", bytes);
    const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    await vercelRequest(`/v2/files?${query}`, token, fetcher, { body: bytes, digest: sha });
    files.push({ file: file.path, sha, size: file.size });
    onProgress?.(files.length, review.files.length);
  }
  const body = JSON.stringify({ name: config.project.name, project: config.project.id, files, ...(config.target === "production" ? { target: "production" } : {}), projectSettings: { framework: null, buildCommand: "", installCommand: "", outputDirectory: ".", rootDirectory: null } });
  return deploymentResult(await json(await vercelRequest(`/v13/deployments?${query}`, token, fetcher, { body, creation: true }), true), true);
}

export async function getHtmlVercelDeployment(id: string, token: string, teamId = "", fetcher: Fetcher = fetch): Promise<HtmlVercelDeployment> {
  if (!/^dpl_[a-z\d_-]+$/i.test(id)) fail("vercel-config", "Invalid Vercel deployment.");
  return deploymentResult(await json(await vercelRequest(`/v13/deployments/${encodeURIComponent(id)}?${teamQuery(teamId)}`, token, fetcher)));
}

/** Cloudflare's dashboard accepts this archive. Creating it does not deploy a site. */
export async function createHtmlCloudflareUpload(review: HtmlDirectReview): Promise<Blob> {
  if (review.files.some(file => file.path.startsWith("functions/"))) fail("cloudflare-functions", "Cloudflare dashboard uploads cannot compile Pages Functions. Use Git integration for this site.");
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of review.files) zip.file(file.path, file.base64, { base64: true });
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } });
}
