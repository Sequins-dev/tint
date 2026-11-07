import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/objects/calendar.ts";
import { createTemporalObjectFixture as fixture } from "./ordinary-object-temporal-fixture.ts";
import { epochDayFromGregorianCoordinate } from "@tint/foundation/chrono/gregorian-calendar";

test("Hebrew postponements preserve all fourteen valid keviah patterns", () => {
  const valid = new Set([
    "2D3",
    "2C5",
    "2D5",
    "2C7",
    "3R5",
    "3R7",
    "5R7",
    "5C1",
    "5D1",
    "5C3",
    "7D1",
    "7C3",
    "7D3",
    "7C5",
  ]);
  for (let year = 3700; year <= 5800; year++) {
    const first = calendar.calendarDateAt("hebrew", year, 1, 1)!;
    const pesach = calendar.calendarDateFromFields(
      "hebrew",
      { year, monthCode: { month: 7, leap: false }, day: 15 },
      "date",
      "reject",
    ).value!;
    const weekday = (date: typeof first) => {
      const epoch = epochDayFromGregorianCoordinate(
        date.year,
        date.month,
        date.day,
      )!;
      return ((((epoch + 4) % 7) + 7) % 7) + 1;
    };
    const days = calendar.calendarDaysInYear("hebrew", year)!;
    const kind = days % 10 === 3 ? "D" : days % 10 === 4 ? "R" : "C";
    const pattern = `${weekday(first)}${kind}${weekday(pesach)}`;
    assert.equal(valid.has(pattern), true, `${year}: ${pattern}`);
  }
});

test("Hebrew year 5807 starts on the correct day for string and bag conversions", () => {
  assert.deepEqual(calendar.calendarDateAt("hebrew", 5807, 1, 1), {
    year: 2046,
    month: 10,
    day: 1,
  });
  const f = fixture();
  for (const name of ["PlainDate", "PlainDateTime"]) {
    const text =
      name === "PlainDate"
        ? "2046-10-30[u-ca=hebrew]"
        : "2046-10-30T12:34[u-ca=hebrew]";
    const d = f.from(name, text);
    assert.equal(f.get(d, "year"), 5807);
    assert.equal(f.get(d, "monthCode"), "M01");
    assert.equal(f.get(d, "day"), 30);
  }
});
