import { currencySymbol } from "./currency-symbols.ts";
import { currencyFractionDigits } from "./number-affixes.ts";
import type { CurrencyNumberOptions } from "./currency-number.ts";
import {
  formatDecimalNumberRange,
  decimalNumberRangeParts,
} from "./number-ranges.ts";
import { chainIntlLegacy, unwrapIntlLegacy } from "./intl-legacy.ts";
import {
  createObject,
  createConstructorObject,
  createDataProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinProperty,
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue, scriptBoolean } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { stringValue, numberValue } from "./coercion.ts";
import { optionValue } from "./options.ts";
import { canonicalLocaleList, runtimeDefaultLocale } from "./locale-objects.ts";
import {
  canonicalizeLocaleId,
  uppercaseAscii,
} from "./locale-canonicalization.ts";
import { parseLocaleId } from "./locale-id.ts";
import {
  createArrayFromList,
  createStringArrayFromList,
} from "./array-like.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { intlMathematicalValue } from "./intl-mathematical-value.ts";
import {
  resolveNumberFormatDigitOptions,
  type NumberOptionAccess,
  type NumberNotation,
} from "./intl-number-options.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleData,
} from "./number-format-profile.ts";
import {
  createDecimalNumberFormatter,
  decimalNumberParts,
  formatDecimalNumber,
  type DecimalNumberFormatter,
  type DecimalNumberStyle,
  type NumberGrouping,
  type NumberSignDisplay,
} from "./decimal-number-format.ts";
import type { NumberUnitWidth } from "./number-affixes.ts";

