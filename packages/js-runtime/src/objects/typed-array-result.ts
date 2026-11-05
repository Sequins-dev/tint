import type { StorageAccess } from "../bytes/index.ts";
import { constructObject } from "./call.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { viewObjectValue } from "./values.ts";
import type { OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** Validate constructor results; a sole numeric argument also imposes a minimum length. */
export function constructTypedArrayResult(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  args: readonly unknown[],
  realm: ErrorRealm,
  access: StorageAccess = "read",
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const result = constructObject<ScriptPropertyKey, unknown>(
    constructor,
    args,
    { object: constructor, value: constructor },
    undefined,
  );
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  const data = requireTypedArray(result.value, realm, access),
    window = typedArrayWindow(data, access);
  const first = args[0];
  const length = args.length === 1 && typeof first === "number" ? first : 0;
  if (window === undefined || window.length < length)
    throw createRuntimeError(realm, "type");
  const object = viewObjectValue(result.value, realm.objectPrototype);
  if (object === undefined) throw "TYPED_ARRAY_CONSTRUCT_INVARIANT";
  return object;
}
