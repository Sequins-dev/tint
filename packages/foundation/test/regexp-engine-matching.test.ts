import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRegExp, executeRegExp } from "../src/regexp/engine/index.ts";
const cases: readonly (readonly [string, string, string])[] = [
  [String.raw`\p{Script=Han}+`, "u", "a𠮷中"],
  [String.raw`\p{scx=Hira}`, "u", "ー"],
  [String.raw`\p{sc=Hira}`, "u", "ー"],
  [String.raw`\p{scx=Common}`, "u", "ー"],
  [String.raw`\p{General_Category=Letter}+`, "u", "1α中"],
  [String.raw`\p{gc=Unassigned}`, "u", "\u0378"],
  [String.raw`\p{gc=Surrogate}`, "u", "\ud800"],
  [String.raw`\p{Emoji_Presentation}`, "u", "😀"],
  [String.raw`\p{ID_Start}`, "u", "α"],
  [String.raw`\p{White_Space}`, "u", "\u2003"],
  [String.raw`\P{Lowercase_Letter}`, "ui", "a"],
  [String.raw`\P{Lowercase_Letter}`, "vi", "a"],
  [String.raw`[\p{Letter}&&\p{sc=Greek}]`, "v", "aα"],
  ["abc", "i", "aBc"],
  ["[a-z]+", "i", "ABC"],
  ["[^a]", "i", "Ab"],
  ["[a-z]", "iu", "K"],
  ["[a-z]", "i", "K"],
  ["[ſ]", "i", "S"],
  ["[ſ]", "iu", "S"],
  ["ω", "i", "Ω"],
  ["ω", "iu", "Ω"],
  ["ß", "i", "SS"],
  ["ß", "iu", "ẞ"],
  ["ᾀ", "i", "ᾈ"],
  ["ᾀ", "iu", "ᾈ"],
  ["𐐀", "iu", "𐐨"],
  [String.raw`\w+`, "iu", "ſK"],
  [String.raw`\W+`, "iu", "ſK!"],
  [String.raw`\bK\b`, "iu", "K"],
  [String.raw`(k)\1`, "iu", "kK"],
  [String.raw`(?<=(k)\1)b`, "iu", "Kkb"],
  ["(?i:a)(?-i:b)", "", "Ab"],
  ["(?i:a)(?-i:b)", "i", "AB"],
  [String.raw`[[a-z]--[A]]`, "vi", "AB"],
  [String.raw`[[a-z]&&[K]]`, "vi", "K"],
  [String.raw`\P{ASCII}`, "ui", "k"],
  [String.raw`\P{ASCII}`, "vi", "k"],
  [String.raw`[^\P{ASCII}]`, "ui", "k"],
  ["a", "", "baac"],
  ["", "", "abc"],
  ["a|ab", "", "ab"],
  ["ab|a", "", "ab"],
  ["(a|ab)c", "", "abc"],
  ["a*", "", "baaa"],
  ["a*?", "", "aaa"],
  ["a+?b", "", "aaab"],
  ["a{2,4}a", "", "aaaaa"],
  ["a{2,4}?a", "", "aaaaa"],
  ["(?:a?)*b", "", "aaab"],
  ["(?:){3,5}", "", "x"],
  ["(a|(b))+", "", "aba"],
  ["(a)?b", "", "b"],
  ["(?<x>a)|(?<x>b)", "", "b"],
  [String.raw`(a+)\1`, "", "aaaaa"],
  [String.raw`\1(a)`, "", "a"],
  [String.raw`(a)?b\1`, "", "b"],
  [String.raw`(?<x>a)\k<x>`, "", "aa"],
  ["(?=(a+))a*b\\1", "", "baaabac"],
  ["(?!(a))b\\1", "", "b"],
  ["(?<=([ab]+)([bc]+))$", "", "abc"],
  ["(?<!a)b", "", "abcb"],
  ["^b$", "m", "a\nb\nc"],
  ["^b$", "", "a\nb\nc"],
  ["a.b", "s", "a\nb"],
  ["a.b", "", "a\nb"],
  [String.raw`\bword\b`, "", "a word!"],
  [String.raw`\Boo\B`, "", "food"],
  ["[a-z\\d]+", "", "##a12z"],
  ["[^a]+", "", "a😀b"],
  [".", "u", "😀"],
  [".", "", "😀"],
  ["[😀-🙏]+", "u", "!😀🙏x"],
  ["[[a-z]--[aeiou]]+", "v", "abcz"],
  [String.raw`[\q{ab|a|}]b`, "v", "ab"],
  [String.raw`[\q{ab|cd}&&\q{ab}]`, "v", "cdab"],
  [String.raw`[^\q{ab}&&a]`, "v", "ab"],
  ["(?s:a.(?-s:.))", "", "a\nb"],
  ["(?m:^a$)", "", "\na\n"],
];
for (const [pattern, flags, input] of cases)
  test(`matching ${pattern} /${flags}`, () => {
    const program = compileRegExp(pattern, flags);
    assert.ok(program.ok, JSON.stringify(program));
    const result = executeRegExp(program.value, input);
    const expected = new RegExp(pattern, flags).exec(input);
    if (expected === null) {
      assert.equal(result.kind, "no-match");
      return;
    }
    assert.equal(result.kind, "match", JSON.stringify(result));
    if (result.kind !== "match") return;
    assert.equal(result.match.start, expected.index);
    assert.equal(result.match.end, expected.index + expected[0].length);
    assert.deepEqual(
      result.match.captures.map((c) =>
        c === undefined ? undefined : input.slice(c.start, c.end),
      ),
      Array.from(expected),
    );
  });
