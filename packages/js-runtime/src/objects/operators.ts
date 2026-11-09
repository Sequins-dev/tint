import { numberPower } from "./number-power.ts";

/** ECMAScript SameValue for the concrete runtime value representation. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    if (typeof left === "number" && typeof right === "number")
      return left !== 0 || 1 / left === 1 / right;
    return true;
  }
  return left !== left && right !== right;
}

/** Primitive conversions only. Objects require ToPrimitive; unsupported is an
 * embedding outcome and must never be interpreted as a JavaScript type error. */
export function primitiveToNumber(value: unknown): {
  readonly error: "none" | "unsupported";
  readonly value: number;
} {
  if (typeof value === "number") return { error: "none", value };
  if (typeof value === "string") return { error: "none", value: Number(value) };
  if (typeof value === "boolean")
    return { error: "none", value: value ? 1 : 0 };
  if (value === null) return { error: "none", value: 0 };
  if (value === undefined) return { error: "none", value: NaN };
  return { error: "unsupported", value: 0 };
}
export function primitiveToString(value: unknown): {
  readonly error: "none" | "unsupported";
  readonly value: string;
} {
  if (typeof value === "string") return { error: "none", value };
  if (typeof value === "number") return { error: "none", value: String(value) };
  if (typeof value === "boolean")
    return { error: "none", value: value ? "true" : "false" };
  if (value === null) return { error: "none", value: "null" };
  if (value === undefined) return { error: "none", value: "undefined" };
  return { error: "unsupported", value: "" };
}
/** Property access evaluates its key expression before this operation, but
 * rejects a nullish base before invoking ToPropertyKey. */
export function primitivePropertyKey(
  base: unknown,
  key: unknown,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: string;
} {
  if (base === null || base === undefined) return { error: "type", value: "" };
  return primitiveToString(key);
}
/** Number op Number, dispatched on the operator's length and character codes
 * rather than a chain of string comparisons. Relational operators keep their
 * unordered NaN results. */
export function numberBinaryOperation(
  operator: string,
  x: number,
  y: number,
): number | boolean {
  const length = operator.length,
    first = operator.charCodeAt(0);
  if (length === 1) {
    if (first === 43) return x + y; // +
    if (first === 45) return x - y; // -
    if (first === 42) return x * y; // *
    if (first === 47) return x / y; // /
    if (first === 37) return x % y; // %
    if (first === 60) return x < y; // <
    if (first === 62) return x > y; // >
    if (first === 38) return x & y; // &
    if (first === 124) return x | y; // |
    if (first === 94) return x ^ y; // ^
  } else if (length === 2) {
    const second = operator.charCodeAt(1);
    if (second === 61) {
      if (first === 60) return x <= y; // <=
      if (first === 62) return x >= y; // >=
    } else if (first === 42 && second === 42) return numberPower(x, y);
    else if (first === 60 && second === 60) return x << y;
    else if (first === 62 && second === 62) return x >> y;
  } else if (length === 3 && operator === ">>>") return x >>> y;
  throw "BINARY_OPERATOR_INVARIANT";
}
export function binaryValueOperation(
  operator: string,
  left: unknown,
  right: unknown,
): { readonly error: "none" | "unsupported"; readonly value: unknown } {
  if (typeof left === "number" && typeof right === "number")
    return {
      error: "none",
      value: numberBinaryOperation(operator, left, right),
    };
  if (typeof left === "string" && typeof right === "string") {
    if (operator === "<") return { error: "none", value: left < right };
    if (operator === ">") return { error: "none", value: left > right };
    if (operator === "<=") return { error: "none", value: left <= right };
    if (operator === ">=") return { error: "none", value: left >= right };
  }
  if (
    operator === "+" &&
    (typeof left === "string" || typeof right === "string")
  ) {
    const a = primitiveToString(left);
    if (a.error !== "none") return { error: a.error, value: undefined };
    const b = primitiveToString(right);
    if (b.error !== "none") return { error: b.error, value: undefined };
    return { error: "none", value: a.value + b.value };
  }
  // Numbers are their own ToNumber result; only other primitives need a record.
  let x = 0,
    y = 0;
  if (typeof left === "number") x = left;
  else {
    const a = primitiveToNumber(left);
    if (a.error !== "none") return { error: a.error, value: undefined };
    x = a.value;
  }
  if (typeof right === "number") y = right;
  else {
    const b = primitiveToNumber(right);
    if (b.error !== "none") return { error: b.error, value: undefined };
    y = b.value;
  }
  return { error: "none", value: numberBinaryOperation(operator, x, y) };
}
export function unaryValueOperation(
  operator: string,
  value: unknown,
): { readonly error: "none" | "unsupported"; readonly value: unknown } {
  const converted = primitiveToNumber(value);
  if (converted.error !== "none")
    return { error: converted.error, value: undefined };
  if (operator === "+") return { error: "none", value: converted.value };
  if (operator === "-") return { error: "none", value: -converted.value };
  if (operator === "~") return { error: "none", value: ~converted.value };
  throw "UNARY_OPERATOR_INVARIANT";
}
