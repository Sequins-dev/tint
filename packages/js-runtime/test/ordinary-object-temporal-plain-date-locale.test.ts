import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemporalObjectFixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";

test("PlainDate owns a non-constructable locale method with intrinsic descriptors", () => {
  const f = createTemporalObjectFixture();
  const prototype = f.realm.temporalPlainDatePrototype;
  const descriptor = objects.getOwnProperty(prototype, "toLocaleString");
  assert.ok(descriptor, "toLocaleString must be an own prototype method");
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as ObjectValue;
  assert.equal(f.get(method, "name"), "toLocaleString");
  assert.equal(f.get(method, "length"), 0);
  assert.equal(method.internalConstruct, undefined);
});

test("PlainDate locale serialization rejects every unbranded receiver", () => {
  const f = createTemporalObjectFixture();
  const temporal = f.get(f.root, "Temporal") as ObjectValue;
  const method = f.get(
    f.realm.temporalPlainDatePrototype,
    "toLocaleString",
  ) as ObjectValue;
  assert.ok(method, "the locale method must exist");
  assert.ok(method.internalCall);
  for (const receiver of [
    undefined,
    null,
    true,
    "",
    1,
    objects.createSymbolValue("bad"),
    objects.createBigIntLiteral("1"),
    f.bag({}),
    f.get(temporal, "PlainDate"),
    f.realm.temporalPlainDatePrototype,
    f.construct("PlainDateTime", [2024, 2, 29]),
  ])
    assert.throws(
      () => method.internalCall!(receiver, []),
      (error: unknown) =>
        objects.viewObjectValue(error, f.root)?.prototype ===
        f.realm.prototypes.get("type"),
    );
});

test("PlainDate core locale serialization ignores options and public string conversion", () => {
  const f = createTemporalObjectFixture();
  const method = f.get(
    f.realm.temporalPlainDatePrototype,
    "toLocaleString",
  ) as ObjectValue;
  assert.ok(method, "the locale method must exist");
  assert.ok(method.internalCall);
  const poison = objects.createExoticObject(f.root, {
    get() {
      throw new Error("locale options must not be read without Intl");
    },
  });
  const poisonedToString = objects.createCallableObject(
    f.realm.functionPrototype,
    () => {
      throw new Error("public toString must not be called");
    },
  );
  for (const [year, expected] of [
    [2024, "2024-02-29"],
    [0, "0000-02-29"],
  ] as const) {
    const date = f.construct("PlainDate", [year, 2, 29]);
    assert.equal(
      objects.createDataProperty(date, "toString", poisonedToString, f.hooks),
      true,
    );
    assert.equal(method.internalCall(date, [poison, poison]), expected);
  }
});
