import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasUnicodeProperty,
  unicodePropertyRanges,
  containsUnicodeRangeSet,
} from "../src/unicode/properties/index.ts";
test("canonical categories, scripts and script extensions preserve UCD distinctions", () => {
  for (const [property, value, point, expected] of [
    ["General_Category", "Unassigned", 0x378, true],
    ["General_Category", "Surrogate", 0xd800, true],
    ["General_Category", "Letter", 0x20bb7, true],
    ["Script", "Han", 0x20bb7, true],
    ["Script", "Hiragana", 0x30fc, false],
    ["Script_Extensions", "Hiragana", 0x30fc, true],
    ["Script_Extensions", "Common", 0x30fc, false],
    ["Script", "Unknown", 0x10ffff, true],
    ["Script", "Katakana_Or_Hiragana", 0x3042, false],
    ["Emoji_Presentation", "", 0x1f600, true],
    ["Assigned", "", 0x378, false],
    ["Assigned", "", 0xd800, true],
  ] as const)
    assert.equal(
      hasUnicodeProperty(property, value, point),
      expected,
      JSON.stringify({ property, value, point }),
    );
  assert.equal(unicodePropertyRanges("Script", "NotAScript"), undefined);
  assert.equal(unicodePropertyRanges("Script", "Katakana_Or_Hiragana"), "");
  const all = unicodePropertyRanges("Any");
  assert.ok(all !== undefined);
  for (const point of [-1, 0x110000, NaN, Infinity, 0.5])
    assert.equal(containsUnicodeRangeSet(all, point), false);
});
test("character properties agree with the host across representative old Unicode ranges", () => {
  const properties = [
    "General_Category=Letter",
    "General_Category=Mark",
    "General_Category=Number",
    "Script=Greek",
    "Script_Extensions=Latin",
    "ASCII",
    "Assigned",
    "Alphabetic",
    "White_Space",
    "ID_Start",
    "ID_Continue",
    "Bidi_Mirrored",
    "Changes_When_NFKC_Casefolded",
    "Extended_Pictographic",
  ];
  for (const expression of properties) {
    const [property, value = ""] = expression.split("=");
    const reference = new RegExp("^\\p{" + expression + "}$", "u");
    for (const point of [
      0, 9, 32, 65, 95, 0x61, 0xdf, 0x301, 0x378, 0x3b1, 0x200c, 0x200d, 0x200e,
      0x2060, 0x212a, 0x3042, 0x30fc, 0x4e00, 0xd800, 0xe000, 0xfe0f, 0x10400,
      0x1f600, 0x20bb7, 0x10ffff,
    ])
      assert.equal(
        hasUnicodeProperty(property!, value, point),
        reference.test(String.fromCodePoint(point)),
        expression + ":" + point,
      );
  }
});
