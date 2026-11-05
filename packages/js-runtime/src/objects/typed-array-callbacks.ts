import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { viewObjectValue, scriptBoolean } from "./values.ts";
import { isCallableObject } from "./call.ts";
import {
  getProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";

/** Capture the internal length, then read every index even if callbacks shrink
 * or detach storage. Unlike Array iteration, there is no HasProperty step. */
export function installTypedArrayCallbacks(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function validate(
    receiver: unknown,
    callback: unknown,
  ): {
    readonly object: OrdinaryObject<ScriptPropertyKey, unknown>;
    readonly length: number;
  } {
    const data = requireTypedArray(receiver, realm),
      window = typedArrayWindow(data);
    if (window === undefined) throw createRuntimeError(realm, "type");
    if (
      !isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(callback, realm.objectPrototype),
      )
    )
      throw createRuntimeError(realm, "type");
    const object = viewObjectValue(receiver, realm.objectPrototype);
    if (object === undefined) throw "TYPED_ARRAY_CALLBACK_INVARIANT";
    return { object, length: window.length };
  }
  function iteration(
    name: string,
    reverse: boolean,
    find: boolean,
    returnIndex: boolean,
  ): void {
    builtinProperty(
      realm.typedArrayPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const source = validate(receiver, args[0]);
          let index = reverse ? source.length - 1 : 0;
          while (index >= 0 && index < source.length) {
            const value = getProperty<ScriptPropertyKey, unknown>(
                source.object,
                String(index),
                receiver,
                hooks,
              ),
              result = hooks.call(args[0], args[1], [value, index, receiver]);
            if (find && scriptBoolean(result, realm.objectPrototype))
              return returnIndex ? index : value;
            if (
              name === "every" &&
              !scriptBoolean(result, realm.objectPrototype)
            )
              return false;
            if (name === "some" && scriptBoolean(result, realm.objectPrototype))
              return true;
            index += reverse ? -1 : 1;
          }
          if (find) return returnIndex ? -1 : undefined;
          if (name === "every") return true;
          if (name === "some") return false;
          return undefined;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  iteration("every", false, false, false);
  iteration("some", false, false, false);
  iteration("forEach", false, false, false);
  iteration("find", false, true, false);
  iteration("findIndex", false, true, true);
  iteration("findLast", true, true, false);
  iteration("findLastIndex", true, true, true);
  function reduction(name: string, reverse: boolean): void {
    builtinProperty(
      realm.typedArrayPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const source = validate(receiver, args[0]),
            step = reverse ? -1 : 1;
          let index = reverse ? source.length - 1 : 0,
            accumulator = args[1];
          if (args.length < 2) {
            if (source.length === 0) throw createRuntimeError(realm, "type");
            accumulator = getProperty<ScriptPropertyKey, unknown>(
              source.object,
              String(index),
              receiver,
              hooks,
            );
            index += step;
          }
          while (index >= 0 && index < source.length) {
            const value = getProperty<ScriptPropertyKey, unknown>(
              source.object,
              String(index),
              receiver,
              hooks,
            );
            accumulator = hooks.call(args[0], undefined, [
              accumulator,
              value,
              index,
              receiver,
            ]);
            index += step;
          }
          return accumulator;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  reduction("reduce", false);
  reduction("reduceRight", true);
}
