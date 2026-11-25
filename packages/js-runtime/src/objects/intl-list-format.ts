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
import { stringValue } from "./coercion.ts";
import { canonicalLocaleList, runtimeDefaultLocale } from "./locale-objects.ts";
import {
  createArrayFromList,
  createStringArrayFromList,
} from "./array-like.ts";
import {
  getScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createListFormatter,
  lookupListFormatLocale,
  formatList,
  formatListParts,
  type ListFormatter,
  type ListFormatType,
  type ListFormatStyle,
} from "./list-format.ts";

function stringOption(
  options: unknown,
  name: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, name, realm, hooks);
  if (value === undefined) return undefined;
  const converted = stringValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  return converted.value;
}

function localeMatcher(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const matcher = stringOption(options, "localeMatcher", realm, hooks);
  if (matcher !== undefined && matcher !== "lookup" && matcher !== "best fit")
    throw createRuntimeError(realm, "range");
  // Initial implementation-defined best-fit policy is lookup as well.
}

function formatType(
  value: string | undefined,
  realm: ErrorRealm,
): ListFormatType {
  if (value === undefined) return "conjunction";
  if (value === "conjunction" || value === "disjunction" || value === "unit")
    return value;
  throw createRuntimeError(realm, "range");
}

function formatStyle(
  value: string | undefined,
  realm: ErrorRealm,
): ListFormatStyle {
  if (value === undefined) return "long";
  if (value === "long" || value === "short" || value === "narrow") return value;
  throw createRuntimeError(realm, "range");
}

function resolveLocale(requested: readonly string[]): string {
  for (const tag of requested) {
    if (tag === undefined) throw "LIST_LOCALE_INVARIANT";
    const match = lookupListFormatLocale(tag);
    if (match !== undefined) return match;
  }
  return runtimeDefaultLocale;
}

function requireFormatter(value: unknown, realm: ErrorRealm): ListFormatter {
  const object = viewObjectValue(value, realm.objectPrototype);
  const data =
    object === undefined
      ? undefined
      : exoticSlots(object).internalListFormatData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}

/** Iterator protocol failures propagate without closing. Only a successfully
 * yielded non-string element establishes the pending TypeError close boundary. */
function stringListFromIterable(
  input: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): readonly string[] {
  const values: string[] = [];
  if (input === undefined) return values;
  const iterator = getScriptIterator(input, realm, hooks);
  while (true) {
    const step = stepScriptIterator(iterator);
    if (step.done) return values;
    const value = step.value;
    if (typeof value !== "string") {
      const error = createRuntimeError(realm, "type");
      closeScriptIterator(iterator, true);
      throw error;
    }
    values.push(value);
  }
}

function resultProperty(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(object, name, value, hooks)
  )
    throw "LIST_RESULT_PROPERTY_INVARIANT";
}

export function installListFormatIntrinsic(
  intl: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.listFormatPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "intl-list-format", realm, hooks),
      );
      const requested = canonicalLocaleList(args[0], realm, hooks),
        input = args[1];
      const options =
        input === undefined
          ? createObject<ScriptPropertyKey, unknown>(undefined)
          : viewObjectValue(input, realm.objectPrototype);
      if (options === undefined) throw createRuntimeError(realm, "type");
      localeMatcher(options, realm, hooks);
      const locale = resolveLocale(requested);
      const type = formatType(
        stringOption(options, "type", realm, hooks),
        realm,
      );
      const style = formatStyle(
        stringOption(options, "style", realm, hooks),
        realm,
      );
      const formatter = createListFormatter(locale, type, style);
      if (formatter === undefined) throw "LIST_FORMAT_DATA_INVARIANT";
      ensureExoticSlots(object).internalListFormatData = formatter;
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "ListFormat", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.ListFormat",
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
        localeMatcher(options, realm, hooks);
        const supported: string[] = [];
        for (const tag of requested) {
          if (tag === undefined) throw "LIST_LOCALE_INVARIANT";
          if (lookupListFormatLocale(tag) !== undefined) supported.push(tag);
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
    "format",
    builtinFunction(
      realm.functionPrototype,
      "format",
      1,
      (receiver, args): unknown => {
        const formatter = requireFormatter(receiver, realm);
        const values = stringListFromIterable(args[0], realm, hooks);
        return formatList(formatter, values);
      },
      hooks,
    ),
    true,
    true,
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
        const values = stringListFromIterable(args[0], realm, hooks),
          result: unknown[] = [];
        for (const part of formatListParts(formatter, values)) {
          if (part === undefined) throw "LIST_PART_INVARIANT";
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
          resultProperty(object, "type", part.type, hooks);
          resultProperty(object, "value", part.value, hooks);
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
        const formatter = requireFormatter(receiver, realm),
          result = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
        resultProperty(result, "locale", formatter.locale, hooks);
        resultProperty(result, "type", formatter.type, hooks);
        resultProperty(result, "style", formatter.style, hooks);
        return result;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(intl, "ListFormat", constructor, true, true, hooks);
}
