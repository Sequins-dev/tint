// Numeric temporaries live across record allocation: record constructors
// keep numbers in d16..d31 through their inline allocation and save them on
// the slow path around the allocator call. A small heap makes that slow path
// (and collection) run constantly while temporaries are live: as fields of
// the new record, as values used after it, as optional numbers, and in
// records with reference fields that the collector moves. The same source
// runs in Node for the expected checksum and natively under LLDB.
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

const source = `interface Point {
  readonly x: number;
  readonly y: number;
}
interface Sample {
  readonly a: number;
  readonly b: number;
  readonly c: number | undefined;
  readonly d: number;
  readonly label: string;
  readonly next: Sample | undefined;
}
function mix(total: number, value: number): number {
  return (Math.imul(total, 31) + (value | 0)) | 0;
}
function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}
// The running point is a fresh record each step, read back the next.
function walk(steps: number): number {
  let total: Point = { x: 0.5, y: -0.25 };
  let checksum = 0;
  for (let i = 0; i < steps; i++) {
    total = add(total, { x: (i % 7) * 0.5, y: ((i >> 3) & 7) - 3 });
    if (i % 97 === 0) checksum = mix(checksum, total.x * 8 + total.y);
  }
  return mix(checksum, total.x * 2 + total.y);
}
// Several temporaries live across each allocation, some used after it,
// with a reference chain the collector must move.
function chain(steps: number): number {
  let head: Sample | undefined = undefined;
  let checksum = 0;
  for (let i = 0; i < steps; i++) {
    const p = i * 1.5,
      q = (i % 13) - 6.25,
      r = i % 5 === 0 ? undefined : i / 4;
    const s: Sample = {
      a: p + q,
      b: p * q,
      c: r,
      d: q - p,
      label: i % 3 === 0 ? "three" : "other",
      next: i % 64 === 0 ? undefined : head,
    };
    head = s;
    checksum = mix(checksum, p - q + (r ?? 7) + s.a);
  }
  let length = 0;
  let at = head;
  while (at !== undefined) {
    length++;
    checksum = mix(checksum, at.a + at.b + (at.c ?? 3) + at.d);
    checksum = mix(checksum, at.label.length);
    at = at.next;
  }
  return mix(checksum, length);
}
export function checksum(): number {
  let total = 0;
  for (let round = 0; round < 6; round++) {
    total = mix(total, walk(20000 + round));
    total = mix(total, chain(5000 + round * 31));
  }
  return total;
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-allocation-temps-"));
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

test("numeric temporaries survive record allocation through collections", async () => {
  const expected = await expectedChecksum(source);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "allocation-temporaries",
    [],
    [],
    [],
    [],
    // A small heap: the nursery fills every few hundred records.
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 4194304,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
});
