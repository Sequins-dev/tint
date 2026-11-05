import type { DecimalQuantity } from "@tint/foundation/numeric/number-text";

export type DecimalNumberPartType =
  | "integer"
  | "fraction"
  | "decimal"
  | "group"
  | "plusSign"
  | "minusSign"
  | "percentSign"
  | "currency"
  | "unit"
  | "nan"
  | "infinity"
  | "literal";
export interface DecimalNumberPart {
  readonly type: DecimalNumberPartType;
  readonly value: string;
}
export interface DecimalNumberSymbols {
  readonly decimal: string;
  readonly group: string;
  readonly plusSign: string;
  readonly minusSign: string;
  readonly nan: string;
  readonly infinity: string;
}
export interface DecimalGrouping {
  readonly primaryGrouping: number;
  readonly secondaryGrouping: number;
  readonly minimumGroupingDigits: number;
}
export type NumberGrouping = false | "auto" | "always" | "min2";
export type NumberSignDisplay =
  "auto" | "always" | "never" | "exceptZero" | "negative";

/** Decode ten distinct codepoints, preserving astral digits as whole strings.
 * Numeric systems such as hanidec need not be contiguous Unicode ranges. */
export function decodeNumberingDigits(encoded: string): string[] | undefined {
  const result: string[] = [];
  for (let index = 0; index < encoded.length; index++) {
    const first = encoded.charCodeAt(index);
    let width = 1;
    if (first >= 55296 && first <= 56319) {
      const second = encoded.charCodeAt(index + 1);
      if (!(second >= 56320 && second <= 57343)) return undefined;
      width = 2;
    } else if (first >= 56320 && first <= 57343) return undefined;
    const digit = encoded.slice(index, index + width);
    if (result.includes(digit)) return undefined;
    result.push(digit);
    index += width - 1;
  }
  return result.length === 10 ? result : undefined;
}
function substitute(text: string, digits: readonly string[]): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index) - 48;
    if (code < 0 || code > 9) throw "NUMBER_DECIMAL_DIGIT_INVARIANT";
    const digit = digits[code];
    if (digit === undefined) throw "NUMBER_DIGIT_TABLE_INVARIANT";
    result += digit;
  }
  return result;
}
/** Merge adjacent literals without mutating source token/part records. */
export function appendNumberPart(
  parts: DecimalNumberPart[],
  part: DecimalNumberPart,
): void {
  if (part.value === "") return;
  const index = parts.length - 1,
    last = parts[index];
  if (part.type === "literal" && last !== undefined && last.type === "literal")
    parts[index] = { type: "literal", value: last.value + part.value };
  else parts.push(part);
}
/** Direction controls are literal parts around signs/labels. Special NaN and
 * infinity words bypass this helper so embedded format controls remain intact. */
export function appendNumberSymbol(
  parts: DecimalNumberPart[],
  text: string,
  kind: DecimalNumberPartType,
): void {
  let run = "",
    literal = false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index),
      control = code === 1564 || code === 8206 || code === 8207;
    if (run !== "" && control !== literal) {
      appendNumberPart(parts, { type: literal ? "literal" : kind, value: run });
      run = "";
    }
    literal = control;
    run += text.charAt(index);
  }
  if (run !== "")
    appendNumberPart(parts, { type: literal ? "literal" : kind, value: run });
}
/** Sign choice uses the rounded mathematical quantity, including negative zero. */
export function decimalNumberSign(
  value: DecimalQuantity,
  signDisplay: NumberSignDisplay,
): number {
  const zero =
    value.kind === "nan" || (value.kind === "finite" && value.digits === "0");
  const negative = value.kind !== "nan" && value.negative;
  if (signDisplay === "always") return negative ? -1 : 1;
  if (signDisplay === "auto") return negative ? -1 : 0;
  if (signDisplay === "exceptZero" && !zero) return negative ? -1 : 1;
  if (signDisplay === "negative" && negative && !zero) return -1;
  return 0;
}
/** Standard decimal parts after mathematical rounding and minimum-digit padding.
 * This stage owns substitution/grouping/signs, not locale negotiation or digit
 * option access. Special words are intact; only sign direction marks split into
 * literal parts. The caller supplies unsigned plain decimal text for finite x. */
export function partitionDecimalNumber(
  value: DecimalQuantity,
  plain: string,
  symbols: DecimalNumberSymbols,
  digits: readonly string[],
  grouping: DecimalGrouping,
  useGrouping: NumberGrouping,
  signDisplay: NumberSignDisplay,
): DecimalNumberPart[] {
  const parts: DecimalNumberPart[] = [];
  const sign = decimalNumberSign(value, signDisplay);
  if (sign !== 0)
    appendNumberSymbol(
      parts,
      sign < 0 ? symbols.minusSign : symbols.plusSign,
      sign < 0 ? "minusSign" : "plusSign",
    );
  if (value.kind === "nan") {
    parts.push({ type: "nan", value: symbols.nan });
    return parts;
  }
  if (value.kind === "infinity") {
    parts.push({ type: "infinity", value: symbols.infinity });
    return parts;
  }
  const point = plain.indexOf("."),
    integer = point === -1 ? plain : plain.slice(0, point);
  const primary = grouping.primaryGrouping,
    secondary = grouping.secondaryGrouping;
  const minimum =
    useGrouping === "auto"
      ? grouping.minimumGroupingDigits
      : useGrouping === "min2"
        ? 2
        : 1;
  const grouped =
    useGrouping !== false &&
    primary > 0 &&
    secondary > 0 &&
    integer.length >= primary + minimum;
  if (!grouped)
    parts.push({ type: "integer", value: substitute(integer, digits) });
  else {
    const beforeLast = integer.length - primary;
    let width = beforeLast % secondary;
    if (width === 0) width = secondary;
    let offset = 0;
    while (offset < integer.length) {
      parts.push({
        type: "integer",
        value: substitute(integer.slice(offset, offset + width), digits),
      });
      offset += width;
      if (offset < integer.length) {
        parts.push({ type: "group", value: symbols.group });
        width = integer.length - offset === primary ? primary : secondary;
      }
    }
  }
  if (point !== -1) {
    parts.push({ type: "decimal", value: symbols.decimal });
    parts.push({
      type: "fraction",
      value: substitute(plain.slice(point + 1), digits),
    });
  }
  return parts;
}
