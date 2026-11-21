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
  for (const declaration of ["let a=1;", "const b=1;"])
    assert.equal(environments("{" + declaration + "}{}"), base, declaration);
  assert.equal(environments("{class C{}}"), environments("class C{}"));
  assert.equal(environments("{let a=1;eval('a');}"), base + 1);
  assert.equal(environments("{var v=1;}"), environments("var v=1;"));
  assert.equal(
    environments("{function g(){}}"),
    environments("function g(){}"),
  );
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

test("a for-let loop without an escaping binding needs no lexical record", () => {
  const base = environments("function count() {}");
  assert.equal(
    environments("function count() { for (let i = 0; i < 5; i++) print(i); }"),
    base,
  );
});

test("nested block bindings use the same captured slots after the block exits", () => {
  const source = `
    function outer(value) {
      let read;
      { let captured = value; read = () => ++captured; }
      return read;
    }
  `;
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(runtimeCalls(source, "resolveBinding"), 0);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      source +
        "const next = outer(40); print(String(next())); print(String(next()));",
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["41", "42"]);
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
  assert.equal(runtimeCalls(source, "getBindingValue"), 0);
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

test("simple parameter reads and writes use their bound slots", () => {
  const source = "function update(value) { value = 'js'; return value; }";
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(runtimeCalls(source, "putBindingReference"), 0);
  assert.equal(runtimeCalls(source, "createMutableBinding"), 0);
});

test("known captures read the parameter slot and share subsequent writes", () => {
  const source = "function outer(value) { return () => ++value; }";
  assert.equal(runtimeCalls(source, "resolveBinding"), 0);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      source +
        "const next = outer(40); print(String(next())); print(String(next()));",
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["41", "42"]);
});

test("strict direct eval can capture enclosing parameters after return", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      function outer(value) {
        "use strict";
        function inner() {
          const step = 1;
          return eval("() => value += step");
        }
        return inner();
      }
      const next = outer(40);
      print(String(next()));
      print(String(next()));
    `),
    "none",
  );
  assert.deepEqual(realm.printed, ["41", "42"]);
});

test("escaped sloppy arguments and closures alias the same parameter", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      let escaped, read;
      function remember(value) {
        escaped = arguments;
        read = () => value;
      }
      remember(1);
      escaped[0] = 42;
      print(String(read()));
    `),
    "none",
  );
  assert.deepEqual(realm.printed, ["42"]);
});

test("parameter aliases and deletion retain Script binding semantics", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      function duplicate(value, value) { return value; }
      function redeclared(value) { var value = 42; return value; }
      function removable(value) { return delete value; }
      print(String(duplicate(0, 42)));
      print(String(redeclared(0)));
      print(String(removable(0)));
    `),
    "none",
  );
  assert.deepEqual(realm.printed, ["42", "42", "false"]);
});

test("locals and parameters carry mutations across await in a loop", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      async function sum(step) {
        let total = 0;
        for (let i = 0; i < 3; i++) {
          step += i;
          await step;
          total += ++step;
        }
        print(String(total));
      }
      sum(1);
    `),
    "none",
  );
  realm.drain();
  assert.deepEqual(realm.printed, ["13"]);
});

test("Annex B updates the outer var at block evaluation", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      function run(take) {
        print(typeof inner);
        if (take) {
          print(String(inner()));
          function inner() { return 42; }
        }
        print(typeof inner);
      }
      run(false);
      run(true);
    `),
    "none",
  );
  assert.deepEqual(realm.printed, [
    "undefined",
    "undefined",
    "undefined",
    "42",
    "function",
  ]);
});

test("function-body lexical references resolve to initialized or TDZ slots", () => {
  const source = `
    function outer() {
      const early = () => later;
      let caught = false;
      try { early(); } catch (error) { caught = error instanceof ReferenceError; }
      let later = 40;
      const late = () => ++later;
      return caught && early() === 40 && late() === 41 && early() === 41;
    }
  `;
  assert.equal(runtimeCalls(source, "getBindingValue"), 0);
  const realm = createLoweredRealm();
  assert.equal(realm.run(source + "print(String(outer()));"), "none");
  assert.deepEqual(realm.printed, ["true"]);
});

test("function vars and hoisted functions use slots shared with closures", () => {
  const source = `function f(n) {
    var sum;
    if (sum !== undefined) return 1;
    sum = 0;
    for (var i = 0; i < n; i++) add(i);
    return () => sum;
    function add(x) { sum += x; }
  }`;
  assert.equal(runtimeCalls(source, "instantiateFunctionBody"), 0);
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 1);
  const realm = createLoweredRealm();
  assert.equal(realm.run(source + "print(String(f(4)()));"), "none");
  assert.deepEqual(realm.printed, ["6"]);
});

test("class and named-function self references use lexical slots", () => {
  const source = `
    const fn = function self() { self = 1; return self; };
    class C { static read() { return C; } }
    const classRead = C.read;
  `;
  // The synthetic constructor retains its environment.
  assert.equal(environments(source), 1);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(source + "print(String(fn() === fn && classRead() === C))"),
    "none",
  );
  assert.deepEqual(realm.printed, ["true"]);
});

test("class name slots preserve the heritage TDZ and lexical arrow receivers", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      try { const Invalid = class Inner extends Inner {}; }
      catch (error) { print(error.name); }
      class Base { value() { return 40; } }
      class Derived extends Base {
        #extra = 2;
        value() { return (() => super.value() + this.#extra)(); }
      }
      function Constructor() { this.target = () => new.target; }
      print(String(new Derived().value()));
      print(String(new Constructor().target() === Constructor));
    `),
    "none",
  );
  assert.deepEqual(realm.printed, ["ReferenceError", "42", "true"]);
});

