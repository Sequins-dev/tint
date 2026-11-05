import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import {
  parseModule,
  parseScript,
  rewriteModule,
} from "@tint/typescript/syntax";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    r = createSourceText(bytes, bytes.length);
  assert.equal(r.ok, true);
  return parseModule(r.value);
}
test("parses imports and typed scalar control flow into spanned ASTs", () => {
  const text =
    'import type { T as U } from "./types.ts"; import def, { value as v, type Shape } from "@lib/core"; import * as ns from "./ns.ts"; import "./side.ts"; export function choose(x: number, y: number): number { let result: number = x + y * 2; if (result > 10) { return result; } else return ns.f(0); }';
  const r = parse(text);
  assert.equal(r.ok, true);
  assert.equal(r.value.imports.length, 4);
  assert.equal(r.value.imports[0]?.typeOnly, true);
  assert.deepEqual(
    r.value.imports[1]?.bindings.map((x) => [x.imported, x.local, x.typeOnly]),
    [
      ["default", "def", false],
      ["value", "v", false],
      ["Shape", "Shape", true],
    ],
  );
  const fn = r.value.statements[4];
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function") return;
  assert.equal(fn.exported, true);
  assert.equal(fn.parameters.length, 2);
  assert.equal(fn.body.kind, "block");
  if (fn.body.kind === "block") {
    const variable = fn.body.statements[0];
    assert.equal(variable?.kind, "variable");
    if (variable?.kind === "variable") {
      const e = variable.declarations[0]?.initializer;
      assert.equal(e?.kind, "binary");
      if (e?.kind === "binary") {
        assert.equal(e.operator, "+");
        assert.equal(e.right.kind, "binary");
      }
    }
  }
  for (const imp of r.value.imports)
    assert.ok(
      text
        .slice(imp.specifierSpan.start, imp.specifierSpan.end)
        .includes(imp.specifier),
    );
});
test("precedence, associativity, assignment, conditionals and ASI preserve syntax", () => {
  const r = parse(
    "function f(): number { let a=0,b=1; a = b = 2; while (a < 3) { a = a + 1; if (a === 2) continue; break; } return\n a ? 2 : 3; }",
  );
  assert.equal(r.ok, true);
  const fn = r.value.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  const statements = fn.body.statements;
  const assignment = statements[1];
  assert.ok(
    assignment?.kind === "expression" &&
      assignment.expression.kind === "assignment",
  );
  assert.equal(assignment.expression.value.kind, "assignment");
  const ret = statements[3];
  assert.ok(ret?.kind === "return");
  assert.equal(ret.expression, undefined);
  assert.equal(statements[4]?.kind, "expression");
  assert.equal(parse("const x = 1\n+ 2\nconst y = -x;").ok, true);
  assert.equal(parse("const x: number | boolean[] = true;").ok, true);
});
test("invalid or unimplemented syntax fails explicitly, without a partial AST", () => {
  for (const text of [
    "function f( {",
    "const = 1;",
    "const x;",
    "let x = ;",
    "return 1;",
    "break;",
    "if(true) const x=1;",
    'function f(){ import "./x.ts"; }',
    "const r=/[a&&b--c]/v;",
    "const x=1 as number;",
    "const x=-2 ** 3;",
    "let x=1 let y=2;",
    "const x=1; garbage garbage",
    'import type "./x.ts";',
    'import {a as} from "./x.ts";',
    "const x=(1+2)=3;",
  ]) {
    const r = parse(text);
    assert.equal(r.ok, false, text);
    assert.equal("value" in r, false);
    if (!r.ok) assert.ok(r.error.position.line >= 1);
  }
  const r = parse("const x = " + "(".repeat(300) + "1" + ")".repeat(300));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "LIMIT");
});

test("contextual TypeScript forms are rejected rather than reinterpreted as JavaScript statements", () => {
  for (const text of [
    "f<number>\nx;",
    'import foo, from "x";',
    "const x = value\nas\nnumber;",
    "const x = value\nsatisfies\nShape;",
    "declare\nfunction f(): number;",
  ])
    assert.equal(parse(text).ok, false, text);
});

