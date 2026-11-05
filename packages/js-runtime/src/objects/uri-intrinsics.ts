import {
  encodeURIString,
  decodeURIString,
  escapeUTF16,
  unescapeUTF16,
} from "@tint/foundation/text/text-encoding";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

export function installURIIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  for (const name of [
    "encodeURI",
    "encodeURIComponent",
    "decodeURI",
    "decodeURIComponent",
    "escape",
    "unescape",
  ]) {
    if (name === undefined) throw "URI_NAME_INVARIANT";
    const encode = name.startsWith("encode"),
      component = name.endsWith("Component");
    builtinProperty(
      global,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const text = stringValue(args[0], hooks, realm);
          if (text.error === "unsupported")
            return rejectUnsupportedExecution(realm);
          if (text.error !== "none") throw createRuntimeError(realm, "type");
          if (name === "escape") return escapeUTF16(text.value);
          if (name === "unescape") return unescapeUTF16(text.value);
          const result = encode
            ? encodeURIString(text.value, component)
            : decodeURIString(text.value, component);
          if (result.error !== "none") throw createRuntimeError(realm, "uri");
          return result.value;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
