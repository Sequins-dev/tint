import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";

export interface ClosureEnvironmentForwarding {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** function-environment reads rewritten to environment slot loads. */
  readonly rewritten: number;
}

/** The slot a terminator transfers a value into, if any. */
function transferSlot(term: Terminator): number | undefined {
  return term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
    ? term.slot
    : undefined;
}

/** Forwards closure environments past the closures that carry them. When
 * every write of a slot stores `function-new f env` (in the same block) and
 * the slot is no parameter, receiver or transfer target, each
 * `function-environment (load slot)` reads `env` from a fresh slot that
 * mirrors those writes instead. A slot left unread then loses its stores,
 * so the closures become dead values (the environment records stay as
 * long as something reads them). Verified IR only; values are block-local.
 * The rewrite is exact: the mirrored environment is the closure's. */
export function forwardClosureEnvironments(
  fn: FunctionIR,
  budget: number,
): ClosureEnvironmentForwarding | undefined {
  let visited = 0;
  const slotCount = fn.slots.length,
    // 0 unknown, 1 only closures with environments, 2 other writes.
    writes = new Uint8Array(slotCount),
    reads = new Uint32Array(slotCount),
    environmentReads = new Uint32Array(slotCount),
    excluded = new Uint8Array(slotCount);
  for (const parameter of fn.parameters)
    if (parameter !== undefined) excluded[parameter] = 1;
  if (fn.receiverSlot !== undefined) excluded[fn.receiverSlot] = 1;
  for (const block of fn.blocks) {
    if (block === undefined) throw "closure environment block invariant";
    const exception = block.exception;
    if (exception !== undefined) excluded[exception.slot] = 1;
    const transfer = transferSlot(block.terminator);
    if (transfer !== undefined) excluded[transfer] = 1;
    // Closures with an environment defined in this block, by value.
    const closures = new Set<number>(),
      loads = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "closure environment instruction invariant";
      if (++visited > budget) return undefined;
      if (op.kind === "function-new" && op.environment !== undefined)
        closures.add(op.id);
      else if (op.kind === "store")
        writes[op.slot] = closures.has(op.value)
          ? writes[op.slot] === 2
            ? 2
            : 1
          : 2;
      else if (op.kind === "load") {
        reads[op.slot] = (reads[op.slot] ?? 0) + 1;
        loads.set(op.id, op.slot);
      } else if (op.kind === "function-environment") {
        const slot = loads.get(op.callee);
        if (slot !== undefined)
          environmentReads[slot] = (environmentReads[slot] ?? 0) + 1;
      }
    }
  }
  const mirrors = new Int32Array(slotCount).fill(-1),
    slots: ScalarType[] = fn.slots.slice();
  let candidates = 0;
  for (let slot = 0; slot < slotCount; slot++)
    if (
      writes[slot] === 1 &&
      excluded[slot] !== 1 &&
      (environmentReads[slot] ?? 0) > 0
    ) {
      mirrors[slot] = slots.length;
      slots.push("reference");
      candidates++;
    }
  if (candidates === 0) return { fn, visited, rewritten: 0 };
  let fresh = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "closure environment block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "closure environment instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id >= fresh) fresh = id + 1;
    }
  }
  let rewritten = 0;
  // Loads of a rewritten slot that remain (other than environment reads).
  const remaining = new Uint32Array(slotCount);
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "closure environment block invariant";
    const environments = new Map<number, number>(),
      loads = new Map<number, number>(),
      instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "closure environment instruction invariant";
      if (++visited > budget) return undefined;
      if (op.kind === "function-new" && op.environment !== undefined)
        environments.set(op.id, op.environment);
      if (op.kind === "store" && (mirrors[op.slot] ?? -1) >= 0) {
        const environment = environments.get(op.value);
        if (environment === undefined) throw "closure environment invariant";
        instructions.push(op);
        instructions.push({
          kind: "store",
          slot: mirrors[op.slot] ?? -1,
          value: environment,
          start: op.start,
          end: op.end,
        });
        continue;
      }
      if (op.kind === "load" && (mirrors[op.slot] ?? -1) >= 0) {
        loads.set(op.id, op.slot);
        instructions.push(op);
        continue;
      }
      if (op.kind === "function-environment") {
        const slot = loads.get(op.callee);
        if (slot !== undefined) {
          const mirrored = fresh++;
          instructions.push({
            kind: "load",
            id: mirrored,
            slot: mirrors[slot] ?? -1,
            start: op.start,
            end: op.end,
          });
          instructions.push({
            kind: "reference-wrap",
            id: op.id,
            value: mirrored,
            start: op.start,
            end: op.end,
          });
          rewritten++;
          continue;
        }
      }
      instructions.push(op);
    }
    blocks.push({ ...block, instructions });
  }
  // A closure slot whose only reads were environment reads is now unread:
  // drop its loads (dead values) and stores.
  for (const block of blocks) {
    if (block === undefined) throw "closure environment block invariant";
    const used = new Set<number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "closure environment instruction invariant";
      if (op.kind === "load") continue;
      if (op.kind === "store") {
        used.add(op.value);
        continue;
      }
      visitInstructionOperands(op, (value) => {
        used.add(value);
      });
    }
    visitTerminatorOperands(block.terminator, (value) => {
      used.add(value);
    });
    for (const op of block.instructions) {
      if (op === undefined) throw "closure environment instruction invariant";
      if (
        op.kind === "load" &&
        (mirrors[op.slot] ?? -1) >= 0 &&
        used.has(op.id)
      )
        remaining[op.slot] = (remaining[op.slot] ?? 0) + 1;
    }
  }
  const result: Block[] = [];
  for (const block of blocks) {
    if (block === undefined) throw "closure environment block invariant";
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "closure environment instruction invariant";
      const slot =
        op.kind === "load" || op.kind === "store" ? op.slot : undefined;
      if (
        slot !== undefined &&
        (mirrors[slot] ?? -1) >= 0 &&
        (remaining[slot] ?? 0) === 0
      )
        continue;
      instructions.push(op);
    }
    result.push({ ...block, instructions });
  }
  return { fn: { ...fn, slots, blocks: result }, visited, rewritten };
}
