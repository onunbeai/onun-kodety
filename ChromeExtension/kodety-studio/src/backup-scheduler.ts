export type BackupProgress = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** Coalesce autosave notifications while keeping disk writes strictly serial. */
export function createBackupScheduler<T>({
  save,
  onProgress,
  delayMs = 2_000,
}: {
  save(): Promise<T>;
  onProgress(progress: BackupProgress, error?: unknown): void;
  delayMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let active: Promise<T> | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = (): Promise<T> => {
    clearTimer();
    if (active) return active;
    const operation = (async () => {
      let latest!: T;
      try {
        do {
          pending = false;
          if (!disposed) onProgress('saving');
          latest = await save();
          // An edit acknowledged while the ZIP was being generated needs a
          // second pass. Do not label the older ZIP as the latest saved state.
        } while (pending && !disposed);
        if (!disposed) onProgress('saved');
        return latest;
      } catch (error) {
        pending = false;
        if (!disposed) onProgress('error', error);
        throw error;
      }
    })();
    active = operation;
    void operation.finally(() => {
      if (active === operation) active = null;
    }).catch(() => undefined);
    return operation;
  };

  return {
    schedule() {
      if (disposed) return;
      pending = true;
      onProgress(active ? 'saving' : 'pending');
      // The first event sets the deadline. Continuous typing cannot postpone
      // the safety copy indefinitely by repeatedly resetting a debounce.
      if (!active && timer === null) timer = setTimeout(() => void run().catch(() => undefined), delayMs);
    },
    flush(): Promise<T> {
      if (disposed) return Promise.reject(new Error('A sessão de backup já foi encerrada.'));
      pending = true;
      return run();
    },
    async finish(): Promise<void> {
      if (pending || active) await run();
    },
    dispose() {
      disposed = true;
      pending = false;
      clearTimer();
    },
  };
}
