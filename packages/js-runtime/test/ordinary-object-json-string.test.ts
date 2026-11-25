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
test("JSON strings quote plain runs whole and escape wherever a special unit falls", () => {
  for (const prefix of ["", "plain text "])
    for (const special of [
      '"',
      "\\",
      "\n",
      "\u0001",
      "😀",
      "\ud800",
      "\udfff",
      "é",
    ])
      for (const suffix of ["", " tail", "\ud83d"]) {
        const value = prefix + special + suffix;
        assert.equal(quoteJSONString(value), JSON.stringify(value));
      }
  const long = "x".repeat(1000);
  assert.equal(quoteJSONString(long), JSON.stringify(long));
});
