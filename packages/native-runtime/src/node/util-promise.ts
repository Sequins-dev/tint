import { codedError, invalidArgument } from "./coded-errors.ts";

const promisifySymbol = Symbol.for("nodejs.util.promisify.custom");

function inheritFunction(wrapper: Function, original: Function): void {
  Object.setPrototypeOf(wrapper, Object.getPrototypeOf(original));
  for (const key of Reflect.ownKeys(original)) {
    if (key === undefined) continue;
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    const current = Object.getOwnPropertyDescriptor(wrapper, key);
    if (descriptor !== undefined && current?.configurable !== false)
      Object.defineProperty(wrapper, key, descriptor);
  }
}

function promisifyFunction(original: Function): Function {
  if (typeof original !== "function")
    throw invalidArgument("original", "of type function", original);
  const custom: unknown = Reflect.get(original, promisifySymbol);
  if (custom !== undefined && custom !== null) {
    if (typeof custom !== "function")
      throw invalidArgument(
        "util.promisify.custom",
        "of type function",
        custom,
      );
    Object.defineProperty(custom, promisifySymbol, {
      value: custom,
      configurable: true,
    });
    return custom;
  }
  const wrapper = {
    promisified(...args: unknown[]): Promise<unknown> {
      const receiver = this;
      return new Promise<unknown>((resolve, reject) => {
        Reflect.apply(original, receiver, [
          ...args,
          (error: unknown, value: unknown): void => {
            if (error) reject(error);
            else resolve(value);
          },
        ]);
      });
    },
  }.promisified;
  inheritFunction(wrapper, original);
  Object.defineProperty(wrapper, promisifySymbol, {
    value: wrapper,
    configurable: true,
  });
  return wrapper;
}
export const promisify = Object.assign(promisifyFunction, {
  custom: promisifySymbol,
});

export function callbackify(original: Function): Function {
  if (typeof original !== "function")
    throw invalidArgument("original", "of type function", original);
  const wrapper = {
    callbackified(...args: unknown[]): void {
      const callback = args.pop();
      if (typeof callback !== "function")
        throw invalidArgument("last argument", "of type function", callback);
      const receiver = this;
      const promise: unknown = Reflect.apply(original, receiver, args);
      Promise.resolve(promise).then(
        (value: unknown): void => {
          Reflect.apply(callback, receiver, [null, value]);
        },
        (reason: unknown): void => {
          const error =
            reason ||
            Object.assign(
              codedError(
                new Error("Promise was rejected with falsy value"),
                "ERR_FALSY_VALUE_REJECTION",
              ),
              { reason },
            );
          Reflect.apply(callback, receiver, [error]);
        },
      );
    },
  }.callbackified;
  inheritFunction(wrapper, original);
  Object.defineProperty(wrapper, "name", {
    value: original.name + "Callbackified",
    configurable: true,
  });
  Object.defineProperty(wrapper, "length", {
    value: original.length + 1,
    configurable: true,
  });
  return wrapper;
}

export function markPromiseAsHandled(promise: Promise<unknown>): void {
  if (!(promise instanceof Promise))
    throw invalidArgument("promise", "an instance of Promise", promise);
  Promise.prototype.then.call(promise, undefined, (): void => {});
}

export async function aborted(
  signal: AbortSignal,
  resource: object,
): Promise<void> {
  if (!(signal instanceof AbortSignal))
    throw invalidArgument("signal", "an instance of AbortSignal", signal);
  if (
    resource === null ||
    (typeof resource !== "object" && typeof resource !== "function")
  )
    throw invalidArgument("resource", "of type object", resource);
  if (signal.aborted) return;
  return new Promise<void>((resolve) => {
    const subscribe: unknown = Reflect.get(
      signal,
      Symbol.for("tint.web.subscribeAbort"),
    );
    if (typeof subscribe === "function")
      Reflect.apply(subscribe, signal, [resolve]);
    else
      signal.addEventListener("abort", (): void => resolve(), { once: true });
  });
}
