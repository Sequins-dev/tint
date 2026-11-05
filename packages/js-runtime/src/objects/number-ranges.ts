import type { DecimalQuantity } from "@tint/foundation/numeric/number-text";
import {
  appendString,
  createStringBuilder,
  finishString,
} from "@tint/foundation/text/string-builder";
import { localeTableValue } from "./locale-canonicalization.ts";
import { lookupNumberFormatLocale } from "./number-format-profile.ts";
import {
  decimalNumberParts,
  type DecimalNumberFormatter,
} from "./decimal-number-format.ts";
import type { DecimalNumberPart } from "./decimal-number-parts.ts";
import {
  numberRangeSeparators,
  numberRangeBindings,
  numberRangeLocales,
} from "./number-range-data.ts";

export type NumberRangeSource = "startRange" | "endRange" | "shared";
export interface NumberRangePart {
  readonly type: string;
  readonly value: string;
  readonly source: NumberRangeSource;
}
function asciiLower(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    result += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return result;
}
/** Range availability follows the numeric formatter's exact locale owner and
 * advertised numbering systems. No independent locale fallback is introduced. */
export function numberRangeSeparator(
  locale: string,
  numberingSystem: string,
): string | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const row = localeTableValue(numberRangeLocales, asciiLower(matched));
  if (row === undefined) return undefined;
  const bindings = localeTableValue(
    numberRangeBindings,
    row.slice(row.indexOf(",") + 1),
  );
  if (bindings === undefined) throw "NUMBER_RANGE_BINDING_INVARIANT";
  for (const entry of bindings.split(";")) {
    if (entry === undefined) throw "NUMBER_RANGE_SYSTEM_INVARIANT";
    const split = entry.indexOf(",");
    if (entry.slice(0, split) === numberingSystem) {
      const separator = localeTableValue(
        numberRangeSeparators,
        entry.slice(split + 1),
      );
      if (separator === undefined) throw "NUMBER_RANGE_SEPARATOR_INVARIANT";
      return separator;
    }
  }
  return undefined;
}
function joinedParts(parts: readonly DecimalNumberPart[]): string {
  const builder = createStringBuilder();
  for (const part of parts) {
    if (part === undefined) throw "NUMBER_RANGE_PART_INVARIANT";
    appendString(builder, part.value);
  }
  return finishString(builder);
}
function appendPart(output: NumberRangePart[], part: NumberRangePart): void {
  const index = output.length - 1,
    previous = output[index];
  if (
    part.type === "literal" &&
    previous !== undefined &&
    previous.type === "literal" &&
    previous.source === part.source
  )
    output[index] = {
      type: "literal",
      value: previous.value + part.value,
      source: part.source,
    };
  else output.push(part);
}
function appendParts(
  output: NumberRangePart[],
  parts: readonly DecimalNumberPart[],
  source: NumberRangeSource,
): void {
  for (const part of parts) {
    if (part === undefined) throw "NUMBER_RANGE_PART_INVARIANT";
    appendPart(output, { type: part.type, value: part.value, source });
  }
}
interface RangeEndpoint {
  readonly prefix: readonly DecimalNumberPart[];
  readonly core: readonly DecimalNumberPart[];
  readonly suffix: readonly DecimalNumberPart[];
}
function numericPart(part: DecimalNumberPart): boolean {
  return (
    part.type === "integer" ||
    part.type === "fraction" ||
    part.type === "decimal" ||
    part.type === "group" ||
    part.type === "nan" ||
    part.type === "infinity"
  );
}
function splitEndpoint(parts: readonly DecimalNumberPart[]): RangeEndpoint {
  let first = -1,
    last = -1;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) throw "NUMBER_RANGE_ENDPOINT_INVARIANT";
    if (numericPart(part)) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0) throw "NUMBER_RANGE_NUMERIC_CORE_INVARIANT";
  return {
    prefix: parts.slice(0, first),
    core: parts.slice(first, last + 1),
    suffix: parts.slice(last + 1),
  };
}
function sameParts(
  left: readonly DecimalNumberPart[],
  right: readonly DecimalNumberPart[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index],
      b = right[index];
    if (a === undefined || b === undefined)
      throw "NUMBER_RANGE_AFFIX_INVARIANT";
    if (a.type !== b.type || a.value !== b.value) return false;
  }
  return true;
}
function codePoints(parts: readonly DecimalNumberPart[]): number {
  let count = 0;
  for (const part of parts) {
    if (part === undefined) throw "NUMBER_RANGE_CODEPOINT_INVARIANT";
    for (let index = 0; index < part.value.length; index++) {
      const point = part.value.codePointAt(index);
      if (point === undefined) throw "NUMBER_RANGE_CODEPOINT_INVARIANT";
      count++;
      if (point > 65535) index++;
    }
  }
  return count;
}
/** Preserve existing Unicode whitespace, including CLDR thin-space separators.
 * This is deliberately broader than ICU's Pattern_White_Space padding test. */
