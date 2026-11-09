import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Module } from "@tint/typescript/syntax";
import {
  resolveInterfaceTypes,
  createInterfaceResolutionCache,
  checkClosureModule,
} from "../src/checker/index.ts";

function parse(source: string): Module {
  const bytes = new TextEncoder().encode(source);
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
// Shared type declarations, as every eval entry of one compiler shares the
// image surface; the code around them differs per entry.
const declarations = `
  interface Point { x: number; y: number; label: "a" | "b"; }
  type Pair = { first: Point; second: Point | undefined };
  type Tree = { value: number; children: readonly Tree[] };
  interface Box<T> { item: T; }
  type Boxes = Box<Point>;
  type Lookup = ReadonlyMap<string, Pair>;
`;
const entries = [
  `export function f(p: Point): number { return p.x + p.y; }`,
  `export function g(t: Tree, b: Box<number>): number { return t.value + b.item; }`,
  `export function h(pair: Pair, s: ReadonlySet<string>): boolean { return pair.second === undefined && s.size > 0; }`,
];

function fingerprint(
  module: Module,
  cache?: ReturnType<typeof createInterfaceResolutionCache>,
) {
  const annotations = module.statements.flatMap((statement) =>
    statement.kind === "function"
      ? [
          ...statement.parameters.flatMap((p) =>
            p.kind === "parameter" && p.type !== undefined ? [p.type] : [],
          ),
          ...(statement.returnType === undefined ? [] : [statement.returnType]),
        ]
      : [],
  );
  const resolved = resolveInterfaceTypes(module, annotations, cache);
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const names: [string, number][] = [];
  resolved.value.names.forEach((id, name) => names.push([name, id]));
  return {
    types: JSON.stringify(resolved.value.types),
    names: JSON.stringify(names.sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    annotations: annotations.map((node) =>
      resolved.value.annotations.get(node),
    ),
  };
}

test("declared-type resolution restored from a snapshot equals a cold resolution", () => {
  const cache = createInterfaceResolutionCache();
  for (const [index, entry] of entries.entries()) {
    const module = parse(declarations + entry);
    const cold = fingerprint(module);
    const cached = fingerprint(module, cache);
    assert.deepEqual(cached, cold, entry);
    // The first module records the snapshot; later ones restore it.
    assert.equal(cache.misses, 1);
    assert.equal(cache.hits, index);
  }
  // Repeating an entry restores again and still equals the cold result.
  const again = parse(declarations + entries[0]);
  assert.deepEqual(fingerprint(again, cache), fingerprint(again));
  assert.equal(cache.hits, entries.length);
});

test("changed type declarations or classes resolve afresh", () => {
  const cache = createInterfaceResolutionCache();
  fingerprint(parse(declarations + entries[0]), cache);
  assert.equal(cache.misses, 1);
  // One changed member type is a different declaration set.
  const changed = parse(
    declarations.replace("y: number", "y: string") + entries[0],
  );
  assert.deepEqual(fingerprint(changed, cache), fingerprint(changed));
  assert.equal(cache.hits, 0);
  assert.equal(cache.misses, 2);
  // Class contracts hold their definition nodes: never cached.
  const classes = parse(
    declarations + `export class C { x: number = 1; }` + entries[0],
  );
  const before = { hits: cache.hits, misses: cache.misses };
  assert.deepEqual(fingerprint(classes, cache), fingerprint(classes));
  assert.deepEqual({ hits: cache.hits, misses: cache.misses }, before);
});

test("the closure checker accepts the cache and checks identically", () => {
  const cache = createInterfaceResolutionCache();
  for (const entry of entries) {
    const module = parse(declarations + entry);
    const cold = checkClosureModule(module);
    const cached = checkClosureModule(module, { interfaceCache: cache });
    assert.ok(cold.ok && cached.ok, JSON.stringify([cold, cached]));
    assert.deepEqual(
      JSON.stringify(cached.value.types),
      JSON.stringify(cold.value.types),
    );
  }
  assert.equal(cache.misses, 1);
  assert.equal(cache.hits, entries.length - 1);
});
