import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Temporal.PlainTime exposes constructor and clock accessors", () => {
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
  const descriptor = objects.getOwnProperty(temporal, "PlainTime");
  assert.ok(descriptor);
  const constructor = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(constructor, "length")!.value, 0);
  assert.ok(objects.getOwnProperty(constructor, "from"));
  assert.ok(objects.getOwnProperty(constructor, "compare"));
  for (const name of [
    "add",
    "subtract",
    "round",
    "equals",
    "toLocaleString",
    "until",
    "since",
    "with",
  ])
    assert.ok(
      objects.getOwnProperty(realm.temporalPlainTimePrototype, name),
      name,
    );
  for (const name of [
    "hour",
    "minute",
    "second",
    "millisecond",
    "microsecond",
    "nanosecond",
  ]) {
    const d = objects.getOwnProperty(realm.temporalPlainTimePrototype, name)!;
    assert.ok(d, name);
    assert.equal(d.enumerable, false);
    assert.equal(d.configurable, true);
    assert.equal(d.set, undefined);
  }
});
