import {
  createObject,
  hasPrototype,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  viewObjectValue,
  callObjectValue,
  getObjectValueProperty,
} from "./values.ts";
import { getScriptIteratorFlattenable } from "./iteration.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

export function installIteratorFrom(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = createObject<ScriptPropertyKey, unknown>(
    realm.iteratorPrototype,
  );
  for (const name of ["next", "return"]) {
    if (name === undefined) throw "ITERATOR_WRAPPER_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          const object = viewObjectValue(receiver, realm.objectPrototype);
          const record =
            object === undefined
              ? undefined
              : object.internalWrappedIteratorData;
          if (record === undefined) throw createRuntimeError(realm, "type");
          let method = record.nextMethod;
          if (name === "return") {
            const read = getObjectValueProperty(
              record.iterator,
              "return",
              hooks,
              realm,
            );
            if (read.error === "unsupported")
              return rejectUnsupportedExecution(realm);
            if (read.error !== "none") throw createRuntimeError(realm, "type");
            method = read.value;
            if (method === undefined || method === null)
              return createIteratorResult(undefined, true, realm, hooks);
          }
          // These wrappers forward without validating result objects or passing
          // arguments; protocol consumers perform their own result checks.
          const called = callObjectValue(
            method,
            record.iterator,
            [],
            realm.objectPrototype,
          );
          if (called.error !== "none") throw createRuntimeError(realm, "type");
          return called.value;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(
    constructor,
    "from",
    builtinFunction(
      realm.functionPrototype,
      "from",
      1,
      (receiver, args): unknown => {
        const iterator = getScriptIteratorFlattenable(
          args[0],
          "iterate",
          realm,
          hooks,
        );
        const object = viewObjectValue(
          iterator.record.iterator,
          realm.objectPrototype,
        );
        if (object === undefined) throw "FLATTENABLE_ITERATOR_OBJECT_INVARIANT";
        if (
          hasPrototype<ScriptPropertyKey, unknown>(
            object,
            realm.iteratorPrototype,
          )
        )
          return object;
        const wrapper = createObject<ScriptPropertyKey, unknown>(prototype);
        wrapper.internalWrappedIteratorData = iterator.record;
        return wrapper;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
