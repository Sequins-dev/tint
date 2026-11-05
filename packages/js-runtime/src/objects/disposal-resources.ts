import {
  takeDisposalResources,
  type DisposalStack,
  type DisposalResource,
} from "../disposal/index.ts";
import {
  createResolvingFunctions,
  type PromiseHooks,
  type PromiseResolvingFunctions,
} from "../promises/index.ts";
import { createPromiseObject, createScriptPromiseHooks } from "./promises.ts";
import { awaitScriptValue, createNativeAwaitOperation } from "./await.ts";
import {
  getProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { builtinFunction } from "./intrinsics.ts";
import { viewObjectValue } from "./values.ts";
import { isCallableObject } from "./call.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  createSuppressedRuntimeError,
  type ErrorRealm,
} from "./errors.ts";
interface DisposalPromiseCapability {
  readonly promise: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly protocol: PromiseHooks<unknown>;
  readonly functions: PromiseResolvingFunctions<unknown>;
}
function disposalProtocol(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): PromiseHooks<unknown> {
  return createScriptPromiseHooks(realm, hooks, (promise, operation): void =>
    realm.promiseRejectionTracker(promise, operation),
  );
}
function disposalPromise(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): DisposalPromiseCapability {
  const promise = createPromiseObject(realm.promisePrototype),
    record = promise.internalPromiseData;
  if (record === undefined) throw "DISPOSAL_PROMISE_RECORD_INVARIANT";
  const protocol = disposalProtocol(realm, hooks);
  return {
    promise,
    protocol,
    functions: createResolvingFunctions<unknown>(record, protocol),
  };
}
interface DisposalSink {
  readonly value: unknown;
  readonly protocol: PromiseHooks<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}
function disposalSink(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  promise: boolean,
): DisposalSink {
  if (promise) {
    const capability = disposalPromise(realm, hooks);
    return {
      value: capability.promise,
      protocol: capability.protocol,
      resolve: capability.functions.resolve,
      reject: capability.functions.reject,
    };
  }
  const operation = createNativeAwaitOperation();
  return {
    value: operation.value,
    protocol: disposalProtocol(realm, hooks),
    resolve: operation.resolve,
    reject: operation.reject,
  };
}
/** Async fallback ignores a synchronous disposer's return value, but converts its
 * abrupt completion into a rejected intrinsic Promise. */
export function resolveDisposalMethod(
  value: unknown,
  asynchronous: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const target = object;
  function method(name: string): unknown {
    const result = getProperty<ScriptPropertyKey, unknown>(
      target,
      wellKnownSymbol(realm.symbolRegistry, name),
      value,
      hooks,
    );
    if (result === undefined || result === null) return undefined;
    if (
      !isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(result, realm.objectPrototype),
      )
    )
      throw createRuntimeError(realm, "type");
    return result;
  }
  if (!asynchronous) return method("dispose");
  const asyncMethod = method("asyncDispose");
  if (asyncMethod !== undefined) return asyncMethod;
  const syncMethod = method("dispose");
  if (syncMethod === undefined) return undefined;
  return builtinFunction(
    realm.functionPrototype,
    "",
    0,
    (receiver, args): unknown => {
      const capability = disposalPromise(realm, hooks);
      try {
        hooks.call(syncMethod, receiver, []);
        capability.functions.resolve(undefined);
      } catch (error) {
        capability.functions.reject(error);
      }
      return capability.promise;
    },
    hooks,
  );
}
interface DisposalFailure {
  failed: boolean;
  value: unknown;
}
function rememberFailure(
  state: DisposalFailure,
  error: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  state.value = state.failed
    ? createSuppressedRuntimeError(realm, error, state.value, hooks)
    : error;
  state.failed = true;
}
export function disposeSyncResources(
  stack: DisposalStack<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  failed: boolean,
  value: unknown,
): void {
  const resources = takeDisposalResources<unknown>(stack);
  const failure: DisposalFailure = { failed, value };
  if (resources === undefined) {
    if (failed) throw value;
    return;
  }
  for (let index = resources.length - 1; index >= 0; index--) {
    const resource = resources[index];
    if (resource === undefined) throw "DISPOSAL_RESOURCE_INVARIANT";
    try {
      hooks.call(resource.method, resource.value, []);
    } catch (error) {
      rememberFailure(failure, error, realm, hooks);
    }
  }
  if (failure.failed) throw failure.value;
}
/** Drain mixed sync/async resources in reverse order. Empty async resources
 * establish an await boundary before the next synchronous disposer. */
