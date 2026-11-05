import type { ScriptIterator } from "./iteration.ts";
import {
  createAsyncGeneratorRecord,
  createAsyncYieldDelegate,
  type AsyncGeneratorStep,
  type AsyncGeneratorStepOutcome,
  enqueueAsyncGenerator,
  type AsyncGeneratorContinuation,
  type AsyncGeneratorHooks,
  type AsyncGeneratorOutcome,
  type GeneratorResumeKind,
} from "../iterators/index.ts";
import { createResolvingFunctions } from "../promises/index.ts";
import {
  createObject,
  createCallableObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  createSourceExecutionContext,
  runScriptContext,
  type ScriptExecutionContext,
} from "./jobs.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { createPromiseObject, createScriptPromiseHooks } from "./promises.ts";
import { awaitScriptValue } from "./await.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { makeMethod } from "./methods.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

/** Take an unstarted hidden carrier; the outer generator owns all requests. */
export function takeAsyncGeneratorStart(
  value: unknown,
  realm: ErrorRealm,
): AsyncGeneratorContinuation<unknown> {
  const object = viewObjectValue(value, realm.objectPrototype);
  const slot = object?.internalAsyncGeneratorData;
  if (slot === undefined) throw "DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT";
  const record = slot.record;
  if (
    record.state !== "suspended-start" ||
    record.head !== undefined ||
    record.tail !== undefined ||
    record.running ||
    record.waiting ||
    record.pending !== undefined
  )
    throw "DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT";
  const continuation = record.continuation;
  if (continuation === undefined)
    throw "DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT";
  record.state = "completed";
  record.continuation = undefined;
  return continuation;
}

export function createSourceAsyncGeneratorFunction(
  initialize: (
    receiver: unknown,
    args: readonly unknown[],
    callee: unknown,
  ) => AsyncGeneratorContinuation<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const identity: { value: unknown } = { value: undefined };
  const fn = createCallableObject<ScriptPropertyKey, unknown>(
    realm.asyncGeneratorFunctionPrototype,
    (receiver, args): unknown => {
      const continuation = initialize(receiver, args, identity.value);
      const prototype = constructorPrototype(
        identity.value,
        "async-generator",
        realm,
        hooks,
      );
      return createAsyncGeneratorObject(continuation, realm, hooks, prototype);
    },
    createSourceExecutionContext(realm),
  );
  identity.value = fn;
  if (home !== undefined) makeMethod<ScriptPropertyKey, unknown>(fn, home);
  builtinProperty(fn, "length", length, false, true, hooks);
  builtinProperty(fn, "name", name, false, true, hooks);
  builtinProperty(
    fn,
    "prototype",
    createObject<ScriptPropertyKey, unknown>(realm.asyncGeneratorPrototype),
    true,
    false,
    hooks,
  );
  return fn;
}

export function createAsyncGeneratorObject(
  continuation: AsyncGeneratorContinuation<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const generator = createObject<ScriptPropertyKey, unknown>(
    prototype === undefined ? realm.asyncGeneratorPrototype : prototype,
  );
  const active = realm.agent.activeContext;
  const context: ScriptExecutionContext = {
    realm,
    scriptOrModule: active === undefined ? undefined : active.scriptOrModule,
  };
  const record = createAsyncGeneratorRecord<unknown>(
    (kind, value): AsyncGeneratorOutcome<unknown> =>
      runScriptContext<AsyncGeneratorOutcome<unknown>>(
        realm.agent,
        context,
        (): AsyncGeneratorOutcome<unknown> => continuation(kind, value),
      ),
  );
  const protocol: AsyncGeneratorHooks<unknown> = {
    undefinedValue: undefined,
    exceptionValue: (error): unknown => error,
    iteratorResult: (value, done): unknown => {
      // The continuation has restored its caller, matching CompleteStep's realm.
      const caller = realm.agent.activeContext;
      return createIteratorResult(
        value,
        done,
        caller === undefined ? realm : caller.realm,
        hooks,
      );
    },
    awaitValue: (value, fulfilled, rejected): void => {
      const caller = realm.agent.activeContext;
      // Body awaits and injected returns use the suspended generator context.
      // Completed-return draining instead executes in the current caller realm.
      const awaiting =
        record.state === "executing"
          ? context
          : caller === undefined
            ? context
            : caller;
      runScriptContext<unknown>(realm.agent, awaiting, (): unknown => {
        const targetRealm = awaiting.realm;
        const promises = createScriptPromiseHooks(
          targetRealm,
          hooks,
          (promise, operation): void =>
            targetRealm.promiseRejectionTracker(promise, operation),
        );
        awaitScriptValue(
          value,
          fulfilled,
          rejected,
          targetRealm,
          hooks,
          promises,
        );
        return undefined;
      });
    },
  };
  generator.internalAsyncGeneratorData = { record, hooks: protocol, context };
  return generator;
}

