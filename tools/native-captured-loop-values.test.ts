// Captured `let` bindings read in loops: a binding its owner writes only
// before any closure capturing it exists is captured by value (planCaptures),
// and a cell read heading a loop is read once before it (promoteLoopCells).
// Loop counters compared with such bounds must keep ECMAScript number
// semantics: bounds that change inside the loop (directly or through a
// closure the loop calls), writes after capture, non-integer, NaN, negative
// and infinite bounds, fractional and negative starts, counters crossing
// 2^31 and 2^32, and a counter stuck at 2^53. The same source runs in Node
// for the expected checksum and natively under LLDB.
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
  return (total * 31 + value) % 1000003;
}
/** Counted before the closures exist, then read as their loop bound. */
function counted(flags: Uint8Array, items: number[]): number {
  let count = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i] === 1) ++count;
  const sum = (): number => {
    let total = 0;
    for (let slot = 0; slot < count; slot++)
      total = mix(total, items[slot] ?? -1);
    return total;
  };
  const twice = (): number => sum() * 2 + count;
  return mix(sum(), twice());
}
/** A hoisted declaration referred to before a write is created before it,
 * so it shares the binding; one referred to only later copies its value. */
function hoisted(limit: number): number {
  let n = 1;
  function read(): number {
    let total = 0;
    for (let i = 0; i < n; i++) total = mix(total, i);
    return total;
  }
  const early = read;
  for (let i = 0; i < limit; i++) n += i;
  let m = 2;
  for (let i = 0; i < limit; i++) m += 1;
  function after(): number {
    let total = 0;
    for (let i = 0; i < m; i++) total = mix(total, i * 3);
    return total;
  }
  return mix(mix(early(), read()), after());
}
/** Written after the closure is created: the closure sees each write. */
function late(limit: number): number {
  let bound = 1;
  const run = (): number => {
    let total = 0;
    for (let i = 0; i < bound; i++) total = mix(total, i);
    return total;
  };
  let result = run();
  bound = limit;
  result = mix(result, run());
  bound = limit + 0.5;
  return mix(result, run());
}
/** The loop's callee changes the bound while the loop runs. */
function shrinking(limit: number): number {
  let bound = limit;
  const cut = (i: number): void => {
    if (i === 3) bound = 6;
    if (i === 5) bound = bound - 2;
  };
  const run = (): number => {
    let total = 0;
    for (let i = 0; i < bound; i++) {
      cut(i);
      total = mix(total, i * 10 + bound);
    }
    return total;
  };
  return run();
}
/** The loop writes its own captured bound. */
function selfBound(limit: number): number {
  let bound = limit;
  const run = (): number => {
    let total = 0;
    for (let i = 0; i < bound; i++) {
      if (i % 4 === 3) bound = bound - 1;
      total = mix(total, i + bound);
    }
    return mix(total, bound);
  };
  return run();
}
/** Bounds of every kind, captured by value. */
function boundKinds(bound: number, start: number): number {
  let limit = bound;
  limit = limit * 1;
  const count = (): number => {
    let total = 0,
      steps = 0;
    for (let i = start; i < limit; i++) {
      total = mix(total, i);
      if (++steps === 12) break;
    }
    return mix(total, steps);
  };
  return count();
}
/** A counter starting at an integer constant compared with a bound beyond
 * 2^31 or 2^32; the loop stops after a few steps. */
function crossing(base: number): number {
  let limit = base + 4;
  limit = limit + 4;
  const run = (): number => {
    let total = 0,
      last = 0;
    for (let i = 2147483645; i < limit; i++) {
      last = i;
      total = mix(total, i % 1000);
      if (i - 2147483645 > 6) break;
    }
    for (let i = 4294967290; i < limit + 4294967296; i++) {
      last = mix(last, i);
      total = mix(total, i % 1000);
      if (i - 4294967290 > 7) break;
    }
    return mix(total, last % 1000003);
  };
  return run();
}
/** Uint32 bounds at the edges of the word range, with constant starts:
 * the largest uint32, zero, negative zero and negative starts. */
function edges(top: number, zero: number): number {
  let total = 0,
    last = 0;
  for (let i = 4294967290; i < top; i++) {
    last = i;
    total = mix(total, i % 1000);
  }
  total = mix(total, last % 1000003);
  for (let i = -5; i < top - 4294967290; i++) total = mix(total, i + 7);
  for (let i = -3; i < zero; i++) total = mix(total, i + 11);
  for (let i = 0; i < -zero; i++) total = mix(total, 99);
  for (let i = 2; i < zero; i++) total = mix(total, 98);
  return total;
}
/** At 2^53, i + 1 rounds back to 2^53: the counter stops moving. */
function stuck(): number {
  let limit = 9007199254740994;
  limit = limit + 2;
  const run = (): number => {
    let total = 0,
      steps = 0;
    for (let i = 9007199254740990; i < limit; i++) {
      total = mix(total, i - 9007199254740980);
      if (++steps === 8) break;
    }
    return total;
  };
  return run();
}
/** Early exits from loops reading by-value captures and promoted cells. */
function abrupt(limit: number): number {
  let bound = 0;
  for (let i = 0; i < limit; i++) bound += 2;
  const find = (target: number): number => {
    for (let i = 0; i < bound; i++) if (i * i >= target) return i;
    return -1;
  };
  const fail = (target: number): number => {
    for (let i = 0; i < bound; i++) if (i === target) throw "found " + i;
    return bound;
  };
  let total = mix(find(50), find(100000));
  try {
    total = mix(total, fail(5));
  } catch (error) {
    total = mix(total, typeof error === "string" ? error.length : 0);
  }
  return mix(total, fail(-1));
}
export function checksum(): number {
  const flags = new Uint8Array(20);
  const items: number[] = [];
  for (let i = 0; i < 20; i++) {
    flags[i] = i % 3 === 0 ? 1 : 0;
    items.push(i * 7);
  }
  let total = counted(flags, items);
  total = mix(total, hoisted(6));
  total = mix(total, late(7));
  total = mix(total, shrinking(10));
  total = mix(total, selfBound(14));
  const bounds = [3.5, 0, -1, -2.5, 2147483649, 4294967296, Infinity, -Infinity, NaN, 1e300];
  const starts = [0, -3, -2.5, 0.25, 2147483646, 4294967294];
  for (const bound of bounds)
    for (const start of starts)
      if (bound !== undefined && start !== undefined)
        total = mix(total, boundKinds(bound, start));
  total = mix(total, crossing(2147483645));
  total = mix(total, stuck());
  total = mix(total, edges(4294967295, 0));
  total = mix(total, edges(4294967294.5, -0));
  total = mix(total, abrupt(9));
  return total;
}
`;

test("captured loop bounds and counters keep ECMAScript number semantics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-captured-loop-values-"));
  let expected: number;
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    expected = module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "captured-loop-values",
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
