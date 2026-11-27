import { roundFloat } from "@tint/foundation/binary/bytes";

export type Constant = number | boolean;
export function unary(operator: string, value: Constant): Constant | undefined {
  if (operator === "!") return !value;
  if (operator === "truthy") return !!value;
  if (operator === "is-integer")
    return typeof value === "number" && Number.isInteger(value);
  if (typeof value === "boolean")
    return operator === "boolean-number" ? (value ? 1 : 0) : undefined;
  switch (operator) {
    case "+":
      return value;
    case "uint32":
      // A range assumption: identity on the values it admits.
      return Number.isInteger(value) && value >= 0 && value <= 4294967295
        ? value
        : undefined;
    case "-":
      return -value;
    case "~":
      return ~value;
    case "ceil":
      return Math.ceil(value);
    case "trunc":
      return Math.trunc(value);
    case "sqrt":
      return Math.sqrt(value);
    case "fround":
      return roundFloat(value, 4);
    case "f16round":
      return roundFloat(value, 2);
  }
  return undefined;
}
export function binary(
  operator: string,
  left: Constant,
  right: Constant,
): Constant | undefined {
  if (typeof left !== typeof right) return undefined;
  if (operator === "===" || operator === "==") return left === right;
  if (operator === "!==" || operator === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return undefined;
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "%":
      return left % right;
    case "<<":
      return left << right;
    case ">>":
      return left >> right;
    case ">>>":
      return left >>> right;
    case "&":
      return left & right;
    case "|":
      return left | right;
    case "^":
      return left ^ right;
    case "imul":
      return Math.imul(left, right);
    case "min":
      return Math.min(left, right);
    case "max":
      return Math.max(left, right);
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
  }
  return undefined;
}
