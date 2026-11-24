import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
import { ensureExoticSlots } from "../src/objects/operations.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected hook"),
};
function realms() {
  const caller = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const callee = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
    caller.symbolRegistry,
    caller.agent,
  );
  return { caller, callee };
}
/** Compare identities only; diffing realm graphs makes failures unbounded. */
function throwsIn(
  action: () => unknown,
  realm: { readonly prototypes: Map<string, unknown> },
  kind: string,
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown !== undefined, `expected a ${kind} error`);
  assert.ok(
    errorPrototype(thrown) === realm.prototypes.get(kind),
    `expected the ${kind} error from the selected realm`,
  );
}
function errorPrototype(error: unknown) {
  return (error as OrdinaryObject<ScriptPropertyKey, unknown>).prototype;
}
for (const derived of [false, true]) {
  test(`${derived ? "derived" : "base"} class rejects a direct call in its defining realm`, () => {
    const { caller, callee } = realms();
    const base = objects.createBaseClass(
      "Base",
      0,
      undefined,
      [],
      callee,
      hooks,
    );
    const constructor = derived
      ? objects.createDerivedClass(
          "Derived",
          0,
          undefined,
          [],
          callee,
          hooks,
          base,
          objects.createObject(callee.objectPrototype),
        )
      : base;
    assert.equal(objects.getFunctionRealm(constructor, caller), callee);
    assert.throws(
      () =>
        caller.executionContext.run(() =>
          objects.callObject(constructor, undefined, [], undefined),
        ),
      (error) => errorPrototype(error) === callee.prototypes.get("type"),
    );
    assert.equal(caller.agent.activeContext, undefined);
  });
}
for (const returned of [0, undefined]) {
  test(`derived constructor return ${String(returned)} creates its completion error after restoring the caller`, () => {
    const { caller, callee } = realms();
    const base = objects.createBaseClass(
      "Base",
      0,
      undefined,
      [],
      callee,
      hooks,
    );
    let called = false;
    const constructor = objects.createDerivedClass(
      "Derived",
      0,
      () => {
        called = true;
        assert.equal(callee.agent.activeContext?.realm, callee);
        return returned;
      },
      [],
      callee,
      hooks,
      base,
      objects.createObject(callee.objectPrototype),
    );
    assert.throws(
      () =>
        caller.executionContext.run(() =>
          objects.constructObject(
            constructor,
            [],
            { value: constructor, object: constructor },
            undefined,
          ),
        ),
      (error) =>
        errorPrototype(error) ===
        caller.prototypes.get(returned === undefined ? "reference" : "type"),
    );
    assert.equal(called, true);
    assert.equal(caller.agent.activeContext, undefined);
  });
}
test("a derived constructor body keeps its own realm and thrown identity", () => {
  const { caller, callee } = realms();
  const base = objects.createBaseClass("Base", 0, undefined, [], callee, hooks);
  const failure = objects.createRuntimeError(callee, "type");
  const constructor = objects.createDerivedClass(
    "Derived",
    0,
    () => {
      assert.equal(callee.agent.activeContext?.realm, callee);
      throw failure;
    },
    [],
    callee,
    hooks,
    base,
    objects.createObject(callee.objectPrototype),
  );
  assert.throws(
    () =>
      caller.executionContext.run(() =>
        objects.constructObject(
          constructor,
          [],
          { value: constructor, object: constructor },
          undefined,
        ),
      ),
    (error) => error === failure,
  );
  assert.equal(caller.agent.activeContext, undefined);
});

test("nested constructor completion errors restore the immediate caller realm", () => {
  const { caller, callee } = realms();
  const base = objects.createBaseClass("Base", 0, undefined, [], callee, hooks);
  let constructor: OrdinaryObject<ScriptPropertyKey, unknown>;
  let nested = false;
  constructor = objects.createDerivedClass(
    "Derived",
    0,
    (_context, args) => {
      assert.equal(callee.agent.activeContext?.realm, callee);
      if (args[0] === true) {
        assert.throws(
          () =>
            objects.constructObject(
              constructor,
              [],
              { value: constructor, object: constructor },
              undefined,
            ),
          (error) => errorPrototype(error) === callee.prototypes.get("type"),
        );
        assert.equal(callee.agent.activeContext?.realm, callee);
        nested = true;
      }
      return 0;
    },
    [],
    callee,
    hooks,
    base,
    objects.createObject(callee.objectPrototype),
  );
  assert.throws(
    () =>
      caller.executionContext.run(() =>
        objects.constructObject(
          constructor,
          [true],
          { value: constructor, object: constructor },
          undefined,
        ),
      ),
    (error) => errorPrototype(error) === caller.prototypes.get("type"),
  );
  assert.equal(nested, true);
  assert.equal(caller.agent.activeContext, undefined);
});

