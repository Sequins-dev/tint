import { createNumberIndex } from "@tint/foundation/collections/key-index";
import { instructionResult } from "./operands.ts";
import {
  analyzeLiveSlotRows,
  analyzeLiveSlots,
  fitsLiveRows,
} from "./liveness.ts";
import type {
  FunctionBodySource,
  FunctionIR,
  Block,
  Instruction,
  ModuleIR,
} from "./model.ts";
/** Host operations that neither write managed memory outside fields nor
 * admit code the closed-world analyses cannot see. A forced collection is
 * the allocator's own slow path (it moves objects and preserves layouts, as
 * any allocation may), so it qualifies. */
function closedWorldHostOperation(operation: string): boolean {
  switch (operation) {
    case "collect-garbage":
    case "cpu-pause":
    case "sha256-rounds":
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
    case "environment-copy":
    // Shrinks a typed-array view to zero elements: no descriptor or
    // reference changes, and no fact relies on a length across a call.
    case "native-array-detach":
    case "context-domain":
    case "stack-overflow-is":
    case "engine-range-error":
    case "root-head":
    case "memory-map":
    // Fixed callback stubs hold only raw metadata and jump into a verified
    // transition thunk. Their publication cannot open a managed entry.
    case "executable-callback-map":
    case "executable-callback-write":
    case "executable-callback-unmap":
    case "memory-read-word":
    // Raw-window reads: a binary64, or code units copied into a fresh string
    // through the ordinary allocator.
    case "memory-read-float64":
    case "memory-read-string":
    // A string object's address, read from the reference.
    case "string-address":
    // A signature query reads immutable closure metadata. Only a separate
    // raw execution capability can use an address to open the call graph.
    case "native-function-signature":
    case "process-id":
    case "memory-page-bytes":
    case "processor-count":
    case "cpu-sha256":
    case "target-os":
    case "target-architecture":
    case "jit-debug-descriptor":
    case "jit-debug-register":
      return true;
    default:
      return isolateHostOperation(operation);
  }
}
/** Isolate (Worker and agent) operations (docs/design-worker-runtime.md).
 * The only entry a hosted thread can start is the image's own hosted entry
 * (`hosted-thread-entry`), which builds a fresh context with its own heap and
 * module instances and reaches the program through the same closed root.
 * Isolates exchange no managed pointers: messages are copied or transferred
 * bytes, and shared memory, parking words, message packets (which
 * `memory-write-float64` and `memory-write-string` fill), shared string
 * bodies (which `string-copy` fills and `string-at` references: immutable
 * flat strings, like image literals) and the mappings `memory-unmap`
 * releases are outside every managed heap. None of these operations writes
 * a managed object or creates a function value, so the program's
 * interprocedural facts and generational write tracking hold in every
 * isolate. */
function isolateHostOperation(operation: string): boolean {
  switch (operation) {
    case "thread-start":
    case "thread-join":
    case "hosted-thread-entry":
    case "memory-unmap":
    case "word-park":
    case "word-wake":
    case "shared-read-unsigned":
    case "shared-write-unsigned":
    case "shared-read-word64":
    case "shared-write-word64":
    case "shared-compare-exchange-unsigned":
    case "shared-compare-exchange-word64":
    case "memory-write-float64":
    case "memory-write-string":
    case "string-at":
    case "string-copy":
      return true;
    default:
      return false;
  }
}
/** Additional Test262/JIT image capabilities that cannot replace a managed
 * object's descriptor, although they leave the closed world. Executable
 * writes target non-heap mappings; executable calls enter code compiled from
 * verified IR, whose writes are managed field writes; collection preserves
 * layouts; descriptor/signature queries only read; collector helper threads
 * belong to collector units. memory-write-word and memory-move can overwrite
 * any header, and collector configuration belongs to collector units, so
 * neither qualifies. */
