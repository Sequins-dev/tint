import {
  hasProperty,
  getProperty,
  setProperty,
  deleteProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "../../objects/index.ts";
import type { BindingError, BindingResult } from "../records/index.ts";

export interface ObjectEnvironmentHooks<Key, Value> extends ObjectHooks<Value> {
  readonly keyForName: (name: string) => Key;
  readonly unscopablesKey: Key;
  readonly asObject: (value: Value) => OrdinaryObject<Key, Value> | undefined;
  readonly truthy: (value: Value) => boolean;
}

export interface ObjectEnvironment<Key, Value> {
  readonly object: OrdinaryObject<Key, Value>;
  readonly objectValue: Value;
  readonly withEnvironment: boolean;
  readonly hooks: ObjectEnvironmentHooks<Key, Value>;
}

export function createObjectEnvironment<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  objectValue: Value,
  withEnvironment: boolean,
  hooks: ObjectEnvironmentHooks<Key, Value>,
): ObjectEnvironment<Key, Value> {
  return { object, objectValue, withEnvironment, hooks };
}

/** Only resolution consults @@unscopables; retained references never re-filter. */
export function hasObjectBinding<Key, Value>(
  record: ObjectEnvironment<Key, Value>,
  name: string,
): boolean {
  const hooks = record.hooks;
  const key = hooks.keyForName(name);
  if (!hasProperty<Key, Value>(record.object, key)) return false;
  if (!record.withEnvironment) return true;
  const value = getProperty<Key, Value>(
    record.object,
    hooks.unscopablesKey,
    record.objectValue,
    hooks,
  );
  const blocked = hooks.asObject(value);
  return (
    blocked === undefined ||
    !hooks.truthy(getProperty<Key, Value>(blocked, key, value, hooks))
  );
}

export function getObjectBinding<Key, Value>(
  record: ObjectEnvironment<Key, Value>,
  name: string,
  strict: boolean,
): BindingResult<Value> {
  const key = record.hooks.keyForName(name);
  if (!hasProperty<Key, Value>(record.object, key))
    return {
      error: strict ? "reference" : "none",
      value: record.hooks.undefinedValue,
    };
  return {
    error: "none",
    value: getProperty<Key, Value>(
      record.object,
      key,
      record.objectValue,
      record.hooks,
    ),
  };
}

export function setObjectBinding<Key, Value>(
  record: ObjectEnvironment<Key, Value>,
  name: string,
  value: Value,
  strict: boolean,
): BindingError {
  const key = record.hooks.keyForName(name);
  if (!hasProperty<Key, Value>(record.object, key) && strict)
    return "reference";
  const accepted = setProperty<Key, Value>(
    record.object,
    key,
    value,
    { value: record.objectValue, object: record.object },
    record.hooks,
  );
  return !accepted && strict ? "type" : "none";
}

export function deleteObjectBinding<Key, Value>(
  record: ObjectEnvironment<Key, Value>,
  name: string,
): boolean {
  return deleteProperty<Key, Value>(
    record.object,
    record.hooks.keyForName(name),
  );
}
