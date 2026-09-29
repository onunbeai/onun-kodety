export type ProjectRoute = { id: string; source: 'cloud' | 'local' };
export const LOGIN_PROJECT_KEY = 'kodetyStudioCloudOpenProject';
const validId = (value: string) => /^[a-z0-9_-]{1,160}$/i.test(value);

/** Query routes keep the shell asset base and the project's license site stable. */
export function readProjectRoute(value: string): ProjectRoute | null {
  const url = new URL(value);
  const id = url.searchParams.get('project');
  const source = url.searchParams.get('source');
  if (!id || !validId(id) || (source !== null && source !== 'local' && source !== 'cloud')) return null;
  return { id, source: source === 'local' ? 'local' : 'cloud' };
}

/** A saved destination applies only to the actual login callback, never an
 * unrelated library visit after an abandoned or expired login. */
export function restoredProjectRoute(value: string, savedHint: string | null): ProjectRoute | null {
  const url = new URL(value);
  if (url.searchParams.has('project')) return readProjectRoute(value);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (!savedHint || (!hash.has('studio_ticket') && !hash.has('studio_state'))) return null;
  if (validId(savedHint)) return { id: savedHint, source: 'cloud' }; // Older Studio login hints.
  try {
    const route = JSON.parse(savedHint);
    return route && typeof route.id === 'string' && validId(route.id) && ['local', 'cloud'].includes(route.source)
      ? { id: route.id, source: route.source } : null;
  } catch { return null; }
}

export function rememberProjectRouteForLogin(value: string, storage: Pick<Storage, 'setItem' | 'removeItem'>): void {
  const route = readProjectRoute(value);
  if (route) storage.setItem(LOGIN_PROJECT_KEY, JSON.stringify(route));
  else storage.removeItem(LOGIN_PROJECT_KEY);
}

function shellUrl(value: string): URL {
  const url = new URL(value);
  for (const key of ['project', 'source', 'section', 'action', 'collection', 'view', 'item', 'kodety-preview', 'kodety-html-preview', 'kodety-preview-review']) url.searchParams.delete(key);
  url.hash = '';
  return url;
}

export function projectRouteUrl(value: string, route: ProjectRoute): string {
  if (!validId(route.id)) throw new Error('Invalid project identifier.');
  const url = shellUrl(value);
  url.searchParams.set('project', route.id);
  if (route.source === 'local') url.searchParams.set('source', 'local');
  return url.href;
}

export function libraryRouteUrl(value: string, view = 'projects'): string {
  const url = shellUrl(value);
  url.hash = view;
  return url.href;
}

export function wordpressProjectRouteUrl(value: string, id: string): string {
  if (!validId(id)) throw new Error('Invalid project identifier.');
  const url = new URL('./project-storage.html', value);
  url.searchParams.set('project', id);
  url.searchParams.set('action', 'open');
  return url.href;
}
