import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseEvalScript, rewriteModule } from "@tint/typescript/syntax";
import {
  directEvalInFunction,
  lowerDirectEvalScript,
} from "../src/lowering/index.ts";
import {
  directEvalAnnexCases,
  directEvalAnnexPrelude,
} from "./direct-eval-annex-cases.ts";
import { createLoweredRealm } from "./lowered-node-host.ts";

// Annex B.3.2.3 (EvalDeclarationInstantiation changes): a sloppy direct eval's
// block function is copied, when evaluated, into the eval caller's
// VariableEnvironment. Inside a function that is the function's declarative
// record (created by instantiateDirectEvalDeclarations); only global-level eval
// writes the global object. Catch parameters do not block the copy (B.3.4).

test("function-level direct eval copies block functions into the site variable record", () => {
  const source = "{ function g(){ return 3; } }";
  const parsed = parseEvalScript(createSourceTextView(source), {
    strict: false,
    newTarget: true,
    superProperty: false,
    superCall: false,
  });
  assert.ok(parsed.ok);
  const lowered = lowerDirectEvalScript(
    parsed.value,
    source,
    directEvalInFunction,
    {
      privateEnvironment: false,
      fieldInitializer: false,
    },
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const called: string[] = [];
  rewriteModule(lowered.value, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier")
        called.push(node.callee.name);
      return node;
    },
  });
  // The copy selects the site record when present and the global otherwise.
  assert.ok(called.includes("setMutableBinding"), called.join());
  assert.ok(called.includes("setGlobalBinding"), called.join());
});

for (const [name, source] of directEvalAnnexCases)
  test("direct eval Annex B copy: " + name, () => {
    assert.equal(
      createLoweredRealm().run(directEvalAnnexPrelude + source),
      "none",
    );
  });
