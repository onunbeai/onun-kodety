import type { HTTPMethod, PlaygroundClient } from '@wp-playground/client';
import type { KodetyStudioProject, StudioLanguage } from './storage';

export const STUDIO_PREVIEW_QUERY = 'kodety-preview';
export const STUDIO_PREVIEW_REQUEST_SOURCE = 'kodety-studio-preview-service-worker';
export const STUDIO_PREVIEW_RESPONSE_SOURCE = 'kodety-studio-preview-runtime';
const STUDIO_PREVIEW_CHANNEL_PREFIX = 'kodety-studio-preview';

type PreviewRequestMessage = {
  source: typeof STUDIO_PREVIEW_REQUEST_SOURCE;
  version: 1;
  type: 'request';
  requestId: string;
  projectId: string;
  url: string;
  method: HTTPMethod;
  headers: Record<string, string>;
  body?: ArrayBuffer;
};

const HTTP_METHODS = new Set<HTTPMethod>(['GET', 'POST', 'HEAD', 'OPTIONS', 'PATCH', 'PUT', 'DELETE']);
const runtimeCookiePromises = new WeakMap<PlaygroundClient, Promise<string>>();

function wordpressRuntimeCookie(client: PlaygroundClient): Promise<string> {
  const existing = runtimeCookiePromises.get(client);
  if (existing) return existing;
  const pending = client.run({
    code: `<?php
      require_once '/wordpress/wp-load.php';
      $administrator_ids = get_users([
        'role' => 'administrator',
        'number' => 1,
        'orderby' => 'ID',
        'order' => 'ASC',
        'fields' => 'ids',
      ]);
      $user_id = (int) ($administrator_ids[0] ?? 1);
      $expiration = time() + DAY_IN_SECONDS;
      $cookies = [
        LOGGED_IN_COOKIE . '=' . wp_generate_auth_cookie($user_id, $expiration, 'logged_in'),
        AUTH_COOKIE . '=' . wp_generate_auth_cookie($user_id, $expiration, 'auth'),
        SECURE_AUTH_COOKIE . '=' . wp_generate_auth_cookie($user_id, $expiration, 'secure_auth'),
      ];
      echo 'KODETY_PREVIEW_COOKIE:' . base64_encode(implode('; ', $cookies));
    `,
  }).then(result => {
    const output = new TextDecoder().decode(result.bytes);
    const encoded = output.match(/KODETY_PREVIEW_COOKIE:([A-Za-z0-9+/=]+)/)?.[1];
    if (result.exitCode !== 0 || !encoded) throw new Error('Could not create the local WordPress preview session.');
    return atob(encoded);
  }).catch(error => {
    runtimeCookiePromises.delete(client);
    throw error;
  });
  runtimeCookiePromises.set(client, pending);
  return pending;
}

function scopedPlaygroundSiteUrl(currentUrl: string, projectId: string): string {
  const explicitScope = currentUrl.match(/\/scope:[^/]+/)?.[0];
  const runtimeScope = `kodety-studio-${projectId.replace(/[^a-z0-9]/gi, '').slice(0, 28)}`;
  return `https://playground.wordpress.net${explicitScope || `/scope:${runtimeScope}`}/`;
}

export function studioSitePreviewUrl(
  project: Pick<KodetyStudioProject, 'id' | 'name'>,
  language: StudioLanguage,
): string | null {
  if (!['http:', 'https:'].includes(window.location.protocol)) return null;
  const url = new URL('./', window.location.href);
  url.searchParams.set(STUDIO_PREVIEW_QUERY, project.id);
  url.searchParams.set('name', project.name);
  url.searchParams.set('lang', language);
  return url.toString();
}

function isPreviewRequestMessage(value: unknown, projectId: string): value is PreviewRequestMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<PreviewRequestMessage>;
  return message.source === STUDIO_PREVIEW_REQUEST_SOURCE
    && message.version === 1
    && message.type === 'request'
    && message.projectId === projectId
    && typeof message.requestId === 'string'
    && typeof message.url === 'string'
    && message.url.startsWith('/')
    && !message.url.startsWith('//')
    && typeof message.method === 'string'
    && HTTP_METHODS.has(message.method as HTTPMethod)
    && !!message.headers
    && typeof message.headers === 'object';
}

export function studioPreviewChannelName(projectId: string): string {
  return `${STUDIO_PREVIEW_CHANNEL_PREFIX}:${projectId}`;
}

function postPreviewResponse(
  port: MessagePort | undefined,
  channel: BroadcastChannel | undefined,
  response: Record<string, unknown>,
  responseBody?: ArrayBuffer,
): void {
  if (port) {
    port.postMessage(response, responseBody ? [responseBody] : []);
    return;
  }
  channel?.postMessage(response);
}

export async function respondToStudioPreviewRequest(
  event: MessageEvent,
  client: PlaygroundClient,
  projectId: string,
  channel?: BroadcastChannel,
): Promise<boolean> {
  const port = event.ports[0];
  if ((!port && !channel) || !isPreviewRequestMessage(event.data, projectId)) return false;

  const message = event.data;
  try {
    const cookie = await wordpressRuntimeCookie(client);
    const response = await client.request({
      url: message.url,
      method: message.method,
      headers: { ...message.headers, cookie },
      body: message.body && message.body.byteLength > 0 ? new Uint8Array(message.body) : undefined,
    });
    const currentUrl = await client.getCurrentURL();
    const responseBody = response.bytes.slice().buffer as ArrayBuffer;
    postPreviewResponse(port, channel, {
      source: STUDIO_PREVIEW_RESPONSE_SOURCE,
      version: 1,
      type: 'response',
      requestId: message.requestId,
      ok: true,
      status: response.httpStatusCode,
      headers: response.headers,
      body: responseBody,
      siteBaseUrl: scopedPlaygroundSiteUrl(currentUrl, projectId),
    }, responseBody);
  } catch (error) {
    postPreviewResponse(port, channel, {
      source: STUDIO_PREVIEW_RESPONSE_SOURCE,
      version: 1,
      type: 'response',
      requestId: message.requestId,
      ok: false,
      message: error instanceof Error ? error.message : 'Local preview request failed.',
    });
  } finally {
    port?.close();
  }
  return true;
}
