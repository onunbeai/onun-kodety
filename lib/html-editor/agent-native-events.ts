/** UI subscribers must not import the native transport just to observe a
 * completed operation; the transport is loaded only when an Agent calls it. */
export const AGENT_NATIVE_CHANGED_EVENT = 'kodety-native-operation-completed';

/** Retain fields edited locally since the last acknowledged settings value.
 * Secrets are held separately by the settings form. */
export function mergeAgentNativeSettings<T extends object>(base: T, draft: T, remote: T): T {
  const next = { ...remote };
  for (const key of Object.keys(draft) as Array<keyof T>) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(base[key])) next[key] = draft[key];
  }
  return next;
}
