import assert from "node:assert/strict";
import test from "node:test";
import * as arithmetic from "../src/objects/temporal-date-arithmetic.ts";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
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
  const result = createDuration(fields);
  assert.ok(result);
  return result;
}
test("YearMonth arithmetic balances calendar units and canonicalizes the reference day", () => {
  assert.equal(typeof arithmetic.plainYearMonthArithmetic, "function");
  const date = { year: 2023, month: 1, day: 31 };
  const value = duration([1, 2]);
  assert.deepEqual(
    arithmetic.plainYearMonthArithmetic(date, value, false, "reject", realm),
    { year: 2024, month: 3, day: 1 },
  );
  assert.deepEqual(
    arithmetic.plainYearMonthArithmetic(date, value, true, "reject", realm),
    { year: 2021, month: 11, day: 1 },
  );
  assert.deepEqual(date, { year: 2023, month: 1, day: 31 });
});
test("YearMonth arithmetic rejects every lower duration unit", () => {
  assert.equal(typeof arithmetic.plainYearMonthArithmetic, "function");
  for (let index = 2; index < 10; index++) {
    const fields = new Array<number>(10).fill(0);
    fields[index] = 1;
    for (const subtract of [false, true])
      assert.throws(() =>
        arithmetic.plainYearMonthArithmetic(
          { year: 2023, month: 1, day: 1 },
          duration(fields),
          subtract,
          "constrain",
          realm,
        ),
      );
  }
});
test("YearMonth arithmetic validates its derived first day and its result", () => {
  assert.equal(typeof arithmetic.plainYearMonthArithmetic, "function");
  const zero = duration([]);
  assert.throws(() =>
    arithmetic.plainYearMonthArithmetic(
      { year: -271821, month: 4, day: 30 },
      zero,
      false,
      "constrain",
      realm,
    ),
  );
  const maximum = { year: 275760, month: 9, day: 30 };
  assert.deepEqual(
    arithmetic.plainYearMonthArithmetic(
      maximum,
      duration([0, 1]),
      true,
      "constrain",
      realm,
    ),
    { year: 275760, month: 8, day: 1 },
  );
  assert.throws(() =>
    arithmetic.plainYearMonthArithmetic(
      maximum,
      duration([0, 1]),
      false,
      "constrain",
      realm,
    ),
  );
  assert.throws(() =>
    arithmetic.plainYearMonthArithmetic(
      { year: 2000, month: 1, day: 1 },
      duration([4294967295]),
      false,
      "constrain",
      realm,
    ),
  );
});