test("type aliases retain structural object and function annotations", () => {
  const r = parse(
    "export type Counter = { readonly get: () => Value; set: (n: Value) => void }; type Value = number | undefined;",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const first = r.value.statements[0];
  assert.ok(first?.kind === "type-alias");
  assert.equal(first.exported, true);
  assert.equal(first.type.kind, "object");
});

test("a line break after type still starts an alias declaration", () => {
  const r = parse("type\nT=number;");
  assert.ok(r.ok);
  assert.equal(r.value.statements[0]?.kind, "type-alias");
});

test("leading union bars preserve the complete annotation span", () => {
  const r = parse('type T = | "a" | "b";');
  assert.ok(r.ok, JSON.stringify(r));
  const node = r.value.statements[0];
  assert.ok(node?.kind === "type-alias");
  assert.equal(node.type.kind, "union");
  assert.equal(node.type.start, 9);
});

test("intersection types bind tighter than unions and preserve parentheses", () => {
  const r = parse("type T = A | B & C | (D | E) & F; type U = & A & B;");
  assert.ok(r.ok);
  const t = r.value.statements[0];
  assert.ok(t?.kind === "type-alias");
  assert.equal(t.type.kind, "union");
  if (t.type.kind !== "union") return;
  assert.deepEqual(
    t.type.members.map((m) => m.kind),
    ["named", "intersection", "intersection"],
  );
  const last = t.type.members[2];
  assert.ok(last?.kind === "intersection");
  assert.equal(last.members[0]?.kind, "group");
  for (const source of ["type T=A &;", "type T=A & () => number;", "type T=&;"])
    assert.ok(!parse(source).ok, source);
});

test("generic type brackets split only in type context, retaining spans and shift operators", () => {
  const source =
    "type Box<T>={readonly value:T};type A=Box<Box<number>>; const n=8>>1; type B<T>=Box<T>; interface C<T> extends Box<Box<T>> {}";
  const r = parse(source);
  assert.ok(r.ok, JSON.stringify(r));
  const a = r.value.statements[1];
  assert.ok(a?.kind === "type-alias");
  assert.ok(a.type.kind === "named");
  assert.equal(source.slice(a.type.start, a.type.end), "Box<Box<number>>");
  const inner = a.type.arguments?.[0];
  assert.ok(inner?.kind === "named");
  assert.equal(source.slice(inner.start, inner.end), "Box<number>");
  const n = r.value.statements[2];
  assert.ok(n?.kind === "variable");
  const expression = n.declarations[0]?.initializer;
  assert.ok(expression?.kind === "binary");
  assert.equal(expression.operator, ">>");
  const c = r.value.statements[4];
  assert.ok(c?.kind === "interface");
  assert.deepEqual(c.typeParameters, ["T"]);
  for (const invalid of [
    "type A<> = number;",
    "type A<T extends number>=T;",
    "type A<T=number>=T;",
  ])
    assert.ok(!parse(invalid).ok, invalid);
});
test("dense array literals preserve nested elements, assignments, spans and trailing commas", () => {
  const text = "const values=[1,[2,3],x=4,]; const empty=[];";
  const r = parse(text);
  assert.ok(r.ok, JSON.stringify(r));
  const statement = r.value.statements[0];
  assert.ok(statement?.kind === "variable");
  const value = statement.declarations[0]?.initializer;
  assert.ok(value?.kind === "array");
  assert.deepEqual(
    value.elements.map((e) => e.kind),
    ["number", "array", "assignment"],
  );
  assert.equal(text.slice(value.start, value.end), "[1,[2,3],x=4,]");
  for (const invalid of ["const x=[1;2];", "const x=[1;"])
    assert.equal(parse(invalid).ok, false);
});
test("constructor expressions retain generic arguments and distinguish construction from calls", () => {
  const r = parse(
    "const a=new Map<string, readonly number[]>(); const b=new ns.Factory(1).value; const c=new (factory())(2); const d=new Thing;",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const values = r.value.statements.map((s) =>
    s.kind === "variable" ? s.declarations[0]?.initializer : undefined,
  );
  assert.ok(values[0]?.kind === "new");
  assert.equal(values[0].typeArguments.length, 2);
  assert.equal(values[0].arguments.length, 0);
  assert.ok(values[1]?.kind === "member" && values[1].object.kind === "new");
  assert.equal(values[1].object.callee.kind, "member");
  assert.ok(values[2]?.kind === "new" && values[2].callee.kind === "group");
  assert.equal(values[2].callee.expression.kind, "call");
  assert.ok(values[3]?.kind === "new");
  assert.equal(values[3].arguments.length, 0);
  for (const text of [
    "const a=new;",
    "const a=new Map<>();",
    "const a=new C(,);",
    "const a=new C()=1;",
  ])
    assert.equal(parse(text).ok, false, text);
});
test("switch clauses preserve default position, empty cases and fallthrough", () => {
  const r = parse(
    "function run(n:number):number{switch(n){case 1:case 2:n=3;break;default:n=4;case 5:return n;}return n;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const fn = r.value.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  const sw = fn.body.statements[0];
  assert.ok(sw?.kind === "switch");
  assert.equal(sw.clauses.length, 4);
  assert.equal(sw.clauses[0]?.statements.length, 0);
  assert.equal(sw.clauses[2]?.test, undefined);
  for (const text of [
    "switch(1){default:default:}",
    "switch(1){case 1 break;}",
    "switch(1){continue;}",
    "switch(1){case 1:continue;}",
    "switch(1){case 1:function f(){break;}}",
  ])
    assert.equal(parse(text).ok, false, text);
  assert.ok(
    parse("while(true){switch(1){case 1:continue;default:break;}break;}").ok,
  );
});
test("for-of declarations retain bindings, iterable spans and loop control", () => {
  const r = parse(
    "function f(a:Uint8Array):number {for(const item of a){if(item===1)continue;break;} return 0;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const f = r.value.statements[0];
  assert.ok(f?.kind === "function" && f.body.kind === "block");
  const loop = f.body.statements[0];
  assert.ok(loop?.kind === "for-of");
  assert.equal(loop.mode, "const");
  assert.ok("name" in loop.binding);
  assert.equal(loop.binding.name, "item");
  assert.equal(loop.iterable.kind, "identifier");
  for (const header of [
    "const x=1 of a",
    "const x,y of a",
    "const x:number of a",
  ])
    assert.equal(
      parse(`function f(a:Uint8Array):void{for(${header}){}}`).ok,
      false,
      header,
    );
  assert.equal(
    parse(
      "function f(a:Uint8Array):void{for(const x of a){const f=()=>{break;};}}",
    ).ok,
    false,
  );
});

test("optional and initialized parameters preserve expressions and source spans", () => {
  const r = parse(
    "function f(a:number=1,b?:number):number{return a;} const g=(x=2)=>x; type F=(x?:number)=>number;",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const f = r.value.statements[0];
  assert.ok(f?.kind === "function");
  assert.equal(f.parameters[0]?.initializer?.kind, "number");
  assert.equal(f.parameters[1]?.optional, true);
  for (const source of [
    "function f(x?:number=1){}",
    "type F=(x:number=1)=>number;",
  ])
    assert.equal(parse(source).ok, false, source);
});

test("explicit generic functions and call type arguments retain syntax contracts", () => {
  const r = parse(
    "function id<T>(x:T):T{return x;} function run():number{return id<number>(3);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const fn = r.value.statements[0];
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function") return;
  assert.deepEqual(fn.typeParameters, ["T"]);
  const nested = parse(
    "function f():void { consume<Box<Pair<number,string>>>(value); const comparison = a < b > c; }",
  );
  assert.ok(nested.ok, JSON.stringify(nested));
  assert.equal(parse("function duplicate<T,T>(x:T):T{return x;}").ok, false);
});

test("generic call lookahead does not consume relational expressions or split shifts", () => {
  for (const expression of [
    "field.offset < 16 || field.offset + 8 >\n record.byteLength",
    "f < Box < T >> value",
    "f < Box < T >>> value",
  ]) {
    const result = parse(`function run():void { consume(${expression}); }`);
    assert.ok(result.ok, JSON.stringify(result));
    const rewritten = rewriteModule(result.value, {});
    assert.deepEqual(rewritten, result.value);
  }
  const result = parse("const value = f < Box < T >> value;");
  assert.ok(result.ok, JSON.stringify(result));
  const declaration = result.value.statements[0];
  assert.ok(declaration?.kind === "variable");
  const expression = declaration.declarations[0]?.initializer;
  assert.ok(expression?.kind === "binary" && expression.operator === "<");
  assert.ok(
    expression.right.kind === "binary" && expression.right.operator === ">>",
  );
});

test("spread syntax preserves ordered operands and cannot escape collection positions", () => {
  const source =
    "const values = [head(), ...items, tail()]; const copy = {first: head(), ...input, last: tail()};";
  const result = parse(source);
  assert.ok(result.ok, JSON.stringify(result));
  const operands: string[] = [];
  rewriteModule(result.value, {
    expression(mapped) {
      if (mapped.kind === "identifier") operands.push(mapped.name);
      return mapped;
    },
  });
  assert.deepEqual(operands, [
    "head",
    "items",
    "tail",
    "head",
    "input",
    "tail",
  ]);
  assert.deepEqual(rewriteModule(result.value, {}), result.value);
  for (const invalid of [
    "const x = ...items;",
    "const x = [...];",
    "const x = {...};",
  ])
    assert.equal(parse(invalid).ok, false, invalid);
});

test("optional chains retain short-circuit sites and reject assignment and constructor targets", () => {
  for (const value of [
    "input?.field.next",
    "input?.[key()]",
    "input.method?.(argument())",
    "input?.<number>(1)",
    "(input?.field).next",
    "new (input?.constructor)()",
    "new Factory()?.field",
  ])
    assert.ok(parse(`const result = ${value};`).ok, value);
  for (const value of [
    "input?.field=1",
    "input?.field.next+=1",
    "input?.[key()]++",
    "++input?.field",
    "(input?.field)=1",
    "new input?.field()",
    "new input?.()",
  ])
    assert.ok(!parse(`${value};`).ok, value);
  assert.ok(parse("(input?.field).next = 1;").ok);
});

test("indexed access binds before array and union suffixes and retains source spans", () => {
  const text = 'type Value = Shape["field"][number][] | undefined;';
  const result = parse(text);
  assert.ok(result.ok, JSON.stringify(result));
  const alias = result.value.statements[0];
  assert.ok(alias?.kind === "type-alias" && alias.type.kind === "union");
  const array = alias.type.members[0];
  assert.ok(array?.kind === "array");
  const outer = array.element;
  assert.equal(outer.kind, "indexed-access");
  assert.equal(text.slice(outer.start, outer.end), 'Shape["field"][number]');
  if (outer.kind === "indexed-access") {
    assert.equal(outer.object.kind, "indexed-access");
    assert.ok(outer.index.kind === "named" && outer.index.name === "number");
  }
  assert.ok(!parse('type Value = Shape["field";').ok);
});

test("re-export clauses preserve dependency spans without introducing local imports", () => {
  const text =
    'export type {Shape as S} from "types"; export {value as default, type Item} from "values"; export * from "all"; export type * from "types"; export {local};';
  const result = parse(text);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.imports.length, 4);
  assert.deepEqual(
    rewriteModule(result.value, {}).imports,
    result.value.imports,
  );
  for (const source of result.value.imports) {
    assert.deepEqual(source.bindings, []);
    assert.equal(
      text.slice(source.specifierSpan.start, source.specifierSpan.end),
      '"' + source.specifier + '"',
    );
  }
  const first = result.value.statements[0];
  assert.ok(first?.kind === "export");
  assert.deepEqual(first.declaration.bindings, [
    { local: "Shape", exported: "S", typeOnly: true, namespace: false },
  ]);
  assert.equal(result.value.imports[0]?.typeOnly, true);
  assert.equal(result.value.imports[1]?.typeOnly, false);
  for (const source of [
    "export *;",
    "function f():void{export {x};}",
    "export * as ns;",
  ])
    assert.ok(!parse(source).ok, source);
});

test("do-while accepts its special semicolon boundary and preserves loop scope", () => {
  for (const text of [
    "do{}while(false) const x=1;",
    "do;while(false);",
    "do{continue;}while(false);",
    "do do{}while(false);while(false);",
  ])
    assert.ok(parse(text).ok, text);
  for (const text of [
    "do{}",
    "do{}while;",
    "do const x=1;while(false);",
    "do{const f=()=>{continue;};}while(false);",
  ])
    assert.ok(!parse(text).ok, text);
});

test("instanceof parses as a relational operator with unary and equality precedence", () => {
  const source =
    "function check(value:unknown):boolean{return !(value instanceof TypeError)||value instanceof Error===false;}";
  const parsed = parse(source);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const operators: string[] = [];
  rewriteModule(parsed.value, {
    expression(node) {
      if (node.kind === "binary" || node.kind === "unary")
        operators.push(node.operator);
      return node;
    },
  });
  assert.deepEqual(operators, ["instanceof", "!", "instanceof", "===", "||"]);
  const chain = parse(
    "function f(a:unknown,b:unknown,c:unknown):boolean{return a instanceof b instanceof c;}",
  );
  assert.ok(chain.ok, JSON.stringify(chain));
  const fn = chain.value.statements[0];
  assert.ok(fn?.kind === "function");
  assert.ok(fn.body.kind === "block");
  const ret = fn.body.statements[0];
  assert.ok(ret?.kind === "return" && ret.expression?.kind === "binary");
  assert.equal(ret.expression.operator, "instanceof");
  assert.equal(ret.expression.left.kind, "binary");
});

test("a string token spelling instanceof is not an operator", () => {
  assert.equal(
    parse('function f(a:unknown,b:unknown):boolean{return a "instanceof" b;}')
      .ok,
    false,
  );
});

test("array loop bindings retain names, elisions and source spans", () => {
  const source =
    "function f(){for(const [key,,value,] of entries){use(key,value);}}";
  const parsed = parse(source);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const fn = parsed.value.statements[0];
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function" || fn.body.kind !== "block") return;
  const loop = fn.body.statements[0];
  assert.equal(loop?.kind, "for-of");
  if (loop?.kind !== "for-of") return;
  assert.ok("elements" in loop.binding);
  if (!("elements" in loop.binding)) return;
  assert.deepEqual(
    loop.binding.elements.map((e) =>
      e !== undefined &&
      e.kind !== "object-binding" &&
      e.kind !== "array-binding"
        ? e.name
        : undefined,
    ),
    ["key", undefined, "value"],
  );
  assert.equal(
    source.slice(loop.binding.start, loop.binding.end),
    "[key,,value,]",
  );
  assert.deepEqual(rewriteModule(parsed.value, {}), parsed.value);
});

test("unsupported loop pattern forms fail explicitly", () => {
  for (const pattern of ["[...rest,]", "[...rest=1]"]) {
    assert.equal(
      parse(`function f(){for(const ${pattern} of entries){}}`).ok,
      false,
      pattern,
    );
  }
});

test("in parses with relational precedence and requires an operator token", () => {
  const r = parse(
    'function f(a:unknown,b:unknown):boolean{return "key" in a===false||"other" in b;}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  const operators: string[] = [];
  rewriteModule(r.value, {
    expression(node) {
      if (node.kind === "binary") operators.push(node.operator);
      return node;
    },
  });
  assert.deepEqual(operators, ["in", "===", "in", "||"]);
  assert.equal(
    parse('function f(a:unknown,b:unknown){return a "in" b;}').ok,
    false,
  );
});

test("array binding patterns expose a discriminator", () => {
  const result = parse("for (const [key,value] of entries) {}");
  assert.ok(result.ok, JSON.stringify(result));
  const loop = result.value.statements[0];
  assert.equal(loop?.kind, "for-of");
  if (loop?.kind !== "for-of") return;
  assert.equal(Reflect.get(loop.binding, "kind"), "array-binding");
});

test("rewrites can skip statement children while still replacing the statement", () => {
  const parsed = parse(
    "function hidden<T>(x:T):T{return x;}function visible():number{return 7;}",
  );
  assert.ok(parsed.ok);
  const visited: string[] = [];
  const rewritten = rewriteModule(parsed.value, {
    descend: (node) => node.kind !== "function" || node.name !== "hidden",
    expression: (mapped, original) => {
      visited.push(original.kind);
      return mapped;
    },
    statement: (mapped, original) =>
      original.kind === "function" && original.name === "hidden"
        ? { kind: "empty", start: original.start, end: original.end }
        : mapped,
  });
  assert.deepEqual(visited, ["number"]);
  assert.equal(rewritten.statements[0]?.kind, "empty");
  assert.equal(parsed.value.statements[0]?.kind, "function");
});

test("rewriter hashes distinguish copied nodes while preserving source spans", () => {
  const parsed = parse("function f(x:number):number{return x+x;}");
  assert.ok(parsed.ok);
  const source = parsed.value;
  const original = source.statements[0]!;
  assert.equal(original.kind, "function");
  if (original.kind !== "function") return;
  const input = {
    ...source,
    statements: [original, { ...original, name: "g" }],
  };
  const output = rewriteModule(input, { hashes: true });
  const first = output.statements[0]!,
    second = output.statements[1]!;
  assert.equal(typeof first.nodeHash, "number");
  assert.notEqual(first.nodeHash, second.nodeHash);
  assert.equal(first.start, second.start);
  assert.equal(first.end, second.end);
  if (first.kind !== "function" || second.kind !== "function")
    throw Error("function invariant");
  assert.notEqual(
    first.parameters[0]!.nodeHash,
    second.parameters[0]!.nodeHash,
  );
  assert.notEqual(
    first.parameters[0]!.type!.nodeHash,
    second.parameters[0]!.type!.nodeHash,
  );
  assert.equal(original.nodeHash, undefined);
  assert.deepEqual(rewriteModule(input, {}), input);
});

test("satisfies has relational precedence and remains a typed expression", () => {
  const result = parse(
    "const x=1+2 satisfies number; const y=(x satisfies number)+1;",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const declaration = result.value.statements[0];
  assert.equal(declaration?.kind, "variable");
  if (declaration?.kind !== "variable") return;
  const expression = declaration.declarations[0]?.initializer;
  assert.equal(expression?.kind, "satisfies");
  if (expression?.kind !== "satisfies") return;
  assert.equal(expression.expression.kind, "binary");
  assert.equal(expression.type.kind, "named");
  assert.ok(!parse("x satisfies number = 2;").ok);
});

test("satisfies exposes both expression and constraint to immutable rewriting", () => {
  const source = parse("const x=1 satisfies number;");
  assert.ok(source.ok);
  let expressions = 0,
    types = 0;
  const result = rewriteModule(source.value, {
    expression(node) {
      if (node.kind === "number") {
        expressions++;
        return { ...node, value: 2 };
      }
      return node;
    },
    type(node) {
      if (node.kind === "named" && node.name === "number") {
        types++;
        return { ...node, name: "string" };
      }
      return node;
    },
  });
  assert.equal(expressions, 1);
  assert.equal(types, 1);
  assert.notDeepEqual(result, source.value);
  const bytes = new TextEncoder().encode("const x=1 satisfies number;");
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  assert.ok(!parseModule(text.value, "javascript").ok);
});

test("array literal elisions retain holes separately from trailing commas and undefined", () => {
  for (const [literal, kinds] of [
    ["[]", []],
    ["[,]", ["elision"]],
    ["[,,]", ["elision", "elision"]],
    ["[1,]", ["number"]],
    ["[,1,,undefined,]", ["elision", "number", "elision", "identifier"]],
    ["[...[1],,]", ["spread", "elision"]],
  ] as const) {
    const result = parse(`const a=${literal};`);
    assert.ok(result.ok, JSON.stringify(result));
    const statement = result.value.statements[0];
    assert.equal(statement?.kind, "variable");
    if (statement?.kind !== "variable") continue;
    const value = statement.declarations[0]?.initializer;
    assert.equal(value?.kind, "array");
    if (value?.kind !== "array") continue;
    assert.deepEqual(
      value.elements.map((element) => element.kind),
      kinds,
    );
    let holes = 0;
    rewriteModule(result.value, {
      expression(node) {
        if (node.kind === "elision") holes++;
        return node;
      },
    });
    assert.equal(holes, kinds.filter((kind) => kind === "elision").length);
  }
});

test("function type receiver annotations do not become positional parameters", () => {
  const parsed = parse(
    "type F=(this: Context, value:number)=>number; interface API { run(this: Context, value:number):number; }",
  );
  assert.ok(parsed.ok);
  const alias = parsed.value.statements[0],
    contract = parsed.value.statements[1];
  assert.equal(alias?.kind, "type-alias");
  if (alias?.kind !== "type-alias" || contract?.kind !== "interface")
    throw "missing type declarations";
  for (const fn of [alias.type, contract.properties[0]?.type]) {
    assert.equal(fn?.kind, "function");
    if (fn?.kind !== "function") throw "missing function type";
    assert.equal(fn.receiver?.kind, "named");
    assert.equal(fn.parameters.length, 1);
    const parameter = fn.parameters[0];
    assert.ok(
      parameter !== undefined && parameter.kind !== "pattern-parameter",
    );
    assert.equal(parameter.name, "value");
  }
});
test("receiver annotations must be first, typed and nonoptional", () => {
  for (const source of [
    "type F=(x:number,this:Context)=>number;",
    "type F=(this?:Context)=>number;",
    "type F=(this)=>number;",
    "type F=(this:Context=other)=>number;",
    "type F=(this:Context,this:Context)=>number;",
  ]) {
    assert.equal(parse(source).ok, false, source);
  }
});

test("function definitions keep this annotations separate and arrows reject them", () => {
  const result = parse(
    "function f(this:Context,x:number):number{return this.x+x;} const g=function(this:Context):number{return this.x;}; const o={m(this:Context):number{return this.x;}};",
  );
  assert.ok(result.ok);
  const fn = result.value.statements[0];
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function") throw "missing function";
  assert.equal(fn.receiver?.kind, "named");
  assert.equal(fn.parameters.length, 1);
  for (const source of [
    "const f=(this:Context)=>1;",
    "function f(x:number,this:Context){}",
    "function f(this?:Context){}",
    "function f(this:Context=other){}",
    "function f(this){}",
  ])
    assert.equal(parse(source).ok, false, source);
});

test("call and construct signature rewrites preserve nested annotations", () => {
  const parsed = parse(
    "interface F{(x:Old):Old;new(x:Old):Old;}type G={new(x:Old):Old;};type H=new(x:Old)=>Old;",
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  let visited = 0;
  const rewritten = rewriteModule(parsed.value, {
    type(node) {
      if (node.kind === "named" && node.name === "Old") {
        visited++;
        return { ...node, name: "New" };
      }
      return node;
    },
  });
  assert.equal(visited, 8);
  assert.equal(JSON.stringify(rewritten).includes('"Old"'), false);
  for (const source of [
    "type F={new(this:object):object;}",
    "type F=new(this:object)=>object;",
  ]) {
    assert.equal(parse(source).ok, false, source);
  }
  const overloaded = parse(
    "type F={new(x:number):number;new(x:string):string;}",
  );
  assert.ok(!overloaded.ok);
  assert.equal(overloaded.error.code, "UNSUPPORTED_SYNTAX");
});

test("labels distinguish iteration targets and respect function boundaries", () => {
  for (const source of [
    "outer: { break outer; }",
    'function f(){ return ":"; }',
    "a: b: while (true) { continue a; break b; }",
    "a: for (;;) { switch (1) { case 1: continue a; } }",
    "a: do { continue a; } while(false);",
    "a: { b: { break a; } } a: ;",
    "a: while(true) { break\na; }",
  ])
    assert.ok(parse(source).ok, source);
  for (const source of [
    "a: { continue a; }",
    "a: { a: ; }",
    "while(true) { break missing; }",
    "a: while(true) { function f(){ break a; } }",
    "a: while(true) { (()=>{continue a;})(); }",
    "a: while(true) { ({m(){break a;}}); }",
    "a: while(true) { class C { m(){break a;} } }",
    "a: while(true) { class C { static {break a;} } }",
    "a: let x=1;",
    "a: function f(){}",
  ])
    assert.equal(parse(source).ok, false, source);
});

test("sloppy labelled let expressions apply ASI without allowing let-array declarations", () => {
  for (const tail of ["{}", "x = 1;"]) {
    const bytes = new TextEncoder().encode("if(false){ L: let\n" + tail + " }");
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    assert.ok(parseScript(source.value).ok, tail);
  }
  const bytes = new TextEncoder().encode("if(false){ L: let\n[x] = 1; }");
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  assert.equal(parseScript(source.value).ok, false);
});

test("generic return types can directly precede arrow tokens", () => {
  for (const source of [
    "const f=(value:number):Box<number>=>({value});",
    "const f=():Box<Box<number>>=>value;",
    "const f=(value:Box<number>):Box<number>=>value;",
    "const f=():()=>Box<number>=>()=>value;",
  ]) {
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    const declaration = result.value.statements[0];
    assert.ok(declaration?.kind === "variable");
    const expression = declaration.declarations[0]?.initializer;
    assert.ok(expression?.kind === "arrow");
    assert.equal(expression.end, source.length - 1);
  }
  assert.equal(parse("const f=():Box<number>= >value;").ok, false);
});
