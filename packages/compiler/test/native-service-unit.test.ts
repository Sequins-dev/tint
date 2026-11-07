import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
function parse(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  return parsed.value;
}
function request() {
  const checked = checkClosureModule(
    parse(
      "interface Frame{readonly $imports:unknown;}interface Counter{readonly next:()=>number;}function seed():number{return 1;}",
    ),
  );
  assert.ok(checked.ok);
  const surface = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "seed", local: "seed" }],
    "$Service",
    [
      { name: "Frame", local: "Frame" },
      { name: "Counter", local: "Counter" },
    ],
  );
  assert.ok(surface.ok);
  const canonical = compiler.canonicalizeManagedSurfaceTypes(surface.value);
  assert.ok(canonical.ok);
  const runtime = { modules: [], runtimes: [], globals: ["undefined"] };
  const facts = compiler.deriveManagedSurfacePhysicalFacts(
    canonical.value,
    runtime,
  );
  assert.ok(facts.ok, JSON.stringify(facts));
  const directory = compiler.createManagedSurfaceDirectory(
    "counter",
    canonical.value,
    facts.value,
    "Frame",
  );
  assert.ok(directory.ok, JSON.stringify(directory));
  const functions: unknown[] = Array.from(
    {
      length: canonical.value.entries.length + directory.value.witnesses.length,
    },
    () => () => 42,
  );
  const read = compiler.readManagedSurfaceDirectory(
    {
      directory: directory.value.directory,
      table: undefined,
      functions,
      records: Float64Array.from(
        directory.value.directory.records,
        (_, i) => 0x100000 + i * 1024,
      ),
      entries: new Float64Array(),
    },
    "counter",
    {
      domain: () => 17,
      descriptor: () => 0x200000,
      signature: (fn) => 0x300000 + functions.indexOf(fn) * 128,
    },
  );
  assert.ok(read.ok, JSON.stringify(read));
  return {
    module: parse(
      'import {seed,type Counter} from "host";let count:number=seed();function next():number{return ++count;}export function factory():Counter{return {next};}',
    ),
    entry: "factory",
    specifiers: new Set(["host"]),
    instantiations: new Map(),
    read: read.value,
    runtime,
  };
}
test("native service compilation emits a managed factory with explicit module initialization", () => {
  assert.equal(typeof compiler.compileNativeServiceUnit, "function");
  const input = request(),
    before = JSON.stringify(input.module),
    result = compiler.compileNativeServiceUnit(input);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.version, 1);
  assert.equal(result.value.profile, "managed-factory-v1");
  assert.equal(result.value.native.linkage, "unresolved-managed");
  assert.ok(result.value.native.managedReferences?.length);
  assert.equal(JSON.stringify(input.module), before);
  assert.equal(compiler.prepareManagedSurfaceEntry(input).ok, false);
});
test("native service compilation diagnoses unsupported classes and async factories", () => {
  assert.equal(typeof compiler.compileNativeServiceUnit, "function");
  const input = request();
  for (const text of [
    "class Hidden{}export function factory():number{return 42;}",
    "export async function factory():Promise<number>{return 42;}",
  ]) {
    const result = compiler.compileNativeServiceUnit({
      ...input,
      module: parse(text),
    });
    assert.equal(result.ok, false);
  }
});

test("native service emission records the target collector allocation policy", () => {
  const input = request(),
    compiled = compiler.compileNativeServiceUnit({
      ...input,
      linearAllocation: true,
      generationalBarriers: true,
    });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.equal(compiled.value.native.linearAllocation, true);
  assert.equal(compiled.value.native.generationalBarriers, true);
});
