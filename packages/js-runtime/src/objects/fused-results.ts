import type { ScriptPropertyKey } from "./symbols.ts";
import type { ObjectHooks, OrdinaryObject } from "./operations.ts";
import { throwIfRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  binaryObjectValueOperation,
  unaryObjectValueOperation,
} from "./arithmetic.ts";
import { objectPropertyKey, stringValue } from "./coercion.ts";
import {
  callObjectValue,
  getObjectValueProperty,
  getObjectValuePropertyWithReceiver,
  setObjectValueProperty,
  setObjectValuePropertyWithReceiver,
  sloppyCallReceiver,
  deleteObjectValueProperty,
} from "./values.ts";
import { constructObjectValue } from "./functions.ts";

// Fused result completion for runtime-compiled Script entries. Each helper runs
// one runtime operation and completes its result exactly like the lowered
// `throwIfRuntimeError($errors, result.error)` sequence: "none" continues,
// "unsupported" rejects the execution, and any other error throws the
// engine-created error. A lowered site is then one call that returns the value,
// instead of a result record, an out-of-line check and two field reads, which
// keeps the per-site native code small. Semantics are identical to the unfused
// sequence; AOT Scripts keep their inline checks.

export function binaryObjectValueOperationOrThrow(
  operator: string,
  left: unknown,
  right: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  const result = binaryObjectValueOperation(
    operator,
    left,
    right,
    hooks,
    realm,
  );
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function unaryObjectValueOperationOrThrow(
  operator: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  const result = unaryObjectValueOperation(operator, value, hooks, realm);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function objectPropertyKeyOrThrow(
  base: unknown,
  key: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): ScriptPropertyKey {
  const result = objectPropertyKey(base, key, hooks, realm);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function stringValueOrThrow(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): string {
  const result = stringValue(value, hooks, realm);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function getObjectValuePropertyOrThrow(
  value: unknown,
  key: ScriptPropertyKey,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  const result = getObjectValueProperty(value, key, hooks, realm);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function getObjectValuePropertyWithReceiverOrThrow(
  base: unknown,
  key: ScriptPropertyKey,
  receiver: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  const result = getObjectValuePropertyWithReceiver(
    base,
    key,
    receiver,
    hooks,
    realm,
  );
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function setObjectValuePropertyOrThrow(
  base: unknown,
  key: ScriptPropertyKey,
  value: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): void {
  throwIfRuntimeError(
    realm,
    setObjectValueProperty(base, key, value, strict, hooks, realm),
  );
}

export function setObjectValuePropertyWithReceiverOrThrow(
  base: unknown,
  key: ScriptPropertyKey,
  value: unknown,
  receiver: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): void {
  throwIfRuntimeError(
    realm,
    setObjectValuePropertyWithReceiver(
      base,
      key,
      value,
      receiver,
      strict,
      hooks,
      realm,
    ),
  );
}

export function sloppyCallReceiverOrThrow(
  value: unknown,
  globalThis: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  const result = sloppyCallReceiver(value, globalThis, hooks, realm);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function deleteObjectValuePropertyOrThrow(
  base: unknown,
  key: ScriptPropertyKey,
  strict: boolean,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): boolean {
  const result = deleteObjectValueProperty(base, key, strict, witness);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

export function callObjectValueOrThrow(
  value: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): unknown {
  const result = callObjectValue(value, receiver, arguments_, witness);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

/** The realm comes first: as `(value, arguments, witness, realm) => unknown`
 * a source function's `(receiver, arguments, callee, newTarget)` callback
 * would be assignable to this helper, and managed JIT entries reject
 * callbacks whose type crosses surface signature classes. */
export function constructObjectValueOrThrow(
  realm: ErrorRealm,
  value: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): unknown {
  const result = constructObjectValue(value, arguments_, witness);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}
