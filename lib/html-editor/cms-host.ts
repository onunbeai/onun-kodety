import type { KodetyWordPressConfig } from './editor-types';

export type CmsHostConfig = Partial<KodetyWordPressConfig> & { cmsRuntime?: 'static' };
export interface CmsHost {
  baseUrl: string;
  getConfig(): CmsHostConfig;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

let active: CmsHost | undefined;

/** A scoped editor capability. WordPress continues using its existing config
 * and native fetch; this does not replace the browser's global transport. */
export function installCmsHost(host: CmsHost): () => void {
  if (active && active !== host) throw new Error('A CMS host is already installed.');
  active = host;
  return () => { if (active === host) active = undefined; };
}

export function cmsHostConfig<T extends object>(fallback?: T): (T & CmsHostConfig) | undefined {
  return active ? active.getConfig() as T & CmsHostConfig : fallback;
}

export async function cmsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const host = active;
  if (host) {
    const base = new URL(host.baseUrl, location.href);
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/'))) {
      const result = await host.fetch(input, init);
      if (active !== host) throw new DOMException('The project was closed.', 'AbortError');
      return result;
    }
  }
  return fetch(input, init);
}
