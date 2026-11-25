import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  parseScript,
  rewriteModule,
} from "@tint/typescript/syntax";
import { lowerScript, lowerSourceTextModule } from "../src/lowering/index.ts";
import { createLoweredRealm } from "./lowered-node-host.ts";

/** Calls of name in the lowered Script, and how many of the identifier
 * operations received a cache identifier rather than undefined. */
function lowered(source: string): { caches: number; cachedSites: number } {
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = lowerScript(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  let caches = 0,
    cachedSites = 0;
  rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier") {
        const name = node.callee.name;
        if (name === "createGlobalIdentifierCache") caches++;
        if (name === "getIdentifierValue" || name === "resolveBinding") {
          const last = node.arguments[node.arguments.length - 1];
          if (
            (last?.kind === "identifier" && last.name.startsWith("$gc")) ||
            (last?.kind === "member" &&
              last.object.kind === "identifier" &&
              last.object.name.startsWith("$gc"))
          )
            cachedSites++;
        }
      }
      return node;
    },
  });
  return { caches, cachedSites };
}

test("each Script var and unresolved identifier site gets a prologue cache", () => {
  // Sites: i<3, i++, s, i (in s+=i), and print.
  assert.deepEqual(lowered("var s=0;for(var i=0;i<3;i++)s+=i;print(s);"), {
    caches: 6,
    cachedSites: 6,
  });
});

test("declarative and Script lexical sites get no global cache", () => {
  // a is a parameter and t a Script let; only the callee f is a Script
  // function on the global object.
  assert.deepEqual(lowered("let t=1;function f(a){return a+t}f(t);"), {
    caches: 1,
    cachedSites: 1,
  });
});

test("nested functions cache each statically global site", () => {
  assert.deepEqual(lowered("var v=1;function g(){return v+v}g();"), {
    caches: 3,
    cachedSites: 3,
  });
});

test("many functions reading globals index the shared cache table", () => {
  const functions: string[] = [];
  for (let i = 0; i < 400; i++)
    functions.push(`function f${i}(){return g${i}+h${i}+k${i};}`);
  assert.deepEqual(lowered(functions.join("") + "f0();"), {
    caches: 1201,
    cachedSites: 1201,
  });
});

