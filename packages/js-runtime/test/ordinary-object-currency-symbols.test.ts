import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { currencySymbol } from "../src/objects/currency-symbols.ts";
import {
  currencySymbolFields,
  currencySymbolOwners,
  currencySymbolParents,
} from "../src/objects/currency-symbol-data.ts";

test("ordinary and narrow currency symbols have independent inherited fallback", () => {
  assert.equal(currencySymbol("en", "USD", false), "$");
  assert.equal(currencySymbol("en", "CAD", false), "CA$");
  assert.equal(currencySymbol("en", "CAD", true), "$");
  assert.equal(currencySymbol("en-GB", "USD", false), "US$");
  assert.equal(currencySymbol("de", "CHF", true), "Fr.");
  assert.equal(currencySymbol("en", "ZZZ", false), "ZZZ");
  assert.equal(currencySymbol("en", "ZZZ", true), "ZZZ");
});
test("symbol ownership follows the numeric registry's traditional-Chinese alias", () => {
  assert.equal(currencySymbol("zh-TW", "TWD", false), "$");
  assert.equal(currencySymbol("zh-Hant-TW", "TWD", false), "$");
  assert.equal(currencySymbol("zh-CN", "TWD", false), "NT$");
  assert.equal(currencySymbol("zh-CN", "TWD", true), "NT$");
  assert.equal(currencySymbol("zh-TW-u-nu-hanidec", "TWD", false), "$");
});
test("currency lookup preserves actual labels and handles unmatched locales", () => {
  assert.equal(currencySymbol("fr", "USD", false), "$US");
  assert.equal(currencySymbol("ar", "AED", false), "د.إ.\u200f");
  assert.equal(currencySymbol("zxx", "USD", false), "USD");
});
test("currency tables are sorted, unique and complete against their manifest", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../currency-symbol-data-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    currencySymbolFields.split("\n").length,
    manifest.counts.symbolFields,
  );
  assert.equal(currencySymbolOwners.split("\n").length, 860);
  assert.equal(currencySymbolParents.split("\n").length, 198);
  for (const table of [
    currencySymbolFields,
    currencySymbolOwners,
    currencySymbolParents,
  ]) {
    const keys = table.split("\n").map((row) => row.slice(0, row.indexOf("|")));
    assert.deepEqual(keys, [...new Set(keys)].sort());
  }
  const output = readFileSync(
    new URL("../src/objects/currency-symbol-data.ts", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(output).digest("hex"),
    manifest.output.sha256,
  );
});
