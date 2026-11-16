import { test } from "node:test";
import assert from "node:assert/strict";
import { scanNativeObject, scanNativeRoots } from "../src/tracing/index.ts";
import { walkNativeStack } from "../src/tracing/scan.ts";
import { writeStackRoots, type FakeFrame } from "./fixtures/stack-roots.ts";
/** Words of a simulated stack (frames from 256) plus stack-map metadata at
 * 8192, and the registry address. */
function stack(
  frames: readonly FakeFrame[],
  values: readonly (readonly [number, number])[] = [],
  saveBlock: number = 0,
  wide: boolean = false,
) {
  const words = new Map(values);
  const head = writeStackRoots(
    (address, value) => {
      words.set(address, value);
    },
    frames,
    8192,
    saveBlock,
    wide,
  );
  return { words, head, read: (address: number) => words.get(address) };
}
function memory(entries: readonly (readonly [number, number])[]) {
  const words = new Map(entries);
  return (address: number) => words.get(address);
}
test("record descriptors trace references and only reference-valued general slots", () => {
  const read = memory([
    [256, 4096],
    [264, 0],
    [272, 512],
    [280, 0],
    [288, 1],
    [296, 123],
    [304, 3],
    [312, 768],
    [4096, 64],
    [4104, 2],
    [4112, 16],
    [4120, 24],
    [4128, 2],
    [4136, 32],
    [4144, 48],
  ]);
  const seen: number[] = [];
  assert.equal(
    scanNativeObject(read, 256, 64, (p) => {
      seen.push(p);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [512, 768]);
});
test("strings and owned or borrowed typed arrays contain no managed edges; views keep parents", () => {
  for (const marker of [1, 2, 3, 4, 5]) {
    const read = memory([
      [256, marker],
      [264, 0],
      [272, 2],
    ]);
    assert.equal(
      scanNativeObject(read, 256, 64, () => {
        throw Error("unexpected edge");
      }),
      "complete",
    );
  }
  const seen: number[] = [];
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 2],
        [272, 1],
        [288, 512],
      ]),
      256,
      48,
      (p) => {
        seen.push(p);
        return true;
      },
    ),
    "complete",
  );
  assert.deepEqual(seen, [512]);
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 1],
        [272, 100000],
      ]),
      256,
      32,
      () => false,
    ),
    "complete",
  );
});
test("wide safepoint tables locate maps through a separate index word", () => {
  const frames: FakeFrame[] = [
      { sp: 256, references: [16] },
      { sp: 320, references: [], generals: [16] },
    ],
    values: [number, number][] = [
      [272, 768],
      [336, 3],
      [344, 1024],
    ];
  for (const wide of [false, true]) {
    const { read, head, words } = stack(frames, values, 0, wide);
    const seen: number[] = [];
    assert.equal(
      scanNativeRoots(read, head, (p) => {
        seen.push(p);
        return true;
      }),
      "complete",
    );
    assert.deepEqual(seen, [768, 1024], String(wide));
    if (!wide) continue;
    // An index word outside 32 bits is malformed.
    const table = read(head + 48)!;
    words.set(table + 24 + 8, 2 ** 40);
    assert.equal(
      scanNativeRoots(read, head, () => true),
      "invalid",
    );
  }
});
test("stack walks visit each frame's safepoint map, innermost first", () => {
  const { read, head } = stack(
    [
      { sp: 256, references: [16] },
      { sp: 320, references: [], generals: [16] },
    ],
    [
      [272, 768],
      [336, 3],
      [344, 1024],
    ],
  );
  const seen: number[] = [];
  assert.equal(
    scanNativeRoots(read, head, (p) => {
      seen.push(p);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [768, 1024]);
  assert.equal(
    scanNativeRoots(read, 0, () => true),
    "complete",
  );
});
test("register-held references are found where the nearest callee saved them", () => {
  // frame0 saves x22; frame1 keeps a reference in x22 and saves x23; frame2
  // keeps one in x23 (in frame1's save slot) and saves x23 for frame3, which
  // keeps one in x24, saved by no frame: the walk start's save block has it.
  const frames: FakeFrame[] = [
    { sp: 256, references: [], saves: [{ register: 22, offset: 16 }] },
    {
      sp: 320,
      references: [],
      saves: [{ register: 23, offset: 16 }],
      registers: [22],
    },
    {
      sp: 384,
      references: [24],
      saves: [{ register: 23, offset: 16 }],
      registers: [23],
    },
    { sp: 448, references: [], registers: [24] },
  ];
  const values: [number, number][] = [
    [272, 1024],
    [336, 2048],
    [408, 512],
    [4096 + 40, 3072],
  ];
  const f = stack(frames, values, 4096);
  const seen: number[] = [];
  assert.equal(
    scanNativeRoots(f.read, f.head, (p) => {
      seen.push(p);
      return true;
    }),
    "complete",
  );
  // Each frame: its frame words, then its registers.
  assert.deepEqual(seen, [1024, 512, 2048, 3072]);
  // Without a save block, a register no frame saved cannot be located.
  const unknown = stack(frames, values);
  assert.equal(
    scanNativeRoots(unknown.read, unknown.head, () => true),
    "invalid",
  );
  // A save offset outside the frame is malformed.
  const outside = stack(
    [
      { sp: 256, references: [], saves: [{ register: 22, offset: 16 }] },
      { sp: 320, references: [], registers: [22] },
    ],
    [],
    4096,
  );
  const map = 8192 + 56 + 24 + 16;
  outside.words.set(map + 32, 48);
  assert.equal(
    scanNativeRoots(outside.read, outside.head, () => true),
    "invalid",
  );
});
test("stack walks never guess: unknown code, missing safepoints, bad frames", () => {
  const frames = [
    { sp: 256, references: [16] },
    { sp: 320, references: [16] },
  ];
  const count = (words: Map<number, number>, head: number) => {
    let frames = 0;
    const status = walkNativeStack(
      (address) => words.get(address),
      head,
      () => {
        frames++;
        return true;
      },
      100,
      () => true,
    );
    return { status, frames };
  };
  let f = stack(frames, [
    [272, 0],
    [336, 0],
  ]);
  assert.deepEqual(count(f.words, f.head), { status: "complete", frames: 2 });
  assert.equal(
    scanNativeRoots(f.read, f.head, () => true, 1),
    "limit",
  );
  // A return address outside every registered range.
  f.words.set(f.words.get(f.head + 16)! + 8, 1);
  assert.equal(count(f.words, f.head).status, "invalid");
  // A return address in managed code without a safepoint.
  f = stack(frames);
  f.words.set(f.words.get(f.head + 16)! + 8, 8192 + 2);
  assert.equal(count(f.words, f.head).status, "invalid");
  // A frame whose size disagrees with the frame-pointer chain.
  f = stack(frames);
  const map = 8192 + 56 + 24 + 16;
  f.words.set(map, f.words.get(map)! + 16);
  assert.equal(count(f.words, f.head).status, "invalid");
  // A chain that does not move toward the stack base.
  f = stack(frames);
  f.words.set(304, 240);
  assert.equal(count(f.words, f.head).status, "invalid");
  // An unreadable table, and a malformed one.
  f = stack(frames);
  f.words.delete(8192 + 56);
  assert.equal(count(f.words, f.head).status, "read");
  f = stack(frames);
  f.words.set(8192 + 56, 1);
  assert.equal(count(f.words, f.head).status, "invalid");
  // A transparent range (table 0): its frame is passed over unscanned, and
  // the next frame's size is not checked against it.
  f = stack(frames);
  f.words.set(f.head + 48, 0);
  assert.deepEqual(count(f.words, f.head), { status: "complete", frames: 0 });
});
test("bad metadata, missing memory, visitor failure and cycles fail closed", () => {
  assert.equal(
    scanNativeObject(
      memory([
        [256, 4096],
        [264, 0],
        [4096, 32],
        [4104, 1],
        [4112, 32],
      ]),
      256,
      32,
      () => true,
    ),
    "invalid",
  );
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 2],
      ]),
      256,
      48,
      () => true,
    ),
    "read",
  );
  assert.equal(
    scanNativeObject(
      memory([
        [256, 2],
        [264, 2],
        [272, 1],
        [288, 512],
      ]),
      256,
      48,
      () => false,
    ),
    "visitor",
  );
  assert.equal(
    scanNativeObject(
      memory([
        [256, 1],
        [264, 0],
        [272, 100],
      ]),
      256,
      32,
      () => true,
    ),
    "invalid",
  );

  assert.equal(
    scanNativeObject(
      memory([
        [256, 4096],
        [264, 0],
        [4096, 32],
        [4104, 0],
        [4112, 1],
        [4120, 16],
        [272, 8],
      ]),
      256,
      32,
      () => true,
    ),
    "invalid",
  );
});

test("reference visitors receive exact writable slots for records, tagged values, views and roots", () => {
  const read = memory([
    [256, 4096],
    [264, 0],
    [272, 512],
    [280, 3],
    [288, 768],
    [4096, 48],
    [4104, 1],
    [4112, 16],
    [4120, 1],
    [4128, 24],
    [512, 2],
    [520, 2],
    [528, 1],
    [536, 800],
    [544, 768],
    [1040, 256],
    [1048, 3],
    [1056, 512],
  ]);
  const frame = stack([{ sp: 1024, references: [16], generals: [24] }]);
  const edges: (readonly [number, number])[] = [];
  const visit = (value: number, slot: number) => {
    edges.push([value, slot]);
    return true;
  };
  assert.equal(scanNativeObject(read, 256, 48, visit), "complete");
  assert.equal(scanNativeObject(read, 512, 48, visit), "complete");
  assert.equal(
    scanNativeRoots(
      (address) => read(address) ?? frame.read(address),
      frame.head,
      visit,
    ),
    "complete",
  );
  assert.deepEqual(edges, [
    [512, 272],
    [768, 288],
    [768, 544],
    [256, 1040],
    [512, 1056],
  ]);
  // The view's derived data pointer at 536 is not an owning reference.
});
