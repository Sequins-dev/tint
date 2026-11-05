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
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** GetPromiseResolve precedes GetIterator and is observed only once. */
export function combinePromises(
  mode: "all" | "race" | "allSettled" | "any",
  constructor: unknown,
  iterable: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const capability = newPromiseCapability(constructor, realm, hooks);
  let iterator: ScriptIterator | undefined = undefined;
  const values: unknown[] = [];
  let remaining = 1;
  function completeElement(): void {
    remaining--;
    if (remaining !== 0) return;
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
      if (mode === "allSettled") {
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
      completeElement();
      return undefined;
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
      mode === "allSettled" || mode === "any"
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
  try {
    const resolve = property(constructor, "resolve");
    if (
      !isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(resolve, realm.objectPrototype),
      )
    )
      throw createRuntimeError(realm, "type");
    const acquired = getScriptIterator(iterable, realm, hooks);
    iterator = acquired;
    while (true) {
      const next = stepScriptIterator(acquired);
      if (next.done) {
        if (mode !== "race") completeElement();
        return capability.promise;
      }
      const index = values.length;
      if (mode !== "race") {
        if (index >= 9007199254740991) throw createRuntimeError(realm, "range");
        values.push(undefined);
      }
      const promise = invoke(resolve, constructor, [next.value]);
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
  } catch (error) {
    if (iterator !== undefined) closeScriptIterator(iterator, true);
    capability.reject(error);
    return capability.promise;
  }
}
