import { test } from "node:test";
import assert from "node:assert/strict";
import { scanNativeObject, scanNativeRoots } from "../src/tracing/index.ts";
function memory(entries: readonly (readonly [number, number])[]) {
  const words = new Map(entries);
  return (address: number) => words.get(address);
}
test("record descriptors trace references and only reference-valued general slots", () => {
  const read = memory([
    [256, 4096],
    [264, 0],
    [272, 512],
    [280, 0],
    [288, 1],
    [296, 123],
    [304, 3],
    [312, 768],
    [4096, 64],
    [4104, 2],
    [4112, 16],
    [4120, 24],
    [4128, 2],
    [4136, 32],
    [4144, 48],
  ]);
  const seen: number[] = [];
  assert.equal(
    scanNativeObject(read, 256, 64, (p) => {
      seen.push(p);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [512, 768]);
});
test("strings and owned or borrowed typed arrays contain no managed edges; views keep parents", () => {
  for (const marker of [1, 2, 3, 4, 5]) {
    const read = memory([
      [256, marker],
      [264, 0],
      [272, 2],
    ]);
    assert.equal(
      scanNativeObject(read, 256, 64, () => {
        throw Error("unexpected edge");
      }),
      "complete",
    );
  }
  const seen: number[] = [];
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 2],
        [272, 1],
        [288, 512],
      ]),
      256,
      48,
      (p) => {
        seen.push(p);
        return true;
      },
    ),
    "complete",
  );
  assert.deepEqual(seen, [512]);
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 1],
        [272, 100000],
      ]),
      256,
      32,
      () => false,
    ),
    "complete",
  );
});
test("linked root frames use emitted compact descriptors", () => {
  const read = memory([
    [256, 512],
    [264, 4096],
    [272, 768],
    [280, 3],
    [288, 1024],
    [512, 0],
    [520, 4128],
    [528, 0],
    [4096, 1],
    [4104, 16],
    [4112, 1],
    [4120, 24],
    [4128, 1],
    [4136, 16],
    [4144, 0],
  ]);
  const seen: number[] = [];
  assert.equal(
    scanNativeRoots(read, 256, (p) => {
      seen.push(p);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [768, 1024]);
});
test("bad metadata, missing memory, visitor failure and cycles fail closed", () => {
  assert.equal(
    scanNativeObject(
      memory([
        [256, 4096],
        [264, 0],
        [4096, 32],
        [4104, 1],
        [4112, 32],
      ]),
      256,
      32,
      () => true,
    ),
    "invalid",
  );
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 2],
      ]),
      256,
      48,
      () => true,
    ),
    "read",
  );
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 2],
        [272, 1],
        [288, 512],
      ]),
      256,
      48,
      () => false,
    ),
    "visitor",
  );
  assert.equal(
    scanNativeObject(
      memory([
        [256, 1],
        [264, 0],
        [272, 100],
      ]),
      256,
      32,
      () => true,
    ),
    "invalid",
  );
  assert.equal(
    scanNativeRoots(
      memory([
        [256, 256],
        [264, 4096],
        [4096, 0],
        [4104, 0],
      ]),
      256,
      () => true,
      2,
    ),
    "limit",
  );
  assert.equal(
    scanNativeObject(
      memory([
        [256, 4096],
        [264, 0],
        [4096, 32],
        [4104, 0],
        [4112, 1],
        [4120, 16],
        [272, 8],
      ]),
      256,
      32,
      () => true,
    ),
    "invalid",
  );
});

test("reference visitors receive exact writable slots for records, tagged values, views and roots", () => {
  const read = memory([
    [256, 4096],
    [264, 0],
    [272, 512],
    [280, 3],
    [288, 768],
    [4096, 48],
    [4104, 1],
    [4112, 16],
    [4120, 1],
    [4128, 24],
    [512, 2],
    [520, 2],
    [528, 1],
    [536, 800],
    [544, 768],
    [1024, 0],
    [1032, 4160],
    [1040, 256],
    [1048, 3],
    [1056, 512],
    [4160, 1],
    [4168, 16],
    [4176, 1],
    [4184, 24],
  ]);
  const edges: (readonly [number, number])[] = [];
  const visit = (value: number, slot: number) => {
    edges.push([value, slot]);
    return true;
  };
  assert.equal(scanNativeObject(read, 256, 48, visit), "complete");
  assert.equal(scanNativeObject(read, 512, 48, visit), "complete");
  assert.equal(scanNativeRoots(read, 1024, visit), "complete");
  assert.deepEqual(edges, [
    [512, 272],
    [768, 288],
    [768, 544],
    [256, 1040],
    [512, 1056],
  ]);
  // The view's derived data pointer at 536 is not an owning reference.
});
