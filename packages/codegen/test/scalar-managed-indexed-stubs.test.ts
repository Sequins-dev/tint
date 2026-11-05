import { test } from "node:test";
import assert from "node:assert/strict";
import * as memory from "@tint/native-runtime/intrinsics/memory";
test("indexed managed capabilities remain explicit unavailable leaves in Node", () => {
  const callback = (base: unknown, step: number): unknown => {
    throw "INVOKED";
  };
  for (const name of [
    "callExecutableManagedWithIndex",
    "nativeFunctionDescriptorWithIndex",
    "nativeFunctionSignatureWithIndex",
  ] as const) {
    assert.equal(typeof memory[name], "function", name);
    assert.throws(
      () =>
        name === "callExecutableManagedWithIndex"
          ? memory[name](1, callback)
          : memory[name](callback),
      (error) => error === "HOST_UNAVAILABLE",
    );
  }
});
