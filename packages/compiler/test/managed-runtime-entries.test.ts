import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import * as entries from "../src/native/managed-runtime-entries.ts";

test("runtime entry stubs bind only to final checked declarations", () => {
  const plan = entries.createRuntimeEntryStubs(["first", "second"], "$entry");
  assert.ok(plan.ok);
  assert.equal(plan.value.declarations.length, 4);
  assert.ok(
    plan.value.declarations.every((node) => node.start === 0 && node.end === 0),
  );
  const parsed = parseModule(
    createSourceTextView(
      "function first():number{return 19;}function second():number{return 23;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule({
    ...parsed.value,
    statements: [...parsed.value.statements, ...plan.value.declarations],
  });
  assert.ok(checked.ok);
  const resolved = entries.resolveRuntimeEntryBindings(
    checked.value,
    plan.value,
  );
  assert.ok(resolved.ok);
  assert.deepEqual(
    resolved.value.map((binding) => [binding.target, binding.part]),
    [
      [0, "entry"],
      [0, "signature"],
      [1, "entry"],
      [1, "signature"],
    ],
  );
  const lowered = lowerModuleEntries(
    checked.value,
    [0, 1, 2, 3, 4, 5],
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    { functionAddressBindings: resolved.value },
  );
  assert.ok(lowered.ok);
  assert.deepEqual(
    lowered.value.module.functions
      .slice(2)
      .map((fn) => fn.blocks[0]?.instructions[0]?.kind),
    Array(4).fill("function-address"),
  );
});

test("runtime entry plans reject duplicate targets, invalid names and collisions", () => {
  for (const [names, prefix] of [
    [["x", "x"], "$s"],
    [[""], "$s"],
    [["x"], "bad-prefix"],
    [["$s_entry_0"], "$s"],
  ] as const)
    assert.equal(entries.createRuntimeEntryStubs(names, prefix).ok, false);
  const plan = entries.createRuntimeEntryStubs(["missing"], "$s");
  assert.ok(plan.ok);
  const parsed = parseModule(
    createSourceTextView("function run():number{return 42;}"),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule({
    ...parsed.value,
    statements: [...parsed.value.statements, ...plan.value.declarations],
  });
  assert.ok(checked.ok);
  const result = entries.resolveRuntimeEntryBindings(checked.value, plan.value);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.match(result.error, /runtime entry target is missing: missing/);
});

test("runtime entry targets preserve linked internal names", () => {
  const result = entries.createRuntimeEntryStubs(["@6:value:10"], "$runtime");
  assert.ok(result.ok);
  assert.equal(result.value.entries[0]?.target, "@6:value:10");
});

test("runtime exports share signature getters by physical ABI without sharing entries", () => {
  const plan = entries.createRuntimeEntryStubs(
    ["first", "second", "third"],
    "$runtime",
    [
      { parameters: [], returnType: "number" },
      { parameters: [], returnType: "number" },
      { parameters: ["number"], returnType: "number" },
    ],
  );
  assert.ok(plan.ok);
  assert.equal(plan.value.declarations.length, 5);
  assert.equal(
    plan.value.entries[0]?.signature,
    plan.value.entries[1]?.signature,
  );
  assert.notEqual(plan.value.entries[0]?.entry, plan.value.entries[1]?.entry);
  assert.notEqual(
    plan.value.entries[0]?.signature,
    plan.value.entries[2]?.signature,
  );
  const parsed = parseModule(
    createSourceTextView(
      "function first():number{return 19;}function second():number{return 23;}function third(value:number):number{return value;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule({
    ...parsed.value,
    statements: [...parsed.value.statements, ...plan.value.declarations],
  });
  assert.ok(checked.ok);
  const resolved = entries.resolveRuntimeEntryBindings(
    checked.value,
    plan.value,
  );
  assert.ok(resolved.ok);
  assert.equal(resolved.value.length, 5);
  assert.equal(
    resolved.value.filter((binding) => binding.part === "entry").length,
    3,
  );
  assert.equal(
    resolved.value.filter((binding) => binding.part === "signature").length,
    2,
  );
  assert.equal(
    entries.createRuntimeEntryStubs(["first"], "$runtime", []).ok,
    false,
  );
});

test("host capability exclusion uses checked identities, never native index equality", async () => {
  const runtime = await import("../src/native/managed-runtime-entries.ts");
  assert.equal(typeof runtime.rejectHostRuntimeEntries, "function");
  const entries = [91, 7, 13];
  const bindings = [{ function: 33, target: 7 }];
  assert.deepEqual(
    runtime.rejectHostRuntimeEntries(bindings, entries, [{ function: 1 }]),
    { ok: false, error: "runtime entry targets a host operation" },
  );
  assert.deepEqual(
    runtime.rejectHostRuntimeEntries(bindings, entries, [{ function: 0 }]),
    { ok: true },
  );
  assert.deepEqual(
    runtime.rejectHostRuntimeEntries(bindings, entries, [{ function: 7 }]),
    { ok: false, error: "host target checked identity missing" },
  );
  assert.deepEqual(
    runtime.rejectHostRuntimeEntries([], entries, [{ function: 7 }]),
    { ok: true },
  );
});
