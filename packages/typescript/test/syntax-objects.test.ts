import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseModule(source.value);
}
test("interfaces preserve readonly properties and nested function types", () => {
  const r = parse(
    "export interface API { readonly run: (x: number) => number | undefined; next: () => (x: number) => boolean\n value: (number | undefined)[] }",
  );
  assert.ok(r.ok);
  const node = r.value.statements[0];
  assert.ok(node?.kind === "interface");
  assert.equal(node.exported, true);
  assert.equal(node.properties.length, 3);
  assert.equal(node.properties[0]?.readonly, true);
  assert.equal(node.properties[0]?.type.kind, "function");
});
test("object properties and arrow bodies preserve order, grouping and spans", () => {
  const text =
    "const api = { value, default: 1, run: (x: number): number => { return x; }, nested: x => y => ({x: x, y}), };";
  const r = parse(text);
  assert.ok(r.ok);
  const stmt = r.value.statements[0];
  assert.ok(stmt?.kind === "variable");
  const object = stmt.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  assert.deepEqual(
    object.properties.map((p) => {
      assert.ok(p.kind !== "spread");
      return p.name;
    }),
    ["value", "default", "run", "nested"],
  );
  const first = object.properties[0];
  assert.ok(first !== undefined && first.kind !== "spread");
  assert.equal(first.shorthand, true);
  assert.equal(object.properties[2]?.value.kind, "arrow");
  assert.equal(
    text.slice(object.start, object.end),
    text.slice(text.indexOf("{"), -1),
  );
});
test("the allocator implementation parses unchanged", () => {
  const text = readFileSync(
    new URL(
      "../../native-runtime/src/allocators/region/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const r = parse(text);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(
    r.value.statements.map((s) => s.kind),
    [
      "interface",
      "function",
      "function",
      "function",
      "function",
      "function",
      "function",
      "function",
      "function",
    ],
  );
});
test("arrow function boundaries reset loop control and permit returns and throws", () => {
  assert.ok(parse("interface A extends B, C {}").ok);
  assert.ok(parse('const f = () => { throw "failure"; };').ok);
  assert.ok(parse("const f = () => { return 1; };").ok);
  for (const text of [
    "while(true) { const f = () => { break; }; }",
    "while(true) { const f = () => { continue; }; }",
    "const f = (x)\n=> x;",
    "const f = x\n=> x;",
    "const f = x + y => y;",
    "const f = !x => x;",
    "throw\n1;",
    "throw;",
    "const f = (x, x) => x;",
    "const x = { default };",
    "const x = { a: 1 b: 2 };",
    "const x = { a = 1 };",
    "interface A { x: number y: number }",
    "interface A { x: number | () => number }",
    "interface A { f: (x) => number }",
  ])
    assert.equal(parse(text).ok, false, text);
});
test("recursive type and arrow syntax obeys the nesting budget", () => {
  for (const text of [
    "interface A { x: " + "() => ".repeat(200) + "number }",
    "const f = " + "x => ".repeat(200) + "x;",
    "interface A { x: " + "(".repeat(200) + "number" + ")".repeat(200) + " }",
  ]) {
    const r = parse(text);
    assert.ok(!r.ok);
    assert.equal(r.error.code, "LIMIT");
  }
});

test("allocator declaration and closure boundaries match TypeScript spans", async () => {
  const { default: ts } = await import("typescript");
  const text = readFileSync(
    new URL(
      "../../native-runtime/src/allocators/region/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const r = parse(text);
  assert.ok(r.ok);
  const actual: unknown[][] = [];
  const expected: unknown[][] = [];
  function walkTint(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if (
      "kind" in value &&
      "start" in value &&
      "end" in value &&
      ["interface", "function", "arrow", "object", "throw"].includes(
        String(value.kind),
      )
    ) {
      actual.push([value.kind, value.start, value.end]);
    }
    for (const child of Object.values(value)) walkTint(child);
  }
  function walkTS(node: import("typescript").Node): void {
    const kind = ts.isInterfaceDeclaration(node)
      ? "interface"
      : ts.isFunctionDeclaration(node) || ts.isFunctionTypeNode(node)
        ? "function"
        : ts.isArrowFunction(node)
          ? "arrow"
          : ts.isObjectLiteralExpression(node)
            ? "object"
            : ts.isThrowStatement(node)
              ? "throw"
              : undefined;
    if (kind !== undefined) expected.push([kind, node.getStart(), node.end]);
    ts.forEachChild(node, walkTS);
  }
  walkTint(r.value);
  walkTS(
    ts.createSourceFile(
      "allocator.ts",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
  );
  const sort = (a: unknown[], b: unknown[]) => Number(a[1]) - Number(b[1]);
  assert.ok(actual.length > 10);
  assert.deepEqual(actual.sort(sort), expected.sort(sort));
});
test("optional properties preserve absence syntax independently of readonly and undefined", () => {
  const text =
    "interface Options {readonly count?:number; required:number|undefined; readonly?:boolean; readonly readonlyFlag?:boolean} type Shape={value?:string; readonly next?:()=>number};";
  const result = parse(text);
  assert.ok(result.ok, JSON.stringify(result));
  const options = result.value.statements[0];
  assert.ok(options?.kind === "interface");
  assert.deepEqual(
    options.properties.map((p) => [p.name, p.readonly, p.optional === true]),
    [
      ["count", true, true],
      ["required", false, false],
      ["readonly", false, true],
      ["readonlyFlag", true, true],
    ],
  );
  assert.equal(
    text.slice(options.properties[0]!.start, options.properties[0]!.end),
    "readonly count?:number",
  );
  const shape = result.value.statements[1];
  assert.ok(shape?.kind === "type-alias" && shape.type.kind === "object");
  assert.equal(shape.type.properties[0]?.optional, true);
  assert.equal(shape.type.properties[1]?.optional, true);
  for (const invalid of [
    "interface A {x??:number}",
    "interface A {x?number}",
    "interface A {x?:}",
  ])
    assert.equal(parse(invalid).ok, false, invalid);
});
test("Tint syntax and IR models parse unchanged with optional property declarations", () => {
  for (const path of [
    "../src/syntax/model.ts",
    "../../ir/src/scalar/model.ts",
    "../../image/src/darwin/macho/index.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const parsed = parse(source);
    assert.ok(parsed.ok, `${path}: ${JSON.stringify(parsed)}`);
  }
});

test("quoted object keys decode to fixed names without permitting shorthand", () => {
  const result = parse('const x = {"value": 1, "\\u006eext": 2, "": 3};');
  assert.ok(result.ok);
  const stmt = result.value.statements[0];
  assert.ok(stmt?.kind === "variable");
  const object = stmt.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  assert.deepEqual(
    object.properties.map((p) => {
      assert.ok(p.kind !== "spread");
      assert.equal(p.shorthand, false);
      return p.name;
    }),
    ["value", "next", ""],
  );
  assert.equal(parse('const x = {"value"};').ok, false);
  assert.equal(parse('const x = {"__proto__": null};').ok, true);
});

test("quoted type properties preserve modifiers and decoded names", () => {
  const result = parse(
    'interface Shape {readonly "value":number; "next"?:Shape; "readonly":boolean}',
  );
  assert.ok(result.ok);
  const node = result.value.statements[0];
  assert.ok(node?.kind === "interface");
  assert.deepEqual(
    node.properties.map((p) => [p.name, p.readonly, p.optional === true]),
    [
      ["value", true, false],
      ["next", false, true],
      ["readonly", false, false],
    ],
  );
});

test("quoted readonly is a property name, never a modifier", () => {
  assert.equal(parse('interface Shape {"readonly" value:number}').ok, false);
});

test("numeric property names normalize their literal spelling", () => {
  const result = parse("const x = {0x10:1, 1_000:2, 1e2:3, 0.5:4};");
  assert.ok(result.ok);
  const stmt = result.value.statements[0];
  assert.ok(stmt?.kind === "variable");
  const object = stmt.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  assert.deepEqual(
    object.properties.map((p) => {
      assert.ok(p.kind !== "spread");
      return p.name;
    }),
    ["16", "1000", "100", "0.5"],
  );
  assert.ok(parse("interface Shape {0x10:number; 1_000?:string}").ok);
  assert.equal(parse("const x = {42};").ok, false);
});

test("prototype setter syntax accepts every decoded key spelling", () => {
  for (const source of [
    "const x = {__proto__: null};",
    'const x = {"__proto__": null};',
    'const x = {"\\u005f_proto__": null};',
  ]) {
    const result = parse(source);
    assert.equal(result.ok, true, source);
  }
  assert.ok(parse("const __proto__ = 1; const x = {__proto__};").ok);
});

test("anonymous function expressions retain ordinary-function syntax and scope", () => {
  const result = parse("const f = function(x:number):number {return x+1;};");
  assert.ok(result.ok);
  const declaration = result.value.statements[0];
  assert.ok(declaration?.kind === "variable");
  assert.equal(
    declaration.declarations[0]?.initializer?.kind,
    "function-expression",
  );
  assert.equal(parse("while(true){const f=function(){break;};}").ok, false);
  assert.equal(parse("const f=function(){return 1;};").ok, true);
});

test("object methods and interface method signatures retain callable shapes", () => {
  const result = parse(
    "interface Counter {add(n:number):number} const c:Counter={add(n){return n+1;}};",
  );
  assert.ok(result.ok);
  const type = result.value.statements[0];
  assert.ok(type?.kind === "interface");
  assert.equal(type.properties[0]?.type.kind, "function");
  assert.ok(parse('const x={"__proto__"(){return 1;}};').ok);
});

test("method names and modifiers preserve property syntax distinctions", () => {
  assert.ok(parse("interface API {readonly():number; optional?():number}").ok);
  assert.equal(parse("interface API {readonly method():number}").ok, false);
  assert.equal(parse("while(true){const x={method(){continue;}};}").ok, false);
  const result = parse('const x={"value"(){return 1;}, 42(){return 2;}};');
  assert.ok(result.ok);
  const stmt = result.value.statements[0];
  assert.ok(stmt?.kind === "variable");
  const object = stmt.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  for (const property of object.properties) {
    assert.ok(property.kind !== "spread");
    assert.equal(property.method, true);
    assert.equal(property.shorthand, false);
  }
});

test("literal computed property names remain ordinary data properties", () => {
  const result = parse(
    'interface Box { ["quoted-key"]:number; [42]:number } const box:Box={["quoted-key"]:1,[0x2a]:2}; const own={["__proto__"]:3}; const methods={["read"](){return 1;}};',
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("computed key metadata distinguishes data properties from prototype setters", () => {
  const result = parse('const object={["__proto__"]:1,["read"](){return 2;}};');
  assert.ok(result.ok);
  const statement = result.value.statements[0];
  assert.ok(statement?.kind === "variable");
  const object = statement.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  for (const property of object.properties) {
    assert.ok(property.kind !== "spread");
    assert.equal(property.computed, true);
    assert.equal(property.shorthand, false);
  }
  const dynamic = parse("const object={[key]:1};");
  assert.ok(dynamic.ok);
  assert.equal(parse('const object={["key"]};').ok, false);
});

test("signed numeric computed keys normalize negative zero and grouped literals", () => {
  const result = parse("const object={[-1]:1,[-0]:2,[+(42)]:3};");
  assert.ok(result.ok, JSON.stringify(result));
  const statement = result.value.statements[0];
  assert.ok(statement?.kind === "variable");
  const object = statement.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  assert.deepEqual(
    object.properties.map((property) => {
      assert.ok(property.kind !== "spread");
      return property.name;
    }),
    ["-1", "0", "42"],
  );
});

test("object accessors preserve kinds, names and callable bodies", () => {
  const result = parse(
    "const o={get x(){return 1;},set x(v){},get(){},get:1};",
  );
  assert.ok(result.ok);
  const stmt = result.value.statements[0];
  assert.ok(stmt?.kind === "variable");
  const object = stmt.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  assert.deepEqual(
    object.properties.map((p) =>
      p.kind === "spread" ? undefined : p.accessor,
    ),
    ["get", "set", undefined, undefined],
  );
});

test("object accessors reject invalid arity and rest setters", () => {
  for (const text of [
    "({get x(v){}});",
    "({set x(){}});",
    "({set x(a,b){}});",
    "({set x(...v){}});",
  ]) {
    const result = parse(text);
    assert.ok(!result.ok, text);
    assert.equal(result.error.code, "SYNTAX_ERROR");
  }
});

test("escaped accessor keywords do not introduce accessors", () => {
  assert.equal(parse("({g\\u0065t x(){return 1;}});").ok, false);
});

test("prototype setters are distinct from computed, shorthand and method properties", () => {
  assert.ok(parse("const o={__proto__:null};").ok);
  assert.ok(parse("const o={__proto__:null,['__proto__']:1};").ok);
  assert.ok(parse("const __proto__=1;const o={__proto__:null,__proto__};").ok);
  assert.ok(parse("const o={__proto__:null,get __proto__(){return 1;}};").ok);
  const duplicate = parse("const o={__proto__:null,'__proto__':{}};");
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.error.code, "SYNTAX_ERROR");
});

test("dynamic computed object keys retain their expressions", () => {
  const result = parse(
    "const key='x';const o={[key]:1,get [key+'y'](){return 2;},[key+'z'](){return 3;}};",
  );
  assert.ok(result.ok);
  const stmt = result.value.statements[1];
  assert.ok(stmt?.kind === "variable");
  const object = stmt.declarations[0]?.initializer;
  assert.ok(object?.kind === "object");
  for (const p of object.properties) {
    assert.ok(p.kind !== "spread");
    assert.equal(p.computed, true);
    assert.ok(p.keyExpression);
  }
});

test("syntax rewrites visit computed keys before property values", () => {
  const parsed = parse("const o={[key]:value};");
  assert.ok(parsed.ok);
  const visited: string[] = [];
  rewriteModule(parsed.value, {
    expression(node) {
      if (node.kind === "identifier") visited.push(node.name);
      return node;
    },
  });
  assert.deepEqual(visited, ["key", "value"]);
});
