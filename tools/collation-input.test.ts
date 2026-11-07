import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseCollationRoot } from "./collation-root-input.ts";
import { compileCollationTailoring } from "./collation-tailoring.ts";
const header =
  "# VERSION: UCA=17.0.0, UCD=17.0.0\n[Unified_Ideograph 4E00..4E01]\n";
const source =
  header +
  `FDD0 0034;[10,05,05]
0061;[2A,05,05]
0041;[2A,05,9C]
0062;[2C,05,05]
0065;[32,05,05]
0045;[32,05,9C]
0308;[,96,05]
FDD1 004C;[2A 02 02,05,05]
2E80;[U+4E00,70,20]
2F00;[U+4E00,10]
F900;[U+4E00]
`;
test("fractional references select exactly primary, secondary and tertiary fields", () => {
  const root = parseCollationRoot(source),
    base = root.rows.get("豈")?.[0];
  assert.ok(base);
  assert.equal(root.numericPrimary, 0x10000000);
  assert.deepEqual(root.rows.get("⺀"), [[base[0], 0x7000, 0x2000]]);
  assert.deepEqual(root.rows.get("⼀"), [[base[0], 0x0500, 0x1000]]);
  assert.ok(root.rows.has("\ufdd1L"));
  assert.equal(root.rows.has("\ufdd04"), false);
  assert.throws(() => parseCollationRoot(source.replace("17.0.0", "16.0.0")));
  assert.throws(() => parseCollationRoot(source + "F901;[U+4E02]\n"));
});
function xml(rules: string, attrs = ""): string {
  return `<ldml><collations><collation type="standard" ${attrs}><cr><![CDATA[${rules}]]></cr></collation></collations></ldml>`;
}
test("tailorings apply ordered relations, expansions and canonical keys", () => {
  const root = parseCollationRoot(source),
    files = new Map([["xx", xml("&AE<<ä<<<Ä")]]),
    tailoring = compileCollationTailoring(root, files, "xx", "standard"),
    rows = new Map(tailoring.changes),
    lower = rows.get("a\u0308"),
    upper = rows.get("A\u0308");
  assert.ok(lower && upper);
  assert.equal(lower.length, 2);
  assert.equal(upper.length, 2);
  assert.equal(lower[0]?.[0], root.rows.get("A")?.[0]?.[0]);
  assert.ok(lower[1]![1] > 0x0500);
  assert.ok(upper[1]![2] % 16384 > lower[1]![2] % 16384);
  assert.equal(Math.floor(upper[0]![2] / 16384), 2);
  assert.equal(Math.floor(lower[0]![2] / 16384), 0);
});
test("data policy skips provisional profiles and rejects unsupported grammar", () => {
  const root = parseCollationRoot(source);
  assert.deepEqual(
    compileCollationTailoring(
      root,
      new Map([["xx", xml("&a<b", 'draft="provisional"')]]),
      "xx",
      "standard",
    ).changes,
    [],
  );
  assert.throws(() =>
    compileCollationTailoring(
      root,
      new Map([["xx", xml("[mystery]")]]),
      "xx",
      "standard",
    ),
  );
  assert.throws(() =>
    compileCollationTailoring(
      root,
      new Map([["xx", xml("[import xx-u-co-standard]")]]),
      "xx",
      "standard",
    ),
  );
});
test("checked-in packed collation bytes match the generator output manifest", () => {
  const manifest = JSON.parse(
    readFileSync("tools/collation-data-output.json", "utf8"),
  );
  assert.equal(manifest.unicodeVersion, "17.0.0");
  assert.equal(manifest.cldrVersion, "48");
  assert.equal(
    createHash("sha256")
      .update(readFileSync("packages/js-runtime/src/objects/collation-data.ts"))
      .digest("hex"),
    manifest.outputSha256,
  );
  assert.equal(manifest.profiles.length, 8);
  assert.ok(manifest.rootMappings > 47000);
});
