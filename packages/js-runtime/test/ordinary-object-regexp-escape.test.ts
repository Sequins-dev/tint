import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeRegExpText } from "../src/objects/regexp-escape.ts";
test("RegExp escaping matches every UTF-16 unit and preserves paired surrogates", () => {
  for (let code = 0; code < 65536; code++) {
    const text = String.fromCharCode(code);
    assert.equal(escapeRegExpText(text), RegExp.escape(text), String(code));
    assert.equal(
      escapeRegExpText("_" + text),
      RegExp.escape("_" + text),
      "embedded " + code,
    );
  }
  for (const text of [
    "",
    "abc",
    "a-b/c",
    "\ud83d\ude00",
    "\ud800x\udc00",
    "\ud800\ud800\udc00\udc00",
  ])
    assert.equal(escapeRegExpText(text), RegExp.escape(text));
});