function string(
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
function number(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const converted = numberValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  return converted.value;
}
function option(
  options: unknown,
  key: string,
  fallback: string | undefined,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, key, realm, hooks);
  return value === undefined ? fallback : string(value, realm, hooks);
}
function requiredOption(
  options: unknown,
  key: string,
  fallback: string,
  allowed: readonly string[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const value = option(options, key, fallback, realm, hooks);
  if (value === undefined) throw "NUMBER_OPTION_REQUIRED_INVARIANT";
  if (!allowed.includes(value)) throw createRuntimeError(realm, "range");
  return value;
}
function matcher(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  requiredOption(
    options,
    "localeMatcher",
    "best fit",
    ["lookup", "best fit"],
    realm,
    hooks,
  );
  // The initial implementation-defined best-fit policy shares lookup matching.
}
function unicodeNumberingSystem(locale: string): string | undefined {
  const parsed = parseLocaleId(locale);
  if (parsed === undefined) throw "NUMBER_RESOLUTION_LOCALE_INVARIANT";
  for (const extension of parsed.extensions) {
    if (extension === undefined) throw "NUMBER_RESOLUTION_EXTENSION_INVARIANT";
    if (extension.key === "u")
      for (const field of extension.fields) {
        if (field === undefined) throw "NUMBER_RESOLUTION_KEYWORD_INVARIANT";
        if (field.key === "nu") return field.value;
      }
  }
  return undefined;
}
/** Validate a Unicode type independently from whether its numeric algorithm is
 * supported. Canonicalize aliases/case only after structural validation. */
export function resolveNumberingSystemOption(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = option(options, "numberingSystem", undefined, realm, hooks);
  if (value === undefined) return undefined;
  const parsed = parseLocaleId("und-u-nu-" + value);
  if (parsed === undefined || parsed.extensions.length !== 1)
    throw createRuntimeError(realm, "range");
  const extension = parsed.extensions[0];
  if (
    extension === undefined ||
    extension.key !== "u" ||
    extension.attributes.length !== 0 ||
    extension.fields.length !== 1
  )
    throw createRuntimeError(realm, "range");
  const field = extension.fields[0];
  if (field === undefined || field.key !== "nu" || field.value === "")
    throw createRuntimeError(realm, "range");
  const canonical = canonicalizeLocaleId("und-u-nu-" + value);
  if (canonical === undefined) throw "NUMBER_SYSTEM_CANONICAL_INVARIANT";
  const system = unicodeNumberingSystem(canonical);
  return system === "" ? "true" : system;
}
export interface ResolvedNumberLocale {
  readonly locale: string;
  readonly numberingSystem: string;
}
/** Resolve only against shipped complete standard-decimal locale profiles.
 * Unsupported numbering options leave a supported requested extension intact. */
export function resolveNumberLocale(
  requested: readonly string[],
  optionSystem: string | undefined,
): ResolvedNumberLocale {
  let base: string = runtimeDefaultLocale;
  let requestedSystem: string | undefined = undefined;
  for (const tag of requested) {
    if (tag === undefined) throw "NUMBER_REQUESTED_LOCALE_INVARIANT";
    const matched = lookupNumberFormatLocale(tag);
    if (matched !== undefined) {
      base = matched;
      requestedSystem = unicodeNumberingSystem(tag);
      break;
    }
  }
  const extensionSystem = requestedSystem,
    optionNumberingSystem = optionSystem;
  const data = numberFormatLocaleData(base);
  if (data === undefined) throw "NUMBER_DEFAULT_LOCALE_INVARIANT";
  let system = data.defaultNumberingSystem;
  let extension = "";
  if (
    extensionSystem !== undefined &&
    data.numberingSystems.includes(extensionSystem)
  ) {
    system = extensionSystem;
    extension = "-u-nu-" + extensionSystem;
  }
  if (
    optionNumberingSystem !== undefined &&
    optionNumberingSystem !== system &&
    data.numberingSystems.includes(optionNumberingSystem)
  ) {
    system = optionNumberingSystem;
    extension = "";
  }
  return { locale: base + extension, numberingSystem: system };
}
function currencyCode(value: string): boolean {
  if (value.length !== 3) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122)))
      return false;
  }
  return true;
}
function singleUnit(value: string): boolean {
  // ECMA-402 Table 2, not the larger CLDR unit identifier universe.
  const units =
    "|acre|bit|byte|celsius|centimeter|day|degree|fahrenheit|fluid-ounce|foot|gallon|gigabit|gigabyte|gram|hectare|hour|inch|kilobit|kilobyte|kilogram|kilometer|liter|megabit|megabyte|meter|microsecond|mile|mile-scandinavian|milliliter|millimeter|millisecond|minute|month|nanosecond|ounce|percent|petabyte|pound|second|stone|terabit|terabyte|week|yard|year|";
  return units.includes("|" + value + "|");
}
function unitIdentifier(value: string): boolean {
  if (singleUnit(value)) return true;
  const split = value.indexOf("-per-");
  return (
    split !== -1 &&
    value.indexOf("-per-", split + 5) === -1 &&
    singleUnit(value.slice(0, split)) &&
    singleUnit(value.slice(split + 5))
  );
}
interface NumberUnitSelection {
  readonly currency: string | undefined;
  readonly currencyDisplay: string;
  readonly currencySign: string;
  readonly style: string;
  readonly unit: string | undefined;
  readonly unitDisplay: NumberUnitWidth;
}
function unitWidth(value: string): NumberUnitWidth {
  if (value === "long" || value === "short" || value === "narrow") return value;
  throw "NUMBER_UNIT_DISPLAY_INVARIANT";
}
function supportedStyle(
  value: string,
  unit: string | undefined,
  realm: ErrorRealm,
): DecimalNumberStyle {
  if (value === "decimal" || value === "percent" || value === "currency")
    return value;
  // unitOptions already validated the identifier (IsWellFormedUnitIdentifier):
  // every sanctioned simple unit and X-per-Y compound has CLDR unit data.
  if (value === "unit" && unit !== undefined) return "unit";
  throw "NUMBER_STYLE_INVARIANT";
}
function unitOptions(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): NumberUnitSelection {
  const style = requiredOption(
    options,
    "style",
    "decimal",
    ["decimal", "percent", "currency", "unit"],
    realm,
    hooks,
  );
  const currency = option(options, "currency", undefined, realm, hooks);
  if (currency === undefined) {
    if (style === "currency") throw createRuntimeError(realm, "type");
  } else if (!currencyCode(currency)) throw createRuntimeError(realm, "range");
  const currencyDisplay = requiredOption(
    options,
    "currencyDisplay",
    "symbol",
    ["code", "symbol", "narrowSymbol", "name"],
    realm,
    hooks,
  );
  const currencySign = requiredOption(
    options,
    "currencySign",
    "standard",
    ["standard", "accounting"],
    realm,
    hooks,
  );
  const unit = option(options, "unit", undefined, realm, hooks);
  if (unit === undefined) {
    if (style === "unit") throw createRuntimeError(realm, "type");
  } else if (!unitIdentifier(unit)) throw createRuntimeError(realm, "range");
  const unitDisplay = requiredOption(
    options,
    "unitDisplay",
    "short",
    ["short", "narrow", "long"],
    realm,
    hooks,
  );
  return {
    style,
    currency: currency === undefined ? undefined : uppercaseAscii(currency),
    currencyDisplay,
    currencySign,
    unit,
    unitDisplay: unitWidth(unitDisplay),
  };
}
function notation(value: string, realm: ErrorRealm): NumberNotation {
  if (
    value === "standard" ||
    value === "scientific" ||
    value === "engineering" ||
    value === "compact"
  )
    return value;
  throw createRuntimeError(realm, "range");
}
function grouping(
  options: unknown,
  defaultValue: "auto" | "min2",
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): NumberGrouping {
  const input = optionValue(options, "useGrouping", realm, hooks);
  if (input === undefined) return defaultValue;
  if (input === true) return "always";
  if (!scriptBoolean(input, realm.objectPrototype)) return false;
  const value = string(input, realm, hooks);
  if (value === "true" || value === "false") return defaultValue;
  if (value === "auto" || value === "always" || value === "min2") return value;
  throw createRuntimeError(realm, "range");
}
function sign(value: string, realm: ErrorRealm): NumberSignDisplay {
  if (
    value === "auto" ||
    value === "always" ||
    value === "never" ||
    value === "exceptZero" ||
    value === "negative"
  )
    return value;
  throw createRuntimeError(realm, "range");
}
/** Shared by the constructor and Number/BigInt locale-string adapters. */
export function configureDecimalNumberFormatter(
  locales: unknown,
  input: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): DecimalNumberFormatter {
  const requested = canonicalLocaleList(locales, realm, hooks);
  const options =
    input === undefined
      ? createObject<ScriptPropertyKey, unknown>(undefined)
      : toObjectValue(input, realm, hooks);
  matcher(options, realm, hooks);
  const system = resolveNumberingSystemOption(options, realm, hooks);
  const locale = resolveNumberLocale(requested, system);
  const units = unitOptions(options, realm, hooks);
  const style = supportedStyle(units.style, units.unit, realm);
  const notationValue = option(options, "notation", "standard", realm, hooks);
  if (notationValue === undefined) throw "NUMBER_NOTATION_DEFAULT_INVARIANT";
  const notationType = notation(notationValue, realm);
  const access: NumberOptionAccess = {
    read: (key): unknown => optionValue(options, key, realm, hooks),
    number: (value): number => number(value, realm, hooks),
    string: (value): string => string(value, realm, hooks),
    reject: (kind): never => {
      throw createRuntimeError(realm, kind);
    },
  };
  const code = units.currency;
  let currency: CurrencyNumberOptions | undefined = undefined;
  let minimumFractionDefault = 0,
    maximumFractionDefault = style === "percent" ? 0 : 3;
  if (style === "currency") {
    if (code === undefined) throw "NUMBER_CURRENCY_CODE_INVARIANT";
    const display = units.currencyDisplay,
      currencySign = units.currencySign;
    if (
      display !== "code" &&
      display !== "symbol" &&
      display !== "narrowSymbol"
    )
      return rejectUnsupportedExecution(realm);
    if (currencySign !== "standard" && currencySign !== "accounting")
      throw "NUMBER_CURRENCY_SIGN_INVARIANT";
    currency = {
      code,
      display,
      sign: currencySign,
      label:
        display === "code"
          ? code
          : currencySymbol(locale.locale, code, display === "narrowSymbol"),
    };
    minimumFractionDefault = currencyFractionDigits(code);
    maximumFractionDefault = minimumFractionDefault;
  }
  const digitOptions = resolveNumberFormatDigitOptions(
    access,
    minimumFractionDefault,
    maximumFractionDefault,
    notationType,
  );
  const compactDisplay = requiredOption(
    options,
    "compactDisplay",
    "short",
    ["short", "long"],
    realm,
    hooks,
  );
  const useGrouping = grouping(
    options,
    notationType === "compact" ? "min2" : "auto",
    realm,
    hooks,
  );
  const signValue = option(options, "signDisplay", "auto", realm, hooks);
  if (signValue === undefined) throw "NUMBER_SIGN_DEFAULT_INVARIANT";
  const signDisplay = sign(signValue, realm);
  const formatter = createDecimalNumberFormatter(
    locale.locale,
    locale.numberingSystem,
    digitOptions,
    useGrouping,
    signDisplay,
    style,
    units.unitDisplay,
    currency,
    units.unit ?? "percent",
    notationType,
    compactDisplay === "long" ? "long" : "short",
  );
  if (formatter === undefined) throw "NUMBER_FORMAT_PROFILE_INVARIANT";
  return formatter;
}
export function formatNumberForLocale(
  value: unknown,
  locales: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const formatter = configureDecimalNumberFormatter(
    locales,
    options,
    realm,
    hooks,
  );
  return formatDecimalNumber(
    formatter,
    intlMathematicalValue(value, realm, hooks),
  );
}
function numberFormatBrand(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): boolean {
  return object.internalNumberFormatData !== undefined;
}
function requireFormatter(
  value: unknown,
  realm: ErrorRealm,
): DecimalNumberFormatter {
  const object = viewObjectValue(value, realm.objectPrototype);
  const formatter =
    object === undefined ? undefined : object.internalNumberFormatData;
  if (formatter === undefined) throw createRuntimeError(realm, "type");
  return formatter;
}
function property(
  result: OrdinaryObject<ScriptPropertyKey, unknown>,
  key: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    value !== undefined &&
    !createDataProperty<ScriptPropertyKey, unknown>(result, key, value, hooks)
  )
    throw "NUMBER_FORMAT_RESULT_PROPERTY_INVARIANT";
}
export function installNumberFormatIntrinsic(
  intl: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.numberFormatPrototype;
  function construct(
    locales: unknown,
    options: unknown,
    target: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(
      target === undefined
        ? prototype
        : constructorPrototype(target, "intl-number-format", realm, hooks),
    );
    object.internalNumberFormatData = configureDecimalNumberFormatter(
      locales,
      options,
      realm,
      hooks,
    );
    return object;
  }
  const constructor: OrdinaryObject<ScriptPropertyKey, unknown> =
    createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown =>
        chainIntlLegacy(
          receiver,
          construct(args[0], args[1], undefined),
          constructor,
          realm,
          hooks,
        ),
      (args, target): unknown => construct(args[0], args[1], target),
    );
  builtinFunctionMetadata(constructor, "NumberFormat", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.NumberFormat",
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
          if (tag === undefined) throw "NUMBER_SUPPORTED_LOCALE_INVARIANT";
          if (lookupNumberFormatLocale(tag) !== undefined) supported.push(tag);
        }
        return createStringArrayFromList(supported, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinAccessor(
    prototype,
    "format",
    builtinFunction(
      realm.functionPrototype,
      "get format",
      0,
      (receiver, args): unknown => {
        const formatter = requireFormatter(
          unwrapIntlLegacy(
            receiver,
            constructor,
            numberFormatBrand,
            realm,
            hooks,
          ),
          realm,
        );
        if (formatter.boundFormat === undefined)
          formatter.boundFormat = builtinFunction(
            realm.functionPrototype,
            "",
            1,
            (ignored, values): unknown =>
              formatDecimalNumber(
                formatter,
                intlMathematicalValue(values[0], realm, hooks),
              ),
            hooks,
          );
        return formatter.boundFormat;
      },
      hooks,
    ),
    undefined,
    hooks,
  );
  builtinProperty(
    prototype,
    "formatToParts",
    builtinFunction(
      realm.functionPrototype,
      "formatToParts",
      1,
      (receiver, args): unknown => {
        const formatter = requireFormatter(receiver, realm);
        const quantity = intlMathematicalValue(args[0], realm, hooks),
          parts = decimalNumberParts(formatter, quantity),
          result: unknown[] = [];
        for (const part of parts) {
          if (part === undefined) throw "NUMBER_FORMAT_PART_INVARIANT";
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
          property(object, "type", part.type, hooks);
          property(object, "value", part.value, hooks);
          result.push(object);
        }
        return createArrayFromList(
          result,
          0,
          realm.arrayPrototype,
          realm,
          hooks,
        );
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
        const formatter = requireFormatter(
            unwrapIntlLegacy(
              receiver,
              constructor,
              numberFormatBrand,
              realm,
              hooks,
            ),
            realm,
          ),
          result = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          ),
          digits = formatter.digitOptions;
        property(result, "locale", formatter.locale, hooks);
        property(result, "numberingSystem", formatter.numberingSystem, hooks);
        property(result, "style", formatter.style, hooks);
        const currency = formatter.currency;
        if (currency !== undefined) {
          property(result, "currency", currency.code, hooks);
          property(result, "currencyDisplay", currency.display, hooks);
          property(result, "currencySign", currency.sign, hooks);
        }
        if (formatter.style === "unit") {
          property(result, "unit", formatter.unit, hooks);
          property(result, "unitDisplay", formatter.unitDisplay, hooks);
        }
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
        property(result, "useGrouping", formatter.useGrouping, hooks);
        property(result, "notation", formatter.notation, hooks);
        if (formatter.notation === "compact")
          property(result, "compactDisplay", formatter.compactDisplay, hooks);
        property(result, "signDisplay", formatter.signDisplay, hooks);
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
  for (const name of ["formatRange", "formatRangeToParts"]) {
    if (name === undefined) throw "NUMBER_RANGE_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
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
          if (name === "formatRange")
            return formatDecimalNumberRange(formatter, x, y);
          const values: unknown[] = [];
          for (const part of decimalNumberRangeParts(formatter, x, y)) {
            if (part === undefined) throw "NUMBER_RANGE_RESULT_INVARIANT";
            const object = createObject<ScriptPropertyKey, unknown>(
              realm.objectPrototype,
            );
            property(object, "type", part.type, hooks);
            property(object, "value", part.value, hooks);
            property(object, "source", part.source, hooks);
            values.push(object);
          }
          return createArrayFromList(
            values,
            0,
            realm.arrayPrototype,
            realm,
            hooks,
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(intl, "NumberFormat", constructor, true, true, hooks);
}
