import {
  getIteratorFromMethod,
  type IteratorHooks,
} from "../iterators/index.ts";
import {
  createResolvingFunctions,
  type PromiseHooks,
  type PromiseResolvingFunctions,
} from "../promises/index.ts";
import { awaitScriptValue } from "./await.ts";
import { createPromiseObject, createScriptPromiseHooks } from "./promises.ts";
import {
  createAsyncFromSyncIterator,
  nextScriptAsyncIterator,
  finishScriptAsyncIteratorStep,
  beginScriptAsyncIteratorClose,
} from "./async-iteration.ts";
import { createScriptIteratorHooks, type ScriptIterator } from "./iteration.ts";
import { toObjectValue } from "./boxing.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import { getObjectValueProperty } from "./values.ts";
import {
  exoticSlots,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ArrayFactoryOperations } from "./array-factory-operations.ts";
interface AsyncArrayState {
  readonly result: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly source: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  readonly length: number;
  readonly iterator: ScriptIterator | undefined;
  readonly iteratorHooks: IteratorHooks<unknown>;
  readonly mapper: unknown;
  readonly thisArg: unknown;
  readonly resolving: PromiseResolvingFunctions<unknown>;
  readonly protocol: PromiseHooks<unknown>;
  readonly realm: ErrorRealm;
  readonly hooks: ObjectHooks<unknown>;
  readonly factory: ArrayFactoryOperations;
}
/** One sequential collector owns each suspended operation. The callbacks retain
 * the owned state through Promise jobs; iterable and array-like values have
 * distinct Await boundaries. */
function collectAsyncArray(state: AsyncArrayState): void {
  let index = 0,
    settled = false;
  function wait(
    value: unknown,
    fulfilled: (value: unknown) => void,
    close: boolean,
  ): void {
    try {
      awaitScriptValue(
        value,
        (result): void => {
          try {
            fulfilled(result);
          } catch (error) {
            fail(error, close);
          }
        },
        (reason): void => fail(reason, close),
        state.realm,
        state.hooks,
        state.protocol,
      );
    } catch (error) {
      fail(error, close);
    }
  }
  function step(): void {
    if (settled) return;
    const iterator = state.iterator;
    try {
      if (iterator !== undefined) {
        if (index >= 9007199254740991) {
          fail(createRuntimeError(state.realm, "type"), true);
          return;
        }
        const next = nextScriptAsyncIterator(iterator);
        wait(
          next,
          (result): void => {
            const step = finishScriptAsyncIteratorStep(iterator, result);
            if (step.done) finish();
            else accept(step.value);
          },
          false,
        );
      } else {
        if (index >= state.length) {
          finish();
          return;
        }
        const source = state.source;
        if (source === undefined) throw "ASYNC_ARRAY_SOURCE_INVARIANT";
        const value = getProperty<ScriptPropertyKey, unknown>(
          source,
          String(index),
          source,
          state.hooks,
        );
        wait(value, (value): void => accept(value), false);
      }
    } catch (error) {
      fail(error, false);
    }
  }
  function accept(value: unknown): void {
    if (settled) return;
    const mapper = state.mapper;
    if (mapper === undefined) {
      store(value);
      return;
    }
    try {
      const mapped = state.iteratorHooks.call(mapper, state.thisArg, [
        value,
        index,
      ]);
      wait(mapped, (value): void => store(value), true);
    } catch (error) {
      fail(error, true);
    }
  }
  function store(value: unknown): void {
    if (settled) return;
    try {
      state.factory.define(state.result, index, value);
      index++;
      step();
    } catch (error) {
      fail(error, true);
    }
  }
  function finish(): void {
    try {
      const result = state.factory.finish(state.result, index);
      settled = true;
      state.resolving.resolve(result);
    } catch (error) {
      fail(error, false);
    }
  }
  function fail(reason: unknown, close: boolean): void {
    if (settled) return;
    settled = true;
    const iterator = state.iterator;
    if (!close || iterator === undefined) {
      state.resolving.reject(reason);
      return;
    }
    try {
      const closing = beginScriptAsyncIteratorClose(iterator);
      if (!closing.needed) {
        state.resolving.reject(reason);
        return;
      }
      // The original throw completion wins over closing errors, but a present
      // return result is still awaited before rejecting the outer Promise.
      awaitScriptValue(
        closing.value,
        (value) => state.resolving.reject(reason),
        (error) => state.resolving.reject(reason),
        state.realm,
        state.hooks,
        state.protocol,
      );
    } catch (error) {
      state.resolving.reject(reason);
    }
  }
  step();
}
function iteratorMethod(
  input: unknown,
  key: ScriptPropertyKey,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  iteratorHooks: IteratorHooks<unknown>,
): unknown {
  const result = getObjectValueProperty(input, key, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  if (iteratorHooks.isNullish(result.value)) return undefined;
  if (!iteratorHooks.isCallable(result.value))
    throw createRuntimeError(realm, "type");
  return result.value;
}
export function installArrayFromAsync(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  factory: ArrayFactoryOperations,
): void {
  const fn = builtinFunction(
    realm.functionPrototype,
    "fromAsync",
    1,
    (receiver, args): unknown => {
      const promise = createPromiseObject(realm.promisePrototype),
        record = exoticSlots(promise).internalPromiseData;
      if (record === undefined) throw "ASYNC_ARRAY_PROMISE_INVARIANT";
      const protocol = createScriptPromiseHooks(
        realm,
        hooks,
        (promise, operation): void =>
          realm.promiseRejectionTracker(promise, operation),
      );
      const resolving = createResolvingFunctions<unknown>(record, protocol);
      try {
        const input = args[0],
          mapper = args[1],
          iteratorHooks = createScriptIteratorHooks(realm, hooks);
        if (mapper !== undefined && !iteratorHooks.isCallable(mapper))
          throw createRuntimeError(realm, "type");
        const asyncMethod = iteratorMethod(
          input,
          wellKnownSymbol(realm.symbolRegistry, "asyncIterator"),
          realm,
          hooks,
          iteratorHooks,
        );
        let iterator: ScriptIterator | undefined = undefined;
        if (asyncMethod !== undefined)
          iterator = {
            record: getIteratorFromMethod<unknown>(
              input,
              asyncMethod,
              iteratorHooks,
            ),
            hooks: iteratorHooks,
          };
        else {
          const syncMethod = iteratorMethod(
            input,
            wellKnownSymbol(realm.symbolRegistry, "iterator"),
            realm,
            hooks,
            iteratorHooks,
          );
          if (syncMethod !== undefined)
            iterator = createAsyncFromSyncIterator(
              getIteratorFromMethod<unknown>(input, syncMethod, iteratorHooks),
              realm,
              hooks,
            );
        }
        const source =
          iterator === undefined
            ? toObjectValue(input, realm, hooks)
            : undefined;
        const length =
          source === undefined ? 0 : lengthOfArrayLike(source, realm, hooks);
        const result = factory.create(receiver, length, iterator !== undefined);
        collectAsyncArray({
          result,
          source,
          length,
          iterator,
          iteratorHooks,
          mapper,
          thisArg: args[2],
          resolving,
          protocol,
          realm,
          hooks,
          factory,
        });
      } catch (error) {
        resolving.reject(error);
      }
      return promise;
    },
    hooks,
  );
  builtinProperty(constructor, "fromAsync", fn, true, true, hooks);
}
