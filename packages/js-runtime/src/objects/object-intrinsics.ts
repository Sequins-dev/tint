import { groupByProperty } from "./grouping.ts";
import { addEntriesFromIterable } from "./entry-iteration.ts";
import { createArray2, createArrayFromList } from "./array-like.ts";
import { scriptBoolean, scriptSameValue, viewObjectValue } from "./values.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import {
  isExtensible,
  getPrototype,
  createObject,
  createConstructorObject,
  createDataProperty,
  defineOwnProperty,
  getOwnProperty,
  getProperty,
  ordinaryHasOwnProperty,
  ownKeys,
  preventExtensions,
  propertyEpoch,
  setPrototype,
  setProperty,
  storedValue,
  objectFlagDictionary,
  propertyAccessor,
  propertyEnumerable,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";
import {
  toPropertyDescriptor,
  fromPropertyDescriptor,
  type DescriptorKeys,
} from "./descriptors.ts";
import {
  configurableField,
  enumerableField,
  getField,
  setField,
  valueField,
  writableField,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { isCallableObject } from "./call.ts";
import { propertyKeyValue } from "./coercion.ts";
import { createArrayObject } from "./arrays.ts";
import { setIntegrityLevel, testIntegrityLevel } from "./integrity.ts";
import { toObjectValue } from "./boxing.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

let cachedDescriptorRealm: ErrorRealm | undefined = undefined;
let cachedDescriptorProtoEpoch = -1;

const standardDescriptorKeys: DescriptorKeys<ScriptPropertyKey> = {
  value: "value",
  writable: "writable",
  get: "get",
  set: "set",
  enumerable: "enumerable",
  configurable: "configurable",
};

function isDescriptorProtoClean(realm: ErrorRealm): boolean {
  const epoch = propertyEpoch.value;
  if (cachedDescriptorRealm === realm && cachedDescriptorProtoEpoch === epoch)
    return true;
  let cursor: OrdinaryObject<ScriptPropertyKey, unknown> | undefined =
    realm.objectPrototype;
  while (cursor !== undefined) {
    if (
      getOwnProperty<ScriptPropertyKey, unknown>(cursor, "enumerable") !==
        undefined ||
      getOwnProperty<ScriptPropertyKey, unknown>(cursor, "configurable") !==
        undefined ||
      getOwnProperty<ScriptPropertyKey, unknown>(cursor, "value") !==
        undefined ||
      getOwnProperty<ScriptPropertyKey, unknown>(cursor, "writable") !==
        undefined ||
      getOwnProperty<ScriptPropertyKey, unknown>(cursor, "get") !== undefined ||
      getOwnProperty<ScriptPropertyKey, unknown>(cursor, "set") !== undefined
    )
      return false;
    cursor = cursor.prototype;
  }
  cachedDescriptorRealm = realm;
  cachedDescriptorProtoEpoch = epoch;
  return true;
}

function readDescriptorUpdate(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): DescriptorUpdate<unknown> {
  const source = viewObjectValue(value, realm.objectPrototype);
  if (source === undefined) throw createRuntimeError(realm, "type");
  const methods = source.internalMethods;
  const recordAccess = methods?.recordViewAccess;
  const rare = source.internalRareSlots;
  const rareProps = rare?.properties;
  if (
    recordAccess !== undefined &&
    source.prototype === realm.objectPrototype &&
    source.internalShape === undefined &&
    (rareProps === undefined || rareProps.size === 0) &&
    isDescriptorProtoClean(realm)
  ) {
    const access = recordAccess;
    const recordKeys = access.keys;
    let fields = 0,
      val: unknown = hooks.undefinedValue,
      get: unknown = hooks.undefinedValue,
      set: unknown = hooks.undefinedValue,
      writable = false,
      enumerable = false,
      configurable = false;
    for (let i = 0; i < recordKeys.length; i++) {
      const k = recordKeys[i];
      if (k === "value") {
        val = access.read(i);
        fields |= valueField;
      } else if (k === "writable") {
        writable = scriptBoolean(access.read(i), realm.objectPrototype);
        fields |= writableField;
      } else if (k === "enumerable") {
        enumerable = scriptBoolean(access.read(i), realm.objectPrototype);
        fields |= enumerableField;
      } else if (k === "configurable") {
        configurable = scriptBoolean(access.read(i), realm.objectPrototype);
        fields |= configurableField;
      } else if (k === "get") {
        get = access.read(i);
        if (
          get !== undefined &&
          !isCallableObject<ScriptPropertyKey, unknown>(
            viewObjectValue(get, realm.objectPrototype),
          )
        )
          throw createRuntimeError(realm, "type");
        fields |= getField;
      } else if (k === "set") {
        set = access.read(i);
        if (
          set !== undefined &&
          !isCallableObject<ScriptPropertyKey, unknown>(
            viewObjectValue(set, realm.objectPrototype),
          )
        )
          throw createRuntimeError(realm, "type");
        fields |= setField;
      }
    }
    if (
      (fields & (getField | setField)) !== 0 &&
      (fields & (valueField | writableField)) !== 0
    )
      throw createRuntimeError(realm, "type");
    return {
      fields,
      value: val,
      writable,
      get,
      set,
      enumerable,
      configurable,
    };
  }
  if (
    methods === undefined &&
    source.internalArrayElements === undefined &&
    (source.internalFlags & objectFlagDictionary) === 0 &&
    source.prototype === realm.objectPrototype &&
    source.internalRareSlots?.internalDataAliases === undefined &&
    isDescriptorProtoClean(realm)
  ) {
    const shape = source.internalShape;
    if (shape === undefined)
      return {
        fields: 0,
        value: hooks.undefinedValue,
        writable: false,
        get: hooks.undefinedValue,
        set: hooks.undefinedValue,
        enumerable: false,
        configurable: false,
      };
    const shapeKeys = shape.keys,
      kinds = shape.kinds;
    let hasAccessor = false;
    for (let i = 0; i < shapeKeys.length; i++) {
      if (((kinds[i] ?? 0) & propertyAccessor) !== 0) {
        hasAccessor = true;
        break;
      }
    }
    if (!hasAccessor) {
      let fields = 0,
        val: unknown = hooks.undefinedValue,
        get: unknown = hooks.undefinedValue,
        set: unknown = hooks.undefinedValue,
        writable = false,
        enumerable = false,
        configurable = false;
      for (let i = 0; i < shapeKeys.length; i++) {
        const k = shapeKeys[i];
        if (k === "value") {
          const raw = storedValue<ScriptPropertyKey, unknown>(source, i);
          val = raw === undefined ? shape.undefinedValue : raw;
          fields |= valueField;
        } else if (k === "writable") {
          const raw = storedValue<ScriptPropertyKey, unknown>(source, i);
          writable = scriptBoolean(
            raw === undefined ? shape.undefinedValue : raw,
            realm.objectPrototype,
          );
          fields |= writableField;
        } else if (k === "enumerable") {
          const raw = storedValue<ScriptPropertyKey, unknown>(source, i);
          enumerable = scriptBoolean(
            raw === undefined ? shape.undefinedValue : raw,
            realm.objectPrototype,
          );
          fields |= enumerableField;
        } else if (k === "configurable") {
          const raw = storedValue<ScriptPropertyKey, unknown>(source, i);
          configurable = scriptBoolean(
            raw === undefined ? shape.undefinedValue : raw,
            realm.objectPrototype,
          );
          fields |= configurableField;
        } else if (k === "get") {
          const raw = storedValue<ScriptPropertyKey, unknown>(source, i);
          get = raw === undefined ? shape.undefinedValue : raw;
          if (
            get !== undefined &&
            !isCallableObject<ScriptPropertyKey, unknown>(
              viewObjectValue(get, realm.objectPrototype),
            )
          )
            throw createRuntimeError(realm, "type");
          fields |= getField;
        } else if (k === "set") {
          const raw = storedValue<ScriptPropertyKey, unknown>(source, i);
          set = raw === undefined ? shape.undefinedValue : raw;
          if (
            set !== undefined &&
            !isCallableObject<ScriptPropertyKey, unknown>(
              viewObjectValue(set, realm.objectPrototype),
            )
          )
            throw createRuntimeError(realm, "type");
          fields |= setField;
        }
      }
      if (
        (fields & (getField | setField)) !== 0 &&
        (fields & (valueField | writableField)) !== 0
      )
        throw createRuntimeError(realm, "type");
      return {
        fields,
        value: val,
        writable,
        get,
        set,
        enumerable,
        configurable,
      };
    }
  }
  const result = toPropertyDescriptor<ScriptPropertyKey, unknown>(
    source,
    value,
    standardDescriptorKeys,
    hooks,
    (value): boolean => scriptBoolean(value, realm.objectPrototype),
    (value): boolean =>
      isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(value, realm.objectPrototype),
      ),
  );
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.update;
}

