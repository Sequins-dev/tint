import type { ScriptPropertyKey } from "./symbols.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import { copyDataProperties } from "./copy.ts";
import { toObjectValue } from "./boxing.ts";
import { scriptPropertyKeyOrder } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";

/** Script adapter for CopyDataProperties over canonical string and symbol keys. */
export function copyObjectProperties(
  target: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
  excluded: readonly ScriptPropertyKey[],
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): void {
  if (value === null || value === undefined) return;
  const source = toObjectValue(value, realm, hooks);
  if (
    !copyDataProperties<ScriptPropertyKey, unknown>(
      target,
      source,
      source,
      excluded,
      (key): number => scriptPropertyKeyOrder(key),
      hooks,
    )
  )
    throw createRuntimeError(realm, "type");
}
