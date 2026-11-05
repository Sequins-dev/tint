import { coerceBigInt } from "./bigint-coercion.ts";
import { numberValue } from "./coercion.ts";
import { constructTypedArrayResult } from "./typed-array-result.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { storeTypedArrayElement } from "./typed-array-construction.ts";
import { viewObjectValue } from "./values.ts";
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
/** Copying methods use the realm's intrinsic element kind, never Symbol.species. */
export function installTypedArrayCopying(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  constructors: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>,
): void {
  function number(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function create(
    kind: string,
    length: number,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const constructor = constructors.get(kind);
    if (constructor === undefined)
      throw "TYPED_ARRAY_COPYING_INTRINSIC_INVARIANT";
    return constructTypedArrayResult(constructor, [length], realm);
  }
  builtinProperty(
    realm.typedArrayPrototype,
    "toReversed",
    builtinFunction(
      realm.functionPrototype,
      "toReversed",
      0,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm),
          window = typedArrayWindow(data);
        if (window === undefined) throw createRuntimeError(realm, "type");
        const source = viewObjectValue(receiver, realm.objectPrototype);
        if (source === undefined) throw "TYPED_ARRAY_COPYING_INVARIANT";
        const target = create(data.kind, window.length);
        for (let index = 0; index < window.length; index++) {
          const value = getProperty<ScriptPropertyKey, unknown>(
            source,
            String(window.length - index - 1),
            receiver,
            hooks,
          );
          storeTypedArrayElement(target, index, value, hooks);
        }
        return target;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.typedArrayPrototype,
    "with",
    builtinFunction(
      realm.functionPrototype,
      "with",
      2,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm),
          initial = typedArrayWindow(data);
        if (initial === undefined) throw createRuntimeError(realm, "type");
        const converted = number(args[0]),
          relative = converted !== converted ? 0 : Math.trunc(converted),
          index = relative < 0 ? initial.length + relative : relative;
        const replacement: unknown =
          data.kind === "BigInt64" || data.kind === "BigUint64"
            ? coerceBigInt(args[1], false, realm, hooks)
            : number(args[1]);
        const current = typedArrayWindow(data);
        if (current === undefined || index < 0 || index >= current.length)
          throw createRuntimeError(realm, "range");
        const source = viewObjectValue(receiver, realm.objectPrototype);
        if (source === undefined) throw "TYPED_ARRAY_COPYING_INVARIANT";
        // Index validation sees the resized view; the result retains the original length.
        const target = create(data.kind, initial.length);
        for (let at = 0; at < initial.length; at++) {
          const value =
            at === index
              ? replacement
              : getProperty<ScriptPropertyKey, unknown>(
                  source,
                  String(at),
                  receiver,
                  hooks,
                );
          storeTypedArrayElement(target, at, value, hooks);
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
