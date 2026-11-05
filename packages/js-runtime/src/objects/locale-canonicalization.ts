import {
  parseLocaleId,
  type LocaleLanguage,
  type LocaleField,
  type LocaleExtension,
} from "./locale-id.ts";
import {
  localeAliasRules,
  localeLikelySubtags,
  localeSubdivisionAliases,
  localeTypeAliases,
} from "./locale-data.ts";

interface AliasRule {
  readonly type: readonly (readonly string[])[];
  readonly replacements: readonly (readonly (readonly string[])[])[];
}

function languageFields(language: LocaleLanguage): string[][] {
  return [
    language.language === "und" ? [] : [language.language],
    language.script === "" ? [] : [language.script],
    language.region === "" ? [] : [language.region],
    language.variants.slice(),
  ];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function uppercaseAscii(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    result += String.fromCharCode(code >= 97 && code <= 122 ? code - 32 : code);
  }
  return result;
}

function aliasFields(source: string): string[][] {
  const parsed = parseLocaleId(source);
  if (parsed === undefined || parsed.extensions.length !== 0)
    throw "LOCALE_ALIAS_DATA_INVARIANT";
  return languageFields(parsed.language);
}

function aliases(): readonly AliasRule[] {
  const result: AliasRule[] = [];
  for (const row of localeAliasRules.split("\n")) {
    if (row === undefined) throw "LOCALE_ALIAS_DATA_INVARIANT";
    const separator = row.indexOf("|");
    const replacements: string[][][] = [];
    for (const value of row.slice(separator + 1).split(" ")) {
      if (value === undefined) throw "LOCALE_ALIAS_DATA_INVARIANT";
      replacements.push(aliasFields(value));
    }
    result.push({ type: aliasFields(row.slice(0, separator)), replacements });
  }
  return result;
}

/** Sorted, immutable key|value rows avoid host dictionaries and eager data graphs. */
export function localeTableValue(
  rows: string,
  key: string,
): string | undefined {
  let start = 0,
    end = rows.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    let rowStart = middle;
    while (rowStart > start && rows.charCodeAt(rowStart - 1) !== 10) rowStart--;
    const newline = rows.indexOf("\n", middle);
    const rowEnd = newline === -1 ? rows.length : newline;
    const row = rows.slice(rowStart, rowEnd);
    const separator = row.indexOf("|"),
      candidate = row.slice(0, separator);
    if (candidate === key) return row.slice(separator + 1);
    if (candidate < key) start = rowEnd + 1;
    else end = rowStart;
  }
  return undefined;
}

function fieldAt(
  fields: readonly (readonly string[])[],
  index: number,
): readonly string[] {
  const field = fields[index];
  if (field === undefined) throw "LOCALE_FIELD_INVARIANT";
  return field;
}

function matches(
  rule: AliasRule,
  current: readonly (readonly string[])[],
): boolean {
  for (let index = 0; index < 4; index++) {
    const target = fieldAt(current, index);
    for (const value of fieldAt(rule.type, index)) {
      if (value === undefined) throw "LOCALE_FIELD_INVARIANT";
      if (!target.includes(value)) return false;
    }
  }
  return true;
}

function replacementFor(
  rule: AliasRule,
  current: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const first = rule.replacements[0];
  if (first === undefined) throw "LOCALE_ALIAS_DATA_INVARIANT";
  if (rule.replacements.length === 1) return first;
  const language = fieldAt(current, 0)[0] ?? "und",
    script = fieldAt(current, 1)[0] ?? "";
  const keys = [script === "" ? language : language + "-" + script, language];
  for (const key of keys) {
    if (key === undefined) throw "LOCALE_FIELD_INVARIANT";
    const likely = localeTableValue(localeLikelySubtags, key);
    if (likely === undefined) continue;
    const region = likely.slice(likely.lastIndexOf("-") + 1);
    for (const replacement of rule.replacements) {
      if (replacement === undefined) throw "LOCALE_ALIAS_DATA_INVARIANT";
      if (fieldAt(replacement, 2)[0] === region) return replacement;
    }
    break;
  }
  return first;
}

