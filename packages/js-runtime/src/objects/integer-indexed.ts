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
  function descriptor(index: number): Descriptor<Value> {
    const mutable = elements.mutable();
    return {
      accessor: false,
      value: elements.read(index),
      writable: mutable,
      enumerable: true,
      configurable: mutable,
      get: hooks.undefinedValue,
      set: hooks.undefinedValue,
    };
  }
  return createExoticObject<Key, Value>(prototype, {
    getOwnProperty: (object, key) => {
      const index = elements.numericIndex(key);
      if (index === undefined)
        return ordinaryGetOwnProperty<Key, Value>(object, key);
      if (!elements.valid(index)) return undefined;
      return descriptor(index);
    },
    defineOwnProperty: (object, key, update, h) => {
      const index = elements.numericIndex(key);
      if (index === undefined)
        return ordinaryDefineOwnProperty<Key, Value>(object, key, update, h);
      if (!elements.valid(index)) return "rejected";
      if (!elements.mutable())
        return applyDescriptor<Value>(
          descriptor(index),
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
        elements.write(index, update.value);
      return "accepted";
    },
    get: (object, key, receiver, h) => {
      const index = elements.numericIndex(key);
      if (index === undefined)
        return ordinaryGetProperty<Key, Value>(object, key, receiver, h);
      return elements.valid(index)
        ? elements.read(index)
        : hooks.undefinedValue;
    },
    hasProperty: (object, key) => {
      const index = elements.numericIndex(key);
      return index === undefined
        ? ordinaryHasProperty<Key, Value>(object, key)
        : elements.valid(index);
    },
    set: (object, key, value, receiver, h) => {
      const index = elements.numericIndex(key);
      if (index !== undefined) {
        if (!elements.mutable()) return false;
        if (receiver.object === object) {
          elements.write(index, value);
          return true;
        }
        if (!elements.valid(index)) return true;
      }
      return ordinarySetProperty<Key, Value>(object, key, value, receiver, h);
    },
    deleteProperty: (object, key) => {
      const index = elements.numericIndex(key);
      return index === undefined
        ? ordinaryDeleteProperty<Key, Value>(object, key)
        : !elements.valid(index);
    },
    ownKeys: (object) => {
      const keys: Key[] = [],
        length = elements.length();
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
      if (!elements.canPreventExtensions()) return false;
      object.extensible = false;
      return true;
    },
  });
}
