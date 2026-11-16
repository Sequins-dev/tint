// Counted loops with unknown bounds (boundCountedLoops): `for (let i = s;
// i < b; i++)` compares a word counter against `ceil(max(b, s)) >>> 0`
// computed ahead of the loop, and bounds above 2^32 - 1 run a cold copy
// with a double counter. Fractional, NaN, signed zero, negative, infinite
// and boundary bounds must run exactly the iterations ECMAScript runs,
// including early exits (break, return, throw) out of both versions. Loops
// the rewrite must leave alone (bound or counter written in the body or by
// a closure, fractional or negative starts, other steps, `<=`, counters
// read after the loop) run as written too. The same source runs in Node for
// the expected checksum and natively under LLDB.
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

const source = `function mix(total: number, part: number): number {
  return (total * 31 + part + 1000003) % 1000003;
}
// Runs while i < bound; stops after limit iterations (huge bounds).
function upTo(items: number[], bound: number, limit: number): number {
  let total = 0;
  for (let i = 0; i < bound; i++) {
    if (i >= limit) break;
    total = mix(total, (items[i] ?? 7) + i);
  }
  return total;
}
function fromThree(items: number[], bound: number): number {
  let total = 0;
  for (let i = 3; i < bound; i++) {
    if (i > 40) return mix(total, 99);
    total = mix(total, items[i] ?? 5);
  }
  return total;
}
function throwing(items: number[], bound: number): number {
  let total = 0;
  try {
    for (let i = 0; i < bound; i++) {
      if (i === 17) throw "stop";
      total = mix(total, items[i] ?? 3);
    }
  } catch {
    total = mix(total, 1234);
  }
  return total;
}
// Starts the rewrite does not take: fractional and negative.
function fractionalStart(items: number[], bound: number): number {
  let total = 0;
  for (let i = 0.5; i < bound; i++) {
    if (i > 30) break;
    total = mix(total, (items[i] ?? 2) + i * 2);
  }
  return total;
}
function negativeStart(items: number[], bound: number): number {
  let total = 0;
  for (let i = -3; i < bound; i++) {
    if (i > 30) break;
    total = mix(total, (items[i] ?? 4) + i);
  }
  return total;
}
// The bound changes inside the loop, directly and through a closure.
function shrinking(items: number[], bound: number): number {
  let total = 0;
  let limit = bound;
  for (let i = 0; i < limit; i++) {
    if (i > 50) break;
    total = mix(total, items[i] ?? 6);
    if (i % 4 === 3) limit -= 1.5;
  }
  return total;
}
function closureBound(items: number[], bound: number): number {
  let total = 0;
  let limit = bound;
  const lower = (): void => {
    limit = limit - 2;
  };
  for (let i = 0; i < limit; i++) {
    if (i > 50) break;
    total = mix(total, items[i] ?? 8);
    if (i % 3 === 0) lower();
  }
  return total;
}
// The counter changes inside the loop, directly and through a closure.
function skipping(items: number[], bound: number): number {
  let total = 0;
  for (let i = 0; i < bound; i++) {
    if (i > 60) break;
    total = mix(total, items[i] ?? 9);
    if (i % 5 === 1) i += 2;
  }
  return total;
}
function closureCounter(items: number[], bound: number): number {
  let total = 0;
  let i = 0;
  const bump = (): void => {
    i = i + 0.5;
  };
  for (; i < bound; i++) {
    if (i > 40) break;
    total = mix(total, (items[i] ?? 10) + i);
    if (total % 3 === 0) bump();
  }
  return total;
}
function resetting(items: number[], bound: number): number {
  let total = 0,
    resets = 0;
  for (let i = 0; i < bound; i++) {
    if (i > 40) break;
    total = mix(total, items[i] ?? 11);
    if (i === 6 && resets < 2) {
      resets++;
      i = 1;
    }
  }
  return total;
}
function stepTwo(items: number[], bound: number): number {
  let total = 0;
  for (let i = 0; i < bound; i += 2) {
    if (i > 60) break;
    total = mix(total, items[i] ?? 12);
  }
  return total;
}
function inclusive(items: number[], bound: number): number {
  let total = 0;
  for (let i = 0; i <= bound; i++) {
    if (i > 40) break;
    total = mix(total, items[i] ?? 13);
  }
  return total;
}
// The counter is read after the loop.
function lastIndex(items: number[], bound: number): number {
  let total = 0;
  let i = 0;
  for (; i < bound; i++) {
    if (i > 45) break;
    total = mix(total, items[i] ?? 14);
  }
  return mix(total, i);
}
// Nested counted loops sharing one bound.
function nested(items: number[], bound: number): number {
  let total = 0;
  for (let i = 0; i < bound; i++) {
    if (i > 12) break;
    for (let j = 0; j < bound; j++) {
      if (j > 12) break;
      total = mix(total, (items[i] ?? 1) * 3 + (items[j] ?? 2));
    }
  }
  return total;
}
export function checksum(): number {
  const items: number[] = [];
  for (let k = 0; k < 64; k++) items.push((k * 37) % 101);
  const bounds: number[] = [
    0, -0, 0.5, 1, 2.5, 3, 3.0000001, 7.999, 40, 64, 64.5, 100, -1, -0.5,
    -2.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967295,
    4294967295.5, 4294967296, 9007199254740992, 1e300,
  ];
  let total = 0;
  for (let k = 0; k < bounds.length; k++) {
    const bound = bounds[k] ?? 0;
    total = mix(total, upTo(items, bound, 1000));
    total = mix(total, upTo(items, bound, 70));
    total = mix(total, fromThree(items, bound));
    total = mix(total, throwing(items, bound));
    total = mix(total, fractionalStart(items, bound));
    total = mix(total, negativeStart(items, bound));
    total = mix(total, shrinking(items, bound));
    total = mix(total, closureBound(items, bound));
    total = mix(total, skipping(items, bound));
    total = mix(total, closureCounter(items, bound));
    total = mix(total, resetting(items, bound));
    total = mix(total, stepTwo(items, bound));
    total = mix(total, inclusive(items, bound));
    total = mix(total, lastIndex(items, bound));
    total = mix(total, nested(items, bound));
  }
  return total;
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-counted-loops-"));
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

test("counted loops with unknown bounds run exactly ECMAScript's iterations", async () => {
  const expected = await expectedChecksum(source);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "counted-loops",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
    },
  );
});
