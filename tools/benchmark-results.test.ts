import assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarizeSamples,
  readNodeSamples,
  readNativeSamples,
  compareBenchmarks,
} from "./benchmark-results.ts";
const samples = [
  { index: 0, duration_ns: 100, operations: 2 },
  { index: 1, duration_ns: 300, operations: 2 },
  { index: 2, duration_ns: 200, operations: 2 },
];
test("comparison uses per-operation distributions and retains raw samples", () => {
  const summary = summarizeSamples(samples);
  assert.equal(summary.medianNsPerOperation, 100);
  assert.equal(summary.meanNsPerOperation, 100);
  assert.equal(summary.samples.length, 3);
  assert.ok(summary.noisy);
  const result = compareBenchmarks(
    new Map([["work", samples]]),
    new Map([
      ["work", samples.map((s) => ({ ...s, duration_ns: s.duration_ns * 2 }))],
    ]),
  );
  assert.equal(result[0]?.nativeToNode, 2);
});
test("incomplete, duplicate and invalid measurements cannot be reported as improvements", () => {
  for (const bad of [0, -1, Infinity, NaN])
    assert.throws(() =>
      summarizeSamples([{ index: 0, duration_ns: bad, operations: 1 }]),
    );
  assert.throws(() =>
    readNativeSamples(
      '{"name":"x","index":0,"duration_ns":100,"operations":1}\n',
    ),
  );
  assert.throws(() => readNativeSamples('{"completed":1}\n'));
  assert.throws(() =>
    readNodeSamples('{"type":"bench:summary","data":{"success":false}}\n'),
  );
  assert.throws(() =>
    compareBenchmarks(new Map([["x", samples]]), new Map([["y", samples]])),
  );
});
test("real runner record shapes normalize to the same benchmark identity", () => {
  const node = readNodeSamples(
    JSON.stringify({
      type: "bench:sample",
      data: {
        namePath: ["suite", "x"],
        index: 0,
        duration_ns: "120",
        operations: 4,
      },
    }) +
      "\n" +
      JSON.stringify({
        type: "bench:summary",
        data: { success: true, counts: { completed: 1, failed: 0, total: 1 } },
      }),
  );
  const native = readNativeSamples(
    "(lldb) run\n" +
      JSON.stringify({
        name: "suite > x",
        index: 0,
        duration_ns: 120,
        operations: 4,
      }) +
      '\n{"completed":1}\n',
  );
  assert.equal(compareBenchmarks(node, native)[0]?.nativeToNode, 1);
});
