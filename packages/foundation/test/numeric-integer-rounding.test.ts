import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInteger,
  formatInteger,
} from "@tint/foundation/numeric/big-integer";
import {
  roundInteger,
  roundIntegerAsIfPositive,
  parseRoundingMode,
  type RoundingMode,
} from "../src/numeric/integer-rounding.ts";
const modes: readonly RoundingMode[] = [
  "ceil",
  "floor",
  "expand",
  "trunc",
  "halfCeil",
  "halfFloor",
  "halfExpand",
  "halfTrunc",
  "halfEven",
];
function integer(n: number | bigint) {
  return parseInteger(String(n), 10)!;
}
function reference(
  n: number,
  increment: number,
  mode: RoundingMode,
  positive: boolean,
): number {
  const lower = Math.floor(n / increment) * increment,
    upper = Math.ceil(n / increment) * increment;
  if (lower === upper) return lower === 0 ? 0 : lower;
  if (mode === "ceil") return upper === 0 ? 0 : upper;
  if (mode === "floor") return lower;
  if (mode === "expand") return positive || n > 0 ? upper : lower;
  if (mode === "trunc") return positive || n > 0 ? lower : upper;
  if (n - lower < upper - n) return lower;
  if (n - lower > upper - n) return upper === 0 ? 0 : upper;
  if (mode === "halfCeil") return upper === 0 ? 0 : upper;
  if (mode === "halfFloor") return lower;
  if (mode === "halfExpand") return positive || n > 0 ? upper : lower;
  if (mode === "halfTrunc") return positive || n > 0 ? lower : upper;
  return (lower / increment) % 2 === 0 ? lower : upper;
}
test("all nine integer rounding modes agree with independent neighboring multiples", () => {
  for (let n = -60; n <= 60; n++)
    for (let increment = 1; increment <= 13; increment++)
      for (const mode of modes) {
        const signed = roundInteger(integer(n), integer(increment), mode)!;
        const positive = roundIntegerAsIfPositive(
          integer(n),
          integer(increment),
          mode,
        )!;
        assert.equal(
          formatInteger(signed, 10),
          String(reference(n, increment, mode, false)),
          `${n}/${increment} ${mode}`,
        );
        assert.equal(
          formatInteger(positive, 10),
          String(reference(n, increment, mode, true)),
          `${n}/${increment} positive ${mode}`,
        );
      }
});
test("rounding remains exact beyond binary64 and validates modes and increments", () => {
  const q = 1n << 200n,
    value = q * 10n + 5n;
  assert.equal(
    formatInteger(roundInteger(integer(value), integer(10), "halfExpand")!, 10),
    String((q + 1n) * 10n),
  );
  assert.equal(
    formatInteger(
      roundInteger(integer(-value), integer(10), "halfExpand")!,
      10,
    ),
    String(-(q + 1n) * 10n),
  );
  assert.equal(
    formatInteger(
      roundIntegerAsIfPositive(integer(-value), integer(10), "halfExpand")!,
      10,
    ),
    String(-q * 10n),
  );
  assert.equal(
    formatInteger(roundInteger(integer(-value), integer(10), "halfEven")!, 10),
    String(-q * 10n),
  );
  for (const increment of [0, -1])
    assert.equal(
      roundInteger(integer(1), integer(increment), "ceil"),
      undefined,
    );
  for (const mode of modes) assert.equal(parseRoundingMode(mode), mode);
  for (const mode of ["HALFEXPAND", "halfexpand", "", "auto"])
    assert.equal(parseRoundingMode(mode), undefined);
});
