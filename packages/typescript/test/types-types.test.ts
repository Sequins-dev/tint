import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTypeSystem,
  type Type,
  type Result,
} from "@tint/typescript/types";
const types: Type[] = [
  { kind: "number" }, // 0
  { kind: "undefined" }, // 1
  { kind: "boolean" }, // 2
  { kind: "union", members: [0, 1] }, // 3
  { kind: "function", parameters: [0], result: 0 }, // 4
  { kind: "function", parameters: [3], result: 0 }, // 5
  { kind: "function", parameters: [0], result: 3 }, // 6
  { kind: "object", properties: [{ name: "x", type: 0, readonly: false }] }, // 7
  { kind: "object", properties: [{ name: "x", type: 3, readonly: false }] }, // 8
  { kind: "object", properties: [{ name: "x", type: 3, readonly: true }] }, // 9
  { kind: "object", properties: [{ name: "run", type: 4, readonly: true }] }, // 10
];
function system() {
  const r = createTypeSystem(types);
  assert.ok(r.ok);
  return r.value;
}
test("function variance preserves parameter acceptance and return guarantees", () => {
  const t = system();
  assert.equal(t.assignable(5, 4), true);
  assert.equal(t.assignable(4, 5), false);
  assert.equal(t.assignable(4, 6), true);
  assert.equal(t.assignable(6, 4), false);
  assert.deepEqual(t.call(5, [1]), { ok: true, value: 0 });
  assert.equal(t.call(4, [1]).ok, false);
  assert.equal(t.call(4, []).ok, false);
});
test("mutable object fields are invariant while readonly views allow covariance", () => {
  const t = system();
  assert.equal(t.assignable(7, 8), false);
  assert.equal(t.assignable(8, 7), false);
  assert.equal(t.assignable(7, 9), true);
  assert.equal(t.assignable(9, 8), false);
  assert.deepEqual(t.property(7, "x"), { ok: true, value: 0 });
  assert.ok(t.writeProperty(7, "x", 0).ok);
  assert.ok(!t.writeProperty(7, "x", 1).ok);
  assert.ok(!t.writeProperty(9, "x", 0).ok);
  assert.ok(t.object(10, [{ name: "run", type: 5 }]).ok);
  assert.ok(!t.object(10, [{ name: "run", type: 6 }]).ok);
  assert.ok(!t.object(10, []).ok);
  assert.ok(
    !t.object(7, [
      { name: "x", type: 0 },
      { name: "x", type: 0 },
    ]).ok,
  );
});
test("cell operations preserve declaration types and explicit initialization checks", () => {
  const t = system(),
    cell = { type: 3, mutable: true };
  assert.deepEqual(t.cell(cell, { kind: "initialize", value: 0 }), {
    ok: true,
    value: {
      kind: "initialize",
      type: 3,
      guard: "uninitialized",
      publishInitialized: true,
    },
  });
  assert.deepEqual(t.cell(cell, { kind: "read" }), {
    ok: true,
    value: {
      kind: "read",
      type: 3,
      guard: "initialized",
      publishInitialized: false,
    },
  });
  assert.deepEqual(t.cell(cell, { kind: "write", value: 1 }), {
    ok: true,
    value: {
      kind: "write",
      type: 3,
      guard: "initialized",
      publishInitialized: false,
    },
  });
  assert.ok(!t.cell(cell, { kind: "write", value: 2 }).ok);
  assert.ok(
    !t.cell({ type: 0, mutable: false }, { kind: "write", value: 0 }).ok,
  );
  assert.ok(
    t.cell({ type: 0, mutable: false }, { kind: "initialize", value: 0 }).ok,
  );
});
test("invalid and unproductive recursive type tables fail without publishing a partial system", () => {
  for (const input of [
    [{ kind: "union", members: [0] }],
    [{ kind: "union", members: [] }],
    [...types, { kind: "function", parameters: [999], result: 0 }],
    [
      ...types,
      {
        kind: "object",
        properties: [
          { name: "x", type: 0, readonly: true },
          { name: "x", type: 0, readonly: false },
        ],
      },
    ],
  ] satisfies Type[][]) {
    const r = createTypeSystem(input);
    assert.ok(!r.ok);
    assert.equal("value" in r, false);
  }
  const t = system();
  assert.equal(t.assignable(99, 99), false);
  assert.ok(!t.cell({ type: 99, mutable: true }, { kind: "read" }).ok);
});

test("structural types compare by shape and retain input snapshots", () => {
  const properties = [{ name: "x", type: 0, readonly: false }];
  const r = createTypeSystem([
    ...types,
    { kind: "object", properties },
    {
      kind: "object",
      properties: [
        { name: "x", type: 0, readonly: false },
        { name: "extra", type: 2, readonly: true },
      ],
    },
  ]);
  assert.ok(r.ok);
  assert.equal(r.value.assignable(11, 7), true);
  assert.equal(r.value.assignable(12, 7), true);
  assert.equal(r.value.assignable(7, 12), false);
  properties[0]!.type = 2;
  assert.deepEqual(r.value.property(11, "x"), { ok: true, value: 0 });
  assert.ok(!r.value.property(3, "x").ok);
  assert.ok(!r.value.call(3, []).ok);
});
test("union assignment checks every alternative and nested mutable fields stay invariant", () => {
  const r = createTypeSystem([
    ...types,
    { kind: "union", members: [0, 2] }, // 11
    {
      kind: "object",
      properties: [{ name: "child", type: 7, readonly: false }],
    }, // 12
    {
      kind: "object",
      properties: [{ name: "child", type: 9, readonly: false }],
    }, // 13
  ]);
  assert.ok(r.ok);
  assert.equal(r.value.assignable(3, 11), false);
  assert.equal(r.value.assignable(0, 3), true);
  assert.equal(r.value.assignable(3, 0), false);
  assert.equal(r.value.assignable(12, 13), false);
  const deep: Type[] = [{ kind: "number" }];
  for (let i = 0; i < 65; i++)
    deep.push({ kind: "function", parameters: [], result: i });
  const limit = createTypeSystem(deep);
  assert.ok(!limit.ok);
  assert.equal(limit.error, "LIMIT");
});

test("void is a return-only contract and cannot be stored or used in parameters", () => {
  const t = createTypeSystem([
    { kind: "void" },
    { kind: "function", parameters: [], result: 0 },
  ]);
  assert.ok(t.ok);
  assert.deepEqual(t.value.call(1, []), { ok: true, value: 0 });
  assert.ok(!t.value.cell({ type: 0, mutable: true }, { kind: "read" }).ok);
  for (const shape of [
    { kind: "function", parameters: [0], result: 0 },
    { kind: "object", properties: [{ name: "x", type: 0, readonly: true }] },
    { kind: "union", members: [0] },
  ] satisfies Type[])
    assert.ok(!createTypeSystem([{ kind: "void" }, shape]).ok);
});

