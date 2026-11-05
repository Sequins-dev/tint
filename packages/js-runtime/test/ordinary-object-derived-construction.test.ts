import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";

const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw "unexpected call";
  },
};

test("super construction binds this before fields and preserves newTarget", () => {
  assert.equal(typeof objects.createDerivedConstruction, "function");
  const instance = objects.createObject<string, unknown>(undefined);
  let seenTarget: unknown;
  const base = objects.createConstructorObject<string, unknown>(
    undefined,
    () => undefined,
    (args, target) => {
      assert.deepEqual(args, [42]);
      seenTarget = target;
      return instance;
    },
  );
  const target = objects.createConstructorObject<string, unknown>(
    base,
    () => undefined,
    () => instance,
  );
  let fields = 0;
  const context = objects.createDerivedConstruction<string, unknown>(
    { value: target, object: target },
    undefined,
    (value) => {
      fields++;
      assert.equal(objects.getDerivedThis(context).value, value);
    },
  );
  assert.equal(objects.getDerivedThis(context).error, "reference");
  assert.deepEqual(objects.constructSuper(context, base, [42], undefined), {
    error: "none",
    value: instance,
  });
  assert.equal(seenTarget, target);
  assert.equal(fields, 1);
  assert.equal(objects.getDerivedThis(context).value, instance);
});

test("a second super constructs before rejecting rebinding, without running fields again", () => {
  assert.equal(typeof objects.createDerivedConstruction, "function");
  let calls = 0,
    fields = 0;
  const first = objects.createObject<string, unknown>(undefined);
  const second = objects.createObject<string, unknown>(undefined);
  const base = objects.createConstructorObject<string, unknown>(
    undefined,
    () => undefined,
    () => (++calls === 1 ? first : second),
  );
  const context = objects.createDerivedConstruction<string, unknown>(
    { value: base, object: base },
    undefined,
    () => {
      fields++;
    },
  );
  assert.equal(
    objects.constructSuper(context, base, [], undefined).error,
    "none",
  );
  assert.equal(
    objects.constructSuper(context, base, [], undefined).error,
    "reference",
  );
  assert.equal(calls, 2);
  assert.equal(fields, 1);
  assert.equal(objects.getDerivedThis(context).value, first);
});

test("throwing fields leave this bound while failed construction leaves it uninitialized", () => {
  assert.equal(typeof objects.createDerivedConstruction, "function");
  const instance = objects.createObject<string, unknown>(undefined);
  const base = objects.createConstructorObject<string, unknown>(
    undefined,
    () => undefined,
    () => instance,
  );
  const context = objects.createDerivedConstruction<string, unknown>(
    { value: base, object: base },
    undefined,
    () => {
      throw "field failure";
    },
  );
  assert.equal(
    objects.constructSuper(context, undefined, [], undefined).error,
    "type",
  );
  assert.equal(objects.getDerivedThis(context).error, "reference");
  assert.throws(
    () => objects.constructSuper(context, base, [], undefined),
    (e) => e === "field failure",
  );
  assert.equal(objects.getDerivedThis(context).value, instance);
});

test("derived returns allow objects before super, reject primitives and require initialized this for undefined", () => {
  assert.equal(typeof objects.createDerivedConstruction, "function");
  const object = objects.createObject<string, unknown>(undefined);
  const base = objects.createConstructorObject<string, unknown>(
    undefined,
    () => undefined,
    () => object,
  );
  const context = objects.createDerivedConstruction<string, unknown>(
    { value: base, object: base },
    undefined,
    () => {},
  );
  assert.deepEqual(
    objects.finishDerivedConstruction(
      context,
      { value: object, object },
      hooks,
    ),
    { error: "none", value: object },
  );
  for (const value of [null, 0, false, "x"])
    assert.equal(
      objects.finishDerivedConstruction(
        context,
        { value, object: undefined },
        hooks,
      ).error,
      "type",
    );
  assert.equal(
    objects.finishDerivedConstruction(
      context,
      { value: undefined, object: undefined },
      hooks,
    ).error,
    "reference",
  );
  objects.constructSuper(context, base, [], undefined);
  assert.equal(
    objects.finishDerivedConstruction(
      context,
      { value: undefined, object: undefined },
      hooks,
    ).value,
    object,
  );
});
