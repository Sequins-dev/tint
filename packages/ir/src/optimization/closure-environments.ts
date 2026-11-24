import {
  instructionResult,
  retainDebugValues,
  substituteInstructionValues,
  substituteTerminatorValues,
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
  // Mirror slot + 1 per closure slot (0: none).
  const mirrors = new Uint32Array(slotCount),
    slots: ScalarType[] = fn.slots.slice();
  let candidates = 0;
  for (let slot = 0; slot < slotCount; slot++)
    if (
      writes[slot] === 1 &&
      excluded[slot] !== 1 &&
      (environmentReads[slot] ?? 0) > 0
    ) {
      mirrors[slot] = slots.length + 1;
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
  const remaining = new Uint32Array(slotCount),
    // Direct unwraps of a rewritten environment read become the mirrored load
    // itself, leaving the temporary reference-wrap dead so scalar replacement
    // sees the environment record directly.
    aliases = new Uint32Array(fresh);
  let anyUnwrapped = false;
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "closure environment block invariant";
    const environments = new Map<number, number>(),
      loads = new Map<number, number>(),
      wrappedMirrors = new Map<number, number>(),
      instructions: Instruction[] = [];
    let blockUnwrapped = false;
    for (const op of block.instructions) {
      if (op === undefined) throw "closure environment instruction invariant";
      if (++visited > budget) return undefined;
      const current = blockUnwrapped
        ? substituteInstructionValues(op, aliases)
        : op;
      if (current.kind === "function-new" && current.environment !== undefined)
        environments.set(current.id, current.environment);
      if (current.kind === "store" && (mirrors[current.slot] ?? 0) !== 0) {
        const environment = environments.get(current.value);
        if (environment === undefined) throw "closure environment invariant";
        instructions.push(current);
        instructions.push({
          kind: "store",
          slot: (mirrors[current.slot] ?? 0) - 1,
          value: environment,
          start: current.start,
          end: current.end,
        });
        continue;
      }
      if (current.kind === "load" && (mirrors[current.slot] ?? 0) !== 0) {
        loads.set(current.id, current.slot);
        instructions.push(current);
        continue;
      }
      if (current.kind === "function-environment") {
        const slot = loads.get(current.callee);
        if (slot !== undefined) {
          const mirrored = fresh++;
          instructions.push({
            kind: "load",
            id: mirrored,
            slot: (mirrors[slot] ?? 0) - 1,
            start: current.start,
            end: current.end,
          });
          instructions.push({
            kind: "reference-wrap",
            id: current.id,
            value: mirrored,
            start: current.start,
            end: current.end,
          });
          wrappedMirrors.set(current.id, mirrored);
          rewritten++;
          continue;
        }
      }
      if (
        current.kind === "reference-value" &&
        (current.type === undefined || current.type === "reference")
      ) {
        const mirrored = wrappedMirrors.get(current.value);
        if (mirrored !== undefined) {
          aliases[current.id] = mirrored + 1;
          blockUnwrapped = true;
          anyUnwrapped = true;
          rewritten++;
          continue;
        }
      }
      instructions.push(current);
    }
    const terminator = blockUnwrapped
      ? substituteTerminatorValues(block.terminator, aliases)
      : block.terminator;
    blocks.push({ ...block, instructions, terminator });
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
        (mirrors[op.slot] ?? 0) !== 0 &&
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
        (mirrors[slot] ?? 0) !== 0 &&
        (remaining[slot] ?? 0) === 0
      )
        continue;
      instructions.push(op);
    }
    result.push({ ...block, instructions });
  }
  const debug =
    fn.debug === undefined
      ? undefined
      : anyUnwrapped
        ? retainDebugValues(fn, result, [], aliases)
        : fn.debug;
  return {
    fn:
      debug === undefined
        ? { ...fn, slots, blocks: result }
        : { ...fn, slots, blocks: result, debug },
    visited,
    rewritten,
  };
}
