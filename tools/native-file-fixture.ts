import type { AArch64AddressReference as AddressReference } from "@tint/codegen/aarch64/image-relocations";
// Verification-only hand-authored machine-code fixture, not a TypeScript lowering pass.
import assert from "node:assert/strict";
import {
  writeInstruction,
  relativeAddress,
  patchBranch,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";
export interface NativeFileFixture {
  code: Uint8Array;
  data: Uint8Array;
  imports: readonly string[];
  addressFixups: readonly AddressReference[];
}
export function nativeFileFixture(setPermissions = true): NativeFileFixture {
  const instructions: Instruction[] = [],
    labels = new Map<string, number>(),
    branches: { offset: number; target: string; branch: Branch }[] = [],
    addressFixups: AddressReference[] = [];
  const imports = [
    "_open",
    "_read",
    "_write",
    "_close",
    "_fchmod",
    "_rename",
    "_unlink",
    "___error",
  ];
  const emit = (i: Instruction) => instructions.push(i);
  const label = (name: string) => {
    assert.equal(labels.has(name), false);
    labels.set(name, instructions.length * 4);
  };
  const branch = (target: string, branch: Branch = { op: "b" }) => {
    branches.push({ offset: instructions.length * 4, target, branch });
    emit({ ...branch, displacement: 0 });
  };
  const imm = (rd: number, value: number) =>
    emit({ op: "movz", width: 32, rd, immediate: value, shift: 0 });
  const mov = (rd: number, rn: number, width: 32 | 64 = 64) =>
    emit({
      op: "add-reg",
      width,
      rd,
      rn: "zr",
      rm: rn,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  const invalid = (rd: number) => {
    imm(rd, 65535);
    emit({ op: "movk", width: 32, rd, immediate: 65535, shift: 16 });
  };
  const load = (rt: number, rn: number, offset = 0, width: 32 | 64 = 64) =>
    emit({ op: "ldr", width, rt, rn, offset });
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
    load(16, 16);
    emit({ op: "blr", rn: 16 });
  };
  const minusOne = (rn: number, width: 32 | 64 = 32) =>
    emit({
      op: "add-imm",
      width,
      rd: "zr",
      rn,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
  const failed = (target = "capture", width: 32 | 64 = 32) => {
    minusOne(0, width);
    branch(target, { op: "b.cond", condition: "eq" });
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
  pair("stp", 29, 30);
  emit({
    op: "add-imm",
    width: 64,
    rd: 29,
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
  for (const r of [19, 21, 23, 25]) pair("stp", r, r + 1);
  emit({
    op: "sub-imm",
    width: 64,
    rd: "sp",
    rn: "sp",
    immediate: 16,
    shift: 0,
    setFlags: false,
  });
  mov(19, 1);
  invalid(20);
  invalid(21);
  imm(22, 0);
  imm(26, 0);
  emit({
    op: "sub-imm",
    width: 32,
    rd: "zr",
    rn: 0,
    immediate: 4,
    shift: 0,
    setFlags: true,
  });
  branch("bad-args", { op: "b.cond", condition: "ne" });
  addressFixups.push({
    offset: instructions.length * 4,
    rd: 23,
    scratch: 17,
    target: { kind: "data", offset: 0 },
  });
  const pointer = relativeAddress(23, 17, 0);
  assert.ok(pointer.ok);
  pointer.value.forEach(emit);
  load(0, 19, 8);
  imm(1, 0);
  call("_open");
  failed();
  mov(20, 0, 32);
  load(0, 19, 16);
  imm(1, 0xa01);
  imm(9, 0o600);
  // Darwin's variadic open mode belongs on the stack, not in x2.
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 0 });
  call("_open");
  failed();
  mov(21, 0, 32);
  imm(26, 1);
  label("read");
  mov(0, 20, 32);
  mov(1, 23);
  imm(2, 7);
  call("_read");
  failed("read-error", 64);
  branch("finish", { op: "cbz", width: 64, rt: 0 });
  mov(24, 0);
  mov(25, 23);
  label("write");
  mov(0, 21, 32);
  mov(1, 25);
  mov(2, 24);
  call("_write");
  failed("write-error", 64);
  branch("stalled", { op: "cbz", width: 64, rt: 0 });
  emit({
    op: "add-reg",
    width: 64,
    rd: 25,
    rn: 25,
    rm: 0,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "sub-reg",
    width: 64,
    rd: 24,
    rn: 24,
    rm: 0,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  branch("write", { op: "cbnz", width: 64, rt: 24 });
  branch("read");
  label("finish");
  if (setPermissions) {
    mov(0, 21, 32);
    imm(1, 0o755);
    call("_fchmod");
    failed();
  }
  mov(0, 20, 32);
  invalid(20);
  call("_close");
  failed();
  mov(0, 21, 32);
  invalid(21);
  call("_close");
  failed();
  load(0, 19, 16);
  load(1, 19, 24);
  call("_rename");
  failed();
  imm(26, 0);
  branch("cleanup");
  for (const operation of ["read", "write"]) {
    label(operation + "-error");
    call("___error");
    load(22, 0, 0, 32);
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 22,
      immediate: 4,
      shift: 0,
      setFlags: true,
    });
    branch("cleanup", { op: "b.cond", condition: "ne" });
    imm(22, 0);
    branch(operation);
  }
  label("stalled");
  imm(22, 5);
  branch("cleanup");
  label("bad-args");
  imm(22, 64);
  branch("cleanup");
  label("capture");
  call("___error");
  load(22, 0, 0, 32);
  label("cleanup");
  minusOne(20);
  branch("close-output", { op: "b.cond", condition: "eq" });
  mov(0, 20, 32);
  invalid(20);
  call("_close");
  label("close-output");
  minusOne(21);
  branch("remove", { op: "b.cond", condition: "eq" });
  mov(0, 21, 32);
  invalid(21);
  call("_close");
  label("remove");
  branch("return", { op: "cbz", width: 32, rt: 26 });
  load(0, 19, 16);
  call("_unlink");
  label("return");
  mov(0, 22, 32);
  emit({
    op: "add-imm",
    width: 64,
    rd: "sp",
    rn: "sp",
    immediate: 16,
    shift: 0,
    setFlags: false,
  });
  for (const r of [25, 23, 21, 19]) pair("ldp", r, r + 1);
  pair("ldp", 29, 30);
  emit({ op: "ret", rn: 30 });
  const code = new Uint8Array(instructions.length * 4);
  instructions.forEach((instruction, index) =>
    assert.equal(writeInstruction(code, index * 4, instruction).ok, true),
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
  return { code, data: new Uint8Array(16), imports, addressFixups };
}