export function installAsyncGeneratorIntrinsics(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.asyncIteratorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "asyncIterator"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.asyncIterator]",
      0,
      (receiver, args): unknown => receiver,
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.asyncGeneratorFunctionPrototype,
    "prototype",
    realm.asyncGeneratorPrototype,
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.asyncGeneratorFunctionPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "AsyncGeneratorFunction",
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.asyncGeneratorPrototype,
    "constructor",
    realm.asyncGeneratorFunctionPrototype,
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.asyncGeneratorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "AsyncGenerator",
    false,
    true,
    hooks,
  );
  const kinds: GeneratorResumeKind[] = ["next", "return", "throw"];
  for (const kind of kinds) {
    if (kind === undefined) throw "ASYNC_GENERATOR_METHOD_INVARIANT";
    builtinProperty(
      realm.asyncGeneratorPrototype,
      kind,
      builtinFunction(
        realm.functionPrototype,
        kind,
        1,
        (receiver, args): unknown => {
          const promise = createPromiseObject(realm.promisePrototype);
          const promiseRecord = promise.internalPromiseData;
          if (promiseRecord === undefined)
            throw "ASYNC_GENERATOR_PROMISE_INVARIANT";
          const promises = createScriptPromiseHooks(
            realm,
            hooks,
            (item, operation): void =>
              realm.promiseRejectionTracker(item, operation),
          );
          const functions = createResolvingFunctions<unknown>(
            promiseRecord,
            promises,
          );
          const object = viewObjectValue(receiver, realm.objectPrototype);
          const slot =
            object === undefined
              ? undefined
              : object.internalAsyncGeneratorData;
          if (slot === undefined) {
            functions.reject(createRuntimeError(realm, "type"));
            return promise;
          }
          enqueueAsyncGenerator<unknown>(
            slot.record,
            kind,
            args[0],
            {
              resolve: (result): void => {
                if (slot.record.state === "executing") {
                  // Yield settles while the generator context is still active, even
                  // though its result object was created in the caller's realm.
                  runScriptContext<unknown>(
                    realm.agent,
                    slot.context,
                    (): unknown => {
                      functions.resolve(result);
                      return undefined;
                    },
                  );
                } else functions.resolve(result);
              },
              reject: functions.reject,
            },
            slot.hooks,
          );
          return promise;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}

/** Preserve the delegate across Await and yield, transferring to the following
 * source segment only when the yield* expression completes normally. */
export function createAsyncDelegatingContinuation(
  iterator: ScriptIterator,
  following: AsyncGeneratorStep<unknown>,
): AsyncGeneratorStep<unknown> {
  const resume = createAsyncYieldDelegate<unknown>(
    iterator.record,
    iterator.hooks,
  );
  return (kind, value): AsyncGeneratorStepOutcome<unknown> => {
    const outcome = resume(kind, value);
    if (outcome.kind === "normal")
      return {
        kind: "transfer",
        next: following,
        inputKind: "next",
        value: outcome.value,
      };
    if (outcome.kind === "await")
      return { kind: "await", value: outcome.value };
    if (outcome.kind === "yield")
      return { kind: "yield", value: outcome.value };
    return { kind: "return", value: outcome.value };
  };
}
