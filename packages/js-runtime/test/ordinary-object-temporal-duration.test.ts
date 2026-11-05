import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Temporal.Duration exposes constructor and branded field getters", () => {
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
  const descriptor = objects.getOwnProperty(temporal, "Duration");
  assert.ok(descriptor);
  const ctor = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(ctor, "length")!.value, 0);
  assert.equal(objects.getOwnProperty(ctor, "name")!.value, "Duration");
  assert.ok(objects.getOwnProperty(ctor, "from"));
  assert.ok(objects.getOwnProperty(ctor, "compare"));
  assert.ok(objects.getOwnProperty(realm.temporalDurationPrototype, "with"));
  assert.ok(objects.getOwnProperty(realm.temporalDurationPrototype, "total"));
  assert.ok(objects.getOwnProperty(realm.temporalDurationPrototype, "round"));
  for (const name of ["add", "subtract"])
    assert.ok(objects.getOwnProperty(realm.temporalDurationPrototype, name));
  for (const name of [
    "years",
    "months",
    "weeks",
    "days",
    "hours",
    "minutes",
    "seconds",
    "milliseconds",
    "microseconds",
    "nanoseconds",
    "sign",
    "blank",
  ]) {
    const d = objects.getOwnProperty(realm.temporalDurationPrototype, name)!;
    assert.ok(d, name);
    assert.equal(d.enumerable, false);
    assert.equal(d.configurable, true);
    assert.equal(d.set, undefined);
  }
});
