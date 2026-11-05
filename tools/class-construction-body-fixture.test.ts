import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { optimizeModule } from "@tint/ir/optimization";
import { classConstructionBodyFixture } from "./class-construction-body-fixture.ts";
test("generated construction orders fields before constructor parameter defaults", () => {
  for (const mode of ["normal", "throw-field", "throw-body"] as const) {
    const { module } = classConstructionBodyFixture(mode);
    for (const input of [module, optimizeModule(module).module]) {
      assert.ok(verify(input).ok, JSON.stringify(verify(input)));
      const emitted = emitModule(input);
      assert.ok(emitted.ok, JSON.stringify(emitted));
    }
  }
});

test("static initialization calls use constructor receivers and propagate exceptions", () => {
  for (const mode of ["normal", "throw-field"] as const) {
    const { module } = classConstructionBodyFixture(mode, true);
    for (const input of [module, optimizeModule(module).module]) {
      assert.ok(verify(input).ok, JSON.stringify(verify(input)));
      const emitted = emitModule(input);
      assert.ok(emitted.ok, JSON.stringify(emitted));
    }
  }
});
