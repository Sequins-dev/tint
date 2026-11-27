import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "../src/objects/index.ts";
test("Proxy is callable with a throwing call entry and has no prototype property", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  object.installProxyIntrinsics(root, realm, hooks);
  const proxy = object.getOwnProperty(root, "Proxy")
    ?.value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  assert.equal(object.getOwnProperty(proxy, "name")?.value, "Proxy");
  assert.equal(object.getOwnProperty(proxy, "length")?.value, 2);
  assert.equal(object.getOwnProperty(proxy, "prototype"), undefined);
  assert.equal(typeof proxy.internalRareSlots?.internalCall, "function");
  assert.throws(() => proxy.internalRareSlots!.internalCall!(undefined, []));
  const revocable = object.getOwnProperty(proxy, "revocable")
    ?.value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  assert.equal(object.getOwnProperty(revocable, "length")?.value, 2);
  assert.equal(revocable.internalRareSlots?.internalConstruct, undefined);
});

test("Proxy revocation errors use the active realm, not the creation realm", async () => {
  const { proxyAccess } = await import("../src/objects/proxy-state.ts");
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const first = object.createErrorRealm(
    object.createObject<object.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const second = object.createErrorRealm(
    object.createObject<object.ScriptPropertyKey, unknown>(undefined),
    hooks,
    first.symbolRegistry,
    first.agent,
  );
  assert.throws(
    () =>
      second.executionContext.run(() =>
        proxyAccess(
          { target: undefined, handler: undefined },
          "get",
          first,
          hooks,
        ),
      ),
    (error: unknown) =>
      (error as object.OrdinaryObject<object.ScriptPropertyKey, unknown>)
        .prototype === second.prototypes.get("type"),
  );
  assert.equal(first.agent.activeContext, undefined);
});

test("Proxy constructor installs length before name", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  object.installProxyIntrinsics(root, realm, hooks);
  const proxy = object.getOwnProperty(root, "Proxy")!
    .value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  assert.deepEqual(object.ownKeys(proxy, () => -1).slice(0, 2), [
    "length",
    "name",
  ]);
});
