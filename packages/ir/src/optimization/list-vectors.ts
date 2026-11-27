import {
  cachedListReadPrefix,
  uncheckedListReadPrefix,
  uncheckedListWritePrefix,
  createFunctionBuilder,
  indirectCallClass,
  indirectCallTargets,
  stableRecordLayouts,
  listVectorPrefix,
  dominates,
  immediateDominators,
  instructionResult,
  naturalLoops,
  blockSuccessors,
  recordReadsKept,
  renumberInstructionResult,
  retainDebugValues,
  substituteInstructionValues,
  substituteTerminatorValues,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type Dominators,
  type FunctionIR,
  type IndirectCallTargets,
  type Instruction,
  type ModuleIR,
  type NaturalLoop,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import {
  branch,
  field,
  none,
  reference,
  unary,
  vectorProperty,
} from "./function-builder.ts";

export interface ListVectorCaching {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly rewritten: number;
}

const span = { start: 0, end: 0 };

/** A dense reference-list read accessor (buildReferenceListAccessors, direct
 * references): its header record, from the entry's checked root read. */
function readHeader(fn: FunctionIR): number | undefined {
  if (
    !fn.name.startsWith("__tint_reference_list_read$") ||
    (fn.returnType !== "optional-reference" &&
      fn.returnType !== "optional-string") ||
    fn.parameters.length !== 2 ||
    fn.parameters[0] !== 0 ||
    fn.parameters[1] !== 1 ||
    fn.slots[0] !== "reference" ||
    fn.slots[1] !== "number"
  )
    return undefined;
  const entry = fn.blocks[fn.entry],
    term = entry?.terminator;
  if (
    term === undefined ||
    term.kind !== "record" ||
    term.operation !== "read" ||
    term.field !== 1
  )
    return undefined;
  // Direct references: a stored undefined is the vector itself.
  let selfTest = false;
  for (const block of fn.blocks)
    for (const op of block?.instructions ?? [])
      if (op !== undefined && op.kind === "binary" && op.operator === "===")
        selfTest = true;
  return selfTest ? term.record : undefined;
}

/** A dense reference-list write accessor (direct references): its header
 * record, matching codegen's listWriteShape. */
function writeHeader(fn: FunctionIR): number | undefined {
  if (
    !fn.name.startsWith("__tint_reference_list_write$") ||
    fn.returnType !== "void" ||
    fn.parameters.length !== 3 ||
    fn.parameters[0] !== 0 ||
    fn.parameters[1] !== 1 ||
    fn.parameters[2] !== 2 ||
    fn.slots[0] !== "reference" ||
    fn.slots[1] !== "number" ||
    (fn.slots[2] !== "optional-reference" && fn.slots[2] !== "optional-string")
  )
    return undefined;
  let header = -1,
    vectorWrite = false,
    lengthWrite = false;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (op.kind === "record-new") return undefined;
      if (op.kind === "reference-vector-write") vectorWrite = true;
    }
    const t = block.terminator;
    if (t.kind === "record") {
      if (header < 0) header = t.record;
      else if (header !== t.record) return undefined;
      if (t.field === 0 && t.operation === "write") lengthWrite = true;
    } else if (t.kind === "record-cell" || t.kind === "cell") return undefined;
  }
  return header >= 0 && vectorWrite && lengthWrite ? header : undefined;
}

/** Header records a terminator may write (a field write or initialization of
 * a list header record), as an index into `headers`, or -1. */
function writtenHeader(
  term: Terminator,
  headers: ReadonlyMap<number, number>,
): number {
  if (
    (term.kind === "record" || term.kind === "record-cell") &&
    term.operation !== "read"
  )
    return headers.get(term.record) ?? -1;
  return -1;
}

/** Per function, the list header records (bits by `headers` index, `words`
 * per function) that it or any callee may write. Imports may write every
 * header. In a closed world (stable record layouts: every host operation is
 * a closed-world one, none of which writes managed fields), an indirect call
 * reaches only its class of address-taken functions (see
 * indirectCallTargets), so it writes what they may write; otherwise indirect
 * and host calls may write every header. Allocations and element writes
 * never write a header: only header field writes replace a list's root
 * vector. After the functions' masks come one per indirect-call class. */
function headerWriters(
  module: ModuleIR,
  headers: ReadonlyMap<number, number>,
  words: number,
  targets: IndirectCallTargets,
  budget: number,
): { readonly masks: Uint32Array; readonly visited: number } | undefined {
  const count = module.functions.length,
    nodes = count + targets.classes.length,
    closed = stableRecordLayouts(module),
    masks = new Uint32Array(nodes * words),
    callers: number[][] = [];
  let visited = targets.visited;
  const all = (fn: number): void => {
    for (let word = fn * words; word < (fn + 1) * words; word++)
      masks[word] = 0xffffffff;
  };
  for (let id = 0; id < nodes; id++) callers.push([]);
  for (let index = 0; index < targets.classes.length; index++) {
    if (!closed) all(count + index);
    for (const member of targets.classes[index] ?? []) {
      if (member === undefined) throw "list vector class invariant";
      callers[member]?.push(count + index);
    }
  }
  for (const fn of module.functions) {
    if (fn === undefined) throw "list vector function invariant";
    if (fn.import === true) {
      all(fn.id);
      continue;
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      visited += block.instructions.length + 1;
      const written = writtenHeader(block.terminator, headers);
      if (written >= 0) {
        const at = fn.id * words + (written >>> 5);
        masks[at] = ((masks[at] ?? 0) | (1 << (written & 31))) >>> 0;
      }
      for (const op of block.instructions) {
        if (op === undefined) throw "list vector instruction invariant";
        if (op.kind === "call") callers[op.target]?.push(fn.id);
        else if (op.kind === "call-indirect") {
          const index = indirectCallClass(targets, fn.id, block.id, op);
          if (index >= 0) callers[count + index]?.push(fn.id);
        } else if (op.kind === "host-call") {
          if (!closed) all(fn.id);
        }
      }
    }
    if (visited > budget) return undefined;
  }
  // Propagate callee masks to callers until nothing changes.
  const pending: number[] = [],
    queued = new Uint8Array(nodes);
  for (let id = 0; id < nodes; id++) {
    pending.push(id);
    queued[id] = 1;
  }
  while (pending.length > 0) {
    const callee = pending.pop();
    if (callee === undefined) break;
    queued[callee] = 0;
    for (const caller of callers[callee] ?? []) {
      if (caller === undefined) throw "list vector element invariant";
      if (++visited > budget) return undefined;
      let changed = false;
      for (let word = 0; word < words; word++) {
        const from = masks[callee * words + word] ?? 0,
          at = caller * words + word,
          before = masks[at] ?? 0;
        // Unsigned: bit 31 makes the int32 result of | negative.
        const after = (before | from) >>> 0;
        if (after !== before) {
          masks[at] = after;
          changed = true;
        }
      }
      if (changed && queued[caller] === 0) {
        queued[caller] = 1;
        pending.push(caller);
      }
    }
  }
  return { masks, visited };
}

/** A list cached across one loop: the slot holding the list (a reference, or
 * an optional reference unwrapped at each read), the slot caching its root
 * vector (or none), and its header record. */
interface CachedList {
  readonly list: number;
  readonly optional: boolean;
  readonly vector: number;
  readonly header: number;
}

/** The sites in one loop that may write one header record. */
interface WriteProfile {
  readonly sites: number;
  /** One of them runs on every iteration. */
  readonly always: boolean;
}

/** A list's cacheable reads in one loop. */
interface ListReads {
  readonly count: number;
  /** Some read runs on every iteration. */
  readonly everyIteration: boolean;
}

/** A point in a loop after which some list headers may have been written:
 * a call (instruction) or a header-writing terminator. */
interface WriteSite {
  readonly block: number;
  readonly op: Instruction | undefined;
  /** Header indexes it may write; undefined for all. */
  readonly headers: ReadonlySet<number> | undefined;
}

/** Dense list reads in loops read the list's root vector from a slot cached
 * ahead of the loop instead of from the list header at each read. Each such
 * loop gets, per list slot, a slot holding the list's root when that root is
 * a reference vector (else none), set from a vector accessor call (the
 * root, or none) appended to the loop's preheader; reads in the loop become
 * calls to a cached-read accessor taking that slot's value first. The
 * accessors' IR only reads, so the IR meaning is unchanged; codegen inlines
 * the cached read as a bounds-checked vector load, trusting that the first
 * argument is the list's current root vector or none.
 *
 * Only header field writes replace a root, so the cache stays current
 * unless the loop writes a header: directly, or through a call whose
 * transitive summary may write that list's header record. Right after each
 * such call, and on both edges of a header-writing terminator, the same
 * accessor call refreshes the caches of every enclosing loop for the headers
 * the site may write. Refreshes are straight-line IR: the unique-predecessor
 * chains that record read proofs follow stay intact. A call that may write a
 * header and throw to a handler inside the loop would skip its refresh, so
 * such loops keep ordinary reads. The list slot is not written in the loop;
 * aliases are covered because refreshes key on the header record, not on
 * the name. See `profitable` for which lists are worth a cache. The vector
 * slot is a collector root (a callee-saved register home survives
 * safepoints), so moving collections keep it current across allocations and
 * calls. This runs after every inlining and code-motion pass. */