test("literal values widen to primitives but mutable fields remain invariant", () => {
  const r = createTypeSystem([
    { kind: "number" },
    { kind: "string" },
    { kind: "literal", value: 1 },
    { kind: "literal", value: 2 },
    { kind: "literal", value: "ok" },
    { kind: "literal", value: "bad" },
    { kind: "union", members: [2, 3] },
    { kind: "object", properties: [{ name: "x", type: 2, readonly: false }] },
    { kind: "object", properties: [{ name: "x", type: 0, readonly: false }] },
  ]);
  assert.ok(r.ok);
  assert.ok(r.value.assignable(2, 0));
  assert.ok(!r.value.assignable(0, 2));
  assert.ok(!r.value.assignable(2, 3));
  assert.ok(r.value.assignable(2, 6));
  assert.ok(r.value.assignable(4, 1));
  assert.ok(!r.value.assignable(4, 5));
  assert.ok(!r.value.assignable(7, 8));
});

test("recursive structural graphs terminate and retain deep incompatibilities", () => {
  const r = createTypeSystem([
    { kind: "number" },
    { kind: "boolean" },
    {
      kind: "object",
      properties: [
        { name: "next", type: 2, readonly: true },
        { name: "value", type: 0, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "next", type: 3, readonly: true },
        { name: "value", type: 0, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "next", type: 4, readonly: true },
        { name: "value", type: 1, readonly: true },
      ],
    },
  ]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.value.assignable(2, 3));
  assert.ok(!r.value.assignable(2, 4));
  assert.ok(!r.value.assignable(4, 2));
});

test("recursive relation failures propagate around cycles and through alternatives", () => {
  const r = createTypeSystem([
    { kind: "number" },
    { kind: "boolean" },
    {
      kind: "object",
      properties: [
        { name: "next", type: 2, readonly: true },
        { name: "value", type: 0, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "next", type: 4, readonly: true },
        { name: "value", type: 1, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "next", type: 3, readonly: true },
        { name: "value", type: 0, readonly: true },
      ],
    },
    { kind: "union", members: [3, 4] },
  ]);
  assert.ok(r.ok);
  assert.ok(!r.value.assignable(2, 3));
  assert.ok(!r.value.assignable(2, 4));
  assert.ok(!r.value.assignable(2, 5));
  assert.ok(r.value.assignable(4, 5));
});

test("readonly array views allow covariance while mutable arrays remain invariant", () => {
  const r = createTypeSystem([
    { kind: "number" },
    { kind: "literal", value: 1 },
    { kind: "array", element: 1, readonly: false },
    { kind: "array", element: 0, readonly: false },
    { kind: "array", element: 0, readonly: true },
    { kind: "array", element: 1, readonly: true },
  ]);
  assert.ok(r.ok);
  assert.ok(!r.value.assignable(2, 3));
  assert.ok(r.value.assignable(2, 4));
  assert.ok(r.value.assignable(5, 4));
  assert.ok(!r.value.assignable(4, 3));
  assert.ok(!r.value.assignable(3, 2));
});

test("forward references validate all edges and recursive graphs keep immutable snapshots", () => {
  const properties = [{ name: "next", type: 1, readonly: true }];
  const r = createTypeSystem([
    { kind: "object", properties },
    { kind: "object", properties: [{ name: "next", type: 0, readonly: true }] },
  ]);
  assert.ok(r.ok);
  properties[0]!.type = 999;
  assert.deepEqual(r.value.property(0, "next"), { ok: true, value: 1 });
  assert.ok(r.value.assignable(0, 1));
  assert.ok(
    !createTypeSystem([
      {
        kind: "object",
        properties: [{ name: "bad", type: 1, readonly: true }],
      },
    ]).ok,
  );
  assert.ok(
    !createTypeSystem([
      { kind: "union", members: [1] },
      { kind: "union", members: [0] },
    ]).ok,
  );
});

test("union reads require a common property and writes do not bypass variant contracts", () => {
  const r = createTypeSystem([
    { kind: "boolean" },
    { kind: "number" },
    { kind: "literal", value: true },
    { kind: "literal", value: false },
    {
      kind: "object",
      properties: [
        { name: "ok", type: 2, readonly: true },
        { name: "value", type: 1, readonly: false },
      ],
    },
    { kind: "object", properties: [{ name: "ok", type: 3, readonly: true }] },
    { kind: "union", members: [4, 5] },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.value.property(6, "ok"), { ok: true, value: 0 });
  assert.ok(!r.value.property(6, "value").ok);
  assert.ok(!r.value.writeProperty(6, "ok", 2).ok);
  assert.ok(!r.value.writeProperty(6, "value", 1).ok);
});

test("optional function contracts distinguish omission from required undefined unions", () => {
  const r = createTypeSystem([
    ...types,
    { kind: "function", parameters: [3], result: 0, minimumArguments: 0 },
    { kind: "function", parameters: [0, 3], result: 0, minimumArguments: 1 },
  ]);
  assert.ok(r.ok);
  assert.ok(r.value.call(11, []).ok);
  assert.ok(r.value.call(11, [1]).ok);
  assert.equal(r.value.call(5, []).ok, false);
  assert.equal(r.value.call(12, []).ok, false);
  assert.ok(r.value.call(12, [0]).ok);
  assert.equal(r.value.call(11, [0, 0]).ok, false);
  assert.equal(r.value.assignable(5, 11), false);
  assert.ok(r.value.assignable(11, 5));
  for (const minimumArguments of [-1, 2, 0.5, NaN])
    assert.equal(
      createTypeSystem([
        ...types,
        { kind: "function", parameters: [3], result: 0, minimumArguments },
      ]).ok,
      false,
    );
});
test("optional fields distinguish omitted construction, undefined reads and exact writes", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "undefined" },
    { kind: "union", members: [0, 1] },
    {
      kind: "object",
      properties: [{ name: "x", type: 0, readonly: false, optional: true }],
    },
    { kind: "object", properties: [{ name: "x", type: 2, readonly: false }] },
    {
      kind: "object",
      properties: [{ name: "x", type: 2, readonly: false, optional: true }],
    },
    {
      kind: "object",
      properties: [{ name: "x", type: 0, readonly: true, optional: true }],
    },
    { kind: "object", properties: [] },
    { kind: "object", properties: [{ name: "x", type: 0, readonly: false }] },
  ];
  const result = createTypeSystem(graph);
  assert.ok(result.ok);
  const s = result.value;
  assert.ok(s.object(3, []).ok);
  assert.equal(s.object(4, []).ok, false);
  assert.equal(s.object(3, [{ name: "x", type: 1 }]).ok, false);
  assert.ok(s.object(5, [{ name: "x", type: 1 }]).ok);
  assert.deepEqual(s.property(3, "x"), { ok: true, value: 2 });
  assert.equal(s.writeProperty(3, "x", 1).ok, false);
  assert.ok(s.writeProperty(3, "x", 0).ok);
  assert.ok(s.writeProperty(5, "x", 1).ok);
  assert.equal(s.assignable(3, 8), false);
  assert.equal(s.assignable(8, 3), false);
  assert.equal(s.assignable(7, 3), false);
  assert.equal(s.assignable(7, 6), false);
  assert.ok(s.assignable(8, 6));
  assert.equal(s.assignable(3, 5), false);
  assert.equal(s.assignable(5, 3), false);
});
test("optional reads choose the narrowest available union rather than an unrelated wider union", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "undefined" },
    { kind: "string" },
    { kind: "union", members: [0, 1, 2] },
    { kind: "union", members: [1, 2] },
    {
      kind: "object",
      properties: [{ name: "name", type: 2, readonly: true, optional: true }],
    },
  ];
  const result = createTypeSystem(graph);
  assert.ok(result.ok);
  assert.deepEqual(result.value.property(5, "name"), { ok: true, value: 4 });
});

