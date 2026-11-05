import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("DisposableStack has realm-local metadata, a non-branded prototype and one disposal method identity", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(global, hooks);
  assert.equal(typeof objects.installDisposableStackIntrinsics, "function");
  objects.installDisposableStackIntrinsics(global, realm, hooks);
  const descriptor = objects.getOwnProperty(global, "DisposableStack");
  assert.ok(descriptor);
  const constructor = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  assert.equal(
    objects.getOwnProperty(constructor, "name")?.value,
    "DisposableStack",
  );
  const prototype = realm.disposableStackPrototype;
  assert.equal(prototype.internalDisposableStack, undefined);
  assert.equal(prototype.prototype, realm.objectPrototype);
  assert.equal(
    objects.getOwnProperty(prototype, "dispose")?.value,
    objects.getOwnProperty(
      prototype,
      objects.wellKnownSymbol(realm.symbolRegistry, "dispose"),
    )?.value,
  );
  for (const name of ["adopt", "defer", "dispose", "move", "use"]) {
    const method = objects.getOwnProperty(prototype, name);
    assert.ok(method);
    assert.equal(method.enumerable, false);
  }
});