export function cacheListVectors(
  module: ModuleIR,
  budget: number,
  closedCalls: boolean = false,
): ListVectorCaching | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  // Finding the list accessors visits every function.
  let visited = module.functions.length;
  if (visited > budget) return undefined;
  const readers = new Map<number, number>(),
    writers = new Map<number, number>(),
    headers = new Map<number, number>(),
    readOnly = new Set<number>();
  for (const fn of module.functions) {
    if (fn === undefined) throw "list vector function invariant";
    const header = readHeader(fn);
    if (header !== undefined) {
      readers.set(fn.id, header);
      if (!headers.has(header)) headers.set(header, headers.size);
      readOnly.add(fn.id);
    } else if (fn.name.startsWith("__tint_reference_list_has$")) {
      readOnly.add(fn.id);
    } else {
      const wHeader = writeHeader(fn);
      if (wHeader !== undefined) {
        writers.set(fn.id, wHeader);
        if (!headers.has(wHeader)) headers.set(wHeader, headers.size);
      }
    }
  }
  if (readers.size === 0 && writers.size === 0)
    return { module, visited, rewritten: 0 };
  const targets = indirectCallTargets(module, closedCalls, budget - visited);
  if (targets === undefined) return undefined;
  const words = (headers.size + 31) >>> 5,
    summary = headerWriters(module, headers, words, targets, budget - visited);
  if (summary === undefined) return undefined;
  visited += summary.visited;
  const masks = summary.masks;
  /** The headers a call may write; undefined for all. */
  const nothing: ReadonlySet<number> = new Set<number>(),
    calleeWrites = new Map<number, ReadonlySet<number>>(),
    writesAll = new Set<number>();
  const closed = stableRecordLayouts(module),
    resolved = targets;
  /** The headers a call in block `block` of function `fn` may write. */
  function callWrites(
    fn: number,
    block: number,
    op: Instruction,
  ): ReadonlySet<number> | undefined {
    if (op.kind === "host-call") return closed ? nothing : undefined;
    // An indirect call without a class can only trap.
    const index =
      op.kind === "call-indirect"
        ? indirectCallClass(resolved, fn, block, op)
        : -1;
    const target =
      index >= 0
        ? module.functions.length + index
        : op.kind === "call" && !readOnly.has(op.target)
          ? op.target
          : undefined;
    if (target === undefined) return nothing;
    if (writesAll.has(target)) return undefined;
    const known = calleeWrites.get(target);
    if (known !== undefined) return known;
    const written = new Set<number>();
    for (let index = 0; index < headers.size; index++)
      if (
        (((masks[target * words + (index >>> 5)] ?? 0) >>> (index & 31)) &
          1) !==
        0
      )
        written.add(index);
    if (written.size === headers.size) {
      writesAll.add(target);
      return undefined;
    }
    const result = written.size === 0 ? nothing : written;
    calleeWrites.set(target, result);
    return result;
  }
  const functions: FunctionIR[] = module.functions.slice();
  // Cached-read accessors, created on first use, by reader.
  const cached = new Map<number, number>(),
    cachedOrigin = new Map<number, number>();
  function cachedReader(reader: number): number {
    const existing = cached.get(reader);
    if (existing !== undefined) return existing;
    const target = module.functions[reader];
    if (target === undefined) throw "list vector reader invariant";
    const id = functions.length,
      readArguments: number[] = [0, 1];
    functions.push({
      id,
      name: cachedListReadPrefix + String(id),
      exported: false,
      parameters: [0, 1, 2],
      slots: ["optional-reference", "reference", "number"],
      returnType: target.returnType,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 1, ...span },
            { kind: "load", id: 1, slot: 2, ...span },
            {
              kind: "call",
              id: 2,
              target: reader,
              arguments: readArguments,
              ...span,
            },
          ],
          terminator: { kind: "return", value: 2, ...span },
        },
      ],
    });
    cached.set(reader, id);
    cachedOrigin.set(id, reader);
    readOnly.add(id);
    return id;
  }
  // Unchecked-read accessors, created on first use, by reader: valid IR
  // forwarding to `reader`, inlined without bounds checks when guarded.
  const unchecked = new Map<number, number>();
  function uncheckedReader(reader: number): number {
    const existing = unchecked.get(reader);
    if (existing !== undefined) return existing;
    const id = functions.length,
      returnType: ScalarType =
        functions[reader]?.returnType === "optional-string"
          ? "optional-string"
          : "optional-reference",
      readArguments: number[] = [0, 1];
    functions.push({
      id,
      name: uncheckedListReadPrefix + String(id),
      exported: false,
      parameters: [0, 1, 2],
      slots: ["optional-reference", "reference", "number"],
      returnType,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 1, ...span },
            { kind: "load", id: 1, slot: 2, ...span },
            {
              kind: "call",
              id: 2,
              target: reader,
              arguments: readArguments,
              ...span,
            },
          ],
          terminator: { kind: "return", value: 2, ...span },
        },
      ],
    });
    unchecked.set(reader, id);
    readOnly.add(id);
    return id;
  }
  // Unchecked-write accessors, created on first use, by writer: valid IR
  // forwarding to `writer`, inlined as direct vector store + barrier when
  // guarded by a hoisted push loop's `len < cap` check.
  const uncheckedWrites = new Map<number, number>();
  function uncheckedWriter(writer: number): number {
    const existing = uncheckedWrites.get(writer);
    if (existing !== undefined) return existing;
    const id = functions.length,
      elementType: ScalarType =
        functions[writer]?.slots[2] === "optional-string"
          ? "optional-string"
          : "optional-reference",
      writeArguments: number[] = [0, 1, 2];
    functions.push({
      id,
      name: uncheckedListWritePrefix + String(id),
      exported: false,
      parameters: [0, 1, 2, 3],
      slots: ["reference", "reference", "number", elementType],
      returnType: "void",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 1, ...span },
            { kind: "load", id: 1, slot: 2, ...span },
            { kind: "load", id: 2, slot: 3, ...span },
            {
              kind: "call",
              id: undefined,
              target: writer,
              arguments: writeArguments,
              ...span,
            },
          ],
          terminator: { kind: "return", value: undefined, ...span },
        },
      ],
    });
    uncheckedWrites.set(writer, id);
    return id;
  }
  // Vector accessors, created on first use, by header record: the list's
  // root when it is a reference vector, else none (also for a none list).
  const vectorAccessors = new Map<number, number>();
  function vectorAccessor(header: number): number {
    const existing = vectorAccessors.get(header);
    if (existing !== undefined) return existing;
    const id = functions.length,
      b = createFunctionBuilder(
        id,
        listVectorPrefix + String(id),
        ["optional-reference"],
        "optional-reference",
      ),
      present = b.block(),
      vector = b.block(),
      absent = b.block(),
      root = b.slot("optional-reference");
    branch(b, unary(b, "truthy", 0, "boolean"), present, absent);
    b.at(present);
    field(b, reference(b, 0, false), header, 1, root, false, absent);
    branch(b, vectorProperty(b, root, true), vector, absent);
    b.at(vector);
    b.end({ kind: "return", value: b.load(root), start: 0, end: 0 });
    b.at(absent);
    b.end({ kind: "return", value: b.load(none(b)), start: 0, end: 0 });
    functions.push(b.finish());
    vectorAccessors.set(header, id);
    readOnly.add(id);
    return id;
  }
  // Length accessors, created on first use, by header record: the list's
  // length (field 0) wrapped as optional-number when it has the expected
  // header, else optional-none (never traps; preheader applies unary:uint32 so
  // interval analysis proves [0, 2^32 - 1] on the cached length slot).
  const lengthAccessors = new Map<number, number>();
  function lengthAccessor(header: number): number {
    const existing = lengthAccessors.get(header);
    if (existing !== undefined) return existing;
    const id = functions.length,
      b = createFunctionBuilder(
        id,
        "__tint_list_length$" + String(id),
        ["optional-reference"],
        "optional-number",
      ),
      present = b.block(),
      absent = b.block(),
      length = b.slot("number");
    branch(b, unary(b, "truthy", 0, "boolean"), present, absent);
    b.at(present);
    field(b, reference(b, 0, false), header, 0, length, false, absent);
    const wrapped = b.next();
    b.emit({
      kind: "optional-wrap",
      id: wrapped,
      value: b.load(length),
      start: 0,
      end: 0,
    });
    b.end({ kind: "return", value: wrapped, start: 0, end: 0 });
    b.at(absent);
    const missing = b.next();
    b.emit({ kind: "undefined", id: missing, start: 0, end: 0 });
    b.end({ kind: "return", value: missing, start: 0, end: 0 });
    functions.push(b.finish());
    lengthAccessors.set(header, id);
    readOnly.add(id);
    return id;
  }
  let rewritten = 0;
  for (let index = 0; index < module.functions.length; index++) {
    const fn = module.functions[index];
    if (fn === undefined) throw "list vector function invariant";
    if (fn.import === true || readOnly.has(fn.id) || writers.has(fn.id))
      continue;
    let reads = 0,
      writeOps = 0;
    for (const block of fn.blocks)
      for (const op of block?.instructions ?? [])
        if (op !== undefined && op.kind === "call") {
          if (readers.has(op.target)) reads++;
          else if (writers.has(op.target)) writeOps++;
        }
    visited += fn.blocks.length;
    if (reads === 0 && writeOps === 0) continue;
    if (visited > budget) return undefined;
    let cur = fn;
    // Hoist fresh push loops before read caching so hoisted unchecked vector
    // writes no longer mark the shared list header as always-written in loops
    // that also read another list (e.g. `labels[i & 3]` inside `items.push`).
    if (writeOps > 0) {
      const pushed = hoistPushLoops(
        cur,
        writers,
        readOnly,
        (w) => functions[w]?.slots[2] ?? "optional-reference",
        vectorAccessor,
        uncheckedWriter,
        budget - visited,
      );
      if (pushed === undefined) return undefined;
      visited += pushed.visited;
      if (pushed.rewritten > 0) {
        rewritten += pushed.rewritten;
        cur = pushed.fn;
      }
    }
    if (reads > 0) {
      const result = rewriteFunction(cur, budget - visited);
      if (result === undefined) return undefined;
      visited += result.visited;
      if (result.rewritten > 0) {
        rewritten += result.rewritten;
        cur = result.fn;
      }
    }
    functions[index] = cur;
  }

  function rewriteFunction(
    fn: FunctionIR,
    remaining: number,
  ): { fn: FunctionIR; visited: number; rewritten: number } | undefined {
    const forest = naturalLoops(fn, remaining);
    if (forest === undefined) return undefined;
    let work = forest.visited;
    if (forest.loops.length === 0) return { fn, visited: work, rewritten: 0 };
    const predecessors = new Map<number, number[]>();
    let nextValue = 0,
      nextBlock = fn.blocks.length;
    const definitions = new Map<number, Instruction>();
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      if (block.id >= nextBlock) nextBlock = block.id + 1;
      for (const op of block.instructions) {
        if (op === undefined) throw "list vector instruction invariant";
        work++;
        const id = instructionResult(op);
        if (id !== undefined) {
          definitions.set(id, op);
          if (id >= nextValue) nextValue = id + 1;
        }
      }
      for (const target of blockSuccessors(block)) {
        if (target === undefined) throw "list vector successor invariant";
        let list = predecessors.get(target);
        if (list === undefined) {
          list = [];
          predecessors.set(target, list);
        }
        list.push(block.id);
      }
    }
    if (work > remaining) return undefined;
    let dominators: Dominators | undefined;
    // Per loop: the sites that may write a list header, or undefined when
    // the loop cannot keep caches.
    const loopSites = new Map<NaturalLoop, WriteSite[]>(),
      unusable = new Set<NaturalLoop>();
    function sites(loop: NaturalLoop): WriteSite[] | undefined {
      if (unusable.has(loop)) return undefined;
      const known = loopSites.get(loop);
      if (known !== undefined) return known;
      const found: WriteSite[] = [];
      let usable = true;
      for (const id of loop.body) {
        const block = fn.blocks[id];
        if (block === undefined) {
          usable = false;
          break;
        }
        work += block.instructions.length + 1;
        // Only the header is entered from outside (no irreducible entry).
        if (
          id !== loop.header &&
          (predecessors.get(id) ?? []).some((from) => !loop.body.has(from))
        ) {
          usable = false;
          break;
        }
        const handled =
          block.exception !== undefined &&
          loop.body.has(block.exception.target);
        for (const op of block.instructions) {
          if (op === undefined) throw "list vector instruction invariant";
          const written = callWrites(fn.id, id, op);
          if (written !== undefined && written.size === 0) continue;
          // A call that writes a header and then throws to a handler in the
          // loop would skip the refresh after it.
          if (handled) usable = false;
          found.push({ block: id, op, headers: written });
        }
        const header = writtenHeader(block.terminator, headers);
        if (header >= 0) {
          const written = new Set<number>();
          written.add(header);
          found.push({ block: id, op: undefined, headers: written });
        }
      }
      if (!usable) {
        unusable.add(loop);
        return undefined;
      }
      loopSites.set(loop, found);
      return found;
    }
    /** Whether a block runs on every iteration of the loop (it dominates
     * every latch); undefined when dominators exceed the budget. */
    function everyIteration(
      loop: NaturalLoop,
      block: number,
    ): boolean | undefined {
      if (dominators === undefined) {
        dominators = immediateDominators(fn, Math.max(1, remaining - work));
        if (dominators === undefined) return undefined;
        work += dominators.visited;
      }
      const tree = dominators;
      work += loop.latches.length;
      return loop.latches.every((latch) =>
        dominates(tree, fn.entry, block, latch),
      );
    }
    /** Whether caching a list with this header pays. Not when a site that
     * may write the header runs on every iteration: each would refresh. A
     * read on every iteration saves on every iteration while refreshes cost
     * only on the iterations that reach their sites; otherwise the list's
     * reads must at least match the sites that would refresh it. */
    const writeProfiles = new Map<NaturalLoop, Map<number, WriteProfile>>();
    function profitable(
      loop: NaturalLoop,
      header: number,
      reads: ListReads,
    ): boolean {
      const existing = writeProfiles.get(loop),
        known = existing ?? new Map<number, WriteProfile>();
      if (existing === undefined) writeProfiles.set(loop, known);
      let profile = known.get(header);
      if (profile === undefined) {
        let count = 0,
          always = false;
        for (const site of sites(loop) ?? []) {
          if (site === undefined) throw "list vector element invariant";
          if (site.headers !== undefined && !site.headers.has(header)) continue;
          count++;
          if (!always) always = everyIteration(loop, site.block) ?? true;
        }
        const measured: WriteProfile = { sites: count, always };
        known.set(header, measured);
        profile = measured;
      }
      return (
        !profile.always &&
        (reads.everyIteration || profile.sites <= reads.count)
      );
    }
    /** The loop's single entering predecessor, ending in a plain jump. */
    function preheader(loop: NaturalLoop): Block | undefined {
      const outside = (predecessors.get(loop.header) ?? []).filter(
        (id) => !loop.body.has(id),
      );
      const id = outside[0];
      if (outside.length !== 1 || id === undefined) return undefined;
      const block = fn.blocks[id];
      return block !== undefined &&
        block.terminator.kind === "jump" &&
        block.exception === undefined
        ? block
        : undefined;
    }
    // Innermost loop of each block.
    const innermost = new Map<number, NaturalLoop>();
    for (const loop of forest.loops) {
      if (loop === undefined) throw "list vector loop invariant";
      for (const id of loop.body) {
        const current = innermost.get(id);
        if (current === undefined || loop.body.size < current.body.size)
          innermost.set(id, loop);
      }
    }
    const verdicts = new Map<NaturalLoop, boolean>();
    /** The loop whose caches serve a block's reads, if it can keep caches. */
    function cachingLoop(block: Block): NaturalLoop | undefined {
      const loop = innermost.get(block.id);
      if (loop === undefined) return undefined;
      const known = verdicts.get(loop);
      if (known !== undefined) return known ? loop : undefined;
      const verdict =
        preheader(loop) !== undefined && sites(loop) !== undefined;
      verdicts.set(loop, verdict);
      return verdict ? loop : undefined;
    }
    /** A dense read of a list held in a slot the loop does not write. */
    function cacheableRead(
      op: Instruction,
      loop: NaturalLoop,
    ):
      | {
          readonly slot: number;
          readonly optional: boolean;
          readonly header: number;
        }
      | undefined {
      if (op.kind !== "call" || op.id === undefined) return undefined;
      const header = readers.get(op.target),
        list = op.arguments[0];
      if (
        header === undefined ||
        list === undefined ||
        op.arguments[1] === undefined
      )
        return undefined;
      let source = definitions.get(list);
      // A list read through an unwrapped optional slot.
      let optional = false;
      if (source !== undefined && source.kind === "reference-value") {
        source = definitions.get(source.value);
        optional = true;
      }
      if (
        source === undefined ||
        source.kind !== "load" ||
        loop.writes.has(source.slot) ||
        fn.slots[source.slot] !==
          (optional ? "optional-reference" : "reference")
      )
        return undefined;
      return { slot: source.slot, optional, header };
    }
    // Reads per loop and list slot: a list is cached only when its reads in
    // the loop outnumber or match the refreshes it would need.
    const readCounts = new Map<NaturalLoop, Map<number, ListReads>>();
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      const loop = cachingLoop(block);
      if (loop === undefined) continue;
      for (const op of block.instructions) {
        if (op === undefined) throw "list vector instruction invariant";
        work++;
        const read = cacheableRead(op, loop);
        if (read === undefined) continue;
        let counts = readCounts.get(loop);
        if (counts === undefined) {
          counts = new Map<number, ListReads>();
          readCounts.set(loop, counts);
        }
        const before = counts.get(read.slot);
        counts.set(read.slot, {
          count: (before?.count ?? 0) + 1,
          everyIteration:
            before?.everyIteration === true ||
            everyIteration(loop, block.id) === true,
        });
      }
    }
    const allLoops = forest.loops;
    /** Outermost enclosing loop where `listSlot` and `headerIdx` are both
     * unmodified and a preheader exists, so invariant caches hoist out of
     * nested loops too. */
    function outerCacheLoop(
      inner: NaturalLoop,
      listSlot: number,
      headerIdx: number,
    ): NaturalLoop {
      let best = inner;
      if (headerIdx < 0) return best;
      for (const outer of allLoops) {
        if (
          outer === undefined ||
          outer === best ||
          outer.body.size <= best.body.size ||
          !outer.body.has(inner.header) ||
          outer.writes.has(listSlot) ||
          preheader(outer) === undefined
        )
          continue;
        const outerSites = sites(outer);
        if (outerSites === undefined) continue;
        let written = false;
        for (const site of outerSites) {
          if (
            site === undefined ||
            site.headers === undefined ||
            site.headers.has(headerIdx)
          ) {
            written = true;
            break;
          }
        }
        if (!written) best = outer;
      }
      return best;
    }
    // Per loop: list slot -> its cache.
    const caches = new Map<NaturalLoop, Map<number, CachedList>>();
    const slots: ScalarType[] = fn.slots.slice();
    const replaced = new Map<number, Block>();
    let count = 0;
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      const loop = cachingLoop(block);
      if (loop === undefined) continue;
      let instructions: Instruction[] | undefined;
      for (let at = 0; at < block.instructions.length; at++) {
        const op = block.instructions[at];
        if (op === undefined) throw "list vector instruction invariant";
        work++;
        const read = cacheableRead(op, loop),
          headerIdx =
            read === undefined ? -1 : (headers.get(read.header) ?? -1),
          target =
            read === undefined
              ? loop
              : outerCacheLoop(loop, read.slot, headerIdx);
        let vectors = caches.get(target);
        const known = read === undefined ? undefined : vectors?.get(read.slot);
        if (
          op.kind !== "call" ||
          read === undefined ||
          (known === undefined &&
            !profitable(
              loop,
              headerIdx,
              readCounts.get(loop)?.get(read.slot) ?? {
                count: 0,
                everyIteration: false,
              },
            ))
        ) {
          if (instructions !== undefined) instructions.push(op);
          continue;
        }
        if (vectors === undefined) {
          vectors = new Map<number, CachedList>();
          caches.set(target, vectors);
        }
        const vector = known === undefined ? slots.length : known.vector;
        if (known === undefined) {
          slots.push("optional-reference");
          vectors.set(read.slot, {
            list: read.slot,
            optional: read.optional,
            vector,
            header: read.header,
          });
        }
        if (instructions === undefined)
          instructions = block.instructions.slice(0, at);
        const value = nextValue++;
        instructions.push({ kind: "load", id: value, slot: vector, ...span });
        const cachedArguments: number[] = [
          value,
          op.arguments[0] ?? 0,
          op.arguments[1] ?? 0,
        ];
        instructions.push({
          ...op,
          target: cachedReader(op.target),
          arguments: cachedArguments,
        });
        count++;
      }
      if (instructions !== undefined)
        replaced.set(block.id, { ...block, instructions });
    }
    if (count === 0) return { fn, visited: work, rewritten: 0 };
    // The caches each write site must refresh: those of every loop holding
    // the site whose header it may write.
    const callRefreshes = new Map<Instruction, CachedList[]>(),
      terminatorRefreshes = new Map<number, CachedList[]>();
    for (const [loop, vectors] of caches) {
      for (const site of sites(loop) ?? []) {
        if (site === undefined) throw "list vector element invariant";
        const op = site.op;
        for (const [slot, cache] of vectors) {
          if (cache.list !== slot) throw "list vector cache invariant";
          if (
            site.headers !== undefined &&
            !site.headers.has(headers.get(cache.header) ?? -1)
          )
            continue;
          const existing =
            op === undefined
              ? terminatorRefreshes.get(site.block)
              : callRefreshes.get(op);
          if (existing !== undefined) existing.push(cache);
          else if (op === undefined)
            terminatorRefreshes.set(site.block, [cache]);
          else callRefreshes.set(op, [cache]);
        }
      }
    }
    /** Straight-line refreshes: each cache takes its list's current root
     * vector from the header's vector accessor. Branch-free IR keeps the
     * unique-predecessor chains that record read proofs follow. */
    function refresh(lists: readonly CachedList[], into: Instruction[]): void {
      for (const cache of lists) {
        if (cache === undefined) throw "list vector element invariant";
        const object = nextValue++,
          vector = nextValue++;
        into.push({ kind: "load", id: object, slot: cache.list, ...span });
        let argument = object;
        if (!cache.optional) {
          argument = nextValue++;
          into.push({
            kind: "reference-wrap",
            id: argument,
            value: object,
            ...span,
          });
        }
        const vectorArguments: number[] = [argument];
        into.push(
          {
            kind: "call",
            id: vector,
            target: vectorAccessor(cache.header),
            arguments: vectorArguments,
            ...span,
          },
          { kind: "store", slot: cache.vector, value: vector, ...span },
        );
      }
    }
    // Calls that may write a header refresh right after themselves.
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      const current = replaced.get(block.id) ?? block;
      let instructions: Instruction[] | undefined;
      for (let at = 0; at < current.instructions.length; at++) {
        const op = current.instructions[at];
        if (op === undefined) throw "list vector instruction invariant";
        const lists = callRefreshes.get(op);
        if (lists === undefined) {
          if (instructions !== undefined) instructions.push(op);
          continue;
        }
        if (instructions === undefined)
          instructions = current.instructions.slice(0, at);
        instructions.push(op);
        refresh(lists, instructions);
      }
      if (instructions !== undefined)
        replaced.set(block.id, { ...current, instructions });
    }
    const added: Block[] = [];
    /** A block on an edge into `target` that refreshes `lists`. */
    function edge(lists: readonly CachedList[], target: number): number {
      const id = nextBlock++,
        instructions: Instruction[] = [];
      refresh(lists, instructions);
      added.push({
        id,
        instructions,
        terminator: { kind: "jump", target, ...span },
      });
      return id;
    }
    // Header-writing terminators refresh on both edges.
    for (const [key, lists] of terminatorRefreshes) {
      const block = replaced.get(key) ?? fn.blocks[key];
      if (block === undefined) throw "list vector site invariant";
      const term = block.terminator;
      if (term.kind !== "record" && term.kind !== "record-cell")
        throw "list vector site terminator invariant";
      replaced.set(key, {
        ...block,
        terminator: {
          ...term,
          consequent: edge(lists, term.consequent),
          alternate: edge(lists, term.alternate),
        },
      });
    }
    // Ahead of each loop header, fill its caches, and hoist a loop-invariant
    // header length read (+ uint32 conversion) when the header is never written
    // in the loop.
    for (const [loop, vectors] of caches) {
      const entry = preheader(loop);
      if (entry === undefined) throw "list vector preheader invariant";
      const original = replaced.get(entry.id) ?? entry,
        instructions = original.instructions.slice();
      const lists: CachedList[] = [];
      for (const [list, cache] of vectors) {
        if (cache.list !== list) throw "list vector cache invariant";
        lists.push(cache);
      }
      refresh(lists, instructions);
      replaced.set(entry.id, { ...original, instructions });
    }
    const baseBlocks: Block[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      baseBlocks.push(replaced.get(block.id) ?? block);
    }
    for (const block of added) {
      if (block === undefined) throw "list vector element invariant";
      if (block.id !== baseBlocks.length)
        throw "list vector block id invariant";
      baseBlocks.push(block);
    }
    let currentFn: FunctionIR = { ...fn, slots, blocks: baseBlocks };
    // Try hoisting each unwritten cached list's header length read from the
    // loop header into its preheader, keeping only rewrites that preserve
    // proven record reads.
    for (const [loop, vectors] of caches) {
      const entry = preheader(loop);
      if (entry === undefined) continue;
      const entryBlock = currentFn.blocks[entry.id],
        headerBlock = currentFn.blocks[loop.header];
      if (
        entryBlock === undefined ||
        headerBlock === undefined ||
        headerBlock.exception !== undefined
      )
        continue;
      const entryTerm = entryBlock.terminator;
      if (entryTerm.kind !== "jump" || entryTerm.target !== loop.header)
        continue;
      const term = headerBlock.terminator;
      if (
        term.kind !== "record" ||
        term.operation !== "read" ||
        term.field !== 0 ||
        term.consequent === loop.header ||
        !loop.body.has(term.consequent) ||
        loop.body.has(term.alternate)
      )
        continue;
      if (currentFn.slots[term.slot] !== "number") continue;
      // Header block must contain only pure loads / reference-value unwraps.
      let pureHeader = true;
      for (const op of headerBlock.instructions) {
        if (
          op === undefined ||
          (op.kind !== "load" && op.kind !== "reference-value")
        ) {
          pureHeader = false;
          break;
        }
      }
      if (!pureHeader) continue;
      // Match term.object against a cached list in this loop.
      let source: Instruction | undefined;
      for (const op of headerBlock.instructions)
        if (op !== undefined && instructionResult(op) === term.object)
          source = op;
      let optional = false;
      if (source !== undefined && source.kind === "reference-value") {
        const inner = source.value;
        source = undefined;
        for (const op of headerBlock.instructions)
          if (op !== undefined && instructionResult(op) === inner) source = op;
        optional = true;
      }
      if (source === undefined || source.kind !== "load") continue;
      if (headerBlock.instructions.length !== (optional ? 2 : 1)) continue;
      const cache = vectors.get(source.slot);
      if (
        cache === undefined ||
        cache.optional !== optional ||
        cache.header !== term.record
      )
        continue;
      // Header record must have zero write sites in the loop.
      const headerIndex = headers.get(cache.header) ?? -1;
      let headerWritten = false;
      for (const site of sites(loop) ?? []) {
        if (site === undefined) throw "list vector site invariant";
        if (site.headers === undefined || site.headers.has(headerIndex)) {
          headerWritten = true;
          break;
        }
      }
      if (headerWritten) continue;
      // Length slot must not be written anywhere else in the loop.
      let lenWrittenElsewhere = false;
      for (const id of loop.body) {
        const b = currentFn.blocks[id];
        if (b === undefined) {
          lenWrittenElsewhere = true;
          break;
        }
        if (b.exception !== undefined && b.exception.slot === term.slot) {
          lenWrittenElsewhere = true;
          break;
        }
        for (const op of b.instructions) {
          if (
            op !== undefined &&
            op.kind === "store" &&
            op.slot === term.slot
          ) {
            lenWrittenElsewhere = true;
            break;
          }
        }
        if (id !== loop.header) {
          const bt = b.terminator;
          if (
            (bt.kind === "record" ||
              bt.kind === "record-cell" ||
              bt.kind === "cell") &&
            bt.operation === "read" &&
            bt.slot === term.slot
          )
            lenWrittenElsewhere = true;
        }
        if (lenWrittenElsewhere) break;
      }
      if (lenWrittenElsewhere) continue;
      // Build candidate rewrite: move the header's length read into entryBlock,
      // followed by a fresh jump preheader (so counted-loops still sees a plain
      // jump preheader). Also hoist `unary:uint32(load lenSlot)` from C into
      // the fresh preheader as a dedicated integer bound slot.
      let candNextValue = nextValue;
      const entryInsts = entryBlock.instructions.slice();
      const loadedObj = candNextValue++;
      entryInsts.push({
        kind: "load",
        id: loadedObj,
        slot: cache.list,
        start: 0,
        end: 0,
      });
      let recordObj = loadedObj;
      if (optional) {
        recordObj = candNextValue++;
        entryInsts.push({
          kind: "reference-value",
          id: recordObj,
          value: loadedObj,
          start: 0,
          end: 0,
        });
      }
      const freshId = currentFn.blocks.length,
        freshInsts: Instruction[] = [],
        candSlots = currentFn.slots.slice(),
        candBlocks = currentFn.blocks.slice();
      // Check if C (`term.consequent`) converts `load lenSlot` via `unary:uint32`.
      // Only hoist the bound into a dedicated preheader slot when C is entered
      // solely from the loop header (so the preheader dominates C).
      let cSinglePred = true;
      for (const b of currentFn.blocks) {
        if (b === undefined) {
          cSinglePred = false;
          break;
        }
        if (
          b.exception !== undefined &&
          b.exception.target === term.consequent
        ) {
          cSinglePred = false;
          break;
        }
        if (b.id === loop.header) continue;
        for (const succ of blockSuccessors(b)) {
          if (succ === term.consequent) {
            cSinglePred = false;
            break;
          }
        }
        if (!cSinglePred) break;
      }
      const cBlock = cSinglePred ? candBlocks[term.consequent] : undefined;
      let hoistedBoundSlot: number | undefined,
        hoistedBoundValue: number | undefined;
      if (cBlock !== undefined) {
        const lenLoads = new Set<number>();
        for (const op of cBlock.instructions)
          if (op !== undefined && op.kind === "load" && op.slot === term.slot)
            lenLoads.add(op.id);
        let uint32Index = -1;
        for (let i = 0; i < cBlock.instructions.length; i++) {
          const op = cBlock.instructions[i];
          if (
            op !== undefined &&
            op.kind === "unary" &&
            op.operator === "uint32" &&
            lenLoads.has(op.operand)
          ) {
            uint32Index = i;
            break;
          }
        }
        if (uint32Index >= 0) {
          const uOp = cBlock.instructions[uint32Index];
          if (uOp !== undefined && uOp.kind === "unary") {
            const uSlot = candSlots.length;
            candSlots.push("number");
            const vLen = candNextValue++,
              vU = candNextValue++;
            freshInsts.push(
              { kind: "load", id: vLen, slot: term.slot, start: 0, end: 0 },
              {
                kind: "unary",
                id: vU,
                operator: "uint32",
                operand: vLen,
                start: 0,
                end: 0,
              },
              { kind: "store", slot: uSlot, value: vU, start: 0, end: 0 },
            );
            const cInsts = cBlock.instructions.slice();
            cInsts[uint32Index] = {
              kind: "load",
              id: uOp.id,
              slot: uSlot,
              start: 0,
              end: 0,
            };
            // Drop the now-unused `load lenSlot` if nothing else in C uses it.
            let operandUsed = false;
            for (const op of cInsts)
              if (op !== undefined)
                visitInstructionOperands(op, (id) => {
                  if (id === uOp.operand) operandUsed = true;
                });
            visitTerminatorOperands(cBlock.terminator, (id) => {
              if (id === uOp.operand) operandUsed = true;
            });
            const finalCInsts = operandUsed
              ? cInsts
              : cInsts.filter(
                  (op) =>
                    op !== undefined && instructionResult(op) !== uOp.operand,
                );
            candBlocks[term.consequent] = {
              ...cBlock,
              instructions: finalCInsts,
            };
            hoistedBoundSlot = uSlot;
            hoistedBoundValue = uOp.id;
          }
        }
      }
      candBlocks[entry.id] = {
        ...entryBlock,
        instructions: entryInsts,
        terminator: {
          ...term,
          object: recordObj,
          consequent: freshId,
        },
      };
      candBlocks[loop.header] = {
        ...headerBlock,
        instructions: [],
        terminator: { kind: "jump", target: term.consequent, start: 0, end: 0 },
      };
      candBlocks.push({
        id: freshId,
        instructions: freshInsts,
        terminator: { kind: "jump", target: loop.header, start: 0, end: 0 },
      });
      const debug =
        currentFn.debug === undefined
          ? undefined
          : retainDebugValues(currentFn, candBlocks);
      let nextIntegerSlots: readonly number[] | undefined =
        currentFn.integerSlots;
      if (hoistedBoundSlot !== undefined) {
        const merged: number[] = [];
        for (const slot of currentFn.integerSlots ?? [])
          if (slot !== undefined) merged.push(slot);
        merged.push(hoistedBoundSlot);
        nextIntegerSlots = merged;
      }
      const candidate: FunctionIR = {
        ...currentFn,
        slots: candSlots,
        blocks: candBlocks,
        ...(nextIntegerSlots === undefined
          ? {}
          : { integerSlots: nextIntegerSlots }),
        ...(debug === undefined ? {} : { debug }),
      };
      if (recordReadsKept(currentFn, candidate)) {
        currentFn = candidate;
        nextValue = candNextValue;
        count++;
        // If the hoisted bound drives a counted loop `i < uSlot` starting at a
        // non-negative uint32 constant `start` and stepping solely by `i + 1`
        // after all cached reads of this list, guard `vector !== null &&
        // vector.length >= uSlot` in `freshId` and specialize reads of `i` and
        // `i - k` (`0 <= k <= start`) in the hot loop to unchecked vector loads.
        if (hoistedBoundSlot !== undefined && hoistedBoundValue !== undefined) {
          const guarded = tryUncheckedListBounds(
            currentFn,
            loop,
            freshId,
            term.consequent,
            cache.vector,
            hoistedBoundSlot,
            hoistedBoundValue,
            nextValue,
            cachedOrigin,
            uncheckedReader,
          );
          if (guarded !== undefined && recordReadsKept(currentFn, guarded.fn)) {
            currentFn = guarded.fn;
            nextValue = guarded.nextValue;
            count += guarded.rewritten;
          }
        }
      }
    }
    // For any remaining unmodified-header length reads inside a loop body that
    // the header-only pass above could not move directly into the preheader,
    // hoist ToUint32(field 0) via a closed-world length accessor into an
    // integer preheader slot.
    if (closed) {
      const bodySlots = currentFn.slots.slice();
      const addedIntegerSlots: number[] = [];
      const slotReaders = new Uint32Array(bodySlots.length);
      for (const block of currentFn.blocks) {
        if (block === undefined) throw "list vector block invariant";
        for (const op of block.instructions) {
          if (op !== undefined && op.kind === "load")
            slotReaders[op.slot] = (slotReaders[op.slot] ?? 0) + 1;
        }
        const term = block.terminator;
        if (
          (term.kind === "record" || term.kind === "record-cell") &&
          term.operation !== "read"
        )
          slotReaders[term.slot] = (slotReaders[term.slot] ?? 0) + 1;
      }
      const recordReadSlots = new Set<number>();
      for (const block of currentFn.blocks) {
        if (block === undefined) continue;
        for (const op of block.instructions) {
          if (op === undefined || op.kind !== "record-read") continue;
          let obj = definitions.get(op.object);
          if (obj !== undefined && obj.kind === "reference-value")
            obj = definitions.get(obj.value);
          if (obj !== undefined && obj.kind === "load")
            recordReadSlots.add(obj.slot);
        }
      }
      const bodyPreds = new Map<number, number[]>();
      for (const block of currentFn.blocks) {
        if (block === undefined) continue;
        for (const succ of blockSuccessors(block)) {
          let list = bodyPreds.get(succ);
          if (list === undefined) {
            list = [];
            bodyPreds.set(succ, list);
          }
          list.push(block.id);
        }
      }
      const hoistedLengths = new Map<
        NaturalLoop,
        {
          readonly cache: CachedList;
          readonly lengthSlot: number;
          readonly hasSlot: number;
        }[]
      >();
      const bodyRewrites: {
        readonly outerLoop: NaturalLoop;
        readonly blockId: number;
        readonly consequentId: number;
        readonly boundValueId: number;
        readonly vectorSlot: number;
        readonly lengthSlot: number;
        readonly hasSlot: number;
      }[] = [];
      const lengthReplaced = new Map<number, Block>();
      let bodyNextValue = nextValue,
        bodyCount = 0;
      for (const [loop, vectors] of caches) {
        const entry = preheader(loop);
        if (entry === undefined) continue;
        const entryBlock = currentFn.blocks[entry.id];
        if (entryBlock === undefined) continue;
        const entryTerm = entryBlock.terminator;
        if (entryTerm.kind !== "jump" || entryTerm.target !== loop.header)
          continue;
        const loopWriteSites = sites(loop) ?? [];
        const unmodified = new Map<number, CachedList>();
        for (const [listSlot, cache] of vectors) {
          if (cache.list !== listSlot) throw "list vector cache invariant";
          if (recordReadSlots.has(listSlot)) continue;
          const headerIdx = headers.get(cache.header) ?? -1;
          if (headerIdx < 0) continue;
          let written = false;
          for (const site of loopWriteSites) {
            if (
              site === undefined ||
              site.headers === undefined ||
              site.headers.has(headerIdx)
            ) {
              written = true;
              break;
            }
          }
          if (!written) unmodified.set(listSlot, cache);
        }
        if (unmodified.size === 0) continue;
        const lengthSlots = new Map<
          number,
          { readonly lengthSlot: number; readonly hasSlot: number }
        >();
        const loopHoisted: {
          readonly cache: CachedList;
          readonly lengthSlot: number;
          readonly hasSlot: number;
        }[] = [];
        for (const id of loop.body) {
          const block = lengthReplaced.get(id) ?? currentFn.blocks[id];
          if (block === undefined) continue;
          const term = block.terminator;
          if (
            term.kind !== "record" ||
            term.operation !== "read" ||
            term.field !== 0 ||
            currentFn.slots[term.slot] !== "number"
          )
            continue;
          let source = definitions.get(term.object),
            optional = false;
          if (source !== undefined && source.kind === "reference-value") {
            source = definitions.get(source.value);
            optional = true;
          }
          if (source === undefined || source.kind !== "load") continue;
          const cache = unmodified.get(source.slot);
          if (
            cache === undefined ||
            cache.header !== term.record ||
            cache.optional !== optional
          )
            continue;
          if (!loop.body.has(term.consequent)) continue;
          if ((bodyPreds.get(term.consequent)?.length ?? 0) !== 1) continue;
          const consequent =
            lengthReplaced.get(term.consequent) ??
            currentFn.blocks[term.consequent];
          if (consequent === undefined) continue;
          const useCount = new Map<number, number>();
          for (const op of consequent.instructions) {
            if (op === undefined) continue;
            visitInstructionOperands(op, (vid) => {
              useCount.set(vid, (useCount.get(vid) ?? 0) + 1);
            });
          }
          visitTerminatorOperands(consequent.terminator, (vid) => {
            useCount.set(vid, (useCount.get(vid) ?? 0) + 1);
          });
          const droppedLoads = new Set<number>(),
            rewrittenUint = new Set<number>();
          let valid = true;
          for (const op of consequent.instructions) {
            if (op === undefined) continue;
            if (op.kind === "store" && op.slot === term.slot) break;
            if (op.kind === "load" && op.slot === term.slot) {
              if ((useCount.get(op.id) ?? 0) !== 1) {
                valid = false;
                break;
              }
              droppedLoads.add(op.id);
            } else if (
              op.kind === "unary" &&
              op.operator === "uint32" &&
              droppedLoads.has(op.operand)
            )
              rewrittenUint.add(op.id);
          }
          if (
            !valid ||
            droppedLoads.size === 0 ||
            rewrittenUint.size !== droppedLoads.size ||
            (slotReaders[term.slot] ?? 0) !== droppedLoads.size
          )
            continue;
          let entrySlot = lengthSlots.get(cache.list);
          if (entrySlot === undefined) {
            const lengthSlot = bodySlots.length;
            bodySlots.push("number");
            addedIntegerSlots.push(lengthSlot);
            const hasSlot = bodySlots.length;
            bodySlots.push("boolean");
            entrySlot = { lengthSlot, hasSlot };
            lengthSlots.set(cache.list, entrySlot);
            loopHoisted.push({ cache, lengthSlot, hasSlot });
          }
          const nextInstructions: Instruction[] = [];
          let singleBoundValueId = -1;
          for (const op of consequent.instructions) {
            if (op === undefined) continue;
            if (op.kind === "load" && droppedLoads.has(op.id)) continue;
            if (op.kind === "unary" && rewrittenUint.has(op.id)) {
              if (rewrittenUint.size === 1) singleBoundValueId = op.id;
              nextInstructions.push({
                kind: "load",
                id: op.id,
                slot: entrySlot.lengthSlot,
                start: op.start,
                end: op.end,
              });
              continue;
            }
            nextInstructions.push(op);
          }
          lengthReplaced.set(consequent.id, {
            ...consequent,
            instructions: nextInstructions,
          });
          slotReaders[term.slot] = 0;
          const blockInstructions = block.instructions.slice(),
            hasHeader = bodyNextValue++;
          blockInstructions.push({
            kind: "load",
            id: hasHeader,
            slot: entrySlot.hasSlot,
            start: term.start,
            end: term.end,
          });
          const branchTerminator: Terminator = {
            kind: "branch",
            condition: hasHeader,
            consequent: term.consequent,
            alternate: term.alternate,
            start: term.start,
            end: term.end,
          };
          lengthReplaced.set(block.id, {
            ...block,
            instructions: blockInstructions,
            terminator: branchTerminator,
          });
          if (singleBoundValueId >= 0)
            bodyRewrites.push({
              outerLoop: loop,
              blockId: block.id,
              consequentId: consequent.id,
              boundValueId: singleBoundValueId,
              vectorSlot: cache.vector,
              lengthSlot: entrySlot.lengthSlot,
              hasSlot: entrySlot.hasSlot,
            });
          bodyCount++;
        }
        if (loopHoisted.length > 0) hoistedLengths.set(loop, loopHoisted);
      }
      if (hoistedLengths.size > 0) {
        const preheaderReplaced = new Map<number, Block>();
        for (const [loop, lengthEntries] of hoistedLengths) {
          const entry = preheader(loop);
          if (entry === undefined) throw "list vector preheader invariant";
          const original =
            lengthReplaced.get(entry.id) ?? currentFn.blocks[entry.id];
          if (original === undefined) throw "list vector preheader invariant";
          const instructions = original.instructions.slice();
          for (const item of lengthEntries) {
            if (item === undefined) throw "list length entry invariant";
            const object = bodyNextValue++,
              optionalLength = bodyNextValue++,
              present = bodyNextValue++,
              zero = bodyNextValue++,
              rawLength = bodyNextValue++,
              uintLength = bodyNextValue++;
            instructions.push({
              kind: "load",
              id: object,
              slot: item.cache.list,
              start: 0,
              end: 0,
            });
            let argument = object;
            if (!item.cache.optional) {
              argument = bodyNextValue++;
              instructions.push({
                kind: "reference-wrap",
                id: argument,
                value: object,
                start: 0,
                end: 0,
              });
            }
            const lengthArguments: number[] = [argument];
            instructions.push(
              {
                kind: "call",
                id: optionalLength,
                target: lengthAccessor(item.cache.header),
                arguments: lengthArguments,
                start: 0,
                end: 0,
              },
              {
                kind: "optional-present",
                id: present,
                value: optionalLength,
                start: 0,
                end: 0,
              },
              {
                kind: "store",
                slot: item.hasSlot,
                value: present,
                start: 0,
                end: 0,
              },
              {
                kind: "constant",
                id: zero,
                value: 0,
                start: 0,
                end: 0,
              },
              {
                kind: "optional-value-or",
                id: rawLength,
                value: optionalLength,
                fallback: zero,
                start: 0,
                end: 0,
              },
              {
                kind: "unary",
                id: uintLength,
                operator: "uint32",
                operand: rawLength,
                start: 0,
                end: 0,
              },
              {
                kind: "store",
                slot: item.lengthSlot,
                value: uintLength,
                start: 0,
                end: 0,
              },
            );
          }
          preheaderReplaced.set(entry.id, { ...original, instructions });
        }
        const blocks: Block[] = [];
        for (const block of currentFn.blocks) {
          if (block === undefined) throw "list vector block invariant";
          blocks.push(
            preheaderReplaced.get(block.id) ??
              lengthReplaced.get(block.id) ??
              block,
          );
        }
        const integerSlots: number[] = [];
        for (const slot of currentFn.integerSlots ?? [])
          if (slot !== undefined) integerSlots.push(slot);
        for (const slot of addedIntegerSlots)
          if (slot !== undefined) integerSlots.push(slot);
        const debug =
          currentFn.debug === undefined
            ? undefined
            : retainDebugValues(currentFn, blocks);
        const bodyCand: FunctionIR = {
          ...currentFn,
          slots: bodySlots,
          blocks,
          ...(integerSlots.length > 0 ? { integerSlots } : {}),
          ...(debug === undefined ? {} : { debug }),
        };
        if (recordReadsKept(currentFn, bodyCand)) {
          currentFn = bodyCand;
          nextValue = bodyNextValue;
          count += bodyCount;
          // For each inner loop whose header was rewritten to branch on
          // `hasSlot` -> `consequent` (`i < lengthSlot`), guard `hasSlot &&
          // vector !== none && vector.length >= lengthSlot` once in the inner
          // loop's preheader so the hot inner loop drops the per-iteration
          // `isDense` check and uses unchecked vector reads.
          for (const rw of bodyRewrites) {
            if (rw === undefined) continue;
            let innerLoop: NaturalLoop | undefined;
            for (const cand of forest.loops) {
              if (
                cand === undefined ||
                cand === rw.outerLoop ||
                cand.header !== rw.blockId ||
                !rw.outerLoop.body.has(cand.header)
              )
                continue;
              if (
                innerLoop === undefined ||
                cand.body.size < innerLoop.body.size
              )
                innerLoop = cand;
            }
            if (innerLoop === undefined) continue;
            let entryId = -1,
              outsideCount = 0;
            for (const b of currentFn.blocks) {
              if (b === undefined || innerLoop.body.has(b.id)) continue;
              let enters = false;
              for (const succ of blockSuccessors(b))
                if (succ === innerLoop.header) {
                  enters = true;
                  break;
                }
              if (enters) {
                outsideCount++;
                entryId = b.id;
              }
            }
            if (outsideCount !== 1 || entryId < 0) continue;
            const entryBlock = currentFn.blocks[entryId];
            if (entryBlock === undefined || entryBlock.exception !== undefined)
              continue;
            const entryTerm = entryBlock.terminator;
            if (
              entryTerm.kind !== "jump" ||
              entryTerm.target !== innerLoop.header
            )
              continue;
            const guarded = tryUncheckedListBounds(
              currentFn,
              innerLoop,
              entryId,
              rw.consequentId,
              rw.vectorSlot,
              rw.lengthSlot,
              rw.boundValueId,
              nextValue,
              cachedOrigin,
              uncheckedReader,
              rw.hasSlot,
            );
            if (
              guarded !== undefined &&
              recordReadsKept(currentFn, guarded.fn)
            ) {
              currentFn = guarded.fn;
              nextValue = guarded.nextValue;
              count += guarded.rewritten;
            }
          }
        }
      }
    }
    return { fn: currentFn, visited: work, rewritten: count };
  }
  return { module: { ...module, functions }, visited, rewritten };
}

