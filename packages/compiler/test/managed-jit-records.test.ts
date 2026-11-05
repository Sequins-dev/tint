import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { createFunctionBuilder, type RecordLayout } from "@tint/ir/scalar";
import type { LoweredManagedJitProgram } from "../src/native/managed-jit-program.ts";
import * as records from "../src/native/managed-jit-records.ts";
const layout: RecordLayout = {
  byteLength: 32,
  fields: [{ offset: 24, type: "number", mutable: true }],
};
function fixture(ambiguous = false, observed = false) {
  const parsed = parseModule(
    createSourceTextView(
      "interface A{readonly value:number;}interface B{value:number;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const a = checked.value.typeNames.get("A"),
    b = checked.value.typeNames.get("B");
  assert.ok(a !== undefined && b !== undefined);
  const aliases = new Map([
      ["$A", a],
      ["$B", b],
    ]),
    types: (number | undefined)[] = Array(checked.value.types.length).fill(
      undefined,
    );
  types[a] = 0;
  if (ambiguous) types[b] = 0;
  const fn = createFunctionBuilder(0, "test", [], "void");
  if (observed)
    fn.emit({
      start: 0,
      end: 0,
      kind: "record-descriptor-address",
      id: fn.next(),
      record: 0,
    });
  fn.end({ start: 0, end: 0, kind: "return", value: undefined });
  const lowered: LoweredManagedJitProgram = {
    module: { records: [layout], functions: [fn.finish()] },
    entry: 0,
    sources: [],
    entries: [],
    recordTypes: types,
    signatureTypes: undefined,
    functionMaps: [],
    recordMaps: [],
  };
  const directory = {
    name: "test",
    digest: "a".repeat(64),
    records: [
      { alias: "$A", aliases: [], layout },
      { alias: "$B", aliases: [], layout },
    ],
  };
  return {
    program: { checked: checked.value, aliasTypes: aliases },
    lowered,
    directory,
  };
}
test("managed record bindings use exact semantic classes despite identical layouts", () => {
  assert.equal(typeof records.bindManagedJitRecords, "function");
  const f = fixture();
  const result = records.bindManagedJitRecords(
    f.program,
    f.lowered,
    f.directory,
    ["$A"],
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0]?.witness, 0);
  assert.match(result.value[0]!.contract, /\/record\/0$/);
  const skew = {
    ...f.directory,
    records: f.directory.records.map((r) => ({
      ...r,
      layout: { ...r.layout, byteLength: 48 },
    })),
  };
  const rejected = records.bindManagedJitRecords(f.program, f.lowered, skew, [
    "$A",
  ]);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /record layout skew/);
});
test("ambiguous surface records are rejected even without explicit type tests", () => {
  assert.equal(typeof records.bindManagedJitRecords, "function");
  const f = fixture(true);
  const privateResult = records.bindManagedJitRecords(
    f.program,
    f.lowered,
    f.directory,
    [],
  );
  assert.equal(privateResult.ok, false);
  if (!privateResult.ok)
    assert.match(privateResult.error, /record serves several/);
  const observed = fixture(true, true);
  const rejected = records.bindManagedJitRecords(
    observed.program,
    observed.lowered,
    observed.directory,
    [],
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /record serves several/);
  assert.equal(
    records.bindManagedJitRecords(f.program, f.lowered, f.directory, ["$A"]).ok,
    false,
  );
});
test("record identities follow both pruning maps and reject missing mandatory aliases", () => {
  assert.equal(typeof records.bindManagedJitRecords, "function");
  const f = fixture();
  const original = f.lowered.recordTypes!.map((value) =>
    value === undefined ? undefined : 2,
  );
  const lowered = {
    ...f.lowered,
    recordTypes: original,
    recordMaps: [Uint32Array.of(0, 0, 2), Uint32Array.of(0, 1)],
  };
  const result = records.bindManagedJitRecords(
    f.program,
    lowered,
    f.directory,
    ["$A"],
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value[0]?.witness, 0);
  assert.equal(
    records.bindManagedJitRecords(f.program, f.lowered, f.directory, [
      "Missing",
    ]).ok,
    false,
  );
});

test("unbound records differing only in readonly contract are rejected", () => {
  const f = fixture(),
    a = f.program.aliasTypes.get("$A")!,
    b = f.program.aliasTypes.get("$B")!;
  const types: (number | undefined)[] = Array(
    f.program.checked.types.length,
  ).fill(undefined);
  types[b] = 0;
  const surface = { ...f.directory, records: [f.directory.records[0]!] };
  const rejected = records.bindManagedJitRecords(
    f.program,
    { ...f.lowered, recordTypes: types },
    surface,
    [],
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /surface mutability contract/);
  types[b] = undefined;
  types[a] = 0;
  assert.equal(
    records.bindManagedJitRecords(
      f.program,
      { ...f.lowered, recordTypes: types },
      surface,
      [],
    ).ok,
    true,
  );
});
