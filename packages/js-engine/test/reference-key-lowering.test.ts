import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseScript, rewriteModule } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
import { createLoweredRealm } from "./lowered-node-host.ts";

// A property Reference converts its key with ToPropertyKey at most once.
// GetValue/PutValue (ECMA-262 6.2.5.5-6) first apply ToObject to the base and
// then store the converted key back into the Reference, so read-modify-write
// forms observe one conversion. Test262: S11.13.2_A7.*_T4, S11.3.*_A6_T3,
// S11.4.4_A6_T3 and S11.4.5_A6_T3.
const prelude = `
var log = [];
function check(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + actual + " !== " + expected);
}
function key(name) {
  return { toString: function () { log.push("key"); return name; } };
}
function traced(initial) {
  var value = initial;
  return {
    get x() { log.push("get"); return value; },
    set x(v) { log.push("set"); value = v; },
  };
}
function rhs(v) { log.push("rhs"); return v; }
function order(expected, label) {
  check(log.join(","), expected, label);
  log = [];
}
`;

function run(source: string): void {
  const realm = createLoweredRealm();
  assert.equal(realm.run(prelude + source), "none");
}

test("compound assignment converts a computed key once, before the RHS", () => {
  for (const operator of [
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**=",
    "<<=",
    ">>=",
    ">>>=",
    "&=",
    "|=",
    "^=",
  ])
    run(`
var o = traced(6);
o[key("x")] ${operator} rhs(2);
order("key,get,rhs,set", ${JSON.stringify(operator)});
`);
});

test("update expressions convert a computed key once", () => {
  run(`
var o = traced(1);
check(o[key("x")]++, 1, "postfix ++"); order("key,get,set", "postfix ++");
check(o[key("x")]--, 2, "postfix --"); order("key,get,set", "postfix --");
check(++o[key("x")], 2, "prefix ++"); order("key,get,set", "prefix ++");
check(--o[key("x")], 1, "prefix --"); order("key,get,set", "prefix --");
`);
});

test("logical assignment converts a computed key once on both paths", () => {
  run(`
var o = traced(0);
o[key("x")] ||= rhs(4); order("key,get,rhs,set", "||= assigns");
o[key("x")] ||= rhs(5); order("key,get", "||= short-circuits");
o[key("x")] &&= rhs(0); order("key,get,rhs,set", "&&= assigns");
o[key("x")] &&= rhs(6); order("key,get", "&&= short-circuits");
var n = traced(undefined);
n[key("x")] ??= rhs(7); order("key,get,rhs,set", "??= assigns");
n[key("x")] ??= rhs(8); order("key,get", "??= short-circuits");
check(n.x, 7, "??= value"); log = [];
`);
});

test("super property read-modify-write converts a computed key once", () => {
  run(`
var value = 1;
var proto = {
  get x() { log.push("get"); return value; },
  set x(v) { log.push("set"); value = v; },
};
var home = {
  __proto__: proto,
  compound() { super[key("x")] += rhs(2); },
  update() { return super[key("x")]++; },
};
home.compound(); order("key,get,rhs,set", "super +=");
check(home.update(), 3, "super ++"); order("key,get,set", "super ++");
`);
});

test("converted keys preserve symbol and numeric identity", () => {
  run(`
var s = Symbol("s");
var o = {};
o[s] = 1;
var boxed = { toString: function () { log.push("key"); return s; } };
o[boxed] += 41;
check(o[s], 42, "symbol key"); order("key", "symbol key");
var a = [1, 2];
a[{ valueOf: function () { log.push("valueOf"); return 0; }, toString: null }] *= 10;
check(a[0], 10, "numeric key"); order("valueOf", "numeric key");
`);
});

