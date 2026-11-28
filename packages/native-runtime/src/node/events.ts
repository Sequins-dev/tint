import {
  abortError,
  codedError,
  invalidArgument,
  outOfRange,
} from "./coded-errors.ts";

type Name = string | symbol;
type Listener = (...args: unknown[]) => unknown;
type RegisteredListener = Listener & { listener?: Listener };

interface WaitOptions {
  readonly signal?: AbortSignal;
}
interface IteratorOptions extends WaitOptions {
  readonly close?: readonly Name[];
  readonly highWaterMark?: number;
  readonly lowWaterMark?: number;
  readonly highWatermark?: number;
  readonly lowWatermark?: number;
}
const dispose = Symbol.dispose;

export const errorMonitor = Symbol("events.errorMonitor");
export const captureRejectionSymbol = Symbol.for("nodejs.rejection");
export const defaultMaxListeners = 10;
export const captureRejections = false;
let defaultLimit = defaultMaxListeners;
let defaultCapture = captureRejections;

function checkedLimit(
  value: number,
  name: string,
  minimum: number,
  integer: boolean,
): number {
  if (typeof value !== "number")
    throw invalidArgument(name, "of type number", value);
  if (!(value >= minimum) || (integer && !Number.isSafeInteger(value)))
    throw outOfRange(
      name,
      (integer ? "an integer >= " : ">= ") + minimum,
      value,
    );
  return value;
}

export class EventEmitter<Events = unknown> {
  static EventEmitter = EventEmitter;
  static once = once;
  static on = on;
  static addAbortListener = addAbortListener;
  static getEventListeners = getEventListeners;
  static getMaxListeners = getMaxListeners;
  static setMaxListeners = setMaxListeners;
  static listenerCount = listenerCount;
  static errorMonitor = errorMonitor;
  static captureRejectionSymbol = captureRejectionSymbol;
  static get defaultMaxListeners(): number {
    return defaultLimit;
  }
  static set defaultMaxListeners(value: number) {
    defaultLimit = checkedLimit(value, "defaultMaxListeners", 0, false);
  }
  static get captureRejections(): boolean {
    return defaultCapture;
  }
  static set captureRejections(value: boolean) {
    if (typeof value !== "boolean")
      throw invalidArgument(
        "EventEmitter.captureRejections",
        "of type boolean",
        value,
      );
    defaultCapture = value;
  }

  readonly #listeners: Record<Name, RegisteredListener[]> = Object.create(null);
  #limit: number | undefined;
  #capture: boolean;

  constructor(options?: { readonly captureRejections?: boolean }) {
    const capture = options?.captureRejections;
    if (capture !== undefined && typeof capture !== "boolean")
      throw invalidArgument(
        "options.captureRejections",
        "of type boolean",
        capture,
      );
    this.#capture = capture || defaultCapture;
  }

