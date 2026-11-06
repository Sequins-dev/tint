import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseEvalScript, rewriteModule } from "@tint/typescript/syntax";
import {
  directEvalInFunction,
  lowerDirectEvalScript,
} from "../src/lowering/index.ts";
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

const prelude = `function check(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + actual + " !== " + expected);
}
`;
const cases: readonly string[] = [
  'function f(){try{throw 1;}catch(g){eval("{ function g(){return 3;} }");var inner=g;}return [inner,typeof g].join();} check(f(),"1,function","catch parameter")',
  'function f(){var r=eval("var before=typeof k; { function k(){} } [before, typeof k].join()"); return r+","+typeof k;} check(f(),"undefined,function,function","function eval"); check(typeof globalThis.k,"undefined","no global leak")',
  'eval("{ function gk(){ return 7; } }"); check(typeof globalThis.gk,"function","global-level eval"); check(gk(),7,"global value")',
  'function f(){ let q=1; eval("{ function q(){} }"); return q;} check(f(),1,"lexical conflict skips copy")',
  'function f(){ var inside=(()=>(eval("{ function m(){} }"), typeof m))(); return inside+","+typeof m;} check(f(),"function,undefined","arrow eval targets the arrow var env")',
  'function f(){ eval("try { { throw 0; function n(){} } } catch(e){}"); return typeof n;} check(f(),"undefined","abrupt block skips copy")',
  'function f(){ eval("\\\'use strict\\\'; { function s(){} }"); return typeof s;} check(f(),"undefined","strict eval has no annex copy")',
  'function f(){ var w=5; eval("{ function w(){} }"); return typeof w;} check(f(),"function","existing var overwritten")',
];
for (const source of cases)
  test(
    "direct eval Annex B copy: " + /check\(.*,"([^"]*)"\)$/.exec(source)![1],
    () => {
      assert.equal(createLoweredRealm().run(prelude + source), "none");
    },
  );
