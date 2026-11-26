// ToInt32 and ToUint32 of doubles on the typed path: the bitwise and shift
// operators, Math.imul and integer typed-array stores convert arbitrary
// doubles (fractions, -0, NaN, infinities, values beyond 2^31, 2^32, 2^53,
// 2^63 and 2^64) modulo 2^32. Targets with FEAT_JSCVT convert with one
// FJCVTZS; the others round-trip through int64 with a helper fallback. The
// same source runs in Node for the expected checksum and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

function literal(value: number): string {
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  return String(value);
}
const inputs = [
  0,
  -0,
  0.5,
  -0.5,
  1.999,
  -1.999,
  NaN,
  Infinity,
  -Infinity,
  2147483647,
  2147483648,
  -2147483648,
  -2147483649,
  4294967295,
  4294967295.5,
  4294967296,
  4294967296 + 5,
  -4294967297,
  2 ** 52 + 0.5,
  2 ** 53,
  2 ** 53 + 2,
  -(2 ** 53),
  2 ** 63,
  -(2 ** 63),
  2 ** 64 + 4096,
  1.9e19,
  -1e300,
  1e300,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  123456789.75,
  -987654321.25,
];
let state = 99;
for (let i = 0; i < 200; i++) {
  state = (state * 1664525 + 1013904223) >>> 0;
  inputs.push((state - 2147483648) * 2 ** ((i % 40) - 8) + (i % 3) * 0.25);
}

const source = `const inputs: number[] = [${inputs.map(literal).join(", ")}];
function mix(total: number, value: number): number {
  return (Math.imul(total, 31) + value) | 0;
}
export function checksum(): number {
  const words = new Uint32Array(inputs.length),
    halves = new Uint16Array(inputs.length),
    bytes = new Uint8Array(inputs.length);
  let total = 0;
  for (let i = 0; i < inputs.length; i++) {
    const x = inputs[i] ?? 0;
    total = mix(total, x | 0);
    total = mix(total, (x >>> 0) % 65521);
    total = mix(total, x & 65535);
    total = mix(total, ~x);
    total = mix(total, x ^ 1234567);
    total = mix(total, x << 3);
    total = mix(total, x >> 2);
    total = mix(total, Math.imul(x, 3));
    words[i] = x;
    halves[i] = x;
    bytes[i] = x;
  }
  for (let i = 0; i < inputs.length; i++) {
    total = mix(total, (words[i] ?? 0) % 65521);
    total = mix(total, halves[i] ?? 0);
    total = mix(total, bytes[i] ?? 0);
  }
  return total;
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-int32-conversions-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    return module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("ToInt32 and ToUint32 of doubles agree with Node", async () => {
  const expected = await expectedChecksum(source);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "int32-conversions",
    [],
    [],
    [],
    [],
    { managedBytes: 16777216, allocationCapacity: 262144 },
  );
});