  #add(
    name: Name,
    listener: Listener,
    prepend: boolean,
    once: boolean,
  ): EventEmitter<Events> {
    if (typeof listener !== "function")
      throw invalidArgument("listener", "of type function", listener);
    this.#emit("newListener", [name, listener]);
    const list = this.#listeners[name] ?? (this.#listeners[name] = []);
    let entry: RegisteredListener = listener;
    if (once) {
      const emitter = this;
      let fired = false;
      entry = function onceWrapper(...args: unknown[]): unknown {
        if (fired) return undefined;
        fired = true;
        emitter.#remove(name, entry);
        return listener.apply(emitter, args);
      };
      entry.listener = listener;
    }
    if (prepend) list.unshift(entry);
    else list.push(entry);
    return this;
  }

  addListener(name: Name, listener: Listener): EventEmitter<Events> {
    return this.#add(name, listener, false, false);
  }
  on(name: Name, listener: Listener): EventEmitter<Events> {
    return this.#add(name, listener, false, false);
  }
  once(name: Name, listener: Listener): EventEmitter<Events> {
    return this.#add(name, listener, false, true);
  }
  prependListener(name: Name, listener: Listener): EventEmitter<Events> {
    return this.#add(name, listener, true, false);
  }
  prependOnceListener(name: Name, listener: Listener): EventEmitter<Events> {
    return this.#add(name, listener, true, true);
  }

  #remove(name: Name, listener: Listener): EventEmitter<Events> {
    if (typeof listener !== "function")
      throw invalidArgument("listener", "of type function", listener);
    const list = this.#listeners[name];
    if (list === undefined) return this;
    for (let index = list.length - 1; index >= 0; index--) {
      const entry = list[index];
      if (
        entry !== undefined &&
        (entry === listener || entry.listener === listener)
      ) {
        list.splice(index, 1);
        if (list.length === 0) delete this.#listeners[name];
        this.#emit("removeListener", [name, entry.listener ?? entry]);
        break;
      }
    }
    return this;
  }

  removeListener(name: Name, listener: Listener): EventEmitter<Events> {
    return this.#remove(name, listener);
  }
  off(name: Name, listener: Listener): EventEmitter<Events> {
    return this.#remove(name, listener);
  }
  removeAllListeners(name?: Name): EventEmitter<Events> {
    if (arguments.length === 0) {
      for (const key of Reflect.ownKeys(this.#listeners)) {
        if (key !== "removeListener") this.#removeAll(key);
      }
      this.#removeAll("removeListener");
    } else this.#removeAll(name === undefined ? "undefined" : name);
    return this;
  }
  #removeAll(name: Name): void {
    if (this.#listeners.removeListener === undefined) {
      delete this.#listeners[name];
      return;
    }
    const list = this.#listeners[name]?.slice();
    if (list !== undefined) {
      for (let index = list.length - 1; index >= 0; index--) {
        const entry = list[index];
        if (entry !== undefined) this.#remove(name, entry);
      }
    }
  }

  emit(name: Name, ...args: unknown[]): boolean {
    return this.#emit(name, args);
  }
  #emit(name: Name, args: unknown[]): boolean {
    if (name === "error") this.#emit(errorMonitor, args);
    const list = this.#listeners[name];
    if (list === undefined) {
      if (name !== "error") return false;
      const reason = args[0];
      if (reason instanceof Error) throw reason;
      const error = codedError(
        new Error("Unhandled error. (" + String(reason) + ")"),
        "ERR_UNHANDLED_ERROR",
      );
      throw Object.assign(error, { context: reason });
    }
    for (const entry of list.slice()) {
      const result: unknown = entry.apply(this, args);
      if (this.#capture && result !== undefined && result !== null)
        this.#observeRejection(result, name, args);
    }
    return true;
  }

  #observeRejection(result: unknown, name: Name, args: unknown[]): void {
    try {
      const then = methodOf(Object(result), "then");
      if (then !== undefined)
        Reflect.apply(then, result, [
          undefined,
          (reason: unknown): void => {
            void Promise.resolve().then(() => {
              const handle = methodOf(this, captureRejectionSymbol);
              if (handle !== undefined)
                Reflect.apply(handle, this, [reason, name, ...args]);
              else {
                const saved = this.#capture;
                this.#capture = false;
                try {
                  this.#emit("error", [reason]);
                } finally {
                  this.#capture = saved;
                }
              }
            });
          },
        ]);
    } catch (error) {
      this.#emit("error", [error]);
    }
  }

  rawListeners(name: Name): Listener[] {
    return this.#listeners[name]?.slice() ?? [];
  }
  listeners(name: Name): Listener[] {
    return (
      this.#listeners[name]?.map(
        (entry: RegisteredListener) => entry.listener ?? entry,
      ) ?? []
    );
  }
  listenerCount(name: Name, listener?: Listener): number {
    const list = this.#listeners[name];
    if (list === undefined) return 0;
    return listener === undefined
      ? list.length
      : list.filter(
          (entry: RegisteredListener) =>
            entry === listener || entry.listener === listener,
        ).length;
  }
  eventNames(): Name[] {
    return Reflect.ownKeys(this.#listeners);
  }
  setMaxListeners(value: number): EventEmitter<Events> {
    this.#limit = checkedLimit(value, "n", 0, false);
    return this;
  }
  getMaxListeners(): number {
    return this.#limit ?? defaultLimit;
  }
}

const targetLimit = new WeakMap<object, number>();