test("set views preserve variance without assigning sets to arrays", () => {
  const r = createTypeSystem([
    { kind: "string" },
    { kind: "literal", value: "a" },
    { kind: "set", element: 1, readonly: false },
    { kind: "set", element: 0, readonly: false },
    { kind: "set", element: 0, readonly: true },
    { kind: "set", element: 1, readonly: true },
    { kind: "array", element: 0, readonly: true },
  ]);
  assert.ok(r.ok);
  assert.equal(r.value.assignable(2, 3), false);
  assert.equal(r.value.assignable(3, 2), false);
  assert.equal(r.value.assignable(2, 4), true);
  assert.equal(r.value.assignable(5, 4), true);
  assert.equal(r.value.assignable(4, 3), false);
  assert.equal(r.value.assignable(4, 6), false);
  assert.equal(r.value.assignable(6, 4), false);
});

test("map key and value contracts are invariant when mutable and covariant in readonly views", () => {
  const r = createTypeSystem([
    { kind: "string" },
    { kind: "literal", value: "a" },
    { kind: "number" },
    { kind: "literal", value: 1 },
    { kind: "map", key: 1, value: 3, readonly: false },
    { kind: "map", key: 0, value: 2, readonly: false },
    { kind: "map", key: 0, value: 2, readonly: true },
    { kind: "map", key: 1, value: 3, readonly: true },
    { kind: "set", element: 0, readonly: true },
  ]);
  assert.ok(r.ok);
  assert.ok(!r.value.assignable(4, 5));
  assert.ok(!r.value.assignable(5, 4));
  assert.ok(r.value.assignable(4, 6));
  assert.ok(r.value.assignable(7, 6));
  assert.ok(!r.value.assignable(6, 5));
  assert.ok(!r.value.assignable(6, 8));
  assert.ok(!r.value.assignable(8, 6));
  assert.ok(
    !createTypeSystem([{ kind: "map", key: 1, value: 0, readonly: false }]).ok,
  );
});

test("optional construction values cannot establish required properties", () => {
  const t = system();
  assert.equal(t.object(7, [{ name: "x", type: 0, optional: true }]).ok, false);
});

test("unknown accepts values without weakening mutable storage contracts", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "unknown" },
    { kind: "void" },
    { kind: "array", element: 0, readonly: false },
    { kind: "array", element: 1, readonly: false },
    { kind: "array", element: 1, readonly: true },
    { kind: "undefined" },
    { kind: "string" },
    { kind: "function", parameters: [1], result: 1 },
    { kind: "union", members: [0, 7] },
  ];
  const created = createTypeSystem(graph);
  assert.ok(created.ok);
  const system = created.value;
  for (const id of [0, 1, 3, 4, 5, 6, 7, 8, 9])
    assert.ok(system.assignable(id, 1));
  for (const id of [0, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.equal(system.assignable(1, id), false);
  assert.equal(system.assignable(2, 1), false);
  assert.equal(system.assignable(3, 4), false);
  assert.equal(system.assignable(4, 3), false);
  assert.equal(system.assignable(3, 5), true);
  assert.equal(system.property(1, "x").ok, false);
  assert.equal(system.call(1, []).ok, false);
  assert.equal(system.call(8, [0]).ok, true);
});

test("never is a bottom type without weakening mutable element invariance", () => {
  const graph: Type[] = [
    { kind: "never" },
    { kind: "number" },
    { kind: "unknown" },
    { kind: "void" },
    { kind: "array", element: 0, readonly: false },
    { kind: "array", element: 1, readonly: false },
    { kind: "array", element: 1, readonly: true },
  ];
  const created = createTypeSystem(graph);
  assert.ok(created.ok);
  for (let id = 0; id < graph.length; id++)
    assert.ok(created.value.assignable(0, id));
  for (let id = 1; id < graph.length; id++)
    assert.equal(created.value.assignable(id, 0), false);
  assert.equal(created.value.assignable(4, 5), false);
  assert.equal(created.value.assignable(4, 6), true);
});

test("sparse property tables are invalid rather than throwing during validation", () => {
  const properties: { name: string; type: number; readonly: boolean }[] = [];
  properties.length = 1;
  assert.deepEqual(createTypeSystem([{ kind: "object", properties }]), {
    ok: false,
    error: "INVALID_TYPE",
  });
});

test("accepts broad type graphs needed by a linked compiler", () => {
  const types: Type[] = Array.from({ length: 5000 }, () => ({
    kind: "number",
  }));
  const result = createTypeSystem(types);
  assert.ok(result.ok, JSON.stringify(result));
});

test("does not impose a fixed ceiling on the number of finite graph nodes", () => {
  const types: Type[] = Array.from({ length: 65537 }, () => ({
    kind: "number",
  }));
  types[65536] = { kind: "literal", value: 42 };
  const result = createTypeSystem(types);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.assignable(65536, 0), true);
  assert.equal(result.value.assignable(0, 65536), false);
});

test("dense type graph validation avoids quadratic native collection lookup work", () => {
  const graph: Type[] = [{ kind: "number" }];
  for (let id = 1; id < 2048; id++)
    graph.push({ kind: "array", element: 0, readonly: true });
  const get = Map.prototype.get,
    has = Set.prototype.has;
  let lookupWork = 0;
  // Model the baseline native linked collections' scan budget, independently
  // of Node's hash-table implementation and machine timing.
  Map.prototype.get = function <K, V>(this: Map<K, V>, key: K): V | undefined {
    lookupWork += this.size;
    return get.call(this, key);
  };
  Set.prototype.has = function <T>(this: Set<T>, value: T): boolean {
    lookupWork += this.size;
    return has.call(this, value);
  };
  try {
    const result = createTypeSystem(graph);
    assert.ok(result.ok);
  } finally {
    Map.prototype.get = get;
    Set.prototype.has = has;
  }
  assert.ok(lookupWork < graph.length * 16, `lookup work: ${lookupWork}`);
});

