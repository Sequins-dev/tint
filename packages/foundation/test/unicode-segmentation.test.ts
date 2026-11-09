import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  segmentBoundaries,
  segmentationClassOf,
  segmentationVersion,
  isWordLikeSegment,
  type SegmentationGranularity,
} from "@tint/foundation/unicode/segmentation";

const vectors = JSON.parse(
  readFileSync(
    new URL("./unicode-segmentation-vectors.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly unicodeVersion: string;
  readonly grapheme: string[];
  readonly word: string[];
  readonly sentence: string[];
};
/** "hex code points|boundary offsets" (see tools/generate-unicode-segmentation.ts). */
function parseVector(vector: string): [number[], number[]] {
  const [points, boundaries] = vector.split("|");
  return [
    (points ?? "").split(" ").map((hex) => Number.parseInt(hex, 16)),
    (boundaries ?? "").split(",").map(Number),
  ];
}

function check(granularity: SegmentationGranularity): void {
  const cases = vectors[granularity];
  assert.ok(cases.length > 100);
  const failures: string[] = [];
  for (const vector of cases) {
    const [points, expected] = parseVector(vector);
    const text = String.fromCodePoint(...points);
    const actual = segmentBoundaries(text, granularity);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      failures.push(
        points.map((p) => p.toString(16)).join(" ") +
          " expected " +
          JSON.stringify(expected) +
          " got " +
          JSON.stringify(actual),
      );
  }
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} failures`);
}

test("segmentation data matches the pinned conformance vectors' Unicode version", () => {
  assert.equal(segmentationVersion, "17.0.0");
  assert.equal(vectors.unicodeVersion, segmentationVersion);
});

test("UAX #29 extended grapheme clusters match every GraphemeBreakTest vector", () =>
  check("grapheme"));
test("UAX #29 word boundaries match every WordBreakTest vector", () =>
  check("word"));
test("UAX #29 sentence boundaries match every SentenceBreakTest vector", () =>
  check("sentence"));

test("property lookup covers the full code point space with defaults", () => {
  const cr = segmentationClassOf(0x0d);
  assert.equal(cr.grapheme, "CR");
  assert.equal(cr.word, "CR");
  assert.equal(cr.sentence, "CR");
  const a = segmentationClassOf(0x61);
  assert.equal(a.word, "ALetter");
  assert.equal(a.sentence, "Lower");
  const ka = segmentationClassOf(0x0915);
  assert.equal(ka.conjunct, "Consonant");
  assert.equal(segmentationClassOf(0x1f600).pictographic, true);
  const last = segmentationClassOf(0x10ffff);
  assert.equal(last.grapheme, "Other");
  // Unicode 17 lists no surrogates under Control, so they default to Other.
  assert.equal(segmentationClassOf(0xd800).grapheme, "Other");
  assert.equal(segmentationClassOf(0x0a).grapheme, "LF");
});

test("boundaries are UTF-16 offsets including both ends and never split pairs", () => {
  assert.deepEqual(segmentBoundaries("", "grapheme"), []);
  assert.deepEqual(segmentBoundaries("a\u{1F600}b", "grapheme"), [0, 1, 3, 4]);
  assert.deepEqual(segmentBoundaries("\uD800a", "grapheme"), [0, 1, 2]);
  assert.deepEqual(
    segmentBoundaries("Hello world!", "word"),
    [0, 5, 6, 11, 12],
  );
  assert.deepEqual(segmentBoundaries("Hi. Bye.", "sentence"), [0, 4, 8]);
});

test("word-like segments contain letters, ideographs, kana or digits", () => {
  for (const segment of ["Hello", "400", "台北", "カタカナ", "วัด", "a_b"])
    assert.equal(isWordLikeSegment(segment), true, segment);
  for (const segment of [" ", "!", "　", "-", "\u{1F600}", "..."])
    assert.equal(isWordLikeSegment(segment), false, segment);
});
