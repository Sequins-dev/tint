import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import { classRecordFixture } from "./class-record-fixture.ts";

test("planned class fields lower through plain record access", () => {
  const { module } = classRecordFixture();
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const terminators = module.functions[1]!.blocks.map(
    (block) => block.terminator.kind,
  );
  assert.ok(terminators.includes("record"));
  assert.ok(!terminators.includes("record-cell"));
});
