import type { Instruction, Condition } from "../isa.ts";
import { nativeArrayLengthOffset, nativeArrayDataOffset } from "@tint/abi/host";
import { createLeafAssembler } from "./leaf.ts";
export type SharedMemoryPrimitive =
  | "shared-read-unsigned"
  | "shared-write-unsigned"
  | "shared-read-word64"
  | "shared-write-word64"
  | "shared-compare-exchange-unsigned"
  | "shared-compare-exchange-word64";
/** Trusted normal-memory access; caller proves mapping, ownership and lifetime.
 * Numeric arguments have already passed exact nonnegative safe-integer checks.
 * x0 base, x1 extent, x2 offset; remaining arguments follow the facade ABI.
 * Returns x0 unsigned payload or status 0; invalid arguments return -1, disjoint
 * from uint32 payloads. Scratch is a real managed Uint32Array header with two
 * disjoint caller-owned words. No calls/allocations/context slots. Clobbers
 * x0..x15/flags; preserves x16..x29 and all FP/SIMD registers. Ordered accesses
 * conservatively use full inner-shareable fences as well as acquire/release.
 * CAS always is seq-cst, including mismatch and equal replacement paths. */
export function sharedMemoryPrimitive(
  kind: SharedMemoryPrimitive,
): readonly Instruction[] {
  const asm = createLeafAssembler(),
    emit = asm.emit;
  const cas64 = kind === "shared-compare-exchange-word64";
  const casUnsigned = kind === "shared-compare-exchange-unsigned";
  const cas = cas64 || casUnsigned;
  const unsigned =
    kind === "shared-read-unsigned" ||
    kind === "shared-write-unsigned" ||
    casUnsigned;
  const read = kind === "shared-read-unsigned" || kind === "shared-read-word64";
  const scratch = kind === "shared-read-word64" || cas64;
  function imm(rd: number, value: number): void {
    emit({ op: "movz", width: 64, rd, immediate: value % 65536, shift: 0 });
    if (value >= 65536)
      emit({
        op: "movk",
        width: 64,
        rd,
        immediate: Math.floor(value / 65536),
        shift: 16,
      });
  }
  function move(rd: number, rn: number): void {
    emit({ op: "orr-reg", width: 64, rd, rn: "zr", rm: rn });
  }
  function compare(rn: number, rm: number): void {
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  }
  function reject(condition: Condition): void {
    asm.branch("invalid", condition);
  }
  function add(rd: number, rn: number, rm: number): void {
    emit({
      op: "add-reg",
      width: 64,
      rd,
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  function maximum(): void {
    emit({ op: "orn-reg", width: 64, rd: 9, rn: "zr", rm: "zr" });
    emit({ op: "ubfm", width: 64, rd: 9, rn: 9, immr: 0, imms: 52 });
  }
  function halves(lo: number, hi: number, result: number): void {
    imm(9, 0xffffffff);
    compare(lo, 9);
    reject("hi");
    compare(hi, 9);
    reject("hi");
    emit({ op: "ubfm", width: 64, rd: result, rn: hi, immr: 32, imms: 31 });
    emit({ op: "orr-reg", width: 64, rd: result, rn: result, rm: lo });
  }
  if (unsigned) move(8, 3);
  else imm(8, 8);
  if (cas) imm(12, 1);
  else
    move(
      12,
      kind === "shared-read-unsigned"
        ? 4
        : kind === "shared-write-unsigned"
          ? 5
          : 3,
    );
  if (scratch) move(15, cas64 ? 7 : 4);
  if (cas64) {
    halves(3, 4, 14);
    halves(5, 6, 13);
  } else if (casUnsigned) {
    move(14, 4);
    move(13, 5);
  } else if (kind === "shared-write-word64") halves(4, 5, 13);
  else if (kind === "shared-write-unsigned") move(13, 4);
  if (unsigned) {
    for (let width = 1; width <= 4; width *= 2) {
      imm(9, width);
      compare(8, 9);
      asm.branch("width-valid", "eq");
    }
    asm.branch("invalid");
    asm.label("width-valid");
  }
  imm(9, 1);
  compare(12, 9);
  reject("hi");
  imm(9, 0);
  compare(0, 9);
  reject("eq");
  add(10, 0, 1);
  maximum();
  compare(10, 9);
  reject("hi");
  compare(2, 1);
  reject("hi");
  emit({
    op: "sub-reg",
    width: 64,
    rd: 11,
    rn: 1,
    rm: 2,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  compare(8, 11);
  reject("hi");
  add(10, 0, 2);
  emit({
    op: "sub-imm",
    width: 64,
    rd: 9,
    rn: 8,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  emit({ op: "and-reg", width: 64, rd: 11, rn: 10, rm: 9 });
  imm(9, 0);
  compare(11, 9);
  reject("ne");
  if (kind === "shared-write-unsigned" || casUnsigned) {
    imm(9, 3);
    emit({ op: "lslv", width: 64, rd: 9, rn: 8, rm: 9 });
    imm(11, 1);
    emit({ op: "lslv", width: 64, rd: 11, rn: 11, rm: 9 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 11,
      rn: 11,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    compare(13, 11);
    reject("hi");
    if (casUnsigned) {
      compare(14, 11);
      reject("hi");
    }
  }
  if (scratch) {
    imm(9, 0);
    compare(15, 9);
    reject("eq");
    emit({
      op: "ldr",
      width: 64,
      rt: 11,
      rn: 15,
      offset: nativeArrayLengthOffset,
    });
    imm(9, 2);
    compare(11, 9);
    reject("cc");
    emit({
      op: "ldr",
      width: 64,
      rt: 15,
      rn: 15,
      offset: nativeArrayDataOffset,
    });
    imm(9, 0);
    compare(15, 9);
    reject("eq");
    imm(9, 3);
    emit({ op: "and-reg", width: 64, rd: 11, rn: 15, rm: 9 });
    imm(9, 0);
    compare(11, 9);
    reject("ne");
    emit({
      op: "add-imm",
      width: 64,
      rd: 11,
      rn: 15,
      immediate: 8,
      shift: 0,
      setFlags: false,
    });
    maximum();
    compare(11, 9);
    reject("hi");
    compare(11, 10);
    asm.branch("scratch-valid", "ls");
    emit({
      op: "add-imm",
      width: 64,
      rd: 11,
      rn: 10,
      immediate: 8,
      shift: 0,
      setFlags: false,
    });
    compare(15, 11);
    reject("cc");
    asm.label("scratch-valid");
  }
  if (cas) {
    emit({ op: "dmb", domain: "ish" });
    if (cas64) exchange(64);
    else {
      for (let bytes = 1; bytes <= 4; bytes *= 2) {
        if (bytes !== 4) {
          imm(9, bytes);
          compare(8, 9);
          asm.branch("cas-next-" + bytes, "ne");
        }
        exchange(bytes === 1 ? 8 : bytes === 2 ? 16 : 32);
        if (bytes !== 4) asm.label("cas-next-" + bytes);
      }
    }
    asm.label("mismatch");
    emit({ op: "clrex" });
    asm.label("captured");
    emit({ op: "dmb", domain: "ish" });
  } else {
    imm(9, 0);
    compare(12, 9);
    asm.branch("unordered", "eq");
    emit({ op: "dmb", domain: "ish" });
    access(true);
    emit({ op: "dmb", domain: "ish" });
    asm.branch("accessed");
    asm.label("unordered");
    access(false);
    asm.label("accessed");
  }
  function exchange(width: 8 | 16 | 32 | 64): void {
    const retry = "retry-" + width;
    asm.label(retry);
    emit({ op: "ldaxr", width, rt: 11, rn: 10 });
    compare(11, 14);
    asm.branch("mismatch", "ne");
    emit({ op: "stlxr", width, rs: 9, rt: 13, rn: 10 });
    imm(0, 0);
    compare(9, 0);
    asm.branch(retry, "ne");
    asm.branch("captured");
  }
  function access(ordered: boolean): void {
    const label = ordered ? "ordered" : "plain";
    if (!unsigned) {
      emit(
        ordered
          ? {
              op: read ? "ldar" : "stlr",
              width: 64,
              rt: read ? 11 : 13,
              rn: 10,
            }
          : {
              op: read ? "ldr" : "str",
              width: 64,
              rt: read ? 11 : 13,
              rn: 10,
              offset: 0,
            },
      );
      return;
    }
    for (let bytes = 1; bytes <= 4; bytes *= 2) {
      if (bytes !== 4) {
        imm(9, bytes);
        compare(8, 9);
        asm.branch(label + "-next-" + bytes, "ne");
      }
      if (ordered)
        emit({
          op: read ? "ldar" : "stlr",
          width: bytes === 1 ? 8 : bytes === 2 ? 16 : 32,
          rt: read ? 11 : 13,
          rn: 10,
        });
      else if (bytes === 4)
        emit({
          op: read ? "ldr" : "str",
          width: 32,
          rt: read ? 11 : 13,
          rn: 10,
          offset: 0,
        });
      else if (read) {
        if (bytes === 1) emit({ op: "ldrb", rt: 11, rn: 10, offset: 0 });
        else emit({ op: "ldrh", rt: 11, rn: 10, offset: 0 });
      } else {
        if (bytes === 1) emit({ op: "strb", rt: 13, rn: 10, offset: 0 });
        else emit({ op: "strh", rt: 13, rn: 10, offset: 0 });
      }
      if (bytes !== 4) {
        asm.branch(label + "-done");
        asm.label(label + "-next-" + bytes);
      }
    }
    asm.label(label + "-done");
  }
  if (scratch) {
    emit({ op: "str", width: 32, rt: 11, rn: 15, offset: 0 });
    emit({ op: "ubfm", width: 64, rd: 9, rn: 11, immr: 32, imms: 63 });
    emit({ op: "str", width: 32, rt: 9, rn: 15, offset: 4 });
  }
  if ((read && unsigned) || casUnsigned) move(0, 11);
  else imm(0, 0);
  emit({ op: "ret", rn: 30 });
  asm.label("invalid");
  emit({ op: "orn-reg", width: 64, rd: 0, rn: "zr", rm: "zr" });
  emit({ op: "ret", rn: 30 });
  return asm.finish();
}
