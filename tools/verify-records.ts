import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
// Native record-access gate. The adapter owns object storage; no allocator is claimed.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  writeInstruction,
  patchBranch,
  patchAddress,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

import type { FunctionIR, RecordField } from "@tint/ir/scalar";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-records-")),
  s = { start: 0, end: 0 };
try {
  const fields: RecordField[] = [
    { offset: 16, type: "number", mutable: true },
    { offset: 24, type: "reference", mutable: true },
    { offset: 32, type: "boolean", mutable: true },
  ];
  const functions: FunctionIR[] = [];
  for (const field of [0, 1, 2])
    for (const operation of ["read", "write"] as const) {
      const type = fields[field]!.type,
        id = functions.length,
        write = operation === "write";
      functions.push({
        id,
        name: operation + field,
        exported: true,
        parameters: write ? [0, 1] : [0],
        slots: ["reference", type],
        returnType: write ? "boolean" : type,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field,
              operation,
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              write
                ? { kind: "constant", id: 1, value: true, ...s }
                : { kind: "load", id: 1, slot: 1, ...s },
            ],
            terminator: { kind: "return", value: 1, ...s },
          },
          {
            id: 2,
            instructions: [
              write || type === "boolean"
                ? { kind: "constant", id: 2, value: false, ...s }
                : type === "number"
                  ? { kind: "constant", id: 2, value: -1, ...s }
                  : { kind: "load", id: 2, slot: 0, ...s },
            ],
            terminator: { kind: "return", value: 2, ...s },
          },
        ],
      });
    }
  const native = emitDarwinModule({
    records: [
      { byteLength: 48, fields },
      { byteLength: 48, fields: [] },
    ],
    functions,
  });
  assert.ok(native.ok, JSON.stringify(native));
  assert.deepEqual(native.value.records[0]?.referenceOffsets, [24]);
  const data = new DataView(
    native.value.code.buffer,
    native.value.code.byteOffset,
    native.value.code.byteLength,
  );
  assert.equal(data.getBigUint64(native.value.records[0]!.offset, true), 48n);
  assert.equal(
    data.getBigUint64(native.value.records[0]!.offset + 8, true),
    1n,
  );
  assert.equal(
    data.getBigUint64(native.value.records[0]!.offset + 16, true),
    24n,
  );
  const instructions: Instruction[] = [],
    calls: { offset: number; function: number }[] = [],
    addresses: { offset: number; record: number }[] = [];
  const emit = (i: Instruction) => instructions.push(i);
  const imm = (rd: number, value: bigint) => {
    for (const shift of [0, 16, 32, 48] as const)
      emit({
        op: shift === 0 ? "movz" : "movk",
        width: 64,
        rd,
        immediate: Number((value >> BigInt(shift)) & 65535n),
        shift,
      });
  };
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
  const equal = (a: number, b: number) => {
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: a,
      rm: b,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    emit({ op: "b.cond", condition: "eq", displacement: 8 });
    emit({ op: "brk", immediate: 2 });
  };
  const check = (offset: number, bits: bigint) => {
    emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset });
    imm(10, bits);
    equal(9, 10);
  };
  const descriptor = (record: number) => {
    addresses.push({ offset: instructions.length * 4, record });
    emit({ op: "adr", rd: 9, displacement: 0 });
    emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 96 });
  };
  function invoke(
    id: number,
    object: number | undefined,
    arg?: bigint | "child",
    expected?: bigint | "child" | "object",
  ) {
    address(0, 64);
    imm(1, 0n);
    imm(2, 0n);
    address(3, 0);
    if (object === undefined) imm(4, 0n);
    else address(4, object);
    if (arg === "child") address(5, 160);
    else if (arg !== undefined) {
      if (id === 1) {
        imm(9, arg);
        emit({ op: "fmov-d-x", rd: 0, rn: 9 });
      } else imm(5, arg);
    }
    calls.push({ offset: instructions.length * 4, function: id });
    emit({ op: "bl", displacement: 0 });
    check(0, 1n);
    check(64, 0n);
    if (typeof expected === "bigint") check(16, expected);
    else if (expected !== undefined) {
      emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 16 });
      address(10, expected === "child" ? 160 : 96);
      equal(9, 10);
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
    immediate: 224,
    shift: 0,
    setFlags: false,
  });
  for (let offset = 0; offset < 224; offset += 8)
    emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
  descriptor(0);
  imm(9, 0xfaceb00cn);
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 104 });
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 136 });
  const nan = 0xfff8000000001234n;
  invoke(1, 96, nan, 1n);
  invoke(0, 96, undefined, nan);
  invoke(3, 96, "child", 1n);
  invoke(2, 96, undefined, "child");
  invoke(5, 96, 1n, 1n);
  invoke(4, 96, undefined, 1n);
  check(104, 0xfaceb00cn);
  check(136, 0xfaceb00cn);
  descriptor(1);
  invoke(1, 96, 0n, 0n);
  invoke(3, 96, 0n, 0n);
  invoke(5, 96, 0n, 0n);
  check(112, nan);
  check(128, 1n);
  invoke(0, 96, undefined, 0xbff0000000000000n);
  invoke(2, 96, undefined, "object");
  invoke(4, 96, undefined, 0n);
  invoke(1, undefined, 0n, 0n);
  invoke(3, undefined, 0n, 0n);
  invoke(5, undefined, 0n, 0n);
  invoke(0, undefined, undefined, 0xbff0000000000000n);
  invoke(2, undefined, undefined, 0n);
  invoke(4, undefined, undefined, 0n);
  descriptor(0);
  invoke(0, 96, undefined, nan);
  invoke(2, 96, undefined, "child");
  invoke(4, 96, undefined, 1n);
  imm(0, 0n);
  emit({
    op: "add-imm",
    width: 64,
    rd: "sp",
    rn: "sp",
    immediate: 224,
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
  instructions.forEach((i, n) =>
    assert.ok(writeInstruction(code, n * 4, i).ok),
  );
  code.set(native.value.code, base);
  for (const call of calls)
    assert.ok(
      patchBranch(code, {
        offset: call.offset,
        targetOffset: base + native.value.functions[call.function]!.offset,
        branch: { op: "bl" },
      }).ok,
    );
  for (const fixup of addresses)
    assert.ok(
      patchAddress(code, {
        offset: fixup.offset,
        targetOffset: base + native.value.records[fixup.record]!.offset,
        rd: 9,
      }).ok,
    );
  const image = buildAArch64Executable({
    code,
    entryOffset: 0,
    identifier: "tint.verify.records",
    minimumOS: { major: 26, minor: 6, patch: 2 },
    sdk: { major: 26, minor: 6, patch: 0 },
    maxByteLength: 1048576,
  });
  assert.ok(image.ok);
  const path = join(directory, "records");
  writeFileSync(path, image.value.bytes, { mode: 0o755 });
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
    "Verified native numeric, boolean and reference record reads/writes, exact NaN bits, descriptor/null guards, untouched failed writes, header canaries and root restoration; executable ran twice.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
