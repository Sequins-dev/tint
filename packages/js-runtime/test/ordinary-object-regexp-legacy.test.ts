import {
  createRegExpLegacyState,
  updateRegExpLegacyState,
  invalidateRegExpLegacyState,
} from "../src/objects/regexp-legacy-state.ts";
import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
type ObjectValue = objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
test("legacy RegExp statics expose branded nonenumerable accessors and compile metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installRegExpIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "RegExp")!
    .value as ObjectValue;
  for (const name of [
    "input",
    "$_",
    "lastMatch",
    "$&",
    "lastParen",
    "$+",
    "leftContext",
    "$`",
    "rightContext",
    "$'",
    "$1",
    "$2",
    "$3",
    "$4",
    "$5",
    "$6",
    "$7",
    "$8",
    "$9",
  ]) {
    const descriptor = objects.getOwnProperty(constructor, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.accessor, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const getter = descriptor.get as ObjectValue;
    assert.equal(objects.getOwnProperty(getter, "name")?.value, "get " + name);
    assert.equal(objects.getOwnProperty(getter, "length")?.value, 0);
    if (name === "input" || name === "$_") {
      const setter = descriptor.set as ObjectValue;
      assert.ok(setter);
      assert.equal(objects.getOwnProperty(setter, "length")?.value, 1);
    } else assert.equal(descriptor.set, undefined);
  }
  const compile = objects.getOwnProperty(realm.regexpPrototype, "compile")
    ?.value as ObjectValue;
  assert.ok(compile);
  assert.equal(objects.getOwnProperty(compile, "length")?.value, 2);
});

test("legacy match state distinguishes absent captures from invalidated state", () => {
  const state = createRegExpLegacyState();
  assert.deepEqual(state.values, Array(14).fill(""));
  updateRegExpLegacyState(state, "za!", {
    start: 1,
    end: 2,
    captures: [{ start: 1, end: 2 }, { start: 1, end: 2 }, undefined],
  });
  assert.deepEqual(state.values, [
    "za!",
    "a",
    "",
    "z",
    "!",
    "a",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  invalidateRegExpLegacyState(state);
  assert.deepEqual(state.values, Array(14).fill(undefined));
  updateRegExpLegacyState(state, "abc", {
    start: 1,
    end: 2,
    captures: [{ start: 1, end: 2 }],
  });
  assert.deepEqual(state.values, [
    "abc",
    "b",
    "",
    "a",
    "c",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
});
