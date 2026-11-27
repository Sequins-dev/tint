import assert from "node:assert/strict";
import test from "node:test";
import {
  readTemporalDifferenceSettings,
  balanceTemporalTimeDifference,
} from "../src/objects/temporal-time-difference.ts";
import { bigIntInteger, createBigIntLiteral } from "../src/objects/bigints.ts";
import { createObject, type ObjectHooks } from "../src/objects/operations.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
test("difference settings distinguish clock-only and calendar-capable consumers", () => {
  assert.deepEqual(
    readTemporalDifferenceSettings(undefined, "hours", "time", realm, hooks),
    {
      largestUnit: "hour",
      smallestUnit: "nanosecond",
      increment: 1,
      mode: "trunc",
    },
  );
  assert.equal(
    readTemporalDifferenceSettings(undefined, "day", "date-time", realm, hooks)
      .largestUnit,
    "day",
  );
  assert.throws(
    () =>
      readTemporalDifferenceSettings(undefined, "day", "time", realm, hooks),
    (error: unknown): boolean =>
      error !== null &&
      typeof error === "object" &&
      "prototype" in error &&
      error.prototype === realm.prototypes.get("range"),
  );
});
test("validated clock settings balance exact fields and signed rounding independently", () => {
  const settings = readTemporalDifferenceSettings(
    undefined,
    "hour",
    "time",
    realm,
    hooks,
  );
  const result = balanceTemporalTimeDifference(
    bigIntInteger(createBigIntLiteral("3661002003004")),
    settings,
    realm,
  );
  assert.deepEqual(
    [
      result.hours,
      result.minutes,
      result.seconds,
      result.milliseconds,
      result.microseconds,
      result.nanoseconds,
    ],
    [1, 1, 1, 2, 3, 4],
  );
  for (const [mode, seconds] of [
    ["floor", -2],
    ["ceil", -1],
    ["halfExpand", -2],
    ["halfTrunc", -1],
  ] as const) {
    const rounded = balanceTemporalTimeDifference(
      bigIntInteger(createBigIntLiteral("-1500000000")),
      { ...settings, largestUnit: "second", smallestUnit: "second", mode },
      realm,
    );
    assert.equal(rounded.seconds, seconds);
    assert.equal(rounded.nanoseconds, 0);
  }
});

test("pure difference normalization shares unit and increment rules with option readers", async () => {
  const { normalizeTemporalDifferenceSettings } =
    await import("../src/objects/temporal-time-difference.ts");
  assert.deepEqual(
    normalizeTemporalDifferenceSettings(
      "auto",
      "minutes",
      "hours",
      "time",
      15,
      "halfExpand",
      realm,
    ),
    {
      largestUnit: "hour",
      smallestUnit: "minute",
      increment: 15,
      mode: "halfExpand",
    },
  );
  assert.throws(() =>
    normalizeTemporalDifferenceSettings(
      "second",
      "hour",
      "hour",
      "time",
      1,
      "trunc",
      realm,
    ),
  );
  assert.throws(() =>
    normalizeTemporalDifferenceSettings(
      "hour",
      "minute",
      "hour",
      "time",
      7,
      "trunc",
      realm,
    ),
  );
  assert.throws(() =>
    normalizeTemporalDifferenceSettings(
      "day",
      "nanosecond",
      "day",
      "time",
      1,
      "trunc",
      realm,
    ),
  );
});
