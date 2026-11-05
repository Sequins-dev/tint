import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInteger,
  formatInteger,
} from "@tint/foundation/numeric/big-integer";
import {
  temporalEpochDateTime,
  temporalDateTimeEpoch,
  temporalDateTimeCoordinate,
  temporalEpochFromMilliseconds,
} from "../src/objects/temporal-epoch.ts";
test("Temporal epoch conversion floors negative nanoseconds and keeps exact subsecond precision", () => {
  const one = temporalEpochDateTime(parseInteger("-1", 10)!, 0)!;
  assert.deepEqual(one.date, { year: 1969, month: 12, day: 31 });
  assert.equal(one.hour, 23);
  assert.equal(one.minute, 59);
  assert.equal(one.second, 59);
  assert.equal(one.nanosecond, 999999999);
  const offset = temporalEpochDateTime(
    parseInteger("1000000000987654321", 10)!,
    3600000000000,
  )!;
  assert.deepEqual(offset.date, { year: 2001, month: 9, day: 9 });
  assert.equal(offset.hour, 2);
  assert.equal(offset.minute, 46);
  assert.equal(offset.second, 40);
  assert.equal(offset.nanosecond, 987654321);
});
test("Temporal epoch conversion checks inclusive instant limits before offset conversion", () => {
  assert.equal(
    temporalEpochDateTime(parseInteger("8640000000000000000001", 10)!, 0),
    undefined,
  );
  assert.equal(
    temporalEpochDateTime(parseInteger("-8640000000000000000001", 10)!, 0),
    undefined,
  );
  assert.deepEqual(
    temporalEpochDateTime(parseInteger("8640000000000000000000", 10)!, 0)!.date,
    { year: 275760, month: 9, day: 13 },
  );
  assert.deepEqual(
    temporalEpochDateTime(
      parseInteger("-8640000000000000000000", 10)!,
      -3600000000000,
    )!.date,
    { year: -271821, month: 4, day: 19 },
  );
});

test("Temporal epoch splitting matches independent BigInt division and Gregorian UTC fields", () => {
  let seed = 7149n;
  for (let i = 0; i < 2000; i++) {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    const ns =
      ((seed % 17000000000000000n) - 8500000000000000n) * 1000000n +
      (seed % 1000000n);
    const offsetMinutes = Number(seed % 2879n) - 1439;
    const localNs = ns + BigInt(offsetMinutes) * 60000000000n;
    let milliseconds = localNs / 1000000n;
    if (localNs % 1000000n < 0n) milliseconds--;
    const expected = new Date(Number(milliseconds));
    const actual = temporalEpochDateTime(
      parseInteger(String(ns), 10)!,
      offsetMinutes * 60000000000,
    )!;
    assert.deepEqual(actual.date, {
      year: expected.getUTCFullYear(),
      month: expected.getUTCMonth() + 1,
      day: expected.getUTCDate(),
    });
    assert.equal(actual.hour, expected.getUTCHours());
    assert.equal(actual.minute, expected.getUTCMinutes());
    assert.equal(actual.second, expected.getUTCSeconds());
    assert.equal(
      actual.nanosecond,
      Number(((localNs % 1000000000n) + 1000000000n) % 1000000000n),
    );
  }
});

test("Temporal date-time conversion preserves exact instants across positive and negative offsets", () => {
  for (const input of [
    "-8640000000000000000000",
    "8640000000000000000000",
    "-1",
    "0",
    "1",
    "1000000000987654321",
  ]) {
    const epoch = parseInteger(input, 10)!;
    for (const offset of [
      -86340000000000, -3600000000000, 0, 3600000000000, 86340000000000,
    ]) {
      const local = temporalEpochDateTime(epoch, offset)!;
      const restored = temporalDateTimeEpoch(local, offset);
      assert.ok(restored, input);
      assert.equal(formatInteger(restored, 10), input);
    }
  }
});

test("integral millisecond epochs convert exactly and reject out-of-range or fractional inputs", () => {
  for (const value of [
    -8640000000000000, -123456789, 0, 123456789, 8640000000000000,
  ]) {
    const result = temporalEpochFromMilliseconds(value);
    assert.ok(result);
    assert.equal(formatInteger(result, 10), String(BigInt(value) * 1000000n));
  }
  for (const value of [
    -8640000000000001,
    8640000000000001,
    NaN,
    Infinity,
    -Infinity,
    -0.5,
    0.5,
  ])
    assert.equal(
      temporalEpochFromMilliseconds(value),
      undefined,
      String(value),
    );
});

test("local coordinates can cross Instant bounds before applying the zone offset", () => {
  for (const [instant, offset] of [
    ["8640000000000000000000", 3600000000000],
    ["-8640000000000000000000", -3600000000000],
  ] as const) {
    const epoch = parseInteger(instant, 10)!;
    const local = temporalEpochDateTime(epoch, offset)!;
    const coordinate = temporalDateTimeCoordinate(local);
    assert.ok(coordinate);
    assert.equal(
      formatInteger(coordinate, 10),
      String(BigInt(instant) + BigInt(offset)),
    );
    assert.equal(temporalDateTimeEpoch(local, 0), undefined);
    assert.equal(
      formatInteger(temporalDateTimeEpoch(local, offset)!, 10),
      instant,
    );
  }
});
