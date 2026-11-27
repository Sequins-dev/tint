import { zonedDateTimeDifference } from "../src/objects/temporal-zoned-difference.ts";
import { zonedDateTimeArithmetic } from "../src/objects/temporal-zoned-arithmetic.ts";
import { formatInteger } from "@tint/foundation/numeric/big-integer";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTzifZone } from "@tint/foundation/chrono/tzif";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
import {
  bigIntInteger,
  createBigIntLiteral,
  type BigIntValue,
} from "../src/objects/bigints.ts";
import { temporalZonedData } from "../src/objects/temporal-zoned-construction.ts";
import * as differences from "../src/objects/temporal-zoned-calendar-difference.ts";
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
const parsed = createTzifZone(
  new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
);
assert.ok(parsed.ok);
const zone = {
  kind: "named" as const,
  identifier: "America/New_York",
  primaryIdentifier: "America/New_York",
  model: parsed.value,
};
function epochText(value: BigIntValue): string {
  const text = formatInteger(bigIntInteger(value), 10);
  assert.ok(text !== undefined);
  return text;
}
function value(iso: string) {
  return temporalZonedData(
    createBigIntLiteral(String(BigInt(Date.parse(iso)) * 1000000n)),
    zone,
    realm,
  );
}
test("named calendar differences separate local dates from exact offset-changing clock remainders", () => {
  for (const [one, two, fields] of [
    ["2024-03-09T17:00Z", "2024-03-10T16:00Z", [0, 0, 0, 1]],
    ["2024-03-09T17:00Z", "2024-03-10T15:00Z", [0, 0, 0, 0, 22]],
    ["2024-11-02T16:00Z", "2024-11-03T17:00Z", [0, 0, 0, 1]],
    ["2024-11-03T05:30Z", "2024-11-03T06:15Z", [0, 0, 0, 0, 0, 45]],
  ] as const) {
    assert.deepEqual(
      differences.unroundedZonedCalendarDifference(
        value(one),
        value(two).epoch,
        "day",
        realm,
      ),
      createDuration(fields),
    );
    assert.deepEqual(
      differences.unroundedZonedCalendarDifference(
        value(two),
        value(one).epoch,
        "day",
        realm,
      ),
      createDuration(fields.map((x) => -x)),
    );
  }
  const result = differences.unroundedZonedCalendarDifference(
    value("2024-02-09T17:00Z"),
    value("2024-03-10T16:00Z").epoch,
    "month",
    realm,
  );
  assert.deepEqual(result, createDuration([0, 1, 0, 1]));
});
test("calendar differences reconstruct endpoints across month ends and non-hour transitions", () => {
  for (const identifier of [
    "America/New_York",
    "Australia/Lord_Howe",
    "Pacific/Apia",
  ]) {
    const parsed = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/" + identifier)),
    );
    assert.ok(parsed.ok);
    const zone = {
      kind: "named" as const,
      identifier,
      primaryIdentifier: identifier,
      model: parsed.value,
    };
    for (const iso of [
      "2024-01-31T12:00Z",
      "2024-03-10T05:30Z",
      "2024-11-03T05:30Z",
      "2011-12-29T12:00Z",
      "1892-07-04T00:00Z",
    ]) {
      const origin = BigInt(Date.parse(iso)) * 1000000n;
      const one = temporalZonedData(
        createBigIntLiteral(String(origin)),
        zone,
        realm,
      );
      for (const hours of [-800, -49, -25, -1, 0, 1, 25, 49, 800]) {
        const end = createBigIntLiteral(
          String(origin + BigInt(hours) * 3600000000000n),
        );
        for (const largest of ["year", "month", "week", "day"]) {
          const duration = differences.unroundedZonedCalendarDifference(
            one,
            end,
            largest,
            realm,
          );
          const reconstructed = zonedDateTimeArithmetic(
            one,
            duration,
            false,
            "constrain",
            realm,
          );
          assert.equal(
            formatInteger(bigIntInteger(reconstructed), 10),
            formatInteger(bigIntInteger(end), 10),
            identifier + " " + iso + " " + hours + " " + largest,
          );
        }
      }
    }
  }
});
test("single-unit calendar rounding compares exact variable-day endpoints and tie parity", () => {
  const short = value("2024-03-09T17:00Z"),
    long = value("2024-11-02T16:00Z");
  for (const [origin, hours, expected] of [
    [short, 11, 0],
    [short, 12, 1],
    [long, 12, 0],
    [long, 13, 1],
  ] as const) {
    const end = createBigIntLiteral(
      String(BigInt(epochText(origin.epoch)) + BigInt(hours) * 3600000000000n),
    );
    assert.deepEqual(
      differences.roundZonedCalendarUnit(
        origin,
        end,
        "day",
        1,
        "halfExpand",
        false,
        realm,
      ),
      createDuration([0, 0, 0, expected]),
    );
  }
  const end = createBigIntLiteral(
    String(BigInt(epochText(short.epoch)) + 24n * 3600000000000n),
  );
  assert.deepEqual(
    differences.roundZonedCalendarUnit(
      short,
      end,
      "day",
      2,
      "halfExpand",
      false,
      realm,
    ),
    createDuration([0, 0, 0, 2]),
  );
  assert.deepEqual(
    differences.roundZonedCalendarUnit(
      short,
      end,
      "day",
      2,
      "ceil",
      true,
      realm,
    ),
    createDuration([]),
  );
});
test("equal named instants return zero without probing an out-of-range calendar neighbor", () => {
  const own = temporalZonedData(
    createBigIntLiteral("8640000000000000000000"),
    zone,
    realm,
  );
  assert.deepEqual(
    zonedDateTimeDifference(
      own,
      { epoch: own.epoch, zone: own.zone },
      {
        largestUnit: "day",
        smallestUnit: "day",
        increment: 1,
        mode: "halfExpand",
      },
      false,
      realm,
    ),
    createDuration([]),
  );
});
test("calendar rounding retains larger prefixes and bubbles a rounded year boundary", () => {
  const origin = value("2020-01-01T05:00Z"),
    end = value("2021-12-16T17:00Z");
  assert.deepEqual(
    differences.roundZonedCalendarUnit(
      origin,
      end.epoch,
      "month",
      1,
      "halfExpand",
      false,
      realm,
      "year",
    ),
    createDuration([2]),
  );
  const january = value("2024-01-01T05:00Z"),
    february = value("2024-02-16T05:00Z");
  assert.deepEqual(
    differences.roundZonedCalendarUnit(
      january,
      february.epoch,
      "week",
      1,
      "halfExpand",
      false,
      realm,
      "month",
    ),
    createDuration([0, 1, 2]),
  );
  const short = value("2024-03-10T05:00Z"),
    afternoon = value("2024-03-10T18:00Z");
  assert.deepEqual(
    differences.roundZonedCalendarUnit(
      short,
      afternoon.epoch,
      "day",
      1,
      "ceil",
      false,
      realm,
      "year",
    ),
    createDuration([0, 0, 0, 1]),
  );
});
