import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nativeBuiltinMarkerLimit,
  nativeTypedArrayElementBytes,
  nativeTypedArrayMarker,
} from "../src/host.ts";
import { nativeWeakSlotMarker } from "../src/weak-slot.ts";
import {
  nativeTypedArrayBigInt,
  nativeTypedArrayKind,
  nativeTypedArrayKindOfMarker,
  nativeTypedArrayKinds,
} from "../src/typed-array.ts";
import { heapDebugKinds } from "../src/heap-debug.ts";

test("typed-array kinds keep the original markers and share width classes", () => {
  const markers = new Map<string, number>();
  for (const entry of nativeTypedArrayKinds)
    markers.set(entry.name, entry.marker);
  // The original four kinds keep markers 2-5.
  assert.equal(markers.get("Uint8Array"), 2);
  assert.equal(markers.get("Uint16Array"), 3);
  assert.equal(markers.get("Uint32Array"), 4);
  assert.equal(markers.get("Float64Array"), 5);
  const seen = new Set<number>();
  for (const entry of nativeTypedArrayKinds) {
    assert.ok(!seen.has(entry.marker), entry.name);
    seen.add(entry.marker);
    assert.ok(entry.marker < nativeBuiltinMarkerLimit, entry.name);
    assert.equal(nativeTypedArrayMarker(entry.marker), true, entry.name);
    assert.equal(
      nativeTypedArrayElementBytes(entry.marker),
      entry.elementBytes,
      entry.name,
    );
    assert.equal(nativeTypedArrayKind(entry.name), entry);
    assert.equal(nativeTypedArrayKindOfMarker(entry.marker), entry);
    assert.equal(
      nativeTypedArrayBigInt(entry),
      entry.name.startsWith("Big"),
      entry.name,
    );
  }
  assert.equal(nativeTypedArrayKinds.length, 11);
  assert.equal(nativeTypedArrayKind("Float16Array"), undefined);
});

test("the typed-array predicate excludes every other built-in and records", () => {
  // Strings, reference vectors and weak slots carry pointers or other
  // layouts; record descriptors are 8-aligned addresses at or above the limit.
  for (const marker of [0, 1, 6, nativeWeakSlotMarker, 8, 9, 14, 15, 16])
    assert.equal(nativeTypedArrayMarker(marker), false, String(marker));
  for (const marker of [32, 40, 4096, 2 ** 47])
    assert.equal(nativeTypedArrayMarker(marker), false, String(marker));
  assert.equal(nativeWeakSlotMarker < nativeBuiltinMarkerLimit, true);
});

test("the heap debugger names every typed-array kind and layout", () => {
  for (const entry of nativeTypedArrayKinds)
    for (const [flags, suffix] of [
      [0, ""],
      [1, ".external"],
      [2, ".view"],
    ] as const) {
      const kind = heapDebugKinds.find(
        (candidate) =>
          candidate.marker === entry.marker && candidate.flags === flags,
      );
      assert.equal(kind?.name, entry.name + suffix);
      assert.equal(kind?.elementBytes, flags === 0 ? entry.elementBytes : 0);
    }
});
