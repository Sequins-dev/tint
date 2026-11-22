import assert from "node:assert/strict";
import { test } from "node:test";
import {
  benchmarkBody,
  caseTiming,
  cpuIdlePercent,
  pairedCaseComparison,
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
    assert.match(
      source,
      /const j2 = \(a0: number, a1: number\): number => 1 \+ a0 \+ a1;/,
    );
    assert.match(
      source,
      /measure\("js-arity-2", \(\): number => j2\(1,1\) as number, 3\)/,
    );
    assert.match(
      source,
      /measure\("js-buffer", \(\): number => bufferShape\(bytes\)/,
    );
    assert.match(
      source,
      /measure\("js-callback", \(\): number => callbackShape\(increment, 41\)/,
    );
  }
  assert.match(literal, /dlopen\("\/fixture\.dylib", \{/);
  assert.match(runtime, /dlopen\("\/fixture\.dylib", definitions\)/);
  const untyped = benchmarkBody("/fixture.dylib", true, false, 10, 2);
  assert.doesNotMatch(untyped, /operation:/);
  assert.match(untyped, /const j0 = \(\) => 1;/);
  assert.match(untyped, /measure\("js-arity-24", \(\) => j24\(/);
});

test("overhead and own cost subtract controls from the same round", () => {
  const timing = caseTiming(
    [
      { case: "arity-0", round: 0, milliseconds: 60, checksum: 1 },
      { case: "js-only-control", round: 0, milliseconds: 50, checksum: 42 },
      { case: "js-arity-0", round: 0, milliseconds: 55, checksum: 1 },
      { case: "arity-0", round: 1, milliseconds: 20, checksum: 1 },
      { case: "js-only-control", round: 1, milliseconds: 10, checksum: 42 },
      { case: "js-arity-0", round: 1, milliseconds: 30, checksum: 1 },
      { case: "arity-0", round: 2, milliseconds: 35, checksum: 1 },
      { case: "js-only-control", round: 2, milliseconds: 40, checksum: 42 },
      { case: "js-arity-0", round: 2, milliseconds: 33, checksum: 1 },
    ],
    "arity-0",
    1000000,
    3,
  );
  assert.deepEqual(timing, {
    callNs: 35,
    controlNs: 40,
    overheadNs: { median: 10, q1: 2.5, q3: 10 },
    shapeNs: 33,
    ownNs: { median: 2, q1: -4, q3: 3.5 },
  });
  assert.throws(
    () =>
      caseTiming(
        [
          { case: "arity-0", round: 0, milliseconds: 60, checksum: 1 },
          { case: "js-only-control", round: 0, milliseconds: 50, checksum: 42 },
        ],
        "arity-0",
        1000000,
        1,
      ),
    /incomplete paired samples/,
  );
});

test("parity requires paired total time and overhead; own parity uses the shape twin", () => {
  const candidate = [
    { call: 17, control: 10, overhead: 7, shape: 15, own: 2 },
    { call: 12, control: 10, overhead: 2, shape: 11, own: 1 },
    { call: 11, control: 8, overhead: 3, shape: 8, own: 3 },
  ];
  const reference = [
    { call: 14, control: 2, overhead: 12, shape: 2, own: 12 },
    { call: 10, control: 2, overhead: 8, shape: 2, own: 8 },
    { call: 12, control: 3, overhead: 9, shape: 3, own: 9 },
  ];
  assert.deepEqual(pairedCaseComparison(candidate, reference), {
    overheadNs: { median: -6, q1: -6, q3: -5.5 },
    callNs: { median: 2, q1: 0.5, q3: 2.5 },
    ownNs: { median: -7, q1: -8.5, q3: -6.5 },
    parity: false,
    ownParity: true,
  });
  assert.equal(pairedCaseComparison(reference, candidate).parity, false);
  assert.equal(pairedCaseComparison(reference, reference).parity, true);
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
  assert.equal(
    cpuIdlePercent({ idle: 1000, total: 1000 }, { idle: 1000, total: 1000 }),
    null,
  );
});
