// Typed-array element access on the typed path: reads and writes proven in
// bounds relative to an array's own length (`i < a.length - c` with offsets
// `i ± d`) select unchecked accesses, and integer elements stay integers.
// Everything here must behave as in ECMAScript: reads one past a proven
// margin or before index 0 are undefined, a reassigned array ends the
// proof, and integer stores wrap (ToUint8/16/32) whatever representation
// the value has. The same source runs in Node for the expected checksum and
// natively under LLDB.
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

const source = `function mix(total: number, value: number): number {
  return (Math.imul(total, 31) + (value | 0)) | 0;
}
function smooth(field: Float64Array): number {
  let total = 0;
  for (let i = 1; i < field.length - 1; i++) {
    const next = ((field[i - 1] ?? 0) + (field[i] ?? 0) * 2 + (field[i + 1] ?? 0)) * 0.25;
    field[i] = next;
    total += next;
  }
  return Math.floor(total * 1000);
}
// Slot-held bounds (a copy of the length minus one), and \`>\` with the
// bound on the left.
function bytes(values: Uint8Array): number {
  const last = values.length - 1;
  let total = 0;
  for (let i = 0; last > i; i++) {
    values[i + 1] = (values[i] ?? 0) + (values[i + 1] ?? 0);
    total = mix(total, values[i + 1] ?? 0);
  }
  return total;
}
function words(values: Uint32Array, round: number): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] = ((values[i] ?? 0) * 3 + round) | 0;
    total = mix(total, (values[i] ?? 0) & 0xffff);
  }
  return total;
}
function halves(values: Uint16Array): number {
  let total = 0;
  for (let i = 0; i + 1 < values.length; i++) {
    values[i] = (values[i + 1] ?? 0) * 7 + 65000;
    total = mix(total, values[i] ?? 0);
  }
  return total;
}
// Past the margin: i <= length - 1 reads a[i + 1] once out of bounds, and
// from i = 0 a[i - 1] is undefined.
function edges(values: Float64Array): number {
  let total = 0;
  for (let i = 0; i <= values.length - 1; i++) {
    total = mix(total, values[i + 1] ?? 1000);
    total = mix(total, values[i - 1] ?? 2000);
  }
  for (let i = 0; i <= values.length; i++)
    total = mix(total, values[i] ?? 3000);
  return total;
}
// A new, shorter array in the slot ends the relation.
function reassigned(): number {
  let values = new Uint8Array(8);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total = mix(total, values[i] ?? 4000);
    values[i] = i + 1;
    if (i === 3) values = new Uint8Array(2);
    total = mix(total, values[i] ?? 5000);
  }
  return total;
}
// Stores wrap by element type, from integer and double values.
function wraps(): number {
  const small = new Uint8Array(6),
    medium = new Uint16Array(4),
    large = new Uint32Array(5);
  const inputs: number[] = [300, -1, 3.7, -0.5, 65536 + 9, 4294967296 + 5];
  for (let i = 0; i < small.length; i++) small[i] = inputs[i] ?? 0;
  for (let i = 0; i < medium.length; i++) medium[i] = (inputs[i] ?? 0) * 233;
  for (let i = 0; i < large.length; i++) large[i] = (i - 2) * 1000000007;
  let total = 0;
  for (let i = 0; i < small.length; i++) total = mix(total, small[i] ?? 0);
  for (let i = 0; i < medium.length; i++) total = mix(total, medium[i] ?? 0);
  for (let i = 0; i < large.length; i++)
    total = mix(total, (large[i] ?? 0) % 1000003);
  return total;
}
export function checksum(): number {
  const field = new Float64Array(33);
  for (let i = 0; i < field.length; i++) field[i] = (i % 5) * 1.5;
  let total = 0;
  for (let round = 0; round < 3; round++) total = mix(total, smooth(field));
  const small = new Uint8Array(40);
  for (let i = 0; i < small.length; i++) small[i] = i * 37;
  total = mix(total, bytes(small));
  const large = new Uint32Array(17);
  for (let i = 0; i < large.length; i++) large[i] = i * 2654435761;
  for (let round = 0; round < 4; round++) total = mix(total, words(large, round));
  const medium = new Uint16Array(9);
  for (let i = 0; i < medium.length; i++) medium[i] = i * 9001;
  total = mix(total, halves(medium));
  total = mix(total, edges(field));
  total = mix(total, edges(new Float64Array(0)));
  total = mix(total, reassigned());
  return mix(total, wraps());
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-typed-array-access-"));
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

test("typed-array accesses proven against their own length behave as in ECMAScript", async () => {
  const expected = await expectedChecksum(source);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "typed-array-access",
    [],
    [],
    [],
    [],
    { managedBytes: 16777216, allocationCapacity: 262144 },
  );
});
