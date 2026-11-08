import { instructionResult } from "./operands.ts";
import type { FunctionIR, Block, Instruction, ModuleIR } from "./model.ts";
/** Whole-module effect proof for verified IR. Managed writes never replace an
 * object's descriptor. Internal calls and managed imports obey the same
 * descriptor-stability contract; allocation/collection preserve layouts.
 * Raw-memory host capabilities break
 * that contract. New host operations are unsafe until explicitly classified.
 * This is not a proof for externally supplied code or arbitrary FFI callbacks. */
export function stableRecordLayouts(module: ModuleIR): boolean {
  for (const fn of module.functions) {
    if (fn === undefined) throw "layout effect function invariant";
    for (const block of fn.blocks) {
      if (block === undefined) throw "layout effect block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "layout effect instruction invariant";
        if (op.kind !== "host-call") continue;
        switch (op.operation) {
          case "cpu-pause":
          case "monotonic-time":
          case "wall-clock-time":
          case "random-word":
          case "open-read":
          case "open-exclusive":
          case "read":
          case "write":
          case "close":
          case "chmod":
          case "rename":
          case "unlink":
          case "read-link":
          case "argument-count":
          case "argument-length":
          case "argument-copy":
          case "context-domain":
          case "root-head":
          case "memory-map":
          case "memory-read-word":
            break;
          default:
            return false;
        }
      }
    }
  }
  return true;
}
/** Descriptor proofs for verified fixed-layout IR. Constructors establish exact
 * layouts; successful guards establish facts along unique normal predecessor
 * chains. Local alias assignments preserve identity. Joins, exception entries,
 * opaque calls and host effects stop propagation. Exhaustion keeps every check.
 * No source annotation or speculative shape assumption is used. */
