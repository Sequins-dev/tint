import assert from "node:assert/strict";
import { test } from "node:test";
import { measureBenchmark, type BenchContext } from "../src/index.ts";

test("warmups are unreported and only the explicit measured interval is timed", () => {
  let tick = 0;
  const phases: string[] = [];
  const result = measureBenchmark(
    "work",
    { warmup: 2, samples: 3 },
    (b) => {
      phases.push(b.phase + ":" + b.index);
      tick += 100;
      b.start();
      tick += 2;
      b.end(4);
      tick += 100;
    },
    () => tick,
  );
  assert.deepEqual(phases, [
    "warmup:0",
    "warmup:1",
    "measurement:0",
    "measurement:1",
    "measurement:2",
  ]);
  assert.equal(result.name, "work");
  assert.equal(result.samples.length, 3);
  assert.deepEqual(result.samples[0], {
    duration_ns: 2000000,
    operations: 4,
    rate: 2000,
  });
});
test("timing misuse, invalid counts and non-monotonic clocks fail explicitly", () => {
  let tick = 0;
  const now = () => ++tick;
  for (const body of [
    (b: BenchContext) => {},
    (b: BenchContext) => b.end(1),
    (b: BenchContext) => {
      b.start();
      b.start();
    },
    (b: BenchContext) => {
      b.start();
      b.end(1);
      b.end(1);
    },
    (b: BenchContext) => {
      b.start();
      b.end(0);
    },
    (b: BenchContext) => {
      b.start();
      b.end(1.5);
    },
  ])
    assert.throws(() =>
      measureBenchmark("bad", { warmup: 0, samples: 1 }, body, now),
    );
  for (const samples of [0, -1, 1.5, Infinity, 4294967296])
    assert.throws(() => measureBenchmark("bad", { samples }, () => {}, now));
  assert.throws(() =>
    measureBenchmark(
      "bad",
      { warmup: 0, samples: 1 },
      (b) => {
        b.start();
        b.end(1);
      },
      () => 0,
    ),
  );
  assert.throws(() =>
    measureBenchmark(
      "bad",
      { warmup: 0, samples: 1 },
      (b) => {
        b.start();
        b.end(1);
      },
      () => --tick,
    ),
  );
});
