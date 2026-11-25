import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
function realms() {
  const first = objects.createErrorRealm(
    objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const second = objects.createErrorRealm(
    objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
    hooks,
    first.symbolRegistry,
    first.agent,
  );
  return { first, second };
}
test("function realm lookup follows internal bound and Proxy targets without traps", () => {
  const { first, second } = realms();
  const target = objects.createCallableObject<
    objects.ScriptPropertyKey,
    unknown
  >(second.functionPrototype, () => undefined);
  const bound = objects.createBoundFunction(
    target,
    undefined,
    [],
    undefined,
    (value) => value,
    Object.is,
  );
  let traps = 0;
  const proxy = objects.createExoticObject<objects.ScriptPropertyKey, unknown>(
    undefined,
    {
      get: () => {
        traps++;
        throw "unexpected trap";
      },
    },
    () => undefined,
  );
  objects.ensureExoticSlots(proxy).internalProxyData = {
    target: bound,
    handler: first.objectPrototype,
  };
  assert.equal(objects.getFunctionRealm(proxy, first), second);
  assert.equal(traps, 0);
  assert.equal(first.agent.activeContext, undefined);
});
test("function realm lookup rejects revoked Proxy targets in the current realm", () => {
  const { first, second } = realms();
  const proxy = objects.createExoticObject<objects.ScriptPropertyKey, unknown>(
    undefined,
    {},
    () => undefined,
  );
  objects.ensureExoticSlots(proxy).internalProxyData = {
    target: undefined,
    handler: undefined,
  };
  assert.throws(
    () =>
      second.executionContext.run(() => objects.getFunctionRealm(proxy, first)),
    (error: unknown) =>
      (error as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>)
        .prototype === second.prototypes.get("type"),
  );
});
