import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const { canonicalTemporalCalendar } =
  await import("../src/objects/temporal-coercion.ts");
const { createErrorRealm, createObject, viewObjectValue } =
  await import("../src/objects/index.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
test("calendar aliases use the pinned Intl canonical identifiers after ASCII case folding", () => {
  for (const [source, expected] of [
    ["islamicc", "islamic-civil"],
    ["IsLaMiCc", "islamic-civil"],
    ["ethiopic-amete-alem", "ethioaa"],
    ["ETHIOPIC-AMETE-ALEM", "ethioaa"],
  ]) {
    assert.equal(canonicalTemporalCalendar(source, realm), expected);
  }
});
test("calendar alias matching preserves identifier validation boundaries", () => {
  for (const source of [
    "iso8601",
    "gregory",
    "islamic-civil",
    "ethioaa",
    "chinese",
    "dangi",
  ])
    assert.equal(
      canonicalTemporalCalendar(source.toUpperCase(), realm),
      source,
    );
  assert.equal(canonicalTemporalCalendar(undefined, realm), "iso8601");
  for (const source of [
    " islamicc",
    "islamicc ",
    "islamicc-x",
    "ethiopic-amete-alem-x",
    "gregorian",
    "",
  ])
    assert.throws(
      () => canonicalTemporalCalendar(source, realm),
      (error) =>
        viewObjectValue(error, realm.objectPrototype)?.prototype ===
        realm.prototypes.get("range"),
    );
  for (const source of [
    null,
    42,
    true,
    {
      toString() {
        throw new Error("must not coerce");
      },
    },
  ])
    assert.throws(
      () => canonicalTemporalCalendar(source, realm),
      (error) =>
        viewObjectValue(error, realm.objectPrototype)?.prototype ===
        realm.prototypes.get("type"),
    );
});
