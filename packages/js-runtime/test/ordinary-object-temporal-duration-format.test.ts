import assert from "node:assert/strict";
import test from "node:test";
import * as formatting from "../src/objects/temporal-duration-format.ts";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
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
test("duration formatting rounds exact clocks, balances up to the original largest unit, and keeps calendar prefixes", () => {
  const unit = fromNumber(1000000000);
  assert.ok(unit);
  for (const sign of [-1, 1]) {
    const value = createDuration([
      0,
      0,
      0,
      0,
      sign,
      59 * sign,
      59 * sign,
      900 * sign,
    ]);
    assert.ok(value);
    assert.equal(
      formatting.formatRoundedDuration(
        value,
        { digits: 0, increment: unit },
        "expand",
        realm,
      ),
      (sign < 0 ? "-" : "") + "PT2H0S",
    );
  }
  const seconds = createDuration([0, 0, 0, 0, 0, 0, 59, 900]);
  assert.ok(seconds);
  assert.equal(
    formatting.formatRoundedDuration(
      seconds,
      { digits: 0, increment: unit },
      "expand",
      realm,
    ),
    "PT60S",
  );
  const calendar = createDuration([1, 11, 0, 30, 23, 59, 59, 999, 999, 999]);
  assert.ok(calendar);
  const ten = fromNumber(10);
  assert.ok(ten);
  assert.equal(
    formatting.formatRoundedDuration(
      calendar,
      { digits: 8, increment: ten },
      "expand",
      realm,
    ),
    "P1Y11M31DT0.00000000S",
  );
  const negative = createDuration([0, 0, 0, 0, 0, 0, 0, -1]);
  assert.ok(negative);
  assert.equal(
    formatting.formatRoundedDuration(
      negative,
      { digits: 0, increment: unit },
      "trunc",
      realm,
    ),
    "PT0S",
  );
});
