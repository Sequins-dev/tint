import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encode,
  float64Immediate,
  writeInstruction,
  patchBranch,
  type Instruction,
  type EncodingError,
} from "@tint/codegen/aarch64/isa";
import { fixtures } from "./isa-fixtures.ts";

for (const fixture of fixtures)
  test(`golden: ${fixture.assembly}`, () => {
    const encoded = encode(fixture.instruction);
    const expected = fixture.bytes.reduce(
      (word, byte, index) => word + byte * 256 ** index,
      0,
    );
    assert.deepEqual(encoded, { ok: true, value: expected });
    const buffer = new Uint8Array(12).fill(0xaa);
    assert.deepEqual(writeInstruction(buffer, 4, fixture.instruction), {
      ok: true,
      value: undefined,
    });
    assert.deepEqual(
      [...buffer],
      [0xaa, 0xaa, 0xaa, 0xaa, ...fixture.bytes, 0xaa, 0xaa, 0xaa, 0xaa],
    );
  });
function rejected(instruction: Instruction, error: EncodingError) {
  assert.deepEqual(encode(instruction), { ok: false, error });
}
test("rejects register 31 ambiguity and wrong SP/ZR roles", () => {
  const move: Instruction = {
    op: "movz",
    width: 64,
    rd: 0,
    immediate: 0,
    shift: 0,
  };
  for (const rd of [-1, 31, 32, 1.5, NaN])
    rejected({ ...move, rd }, "INVALID_REGISTER");
  rejected({ ...move, rd: "sp" } as unknown as Instruction, "INVALID_REGISTER");
  const add: Instruction = {
    op: "add-imm",
    width: 64,
    rd: "sp",
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  };
  rejected({ ...add, rd: "zr" }, "INVALID_REGISTER");
  rejected({ ...add, setFlags: true }, "INVALID_REGISTER");
  rejected({ ...add, rn: "zr" } as unknown as Instruction, "INVALID_REGISTER");
  rejected({ op: "ret", rn: 31 }, "INVALID_REGISTER");
});
test("rejects truncation, illegal shifts and invalid selectors", () => {
  const move: Instruction = {
    op: "movz",
    width: 32,
    rd: 1,
    immediate: 0,
    shift: 0,
  };
  for (const immediate of [-1, 65536, 0.5, Infinity, NaN])
    rejected({ ...move, immediate }, "INVALID_IMMEDIATE");
  rejected({ ...move, shift: 32 }, "INVALID_SHIFT");
  rejected({ ...move, shift: 1 } as unknown as Instruction, "INVALID_SHIFT");
  rejected({ ...move, width: 128 } as unknown as Instruction, "INVALID_WIDTH");
  rejected(
    {
      op: "b.cond",
      condition: "bad",
      displacement: 0,
    } as unknown as Instruction,
    "INVALID_CONDITION",
  );
  rejected({ op: "unknown" } as unknown as Instruction, "INVALID_INSTRUCTION");
  const add: Instruction = {
    op: "add-reg",
    width: 32,
    rd: 0,
    rn: 1,
    rm: 2,
    shift: "lsl",
    amount: 32,
    setFlags: false,
  };
  rejected(add, "INVALID_SHIFT");
  rejected(
    { ...add, amount: 0, setFlags: 1 } as unknown as Instruction,
    "INVALID_FLAGS",
  );
});
test("checks exact signed branch ranges and instruction alignment", () => {
  for (const op of ["b", "bl"] as const) {
    assert.equal(encode({ op, displacement: -134217728 }).ok, true);
    assert.equal(encode({ op, displacement: 134217724 }).ok, true);
    rejected({ op, displacement: -134217732 }, "OUT_OF_RANGE");
    rejected({ op, displacement: 134217728 }, "OUT_OF_RANGE");
  }
  for (const displacement of [-1048576, 1048572])
    assert.equal(
      encode({ op: "cbz", rt: 0, width: 64, displacement }).ok,
      true,
    );
  rejected(
    { op: "b.cond", condition: "eq", displacement: 1048576 },
    "OUT_OF_RANGE",
  );
  rejected(
    { op: "cbnz", width: 32, rt: 0, displacement: -1048580 },
    "OUT_OF_RANGE",
  );
  rejected({ op: "b", displacement: 2 }, "MISALIGNED");
  rejected({ op: "b", displacement: 0.5 }, "INVALID_IMMEDIATE");
  rejected({ op: "b", displacement: NaN }, "INVALID_IMMEDIATE");
});
test("validates scaled memory offsets and unpredictable register overlap", () => {
  const load: Instruction = {
    op: "ldr",
    width: 64,
    rt: 0,
    rn: "sp",
    offset: 0,
  };
  rejected({ ...load, offset: 4 }, "MISALIGNED");
  rejected({ ...load, offset: -8 }, "OUT_OF_RANGE");
  rejected({ ...load, offset: 32768 }, "OUT_OF_RANGE");
  const pair: Instruction = {
    op: "ldp",
    width: 64,
    rt: 0,
    rt2: 1,
    rn: 2,
    mode: "pre",
    offset: 0,
  };
  rejected({ ...pair, rt2: 0 }, "UNPREDICTABLE_OPERANDS");
  rejected({ ...pair, rn: 0 }, "UNPREDICTABLE_OPERANDS");
  rejected({ ...pair, op: "stp", rn: 1 }, "UNPREDICTABLE_OPERANDS");
  rejected({ ...pair, offset: -520 }, "OUT_OF_RANGE");
  rejected({ ...pair, offset: 512 }, "OUT_OF_RANGE");
  rejected({ ...pair, mode: "bad" } as unknown as Instruction, "INVALID_MODE");
});
test("writes and fixups are bounded, opcode-checked and failure-atomic", () => {
  const bytes = new Uint8Array(16);
  assert.equal(
    writeInstruction(bytes, 4, { op: "bl", displacement: 0 }).ok,
    true,
  );
  assert.deepEqual(
    patchBranch(bytes, { offset: 4, targetOffset: 12, branch: { op: "bl" } }),
    { ok: true, value: undefined },
  );
  assert.deepEqual([...bytes.subarray(4, 8)], [2, 0, 0, 0x94]);
  const before = bytes.slice();
  for (const offset of [-1, 1, 14, 16, NaN])
    assert.equal(writeInstruction(bytes, offset, { op: "nop" }).ok, false);
  assert.deepEqual(
    patchBranch(bytes, { offset: 4, targetOffset: 0, branch: { op: "b" } }),
    { ok: false, error: "PATCH_MISMATCH" },
  );
  assert.equal(
    patchBranch(bytes, {
      offset: 4,
      targetOffset: 0x10000000,
      branch: { op: "bl" },
    }).ok,
    false,
  );
  assert.equal(
    patchBranch(bytes, { offset: 4, targetOffset: 2, branch: { op: "bl" } }).ok,
    false,
  );
  assert.equal(
    patchBranch(bytes, { offset: 4, targetOffset: -4, branch: { op: "bl" } })
      .ok,
    false,
  );
  assert.equal(
    writeInstruction(bytes, 4, {
      op: "movz",
      width: 32,
      rd: 31,
      immediate: 0,
      shift: 0,
    }).ok,
    false,
  );
  assert.deepEqual(bytes, before);
});
test("conditional and compare-branch patches retain their non-immediate fields", () => {
  const bytes = new Uint8Array(12);
  const branch = { op: "cbnz", rt: 18, width: 64 } as const;
  assert.equal(
    writeInstruction(bytes, 8, { ...branch, displacement: 0 }).ok,
    true,
  );
  assert.equal(
    patchBranch(bytes, { offset: 8, targetOffset: 0, branch }).ok,
    true,
  );
  assert.deepEqual([...bytes.subarray(8)], [0xd2, 0xff, 0xff, 0xb5]);
  assert.equal(
    writeInstruction(bytes, 0, {
      op: "b.cond",
      condition: "le",
      displacement: 0,
    }).ok,
    true,
  );
  assert.equal(
    patchBranch(bytes, {
      offset: 0,
      targetOffset: 8,
      branch: { op: "b.cond", condition: "le" },
    }).ok,
    true,
  );
  assert.deepEqual([...bytes.subarray(0, 4)], [0x4d, 0, 0, 0x54]);
});
test("binary64 operands distinguish FP register 31 and reject invalid widths, offsets and conditions", () => {
  assert.equal(encode({ op: "fadd", rd: 31, rn: 31, rm: 31 }).ok, true);
  for (const register of [-1, 32, 0.5, NaN])
    assert.equal(encode({ op: "fadd", rd: register, rn: 0, rm: 1 }).ok, false);
  assert.equal(
    encode({ op: "ldr-d", rt: 31, rn: "sp", offset: 32760 }).ok,
    true,
  );
  for (const offset of [-8, 1, 32768, Infinity])
    assert.equal(encode({ op: "str-d", rt: 0, rn: "sp", offset }).ok, false);
  for (const condition of ["al", "nv"] as const)
    assert.equal(encode({ op: "cset", rd: 0, condition }).ok, false);
});
test("bitfield and variable-shift forms reject invalid operands instead of truncating", () => {
  for (const width of [32, 64] as const) {
    assert.equal(
      encode({ op: "ubfm", width, rd: 0, rn: "zr", immr: width - 1, imms: 0 })
        .ok,
      true,
    );
    for (const bit of [-1, width, 0.5, NaN])
      assert.equal(
        encode({ op: "ubfm", width, rd: 0, rn: 1, immr: bit, imms: 0 }).ok,
        false,
      );
    assert.equal(
      encode({ op: "lslv", width, rd: "zr", rn: 30, rm: "zr" }).ok,
      true,
    );
    assert.equal(encode({ op: "asrv", width, rd: 31, rn: 0, rm: 1 }).ok, false);
  }
});

