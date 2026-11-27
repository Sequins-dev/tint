import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  parseISODateTime,
  type ISODateTime,
} from "@tint/foundation/chrono/iso-date-time";
import {
  formatInteger,
  fromNumber,
} from "@tint/foundation/numeric/big-integer";
import { createTzifZone } from "@tint/foundation/chrono/tzif";
import * as objects from "../src/objects/index.ts";
import {
  interpretNamedZonedOffset,
  temporalStartOfDay,
} from "../src/objects/temporal-zone-local.ts";
import { interpretZonedOffset } from "../src/objects/temporal-zoned-conversion.ts";
import type { TemporalNamedTimeZone } from "../src/objects/temporal-time-zone.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = objects.createErrorRealm(
  objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
  hooks,
);
function local(text: string): ISODateTime {
  const parsed = parseISODateTime(text);
  assert.ok(parsed.value);
  return parsed.value;
}
function range(run: () => unknown) {
  assert.throws(
    run,
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "prototype" in error &&
      error.prototype === realm.prototypes.get("range"),
  );
}

test(
  "named local interpretation preserves fractions, modes and supplied-offset policies",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const zone: TemporalNamedTimeZone = {
      kind: "named",
      identifier: "America/New_York",
      primaryIdentifier: "America/New_York",
      model: model.value,
    };
    const overlap = local("2024-11-03T01:30:00.123456789");
    const early = BigInt(Date.UTC(2024, 10, 3, 5, 30)) * 1000000n + 123456789n,
      late = early + 3600000000000n;
    for (const [mode, expected] of [
      ["compatible", early],
      ["earlier", early],
      ["later", late],
    ] as const)
      assert.equal(
        formatInteger(
          interpretNamedZonedOffset(
            overlap,
            zone,
            undefined,
            "reject",
            realm,
            mode,
            false,
          ),
          10,
        ),
        String(expected),
      );
    range(() =>
      interpretNamedZonedOffset(
        overlap,
        zone,
        undefined,
        "reject",
        realm,
        "reject",
        false,
      ),
    );
    assert.equal(
      formatInteger(
        interpretNamedZonedOffset(
          overlap,
          zone,
          -18000000000000,
          "prefer",
          realm,
          "reject",
          false,
        ),
        10,
      ),
      String(late),
    );
    range(() =>
      interpretNamedZonedOffset(
        overlap,
        zone,
        -21600000000000,
        "reject",
        realm,
        "compatible",
        false,
      ),
    );
    assert.equal(
      formatInteger(
        interpretNamedZonedOffset(
          overlap,
          zone,
          -21600000000000,
          "use",
          realm,
          "reject",
          false,
        ),
        10,
      ),
      String(late + 3600000000000n),
    );
    const gap = local("2024-03-10T02:30");
    assert.equal(
      formatInteger(
        interpretNamedZonedOffset(
          gap,
          zone,
          undefined,
          "ignore",
          realm,
          "earlier",
          false,
        ),
        10,
      ),
      String(BigInt(Date.UTC(2024, 2, 10, 6, 30)) * 1000000n),
    );
    assert.equal(
      formatInteger(
        interpretNamedZonedOffset(
          gap,
          zone,
          undefined,
          "ignore",
          realm,
          "compatible",
          false,
        ),
        10,
      ),
      String(BigInt(Date.UTC(2024, 2, 10, 7, 30)) * 1000000n),
    );
    range(() =>
      interpretNamedZonedOffset(
        gap,
        zone,
        undefined,
        "ignore",
        realm,
        "reject",
        false,
      ),
    );
    const historical = local("1880-01-01T00:00");
    const expected = BigInt(Date.UTC(1880, 0, 1)) * 1000000n + 17762000000000n;
    assert.equal(
      formatInteger(
        interpretNamedZonedOffset(
          historical,
          zone,
          -17760000000000,
          "reject",
          realm,
          "compatible",
          true,
        ),
        10,
      ),
      String(expected),
    );
    range(() =>
      interpretNamedZonedOffset(
        historical,
        zone,
        -17760000000000,
        "reject",
        realm,
        "compatible",
        false,
      ),
    );
  },
);

