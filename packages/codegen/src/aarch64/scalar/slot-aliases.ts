import type { NumberIndex } from "@tint/foundation/collections/key-index";
import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type FunctionIR,
} from "@tint/ir/scalar";
/** Verified block-local SSA. A `load` result may use its slot's frame word as
 * its home, so the load itself emits nothing and consumers read the slot, when
 * nothing stores the slot before the result's last use in its block: no
 * `store` to it before that use and no terminator writing it while the result
 * is still an operand. Slots named by cell or record-cell terminators are
 * excluded entirely, since cell helpers may receive their address. Returns a
 * per-value-id mark (1 = alias), indexed by `valueIds` when supplied or by raw
 * value ID otherwise, or undefined when `budget` is exceeded. */
export function aliasedSlotLoads(
  fn: FunctionIR,
  budget: number,
  valueIds?: NumberIndex,
): Uint8Array | undefined {
  let maximum = -1,
    work = fn.slots.length;
  if (work > budget) return undefined;
  const exposed = new Uint8Array(fn.slots.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "slot alias block invariant";
    const term = block.terminator;
    if (term.kind === "cell" || term.kind === "record-cell")
      exposed[term.slot] = 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "slot alias instruction invariant";
      if (++work > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined) {
        const key = valueIds === undefined ? id : valueIds.intern(id);
        if (key > maximum) maximum = key;
      }
    }
  }
  // Dense per-id tables: sparse ids beyond the budget fall back to no aliases.
  if (maximum + 1 > budget) return undefined;
  work += maximum + 1;
  const aliases = new Uint8Array(maximum + 1),
    // Slot + 1 of each open candidate load; zero when none.
    pending = new Uint32Array(maximum + 1);
  for (const block of fn.blocks) {
    if (block === undefined) throw "slot alias block invariant";
    // Candidate loads of this block: value key -> slot. A store to the slot
    // while a candidate is still to be used cancels that candidate.
    const open: number[] = [];
    let index = 0;
    for (const op of block.instructions) {
      if (op === undefined) throw "slot alias instruction invariant";
      if (++work > budget) return undefined;
      // Uses first: a candidate used by this instruction stays valid even if
      // the instruction stores the slot (it reads its operands first).
      const used: number[] = [];
      visitInstructionOperands(op, (operand) => {
        const key = valueIds === undefined ? operand : valueIds.lookup(operand);
        if (key >= 0 && key <= maximum && (pending[key] ?? 0) !== 0)
          used.push(key);
      });
      if (op.kind === "store") {
        for (let i = 0; i < open.length; i++) {
          const candidate = open[i];
          if (candidate === undefined) continue;
          // Conflicted unless this was its last use (checked at block end).
          // A candidate already used after an earlier store (3) stays out.
          if (
            pending[candidate] === op.slot + 1 &&
            aliases[candidate] === 1 &&
            !used.includes(candidate)
          )
            aliases[candidate] = 2;
        }
      }
      for (const candidate of used) {
        if (candidate === undefined) continue;
        // A use after a conflicting store invalidates the alias for good.
        if (aliases[candidate] === 2) aliases[candidate] = 3;
      }
      if (op.kind === "load" && exposed[op.slot] !== 1) {
        const key = valueIds === undefined ? op.id : valueIds.intern(op.id);
        pending[key] = op.slot + 1;
        aliases[key] = 1;
        open.push(key);
      }
      index++;
    }
    const term = block.terminator;
    const termUses: number[] = [];
    visitTerminatorOperands(term, (operand) => {
      const key = valueIds === undefined ? operand : valueIds.lookup(operand);
      if (key >= 0 && key <= maximum && (pending[key] ?? 0) !== 0)
        termUses.push(key);
    });
    const writes = term.kind === "record" ? term.slot : undefined;
    for (const candidate of termUses) {
      if (candidate === undefined) continue;
      if (aliases[candidate] === 2) aliases[candidate] = 3;
      if (writes !== undefined && pending[candidate] === writes + 1)
        aliases[candidate] = 3;
    }
    for (const candidate of open) {
      if (candidate === undefined) continue;
      // 1: never conflicted. 2: a store came only after its last use.
      aliases[candidate] = (aliases[candidate] ?? 0) === 3 ? 0 : 1;
      pending[candidate] = 0;
    }
    work += index;
  }
  return aliases;
}
