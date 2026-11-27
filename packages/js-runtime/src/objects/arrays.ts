import {
  emptyUpdate,
  valueField,
  writableField,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import {
  createPackedArrayObject,
  ordinaryDefineOwnProperty,
  getOwnProperty,
  deleteProperty,
  ownKeys,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectInternalMethods,
  type PropertyDefinitionResult,
} from "./operations.ts";
import {
  createArrayElements,
  truncateArrayElements,
  type ArrayElements,
  type ArrayObjectHooks,
} from "./array-elements.ts";
export type { ArrayObjectHooks } from "./array-elements.ts";
function arrayInternalMethods<Key, Value>(
  array: ArrayObjectHooks<Key, Value>,
): ObjectInternalMethods<Key, Value> {
  const existing = array.internalMethods;
  if (existing !== undefined) return existing;
  const created: ObjectInternalMethods<Key, Value> = {
    defineOwnProperty: (
      target,
      key,
      update,
      hooks,
    ): PropertyDefinitionResult => {
      if (key === array.lengthKey)
        return setArrayLength<Key, Value>(target, update, array, hooks);
      const index = array.index(key);
      if (index < 0)
        return ordinaryDefineOwnProperty<Key, Value>(
          target,
          key,
          update,
          hooks,
        );
      const elements = target.internalArrayElements;
      if (elements !== undefined) {
        const oldLength = elements.length;
        if (index >= oldLength && !elements.lengthWritable) return "rejected";
        const result = ordinaryDefineOwnProperty<Key, Value>(
          target,
          key,
          update,
          hooks,
        );
        if (result === "accepted" && index >= oldLength) {
          const after = target.internalArrayElements;
          if (after !== undefined) after.length = index + 1;
          else
            requireLengthUpdate<Key, Value>(
              target,
              {
                ...emptyUpdate<Value>(hooks.undefinedValue),
                fields: valueField,
                value: array.fromNumber(index + 1),
              },
              array,
              hooks,
            );
        }
        return result;
      }
      const descriptor = getOwnProperty<Key, Value>(target, array.lengthKey);
      if (descriptor === undefined) throw "ARRAY_LENGTH_INVARIANT";
      const oldLength = array.toNumber(descriptor.value);
      if (index >= oldLength && !descriptor.writable) return "rejected";
      const result = ordinaryDefineOwnProperty<Key, Value>(
        target,
        key,
        update,
        hooks,
      );
      if (result === "accepted" && index >= oldLength)
        requireLengthUpdate<Key, Value>(
          target,
          {
            ...emptyUpdate<Value>(hooks.undefinedValue),
            fields: valueField,
            value: array.fromNumber(index + 1),
          },
          array,
          hooks,
        );
      return result;
    },
  };
  array.internalMethods = created;
  return created;
}
/** Construct a compact array exotic object around prebuilt packed elements. */
export function createArrayWithElements<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
  array: ArrayObjectHooks<Key, Value>,
  elements: ArrayElements<Key, Value>,
): OrdinaryObject<Key, Value> {
  return createPackedArrayObject<Key, Value>(
    prototype,
    elements,
    arrayInternalMethods<Key, Value>(array),
  );
}
/** Elements start packed (see array-elements.ts); other indices use the same
 * descriptors as ordinary objects. Only property definition is exotic;
 * deleting an index never changes length. */
export function createArrayObject<Key, Value>(
  length: number,
  prototype: OrdinaryObject<Key, Value> | undefined,
  array: ArrayObjectHooks<Key, Value>,
  hooks: ObjectHooks<Value>,
): OrdinaryObject<Key, Value> {
  if (length < 0 || length > 4294967295 || Math.floor(length) !== length)
    throw array.rangeError();
  return createArrayWithElements<Key, Value>(
    prototype,
    array,
    createArrayElements<Key, Value>(array, hooks.undefinedValue, length),
  );
}
function defineLength<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  update: DescriptorUpdate<Value>,
  array: ArrayObjectHooks<Key, Value>,
  hooks: ObjectHooks<Value>,
): PropertyDefinitionResult {
  return ordinaryDefineOwnProperty<Key, Value>(
    object,
    array.lengthKey,
    update,
    hooks,
  );
}
function requireLengthUpdate<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  update: DescriptorUpdate<Value>,
  array: ArrayObjectHooks<Key, Value>,
  hooks: ObjectHooks<Value>,
): void {
  if (defineLength<Key, Value>(object, update, array, hooks) !== "accepted")
    throw "ARRAY_LENGTH_INVARIANT";
}
/** No deletion can fail or invoke user code when every remaining key is a
 * configurable index. Keep the length descriptor while releasing their storage. */
