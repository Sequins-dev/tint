// Managed objects start and end on the moving collectors' 8-byte allocation
// granule: an odd number of words is no longer padded to 16 bytes, so about
// half the objects of a mixed heap start at 8 mod 16, and start and dirty
// bits cover 8-byte units. These fixtures allocate records of one, three and
// five words after the header (24, 40 and 56 bytes), strings of every length
// mod 8 (concatenated, sliced and built from code units) and typed arrays of
// odd byte lengths (cleared by the array initializer from an 8 mod 16 start),
// interleave them, write old-to-young edges into promoted odd-sized objects,
// and churn small heaps through many collections, minor and major. The
// copying fixture holds weak slots and ephemerons among odd-sized objects
// across forced collections. The same source runs in Node for the expected
// checksum and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const churn = `interface One {
  readonly kind: "one";
  next: Item | undefined;
}
interface Three {
  readonly kind: "three";
  readonly a: number;
  text: string;
  next: Item | undefined;
}
interface Five {
  readonly kind: "five";
  readonly a: number;
  readonly b: number;
  readonly text: string;
  bytes: Uint8Array;
  next: Item | undefined;
}
type Item = One | Three | Five;
function mix(total: number, value: number): number {
  return (total * 31 + value) % 1000003;
}
function hash(text: string): number {
  let total = text.length;
  for (let i = 0; i < text.length; i++) total = mix(total, text.charCodeAt(i));
  return total;
}
function text(seed: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i++)
    result += String.fromCharCode(97 + ((seed + i) % 26));
  return result;
}
function bytes(seed: number, length: number): Uint8Array {
  const values = new Uint8Array(length);
  for (let i = 0; i < length; i++) values[i] = (seed * 7 + i) % 251;
  return values;
}
function make(round: number, i: number): Item {
  const length = (round + i) % 18;
  switch ((round + i) % 3) {
    case 0:
      return { kind: "one", next: undefined };
    case 1:
      return { kind: "three", a: round, text: text(i, length), next: undefined };
    default:
      return {
        kind: "five",
        a: round,
        b: -i,
        text: text(round, length).slice(1, 1 + (length % 9)),
        bytes: bytes(i, length),
        next: undefined,
      };
  }
}
function digest(item: Item | undefined, depth: number): number {
  let total = 0;
  let current = item;
  for (let step = 0; step < depth && current !== undefined; step++) {
    switch (current.kind) {
      case "one":
        total = mix(total, 1);
        break;
      case "three":
        total = mix(mix(total, current.a), hash(current.text));
        break;
      case "five": {
        total = mix(mix(total, current.a + current.b), hash(current.text));
        const values = current.bytes;
        // Every element past the written length reads as zero, and the
        // element after the end does not exist.
        for (let j = 0; j < values.length; j++)
          total = mix(total, values[j] ?? 999);
        total = mix(total, values[values.length] === undefined ? 3 : 4);
        break;
      }
    }
    current = current.next;
  }
  return total;
}
export function checksum(): number {
  const window: Item[] = [];
  const texts: string[] = [];
  let total = 0;
  for (let round = 0; round < 3000; round++) {
    // Garbage of every size class dies young or after promotion.
    for (let i = 0; i < 30; i++) {
      const junk = make(round, i);
      total = mix(total, junk.kind.length);
      const piece = text(round + i, i % 17) + text(i, (round + i) % 9);
      total = mix(total, piece.length);
      const zeros = new Uint16Array(i % 11);
      total = mix(total, zeros.length + (zeros[0] ?? 7));
    }
    const slot = round % 400,
      item = make(round, slot);
    if (slot === window.length) window.push(item);
    else window[slot] = item;
    // An old-to-young edge: a promoted odd-sized object gains a young tail.
    const old = window[(round * 7) % window.length];
    if (old !== undefined && old !== item) {
      old.next = make(round + 1, slot);
      if (old.kind === "three") old.text = text(round, round % 13);
      if (old.kind === "five") old.bytes = bytes(round, round % 21);
    }
    const kept = text(round, round % 8) + "|" + text(slot, (round + 3) % 8);
    if (round % 50 === 0) texts.push(kept);
    if (round % 200 === 0)
      for (let i = 0; i < window.length; i++)
        total = mix(total, digest(window[i], 3));
  }
  for (let i = 0; i < window.length; i++)
    total = mix(total, digest(window[i], 4));
  for (let i = 0; i < texts.length; i++) total = mix(total, hash(texts[i] ?? ""));
  return total;
}
`;

const weak = "packages/native-runtime/src/intrinsics/weak.ts",
  memory = "packages/native-runtime/src/intrinsics/memory.ts";
// Weak slots (48 bytes) sit between 24- and 40-byte objects, so slots and
// their keys start at both 0 and 8 mod 16 and move to new granules on every
// collection.
const weakFixture = `import {createWeakSlot,weakSlotKey,weakSlotValue} from "weak";
import {collectGarbage} from "memory";
interface Small { readonly id: number; }
interface Wide { readonly id: number; readonly label: string; readonly next: Small | undefined; }
function small(id: number): Small { return { id }; }
export function run(): number {
  const strong: Small[] = [];
  const cells: unknown[] = [];
  const pairs: unknown[] = [];
  const wides: Wide[] = [];
  for (let i = 0; i < 64; i++) {
    const key = small(i);
    if (i % 2 === 0) strong.push(key);
    cells.push(createWeakSlot(key, undefined, false));
    wides.push({ id: i, label: "w".repeat(i % 9), next: i % 3 === 0 ? key : undefined });
    // Ephemeron: the heap string value lives exactly as long as its key.
    pairs.push(createWeakSlot(key, "v" + String(i), true));
  }
  for (let round = 0; round < 3; round++) {
    collectGarbage();
    for (let i = 0; i < 40; i++) small(i);
  }
  for (let i = 0; i < 64; i++) {
    const wide = wides[i];
    if (wide === undefined || wide.id !== i || wide.label.length !== i % 9)
      return 1;
    if ((wide.next === undefined) !== (i % 3 !== 0)) return 2;
    const held = i % 2 === 0 ? strong[i / 2] : wide.next;
    const key = weakSlotKey(cells[i]);
    if (held !== undefined) {
      if (key !== held || held.id !== i) return 3;
      if (weakSlotKey(pairs[i]) !== held) return 4;
      if (weakSlotValue(pairs[i]) !== "v" + String(i)) return 5;
    } else {
      if (key !== undefined) return 6;
      if (weakSlotKey(pairs[i]) !== undefined) return 7;
      if (weakSlotValue(pairs[i]) !== undefined) return 8;
    }
  }
  return 42;
}`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-gc-granule-"));
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

test("odd-word objects survive minor and major collections on 8-byte granules", async () => {
  const expected = await expectedChecksum(churn);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    churn +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "gc-granule-churn",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
});

test("weak slots and ephemerons among odd-word objects move and clear exactly", () => {
  verifyHostedFixture(
    weakFixture,
    "gc-granule-weak",
    [
      ["weak", weak],
      ["memory", memory],
    ],
    [],
    [],
    [
      { module: weak, namespace: "weak-storage" },
      { module: memory, namespace: "native-memory" },
    ],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      rootCapacity: 8192,
      stackBytes: 2097152,
      hostBindings: [
        {
          module: memory,
          name: "collectGarbage",
          operation: "collect-garbage",
        },
      ],
      runtimeEntry: "initializeGenerationalRuntime",
      weakBindings: [
        { module: weak, name: "createWeakSlot", operation: "new" },
        { module: weak, name: "weakSlotKey", operation: "key" },
        { module: weak, name: "weakSlotValue", operation: "value" },
      ],
    },
  );
});