test("start of day chooses the transition when a gap straddles midnight", () => {
  const bytes = new Uint8Array(74),
    view = new DataView(bytes.buffer);
  bytes.set([84, 90, 105, 102]);
  view.setUint32(32, 2);
  view.setUint32(36, 2);
  view.setUint32(40, 8);
  view.setInt32(44, 0);
  view.setInt32(48, 100000);
  bytes[52] = 1;
  bytes[53] = 1;
  view.setInt32(54, -1800);
  view.setInt32(60, 1800);
  bytes[64] = 1;
  bytes[65] = 4;
  bytes.set([66, 69, 70, 0, 65, 70, 84, 0], 66);
  const parsed = createTzifZone(bytes);
  assert.ok(parsed.ok);
  const zone: TemporalNamedTimeZone = {
    kind: "named",
    identifier: "Test/Midnight",
    primaryIdentifier: "Test/Midnight",
    model: parsed.value,
  };
  assert.equal(
    formatInteger(
      temporalStartOfDay({ year: 1970, month: 1, day: 1 }, zone, realm),
      10,
    ),
    "0",
  );
  assert.equal(
    formatInteger(
      interpretNamedZonedOffset(
        local("1970-01-01T00:00"),
        zone,
        undefined,
        "ignore",
        realm,
        "compatible",
        false,
      ),
      10,
    ),
    "1800000000000",
  );
});

test(
  "shared zoned interpretation supports named models and exact versus minute matching",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const zone: TemporalNamedTimeZone = {
      kind: "named",
      identifier: "America/New_York",
      primaryIdentifier: "America/New_York",
      model: model.value,
    };
    const early = BigInt(Date.UTC(2024, 10, 3, 5, 30)) * 1000000n;
    assert.equal(
      formatInteger(
        objects.bigIntInteger(
          interpretZonedOffset(
            local("2024-11-03T01:30"),
            zone,
            undefined,
            "reject",
            realm,
            "later",
          ).epoch,
        ),
        10,
      ),
      String(early + 3600000000000n),
    );
    range(() =>
      interpretZonedOffset(
        local("2024-11-03T01:30"),
        zone,
        undefined,
        "reject",
        realm,
        "reject",
      ),
    );
    const historical = local("1880-01-01T00:00");
    assert.equal(
      formatInteger(
        objects.bigIntInteger(
          interpretZonedOffset(
            historical,
            zone,
            -17760000000000,
            "reject",
            realm,
            "compatible",
            true,
          ).epoch,
        ),
        10,
      ),
      String(BigInt(Date.UTC(1880, 0, 1)) * 1000000n + 17762000000000n),
    );
    range(() =>
      interpretZonedOffset(
        historical,
        zone,
        -17760000000000,
        "reject",
        realm,
        "compatible",
        false,
      ),
    );
  },
);

test(
  "zoned calendar arithmetic and day rounding follow variable day lengths",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  async () => {
    const { createDuration } =
      await import("@tint/foundation/chrono/temporal-duration");
    const { zonedDateTimeArithmetic, roundTemporalZonedDateTime } =
      await import("../src/objects/temporal-zoned-arithmetic.ts");
    const { temporalZonedData } =
      await import("../src/objects/temporal-zoned-construction.ts");
    const { createBigIntLiteral } = await import("../src/objects/bigints.ts");
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const zone: TemporalNamedTimeZone = {
      kind: "named",
      identifier: "America/New_York",
      primaryIdentifier: "America/New_York",
      model: model.value,
    };
    const oneDay = createDuration([0, 0, 0, 1]),
      oneHour = createDuration([0, 0, 0, 0, 1]),
      day = fromNumber(86400000000000),
      hour = fromNumber(3600000000000);
    assert.ok(oneDay);
    assert.ok(oneHour);
    assert.ok(day);
    assert.ok(hour);
    const value = (text: string) =>
      temporalZonedData(
        createBigIntLiteral(String(BigInt(Date.parse(text)) * 1000000n)),
        zone,
        realm,
      );
    const march9 = value("2024-03-09T12:00-05:00");
    assert.equal(
      formatInteger(
        objects.bigIntInteger(
          zonedDateTimeArithmetic(march9, oneDay, false, "constrain", realm),
        ),
        10,
      ),
      String(BigInt(Date.parse("2024-03-10T12:00-04:00")) * 1000000n),
    );
    const gap = value("2024-03-09T02:30-05:00");
    assert.equal(
      formatInteger(
        objects.bigIntInteger(
          zonedDateTimeArithmetic(gap, oneDay, false, "constrain", realm),
        ),
        10,
      ),
      String(BigInt(Date.parse("2024-03-10T03:30-04:00")) * 1000000n),
    );
    const start = value("2024-03-10T12:15-04:00");
    assert.equal(
      formatInteger(
        objects.bigIntInteger(
          roundTemporalZonedDateTime(
            start,
            { increment: day, mode: "halfExpand" },
            realm,
          ),
        ),
        10,
      ),
      String(BigInt(Date.parse("2024-03-10T00:00-05:00")) * 1000000n),
    );
    const after = value("2024-03-10T12:45-04:00");
    assert.equal(
      formatInteger(
        objects.bigIntInteger(
          roundTemporalZonedDateTime(
            after,
            { increment: day, mode: "halfExpand" },
            realm,
          ),
        ),
        10,
      ),
      String(BigInt(Date.parse("2024-03-11T00:00-04:00")) * 1000000n),
    );
    const lateFold = value("2024-11-03T01:40-05:00");
    assert.equal(
      formatInteger(
        objects.bigIntInteger(
          roundTemporalZonedDateTime(
            lateFold,
            { increment: hour, mode: "floor" },
            realm,
          ),
        ),
        10,
      ),
      String(BigInt(Date.parse("2024-11-03T01:00-05:00")) * 1000000n),
    );
  },
);

