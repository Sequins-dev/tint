/** Native activation records. A compiled script entry links a record into
 * its frame while it runs (see @tint/abi/host nativeActivationTopOffset and
 * docs/design-general-runtime-rearchitecture.md, "Activation records"), so a
 * call writes no heap memory for stack traces or legacy caller and arguments
 * reflection. Native builds bind these declarations to IR activation-read;
 * where no native frames exist the chain is empty.
 *
 * Records are numbers (frame addresses): a younger record has a lower
 * address than every record it was pushed after. They stay valid only while
 * their activations run, so readers walk the chain synchronously. */

/** The innermost record, or 0. */
export function activationTop(): number {
  return 0;
}
/** The record pushed before `record`, or 0. */
export function activationPrevious(_record: number): number {
  throw "UNBOUND_ACTIVATION";
}
/** 1 for an entry called with actual operands; 0 for one called with a
 * materialized argument list, which heap bookkeeping describes instead. */
export function activationKind(_record: number): number {
  throw "UNBOUND_ACTIVATION";
}
/** The entry's callee. */
export function activationCallee(_record: number): unknown {
  throw "UNBOUND_ACTIVATION";
}
/** The entry's actual operand count. */
export function activationArgumentCount(_record: number): number {
  throw "UNBOUND_ACTIVATION";
}
/** Actual operand `index` of the entry, undefined from the count on. */
export function activationArgument(_record: number, _index: number): unknown {
  throw "UNBOUND_ACTIVATION";
}

/** Whether a heap bookkeeping frame pushed while `nativeTop` was the
 * innermost record is younger than native record `record`. */
export function youngerThanActivation(
  nativeTop: number,
  record: number,
): boolean {
  return nativeTop !== 0 && nativeTop <= record;
}
