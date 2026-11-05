import assert from "node:assert/strict";
import test from "node:test";
import * as fields from "../src/objects/temporal-date-fields.ts";
import type { TemporalDateFields } from "../src/objects/temporal-date-fields.ts";
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
function partial(overrides: Partial<TemporalDateFields>): TemporalDateFields {
  return {
    present: true,
    offsetNanoseconds: undefined,
    timeZone: undefined,
    year: undefined,
    month: undefined,
    monthCode: undefined,
    day: undefined,
    time: [],
    ...overrides,
  };
}
test("partial ISO field merging retains omitted fields and replaces the month pair together", () => {
  assert.equal(typeof fields.mergeISODateFields, "function");
  const date = { year: 2020, month: 2, day: 29 };
  for (const [supplied, expected] of [
    [partial({ year: 2021 }), { year: 2021, month: 2, day: 28 }],
    [
      partial({ monthCode: { month: 3, leap: false } }),
      { year: 2020, month: 3, day: 29 },
    ],
    [partial({ month: 4, day: 31 }), { year: 2020, month: 4, day: 30 }],
  ] as const) {
    assert.deepEqual(
      fields.regulateISODateFields(
        fields.mergeISODateFields(date, supplied),
        "constrain",
        realm,
      ),
      expected,
    );
  }
  assert.deepEqual(date, { year: 2020, month: 2, day: 29 });
});
test("merged month pairs still require agreement and reject overflow when requested", () => {
  const date = { year: 2020, month: 2, day: 29 };
  for (const supplied of [
    partial({ year: 2021 }),
    partial({ month: 3, monthCode: { month: 4, leap: false } }),
    partial({ monthCode: { month: 2, leap: true } }),
  ])
    assert.throws(() =>
      fields.regulateISODateFields(
        fields.mergeISODateFields(date, supplied),
        "reject",
        realm,
      ),
    );
});
