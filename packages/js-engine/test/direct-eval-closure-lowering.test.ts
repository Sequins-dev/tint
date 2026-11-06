import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceTextView } from "@tint/source/text";
import {
  parseEvalScript,
  parseScript,
  rewriteModule,
  type Module,
} from "@tint/typescript/syntax";
import {
  directEvalInFunction,
  lowerDirectEvalScript,
  lowerScript,
} from "../src/lowering/index.ts";
import {
  directEvalClosureCases,
  directEvalClosurePrelude,
} from "./direct-eval-closure-cases.ts";
import { createLoweredRealm } from "./lowered-node-host.ts";

for (const [name, source, exemptions] of directEvalClosureCases)
  test("direct eval closure: " + name, () => {
    const text = directEvalClosurePrelude + source;
    if (exemptions?.nodeDeviation === undefined)
      new Script(text).runInNewContext();
    else assert.throws(() => new Script(text).runInNewContext());
    if (exemptions?.oracleUnsupported === undefined)
      assert.equal(createLoweredRealm().run(text), "none");
  });

function lowered(source: string, entry: "aot" | "runtime" | "direct") {
  if (entry === "direct") {
    const parsed = parseEvalScript(createSourceTextView(source), {
      strict: false,
      newTarget: true,
      superProperty: false,
      superCall: false,
    });
    assert.ok(parsed.ok);
    const result = lowerDirectEvalScript(
      parsed.value,
      source,
      directEvalInFunction,
      { privateEnvironment: false, fieldInitializer: false },
    );
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  }
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const result = lowerScript(parsed.value, source, {
    runtimeCompiled: entry === "runtime",
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function events(module: Module): string[] {
  const found: string[] = [];
  rewriteModule(module, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier") {
        const name = node.arguments[1];
        found.push(
          node.callee.name +
            (name?.kind === "string" &&
            (node.callee.name === "resolveBinding" ||
              node.callee.name === "getIdentifierValue")
              ? ":" + name.value
              : ""),
        );
      }
      if (
        node.kind === "binary" &&
        node.right.kind === "string" &&
        node.right.value === "unsupported"
      )
        found.push("inline-check");
      return node;
    },
  });
  return found;
}
const shape = "a; typeof b; x = (c, 1); (function(){ return d; });";
test("only runtime-compiled entries complete results out of line", () => {
  const aot = events(lowered(shape, "aot"));
  assert.ok(aot.includes("inline-check"));
  assert.ok(!aot.includes("throwIfRuntimeError"));
  assert.ok(!aot.some((event) => event.startsWith("getIdentifierValue")));
  for (const entry of ["runtime", "direct"] as const) {
    const compact = events(lowered(shape, entry));
    assert.ok(!compact.includes("inline-check"), entry);
    assert.ok(compact.includes("throwIfRuntimeError"), entry);
    for (const name of ["a", "b", "c", "d"]) {
      assert.ok(compact.includes("getIdentifierValue:" + name), entry);
      assert.ok(!compact.includes("resolveBinding:" + name), entry);
    }
    // Assignment targets still resolve before the right-hand side runs.
    assert.ok(
      compact.indexOf("resolveBinding:x") <
        compact.indexOf("getIdentifierValue:c"),
      entry,
    );
  }
});
