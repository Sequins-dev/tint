import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeSyntaxHost } from "./test262-native-syntax.ts";
import { executionPlan } from "./test262-execution.ts";

test("native syntax input retains strict prefixes and non-ASCII source as data", () => {
  const plan = executionPlan('$DONOTEVALUATE(); const λ = "await";', "strict", {
    flags: [],
    features: [],
    includes: [],
    negative: { phase: "parse", type: "SyntaxError" },
  });
  const host = nativeSyntaxHost(plan);
  const encoded = host.match(/data:number\[\]=\[([\d,]*)\]/);
  assert.ok(encoded);
  assert.equal(
    new TextDecoder().decode(
      new Uint8Array(encoded[1]!.split(",").map(Number)),
    ),
    plan.source,
  );
  assert.equal(host.includes("$DONOTEVALUATE"), false);
  assert.ok(host.includes("parseScript(source.value)"));
  assert.ok(host.includes('validateJavaScriptBindings(parsed.value,"script")'));
});
test("native module syntax uses JavaScript grammar without attempting evaluation", () => {
  const host = nativeSyntaxHost({
    source: "export const = ;",
    goal: "module",
    harness: [],
    asynchronous: false,
    canSuspend: false,
  });
  assert.ok(host.includes('parseModule(source.value,"javascript")'));
  assert.ok(host.includes('validateJavaScriptBindings(parsed.value,"module")'));
  assert.ok(host.includes("if(error===undefined)return 42"));
  assert.ok(host.includes('parsed.error.code==="LEXICAL_ERROR"'));
});

test("syntax batches retain each source as data and select Script or Module grammar", async () => {
  const syntax = await import("./test262-native-syntax.ts");
  assert.equal(typeof syntax.nativeSyntaxBatchModules, "function");
  const modules = syntax.nativeSyntaxBatchModules([
    {
      source: "$DONOTEVALUATE(); let = ;",
      goal: "script",
      harness: [],
      asynchronous: false,
      canSuspend: false,
    },
    {
      source: "export { missing };",
      goal: "module",
      harness: [],
      asynchronous: false,
      canSuspend: false,
    },
  ]);
  assert.equal(modules.length, 3);
  assert.equal(new Set(modules.map((module) => module.id)).size, 3);
  assert.equal(modules.at(-1)!.id, "test262-syntax-host");
});

test("the shared verdict generator retains the exact byte payload", async () => {
  const { nativeSyntaxVerdictSource } =
    await import("./native-syntax-kernel.ts");
  const bytes = new Uint8Array([0xff, 0, 0xc0]);
  const source = nativeSyntaxVerdictSource(bytes, "module");
  assert.match(source, /data:number\[\]=\[255,0,192\]/);
  assert.match(source, /if\(!source.ok\)return 10/);
  assert.doesNotMatch(source, /eval\(/);
});
