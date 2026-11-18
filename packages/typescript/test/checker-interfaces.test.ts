import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { resolveInterfaceTypes } from "@tint/typescript/checker";
function resolve(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  return resolveInterfaceTypes(parsed.value);
}
test("allocator interface resolves to callable property types", () => {
  const r = resolve(
    readFileSync(
      new URL(
        "../../native-runtime/src/allocators/region/index.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.ok(r.ok);
  const id = r.value.names.get("RegionAllocator");
  assert.notEqual(id, undefined);
  if (id === undefined) return;
  const allocate = r.value.system.property(id, "allocate");
  assert.ok(allocate.ok);
  const number = r.value.names.get("number");
  assert.notEqual(number, undefined);
  if (number === undefined) return;
  const result = r.value.system.call(allocate.value, [number]);
  assert.ok(result.ok);
  assert.equal(r.value.types[result.value]?.kind, "union");
  assert.ok(!r.value.system.writeProperty(id, "allocate", allocate.value).ok);
});
test("forward interface names resolve and unsound or unsupported contracts fail explicitly", () => {
  assert.ok(
    resolve("interface A { readonly next: B } interface B { value: number }")
      .ok,
  );
  for (const text of [
    "interface A { x: Missing }",
    "interface A {} interface A {}",
    "interface A { x: number; x: boolean }",
  ])
    assert.ok(!resolve(text).ok, text);
});

test("finite aliases resolve forward references and preserve shared named types", () => {
  const r = resolve(
    "type Counter = {readonly get:()=>Value}; type Value = number|undefined; type Alias = Counter;",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.names.get("Counter"), r.value.names.get("Alias"));
  const value = r.value.names.get("Value");
  assert.notEqual(value, undefined);
  assert.equal(r.value.types[value!]?.kind, "union");
  for (const text of [
    "type A=B;type B=A;",
    "type A=number;interface A {}",
    "type A={x:number;x:boolean};",
  ])
    assert.ok(!resolve(text).ok, text);
});

test("literal union aliases retain exact string, boolean and numeric alternatives", () => {
  const r = resolve(
    'type Tag="ok"|"error"; type Count=-1|0|1; type Flag=true|false; interface R {readonly kind:Tag; readonly count:Count}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  const n = r.value.names.get("Count");
  assert.notEqual(n, undefined);
  const t = r.value.types[n!];
  assert.equal(t?.kind, "union");
  if (t?.kind === "union")
    assert.deepEqual(
      t.members.map((m) => r.value.types[m]),
      [
        { kind: "literal", value: -1 },
        { kind: "literal", value: 0 },
        { kind: "literal", value: 1 },
      ],
    );
});

test("recursive interfaces and productive aliases resolve stable reference identities", () => {
  const r = resolve(
    "interface Node {readonly next:Node|undefined;readonly value:number} type Alias=Node;type A=B;type B={readonly child:A};",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const n = r.value.names.get("Node"),
    a = r.value.names.get("A"),
    b = r.value.names.get("B");
  assert.notEqual(n, undefined);
  assert.equal(n, r.value.names.get("Alias"));
  assert.equal(a, b);
  assert.notEqual(a, undefined);
  const t = r.value.types[a!];
  assert.ok(t?.kind === "object");
  assert.equal(t.properties[0]?.type, a);
  assert.ok(!resolve("type A=A|number;").ok);
  assert.ok(!resolve("type A=B;type B=A;").ok);
});

test("recursive readonly array fields resolve without expanding their elements", () => {
  const r = resolve(
    "interface Node {readonly children:readonly Node[]; items:Node[]}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const id = r.value.names.get("Node");
  assert.notEqual(id, undefined);
  const n = r.value.types[id!];
  assert.ok(n?.kind === "object");
  const child = r.value.types[n.properties[0]!.type];
  assert.deepEqual(child, { kind: "array", element: id, readonly: true });
});

test("interface inheritance resolves forward bases and validates structural overrides", () => {
  const r = resolve(
    "interface Child extends Base, Named {readonly value:1; next:Child|undefined} interface Base {readonly value:number} interface Named {readonly name:string}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const c = r.value.names.get("Child"),
    b = r.value.names.get("Base");
  assert.notEqual(c, undefined);
  assert.notEqual(b, undefined);
  assert.ok(r.value.system.assignable(c!, b!));
  assert.ok(r.value.system.property(c!, "name").ok);
  for (const source of [
    "interface A extends B {} interface B extends A {}",
    "interface A extends Alias {} type Alias=A;",
    "interface A {value:number} interface B extends A {value:1}",
    "interface A {value:number} interface B extends A {readonly value:number}",
    "interface A extends number {}",
  ])
    assert.ok(!resolve(source).ok, source);
});

test("structural intersections distribute over recursive tagged alternatives", () => {
  const r = resolve(
    'interface Span {readonly start:number;readonly end:number} type Node = Span & ({readonly kind:"leaf";readonly value:number}|{readonly kind:"branch";readonly children:readonly Node[]});',
  );
  assert.ok(r.ok, JSON.stringify(r));
  const id = r.value.names.get("Node")!,
    span = r.value.names.get("Span")!;
  assert.ok(r.value.system.assignable(id, span));
  const t = r.value.types[id];
  assert.equal(t?.kind, "union");
  if (t?.kind !== "union") return;
  assert.equal(t.members.length, 2);
  for (const member of t.members)
    assert.ok(r.value.system.property(member, "start").ok);
  const branch = r.value.types[t.members[1]!];
  assert.ok(branch?.kind === "object");
  const children = branch.properties.find((p) => p.name === "children")!;
  assert.deepEqual(r.value.types[children.type], {
    kind: "array",
    element: id,
    readonly: true,
  });
});

test("intersection expansion rejects unresolved, nonstructural and conflicting operands", () => {
  for (const source of [
    "type A = A & {x:number};",
    "type A = number & {x:number};",
    "type A = {x:number} & {x:boolean};",
    "type A = A | {}; type B=A & {x:number};",
  ])
    assert.ok(!resolve(source).ok, source);
  const r = resolve("type A={readonly x:number}&{x:number};");
  assert.ok(r.ok, JSON.stringify(r));
  const id = r.value.names.get("A")!,
    number = r.value.names.get("number")!;
  assert.ok(r.value.system.writeProperty(id, "x", number).ok);
});

test("the intersection expansion budget bounds each expression, not the program", () => {
  // A 64-member union distributed over 80 intersections takes 5120 steps in
  // all (a linked program checks every module's types at once) but only 64
  // in any one expression.
  const members: string[] = [];
  for (let i = 0; i < 64; i++) members.push(`{readonly kind:${i}}`);
  let text = `type Node=${members.join("|")};`;
  for (let i = 0; i < 80; i++)
    text += `type Tagged${i}=Node&{readonly tag${i}:number};`;
  const r = resolve(text);
  assert.ok(r.ok, JSON.stringify(r));
  const tagged = r.value.types[r.value.names.get("Tagged79")!];
  assert.ok(tagged?.kind === "union");
  assert.equal(tagged.members.length, 64);
});

test("generic type contracts instantiate nested and recursive arguments independently", () => {
  const r = resolve(
    "type Result<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:string}; interface Box<T>{readonly value:T;readonly next:Box<T>|undefined} type NumberBox=Box<number>;type StringBox=Box<string>;type Nested=Result<Box<Result<number>>>;",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const n = r.value.names.get("NumberBox")!,
    s = r.value.names.get("StringBox")!;
  assert.ok(!r.value.system.assignable(n, s));
  const box = r.value.types[n];
  assert.ok(box?.kind === "object");
  assert.equal(r.value.types[box.properties[0]!.type]?.kind, "number");
  const next = r.value.types[box.properties[1]!.type];
  assert.ok(next?.kind === "union");
  assert.ok(next.members.includes(n));
  const nested = r.value.types[r.value.names.get("Nested")!];
  assert.equal(nested?.kind, "union");
});

test("generic argument arity and unproductive instantiation are diagnosed", () => {
  for (const source of [
    "type Box<T>={value:T};type A=Box;",
    "type Box<T>={value:T};type A=Box<number,string>;",
    "type A=number<string>;",
    "type Box<T>=Box<T>;type A=Box<number>;",
    "type Box<T>={value:Box<Box<T>>};type A=Box<number>;",
    "type Box<T,T>={value:T};",
  ])
    assert.ok(!resolve(source).ok, source);
});

test("generic substitutions are scoped and inherited type arguments preserve relationships", () => {
  const r = resolve(
    "type T=string;interface Base<T>{readonly value:T} interface Derived<T> extends Base<T>{readonly values:readonly T[]} type A=Derived<number>;type B=Base<number>;type Global={readonly value:T};",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const a = r.value.names.get("A")!,
    b = r.value.names.get("B")!;
  assert.ok(r.value.system.assignable(a, b));
  const global = r.value.types[r.value.names.get("Global")!];
  assert.ok(global?.kind === "object");
  assert.equal(r.value.types[global.properties[0]!.type]?.kind, "string");
  assert.ok(!resolve("type A<T>=B;type B={value:T};type X=A<number>;").ok);
});
test("optional properties retain declared writes and undefined reads", () => {
  const result = resolve(
    "interface Options {readonly count?:number; required:number|undefined; next?:()=>number}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const id = result.value.names.get("Options")!;
  const type = result.value.types[id];
  assert.ok(type?.kind === "object");
  assert.equal(type.properties[0]?.optional, true);
  assert.equal(type.properties[1]?.optional, undefined);
  const read = result.value.system.property(id, "count");
  assert.ok(read.ok);
  assert.ok(
    result.value.system.assignable(
      result.value.names.get("undefined")!,
      read.value,
    ),
  );
  assert.equal(result.value.system.object(id, []).ok, false);
});
test("optional properties preserve exactness through generic instantiation and intersections", () => {
  const result = resolve(
    "interface Box<T>{readonly value?:T} type Both=Box<number>&{readonly value:number};type Empty=Box<string>; interface Base{readonly value?:number} interface Child extends Base{readonly value:number}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const both = result.value.types[result.value.names.get("Both")!];
  assert.ok(both?.kind === "object");
  assert.equal(both.properties[0]?.optional, false);
  const empty = result.value.types[result.value.names.get("Empty")!];
  assert.ok(empty?.kind === "object");
  assert.equal(empty.properties[0]?.optional, true);
  assert.equal(
    resolve(
      "interface Base{readonly value:number} interface Child extends Base{readonly value?:number}",
    ).ok,
    false,
  );
});

test("indexed access resolves property, union, optional and array element types", () => {
  const r = resolve(`
    interface D { code: "a" | "b"; nested: { value: number }; optional?: string }
    type Code = D["code"];
    type Nested = D["nested"]["value"];
    type Maybe = D["optional"];
    type Both = D["code" | "nested"];
    type Element = (readonly D[])[number];
    type Across = ({ value: number } | { value: string })["value"];
    type Pick<T, K> = T[K];
    type Generic = Pick<D, "nested">["value"];
  `);
  assert.ok(r.ok, JSON.stringify(r));
  const id = (name: string) => {
    const value = r.value.names.get(name);
    assert.notEqual(value, undefined);
    return value!;
  };
  assert.equal(id("Nested"), id("number"));
  assert.equal(id("Generic"), id("number"));
  assert.equal(id("Element"), id("D"));
  for (const name of ["Code", "Maybe", "Both", "Across"])
    assert.equal(r.value.types[id(name)]?.kind, "union", name);
  assert.ok(r.value.system.assignable(id("undefined"), id("Maybe")));
  assert.ok(!r.value.system.assignable(id("undefined"), id("Element")));
  assert.ok(r.value.system.assignable(id("number"), id("Across")));
  assert.ok(r.value.system.assignable(id("string"), id("Across")));
});

test("indexed access rejects invalid keys and unresolved recursive operands", () => {
  for (const source of [
    'type Bad = {x: number}["missing"];',
    'type Bad = ({x: number}|{y: number})["x"];',
    "type Bad = {x: number}[boolean];",
    'type Bad = number["x"];',
    'type Bad = Bad["x"];',
    'type Bad = number[]["missing"];',
  ]) {
    const result = resolve(source);
    assert.ok(!result.ok, source);
  }
});

test("literal intersections filter tagged unions without retaining impossible variants", () => {
  const result = resolve(
    'type Node={readonly kind:"a";value:number}|{readonly kind:"b";text:string};type A=Node & {readonly kind:"a"};type Empty=Node & {readonly kind:"c"};type Narrow={readonly value:string}&{readonly value:"x"};',
  );
  assert.ok(result.ok, JSON.stringify(result));
  const a = result.value.names.get("A")!;
  assert.equal(result.value.types[a]?.kind, "object");
  assert.ok(result.value.system.property(a, "value").ok);
  assert.equal(result.value.system.property(a, "text").ok, false);
  assert.equal(
    result.value.types[result.value.names.get("Empty")!]?.kind,
    "never",
  );
  const field = result.value.system.property(
    result.value.names.get("Narrow")!,
    "value",
  );
  assert.ok(field.ok);
  assert.deepEqual(result.value.types[field.value], {
    kind: "literal",
    value: "x",
  });
});

test("literal intersections preserve optional absence and distribute finite tag unions", () => {
  const r = resolve(
    'type Optional={readonly tag?:"a"}&{readonly tag?:"b"};type Both={readonly tag:"a"|"b";value:number}&{readonly tag:"b"};type Reverse={readonly value:7}&{readonly value:number};',
  );
  assert.ok(r.ok, JSON.stringify(r));
  const optional = r.value.names.get("Optional")!;
  const absent = r.value.system.property(optional, "tag");
  assert.ok(absent.ok);
  assert.deepEqual(r.value.types[absent.value], { kind: "undefined" });
  const tag = r.value.system.property(r.value.names.get("Both")!, "tag");
  assert.ok(tag.ok);
  assert.deepEqual(r.value.types[tag.value], { kind: "literal", value: "b" });
  const number = r.value.system.property(
    r.value.names.get("Reverse")!,
    "value",
  );
  assert.ok(number.ok);
  assert.deepEqual(r.value.types[number.value], { kind: "literal", value: 7 });
});

test("repeated literal annotations share types without conflating primitive kinds", () => {
  const r = resolve(
    'interface Values { a: "1"; b: 1; c: true; d: "1"; e: 1; f: true; g: false; h: 0; i: -0; }',
  );
  assert.ok(r.ok);
  const id = r.value.names.get("Values");
  assert.notEqual(id, undefined);
  const type = r.value.types[id!];
  assert.ok(type?.kind === "object");
  const fields = new Map(type.properties.map((p) => [p.name, p.type]));
  assert.equal(fields.get("a"), fields.get("d"));
  assert.equal(fields.get("b"), fields.get("e"));
  assert.equal(fields.get("c"), fields.get("f"));
  assert.equal(fields.get("h"), fields.get("i"));
  assert.notEqual(fields.get("a"), fields.get("b"));
  assert.notEqual(fields.get("b"), fields.get("c"));
  assert.notEqual(fields.get("c"), fields.get("g"));
});

test("type canonicalization does not probe a numeric map for each resolved alias", () => {
  const OriginalMap = globalThis.Map;
  let numericProbes = 0;
  class CountedMap<K, V> extends OriginalMap<K, V> {
    override get(key: K): V | undefined {
      if (typeof key === "number") numericProbes++;
      return super.get(key);
    }
    override has(key: K): boolean {
      if (typeof key === "number") numericProbes++;
      return super.has(key);
    }
    override set(key: K, value: V): this {
      if (typeof key === "number") numericProbes++;
      return super.set(key, value);
    }
  }
  let result;
  try {
    globalThis.Map = CountedMap;
    result = resolve(
      "type A0={value:number};" +
        Array.from(
          { length: 120 },
          (_, index) => `type A${index + 1}=A${index};`,
        ).join(""),
    );
  } finally {
    globalThis.Map = OriginalMap;
  }
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.names.get("A0"), result.value.names.get("A120"));
  assert.ok(
    numericProbes < 100,
    `canonicalization used ${numericProbes} numeric map operations`,
  );
});
