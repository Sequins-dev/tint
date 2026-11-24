import { installLegacyAccessors } from "./legacy-accessors.ts";
import { wellKnownSymbol } from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  exoticSlots,
  hasPrototype,
  getOwnProperty,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { propertyKeyValue } from "./coercion.ts";
import {
  isArrayValue,
  viewObjectValue,
  getObjectValueProperty,
  callObjectValue,
} from "./values.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { toObjectValue } from "./boxing.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** Default internal-slot tags are overridden only by a string @@toStringTag. */
export function objectValueTag(
  receiver: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  if (receiver === undefined) return "[object Undefined]";
  if (receiver === null) return "[object Null]";
  const object = toObjectValue(receiver, realm, hooks);
  const builtinTag = defaultObjectTag(object, realm);
  const tag = getProperty<ScriptPropertyKey, unknown>(
    object,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    object,
    hooks,
  );
  return "[object " + (typeof tag === "string" ? tag : builtinTag) + "]";
}
function defaultObjectTag(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): string {
  if (isArrayValue(object, realm)) return "Array";
  if (object.internalArgumentsData) return "Arguments";
  if (object.internalCall !== undefined) return "Function";
  if (exoticSlots(object).internalErrorData) return "Error";
  if (exoticSlots(object).internalRegExpData !== undefined) return "RegExp";
  if (exoticSlots(object).internalDateValue !== undefined) return "Date";
  const primitive = exoticSlots(object).internalPrimitiveData;
  if (primitive !== undefined) {
    if (primitive.kind === "number") return "Number";
    if (primitive.kind === "boolean") return "Boolean";
    if (primitive.kind === "string") return "String";
  }
  return "Object";
}

/** Base prototype methods share the realm's primitive wrappers and exceptions. */
export function installObjectPrototype(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  installLegacyAccessors(realm, hooks);
  const root = realm.objectPrototype;
  const functionPrototype = realm.functionPrototype;
  function fail(kind: string): never {
    if (kind === "unsupported") return rejectUnsupportedExecution(realm);
    throw createRuntimeError(realm, kind);
  }
  const toString = builtinFunction(
    functionPrototype,
    "toString",
    0,
    (receiver, args): unknown => {
      return objectValueTag(receiver, realm, hooks);
    },
    hooks,
  );
  builtinProperty(
    root,
    "toLocaleString",
    builtinFunction(
      functionPrototype,
      "toLocaleString",
      0,
      (receiver, args): unknown => {
        const method = getObjectValueProperty(
          receiver,
          "toString",
          hooks,
          realm,
        );
        if (method.error !== "none") return fail(method.error);
        const called = callObjectValue(method.value, receiver, [], root);
        if (called.error !== "none") return fail(called.error);
        return called.value;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    root,
    "isPrototypeOf",
    builtinFunction(
      functionPrototype,
      "isPrototypeOf",
      1,
      (receiver, args): unknown => {
        const candidate = viewObjectValue(args[0], root);
        if (candidate === undefined) return false;
        const object = toObjectValue(receiver, realm, hooks);
        return hasPrototype<ScriptPropertyKey, unknown>(candidate, object);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  const valueOf = builtinFunction(
    functionPrototype,
    "valueOf",
    0,
    (receiver, args): unknown => {
      return toObjectValue(receiver, realm, hooks);
    },
    hooks,
  );
  function ownProperty(
    receiver: unknown,
    keyValue: unknown,
    enumerable: boolean,
  ): unknown {
    // Both methods coerce the property key before ToObject(receiver).
    const key = propertyKeyValue(keyValue, hooks, realm);
    if (key.error !== "none") return fail(key.error);
    const object = toObjectValue(receiver, realm, hooks);
    const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
      object,
      key.value,
    );
    return descriptor !== undefined && (!enumerable || descriptor.enumerable);
  }
  builtinProperty(
    root,
    "hasOwnProperty",
    builtinFunction(
      functionPrototype,
      "hasOwnProperty",
      1,
      (receiver, args): unknown => ownProperty(receiver, args[0], false),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    root,
    "propertyIsEnumerable",
    builtinFunction(
      functionPrototype,
      "propertyIsEnumerable",
      1,
      (receiver, args): unknown => ownProperty(receiver, args[0], true),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(root, "toString", toString, true, true, hooks);
  builtinProperty(root, "valueOf", valueOf, true, true, hooks);
}
