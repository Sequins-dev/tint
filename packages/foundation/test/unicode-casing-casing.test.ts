import assert from "node:assert/strict";
import { test } from "node:test";
import {
  unicodeLowercase,
  unicodeUppercase,
} from "../src/unicode/casing/index.ts";

test("full Unicode casing expands mappings and preserves unpaired surrogates", () => {
  for (const text of [
    "abcXYZ",
    "Straße",
    "ﬃ",
    "İ",
    "ı",
    "ΐ",
    "𐐀𐐨",
    "\ud800abc\udfff",
    "ὈΔΥΣΣΕΎΣ",
  ]) {
    assert.equal(unicodeUppercase(text), text.toUpperCase());
    assert.equal(unicodeLowercase(text), text.toLowerCase());
  }
});
test("final sigma uses cased context through case-ignorable characters", () => {
  for (const text of [
    "Σ",
    "ΟΣ",
    "ΟΣΑ",
    "ΟΣ\u0301",
    "ΟΣ\u0301Α",
    "Ο'Σ",
    "Ο.Σ",
    "Ο Σ",
    "AΣΣ",
    "AΣ'",
    "AΣ'A",
    "𐐀Σ",
  ])
    assert.equal(unicodeLowercase(text), text.toLowerCase(), text);
});
test("single-codepoint casing agrees with the host across Unicode", () => {
  for (let point = 0; point <= 0x10ffff; point++) {
    const text = String.fromCodePoint(point);
    // Unicode 17 additions absent from the Node 24 Unicode 16 reference.
    const upper =
      point === 0xa7cf || point === 0xa7d3 || point === 0xa7d5
        ? point - 1
        : point >= 0x16ebb && point <= 0x16ed3
          ? point - 27
          : undefined;
    const lower =
      point === 0xa7ce || point === 0xa7d2 || point === 0xa7d4
        ? point + 1
        : point >= 0x16ea0 && point <= 0x16eb8
          ? point + 27
          : undefined;
    assert.equal(
      unicodeLowercase(text),
      lower === undefined ? text.toLowerCase() : String.fromCodePoint(lower),
      String(point),
    );
    assert.equal(
      unicodeUppercase(text),
      upper === undefined ? text.toUpperCase() : String.fromCodePoint(upper),
      String(point),
    );
  }
});
