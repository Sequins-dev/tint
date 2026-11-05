import type { Instruction, Condition } from "../isa.ts";
export interface LeafAssembler {
  readonly emit: (instruction: Instruction) => void;
  readonly label: (name: string) => void;
  readonly branch: (name: string, condition?: Condition) => void;
  readonly finish: () => readonly Instruction[];
}
/** Label resolution shared by nonallocating private leaf kernels. */
export function createLeafAssembler(): LeafAssembler {
  const code: Instruction[] = [],
    labels = new Map<string, number>(),
    fixups: {
      index: number;
      label: string;
      condition: Condition | undefined;
    }[] = [];
  function emit(instruction: Instruction): void {
    code.push(instruction);
  }
  function label(name: string): void {
    if (labels.has(name)) throw "duplicate leaf label";
    labels.set(name, code.length);
  }
  function branch(
    name: string,
    condition: Condition | undefined = undefined,
  ): void {
    fixups.push({ index: code.length, label: name, condition });
    emit(
      condition === undefined
        ? { op: "b", displacement: 0 }
        : { op: "b.cond", condition, displacement: 0 },
    );
  }
  function finish(): readonly Instruction[] {
    for (const fixup of fixups) {
      if (fixup === undefined) throw "leaf fixup invariant";
      const target = labels.get(fixup.label);
      if (target === undefined) throw "missing leaf label";
      const displacement = (target - fixup.index) * 4;
      const condition = fixup.condition;
      code[fixup.index] =
        condition === undefined
          ? { op: "b", displacement }
          : { op: "b.cond", condition, displacement };
    }
    return code;
  }
  return { emit, label, branch, finish };
}
