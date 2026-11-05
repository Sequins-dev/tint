import { groupByProperty } from "./grouping.ts";
import { addEntriesFromIterable } from "./entry-iteration.ts";
import { createArrayFromList } from "./array-like.ts";
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
  ownKeys,
  preventExtensions,
  setPrototype,
  setProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";
import {
  toPropertyDescriptor,
  fromPropertyDescriptor,
  type DescriptorKeys,
} from "./descriptors.ts";
import { type DescriptorUpdate } from "../descriptors/index.ts";
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

/** Reflection over ordinary objects, including arguments, arrays and primitive
 * wrappers. Key filtering follows each reflection operation's contract. */
export function installObjectIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const keys: DescriptorKeys<ScriptPropertyKey> = {
    value: "value",
    writable: "writable",
    get: "get",
    set: "set",
    enumerable: "enumerable",
    configurable: "configurable",
  };
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
    const source = requireObject(value);
    const result = toPropertyDescriptor<ScriptPropertyKey, unknown>(
      source,
      value,
      keys,
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
  function install(
    name: string,
    length: number,
    call: ObjectCall<unknown>,
  ): void {
    builtinProperty(
      constructor,
      name,
      builtinFunction(realm.functionPrototype, name, length, call, hooks),
      true,
      true,
      hooks,
    );
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
    const object = toObject(value);
    const result = createArrayObject<ScriptPropertyKey, unknown>(
      0,
      realm.arrayPrototype,
      realm.arrayHooks,
      hooks,
    );
    let index = 0;
    for (const key of ownKeys<ScriptPropertyKey, unknown>(
      object,
      (key): number => scriptPropertyKeyOrder(key),
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
      if (
        !createDataProperty<ScriptPropertyKey, unknown>(
          result,
          String(index++),
          entry,
          hooks,
        )
      )
        throw "PROPERTY_LIST_INVARIANT";
    }
    return result;
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
