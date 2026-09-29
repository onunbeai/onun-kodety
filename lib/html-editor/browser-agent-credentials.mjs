const PROVIDER = 'openai-codex';
const copy = value => value ? JSON.parse(JSON.stringify(value)) : undefined;

/** Only the subscription OAuth record crosses the private storage channel. */
export function browserAgentCredential(value) {
  if (!value || value.type !== 'oauth' || typeof value.access !== 'string' || !value.access
    || typeof value.refresh !== 'string' || !value.refresh || !Number.isFinite(value.expires)
    || value.access.length > 64_000 || value.refresh.length > 64_000) return undefined;
  return { type: 'oauth', access: value.access, refresh: value.refresh, expires: value.expires,
    ...(typeof value.accountId === 'string' ? { accountId: value.accountId.slice(0, 320) } : {}) };
}

/** Pi uses modify() for login and refresh, so rotated refresh tokens are saved
 * before a request proceeds. The host acknowledges its IndexedDB transaction.
 * This store is never part of the conversation snapshot or the project files. */
export function createBrowserAgentCredentialStore({ persist = async () => {}, access, onChange = () => {} } = {}) {
  let credential;
  let closed = false;
  let chain = Promise.resolve();
  const enqueue = operation => {
    const result = chain.then(operation);
    chain = result.catch(() => {});
    return result;
  };
  const locked = async (operation, signal) => {
    let lockId;
    try {
      if (access) {
        const latest = await access('acquire', {}, signal);
        lockId = latest.lockId;
        credential = browserAgentCredential(latest.credentials);
      }
      return await operation(lockId);
    } finally {
      if (lockId && !closed) await access('release', { lockId });
    }
  };
  return {
    async read(provider, options) {
      options?.signal?.throwIfAborted();
      if (closed || provider !== PROVIDER) return undefined;
      if (access) {
        const latest = await access('read');
        options?.signal?.throwIfAborted();
        credential = browserAgentCredential(latest.credentials);
      }
      return copy(credential);
    },
    async list(options) { options?.signal?.throwIfAborted(); return credential ? [{ providerId: PROVIDER, type: 'oauth' }] : []; },
    modify(provider, update, options) {
      return enqueue(async () => {
        options?.signal?.throwIfAborted();
        if (closed) throw new Error('The credential store is closed.');
        if (provider !== PROVIDER) throw new Error('Unsupported credential provider.');
        return locked(async lockId => {
          options?.signal?.throwIfAborted();
          const next = await update(copy(credential));
          options?.signal?.throwIfAborted();
          if (closed) throw new Error('The credential store is closed.');
          if (next !== undefined) {
            const validated = browserAgentCredential(next);
            if (!validated) throw new Error('Invalid subscription credential.');
            await persist(copy(validated), { lockId });
            credential = validated;
            onChange(copy(credential));
          }
          return copy(credential);
        }, options?.signal);
      });
    },
    delete(provider, options) {
      return enqueue(async () => {
        options?.signal?.throwIfAborted();
        if (provider !== PROVIDER) return;
        if (closed) { credential = undefined; return; }
        return locked(async lockId => {
          options?.signal?.throwIfAborted();
          await persist(null, { lockId });
          credential = undefined;
          onChange(undefined);
        }, options?.signal);
      });
    },
    restore(value) {
      return enqueue(async () => { credential = browserAgentCredential(value); onChange(copy(credential)); });
    },
    async clearMemory() { closed = true; await chain; credential = undefined; },
  };
}