test("appended types match rebuilt graphs and own their inputs", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "string" },
    { kind: "void" },
  ];
  const initial = createTypeSystem(graph);
  assert.ok(initial.ok);
  const system = initial.value;
  const properties = [{ name: "value", type: 0, readonly: true }];
  const additions: Type[] = [
    { kind: "object", properties },
    { kind: "union", members: [0, 1] },
    { kind: "array", element: 4, readonly: true },
    { kind: "function", parameters: [4], result: 2 },
    { kind: "set", element: 3, readonly: false },
  ];
  for (const addition of additions) {
    assert.deepEqual(system.append(addition), {
      ok: true,
      value: graph.length,
    });
    graph.push(addition);
    const rebuilt = createTypeSystem(graph);
    assert.ok(rebuilt.ok);
    for (let actual = 0; actual < graph.length; actual++)
      for (let expected = 0; expected < graph.length; expected++)
        assert.equal(
          system.assignable(actual, expected),
          rebuilt.value.assignable(actual, expected),
        );
  }
  properties[0]!.type = 1;
  assert.deepEqual(system.property(3, "value"), { ok: true, value: 0 });
  assert.deepEqual(system.call(6, [0]), { ok: true, value: 2 });
});

test("failed appends preserve IDs and reject invalid references, void fields, and excessive depth", () => {
  const initial = createTypeSystem([{ kind: "number" }, { kind: "void" }]);
  assert.ok(initial.ok);
  const system = initial.value;
  for (const invalid of [
    { kind: "union", members: [2] },
    { kind: "union", members: [0, 0] },
    { kind: "array", element: 1, readonly: true },
    { kind: "function", parameters: [1], result: 0 },
    { kind: "literal", value: Infinity },
  ] satisfies Type[])
    assert.deepEqual(system.append(invalid), {
      ok: false,
      error: "INVALID_TYPE",
    });
  let previous = 0;
  for (let depth = 2; depth <= 64; depth++) {
    const appended = system.append({
      kind: "array",
      element: previous,
      readonly: true,
    });
    assert.ok(appended.ok);
    assert.equal(appended.value, depth);
    previous = appended.value;
  }
  assert.deepEqual(
    system.append({ kind: "array", element: previous, readonly: true }),
    { ok: false, error: "LIMIT" },
  );
  assert.deepEqual(system.append({ kind: "boolean" }), { ok: true, value: 65 });
  assert.equal(system.assignable(previous, previous), true);
});

test("repeated assignability queries reuse completed relations", () => {
  const made = createTypeSystem([
    { kind: "object", properties: [{ name: "next", type: 0, readonly: true }] },
    { kind: "object", properties: [{ name: "next", type: 1, readonly: true }] },
    {
      kind: "object",
      properties: [{ name: "different", type: 1, readonly: true }],
    },
  ]);
  assert.ok(made.ok);
  const t = made.value,
    original = Number.isSafeInteger;
  let relationWork = 0;
  Number.isSafeInteger = function (value: unknown): boolean {
    relationWork++;
    return original(value);
  };
  try {
    assert.equal(t.assignable(0, 1), true);
    assert.equal(t.assignable(0, 2), false);
    const initialWork = relationWork;
    assert.ok(initialWork > 0);
    for (let i = 0; i < 32; i++) {
      assert.equal(t.assignable(0, 1), true);
      assert.equal(t.assignable(0, 2), false);
    }
    assert.equal(relationWork, initialWork);
  } finally {
    Number.isSafeInteger = original;
  }
});

test("relation cache replacement and graph extension preserve exact answers", () => {
  const graph: Type[] = [{ kind: "number" }, { kind: "unknown" }];
  for (let i = 0; i < 128; i++) graph.push({ kind: "literal", value: i });
  const made = createTypeSystem(graph);
  assert.ok(made.ok);
  const t = made.value;
  for (let round = 0; round < 2; round++)
    for (let a = 2; a < graph.length; a++)
      for (let b = 0; b < graph.length; b++)
        assert.equal(t.assignable(a, b), b < 2 || a === b);
  assert.equal(t.assignable(graph.length, 1), false);
  assert.deepEqual(t.append({ kind: "array", element: 0, readonly: true }), {
    ok: true,
    value: graph.length,
  });
  assert.equal(t.assignable(graph.length, 1), true);
  assert.equal(t.assignable(2, 0), true);
  assert.equal(t.assignable(2, 3), false);
});

test("scalar and literal union relations avoid building recursive work graphs", () => {
  const made = createTypeSystem([
    { kind: "number" },
    { kind: "string" },
    { kind: "boolean" },
    { kind: "void" },
    { kind: "unknown" },
    { kind: "never" },
    { kind: "literal", value: "x" },
    { kind: "literal", value: "y" },
    { kind: "union", members: [6, 7] },
    { kind: "union", members: [8, 0] },
  ]);
  assert.ok(made.ok);
  const set = Map.prototype.set;
  let work = 0;
  Map.prototype.set = function <K, V>(
    this: Map<K, V>,
    key: K,
    value: V,
  ): Map<K, V> {
    work++;
    return set.call(this, key, value);
  };
  try {
    for (const [a, b, expected] of [
      [6, 9, true],
      [7, 0, false],
      [1, 9, false],
      [0, 9, true],
      [3, 4, false],
      [5, 3, true],
      [4, 9, false],
      [2, 9, false],
    ] as const)
      assert.equal(made.value.assignable(a, b), expected);
  } finally {
    Map.prototype.set = set;
  }
  assert.ok(work <= 4, `scalar relation graph work: ${work}`);
});

test("scalar fast paths agree with the recursive solver through singleton unions", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "string" },
    { kind: "boolean" },
    { kind: "undefined" },
    { kind: "null" },
    { kind: "unknown" },
    { kind: "never" },
    { kind: "TypeError" },
    { kind: "RangeError" },
    { kind: "ArrayBuffer" },
    { kind: "Uint8Array" },
    { kind: "Uint16Array" },
    { kind: "Uint32Array" },
    { kind: "Float64Array" },
    { kind: "literal", value: 0 },
    { kind: "literal", value: "x" },
    { kind: "literal", value: false },
    { kind: "union", members: [0, 1, 3] },
    { kind: "union", members: [14, 15, 16] },
    {
      kind: "object",
      properties: [{ name: "next", type: 19, readonly: true }],
    },
    { kind: "array", element: 0, readonly: true },
    { kind: "function", parameters: [0], result: 1 },
    { kind: "void" },
  ];
  const made = createTypeSystem(graph);
  assert.ok(made.ok);
  for (let actual = 0; actual < 17; actual++) {
    const wrapper = made.value.append({ kind: "union", members: [actual] });
    assert.ok(wrapper.ok);
    for (let expected = 0; expected < graph.length; expected++)
      assert.equal(
        made.value.assignable(actual, expected),
        made.value.assignable(wrapper.value, expected),
        `${actual} -> ${expected}`,
      );
  }
});

