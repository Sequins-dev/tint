import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { storeTypedArrayElement } from "./typed-array-construction.ts";
import { coerceBigInt } from "./bigint-coercion.ts";
import { numberValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";

export function installTypedArrayFill(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function number(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function index(value: unknown, length: number): number {
    const converted = number(value),
      relative = converted !== converted ? 0 : Math.trunc(converted);
    return relative < 0
      ? Math.max(length + relative, 0)
      : Math.min(relative, length);
  }
  builtinProperty(
    realm.typedArrayPrototype,
    "fill",
    builtinFunction(
      realm.functionPrototype,
      "fill",
      1,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm, "write"),
          initial = typedArrayWindow(data, "write");
        if (initial === undefined) throw createRuntimeError(realm, "type");
        const value: unknown =
          data.kind === "BigInt64" || data.kind === "BigUint64"
            ? coerceBigInt(args[0], false, realm, hooks)
            : number(args[0]);
        const start = index(args[1], initial.length),
          end =
            args[2] === undefined
              ? initial.length
              : index(args[2], initial.length);
        // Every conversion above may resize or detach, including for an empty range.
        const current = typedArrayWindow(data, "write");
        if (current === undefined) throw createRuntimeError(realm, "type");
        const target = viewObjectValue(receiver, realm.objectPrototype);
        if (target === undefined) throw "TYPED_ARRAY_FILL_INVARIANT";
        const limit = Math.min(end, current.length);
        for (let i = start; i < limit; i++)
          storeTypedArrayElement(target, i, value, hooks);
        return receiver;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
