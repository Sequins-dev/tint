import { copyTypedArrayElements } from "./typed-array-storage.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { storeTypedArrayElement } from "./typed-array-construction.ts";
import { viewObjectValue } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import { numberValue } from "./coercion.ts";
import { getProperty, type ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
export function installTypedArraySet(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.typedArrayPrototype,
    "set",
    builtinFunction(
      realm.functionPrototype,
      "set",
      1,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm, "write");
        const converted = numberValue(args[1], hooks, realm);
        if (converted.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (converted.error !== "none") throw createRuntimeError(realm, "type");
        const offset =
          converted.value !== converted.value ? 0 : Math.trunc(converted.value);
        if (offset < 0) throw createRuntimeError(realm, "range");
        const window = typedArrayWindow(data, "write");
        if (window === undefined) throw createRuntimeError(realm, "type");
        const target = viewObjectValue(receiver, realm.objectPrototype);
        if (target === undefined) throw "TYPED_ARRAY_SET_INVARIANT";
        const input = viewObjectValue(args[0], realm.objectPrototype),
          sourceData =
            input === undefined ? undefined : input.internalTypedArrayData;
        if (sourceData !== undefined && input !== undefined) {
          const sourceWindow = typedArrayWindow(sourceData);
          if (sourceWindow === undefined)
            throw createRuntimeError(realm, "type");
          if (
            offset > window.length ||
            sourceWindow.length > window.length - offset
          )
            throw createRuntimeError(realm, "range");
          const targetBig =
              data.kind === "BigInt64" || data.kind === "BigUint64",
            sourceBig =
              sourceData.kind === "BigInt64" || sourceData.kind === "BigUint64";
          if (targetBig !== sourceBig) throw createRuntimeError(realm, "type");
          if (data.kind === sourceData.kind) {
            copyTypedArrayElements(
              sourceData,
              data,
              0,
              offset,
              sourceWindow.length,
              true,
            );
          } else {
            // Different element widths may alias the same bytes. Snapshot before any write.
            const values: unknown[] = [];
            for (let i = 0; i < sourceWindow.length; i++)
              values.push(
                getProperty<ScriptPropertyKey, unknown>(
                  input,
                  String(i),
                  input,
                  hooks,
                ),
              );
            for (let i = 0; i < values.length; i++)
              storeTypedArrayElement(target, offset + i, values[i], hooks);
          }
        } else {
          const source = toObjectValue(args[0], realm, hooks),
            length = lengthOfArrayLike(source, realm, hooks);
          if (offset > window.length || length > window.length - offset)
            throw createRuntimeError(realm, "range");
          for (let i = 0; i < length; i++)
            storeTypedArrayElement(
              target,
              offset + i,
              getProperty<ScriptPropertyKey, unknown>(
                source,
                String(i),
                source,
                hooks,
              ),
              hooks,
            );
        }
        return undefined;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
