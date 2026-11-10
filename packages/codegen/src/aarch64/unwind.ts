import type { UnwindRange } from "@tint/abi/unwind";
import type { NativeModule } from "./scalar/index.ts";
/** AArch64 DWARF register numbers (DWARF for the Arm 64-bit Architecture). */
export const dwarfFramePointer = 29;
export const dwarfLinkRegister = 30;
export const dwarfStackPointer = 31;
export function dwarfFloatRegister(index: number): number {
  return 64 + index;
}
/** Call-frame rules of a module's code, at `base` plus module offsets, in
 * address order: function bodies use their recorded rule; private leaf
 * helpers and cell helpers are leaves. */
export function unwindRanges(
  native: NativeModule,
  base: number,
): UnwindRange[] {
  const ranges: UnwindRange[] = [];
  for (const fn of native.functions) {
    if (fn === undefined) throw "unwind function invariant";
    if (fn.import === true) continue;
    const rule = fn.unwind;
    if (rule === undefined) throw "unwind rule invariant";
    ranges.push({ offset: base + fn.offset, byteLength: fn.byteLength, rule });
  }
  for (const helper of native.helpers) {
    if (helper === undefined) throw "unwind helper invariant";
    ranges.push({
      offset: base + helper.offset,
      byteLength: helper.byteLength,
      rule: { kind: "leaf" },
    });
  }
  for (const helper of native.cellHelpers) {
    if (helper === undefined) throw "unwind cell helper invariant";
    ranges.push({
      offset: base + helper.offset,
      byteLength: helper.byteLength,
      rule: { kind: "leaf" },
    });
  }
  ranges.sort((left, right) => left.offset - right.offset);
  return ranges;
}
