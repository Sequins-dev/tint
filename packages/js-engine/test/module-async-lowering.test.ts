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
      "64f8107cf59121d0d2c31958831281cb9a9ff0a10bd29f0a2f1e98fc8866c733",
    ],
    [
      "export async function f(){return await 1;}",
      "aabee62ec05daacb18207eba889d2a0b41a3d899f6700ca95e1049d0d8edc83b",
    ],
    [
      'export const C=class {["x"](){return 1;}};',
      "235f4a2d57284c7fd51fbb98d40d3255087f3166fccac203a4b590b27a7f470a",
    ],
    [
      "using resource=x; export let y=2;",
      "da1d3701c09d677b0e6c709cb6586e4ad09468960be9665ab9805d592a72b1c0",
    ],
    [
      'export function f(){return import("./m.js");}',
      "ab5f2a5b5e20be950dcd5e7f5390de5acdb90e752fe266c0dc84f18279c49488",
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