export function analyzeRecordAccesses(
  fn: FunctionIR,
  maxWork: number = 100000,
  stableLayouts: boolean = false,
  includeGuards: boolean = true,
):
  | {
      readonly guards: Uint8Array;
      readonly reads: Uint8Array;
      readonly work: number;
    }
  | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  let maximum = 0;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions)
      if (op !== undefined && op.kind === "record-read")
        maximum = Math.max(maximum, op.id + 1);
  }
  if (maximum > maxWork) return undefined;
  const reads = new Uint8Array(maximum);
  const predecessors = new Uint32Array(fn.blocks.length),
    proven = new Uint8Array(fn.blocks.length);
  let work = 0,
    exhausted = false;
  function step(): boolean {
    if (work >= maxWork) {
      exhausted = true;
      return false;
    }
    work++;
    return true;
  }
  function edge(from: number, to: number): void {
    predecessors[to] = predecessors[to] === 0 ? from + 1 : 0xffffffff;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "record fact block invariant";
    if (!step()) return undefined;
    const term = block.terminator;
    if (term.kind === "jump") edge(block.id, term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      edge(block.id, term.consequent);
      edge(block.id, term.alternate);
    }
    if (block.exception !== undefined)
      predecessors[block.exception.target] = 0xffffffff;
  }
  predecessors[fn.entry] = 0xffffffff;
  function barrier(op: Instruction): boolean {
    return (
      !stableLayouts &&
      (op.kind === "call" ||
        op.kind === "call-indirect" ||
        op.kind === "host-call")
    );
  }
  // Positive origins identify slots at block entry. Negative origins describe
  // constructor layouts (not allocation identity). Zero means unknown.
  function slotOrigin(
    block: Block,
    slot: number,
    before: number,
    depth: number,
  ): number {
    if (depth > 128) return 0;
    for (let i = before - 1; i >= 0; i--) {
      if (!step()) return 0;
      const op = block.instructions[i];
      if (op === undefined) throw "record fact instruction invariant";
      if (barrier(op)) return 0;
      if (op.kind === "store" && op.slot === slot)
        return valueOrigin(block, op.value, i, depth + 1);
      // A previously verified read is a proof checkpoint, not a new assumption.
      // Compare identities at the read: the slot may have been reassigned since
      // the receiver was loaded. Equal layouts alone do not establish identity.
      if (op.kind === "record-read" && reads[op.id] === 1) {
        const checked = valueOrigin(block, op.object, i, depth + 1);
        if (checked > 0 && checked === slotOrigin(block, slot, i, depth + 1))
          return -op.record - 1;
      }
    }
    return slot + 1;
  }
  function valueOrigin(
    block: Block,
    value: number,
    before: number,
    depth: number,
  ): number {
    if (depth > 128) return 0;
    for (let i = before - 1; i >= 0; i--) {
      if (!step()) return 0;
      const op = block.instructions[i];
      if (op === undefined) throw "record fact instruction invariant";
      if (barrier(op)) return 0;
      if (
        op.kind === "record-read" &&
        op.object === value &&
        reads[op.id] === 1
      )
        return -op.record - 1;
      if (instructionResult(op) !== value) continue;
      if (op.kind === "record-new") return -op.record - 1;
      if (op.kind === "load") return slotOrigin(block, op.slot, i, depth + 1);
      if (op.kind === "reference-value" || op.kind === "reference-wrap")
        return valueOrigin(block, op.value, i, depth + 1);
      return 0;
    }
    return 0;
  }
  function proves(
    block: Block,
    object: number,
    record: number,
    before: number,
  ): boolean {
    let matched = false;
    let origin = valueOrigin(block, object, before, 0),
      cursor = block.id;
    for (let hops = 0; hops < 32 && origin !== 0; hops++) {
      if (!step()) return false;
      if (origin < 0) {
        if (-origin - 1 === record) matched = true;
        break;
      }
      const previous = predecessors[cursor];
      if (previous === undefined || previous === 0 || previous === 0xffffffff)
        break;
      const source = fn.blocks[previous - 1];
      if (source === undefined) throw "record fact predecessor invariant";
      const prior = source.terminator,
        slot = origin - 1;
      // A record/cell read may define the receiver slot on the successful edge.
      if (
        (prior.kind === "record" ||
          prior.kind === "record-cell" ||
          prior.kind === "cell") &&
        prior.slot === slot
      )
        break;
      origin = slotOrigin(source, slot, source.instructions.length, 0);
      if (
        (prior.kind === "record" || prior.kind === "record-cell") &&
        prior.consequent === cursor &&
        prior.record === record &&
        origin !== 0
      ) {
        const checked = valueOrigin(
          source,
          prior.object,
          source.instructions.length,
          0,
        );
        if (origin > 0 && origin === checked) {
          matched = true;
          break;
        }
      }
      cursor = source.id;
    }
    return matched && !exhausted;
  }
  // Only established reads may seed later proofs. Revisit unresolved reads when
  // a checkpoint was added, so block numbering cannot affect soundness or
  // completeness. Cycles without an initial proof never acquire a checkpoint.
  let changed = true;
  while (changed) {
    changed = false;
    let pending = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "record proof block invariant";
      if (!step()) return undefined;
      for (let index = 0; index < block.instructions.length; index++) {
        if (!step()) return undefined;
        const op = block.instructions[index];
        if (op === undefined) throw "record proof instruction invariant";
        if (op.kind !== "record-read" || reads[op.id] === 1) continue;
        if (proves(block, op.object, op.record, index)) {
          reads[op.id] = 1;
          changed = true;
        } else pending = true;
      }
      const term = block.terminator;
      if (
        includeGuards &&
        proven[block.id] !== 1 &&
        (term.kind === "record" || term.kind === "record-cell") &&
        proves(block, term.object, term.record, block.instructions.length)
      )
        proven[block.id] = 1;
      if (exhausted) return undefined;
    }
    if (!pending) break;
  }
  return { guards: proven, reads, work };
}
export function provenRecordGuards(
  fn: FunctionIR,
  maxWork: number = 100000,
  stableLayouts: boolean = false,
): Uint8Array | undefined {
  return analyzeRecordAccesses(fn, maxWork, stableLayouts)?.guards;
}
export function provenRecordReads(
  fn: FunctionIR,
  maxWork: number = 100000,
  stableLayouts: boolean = false,
): Uint8Array | undefined {
  // Verification needs read proofs only. Optimization-only guard queries can
  // otherwise exhaust its budget and reject valid, already-lowered reads.
  return analyzeRecordAccesses(fn, maxWork, stableLayouts, false)?.reads;
}
/** Codegen-only descriptor guard proofs for verified IR by forward must-dataflow.
 * A fact maps a managed frame slot to the exact layout of the object it holds
 * at block entry; facts meet by intersection, so a check repeated on every
 * incoming path is proven across joins and loops. Facts come only from
 * constructors, successful descriptor checks and verified direct reads (whose
 * layout the verifier already proved); stores replace them, transfer slots of
 * record/cell terminators lose them, exception entries start empty and, when
 * layouts are not module-stable, calls and host effects clear them. Slots are
 * collector roots, so moving objects keeps their layout. Entry facts are sparse
 * per-block lists that only shrink after a block is first reached, so work
 * scales with live facts rather than slots times blocks. Unreached blocks keep
 * every check. The result never feeds verification or IR rewriting; exhaustion
 * returns undefined so callers keep their own proofs. */
