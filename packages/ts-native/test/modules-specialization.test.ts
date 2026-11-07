import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule, type Span } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { specializeModule } from "@tint/ts-native/modules";
import { checkClosureModule } from "@tint/typescript/checker";
function prepare(text: string, limit = 256) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value, ["undefined", "Set"]);
  assert.ok(bound.ok, JSON.stringify(bound));
  return specializeModule(parsed.value, bound.value, {
    maxSpecializations: limit,
  });
}
test("generic direct calls produce deduplicated concrete functions and preserve recursion", () => {
  const r = prepare(`function id<T>(value:T):T{return value;}
 function repeat<T>(n:number,value:T):T{if(n<=0)return id<T>(value);return repeat<T>(n-1,value);}
 function run():number {const text=id<string>("x");return repeat<number>(3,id<number>(7));}`);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.specializations.length, 3);
  const checked = checkClosureModule(r.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  assert.ok(
    r.value.module.statements.every(
      (s) => s.kind !== "function" || !s.typeParameters?.length,
    ),
  );
});
test("specialization substitutes local, nested function, constructor and generic interface annotations", () => {
  const r = prepare(`interface Box<T>{readonly value:T}
 function box<T>(value:T):Box<T>{const copy:T=value;function local(x:T):T{return x;}return {value:local(copy)};}
 function run():number{return box<number>(4).value;}`);
  assert.ok(r.ok, JSON.stringify(r));
  const checked = checkClosureModule(r.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
test("specialization rejects escapes, missing arguments, arity errors and expanding recursion", () => {
  for (const body of [
    "return id(1);",
    "const other=id;return 1;",
    "return id<number,string>(1);",
  ]) {
    const r = prepare(
      "function id<T>(v:T):T{return v;}function run():number{" + body + "}",
    );
    assert.ok(!r.ok, body);
  }
  const r = prepare(
    "function grow<T>():number{return grow<T[]>();}function run():number{return grow<number>();}",
    5,
  );
  assert.ok(!r.ok);
  assert.match(r.error.message, /limit/);
  assert.match(r.error.message, /5.*grow/);
  const invalid = prepare(
    'function id<T>(x:T):T{return x;}function run():number{return id<number>("x");}',
  );
  assert.ok(invalid.ok);
  assert.ok(!checkClosureModule(invalid.value.module).ok);
});
test("binding identities prevent shadowed calls from specializing a global template", () => {
  const r = prepare(
    "function id<T>(v:T):T{return v;}function run():number{function id(x:number):number{return x;}return id<number>(1);}",
  );
  assert.ok(!r.ok);
  assert.match(r.error.message, /direct generic/);
  const good = prepare(
    "function id<T>(v:T):T{return v;}function run():number{function id(x:number):number{return x;}return id(1);}",
  );
  assert.ok(good.ok);
  assert.equal(good.value.specializations.length, 0);
});

test("generic constructor arguments and generated names remain distinct", () => {
  const r = prepare(
    "function empty<T>():Set<T>{return new Set<T>();}function __tint_specialized_0():number{return 1;}function run():number{return empty<string>().size+__tint_specialized_0();}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.notEqual(r.value.specializations[0]?.name, "__tint_specialized_0");
  const checked = checkClosureModule(r.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
test("generic templates and explicit calls cannot bypass the ordinary checker", () => {
  const bytes = new TextEncoder().encode("function f<T>():number{return 1;}");
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  assert.ok(!checkClosureModule(parsed.value).ok);
});

test("specialization type growth is bounded independently of instance count", () => {
  const r = prepare(
    "function grow<T>():number{return grow<T[]>();}function run():number{return grow<number>();}",
    1000,
  );
  assert.ok(!r.ok);
  assert.match(r.error.message, /nesting limit/);
});

test("explicit roots materialize runtime helpers without synthetic source calls", () => {
  const bytes = new TextEncoder().encode(
    "function identity<T>(value:T):T{return value;}",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const bound = bindModule(parsed.value);
  assert.ok(bound.ok);
  const argument = { kind: "named", name: "string", start: 0, end: 0 } as const;
  const r = specializeModule(parsed.value, bound.value, {
    roots: [
      { function: 0, arguments: [argument] },
      { function: 0, arguments: [argument] },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.specializations.length, 1);
  assert.deepEqual(r.value.roots, [
    r.value.specializations[0]?.name,
    r.value.specializations[0]?.name,
  ]);
  assert.ok(checkClosureModule(r.value.module).ok);
  assert.ok(
    !specializeModule(parsed.value, bound.value, {
      roots: [{ function: 99, arguments: [argument] }],
    }).ok,
  );
});

test("generic specialization substitutes both operands of indexed access", () => {
  const result = prepare(`function identity<T,K>(value:T[K]):T[K]{return value;}
    interface Shape { value:number }
    function run():number{return identity<Shape,"value">(7);}`);
  assert.ok(result.ok, JSON.stringify(result));
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("nested generic specializations stay in their declaring lexical block", () => {
  const result = prepare(`function outer(start:number):number{
    let total=start;
    function add<T>(value:T,n:number):T{total+=n;return value;}
    const a=add<number>(2,3);const b=add<string>("x",4);
    return a+total+b.length;
  }function run():number{return outer(10);}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.specializations.length, 2);
  const outer = result.value.module.statements.find(
    (s) => s.kind === "function" && s.name === "outer",
  );
  assert.ok(outer?.kind === "function");
  assert.ok(outer.body.kind === "block");
  assert.equal(
    outer.body.statements.filter((s) => s.kind === "function").length,
    2,
  );
  assert.equal(
    result.value.module.statements.filter((s) => s.kind === "function").length,
    2,
  );
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("nested generic recursion and shadowing preserve declaration identity", () => {
  const result = prepare(`function identity<T>(v:T):T{return v;}
    function outer(n:number):number{
      function identity<T>(v:T,n:number):T{if(n===0)return v;return identity<T>(v,n-1);}
      const a=identity<number>(7,n);
      {function identity<T>(v:T):T{return v;}const b=identity<string>("x");}
      return a;
    }function run():number{return identity<number>(outer(2));}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.specializations.length, 3);
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("nested generic escapes and generic-ancestor specialization are rejected", () => {
  for (const source of [
    "function outer():number{function id<T>(v:T):T{return v;}const f=id;return 1;}",
    "function outer<T>(v:T):T{function id<U>(v:U):U{return v;}return id<T>(v);}function run():number{return outer<number>(1);}",
  ])
    assert.equal(prepare(source).ok, false, source);
});

test("specialization identities distinguish call and construct signatures", () => {
  const result = prepare(`function marker<T>():number{return 42;}
    function run():number {
      marker<{():number}>();marker<{new():number}>();
      marker<{():number;new():number}>();return marker<{():number}>();
    }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.specializations.length, 3);
  assert.ok(checkClosureModule(result.value.module).ok);
});

test("local specialization output assigns fresh hashes after generated declarations are inserted", () => {
  const result = prepare(
    `function outer(start:number):number{function id<T>(value:T):T{return value;}const number=id<number>(start);const text=id<string>("x");return number+text.length;}function run():number{return outer(4);}`,
  );
  assert.ok(result.ok, JSON.stringify(result));
  const objects = new Set<Span>(),
    hashes = new Map<number, Span>();
  let missing = 0,
    duplicates = 0;
  function record<T extends Span>(mapped: T, original: Span): T {
    if (objects.has(original)) return mapped;
    objects.add(original);
    if (original.nodeHash === undefined) missing++;
    else {
      const previous = hashes.get(original.nodeHash);
      if (previous !== undefined && previous !== original) duplicates++;
      hashes.set(original.nodeHash, original);
    }
    return mapped;
  }
  rewriteModule(result.value.module, {
    expression: record,
    type: record,
    statement: record,
  });
  assert.equal(missing, 0, missing + " generated nodes have no hash");
  assert.equal(
    duplicates,
    0,
    duplicates + " distinct generated nodes share hashes",
  );
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
