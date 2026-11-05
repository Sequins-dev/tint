import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/chrono/gregorian-calendar/index.ts";
import type { GregorianDate } from "../src/chrono/gregorian-calendar/index.ts";
const date = (year: number, month: number, day: number): GregorianDate => ({
  year,
  month,
  day,
});
test("calendar differences keep unregulated anniversary comparisons separate from final constraining", () => {
  assert.equal(typeof calendar.differenceGregorianDates, "function");
  for (const [one, two, unit, expected] of [
    [date(2021, 1, 31), date(2021, 2, 28), "month", [0, 0, 0, 28]],
    [date(2021, 3, 31), date(2021, 2, 28), "month", [0, -1, 0, 0]],
    [date(2020, 2, 29), date(2021, 2, 28), "year", [0, 11, 0, 30]],
    [date(2020, 2, 29), date(2021, 3, 28), "year", [1, 0, 0, 28]],
    [date(2021, 1, 8), date(2021, 1, 1), "week", [0, 0, -1, 0]],
  ] as const) {
    const result = calendar.differenceGregorianDates(one, two, unit);
    assert.ok(result);
    assert.deepEqual(
      [result.years, result.months, result.weeks, result.days],
      expected,
    );
    for (const value of Object.values(result))
      assert.equal(Object.is(value, -0), false);
  }
});
test("calendar difference fields add back across a complete Gregorian cycle and extreme endpoints", () => {
  for (let day = -25567; day < -25567 + 146097; day += 137) {
    const one = calendar.gregorianFromEpochDay(day)!,
      two = calendar.gregorianFromEpochDay(day + 4367)!;
    for (const unit of ["year", "month", "week", "day"] as const)
      for (const [start, end] of [
        [one, two],
        [two, one],
      ] as const) {
        const d = calendar.differenceGregorianDates(start, end, unit);
        assert.ok(d);
        assert.deepEqual(
          calendar.addGregorianDate(
            start,
            d.years,
            d.months,
            d.weeks,
            d.days,
            "constrain",
          ),
          end,
        );
        const sign = end.year > start.year ? 1 : -1;
        if (unit === "year") assert.ok(Math.abs(d.months) < 12);
        if (unit === "year" || unit === "month") {
          // The next unregulated month anniversary must surpass the endpoint.
          const next =
            (start.year + d.years) * 12 + start.month - 1 + d.months + sign;
          const year = Math.floor(next / 12),
            month = (((next % 12) + 12) % 12) + 1;
          const candidate = year * 512 + month * 32 + start.day;
          const target = end.year * 512 + end.month * 32 + end.day;
          assert.ok(sign * (candidate - target) > 0);
        }
        for (const value of Object.values(d))
          assert.ok(value === 0 || Math.sign(value) === sign);
      }
  }
  const one = calendar.gregorianFromEpochDay(-100000001)!,
    two = calendar.gregorianFromEpochDay(100000001)!;
  assert.deepEqual(calendar.differenceGregorianDates(one, two, "day"), {
    years: 0,
    months: 0,
    weeks: 0,
    days: 200000002,
  });
  for (const unit of ["year", "month", "week"] as const) {
    const d = calendar.differenceGregorianDates(one, two, unit);
    assert.ok(d);
    assert.deepEqual(
      calendar.addGregorianDate(
        one,
        d.years,
        d.months,
        d.weeks,
        d.days,
        "constrain",
      ),
      two,
    );
  }
  assert.equal(
    calendar.differenceGregorianDates(date(2021, 2, 30), two, "year"),
    undefined,
  );
});
