import type { Op, Region } from "./model.ts";

/** Removes ops whose results are all unused and that `removable` accepts
 * (effect-free in their dialect), repeating until none remain, including in
 * nested regions. Returns the number of ops removed. */
export function removeDeadOps(
  region: Region,
  removable: (op: Op) => boolean,
): number {
  let removed = 0;
  for (let changed = true; changed;) {
    changed = false;
    const uses = new Map<number, number>();
    function count(target: Region): void {
      for (const block of target.blocks) {
        if (block === undefined) throw "STRUCTURED_BLOCK_INVARIANT";
        for (const op of block.ops) {
          if (op === undefined) throw "STRUCTURED_OP_INVARIANT";
          for (const operand of op.operands)
            if (operand !== undefined)
              uses.set(operand, (uses.get(operand) ?? 0) + 1);
          for (const nested of op.regions) {
            if (nested === undefined) throw "STRUCTURED_REGION_INVARIANT";
            count(nested);
          }
        }
      }
    }
    count(region);
    function sweep(target: Region): void {
      for (const block of target.blocks) {
        if (block === undefined) throw "STRUCTURED_BLOCK_INVARIANT";
        const kept: Op[] = [];
        for (const op of block.ops) {
          if (op === undefined) throw "STRUCTURED_OP_INVARIANT";
          let used = false;
          for (const result of op.results)
            if (result !== undefined && (uses.get(result) ?? 0) > 0)
              used = true;
          if (!used && op.results.length > 0 && removable(op)) {
            removed++;
            changed = true;
            continue;
          }
          for (const nested of op.regions) {
            if (nested === undefined) throw "STRUCTURED_REGION_INVARIANT";
            sweep(nested);
          }
          kept.push(op);
        }
        block.ops = kept;
      }
    }
    sweep(region);
  }
  return removed;
}
