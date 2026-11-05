import assert from "node:assert/strict";
import test from "node:test";
import { readPosixTimeZone } from "../src/chrono/tzif/posix.ts";
test("fixed POSIX zones invert the offset sign and retain quoted names", () => {
  assert.deepEqual(readPosixTimeZone("UTC0"), {
    ok: true,
    value: { kind: "fixed", name: "UTC", offsetSeconds: 0 },
  });
  assert.deepEqual(readPosixTimeZone("<+0545>-5:45"), {
    ok: true,
    value: { kind: "fixed", name: "+0545", offsetSeconds: 20700 },
  });
});
test("explicit DST rules preserve independent offsets and transition coordinates", () => {
  const read = readPosixTimeZone("EST5EDT,M3.2.0,M11.1.0");
  assert.ok(read.ok);
  if (!read.ok || read.value.kind !== "alternating") return;
  assert.equal(read.value.standardOffsetSeconds, -18000);
  assert.equal(read.value.daylightOffsetSeconds, -14400);
  assert.deepEqual(read.value.start, {
    date: { kind: "month-week-day", month: 3, week: 2, weekday: 0 },
    seconds: 7200,
  });
  assert.deepEqual(read.value.end, {
    date: { kind: "month-week-day", month: 11, week: 1, weekday: 0 },
    seconds: 7200,
  });
  const negative = readPosixTimeZone("IST-1GMT0,M10.5.0,M3.5.0/1");
  assert.ok(negative.ok);
  if (!negative.ok || negative.value.kind !== "alternating") return;
  assert.equal(negative.value.standardOffsetSeconds, 3600);
  assert.equal(negative.value.daylightOffsetSeconds, 0);
});
test("Julian and ordinal rules remain distinct and extended times require opt-in", () => {
  const text = "<-03>3<-02>,J60/-2,365/167:59:59";
  assert.equal(readPosixTimeZone(text).ok, false);
  const read = readPosixTimeZone(text, true);
  assert.ok(read.ok);
  if (!read.ok || read.value.kind !== "alternating") return;
  assert.deepEqual(read.value.start, {
    date: { kind: "julian", day: 60 },
    seconds: -7200,
  });
  assert.deepEqual(read.value.end, {
    date: { kind: "ordinal", day: 365 },
    seconds: 604799,
  });
});
test("missing default DST rules are explicitly unsupported; malformed text is invalid", () => {
  assert.deepEqual(readPosixTimeZone("EST5EDT"), {
    ok: false,
    error: "DEFAULT_RULES_UNSUPPORTED",
  });
  for (const text of [
    "",
    "UT0",
    "<>0",
    "<A+>0",
    "UTC",
    "UTC25",
    "UTC0junk",
    "UTC0DST,M0.1.0,M11.1.0",
    "UTC0DST,M3.6.0,M11.1.0",
    "UTC0DST,J0,J365",
    "UTC0DST,J366,J1",
    "UTC0DST,366,0",
    "UTC0DST,M3.2.7,M11.1.0",
    "UTC0DST,0/168,365",
    "UTC0DST,0/2:60,365",
    "UTC0DST,0,365tail",
  ])
    assert.equal(readPosixTimeZone(text, true).ok, false, text);
});
