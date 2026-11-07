import {
  lookupCollatorLocale,
  collatorSupportsCollation,
} from "./collation-locales.ts";
import { parseLocaleId, type LocaleId } from "./locale-id.ts";
import { canonicalLocaleList, runtimeDefaultLocale } from "./locale-objects.ts";
import { createObject, type ObjectHooks } from "./operations.ts";
import { viewObjectValue, scriptBoolean } from "./values.ts";
import { optionValue } from "./options.ts";
import { stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { compareCollation, type CollationOptions } from "./collation-engine.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
export interface CollatorData extends CollationOptions {
  readonly locale: string;
  readonly usage: "sort" | "search";
  readonly collation: string;
  boundCompare: unknown;
}
function keyword(locale: LocaleId, key: string): string | undefined {
  for (const extension of locale.extensions) {
    if (extension === undefined) throw "COLLATOR_LOCALE_EXTENSION";
    if (extension.key !== "u") continue;
    for (const field of extension.fields) {
      if (field === undefined) throw "COLLATOR_LOCALE_KEYWORD";
      if (field.key === key) return field.value;
    }
  }
  return undefined;
}
function text(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const converted = stringValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  return converted.value;
}
function stringOption(
  options: unknown,
  name: string,
  allowed: readonly string[] | undefined,
  fallback: string | undefined,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, name, realm, hooks);
  if (value === undefined) return fallback;
  const converted = text(value, realm, hooks);
  if (allowed !== undefined && !allowed.includes(converted))
    throw createRuntimeError(realm, "range");
  return converted;
}
export function collatorLocaleMatcher(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  stringOption(
    options,
    "localeMatcher",
    ["lookup", "best fit"],
    "best fit",
    realm,
    hooks,
  );
}
function unicodeType(value: string): boolean {
  let size = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i === value.length || value.charCodeAt(i) === 45) {
      if (size < 3 || size > 8) return false;
      size = 0;
      continue;
    }
    const code = value.charCodeAt(i);
    if (!(
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    ))
      return false;
    size++;
  }
  return true;
}
function asciiLower(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    result += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return result;
}
export function configureCollator(
  locales: unknown,
  input: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): CollatorData {
  const requested = canonicalLocaleList(locales, realm, hooks);
  const options =
    input === undefined
      ? createObject<ScriptPropertyKey, unknown>(undefined)
      : viewObjectValue(input, realm.objectPrototype);
  if (options === undefined) throw createRuntimeError(realm, "type");
  const usage = stringOption(
    options,
    "usage",
    ["sort", "search"],
    "sort",
    realm,
    hooks,
  );
  if (usage !== "sort" && usage !== "search") throw "COLLATOR_USAGE";
  collatorLocaleMatcher(options, realm, hooks);
  const requestedCollation = stringOption(
    options,
    "collation",
    undefined,
    undefined,
    realm,
    hooks,
  );
  if (requestedCollation !== undefined && !unicodeType(requestedCollation))
    throw createRuntimeError(realm, "range");
  const co =
    requestedCollation === undefined
      ? undefined
      : asciiLower(requestedCollation);
  const numericOption = optionValue(options, "numeric", realm, hooks),
    numeric =
      numericOption === undefined
        ? undefined
        : scriptBoolean(numericOption, realm.objectPrototype);
  const kf = stringOption(
    options,
    "caseFirst",
    ["upper", "lower", "false"],
    undefined,
    realm,
    hooks,
  );
  let locale: string = runtimeDefaultLocale,
    extensionLocale: LocaleId | undefined = undefined;
  for (const tag of requested) {
    if (tag === undefined) throw "COLLATOR_REQUESTED_LOCALE";
    const match = lookupCollatorLocale(tag);
    if (match !== undefined) {
      locale = match;
      extensionLocale = parseLocaleId(tag);
      break;
    }
  }
  const language = locale.split("-")[0];
  if (language === undefined) throw "COLLATOR_LANGUAGE";
  const extensionCo =
      extensionLocale === undefined
        ? undefined
        : keyword(extensionLocale, "co"),
    extensionKn =
      extensionLocale === undefined
        ? undefined
        : keyword(extensionLocale, "kn"),
    extensionKf =
      extensionLocale === undefined
        ? undefined
        : keyword(extensionLocale, "kf");
  const coSupported =
    usage === "sort" && collatorSupportsCollation(language, extensionCo);
  let collation: string = coSupported ? (extensionCo ?? "default") : "default",
    resolvedNumeric = false,
    caseFirst: "false" | "lower" | "upper" = "false",
    coTag = coSupported,
    knTag = false,
    kfTag = false;
  if (extensionKn === "" || extensionKn === "true" || extensionKn === "false") {
    resolvedNumeric = extensionKn !== "false";
    knTag = true;
  }
  if (
    extensionKf === "false" ||
    extensionKf === "lower" ||
    extensionKf === "upper"
  ) {
    caseFirst = extensionKf;
    kfTag = true;
  }
  if (
    usage === "sort" &&
    co !== undefined &&
    collatorSupportsCollation(language, co) &&
    co !== collation
  ) {
    collation = co;
    coTag = false;
  }
  if (numeric !== undefined && numeric !== resolvedNumeric) {
    resolvedNumeric = numeric;
    knTag = false;
  }
  if (kf !== undefined && kf !== caseFirst) {
    if (kf !== "false" && kf !== "lower" && kf !== "upper")
      throw "COLLATOR_CASE_FIRST";
    caseFirst = kf;
    kfTag = false;
  }
  let extension = "";
  if (coTag) extension += "-co-" + collation;
  if (kfTag) extension += "-kf-" + caseFirst;
  if (knTag) extension += "-kn" + (resolvedNumeric ? "" : "-false");
  if (extension) locale += "-u" + extension;
  const sensitivity = stringOption(
    options,
    "sensitivity",
    ["base", "accent", "case", "variant"],
    "variant",
    realm,
    hooks,
  );
  if (
    sensitivity !== "base" &&
    sensitivity !== "accent" &&
    sensitivity !== "case" &&
    sensitivity !== "variant"
  )
    throw "COLLATOR_SENSITIVITY";
  const punctuation = optionValue(options, "ignorePunctuation", realm, hooks),
    ignorePunctuation =
      punctuation === undefined
        ? language === "th"
        : scriptBoolean(punctuation, realm.objectPrototype);
  let profile = "root/standard";
  if (collation === "eor") profile = "root/eor";
  else if (collation === "phonebk") profile = "de/phonebk";
  else if (usage === "search")
    profile =
      language === "de"
        ? "de/search"
        : language === "es"
          ? "es/search"
          : "root/search";
  else if (language === "es" || language === "sv" || language === "th")
    profile = language + "/standard";
  return {
    locale,
    usage,
    collation,
    sensitivity,
    caseFirst,
    numeric: resolvedNumeric,
    ignorePunctuation,
    profile,
    boundCompare: undefined,
  };
}
export function compareCollator(
  data: CollatorData,
  left: unknown,
  right: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const a = text(left, realm, hooks),
    b = text(right, realm, hooks);
  return compareCollation(a, b, data);
}
