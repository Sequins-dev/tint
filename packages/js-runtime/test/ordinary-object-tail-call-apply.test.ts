import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrdinaryObject,
  ScriptPropertyKey,
  ObjectHooks,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const functions = await import("../src/objects/functions.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected hook"),
};
for (const method of ["call", "apply"]) {
  test(`Function.prototype.${method} forwards 100,000 tail calls without retaining its frame`, () => {
    const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined),
      realm = objects.createErrorRealm(witness, hooks);
    objects.installFunctionIntrinsics(witness, realm, hooks);
    const value = objects.getOwnProperty(
      realm.functionPrototype,
      method,
    )?.value;
    const builtin = objects.viewObjectValue(value, witness);
    assert.ok(builtin);
    let fn: OrdinaryObject<ScriptPropertyKey, unknown>;
    fn = functions.createTailSourceFunction(
      (_receiver, args) => {
        const n = args[0];
        if (typeof n !== "number") assert.fail();
        if (n === 0) return 42;
        const list =
          method === "call"
            ? [undefined, n - 1]
            : [
                undefined,
                objects.createArrayFromList(
                  [n - 1],
                  0,
                  realm.arrayPrototype,
                  realm,
                  hooks,
                ),
              ];
        return functions.requestSourceTailCall(
          builtin,
          fn,
          list,
          witness,
          realm,
        ).value;
      },
      false,
      realm,
      hooks,
    );
    assert.equal(
      objects.callObject(fn, undefined, [100000], undefined).value,
      42,
    );
    assert.equal(realm.agent.activeContext, undefined);
    assert.equal(realm.agent.activeTailCallFrame, undefined);
  });
}

test("callability is validated in the builtin's realm before forwarding", () => {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    caller = objects.createErrorRealm(witness, hooks);
  const callee = objects.createErrorRealm(
    witness,
    hooks,
    caller.symbolRegistry,
    caller.agent,
  );
  objects.installFunctionIntrinsics(witness, callee, hooks);
  const method = objects.viewObjectValue(
    objects.getOwnProperty(callee.functionPrototype, "call")?.value,
    witness,
  );
  assert.ok(method);
  assert.throws(
    () =>
      caller.executionContext.run(() =>
        objects.callObject(method, 7, [], undefined),
      ),
    (error) =>
      objects.viewObjectValue(error, witness)?.prototype ===
      callee.prototypes.get("type"),
  );
  assert.equal(caller.agent.activeContext, undefined);
});
