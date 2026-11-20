import type {
  UnwindRange,
  UnwindRow,
  UnwindRule,
  UnwindSave,
} from "@tint/abi/unwind";
import type { Instruction } from "./isa.ts";

export const dwarfStackPointer = 7;
export const dwarfFramePointer = 6;
export const dwarfReturnAddress = 16;

export const returnSave: UnwindSave = {
  register: dwarfReturnAddress,
  offset: -8,
};
export const frameSave: UnwindSave = {
  register: dwarfFramePointer,
  offset: -16,
};

export interface LabeledRow {
  readonly label: string;
  readonly register: number;
  readonly depth: number;
  readonly saves: readonly UnwindSave[];
}
export interface LabeledUnwind {
  readonly start: string;
  readonly end: string;
  readonly rule: "leaf" | "outermost" | "rows";
  readonly rows: readonly LabeledRow[];
}

/** Attach rules to instruction boundaries so variable-length encodings do
 * not require the emitter to predict offsets. */
export function frameRows(
  emit: (instruction: Instruction) => void,
  start: string,
): {
  readonly rows: readonly LabeledRow[];
  readonly record: (
    register: number,
    depth: number,
    saves: readonly UnwindSave[],
  ) => void;
} {
  const rows: LabeledRow[] = [
    {
      label: start,
      register: dwarfStackPointer,
      depth: 8,
      saves: [returnSave],
    },
  ];
  return {
    rows,
    record(register, depth, saves) {
      const name = start + ":cfi:" + String(rows.length);
      emit({ op: "label", name });
      rows.push({ label: name, register, depth, saves });
    },
  };
}

export function resolveUnwind(
  ranges: readonly LabeledUnwind[],
  labels: ReadonlyMap<string, number>,
): UnwindRange[] {
  const unwind: UnwindRange[] = [];
  for (const range of ranges) {
    if (range === undefined) throw "x86-64 unwind range invariant";
    const start = labels.get(range.start);
    const end = labels.get(range.end);
    if (start === undefined || end === undefined || end < start)
      throw "x86-64 unwind boundary invariant";
    if (start === end) continue;
    const rows: UnwindRow[] = [];
    for (const row of range.rows) {
      if (row === undefined) throw "x86-64 unwind row invariant";
      const label = labels.get(row.label);
      if (label === undefined || label < start || label >= end)
        throw "x86-64 unwind row boundary invariant";
      rows.push({
        offset: label - start,
        cfaRegister: row.register,
        cfaOffset: row.depth,
        saves: row.saves,
      });
    }
    let rule: UnwindRule = { kind: "leaf" };
    if (range.rule === "rows") rule = { kind: "rows", rows };
    if (range.rule === "outermost") rule = { kind: "outermost" };
    unwind.push({
      offset: start,
      byteLength: end - start,
      rule,
    });
  }
  return unwind;
}
