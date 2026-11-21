import { primitiveContractBit } from "@tint/foundation/values/primitive-contract";
import { viewSymbolValue } from "./symbols.ts";
import {
  viewBigIntValue,
  bigIntToBoolean,
  compareBigIntValues,
} from "./bigints.ts";
import { sameValue } from "./operators.ts";
import { scriptPropertyKeyOrder } from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  getProperty,
  setProperty,
  deleteProperty,
  setPrototype,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { callObject } from "./call.ts";
import { toObjectValue } from "./boxing.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  createPropertyEnumeration,
  type PropertyEnumeration,
} from "./enumeration.ts";

export function checkPrimitiveContract(
  realm: ErrorRealm,
  value: unknown,
  allowed: number,
): unknown {
  if (!acceptsPrimitiveContract(value, allowed))
    throw createRuntimeError(realm, "type");
  return value;
}

export function acceptsPrimitiveContract(
  value: unknown,
  allowed: number,
): boolean {
  let kind = value === null ? "null" : typeof value;
  if (kind === "object") {
    if (
      (allowed & primitiveContractBit("bigint")) !== 0 &&
      viewBigIntValue(value) !== undefined
    )
      kind = "bigint";
    else if (
      (allowed & primitiveContractBit("symbol")) !== 0 &&
      viewSymbolValue(value) !== undefined
    )
      kind = "symbol";
  }
  return (allowed & primitiveContractBit(kind)) !== 0;
}

export function primitiveContractPredicate(
  allowed: number,
): ((value: unknown) => boolean) | undefined {
  if (allowed === 0) return undefined;
  return (value: unknown): boolean => acceptsPrimitiveContract(value, allowed);
}

export function checkPrimitiveRestArguments(
  realm: ErrorRealm,
  args: readonly unknown[],
  offset: number,
  allowed: number,
): void {
  for (let i = offset; i < args.length; i++)
    checkPrimitiveContract(realm, args[i], allowed);
}

/** Literal prototype setters bypass named properties and ignore primitive values. */
export function setObjectLiteralPrototype(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
): void {
  if (value === null) {
    if (!setPrototype<ScriptPropertyKey, unknown>(object, undefined))
      throw "LITERAL_PROTOTYPE_INVARIANT";
    return;
  }
  const prototype = viewObjectValue(value, object);
  if (
    prototype !== undefined &&
    !setPrototype<ScriptPropertyKey, unknown>(object, prototype)
  )
    throw "LITERAL_PROTOTYPE_INVARIANT";
}

/** Nullish for-in sources are empty; other values use prototype-aware ToObject. */
export function enumerateObjectValue(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "unsupported";
  readonly value: PropertyEnumeration<ScriptPropertyKey, unknown>;
} {
  let object: OrdinaryObject<ScriptPropertyKey, unknown> | undefined =
    undefined;
  if (value !== null && value !== undefined)
    object = toObjectValue(value, realm, hooks);
  const iterator = createPropertyEnumeration<ScriptPropertyKey, unknown>(
    object,
    (key): number => scriptPropertyKeyOrder(key),
  );
  return {
    error: "none",
    value: iterator,
  };
}

/** Native-only checked view, explicitly bound by the embedding build request.
 * The Script surface uses shared property keys and general unknown values. */
export function viewObjectValue(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  throw "UNBOUND_OBJECT_VIEW";
}

/** Concrete host-authorized object view for weak-directory lookup. Unlike the
 * generic embedding API it needs no witness value, which could accidentally
 * retain an otherwise unreachable registry's realm through that directory. */
export function viewWeakRegistryOwner(
  value: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  throw "UNBOUND_WEAK_REGISTRY_VIEW";
}

/** IsArray follows proxy targets without invoking handler traps. */
export function isArrayValue(value: unknown, realm: ErrorRealm): boolean {
  let object = viewObjectValue(value, realm.objectPrototype);
  while (object !== undefined) {
    const proxy = object.internalProxyData;
    if (proxy === undefined) return object.internalArrayData;
    if (proxy.target === undefined) throw createRuntimeError(realm, "type");
    object = proxy.target;
  }
  return false;
}

