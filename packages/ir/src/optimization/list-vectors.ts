import {
  cachedListReadPrefix,
  instructionResult,
  naturalLoops,
  blockSuccessors,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type NaturalLoop,
  type ScalarType,
} from "../scalar/index.ts";

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

/** Dense list reads in loops that cannot replace any list's root read the
 * root's vector once, before the loop. Each such loop gets, per list slot, a
 * slot holding the list's root when that root is a reference vector (else
 * none), computed in a block chain ahead of the loop header; reads in the loop
 * become calls to a cached-read accessor taking that slot's value first. The
 * accessor's IR only calls the ordinary reader, so the IR meaning is
 * unchanged; codegen inlines it as a bounds-checked vector load, trusting that
 * the first argument is the list's current root vector or none.
 *
 * That holds because only bound list methods replace a root (header field
 * writes), and an eligible loop calls nothing but list read and has accessors
 * and writes no header field; the list slot is not written in the loop. The
 * vector slot is a collector root, so moving collections keep it current.
 * This runs after every inlining and code-motion pass. */
export function cacheListVectors(
  module: ModuleIR,
  budget: number,
): ListVectorCaching | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  // Finding the list accessors visits every function.
  let visited = module.functions.length;
  if (visited > budget) return undefined;
  const readers = new Map<number, number>(),
    headers = new Set<number>(),
    readOnly = new Set<number>();
  for (const fn of module.functions) {
    if (fn === undefined) throw "list vector function invariant";
    const header = readHeader(fn);
    if (header !== undefined) {
      readers.set(fn.id, header);
      headers.add(header);
      readOnly.add(fn.id);
    } else if (fn.name.startsWith("__tint_reference_list_has$"))
      readOnly.add(fn.id);
  }
  if (readers.size === 0) return { module, visited, rewritten: 0 };
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
    /** Nothing in the loop can replace a list root. */
    function eligible(loop: NaturalLoop): boolean {
      for (const id of loop.body) {
        const block = fn.blocks[id];
        if (block === undefined) return false;
        for (const op of block.instructions) {
          if (op === undefined) return false;
          if (op.kind === "call-indirect") return false;
          if (op.kind === "call" && !readOnly.has(op.target)) return false;
        }
        const term = block.terminator;
        if (
          (term.kind === "record" || term.kind === "record-cell") &&
          term.operation !== "read" &&
          headers.has(term.record)
        )
          return false;
      }
      return true;
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
    // Innermost eligible loop of each block.
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
    // Per loop: list slot -> cached vector slot and the list's header.
    const caches = new Map<
      NaturalLoop,
      Map<number, { readonly vector: number; readonly header: number }>
    >();
    const slots: ScalarType[] = fn.slots.slice();
    const replaced = new Map<number, Block>();
    let count = 0;
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      const loop = innermost.get(block.id);
      if (loop === undefined) continue;
      const known = verdicts.get(loop);
      if (known === undefined) {
        const verdict = eligible(loop) && preheader(loop) !== undefined;
        verdicts.set(loop, verdict);
        work += loop.body.size;
        if (!verdict) continue;
      } else if (!known) continue;
      let instructions: Instruction[] | undefined;
      for (let at = 0; at < block.instructions.length; at++) {
        const op = block.instructions[at];
        if (op === undefined) throw "list vector instruction invariant";
        work++;
        const header = op.kind === "call" ? readers.get(op.target) : undefined;
        const list = op.kind === "call" ? op.arguments[0] : undefined,
          index = op.kind === "call" ? op.arguments[1] : undefined,
          source = list === undefined ? undefined : definitions.get(list);
        if (
          op.kind !== "call" ||
          op.id === undefined ||
          header === undefined ||
          index === undefined ||
          list === undefined ||
          source === undefined ||
          source.kind !== "load" ||
          loop.writes.has(source.slot) ||
          fn.slots[source.slot] !== "reference"
        ) {
          if (instructions !== undefined) instructions.push(op);
          continue;
        }
        const existing = caches.get(loop),
          vectors =
            existing ??
            new Map<
              number,
              { readonly vector: number; readonly header: number }
            >();
        if (existing === undefined) caches.set(loop, vectors);
        const known = vectors.get(source.slot);
        const vector = known === undefined ? slots.length : known.vector;
        if (known === undefined) {
          slots.push("optional-reference");
          vectors.set(source.slot, { vector, header });
        }
        if (instructions === undefined)
          instructions = block.instructions.slice(0, at);
        const value = nextValue++;
        instructions.push({ kind: "load", id: value, slot: vector, ...span });
        const cachedArguments: number[] = [value, list, index];
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
    // Chains ahead of each loop header: per cached list, read the root and
    // keep it when it is a reference vector.
    const added: Block[] = [];
    for (const [loop, vectors] of caches) {
      const entry = preheader(loop);
      if (entry === undefined) throw "list vector preheader invariant";
      let target = loop.header;
      for (const [list, cache] of vectors) {
        const vector = cache.vector,
          headerRecord = cache.header,
          header = slots.length;
        slots.push("optional-reference");
        const read = nextBlock++,
          test = nextBlock++,
          keep = nextBlock++,
          none = nextBlock++,
          join = nextBlock++;
        const object = nextValue++,
          root = nextValue++,
          is = nextValue++,
          kept = nextValue++,
          absent = nextValue++;
        added.push(
          {
            id: read,
            instructions: [{ kind: "load", id: object, slot: list, ...span }],
            terminator: {
              kind: "record",
              object,
              record: headerRecord,
              field: 1,
              operation: "read",
              slot: header,
              consequent: test,
              alternate: none,
              ...span,
            },
          },
          {
            id: test,
            instructions: [
              { kind: "load", id: root, slot: header, ...span },
              { kind: "reference-vector-is", id: is, vector: root, ...span },
            ],
            terminator: {
              kind: "branch",
              condition: is,
              consequent: keep,
              alternate: none,
              ...span,
            },
          },
          {
            id: keep,
            instructions: [
              { kind: "load", id: kept, slot: header, ...span },
              { kind: "store", slot: vector, value: kept, ...span },
            ],
            terminator: { kind: "jump", target: join, ...span },
          },
          {
            id: none,
            instructions: [
              { kind: "reference-none", id: absent, ...span },
              { kind: "store", slot: vector, value: absent, ...span },
            ],
            terminator: { kind: "jump", target: join, ...span },
          },
          {
            id: join,
            instructions: [],
            terminator: { kind: "jump", target, ...span },
          },
        );
        target = read;
      }
      const original = replaced.get(entry.id) ?? entry;
      replaced.set(entry.id, {
        ...original,
        terminator: { kind: "jump", target, ...span },
      });
    }
    const blocks: Block[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "list vector block invariant";
      blocks.push(replaced.get(block.id) ?? block);
    }
    added.sort((a, b) => a.id - b.id);
    for (const block of added) {
      if (block === undefined) throw "list vector block invariant";
      blocks.push(block);
    }
    return { fn: { ...fn, slots, blocks }, visited: work, rewritten: count };
  }
  return { module: { ...module, functions }, visited, rewritten };
}
