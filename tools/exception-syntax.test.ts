import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import { checkClosureModule } from "@tint/typescript/checker";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseModule(source.value);
}
test("exception syntax carries catch scopes and finally through rewriting", () => {
  const parsed = parse(
    'function run():number{let error=1;try{throw "x";}catch(error:unknown){const read:()=>unknown=()=>error;}finally{error=2;}return error;}',
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value);
  assert.ok(bound.ok, JSON.stringify(bound));
  const errors = bound.value.bindings.filter((b) => b.name === "error");
  assert.equal(errors.length, 2);
  assert.notEqual(errors[0]?.scope, errors[1]?.scope);
  assert.equal(errors.find((b) => b.kind === "catch")?.captured, true);
  let tries = 0;
  const rewritten = rewriteModule(parsed.value, {
    statement: (node) => {
      if (node.kind === "try") tries++;
      return node;
    },
  });
  assert.equal(tries, 1);
  assert.ok(bindModule(rewritten).ok);
  const checked = checkClosureModule(rewritten);
  assert.ok(checked.ok, JSON.stringify(checked));
});
test("try requires blocks and a catch or finally clause", () => {
  for (const text of [
    "try{}catch{}",
    "try{}finally{}",
    "try{}catch(e){}finally{}",
  ])
    assert.ok(parse(text).ok, text);
  for (const text of [
    "try{}",
    "try;catch{}",
    "try{}catch(){}",
    "try{}catch(e);",
    "try{}finally;",
  ])
    assert.ok(!parse(text).ok, text);
});

test("catch bindings reject redeclaration and do not escape their scope", () => {
  for (const text of [
    "function f():number{try{}catch(error){let error=1;}return 0;}",
    "function f():number{try{}catch(error){}return error;}",
  ]) {
    const parsed = parse(text);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.ok(!bindModule(parsed.value).ok);
  }
  const parsed = parse(
    "function f():number{try{}catch(error){{let error=1;error++;}}return 0;}",
  );
  assert.ok(parsed.ok);
  assert.ok(bindModule(parsed.value).ok);
});

test("linking preserves catch binding identity and source origins", () => {
  const parsed = parse(
    "export function run(error:number):number{try{throw error;}catch(error:unknown){const read:()=>unknown=()=>error;return 7;}finally{error=2;}}",
  );
  assert.ok(parsed.ok);
  const linked = linkModules(
    [{ id: "main", module: parsed.value, dependencies: new Map() }],
    "main",
    [],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  const caught = bound.value.bindings.find((b) => b.kind === "catch");
  assert.ok(caught);
  assert.ok(caught.captured);
  assert.ok(caught.name.startsWith("@"));
  assert.ok(linked.value.origins.has(caught.node));
  const read = bound.value.references.find((r) => r.binding === caught.id);
  assert.ok(read);
  assert.equal(read.node.kind, "identifier");
});

test("generic specialization traverses try bodies, handlers and finalizers", () => {
  const parsed = parse(
    "function attempt<T>(value:T):T{try{return value;}catch(error:unknown){throw error;}finally{const done=1;}}function run():number{return attempt<number>(7);}",
  );
  assert.ok(parsed.ok);
  const bound = bindModule(parsed.value);
  assert.ok(bound.ok);
  const specialized = specializeModule(parsed.value, bound.value);
  assert.ok(specialized.ok, JSON.stringify(specialized));
  assert.ok(bindModule(specialized.value.module).ok);
  let tries = 0,
    throws = 0;
  rewriteModule(specialized.value.module, {
    statement: (node) => {
      if (node.kind === "try") tries++;
      if (node.kind === "throw") throws++;
      return node;
    },
  });
  assert.equal(tries, 1);
  assert.equal(throws, 1);
});

test("completion checking distinguishes caught throws and finally overrides", () => {
  for (const text of [
    "function run():number{try{return 1;}finally{return 2;}}",
    "function run():number{try{throw 1;}catch{return 2;}}",
    "function run():number{try{return 1;}finally{throw 2;}}",
    "function run():number{try{}finally{return 2;}}",
    "function run():number{do{try{break;}finally{return 2;}}while(false);}",
  ]) {
    const parsed = parse(text);
    assert.ok(parsed.ok);
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
  }
  for (const text of [
    "function run():number{try{throw 1;}catch{}}",
    "function run():number{try{}finally{}}",
    "function run():number{do{try{return 1;}finally{break;}}while(false);}",
  ]) {
    const parsed = parse(text);
    assert.ok(parsed.ok);
    assert.ok(!checkClosureModule(parsed.value).ok, text);
  }
});

test("catch bindings are unknown values that may be compared, captured and rethrown", () => {
  for (const source of [
    "function f():unknown{try{throw 1;}catch(e){const read:()=>unknown=()=>e;return read();}}",
    'function f():number{try{throw "x";}catch(e:unknown){if(e!=="x")throw e;return 1;}}',
    "function f(x:unknown):unknown{return x;}function g():unknown{return f(1);}",
  ]) {
    const parsed = parse(source);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    for (const binding of checked.value.bindings.bindings.filter(
      (b) => b.kind === "catch",
    )) {
      assert.equal(
        checked.value.types[checked.value.bindingTypes[binding.id]!]?.kind,
        "unknown",
      );
      assert.ok(
        checked.value.operations.some(
          (op) =>
            op.binding === binding.id && op.operation.kind === "initialize",
        ),
      );
    }
  }
});

test("unknown does not authorize property access, calls, arithmetic or concrete returns", () => {
  for (const body of [
    "return e.message;",
    "return e();",
    "return e+1;",
    "return e;",
  ]) {
    const parsed = parse(
      "function f():number{try{throw 1;}catch(e){" + body + "}}",
    );
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.equal(checkClosureModule(parsed.value).ok, false, body);
  }
  for (const type of ["number", "string", "any"]) {
    const parsed = parse(
      "function f():number{try{throw 1;}catch(e:" + type + "){return 1;}}",
    );
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.equal(checkClosureModule(parsed.value).ok, false, type);
  }
});

test("never functions prohibit normal completion and allow throwing calls", () => {
  for (const text of [
    'function fail():never{throw "failure";}',
    'function fail():never{throw "failure";}function f():number{fail();}',
    'function fail():never{throw "failure";}function f():never{return fail();}',
    'function fail():never{throw "failure";}function f():number{try{fail();}catch{return 1;}}',
  ]) {
    const parsed = parse(text);
    assert.ok(parsed.ok);
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
  }
  for (const text of [
    "function f():never{}",
    "function f():never{return;}",
    "function f():never{return 1;}",
    'function f():never{try{throw "x";}catch{}}',
    'function f():never{try{throw "x";}finally{return;}}',
  ]) {
    const parsed = parse(text);
    assert.ok(parsed.ok);
    assert.equal(checkClosureModule(parsed.value).ok, false, text);
  }
});
