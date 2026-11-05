import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "../src/syntax/index.ts";
function accepts(text: string): boolean {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value).ok;
}
test("sloppy if branches allow ordinary function declarations only", () => {
  for (const text of [
    "if (x) function f(){}",
    "if (x) function f(){} else function g(){}",
    "if (x) if (y) function f(){} else function g(){}",
  ]) {
    assert.doesNotThrow(() => new Script(text));
    assert.equal(accepts(text), true, text);
    assert.equal(accepts('"use strict";' + text), false, text);
  }
  for (const text of [
    "if (x) function* f(){}",
    "if (x) async function f(){}",
    "if (x) let y;",
    "while (x) function f(){}",
    "for (;;) function f(){}",
  ]) {
    assert.throws(() => new Script(text), SyntaxError);
    assert.equal(accepts(text), false, text);
  }
});

test("sloppy call assignment targets defer reference errors to execution", () => {
  for (const text of [
    "f() = value;",
    "f() += value;",
    "f()++;",
    "++f();",
    "for (f() in source) {}",
    "for (f() of source) {}",
  ]) {
    assert.doesNotThrow(() => new Script(text));
    assert.equal(accepts(text), true, text);
    assert.equal(accepts('"use strict";' + text), false, text);
  }
  for (const text of ["f?.() = value;", "f?.()++;", "for (f?.() of source) {}"])
    assert.equal(accepts(text), false, text);
});

test("sloppy labelled functions remain restricted to declaration-permitting statement lists", () => {
  for (const text of [
    "label: function f(){}",
    "a: b: function f(){}",
    "{ a: function f(){} }",
  ]) {
    assert.doesNotThrow(() => new Script(text));
    assert.equal(accepts(text), true, text);
    assert.equal(accepts('"use strict";' + text), false, text);
  }
  for (const text of [
    "if (x) label: function f(){}",
    "while (x) label: function f(){}",
    "label: let x;",
    "label: function* f(){}",
  ]) {
    assert.throws(() => new Script(text), SyntaxError);
    assert.equal(accepts(text), false, text);
  }
});

test("sloppy for-in permits an initialized var identifier only", () => {
  const text = "for (var x = initialize() in source) {}";
  assert.doesNotThrow(() => new Script(text));
  assert.equal(accepts(text), true);
  for (const invalid of [
    '"use strict";' + text,
    "for (let x = 1 in source) {}",
    "for (const x = 1 in source) {}",
    "for (var x = 1 of source) {}",
    "for (var [x] = value in source) {}",
  ])
    assert.equal(accepts(invalid), false, invalid);
});

test("BigInt property names support every method prefix", () => {
  const text =
    "({1n(){}, *2n(){}, async 3n(){}, async* 4n(){}, get 5n(){}, set 6n(x){}})";
  assert.doesNotThrow(() => new Script(text));
  assert.equal(accepts(text), true);
});
test("logical assignments require simple targets even in sloppy code", () => {
  for (const operator of ["&&=", "||=", "??="]) {
    for (const target of ["f()", "(f())"]) {
      const text = target + operator + "value;";
      assert.throws(() => new Script(text), SyntaxError);
      assert.equal(accepts(text), false, text);
    }
    assert.equal(accepts("f().x" + operator + "value;"), true);
  }
});
