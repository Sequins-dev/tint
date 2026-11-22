import {
  createRuntimeError,
  rejectUnsupportedExecution,
  throwIfRuntimeError,
  type ErrorRealm,
} from "./errors.ts";
import { viewSymbolValue, wellKnownSymbol } from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  getProperty,
  indexedPropertyCell,
  type ObjectHooks,
} from "./operations.ts";
import { isCallableObject, callObject } from "./call.ts";
import {
  viewObjectValue,
  propertyValueOf,
  setObjectValueProperty,
} from "./values.ts";
import {
  setTypedArrayElement,
  typedArrayElementAt,
} from "./typed-array-data.ts";
import { bufferStorageImmutable } from "./buffer-storage.ts";
import { primitiveToString, primitiveToNumber } from "./operators.ts";
import { viewBigIntValue, bigIntToString } from "./bigints.ts";
import {
  arrayElementCount,
  readArrayElement,
  writeArrayElement,
} from "./array-elements.ts";

/** Property references reject nullish bases before ToPropertyKey. */
export function objectPropertyKey(
  base: unknown,
  key: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: ScriptPropertyKey;
} {
  if (base === null || base === undefined) return { error: "type", value: "" };
  return propertyKeyValue(key, hooks, realm);
}

/** GetValue of a computed property reference in one call: RequireObjectCoercible
 * of the base, then ToPropertyKey of the key, then Get with the base as the
 * receiver. String and symbol keys need no conversion record; abrupt results
 * throw in the realm exactly as lowered result checks do. */
export function readObjectValuePropertyKey(
  base: unknown,
  key: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  if (base === null || base === undefined)
    throw createRuntimeError(realm, "type");
  let converted: ScriptPropertyKey;
  if (typeof key === "string") converted = key;
  else if (typeof key === "number") {
    // A TypedArray's [[Get]] of a canonical numeric key never consults the
    // prototype chain; ToString of a Number is canonical, naming the Number
    // itself (-0 names "0"). Read the element without the string round trip.
    let object = viewObjectValue(base, realm.objectPrototype);
    const data = object?.internalTypedArrayData;
    if (data !== undefined)
      return typedArrayElementAt(data, key === 0 ? 0 : key);
    if (Number.isSafeInteger(key) && object !== undefined) {
      while (object !== undefined) {
        const typed = object.internalTypedArrayData;
        if (typed !== undefined)
          return typedArrayElementAt(typed, key === 0 ? 0 : key);
        const methods = object.internalMethods;
        if (
          methods?.get !== undefined ||
          methods?.getOwnProperty !== undefined ||
          methods?.getPrototype !== undefined ||
          object.internalDataAliases !== undefined
        )
          return getProperty<ScriptPropertyKey, unknown>(
            object,
            String(key),
            base,
            hooks,
          );
        const elements = object.internalArrayElements;
        if (
          elements !== undefined &&
          key >= 0 &&
          key < arrayElementCount<ScriptPropertyKey, unknown>(elements)
        )
          return readArrayElement<ScriptPropertyKey, unknown>(elements, key);
        const cell = indexedPropertyCell<ScriptPropertyKey, unknown>(
          object,
          key,
        );
        if (cell !== undefined) {
          if (!cell.accessor) return cell.value;
          return hooks.sameValue(cell.get, hooks.undefinedValue)
            ? hooks.undefinedValue
            : hooks.call(cell.get, base, []);
        }
        object = object.prototype;
      }
      return hooks.undefinedValue;
    }
    converted = String(key);
  } else {
    const symbol = viewSymbolValue(key);
    if (symbol !== undefined) converted = symbol;
    else {
      const result = propertyKeyValue(key, hooks, realm);
      if (result.error === "unsupported") rejectUnsupportedExecution(realm);
      if (result.error !== "none")
        throw createRuntimeError(realm, result.error);
      converted = result.value;
    }
  }
  return propertyValueOf(base, converted, base, hooks, realm);
}

/** PutValue of an already evaluated computed reference. An integer
 * overwrite of existing ordinary storage needs no property-name string. */
export function writeObjectValuePropertyKey(
  base: unknown,
  key: unknown,
  value: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): void {
  if (base === null || base === undefined)
    throw createRuntimeError(realm, "type");
  if (typeof key === "number") {
    const object = viewObjectValue(base, realm.objectPrototype);
    if (object !== undefined) {
      const data = object.internalTypedArrayData;
      if (data !== undefined) {
        if (!bufferStorageImmutable(data.storage))
          setTypedArrayElement(data, key === 0 ? 0 : key, value, realm, hooks);
        else if (strict) throw createRuntimeError(realm, "type");
        return;
      }
      if (
        Number.isSafeInteger(key) &&
        object.internalPropertyContract === undefined
      ) {
        const elements = object.internalArrayElements;
        if (
          elements !== undefined &&
          key >= 0 &&
          key < arrayElementCount<ScriptPropertyKey, unknown>(elements)
        ) {
          writeArrayElement<ScriptPropertyKey, unknown>(elements, key, value);
          return;
        }
        if (
          object.internalMethods === undefined &&
          object.internalDataAliases === undefined
        ) {
          const cell = indexedPropertyCell<ScriptPropertyKey, unknown>(
            object,
            key,
          );
          if (cell !== undefined && !cell.accessor) {
            if (cell.writable) cell.value = value;
            else if (strict) throw createRuntimeError(realm, "type");
            return;
          }
        }
      }
    }
  }
  const converted = propertyKeyValue(key, hooks, realm);
  if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
  if (converted.error !== "none")
    throw createRuntimeError(realm, converted.error);
  throwIfRuntimeError(
    realm,
    setObjectValueProperty(base, converted.value, value, strict, hooks, realm),
  );
}

