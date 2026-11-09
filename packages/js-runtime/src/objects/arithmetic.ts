import type { ErrorRealm } from "./errors.ts";
import { viewSymbolValue } from "./symbols.ts";
import type { ObjectHooks } from "./operations.ts";
import {
  primitiveValue,
  numberValue,
  numericValue,
  stringValue,
} from "./coercion.ts";
import {
  binaryValueOperation,
  numberBinaryOperation,
  unaryValueOperation,
  primitiveToNumber,
} from "./operators.ts";
import {
  viewBigIntValue,
  compareBigIntValues,
  compareBigIntNumber,
  compareBigIntString,
  type BigIntValue,
  bigIntBinaryOperation,
  bigIntUnaryOperation,
  createBigIntLiteral,
} from "./bigints.ts";

interface OperatorResult {
  readonly error: "none" | "type" | "range" | "unsupported";
  readonly value: unknown;
}
function numericOperation(
  operator: string,
  left: unknown,
  right: unknown,
  realm: ErrorRealm,
): OperatorResult {
  const a = viewBigIntValue(left),
    b = viewBigIntValue(right);
  if (a !== undefined || b !== undefined) {
    if (a === undefined || b === undefined)
      return { error: "type", value: undefined };
    const result = bigIntBinaryOperation(operator, a, b, realm.bigIntMaxDigits);
    return { error: result.error, value: result.value };
  }
  return binaryValueOperation(operator, left, right);
}

/** Operands are already primitives; preserve StringIntegerLiteral rather than ToNumber. */
function compareBigIntPrimitive(
  left: BigIntValue,
  right: unknown,
): number | undefined {
  const bigint = viewBigIntValue(right);
  if (bigint !== undefined) return compareBigIntValues(left, bigint);
  if (typeof right === "string") return compareBigIntString(left, right);
  const number = primitiveToNumber(right);
  if (number.error !== "none") throw "BIGINT_COMPARISON_INVARIANT";
  return compareBigIntNumber(left, number.value);
}

/** ToPrimitive and numeric conversion around the primitive operator core.
 * Abrupt completions preserve operand conversion order. */
export function binaryObjectValueOperation(
  operator: string,
  left: unknown,
  right: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): OperatorResult {
  // ToPrimitive and ToNumeric are effect-free identities on Numbers, so two Number
  // operands reach the primitive core directly. This entry stays small so the
  // common case does not pay the general path's frame.
  if (typeof left === "number" && typeof right === "number")
    return {
      error: "none",
      value: numberBinaryOperation(operator, left, right),
    };
  return coercedBinaryOperation(operator, left, right, hooks, realm);
}
function coercedBinaryOperation(
  operator: string,
  left: unknown,
  right: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): OperatorResult {
  if (
    operator === "+" ||
    operator === "<" ||
    operator === ">" ||
    operator === "<=" ||
    operator === ">="
  ) {
    // Both operands become primitives before choosing string or numeric behavior.
    const a = primitiveValue(
      left,
      operator === "+" ? "default" : "number",
      hooks,
      realm,
    );
    if (a.error !== "none") return { error: a.error, value: undefined };
    const b = primitiveValue(
      right,
      operator === "+" ? "default" : "number",
      hooks,
      realm,
    );
    if (b.error !== "none") return { error: b.error, value: undefined };
    if (
      viewSymbolValue(a.value) !== undefined ||
      viewSymbolValue(b.value) !== undefined
    )
      return { error: "type", value: undefined };
    if (operator !== "+") {
      const leftBigInt = viewBigIntValue(a.value);
      const rightBigInt = viewBigIntValue(b.value);
      if (leftBigInt !== undefined || rightBigInt !== undefined) {
        let order: number | undefined = undefined;
        if (leftBigInt !== undefined)
          order = compareBigIntPrimitive(leftBigInt, b.value);
        else if (rightBigInt !== undefined) {
          const reversed = compareBigIntPrimitive(rightBigInt, a.value);
          if (reversed !== undefined) order = -reversed;
        }
        if (order === undefined) return { error: "none", value: false };
        return {
          error: "none",
          value:
            operator === "<"
              ? order < 0
              : operator === ">"
                ? order > 0
                : operator === "<="
                  ? order <= 0
                  : order >= 0,
        };
      }
    }
    if (
      operator === "+" &&
      (typeof a.value === "string" || typeof b.value === "string")
    ) {
      const leftText = stringValue(a.value, hooks, realm);
      if (leftText.error !== "none")
        return { error: leftText.error, value: undefined };
      const rightText = stringValue(b.value, hooks, realm);
      if (rightText.error !== "none")
        return { error: rightText.error, value: undefined };
      return { error: "none", value: leftText.value + rightText.value };
    }
    return numericOperation(operator, a.value, b.value, realm);
  }
  const a = numericValue(left, hooks, realm);
  if (a.error !== "none") return { error: a.error, value: undefined };
  const b = numericValue(right, hooks, realm);
  if (b.error !== "none") return { error: b.error, value: undefined };
  return numericOperation(operator, a.value, b.value, realm);
}

export function unaryObjectValueOperation(
  operator: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): OperatorResult {
  if (operator === "+") {
    const converted = numberValue(value, hooks, realm);
    return { error: converted.error, value: converted.value };
  }
  const converted = numericValue(value, hooks, realm);
  if (converted.error !== "none")
    return { error: converted.error, value: undefined };
  const bigint = viewBigIntValue(converted.value);
  if (bigint !== undefined) {
    const result = bigIntUnaryOperation(
      operator,
      bigint,
      realm.bigIntMaxDigits,
    );
    return { error: result.error, value: result.value };
  }
  return unaryValueOperation(operator, converted.value);
}

/** Convert once, retain the numeric old value for postfix, and use a matching unit. */
export function updateObjectValue(
  operator: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "range" | "unsupported";
  readonly previous: unknown;
  readonly value: unknown;
} {
  // A Number is its own ToNumeric result; the Number unit is 1. The entry
  // stays small so the common case does not pay the general path's frame.
  if (typeof value === "number")
    return {
      error: "none",
      previous: value,
      value: operator.charCodeAt(0) === 43 ? value + 1 : value - 1,
    };
  return coercedUpdate(operator, value, hooks, realm);
}
function coercedUpdate(
  operator: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "range" | "unsupported";
  readonly previous: unknown;
  readonly value: unknown;
} {
  const converted = numericValue(value, hooks, realm);
  if (converted.error !== "none")
    return { error: converted.error, previous: undefined, value: undefined };
  let unit: unknown = 1;
  if (viewBigIntValue(converted.value) !== undefined)
    unit = createBigIntLiteral("1");
  const result = numericOperation(
    operator === "++" ? "+" : "-",
    converted.value,
    unit,
    realm,
  );
  return {
    error: result.error,
    previous: converted.value,
    value: result.value,
  };
}
