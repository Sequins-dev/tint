import {
  analyzeLiveSlotsPrecisely,
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type FunctionIR,
  type ScalarType,
} from "@tint/ir/scalar";
import {
  safepointLiveSlots,
  type SafepointSite,
} from "../../scalar/stack-maps.ts";

interface LabeledSafepoint extends SafepointSite {
  readonly label: string;
}
export interface PendingSafepoint {
  readonly label: string;
  readonly functionLabel: string;
  readonly map: readonly number[];
}

function traced(type: ScalarType): boolean {
  return (
    type !== "number" &&
    type !== "boolean" &&
    type !== "optional-number" &&
    type !== "optional-boolean"
  );
}

/** Every x86 value has its own home. A slot belongs in the map through
 * either successor of the call; a temporary belongs only between its
 * definition and last use within the block. The result, including any
 * exceptional payload, has not been produced at this safepoint. */
export function frameStackMaps(
  fn: FunctionIR,
  functionLabel: string,
  frameBytes: number,
  slots: readonly number[],
  homes: ReadonlyMap<number, number>,
  types: ReadonlyMap<number, ScalarType>,
  sites: readonly LabeledSafepoint[],
): PendingSafepoint[] {
  const trackedSlots: number[] = [];
  const tracked = new Uint8Array(slots.length);
  for (let slot = 0; slot < slots.length; slot++) {
    const type = fn.slots[slot];
    if (type !== undefined && traced(type)) {
      tracked[slot] = 1;
      trackedSlots.push(slot);
    }
  }
  const liveness = analyzeLiveSlotsPrecisely(
    fn,
    Number.MAX_SAFE_INTEGER,
    trackedSlots,
    true,
  );
  if (liveness === undefined) throw "x86-64 slot liveness invariant";
  const liveSlots = safepointLiveSlots(
    fn,
    liveness.slots,
    tracked,
    sites,
    true,
  );
  const maps: PendingSafepoint[] = [];
  const lastUse = new Map<number, number>();
  const definitions: number[] = [];
  let previous = -1;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const live = liveSlots[i];
    if (site === undefined || live === undefined)
      throw "x86-64 safepoint liveness invariant";
    const block = fn.blocks[site.block];
    if (block === undefined) throw "x86-64 safepoint block invariant";
    if (site.block !== previous) {
      previous = site.block;
      lastUse.clear();
      definitions.length = 0;
      for (let index = 0; index < block.instructions.length; index++) {
        const op = block.instructions[index];
        if (op === undefined) throw "x86-64 safepoint instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined) {
          const type = types.get(id);
          if (type !== undefined && traced(type)) definitions.push(index);
        }
        visitInstructionOperands(op, (operand) => {
          lastUse.set(operand, index);
        });
      }
      visitTerminatorOperands(block.terminator, (operand) => {
        lastUse.set(operand, block.instructions.length);
      });
    }
    const references: number[] = [];
    const generals: number[] = [];
    function add(offset: number, type: ScalarType): void {
      const list = type === "general" ? generals : references;
      list.push(frameBytes + offset);
    }
    for (const slot of live) {
      if (slot === undefined) throw "x86-64 live slot invariant";
      const offset = slots[slot];
      const type = fn.slots[slot];
      if (offset === undefined || type === undefined)
        throw "x86-64 live slot home invariant";
      add(offset, type);
    }
    for (const index of definitions) {
      if (index === undefined) throw "x86-64 definition index invariant";
      if (index >= site.index) break;
      const op = block.instructions[index];
      if (op === undefined) throw "x86-64 temporary definition invariant";
      const id = instructionResult(op);
      if (id === undefined) throw "x86-64 temporary ID invariant";
      if ((lastUse.get(id) ?? -1) < site.index) continue;
      const offset = homes.get(id);
      const type = types.get(id);
      if (offset === undefined || type === undefined)
        throw "x86-64 temporary root home invariant";
      add(offset, type);
    }
    references.sort((left, right) => left - right);
    generals.sort((left, right) => left - right);
    maps.push({
      label: site.label,
      functionLabel,
      map: [
        frameBytes,
        references.length,
        ...references,
        generals.length,
        ...generals,
        0,
      ],
    });
  }
  return maps;
}