test("Annex B copies the initialized block slot into the function var slot", () => {
  const source = `function f() {
    const before = typeof inner;
    if (true) { function inner() { return 42; } }
    return before + " " + inner();
  }`;
  assert.equal(runtimeCalls(source, "getBindingValue"), 0);
  assert.equal(environments(source), 0);
  const realm = createLoweredRealm();
  assert.equal(realm.run(source + " print(f());"), "none");
  assert.deepEqual(realm.printed, ["undefined 42"]);
});

test("direct eval in a sibling function leaves unrelated locals in slots", () => {
  const source = `
    function read(value) { const local = value; return local; }
    function dynamic() { const text = "ignored"; return eval("text"); }
  `;
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 1);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(source + "print(String(read(42)));print(dynamic());"),
    "none",
  );
  assert.deepEqual(realm.printed, ["42", "ignored"]);
});

test("with lookup preserves the receiver and unrelated functions keep slots", () => {
  const source = `
    function safe(input) { const step = () => input + 1; return step(); }
    function dynamic(target) { with (target) { return step(); } }
  `;
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 1);
  assert.equal(runtimeCalls(source, "getBindingThisValue"), 1);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      source +
        "print(String(safe(41)));print(String(dynamic({value: 42, step() { return this.value; }})));",
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["42", "42"]);
});

test("destructured lexicals use fixed slots and retain TDZ in defaults", () => {
  const source = `
    function read() {
      let {a, b = a} = {a: 42};
      return () => b;
    }
  `;
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(environments(source), 0);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      source +
        "print(String(read()())); try { let [x = y, y] = []; } catch (error) { print(error.name); }",
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["42", "ReferenceError"]);
});

test("a Script-level for let counter with no capture stays in a slot", () => {
  const source = "for (let i = 0; i < 2; i++) { i; }";
  assert.equal(environments(source), 0);
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
});

test("for-of bindings use fresh slots after evaluating the iterable", () => {
  const source = `
    function read() {
      const readers = [];
      for (let value of [40, 42]) readers.push(() => value);
      return readers;
    }
  `;
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(environments(source), 0);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      source +
        "let [first, second] = read(); print(String(first())); print(String(second())); try { for (let value of value) {} } catch (error) { print(error.name); }",
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["40", "42", "ReferenceError"]);
});

test("catch slots preserve Annex B's redirected var initializer", () => {
  const source = `
    function read() {
      let closure;
      try { throw 40; }
      catch (value) {
        var value = 42;
        closure = () => value;
      }
      return typeof value + " " + closure();
    }
  `;
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(environments(source), 0);
  const realm = createLoweredRealm();
  assert.equal(realm.run(source + "print(read());"), "none");
  assert.deepEqual(realm.printed, ["undefined 42"]);
});

test("Script lexical cells are located once for all resolved references", () => {
  const source =
    "let total = 40; function next() { total += 2; return total; }";
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(runtimeCalls(source, "resolveBinding"), 0);
  assert.equal(runtimeCalls(source, "findBinding"), 1);
  const realm = createLoweredRealm();
  assert.equal(realm.run(source + "print(String(next()));"), "none");
  assert.equal(realm.run("print(String(next()));"), "none");
  assert.deepEqual(realm.printed, ["42", "44"]);
});

test("defaults, destructuring and rest share initialized parameter slots", () => {
  const source = `
    function read(make = () => later, {value: later} = {value: 41}, ...rest) {
      return make() + rest[0];
    }
  `;
  assert.equal(runtimeCalls(source, "getIdentifierValue"), 0);
  assert.equal(environments(source), 0);
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      source +
        "print(String(read(undefined, undefined, 1))); function early(a = b, b = 0) {} try { early(); } catch (error) { print(error.name); }",
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["42", "ReferenceError"]);
});
