import {
  blockSuccessors,
  immediateDominators,
  instructionResult,
  naturalLoops,
  retainDebugValues,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

export interface EnvironmentLoadSinking {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly sunk: number;
}

interface RecordReadInfo {
  readonly index: number;
  readonly record: number;
  readonly field: number;
  readonly start: number;
  readonly end: number;
  readonly inline?: number | undefined;
}

interface Candidate {
  readonly blockId: number;
  readonly slot: number;
  readonly readIndex: number;
  readonly storeIndex: number;
  readonly record: number;
  readonly field: number;
  readonly readStart: number;
  readonly readEnd: number;
  readonly readInline?: number | undefined;
  readonly storeStart: number;
  readonly storeEnd: number;
  readonly storeInline?: number | undefined;
}

/** Sink immutable `closure-environment` field reads out of the function's
 * unconditional entry prefix (`b0 -> b1 -> ...`) into the lowest common
 * dominator of the blocks that load their slots, staying outside natural
 * loops and exception-leaving merge blocks. Cold captures (for example
 * IC-miss helpers in small script callees) then stop executing on the hot
 * path and stop occupying callee-saved registers across it. */
export function sinkEnvironmentLoads(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
): EnvironmentLoadSinking | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  if (
    fn.import === true ||
    fn.exported ||
    fn.closureEnvironment === undefined ||
    fn.blocks.length <= 1
  )
    return { fn, visited: 1, sunk: 0 };
  const recordLayout = module.records?.[fn.closureEnvironment];
  if (recordLayout === undefined) return { fn, visited: 1, sunk: 0 };
  const entry = fn.blocks[fn.entry];
  if (entry === undefined) throw "sink environment entry invariant";
  const slotCount = fn.slots.length,
    blockCount = fn.blocks.length;
  let visited = slotCount + blockCount;
  if (visited > budget) return undefined;

  // Count slot writes, collect reading blocks, and count CFG predecessors.
  const disqualified = new Uint8Array(slotCount),
    writeCount = new Uint32Array(slotCount),
    lastReadBlock = new Uint32Array(slotCount),
    predCount = new Uint32Array(blockCount),
    readBlocks: number[][] = [];
  for (let s = 0; s < slotCount; s++) readBlocks.push([]);
  for (const parameter of fn.parameters)
    if (parameter !== undefined) disqualified[parameter] = 1;
  if (fn.receiverSlot !== undefined) disqualified[fn.receiverSlot] = 1;

  let maxValueId = -1;
  for (const block of fn.blocks) {
    if (block === undefined) throw "sink environment block invariant";
    for (const successor of blockSuccessors(block)) {
      if (successor !== undefined)
        predCount[successor] = (predCount[successor] ?? 0) + 1;
    }
    if (block.exception !== undefined) disqualified[block.exception.slot] = 1;
    const term = block.terminator;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    )
      disqualified[term.slot] = 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "sink environment instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id > maxValueId) maxValueId = id;
      if (op.kind === "store")
        writeCount[op.slot] = (writeCount[op.slot] ?? 0) + 1;
      else if (op.kind === "load") {
        if (lastReadBlock[op.slot] !== block.id + 1) {
          lastReadBlock[op.slot] = block.id + 1;
          readBlocks[op.slot]?.push(block.id);
        }
      }
    }
  }

  // Collect the unconditional straight-line entry prefix (`b0 -> b1 -> ...`).
  // Lowered proven record reads leave sequential `jump` blocks that execute
  // unconditionally before the first branch.
  const prefixBlocks: number[] = [fn.entry],
    prefixSet = new Set<number>();
  prefixSet.add(fn.entry);
  let cursorBlock = entry;
  while (cursorBlock.exception === undefined) {
    const term = cursorBlock.terminator;
    if (term.kind !== "jump") break;
    const nextId = term.target;
    if (prefixSet.has(nextId) || (predCount[nextId] ?? 0) !== 1) break;
    const nextBlock = fn.blocks[nextId];
    if (nextBlock === undefined) break;
    prefixBlocks.push(nextId);
    prefixSet.add(nextId);
    cursorBlock = nextBlock;
  }

  // Identify `closure-environment` values, env pointer slots, and immutable
  // `record-read` -> single-def `store` pairs across the entry prefix.
  const envSlots = new Set<number>(),
    envSlotStoreLoc = new Map<
      number,
      { readonly blockId: number; readonly index: number }
    >(),
    candidates: Candidate[] = [],
    deadReads: { readonly blockId: number; readonly index: number }[] = [];

  for (const blockId of prefixBlocks) {
    if (blockId === undefined) continue;
    const block = fn.blocks[blockId];
    if (block === undefined) throw "sink environment prefix block invariant";
    const blockUses = new Map<number, number>();
    const countUse = (id: number): void => {
      blockUses.set(id, (blockUses.get(id) ?? 0) + 1);
    };
    for (const op of block.instructions) {
      if (op === undefined)
        throw "sink environment prefix instruction invariant";
      visitInstructionOperands(op, countUse);
    }
    visitTerminatorOperands(block.terminator, countUse);

    const envValues = new Set<number>(),
      envReads = new Map<number, RecordReadInfo>();
    for (let index = 0; index < block.instructions.length; index++) {
      const op = block.instructions[index];
      if (op === undefined)
        throw "sink environment prefix instruction invariant";
      if (op.kind === "closure-environment") {
        envValues.add(op.id);
        continue;
      }
      if (op.kind === "store" && envValues.has(op.value)) {
        if (writeCount[op.slot] === 1 && disqualified[op.slot] === 0) {
          envSlots.add(op.slot);
          envSlotStoreLoc.set(op.slot, { blockId, index });
        }
        continue;
      }
      if (op.kind === "load" && envSlots.has(op.slot)) {
        envValues.add(op.id);
        continue;
      }
      if (
        op.kind === "record-read" &&
        op.record === fn.closureEnvironment &&
        envValues.has(op.object)
      ) {
        const field = recordLayout.fields[op.field];
        if (
          field !== undefined &&
          !field.mutable &&
          field.stateOffset === undefined &&
          field.presenceOffset === undefined
        ) {
          if ((blockUses.get(op.id) ?? 0) === 0)
            deadReads.push({ blockId, index });
          else
            envReads.set(op.id, {
              index,
              record: op.record,
              field: op.field,
              start: op.start,
              end: op.end,
              inline: op.inline,
            });
        }
        continue;
      }
      if (op.kind === "store") {
        const read = envReads.get(op.value);
        if (
          read !== undefined &&
          writeCount[op.slot] === 1 &&
          disqualified[op.slot] === 0 &&
          (blockUses.get(op.value) ?? 0) === 1
        ) {
          candidates.push({
            blockId,
            slot: op.slot,
            readIndex: read.index,
            storeIndex: index,
            record: read.record,
            field: read.field,
            readStart: read.start,
            readEnd: read.end,
            readInline: read.inline,
            storeStart: op.start,
            storeEnd: op.end,
            storeInline: op.inline,
          });
        }
      }
    }
  }

  if (candidates.length === 0 && deadReads.length === 0)
    return { fn, visited, sunk: 0 };

  const removeByBlock: (Uint8Array | undefined)[] = [];
  for (let b = 0; b < blockCount; b++) removeByBlock.push(undefined);
  function removeMask(blockId: number): Uint8Array {
    let mask = removeByBlock[blockId];
    if (mask === undefined) {
      const block = fn.blocks[blockId];
      if (block === undefined) throw "sink environment mask invariant";
      mask = new Uint8Array(block.instructions.length);
      removeByBlock[blockId] = mask;
    }
    return mask;
  }

  let sunk = 0;
  for (const dead of deadReads) {
    if (dead === undefined) continue;
    removeMask(dead.blockId)[dead.index] = 1;
    sunk++;
  }
  const toCheck: Candidate[] = [];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const uses = readBlocks[candidate.slot];
    if (uses === undefined || uses.length === 0) {
      const mask = removeMask(candidate.blockId);
      mask[candidate.readIndex] = 1;
      mask[candidate.storeIndex] = 1;
      sunk++;
      continue;
    }
    let usedInPrefix = false;
    for (const blockId of uses) {
      if (blockId !== undefined && prefixSet.has(blockId)) {
        usedInPrefix = true;
        break;
      }
    }
    if (!usedInPrefix) toCheck.push(candidate);
  }

  const perTarget = new Map<number, Candidate[]>();
  if (toCheck.length > 0) {
    const dominators = immediateDominators(fn, budget - visited);
    if (dominators === undefined) return undefined;
    visited += dominators.visited;
    const forest = naturalLoops(fn, budget - visited);
    if (forest === undefined) return undefined;
    visited += forest.visited;

    const inLoop = new Uint8Array(blockCount);
    for (const loop of forest.loops) {
      if (loop === undefined) continue;
      for (const id of loop.body) inLoop[id] = 1;
    }

    const ancestorStamp = new Uint32Array(blockCount);
    let stamp = 0;
    function lca(a: number, b: number): number {
      stamp++;
      let cursor = a;
      for (let steps = 0; steps <= blockCount; steps++) {
        ancestorStamp[cursor] = stamp;
        if (cursor === fn.entry) break;
        const parent = (dominators?.idom[cursor] ?? 0) - 1;
        if (parent < 0 || parent === cursor) break;
        cursor = parent;
      }
      cursor = b;
      for (let steps = 0; steps <= blockCount; steps++) {
        if (ancestorStamp[cursor] === stamp) return cursor;
        if (cursor === fn.entry) return fn.entry;
        const parent = (dominators?.idom[cursor] ?? 0) - 1;
        if (parent < 0 || parent === cursor) return fn.entry;
        cursor = parent;
      }
      return fn.entry;
    }

    function isFusableMissTestBlock(block: Block, blockId: number): boolean {
      const term = block.terminator;
      if (
        (predCount[blockId] ?? 0) !== 1 ||
        block.exception !== undefined ||
        term.kind !== "branch" ||
        term.consequent === term.alternate
      )
        return false;
      const last = block.instructions[block.instructions.length - 1];
      return (
        last !== undefined &&
        last.kind === "general-is" &&
        last.type === "absent" &&
        last.id === term.condition
      );
    }

    for (const candidate of toCheck) {
      if (candidate === undefined) continue;
      const uses = readBlocks[candidate.slot];
      if (uses === undefined || uses.length === 0) continue;
      let reachable = true;
      let target = uses[0] ?? fn.entry;
      if ((dominators.idom[target] ?? 0) === 0) reachable = false;
      for (let i = 1; reachable && i < uses.length; i++) {
        const blockId = uses[i];
        if (blockId === undefined || (dominators.idom[blockId] ?? 0) === 0) {
          reachable = false;
          break;
        }
        target = lca(target, blockId);
        if (prefixSet.has(target)) break;
      }
      if (!reachable || prefixSet.has(target)) continue;
      // Keep loads outside natural loops, out of blocks whose exception
      // edge could bypass the prepended store on a path to another use block,
      // and out of single-predecessor `general-is absent` miss-test blocks so
      // `property-load`/`element-load` fusion stays intact.
      while (!prefixSet.has(target)) {
        const targetBlock = fn.blocks[target];
        if (targetBlock === undefined) {
          target = fn.entry;
          break;
        }
        const unsafeException =
          targetBlock.exception !== undefined &&
          (uses.length > 1 || uses[0] !== target);
        if (
          inLoop[target] !== 1 &&
          !unsafeException &&
          !isFusableMissTestBlock(targetBlock, target)
        )
          break;
        const parent = (dominators.idom[target] ?? 0) - 1;
        if (parent < 0 || parent === target) {
          target = fn.entry;
          break;
        }
        target = parent;
      }
      if (prefixSet.has(target)) continue;
      const mask = removeMask(candidate.blockId);
      mask[candidate.readIndex] = 1;
      mask[candidate.storeIndex] = 1;
      let list = perTarget.get(target);
      if (list === undefined) {
        list = [];
        perTarget.set(target, list);
      }
      list.push(candidate);
      sunk++;
      if (remarks !== undefined)
        remarks({
          pass: "sink-environment-loads",
          outcome: "applied",
          function: fn.name,
          start: candidate.readStart,
          end: candidate.readEnd,
          message:
            "sunk closure environment field f" +
            String(candidate.field) +
            " to b" +
            String(target),
        });
    }
  }

  if (sunk === 0) return { fn, visited, sunk: 0 };

  // Drop now-unused prefix `load(envSlot)`, `store(envSlot)`, and
  // `closure-environment` instructions (walking backward through the prefix).
  for (let p = prefixBlocks.length - 1; p >= 0; p--) {
    const blockId = prefixBlocks[p];
    if (blockId === undefined) continue;
    const block = fn.blocks[blockId];
    if (block === undefined) continue;
    const mask = removeMask(blockId);
    const remainingUses = new Map<number, number>();
    const addRemainingUse = (id: number): void => {
      remainingUses.set(id, (remainingUses.get(id) ?? 0) + 1);
    };
    for (let i = 0; i < block.instructions.length; i++) {
      if (mask[i] === 1) continue;
      const op = block.instructions[i];
      if (op !== undefined) visitInstructionOperands(op, addRemainingUse);
    }
    visitTerminatorOperands(block.terminator, addRemainingUse);

    for (let i = block.instructions.length - 1; i >= 0; i--) {
      if (mask[i] === 1) continue;
      const op = block.instructions[i];
      if (op === undefined) continue;
      if (
        op.kind === "load" &&
        envSlots.has(op.slot) &&
        (remainingUses.get(op.id) ?? 0) === 0
      ) {
        mask[i] = 1;
        continue;
      }
      if (op.kind === "store") {
        const loc = envSlotStoreLoc.get(op.slot);
        if (loc !== undefined && loc.blockId === blockId && loc.index === i) {
          let usedOutsidePrefix = false;
          for (const b of readBlocks[op.slot] ?? []) {
            if (b !== undefined && !prefixSet.has(b)) {
              usedOutsidePrefix = true;
              break;
            }
          }
          if (!usedOutsidePrefix) {
            let usedInPrefix = false;
            for (const otherBlockId of prefixBlocks) {
              if (otherBlockId === undefined) continue;
              const otherBlock = fn.blocks[otherBlockId];
              if (otherBlock === undefined) continue;
              const otherMask = removeByBlock[otherBlockId];
              for (let j = 0; j < otherBlock.instructions.length; j++) {
                if (otherMask !== undefined && otherMask[j] === 1) continue;
                const other = otherBlock.instructions[j];
                if (other?.kind === "load" && other.slot === op.slot) {
                  usedInPrefix = true;
                  break;
                }
              }
              if (usedInPrefix) break;
            }
            if (!usedInPrefix) {
              mask[i] = 1;
              const prev = remainingUses.get(op.value) ?? 0;
              if (prev > 0) remainingUses.set(op.value, prev - 1);
            }
          }
        }
        continue;
      }
      if (
        op.kind === "closure-environment" &&
        (remainingUses.get(op.id) ?? 0) === 0
      ) {
        mask[i] = 1;
      }
    }
  }

  let nextId = maxValueId + 1;
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "sink environment block invariant";
    const mask = removeByBlock[block.id];
    if (mask !== undefined) {
      const instructions: Instruction[] = [];
      for (let i = 0; i < block.instructions.length; i++) {
        if (mask[i] === 1) continue;
        const op = block.instructions[i];
        if (op !== undefined) instructions.push(op);
      }
      blocks.push(
        instructions.length === block.instructions.length
          ? block
          : { ...block, instructions },
      );
      continue;
    }
    const items = perTarget.get(block.id);
    if (items === undefined || items.length === 0) {
      blocks.push(block);
      continue;
    }
    const first = items[0];
    if (first === undefined) throw "sink environment item invariant";
    const envId = nextId++;
    const prefix: Instruction[] = [
      {
        kind: "closure-environment",
        id: envId,
        start: first.readStart,
        end: first.readEnd,
      },
    ];
    for (const item of items) {
      if (item === undefined) continue;
      const valueId = nextId++;
      prefix.push({
        kind: "record-read",
        id: valueId,
        object: envId,
        record: item.record,
        field: item.field,
        start: item.readStart,
        end: item.readEnd,
        ...(item.readInline === undefined ? {} : { inline: item.readInline }),
      });
      prefix.push({
        kind: "store",
        slot: item.slot,
        value: valueId,
        start: item.storeStart,
        end: item.storeEnd,
        ...(item.storeInline === undefined ? {} : { inline: item.storeInline }),
      });
    }
    for (const op of block.instructions) {
      if (op !== undefined) prefix.push(op);
    }
    blocks.push({ ...block, instructions: prefix });
  }

  const debug =
    fn.debug === undefined ? undefined : retainDebugValues(fn, blocks);
  return {
    fn: debug === undefined ? { ...fn, blocks } : { ...fn, blocks, debug },
    visited,
    sunk,
  };
}
