import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw "unexpected hook";
  },
};

test("written field types guard ordinary, static and private storage", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const record = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const cls = objects.createBaseClass("Fields", 0, undefined, [], realm, hooks);
  const contract = objects.primitiveContractBit("number");
  const reject = (error: unknown) =>
    (error as objects.OrdinaryObject<ScriptPropertyKey, unknown>).prototype ===
    realm.prototypes.get("type");
  for (const target of [record, cls]) {
    objects.initializeClassFields(
      target,
      [{ name: "count", initialize: () => 1, contract }],
      realm,
      hooks,
    );
    assert.throws(
      () =>
        objects.setProperty(
          target,
          "count",
          "wrong",
          { value: target, object: target },
          hooks,
        ),
      reject,
    );
    assert.equal(objects.getOwnProperty(target, "count")?.value, 1);
  }
  const privateName = objects.createPrivateName("count");
  objects.initializeClassFields(
    record,
    [{ name: "", privateName, initialize: () => 1, contract }],
    realm,
    hooks,
  );
  const receiver = { value: record, object: record };
  assert.equal(
    objects.setPrivateElement(receiver, privateName, "wrong", hooks),
    "type",
  );
  assert.equal(
    objects.getPrivateElement(receiver, privateName, hooks).value,
    1,
  );
});
test("base classes have construct-only behavior and standard constructor/prototype attributes", () => {
  assert.equal(typeof objects.createBaseClass, "function");
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const c = objects.createBaseClass("C", 2, undefined, [], realm, hooks);
  assert.equal(c.prototype, realm.functionPrototype);
  assert.equal(objects.getOwnProperty(c, "name")?.value, "C");
  assert.equal(objects.getOwnProperty(c, "length")?.value, 2);
  const descriptor = objects.getOwnProperty(c, "prototype")!;
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, false);
  const prototype = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(prototype.prototype, realm.objectPrototype);
  assert.equal(objects.getOwnProperty(prototype, "constructor")?.value, c);
  assert.throws(
    () => objects.callObject(c, undefined, [], undefined),
    (error: unknown) =>
      (error as objects.OrdinaryObject<ScriptPropertyKey, unknown>)
        .prototype === realm.prototypes.get("type"),
  );
});
test("class methods are non-enumerable, replaceable and non-constructible", () => {
  assert.equal(typeof objects.defineClassMethod, "function");
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const target = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  objects.defineClassMethod(
    target,
    "method",
    1,
    (receiver, args) => receiver,
    realm,
    hooks,
  );
  const descriptor = objects.getOwnProperty(target, "method")!;
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(method.internalConstruct, undefined);
  assert.equal(method.internalRareSlots?.internalHomeObject, target);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "method");
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(objects.callObject(method, 42, [], undefined).value, 42);
});

test("computed class methods cannot redefine a non-configurable constructor prototype", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const c = objects.createBaseClass("C", 0, undefined, [], realm, hooks);
  assert.throws(
    () =>
      objects.defineClassMethod(
        c,
        "prototype",
        0,
        (receiver, args) => undefined,
        realm,
        hooks,
      ),
    (error: unknown) =>
      (error as objects.OrdinaryObject<ScriptPropertyKey, unknown>)
        .prototype === realm.prototypes.get("type"),
  );
});

test("class accessor definitions merge halves and preserve callable metadata", () => {
  assert.equal(typeof objects.defineClassAccessor, "function");
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const target = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  objects.defineClassAccessor(
    target,
    "x",
    false,
    (receiver, args) => receiver,
    realm,
    hooks,
  );
  const getter = objects.getOwnProperty(target, "x")!
    .get as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  objects.defineClassAccessor(
    target,
    "x",
    true,
    (receiver, args) => args[0],
    realm,
    hooks,
  );
  const descriptor = objects.getOwnProperty(target, "x")!;
  assert.equal(descriptor.get, getter);
  assert.equal(getter.internalRareSlots?.internalHomeObject, target);
  assert.equal(
    (descriptor.set as objects.OrdinaryObject<ScriptPropertyKey, unknown>)
      .internalRareSlots?.internalHomeObject,
    target,
  );
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  assert.equal(objects.getOwnProperty(getter, "name")?.value, "get x");
  assert.equal(objects.getOwnProperty(getter, "length")?.value, 0);
  const setter = descriptor.set as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(setter, "name")?.value, "set x");
  assert.equal(objects.getOwnProperty(setter, "length")?.value, 1);
  assert.equal(getter.internalConstruct, undefined);
  assert.equal(setter.internalConstruct, undefined);
  assert.equal(objects.callObject(getter, 42, [], undefined).value, 42);
  objects.defineClassMethod(target, "x", 0, () => 1, realm, hooks);
  objects.defineClassAccessor(target, "x", false, () => 42, realm, hooks);
  assert.equal(objects.getOwnProperty(target, "x")!.set, undefined);
});
test("source functions expose standard name and length descriptors", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  for (const constructible of [false, true]) {
    const fn = objects.createSourceFunction(
      () => 42,
      constructible,
      realm,
      hooks,
      "self",
      2,
    );
    for (const [key, value] of [
      ["name", "self"],
      ["length", 2],
    ] as const) {
      const descriptor = objects.getOwnProperty(fn, key);
      assert.ok(descriptor);
      assert.equal(descriptor.value, value);
      assert.equal(descriptor.writable, false);
      assert.equal(descriptor.enumerable, false);
      assert.equal(descriptor.configurable, true);
    }
    assert.equal(
      objects.getOwnProperty(fn, "prototype") !== undefined,
      constructible,
    );
    assert.equal(objects.callObject(fn, undefined, [], undefined).value, 42);
  }
});

