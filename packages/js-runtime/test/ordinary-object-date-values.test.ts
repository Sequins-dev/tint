import assert from "node:assert/strict";
import test from "node:test";
import {
  clipDateTime,
  dateFields,
  fullDateYear,
  makeDateTime,
} from "../src/objects/date-values.ts";

test("Date clips before truncating and canonicalizes negative zero", () => {
  for (const value of [
    -Infinity,
    Infinity,
    NaN,
    -8640000000000001,
    8640000000000001,
  ])
    assert.ok(Number.isNaN(clipDateTime(value)));
  assert.equal(clipDateTime(-0.5), 0);
  assert.equal(Object.is(clipDateTime(-0), 0), true);
  assert.equal(clipDateTime(-8640000000000000), -8640000000000000);
  assert.equal(clipDateTime(8640000000000000), 8640000000000000);
});

test("Date UTC normalization agrees with Gregorian fields and boundary carries", () => {
  for (let index = 0; index < 2048; index++) {
    const year = 1600 + (index % 401),
      month = (index % 40) - 20,
      day = (index % 140) - 70,
      hour = (index % 100) - 50,
      minute = (index % 300) - 150,
      second = (index % 200) - 100,
      millisecond = (index % 6000) - 3000;
    const value = clipDateTime(
      makeDateTime(year, month, day, hour, minute, second, millisecond),
    );
    assert.equal(
      value,
      Date.UTC(year, month, day, hour, minute, second, millisecond),
    );
    const reference = new Date(value),
      fields = dateFields(value)!;
    assert.deepEqual(fields, {
      year: reference.getUTCFullYear(),
      month: reference.getUTCMonth(),
      day: reference.getUTCDate(),
      weekday: reference.getUTCDay(),
      hour: reference.getUTCHours(),
      minute: reference.getUTCMinutes(),
      second: reference.getUTCSeconds(),
      millisecond: reference.getUTCMilliseconds(),
    });
  }
  for (const value of [-8640000000000000, -1, 0, 8640000000000000]) {
    const fields = dateFields(value)!;
    assert.equal(
      makeDateTime(
        fields.year,
        fields.month,
        fields.day,
        fields.hour,
        fields.minute,
        fields.second,
        fields.millisecond,
      ),
      value,
    );
  }
  assert.equal(fullDateYear(-0.5), 1900);
  assert.equal(fullDateYear(99.9), 1999);
  assert.equal(fullDateYear(100.1), 100.1);
  assert.equal(dateFields(NaN), undefined);
});
