import assert from "node:assert/strict";
import test from "node:test";
import { packLocaleTables } from "./pack-locale-data.ts";
import { unpackLocaleData } from "../packages/js-runtime/src/objects/locale-data-pack.ts";

test("CLDR packer round trips distinct tables and exact Unicode", () => {
  for (const tables of [
    [],
    [""],
    ["en|January\nzh|正月", "😀\ufeff", ""],
    ["abc".repeat(1000)],
  ]) {
    const packed = packLocaleTables(tables);
    assert.deepEqual(
      unpackLocaleData(packed.payload, packed.packedBytes),
      tables,
    );
    assert.equal(packed.utf16CodeUnits, packed.payload.length);
  }
});

test("CLDR packer preserves deterministic mixed text and repeated references", () => {
  let seed = 17;
  const alphabet = ["a", "z", "|", ":", ",", "\n", "é", "月", "😀", "𐐷"],
    parts: string[] = [];
  for (let index = 0; index < 2000; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    parts.push(alphabet[seed % alphabet.length]!);
  }
  const tables = [
      parts.join(""),
      "America/New_York.long.daylight:23,".repeat(2000),
    ],
    first = packLocaleTables(tables),
    second = packLocaleTables(tables);
  assert.deepEqual(first, second);
  assert.deepEqual(unpackLocaleData(first.payload, first.packedBytes), tables);
  assert.ok(first.utf16CodeUnits * 2 < first.decodedBytes / 2);
});

test("CLDR packer rejects embedded table delimiters", () => {
  assert.throws(() => packLocaleTables(["a\0b"]));
});
