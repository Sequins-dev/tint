import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
function surface(text: string, names: readonly string[]) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const result = compiler.reifyManagedSurfaceTypes(
    checked.value,
    names.map((name) => ({ name, local: name })),
    "$Source",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const canonical = compiler.canonicalizeManagedSurfaceTypes(result.value);
  assert.ok(canonical.ok, JSON.stringify(canonical));
  return canonical.value;
}
test("surface physical facts use ordinary lowering for recursive records, presence bits and default parameter ABI", () => {
  assert.equal(typeof compiler.deriveManagedSurfacePhysicalFacts, "function");
  const value = surface(
    "interface Link{readonly value:number;readonly next:Link|undefined;readonly label?:string;}function keep(value:Link):Link{return value;}function adjust(value:number=19):number{return value;}",
    ["keep", "adjust"],
  );
  const facts = compiler.deriveManagedSurfacePhysicalFacts(value, {
    modules: [],
    runtimes: [],
    globals: ["undefined"],
  });
  assert.ok(facts.ok, JSON.stringify(facts));
  assert.deepEqual(facts.value.runtimes, []);
  const keep = value.entries[0]!,
    adjust = value.entries[1]!;
  assert.ok(keep.type.kind === "named" && adjust.type.kind === "named");
  const keepAlias = keep.type.name,
    adjustAlias = adjust.type.name;
  assert.deepEqual(
    facts.value.signatures.find((entry) => entry.alias === keepAlias)
      ?.parameters,
    ["reference"],
  );
  assert.deepEqual(
    facts.value.signatures.find((entry) => entry.alias === adjustAlias)
      ?.parameters,
    ["optional-number"],
  );
  assert.ok(
    facts.value.records.some((entry) =>
      entry.layout.fields.some((field) => field.presenceOffset !== undefined),
    ),
  );
  assert.ok(
    facts.value.records.every((entry) =>
      entry.layout.fields.every((field) => field.stateOffset === undefined),
    ),
  );
});
test("surface layout preparation reports missing collection providers and invalid runtime namespaces", () => {
  assert.equal(typeof compiler.deriveManagedSurfacePhysicalFacts, "function");
  const value = surface(
    "function list(values:unknown[]):unknown[]{return values;}",
    ["list"],
  );
  const missing = compiler.deriveManagedSurfacePhysicalFacts(value, {
    modules: [],
    runtimes: [],
    globals: ["undefined"],
  });
  assert.equal(missing.ok, false);
  if (!missing.ok)
    assert.match(missing.error, /runtime helper|representation|layout/);
  const invalid = compiler.deriveManagedSurfacePhysicalFacts(value, {
    modules: [],
    runtimes: [{ module: "missing", namespace: "bad:namespace" }],
    globals: ["undefined"],
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /namespace/);
});
