import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";

test("property candidate scanning does not require a per-iteration closure cell", () => {
  const text = readFileSync("packages/typescript/src/types/index.ts", "utf8"),
    bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value, [
    "undefined",
    "Math",
    "Number",
    "Uint8Array",
    "Uint32Array",
    "Float64Array",
    "Map",
    "Set",
  ]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const fn = bound.value.functions.find(
    (fn) => fn.node.start === text.indexOf("function widerProperty"),
  );
  assert.ok(fn);
  const locals = bound.value.bindings.filter(
    (binding) =>
      binding.owner === fn.id &&
      (binding.kind === "let" || binding.kind === "const"),
  );
  assert.ok(locals.length > 0);
  for (const local of locals)
    assert.equal(
      local.captured,
      false,
      `${local.name} must remain a scalar local instead of a fresh captured cell`,
    );
});

test("structural relation loops keep their iteration bindings in scalar locals", () => {
  const text = readFileSync("packages/typescript/src/types/index.ts", "utf8"),
    bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const bound = bindModule(parsed.value, [
    "undefined",
    "Math",
    "Number",
    "Uint8Array",
    "Uint32Array",
    "Float64Array",
    "Map",
    "Set",
  ]);
  assert.ok(bound.ok);
  const fn = bound.value.functions.find(
    (fn) => fn.node.start === text.indexOf("function solveRelation"),
  );
  assert.ok(fn);
  for (const binding of bound.value.bindings) {
    if (
      binding.owner !== fn.id ||
      (binding.kind !== "let" && binding.kind !== "const")
    )
      continue;
    assert.equal(
      binding.captured,
      false,
      `${binding.name} must not allocate a captured loop cell`,
    );
  }
});