test(
  "named-zone hours in a day reflect spring and autumn transitions",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  async () => {
    const local = await import("../src/objects/temporal-zone-local.ts");
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const zone: TemporalNamedTimeZone = {
      kind: "named",
      identifier: "America/New_York",
      primaryIdentifier: "America/New_York",
      model: model.value,
    };
    assert.equal(
      local.temporalZonedHoursInDay(
        { year: 2024, month: 3, day: 10 },
        zone,
        realm,
      ),
      23,
    );
    assert.equal(
      local.temporalZonedHoursInDay(
        { year: 2024, month: 11, day: 3 },
        zone,
        realm,
      ),
      25,
    );
    assert.equal(
      local.temporalZonedHoursInDay(
        { year: 2024, month: 11, day: 4 },
        zone,
        realm,
      ),
      24,
    );
  },
);

test(
  "day rounding selects the two calendar boundaries when a date starts twice",
  { skip: !existsSync("/usr/share/zoneinfo/Antarctica/Casey") },
  async () => {
    const { temporalZonedData } =
      await import("../src/objects/temporal-zoned-construction.ts");
    const { createBigIntLiteral } = await import("../src/objects/bigints.ts");
    const { roundTemporalZonedDateTime } =
      await import("../src/objects/temporal-zoned-arithmetic.ts");
    const read = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/Antarctica/Casey")),
    );
    assert.ok(read.ok);
    const zone: TemporalNamedTimeZone = {
      kind: "named",
      identifier: "Antarctica/Casey",
      primaryIdentifier: "Antarctica/Casey",
      model: read.value,
    };
    const increment = fromNumber(86400000000000);
    assert.ok(increment);
    const epoch = (text: string) => String(BigInt(Date.parse(text)) * 1000000n);
    for (const [text, start, nearest, end] of [
      [
        "2010-03-04T23:10+11:00",
        "2010-03-04T00:00+11:00",
        "2010-03-05T00:00+11:00",
        "2010-03-05T00:00+11:00",
      ],
      [
        "2010-03-05T00:45+11:00",
        "2010-03-05T00:00+11:00",
        "2010-03-05T00:00+11:00",
        "2010-03-06T00:00+08:00",
      ],
      [
        "2010-03-04T23:10+08:00",
        "2010-03-04T00:00+11:00",
        "2010-03-05T00:00+11:00",
        "2010-03-05T00:00+11:00",
      ],
      [
        "2010-03-05T00:45+08:00",
        "2010-03-05T00:00+11:00",
        "2010-03-05T00:00+11:00",
        "2010-03-06T00:00+08:00",
      ],
    ] as const) {
      const value = temporalZonedData(
        createBigIntLiteral(epoch(text)),
        zone,
        realm,
      );
      for (const mode of [
        "floor",
        "trunc",
        "ceil",
        "expand",
        "halfCeil",
        "halfFloor",
        "halfExpand",
        "halfTrunc",
        "halfEven",
      ] as const) {
        const expected =
          mode === "floor" || mode === "trunc"
            ? start
            : mode === "ceil" || mode === "expand"
              ? end
              : nearest;
        assert.equal(
          formatInteger(
            objects.bigIntInteger(
              roundTemporalZonedDateTime(value, { increment, mode }, realm),
            ),
            10,
          ),
          epoch(expected),
          text + " " + mode,
        );
      }
    }
  },
);