export function propertyKeyValue(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: ScriptPropertyKey;
} {
  // Strings and Numbers are primitives: ToPrimitive is the identity and
  // ToString of a Number is the runtime's Number::toString (String).
  if (typeof value === "string") return { error: "none", value };
  if (typeof value === "number") return { error: "none", value: String(value) };
  const result = primitiveValue(value, "string", hooks, realm);
  if (result.error !== "none") return { error: result.error, value: "" };
  const symbol = viewSymbolValue(result.value);
  if (symbol !== undefined) return { error: "none", value: symbol };
  const text = primitiveStringValue(result.value);
  return { error: text.error, value: text.value };
}

/** ToPrimitive for the currently supported ordinary values and hint. */
export function primitiveValue(
  value: unknown,
  hint: "default" | "number" | "string",
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: unknown;
} {
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return { error: "none", value };
  if (viewSymbolValue(value) !== undefined) return { error: "none", value };
  if (viewBigIntValue(value) !== undefined) return { error: "none", value };
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return { error: "unsupported", value: undefined };
  const method = getProperty<ScriptPropertyKey, unknown>(
    object,
    wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
    value,
    hooks,
  );
  if (method !== undefined && method !== null) {
    const fn = viewObjectValue(method, realm.objectPrototype);
    if (!isCallableObject<ScriptPropertyKey, unknown>(fn))
      return { error: "type", value: undefined };
    const result = callObject<ScriptPropertyKey, unknown>(
      fn,
      value,
      [hint],
      undefined,
    );
    if (result.error !== "none") throw "COERCION_CALL_INVARIANT";
    if (viewObjectValue(result.value, realm.objectPrototype) !== undefined)
      return { error: "type", value: undefined };
    return { error: "none", value: result.value };
  }
  return ordinaryPrimitive(value, hint === "string", hooks, realm);
}

/** ToString preserves @@toPrimitive ordering and rejects symbol primitives. */
export function stringValue(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): { readonly error: "none" | "type" | "unsupported"; readonly value: string } {
  const primitive = primitiveToString(value);
  if (primitive.error === "none") return primitive;
  if (viewSymbolValue(value) !== undefined) return { error: "type", value: "" };
  const result = primitiveValue(value, "string", hooks, realm);
  if (result.error === "none" && viewSymbolValue(result.value) !== undefined)
    return { error: "type", value: "" };
  return result.error === "none"
    ? primitiveStringValue(result.value)
    : { error: result.error, value: "" };
}
function primitiveStringValue(value: unknown): {
  readonly error: "none" | "unsupported";
  readonly value: string;
} {
  const bigint = viewBigIntValue(value);
  if (bigint === undefined) return primitiveToString(value);
  const text = bigIntToString(bigint, 10);
  if (text === undefined) throw "BIGINT_STRING_INVARIANT";
  return { error: "none", value: text };
}
/** ToNumber uses the number hint and rejects symbol primitives. */
export function numberValue(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): { readonly error: "none" | "type" | "unsupported"; readonly value: number } {
  const primitive = primitiveToNumber(value);
  if (primitive.error === "none") return primitive;
  if (viewSymbolValue(value) !== undefined) return { error: "type", value: 0 };
  const result = primitiveValue(value, "number", hooks, realm);
  if (
    result.error === "none" &&
    (viewSymbolValue(result.value) !== undefined ||
      viewBigIntValue(result.value) !== undefined)
  )
    return { error: "type", value: 0 };
  return result.error === "none"
    ? primitiveToNumber(result.value)
    : { error: result.error, value: 0 };
}
/** ToIntegerOrInfinity performs one observable numeric conversion and returns
 * mathematical zero for NaN and either signed zero. */
export function integerOrInfinity(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): number {
  const result = numberValue(value, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  const integer = result.value !== result.value ? 0 : Math.trunc(result.value);
  return integer === 0 ? 0 : integer;
}
/** ToNumeric retains BigInt primitives and otherwise performs ToNumber. */
export function numericValue(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: unknown;
} {
  const result = primitiveValue(value, "number", hooks, realm);
  if (result.error !== "none") return result;
  if (viewBigIntValue(result.value) !== undefined) return result;
  if (viewSymbolValue(result.value) !== undefined)
    return { error: "type", value: undefined };
  const number = primitiveToNumber(result.value);
  return { error: number.error, value: number.value };
}
export function ordinaryPrimitive(
  value: unknown,
  stringHint: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: unknown;
} {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return { error: "unsupported", value: undefined };
  const keys = stringHint ? ["toString", "valueOf"] : ["valueOf", "toString"];
  for (const key of keys) {
    if (key === undefined) throw "COERCION_METHOD_INVARIANT";
    const method = getProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      value,
      hooks,
    );
    const fn = viewObjectValue(method, realm.objectPrototype);
    if (!isCallableObject<ScriptPropertyKey, unknown>(fn)) continue;
    const result = callObject<ScriptPropertyKey, unknown>(
      fn,
      value,
      [],
      undefined,
    );
    if (result.error !== "none") throw "COERCION_CALL_INVARIANT";
    if (viewObjectValue(result.value, realm.objectPrototype) === undefined)
      return { error: "none", value: result.value };
  }
  return { error: "type", value: undefined };
}
