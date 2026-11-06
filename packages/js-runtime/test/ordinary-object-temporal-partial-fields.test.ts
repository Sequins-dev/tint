import assert from "node:assert/strict";
import test from "node:test";
import * as partialDates from "../src/objects/temporal-partial-date-conversion.ts";
import {
  mergeISODateFields,
  type TemporalDateFields,
} from "../src/objects/temporal-date-fields.ts";
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
function fields(values: Partial<TemporalDateFields>): TemporalDateFields {
  return {
    present: true,
    offsetNanoseconds: undefined,
    timeZone: undefined,
    year: undefined,
    month: undefined,
    monthCode: undefined,
    day: undefined,
    time: [],
    ...values,
  };
}
test("partial-date regulation canonicalizes references after overflow in the supplied year", () => {
  assert.equal(typeof partialDates.regulatePartialDateFields, "function");
  assert.deepEqual(
    partialDates.regulatePartialDateFields(
      fields({ year: 2023, month: 2, day: 29 }),
      false,
      "constrain",
      realm,
    ),
    { year: 1972, month: 2, day: 28 },
  );
  assert.deepEqual(
    partialDates.regulatePartialDateFields(
      fields({ month: 2, day: 29 }),
      false,
      "reject",
      realm,
    ),
    { year: 1972, month: 2, day: 29 },
  );
  assert.deepEqual(
    partialDates.regulatePartialDateFields(
      fields({ year: -271821, month: 4 }),
      true,
      "reject",
      realm,
    ),
    { year: -271821, month: 4, day: 1 },
  );
  assert.throws(() =>
    partialDates.regulatePartialDateFields(
      fields({ year: 2023, month: 2, day: 29 }),
      false,
      "reject",
      realm,
    ),
  );
  assert.throws(() =>
    partialDates.regulatePartialDateFields(
      fields({ year: 275760, month: 10 }),
      true,
      "constrain",
      realm,
    ),
  );
});
test("partial-date merging replaces the month pair before consistency checks", () => {
  assert.equal(typeof partialDates.regulatePartialDateFields, "function");
  const base = { year: 1972, month: 2, day: 29 };
  assert.deepEqual(
    partialDates.regulatePartialDateFields(
      mergeISODateFields(
        base,
        fields({ monthCode: { month: 4, leap: false } }),
      ),
      false,
      "reject",
      realm,
    ),
    { year: 1972, month: 4, day: 29 },
  );
  assert.throws(() =>
    partialDates.regulatePartialDateFields(
      mergeISODateFields(
        base,
        fields({ month: 3, monthCode: { month: 4, leap: false } }),
      ),
      false,
      "constrain",
      realm,
    ),
  );
});
