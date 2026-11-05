import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isIDStart,
  isIDContinue,
  unicodeVersion,
} from "@tint/foundation/unicode/identifiers";
test("Unicode identifier properties retain agreement for Unicode 16 assigned characters", () => {
  assert.equal(unicodeVersion, "17.0.0");
  assert.equal(
    process.versions.unicode,
    "16.0",
    "the independent oracle must use the pinned Unicode version",
  );
  const assigned = /\p{Assigned}/u;
  const start = /\p{ID_Start}/u,
    part = /\p{ID_Continue}/u;
  for (let point = 0; point <= 0x10ffff; point++) {
    const character = String.fromCodePoint(point);
    if (!assigned.test(character)) continue;
    assert.equal(
      isIDStart(point),
      start.test(character),
      "ID_Start U+" + point.toString(16),
    );
    assert.equal(
      isIDContinue(point),
      part.test(character),
      "ID_Continue U+" + point.toString(16),
    );
  }
});
test("identifier property APIs reject non-code-point inputs", () => {
  for (const point of [-1, 0.5, NaN, Infinity, 0x110000]) {
    assert.equal(isIDStart(point), false);
    assert.equal(isIDContinue(point), false);
  }
});

test("Unicode 17 additions are available to identifier scanning", () => {
  assert.equal(unicodeVersion, "17.0.0");
  for (const point of [0x088f, 0x0c5c, 0x0cdc, 0xa7ce, 0x10940]) {
    assert.equal(isIDStart(point), true, point.toString(16));
    assert.equal(isIDContinue(point), true, point.toString(16));
  }
});
