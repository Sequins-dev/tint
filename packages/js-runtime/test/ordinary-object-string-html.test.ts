import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";
test("legacy string HTML methods have standard callable metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  for (const name of [
    "anchor",
    "big",
    "blink",
    "bold",
    "fixed",
    "fontcolor",
    "fontsize",
    "italics",
    "link",
    "small",
    "strike",
    "sub",
    "sup",
  ]) {
    const descriptor = objects.getOwnProperty(realm.stringPrototype, name);
    assert.ok(descriptor, name);
    const fn = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "name")?.value, name);
    assert.equal(
      objects.getOwnProperty(fn, "length")?.value,
      ["anchor", "fontcolor", "fontsize", "link"].includes(name) ? 1 : 0,
    );
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    assert.equal(fn.internalConstruct, undefined);
  }
});
