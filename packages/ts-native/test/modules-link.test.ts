import { checkClosureModule } from "@tint/typescript/checker";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import {
  linkModules,
  locateSource,
  specializeModule,
} from "@tint/ts-native/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
function input(
  id: string,
  text: string,
  imports: readonly [string, string][] = [],
): SourceModule {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(imports) };
}
test("module identities, aliases, local shadowing and source origins survive composition", () => {
  const dep = input(
    "dep",
    "const value=3; function helper(n:number):number{return n+value;} export function add(n:number):number{return helper(n);}",
  );
  const main = input(
    "main",
    'import {add as imported} from "dep"; function helper(imported:number):number{return imported+1;} export function run(n:number):number{return imported(helper(n));}',
    [["dep", "dep"]],
  );
  const r = linkModules([main, dep], "main", []);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.module.imports.length, 0);
  assert.equal(r.value.module.statements.length, 5);
  const bound = bindModule(r.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  const run = r.value.exports.find(
    (e) => e.module === "main" && e.name === "run",
  );
  assert.ok(run);
  const fn = r.value.module.statements.find(
    (s) => s.kind === "function" && s.name === run.linkedName,
  );
  assert.ok(fn);
  assert.equal(r.value.origins.get(fn)?.module, "main");
  assert.equal(locateSource(r.value, fn)?.module, "main");
  const dependency = r.value.module.statements.find(
    (s) => r.value.origins.get(s)?.module === "dep",
  );
  assert.ok(dependency);
  const origin = r.value.origins.get(dependency)!;
  assert.deepEqual(locateSource(r.value, dependency), {
    module: "dep",
    start: origin.node.start,
    end: origin.node.end,
  });
  assert.ok(dependency.start > main.module.end);
  assert.equal(main.module.statements[1]?.kind, "function");
  if (main.module.statements[1]?.kind === "function")
    assert.equal(main.module.statements[1].name, "helper");
  const identifiers = bound.value.bindings.map((b) => b.name);
  assert.equal(new Set(identifiers).size, identifiers.length);
});
test("type imports and generic parameter shadowing retain separate namespaces", () => {
  const dep = input(
    "dep",
    "export interface Value {readonly n:number} export type List<T>=readonly T[];",
  );
  const main = input(
    "main",
    'import type {Value as V,List} from "dep"; type Value<V>={readonly value:V}; export function run(v:V):List<V>{return [v];}',
    [["dep", "dep"]],
  );
  const r = linkModules([main, dep], "main", []);
  assert.ok(r.ok, JSON.stringify(r));
  const alias = r.value.module.statements.find(
    (s) => s.kind === "type-alias" && s.type.kind === "object",
  );
  assert.ok(alias?.kind === "type-alias" && alias.type.kind === "object");
  assert.deepEqual(
    alias.typeParameters?.map((p) => p.name),
    ["V"],
  );
  assert.equal(alias.type.properties[0]?.type.kind, "named");
  if (alias.type.properties[0]?.type.kind === "named")
    assert.equal(alias.type.properties[0].type.name, "V");
});
test("unresolved, missing, namespace and mutable import misuse fail explicitly", () => {
  const dep = input("dep", "export const value=1;");
  for (const text of [
    'import {missing} from "dep";',
    'import * as ns from "dep";',
    'import {value} from "dep"; value=2;',
  ]) {
    const r = linkModules(
      [input("main", text, [["dep", "dep"]]), dep],
      "main",
      [],
    );
    assert.equal(r.ok, false, text);
  }
  assert.equal(
    linkModules([input("main", 'import {value} from "dep";')], "main", []).ok,
    false,
  );
  assert.equal(
    linkModules(
      [input("main", "function init():number{return 1;} const n=init();")],
      "main",
      [],
    ).ok,
    false,
  );
});
test("cyclic declaration modules resolve exports before rewriting bodies", () => {
  const a = input(
    "a",
    'import {b} from "b"; export function a(n:number):number{if(n===0)return 0;return b(n-1);}',
    [["b", "b"]],
  );
  const b = input(
    "b",
    'import {a} from "a"; export function b(n:number):number{if(n===0)return 1;return a(n-1);}',
    [["a", "a"]],
  );
  const r = linkModules([a, b], "a", []);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(bindModule(r.value.module).ok);
  assert.equal(r.value.exports.length, 2);
});
test("constructor type arguments and argument references are rewritten independently", () => {
  const dep = input("dep", "export interface Item {readonly n:number}");
  const main = input(
    "main",
    'import type {Item} from "dep"; export function make(n:number):number{return new Box<Item>(n);}',
    [["dep", "dep"]],
  );
  const r = linkModules([main, dep], "main", ["Box"]);
  assert.ok(r.ok, JSON.stringify(r));
  const fn = r.value.module.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  const ret = fn.body.statements[0];
  assert.ok(ret?.kind === "return" && ret.expression?.kind === "new");
  assert.ok(ret.expression.typeArguments[0]?.kind === "named");
  assert.equal(
    ret.expression.typeArguments[0].name,
    r.value.exports.find((e) => e.module === "dep" && e.name === "Item")
      ?.linkedName,
  );
  const arg = ret.expression.arguments[0];
  assert.ok(arg?.kind === "identifier");
  const parameter = fn.parameters[0];
  assert.ok(parameter !== undefined && parameter.kind !== "pattern-parameter");
  assert.equal(arg.name, parameter.name);
});
test("for-of binding identities and origins survive module composition", () => {
  const source = input(
    "loop",
    "export function sum(a:Uint8Array):number{let n=0;for(const value of a){n+=value;}return n;}",
  );
  const result = linkModules([source], "loop", []);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(bindModule(result.value.module).ok);
  const fn = result.value.module.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  const loop = fn.body.statements[1];
  assert.ok(loop?.kind === "for-of");
  assert.ok("name" in loop.binding);
  assert.notEqual(loop.binding.name, "value");
  assert.equal(result.value.origins.get(loop.binding)?.module, "loop");
});