function descriptorPreservingHostOperation(operation: string): boolean {
  if (closedWorldHostOperation(operation)) return true;
  switch (operation) {
    case "executable-map":
    case "executable-write":
    case "executable-call-number":
    case "executable-call-value":
    case "executable-call-managed":
    case "executable-unmap":
    case "external-memory-register":
    case "stack-maps-register":
    case "native-function-descriptor":
    case "native-value-function-descriptor":
    case "native-value-function-signature":
    case "collector-worker-entry":
    case "permanent-function-address":
    case "permanent-array-address":
      return true;
    default:
      return false;
  }
}
function everyHostOperation(
  module: ModuleIR,
  allowed: (operation: string) => boolean,
  bodies: FunctionBodySource | undefined,
): boolean {
  for (const header of module.functions) {
    if (header === undefined) throw "layout effect function invariant";
    const fn = bodies?.get(header.id) ?? header;
    try {
      for (const block of fn.blocks) {
        if (block === undefined) throw "layout effect block invariant";
        for (const op of block.instructions) {
          if (op === undefined) throw "layout effect instruction invariant";
          if (op.kind === "host-call" && !allowed(op.operation)) return false;
          // A bound raw-window write that is an IR instruction: like
          // memory-write-bytes, its window may be any writable memory.
          if (op.kind === "string-flatten-into" && !allowed(op.kind))
            return false;
        }
      }
    } finally {
      bodies?.release(header.id);
    }
  }
  return true;
}
/** Whole-module effect proof for verified IR. Managed writes never replace an
 * object's descriptor. Internal calls and managed imports obey the same
 * descriptor-stability contract; allocation/collection preserve layouts.
 * Raw-memory host capabilities break that contract, and foreign code entry
 * breaks the closed world that interprocedural facts (record flows, word
 * arguments, call boundaries, list reachability, generational write
 * tracking) also rely on. New host operations are unsafe until explicitly
 * classified. This is not a proof for externally supplied code or arbitrary
 * FFI callbacks. */
export function stableRecordLayouts(
  module: ModuleIR,
  bodies?: FunctionBodySource,
): boolean {
  return everyHostOperation(module, closedWorldHostOperation, bodies);
}
/** Calls into code published at run time (executable memory). */
function executableCallOperation(operation: string): boolean {
  return (
    operation === "executable-call-number" ||
    operation === "executable-call-value" ||
    operation === "executable-call-managed"
  );
}
/** The generational mutator's write proof: every managed write carries a
 * barrier. Every reachable host operation must preserve descriptors (a raw
 * word write or move could store an unbarriered reference, so those are
 * rejected). Writing code bytes into executable memory is not a managed
 * write, but the code a call enters is opaque here, so executable calls are
 * accepted only under the image's `trustedExecutableCode` contract: every
 * entry it calls was produced by its own unit linker, which rejects units
 * compiled with a different barrier policy (docs/native-code-loading.md,
 * "Trusted executable code"). */
export function trackedManagedWrites(
  module: ModuleIR,
  bodies: FunctionBodySource | undefined,
  trustedExecutableCode: boolean,
): boolean {
  return everyHostOperation(
    module,
    (operation) =>
      descriptorPreservingHostOperation(operation) &&
      (trustedExecutableCode || !executableCallOperation(operation)),
    bodies,
  );
}
/** Descriptor stability alone: no reachable operation can replace a managed
 * object's descriptor, so a descriptor proven for an object held in a slot
 * survives calls. Sufficient for intraprocedural descriptor proofs (guards and
 * verified direct reads), not for closed-world interprocedural facts. */
