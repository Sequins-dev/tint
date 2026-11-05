import assert from "node:assert/strict";
import { test } from "node:test";
import * as encoding from "../src/text/text-encoding/index.ts";
test("UTF-16 well-formed helpers cover every code unit and surrogate boundary", () => {
  assert.equal(typeof encoding.isWellFormedUTF16, "function");
  assert.equal(typeof encoding.toWellFormedUTF16, "function");
  const isWellFormed = Reflect.get(String.prototype, "isWellFormed");
  const toWellFormed = Reflect.get(String.prototype, "toWellFormed");
  assert.equal(typeof isWellFormed, "function");
  assert.equal(typeof toWellFormed, "function");
  function verify(value: string): void {
    assert.equal(encoding.isWellFormedUTF16(value), isWellFormed.call(value));
    assert.equal(encoding.toWellFormedUTF16(value), toWellFormed.call(value));
  }
  for (let unit = 0; unit <= 0xffff; unit++) verify(String.fromCharCode(unit));
  const units = [0, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff];
  for (const a of units)
    for (const b of units)
      for (const c of units) verify(String.fromCharCode(a, b, c));
  for (const value of [
    "",
    "hello",
    "😀",
    "a\ud800b\udc00c",
    "\ud800\ud800\udc00",
    "\udc00\ud800\udc00",
    "\ufeff",
  ])
    verify(value);
});
