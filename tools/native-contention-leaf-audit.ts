/** Fail-closed audit of the specific public NativeModule helper byte range.
 * This is a fixture verifier, not a general AArch64 decoder or new native ABI. */
import assert from "node:assert/strict";
import { encode, type Instruction } from "@tint/codegen/aarch64/isa";
export function auditContentionLeaf(bytes: Uint8Array) {
  assert.ok(bytes.length > 0 && bytes.length % 4 === 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    words = Array.from({ length: bytes.length / 4 }, (_, i) =>
      view.getUint32(i * 4, true),
    );
  const widths = new Set<number>();
  let loads = 0,
    stores = 0,
    barriers = 0,
    clears = 0,
    branches = 0;
  const matches = (word: number, mask: number, value: number) =>
    (word & mask) >>> 0 === value;
  function registers(word: number, fields: readonly number[]) {
    for (const shift of fields) {
      const r = (word >>> shift) & 31;
      assert.ok(r < 16 || r === 31, "no callee-saved/context register access");
    }
  }
  for (const [index, word] of words.entries()) {
    if (
      matches(word, 0xfc000000, 0x14000000) ||
      matches(word, 0xff000010, 0x54000000)
    ) {
      const conditional = matches(word, 0xff000010, 0x54000000),
        bits = conditional ? 19 : 26;
      let displacement = conditional
        ? (word >>> 5) & 0x7ffff
        : word & 0x3ffffff;
      if (displacement >= 2 ** (bits - 1)) displacement -= 2 ** bits;
      const target = index + displacement;
      assert.ok(
        target >= 0 && target < words.length,
        "branch must remain in extracted leaf",
      );
      branches++;
      continue;
    }
    if (word === 0xd65f03c0) continue; // ret x30; no other return register is accepted.
    if (word === 0xd5033bbf) {
      barriers++;
      continue;
    }
    if (word === 0xd5033f5f) {
      clears++;
      continue;
    }
    if (matches(word, 0x3ffffc00, 0x085ffc00)) {
      const size = word >>> 30;
      assert.ok(size <= 2);
      assert.equal((word >>> 5) & 31, 10);
      assert.equal(word & 31, 11);
      widths.add(2 ** size);
      loads++;
      continue;
    }
    if (matches(word, 0x3fe0fc00, 0x0800fc00)) {
      const size = word >>> 30;
      assert.ok(size <= 2);
      assert.equal((word >>> 5) & 31, 10);
      assert.equal((word >>> 16) & 31, 9);
      assert.equal(word & 31, 13);
      stores++;
      continue;
    }
    if (
      matches(word, 0xff800000, 0xd2800000) ||
      matches(word, 0xff800000, 0xf2800000)
    ) {
      registers(word, [0]);
      continue;
    }
    if (matches(word, 0xffc00000, 0xd3400000)) {
      registers(word, [0, 5]);
      continue;
    }
    if (matches(word, 0xff000000, 0xd1000000)) {
      registers(word, [0, 5]);
      assert.notEqual((word >>> 5) & 31, 31);
      continue;
    }
    if (
      matches(word, 0xffe0fc00, 0x9ac02000) ||
      matches(word, 0xffe0fc00, 0xaa000000) ||
      matches(word, 0xffe0fc00, 0xaa200000) ||
      matches(word, 0xffe0fc00, 0x8a000000) ||
      matches(word, 0xffe0fc00, 0x8b000000) ||
      matches(word, 0xffe0fc00, 0xeb000000) ||
      matches(word, 0xffe0fc00, 0xcb000000)
    ) {
      registers(word, [0, 5, 16]);
      continue;
    }
    assert.fail(
      "unapproved instruction (call/address/literal/context/stack/memory) 0x" +
        word.toString(16),
    );
  }
  function contains(instruction: Instruction) {
    const result = encode(instruction);
    assert.ok(result.ok);
    assert.ok(words.includes(result.value), JSON.stringify(instruction));
  }
  // Independently verify the raw register adapter and its sole payload address.
  for (const [rd, rm] of [
    [8, 3],
    [14, 4],
    [13, 5],
    [0, 11],
  ])
    contains({ op: "orr-reg", width: 64, rd: rd!, rn: "zr", rm: rm! });
  contains({
    op: "add-reg",
    width: 64,
    rd: 10,
    rn: 0,
    rm: 2,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  assert.equal(loads, 3);
  assert.equal(stores, 3);
  assert.equal(barriers, 2);
  assert.equal(clears, 1);
  return {
    bytes: bytes.length,
    instructions: words.length,
    internalBranches: branches,
    widths: [...widths].sort(),
    contextAccesses: 0,
    externalRelocations: 0,
    rawArguments:
      "x0=base,x1=extent,x2=offset,x3=width,x4=expected,x5=replacement; x0=observed or -1",
    preserved: "x16..x29 and FP/SIMD; x0..x15 and flags clobbered",
    memory:
      "only LDAXR/STLXR payload accesses through x10=base+offset; no literal loads, stack/context/GC/managed memory accesses",
  };
}
