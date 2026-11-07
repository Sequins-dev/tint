import assert from "node:assert/strict";
import test from "node:test";
import { stringHelper } from "../src/aarch64/scalar/strings.ts";

test("UTF-16 comparison kernels compare full words and retain scalar tails", () => {
  for (const kind of ["string-equal", "string-starts-with"] as const) {
    const body = stringHelper(kind);
    assert.ok(body.some((op) => op.op === "ldr" && op.width === 64));
    assert.ok(body.some((op) => op.op === "ldrh"));
    assert.ok(body.every((op) => op.op !== "bl" && op.op !== "blr"));
  }
});

test("UTF-16 copy kernels copy full words without clobbering the destination", () => {
  for (const kind of ["string-concat-copy", "string-slice-copy"] as const) {
    const body = stringHelper(kind);
    assert.ok(body.some((op) => op.op === "ldr" && op.width === 64));
    assert.ok(body.some((op) => op.op === "ldrh"));
    assert.ok(body.every((op) => !("rd" in op) || op.rd !== 9));
    assert.ok(body.every((op) => op.op !== "bl" && op.op !== "blr"));
  }
});