function objectValue(value: unknown): object | undefined {
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  )
    return value;
  return undefined;
}

/** Node's static helpers accept emitters with a public subscription protocol. */
function methodOf(value: unknown, key: Name): Function | undefined {
  const object = objectValue(value);
  if (object === undefined) return undefined;
  const method: unknown = Reflect.get(object, key);
  return typeof method === "function" ? method : undefined;
}

function isTarget(value: unknown): boolean {
  return (
    methodOf(value, "addEventListener") !== undefined &&
    methodOf(value, "removeEventListener") !== undefined
  );
}
function isEmitter(value: unknown): boolean {
  return (
    methodOf(value, "on") !== undefined &&
    methodOf(value, "removeListener") !== undefined
  );
}

function registration(
  emitter: unknown,
  name: Name,
  listener: Listener,
): () => void {
  const subscribe = methodOf(emitter, "on");
  const unsubscribe = methodOf(emitter, "removeListener");
  if (subscribe !== undefined && unsubscribe !== undefined) {
    Reflect.apply(subscribe, emitter, [name, listener]);
    return (): void => {
      Reflect.apply(unsubscribe, emitter, [name, listener]);
    };
  }
  const add = methodOf(emitter, "addEventListener");
  const remove = methodOf(emitter, "removeEventListener");
  if (add === undefined || remove === undefined)
    throw invalidArgument(
      "emitter",
      "an instance of EventEmitter or EventTarget",
      emitter,
    );
  const key = String(name);
  Reflect.apply(add, emitter, [key, listener]);
  return (): void => {
    Reflect.apply(remove, emitter, [key, listener]);
  };
}
function validateSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw invalidArgument("signal", "an instance of AbortSignal", signal);
}

const abortSubscription = Symbol.for("tint.web.subscribeAbort");

export type AbortSubscription = Record<symbol, () => void>;

export function addAbortListener(
  signal: AbortSignal,
  listener: (event?: Event) => unknown,
): AbortSubscription {
  if (signal === undefined)
    throw invalidArgument("signal", "an instance of AbortSignal", signal);
  validateSignal(signal);
  if (typeof listener !== "function")
    throw invalidArgument("listener", "of type function", listener);
  const subscribe = methodOf(signal, abortSubscription);
  if (subscribe === undefined)
    throw invalidArgument("signal", "an instance of AbortSignal", signal);
  const remove: unknown = Reflect.apply(subscribe, signal, [listener]);
  return {
    [dispose](): void {
      if (typeof remove === "function") remove();
    },
  };
}

