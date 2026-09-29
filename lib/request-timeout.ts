export interface RequestTimeoutOptions {
  timeoutMs: number;
  timeoutMessage: string;
  signal?: AbortSignal;
}

/**
 * Run one complete request transaction (fetch plus body parsing) with a hard
 * deadline while preserving an optional caller cancellation signal.
 */
export async function withRequestTimeout<Result>(
  operation: (signal: AbortSignal) => Promise<Result>,
  { timeoutMs, timeoutMessage, signal: externalSignal }: RequestTimeoutOptions,
): Promise<Result> {
  externalSignal?.throwIfAborted();
  const controller = new AbortController();
  let rejectCancellation: ((reason?: unknown) => void) | null = null;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const forwardAbort = () => {
    const reason = externalSignal?.reason instanceof Error
      ? externalSignal.reason
      : new DOMException('A operação foi cancelada.', 'AbortError');
    rejectCancellation?.(reason);
    controller.abort(reason);
  };
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = globalThis.setTimeout(() => {
      const timeoutError = new Error(timeoutMessage);
      timeoutError.name = 'TimeoutError';
      reject(timeoutError);
      controller.abort(timeoutError);
    }, Math.max(1, timeoutMs));
  });

  try {
    return await Promise.race([operation(controller.signal), timeout, cancellation]);
  } finally {
    globalThis.clearTimeout(timeoutHandle!);
    rejectCancellation = null;
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function isTimeoutError(error: unknown) {
  return error instanceof Error && error.name === 'TimeoutError';
}
