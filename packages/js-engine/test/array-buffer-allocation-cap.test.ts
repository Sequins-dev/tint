import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoweredRealm } from "./lowered-node-host.ts";

// The per-buffer allocation cap is an implementation limit (CreateByteDataBlock
// may throw RangeError), not a specification value. 32 MiB is the smallest
// power of two covering every pinned Test262 allocation that must succeed
// (staging/sm/extensions/dataview.js allocates 20 MiB); larger requests still
// throw RangeError, and the cap keeps a single buffer within a quarter of the
// Test262 host's copying semispace.
const prelude = `
function check(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + actual + " !== " + expected);
}
`;
test("ArrayBuffer allocations up to 32 MiB succeed and larger ones throw RangeError", () => {
  for (const source of [
    `var dv = new DataView(new ArrayBuffer(20 * 1024 * 1024));
     dv.setInt8(dv.byteLength - 10, 99); check(dv.getInt8(dv.byteLength - 10), 99, "20 MiB");`,
    `check(new ArrayBuffer(32 * 1024 * 1024).byteLength, 33554432, "cap");`,
    `try { new ArrayBuffer(32 * 1024 * 1024 + 1); throw new Error("no RangeError"); }
     catch (e) { check(e instanceof RangeError, true, "over cap"); }`,
  ])
    assert.equal(createLoweredRealm().run(prelude + source), "none", source);
});
