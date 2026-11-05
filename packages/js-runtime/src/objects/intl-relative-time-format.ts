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
  configureDecimalNumberFormatter,
  resolveNumberLocale,
  resolveNumberingSystemOption,
} from "./intl-number-format.ts";
import {
  createRelativeTimeFormatter,
  relativeTimeParts,
  type RelativeTimeFormatter,
} from "./relative-time.ts";
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
function option(
  options: unknown,
  name: string,
  choices: readonly string[],
  fallback: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const value = optionValue(options, name, realm, hooks),
    text = value === undefined ? fallback : string(value, realm, hooks);
  if (!choices.includes(text)) throw createRuntimeError(realm, "range");
  return text;
}
function matcher(
  options: unknown,
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
    throw "RELATIVE_TIME_PROPERTY_INVARIANT";
}
function requireFormatter(
  receiver: unknown,
  realm: ErrorRealm,
): RelativeTimeFormatter {
  const object = viewObjectValue(receiver, realm.objectPrototype),
    data = object === undefined ? undefined : object.internalRelativeTimeData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function installRelativeTimeFormatIntrinsic(
  intl: Obj,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.relativeTimeFormatPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "intl-relative-time-format", realm, hooks),
      );
      const requested = canonicalLocaleList(args[0], realm, hooks),
        options = optionsObject(args[1], realm, hooks);
      matcher(options, realm, hooks);
      const system = resolveNumberingSystemOption(options, realm, hooks),
        locale = resolveNumberLocale(requested, system);
      const style = option(
        options,
        "style",
        ["long", "short", "narrow"],
        "long",
        realm,
        hooks,
      );
      const numeric = option(
        options,
        "numeric",
        ["always", "auto"],
        "always",
        realm,
        hooks,
      );
      if (
        (style !== "long" && style !== "short" && style !== "narrow") ||
        (numeric !== "always" && numeric !== "auto")
      )
        throw "RELATIVE_TIME_OPTIONS_INVARIANT";
      // Internal numeric defaults never consult the caller's unrelated options or
      // mutable public Intl constructors and methods.
      const nfOptions = createObject<ScriptPropertyKey, unknown>(undefined);
      property(nfOptions, "numberingSystem", locale.numberingSystem, hooks);
      const number = configureDecimalNumberFormatter(
          locale.locale,
          nfOptions,
          realm,
          hooks,
        ),
        formatter = createRelativeTimeFormatter(number, style, numeric);
      if (formatter === undefined) throw "RELATIVE_TIME_LOCALE_INVARIANT";
      object.internalRelativeTimeData = formatter;
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "RelativeTimeFormat", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.RelativeTimeFormat",
    false,
    true,
    hooks,
  );
  builtinProperty(intl, "RelativeTimeFormat", constructor, true, true, hooks);
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
          if (tag === undefined) throw "RELATIVE_SUPPORTED_LOCALE_INVARIANT";
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
    if (name === undefined) throw "RELATIVE_TIME_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        2,
        (receiver, args): unknown => {
          const formatter = requireFormatter(receiver, realm),
            converted = numberValue(args[0], hooks, realm);
          if (converted.error === "unsupported")
            return rejectUnsupportedExecution(realm);
          if (converted.error !== "none")
            throw createRuntimeError(realm, "type");
          const unit = string(args[1], realm, hooks),
            parts = relativeTimeParts(formatter, converted.value, unit);
          if (parts === undefined) throw createRuntimeError(realm, "range");
          if (name === "format") {
            let text = "";
            for (const part of parts) {
              if (part === undefined) throw "RELATIVE_PART_INVARIANT";
              text += part.value;
            }
            return text;
          }
          const result: unknown[] = [];
          for (const part of parts) {
            if (part === undefined) throw "RELATIVE_PART_INVARIANT";
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
        property(result, "locale", formatter.number.locale, hooks);
        property(result, "style", formatter.style, hooks);
        property(result, "numeric", formatter.numeric, hooks);
        property(
          result,
          "numberingSystem",
          formatter.number.numberingSystem,
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
