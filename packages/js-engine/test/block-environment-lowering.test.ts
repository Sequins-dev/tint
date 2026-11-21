import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  rewriteModule,
  type Expression,
} from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
import { createLoweredRealm } from "./lowered-node-host.ts";

function countExpressions(
  text: string,
  accept: (expression: Expression) => boolean,
): number {
  const parsed = parseScript(createSourceTextView(text));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, text);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  let count = 0;
  rewriteModule(lowered.value, {
    expression: (mapped) => {
      if (accept(mapped)) count++;
      return mapped;
    },
  });
  return count;
}

function runtimeCalls(text: string, name: string): number {
  return countExpressions(
    text,
    (node) =>
      node.kind === "call" &&
      node.callee.kind === "identifier" &&
      node.callee.name === name,
  );
}

function environments(text: string): number {
  return runtimeCalls(text, "createDeclarativeEnvironment");
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

test("a for-let loop without an escaping binding allocates only its initial environment", () => {
  const base = environments("function count() {}");
  assert.equal(
    environments("function count() { for (let i = 0; i < 5; i++) print(i); }"),
    base + 1,
  );
});

test("an initialized for-let counter uses a native slot for reads and writes", () => {
  const source = "function count() { for (let i = 0; i < 5; i++) i; }";
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(runtimeCalls(source, "putBindingReference"), 0);
});

test("initialized uncaptured body locals use native slots", () => {
  const source =
    "function sum() { const step = 1; let total = 0; total += step; return total; }";
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(runtimeCalls(source, "putBindingReference"), 0);
});

test("general arithmetic in a slot-backed loop emits a guarded numeric operation", () => {
  const source =
    "function sum(x) { let total = 0; for (let i = 0; i < 5; i++) total += x; return total; }";
  assert.equal(
    countExpressions(
      source,
      (node) => node.kind === "binary" && node.operator === "+",
    ),
    1,
  );
  assert.equal(runtimeCalls(source, "binaryObjectValueOperation"), 2);
});

test("for-let captures keep distinct initialization and iteration environments", () => {
  const realm = createLoweredRealm();
  const source = `
    function run() {
      let first, second, third;
      for (let i = 0, initial = () => i; i < 2; i++) {
        if (i === 0) {
          first = initial;
          second = () => i;
          continue;
        }
        third = () => i;
      }
      print(String(first()));
      print(String(second()));
      print(String(third()));
    }
    run();
  `;
  assert.equal(realm.run(source), "none");
  assert.deepEqual(realm.printed, ["0", "0", "1"]);
});

test("a direct eval closure keeps its own for-let iteration environment", () => {
  const realm = createLoweredRealm();
  const source = `
    function run() {
      let first, second;
      for (let i = 0; i < 2; i++) {
        if (i === 0) first = eval("() => i");
        else second = eval("() => i");
      }
      print(String(first()));
      print(String(second()));
    }
    run();
  `;
  assert.equal(realm.run(source), "none");
  assert.deepEqual(realm.printed, ["0", "1"]);
});

test("a local numeric leaf emits a direct typed closure and retains its general call", () => {
  const source =
    "function run(x) { let f = value => value + 1; return 0 + f(x); }";
  assert.equal(
    countExpressions(
      source,
      (node) =>
        node.kind === "arrow" &&
        node.returnType?.kind === "named" &&
        node.returnType.name === "number",
    ),
    1,
  );
  assert.equal(runtimeCalls(source, "callObjectValue"), 1);
});

test("numeric leaf call guards preserve the evaluated callee and the general operands", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      function run() {
        let f = value => value + 1;
        print(String(f(41)));
        print(String(f("4")));
        function replace() { return 11; }
        f = replace;
        print(String(f(2)));
        let g = value => value + 1;
        print(String(g((g = replace, 2))));
        print(String(g(1)));
      }
      run();
    `),
    "none",
  );
  assert.deepEqual(realm.printed, ["42", "41", "11", "3", "11"]);
});

test("numeric loops specialize whole functions behind an argument guard", () => {
  const source = `
    function sum(bound) {
      const next = value => value + 1;
      let result = 0;
      for (let i = 0; i < bound; i++) result += next(i);
      return result;
    }
  `;
  let numericLoops = 0;
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, source);
  assert.ok(lowered.ok);
  rewriteModule(lowered.value, {
    expression: (node) => {
      if (
        node.kind === "arrow" &&
        node.returnType?.kind === "named" &&
        node.returnType.name === "number" &&
        node.body.kind === "block" &&
        node.body.statements.some((statement) => statement?.kind === "for")
      )
        numericLoops++;
      return node;
    },
  });
  assert.equal(numericLoops, 1);

  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      source +
        `
      print(String(sum(3)));
      print(String(sum("3")));
      print(String(sum(NaN)));
      let reads = 0;
      print(String(sum({ valueOf() { reads++; return 2; } })));
      print(String(reads));
    `,
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["6", "6", "0", "3", "3"]);
});