test("directed floating rounding matches independent LLVM encodings", () => {
  assert.deepEqual(encode({ op: "frintp", rd: 0, rn: 1 }), {
    ok: true,
    value: 0x1e64c020,
  });
  assert.deepEqual(encode({ op: "frintz", rd: 31, rn: 30 }), {
    ok: true,
    value: 0x1e65c3df,
  });
});

test("rounding rejects invalid FP registers", () => {
  for (const op of ["frintp", "frintz"] as const)
    for (const register of [-1, 32, 0.5, NaN]) {
      rejected({ op, rd: register, rn: 0 }, "INVALID_REGISTER");
      rejected({ op, rd: 0, rn: register }, "INVALID_REGISTER");
    }
});

test("byte loads and stores encode exact offsets and reject out-of-range addresses", () => {
  assert.deepEqual(encode({ op: "ldrb", rt: 0, rn: 1, offset: 0 }), {
    ok: true,
    value: 0x39400020,
  });
  assert.deepEqual(encode({ op: "strb", rt: "zr", rn: "sp", offset: 4095 }), {
    ok: true,
    value: 0x393fffff,
  });
  rejected({ op: "ldrb", rt: 0, rn: 1, offset: 4096 }, "OUT_OF_RANGE");
  rejected({ op: "strb", rt: 0, rn: 1, offset: -1 }, "OUT_OF_RANGE");
});