/** The classifier needs only a descriptor, even before a realm is created. */
export function viewTypeofObject(
  value: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  throw "UNBOUND_TYPEOF_OBJECT_VIEW";
}

export function objectTypeof(
  value: unknown,
  object: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
): string {
  if (viewSymbolValue(value) !== undefined) return "symbol";
  if (viewBigIntValue(value) !== undefined) return "bigint";
  if (object !== undefined && object.internalIsHTMLDDA) return "undefined";
  if (object !== undefined && object.internalCall !== undefined)
    return "function";
  // Runtime internals use raw typeof. In particular this fallback recognizes
  // primitives and native closures without recursing through this classifier.
  return typeof value;
}

export function objectValueTypeof(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): string {
  return objectTypeof(value, viewObjectValue(value, witness));
}

export function generalValueTypeof(value: unknown): string {
  return objectTypeof(value, viewTypeofObject(value));
}

export function scriptBoolean(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): boolean {
  const object = viewObjectValue(value, witness);
  if (object !== undefined && object.internalIsHTMLDDA) return false;
  const bigint = viewBigIntValue(value);
  return bigint === undefined ? !!value : bigIntToBoolean(bigint);
}
export function scriptStrictEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const a = viewBigIntValue(left),
    b = viewBigIntValue(right);
  return a !== undefined && b !== undefined && compareBigIntValues(a, b) === 0;
}
export function scriptSameValue(left: unknown, right: unknown): boolean {
  if (sameValue(left, right)) return true;
  const a = viewBigIntValue(left),
    b = viewBigIntValue(right);
  return a !== undefined && b !== undefined && compareBigIntValues(a, b) === 0;
}

export function callObjectValue(
  value: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: unknown } {
  return callObject<ScriptPropertyKey, unknown>(
    viewObjectValue(value, witness),
    receiver,
    arguments_,
    undefined,
  );
}

/** Positional call sites have evaluated every operand before dispatch. The
 * generic path handles foreign realms, proxies, bound functions and hosts. */
export function callRegisterObjectValue(
  realm: ErrorRealm,
  count: number,
  value: unknown,
  receiver: unknown,
  first: unknown,
  second: unknown,
): unknown {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const entry = object.internalRegisterCall;
  const active = realm.agent.activeContext;
  if (
    entry !== undefined &&
    active !== undefined &&
    active.realm === entry.context.realm &&
    active.scriptOrModule === entry.context.scriptOrModule
  )
    return entry.invoke(value, receiver, undefined, count, first, second);
  const args: readonly unknown[] =
    count === 0 ? [] : count === 1 ? [first] : [first, second];
  const result = callObject<ScriptPropertyKey, unknown>(
    object,
    receiver,
    args,
    undefined,
  );
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

/** Calls from typed source already carry a receiver and an evaluated list. */
export function callGeneralValue(
  value: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
): unknown {
  const object = viewTypeofObject(value);
  if (object === undefined)
    throw new TypeError("Called value is not a function");
  const result = callObjectValue(value, receiver, arguments_, object);
  if (result.error !== "none")
    throw new TypeError("Called value is not a function");
  return result.value;
}

/** Box the lookup base, preserving the original receiver for accessors. */
export function getObjectValueProperty(
  value: unknown,
  key: ScriptPropertyKey,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: unknown;
} {
  return getObjectValuePropertyWithReceiver(value, key, value, hooks, realm);
}

/** Lookup base and accessor receiver are distinct for super references. */
export function getObjectValuePropertyWithReceiver(
  base: unknown,
  key: ScriptPropertyKey,
  receiver: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: unknown;
} {
  if (base === null || base === undefined)
    return { error: "type", value: undefined };
  return {
    error: "none",
    value: propertyValueOf(base, key, receiver, hooks, realm),
  };
}

/** [[Get]] on ToObject(base) for a non-nullish base. */
export function propertyValueOf(
  base: unknown,
  key: ScriptPropertyKey,
  receiver: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  // An object base is its own ToObject result: read it before the primitive
  // checks, which object bases would all fail.
  const object = viewObjectValue(base, realm.objectPrototype);
  if (object !== undefined)
    return getProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      receiver,
      hooks,
    );
  const prototype = primitivePrototype(base, realm);
  if (prototype !== undefined) {
    // A wrapper's only own properties are a String's length and in-range
    // canonical indices, so reading through the prototype is [[Get]] on
    // ToObject(base) without allocating the wrapper.
    if (typeof base === "string" && typeof key === "string") {
      if (key === "length") return base.length;
      const index = scriptPropertyKeyOrder(key);
      if (index >= 0 && index < base.length)
        return base.slice(index, index + 1);
    }
    return getProperty<ScriptPropertyKey, unknown>(
      prototype,
      key,
      receiver,
      hooks,
    );
  }
  return getProperty<ScriptPropertyKey, unknown>(
    toObjectValue(base, realm, hooks),
    key,
    receiver,
    hooks,
  );
}

