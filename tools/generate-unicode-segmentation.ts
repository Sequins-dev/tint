import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "prettier";

/** Generates UAX #29 segmentation property tables and conformance vectors from
 * the pinned Unicode 17.0.0 UCD. Usage:
 *   node tools/generate-unicode-segmentation.ts [local-ucd-directory]
 * Without a directory the files are fetched from unicode.org; every input is
 * verified against its pinned SHA-256 either way. */
const version = "17.0.0";
const sources = [
  [
    "auxiliary/GraphemeBreakProperty.txt",
    "d6b51d1d2ae5c33b451b7ed994b48f1f4dc62b2272a5831e7fd418514a6bae89",
  ],
  [
    "auxiliary/WordBreakProperty.txt",
    "72274cac1e6b919507db35655c3e175aa27274668a1ece95c28d2069f2ad9852",
  ],
  [
    "auxiliary/SentenceBreakProperty.txt",
    "871c0c985ad95125e25b302414065a10839d068970bceb383ecec138f22a0a18",
  ],
  [
    "DerivedCoreProperties.txt",
    "24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08",
  ],
  [
    "emoji/emoji-data.txt",
    "2cb2bb9455cda83e8481541ecf5b6dfda66a3bb89efa3fa7c5297eccf607b72b",
  ],
  [
    "auxiliary/GraphemeBreakTest.txt",
    "e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec",
  ],
  [
    "auxiliary/WordBreakTest.txt",
    "1de23a75f37904abc7d206239ee8d34f8fdf0fb4ab32a7174dfbabbde25419b2",
  ],
  [
    "auxiliary/SentenceBreakTest.txt",
    "12cb47d028ded0c1cb8a28558f95479cbcd24559c46977015c82f3b50a1cc6e4",
  ],
] as const;

// Value orders are part of the generated contract; index 0 is the default.
const graphemeValues = [
  "Other",
  "CR",
  "LF",
  "Control",
  "Extend",
  "ZWJ",
  "Regional_Indicator",
  "Prepend",
  "SpacingMark",
  "L",
  "V",
  "T",
  "LV",
  "LVT",
] as const;
const wordValues = [
  "Other",
  "CR",
  "LF",
  "Newline",
  "Extend",
  "ZWJ",
  "Regional_Indicator",
  "Format",
  "Katakana",
  "Hebrew_Letter",
  "ALetter",
  "Single_Quote",
  "Double_Quote",
  "MidNumLet",
  "MidLetter",
  "MidNum",
  "Numeric",
  "ExtendNumLet",
  "WSegSpace",
] as const;
const sentenceValues = [
  "Other",
  "CR",
  "LF",
  "Extend",
  "Sep",
  "Format",
  "Sp",
  "Lower",
  "Upper",
  "OLetter",
  "Numeric",
  "ATerm",
  "SContinue",
  "STerm",
  "Close",
] as const;
const conjunctValues = ["None", "Linker", "Consonant", "Extend"] as const;

const texts = new Map<string, string>();
const hashes: string[] = [];
const local = process.argv[2];
for (const [name, hash] of sources) {
  let bytes: Uint8Array;
  if (local === undefined) {
    const response = await fetch(
      "https://www.unicode.org/Public/" + version + "/ucd/" + name,
    );
    if (!response.ok) throw new Error(name + ": HTTP " + response.status);
    bytes = new Uint8Array(await response.arrayBuffer());
  } else bytes = readFileSync(join(local, name));
  if (createHash("sha256").update(bytes).digest("hex") !== hash)
    throw new Error(name + ": Unicode " + version + " checksum mismatch");
  texts.set(name, new TextDecoder().decode(bytes));
  hashes.push("// " + name + " SHA-256: " + hash);
}
function text(name: string): string {
  const value = texts.get(name);
  if (value === undefined) throw new Error("missing " + name);
  return value;
}
/** Data lines as [first, last, fields...]; comments and blank lines dropped. */
function rows(name: string): [number, number, string[]][] {
  const out: [number, number, string[]][] = [];
  for (const raw of text(name).split("\n")) {
    const line = raw.replace(/#.*/u, "").trim();
    if (line === "") continue;
    const fields = line.split(";").map((field) => field.trim());
    const range = fields[0] ?? "";
    const [first, last] = range.split("..");
    const start = Number.parseInt(first ?? "", 16),
      end = last === undefined ? start : Number.parseInt(last, 16);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start)
      throw new Error(name + ": bad range " + range);
    out.push([start, end, fields.slice(1)]);
  }
  return out;
}

const size = 0x110000;
const grapheme = new Uint8Array(size),
  word = new Uint8Array(size),
  sentence = new Uint8Array(size),
  conjunct = new Uint8Array(size),
  pictographic = new Uint8Array(size);
