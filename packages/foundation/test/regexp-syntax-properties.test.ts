import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegExp } from "../src/regexp/syntax/index.ts";
for (const name of [
  "ASCII",
  "Any",
  "Assigned",
  "Letter",
  "L",
  "gc=Lu",
  "General_Category=Uppercase_Letter",
  "Script=Latin",
  "sc=Grek",
  "scx=Hira",
  "Script_Extensions=Katakana",
  "Alpha",
  "White_Space",
  "space",
  "ExtPict",
  "ID_Start",
  "IDS",
  "cntrl",
  "sc=Qaai",
])
  for (const escape of ["p", "P"])
    test(`Unicode property ${escape}{${name}}`, () => {
      const pattern = `\\${escape}{${name}}`;
      assert.doesNotThrow(() => new RegExp(pattern, "u"));
      const result = parseRegExp(pattern, "u");
      assert.ok(result.ok, JSON.stringify(result));
    });
for (const name of [
  "letter",
  "IsGreek",
  "Script=latin",
  "Script =Latin",
  "sc=Latn ",
  "gc=",
  "gc=Lu=Ll",
  "ASCII=Yes",
  "Bidi_Class=L",
  "Script",
  "Latin",
  "GeneralCategory=Lu",
  "RGI_Emoji",
  "Basic_Emoji",
  "",
  "L L",
  String.raw`\u004c`,
])
  test(`invalid Unicode property ${name}`, () => {
    const pattern = `\\p{${name}}`;
    assert.throws(() => new RegExp(pattern, "u"), SyntaxError);
    const result = parseRegExp(pattern, "u");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "syntax");
  });
for (const pattern of [
  String.raw`\p`,
  String.raw`\pL`,
  String.raw`\p{L`,
  String.raw`[a-\p{L}]`,
  String.raw`[\p{L}-z]`,
])
  test(`invalid property syntax ${pattern}`, () => {
    assert.throws(() => new RegExp(pattern, "u"), SyntaxError);
    const result = parseRegExp(pattern, "u");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "syntax");
  });
test("property aliases resolve to canonical descriptors in class ASTs", () => {
  const result = parseRegExp(String.raw`[\p{gc=Lu}\P{scx=Grek}\p{Alpha}]`, "u");
  assert.ok(result.ok);
  assert.deepEqual(result.value.body, {
    kind: "class",
    inverted: false,
    entries: [
      {
        kind: "property",
        property: "General_Category",
        value: "Uppercase_Letter",
        strings: false,
        inverted: false,
      },
      {
        kind: "property",
        property: "Script_Extensions",
        value: "Greek",
        strings: false,
        inverted: true,
      },
      {
        kind: "property",
        property: "Alphabetic",
        value: "",
        strings: false,
        inverted: false,
      },
    ],
  });
});
test("non-Unicode property-looking escapes remain legacy identity escapes", () => {
  const result = parseRegExp(String.raw`\p{2}`, "");
  assert.ok(result.ok);
  assert.deepEqual(result.value.body, {
    kind: "repeat",
    body: { kind: "character", value: 112 },
    min: 2,
    max: 2,
    greedy: true,
  });
});

test("unlisted binary aliases are rejected even when the host accepts them", () => {
  // ECMAScript Table 66 lists White_Space and space, but not UCD alias WSpace.
  const result = parseRegExp(String.raw`\p{WSpace}`, "u");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "syntax");
});

test("every pinned category and script alias resolves to its canonical name", async () => {
  const { categoryAliases, scriptAliases } =
    await import("../src/regexp/syntax/unicode-property-data.ts");
  for (const [property, aliases] of [
    ["gc", categoryAliases],
    ["sc", scriptAliases],
    ["scx", scriptAliases],
  ] as const) {
    for (let index = 0; index < aliases.length; index += 2) {
      const pattern = `\\p{${property}=${aliases[index]}}`;
      // Node 24 rejects the UCD's Hrkt/Katakana_Or_Hiragana aliases.
      // ECMAScript UnicodeMatchPropertyValue requires the listed UCD aliases;
      // keep those grammar cases covered without using Node as their oracle.
      // The pinned Node host also predates Unicode 17's four added scripts.
      const newerScript = [
        "Beria_Erfe",
        "Sidetic",
        "Tai_Yo",
        "Tolong_Siki",
      ].includes(aliases[index + 1]!);
      if (!newerScript && aliases[index + 1] !== "Katakana_Or_Hiragana")
        assert.doesNotThrow(() => new RegExp(pattern, "u"), pattern);
      const result = parseRegExp(pattern, "u");
      assert.ok(result.ok, pattern);
      const body = result.value.body;
      assert.equal(body.kind, "class");
      if (body.kind === "class") {
        const entry = body.entries[0];
        assert.equal(entry?.kind, "property");
        if (entry?.kind === "property")
          assert.equal(entry.value, aliases[index + 1]);
      }
    }
  }
});

test("Unicode 17 script aliases resolve in both script properties", () => {
  for (const [alias, canonical] of [
    ["Berf", "Beria_Erfe"],
    ["Sidt", "Sidetic"],
    ["Tayo", "Tai_Yo"],
    ["Tols", "Tolong_Siki"],
  ]) {
    for (const property of ["sc", "scx"]) {
      for (const name of [alias, canonical]) {
        const result = parseRegExp(`\\p{${property}=${name}}`, "u");
        assert.ok(result.ok, JSON.stringify(result));
        const body = result.value.body;
        assert.equal(body.kind, "class");
        if (body.kind === "class") {
          const entry = body.entries[0];
          assert.equal(entry?.kind, "property");
          if (entry?.kind === "property") assert.equal(entry.value, canonical);
        }
      }
    }
  }
});
