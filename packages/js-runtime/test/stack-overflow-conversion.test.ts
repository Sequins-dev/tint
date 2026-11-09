import { after, test } from "node:test";
import assert from "node:assert/strict";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const objects = await import("../src/objects/index.ts");
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";

// The native stack guard throws a value that identifies itself (undefined with
// a reserved payload natively; a private stand-in here). JavaScript catch
// boundaries observe exactly that value as a RangeError of the realm, and
// nothing else: recognition never depends on earlier events.
const overflow = Symbol("stack overflow");
function setup() {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = objects.createErrorRealm(root, hooks);
  objects.installErrorIntrinsics(root, realm, hooks);
  const queries: unknown[] = [];
  realm.agent.stackGuard = {
    isOverflow: (value) => {
      queries.push(value);
      return value === overflow;
    },
  };
  return { realm, queries };
}
function isRangeError(
  realm: ReturnType<typeof setup>["realm"],
  value: unknown,
): boolean {
  const object = objects.viewObjectValue(value, realm.objectPrototype);
  return (
    object !== undefined && object.prototype === realm.prototypes.get("range")
  );
}

test("each stack overflow is caught as a fresh RangeError", () => {
  const { realm } = setup();
  const first = objects.rejectEngineAbort(realm, overflow),
    second = objects.rejectEngineAbort(realm, overflow);
  assert.ok(isRangeError(realm, first));
  assert.ok(isRangeError(realm, second));
  assert.notEqual(first, second);
  assert.equal(realm.unsupported, false);
});

test("a JavaScript throw of undefined is caught as undefined without any overflow", () => {
  const { realm, queries } = setup();
  assert.equal(objects.rejectEngineAbort(realm, undefined), undefined);
  assert.deepEqual(queries, [undefined]);
  const completion = objects.finishScriptExecution(realm, "throw", undefined);
  assert.equal(completion.error, "throw");
  assert.equal(completion.value, undefined);
});

test("a JavaScript throw of undefined after a recovered overflow is still undefined", () => {
  const { realm } = setup();
  assert.ok(isRangeError(realm, objects.rejectEngineAbort(realm, overflow)));
  assert.equal(objects.rejectEngineAbort(realm, undefined), undefined);
  const completion = objects.finishScriptExecution(realm, "throw", undefined);
  assert.equal(completion.value, undefined);
});

test("an overflow swallowed before any boundary leaves no state behind", () => {
  // Runtime code (IteratorClose, job realm lookup) may catch the overflow and
  // continue without reaching a JavaScript boundary. Only the value matters,
  // so later undefined and other values keep their ordinary treatment.
  const { realm } = setup();
  const value = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  assert.equal(objects.rejectEngineAbort(realm, undefined), undefined);
  assert.equal(objects.rejectEngineAbort(realm, value), value);
  assert.equal(objects.rejectEngineAbort(realm, 1), 1);
});

test("an overflow still unwinding is recognized after unrelated catches", () => {
  // A finally block may catch and discard another value while the overflow
  // propagates; the overflow is still converted when it reaches a catch.
  const { realm } = setup();
  assert.equal(objects.rejectEngineAbort(realm, 1), 1);
  assert.equal(objects.rejectEngineAbort(realm, undefined), undefined);
  assert.ok(isRangeError(realm, objects.rejectEngineAbort(realm, overflow)));
});

test("engine aborts still abort and are never overflows", () => {
  const { realm } = setup();
  assert.throws(() => objects.rejectEngineAbort(realm, (): void => {}));
  assert.equal(realm.unsupported, true);
});

test("a top-level overflow completes as a thrown RangeError", () => {
  const { realm } = setup();
  const completion = objects.finishScriptExecution(realm, "throw", overflow);
  assert.equal(completion.error, "throw");
  assert.ok(isRangeError(realm, completion.value));
});

test("realms without a stack guard treat every value normally", () => {
  const { realm } = setup();
  realm.agent.stackGuard = undefined;
  assert.equal(objects.rejectEngineAbort(realm, undefined), undefined);
  assert.equal(objects.rejectEngineAbort(realm, overflow), overflow);
});
