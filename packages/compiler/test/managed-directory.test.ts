import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
import { createManagedSurfacePhysicalDeriver } from "../src/native/managed-directory.ts";
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
test("shared runtime links preserve independent surface layouts with type-only dependencies", () => {
  const first = surface(
    "interface Cell{readonly value:number;}function keep(value:Cell):Cell{return value;}",
    ["keep"],
  );
  const second = surface(
    "interface Cell{readonly value:string;readonly present?:boolean;}function keep(value:Cell):Cell{return value;}",
    ["keep"],
  );
  const types = parseModule(createSourceTextView("export type Weight=number;"));
  const provider = parseModule(
    createSourceTextView(
      'import type {Weight} from "types";export function weight(n:Weight):Weight{return n;}',
    ),
  );
  assert.ok(types.ok && provider.ok);
  const runtime = {
    modules: [
      {
        id: "types",
        module: types.value,
        dependencies: new Map<string, string>(),
      },
      {
        id: "provider",
        module: provider.value,
        dependencies: new Map([["types", "types"]]),
      },
    ],
    runtimes: [{ module: "provider", namespace: "provider" }],
    globals: ["undefined"],
  };
  const derive = createManagedSurfacePhysicalDeriver(runtime);
  for (const value of [first, second, first]) {
    const direct = compiler.deriveManagedSurfacePhysicalFacts(value, runtime);
    assert.ok(direct.ok, JSON.stringify(direct));
    assert.deepEqual(derive(value), direct);
  }
});