/** Most instructions a bounds-versioned loop may have: its cold copy doubles them. */
const maxVersionedListLoopInstructions = 2000;

function isUint32Constant(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 4294967295 &&
    (value !== 0 || 1 / value > 0)
  );
}

/** The uint32 constant `slot` holds on every path to the end of block `at`,
 * if any (same forward dataflow as boundCountedLoops). */
function slotEntryConstant(
  fn: FunctionIR,
  slot: number,
  at: number,
): number | undefined {
  const count = fn.blocks.length,
    state = new Uint8Array(count),
    known = new Float64Array(count),
    out = new Uint8Array(count),
    outValue = new Float64Array(count),
    worklist: number[] = [fn.entry];
  state[fn.entry] = 2;
  const meet = (target: number, kind: number, value: number): void => {
    const before = state[target] ?? 0;
    if (before === 2) return;
    if (before === 1 && kind === 1 && known[target] === value) return;
    state[target] = before === 0 ? kind : 2;
    known[target] = value;
    worklist.push(target);
  };
  const constants = new Map<number, number>();
  while (worklist.length > 0) {
    const id = worklist.pop();
    if (id === undefined) break;
    const block = fn.blocks[id];
    if (block === undefined) continue;
    let kind = state[id] ?? 2,
      value = known[id] ?? 0;
    constants.clear();
    for (const op of block.instructions) {
      if (op === undefined) continue;
      if (op.kind === "constant") {
        const literal = op.value;
        if (typeof literal === "number") constants.set(op.id, literal);
      } else if (op.kind === "store" && op.slot === slot) {
        const stored = constants.get(op.value);
        if (stored === undefined || !isUint32Constant(stored)) kind = 2;
        else {
          kind = 1;
          value = stored;
        }
      }
    }
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.slot === slot &&
      t.operation !== "write"
    )
      kind = 2;
    out[id] = kind;
    outValue[id] = value;
    for (const target of blockSuccessors(block))
      if (target !== undefined) meet(target, kind, value);
    if (block.exception !== undefined) meet(block.exception.target, 2, 0);
  }
  return out[at] === 1 ? outValue[at] : undefined;
}

