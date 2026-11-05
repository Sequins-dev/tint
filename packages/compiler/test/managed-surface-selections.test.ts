import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import * as compiler from "../src/native/index.ts";

function fixture() {
  const parsed = parseModule(
    createSourceTextView(`export type Key=string;
export interface Box<T>{readonly value:T;}
let count=0;
export function identity<T>(value:T):T{count++;return value;}
export function read():number{return count;}
export function retain<T>(value:T):T{return value;}
function privateHelper():number{return 0;}
export const constant=42;
export function run():number{return identity<number>(19)+identity<number>(23);}`),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const linked = linkModules(
    [{ id: "helpers", module: parsed.value, dependencies: new Map() }],
    "helpers",
    [],
    { evaluation: "instance" },
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  return { linked: linked.value, bound: bound.value };
}
const keyword = { kind: "keyword", name: "number" } as const;
const value = { module: "helpers", name: "identity", typeArguments: [keyword] };
const type = {
  module: "helpers",
  name: "Box",
  typeArguments: [{ kind: "export", name: "Key" } as const],
};
const key = { module: "helpers", name: "Key", typeArguments: [] };

test("managed surface selections share application specialization roots and resolve concrete type arguments", () => {
  assert.equal(typeof compiler.resolveManagedSurfaceSelections, "function");
  const { linked, bound } = fixture();
  const resolved = compiler.resolveManagedSurfaceSelections(
    linked,
    bound,
    [value, { module: "helpers", name: "read", typeArguments: [] }],
    [type, key],
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  assert.equal(resolved.value.roots.length, 1);
  assert.equal(resolved.value.values[0]?.root, 0);
  assert.equal(resolved.value.values[1]?.root, undefined);
  assert.equal(resolved.value.types[0]?.arguments[0]?.kind, "named");
  assert.deepEqual(resolved.value.types[0]?.arguments[0], {
    start: 0,
    end: 0,
    kind: "named",
    name: resolved.value.types[1]?.local,
  });
  const specialized = specializeModule(linked.module, bound, {
    roots: resolved.value.roots,
  });
  assert.ok(specialized.ok, JSON.stringify(specialized));
  assert.equal(specialized.value.specializations.length, 1);
  assert.equal(
    specialized.value.roots[0],
    specialized.value.specializations[0]?.name,
  );
});

test("managed surface selection failures are explicit before specialization", () => {
  assert.equal(typeof compiler.resolveManagedSurfaceSelections, "function");
  const { linked, bound } = fixture();
  for (const [values, types, reason] of [
    [[{ ...value, name: "privateHelper" }], [], /export/],
    [[{ ...value, name: "constant", typeArguments: [] }], [], /function/],
    [[{ ...value, typeArguments: [] }], [], /argument count/],
    [[value, value], [], /duplicate/],
    [[], [key, key], /duplicate/],
    [[], [type], /type argument export/],
    [[], [type, { ...key, typeArguments: [keyword] }], /argument count/],
    [
      [{ ...value, typeArguments: [{ kind: "export", name: "Box" }] }],
      [type, key],
      /nongeneric/,
    ],
    [[{ ...value, name: "" }], [], /name/],
  ] as const) {
    const result = compiler.resolveManagedSurfaceSelections(
      linked,
      bound,
      values,
      types,
    );
    assert.equal(result.ok, false, JSON.stringify({ values, types, result }));
    if (!result.ok) assert.match(result.error, reason);
  }
});

test("surface roots use rebound function identities after native normalization", () => {
  const { linked } = fixture();
  const rebound = bindModule({
    ...linked.module,
    statements: linked.module.statements.map((statement) => ({ ...statement })),
  });
  assert.ok(rebound.ok);
  const resolved = compiler.resolveManagedSurfaceSelections(
    linked,
    rebound.value,
    [value],
    [],
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  assert.equal(
    resolved.value.roots[0]?.function,
    rebound.value.functions.find(
      (fn) =>
        fn.node ===
        rebound.value.bindings.find(
          (binding) => binding.name === resolved.value.values[0]?.local,
        )?.node,
    )?.id,
  );
});

test("retained tables reify generic type exports from the application's existing specializations", () => {
  assert.equal(typeof compiler.prepareManagedSurfaceTable, "function");
  const { linked, bound } = fixture();
  const resolved = compiler.resolveManagedSurfaceSelections(
    linked,
    bound,
    [value, { module: "helpers", name: "read", typeArguments: [] }],
    [type, key],
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const specialized = specializeModule(linked.module, bound, {
    roots: resolved.value.roots,
  });
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const table = compiler.prepareManagedSurfaceTable(
    specialized.value.module,
    resolved.value,
    specialized.value.roots,
    "$Surface",
    "$table",
  );
  assert.ok(table.ok, JSON.stringify(table));
  assert.equal(table.value.surface.entries.length, 2);
  assert.equal(table.value.surface.types.length, 2);
  assert.equal(
    table.value.surface.entries[0]?.local,
    specialized.value.roots[0],
  );
  const helpers = table.value.checked.module.statements.filter(
    (statement) =>
      statement.kind === "function" &&
      statement.name === specialized.value.roots[0],
  );
  assert.equal(helpers.length, 1);
  assert.ok(
    table.value.checked.module.statements.some(
      (statement) =>
        statement.kind === "function" && statement.name === "$table",
    ),
  );
});

test("generic demand anchors survive repeated specialization without duplicating application instances", () => {
  assert.equal(typeof compiler.createManagedSurfaceAnchors, "function");
  const { linked, bound } = fixture();
  const selections = compiler.resolveManagedSurfaceSelections(
    linked,
    bound,
    [
      value,
      {
        module: "helpers",
        name: "retain",
        typeArguments: [{ kind: "keyword", name: "string" }],
      },
      { module: "helpers", name: "read", typeArguments: [] },
    ],
    [key],
  );
  assert.ok(selections.ok);
  const specialized = specializeModule(linked.module, bound, {
    roots: selections.value.roots,
  });
  assert.ok(specialized.ok);
  const table = compiler.prepareManagedSurfaceTable(
    specialized.value.module,
    selections.value,
    specialized.value.roots,
    "$Surface",
    "$table",
  );
  assert.ok(table.ok);
  const anchors = compiler.createManagedSurfaceAnchors(
    linked.module,
    selections.value,
    table.value.surface,
    "$Demand",
  );
  assert.ok(anchors.ok, JSON.stringify(anchors));
  assert.equal(
    anchors.value.entries.filter((entry) => entry.anchor !== undefined).length,
    2,
  );
  assert.equal(
    compiler.resolveManagedSurfaceAnchors(
      anchors.value.module,
      anchors.value.entries,
    ).ok,
    false,
  );
  let previous: readonly { name: string; local: string }[] | undefined;
  for (let pass = 0; pass < 2; pass++) {
    const rebound = bindModule(anchors.value.module);
    assert.ok(rebound.ok);
    const prepared = specializeModule(anchors.value.module, rebound.value);
    assert.ok(prepared.ok, JSON.stringify(prepared));
    assert.equal(prepared.value.specializations.length, 2);
    const resolved = compiler.resolveManagedSurfaceAnchors(
      prepared.value.module,
      anchors.value.entries,
    );
    assert.ok(resolved.ok, JSON.stringify(resolved));
    assert.equal(new Set(resolved.value.map((entry) => entry.local)).size, 3);
    if (previous !== undefined) assert.deepEqual(resolved.value, previous);
    previous = resolved.value;
  }
});

test("generic anchors preserve void/never bodies and avoid generated value-name collisions", () => {
  const parsed = parseModule(
    createSourceTextView(
      'export function ignore<T>(value:T):void{}export function fail<T>(value:T):never{throw "STOP";}',
    ),
  );
  assert.ok(parsed.ok);
  const linked = linkModules(
    [{ id: "helpers", module: parsed.value, dependencies: new Map() }],
    "helpers",
    [],
    { evaluation: "instance" },
  );
  assert.ok(linked.ok);
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok);
  const selected = compiler.resolveManagedSurfaceSelections(
    linked.value,
    bound.value,
    [
      { module: "helpers", name: "ignore", typeArguments: [keyword] },
      { module: "helpers", name: "fail", typeArguments: [keyword] },
    ],
    [],
  );
  assert.ok(selected.ok);
  const specialized = specializeModule(linked.value.module, bound.value, {
    roots: selected.value.roots,
  });
  assert.ok(specialized.ok);
  const table = compiler.prepareManagedSurfaceTable(
    specialized.value.module,
    selected.value,
    specialized.value.roots,
    "$Surface",
    "$table",
  );
  assert.ok(table.ok);
  const occupied = parseModule(
    createSourceTextView("const $Demand_anchor_0=1;"),
  );
  assert.ok(occupied.ok);
  const generated = compiler.createManagedSurfaceAnchors(
    {
      ...linked.value.module,
      statements: [
        ...linked.value.module.statements,
        ...occupied.value.statements,
      ],
    },
    selected.value,
    table.value.surface,
    "$Demand",
  );
  assert.ok(generated.ok, JSON.stringify(generated));
  assert.equal(generated.value.entries[0]?.anchor, "$Demand_anchor_0$");
  const rebound = bindModule(generated.value.module);
  assert.ok(rebound.ok);
  const prepared = specializeModule(generated.value.module, rebound.value);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const checked = checkClosureModule(prepared.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const resolved = compiler.resolveManagedSurfaceAnchors(
    prepared.value.module,
    generated.value.entries,
  );
  assert.ok(resolved.ok);
});

test("final-pass tables remove demand anchors and capture existing application helpers", () => {
  assert.equal(typeof compiler.materializeManagedSurfaceTable, "function");
  const { linked, bound } = fixture();
  const selections = compiler.resolveManagedSurfaceSelections(
    linked,
    bound,
    [value, { module: "helpers", name: "read", typeArguments: [] }],
    [key],
  );
  assert.ok(selections.ok);
  const specialized = specializeModule(linked.module, bound, {
    roots: selections.value.roots,
  });
  assert.ok(specialized.ok);
  const table = compiler.prepareManagedSurfaceTable(
    specialized.value.module,
    selections.value,
    specialized.value.roots,
    "$Surface",
    "$initialTable",
  );
  assert.ok(table.ok);
  const anchors = compiler.createManagedSurfaceAnchors(
    linked.module,
    selections.value,
    table.value.surface,
    "$Demand",
  );
  assert.ok(anchors.ok);
  const rebound = bindModule(anchors.value.module);
  assert.ok(rebound.ok);
  const finalPass = specializeModule(anchors.value.module, rebound.value);
  assert.ok(finalPass.ok);
  const original = JSON.stringify(finalPass.value.module);
  const result = compiler.materializeManagedSurfaceTable(
    finalPass.value.module,
    anchors.value.entries,
    table.value.surface,
    "$finalTable",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(JSON.stringify(finalPass.value.module), original);
  assert.ok(checkClosureModule(result.value.module).ok);
  assert.equal(result.value.factory, "$finalTable");
  const anchorNames = new Set(
    anchors.value.entries.map((entry) => entry.anchor),
  );
  assert.ok(
    !result.value.module.statements.some(
      (statement) =>
        statement.kind === "function" && anchorNames.has(statement.name),
    ),
  );
  assert.equal(
    result.value.module.statements.filter(
      (statement) => statement.kind === "function",
    ).length,
    finalPass.value.module.statements.filter(
      (statement) => statement.kind === "function",
    ).length,
  );
  const factory = result.value.module.statements.find(
    (statement) =>
      statement.kind === "function" && statement.name === "$finalTable",
  );
  assert.equal(factory?.kind, "function");
  if (factory?.kind !== "function" || factory.body.kind !== "block")
    assert.fail("missing factory");
  const returned = factory.body.statements[0];
  assert.equal(returned?.kind, "return");
  if (returned?.kind !== "return" || returned.expression?.kind !== "object")
    assert.fail("missing table");
  const resolved = compiler.resolveManagedSurfaceAnchors(
    finalPass.value.module,
    anchors.value.entries,
  );
  assert.ok(resolved.ok);
  assert.deepEqual(
    returned.expression.properties.map((property) =>
      property.kind === "spread" ? undefined : property.value,
    ),
    resolved.value.map((entry) => ({
      kind: "identifier",
      name: entry.local,
      start: 0,
      end: 0,
    })),
  );
  assert.deepEqual(
    compiler.materializeManagedSurfaceTable(
      finalPass.value.module,
      anchors.value.entries,
      table.value.surface,
      "$finalTable",
    ),
    result,
  );
  for (const name of [
    "bad-name",
    resolved.value[0]!.local,
    "$Demand_anchor_0",
  ]) {
    const invalid = compiler.materializeManagedSurfaceTable(
      finalPass.value.module,
      anchors.value.entries,
      table.value.surface,
      name,
    );
    assert.equal(invalid.ok, false, name);
  }
  const wrongOrder = {
    ...table.value.surface,
    entries: table.value.surface.entries.slice().reverse(),
  };
  assert.equal(
    compiler.materializeManagedSurfaceTable(
      finalPass.value.module,
      anchors.value.entries,
      wrongOrder,
      "$finalTable",
    ).ok,
    false,
  );
});
