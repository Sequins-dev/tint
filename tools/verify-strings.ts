import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
// Native UTF-16 value gate. Stack strings model distinct immutable external values.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { FunctionIR, Instruction as IRInstruction } from "@tint/ir/scalar";
import {
  writeInstruction,
  patchBranch,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const span = { start: 0, end: 0 };
interface Case {
  left: string;
  right: string;
  index: number;
  kind:
    "unit" | "length" | "equal" | "different" | "truthy" | "literal" | "prefix";
  expected: number | boolean;
}
const cases: Case[] = [];
for (const left of ["", "A\u0000\ud800", "a😀z"]) {
  cases.push(
    { left, right: "", index: 0, kind: "length", expected: left.length },
    { left, right: "", index: 0, kind: "truthy", expected: !!left },
    { left, right: "", index: 0, kind: "literal", expected: true },
  );
  for (const index of [
    NaN,
    -Infinity,
    Infinity,
    -1,
    -0.5,
    -0,
    0,
    0.9,
    1,
    1.9,
    2,
    3,
    4,
    0x80000000,
  ])
    cases.push({
      left,
      right: "",
      index,
      kind: "unit",
      expected: left.charCodeAt(index),
    });
  for (const right of ["", left, left + "x", "A\u0000\ud801", "a😀y"])
    for (const kind of ["equal", "different"] as const)
      cases.push({
        left,
        right,
        index: 0,
        kind,
        expected: kind === "equal" ? left === right : left !== right,
      });
}
for (const left of ["", "A\u0000\ud800", "a😀z"])
  for (const right of [
    "",
    left,
    left + "x",
    "A",
    "\u0000",
    "\ud800",
    "😀",
    "\ud83d",
    "\ude00",
    "z",
  ])
    for (const index of [
      NaN,
      -Infinity,
      Infinity,
      -100,
      -1,
      -0.5,
      -0,
      0,
      0.9,
      1,
      1.9,
      2,
      3,
      4,
      0x80000000,
    ])
      cases.push({
        left,
        right,
        index,
        kind: "prefix",
        expected: left.startsWith(right, index),
      });
const functions: FunctionIR[] = cases.map((c, id) => {
  const instructions: IRInstruction[] = [
    { kind: "load", id: 0, slot: 0, ...span },
    { kind: "load", id: 1, slot: 1, ...span },
    { kind: "load", id: 2, slot: 2, ...span },
  ];
  if (c.kind === "unit")
    instructions.push({
      kind: "string-code-unit",
      id: 3,
      string: 0,
      index: 2,
      ...span,
    });
  else if (c.kind === "prefix")
    instructions.push({
      kind: "string-starts-with",
      id: 3,
      string: 0,
      search: 1,
      position: 2,
      ...span,
    });
  else if (c.kind === "length")
    instructions.push({ kind: "string-length", id: 3, string: 0, ...span });
  else if (c.kind === "truthy")
    instructions.push({
      kind: "unary",
      id: 3,
      operator: "truthy",
      operand: 0,
      ...span,
    });
  else if (c.kind === "literal") {
    instructions.push(
      { kind: "string-literal", id: 4, value: c.left, ...span },
      { kind: "binary", id: 3, operator: "===", left: 0, right: 4, ...span },
    );
  } else
    instructions.push({
      kind: "binary",
      id: 3,
      operator: c.kind === "equal" ? "===" : "!==",
      left: 0,
      right: 1,
      ...span,
    });
  return {
    id,
    name: "case" + id,
    exported: true,
    parameters: [0, 1, 2],
    slots: ["string", "string", "number"],
    returnType: typeof c.expected === "number" ? "number" : "boolean",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: 3, ...span },
      },
    ],
  };
});
const native = emitDarwinModule({ functions });
assert.ok(native.ok, JSON.stringify(native));
const code: Instruction[] = [],
  calls: { offset: number; function: number }[] = [];
function emit(i: Instruction) {
  code.push(i);
}
function imm(rd: number, n: bigint) {
  for (const shift of [0, 16, 32, 48] as const)
    emit({
      op: shift === 0 ? "movz" : "movk",
      width: 64,
      rd,
      immediate: Number((n >> BigInt(shift)) & 65535n),
      shift,
    });
}
function address(rd: number, offset: number) {
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
function store(offset: number, n: bigint) {
  imm(9, n);
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset });
}
function bits(n: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n, true);
  return view.getBigUint64(0, true);
}
function check(offset: number, n: bigint) {
  emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset });
  imm(10, n);
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
  emit({ op: "b.cond", condition: "eq", displacement: 8 });
  emit({ op: "brk", immediate: 7 });
}
function string(offset: number, value: string) {
  store(offset, 1n);
  store(offset + 8, 1n);
  store(offset + 16, BigInt(value.length));
  for (let i = 0; i < value.length; i++) {
    imm(9, BigInt(value.charCodeAt(i)));
    emit({ op: "strh", rt: 9, rn: "sp", offset: offset + 24 + i * 2 });
  }
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
  immediate: 512,
  shift: 0,
  setFlags: false,
});
for (let offset = 0; offset < 512; offset += 8)
  emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
for (let i = 0; i < cases.length; i++) {
  const c = cases[i]!;
  string(128, c.left);
  string(256, c.right);
  address(0, 64);
  imm(1, 0n);
  imm(2, 0n);
  address(3, 0);
  address(4, 128);
  address(5, 256);
  imm(9, bits(c.index));
  emit({ op: "fmov-d-x", rd: 0, rn: 9 });
  calls.push({ offset: code.length * 4, function: i });
  emit({ op: "bl", displacement: 0 });
  check(0, 1n);
  check(
    16,
    typeof c.expected === "number" ? bits(c.expected) : c.expected ? 1n : 0n,
  );
  check(64, 0n);
}
imm(0, 0n);
emit({
  op: "add-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 512,
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
const base = code.length * 4,
  bytes = new Uint8Array(base + native.value.code.length);
code.forEach((instruction, i) =>
  assert.ok(writeInstruction(bytes, i * 4, instruction).ok),
);
bytes.set(native.value.code, base);
for (const call of calls)
  assert.ok(
    patchBranch(bytes, {
      offset: call.offset,
      targetOffset: base + native.value.functions[call.function]!.offset,
      branch: { op: "bl" },
    }).ok,
  );
const built = buildAArch64Executable({
  code: bytes,
  entryOffset: 0,
  identifier: "tint.verify.strings",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 1048576,
});
assert.ok(built.ok, JSON.stringify(built));
const directory = mkdtempSync(join(tmpdir(), "tint-strings-"));
try {
  const path = join(directory, "strings");
  writeFileSync(path, built.value.bytes, { mode: 0o755 });
  const signature = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--strict", path],
    { encoding: "utf8" },
  );
  assert.equal(signature.status, 0, signature.stderr);
  for (let i = 0; i < 2; i++) {
    const run = spawnSync(path, [], { timeout: 10000 });
    assert.equal(run.error, undefined);
    assert.equal(run.signal, null);
    assert.equal(run.status, 0);
  }
  console.log(
    `Verified ${cases.length} native UTF-16 cases twice: lengths, truthiness, prefix tests, content equality across distinct objects, literal pools, NUL/lone surrogates, index conversion and out-of-bounds NaN; root chains restored.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
