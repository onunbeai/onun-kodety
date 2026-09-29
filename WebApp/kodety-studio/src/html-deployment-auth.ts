import { HtmlDeploymentError } from "./html-deployment-github";

export type HtmlGitHubAuthSession = { sessionId: string; userCode: string; verificationUri: string; interval: number; expiresAt: number };
type Fetcher = typeof fetch;

async function request<T>(action: string, body?: unknown, signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<T> {
  const response = await fetcher(`/__kodety_deploy__/github/${action}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Kodety-Deploy": "1" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", redirect: "error", cache: "no-store", signal });
  if (!response.ok) throw new HtmlDeploymentError(response.status === 410 ? "github-login-expired" : "github-login", "GitHub sign-in could not be completed.");
  return response.json() as Promise<T>;
}

export async function htmlGitHubLoginAvailable(signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<boolean> {
  try { return (await request<{ available: boolean }>("config", undefined, signal, fetcher)).available === true; }
  catch { return false; }
}

export async function startHtmlGitHubLogin(signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<HtmlGitHubAuthSession> {
  const session = await request<HtmlGitHubAuthSession>("start", {}, signal, fetcher);
  if (typeof session.sessionId !== "string" || !session.sessionId || typeof session.userCode !== "string" || !session.userCode || session.verificationUri !== "https://github.com/login/device" || !Number.isFinite(session.interval) || session.interval < 1 || !Number.isFinite(session.expiresAt)) throw new HtmlDeploymentError("github-login", "GitHub returned an invalid sign-in session.");
  return session;
}

export async function pollHtmlGitHubLogin(sessionId: string, signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<{ status: "pending" | "slow_down"; interval?: number } | { status: "complete"; accessToken: string }> {
  const result = await request<{ status: string; interval?: number; accessToken?: string }>("poll", { sessionId }, signal, fetcher);
  if (result.status === "complete" && typeof result.accessToken === "string" && result.accessToken) return { status: "complete", accessToken: result.accessToken };
  if (result.status === "pending" || result.status === "slow_down") return { status: result.status, interval: Number.isFinite(result.interval) && Number(result.interval) >= 1 ? result.interval : undefined };
  throw new HtmlDeploymentError("github-login", "GitHub returned an invalid sign-in response.");
}

export async function cancelHtmlGitHubLogin(sessionId: string, fetcher: Fetcher = fetch): Promise<void> {
  try { await request("cancel", { sessionId }, undefined, fetcher); } catch { /* Session expiry also clears an abandoned login. */ }
}