test("compound union alternatives short circuit before recursive graph allocation", () => {
  const made = createTypeSystem([
    { kind: "number" },
    { kind: "object", properties: [{ name: "next", type: 1, readonly: true }] },
    { kind: "object", properties: [{ name: "next", type: 2, readonly: true }] },
    { kind: "union", members: [1, 2, 0] },
    { kind: "union", members: [0, 3] },
  ]);
  assert.ok(made.ok);
  const set = Map.prototype.set;
  let work = 0;
  Map.prototype.set = function <K, V>(
    this: Map<K, V>,
    key: K,
    value: V,
  ): Map<K, V> {
    work++;
    return set.call(this, key, value);
  };
  try {
    assert.equal(made.value.assignable(1, 3), true);
    assert.equal(made.value.assignable(1, 4), true);
  } finally {
    Map.prototype.set = set;
  }
  assert.equal(work, 0, "identity alternative needs no recursive work graph");
});

test("compound union fast paths agree with the coinductive solver", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "string" },
    { kind: "unknown" },
    { kind: "never" },
    { kind: "object", properties: [{ name: "next", type: 4, readonly: true }] },
    { kind: "object", properties: [{ name: "next", type: 5, readonly: true }] },
    { kind: "object", properties: [{ name: "next", type: 0, readonly: true }] },
    { kind: "array", element: 4, readonly: true },
    { kind: "set", element: 0, readonly: false },
    { kind: "map", key: 1, value: 4, readonly: false },
    { kind: "function", parameters: [4], result: 5 },
    { kind: "union", members: [0, 4, 6] },
    { kind: "union", members: [7, 8, 9, 10] },
    { kind: "union", members: [11, 12] },
  ];
  const made = createTypeSystem(graph);
  assert.ok(made.ok);
  for (let actual = 4; actual <= 10; actual++) {
    const wrapper = made.value.append({ kind: "union", members: [actual] });
    assert.ok(wrapper.ok);
    for (let expected = 0; expected < graph.length; expected++)
      assert.equal(
        made.value.assignable(actual, expected),
        made.value.assignable(wrapper.value, expected),
        `${actual} -> ${expected}`,
      );
  }
});

test("incompatible object discriminants reject before recursive graph allocation", () => {
  const made = createTypeSystem([
    { kind: "literal", value: "left" },
    { kind: "literal", value: "right" },
    {
      kind: "object",
      properties: [
        { name: "next", type: 2, readonly: true },
        { name: "kind", type: 0, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "next", type: 3, readonly: true },
        { name: "kind", type: 1, readonly: true },
      ],
    },
  ]);
  assert.ok(made.ok);
  const set = Map.prototype.set;
  let work = 0;
  Map.prototype.set = function <K, V>(
    this: Map<K, V>,
    key: K,
    value: V,
  ): Map<K, V> {
    work++;
    return set.call(this, key, value);
  };
  try {
    assert.equal(made.value.assignable(2, 3), false);
  } finally {
    Map.prototype.set = set;
  }
  assert.equal(
    work,
    0,
    "a mismatched discriminant makes recursive expansion unnecessary",
  );
});

test("source union mismatch short circuits without expanding recursive alternatives", () => {
  const made = createTypeSystem([
    { kind: "literal", value: "x" },
    { kind: "literal", value: "y" },
    { kind: "object", properties: [{ name: "next", type: 2, readonly: true }] },
    { kind: "union", members: [0, 2] },
    { kind: "union", members: [1, 2] },
  ]);
  assert.ok(made.ok);
  const set = Map.prototype.set;
  let work = 0;
  Map.prototype.set = function <K, V>(
    this: Map<K, V>,
    key: K,
    value: V,
  ): Map<K, V> {
    work++;
    return set.call(this, key, value);
  };
  try {
    assert.equal(made.value.assignable(3, 4), false);
  } finally {
    Map.prototype.set = set;
  }
  assert.equal(work, 0);
});

test("union shortcuts agree with recursive solver through covariant array wrappers", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "string" },
    { kind: "never" },
    { kind: "unknown" },
    { kind: "literal", value: "x" },
    { kind: "literal", value: "y" },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 4, readonly: true },
        { name: "next", type: 6, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 5, readonly: true },
        { name: "next", type: 7, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 4, readonly: true },
        { name: "next", type: 8, readonly: true },
      ],
    },
    { kind: "union", members: [4, 6] },
    { kind: "union", members: [5, 7] },
    { kind: "union", members: [0, 9] },
    { kind: "union", members: [4, 8] },
    { kind: "union", members: [2, 3] },
    { kind: "union", members: [9, 10, 11, 12] },
  ];
  const made = createTypeSystem(graph);
  assert.ok(made.ok);
  const wrappers = graph.map((_, i) => {
    const w = made.value.append({ kind: "array", element: i, readonly: true });
    assert.ok(w.ok);
    return w.value;
  });
  for (let a = 0; a < graph.length; a++)
    for (let b = 0; b < graph.length; b++)
      assert.equal(
        made.value.assignable(a, b),
        made.value.assignable(wrappers[a]!, wrappers[b]!),
        `${a} -> ${b}`,
      );
});

test("nested contradictory shapes stop coinductive expansion before their fields", () => {
  const made = createTypeSystem([
    { kind: "literal", value: "x" },
    { kind: "literal", value: "y" },
    {
      kind: "object",
      properties: [
        { name: "next", type: 2, readonly: true },
        { name: "kind", type: 0, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "next", type: 3, readonly: true },
        { name: "kind", type: 1, readonly: true },
      ],
    },
    { kind: "array", element: 2, readonly: true },
    { kind: "array", element: 3, readonly: true },
  ]);
  assert.ok(made.ok);
  const set = Map.prototype.set;
  let work = 0;
  Map.prototype.set = function <K, V>(
    this: Map<K, V>,
    key: K,
    value: V,
  ): Map<K, V> {
    work++;
    return set.call(this, key, value);
  };
  try {
    assert.equal(made.value.assignable(4, 5), false);
  } finally {
    Map.prototype.set = set;
  }
  assert.ok(work <= 2);
});

test("property lookup refines cached answers after appends without rescanning the object", () => {
  const made = createTypeSystem([
    { kind: "string" },
    { kind: "literal", value: "x" },
    { kind: "literal", value: "y" },
    {
      kind: "object",
      properties: [{ name: "value", type: 1, readonly: true }],
    },
    {
      kind: "object",
      properties: [{ name: "value", type: 2, readonly: true }],
    },
    { kind: "union", members: [3, 4] },
  ]);
  assert.ok(made.ok);
  const add = Set.prototype.add;
  let visits = 0;
  Set.prototype.add = function <T>(this: Set<T>, value: T): Set<T> {
    visits++;
    return add.call(this, value);
  };
  try {
    const first = made.value.property(5, "value");
    assert.deepEqual(first, { ok: true, value: 0 });
    const initial = visits;
    assert.deepEqual(made.value.property(5, "value"), first);
    assert.equal(
      visits,
      initial,
      "repeated property query traversed the graph again",
    );
    assert.ok(made.value.append({ kind: "union", members: [1, 2] }).ok);
    const afterAppend = visits;
    assert.deepEqual(made.value.property(5, "value"), { ok: true, value: 6 });
    assert.equal(
      visits,
      afterAppend,
      "append rescanned immutable object fields",
    );
  } finally {
    Set.prototype.add = add;
  }
});

