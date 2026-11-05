import type { ReadonlyKeyIndex } from "@tint/foundation/collections/key-index";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { prepareNumericModule } from "@tint/ts-native/modules";
import { checkClosureModule } from "@tint/typescript/checker";
function indexValues<K, V>(index: ReadonlyKeyIndex<K, V>): V[] {
  const values: V[] = [];
  index.forEach((value) => values.push(value));
  return values;
}

function prepare(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value, ["undefined"]);
  assert.ok(bound.ok, JSON.stringify(bound));
  return prepareNumericModule(parsed.value, bound.value);
}
test("module arrays move into one explicit state initializer and state follows direct calls", () => {
  const r = prepare(
    "const K:readonly number[]=[1,2];function read():number{return K[0]??0;}function run():number{return read();}function pure(n:number):number{return n;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.value.initializer);
  assert.equal(r.value.stateful.length, 2);
  const checked = checkClosureModule(r.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const run = r.value.module.statements.find(
    (s) => s.kind === "function" && s.name === "run",
  );
  assert.ok(run?.kind === "function");
  assert.equal(run.parameters.length, 1);
  const pure = r.value.module.statements.find(
    (s) => s.kind === "function" && s.name === "pure",
  );
  assert.ok(pure?.kind === "function");
  assert.equal(pure.parameters.length, 1);
  assert.equal(
    r.value.module.statements.some(
      (s) =>
        s.kind === "variable" &&
        s.declarations.some(
          (d) =>
            d.kind !== "object-binding" &&
            d.kind !== "array-binding" &&
            d.name === "K",
        ),
    ),
    false,
  );
});
test("module state follows binding identities and rejects unsupported initialization or function escape", () => {
  assert.ok(
    prepare(
      "const K=[1];function f(K:number):number{return K;}function g():number{return K[0]??0;}",
    ).ok,
  );
  for (const source of [
    "const K=[f()];function f():number{return 1;}",
    "let K=[1];function f():number{return K[0]??0;}",
    "const K=[1];function f():number{return K[0]??0;}const alias=f;",
    "const K=[1];function outer():number{function inner():number{return K[0]??0;}return inner();}",
  ])
    assert.equal(prepare(source).ok, false, source);
});
test("module state handles defaults, recursion, name collisions and export metadata", () => {
  const result = prepare(`
    interface __tint_module_state {readonly n:number}
    const __tint_state=1; const __tint_initialize=2;
    export const K:readonly number[]=[3];
    function recurse(n:number=K[0]??0):number {
      if(n===0)return 0;return recurse(n-1)+1;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.stateParameter, "__tint_state1");
  assert.equal(result.value.initializer?.name, "__tint_initialize1");
  assert.deepEqual([...result.value.globals.values()], ["K"]);
  assert.equal(result.value.stateful.length, 1);
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const fn = result.value.module.statements.find(
    (s) => s.kind === "function" && s.name === "recurse",
  );
  assert.ok(fn?.kind === "function");
  assert.equal(fn.parameters.length, 2);
  assert.ok(indexValues(result.value.functions).includes(fn));
});
test("module state rejects stateful arrow values and preserves readonly array restrictions", () => {
  const arrow = prepare("const K=[1];const get=():number=>K[0]??0;");
  assert.equal(arrow.ok, false);
  const result = prepare(
    "const K:readonly number[]=[1];function f():number{K[0]=2;return 0;}",
  );
  assert.ok(result.ok);
  assert.equal(checkClosureModule(result.value.module).ok, false);
});
