import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encode,
  writeInstruction,
  patchAddress,
  pageAddress,
  patchPageAddress,
} from "@tint/codegen/aarch64/isa";
test("ADR exact signed byte displacements and split immediate encoding", () => {
  for (const [displacement, expected] of [
    [0, 0x10000007],
    [1, 0x30000007],
    [-1, 0x70ffffe7],
    [-1048576, 0x10800007],
    [1048575, 0x707fffe7],
  ]) {
    assert.deepEqual(
      encode({ op: "adr", rd: 7, displacement: displacement! }),
      { ok: true, value: expected },
    );
  }
  for (const displacement of [-1048577, 1048576, NaN, 0.5])
    assert.equal(encode({ op: "adr", rd: 0, displacement }).ok, false);
  assert.equal(encode({ op: "adr", rd: 31, displacement: 0 }).ok, false);
});
test("address patches retain register and opcode and reject failures atomically", () => {
  const bytes = new Uint8Array(12);
  assert.equal(
    writeInstruction(bytes, 4, { op: "adr", rd: 5, displacement: 0 }).ok,
    true,
  );
  assert.deepEqual(
    patchAddress(bytes, { offset: 4, targetOffset: 11, rd: 5 }),
    { ok: true, value: undefined },
  );
  assert.equal(new DataView(bytes.buffer).getUint32(4, true), 0x70000025);
  for (const fixup of [
    { offset: 4, targetOffset: 11, rd: 6 },
    { offset: 0, targetOffset: 11, rd: 5 },
    { offset: 2, targetOffset: 11, rd: 5 },
    { offset: 12, targetOffset: 11, rd: 5 },
    { offset: 4, targetOffset: -1, rd: 5 },
    { offset: 4, targetOffset: 1048580, rd: 5 },
  ]) {
    const before = bytes.slice();
    assert.equal(patchAddress(bytes, fixup).ok, false);
    assert.deepEqual(bytes, before);
  }
});
test("long relative addresses cover both directions without page alignment assumptions", async () => {
  const { relativeAddress, patchRelativeAddress } =
    await import("@tint/codegen/aarch64/isa");
  for (const displacement of [0, 1048576, -1048577, 0xffffffff, -0xffffffff]) {
    const sequence = relativeAddress(9, 17, 0);
    assert.ok(sequence.ok);
    const offset = displacement < 0 ? -displacement : 0;
    // Code offsets need not match virtual page alignment. Keep the actual
    // patch small while testing displacement arithmetic separately.
    const generated = relativeAddress(9, 17, displacement);
    assert.ok(generated.ok);
    assert.equal(generated.value.length, 4);
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 4; i++)
      assert.ok(writeInstruction(bytes, i * 4, sequence.value[i]!).ok);
    if (offset === 0) {
      assert.ok(
        patchRelativeAddress(bytes, {
          offset: 0,
          targetOffset: displacement,
          rd: 9,
          scratch: 17,
        }).ok,
      );
      for (let i = 0; i < 4; i++)
        assert.equal(
          new DataView(bytes.buffer).getUint32(i * 4, true),
          (encode(generated.value[i]!) as { ok: true; value: number }).value,
        );
    }
  }
  const bad = new Uint8Array(16),
    before = bad.slice();
  assert.equal(
    patchRelativeAddress(bad, {
      offset: 0,
      targetOffset: 2000000,
      rd: 9,
      scratch: 17,
    }).ok,
    false,
  );
  assert.deepEqual(bad, before);
  assert.equal(relativeAddress(9, 9, 0).ok, false);
  assert.equal(relativeAddress(9, 17, 0x100000000).ok, false);
});

test("ADRP signed page displacements and split immediate encoding", () => {
  for (const [pages, expected] of [
    [0, 0x90000007],
    [1, 0xb0000007],
    [-1, 0xf0ffffe7],
    [-1048576, 0x90800007],
    [1048575, 0xf07fffe7],
  ]) {
    assert.deepEqual(encode({ op: "adrp", rd: 7, pages: pages! }), {
      ok: true,
      value: expected,
    });
  }
  for (const pages of [-1048577, 1048576, NaN, 0.5])
    assert.equal(encode({ op: "adrp", rd: 0, pages }).ok, false);
});
test("page address patches compute page deltas and low bits from a 4 KiB aligned base", () => {
  function read(bytes: Uint8Array, at: number): number {
    return (
      ((bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16) |
        ((bytes[at + 3] ?? 0) << 24)) >>>
      0
    );
  }
  // Decode ADRP+ADD back to the address relative to the shared base.
  function resolve(bytes: Uint8Array, at: number): number {
    const adrp = read(bytes, at),
      add = read(bytes, at + 4);
    const immlo = (adrp >>> 29) & 3,
      immhi = (adrp >>> 5) & 0x7ffff;
    let pages = immhi * 4 + immlo;
    if (pages >= 1048576) pages -= 2097152;
    const low = (add >>> 10) & 0xfff;
    return (Math.floor(at / 4096) + pages) * 4096 + low;
  }
  for (const [site, target] of [
    [0, 0],
    [4092, 4096],
    [4096, 4092],
    [8, 0x123456],
    [0x7ff8, 16],
    [0x200000, 0x1fff0],
  ]) {
    const bytes = new Uint8Array(Math.max(site!, target!) + 16);
    const template = pageAddress(3, 0, 0);
    assert.ok(template.ok);
    template.value.forEach((instruction, index) => {
      assert.ok(writeInstruction(bytes, site! + index * 4, instruction).ok);
    });
    assert.deepEqual(
      patchPageAddress(bytes, { offset: site!, targetOffset: target!, rd: 3 }),
      { ok: true, value: undefined },
    );
    assert.equal(resolve(bytes, site!), target);
    assert.equal(read(bytes, site!) & 31, 3);
    // A patched site no longer matches the placeholder.
    assert.deepEqual(
      patchPageAddress(bytes, { offset: site!, targetOffset: 0, rd: 3 }).ok,
      target === 0 && Math.floor(site! / 4096) === 0,
    );
  }
});