function beginAsyncDisposal(
  extract: () => DisposalStack<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  failed: boolean,
  value: unknown,
  alwaysPromise: boolean,
): DisposalCompletion {
  const capability = disposalSink(realm, hooks, alwaysPromise);
  let resources: DisposalResource<unknown>[] | undefined;
  try {
    resources = takeDisposalResources<unknown>(extract());
  } catch (error) {
    if (!alwaysPromise) throw error;
    capability.reject(error);
    return { suspended: true, value: capability.value };
  }
  if (resources === undefined) {
    if (!alwaysPromise) {
      if (failed) throw value;
      return { suspended: false, value: undefined };
    }
    if (failed) capability.reject(value);
    else capability.resolve(undefined);
    return { suspended: true, value: capability.value };
  }
  const pending = resources,
    state = {
      index: resources.length - 1,
      needsAwait: false,
      hasAwaited: false,
      suspended: false,
    },
    failure: DisposalFailure = { failed, value };
  function settle(): void {
    if (!alwaysPromise && !state.suspended) return;
    if (failure.failed) capability.reject(failure.value);
    else capability.resolve(undefined);
  }
  function drain(): void {
    while (state.index >= 0) {
      const resource = pending[state.index--];
      if (resource === undefined) throw "ASYNC_DISPOSAL_RESOURCE_INVARIANT";
      if (resource.hint === "sync" && state.needsAwait && !state.hasAwaited) {
        // Resume this resource only after the empty async registration's await.
        state.index++;
        state.needsAwait = false;
        awaitScriptValue(
          undefined,
          (value): void => {
            drain();
          },
          (error): void => {
            rememberFailure(failure, error, realm, hooks);
            drain();
          },
          realm,
          hooks,
          capability.protocol,
        );
        state.suspended = true;
        return;
      }
      if (resource.method === undefined) {
        state.needsAwait = true;
        continue;
      }
      let value: unknown;
      try {
        value = hooks.call(resource.method, resource.value, []);
      } catch (error) {
        rememberFailure(failure, error, realm, hooks);
        continue;
      }
      if (resource.hint === "sync") continue;
      state.hasAwaited = true;
      try {
        awaitScriptValue(
          value,
          (value): void => {
            drain();
          },
          (error): void => {
            rememberFailure(failure, error, realm, hooks);
            drain();
          },
          realm,
          hooks,
          capability.protocol,
        );
        state.suspended = true;
        return;
      } catch (error) {
        rememberFailure(failure, error, realm, hooks);
      }
    }
    if (state.needsAwait && !state.hasAwaited) {
      state.hasAwaited = true;
      try {
        awaitScriptValue(
          undefined,
          (value): void => {
            settle();
          },
          (error): void => {
            rememberFailure(failure, error, realm, hooks);
            settle();
          },
          realm,
          hooks,
          capability.protocol,
        );
        state.suspended = true;
        return;
      } catch (error) {
        rememberFailure(failure, error, realm, hooks);
      }
    }
    settle();
  }
  drain();
  if (!alwaysPromise && !state.suspended) {
    if (failure.failed) throw failure.value;
    return { suspended: false, value: undefined };
  }
  return { suspended: true, value: capability.value };
}

export interface DisposalCompletion {
  readonly suspended: boolean;
  readonly value: unknown;
}
/** Stack disposal always returns an intrinsic Promise, including brand errors. */
export function disposeAsyncResources(
  extract: () => DisposalStack<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  failed: boolean,
  value: unknown,
): unknown {
  return beginAsyncDisposal(extract, realm, hooks, failed, value, true).value;
}
/** Lexical cleanup only suspends if execution actually reaches an Await. */
export function disposeMixedLexicalResources(
  stack: DisposalStack<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  failed: boolean,
  value: unknown,
): DisposalCompletion {
  return beginAsyncDisposal(
    (): DisposalStack<unknown> => stack,
    realm,
    hooks,
    failed,
    value,
    false,
  );
}
