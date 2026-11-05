import { scriptBoolean } from "./values.ts";
import {
  getIteratorFromMethod,
  iteratorStep,
  iteratorStepValue,
  iteratorClose,
  type IteratorRecord,
  type IteratorHooks,
  type IteratorStep,
} from "../iterators/index.ts";
import {
  createDataProperty,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createArrayFromList } from "./array-like.ts";
import {
  viewObjectValue,
  getObjectValueProperty,
  callObjectValue,
} from "./values.ts";
import { isCallableObject } from "./call.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

export interface ScriptIterator {
  readonly record: IteratorRecord<unknown>;
  readonly hooks: IteratorHooks<unknown>;
}
/** Validate a receiver before arguments, without observing its next property. */
export function getScriptIteratorUnstarted(
  value: unknown,
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const hooks = createScriptIteratorHooks(realm, objectHooks);
  if (!hooks.isObject(value)) throw createRuntimeError(realm, "type");
  return {
    record: { iterator: value, nextMethod: undefined, done: false },
    hooks,
  };
}
/** Capture a direct iterator without consulting its iterable method. */
export function getScriptIteratorDirect(
  value: unknown,
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const hooks = createScriptIteratorHooks(realm, objectHooks);
  if (!hooks.isObject(value)) throw createRuntimeError(realm, "type");
  return {
    record: {
      iterator: value,
      nextMethod: hooks.get(value, "next"),
      done: false,
    },
    hooks,
  };
}
/** Callback validation precedes GetIteratorDirect and closes on failure. */
export function getScriptCallbackIterator(
  value: unknown,
  callback: unknown,
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const pending = getScriptIteratorUnstarted(value, realm, objectHooks);
  const hooks = pending.hooks;
  if (!hooks.isCallable(callback)) {
    const error = createRuntimeError(realm, "type");
    closeScriptIterator(pending, true);
    throw error;
  }
  return {
    record: {
      iterator: value,
      nextMethod: hooks.get(value, "next"),
      done: false,
    },
    hooks,
  };
}

export function createScriptIteratorHooks(
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): IteratorHooks<unknown> {
  return {
    undefinedValue: undefined,
    get: (object, key): unknown => {
      const result = getObjectValueProperty(object, key, objectHooks, realm);
      if (result.error === "unsupported")
        return rejectUnsupportedExecution(realm);
      if (result.error !== "none") throw createRuntimeError(realm, "type");
      return result.value;
    },
    call: (method, receiver, args): unknown => {
      const result = callObjectValue(
        method,
        receiver,
        args,
        realm.objectPrototype,
      );
      if (result.error !== "none") throw createRuntimeError(realm, "type");
      return result.value;
    },
    isObject: (object): boolean =>
      viewObjectValue(object, realm.objectPrototype) !== undefined,
    isCallable: (method): boolean =>
      isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(method, realm.objectPrototype),
      ),
    isNullish: (item): boolean => item === null || item === undefined,
    truthy: (item): boolean => scriptBoolean(item, realm.objectPrototype),
    typeError: (): unknown => createRuntimeError(realm, "type"),
  };
}
export function getScriptIterator(
  value: unknown,
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const hooks = createScriptIteratorHooks(realm, objectHooks);
  const method = getObjectValueProperty(
    value,
    wellKnownSymbol(realm.symbolRegistry, "iterator"),
    objectHooks,
    realm,
  );
  if (method.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (method.error !== "none") throw createRuntimeError(realm, "type");
  return {
    record: getIteratorFromMethod<unknown>(value, method.value, hooks),
    hooks,
  };
}
/** GetIteratorFlattenable accepts direct iterator objects as well as iterables. */
export function getScriptIteratorFlattenable(
  value: unknown,
  strings: "iterate" | "reject",
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const hooks = createScriptIteratorHooks(realm, objectHooks);
  if (
    !hooks.isObject(value) &&
    !(strings === "iterate" && typeof value === "string")
  )
    throw createRuntimeError(realm, "type");
  const method = getObjectValueProperty(
    value,
    wellKnownSymbol(realm.symbolRegistry, "iterator"),
    objectHooks,
    realm,
  );
  if (method.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (method.error !== "none") throw createRuntimeError(realm, "type");
  if (method.value !== undefined && method.value !== null)
    return {
      record: getIteratorFromMethod<unknown>(value, method.value, hooks),
      hooks,
    };
  if (!hooks.isObject(value)) throw createRuntimeError(realm, "type");
  return {
    record: {
      iterator: value,
      nextMethod: hooks.get(value, "next"),
      done: false,
    },
    hooks,
  };
}
export function stepScriptIterator(
  iterator: ScriptIterator,
): IteratorStep<unknown> {
  if (iterator.record.done) return { done: true, value: undefined };
  return iteratorStepValue<unknown>(iterator.record, iterator.hooks);
}
export function skipScriptIterator(iterator: ScriptIterator): void {
  if (!iterator.record.done)
    iteratorStep<unknown>(iterator.record, iterator.hooks);
}
/** Consume the remaining values into a fresh array. The enclosing syntax owns
 * IteratorClose if creating a property completes abruptly. */
export function collectScriptIterator(
  iterator: ScriptIterator,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const result = createArrayFromList([], 0, realm.arrayPrototype, realm, hooks);
  let index = 0;
  while (true) {
    const step = stepScriptIterator(iterator);
    if (step.done) break;
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        result,
        String(index),
        step.value,
        hooks,
      )
    )
      throw createRuntimeError(realm, "type");
    index++;
  }
  return result;
}
export function closeScriptIterator(
  iterator: ScriptIterator,
  throwing: boolean,
): void {
  if (iterator.record.done) return;
  iterator.record.done = true;
  iteratorClose<unknown>(iterator.record, throwing, iterator.hooks);
}

export function appendScriptArraySpread(
  array: OrdinaryObject<ScriptPropertyKey, unknown>,
  start: number,
  iterable: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const iterator = getScriptIterator(iterable, realm, hooks);
  let index = start;
  while (true) {
    const step = stepScriptIterator(iterator);
    if (step.done) break;
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        array,
        String(index),
        step.value,
        hooks,
      )
    )
      throw createRuntimeError(realm, "type");
    index++;
  }
  return index;
}
export function finishScriptArray(
  array: OrdinaryObject<ScriptPropertyKey, unknown>,
  length: number,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      array,
      "length",
      {
        fields: 1,
        value: length,
        writable: false,
        enumerable: false,
        configurable: false,
        get: undefined,
        set: undefined,
      },
      hooks,
    ) !== "accepted"
  )
    throw createRuntimeError(realm, "type");
}

/** Argument lists are internal native arrays, not observable Script arrays. */
export function appendScriptArguments(
  target: unknown[],
  iterable: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const iterator = getScriptIterator(iterable, realm, hooks);
  while (true) {
    const step = stepScriptIterator(iterator);
    if (step.done) break;
    target.push(step.value);
  }
}
