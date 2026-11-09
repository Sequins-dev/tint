import {
  emptyUpdate,
  valueField,
  writableField,
  enumerableField,
  configurableField,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import {
  createExoticObject,
  ordinaryDefineOwnProperty,
  getOwnProperty,
  deleteProperty,
  ownKeys,
  type OrdinaryObject,
  type ObjectHooks,
  type PropertyDefinitionResult,
} from "./operations.ts";
import {
  createArrayElements,
  truncateArrayElements,
  type ArrayObjectHooks,
} from "./array-elements.ts";
export type { ArrayObjectHooks } from "./array-elements.ts";
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
  const object = createExoticObject<Key, Value>(prototype, {
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
  });
  object.internalArrayData = true;
  object.internalArrayElements = createArrayElements<Key, Value>(
    array,
    hooks.undefinedValue,
  );
  requireLengthUpdate<Key, Value>(
    object,
    {
      ...emptyUpdate<Value>(hooks.undefinedValue),
      fields: valueField | writableField | enumerableField | configurableField,
      value: array.fromNumber(length === 0 ? 0 : length),
      writable: true,
    },
    array,
    hooks,
  );
  return object;
}
function requireLengthUpdate<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  update: DescriptorUpdate<Value>,
  array: ArrayObjectHooks<Key, Value>,
  hooks: ObjectHooks<Value>,
): void {
  if (
    ordinaryDefineOwnProperty<Key, Value>(
      object,
      array.lengthKey,
      update,
      hooks,
    ) !== "accepted"
  )
    throw "ARRAY_LENGTH_INVARIANT";
}
/** No deletion can fail or invoke user code when every remaining key is a
 * configurable index. Keep the length descriptor while releasing their storage. */
function clearConfigurableIndices<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  array: ArrayObjectHooks<Key, Value>,
): boolean {
  for (const [key, descriptor] of object.properties) {
    if (key === array.lengthKey) continue;
    if (!descriptor.configurable || array.index(key) < 0) return false;
  }
  const length = object.properties.get(array.lengthKey);
  if (length === undefined) throw "ARRAY_LENGTH_INVARIANT";
  const elements = object.internalArrayElements;
  if (elements !== undefined) truncateArrayElements<Key, Value>(elements, 0);
  object.properties.clear();
  object.properties.set(array.lengthKey, length);
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
    return ordinaryDefineOwnProperty<Key, Value>(
      object,
      array.lengthKey,
      update,
      hooks,
    );
  // The two conversions are intentionally separate: object coercion runs twice.
  const length = array.toNumber(update.value) >>> 0;
  if (length !== array.toNumber(update.value)) throw array.rangeError();
  let applied = { ...update, value: array.fromNumber(length) };
  const descriptor = getOwnProperty<Key, Value>(object, array.lengthKey);
  if (descriptor === undefined) throw "ARRAY_LENGTH_INVARIANT";
  if (length >= array.toNumber(descriptor.value))
    return ordinaryDefineOwnProperty<Key, Value>(
      object,
      array.lengthKey,
      applied,
      hooks,
    );
  if (!descriptor.writable) return "rejected";
  const makeReadOnly =
    (update.fields & writableField) !== 0 && !update.writable;
  if (makeReadOnly) applied = { ...applied, writable: true };
  const result = ordinaryDefineOwnProperty<Key, Value>(
    object,
    array.lengthKey,
    applied,
    hooks,
  );
  if (result !== "accepted") return result;
  // Packed elements are the only indices while present and all configurable,
  // so removing those at or above the new length cannot fail.
  const elements = object.internalArrayElements;
  if (elements !== undefined)
    truncateArrayElements<Key, Value>(elements, length);
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
