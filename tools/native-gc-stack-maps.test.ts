// Precise GC stack maps: collectors find roots by walking native frames and
// updating exactly the frame words each safepoint's map lists. The fixture
// keeps references live across calls, allocations and collections in every
// kind of frame word (slots, temporaries, closure environments, general
// values, exception transfer slots, register homes), lets slots die at some
// safepoints and be live at others, recurses deeply, throws through frames
// holding references, and churns a small heap so that many minor and major
// collections move everything it holds. The same source runs in Node for the
// expected checksum and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

export const stackMapFixtureSource = `interface Cell {
  readonly value: number;
  readonly label: string;
  next: Cell | undefined;
}
interface Box {
  readonly items: number[];
  tag: string;
}
function cell(value: number, next: Cell | undefined): Cell {
  return { value, label: "c" + String(value % 97), next };
}
/** Garbage that forces collections while callers hold references. */
function churn(rounds: number, seed: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const list: number[] = [];
    for (let i = 0; i < 64; i++) list.push((seed + i * round) % 1009);
    const text = "r" + String(round) + ":" + String(list.length);
    total = (total + (list[round % 64] ?? 0) + text.length) % 1000003;
  }
  return total;
}
function sum(list: Cell | undefined): number {
  let total = 0,
    current = list;
  while (current !== undefined) {
    total = (total * 7 + current.value + current.label.length) % 1000003;
    current = current.next;
  }
  return total;
}
/** Deep recursion: every frame holds a cell, a box and a string across the
 * recursive call and the churn that follows it. */
function deep(depth: number, tail: Cell | undefined): number {
  const mine = cell(depth, tail);
  const box: Box = { items: [depth, depth * 2], tag: "d" + String(depth) };
  if (depth === 0) return churn(40, 3) + sum(mine);
  const below = deep(depth - 1, mine);
  const noise = churn(depth % 5 === 0 ? 2 : 0, depth);
  box.items.push(below % 1000);
  return (
    (below * 3 +
      sum(mine) +
      (box.items[0] ?? 0) +
      (box.items[2] ?? 0) +
      box.tag.length +
      noise) %
    1000003
  );
}
/** Closures: captured cells live in a closure environment across calls. */
function counters(seed: number): () => number {
  let hits = 0;
  const kept = cell(seed, cell(seed + 1, undefined));
  const names: string[] = ["a" + String(seed)];
  return () => {
    hits++;
    names.push("n" + String(hits));
    churn(3, hits);
    return (sum(kept) + hits * 13 + names.length) % 1000003;
  };
}
function closures(): number {
  const all: (() => number)[] = [];
  for (let i = 0; i < 12; i++) all.push(counters(i));
  let total = 0;
  for (let round = 0; round < 20; round++)
    for (let i = 0; i < all.length; i++) {
      const next = all[i];
      if (next === undefined) throw "closure";
      total = (total * 5 + next()) % 1000003;
    }
  return total;
}
/** Throws after allocating, through frames that hold references; the
 * handlers read references held before the throw. */
function thrower(depth: number, held: Cell): number {
  const local = cell(depth * 3, held);
  churn(2, depth);
  if (depth === 0) throw "bottom " + String(local.value);
  const result = thrower(depth - 1, local);
  return result + local.value;
}
function exceptions(): number {
  let total = 0;
  for (let round = 0; round < 30; round++) {
    const before = cell(round, cell(round + 100, undefined));
    const label = "round" + String(round);
    try {
      total += thrower(round % 9, before);
    } catch (error) {
      const message = typeof error === "string" ? error : "?";
      churn(1, round);
      total = (total * 3 + message.length + sum(before) + label.length) % 1000003;
    }
  }
  return total;
}
/** A slot that is live at some safepoints and dead at others: reassigned,
 * read only on some paths, and read after a loop of collecting calls. */
function phases(rounds: number): number {
  let total = 0;
  let keep: Cell | undefined = cell(1, undefined);
  let other = cell(2, undefined);
  for (let round = 0; round < rounds; round++) {
    churn(1, round);
    if (round % 3 === 0) {
      total = (total + sum(keep)) % 1000003;
      keep = cell(round, keep !== undefined && round % 6 === 0 ? undefined : keep);
    } else other = cell(round + 7, other.value % 2 === 0 ? undefined : other);
    const fresh = cell(round * 5, undefined);
    churn(1, round + 1);
    total = (total * 11 + fresh.value + fresh.label.length) % 1000003;
  }
  return (total + sum(keep) + sum(other)) % 1000003;
}
/** Unknown values (general two-word storage) across collections. */
function generals(): number {
  const values: unknown[] = [];
  for (let i = 0; i < 200; i++)
    values.push(i % 3 === 0 ? "s" + String(i) : i % 3 === 1 ? i : cell(i, undefined));
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    churn(i % 10 === 0 ? 1 : 0, i);
    if (typeof value === "string") total = (total * 3 + value.length) % 1000003;
    else if (typeof value === "number") total = (total * 3 + value) % 1000003;
    else total = (total * 3 + 1) % 1000003;
  }
  return total;
}
/** Strings concatenated across allocations, kept in temporaries. */
function strings(): number {
  let text = "";
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const part = "p" + String(i % 37);
    text = text.length > 200 ? part : text + part;
    total = (total * 3 + text.length + part.charCodeAt(0)) % 1000003;
  }
  return total;
}
function pair(left: Cell, right: Cell): Cell {
  churn(1, left.value);
  return cell(left.value * 2 + right.value, left);
}
function text(value: number): string {
  return "t" + String(value) + "-" + String(value * 3);
}
/** Results held in temporaries while later arguments allocate and collect:
 * nested calls, concatenations of call results, array literals. */
function temporaries(): number {
  let total = 0;
  for (let i = 0; i < 300; i++) {
    const joined = pair(cell(i, undefined), pair(cell(i + 1, undefined), cell(i + 2, undefined)));
    const words = text(i) + text(i + 1) + text(i + 2);
    const cells: Cell[] = [cell(i, undefined), pair(cell(i, undefined), cell(1, undefined)), cell(i * 2, undefined)];
    total = (total * 7 + sum(joined) + words.length + sum(cells[1]) + (cells[2]?.value ?? 0)) % 1000003;
  }
  return total;
}
export function checksum(): number {
  let total = 0;
  for (let pass = 0; pass < 3; pass++) {
    total = (total * 31 + deep(300, undefined)) % 1000003;
    total = (total * 31 + closures()) % 1000003;
    total = (total * 31 + exceptions()) % 1000003;
    total = (total * 31 + phases(200)) % 1000003;
    total = (total * 31 + generals()) % 1000003;
    total = (total * 31 + strings()) % 1000003;
    total = (total * 31 + temporaries()) % 1000003;
  }
  return total;
}
`;

export async function expectedStackMapChecksum(): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-stack-maps-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, stackMapFixtureSource);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    return module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("precise stack maps keep references across many collections", async () => {
  const expected = await expectedStackMapChecksum();
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    stackMapFixtureSource +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "gc-stack-maps",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 4194304,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
