// c-memory lowering and the C stack reserve (docs/native-ffi.md): each
// Field accessor is one length check, the data pointer and one access at a
// constant offset; external-storage primitives rewrite only array headers.
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindForeignCalls,
  type ForeignCall,
  type ForeignMemoryAccess,
  type ModuleIR,
  type ScalarType,
  type ReturnType,
} from "@tint/ir/scalar";
import type { CType } from "@tint/abi/c";
import { encode, type Instruction } from "@tint/codegen/aarch64/isa";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";

const scalar = (
  name: "bool" | "i8" | "u16" | "u32" | "i64" | "u64" | "f32" | "f64",
): CType => ({ kind: "scalar", scalar: name });
const address: CType = { kind: "pointer", pointee: scalar("u32") };
function stub(parameters: ScalarType[], result: ReturnType): ModuleIR {
  const slots = parameters.slice();
  if (result !== "void") slots.push(result);
  return {
    functions: [
      {
        id: 0,
        name: "stub",
        exported: true,
        parameters: parameters.map((_, index) => index),
        slots,
        returnType: result,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions:
              result === "void"
                ? []
                : [
                    {
                      kind: "load",
                      id: 0,
                      slot: parameters.length,
                      start: 0,
                      end: 0,
                    },
                  ],
            terminator: {
              kind: "return",
              value: result === "void" ? undefined : 0,
              start: 0,
              end: 0,
            },
          },
        ],
      },
    ],
  };
}
function emitted(
  binding: { call?: ForeignCall; memory?: ForeignMemoryAccess },
  parameters: ScalarType[],
  result: ReturnType,
): Uint32Array {
  const bound = bindForeignCalls(stub(parameters, result), [
    { function: 0, ...binding },
  ]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const module = emitModule(bound.value, { hostABI: darwinHostABI() });
  assert.ok(module.ok, JSON.stringify(module));
  // Neither a field access nor a leaf call is a safepoint.
  for (const table of module.value.stackMaps) assert.equal(table.entries, 0);
  const code = module.value.code;
  return new Uint32Array(
    code.buffer.slice(code.byteOffset, code.byteOffset + code.byteLength),
  );
}
function word(instruction: Instruction): number {
  const encoded = encode(instruction);
  assert.ok(encoded.ok, JSON.stringify(instruction));
  return encoded.value;
}
/** Whether `code` contains `sequence` contiguously. */
function contains(
  code: Uint32Array,
  sequence: readonly Instruction[],
): boolean {
  const words = sequence.map(word);
  for (let at = 0; at + words.length <= code.length; at++)
    if (words.every((value, index) => code[at + index] === value)) return true;
  return false;
}
const field = (
  operation: "load" | "store",
  type: CType,
  offset: number,
  minimum = 112,
): ForeignMemoryAccess => ({ operation, type, offset, minimum });
const lengthCheck: Instruction[] = [
  { op: "ldr", width: 32, rt: 10, rn: 9, offset: 8 },
  {
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 10,
    immediate: 112,
    shift: 0,
    setFlags: true,
  },
];
const dataPointer: Instruction = {
  op: "ldr",
  width: 64,
  rt: 11,
  rn: 9,
  offset: 16,
};

test("a Field load is a length check, the data pointer and one constant-offset load", () => {
  const code = emitted(
    { memory: field("load", scalar("u32"), 32) },
    ["Uint8Array"],
    "number",
  );
  assert.ok(contains(code, lengthCheck));
  assert.ok(
    contains(code, [
      dataPointer,
      { op: "ldr", width: 32, rt: 12, rn: 11, offset: 32 },
      { op: "ucvtf-d-w", rd: 0, rn: 12 },
    ]),
  );
  const double = emitted(
    { memory: field("load", scalar("f64"), 16) },
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(double, [dataPointer, { op: "ldr-d", rt: 0, rn: 11, offset: 16 }]),
  );
  // Narrow signed members sign-extend; bool normalizes to 0/1.
  const narrow = emitted(
    { memory: field("load", scalar("i8"), 3) },
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(narrow, [
      { op: "ldrb", rt: 12, rn: 11, offset: 3 },
      { op: "sbfm", width: 32, rd: 12, rn: 12, immr: 0, imms: 7 },
    ]),
  );
  const flag = emitted(
    { memory: field("load", scalar("bool"), 7) },
    ["Uint8Array"],
    "boolean",
  );
  assert.ok(contains(flag, [{ op: "ldrb", rt: 12, rn: 11, offset: 7 }]));
});

test("64-bit and address members convert exactly, rejecting the saturation bounds", () => {
  const pointer = emitted(
    { memory: field("load", address, 104) },
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(pointer, [
      dataPointer,
      { op: "ldr", width: 64, rt: 12, rn: 11, offset: 104 },
      // CMN x12, #1: 2^64 - 1 is not a binary64 value.
      {
        op: "add-imm",
        width: 64,
        rd: "zr",
        rn: 12,
        immediate: 1,
        shift: 0,
        setFlags: true,
      },
    ]),
  );
  // Stores check exactness before touching memory.
  const store = emitted(
    { memory: field("store", scalar("i64"), 40) },
    ["Uint8Array", "number"],
    "void",
  );
  assert.ok(
    contains(store, [
      { op: "fcvtzs-x-d", rd: 12, rn: 0 },
      { op: "scvtf-d-x", rd: 1, rn: 12 },
      {
        op: "add-imm",
        width: 64,
        rd: "zr",
        rn: 12,
        immediate: 1,
        shift: 0,
        setFlags: true,
      },
    ]),
  );
  assert.ok(
    contains(store, [
      dataPointer,
      { op: "str", width: 64, rt: 12, rn: 11, offset: 40 },
    ]),
  );
  // A 64-bit c-call result: 2^63 - 1 rounds to 2^63, which converts back
  // to 2^63 - 1, so the bound itself must trap.
  const call = emitted(
    {
      call: {
        symbol: "labs",
        signature: {
          parameters: [scalar("i64")],
          result: scalar("i64"),
          fixedParameters: 1,
          callClass: "leaf",
          errno: "none",
        },
        operands: ["number"],
        result: "number",
      },
    },
    ["number"],
    "number",
  );
  assert.ok(
    contains(call, [
      {
        op: "add-imm",
        width: 64,
        rd: "zr",
        rn: 0,
        immediate: 1,
        shift: 0,
        setFlags: true,
      },
    ]),
  );
});

test("unaligned and distant members form the address first", () => {
  const packed = emitted(
    { memory: field("store", scalar("u32"), 5, 16) },
    ["Uint8Array", "number"],
    "void",
  );
  assert.ok(
    contains(packed, [
      dataPointer,
      {
        op: "add-imm",
        width: 64,
        rd: 11,
        rn: 11,
        immediate: 5,
        shift: 0,
        setFlags: false,
      },
      { op: "str", width: 32, rt: 12, rn: 11, offset: 0 },
    ]),
  );
  const half = emitted(
    { memory: field("load", scalar("u16"), 8191, 8193) },
    ["Uint8Array"],
    "number",
  );
  assert.ok(contains(half, [{ op: "ldrh", rt: 12, rn: 11, offset: 0 }]));
});

test("external-storage primitives check the array kind before rewriting it", () => {
  const primitive = (
    operation: "address" | "adopt" | "retarget",
  ): ForeignMemoryAccess => ({
    operation,
    type: { kind: "void" },
    offset: 0,
    minimum: 0,
  });
  const kind: Instruction = {
    op: "ubfm",
    width: 64,
    rd: 10,
    rn: 10,
    immr: 48,
    imms: 50,
  };
  const where = emitted(
    { memory: primitive("address") },
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(where, [{ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 }, kind]),
  );
  assert.ok(
    contains(where, [
      { op: "csel", width: 64, rd: 11, rn: 11, rm: 12, condition: "eq" },
    ]),
  );
  const adopt = emitted(
    { memory: primitive("adopt") },
    ["Uint8Array", "number", "number"],
    "Uint8Array",
  );
  assert.ok(
    contains(adopt, [
      { op: "str", width: 64, rt: 10, rn: 9, offset: 0 },
      { op: "str", width: 64, rt: 13, rn: 9, offset: 8 },
      { op: "str", width: 64, rt: 12, rn: 9, offset: 16 },
    ]),
  );
  const retarget = emitted(
    { memory: primitive("retarget") },
    ["Uint8Array", "number"],
    "void",
  );
  assert.ok(contains(retarget, [kind]));
  assert.ok(
    contains(retarget, [{ op: "str", width: 64, rt: 12, rn: 9, offset: 16 }]),
  );
});

test("functions containing c-calls reserve C stack in their entry check", () => {
  const getpid: ForeignCall = {
    symbol: "getpid",
    signature: {
      parameters: [],
      result: { kind: "scalar", scalar: "i32" },
      fixedParameters: 0,
      callClass: "leaf",
      errno: "none",
    },
    operands: [],
    result: "number",
  };
  const code = emitted({ call: getpid }, [], "number");
  // SUB x17, sp, #16, LSL #12 (the 64 KiB reserve), then the limit compare.
  assert.ok(
    contains(code, [
      {
        op: "sub-imm",
        width: 64,
        rd: 17,
        rn: "sp",
        immediate: 16,
        shift: 12,
        setFlags: false,
      },
      {
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 17,
        rm: 16,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      },
    ]),
  );
});