test("abrupt key conversion stops before GetValue and the RHS", () => {
  run(`
var o = traced(1);
var bad = { toString: function () { log.push("key"); throw new RangeError("key"); } };
try { o[bad] += rhs(1); throw new Error("no throw"); }
catch (e) { check(e instanceof RangeError, true, "compound error"); }
order("key", "compound abrupt");
try { o[bad]++; throw new Error("no throw"); }
catch (e) { check(e instanceof RangeError, true, "update error"); }
order("key", "update abrupt");
try { o[bad] ??= rhs(1); throw new Error("no throw"); }
catch (e) { check(e instanceof RangeError, true, "logical error"); }
order("key", "logical abrupt");
check(o.x, 1, "value unchanged"); log = [];
`);
});

test("nullish bases throw before key conversion", () => {
  run(`
var base = null;
try { base[key("x")] += rhs(1); throw new Error("no throw"); }
catch (e) { check(e instanceof TypeError, true, "compound null"); }
order("", "compound null");
try { base[key("x")]++; throw new Error("no throw"); }
catch (e) { check(e instanceof TypeError, true, "update null"); }
order("", "update null");
try { base[key("x")] = rhs(1); throw new Error("no throw"); }
catch (e) { check(e instanceof TypeError, true, "assignment null"); }
order("rhs", "assignment null");
`);
});

test("simple assignment converts its key after the RHS; delete once", () => {
  // PutValue performs ToPropertyKey, so the RHS is evaluated first
  // (Test262 language/expressions/assignment/target-member-computed-reference).
  run(`
var o = traced(1);
o[key("x")] = rhs(2); order("rhs,key,set", "assignment");
var d = { x: 1 };
check(delete d[key("x")], true, "delete"); order("key", "delete");
check("x" in d, false, "deleted");
`);
});

test("a converted key survives generator and async suspension", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      prelude +
        `
var o = traced(1);
function* g() { o[key("x")] += yield "paused"; return o.x; }
var it = g();
check(it.next().value, "paused", "suspended"); order("key,get", "before resume");
check(it.next(41).value, 42, "resumed"); order("set,get", "after resume");
async function f() { o[key("x")] -= await 2; }
f().then(function () { order("key,get,set", "async"); print("async done"); });
`,
    ),
    "none",
  );
  realm.drain();
  assert.deepEqual(realm.printed, ["async done"]);
});

test("only read-modify-write references store the converted key", () => {
  // Count stores sourced from ToPropertyKey. Other generated assignments can
  // store guarded arithmetic results in their own temporaries.
  function storedKeys(text: string): number {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok);
    const lowered = lowerScript(parsed.value);
    assert.ok(lowered.ok);
    const conversions = new Set<string>();
    rewriteModule(lowered.value, {
      statement: (node) => {
        if (node.kind !== "variable") return node;
        for (const declaration of node.declarations) {
          if (
            declaration === undefined ||
            declaration.kind === "array-binding" ||
            declaration.kind === "object-binding"
          )
            continue;
          const value = declaration.initializer;
          if (
            value?.kind === "call" &&
            value.callee.kind === "identifier" &&
            value.callee.name === "objectPropertyKeyOrThrow"
          )
            conversions.add(declaration.name);
        }
        return node;
      },
    });
    let count = 0;
    rewriteModule(lowered.value, {
      expression: (node) => {
        // The fused conversion returns the key itself.
        if (
          node.kind === "assignment" &&
          node.target.kind === "identifier" &&
          node.target.name.startsWith("$value") &&
          node.value.kind === "identifier" &&
          conversions.has(node.value.name)
        )
          count++;
        return node;
      },
    });
    return count;
  }
  const baseline = storedKeys("var o={},k='x';");
  for (const text of ["o[k];", "o[k]();", "o[k]=1;", "delete o[k];", "o.x+=1;"])
    assert.equal(storedKeys("var o={},k='x';" + text), baseline, text);
  for (const text of ["o[k]+=1;", "o[k]++;", "--o[k];", "o[k]??=1;"])
    assert.equal(storedKeys("var o={},k='x';" + text), baseline + 1, text);
});
