import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { exoticSlots } from "./operations.ts";

/** GetFunctionRealm follows internal targets; it never invokes Proxy traps. */
export function getFunctionRealm(
  functionObject: OrdinaryObject<ScriptPropertyKey, unknown>,
  callerRealm: ErrorRealm,
): ErrorRealm {
  let target = functionObject;
  while (true) {
    const bound = target.internalBoundTarget;
    if (bound !== undefined) {
      target = bound;
      continue;
    }
    const proxy = exoticSlots(target).internalProxyData;
    if (proxy !== undefined) {
      const proxyTarget = proxy.target;
      if (proxyTarget === undefined || proxy.handler === undefined) {
        const active = callerRealm.agent.activeContext;
        throw createRuntimeError(
          active === undefined ? callerRealm : active.realm,
          "type",
        );
      }
      target = proxyTarget;
      continue;
    }
    const context = target.internalExecutionContext;
    const getRealm = context === undefined ? undefined : context.getRealm;
    if (getRealm !== undefined) return getRealm();
    const active = callerRealm.agent.activeContext;
    return active === undefined ? callerRealm : active.realm;
  }
}
