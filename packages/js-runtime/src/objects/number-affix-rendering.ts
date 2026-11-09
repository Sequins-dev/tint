import type { DecimalQuantity } from "@tint/foundation/numeric/number-text";
import type { NumberAffixPattern, NumberAffixToken } from "./number-affixes.ts";
import {
  appendNumberPart,
  appendNumberSymbol,
  decimalNumberSign,
  type DecimalNumberPart,
  type DecimalNumberSymbols,
  type NumberSignDisplay,
} from "./decimal-number-parts.ts";

export interface NumberAffixSymbols extends DecimalNumberSymbols {
  readonly percentSign: string;
}
export interface NumberAffixRendering {
  readonly currency: string | undefined;
  readonly standardForPlus: NumberAffixPattern | undefined;
}
function signedPattern(
  pattern: NumberAffixPattern,
  sign: number,
  standardForPlus: NumberAffixPattern | undefined,
): readonly NumberAffixToken[] {
  if (sign < 0) return pattern.negative;
  if (sign === 0) return pattern.positive;
  const positivePattern =
    standardForPlus === undefined ? pattern : standardForPlus;
  const plus: NumberAffixToken[] = [];
  let replaced = false;
  for (const token of positivePattern.negative) {
    if (token === undefined) throw "NUMBER_SIGN_AFFIX_INVARIANT";
    if (token.kind === "minusSign") {
      plus.push({ kind: "plusSign", value: "+" });
      replaced = true;
    } else plus.push(token);
  }
  if (replaced) return plus;
  // A parenthesized negative branch has no minus location to replace. It must
  // not turn positive-plus formatting into an accounting-style negative form.
  const result: NumberAffixToken[] = [{ kind: "plusSign", value: "+" }];
  for (const token of positivePattern.positive) {
    if (token === undefined) throw "NUMBER_POSITIVE_AFFIX_INVARIANT";
    result.push(token);
  }
  return result;
}
/** Insert already-rounded unsigned numeric parts into a real locale pattern.
 * The caller partitions numbers using this pattern's grouping dimensions. */
export function renderNumberAffixes(
  pattern: NumberAffixPattern,
  value: DecimalQuantity,
  signDisplay: NumberSignDisplay,
  number: readonly DecimalNumberPart[],
  symbols: NumberAffixSymbols,
  rendering: NumberAffixRendering | undefined = undefined,
): DecimalNumberPart[] {
  const result: DecimalNumberPart[] = [];
  for (const token of signedPattern(
    pattern,
    decimalNumberSign(value, signDisplay),
    rendering === undefined ? undefined : rendering.standardForPlus,
  )) {
    if (token === undefined) throw "NUMBER_RENDER_AFFIX_INVARIANT";
    if (token.kind === "number")
      for (const part of number) {
        if (part === undefined) throw "NUMBER_RENDER_PART_INVARIANT";
        appendNumberPart(result, part);
      }
    else if (token.kind === "literal")
      appendNumberPart(result, { type: "literal", value: token.value });
    else if (token.kind === "plusSign")
      appendNumberSymbol(result, symbols.plusSign, "plusSign");
    else if (token.kind === "minusSign")
      appendNumberSymbol(result, symbols.minusSign, "minusSign");
    else if (token.kind === "percentSign")
      appendNumberSymbol(result, symbols.percentSign, "percentSign");
    else {
      const currency = rendering === undefined ? undefined : rendering.currency;
      if (currency === undefined) throw "CURRENCY_AFFIX_RENDERING_UNSUPPORTED";
      appendNumberSymbol(result, currency, "currency");
    }
  }
  return result;
}
function outerLiteral(code: number, text: string): boolean {
  return code === 1564 || code === 8206 || code === 8207 || text.trim() === "";
}
function unitText(result: DecimalNumberPart[], text: string): void {
  let first = 0,
    last = text.length;
  while (
    first < last &&
    outerLiteral(text.charCodeAt(first), text.charAt(first))
  )
    first++;
  while (
    last > first &&
    outerLiteral(text.charCodeAt(last - 1), text.charAt(last - 1))
  )
    last--;
  if (first > 0)
    appendNumberPart(result, { type: "literal", value: text.slice(0, first) });
  if (last > first) appendNumberSymbol(result, text.slice(first, last), "unit");
  if (last < text.length)
    appendNumberPart(result, { type: "literal", value: text.slice(last) });
}
function visibleLabel(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code !== 1564 && code !== 8206 && code !== 8207)
      result += text.charAt(index);
  }
  return result.trim();
}
function symbolPercentPrefix(prefix: string, percentSign: string): boolean {
  const label = visibleLabel(prefix);
  return (
    label !== "" &&
    (label === visibleLabel(percentSign) ||
      label === "%" ||
      label === "٪" ||
      label === "％" ||
      label === "﹪")
  );
}
function leadingSignEnd(number: readonly DecimalNumberPart[]): number {
  let end = 0,
    found = false;
  for (const part of number) {
    if (part === undefined) throw "PERCENT_UNIT_SIGN_PART_INVARIANT";
    if (part.type === "minusSign" || part.type === "plusSign") found = true;
    else if (part.type !== "literal") break;
    end++;
  }
  return found ? end : 0;
}
/** Genuine concentr-percent unit templates, applied without percent scaling.
 * Labels retain inner spaces; outer whitespace and direction controls are
 * literal parts. ILD sign policy: symbol-only percent prefixes take the existing
 * numeric sign before the label; word prefixes retain their signed placeholder.
 * This changes no template spacing and invents no sign or direction controls. */
export function renderPercentUnit(
  template: string,
  number: readonly DecimalNumberPart[],
  percentSign: string = "%",
): DecimalNumberPart[] {
  const marker = template.indexOf("{0}");
  if (marker < 0 || template.indexOf("{0}", marker + 3) !== -1)
    throw "PERCENT_UNIT_TEMPLATE_INVARIANT";
  return renderUnitTemplate(
    template,
    number,
    symbolPercentPrefix(template.slice(0, marker), percentSign),
  );
}
/** Unit grammar may spell a singular/dual value without a numeric placeholder.
 * Keep the numeric sign and its controls even when the number itself is omitted. */
export function renderUnitPattern(
  template: string,
  number: readonly DecimalNumberPart[],
): DecimalNumberPart[] {
  const marker = template.indexOf("{0}");
  if (marker >= 0 && template.indexOf("{0}", marker + 3) !== -1)
    throw "UNIT_TEMPLATE_INVARIANT";
  return renderUnitTemplate(template, number, false);
}
function renderUnitTemplate(
  template: string,
  number: readonly DecimalNumberPart[],
  signBeforeLabel: boolean,
): DecimalNumberPart[] {
  const marker = template.indexOf("{0}");
  const result: DecimalNumberPart[] = [],
    prefix = marker < 0 ? template : template.slice(0, marker);
  const signEnd = marker < 0 || signBeforeLabel ? leadingSignEnd(number) : 0;
  for (let index = 0; index < signEnd; index++) {
    const part = number[index];
    if (part === undefined) throw "PERCENT_UNIT_SIGN_PREFIX_INVARIANT";
    appendNumberPart(result, part);
  }
  unitText(result, prefix);
  if (marker < 0) return result;
  for (let index = signEnd; index < number.length; index++) {
    const part = number[index];
    if (part === undefined) throw "PERCENT_UNIT_NUMBER_INVARIANT";
    appendNumberPart(result, part);
  }
  unitText(result, template.slice(marker + 3));
  return result;
}
