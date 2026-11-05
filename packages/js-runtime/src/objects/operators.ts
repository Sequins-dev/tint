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
export function binaryValueOperation(
  operator: string,
  left: unknown,
  right: unknown,
): { readonly error: "none" | "unsupported"; readonly value: unknown } {
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
  const a = primitiveToNumber(left);
  if (a.error !== "none") return { error: a.error, value: undefined };
  const b = primitiveToNumber(right);
  if (b.error !== "none") return { error: b.error, value: undefined };
  if (operator === "**") {
    return { error: "none", value: numberPower(a.value, b.value) };
  }
  // Direct comparisons preserve unordered NaN results for all four operators.
  if (operator === "<") return { error: "none", value: a.value < b.value };
  if (operator === ">") return { error: "none", value: a.value > b.value };
  if (operator === "<=") return { error: "none", value: a.value <= b.value };
  if (operator === ">=") return { error: "none", value: a.value >= b.value };
  let result = 0;
  if (operator === "+") result = a.value + b.value;
  else if (operator === "-") result = a.value - b.value;
  else if (operator === "*") result = a.value * b.value;
  else if (operator === "/") result = a.value / b.value;
  else if (operator === "%") result = a.value % b.value;
  else if (operator === "&") result = a.value & b.value;
  else if (operator === "|") result = a.value | b.value;
  else if (operator === "^") result = a.value ^ b.value;
  else if (operator === "<<") result = a.value << b.value;
  else if (operator === ">>") result = a.value >> b.value;
  else if (operator === ">>>") result = a.value >>> b.value;
  else throw "BINARY_OPERATOR_INVARIANT";
  return { error: "none", value: result };
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
