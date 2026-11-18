import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encode,
  farRelativeAddress,
  farRelativeAddressLimit,
  patchRelativeAddress,
  relativeAddress,
  relativeAddressByteLength,
  writeInstruction,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

function words(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    result: number[] = [];
  for (let at = 0; at < bytes.length; at += 4)
    result.push(view.getUint32(at, true));
  return result;
}
/** The address a patched ADR/MOVZ/MOVK.../ADD|SUB sequence computes at `site`. */
function evaluate(sequence: readonly number[], site: number): number {
  const adr = sequence[0] ?? 0;
  assert.equal(adr & 0x9f000000, 0x10000000, "ADR first");
  let magnitude = 0;
  for (let index = 1; index < sequence.length - 1; index++) {
    const word = sequence[index] ?? 0,
      imm = (word >>> 5) & 0xffff,
      hw = (word >>> 21) & 3;
    magnitude += imm * 2 ** (16 * hw);
  }
  const last = sequence[sequence.length - 1] ?? 0;
  const subtract = (last & 0xff000000) >>> 0 === 0xcb000000;
  return site + (subtract ? -magnitude : magnitude);
}
function placeholder(far: boolean): Uint8Array {
  const sequence = far
    ? farRelativeAddress(9, 17, 0)
    : relativeAddress(9, 17, 0);
  assert.ok(sequence.ok);
  const bytes = new Uint8Array(relativeAddressByteLength(far) + 8);
  sequence.value.forEach((instruction: Instruction, index: number) =>
    assert.ok(writeInstruction(bytes, index * 4, instruction).ok),
  );
  return bytes;
}

test("far relative addresses reach 48-bit displacements in both directions", () => {
  for (const displacement of [
    0,
    4,
    0xffffffff,
    0x100000000,
    -0x100000000,
    5 * 2 ** 30 + 12,
    -(7 * 2 ** 30 + 4096),
    farRelativeAddressLimit,
    -farRelativeAddressLimit,
  ]) {
    const sequence = farRelativeAddress(9, 17, displacement);
    assert.ok(sequence.ok, String(displacement));
    assert.equal(sequence.value.length, 5);
    const encoded = sequence.value.map((instruction) => {
      const word = encode(instruction);
      assert.ok(word.ok);
      return word.value;
    });
    assert.equal(evaluate(encoded, 0x4000), 0x4000 + displacement);
  }
  for (const displacement of [
    farRelativeAddressLimit + 1,
    -farRelativeAddressLimit - 1,
    0.5,
    NaN,
  ])
    assert.deepEqual(farRelativeAddress(9, 17, displacement), {
      ok: false,
      error: "OUT_OF_RANGE",
    });
  assert.equal(farRelativeAddress(9, 9, 0).ok, false);
});

test("patching recognizes far sites and never truncates a near one", () => {
  const near = placeholder(false),
    before = near.slice();
  // A near site cannot reach 4 GiB: the patch fails and leaves it intact.
  assert.deepEqual(
    patchRelativeAddress(near, {
      offset: 0,
      targetOffset: 0x100000000,
      rd: 9,
      scratch: 17,
    }),
    { ok: false, error: "OUT_OF_RANGE" },
  );
  assert.deepEqual(near, before);
  assert.ok(
    patchRelativeAddress(near, {
      offset: 0,
      targetOffset: 0xfffffff0,
      rd: 9,
      scratch: 17,
    }).ok,
  );
  assert.equal(evaluate(words(near).slice(0, 4), 0), 0xfffffff0);
  // The trailing words after the site are untouched.
  assert.deepEqual(words(near).slice(4), [0, 0]);

  for (const target of [0x100000000, 9 * 2 ** 30 + 0x1234 * 4]) {
    const far = placeholder(true);
    assert.ok(
      patchRelativeAddress(far, {
        offset: 0,
        targetOffset: target,
        rd: 9,
        scratch: 17,
      }).ok,
    );
    assert.equal(evaluate(words(far).slice(0, 5), 0), target);
    assert.deepEqual(words(far).slice(5), [0, 0]);
  }
  // Backwards from a site beyond 4 GiB (the buffer only needs the site).
  const far = placeholder(true),
    sized = new Uint8Array(far.length);
  sized.set(far);
  const patched = patchRelativeAddress(sized, {
    offset: 0,
    targetOffset: 0,
    rd: 9,
    scratch: 17,
  });
  assert.ok(patched.ok);
  // A mismatched register leaves the far site untouched.
  const intact = placeholder(true),
    copy = intact.slice();
  assert.equal(
    patchRelativeAddress(intact, {
      offset: 0,
      targetOffset: 8,
      rd: 10,
      scratch: 17,
    }).ok,
    false,
  );
  assert.deepEqual(intact, copy);
});
