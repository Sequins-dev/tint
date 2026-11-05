import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  writeInstruction,
  patchBranch,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";

const s = { start: 0, end: 0 };
const native = emitDarwinModule({
  functions: [
    {
      id: 0,
      name: "read",
      exported: true,
      parameters: [0],
      slots: ["number"],
      returnType: "number",
      entry: 0,
      environment: {
        byteLength: 24,
        cells: [
          { type: "number", stateOffset: 0, valueOffset: 8, mutable: true },
        ],
      },
      blocks: [
        {
          id: 0,
          instructions: [],
          terminator: {
            kind: "cell",
            operation: "read",
            cell: 0,
            slot: 0,
            consequent: 1,
            alternate: 2,
            ...s,
          },
        },
        {
          id: 1,
          instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
          terminator: { kind: "return", value: 0, ...s },
        },
        {
          id: 2,
          instructions: [{ kind: "load", id: 1, slot: 0, ...s }],
          terminator: { kind: "return", value: 1, ...s },
        },
      ],
    },
  ],
});
assert.ok(native.ok, JSON.stringify(native));
assert.equal(native.value.cellHelpers.length, 0);
const instructions: Instruction[] = [],
  labels = new Map<string, number>();
const fixups: { offset: number; target: string; branch: Branch }[] = [];
const emit = (op: Instruction) => instructions.push(op);
function imm(rd: number, value: bigint): void {
  for (const shift of [0, 16, 32, 48] as const)
    emit({
      op: shift === 0 ? "movz" : "movk",
      width: 64,
      rd,
      immediate: Number((value >> BigInt(shift)) & 65535n),
      shift,
    });
}
function bits(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return view.getBigUint64(0, true);
}
function branch(target: string, op: Branch = { op: "b" }): void {
  fixups.push({ offset: instructions.length * 4, target, branch: op });
  emit({ ...op, displacement: 0 });
}
function address(rd: number, offset: number): void {
  emit({
    op: "add-imm",
    width: 64,
    rd,
    rn: "sp",
    immediate: offset,
    shift: 0,
    setFlags: false,
  });
}
function check(offset: number, value: bigint): void {
  emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset });
  imm(10, value);
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 9,
    rm: 10,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  branch("fail", { op: "b.cond", condition: "ne" });
}
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
  immediate: 128,
  shift: 0,
  setFlags: false,
});
for (const state of [0, 1, 2, 255]) {
  for (let offset = 0; offset < 128; offset += 8)
    emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
  imm(9, BigInt(state));
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 64 });
  imm(9, bits(42));
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 72 });
  imm(9, bits(99));
  emit({ op: "fmov-d-x", rd: 0, rn: 9 });
  imm(0, 0n);
  address(1, 64);
  imm(2, 0n);
  address(3, 0);
  branch("native", { op: "bl" });
  check(0, 1n);
  check(16, bits(state === 1 ? 42 : 99));
  check(64, BigInt(state));
  check(72, bits(42));
}
imm(0, 0n);
branch("done");
labels.set("fail", instructions.length * 4);
imm(0, 1n);
labels.set("done", instructions.length * 4);
emit({
  op: "add-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 128,
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
const base = instructions.length * 4,
  code = new Uint8Array(base + native.value.code.length);
labels.set("native", base + native.value.functions[0]!.offset);
instructions.forEach((op, index) =>
  assert.ok(writeInstruction(code, index * 4, op).ok),
);
code.set(native.value.code, base);
for (const fixup of fixups)
  assert.ok(
    patchBranch(code, {
      offset: fixup.offset,
      targetOffset: labels.get(fixup.target)!,
      branch: fixup.branch,
    }).ok,
  );
const image = buildAArch64Executable({
  code,
  entryOffset: 0,
  identifier: "tint.verify.inline-cells",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 1048576,
});
assert.ok(image.ok);
const directory = mkdtempSync(join(tmpdir(), "tint-inline-cells-")),
  path = join(directory, "cells");
writeFileSync(path, image.value.bytes, { mode: 0o755 });
for (let i = 0; i < 2; i++) {
  const run = spawnSync("/usr/bin/lldb", ["--batch", "-o", "run", path], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /exited with status = 0/);
}
console.log(
  "Verified inline cell reads for states 0, 1, 2 and 255, preserving the destination on failure and the source in every case, twice under LLDB.",
);