test("incremental property refinement agrees with fresh graph queries", () => {
  const graph: Type[] = [
    { kind: "string" },
    { kind: "literal", value: "x" },
    { kind: "literal", value: "y" },
    { kind: "undefined" },
    { kind: "object", properties: [{ name: "tag", type: 1, readonly: true }] },
    { kind: "object", properties: [{ name: "tag", type: 2, readonly: true }] },
    { kind: "union", members: [4, 5] },
    {
      kind: "object",
      properties: [{ name: "tag", type: 1, readonly: true, optional: true }],
    },
  ];
  const cached = createTypeSystem(graph);
  assert.ok(cached.ok);
  for (const type of [
    { kind: "number" },
    { kind: "union", members: [0, 3] },
    { kind: "union", members: [1, 2] },
    { kind: "union", members: [1, 3] },
    { kind: "union", members: [1, 2, 3] },
    { kind: "union", members: [2, 1] },
  ] satisfies Type[]) {
    for (const id of [4, 6, 7]) cached.value.property(id, "tag");
    graph.push(type);
    assert.ok(cached.value.append(type).ok);
    const fresh = createTypeSystem(graph);
    assert.ok(fresh.ok);
    for (const id of [4, 6, 7])
      assert.deepEqual(
        cached.value.property(id, "tag"),
        fresh.value.property(id, "tag"),
      );
  }
});

test("contradictory primitive union fields reject before building recursive relations", () => {
  const graph: Type[] = [
    { kind: "literal", value: "a" },
    { kind: "literal", value: "b" },
    { kind: "union", members: [0, 1] },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 2, readonly: true },
        { name: "next", type: 3, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 0, readonly: true },
        { name: "next", type: 4, readonly: true },
      ],
    },
  ];
  const system = createTypeSystem(graph);
  assert.ok(system.ok);
  const original = Map.prototype.set;
  let relations = 0;
  Map.prototype.set = function <K, V>(
    this: Map<K, V>,
    key: K,
    value: V,
  ): Map<K, V> {
    relations++;
    return original.call(this, key, value);
  };
  try {
    assert.equal(system.value.assignable(3, 4), false);
  } finally {
    Map.prototype.set = original;
  }
  assert.equal(relations, 0);
  assert.equal(system.value.assignable(4, 3), true);
});

test("primitive field rejection agrees with independent array relation obligations", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "string" },
    { kind: "boolean" },
    { kind: "undefined" },
    { kind: "unknown" },
    { kind: "never" },
    { kind: "literal", value: 1 },
    { kind: "literal", value: 2 },
    { kind: "literal", value: "a" },
    { kind: "literal", value: true },
    { kind: "union", members: [0, 1] },
    { kind: "union", members: [6, 7] },
    { kind: "union", members: [8, 3] },
    { kind: "union", members: [10, 3] },
  ];
  const size = graph.length;
  for (const readonly of [true, false])
    for (let i = 0; i < size; i++) {
      graph.push({ kind: "array", element: i, readonly });
      graph.push({
        kind: "object",
        properties: [{ name: "value", type: i, readonly }],
      });
    }
  const system = createTypeSystem(graph);
  assert.ok(system.ok);
  for (let mode = 0; mode < 2; mode++)
    for (let a = 0; a < size; a++)
      for (let b = 0; b < size; b++) {
        const offset = size + mode * size * 2;
        assert.equal(
          system.value.assignable(offset + a * 2 + 1, offset + b * 2 + 1),
          system.value.assignable(offset + a * 2, offset + b * 2),
          `${mode}:${a}:${b}`,
        );
      }
});

test("large structural relation tables bound native linked-map lookup work", () => {
  const count = 128,
    graph: Type[] = [{ kind: "number" }];
  for (let i = 0; i < count * 2; i++)
    graph.push({ kind: "array", element: 0, readonly: true });
  for (let side = 0; side < 2; side++)
    graph.push({
      kind: "object",
      properties: Array.from({ length: count }, (_, i) => ({
        name: `p${i}`,
        type: 1 + side * count + i,
        readonly: true,
      })),
    });
  const system = createTypeSystem(graph);
  assert.ok(system.ok);
  const original = Map.prototype.get;
  let work = 0;
  Map.prototype.get = function <K, V>(this: Map<K, V>, key: K): V | undefined {
    work += this.size;
    return original.call(this, key);
  };
  try {
    assert.equal(system.value.assignable(count * 2 + 1, count * 2 + 2), true);
  } finally {
    Map.prototype.get = original;
  }
  assert.ok(work < 2048, `native linked lookup work: ${work}`);
});

test("completed recursive subrelations are reused independently of their parent query", () => {
  for (const same of [true, false]) {
    const system = createTypeSystem([
      { kind: "number" },
      { kind: "string" },
      {
        kind: "object",
        properties: [
          { name: "next", type: 2, readonly: true },
          { name: "value", type: 0, readonly: true },
        ],
      },
      {
        kind: "object",
        properties: [
          { name: "next", type: 3, readonly: true },
          { name: "value", type: same ? 0 : 1, readonly: true },
        ],
      },
      { kind: "array", element: 2, readonly: true },
      { kind: "array", element: 3, readonly: true },
    ]);
    assert.ok(system.ok);
    assert.equal(system.value.assignable(4, 5), same);
    const original = Map.prototype.set;
    let nodes = 0;
    Map.prototype.set = function (key, value) {
      nodes++;
      return original.call(this, key, value);
    };
    try {
      assert.equal(system.value.assignable(2, 3), same);
    } finally {
      Map.prototype.set = original;
    }
    assert.equal(
      nodes,
      0,
      "completed child relation must not rebuild its graph",
    );
  }
});

test("completed invariant subrelations are reused without weakening mutable contracts", () => {
  const graph: Type[] = [{ kind: "number" }];
  for (let i = 0; i < 20; i++)
    graph.push({
      kind: "object",
      properties: [
        { name: "next", type: i === 19 ? 0 : i + 2, readonly: true },
      ],
    });
  for (let i = 0; i < 20; i++)
    graph.push({
      kind: "object",
      properties: [
        { name: "next", type: i === 19 ? 0 : i + 22, readonly: true },
      ],
    });
  graph.push(
    { kind: "array", element: 1, readonly: false },
    { kind: "array", element: 21, readonly: false },
    { kind: "array", element: 1, readonly: false },
    { kind: "array", element: 21, readonly: false },
  );
  const system = createTypeSystem(graph);
  assert.ok(system.ok);
  assert.equal(system.value.assignable(41, 42), true);
  const original = Map.prototype.set;
  let nodes = 0;
  Map.prototype.set = function (key, value) {
    nodes++;
    return original.call(this, key, value);
  };
  try {
    assert.equal(system.value.assignable(43, 44), true);
  } finally {
    Map.prototype.set = original;
  }
  assert.ok(nodes <= 2, `repeated invariant relation nodes: ${nodes}`);
});

