import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
import {
  configurableField,
  enumerableField,
  getField,
  valueField,
  writableField,
  type DescriptorUpdate,
} from "../src/descriptors/index.ts";

type Key = objects.ScriptPropertyKey;
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) => Reflect.apply(fn as Function, receiver, args),
};
const prototype = objects.createObject<Key, unknown>(undefined);

/** A stand-in typed record: `count: number` (writable, contract-checked) and
 * `readonly name: string`, plus an integer-like field. */
function makeView() {
  const record = { count: 1, name: "a", 1: true };
  const keys = ["count", "name", "1"];
  const access: objects.RecordViewAccess = {
    keys,
    writable: [true, false, true],
    read: (field: number) =>
      field === 0 ? record.count : field === 1 ? record.name : record[1],
    write: (field: number, value: unknown) => {
      if (field === 0) {
        if (typeof value !== "number") throw new TypeError("count: number");
        record.count = value;
      } else if (field === 2) {
        if (typeof value !== "boolean") throw new TypeError("1: boolean");
        record[1] = value;
      } else throw new Error("unreachable");
    },
  };
  const view = objects.createRecordView(prototype, record, access);
  return { record, view };
}
const receiver = (object: objects.OrdinaryObject<Key, unknown>) => ({
  value: object,
  object,
});

test("record view fields read and write the record's storage", () => {
  const { record, view } = makeView();
  assert.equal(objects.getProperty(view, "count", view, hooks), 1);
  record.count = 5;
  assert.equal(objects.getProperty(view, "count", view, hooks), 5);
  assert.equal(
    objects.setProperty(view, "count", 7, receiver(view), hooks),
    true,
  );
  assert.equal(record.count, 7);
  assert.equal(objects.typedRecordOf(view), record);
  assert.equal(objects.typedRecordOf(prototype), undefined);
});

test("contract violations throw and leave the field unchanged", () => {
  const { record, view } = makeView();
  assert.throws(
    () => objects.setProperty(view, "count", "x", receiver(view), hooks),
    TypeError,
  );
  assert.equal(record.count, 1);
});

test("readonly fields refuse writes but report the live value", () => {
  const { record, view } = makeView();
  assert.equal(
    objects.setProperty(view, "name", "b", receiver(view), hooks),
    false,
  );
  record.name = "c";
  const descriptor = objects.getOwnProperty(view, "name");
  assert.deepEqual(
    descriptor && {
      value: descriptor.value,
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
    },
    { value: "c", writable: false, enumerable: true, configurable: true },
  );
});

test("fields cannot be deleted, made accessors or reconfigured", () => {
  const { view } = makeView();
  assert.equal(objects.deleteProperty(view, "count"), false);
  const define = (fields: number, extra: object) =>
    objects.defineOwnProperty(
      view,
      "count",
      {
        fields,
        value: undefined,
        writable: true,
        get: undefined,
        set: undefined,
        enumerable: true,
        configurable: true,
        ...extra,
      } as DescriptorUpdate<unknown>,
      hooks,
    );
  assert.equal(define(getField, { get: () => 1 }), "rejected");
  assert.equal(define(enumerableField, { enumerable: false }), "rejected");
  assert.equal(define(configurableField, { configurable: false }), "rejected");
  assert.equal(define(writableField, { writable: false }), "rejected");
  assert.equal(define(valueField, { value: 9 }), "accepted");
  assert.equal(objects.getProperty(view, "count", view, hooks), 9);
});

test("other keys are ordinary expandos, enumerated after the fields", () => {
  const { record, view } = makeView();
  assert.equal(
    objects.setProperty(view, "extra", 3, receiver(view), hooks),
    true,
  );
  assert.equal(objects.setProperty(view, "0", 4, receiver(view), hooks), true);
  assert.equal("extra" in record, false);
  assert.equal(objects.deleteProperty(view, "extra"), true);
  objects.setProperty(view, "late", 5, receiver(view), hooks);
  assert.deepEqual(objects.ownKeys(view, objects.scriptPropertyKeyOrder), [
    "0",
    "1",
    "count",
    "name",
    "late",
  ]);
});
