import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { lowerSourceTextModule } from "../src/lowering/index.ts";
function lower(source: string) {
  const parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = lowerSourceTextModule(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
for (const source of [
  "export let x=await 1;",
  "for await (const x of xs) { sink(x); }",
  "await using resource=x; export let y=2;",
  "class C {[await key](){return 1;}};",
  "try { await f(); } finally { await g(); }",
]) {
  test(
    "module suspension lowers through the shared continuation: " + source,
    () => {
      const module = lower(source),
        text = JSON.stringify(module);
      assert.ok(
        module.imports.some((entry) =>
          entry.bindings.some(
            (binding) => binding.imported === "createLoweredAsyncSourceModule",
          ),
        ),
      );
      assert.ok(text.includes('"name":"GeneratorContinuation"'));
      assert.ok(text.includes('"name":"runGeneratorSteps"'));
      let topLevelAwait = false,
        yields = 0;
      rewriteModule(module, {
        expression(node) {
          if (node.kind === "yield" || node.kind === "await") yields++;
          if (node.kind === "object")
            for (const property of node.properties)
              if (
                property.kind !== "spread" &&
                property.name === "hasTopLevelAwait" &&
                property.value.kind === "boolean" &&
                property.value.value
              )
                topLevelAwait = true;
          return node;
        },
      });
      assert.equal(topLevelAwait, true);
      assert.equal(yields, 0);
    },
  );
}
test("module lowering preserves its caller-policy shape through nested async bodies", () => {
  const cases = [
    [
      "export let x=1; export function f(){return x;}",
      "7466a8734d98b25f9ff52446e811c52b4cb5836943919e9d8e19a08bea1287b8",
    ],
    [
      "export async function f(){return await 1;}",
      "5cf97ddc1ca0e27e89ba6fd989ddd69b7fb5a876d38fdc9844ae273955a9fe8c",
    ],
    [
      'export const C=class {["x"](){return 1;}};',
      "28617bcbc501925e504a900d13fd475ebae8ba88ad6c7a74fadccd650e4f3bcd",
    ],
    [
      "using resource=x; export let y=2;",
      "d39134700eb4ab22a5226652683f16bb3f041ee1144de83dee50024d92e86862",
    ],
    [
      'export function f(){return import("./m.js");}',
      "7dafbf0664f132018e64de36fce6c0571c3e9c734c702e2876a45232269bed26",
    ],
  ] as const;
  for (const [source, sha256] of cases) {
    assert.equal(
      createHash("sha256")
        .update(JSON.stringify(lower(source)))
        .digest("hex"),
      sha256,
      source,
    );
  }
});

test("nested await expressions in loop heads and bodies stay within the generated syntax budget", () => {
  const awaits = "await ".repeat(15) + "'value'";
  for (const operator of ["await-of", "in", "of"]) {
    const source =
      "var value;" +
      ["value", "var value", "let value"]
        .map((binding) =>
          operator === "await-of"
            ? `for await (${binding} of [${awaits}]) { ${awaits}; break; }`
            : `for (${binding} ${operator} [${awaits}]) { ${awaits}; break; }`,
        )
        .join("\n");
    const parsed = parseModule(createSourceTextView(source));
    assert.ok(parsed.ok);
    const result = lowerSourceTextModule(parsed.value, source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("a long nested await expression lowers without expanding one continuation per await", () => {
  lower("export const result=" + "await ".repeat(100) + "7;");
});

test("unflattened distinct suspension segments retain the shared compile limit", () => {
  const source = "await 0;".repeat(100),
    parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok);
  const result = lowerSourceTextModule(parsed.value, source);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "LIMIT");
});
