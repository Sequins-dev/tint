import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
test("iterator intrinsic prototypes share identity behavior and array values identity", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  assert.ok(realm.iteratorPrototype);
  assert.equal(realm.arrayIteratorPrototype.prototype, realm.iteratorPrototype);
  assert.equal(
    realm.stringIteratorPrototype.prototype,
    realm.iteratorPrototype,
  );
  const key = objects.wellKnownSymbol(realm.symbolRegistry, "iterator");
  assert.equal(
    objects.getOwnProperty(realm.arrayPrototype, key)?.value,
    realm.arrayValues,
  );
  assert.equal(
    objects.getOwnProperty(realm.arrayPrototype, "values")?.value,
    realm.arrayValues,
  );
  for (const proto of [
    realm.arrayIteratorPrototype,
    realm.stringIteratorPrototype,
  ]) {
    const next = objects.getOwnProperty(proto, "next")!
      .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
    assert.equal(objects.getOwnProperty(next, "length")?.value, 0);
    assert.equal(next.internalRareSlots?.internalConstruct, undefined);
  }
  const identity = objects.getOwnProperty(realm.iteratorPrototype, key)!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(identity.internalRareSlots!.internalCall!(42, []), 42);
});

test("Iterator base exposes configurable constructor and tag accessors", () => {
  assert.equal(typeof objects.installIteratorConstructor, "function");
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(root);
  objects.installIteratorConstructor(global, realm, hooks);
  const constructor = objects.getOwnProperty(global, "Iterator")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(constructor, "name")?.value, "Iterator");
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  assert.equal(
    objects.getOwnProperty(constructor, "prototype")?.value,
    realm.iteratorPrototype,
  );
  for (const [key, expected] of [
    ["constructor", constructor],
    [objects.wellKnownSymbol(realm.symbolRegistry, "toStringTag"), "Iterator"],
  ] as const) {
    const descriptor = objects.getOwnProperty(realm.iteratorPrototype, key)!;
    assert.ok(descriptor.accessor);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const get = descriptor.get as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    const set = descriptor.set as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(get.internalRareSlots!.internalCall!(undefined, []), expected);
    assert.equal(objects.getOwnProperty(get, "length")?.value, 0);
    assert.equal(objects.getOwnProperty(set, "length")?.value, 1);
    assert.equal(get.internalRareSlots?.internalConstruct, undefined);
    assert.equal(set.internalRareSlots?.internalConstruct, undefined);
  }
});

test("Iterator static factories have standard metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installIteratorConstructor(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "Iterator")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  for (const [name, length] of [
    ["from", 1],
    ["concat", 0],
  ] as const) {
    const descriptor = objects.getOwnProperty(constructor, name);
    assert.ok(descriptor);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "length")?.value, length);
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(method.internalRareSlots?.internalConstruct, undefined);
  }
});

test("Iterator.prototype.toArray has standard method metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installIteratorConstructor(root, realm, hooks);
  const descriptor = objects.getOwnProperty(realm.iteratorPrototype, "toArray");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(method, "length")?.value, 0);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "toArray");
  assert.equal(method.internalRareSlots?.internalConstruct, undefined);
});

for (const [group, names] of [
  ["consuming", ["forEach", "some", "every", "find", "reduce"]],
  ["mapping", ["map", "filter", "flatMap"]],
  ["limiting", ["take", "drop"]],
  ["search and stringification", ["includes", "join"]],
  ["chunking", ["chunks", "windows"]],
] as const) {
  test(`Iterator ${group} methods have standard metadata`, () => {
    const hooks: objects.ObjectHooks<unknown> = {
      undefinedValue: undefined,
      sameValue: Object.is,
      call: () => undefined,
    };
    const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    );
    const realm = objects.createErrorRealm(root, hooks);
    objects.installIteratorConstructor(root, realm, hooks);
    for (const name of names) {
      const descriptor = objects.getOwnProperty(realm.iteratorPrototype, name);
      assert.ok(descriptor, name);
      assert.equal(descriptor.enumerable, false);
      assert.equal(descriptor.writable, true);
      assert.equal(descriptor.configurable, true);
      const method = descriptor.value as objects.OrdinaryObject<
        objects.ScriptPropertyKey,
        unknown
      >;
      assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
      assert.equal(objects.getOwnProperty(method, "name")?.value, name);
      assert.equal(method.internalRareSlots?.internalConstruct, undefined);
    }
  });
}

test("Iterator disposal is a non-constructible zero-argument symbol method", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installIteratorConstructor(root, realm, hooks);
  const descriptor = objects.getOwnProperty(
    realm.iteratorPrototype,
    objects.wellKnownSymbol(realm.symbolRegistry, "dispose"),
  );
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(
    objects.getOwnProperty(method, "name")?.value,
    "[Symbol.dispose]",
  );
  assert.equal(objects.getOwnProperty(method, "length")?.value, 0);
  assert.equal(method.internalRareSlots?.internalConstruct, undefined);
});

test("Iterator joint factories have one required argument and no constructor", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installIteratorConstructor(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "Iterator")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  for (const name of ["zip", "zipKeyed"]) {
    const descriptor = objects.getOwnProperty(constructor, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(method.internalRareSlots?.internalConstruct, undefined);
  }
});

test("iterator disposal is a nonconstructible zero-argument intrinsic", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  const method = objects.getOwnProperty(
    realm.iteratorPrototype,
    objects.wellKnownSymbol(realm.symbolRegistry, "dispose"),
  );
  assert.ok(method);
  assert.equal(method.enumerable, false);
  assert.equal(method.writable, true);
  assert.equal(method.configurable, true);
  const fn = method.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(fn, "name")?.value, "[Symbol.dispose]");
  assert.equal(objects.getOwnProperty(fn, "length")?.value, 0);
  assert.equal(fn.internalRareSlots?.internalConstruct, undefined);
});
