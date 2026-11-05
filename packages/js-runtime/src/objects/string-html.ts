import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
/** Annex B CreateHTML: receiver coercion precedes attributes; only attribute quotes are escaped. */
export function installStringHTMLMethods(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function text(value: unknown): string {
    const converted = stringValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function install(name: string, tag: string, attribute: string): void {
    builtinProperty(
      realm.stringPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        attribute === "" ? 0 : 1,
        (receiver, args): unknown => {
          if (receiver === undefined || receiver === null)
            throw createRuntimeError(realm, "type");
          const contents = text(receiver);
          const attr =
            attribute === ""
              ? ""
              : " " +
                attribute +
                '="' +
                text(args[0]).split('"').join("&quot;") +
                '"';
          return "<" + tag + attr + ">" + contents + "</" + tag + ">";
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  install("anchor", "a", "name");
  install("big", "big", "");
  install("blink", "blink", "");
  install("bold", "b", "");
  install("fixed", "tt", "");
  install("fontcolor", "font", "color");
  install("fontsize", "font", "size");
  install("italics", "i", "");
  install("link", "a", "href");
  install("small", "small", "");
  install("strike", "strike", "");
  install("sub", "sub", "");
  install("sup", "sup", "");
}
