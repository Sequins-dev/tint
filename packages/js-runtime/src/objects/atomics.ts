import {
  compareExchangeAtomicValue,
  updateAtomicValue,
  type AtomicUpdate,
  loadAtomicValue,
  notifyAtomicWaiters,
  prepareAtomicWait,
  storeAtomicValue,
} from "./atomics-access.ts";
import { integerOrInfinity } from "./coercion.ts";
import type { ErrorRealm } from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createObject,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

/** Target facts, stable across an agent cluster. Embeddings supply these from the
 * actual atomic implementation; allocator locks and API availability are unrelated.
 * Four-byte atomic operations are always lock-free by ECMAScript contract. */
export interface AtomicCapabilities {
  readonly lockFree1: boolean;
  readonly lockFree2: boolean;
  readonly lockFree8: boolean;
}
export function installAtomicsIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  policy: AtomicCapabilities,
  pauseHint?: () => void,
): void {
  const existing = realm.agent.atomicsCapabilities;
  if (
    existing !== undefined &&
    (existing.lockFree1 !== policy.lockFree1 ||
      existing.lockFree2 !== policy.lockFree2 ||
      existing.lockFree8 !== policy.lockFree8)
  )
    throw "ATOMICS_CAPABILITY_MISMATCH";
  // Capture target facts: mutating an embedding object cannot change a live agent.
  const capabilities: AtomicCapabilities =
    existing === undefined
      ? {
          lockFree1: policy.lockFree1,
          lockFree2: policy.lockFree2,
          lockFree8: policy.lockFree8,
        }
      : existing;
  realm.agent.atomicsCapabilities = capabilities;
  const atomics = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  builtinProperty(
    atomics,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Atomics",
    false,
    true,
    hooks,
  );
  builtinProperty(
    atomics,
    "isLockFree",
    builtinFunction(
      realm.functionPrototype,
      "isLockFree",
      1,
      (receiver, args): unknown => {
        const width = integerOrInfinity(args[0], hooks, realm);
        if (width === 1) return capabilities.lockFree1;
        if (width === 2) return capabilities.lockFree2;
        if (width === 4) return true;
        return width === 8 ? capabilities.lockFree8 : false;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    atomics,
    "load",
    builtinFunction(
      realm.functionPrototype,
      "load",
      2,
      (receiver, args): unknown =>
        loadAtomicValue(args[0], args[1], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    atomics,
    "store",
    builtinFunction(
      realm.functionPrototype,
      "store",
      3,
      (receiver, args): unknown =>
        storeAtomicValue(args[0], args[1], args[2], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    atomics,
    "compareExchange",
    builtinFunction(
      realm.functionPrototype,
      "compareExchange",
      4,
      (receiver, args): unknown =>
        compareExchangeAtomicValue(
          args[0],
          args[1],
          args[2],
          args[3],
          realm,
          hooks,
        ),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function installUpdate(operation: AtomicUpdate): void {
    builtinProperty(
      atomics,
      operation,
      builtinFunction(
        realm.functionPrototype,
        operation,
        3,
        (receiver, args): unknown =>
          updateAtomicValue(operation, args[0], args[1], args[2], realm, hooks),
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  installUpdate("exchange");
  installUpdate("add");
  installUpdate("sub");
  installUpdate("and");
  installUpdate("or");
  installUpdate("xor");
  builtinProperty(
    atomics,
    "notify",
    builtinFunction(
      realm.functionPrototype,
      "notify",
      3,
      (receiver, args): unknown =>
        notifyAtomicWaiters(args[0], args[1], args[2], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function installWait(name: string, asynchronous: boolean): void {
    builtinProperty(
      atomics,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        4,
        (receiver, args): unknown =>
          prepareAtomicWait(
            asynchronous,
            args[0],
            args[1],
            args[2],
            args[3],
            realm,
            hooks,
          ),
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  installWait("wait", false);
  installWait("waitAsync", true);
  // A trusted nonallocating platform hint may be absent. Script arguments never
  // reach the hint and never undergo observable conversion here.
  builtinProperty(
    atomics,
    "pause",
    builtinFunction(
      realm.functionPrototype,
      "pause",
      0,
      (receiver, args): unknown => {
        if (pauseHint !== undefined) pauseHint();
        return undefined;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "Atomics", atomics, true, true, hooks);
}