test("breakpoint traps have explicit bounded immediates", () => {
  assert.deepEqual(encode({ op: "brk", immediate: 0 }), {
    ok: true,
    value: 0xd4200000,
  });
  assert.deepEqual(encode({ op: "brk", immediate: 65535 }), {
    ok: true,
    value: 0xd43fffe0,
  });
  rejected({ op: "brk", immediate: 65536 }, "INVALID_IMMEDIATE");
});

test("halfword loads and stores use scaled unsigned offsets", () => {
  assert.deepEqual(encode({ op: "ldrh", rt: 0, rn: 1, offset: 0 }), {
    ok: true,
    value: 0x79400020,
  });
  assert.deepEqual(encode({ op: "strh", rt: "zr", rn: "sp", offset: 8190 }), {
    ok: true,
    value: 0x793fffff,
  });
  rejected({ op: "ldrh", rt: 0, rn: 1, offset: 1 }, "INVALID_IMMEDIATE");
  rejected({ op: "strh", rt: 0, rn: 1, offset: 8192 }, "OUT_OF_RANGE");
});

test("double square root encodes its floating-point registers", () => {
  assert.deepEqual(encode({ op: "fsqrt", rd: 0, rn: 1 }), {
    ok: true,
    value: 0x1e61c020,
  });
  for (const register of [-1, 32, 0.5, NaN]) {
    rejected({ op: "fsqrt", rd: register, rn: 0 }, "INVALID_REGISTER");
    rejected({ op: "fsqrt", rd: 0, rn: register }, "INVALID_REGISTER");
  }
});

