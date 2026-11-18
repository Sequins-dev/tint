// The collector's stack walk (native-runtime tracing/scan.ts) against the
// tables codegen emits: random functions, frames and safepoints encoded by
// encodeStackMapTable (compact and wide), laid out in a simulated stack, must
// produce exactly the words decodeStackMaps lists, plus register-held
// references at the save slot the nearest saving callee used.
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeStackMaps,
  encodeStackMapTable,
  type DecodedSafepoint,
  type SafepointEntry,
} from "@tint/codegen/aarch64/scalar";
import { walkNativeStack } from "@tint/native-runtime/tracing";

/** Deterministic pseudo-random integers. */
function generator(seed: number): (limit: number) => number {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

interface Layout {
  readonly entries: SafepointEntry[];
  /** Code bytes before the table. */
  readonly tableOffset: number;
}

/** Random functions with long-lived, short-lived and register-held words. */
function functions(random: (limit: number) => number): Layout {
  const entries: SafepointEntry[] = [];
  let offset = 0;
  const count = 1 + random(12);
  for (let fn = 0; fn < count; fn++) {
    const start = offset,
      frameWords = 4 + random(60),
      frameBytes = Math.ceil((frameWords * 8) / 16) * 16 + 64,
      saved: number[] = [],
      saves: number[] = [];
    for (let register = 0; register < 10; register++)
      if (random(3) === 0) {
        saved.push(register);
        saves.push(frameBytes - 16 - 8 * saved.length);
      }
    const savedMask = saved.reduce((mask, bit) => mask + 2 ** bit, 0);
    const safepoints = 1 + random(random(2) === 0 ? 200 : 8);
    // Long-lived words: live from a start index to the end.
    const longStarts = new Map<number, number>();
    for (let word = 0; word < frameWords; word++)
      if (random(4) === 0) longStarts.set(word, random(safepoints));
    let at = start + 4 * (1 + random(4));
    for (let k = 0; k < safepoints; k++) {
      const references: number[] = [],
        generals: number[] = [];
      for (let word = 0; word < frameWords; word++) {
        const longStart = longStarts.get(word);
        const live = longStart !== undefined ? k >= longStart : random(5) === 0;
        if (!live) continue;
        // Generals take two words; keep them off the frame's last word.
        if (word % 3 === 0 && word + 1 < frameWords) generals.push(word * 8);
        else references.push(word * 8);
      }
      let held = 0;
      for (const bit of saved) if (random(4) === 0) held += 2 ** bit;
      entries.push({
        offset: at,
        start,
        map: [
          frameBytes,
          references.length,
          ...references,
          generals.length,
          ...generals,
          savedMask + held * 1024,
          ...saves,
        ],
      });
      at += 4 * (1 + random(30));
    }
    offset = at + 4 * random(8);
  }
  return { entries, tableOffset: Math.ceil((offset + 16) / 8) * 8 };
}

/** Walks a simulated stack of `chain` safepoints (innermost first) and
 * compares the visited words with the decoded maps. */
function check(layout: Layout, chain: readonly DecodedSafepoint[]): void {
  const words = encodeStackMapTable(layout.entries, layout.tableOffset);
  assert.ok(words);
  const codeStart = 1 << 20,
    table = codeStart + layout.tableOffset,
    registry = 1 << 16,
    saveBlock = registry + 512,
    memory = new Map<number, number>();
  words.forEach((word, index) => memory.set(table + index * 8, word));
  [1, 1, 0, saveBlock, codeStart, layout.tableOffset, table].forEach(
    (word, index) => memory.set(registry + index * 8, word),
  );
  // Frames from the collector's record upward.
  const stackStart = 1 << 24;
  let current = stackStart;
  memory.set(registry + 16, current);
  const expected: string[] = [];
  const slots = Array.from({ length: 10 }, (_, bit) => saveBlock + bit * 8);
  for (const site of chain) {
    const sp = current + 16,
      fp = sp + site.frameBytes;
    memory.set(current, fp);
    memory.set(current + 8, codeStart + site.offset);
    for (const offset of site.references) expected.push("r" + (sp + offset));
    for (const offset of site.generals) expected.push("g" + (sp + offset));
    for (const register of site.registers)
      expected.push("r" + slots[register - 19]);
    for (const save of site.saves) slots[save.register - 19] = sp + save.offset;
    current = fp;
  }
  // The outermost frame returns into the entry record.
  memory.set(current, current + 16);
  memory.set(current + 8, 0);
  memory.set(current + 16, 0);
  const seen: string[] = [];
  const status = walkNativeStack(
    (address) => memory.get(address),
    registry,
    (address) => {
      seen.push("r" + address);
      return true;
    },
    (address) => {
      seen.push("g" + address);
      return true;
    },
    1000,
  );
  assert.equal(status, "complete");
  // Order within a frame is the encoding's; compare per walk as sets of
  // words in frame order.
  assert.deepEqual(seen.slice().sort(), expected.slice().sort());
  assert.equal(seen.length, expected.length);
}

test("the stack walk visits exactly the words of compact tables' maps", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const random = generator(seed),
      layout = functions(random),
      words = encodeStackMapTable(layout.entries, layout.tableOffset);
    assert.ok(words);
    const decoded = decodeStackMaps({
      code: (() => {
        const code = new Uint8Array(layout.tableOffset + words.length * 8),
          view = new DataView(code.buffer);
        words.forEach((word, index) =>
          view.setBigUint64(layout.tableOffset + index * 8, BigInt(word), true),
        );
        return code;
      })(),
      stackMaps: [{ codeOffset: 0, tableOffset: layout.tableOffset }],
    });
    assert.ok(decoded);
    // Decoding reproduces every map exactly.
    const sorted = layout.entries
      .slice()
      .sort((left, right) => left.offset - right.offset);
    assert.equal(decoded.length, sorted.length);
    decoded.forEach((site, index) => {
      const map = sorted[index]!.map,
        references = map[1]!,
        generals = map[2 + references]!;
      assert.equal(site.offset, sorted[index]!.offset);
      assert.equal(site.frameBytes, map[0]);
      assert.deepEqual(site.references, map.slice(2, 2 + references));
      assert.deepEqual(
        site.generals,
        map.slice(3 + references, 3 + references + generals),
      );
    });
    // Chains of random safepoints.
    for (let walk = 0; walk < 5; walk++) {
      const chain: DecodedSafepoint[] = [];
      const depth = 1 + random(8);
      for (let frame = 0; frame < depth; frame++)
        chain.push(decoded[random(decoded.length)]!);
      check(layout, chain);
    }
  }
});

test("the stack walk rejects return addresses that are not safepoints", () => {
  const layout = functions(generator(7)),
    words = encodeStackMapTable(layout.entries, layout.tableOffset);
  assert.ok(words);
  const codeStart = 1 << 20,
    table = codeStart + layout.tableOffset,
    registry = 1 << 16,
    memory = new Map<number, number>();
  words.forEach((word, index) => memory.set(table + index * 8, word));
  [1, 1, 1 << 24, 0, codeStart, layout.tableOffset, table].forEach(
    (word, index) => memory.set(registry + index * 8, word),
  );
  const first = layout.entries[0]!;
  for (const returnOffset of [first.offset + 2, first.offset - 4, 0]) {
    memory.set(1 << 24, (1 << 24) + 4096);
    memory.set((1 << 24) + 8, codeStart + returnOffset);
    memory.set((1 << 24) + 4096, (1 << 24) + 8192);
    memory.set((1 << 24) + 8192, 0);
    assert.equal(
      walkNativeStack(
        (address) => memory.get(address),
        registry,
        () => true,
        () => true,
        100,
      ),
      "invalid",
      String(returnOffset),
    );
  }
});
