import { ordinaryHasInstance } from "./functions.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import {
  defineOwnProperty,
  getProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

function eligibleReceiver(
  receiver: unknown,
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): boolean {
  // OrdinaryHasInstance intentionally bypasses a public @@hasInstance hook.
  const result = ordinaryHasInstance(receiver, constructor, hooks, realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

/** Callers finish formatter initialization first and only chain ordinary calls
 * with undefined NewTarget. Construction through new never uses this operation. */
export function chainIntlLegacy(
  receiver: unknown,
  instance: OrdinaryObject<ScriptPropertyKey, unknown>,
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  if (!eligibleReceiver(receiver, constructor, realm, hooks)) return instance;
  const object = viewObjectValue(receiver, realm.objectPrototype);
  if (object === undefined) throw "INTL_LEGACY_RECEIVER_INVARIANT";
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      object,
      realm.intlFallbackSymbol,
      {
        fields: 51,
        value: instance,
        writable: false,
        enumerable: false,
        configurable: false,
        get: undefined,
        set: undefined,
      },
      hooks,
    ) !== "accepted"
  )
    throw createRuntimeError(realm, "type");
  return receiver;
}

/** Only legacy-aware methods use this operation. The caller must still require
 * its own internal slot on the returned value; fallback values are not recursive. */
export function unwrapIntlLegacy(
  receiver: unknown,
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  branded: (object: OrdinaryObject<ScriptPropertyKey, unknown>) => boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const object = viewObjectValue(receiver, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  if (branded(object) || !eligibleReceiver(receiver, constructor, realm, hooks))
    return receiver;
  return getProperty<ScriptPropertyKey, unknown>(
    object,
    realm.intlFallbackSymbol,
    receiver,
    hooks,
  );
}
