import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bindHostOperations, type ModuleIR } from "@tint/ir/scalar";

import {
  writeInstruction,
  patchBranch,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";

const module: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "move",
      exported: true,
      parameters: [0, 1, 2, 3, 4],
      slots: ["number", "number", "number", "number", "number"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 0, start: 0, end: 0 },
          ],
          terminator: { kind: "return", value: 0, start: 0, end: 0 },
        },
      ],
    },
  ],
};
const bound = bindHostOperations(module, [
  { function: 0, operation: "memory-move" },
]);
assert.ok(bound.ok, JSON.stringify(bound));
const native = emitDarwinModule(bound.value);
assert.ok(native.ok, JSON.stringify(native));
const instructions: Instruction[] = [],
  fixups: { offset: number; target: string; branch: Branch }[] = [],
  labels = new Map<string, number>();
const emit = (i: Instruction) => instructions.push(i);
function imm(rd: number, value: bigint) {
  for (const shift of [0, 16, 32, 48] as const)
    emit({
      op: shift === 0 ? "movz" : "movk",
      width: 64,
      rd,
      immediate: Number((value >> BigInt(shift)) & 65535n),
      shift,
    });
}
function branch(target: string, b: Branch = { op: "b" }) {
  fixups.push({ offset: instructions.length * 4, target, branch: b });
  emit({ ...b, displacement: 0 });
}
function bits(value: number) {
  const b = new ArrayBuffer(8),
    v = new DataView(b);
  v.setFloat64(0, value, true);
  return v.getBigUint64(0, true);
}
function compare(rt: number, expected: bigint) {
  imm(10, expected);
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: rt,
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
  immediate: 256,
  shift: 0,
  setFlags: false,
});
const original = Uint8Array.from(
    { length: 128 },
    (_, i) => (i * 73 + 19) % 256,
  ),
  raw = new DataView(original.buffer);
raw.setBigUint64(0, 0x7ff0000000000001n, true);
raw.setBigUint64(8, 0xfff8000000000001n, true);
raw.setBigUint64(16, 0xffffffffffffffffn, true);
type Case = {
  length: number;
  destination: number;
  source: number;
  count: number;
  base?: number;
  valid: boolean;
};
const cases: Case[] = [];
for (const count of [0, 1, 7, 8, 9, 15, 16, 17, 63, 64])
  for (const [destination, source] of [
    [0, 1],
    [1, 0],
    [7, 8],
    [8, 7],
    [0, 64],
    [64, 0],
    [16, 16],
  ])
    cases.push({
      length: 128,
      destination: destination!,
      source: source!,
      count,
      valid: true,
    });
for (const key of ["length", "destination", "source", "count"] as const)
  for (const value of [-1, 0.5, NaN, Infinity])
    cases.push({
      ...{ length: 128, destination: 16, source: 0, count: 16, valid: false },
      [key]: value,
    });
cases.push(
  { length: 128, destination: 120, source: 0, count: 9, valid: false },
  { length: 128, destination: 0, source: 120, count: 9, valid: false },
  { length: 128, destination: 129, source: 0, count: 0, valid: false },
  { length: 0, destination: 0, source: 0, count: 0, valid: true },
  { length: 128, destination: 128, source: 128, count: 0, valid: true },
  { length: 128, destination: 0, source: 0, count: 1, base: 0, valid: false },
  {
    length: 128,
    destination: 0,
    source: 0,
    count: 1,
    base: Number.MAX_SAFE_INTEGER - 7,
    valid: false,
  },
);
for (const c of cases) {
  for (let i = 0; i < 128; i += 8) {
    imm(9, raw.getBigUint64(i, true));
    emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 64 + i });
  }
  if (c.base === undefined)
    emit({
      op: "add-imm",
      width: 64,
      rd: 9,
      rn: "sp",
      immediate: 64,
      shift: 0,
      setFlags: false,
    });
  else imm(9, BigInt(c.base));
  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
  for (const [index, value] of [
    c.length,
    c.destination,
    c.source,
    c.count,
  ].entries()) {
    imm(9, bits(value));
    emit({ op: "fmov-d-x", rd: index + 1, rn: 9 });
  }
  imm(0, 0n);
  imm(1, 0n);
  imm(2, 0n);
  emit({
    op: "add-imm",
    width: 64,
    rd: 3,
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
  branch("move", { op: "bl" });
  compare(0, 1n);
  emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 16 });
  compare(9, bits(c.valid ? 0 : -1));
  const expected = original.slice();
  if (c.valid) expected.copyWithin(c.destination, c.source, c.source + c.count);
  const view = new DataView(expected.buffer);
  for (let i = 0; i < 128; i += 8) {
    emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 + i });
    compare(9, view.getBigUint64(i, true));
  }
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
const base = instructions.length * 4,
  code = new Uint8Array(base + native.value.code.length);
labels.set("move", base + native.value.functions[0]!.offset);
for (const [i, instruction] of instructions.entries())
  assert.ok(writeInstruction(code, i * 4, instruction).ok);
code.set(native.value.code, base);
for (const f of fixups)
  assert.ok(
    patchBranch(code, {
      offset: f.offset,
      targetOffset: labels.get(f.target)!,
      branch: f.branch,
    }).ok,
  );
const image = buildAArch64Executable({
  code,
  entryOffset: 0,
  identifier: "tint.verify.memory-move",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 1048576,
});
assert.ok(image.ok, JSON.stringify(image));
const path = join(mkdtempSync(join(tmpdir(), "tint-memory-move-")), "move");
writeFileSync(path, image.value.bytes, { mode: 0o755 });
console.log(path);
for (let i = 0; i < 2; i++) {
  const result = spawnSync("lldb", ["--batch", "-o", "run", path], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /exited with status = 0 /);
}
console.log(
  `Verified ${cases.length} native moves twice, including overlapping raw NaN payloads and bounds failures.`,
);