test("cached covariant and invariant relations remain distinct", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "literal", value: 1 },
    {
      kind: "object",
      properties: [{ name: "value", type: 1, readonly: true }],
    },
    {
      kind: "object",
      properties: [{ name: "value", type: 0, readonly: true }],
    },
    { kind: "array", element: 2, readonly: false },
    { kind: "array", element: 3, readonly: false },
    { kind: "array", element: 2, readonly: true },
    { kind: "array", element: 3, readonly: true },
  ];
  for (const reverse of [false, true]) {
    const system = createTypeSystem(graph);
    assert.ok(system.ok);
    if (reverse) assert.equal(system.value.assignable(4, 5), false);
    assert.equal(system.value.assignable(2, 3), true);
    assert.equal(system.value.assignable(6, 7), true);
    assert.equal(system.value.assignable(4, 5), false);
    assert.equal(system.value.assignable(2, 3), true);
  }
});

test("fully proved object fields avoid allocating a relation work graph", () => {
  const system = createTypeSystem([
    { kind: "number" },
    { kind: "literal", value: 1 },
    { kind: "object", properties: [{ name: "next", type: 2, readonly: true }] },
    {
      kind: "object",
      properties: [
        { name: "value", type: 1, readonly: true },
        { name: "shared", type: 2, readonly: false },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "shared", type: 2, readonly: false },
        { name: "value", type: 0, readonly: true },
      ],
    },
  ]);
  assert.ok(system.ok);
  const original = Map.prototype.set;
  let nodes = 0;
  Map.prototype.set = function (key, value) {
    nodes++;
    return original.call(this, key, value);
  };
  try {
    assert.equal(system.value.assignable(3, 4), true);
  } finally {
    Map.prototype.set = original;
  }
  assert.equal(nodes, 0);
});

test("structural solving does not create per-node Map or Set entries", () => {
  const system = createTypeSystem([
    { kind: "object", properties: [{ name: "next", type: 0, readonly: true }] },
    { kind: "object", properties: [{ name: "next", type: 1, readonly: true }] },
  ]);
  assert.ok(system.ok);
  const set = Map.prototype.set,
    add = Set.prototype.add;
  let entries = 0;
  Map.prototype.set = function (key, value) {
    entries++;
    return set.call(this, key, value);
  };
  Set.prototype.add = function (value) {
    entries++;
    return add.call(this, value);
  };
  try {
    assert.equal(system.value.assignable(0, 1), true);
  } finally {
    Map.prototype.set = set;
    Set.prototype.add = add;
  }
  assert.equal(entries, 0);
});

