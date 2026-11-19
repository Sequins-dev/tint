import {
  createObject,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { createErrorRealm, type ErrorRealm } from "./errors.ts";
import { callObjectValue, scriptSameValue } from "./values.ts";
import { createSymbolRegistry, type ScriptPropertyKey } from "./symbols.ts";
import { createScriptAgent } from "./jobs.ts";
import { installArrayIntrinsics } from "./array-intrinsics.ts";
import { installObjectIntrinsics } from "./object-intrinsics.ts";

export interface ProgramRealmCore {
  readonly realm: ErrorRealm;
  readonly hooks: ObjectHooks<unknown>;
  readonly object: OrdinaryObject<ScriptPropertyKey, unknown>;
  objectInstalled: boolean;
}
let current: ProgramRealmCore | undefined = undefined;

/** The shared realm identity. Embedders install globals on its object once. */
export function programRealmCore(): ProgramRealmCore {
  const existing = current;
  if (existing !== undefined) return existing;
  const prototype = createObject<ScriptPropertyKey, unknown>(undefined);
  const object = createObject<ScriptPropertyKey, unknown>(prototype);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: (left, right): boolean => scriptSameValue(left, right),
    call: (callee, receiver, arguments_): unknown => {
      const result = callObjectValue(callee, receiver, arguments_, object);
      if (result.error !== "none") throw "GENERAL_HOST_HOOK_CALL";
      return result.value;
    },
  };
  const realm = createErrorRealm(
    prototype,
    hooks,
    createSymbolRegistry(),
    createScriptAgent(false),
  );
  const initialized: ProgramRealmCore = {
    object,
    hooks,
    realm,
    objectInstalled: false,
  };
  current = initialized;
  return initialized;
}
export function installProgramObjectIntrinsics(core: ProgramRealmCore): void {
  if (core.objectInstalled) return;
  installObjectIntrinsics(core.object, core.realm, core.hooks);
  core.objectInstalled = true;
}

export function installProgramArrayIntrinsics(core: ProgramRealmCore): void {
  if (core.realm.arrayConstructor !== undefined) return;
  installArrayIntrinsics(core.object, core.realm, core.hooks);
}
