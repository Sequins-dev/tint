import {
  ensureExoticSlots,
  exoticSlots,
  createConstructorObject,
  createObject,
  type OrdinaryObject,
  type ObjectExecutionContext,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinFunction,
  builtinProperty,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import {
  viewObjectValue,
  viewWeakRegistryOwner,
  callObjectValue,
} from "./values.ts";
import { isCallableObject } from "./call.ts";
import { constructorPrototype } from "./functions.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  canBeHeldWeakly,
  type WeakRegistryData,
  type WeakStorageService,
  type RegistryCell,
} from "./weak-storage.ts";
import type { ScriptAgent } from "./jobs.ts";
function requireRegistry(value: unknown, realm: ErrorRealm): WeakRegistryData {
  const object = viewObjectValue(value, realm.objectPrototype),
    data =
      object === undefined ? undefined : exoticSlots(object).internalWeakData;
  if (data === undefined || data.kind !== "registry")
    throw createRuntimeError(realm, "type");
  return data;
}
function directoryRegistry(owner: unknown): WeakRegistryData {
  const object = viewWeakRegistryOwner(owner),
    data =
      object === undefined ? undefined : exoticSlots(object).internalWeakData;
  if (data === undefined || data.kind !== "registry")
    throw "REGISTRY_BRAND_INVARIANT";
  return data;
}
function release(data: WeakRegistryData, cell: RegistryCell): void {
  data.storage.clear(cell.target);
  if (cell.token !== undefined) data.storage.clear(cell.token);
}
/** Mutator checkpoint only. GC clears storage cells but never invokes callbacks.
 * The agent's directory itself holds each registry weakly. A scheduled cleanup
 * job may retain it until that job completes, as permitted by the host protocol. */
export function enqueueFinalizationCleanupJobs(
  agent: ScriptAgent,
  enqueue: (
    agent: ScriptAgent,
    job: () => void,
    execution: ObjectExecutionContext<unknown> | undefined,
  ) => void,
): void {
  for (let index = agent.registries.length - 1; index >= 0; index--) {
    const entry = agent.registries[index];
    if (entry === undefined) throw "REGISTRY_DIRECTORY_INVARIANT";
    const owner = entry.storage.key(entry.cell);
    if (owner === undefined) {
      entry.storage.clear(entry.cell);
      agent.registries.splice(index, 1);
      continue;
    }
    const data = directoryRegistry(owner);
    if (data.scheduled) continue;
    let pending = false;
    for (const cell of data.cells) {
      if (cell === undefined) throw "REGISTRY_CELL_INVARIANT";
      if (data.storage.key(cell.target) === undefined) pending = true;
    }
    if (!pending) continue;
    data.scheduled = true;
    enqueue(
      agent,
      (): void => {
        try {
          while (true) {
            let dead = -1;
            for (let i = 0; i < data.cells.length; i++) {
              const cell = data.cells[i];
              if (cell === undefined) throw "REGISTRY_CELL_INVARIANT";
              if (data.storage.key(cell.target) === undefined) {
                dead = i;
                break;
              }
            }
            if (dead < 0) return;
            const cell = data.cells[dead];
            if (cell === undefined) throw "REGISTRY_CELL_INVARIANT";
            data.cells.splice(dead, 1);
            release(data, cell);
            const called = callObjectValue(
              data.cleanup,
              undefined,
              [cell.held],
              data.realm.objectPrototype,
            );
            if (called.error !== "none")
              throw createRuntimeError(data.realm, "type");
          }
        } finally {
          data.scheduled = false;
        }
      },
      data.realm.executionContext,
    );
  }
}
function attachRegistry(
  realm: ErrorRealm,
  storage: WeakStorageService,
  owner: OrdinaryObject<ScriptPropertyKey, unknown>,
  cleanup: unknown,
): void {
  ensureExoticSlots(owner).internalWeakData = {
    kind: "registry",
    storage,
    realm,
    cleanup,
    cells: [],
    scheduled: false,
  };
  realm.agent.registries.push({
    storage,
    cell: storage.create(owner, undefined, false),
  });
}

/** A non-public registry retained by the embedding's tracking function. */
export function hostFinalizationRegistry(
  realm: ErrorRealm,
  storage: WeakStorageService,
  cleanup: unknown,
): (target: unknown, held: unknown) => void {
  const owner = createObject<ScriptPropertyKey, unknown>(
    realm.finalizationRegistryPrototype,
  );
  attachRegistry(realm, storage, owner, cleanup);
  return (target, held): void => {
    const data = requireRegistry(owner, realm);
    data.cells.push({
      target: storage.create(target, undefined, false),
      held,
      token: undefined,
    });
  };
}

export function installFinalizationRegistryIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.finalizationRegistryPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      if (
        !isCallableObject<ScriptPropertyKey, unknown>(
          viewObjectValue(args[0], realm.objectPrototype),
        )
      )
        throw createRuntimeError(realm, "type");
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "finalization-registry", realm, hooks),
      );
      const storage = realm.agent.weakStorage;
      if (storage === undefined) return rejectUnsupportedExecution(realm);
      attachRegistry(realm, storage, object, args[0]);
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "FinalizationRegistry", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "FinalizationRegistry",
    false,
    true,
    hooks,
  );
  builtinProperty(
    global,
    "FinalizationRegistry",
    constructor,
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "register",
    builtinFunction(
      realm.functionPrototype,
      "register",
      2,
      (receiver, args): unknown => {
        const data = requireRegistry(receiver, realm),
          target = args[0],
          held = args[1],
          token = args[2];
        if (!canBeHeldWeakly(target, realm) || target === held)
          throw createRuntimeError(realm, "type");
        if (token !== undefined && !canBeHeldWeakly(token, realm))
          throw createRuntimeError(realm, "type");
        data.cells.push({
          target: data.storage.create(target, undefined, false),
          held,
          token:
            token === undefined
              ? undefined
              : data.storage.create(token, undefined, false),
        });
        return undefined;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "unregister",
    builtinFunction(
      realm.functionPrototype,
      "unregister",
      1,
      (receiver, args): unknown => {
        const data = requireRegistry(receiver, realm),
          token = args[0];
        if (!canBeHeldWeakly(token, realm))
          throw createRuntimeError(realm, "type");
        let removed = false;
        for (let i = data.cells.length - 1; i >= 0; i--) {
          const cell = data.cells[i];
          if (cell === undefined) throw "REGISTRY_CELL_INVARIANT";
          if (
            cell.token !== undefined &&
            data.storage.key(cell.token) === token
          ) {
            data.cells.splice(i, 1);
            release(data, cell);
            removed = true;
          }
        }
        return removed;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
