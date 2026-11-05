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
import { constructorPrototype, constructObjectValue } from "./functions.ts";
import { maximizeLocaleId, minimizeLocaleId } from "./locale-likely.ts";
import {
  localeNumberingSystems,
  localeCalendars,
  localeCollations,
  localeHourCycles,
  localeTextDirection,
  localeWeekInfo,
  localeTimeZones,
} from "./locale-info.ts";
import {
  createArrayFromList,
  createStringArrayFromList,
} from "./array-like.ts";
import { localeObjectTag, requireLocale } from "./locale-objects.ts";
import { toObjectValue } from "./boxing.ts";
import { optionValue } from "./options.ts";
import { stringValue } from "./coercion.ts";
import { scriptBoolean, viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  parseLocaleId,
  type LocaleId,
  type LocaleData,
  type LocaleField,
} from "./locale-id.ts";
import {
  canonicalizeLocaleId,
  printLocaleLanguage,
} from "./locale-canonicalization.ts";

function textValue(
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

function canonical(source: string, realm: ErrorRealm): string {
  const result = canonicalizeLocaleId(source);
  if (result === undefined) throw createRuntimeError(realm, "range");
  return result;
}

function parsed(source: string): LocaleId {
  const result = parseLocaleId(source);
  if (result === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
  return result;
}

function stringOption(
  options: unknown,
  name: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, name, realm, hooks);
  return value === undefined ? undefined : textValue(value, realm, hooks);
}

function validBaseOption(value: string, name: string): boolean {
  const result = parseLocaleId(name === "language" ? value : "und-" + value);
  if (result === undefined || result.extensions.length !== 0) return false;
  const language = result.language;
  if (name === "language")
    return (
      language.script === "" &&
      language.region === "" &&
      language.variants.length === 0
    );
  if (name === "script")
    return (
      language.script !== "" &&
      language.region === "" &&
      language.variants.length === 0
    );
  if (name === "region")
    return (
      language.script === "" &&
      language.region !== "" &&
      language.variants.length === 0
    );
  return (
    language.script === "" &&
    language.region === "" &&
    language.variants.length > 0
  );
}

function baseOption(
  options: unknown,
  name: string,
  fallback: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const value = stringOption(options, name, realm, hooks);
  if (value === undefined) return fallback;
  if (!validBaseOption(value, name)) throw createRuntimeError(realm, "range");
  return value;
}

function updateLanguage(
  tag: string,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const original = parsed(tag).language;
  const language = baseOption(
    options,
    "language",
    original.language,
    realm,
    hooks,
  );
  const script = baseOption(options, "script", original.script, realm, hooks);
  const region = baseOption(options, "region", original.region, realm, hooks);
  const variants = baseOption(
    options,
    "variants",
    original.variants.join("-"),
    realm,
    hooks,
  );
  const base = printLocaleLanguage(original, false);
  return (
    language +
    (script === "" ? "" : "-" + script) +
    (region === "" ? "" : "-" + region) +
    (variants === "" ? "" : "-" + variants) +
    tag.slice(base.length)
  );
}

function unicodeKeywords(locale: LocaleId): readonly LocaleField[] {
  for (const extension of locale.extensions) {
    if (extension === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
    if (extension.key === "u") return extension.fields;
  }
  return [];
}

function typeValue(value: string): boolean {
  const locale = parseLocaleId("und-u-ca-" + value);
  if (locale === undefined || locale.extensions.length !== 1) return false;
  const fields = unicodeKeywords(locale);
  return (
    fields.length === 1 && fields[0]?.key === "ca" && fields[0]?.value !== ""
  );
}

function keywordOption(
  options: unknown,
  name: string,
  key: string,
  allowed: readonly string[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): LocaleField | undefined {
  const source = stringOption(options, name, realm, hooks);
  if (source === undefined) return undefined;
  const value = key === "fw" ? weekdayValue(source) : source;
  if (allowed.length === 0 ? !typeValue(value) : !allowed.includes(value))
    throw createRuntimeError(realm, "range");
  return { key, value };
}

function weekdayValue(value: string): string {
  const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (let index = 0; index < weekdays.length; index++)
    if (value === String(index)) return weekdays[index] ?? "";
  return value;
}

function updateKeywords(
  tag: string,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const overrides: LocaleField[] = [];
  function add(name: string, key: string, allowed: readonly string[]): void {
    const field = keywordOption(options, name, key, allowed, realm, hooks);
    if (field !== undefined) overrides.push(field);
  }
  add("calendar", "ca", []);
  add("collation", "co", []);
  add("firstDayOfWeek", "fw", []);
  add("hourCycle", "hc", ["h11", "h12", "h23", "h24"]);
  add("caseFirst", "kf", ["upper", "lower", "false"]);
  const numeric = optionValue(options, "numeric", realm, hooks);
  if (numeric !== undefined)
    overrides.push({
      key: "kn",
      value: scriptBoolean(numeric, realm.objectPrototype) ? "true" : "false",
    });
  add("numberingSystem", "nu", []);

  const locale = parsed(tag),
    fields: LocaleField[] = [],
    attributes: string[] = [],
    others: string[] = [];
  for (const extension of locale.extensions) {
    if (extension === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
    if (extension.key === "u") {
      for (const attribute of extension.attributes) {
        if (attribute === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
        attributes.push(attribute);
      }
      for (const field of extension.fields) {
        if (field === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
        let overridden = false;
        for (const replacement of overrides) {
          if (replacement === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
          if (replacement.key === field.key) overridden = true;
        }
        if (!overridden) fields.push(field);
      }
    } else {
      // Keep the original extension spelling; canonicalization orders it later.
      const marker = "-" + extension.key + "-",
        start = tag.indexOf(marker);
      let end = start + marker.length;
      for (let index = end; index < tag.length; index++) {
        if (
          extension.key !== "x" &&
          tag.charCodeAt(index) === 45 &&
          tag.charCodeAt(index + 2) === 45
        ) {
          end = index;
          break;
        }
        end = index + 1;
      }
      others.push(tag.slice(start, end));
    }
  }
  for (const field of overrides) {
    if (field === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
    fields.push(field);
  }
  let result = printLocaleLanguage(locale.language, false);
  if (attributes.length > 0 || fields.length > 0) {
    result += "-u";
    for (const attribute of attributes) {
      if (attribute === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
      result += "-" + attribute;
    }
    for (const field of fields) {
      if (field === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
      result += "-" + field.key + (field.value === "" ? "" : "-" + field.value);
    }
  }
  for (const extension of others) {
    if (extension === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
    result += extension;
  }
  return canonical(result, realm);
}

function localeProperty(data: LocaleData, name: string): unknown {
  const language = parsed(data.locale).language;
  if (name === "baseName") return printLocaleLanguage(language, false);
  if (name === "language") return language.language;
  if (name === "script") {
    const start = language.language.length + 1;
    return language.script === ""
      ? undefined
      : data.locale.slice(start, start + 4);
  }
  if (name === "region") {
    const start =
      language.language.length + 1 + (language.script === "" ? 0 : 5);
    return language.region === ""
      ? undefined
      : data.locale.slice(start, start + language.region.length);
  }
  if (name === "variants")
    return language.variants.length === 0
      ? undefined
      : language.variants.join("-");
  const key =
    name === "calendar"
      ? "ca"
      : name === "collation"
        ? "co"
        : name === "firstDayOfWeek"
          ? "fw"
          : name === "hourCycle"
            ? "hc"
            : name === "caseFirst"
              ? "kf"
              : name === "numeric"
                ? "kn"
                : "nu";
  for (const field of data.keywords) {
    if (field === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
    if (field.key === key)
      return name === "numeric"
        ? field.value === "" || field.value === "true"
        : field.value;
  }
  return name === "numeric" ? false : undefined;
}

function infoProperty(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(object, name, value, hooks)
  )
    throw "LOCALE_INFO_RESULT_INVARIANT";
}

function localeInformation(
  tag: string,
  name: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  if (name === "getCollations")
    return createStringArrayFromList(localeCollations(tag), realm, hooks);
  if (name === "getCalendars")
    return createStringArrayFromList(localeCalendars(tag), realm, hooks);
  if (name === "getNumberingSystems")
    return createStringArrayFromList(localeNumberingSystems(tag), realm, hooks);
  if (name === "getHourCycles")
    return createStringArrayFromList(localeHourCycles(tag), realm, hooks);
  if (name === "getTimeZones") {
    const zones = localeTimeZones(tag);
    return zones === undefined
      ? undefined
      : createStringArrayFromList(zones, realm, hooks);
  }
  const object = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  if (name === "getTextInfo")
    infoProperty(object, "direction", localeTextDirection(tag), hooks);
  else {
    const week = localeWeekInfo(tag),
      days: unknown[] = [];
    for (const day of week.weekend) {
      if (day === undefined) throw "LOCALE_INFO_RESULT_INVARIANT";
      days.push(day);
    }
    infoProperty(object, "firstDay", week.firstDay, hooks);
    infoProperty(
      object,
      "weekend",
      createArrayFromList(days, 0, realm.arrayPrototype, realm, hooks),
      hooks,
    );
  }
  return object;
}

export function installLocaleIntrinsic(
  intl: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.localePrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "intl-locale", realm, hooks),
      );
      const tag = args[0];
      if (
        typeof tag !== "string" &&
        viewObjectValue(tag, realm.objectPrototype) === undefined
      )
        throw createRuntimeError(realm, "type");
      const source =
        localeObjectTag(tag, realm) ?? textValue(tag, realm, hooks);
      const options =
        args[1] === undefined
          ? createObject<ScriptPropertyKey, unknown>(undefined)
          : toObjectValue(args[1], realm, hooks);
      const locale = updateKeywords(
        updateLanguage(canonical(source, realm), options, realm, hooks),
        options,
        realm,
        hooks,
      );
      object.internalLocaleData = {
        locale,
        keywords: unicodeKeywords(parsed(locale)),
      };
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "Locale", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.Locale",
    false,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "toString",
    builtinFunction(
      realm.functionPrototype,
      "toString",
      0,
      (receiver, args): unknown => requireLocale(receiver, realm).locale,
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["maximize", "minimize"]) {
    if (name === undefined) throw "LOCALE_PROPERTY_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          const source = requireLocale(receiver, realm).locale;
          const tag =
            name === "maximize"
              ? maximizeLocaleId(source)
              : minimizeLocaleId(source);
          if (tag === undefined) throw "LOCALE_OBJECT_DATA_INVARIANT";
          const result = constructObjectValue(
            constructor,
            [tag],
            realm.objectPrototype,
          );
          if (result.error !== "none") throw "LOCALE_CONSTRUCTION_INVARIANT";
          return result.value;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  for (const name of [
    "getCalendars",
    "getCollations",
    "getHourCycles",
    "getNumberingSystems",
    "getTextInfo",
    "getWeekInfo",
    "getTimeZones",
  ]) {
    if (name === undefined) throw "LOCALE_PROPERTY_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown =>
          localeInformation(
            requireLocale(receiver, realm).locale,
            name,
            realm,
            hooks,
          ),
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  for (const name of [
    "baseName",
    "language",
    "script",
    "region",
    "variants",
    "calendar",
    "collation",
    "firstDayOfWeek",
    "hourCycle",
    "caseFirst",
    "numeric",
    "numberingSystem",
  ]) {
    if (name === undefined) throw "LOCALE_PROPERTY_INVARIANT";
    builtinAccessor(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        (receiver, args): unknown =>
          localeProperty(requireLocale(receiver, realm), name),
        hooks,
      ),
      undefined,
      hooks,
    );
  }
  builtinProperty(intl, "Locale", constructor, true, true, hooks);
}
