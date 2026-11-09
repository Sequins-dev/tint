import assert from "node:assert/strict";
import test from "node:test";
import { unpackLocaleData } from "../src/objects/locale-data-pack.ts";

function encoded(bytes: readonly number[]): string {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value |= byte << bits;
    bits += 8;
    while (bits >= 15) {
      let unit = (value & 32767) + 32;
      if (unit >= 0x2028) unit += 2;
      result += String.fromCharCode(unit);
      value >>>= 15;
      bits -= 15;
    }
  }
  if (bits > 0) {
    let unit = value + 32;
    if (unit >= 0x2028) unit += 2;
    result += String.fromCharCode(unit);
  }
  return result;
}
function frame(
  length: number,
  tables: number,
  body: readonly number[],
): number[] {
  const bytes = [67, 76, 68, 49];
  for (const value of [length, tables])
    for (let shift = 0; shift < 32; shift += 8)
      bytes.push((value >>> shift) & 255);
  return [...bytes, ...body];
}
function decode(bytes: readonly number[]): readonly string[] {
  return unpackLocaleData(encoded(bytes), bytes.length);
}

test("locale data preserves empty tables, Unicode, separators and initial BOM", () => {
  assert.deepEqual(decode(frame(0, 0, [])), []);
  assert.deepEqual(decode(frame(0, 1, [])), [""]);
  const values = ["\ufeffyear|é", "月|😀", "", "a|b\nc|d"],
    bytes = [...new TextEncoder().encode(values.join("\0"))];
  assert.deepEqual(
    decode(frame(bytes.length, values.length, [bytes.length, ...bytes])),
    values,
  );
});

test("locale data copies overlapping references using previously decoded bytes", () => {
  assert.deepEqual(decode(frame(24, 1, [3, 97, 98, 99, 3, 21])), [
    "abc".repeat(8),
  ]);
});

test("locale data rejects malformed frames before exposing partial tables", () => {
  for (const bytes of [
    [],
    [0, ...frame(0, 0, []).slice(1)],
    frame(33554433, 1, []),
    frame(1, 1, []),
    frame(1, 1, [2, 97, 98]),
    frame(9, 1, [1, 97, 0, 8]),
    frame(9, 1, [1, 97, 2, 8]),
    frame(9, 1, [1, 97, 1, 7]),
    frame(9, 1, [1, 97, 1, 9]),
    frame(1, 1, [1, 97, 0]),
    frame(1, 1, [1, 255]),
    frame(1, 2, [1, 97]),
  ])
    assert.throws(() => decode(bytes));
  assert.throws(() => unpackLocaleData("\n", 1));
  assert.throws(() => unpackLocaleData(encoded(frame(0, 0, [])) + " ", 12));
  const valid = frame(0, 0, []),
    text = encoded(valid);
  assert.throws(() =>
    unpackLocaleData(
      text.slice(0, -1) +
        String.fromCharCode(text.charCodeAt(text.length - 1) + 16384),
      valid.length,
    ),
  );
});
