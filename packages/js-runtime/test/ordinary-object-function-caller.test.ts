import assert from "node:assert/strict";
import test from "node:test";
import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const { createSourceFunction } = await import("../src/objects/functions.ts");
function fixture() {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => {
      const result = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = objects.createErrorRealm(root, hooks);
  const source = (
    body: () => unknown,
    policy: "legacy" | "opaque" | "visible" | "none" = "legacy",
  ) =>
    createSourceFunction(body, true, realm, hooks, "f", 0, undefined, policy);
  const invoke = (callee: unknown) => hooks.call(callee, undefined, []);
  const caller = (callee: unknown) =>
    objects.getProperty(
      callee as OrdinaryObject<ScriptPropertyKey, unknown>,
      "caller",
      callee,
      hooks,
    );
  return { source, invoke, caller, realm };
}

test("sloppy caller reflection follows the nearest invocation and clears after return", () => {
  const { source, invoke, caller } = fixture();
  const inner = source(() => caller(inner));
  const outer = source(() => invoke(inner));
  assert.equal(caller(inner), null);
  assert.equal(invoke(outer), outer);
  assert.equal(caller(inner), null);
});

test("strict callers stay hidden and strict functions retain the poison accessor", () => {
  const { source, invoke, caller, realm } = fixture();
  const inner = source(() => caller(inner));
  const strict = source(() => invoke(inner), "opaque");
  assert.equal(invoke(strict), null);
  assert.equal(objects.getOwnProperty(strict, "caller"), undefined);
  assert.throws(
    () => caller(strict),
    (error: unknown) =>
      (error as OrdinaryObject<ScriptPropertyKey, unknown>).prototype ===
      realm.prototypes.get("type"),
  );
});

test("recursive and abrupt invocations restore the previous caller", () => {
  const { source, invoke, caller } = fixture();
  let depth = 0;
  const failure = {};
  const recursive = source(() => {
    if (depth++ === 0) {
      assert.throws(
        () => invoke(recursive),
        (error) => error === failure,
      );
      return caller(recursive);
    }
    assert.equal(caller(recursive), recursive);
    throw failure;
  });
  const outer = source(() => invoke(recursive));
  assert.equal(invoke(outer), outer);
  assert.equal(caller(recursive), null);
});

test("internal dynamic-body carriers are transparent and non-strict methods can be callers", () => {
  const { source, invoke, caller } = fixture();
  const inner = source(() => caller(inner));
  const carrier = source(() => invoke(inner), "none");
  const method = source(() => invoke(carrier), "visible");
  assert.equal(invoke(method), method);
  assert.equal(objects.getOwnProperty(method, "caller"), undefined);
  assert.equal(objects.getOwnProperty(carrier, "caller"), undefined);
});

test("raw strict source contexts hide callers, including class constructor bodies", async () => {
  const { source, invoke, caller, realm } = fixture();
  const { createSourceExecutionContext } =
    await import("../src/objects/jobs.ts");
  const execution = createSourceExecutionContext(realm);
  const inner = source(() => caller(inner));
  const outer = source(() => execution.run(() => invoke(inner)));
  assert.equal(invoke(outer), null);
  assert.equal(realm.agent.activeSourceCall, undefined);
});
