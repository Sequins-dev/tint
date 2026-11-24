import type { Instruction, Condition, DataRegister } from "../isa.ts";
export interface LeafAssembler {
  readonly emit: (instruction: Instruction) => void;
  readonly label: (name: string) => void;
  readonly branch: (name: string, condition?: Condition) => void;
  /** Branches to `name` when bit `bit` of `register` is clear (tbz) or,
   * with `set`, set (tbnz). Leaf kernels stay within its ±32 KiB. */
  readonly testBit: (
    name: string,
    register: DataRegister,
    bit: number,
    set: boolean,
  ) => void;
  /** Branches to `name` when `register` is zero (cbz) or, with `nonzero`,
   * nonzero (cbnz): all 64 bits. Within ±1 MiB. */
  readonly zeroBranch: (
    name: string,
    register: DataRegister,
    nonzero: boolean,
  ) => void;
  readonly finish: () => readonly Instruction[];
}
/** Label resolution shared by nonallocating private leaf kernels. With a
 * `loopAlignment` (bytes, a multiple of four), every loop head (the target
 * of a backward branch) starts at that alignment relative to the kernel's
 * first instruction, after NOP padding: placed at an equally aligned
 * address, a loop no longer than the alignment never crosses a fetch block
 * of twice that size, wherever earlier code ends. */
export function createLeafAssembler(loopAlignment: number = 0): LeafAssembler {
  const code: Instruction[] = [],
    labels = new Map<string, number>(),
    fixups: {
      index: number;
      label: string;
      at: (displacement: number) => Instruction;
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
    jump(name, (displacement) =>
      condition === undefined
        ? { op: "b", displacement }
        : { op: "b.cond", condition, displacement },
    );
  }
  function testBit(
    name: string,
    register: DataRegister,
    bit: number,
    set: boolean,
  ): void {
    jump(name, (displacement) => ({
      op: set ? "tbnz" : "tbz",
      rt: register,
      bit,
      displacement,
    }));
  }
  function zeroBranch(
    name: string,
    register: DataRegister,
    nonzero: boolean,
  ): void {
    jump(name, (displacement) => ({
      op: nonzero ? "cbnz" : "cbz",
      width: 64,
      rt: register,
      displacement,
    }));
  }
  function jump(name: string, at: (displacement: number) => Instruction): void {
    fixups.push({ index: code.length, label: name, at });
    emit(at(0));
  }
  function finish(): readonly Instruction[] {
    // Loop heads, then each instruction's index after their padding.
    const heads = new Uint8Array(code.length + 1);
    if (loopAlignment > 0)
      for (const fixup of fixups) {
        if (fixup === undefined) throw "leaf fixup invariant";
        const target = labels.get(fixup.label);
        if (target === undefined) throw "missing leaf label";
        if (target <= fixup.index) heads[target] = 1;
      }
    const unit = loopAlignment / 4,
      placed = new Uint32Array(code.length + 1),
      out: Instruction[] = [];
    for (let index = 0; index <= code.length; index++) {
      if (heads[index] === 1)
        while (out.length % unit !== 0) out.push({ op: "nop" });
      placed[index] = out.length;
      const instruction = code[index];
      if (instruction !== undefined) out.push(instruction);
    }
    for (const fixup of fixups) {
      if (fixup === undefined) throw "leaf fixup invariant";
      const target = labels.get(fixup.label);
      if (target === undefined) throw "missing leaf label";
      const from = placed[fixup.index] ?? 0;
      out[from] = fixup.at(((placed[target] ?? 0) - from) * 4);
    }
    return out;
  }
  return { emit, label, branch, testBit, zeroBranch, finish };
}
