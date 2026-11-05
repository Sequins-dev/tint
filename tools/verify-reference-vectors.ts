import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  writeInstruction,
  patchBranch,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

const s = { start: 0, end: 0 };
const invalidWrite = process.env.TINT_VECTOR_INVALID_WRITE === "1";
const emitted = emitDarwinModule(
  {
    records: [{ byteLength: 16, fields: [] }],
    functions: [
      {
        id: 0,
        name: "vectors",
        exported: true,
        parameters: [0],
        slots: ["reference", "optional-reference", "boolean", "boolean"],
        returnType: "optional-reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "constant", id: 1, value: 3, ...s },
              { kind: "reference-vector-new", id: 2, length: 1, ...s },
              { kind: "reference-wrap", id: 3, value: 2, ...s },
              { kind: "constant", id: 4, value: invalidWrite ? 3 : 0, ...s },
              {
                kind: "reference-vector-write",
                vector: 2,
                index: 4,
                value: 3,
                ...s,
              },
              {
                kind: "reference-vector-write",
                vector: 0,
                index: 4,
                value: 3,
                ...s,
              },
              {
                kind: "reference-vector-read",
                id: 5,
                vector: 2,
                index: 1,
                ...s,
              },
              { kind: "constant", id: 6, value: 1, ...s },
              {
                kind: "reference-vector-write",
                vector: 0,
                index: 6,
                value: 5,
                ...s,
              },
              { kind: "reference-vector-length", id: 7, vector: 2, ...s },
              {
                kind: "reference-vector-read",
                id: 8,
                vector: 2,
                index: 4,
                ...s,
              },
              { kind: "store", slot: 1, value: 8, ...s },
              { kind: "record-new", id: 9, record: 0, arguments: [], ...s },
              { kind: "reference-wrap", id: 10, value: 9, ...s },
              { kind: "reference-vector-is", id: 11, vector: 10, ...s },
              { kind: "reference-none", id: 12, ...s },
              { kind: "reference-vector-is", id: 13, vector: 12, ...s },
              { kind: "reference-vector-is", id: 14, vector: 3, ...s },
              { kind: "store", slot: 2, value: 11, ...s },
              { kind: "store", slot: 3, value: 13, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 14,
              consequent: 1,
              alternate: 4,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 15, slot: 2, ...s }],
            terminator: {
              kind: "branch",
              condition: 15,
              consequent: 4,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 16, slot: 3, ...s }],
            terminator: {
              kind: "branch",
              condition: 16,
              consequent: 4,
              alternate: 3,
              ...s,
            },
          },
          {
            id: 3,
            instructions: [{ kind: "load", id: 17, slot: 1, ...s }],
            terminator: { kind: "return", value: 17, ...s },
          },
          {
            id: 4,
            instructions: [],
            terminator: { kind: "trap", ...s },
          },
        ],
      },
    ],
  },
  {
    maxByteLength: 1048576,
    debugSpans: false,
    linearAllocation: true,
    generationalBarriers: true,
  },
);
assert.ok(emitted.ok, JSON.stringify(emitted));
assert.ok(emitted.value.helpers.some((h) => h.kind === "remember-object"));
const wrapper: Instruction[] = [],
  failures: number[] = [];
const emit = (i: Instruction) => wrapper.push(i);
const imm = (rd: number, immediate: number) =>
  emit({ op: "movz", width: 64, rd, immediate, shift: 0 });
const address = (rd: number, immediate: number) =>
  emit({
    op: "add-imm",
    width: 64,
    rd,
    rn: "sp",
    immediate,
    shift: 0,
    setFlags: false,
  });
const set = (offset: number, value: number, width: 32 | 64 = 64) => {
  imm(9, value);
  emit({ op: "str", width, rt: 9, rn: "sp", offset });
};
const pointer = (offset: number, target: number) => {
  address(9, target);
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset });
};
const compare = (rn: number, rm: number) => {
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
  failures.push(wrapper.length * 4);
  emit({ op: "b.cond", condition: "ne", displacement: 0 });
};
const check = (offset: number, expected: number, width: 32 | 64 = 64) => {
  emit({ op: "ldr", width, rt: 9, rn: "sp", offset });
  imm(10, expected);
  compare(9, 10);
};
const checkPointer = (offset: number, target: number) => {
  emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset });
  address(10, target);
  compare(9, 10);
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
  immediate: 1024,
  shift: 0,
  setFlags: false,
});
for (let offset = 0; offset < 1024; offset += 8)
  emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
pointer(40, 256);
pointer(88, 96);
set(100, 256, 32);
set(104, 256, 32);
set(108, 64, 32);
pointer(112, 160);
set(120, 1, 32);
set(124, 256, 32);
pointer(128, 168);
pointer(136, 176);
set(148, 2, 32);
set(256, 6);
set(272, 2);
pointer(296, 256);
address(0, 32);
imm(1, 0);
imm(2, 0);
address(3, 0);
address(4, 256);
const call = wrapper.length * 4;
emit({ op: "bl", displacement: 0 });
imm(10, 1);
compare(0, 10);
checkPointer(16, 512);
checkPointer(288, 512);
check(296, 0);
check(512, 6);
check(520, 0);
check(528, 3);
check(536, 0);
checkPointer(544, 512);
check(552, 0);
check(560, 0);
check(568, 0);
check(32, 0);
check(96, 80, 32);
check(160, 17, 32);
check(168, 1);
check(144, 1, 32);
check(176, 0);
imm(0, 0);
const done = wrapper.length * 4;
emit({ op: "b", displacement: 0 });
const failure = wrapper.length * 4;
imm(0, 1);
const end = wrapper.length * 4;
emit({
  op: "add-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 1024,
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
const base = wrapper.length * 4,
  code = new Uint8Array(base + emitted.value.code.length);
wrapper.forEach((i, n) =>
  assert.ok(writeInstruction(code, n * 4, i).ok, JSON.stringify(i)),
);
code.set(emitted.value.code, base);
assert.ok(
  patchBranch(code, {
    offset: call,
    targetOffset: base + emitted.value.functions[0]!.offset,
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
const image = buildAArch64Executable({
  code,
  entryOffset: 0,
  identifier: "tint.reference-vectors",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 1048576,
});
assert.ok(image.ok);
const dir = mkdtempSync(join(tmpdir(), "tint-reference-vectors-"));
try {
  const path = join(dir, "vectors");
  writeFileSync(path, image.value.bytes, { mode: 0o755 });
  for (let i = 0; i < 2; i++) {
    const run = spawnSync("lldb", ["--batch", "-o", "run", path], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      invalidWrite ? /EXC_BREAKPOINT/ : /exited with status = 0 /,
      run.stdout,
    );
  }
  console.log(
    invalidWrite
      ? "Verified out-of-bounds reference-vector writes trap twice under LLDB."
      : "Verified native reference-vector allocation, zeroing, self-reference, vector/record/null discrimination, bounds reads, old-to-young remembering and root restoration twice under LLDB.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
