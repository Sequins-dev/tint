import assert from "node:assert/strict";
import test from "node:test";
import { parseDateText } from "../src/objects/date-parse.ts";

test("Date interchange and UTC serialization round trip across the clipped domain", () => {
  for (const value of [
    -8640000000000000, -62198755200000, -1, 0, 1, 951782400000,
    8640000000000000,
  ]) {
    const date = new Date(value);
    assert.deepEqual(parseDateText(date.toISOString()), {
      local: false,
      value,
    });
    if (value % 1000 === 0)
      assert.deepEqual(parseDateText(date.toUTCString()), {
        local: false,
        value,
      });
  }
  for (let index = 0; index < 512; index++) {
    const value = Math.trunc((index - 256) * 17000000000003);
    assert.equal(parseDateText(new Date(value).toISOString()).value, value);
  }
});
test("Date parsing distinguishes UTC dates, explicit offsets and local date-times", () => {
  for (const text of [
    "1970",
    "1970-01",
    "1970-01-01",
    "1969-12-31T24:00:00.000Z",
    "1970-01-01T01:00+01:00",
  ])
    assert.deepEqual(parseDateText(text), { local: false, value: 0 });
  assert.deepEqual(parseDateText("1970-01-01T00:00"), {
    local: true,
    value: 0,
  });
  for (const text of [
    "-000000-01-01T00:00Z",
    "2000-00-01",
    "2000-01-00",
    "2000-13-01",
    "2000-01-32",
    "2000-01-01T24:01Z",
    "2000-01-01T00:00+24:00",
    "2000-01-01T00:00:00Z[u-ca=iso8601]",
    "2000-01-01T00:00:00+00:00:01",
  ])
    assert.ok(Number.isNaN(parseDateText(text).value), text);
});

test("local serialization preserves historical second offsets in its zone label", () => {
  assert.equal(
    parseDateText("Wed Dec 31 1969 19:03:58 GMT-0456 (UTC-04:56:02)").value,
    0,
  );
  assert.equal(
    parseDateText(
      "Thu Jan 01 1970 08:00:00 GMT+0800 (Philippine Standard Time)",
    ).value,
    0,
  );
  assert.ok(
    Number.isNaN(
      parseDateText("Wed Dec 31 1969 19:03:58 GMT-0455 (UTC-04:56:02)").value,
    ),
  );
});
test("space-separated date-times use relaxed field widths like other engines (staging/sm/Date/non-iso.js)", () => {
  const local = (text: string) => {
    const parsed = parseDateText(text);
    assert.equal(parsed.local, true, text);
    return parsed.value;
  };
  const reference = local("1997-03-08T11:19:20");
  for (const text of [
    "1997-03-08 11:19:20",
    "1997-3-08 11:19:20",
    "1997-3-8 11:19:20",
    "+001997-3-8 11:19:20",
    "+001997-03-8 11:19:20",
  ])
    assert.equal(local(text), reference, text);
  assert.equal(local("1997-03-08 1:1:1"), local("1997-03-08T01:01:01"));
  assert.equal(local("1997-03-08 1:1"), local("1997-03-08T01:01"));
  assert.equal(local("1997-03-08 1:1:1.01"), local("1997-03-08T01:01:01.01"));
  assert.equal(local("1997-03-08T01:01:01.01") % 1000, 10);
  assert.equal(parseDateText("1970-01-01T00:00:00.0129Z").value, 12);
  // Offsets: Z, +-HH, +-HHMM and +-HH:MM, optionally after one space.
  for (const text of [
    "1997-03-08 11:19:10-07",
    "1997-03-08 11:19:10-0700",
    "1997-03-08 11:19:10 -07:00",
    "1997-03-08 18:19:10Z",
  ])
    assert.deepEqual(
      parseDateText(text),
      { local: false, value: Date.UTC(1997, 2, 8, 18, 19, 10) },
      text,
    );
  for (const text of [
    "1997-03-08 11",
    "1997-03-08 ",
    "1997-03-08 11:19:10-07:",
    "1997-03-08 11:19:10-071",
    "1997-03-08 11:19:10 X",
    "1997-03-08 24:01",
    "1997-03-08  11:19",
    "97-03-08 11:19",
    "1997-03-08T11:19:10-07",
    "1997-03-08T",
    "1997-3-8T11:19:20",
    "1997-03-08T1:19",
    "1997-03-08T01:01:01.",
  ])
    assert.ok(Number.isNaN(parseDateText(text).value), text);
});
