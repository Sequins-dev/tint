import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegExp } from "../src/regexp/syntax/index.ts";
const valid = [
  "",
  "x",
  "[]",
  "[^]",
  "[a-z]",
  "[a&&b]",
  "[a--b--c]",
  "[[a-z]&&[^aeiou]]",
  "[a[b]c]",
  String.raw`[\q{ab|cd|}]`,
  String.raw`[^\q{a|😀}]`,
  String.raw`[^\q{ab}&&a]`,
  String.raw`[^a--\q{ab}]`,
  String.raw`\p{RGI_Emoji}`,
  String.raw`[\p{Basic_Emoji}]`,
  String.raw`[\!\#\&\%\,\:\;\<\=\>\@\~\-]`,
  String.raw`[\b\n\u{1f600}]`,
  "[&!#$%*+,.:;<=>?@^`~]",
  String.raw`\1[[a]b](c)`,
  String.raw`[\q{\|\}\[}]`,
];
const invalid = [
  "[a&&]",
  "[&&a]",
  "[a&&&b]",
  "[a&&b--c]",
  "[a--b&&c]",
  "[ab&&c]",
  "[a&&bc]",
  "[a-z&&b]",
  "[a&&b-z]",
  "[a-]",
  "[-a]",
  "[z-a]",
  "[a-[b]]",
  "[[a]-b]",
  "[a/b]",
  "[()]",
  "[{}]",
  "[a|b]",
  String.raw`[^\q{ab}]`,
  String.raw`[^\q{}]`,
  String.raw`[^\p{RGI_Emoji}]`,
  String.raw`\P{RGI_Emoji}`,
  String.raw`[\q{\d}]`,
  String.raw`[\q{[a]}]`,
  String.raw`[\q{a-b}]`,
  String.raw`[\q{a]`,
  String.raw`\q{ab}`,
  String.raw`\8`,
  String.raw`\c1`,
  String.raw`\a`,
  "(?=a)*",
  "{",
  "]",
  "}",
  String.raw`[\p{L}-z]`,
];
for (const pattern of valid)
  test(`Unicode set valid ${pattern}`, () => {
    assert.doesNotThrow(() => new RegExp(pattern, "v"));
    const result = parseRegExp(pattern, "v");
    assert.ok(result.ok, JSON.stringify(result));
  });
for (const pattern of invalid)
  test(`Unicode set invalid ${pattern}`, () => {
    assert.throws(() => new RegExp(pattern, "v"), SyntaxError);
    const result = parseRegExp(pattern, "v");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "syntax");
  });
for (const c of [
  "&",
  "!",
  "#",
  "$",
  "%",
  "*",
  "+",
  ",",
  ".",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "^",
  "`",
  "~",
])
  test(`reserved doubled set punctuation ${c}`, () => {
    const pattern = "[a" + c + c + "]";
    assert.throws(() => new RegExp(pattern, "v"), SyntaxError);
    const result = parseRegExp(pattern, "v");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "syntax");
  });
test("deep set nesting uses the work budget instead of a depth cap", () => {
  const result = parseRegExp("[".repeat(4096) + "a" + "]".repeat(4096), "v");
  assert.ok(result.ok);
});

test("set AST preserves operation boundaries and decoded string alternatives", () => {
  const result = parseRegExp(String.raw`[[a-z]--\q{ab|\u{1f600}|}]`, "v");
  assert.ok(result.ok);
  assert.deepEqual(result.value.body, {
    kind: "unicode-set",
    body: {
      kind: "subtraction",
      operands: [
        {
          kind: "union",
          operands: [
            { kind: "entry", entry: { kind: "range", from: 97, to: 122 } },
          ],
        },
        { kind: "strings", alternatives: ["ab", "😀", ""] },
      ],
    },
  });
});
test("Unicode-set mode retains separate flags and code-point character semantics", () => {
  const result = parseRegExp("😀[😀]", "v");
  assert.ok(result.ok);
  assert.equal(result.value.flags.unicode, false);
  assert.equal(result.value.flags.unicodeSets, true);
  const body = result.value.body;
  assert.equal(body.kind, "sequence");
  if (body.kind === "sequence")
    assert.deepEqual(body.terms[0], { kind: "character", value: 128512 });
});
test("deterministic set grammar corpus agrees with the independent host parser", () => {
  const atoms = [
    "a",
    "b",
    "[a-z]",
    "[^a]",
    String.raw`\q{ab}`,
    String.raw`\q{}`,
    String.raw`\q{a|b}`,
    String.raw`\d`,
    String.raw`\p{RGI_Emoji}`,
    "a-z",
    "!",
    String.raw`\-`,
  ];
  for (const left of atoms)
    for (const right of atoms)
      for (const operator of ["", "&&", "--", "-"])
        for (const prefix of ["[", "[^"]) {
          const pattern = prefix + left + operator + right + "]";
          let expected = true;
          try {
            new RegExp(pattern, "v");
          } catch {
            expected = false;
          }
          const result = parseRegExp(pattern, "v");
          assert.equal(
            result.ok,
            expected,
            pattern + " " + JSON.stringify(result),
          );
        }
});
