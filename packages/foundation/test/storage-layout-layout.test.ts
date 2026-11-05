import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayoutPlanner } from "@tint/foundation/layout";
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
test("record, tagged payload, object and shadow-record layouts are target-derived", () => {
  const r = createLayoutPlanner(target, 1024);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.value;
  const record = p.record([
    { id: "flag", size: 1, alignment: 1 },
    { id: "ref", size: 8, alignment: 8 },
    { id: "count", size: 4, alignment: 4 },
  ]);
  assert.equal(record.ok, true);
  if (!record.ok) return;
  assert.deepEqual(
    record.value.fields.map((f) => f.offset),
    [0, 8, 16],
  );
  assert.equal(record.value.size, 24);
  assert.equal(record.value.alignment, 8);
  assert.deepEqual(p.object(record.value), {
    ok: true,
    value: {
      descriptorOffset: 0,
      flagsOffset: 8,
      payloadOffset: 16,
      byteLength: 48,
      alignment: 16,
    },
  });
  const sum = p.tagged(1, [
    { id: "empty", size: 0, alignment: 1 },
    { id: "ref", size: 8, alignment: 8 },
  ]);
  assert.equal(sum.ok, true);
  if (sum.ok) {
    assert.equal(sum.value.payloadOffset, 8);
    assert.equal(sum.value.size, 16);
  }
  assert.deepEqual(p.rootRecord(), {
    size: 32,
    alignment: 16,
    previousOffset: 0,
    descriptorOffset: 8,
    slotsOffset: 16,
  });
  const other = createLayoutPlanner(
    {
      pointerSize: 4,
      wordSize: 4,
      allocationAlignment: 8,
      frameAlignment: 8,
      maxAlignment: 8,
    },
    1024,
  );
  assert.equal(other.ok, true);
  if (other.ok) {
    assert.equal(other.value.rootRecord().size, 16);
    assert.deepEqual(other.value.object({ size: 12, alignment: 4 }, 12), {
      ok: true,
      value: {
        descriptorOffset: 0,
        flagsOffset: 4,
        payloadOffset: 8,
        byteLength: 32,
        alignment: 8,
      },
    });
  }
});
test("invalid alignment, duplicate field names and extent overflow are rejected", () => {
  assert.equal(
    createLayoutPlanner({ ...target, allocationAlignment: 3 }, 1024).ok,
    false,
  );
  assert.equal(createLayoutPlanner(target, NaN).ok, false);
  const r = createLayoutPlanner(target, 64);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  for (const fields of [
    [{ id: "x", size: 1, alignment: 3 }],
    [{ id: "x", size: -1, alignment: 1 }],
    [{ id: "x", size: 65, alignment: 1 }],
    [
      { id: "x", size: 1, alignment: 1 },
      { id: "x", size: 1, alignment: 1 },
    ],
  ])
    assert.equal(r.value.record(fields).ok, false);
  assert.equal(r.value.object({ size: 48, alignment: 8 }, 1).ok, false);
  assert.equal(r.value.tagged(1, []).ok, false);
  assert.equal(r.value.object({ size: 1, alignment: 32 }).ok, false);
});
test("tag width must accommodate every distinct variant", () => {
  const r = createLayoutPlanner(target, 1024);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(
    r.value.tagged(
      1,
      Array.from({ length: 257 }, (_, i) => ({
        id: String(i),
        size: 0,
        alignment: 1,
      })),
    ).ok,
    false,
  );
});

test("sparse field and variant lists return INVALID_STORAGE", () => {
  const planner = createLayoutPlanner(target, 1024);
  assert.ok(planner.ok);
  const fields: import("@tint/foundation/layout").Field[] = [];
  fields[1] = { id: "second", size: 8, alignment: 8 };
  assert.deepEqual(planner.value.record(fields), {
    ok: false,
    error: "INVALID_STORAGE",
  });
  assert.deepEqual(planner.value.tagged(1, fields), {
    ok: false,
    error: "INVALID_STORAGE",
  });
});
