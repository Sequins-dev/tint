import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import {
  prototypeRecordFixture,
  prototypeMutationFixture,
} from "./prototype-record-fixture.ts";

test("prototype fallback tests own presence and guards the prototype read", () => {
  const module = prototypeRecordFixture("absent");
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const reader = module.functions[1]!;
  assert.ok(
    reader.blocks.some((block) =>
      block.instructions.some((op) => op.kind === "record-has"),
    ),
  );
  assert.ok(
    reader.blocks.some(
      (block) =>
        block.terminator.kind === "record" && block.terminator.record === 1,
    ),
  );
});

test("recursive prototype fallback preserves verified shape dispatch", () => {
  for (const own of ["absent", "undefined", "value"] as const) {
    const module = prototypeRecordFixture(own, 2);
    assert.ok(verify(module).ok, JSON.stringify(verify(module)));
    const checks = module.functions[1]!.blocks.flatMap(
      (block) => block.instructions,
    ).filter((op) => op.kind === "record-has");
    assert.equal(checks.length, 2);
  }
});

test("prototype and own writes compose with repeated inherited reads", () => {
  for (const target of ["own", "prototype"] as const) {
    const module = prototypeMutationFixture(target);
    assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  }
});
