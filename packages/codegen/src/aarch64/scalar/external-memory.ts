import {
  nativeFunctionEnvironmentOffset,
  nativeFunctionEntryOffset,
} from "@tint/abi/function";
import type { Instruction } from "../isa.ts";
import { nativeExternalMemoryOffset } from "./abi.ts";
import { createLeafAssembler } from "./leaf.ts";

/** Inline capability sequence. x0 is the hosted context; configure takes a
 * permanent registrar reference in x1, register takes numeric d0/d1. Returns
 * integer x0 = 0/-1. The registrar obeys Tint's completion ABI and must neither
 * allocate nor throw. Frame pointer stays unchanged across the temporary buffer. */
export function externalMemoryCapability(
  configure: boolean,
): readonly Instruction[] {
  const asm = createLeafAssembler(),
    emit = asm.emit;
  emit({
    op: "ldr",
    width: 64,
    rt: 9,
    rn: 0,
    offset: nativeExternalMemoryOffset,
  });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 9,
    immediate: 0,
    shift: 0,
    setFlags: true,
  });
  asm.branch("invalid", configure ? "ne" : "eq");
  if (configure) {
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 1,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    asm.branch("invalid", "eq");
    emit({
      op: "str",
      width: 64,
      rt: 1,
      rn: 0,
      offset: nativeExternalMemoryOffset,
    });
    emit({ op: "movz", width: 64, rd: 0, immediate: 0, shift: 0 });
    asm.branch("done");
  } else {
    // Preserve LR without changing FP: the surrounding function owns its frame.
    emit({
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -48,
      mode: "pre",
    });
    for (let offset = 16; offset < 48; offset += 8)
      emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
    emit({
      op: "ldr",
      width: 64,
      rt: 1,
      rn: 9,
      offset: nativeFunctionEnvironmentOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 16,
      rn: 9,
      offset: nativeFunctionEntryOffset,
    });
    emit({ op: "movz", width: 64, rd: 2, immediate: 0, shift: 0 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 3,
      rn: "sp",
      immediate: 16,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "blr", rn: 16 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    asm.branch("bad-completion", "ne");
    emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 32 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 0, condition: "eq" });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 0,
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    asm.branch("restore");
    asm.label("bad-completion");
    emit({ op: "orn-reg", width: 64, rd: 0, rn: "zr", rm: "zr" });
    asm.label("restore");
    emit({
      op: "ldp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: 48,
      mode: "post",
    });
    asm.branch("done");
  }
  asm.label("invalid");
  emit({ op: "orn-reg", width: 64, rd: 0, rn: "zr", rm: "zr" });
  asm.label("done");
  return asm.finish();
}