test("sticky and starting index are execution policy, not search approximations", () => {
  const program = compileRegExp("a+", "y");
  assert.ok(program.ok);
  assert.equal(executeRegExp(program.value, "baaa", 0).kind, "no-match");
  const found = executeRegExp(program.value, "baaa", 1);
  assert.equal(found.kind, "match");
  if (found.kind === "match") assert.equal(found.match.end, 4);
  assert.equal(executeRegExp(program.value, "baaa", 4).kind, "no-match");
});
test("backtracking work exhaustion is explicit and never a failed match", () => {
  const program = compileRegExp("(a+)+b", "");
  assert.ok(program.ok);
  assert.equal(
    executeRegExp(program.value, "aaaaaaaaaaaaaaaa", 0, false, 100).kind,
    "limit",
  );
});
test("unimplemented character tables fail explicitly at compilation", () => {
  for (const [pattern, flags] of [[String.raw`\p{RGI_Emoji}`, "v"]]) {
    const result = compileRegExp(pattern!, flags!);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unsupported");
  }
});

test("Unicode starts inside a surrogate pair map to the containing code point", () => {
  for (const flags of ["uy", "vy"]) {
    const program = compileRegExp(".", flags);
    assert.ok(program.ok);
    const result = executeRegExp(program.value, "😀a", 1);
    assert.equal(result.kind, "match");
    if (result.kind === "match") {
      assert.equal(result.match.start, 0);
      assert.equal(result.match.end, 2);
    }
  }
});
test("nested repeats and lookaround captures agree across a deterministic corpus", () => {
  const patterns = [
    "(a*)*",
    "(a?)*",
    "(a?)+",
    "(a?){2,4}",
    "((a)|(b))*",
    "(a|ab)*b",
    "(a|ab)*?b",
    "(?:ab|a)+?",
    "(a*)*?b",
    "(a{0,2})+a",
    "(?=(a|ab))\\1c",
    "(?<=(a+))b",
    "(?<!(a+))b",
    "(?:(?=(a))a|b)+",
    "((a)?b)+",
    "(a|(b))+\\2",
    "(?:)*",
    "(a?){0,0}",
  ];
  const inputs = [
    "",
    "a",
    "b",
    "ab",
    "ba",
    "aa",
    "bb",
    "aba",
    "aab",
    "abb",
    "abac",
    "aaab",
    "baba",
  ];
  for (const pattern of patterns) {
    const program = compileRegExp(pattern, "");
    assert.ok(program.ok, pattern);
    for (const input of inputs) {
      const actual = executeRegExp(program.value, input),
        expected = new RegExp(pattern).exec(input);
      if (expected === null) {
        assert.equal(actual.kind, "no-match", pattern + " " + input);
        continue;
      }
      assert.equal(actual.kind, "match", pattern + " " + input);
      if (actual.kind !== "match") continue;
      assert.equal(actual.match.start, expected.index, pattern + " " + input);
      assert.deepEqual(
        actual.match.captures.map((c) =>
          c === undefined ? undefined : input.slice(c.start, c.end),
        ),
        Array.from(expected),
        pattern + " " + input,
      );
    }
  }
});

test("Unicode-set folding canonicalizes strings and complements before matching", () => {
  // ECMAScript MaybeSimpleCaseFolding/CharacterComplement; Node 24.12 differs
  // on these cases, so its result is not used as the expected value.
  for (const [pattern, input, expected] of [
    [String.raw`[\q{ab|a}]b`, "AB", "match"],
    [String.raw`\P{ASCII}`, "K", "no-match"],
    [String.raw`[^\P{ASCII}]`, "K", "match"],
  ] as const) {
    const compiled = compileRegExp(pattern, "vi");
    assert.ok(compiled.ok, JSON.stringify(compiled));
    assert.equal(executeRegExp(compiled.value, input).kind, expected);
  }
});

test("folding ranges, backreferences and boundaries agree across legacy and Unicode modes", () => {
  const patterns = [
    "[a-z]",
    "[^a-z]",
    "[A-Z]",
    "[ſ-K]",
    "[Σ-Ω]",
    "[ω]",
    "[ß]",
    "[İı]",
    "[𐐀-𐐧]",
    String.raw`\w`,
    String.raw`\W`,
    String.raw`\b.\b`,
    String.raw`(.)\1`,
    "(?i:a)(?-i:b)",
  ];
  const inputs = [
    "a",
    "A",
    "AB",
    "Ab",
    "aa",
    "aA",
    "Kk",
    "ſS",
    "Σς",
    "ΩΩ",
    "ßẞ",
    "ss",
    "İi",
    "ıI",
    "ǰ",
    "ᾀᾈ",
    "𐐀𐐨",
    "😀",
    "!",
    " ",
    "\n",
    "\ud800",
  ];
  for (const flags of ["i", "iu", "iv"])
    for (const pattern of patterns) {
      const compiled = compileRegExp(pattern, flags);
      let reference: RegExp;
      try {
        reference = new RegExp(pattern, flags);
      } catch (error) {
        assert.ok(error instanceof SyntaxError);
        assert.equal(compiled.ok, false);
        continue;
      }
      assert.ok(compiled.ok, JSON.stringify(compiled));
      for (const input of inputs) {
        const actual = executeRegExp(compiled.value, input),
          expected = reference.exec(input);
        const context = JSON.stringify({ pattern, flags, input });
        assert.equal(
          actual.kind,
          expected === null ? "no-match" : "match",
          context,
        );
        if (actual.kind === "match" && expected !== null) {
          assert.equal(actual.match.start, expected.index, context);
          assert.equal(
            actual.match.end,
            expected.index + expected[0].length,
            context,
          );
        }
      }
    }
});
