import {
  createPromiseRecord,
  type PromiseRecord,
  type PromiseHooks,
  type PromiseCompletion,
  type PromiseResolvingFunctions,
} from "../promises/index.ts";
import {
  createObject,
  ensureExoticSlots,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectEngineAbort,
  type ErrorRealm,
} from "./errors.ts";
import { builtinFunction } from "./intrinsics.ts";
import { callObject, isCallableObject } from "./call.ts";
import { viewObjectValue } from "./values.ts";
import { createSourceExecutionContext, enqueueScriptJob } from "./jobs.ts";
import { getFunctionRealm } from "./function-realms.ts";

export interface ScriptResolvingFunctions {
  readonly resolve: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly reject: OrdinaryObject<ScriptPropertyKey, unknown>;
}

/** Only actual Promise allocations carry the private brand; prototypes do not. */
export function createPromiseObject(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const promise = createObject<ScriptPropertyKey, unknown>(prototype);
  ensureExoticSlots(promise).internalPromiseData = createPromiseRecord<unknown>(
    promise,
    undefined,
  );
  return promise;
}

export function createScriptResolvingFunctions(
  functions: PromiseResolvingFunctions<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ScriptResolvingFunctions {
  return {
    resolve: builtinFunction(
      realm.functionPrototype,
      "",
      1,
      (receiver, args): unknown => {
        functions.resolve(args[0]);
        return undefined;
      },
      hooks,
    ),
    reject: builtinFunction(
      realm.functionPrototype,
      "",
      1,
      (receiver, args): unknown => {
        functions.reject(args[0]);
        return undefined;
      },
      hooks,
    ),
  };
}

/** Adapt the representation-independent protocol to ordinary Script operations.
 * Resolution functions and thenable jobs can execute in different realms; errors
 * and fresh resolving functions use the currently entered realm in that agent. */
export function createScriptPromiseHooks(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  rejectionTracker: (
    promise: PromiseRecord<unknown>,
    operation: "reject" | "handle",
  ) => void,
): PromiseHooks<unknown> {
  function currentRealm(): ErrorRealm {
    const active = realm.agent.activeContext;
    return active === undefined ? realm : active.realm;
  }
  /** NewPromiseReactionJob/NewPromiseResolveThenableJob: GetFunctionRealm
   * follows bound and callable Proxy targets; a revoked Proxy falls back to the
   * realm current at enqueue. Built-ins without a realm context also resolve
   * to that current realm. */
  function jobRealm(
    callback: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): ErrorRealm {
    try {
      return getFunctionRealm(callback, realm);
    } catch {
      return currentRealm();
    }
  }
  function typeError(): unknown {
    return createRuntimeError(currentRealm(), "type");
  }
  function invoke(
    method: unknown,
    receiver: unknown,
    args: readonly unknown[],
  ): PromiseCompletion<unknown> {
    try {
      const object = viewObjectValue(method, realm.objectPrototype);
      const result = callObject<ScriptPropertyKey, unknown>(
        object,
        receiver,
        args,
        undefined,
      );
      if (result.error !== "none") return { kind: "throw", value: typeError() };
      return { kind: "normal", value: result.value };
    } catch (value) {
      return { kind: "throw", value };
    }
  }
  return {
    sameValue: hooks.sameValue,
    isObject: (value): boolean =>
      viewObjectValue(value, realm.objectPrototype) !== undefined,
    isCallable: (value): boolean =>
      isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(value, realm.objectPrototype),
      ),
    getThen: (value): PromiseCompletion<unknown> => {
      try {
        const object = viewObjectValue(value, realm.objectPrototype);
        if (object === undefined) return { kind: "throw", value: typeError() };
        return {
          kind: "normal",
          value: getProperty<ScriptPropertyKey, unknown>(
            object,
            "then",
            value,
            hooks,
          ),
        };
      } catch (value) {
        return { kind: "throw", value };
      }
    },
    callThen: (method, receiver, functions): PromiseCompletion<unknown> => {
      const pair = createScriptResolvingFunctions(
        functions,
        currentRealm(),
        hooks,
      );
      return invoke(method, receiver, [pair.resolve, pair.reject]);
    },
    callHandler: (handler, value): PromiseCompletion<unknown> =>
      invoke(handler, undefined, [value]),
    typeError,
    enqueue: (job, callback): void => {
      const object = viewObjectValue(callback, realm.objectPrototype);
      enqueueScriptJob(
        realm.agent,
        job,
        object === undefined
          ? undefined
          : createSourceExecutionContext(jobRealm(object)),
      );
    },
    rejectionTracker,
    checkRejection: (reason): unknown =>
      rejectEngineAbort(currentRealm(), reason),
  };
}
