import {
  parseInteger,
  formatInteger,
} from "@tint/foundation/numeric/big-integer";
import type { Expression } from "./model.ts";
/** Resolve only side-effect-free literal property keys; other expressions stay dynamic. */
export function literalPropertyName(node: Expression): string | undefined {
  while (node.kind === "group") node = node.expression;
  if (node.kind === "string") return node.value;
  if (node.kind === "number") return String(node.value);
  if (node.kind === "bigint") return node.value;
  if (
    node.kind === "unary" &&
    (node.operator === "+" || node.operator === "-")
  ) {
    let operand = node.operand;
    while (operand.kind === "group") operand = operand.expression;
    if (operand.kind === "bigint" && node.operator === "-")
      return operand.value === "0" ? "0" : "-" + operand.value;
    if (operand.kind === "number")
      return String(node.operator === "-" ? -operand.value : operand.value);
  }
  return undefined;
}

/** Called only for lexer-validated integer literals, preserving arbitrary precision. */
export function bigintLiteralValue(raw: string): string {
  const text = raw.slice(0, -1).split("_").join("");
  const prefix = text.charAt(1);
  const radix =
    prefix === "x" || prefix === "X"
      ? 16
      : prefix === "b" || prefix === "B"
        ? 2
        : prefix === "o" || prefix === "O"
          ? 8
          : 10;
  const parsed = parseInteger(radix === 10 ? text : text.slice(2), radix);
  if (parsed === undefined) throw "BIGINT_LITERAL_INVARIANT";
  const formatted = formatInteger(parsed, 10);
  if (formatted === undefined) throw "BIGINT_RADIX_INVARIANT";
  return formatted;
}
