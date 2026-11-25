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
      "7b969aec48745d5c64f1dbd46108965e2cbf7c2050033fa0dddd66db680e8277",
    ],
    [
      "export async function f(){return await 1;}",
      "2fd5c0dcff6d59450b509a95ca87954249a75e8166de764934f33d918b3e5460",
    ],
    [
      'export const C=class {["x"](){return 1;}};',
      "c40062cb574b187224c9b03551b78a87e76e2827d6767befaa23415260c32410",
    ],
    [
      "using resource=x; export let y=2;",
      "05c9e393f562f3c73328e952eaee409cf116caa5cbb6345052cca0b596f69ed9",
    ],
    [
      'export function f(){return import("./m.js");}',
      "6471c326ac0fad2727f329e961e3256796345304bbc6d56a0f8c1c56cf854123",
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
