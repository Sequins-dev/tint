import { test } from "node:test";
import assert from "node:assert/strict";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { largeFrameFixture } from "./large-frame-fixture.ts";
test("native frames address values beyond the direct load/store immediate range", () => {
  const result = emitModule(largeFrameFixture());
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.functions[0]!.frameBytes > 32752);
});
