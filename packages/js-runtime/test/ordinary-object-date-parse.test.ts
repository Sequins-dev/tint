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
