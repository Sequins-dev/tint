import { abortError, invalidArgument } from "./coded-errors.ts";
import { addAbortListener } from "./events.ts";
import {
  setTimeout as startTimeout,
  clearTimeout as stopTimeout,
  setInterval as startInterval,
  clearInterval as stopInterval,
  setImmediate as startImmediate,
  clearImmediate as stopImmediate,
} from "./timers.ts";

export interface TimerOptions {
  readonly signal?: AbortSignal;
  readonly ref?: boolean;
}
interface ValidatedOptions {
  readonly signal: AbortSignal | undefined;
  readonly ref: boolean | undefined;
}

function optionsFor(
  delay: number | undefined,
  options: TimerOptions,
): ValidatedOptions {
  if (delay !== undefined && typeof delay !== "number")
    throw invalidArgument("delay", "of type number", delay);
  if (options === null || typeof options !== "object" || Array.isArray(options))
    throw invalidArgument("options", "of type object", options);
  const { signal, ref } = options;
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw invalidArgument(
      "options.signal",
      "an instance of AbortSignal",
      signal,
    );
  if (ref !== undefined && typeof ref !== "boolean")
    throw invalidArgument("options.ref", "of type boolean", ref);
  if (signal?.aborted === true) throw abortError(signal.reason);
  return { signal, ref };
}

function wait<T>(
  value: T,
  options: ValidatedOptions,
  start: (ready: () => void) => () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let remove: (() => void) | undefined;
    const cancel = start((): void => {
      remove?.();
      resolve(value);
    });
    const signal = options.signal;
    if (signal !== undefined) {
      const subscription = addAbortListener(signal, (): void => {
        cancel();
        remove?.();
        reject(abortError(signal.reason));
      });
      remove = (): void => subscription[Symbol.dispose]?.();
    }
  });
}

export async function setTimeout<T = void>(
  delay?: number,
  value?: T,
  options: TimerOptions = {},
): Promise<T | undefined> {
  const validated = optionsFor(delay, options);
  return wait(value, validated, (ready) => {
    const handle = startTimeout(ready, delay);
    if (validated.ref === false) handle.unref();
    return (): void => stopTimeout(handle);
  });
}

export async function setImmediate<T = void>(
  value?: T,
  options: TimerOptions = {},
): Promise<T | undefined> {
  const validated = optionsFor(undefined, options);
  return wait(value, validated, (ready) => {
    const stop = stopImmediate;
    if (typeof startImmediate !== "function" || typeof stop !== "function")
      throw new Error("Immediate scheduling is unavailable");
    const handle: unknown = startImmediate(ready);
    if (
      validated.ref === false &&
      typeof handle === "object" &&
      handle !== null
    ) {
      const unref: unknown = Reflect.get(handle, "unref");
      if (typeof unref === "function") Reflect.apply(unref, handle, []);
    }
    return (): void => {
      stop(handle);
    };
  });
}

export async function* setInterval<T = void>(
  delay?: number,
  value?: T,
  options: TimerOptions = {},
): AsyncIterableIterator<T | undefined> {
  const { signal, ref } = optionsFor(delay, options);
  let queued = 0;
  let wake: (() => void) | undefined = undefined;
  const handle = startInterval((): void => {
    queued++;
    wake?.();
  }, delay);
  if (ref === false) handle.unref();
  const abort =
    signal === undefined
      ? undefined
      : addAbortListener(signal, (): void => {
          stopInterval(handle);
          wake?.();
        });
  try {
    while (signal?.aborted !== true) {
      if (queued === 0)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      wake = undefined;
      while (queued > 0) {
        queued--;
        yield value;
      }
    }
    throw abortError(signal.reason);
  } finally {
    stopInterval(handle);
    abort?.[Symbol.dispose]?.();
  }
}

export const scheduler = {
  async wait(delay?: number, options?: TimerOptions): Promise<void> {
    await setTimeout(delay, undefined, options);
  },
  async yield(): Promise<void> {
    await setImmediate();
  },
};
export default { setTimeout, setImmediate, setInterval, scheduler };
