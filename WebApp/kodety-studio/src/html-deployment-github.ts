/** Browser-only publishing. Credentials are passed per request and never stored. */
export type HtmlDeploymentFile = {
  path: string;
  content: Blob | string | Uint8Array;
};

export type HtmlDeploymentConfig = {
  owner: string;
  repository: string;
  branch: string;
  directory: string;
  provider: "github" | "vercel" | "cloudflare";
};

export type HtmlDeploymentSnapshotFile = Readonly<{ path: string; sha: string; base64: string; size: number }>;
type SnapshotFile = HtmlDeploymentSnapshotFile;
export type HtmlDeploymentReview = Readonly<{
  config: Readonly<HtmlDeploymentConfig>;
  head: string;
  files: readonly SnapshotFile[];
  manifest: SnapshotFile;
  additions: readonly string[];
  updates: readonly string[];
  deletions: readonly string[];
  unchanged: readonly string[];
  preserved: readonly string[];
  bytes: number;
}>;

type GitTreeEntry = { path: string; sha: string; mode: string; type: string };
type Fetcher = typeof fetch;
export const HTML_DEPLOYMENT_LIMITS = { files: 1000, fileBytes: 25 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 } as const;
const CONFIG_PREFIX = "kodetyStudioHtmlDeploymentV1:";
export const HTML_DEPLOYMENT_MANIFEST = ".kodety-deployment.json";
const MANIFEST_SOURCE = "kodety-studio-html";

export class HtmlDeploymentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "HtmlDeploymentError";
  }
}

function fail(code: string, message: string): never {
  throw new HtmlDeploymentError(code, message);
}

export function validateDeploymentPath(path: string): string {
  if (!path || path.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("invalid-path", `Invalid project path: ${path}`);
  }
  const parts = path.toLowerCase().split("/");
  if (parts.includes(HTML_DEPLOYMENT_MANIFEST)) fail("reserved-path", "The deployment manifest is maintained by Studio. Remove it from the site export.");
  if (/^(?:\.incode|\.coday)\/(?:project|template|publish-overlay)\.json$/i.test(path)) fail("private-path", `Private project metadata cannot be published: ${path}`);
  if (parts.some((part) => [".git", ".github", ".kodety", "node_modules", ".npmrc", ".pypirc"].includes(part) || part === ".env" || part.startsWith(".env.") || /^(id_rsa|id_ed25519)(\.|$)/.test(part) || /\.(pem|key|p12|pfx)$/.test(part))) {
    fail("private-path", `Private or internal files cannot be published: ${path}`);
  }
  return path;
}

export function validateDeploymentConfig(input: HtmlDeploymentConfig): HtmlDeploymentConfig {
  const owner = String(input.owner || "").trim();
  const repository = String(input.repository || "").trim();
  const branch = String(input.branch || "").trim();
  const directory = String(input.directory || "").trim();
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner)) fail("invalid-owner", "Enter the GitHub account or organization name.");
  if (!/^[a-z\d_.-]{1,100}$/i.test(repository) || /^(\.|\.\.)$/.test(repository) || repository.endsWith(".git")) fail("invalid-repository", "Enter a repository name, without a URL or .git suffix.");
  if (!branch || branch.length > 255 || branch === "@" || branch.startsWith("refs/") || /[\s\u0000-\u001f\u007f~^:?*\[\\]/.test(branch) || branch.includes("..") || branch.includes("@{") || branch.endsWith(".") || branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) fail("invalid-branch", "Enter an existing branch name, such as main.");
  if (directory) validateDeploymentPath(directory);
  return { owner, repository, branch, directory, provider: input.provider === "vercel" || input.provider === "cloudflare" ? input.provider : "github" };
}

export function loadDeploymentConfig(projectId: string, storage: Pick<Storage, "getItem">): HtmlDeploymentConfig {
  try {
    const saved = JSON.parse(storage.getItem(CONFIG_PREFIX + projectId) || "null");
    if (saved) return validateDeploymentConfig(saved);
  } catch { /* A missing or obsolete configuration opens an empty form. */ }
  return { owner: "", repository: "", branch: "main", directory: "", provider: "github" };
}

