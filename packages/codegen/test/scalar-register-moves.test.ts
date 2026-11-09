import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWordBuffer,
  appendWord,
  readWord,
} from "@tint/foundation/binary/word-buffer";
import { forwardRegisterRoundTrips } from "../src/aarch64/scalar/register-moves.ts";
import { encode } from "../src/aarch64/isa.ts";

function words(...instructions: Parameters<typeof encode>[0][]) {
  const buffer = createWordBuffer();
  for (const instruction of instructions) {
    const encoded = encode(instruction);
    assert.ok(encoded.ok, JSON.stringify(encoded));
    appendWord(buffer, encoded.value);
  }
  return buffer;
}
const word = (instruction: Parameters<typeof encode>[0]) => {
  const encoded = encode(instruction);
  assert.ok(encoded.ok);
  return encoded.value;
};

test("a scalar-register write read straight back becomes an integer move", () => {
  const code = words(
    { op: "fmov-d-x", rd: 16, rn: 11 },
    { op: "fmov-x-d", rd: 9, rn: 16 },
    { op: "fmov-d-x", rd: 17, rn: "zr" },
    { op: "fmov-x-d", rd: 10, rn: 17 },
    { op: "fmov-d-x", rd: 16, rn: 12 },
    { op: "fmov-x-d", rd: 9, rn: 18 },
  );
  assert.equal(forwardRegisterRoundTrips(code, 0, code.length, [0]), 2);
  assert.equal(
    readWord(code, 1),
    word({ op: "orr-reg", width: 64, rd: 9, rn: "zr", rm: 11 }),
  );
  assert.equal(
    readWord(code, 3),
    word({ op: "orr-reg", width: 64, rd: 10, rn: "zr", rm: "zr" }),
  );
  // Different FP register: the read is not of the value just written.
  assert.equal(readWord(code, 5), word({ op: "fmov-x-d", rd: 9, rn: 18 }));
});

test("a read that another path can reach keeps its cross-bank move", () => {
  const branched = words(
    { op: "b", displacement: 8 },
    { op: "fmov-d-x", rd: 16, rn: 11 },
    { op: "fmov-x-d", rd: 9, rn: 16 },
    { op: "cbnz", width: 64, rt: 3, displacement: -4 },
    { op: "fmov-d-x", rd: 16, rn: 11 },
    { op: "fmov-x-d", rd: 9, rn: 16 },
  );
  // Index 2 is a local branch target; index 5 is a block entry patched later.
  assert.equal(
    forwardRegisterRoundTrips(branched, 0, branched.length, [0, 5]),
    0,
  );
  assert.equal(readWord(branched, 2), word({ op: "fmov-x-d", rd: 9, rn: 16 }));
  assert.equal(readWord(branched, 5), word({ op: "fmov-x-d", rd: 9, rn: 16 }));
  assert.equal(forwardRegisterRoundTrips(branched, 0, 3, [0]), 0);
  assert.equal(forwardRegisterRoundTrips(branched, 3, 6, [3]), 1);
});

test("adjacent stack reloads reuse the register that already holds the slot", () => {
  const code = words(
    { op: "str", width: 64, rt: 9, rn: "sp", offset: 0x168 },
    { op: "ldr", width: 64, rt: 9, rn: "sp", offset: 0x168 },
    { op: "ldr", width: 64, rt: 10, rn: "sp", offset: 0x168 },
    { op: "str", width: 64, rt: "zr", rn: "sp", offset: 0x40 },
    { op: "ldr", width: 64, rt: 11, rn: "sp", offset: 0x40 },
    { op: "ldr", width: 64, rt: 12, rn: "sp", offset: 0x48 },
    { op: "str", width: 32, rt: 13, rn: "sp", offset: 0x50 },
    { op: "ldr", width: 64, rt: 13, rn: "sp", offset: 0x50 },
  );
  assert.equal(forwardRegisterRoundTrips(code, 0, code.length, [0]), 3);
  assert.equal(readWord(code, 1), 0xd503201f);
  assert.equal(
    readWord(code, 2),
    word({ op: "orr-reg", width: 64, rd: 10, rn: "zr", rm: 9 }),
  );
  assert.equal(
    readWord(code, 4),
    word({ op: "orr-reg", width: 64, rd: 11, rn: "zr", rm: "zr" }),
  );
  // Different slot, and a 32-bit store, are not forwarded.
  assert.equal(
    readWord(code, 5),
    word({ op: "ldr", width: 64, rt: 12, rn: "sp", offset: 0x48 }),
  );
  assert.equal(
    readWord(code, 7),
    word({ op: "ldr", width: 64, rt: 13, rn: "sp", offset: 0x50 }),
  );
});

test("a stack reload at a branch target is kept", () => {
  const code = words(
    { op: "str", width: 64, rt: 9, rn: "sp", offset: 0x20 },
    { op: "ldr", width: 64, rt: 9, rn: "sp", offset: 0x20 },
    { op: "cbz", width: 64, rt: 9, displacement: -4 },
  );
  assert.equal(forwardRegisterRoundTrips(code, 0, code.length, [0]), 0);
  assert.equal(
    readWord(code, 1),
    word({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 0x20 }),
  );
});