test("relation memoization scales with appended types instead of retaining a tiny initial table", () => {
  const originalPush = Array.prototype.push;
  let reads = 0;
  // Observe copied literal definitions without exposing optimizer counters in the API.
  Array.prototype.push = function (...items: unknown[]) {
    for (const item of items) {
      if (
        typeof item === "object" &&
        item !== null &&
        "kind" in item &&
        item.kind === "literal" &&
        "value" in item &&
        typeof item.value === "string" &&
        item.value.startsWith("cache-growth-")
      ) {
        Object.defineProperty(item, "kind", {
          configurable: true,
          get() {
            reads++;
            return "literal";
          },
        });
      }
    }
    return Reflect.apply(originalPush, this, items);
  };
  try {
    const system = createTypeSystem([{ kind: "string" }]);
    assert.ok(system.ok);
    for (let i = 1; i <= 256; i++) {
      const appended: Result<number> = system.value.append({
        kind: "literal",
        value: "cache-growth-" + i,
      });
      assert.ok(appended.ok);
      assert.equal(appended.value, i);
    }
    for (let i = 1; i <= 256; i++)
      assert.equal(system.value.assignable(i, 0), true);
    reads = 0;
    for (let i = 1; i <= 256; i++)
      assert.equal(system.value.assignable(i, 0), true);
    assert.equal(
      reads,
      0,
      "repeated completed relations must not reread type definitions",
    );
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("validated union relations check public IDs once and reuse graph validity internally", () => {
  const graph: Type[] = [{ kind: "string" }];
  for (let i = 0; i < 32; i++)
    graph.push({ kind: "literal", value: String(i) });
  graph.push({
    kind: "union",
    members: Array.from({ length: 32 }, (_, i) => i + 1),
  });
  const system = createTypeSystem(graph);
  assert.ok(system.ok);
  const original = Number.isInteger;
  let checks = 0;
  Number.isInteger = (value: unknown): boolean => {
    checks++;
    return original(value);
  };
  try {
    assert.equal(system.value.assignable(33, 0), true);
  } finally {
    Number.isInteger = original;
  }
  assert.equal(checks, 2);
  for (const invalid of [-1, 0.5, 34, NaN, Infinity]) {
    assert.equal(system.value.assignable(invalid, 0), false);
    assert.equal(system.value.assignable(0, invalid), false);
  }
});

test("field proofs reuse completed scalar relations across distinct outer objects", () => {
  const originalPush = Array.prototype.push;
  let reads = 0;
  Array.prototype.push = function (...items: unknown[]) {
    for (const item of items)
      if (
        typeof item === "object" &&
        item !== null &&
        "kind" in item &&
        item.kind === "literal" &&
        "value" in item &&
        item.value === "shared-field"
      )
        Object.defineProperty(item, "kind", {
          configurable: true,
          get() {
            reads++;
            return "literal";
          },
        });
    return Reflect.apply(originalPush, this, items);
  };
  try {
    const graph: Type[] = [
      { kind: "literal", value: "shared-field" },
      { kind: "string" },
      {
        kind: "object",
        properties: [{ name: "field", type: 1, readonly: true }],
      },
    ];
    for (let i = 0; i < 8; i++)
      graph.push({
        kind: "object",
        properties: [{ name: "field", type: 0, readonly: true }],
      });
    const system = createTypeSystem(graph);
    assert.ok(system.ok);
    assert.equal(system.value.assignable(3, 2), true);
    reads = 0;
    for (let i = 4; i < 11; i++)
      assert.equal(system.value.assignable(i, 2), true);
    assert.equal(
      reads,
      0,
      "completed field proofs must be reused across outer object pairs",
    );
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("recursive discriminated unions retain invariant equality and reject missing variants", () => {
  const graph: Type[] = [
    { kind: "literal", value: "left" },
    { kind: "literal", value: "right" },
    { kind: "literal", value: "other" },
    { kind: "union", members: [6, 7] },
    { kind: "union", members: [9, 8] },
    { kind: "union", members: [10, 11] },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 0, readonly: true },
        { name: "next", type: 3, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 1, readonly: true },
        { name: "next", type: 3, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 0, readonly: true },
        { name: "next", type: 4, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 1, readonly: true },
        { name: "next", type: 4, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 0, readonly: true },
        { name: "next", type: 5, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [
        { name: "kind", type: 2, readonly: true },
        { name: "next", type: 5, readonly: true },
      ],
    },
    {
      kind: "object",
      properties: [{ name: "value", type: 3, readonly: false }],
    },
    {
      kind: "object",
      properties: [{ name: "value", type: 4, readonly: false }],
    },
    {
      kind: "object",
      properties: [{ name: "value", type: 5, readonly: false }],
    },
  ];
  const made = createTypeSystem(graph);
  assert.ok(made.ok);
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal(made.value.assignable(12, 13), true);
    assert.equal(made.value.assignable(13, 12), true);
    assert.equal(made.value.assignable(12, 14), false);
    assert.equal(made.value.assignable(14, 13), false);
  }
});

test("tagged union shortcuts preserve duplicate tags, absent tags and unknown shapes", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "string" },
    { kind: "literal", value: "a" },
    { kind: "literal", value: "b" },
    { kind: "literal", value: "missing" },
  ];
  for (const tag of [2, 3, 4]) {
    for (const payload of [0, 1]) {
      graph.push({
        kind: "object",
        properties: [
          { name: "kind", type: tag, readonly: true },
          { name: "payload", type: payload, readonly: true },
        ],
      });
    }
  }
  graph.push({
    kind: "object",
    properties: [{ name: "kind", type: 2, readonly: true, optional: true }],
  });
  graph.push({
    kind: "object",
    properties: [{ name: "kind", type: 1, readonly: true }],
  });
  graph.push({ kind: "union", members: [5, 7, 6, 8] });
  graph.push({ kind: "union", members: [5, 11] });
  graph.push({ kind: "union", members: [5, 12] });
  const made = createTypeSystem(graph);
  assert.ok(made.ok);
  const wrapped = graph.map((_, element) => {
    const result = made.value.append({
      kind: "array",
      element,
      readonly: true,
    });
    assert.ok(result.ok);
    return result.value;
  });
  for (let source = 0; source < graph.length; source++)
    for (let target = 13; target < graph.length; target++)
      assert.equal(
        made.value.assignable(source, target),
        made.value.assignable(wrapped[source]!, wrapped[target]!),
        `${source} -> ${target}`,
      );
});
test("exact shapes agree for exactly related types and separate deep instantiations", () => {
  const mutable = (name: string, type: number) => ({
    name,
    type,
    readonly: false,
  });
  const graph: Type[] = [
    { kind: "number" }, // 0
    { kind: "undefined" }, // 1
    { kind: "string" }, // 2
    { kind: "union", members: [0, 1] }, // 3
    { kind: "union", members: [1, 0] }, // 4: 3 reordered
    {
      kind: "object",
      properties: [mutable("a", 0), { name: "b", type: 2, readonly: true }],
    }, // 5
    {
      kind: "object",
      properties: [{ name: "b", type: 2, readonly: true }, mutable("a", 0)],
    }, // 6: 5 reordered
    { kind: "function", parameters: [0], result: 0 }, // 7
    { kind: "object", properties: [], call: 7 }, // 8: callable view of 7
    { kind: "object", properties: [mutable("e0", 11), mutable("c0", 10)] }, // 9: node of numbers
    { kind: "union", members: [9, 1] }, // 10
    { kind: "union", members: [0, 1] }, // 11
    { kind: "object", properties: [mutable("e0", 14), mutable("c0", 13)] }, // 12: node of strings
    { kind: "union", members: [12, 1] }, // 13
    { kind: "union", members: [2, 1] }, // 14
    { kind: "object", properties: [mutable("c0", 16), mutable("e0", 17)] }, // 15: another node of numbers
    { kind: "union", members: [1, 15] }, // 16
    { kind: "union", members: [1, 0] }, // 17
    { kind: "literal", value: 1 }, // 18
    { kind: "literal", value: "1" }, // 19
    { kind: "array", element: 0, readonly: false }, // 20
    { kind: "array", element: 0, readonly: true }, // 21
  ];
  const created = createTypeSystem(graph);
  assert.ok(created.ok);
  const t = created.value;
  assert.equal(t.exactShape(3), t.exactShape(4));
  assert.equal(t.exactShape(5), t.exactShape(6));
  assert.equal(t.exactShape(7), t.exactShape(8));
  assert.equal(t.exactShape(9), t.exactShape(15));
  assert.notEqual(t.exactShape(9), t.exactShape(12));
  assert.notEqual(t.exactShape(10), t.exactShape(13));
  assert.notEqual(t.exactShape(0), t.exactShape(2));
  assert.notEqual(t.exactShape(18), t.exactShape(19));
  assert.notEqual(t.exactShape(20), t.exactShape(21));
  // A mutable property relates its types exactly: whenever one wrapper is
  // assignable to another, the wrapped types must share an exact shape.
  const wrappers: number[] = [];
  for (let id = 0; id < graph.length; id++) {
    const wrapped = t.append({
      kind: "object",
      properties: [mutable("x", id)],
    });
    assert.ok(wrapped.ok);
    wrappers.push(wrapped.value);
  }
  let related = 0;
  for (let a = 0; a < graph.length; a++)
    for (let b = 0; b < graph.length; b++) {
      const wa = wrappers[a] ?? -1,
        wb = wrappers[b] ?? -1;
      if (!t.assignable(wa, wb)) continue;
      related++;
      assert.equal(t.exactShape(a), t.exactShape(b), `${a} ~ ${b}`);
    }
  assert.ok(related > graph.length, "pairs beyond identity relate exactly");
});
test("duplicate property names are invalid in small and wide object types", () => {
  const field = (name: string) => ({ name, type: 0, readonly: false });
  for (const width of [2, 9, 32, 33, 40]) {
    const names = Array.from({ length: width }, (_, i) => "p" + i);
    const unique = createTypeSystem([
      { kind: "number" },
      { kind: "object", properties: names.map(field) },
    ]);
    assert.ok(unique.ok, `unique ${width}`);
    const created = unique.value;
    for (const at of [1, width - 1]) {
      const repeated = names.map((name, i) => (i === at ? "p0" : name));
      const duplicated = createTypeSystem([
        { kind: "number" },
        { kind: "object", properties: repeated.map(field) },
      ]);
      assert.deepEqual(
        duplicated,
        { ok: false, error: "INVALID_TYPE" },
        `duplicate at ${at} of ${width}`,
      );
      assert.equal(
        created.append({ kind: "object", properties: repeated.map(field) }).ok,
        false,
      );
    }
  }
});
