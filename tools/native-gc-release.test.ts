// After each major collection the generational runtime returns the evacuated
// semispace's pages beyond a survivor-sized prefix to the OS (memory-release:
// a fixed anonymous mapping over the range), and the next major copies into
// that prefix and the fresh zero pages after it. These
// fixtures churn small heaps through many majors while a slowly replaced
// window of objects survives them: retained data, old-to-young edges written
// into promoted objects, chains cut and rebuilt, and values carried across
// throws must all read back exactly. The second fixture allocates arrays
// large enough to be placed directly in the old prefix, so a full prefix
// forces a major from the allocation path. The same source runs in Node for
// the expected checksum and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const churn = `interface Cell {
  readonly id: number;
  next: Cell | undefined;
  readonly payload: number[];
}
function fill(id: number, length: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < length; i++) values.push(id * 31 + i);
  return values;
}
function digest(cells: Cell[]): number {
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    let cell: Cell | undefined = cells[i];
    // Chains are at most two cells long: each replacement cuts the old tail.
    while (cell !== undefined) {
      total = (total * 7 + cell.id) % 1000003;
      const payload = cell.payload;
      for (let j = 0; j < payload.length; j++)
        total = (total * 3 + (payload[j] ?? 5)) % 1000003;
      cell = cell.next;
    }
  }
  return total;
}
function risky(round: number, cells: Cell[]): number {
  const scratch = fill(round, 40);
  if (round % 13 === 0) throw new Error("round " + String(round));
  return scratch.length + cells.length;
}
export function checksum(): number {
  const cells: Cell[] = [];
  let total = 0;
  for (let round = 0; round < 6000; round++) {
    // Garbage: dies young, or after promotion once the window drops it.
    for (let i = 0; i < 40; i++) {
      const junk = fill(i + round, 12);
      total = (total + (junk[i % 12] ?? 0)) % 1000003;
    }
    const slot = round % 500,
      previous = cells[slot];
    if (previous !== undefined) previous.next = undefined;
    const cell: Cell = {
      id: round,
      next: previous,
      payload: fill(round, 8 + (round % 9)),
    };
    if (slot === cells.length) cells.push(cell);
    else cells[slot] = cell;
    // An old-to-young edge: a promoted payload grows with a young value.
    const old = cells[(round * 7) % cells.length];
    if (old !== undefined && old.payload.length < 64) old.payload.push(round);
    try {
      total = (total + risky(round, cells)) % 1000003;
    } catch (error) {
      total = (total + String(error).length) % 1000003;
    }
    if (round % 250 === 0) total = (total * 11 + digest(cells)) % 1000003;
  }
  return (total * 13 + digest(cells)) % 1000003;
}
`;

const large = `function block(seed: number, length: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < length; i++) values.push((seed + i) % 9973);
  return values;
}
function sum(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++)
    total = (total + (values[i] ?? 1) * (i + 1)) % 1000003;
  return total;
}
export function checksum(): number {
  // A few large blocks survive every major; the rest die after one round.
  const kept: number[][] = [];
  let total = 0;
  for (let round = 0; round < 160; round++) {
    const values = block(round, 90000);
    if (round % 60 === 7) kept.push(values);
    total = (total * 5 + sum(values)) % 1000003;
    for (let i = 0; i < kept.length; i++) {
      const held = kept[i];
      if (held !== undefined) total = (total + (held[round] ?? 3)) % 1000003;
    }
  }
  for (let i = 0; i < kept.length; i++) {
    const held = kept[i];
    if (held !== undefined) total = (total * 7 + sum(held)) % 1000003;
  }
  return total;
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-gc-release-"));
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

async function verify(
  text: string,
  name: string,
  managedBytes: number,
): Promise<void> {
  const expected = await expectedChecksum(text);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    text +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    name,
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
}

test("data survives majors into released semispaces", async () => {
  await verify(churn, "gc-release-churn", 16777216);
});

test("large old allocations force majors into released semispaces", async () => {
  await verify(large, "gc-release-large", 16777216);
});
