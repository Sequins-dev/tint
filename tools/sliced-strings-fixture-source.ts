// Sliced strings (docs/design-one-byte-strings.md): slices of at least 9
// units in their parent's kind share the parent's units on AArch64. Typed
// checks that every string operation reads them as the flat strings they
// equal, across the 8/9-unit threshold, both kinds, slices of slices,
// two-byte parents whose slices narrow (and are copied), collections that
// move parents only a slice keeps alive, and slice bounds of every kind.
// `run` returns 42, or the number of the first failed check.
// tools/sliced-strings-fixture.test.ts runs the same source under Node.
export const slicedStringsSource = `
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import { asciiUppercase } from "@tint/foundation/text/latin1";

function units(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
  return out;
}
/** The same units as a flat string built one unit at a time. */
function flat(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += String.fromCharCode(text.charCodeAt(i));
  return out;
}
function same(left: string, right: string): boolean {
  return left === right;
}
/** Allocates garbage so collections run (and move young parents). */
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const parts: string[] = [];
    for (let i = 0; i < 64; i++) parts.push("garbage " + String(round * 64 + i));
    total += parts.join(",").length;
  }
  return total;
}
function abc(count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(String.fromCharCode(97 + (i % 26)));
  return parts.join("");
}

export function run(): number {
  const one = abc(60) + "\\u00e9" + abc(20);
  const two = abc(30) + "\\u4e16" + abc(30) + "\\u754c" + abc(10);
  // 1-6: slices of both kinds read like flat strings, at and around the
  // minimum slice length (nativeStringSlicedMinimumLength, 9).
  for (let length = 5; length <= 40; length++) {
    for (let begin = 0; begin < 8; begin++) {
      const part = one.slice(begin, begin + length),
        copy = flat(part);
      if (part.length !== length) return 1;
      if (part !== copy || !same(part, copy) || copy !== part) return 2;
      for (let i = 0; i < length; i++)
        if (part.charCodeAt(i) !== one.charCodeAt(begin + i)) return 3;
      const wide = two.slice(begin + 25, begin + 25 + length);
      if (wide !== flat(wide) || wide.length !== length) return 4;
      for (let i = 0; i < length; i++)
        if (wide.charCodeAt(i) !== two.charCodeAt(begin + 25 + i)) return 5;
    }
  }
  if (one.substring(70) !== flat(one.substring(70))) return 6;
  // 7-10: slices of slices, and slices of a two-byte parent that narrow.
  const outer = one.slice(5, 70),
    inner = outer.slice(10, 40),
    innermost = inner.slice(3, 20);
  if (inner !== one.slice(15, 45) || innermost !== one.slice(18, 35)) return 7;
  if (innermost.charCodeAt(0) !== one.charCodeAt(18)) return 8;
  const latinOfTwo = two.slice(0, 29);
  if (latinOfTwo !== abc(29) || latinOfTwo.charCodeAt(28) !== 99) return 9;
  const wideTail = two.slice(28);
  if (wideTail.charCodeAt(2) !== 0x4e16 || wideTail !== flat(wideTail)) return 10;
  // 11-14: literal comparisons: short literals never equal a slice; pooled
  // literals (9-32 units) equal equal slices.
  const pooled = one.slice(0, 13),
    pooledLong = one.slice(0, 32);
  if (pooled !== "abcdefghijklm" || pooled === "abcdefghijklx") return 11;
  if (pooledLong !== "abcdefghijklmnopqrstuvwxyzabcdef") return 12;
  if (pooled === "abc" || one.slice(0, 13) === "abcdefgh") return 13;
  // The shortest slice (nine one-byte data bytes) against pooled literals
  // and the longest inline one.
  const shortest = one.slice(0, 9);
  if (shortest !== "abcdefghi" || shortest === "abcdefghx") return 13;
  if (one.slice(0, 8) !== "abcdefgh" || shortest === "abcdefgh") return 13;
  const pooledWide = two.slice(26, 40);
  if (pooledWide !== "abcd\\u4e16abcdefghi") return 14;
  // 15-20: search, prefixes, concatenation, joins and templates with
  // slice pieces.
  const haystack = one.slice(1, 75);
  if (haystack.indexOf("xyz") !== 22 || haystack.lastIndexOf("abc") !== 60) return 15;
  if (!haystack.includes("\\u00e9") || haystack.indexOf("\\u00e9") !== 59) return 16;
  if (!haystack.startsWith("bcd") || haystack.startsWith("abc")) return 17;
  if (two.slice(20, 50).indexOf("\\u4e16") !== 10) return 18;
  const joined = [pooled, wideTail.slice(0, 15), haystack.slice(0, 13)].join("|");
  if (joined !== flat(pooled) + "|" + flat(wideTail.slice(0, 15)) + "|" + flat(haystack.slice(0, 13)))
    return 19;
  const templated = \`<\${pooled}:\${wideTail.slice(0, 14)}>\`;
  if (templated !== "<" + flat(pooled) + ":" + flat(wideTail.slice(0, 14)) + ">") return 20;
  // 21-24: map keys, UTF-8 and ASCII case of slices.
  const map = new Map<string, number>();
  map.set(one.slice(2, 20), 7);
  if (map.get(flat(one.slice(2, 20))) !== 7 || map.get(one.slice(2, 21)) !== undefined) return 21;
  const bytes = encodeUTF8(haystack);
  if (bytes.length !== haystack.length + 1 || bytes[59] !== 0xc3) return 22;
  if (asciiUppercase(pooled) !== "ABCDEFGHIJKLM") return 23;
  if (units(pooled).length !== 13) return 24;
  // 25-27: collections move parents that only slices keep alive.
  const keep: string[] = [];
  for (let i = 0; i < 40; i++) {
    const parent = abc(50 + i) + String(i);
    keep.push(parent.slice(3, 3 + 13 + i));
  }
  if (churn(400) === 0) return 25;
  for (let i = 0; i < 40; i++) {
    const expected = abc(50 + i).slice(3, 3 + 13 + i);
    if (keep[i] !== expected || (keep[i] ?? "").length !== 13 + i) return 26;
  }
  if (churn(400) === 0 || keep.join("").length !== 40 * 13 + 780) return 27;
  // 28-31: slice bounds: relative, clamped, empty, and the non-integer
  // bounds (fractions, NaN, infinities) the inline integer path leaves to
  // the helper, with run-time values as well as constants.
  const n = one.length;
  if (one.slice(-20) !== one.slice(n - 20, n) || one.slice(-200, -5) !== one.slice(0, n - 5))
    return 28;
  if (one.slice(20, 10) !== "" || one.slice(n, n + 5) !== "" || one.slice(5, 1e9).length !== n - 5)
    return 29;
  if (one.slice(5.7, 30.2) !== one.slice(5, 30) || one.slice(0 / 0, 20) !== one.slice(0, 20))
    return 30;
  let half = 0.5,
    huge = 1 / 0;
  for (let i = 0; i < 3; i++) half += 1;
  if (one.slice(half, huge) !== one.slice(3) || one.slice(-huge, -half) !== one.slice(0, n - 3))
    return 31;
  return 42;
}
`;
