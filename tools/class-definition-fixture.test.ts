import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { optimizeModule } from "@tint/ir/optimization";
import { classDefinitionFixture } from "./class-definition-fixture.ts";
test("composed class definitions preserve identities and abrupt initialization", () => {
  for (const throws of [false, true]) {
    const { module } = classDefinitionFixture(throws);
    for (const input of [module, optimizeModule(module).module]) {
      const result = verify(input);
      assert.ok(result.ok, JSON.stringify(result));
      const emitted = emitModule(input);
      assert.ok(emitted.ok, JSON.stringify(emitted));
    }
  }
});
