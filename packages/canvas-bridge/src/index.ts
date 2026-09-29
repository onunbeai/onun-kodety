import type { JSONValue } from '@coday/control-schema';

export const CANVAS_PROTOCOL_VERSION = '1.0.0';
export interface ComponentBox { width: number; height: number; top: number; left: number; right: number; bottom: number }
export interface ComponentSize { width: number; height: number; intrinsicWidth?: number; intrinsicHeight?: number }
export type CanvasMessagePayloads = {
  ready: { capabilities: string[] };
  props: { instanceId: string; props: Record<string, JSONValue>; breakpoint: string };
  resize: { instanceId: string; size: ComponentSize; box: ComponentBox };
  state: { instanceId: string; selected: boolean; loading: boolean; breakpoint: string };
  error: { instanceId?: string; message: string; stack?: string; recoverable: boolean };
  event: { instanceId: string; name: string; payload: JSONValue };
  slot: { instanceId: string; slot: string; layerIds: string[] };
  logs: { level: 'debug' | 'info' | 'warn' | 'error'; entries: JSONValue[] };
  dispose: { reason: string };
};
export type CanvasMessageType = keyof CanvasMessagePayloads;
export interface CanvasEnvelope<T extends CanvasMessageType = CanvasMessageType> { protocol: typeof CANVAS_PROTOCOL_VERSION; sessionId: string; token: string; sequence: number; type: T; payload: CanvasMessagePayloads[T] }
export interface BridgeOptions { sessionId: string; token: string; targetOrigin: string; maxMessagesPerSecond?: number; maxPayloadBytes?: number }

export class CanvasBridge {
  private sequence = 0; private listeners = new Map<CanvasMessageType, Set<(payload: never) => void>>();
  private windowStart = performance.now(); private received = 0;
  constructor(private readonly target: Window, private readonly source: Window, private readonly options: BridgeOptions) { source.addEventListener('message', this.receive) }
  send<T extends CanvasMessageType>(type: T, payload: CanvasMessagePayloads[T]) {
    const envelope: CanvasEnvelope<T> = { protocol: CANVAS_PROTOCOL_VERSION, sessionId: this.options.sessionId, token: this.options.token, sequence: ++this.sequence, type, payload };
    const bytes = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
    if (bytes > (this.options.maxPayloadBytes || 256_000)) throw new Error('Mensagem do canvas excede o limite permitido.');
    this.target.postMessage(envelope, this.options.targetOrigin);
  }
  on<T extends CanvasMessageType>(type: T, listener: (payload: CanvasMessagePayloads[T]) => void) {
    const listeners = this.listeners.get(type) || new Set(); listeners.add(listener as (payload: never) => void); this.listeners.set(type, listeners);
    return () => listeners.delete(listener as (payload: never) => void);
  }
  dispose() { this.source.removeEventListener('message', this.receive); this.listeners.clear() }
  private receive = (event: MessageEvent) => {
    if (event.source !== this.target || (this.options.targetOrigin !== '*' && event.origin !== this.options.targetOrigin)) return;
    const now = performance.now(); if (now - this.windowStart >= 1000) { this.windowStart = now; this.received = 0; }
    if (++this.received > (this.options.maxMessagesPerSecond || 120)) return;
    const data = event.data as Partial<CanvasEnvelope>;
    if (data.protocol !== CANVAS_PROTOCOL_VERSION || data.sessionId !== this.options.sessionId || data.token !== this.options.token || !data.type) return;
    this.listeners.get(data.type)?.forEach(listener => listener(data.payload as never));
  };
}

export class ResizeLoopGuard {
  private samples: Array<{ at: number; width: number; height: number }> = [];
  constructor(private readonly maxChanges = 12, private readonly windowMs = 250, private readonly epsilon = 0.5) {}
  accept(width: number, height: number) {
    const at = performance.now(); this.samples = this.samples.filter(sample => at - sample.at <= this.windowMs);
    const previous = this.samples.at(-1); if (previous && Math.abs(previous.width - width) < this.epsilon && Math.abs(previous.height - height) < this.epsilon) return false;
    this.samples.push({ at, width, height }); return this.samples.length <= this.maxChanges;
  }
}

export function observeComponentSize(element: Element, onSize: (size: ComponentSize, box: ComponentBox) => void) {
  const guard = new ResizeLoopGuard();
  const observer = new ResizeObserver(entries => {
    const box = entries[0]?.target.getBoundingClientRect(); if (!box || !guard.accept(box.width, box.height)) return;
    requestAnimationFrame(() => onSize({ width: box.width, height: box.height, intrinsicWidth: element.scrollWidth, intrinsicHeight: element.scrollHeight }, { width: box.width, height: box.height, top: box.top, left: box.left, right: box.right, bottom: box.bottom }));
  });
  observer.observe(element); return () => observer.disconnect();
}

export function resolveSizingPriority(input: { canvasWidth?: number; canvasHeight?: number; widthMode: string; heightMode: string; intrinsicWidth: number; intrinsicHeight: number; aspectRatio?: number }) {
  let width = input.widthMode === 'fixed' || input.widthMode === 'fill' ? input.canvasWidth ?? input.intrinsicWidth : input.intrinsicWidth;
  let height = input.heightMode === 'fixed' || input.heightMode === 'fill' ? input.canvasHeight ?? input.intrinsicHeight : input.intrinsicHeight;
  if (input.aspectRatio && input.widthMode !== 'hug' && input.heightMode === 'hug') height = width / input.aspectRatio;
  else if (input.aspectRatio && input.heightMode !== 'hug' && input.widthMode === 'hug') width = height * input.aspectRatio;
  return { width, height };
}
