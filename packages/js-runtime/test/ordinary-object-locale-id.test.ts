import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocaleId } from "../src/objects/locale-id.ts";

test("locale grammar distinguishes language identifiers and extension fields", () => {
  const parsed = parseLocaleId(
    "EN-latn-us-1996-u-foo-ca-gregory-t-iw-m0-names-x-A-1",
  );
  assert.deepEqual(parsed, {
    language: {
      language: "en",
      script: "latn",
      region: "us",
      variants: ["1996"],
    },
    extensions: [
      {
        key: "u",
        subtags: [],
        attributes: ["foo"],
        fields: [{ key: "ca", value: "gregory" }],
        language: undefined,
      },
      {
        key: "t",
        subtags: [],
        attributes: [],
        fields: [{ key: "m0", value: "names" }],
        language: { language: "iw", script: "", region: "", variants: [] },
      },
      {
        key: "x",
        subtags: ["a", "1"],
        attributes: [],
        fields: [],
        language: undefined,
      },
    ],
  });
});

test("locale grammar rejects malformed and duplicate subtags without accepting broader BCP47 forms", () => {
  for (const source of [
    "",
    "root",
    "Latn",
    "abcd",
    "i-klingon",
    "x-private",
    "en_US",
    "en--US",
    "en-",
    "-en",
    "en-u",
    "en-x",
    "en-a-z",
    "en-u-12",
    "en-u-0",
    "en-t-m0",
    "en-t-12-foo",
    "en-t-abcd",
    "en-rozaj-ROZAJ",
    "en-a-foo-A-bar",
    "en-t-en-rozaj-ROZAJ",
    "en-\ud800",
    "en-İ",
    "en-１２３",
  ])
    assert.equal(parseLocaleId(source), undefined, source);
});

test("Unicode and transformed keywords have different grammars", () => {
  for (const source of [
    "en-u-ca",
    "en-u-foo-foo-ca-buddhist-ca-gregory",
    "en-t-m0-true",
    "en-t-en",
    "en-0-ab",
    "en-x-u-a-a-1",
  ])
    assert.ok(parseLocaleId(source), source);
  for (const source of [
    "en-u-a0-foo",
    "en-t-ca-foo",
    "en-t-m0-ca",
    "en-a-abcdefghi",
  ])
    assert.equal(parseLocaleId(source), undefined, source);
});
