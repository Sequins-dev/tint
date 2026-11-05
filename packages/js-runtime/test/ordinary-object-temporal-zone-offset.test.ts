import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { parseInteger } from "@tint/foundation/numeric/big-integer";
import { createTzifZone } from "@tint/foundation/chrono/tzif";
import * as objects from "../src/objects/index.ts";
import {
  temporalTimeZoneOffsetNanoseconds,
  temporalTimeZoneOffsetText,
  temporalTimeZoneOffsetTextRounded,
  temporalTimeZonesEqual,
  type TemporalTimeZone,
} from "../src/objects/temporal-time-zone.ts";

test("zone offset formatting preserves seconds and fractional nanoseconds", () => {
  for (const [value, text] of [
    [0, "+00:00"],
    [19800000000000, "+05:30"],
    [-17762000000000, "-04:56:02"],
    [-1, "-00:00:00.000000001"],
    [1234000000, "+00:00:01.234"],
  ] as const)
    assert.equal(temporalTimeZoneOffsetText(value), text);
  const fixed: TemporalTimeZone = {
    kind: "fixed",
    identifier: "+05:30",
    offsetNanoseconds: 19800000000000,
  };
  assert.equal(
    temporalTimeZoneOffsetNanoseconds(fixed, parseInteger("-1", 10)!),
    19800000000000,
  );
});

test(
  "named offsets use the queried instant and floor subsecond negative epochs",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const zone: TemporalTimeZone = {
      kind: "named",
      identifier: "America/New_York",
      primaryIdentifier: "America/New_York",
      model: model.value,
    };
    assert.equal(
      temporalTimeZoneOffsetNanoseconds(
        zone,
        parseInteger("1710053999999999999", 10)!,
      ),
      -18000000000000,
    );
    assert.equal(
      temporalTimeZoneOffsetNanoseconds(
        zone,
        parseInteger("1710054000000000000", 10)!,
      ),
      -14400000000000,
    );
    assert.equal(
      temporalTimeZoneOffsetNanoseconds(zone, parseInteger("-1", 10)!),
      -18000000000000,
    );
  },
);

test("displayed instant offsets round to minutes with half-expand ties", () => {
  for (const [value, text] of [
    [-17762000000000, "-04:56"],
    [29999999999, "+00:00"],
    [-29999999999, "+00:00"],
    [30000000000, "+00:01"],
    [-30000000000, "-00:01"],
    [86399999999999, "+24:00"],
  ] as const)
    assert.equal(temporalTimeZoneOffsetTextRounded(value), text);
});

test(
  "time-zone equality compares primary identity while keeping UTC distinct from offsets",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const hooks: objects.ObjectHooks<unknown> = {
      undefinedValue: undefined,
      sameValue: Object.is,
      call: () => undefined,
    };
    const realm = objects.createErrorRealm(
      objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
      hooks,
    );
    const one: TemporalTimeZone = {
      kind: "named",
      identifier: "America/New_York",
      primaryIdentifier: "America/New_York",
      model: model.value,
    };
    const alias: TemporalTimeZone = { ...one, identifier: "US/Eastern" };
    const separate: TemporalTimeZone = {
      ...one,
      identifier: "Other/Country",
      primaryIdentifier: "Other/Country",
    };
    assert.equal(temporalTimeZonesEqual(one, alias, realm), true);
    assert.equal(temporalTimeZonesEqual(one, separate, realm), false);
    assert.equal(
      temporalTimeZonesEqual(
        { kind: "fixed", identifier: "UTC", offsetNanoseconds: 0 },
        { kind: "fixed", identifier: "+00:00", offsetNanoseconds: 0 },
        realm,
      ),
      false,
    );
  },
);
