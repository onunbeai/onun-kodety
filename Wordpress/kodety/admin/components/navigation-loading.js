/* A visual bridge for ordinary document navigation. WordPress owns the request. */
export function navigationLayout(destination, adminUrl) {
  const url = new URL(destination, adminUrl);
  const admin = new URL(adminUrl);
  if (url.origin !== admin.origin || !url.pathname.startsWith(admin.pathname)) return null;
  if (['_wpnonce', 'action', 'action2', 'download', 'export', 'noheader'].some(key => url.searchParams.has(key))) return null;
  const screen = url.pathname.slice(admin.pathname.length);
  if (screen === '' || screen === 'index.php') return 'dashboard';
  if (/^(edit|edit-comments|users|plugins|edit-tags|link-manager|sites)\.php$/.test(screen)) return 'list';
  if (/^(themes|theme-install|plugin-install|upload)\.php$/.test(screen)) return 'cards';
  if (/^(profile|user-new|user-edit|options-[a-z-]+|update-core|tools|import|export|site-health|export-personal-data|erase-personal-data)\.php$/.test(screen)) return 'settings';
  if (screen !== 'admin.php') return null;
  const page = url.searchParams.get('page') || '';
  // Embedded editor workspaces, redirects and third-party plugin pages own their loading UI.
  if (['kodety', 'kodety-project-settings', 'kodety-updates', 'kodety-license', 'kodety-manual'].includes(page)) return 'settings';
  if (['kodety-media', 'kodety-templates'].includes(page)) return 'cards';
  if (['kodety-emails', 'kodety-email-campaigns', 'kodety-members'].includes(page)) return 'list';
  return null;
}

export function mountNavigationLoading({ config, signal, uiText }) {
  const root = document.documentElement;
  const skeleton = document.querySelector('#kodety-navigation-loading');
  const content = document.querySelector('#wpbody-content');
  if (!skeleton || !content || config.nativePluginSurface) return;
  const status = document.querySelector('#kodety-navigation-status');
  let watchdog;
  const clear = () => {
    window.clearTimeout(watchdog);
    root.classList.remove('kodety-admin-navigating');
    content.removeAttribute('aria-busy');
    if (status) status.textContent = '';
  };
  const begin = layout => {
    clear();
    skeleton.dataset.layout = layout;
    root.classList.remove('kodety-admin-entering');
    root.classList.add('kodety-admin-navigating');
    content.setAttribute('aria-busy', 'true');
    if (status) status.textContent = uiText('Carregando painel…', 'Loading dashboard…');
    // A canceled beforeunload dialog or interrupted request must never strand the page.
    watchdog = window.setTimeout(clear, 8000);
  };
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')
      || link.matches('[aria-disabled="true"], .thickbox') || link.closest('[contenteditable="true"]')) return;
    const url = new URL(link.href);
    const current = new URL(window.location.href);
    // Local tabs and anchors are already immediate and must retain their own handlers.
    if (url.pathname === current.pathname && url.search === current.search) return;
    const layout = navigationLayout(url.href, config.adminUrl);
    if (!layout) return;
    // Observe the final event result, including handlers registered by WP or another plugin.
    window.setTimeout(() => { if (!signal.aborted && !event.defaultPrevented) begin(layout); }, 0);
  }, { signal });
  window.addEventListener('pageshow', clear, { signal });
  window.addEventListener('pagehide', clear, { signal });
  window.addEventListener('beforeunload', event => {
    window.setTimeout(() => { if (event.defaultPrevented || event.returnValue) clear(); }, 0);
  }, { signal });
  signal.addEventListener('abort', clear, { once: true });
}
