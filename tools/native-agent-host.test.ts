import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "@tint/js-runtime/objects";
test("native agent host uses the public realm-aware numeric coercion contract", () => {
  assert.equal(typeof Reflect.get(objects, "numberValue"), "function");
});
