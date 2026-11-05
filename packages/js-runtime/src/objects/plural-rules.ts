import {
  canonicalizeLocaleId,
  localeTableValue,
  printLocaleLanguage,
} from "./locale-canonicalization.ts";
import { parseLocaleId } from "./locale-id.ts";
import {
  pluralRuleSets,
  pluralRuleDispatch,
  pluralRangeRules,
  pluralRuleParents,
} from "./plural-rule-data.ts";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralRuleType = "cardinal" | "ordinal";
/** Integer/fraction digit views remain exact beyond binary64. Integer zeroes are
 * virtual so compact exponent shifts do not allocate enormous strings. */
export interface PluralOperands {
  readonly i: string;
  readonly integerZeroes: number;
  readonly f: string;
  readonly t: string;
  readonly v: number;
  readonly w: number;
  readonly c: number;
  readonly e: number;
  readonly fractional: boolean;
}
interface PluralRange {
  readonly lower: number;
  readonly upper: number;
}
interface PluralRelation {
  readonly operand: string;
  readonly modulus: number;
  readonly negated: boolean;
  readonly ranges: readonly PluralRange[];
}
interface PluralCondition {
  readonly category: PluralCategory;
  readonly alternatives: readonly (readonly PluralRelation[])[];
}
export interface PluralRuleSet {
  /** Data source, not a public Intl supportedLocalesOf availability assertion. */
  readonly sourceLocale: string;
  readonly type: PluralRuleType;
  readonly conditions: readonly PluralCondition[];
  readonly categories: readonly PluralCategory[];
  readonly rangeData: string;
}
function unsignedDigits(text: string): string {
  let start = 0;
  while (start < text.length - 1 && text.charCodeAt(start) === 48) start++;
  return text.slice(start);
}
function integer(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++)
    value = value * 10 + text.charCodeAt(i) - 48;
  return value;
}
/** Input is plain displayed decimal text after numerical rounding/padding.
 * The optional compact exponent shifts its decimal point before deriving n/i/f/v.
 * Scientific exponents must not be supplied as compact exponents. */
