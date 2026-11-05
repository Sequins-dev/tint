import assert from "node:assert/strict";
import test from "node:test";
import type { ScriptPropertyKey } from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const tails = await import("../src/objects/functions.ts");
const jobs = await import("../src/objects/jobs.ts");

function setup() {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = objects.createErrorRealm(witness, hooks);
  const source = jobs.createSourceExecutionContext(realm);
  const target = objects.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    (_receiver, args) => args[0],
  );
  return { witness, realm, source, target };
}

test("a source invocation owns its request and releases the context before dispatch", () => {
  const { witness, realm, source, target } = setup();
  const args = [42];
  const step = tails.runSourceTailCallStep(
    () => {
      assert.equal(realm.agent.activeContext?.realm, realm);
      assert.ok(realm.agent.activeTailCallFrame);
      return tails.requestSourceTailCall(target, 7, args, witness, realm).value;
    },
    source,
    realm,
  );
  assert.equal(step.kind, "call");
  if (step.kind !== "call") assert.fail();
  assert.equal(step.target, target);
  assert.equal(step.receiver, 7);
  assert.equal(step.arguments, args);
  assert.equal(realm.agent.activeContext, undefined);
  assert.equal(realm.agent.activeTailCallFrame, undefined);
});

test("nested ordinary invocations cannot consume an outer transfer", () => {
  const { witness, realm, source, target } = setup();
  const outer = tails.runSourceTailCallStep(
    () => {
      const owner = realm.agent.activeTailCallFrame;
      const inner = tails.runSourceTailCallStep(
        () => tails.requestSourceTailCall(target, 1, [2], witness, realm).value,
        source,
        realm,
      );
      assert.equal(inner.kind, "call");
      assert.equal(realm.agent.activeTailCallFrame, owner);
      assert.equal(owner?.pending, undefined);
      return tails.requestSourceTailCall(target, 3, [4], witness, realm).value;
    },
    source,
    realm,
  );
  assert.equal(outer.kind, "call");
  if (outer.kind === "call")
    assert.deepEqual([outer.receiver, outer.arguments], [3, [4]]);
  assert.equal(realm.agent.activeTailCallFrame, undefined);
});

test("an abrupt source step restores its parent and discards its own request", () => {
  const { witness, realm, source, target } = setup();
  const failure = {};
  const result = tails.runSourceTailCallStep(
    () => {
      const owner = realm.agent.activeTailCallFrame;
      assert.throws(
        () =>
          tails.runSourceTailCallStep(
            () => {
              tails.requestSourceTailCall(target, 1, [2], witness, realm);
              throw failure;
            },
            source,
            realm,
          ),
        (error) => error === failure,
      );
      assert.equal(realm.agent.activeTailCallFrame, owner);
      assert.equal(owner?.pending, undefined);
      return 42;
    },
    source,
    realm,
  );
  assert.deepEqual(result, { kind: "return", value: 42 });
  assert.equal(realm.agent.activeTailCallFrame, undefined);
});

test("callability errors leave the invocation available for a later valid request", () => {
  const { witness, realm, source, target } = setup();
  const result = tails.runSourceTailCallStep(
    () => {
      assert.deepEqual(
        tails.requestSourceTailCall(7, undefined, [], witness, realm),
        { error: "type", value: undefined },
      );
      assert.equal(realm.agent.activeTailCallFrame?.pending, undefined);
      return tails.requestSourceTailCall(
        target,
        undefined,
        [42],
        witness,
        realm,
      ).value;
    },
    source,
    realm,
  );
  assert.equal(result.kind, "call");
});

test("a request requires exactly one active owner", () => {
  const { witness, realm, source, target } = setup();
  assert.throws(
    () => tails.requestSourceTailCall(target, undefined, [], witness, realm),
    (error) => error === "TAIL_CALL_OWNER_INVARIANT",
  );
  const step = tails.runSourceTailCallStep(
    () => {
      tails.requestSourceTailCall(target, undefined, [42], witness, realm);
      assert.throws(
        () =>
          tails.requestSourceTailCall(target, undefined, [7], witness, realm),
        (error) => error === "TAIL_CALL_OWNER_INVARIANT",
      );
      return undefined;
    },
    source,
    realm,
  );
  assert.equal(step.kind, "call");
  if (step.kind === "call") assert.deepEqual(step.arguments, [42]);
});
