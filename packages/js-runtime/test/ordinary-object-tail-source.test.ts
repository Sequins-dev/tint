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
const jobs = await import("../src/objects/jobs.ts");
function setup() {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = objects.createErrorRealm(witness, hooks);
  return { witness, hooks, realm };
}

test("tail-enabled source callbacks preserve identity through 100,000 calls", () => {
  const { witness, hooks, realm } = setup();
  let fn: OrdinaryObject<ScriptPropertyKey, unknown>;
  let calls = 0;
  fn = functions.createTailSourceFunction(
    (_receiver, args, callee, newTarget) => {
      calls++;
      assert.equal(callee, fn);
      assert.equal(newTarget, undefined);
      const n = args[0];
      if (typeof n !== "number") assert.fail();
      return n === 0
        ? 42
        : functions.requestSourceTailCall(
            fn,
            undefined,
            [n - 1],
            witness,
            realm,
          ).value;
    },
    false,
    realm,
    hooks,
    "f",
    1,
  );
  assert.equal(
    objects.callObject(fn, undefined, [100000], undefined).value,
    42,
  );
  assert.equal(calls, 100001);
  assert.equal(realm.agent.activeContext, undefined);
  assert.equal(realm.agent.activeTailCallFrame, undefined);
});

test("the eliminated source identity is absent when the final builtin runs", () => {
  const { witness, hooks, realm } = setup();
  const foreign = objects.createErrorRealm(
    witness,
    hooks,
    realm.symbolRegistry,
    realm.agent,
  );
  const builtin = objects.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    () => {
      assert.equal(realm.agent.activeContext?.realm, foreign);
      return realm.agent.activeContext?.scriptOrModule;
    },
    foreign.executionContext,
  );
  const fn = jobs.runScriptContext(
    realm.agent,
    { realm, scriptOrModule: "definition" },
    () =>
      functions.createTailSourceFunction(
        () => {
          assert.equal(realm.agent.activeContext?.scriptOrModule, "definition");
          return functions.requestSourceTailCall(
            builtin,
            undefined,
            [],
            witness,
            realm,
          ).value;
        },
        false,
        realm,
        hooks,
      ),
  );
  const result = jobs.runScriptContext(
    realm.agent,
    { realm, scriptOrModule: "caller" },
    () => objects.callObject(fn, undefined, [], undefined),
  );
  assert.equal(result.value, "caller");
  assert.equal(realm.agent.activeContext, undefined);
});

test("tail-enabled construction preserves new.target and base return processing", () => {
  const { witness, hooks, realm } = setup();
  const result = objects.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    () => 7,
  );
  let fn: OrdinaryObject<ScriptPropertyKey, unknown>;
  let receiver: unknown;
  fn = functions.createTailSourceFunction(
    (value, _args, callee, newTarget) => {
      receiver = value;
      assert.equal(callee, fn);
      assert.equal(newTarget, fn);
      return functions.requestSourceTailCall(
        result,
        undefined,
        [],
        witness,
        realm,
      ).value;
    },
    true,
    realm,
    hooks,
    "C",
    0,
  );
  const constructed = objects.constructObject(
    fn,
    [],
    { value: fn, object: fn },
    undefined,
  );
  assert.equal(constructed.error, "none");
  assert.equal(constructed.value, receiver);
  assert.equal(realm.agent.activeContext, undefined);
  assert.equal(realm.agent.activeTailCallFrame, undefined);
});

test("a direct internal invocation uses the same driver and thrown identity", () => {
  const { witness, hooks, realm } = setup();
  const failure = {};
  const target = objects.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    () => {
      throw failure;
    },
  );
  const fn = functions.createTailSourceFunction(
    () =>
      functions.requestSourceTailCall(target, undefined, [], witness, realm)
        .value,
    false,
    realm,
    hooks,
  );
  assert.ok(fn.internalCall);
  assert.throws(
    () => fn.internalCall!(undefined, []),
    (error) => error === failure,
  );
  assert.equal(realm.agent.activeContext, undefined);
  assert.equal(realm.agent.activeTailCallFrame, undefined);
});
