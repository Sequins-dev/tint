import assert from "node:assert/strict";
import test from "node:test";
import type { ScriptPropertyKey } from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const globals = await import("../src/objects/global-properties.ts");
const tails = await import("../src/objects/functions.ts");
const jobs = await import("../src/objects/jobs.ts");
function setup() {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => assert.fail("unexpected hook"),
  };
  const realm = objects.createErrorRealm(witness, hooks),
    execution = jobs.createSourceExecutionContext(realm);
  const intrinsic = objects.installEvalIntrinsic(witness, realm, hooks);
  return { witness, hooks, realm, execution, intrinsic };
}

test("a shadowed eval is deferred as an ordinary tail call", () => {
  const { witness, realm, execution } = setup();
  let calls = 0;
  const target = objects.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    (receiver, args) => {
      calls++;
      assert.equal(receiver, 7);
      assert.deepEqual(args, [42]);
      return 49;
    },
  );
  const step = tails.runSourceTailCallStep(
    () =>
      globals.callEvalTailCandidate(
        target,
        7,
        [42],
        witness,
        realm,
        0,
        undefined,
      ).value,
    execution,
    realm,
  );
  assert.equal(calls, 0);
  assert.equal(step.kind, "call");
  if (step.kind === "call")
    assert.equal(
      objects.callObject(step.target, step.receiver, step.arguments, undefined)
        .value,
      49,
    );
  assert.equal(calls, 1);
});

test("intrinsic direct eval keeps the caller context and opaque site", () => {
  const { witness, realm, execution, intrinsic } = setup();
  const site = {};
  let called = false;
  realm.directEvalCompiler = (source, flags, actual) => {
    called = true;
    assert.equal(source, "1");
    assert.equal(flags, 1);
    assert.equal(actual, site);
    assert.equal(realm.agent.activeContext?.realm, realm);
    assert.equal(realm.agent.activeTailCallFrame?.pending, undefined);
    return 42;
  };
  const step = tails.runSourceTailCallStep(
    () =>
      globals.callEvalTailCandidate(
        intrinsic,
        undefined,
        ["1"],
        witness,
        realm,
        1,
        site,
      ).value,
    execution,
    realm,
  );
  assert.deepEqual(step, { kind: "return", value: 42 });
  assert.equal(called, true);
  assert.equal(realm.agent.activeContext, undefined);
  assert.equal(realm.agent.activeTailCallFrame, undefined);
});

test("intrinsic empty and non-string calls need no transfer owner", () => {
  const { witness, realm, intrinsic } = setup();
  const value = {};
  assert.deepEqual(
    globals.callEvalTailCandidate(
      intrinsic,
      undefined,
      [],
      witness,
      realm,
      0,
      undefined,
    ),
    { error: "none", value: undefined },
  );
  assert.equal(
    globals.callEvalTailCandidate(
      intrinsic,
      undefined,
      [value],
      witness,
      realm,
      0,
      undefined,
    ).value,
    value,
  );
});

test("non-callable shadowed eval does not leave a pending request", () => {
  const { witness, realm, execution } = setup();
  const step = tails.runSourceTailCallStep(
    () => {
      assert.deepEqual(
        globals.callEvalTailCandidate(
          7,
          undefined,
          [],
          witness,
          realm,
          0,
          undefined,
        ),
        { error: "type", value: undefined },
      );
      assert.equal(realm.agent.activeTailCallFrame?.pending, undefined);
      return 42;
    },
    execution,
    realm,
  );
  assert.deepEqual(step, { kind: "return", value: 42 });
});
