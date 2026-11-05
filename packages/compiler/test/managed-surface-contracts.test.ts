import { test } from "node:test";
import assert from "node:assert/strict";
import * as compiler from "../src/native/index.ts";
function surface(readonly = true) {
  const result = compiler.restoreManagedSurfaceTypes({
    version: 1,
    declarations: `type A={readonly next:A|undefined};type B={${readonly ? "readonly " : ""}next:B|undefined};type F=(value:A)=>A;type G=(value:B)=>B;type Table={readonly f:F;readonly g:G};`,
    table: "Table",
    entries: [
      { name: "f", local: "first", type: "F" },
      { name: "g", local: "second", type: "G" },
    ],
    types: [
      { name: "A", type: "A" },
      { name: "B", type: "B" },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("surface contract classes merge exact recursive aliases, independently of physical encoding", () => {
  assert.equal(typeof compiler.planManagedSurfaceContracts, "function");
  const plan = compiler.planManagedSurfaceContracts(surface());
  assert.ok(plan.ok, JSON.stringify(plan));
  assert.equal(plan.value.signatures.length, 1);
  assert.equal(plan.value.signatures[0]?.aliases.length, 1);
  assert.equal(plan.value.records.length, 2);
  assert.equal(
    plan.value.records.filter((group) => group.aliases.length === 1).length,
    1,
  );
  assert.equal(plan.value.surface.entries[0]?.local, "$helper0");
  const changed = compiler.planManagedSurfaceContracts(surface(false));
  assert.ok(changed.ok, JSON.stringify(changed));
  assert.equal(changed.value.signatures.length, 2);
  assert.equal(changed.value.records.length, 3);
  for (const group of [...plan.value.signatures, ...plan.value.records]) {
    assert.equal(plan.value.checked.typeNames.get(group.alias), group.type);
    for (const alias of group.aliases) assert.notEqual(alias, group.alias);
  }
});
test("surface contract planning rejects invalid declaration graphs before grouping", () => {
  assert.equal(typeof compiler.planManagedSurfaceContracts, "function");
  const original = surface();
  const result = compiler.planManagedSurfaceContracts({
    ...original,
    table: { start: 0, end: 0, kind: "named", name: "missing" },
  });
  assert.equal(result.ok, false);
});
