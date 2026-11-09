import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
// Record views must be bound before the runtime modules load.
bindHostRecordViews();
const {
  createScriptAgent,
  enterScriptContext,
  leaveScriptContext,
  runScriptContext,
  createObject,
  installErrorIntrinsics,
  viewObjectValue,
  binaryObjectValueOperationOrThrow,
  objectPropertyKeyOrThrow,
  getObjectValuePropertyOrThrow,
  setObjectValuePropertyOrThrow,
  callObjectValueOrThrow,
  deleteObjectValuePropertyOrThrow,
  createDataProperty,
  createErrorRealm,
} = await import("../src/objects/index.ts");

const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
function realm() {
  const object = createObject<ScriptPropertyKey, unknown>(undefined);
  const created = createErrorRealm(object, hooks);
  installErrorIntrinsics(object, created, hooks);
  return { object, realm: created };
}
function thrown(action: () => unknown): unknown {
  let value: unknown = "not thrown";
  try {
    action();
  } catch (error) {
    value = error;
  }
  return value;
}

test("fused results return the value and throw the realm's error like throwIfRuntimeError", () => {
  const { object, realm: errors } = realm();
  assert.equal(
    binaryObjectValueOperationOrThrow("+", "foo", 1, hooks, errors),
    "foo1",
  );
  const target = createObject<ScriptPropertyKey, unknown>(undefined);
  assert.equal(objectPropertyKeyOrThrow(target, 7, hooks, errors), "7");
  // A nullish base is a TypeError created in the operation's realm.
  const error = thrown(() =>
    objectPropertyKeyOrThrow(undefined, "x", hooks, errors),
  );
  assert.equal(
    viewObjectValue(error, object)?.prototype,
    errors.prototypes.get("type"),
  );
  assert.equal(errors.unsupported, false);
  createDataProperty<ScriptPropertyKey, unknown>(target, "x", 1, hooks);
  assert.equal(getObjectValuePropertyOrThrow(target, "x", hooks, errors), 1);
  setObjectValuePropertyOrThrow(target, "x", 2, true, hooks, errors);
  assert.equal(getObjectValuePropertyOrThrow(target, "x", hooks, errors), 2);
  assert.equal(
    deleteObjectValuePropertyOrThrow(target, "x", true, object, errors),
    true,
  );
  const reading = thrown(() =>
    getObjectValuePropertyOrThrow(null, "x", hooks, errors),
  );
  assert.equal(
    viewObjectValue(reading, object)?.prototype,
    errors.prototypes.get("type"),
  );
  // Calling a non-callable is the same TypeError the unfused check throws.
  const calling = thrown(() =>
    callObjectValueOrThrow(target, undefined, [], object, errors),
  );
  assert.equal(
    viewObjectValue(calling, object)?.prototype,
    errors.prototypes.get("type"),
  );
});

test("enterScriptContext and leaveScriptContext are runScriptContext's two halves", () => {
  const agent = createScriptAgent(),
    outer = { realm: realm().realm, scriptOrModule: "outer" },
    inner = { realm: realm().realm, scriptOrModule: "inner" };
  runScriptContext(agent, outer, () => {
    const depth = agent.executionContextDepth;
    const frame = enterScriptContext(agent, inner);
    assert.ok(agent.activeContext === inner);
    assert.equal(agent.executionContextDepth, depth + 1);
    const failure = {};
    assert.throws(
      () => {
        try {
          throw failure;
        } finally {
          leaveScriptContext(agent, frame);
        }
      },
      (value) => value === failure,
    );
    assert.ok(agent.activeContext === outer);
    assert.equal(agent.executionContextDepth, depth);
    return undefined;
  });
  assert.equal(agent.activeContext, undefined);
});
