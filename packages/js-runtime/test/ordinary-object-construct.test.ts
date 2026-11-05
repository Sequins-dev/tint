import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
test("construction uses a distinct own capability and forwards newTarget and arguments", () => {
  assert.equal(typeof objects.createConstructorObject, "function");
  const result = { value: 42 };
  let received: unknown;
  const constructor = objects.createConstructorObject<string, unknown>(
    undefined,
    undefined,
    (args, target) => {
      received = target;
      assert.deepEqual(args, [42]);
      return result;
    },
  );
  const target = objects.createConstructorObject<string, unknown>(
    undefined,
    undefined,
    () => undefined,
  );
  assert.equal(objects.isCallableObject(constructor), false);
  assert.deepEqual(
    objects.constructObject(
      constructor,
      [42],
      { value: target, object: target },
      undefined,
    ),
    { error: "none", value: result },
  );
  assert.equal(received, target);
  const callable = objects.createCallableObject<string, unknown>(
    undefined,
    () => 42,
  );
  for (const object of [undefined, callable, objects.createObject(constructor)])
    assert.equal(
      objects.constructObject(
        object,
        [],
        { value: target, object: target },
        undefined,
      ).error,
      "type",
    );
  assert.equal(
    objects.constructObject(
      constructor,
      [],
      { value: callable, object: callable },
      undefined,
    ).error,
    "type",
  );
});