function retargetTerminator(
  term: Terminator,
  route: (id: number) => number,
): Terminator {
  if (term.kind === "jump") return { ...term, target: route(term.target) };
  if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  )
    return {
      ...term,
      consequent: route(term.consequent),
      alternate: route(term.alternate),
    };
  return term;
}

function tryUncheckedListBounds(
  fn: FunctionIR,
  loop: NaturalLoop,
  freshId: number,
  condBlockId: number,
  vectorSlot: number,
  boundSlot: number,
  boundValueId: number,
  firstValue: number,
  cachedOrigin: ReadonlyMap<number, number>,
  uncheckedReader: (reader: number) => number,
  hasSlot?: number,
):
  | {
      readonly fn: FunctionIR;
      readonly nextValue: number;
      readonly rewritten: number;
    }
  | undefined {
  const condBlock = fn.blocks[condBlockId],
    freshBlock = fn.blocks[freshId],
    headerBlock = fn.blocks[loop.header];
  if (
    condBlock === undefined ||
    freshBlock === undefined ||
    headerBlock === undefined
  )
    return undefined;
  if (hasSlot !== undefined) {
    const headerTerm = headerBlock.terminator;
    if (
      headerBlock.exception !== undefined ||
      headerTerm.kind !== "branch" ||
      headerTerm.consequent !== condBlockId ||
      loop.header === condBlockId
    )
      return undefined;
    for (const op of headerBlock.instructions) {
      if (
        op === undefined ||
        (op.kind !== "load" &&
          op.kind !== "constant" &&
          op.kind !== "reference-value")
      )
        return undefined;
    }
  }
  const cTerm = condBlock.terminator;
  if (
    cTerm.kind !== "branch" ||
    !loop.body.has(cTerm.consequent) ||
    loop.body.has(cTerm.alternate)
  )
    return undefined;
  let condOp: Instruction | undefined;
  const condLoads = new Map<number, number>();
  for (const op of condBlock.instructions) {
    if (op === undefined) return undefined;
    if (op.kind === "load") condLoads.set(op.id, op.slot);
    if (instructionResult(op) === cTerm.condition) condOp = op;
  }
  if (
    condOp === undefined ||
    condOp.kind !== "binary" ||
    condOp.operator !== "<" ||
    condOp.right !== boundValueId
  )
    return undefined;
  const counter = condLoads.get(condOp.left);
  if (
    counter === undefined ||
    counter === boundSlot ||
    fn.slots[counter] !== "number"
  )
    return undefined;
  for (const op of condBlock.instructions)
    if (op !== undefined && op.kind === "store" && op.slot === counter)
      return undefined;
  const startValue = slotEntryConstant(fn, counter, freshId);
  if (startValue === undefined) return undefined;
  // Verify the counter is written solely by one `counter = counter + 1` in
  // the loop, collect matching cached reads, and ensure loop size is bounded.
  let totalInstructions = 0,
    stepBlock = -1,
    stepIndex = -1;
  const matched: {
    readonly blockId: number;
    readonly index: number;
    readonly reader: number;
  }[] = [];
  const matchedByBlock = new Map<number, number[]>();
  for (const id of loop.body) {
    const block = fn.blocks[id];
    if (block === undefined) return undefined;
    totalInstructions += block.instructions.length;
    if (totalInstructions > maxVersionedListLoopInstructions) return undefined;
    if (block.exception !== undefined && block.exception.slot === counter)
      return undefined;
    const bt = block.terminator;
    if (
      (bt.kind === "record" ||
        bt.kind === "record-cell" ||
        bt.kind === "cell") &&
      bt.operation === "read" &&
      bt.slot === counter
    )
      return undefined;
    const defs = new Map<number, Instruction>();
    for (let i = 0; i < block.instructions.length; i++) {
      const op = block.instructions[i];
      if (op === undefined) return undefined;
      const res = instructionResult(op);
      if (res !== undefined) defs.set(res, op);
      if (op.kind === "store" && op.slot === counter) {
        if (stepBlock >= 0) return undefined;
        const rhs = defs.get(op.value);
        if (rhs === undefined || rhs.kind !== "binary" || rhs.operator !== "+")
          return undefined;
        const l = defs.get(rhs.left),
          r = defs.get(rhs.right);
        const isOne = (x: Instruction | undefined): boolean =>
          x !== undefined && x.kind === "constant" && x.value === 1;
        const loaded = isOne(l) ? r : isOne(r) ? l : undefined;
        if (
          loaded === undefined ||
          loaded.kind !== "load" ||
          loaded.slot !== counter
        )
          return undefined;
        stepBlock = id;
        stepIndex = i;
      } else if (
        id !== loop.header &&
        id !== condBlockId &&
        op.kind === "call" &&
        op.id !== undefined
      ) {
        const reader = cachedOrigin.get(op.target);
        if (reader === undefined) continue;
        const vecArg = op.arguments[0],
          idxArg = op.arguments[2];
        if (vecArg === undefined || idxArg === undefined) continue;
        const vecDef = defs.get(vecArg);
        if (
          vecDef === undefined ||
          vecDef.kind !== "load" ||
          vecDef.slot !== vectorSlot
        )
          continue;
        const idxDef = defs.get(idxArg);
        let inRange = false;
        if (
          idxDef !== undefined &&
          idxDef.kind === "load" &&
          idxDef.slot === counter
        )
          inRange = true;
        else if (
          idxDef !== undefined &&
          idxDef.kind === "binary" &&
          idxDef.operator === "-"
        ) {
          const base = defs.get(idxDef.left),
            sub = defs.get(idxDef.right);
          if (
            base !== undefined &&
            base.kind === "load" &&
            base.slot === counter &&
            sub !== undefined &&
            sub.kind === "constant"
          ) {
            const subValue = sub.value;
            if (
              typeof subValue === "number" &&
              Number.isInteger(subValue) &&
              subValue >= 0 &&
              subValue <= startValue
            )
              inRange = true;
          }
        }
        if (inRange) {
          matched.push({ blockId: id, index: i, reader });
          let list = matchedByBlock.get(id);
          if (list === undefined) {
            list = [];
            matchedByBlock.set(id, list);
          }
          list.push(i);
        }
      }
    }
  }
  if (stepBlock < 0 || matched.length === 0) return undefined;
  // Ensure no matched read executes after the counter increment in the same
  // iteration (before re-checking `counter < bound` at the loop header).
  for (const idx of matchedByBlock.get(stepBlock) ?? [])
    if (idx !== undefined && idx > stepIndex) return undefined;
  const stepB = fn.blocks[stepBlock];
  if (stepB === undefined) return undefined;
  const seenAfterStep = new Set<number>(),
    queue: number[] = [];
  for (const succ of blockSuccessors(stepB))
    if (succ !== undefined && succ !== loop.header && loop.body.has(succ)) {
      seenAfterStep.add(succ);
      queue.push(succ);
    }
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    if (id === stepBlock || matchedByBlock.has(id)) return undefined;
    const b = fn.blocks[id];
    if (b === undefined) return undefined;
    for (const succ of blockSuccessors(b))
      if (
        succ !== undefined &&
        succ !== loop.header &&
        loop.body.has(succ) &&
        !seenAfterStep.has(succ)
      ) {
        seenAfterStep.add(succ);
        queue.push(succ);
      }
  }
  // Clone loop.body into a cold copy (keeping cachedReader calls) and rewrite
  // matched reads in the hot loop to uncheckedReader.
  let nextValue = firstValue;
  const blocks: Block[] = fn.blocks.slice(),
    copies = new Map<number, number>();
  for (const id of loop.body) {
    if (id === undefined) return undefined;
    copies.set(id, blocks.length);
    blocks.push({
      id: blocks.length,
      instructions: [],
      terminator: { kind: "trap", start: 0, end: 0 },
    });
  }
  const route = (target: number): number => copies.get(target) ?? target,
    substitution = new Uint32Array(firstValue);
  for (const original of loop.body) {
    if (original === undefined) return undefined;
    const block = fn.blocks[original],
      copyId = copies.get(original);
    if (block === undefined || copyId === undefined) return undefined;
    substitution.fill(0);
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      const substituted = substituteInstructionValues(op, substitution),
        result = instructionResult(op);
      let copied = substituted;
      if (result !== undefined) {
        const renamed = nextValue++;
        substitution[result] = renamed + 1;
        copied = renumberInstructionResult(substituted, renamed);
      }
      instructions.push(copied);
    }
    const copyTerm = retargetTerminator(
      substituteTerminatorValues(block.terminator, substitution),
      route,
    );
    blocks[copyId] =
      block.exception === undefined
        ? { id: copyId, instructions, terminator: copyTerm }
        : {
            id: copyId,
            instructions,
            terminator: copyTerm,
            exception: {
              ...block.exception,
              target: route(block.exception.target),
            },
          };
  }
  const coldHeader = copies.get(loop.header);
  if (coldHeader === undefined) return undefined;
  // Rewrite matched reads in the hot loop to uncheckedReader.
  const hotBlocks = new Map<number, Instruction[]>();
  for (const m of matched) {
    if (m === undefined) continue;
    let insts = hotBlocks.get(m.blockId);
    if (insts === undefined) {
      const orig = blocks[m.blockId];
      if (orig === undefined) return undefined;
      insts = orig.instructions.slice();
      hotBlocks.set(m.blockId, insts);
    }
    const op = insts[m.index];
    if (op === undefined || op.kind !== "call") return undefined;
    insts[m.index] = { ...op, target: uncheckedReader(m.reader) };
  }
  for (const [id, instructions] of hotBlocks) {
    const orig = blocks[id];
    if (orig === undefined) return undefined;
    blocks[id] = { ...orig, instructions };
  }
  if (hasSlot !== undefined) {
    // Hot inner loop already verified `hasSlot` in its preheader: skip the
    // per-iteration `isDense` check in `loop.header` (cold copy keeps it).
    blocks[loop.header] = {
      id: loop.header,
      instructions: [],
      terminator: {
        kind: "jump",
        target: condBlockId,
        start: headerBlock.terminator.start,
        end: headerBlock.terminator.end,
      },
    };
  }
  // Guard in freshId: [hasSlot &&] vector !== none && vector.length >= boundSlot.
  const vecCheckId = hasSlot === undefined ? freshId : blocks.length,
    lenCheckId = hasSlot === undefined ? blocks.length : vecCheckId + 1,
    hotEntryId = lenCheckId + 1,
    coldEntryId = lenCheckId + 2;
  const vVecOpt = nextValue++,
    vPresent = nextValue++;
  if (hasSlot !== undefined) {
    const vHas = nextValue++,
      freshInsts: Instruction[] = freshBlock.instructions.slice();
    freshInsts.push({
      kind: "load",
      id: vHas,
      slot: hasSlot,
      start: 0,
      end: 0,
    });
    blocks[freshId] = {
      ...freshBlock,
      instructions: freshInsts,
      terminator: {
        kind: "branch",
        condition: vHas,
        consequent: vecCheckId,
        alternate: coldEntryId,
        start: 0,
        end: 0,
      },
    };
    blocks.push({
      id: vecCheckId,
      instructions: [
        { kind: "load", id: vVecOpt, slot: vectorSlot, start: 0, end: 0 },
        {
          kind: "unary",
          id: vPresent,
          operator: "truthy",
          operand: vVecOpt,
          start: 0,
          end: 0,
        },
      ],
      terminator: {
        kind: "branch",
        condition: vPresent,
        consequent: lenCheckId,
        alternate: coldEntryId,
        start: 0,
        end: 0,
      },
    });
  } else {
    const freshInsts: Instruction[] = freshBlock.instructions.slice();
    freshInsts.push({
      kind: "load",
      id: vVecOpt,
      slot: vectorSlot,
      start: 0,
      end: 0,
    });
    freshInsts.push({
      kind: "unary",
      id: vPresent,
      operator: "truthy",
      operand: vVecOpt,
      start: 0,
      end: 0,
    });
    blocks[freshId] = {
      ...freshBlock,
      instructions: freshInsts,
      terminator: {
        kind: "branch",
        condition: vPresent,
        consequent: lenCheckId,
        alternate: coldEntryId,
        start: 0,
        end: 0,
      },
    };
  }
  const vVecOpt2 = nextValue++,
    vVec = nextValue++,
    vVecLen = nextValue++,
    vBound = nextValue++,
    vOk = nextValue++;
  const lenInsts: Instruction[] = [];
  lenInsts.push({
    kind: "load",
    id: vVecOpt2,
    slot: vectorSlot,
    start: 0,
    end: 0,
  });
  lenInsts.push({
    kind: "reference-value",
    id: vVec,
    value: vVecOpt2,
    start: 0,
    end: 0,
  });
  lenInsts.push({
    kind: "reference-vector-length",
    id: vVecLen,
    vector: vVec,
    start: 0,
    end: 0,
  });
  lenInsts.push({
    kind: "load",
    id: vBound,
    slot: boundSlot,
    start: 0,
    end: 0,
  });
  lenInsts.push({
    kind: "binary",
    id: vOk,
    operator: ">=",
    left: vVecLen,
    right: vBound,
    start: 0,
    end: 0,
  });
  blocks.push({
    id: lenCheckId,
    instructions: lenInsts,
    terminator: {
      kind: "branch",
      condition: vOk,
      consequent: hotEntryId,
      alternate: coldEntryId,
      start: 0,
      end: 0,
    },
  });
  blocks.push({
    id: hotEntryId,
    instructions: [],
    terminator: { kind: "jump", target: loop.header, start: 0, end: 0 },
  });
  blocks.push({
    id: coldEntryId,
    instructions: [],
    terminator: { kind: "jump", target: coldHeader, start: 0, end: 0 },
  });
  const debug =
    fn.debug === undefined ? undefined : retainDebugValues(fn, blocks);
  const resultFn: FunctionIR =
    debug === undefined ? { ...fn, blocks } : { ...fn, blocks, debug };
  return { fn: resultFn, nextValue, rewritten: matched.length };
}

