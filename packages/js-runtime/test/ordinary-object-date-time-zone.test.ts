import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createTzifZone } from "@tint/foundation/chrono/tzif";
import * as objects from "../src/objects/index.ts";
test(
  "Date timezone hosting preserves fractions while resolving local gaps and overlaps",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const parsed = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const hooks: objects.ObjectHooks<unknown> = {
      undefinedValue: undefined,
      sameValue: Object.is,
      call: () => undefined,
    };
    const realm = objects.createErrorRealm(
      objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
      hooks,
    );
    objects.installDateTimeZone(realm, parsed.value);
    assert.equal(realm.localTimeOffsetSeconds!(1710053999), -18000);
    assert.equal(realm.localTimeOffsetSeconds!(1710054000), -14400);
    assert.equal(
      realm.localTimeToUTC!(Date.UTC(2024, 2, 10, 2, 30) + 123),
      Date.UTC(2024, 2, 10, 7, 30) + 123,
    );
    assert.equal(
      realm.localTimeToUTC!(Date.UTC(2024, 10, 3, 1, 30) + 999),
      Date.UTC(2024, 10, 3, 5, 30) + 999,
    );
    assert.equal(realm.localTimeToUTC!(-1), 17999999);
    assert.ok(Number.isNaN(realm.localTimeToUTC!(NaN)));
    assert.ok(Number.isNaN(realm.localTimeToUTC!(1e100)));
  },
);

test(
  "Date adapts unspecified prehistory using the stored offset without mutating the generic model",
  { skip: !existsSync("/usr/share/zoneinfo/America/Cambridge_Bay") },
  async () => {
    const { tzifOffsetSecondsAt } =
      await import("@tint/foundation/chrono/tzif");
    const parsed = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/Cambridge_Bay")),
    );
    assert.ok(parsed.ok);
    assert.equal(tzifOffsetSecondsAt(parsed.value, -8640000000000), undefined);
    const hooks: objects.ObjectHooks<unknown> = {
      undefinedValue: undefined,
      sameValue: Object.is,
      call: () => undefined,
    };
    const realm = objects.createErrorRealm(
      objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
      hooks,
    );
    objects.installDateTimeZone(realm, parsed.value);
    assert.equal(realm.localTimeOffsetSeconds!(-8640000000000), 0);
    assert.equal(realm.localTimeToUTC!(-8640000000000000), -8640000000000000);
    assert.equal(tzifOffsetSecondsAt(parsed.value, -8640000000000), undefined);
  },
);
