import { createArrayFromList } from "./array-like.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { newPromiseCapability } from "./promise-capability.ts";
import {
  getScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
  type ScriptIterator,
} from "./iteration.ts";
import { getObjectValueProperty, viewObjectValue } from "./values.ts";
import { callObject, isCallableObject } from "./call.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  createObject,
  createDataProperty,
  getOwnProperty,
  getProperty,
  ownKeys,
  type ObjectHooks,
} from "./operations.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";

/** GetPromiseResolve precedes input enumeration and is observed only once.
 * Keyed variants follow https://tc39.es/proposal-await-dictionary/. */
export function combinePromises(
  mode: "all" | "race" | "allSettled" | "any" | "allKeyed" | "allSettledKeyed",
  constructor: unknown,
  iterable: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const capability = newPromiseCapability(constructor, realm, hooks);
  let iterator: ScriptIterator | undefined = undefined;
  const values: unknown[] = [];
  const keyed = mode === "allKeyed" || mode === "allSettledKeyed";
  const settled = mode === "allSettled" || mode === "allSettledKeyed";
  const keys: ScriptPropertyKey[] = [];
  let remaining = 1;
  function completeElement(): unknown {
    remaining--;
    if (remaining !== 0) return;
    if (keyed) {
      const result = createObject<ScriptPropertyKey, unknown>(undefined);
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        if (key === undefined) throw "PROMISE_KEY_INVARIANT";
        if (
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            key,
            values[index],
            hooks,
          )
        )
          throw "PROMISE_RESULT_INVARIANT";
      }
      return invoke(capability.resolveFunction, undefined, [result]);
    }
    const results = createArrayFromList(
      values,
      0,
      realm.arrayPrototype,
      realm,
      hooks,
    );
    if (mode === "any") {
      const error = createRuntimeError(realm, "aggregate");
      builtinProperty(error, "errors", results, true, true, hooks);
      capability.reject(error);
    } else capability.resolve(results);
  }
  function elementCallbacks(index: number): {
    readonly fulfill: unknown;
    readonly reject: unknown;
  } {
    let called = false;
    function settle(value: unknown, rejected: boolean): unknown {
      if (called) return undefined;
      called = true;
      if (settled) {
        const result = createObject<ScriptPropertyKey, unknown>(
          realm.objectPrototype,
        );
        if (
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            "status",
            rejected ? "rejected" : "fulfilled",
            hooks,
          ) ||
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            rejected ? "reason" : "value",
            value,
            hooks,
          )
        )
          throw "PROMISE_RESULT_INVARIANT";
        values[index] = result;
      } else values[index] = value;
      return completeElement();
    }
    const fulfill =
      mode === "any"
        ? capability.resolveFunction
        : builtinFunction(
            realm.functionPrototype,
            "",
            1,
            (receiver, args): unknown => settle(args[0], false),
            hooks,
          );
    const reject =
      settled || mode === "any"
        ? builtinFunction(
            realm.functionPrototype,
            "",
            1,
            (receiver, args): unknown => settle(args[0], true),
            hooks,
          )
        : capability.rejectFunction;
    return { fulfill, reject };
  }
  function property(receiver: unknown, name: string): unknown {
    const result = getObjectValueProperty(receiver, name, hooks, realm);
    if (result.error === "unsupported") rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function invoke(
    method: unknown,
    receiver: unknown,
    args: readonly unknown[],
  ): unknown {
    const result = callObject<ScriptPropertyKey, unknown>(
      viewObjectValue(method, realm.objectPrototype),
      receiver,
      args,
      undefined,
    );
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function addElement(value: unknown, resolve: unknown): void {
    const index = values.length;
    if (mode !== "race") {
      if (!keyed && index >= 9007199254740991)
        throw createRuntimeError(realm, "range");
      values.push(undefined);
    }
    const promise = invoke(resolve, constructor, [value]);
    let onFulfilled = capability.resolveFunction;
    let onRejected = capability.rejectFunction;
    if (mode !== "race") {
      const callbacks = elementCallbacks(index);
      onFulfilled = callbacks.fulfill;
      onRejected = callbacks.reject;
      remaining++;
    }
    invoke(property(promise, "then"), promise, [onFulfilled, onRejected]);
  }
  try {
    const resolve = property(constructor, "resolve");
    if (
      !isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(resolve, realm.objectPrototype),
      )
    )
      throw createRuntimeError(realm, "type");
    if (keyed) {
      const object = viewObjectValue(iterable, realm.objectPrototype);
      if (object === undefined) throw createRuntimeError(realm, "type");
      // Snapshot keys once, but check each descriptor immediately before Get.
      // Get/resolve/then can mutate later properties without changing the snapshot.
      const allKeys = ownKeys<ScriptPropertyKey, unknown>(
        object,
        (key): number => scriptPropertyKeyOrder(key),
      );
      for (const key of allKeys) {
        if (key === undefined) throw "PROMISE_KEY_INVARIANT";
        const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
          object,
          key,
        );
        if (descriptor === undefined || !descriptor.enumerable) continue;
        const value = getProperty<ScriptPropertyKey, unknown>(
          object,
          key,
          iterable,
          hooks,
        );
        keys.push(key);
        addElement(value, resolve);
      }
      completeElement();
      return capability.promise;
    }
    const acquired = getScriptIterator(iterable, realm, hooks);
    iterator = acquired;
    while (true) {
      const next = stepScriptIterator(acquired);
      if (next.done) {
        if (mode !== "race") completeElement();
        return capability.promise;
      }
      addElement(next.value, resolve);
    }
  } catch (error) {
    if (iterator !== undefined) closeScriptIterator(iterator, true);
    capability.reject(error);
    return capability.promise;
  }
}
