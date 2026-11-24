// Integer constants as AArch64 immediates on the typed path: int64 addition
// and subtraction of 12-bit and shifted 12-bit magnitudes (negative ones
// flip the operation), multiplication by 2^k and 2^k + 1, int64 comparisons
// against immediates (negative ones with CMN), 32-bit `&`, `|` and `^` with
// logical immediates and identities, and Math.imul by 2^k and 2^k ± 1.
// Constants with no immediate form, constants used both ways, constants on
// either side and constants stored to slots take the general paths. The
// same source runs in Node for the expected trace and natively under LLDB.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `let log = "";
function note(text: string): void {
  log += text + ";";
}
// Loop counters and their arithmetic are int64.
function additions(n: number): string {
  let a = 0,
    b = 0,
    c = 0,
    d = 0,
    e = 0,
    f = 0,
    g = 0;
  for (let i = 0; i < n; i++) {
    a = a + 4095;
    b = b - 4095;
    c = c + 8192;
    d = d - 16773120;
    e = e + -7;
    f = f - -4096;
    g = 1 + g + 4097;
  }
  return [a, b, c, d, e, f, g].join(",");
}
function products(n: number): string {
  let text = "";
  for (let i = -3; i < n; i++)
    text +=
      String(i * 2) +
      ":" +
      String(i * 3) +
      ":" +
      String(8 * i) +
      ":" +
      String(i * 9) +
      ":" +
      String(i * 7) +
      ":" +
      String(i * 4294967296) +
      ":" +
      String(4294967297 * i) +
      ",";
  return text;
}
function comparisons(): string {
  let text = "";
  for (let i = -20000; i <= 20000; i += 997) {
    let mark = "";
    if (i < -4096) mark += "a";
    if (i <= 4095) mark += "b";
    if (i > -1) mark += "c";
    if (i >= 8192) mark += "d";
    if (i === -4095) mark += "e";
    if (i !== 0) mark += "f";
    if (i < 16773120) mark += "g";
    if (i > -16773120) mark += "h";
    if (i < 4097) mark += "i";
    if (i === 3) mark += "j";
    text += mark + ",";
  }
  for (let i = -2; i < 3; i++)
    text += String(i === 0) + String(i !== -1) + String(i < 1) + ",";
  return text;
}
function words(n: number): string {
  let x = 12345,
    text = "";
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    const values = [
      x & 255,
      x & 0xff00ff00,
      x & -2,
      x & -1,
      x & 0,
      x & 0x12345678,
      x | 0,
      x | 0x80000000,
      x | 0x5555,
      x | -1,
      x ^ 0,
      x ^ 0xaaaaaaaa,
      x ^ 0x0f0f0f0f,
      x ^ 0x12345,
      255 & x,
      0x55555555 ^ x,
      Math.imul(x, 2),
      Math.imul(x, 31),
      Math.imul(x, 32),
      Math.imul(x, 33),
      Math.imul(3, x),
      Math.imul(x, 0x80000000),
      Math.imul(x, 0x7fffffff),
      Math.imul(x, 0x40000001),
      Math.imul(x, -1),
      Math.imul(x, 0x2c1b3c6d),
    ];
    text += values.join(" ") + ",";
  }
  return text;
}
// One constant used as an immediate and as a register operand, and
// constants stored straight to slots.
function shared(n: number): string {
  let total = 0,
    other = 0;
  for (let i = 0; i < n; i++) {
    const step = 4095;
    total = total + step;
    other = (other + Math.imul(i, step)) | 0;
    if (i === step) total = 7;
  }
  let a = 5,
    b = -9007199254740991,
    c = 4294967296;
  for (let i = 0; i < 3; i++) {
    a = a + i;
    b = b + 1;
    c = c - 1;
  }
  return String(total) + ":" + String(other) + ":" + [a, b, c].join(":");
}
export function trace(): string {
  note(additions(1000));
  note(products(40));
  note(comparisons());
  note(words(64));
  note(shared(5000));
  return log;
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-integer-immediates-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      trace(): string;
    };
    return module.trace();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("integer constants as immediates compute as in ECMAScript", async () => {
  const expected = await expectedTrace(source);
  verifyHostedFixture(
    source +
      `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`,
    "integer-immediates",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});