/** Hoists dense direct-reference `ReferenceList` push loops (`len = list.length;
 * __tint_reference_list_write(list, len, elem)`) for freshly created, unescaped
 * lists: caches `vec` (optional-reference), `len` (uint32 int64), and `cap`
 * (uint32 int64) in slots across the loop, executes an unchecked vector write +
 * `len++` on the `len < cap` fast path, falls back to the writer on growth and
 * refreshes the cache, and writes `list.length = len` once on loop exit. */
function hoistPushLoops(
  fn: FunctionIR,
  writers: ReadonlyMap<number, number>,
  readOnly: ReadonlySet<number>,
  writerElementType: (writer: number) => ScalarType,
  vectorAccessor: (header: number) => number,
  uncheckedWriter: (writer: number) => number,
  budget: number,
):
  | {
      readonly fn: FunctionIR;
      readonly visited: number;
      readonly rewritten: number;
    }
  | undefined {
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { fn, visited, rewritten: 0 };

  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      const r = instructionResult(op);
      if (r !== undefined && r >= nextValue) nextValue = r + 1;
    }
  }

  // Process innermost loops first.
  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) continue;
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }

  let current = fn,
    rewritten = 0;
  const touched = new Set<number>();
  let cachedPredecessors: number[][] | undefined;

  for (const loop of loops) {
    if (loop === undefined) continue;
    let overlap = false;
    for (const id of loop.body) if (touched.has(id)) overlap = true;
    if (overlap) continue;

    if (cachedPredecessors === undefined) {
      const built: number[][] = [];
      for (let i = 0; i < current.blocks.length; i++) built.push([]);
      for (const block of current.blocks) {
        if (block === undefined) return undefined;
        for (const succ of blockSuccessors(block)) built[succ]?.push(block.id);
        if (block.exception !== undefined)
          built[block.exception.target]?.push(block.id);
      }
      cachedPredecessors = built;
    }
    const predecessors = cachedPredecessors;

    const outside = (predecessors[loop.header] ?? []).filter(
      (id) => !loop.body.has(id),
    );
    const preheaderId = outside[0];
    if (
      outside.length !== 1 ||
      preheaderId === undefined ||
      touched.has(preheaderId)
    )
      continue;
    const preheader = current.blocks[preheaderId];
    const preTerm = preheader?.terminator;
    if (
      preheader === undefined ||
      preheader.exception !== undefined ||
      preTerm === undefined ||
      preTerm.kind !== "jump" ||
      preTerm.target !== loop.header
    )
      continue;

    let irreducible = false;
    for (const id of loop.body) {
      if (id === loop.header) continue;
      if ((predecessors[id] ?? []).some((p) => !loop.body.has(p))) {
        irreducible = true;
        break;
      }
    }
    if (irreducible) continue;

    // Single non-trap exit target, no exceptions/throws/returns, and find the
    // single writer call in `loop.body`.
    const isPureTrap = (bid: number): boolean => {
      const tb = current.blocks[bid];
      return (
        tb !== undefined &&
        tb.instructions.length === 0 &&
        tb.terminator.kind === "trap" &&
        tb.exception === undefined
      );
    };
    let valid = true,
      exitTarget = -1,
      pushBlockId = -1,
      pushIndex = -1,
      writerTarget = -1,
      header = -1;
    for (const id of loop.body) {
      const block = current.blocks[id];
      if (block === undefined || block.exception !== undefined) {
        valid = false;
        break;
      }
      visited += block.instructions.length + 1;
      if (visited > budget) return undefined;
      const t = block.terminator;
      if (
        t.kind === "throw" ||
        t.kind === "throw-literal" ||
        t.kind === "return" ||
        t.kind === "trap"
      ) {
        valid = false;
        break;
      }
      for (const succ of blockSuccessors(block))
        if (!loop.body.has(succ)) {
          if (isPureTrap(succ)) continue;
          if (exitTarget < 0) exitTarget = succ;
          else if (exitTarget !== succ) {
            valid = false;
            break;
          }
        }
      if (!valid) break;
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) {
          valid = false;
          break;
        }
        if (op.kind === "call") {
          const wHeader = writers.get(op.target);
          if (wHeader !== undefined) {
            if (pushBlockId >= 0) {
              valid = false;
              break;
            }
            pushBlockId = id;
            pushIndex = i;
            writerTarget = op.target;
            header = wHeader;
          } else if (!readOnly.has(op.target)) {
            valid = false;
            break;
          }
        } else if (
          op.kind === "call-indirect" ||
          op.kind === "host-call" ||
          op.kind === "c-call"
        ) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }
    if (!valid || exitTarget < 0 || pushBlockId < 0 || header < 0) continue;

    const pushBlock = current.blocks[pushBlockId];
    if (pushBlock === undefined) continue;
    const pushOp = pushBlock.instructions[pushIndex];
    if (pushOp === undefined || pushOp.kind !== "call") continue;
    const argList = pushOp.arguments[0],
      argIndex = pushOp.arguments[1],
      argElem = pushOp.arguments[2];
    if (
      argList === undefined ||
      argIndex === undefined ||
      argElem === undefined
    )
      continue;

    const defs = new Map<number, Instruction>(),
      defPos = new Map<number, number>(),
      useCount = new Map<number, number>();
    for (let i = 0; i < pushBlock.instructions.length; i++) {
      const op = pushBlock.instructions[i];
      if (op === undefined) continue;
      const r = instructionResult(op);
      if (r !== undefined) {
        defs.set(r, op);
        defPos.set(r, i);
      }
      visitInstructionOperands(op, (v) =>
        useCount.set(v, (useCount.get(v) ?? 0) + 1),
      );
    }
    visitTerminatorOperands(pushBlock.terminator, (v) =>
      useCount.set(v, (useCount.get(v) ?? 0) + 1),
    );

    const listDef = defs.get(argList);
    if (
      listDef === undefined ||
      listDef.kind !== "load" ||
      current.slots[listDef.slot] !== "reference" ||
      loop.writes.has(listDef.slot)
    )
      continue;
    const listSlot = listDef.slot;

    // Match `argIndex` either as `record-read(load(listSlot), header, 0)` in
    // `pushBlock` OR as `load(lenTempSlot)` populated by the unique in-loop
    // predecessor `readBlock`'s `record(read, load(listSlot), header, 0)`
    // terminator (whose alternate is a pure trap block).
    const idxDef = defs.get(argIndex);
    if (idxDef === undefined || (useCount.get(argIndex) ?? 0) !== 1) continue;
    const idxReadPos = defPos.get(argIndex) ?? -1;
    if (idxReadPos < 0 || idxReadPos >= pushIndex) continue;
    let inlineIdxObjId = -1,
      readBlockId = -1,
      readObjId = -1,
      readTrapId = -1,
      lenTempSlot = -1;
    if (
      idxDef.kind === "record-read" &&
      idxDef.record === header &&
      idxDef.field === 0
    ) {
      const idxObjDef = defs.get(idxDef.object);
      if (
        idxObjDef === undefined ||
        idxObjDef.kind !== "load" ||
        idxObjDef.slot !== listSlot
      )
        continue;
      inlineIdxObjId = idxDef.object;
    } else if (idxDef.kind === "load") {
      const slot = idxDef.slot;
      const predsOfPush = predecessors[pushBlockId] ?? [];
      const rbId = predsOfPush[0];
      if (
        predsOfPush.length !== 1 ||
        rbId === undefined ||
        !loop.body.has(rbId) ||
        rbId === pushBlockId
      )
        continue;
      const rb = current.blocks[rbId];
      if (rb === undefined) continue;
      const rt = rb.terminator;
      if (
        rt.kind !== "record" ||
        rt.operation !== "read" ||
        rt.record !== header ||
        rt.field !== 0 ||
        rt.slot !== slot ||
        rt.consequent !== pushBlockId ||
        !isPureTrap(rt.alternate)
      )
        continue;
      // Ensure `rt.object` is `load(listSlot)` in `rb`.
      let matchedObj = false;
      for (const op of rb.instructions) {
        if (
          op !== undefined &&
          op.kind === "load" &&
          op.id === rt.object &&
          op.slot === listSlot
        ) {
          matchedObj = true;
          break;
        }
      }
      if (!matchedObj) continue;
      // Ensure `slot` is not read anywhere else inside `loop.body`, nor read
      // after `exitTarget` before being overwritten.
      let slotLiveElsewhere = false;
      for (const id of loop.body) {
        const b = current.blocks[id];
        if (b === undefined) {
          slotLiveElsewhere = true;
          break;
        }
        for (const op of b.instructions)
          if (
            op !== undefined &&
            op.kind === "load" &&
            op.slot === slot &&
            !(id === pushBlockId && op.id === argIndex)
          ) {
            slotLiveElsewhere = true;
            break;
          }
        const bt = b.terminator;
        if (
          (bt.kind === "record" ||
            bt.kind === "record-cell" ||
            bt.kind === "cell") &&
          bt.operation === "write" &&
          bt.slot === slot
        )
          slotLiveElsewhere = true;
        if (slotLiveElsewhere) break;
      }
      if (!slotLiveElsewhere) {
        // BFS from `exitTarget` stopping at blocks that write `slot`.
        const seen = new Set<number>();
        const q: number[] = [exitTarget];
        seen.add(exitTarget);
        while (q.length > 0 && !slotLiveElsewhere) {
          const bid = q.pop();
          if (bid === undefined) break;
          const b = current.blocks[bid];
          if (b === undefined) {
            slotLiveElsewhere = true;
            break;
          }
          let overwritten = false;
          for (const op of b.instructions) {
            if (op === undefined) continue;
            if (op.kind === "load" && op.slot === slot) {
              slotLiveElsewhere = true;
              break;
            }
            if (op.kind === "store" && op.slot === slot) {
              overwritten = true;
              break;
            }
          }
          if (slotLiveElsewhere || overwritten) continue;
          const bt = b.terminator;
          if (
            (bt.kind === "record" ||
              bt.kind === "record-cell" ||
              bt.kind === "cell") &&
            bt.operation === "write" &&
            bt.slot === slot
          ) {
            slotLiveElsewhere = true;
            break;
          }
          const readsSlot =
            (bt.kind === "record" ||
              bt.kind === "record-cell" ||
              bt.kind === "cell") &&
            bt.operation !== "write" &&
            bt.slot === slot;
          for (const succ of blockSuccessors(b)) {
            if (
              readsSlot &&
              (bt.kind === "record" ||
                bt.kind === "record-cell" ||
                bt.kind === "cell") &&
              succ === bt.consequent
            )
              continue;
            if (!seen.has(succ)) {
              seen.add(succ);
              q.push(succ);
            }
          }
        }
      }
      if (slotLiveElsewhere) continue;
      readBlockId = rbId;
      readObjId = rt.object;
      readTrapId = rt.alternate;
      lenTempSlot = slot;
    } else continue;

    // Ensure no SSA value defined before `pushIndex` is used after `pushIndex`
    // (since splitting `pushBlock` requires block-local SSA).
    let liveAcross = false;
    for (let i = pushIndex + 1; i < pushBlock.instructions.length; i++) {
      const op = pushBlock.instructions[i];
      if (op === undefined) continue;
      visitInstructionOperands(op, (v) => {
        const p = defPos.get(v);
        if (p !== undefined && p < pushIndex) liveAcross = true;
      });
    }
    visitTerminatorOperands(pushBlock.terminator, (v) => {
      const p = defPos.get(v);
      if (p !== undefined && p < pushIndex) liveAcross = true;
    });
    if (liveAcross) continue;

    // Ensure no other instruction or terminator in `loop.body` touches
    // `listSlot` (except the matched push/length loads) or writes `header`.
    let otherTouch = false;
    for (const id of loop.body) {
      const b = current.blocks[id];
      if (b === undefined) {
        otherTouch = true;
        break;
      }
      const bt = b.terminator;
      if (
        (bt.kind === "record" || bt.kind === "record-cell") &&
        bt.record === header &&
        id !== readBlockId
      ) {
        otherTouch = true;
        break;
      }
      for (let i = 0; i < b.instructions.length; i++) {
        const op = b.instructions[i];
        if (op === undefined) continue;
        if (op.kind === "load" && op.slot === listSlot) {
          const allowedInPush =
            id === pushBlockId &&
            (op.id === argList || op.id === inlineIdxObjId);
          const allowedInRead = id === readBlockId && op.id === readObjId;
          if (!allowedInPush && !allowedInRead) {
            otherTouch = true;
            break;
          }
        }
        if (
          op.kind === "record-read" &&
          op.record === header &&
          !(inlineIdxObjId >= 0 && id === pushBlockId && i === idxReadPos)
        ) {
          otherTouch = true;
          break;
        }
      }
      if (otherTouch) break;
    }
    if (otherTouch) continue;

    // Match a simple counted loop `for (i = start; i < bound; i += 1)` so we
    // can pre-allocate the backing vector once in `freshBlockId`, and when
    // every backedge steps `i` by +1 with no inner cycle, drop the per-push
    // `len < cap` check and slow growth path completely.
    const matchCountedPushBound = ():
      { readonly capacity: number; readonly exact: boolean } | undefined => {
      if (pushBlockId === loop.header) return undefined;
      const hb = current.blocks[loop.header];
      const ht = hb?.terminator;
      if (hb === undefined || ht === undefined || ht.kind !== "branch")
        return undefined;
      let exitOnTrue = false;
      if (ht.consequent === exitTarget && loop.body.has(ht.alternate))
        exitOnTrue = true;
      else if (ht.alternate === exitTarget && loop.body.has(ht.consequent))
        exitOnTrue = false;
      else return undefined;

      const hDefs = new Map<number, Instruction>();
      for (const op of hb.instructions) {
        if (op === undefined) continue;
        const r = instructionResult(op);
        if (r !== undefined) hDefs.set(r, op);
      }
      const condOp = hDefs.get(ht.condition);
      if (condOp === undefined || condOp.kind !== "binary") return undefined;
      let stayOp = condOp.operator;
      if (exitOnTrue) {
        if (stayOp === "<") stayOp = ">=";
        else if (stayOp === "<=") stayOp = ">";
        else if (stayOp === ">") stayOp = "<=";
        else if (stayOp === ">=") stayOp = "<";
        else return undefined;
      }
      let lhs: Instruction | undefined,
        rhs: Instruction | undefined,
        inclusive = false;
      if (stayOp === "<" || stayOp === "<=") {
        lhs = hDefs.get(condOp.left);
        rhs = hDefs.get(condOp.right);
        inclusive = stayOp === "<=";
      } else if (stayOp === ">" || stayOp === ">=") {
        lhs = hDefs.get(condOp.right);
        rhs = hDefs.get(condOp.left);
        inclusive = stayOp === ">=";
      } else return undefined;

      if (
        lhs === undefined ||
        lhs.kind !== "load" ||
        current.slots[lhs.slot] !== "number" ||
        !loop.writes.has(lhs.slot)
      )
        return undefined;
      const counterSlot = lhs.slot;

      const scanSlotConstant = (slot: number): number | undefined => {
        let cur = preheaderId;
        for (let hops = 0; hops < 4; hops++) {
          const sb = current.blocks[cur];
          if (sb === undefined || sb.exception !== undefined) return undefined;
          const sDefs = new Map<number, Instruction>();
          for (const op of sb.instructions) {
            if (op === undefined) continue;
            const r = instructionResult(op);
            if (r !== undefined) sDefs.set(r, op);
          }
          for (let i = sb.instructions.length - 1; i >= 0; i--) {
            const op = sb.instructions[i];
            if (op !== undefined && op.kind === "store" && op.slot === slot) {
              const v = sDefs.get(op.value);
              if (v === undefined || v.kind !== "constant") return undefined;
              const cv = v.value;
              return typeof cv === "number" && Number.isSafeInteger(cv)
                ? cv
                : undefined;
            }
          }
          const st = sb.terminator;
          if (
            (st.kind === "record" ||
              st.kind === "record-cell" ||
              st.kind === "cell") &&
            st.operation !== "write" &&
            st.slot === slot
          )
            return undefined;
          const preds = predecessors[cur] ?? [];
          const prev = preds[0];
          if (preds.length !== 1 || prev === undefined) return undefined;
          const pb = current.blocks[prev],
            pt = pb?.terminator;
          if (
            pb === undefined ||
            pt === undefined ||
            pt.kind !== "jump" ||
            pt.target !== cur
          )
            return undefined;
          cur = prev;
        }
        return undefined;
      };

      let boundVal: number | undefined;
      if (rhs !== undefined && rhs.kind === "constant") {
        const cv = rhs.value;
        if (typeof cv === "number" && Number.isSafeInteger(cv)) boundVal = cv;
      } else if (
        rhs !== undefined &&
        rhs.kind === "load" &&
        current.slots[rhs.slot] === "number" &&
        !loop.writes.has(rhs.slot)
      )
        boundVal = scanSlotConstant(rhs.slot);
      if (boundVal === undefined) return undefined;

      const startVal = scanSlotConstant(counterSlot);
      if (startVal === undefined) return undefined;
      const iterations = inclusive
        ? boundVal - startVal + 1
        : boundVal - startVal;
      if (
        !Number.isSafeInteger(iterations) ||
        iterations < 1 ||
        iterations > 4096
      )
        return undefined;

      // Verify whether `pushBlockId` can execute at most `iterations` times:
      // 1. `loop.body` excluding edges to `loop.header` is a DAG (no inner
      //    cycles, so each block runs at most once per header trip).
      let exact = true;
      const color = new Map<number, number>();
      function hasCycle(u: number): boolean {
        color.set(u, 1);
        const ub = current.blocks[u];
        if (ub !== undefined) {
          for (const succ of blockSuccessors(ub)) {
            if (!loop.body.has(succ) || succ === loop.header) continue;
            const c = color.get(succ) ?? 0;
            if (c === 1) return true;
            if (c === 0 && hasCycle(succ)) return true;
          }
        }
        color.set(u, 2);
        return false;
      }
      for (const id of loop.body) {
        if ((color.get(id) ?? 0) === 0 && hasCycle(id)) {
          exact = false;
          break;
        }
      }

      // 2. `counterSlot` has a single write in `loop.body`, in a non-header
      //    block `stepBlockId`, which adds +1 without integer wrap.
      let stepBlockId = -1;
      if (exact) {
        let storeCount = 0;
        for (const id of loop.body) {
          const b = current.blocks[id];
          if (b === undefined) {
            exact = false;
            break;
          }
          const bt = b.terminator;
          if (
            (bt.kind === "record" ||
              bt.kind === "record-cell" ||
              bt.kind === "cell") &&
            bt.operation !== "write" &&
            bt.slot === counterSlot
          ) {
            exact = false;
            break;
          }
          const bDefs = new Map<number, Instruction>();
          for (const op of b.instructions) {
            if (op === undefined) continue;
            const r = instructionResult(op);
            if (r !== undefined) bDefs.set(r, op);
            if (op.kind === "store" && op.slot === counterSlot) {
              storeCount++;
              if (storeCount > 1 || id === loop.header) {
                exact = false;
                break;
              }
              let rhsDef = bDefs.get(op.value);
              if (rhsDef !== undefined && rhsDef.kind === "unary") {
                if (
                  rhsDef.operator === "int32" &&
                  startVal >= 0 &&
                  boundVal < 0x7fffffff
                )
                  rhsDef = bDefs.get(rhsDef.operand);
                else if (
                  rhsDef.operator === "uint32" &&
                  startVal >= 0 &&
                  boundVal < 0xffffffff
                )
                  rhsDef = bDefs.get(rhsDef.operand);
                else {
                  exact = false;
                  break;
                }
              }
              if (
                rhsDef === undefined ||
                rhsDef.kind !== "binary" ||
                rhsDef.operator !== "+"
              ) {
                exact = false;
                break;
              }
              const lDef = bDefs.get(rhsDef.left),
                rDef = bDefs.get(rhsDef.right);
              const plusOne =
                (lDef !== undefined &&
                  lDef.kind === "load" &&
                  lDef.slot === counterSlot &&
                  rDef !== undefined &&
                  rDef.kind === "constant" &&
                  rDef.value === 1) ||
                (rDef !== undefined &&
                  rDef.kind === "load" &&
                  rDef.slot === counterSlot &&
                  lDef !== undefined &&
                  lDef.kind === "constant" &&
                  lDef.value === 1);
              if (!plusOne) {
                exact = false;
                break;
              }
              stepBlockId = id;
            }
          }
          if (!exact) break;
        }
        if (storeCount !== 1 || stepBlockId < 0) exact = false;
      }

      // 3. Every path from `loop.header` to a backedge (`-> loop.header`)
      //    must pass through `stepBlockId`.
      if (exact) {
        const seen = new Set<number>();
        seen.add(loop.header);
        const stack: number[] = [loop.header];
        while (stack.length > 0 && exact) {
          const u = stack.pop();
          if (u === undefined || u === stepBlockId) continue;
          const ub = current.blocks[u];
          if (ub === undefined) {
            exact = false;
            break;
          }
          for (const succ of blockSuccessors(ub)) {
            if (!loop.body.has(succ)) continue;
            if (succ === loop.header) {
              exact = false;
              break;
            }
            if (!seen.has(succ)) {
              seen.add(succ);
              stack.push(succ);
            }
          }
        }
      }

      return { capacity: iterations, exact };
    };

    // Verify `listSlot` is freshly created by an empty `record-new(header,
    // [constant 0, reference-none])` in `preheader` (or up a unique-pred
    // chain) with no intervening reads, writes, or escapes of `listSlot`.
    let freshEmpty = false,
      freshBlockId = -1,
      freshRecordPos = -1,
      freshRecordId = -1,
      freshRecordStart = 0,
      freshRecordEnd = 0,
      freshRecordInline: number | undefined,
      freshArg0 = -1,
      scanId = preheaderId;
    for (let hops = 0; hops < 4; hops++) {
      const sb = current.blocks[scanId];
      if (sb === undefined || sb.exception !== undefined) break;
      const sDefs = new Map<number, Instruction>(),
        sDefPos = new Map<number, number>(),
        sUses = new Map<number, number>();
      for (let idx = 0; idx < sb.instructions.length; idx++) {
        const op = sb.instructions[idx];
        if (op === undefined) continue;
        const r = instructionResult(op);
        if (r !== undefined) {
          sDefs.set(r, op);
          sDefPos.set(r, idx);
        }
        visitInstructionOperands(op, (v) =>
          sUses.set(v, (sUses.get(v) ?? 0) + 1),
        );
      }
      visitTerminatorOperands(sb.terminator, (v) =>
        sUses.set(v, (sUses.get(v) ?? 0) + 1),
      );
      let touchedSlot = false;
      for (let i = sb.instructions.length - 1; i >= 0; i--) {
        const op = sb.instructions[i];
        if (op === undefined) continue;
        if (op.kind === "load" && op.slot === listSlot) {
          touchedSlot = true;
          break;
        }
        if (op.kind === "store" && op.slot === listSlot) {
          touchedSlot = true;
          const created = sDefs.get(op.value);
          if (
            created !== undefined &&
            created.kind === "record-new" &&
            created.record === header &&
            created.arguments.length === 2 &&
            (sUses.get(created.id) ?? 0) === 1
          ) {
            const arg0 = created.arguments[0],
              arg1 = created.arguments[1],
              a0 = arg0 === undefined ? undefined : sDefs.get(arg0),
              a1 = arg1 === undefined ? undefined : sDefs.get(arg1);
            if (
              arg0 !== undefined &&
              a0 !== undefined &&
              a0.kind === "constant" &&
              a0.value === 0 &&
              a1 !== undefined &&
              a1.kind === "reference-none"
            ) {
              freshEmpty = true;
              freshBlockId = scanId;
              freshRecordPos = sDefPos.get(created.id) ?? -1;
              freshRecordId = created.id;
              freshRecordStart = created.start;
              freshRecordEnd = created.end;
              freshRecordInline = created.inline;
              freshArg0 = arg0;
            }
          }
          break;
        }
      }
      if (touchedSlot) break;
      const preds = predecessors[scanId] ?? [];
      const prev = preds[0];
      if (preds.length !== 1 || prev === undefined) break;
      const pb = current.blocks[prev],
        pbTerm = pb?.terminator;
      if (
        pb === undefined ||
        pbTerm === undefined ||
        pbTerm.kind !== "jump" ||
        pbTerm.target !== scanId
      )
        break;
      scanId = prev;
    }
    if (!freshEmpty) continue;

    // Element type from writer's parameter 2.
    const actualElemType = writerElementType(writerTarget);
    if (
      actualElemType !== "optional-reference" &&
      actualElemType !== "optional-string"
    )
      continue;

    const canPresize =
      freshBlockId >= 0 &&
      freshRecordPos >= 0 &&
      freshRecordId >= 0 &&
      !touched.has(freshBlockId) &&
      !loop.body.has(freshBlockId);
    const countedBound = canPresize ? matchCountedPushBound() : undefined;
    const preCap = countedBound?.capacity;
    const exactBound = countedBound?.exact === true;

    const candSlots = current.slots.slice(),
      candBlocks = current.blocks.slice();
    let candNextValue = nextValue;
    const fresh = (): number => candNextValue++;

    const vecSlot = candSlots.length;
    candSlots.push(exactBound ? "reference" : "optional-reference");
    const lenSlot = candSlots.length;
    candSlots.push("number");
    const lenWriteSlot = candSlots.length;
    candSlots.push("number");

    if (preCap !== undefined && freshRecordId >= 0) {
      // Pre-allocate the backing vector once at `freshRecordPos` and attach it
      // directly to the new empty list header (`length = 0`, `root = vector`).
      const fb = candBlocks[freshBlockId];
      if (fb === undefined) continue;
      const fInsts: Instruction[] = [];
      for (let i = 0; i < fb.instructions.length; i++) {
        const op = fb.instructions[i];
        if (op === undefined) continue;
        if (i === freshRecordPos) {
          const vPreCap = fresh(),
            vPreVec = fresh(),
            vPreWrap = fresh(),
            preRecArgs: number[] = [freshArg0, vPreWrap];
          const rebuiltRec: Instruction =
            freshRecordInline === undefined
              ? {
                  kind: "record-new",
                  id: freshRecordId,
                  record: header,
                  arguments: preRecArgs,
                  start: freshRecordStart,
                  end: freshRecordEnd,
                }
              : {
                  kind: "record-new",
                  id: freshRecordId,
                  record: header,
                  arguments: preRecArgs,
                  start: freshRecordStart,
                  end: freshRecordEnd,
                  inline: freshRecordInline,
                };
          fInsts.push(
            { kind: "constant", id: vPreCap, value: preCap, start: 0, end: 0 },
            {
              kind: "reference-vector-new",
              id: vPreVec,
              length: vPreCap,
              start: 0,
              end: 0,
            },
            {
              kind: "reference-wrap",
              id: vPreWrap,
              value: vPreVec,
              start: 0,
              end: 0,
            },
            {
              kind: "store",
              slot: vecSlot,
              value: exactBound ? vPreVec : vPreWrap,
              start: 0,
              end: 0,
            },
            rebuiltRec,
          );
        } else {
          fInsts.push(op);
        }
      }
      candBlocks[freshBlockId] = { ...fb, instructions: fInsts };
    }

    if (exactBound) {
      // Preheader: initialize `lenSlot = 0`.
      const updatedPre = candBlocks[preheaderId];
      if (updatedPre === undefined) continue;
      const preInsts = updatedPre.instructions.slice(),
        vInitZero = fresh();
      preInsts.push(
        { kind: "constant", id: vInitZero, value: 0, start: 0, end: 0 },
        { kind: "store", slot: lenSlot, value: vInitZero, start: 0, end: 0 },
      );
      candBlocks[preheaderId] = { ...updatedPre, instructions: preInsts };

      const wbId = candBlocks.length,
        trapId = readTrapId >= 0 ? readTrapId : wbId + 1;

      // Replace the push call inline with the unchecked vector write + `len++`.
      const newPushInsts: Instruction[] = [];
      for (let i = 0; i < pushBlock.instructions.length; i++) {
        if (i === idxReadPos) continue;
        if (i === pushIndex) {
          const vFVec = fresh(),
            vFLen = fresh(),
            vFOne = fresh(),
            vFNext = fresh(),
            vFUintNext = fresh();
          const fastWriter = uncheckedWriter(writerTarget),
            fastArgs: number[] = [vFVec, argList, vFLen, argElem];
          newPushInsts.push(
            { kind: "load", id: vFVec, slot: vecSlot, start: 0, end: 0 },
            { kind: "load", id: vFLen, slot: lenSlot, start: 0, end: 0 },
            {
              kind: "call",
              id: undefined,
              target: fastWriter,
              arguments: fastArgs,
              start: 0,
              end: 0,
            },
            { kind: "constant", id: vFOne, value: 1, start: 0, end: 0 },
            {
              kind: "binary",
              id: vFNext,
              operator: "+",
              left: vFLen,
              right: vFOne,
              start: 0,
              end: 0,
            },
            {
              kind: "unary",
              id: vFUintNext,
              operator: "uint32",
              operand: vFNext,
              start: 0,
              end: 0,
            },
            {
              kind: "store",
              slot: lenSlot,
              value: vFUintNext,
              start: 0,
              end: 0,
            },
          );
          continue;
        }
        const op = pushBlock.instructions[i];
        if (op !== undefined) newPushInsts.push(op);
      }
      candBlocks[pushBlockId] = {
        ...pushBlock,
        instructions: newPushInsts,
        terminator: retargetTerminator(pushBlock.terminator, (t) =>
          t === exitTarget ? wbId : t,
        ),
      };
      if (readBlockId >= 0) {
        const rb = candBlocks[readBlockId];
        if (rb !== undefined) {
          const rbUses = new Map<number, number>();
          for (const op of rb.instructions)
            if (op !== undefined)
              visitInstructionOperands(op, (v) =>
                rbUses.set(v, (rbUses.get(v) ?? 0) + 1),
              );
          const rbInsts =
            (rbUses.get(readObjId) ?? 0) === 0
              ? rb.instructions.filter(
                  (op) =>
                    op === undefined || instructionResult(op) !== readObjId,
                )
              : rb.instructions;
          candBlocks[readBlockId] = {
            ...rb,
            instructions: rbInsts,
            terminator: { kind: "jump", target: pushBlockId, start: 0, end: 0 },
          };
        }
      }
      void lenTempSlot;

      // Writeback block on loop exit: update `list.length = lenSlot`.
      const vWLen = fresh(),
        vWList = fresh();
      candBlocks.push({
        id: wbId,
        instructions: [
          { kind: "load", id: vWLen, slot: lenSlot, start: 0, end: 0 },
          { kind: "store", slot: lenWriteSlot, value: vWLen, start: 0, end: 0 },
          { kind: "load", id: vWList, slot: listSlot, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          operation: "write",
          object: vWList,
          record: header,
          field: 0,
          slot: lenWriteSlot,
          consequent: exitTarget,
          alternate: trapId,
          start: 0,
          end: 0,
        },
      });
      if (readTrapId < 0)
        candBlocks.push({
          id: trapId,
          instructions: [],
          terminator: { kind: "trap", start: 0, end: 0 },
        });

      for (const id of loop.body) {
        if (id === pushBlockId) continue;
        const b = candBlocks[id];
        if (b === undefined) continue;
        const nt = retargetTerminator(b.terminator, (t) =>
          t === exitTarget ? wbId : t,
        );
        if (nt !== b.terminator) candBlocks[id] = { ...b, terminator: nt };
      }

      const debug =
        current.debug === undefined
          ? undefined
          : retainDebugValues(current, candBlocks);
      const candidate: FunctionIR =
        debug === undefined
          ? { ...current, slots: candSlots, blocks: candBlocks }
          : { ...current, slots: candSlots, blocks: candBlocks, debug };
      if (!recordReadsKept(current, candidate)) continue;
      current = candidate;
      nextValue = candNextValue;
      rewritten++;
      for (const id of loop.body) touched.add(id);
      touched.add(preheaderId);
      touched.add(freshBlockId);
      continue;
    }

    const capSlot = candSlots.length;
    candSlots.push("number");
    const elemSlot = candSlots.length;
    candSlots.push(actualElemType);
    const lenRawSlot = candSlots.length;
    candSlots.push("number");

    // Preheader: initialize `vecSlot` (unless already pre-sized), `lenSlot = 0`,
    // and `capSlot` (`preCap` or `0`).
    const updatedPre = candBlocks[preheaderId];
    if (updatedPre === undefined) continue;
    const preInsts = updatedPre.instructions.slice(),
      vInitZero = fresh();
    if (preCap === undefined) {
      const vInitVec = fresh();
      preInsts.push(
        { kind: "reference-none", id: vInitVec, start: 0, end: 0 },
        { kind: "store", slot: vecSlot, value: vInitVec, start: 0, end: 0 },
        { kind: "constant", id: vInitZero, value: 0, start: 0, end: 0 },
        { kind: "store", slot: lenSlot, value: vInitZero, start: 0, end: 0 },
        { kind: "store", slot: capSlot, value: vInitZero, start: 0, end: 0 },
      );
    } else {
      const vInitCap = fresh();
      preInsts.push(
        { kind: "constant", id: vInitZero, value: 0, start: 0, end: 0 },
        { kind: "store", slot: lenSlot, value: vInitZero, start: 0, end: 0 },
        { kind: "constant", id: vInitCap, value: preCap, start: 0, end: 0 },
        { kind: "store", slot: capSlot, value: vInitCap, start: 0, end: 0 },
      );
    }
    candBlocks[preheaderId] = { ...updatedPre, instructions: preInsts };

    const fastId = candBlocks.length,
      slowId = fastId + 1,
      slowCapCheckId = fastId + 2,
      slowCapSomeId = fastId + 3,
      slowCapZeroId = fastId + 4,
      afterId = fastId + 5,
      wbId = fastId + 6,
      trapId = readTrapId >= 0 ? readTrapId : fastId + 7;

    // Split `pushBlock`: keep 0..pushIndex-1 (minus `idxReadPos`), store
    // `argElem` into `elemSlot`, then branch `len < cap ? fastId : slowId`.
    const beforeInsts: Instruction[] = [];
    for (let i = 0; i < pushIndex; i++) {
      if (i === idxReadPos) continue;
      const op = pushBlock.instructions[i];
      if (op !== undefined) beforeInsts.push(op);
    }
    const vLenCmp = fresh(),
      vCapCmp = fresh(),
      vFits = fresh();
    beforeInsts.push(
      { kind: "store", slot: elemSlot, value: argElem, start: 0, end: 0 },
      { kind: "load", id: vLenCmp, slot: lenSlot, start: 0, end: 0 },
      { kind: "load", id: vCapCmp, slot: capSlot, start: 0, end: 0 },
      {
        kind: "binary",
        id: vFits,
        operator: "<",
        left: vLenCmp,
        right: vCapCmp,
        start: 0,
        end: 0,
      },
    );
    candBlocks[pushBlockId] = {
      ...pushBlock,
      instructions: beforeInsts,
      terminator: {
        kind: "branch",
        condition: vFits,
        consequent: fastId,
        alternate: slowId,
        start: 0,
        end: 0,
      },
    };
    if (readBlockId >= 0) {
      const rb = candBlocks[readBlockId];
      if (rb !== undefined) {
        // Drop the now-unused `record(read, field: 0)` terminator on `readBlock`.
        const rbUses = new Map<number, number>();
        for (const op of rb.instructions)
          if (op !== undefined)
            visitInstructionOperands(op, (v) =>
              rbUses.set(v, (rbUses.get(v) ?? 0) + 1),
            );
        const rbInsts =
          (rbUses.get(readObjId) ?? 0) === 0
            ? rb.instructions.filter(
                (op) => op === undefined || instructionResult(op) !== readObjId,
              )
            : rb.instructions;
        candBlocks[readBlockId] = {
          ...rb,
          instructions: rbInsts,
          terminator: { kind: "jump", target: pushBlockId, start: 0, end: 0 },
        };
      }
    }
    void lenTempSlot;

    // Fast path: unchecked vector store + `lenSlot = uint32(lenSlot + 1)`.
    const vFVecOpt = fresh(),
      vFVec = fresh(),
      vFList = fresh(),
      vFLen = fresh(),
      vFElem = fresh(),
      vFOne = fresh(),
      vFNext = fresh(),
      vFUintNext = fresh();
    const fastWriter = uncheckedWriter(writerTarget),
      fastArgs: number[] = [vFVec, vFList, vFLen, vFElem];
    candBlocks.push({
      id: fastId,
      instructions: [
        { kind: "load", id: vFVecOpt, slot: vecSlot, start: 0, end: 0 },
        {
          kind: "reference-value",
          id: vFVec,
          value: vFVecOpt,
          start: 0,
          end: 0,
        },
        { kind: "load", id: vFList, slot: listSlot, start: 0, end: 0 },
        { kind: "load", id: vFLen, slot: lenSlot, start: 0, end: 0 },
        { kind: "load", id: vFElem, slot: elemSlot, start: 0, end: 0 },
        {
          kind: "call",
          id: undefined,
          target: fastWriter,
          arguments: fastArgs,
          start: 0,
          end: 0,
        },
        { kind: "constant", id: vFOne, value: 1, start: 0, end: 0 },
        {
          kind: "binary",
          id: vFNext,
          operator: "+",
          left: vFLen,
          right: vFOne,
          start: 0,
          end: 0,
        },
        {
          kind: "unary",
          id: vFUintNext,
          operator: "uint32",
          operand: vFNext,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: lenSlot, value: vFUintNext, start: 0, end: 0 },
      ],
      terminator: { kind: "jump", target: afterId, start: 0, end: 0 },
    });

    // Slow path: call original writer, refresh `vecSlot`, `lenSlot`, `capSlot`.
    const vSList = fresh(),
      vSLen = fresh(),
      vSElem = fresh(),
      vSList2 = fresh(),
      vSListWrap = fresh(),
      vSNewVec = fresh(),
      vSList3 = fresh();
    const vecAcc = vectorAccessor(header),
      slowWriteArgs: number[] = [vSList, vSLen, vSElem],
      slowVecArgs: number[] = [vSListWrap];
    candBlocks.push({
      id: slowId,
      instructions: [
        { kind: "load", id: vSList, slot: listSlot, start: 0, end: 0 },
        { kind: "load", id: vSLen, slot: lenSlot, start: 0, end: 0 },
        { kind: "load", id: vSElem, slot: elemSlot, start: 0, end: 0 },
        {
          kind: "call",
          id: undefined,
          target: writerTarget,
          arguments: slowWriteArgs,
          start: 0,
          end: 0,
        },
        { kind: "load", id: vSList2, slot: listSlot, start: 0, end: 0 },
        {
          kind: "reference-wrap",
          id: vSListWrap,
          value: vSList2,
          start: 0,
          end: 0,
        },
        {
          kind: "call",
          id: vSNewVec,
          target: vecAcc,
          arguments: slowVecArgs,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: vecSlot, value: vSNewVec, start: 0, end: 0 },
        { kind: "load", id: vSList3, slot: listSlot, start: 0, end: 0 },
      ],
      terminator: {
        kind: "record",
        operation: "read",
        object: vSList3,
        record: header,
        field: 0,
        slot: lenRawSlot,
        consequent: slowCapCheckId,
        alternate: trapId,
        start: 0,
        end: 0,
      },
    });

    const vSRawLen = fresh(),
      vSUintLen = fresh(),
      vSCVec = fresh(),
      vSHasVec = fresh();
    candBlocks.push({
      id: slowCapCheckId,
      instructions: [
        { kind: "load", id: vSRawLen, slot: lenRawSlot, start: 0, end: 0 },
        {
          kind: "unary",
          id: vSUintLen,
          operator: "uint32",
          operand: vSRawLen,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: lenSlot, value: vSUintLen, start: 0, end: 0 },
        { kind: "load", id: vSCVec, slot: vecSlot, start: 0, end: 0 },
        {
          kind: "unary",
          id: vSHasVec,
          operator: "truthy",
          operand: vSCVec,
          start: 0,
          end: 0,
        },
      ],
      terminator: {
        kind: "branch",
        condition: vSHasVec,
        consequent: slowCapSomeId,
        alternate: slowCapZeroId,
        start: 0,
        end: 0,
      },
    });

    const vSCVecOpt = fresh(),
      vSCVecVal = fresh(),
      vSCCap = fresh(),
      vSCUintCap = fresh();
    candBlocks.push({
      id: slowCapSomeId,
      instructions: [
        { kind: "load", id: vSCVecOpt, slot: vecSlot, start: 0, end: 0 },
        {
          kind: "reference-value",
          id: vSCVecVal,
          value: vSCVecOpt,
          start: 0,
          end: 0,
        },
        {
          kind: "reference-vector-length",
          id: vSCCap,
          vector: vSCVecVal,
          start: 0,
          end: 0,
        },
        {
          kind: "unary",
          id: vSCUintCap,
          operator: "uint32",
          operand: vSCCap,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: capSlot, value: vSCUintCap, start: 0, end: 0 },
      ],
      terminator: { kind: "jump", target: afterId, start: 0, end: 0 },
    });

    const vSCZero = fresh();
    candBlocks.push({
      id: slowCapZeroId,
      instructions: [
        { kind: "constant", id: vSCZero, value: 0, start: 0, end: 0 },
        { kind: "store", slot: capSlot, value: vSCZero, start: 0, end: 0 },
      ],
      terminator: { kind: "jump", target: afterId, start: 0, end: 0 },
    });

    const afterInsts: Instruction[] = [];
    for (let i = pushIndex + 1; i < pushBlock.instructions.length; i++) {
      const op = pushBlock.instructions[i];
      if (op !== undefined) afterInsts.push(op);
    }
    candBlocks.push({
      id: afterId,
      instructions: afterInsts,
      terminator: retargetTerminator(pushBlock.terminator, (t) =>
        t === exitTarget ? wbId : t,
      ),
    });

    // Writeback block on loop exit: copy `lenSlot` to `lenWriteSlot` (so
    // `lenSlot` remains eligible as an integer slot!) and update `list.length`.
    const vWLen = fresh(),
      vWList = fresh();
    candBlocks.push({
      id: wbId,
      instructions: [
        { kind: "load", id: vWLen, slot: lenSlot, start: 0, end: 0 },
        { kind: "store", slot: lenWriteSlot, value: vWLen, start: 0, end: 0 },
        { kind: "load", id: vWList, slot: listSlot, start: 0, end: 0 },
      ],
      terminator: {
        kind: "record",
        operation: "write",
        object: vWList,
        record: header,
        field: 0,
        slot: lenWriteSlot,
        consequent: exitTarget,
        alternate: trapId,
        start: 0,
        end: 0,
      },
    });
    if (readTrapId < 0)
      candBlocks.push({
        id: trapId,
        instructions: [],
        terminator: { kind: "trap", start: 0, end: 0 },
      });

    // Retarget all other exits from `loop.body` to `wbId`.
    for (const id of loop.body) {
      if (id === pushBlockId) continue;
      const b = candBlocks[id];
      if (b === undefined) continue;
      const nt = retargetTerminator(b.terminator, (t) =>
        t === exitTarget ? wbId : t,
      );
      if (nt !== b.terminator) candBlocks[id] = { ...b, terminator: nt };
    }

    const debug =
      current.debug === undefined
        ? undefined
        : retainDebugValues(current, candBlocks);
    const candidate: FunctionIR =
      debug === undefined
        ? { ...current, slots: candSlots, blocks: candBlocks }
        : { ...current, slots: candSlots, blocks: candBlocks, debug };
    if (!recordReadsKept(current, candidate)) continue;
    current = candidate;
    cachedPredecessors = undefined;
    nextValue = candNextValue;
    rewritten++;
    for (const id of loop.body) touched.add(id);
    touched.add(preheaderId);
    if (preCap !== undefined) touched.add(freshBlockId);
  }

  return { fn: current, visited, rewritten };
}
