import assert from "node:assert/strict";
import test from "node:test";
import * as durations from "../src/chrono/temporal-duration/index.ts";
test("duration fields enforce common signs and exact aggregate nanosecond limits", () => {
  assert.equal(typeof durations.createDuration, "function");
  assert.equal(durations.createDuration([])?.sign, 0);
  assert.equal(durations.createDuration([-0])?.years, 0);
  assert.equal(durations.createDuration([-1, -2])?.sign, -1);
  for (const fields of [
    [1, -1],
    [NaN],
    [Infinity],
    [1.5],
    [4294967296],
    [0, 4294967296],
    [0, 0, 4294967296],
    [0, 0, 0, 0, 0, 0, 9007199254740992],
  ])
    assert.equal(durations.createDuration(fields), undefined);
  assert.ok(durations.createDuration([4294967295]));
  assert.ok(
    durations.createDuration([
      0, 0, 0, 0, 0, 0, 9007199254740991, 0, 0, 999999999,
    ]),
  );
  assert.equal(
    durations.createDuration([
      0, 0, 0, 0, 0, 0, 9007199254740991, 0, 0, 1000000000,
    ]),
    undefined,
  );
  const ms = 9007199254740992000 - 1024;
  assert.ok(durations.createDuration([0, 0, 0, 0, 0, 0, 0, ms, 0, 1023999999]));
  assert.equal(
    durations.createDuration([0, 0, 0, 0, 0, 0, 0, ms, 0, 1024000000]),
    undefined,
  );
});
test("duration text preserves units while carrying subsecond fields exactly", () => {
  assert.equal(typeof durations.durationText, "function");
  for (const [fields, text] of [
    [[], "PT0S"],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "P1Y2M3W4DT5H6M7.00800901S"],
    [[-1, -2], "-P1Y2M"],
    [[0, 0, 0, 0, 1, 120], "PT1H120M"],
    [[0, 0, 0, 0, 0, 0, 0, 1000], "PT1S"],
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, -1], "-PT0.000000001S"],
  ] as const)
    assert.equal(
      durations.durationText(durations.createDuration(fields)!),
      text,
    );
});

test("aggregate bounds match an independent BigInt calculation near the limit", () => {
  const limit = (1n << 53n) * 1000000000n;
  const factors = [
    86400000000000n,
    3600000000000n,
    60000000000n,
    1000000000n,
    1000000n,
    1000n,
    1n,
  ];
  let seed = 0x4a38b912;
  for (let i = 0; i < 2000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const unit = seed % 7,
      factor = factors[unit]!;
    const base = Number(limit / factor);
    const value = base + (seed % 8192) - 4096;
    const fields = new Array<number>(10).fill(0);
    fields[unit + 3] = value;
    fields[9] = fields[9]! + (seed % 1000);
    let total = 0n;
    for (let k = 3; k < 10; k++) total += BigInt(fields[k]!) * factors[k - 3]!;
    assert.equal(
      durations.createDuration(fields) !== undefined,
      total < limit,
      `unit ${unit}, count ${value}`,
    );
  }
});
