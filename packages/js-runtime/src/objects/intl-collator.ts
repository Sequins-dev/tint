import { lookupCollatorLocale } from "./collation-locales.ts";
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
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { canonicalLocaleList } from "./locale-objects.ts";
import { createStringArrayFromList } from "./array-like.ts";
import {
  configureCollator,
  compareCollator,
  collatorLocaleMatcher,
  type CollatorData,
} from "./collator.ts";
function requireCollator(value: unknown, realm: ErrorRealm): CollatorData {
  const object = viewObjectValue(value, realm.objectPrototype),
    data = object === undefined ? undefined : object.internalCollatorData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function installCollatorIntrinsic(
  intl: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.collatorPrototype;
  function construct(
    locales: unknown,
    options: unknown,
    target: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(
      target === undefined
        ? prototype
        : constructorPrototype(target, "intl-collator", realm, hooks),
    );
    object.internalCollatorData = configureCollator(
      locales,
      options,
      realm,
      hooks,
    );
    return object;
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => construct(args[0], args[1], undefined),
    (args, target): unknown => construct(args[0], args[1], target),
  );
  builtinFunctionMetadata(constructor, "Collator", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.Collator",
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
        const requested = canonicalLocaleList(args[0], realm, hooks),
          options =
            args[1] === undefined
              ? createObject<ScriptPropertyKey, unknown>(undefined)
              : toObjectValue(args[1], realm, hooks);
        collatorLocaleMatcher(options, realm, hooks);
        const supported: string[] = [];
        for (const tag of requested) {
          if (tag === undefined) throw "COLLATOR_SUPPORTED_LOCALE";
          if (lookupCollatorLocale(tag) !== undefined) supported.push(tag);
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
    "compare",
    builtinFunction(
      realm.functionPrototype,
      "get compare",
      0,
      (receiver, args): unknown => {
        const data = requireCollator(receiver, realm);
        if (data.boundCompare === undefined)
          data.boundCompare = builtinFunction(
            realm.functionPrototype,
            "",
            2,
            (ignored, values): unknown =>
              compareCollator(data, values[0], values[1], realm, hooks),
            hooks,
          );
        return data.boundCompare;
      },
      hooks,
    ),
    undefined,
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
        const data = requireCollator(receiver, realm),
          result = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
        function property(key: string, value: unknown): void {
          if (
            !createDataProperty<ScriptPropertyKey, unknown>(
              result,
              key,
              value,
              hooks,
            )
          )
            throw "COLLATOR_RESULT_PROPERTY";
        }
        property("locale", data.locale);
        property("usage", data.usage);
        property("sensitivity", data.sensitivity);
        property("ignorePunctuation", data.ignorePunctuation);
        property("collation", data.collation);
        property("numeric", data.numeric);
        property("caseFirst", data.caseFirst);
        return result;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(intl, "Collator", constructor, true, true, hooks);
}
export function installStringLocaleCompare(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.stringPrototype,
    "localeCompare",
    builtinFunction(
      realm.functionPrototype,
      "localeCompare",
      1,
      (receiver, args): unknown => {
        if (receiver === undefined || receiver === null)
          throw createRuntimeError(realm, "type");
        const left = stringValue(receiver, hooks, realm);
        if (left.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (left.error !== "none") throw createRuntimeError(realm, "type");
        const right = stringValue(args[0], hooks, realm);
        if (right.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (right.error !== "none") throw createRuntimeError(realm, "type");
        const data = configureCollator(args[1], args[2], realm, hooks);
        return compareCollator(data, left.value, right.value, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
