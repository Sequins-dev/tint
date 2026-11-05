import assert from "node:assert/strict";
import test from "node:test";
import { formatInteger } from "@tint/foundation/numeric/big-integer";
import * as objects from "../src/objects/index.ts";

test("Temporal.Now owns its tagged namespace and non-constructor instant method", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installTemporalIntrinsics(global, realm, hooks);
  const temporal = objects.getOwnProperty(global, "Temporal")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(temporal, "Now");
  assert.ok(descriptor);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  const now = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(now.prototype, realm.objectPrototype);
  const method = objects.getOwnProperty(now, "instant");
  assert.ok(method);
  const fn = method.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(fn, "name")?.value, "instant");
  assert.equal(objects.getOwnProperty(fn, "length")?.value, 0);
  assert.equal(fn.internalConstruct, undefined);
});

test("Temporal.Now.instant floors the supplied clock before exact nanosecond conversion", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected callback");
    },
  };
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installTemporalIntrinsics(global, realm, hooks);
  const temporal = objects.getOwnProperty(global, "Temporal")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const now = objects.getOwnProperty(temporal, "Now")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const instant = objects.getOwnProperty(now, "instant")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  for (const ms of [
    -1e20, -8640000000000000, -1.25, -0.25, 0, 0.75, 123456789.5,
    8640000000000000, 1e20,
  ]) {
    let reads = 0;
    realm.wallClockMilliseconds = () => {
      reads++;
      return ms;
    };
    const value = instant.internalCall!(null, []) as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(reads, 1);
    assert.equal(value.prototype, realm.temporalInstantPrototype);
    assert.ok(value.internalTemporalInstant);
    assert.equal(
      formatInteger(value.internalTemporalInstant.integer, 10),
      String(
        BigInt(
          Math.floor(
            Math.max(-8640000000000000, Math.min(8640000000000000, ms)),
          ),
        ) * 1000000n,
      ),
    );
    assert.notEqual(instant.internalCall!(undefined, []), value);
  }
});

test("Temporal.Now provides every ISO clock view using intrinsic prototypes and one clock read", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installTemporalIntrinsics(root, realm, hooks);
  const temporal = objects.getOwnProperty(root, "Temporal")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const now = objects.getOwnProperty(temporal, "Now")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  let clocks = 0,
    zones = 0;
  realm.wallClockMilliseconds = () => {
    clocks++;
    return -0.25;
  };
  realm.systemTimeZoneIdentifier = () => {
    zones++;
    return "UTC";
  };
  for (const name of [
    "timeZoneId",
    "plainDateTimeISO",
    "zonedDateTimeISO",
    "plainDateISO",
    "plainTimeISO",
  ]) {
    const descriptor = objects.getOwnProperty(now, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.writable, true);
    const fn = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "length")!.value, 0);
    assert.equal(objects.getOwnProperty(fn, "name")!.value, name);
    assert.equal(fn.internalConstruct, undefined);
    const result = fn.internalCall!(null, []);
    assert.equal(zones, 1);
    if (name === "timeZoneId") {
      assert.equal(result, "UTC");
      assert.equal(clocks, 0);
    } else {
      assert.equal(clocks, 1);
      const value = result as objects.OrdinaryObject<
        objects.ScriptPropertyKey,
        unknown
      >;
      if (name === "zonedDateTimeISO") {
        assert.equal(value.prototype, realm.temporalZonedDateTimePrototype);
        assert.equal(
          formatInteger(value.internalTemporalZonedDateTime!.epoch.integer, 10),
          "-1000000",
        );
      } else if (name === "plainDateISO") {
        assert.equal(value.prototype, realm.temporalPlainDatePrototype);
        assert.deepEqual(value.internalTemporalPlainDate, {
          year: 1969,
          month: 12,
          day: 31,
        });
      } else if (name === "plainTimeISO") {
        assert.equal(value.prototype, realm.temporalPlainTimePrototype);
        assert.equal(value.internalTemporalPlainTime!.hour, 23);
        assert.equal(value.internalTemporalPlainTime!.nanosecond, 999000000);
      } else {
        assert.equal(value.prototype, realm.temporalPlainDateTimePrototype);
        assert.equal(value.internalTemporalPlainDateTime!.date.year, 1969);
        assert.equal(
          value.internalTemporalPlainDateTime!.nanosecond,
          999000000,
        );
      }
    }
    clocks = 0;
    zones = 0;
  }
});
