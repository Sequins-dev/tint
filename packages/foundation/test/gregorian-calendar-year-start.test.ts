import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/chrono/gregorian-calendar/index.ts";
test("year starts support transition calculations outside the clipped date domain", () => {
  assert.equal(calendar.gregorianYearStartEpochDay(0), -719528);
  assert.equal(calendar.gregorianYearStartEpochDay(1970), 0);
  for (const year of [
    -1000000000, -1000000, -271822, -400, -1, 1, 1900, 2000, 2400, 275761,
    1000000, 1000000000,
  ]) {
    const y = BigInt(year),
      floor = (a: bigint, b: bigint) => (a >= 0n ? a / b : (a - b + 1n) / b);
    const expected =
      365n * (y - 1970n) +
      floor(y - 1969n, 4n) -
      floor(y - 1901n, 100n) +
      floor(y - 1601n, 400n);
    assert.equal(
      calendar.gregorianYearStartEpochDay(year),
      Number(expected),
      String(year),
    );
  }
  for (const year of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER])
    assert.equal(calendar.gregorianYearStartEpochDay(year), undefined);
});

test("unclipped Gregorian coordinates preserve API range checks separately", () => {
  for (const year of [-1000000000, -271822, 1970, 275762, 1000000000]) {
    const day = calendar.gregorianYearStartEpochDay(year)!;
    assert.deepEqual(calendar.gregorianCoordinateFromEpochDay(day), {
      year,
      month: 1,
      day: 1,
    });
    assert.deepEqual(calendar.gregorianCoordinateFromEpochDay(day + 58), {
      year,
      month: 2,
      day: 28,
    });
  }
  for (const day of [-100000002, 100000002]) {
    assert.ok(calendar.gregorianCoordinateFromEpochDay(day));
    assert.equal(calendar.gregorianFromEpochDay(day), undefined);
  }
  for (const day of [
    NaN,
    Infinity,
    -Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER,
  ])
    assert.equal(calendar.gregorianCoordinateFromEpochDay(day), undefined);
});
