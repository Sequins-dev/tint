import type { FunctionIR } from "./model.ts";
export interface InitializationSlots {
  readonly indices: Uint32Array;
  readonly count: number;
}
/** Verified slots/graph only. Parameters and reads preceded by a same-block store
 * need no predecessor facts. Zero denotes such an untracked slot; other indices
 * are dense bit positions plus one. A read before a store must remain tracked. */
export function initializationSlots(fn: FunctionIR): InitializationSlots {
  const indices = new Uint32Array(fn.slots.length),
    parameters = new Uint8Array(fn.slots.length),
    defined = new Uint32Array(fn.slots.length);
  for (const slot of fn.parameters) {
    if (slot === undefined) throw "initialization parameter invariant";
    parameters[slot] = 1;
  }
  if (fn.receiverSlot !== undefined) parameters[fn.receiverSlot] = 1;
  let count = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "initialization block invariant";
    const stamp = block.id + 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "initialization instruction invariant";
      if (op.kind === "store") defined[op.slot] = stamp;
      else if (
        op.kind === "load" &&
        parameters[op.slot] !== 1 &&
        defined[op.slot] !== stamp &&
        indices[op.slot] === 0
      )
        indices[op.slot] = ++count;
    }
    const term = block.terminator;
    if (
      (term.kind === "cell" ||
        term.kind === "record" ||
        term.kind === "record-cell") &&
      term.operation !== "read" &&
      parameters[term.slot] !== 1 &&
      defined[term.slot] !== stamp &&
      indices[term.slot] === 0
    )
      indices[term.slot] = ++count;
  }
  return { indices, count };
}
