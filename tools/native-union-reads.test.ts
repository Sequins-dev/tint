// Repeated field reads of union receivers. Typed lists of an interface hold
// objects of several record layouts, so each read dispatches on the layout;
// after one dispatch, codegen knows the receiver is one of two layouts and
// reads a field both place alike without a test. Covered: two layouts with
// one placement (readonly literals and mutable objects, both present at
// runtime), a third layout that places the fields differently, receivers
// copied through inlined parameters of nested calls, and optional list
// reads. The same source runs in Node for the expected trace and natively
// under LLDB.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `interface Point {
  readonly x: number;
  readonly y: number;
}
interface MutablePoint {
  x: number;
  y: number;
}
interface Tagged {
  readonly tag: string;
  readonly y: number;
  readonly x: number;
}
function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}
function scaled(a: Point, factor: number): number {
  return a.x * factor - a.y;
}
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
function pairs(points: Point[], rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (a === undefined || b === undefined) throw "point";
      total = (total + clamp(dot(a, b) + scaled(b, round & 7), -64, 64)) | 0;
    }
  }
  return total;
}
function optionalReads(points: Point[]): string {
  let text = "";
  for (let i = 0; i <= points.length; i += 5) {
    const point = points[i];
    text += point === undefined ? "u," : String(point.x + point.y * point.x) + ",";
  }
  return text;
}
function build(kinds: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 48; i++) {
    const kind = i % kinds;
    if (kind === 0) points.push({ x: i % 13, y: (i * 7) % 11 });
    else if (kind === 1) {
      const point: MutablePoint = { x: i % 5, y: -i };
      point.y += 3;
      points.push(point);
    } else {
      const point: Tagged = { tag: "t" + String(i), y: i % 3, x: -i };
      points.push(point);
    }
  }
  return points;
}
export function trace(): string {
  let log = "";
  for (let kinds = 1; kinds <= 3; kinds++) {
    const points = build(kinds);
    log += String(pairs(points, 9)) + ":" + optionalReads(points) + ";";
  }
  return log;
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-union-reads-"));
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

test("union field reads match ECMAScript for every layout mix", async () => {
  const expected = await expectedTrace(source);
  verifyHostedFixture(
    source +
      `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`,
    "union-reads",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});
