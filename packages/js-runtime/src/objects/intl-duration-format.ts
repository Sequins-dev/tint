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
import { canonicalLocaleList } from "./locale-objects.ts";
import {
  createArrayFromList,
  createStringArrayFromList,
} from "./array-like.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { lookupNumberFormatLocale } from "./number-format-profile.ts";
import {
  resolveNumberLocale,
  resolveNumberingSystemOption,
} from "./intl-number-format.ts";
import { createUnitFormatProfile, unitFormatDigital } from "./unit-format.ts";
import {
  createDurationFormatter,
  resolveDurationFormatOptions,
  durationFormatParts,
  durationUnitName,
  type DurationFormatter,
  type DurationFormatPart,
  type DurationUnitOptions,
} from "./duration-format.ts";
import { durationFrom } from "./temporal-duration-conversion.ts";

type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;
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
function number(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const result = numberValue(value, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}
function matcher(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const value = optionValue(options, "localeMatcher", realm, hooks),
    text = value === undefined ? "best fit" : string(value, realm, hooks);
  if (text !== "best fit" && text !== "lookup")
    throw createRuntimeError(realm, "range");
}
function optionsObject(
  input: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Obj {
  return input === undefined
    ? createObject<ScriptPropertyKey, unknown>(undefined)
    : toObjectValue(input, realm, hooks);
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
    throw "DURATION_FORMAT_PROPERTY_INVARIANT";
}
export function configureDurationFormatter(
  locales: unknown,
  input: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): DurationFormatter {
  const requested = canonicalLocaleList(locales, realm, hooks),
    options = optionsObject(input, realm, hooks);
  matcher(options, realm, hooks);
  const system = resolveNumberingSystemOption(options, realm, hooks),
    locale = resolveNumberLocale(requested, system),
    profile = createUnitFormatProfile(locale.locale);
  if (profile === undefined) throw "DURATION_FORMAT_LOCALE_INVARIANT";
  const digital = unitFormatDigital(profile, locale.numberingSystem);
  if (digital === undefined) throw "DURATION_FORMAT_DIGITAL_INVARIANT";
  const resolved = resolveDurationFormatOptions(
      {
        read: (key): unknown => optionValue(options, key, realm, hooks),
        string: (value): string => string(value, realm, hooks),
        number: (value): number => number(value, realm, hooks),
        reject: (kind): never => {
          throw createRuntimeError(realm, kind);
        },
      },
      digital.twoDigitHours,
    ),
    formatter = createDurationFormatter(
      locale.locale,
      locale.numberingSystem,
      resolved,
    );
  if (formatter === undefined) throw "DURATION_FORMAT_CONFIGURATION_INVARIANT";
  return formatter;
}
export function durationPartsText(
  parts: readonly DurationFormatPart[],
): string {
  let result = "";
  for (let index = 0; index < parts.length; index++) {
    const part: DurationFormatPart | undefined = parts[index];
    if (part === undefined) throw "DURATION_FORMAT_TEXT_PART_INVARIANT";
    result += part.value;
  }
  return result;
}
function requireFormatter(
  receiver: unknown,
  realm: ErrorRealm,
): DurationFormatter {
  const object = viewObjectValue(receiver, realm.objectPrototype),
    data = object === undefined ? undefined : object.internalDurationFormatData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function installDurationFormatIntrinsic(
  intl: Obj,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.durationFormatPrototype,
    constructor = createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => {
        throw createRuntimeError(realm, "type");
      },
      (args, target): unknown => {
        const object = createObject<ScriptPropertyKey, unknown>(
          constructorPrototype(target, "intl-duration-format", realm, hooks),
        );
        object.internalDurationFormatData = configureDurationFormatter(
          args[0],
          args[1],
          realm,
          hooks,
        );
        return object;
      },
    );
  builtinFunctionMetadata(constructor, "DurationFormat", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.DurationFormat",
    false,
    true,
    hooks,
  );
  builtinProperty(intl, "DurationFormat", constructor, true, true, hooks);
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
          if (tag === undefined)
            throw "DURATION_FORMAT_SUPPORTED_LOCALE_INVARIANT";
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
  for (const name of ["format", "formatToParts"]) {
    if (name === undefined) throw "DURATION_FORMAT_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const formatter = requireFormatter(receiver, realm),
            duration = durationFrom(args[0], realm, hooks),
            parts = durationFormatParts(formatter, duration);
          if (name === "format") return durationPartsText(parts);
          const result: unknown[] = [];
          for (let index = 0; index < parts.length; index++) {
            const part: DurationFormatPart | undefined = parts[index];
            if (part === undefined)
              throw "DURATION_FORMAT_PUBLIC_PART_INVARIANT";
            const object = createObject<ScriptPropertyKey, unknown>(
              realm.objectPrototype,
            );
            property(object, "type", part.type, hooks);
            property(object, "value", part.value, hooks);
            property(object, "unit", part.unit, hooks);
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
  }
  builtinProperty(
    prototype,
    "resolvedOptions",
    builtinFunction(
      realm.functionPrototype,
      "resolvedOptions",
      0,
      (receiver, args): unknown => {
        const formatter = requireFormatter(receiver, realm),
          result = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
        property(result, "locale", formatter.locale, hooks);
        property(result, "numberingSystem", formatter.numberingSystem, hooks);
        property(result, "style", formatter.options.style, hooks);
        for (let index = 0; index < 10; index++) {
          const unit: DurationUnitOptions | undefined =
              formatter.options.units[index],
            name = durationUnitName(index) + "s";
          if (unit === undefined) throw "DURATION_FORMAT_RESOLVED_INVARIANT";
          property(
            result,
            name,
            unit.style === "fractional" ? "numeric" : unit.style,
            hooks,
          );
          property(result, name + "Display", unit.display, hooks);
        }
        property(
          result,
          "fractionalDigits",
          formatter.options.fractionalDigits,
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
}
