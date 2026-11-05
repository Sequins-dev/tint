import { arrayLikeValues, createArrayFromList } from "./array-like.ts";
import { callObject, constructObject, isCallableObject } from "./call.ts";
import { propertyKeyValue } from "./coercion.ts";
import {
  toPropertyDescriptor,
  fromPropertyDescriptor,
  type DescriptorKeys,
} from "./descriptors.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createObject,
  getProperty,
  setProperty,
  hasProperty,
  deleteProperty,
  getOwnProperty,
  defineOwnProperty,
  getPrototype,
  setPrototype,
  isExtensible,
  preventExtensions,
  ownKeys,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";
import {
  wellKnownSymbol,
  scriptPropertyKeyOrder,
  type ScriptPropertyKey,
} from "./symbols.ts";
import { scriptBoolean, viewObjectValue } from "./values.ts";

/** Reflect exposes internal-method results without Object's primitive boxing or
 * its conversion of false mutation results to exceptions. */
export function installReflectIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const reflect = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const keys: DescriptorKeys<ScriptPropertyKey> = {
    value: "value",
    writable: "writable",
    get: "get",
    set: "set",
    enumerable: "enumerable",
    configurable: "configurable",
  };
  function object(value: unknown): OrdinaryObject<ScriptPropertyKey, unknown> {
    const result = viewObjectValue(value, realm.objectPrototype);
    if (result === undefined) throw createRuntimeError(realm, "type");
    return result;
  }
  function key(value: unknown): ScriptPropertyKey {
    const result = propertyKeyValue(value, hooks, realm);
    if (result.error === "unsupported") rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function install(
    name: string,
    length: number,
    call: ObjectCall<unknown>,
  ): void {
    builtinProperty(
      reflect,
      name,
      builtinFunction(realm.functionPrototype, name, length, call, hooks),
      true,
      true,
      hooks,
    );
  }
  install("get", 2, (receiver, args): unknown => {
    const target = object(args[0]),
      property = key(args[1]);
    return getProperty<ScriptPropertyKey, unknown>(
      target,
      property,
      args.length > 2 ? args[2] : args[0],
      hooks,
    );
  });
  install("set", 3, (receiver, args): unknown => {
    const target = object(args[0]),
      property = key(args[1]);
    const value = args.length > 3 ? args[3] : args[0];
    return setProperty<ScriptPropertyKey, unknown>(
      target,
      property,
      args[2],
      { object: viewObjectValue(value, realm.objectPrototype), value },
      hooks,
    );
  });
  install("has", 2, (receiver, args): unknown => {
    const target = object(args[0]);
    return hasProperty<ScriptPropertyKey, unknown>(target, key(args[1]));
  });
  install("deleteProperty", 2, (receiver, args): unknown => {
    const target = object(args[0]);
    return deleteProperty<ScriptPropertyKey, unknown>(target, key(args[1]));
  });
  install("getOwnPropertyDescriptor", 2, (receiver, args): unknown => {
    const target = object(args[0]),
      property = key(args[1]);
    return fromPropertyDescriptor<ScriptPropertyKey, unknown>(
      getOwnProperty<ScriptPropertyKey, unknown>(target, property),
      realm.objectPrototype,
      keys,
      hooks,
      (value): unknown => value,
    );
  });
  install("defineProperty", 3, (receiver, args): unknown => {
    const target = object(args[0]),
      property = key(args[1]);
    const source = object(args[2]);
    const descriptor = toPropertyDescriptor<ScriptPropertyKey, unknown>(
      source,
      args[2],
      keys,
      hooks,
      (value): boolean => scriptBoolean(value, realm.objectPrototype),
      (value): boolean =>
        isCallableObject<ScriptPropertyKey, unknown>(
          viewObjectValue(value, realm.objectPrototype),
        ),
    );
    if (descriptor.error !== "none") throw createRuntimeError(realm, "type");
    return (
      defineOwnProperty<ScriptPropertyKey, unknown>(
        target,
        property,
        descriptor.update,
        hooks,
      ) === "accepted"
    );
  });
  install("ownKeys", 1, (receiver, args): unknown => {
    const target = object(args[0]),
      values: unknown[] = [];
    for (const key of ownKeys<ScriptPropertyKey, unknown>(
      target,
      scriptPropertyKeyOrder,
    ))
      values.push(key);
    return createArrayFromList(values, 0, realm.arrayPrototype, realm, hooks);
  });
  install("getPrototypeOf", 1, (receiver, args): unknown => {
    const prototype = getPrototype<ScriptPropertyKey, unknown>(object(args[0]));
    return prototype === undefined ? null : prototype;
  });
  install("setPrototypeOf", 2, (receiver, args): unknown => {
    const target = object(args[0]);
    const prototype = args[1] === null ? undefined : object(args[1]);
    return setPrototype<ScriptPropertyKey, unknown>(target, prototype);
  });
  install("isExtensible", 1, (receiver, args): unknown =>
    isExtensible<ScriptPropertyKey, unknown>(object(args[0])),
  );
  install("preventExtensions", 1, (receiver, args): unknown =>
    preventExtensions<ScriptPropertyKey, unknown>(object(args[0])),
  );
  install("apply", 3, (receiver, args): unknown => {
    const target = object(args[0]);
    if (target.internalCall === undefined)
      throw createRuntimeError(realm, "type");
    const list = arrayLikeValues(args[2], realm, hooks);
    const result = callObject<ScriptPropertyKey, unknown>(
      target,
      args[1],
      list,
      undefined,
    );
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  });
  install("construct", 2, (receiver, args): unknown => {
    const target = object(args[0]);
    if (target.internalConstruct === undefined)
      throw createRuntimeError(realm, "type");
    const newTarget = args.length > 2 ? args[2] : args[0],
      newObject = object(newTarget);
    if (newObject.internalConstruct === undefined)
      throw createRuntimeError(realm, "type");
    const list = arrayLikeValues(args[1], realm, hooks);
    const result = constructObject<ScriptPropertyKey, unknown>(
      target,
      list,
      { object: newObject, value: newTarget },
      undefined,
    );
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  });
  builtinProperty(
    reflect,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Reflect",
    false,
    true,
    hooks,
  );
  builtinProperty(global, "Reflect", reflect, true, true, hooks);
}
