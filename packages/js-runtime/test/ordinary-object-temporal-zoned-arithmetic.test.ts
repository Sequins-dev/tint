import assert from "node:assert/strict";
import test from "node:test";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
import {
  formatInteger,
  fromNumber,
} from "@tint/foundation/numeric/big-integer";
import {
  zonedDateTimeArithmetic,
  roundTemporalZonedDateTime,
} from "../src/objects/temporal-zoned-arithmetic.ts";
import { temporalZonedData } from "../src/objects/temporal-zoned-construction.ts";
import { temporalTimeZoneOffsetText } from "../src/objects/temporal-time-zone.ts";
import {
  bigIntInteger,
  createBigIntLiteral,
  type BigIntValue,
} from "../src/objects/bigints.ts";
import { createObject, type ObjectHooks } from "../src/objects/operations.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
import type { TemporalZonedDateTime } from "../src/objects/temporal-zoned-date-time.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
function data(epoch: bigint, offsetNanoseconds: number): TemporalZonedDateTime {
  return temporalZonedData(
    createBigIntLiteral(String(epoch)),
    {
      kind: "fixed",
      identifier:
        offsetNanoseconds === 0
          ? "UTC"
          : temporalTimeZoneOffsetText(offsetNanoseconds),
      offsetNanoseconds,
    },
    realm,
  );
}
test("clock-only zoned arithmetic preserves nanosecond precision across offsets and epoch bounds", () => {
  const limit = 8640000000000000000000n;
  for (const offset of [
    -86340000000000, -3600000000000, 0, 19800000000000, 86340000000000,
  ])
    for (const epoch of [-limit, -1n, 0n, 1n, limit])
      for (const ns of [-1, 0, 1]) {
        const duration = createDuration([0, 0, 0, 0, 0, 0, 0, 0, 0, ns]);
        assert.ok(duration);
        for (const subtract of [false, true]) {
          const expected = epoch + BigInt(subtract ? -ns : ns);
          const run = (): BigIntValue =>
            zonedDateTimeArithmetic(
              data(epoch, offset),
              duration,
              subtract,
              "constrain",
              realm,
            );
          if (expected < -limit || expected > limit) assert.throws(run);
          else
            assert.equal(
              formatInteger(bigIntInteger(run()), 10),
              String(expected),
            );
        }
      }
});
test("calendar arithmetic precedes the exact time portion with independent overflow rejection", () => {
  const duration = createDuration([0, 1, 0, 0, 2]);
  assert.ok(duration);
  // 2020-01-31T23:30 in +05:30, then one month and two exact hours.
  const original = data(1580493600000000000n, 19800000000000);
  const result = zonedDateTimeArithmetic(
    original,
    duration,
    false,
    "constrain",
    realm,
  );
  assert.equal(formatInteger(bigIntInteger(result), 10), "1583006400000000000");
  assert.throws(() =>
    zonedDateTimeArithmetic(original, duration, false, "reject", realm),
  );
});

test("day rounding validates both bounds and uses the local day's tie origin", () => {
  const day = fromNumber(86400000000000),
    nanosecond = fromNumber(1);
  assert.ok(day);
  assert.ok(nanosecond);
  const upper = data(8640000000000000000000n, 0);
  assert.equal(
    roundTemporalZonedDateTime(
      upper,
      { increment: nanosecond, mode: "halfExpand" },
      realm,
    ),
    upper.epoch,
  );
  for (const offset of [0, -3600000000000])
    assert.throws(() =>
      roundTemporalZonedDateTime(
        data(8640000000000000000000n, offset),
        { increment: day, mode: "floor" },
        realm,
      ),
    );
  const noon = data(129600000000000n, 0);
  assert.equal(
    formatInteger(
      bigIntInteger(
        roundTemporalZonedDateTime(
          noon,
          { increment: day, mode: "halfEven" },
          realm,
        ),
      ),
      10,
    ),
    "86400000000000",
  );
  assert.equal(
    formatInteger(
      bigIntInteger(
        roundTemporalZonedDateTime(
          noon,
          { increment: day, mode: "halfExpand" },
          realm,
        ),
      ),
      10,
    ),
    "172800000000000",
  );
});
