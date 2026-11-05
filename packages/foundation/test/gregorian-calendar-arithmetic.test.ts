import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/chrono/gregorian-calendar/index.ts";
test("calendar addition balances months before constraining the source day", () => {
  assert.deepEqual(
    calendar.addGregorianDate(
      { year: 2020, month: 2, day: 29 },
      1,
      1,
      0,
      0,
      "reject",
    ),
    { year: 2021, month: 3, day: 29 },
  );
  assert.deepEqual(
    calendar.addGregorianDate(
      { year: 2020, month: 2, day: 29 },
      1,
      0,
      0,
      0,
      "constrain",
    ),
    { year: 2021, month: 2, day: 28 },
  );
  assert.equal(
    calendar.addGregorianDate(
      { year: 2020, month: 2, day: 29 },
      1,
      0,
      0,
      0,
      "reject",
    ),
    undefined,
  );
  assert.deepEqual(
    calendar.addGregorianDate(
      { year: 0, month: 1, day: 31 },
      0,
      -1,
      1,
      2,
      "constrain",
    ),
    { year: 0, month: 1, day: 9 },
  );
  assert.equal(
    calendar.addGregorianDate(
      { year: 2020, month: 2, day: 30 },
      0,
      0,
      0,
      0,
      "constrain",
    ),
    undefined,
  );
  assert.equal(
    calendar.addGregorianDate(
      { year: 2020, month: 2, day: 29 },
      0,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      "constrain",
    ),
    undefined,
  );
});
test("day/week addition matches integral epoch arithmetic over a 400-year cycle", () => {
  for (let epoch = -719528; epoch < -573431; epoch += 31) {
    const date = calendar.gregorianFromEpochDay(epoch)!;
    for (const days of [-400, -1, 0, 1, 400])
      assert.deepEqual(
        calendar.addGregorianDate(date, 0, 0, 2, days, "constrain"),
        calendar.gregorianFromEpochDay(epoch + 14 + days),
      );
  }
});
