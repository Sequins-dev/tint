import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDuration,
  durationFields,
  durationText,
} from "../src/chrono/temporal-duration/index.ts";

test("ISO duration parsing preserves units and expands fractional clock units exactly", () => {
  for (const [text, fields] of [
    ["P1Y2M3W4DT55H66M77.987654321S", [1, 2, 3, 4, 55, 66, 77, 987, 654, 321]],
    ["-PT1.03125H", [0, 0, 0, 0, -1, -1, -52, -500, 0, 0]],
    ["PT0.999999999H", [0, 0, 0, 0, 0, 59, 59, 999, 996, 400]],
    ["PT3,025M", [0, 0, 0, 0, 0, 3, 1, 500, 0, 0]],
    ["pt71.50040904s", [0, 0, 0, 0, 0, 0, 71, 500, 409, 40]],
    ["+P0001D", [0, 0, 0, 1, 0, 0, 0, 0, 0, 0]],
  ] as const) {
    const parsed = parseDuration(text);
    assert.ok(parsed, text);
    assert.deepEqual(durationFields(parsed), fields, text);
  }
  assert.equal(durationText(parseDuration("-PT0.000000000S")!), "PT0S");
});
test("ISO duration parsing rejects ordering, duplicate units, empty parts and imprecise fractions", () => {
  for (const text of [
    "",
    "P",
    "PT",
    "P1DT",
    " P1D",
    "P1D ",
    "P-1D",
    "P1D1Y",
    "P1Y1Y",
    "P1H",
    "PT1D",
    "P1.5D",
    "PT.5H",
    "PT1.H",
    "PT1.5H0S",
    "PT1.0M0S",
    "PT1.1234567890S",
    "P4294967296Y",
    "PT9007199254740992S",
    "PT1Sx",
    "P1DT1HT1M",
  ])
    assert.equal(parseDuration(text), undefined, text);
});
