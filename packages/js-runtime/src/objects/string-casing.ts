import {
  unicodeLowercase,
  unicodeUppercase,
  unicodeLocaleLowercase,
  unicodeLocaleUppercase,
} from "@tint/foundation/unicode/casing";
import { canonicalLocaleList, runtimeDefaultLocale } from "./locale-objects.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";

export function installStringCasingMethods(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function install(
    name: string,
    upper: boolean,
    localized: boolean = false,
  ): void {
    builtinProperty(
      realm.stringPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (receiver === undefined || receiver === null)
            throw createRuntimeError(realm, "type");
          const text = stringValue(receiver, hooks, realm);
          if (text.error === "unsupported")
            return rejectUnsupportedExecution(realm);
          if (text.error !== "none") throw createRuntimeError(realm, "type");
          if (localized) {
            const requested = canonicalLocaleList(args[0], realm, hooks);
            const locale = requested[0] ?? runtimeDefaultLocale;
            const separator = locale.indexOf("-");
            const language =
              separator < 0 ? locale : locale.slice(0, separator);
            return upper
              ? unicodeLocaleUppercase(text.value, language)
              : unicodeLocaleLowercase(text.value, language);
          }
          return upper
            ? unicodeUppercase(text.value)
            : unicodeLowercase(text.value);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  install("toLowerCase", false);
  install("toUpperCase", true);
  install("toLocaleLowerCase", false, true);
  install("toLocaleUpperCase", true, true);
}
