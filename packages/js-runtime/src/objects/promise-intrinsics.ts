import { speciesConstructor } from "./species.ts";
import { constructorPrototype } from "./functions.ts";
import { combinePromises } from "./promise-combinators.ts";
import {
  createResolvingFunctions,
  performPromiseThen,
  type PromiseRecord,
} from "../promises/index.ts";
import {
  createConstructorObject,
  createObject,
  createDataProperty,
  getProperty,
  defineOwnProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { callObject, isCallableObject } from "./call.ts";
import { viewObjectValue, getObjectValueProperty } from "./values.ts";
import {
  createPromiseObject,
  createScriptPromiseHooks,
  createScriptResolvingFunctions,
} from "./promises.ts";
import { newPromiseCapability, promiseResolve } from "./promise-capability.ts";

export function installPromiseIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  rejectionTracker: (
    promise: PromiseRecord<unknown>,
    operation: "reject" | "handle",
  ) => void,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const existing = realm.promiseConstructor;
  if (existing !== undefined) {
    builtinProperty(global, "Promise", existing, true, true, hooks);
    return existing;
  }
  realm.promiseRejectionTracker = rejectionTracker;
  const protocol = createScriptPromiseHooks(
    realm,
    hooks,
    (promise, operation): void =>
      realm.promiseRejectionTracker(promise, operation),
  );
  function typeError(): never {
    throw createRuntimeError(realm, "type");
  }
  function invoke(
    fn: unknown,
    receiver: unknown,
    args: readonly unknown[],
  ): unknown {
    const result = callObject<ScriptPropertyKey, unknown>(
      viewObjectValue(fn, realm.objectPrototype),
      receiver,
      args,
      undefined,
    );
    if (result.error !== "none") return typeError();
    return result.value;
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => typeError(),
    (args, newTarget): unknown => {
      const executor = args[0];
      if (
        !isCallableObject<ScriptPropertyKey, unknown>(
          viewObjectValue(executor, realm.objectPrototype),
        )
      )
        return typeError();
      const prototype = constructorPrototype(
        newTarget,
        "promise",
        realm,
        hooks,
      );
      const promise = createPromiseObject(prototype);
      const record = promise.internalPromiseData;
      if (record === undefined) throw "PROMISE_ALLOCATION_INVARIANT";
      const functions = createResolvingFunctions<unknown>(record, protocol);
      const pair = createScriptResolvingFunctions(functions, realm, hooks);
      try {
        invoke(executor, undefined, [pair.resolve, pair.reject]);
      } catch (error) {
        functions.reject(error);
      }
      return promise;
    },
  );
  realm.promiseConstructor = constructor;
  builtinFunctionMetadata(constructor, "Promise", 1, hooks);
  builtinProperty(
    constructor,
    "prototype",
    realm.promisePrototype,
    false,
    false,
    hooks,
  );
  builtinProperty(
    realm.promisePrototype,
    "constructor",
    constructor,
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.promisePrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Promise",
    false,
    true,
    hooks,
  );
  const species = builtinFunction(
    realm.functionPrototype,
    "get [Symbol.species]",
    0,
    (receiver, args): unknown => receiver,
    hooks,
  );
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      constructor,
      wellKnownSymbol(realm.symbolRegistry, "species"),
      {
        fields: 52,
        value: undefined,
        writable: false,
        get: species,
        set: undefined,
        enumerable: false,
        configurable: true,
      },
      hooks,
    ) !== "accepted"
  )
    throw "PROMISE_SPECIES_INVARIANT";
  const then = builtinFunction(
    realm.functionPrototype,
    "then",
    2,
    (receiver, args): unknown => {
      const promise = viewObjectValue(receiver, realm.objectPrototype);
      if (promise === undefined) return typeError();
      const record = promise.internalPromiseData;
      if (record === undefined) return typeError();
      const selected = speciesConstructor(promise, constructor, realm, hooks);
      const capability = newPromiseCapability(selected, realm, hooks);
      performPromiseThen<unknown>(
        record,
        args[0],
        args[1],
        capability,
        protocol,
      );
      return capability.promise;
    },
    hooks,
  );
  builtinProperty(realm.promisePrototype, "then", then, true, true, hooks);
  builtinProperty(
    realm.promisePrototype,
    "catch",
    builtinFunction(
      realm.functionPrototype,
      "catch",
      1,
      (receiver, args): unknown => {
        return invokeThen(receiver, [undefined, args[0]]);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function invokeThen(receiver: unknown, args: readonly unknown[]): unknown {
    const method = getObjectValueProperty(receiver, "then", hooks, realm);
    if (method.error === "unsupported") rejectUnsupportedExecution(realm);
    if (method.error !== "none") return typeError();
    return invoke(method.value, receiver, args);
  }
  builtinProperty(
    realm.promisePrototype,
    "finally",
    builtinFunction(
      realm.functionPrototype,
      "finally",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) return typeError();
        const selected = speciesConstructor(object, constructor, realm, hooks);
        const callback = args[0];
        if (
          !isCallableObject<ScriptPropertyKey, unknown>(
            viewObjectValue(callback, realm.objectPrototype),
          )
        )
          return invokeThen(receiver, [callback, callback]);
        function handler(
          rejected: boolean,
        ): OrdinaryObject<ScriptPropertyKey, unknown> {
          return builtinFunction(
            realm.functionPrototype,
            "",
            1,
            (ignored, values): unknown => {
              const value = values[0];
              const result = invoke(callback, undefined, []);
              const promise = promiseResolve(selected, result, realm, hooks);
              const continuation = builtinFunction(
                realm.functionPrototype,
                "",
                0,
                (receiver, args): unknown => {
                  if (rejected) throw value;
                  return value;
                },
                hooks,
              );
              return invokeThen(promise, [continuation]);
            },
            hooks,
          );
        }
        return invokeThen(receiver, [handler(false), handler(true)]);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "resolve",
    builtinFunction(
      realm.functionPrototype,
      "resolve",
      1,
      (receiver, args): unknown => {
        return promiseResolve(receiver, args[0], realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "reject",
    builtinFunction(
      realm.functionPrototype,
      "reject",
      1,
      (receiver, args): unknown => {
        const capability = newPromiseCapability(receiver, realm, hooks);
        capability.reject(args[0]);
        return capability.promise;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "try",
    builtinFunction(
      realm.functionPrototype,
      "try",
      1,
      (receiver, args): unknown => {
        if (viewObjectValue(receiver, realm.objectPrototype) === undefined)
          return typeError();
        // The callback runs before the constructor is consulted; a normal
        // result goes through PromiseResolve, so same-constructor promises
        // are returned unwrapped.
        let value: unknown;
        try {
          value = invoke(args[0], undefined, args.slice(1));
        } catch (reason) {
          const capability = newPromiseCapability(receiver, realm, hooks);
          capability.reject(reason);
          return capability.promise;
        }
        return promiseResolve(receiver, value, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "race",
    builtinFunction(
      realm.functionPrototype,
      "race",
      1,
      (receiver, args): unknown =>
        combinePromises("race", receiver, args[0], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "all",
    builtinFunction(
      realm.functionPrototype,
      "all",
      1,
      (receiver, args): unknown =>
        combinePromises("all", receiver, args[0], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "allSettled",
    builtinFunction(
      realm.functionPrototype,
      "allSettled",
      1,
      (receiver, args): unknown =>
        combinePromises("allSettled", receiver, args[0], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "any",
    builtinFunction(
      realm.functionPrototype,
      "any",
      1,
      (receiver, args): unknown =>
        combinePromises("any", receiver, args[0], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "withResolvers",
    builtinFunction(
      realm.functionPrototype,
      "withResolvers",
      0,
      (receiver, args): unknown => {
        const capability = newPromiseCapability(receiver, realm, hooks);
        const result = createObject<ScriptPropertyKey, unknown>(
          realm.objectPrototype,
        );
        if (
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            "promise",
            capability.promise,
            hooks,
          ) ||
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            "resolve",
            capability.resolveFunction,
            hooks,
          ) ||
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            "reject",
            capability.rejectFunction,
            hooks,
          )
        )
          throw "PROMISE_CAPABILITY_RESULT_INVARIANT";
        return result;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "Promise", constructor, true, true, hooks);
  return constructor;
}