test("source execution receives its own identity independently of receiver and binding", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  for (const constructible of [false, true]) {
    const seen: unknown[] = [];
    const fn = objects.createSourceFunction(
      (receiver, args, callee) => {
        seen.push(receiver, args[0]);
        return callee;
      },
      constructible,
      realm,
      hooks,
    );
    const other = objects.createSourceFunction(
      () => undefined,
      false,
      realm,
      hooks,
    );
    assert.equal(objects.callObject(fn, other, [42], undefined).value, fn);
    assert.deepEqual(seen, [other, 42]);
    assert.equal(objects.callObject(other, fn, [], undefined).value, undefined);
  }
});

test("source methods capture their home object before their first call", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const home = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const method = objects.createSourceFunction(
    (receiver, args, callee) =>
      objects.getSuperBase(
        callee as objects.OrdinaryObject<ScriptPropertyKey, unknown>,
      ),
    false,
    realm,
    hooks,
    "m",
    0,
    home,
  );
  assert.equal(method.internalRareSlots?.internalHomeObject, home);
  assert.equal(
    objects.callObject(method, 42, [], undefined).value,
    realm.objectPrototype,
  );
  const ordinary = objects.createSourceFunction(
    () => undefined,
    false,
    realm,
    hooks,
  );
  assert.equal(ordinary.internalRareSlots?.internalHomeObject, undefined);
});

test("prepared class prototypes are published unchanged and become the constructor home", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const prototype = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const constructor = objects.createBaseClass(
    "C",
    0,
    undefined,
    [],
    realm,
    hooks,
    prototype,
  );
  assert.equal(
    objects.getOwnProperty(constructor, "prototype")?.value,
    prototype,
  );
  assert.equal(
    objects.getOwnProperty(prototype, "constructor")?.value,
    constructor,
  );
  assert.equal(constructor.internalRareSlots?.internalHomeObject, prototype);
});

test("derived class identities retain separate constructor and instance prototype chains", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const parent = objects.createBaseClass(
    "Parent",
    0,
    undefined,
    [],
    realm,
    hooks,
  );
  const parentPrototype = objects.getOwnProperty(parent, "prototype")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  const prototype = objects.createObject(parentPrototype);
  const derived = objects.createDerivedClass(
    "Derived",
    2,
    undefined,
    [],
    realm,
    hooks,
    parent,
    prototype,
  );
  assert.equal(derived.prototype, parent);
  assert.equal(derived.internalRareSlots?.internalHomeObject, prototype);
  assert.equal(objects.getOwnProperty(derived, "prototype")?.value, prototype);
  assert.equal(prototype.prototype, parentPrototype);
  assert.equal(
    objects.getOwnProperty(prototype, "constructor")?.value,
    derived,
  );
  assert.equal(objects.getOwnProperty(derived, "name")?.value, "Derived");
  assert.equal(objects.getOwnProperty(derived, "length")?.value, 2);
  assert.throws(
    () => objects.callObject(derived, undefined, [], undefined),
    (error: unknown) =>
      (error as objects.OrdinaryObject<ScriptPropertyKey, unknown>)
        .prototype === realm.prototypes.get("type"),
  );
});

test("private class methods install before fields and remain separate from properties", () => {
  assert.equal(typeof objects.initializeClassPrivateMethods, "function");
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const instance = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const name = objects.createPrivateName("#method");
  const method = objects.createClassMethod(
    realm.objectPrototype,
    "#method",
    0,
    () => 42,
    realm,
    hooks,
  );
  objects.initializeClassPrivateMethods(
    instance,
    [{ name, kind: "method", value: method }],
    realm,
  );
  assert.equal(objects.hasPrivateElement(instance, name), true);
  assert.equal(
    objects.getPrivateElement(
      { value: instance, object: instance },
      name,
      hooks,
    ).value,
    method,
  );
  assert.equal(objects.getOwnProperty(instance, "#method"), undefined);
  assert.equal(
    method.internalRareSlots?.internalHomeObject,
    realm.objectPrototype,
  );
  assert.equal(method.internalConstruct, undefined);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "#method");
  assert.equal(objects.callObject(method, instance, [], undefined).value, 42);
  assert.throws(() =>
    objects.initializeClassPrivateMethods(
      instance,
      [{ name, kind: "method", value: method }],
      realm,
    ),
  );
});

