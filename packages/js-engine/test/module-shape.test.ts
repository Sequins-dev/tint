import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { sourceModuleShape } from "../src/lowering/module-shape.ts";
function shape(source: string) {
  const parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = sourceModuleShape(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("module requests deduplicate by specifier and attribute set in source order", () => {
  const result = shape(
    'import "./a"; export * from "./a"; import x from "./a" with {b:"2",a:"1"}; export * from "./a" with {a:"1",b:"2"};',
  );
  assert.deepEqual(result.requests, [
    { specifier: "./a", attributes: [] },
    {
      specifier: "./a",
      attributes: [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ],
    },
  ]);
  assert.deepEqual(result.starExports, [0, 1]);
  assert.equal(result.imports[0]?.request, 1);
});
test("module imports distinguish namespace imports from a named star string", () => {
  const result = shape(
    'import d, * as ns from "m"; import {"*" as star} from "m";',
  );
  assert.deepEqual(result.imports, [
    { request: 0, importName: "default", localName: "d" },
    { request: 0, importName: undefined, localName: "ns" },
    { request: 0, importName: "*", localName: "star" },
  ]);
});
test("local exports collect destructured names and each default declaration form", () => {
  assert.deepEqual(
    shape("export let {a,b:[c]}=x; export function f(){} export class C{}")
      .localExports,
    [
      { exportName: "a", localName: "a" },
      { exportName: "c", localName: "c" },
      { exportName: "f", localName: "f" },
      { exportName: "C", localName: "C" },
    ],
  );
  for (const [source, name] of [
    ["export default function f(){}", "f"],
    ["export default class C{}", "C"],
    ["export default function(){}", "*default*"],
    ["export default class{}", "*default*"],
    ["export default (function(){})", "*default*"],
    ["export default 42", "*default*"],
  ] as const)
    assert.deepEqual(shape(source).localExports, [
      { exportName: "default", localName: name },
    ]);
});
test("re-exported imports including namespaces normalize to indirect exports", () => {
  const named = shape('import {a as x} from "m"; export {x as y};');
  assert.deepEqual(named.localExports, []);
  assert.deepEqual(named.indirectExports, [
    { exportName: "y", request: 0, importName: "a" },
  ]);
  const namespace = shape('import * as ns from "m"; export {ns};');
  const direct = shape('export * as ns from "m";');
  assert.deepEqual(namespace.localExports, []);
  assert.deepEqual(namespace.indirectExports, direct.indirectExports);
  assert.deepEqual(direct.indirectExports, [
    { exportName: "ns", request: 0, importName: undefined },
  ]);
});
test("export string names and attribute order preserve exact UTF-16 values", () => {
  const result = shape(
    'let x; export {x as "", x as "π",x as "*default*"}; import "m" with {"𐀀":"astral","\uE000":"bmp"};',
  );
  assert.deepEqual(
    result.localExports.map((entry) => entry.exportName),
    ["", "π", "*default*"],
  );
  assert.deepEqual(
    result.requests[0]?.attributes.map((attribute) => attribute.key),
    ["𐀀", "\uE000"],
  );
});
test("eager and deferred namespace re-exports retain different requests for the same resource", () => {
  const result = shape(
    'import * as eager from "m"; import defer * as deferred from "m"; export {eager,deferred};',
  );
  assert.deepEqual(result.requests, [
    { specifier: "m", attributes: [] },
    { specifier: "m", attributes: [], phase: "defer" },
  ]);
  assert.deepEqual(
    result.indirectExports.map((entry) => entry.request),
    [0, 1],
  );
});

test("source-phase bindings and their re-exports retain a distinct request", () => {
  const result = shape(
    'import "m"; import source value from "m"; export {value};',
  );
  assert.deepEqual(result.requests, [
    { specifier: "m", attributes: [] },
    { specifier: "m", attributes: [], phase: "source" },
  ]);
  assert.equal(result.imports[0]?.request, 1);
  assert.equal(result.indirectExports[0]?.request, 1);
});

test("deferred namespace imports retain phase through an indirect re-export", () => {
  const result = shape('import defer * as ns from "m"; export {ns};');
  assert.deepEqual(result.requests, [
    { specifier: "m", attributes: [], phase: "defer" },
  ]);
  assert.deepEqual(result.indirectExports, [
    { exportName: "ns", request: 0, importName: undefined },
  ]);
});
