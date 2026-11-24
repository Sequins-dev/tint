// slice and substring natively with every kind of bound: NaN, signed
// zeros, fractions, infinities, huge, negative (relative for slice) and
// inverted, as integers and as doubles, on one-byte and two-byte text.
// Every result must equal Node's.
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const kernelSource = `function bounds(): number {
  const texts: string[] = [
    "the quick brown fox jumps over the lazy dog, twice over",
    "the quick brown 狐 jumps over the lazy 犬, twice over",
    "short",
  ];
  const values: number[] = [
    0, -0, 1, 3, 8, 9, 13, 40, -1, -9, -40, 0.5, -0.5, 2.75, -2.75, 1e20,
    -1e20,
  ];
  values.push(0 / 0, 1 / 0, -1 / 0);
  let checksum = 0;
  for (let t = 0; t < texts.length; t++) {
    const text = texts[t] ?? "";
    for (let i = 0; i < values.length; i++) {
      const a = values[i] ?? 0;
      const tail = text.slice(a) + "|" + text.substring(a);
      checksum = (Math.imul(checksum, 31) + tail.length) | 0;
      for (let j = 0; j < values.length; j++) {
        const b = values[j] ?? 0;
        const sliced = text.slice(a, b),
          sub = text.substring(a, b);
        checksum = (Math.imul(checksum, 31) + sliced.length * 64 + sub.length) | 0;
        if (sliced.length > 0)
          checksum = (Math.imul(checksum, 31) + sliced.charCodeAt(sliced.length - 1)) | 0;
        if (sub.length > 0)
          checksum = (Math.imul(checksum, 31) + sub.charCodeAt(0)) | 0;
      }
    }
  }
  return checksum;
}`;
// Node runs the same text (types stripped) for the expected checksum.
const bounds = new Function(
  stripTypeScriptTypes(kernelSource) + "\nreturn bounds();",
) as () => number;
const expected = bounds();

test("slice and substring take every kind of bound like Node", () => {
  verifyHostedFixture(
    `${kernelSource}
export function run(): number {
  return bounds() === ${expected} ? 42 : 1;
}
`,
    "slice-bounds",
    [],
    [],
    [],
    [],
  );
});
