import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  writeInstruction,
  relativeAddress,
  patchRelativeAddress,
  patchBranch,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

const span = { start: 0, end: 1 };
const emitted = emitDarwinModule({
  records: [
    { byteLength: 16, fields: [] },
    { byteLength: 32, fields: [] },
  ],
  functions: [
    {
      id: 0,
      name: "matches",
      exported: true,
      parameters: [0],
      slots: ["general"],
      returnType: "boolean",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...span },
            { kind: "general-record-is", id: 1, value: 0, record: 0, ...span },
          ],
          terminator: { kind: "return", value: 1, ...span },
        },
      ],
    },
  ],
});
assert.ok(emitted.ok, JSON.stringify(emitted));
const native = emitted.value;
const ops: Instruction[] = [],
  calls: number[] = [],
  failures: number[] = [];
const addresses: { offset: number; record: number }[] = [];
const emit = (op: Instruction) => ops.push(op);
const imm = (rd: number, immediate: number) =>
  emit({ op: "movz", width: 64, rd, immediate, shift: 0 });
const pointer = (rd: number, immediate: number) =>
  emit({
    op: "add-imm",
    width: 64,
    rd,
    rn: "sp",
    immediate,
    shift: 0,
    setFlags: false,
  });
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
  immediate: 160,
  shift: 0,
  setFlags: false,
});
for (let offset = 0; offset < 160; offset += 8)
  emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
// General input at 64; fake managed header at 80; result storage at 112.
// Non-object payload 1 would fault if the predicate dereferenced it.
const cases = [
  ...[0, 1, 2, 3, 4, 6, 7].map((tag) => ({ tag, record: -1, expected: 0 })),
  { tag: 5, record: -1, expected: 0 },
  { tag: 5, record: 0, expected: 1 },
  { tag: 5, record: 1, expected: 0 },
];
for (const test of cases) {
  imm(9, test.tag);
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 64 });
  if (test.record < 0) imm(9, test.tag === 5 ? 0 : 1);
  else {
    addresses.push({ offset: ops.length * 4, record: test.record });
    const address = relativeAddress(9, 17, 0);
    assert.ok(address.ok);
    ops.push(...address.value);
    emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 80 });
    pointer(9, 80);
  }
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 72 });
  pointer(0, 0);
  imm(1, 0);
  imm(2, 0);
  pointer(3, 112);
  pointer(4, 64);
  calls.push(ops.length * 4);
  emit({ op: "bl", displacement: 0 });
  // Native return records contain a status header and payload at byte 16.
  emit({ op: "ldr", width: 32, rt: 9, rn: "sp", offset: 128 });
  emit({
    op: "sub-imm",
    width: 32,
    rd: "zr",
    rn: 9,
    immediate: test.expected,
    shift: 0,
    setFlags: true,
  });
  failures.push(ops.length * 4);
  emit({ op: "b.cond", condition: "ne", displacement: 0 });
}
imm(0, 42);
const done = ops.length * 4;
emit({ op: "b", displacement: 0 });
const failure = ops.length * 4;
imm(0, 1);
const end = ops.length * 4;
emit({
  op: "add-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 160,
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
const base = ops.length * 4,
  code = new Uint8Array(base + native.code.length);
ops.forEach((op, i) => assert.ok(writeInstruction(code, i * 4, op).ok));
code.set(native.code, base);
for (const offset of calls)
  assert.ok(
    patchBranch(code, {
      offset,
      targetOffset: base + native.functions[0]!.offset,
      branch: { op: "bl" },
    }).ok,
  );
for (const offset of failures)
  assert.ok(
    patchBranch(code, {
      offset,
      targetOffset: failure,
      branch: { op: "b.cond", condition: "ne" },
    }).ok,
  );
assert.ok(
  patchBranch(code, { offset: done, targetOffset: end, branch: { op: "b" } })
    .ok,
);
for (const fixup of addresses)
  assert.ok(
    patchRelativeAddress(code, {
      offset: fixup.offset,
      targetOffset: base + native.records[fixup.record]!.offset,
      rd: 9,
      scratch: 17,
    }).ok,
  );
const image = buildAArch64Executable({
  code,
  entryOffset: 0,
  imports: [],
  addressFixups: [],
  identifier: "tint.general-record",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 67108864,
});
assert.ok(image.ok, JSON.stringify(image));
const path = join(
  mkdtempSync(join(tmpdir(), "tint-general-record-")),
  "fixture",
);
writeFileSync(path, image.value.bytes, { mode: 0o755 });
console.log(path);
if (process.env.TINT_BUILD_ONLY !== "1") {
  const run = spawnSync(
    "lldb",
    ["--batch", "-o", "process launch --stop-at-entry", "-o", "continue", path],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /exited with status = 42 /);
}
