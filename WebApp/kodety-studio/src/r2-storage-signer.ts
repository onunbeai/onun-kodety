import type { WebContainerProcess } from '@webcontainer/api';
import { getBrowserWebContainer } from '../../../lib/html-editor/browser-agent-webcontainer';
import runtimeSource from './r2-storage-runtime.mjs?raw';

export type R2SigningInput = {
  config: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  method: string;
  key?: string;
  query?: Record<string, string>;
  contentType?: string;
  headers?: Record<string, string>;
  payloadHash: string;
};
export type R2SignedRequest = { url: string; method: string; headers: Record<string, string> };
type Pending = { resolve(value: R2SignedRequest): void; reject(error: Error): void; cleanup(): void };
let instance: ReturnType<typeof createSigner> | undefined;
const unavailable = () => new Error('r2-runtime');
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('r2-disconnected'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('r2-disconnected'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function createSigner() {
  let worker: WebContainerProcess | undefined;
  let writer: WritableStreamDefaultWriter<string> | undefined;
  let startup: Promise<void> | undefined;
  let disposed = false;
  let writes = Promise.resolve();
  let removeScript: (() => void) | undefined;
  const pending = new Map<string, Pending>();
  const finish = () => {
    worker?.kill(); worker = undefined; writer = undefined;
    removeScript?.();
    for (const item of pending.values()) { item.cleanup(); item.reject(unavailable()); }
    pending.clear();
  };
  const dispose = () => { disposed = true; finish(); };
  async function start() {
    if (disposed) throw unavailable();
    if (startup) return startup;
    const running = (async () => {
      const container = await getBrowserWebContainer();
      if (disposed) throw unavailable();
      const filename = `r2-signing-${crypto.randomUUID()}.mjs`;
      removeScript = () => { void container.fs.rm(filename).catch(() => undefined); };
      // This file is constant source code; keys/body data never enter fs.writeFile.
      await container.fs.writeFile(filename, runtimeSource);
      if (disposed) { removeScript(); throw unavailable(); }
      const process = await container.spawn('node', [filename]);
      if (disposed) { process.kill(); removeScript(); throw unavailable(); }
      worker = process;
      writer = process.input.getWriter();
      let ready!: () => void;
      let failed!: (error: Error) => void;
      const readiness = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
      let buffered = '';
      void process.output.pipeTo(new WritableStream({ write(chunk: string) {
        if (disposed || worker !== process) return;
        buffered += chunk;
        if (buffered.length > 100_000) { failed(unavailable()); dispose(); return; }
        let newline: number;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.channel !== 'kodety-r2') continue;
            if (message.ready === true) { ready(); continue; }
            const item = pending.get(message.id);
            if (!item) continue;
            pending.delete(message.id); item.cleanup();
            if (message.error) item.reject(unavailable());
            else item.resolve(message.result);
          } catch { /* Never forward process diagnostics or credentials to logs. */ }
        }
      } })).catch(() => { failed(unavailable()); dispose(); });
      void process.exit.then(() => { failed(unavailable()); dispose(); });
      await readiness;
    })();
    startup = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { dispose(); reject(unavailable()); }, 120_000);
      running.then(resolve, reject).finally(() => clearTimeout(timer));
    });
    return startup;
  }
  return {
    dispose,
    async sign(request: R2SigningInput, signal: AbortSignal): Promise<R2SignedRequest> {
      signal.throwIfAborted();
      await abortable(start(), signal);
      signal.throwIfAborted();
      if (disposed || !writer) throw unavailable();
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const abort = () => { pending.delete(id); cleanup(); reject(new Error('r2-disconnected')); };
        const timer = setTimeout(() => { pending.delete(id); cleanup(); reject(unavailable()); }, 20_000);
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        pending.set(id, { resolve, reject, cleanup });
        signal.addEventListener('abort', abort, { once: true });
        const activeWriter = writer!;
        const write = writes.catch(() => undefined).then(() => {
          signal.throwIfAborted();
          if (disposed || !pending.has(id)) throw unavailable();
          return activeWriter.write(JSON.stringify({ id, request }) + '\n');
        });
        writes = write;
        void write.catch(() => {
          const item = pending.get(id);
          if (item) { pending.delete(id); item.cleanup(); item.reject(unavailable()); }
        });
      });
    },
  };
}

export async function signR2InWebContainer(request: R2SigningInput, signal: AbortSignal): Promise<R2SignedRequest> {
  const signer = instance ||= createSigner();
  try { return await signer.sign(request, signal); }
  catch (error) {
    if (!signal.aborted) { signer.dispose(); if (instance === signer) instance = undefined; }
    throw error;
  }
}

export function disposeR2Signer(): void {
  instance?.dispose(); instance = undefined;
}
