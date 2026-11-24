import {
  cachedListReadPrefix,
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
  retainDebugValues,
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
    fn.returnType !== "optional-reference" ||
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
    headers = new Map<number, number>(),
    readOnly = new Set<number>();
  for (const fn of module.functions) {
    if (fn === undefined) throw "list vector function invariant";
    const header = readHeader(fn);
    if (header !== undefined) {
      readers.set(fn.id, header);
      if (!headers.has(header)) headers.set(header, headers.size);
      readOnly.add(fn.id);
    } else if (fn.name.startsWith("__tint_reference_list_has$"))
      readOnly.add(fn.id);
  }
  if (readers.size === 0) return { module, visited, rewritten: 0 };
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
  const cached = new Map<number, number>();
  function cachedReader(reader: number): number {
    const existing = cached.get(reader);
    if (existing !== undefined) return existing;
    const id = functions.length,
      readArguments: number[] = [0, 1];
    functions.push({
      id,
      name: cachedListReadPrefix + String(id),
      exported: false,
      parameters: [0, 1, 2],
      slots: ["optional-reference", "reference", "number"],
      returnType: "optional-reference",
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
    readOnly.add(id);
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
  let rewritten = 0;
  for (let index = 0; index < module.functions.length; index++) {
    const fn = module.functions[index];
    if (fn === undefined) throw "list vector function invariant";
    if (fn.import === true || readOnly.has(fn.id)) continue;
    let reads = 0;
    for (const block of fn.blocks)
      for (const op of block?.instructions ?? [])
        if (op !== undefined && op.kind === "call" && readers.has(op.target))
          reads++;
    visited += fn.blocks.length;
    if (reads === 0) continue;
    if (visited > budget) return undefined;
    const result = rewriteFunction(fn, budget - visited);
    if (result === undefined) return undefined;
    visited += result.visited;
    if (result.rewritten === 0) continue;
    rewritten += result.rewritten;
    functions[index] = result.fn;
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
        const read = cacheableRead(op, loop);
        let vectors = caches.get(loop);
        const known = read === undefined ? undefined : vectors?.get(read.slot);
        if (
          op.kind !== "call" ||
          read === undefined ||
          (known === undefined &&
            !profitable(
              loop,
              headers.get(read.header) ?? -1,
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
          caches.set(loop, vectors);
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
      // the fresh preheader as a dedicated word-typed bound slot.
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
      const candidate: FunctionIR =
        debug === undefined
          ? { ...currentFn, slots: candSlots, blocks: candBlocks }
          : { ...currentFn, slots: candSlots, blocks: candBlocks, debug };
      if (recordReadsKept(currentFn, candidate)) {
        currentFn = candidate;
        nextValue = candNextValue;
        count++;
      }
    }
    return { fn: currentFn, visited: work, rewritten: count };
  }
  return { module: { ...module, functions }, visited, rewritten };
}
