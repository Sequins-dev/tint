import assert from "node:assert/strict";
import test from "node:test";
import type { Block, FunctionIR, ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
const s = { start: 0, end: 0 };
/** Branch over `body` on a boolean parameter, then return the number slot. */
function guarded(id: number, body: Block["instructions"]): FunctionIR {
  return {
    id,
    name: "guarded" + id,
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: body,
        terminator: { kind: "jump", target: 2, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
}
/** Over 1 MiB of straight-line stores: beyond a conditional branch's reach. */
function oversized(): Block["instructions"] {
  const body: Block["instructions"][number][] = [];
  for (let index = 0; index < 60000; index++) {
    body.push({
      kind: "constant",
      id: 10 + index * 2,
      value: index + 0.5,
      ...s,
    });
    body.push({ kind: "store", slot: 1, value: 10 + index * 2, ...s });
  }
  return body;
}
const caller: Block["instructions"] = [
  { kind: "load", id: 2, slot: 0, ...s },
  { kind: "load", id: 3, slot: 1, ...s },
  { kind: "call", id: 4, target: 0, arguments: [2, 3], ...s },
  { kind: "store", slot: 1, value: 4, ...s },
];
function words(code: Uint8Array, offset: number, byteLength: number) {
  const view = new DataView(code.buffer, code.byteOffset);
  return Array.from({ length: byteLength / 4 }, (_, index) =>
    view.getUint32(offset + index * 4, true),
  );
}
/** Index and displacement of the first CBZ/CBNZ in a function. */
function firstCompareBranch(code: readonly number[]) {
  const index = code.findIndex((word) => (word & 0x7e000000) === 0x34000000);
  assert.ok(index >= 0);
  const imm = ((code[index]! >>> 5) & 0x7ffff) << 13;
  return { index, displacement: (imm >> 13) * 4 };
}
test("in-reach conditional branches and local calls use single instructions", () => {
  const module: ModuleIR = {
    functions: [guarded(0, []), guarded(1, caller)],
  };
  const emitted = emitModule(module);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const [target, source] = emitted.value.functions;
  assert.ok(target && source);
  const code = words(emitted.value.code, source.offset, source.byteLength);
  const branch = firstCompareBranch(code);
  // One CBZ to the join, not an inverted skip over an unconditional branch.
  assert.notEqual(branch.displacement, 8);
  const bl = code.findIndex((word) => (word & 0xfc000000) >>> 0 === 0x94000000);
  assert.ok(bl >= 0, "local call is a BL");
  const expected = encode({
    op: "bl",
    displacement: target.offset - (source.offset + bl * 4),
  });
  assert.ok(expected.ok);
  assert.equal(code[bl], expected.value);
});
test("only functions beyond conditional reach fall back to long branches", () => {
  const emitted = emitModule({
    functions: [guarded(0, oversized()), guarded(1, caller)],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const [large, small] = emitted.value.functions;
  assert.ok(large && small && large.byteLength > 1 << 20);
  const long = words(emitted.value.code, large.offset, 64);
  const skip = firstCompareBranch(long);
  assert.equal(skip.displacement, 8, "inverted skip over the long branch");
  assert.equal((long[skip.index + 1]! & 0xfc000000) >>> 0, 0x14000000);
  const compact = words(emitted.value.code, small.offset, small.byteLength);
  assert.notEqual(firstCompareBranch(compact).displacement, 8);
});
/** A function returning a string literal: its address comes from the pool. */
function literal(id: number, body: Block["instructions"] = []): FunctionIR {
  return {
    id,
    name: "literal" + id,
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "number"],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          ...body,
          { kind: "string-literal", id: 1, value: "pooled", ...s },
        ],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
}
const adrX9 = (word: number) => (word & 0x9f00001f) >>> 0 === 0x10000009;
test("in-reach local addresses are a single ADR", () => {
  const emitted = emitModule({ functions: [literal(0)] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  const index = code.findIndex(adrX9);
  assert.ok(index >= 0, "string address is an ADR");
  // Not the first word of a long ADR/MOVZ/MOVK/ADD sequence.
  assert.notEqual((code[index + 1]! & 0x7f800000) >>> 0, 0x52800000);
});
test("functions whose local addresses are out of reach fall back alone", () => {
  // The oversized function separates the first one from the literal pool;
  // the last function sits just before the pool.
  const emitted = emitModule(
    { functions: [literal(0), literal(1, oversized()), literal(2)] },
    { compactAddresses: true },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const [near, far, last] = emitted.value.functions;
  assert.ok(near && far && last && far.byteLength > 1 << 20);
  const form = (fn: { offset: number; byteLength: number }) => {
    const code = words(emitted.value.code, fn.offset, fn.byteLength);
    const index = code.findIndex(adrX9);
    assert.ok(index >= 0);
    // Long form: ADR #0 followed by MOVZ x17.
    return (code[index + 1]! & 0x7f800000) >>> 0 === 0x52800000
      ? "long"
      : "adr";
  };
  assert.equal(form(near), "long");
  assert.equal(form(last), "adr");
});
test("adjacent zeroed root words share one STP", () => {
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "roots",
        exported: true,
        parameters: [],
        slots: ["general", "general"],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "general-none", id: 0, ...s },
              { kind: "store", slot: 0, value: 0, ...s },
              { kind: "store", slot: 1, value: 0, ...s },
            ],
            terminator: { kind: "return", value: undefined, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  // STP XZR, XZR, [SP, #imm] (64-bit, signed offset).
  assert.ok(
    code.some((word) => (word & 0xffc07fff) >>> 0 === 0xa9007fff),
    "zeroing pairs adjacent words",
  );
});
