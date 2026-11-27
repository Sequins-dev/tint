import { installArrayFromAsync } from "./array-from-async.ts";
import { getIteratorFromMethod } from "../iterators/index.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import { createArrayObject } from "./arrays.ts";
import { toObjectValue } from "./boxing.ts";
import { constructObject } from "./call.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createScriptIteratorHooks,
  closeScriptIterator,
  stepScriptIterator,
  type ScriptIterator,
} from "./iteration.ts";
import {
  createDataProperty,
  getProperty,
  setProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { getObjectValueProperty, viewObjectValue } from "./values.ts";

/** Constructor-generic factories share construction and property semantics;
 * iterable traversal retains its distinct IteratorClose boundary. */
export function installArrayFactories(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const iteratorHooks = createScriptIteratorHooks(realm, hooks);
  function create(
    receiver: unknown,
    length: number,
    iterable: boolean,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const target = viewObjectValue(receiver, realm.objectPrototype);
    if (
      target === undefined ||
      target.internalRareSlots?.internalConstruct === undefined
    )
      return createArrayObject<ScriptPropertyKey, unknown>(
        length,
        realm.arrayPrototype,
        realm.arrayHooks,
        hooks,
      );
    const result = constructObject<ScriptPropertyKey, unknown>(
      target,
      iterable ? [] : [length],
      { object: target, value: receiver },
      undefined,
    );
    const object = viewObjectValue(result.value, realm.objectPrototype);
    if (result.error !== "none" || object === undefined)
      throw createRuntimeError(realm, "type");
    return object;
  }
  function define(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    index: number,
    value: unknown,
  ): void {
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        object,
        String(index),
        value,
        hooks,
      )
    )
      throw createRuntimeError(realm, "type");
  }
  function finish(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    length: number,
  ): unknown {
    if (
      !setProperty<ScriptPropertyKey, unknown>(
        object,
        "length",
        length,
        { object, value: object },
        hooks,
      )
    )
      throw createRuntimeError(realm, "type");
    return object;
  }
  const of = builtinFunction(
    realm.functionPrototype,
    "of",
    0,
    (receiver, args): unknown => {
      const result = create(receiver, args.length, false);
      for (let index = 0; index < args.length; index++)
        define(result, index, args[index]);
      return finish(result, args.length);
    },
    hooks,
  );
  builtinProperty(constructor, "of", of, true, true, hooks);
  const from = builtinFunction(
    realm.functionPrototype,
    "from",
    1,
    (receiver, args): unknown => {
      const input = args[0],
        mapper = args[1];
      if (mapper !== undefined && !iteratorHooks.isCallable(mapper))
        throw createRuntimeError(realm, "type");
      const method = getObjectValueProperty(
        input,
        wellKnownSymbol(realm.symbolRegistry, "iterator"),
        hooks,
        realm,
      );
      if (method.error === "unsupported") rejectUnsupportedExecution(realm);
      if (method.error !== "none") throw createRuntimeError(realm, "type");
      if (!iteratorHooks.isNullish(method.value)) {
        if (!iteratorHooks.isCallable(method.value))
          throw createRuntimeError(realm, "type");
        const result = create(receiver, 0, true);
        const iterator: ScriptIterator = {
          record: getIteratorFromMethod<unknown>(
            input,
            method.value,
            iteratorHooks,
          ),
          hooks: iteratorHooks,
        };
        let index = 0;
        while (true) {
          if (index >= 9007199254740991) {
            closeScriptIterator(iterator, true);
            throw createRuntimeError(realm, "type");
          }
          // Failures in next/done/value are not IteratorClose sites.
          const step = stepScriptIterator(iterator);
          if (step.done) return finish(result, index);
          try {
            const value =
              mapper === undefined
                ? step.value
                : iteratorHooks.call(mapper, args[2], [step.value, index]);
            define(result, index, value);
          } catch (error) {
            closeScriptIterator(iterator, true);
            throw error;
          }
          index++;
        }
      }
      const source = toObjectValue(input, realm, hooks);
      const length = lengthOfArrayLike(source, realm, hooks);
      const result = create(receiver, length, false);
      for (let index = 0; index < length; index++) {
        const value = getProperty<ScriptPropertyKey, unknown>(
          source,
          String(index),
          source,
          hooks,
        );
        define(
          result,
          index,
          mapper === undefined
            ? value
            : iteratorHooks.call(mapper, args[2], [value, index]),
        );
      }
      return finish(result, length);
    },
    hooks,
  );
  builtinProperty(constructor, "from", from, true, true, hooks);
  installArrayFromAsync(constructor, realm, hooks, { create, define, finish });
}
