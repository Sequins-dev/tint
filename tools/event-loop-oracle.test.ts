import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const oracle = process.env.TINT_NODE_EVENT_LOOP_ORACLE ?? process.execPath;
if (process.env.TINT_NODE_EVENT_LOOP_ORACLE !== undefined) {
  const version = spawnSync(oracle, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "v26.13.1");
}

const entry = `
process.nextTick(() => {
  console.log("tick");
  process.nextTick(() => console.log("tick from tick"));
  queueMicrotask(() => console.log("microtask from tick"));
});
Promise.resolve().then(() => {
  console.log("promise");
  process.nextTick(() => console.log("tick from promise"));
});
queueMicrotask(() => console.log("microtask"));
`;

function trace(mode: "commonjs" | "module", script: string): string[] {
  const result = spawnSync(oracle, ["--input-type=" + mode, "-e", script], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n");
}

test("Node drains recursive ticks and microtasks in separate batches", () => {
  assert.deepEqual(trace("commonjs", entry), [
    "tick",
    "tick from tick",
    "promise",
    "microtask",
    "microtask from tick",
    "tick from promise",
  ]);
});

test("Node finishes the ESM entry microtask batch before running ticks", () => {
  assert.deepEqual(trace("module", entry), [
    "promise",
    "microtask",
    "tick",
    "tick from promise",
    "tick from tick",
    "microtask from tick",
  ]);
});

test("Node checks immediates after I/O and checkpoints between callbacks", () => {
  assert.deepEqual(
    trace(
      "module",
      `
import { readFile } from "node:fs";
readFile(process.execPath, (error) => {
  if (error) throw error;
  console.log("io");
  setTimeout(() => console.log("timer"), 0);
  setImmediate(() => {
    console.log("immediate");
    process.nextTick(() => console.log("immediate tick"));
    queueMicrotask(() => console.log("immediate microtask"));
  });
  setImmediate(() => console.log("second immediate"));
});
`,
    ),
    [
      "io",
      "immediate",
      "immediate tick",
      "immediate microtask",
      "second immediate",
      "timer",
    ],
  );
});

test("unreferenced timers, immediates and pending Promises permit Node exit", () => {
  assert.deepEqual(
    trace(
      "module",
      `
const later = setTimeout(() => console.log("timer"), 500);
console.log(later.unref() === later, later.hasRef());
const immediate = setImmediate(() => console.log("immediate"));
console.log(immediate.unref() === immediate, immediate.hasRef());
new Promise(() => {});
`,
    ),
    ["true false", "true false"],
  );
});
