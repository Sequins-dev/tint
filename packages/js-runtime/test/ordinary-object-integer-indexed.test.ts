import { test } from "node:test";
import assert from "node:assert/strict";
import * as o from "../src/objects/operations.ts";
import * as api from "../src/objects/index.ts";
import { canonicalNumericIndex } from "../src/objects/integer-index.ts";
import {
  emptyUpdate,
  valueField,
  configurableField,
  enumerableField,
  writableField,
  getField,
} from "@tint/js-runtime/descriptors";
const hooks: o.ObjectHooks<number> = {
  undefinedValue: 0,
  sameValue: Object.is,
  call: () => {
    throw new Error("unexpected call");
  },
};
function setup(mutable = true) {
  const values = [19, 23];
  let length = 2,
    conversions = 0,
    fixed = true;
  const valid = (i: number) =>
    Number.isInteger(i) && !Object.is(i, -0) && i >= 0 && i < length;
  const parent = o.createExoticObject<string, number>(undefined, {
    get: () => 99,
    hasProperty: () => true,
  });
  assert.equal(typeof api.createIntegerIndexedObject, "function");
  const object = api.createIntegerIndexedObject<string, number>(
    parent,
    {
      mutable: () => mutable,
      numericIndex: canonicalNumericIndex,
      valid,
      read: (i) => values[i]!,
      write: (i, v) => {
        conversions++;
        if (v === -1) length = 0;
        if (valid(i)) values[i] = v;
      },
      length: () => length,
      fromIndex: String,
      keyOrder: () => -1,
      canPreventExtensions: () => fixed,
    },
    hooks,
  );
  return {
    object,
    values,
    conversions: () => conversions,
    resize: (n: number) => {
      length = n;
    },
    resizable: () => {
      fixed = false;
    },
  };
}
test("integer-indexed keys terminate lookup even when invalid", () => {
  const { object } = setup();
  for (const key of ["-0", "-1", "2", "1.5", "NaN", "Infinity"]) {
    assert.equal(o.getProperty(object, key, 0, hooks), 0, key);
    assert.equal(o.hasProperty(object, key), false, key);
    assert.equal(o.getOwnProperty(object, key), undefined, key);
  }
  assert.equal(o.getProperty(object, "0", 0, hooks), 19);
  assert.equal(o.getProperty(object, "01", 0, hooks), 99);
  assert.equal(o.hasProperty(object, "ordinary"), true);
});
test("assignment coerces before bounds checks; definition validates before coercion", () => {
  const s = setup(),
    receiver = { object: s.object, value: 0 };
  assert.ok(o.setProperty(s.object, "8", 42, receiver, hooks));
  assert.equal(s.conversions(), 1);
  assert.equal(
    o.defineOwnProperty(
      s.object,
      "8",
      { ...emptyUpdate(0), fields: valueField, value: 42 },
      hooks,
    ),
    "rejected",
  );
  assert.equal(s.conversions(), 1);
  assert.ok(o.setProperty(s.object, "0", -1, receiver, hooks));
  assert.equal(s.values[0], 19);
  assert.equal(s.conversions(), 2);
  assert.deepEqual(
    o.ownKeys(s.object, () => -1),
    [],
  );
  s.resize(2);
  assert.equal(o.getProperty(s.object, "0", 0, hooks), 19);
});
test("indexed descriptors reject attribute changes and deletion despite configurable true", () => {
  const s = setup();
  assert.equal(o.getOwnProperty(s.object, "0")?.configurable, true);
  for (const field of [
    configurableField,
    enumerableField,
    writableField,
    getField,
  ])
    assert.equal(
      o.defineOwnProperty(
        s.object,
        "0",
        { ...emptyUpdate(0), fields: field },
        hooks,
      ),
      "rejected",
    );
  assert.equal(o.deleteProperty(s.object, "0"), false);
  assert.equal(o.deleteProperty(s.object, "9"), true);
  assert.equal(
    o.defineOwnProperty(
      s.object,
      "0",
      { ...emptyUpdate(0), fields: valueField, value: 42 },
      hooks,
    ),
    "accepted",
  );
  assert.equal(s.values[0], 42);
});
test("different receivers get ordinary assignment only for valid indices", () => {
  const s = setup(),
    other = o.createObject<string, number>(undefined),
    receiver = { object: other, value: 0 };
  assert.ok(o.setProperty(s.object, "0", 42, receiver, hooks));
  assert.equal(o.getOwnProperty(other, "0")?.value, 42);
  assert.equal(s.values[0], 19);
  assert.ok(o.setProperty(s.object, "9", 42, receiver, hooks));
  assert.equal(o.getOwnProperty(other, "9"), undefined);
  assert.equal(s.conversions(), 0);
});
test("ordinary keys survive resize and extensibility follows storage contract", () => {
  const s = setup();
  assert.ok(o.createDataProperty(s.object, "label", 42, hooks));
  assert.ok(o.createDataProperty(s.object, "01", 31, hooks));
  assert.deepEqual(
    o.ownKeys(s.object, () => -1),
    ["0", "1", "label", "01"],
  );
  s.resize(0);
  assert.deepEqual(
    o.ownKeys(s.object, () => -1),
    ["label", "01"],
  );
  assert.ok(o.deleteProperty(s.object, "label"));
  s.resizable();
  assert.equal(o.preventExtensions(s.object), false);
  assert.equal(s.object.extensible, true);
  const fixed = setup();
  assert.ok(o.preventExtensions(fixed.object));
  assert.equal(o.createDataProperty(fixed.object, "extra", 1, hooks), false);
});
test("indexed keys precede ordinary strings and symbols", () => {
  const symbol = Symbol("field");
  const object = api.createIntegerIndexedObject<string | symbol, number>(
    undefined,
    {
      mutable: () => true,
      numericIndex: (key) =>
        typeof key === "string" ? canonicalNumericIndex(key) : undefined,
      valid: (i) => i === 0 && !Object.is(i, -0),
      read: () => 19,
      write: () => {},
      length: () => 1,
      fromIndex: String,
      keyOrder: (key) => (typeof key === "string" ? -1 : -2),
      canPreventExtensions: () => true,
    },
    hooks,
  );
  o.createDataProperty(object, symbol, 23, hooks);
  o.createDataProperty(object, "01", 31, hooks);
  assert.deepEqual(
    o.ownKeys(object, () => -1),
    ["0", "01", symbol],
  );
  assert.equal(o.getProperty(object, symbol, 0, hooks), 23);
  assert.ok(o.setProperty(object, symbol, 42, { object, value: 0 }, hooks));
  assert.equal(o.getOwnProperty(object, symbol)?.value, 42);
});