for (const [name, scripts, printed] of [
  [
    "top-level var loop updates the live cell",
    ["var s=0;for(var i=0;i<5;i++)s+=i;print(s);print(globalThis.s);"],
    ["10", "10"],
  ],
  [
    "a deleted global is unresolvable at a warm site",
    [
      "x=1;function r(){return x}print(r());print(r());delete globalThis.x;print(typeof x);try{r()}catch(e){print(e.name)}",
    ],
    ["1", "1", "undefined", "ReferenceError"],
  ],
  [
    "a global redefined as an accessor runs its getter",
    [
      "y=1;function r(){return y}r();Object.defineProperty(globalThis,'y',{get(){return 7},configurable:true});print(r())",
    ],
    ["7"],
  ],
  [
    "a global made non-writable rejects warm writes",
    [
      "z=1;function w(v){z=v}function ws(v){'use strict';z=v}w(2);ws(3);Object.defineProperty(globalThis,'z',{writable:false});w(4);print(z);try{ws(5)}catch(e){print(e.name)}print(z)",
    ],
    ["3", "TypeError", "3"],
  ],
  [
    "freezing the global object stops warm writes",
    ["var f=1;function w(){f++}w();Object.freeze(globalThis);w();print(f);"],
    ["2"],
  ],
  [
    "a later Script let shadows a cached global property",
    [
      "q=1;function rq(){return q}function wq(v){q=v}print(rq());wq(2);",
      "let q=10;print(rq());wq(3);print(q);print(globalThis.q);",
    ],
    ["1", "10", "3", "2"],
  ],
  [
    "direct eval var on an existing global keeps one cell",
    [
      "function r(){return e1}e1=1;print(r());eval('var e1=2');print(r());print(globalThis.e1)",
    ],
    ["1", "2", "2"],
  ],
  [
    "with scopes are consulted before the cached global",
    [
      "var v=1;var o={v:2};function r(){with(o){return v}}print(r());delete o.v;print(r());o.v=3;print(r())",
    ],
    ["2", "1", "3"],
  ],
  [
    "an own global added later shadows an inherited one",
    [
      "function r(){return typeof hasOwnProperty}print(r());globalThis.hasOwnProperty=1;print(r())",
    ],
    ["function", "number"],
  ],
  [
    "an exotic global prototype is not consulted for an own global",
    [
      "var p=1;function r(){return p}r();Object.setPrototypeOf(globalThis,new Proxy(Object.getPrototypeOf(globalThis),{has(t,k){print('has');return Reflect.has(t,k)}}));print(r());p=2;print(r())",
    ],
    ["1", "2"],
  ],
  [
    "strict compound assignment after delete is a ReferenceError",
    [
      "g=1;",
      "'use strict';function inc(){g+=1}inc();print(g);delete globalThis.g;try{inc()}catch(e){print(e.name)}",
    ],
    ["2", "ReferenceError"],
  ],
  [
    "a binding deleted by the right-hand side is revalidated before PutValue",
    [
      "h=1;function w(){h=(delete globalThis.h,2)}w();print(globalThis.h);",
      "'use strict';k=1;",
    ],
    ["2"],
  ],
  [
    "strict PutValue after the right-hand side deletes the binding throws",
    [
      "m=1;",
      "'use strict';function w(){m=(delete globalThis.m,2)}try{w()}catch(e){print(e.name)}print(typeof globalThis.m)",
    ],
    ["ReferenceError", "undefined"],
  ],
  [
    "indirect eval entries cache their global sites",
    [
      "(0,eval)('var k=0;for(var j=0;j<4;j++)k+=j;print(k)');print(k);(0,eval)('k=k+1');print(k)",
    ],
    ["6", "6", "7"],
  ],
] as const)
  test("global identifier cache semantics: " + name, () => {
    const realm = createLoweredRealm();
    for (const script of scripts) {
      const completion = realm.run(script);
      // The second script of the RHS-delete case assigns an undeclared name in
      // strict code on purpose.
      if (script === "'use strict';k=1;")
        assert.equal(completion, "ReferenceError");
      else assert.equal(completion, "none", script);
    }
    assert.deepEqual(realm.printed, printed);
  });

test("AOT entries declare caches inside the context arrow, not as captures", () => {
  // The context arrow captured every execute-level cache, one closure field
  // each, so Scripts with many top-level global sites outgrew the record
  // layout limit (Test262 relational-operator batches).
  const source = "var a=1;" + "a=a+1;".repeat(300);
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = lowerScript(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  const execute = result.value.statements.find(
    (statement) =>
      statement.kind === "function" && statement.name === "execute",
  );
  if (execute === undefined || execute.kind !== "function")
    throw Error("lowered Script has no execute function");
  const entryBody = execute.body;
  if (entryBody.kind !== "block") throw Error("execute has no block body");
  const outer = entryBody.statements.filter(
    (statement) =>
      statement.kind === "variable" &&
      statement.declarations.some(
        (declaration) =>
          declaration.kind !== "object-binding" &&
          declaration.kind !== "array-binding" &&
          declaration.name.startsWith("$gc"),
      ),
  );
  assert.equal(outer.length, 0);
  assert.equal(lowered(source).caches > 0, true);
});

test("ES modules without dynamic bindings pass $globalScope to cachedGlobalIdentifierCell", () => {
  const source = "export function f(x) { return Math.floor(x); }";
  const parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = lowerSourceTextModule(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  let globalScopeDecls = 0,
    cachedGlobalScopeCalls = 0;
  rewriteModule(result.value, {
    statement(node) {
      if (node.kind === "variable") {
        for (const decl of node.declarations) {
          if (
            decl.kind !== "object-binding" &&
            decl.kind !== "array-binding" &&
            decl.name === "$globalScope"
          )
            globalScopeDecls++;
        }
      }
      return node;
    },
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === "cachedGlobalIdentifierCell" &&
        node.arguments[0]?.kind === "identifier" &&
        node.arguments[0].name === "$globalScope"
      )
        cachedGlobalScopeCalls++;
      return node;
    },
  });
  assert.equal(globalScopeDecls, 1);
  assert.equal(cachedGlobalScopeCalls, 1);
});