export function saveDeploymentConfig(projectId: string, config: HtmlDeploymentConfig, storage: Pick<Storage, "setItem">): void {
  // Serialize an explicit allowlist: extra properties (especially tokens) never persist.
  storage.setItem(CONFIG_PREFIX + projectId, JSON.stringify(validateDeploymentConfig(config)));
}

function tokenHeader(token: string): string {
  const value = token.trim();
  if (!value || /[\s\u0000-\u001f\u007f]/.test(value)) fail("missing-token", "Enter a GitHub access token with Contents read and write permission.");
  return `Bearer ${value}`;
}

async function githubRequest<T>(route: string, token: string, fetcher: Fetcher, body?: unknown): Promise<T> {
  // No arbitrary host, cookies, redirects, response messages, or request logging.
  const authorization = tokenHeader(token);
  let response: Response;
  try {
    response = await fetcher(`https://api.github.com${route}`, {
      method: body ? "POST" : "GET",
      headers: { Accept: "application/vnd.github+json", Authorization: authorization, "Content-Type": "application/json", "X-GitHub-Api-Version": "2026-03-10" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    fail(body ? "publish-uncertain" : "network", body ? "The GitHub response was interrupted. Check the repository and review again before publishing." : "Could not connect to GitHub. Check your connection and try again.");
  }
  if (!response.ok) {
    const readingBranch = !body && /^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\//.test(route);
    const code = response.status === 401 ? "authentication" : response.status === 403 ? "permission" : response.status === 409 && readingBranch ? "branch-history-unavailable" : response.status === 404 || response.status === 409 ? "missing-branch" : response.status === 422 ? body ? "rejected" : "invalid-github-query" : response.status === 429 ? "rate-limit" : "github";
    fail(code, `GitHub request failed (${response.status}).`);
  }
  try { return await response.json() as T; }
  catch { fail(body ? "publish-uncertain" : "github", "GitHub returned an unreadable response. Review the repository before trying again."); }
}

function repoRoute(config: HtmlDeploymentConfig): string {
  return `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}`;
}

export type HtmlGitHubAccount = { login: string; name: string };
export type HtmlGitHubRepository = { id: number; owner: string; name: string; fullName: string; defaultBranch: string; private: boolean };
export type HtmlGitHubPage<T> = { items: T[]; nextPage: number | null };

/** Identify the actual account authorized by the token, without retaining credentials. */
export async function connectHtmlGitHub(token: string, fetcher: Fetcher = fetch): Promise<HtmlGitHubAccount> {
  const user = await githubRequest<{ login: string; name?: string }>("/user", token, fetcher);
  if (typeof user.login !== "string" || !/^[a-z\d-]{1,39}$/i.test(user.login)) fail("github", "GitHub returned an invalid account.");
  return { login: user.login, name: typeof user.name === "string" ? user.name : user.login };
}

function pageNumber(page: number): number {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) fail("github", "Invalid GitHub page.");
  return page;
}

/** Page explicitly, so accounts with many repositories never silently lose choices. */
export async function listHtmlGitHubRepositories(token: string, page = 1, fetcher: Fetcher = fetch): Promise<HtmlGitHubPage<HtmlGitHubRepository>> {
  const repositories = await githubRequest<Array<{ id: number; name: string; owner: { login: string }; default_branch: string; private: boolean; archived: boolean; disabled?: boolean; permissions?: { push?: boolean } }>>(`/user/repos?per_page=100&page=${pageNumber(page)}&sort=updated&affiliation=owner,collaborator,organization_member`, token, fetcher);
  if (!Array.isArray(repositories)) fail("github", "GitHub returned an invalid repository list.");
  const items = repositories.filter(repository => repository.permissions?.push === true && !repository.archived && !repository.disabled).map(repository => {
    const validated = validateDeploymentConfig({ owner: repository.owner?.login, repository: repository.name, branch: repository.default_branch, directory: "", provider: "github" });
    if (!Number.isSafeInteger(repository.id) || repository.id < 1) fail("github", "GitHub returned an invalid repository.");
    return { id: repository.id, owner: validated.owner, name: validated.repository, fullName: `${validated.owner}/${validated.repository}`, defaultBranch: validated.branch, private: repository.private === true };
  });
  return { items, nextPage: repositories.length === 100 ? page + 1 : null };
}

export async function listHtmlGitHubBranches(config: HtmlDeploymentConfig, token: string, page = 1, fetcher: Fetcher = fetch): Promise<HtmlGitHubPage<string>> {
  const validated = validateDeploymentConfig(config);
  const branches = await githubRequest<Array<{ name: string }>>(`${repoRoute(validated)}/branches?per_page=100&page=${pageNumber(page)}`, token, fetcher);
  if (!Array.isArray(branches)) fail("github", "GitHub returned an invalid branch list.");
  return { items: branches.map(branch => validateDeploymentConfig({ ...validated, branch: branch.name }).branch), nextPage: branches.length === 100 ? page + 1 : null };
}

function gitOid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) fail("github", "GitHub returned an invalid Git object.");
  return value;
}

