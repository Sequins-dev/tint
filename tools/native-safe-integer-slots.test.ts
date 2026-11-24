// Safe integer slots natively: number slots whose every write bounds
// proves a safe integer other than -0 (safeIntegerSlots) are int64 slots
// whose loads are bounded integers. Products beyond 32 bits, negative
// ones, values at 2^53 - 1, loop-invariant products moved to a preheader,
// and every kind of use (int64 arithmetic and remainders, comparisons,
// division, formatting, ToInt32, negation of zero, remainder dividends that
// may or may not be -0), next to slots that may exceed 2^53 or hold -0 and
// so stay doubles, against Node.
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const kernelSource = `function mix(checksum: number, value: number): number {
  return (Math.imul(checksum, 31) + (value | 0)) | 0;
}
function kernel(): number {
  let checksum = 0;
  for (let round = 0; round < 600; round++) {
    // Up to 1023 * 2^42 and down to -255 * 2^45: safe integers, never -0.
    const scaled = (round & 1023) * 4398046511104;
    const negative = 0 - (round & 255) * 35184372088832;
    // 2^53 - 1 and just below.
    const near = 9007199254740991 - (round & 7);
    // Up to 3 * 2^52, beyond 2^53: not a safe integer slot.
    const over = (round & 3) * 4503599627370496;
    // -0 when round & 15 is 0: not a safe integer slot either.
    const signed = (round & 15) * -1099511627776;
    checksum = mix(checksum, scaled % 1000003);
    checksum = mix(checksum, negative % 999983);
    checksum = mix(checksum, (scaled + negative) % 65521);
    checksum = mix(checksum, scaled > 1125899906842624 ? 1 : 2);
    checksum = mix(checksum, negative < -1125899906842624 ? 3 : 4);
    checksum = mix(checksum, Math.floor(scaled / 7) % 4093);
    checksum = mix(checksum, String(scaled).length + String(negative).length);
    checksum = mix(checksum, scaled | 0);
    checksum = mix(checksum, negative >>> 0);
    checksum = mix(checksum, 1 / -scaled === -Infinity ? 5 : 6);
    checksum = mix(checksum, near % 1000003);
    checksum = mix(checksum, (near - 1) % 999983);
    checksum = mix(checksum, near === 9007199254740991 ? 7 : 8);
    checksum = mix(checksum, (over + 1) % 1000003);
    checksum = mix(checksum, over / 4503599627370496);
    checksum = mix(checksum, 1 / signed === -Infinity ? 9 : signed % 4093);
    // Remainder dividends: one that may be -0 keeps its sign; signless
    // ones divide as int64s, a zero remainder taking the dividend's sign.
    const zeroProduct = (round & 1) * -(round & 6);
    checksum = mix(checksum, 1 / (zeroProduct % 7) === -Infinity ? 10 : 11);
    const negativeSum = 0 - (round & 3);
    checksum = mix(checksum, 1 / ((negativeSum * 5) % 5) === -Infinity ? 12 : 13);
    checksum = mix(checksum, ((negativeSum * 5) % 3) * 7);
    for (let i = 0; i < 16; i++) {
      // round * 7 and round * 1099511627776 are loop invariant here.
      const sum = round * 7 + i * 61;
      const wide = round * 1099511627776 + i;
      checksum = mix(checksum, sum % 1009);
      checksum = mix(checksum, wide % 1000003);
      checksum = mix(checksum, wide > 549755813888000 ? i : -i);
    }
  }
  return checksum;
}`;
// Node runs the same text (types stripped) for the expected checksum.
const kernel = new Function(
  stripTypeScriptTypes(kernelSource) + "\nreturn kernel();",
) as () => number;
const expected = kernel();

test("safe integer slots compute like Node", () => {
  verifyHostedFixture(
    `${kernelSource}
export function run(): number {
  return kernel() === ${expected} ? 42 : 1;
}
`,
    "safe-integer-slots",
    [],
    [],
    [],
    [],
  );
});
