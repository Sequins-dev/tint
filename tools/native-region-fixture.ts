import type { AArch64AddressReference as AddressReference } from "@tint/codegen/aarch64/image-relocations";
// Verification-only machine-code fixture; not a TypeScript lowering pass.
import assert from "node:assert/strict";
import {
  writeInstruction,
  relativeAddress,
  patchBranch,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";
export function nativeRegionFixture(invalidRelease = false) {
  const instructions: Instruction[] = [],
    addressFixups: AddressReference[] = [];
  const branches: { offset: number; target: string; branch: Branch }[] = [],
    labels = new Map<string, number>();
  const imports = ["_getpagesize", "_mmap", "_munmap", "___error", "_write"];
  const emit = (i: Instruction) => instructions.push(i);
  const imm = (rd: number, value: number) =>
    emit({ op: "movz", width: 64, rd, immediate: value, shift: 0 });
  const mov = (rd: number, rn: number) =>
    emit({
      op: "add-reg",
      width: 64,
      rd,
      rn: "zr",
      rm: rn,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  const branch = (target: string, b: Branch = { op: "b" }) => {
    branches.push({ offset: instructions.length * 4, target, branch: b });
    emit({ ...b, displacement: 0 });
  };
  const call = (name: string) => {
    addressFixups.push({
      offset: instructions.length * 4,
      rd: 16,
      scratch: 17,
      target: { kind: "import", name },
    });
    const pointer = relativeAddress(16, 17, 0);
    assert.ok(pointer.ok);
    pointer.value.forEach(emit);
    emit({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 });
    emit({ op: "blr", rn: 16 });
  };
  const pair = (op: "stp" | "ldp", rt: number, rt2: number) =>
    emit({
      op,
      width: 64,
      rt,
      rt2,
      rn: "sp",
      offset: op === "stp" ? -16 : 16,
      mode: op === "stp" ? "pre" : "post",
    });
  const check = (rn: number, value: number, width: 32 | 64 = 64) => {
    emit({
      op: "sub-imm",
      width,
      rd: "zr",
      rn,
      immediate: value,
      shift: 0,
      setFlags: true,
    });
    branch("fail", { op: "b.cond", condition: "ne" });
  };
  const minusOne = () =>
    emit({
      op: "add-imm",
      width: 64,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
  const mapArgs = (length: number) => {
    imm(0, 0);
    mov(1, length);
    imm(2, 3);
    imm(3, 0x1002);
    imm(4, 65535);
    emit({ op: "movk", width: 64, rd: 4, immediate: 65535, shift: 16 });
    imm(5, 0);
  };
  const errno = () => {
    call("___error");
    emit({ op: "ldr", width: 32, rt: 0, rn: 0, offset: 0 });
    check(0, 22);
  };
  pair("stp", 29, 30);
  pair("stp", 19, 20);
  pair("stp", 21, 22);
  pair("stp", 23, 24);
  call("_getpagesize");
  mov(19, 0);
  branch("fail", { op: "cbz", width: 64, rt: 19 });
  // Exercise MAP_FAILED and capture errno before making another host call.
  imm(20, 0);
  mapArgs(20);
  call("_mmap");
  minusOne();
  branch("fail", { op: "b.cond", condition: "ne" });
  errno();
  emit({
    op: "add-reg",
    width: 64,
    rd: 20,
    rn: 19,
    rm: 19,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  mapArgs(20);
  call("_mmap");
  minusOne();
  branch("fail", { op: "b.cond", condition: "eq" });
  mov(21, 0);
  emit({
    op: "add-reg",
    width: 64,
    rd: 22,
    rn: 21,
    rm: 20,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "sub-imm",
    width: 64,
    rd: 22,
    rn: 22,
    immediate: 8,
    shift: 0,
    setFlags: false,
  });
  emit({ op: "ldr", width: 64, rt: 0, rn: 21, offset: 0 });
  check(0, 0);
  emit({ op: "ldr", width: 64, rt: 0, rn: 22, offset: 0 });
  check(0, 0);
  imm(23, 0x5a5a);
  emit({ op: "str", width: 64, rt: 23, rn: 22, offset: 0 });
  emit({ op: "ldr", width: 64, rt: 0, rn: 22, offset: 0 });
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 0,
    rm: 23,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  branch("fail", { op: "b.cond", condition: "ne" });
  emit({ op: "str", width: 64, rt: 19, rn: 21, offset: 0 });
  emit({ op: "str", width: 64, rt: 23, rn: 21, offset: 8 });
  if (invalidRelease) {
    emit({
      op: "add-imm",
      width: 64,
      rd: 0,
      rn: 21,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    mov(1, 20);
    call("_munmap");
    // munmap returns int; test its low 32 bits.
    emit({
      op: "add-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    branch("fail", { op: "b.cond", condition: "ne" });
    errno();
    emit({ op: "ldr", width: 64, rt: 0, rn: 22, offset: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 0,
      rm: 23,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    branch("fail", { op: "b.cond", condition: "ne" });
  }
  imm(0, 1);
  mov(1, 21);
  imm(2, 16);
  call("_write");
  check(0, 16);
  mov(0, 21);
  mov(1, 20);
  call("_munmap");
  check(0, 0, 32);
  imm(0, 0);
  branch("done");
  labels.set("fail", instructions.length * 4);
  imm(0, 1);
  labels.set("done", instructions.length * 4);
  pair("ldp", 23, 24);
  pair("ldp", 21, 22);
  pair("ldp", 19, 20);
  pair("ldp", 29, 30);
  emit({ op: "ret", rn: 30 });
  const code = new Uint8Array(instructions.length * 4);
  instructions.forEach((i, n) =>
    assert.equal(writeInstruction(code, n * 4, i).ok, true),
  );
  for (const fixup of branches) {
    const targetOffset = labels.get(fixup.target);
    assert.notEqual(targetOffset, undefined);
    assert.equal(
      patchBranch(code, {
        offset: fixup.offset,
        targetOffset: targetOffset!,
        branch: fixup.branch,
      }).ok,
      true,
    );
  }
  return { code, imports, addressFixups };
}
