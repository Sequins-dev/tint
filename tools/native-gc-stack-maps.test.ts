// Precise GC stack maps: collectors find roots by walking native frames and
// updating exactly the frame words each safepoint's map lists. The fixture
// keeps references live across calls, allocations and collections in every
// kind of frame word (slots, temporaries, closure environments, general
// values, exception transfer slots) and in callee-saved register homes
// (found where the frames below saved them), lets slots die at some
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
/** References kept in callee-saved registers across collecting calls:
 * loop-carried slots read every iteration take register homes and stay in
 * them while churn and the calls below collect. The chain alternates frames
 * that save several homes (holders), frames that hold nothing across their
 * call and so pass every register through (relay), and frames that save
 * only one (single), so a collection finds each register's value in the
 * save area of whichever frame below saved it. */
function holders(depth: number, seed: Cell): number {
  let a = cell(depth, seed);
  let b = cell(depth + 1, undefined);
  let c = "h" + String(depth);
  let d: Cell | undefined = undefined;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    total = (total * 3 + a.value + b.value + c.length + churn(1, i + depth)) % 1000003;
    if (depth > 0 && i === 1)
      total = (total + (depth % 2 === 0 ? relay(depth - 1, a) : single(depth - 1, b))) % 1000003;
    b = cell(b.value + (a.value % 7), i % 2 === 0 ? b : undefined);
    c = c.length > 12 ? "h" : c + String(i);
    d = cell(i, d);
    total = (total + sum(d) + a.label.length) % 1000003;
  }
  return (total + sum(a) + sum(b) + c.length + sum(d)) % 1000003;
}
/** Holds nothing across its call: every register passes through. */
function relay(depth: number, seed: Cell): number {
  return (holders(depth, cell(seed.value + 1, undefined)) + 1) % 1000003;
}
/** One loop-carried reference: saves a single register. */
function single(depth: number, seed: Cell): number {
  let kept = cell(seed.value * 2, seed);
  let total = 0;
  for (let i = 0; i < 3; i++) {
    total = (total * 5 + kept.value + churn(1, depth + i)) % 1000003;
    if (i === 0) total = (total + holders(depth, kept)) % 1000003;
    kept = cell(kept.value + 1, i === 1 ? undefined : kept);
  }
  return (total + sum(kept)) % 1000003;
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
    total = (total * 31 + holders(40, cell(pass, undefined))) % 1000003;
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
      // The 300-deep walk needs more than the default 1 MiB stack on x86-64.
      // Keep the heap small so the same workload still forces collections.
      stackBytes: 2097152,
    },
  );
});

test("wide stack maps stream into final storage on a bounded native heap", () => {
  verifyHostedFixture(
    `import { planWideStackMapTable, type SafepointEntry } from "stack-maps";
export function run(): number {
  const entries: SafepointEntry[] = [];
  const count = 128;
  const roots = 3072;
  for (let i = 0; i < count; i++) {
    const map: number[] = [roots * 16, roots];
    for (let j = 0; j < roots; j++) map.push((j + i) * 8);
    map.push(0);
    map.push(0);
    entries.push({ offset: i * 3, start: 0, map });
  }
  const table = planWideStackMapTable(entries);
  const words = new Float64Array(table.wordLength);
  let cursor = 0;
  table.forEachWord((word: number): void => { words[cursor] = word; cursor++; });
  return cursor === 3 + count * (roots + 6) &&
    words[2] === count && words[4] === 3 + count * 2 &&
    words[cursor - 3] === (roots + count - 2) * 8 ? 42 : 1;
}`,
    "wide-stack-map-stream",
    [["stack-maps", "packages/codegen/src/scalar/stack-maps.ts"]],
    [],
    [],
    [],
    { managedBytes: 24 * 1024 * 1024, allocationCapacity: 1048576 },
  );
});

test("x86-64 assembly releases local fixups before allocating the final image", () => {
  verifyHostedFixture(
    `import { createAssembler, type Instruction } from "x64-isa";
export function run(): number {
  const assembler = createAssembler();
  const call: Instruction = { op: "call", target: { kind: "label", label: "end" } };
  const count = 100000;
  for (let i = 0; i < count; i++) assembler.instruction(call);
  assembler.instruction({ op: "label", name: "end" });
  const byteLength = 7 * 1024 * 1024;
  const layout = assembler.finish(undefined, byteLength);
  const last = (count - 1) * 5;
  return layout.bytes.length === byteLength &&
    layout.labels.get("end") === count * 5 &&
    layout.bytes[0] === 232 && layout.bytes[1] === 27 &&
    layout.bytes[2] === 161 && layout.bytes[3] === 7 &&
    layout.bytes[last] === 232 && layout.bytes[last + 1] === 0 &&
    layout.externalFixups.length === 0 ? 42 : 1;
}`,
    "x64-local-relocations-heap",
    [["x64-isa", "packages/codegen/src/x86_64/isa.ts"]],
    [],
    [],
    [],
    { managedBytes: 24 * 1024 * 1024, allocationCapacity: 1048576 },
  );
});
