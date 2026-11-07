import assert from "node:assert/strict";
import test from "node:test";
import * as tz from "../src/chrono/tzif/index.ts";
import { fixed, transitions } from "./tzif-fixtures.ts";
function posix(text: string) {
  const result = tz.readPosixTimeZone(text, true);
  assert.ok(result.ok);
  return result.value;
}
test("daylight status follows transition identity even for equal or negative offsets", () => {
  for (const [text, winter, summer] of [
    ["EST5EDT,M3.2.0,M11.1.0", false, true],
    ["IST-1GMT0,M10.5.0,M3.5.0/1", true, false],
    ["AAA0BBB0,M3.2.0,M11.1.0", false, true],
  ] as const) {
    const zone = posix(text);
    assert.equal(
      tz.posixDaylightSavingAt(zone, Date.UTC(2024, 0, 1) / 1000),
      winter,
    );
    assert.equal(
      tz.posixDaylightSavingAt(zone, Date.UTC(2024, 6, 1) / 1000),
      summer,
    );
  }
  const zone = posix("EST5EDT,M3.2.0,M11.1.0");
  for (const [second, expected] of [
    [1710053999, false],
    [1710054000, true],
    [1730613599, true],
    [1730613600, false],
  ] as const)
    assert.equal(tz.posixDaylightSavingAt(zone, second), expected);
  assert.equal(
    tz.posixDaylightSavingAt(posix("UTC0"), Number.MAX_SAFE_INTEGER),
    false,
  );
  assert.equal(tz.posixDaylightSavingAt(zone, Infinity), undefined);
});
test("TZif daylight status preserves historical flags and the unavailable horizon", () => {
  const result = tz.createTzifZone(transitions(0));
  assert.ok(result.ok);
  for (const [second, expected] of [
    [-2, false],
    [-1, true],
    [999, true],
    [1000, undefined],
  ] as const)
    assert.equal(tz.tzifDaylightSavingAt(result.value, second), expected);
  const stable = tz.createTzifZone(fixed());
  assert.ok(stable.ok);
  assert.equal(tz.tzifDaylightSavingAt(stable.value, 0), false);
  assert.equal(tz.tzifDaylightSavingAt(stable.value, 0.5), undefined);
  const future = posix("AAA0BBB0,M3.2.0,M11.1.0");
  const model = { ...stable.value, future, futureStatus: "ready" as const };
  assert.equal(
    tz.tzifDaylightSavingAt(model, Date.UTC(2050, 0, 1) / 1000),
    false,
  );
  assert.equal(
    tz.tzifDaylightSavingAt(model, Date.UTC(2050, 6, 1) / 1000),
    true,
  );
});
