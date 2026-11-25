import { viewSymbolValue } from "./symbols.ts";
import { viewBigIntValue } from "./bigints.ts";
import { ensureExoticSlots, createObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import { createPrimitiveObject } from "./boxed-primitives.ts";
import { viewObjectValue } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

export function requireObjectCoercible(
  value: unknown,
  realm: ErrorRealm,
): void {
  if (value === null || value === undefined)
    throw createRuntimeError(realm, "type");
}

/** ToObject with realm-local wrapper identities. */
export function toObjectValue(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  requireObjectCoercible(value, realm);
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object !== undefined) return object;
  if (typeof value === "number")
    return createPrimitiveObject("number", value, realm.numberPrototype, hooks);
  if (typeof value === "boolean")
    return createPrimitiveObject(
      "boolean",
      value,
      realm.booleanPrototype,
      hooks,
    );
  if (typeof value === "string")
    return createPrimitiveObject("string", value, realm.stringPrototype, hooks);
  const symbol = viewSymbolValue(value);
  if (symbol !== undefined) {
    const box = createObject<ScriptPropertyKey, unknown>(realm.symbolPrototype);
    ensureExoticSlots(box).internalPrimitiveData = {
      kind: "symbol",
      value: symbol,
    };
    return box;
  }
  const bigint = viewBigIntValue(value);
  if (bigint !== undefined) {
    const box = createObject<ScriptPropertyKey, unknown>(realm.bigIntPrototype);
    ensureExoticSlots(box).internalPrimitiveData = {
      kind: "bigint",
      value: bigint,
    };
    return box;
  }
  return rejectUnsupportedExecution(realm);
}
