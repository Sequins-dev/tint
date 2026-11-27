import type { PromiseResolvingFunctions } from "../promises/index.ts";
import {
  exoticSlots,
  type OrdinaryObject,
  type ObjectHooks,
  getProperty,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { builtinFunction } from "./intrinsics.ts";
import { callObject, constructObject, isCallableObject } from "./call.ts";
import { viewObjectValue } from "./values.ts";

export interface ScriptPromiseCapability extends PromiseResolvingFunctions<unknown> {
  readonly promise: unknown;
  readonly resolveFunction: unknown;
  readonly rejectFunction: unknown;
}

/** NewPromiseCapability accepts any constructor; its result need not be branded
 * as a native Promise. Captured callbacks are always called with undefined this. */
export function newPromiseCapability(
  constructor: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ScriptPromiseCapability {
  const target = viewObjectValue(constructor, realm.objectPrototype);
  if (
    target === undefined ||
    target.internalRareSlots?.internalConstruct === undefined
  )
    throw createRuntimeError(realm, "type");
  const captured: { resolve: unknown; reject: unknown } = {
    resolve: undefined,
    reject: undefined,
  };
  const executor = builtinFunction(
    realm.functionPrototype,
    "",
    2,
    (receiver, args): unknown => {
      if (captured.resolve !== undefined || captured.reject !== undefined)
        throw createRuntimeError(realm, "type");
      captured.resolve = args[0];
      captured.reject = args[1];
      return undefined;
    },
    hooks,
  );
  const result = constructObject<ScriptPropertyKey, unknown>(
    target,
    [executor],
    { object: target, value: constructor },
    undefined,
  );
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  const resolve = viewObjectValue(captured.resolve, realm.objectPrototype);
  const reject = viewObjectValue(captured.reject, realm.objectPrototype);
  if (
    !isCallableObject<ScriptPropertyKey, unknown>(resolve) ||
    !isCallableObject<ScriptPropertyKey, unknown>(reject)
  )
    throw createRuntimeError(realm, "type");
  return {
    promise: result.value,
    resolveFunction: captured.resolve,
    rejectFunction: captured.reject,
    resolve: (value): void => {
      const completion = callObject<ScriptPropertyKey, unknown>(
        resolve,
        undefined,
        [value],
        undefined,
      );
      if (completion.error !== "none") throw createRuntimeError(realm, "type");
    },
    reject: (reason): void => {
      const completion = callObject<ScriptPropertyKey, unknown>(
        reject,
        undefined,
        [reason],
        undefined,
      );
      if (completion.error !== "none") throw createRuntimeError(realm, "type");
    },
  };
}

/** PromiseResolve is shared by the static method and finally's cleanup path. */
export function promiseResolve(
  constructor: unknown,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  if (viewObjectValue(constructor, realm.objectPrototype) === undefined)
    throw createRuntimeError(realm, "type");
  const promise = viewObjectValue(value, realm.objectPrototype);
  if (
    promise !== undefined &&
    exoticSlots(promise).internalPromiseData !== undefined
  ) {
    const actual = getProperty<ScriptPropertyKey, unknown>(
      promise,
      "constructor",
      value,
      hooks,
    );
    if (hooks.sameValue(actual, constructor)) return value;
  }
  const capability = newPromiseCapability(constructor, realm, hooks);
  capability.resolve(value);
  return capability.promise;
}
