import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemporalObjectFixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";

type Fixture = ReturnType<typeof createTemporalObjectFixture>;

function prototypeOf(f: Fixture, name: string) {
  const temporal = f.get(f.root, "Temporal") as ObjectValue;
  const constructor = f.get(temporal, name) as ObjectValue;
  return f.get(constructor, "prototype") as ObjectValue;
}

const names = [
  "PlainDate",
  "PlainYearMonth",
  "PlainMonthDay",
  "ZonedDateTime",
] as const;

function sample(f: Fixture, name: (typeof names)[number]): ObjectValue {
  switch (name) {
    case "PlainDate":
      return f.construct(name, [2024, 2, 29]);
    case "PlainYearMonth":
      return f.construct(name, [2024, 2]);
    case "PlainMonthDay":
      return f.construct(name, [2, 29]);
    case "ZonedDateTime":
      return f.construct(name, [objects.createBigIntLiteral("0"), "UTC"]);
  }
}

for (const name of names) {
  test(
    name + " owns a non-constructable locale method with intrinsic descriptors",
    () => {
      const f = createTemporalObjectFixture();
      const prototype = prototypeOf(f, name);
      const descriptor = objects.getOwnProperty(prototype, "toLocaleString");
      assert.ok(descriptor, "toLocaleString must be an own prototype method");
      assert.equal(descriptor.writable, true);
      assert.equal(descriptor.enumerable, false);
      assert.equal(descriptor.configurable, true);
      const method = descriptor.value as ObjectValue;
      assert.equal(f.get(method, "name"), "toLocaleString");
      assert.equal(f.get(method, "length"), 0);
      assert.equal(method.internalRareSlots?.internalConstruct, undefined);
    },
  );

  test(name + " locale serialization rejects every unbranded receiver", () => {
    const f = createTemporalObjectFixture();
    const temporal = f.get(f.root, "Temporal") as ObjectValue;
    const method = f.get(prototypeOf(f, name), "toLocaleString") as ObjectValue;
    assert.ok(method.internalRareSlots?.internalCall);
    const other =
      name === "PlainDate"
        ? f.construct("PlainDateTime", [2024, 2, 29])
        : sample(f, name === "PlainYearMonth" ? "PlainMonthDay" : "PlainDate");
    // Unbranded receivers fail before any locale argument is observed.
    const poison = objects.createExoticObject(f.root, {
      get() {
        throw new Error("locales must not be read before brand validation");
      },
    });
    for (const receiver of [
      undefined,
      null,
      true,
      "",
      1,
      objects.createSymbolValue("bad"),
      objects.createBigIntLiteral("1"),
      f.bag({}),
      f.get(temporal, name),
      prototypeOf(f, name),
      other,
    ])
      assert.throws(
        () =>
          method.internalRareSlots!.internalCall!(receiver, [poison, poison]),
        (error: unknown) =>
          objects.viewObjectValue(error, f.root)?.prototype ===
          f.realm.prototypes.get("type"),
      );
  });

  test(name + " locale serialization observes locales through ECMA-402", () => {
    const f = createTemporalObjectFixture();
    const method = f.get(prototypeOf(f, name), "toLocaleString") as ObjectValue;
    assert.ok(method.internalRareSlots?.internalCall);
    const observed = new Error("locales observed");
    const locales = objects.createExoticObject(f.root, {
      get() {
        throw observed;
      },
    });
    // A branded receiver reads its locales argument (CanonicalizeLocaleList);
    // it neither ignores locale options nor falls back to toString.
    assert.throws(
      () => method.internalRareSlots!.internalCall!(sample(f, name), [locales]),
      (error: unknown) => error === observed,
    );
  });
}

test("every Temporal value prototype owns its locale method", () => {
  const f = createTemporalObjectFixture();
  for (const name of [
    "Duration",
    "Instant",
    "PlainDate",
    "PlainDateTime",
    "PlainMonthDay",
    "PlainTime",
    "PlainYearMonth",
    "ZonedDateTime",
  ])
    assert.ok(
      objects.getOwnProperty(prototypeOf(f, name), "toLocaleString"),
      name,
    );
});
