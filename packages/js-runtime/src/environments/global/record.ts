import {
  createDeclarativeEnvironment,
  hasBinding,
  getBindingValue,
  setMutableBinding,
  deleteBinding,
  type DeclarativeEnvironment,
  type BindingError,
  type BindingResult,
} from "../records/index.ts";
import {
  isExtensible,
  getOwnProperty,
  hasProperty,
  getProperty,
  isOrdinaryPrototypeChain,
  findOrdinaryProperty,
  setProperty,
  defineOwnProperty,
  deleteProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "../../objects/index.ts";
import {
  emptyUpdate,
  valueField,
  writableField,
  enumerableField,
  configurableField,
} from "../../descriptors/index.ts";
/** Ordinary global objects only. keyForName is an internal canonical-key mapping,
 * never user code. thisValue can differ from the binding object's value. */
export interface GlobalEnvironment<Key, Value> {
  readonly lexical: DeclarativeEnvironment<Value>;
  readonly object: OrdinaryObject<Key, Value>;
  readonly objectValue: Value;
  readonly thisValue: Value;
  readonly keyForName: (name: string) => Key;
  readonly hooks: ObjectHooks<Value>;
  /** Bumped whenever a global lexical binding is created or deleted, so a
   * cached global object property is known not to be shadowed. */
  lexicalEpoch: number;
}
export function createGlobalEnvironment<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  objectValue: Value,
  thisValue: Value,
  keyForName: (name: string) => Key,
  hooks: ObjectHooks<Value>,
): GlobalEnvironment<Key, Value> {
  return {
    lexical: createDeclarativeEnvironment<Value>(hooks.undefinedValue),
    object,
    objectValue,
    thisValue,
    keyForName,
    hooks,
    lexicalEpoch: 0,
  };
}
export function hasGlobalBinding<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
): boolean {
  return (
    hasBinding<Value>(record.lexical, name) ||
    hasProperty<Key, Value>(record.object, record.keyForName(name))
  );
}
export function getGlobalBinding<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
  strict: boolean,
): BindingResult<Value> {
  if (hasBinding<Value>(record.lexical, name))
    return getBindingValue<Value>(record.lexical, name);
  const key = record.keyForName(name);
  // HasProperty then Get is one unobservable walk on an all-ordinary chain.
  if (isOrdinaryPrototypeChain<Key, Value>(record.object)) {
    const descriptor = findOrdinaryProperty<Key, Value>(record.object, key);
    if (descriptor === undefined)
      return {
        error: strict ? "reference" : "none",
        value: record.hooks.undefinedValue,
      };
    if (!descriptor.accessor) return { error: "none", value: descriptor.value };
    const hooks = record.hooks;
    return {
      error: "none",
      value: hooks.sameValue(descriptor.get, hooks.undefinedValue)
        ? hooks.undefinedValue
        : hooks.call(descriptor.get, record.objectValue, []),
    };
  }
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
export function setGlobalBinding<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
  value: Value,
  strict: boolean,
): BindingError {
  if (hasBinding<Value>(record.lexical, name))
    return setMutableBinding<Value>(record.lexical, name, value, strict);
  const key = record.keyForName(name);
  if (strict && !hasProperty<Key, Value>(record.object, key))
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
export function deleteGlobalBinding<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
): boolean {
  if (hasBinding<Value>(record.lexical, name)) {
    const deleted = deleteBinding<Value>(record.lexical, name);
    if (deleted) record.lexicalEpoch++;
    return deleted;
  }
  return deleteProperty<Key, Value>(record.object, record.keyForName(name));
}
export function hasRestrictedGlobalProperty<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
): boolean {
  const existing = getOwnProperty<Key, Value>(
    record.object,
    record.keyForName(name),
  );
  return existing !== undefined && !existing.configurable;
}
export function canDeclareGlobalVar<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
): boolean {
  return (
    getOwnProperty<Key, Value>(record.object, record.keyForName(name)) !==
      undefined || isExtensible<Key, Value>(record.object)
  );
}
export function canDeclareGlobalFunction<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
): boolean {
  const existing = getOwnProperty<Key, Value>(
    record.object,
    record.keyForName(name),
  );
  return existing === undefined
    ? isExtensible<Key, Value>(record.object)
    : existing.configurable ||
        (!existing.accessor && existing.writable && existing.enumerable);
}
/** Declaration instantiation must check admission and lexical conflicts first.
 * Existing own properties retain their values and attributes. */
export function createGlobalVarBinding<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
  deletable: boolean,
): BindingError {
  const key = record.keyForName(name);
  if (
    getOwnProperty<Key, Value>(record.object, key) !== undefined ||
    !isExtensible<Key, Value>(record.object)
  )
    return "none";
  const status = defineOwnProperty<Key, Value>(
    record.object,
    key,
    {
      ...emptyUpdate<Value>(record.hooks.undefinedValue),
      fields: valueField | writableField | enumerableField | configurableField,
      writable: true,
      enumerable: true,
      configurable: deletable,
    },
    record.hooks,
  );
  return status === "accepted" ? "none" : "type";
}
/** Caller has verified callable value and declaration admission. */
export function createGlobalFunctionBinding<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  name: string,
  value: Value,
  deletable: boolean,
): BindingError {
  const key = record.keyForName(name),
    existing = getOwnProperty<Key, Value>(record.object, key);
  const fields =
    existing === undefined || existing.configurable
      ? valueField | writableField | enumerableField | configurableField
      : valueField;
  const status = defineOwnProperty<Key, Value>(
    record.object,
    key,
    {
      ...emptyUpdate<Value>(record.hooks.undefinedValue),
      fields,
      value,
      writable: true,
      enumerable: true,
      configurable: deletable,
    },
    record.hooks,
  );
  if (status !== "accepted") return "type";
  // For an ordinary object the newly defined own data property has no hooks.
  setProperty<Key, Value>(
    record.object,
    key,
    value,
    { value: record.objectValue, object: record.object },
    record.hooks,
  );
  return "none";
}
