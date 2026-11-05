import { test } from "node:test";
import assert from "node:assert/strict";
import { createTypeSystem, type Type } from "../src/types/index.ts";

const version = [{ name: "version", type: 0, readonly: false }];
const types: Type[] = [
  { kind: "number" }, // 0
  { kind: "string" },
  { kind: "unknown" },
  { kind: "undefined" },
  { kind: "object", properties: [{ name: "x", type: 0, readonly: false }] }, // 4
  { kind: "function", parameters: [0], result: 1, receiver: 4 },
  { kind: "function", parameters: [0], result: 4 },
  { kind: "function", parameters: [0], result: 1 },
  { kind: "object", properties: version, construct: 6 }, // 8
  { kind: "object", properties: [], call: 5 },
  { kind: "object", properties: version, call: 7, construct: 6 },
  { kind: "object", properties: version },
  { kind: "object", properties: [], call: 7 }, // 12
  { kind: "function", parameters: [2], result: 4 },
  { kind: "object", properties: version, construct: 13 },
  { kind: "function", parameters: [0], result: 16 },
  { kind: "object", properties: [] },
  { kind: "object", properties: [], construct: 15 }, // 17
];
function system() {
  const result = createTypeSystem(types);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("object call and construct contracts are independent and preserve static properties", () => {
  const s = system();
  assert.equal(typeof s.construct, "function");
  assert.deepEqual(s.construct(8, [0]), { ok: true, value: 4 });
  assert.deepEqual(s.call(8, [0]), { ok: false, error: "TYPE_MISMATCH" });
  assert.deepEqual(s.construct(7, [0]), { ok: false, error: "TYPE_MISMATCH" });
  assert.deepEqual(s.call(10, [0]), { ok: true, value: 1 });
  assert.deepEqual(s.construct(10, [0]), { ok: true, value: 4 });
  assert.deepEqual(s.property(8, "version"), { ok: true, value: 0 });
  assert.deepEqual(s.writeProperty(8, "version", 0), { ok: true, value: 0 });
  assert.deepEqual(s.construct(8, [1]), { ok: false, error: "TYPE_MISMATCH" });
  assert.deepEqual(s.construct(8, []), { ok: false, error: "ARITY" });
  assert.deepEqual(s.construct(8, [0, 0]), { ok: false, error: "ARITY" });
  assert.deepEqual(s.construct(8, [999]), { ok: false, error: "INVALID_TYPE" });
});
test("callable object receiver contracts cannot be bypassed", () => {
  const s = system();
  assert.deepEqual(s.call(9, [0], 4), { ok: true, value: 1 });
  assert.deepEqual(s.call(9, [0]), { ok: false, error: "TYPE_MISMATCH" });
  assert.deepEqual(s.call(9, [0], 16), { ok: false, error: "TYPE_MISMATCH" });
});
test("signature relations respect capabilities, parameter variance and result variance", () => {
  const s = system();
  assert.equal(s.assignable(10, 8), true);
  assert.equal(s.assignable(8, 10), false);
  assert.equal(s.assignable(11, 8), false);
  assert.equal(s.assignable(8, 11), true);
  assert.equal(s.assignable(14, 8), true);
  assert.equal(s.assignable(8, 14), false);
  assert.equal(s.assignable(8, 17), true);
  assert.equal(s.assignable(17, 8), false);
  assert.equal(s.assignable(7, 12), true);
  assert.equal(s.assignable(12, 7), true);
  assert.equal(s.assignable(7, 8), false);
  assert.equal(s.assignable(8, 7), false);
  assert.equal(s.assignable(7, 16), true);
});
test("ordinary property construction cannot manufacture call or construct capabilities", () => {
  const s = system();
  for (const target of [8, 9, 10])
    assert.deepEqual(
      s.object(target, target === 9 ? [] : [{ name: "version", type: 0 }]),
      { ok: false, error: "TYPE_MISMATCH" },
    );
});
test("invalid signature references and construct receivers are rejected", () => {
  for (const field of ["call", "construct"] as const) {
    for (const signature of [-1, 0.5, 999, 0, 4]) {
      const candidate: Type = {
        kind: "object",
        properties: [],
        [field]: signature,
      };
      assert.deepEqual(createTypeSystem([...types, candidate]), {
        ok: false,
        error: "INVALID_TYPE",
      });
      assert.deepEqual(system().append(candidate), {
        ok: false,
        error: "INVALID_TYPE",
      });
    }
  }
  assert.deepEqual(
    createTypeSystem([
      ...types,
      { kind: "object", properties: [], construct: 5 },
    ]),
    { ok: false, error: "INVALID_TYPE" },
  );
});
test("signature identities survive append and input mutation", () => {
  const input = structuredClone(types);
  const built = createTypeSystem(input);
  assert.ok(built.ok);
  input[8] = { kind: "object", properties: [] };
  const s = built.value;
  assert.deepEqual(s.construct(8, [0]), { ok: true, value: 4 });
  const plain = s.append({ kind: "object", properties: version });
  const constructor = s.append({
    kind: "object",
    properties: version,
    construct: 6,
  });
  assert.ok(plain.ok && constructor.ok);
  assert.equal(s.assignable(plain.value, constructor.value), false);
  assert.deepEqual(s.construct(constructor.value, [0]), { ok: true, value: 4 });
});
test("mutable slots cannot erase or invent callable capabilities", () => {
  const s = system();
  const a = s.append({
    kind: "object",
    properties: [{ name: "factory", type: 8, readonly: false }],
  });
  const b = s.append({
    kind: "object",
    properties: [{ name: "factory", type: 11, readonly: false }],
  });
  assert.ok(a.ok && b.ok);
  assert.equal(s.assignable(a.value, b.value), false);
  assert.equal(s.assignable(b.value, a.value), false);
});

test("recursive factory capabilities use coinductive relations without hiding incompatible results", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "string" },
    {
      kind: "object",
      properties: [{ name: "tag", type: 0, readonly: true }],
      construct: 3,
    },
    { kind: "function", parameters: [], result: 2 },
    {
      kind: "object",
      properties: [{ name: "tag", type: 0, readonly: true }],
      construct: 5,
    },
    { kind: "function", parameters: [], result: 4 },
    {
      kind: "object",
      properties: [{ name: "tag", type: 1, readonly: true }],
      construct: 7,
    },
    { kind: "function", parameters: [], result: 6 },
    { kind: "object", properties: [], construct: 9 },
    { kind: "function", parameters: [], result: 6 },
    { kind: "object", properties: [], construct: 11 },
    { kind: "function", parameters: [], result: 2 },
  ];
  const built = createTypeSystem(graph);
  assert.ok(built.ok);
  for (let i = 0; i < 3; i++) {
    assert.equal(built.value.assignable(2, 4), true);
    assert.equal(built.value.assignable(4, 2), true);
    assert.equal(built.value.assignable(2, 6), false);
    assert.equal(built.value.assignable(8, 10), false);
    assert.equal(built.value.assignable(10, 8), false);
  }
});
