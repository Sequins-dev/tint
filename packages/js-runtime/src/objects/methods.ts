import {
  ensureRareSlots,
  getPrototype,
  type OrdinaryObject,
} from "./operations.ts";

/** MakeMethod captures definition identity, never the receiver of a later call.
 * Invoke during method/accessor creation, not when copying a function property. */
export function makeMethod<Key, Value>(
  method: OrdinaryObject<Key, Value>,
  home: OrdinaryObject<Key, Value>,
): void {
  ensureRareSlots<Key, Value>(method).internalHomeObject = home;
}

/** Resolve once per super reference, after evaluating a computed key expression
 * but before its deferred ToPropertyKey conversion or an assignment RHS.
 * undefined denotes a null super base; Get/Put must reject it, not search from this.
 * Missing home objects are a compiler invariant violation, not a null base. */
export function getSuperBase<Key, Value>(
  method: OrdinaryObject<Key, Value>,
): OrdinaryObject<Key, Value> | undefined {
  const rare = method.internalRareSlots;
  const home = rare === undefined ? undefined : rare.internalHomeObject;
  if (home === undefined) throw "SUPER_HOME_OBJECT_INVARIANT";
  return getPrototype<Key, Value>(home);
}
