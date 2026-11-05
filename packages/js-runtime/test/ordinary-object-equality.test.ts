import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";

test("loose equality matches the JavaScript primitive conversion matrix", () => {
  assert.equal(typeof objects.looselyEqual, "function");
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const witness = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const values = [
    undefined,
    null,
    true,
    false,
    0,
    -0,
    1,
    42,
    NaN,
    Infinity,
    "",
    " ",
    "0",
    "01",
    "42",
    "0x2a",
    "Infinity",
    "no",
  ];
  for (const left of values)
    for (const right of values) {
      assert.deepEqual(objects.looselyEqual(left, right, hooks, witness), {
        error: "none",
        value: left == right,
      });
    }
});
