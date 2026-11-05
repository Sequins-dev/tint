import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { emitModule } from "@tint/codegen/aarch64/scalar";
test("the unchanged word64 implementation lowers and emits every function", () => {
  const bytes = new TextEncoder().encode(
    readFileSync(
      new URL("../packages/foundation/src/binary/word64.ts", import.meta.url),
      "utf8",
    ),
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const entries = checked.value.bindings.functions
    .filter((f) => f.parent === undefined)
    .map((f) => f.id);
  const lowered = lowerModuleEntries(
    checked.value,
    entries,
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
  assert.equal(lowered.value.module.functions.length, 7);
  const native = emitModule(lowered.value.module);
  assert.ok(native.ok, JSON.stringify(native));
  assert.deepEqual(
    new Set(native.value.strings.map((s) => s.value)),
    new Set(["INVALID_WORD", "INVALID_NUMBER", "OVERFLOW", "UNDERFLOW"]),
  );
});
