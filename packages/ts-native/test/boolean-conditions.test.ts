import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";

for (const [type, conversions] of [
  ["boolean", 0],
  ["boolean|undefined", 1],
  ["number", 1],
] as const) {
  test(`${type} conditions retain only required truth conversion`, () => {
    const parsed = parseModule(
      createSourceTextView(
        `function branch(value:${type}):number{if(value)return 42;return 0;}`,
      ),
    );
    assert.ok(parsed.ok);
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    const lowered = lowerModuleEntries(
      checked.value,
      [0],
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
    );
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const operations = lowered.value.module.functions[0]!.blocks.flatMap(
      (b) => b.instructions,
    );
    assert.equal(
      operations.filter((op) => op.kind === "unary" && op.operator === "truthy")
        .length,
      conversions,
    );
  });
}
