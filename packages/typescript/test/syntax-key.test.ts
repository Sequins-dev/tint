import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  parseScript,
  syntaxKey,
  syntaxKeyHash,
  syntaxKeyMatches,
  type Module,
} from "@tint/typescript/syntax";

// Kinds are discriminants, not free scalars; kind pairs are tested directly.
const excluded = new Set(["start", "end", "nodeHash", "kind"]);
type Mutable = Record<string, unknown>;
/** Visit every scalar field of every syntax object, in place. */
function scalars(
  root: unknown,
  visit: (owner: Mutable, field: string) => void,
): void {
  const seen = new Set<object>();
  function walk(value: unknown): void {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const owner = value as Mutable;
    for (const field of Object.keys(owner)) {
      const item = owner[field];
      if (typeof item === "object") walk(item);
      else if (
        !excluded.has(field) &&
        (typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean")
      )
        visit(owner, field);
    }
  }
  walk(root);
}
function mutated(value: unknown): unknown {
  if (typeof value === "string") return value + "\u0001";
  if (typeof value === "number") return Number.isNaN(value) ? 0 : value + 1;
  return !value;
}
function assertComplete(module: Module, limit: number): number {
  const base = syntaxKey(module),
    baseHash = syntaxKeyHash(module);
  assert.ok(syntaxKeyMatches(module, base));
  const sites: [Mutable, string][] = [];
  scalars(module, (owner, field) => sites.push([owner, field]));
  const stride = Math.max(1, Math.floor(sites.length / limit));
  let checked = 0;
  for (let index = 0; index < sites.length; index += stride) {
    const [owner, field] = sites[index]!;
    const original = owner[field];
    owner[field] = mutated(original);
    const changed = syntaxKey(module),
      matches = syntaxKeyMatches(module, base),
      changedHash = syntaxKeyHash(module);
    owner[field] = original;
    assert.equal(matches, false, "in-place match ignores " + field);
    void changedHash;
    assert.notEqual(
      changed,
      base,
      "syntax key ignores field " +
        field +
        " of " +
        String((owner as { kind?: unknown }).kind),
    );
    checked++;
  }
  assert.equal(syntaxKey(module), base);
  assert.equal(syntaxKeyHash(module), baseHash);
  assert.ok(syntaxKeyMatches(module, base));
  return checked;
}
function parsedModule(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed).slice(0, 300));
  return parsed.value;
}

test("syntax keys change with every semantic field of TypeScript modules", () => {
  let checked = 0;
  for (const file of [
    "../src/syntax/key.ts",
    "../src/checker/interfaces.ts",
    "../../ts-native/src/runtime/index.ts",
    "../../js-runtime/src/objects/jobs.ts",
  ]) {
    const module = parsedModule(
      readFileSync(new URL(file, import.meta.url), "utf8"),
    );
    checked += assertComplete(module, 3000);
  }
  assert.ok(checked > 1000, String(checked));
});

test("syntax keys change with every semantic field of JavaScript Scripts", () => {
  const sources = [
    'var a=[1,,...b],o={x:1,"y":2,[k]:3,get g(){return 1},set g(v){},m(){},...r,__proto__:null};label:for(let i=0;i<2;i++){if(i)continue label;else break;}',
    "class C extends (D) { static #p = 1; #q; static { this.z = 1; } get a(){return this.#q} async *g(x=1,...y){ yield* x; await y; } }",
    "function* f({a, b: [c, , d] = [], ...e}, g = 1n){ try { throw new.target } catch ({m}) { return typeof m } finally { debugger; } }",
    "`a${b}c${d}`; tag`x${y}`; x?.y?.[z]?.(w); a ??= b; c ||= d; e &&= f; g **= 2; --h; i++; !j; ~k; -l; void m; delete n.o;",
    "switch (x) { case 1: y = /re+/gi; break; default: z = x instanceof Y || 'k' in Z ? 1 : 2; } with (o) { p; } do { q } while (r)",
    "for (const [k, v] of m) {} for (var p in o) {} for (x of y) {} for (x.y in z) {} async () => { for await (const a of b) {} }",
  ];
  let checked = 0;
  for (const text of sources) {
    const parsed = parseScript(createSourceTextView(text));
    assert.ok(parsed.ok, text);
    checked += assertComplete(parsed.value, 5000);
  }
  assert.ok(checked > 200, String(checked));
});

test("syntax keys ignore only spans and per-traversal hashes", () => {
  const first = parsedModule(
      "export function f(a: number): number { return a + 1; }",
    ),
    second = parsedModule(
      "export function f(a: number): number { return a + 1; }",
    );
  assert.equal(syntaxKey(first), syntaxKey(second));
  scalars(second, (owner, field) => {
    void owner;
    void field;
  });
  // Moving every span leaves the key unchanged.
  const moved = structuredClone(second);
  const shift = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) shift(item);
      return;
    }
    const owner = value as Mutable;
    for (const field of Object.keys(owner)) {
      if (field === "start" || field === "end")
        owner[field] = (owner[field] as number) + 7;
      else if (field === "nodeHash") owner[field] = 99;
      else shift(owner[field]);
    }
  };
  shift(moved);
  assert.equal(syntaxKey(moved), syntaxKey(first));
  // Length prefixes prevent a string value from imitating structure.
  assert.notEqual(
    syntaxKey(parsedModule('const a = "1:b|S";')),
    syntaxKey(parsedModule('const a = "1";')),
  );
});

