/** Accept only the current Playground frame or one of its nested frames. */
export function isProjectRuntimeMessageSource(source: MessageEventSource | null, frame: Window | null): boolean {
  if (!source || !frame) return false;
  try {
    let current = source as Window;
    for (let depth = 0; depth < 8; depth += 1) {
      if (current === frame) return true;
      const parent = current.parent;
      if (!parent || parent === current) return false;
      current = parent;
    }
  } catch {
    // A detached WindowProxy or a MessagePort cannot establish this boundary.
  }
  return false;
}
