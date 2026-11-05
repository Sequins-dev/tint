import type { StorageAccess } from "../bytes/index.ts";
import { speciesConstructor } from "./species.ts";
import { constructTypedArrayResult } from "./typed-array-result.ts";
import { requireTypedArray } from "./typed-array-data.ts";
import type { ObjectHooks, OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** Species results must be live typed arrays with the same Number/BigInt content kind. */
export function typedArraySpeciesCreate(
  source: OrdinaryObject<ScriptPropertyKey, unknown>,
  args: readonly unknown[],
  constructors: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  access: StorageAccess = "read",
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const data = requireTypedArray(source, realm),
    fallback = constructors.get(data.kind);
  if (fallback === undefined) throw "TYPED_ARRAY_SPECIES_INTRINSIC_INVARIANT";
  const selected = speciesConstructor(source, fallback, realm, hooks),
    result = constructTypedArrayResult(selected, args, realm, access),
    target = requireTypedArray(result, realm);
  const sourceBig = data.kind === "BigInt64" || data.kind === "BigUint64",
    targetBig = target.kind === "BigInt64" || target.kind === "BigUint64";
  if (sourceBig !== targetBig) throw createRuntimeError(realm, "type");
  return result;
}
