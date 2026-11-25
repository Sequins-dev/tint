import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asciiEndOfBytes,
  asciiEndOfText,
  asciiLowercase,
  asciiUppercase,
  copyLatin1,
  latin1Text,
} from "../src/text/latin1.ts";

test("latin1Text makes one unit of each byte in the range", () => {
  const bytes = Uint8Array.from([0x41, 0xe9, 0x00, 0x80, 0xff, 0x7f]);
  assert.equal(latin1Text(bytes, 0, 6), "Aé\u0000\u0080ÿ\u007f");
  for (let begin = 0; begin <= 6; begin++)
    for (let limit = begin; limit <= 6; limit++)
      assert.equal(
        latin1Text(bytes, begin, limit),
        String.fromCharCode(...bytes.subarray(begin, limit)),
      );
});
test("copyLatin1 narrows units up to 0xFF and refuses wider ones", () => {
  const bytes = new Uint8Array(8).fill(0xcc);
  assert.equal(copyLatin1("xaéÿz", 1, 4, bytes, 2), 3);
  assert.deepEqual(
    [...bytes],
    [0xcc, 0xcc, 0x61, 0xe9, 0xff, 0xcc, 0xcc, 0xcc],
  );
  assert.equal(copyLatin1("abĀc", 0, 4, new Uint8Array(4), 0), -1);
  // A wide unit outside the range does not matter.
  assert.equal(copyLatin1("abĀc", 0, 2, new Uint8Array(2), 0), 2);
  assert.equal(copyLatin1("", 0, 0, new Uint8Array(0), 0), 0);
});
test("the ASCII ends are the first unit or byte at 0x80 or more", () => {
  assert.equal(asciiEndOfText("abc\u0080d", 0, 5), 3);
  assert.equal(asciiEndOfText("abc\u0080d", 4, 5), 5);
  assert.equal(asciiEndOfText("abĀ", 0, 2), 2);
  assert.equal(asciiEndOfText("\u007f\ud800", 0, 2), 1);
  assert.equal(asciiEndOfText("", 0, 0), 0);
  const bytes = Uint8Array.from([0x00, 0x7f, 0x80, 0x41]);
  assert.equal(asciiEndOfBytes(bytes, 0, 4), 2);
  assert.equal(asciiEndOfBytes(bytes, 3, 4), 4);
  assert.equal(asciiEndOfBytes(bytes, 1, 1), 1);
});
test("ASCII case mapping changes only ASCII letters", () => {
  let ascii = "";
  for (let unit = 0; unit < 128; unit++) ascii += String.fromCharCode(unit);
  assert.equal(asciiUppercase(ascii), ascii.toUpperCase());
  assert.equal(asciiLowercase(ascii), ascii.toLowerCase());
  // Latin-1 and wider units stay as they are, unlike full Unicode casing.
  assert.equal(asciiUppercase("a\u00e1\u00ff\u0101z"), "A\u00e1\u00ff\u0101Z");
  assert.equal(asciiLowercase("A\u00c1\u0100Z"), "a\u00c1\u0100z");
  assert.equal(asciiUppercase(""), "");
});
test("indices outside the range are invariant failures", () => {
  const bytes = new Uint8Array(4);
  const ranges: readonly (readonly [number, number])[] = [
    [-1, 2],
    [0, 5],
    [3, 2],
    [0.5, 2],
    [0, Number.NaN],
  ];
  for (const [begin, limit] of ranges) {
    assert.throws(() => latin1Text(bytes, begin, limit), /LATIN1_RANGE/);
    assert.throws(() => asciiEndOfBytes(bytes, begin, limit), /LATIN1_RANGE/);
    assert.throws(() => asciiEndOfText("abcd", begin, limit), /LATIN1_RANGE/);
    assert.throws(
      () => copyLatin1("abcd", begin, limit, bytes, 0),
      /LATIN1_RANGE/,
    );
  }
  // The destination must hold the copied range.
  assert.throws(() => copyLatin1("abcd", 0, 4, bytes, 1), /LATIN1_RANGE/);
  assert.throws(() => copyLatin1("abcd", 0, 1, bytes, -1), /LATIN1_RANGE/);
});
