import { test } from "node:test";
import assert from "node:assert/strict";
import { createTypeSystem, type Type } from "../src/types/index.ts";
const types: Type[] = [
  { kind: "number" },
  { kind: "undefined" },
  { kind: "unknown" },
  { kind: "object", properties: [{ name: "x", type: 0, readonly: true }] },
  { kind: "object", properties: [] },
  { kind: "function", parameters: [0], result: 0, receiver: 3 },
  { kind: "function", parameters: [0], result: 0, receiver: 4 },
  { kind: "function", parameters: [0], result: 0 },
  { kind: "function", parameters: [], result: 0, receiver: 1 },
];
test("receiver contracts are separate from positional arguments and checked at calls", () => {
  const result = createTypeSystem(types);
  assert.ok(result.ok);
  const system = result.value;
  assert.deepEqual(system.call(5, [0], 3), { ok: true, value: 0 });
  for (const receiver of [undefined, 0, 1, 4])
    assert.deepEqual(system.call(5, [0], receiver), {
      ok: false,
      error: "TYPE_MISMATCH",
    });
  assert.deepEqual(system.call(5, [], 3), { ok: false, error: "ARITY" });
  assert.deepEqual(system.call(8, [], 1), { ok: true, value: 0 });
  assert.deepEqual(system.call(7, [0], 4), { ok: true, value: 0 });
  assert.deepEqual(system.call(7, [0], 999), {
    ok: false,
    error: "INVALID_TYPE",
  });
});
test("receiver requirements are contravariant and cannot be erased in strict contracts", () => {
  const result = createTypeSystem(types);
  assert.ok(result.ok);
  const system = result.value;
  assert.equal(system.assignable(6, 5), true);
  assert.equal(system.assignable(5, 6), false);
  assert.equal(system.assignable(7, 5), true);
  assert.equal(system.assignable(5, 7), false);
  const a = system.append({
    kind: "function",
    parameters: [0],
    result: 0,
    receiver: 3,
  });
  assert.ok(a.ok);
  assert.equal(system.assignable(a.value, 5), true);
  assert.equal(system.assignable(5, a.value), true);
  const b = system.append({
    kind: "function",
    parameters: [0],
    result: 0,
    receiver: 2,
  });
  assert.ok(b.ok);
  assert.equal(system.assignable(5, b.value), false);
  assert.equal(system.assignable(b.value, 7), false);
});
test("invalid receiver type references are rejected", () => {
  for (const receiver of [-1, 999, 0.5])
    assert.deepEqual(
      createTypeSystem([
        { kind: "function", parameters: [], result: 0, receiver },
      ]),
      { ok: false, error: "INVALID_TYPE" },
    );
});