export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header);
  object.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", object);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function snapshotFile(path: string, bytes: Uint8Array): Promise<SnapshotFile> {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return Object.freeze({ path, sha: await gitBlobSha(bytes), base64: btoa(binary), size: bytes.length });
}

export async function snapshotDeploymentFiles(config: Pick<HtmlDeploymentConfig, "directory">, files: HtmlDeploymentFile[]): Promise<readonly SnapshotFile[]> {
  if (config.directory) validateDeploymentPath(config.directory);
  if (!files.length) fail("empty", "There are no site files to publish.");
  if (files.length > HTML_DEPLOYMENT_LIMITS.files) fail("too-large", "This browser publisher supports up to 1,000 files per project. Use Git for larger projects.");
  const seen = new Set<string>();
  const snapshot: SnapshotFile[] = [];
  let total = 0;
  for (const file of files) {
    const relativePath = validateDeploymentPath(file.path);
    const path = config.directory ? `${config.directory}/${relativePath}` : relativePath;
    if (seen.has(path)) fail("duplicate-path", `Repeated project path: ${path}`);
    seen.add(path);
    const content = file.content;
    const size = typeof content === "string" ? new TextEncoder().encode(content).length : content instanceof Uint8Array ? content.byteLength : content.size;
    total += size;
    if (size > HTML_DEPLOYMENT_LIMITS.fileBytes || total > HTML_DEPLOYMENT_LIMITS.totalBytes) fail("too-large", "This browser publisher supports files up to 25 MiB and projects up to 50 MiB. Use Git for larger projects.");
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content instanceof Uint8Array ? content.slice() : new Uint8Array(await content.arrayBuffer());
    snapshot.push(await snapshotFile(path, bytes));
  }
  for (const path of seen) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) if (seen.has(parts.slice(0, index).join("/"))) fail("path-conflict", `A file and directory share the same path: ${path}`);
  }
  return Object.freeze(snapshot.sort((left, right) => left.path.localeCompare(right.path)));
}

