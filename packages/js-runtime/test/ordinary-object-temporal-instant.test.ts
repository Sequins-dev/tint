import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Temporal.Instant exposes its epoch constructor, conversion factories and branded accessors", () => {
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
  const descriptor = objects.getOwnProperty(temporal, "Instant");
  assert.ok(descriptor);
  const ctor = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(ctor, "length")!.value, 1);
  for (const name of [
    "from",
    "fromEpochMilliseconds",
    "fromEpochNanoseconds",
    "compare",
  ])
    assert.ok(objects.getOwnProperty(ctor, name), name);
  for (const name of [
    "add",
    "subtract",
    "round",
    "until",
    "since",
    "toZonedDateTimeISO",
  ])
    assert.ok(
      objects.getOwnProperty(realm.temporalInstantPrototype, name),
      name,
    );
  for (const name of ["epochNanoseconds", "epochMilliseconds"]) {
    const field = objects.getOwnProperty(realm.temporalInstantPrototype, name);
    assert.ok(field, name);
    assert.equal(field.set, undefined);
  }
});