export function dataflowRecordGuards(
  fn: FunctionIR,
  maxWork: number = 2000000,
  stableLayouts: boolean = false,
): Uint8Array | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  const blockCount = fn.blocks.length,
    proven = new Uint8Array(blockCount),
    slotIndex = new Uint32Array(fn.slots.length);
  let tracked = 0;
  for (let slot = 0; slot < fn.slots.length; slot++) {
    const type = fn.slots[slot];
    if (type === "reference" || type === "optional-reference")
      slotIndex[slot] = ++tracked;
  }
  if (tracked === 0 || fn.blocks[fn.entry] === undefined) return proven;
  let work = fn.slots.length + blockCount,
    maximum = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "record dataflow block invariant";
    work += block.instructions.length + 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "record dataflow instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id >= maximum) maximum = id + 1;
    }
  }
  if (work > maxWork) return undefined;
  // Value facts are block-local; a generation stamp discards stale entries.
  const layouts = new Uint32Array(maximum),
    sources = new Uint32Array(maximum),
    loadedVersions = new Uint32Array(maximum),
    stamps = new Uint32Array(maximum),
    // Entry facts: pairs of (1-based tracked slot, layout + 1) in `pool`.
    starts = new Uint32Array(blockCount),
    counts = new Uint32Array(blockCount),
    reached = new Uint8Array(blockCount),
    queued = new Uint8Array(blockCount),
    queue = new Uint32Array(blockCount),
    current = new Uint32Array(tracked + 1),
    versions = new Uint32Array(tracked + 1),
    outgoing = new Uint32Array(tracked + 1),
    outgoingStamps = new Uint32Array(tracked + 1),
    // Scratch sets bounded by the tracked slot count, with explicit lengths.
    activeStamps = new Uint32Array(tracked + 1),
    active = new Uint32Array(tracked),
    touched = new Uint32Array(tracked),
    facts = new Uint32Array(tracked * 2);
  const pool: number[] = [];
  let generation = 0,
    outgoingGeneration = 0,
    activeCount = 0,
    touchedCount = 0,
    factCount = 0,
    activeGeneration = 1,
    head = 0,
    tail = 0,
    pending = 0;
  function enqueue(target: number): void {
    if (queued[target] === 1) return;
    queued[target] = 1;
    queue[tail] = target;
    tail = tail + 1 === blockCount ? 0 : tail + 1;
    pending++;
  }
  function set(index: number, layout: number): void {
    if (layout !== 0 && activeStamps[index] !== activeGeneration) {
      activeStamps[index] = activeGeneration;
      active[activeCount++] = index;
    }
    current[index] = layout;
  }
  /** Collect the live facts of `current` into `facts`, deduplicated. */
  function collect(): void {
    factCount = 0;
    outgoingGeneration++;
    for (let position = 0; position < activeCount; position++) {
      const index = active[position] ?? 0,
        layout = current[index] ?? 0;
      if (layout === 0) continue;
      outgoingStamps[index] = outgoingGeneration;
      outgoing[index] = layout;
      facts[factCount++] = index;
      facts[factCount++] = layout;
    }
    work += activeCount;
  }
  /** Meet the collected `facts` (also indexed by `outgoing`) into a target. */
  function meet(target: number, empty: boolean): void {
    if (reached[target] === 0) {
      reached[target] = 1;
      starts[target] = pool.length;
      if (!empty)
        for (let position = 0; position < factCount; position++)
          pool.push(facts[position] ?? 0);
      counts[target] = empty ? 0 : factCount / 2;
      work += factCount;
      enqueue(target);
      return;
    }
    const start = starts[target] ?? 0,
      count = counts[target] ?? 0;
    let kept = 0;
    for (let pair = 0; pair < count; pair++) {
      const index = pool[start + pair * 2] ?? 0,
        layout = pool[start + pair * 2 + 1] ?? 0;
      if (
        !empty &&
        outgoingStamps[index] === outgoingGeneration &&
        outgoing[index] === layout
      ) {
        pool[start + kept * 2] = index;
        pool[start + kept * 2 + 1] = layout;
        kept++;
      }
    }
    work += count + 1;
    if (kept !== count) {
      counts[target] = kept;
      enqueue(target);
    }
  }
  function layoutOf(value: number): number {
    return stamps[value] === generation ? (layouts[value] ?? 0) : 0;
  }
  function define(
    value: number,
    layout: number,
    source: number,
    version: number,
  ): void {
    stamps[value] = generation;
    layouts[value] = layout;
    sources[value] = source;
    loadedVersions[value] = version;
  }
  /** The tracked slot (1-based) still holding a value's object here, or 0. */
  function holder(value: number): number {
    if (stamps[value] !== generation) return 0;
    const source = sources[value] ?? 0;
    return source !== 0 &&
      (versions[source] ?? 0) === (loadedVersions[value] ?? 0)
      ? source
      : 0;
  }
  function clearFacts(): void {
    for (let position = 0; position < activeCount; position++)
      current[active[position] ?? 0] = 0;
    work += activeCount;
    activeCount = 0;
    activeGeneration++;
  }
  // Leaves `current` and value facts as they stand before the terminator.
  function simulate(block: Block): void {
    generation++;
    clearFacts();
    for (let position = 0; position < touchedCount; position++)
      versions[touched[position] ?? 0] = 0;
    touchedCount = 0;
    const start = starts[block.id] ?? 0,
      count = counts[block.id] ?? 0;
    for (let pair = 0; pair < count; pair++)
      set(pool[start + pair * 2] ?? 0, pool[start + pair * 2 + 1] ?? 0);
    work += count;
    for (const op of block.instructions) {
      if (op === undefined) throw "record dataflow instruction invariant";
      work++;
      if (op.kind === "load") {
        const index = slotIndex[op.slot] ?? 0;
        if (index === 0) define(op.id, 0, 0, 0);
        else define(op.id, current[index] ?? 0, index, versions[index] ?? 0);
      } else if (op.kind === "store") {
        const index = slotIndex[op.slot] ?? 0;
        if (index !== 0) {
          if ((versions[index] ?? 0) === 0) touched[touchedCount++] = index;
          versions[index] = (versions[index] ?? 0) + 1;
          set(index, layoutOf(op.value));
        }
      } else if (op.kind === "record-new") define(op.id, op.record + 1, 0, 0);
      else if (op.kind === "reference-value" || op.kind === "reference-wrap") {
        if (stamps[op.value] === generation)
          define(
            op.id,
            layouts[op.value] ?? 0,
            sources[op.value] ?? 0,
            loadedVersions[op.value] ?? 0,
          );
        else define(op.id, 0, 0, 0);
      } else if (op.kind === "record-read") {
        // Verified IR: the verifier proved this receiver's layout.
        const object = op.object,
          slot = holder(object);
        if (stamps[object] === generation) layouts[object] = op.record + 1;
        else define(object, op.record + 1, 0, 0);
        if (slot !== 0) set(slot, op.record + 1);
        define(op.id, 0, 0, 0);
      } else {
        if (
          !stableLayouts &&
          (op.kind === "call" ||
            op.kind === "call-indirect" ||
            op.kind === "host-call")
        ) {
          clearFacts();
          generation++;
        }
        const id = instructionResult(op);
        if (id !== undefined) define(id, 0, 0, 0);
      }
    }
  }
  function kill(slot: number): void {
    const index = slotIndex[slot] ?? 0;
    if (index !== 0) current[index] = 0;
  }
  reached[fn.entry] = 1;
  enqueue(fn.entry);
  while (pending > 0) {
    if (work > maxWork) return undefined;
    const index = queue[head] ?? 0;
    head = head + 1 === blockCount ? 0 : head + 1;
    pending--;
    queued[index] = 0;
    const block = fn.blocks[index];
    if (block === undefined) throw "record dataflow block invariant";
    simulate(block);
    const term = block.terminator;
    if (term.kind === "record" || term.kind === "record-cell") {
      const slot = holder(term.object);
      kill(term.slot);
      collect();
      meet(term.alternate, false);
      if (slot !== 0 && slotIndex[term.slot] !== slot)
        set(slot, term.record + 1);
      collect();
      meet(term.consequent, false);
    } else if (term.kind === "cell") {
      kill(term.slot);
      collect();
      meet(term.consequent, false);
      meet(term.alternate, false);
    } else if (term.kind === "branch") {
      collect();
      meet(term.consequent, false);
      meet(term.alternate, false);
    } else if (term.kind === "jump") {
      collect();
      meet(term.target, false);
    }
    const handler = block.exception;
    if (handler !== undefined) meet(handler.target, true);
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "record dataflow block invariant";
    if (reached[block.id] === 0) continue;
    const term = block.terminator;
    if (term.kind !== "record" && term.kind !== "record-cell") continue;
    simulate(block);
    if (layoutOf(term.object) === term.record + 1) proven[block.id] = 1;
  }
  return work > maxWork ? undefined : proven;
}
