import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ProxyState,
} from "./operations.ts";
import { isCallableObject } from "./call.ts";
import { viewObjectValue } from "./values.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
export interface ProxyAccess {
  readonly target: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly handler: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly trap: unknown;
}
/** Proxy internal methods do not enter the realm where the Proxy was created. */
export function proxyRealm(creationRealm: ErrorRealm): ErrorRealm {
  const context = creationRealm.agent.activeContext;
  return context === undefined ? creationRealm : context.realm;
}
/** Capture target and handler before observable trap lookup. Revocation during
 * lookup does not invalidate the operation's already-captured references. */
export function proxyAccess(
  state: ProxyState<ScriptPropertyKey, unknown>,
  name: string,
  creationRealm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ProxyAccess {
  const realm = proxyRealm(creationRealm);
  const target = state.target,
    handler = state.handler;
  if (target === undefined || handler === undefined)
    throw createRuntimeError(realm, "type");
  const trap = getProperty<ScriptPropertyKey, unknown>(
    handler,
    name,
    handler,
    hooks,
  );
  if (trap === undefined || trap === null)
    return { target, handler, trap: undefined };
  if (
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(trap, realm.objectPrototype),
    )
  )
    throw createRuntimeError(realm, "type");
  return { target, handler, trap };
}
