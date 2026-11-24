import {
  getIteratorFromMethod,
  resumeAsyncFromSyncIterator,
  type IteratorRecord,
  type GeneratorResumeKind,
  type AsyncIteratorHooks,
} from "../iterators/index.ts";
import { createResolvingFunctions } from "../promises/index.ts";
import {
  createScriptIteratorHooks,
  getScriptIterator,
  type ScriptIterator,
} from "./iteration.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  getProperty,
  type ObjectHooks,
} from "./operations.ts";
import { getObjectValueProperty, viewObjectValue } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { createPromiseObject, createScriptPromiseHooks } from "./promises.ts";
import { awaitScriptValue } from "./await.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

/** GetIterator(async) prefers @@asyncIterator. Only a missing/null method falls
 * back to synchronous iteration; a non-callable method is a protocol error. */
export function getScriptAsyncIterator(
  value: unknown,
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const method = getObjectValueProperty(
    value,
    wellKnownSymbol(realm.symbolRegistry, "asyncIterator"),
    objectHooks,
    realm,
  );
  if (method.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (method.error !== "none") throw createRuntimeError(realm, "type");
  if (method.value === undefined || method.value === null) {
    const sync = getScriptIterator(value, realm, objectHooks);
    return createAsyncFromSyncIterator(sync.record, realm, objectHooks);
  }
  const hooks = createScriptIteratorHooks(realm, objectHooks);
  return {
    record: getIteratorFromMethod<unknown>(value, method.value, hooks),
    hooks,
  };
}

export function createAsyncFromSyncIterator(
  record: IteratorRecord<unknown>,
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const wrapper = createObject<ScriptPropertyKey, unknown>(
    realm.asyncFromSyncIteratorPrototype,
  );
  ensureExoticSlots(wrapper).internalSyncIteratorData = record;
  return {
    record: {
      iterator: wrapper,
      nextMethod: getProperty<ScriptPropertyKey, unknown>(
        wrapper,
        "next",
        wrapper,
        objectHooks,
      ),
      done: false,
    },
    hooks: createScriptIteratorHooks(realm, objectHooks),
  };
}

export function installAsyncFromSyncIntrinsics(
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): void {
  const iteratorHooks = createScriptIteratorHooks(realm, objectHooks);
  const promises = createScriptPromiseHooks(
    realm,
    objectHooks,
    (promise, operation): void =>
      realm.promiseRejectionTracker(promise, operation),
  );
  builtinProperty(
    realm.asyncIteratorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "asyncDispose"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.asyncDispose]",
      0,
      (receiver, args): unknown => {
        const promise = createPromiseObject(realm.promisePrototype);
        const record = promise.internalPromiseData;
        if (record === undefined) throw "ASYNC_DISPOSE_PROMISE_INVARIANT";
        const functions = createResolvingFunctions<unknown>(record, promises);
        try {
          const method = iteratorHooks.get(receiver, "return");
          if (iteratorHooks.isNullish(method)) functions.resolve(undefined);
          else {
            if (!iteratorHooks.isCallable(method))
              throw createRuntimeError(realm, "type");
            const result = iteratorHooks.call(method, receiver, []);
            awaitScriptValue(
              result,
              (value): void => functions.resolve(undefined),
              functions.reject,
              realm,
              objectHooks,
              promises,
            );
          }
        } catch (error) {
          functions.reject(error);
        }
        return promise;
      },
      objectHooks,
    ),
    true,
    true,
    objectHooks,
  );
  const hooks: AsyncIteratorHooks<unknown> = {
    undefinedValue: undefined,
    exceptionValue: (error): unknown => error,
    get: iteratorHooks.get,
    call: iteratorHooks.call,
    isObject: iteratorHooks.isObject,
    isCallable: iteratorHooks.isCallable,
    isNullish: iteratorHooks.isNullish,
    truthy: iteratorHooks.truthy,
    typeError: iteratorHooks.typeError,
    iteratorResult: (value, done): unknown =>
      createIteratorResult(value, done, realm, objectHooks),
    awaitValue: (value, fulfilled, rejected): void =>
      awaitScriptValue(
        value,
        fulfilled,
        rejected,
        realm,
        objectHooks,
        promises,
      ),
  };
  const kinds: GeneratorResumeKind[] = ["next", "return", "throw"];
  for (const kind of kinds) {
    if (kind === undefined) throw "ASYNC_FROM_SYNC_METHOD_INVARIANT";
    builtinProperty(
      realm.asyncFromSyncIteratorPrototype,
      kind,
      builtinFunction(
        realm.functionPrototype,
        kind,
        1,
        (receiver, args): unknown => {
          const promise = createPromiseObject(realm.promisePrototype);
          const promiseRecord = promise.internalPromiseData;
          if (promiseRecord === undefined)
            throw "ASYNC_FROM_SYNC_PROMISE_INVARIANT";
          const functions = createResolvingFunctions<unknown>(
            promiseRecord,
            promises,
          );
          const object = viewObjectValue(receiver, realm.objectPrototype);
          const sync =
            object === undefined
              ? undefined
              : exoticSlots(object).internalSyncIteratorData;
          if (sync === undefined)
            functions.reject(createRuntimeError(realm, "type"));
          else
            resumeAsyncFromSyncIterator<unknown>(
              sync,
              kind,
              args,
              functions,
              hooks,
            );
          return promise;
        },
        objectHooks,
      ),
      true,
      true,
      objectHooks,
    );
  }
}

/** Leave Done set until next/result/value extraction succeeds. A failure in
 * those steps must not trigger the loop body's IteratorClose path. */
export function nextScriptAsyncIterator(iterator: ScriptIterator): unknown {
  iterator.record.done = true;
  return iterator.hooks.call(
    iterator.record.nextMethod,
    iterator.record.iterator,
    [],
  );
}
export function finishScriptAsyncIteratorStep(
  iterator: ScriptIterator,
  result: unknown,
): { readonly done: boolean; readonly value: unknown } {
  const hooks = iterator.hooks;
  if (!hooks.isObject(result)) throw hooks.typeError();
  if (hooks.truthy(hooks.get(result, "done")))
    return { done: true, value: undefined };
  const value = hooks.get(result, "value");
  iterator.record.done = false;
  return { done: false, value };
}
/** The continuation awaits a present return result and then validates it. A
 * missing return or an already finished iterator must not introduce an await. */
export function beginScriptAsyncIteratorClose(iterator: ScriptIterator): {
  readonly needed: boolean;
  readonly value: unknown;
} {
  if (iterator.record.done) return { needed: false, value: undefined };
  iterator.record.done = true;
  const hooks = iterator.hooks;
  const method = hooks.get(iterator.record.iterator, "return");
  if (hooks.isNullish(method)) return { needed: false, value: undefined };
  if (!hooks.isCallable(method)) throw hooks.typeError();
  return {
    needed: true,
    value: hooks.call(method, iterator.record.iterator, []),
  };
}
export function finishScriptAsyncIteratorClose(
  iterator: ScriptIterator,
  result: unknown,
): void {
  if (!iterator.hooks.isObject(result)) throw iterator.hooks.typeError();
}
