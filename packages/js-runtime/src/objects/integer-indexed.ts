import {
  applyDescriptor,
  type Descriptor,
  configurableField,
  enumerableField,
  writableField,
  valueField,
  getField,
  setField,
} from "../descriptors/index.ts";
import {
  createExoticObject,
  ordinaryGetOwnProperty,
  ordinaryDefineOwnProperty,
  ordinaryGetProperty,
  ordinarySetProperty,
  ordinaryHasProperty,
  ordinaryDeleteProperty,
  ordinaryOwnKeys,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectInternalMethods,
} from "./operations.ts";

/** Storage and key policy for ECMA-262 10.4.5 integer-indexed exotic methods.
 * Classification, validity, reads and length must not execute user code.
 * Mutable write MUST coerce the value before rechecking validity, even for invalid indices.
 * length returns zero for detached/out-of-bounds storage. */
export interface IntegerIndexedHooks<Key, Value> {
  readonly mutable: () => boolean;
  readonly numericIndex: (key: Key) => number | undefined;
  readonly valid: (index: number) => boolean;
  readonly read: (index: number) => Value;
  readonly write: (index: number, value: Value) => void;
  readonly length: () => number;
  readonly fromIndex: (index: number) => Key;
  readonly keyOrder: (key: Key) => number;
  /** False whenever resizing can remove and subsequently restore indexed keys. */
  readonly canPreventExtensions: () => boolean;
}
export function createIntegerIndexedObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
  elements: IntegerIndexedHooks<Key, Value>,
  hooks: ObjectHooks<Value>,
): OrdinaryObject<Key, Value> {
  const methods = createIntegerIndexedMethods<
    Key,
    Value,
    IntegerIndexedHooks<Key, Value>
  >(
    (_object) => elements,
    {
      mutable: (state) => state.mutable(),
      numericIndex: (key) => elements.numericIndex(key),
      valid: (state, index) => state.valid(index),
      read: (state, index) => state.read(index),
      write: (state, index, value) => state.write(index, value),
      length: (state) => state.length(),
      fromIndex: (index) => elements.fromIndex(index),
      keyOrder: (key) => elements.keyOrder(key),
      canPreventExtensions: (state) => state.canPreventExtensions(),
    },
    hooks,
  );
  return createExoticObject<Key, Value>(prototype, methods);
}

interface IntegerIndexedAccess<Key, Value, State> {
  readonly mutable: (state: State) => boolean;
  readonly numericIndex: (key: Key) => number | undefined;
  readonly valid: (state: State, index: number) => boolean;
  readonly read: (state: State, index: number) => Value;
  readonly write: (state: State, index: number, value: Value) => void;
  readonly length: (state: State) => number;
  readonly fromIndex: (index: number) => Key;
  readonly keyOrder: (key: Key) => number;
  readonly canPreventExtensions: (state: State) => boolean;
}

/** Reuse the exotic methods when an object's internal slots hold its state. */
export function createIntegerIndexedMethods<Key, Value, State>(
  stateOf: (object: OrdinaryObject<Key, Value>) => State,
  elements: IntegerIndexedAccess<Key, Value, State>,
  hooks: ObjectHooks<Value>,
): ObjectInternalMethods<Key, Value> {
  function descriptor(state: State, index: number): Descriptor<Value> {
    const mutable = elements.mutable(state);
    return {
      accessor: false,
      value: elements.read(state, index),
      writable: mutable,
      enumerable: true,
      configurable: mutable,
      get: hooks.undefinedValue,
      set: hooks.undefinedValue,
    };
  }
  return {
    getOwnProperty: (object, key) => {
      const index = elements.numericIndex(key);
      if (index === undefined)
        return ordinaryGetOwnProperty<Key, Value>(object, key);
      const state = stateOf(object);
      if (!elements.valid(state, index)) return undefined;
      return descriptor(state, index);
    },
    defineOwnProperty: (object, key, update, h) => {
      const index = elements.numericIndex(key);
      if (index === undefined)
        return ordinaryDefineOwnProperty<Key, Value>(object, key, update, h);
      const state = stateOf(object);
      if (!elements.valid(state, index)) return "rejected";
      if (!elements.mutable(state))
        return applyDescriptor<Value>(
          descriptor(state, index),
          false,
          update,
          h.undefinedValue,
          h.sameValue,
        ).status;
      if (
        ((update.fields & configurableField) !== 0 && !update.configurable) ||
        ((update.fields & enumerableField) !== 0 && !update.enumerable) ||
        ((update.fields & writableField) !== 0 && !update.writable) ||
        (update.fields & (getField | setField)) !== 0
      )
        return "rejected";
      if ((update.fields & valueField) !== 0)
        elements.write(state, index, update.value);
      return "accepted";
    },
    get: (object, key, receiver, h) => {
      const index = elements.numericIndex(key);
      if (index === undefined)
        return ordinaryGetProperty<Key, Value>(object, key, receiver, h);
      const state = stateOf(object);
      return elements.valid(state, index)
        ? elements.read(state, index)
        : hooks.undefinedValue;
    },
    hasProperty: (object, key) => {
      const index = elements.numericIndex(key);
      return index === undefined
        ? ordinaryHasProperty<Key, Value>(object, key)
        : elements.valid(stateOf(object), index);
    },
    set: (object, key, value, receiver, h) => {
      const index = elements.numericIndex(key);
      if (index !== undefined) {
        const state = stateOf(object);
        if (!elements.mutable(state)) return false;
        if (receiver.object === object) {
          elements.write(state, index, value);
          return true;
        }
        if (!elements.valid(state, index)) return true;
      }
      return ordinarySetProperty<Key, Value>(object, key, value, receiver, h);
    },
    deleteProperty: (object, key) => {
      const index = elements.numericIndex(key);
      return index === undefined
        ? ordinaryDeleteProperty<Key, Value>(object, key)
        : !elements.valid(stateOf(object), index);
    },
    ownKeys: (object) => {
      const keys: Key[] = [],
        length = elements.length(stateOf(object));
      for (let i = 0; i < length; i++) keys.push(elements.fromIndex(i));
      const ordinary = ordinaryOwnKeys<Key, Value>(object, elements.keyOrder);
      for (let i = 0; i < ordinary.length; i++) {
        const key = ordinary[i];
        if (key === undefined) throw "INTEGER_INDEXED_KEY_INVARIANT";
        keys.push(key);
      }
      return keys;
    },
    preventExtensions: (object) => {
      if (!elements.canPreventExtensions(stateOf(object))) return false;
      object.extensible = false;
      return true;
    },
  };
}
