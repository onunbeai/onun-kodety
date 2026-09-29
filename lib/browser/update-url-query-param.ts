/**
 * Update a URL query parameter through the browser history API.
 * Safe to import in non-browser runtimes; calls become a no-op during SSR.
 */
export function updateUrlQueryParam(
  key: string,
  value: string | null | undefined,
): void {
  if (typeof window === 'undefined') return;

  const currentSearchParams = new URLSearchParams(window.location.search);
  const currentValue = currentSearchParams.get(key);

  // Only update if value actually changed
  if (value === currentValue) return;

  if (value) {
    currentSearchParams.set(key, value);
  } else {
    currentSearchParams.delete(key);
  }

  const query = currentSearchParams.toString();
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;

  // Use replaceState to avoid adding to history
  window.history.replaceState({ ...window.history.state }, '', newUrl);
}
