import assert from "node:assert/strict";
import { frameRoots } from "./frame-roots.ts";
import test from "node:test";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
import type { ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
const module: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "rooted-branch",
      exported: true,
      parameters: [0],
      slots: ["string"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [],
          terminator: { kind: "jump", target: 1, ...s },
        },
        {
          id: 1,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            // Code-unit reads may call a helper: the string's temporary
            // crosses an opaque operation and keeps a frame root word.
            { kind: "constant", id: 9, value: 0, ...s },
            { kind: "string-code-unit", id: 1, string: 0, index: 9, ...s },
          ],
          terminator: { kind: "jump", target: 2, ...s },
        },
        {
          id: 2,
          instructions: [
            { kind: "load", id: 2, slot: 0, ...s },
            { kind: "constant", id: 10, value: 0, ...s },
            { kind: "string-code-unit", id: 3, string: 2, index: 10, ...s },
            { kind: "constant", id: 4, value: 0, ...s },
            { kind: "binary", id: 5, operator: ">", left: 3, right: 4, ...s },
          ],
          terminator: {
            kind: "branch",
            condition: 5,
            consequent: 1,
            alternate: 3,
            ...s,
          },
        },
        {
          id: 3,
          instructions: [
            { kind: "constant", id: 6, value: 1, ...s },
            { kind: "array-new", id: 7, type: "Uint32Array", length: 6, ...s },
            { kind: "constant", id: 8, value: 42, ...s },
          ],
          terminator: { kind: "return", value: 8, ...s },
        },
      ],
    },
  ],
};
function temporaryClears(closed: boolean, selected: ModuleIR = module): number {
  const r = emitModule(
    selected,
    // The conservative regime (precise maps need no clears at all).
    closed
      ? { closedRoots: [0], aliasSlotLoads: false, preciseStackMaps: false }
      : { aliasSlotLoads: false, preciseStackMaps: false },
  );
  assert.ok(r.ok, JSON.stringify(r));
  const root = frameRoots(r.value)[0]!;
  assert.ok(root.offsets.length >= 2);
  const offset = root.frameOffset + root.offsets.at(-1)!;
  // A clear is a STR XZR of the slot or an STP XZR pair covering it.
  const clears = [
    encode({ op: "str", width: 64, rt: "zr", rn: "sp", offset }),
    ...[offset, offset - 8].map((start) =>
      encode({
        op: "stp",
        width: 64,
        rt: "zr",
        rt2: "zr",
        rn: "sp",
        offset: start,
        mode: "offset",
      }),
    ),
  ].flatMap((encoded) => (encoded.ok ? [encoded.value] : []));
  assert.ok(clears.length >= 1);
  const fn = r.value.functions[0]!,
    view = new DataView(
      r.value.code.buffer,
      r.value.code.byteOffset,
      r.value.code.byteLength,
    );
  let count = 0;
  for (let i = fn.offset; i < fn.offset + fn.byteLength; i += 4)
    if (clears.includes(view.getUint32(i, true))) count++;
  return count;
}
test("closed nonallocating branches defer temporary-root clearing to the GC block", () => {
  assert.equal(
    temporaryClears(true),
    1,
    "clear the full temporary pool only before possible collection, never on the pure loop/backedge",
  );
});
test("open modules retain their conservative root initialization policy", () => {
  assert.ok(temporaryClears(false) >= 4);
});

test("block proofs preserve unknown-call and budget fallbacks", async () => {
  const { nonAllocatingBlocks } =
    await import("../src/aarch64/scalar/temporary-registers.ts");
  const fn = module.functions[0]!;
  assert.deepEqual(
    nonAllocatingBlocks(fn, new Uint8Array([0])),
    new Uint8Array([1, 1, 1, 0]),
  );
  assert.equal(nonAllocatingBlocks(fn, new Uint8Array([0]), 0), undefined);
  const caller = {
    ...fn,
    blocks: fn.blocks.map((b) =>
      b.id === 1
        ? {
            ...b,
            instructions: [
              ...b.instructions,
              {
                kind: "call" as const,
                id: undefined,
                target: 1,
                arguments: [],
                ...s,
              },
            ],
          }
        : b,
    ),
  };
  assert.equal(nonAllocatingBlocks(caller, new Uint8Array([0, 0]))?.[1], 0);
  assert.equal(nonAllocatingBlocks(caller, new Uint8Array([0, 1]))?.[1], 1);
  const sparse = {
    ...fn,
    entry: 10000000,
    blocks: [{ ...fn.blocks[0]!, id: 10000000 }],
  };
  assert.equal(nonAllocatingBlocks(sparse, new Uint8Array([0])), undefined);
});

test("initializer-style CFGs never expand root clearing beyond the conservative policy", () => {
  let id = 0;
  const loads = Array.from({ length: 8 }, () => ({
    kind: "load" as const,
    id: id++,
    slot: 0,
    ...s,
  }));
  const length = id++,
    array = id++;
  const first = [
    ...loads,
    { kind: "constant" as const, id: length, value: 1, ...s },
    {
      kind: "array-new" as const,
      id: array,
      type: "Uint32Array" as const,
      length,
      ...s,
    },
    ...loads.map((load) => ({
      kind: "string-length" as const,
      id: id++,
      string: load.id,
      ...s,
    })),
  ];
  const blocks = [
    {
      id: 0,
      instructions: first,
      terminator: { kind: "jump" as const, target: 1, ...s },
    },
  ];
  for (let block = 1; block < 24; block++) {
    const count = id++,
      value = id++;
    blocks.push({
      id: block,
      instructions: [
        { kind: "constant", id: count, value: 1, ...s },
        {
          kind: "array-new",
          id: value,
          type: "Uint32Array",
          length: count,
          ...s,
        },
      ],
      terminator: { kind: "jump", target: block + 1, ...s },
    });
  }
  const final = id++;
  const selected: ModuleIR = {
    functions: [
      {
        ...module.functions[0]!,
        blocks: [
          ...blocks,
          {
            id: 24,
            instructions: [{ kind: "constant", id: final, value: 42, ...s }],
            terminator: { kind: "return", value: final, ...s },
          },
        ],
      },
    ],
  };
  assert.ok(
    temporaryClears(true, selected) <= temporaryClears(false, selected),
    "cold root pools must not be cleared in full at every allocating block",
  );
});