export function stableDescriptors(
  module: ModuleIR,
  bodies?: FunctionBodySource,
): boolean {
  return everyHostOperation(module, descriptorPreservingHostOperation, bodies);
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
  provenPresence?: Set<number>,
  provenMismatches?: Set<number>,
):
  | {
      readonly guards: Uint8Array;
      readonly reads: Uint8Array;
      readonly work: number;
    }
  | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  // Proofs are indexed by result id. Ids are sparse after optimization (a
  // large inlined function can number far beyond its instruction count), so
  // the id range sizes the table but is not proof work: work is charged per
  // visited block and instruction below.
  let maximum = 0;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions)
      if (op !== undefined && op.kind === "record-read")
        maximum = Math.max(maximum, op.id + 1);
  }
  const reads = new Uint8Array(maximum);
  const blockCount = fn.blocks.length,
    predecessors = new Uint32Array(blockCount),
    proven = new Uint8Array(blockCount);
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
      if (
        op.kind === "closure-environment" &&
        !fn.exported &&
        fn.closureEnvironment !== undefined
      )
        return -fn.closureEnvironment - 1;
      if (op.kind === "load") return slotOrigin(block, op.slot, i, depth + 1);
      if (
        op.kind === "reference-value" ||
        op.kind === "reference-wrap" ||
        op.kind === "general-wrap" ||
        (op.kind === "general-value" && op.type === "reference")
      )
        return valueOrigin(block, op.value, i, depth + 1);
      // Block-local SSA identity for a direct field load: lets a check in this
      // block prove a slot holding the same loaded reference at block exit,
      // without crossing to predecessors or interfering with LICM on
      // function-environment reads.
      if (op.kind === "record-read") return fn.slots.length + 1 + value;
      return 0;
    }
    return 0;
  }
  function provenLayout(block: Block, object: number, before: number): number {
    let layout = -1;
    let origin = valueOrigin(block, object, before, 0),
      cursor = block.id;
    // Each hop is charged as work. Inlined straight-line code can put the
    // establishing check many blocks back, so the walk is bounded only by the
    // block count (a unique-predecessor chain that revisits a block is an
    // unreachable cycle), never by a fixed distance the verifier would have
    // to share with every pass that lowers or moves reads.
    for (let hops = 0; hops < blockCount && origin !== 0; hops++) {
      if (!step()) return -1;
      if (origin < 0) {
        layout = -origin - 1;
        break;
      }
      if (origin > fn.slots.length) break;
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
        origin !== 0
      ) {
        const checked = valueOrigin(
          source,
          prior.object,
          source.instructions.length,
          0,
        );
        if (origin > 0 && origin === checked) {
          layout = prior.record;
          break;
        }
      }
      if (
        prior.kind === "branch" &&
        prior.consequent === cursor &&
        origin > 0
      ) {
        for (let i = source.instructions.length - 1; i >= 0; i--) {
          const condOp = source.instructions[i];
          if (condOp === undefined) throw "record fact instruction invariant";
          if (instructionResult(condOp) !== prior.condition) continue;
          if (condOp.kind === "record-has") {
            const checked = valueOrigin(source, condOp.object, i, 0);
            if (origin === checked) layout = condOp.record;
          } else if (condOp.kind === "general-record-is") {
            const checked = valueOrigin(source, condOp.value, i, 0);
            if (origin === checked) layout = condOp.record;
          }
          break;
        }
        if (layout >= 0) break;
      }
      cursor = source.id;
    }
    return exhausted ? -1 : layout;
  }
  function proves(
    block: Block,
    object: number,
    record: number,
    before: number,
  ): boolean {
    return provenLayout(block, object, before) === record;
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
        (term.kind === "record" || term.kind === "record-cell")
      ) {
        const known = provenLayout(
          block,
          term.object,
          block.instructions.length,
        );
        if (known === term.record) proven[block.id] = 1;
        else if (
          provenMismatches !== undefined &&
          known >= 0 &&
          term.kind === "record"
        )
          provenMismatches.add(block.id);
      }
      if (exhausted) return undefined;
    }
    if (!pending) break;
  }
  if (provenPresence !== undefined) {
    for (const block of fn.blocks) {
      if (block === undefined) throw "record proof block invariant";
      for (let index = 0; index < block.instructions.length; index++) {
        if (!step()) return undefined;
        const op = block.instructions[index];
        if (op === undefined) throw "record proof instruction invariant";
        if (
          op.kind === "record-has" &&
          proves(block, op.object, op.record, index)
        )
          provenPresence.add(op.id);
      }
    }
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
/** Least work the verifier spends proving a function's direct record reads. */
export const verifierRecordWork = 1000000;
/** Work per instruction and terminator past the floor: proofs cost a few
 * steps per instruction (the largest Test262 host initializer needs 4.5), so
 * a large function keeps its reads verifiable instead of failing every one
 * at a fixed limit. */
const verifierRecordWorkPerInstruction = 16;
/** The verifier's work limit for proving `fn`'s direct record reads; past it
 * verification fails loudly. Passes that create or move direct reads check
 * them against the same budget, so IR they keep stays verifiable. */
export function verifierRecordBudget(fn: FunctionIR): number {
  let size = 0;
  for (const block of fn.blocks)
    if (block !== undefined) size += block.instructions.length + 1;
  const scaled = size * verifierRecordWorkPerInstruction;
  return scaled > verifierRecordWork ? scaled : verifierRecordWork;
}
/** Whether every record read `before` proves (as the verifier does, with or
 * without module-stable layouts, under the verifier's budget) is still proven
 * in `after`, a rewrite that keeps value IDs. Passes that move checks or slot
 * traffic use it to keep verified reads verified. */
export function recordReadsKept(
  before: FunctionIR,
  after: FunctionIR,
): boolean {
  const beforeWork = verifierRecordBudget(before),
    afterWork = verifierRecordBudget(after);
  for (let pass = 0; pass < 2; pass++) {
    const stable = pass === 1;
    const kept = provenRecordReads(before, beforeWork, stable);
    if (kept === undefined) return false;
    const now = provenRecordReads(after, afterWork, stable);
    if (now === undefined) return false;
    for (let id = 0; id < kept.length; id++)
      if (kept[id] === 1 && now[id] !== 1) return false;
  }
  return true;
}
/** Two-layout fact codes start here (record + 1 codes stay below). */
const pairBit = 0x80000000;
/** Pairs need both codes below this bound to key their interning. */
const pairKeyLimit = 0x200000;
/** Codegen-only descriptor guard proofs for verified IR by forward must-dataflow.
 * A fact maps a managed frame slot to the layout of the object it holds at
 * block entry: one exact layout, or one of two (a union whose dispatch joins
 * again); facts meet by union up to two layouts, so a check repeated on every
 * incoming path is proven across joins and loops. A failed test of one of
 * two layouts leaves the other. Only exact facts prove a guard; two-layout
 * facts are reported to `layoutPairs` for codegen, whose fused union
 * dispatch reads a field placed alike in both without a test. Facts come only from
 * constructors, successful descriptor checks and verified direct reads (whose
 * layout the verifier already proved); stores replace them, transfer slots of
 * record/cell terminators lose them, exception entries start empty and, when
 * layouts are not module-stable, calls and host effects clear them. Slots are
 * collector roots, so moving objects keeps their layout. Entry facts are sparse
 * per-block lists that only shrink after a block is first reached, and hold
 * only slots live into the block (a dead slot is stored before any read, so
 * its fact can prove nothing): work and memory scale with live facts rather
 * than slots times blocks, even in the largest functions. Unreached blocks keep
 * every check. The result never feeds verification or IR rewriting; exhaustion
 * returns undefined so callers keep their own proofs. */
export function dataflowRecordGuards(
  fn: FunctionIR,
  maxWork: number = 2000000,
  stableLayouts: boolean = false,
  /** Dense live-in table limit in words (tests force the list form). */
  denseRowWords?: number,
  /** Receives each reached `record-has` whose object the same facts prove
   * to be its layout (so never null): its guard is redundant. */
  provenPresence?: Set<Instruction>,
  /** Receives, by block, the two layouts a reached `record` or
   * `record-cell` terminator's object is known to be one of (never null). */
  layoutPairs?: Map<number, readonly number[]>,
): Uint8Array | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  const blockCount = fn.blocks.length,
    proven = new Uint8Array(blockCount),
    slotIndex = new Uint32Array(fn.slots.length);
  let tracked = 0;
  const trackedSlots: number[] = [];
  for (let slot = 0; slot < fn.slots.length; slot++) {
    const type = fn.slots[slot];
    if (
      type === "reference" ||
      type === "optional-reference" ||
      type === "general"
    ) {
      slotIndex[slot] = ++tracked;
      trackedSlots.push(slot);
    }
  }
  if (tracked === 0 || fn.blocks[fn.entry] === undefined) return proven;
  let work = fn.slots.length + blockCount,
    maxBlockOps = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "record dataflow block invariant";
    const opCount = block.instructions.length;
    work += opCount + 1;
    if (opCount > maxBlockOps) maxBlockOps = opCount;
    for (const op of block.instructions)
      if (op === undefined) throw "record dataflow instruction invariant";
  }
  if (work > maxWork) return undefined;
  // Live-in sets as dense rows when they fit (same sets and work).
  const dense = fitsLiveRows(fn, trackedSlots.length, denseRowWords),
    rowLiveness = dense
      ? analyzeLiveSlotRows(fn, maxWork - work, trackedSlots)
      : undefined,
    listLiveness = dense
      ? undefined
      : analyzeLiveSlots(fn, maxWork - work, trackedSlots);
  if (rowLiveness === undefined && listLiveness === undefined) return undefined;
  work += rowLiveness?.work ?? listLiveness?.work ?? 0;
  const liveSlots = listLiveness?.slots;
  // Value facts are block-local; interning per block bounds the four scratch
  // lanes by the largest block rather than the function's maximum SSA ID.
  const valueCapacity = maxBlockOps * 2 + 2,
    valueIds = createNumberIndex(),
    layouts = new Uint32Array(valueCapacity),
    sources = new Uint32Array(valueCapacity),
    loadedVersions = new Uint32Array(valueCapacity),
    stamps = new Uint32Array(valueCapacity),
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
    facts = new Uint32Array(tracked * 2),
    // Tracked slots live into the block being met, by stamp.
    liveStamps = new Uint32Array(tracked + 1);
  const pool: number[] = [];
  // Set for the final pass, which collects record-has proofs.
  let recordPresence = false;
  const presence: Set<Instruction> = provenPresence ?? new Set<Instruction>();
  let generation = 0,
    outgoingGeneration = 0,
    activeCount = 0,
    touchedCount = 0,
    factCount = 0,
    activeGeneration = 1,
    liveGeneration = 0,
    head = 0,
    tail = 0,
    pending = 0;
  // Layout codes: 0 unknown, record + 1 for one exact layout, pairBit + i
  // for one of the exact codes pairLow[i] < pairHigh[i].
  const pairLow: number[] = [],
    pairHigh: number[] = [],
    pairCodes = new Map<number, number>();
  /** The least precise code covering both, or 0 beyond two layouts. */
  function join(a: number, b: number): number {
    if (a === b) return a;
    if (a === 0 || b === 0) return 0;
    if (a >= pairBit || b >= pairBit) {
      // A pair absorbs either of its own layouts.
      const pairCode = a >= pairBit ? a : b,
        exact = a >= pairBit ? b : a;
      if (exact >= pairBit) return 0;
      const index = pairCode - pairBit;
      return pairLow[index] === exact || pairHigh[index] === exact
        ? pairCode
        : 0;
    }
    const low = a < b ? a : b,
      high = a < b ? b : a;
    if (high >= pairKeyLimit) return 0;
    const key = low * pairKeyLimit + high,
      known = pairCodes.get(key);
    if (known !== undefined) return known;
    const code = pairBit + pairLow.length;
    pairLow.push(low);
    pairHigh.push(high);
    pairCodes.set(key, code);
    return code;
  }
  /** The other layout of a pair `code` that includes `exact`, or 0. */
  function remaining(code: number, exact: number): number {
    if (code < pairBit) return 0;
    const index = code - pairBit;
    if (pairLow[index] === exact) return pairHigh[index] ?? 0;
    if (pairHigh[index] === exact) return pairLow[index] ?? 0;
    return 0;
  }
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
      let kept = 0;
      if (!empty) {
        liveGeneration++;
        if (rowLiveness !== undefined) {
          // Row bit `index` is tracked slot `index`, stamped as index + 1.
          const rows = rowLiveness.rows,
            base = target * rowLiveness.rowWords,
            end = rowLiveness.ends[target] ?? 0;
          for (let word = rowLiveness.starts[target] ?? 0; word < end; word++) {
            let bits = rows[base + word] ?? 0;
            while (bits !== 0) {
              const low = (bits & -bits) >>> 0;
              bits = (bits ^ low) >>> 0;
              liveStamps[word * 32 + 32 - Math.clz32(low)] = liveGeneration;
              work++;
            }
          }
        } else {
          const live = liveSlots?.[target] ?? [];
          for (const slot of live)
            if (slot !== undefined)
              liveStamps[slotIndex[slot] ?? 0] = liveGeneration;
          work += live.length;
        }
        for (let position = 0; position < factCount; position += 2) {
          const index = facts[position] ?? 0;
          if (liveStamps[index] !== liveGeneration) continue;
          pool.push(index);
          pool.push(facts[position + 1] ?? 0);
          kept++;
        }
      }
      counts[target] = kept;
      work += factCount;
      enqueue(target);
      return;
    }
    const start = starts[target] ?? 0,
      count = counts[target] ?? 0;
    let kept = 0,
      widened = false;
    for (let pair = 0; pair < count; pair++) {
      const index = pool[start + pair * 2] ?? 0,
        layout = pool[start + pair * 2 + 1] ?? 0,
        joined =
          !empty && outgoingStamps[index] === outgoingGeneration
            ? join(layout, outgoing[index] ?? 0)
            : 0;
      if (joined !== 0) {
        pool[start + kept * 2] = index;
        pool[start + kept * 2 + 1] = joined;
        kept++;
        if (joined !== layout) widened = true;
      }
    }
    work += count + 1;
    if (kept !== count || widened) {
      counts[target] = kept;
      enqueue(target);
    }
  }
  function layoutOf(value: number): number {
    const idx = valueIds.lookup(value);
    return idx >= 0 && stamps[idx] === generation ? (layouts[idx] ?? 0) : 0;
  }
  function define(
    value: number,
    layout: number,
    source: number,
    version: number,
  ): void {
    const idx = valueIds.intern(value);
    stamps[idx] = generation;
    layouts[idx] = layout;
    sources[idx] = source;
    loadedVersions[idx] = version;
  }
  /** The tracked slot (1-based) still holding a value's object here, or 0. */
  function holder(value: number): number {
    const idx = valueIds.lookup(value);
    if (idx < 0 || stamps[idx] !== generation) return 0;
    const source = sources[idx] ?? 0;
    return source !== 0 &&
      (versions[source] ?? 0) === (loadedVersions[idx] ?? 0)
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
    valueIds.clear();
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
      else if (op.kind === "record-has") {
        if (recordPresence && layoutOf(op.object) === op.record + 1) {
          const proven: Instruction = op;
          presence.add(proven);
        }
        const srcSlot = holder(op.object);
        if (srcSlot !== 0)
          define(op.id, op.record + 1, srcSlot, versions[srcSlot] ?? 0);
        else define(op.id, 0, 0, 0);
      } else if (op.kind === "general-record-is") {
        const srcSlot = holder(op.value);
        if (srcSlot !== 0)
          define(op.id, op.record + 1, srcSlot, versions[srcSlot] ?? 0);
        else define(op.id, 0, 0, 0);
      } else if (
        op.kind === "closure-environment" &&
        !fn.exported &&
        fn.closureEnvironment !== undefined
      )
        define(op.id, fn.closureEnvironment + 1, 0, 0);
      else if (
        op.kind === "reference-value" ||
        op.kind === "reference-wrap" ||
        op.kind === "general-wrap" ||
        (op.kind === "general-value" && op.type === "reference")
      ) {
        const srcIdx = valueIds.lookup(op.value);
        if (srcIdx >= 0 && stamps[srcIdx] === generation)
          define(
            op.id,
            layouts[srcIdx] ?? 0,
            sources[srcIdx] ?? 0,
            loadedVersions[srcIdx] ?? 0,
          );
        else define(op.id, 0, 0, 0);
      } else if (op.kind === "record-read") {
        // Verified IR: the verifier proved this receiver's layout.
        const object = op.object,
          slot = holder(object),
          objIdx = valueIds.lookup(object);
        if (objIdx >= 0 && stamps[objIdx] === generation)
          layouts[objIdx] = op.record + 1;
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
      const slot = holder(term.object),
        narrowed = slot !== 0 && slotIndex[term.slot] !== slot;
      kill(term.slot);
      const other = narrowed
        ? remaining(current[slot] ?? 0, term.record + 1)
        : 0;
      if (other !== 0) set(slot, other);
      collect();
      meet(term.alternate, false);
      if (narrowed) set(slot, term.record + 1);
      collect();
      meet(term.consequent, false);
    } else if (term.kind === "cell") {
      kill(term.slot);
      collect();
      meet(term.consequent, false);
      meet(term.alternate, false);
    } else if (term.kind === "branch") {
      const condSlot = holder(term.condition);
      const condLayout = condSlot !== 0 ? layoutOf(term.condition) : 0;
      if (condSlot !== 0 && condLayout > 0 && condLayout < pairBit) {
        const saved = current[condSlot] ?? 0;
        collect();
        meet(term.alternate, false);
        set(condSlot, condLayout);
        collect();
        meet(term.consequent, false);
        set(condSlot, saved);
      } else {
        collect();
        meet(term.consequent, false);
        meet(term.alternate, false);
      }
    } else if (term.kind === "jump") {
      collect();
      meet(term.target, false);
    }
    const handler = block.exception;
    if (handler !== undefined) meet(handler.target, true);
  }
  recordPresence = provenPresence !== undefined;
  for (const block of fn.blocks) {
    if (block === undefined) throw "record dataflow block invariant";
    if (reached[block.id] === 0) continue;
    const term = block.terminator;
    const checked = term.kind === "record" || term.kind === "record-cell";
    if (!checked && !recordPresence) continue;
    simulate(block);
    if (term.kind !== "record" && term.kind !== "record-cell") continue;
    const layout = layoutOf(term.object);
    if (layout === term.record + 1) proven[block.id] = 1;
    else if (layoutPairs !== undefined && layout >= pairBit)
      layoutPairs.set(block.id, [
        (pairLow[layout - pairBit] ?? 0) - 1,
        (pairHigh[layout - pairBit] ?? 0) - 1,
      ]);
  }
  return work > maxWork ? undefined : proven;
}
