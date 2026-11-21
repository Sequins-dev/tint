import { installArrayIntrinsics } from "./array-intrinsics.ts";
import { installFunctionIntrinsics } from "./function-intrinsics.ts";
import { installPrimitiveIntrinsics } from "./primitive-intrinsics.ts";
import { installSymbolIntrinsics } from "./symbol-intrinsics.ts";
import { installIteratorConstructor } from "./iterator-constructor.ts";
import { installMapIntrinsics } from "./map-intrinsics.ts";
import { installSetIntrinsics } from "./set-intrinsics.ts";
import { installWeakCollectionIntrinsics } from "./weak-collections.ts";
import { installRegExpIntrinsics } from "./regexp-intrinsics.ts";
import { installProxyIntrinsics } from "./proxy.ts";
import { installPromiseIntrinsics } from "./promise-intrinsics.ts";
import { installDataViewIntrinsics } from "./data-view.ts";
import { installDisposableStackIntrinsics } from "./disposable-stack.ts";
import { installAsyncDisposableStackIntrinsics } from "./async-disposable-stack.ts";
import {
  createObject,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import {
  createErrorRealm,
  installErrorIntrinsics,
  type ErrorRealm,
} from "./errors.ts";
import { callObjectValue, scriptSameValue } from "./values.ts";
import { createSymbolRegistry, type ScriptPropertyKey } from "./symbols.ts";
import { createScriptAgent } from "./jobs.ts";
import { installArrayBufferIntrinsics } from "./array-buffer.ts";
import { installTypedArrayIntrinsics } from "./typed-array-intrinsics.ts";
import { installObjectIntrinsics } from "./object-intrinsics.ts";

export interface ProgramRealmCore {
  readonly realm: ErrorRealm;
  readonly hooks: ObjectHooks<unknown>;
  readonly object: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly installed: Set<string>;
  objectInstalled: boolean;
  arrayBufferInstalled: boolean;
  typedArrayInstalled: boolean;
}
let current: ProgramRealmCore | undefined = undefined;

/** The shared realm identity. Embedders install globals on its object once. */
export function programRealmCore(
  canSuspend: boolean = false,
): ProgramRealmCore {
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
    createScriptAgent(canSuspend),
  );
  const initialized: ProgramRealmCore = {
    object,
    hooks,
    realm,
    installed: new Set<string>(),
    objectInstalled: false,
    arrayBufferInstalled: false,
    typedArrayInstalled: false,
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

export function installProgramArrayBufferIntrinsics(
  core: ProgramRealmCore,
): void {
  if (core.arrayBufferInstalled) return;
  installArrayBufferIntrinsics(core.object, core.realm, core.hooks);
  core.arrayBufferInstalled = true;
}
export function installProgramTypedArrayIntrinsics(
  core: ProgramRealmCore,
): void {
  if (core.typedArrayInstalled) return;
  installProgramArrayBufferIntrinsics(core);
  installTypedArrayIntrinsics(core.object, core.realm, core.hooks, "little");
  core.typedArrayInstalled = true;
}

export function installProgramPromiseIntrinsics(core: ProgramRealmCore): void {
  const { object, realm, hooks } = core;
  if (realm.promiseConstructor === undefined)
    installPromiseIntrinsics(
      object,
      realm,
      hooks,
      realm.promiseRejectionTracker,
    );
  core.installed.add("installPromiseIntrinsics");
}

/** Typed lookups and the generated host share installation state, including
 * when an application replaces or deletes an already-installed global. */
export function installProgramConstructorGroup(
  core: ProgramRealmCore,
  group: string,
): void {
  if (core.installed.has(group)) return;
  const object = core.object,
    realm = core.realm,
    hooks = core.hooks;
  switch (group) {
    case "installErrorIntrinsics":
      installErrorIntrinsics(object, realm, hooks);
      break;
    case "installObjectIntrinsics":
      installProgramObjectIntrinsics(core);
      break;
    case "installArrayBufferIntrinsics":
      installProgramArrayBufferIntrinsics(core);
      break;
    case "installTypedArrayIntrinsics":
      installProgramTypedArrayIntrinsics(core);
      break;
    case "installArrayIntrinsics":
      installProgramArrayIntrinsics(core);
      break;
    case "installFunctionIntrinsics":
      installFunctionIntrinsics(object, realm, hooks);
      break;
    case "installPrimitiveIntrinsics":
      installPrimitiveIntrinsics(object, realm, hooks);
      break;
    case "installSymbolIntrinsics":
      installSymbolIntrinsics(object, realm, hooks);
      break;
    case "installIteratorConstructor":
      installIteratorConstructor(object, realm, hooks);
      break;
    case "installMapIntrinsics":
      installMapIntrinsics(object, realm, hooks);
      break;
    case "installSetIntrinsics":
      installSetIntrinsics(object, realm, hooks);
      break;
    case "installWeakCollectionIntrinsics":
      installWeakCollectionIntrinsics(object, realm, hooks);
      break;
    case "installRegExpIntrinsics":
      installRegExpIntrinsics(object, realm, hooks);
      break;
    case "installProxyIntrinsics":
      installProxyIntrinsics(object, realm, hooks);
      break;
    case "installPromiseIntrinsics":
      installPromiseIntrinsics(
        object,
        realm,
        hooks,
        (_promise, _operation): void => {},
      );
      break;
    case "installDataViewIntrinsics":
      installProgramArrayBufferIntrinsics(core);
      installDataViewIntrinsics(object, realm, hooks);
      break;
    case "installDisposableStackIntrinsics":
      installDisposableStackIntrinsics(object, realm, hooks);
      break;
    case "installAsyncDisposableStackIntrinsics":
      installAsyncDisposableStackIntrinsics(object, realm, hooks);
      break;
    default:
      throw "unknown program realm installer";
  }
  core.installed.add(group);
}
