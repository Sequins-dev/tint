import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, type Module } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
function parse(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
function surface() {
  const checked = checkClosureModule(
    parse(
      "interface Box{readonly value:number;}function read(box:Box):number{return box.value;}function add(a:number,b:number):number{return a+b;}",
    ),
  );
  assert.ok(checked.ok);
  const described = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [
      { name: "read", local: "read" },
      { name: "add", local: "add" },
    ],
    "$Surface",
    [{ name: "Box", local: "Box" }],
  );
  assert.ok(described.ok);
  return described.value;
}
test("managed entry adapts named value/type imports to a frame without recompiling helpers", () => {
  const module = parse(
    'import {add as sum,read,type Box} from "runtime";function other(sum:number):number{return sum;}export function execute(box:Box):number{return sum(read(box),other(23));}',
  );
  const before = JSON.stringify(module);
  const adapted = compiler.adaptManagedSurfaceEntry(
    module,
    "execute",
    "runtime",
    surface(),
  );
  assert.ok(adapted.ok, JSON.stringify(adapted));
  assert.equal(JSON.stringify(module), before);
  assert.equal(adapted.value.module.imports.length, 0);
  const prepared = compiler.prepareNativeFunctionEntry(
    adapted.value.module,
    adapted.value.entry,
    { recordTypes: true, signatureTypes: true },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.value.fn.parameters.length, 1);
  const frame = adapted.value.frame;
  assert.ok(frame.kind === "named");
  assert.ok(
    prepared.value.recordTypes?.some((entry) => entry.name === frame.name),
  );
  assert.ok(
    prepared.value.module.functions.some((fn) =>
      fn.blocks.some((block) =>
        block.instructions.some(
          (instruction) => instruction.kind === "call-indirect",
        ),
      ),
    ),
  );
});
test("managed entry refuses unapproved imports and module initialization", () => {
  for (const text of [
    'import {add} from "foreign";export function execute():number{return add(1,2);}',
    'import {missing} from "runtime";export function execute():number{return missing();}',
    'import * as runtime from "runtime";export function execute():number{return runtime.add(1,2);}',
    'import "runtime";export function execute():number{return 42;}',
    "let state:number=0;export function execute():number{return state++;}",
    "export function execute(value:number=42):number{return value;}",
  ])
    assert.equal(
      compiler.adaptManagedSurfaceEntry(
        parse(text),
        "execute",
        "runtime",
        surface(),
      ).ok,
      false,
      text,
    );
});

test("service factory scopes module initialization inside each managed entry invocation", () => {
  const module = parse(
    'import {add} from "runtime";let state:number=add(1,2);function increment():number{return ++state;}export function factory():{readonly next:()=>number}{return {next:increment};}',
  );
  const adapted = compiler.adaptManagedSurfaceEntry(
    module,
    "factory",
    "runtime",
    surface(),
    undefined,
    "factory",
  );
  assert.ok(adapted.ok, JSON.stringify(adapted));
  assert.ok(
    adapted.value.module.statements.every((s) => s.kind !== "variable"),
  );
  const checked = checkClosureModule(adapted.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const prepared = compiler.prepareNativeFunctionEntry(
    adapted.value.module,
    adapted.value.entry,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
});

test("managed entry resolves ordinary type imports across approved surface specifiers", () => {
  const module = parse(
    'import {add as sum} from "values";import {read} from "objects";import {Box} from "types";export function execute(box:Box):number{return sum(read(box),23);}',
  );
  const result = compiler.adaptManagedSurfaceEntry(
    module,
    "execute",
    ["values", "objects", "types"],
    surface(),
  );
  assert.ok(result.ok, JSON.stringify(result));
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  assert.equal(result.value.module.imports.length, 0);
  const outside = compiler.adaptManagedSurfaceEntry(
    module,
    "execute",
    ["values", "objects"],
    surface(),
  );
  assert.equal(outside.ok, false);
  const wrongKind = compiler.adaptManagedSurfaceEntry(
    parse(
      'import type {add} from "runtime";export function execute():number{return 42;}',
    ),
    "execute",
    "runtime",
    surface(),
  );
  assert.equal(wrongKind.ok, false);
});

test("managed entry uses an exported host frame and checks its unknown table before helpers", () => {
  const checked = checkClosureModule(
    parse(
      "interface Frame{readonly $imports:unknown;readonly $argument0:number;}function add(a:number,b:number):number{return a+b;}",
    ),
  );
  assert.ok(checked.ok);
  const described = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "add", local: "add" }],
    "$Surface",
    [{ name: "Frame", local: "Frame" }],
  );
  assert.ok(described.ok);
  const adapted = compiler.adaptManagedSurfaceEntry(
    parse(
      'import {add} from "runtime";export function execute(x:number):number{return add(x,2);}',
    ),
    "execute",
    "runtime",
    described.value,
    { frame: "Frame" },
  );
  assert.ok(adapted.ok, JSON.stringify(adapted));
  assert.ok(adapted.value.view);
  const wrapper = adapted.value.module.statements.find(
    (s) => s.kind === "function" && s.name === adapted.value.entry,
  );
  assert.ok(wrapper?.kind === "function");
  assert.deepEqual(wrapper.returnType, {
    start: 0,
    end: 0,
    kind: "named",
    name: "unknown",
  });
  assert.equal(wrapper.body.kind, "block");
  assert.ok(wrapper.body.kind === "block");
  assert.equal(wrapper.body.statements[0]?.kind, "variable");
  assert.equal(wrapper.body.statements[1]?.kind, "if");
  assert.deepEqual(adapted.value.frame, described.value.types[0]?.type);
  const result = checkClosureModule(adapted.value.module);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    adapted.value.module.statements
      .filter((s) => s.kind === "type-alias")
      .every((s) => s.exported),
  );
});

test("managed host frame rejects missing, mutable, extra and typed import fields", () => {
  for (const fields of [
    "readonly $imports:unknown;",
    "readonly $imports:unknown;$argument0:number;",
    "readonly $imports:unknown;readonly $argument0:number;readonly extra:number;",
    "readonly $imports:number;readonly $argument0:number;",
  ]) {
    const checked = checkClosureModule(parse(`interface Frame{${fields}}`));
    assert.ok(checked.ok);
    const described = compiler.reifyManagedSurfaceTypes(
      checked.value,
      [],
      "$Surface",
      [{ name: "Frame", local: "Frame" }],
    );
    assert.ok(described.ok);
    const result = compiler.adaptManagedSurfaceEntry(
      parse("export function execute(x:number):number{return x;}"),
      "execute",
      "runtime",
      described.value,
      { frame: "Frame" },
    );
    assert.equal(result.ok, false, fields);
  }
  const missing = compiler.adaptManagedSurfaceEntry(
    parse("export function execute():number{return 42;}"),
    "execute",
    "runtime",
    surface(),
    { frame: "Missing" },
  );
  assert.equal(missing.ok, false);
});