async function readOwnedFiles(config: HtmlDeploymentConfig, entry: GitTreeEntry | undefined, token: string, fetcher: Fetcher): Promise<Map<string, string>> {
  if (!entry) return new Map();
  if (entry.type !== "blob" || entry.mode !== "100644") fail("ownership-manifest", "The deployment manifest conflicts with a remote directory, link, or executable.");
  const object = await githubRequest<{ sha: string; content: string; encoding: string; size: number }>(`${repoRoute(config)}/git/blobs/${gitOid(entry.sha)}`, token, fetcher);
  if (object.encoding !== "base64" || typeof object.content !== "string" || object.content.length > 2 * 1024 * 1024) fail("ownership-manifest", "The deployment manifest cannot be verified.");
  try {
    const bytes = Uint8Array.from(atob(object.content.replace(/\s/g, "")), character => character.charCodeAt(0));
    if (object.sha !== entry.sha || await gitBlobSha(bytes) !== entry.sha) fail("ownership-manifest", "The deployment manifest Git hash does not match.");
    const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (document.version !== 1 || document.source !== MANIFEST_SOURCE || !Array.isArray(document.files) || document.files.length > HTML_DEPLOYMENT_LIMITS.files) fail("ownership-manifest", "Unrecognized deployment manifest.");
    const owned = new Map<string, string>();
    for (const file of document.files) {
      if (typeof file?.path !== "string") fail("ownership-manifest", "Invalid managed file.");
      const relative = validateDeploymentPath(file.path);
      const path = config.directory ? `${config.directory}/${relative}` : relative;
      if (owned.has(path)) fail("ownership-manifest", "Duplicate managed file.");
      owned.set(path, gitOid(file.sha));
    }
    return owned;
  } catch { fail("ownership-manifest", "The deployment manifest is invalid. Reconcile it with Git before publishing."); }
}

/** Saves are flushed by the caller. This operation only reads GitHub and freezes the reviewed files. */
export async function reviewHtmlDeployment(configInput: HtmlDeploymentConfig, sourceFiles: HtmlDeploymentFile[], token: string, fetcher: Fetcher = fetch): Promise<HtmlDeploymentReview> {
  const config = Object.freeze(validateDeploymentConfig(configInput));
  tokenHeader(token);
  const files = await snapshotDeploymentFiles(config, sourceFiles);
  const prefix = repoRoute(config);
  const ref = await githubRequest<{ object: { sha: string; type: string } }>(`${prefix}/git/ref/heads/${config.branch.split("/").map(encodeURIComponent).join("/")}`, token, fetcher);
  if (ref.object?.type !== "commit") fail("missing-branch", "Select an existing branch in a repository initialized with a README.");
  const head = gitOid(ref.object.sha);
  const commit = await githubRequest<{ tree: { sha: string } }>(`${prefix}/git/commits/${head}`, token, fetcher);
  const tree = await githubRequest<{ tree: GitTreeEntry[]; truncated: boolean }>(`${prefix}/git/trees/${gitOid(commit.tree?.sha)}?recursive=1`, token, fetcher);
  if (tree.truncated || !Array.isArray(tree.tree)) fail("truncated-tree", "The repository tree is too large to review completely. Use Git to publish this repository.");
  const remote = new Map(tree.tree.map((entry) => [entry.path, entry]));
  const manifestPath = config.directory ? `${config.directory}/${HTML_DEPLOYMENT_MANIFEST}` : HTML_DEPLOYMENT_MANIFEST;
  const owned = await readOwnedFiles(config, remote.get(manifestPath), token, fetcher);
  const publishedPaths = new Set(files.map((file) => file.path));
  const deletions: string[] = [];
  for (const [path, sha] of owned) {
    const existing = remote.get(path);
    // Only the exact regular blobs last published by Studio can be removed or
    // overwritten. Remote edits, replacements and deletions need reconciliation.
    if (existing && (existing.type !== "blob" || existing.mode !== "100644" || existing.sha !== sha) || !existing && publishedPaths.has(path)) fail("owned-remote-changed", `A managed file changed on GitHub since the last publication: ${path}`);
    if (existing && !publishedPaths.has(path)) deletions.push(path);
  }
  const manifest = await snapshotFile(manifestPath, new TextEncoder().encode(JSON.stringify({
    version: 1,
    source: MANIFEST_SOURCE,
    files: files.map(file => ({ path: config.directory ? file.path.slice(config.directory.length + 1) : file.path, sha: file.sha })),
  }, null, 2) + "\n"));
  const additions: string[] = [], updates: string[] = [], unchanged: string[] = [];
  for (const file of [...files, manifest]) {
    const existing = remote.get(file.path);
    if (existing && (existing.type !== "blob" || existing.mode !== "100644")) fail("path-conflict", `The remote path is a directory, executable, symlink, or submodule: ${file.path}`);
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const parent = remote.get(parts.slice(0, index).join("/"));
      if (parent && parent.type !== "tree") fail("path-conflict", `A remote file blocks the project directory: ${file.path}`);
    }
    if (!existing) additions.push(file.path);
    else if (existing.sha === file.sha) unchanged.push(file.path);
    else updates.push(file.path);
  }
  const removedPaths = new Set(deletions);
  const preserved = tree.tree.filter((entry) => entry.type !== "tree" && entry.path !== manifestPath && !publishedPaths.has(entry.path) && !removedPaths.has(entry.path) && (!config.directory || entry.path.startsWith(`${config.directory}/`))).map((entry) => entry.path).sort();
  return Object.freeze({ config, head, files, manifest, additions: Object.freeze(additions), updates: Object.freeze(updates), deletions: Object.freeze(deletions.sort()), unchanged: Object.freeze(unchanged), preserved: Object.freeze(preserved), bytes: files.reduce((total, file) => total + file.size, manifest.size) });
}

