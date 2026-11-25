import { parseJSONText } from "@tint/foundation/text/json-syntax";
import { stringValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import { setIntegrityLevel } from "./integrity.ts";
import { createRuntimeError, rejectUnsupportedExecution } from "./errors.ts";
import { parseJSON } from "./json-parse.ts";
import { stringifyJSON } from "./json-stringify.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createDataProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  wellKnownSymbol,
  scriptPropertyKeyOrder,
  type ScriptPropertyKey,
} from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
export function installJSONIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const json = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  builtinProperty(
    json,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "JSON",
    false,
    true,
    hooks,
  );
  builtinProperty(
    json,
    "stringify",
    builtinFunction(
      realm.functionPrototype,
      "stringify",
      3,
      (receiver, args): unknown =>
        stringifyJSON(args[0], args[1], args[2], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    json,
    "parse",
    builtinFunction(
      realm.functionPrototype,
      "parse",
      2,
      (receiver, args): unknown => parseJSON(args[0], args[1], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    json,
    "rawJSON",
    builtinFunction(
      realm.functionPrototype,
      "rawJSON",
      1,
      (receiver, args): unknown => {
        const text = stringValue(args[0], hooks, realm);
        if (text.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (text.error !== "none") throw createRuntimeError(realm, "type");
        const source = text.value,
          node = parseJSONText(source).node;
        if (
          node === undefined ||
          node.kind === "array" ||
          node.kind === "object" ||
          node.start !== 0 ||
          node.end !== source.length
        )
          throw createRuntimeError(realm, "syntax");
        const object = createObject<ScriptPropertyKey, unknown>(undefined);
        ensureExoticSlots(object).internalRawJSON = source;
        createDataProperty<ScriptPropertyKey, unknown>(
          object,
          "rawJSON",
          source,
          hooks,
        );
        if (
          !setIntegrityLevel<ScriptPropertyKey, unknown>(
            object,
            true,
            hooks,
            (key): number => scriptPropertyKeyOrder(key),
          )
        )
          throw "JSON_FREEZE_INVARIANT";
        return object;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    json,
    "isRawJSON",
    builtinFunction(
      realm.functionPrototype,
      "isRawJSON",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(args[0], realm.objectPrototype);
        return (
          object !== undefined &&
          exoticSlots(object).internalRawJSON !== undefined
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "JSON", json, true, true, hooks);
}
