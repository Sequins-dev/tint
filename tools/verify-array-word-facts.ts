import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { FunctionIR } from "@tint/ir/scalar";
import {
  writeInstruction,
  patchBranch,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

const span = { start: 0, end: 0 },
  functions: FunctionIR[] = [];
for (const type of ["Uint8Array", "Uint16Array", "Uint32Array"] as const)
  for (const index of [0, 1]) {
    const expected =
      index === 1
        ? 0
        : type === "Uint8Array"
          ? 255
          : type === "Uint16Array"
            ? 65535
            : -1;
    functions.push({
      id: functions.length,
      name: type + index,
      exported: true,
      parameters: [0],
      slots: [type],
      returnType: "boolean",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...span },
            { kind: "constant", id: 1, value: index, ...span },
            { kind: "array-read", id: 2, array: 0, index: 1, ...span },
            {
              kind: "unary",
              id: 3,
              operator: "is-integer",
              operand: 2,
              ...span,
            },
            { kind: "optional-value", id: 4, value: 2, ...span },
            {
              kind: "unary",
              id: 5,
              operator: "is-integer",
              operand: 4,
              ...span,
            },
            { kind: "constant", id: 6, value: 0, ...span },
            {
              kind: "binary",
              id: 7,
              operator: "|",
              left: 4,
              right: 6,
              ...span,
            },
            { kind: "constant", id: 8, value: expected, ...span },
            {
              kind: "binary",
              id: 9,
              operator: "===",
              left: 7,
              right: 8,
              ...span,
            },
            { kind: "constant", id: 10, value: index === 0, ...span },
            {
              kind: "binary",
              id: 11,
              operator: "===",
              left: 3,
              right: 10,
              ...span,
            },
            {
              kind: "binary",
              id: 12,
              operator: "===",
              left: 5,
              right: 10,
              ...span,
            },
            {
              kind: "unary",
              id: 13,
              operator: "boolean-number",
              operand: 9,
              ...span,
            },
            {
              kind: "unary",
              id: 14,
              operator: "boolean-number",
              operand: 11,
              ...span,
            },
            {
              kind: "unary",
              id: 15,
              operator: "boolean-number",
              operand: 12,
              ...span,
            },
            {
              kind: "binary",
              id: 16,
              operator: "+",
              left: 13,
              right: 14,
              ...span,
            },
            {
              kind: "binary",
              id: 17,
              operator: "+",
              left: 16,
              right: 15,
              ...span,
            },
            { kind: "constant", id: 18, value: 3, ...span },
            {
              kind: "binary",
              id: 19,
              operator: "===",
              left: 17,
              right: 18,
              ...span,
            },
          ],
          terminator: { kind: "return", value: 19, ...span },
        },
      ],
    });
  }
const native = emitDarwinModule({ functions });
assert.ok(native.ok, JSON.stringify(native));
assert.equal(
  native.value.helpers.some((h) => h.kind === "to-uint32"),
  false,
);
const wrapper: Instruction[] = [],
  calls: { offset: number; target: number }[] = [],
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
const check = (rn: number) => {
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn,
    immediate: 1,
    shift: 0,
    setFlags: true,
  });
  failures.push(wrapper.length * 4);
  emit({ op: "b.cond", condition: "ne", displacement: 0 });
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
  immediate: 160,
  shift: 0,
  setFlags: false,
});
for (let offset = 0; offset < 160; offset += 8)
  emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
for (const fn of functions) {
  imm(
    9,
    fn.slots[0] === "Uint8Array" ? 2 : fn.slots[0] === "Uint16Array" ? 3 : 4,
  );
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 48 });
  imm(9, 1);
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 56 });
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 64 });
  address(9, 80);
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 72 });
  imm(9, 65535);
  emit({ op: "movk", width: 64, rd: 9, immediate: 65535, shift: 16 });
  emit({ op: "str", width: 32, rt: 9, rn: "sp", offset: 80 });
  address(0, 96);
  imm(1, 0);
  imm(2, 0);
  address(3, 0);
  address(4, 48);
  calls.push({ offset: wrapper.length * 4, target: fn.id });
  emit({ op: "bl", displacement: 0 });
  check(0);
  emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 16 });
  check(9);
}
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
const base = wrapper.length * 4,
  code = new Uint8Array(base + native.value.code.length);
code.set(native.value.code, base);
wrapper.forEach((i, n) => assert.ok(writeInstruction(code, n * 4, i).ok));
for (const call of calls)
  assert.ok(
    patchBranch(code, {
      offset: call.offset,
      targetOffset: base + native.value.functions[call.target]!.offset,
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
  identifier: "tint.array-word-facts",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 1048576,
});
assert.ok(image.ok);
const dir = mkdtempSync(join(tmpdir(), "tint-word-facts-"));
try {
  const path = join(dir, "words");
  writeFileSync(path, image.value.bytes, { mode: 0o755 });
  for (let i = 0; i < 2; i++) {
    const result = spawnSync("lldb", ["--batch", "-o", "run", path], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exited with status = 0 /, result.stdout);
  }
  console.log(
    "Verified integer-array word conversions and optional/NaN predicates for present and absent reads twice under LLDB.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
