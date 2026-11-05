import { buildAArch64Executable } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  writeInstruction,
  patchBranch,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";

import { rememberedBarrier } from "@tint/codegen/aarch64/barrier";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const code: Instruction[] = [],
  labels = new Map<string, number>();
const fixups: { offset: number; target: string; branch: Branch }[] = [];
const emit = (instruction: Instruction) => code.push(instruction);
const imm = (rd: number, immediate: number, shift: 0 | 16 = 0) =>
  emit({ op: "movz", width: 64, rd, immediate, shift });
const address = (rd: number, offset: number) =>
  emit({
    op: "add-imm",
    width: 64,
    rd,
    rn: "sp",
    immediate: offset,
    shift: 0,
    setFlags: false,
  });
const branch = (target: string, b: Branch = { op: "b" }) => {
  fixups.push({ offset: code.length * 4, target, branch: b });
  emit({ ...b, displacement: 0 });
};
const equal = (rn: number, expected: number) => {
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn,
    immediate: expected,
    shift: 0,
    setFlags: true,
  });
  branch("fail", { op: "b.cond", condition: "ne" });
};
const set = (offset: number, value: number) => {
  imm(2, value);
  emit({ op: "str", width: 32, rt: 2, rn: "sp", offset });
};
const check = (offset: number, expected: number) => {
  emit({ op: "ldr", width: 32, rt: 2, rn: "sp", offset });
  equal(2, expected);
};
const invoke = (objectOffset: number) => {
  imm(9, 16, 16);
  emit({
    op: objectOffset < 0 ? "sub-imm" : "add-imm",
    width: 64,
    rd: 9,
    rn: 9,
    immediate: Math.abs(objectOffset),
    shift: 0,
    setFlags: false,
  });
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 176 });
  address(10, 0);
  imm(0, 37);
  branch("helper", { op: "bl" });
  equal(0, 37); // Cell status must survive the barrier.
  emit({ op: "ldr", width: 64, rt: 2, rn: "sp", offset: 176 });
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 9,
    rm: 2,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  branch("fail", { op: "b.cond", condition: "ne" });
};
emit({
  op: "stp",
  width: 64,
  rt: 29,
  rt2: 30,
  rn: "sp",
  offset: -16,
  mode: "pre",
});
emit({
  op: "sub-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 256,
  shift: 0,
  setFlags: false,
});
imm(2, 0);
for (let offset = 0; offset < 256; offset += 8)
  emit({ op: "str", width: 64, rt: 2, rn: "sp", offset });
imm(2, 16, 16);
emit({ op: "str", width: 64, rt: 2, rn: "sp", offset: 8 });
invoke(32); // No published state.
address(2, 64);
emit({ op: "str", width: 64, rt: 2, rn: "sp", offset: 56 });
invoke(32); // Published ordinary allocation state.
set(72, 512);
set(76, 256);
set(88, 1);
set(92, 512);
address(2, 128);
emit({ op: "str", width: 64, rt: 2, rn: "sp", offset: 96 });
address(2, 144);
emit({ op: "str", width: 64, rt: 2, rn: "sp", offset: 104 });
set(116, 2);
set(160, 1234);
invoke(512);
invoke(-16);
invoke(256);
check(112, 0);
check(128, 0);
invoke(32);
check(112, 1);
check(128, 4);
const checkFloat = (offset: number, high: number) => {
  check(offset, 0);
  emit({ op: "ldr", width: 32, rt: 2, rn: "sp", offset: offset + 4 });
  imm(3, high, 16);
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 2,
    rm: 3,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  branch("fail", { op: "b.cond", condition: "ne" });
};
checkFloat(144, 0x4040);
invoke(32);
check(112, 1);
invoke(128);
check(112, 2);
check(128, 260);
checkFloat(152, 0x4060);
invoke(64);
check(112, 2);
check(120, 1);
check(128, 276);
check(160, 1234);
invoke(64);
check(112, 2);
check(160, 1234);
// Flip semispaces: queue addresses are relative to the current old prefix.
set(72, 1536);
set(112, 0);
set(120, 0);
set(128, 0);
invoke(32);
check(112, 0);
invoke(1056);
check(112, 1);
check(128, 4);
checkFloat(144, 0x4040);
imm(0, 0);
branch("done");
labels.set("fail", code.length * 4);
imm(0, 1);
labels.set("done", code.length * 4);
emit({
  op: "add-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 256,
  shift: 0,
  setFlags: false,
});
emit({
  op: "ldp",
  width: 64,
  rt: 29,
  rt2: 30,
  rn: "sp",
  offset: 16,
  mode: "post",
});
emit({ op: "ret", rn: 30 });
labels.set("helper", code.length * 4);
code.push(...rememberedBarrier());
const bytes = new Uint8Array(code.length * 4);
code.forEach((instruction, index) =>
  assert.ok(
    writeInstruction(bytes, index * 4, instruction).ok,
    JSON.stringify(instruction),
  ),
);
for (const fixup of fixups) {
  const targetOffset = labels.get(fixup.target);
  assert.notEqual(targetOffset, undefined);
  assert.ok(
    patchBranch(bytes, {
      offset: fixup.offset,
      targetOffset: targetOffset!,
      branch: fixup.branch,
    }).ok,
  );
}
const image = buildAArch64Executable({
  code: bytes,
  entryOffset: 0,
  identifier: "tint.verify.generational-barrier",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 1048576,
});
assert.ok(image.ok);
const directory = mkdtempSync(join(tmpdir(), "tint-barrier-"));
try {
  const path = join(directory, "barrier");
  writeFileSync(path, image.value.bytes, { mode: 0o755 });
  for (let i = 0; i < 2; i++) {
    const run = spawnSync(
      "lldb",
      ["--batch", "-o", "run", "-o", "process status", path],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /exited with status = 0/, run.stdout);
  }
  console.log(
    "Verified native remembered-set deduplication, overflow, generation boundaries, semispace flips and preserved cell status twice under LLDB.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