function canonicalLanguage(language: LocaleLanguage): LocaleLanguage {
  let current = languageFields(language);
  const rules = aliases();
  for (let step = 0; step <= rules.length; step++) {
    const matched = matchingRule(rules, current);
    if (matched === undefined)
      return {
        language: fieldAt(current, 0)[0] ?? "und",
        script: fieldAt(current, 1)[0] ?? "",
        region: fieldAt(current, 2)[0] ?? "",
        variants: fieldAt(current, 3).slice().sort(compareStrings),
      };
    const replacement = replacementFor(matched, current),
      next: string[][] = [];
    for (let index = 0; index < 4; index++) {
      const type = fieldAt(matched.type, index),
        old = fieldAt(current, index),
        values: string[] = [];
      if (type.length === 0)
        next.push(
          (old.length === 0 ? fieldAt(replacement, index) : old).slice(),
        );
      else {
        for (const value of old) {
          if (value === undefined) throw "LOCALE_FIELD_INVARIANT";
          if (!type.includes(value)) values.push(value);
        }
        for (const value of fieldAt(replacement, index)) {
          if (value === undefined) throw "LOCALE_FIELD_INVARIANT";
          if (!values.includes(value)) values.push(value);
        }
        next.push(values);
      }
    }
    current = next;
  }
  throw "LOCALE_ALIAS_CYCLE";
}

function matchingRule(
  rules: readonly AliasRule[],
  current: readonly (readonly string[])[],
): AliasRule | undefined {
  for (const rule of rules) {
    if (rule === undefined) throw "LOCALE_ALIAS_DATA_INVARIANT";
    if (matches(rule, current)) return rule;
  }
  return undefined;
}

export function printLocaleLanguage(
  language: LocaleLanguage,
  transformed: boolean,
): string {
  let result = language.language;
  if (language.script !== "")
    result +=
      "-" +
      (transformed
        ? language.script
        : uppercaseAscii(language.script.slice(0, 1)) +
          language.script.slice(1));
  if (language.region !== "")
    result +=
      "-" + (transformed ? language.region : uppercaseAscii(language.region));
  for (const variant of language.variants) {
    if (variant === undefined) throw "LOCALE_FIELD_INVARIANT";
    result += "-" + variant;
  }
  return result;
}

function canonicalType(extension: string, key: string, source: string): string {
  let value = source;
  for (let step = 0; ; step++) {
    const replacement = localeTableValue(
      localeTypeAliases,
      extension + ":" + key + ":" + value,
    );
    if (replacement === undefined) break;
    if (step >= localeTypeAliases.length) throw "LOCALE_TYPE_ALIAS_CYCLE";
    value = replacement;
  }
  if (extension === "u" && (key === "rg" || key === "sd")) {
    for (let step = 0; ; step++) {
      const replacement = localeTableValue(localeSubdivisionAliases, value);
      if (replacement === undefined) break;
      if (step >= localeSubdivisionAliases.length)
        throw "LOCALE_SUBDIVISION_ALIAS_CYCLE";
      value = replacement;
    }
    if (
      value.length === 2 &&
      value >= "aa" &&
      value <= "zz" &&
      value.charCodeAt(1) >= 97 &&
      value.charCodeAt(1) <= 122
    )
      value += "zzzz";
  }
  return value;
}

function compareFields(a: LocaleField, b: LocaleField): number {
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

function printExtension(extension: LocaleExtension): string {
  if (extension.key !== "u" && extension.key !== "t")
    return extension.subtags.join("-");
  const parts: string[] = [],
    fields: LocaleField[] = [],
    seen: string[] = [];
  if (extension.key === "u") {
    for (const attribute of extension.attributes) {
      if (attribute === undefined) throw "LOCALE_FIELD_INVARIANT";
      if (!parts.includes(attribute)) parts.push(attribute);
    }
    parts.sort(compareStrings);
  } else if (extension.language !== undefined)
    parts.push(
      printLocaleLanguage(canonicalLanguage(extension.language), true),
    );
  for (const field of extension.fields) {
    if (field === undefined) throw "LOCALE_FIELD_INVARIANT";
    if (extension.key === "u" && seen.includes(field.key)) continue;
    seen.push(field.key);
    const value = canonicalType(extension.key, field.key, field.value);
    fields.push({
      key: field.key,
      value: extension.key === "u" && value === "true" ? "" : value,
    });
  }
  fields.sort(compareFields);
  for (const field of fields) {
    if (field === undefined) throw "LOCALE_FIELD_INVARIANT";
    parts.push(field.key);
    if (field.value !== "") parts.push(field.value);
  }
  return parts.join("-");
}

/** UTS35 Annex C aliases plus canonical Unicode extension ordering. */
export function canonicalizeLocaleId(source: string): string | undefined {
  const parsed = parseLocaleId(source);
  if (parsed === undefined) return undefined;
  let result = printLocaleLanguage(canonicalLanguage(parsed.language), false);
  const extensions = parsed.extensions.slice();
  extensions.sort((a, b) =>
    a.key === b.key
      ? 0
      : a.key === "x"
        ? 1
        : b.key === "x"
          ? -1
          : a.key < b.key
            ? -1
            : 1,
  );
  for (const extension of extensions) {
    if (extension === undefined) throw "LOCALE_FIELD_INVARIANT";
    result += "-" + extension.key + "-" + printExtension(extension);
  }
  return result;
}