function clearConfigurableIndices<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  array: ArrayObjectHooks<Key, Value>,
): boolean {
  const properties = object.internalRareSlots?.properties;
  if (properties === undefined) throw "ARRAY_LENGTH_INVARIANT";
  for (const [key, descriptor] of properties) {
    if (key === array.lengthKey) continue;
    if (!descriptor.configurable || array.index(key) < 0) return false;
  }
  const length = properties.get(array.lengthKey);
  if (length === undefined) throw "ARRAY_LENGTH_INVARIANT";
  properties.clear();
  properties.set(array.lengthKey, length);
  object.internalPropertyEpoch++;
  return true;
}
function setArrayLength<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  update: DescriptorUpdate<Value>,
  array: ArrayObjectHooks<Key, Value>,
  hooks: ObjectHooks<Value>,
): PropertyDefinitionResult {
  if ((update.fields & valueField) === 0)
    return defineLength<Key, Value>(object, update, array, hooks);
  // The two conversions are intentionally separate: object coercion runs twice.
  const length = array.toNumber(update.value) >>> 0;
  if (length !== array.toNumber(update.value)) throw array.rangeError();
  let applied = { ...update, value: array.fromNumber(length) };
  const packed = object.internalArrayElements;
  let oldLength: number;
  let writable: boolean;
  if (packed !== undefined) {
    oldLength = packed.length;
    writable = packed.lengthWritable;
  } else {
    const descriptor = getOwnProperty<Key, Value>(object, array.lengthKey);
    if (descriptor === undefined) throw "ARRAY_LENGTH_INVARIANT";
    oldLength = array.toNumber(descriptor.value);
    writable = descriptor.writable;
  }
  if (length >= oldLength)
    return defineLength<Key, Value>(object, applied, array, hooks);
  if (!writable) return "rejected";
  const makeReadOnly =
    (update.fields & writableField) !== 0 && !update.writable;
  if (makeReadOnly) applied = { ...applied, writable: true };
  const result = defineLength<Key, Value>(object, applied, array, hooks);
  if (result !== "accepted") return result;
  // Packed elements are the only indices while present and all configurable,
  // so removing those at or above the new length cannot fail and the property
  // map holds no index keys to scan.
  const elements = object.internalArrayElements;
  if (elements !== undefined) {
    truncateArrayElements<Key, Value>(elements, length);
    if (makeReadOnly)
      requireLengthUpdate<Key, Value>(
        object,
        {
          ...emptyUpdate<Value>(hooks.undefinedValue),
          fields: writableField,
          writable: false,
        },
        array,
        hooks,
      );
    return "accepted";
  }
  // Sparse holes require no work; only present indices can block shrinking.
  const keys =
    length === 0 && clearConfigurableIndices<Key, Value>(object, array)
      ? []
      : ownKeys<Key, Value>(object, array.index);
  for (let position = keys.length - 1; position >= 0; position--) {
    const key = keys[position];
    if (key === undefined) throw "ARRAY_KEY_INVARIANT";
    const index = array.index(key);
    if (index < length) continue;
    if (!deleteProperty<Key, Value>(object, key)) {
      requireLengthUpdate<Key, Value>(
        object,
        {
          ...applied,
          value: array.fromNumber(index + 1),
          writable: !makeReadOnly,
        },
        array,
        hooks,
      );
      return "rejected";
    }
  }
  if (makeReadOnly)
    requireLengthUpdate<Key, Value>(
      object,
      {
        ...emptyUpdate<Value>(hooks.undefinedValue),
        fields: writableField,
        writable: false,
      },
      array,
      hooks,
    );
  return "accepted";
}
