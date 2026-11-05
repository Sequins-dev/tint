import type { DecimalQuantity } from "@tint/foundation/numeric/number-text";
import {
  formatIntlDecimal,
  type NumberFormatDigitOptions,
  type NumberNotation,
} from "./intl-number-options.ts";
import {
  selectPluralCategory,
  type PluralCategory,
  type PluralRuleSet,
  type PluralRuleType,
} from "./plural-rules.ts";
import {
  pluralCompactExponent,
  createFormattedPluralOperands,
} from "./plural-compact.ts";

export interface PluralFormatter {
  readonly locale: string;
  readonly type: PluralRuleType;
  readonly notation: NumberNotation;
  readonly compactDisplay: "short" | "long" | undefined;
  readonly digits: NumberFormatDigitOptions;
  readonly rules: PluralRuleSet;
}
export interface PluralResolution {
  readonly category: PluralCategory;
  readonly formatted: string | undefined;
}
/** PluralRules rounds the full mathematical value. Compact notation contributes
 * CLDR c/e metadata without scaling the displayed decimal a second time. */
export function resolvePlural(
  formatter: PluralFormatter,
  value: DecimalQuantity,
): PluralResolution {
  if (value.kind !== "finite")
    return { category: "other", formatted: undefined };
  const rounded = formatIntlDecimal(value, formatter.digits);
  if (rounded === undefined) throw "PLURAL_FORMATTING_INVARIANT";
  const quantity = rounded.quantity;
  const magnitude =
    quantity.digits === "0"
      ? 0
      : quantity.exponent + (quantity.digits.length - 1);
  const exponent =
    formatter.notation === "compact"
      ? pluralCompactExponent(
          formatter.locale,
          formatter.compactDisplay ?? "short",
          magnitude,
        )
      : 0;
  const operands = createFormattedPluralOperands(rounded.text, exponent);
  if (operands === undefined) throw "PLURAL_FORMATTED_OPERANDS_INVARIANT";
  return {
    category: selectPluralCategory(formatter.rules, operands),
    formatted: rounded.text,
  };
}