/** GetValue of a property reference without a result record: the base's
 * RequireObjectCoercible TypeError is thrown in the realm, as a lowered result
 * check would; the receiver is the original base value. */
export function readObjectValueProperty(
  base: unknown,
  key: ScriptPropertyKey,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  if (base === null || base === undefined)
    throw createRuntimeError(realm, "type");
  return propertyValueOf(base, key, base, hooks, realm);
}

/** The realm prototype ToObject would give a String, Number or Boolean
 * primitive, or undefined for every other value. Number and Boolean wrappers
 * have no own properties. Symbol and BigInt reads stay on the boxing path so
 * object reads pay only these typeof checks. */
function primitivePrototype(
  value: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  if (typeof value === "string") return realm.stringPrototype;
  if (typeof value === "number") return realm.numberPrototype;
  if (typeof value === "boolean") return realm.booleanPrototype;
  return undefined;
}

/** PutValue after RHS evaluation; failed writes throw only for strict references. */
export function setObjectValueProperty(
  base: unknown,
  key: ScriptPropertyKey,
  value: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): "none" | "type" | "unsupported" {
  return setObjectValuePropertyWithReceiver(
    base,
    key,
    value,
    base,
    strict,
    hooks,
    realm,
  );
}

/** Data writes target the receiver, while inherited setter lookup starts at base. */
export function setObjectValuePropertyWithReceiver(
  base: unknown,
  key: ScriptPropertyKey,
  value: unknown,
  receiver: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): "none" | "type" | "unsupported" {
  if (base === null || base === undefined) return "type";
  const receiverObject = viewObjectValue(receiver, realm.objectPrototype);
  const object = toObjectValue(base, realm, hooks);
  return setProperty<ScriptPropertyKey, unknown>(
    object,
    key,
    value,
    // A primitive receiver permits inherited setters but cannot receive data
    // properties on the temporary wrapper, even when that wrapper is extensible.
    { value: receiver, object: receiverObject },
    hooks,
  )
    ? "none"
    : strict
      ? "type"
      : "none";
}

/** OrdinaryCallBindThis uses the callee realm's global and wrapper prototypes. */
export function sloppyCallReceiver(
  value: unknown,
  globalThis: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): { readonly error: "none" | "unsupported"; readonly value: unknown } {
  if (value === null || value === undefined)
    return { error: "none", value: globalThis };
  return { error: "none", value: toObjectValue(value, realm, hooks) };
}

/** Delete never reads the property or invokes a getter. Primitive wrappers cannot
 * escape this operation, so their own-property checks need no allocation. */
export function deleteObjectValueProperty(
  base: unknown,
  key: ScriptPropertyKey,
  strict: boolean,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: boolean;
} {
  if (base === null || base === undefined)
    return { error: "type", value: false };
  if (typeof base === "object" && viewSymbolValue(base) !== undefined)
    return { error: "none", value: true };
  let accepted = true;
  if (typeof base === "string") {
    if (typeof key !== "string") return { error: "none", value: true };
    const index = Number(key);
    accepted = !(
      key === "length" ||
      (index >= 0 &&
        index < base.length &&
        Math.floor(index) === index &&
        String(index) === key)
    );
  } else if (typeof base !== "number" && typeof base !== "boolean") {
    const object = viewObjectValue(base, witness);
    if (object === undefined) return { error: "unsupported", value: false };
    accepted = deleteProperty<ScriptPropertyKey, unknown>(object, key);
  }
  return { error: !accepted && strict ? "type" : "none", value: accepted };
}
