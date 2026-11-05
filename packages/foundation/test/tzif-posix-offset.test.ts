import assert from "node:assert/strict";
import test from "node:test";
import * as timezone from "../src/chrono/tzif/index.ts";
function zone(text: string) {
  const read = timezone.readPosixTimeZone(text, true);
  assert.ok(read.ok);
  return read.value;
}
test("northern and southern rules apply new offsets at the exact UTC transition", () => {
  const ny = zone("EST5EDT,M3.2.0,M11.1.0");
  for (const [second, offset] of [
    [1710053999, -18000],
    [1710054000, -14400],
    [1730613599, -14400],
    [1730613600, -18000],
  ] as const)
    assert.equal(timezone.posixOffsetSecondsAt(ny, second), offset);
  const south = zone("AEST-10AEDT,M10.1.0,M4.1.0/3");
  for (const [second, offset] of [
    [Date.UTC(2024, 0, 1) / 1000, 39600],
    [Date.UTC(2024, 6, 1) / 1000, 36000],
    [1712419199, 39600],
    [1712419200, 36000],
    [1728143999, 36000],
    [1728144000, 39600],
  ] as const)
    assert.equal(timezone.posixOffsetSecondsAt(south, second), offset);
});
test("negative and all-year daylight saving rules do not assume a summer offset", () => {
  const ireland = zone("IST-1GMT0,M10.5.0,M3.5.0/1");
  assert.equal(
    timezone.posixOffsetSecondsAt(ireland, Date.UTC(2024, 0, 1) / 1000),
    0,
  );
  assert.equal(
    timezone.posixOffsetSecondsAt(ireland, Date.UTC(2024, 6, 1) / 1000),
    3600,
  );
  const allYear = zone("XXX3EDT4,0/0,J365/23");
  for (const second of [
    Date.UTC(2024, 0, 1) / 1000,
    Date.UTC(2024, 0, 1, 3) / 1000 - 1,
    Date.UTC(2024, 0, 1, 3) / 1000,
    Date.UTC(2024, 6, 1) / 1000,
  ])
    assert.equal(timezone.posixOffsetSecondsAt(allYear, second), -14400);
});
test("transition anchors extend beyond clipped endpoints while lookup remains explicit", () => {
  const ny = zone("EST5EDT,M3.2.0,M11.1.0");
  for (const second of [-8640000000000, 8640000000000])
    assert.equal(typeof timezone.posixOffsetSecondsAt(ny, second), "number");
  for (const second of [NaN, Infinity, 0.5, 1e16])
    assert.equal(timezone.posixOffsetSecondsAt(ny, second), undefined);
});
test("fixed offsets do not require a calendar conversion", () => {
  const fixed = zone("UTC0");
  assert.equal(
    timezone.posixOffsetSecondsAt(fixed, Number.MAX_SAFE_INTEGER),
    0,
  );
  assert.equal(
    timezone.posixOffsetSecondsAt(fixed, -Number.MAX_SAFE_INTEGER),
    0,
  );
});

test("rule lookup covers local-resolution probes just beyond calendar clipping", () => {
  const north = zone("EST5EDT,M3.2.0,M11.1.0");
  // The public calendar stays clipped. Offset probes need a small surrounding
  // window before the caller can reject an interpreted instant by its bounds.
  for (const day of [-100000003, -100000002, 100000002, 100000003]) {
    const second = day * 86400;
    const offset = timezone.posixOffsetSecondsAt(north, second);
    assert.ok(offset === -18000 || offset === -14400, String(day));
  }
  assert.equal(
    timezone.posixOffsetSecondsAt(north, 100000004 * 86400),
    undefined,
  );
});
