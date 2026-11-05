import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/tracing/index.ts";
test("preflight stages cyclic references and roots without modifying memory", () => {
  assert.equal(typeof api.createNativeFixupPlanner, "function");
  const memory = new Map<number, number>([
      [256, 4096],
      [264, 0],
      [272, 320],
      [320, 4096],
      [328, 0],
      [336, 256],
      [4096, 32],
      [4104, 1],
      [4112, 16],
      [4120, 0],
      [8192, 0],
      [8200, 4160],
      [8208, 256],
      [4160, 1],
      [4168, 16],
      [4176, 0],
    ]),
    before = new Map(memory),
    slots = new Float64Array(8),
    values = new Float64Array(8);
  const planner = api.createNativeFixupPlanner(
    (a) => memory.get(a),
    (a) => (a === 256 ? 128 : a === 320 ? 160 : undefined),
    (a) => memory.has(a),
    slots,
    values,
  );
  assert.ok(planner);
  const starts = new Float64Array([256, 320]),
    sizes = new Uint32Array([32, 32]),
    marks = new Uint8Array([2, 2]);
  assert.equal(planner.prepare(starts, sizes, marks, 2, 8192), 3);
  assert.deepEqual([...slots.slice(0, 3)], [8208, 272, 336]);
  assert.deepEqual([...values.slice(0, 3)], [128, 160, 128]);
  assert.deepEqual(memory, before);
  memory.set(336, 352);
  assert.equal(planner.prepare(starts, sizes, marks, 2, 8192), undefined);
  assert.equal(memory.get(336), 352);
});
test("capacity and writable-slot rejection cannot modify the mutator heap", () => {
  const memory = new Map<number, number>([
      [256, 4096],
      [264, 0],
      [272, 256],
      [4096, 32],
      [4104, 1],
      [4112, 16],
      [4120, 0],
    ]),
    before = new Map(memory);
  for (const capacity of [0, 1]) {
    const planner = api.createNativeFixupPlanner(
      (a) => memory.get(a),
      (a) => 128,
      () => capacity === 0,
      new Float64Array(capacity),
      new Float64Array(capacity),
    );
    assert.ok(planner);
    assert.equal(
      planner.prepare(
        new Float64Array([256]),
        new Uint32Array([32]),
        new Uint8Array([2]),
        1,
        0,
      ),
      undefined,
    );
    assert.deepEqual(memory, before);
  }
});

test("nested view fixups are computed against original headers before any writes", () => {
  const memory = new Map<number, number>([
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
  const slots = new Float64Array(8),
    values = new Float64Array(8),
    mapping = new Map([
      [256, 128],
      [512, 224],
      [768, 272],
    ]);
  const planner = api.createNativeFixupPlanner(
    (a) => memory.get(a),
    (a) => mapping.get(a),
    () => true,
    slots,
    values,
  )!;
  const starts = new Float64Array([256, 512, 768]),
    sizes = new Uint32Array([96, 48, 48]),
    marks = new Uint8Array([2, 2, 2]),
    before = new Map(memory);
  assert.equal(planner.prepare(starts, sizes, marks, 3, 0), 5);
  assert.deepEqual([...slots.slice(0, 5)], [280, 544, 536, 800, 792]);
  assert.deepEqual([...values.slice(0, 5)], [160, 128, 176, 224, 184]);
  assert.deepEqual(memory, before);
  marks[1] = 1;
  assert.equal(planner.prepare(starts, sizes, marks, 3, 0), undefined);
  assert.deepEqual(memory, before);
});
