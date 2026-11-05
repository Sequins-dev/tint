import { readFileSync } from "node:fs";
import { createTzifZone } from "@tint/foundation/chrono/tzif";
import { temporalZonedData } from "../src/objects/temporal-zoned-construction.ts";
import { createBigIntLiteral } from "../src/objects/bigints.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
import { durationTotal } from "../src/objects/temporal-duration-total.ts";
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
function duration(fields: readonly number[]) {
  const d = createDuration(fields);
  assert.ok(d);
  return d;
}
test("duration totals use exact uniform ratios and require calendar context", () => {
  const d = duration([0, 0, 0, 1, 12]);
  assert.equal(durationTotal(d, "hour", { kind: "none" }, realm), 36);
  assert.equal(durationTotal(d, "day", { kind: "none" }, realm), 1.5);
  assert.throws(() =>
    durationTotal(duration([1]), "day", { kind: "none" }, realm),
  );
});
test("calendar totals use the actual relative year and month lengths", () => {
  assert.equal(
    durationTotal(
      duration([1]),
      "day",
      { kind: "plain", date: { year: 2020, month: 1, day: 1 } },
      realm,
    ),
    366,
  );
  assert.equal(
    durationTotal(
      duration([1]),
      "day",
      { kind: "plain", date: { year: 2021, month: 1, day: 1 } },
      realm,
    ),
    365,
  );
  assert.equal(
    durationTotal(
      duration([0, 0, 0, 45]),
      "month",
      { kind: "plain", date: { year: 2019, month: 1, day: 1 } },
      realm,
    ),
    1.5,
  );
  assert.throws(() =>
    durationTotal(
      duration([0, 0, 0, 0, 1]),
      "hour",
      { kind: "plain", date: { year: -271821, month: 4, day: 19 } },
      realm,
    ),
  );
  assert.equal(
    durationTotal(
      duration([]),
      "hour",
      { kind: "plain", date: { year: -271821, month: 4, day: 19 } },
      realm,
    ),
    0,
  );
});

test("calendar totals reject a time component that moves beyond supported dates", () => {
  const huge = duration([0, 0, 0, 0, 0, 0, Number.MAX_SAFE_INTEGER]);
  for (const unit of ["year", "month", "week"])
    assert.throws(
      () =>
        durationTotal(
          huge,
          unit,
          { kind: "plain", date: { year: 2020, month: 1, day: 1 } },
          realm,
        ),
      unit,
    );
});

test("month-end totals shift to the interval containing the destination", () => {
  assert.equal(
    durationTotal(
      duration([0, 1, 0, 0, 10]),
      "month",
      { kind: "plain", date: { year: 2020, month: 1, day: 31 } },
      realm,
    ),
    1.0134408602150538,
  );
});

test("zoned day totals validate the next boundary even for blank durations", () => {
  const value = temporalZonedData(
    createBigIntLiteral("8639999913600000000001"),
    { kind: "fixed", identifier: "UTC", offsetNanoseconds: 0 },
    realm,
  );
  assert.throws(() =>
    durationTotal(duration([]), "day", { kind: "zoned", value }, realm),
  );
});

test("named-zone clock totals measure elapsed time across both offset changes", () => {
  const model = createTzifZone(
    new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
  );
  assert.ok(model.ok);
  const zone = {
    kind: "named" as const,
    identifier: "America/New_York",
    primaryIdentifier: "America/New_York",
    model: model.value,
  };
  for (const [epoch, hours] of [
    [BigInt(Date.UTC(2024, 2, 9, 17)) * 1000000n, 23],
    [BigInt(Date.UTC(2024, 10, 2, 16)) * 1000000n, 25],
  ] as const) {
    const value = temporalZonedData(
      createBigIntLiteral(String(epoch)),
      zone,
      realm,
    );
    assert.equal(
      durationTotal(
        duration([0, 0, 0, 1]),
        "hour",
        { kind: "zoned", value },
        realm,
      ),
      hours,
    );
    assert.equal(
      durationTotal(
        duration([0, 0, 0, 1]),
        "day",
        { kind: "zoned", value },
        realm,
      ),
      1,
    );
  }
});

test("named calendar totals divide by actual adjacent calendar endpoints", () => {
  const model = createTzifZone(
    new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
  );
  assert.ok(model.ok);
  const zone = {
    kind: "named" as const,
    identifier: "America/New_York",
    primaryIdentifier: "America/New_York",
    model: model.value,
  };
  const value = temporalZonedData(
    createBigIntLiteral(String(BigInt(Date.UTC(2024, 2, 10, 5)) * 1000000n)),
    zone,
    realm,
  );
  assert.equal(
    durationTotal(
      duration([0, 0, 0, 0, 12]),
      "day",
      { kind: "zoned", value },
      realm,
    ),
    12 / 23,
  );
  assert.equal(
    durationTotal(duration([0, 1]), "month", { kind: "zoned", value }, realm),
    1,
  );
  assert.equal(
    durationTotal(duration([1]), "year", { kind: "zoned", value }, realm),
    1,
  );
  assert.equal(
    durationTotal(duration([0, 0, 1]), "week", { kind: "zoned", value }, realm),
    1,
  );
  assert.equal(
    durationTotal(
      duration([0, 0, 0, -1]),
      "day",
      { kind: "zoned", value },
      realm,
    ),
    -1,
  );
});
