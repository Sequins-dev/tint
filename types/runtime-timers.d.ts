interface TintTimerHandle {
  ref(): this;
  unref(): this;
  hasRef(): boolean;
  refresh(): this;
  close(): this;
  [Symbol.toPrimitive](): number;
  [Symbol.dispose](): void;
}
declare function setTimeout<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay?: number,
  ...args: Args
): TintTimerHandle;
declare function setInterval<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay?: number,
  ...args: Args
): TintTimerHandle;
declare function clearTimeout(handle?: TintTimerHandle | number | string): void;
declare function clearInterval(
  handle?: TintTimerHandle | number | string,
): void;
declare function queueMicrotask(callback: () => void): void;

declare module "node:timers" {
  export type Timeout = TintTimerHandle;
  export interface Immediate {
    ref(): this;
    unref(): this;
    hasRef(): boolean;
    [Symbol.dispose](): void;
  }
  export const setTimeout: typeof globalThis.setTimeout;
  export const setInterval: typeof globalThis.setInterval;
  export const clearTimeout: typeof globalThis.clearTimeout;
  export const clearInterval: typeof globalThis.clearInterval;
  export function setImmediate<Args extends unknown[]>(
    callback: (...args: Args) => void,
    ...args: Args
  ): Immediate;
  export function clearImmediate(handle?: Immediate): void;
  const timers: {
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
    clearTimeout: typeof clearTimeout;
    clearInterval: typeof clearInterval;
    setImmediate: typeof setImmediate;
    clearImmediate: typeof clearImmediate;
  };
  export default timers;
}

declare module "node:timers/promises" {
  export interface TimerOptions {
    signal?: AbortSignal;
    ref?: boolean;
  }
  export function setTimeout<T = void>(
    delay?: number,
    value?: T,
    options?: TimerOptions,
  ): Promise<T>;
  export function setImmediate<T = void>(
    value?: T,
    options?: TimerOptions,
  ): Promise<T>;
  export function setInterval<T = void>(
    delay?: number,
    value?: T,
    options?: TimerOptions,
  ): AsyncIterableIterator<T>;
  export const scheduler: {
    wait(delay?: number, options?: TimerOptions): Promise<void>;
    yield(): Promise<void>;
  };
  const timers: {
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
    setImmediate: typeof setImmediate;
    scheduler: typeof scheduler;
  };
  export default timers;
}