export async function assertDeploymentFilesUnchanged(review: HtmlDeploymentReview, files: HtmlDeploymentFile[]): Promise<void> {
  const current = await snapshotDeploymentFiles(review.config, files);
  if (current.length !== review.files.length || current.some((file, index) => file.path !== review.files[index].path || file.sha !== review.files[index].sha)) fail("local-changed", "The project changed after review. Review the latest files before publishing.");
}

/** One atomic commit. expectedHeadOid rejects concurrent pushes, including resets. */
export async function publishHtmlDeployment(review: HtmlDeploymentReview, token: string, message: string, fetcher: Fetcher = fetch): Promise<{ sha: string; url: string }> {
  if (!message.trim() || message.trim().length > 200) fail("invalid-message", "Enter a commit message with 1 to 200 characters.");
  if (!review.additions.length && !review.updates.length && !review.deletions.length) fail("unchanged", "The reviewed files are already on GitHub.");
  const changed = new Set([...review.additions, ...review.updates]);
  const result = await githubRequest<{ data?: { createCommitOnBranch?: { commit?: { oid: string } } }; errors?: { type?: string }[] }>("/graphql", token, fetcher, {
    query: "mutation PublishKodetyHtml($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
    variables: { input: { branch: { repositoryNameWithOwner: `${review.config.owner}/${review.config.repository}`, branchName: review.config.branch }, expectedHeadOid: review.head, message: { headline: message.trim() }, fileChanges: { additions: [...review.files, review.manifest].filter((file) => changed.has(file.path)).map((file) => ({ path: file.path, contents: file.base64 })), deletions: review.deletions.map(path => ({ path })) } } },
  });
  if (result.errors?.length) {
    if (result.errors.some((error) => error.type === "STALE_DATA")) fail("remote-changed", "The branch changed after review. Review the latest GitHub version before publishing.");
    if (result.errors.some((error) => error.type === "UNAUTHORIZED")) fail("authentication", "GitHub did not accept the account credentials.");
    if (result.errors.some((error) => error.type === "FORBIDDEN")) fail("permission", "GitHub denied access to create the commit.");
    if (result.errors.some((error) => error.type === "NOT_FOUND")) fail("missing-branch", "GitHub could not find an accessible repository or branch.");
    if (result.errors.some((error) => error.type === "RATE_LIMITED")) fail("rate-limit", "The GitHub API rate limit was reached.");
    fail("rejected", "GitHub could not create the commit. The response does not identify a supported cause.");
  }
  const sha = gitOid(result.data?.createCommitOnBranch?.commit?.oid);
  return { sha, url: `https://github.com/${encodeURIComponent(review.config.owner)}/${encodeURIComponent(review.config.repository)}/commit/${sha}` };
}
