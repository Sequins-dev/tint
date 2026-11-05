import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinFunction } from "../src/objects/intrinsics.ts";
import {
  createObject,
  ownKeys,
  type ScriptPropertyKey,
  type ObjectHooks,
} from "../src/objects/index.ts";
test("builtin functions define length before name", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const prototype = createObject<ScriptPropertyKey, unknown>(undefined);
  const fn = builtinFunction(prototype, "test", 1, () => undefined, hooks);
  assert.deepEqual(
    ownKeys(fn, () => -1),
    ["length", "name"],
  );
});
