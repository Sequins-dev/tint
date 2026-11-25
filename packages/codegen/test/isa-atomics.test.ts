import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encode,
  writeInstruction,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

test("atomic encodings reject ambiguous registers, widths and exclusive overlaps", () => {
  for (const width of [8, 16, 32, 64] as const) {
    for (const registers of [
      { rs: 0, rt: 0, rn: 1 },
      { rs: 1, rt: 0, rn: 1 },
      { rs: "zr", rt: "zr", rn: "sp" },
    ] as const) {
      assert.deepEqual(encode({ op: "stlxr", width, ...registers }), {
        ok: false,
        error: "UNPREDICTABLE_OPERANDS",
      });
    }
  }
  for (const instruction of [
    { op: "ldar", width: 8, rt: 31, rn: 0 },
    { op: "stlr", width: 16, rt: "sp", rn: 0 },
    { op: "ldaxr", width: 32, rt: 0, rn: "zr" },
    { op: "stlxr", width: 64, rt: 0, rn: 1, rs: "sp" },
  ])
    assert.deepEqual(encode(instruction as Instruction), {
      ok: false,
      error: "INVALID_REGISTER",
    });
  assert.deepEqual(
    encode({ op: "ldar", width: 128, rt: 0, rn: 0 } as unknown as Instruction),
    { ok: false, error: "INVALID_WIDTH" },
  );
  assert.deepEqual(
    encode({ op: "dmb", domain: "invalid" } as unknown as Instruction),
    { ok: false, error: "INVALID_MODE" },
  );
});

test("rejected exclusive encodings leave output bytes unchanged", () => {
  const bytes = new Uint8Array(12).fill(0xaa);
  assert.deepEqual(
    writeInstruction(bytes, 4, {
      op: "stlxr",
      width: 64,
      rs: 1,
      rt: 1,
      rn: "sp",
    }),
    { ok: false, error: "UNPREDICTABLE_OPERANDS" },
  );
  assert.deepEqual([...bytes], Array(12).fill(0xaa));
});

test("LSE ldaddal encodes 8, 16, 32, and 64-bit widths matching clang", () => {
  const cases: readonly [8 | 16 | 32 | 64, number][] = [
    [8, 0x38ee014b],
    [16, 0x78ee014b],
    [32, 0xb8ee014b],
    [64, 0xf8ee014b],
  ];
  for (const [width, expected] of cases) {
    assert.deepEqual(encode({ op: "ldaddal", width, rs: 14, rt: 11, rn: 10 }), {
      ok: true,
      value: expected,
    });
  }
  assert.deepEqual(
    encode({
      op: "ldaddal",
      width: 32,
      rs: "sp",
      rt: 0,
      rn: 1,
    } as unknown as Instruction),
    { ok: false, error: "INVALID_REGISTER" },
  );
});
