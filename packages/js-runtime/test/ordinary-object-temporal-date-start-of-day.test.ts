import assert from "node:assert/strict";
import test from "node:test";
import { readTimeZoneIdentifiers } from "@tint/foundation/chrono/time-zone-identifiers";
import {
  createTemporalObjectFixture,
  objects,
} from "./ordinary-object-temporal-fixture.ts";
import type { ObjectValue } from "./ordinary-object-temporal-fixture.ts";

function midnightGap() {
  const bytes = new Uint8Array(74),
    view = new DataView(bytes.buffer);
  bytes.set([84, 90, 105, 102]);
  view.setUint32(32, 2);
  view.setUint32(36, 2);
  view.setUint32(40, 8);
  view.setInt32(44, 0);
  view.setInt32(48, 100000);
  bytes[52] = 1;
  bytes[53] = 1;
  view.setInt32(54, -1800);
  view.setInt32(60, 1800);
  bytes[64] = 1;
  bytes[65] = 4;
  bytes.set([66, 69, 70, 0, 65, 70, 84, 0], 66);
  return bytes;
}
test("PlainDate omitted plainTime uses the start-of-day transition across a midnight gap", () => {
  const f = createTemporalObjectFixture(),
    metadata = readTimeZoneIdentifiers("Z Test/Midnight 0 - X");
  assert.ok(metadata.ok);
  f.realm.namedTimeZones = objects.createNamedTimeZoneProvider(
    metadata.value,
    () => midnightGap(),
  );
  for (const calendar of ["iso8601", "gregory", "japanese"]) {
    const date = f.construct("PlainDate", [1970, 1, 1, calendar]);
    for (const input of [
      "Test/Midnight",
      f.bag({ timeZone: "Test/Midnight" }),
      f.bag({ timeZone: "Test/Midnight", plainTime: undefined }),
    ]) {
      const result = f.call(date, "toZonedDateTime", [input]) as ObjectValue;
      assert.equal(
        objects.bigIntToString(
          f.get(result, "epochNanoseconds") as objects.BigIntValue,
          10,
        ),
        "0",
      );
      assert.equal(f.get(result, "hour"), 0);
      assert.equal(f.get(result, "minute"), 30);
      assert.equal(f.get(result, "calendarId"), calendar);
    }
    const explicit = f.call(date, "toZonedDateTime", [
      f.bag({
        timeZone: "Test/Midnight",
        plainTime: f.construct("PlainTime", []),
      }),
    ]) as ObjectValue;
    assert.equal(
      objects.bigIntToString(
        f.get(explicit, "epochNanoseconds") as objects.BigIntValue,
        10,
      ),
      "1800000000000",
    );
    assert.equal(f.get(explicit, "hour"), 1);
    assert.equal(f.get(explicit, "minute"), 0);
  }
});
