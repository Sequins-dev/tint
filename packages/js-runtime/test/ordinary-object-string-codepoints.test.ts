import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";

const views = bindHostRecordViews();
after(() => views.deregister());
const objects = await import("../src/objects/index.ts");

function setup(methodName = "fromCodePoint") {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const result = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = objects.createErrorRealm(root, hooks);
  objects.installErrorIntrinsics(root, realm, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const constructor = objects.viewObjectValue(
    objects.getOwnProperty(root, "String")!.value,
    root,
  );
  assert.ok(constructor);
  const method = objects.getOwnProperty(constructor, methodName)!.value;
  return {
    root,
    realm,
    hooks,
    call(args: readonly unknown[]) {
      const result = objects.callObjectValue(method, undefined, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
}

test("String.fromCodePoint preserves Unicode boundaries and lone surrogates", () => {
  const fixture = setup();
  const points = [
    0, -0, 0x41, 0xd7ff, 0xd800, 0xdfff, 0xffff, 0x10000, 0x10ffff,
  ];
  assert.equal(fixture.call([]), "");
  assert.equal(fixture.call(points), String.fromCodePoint(...points));
  assert.equal(fixture.call([null, false, true, "0x41"]), "\0\0\x01A");
  for (const point of [-1, 0.5, NaN, Infinity, -Infinity, 0x110000])
    assert.throws(
      () => fixture.call([point]),
      (error) =>
        objects.viewObjectValue(error, fixture.root)?.prototype ===
        fixture.realm.prototypes.get("range"),
    );
});

test("String.fromCodePoint builds large mixed-width argument lists exactly", () => {
  const fixture = setup();
  const points = Array.from({ length: 10000 }, (_, index) =>
    index % 3 === 0 ? 0xd800 + (index % 0x800) : 0x10000 + (index % 0x100000),
  );
  assert.equal(fixture.call(points), String.fromCodePoint(...points));
});

test("String.fromCodePoint converts arguments in order and stops at abrupt completion", () => {
  const fixture = setup();
  const events: number[] = [];
  const marker = {};
  function argument(index: number, value: number, abrupt = false) {
    const object = objects.createObject<ScriptPropertyKey, unknown>(
      fixture.realm.objectPrototype,
    );
    const valueOf = objects.createCallableObject<ScriptPropertyKey, unknown>(
      fixture.realm.functionPrototype,
      () => {
        events.push(index);
        if (abrupt) throw marker;
        return value;
      },
    );
    objects.createDataProperty(object, "valueOf", valueOf, fixture.hooks);
    return object;
  }
  assert.equal(fixture.call([argument(1, 65), argument(2, 0x10000)]), "A𐀀");
  assert.deepEqual(events, [1, 2]);
  events.length = 0;
  assert.throws(
    () =>
      fixture.call([argument(1, 65), argument(2, 66, true), argument(3, 67)]),
    (error) => error === marker,
  );
  assert.deepEqual(events, [1, 2]);
  events.length = 0;
  assert.throws(
    () => fixture.call([argument(1, 0x110000), argument(2, 65)]),
    (error) =>
      objects.viewObjectValue(error, fixture.root)?.prototype ===
      fixture.realm.prototypes.get("range"),
  );
  assert.deepEqual(events, [1]);
});

test("String.fromCharCode preserves ToUint16 boundaries and lone surrogates", () => {
  const fixture = setup("fromCharCode");
  const points = [
    0,
    -0,
    1.9,
    -1.9,
    65535,
    65536,
    65537,
    -65537,
    NaN,
    Infinity,
    -Infinity,
    0xd800,
    0xdfff,
  ];
  assert.equal(fixture.call([]), "");
  assert.equal(fixture.call(points), String.fromCharCode(...points));
  assert.equal(fixture.call([null, false, true, "0x41"]), "\0\0\x01A");
});
test("String.fromCharCode builds large BMP argument lists exactly", () => {
  const fixture = setup("fromCharCode");
  const points = Array.from({ length: 20000 }, (_, index) =>
    index % 3 === 0 ? 0xd800 + (index % 0x800) : 65 + (index % 26),
  );
  assert.equal(fixture.call(points), String.fromCharCode(...points));
});
test("String.fromCharCode converts in order and stops on abrupt completion", () => {
  const fixture = setup("fromCharCode");
  const events: number[] = [];
  const marker = {};
  function argument(index: number, value: number, abrupt = false) {
    const object = objects.createObject<ScriptPropertyKey, unknown>(
      fixture.realm.objectPrototype,
    );
    const valueOf = objects.createCallableObject<ScriptPropertyKey, unknown>(
      fixture.realm.functionPrototype,
      () => {
        events.push(index);
        if (abrupt) throw marker;
        return value;
      },
    );
    objects.createDataProperty(object, "valueOf", valueOf, fixture.hooks);
    return object;
  }
  assert.equal(fixture.call([argument(1, 65), argument(2, 65537)]), "A\x01");
  assert.deepEqual(events, [1, 2]);
  events.length = 0;
  assert.throws(
    () =>
      fixture.call([argument(1, 65), argument(2, 66, true), argument(3, 67)]),
    (error) => error === marker,
  );
  assert.deepEqual(events, [1, 2]);
});
