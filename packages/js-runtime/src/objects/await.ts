import { performPromiseThen, type PromiseHooks } from "../promises/index.ts";
import { promiseResolve } from "./promise-capability.ts";
import { viewObjectValue } from "./values.ts";
import { builtinFunction } from "./intrinsics.ts";
import {
  createObject,
  ensureExoticSlots,
  exoticSlots,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";

/** Intrinsic Await reactions bypass mutable .then and allocate no chained
 * Promise. A synchronous PromiseResolve failure belongs to the suspension site. */
export function awaitScriptValue(
  value: unknown,
  fulfilled: (value: unknown) => void,
  rejected: (reason: unknown) => void,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  protocol: PromiseHooks<unknown>,
): void {
  const object = viewObjectValue(value, realm.objectPrototype);
  const operation =
    object === undefined
      ? undefined
      : exoticSlots(object).internalAwaitOperation;
  if (operation !== undefined) {
    // The compiler is awaiting native work that already performs its specified
    // Awaits. Resume in its completing job rather than adding a Promise reaction.
    operation.subscribe(fulfilled, rejected);
    return;
  }
  const constructor = realm.promiseConstructor;
  if (constructor === undefined) throw "AWAIT_PROMISE_INTRINSIC_INVARIANT";
  const awaited = viewObjectValue(
    promiseResolve(constructor, value, realm, hooks),
    realm.objectPrototype,
  );
  const record =
    awaited === undefined
      ? undefined
      : exoticSlots(awaited).internalPromiseData;
  if (record === undefined) throw "AWAIT_PROMISE_RECORD_INVARIANT";
  const onFulfilled = builtinFunction(
    realm.functionPrototype,
    "",
    1,
    (receiver, args): unknown => {
      fulfilled(args[0]);
      return undefined;
    },
    hooks,
  );
  const onRejected = builtinFunction(
    realm.functionPrototype,
    "",
    1,
    (receiver, args): unknown => {
      rejected(args[0]);
      return undefined;
    },
    hooks,
  );
  performPromiseThen<unknown>(
    record,
    onFulfilled,
    onRejected,
    undefined,
    protocol,
  );
}

interface NativeAwaitState {
  settled: boolean;
  failed: boolean;
  subscribed: boolean;
  value: unknown;
  fulfilled: ((value: unknown) => void) | undefined;
  rejected: ((error: unknown) => void) | undefined;
}
export interface NativeAwaitCapability {
  readonly value: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}
/** An internal handoff from native async work to its compiled continuation.
 * This value cannot be constructed or inspected through Script properties. */
export function createNativeAwaitOperation(): NativeAwaitCapability {
  const value = createObject<ScriptPropertyKey, unknown>(undefined);
  const state: NativeAwaitState = {
    settled: false,
    failed: false,
    subscribed: false,
    value: undefined,
    fulfilled: undefined,
    rejected: undefined,
  };
  function notify(): void {
    const callback = state.failed ? state.rejected : state.fulfilled;
    if (callback !== undefined) {
      const result = state.value;
      state.value = undefined;
      state.fulfilled = undefined;
      state.rejected = undefined;
      callback(result);
    }
  }
  function settle(failed: boolean, result: unknown): void {
    if (state.settled) return;
    state.settled = true;
    state.failed = failed;
    state.value = result;
    notify();
  }
  ensureExoticSlots(value).internalAwaitOperation = {
    subscribe: (
      fulfilled: (value: unknown) => void,
      rejected: (error: unknown) => void,
    ): void => {
      if (state.subscribed) throw "NATIVE_AWAIT_SUBSCRIBER_INVARIANT";
      state.subscribed = true;
      state.fulfilled = fulfilled;
      state.rejected = rejected;
      if (state.settled) notify();
    },
  };
  return {
    value,
    resolve: (value): void => settle(false, value),
    reject: (error): void => settle(true, error),
  };
}
