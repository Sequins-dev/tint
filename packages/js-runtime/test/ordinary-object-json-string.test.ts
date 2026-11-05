import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteJSONString } from "../src/objects/json-string.ts";
test("JSON strings escape controls and unpaired surrogates without altering pairs", () => {
  for (const value of [
    "",
    '"\\\b\f\n\r\t',
    "/é€😀\u2028\u2029",
    "\ud800x\udfff",
    "\0\ufeff",
  ])
    assert.equal(quoteJSONString(value), JSON.stringify(value));
  for (let unit = 0; unit <= 65535; unit++) {
    const value = String.fromCharCode(unit);
    assert.equal(quoteJSONString(value), JSON.stringify(value), String(unit));
  }
});
