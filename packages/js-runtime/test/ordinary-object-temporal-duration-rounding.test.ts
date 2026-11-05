import { temporalZonedData } from "../src/objects/temporal-zoned-construction.ts";
import { createBigIntLiteral } from "../src/objects/bigints.ts";
import assert from "node:assert/strict";
import test from "node:test";
import * as rounding from "../src/objects/temporal-duration-rounding.ts";
import {
  createDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { createErrorRealm } from "../src/objects/errors.ts";
import { createObject, type ObjectHooks } from "../src/objects/operations.ts";
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
function duration(fields: readonly number[]): Duration {
  const result = createDuration(fields);
  assert.ok(result);
  return result;
}
test("duration rounding balances exact signed clock totals and fixed-length days", () => {
  const settings = {
    largestUnit: "hour",
    smallestUnit: "minute",
    increment: 1,
    mode: "halfExpand" as const,
  };
  assert.deepEqual(
    rounding.roundDuration(
      duration([0, 0, 0, 0, 1, 59, 31]),
      settings,
      { kind: "none" },
      realm,
    ),
    duration([0, 0, 0, 0, 2]),
  );
  assert.deepEqual(
    rounding.roundDuration(
      duration([0, 0, 0, 0, -1, -59, -31]),
      settings,
      { kind: "none" },
      realm,
    ),
    duration([0, 0, 0, 0, -2]),
  );
  assert.deepEqual(
    rounding.roundDuration(
      duration([0, 0, 0, 1, 23, 59, 31]),
      { ...settings, largestUnit: "day" },
      { kind: "none" },
      realm,
    ),
    duration([0, 0, 0, 2]),
  );
  assert.throws(() =>
    rounding.roundDuration(duration([1]), settings, { kind: "none" }, realm),
  );
});
test("plain-relative duration rounding uses calendar endpoints and fractional days", () => {
  const settings = {
    largestUnit: "month",
    smallestUnit: "day",
    increment: 1,
    mode: "halfExpand" as const,
  };
  assert.deepEqual(
    rounding.roundDuration(
      duration([0, 1, 0, 14, 12]),
      settings,
      { kind: "plain", date: { year: 2020, month: 1, day: 1 } },
      realm,
    ),
    duration([0, 1, 0, 15]),
  );
  assert.deepEqual(
    rounding.roundDuration(
      duration([1, 0, 0, 183]),
      { ...settings, largestUnit: "year", smallestUnit: "year" },
      { kind: "plain", date: { year: 2019, month: 1, day: 1 } },
      realm,
    ),
    duration([2]),
  );
});
test("zoned clock ties exclude retained calendar days from half-even parity", () => {
  const origin = temporalZonedData(
    createBigIntLiteral("0"),
    { kind: "fixed", identifier: "UTC", offsetNanoseconds: 0 },
    realm,
  );
  const settings = {
    largestUnit: "day",
    smallestUnit: "hour",
    increment: 8,
    mode: "halfEven" as const,
  };
  const data = duration([0, 0, 0, 3, 12]);
  assert.deepEqual(
    rounding.roundDuration(data, settings, { kind: "none" }, realm),
    duration([0, 0, 0, 3, 8]),
  );
  assert.deepEqual(
    rounding.roundDuration(
      data,
      settings,
      { kind: "plain", date: { year: 1970, month: 1, day: 1 } },
      realm,
    ),
    duration([0, 0, 0, 3, 8]),
  );
  assert.deepEqual(
    rounding.roundDuration(
      data,
      settings,
      { kind: "zoned", value: origin },
      realm,
    ),
    duration([0, 0, 0, 3, 16]),
  );
});
test("blank plain dates retain their wider bounds and zoned clock rounding validates the next day", () => {
  const settings = {
    largestUnit: "year",
    smallestUnit: "nanosecond",
    increment: 1,
    mode: "halfExpand" as const,
  };
  assert.deepEqual(
    rounding.roundDuration(
      duration([]),
      settings,
      { kind: "plain", date: { year: -271821, month: 4, day: 19 } },
      realm,
    ),
    duration([]),
  );
  const value = temporalZonedData(
    createBigIntLiteral("8640000000000000000000"),
    { kind: "fixed", identifier: "UTC", offsetNanoseconds: 0 },
    realm,
  );
  assert.throws(() =>
    rounding.roundDuration(
      duration([]),
      { ...settings, largestUnit: "day", smallestUnit: "minute" },
      { kind: "zoned", value },
      realm,
    ),
  );
});
