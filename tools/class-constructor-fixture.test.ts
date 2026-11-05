import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import { optimizeModule } from "@tint/ir/optimization";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { classConstructorFixture } from "./class-constructor-fixture.ts";

test("static reads and writes use guarded constructor environments", () => {
  for (const write of [false, true]) {
    const { module } = classConstructorFixture(write);
    assert.ok(
      module.functions[1]!.blocks.some((block) =>
        block.instructions.some((op) => op.kind === "function-environment"),
      ),
    );
    for (const input of [module, optimizeModule(module).module]) {
      assert.ok(verify(input).ok, JSON.stringify(verify(input)));
      const emitted = emitModule(input);
      assert.ok(emitted.ok, JSON.stringify(emitted));
    }
  }
});
