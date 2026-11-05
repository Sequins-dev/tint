import type { Instruction } from "./model.ts";
/** Address exposure requires the public calling convention, even without a call. */
export function escapedFunction(op: Instruction): number | undefined {
  return op.kind === "function-new" || op.kind === "function-address"
    ? op.target
    : undefined;
}
/** Function identities are not value operands and must survive pruning/remapping. */
export function referencedFunction(op: Instruction): number | undefined {
  return op.kind === "call" || op.kind === "call-indirect"
    ? op.target
    : escapedFunction(op);
}
export function remapReferencedFunction(
  op: Instruction,
  target: number,
): Instruction {
  switch (op.kind) {
    case "call":
    case "call-indirect":
    case "function-new":
    case "function-address":
      return target === op.target ? op : { ...op, target };
    default:
      return op;
  }
}