export function once(
  emitter: unknown,
  name: Name,
  options?: WaitOptions,
): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const cleanup: (() => void)[] = [];
    let settled = false;
    function retain(remove: () => void): void {
      if (settled) remove();
      else cleanup.push(remove);
    }
    function finish(): boolean {
      if (settled) return false;
      settled = true;
      for (const remove of cleanup.splice(0)) remove();
      return true;
    }
    try {
      const signal = options?.signal;
      validateSignal(signal);
      if (signal?.aborted === true) throw abortError(signal.reason);
      retain(
        registration(emitter, name, (...args: unknown[]): void => {
          if (finish()) resolve(args);
        }),
      );
      if (!settled && name !== "error" && isEmitter(emitter))
        retain(
          registration(emitter, "error", (reason: unknown): void => {
            if (finish()) reject(reason);
          }),
        );
      if (!settled && signal !== undefined) {
        const subscription = addAbortListener(signal, (): void => {
          if (finish()) reject(abortError(signal.reason));
        });
        retain((): void => subscription[dispose]?.());
      }
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

export function on(
  emitter: unknown,
  name: Name,
  options?: IteratorOptions,
): AsyncIterableIterator<unknown[]> {
  const signal = options?.signal;
  validateSignal(signal);
  if (signal?.aborted === true) throw abortError(signal.reason);
  const high = checkedLimit(
    options?.highWaterMark ?? options?.highWatermark ?? Number.MAX_SAFE_INTEGER,
    "options.highWaterMark",
    1,
    true,
  );
  const low = checkedLimit(
    options?.lowWaterMark ?? options?.lowWatermark ?? 1,
    "options.lowWaterMark",
    1,
    true,
  );
  const queue: unknown[][] = [];
  const waiting: {
    resolve: (result: IteratorResult<unknown[]>) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  const cleanup: (() => void)[] = [];
  let closed = false;
  let failed = false;
  let failure: unknown;
  let paused = false;
  function retain(remove: () => void): void {
    if (closed) remove();
    else cleanup.push(remove);
  }
  function finish(): void {
    if (closed) return;
    closed = true;
    for (const remove of cleanup.splice(0)) remove();
    for (const reader of waiting.splice(0))
      reader.resolve({ done: true, value: undefined });
  }
  function fail(reason: unknown): void {
    if (closed) return;
    const reader = waiting.shift();
    if (reader !== undefined) reader.reject(reason);
    else {
      failed = true;
      failure = reason;
    }
    finish();
  }
  try {
    retain(
      registration(emitter, name, (...args: unknown[]): void => {
        const reader = waiting.shift();
        if (reader !== undefined) reader.resolve({ value: args, done: false });
        else {
          queue.push(args);
          if (!paused && queue.length > high && isEmitter(emitter)) {
            paused = true;
            const pause = methodOf(emitter, "pause");
            if (pause !== undefined) Reflect.apply(pause, emitter, []);
          }
        }
      }),
    );
    if (name !== "error" && isEmitter(emitter))
      retain(registration(emitter, "error", fail));
    for (const key of options?.close ?? [])
      retain(registration(emitter, key, finish));
    if (signal !== undefined) {
      const subscription = addAbortListener(signal, (): void =>
        fail(abortError(signal.reason)),
      );
      retain((): void => subscription[dispose]?.());
    }
  } catch (error) {
    finish();
    throw error;
  }
  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<unknown[]> {
      return this;
    },
    next(): Promise<IteratorResult<unknown[]>> {
      const value = queue.shift();
      if (value !== undefined) {
        if (paused && queue.length < low && isEmitter(emitter)) {
          paused = false;
          const resume = methodOf(emitter, "resume");
          if (resume !== undefined) Reflect.apply(resume, emitter, []);
        }
        return Promise.resolve({ done: false, value });
      }
      if (failed) {
        failed = false;
        return Promise.reject(failure);
      }
      if (closed) return Promise.resolve({ done: true, value: undefined });
      return new Promise<IteratorResult<unknown[]>>((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
    return(): Promise<IteratorResult<unknown[]>> {
      finish();
      return Promise.resolve({ done: true, value: undefined });
    },
    throw(reason: unknown): Promise<IteratorResult<unknown[]>> {
      fail(reason);
      return Promise.resolve({ done: true, value: undefined });
    },
  };
}

const targetListeners = Symbol.for("tint.web.eventTargetListeners");
export function getEventListeners(emitter: unknown, name: Name): unknown[] {
  const lookup =
    methodOf(emitter, "listeners") ?? methodOf(emitter, targetListeners);
  if (lookup !== undefined) return Reflect.apply(lookup, emitter, [name]);
  throw invalidArgument(
    "emitter",
    "an instance of EventEmitter or EventTarget",
    emitter,
  );
}
export function getMaxListeners(emitter: unknown): number {
  if (emitter instanceof EventEmitter) return emitter.getMaxListeners();
  const target = objectValue(emitter);
  if (target !== undefined && isTarget(target))
    return targetLimit.get(target) ?? defaultLimit;
  throw invalidArgument(
    "emitter",
    "an instance of EventEmitter or EventTarget",
    emitter,
  );
}
export function setMaxListeners(n = defaultLimit, ...targets: unknown[]): void {
  checkedLimit(n, "n", 0, false);
  if (targets.length === 0) defaultLimit = n;
  for (const value of targets) {
    if (value instanceof EventEmitter) value.setMaxListeners(n);
    else {
      const target = objectValue(value);
      if (target === undefined || !isTarget(target))
        throw invalidArgument(
          "eventTargets",
          "an instance of EventEmitter or EventTarget",
          value,
        );
      targetLimit.set(target, n);
    }
  }
}
export function listenerCount(emitter: EventEmitter, name: Name): number {
  return emitter.listenerCount(name);
}

export default EventEmitter;
