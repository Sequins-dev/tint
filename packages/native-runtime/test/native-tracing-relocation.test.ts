import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeHeaderFlagUnit } from "@tint/abi/host";
import { relocateNativeArrayData } from "../src/tracing/relocation.ts";
// Typed arrays: header (marker + kind flags * 2^48), length +8, data +16;
// owned elements are inline at +24, where a view (flag 2) holds its owner.
const view = 4 + 2 * nativeHeaderFlagUnit;
function fixture() {
  const words = new Map<number, number>([
    [256, 4],
    [264, 16],
    [272, 280],
    [512, view],
    [520, 8],
    [528, 296],
    [536, 256],
    [768, view],
    [776, 2],
    [784, 304],
    [792, 512],
  ]);
  return {
    words,
    read: (address: number) => words.get(address),
    forward: (address: number) => (address === 256 ? 128 : undefined),
  };
}
test("owned arrays and nested views follow the terminal backing allocation", () => {
  const { read, forward, words } = fixture(),
    before = new Map(words);
  assert.equal(relocateNativeArrayData(read, 256, forward), 152);
  assert.equal(relocateNativeArrayData(read, 512, forward), 168);
  assert.equal(relocateNativeArrayData(read, 768, forward), 176);
  assert.deepEqual(words, before);
});
test("borrowed backing pointers remain stable even when view headers move", () => {
  const { read, words } = fixture();
  words.set(256, 4 + nativeHeaderFlagUnit);
  words.set(272, 8192);
  words.set(528, 8208);
  words.set(784, 8216);
  assert.equal(
    relocateNativeArrayData(read, 768, () => {
      throw Error("external backing must not be forwarded");
    }),
    8216,
  );
});
test("empty one-past views are valid while out-of-range and malformed owners fail", () => {
  const { read, forward, words } = fixture();
  words.set(520, 0);
  words.set(528, 344);
  assert.equal(relocateNativeArrayData(read, 512, forward), 216);
  words.set(528, 348);
  assert.equal(relocateNativeArrayData(read, 512, forward), undefined);
  words.set(528, 344);
  words.set(520, 1);
  assert.equal(relocateNativeArrayData(read, 512, forward), undefined);
  for (const bad of [1, 6, 4096]) {
    words.set(256, bad);
    assert.equal(relocateNativeArrayData(read, 256, forward), undefined);
  }
});
test("missing forwarding, invalid pointers, cycles and traversal limits fail without writes", () => {
  const { read, forward, words } = fixture();
  assert.equal(relocateNativeArrayData(read, 768, forward, 2), undefined);
  assert.equal(relocateNativeArrayData(read, 768, forward, 3), 176);
  assert.equal(
    relocateNativeArrayData(read, 256, () => undefined),
    undefined,
  );
  assert.equal(
    relocateNativeArrayData(read, 256, () => 3),
    undefined,
  );
  words.set(272, 288);
  assert.equal(relocateNativeArrayData(read, 256, forward), undefined);
  words.set(272, 280);
  words.set(256, view);
  words.set(280, 256);
  const before = new Map(words);
  assert.equal(relocateNativeArrayData(read, 256, forward, 3), undefined);
  for (const limit of [-1, 0, 1.5, NaN, Infinity])
    assert.equal(relocateNativeArrayData(read, 256, forward, limit), undefined);
  assert.deepEqual(words, before);
});

test("derived byte offsets remain exact near the safe-integer address ceiling", () => {
  const base = 9007199254739968;
  const words = new Map<number, number>([
    [base, 2],
    [base + 8, 64],
    [base + 16, base + 24],
    [256, 2 + 2 * nativeHeaderFlagUnit],
    [264, 1],
    [272, base + 25],
    [280, base],
  ]);
  assert.equal(
    relocateNativeArrayData(
      (a) => words.get(a),
      256,
      () => base - 128,
    ),
    base - 103,
  );
});
