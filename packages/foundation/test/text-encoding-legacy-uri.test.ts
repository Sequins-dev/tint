import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeUTF16,
  unescapeUTF16,
} from "../src/text/text-encoding/legacy-uri.ts";
test("Annex B escaping matches every UTF16 code unit and preserves lone surrogates", () => {
  for (let unit = 0; unit < 65536; unit++) {
    const text = String.fromCharCode(unit);
    assert.equal(escapeUTF16(text), escape(text));
    assert.equal(unescapeUTF16(escapeUTF16(text)), text);
  }
  assert.equal(escapeUTF16("😀é€"), "%uD83D%uDE00%E9%u20AC");
});
test("legacy unescape consumes only valid two/four-digit escapes and keeps malformed input", () => {
  for (const text of [
    "%",
    "%0",
    "%GG",
    "%u",
    "%u123",
    "%u12Z4",
    "%U0041",
    "%u0041",
    "%ff",
    "%%41",
    "%u%41",
    "%u1F600",
    "%uD800",
    "%uDC00",
    "a%20b%2fc%u0000",
  ])
    assert.equal(unescapeUTF16(text), unescape(text), text);
});
