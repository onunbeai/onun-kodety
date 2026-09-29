/** Review tabs and the focused inline preview are visitor surfaces, even
 * when the host keeps the Builder and its guide in the same document. */
export function builderOnboardingPreviewActive(
  search = typeof window === 'undefined' ? '' : window.location.search,
  ownerDocument: Pick<Document, 'querySelector'> | undefined = typeof document === 'undefined' ? undefined : document,
): boolean {
  return new URLSearchParams(search).get('kodety-preview-review') === '1'
    || Boolean(ownerDocument?.querySelector('[data-previewing="true"]'));
}

/** Observe the shared editor's existing preview marker rather than changing
 * preview navigation or coupling either host to a second preview state. */
export function subscribeBuilderOnboardingPreview(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-previewing'],
  });
  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
  };
}
