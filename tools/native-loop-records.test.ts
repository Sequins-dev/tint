// Native semantic tests for loop-carried record scalarization (0-iteration
// object identity, conditional update identity, early return, try/catch
// exception materialization, class Vector-style builder updates),
// preheader-guarded dense/sparse reference-list reads, 2-level nested clamp
// fcsel, and (int32 +/- f64) | 0 dependency-chain fusion edge cases.
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
class Vec {
  readonly x: number;
  readonly y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  add(other: Vec): Vec {
    return new Vec(this.x + other.x, this.y + other.y);
  }
}
function stepPoint(initial: Point, n: number): Point {
  let current: Point = initial;
  for (let i = 0; i < n; i++) {
    current = { x: current.x + 1, y: current.y + i };
  }
  return current;
}
function testDirectLoopRecords(): string {
  const init0: Point = { x: 10, y: 20 };
  const r0 = stepPoint(init0, 0);
  const same0 = r0 === init0;

  const init5: Point = { x: 10, y: 20 };
  const r5 = stepPoint(init5, 5);
  const same5 = r5 === init5;

  // Conditional update inside loop: 0 updates must preserve exact identity.
  const initCond: Point = { x: 3, y: 4 };
  let cNo: Point = initCond;
  for (let i = 0; i < 6; i++) {
    if (i > 100) cNo = { x: cNo.x + 1, y: cNo.y + 1 };
  }
  const sameCondNo = cNo === initCond;

  let cYes: Point = initCond;
  for (let i = 0; i < 6; i++) {
    if (i === 3) cYes = { x: cYes.x + 7, y: cYes.y + 8 };
  }
  const sameCondYes = cYes === initCond;

  // Early return inside loop (both 0-iteration and mid-loop).
  const early = (limit: number, stopAt: number): { readonly p: Point; readonly same: boolean } => {
    const seed: Point = { x: 5, y: 6 };
    let cur: Point = seed;
    for (let i = 0; i < limit; i++) {
      if (i === stopAt) return { p: cur, same: cur === seed };
      cur = { x: cur.x + 2, y: cur.y + 3 };
    }
    return { p: cur, same: cur === seed };
  };
  const e0 = early(5, 0);
  const e3 = early(10, 3);

  // Exception exit materialization: throw before any update preserves identity;
  // throw after updates materializes the updated point for the catch block.
  const seedThrow0: Point = { x: 1, y: 2 };
  let curThrow0: Point = seedThrow0;
  try {
    for (let i = 0; i < 5; i++) {
      if (i === 0) throw "at0";
      curThrow0 = { x: curThrow0.x + 10, y: curThrow0.y + 10 };
    }
  } catch (e) {
    if (e !== "at0") throw "unexpected";
  }
  const sameThrow0 = curThrow0 === seedThrow0;

  const seedThrow3: Point = { x: 1, y: 2 };
  let curThrow3: Point = seedThrow3;
  try {
    for (let i = 0; i < 10; i++) {
      if (i === 3) throw "at3";
      curThrow3 = { x: curThrow3.x + 10, y: curThrow3.y + i };
    }
  } catch (e) {
    if (e !== "at3") throw "unexpected";
  }
  const sameThrow3 = curThrow3 === seedThrow3;

  return [
    same0 ? "1" : "0",
    String(r0.x) + "," + String(r0.y),
    same5 ? "1" : "0",
    String(r5.x) + "," + String(r5.y),
    sameCondNo ? "1" : "0",
    sameCondYes ? "1" : "0",
    String(cYes.x) + "," + String(cYes.y),
    e0.same ? "1" : "0",
    String(e0.p.x) + "," + String(e0.p.y),
    e3.same ? "1" : "0",
    String(e3.p.x) + "," + String(e3.p.y),
    sameThrow0 ? "1" : "0",
    String(curThrow0.x) + "," + String(curThrow0.y),
    sameThrow3 ? "1" : "0",
    String(curThrow3.x) + "," + String(curThrow3.y),
  ].join("|");
}
function testClassLoopRecords(): string {
  const step = new Vec(1.5, -0.5);
  const init0 = new Vec(2, 3);
  let p0 = init0;
  for (let i = 0; i < 0; i++) p0 = p0.add(step);
  const same0 = p0 === init0;

  const init8 = new Vec(2, 3);
  let p8 = init8;
  for (let i = 0; i < 8; i++) p8 = p8.add(step);
  const same8 = p8 === init8;

  const initEx = new Vec(4, 5);
  let pEx = initEx;
  try {
    for (let i = 0; i < 8; i++) {
      pEx = pEx.add(step);
      if (i === 2) throw "vec-stop";
    }
  } catch (e) {
    if (e !== "vec-stop") throw "unexpected";
  }
  const sameEx = pEx === initEx;
  return [
    same0 ? "1" : "0",
    String(p0.x) + "," + String(p0.y),
    same8 ? "1" : "0",
    String(p8.x) + "," + String(p8.y),
    sameEx ? "1" : "0",
    String(pEx.x) + "," + String(pEx.y),
  ].join("|");
}
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
function stringNestedSelect(a: string, b: string, x: number): number {
  return a === b ? -10 : x > 5 ? 5 : x;
}
function describeNumber(v: number): string {
  if (v !== v) return "NaN";
  if (v === 0 && 1 / v < 0) return "-0";
  return String(v);
}
function testListsClampAndFusedIntAdd(): string {
  // Dense reference list read via points[i - 1] and points[i].
  const dense: Point[] = [];
  for (let i = 0; i < 32; i++) dense.push({ x: i % 13, y: (i * 7) % 11 });
  let denseSum = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1],
      b = dense[i];
    if (a === undefined || b === undefined) throw "dense";
    denseSum = (denseSum + clamp(a.x * b.x - b.y, -64, 64)) | 0;
  }
  // Sparse reference list with huge index gap must take cold fallback cleanly.
  const sparse: Point[] = [{ x: 1, y: 2 }];
  sparse[1000] = { x: 9, y: 8 };
  let sparseHits = 0;
  let sparseSum = 0;
  for (let i = 0; i < sparse.length; i++) {
    const p = sparse[i];
    if (p !== undefined) {
      sparseHits++;
      sparseSum += p.x + p.y;
    }
  }
  // Nested clamp edge cases: NaN, -0, +0, infinities, boundaries.
  const clampVals: number[] = [
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
  let clampOut = "";
  for (let i = 0; i < clampVals.length; i++) {
    const v = clampVals[i] ?? 0;
    clampOut += describeNumber(clamp(v, -64, 64)) + ",";
  }
  // (int32 +/- f64) | 0 edge cases: exact int32, fractional, -0, NaN, Inf,
  // 2^31, -2^31 - 1, 1e20, and int32 wrap-around overflow.
  const addInputs: number[] = [
    0,
    -0,
    1,
    -1,
    0.5,
    -0.5,
    1.7,
    -1.7,
    2000000000,
    2147483647,
    2147483648,
    -2147483648,
    -2147483649,
    1e20,
    NaN,
    Infinity,
    -Infinity,
  ];
  let accAdd = 2000000000 | 0;
  let accSub = -2000000000 | 0;
  let accOut = "";
  for (let i = 0; i < addInputs.length; i++) {
    const v = addInputs[i] ?? 0;
    accAdd = (accAdd + v) | 0;
    accSub = (accSub - v) | 0;
    const revSub = (v - accAdd) | 0;
    accOut += String(accAdd) + ":" + String(accSub) + ":" + String(revSub) + ";";
  }
  const longA = "abcdefghijklmnopqrstuvwxyz0123456789" + String(denseHits(dense));
  const longB = "abcdefghijklmnopqrstuvwxyz0123456789" + String(denseHits(dense));
  const longC = "abcdefghijklmnopqrstuvwxyz0123456789" + String(denseHits(dense) + 1);
  const strSel =
    String(stringNestedSelect(longA, longB, 9)) +
    "," +
    String(stringNestedSelect(longA, longC, 9)) +
    "," +
    String(stringNestedSelect(longA, longC, 2));
  return (
    String(denseSum) +
    "|" +
    String(sparseHits) +
    "," +
    String(sparseSum) +
    "|" +
    clampOut +
    "|" +
    strSel +
    "|" +
    accOut
  );
}
function denseHits(list: Point[]): number {
  return list.length;
}
export function trace(): string {
  return (
    testDirectLoopRecords() +
    "##" +
    testClassLoopRecords() +
    "##" +
    testListsClampAndFusedIntAdd()
  );
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-loop-records-"));
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

test("loop-carried record scalarization, unchecked list reads, nested fcsel and fused int32 add match ECMAScript", async () => {
  const expected = await expectedTrace(source);
  verifyHostedFixture(
    source +
      `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`,
    "loop-records",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});
