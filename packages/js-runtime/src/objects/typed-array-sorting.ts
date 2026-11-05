import {
  sortIndexed,
  type IndexedAccess,
} from "@tint/foundation/collections/indexed-sort";
import { constructTypedArrayResult } from "./typed-array-result.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { storeTypedArrayElement } from "./typed-array-construction.ts";
import { numberValue } from "./coercion.ts";
import { viewBigIntValue, compareBigIntValues } from "./bigints.ts";
import { viewObjectValue } from "./values.ts";
import { isCallableObject } from "./call.ts";
import {
  getProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** Share stable indexed sorting with Array, while retaining numeric comparison. */
export function installTypedArraySorting(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  constructors: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>,
): void {
  function install(name: string, copying: boolean): void {
    builtinProperty(
      realm.typedArrayPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const comparator = args[0];
          if (
            comparator !== undefined &&
            !isCallableObject<ScriptPropertyKey, unknown>(
              viewObjectValue(comparator, realm.objectPrototype),
            )
          )
            throw createRuntimeError(realm, "type");
          const data = requireTypedArray(
              receiver,
              realm,
              copying ? "read" : "write",
            ),
            window = typedArrayWindow(data, copying ? "read" : "write");
          if (window === undefined) throw createRuntimeError(realm, "type");
          const source = viewObjectValue(receiver, realm.objectPrototype),
            constructor = constructors.get(data.kind);
          if (source === undefined || constructor === undefined)
            throw "TYPED_ARRAY_SORT_INVARIANT";
          const length = window.length,
            target = copying
              ? constructTypedArrayResult(constructor, [length], realm, "write")
              : source;
          const access: IndexedAccess<unknown> = {
            length: (): number => length,
            has: (index): boolean => true,
            read: (index): unknown =>
              getProperty<ScriptPropertyKey, unknown>(
                source,
                String(index),
                receiver,
                hooks,
              ),
            write: (index, value): void => {
              storeTypedArrayElement(target, index, value, hooks);
            },
            remove: (index): void => {
              throw "TYPED_ARRAY_SORT_HOLE_INVARIANT";
            },
          };
          sortIndexed<unknown>(access, (left, right): number => {
            if (comparator !== undefined) {
              const converted = numberValue(
                hooks.call(comparator, undefined, [left, right]),
                hooks,
                realm,
              );
              if (converted.error === "unsupported")
                return rejectUnsupportedExecution(realm);
              if (converted.error !== "none")
                throw createRuntimeError(realm, "type");
              return converted.value !== converted.value ? 0 : converted.value;
            }
            if (typeof left === "number" && typeof right === "number") {
              if (left !== left) return right !== right ? 0 : 1;
              if (right !== right) return -1;
              if (left < right) return -1;
              if (left > right) return 1;
              if (left === 0 && right === 0)
                return 1 / left < 1 / right ? -1 : 1 / left > 1 / right ? 1 : 0;
              return 0;
            }
            const a = viewBigIntValue(left),
              b = viewBigIntValue(right);
            if (a === undefined || b === undefined)
              throw "TYPED_ARRAY_SORT_VALUE_INVARIANT";
            return compareBigIntValues(a, b);
          });
          return target;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  install("sort", false);
  install("toSorted", true);
}
