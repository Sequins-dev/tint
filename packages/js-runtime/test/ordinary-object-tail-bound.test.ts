import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrdinaryObject,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const functions = await import("../src/objects/functions.ts");
const hooks = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};

test("bound forwarding keeps 100,000 source transfers bounded", () => {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(witness, hooks);
  let bound: OrdinaryObject<ScriptPropertyKey, unknown>;
  const fn = functions.createTailSourceFunction(
    (receiver, args) => {
      assert.equal(receiver, 42);
      const n = args[0];
      if (typeof n !== "number") assert.fail();
      return n === 0
        ? 7
        : functions.requestSourceTailCall(
            bound,
            undefined,
            [n - 1],
            witness,
            realm,
          ).value;
    },
    false,
    realm,
    hooks,
  );
  bound = objects.createBoundFunction(
    fn,
    42,
    [],
    undefined,
    (value) => value,
    Object.is,
  );
  assert.equal(objects.callObject(bound, 99, [100000], undefined).value, 7);
  assert.equal(realm.agent.activeTailCallFrame, undefined);
  assert.equal(realm.agent.activeContext, undefined);
});

test("nested bound steps preserve the inner receiver and ordered argument copies", () => {
  const receiver = {};
  const prefix = [1];
  let actual: readonly unknown[] | undefined;
  const target = objects.createCallableObject<string, unknown>(
    undefined,
    (self, args) => {
      assert.equal(self, receiver);
      actual = args;
      return 42;
    },
  );
  const inner = objects.createBoundFunction(
    target,
    receiver,
    prefix,
    undefined,
    (value) => value,
    Object.is,
  );
  const outer = objects.createBoundFunction(
    inner,
    "ignored",
    [2, 3],
    undefined,
    (value) => value,
    Object.is,
  );
  prefix[0] = 99;
  const args = [4];
  assert.equal(objects.callObject(outer, undefined, args, undefined).value, 42);
  assert.deepEqual(actual, [1, 2, 3, 4]);
  assert.deepEqual(args, [4]);
});
