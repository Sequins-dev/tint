import assert from "node:assert/strict";
import test from "node:test";
import { nativeContainmentTimeout } from "./test262-native.ts";

test("native containment budget is explicit, uniform and defaults to 60 seconds", () => {
  assert.equal(nativeContainmentTimeout(undefined), 60000);
  assert.equal(nativeContainmentTimeout("180000"), 180000);
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    " 180000",
    "0x100",
    "4294967296",
  ])
    assert.throws(() => nativeContainmentTimeout(value), /containment timeout/);
});