test("parameter default expressions retain imported binding identity and source origins", () => {
  const dep = input("dep", "export const value=7;");
  const main = input(
    "main",
    'import {value} from "dep";export function run(a:number=value):number{return a;}',
    [["dep", "dep"]],
  );
  const r = linkModules([main, dep], "main", []);
  assert.ok(r.ok, JSON.stringify(r));
  const bound = bindModule(r.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  const fn = r.value.module.statements.find((s) => s.kind === "function");
  assert.ok(fn?.kind === "function");
  const init = fn.parameters[0]?.initializer;
  assert.ok(init?.kind === "identifier");
  const value = r.value.exports.find(
    (e) => e.module === "dep" && e.name === "value",
  );
  assert.ok(value);
  assert.equal(init.name, value.linkedName);
  assert.ok(
    bound.value.references.some(
      (r) => r.node === init && r.binding !== undefined,
    ),
  );
});
test("linked numeric array constants retain one identity across imported aliases", () => {
  const dep = input("dep", "export const K:readonly number[]=[1,2+3];");
  const main = input(
    "main",
    'import {K as a} from "dep";import {K as b} from "dep";export function read():number{return (a[0]??0)+(b[1]??0);}',
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", ["undefined"]);
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module, ["undefined"]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const arrays = bound.value.bindings.filter((b) => b.kind === "const");
  assert.equal(arrays.length, 1);
  const refs = bound.value.references.filter(
    (r) => r.binding === arrays[0]?.id,
  );
  assert.equal(refs.length, 2);
  for (const text of [
    "export const K=[f()];function f():number{return 1;}",
    'export const K=["x"];',
    "export let K=[1];",
  ])
    assert.equal(linkModules([input("bad", text)], "bad", []).ok, false);
});
test("composition preserves optional properties in imported type contracts", () => {
  const dep = input(
    "dep",
    "export interface Options {readonly count?:number; required:number|undefined}",
  );
  const main = input(
    "main",
    'import type {Options} from "dep";export function read(options:Options):number{return options.count??0;}',
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", ["undefined"]);
  assert.ok(linked.ok, JSON.stringify(linked));
  const shape = linked.value.module.statements.find(
    (s) => s.kind === "interface",
  );
  assert.ok(shape?.kind === "interface");
  assert.equal(shape.properties[0]?.optional, true);
  assert.equal(shape.properties[1]?.optional, undefined);
});

test("linked generic functions preserve type parameter scopes and imported type arguments", () => {
  const dep = input(
    "dep",
    "export interface Box<T>{readonly value:T} export function box<T>(x:T):Box<T>{const y:T=x;return {value:y};}",
  );
  const main = input(
    "main",
    'import {box,type Box} from "dep";type T=number;export function run():Box<T>{return box<T>(7);}',
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  const specialized = specializeModule(linked.value.module, bound.value);
  assert.ok(specialized.ok, JSON.stringify(specialized));
  assert.equal(specialized.value.specializations.length, 1);
  const template = specialized.value.specializations[0]!.source;
  assert.equal(template.parameters[0]?.type?.kind, "named");
  const checked = checkClosureModule(specialized.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const rebound = bindModule(specialized.value.module);
  assert.ok(rebound.ok, JSON.stringify(rebound));
});

test("indexed access keeps imported type identities through linking and specialization", () => {
  const dep = input(
    "dep",
    `export interface Shape { value:number; label?:string }
    export type Key = "value";
    export function identity<T>(value:T):T{return value;}`,
  );
  const main = input(
    "main",
    `import { type Shape as S, type Key as K, identity } from "dep";
    interface Shape { value: boolean }
    export function run(value:S[K]):S["value"]{return identity<S[K]>(value);}`,
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  const specialized = specializeModule(linked.value.module, bound.value);
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const checked = checkClosureModule(specialized.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("named and star re-exports resolve aliases, shared diamonds and cycles", () => {
  const dep = input(
    "dep",
    "export interface Shape {value:number} export function value():number{return 7;}",
  );
  const left = input("left", 'export * from "dep";', [["dep", "dep"]]);
  const right = input("right", 'export * from "dep"; export * from "barrel";', [
    ["dep", "dep"],
    ["barrel", "barrel"],
  ]);
  const barrel = input(
    "barrel",
    'export * from "left";export * from "right";export type {Shape as Record} from "dep";export {value as get} from "dep";',
    [
      ["left", "left"],
      ["right", "right"],
      ["dep", "dep"],
    ],
  );
  const main = input(
    "main",
    'import {get,type Record} from "barrel";export function run():number{const x:Record={value:get()};return x.value;}',
    [["barrel", "barrel"]],
  );
  const result = linkModules([main, barrel, left, right, dep], "main", []);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(checkClosureModule(result.value.module).ok);
  const get = result.value.exports.find(
    (e) => e.module === "barrel" && e.name === "get",
  );
  const value = result.value.exports.find(
    (e) => e.module === "dep" && e.name === "value",
  );
  assert.equal(get?.linkedName, value?.linkedName);
});

test("local exports preserve imported identities and type-only star boundaries", () => {
  const dep = input(
    "dep",
    "export interface Shape {value:number} export function value():number{return 7;}",
  );
  const barrel = input(
    "barrel",
    'import {value as local} from "dep";export {local as get};export type * from "dep";',
    [["dep", "dep"]],
  );
  const result = linkModules([barrel, dep], "barrel", []);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    result.value.exports.some(
      (e) =>
        e.module === "barrel" && e.name === "get" && e.namespace === "value",
    ),
  );
  assert.ok(
    result.value.exports.some(
      (e) =>
        e.module === "barrel" && e.name === "Shape" && e.namespace === "type",
    ),
  );
  assert.ok(
    !result.value.exports.some(
      (e) => e.module === "barrel" && e.name === "value",
    ),
  );
});

test("conflicting stars are omitted, explicit exports win, and missing exports fail", () => {
  const a = input("a", "export function value():number{return 1;}");
  const b = input("b", "export function value():number{return 2;}");
  const barrel = input("barrel", 'export * from "a";export * from "b";', [
    ["a", "a"],
    ["b", "b"],
  ]);
  const r = linkModules([barrel, a, b], "barrel", []);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(
    !r.value.exports.some((e) => e.module === "barrel" && e.name === "value"),
  );
  const explicit = input(
    "barrel",
    'export * from "a";export * from "b";export {value} from "a";',
    [
      ["a", "a"],
      ["b", "b"],
    ],
  );
  assert.ok(linkModules([explicit, a, b], "barrel", []).ok);
  for (const text of [
    'export {missing} from "a";',
    "export {missing};",
    'export {value as same} from "a";export {value as same} from "b";',
  ])
    assert.ok(
      !linkModules(
        [
          input("barrel", text, [
            ["a", "a"],
            ["b", "b"],
          ]),
          a,
          b,
        ],
        "barrel",
        [],
      ).ok,
      text,
    );
  const main = input(
    "main",
    'import {value} from "barrel";export function run():number{return value();}',
    [["barrel", "barrel"]],
  );
  assert.ok(!linkModules([main, barrel, a, b], "main", []).ok);
});

test("stars exclude default exports and missing dependency or unproductive cycles fail", () => {
  const dep = input(
    "dep",
    "function value():number{return 1;} export {value as default};",
  );
  const barrel = input("barrel", 'export * from "dep";', [["dep", "dep"]]);
  const linked = linkModules([barrel, dep], "barrel", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  assert.ok(
    !linked.value.exports.some(
      (e) => e.module === "barrel" && e.name === "default",
    ),
  );
  const main = input(
    "main",
    'import value from "dep";export function run():number{return value();}',
    [["dep", "dep"]],
  );
  const direct = linkModules([main, dep], "main", []);
  assert.ok(direct.ok, JSON.stringify(direct));
  assert.ok(checkClosureModule(direct.value.module).ok);
  assert.ok(
    !linkModules([input("main", 'export * from "missing";')], "main", []).ok,
  );
  const a = input("a", 'export {value} from "b";', [["b", "b"]]);
  const b = input("b", 'export {value} from "a";', [["a", "a"]]);
  assert.ok(!linkModules([a, b], "a", []).ok);
});

test("instance linking orders runtime dependencies and excludes declaration-only type imports", () => {
  const dep = input(
    "dep",
    "let state=3;export function next():number{return ++state;}",
  );
  const types = input(
    "types",
    "export interface Value {x:number}let ignored=missing();function missing():number{return 1;}",
  );
  const main = input(
    "main",
    'import {next} from "dep";import type {Value} from "types";const initial=next();export function run():number{return initial+next();}',
    [
      ["dep", "dep"],
      ["types", "types"],
    ],
  );
  const result = linkModules([main, types, dep], "main", [], {
    evaluation: "instance",
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.evaluationOrder, ["dep", "main"]);
  assert.equal(
    result.value.module.statements.filter((s) => s.kind === "variable").length,
    2,
  );
  assert.ok(!linkModules([main, types, dep], "main", []).ok);
});

test("instance evaluation visits diamond dependencies once and retains inline-type side effects", () => {
  const log = input(
    "log",
    "export interface T {value:number}export function read():number{return 1;}",
  );
  const left = input("left", 'import {type T} from "log";', [["log", "log"]]);
  const right = input("right", 'export {type T} from "log";', [["log", "log"]]);
  const main = input(
    "main",
    'import "left";import "right";export function run():number{return 1;}',
    [
      ["left", "left"],
      ["right", "right"],
    ],
  );
  const result = linkModules([right, main, log, left], "main", [], {
    evaluation: "instance",
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.evaluationOrder, [
    "log",
    "left",
    "right",
    "main",
  ]);
});

test("instance evaluation handles cyclic back-edges in source dependency order", () => {
  const main = input(
    "main",
    'import {value} from "dep";export function base():number{return 7;}export function run():number{return value;}',
    [["dep", "dep"]],
  );
  const dep = input(
    "dep",
    'import {base} from "main";export const value=base();',
    [["main", "main"]],
  );
  const result = linkModules([main, dep], "main", [], {
    evaluation: "instance",
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.evaluationOrder, ["dep", "main"]);
});

test("source lookup uses logarithmic reads over ordered disjoint linked ranges", () => {
  const linked = linkModules(
    [input("main", "export function run():number{return 1;}")],
    "main",
    [],
  );
  assert.ok(linked.ok);
  const ranges = Array.from({ length: 1024 }, (_, index) => ({
    module: `m${index}`,
    start: index * 20,
    end: index * 20 + 10,
    offset: index * 20,
  }));
  let reads = 0;
  const watched = new Proxy(ranges, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const program = { ...linked.value, ranges: watched };
  assert.deepEqual(locateSource(program, { start: 20002, end: 20008 }), {
    module: "m1000",
    start: 2,
    end: 8,
  });
  assert.ok(reads <= 12, `source lookup read ${reads} ranges`);
  for (const span of [
    { start: 0, end: 0 },
    { start: 10, end: 10 },
    { start: 11, end: 11 },
    { start: 20, end: 30 },
    { start: 10, end: 20 },
    { start: -1, end: 0 },
    { start: 20, end: 19 },
    { start: NaN, end: 0 },
    { start: 0, end: NaN },
    { start: 20470, end: 20470 },
    { start: 20471, end: 20471 },
  ]) {
    const range = ranges.find(
      (r) =>
        span.start >= r.start && span.end >= span.start && span.end <= r.end,
    );
    assert.deepEqual(
      locateSource(program, span),
      range === undefined
        ? undefined
        : {
            module: range.module,
            start: span.start - range.offset,
            end: span.end - range.offset,
          },
    );
  }
  assert.equal(
    locateSource({ ...program, ranges: [] }, { start: 0, end: 0 }),
    undefined,
  );
});

test("satisfies constraints retain imported aliases and specialize type parameters", () => {
  const dep = input(
    "dep",
    "export interface Shape {readonly n:number} export function identity<T>(value:T):T{return value satisfies T;}",
  );
  const main = input(
    "main",
    'import {type Shape as S,identity} from "dep";interface Shape {n:string} export function run():number{const value={n:42} satisfies S;return identity<S>(value).n;}',
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  const specialized = specializeModule(linked.value.module, bound.value);
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const checked = checkClosureModule(specialized.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("linked signature types retain imported names and generic parameters", () => {
  const dep = input(
    "contracts",
    "export interface Value{x:number;}export interface Factory<T>{new(x:T):Value;(x:T):T;}",
  );
  const main = input(
    "consumer",
    'import type {Factory,Value} from "contracts";type Local={new(x:Value):Value;};interface LocalFactory extends Factory<number>{}',
    [["contracts", "contracts"]],
  );
  const linked = linkModules([main, dep], "consumer", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const checked = checkClosureModule(linked.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("unrelated module exports do not multiply resolution work", () => {
  const modules: SourceModule[] = [];
  for (let i = 0; i < 710; i++)
    modules.push(
      input(
        "independent" + i,
        "export function value" + i + "():number{return 1;}",
      ),
    );
  const dependencies: [string, string][] = [];
  let source = "";
  for (let i = 0; i < 710; i++) {
    const id = "independent" + i;
    dependencies.push([id, id]);
    source += "import {value" + i + '} from "' + id + '";';
  }
  modules.push(input("root", source, dependencies));
  const result = linkModules(modules, "root", []);
  assert.ok(result.ok, JSON.stringify(result));
});

test("a string-named star export links as a named binding rather than a namespace", () => {
  const dep = input("dep", 'const value:number=42;export {value as "*"};');
  const bridge = input("bridge", 'export {"*" as "x-y"} from "dep";', [
    ["dep", "dep"],
  ]);
  const main = input(
    "main",
    'import {"x-y" as value} from "bridge";export function run():number{return value;}',
    [["bridge", "bridge"]],
  );
  const result = linkModules([main, bridge, dep], "main", []);
  assert.ok(result.ok, JSON.stringify(result));
  const star = result.value.exports.find(
    (e) => e.module === "dep" && e.name === "*",
  );
  const alias = result.value.exports.find(
    (e) => e.module === "bridge" && e.name === "x-y",
  );
  assert.ok(star);
  assert.ok(alias);
  assert.equal(star.linkedName, alias.linkedName);
  assert.ok(checkClosureModule(result.value.module).ok);
});
test("namespace exports retain an explicit linker capability boundary", () => {
  const dep = input("dep", "export const value:number=42;");
  const main = input("main", 'export * as ns from "dep";', [["dep", "dep"]]);
  const result = linkModules([main, dep], "main", []);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /namespace exports/);
});

test("semantic export adapters retain exact native names and export ordering", () => {
  const main = input(
    "main",
    'export {value as get} from "dep";export type {Shape} from "dep";',
    [["dep", "dep"]],
  );
  const dep = input(
    "dep",
    "export interface Shape {value:number} export function value():number{return 7;}",
  );
  const result = linkModules([main, dep], "main", []);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.exports, [
    {
      module: "main",
      name: "get",
      namespace: "value",
      linkedName: "@1:value:0",
    },
    {
      module: "main",
      name: "Shape",
      namespace: "type",
      linkedName: "@1:type:Shape",
    },
    {
      module: "dep",
      name: "Shape",
      namespace: "type",
      linkedName: "@1:type:Shape",
    },
    {
      module: "dep",
      name: "value",
      namespace: "value",
      linkedName: "@1:value:0",
    },
  ]);
});

test("native policy and metadata retain competing-error order", () => {
  for (const [text, expected] of [
    [
      "class C {} type A=number;type A=string;",
      "module evaluation is required for class definitions",
    ],
    ["type A=number;type A=string;class C {}", "duplicate module type: A"],
    [
      "const value=external();type A=number;type A=string;",
      "module evaluation is required for this initializer",
    ],
    [
      "type A=number;type A=string;const value=external();",
      "duplicate module type: A",
    ],
    [
      "let value=1;type A=number;type A=string;",
      "module evaluation is required for mutable declarations",
    ],
  ]) {
    assert.ok(text !== undefined && expected !== undefined);
    const result = linkModules([input("main", text)], "main", ["external"]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.message, expected);
  }
});

test("linking rebases retained export source starts without changing declaration spans", () => {
  const dep = input("dep", "export function f(){return 1;}");
  const main = input(
    "main",
    'import {f} from "dep"; export function run(){return f();}',
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const original = dep.module.statements[0]!;
  assert.equal(original.kind, "function");
  if (original.kind !== "function") assert.fail("expected function");
  const statement = linked.value.module.statements.find(
    (candidate) => linked.value.origins.get(candidate)?.module === "dep",
  );
  assert.ok(statement && statement.kind === "function");
  const offset = statement.start - original.start;
  assert.ok(offset > 0);
  assert.equal(original.start, 0);
  assert.equal(original.sourceStart, "export ".length);
  assert.equal(statement.sourceStart, original.sourceStart! + offset);
  assert.deepEqual(locateSource(linked.value, statement), {
    module: "dep",
    start: original.start,
    end: original.end,
  });
});

test("linked copies receive fresh graph hashes when generated source hashes collide", () => {
  const dep = input("dep", "export function add(n:number):number{return n+1;}");
  const main = input(
    "main",
    'import {add} from "dep";export function run(n:number):number{return add(n);}',
    [["dep", "dep"]],
  );
  const sources = [main, dep].map((source) => ({
    ...source,
    module: rewriteModule(source.module, {
      statement: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
      expression: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
      type: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
    }),
  }));
  const before = JSON.stringify(sources);
  const linked = linkModules(sources, "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const hashes = new Set<number>();
  linked.value.origins.forEach((origin, node) => {
    assert.equal(typeof node.nodeHash, "number");
    const hash = node.nodeHash!;
    assert.ok(
      !hashes.has(hash),
      "distinct linked copies must not inherit one source hash",
    );
    hashes.add(hash);
    assert.ok(origin.module === "main" || origin.module === "dep");
  });
  assert.ok(hashes.size > 5);
  assert.equal(JSON.stringify(sources), before);
  const checked = checkClosureModule(linked.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("generic bounds and defaults link imports and preserve local parameter scope", () => {
  const main = input(
    "main",
    'import type {Base, T} from "dep"; ' +
      "export interface Box<T extends Base = Base, U extends T = T> { value: U } " +
      "type Outer = T;",
    [["dep", "dep"]],
  );
  const dep = input(
    "dep",
    "export interface Base { code: number } export type T = string;",
  );
  const linked = linkModules([main, dep], "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const box = linked.value.module.statements.find(
    (node) => node.kind === "interface" && node.typeParameters?.length === 2,
  );
  assert.ok(box?.kind === "interface");
  const [first, second] = box.typeParameters ?? [];
  const base = linked.value.exports.find(
    (entry) => entry.module === "dep" && entry.name === "Base",
  );
  assert.ok(base);
  assert.ok(
    first?.constraint?.kind === "named" && first.defaultType?.kind === "named",
  );
  assert.equal(first.constraint.name, base.linkedName);
  assert.equal(first.defaultType.name, base.linkedName);
  assert.ok(
    second?.constraint?.kind === "named" &&
      second.defaultType?.kind === "named",
  );
  assert.equal(second.constraint.name, "T");
  assert.equal(second.defaultType.name, "T");
  assert.equal(locateSource(linked.value, first.constraint)?.module, "main");
});
