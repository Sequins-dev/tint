import assert from "node:assert/strict";
import test from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Span } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import {
  createModuleExportMetadata,
  describeModuleExportDeclaration,
  describeModuleExports,
  type ModuleExportNames,
} from "@tint/typescript/modules/exports";

function fail(module: string, node: Span, message: string): never {
  throw { module, start: node.start, end: node.end, message };
}
function input(text: string, globals: readonly string[] = []) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value, globals);
  assert.ok(bound.ok, JSON.stringify(bound));
  const names: ModuleExportNames = {
    values: new Map(
      bound.value.bindings.map((binding) => [binding.name, "v/" + binding.id]),
    ),
    types: new Map(
      parsed.value.statements.flatMap((statement) =>
        statement.kind === "interface" || statement.kind === "type-alias"
          ? [[statement.name, "t/" + statement.name]]
          : [],
      ),
    ),
  };
  return {
    source: {
      id: "module",
      module: parsed.value,
      dependencies: new Map<string, string>(),
    },
    bound: bound.value,
    names,
  };
}

test("shared metadata uses real bound top-level declarations and caller identities", () => {
  const data = input(
    'import {remote} from "dep";const hidden=0;export const first=1,second=2;export interface Shape {value:number} export type Alias=number;export function read():number {const local=3;return first+local;}export class Box {}',
  );
  const metadata = describeModuleExports(
    data.source,
    data.bound,
    data.names,
    fail,
  );
  assert.equal(metadata.values.has("remote"), false);
  assert.equal(metadata.values.has("local"), false);
  assert.equal(metadata.values.has("hidden"), true);
  assert.deepEqual(
    metadata.exports.map((item) => [item.name, item.namespace]),
    [
      ["first", "value"],
      ["second", "value"],
      ["Shape", "type"],
      ["Alias", "type"],
      ["read", "value"],
      ["Box", "value"],
      ["Box", "type"],
    ],
  );
  assert.equal(metadata.types.get("Box"), metadata.values.get("Box"));
  for (const item of metadata.exports)
    assert.equal(
      item.identity,
      item.namespace === "type" && item.name !== "Box"
        ? data.names.types.get(item.name)
        : data.names.values.get(item.name),
    );
});

test("whole-module and per-declaration metadata have identical insertion order", () => {
  const data = input(
    "export const a=1;export class C {}export type T=number;export function f():number{return a;}",
  );
  const incremental = createModuleExportMetadata(
    data.source,
    data.bound,
    data.names,
    fail,
  );
  for (const statement of data.source.module.statements)
    describeModuleExportDeclaration(incremental, data.names, statement, fail);
  const complete = describeModuleExports(
    data.source,
    data.bound,
    data.names,
    fail,
  );
  assert.deepEqual(incremental, complete);
});

test("metadata does not impose native initializer, mutation or class policy", () => {
  const data = input("export let value=external();export class C {}throw 42;", [
    "external",
  ]);
  assert.deepEqual(
    describeModuleExports(
      data.source,
      data.bound,
      data.names,
      fail,
    ).exports.map((item) => item.name),
    ["value", "C", "C"],
  );
});

test("missing identity and duplicate type diagnostics retain declaration spans", () => {
  const data = input("export type A=number;export type A=string;");
  assert.throws(
    () => describeModuleExports(data.source, data.bound, data.names, fail),
    {
      module: "module",
      start: 21,
      end: 42,
      message: "duplicate module type: A",
    },
  );
  const fn = input("export function f():number{return 1;}");
  assert.throws(
    () =>
      describeModuleExports(
        fn.source,
        fn.bound,
        { values: new Map(), types: new Map() },
        fail,
      ),
    { message: "missing module value identity: f" },
  );
});

for (const text of [
  "export const {nested:{key:first},...rest}=external;",
  "export const [first,,...rest]=external;",
])
  test("binding patterns export their leaf identities: " + text, () => {
    const data = input(text, ["external"]);
    const metadata = describeModuleExports(
      data.source,
      data.bound,
      data.names,
      fail,
    );
    assert.deepEqual(
      metadata.exports,
      ["first", "rest"].map((name) => ({
        module: data.source.id,
        name,
        namespace: "value",
        identity: data.names.values.get(name),
      })),
    );
  });
