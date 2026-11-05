import { typedArraySpeciesCreate } from "./typed-array-species.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { storeTypedArrayElement } from "./typed-array-construction.ts";
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

export function installTypedArrayComposition(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  constructors: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>,
): void {
  function install(name: string, filter: boolean): void {
    builtinProperty(
      realm.typedArrayPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const data = requireTypedArray(receiver, realm),
            window = typedArrayWindow(data);
          if (window === undefined) throw createRuntimeError(realm, "type");
          if (
            !isCallableObject<ScriptPropertyKey, unknown>(
              viewObjectValue(args[0], realm.objectPrototype),
            )
          )
            throw createRuntimeError(realm, "type");
          const source = viewObjectValue(receiver, realm.objectPrototype);
          if (source === undefined) throw "TYPED_ARRAY_COMPOSITION_INVARIANT";
          const length = window.length;
          if (filter) {
            const values: unknown[] = [];
            for (let index = 0; index < length; index++) {
              const value = getProperty<ScriptPropertyKey, unknown>(
                source,
                String(index),
                receiver,
                hooks,
              );
              if (
                scriptBoolean(
                  hooks.call(args[0], args[1], [value, index, receiver]),
                  realm.objectPrototype,
                )
              )
                values.push(value);
            }
            // Filter selects values before any species constructor invocation.
            const target = typedArraySpeciesCreate(
              source,
              [values.length],
              constructors,
              realm,
              hooks,
              "write",
            );
            for (let index = 0; index < values.length; index++)
              storeTypedArrayElement(target, index, values[index], hooks);
            return target;
          }
          // Map allocates before reading elements or invoking its callback.
          const target = typedArraySpeciesCreate(
            source,
            [length],
            constructors,
            realm,
            hooks,
            "write",
          );
          for (let index = 0; index < length; index++) {
            const value = getProperty<ScriptPropertyKey, unknown>(
                source,
                String(index),
                receiver,
                hooks,
              ),
              mapped = hooks.call(args[0], args[1], [value, index, receiver]);
            storeTypedArrayElement(target, index, mapped, hooks);
          }
          return target;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  install("map", false);
  install("filter", true);
}
