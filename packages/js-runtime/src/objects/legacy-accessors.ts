import {
  getField,
  setField,
  enumerableField,
  configurableField,
} from "../descriptors/index.ts";
import {
  defineOwnProperty,
  getOwnProperty,
  getPrototype,
  setPrototype,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinFunction,
  builtinProperty,
  builtinAccessor,
} from "./intrinsics.ts";
import { viewObjectValue } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { isCallableObject } from "./call.ts";
import { propertyKeyValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Annex B accessor helpers share ordinary/exotic descriptor operations. */
export function installLegacyAccessors(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinAccessor(
    realm.objectPrototype,
    "__proto__",
    builtinFunction(
      realm.functionPrototype,
      "get __proto__",
      0,
      (receiver, args): unknown => {
        const object = toObjectValue(receiver, realm, hooks);
        const prototype = getPrototype<ScriptPropertyKey, unknown>(object);
        return prototype === undefined ? null : prototype;
      },
      hooks,
    ),
    builtinFunction(
      realm.functionPrototype,
      "set __proto__",
      1,
      (receiver, args): unknown => {
        if (receiver === undefined || receiver === null)
          throw createRuntimeError(realm, "type");
        const prototype = viewObjectValue(args[0], realm.objectPrototype);
        if (args[0] !== null && prototype === undefined) return undefined;
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) return undefined;
        if (!setPrototype<ScriptPropertyKey, unknown>(object, prototype))
          throw createRuntimeError(realm, "type");
        return undefined;
      },
      hooks,
    ),
    hooks,
  );
  function key(value: unknown): ScriptPropertyKey {
    const result = propertyKeyValue(value, hooks, realm);
    if (result.error === "unsupported") rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function define(
    receiver: unknown,
    property: unknown,
    method: unknown,
    getter: boolean,
  ): unknown {
    const object = toObjectValue(receiver, realm, hooks);
    if (
      !isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(method, realm.objectPrototype),
      )
    )
      throw createRuntimeError(realm, "type");
    const status = defineOwnProperty<ScriptPropertyKey, unknown>(
      object,
      key(property),
      {
        fields:
          (getter ? getField : setField) | enumerableField | configurableField,
        value: undefined,
        writable: false,
        get: getter ? method : undefined,
        set: getter ? undefined : method,
        enumerable: true,
        configurable: true,
      },
      hooks,
    );
    if (status !== "accepted") throw createRuntimeError(realm, "type");
    return undefined;
  }
  function lookup(
    receiver: unknown,
    property: unknown,
    getter: boolean,
  ): unknown {
    let object: OrdinaryObject<ScriptPropertyKey, unknown> | undefined =
      toObjectValue(receiver, realm, hooks);
    const name = key(property);
    while (object !== undefined) {
      const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
        object,
        name,
      );
      if (descriptor !== undefined)
        return descriptor.accessor
          ? getter
            ? descriptor.get
            : descriptor.set
          : undefined;
      object = getPrototype<ScriptPropertyKey, unknown>(object);
    }
    return undefined;
  }
  for (const name of [
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
  ]) {
    if (name === undefined) throw "LEGACY_ACCESSOR_NAME_INVARIANT";
    const defining = name === "__defineGetter__" || name === "__defineSetter__";
    const getter = name === "__defineGetter__" || name === "__lookupGetter__";
    builtinProperty(
      realm.objectPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        defining ? 2 : 1,
        (receiver, args): unknown =>
          defining
            ? define(receiver, args[0], args[1], getter)
            : lookup(receiver, args[0], getter),
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
