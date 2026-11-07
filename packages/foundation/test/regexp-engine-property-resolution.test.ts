import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRegExp, executeRegExp } from "../src/regexp/engine/index.ts";
import { propertyNames } from "../src/unicode/properties/data.ts";

test("compiled property matching never revisits the immutable property-name index", () => {
  const cases: readonly (readonly [string, string, string, boolean])[] = [
    [String.raw`^\p{General_Category=Decimal_Number}+$`, "u", "09𝟠", true],
    [String.raw`^\P{Script=Greek}+$`, "u", "Latin!", true],
    [String.raw`^\p{White_Space}+$`, "u", " \t", true],
    [String.raw`^[\p{gc=Letter}&&\p{sc=Greek}]+$`, "v", "αβ", true],
    [
      String.raw`^[[\p{sc=Greek}]--[\p{gc=Lowercase_Letter}]]+$`,
      "v",
      "ΑΩ",
      true,
    ],
    [String.raw`^\P{Lowercase_Letter}$`, "iu", "a", true],
    [String.raw`^\P{Lowercase_Letter}$`, "iv", "a", false],
    [String.raw`^[^\p{General_Category=Decimal_Number}]+$`, "u", "aβ", true],
    [String.raw`^\p{sc=Katakana_Or_Hiragana}$`, "u", "x", false],
    [String.raw`^\P{sc=Katakana_Or_Hiragana}$`, "u", "x", true],
    [String.raw`^\p{RGI_Emoji}$`, "v", "👨‍👩‍👧", true],
  ];
  const compiled = cases.map(([pattern, flags, input, matches]) => {
    const program = compileRegExp(pattern, flags);
    assert.ok(program.ok, pattern);
    return { program: program.value, input, matches, pattern };
  });
  let reads = 0;
  const descriptors = propertyNames.map((value, index) => {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(propertyNames, key)!;
    // Count real index reads without changing any of the generated table values.
    Object.defineProperty(propertyNames, key, {
      configurable: true,
      enumerable: true,
      get: () => {
        reads++;
        return value;
      },
    });
    return descriptor;
  });
  try {
    for (const { program, input, matches, pattern } of compiled) {
      const result = executeRegExp(program, input);
      assert.equal(result.kind, matches ? "match" : "no-match", pattern);
      if (result.kind === "match") assert.equal(result.match.end, input.length);
    }
    assert.equal(reads, 0, "property names must be resolved before matching");
  } finally {
    descriptors.forEach((descriptor, index) =>
      Object.defineProperty(propertyNames, String(index), descriptor),
    );
  }
});
