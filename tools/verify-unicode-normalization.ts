import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { normalizeUnicode } from "@tint/foundation/unicode/normalization";

const path = process.argv[2];
if (path === undefined)
  throw Error(
    "usage: node tools/verify-unicode-normalization.ts <Unicode17 NormalizationTest.txt>",
  );
const bytes = readFileSync(path),
  sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256,
  "5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db",
);
let rows = 0,
  assertions = 0;
for (const line of new TextDecoder().decode(bytes).split("\n")) {
  const text = line.split("#")[0]!.trim();
  if (text.length === 0 || text.startsWith("@")) continue;
  const columns = text
    .split(";")
    .slice(0, 5)
    .map((field) =>
      String.fromCodePoint(
        ...field
          .trim()
          .split(/\s+/)
          .map((point) => parseInt(point, 16)),
      ),
    );
  for (const [form, expected] of [
    ["NFC", [1, 1, 1, 3, 3]],
    ["NFD", [2, 2, 2, 4, 4]],
    ["NFKC", [3, 3, 3, 3, 3]],
    ["NFKD", [4, 4, 4, 4, 4]],
  ] as const) {
    for (let column = 0; column < 5; column++) {
      assert.equal(
        normalizeUnicode(columns[column]!, form),
        columns[expected[column]!]!,
        form + ": " + text,
      );
      assertions++;
    }
  }
  rows++;
}
console.log(
  JSON.stringify({
    kind: "unicode-algorithm-conformance",
    test262: false,
    unicodeVersion: "17.0.0",
    inputSha256: sha256,
    rows,
    assertions,
    failed: 0,
  }),
);
