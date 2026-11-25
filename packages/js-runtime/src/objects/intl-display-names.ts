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
import { optionValue } from "./options.ts";
import { stringValue } from "./coercion.ts";
import { canonicalLocaleList } from "./locale-objects.ts";
import { createStringArrayFromList } from "./array-like.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { viewDisplayNames } from "./intl-format-views.ts";
import {
  canonicalDisplayNamesCode,
  createDisplayNamesData,
  displayNameOf,
  displayNamesLocaleIndex,
  type DisplayNamesData,
} from "./display-names.ts";
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
/** GetOption for a string with a closed list of values. */
function option(
  options: unknown,
  name: string,
  choices: readonly string[],
  fallback: string | undefined,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, name, realm, hooks);
  if (value === undefined) return fallback;
  const text = string(value, realm, hooks);
  if (!choices.includes(text)) throw createRuntimeError(realm, "range");
  return text;
}
function required(value: string | undefined): string {
  if (value === undefined) throw "DISPLAY_NAMES_OPTION_INVARIANT";
  return value;
}
/** GetOptionsObject without ToObject: undefined uses a null-prototype object
 * and any other non-object throws. */
function optionsObject(input: unknown, realm: ErrorRealm): Obj {
  if (input === undefined)
    return createObject<ScriptPropertyKey, unknown>(undefined);
  const object = viewObjectValue(input, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  return object;
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
    throw "DISPLAY_NAMES_PROPERTY_INVARIANT";
}
function requireDisplayNames(
  receiver: unknown,
  realm: ErrorRealm,
): DisplayNamesData {
  const object = viewObjectValue(receiver, realm.objectPrototype),
    data =
      object === undefined
        ? undefined
        : viewDisplayNames(exoticSlots(object).internalIntlFormatData);
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function installDisplayNamesIntrinsic(
  intl: Obj,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.displayNamesPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "intl-display-names", realm, hooks),
      );
      const requested = canonicalLocaleList(args[0], realm, hooks);
      // Intl.DisplayNames requires an options argument.
      if (args[1] === undefined) throw createRuntimeError(realm, "type");
      const options = optionsObject(args[1], realm);
      option(
        options,
        "localeMatcher",
        ["lookup", "best fit"],
        "best fit",
        realm,
        hooks,
      );
      const style = required(
        option(
          options,
          "style",
          ["narrow", "short", "long"],
          "long",
          realm,
          hooks,
        ),
      );
      const type = option(
        options,
        "type",
        [
          "language",
          "region",
          "script",
          "currency",
          "calendar",
          "dateTimeField",
        ],
        undefined,
        realm,
        hooks,
      );
      if (type === undefined) throw createRuntimeError(realm, "type");
      const fallback = required(
        option(options, "fallback", ["code", "none"], "code", realm, hooks),
      );
      const languageDisplay = required(
        option(
          options,
          "languageDisplay",
          ["dialect", "standard"],
          "dialect",
          realm,
          hooks,
        ),
      );
      ensureExoticSlots(object).internalIntlFormatData = createDisplayNamesData(
        requested,
        style,
        type,
        fallback,
        languageDisplay,
      );
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "DisplayNames", 2, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.DisplayNames",
    false,
    true,
    hooks,
  );
  builtinProperty(intl, "DisplayNames", constructor, true, true, hooks);
  builtinProperty(
    constructor,
    "supportedLocalesOf",
    builtinFunction(
      realm.functionPrototype,
      "supportedLocalesOf",
      1,
      (receiver, args): unknown => {
        const requested = canonicalLocaleList(args[0], realm, hooks),
          options = optionsObject(args[1], realm);
        option(
          options,
          "localeMatcher",
          ["lookup", "best fit"],
          "best fit",
          realm,
          hooks,
        );
        const supported: string[] = [];
        for (const tag of requested) {
          if (tag === undefined) throw "DISPLAY_NAMES_SUPPORTED_INVARIANT";
          if (displayNamesLocaleIndex(tag) >= 0) supported.push(tag);
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
    "of",
    builtinFunction(
      realm.functionPrototype,
      "of",
      1,
      (receiver, args): unknown => {
        const data = requireDisplayNames(receiver, realm),
          code = string(args[0], realm, hooks),
          canonical = canonicalDisplayNamesCode(data.type, code);
        if (canonical === undefined) throw createRuntimeError(realm, "range");
        const name = displayNameOf(data, canonical);
        if (name !== undefined) return name;
        return data.fallback === "code" ? canonical : undefined;
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
        const data = requireDisplayNames(receiver, realm),
          result = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
        property(result, "locale", data.locale, hooks);
        property(result, "style", data.style, hooks);
        property(result, "type", data.type, hooks);
        property(result, "fallback", data.fallback, hooks);
        if (data.type === "language")
          property(result, "languageDisplay", data.languageDisplay, hooks);
        return result;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
