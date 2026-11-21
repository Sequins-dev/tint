import assert from "node:assert/strict";
import { test } from "node:test";
import {
  benchmarkBody,
  caseTiming,
  cpuIdlePercent,
  pairedOverheadChange,
  roundOrder,
} from "./node-ffi-benchmark.ts";

test("typed literal and runtime workloads retain the typed loop and call result", () => {
  const literal = benchmarkBody("/fixture.dylib", true, true, 10, 2);
  const runtime = benchmarkBody("/fixture.dylib", false, true, 10, 2);
  for (const source of [literal, runtime]) {
    assert.match(source, /function run\(\): number/);
    assert.match(source, /operation: \(\) => number/);
    assert.match(source, /\(\): number => f0\(\) as number/);
    assert.match(
      source,
      /measure\("js-only-control", \(\): number => 42, 42\)/,
    );
  }
  assert.match(literal, /dlopen\("\/fixture\.dylib", \{/);
  assert.match(runtime, /dlopen\("\/fixture\.dylib", definitions\)/);
  assert.doesNotMatch(
    benchmarkBody("/fixture.dylib", true, false, 10, 2),
    /operation:/,
  );
});

test("overhead subtracts the control from the same round", () => {
  const timing = caseTiming(
    [
      { case: "arity-0", round: 0, milliseconds: 60, checksum: 1 },
      { case: "js-only-control", round: 0, milliseconds: 50, checksum: 42 },
      { case: "arity-0", round: 1, milliseconds: 20, checksum: 1 },
      { case: "js-only-control", round: 1, milliseconds: 10, checksum: 42 },
      { case: "arity-0", round: 2, milliseconds: 35, checksum: 1 },
      { case: "js-only-control", round: 2, milliseconds: 40, checksum: 42 },
    ],
    "arity-0",
    1000000,
    3,
  );
  assert.deepEqual(timing, {
    callNs: 35,
    controlNs: 40,
    overheadNs: { median: 10, q1: 2.5, q3: 10 },
  });
});

test("candidate comparisons pair overheads in the same round", () => {
  assert.deepEqual(pairedOverheadChange([10, 50, 40], [40, 50, 100]), {
    median: -30,
    q1: -45,
    q3: -15,
  });
});

test("each workload occupies each launch position in a rotation", () => {
  const workloads = ["node", "typed", "candidate"];
  assert.deepEqual(
    workloads.map((_, round) => roundOrder(workloads, round)),
    [
      ["node", "typed", "candidate"],
      ["typed", "candidate", "node"],
      ["candidate", "node", "typed"],
    ],
  );
});

test("idle percentages use deltas rather than cumulative idle", () => {
  assert.equal(
    cpuIdlePercent({ idle: 1000, total: 1000 }, { idle: 1096, total: 1100 }),
    96,
  );
  assert.equal(
    cpuIdlePercent({ idle: 1000, total: 1000 }, { idle: 1095, total: 1100 }),
    95,
  );
  assert.throws(() =>
    cpuIdlePercent({ idle: 1000, total: 1000 }, { idle: 1000, total: 1000 }),
  );
});
