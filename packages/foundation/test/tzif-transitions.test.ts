import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import * as timezone from "../src/chrono/tzif/index.ts";
import { fixed, transitions } from "./tzif-fixtures.ts";
function query(
  epochSeconds: number,
  direction: "next" | "previous",
  inclusive = false,
) {
  return {
    epochSeconds,
    direction,
    inclusive,
    minimum: -8640000000000,
    maximum: 8640000000000,
  };
}
test(
  "transition search preserves strict boundaries and resolves future rules",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const zone = timezone.createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(zone.ok);
    const next = timezone.findTzifTransition(
      zone.value,
      query(1719792000, "next"),
    );
    assert.deepEqual(next, { ok: true, epochSeconds: 1730613600 });
    assert.deepEqual(
      timezone.findTzifTransition(zone.value, query(1719792000, "previous")),
      { ok: true, epochSeconds: 1710054000 },
    );
    assert.deepEqual(
      timezone.findTzifTransition(zone.value, query(1730613600, "next")),
      { ok: true, epochSeconds: 1741503600 },
    );
    assert.deepEqual(
      timezone.findTzifTransition(
        zone.value,
        query(1730613600, "previous", true),
      ),
      { ok: true, epochSeconds: 1730613600 },
    );
    assert.deepEqual(
      timezone.findTzifTransition(
        zone.value,
        query(Date.UTC(2050, 6, 1) / 1000, "next"),
      ),
      { ok: true, epochSeconds: Date.UTC(2050, 10, 6, 6) / 1000 },
    );
    assert.deepEqual(
      timezone.findTzifTransition(zone.value, query(8640000000000, "next")),
      { ok: true, epochSeconds: undefined },
    );
    assert.deepEqual(
      timezone.findTzifTransition(
        zone.value,
        query(-8640000000000, "previous"),
      ),
      { ok: true, epochSeconds: undefined },
    );
  },
);
test("fixed models have no transitions and unknown future horizons remain explicit", () => {
  const constant = timezone.createTzifZone(fixed()),
    recorded = timezone.createTzifZone(transitions(0));
  assert.ok(constant.ok);
  assert.ok(recorded.ok);
  assert.deepEqual(
    timezone.findTzifTransition(constant.value, query(0, "next")),
    { ok: true, epochSeconds: undefined },
  );
  assert.deepEqual(
    timezone.findTzifTransition(recorded.value, query(-2, "next")),
    { ok: true, epochSeconds: -1 },
  );
  assert.deepEqual(
    timezone.findTzifTransition(recorded.value, query(1001, "next")),
    { ok: false, error: "unavailable" },
  );
  assert.deepEqual(
    timezone.findTzifTransition(constant.value, query(NaN, "next")),
    { ok: false, error: "invalid" },
  );
});
test(
  "rule changes that preserve UTC offset are skipped",
  { skip: !existsSync("/usr/share/zoneinfo/Europe/Dublin") },
  () => {
    const zone = timezone.createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/Europe/Dublin")),
    );
    assert.ok(zone.ok);
    assert.deepEqual(
      timezone.findTzifTransition(
        zone.value,
        query(Date.UTC(1969, 0, 1) / 1000, "previous"),
      ),
      { ok: true, epochSeconds: Date.UTC(1968, 1, 18, 2) / 1000 },
    );
  },
);

test("a full repeating cycle can prove an all-year rule has no offset changes", () => {
  const base = timezone.createTzifZone(fixed()),
    future = timezone.readPosixTimeZone("XXX3EDT4,0/0,J365/23", true);
  assert.ok(base.ok);
  assert.ok(future.ok);
  const zone: timezone.TzifZone = {
    ...base.value,
    future: future.value,
    futureStatus: "ready",
  };
  assert.deepEqual(
    timezone.findTzifTransition(zone, query(1719792000, "next")),
    { ok: true, epochSeconds: undefined },
  );
  assert.deepEqual(
    timezone.findTzifTransition(zone, query(1719792000, "previous")),
    { ok: true, epochSeconds: undefined },
  );
});

test("an unspecified future cannot establish absence of transitions", () => {
  const base = timezone.createTzifZone(fixed()),
    future = timezone.readPosixTimeZone("<-00>0");
  assert.ok(base.ok);
  assert.ok(future.ok);
  const zone: timezone.TzifZone = {
    ...base.value,
    future: future.value,
    futureStatus: "ready",
  };
  assert.deepEqual(timezone.findTzifTransition(zone, query(0, "next")), {
    ok: false,
    error: "unavailable",
  });
  assert.deepEqual(
    timezone.findTzifTransition(
      { ...zone, unspecifiedOffsetPolicy: "stored" },
      query(0, "next"),
    ),
    { ok: true, epochSeconds: undefined },
  );
});
