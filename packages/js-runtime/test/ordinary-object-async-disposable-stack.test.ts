import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("AsyncDisposableStack has its own brand and an async disposal method identity", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(global, hooks);
  assert.equal(
    typeof objects.installAsyncDisposableStackIntrinsics,
    "function",
  );
  objects.installAsyncDisposableStackIntrinsics(global, realm, hooks);
  const descriptor = objects.getOwnProperty(global, "AsyncDisposableStack");
  assert.ok(descriptor);
  const constructor = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  assert.equal(
    objects.getOwnProperty(constructor, "name")?.value,
    "AsyncDisposableStack",
  );
  const prototype = realm.asyncDisposableStackPrototype;
  assert.equal(
    objects.exoticSlots(prototype).internalAsyncDisposableStack,
    undefined,
  );
  assert.notEqual(prototype, realm.disposableStackPrototype);
  assert.equal(
    objects.getOwnProperty(prototype, "disposeAsync")?.value,
    objects.getOwnProperty(
      prototype,
      objects.wellKnownSymbol(realm.symbolRegistry, "asyncDispose"),
    )?.value,
  );
  assert.equal(objects.getOwnProperty(prototype, "dispose"), undefined);
});
