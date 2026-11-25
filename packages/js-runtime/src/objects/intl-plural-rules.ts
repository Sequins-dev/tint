import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createConstructorObject,
  createDataProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { optionValue } from "./options.ts";
import { stringValue, numberValue } from "./coercion.ts";
import { canonicalLocaleList, runtimeDefaultLocale } from "./locale-objects.ts";
import { createStringArrayFromList } from "./array-like.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { lookupPluralLocale } from "./plural-compact.ts";
import {
  createPluralRuleSet,
  selectPluralRange,
  type PluralRuleType,
} from "./plural-rules.ts";
import {
  resolveNumberFormatDigitOptions,
  type NumberOptionAccess,
  type NumberNotation,
} from "./intl-number-options.ts";
import { intlMathematicalValue } from "./intl-mathematical-value.ts";
import { resolvePlural, type PluralFormatter } from "./plural-format.ts";

function string(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const result = stringValue(value, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}
function numeric(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const result = numberValue(value, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}
function option(
  options: unknown,
  name: string,
  fallback: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const value = optionValue(options, name, realm, hooks);
  return value === undefined ? fallback : string(value, realm, hooks);
}
function matcher(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const value = option(options, "localeMatcher", "best fit", realm, hooks);
  if (value !== "best fit" && value !== "lookup")
    throw createRuntimeError(realm, "range");
}
function ruleType(value: string, realm: ErrorRealm): PluralRuleType {
  if (value === "cardinal" || value === "ordinal") return value;
  throw createRuntimeError(realm, "range");
}
function notationType(value: string, realm: ErrorRealm): NumberNotation {
  if (
    value === "standard" ||
    value === "scientific" ||
    value === "engineering" ||
    value === "compact"
  )
    return value;
  throw createRuntimeError(realm, "range");
}
function displayType(value: string, realm: ErrorRealm): "short" | "long" {
  if (value === "short" || value === "long") return value;
  throw createRuntimeError(realm, "range");
}
function resolveLocale(requested: readonly string[]): string {
  for (const tag of requested) {
    if (tag === undefined) throw "PLURAL_LOCALE_INVARIANT";
    const match = lookupPluralLocale(tag);
    if (match !== undefined) return match;
  }
  return runtimeDefaultLocale;
}
function requireFormatter(value: unknown, realm: ErrorRealm): PluralFormatter {
  const object = viewObjectValue(value, realm.objectPrototype);
  const data =
    object === undefined
      ? undefined
      : exoticSlots(object).internalPluralRulesData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
function property(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    value !== undefined &&
    !createDataProperty<ScriptPropertyKey, unknown>(object, name, value, hooks)
  )
    throw "PLURAL_RESULT_PROPERTY_INVARIANT";
}
export function installPluralRulesIntrinsic(
  intl: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.pluralRulesPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "intl-plural-rules", realm, hooks),
      );
      const requested = canonicalLocaleList(args[0], realm, hooks),
        input = args[1];
      const options =
        input === undefined
          ? createObject<ScriptPropertyKey, unknown>(undefined)
          : toObjectValue(input, realm, hooks);
      matcher(options, realm, hooks);
      const locale = resolveLocale(requested);
      const type = ruleType(
        option(options, "type", "cardinal", realm, hooks),
        realm,
      );
      const notation = notationType(
        option(options, "notation", "standard", realm, hooks),
        realm,
      );
      const compactDisplay = displayType(
        option(options, "compactDisplay", "short", realm, hooks),
        realm,
      );
      const access: NumberOptionAccess = {
        read: (key): unknown => optionValue(options, key, realm, hooks),
        number: (value): number => numeric(value, realm, hooks),
        string: (value): string => string(value, realm, hooks),
        reject: (kind): never => {
          throw createRuntimeError(realm, kind);
        },
      };
      const digits = resolveNumberFormatDigitOptions(access, 0, 3, notation);
      const rules = createPluralRuleSet(locale, type);
      if (rules === undefined) throw "PLURAL_RULES_REGISTRY_INVARIANT";
      ensureExoticSlots(object).internalPluralRulesData = {
        locale,
        type,
        notation,
        compactDisplay: notation === "compact" ? compactDisplay : undefined,
        digits,
        rules,
      };
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "PluralRules", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.PluralRules",
    false,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "supportedLocalesOf",
    builtinFunction(
      realm.functionPrototype,
      "supportedLocalesOf",
      1,
      (receiver, args): unknown => {
        const requested = canonicalLocaleList(args[0], realm, hooks);
        const options =
          args[1] === undefined
            ? createObject<ScriptPropertyKey, unknown>(undefined)
            : toObjectValue(args[1], realm, hooks);
        matcher(options, realm, hooks);
        const supported: string[] = [];
        for (const tag of requested) {
          if (tag === undefined) throw "PLURAL_LOCALE_INVARIANT";
          if (lookupPluralLocale(tag) !== undefined) supported.push(tag);
        }
        return createStringArrayFromList(supported, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "select",
    builtinFunction(
      realm.functionPrototype,
      "select",
      1,
      (receiver, args): unknown => {
        const formatter = requireFormatter(receiver, realm);
        return resolvePlural(
          formatter,
          intlMathematicalValue(args[0], realm, hooks),
        ).category;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "selectRange",
    builtinFunction(
      realm.functionPrototype,
      "selectRange",
      2,
      (receiver, args): unknown => {
        const formatter = requireFormatter(receiver, realm),
          start = args[0],
          end = args[1];
        if (start === undefined || end === undefined)
          throw createRuntimeError(realm, "type");
        const x = intlMathematicalValue(start, realm, hooks),
          y = intlMathematicalValue(end, realm, hooks);
        if (x.kind === "nan" || y.kind === "nan")
          throw createRuntimeError(realm, "range");
        const xp = resolvePlural(formatter, x),
          yp = resolvePlural(formatter, y);
        return xp.formatted === yp.formatted
          ? xp.category
          : selectPluralRange(formatter.rules, xp.category, yp.category);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "resolvedOptions",
    builtinFunction(
      realm.functionPrototype,
      "resolvedOptions",
      0,
      (receiver, args): unknown => {
        const data = requireFormatter(receiver, realm),
          digits = data.digits,
          result = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
        property(result, "locale", data.locale, hooks);
        property(result, "type", data.type, hooks);
        property(result, "notation", data.notation, hooks);
        property(result, "compactDisplay", data.compactDisplay, hooks);
        property(
          result,
          "minimumIntegerDigits",
          digits.minimumIntegerDigits,
          hooks,
        );
        property(
          result,
          "minimumFractionDigits",
          digits.minimumFractionDigits,
          hooks,
        );
        property(
          result,
          "maximumFractionDigits",
          digits.maximumFractionDigits,
          hooks,
        );
        property(
          result,
          "minimumSignificantDigits",
          digits.minimumSignificantDigits,
          hooks,
        );
        property(
          result,
          "maximumSignificantDigits",
          digits.maximumSignificantDigits,
          hooks,
        );
        property(
          result,
          "pluralCategories",
          createStringArrayFromList(data.rules.categories, realm, hooks),
          hooks,
        );
        property(result, "roundingIncrement", digits.roundingIncrement, hooks);
        property(result, "roundingMode", digits.roundingMode, hooks);
        property(result, "roundingPriority", digits.roundingPriority, hooks);
        property(
          result,
          "trailingZeroDisplay",
          digits.trailingZeroDisplay,
          hooks,
        );
        return result;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(intl, "PluralRules", constructor, true, true, hooks);
}
