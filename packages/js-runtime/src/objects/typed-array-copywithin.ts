import { copyTypedArrayElements } from "./typed-array-storage.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { numberValue } from "./coercion.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
export function installTypedArrayCopyWithin(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function index(value: unknown, length: number): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    const relative =
      converted.value !== converted.value ? 0 : Math.trunc(converted.value);
    return relative < 0
      ? Math.max(length + relative, 0)
      : Math.min(relative, length);
  }
  builtinProperty(
    realm.typedArrayPrototype,
    "copyWithin",
    builtinFunction(
      realm.functionPrototype,
      "copyWithin",
      2,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm, "write"),
          initial = typedArrayWindow(data, "write");
        if (initial === undefined) throw createRuntimeError(realm, "type");
        const target = index(args[0], initial.length),
          start = index(args[1], initial.length),
          end =
            args[2] === undefined
              ? initial.length
              : index(args[2], initial.length),
          count = Math.min(end - start, initial.length - target);
        if (count <= 0) return receiver;
        const current = typedArrayWindow(data, "write");
        if (current === undefined) throw createRuntimeError(realm, "type");
        // Adopt the living specification's correction to ES2025: shrink to the
        // still-valid prefix before choosing the overlap direction.
        const available = Math.min(
          count,
          current.length - start,
          current.length - target,
        );
        if (available <= 0) return receiver;
        copyTypedArrayElements(data, data, start, target, available, true);
        return receiver;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
