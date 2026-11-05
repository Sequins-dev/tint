import { test } from "node:test";
import assert from "node:assert/strict";
import * as encoding from "../src/text/text-encoding/index.ts";

test("URI encoding matches ECMAScript ASCII and Unicode boundaries", () => {
  const inputs = [
    "",
    ";/?:@&=+$,#-_.!~*'()",
    "\0\ufeffé€😀",
    "\ud7ff\ue000",
    String.fromCodePoint(0x10ffff),
  ];
  for (let unit = 0; unit < 128; unit++) inputs.push(String.fromCharCode(unit));
  for (const input of inputs)
    for (const component of [false, true]) {
      const expected = component ? encodeURIComponent(input) : encodeURI(input);
      assert.deepEqual(encoding.encodeURIString(input, component), {
        error: "none",
        value: expected,
      });
      assert.deepEqual(encoding.decodeURIString(expected, component), {
        error: "none",
        value: input,
      });
    }
});
test("URI encoding rejects unpaired surrogates before replacement encoding", () => {
  for (const input of [
    "\ud800",
    "\udfff",
    "a\ud800b",
    "\ud800\ud800",
    "\udc00\ud800",
  ])
    for (const component of [false, true])
      assert.equal(
        encoding.encodeURIString(input, component).error,
        "malformed",
      );
});
test("URI decoding preserves reserved escape spelling, literal UTF16 and BOM", () => {
  for (const input of [
    "%2f%3f%23%3b%3A%40%26%3D%2B%24%2C",
    "%EF%BB%BF",
    "%25%20%F0%9F%98%80",
    "raw\ud800%41",
    "%c2%a9%2f%c2%a9",
  ])
    for (const component of [false, true])
      assert.deepEqual(encoding.decodeURIString(input, component), {
        error: "none",
        value: component ? decodeURIComponent(input) : decodeURI(input),
      });
});
test("URI decoding rejects malformed escapes and UTF8", () => {
  for (const input of [
    "%",
    "%0",
    "%GG",
    "%80",
    "%C0%AF",
    "%C1%BF",
    "%C2",
    "%C2%23",
    "%E0%80%80",
    "%ED%A0%80",
    "%F0%80%80%80",
    "%F4%90%80%80",
    "%F5%80%80%80",
    "%FF",
    "%E2x%82%AC",
  ])
    for (const component of [false, true])
      assert.equal(
        encoding.decodeURIString(input, component).error,
        "malformed",
        input,
      );
});
