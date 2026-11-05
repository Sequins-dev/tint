import { copyTypedArrayElements } from "./typed-array-storage.ts";
import { storeTypedArrayElement } from "./typed-array-construction.ts";
import { getProperty } from "./operations.ts";
import { typedArraySpeciesCreate } from "./typed-array-species.ts";
import {
  requireTypedArray,
  typedArrayWindow,
  typedArrayElementWidth,
} from "./typed-array-data.ts";
import { numberValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import type { ObjectHooks, OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
export function installTypedArrayRanges(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  constructors: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>,
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
    "subarray",
    builtinFunction(
      realm.functionPrototype,
      "subarray",
      2,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm),
          window = typedArrayWindow(data),
          length = window === undefined ? 0 : window.length,
          start = index(args[0], length),
          offset = data.byteOffset + start * typedArrayElementWidth(data.kind);
        const source = viewObjectValue(receiver, realm.objectPrototype);
        if (source === undefined) throw "TYPED_ARRAY_SUBARRAY_INVARIANT";
        // Omitting the count preserves length tracking on resizable buffers.
        if (data.length === undefined && args[1] === undefined)
          return typedArraySpeciesCreate(
            source,
            [data.buffer, offset],
            constructors,
            realm,
            hooks,
          );
        const end = args[1] === undefined ? length : index(args[1], length);
        return typedArraySpeciesCreate(
          source,
          [data.buffer, offset, Math.max(end - start, 0)],
          constructors,
          realm,
          hooks,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.typedArrayPrototype,
    "slice",
    builtinFunction(
      realm.functionPrototype,
      "slice",
      2,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm),
          initial = typedArrayWindow(data);
        if (initial === undefined) throw createRuntimeError(realm, "type");
        const start = index(args[0], initial.length),
          end =
            args[1] === undefined
              ? initial.length
              : index(args[1], initial.length),
          requested = Math.max(end - start, 0);
        const source = viewObjectValue(receiver, realm.objectPrototype);
        if (source === undefined) throw "TYPED_ARRAY_SLICE_INVARIANT";
        const target = typedArraySpeciesCreate(
          source,
          [requested],
          constructors,
          realm,
          hooks,
          "write",
        );
        if (requested === 0) return target;
        const current = typedArrayWindow(data);
        if (current === undefined) throw createRuntimeError(realm, "type");
        const count = Math.max(Math.min(end, current.length) - start, 0),
          targetData = requireTypedArray(target, realm);
        if (data.kind === targetData.kind) {
          copyTypedArrayElements(data, targetData, start, 0, count, false);
        } else {
          for (let at = 0; at < count; at++)
            storeTypedArrayElement(
              target,
              at,
              getProperty<ScriptPropertyKey, unknown>(
                source,
                String(start + at),
                receiver,
                hooks,
              ),
              hooks,
            );
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
