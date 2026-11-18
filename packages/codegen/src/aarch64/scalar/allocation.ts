import { createLeafAssembler } from "./leaf.ts";
import type { Instruction } from "../isa.ts";
/** The shared halves of an allocation's slow path (the managed allocator
 * call). Each allocation site keeps its own call, safepoint and exceptional
 * branch; these leaf kernels hold the setup and the result checks, which are
 * the same at every site. */
export type AllocationHelper = "allocate-call" | "allocate-finish";
/** Hosted context words the allocator call reads (see the context layout in
 * the runtime): managed base, allocator entry, its closure, managed limit. */
const contextManagedBase = 8,
  contextAllocatorEntry = 16,
  contextAllocatorClosure = 24,
  contextManagedLimit = 32;
/** Private leaf-kernel ABI, not a source-language or foreign call entry.
 *
 * allocate-call: x0 = context, x3 = the site's four-word result area, x9 =
 * byte size. Zeroes the result area and leaves the allocator's arguments:
 * x0 context, x1 closure, x2 = 0, x3, d0 = size, and its entry in x16 (the
 * site then calls x16). Traps when no allocator is published. Clobbers x1,
 * x2, x16, d0, NZCV.
 *
 * allocate-finish: x9 = the allocator's result word (`number | undefined`,
 * NaN-boxed), x10 = byte size, x11 = context. Returns the object's native
 * address in x9 after checking that the result is an exact, 8-aligned uint32
 * offset whose extent lies within the managed region. Clobbers x9..x14, d0,
 * d1, NZCV. Every failed check traps: they are invariant failures. */
export function allocationHelper(
  kind: AllocationHelper,
): readonly Instruction[] {
  const assembler = createLeafAssembler(),
    emit = assembler.emit,
    label = assembler.label,
    branch = assembler.branch;
  function compareZero(rn: number): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
  }
  if (kind === "allocate-call") {
    emit({
      op: "stp",
      width: 64,
      rt: "zr",
      rt2: "zr",
      rn: 3,
      offset: 0,
      mode: "offset",
    });
    emit({
      op: "stp",
      width: 64,
      rt: "zr",
      rt2: "zr",
      rn: 3,
      offset: 16,
      mode: "offset",
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 1,
      rn: 0,
      offset: contextAllocatorClosure,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 16,
      rn: 0,
      offset: contextAllocatorEntry,
    });
    compareZero(16);
    branch("trap", "eq");
    emit({ op: "movz", width: 64, rd: 2, immediate: 0, shift: 0 });
    emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
    emit({ op: "ret", rn: 30 });
  } else {
    // `undefined` (the reserved NaN payload) is an invariant failure.
    emit({ op: "extr", width: 64, rd: 12, rn: 9, rm: 9, lsb: 51 });
    emit({
      op: "add-imm",
      width: 64,
      rd: "zr",
      rn: 12,
      immediate: 2,
      shift: 0,
      setFlags: true,
    });
    branch("trap", "eq");
    // An exact uint32: converting to one and back is the identity (NaN,
    // negatives, fractions and values past 2^32 - 1 all differ).
    emit({ op: "fmov-d-x", rd: 0, rn: 9 });
    emit({ op: "fcvtzu-w-d", rd: 12, rn: 0 });
    emit({ op: "ucvtf-d-w", rd: 1, rn: 12 });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("trap", "ne");
    // 8-aligned, and its extent within the managed limit.
    emit({ op: "ubfm", width: 32, rd: 13, rn: 12, immr: 0, imms: 2 });
    compareZero(13);
    branch("trap", "ne");
    emit({
      op: "add-reg",
      width: 64,
      rd: 13,
      rn: 12,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 14,
      rn: 11,
      offset: contextManagedLimit,
    });
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 13,
      rm: 14,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    branch("trap", "hi");
    emit({
      op: "ldr",
      width: 64,
      rt: 14,
      rn: 11,
      offset: contextManagedBase,
    });
    compareZero(14);
    branch("trap", "eq");
    emit({
      op: "add-reg",
      width: 64,
      rd: 9,
      rn: 14,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ret", rn: 30 });
  }
  label("trap");
  emit({ op: "brk", immediate: 3 });
  return assembler.finish();
}
