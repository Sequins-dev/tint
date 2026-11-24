// Native semantic tests for branchless fcsel/csel select diamonds (including
// NaN, -0, +0, infinities, and 1-arm updates), narrowed non-null reference
// reads, scalar-replaced closure environments with promoted mutable cells,
// inlined number-list pushes, and loop-invariant reference-list length caching
// (including verifying mutation inside a loop is still observed).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `interface Point {
  readonly x: number;
  readonly y: number;
}
function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}
function clampHighOnly(value: number): number {
  let out = value;
  if (out > 64) out = 64;
  return out;
}
function clampLowOnly(value: number): number {
  let out = value;
  if (out < -64) out = -64;
  return out;
}
function describeNumber(v: number): string {
  if (v !== v) return "NaN";
  if (v === 0 && 1 / v < 0) return "-0";
  return String(v);
}
function testSelectEdges(): string {
  const inputs: number[] = [
    -Infinity,
    -100,
    -64,
    -0.5,
    -0,
    0,
    0.5,
    64,
    100,
    Infinity,
    NaN,
  ];
  let out = "";
  for (let i = 0; i < inputs.length; i++) {
    const v = inputs[i] ?? 0;
    const c = clamp(v, -64, 64);
    const ch = clampHighOnly(v);
    const cl = clampLowOnly(v);
    const negZeroSelect = v === 0 ? -0 : 0;
    const flag = v > 0 ? true : false;
    out +=
      describeNumber(c) +
      "," +
      describeNumber(ch) +
      "," +
      describeNumber(cl) +
      "," +
      describeNumber(negZeroSelect) +
      "," +
      (flag ? "T" : "F") +
      ";";
  }
  return out;
}
function makeCounter(step: number): () => number {
  let count = 0;
  return (): number => {
    count += step;
    return count;
  };
}
function testClosuresAndPipelines(): string {
  let sum = 0;
  const seed: number[] = [];
  for (let i = 0; i < 20; i++) seed.push(i - 5);
  for (let r = 0; r < 12; r++) {
    const step = (r & 7) + 1;
    const next = makeCounter(step);
    for (let i = 0; i < 16; i++) sum = (sum + next()) | 0;
    const factor = (r % 5) + 1;
    const mapped = seed
      .map((n: number): number => n * factor + 1)
      .filter((n: number): boolean => (n & 1) === 0);
    for (let i = 0; i < mapped.length; i++) sum = (sum + (mapped[i] ?? 0)) | 0;
  }
  return String(sum);
}
function testListLengthAndNullChecks(): string {
  const points: Point[] = [];
  for (let i = 0; i < 16; i++) points.push({ x: i * 2 - 5, y: i % 5 });
  // Read-only loop: length and root vector stay invariant.
  let roSum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (a === undefined || b === undefined) throw "missing";
    roSum += a.x * b.x + a.y * b.y + (b.x * 3 - b.y);
  }
  // Mutating loop: pushing inside the loop must update length on every iteration!
  let rwSum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) throw "missing";
    rwSum += p.x + p.y;
    if (i < 4) points.push({ x: i + 100, y: 1 });
  }
  // Throw path when an element really is undefined.
  let caught = "none";
  try {
    const a = points[999];
    if (a === undefined) throw "caught-undef";
    caught = String(a.x);
  } catch (e) {
    caught = typeof e === "string" ? e : "other";
  }
  return String(roSum) + ":" + String(rwSum) + ":" + String(points.length) + ":" + caught;
}
export function trace(): string {
  return (
    testSelectEdges() +
    "|" +
    testClosuresAndPipelines() +
    "|" +
    testListLengthAndNullChecks()
  );
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-select-closures-"));
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

test("select diamonds, narrowed non-null reads, promoted closure cells and list lengths match ECMAScript", async () => {
  const expected = await expectedTrace(source);
  verifyHostedFixture(
    source +
      `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`,
    "select-and-closures",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});