export function createPluralOperands(
  displayed: string,
  compactExponent: number = 0,
): PluralOperands | undefined {
  if (!Number.isSafeInteger(compactExponent) || compactExponent < 0)
    return undefined;
  let start = 0,
    point = -1;
  if (displayed.charCodeAt(0) === 45 || displayed.charCodeAt(0) === 43)
    start = 1;
  if (start === displayed.length) return undefined;
  for (let i = start; i < displayed.length; i++) {
    const code = displayed.charCodeAt(i);
    if (code === 46) {
      if (point !== -1 || i === start || i === displayed.length - 1)
        return undefined;
      point = i;
    } else if (code < 48 || code > 57) return undefined;
  }
  const whole =
      point === -1 ? displayed.slice(start) : displayed.slice(start, point),
    fraction = point === -1 ? "" : displayed.slice(point + 1);
  const shift = Math.min(compactExponent, fraction.length);
  const i = unsignedDigits(whole + fraction.slice(0, shift)),
    remaining = fraction.slice(shift);
  let end = remaining.length;
  while (end > 0 && remaining.charCodeAt(end - 1) === 48) end--;
  const trimmed = remaining.slice(0, end);
  return {
    i,
    integerZeroes: i === "0" ? 0 : compactExponent - shift,
    f: unsignedDigits(remaining || "0"),
    t: unsignedDigits(trimmed || "0"),
    v: remaining.length,
    w: trimmed.length,
    c: compactExponent,
    e: compactExponent,
    fractional: end !== 0,
  };
}
function category(text: string): PluralCategory {
  if (
    text === "zero" ||
    text === "one" ||
    text === "two" ||
    text === "few" ||
    text === "many" ||
    text === "other"
  )
    return text;
  throw "PLURAL_CATEGORY_DATA_INVARIANT";
}
function relation(text: string): PluralRelation {
  const tokens = text.split(" "),
    operand = tokens[0] ?? "";
  const mod = tokens[1] === "%",
    modulus = mod ? integer(tokens[2] ?? "") : 0,
    operator = tokens[mod ? 3 : 1],
    raw = tokens[mod ? 4 : 2];
  if (raw === undefined || (operator !== "=" && operator !== "!="))
    throw "PLURAL_RELATION_DATA_INVARIANT";
  const ranges: PluralRange[] = [];
  for (const item of raw.split(",")) {
    if (item === undefined) throw "PLURAL_RELATION_DATA_INVARIANT";
    const pair = item.split(".."),
      lower = integer(pair[0] ?? ""),
      upper = pair[1];
    ranges.push({
      lower,
      upper: upper === undefined ? lower : integer(upper),
    });
  }
  return { operand, modulus, negated: operator === "!=", ranges };
}
function parentLocale(locale: string): string {
  const explicit = localeTableValue(pluralRuleParents, locale);
  if (explicit !== undefined) return explicit;
  const separator = locale.lastIndexOf("-");
  return separator === -1 ? "root" : locale.slice(0, separator);
}
function dataLocale(locale: string, type: PluralRuleType): string {
  for (let candidate = locale; ; candidate = parentLocale(candidate)) {
    if (
      localeTableValue(pluralRuleDispatch, type + ":" + candidate) !== undefined
    )
      return candidate;
    const parsed = parseLocaleId(candidate);
    if (
      parsed !== undefined &&
      parsed.language.script !== "" &&
      parsed.language.region !== ""
    ) {
      const regional = printLocaleLanguage(
        {
          language: parsed.language.language,
          script: "",
          region: parsed.language.region,
          variants: [],
        },
        false,
      );
      if (
        localeTableValue(pluralRuleDispatch, type + ":" + regional) !==
        undefined
      )
        return regional;
    }
    if (candidate === "root") throw "PLURAL_ROOT_DATA_INVARIANT";
  }
}
function rangeData(locale: string): string {
  for (let candidate = locale; ; candidate = parentLocale(candidate)) {
    const data = localeTableValue(pluralRangeRules, candidate);
    if (data !== undefined) return data;
    if (candidate === "root") return "";
  }
}
/** Dispatch complete CLDR rules with root fallback. This is data resolution only;
 * it deliberately does not establish any Intl service's available locale set. */
