import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, rewriteModule } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
import { createLoweredRealm } from "./lowered-node-host.ts";

function environments(text: string): number {
  const parsed = parseScript(createSourceTextView(text));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, text);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  let count = 0;
  rewriteModule(lowered.value, {
    expression: (mapped) => {
      if (
        mapped.kind === "call" &&
        mapped.callee.kind === "identifier" &&
        mapped.callee.name === "createDeclarativeEnvironment"
      )
        count++;
      return mapped;
    },
  });
  return count;
}

test("blocks without lexically scoped declarations create no environment", () => {
  const base = environments("0;");
  assert.equal(environments("{}{}{ {f();} }"), base);
  // Each declaring block adds exactly its own environment.
  for (const declaration of [
    "let a=1;",
    "const b=1;",
    "class C{}",
    "function g(){}",
  ])
    assert.equal(
      environments("{" + declaration + "}{}"),
      environments(declaration) + 1,
      declaration,
    );
  assert.equal(environments("{var v=1;}"), environments("var v=1;"));
});

function loweredStatements(text: string): number {
  const parsed = parseScript(createSourceTextView(text));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, text);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  let count = 0;
  rewriteModule(lowered.value, {
    statement: (mapped) => {
      count++;
      return mapped;
    },
  });
  return count;
}

test("blocks that lower to nothing leave no statement behind", () => {
  // regress-610026 evaluates 2^21 sequential empty blocks: each must cost no
  // lowered statement, or the embedded compiler checks millions of no-ops.
  const base = loweredStatements("0;");
  assert.equal(loweredStatements("0;{}{}{}"), base);
  assert.equal(loweredStatements("0;{{}{{}}}"), base);
  assert.equal(loweredStatements("0;" + "{}".repeat(64)), base);
});

test("eliding empty block environments is unobservable", () => {
  for (const [source, printed] of [
    // Direct eval inside a declaration-free block sees the same bindings.
    ['let x=1;{ print(String(eval("x"))); }', ["1"]],
    [
      '{ eval("let y=2; print(String(y))"); } print(typeof y);',
      ["2", "undefined"],
    ],
    [
      'let z=3;{ try { eval("var z=4"); } catch (e) { print(e.name); } }',
      ["SyntaxError"],
    ],
    ['var w=5;{ eval("var w=6"); } print(String(w));', ["6"]],
    // Closures and nested declarations keep their own environments.
    [
      "let f;{ let k=7; f=function(){return k;}; } { print(String(f())); }",
      ["7"],
    ],
    ["{ { function h(){return 8;} print(String(h())); } }", ["8"]],
    // TDZ still applies inside a declaring block nested in an empty one.
    [
      "{ { try { q; } catch (e) { print(e.name); } let q=1; } }",
      ["ReferenceError"],
    ],
    // Labels, breaks and completion values are unaffected.
    ['a: { print("in"); break a; print("no"); } print("out");', ["in", "out"]],
    ['print(String(eval("{ 9; } {}")));', ["9"]],
    // Blocks that lower to nothing keep labels, branches, loops and
    // completion values intact.
    ['print(String(eval("{}")));', ["undefined"]],
    ['print(String(eval("1; {} {{}}")));', ["1"]],
    ['print(String(eval("2; l: {} ")));', ["2"]],
    [
      'l: {} if (true) {} else {} while (false) {} do {} while (false); print("ok");',
      ["ok"],
    ],
    ['print(String(eval("3; if (true) {} else {}")));', ["undefined"]],
    ['print(String(eval("4; do {} while (false);")));', ["undefined"]],
  ] as const) {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), "none", source);
    assert.deepEqual(realm.printed, printed, source);
  }
});
