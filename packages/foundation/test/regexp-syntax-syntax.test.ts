import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRegExp } from "../src/regexp/syntax/index.ts";
const valid = [
  "",
  "a|bc",
  "(?:ab)+?",
  "^a.*$",
  String.raw`\b\w+\B`,
  "[a-z0-9_]",
  "[^]",
  "[]",
  "a{2,4}?",
  "a{2,}",
  "a{0}",
  "(a)\\1",
  "\\1(a)",
  "(?=a)b",
  "(?!a)b",
  "(?<=a)b",
  "(?<!a)b",
  String.raw`\x41\u0042\cC\t\n`,
  "a/b",
  "a\nb",
  "[\\b-\\r]",
  "\\0",
  "(a|b)*",
];
for (const flags of ["", "u", "gimsy", "du"])
  for (const pattern of valid)
    test(`pattern ${JSON.stringify(pattern)} / ${flags}`, () => {
      assert.doesNotThrow(() => new RegExp(pattern, flags));
      const result = parseRegExp(pattern, flags);
      assert.ok(result.ok, JSON.stringify(result));
    });
for (const pattern of [
  "(",
  ")",
  "[",
  "[a",
  "[z-a]",
  "*a",
  "+",
  "?",
  "a**",
  "a{3,2}",
  "\\",
  "(?x)",
  "(?<=x)+",
  "^*",
  "\\b+",
])
  for (const flags of ["", "u"])
    test(`invalid pattern ${JSON.stringify(pattern)} / ${flags}`, () => {
      assert.throws(() => new RegExp(pattern, flags), SyntaxError);
      const result = parseRegExp(pattern, flags);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error?.kind, "syntax");
    });
for (const pattern of [
  String.raw`\8`,
  String.raw`\1`,
  String.raw`\01`,
  String.raw`\xZ`,
  String.raw`\uZ`,
  String.raw`\q`,
  "{",
  "}",
  "]",
  "a{",
  "[\\d-a]",
  "(?=a)*",
])
  test(`legacy-only pattern ${JSON.stringify(pattern)}`, () => {
    assert.doesNotThrow(() => new RegExp(pattern));
    assert.throws(() => new RegExp(pattern, "u"), SyntaxError);
    assert.equal(parseRegExp(pattern, "").ok, true);
    const unicode = parseRegExp(pattern, "u");
    assert.equal(unicode.ok, false);
    if (!unicode.ok) assert.equal(unicode.error?.kind, "syntax");
  });
for (const flags of ["gg", "uv", "vu", "z", "π", "G", "dd", "vv"])
  test(`invalid flags ${flags}`, () => {
    const result = parseRegExp("a", flags);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error?.kind, "syntax");
  });
test("AST preserves captures, forward references, lazy counts and class ranges", () => {
  const result = parseRegExp(String.raw`\2(a)(b)[c-f\d]{2,4}?`, "du");
  assert.ok(result.ok);
  assert.equal(result.value.captures, 2);
  assert.equal(result.value.flags.indices, true);
  const body = result.value.body;
  assert.equal(body.kind, "sequence");
  if (body.kind !== "sequence") return;
  assert.deepEqual(body.terms[0], { kind: "backreference", capture: 2 });
  const repeat = body.terms[3];
  assert.equal(repeat?.kind, "repeat");
  if (repeat?.kind !== "repeat") return;
  assert.equal(repeat.min, 2);
  assert.equal(repeat.max, 4);
  assert.equal(repeat.greedy, false);
  assert.deepEqual(repeat.body, {
    kind: "class",
    inverted: false,
    entries: [
      { kind: "range", from: 99, to: 102 },
      { kind: "category", category: "digit", inverted: false },
    ],
  });
});
test("AST decodes Unicode pairs and legacy octal without changing capture counts", () => {
  for (const [pattern, flags, expected] of [
    [String.raw`\uD83D\uDE00`, "u", 0x1f600],
    [String.raw`\u{1F600}`, "u", 0x1f600],
    [String.raw`\123`, "", 83],
    [String.raw`[\1]`, "", 1],
  ] as const) {
    const result = parseRegExp(pattern, flags);
    assert.ok(result.ok);
    assert.equal(result.value.captures, 0);
    assert.deepEqual(
      result.value.body,
      pattern.startsWith("[")
        ? {
            kind: "class",
            inverted: false,
            entries: [{ kind: "range", from: expected, to: expected }],
          }
        : { kind: "character", value: expected },
    );
  }
});
test("resource exhaustion is distinct from invalid grammar", () => {
  for (const pattern of [
    "(".repeat(130) + "x" + ")".repeat(130),
    "a{9007199254740992}",
  ]) {
    const result = parseRegExp(pattern, "");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "limit");
  }
});

test("deterministic syntax corpus agrees with the reference for implemented grammar", () => {
  const alphabet = "ab01289()[]{}?*+|^$,-\\dBcux:";
  let seed = 0x1256;
  for (let i = 0; i < 12000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const length = seed % 12;
    let pattern = "";
    for (let j = 0; j < length; j++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pattern += alphabet.charAt(seed % alphabet.length);
    }
    for (const flags of ["", "u"]) {
      let accepted = true;
      try {
        new RegExp(pattern, flags);
      } catch {
        accepted = false;
      }
      const actual = parseRegExp(pattern, flags);
      if (!actual.ok && actual.error.kind !== "syntax") continue;
      assert.equal(
        actual.ok,
        accepted,
        JSON.stringify({ pattern, flags, actual }),
      );
    }
  }
});

test("forward numeric references include named captures", () => {
  const pattern = String.raw`\1(?<name>a)`;
  assert.doesNotThrow(() => new RegExp(pattern, "u"));
  const result = parseRegExp(pattern, "u");
  assert.ok(result.ok);
  assert.deepEqual(result.value.names, [{ name: "name", capture: 1 }]);
});