/** Direct Object.hasOwn fast path shared with epoch-guarded typed callers. */
export function objectHasOwnDirect(
  target: unknown,
  rawKey: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): boolean {
  const object = toObjectValue(target, realm, hooks);
  let key: ScriptPropertyKey;
  if (typeof rawKey === "string") key = rawKey;
  else {
    const converted = propertyKeyValue(rawKey, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error === "type") throw createRuntimeError(realm, "type");
    key = converted.value;
  }
  const rare = object.internalRareSlots;
  if (
    object.internalMethods === undefined &&
    object.internalArrayElements === undefined &&
    (rare === undefined ||
      (rare.internalContractedElements === undefined &&
        rare.internalDataAliases === undefined))
  )
    return ordinaryHasOwnProperty<ScriptPropertyKey, unknown>(object, key);
  return getOwnProperty<ScriptPropertyKey, unknown>(object, key) !== undefined;
}

/** Direct Object.defineProperty fast path shared with epoch-guarded typed callers. */
export function objectDefinePropertyDirect(
  target: unknown,
  rawKey: unknown,
  attributes: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const object = viewObjectValue(target, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  let key: ScriptPropertyKey;
  if (typeof rawKey === "string") key = rawKey;
  else {
    const converted = propertyKeyValue(rawKey, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error === "type") throw createRuntimeError(realm, "type");
    key = converted.value;
  }
  const update = readDescriptorUpdate(attributes, realm, hooks);
  const result = defineOwnProperty<ScriptPropertyKey, unknown>(
    object,
    key,
    update,
    hooks,
  );
  if (result !== "accepted") throw createRuntimeError(realm, "type");
  return target;
}

/** Direct Object.keys/values/entries/getOwnPropertyNames/Symbols implementation
 * with single-pass dictionary enumeration. */
export function objectOwnPropertyList(
  value: unknown,
  enumerableOnly: boolean,
  symbols: boolean,
  kind: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = toObjectValue(value, realm, hooks);
  const items: unknown[] = [];
  const rare = object.internalRareSlots;
  if (
    !symbols &&
    object.internalMethods === undefined &&
    object.internalArrayElements === undefined &&
    (rare === undefined ||
      (rare.internalDataAliases === undefined &&
        rare.internalContractedElements === undefined))
  ) {
    if ((object.internalFlags & objectFlagDictionary) === 0) {
      const shape = object.internalShape;
      if (shape !== undefined) {
        const shapeKeys = shape.keys,
          kinds = shape.kinds;
        let hasIndexKey = false;
        for (let i = 0; i < shapeKeys.length; i++) {
          const k = shapeKeys[i];
          if (typeof k === "string") {
            const c = k.charCodeAt(0);
            if (c >= 48 && c <= 57 && scriptPropertyKeyOrder(k) >= 0) {
              hasIndexKey = true;
              break;
            }
          }
        }
        if (!hasIndexKey) {
          for (let i = 0; i < shapeKeys.length; i++) {
            const key = shapeKeys[i];
            if (typeof key !== "string") continue;
            const propKind = kinds[i] ?? 0;
            if (enumerableOnly && (propKind & propertyEnumerable) === 0)
              continue;
            if (kind === "key") {
              items.push(key);
              continue;
            }
            const item =
              (propKind & propertyAccessor) === 0 &&
              object.internalShape === shape
                ? storedValue<ScriptPropertyKey, unknown>(object, i)
                : getProperty<ScriptPropertyKey, unknown>(
                    object,
                    key,
                    object,
                    hooks,
                  );
            items.push(
              kind === "value" ? item : createArray2(key, item, realm),
            );
          }
          return createArrayFromList(
            items,
            0,
            realm.arrayPrototype,
            realm,
            hooks,
          );
        }
      } else {
        return createArrayFromList(
          items,
          0,
          realm.arrayPrototype,
          realm,
          hooks,
        );
      }
    } else {
      const props = rare?.properties;
      if (props === undefined || props.size === 0)
        return createArrayFromList(
          items,
          0,
          realm.arrayPrototype,
          realm,
          hooks,
        );
      // Single-pass dictionary collection: abort and fall back to generic
      // ownKeys only if an accessor or integer-index key is encountered.
      let fastDict = true;
      for (const [key, desc] of props) {
        if (typeof key !== "string") continue;
        if (desc.accessor) {
          fastDict = false;
          break;
        }
        const c = key.charCodeAt(0);
        if (c >= 48 && c <= 57 && scriptPropertyKeyOrder(key) >= 0) {
          fastDict = false;
          break;
        }
        if (enumerableOnly && !desc.enumerable) continue;
        if (kind === "key") {
          items.push(key);
          continue;
        }
        const item = desc.value;
        items.push(kind === "value" ? item : createArray2(key, item, realm));
      }
      if (fastDict) {
        return createArrayFromList(
          items,
          0,
          realm.arrayPrototype,
          realm,
          hooks,
        );
      }
      items.length = 0;
    }
  }
  for (const key of ownKeys<ScriptPropertyKey, unknown>(object, (key): number =>
    scriptPropertyKeyOrder(key),
  )) {
    if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
    if ((typeof key !== "string") !== symbols) continue;
    if (enumerableOnly) {
      const own = getOwnProperty<ScriptPropertyKey, unknown>(object, key);
      if (own === undefined || !own.enumerable) continue;
    }
    let entry: unknown = key;
    if (kind !== "key") {
      const item = getProperty<ScriptPropertyKey, unknown>(
        object,
        key,
        object,
        hooks,
      );
      entry =
        kind === "value"
          ? item
          : createArrayFromList(
              [key, item],
              0,
              realm.arrayPrototype,
              realm,
              hooks,
            );
    }
    items.push(entry);
  }
  return createArrayFromList(items, 0, realm.arrayPrototype, realm, hooks);
}

let lastObjectIntrinsicsRealm: ErrorRealm | undefined = undefined;
let lastObjectKeysFn: unknown = undefined;
let lastObjectValuesFn: unknown = undefined;
let lastObjectEntriesFn: unknown = undefined;
let lastObjectHasOwnFn: unknown = undefined;
let lastObjectDefinePropertyFn: unknown = undefined;

/** Identify unpatched intrinsic Object static methods for direct typed dispatch. */
export function intrinsicObjectMethodKind(
  fn: unknown,
  realm: ErrorRealm,
): string | undefined {
  if (lastObjectIntrinsicsRealm !== realm) return undefined;
  if (fn === lastObjectKeysFn) return "keys";
  if (fn === lastObjectValuesFn) return "values";
  if (fn === lastObjectEntriesFn) return "entries";
  if (fn === lastObjectHasOwnFn) return "hasOwn";
  if (fn === lastObjectDefinePropertyFn) return "defineProperty";
  return undefined;
}

/** Reflection over ordinary objects, including arguments, arrays and primitive
 * wrappers. Key filtering follows each reflection operation's contract. */
export function installObjectIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const keys = standardDescriptorKeys;
  function requireObject(
    value: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = viewObjectValue(value, realm.objectPrototype);
    if (object === undefined) throw createRuntimeError(realm, "type");
    return object;
  }
  function toObject(
    value: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    return toObjectValue(value, realm, hooks);
  }
  function propertyKey(value: unknown): ScriptPropertyKey {
    const converted = propertyKeyValue(value, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error === "type") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function descriptor(value: unknown): DescriptorUpdate<unknown> {
    return readDescriptorUpdate(value, realm, hooks);
  }
  function define(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
    update: DescriptorUpdate<unknown>,
  ): void {
    if (
      defineOwnProperty<ScriptPropertyKey, unknown>(
        object,
        key,
        update,
        hooks,
      ) !== "accepted"
    )
      throw createRuntimeError(realm, "type");
  }
  function defineProperties(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    properties: unknown,
  ): void {
    const source = toObject(properties);
    const updates: {
      key: ScriptPropertyKey;
      update: DescriptorUpdate<unknown>;
    }[] = [];
    for (const key of ownKeys<ScriptPropertyKey, unknown>(
      source,
      (key): number => scriptPropertyKeyOrder(key),
    )) {
      if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
      const own = getOwnProperty<ScriptPropertyKey, unknown>(source, key);
      if (own !== undefined && own.enumerable)
        updates.push({
          key,
          update: descriptor(
            getProperty<ScriptPropertyKey, unknown>(
              source,
              key,
              properties,
              hooks,
            ),
          ),
        });
    }
    // Convert every descriptor before changing the target. Definitions themselves
    // are sequential and can leave earlier definitions in place on failure.
    for (const item of updates) {
      if (item === undefined) throw "PROPERTY_UPDATE_INVARIANT";
      define(object, item.key, item.update);
    }
  }
  function convert(value: unknown): OrdinaryObject<ScriptPropertyKey, unknown> {
    return value === undefined || value === null
      ? createObject<ScriptPropertyKey, unknown>(realm.objectPrototype)
      : toObject(value);
  }
  const constructor: OrdinaryObject<ScriptPropertyKey, unknown> =
    createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => convert(args[0]),
      (args, target): unknown =>
        target === constructor
          ? convert(args[0])
          : createObject<ScriptPropertyKey, unknown>(
              constructorPrototype(target, "object", realm, hooks),
            ),
    );
  builtinFunctionMetadata(constructor, "Object", 1, hooks);
  builtinProperty(
    constructor,
    "prototype",
    realm.objectPrototype,
    false,
    false,
    hooks,
  );
  builtinProperty(
    realm.objectPrototype,
    "constructor",
    constructor,
    true,
    true,
    hooks,
  );
  lastObjectIntrinsicsRealm = realm;
  function install(
    name: string,
    length: number,
    call: ObjectCall<unknown>,
  ): void {
    const fn = builtinFunction(
      realm.functionPrototype,
      name,
      length,
      call,
      hooks,
    );
    if (name === "keys") lastObjectKeysFn = fn;
    else if (name === "values") lastObjectValuesFn = fn;
    else if (name === "entries") lastObjectEntriesFn = fn;
    else if (name === "hasOwn") lastObjectHasOwnFn = fn;
    else if (name === "defineProperty") lastObjectDefinePropertyFn = fn;
    builtinProperty(constructor, name, fn, true, true, hooks);
  }
  install("defineProperty", 3, (receiver, args): unknown => {
    const object = requireObject(args[0]);
    const key = propertyKey(args[1]);
    define(object, key, descriptor(args[2]));
    return args[0];
  });
  function describe(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
  ): unknown {
    return fromPropertyDescriptor<ScriptPropertyKey, unknown>(
      getOwnProperty<ScriptPropertyKey, unknown>(object, key),
      realm.objectPrototype,
      keys,
      hooks,
      (value): unknown => value,
    );
  }
  install("getOwnPropertyDescriptor", 2, (receiver, args): unknown => {
    const object = toObject(args[0]),
      key = propertyKey(args[1]);
    return describe(object, key);
  });
  install("getOwnPropertyDescriptors", 1, (receiver, args): unknown => {
    const source = toObject(args[0]),
      result = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
    for (const key of ownKeys<ScriptPropertyKey, unknown>(
      source,
      (key): number => scriptPropertyKeyOrder(key),
    )) {
      if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
      const item = describe(source, key);
      if (
        item !== undefined &&
        !createDataProperty<ScriptPropertyKey, unknown>(
          result,
          key,
          item,
          hooks,
        )
      )
        throw "PROPERTY_DESCRIPTORS_INVARIANT";
    }
    return result;
  });
  install("groupBy", 2, (receiver, args): unknown => {
    const groups = groupByProperty(args[0], args[1], realm, hooks);
    const result = createObject<ScriptPropertyKey, unknown>(undefined);
    for (const group of groups) {
      if (group === undefined) throw "PROPERTY_GROUP_INVARIANT";
      const values = createArrayFromList(
        group.values,
        0,
        realm.arrayPrototype,
        realm,
        hooks,
      );
      if (
        !createDataProperty<ScriptPropertyKey, unknown>(
          result,
          group.key,
          values,
          hooks,
        )
      )
        throw "PROPERTY_GROUP_INVARIANT";
    }
    return result;
  });
  install("hasOwn", 2, (receiver, args): unknown => {
    const object = toObject(args[0]),
      key = propertyKey(args[1]);
    if (
      object.internalMethods === undefined &&
      object.internalArrayElements === undefined &&
      object.internalRareSlots?.internalContractedElements === undefined &&
      object.internalRareSlots?.internalDataAliases === undefined
    )
      return ordinaryHasOwnProperty<ScriptPropertyKey, unknown>(object, key);
    return (
      getOwnProperty<ScriptPropertyKey, unknown>(object, key) !== undefined
    );
  });
  install("assign", 2, (receiver, args): unknown => {
    const target = toObject(args[0]);
    for (let index = 1; index < args.length; index++) {
      const input = args[index];
      if (input === null || input === undefined) continue;
      const source = toObject(input);
      for (const key of ownKeys<ScriptPropertyKey, unknown>(
        source,
        (key): number => scriptPropertyKeyOrder(key),
      )) {
        if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
        const own = getOwnProperty<ScriptPropertyKey, unknown>(source, key);
        if (own === undefined || !own.enumerable) continue;
        const value = getProperty<ScriptPropertyKey, unknown>(
          source,
          key,
          source,
          hooks,
        );
        // Assignment invokes setters and respects writability, unlike object spread.
        if (
          !setProperty<ScriptPropertyKey, unknown>(
            target,
            key,
            value,
            { object: target, value: target },
            hooks,
          )
        )
          throw createRuntimeError(realm, "type");
      }
    }
    return target;
  });
  install("defineProperties", 2, (receiver, args): unknown => {
    const object = requireObject(args[0]);
    defineProperties(object, args[1]);
    return args[0];
  });
  install("create", 2, (receiver, args): unknown => {
    const prototype = args[0] === null ? undefined : requireObject(args[0]);
    const object = createObject<ScriptPropertyKey, unknown>(prototype);
    if (args[1] !== undefined) defineProperties(object, args[1]);
    return object;
  });
  function ownPropertyList(
    value: unknown,
    enumerableOnly: boolean,
    symbols: boolean,
    kind: string,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    return objectOwnPropertyList(
      value,
      enumerableOnly,
      symbols,
      kind,
      realm,
      hooks,
    );
  }
  install("getOwnPropertyNames", 1, (receiver, args): unknown =>
    ownPropertyList(args[0], false, false, "key"),
  );
  install("getOwnPropertySymbols", 1, (receiver, args): unknown =>
    ownPropertyList(args[0], false, true, "key"),
  );
  install("keys", 1, (receiver, args): unknown =>
    ownPropertyList(args[0], true, false, "key"),
  );
  install("values", 1, (receiver, args): unknown =>
    ownPropertyList(args[0], true, false, "value"),
  );
  install("entries", 1, (receiver, args): unknown =>
    ownPropertyList(args[0], true, false, "entry"),
  );
  install("fromEntries", 1, (receiver, args): unknown => {
    if (args[0] === undefined || args[0] === null)
      throw createRuntimeError(realm, "type");
    const result = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    addEntriesFromIterable(
      args[0],
      (key, value): void => {
        if (
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            propertyKey(key),
            value,
            hooks,
          )
        )
          throw "FROM_ENTRIES_PROPERTY_INVARIANT";
      },
      realm,
      hooks,
    );
    return result;
  });
  install("getPrototypeOf", 1, (receiver, args): unknown => {
    const prototype = getPrototype<ScriptPropertyKey, unknown>(
      toObject(args[0]),
    );
    if (prototype === undefined) return null;
    return prototype;
  });
  install("setPrototypeOf", 2, (receiver, args): unknown => {
    const value = args[0];
    if (value === undefined || value === null)
      throw createRuntimeError(realm, "type");
    // Validate the prototype even when the target is a primitive.
    const prototype = args[1] === null ? undefined : requireObject(args[1]);
    const object = viewObjectValue(value, realm.objectPrototype);
    if (
      object !== undefined &&
      !setPrototype<ScriptPropertyKey, unknown>(object, prototype)
    )
      throw createRuntimeError(realm, "type");
    return value;
  });
  install("preventExtensions", 1, (receiver, args): unknown => {
    const object = viewObjectValue(args[0], realm.objectPrototype);
    if (
      object !== undefined &&
      !preventExtensions<ScriptPropertyKey, unknown>(object)
    )
      throw createRuntimeError(realm, "type");
    return args[0];
  });
  install("isExtensible", 1, (receiver, args): unknown => {
    const object = viewObjectValue(args[0], realm.objectPrototype);
    return (
      object !== undefined && isExtensible<ScriptPropertyKey, unknown>(object)
    );
  });
  function setIntegrity(value: unknown, frozen: boolean): unknown {
    const object = viewObjectValue(value, realm.objectPrototype);
    if (
      object !== undefined &&
      !setIntegrityLevel<ScriptPropertyKey, unknown>(
        object,
        frozen,
        hooks,
        scriptPropertyKeyOrder,
      )
    )
      throw createRuntimeError(realm, "type");
    return value;
  }
  function testIntegrity(value: unknown, frozen: boolean): boolean {
    const object = viewObjectValue(value, realm.objectPrototype);
    return (
      object === undefined ||
      testIntegrityLevel<ScriptPropertyKey, unknown>(
        object,
        frozen,
        scriptPropertyKeyOrder,
      )
    );
  }
  install("is", 2, (receiver, args): unknown =>
    scriptSameValue(args[0], args[1]),
  );
  install("seal", 1, (receiver, args): unknown => setIntegrity(args[0], false));
  install("freeze", 1, (receiver, args): unknown =>
    setIntegrity(args[0], true),
  );
  install("isSealed", 1, (receiver, args): unknown =>
    testIntegrity(args[0], false),
  );
  install("isFrozen", 1, (receiver, args): unknown =>
    testIntegrity(args[0], true),
  );
  builtinProperty(global, "Object", constructor, true, true, hooks);
}
