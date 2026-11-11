import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSourceGraphCache,
  loadSourceGraph,
} from "../src/modules/index.ts";
const input = (id: string, packageId: string, text: string) => ({
  id,
  packageId,
  bytes: new TextEncoder().encode(text),
});
test("loads reachable runtime and type imports with deterministic module identities", () => {
  const sources = [
    input(
      "app/main.ts",
      "app",
      'import {value} from "@lib/core";import type {Item} from "./types.ts";export function run():number{return value();}',
    ),
    input("lib/index.ts", "lib", "export function value():number{return 42;}"),
    input("app/types.ts", "app", "export interface Item {value:number}"),
    input("unused.ts", "unused", "this is not parsed"),
  ];
  const mappings = [
    { packageId: "app", specifier: "@lib/core", target: "lib/index.ts" },
  ];
  const loaded = loadSourceGraph(sources, mappings, ["app/main.ts"]);
  assert.ok(loaded.ok, JSON.stringify(loaded));
  assert.deepEqual(
    loaded.value.map((m) => m.id),
    ["app/main.ts", "lib/index.ts", "app/types.ts"],
  );
  assert.equal(loaded.value[0]?.dependencies.get("@lib/core"), "lib/index.ts");
  const reordered = loadSourceGraph([...sources].reverse(), mappings, [
    "app/main.ts",
  ]);
  assert.ok(reordered.ok);
  const structure = (modules: typeof loaded.value) =>
    modules.map(({ sourcePosition, ...module }) => ({
      ...module,
      position: sourcePosition?.(0),
    }));
  assert.deepEqual(structure(reordered.value), structure(loaded.value));
});
test("loading reports decoding, catalog, parsing and import failures", () => {
  const invalid = loadSourceGraph(
    [{ id: "a.ts", packageId: "a", bytes: new Uint8Array([255]) }],
    [],
    ["a.ts"],
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error.stage, "decode");
    assert.equal(invalid.error.offsetKind, "byte");
  }
  const duplicate = loadSourceGraph(
    [input("a.ts", "a", ""), input("a.ts", "a", "")],
    [],
    ["a.ts"],
  );
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.stage, "catalog");
  for (const text of ['import "./missing.ts";', "export function {"])
    assert.equal(
      loadSourceGraph([input("a.ts", "a", text)], [], ["a.ts"]).ok,
      false,
    );
  assert.equal(loadSourceGraph([], [], ["missing.ts"]).ok, false);
});

test("loaded source positions preserve CRLF and UTF-16 columns", () => {
  const text = "// 😀\r\nexport function run():number{return 42;}";
  const result = loadSourceGraph(
    [input("main.ts", "main", text)],
    [],
    ["main.ts"],
  );
  assert.ok(result.ok);
  const positionAt = result.value[0]?.sourcePosition;
  assert.ok(positionAt);
  assert.deepEqual(positionAt(text.indexOf("export")), { line: 2, column: 1 });
  assert.deepEqual(positionAt(text.indexOf("return")), { line: 2, column: 30 });
  assert.equal(positionAt(-1), undefined);
});

test("source loading preserves structured RegExp capacity diagnostics", () => {
  const result = loadSourceGraph(
    [input("main.ts", "app", "const x=/a{9007199254740992}/;")],
    [],
    ["main.ts"],
  );
  assert.ok(!result.ok);
  assert.equal(result.error.stage, "parse");
  assert.equal(result.error.syntax?.code, "LIMIT");
  assert.equal(result.error.syntax?.feature, "regexp-literals");
  assert.equal(
    result.error.syntax?.message,
    "quantifier exceeds exact integer capacity",
  );
});
test("a source graph cache reuses decoded and parsed inputs only for the same input objects", () => {
  const inputs = [
      input("app/main.ts", "app", 'import {f} from "./lib.ts";f();'),
      input("app/lib.ts", "app", "export function f(){}"),
    ],
    cache = createSourceGraphCache();
  const first = loadSourceGraph(inputs, [], ["app/main.ts"], cache);
  assert.ok(first.ok);
  assert.equal(cache.sources.size, 2);
  assert.equal(cache.modules.size, 2);
  // A narrower root reuses the parse of the shared module.
  const second = loadSourceGraph(inputs, [], ["app/lib.ts"], cache);
  assert.ok(second.ok);
  assert.equal(second.value[0]?.module, first.value[1]?.module);
  assert.deepEqual(
    second.value.map((module) => module.id),
    ["app/lib.ts"],
  );
  // Equal bytes in different input objects are decoded and parsed again.
  const copies = inputs.map((item) => ({ ...item }));
  const third = loadSourceGraph(copies, [], ["app/main.ts"], cache);
  assert.ok(third.ok);
  assert.notEqual(third.value[0]?.module, first.value[0]?.module);
  assert.deepEqual(
    third.value.map((module) => [module.id, [...module.dependencies]]),
    first.value.map((module) => [module.id, [...module.dependencies]]),
  );
  // Without a cache the result is the same graph.
  const uncached = loadSourceGraph(inputs, [], ["app/main.ts"]);
  assert.ok(uncached.ok);
  assert.deepEqual(
    uncached.value.map((module) => module.id),
    first.value.map((module) => module.id),
  );
});
