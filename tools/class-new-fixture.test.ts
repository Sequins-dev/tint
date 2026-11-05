import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { optimizeModule } from "@tint/ir/optimization";
import { classNewFixture } from "./class-new-fixture.ts";
test("new uses a distinct construction entry after evaluating callee and arguments", () => {
  for (const mode of [
    "order",
    "defaults",
    "throw-argument",
    "throw-constructor",
  ] as const) {
    const { module } = classNewFixture(mode);
    for (const input of [module, optimizeModule(module).module]) {
      assert.ok(verify(input).ok, JSON.stringify(verify(input)));
      const emitted = emitModule(input);
      assert.ok(emitted.ok, JSON.stringify(emitted));
    }
  }
});
