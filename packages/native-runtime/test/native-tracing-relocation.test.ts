import assert from "node:assert/strict";
import { test } from "node:test";
import { relocateNativeArrayData } from "../src/tracing/relocation.ts";
function fixture() {
  const words = new Map<number, number>([
    [256, 4],
    [264, 0],
    [272, 16],
    [280, 288],
    [512, 4],
    [520, 2],
    [528, 8],
    [536, 304],
    [544, 256],
    [768, 4],
    [776, 2],
    [784, 2],
    [792, 312],
    [800, 512],
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
  assert.equal(relocateNativeArrayData(read, 256, forward), 160);
  assert.equal(relocateNativeArrayData(read, 512, forward), 176);
  assert.equal(relocateNativeArrayData(read, 768, forward), 184);
  assert.deepEqual(words, before);
});
test("borrowed backing pointers remain stable even when view headers move", () => {
  const { read, words } = fixture();
  words.set(264, 1);
  words.set(280, 8192);
  words.set(536, 8208);
  words.set(792, 8216);
  assert.equal(
    relocateNativeArrayData(read, 768, () => {
      throw Error("external backing must not be forwarded");
    }),
    8216,
  );
});
test("empty one-past views are valid while out-of-range and malformed owners fail", () => {
  const { read, forward, words } = fixture();
  words.set(528, 0);
  words.set(536, 352);
  assert.equal(relocateNativeArrayData(read, 512, forward), 224);
  words.set(536, 356);
  assert.equal(relocateNativeArrayData(read, 512, forward), undefined);
  words.set(536, 352);
  words.set(528, 1);
  assert.equal(relocateNativeArrayData(read, 512, forward), undefined);
  for (const bad of [1, 6, 4096]) {
    words.set(256, bad);
    assert.equal(relocateNativeArrayData(read, 256, forward), undefined);
  }
});
test("missing forwarding, invalid pointers, cycles and traversal limits fail without writes", () => {
  const { read, forward, words } = fixture();
  assert.equal(relocateNativeArrayData(read, 768, forward, 2), undefined);
  assert.equal(relocateNativeArrayData(read, 768, forward, 3), 184);
  assert.equal(
    relocateNativeArrayData(read, 256, () => undefined),
    undefined,
  );
  assert.equal(
    relocateNativeArrayData(read, 256, () => 3),
    undefined,
  );
  words.set(280, 296);
  assert.equal(relocateNativeArrayData(read, 256, forward), undefined);
  words.set(280, 288);
  words.set(264, 2);
  words.set(288, 256);
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
    [base + 8, 0],
    [base + 16, 64],
    [base + 24, base + 32],
    [256, 2],
    [264, 2],
    [272, 1],
    [280, base + 33],
    [288, base],
  ]);
  assert.equal(
    relocateNativeArrayData(
      (a) => words.get(a),
      256,
      () => base - 128,
    ),
    base - 95,
  );
});
