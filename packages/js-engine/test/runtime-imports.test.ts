import { syntaxShape } from "./syntax-shape.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";

test("runtime import vocabulary is shared with Script lowering", () => {
  assert.equal(typeof lowering.scriptRuntimeImports, "function");
  for (const [text, disposal, asyncDisposal, directEval] of [
    ["42;", false, false, false],
    ["{using resource=null;}", true, false, false],
    ["async function f(){await using resource=null;}", true, true, false],
    ["eval(7);", false, false, true],
  ] as const) {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const result = lowering.lowerScript(parsed.value);
    assert.ok(result.ok, JSON.stringify(result));
    const span = { start: parsed.value.start, end: parsed.value.start };
    assert.deepEqual(
      lowering.scriptRuntimeImports(span, disposal, asyncDisposal, directEval),
      result.value.imports,
    );
  }
});

test("runtime import vocabulary has independent dense bindings and exact spans", () => {
  const span = { start: 3, end: 7 };
  const declarations = lowering.scriptRuntimeImports(span, true, true);
  const keys = new Set<string>();
  for (const declaration of declarations) {
    assert.equal(declaration.start, 3);
    assert.equal(declaration.end, 7);
    assert.deepEqual(declaration.specifierSpan, span);
    for (const binding of declaration.bindings) {
      assert.ok(binding);
      const key = declaration.specifier + ":" + binding.imported;
      assert.ok(!keys.has(key), key);
      keys.add(key);
      assert.equal(binding.local, binding.imported);
    }
  }
  assert.ok(
    keys.has("@tint/js-runtime/objects:registerAsyncLexicalDisposable"),
  );
  assert.ok(keys.has("@tint/js-runtime/objects:registerLexicalDisposable"));
  assert.deepEqual(
    lowering.scriptRuntimeImports(span, true, true),
    declarations,
  );
  assert.notEqual(lowering.scriptRuntimeImports(span)[0], declarations[0]);
});

test("Script entry completion uses the runtime's named identity", () => {
  const bytes = new TextEncoder().encode("42;");
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  const result = lowering.lowerScript(parsed.value);
  assert.ok(result.ok);
  const entry = result.value.statements.find(
    (statement) =>
      statement?.kind === "function" && statement.name === "execute",
  );
  assert.ok(entry?.kind === "function");
  assert.deepEqual(syntaxShape(entry.returnType), {
    start: 0,
    end: 0,
    kind: "named",
    name: "ScriptCompletionRecord",
  });
  const binding = result.value.imports
    .flatMap((declaration) => declaration.bindings)
    .find((binding) => binding?.imported === "ScriptCompletionRecord");
  assert.ok(binding?.typeOnly);
});
