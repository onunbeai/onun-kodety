export interface OnunMotionTimeline {
  to(target: unknown, values: Record<string, unknown>, position?: number | string): this;
  from(target: unknown, values: Record<string, unknown>, position?: number | string): this;
  fromTo(target: unknown, from: Record<string, unknown>, to: Record<string, unknown>, position?: number | string): this;
  set(target: unknown, values: Record<string, unknown>, position?: number | string): this;
  call(callback: () => void, args?: unknown[], position?: number | string): this;
  play(time?: number): this;
  pause(time?: number): this;
  reverse(time?: number): this;
  restart(): this;
  invalidate(): this;
  kill(): this;
  duration(): number;
  totalDuration(): number;
  totalTime(): number;
  totalTime(time: number, suppressEvents?: boolean): this;
  time(): number;
  time(time: number, suppressEvents?: boolean): this;
  progress(): number;
  progress(value: number, suppressEvents?: boolean): this;
  timeScale(): number;
  timeScale(value: number): this;
  iteration(): number;
  reversed(): boolean;
  isActive(): boolean;
  eventCallback(name: string, callback: () => void): this;
}
export interface OnunMotionEngine {
  timeline(options?: Record<string, unknown>): OnunMotionTimeline;
  set(target: unknown, values: Record<string, unknown>): void;
  to(target: unknown, values: Record<string, unknown>): OnunMotionTimeline;
  from(target: unknown, values: Record<string, unknown>): OnunMotionTimeline;
  fromTo(target: unknown, from: Record<string, unknown>, to: Record<string, unknown>): OnunMotionTimeline;
  invalidateElement(element: Element): void;
  easing: { create(name: string, data: string): (progress: number) => number };
  scroll: { create(options: Record<string, unknown>): { kill(): void; refresh(): void } };
  engine: string;
  license: string;
}
export function createOnunMotionRuntime(motion: unknown, host?: unknown): OnunMotionEngine;
