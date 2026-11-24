import type {
  FunctionIR,
  ScalarType,
  Block,
  Instruction,
  SlotBinding,
} from "../scalar/index.ts";
export interface SlotCompaction {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly removed: number;
}
/** Verified IR only. Keep ABI parameters and every explicit slot use, including
 * exceptional and guarded transfers. Slot numbering is local to a function;
 * environment cells and instruction value IDs belong to separate namespaces. */
export function compactSlots(
  fn: FunctionIR,
  budget: number,
): SlotCompaction | undefined {
  if (!Number.isSafeInteger(budget) || budget < fn.slots.length)
    return undefined;
  const mapping = new Uint32Array(fn.slots.length);
  let visited = fn.slots.length;
  if (fn.receiverSlot !== undefined) mapping[fn.receiverSlot] = 1;
  for (const slot of fn.parameters) {
    if (slot === undefined || ++visited > budget) return undefined;
    mapping[slot] = 1;
  }
  for (const block of fn.blocks) {
    if (block === undefined || ++visited > budget) return undefined;
    if (block.exception !== undefined) mapping[block.exception.slot] = 1;
    const term = block.terminator;
    if (
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    )
      mapping[term.slot] = 1;
    for (const op of block.instructions) {
      if (op === undefined || ++visited > budget) return undefined;
      if (op.kind === "load" || op.kind === "store") mapping[op.slot] = 1;
    }
  }
  const slots: ScalarType[] = [];
  for (let id = 0; id < fn.slots.length; id++) {
    if (++visited > budget) return undefined;
    if (mapping[id] === 0) continue;
    const type = fn.slots[id];
    if (type === undefined) throw "slot compaction type invariant";
    slots.push(type);
    mapping[id] = slots.length;
  }
  const removed = fn.slots.length - slots.length;
  if (removed === 0) return { fn, visited, removed };
  function slot(id: number): number {
    const mapped = mapping[id] ?? 0;
    if (mapped === 0) throw "slot compaction use invariant";
    return mapped - 1;
  }
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined || ++visited > budget) return undefined;
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined || ++visited > budget) return undefined;
      instructions.push(
        op.kind === "load" || op.kind === "store"
          ? { ...op, slot: slot(op.slot) }
          : op,
      );
    }
    const term = block.terminator;
    const rewritten: Block = {
      ...block,
      instructions,
      terminator:
        term.kind === "cell" ||
        term.kind === "record" ||
        term.kind === "record-cell"
          ? { ...term, slot: slot(term.slot) }
          : term,
    };
    blocks.push(
      block.exception === undefined
        ? rewritten
        : {
            ...rewritten,
            exception: { ...block.exception, slot: slot(block.exception.slot) },
          },
    );
  }
  const parameters: number[] = [];
  for (const id of fn.parameters) {
    if (id === undefined || ++visited > budget) return undefined;
    parameters.push(slot(id));
  }
  const integerSlots: number[] = [];
  for (const id of fn.integerSlots ?? []) {
    if (id === undefined || ++visited > budget) return undefined;
    if ((mapping[id] ?? 0) !== 0) integerSlots.push(slot(id));
  }
  const safeIntegerSlots: number[] = [],
    safeIntegerBounds: number[] = [],
    oldBounds = fn.safeIntegerBounds ?? [];
  for (let index = 0; index < (fn.safeIntegerSlots?.length ?? 0); index++) {
    const id = fn.safeIntegerSlots?.[index],
      bound = oldBounds[index];
    if (id === undefined || bound === undefined || ++visited > budget)
      return undefined;
    if ((mapping[id] ?? 0) !== 0) {
      safeIntegerSlots.push(slot(id));
      safeIntegerBounds.push(bound);
    }
  }
  // Debug names follow their slots; bindings of removed slots are dropped.
  const debug = fn.debug,
    bindings: SlotBinding[] = [];
  if (debug !== undefined)
    for (const binding of debug.slots) {
      if (binding === undefined) throw "slot compaction debug invariant";
      if ((mapping[binding.slot] ?? 0) !== 0)
        bindings.push({ slot: slot(binding.slot), variable: binding.variable });
    }
  return {
    fn: {
      ...fn,
      slots,
      parameters,
      ...(fn.integerSlots === undefined ? {} : { integerSlots }),
      ...(fn.safeIntegerSlots === undefined
        ? {}
        : { safeIntegerSlots, safeIntegerBounds }),
      ...(debug === undefined ? {} : { debug: { ...debug, slots: bindings } }),
      blocks,
      ...(fn.receiverSlot === undefined
        ? {}
        : { receiverSlot: slot(fn.receiverSlot) }),
    },
    visited,
    removed,
  };
}
