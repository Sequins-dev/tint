import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  rewriteModule,
  type Module,
} from "@tint/typescript/syntax";
import { lowerSourceTextModule } from "../src/lowering/index.ts";
function lower(source: string): Module {
  const parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok);
  const result = lowerSourceTextModule(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
for (const [source, flags] of [
  ['let value=40;eval("value+2");', 1],
  ['export function read(){return eval("value")}let value=42;', 3],
  ['let value=40;await 0;eval("value+2");', 1],
] as const) {
  test(
    "module direct eval uses the defining context and existing site: " + source,
    () => {
      const module = lower(source),
        found: number[] = [];
      let contextReads = 0,
        sites = 0;
      rewriteModule(module, {
        expression(node) {
          if (node.kind === "member" && node.property === "activeContext")
            contextReads++;
          if (
            node.kind === "call" &&
            node.callee.kind === "identifier" &&
            ["callEvalCandidate", "callEvalTailCandidate"].includes(
              node.callee.name,
            )
          ) {
            const flag = node.arguments[5];
            assert.ok(flag?.kind === "number");
            found.push(flag.value);
          }
          if (
            node.kind === "object" &&
            node.properties.some(
              (property) =>
                property.kind !== "spread" &&
                property.name === "scriptOrModule",
            ) &&
            node.properties.some(
              (property) =>
                property.kind !== "spread" && property.name === "variables",
            )
          )
            sites++;
          return node;
        },
      });
      assert.deepEqual(found, [flags]);
      assert.equal(contextReads, 1);
      assert.equal(sites, 1);
      assert.ok(
        module.imports.some((entry) =>
          entry.bindings.some(
            (binding) =>
              binding.imported === "callEvalCandidate" ||
              binding.imported === "callEvalTailCandidate",
          ),
        ),
      );
    },
  );
}
test("module eval strings retain Script grammar rather than being parsed as modules", () => {
  for (const source of [
    'eval("import.meta");',
    'eval("export default 1;");',
    "eval('import x from \"m\";');",
  ])
    lower(source);
});
