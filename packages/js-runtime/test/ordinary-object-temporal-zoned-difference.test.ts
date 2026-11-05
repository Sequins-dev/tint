import assert from "node:assert/strict";
import test from "node:test";
import * as difference from "../src/objects/temporal-zoned-difference.ts";
import { createBigIntLiteral } from "../src/objects/bigints.ts";
import { temporalZonedData } from "../src/objects/temporal-zoned-construction.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import { createObject, type ObjectHooks } from "../src/objects/operations.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
function data(text: string, offset = 0) {
  return temporalZonedData(
    createBigIntLiteral(String(BigInt(Date.parse(text)) * 1000000n)),
    {
      kind: "fixed",
      identifier: offset === 0 ? "UTC" : "+01:00",
      offsetNanoseconds: offset,
    },
    realm,
  );
}
test("fixed zones reuse civil calendar differences with exact clock remainders", () => {
  const one = data("2020-01-01T00:00Z"),
    two = data("2021-01-02T03:04:05Z");
  const settings = {
    largestUnit: "year",
    smallestUnit: "nanosecond",
    increment: 1,
    mode: "trunc" as const,
  };
  assert.deepEqual(
    difference.zonedDateTimeDifference(one, two, settings, false, realm),
    createDuration([1, 0, 0, 1, 3, 4, 5]),
  );
  assert.deepEqual(
    difference.zonedDateTimeDifference(one, two, settings, true, realm),
    createDuration([-1, 0, 0, -1, -3, -4, -5]),
  );
});
test("calendar differences require equal zone identities while clock differences do not", () => {
  const one = data("2020-01-01T00:00Z"),
    two = data("2020-01-02T01:00Z", 3600000000000);
  const settings = {
    largestUnit: "day",
    smallestUnit: "nanosecond",
    increment: 1,
    mode: "trunc" as const,
  };
  assert.throws(() =>
    difference.zonedDateTimeDifference(one, two, settings, false, realm),
  );
  assert.deepEqual(
    difference.zonedDateTimeDifference(
      one,
      two,
      { ...settings, largestUnit: "hour" },
      false,
      realm,
    ),
    createDuration([0, 0, 0, 0, 25]),
  );
});

test("zoned day rounding validates both nudge endpoints against Instant bounds", () => {
  const one = data("1970-01-01T00:00Z"),
    two = temporalZonedData(createBigIntLiteral("5"), one.zone, realm);
  const settings = {
    largestUnit: "day",
    smallestUnit: "day",
    increment: 100000001,
    mode: "trunc" as const,
  };
  assert.throws(() =>
    difference.zonedDateTimeDifference(one, two, settings, false, realm),
  );
  assert.throws(() =>
    difference.zonedDateTimeDifference(two, one, settings, false, realm),
  );
  assert.equal(
    difference.zonedDateTimeDifference(
      one,
      two,
      { ...settings, increment: 100000000, mode: "expand" },
      false,
      realm,
    ).days,
    100000000,
  );
  assert.equal(
    difference.zonedDateTimeDifference(
      two,
      one,
      { ...settings, increment: 100000000, mode: "expand" },
      false,
      realm,
    ).days,
    -100000000,
  );
});
