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
      "934066e74f876c38ce26b4fc5615aca77a60328fba5ddc11ab9dd381cfc226fc",
    ],
    [
      "export async function f(){return await 1;}",
      "feb56bb01fd986747650fe489bfa3ae4d784d47d5f9edd610322c286feecab98",
    ],
    [
      'export const C=class {["x"](){return 1;}};',
      "debdb80eef176237567c5a8f6f414764fdfda3e838d1652842cb55fa014efda9",
    ],
    [
      "using resource=x; export let y=2;",
      "3edb417c3979258ad601e2a2e9a47dcf3f7b748a1f03fb594b0b266c3995d8d4",
    ],
    [
      'export function f(){return import("./m.js");}',
      "dc6a1e102cc2fd580dd9921bdf88a4dfaae65771fe3ccd5832a981421b4dfc98",
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
