import type { TemporalTimeZone } from "../src/objects/temporal-time-zone.ts";
import assert from "node:assert/strict";
import test from "node:test";
import * as formatting from "../src/objects/temporal-date-time-format.ts";
import { createBigIntLiteral } from "../src/objects/bigints.ts";
import { fromNumber } from "@tint/foundation/numeric/big-integer";
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
test("zoned formatting rounds the exact epoch and independently controls zone and calendar annotations", () => {
  assert.equal(typeof formatting.formatZonedDateTime, "function");
  const increment = fromNumber(1000000000);
  assert.ok(increment);
  const epoch = createBigIntLiteral("-1"),
    zone: TemporalTimeZone = {
      kind: "fixed",
      identifier: "UTC",
      offsetNanoseconds: 0,
    };
  assert.equal(
    formatting.formatZonedDateTime(
      epoch,
      zone,
      {
        precision: { digits: 0, increment },
        mode: "trunc",
        calendarName: "auto",
        offset: "auto",
        timeZoneName: "auto",
      },
      realm,
    ),
    "1969-12-31T23:59:59+00:00[UTC]",
  );
  assert.equal(
    formatting.formatZonedDateTime(
      epoch,
      zone,
      {
        precision: { digits: 0, increment },
        mode: "ceil",
        calendarName: "critical",
        offset: "never",
        timeZoneName: "critical",
      },
      realm,
    ),
    "1970-01-01T00:00:00[!UTC][!u-ca=iso8601]",
  );
});

test("negative epoch formatting uses the positive-coordinate tie convention", () => {
  const increment = fromNumber(1000000000);
  assert.ok(increment);
  const zone: TemporalTimeZone = {
    kind: "fixed",
    identifier: "UTC",
    offsetNanoseconds: 0,
  };
  for (const [mode, second] of [
    ["halfExpand", "59"],
    ["halfTrunc", "58"],
    ["halfEven", "58"],
  ] as const)
    assert.equal(
      formatting.formatZonedDateTime(
        createBigIntLiteral("-1500000000"),
        zone,
        {
          precision: { digits: 0, increment },
          mode,
          calendarName: "always",
          offset: "never",
          timeZoneName: "never",
        },
        realm,
      ),
      `1969-12-31T23:59:${second}[u-ca=iso8601]`,
    );
});
