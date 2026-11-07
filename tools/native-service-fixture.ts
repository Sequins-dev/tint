import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "@tint/compiler/native";
function parse(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  return parsed.value;
}
export function nativeServiceFixtureRequest(
  runtime: compiler.ManagedSurfaceLayoutRuntime = {
    modules: [],
    runtimes: [],
    globals: ["undefined"],
  },
) {
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
      entries: Float64Array.from(
        directory.value.directory.runtimes.flatMap((provider) =>
          provider.operations.flatMap((_, index) => [
            0x400004 + index * 4,
            0x500000 + index * 128,
          ]),
        ),
      ),
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