export function createPluralRuleSet(
  locale: string,
  type: PluralRuleType,
): PluralRuleSet | undefined {
  const canonical = locale === "root" ? "root" : canonicalizeLocaleId(locale);
  if (canonical === undefined) return undefined;
  const parsed = canonical === "root" ? undefined : parseLocaleId(canonical);
  const base =
    parsed === undefined ? "root" : printLocaleLanguage(parsed.language, false);
  const sourceLocale = dataLocale(base, type),
    id = localeTableValue(pluralRuleDispatch, type + ":" + sourceLocale);
  const encoded =
    id === undefined ? undefined : localeTableValue(pluralRuleSets, id);
  if (encoded === undefined) throw "PLURAL_RULE_DATA_INVARIANT";
  const conditions: PluralCondition[] = [],
    categories: PluralCategory[] = [];
  for (const row of encoded.split(";")) {
    if (row === undefined) throw "PLURAL_RULE_DATA_INVARIANT";
    const separator = row.indexOf("="),
      name = category(row.slice(0, separator)),
      body = row.slice(separator + 1);
    const alternatives: PluralRelation[][] = [];
    if (body !== "")
      for (const alternative of body.split(" or ")) {
        if (alternative === undefined)
          throw "PLURAL_ALTERNATIVE_DATA_INVARIANT";
        const conjunction: PluralRelation[] = [];
        for (const atom of alternative.split(" and ")) {
          if (atom === undefined) throw "PLURAL_ATOM_DATA_INVARIANT";
          conjunction.push(relation(atom));
        }
        alternatives.push(conjunction);
      }
    conditions.push({ category: name, alternatives });
    categories.push(name);
  }
  // Categories have their normative presentation order, independently of the
  // source predicate ordering used for first-match selection.
  const ordered: PluralCategory[] = [];
  for (const name of ["zero", "one", "two", "few", "many", "other"]) {
    if (name === undefined) throw "PLURAL_CATEGORY_DATA_INVARIANT";
    const value = category(name);
    if (categories.includes(value)) ordered.push(value);
  }
  return {
    sourceLocale,
    type,
    conditions,
    categories: ordered,
    rangeData: type === "cardinal" ? rangeData(base) : "",
  };
}
function remainder(digits: string, zeroes: number, modulus: number): number {
  // All generated moduli are powers of ten. Once enough virtual zeroes follow
  // the coefficient, the remainder is zero without visiting each virtual digit.
  if (zeroes >= String(modulus).length) return 0;
  let result = 0;
  for (let i = 0; i < digits.length; i++)
    result = (result * 10 + digits.charCodeAt(i) - 48) % modulus;
  for (let i = 0; i < zeroes; i++) result = (result * 10) % modulus;
  return result;
}
function compareInteger(digits: string, zeroes: number, bound: number): number {
  const text = String(bound),
    length = digits.length + zeroes;
  if (length !== text.length) return length < text.length ? -1 : 1;
  let value = integer(digits);
  for (let i = 0; i < zeroes; i++) value *= 10;
  return value === bound ? 0 : value < bound ? -1 : 1;
}
function matches(atom: PluralRelation, operands: PluralOperands): boolean {
  const name = atom.operand;
  if (name === "n" && operands.fractional) return atom.negated;
  let digits = "",
    zeroes = 0;
  if (name === "n" || name === "i") {
    digits = operands.i;
    zeroes = operands.integerZeroes;
  } else if (name === "f") digits = operands.f;
  else if (name === "t") digits = operands.t;
  else if (name === "v") digits = String(operands.v);
  else if (name === "w") digits = String(operands.w);
  else if (name === "c") digits = String(operands.c);
  else if (name === "e") digits = String(operands.e);
  else throw "PLURAL_OPERAND_DATA_INVARIANT";
  let hit = false;
  for (const range of atom.ranges) {
    if (range === undefined) throw "PLURAL_RANGE_DATA_INVARIANT";
    if (atom.modulus !== 0) {
      const value = remainder(digits, zeroes, atom.modulus);
      if (value >= range.lower && value <= range.upper) hit = true;
    } else if (
      compareInteger(digits, zeroes, range.lower) >= 0 &&
      compareInteger(digits, zeroes, range.upper) <= 0
    )
      hit = true;
  }
  return atom.negated ? !hit : hit;
}
export function selectPluralCategory(
  rules: PluralRuleSet,
  operands: PluralOperands,
): PluralCategory {
  for (const condition of rules.conditions) {
    if (condition === undefined) throw "PLURAL_CONDITION_DATA_INVARIANT";
    if (condition.alternatives.length === 0) return condition.category;
    for (const alternative of condition.alternatives) {
      if (alternative === undefined) throw "PLURAL_ALTERNATIVE_DATA_INVARIANT";
      let valid = true;
      for (const atom of alternative) {
        if (atom === undefined) throw "PLURAL_ATOM_DATA_INVARIANT";
        if (!matches(atom, operands)) {
          valid = false;
          break;
        }
      }
      if (valid) return condition.category;
    }
  }
  throw "PLURAL_FALLBACK_DATA_INVARIANT";
}
/** CLDR49's unlisted-pair policy is the end category. Ordinal data has no
 * separate matrix, so the same explicit fallback applies. Callers must handle
 * equal formatted endpoints before consulting this category-pair operation. */
export function selectPluralRange(
  rules: PluralRuleSet,
  start: PluralCategory,
  end: PluralCategory,
): PluralCategory {
  for (const row of rules.rangeData.split(";")) {
    if (row === undefined) throw "PLURAL_RANGE_DATA_INVARIANT";
    const fields = row.split(",");
    if (fields[0] === start && fields[1] === end)
      return category(fields[2] ?? "");
  }
  return end;
}