test("FMOV immediates encode exactly the representable binary64 values", () => {
  // imm8 values from the Arm ARM FMOV (scalar, immediate) table.
  for (const [value, imm8] of [
    [2, 0x00],
    [1, 0x70],
    [0.5, 0x60],
    [0.125, 0x40],
    [31, 0x3f],
    [10, 0x24],
    [-1, 0xf0],
    [-2, 0x80],
    [1.0625, 0x71],
    [1.9375, 0x7f],
  ] as const) {
    assert.equal(float64Immediate(value), imm8, String(value));
    const encoded = encode({ op: "fmov-d-imm", rd: 3, imm8 });
    assert.ok(encoded.ok);
    assert.equal(encoded.value, 0x1e601003 + imm8 * 8192);
  }
  // fmov d0, #1.0 as assembled by clang.
  assert.deepEqual(encode({ op: "fmov-d-imm", rd: 0, imm8: 0x70 }), {
    ok: true,
    value: 0x1e6e1000,
  });
  for (const value of [
    0,
    -0,
    0.1,
    32,
    33,
    0.0625,
    1 / 3,
    NaN,
    Infinity,
    1.03125,
  ])
    assert.equal(float64Immediate(value), undefined, String(value));
  assert.equal(encode({ op: "fmov-d-imm", rd: 32, imm8: 0 }).ok, false);
  assert.equal(encode({ op: "fmov-d-imm", rd: 0, imm8: 256 }).ok, false);
  assert.equal(encode({ op: "fmov-d-imm", rd: 0, imm8: 0.5 }).ok, false);
});

test("SXTW sign-extends a 32-bit register", () => {
  // sxtw x0, w1 and sxtw x9, w13 as assembled by clang.
  assert.deepEqual(encode({ op: "sxtw", rd: 0, rn: 1 }), {
    ok: true,
    value: 0x93407c20,
  });
  assert.deepEqual(encode({ op: "sxtw", rd: 9, rn: 13 }), {
    ok: true,
    value: 0x93407da9,
  });
  assert.equal(encode({ op: "sxtw", rd: 31, rn: 0 }).ok, false);
  assert.equal(encode({ op: "sxtw", rd: 0, rn: 31 }).ok, false);
});

test("UBFM and SBFM encode immediate shifts", () => {
  // As assembled by llvm-mc: lsr w9, w9, #7; lsl w9, w9, #25;
  // asr w0, w1, #3; asr w9, w13, #7; asr x2, x3, #5.
  const cases: [Parameters<typeof encode>[0], number][] = [
    [{ op: "ubfm", width: 32, rd: 9, rn: 9, immr: 7, imms: 31 }, 0x53077d29],
    [{ op: "ubfm", width: 32, rd: 9, rn: 9, immr: 7, imms: 6 }, 0x53071929],
    [{ op: "sbfm", width: 32, rd: 0, rn: 1, immr: 3, imms: 31 }, 0x13037c20],
    [{ op: "sbfm", width: 32, rd: 9, rn: 13, immr: 7, imms: 31 }, 0x13077da9],
    [{ op: "sbfm", width: 64, rd: 2, rn: 3, immr: 5, imms: 63 }, 0x9345fc62],
  ];
  for (const [instruction, word] of cases)
    assert.deepEqual(encode(instruction), { ok: true, value: word });
  assert.equal(
    encode({ op: "sbfm", width: 32, rd: 0, rn: 1, immr: 32, imms: 31 }).ok,
    false,
  );
});

test("MADD encodes multiply-add and MUL as MADD with the zero register", () => {
  // As assembled by llvm-mc: mul w9, w13, w9; madd w0, w1, w2, w3;
  // mul x9, x10, x11; madd x2, x3, x4, x5.
  const cases: [Parameters<typeof encode>[0], number][] = [
    [{ op: "madd", width: 32, rd: 9, rn: 13, rm: 9, ra: "zr" }, 0x1b097da9],
    [{ op: "madd", width: 32, rd: 0, rn: 1, rm: 2, ra: 3 }, 0x1b020c20],
    [{ op: "madd", width: 64, rd: 9, rn: 10, rm: 11, ra: "zr" }, 0x9b0b7d49],
    [{ op: "madd", width: 64, rd: 2, rn: 3, rm: 4, ra: 5 }, 0x9b041462],
  ];
  for (const [instruction, value] of cases)
    assert.deepEqual(encode(instruction), { ok: true, value });
  assert.equal(
    encode({ op: "madd", width: 32, rd: 31, rn: 1, rm: 2, ra: 3 }).ok,
    false,
  );
});
