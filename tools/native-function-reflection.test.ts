import { test } from "node:test";
import assert from "node:assert/strict";
import * as memory from "../packages/native-runtime/src/intrinsics/memory.ts";
test("native function identity leaves stay unavailable under the Node bootstrap", () => {
  let called = false;
  const fn = () => {
    called = true;
    return 42;
  };
  for (const leaf of [
    memory.nativeFunctionDescriptor,
    memory.nativeFunctionSignature,
  ]) {
    assert.equal(typeof leaf, "function");
    assert.throws(
      () => leaf(fn),
      (e) => e === "HOST_UNAVAILABLE",
    );
  }
  assert.equal(called, false);
});
