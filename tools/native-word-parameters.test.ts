// Word parameters natively: a number parameter that every direct call
// passes a proven 32-bit integer (provenWordArguments) is an int64 slot,
// converted once in the prologue (aarch64 scalar integerSlots). Dispatch
// chains, unsigned words above 2^31, double uses (-0 from negation,
// fractions), parameters the body reassigns, recursion and functions that
// escape (whose parameters stay unknown, so they take any number), against
// Node.
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const kernelSource = `function pick(slot: number): number {
  if (slot < 4) {
    if (slot < 2) return slot === 0 ? 10 : 11;
    return slot === 2 ? 12 : 13;
  }
  if (slot < 6) return slot === 4 ? 14 : 15;
  return slot === 6 ? 16 : 17;
}
function wide(word: number): number {
  // Unsigned words up to 2^32 - 1, compared, halved and shifted.
  return (word > 2147483647 ? 1 : 0) + Math.floor(word / 2) + (word >>> 3);
}
function negated(slot: number): number {
  // -slot is -0 for slot 0: 1 / -0 is -Infinity.
  const minus = -slot;
  return 1 / minus === -Infinity ? 1000 : minus * 0.5;
}
function reassigned(slot: number): number {
  slot = slot + 0.5;
  return slot * 3;
}
function depth(slot: number): number {
  return slot <= 0 ? 0 : 1 + depth(slot - 1);
}
function escaped(slot: number): number {
  return slot < 4 ? slot * 2 : slot + 0.25;
}
const table: ((slot: number) => number)[] = [escaped];
function kernel(): number {
  let checksum = 0;
  for (let i = 0; i < 4000; i++) {
    const slot = i & 7;
    checksum = (Math.imul(checksum, 31) + pick(slot)) | 0;
    checksum = (Math.imul(checksum, 31) + wide((i * 2654435761) >>> 0)) | 0;
    checksum = (Math.imul(checksum, 31) + wide((4294967295 - i) >>> 0)) | 0;
    checksum = (Math.imul(checksum, 31) + negated(slot) * 4) | 0;
    checksum = (Math.imul(checksum, 31) + reassigned(slot)) | 0;
    checksum = (Math.imul(checksum, 31) + depth(slot)) | 0;
    checksum = (Math.imul(checksum, 31) + escaped(slot)) | 0;
    const call = table[0];
    if (call !== undefined) {
      // Through the table, fractions and NaN reach the same function.
      checksum = (Math.imul(checksum, 31) + call(slot + 0.5) * 4) | 0;
      checksum = (Math.imul(checksum, 31) + (call(0 / 0) === call(0 / 0) ? 1 : 2)) | 0;
    }
  }
  return checksum;
}`;
// Node runs the same text (types stripped) for the expected checksum.
const kernel = new Function(
  stripTypeScriptTypes(kernelSource) + "\nreturn kernel();",
) as () => number;
const expected = kernel();

test("word parameters held as integers compute like Node", () => {
  verifyHostedFixture(
    `${kernelSource}
export function run(): number {
  return kernel() === ${expected} ? 42 : 1;
}
`,
    "word-parameters",
    [],
    [],
    [],
    [],
  );
});
