import {
  ensureExoticSlots,
  createObject,
  type OrdinaryObject,
} from "./operations.ts";
import type { BigIntValue } from "./bigints.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Allocate an instant with an already validated exact epoch and intrinsic parent. */
export function createTemporalInstantObject(
  epoch: BigIntValue,
  parent: OrdinaryObject<ScriptPropertyKey, unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createObject<ScriptPropertyKey, unknown>(parent);
  ensureExoticSlots(object).internalTemporalInstant = epoch;
  return object;
}
