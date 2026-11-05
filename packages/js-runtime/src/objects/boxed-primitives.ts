import type { ScriptPropertyKey } from "./symbols.ts";
import {
  createObject,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";

export type PrimitiveObjectKind = "number" | "boolean" | "string";

/** Payloads are internal slots, never named properties. String index descriptors
 * are materialized eagerly; their observable attributes match string exotic indices. */
export function createPrimitiveObject(
  kind: PrimitiveObjectKind,
  value: unknown,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (typeof value !== kind) throw "PRIMITIVE_OBJECT_PAYLOAD_INVARIANT";
  const object = createObject<ScriptPropertyKey, unknown>(prototype);
  object.internalPrimitiveData = { kind, value };
  function immutable(key: string, item: unknown, enumerable: boolean): void {
    if (
      defineOwnProperty<ScriptPropertyKey, unknown>(
        object,
        key,
        {
          fields: 51,
          value: item,
          writable: false,
          enumerable,
          configurable: false,
          get: undefined,
          set: undefined,
        },
        hooks,
      ) !== "accepted"
    )
      throw "STRING_OBJECT_PROPERTY_INVARIANT";
  }
  if (typeof value === "string") {
    immutable("length", value.length, false);
    for (let index = 0; index < value.length; index++)
      immutable(String(index), value.slice(index, index + 1), true);
  }
  return object;
}
