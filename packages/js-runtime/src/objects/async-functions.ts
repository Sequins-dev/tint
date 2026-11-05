import {
  createResolvingFunctions,
  type PromiseResolvingFunctions,
  type PromiseHooks,
} from "../promises/index.ts";
import type { GeneratorResumeKind } from "../iterators/index.ts";
import type { GeneratorContinuation } from "./generators.ts";
import { awaitScriptValue } from "./await.ts";
import { createPromiseObject, createScriptPromiseHooks } from "./promises.ts";
import {
  createCallableObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinProperty } from "./intrinsics.ts";
import { createSourceExecutionContext, runScriptContext } from "./jobs.ts";
import { makeMethod } from "./methods.ts";
import type { SourceFunctionCall } from "./functions.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

type AsyncBody = (
  receiver: unknown,
  args: readonly unknown[],
  callee: unknown,
  functions: PromiseResolvingFunctions<unknown>,
  protocol: PromiseHooks<unknown>,
) => void;

/** Direct call boundary for an async body proven not to suspend. */
export function createSourceAsyncFunction(
  implementation: SourceFunctionCall,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  return createAsyncFunction(
    (receiver, args, callee, functions, protocol): void => {
      functions.resolve(implementation(receiver, args, callee, undefined));
    },
    realm,
    hooks,
    name,
    length,
    home,
    undefined,
  );
}

/** Dynamic async bodies can supply a carrier-owned promise without adding
 * promise adoption jobs. Undefined selects the existing non-suspending body. */
export function createSourceAsyncDispatchFunction(
  delegate: (
    receiver: unknown,
    args: readonly unknown[],
    callee: unknown,
  ) => OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  implementation: (receiver: unknown, args: readonly unknown[]) => unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  return createAsyncFunction(
    (receiver, args, _callee, functions, _protocol): void => {
      functions.resolve(implementation(receiver, args));
    },
    realm,
    hooks,
    name,
    length,
    undefined,
    delegate,
  );
}

/** Native segments use the generator continuation contract. A yield carries the
 * awaited value directly; it is not an observable iterator-result object. */
export function createSourceAsyncContinuationFunction(
  initialize: (
    receiver: unknown,
    args: readonly unknown[],
    callee: unknown,
    newTarget: unknown,
  ) => GeneratorContinuation,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  return createAsyncFunction(
    (receiver, args, callee, functions, protocol): void => {
      const active = realm.agent.activeContext;
      const scriptOrModule =
        active === undefined ? undefined : active.scriptOrModule;
      const initial = initialize(receiver, args, callee, undefined);
      runAsyncContinuation(
        initial,
        functions,
        realm,
        hooks,
        protocol,
        scriptOrModule,
      );
    },
    realm,
    hooks,
    name,
    length,
    home,
    undefined,
  );
}

/** Drive an existing continuation with the caller's resolving functions. This
 * keeps async functions and module execution on the same await/job protocol. */
export function runAsyncContinuation(
  initial: GeneratorContinuation,
  functions: PromiseResolvingFunctions<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  protocol: PromiseHooks<unknown>,
  scriptOrModule: unknown,
): void {
  const context = { realm, scriptOrModule };
  let continuation: GeneratorContinuation | undefined = initial;
  function resume(kind: GeneratorResumeKind, value: unknown): void {
    runScriptContext<unknown>(realm.agent, context, (): unknown => {
      try {
        while (true) {
          const segment = continuation;
          if (segment === undefined) return undefined;
          const outcome = segment(kind, value);
          if (outcome.kind === "return") {
            continuation = undefined;
            functions.resolve(outcome.value);
            return undefined;
          }
          try {
            awaitScriptValue(
              outcome.result,
              (result): void => resume("next", result),
              (error): void => resume("throw", error),
              realm,
              hooks,
              protocol,
            );
          } catch (error) {
            // Setup can fail before suspension; preserve local catch/finally.
            kind = "throw";
            value = error;
            continue;
          }
          return undefined;
        }
      } catch (error) {
        continuation = undefined;
        functions.reject(error);
        return undefined;
      }
    });
  }
  resume("next", undefined);
}

function createAsyncFunction(
  body: AsyncBody,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string,
  length: number,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  delegate:
    | ((
        receiver: unknown,
        args: readonly unknown[],
        callee: unknown,
      ) => OrdinaryObject<ScriptPropertyKey, unknown> | undefined)
    | undefined,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const protocol = createScriptPromiseHooks(
    realm,
    hooks,
    (promise, operation): void =>
      realm.promiseRejectionTracker(promise, operation),
  );
  const identity: { value: unknown } = { value: undefined };
  const fn = createCallableObject<ScriptPropertyKey, unknown>(
    realm.asyncFunctionPrototype,
    (receiver, args): unknown => {
      let failed = false;
      let failure: unknown = undefined;
      try {
        if (delegate !== undefined) {
          const promise = delegate(receiver, args, identity.value);
          if (promise !== undefined) return promise;
        }
      } catch (error) {
        failed = true;
        failure = error;
      }
      const promise = createPromiseObject(realm.promisePrototype);
      const record = promise.internalPromiseData;
      if (record === undefined) throw "ASYNC_PROMISE_INVARIANT";
      const functions = createResolvingFunctions<unknown>(record, protocol);
      try {
        if (failed) functions.reject(failure);
        else body(receiver, args, identity.value, functions, protocol);
      } catch (error) {
        functions.reject(error);
      }
      return promise;
    },
    createSourceExecutionContext(realm),
  );
  identity.value = fn;
  if (home !== undefined) makeMethod<ScriptPropertyKey, unknown>(fn, home);
  builtinProperty(fn, "length", length, false, true, hooks);
  builtinProperty(fn, "name", name, false, true, hooks);
  return fn;
}
