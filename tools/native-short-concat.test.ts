// Concatenations natively at every pair of part lengths from 0 to 9, where
// one-byte results of at most eight units join two data words inline:
// parts from literals, slices of longer text (copied short), number
// strings and earlier concatenations, whose bytes past their lengths are
// stale, and two-byte parts that take the general copy. Every result's
// length, units and equality must match Node's.
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const kernelSource = `function kernel(): number {
  const text = "abcdefghijklmnopqrstuvwxyz0123456789",
    wide = "αβγδεζηθικλμ";
  const parts: string[] = [];
  for (let length = 0; length <= 9; length++) {
    parts.push(text.slice(length, length + length));
    // A part whose stale tail differs: the front of a longer concatenation,
    // copied short.
    parts.push(("XYZWVUTSRQ" + text).slice(0, length));
    if (length <= 3) parts.push(wide.slice(0, length));
  }
  for (let value = 0; value < 12; value++) parts.push(String(value * 37));
  let checksum = 0;
  for (let i = 0; i < parts.length; i++)
    for (let j = 0; j < parts.length; j++) {
      const left = parts[i] ?? "",
        right = parts[j] ?? "";
      const joined = left + right;
      checksum = (Math.imul(checksum, 31) + joined.length) | 0;
      for (let k = 0; k < joined.length; k++)
        checksum = (Math.imul(checksum, 31) + joined.charCodeAt(k)) | 0;
      // A second join of the result, so stale tails would surface.
      const twice = joined + left;
      checksum =
        (Math.imul(checksum, 31) +
          twice.charCodeAt(twice.length - 1 < 0 ? 0 : twice.length - 1)) |
        0;
      if (joined === left + right) checksum = (checksum + 1) | 0;
      if (joined === "abcdefgh") checksum = (checksum + 7) | 0;
    }
  return checksum;
}`;
// Node runs the same text (types stripped) for the expected checksum.
const kernel = new Function(
  stripTypeScriptTypes(kernelSource) + "\nreturn kernel();",
) as () => number;
const expected = kernel();
const source = `${kernelSource}
export function run(): number {
  return kernel() === ${expected} ? 42 : 1;
}
`;

test("short concatenations join like Node at every part length", () => {
  verifyHostedFixture(source, "short-concat", [], [], [], []);
});

// Joins of three and four parts and loop appends write each short part as
// one word while it fits the target's data, so every part length and
// position around a word boundary, with stale tails, must still match.
const piecesSource = `function pieces(): number {
  const text = "abcdefghijklmnopqrstuvwxyz0123456789",
    wide = "αβγδεζηθικλμ";
  const parts: string[] = [];
  for (let length = 0; length <= 9; length++) {
    parts.push(text.slice(length, length + length));
    parts.push(("XYZWVUTSRQ" + text).slice(0, length));
  }
  // Two-byte parts of every length: two-byte targets at every offset.
  for (let length = 1; length <= 9; length++)
    parts.push(wide.slice(length % 3, (length % 3) + length));
  let checksum = 0;
  for (let i = 0; i < parts.length; i++)
    for (let j = 0; j < parts.length; j += 3)
      for (let k = 0; k < parts.length; k += 2) {
        const a = parts[i] ?? "",
          b = parts[j] ?? "",
          c = parts[k] ?? "";
        const three = a + b + c,
          four = \`\${a}:\${b}\${c}\${a}\`;
        checksum = (Math.imul(checksum, 31) + three.length + four.length) | 0;
        for (let n = 0; n < three.length; n++)
          checksum = (Math.imul(checksum, 31) + three.charCodeAt(n)) | 0;
        for (let n = 0; n < four.length; n++)
          checksum = (Math.imul(checksum, 31) + four.charCodeAt(n)) | 0;
      }
  for (let round = 0; round < 40; round++) {
    let built = "";
    for (let n = 0; n < 30; n++) built += parts[(n * 7 + round) % parts.length] ?? "";
    checksum = (Math.imul(checksum, 31) + built.length) | 0;
    for (let n = 0; n < built.length; n++)
      checksum = (Math.imul(checksum, 31) + built.charCodeAt(n)) | 0;
  }
  return checksum;
}`;
const pieces = new Function(
  stripTypeScriptTypes(piecesSource) + "\nreturn pieces();",
) as () => number;
const piecesExpected = pieces();

test("joined parts and loop appends write like Node at every part length", () => {
  verifyHostedFixture(
    `${piecesSource}
export function run(): number {
  return pieces() === ${piecesExpected} ? 42 : 1;
}
`,
    "short-pieces",
    [],
    [],
    [],
    [],
  );
});
