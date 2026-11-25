// Strings' cached array indices natively (nativeStringIndexFieldOffset in
// @tint/abi/host): Number(text) of canonical array-index decimals before and
// after their index field is set (by String(n), by a first parse, or by the
// compiler for pool literals), texts that must never hit (leading zeros,
// signs, exponents, fractions, whitespace, other digits, 2^20 and up),
// Map keys mixing cached and uncached equal strings, and collections that
// move cached strings. Every result must equal Node's.
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const kernelSource = `const misses: string[] = [
  "01", "00", "-0", "-1", "+1", "1e3", "1E3", "1.0", "1.", ".5", " 1", "1 ",
  "0x1", "0b1", "0o1", "Infinity", "", "١٢٣", "1_000", "1048576", "1048577",
  "4294967295", "4294967296", "9007199254740993", "0012", "-1048575",
];
/** Allocation pressure: strings that die young, so collections run. */
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const parts: string[] = [];
    for (let i = 0; i < 48; i++) parts.push("x" + String(i * 7 + round));
    total += parts.join(",").length;
  }
  return total;
}
function same(a: number, b: number): boolean {
  if (a !== a) return b !== b;
  return a === b && (a !== 0 || 1 / a === 1 / b);
}
function indices(): number {
  let checksum = 0;
  const values: number[] = [0, 1, 7, 9, 10, 99, 123, 65535, 1048575, 1048576];
  for (let i = 0; i < 300; i++) values.push((i * 3517) % 1048576);
  const texts: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < values.length; i++) {
      const value = values[i] ?? 0;
      // Formatted (cached by the formatter), then parsed twice.
      const text = String(value);
      if (!same(Number(text), value)) return 1;
      if (!same(Number(text), value)) return 2;
      // An equal string built another way, uncached until its first parse.
      const built = text.length > 1 ? text.slice(0, 1) + text.slice(1) : "" + text;
      if (!same(Number(built), value) || !same(Number(built), value)) return 3;
      if (round === 0) texts.push(text, built);
      checksum = (Math.imul(checksum, 31) + value) | 0;
    }
    for (let i = 0; i < misses.length; i++) {
      const text = misses[i] ?? "";
      const value = Number(text);
      checksum = (Math.imul(checksum, 31) + (value === value ? value | 0 : 7)) | 0;
      // Parsing never caches these: a second parse agrees.
      if (!same(Number(text), value)) return 4;
    }
    // Literals carry their fields; one-unit strings come from the pool.
    if (Number("123") !== 123 || Number("0") !== 0 || Number("1048575") !== 1048575) return 5;
    if (Number("01") !== 1 || Number("1048576") !== 1048576) return 6;
    for (let d = 0; d < 10; d++)
      if (Number(String.fromCharCode(48 + d)) !== d) return 7;
    // Cached strings moved by collections keep their values.
    if (churn(200 * (round + 1)) <= 0) return 8;
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i] ?? "";
      checksum = (Math.imul(checksum, 31) + Number(text)) | 0;
    }
  }
  return checksum;
}
function keys(): number {
  // Map keys: cached and uncached equal strings are the same key, and
  // non-canonical spellings stay distinct.
  const map = new Map<string, number>();
  for (let i = 0; i < 200; i++) map.set(String(i), i);
  let checksum = 0;
  for (let i = 0; i < 200; i++) {
    const built = "" + String(i);
    const glued = i < 10 ? String(i) : String(i).slice(0, 1) + String(i).slice(1);
    // Cache one of them first.
    if (Number(glued) !== i) return 11;
    if ((map.get(built) ?? -1) !== i || (map.get(glued) ?? -1) !== i) return 12;
    if (map.has("0" + String(i))) return 13;
    checksum = (Math.imul(checksum, 31) + (map.get(glued) ?? 0)) | 0;
  }
  map.set("01", 1001);
  if ((map.get("1") ?? -1) !== 1 || (map.get("01") ?? -1) !== 1001) return 14;
  const parsed = Number("01");
  if (parsed !== 1 || (map.get("0" + "1") ?? -1) !== 1001) return 15;
  return checksum;
}`;
// Node runs the same text (types stripped) for the expected results.
const reference = new Function(
  stripTypeScriptTypes(kernelSource) + "\nreturn [indices(), keys()];",
) as () => [number, number];
const [indicesExpected, keysExpected] = reference();

test("array-index strings parse through their index field", () => {
  verifyHostedFixture(
    `${kernelSource}
export function run(): number {
  if (indices() !== ${indicesExpected}) return 1;
  if (keys() !== ${keysExpected}) return 2;
  return 42;
}
`,
    "string-index",
    [],
    [],
    [],
    [],
    // A small heap, so the churn collects many times.
    {
      managedBytes: 8388608,
      allocationCapacity: 65536,
      runtimeEntry: "initializeGenerationalRuntime",
    },
  );
});
