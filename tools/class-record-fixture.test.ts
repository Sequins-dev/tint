import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import { classRecordFixture } from "./class-record-fixture.ts";

test("planned class fields lower through initialized record access", () => {
  const { module } = classRecordFixture();
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  assert.ok(
    module.functions[1]!.blocks.some(
      (block) => block.terminator.kind === "record-cell",
    ),
  );
});
