import {
  valueField,
  writableField,
  getField,
  setField,
  enumerableField,
  configurableField,
  type Descriptor,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import {
  createObject,
  createDataProperty,
  hasProperty,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
export interface DescriptorKeys<Key> {
  readonly value: Key;
  readonly writable: Key;
  readonly get: Key;
  readonly set: Key;
  readonly enumerable: Key;
  readonly configurable: Key;
}
export interface DescriptorConversion<Value> {
  /** A non-none error must become a TypeError at the JavaScript boundary. */
  readonly error: "none" | "getter" | "setter" | "mixed";
  readonly update: DescriptorUpdate<Value>;
}
/** The caller has already checked that the input is an object. Preserve Has/Get
 * sequencing: getters may change later fields or throw. */
export function toPropertyDescriptor<Key, Value>(
  source: OrdinaryObject<Key, Value>,
  receiver: Value,
  keys: DescriptorKeys<Key>,
  hooks: ObjectHooks<Value>,
  toBoolean: (value: Value) => boolean,
  isCallable: (value: Value) => boolean,
): DescriptorConversion<Value> {
  let fields = 0,
    value = hooks.undefinedValue,
    get = hooks.undefinedValue,
    set = hooks.undefinedValue;
  let writable = false,
    enumerable = false,
    configurable = false;
  function finish(
    error: "none" | "getter" | "setter" | "mixed",
  ): DescriptorConversion<Value> {
    return {
      error,
      update: { fields, value, writable, get, set, enumerable, configurable },
    };
  }
  if (hasProperty<Key, Value>(source, keys.enumerable)) {
    enumerable = toBoolean(
      getProperty<Key, Value>(source, keys.enumerable, receiver, hooks),
    );
    fields |= enumerableField;
  }
  if (hasProperty<Key, Value>(source, keys.configurable)) {
    configurable = toBoolean(
      getProperty<Key, Value>(source, keys.configurable, receiver, hooks),
    );
    fields |= configurableField;
  }
  if (hasProperty<Key, Value>(source, keys.value)) {
    value = getProperty<Key, Value>(source, keys.value, receiver, hooks);
    fields |= valueField;
  }
  if (hasProperty<Key, Value>(source, keys.writable)) {
    writable = toBoolean(
      getProperty<Key, Value>(source, keys.writable, receiver, hooks),
    );
    fields |= writableField;
  }
  if (hasProperty<Key, Value>(source, keys.get)) {
    get = getProperty<Key, Value>(source, keys.get, receiver, hooks);
    if (!isCallable(get) && !hooks.sameValue(get, hooks.undefinedValue))
      return finish("getter");
    fields |= getField;
  }
  if (hasProperty<Key, Value>(source, keys.set)) {
    set = getProperty<Key, Value>(source, keys.set, receiver, hooks);
    if (!isCallable(set) && !hooks.sameValue(set, hooks.undefinedValue))
      return finish("setter");
    fields |= setField;
  }
  return finish(
    (fields & (getField | setField)) !== 0 &&
      (fields & (valueField | writableField)) !== 0
      ? "mixed"
      : "none",
  );
}
/** Export complete internal state as a fresh ordinary descriptor object. */
export function fromPropertyDescriptor<Key, Value>(
  descriptor: Descriptor<Value> | undefined,
  prototype: OrdinaryObject<Key, Value> | undefined,
  keys: DescriptorKeys<Key>,
  hooks: ObjectHooks<Value>,
  fromBoolean: (value: boolean) => Value,
): OrdinaryObject<Key, Value> | undefined {
  if (descriptor === undefined) return undefined;
  return fromPropertyDescriptorUpdate<Key, Value>(
    {
      fields: descriptor.accessor ? 60 : 51,
      value: descriptor.value,
      writable: descriptor.writable,
      get: descriptor.get,
      set: descriptor.set,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
    },
    prototype,
    keys,
    hooks,
    fromBoolean,
  );
}
/** Export only present fields; Proxy defineProperty observes partial descriptors. */
export function fromPropertyDescriptorUpdate<Key, Value>(
  descriptor: DescriptorUpdate<Value>,
  prototype: OrdinaryObject<Key, Value> | undefined,
  keys: DescriptorKeys<Key>,
  hooks: ObjectHooks<Value>,
  fromBoolean: (value: boolean) => Value,
): OrdinaryObject<Key, Value> {
  const object = createObject<Key, Value>(prototype);
  function add(key: Key, value: Value): void {
    if (!createDataProperty<Key, Value>(object, key, value, hooks))
      throw "DESCRIPTOR_EXPORT_INVARIANT";
  }
  if ((descriptor.fields & valueField) !== 0) add(keys.value, descriptor.value);
  if ((descriptor.fields & writableField) !== 0)
    add(keys.writable, fromBoolean(descriptor.writable));
  if ((descriptor.fields & getField) !== 0) add(keys.get, descriptor.get);
  if ((descriptor.fields & setField) !== 0) add(keys.set, descriptor.set);
  if ((descriptor.fields & enumerableField) !== 0)
    add(keys.enumerable, fromBoolean(descriptor.enumerable));
  if ((descriptor.fields & configurableField) !== 0)
    add(keys.configurable, fromBoolean(descriptor.configurable));
  return object;
}
