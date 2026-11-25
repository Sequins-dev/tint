import assert from "node:assert/strict";
import test from "node:test";
import { encode, type Instruction } from "../src/aarch64/isa.ts";

// Expected words from `llvm-mc -triple aarch64 -mattr=+sha2 -show-encoding`
// (vector, SHA-256 and cache-zeroing instructions).
const cases: readonly [Instruction, number][] = [
  [{ op: "ldr-q", qt: 4, rn: 13, offset: 48 }, 0x3dc00da4],
  [{ op: "str-q", qt: 5, rn: 13, offset: 80 }, 0x3d8015a5],
  [{ op: "add-4s", vd: 3, vn: 3, vm: 6 }, 0x4ea68463],
  [{ op: "mov-16b", vd: 2, vn: 0 }, 0x4ea01c02],
  [{ op: "sha256h", vd: 0, vn: 1, vm: 3 }, 0x5e034020],
  [{ op: "sha256h2", vd: 1, vn: 2, vm: 3 }, 0x5e035041],
  [{ op: "sha256su0", vd: 4, vn: 5 }, 0x5e2828a4],
  [{ op: "sha256su1", vd: 4, vn: 6, vm: 7 }, 0x5e0760c4],
  [{ op: "uxtl-8h", vd: 0, vn: 1 }, 0x2f08a420],
  [{ op: "xtn-8b", vd: 2, vn: 3 }, 0x0e212862],
  [{ op: "shrn-8b-8", vd: 4, vn: 5 }, 0x0f0884a4],
  // Bytewise lane operations, as assembled by clang.
  [{ op: "sub-16b", vd: 1, vn: 0, vm: 2 }, 0x6e228401],
  [{ op: "sub-16b", vd: 9, vn: 10, vm: 11 }, 0x6e2b8549],
  [{ op: "cmhi-16b", vd: 3, vn: 4, vm: 1 }, 0x6e213483],
  [{ op: "and-16b", vd: 1, vn: 3, vm: 5 }, 0x4e251c61],
  [{ op: "eor-16b", vd: 0, vn: 0, vm: 1 }, 0x6e211c00],
  [{ op: "movi-16b", vd: 2, immediate: 0x61 }, 0x4f03e422],
  [{ op: "movi-16b", vd: 4, immediate: 26 }, 0x4f00e744],
  [{ op: "movi-16b", vd: 5, immediate: 0x20 }, 0x4f01e405],
  [{ op: "movi-16b", vd: 31, immediate: 0xff }, 0x4f07e7ff],
  [{ op: "dc-zva", rt: 13 }, 0xd50b742d],
  [{ op: "mrs-dczid", rt: 15 }, 0xd53b00ef],
];

test("vector, SHA-256 and cache-zeroing instructions encode as the reference assembler does", () => {
  for (const [instruction, expected] of cases) {
    const result = encode(instruction);
    assert.ok(result.ok, instruction.op);
    assert.equal(result.value >>> 0, expected, instruction.op);
  }
});

test("vector loads and stores reject unaligned or out-of-range offsets", () => {
  assert.equal(encode({ op: "ldr-q", qt: 0, rn: 1, offset: 8 }).ok, false);
  assert.equal(encode({ op: "str-q", qt: 0, rn: 1, offset: 65536 }).ok, false);
  assert.equal(encode({ op: "ldr-q", qt: 32, rn: 1, offset: 0 }).ok, false);
  assert.equal(encode({ op: "ldr-q", qt: 0, rn: "sp", offset: 16 }).ok, true);
});
