import {
  getScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import { viewObjectValue, callObjectValue } from "./values.ts";
import { isCallableObject } from "./call.ts";
import { propertyKeyValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

export interface PropertyGroup {
  readonly key: ScriptPropertyKey;
  readonly values: unknown[];
}
/** Shared GroupBy traversal; key conversion and storage errors close the iterator. */
export function forEachGroupItem(
  items: unknown,
  callback: unknown,
  append: (key: unknown, value: unknown) => void,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    items === null ||
    items === undefined ||
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(callback, realm.objectPrototype),
    )
  )
    throw createRuntimeError(realm, "type");
  const iterator = getScriptIterator(items, realm, hooks);
  let index = 0;
  while (true) {
    if (index >= 9007199254740991) {
      closeScriptIterator(iterator, true);
      throw createRuntimeError(realm, "type");
    }
    const step = stepScriptIterator(iterator);
    if (step.done) return;
    try {
      const called = callObjectValue(
        callback,
        undefined,
        [step.value, index],
        realm.objectPrototype,
      );
      if (called.error !== "none") throw createRuntimeError(realm, "type");
      append(called.value, step.value);
    } catch (error) {
      closeScriptIterator(iterator, true);
      throw error;
    }
    index++;
  }
}

/** GroupBy with property keys. Collection construction happens after iteration. */
export function groupByProperty(
  items: unknown,
  callback: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): PropertyGroup[] {
  const groups: PropertyGroup[] = [];
  const byKey = new Map<ScriptPropertyKey, PropertyGroup>();
  forEachGroupItem(
    items,
    callback,
    (keyValue, item): void => {
      const converted = propertyKeyValue(keyValue, hooks, realm);
      if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
      if (converted.error !== "none") throw createRuntimeError(realm, "type");
      const key = converted.value;
      let group = byKey.get(key);
      if (group === undefined) {
        group = { key, values: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.values.push(item);
    },
    realm,
    hooks,
  );
  return groups;
}
