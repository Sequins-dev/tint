import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTzifZone } from "@tint/foundation/chrono/tzif";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
import { createBigIntLiteral } from "../src/objects/bigints.ts";
import { temporalZonedData } from "../src/objects/temporal-zoned-construction.ts";
import * as rounding from "../src/objects/temporal-zoned-clock-rounding.ts";
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
function value(iso: string) {
  return temporalZonedData(
    createBigIntLiteral(String(BigInt(Date.parse(iso)) * 1000000n)),
    zone,
    realm,
  );
}
test("clock rounding carries a variable-length day and rerounds the remaining clock", () => {
  const settings = {
    largestUnit: "year",
    smallestUnit: "hour",
    increment: 12,
    mode: "ceil" as const,
  };
  assert.deepEqual(
    rounding.roundZonedClockDifference(
      value("2024-03-10T05:00Z"),
      value("2024-03-10T18:00Z").epoch,
      settings,
      false,
      realm,
    ),
    createDuration([0, 0, 0, 1, 12]),
  );
  assert.deepEqual(
    rounding.roundZonedClockDifference(
      value("2024-11-03T04:00Z"),
      value("2024-11-04T05:00Z").epoch,
      settings,
      false,
      realm,
    ),
    createDuration([0, 0, 0, 1]),
  );
  assert.deepEqual(
    rounding.roundZonedClockDifference(
      value("2024-11-03T04:00Z"),
      value("2024-11-04T04:00Z").epoch,
      settings,
      false,
      realm,
    ),
    createDuration([0, 0, 0, 0, 24]),
  );
});
