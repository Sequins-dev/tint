import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import {
  parseScript,
  rewriteModule,
  bindingIdentifiers,
  visitBindingExpressions,
} from "@tint/typescript/syntax";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value);
}
test("catch object bindings preserve nested defaults and reject outer initializers", () => {
  const result = parse("try {} catch ({x, nested:{y=1}={}, ...rest}) {}");
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(rewriteModule(result.value, {}), result.value);
  for (const source of [
    "try {} catch ({x}=value) {}",
    "try {} catch (x=1) {}",
    "try {} catch ({let}) {}",
  ])
    assert.equal(parse(source).ok, false, source);
  assert.ok(parse("try {} catch (let) {}").ok);
});
test("object declarations preserve aliases, defaults, nesting, computed keys and rest", () => {
  const result = parse("const {x, y:z=1, [key()]:{deep=2}, ...rest}=value;");
  assert.ok(result.ok, JSON.stringify(result));
  const statement = result.value.statements[0];
  assert.ok(statement?.kind === "variable");
  const binding = statement.declarations[0];
  assert.ok(binding?.kind === "object-binding");
  assert.equal(binding.properties.length, 3);
  assert.equal(binding.properties[1]?.name, "y");
  assert.equal(binding.properties[2]?.keyExpression?.kind, "call");
  assert.equal(binding.rest?.name, "rest");
  assert.equal(binding.initializer?.kind, "identifier");
  assert.deepEqual(rewriteModule(result.value, {}), result.value);
});
test("object declarations reject malformed targets and rest placement", () => {
  for (const text of [
    "const {x};",
    "let {};",
    "var {x};",
    "let {...r,}=x;",
    "let {...r=1}=x;",
    "let {...r,x}=x;",
    "let {x: obj.y}=value;",
    "let {'x'}=value;",
    "let {let}=value;",
    "'use strict';var {eval}=value;",
  ]) {
    assert.equal(parse(text).ok, false, text);
    assert.throws(() => Function(text), SyntaxError);
  }
  for (const text of [
    "let {}=1;",
    "var {x,x}=value;",
    "const {['x']:y, 1:z, default:d}=value;",
    "for(let {x}=value;x<2;x++){}",
  ])
    assert.ok(parse(text).ok, text);
});
test("object loop heads distinguish iteration from classic initializers", () => {
  for (const source of [
    "for (const {length:n, ...rest} in source) {}",
    "for (let {x=1} of source) {}",
    "for (var {[key()]:x} in source) {}",
    "for (let {x}=source, y=1; y<2; y++) {}",
  ]) {
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(rewriteModule(result.value, {}), result.value);
  }
  for (const source of [
    "for (let {x}=source in values) {}",
    "for (let {x}=source of values) {}",
    "for (let {x},y in values) {}",
    "for (let {x};;) {}",
  ])
    assert.equal(parse(source).ok, false, source);
});
test("object parameters support functions, arrows and methods", () => {
  for (const source of [
    "function f({x=1,...rest}={}) {return x;}",
    "const f=({x:{y=1}={}},z=2)=>y+z;",
    "const o={m({x}){return x;}};",
    "class C {constructor({x}){} m({x}){return x;}}",
    "function f(...{length:n}){return n;}",
  ]) {
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(rewriteModule(result.value, {}), result.value);
  }
  for (const source of [
    "function f({x},x){}",
    "function f({x}){'use strict';}",
    "function f(...{x}={}){}",
  ])
    assert.equal(parse(source).ok, false, source);
});
test("object assignment patterns validate cover grammar and reference targets", () => {
  for (const source of [
    "({x,y:obj.value=42,[key()]:{z=1},...rest}=source);",
    "({__proto__:x,__proto__:y}=source);",
    "for({length:n,...rest} in source){}",
    "({x:(target.value)}=source);",
  ])
    assert.ok(parse(source).ok, source);
  for (const source of [
    "({x=1});",
    "f({x=1});",
    "({x=1}.x);",
    "({__proto__:1,__proto__:2});",
    "({m(){}}=source);",
    "({x:1}=source);",
    "({...rest,}=source);",
    "({...rest,x}=source);",
    "({x:obj?.value}=source);",
    "({x})=source;",
    "({...{x}}=source);",
  ])
    assert.equal(parse(source).ok, false, source);
});

test("for-of assignment heads preserve targets and restrict leading tokens", () => {
  for (const source of [
    "for(x of values){}",
    "for(obj.x of values){}",
    "for({x=1,...rest} of values){}",
    "for((async) of values){}",
    "for(async.x of values){}",
    "for(\\u0061sync of values){}",
  ]) {
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    const rewritten = rewriteModule(result.value, {});
    assert.deepEqual(rewriteModule(rewritten, {}), rewritten);
  }
  for (const source of [
    "for(async of values){}",
    "for(let.x of values){}",
    "for(x+y of values){}",
    "for(x of a,b){}",
  ]) {
    assert.equal(parse(source).ok, false, source);
    assert.throws(() => Function(source), SyntaxError);
  }
});

test("array iteration binding defaults parse and preserve their expressions", () => {
  const result = parse("for(const [x=42,y=x] of values){}");
  assert.ok(result.ok, JSON.stringify(result));
  const loop = result.value.statements[0];
  assert.ok(loop?.kind === "for-of" && loop.binding.kind === "array-binding");
  assert.equal(loop.binding.elements[0]?.initializer?.kind, "number");
  assert.equal(loop.binding.elements[1]?.initializer?.kind, "identifier");
});

test("array iteration rest retains its binding through traversal and rewriting", () => {
  const result = parse("for(const [x,,...rest] of values){}");
  assert.ok(result.ok, JSON.stringify(result));
  const loop = result.value.statements[0];
  assert.ok(loop?.kind === "for-of");
  assert.deepEqual(
    bindingIdentifiers(loop.binding).map((item) => item.name),
    ["x", "rest"],
  );
  assert.deepEqual(rewriteModule(result.value, {}), result.value);
  for (const text of [
    "for(const [...rest,] of values){}",
    "for(const [...rest=1] of values){}",
    "for(const [...rest,x] of values){}",
  ]) {
    assert.equal(parse(text).ok, false, text);
  }
});

test("array assignment patterns reject invalid rest and reference targets", () => {
  for (const source of [
    "[...x,]=a;",
    "[...x,y]=a;",
    "[...x=1]=a;",
    "[1]=a;",
    "[x+y]=a;",
  ]) {
    assert.equal(parse(source).ok, false, source);
    assert.throws(() => Function(source), SyntaxError);
  }
  for (const source of ["[x,,...r]=a;", "[...[x]]=a;", "({x:[y]}=a);"]) {
    assert.ok(parse(source).ok, source);
  }
});

test("array binding expression traversal visits defaults in source order", () => {
  const result = parse(
    "for(const [x=first(),,y=second(),...rest] of values){}",
  );
  assert.ok(result.ok);
  const loop = result.value.statements[0];
  assert.ok(loop?.kind === "for-of");
  const names: string[] = [];
  visitBindingExpressions(loop.binding, (expression) => {
    assert.ok(
      expression.kind === "call" && expression.callee.kind === "identifier",
    );
    names.push(expression.callee.name);
  });
  assert.deepEqual(names, ["first", "second"]);
});
