import {
  toDateTimeFormatValue,
  dateTimeValueParts,
  dateTimeValueRangeParts,
} from "./intl-date-time-value.ts";
import {
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
  builtinAccessor,
} from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue, scriptBoolean } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { optionValue } from "./options.ts";
import { stringValue, numberValue } from "./coercion.ts";
import { canonicalLocaleList } from "./locale-objects.ts";
import { parseLocaleId } from "./locale-id.ts";
import { canonicalizeLocaleId } from "./locale-canonicalization.ts";
import {
  createArrayFromList,
  createStringArrayFromList,
} from "./array-like.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { lookupNumberFormatLocale } from "./number-format-profile.ts";
import { resolveNumberingSystemOption } from "./intl-number-format.ts";
import { resolveDateTimeLocale } from "./date-time-locale.ts";
import {
  dateTimePatternFields,
  type DateTimeFormatFields,
} from "./date-time-pattern.ts";
import {
  createDateTimeFormatter,
  type DateTimeFormatter,
} from "./date-time-format.ts";
import type { DateTimePart } from "./date-time-parts.ts";
import type { DateTimeRangePart } from "./date-time-range.ts";
import {
  temporalTimeZone,
  type TemporalTimeZone,
} from "./temporal-time-zone.ts";
import { chainIntlLegacy, unwrapIntlLegacy } from "./intl-legacy.ts";
type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;
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
function optionsObject(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Obj {
  return value === undefined
    ? createObject<ScriptPropertyKey, unknown>(undefined)
    : toObjectValue(value, realm, hooks);
}
function option(
  options: Obj,
  name: string,
  choices: readonly string[],
  fallback: string | undefined,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, name, realm, hooks),
    text = value === undefined ? fallback : string(value, realm, hooks);
  if (text !== undefined && !choices.includes(text))
    throw createRuntimeError(realm, "range");
  return text;
}
function matcher(
  options: Obj,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  option(
    options,
    "localeMatcher",
    ["lookup", "best fit"],
    "best fit",
    realm,
    hooks,
  );
}
function calendarOption(
  options: Obj,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, "calendar", realm, hooks);
  if (value === undefined) return undefined;
  const text = string(value, realm, hooks),
    parsed = parseLocaleId("und-u-ca-" + text);
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
  if (field === undefined || field.key !== "ca" || field.value === "")
    throw createRuntimeError(realm, "range");
  const canonical = canonicalizeLocaleId("und-u-ca-" + text),
    canonicalParsed =
      canonical === undefined ? undefined : parseLocaleId(canonical);
  if (canonicalParsed === undefined)
    throw "DATE_TIME_CALENDAR_OPTION_INVARIANT";
  const canonicalExtension = canonicalParsed.extensions[0],
    canonicalField =
      canonicalExtension === undefined
        ? undefined
        : canonicalExtension.fields[0];
  if (canonicalField === undefined) throw "DATE_TIME_CALENDAR_OPTION_INVARIANT";
  return canonicalField.value;
}
function components(
  options: Obj,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): DateTimeFormatFields {
  const fields = dateTimePatternFields([]);
  if (fields === undefined) throw "DATE_TIME_EMPTY_FIELDS_INVARIANT";
  const textWidths: readonly string[] = ["narrow", "short", "long"],
    numbers: readonly string[] = ["numeric", "2-digit"];
  fields.weekday = option(
    options,
    "weekday",
    textWidths,
    undefined,
    realm,
    hooks,
  );
  fields.era = option(options, "era", textWidths, undefined, realm, hooks);
  fields.year = option(options, "year", numbers, undefined, realm, hooks);
  fields.month = option(
    options,
    "month",
    ["numeric", "2-digit", "narrow", "short", "long"],
    undefined,
    realm,
    hooks,
  );
  fields.day = option(options, "day", numbers, undefined, realm, hooks);
  fields.dayPeriod = option(
    options,
    "dayPeriod",
    textWidths,
    undefined,
    realm,
    hooks,
  );
  fields.hour = option(options, "hour", numbers, undefined, realm, hooks);
  fields.minute = option(options, "minute", numbers, undefined, realm, hooks);
  fields.second = option(options, "second", numbers, undefined, realm, hooks);
  const fraction = optionValue(options, "fractionalSecondDigits", realm, hooks);
  if (fraction !== undefined) {
    const converted = number(fraction, realm, hooks);
    if (!Number.isFinite(converted) || converted < 1 || converted > 3)
      throw createRuntimeError(realm, "range");
    fields.fractionalSecondDigits = Math.floor(converted);
  }
  fields.timeZoneName = option(
    options,
    "timeZoneName",
    [
      "short",
      "long",
      "shortOffset",
      "longOffset",
      "shortGeneric",
      "longGeneric",
    ],
    undefined,
    realm,
    hooks,
  );
  return fields;
}
function noComponents(fields: DateTimeFormatFields): boolean {
  return (
    fields.weekday === undefined &&
    fields.era === undefined &&
    fields.year === undefined &&
    fields.month === undefined &&
    fields.day === undefined &&
    fields.dayPeriod === undefined &&
    fields.hour === undefined &&
    fields.minute === undefined &&
    fields.second === undefined &&
    fields.fractionalSecondDigits === undefined &&
    fields.timeZoneName === undefined
  );
}
export function configureDateTimeFormatter(
  locales: unknown,
  input: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  required: string = "any",
  defaults: string = "date",
  toLocaleStringZone: TemporalTimeZone | undefined = undefined,
): DateTimeFormatter {
  const requested = canonicalLocaleList(locales, realm, hooks),
    options = optionsObject(input, realm, hooks);
  matcher(options, realm, hooks);
  const calendar = calendarOption(options, realm, hooks),
    system = resolveNumberingSystemOption(options, realm, hooks),
    hour12Value = optionValue(options, "hour12", realm, hooks),
    hour12 =
      hour12Value === undefined
        ? undefined
        : scriptBoolean(hour12Value, realm.objectPrototype),
    cycle = option(
      options,
      "hourCycle",
      ["h11", "h12", "h23", "h24"],
      undefined,
      realm,
      hooks,
    ),
    locale = resolveDateTimeLocale(requested, calendar, system, cycle, hour12),
    zoneValue = optionValue(options, "timeZone", realm, hooks);
  const suppliedZone = toLocaleStringZone;
  let timeZone: TemporalTimeZone;
  if (suppliedZone !== undefined) {
    if (zoneValue !== undefined) throw createRuntimeError(realm, "type");
    timeZone = suppliedZone;
  } else {
    let zoneText: string;
    if (zoneValue === undefined) {
      const systemZone = realm.systemTimeZoneIdentifier;
      if (systemZone === undefined) return rejectUnsupportedExecution(realm);
      zoneText = systemZone();
    } else zoneText = string(zoneValue, realm, hooks);
    timeZone = temporalTimeZone(zoneText, realm);
  }
  const fields = components(options, realm, hooks),
    formatMatcher = option(
      options,
      "formatMatcher",
      ["basic", "best fit"],
      "best fit",
      realm,
      hooks,
    ),
    dateStyle = option(
      options,
      "dateStyle",
      ["full", "long", "medium", "short"],
      undefined,
      realm,
      hooks,
    ),
    timeStyle = option(
      options,
      "timeStyle",
      ["full", "long", "medium", "short"],
      undefined,
      realm,
      hooks,
    );
  if (dateStyle !== undefined || timeStyle !== undefined) {
    if (!noComponents(fields)) throw createRuntimeError(realm, "type");
  }
  if (
    (required === "time" && dateStyle !== undefined) ||
    (required !== "time" && required !== "any" && timeStyle !== undefined)
  )
    throw createRuntimeError(realm, "type");
  if (formatMatcher === undefined) throw "DATE_TIME_MATCHER_INVARIANT";
  const formatter = createDateTimeFormatter(
    {
      locale,
      timeZone,
      fields,
      dateStyle,
      timeStyle,
      formatMatcher,
    },
    required,
    defaults,
  );
  if (formatter === undefined) return rejectUnsupportedExecution(realm);
  return formatter;
}
function property(
  object: Obj,
  name: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    value !== undefined &&
    !createDataProperty<ScriptPropertyKey, unknown>(object, name, value, hooks)
  )
    throw "DATE_TIME_PROPERTY_INVARIANT";
}
function branded(object: Obj): boolean {
  return object.internalDateTimeFormatData !== undefined;
}
function requireFormatter(
  receiver: unknown,
  realm: ErrorRealm,
): DateTimeFormatter {
  const object = viewObjectValue(receiver, realm.objectPrototype),
    data = object === undefined ? undefined : object.internalDateTimeFormatData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function dateTimePartsText(parts: readonly DateTimePart[]): string {
  let result = "";
  for (let index = 0; index < parts.length; index++) {
    const part: DateTimePart | undefined = parts[index];
    if (part === undefined) throw "DATE_TIME_PART_INVARIANT";
    result += part.value;
  }
  return result;
}
function partArray(
  parts: readonly DateTimePart[],
  sources: readonly DateTimeRangePart[] | undefined,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Obj {
  const result: unknown[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part: DateTimePart | undefined = parts[index];
    if (part === undefined) throw "DATE_TIME_PART_INVARIANT";
    const object = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    property(object, "type", part.type, hooks);
    property(object, "value", part.value, hooks);
    if (sources !== undefined) {
      const source: DateTimeRangePart | undefined = sources[index];
      if (source === undefined) throw "DATE_TIME_SOURCE_INVARIANT";
      property(object, "source", source.source, hooks);
    }
    result.push(object);
  }
  return createArrayFromList(result, 0, realm.arrayPrototype, realm, hooks);
}
function resolvedOptions(
  formatter: DateTimeFormatter,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Obj {
  const result = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    ),
    config = formatter.configuration,
    locale = config.locale,
    fields = formatter.pattern.fields;
  property(result, "locale", locale.locale, hooks);
  property(result, "calendar", locale.calendar, hooks);
  property(result, "numberingSystem", locale.numberingSystem, hooks);
  property(result, "timeZone", config.timeZone.identifier, hooks);
  if (fields.hour !== undefined) {
    property(result, "hourCycle", locale.hourCycle, hooks);
    property(
      result,
      "hour12",
      locale.hourCycle === "h11" || locale.hourCycle === "h12",
      hooks,
    );
  }
  if (config.dateStyle !== undefined || config.timeStyle !== undefined) {
    property(result, "dateStyle", config.dateStyle, hooks);
    property(result, "timeStyle", config.timeStyle, hooks);
  } else {
    property(result, "weekday", fields.weekday, hooks);
    property(result, "era", fields.era, hooks);
    property(result, "year", fields.year, hooks);
    property(result, "month", fields.month, hooks);
    property(result, "day", fields.day, hooks);
    property(result, "dayPeriod", fields.dayPeriod, hooks);
    property(result, "hour", fields.hour, hooks);
    property(result, "minute", fields.minute, hooks);
    property(result, "second", fields.second, hooks);
    property(
      result,
      "fractionalSecondDigits",
      fields.fractionalSecondDigits,
      hooks,
    );
    property(result, "timeZoneName", fields.timeZoneName, hooks);
  }
  return result;
}
export function installDateTimeFormatIntrinsic(
  intl: Obj,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.dateTimeFormatPrototype;
  function construct(locales: unknown, options: unknown, target: unknown): Obj {
    const object = createObject<ScriptPropertyKey, unknown>(
      target === undefined
        ? prototype
        : constructorPrototype(target, "intl-date-time-format", realm, hooks),
    );
    object.internalDateTimeFormatData = configureDateTimeFormatter(
      locales,
      options,
      realm,
      hooks,
    );
    return object;
  }
  const constructor: Obj = createConstructorObject<ScriptPropertyKey, unknown>(
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
  builtinFunctionMetadata(constructor, "DateTimeFormat", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.DateTimeFormat",
    false,
    true,
    hooks,
  );
  builtinProperty(intl, "DateTimeFormat", constructor, true, true, hooks);
  builtinProperty(
    constructor,
    "supportedLocalesOf",
    builtinFunction(
      realm.functionPrototype,
      "supportedLocalesOf",
      1,
      (receiver, args): unknown => {
        const requested = canonicalLocaleList(args[0], realm, hooks),
          options = optionsObject(args[1], realm, hooks);
        matcher(options, realm, hooks);
        const supported: string[] = [];
        for (const tag of requested) {
          if (tag === undefined) throw "DATE_TIME_SUPPORTED_LOCALE_INVARIANT";
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
          unwrapIntlLegacy(receiver, constructor, branded, realm, hooks),
          realm,
        );
        if (formatter.boundFormat === undefined)
          formatter.boundFormat = builtinFunction(
            realm.functionPrototype,
            "",
            1,
            (ignored, values): unknown => {
              const parts = dateTimeValueParts(
                formatter,
                toDateTimeFormatValue(values[0], realm, hooks, true),
                realm,
              );
              if (parts === undefined) throw createRuntimeError(realm, "range");
              return dateTimePartsText(parts);
            },
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
        const formatter = requireFormatter(receiver, realm),
          parts = dateTimeValueParts(
            formatter,
            toDateTimeFormatValue(args[0], realm, hooks, true),
            realm,
          );
        if (parts === undefined) throw createRuntimeError(realm, "range");
        return partArray(parts, undefined, realm, hooks);
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
      (receiver, args): unknown =>
        resolvedOptions(
          requireFormatter(
            unwrapIntlLegacy(receiver, constructor, branded, realm, hooks),
            realm,
          ),
          realm,
          hooks,
        ),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["formatRange", "formatRangeToParts"]) {
    if (name === undefined) throw "DATE_TIME_RANGE_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        2,
        (receiver, args): unknown => {
          const formatter = requireFormatter(receiver, realm),
            first = args[0],
            last = args[1];
          if (first === undefined || last === undefined)
            throw createRuntimeError(realm, "type");
          const start = toDateTimeFormatValue(first, realm, hooks, false),
            end = toDateTimeFormatValue(last, realm, hooks, false),
            parts = dateTimeValueRangeParts(formatter, start, end, realm);
          if (parts === undefined) throw createRuntimeError(realm, "range");
          return name === "formatRange"
            ? dateTimePartsText(parts)
            : partArray(parts, parts, realm, hooks);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