test("syntax keys distinguish every pair of interchangeable syntax kinds", () => {
  const pairs: [string, string][] = [
    ["while (a) b;", "do b; while (a)"],
    ["for (x in y) ;", "for (x of y) ;"],
    ["for (const x in y) ;", "for (const x of y) ;"],
    ["a = b;", "a += b;"],
    ["a.b;", "a?.b;"],
    ["a[b];", "a?.[b];"],
    ["a(b);", "a?.(b);"],
    ["(a, b);", "a, b;"],
    ["function f() { return; }", "function f() {}"],
    ["for (;;) { break; }", "for (;;) { continue; }"],
    ["debugger;", ";"],
    ["let a;", "var a;"],
    ["x = function () {};", "x = () => {};"],
    ["x = async function () {};", "x = function () {};"],
    ["x = function* () {};", "x = function () {};"],
    ["`a`;", "'a';"],
    ["a | b;", "a || b;"],
    ["++a;", "a++;"],
  ];
  for (const [left, right] of pairs) {
    const a = parseScript(createSourceTextView(left)),
      b = parseScript(createSourceTextView(right));
    assert.ok(a.ok && b.ok, left + " / " + right);
    assert.notEqual(
      syntaxKey(a.value),
      syntaxKey(b.value),
      left + " / " + right,
    );
  }
});

test("in-place key matching handles numbers, truncation and extension exactly", () => {
  const texts = [
    "x = 0; y = 7; z = 999999999; w = 1000000000;",
    "x = 9007199254740991; y = 1e21; z = 0.1; w = -0;",
    "x = 123456789012345; y = NaN; z = 5e-324;",
  ];
  for (const text of texts) {
    const parsed = parseScript(createSourceTextView(text));
    assert.ok(parsed.ok);
    const key = syntaxKey(parsed.value);
    assert.ok(syntaxKeyMatches(parsed.value, key), text);
    assert.equal(syntaxKeyMatches(parsed.value, key + "|u"), false);
    assert.equal(syntaxKeyMatches(parsed.value, key.slice(0, -1)), false);
    assert.equal(syntaxKeyMatches(parsed.value, ""), false);
  }
  const a = parseScript(createSourceTextView("x = 10;")),
    b = parseScript(createSourceTextView("x = 1;"));
  assert.ok(a.ok && b.ok);
  assert.equal(syntaxKeyMatches(b.value, syntaxKey(a.value)), false);
  assert.equal(syntaxKeyMatches(a.value, syntaxKey(b.value)), false);
  assert.notEqual(syntaxKeyHash(a.value), syntaxKeyHash(b.value));
});
test("the key encoder has a case for every syntax kind in the model", () => {
  // A kind without a case would be keyed by its tag alone, silently merging
  // nodes that differ only in that kind's fields.
  const model = readFileSync(
      new URL("../src/syntax/model.ts", import.meta.url),
      "utf8",
    ),
    encoder = readFileSync(
      new URL("../src/syntax/key.ts", import.meta.url),
      "utf8",
    );
  function section(text: string, start: string, end: RegExp): string {
    const from = text.indexOf(start);
    assert.ok(from >= 0, start);
    const rest = text.slice(from + start.length),
      stop = rest.search(end);
    return stop < 0 ? rest : rest.slice(0, stop);
  }
  function kinds(text: string): Set<string> {
    const found = new Set<string>();
    for (const match of text.matchAll(/kind: ((?:"[a-z-]+"\s*\|?\s*)+)/g))
      for (const name of (match[1] ?? "").matchAll(/"([a-z-]+)"/g))
        found.add(name[1] ?? "");
    return found;
  }
  function cases(text: string): Set<string> {
    const found = new Set<string>();
    for (const match of text.matchAll(/case "([a-z-]+)":/g))
      found.add(match[1] ?? "");
    return found;
  }
  for (const [union, encoderFunction] of [
    ["export type TypeNode =", "function type(node: TypeNode): void {"],
    [
      "export type Expression =",
      "function expression(node: Expression): void {",
    ],
    ["export type Statement =", "function statement(node: Statement): void {"],
  ] as const) {
    const declared = kinds(section(model, union, /\nexport /)),
      encoded = cases(section(encoder, encoderFunction, /\n  function /));
    assert.ok(declared.size > 5, union);
    const missing = [...declared].filter((kind) => !encoded.has(kind));
    assert.deepEqual(missing, [], union + " kinds without an encoder case");
  }
});

test("syntax keys of every token count match the streamed token encoding", () => {
  // Binary-counter joining merges runs at powers of two; cover many token
  // counts and one large Script entry against the in-place stream comparator.
  const script = (text: string): Module => {
    const parsed = parseScript(createSourceTextView(text));
    assert.ok(parsed.ok);
    return parsed.value;
  };
  const sources = [""];
  for (let count = 1; count <= 40; count++)
    sources.push(
      Array.from({ length: count }, (_, i) => `x${i} = 'v' + ${i};`).join(""),
    );
  let large = "({";
  for (let i = 0; i < 2000; i++) large += `['foo' + ${i}]: 'ok', `;
  sources.push(large + "['bar']: 'ok'});");
  let previous: string | undefined;
  for (const text of sources) {
    const module = script(text),
      key = syntaxKey(module);
    assert.ok(syntaxKeyMatches(module, key), text.slice(0, 40));
    assert.ok(!syntaxKeyMatches(module, key + "|"), text.slice(0, 40));
    if (previous !== undefined) assert.notEqual(key, previous);
    previous = key;
  }
});
