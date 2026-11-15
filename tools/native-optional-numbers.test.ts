// `number | undefined` is one NaN-boxed word natively: `undefined` is a
// reserved signalling NaN. NaNs (from typed arrays, arithmetic and
// negation) must stay NaNs distinct from `undefined`, -0 must survive, and
// `undefined` must stay distinct from NaN in `===`, `??`, truthiness,
// optional chaining, out-of-range typed-array reads, record and class
// fields, closures, and parameters and returns (including stack arguments).
// The same source runs in Node for the expected checksum and natively under
// LLDB. The typed subset cannot alias a Float64Array's buffer, so the exact
// reserved bit pattern is exercised by verify-scalar-native's raw-element
// fixtures (f64-reserved-nan-*).
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

const source = `function classify(value: number | undefined): number {
  if (value === undefined) return 1;
  if (value !== value) return 2;
  if (value === 0) return 1 / value < 0 ? 3 : 4;
  if (value === Infinity) return 5;
  if (value === -Infinity) return 6;
  return 7 + (((Math.trunc(value * 4) % 1000) + 1000) % 1000);
}
function mix(total: number, value: number): number {
  return (total * 31 + value) % 1000003;
}
function identity(value: number | undefined): number | undefined {
  return value;
}
function negate(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return -value;
}
function many(
  a: number | undefined,
  b: number | undefined,
  c: number | undefined,
  d: number | undefined,
  e: number | undefined,
  f: number | undefined,
  g: number | undefined,
): number {
  return (
    classify(a) +
    2 * classify(b) +
    3 * classify(c) +
    5 * classify(d) +
    7 * classify(e) +
    11 * classify(f) +
    13 * classify(g)
  );
}
function truth(value: number | undefined): number {
  let result = 0;
  if (value) result += 1;
  if (!value) result += 2;
  if (value === undefined) result += 4;
  if (value !== undefined) result += 8;
  if (Number.isInteger(value)) result += 16;
  return result;
}
function equalities(a: number | undefined, b: number | undefined): number {
  let result = 0;
  if (a === b) result += 1;
  if (a !== b) result += 2;
  if (a == b) result += 4;
  return result;
}
interface Point {
  readonly x?: number;
  y: number | undefined;
}
interface Cell {
  value: number | undefined;
  other: number | undefined;
  readonly missing?: number;
}
function makeCell(value: number | undefined): Cell {
  return { value, other: undefined };
}
function capture(value: number | undefined): () => number | undefined {
  return () => value;
}
function holder(): { get(): number | undefined; set(v: number | undefined): void } {
  let held: number | undefined;
  return {
    get: () => held,
    set: (v) => {
      held = v;
    },
  };
}
function filled(): Float64Array {
  const doubles = new Float64Array(8);
  const zero = doubles[0] ?? 1;
  doubles[0] = zero / zero;
  doubles[1] = -(zero / zero);
  doubles[2] = Infinity - Infinity;
  doubles[3] = -0 * Infinity;
  doubles[4] = -0;
  doubles[5] = NaN;
  doubles[6] = 2.5;
  doubles[7] = Infinity;
  return doubles;
}
function reads(): number {
  const doubles = filled();
  let total = 0;
  // Indexes 8 and 9 are out of range: undefined.
  for (let i = 0; i < 10; i++) {
    const read = doubles[i];
    total = mix(total, classify(read));
    total = mix(total, classify(identity(read)));
    total = mix(total, classify(negate(read)));
    total = mix(total, truth(read));
    total = mix(total, classify(read ?? -7));
  }
  return total;
}
function arithmetic(): number {
  const doubles = filled();
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const read = doubles[i];
    const element = read === undefined ? 3 : read;
    total = mix(total, classify(element + 1));
    const doubled: number | undefined = read === undefined ? undefined : read * 2;
    total = mix(total, classify(doubled));
    const negated: number | undefined = read === undefined ? undefined : -read;
    total = mix(total, classify(negated));
  }
  return total;
}
function storage(): number {
  const doubles = filled();
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const read = doubles[i];
    total = mix(total, classify(capture(read)()));
    let point: Point = { y: read };
    if (i % 2 === 1 && read !== undefined) point = { x: read, y: undefined };
    total = mix(total, classify(point.x) * 7 + classify(point.y));
    const cell = makeCell(read);
    total = mix(total, classify(cell.value) * 7 + classify(cell.other));
    total = mix(total, classify(cell.missing));
    cell.other = read;
    total = mix(total, classify(cell.other));
    const maybe: Cell | undefined = i % 3 === 0 ? undefined : cell;
    total = mix(total, classify(maybe?.value));
  }
  const shared = holder();
  total = mix(total, classify(shared.get()));
  shared.set(doubles[0]);
  total = mix(total, classify(shared.get()));
  shared.set(-0);
  total = mix(total, classify(shared.get()));
  return total;
}
function slices(): number {
  const doubles = filled();
  let total = 0;
  for (let i = 0; i < 10; i++)
    total = mix(total, "abcdefgh".slice(1, doubles[i]).length);
  return total;
}
function comparisons(): number {
  const doubles = filled();
  const values: (number | undefined)[] = [];
  for (let i = 0; i < 10; i++) values.push(doubles[i]);
  let total = 0;
  for (let i = 0; i < values.length; i++)
    for (let j = 0; j < values.length; j++)
      total = mix(total, equalities(values[i], values[j]));
  const missing: number | undefined = undefined;
  const nan: number | undefined = NaN;
  total = mix(total, equalities(missing, nan) * 4 + equalities(nan, nan));
  total = mix(total, equalities(missing, undefined) * 4 + equalities(-0, 0));
  return total;
}
function parameters(): number {
  const doubles = filled();
  return many(
    doubles[0],
    doubles[1],
    doubles[8],
    doubles[4],
    doubles[5],
    doubles[9],
    doubles[6],
  );
}
function writes(): number {
  const doubles = filled();
  let total = 0;
  // Writing a NaN read back keeps it a NaN, never undefined.
  for (let i = 0; i < 4; i++) {
    const read = doubles[i];
    if (read !== undefined) doubles[i] = read;
    total = mix(total, classify(doubles[i]));
  }
  return total;
}
function words(): number {
  const small = new Uint32Array(3);
  small[1] = 7;
  let total = 0;
  for (let i = 0; i < 5; i++) {
    total = mix(total, classify(small[i]));
    total = mix(total, small[i] ?? 11);
    total = mix(total, truth(small[i]));
  }
  return total;
}
export function sections(): number[] {
  return [
    reads(),
    arithmetic(),
    storage(),
    slices(),
    comparisons(),
    parameters(),
    writes(),
    words(),
  ];
}
`;

test("NaN-boxed optional numbers keep NaN, -0 and undefined distinct", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-optional-numbers-"));
  let expected: number[];
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      sections(): number[];
    };
    expected = module.sections();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const section of expected) assert.ok(Number.isSafeInteger(section));
  // Exit status 42 when every section matches, else 10 + the first
  // mismatching section's index.
  verifyHostedFixture(
    source +
      `export function run(): number {
  const actual = sections();
  const expected: number[] = [${expected.join(", ")}];
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) return 10 + i;
  return 42;
}\n`,
    "optional-numbers",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
