import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
test("immutable prototypes reject changes without preventing own-property extension", () => {
  assert.equal(typeof objects.makePrototypeImmutable, "function");
  const root = objects.createObject<string, unknown>(undefined);
  objects.makePrototypeImmutable(root);
  assert.equal(objects.setPrototype(root, undefined), true);
  assert.equal(
    objects.setPrototype(root, objects.createObject(undefined)),
    false,
  );
  assert.equal(root.prototype, undefined);
  assert.equal((root.internalFlags & 1) !== 0, true);
  const child = objects.createObject(root);
  assert.equal(objects.setPrototype(child, undefined), true);
});
test("prototype membership excludes the receiver and follows the current chain", () => {
  assert.equal(typeof objects.hasPrototype, "function");
  const root = objects.createObject<string, unknown>(undefined);
  const middle = objects.createObject<string, unknown>(root);
  const leaf = objects.createObject<string, unknown>(middle);
  assert.equal(objects.hasPrototype(leaf, root), true);
  assert.equal(objects.hasPrototype(leaf, middle), true);
  assert.equal(objects.hasPrototype(root, root), false);
  assert.equal(objects.hasPrototype(root, leaf), false);
  objects.setPrototype(middle, undefined);
  assert.equal(objects.hasPrototype(leaf, root), false);
});
