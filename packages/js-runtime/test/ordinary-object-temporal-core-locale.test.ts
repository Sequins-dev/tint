import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemporalObjectFixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";

function prototypeOf(
  f: ReturnType<typeof createTemporalObjectFixture>,
  name: string,
) {
  const temporal = f.get(f.root, "Temporal") as ObjectValue;
  const constructor = f.get(temporal, name) as ObjectValue;
  return f.get(constructor, "prototype") as ObjectValue;
}

for (const name of ["PlainDate", "ZonedDateTime"] as const) {
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
      assert.equal(method.internalConstruct, undefined);
    },
  );

  test(name + " locale serialization rejects every unbranded receiver", () => {
    const f = createTemporalObjectFixture();
    const temporal = f.get(f.root, "Temporal") as ObjectValue;
    const method = f.get(prototypeOf(f, name), "toLocaleString") as ObjectValue;
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
      f.get(temporal, name),
      prototypeOf(f, name),
      f.construct("PlainDateTime", [2024, 2, 29]),
    ])
      assert.throws(
        () => method.internalCall!(receiver, []),
        (error: unknown) =>
          objects.viewObjectValue(error, f.root)?.prototype ===
          f.realm.prototypes.get("type"),
      );
  });

  test(
    name +
      " core locale serialization ignores options and public string conversion",
    () => {
      const f = createTemporalObjectFixture();
      const method = f.get(
        prototypeOf(f, name),
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
      const examples: readonly (readonly [ObjectValue, string])[] =
        name === "PlainDate"
          ? [
              [f.construct(name, [2024, 2, 29]), "2024-02-29"],
              [f.construct(name, [0, 2, 29]), "0000-02-29"],
            ]
          : [
              [
                f.construct(name, [objects.createBigIntLiteral("0"), "UTC"]),
                "1970-01-01T00:00:00+00:00[UTC]",
              ],
              [
                f.construct(name, [objects.createBigIntLiteral("0"), "+01:00"]),
                "1970-01-01T01:00:00+01:00[+01:00]",
              ],
            ];
      for (const [value, expected] of examples) {
        assert.equal(
          objects.createDataProperty(
            value,
            "toString",
            poisonedToString,
            f.hooks,
          ),
          true,
        );
        assert.equal(method.internalCall(value, [poison, poison]), expected);
      }
    },
  );
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
