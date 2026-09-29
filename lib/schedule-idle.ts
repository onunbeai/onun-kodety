/**
 * Schedule a callback to run when the browser is idle, so it does not block
 * the current interaction. The returned function cancels pending work, which
 * lets high-frequency editor updates replace stale background tasks instead of
 * executing every intermediate snapshot.
 */
export function scheduleIdle(callback: () => void, timeout = 1000): () => void {
  if (typeof window === 'undefined') {
    callback();
    return () => undefined;
  }
  const idleWindow = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const ric = idleWindow.requestIdleCallback;
  if (typeof ric === 'function') {
    const handle = ric(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}