test("base fields and body still execute in their defining source context", () => {
  const { caller, callee } = realms();
  const order: string[] = [];
  const constructor = objects.createBaseClass(
    "Base",
    0,
    () => {
      assert.equal(callee.agent.activeContext?.realm, callee);
      order.push("body");
      return undefined;
    },
    [
      {
        name: "field",
        initialize: () => {
          assert.equal(callee.agent.activeContext?.realm, callee);
          order.push("field");
          return 42;
        },
      },
    ],
    callee,
    hooks,
  );
  caller.executionContext.run(() => {
    const result = objects.constructObject(
      constructor,
      [],
      { value: constructor, object: constructor },
      undefined,
    );
    assert.equal(result.error, "none");
    return undefined;
  });
  assert.deepEqual(order, ["field", "body"]);
  assert.equal(caller.agent.activeContext, undefined);
});

test("base OrdinaryCreateFromConstructor runs before entering the class realm", () => {
  const { caller, callee } = realms();
  const order: string[] = [];
  const constructor = objects.createBaseClass(
    "Base",
    0,
    () => {
      order.push("body");
      return undefined;
    },
    [],
    callee,
    hooks,
  );
  // A newTarget whose prototype lookup revokes it, as Proxy.revocable can.
  const newTarget = objects.createExoticObject<ScriptPropertyKey, unknown>(
    undefined,
    {
      get: () => {
        order.push(
          caller.agent.activeContext?.realm === caller
            ? "prototype in caller"
            : "prototype in callee",
        );
        state.target = undefined;
        state.handler = undefined;
        return undefined;
      },
    },
    () => undefined,
    () => undefined,
  );
  const state: { target: typeof newTarget | undefined; handler: unknown } = {
    target: objects.createObject(callee.objectPrototype),
    handler: objects.createObject(callee.objectPrototype),
  };
  ensureExoticSlots(newTarget).internalProxyData = state as NonNullable<
    typeof newTarget.internalProxyData
  >;
  // GetFunctionRealm(revoked proxy) reports in the caller's realm.
  throwsIn(
    () =>
      caller.executionContext.run(() =>
        objects.constructObject(
          constructor,
          [],
          { value: newTarget, object: newTarget },
          undefined,
        ),
      ),
    caller,
    "type",
  );
  assert.deepEqual(order, ["prototype in caller"]);
  assert.ok(caller.agent.activeContext === undefined);
});

test("derived private elements reject a non-extensible return override in the class realm", () => {
  const { caller, callee } = realms();
  // TrojanBase: constructor(object) { return object; }
  const base = objects.createBaseClass(
    "TrojanBase",
    1,
    (_receiver, args) => args[0],
    [],
    callee,
    hooks,
  );
  const basePrototype = objects.getOwnProperty(base, "prototype")!
    .value as OrdinaryObject<ScriptPropertyKey, unknown>;
  const field = objects.createPrivateName("#value");
  const method = objects.createPrivateName("#method");
  const order: string[] = [];
  const classes = [
    {
      name: field,
      constructor: objects.createDerivedClass(
        "WithField",
        1,
        undefined,
        [
          {
            name: "#value",
            privateName: field,
            initialize: () => (order.push("initializer"), 42),
          },
        ],
        callee,
        hooks,
        base,
        objects.createObject(basePrototype),
      ),
    },
    {
      name: method,
      constructor: objects.createDerivedClass(
        "WithMethod",
        1,
        undefined,
        [],
        callee,
        hooks,
        base,
        objects.createObject(basePrototype),
        [{ name: method, kind: "method", value: 7 }],
      ),
    },
  ];
  for (const { name, constructor } of classes) {
    const construct = (object: OrdinaryObject<ScriptPropertyKey, unknown>) =>
      caller.executionContext.run(
        () =>
          objects.constructObject(
            constructor,
            [object],
            { value: constructor, object: constructor },
            undefined,
          ).value,
      );
    const open = objects.createObject<ScriptPropertyKey, unknown>(
      caller.objectPrototype,
    );
    assert.ok(construct(open) === open);
    assert.equal(objects.hasPrivateElement(open, name), true);
    const sealed = objects.createObject<ScriptPropertyKey, unknown>(
      caller.objectPrototype,
    );
    objects.preventExtensions(sealed);
    // InitializeInstanceElements runs within the derived constructor.
    throwsIn(() => construct(sealed), callee, "type");
    assert.equal(objects.hasPrivateElement(sealed, name), false);
    assert.ok(caller.agent.activeContext === undefined);
  }
  // The field initializer runs before PrivateFieldAdd rejects the receiver.
  assert.deepEqual(order, ["initializer", "initializer"]);
});