function assign(
  target: Uint8Array,
  name: string,
  values: readonly string[],
  select: (fields: string[]) => string | undefined,
): void {
  for (const [start, end, fields] of rows(name)) {
    const value = select(fields);
    if (value === undefined) continue;
    const index = values.indexOf(value);
    if (index < 0) throw new Error(name + ": unknown value " + value);
    for (let point = start; point <= end; point++) {
      if (target[point] !== 0) throw new Error(name + ": overlap at " + point);
      target[point] = index;
    }
  }
}
assign(
  grapheme,
  "auxiliary/GraphemeBreakProperty.txt",
  graphemeValues,
  (f) => f[0],
);
assign(word, "auxiliary/WordBreakProperty.txt", wordValues, (f) => f[0]);
assign(
  sentence,
  "auxiliary/SentenceBreakProperty.txt",
  sentenceValues,
  (f) => f[0],
);
assign(conjunct, "DerivedCoreProperties.txt", conjunctValues, (f) =>
  f[0] === "InCB" ? f[1] : undefined,
);
for (const [start, end, fields] of rows("emoji/emoji-data.txt"))
  if (fields[0] === "Extended_Pictographic")
    for (let point = start; point <= end; point++) pictographic[point] = 1;

// Packed class: grapheme (4 bits) | word << 4 (5 bits) | sentence << 9
// (4 bits) | conjunct << 13 (2 bits) | extended pictographic << 15.
function packed(point: number): number {
  return (
    (grapheme[point] ?? 0) |
    ((word[point] ?? 0) << 4) |
    ((sentence[point] ?? 0) << 9) |
    ((conjunct[point] ?? 0) << 13) |
    ((pictographic[point] ?? 0) << 15)
  );
}
// Each entry is three UTF-16 units: start high, start low, packed class. A
// class applies from its start up to the next entry's start.
let table = "",
  entries = 0,
  previous = -1;
function unit(value: number): string {
  return "\\u" + value.toString(16).padStart(4, "0");
}
for (let point = 0; point < size; point++) {
  const value = packed(point);
  if (value === previous) continue;
  table += unit(point >>> 16) + unit(point & 0xffff) + unit(value);
  entries++;
  previous = value;
}

const data = [
  "// Generated by tools/generate-unicode-segmentation.ts. Unicode " +
    version +
    ".",
  "// Sources: https://www.unicode.org/Public/" + version + "/ucd/",
  ...hashes.slice(0, 5),
  "// Copyright and permission: ../../../docs/unicode/LICENSE-UNICODE.txt",
  "export const segmentationVersion = " + JSON.stringify(version) + ";",
  "export const graphemeBreakValues: readonly string[] = " +
    JSON.stringify(graphemeValues) +
    ";",
  "export const wordBreakValues: readonly string[] = " +
    JSON.stringify(wordValues) +
    ";",
  "export const sentenceBreakValues: readonly string[] = " +
    JSON.stringify(sentenceValues) +
    ";",
  "export const conjunctBreakValues: readonly string[] = " +
    JSON.stringify(conjunctValues) +
    ";",
  "/** " +
    entries +
    " entries of [start high, start low, packed class]; see the generator. */",
  'export const segmentationClasses = "' + table + '";',
  "",
].join("\n");
writeFileSync(
  "packages/foundation/src/unicode/segmentation/data.ts",
  await format(data, { parser: "typescript" }),
);

/** Conformance vectors: each line of an official *BreakTest.txt becomes
 * "hex code points|boundary offsets in UTF-16 units", for example
 * "61 308|0,2". */
function vectors(name: string): string[] {
  const out: string[] = [];
  for (const raw of text(name).split("\n")) {
    const line = raw.replace(/#.*/u, "").trim();
    if (line === "") continue;
    const tokens = line.split(/\s+/u);
    const points: number[] = [],
      boundaries: number[] = [];
    let offset = 0;
    for (const token of tokens) {
      if (token === "÷") boundaries.push(offset);
      else if (token === "×") continue;
      else {
        const point = Number.parseInt(token, 16);
        if (!Number.isInteger(point)) throw new Error(name + ": " + token);
        points.push(point);
        offset += point > 0xffff ? 2 : 1;
      }
    }
    out.push(
      points.map((point) => point.toString(16)).join(" ") +
        "|" +
        boundaries.join(","),
    );
  }
  return out;
}
const fixture = {
  kind: "unicode-segmentation-conformance-vectors",
  unicodeVersion: version,
  sources: Object.fromEntries(sources.slice(5)),
  grapheme: vectors("auxiliary/GraphemeBreakTest.txt"),
  word: vectors("auxiliary/WordBreakTest.txt"),
  sentence: vectors("auxiliary/SentenceBreakTest.txt"),
};
writeFileSync(
  "packages/foundation/test/unicode-segmentation-vectors.json",
  await format(JSON.stringify(fixture), { parser: "json" }),
);
console.log(
  JSON.stringify({
    entries,
    grapheme: fixture.grapheme.length,
    word: fixture.word.length,
    sentence: fixture.sentence.length,
  }),
);
