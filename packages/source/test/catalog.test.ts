import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, isModuleId } from "@tint/source/catalog";
test("catalog owns registration metadata and exposes canonical ordering and exact lookup", () => {
  const entries = [
    { id: "z/util.ts", value: 7 },
    { id: "a.ts", value: 3 },
  ];
  const r = createCatalog(entries);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.ids(), ["a.ts", "z/util.ts"]);
  assert.equal(r.value.size, 2);
  assert.deepEqual(r.value.lookup("a.ts"), { found: true, value: 3 });
  assert.deepEqual(r.value.lookup("A.ts"), { found: false });
  entries[0]!.id = "changed";
  entries.push({ id: "new", value: 4 });
  assert.deepEqual(r.value.ids(), ["a.ts", "z/util.ts"]);
  const copy = r.value.ids() as string[];
  copy.pop();
  assert.equal(r.value.ids().length, 2);
  assert.deepEqual(
    createCatalog([...entries.slice(1, 2), { id: "z/util.ts", value: 7 }]).ok,
    true,
  );
  const undef = createCatalog([{ id: "a.ts", value: undefined }]);
  assert.equal(undef.ok, true);
  assert.deepEqual(undef.value.lookup("a.ts"), {
    found: true,
    value: undefined,
  });
});
test("module IDs are canonical portable ASCII paths, not normalized filesystem paths", () => {
  for (const id of [
    "a.ts",
    "src/a-b_2.d.ts",
    ".hidden/file.ts",
    "__proto__",
    "A/Z.0",
  ])
    assert.equal(isModuleId(id), true, id);
  for (const id of [
    "",
    "/",
    "/a.ts",
    "a//b.ts",
    "a/",
    "./a.ts",
    "a/../b.ts",
    "a/./b.ts",
    "../a.ts",
    "a\\b.ts",
    "a.ts?x",
    "a.ts#x",
    "a%20.ts",
    "a b.ts",
    "é.ts",
    "C:/a.ts",
    "a\0.ts",
  ]) {
    assert.equal(isModuleId(id), false, id);
    assert.equal(createCatalog([{ id, value: 0 }]).ok, false);
  }
  assert.equal(createCatalog([]).ok, true);
});
test("rejects duplicates and ASCII case collisions without publishing a partial catalog", () => {
  for (const [ids, code] of [
    [["a.ts", "a.ts"], "DUPLICATE_ID"],
    [["Src/A.ts", "src/a.ts"], "CASE_COLLISION"],
  ] as const) {
    const r = createCatalog(ids.map((id) => ({ id, value: 0 })));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, code);
      assert.equal(r.error.id, ids[1]);
      assert.equal(r.error.otherId, ids[0]);
    }
    assert.equal("value" in r, false);
  }
  const a = createCatalog([
      { id: "z", value: 0 },
      { id: "a", value: 1 },
    ]),
    b = createCatalog([
      { id: "a", value: 1 },
      { id: "z", value: 0 },
    ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(a.value.ids(), b.value.ids());
});
