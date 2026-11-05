import { viewSymbolValue } from "./symbols.ts";
import { viewObjectValue } from "./values.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
import { primitiveValue } from "./coercion.ts";
import {
  viewBigIntValue,
  compareBigIntValues,
  compareBigIntNumber,
  compareBigIntString,
} from "./bigints.ts";

interface EqualityResult {
  readonly error: "none" | "type" | "unsupported";
  readonly value: boolean;
}

/** IsLooselyEqual including Script primitives and observable object conversion. */
export function looselyEqual(
  left: unknown,
  right: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): EqualityResult {
  if (
    typeof left === "bigint" ||
    typeof right === "bigint" ||
    typeof left === "symbol" ||
    typeof right === "symbol"
  )
    return { error: "unsupported", value: false };
  if (left === right) return { error: "none", value: true };
  const leftSymbol =
    typeof left === "object" && left !== null
      ? viewSymbolValue(left)
      : undefined;
  const rightSymbol =
    typeof right === "object" && right !== null
      ? viewSymbolValue(right)
      : undefined;
  if (leftSymbol !== undefined || rightSymbol !== undefined) {
    if (leftSymbol !== undefined && rightSymbol !== undefined)
      return { error: "none", value: false };
    const other = leftSymbol === undefined ? left : right;
    if (viewObjectValue(other, realm.objectPrototype) === undefined)
      return { error: "none", value: false };
    const converted = primitiveValue(other, "default", hooks, realm);
    if (converted.error !== "none")
      return { error: converted.error, value: false };
    return leftSymbol !== undefined
      ? looselyEqual(left, converted.value, hooks, realm)
      : looselyEqual(converted.value, right, hooks, realm);
  }
  const leftBigInt =
    typeof left === "object" && left !== null
      ? viewBigIntValue(left)
      : undefined;
  const rightBigInt =
    typeof right === "object" && right !== null
      ? viewBigIntValue(right)
      : undefined;
  if (leftBigInt !== undefined || rightBigInt !== undefined) {
    if (leftBigInt !== undefined && rightBigInt !== undefined)
      return {
        error: "none",
        value: compareBigIntValues(leftBigInt, rightBigInt) === 0,
      };
    const bigint = leftBigInt === undefined ? rightBigInt : leftBigInt;
    if (bigint === undefined) throw "BIGINT_EQUALITY_INVARIANT";
    const other = leftBigInt === undefined ? left : right;
    if (typeof other === "number")
      return { error: "none", value: compareBigIntNumber(bigint, other) === 0 };
    if (typeof other === "string")
      return { error: "none", value: compareBigIntString(bigint, other) === 0 };
    if (typeof other === "boolean")
      return {
        error: "none",
        value: compareBigIntNumber(bigint, other ? 1 : 0) === 0,
      };
    if (viewObjectValue(other, realm.objectPrototype) === undefined)
      return { error: "none", value: false };
    const converted = primitiveValue(other, "default", hooks, realm);
    if (converted.error !== "none")
      return { error: converted.error, value: false };
    return leftBigInt === undefined
      ? looselyEqual(converted.value, right, hooks, realm)
      : looselyEqual(left, converted.value, hooks, realm);
  }
  // Annex B nullish equality does not perform ToPrimitive or invoke proxy traps.
  if (
    (left === null || left === undefined) &&
    right !== null &&
    (typeof right === "object" || typeof right === "function")
  ) {
    const object = viewObjectValue(right, realm.objectPrototype);
    if (object !== undefined && object.internalIsHTMLDDA)
      return { error: "none", value: true };
  }
  if (
    (right === null || right === undefined) &&
    left !== null &&
    (typeof left === "object" || typeof left === "function")
  ) {
    const object = viewObjectValue(left, realm.objectPrototype);
    if (object !== undefined && object.internalIsHTMLDDA)
      return { error: "none", value: true };
  }
  if (typeof left === typeof right)
    return { error: "none", value: left === right };
  if (
    (left === null && right === undefined) ||
    (left === undefined && right === null)
  )
    return { error: "none", value: true };
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  )
    return { error: "none", value: false };
  if (typeof left === "boolean")
    return looselyEqual(left ? 1 : 0, right, hooks, realm);
  if (typeof right === "boolean")
    return looselyEqual(left, right ? 1 : 0, hooks, realm);
  if (typeof left === "number" && typeof right === "string")
    return { error: "none", value: left === Number(right) };
  if (typeof left === "string" && typeof right === "number")
    return { error: "none", value: Number(left) === right };
  if (
    (typeof left === "string" || typeof left === "number") &&
    (typeof right === "object" || typeof right === "function")
  ) {
    const converted = primitiveValue(right, "default", hooks, realm);
    if (converted.error !== "none")
      return { error: converted.error, value: false };
    return looselyEqual(left, converted.value, hooks, realm);
  }
  if (
    (typeof right === "string" || typeof right === "number") &&
    (typeof left === "object" || typeof left === "function")
  ) {
    const converted = primitiveValue(left, "default", hooks, realm);
    if (converted.error !== "none")
      return { error: converted.error, value: false };
    return looselyEqual(converted.value, right, hooks, realm);
  }
  return { error: "none", value: false };
}