function paddedSeparator(separator: string): string {
  if (separator === "") throw "NUMBER_RANGE_EMPTY_SEPARATOR_INVARIANT";
  return (
    (separator.charAt(0).trim() === "" ? "" : " ") +
    separator +
    (separator.charAt(separator.length - 1).trim() === "" ? "" : " ")
  );
}
/** The Script adapter owns receiver checks, endpoint conversion and NaN's realm
 * RangeError. Middle affixes use a general AUTO collapse policy. Unit modifiers
 * retain their separate uncollapsed policy until their plural layers are exposed. */
export function decimalNumberRangeParts(
  formatter: DecimalNumberFormatter,
  x: DecimalQuantity,
  y: DecimalQuantity,
): NumberRangePart[] {
  if (x.kind === "nan" || y.kind === "nan") throw "NUMBER_RANGE_NAN_INVARIANT";
  const left = decimalNumberParts(formatter, x),
    right = decimalNumberParts(formatter, y);
  const output: NumberRangePart[] = [];
  if (joinedParts(left) === joinedParts(right)) {
    const sign = formatter.profile.symbols.approximatelySign;
    // Approximation position is implementation-defined. The standard-decimal
    // policy prefixes the actual locale symbol, retaining endpoint sign parts.
    if (sign !== "")
      output.push({ type: "approximatelySign", value: sign, source: "shared" });
    appendParts(output, left, "shared");
    return output;
  }
  const separator = numberRangeSeparator(
    formatter.profile.locale,
    formatter.numberingSystem,
  );
  if (separator === undefined) throw "NUMBER_RANGE_PROFILE_INVARIANT";
  const a = splitEndpoint(left),
    b = splitEndpoint(right);
  const modifierLength = codePoints(a.prefix) + codePoints(a.suffix);
  // Equal complete modifiers collapse as one unit. Partial common-prefix
  // removal can otherwise lose a sign or change accounting scope.
  const middle = formatter.style !== "unit";
  const collapse =
    middle &&
    modifierLength > 1 &&
    sameParts(a.prefix, b.prefix) &&
    sameParts(a.suffix, b.suffix);
  const joinedSeparator =
    middle && !collapse && modifierLength > 0
      ? paddedSeparator(separator)
      : separator;
  if (collapse) {
    appendParts(output, a.prefix, "shared");
    appendParts(output, a.core, "startRange");
    appendPart(output, {
      type: "literal",
      value: joinedSeparator,
      source: "shared",
    });
    appendParts(output, b.core, "endRange");
    appendParts(output, a.suffix, "shared");
  } else {
    appendParts(output, left, "startRange");
    appendPart(output, {
      type: "literal",
      value: joinedSeparator,
      source: "shared",
    });
    appendParts(output, right, "endRange");
  }
  return output;
}
export function formatDecimalNumberRange(
  formatter: DecimalNumberFormatter,
  x: DecimalQuantity,
  y: DecimalQuantity,
): string {
  const builder = createStringBuilder();
  for (const part of decimalNumberRangeParts(formatter, x, y)) {
    if (part === undefined) throw "NUMBER_RANGE_PART_INVARIANT";
    appendString(builder, part.value);
  }
  return finishString(builder);
}
