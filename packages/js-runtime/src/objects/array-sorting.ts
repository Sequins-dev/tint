import {
  sortIndexed,
  type IndexedAccess,
} from "@tint/foundation/collections/indexed-sort";
import { lengthOfArrayLike } from "./array-like.ts";
import { createArrayObject } from "./arrays.ts";
import { toObjectValue } from "./boxing.ts";
import { isCallableObject } from "./call.ts";
import { numberValue, stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createDataProperty,
  deleteProperty,
  getProperty,
  hasProperty,
  setProperty,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { viewObjectValue } from "./values.ts";

/** Both sort forms gather values before comparing; copying reads through holes. */
export function installArraySorting(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function string(value: unknown): string {
    const result = stringValue(value, hooks, realm);
    if (result.error === "unsupported") rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function method(name: string, copying: boolean): void {
    const sort = builtinFunction(
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
        const source = toObjectValue(receiver, realm, hooks);
        const length = lengthOfArrayLike(source, realm, hooks);
        const target = copying
          ? createArrayObject<ScriptPropertyKey, unknown>(
              length,
              realm.arrayPrototype,
              realm.arrayHooks,
              hooks,
            )
          : source;
        const access: IndexedAccess<unknown> = {
          length: (): number => length,
          has: (index): boolean =>
            copying ||
            hasProperty<ScriptPropertyKey, unknown>(source, String(index)),
          read: (index): unknown =>
            getProperty<ScriptPropertyKey, unknown>(
              source,
              String(index),
              source,
              hooks,
            ),
          write: (index, value): void => {
            const accepted = copying
              ? createDataProperty<ScriptPropertyKey, unknown>(
                  target,
                  String(index),
                  value,
                  hooks,
                )
              : setProperty<ScriptPropertyKey, unknown>(
                  target,
                  String(index),
                  value,
                  { object: target, value: target },
                  hooks,
                );
            if (!accepted) throw createRuntimeError(realm, "type");
          },
          remove: (index): void => {
            if (
              !deleteProperty<ScriptPropertyKey, unknown>(target, String(index))
            )
              throw createRuntimeError(realm, "type");
          },
        };
        sortIndexed<unknown>(access, (left, right): number => {
          if (comparator !== undefined) {
            const result = numberValue(
              hooks.call(comparator, undefined, [left, right]),
              hooks,
              realm,
            );
            if (result.error === "unsupported")
              rejectUnsupportedExecution(realm);
            if (result.error !== "none")
              throw createRuntimeError(realm, "type");
            return result.value !== result.value ? 0 : result.value;
          }
          const a = string(left),
            b = string(right);
          return a < b ? -1 : a > b ? 1 : 0;
        });
        return target;
      },
      hooks,
    );
    builtinProperty(realm.arrayPrototype, name, sort, true, true, hooks);
  }
  method("sort", false);
  method("toSorted", true);
}
