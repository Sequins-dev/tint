import {
  createObject,
  createAliasedObject,
  createDataProperty,
  aliasDataProperty,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type DataAlias,
} from "./operations.ts";
import {
  emptyUpdate,
  valueField,
  writableField,
  enumerableField,
  configurableField,
  getField,
  setField,
} from "../descriptors/index.ts";

/** Embedding-owned keys and intrinsic identities, including the real iterator
 * symbol. Conversion callbacks are internal operations and cannot run user code. */
export interface ArgumentsIntrinsics<Key, Value> {
  readonly prototype: OrdinaryObject<Key, Value>;
  readonly lengthKey: Key;
  readonly calleeKey: Key;
  /** Undefined only for an embedding that explicitly lacks symbol/iterator support. */
  readonly iteratorKey: Key | undefined;
  readonly values: Value;
  readonly throwTypeError: Value;
  readonly indexKey: (index: number) => Key;
  readonly numberValue: (value: number) => Value;
}
/** Only sloppy functions with simple parameter lists provide a parameter map.
 * Binding callbacks access the parameter environment, never source accessors. */
export interface ArgumentsParameterMap<Value> {
  readonly names: readonly string[];
  readonly callee: Value;
  readonly binding: (name: string) => DataAlias<Value>;
}
export function createArgumentsObject<Key, Value>(
  args: readonly Value[],
  parameters: ArgumentsParameterMap<Value> | undefined,
  intrinsics: ArgumentsIntrinsics<Key, Value>,
  hooks: ObjectHooks<Value>,
): OrdinaryObject<Key, Value> {
  const object =
    parameters === undefined
      ? createObject<Key, Value>(intrinsics.prototype)
      : createAliasedObject<Key, Value>(intrinsics.prototype);
  object.internalArgumentsData = true;
  function data(key: Key, value: Value): void {
    const result = defineOwnProperty<Key, Value>(
      object,
      key,
      {
        ...emptyUpdate<Value>(hooks.undefinedValue),
        fields:
          valueField | writableField | enumerableField | configurableField,
        value,
        writable: true,
        enumerable: false,
        configurable: true,
      },
      hooks,
    );
    if (result !== "accepted") throw "ARGUMENTS_PROPERTY_INVARIANT";
  }
  // Unmapped creation defines length first; mapped creation defines indices first.
  if (parameters === undefined)
    data(intrinsics.lengthKey, intrinsics.numberValue(args.length));
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    // Value may itself include undefined, which is a valid supplied argument.
    if (
      !createDataProperty<Key, Value>(
        object,
        intrinsics.indexKey(index),
        value === undefined ? hooks.undefinedValue : value,
        hooks,
      )
    )
      throw "ARGUMENTS_PROPERTY_INVARIANT";
  }
  if (parameters !== undefined) {
    data(intrinsics.lengthKey, intrinsics.numberValue(args.length));
    const mapping = parameters;
    const mappedNames = new Set<string>();
    for (let index = mapping.names.length - 1; index >= 0; index--) {
      const name = mapping.names[index];
      if (name === undefined) throw "ARGUMENTS_PARAMETER_INVARIANT";
      if (mappedNames.has(name)) continue;
      mappedNames.add(name);
      if (index < args.length)
        aliasDataProperty<Key, Value>(
          object,
          intrinsics.indexKey(index),
          mapping.binding(name),
        );
    }
  }
  const iteratorKey = intrinsics.iteratorKey;
  if (iteratorKey !== undefined) data(iteratorKey, intrinsics.values);
  if (parameters !== undefined) data(intrinsics.calleeKey, parameters.callee);
  else {
    const result = defineOwnProperty<Key, Value>(
      object,
      intrinsics.calleeKey,
      {
        ...emptyUpdate<Value>(hooks.undefinedValue),
        fields: getField | setField | enumerableField | configurableField,
        get: intrinsics.throwTypeError,
        set: intrinsics.throwTypeError,
      },
      hooks,
    );
    if (result !== "accepted") throw "ARGUMENTS_PROPERTY_INVARIANT";
  }
  return object;
}
