import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const span = { start: 1, end: 2 };
function fixture(): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "entry",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "function-new", id: 0, target: 1, ...span },
              {
                kind: "call-indirect",
                id: 1,
                target: 1,
                callee: 0,
                arguments: [],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "answer",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 42, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
}
test("emission options preserve default and configured byte images", () => {
  // Both images omit redundant entry jumps and end with their safepoint
  // table. Precise stack maps need no temporary-root initialization.
  // Each record descriptor is preceded by two dispatch family words and its
  // 8-byte record index. Number
  // constants materialize only their nonzero 16-bit parts. The configured
  // image's inline allocation compares top + size with the limit, and
  // debugSpans keeps slow paths inline rather than emitting out-of-line stubs.
  for (const [options, length, hash] of [
    [
      {},
      728,
      "a6ce240170fdae9782a846b61fc5812ef45db5e709124361f7adf9eeb9c54dc5",
    ],
    [
      {
        maxByteLength: 0xffffffff,
        hostABI: darwinHostABI(),
        debugSpans: true,
        linearAllocation: true,
        generationalBarriers: true,
        closedRoots: [0],
      },
      776,
      "5600557866a54a768ecfba5a4194cc91a3fa739ef117ee87e467b45e2659d046",
    ],
  ] as const) {
    const r = emitModule(fixture(), options);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.value.code.length, length);
    assert.equal(createHash("sha256").update(r.value.code).digest("hex"), hash);
  }
});

test("emission options retain explicit invalid-budget rejection", () => {
  for (const budget of [
    NaN,
    0,
    3,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    null,
  ]) {
    const r = emitModule(fixture(), { maxByteLength: budget as number });
    assert.equal(r.ok, false, String(budget));
  }
});

test("frame words stored from a register are forwarded, not reloaded", () => {
  // STR/LDR Xt, [SP, #imm12*8] are 0xf9000000 / 0xf9400000 | imm12 << 10 |
  // 31 << 5 | Xt. The prologue stores the context (x0) to the frame; until
  // the next branch (or x0's redefinition) every later read of that word
  // reuses the register.
  const span = { start: 0, end: 0 };
  const copies: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "copies",
        exported: true,
        parameters: [0],
        slots: ["reference", "reference", "reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "store", slot: 1, value: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "store", slot: 2, value: 1, ...span },
              { kind: "load", id: 2, slot: 2, ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  const r = emitModule(copies, {});
  assert.ok(r.ok, JSON.stringify(r));
  const code = r.value.code;
  const words: number[] = [];
  for (let at = 0; at + 4 <= code.length; at += 4)
    words.push(
      (code[at]! |
        (code[at + 1]! << 8) |
        (code[at + 2]! << 16) |
        (code[at + 3]! << 24)) >>>
        0,
    );
  const branch = (w: number): boolean =>
    (w & 0x7c000000) >>> 0 === 0x14000000 ||
    (w & 0xff000010) >>> 0 === 0x54000000 ||
    (w & 0x7e000000) >>> 0 === 0x34000000 ||
    (w & 0xfffffc1f) >>> 0 === 0xd63f0000 ||
    w === 0xd65f03c0;
  const stored = words.findIndex((w) => (w & 0xffc003ff) >>> 0 === 0xf90003e0);
  assert.ok(stored >= 0, "the context is stored from x0");
  const slot = (words[stored]! >>> 10) & 0xfff;
  let reloads = 0;
  // MOVZ x0/w0 redefines the register; reloads after it are legitimate.
  const redefinesX0 = (w: number): boolean =>
    (w & 0x7f80001f) >>> 0 === 0x52800000;
  for (
    let i = stored + 1;
    i < words.length && !branch(words[i]!) && !redefinesX0(words[i]!);
    i++
  ) {
    const w = words[i]!;
    if ((w & 0xffc003e0) >>> 0 === 0xf94003e0 && ((w >>> 10) & 0xfff) === slot)
      reloads++;
  }
  assert.equal(reloads, 0);
});

test("a byte budget above 4 GiB preserves compact emission for small code", () => {
  const normal = emitModule(fixture());
  const wide = emitModule(fixture(), { maxByteLength: 0x100000000 });
  assert.ok(normal.ok && wide.ok);
  assert.deepEqual(wide.value.code, normal.value.code);
});
