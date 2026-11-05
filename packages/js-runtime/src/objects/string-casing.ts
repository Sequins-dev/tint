import {
  unicodeLowercase,
  unicodeUppercase,
} from "@tint/foundation/unicode/casing";
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
  function install(name: string, upper: boolean): void {
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
}
