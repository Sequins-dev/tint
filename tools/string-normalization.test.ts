import assert from "node:assert/strict";
import { after, test } from "node:test";
import type * as objects from "../packages/js-runtime/src/objects/index.ts";
import { bindHostRecordViews } from "../packages/js-runtime/test/ordinary-object-host-record-views.ts";
const host = bindHostRecordViews();
after(() => host.deregister());
const o = await import("../packages/js-runtime/src/objects/index.ts");
type ObjectValue = objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
function fixture(parent?: objects.ErrorRealm) {
  const root = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (fn, receiver, args) => {
      const result = o.callObject(fn as ObjectValue, receiver, args, undefined);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = o.createErrorRealm(
    root,
    hooks,
    parent?.symbolRegistry,
    parent?.agent,
  );
  o.installPrimitiveIntrinsics(root, realm, hooks);
  const method = o.getOwnProperty(realm.stringPrototype, "normalize");
  assert.ok(method, "normalize must be installed");
  const normalize = method.value as ObjectValue;
  const invoke = (receiver: unknown, args: unknown[] = []) => {
    const result = o.callObject(normalize, receiver, args, undefined);
    assert.equal(result.error, "none");
    return result.value;
  };
  const primitive = (action: (hint: unknown) => unknown) => {
    const value = o.createObject<objects.ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    o.createDataProperty(
      value,
      o.wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
      o.createCallableObject(realm.functionPrototype, (receiver, args) =>
        action(args[0]),
      ),
      hooks,
    );
    return value;
  };
  return { root, realm, hooks, method, normalize, invoke, primitive };
}
test("normalize has standard metadata and implements all four forms", () => {
  const f = fixture();
  assert.equal(f.method.writable, true);
  assert.equal(f.method.enumerable, false);
  assert.equal(f.method.configurable, true);
  assert.equal(o.getOwnProperty(f.normalize, "name")?.value, "normalize");
  assert.equal(o.getOwnProperty(f.normalize, "length")?.value, 0);
  assert.equal(f.normalize.internalConstruct, undefined);
  assert.equal(f.invoke("A\u030a"), "Å");
  assert.equal(f.invoke("Å", ["NFD"]), "A\u030a");
  assert.equal(f.invoke("\u1e9b\u0323", ["NFKC"]), "\u1e69");
  assert.equal(f.invoke("\u1e9b\u0323", ["NFKD"]), "s\u0323\u0307");
});
test("normalize converts the receiver before the form and preserves abrupt completion", () => {
  const f = fixture(),
    order: string[] = [];
  const receiver = f.primitive(() => {
    order.push("receiver");
    return "Å";
  });
  const form = f.primitive(() => {
    order.push("form");
    return "NFD";
  });
  assert.equal(f.invoke(receiver, [form]), "A\u030a");
  assert.deepEqual(order, ["receiver", "form"]);
  const sentinel = {};
  order.length = 0;
  assert.throws(
    () =>
      f.invoke(
        f.primitive(() => {
          throw sentinel;
        }),
        [form],
      ),
    (error) => error === sentinel,
  );
  assert.deepEqual(order, []);
  assert.throws(
    () =>
      f.invoke(receiver, [
        f.primitive(() => {
          throw sentinel;
        }),
      ]),
    (error) => error === sentinel,
  );
});
test("normalize validates coercible receivers and form strings with realm errors", () => {
  const f = fixture();
  for (const receiver of [null, undefined, o.createSymbolValue("x")])
    assert.throws(
      () => f.invoke(receiver),
      (error) =>
        (error as ObjectValue).prototype === f.realm.prototypes.get("type"),
    );
  assert.throws(
    () => f.invoke("x", [o.createSymbolValue("form")]),
    (error) =>
      (error as ObjectValue).prototype === f.realm.prototypes.get("type"),
  );
  for (const form of ["nfc", "", null, 42])
    assert.throws(
      () => f.invoke("x", [form]),
      (error) =>
        (error as ObjectValue).prototype === f.realm.prototypes.get("range"),
    );
  assert.equal(f.invoke(42), "42");
  assert.equal(f.invoke("\ud800"), "\ud800");
});

test("normalize distinguishes raw undefined from a form object returning undefined", () => {
  const f = fixture(),
    hints: unknown[] = [];
  assert.equal(
    f.invoke(
      f.primitive((hint) => {
        hints.push(hint);
        return "Å";
      }),
      [
        f.primitive((hint) => {
          hints.push(hint);
          return "NFD";
        }),
      ],
    ),
    "A\u030a",
  );
  assert.deepEqual(hints, ["string", "string"]);
  assert.equal(f.invoke("A\u030a", [undefined]), "Å");
  assert.equal(f.invoke(f.primitive(() => undefined)), "undefined");
  assert.throws(
    () => f.invoke("x", [f.primitive(() => undefined)]),
    (error) =>
      (error as ObjectValue).prototype === f.realm.prototypes.get("range"),
  );
});
test("borrowed normalize reports errors in the method's realm", () => {
  const caller = fixture(),
    method = fixture(caller.realm);
  const symbol = o.createSymbolValue("foreign");
  assert.throws(
    () => method.invoke(caller.primitive(() => symbol)),
    (error) =>
      (error as ObjectValue).prototype === method.realm.prototypes.get("type"),
  );
  assert.throws(
    () =>
      method.invoke(
        caller.primitive(() => "x"),
        [caller.primitive(() => "bad")],
      ),
    (error) =>
      (error as ObjectValue).prototype === method.realm.prototypes.get("range"),
  );
});