test("InitializeInstanceElements checks extensibility once before any private method", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const isTypeError = (error: unknown): boolean =>
    (error as objects.OrdinaryObject<ScriptPropertyKey, unknown>).prototype ===
    realm.prototypes.get("type");
  const log: string[] = [];
  let mode: "extensible" | "sealed" | "throw" = "sealed";
  const receiver = objects.createExoticObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
    {
      isExtensible: () => {
        log.push("isExtensible");
        if (mode === "throw") throw "trap";
        return mode === "extensible";
      },
    },
  );
  const first = objects.createPrivateName("#first"),
    second = objects.createPrivateName("#second");
  const methods: objects.ClassPrivateMethod[] = [
    { name: first, kind: "method", value: 1 },
    { name: second, kind: "accessor", get: 2, set: undefined },
  ];
  // An empty batch never queries the receiver.
  objects.initializeClassPrivateMethods(receiver, [], realm);
  assert.deepEqual(log, []);
  assert.throws(
    () => objects.initializeClassPrivateMethods(receiver, methods, realm),
    isTypeError,
  );
  assert.deepEqual(log, ["isExtensible"]);
  assert.equal(receiver.internalRareSlots?.internalPrivateElements, undefined);
  mode = "throw";
  assert.throws(
    () => objects.initializeClassPrivateMethods(receiver, methods, realm),
    (error: unknown) => error === "trap",
  );
  assert.equal(receiver.internalRareSlots?.internalPrivateElements, undefined);
  mode = "extensible";
  log.length = 0;
  objects.initializeClassPrivateMethods(receiver, methods, realm);
  assert.deepEqual(log, ["isExtensible"]);
  assert.equal(objects.hasPrivateElement(receiver, first), true);
  assert.equal(objects.hasPrivateElement(receiver, second), true);
});

test("private field definition evaluates its initializer before rejecting a non-extensible receiver", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const receiver = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  objects.preventExtensions(receiver);
  const log: string[] = [];
  const name = objects.createPrivateName("#x");
  assert.throws(
    () =>
      objects.initializeClassFields(
        receiver,
        [
          {
            name: "#x",
            privateName: name,
            initialize: () => (log.push("initializer"), 1),
          },
          {
            name: "#y",
            privateName: objects.createPrivateName("#y"),
            initialize: () => (log.push("unreached"), 2),
          },
        ],
        realm,
        hooks,
      ),
    (error: unknown) =>
      (error as objects.OrdinaryObject<ScriptPropertyKey, unknown>)
        .prototype === realm.prototypes.get("type"),
  );
  assert.deepEqual(log, ["initializer"]);
  assert.equal(objects.hasPrivateElement(receiver, name), false);
});

test("super() binds a non-extensible return-override object before private elements reject it", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const isTypeError = (error: unknown): boolean =>
    (error as objects.OrdinaryObject<ScriptPropertyKey, unknown>).prototype ===
    realm.prototypes.get("type");
  const field = objects.createPrivateName("#value");
  const method = objects.createPrivateName("#method");
  for (const name of [field, method]) {
    for (const sealed of [false, true]) {
      // TrojanBase: constructor(object) { return object; }
      const returned = objects.createObject<ScriptPropertyKey, unknown>(
        realm.objectPrototype,
      );
      if (sealed) objects.preventExtensions(returned);
      const base = objects.createConstructorObject<ScriptPropertyKey, unknown>(
        realm.functionPrototype,
        () => undefined,
        (args) => args[0],
      );
      const target = objects.createConstructorObject<
        ScriptPropertyKey,
        unknown
      >(
        base,
        () => undefined,
        () => undefined,
      );
      const context = objects.createDerivedConstruction<
        ScriptPropertyKey,
        unknown
      >({ value: target, object: target }, undefined, (receiver) => {
        const instance = receiver as objects.OrdinaryObject<
          ScriptPropertyKey,
          unknown
        >;
        objects.initializeClassPrivateMethods(
          instance,
          name === method ? [{ name, kind: "method", value: 7 }] : [],
          realm,
        );
        objects.initializeClassFields(
          instance,
          name === field
            ? [{ name: "#value", privateName: name, initialize: () => 42 }]
            : [],
          realm,
          hooks,
        );
      });
      const construct = () =>
        objects.constructSuper(context, base, [returned], undefined);
      if (!sealed) {
        assert.equal(construct().value, returned);
        assert.equal(objects.hasPrivateElement(returned, name), true);
        continue;
      }
      assert.throws(construct, isTypeError);
      assert.equal(objects.hasPrivateElement(returned, name), false);
      // BindThisValue precedes InitializeInstanceElements, so this stays bound.
      assert.equal(objects.getDerivedThis(context).value, returned);
    }
  }
});

test("public accessor metadata uses the source parameter length", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const target = objects.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  objects.defineClassAccessor(
    target,
    "x",
    true,
    () => undefined,
    realm,
    hooks,
    0,
  );
  const setter = objects.getOwnProperty(target, "x")!
    .set as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(setter, "length")?.value, 0);
});
