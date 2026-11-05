import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import { checkClosureModule, checkModule } from "@tint/typescript/checker";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
test("optional chain sites survive linking and generic specialization", () => {
  const module = parse(
    "export function copy<T>(value:T):void {const read=()=>value?.field.next?.[0]?.();}export function run(value:number):void {copy<number>(value);}",
  );
  const linked = linkModules(
    [{ id: "main", module, dependencies: new Map() }],
    "main",
    [],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok);
  const specialized = specializeModule(linked.value.module, bound.value);
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const rebound = bindModule(specialized.value.module);
  assert.ok(rebound.ok, JSON.stringify(rebound));
  assert.ok(rebound.value.bindings.some((b) => b.captured));
  const sites: string[] = [];
  rewriteModule(specialized.value.module, {
    expression(node) {
      if (
        node.kind === "member" ||
        node.kind === "index" ||
        node.kind === "call"
      )
        if (node.optional) sites.push(node.kind);
      return node;
    },
  });
  assert.deepEqual(sites, ["member", "index", "call"]);
});
test("scalar checker retains its explicit optional-chain boundary", () => {
  for (const expression of ["value?.length", "value?.[0]"]) {
    const module = parse(
      `function run(value:Uint8Array):number{return ${expression};}`,
    );
    for (const checked of [checkModule(module)]) {
      assert.ok(!checked.ok);
      assert.match(checked.error.message, /optional chaining/);
    }
  }
});

test("closure checker tracks optional chain live values separately from skipped values", () => {
  for (const source of [
    "function f(x:{next:{value:number}}|undefined):number|undefined{return x?.next.value;}",
    "function f(x:{next:{value:number}|undefined}|undefined):number|undefined{return x?.next?.value;}",
    "function f(x:Uint8Array|undefined):number|undefined{return x?.[0];}",
    "function f(x:(()=>number)|undefined):number|undefined{return x?.();}",
    "function f(x:{run:()=>number}|undefined):number|undefined{return x?.run();}",
    "function f(x:{run:(()=>number)|undefined}|undefined):number|undefined{return x?.run?.();}",
    "function f(x:{value:number}):number{return x?.value;}",
  ]) {
    const checked = checkClosureModule(parse(source));
    assert.ok(checked.ok, JSON.stringify({ source, checked }));
  }
});

test("optional checks do not erase independent absence or cross a grouped boundary", () => {
  for (const source of [
    "function f(x:{next:{value:number}|undefined}|undefined):number|undefined{return x?.next.value;}",
    "function f(x:{next:{value:number}}|undefined):number{return (x?.next).value;}",
    "function f(x:{value:number}|undefined):number{return x?.value;}",
    "function f(x:{run:(()=>number)|undefined}|undefined):number|undefined{return x?.run();}",
    "function f(x:unknown):unknown{return x?.value;}",
    "function f(x:((n:number)=>number)|undefined):number|undefined{return x?.(true);}",
  ])
    assert.equal(checkClosureModule(parse(source)).ok, false, source);
});

test("skipped indexes and arguments cannot establish definite presence", () => {
  for (const body of ["x?.[value=0];", "call?.(value=0);"]) {
    const module = parse(
      `function f(x:Uint8Array|undefined,call:((n:number)=>number)|undefined,value:number|undefined):number{${body}return value+1;}`,
    );
    assert.equal(checkClosureModule(module).ok, false, body);
  }
  const checked = checkClosureModule(
    parse(
      "function f(x:Uint8Array|undefined,value:number|undefined):number|undefined{x?.[value=0];return value;}",
    ),
  );
  assert.ok(checked.ok, JSON.stringify(checked));
});