test("immutable indexed assignment rejects every numeric key before conversion", () => {
  const s = setup(false);
  for (const key of ["0", "-0", "-1", "2", "1.5", "NaN", "Infinity"]) {
    assert.equal(
      o.setProperty(s.object, key, -1, { object: s.object, value: 0 }, hooks),
      false,
      key,
    );
    const receiver = o.createObject<string, number>(undefined);
    assert.equal(
      o.setProperty(s.object, key, -1, { object: receiver, value: 0 }, hooks),
      false,
      key,
    );
    assert.equal(o.getOwnProperty(receiver, key), undefined);
  }
  assert.equal(s.conversions(), 0);
  assert.deepEqual(s.values, [19, 23]);
  assert.ok(
    o.setProperty(s.object, "01", 42, { object: s.object, value: 0 }, hooks),
  );
  assert.equal(o.getOwnProperty(s.object, "01")?.value, 42);
});

test("immutable indexed descriptors use SameValue without writing", () => {
  const s = setup(false);
  const current = o.getOwnProperty(s.object, "0")!;
  assert.equal(current.writable, false);
  assert.equal(current.configurable, false);
  assert.equal(current.enumerable, true);
  for (const value of [19, 42]) {
    assert.equal(
      o.defineOwnProperty(
        s.object,
        "0",
        {
          ...emptyUpdate(0),
          fields: valueField,
          value,
        },
        hooks,
      ),
      value === 19 ? "accepted" : "rejected",
    );
  }
  for (const field of [configurableField, writableField]) {
    assert.equal(
      o.defineOwnProperty(
        s.object,
        "0",
        {
          ...emptyUpdate(0),
          fields: field,
          writable: true,
          configurable: true,
        },
        hooks,
      ),
      "rejected",
    );
  }
  assert.equal(
    o.defineOwnProperty(
      s.object,
      "0",
      {
        ...emptyUpdate(0),
        fields: writableField | configurableField,
      },
      hooks,
    ),
    "accepted",
  );
  assert.equal(s.conversions(), 0);
  assert.equal(o.deleteProperty(s.object, "0"), false);
});

test("immutable indexed redefinition distinguishes signed zero and accepts NaN", () => {
  const s = setup(false);
  for (const value of [NaN, -0]) {
    s.values[0] = value;
    assert.equal(
      o.defineOwnProperty(
        s.object,
        "0",
        {
          ...emptyUpdate(0),
          fields: valueField,
          value,
        },
        hooks,
      ),
      "accepted",
    );
  }
  assert.equal(
    o.defineOwnProperty(
      s.object,
      "0",
      {
        ...emptyUpdate(0),
        fields: valueField,
        value: 0,
      },
      hooks,
    ),
    "rejected",
  );
  assert.equal(s.conversions(), 0);
});
