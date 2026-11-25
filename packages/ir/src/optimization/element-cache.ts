import {
  blockSuccessors,
  dominates,
  immediateDominators,
  instructionResult,
  naturalLoops,
  type Block,
  type Dominators,
  type FunctionIR,
  type Instruction,
  type NaturalLoop,
  type ScalarType,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

export interface ElementStorageCaching {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
}

/** Cap cached arrays per loop so storage/count slots stay in callee-saved registers. */
const maxCachedArraysPerLoop = 4;

interface CachedArray {
  readonly objectSlot: number;
  readonly record: number;
  readonly field: number;
  readonly elementsRecord: number;
  readonly countField: number;
  readonly storageField: number;
  readonly storageSlot: number;
  readonly countSlot: number;
}

interface LoopInfo {
  readonly preheader: Block;
  readonly invalidatingOps: ReadonlySet<Instruction>;
  readonly invalidatingTerminators: ReadonlySet<number>;
  readonly writtenSlots: ReadonlySet<number>;
}

function cacheKey(
  objectSlot: number,
  record: number,
  field: number,
  elementsRecord: number,
  countField: number,
  storageField: number,
): string {
  return (
    String(objectSlot) +
    ":" +
    String(record) +
    ":" +
    String(field) +
    ":" +
    String(elementsRecord) +
    ":" +
    String(countField) +
    ":" +
    String(storageField)
  );
}

/** Whether an instruction inside a loop may mutate an array's elements storage
 * or packed number count (reallocating, shrinking, freezing, or unpacking).
 * `element-load` only reads, and `element-store` only overwrites an existing
 * in-bounds binary64 slot in place without changing storage or count. */
function mayInvalidateElements(op: Instruction): boolean {
  return (
    op.kind === "call" ||
    op.kind === "call-indirect" ||
    op.kind === "host-call" ||
    op.kind === "property-store" ||
    (op.kind === "c-call" && op.call.mayCallback === true)
  );
}

/**
 * Caches packed binary64 array storage (`Float64Array` + `numberCount`) in the
 * preheader of natural loops for loop-invariant `general` array slots used by
 * `element-load` / `element-store`.
 *
 * Inside the loop, every access reads the cached `(storageSlot, countSlot)`
 * directly instead of re-checking the object tag, record descriptor, elements
 * pointer, count field, and storage pointer on every element access.
 *
 * Any cold call, property store, or record write inside the loop invalidates
 * `countSlot = 0` immediately after itself so the next access misses safely
 * onto the general fallback path if the array was resized, unpacked, or frozen.
 * Loops where an invalidating site runs on every iteration, or that contain
 * internal exception handlers, are left alone.
 */
export function cacheElementStorage(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): ElementStorageCaching | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  if (fn.import === true || fn.blocks.length === 0)
    return { fn, visited: 0, rewritten: 0 };
  let visited = 0,
    elementAccesses = 0,
    nextValue = 0,
    nextBlock = fn.blocks.length;
  for (const block of fn.blocks) {
    if (block === undefined) throw "element cache block invariant";
    if (block.id >= nextBlock) nextBlock = block.id + 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "element cache instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
      if (
        (op.kind === "element-load" || op.kind === "element-store") &&
        op.cachedStorage === undefined
      )
        elementAccesses++;
    }
  }
  if (elementAccesses === 0) return { fn, visited, rewritten: 0 };

  const forest = naturalLoops(fn, Math.max(1, budget - visited));
  if (forest === undefined) return undefined;
  visited += forest.visited;
  if (forest.loops.length === 0) return { fn, visited, rewritten: 0 };

  const predecessors = new Map<number, number[]>();
  const definitions = new Map<number, Instruction>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "element cache block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "element cache instruction invariant";
      visited++;
      const id = instructionResult(op);
      if (id !== undefined) definitions.set(id, op);
    }
    for (const target of blockSuccessors(block)) {
      if (target === undefined) throw "element cache successor invariant";
      let list = predecessors.get(target);
      if (list === undefined) {
        list = [];
        predecessors.set(target, list);
      }
      list.push(block.id);
    }
  }
  if (visited > budget) return undefined;

  // Innermost loop for each block.
  const innermost = new Map<number, NaturalLoop>();
  for (const loop of forest.loops) {
    if (loop === undefined) throw "element cache loop invariant";
    for (const id of loop.body) {
      const current = innermost.get(id);
      if (current === undefined || loop.body.size < current.body.size)
        innermost.set(id, loop);
    }
  }

  let dominators: Dominators | undefined;
  function everyIteration(
    loop: NaturalLoop,
    block: number,
  ): boolean | undefined {
    if (dominators === undefined) {
      dominators = immediateDominators(fn, Math.max(1, budget - visited));
      if (dominators === undefined) return undefined;
      visited += dominators.visited;
    }
    const tree = dominators;
    visited += loop.latches.length;
    for (const latch of loop.latches)
      if (!dominates(tree, fn.entry, block, latch)) return false;
    return true;
  }

  function preheader(loop: NaturalLoop): Block | undefined {
    const outside: number[] = [];
    for (const id of predecessors.get(loop.header) ?? [])
      if (!loop.body.has(id)) outside.push(id);
    const id = outside[0];
    if (outside.length !== 1 || id === undefined) return undefined;
    const block = fn.blocks[id];
    return block !== undefined &&
      block.terminator.kind === "jump" &&
      block.exception === undefined
      ? block
      : undefined;
  }

  const loopInfo = new Map<NaturalLoop, LoopInfo | undefined>();
  function inspectLoop(loop: NaturalLoop): LoopInfo | undefined {
    if (loopInfo.has(loop)) return loopInfo.get(loop);
    const entry = preheader(loop);
    if (entry === undefined) {
      loopInfo.set(loop, undefined);
      return undefined;
    }
    const invalidatingOps = new Set<Instruction>();
    const invalidatingTerminators = new Set<number>();
    const writtenSlots = new Set<number>(loop.writes);
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) {
        loopInfo.set(loop, undefined);
        return undefined;
      }
      // Reject irreducible loops (entries into non-header blocks).
      if (id !== loop.header) {
        for (const from of predecessors.get(id) ?? []) {
          if (!loop.body.has(from)) {
            loopInfo.set(loop, undefined);
            return undefined;
          }
        }
      }
      // Reject loops with an internal exception handler (a throwing call
      // would skip the post-call invalidation).
      if (block.exception !== undefined) {
        if (loop.body.has(block.exception.target)) {
          loopInfo.set(loop, undefined);
          return undefined;
        }
      }
      const term = block.terminator;
      if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      ) {
        if (term.operation === "read") writtenSlots.add(term.slot);
        else {
          if (everyIteration(loop, id) !== false) {
            loopInfo.set(loop, undefined);
            return undefined;
          }
          invalidatingTerminators.add(id);
        }
      }
      for (const op of block.instructions) {
        if (op === undefined) throw "element cache instruction invariant";
        visited++;
        if (mayInvalidateElements(op)) {
          if (everyIteration(loop, id) !== false) {
            loopInfo.set(loop, undefined);
            return undefined;
          }
          invalidatingOps.add(op);
        }
      }
    }
    const info: LoopInfo = {
      preheader: entry,
      invalidatingOps,
      invalidatingTerminators,
      writtenSlots,
    };
    loopInfo.set(loop, info);
    return info;
  }

  // Count cacheable accesses per loop and key to pick the hottest arrays first.
  const loopCounts = new Map<NaturalLoop, Map<string, number>>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "element cache block invariant";
    const loop = innermost.get(block.id);
    if (loop === undefined) continue;
    const info = inspectLoop(loop);
    if (info === undefined) continue;
    for (const op of block.instructions) {
      if (op === undefined) throw "element cache instruction invariant";
      if (
        (op.kind !== "element-load" && op.kind !== "element-store") ||
        op.cachedStorage !== undefined
      )
        continue;
      const source = definitions.get(op.object);
      if (
        source === undefined ||
        source.kind !== "load" ||
        fn.slots[source.slot] !== "general" ||
        info.writtenSlots.has(source.slot)
      )
        continue;
      const key = cacheKey(
        source.slot,
        op.record,
        op.field,
        op.elementsRecord,
        op.countField,
        op.storageField,
      );
      let counts = loopCounts.get(loop);
      if (counts === undefined) {
        counts = new Map<string, number>();
        loopCounts.set(loop, counts);
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (loopCounts.size === 0) return { fn, visited, rewritten: 0 };

  // Select up to maxCachedArraysPerLoop per loop (sorted by access count desc).
  const selected = new Map<NaturalLoop, Map<string, CachedArray>>();
  const slots: ScalarType[] = fn.slots.slice();
  for (const [loop, counts] of loopCounts) {
    const entries: { readonly key: string; readonly count: number }[] = [];
    for (const [key, count] of counts) entries.push({ key, count });
    entries.sort((a, b) => b.count - a.count);
    const limit = Math.min(entries.length, maxCachedArraysPerLoop);
    const chosen = new Set<string>();
    for (let i = 0; i < limit; i++) {
      const entry = entries[i];
      if (entry !== undefined) chosen.add(entry.key);
    }
    const map = new Map<string, CachedArray>();
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) continue;
      for (const op of block.instructions) {
        if (
          op === undefined ||
          (op.kind !== "element-load" && op.kind !== "element-store") ||
          op.cachedStorage !== undefined
        )
          continue;
        const source = definitions.get(op.object);
        if (source === undefined || source.kind !== "load") continue;
        const key = cacheKey(
          source.slot,
          op.record,
          op.field,
          op.elementsRecord,
          op.countField,
          op.storageField,
        );
        if (!chosen.has(key) || map.has(key)) continue;
        const storageSlot = slots.length;
        slots.push("optional-reference");
        const countSlot = slots.length;
        slots.push("number");
        map.set(key, {
          objectSlot: source.slot,
          record: op.record,
          field: op.field,
          elementsRecord: op.elementsRecord,
          countField: op.countField,
          storageField: op.storageField,
          storageSlot,
          countSlot,
        });
      }
    }
    if (map.size > 0) selected.set(loop, map);
  }
  if (selected.size === 0) return { fn, visited, rewritten: 0 };

  // Rewrite matching element-load / element-store instructions.
  const replaced = new Map<number, Block>();
  let rewritten = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "element cache block invariant";
    const loop = innermost.get(block.id);
    const caches = loop === undefined ? undefined : selected.get(loop);
    if (caches === undefined) continue;
    let instructions: Instruction[] | undefined;
    for (let at = 0; at < block.instructions.length; at++) {
      const op = block.instructions[at];
      if (op === undefined) throw "element cache instruction invariant";
      if (
        (op.kind === "element-load" || op.kind === "element-store") &&
        op.cachedStorage === undefined
      ) {
        const source = definitions.get(op.object);
        if (source !== undefined && source.kind === "load") {
          const cache = caches.get(
            cacheKey(
              source.slot,
              op.record,
              op.field,
              op.elementsRecord,
              op.countField,
              op.storageField,
            ),
          );
          if (cache !== undefined) {
            if (instructions === undefined)
              instructions = block.instructions.slice(0, at);
            const storageId = nextValue++,
              countId = nextValue++;
            instructions.push(
              {
                kind: "load",
                id: storageId,
                slot: cache.storageSlot,
                start: op.start,
                end: op.end,
              },
              {
                kind: "load",
                id: countId,
                slot: cache.countSlot,
                start: op.start,
                end: op.end,
              },
              op.kind === "element-load"
                ? {
                    kind: "element-load",
                    id: op.id,
                    object: op.object,
                    index: op.index,
                    record: op.record,
                    field: op.field,
                    elementsRecord: op.elementsRecord,
                    countField: op.countField,
                    storageField: op.storageField,
                    cachedStorage: storageId,
                    cachedCount: countId,
                    start: op.start,
                    end: op.end,
                  }
                : {
                    kind: "element-store",
                    id: op.id,
                    object: op.object,
                    index: op.index,
                    value: op.value,
                    record: op.record,
                    field: op.field,
                    elementsRecord: op.elementsRecord,
                    countField: op.countField,
                    storageField: op.storageField,
                    cachedStorage: storageId,
                    cachedCount: countId,
                    start: op.start,
                    end: op.end,
                  },
            );
            rewritten++;
            continue;
          }
        }
      }
      if (instructions !== undefined) instructions.push(op);
    }
    if (instructions !== undefined)
      replaced.set(block.id, { ...block, instructions });
  }
  if (rewritten === 0) return { fn, visited, rewritten: 0 };

  // Invalidate countSlot = 0 after every cold invalidation site inside a
  // cached loop, and populate (storageSlot, countSlot) in each loop preheader.
  const opInvalidations = new Map<Instruction, CachedArray[]>();
  const termInvalidations = new Map<number, CachedArray[]>();
  for (const [loop, caches] of selected) {
    const info = loopInfo.get(loop);
    if (info === undefined) continue;
    const list: CachedArray[] = [];
    for (const [key, cache] of caches) {
      if (key === "") throw "element cache key invariant";
      list.push(cache);
    }
    for (const op of info.invalidatingOps) {
      let existing = opInvalidations.get(op);
      if (existing === undefined) {
        existing = [];
        opInvalidations.set(op, existing);
      }
      const targetList = existing;
      for (const cache of list) targetList.push(cache);
    }
    for (const blockId of info.invalidatingTerminators) {
      let existing = termInvalidations.get(blockId);
      if (existing === undefined) {
        existing = [];
        termInvalidations.set(blockId, existing);
      }
      const targetList = existing;
      for (const cache of list) targetList.push(cache);
    }
  }

  function emitInvalidations(
    caches: readonly CachedArray[],
    into: Instruction[],
  ): void {
    const zero = nextValue++;
    into.push({ kind: "constant", id: zero, value: 0, start: 0, end: 0 });
    for (const cache of caches) {
      if (cache === undefined) throw "element cache invalidation invariant";
      into.push({
        kind: "store",
        slot: cache.countSlot,
        value: zero,
        start: 0,
        end: 0,
      });
    }
  }

  for (const block of fn.blocks) {
    if (block === undefined) throw "element cache block invariant";
    const current = replaced.get(block.id) ?? block;
    let instructions: Instruction[] | undefined;
    for (let at = 0; at < current.instructions.length; at++) {
      const op = current.instructions[at];
      if (op === undefined) throw "element cache instruction invariant";
      const caches = opInvalidations.get(op);
      if (caches === undefined) {
        if (instructions !== undefined) instructions.push(op);
        continue;
      }
      if (instructions === undefined)
        instructions = current.instructions.slice(0, at);
      instructions.push(op);
      emitInvalidations(caches, instructions);
    }
    if (instructions !== undefined)
      replaced.set(block.id, { ...current, instructions });
  }

  const added: Block[] = [];
  function invalidateEdge(
    caches: readonly CachedArray[],
    target: number,
  ): number {
    const id = nextBlock++,
      instructions: Instruction[] = [];
    emitInvalidations(caches, instructions);
    added.push({
      id,
      instructions,
      terminator: { kind: "jump", target, start: 0, end: 0 },
    });
    return id;
  }

  for (const [blockId, caches] of termInvalidations) {
    const block = replaced.get(blockId) ?? fn.blocks[blockId];
    if (block === undefined) throw "element cache terminator invariant";
    const term = block.terminator;
    if (
      term.kind !== "record" &&
      term.kind !== "record-cell" &&
      term.kind !== "cell"
    )
      throw "element cache terminator kind invariant";
    replaced.set(blockId, {
      ...block,
      terminator: {
        ...term,
        consequent: invalidateEdge(caches, term.consequent),
        alternate: invalidateEdge(caches, term.alternate),
      },
    });
  }

  // Populate caches at the end of each loop preheader.
  for (const [loop, caches] of selected) {
    const info = loopInfo.get(loop);
    if (info === undefined) continue;
    const entry = replaced.get(info.preheader.id) ?? info.preheader;
    const instructions = entry.instructions.slice();
    for (const [key, cache] of caches) {
      if (key === "") throw "element cache key invariant";
      const obj = nextValue++,
        storage = nextValue++,
        count = nextValue++;
      instructions.push(
        { kind: "load", id: obj, slot: cache.objectSlot, start: 0, end: 0 },
        {
          kind: "element-storage",
          id: storage,
          object: obj,
          record: cache.record,
          field: cache.field,
          elementsRecord: cache.elementsRecord,
          countField: cache.countField,
          storageField: cache.storageField,
          start: 0,
          end: 0,
        },
        {
          kind: "store",
          slot: cache.storageSlot,
          value: storage,
          start: 0,
          end: 0,
        },
        {
          kind: "element-count",
          id: count,
          object: obj,
          record: cache.record,
          field: cache.field,
          elementsRecord: cache.elementsRecord,
          countField: cache.countField,
          storageField: cache.storageField,
          start: 0,
          end: 0,
        },
        {
          kind: "store",
          slot: cache.countSlot,
          value: count,
          start: 0,
          end: 0,
        },
      );
    }
    replaced.set(entry.id, { ...entry, instructions });
  }

  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "element cache block invariant";
    blocks.push(replaced.get(block.id) ?? block);
  }
  for (const block of added) {
    if (block === undefined) throw "element cache added block invariant";
    blocks.push(block);
  }
  const first = fn.blocks[fn.entry];
  remarks?.({
    pass: "cache-element-storage",
    outcome: "applied",
    function: fn.name,
    start: first?.terminator.start ?? 0,
    end: first?.terminator.end ?? 0,
    message: String(rewritten) + " loop element accesses cached",
  });
  return { fn: { ...fn, slots, blocks }, visited, rewritten };
}
