import assert from "node:assert/strict";
import test from "node:test";
import type { Block, FunctionIR, ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
import { nativeStackLimitOffset } from "@tint/abi/host";
const s = { start: 0, end: 0 };
/** Branch over `body` on a boolean parameter, then return the number slot. */
function guarded(id: number, body: Block["instructions"]): FunctionIR {
  return {
    id,
    name: "guarded" + id,
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: body,
        terminator: { kind: "jump", target: 2, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
}
/** Over 1 MiB of straight-line stores: beyond a conditional branch's reach. */
/** Constant stores beyond the 1 MiB ADR/branch reach. Address-reach tests
 * pass more: register-homed temporaries shrink each store. */
/** Constants stored to a slot. Leaf functions share the short-lived values'
 * frame words (about 16 bytes per entry), so leaf fixtures ask for 90000
 * entries to exceed conditional branch reach. IDs start at one million,
 * clear of the IDs fixtures place around them. */
function oversized(count: number = 60000): Block["instructions"] {
  const body: Block["instructions"][number][] = [];
  for (let index = 0; index < count; index++) {
    body.push({
      kind: "constant",
      id: 1000000 + index * 2,
      value: index + 0.5,
      ...s,
    });
    body.push({ kind: "store", slot: 1, value: 1000000 + index * 2, ...s });
  }
  return body;
}
const caller: Block["instructions"] = [
  { kind: "load", id: 2, slot: 0, ...s },
  { kind: "load", id: 3, slot: 1, ...s },
  { kind: "call", id: 4, target: 0, arguments: [2, 3], ...s },
  { kind: "store", slot: 1, value: 4, ...s },
];
function words(code: Uint8Array, offset: number, byteLength: number) {
  const view = new DataView(code.buffer, code.byteOffset);
  return Array.from({ length: byteLength / 4 }, (_, index) =>
    view.getUint32(offset + index * 4, true),
  );
}
/** Index and displacement of the first CBZ/CBNZ in a function. */
function firstCompareBranch(code: readonly number[]) {
  const index = code.findIndex((word) => (word & 0x7e000000) === 0x34000000);
  assert.ok(index >= 0);
  const imm = ((code[index]! >>> 5) & 0x7ffff) << 13;
  return { index, displacement: (imm >> 13) * 4 };
}
test("in-reach conditional branches and local calls use single instructions", () => {
  const module: ModuleIR = {
    functions: [guarded(0, []), guarded(1, caller)],
  };
  const emitted = emitModule(module);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const [target, source] = emitted.value.functions;
  assert.ok(target && source);
  const code = words(emitted.value.code, source.offset, source.byteLength);
  const branch = firstCompareBranch(code);
  // One CBZ to the join, not an inverted skip over an unconditional branch.
  assert.notEqual(branch.displacement, 8);
  // The prologue's stack-overflow helper call is also a BL; find the local call.
  const bl = code.findIndex((word, index) => {
    const expected = encode({
      op: "bl",
      displacement: target.offset - (source.offset + index * 4),
    });
    return expected.ok && word === expected.value;
  });
  assert.ok(bl >= 0, "local call is a single BL");
});
test("only functions beyond conditional reach fall back to long branches", () => {
  const emitted = emitModule({
    functions: [guarded(0, oversized(90000)), guarded(1, caller)],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const [large, small] = emitted.value.functions;
  assert.ok(large && small && large.byteLength > 1 << 20);
  // The guarded prologue (large frame: stack check and overflow exit) precedes it.
  const long = words(emitted.value.code, large.offset, 128);
  const skip = firstCompareBranch(long);
  assert.equal(skip.displacement, 8, "inverted skip over the long branch");
  assert.equal((long[skip.index + 1]! & 0xfc000000) >>> 0, 0x14000000);
  const compact = words(emitted.value.code, small.offset, small.byteLength);
  assert.notEqual(firstCompareBranch(compact).displacement, 8);
});
/** A function returning a string literal: its address comes from the pool. */
function literal(id: number, body: Block["instructions"] = []): FunctionIR {
  return {
    id,
    name: "literal" + id,
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "number"],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          ...body,
          { kind: "string-literal", id: 1, value: "pooled", ...s },
        ],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
}
const adrX9 = (word: number) => (word & 0x9f00001f) >>> 0 === 0x10000009;
test("in-reach local addresses are a single ADR", () => {
  const emitted = emitModule({ functions: [literal(0)] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  const index = code.findIndex(adrX9);
  assert.ok(index >= 0, "string address is an ADR");
  // Not the first word of a long ADR/MOVZ/MOVK/ADD sequence.
  assert.notEqual((code[index + 1]! & 0x7f800000) >>> 0, 0x52800000);
});
test("functions whose local addresses are out of reach fall back alone", () => {
  // The oversized function separates the first one from the literal pool;
  // the last function sits just before the pool.
  const emitted = emitModule(
    { functions: [literal(0), literal(1, oversized(100000)), literal(2)] },
    { compactAddresses: true },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const [near, far, last] = emitted.value.functions;
  assert.ok(near && far && last && far.byteLength > 1 << 20);
  const form = (fn: { offset: number; byteLength: number }) => {
    const code = words(emitted.value.code, fn.offset, fn.byteLength);
    const index = code.findIndex(adrX9);
    assert.ok(index >= 0);
    // Long form: ADR #0 followed by MOVZ x17.
    return (code[index + 1]! & 0x7f800000) >>> 0 === 0x52800000
      ? "long"
      : "adr";
  };
  assert.equal(form(near), "long");
  assert.equal(form(last), "adr");
});
test("adjacent zeroed root words share one STP", () => {
  // The conservative regime zeroes every root word in the prologue.
  const emitted = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "roots",
          exported: true,
          parameters: [],
          slots: ["general", "general"],
          returnType: "void",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "general-none", id: 0, ...s },
                { kind: "store", slot: 0, value: 0, ...s },
                { kind: "store", slot: 1, value: 0, ...s },
              ],
              terminator: { kind: "return", value: undefined, ...s },
            },
          ],
        },
      ],
    },
    { preciseStackMaps: false },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  // STP XZR, XZR, [SP, #imm] (64-bit, signed offset).
  assert.ok(
    code.some((word) => (word & 0xffc07fff) >>> 0 === 0xa9007fff),
    "zeroing pairs adjacent words",
  );
});
test("invariant guards share one trap per function", () => {
  // Each general-value read checks the value's tag and traps on mismatch.
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "sum",
        exported: true,
        parameters: [0, 1],
        slots: ["general", "general"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "general-value", id: 1, value: 0, type: "number", ...s },
              { kind: "load", id: 2, slot: 1, ...s },
              { kind: "general-value", id: 3, value: 2, type: "number", ...s },
              { kind: "binary", id: 4, operator: "+", left: 1, right: 3, ...s },
            ],
            terminator: { kind: "return", value: 4, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  const brk3 = encode({ op: "brk", immediate: 3 });
  assert.ok(brk3.ok);
  const traps = code.flatMap((word, index) =>
    word === brk3.value ? [index] : [],
  );
  assert.equal(traps.length, 1, "one shared trap");
  // Every guard branches forward to it (B.cond or CBZ/CBNZ with imm19).
  const trap = traps[0]!;
  const toTrap = code.filter((word, index) => {
    const conditional = (word & 0xff000010) >>> 0 === 0x54000000,
      compare = (word & 0x7e000000) === 0x34000000;
    if (!conditional && !compare) return false;
    const imm = (((word >>> 5) & 0x7ffff) << 13) >> 13;
    return index + imm === trap;
  });
  assert.ok(toTrap.length >= 2, "both guards target the shared trap");
});
test("guards far apart share trap islands between blocks instead of long branches", () => {
  const guard = (id: number, slot: number): Block["instructions"] => [
    { kind: "load", id, slot, ...s },
    { kind: "general-value", id: id + 1, value: id, type: "number", ...s },
    { kind: "store", slot: 2, value: id + 1, ...s },
  ];
  // Three ~470 KB blocks between two guards: over 1 MiB in total, with block
  // boundaries where an island can sit.
  const body = oversized(90000).map((op) =>
    op.kind === "store" ? { ...op, slot: 2 } : op,
  );
  const third = Math.floor(body.length / 6) * 2;
  const chunks = [
    body.slice(0, third),
    body.slice(third, third * 2),
    body.slice(third * 2),
  ];
  const blocks: Block[] = chunks.map((chunk, index) => ({
    id: index,
    instructions: index === 0 ? [...guard(200000, 0), ...chunk] : chunk,
    terminator: { kind: "jump", target: index + 1, ...s },
  }));
  blocks.push({
    id: 3,
    instructions: [
      ...guard(200002, 1),
      { kind: "load", id: 200004, slot: 2, ...s },
    ],
    terminator: { kind: "return", value: 200004, ...s },
  });
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "far",
        exported: true,
        parameters: [0, 1],
        slots: ["general", "general", "number"],
        returnType: "number",
        entry: 0,
        blocks,
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  assert.ok(fn.byteLength > 1 << 20);
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  const brk3 = encode({ op: "brk", immediate: 3 });
  assert.ok(brk3.ok);
  const traps = code.flatMap((word, index) =>
    word === brk3.value ? [index] : [],
  );
  // One island (skipped by `b +8`) between blocks, one at the end.
  assert.equal(traps.length, 2);
  const island = traps[0]!;
  assert.equal(code[island - 1], 0x14000002, "b +8 over the island");
  // The first guard reaches the island directly: no long-branch fallback.
  // The frame exceeds 4 KiB, so the prologue's stack check (limit load,
  // compare, B.CS over the 4-word overflow exit) precedes the first guard.
  const limitLoad = encode({
    op: "ldr",
    width: 64,
    rt: 16,
    rn: 0,
    offset: nativeStackLimitOffset,
  });
  assert.ok(limitLoad.ok);
  const check = code.indexOf(limitLoad.value),
    start = check < 0 ? 0 : check + 8;
  const first = code.findIndex((word, index) => {
    const conditional = (word & 0xff000010) >>> 0 === 0x54000000,
      compare = (word & 0x7e000000) === 0x34000000;
    return index >= start && (conditional || compare);
  });
  assert.ok(first >= 0);
  const imm = (((code[first]! >>> 5) & 0x7ffff) << 13) >> 13;
  assert.equal(first + imm, island);
});
test("far forward conditional branches go through a veneer island, not long forms", () => {
  const body = oversized(90000);
  const third = Math.floor(body.length / 6) * 2;
  const chunks = [
    body.slice(0, third),
    body.slice(third, third * 2),
    body.slice(third * 2),
  ];
  // Block 0 branches on its boolean parameter to block 4, past ~1.4 MB of
  // straight-line blocks 1-3.
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
      terminator: {
        kind: "branch",
        condition: 0,
        consequent: 4,
        alternate: 1,
        ...s,
      },
    },
    ...chunks.map((chunk, index): Block => ({
      id: index + 1,
      instructions: chunk,
      terminator: { kind: "jump", target: index + 2, ...s },
    })),
    {
      id: 4,
      instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
      terminator: { kind: "return", value: 1, ...s },
    },
  ];
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "far",
        exported: true,
        parameters: [0, 1],
        slots: ["boolean", "number"],
        returnType: "number",
        entry: 0,
        blocks,
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  assert.ok(fn.byteLength > 1 << 20);
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  // The first conditional branch is compact (not an inverted skip of 8) and
  // lands on an unconditional B inside a skipped island.
  const first = firstCompareBranch(code);
  assert.notEqual(first.displacement, 8);
  const veneer = first.index + first.displacement / 4;
  assert.equal((code[veneer]! & 0xfc000000) >>> 0, 0x14000000, "veneer B");
  assert.equal(code[veneer - 1], 0x14000002, "island skip");
  // The veneer reaches block 4: the last load/return sequence of the function.
  const imm = ((code[veneer]! << 6) >> 6) * 4;
  assert.ok(veneer * 4 + imm > (fn.byteLength * 3) / 4);
});
test("functions within conditional reach place no islands", () => {
  const guard = (id: number, slot: number): Block["instructions"] => [
    { kind: "load", id, slot, ...s },
    { kind: "general-value", id: id + 1, value: id, type: "number", ...s },
    { kind: "store", slot: 2, value: id + 1, ...s },
  ];
  // About 720 KB in five blocks, so a block boundary lies past half a
  // conditional range from the first guard while the function stays in reach.
  const body = oversized(45000).map((op) =>
    op.kind === "store" ? { ...op, slot: 2 } : op,
  );
  const step = 18000;
  const blocks: Block[] = [];
  for (let index = 0; index < 5; index++) {
    const chunk = body.slice(index * step, (index + 1) * step);
    blocks.push({
      id: index,
      instructions:
        index === 0
          ? [...guard(200000, 0), ...chunk]
          : index === 4
            ? [
                ...chunk,
                ...guard(200002, 1),
                { kind: "load", id: 200004, slot: 2, ...s },
              ]
            : chunk,
      terminator:
        index === 4
          ? { kind: "return", value: 200004, ...s }
          : { kind: "jump", target: index + 1, ...s },
    });
  }
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "near",
        exported: true,
        parameters: [0, 1],
        slots: ["general", "general", "number"],
        returnType: "number",
        entry: 0,
        blocks,
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  assert.ok(fn.byteLength > 1 << 19 && fn.byteLength < 1 << 20);
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  const brk3 = encode({ op: "brk", immediate: 3 });
  assert.ok(brk3.ok);
  assert.equal(code.filter((word) => word === brk3.value).length, 1);
  assert.ok(!code.includes(0x14000002), "no island skip");
});

test("emissions report their forms and accept them as starting hints", () => {
  const module: ModuleIR = {
    functions: [guarded(0, oversized(90000)), guarded(1, caller)],
  };
  const first = emitModule(module);
  assert.ok(first.ok, JSON.stringify(first));
  const hints = first.value.formHints;
  assert.ok(hints);
  assert.deepEqual(
    [...new Set([...hints.longBranches, ...hints.islands])],
    ["guarded0"],
    "only the oversized function left compact conditional forms",
  );
  // Starting from the settled forms reproduces the same code.
  const seeded = emitModule(module, { formHints: hints });
  assert.ok(seeded.ok, JSON.stringify(seeded));
  assert.deepEqual(seeded.value.code, first.value.code);
  assert.deepEqual(seeded.value.formHints, hints);
  // Names absent from the module are ignored.
  const foreign = emitModule(
    { functions: [guarded(0, []), guarded(1, [])] },
    {
      formHints: {
        calls: true,
        longBranches: ["missing"],
        islands: [],
        longAddresses: [],
      },
    },
  );
  assert.ok(foreign.ok, JSON.stringify(foreign));
  assert.deepEqual(foreign.value.formHints?.longBranches, []);
});
test("page-aligned modules address out-of-reach targets with ADRP+ADD", () => {
  const emitted = emitModule(
    { functions: [literal(0), literal(1, oversized(100000)), literal(2)] },
    { compactAddresses: true, pageAlignedCode: true },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const near = emitted.value.functions[0]!;
  const code = words(emitted.value.code, near.offset, near.byteLength);
  // Decode every ADRP x9 + ADD x9, x9, #imm12 back to a module offset.
  const targets: number[] = [];
  code.forEach((adrp, index) => {
    if ((adrp & 0x9f00001f) >>> 0 !== 0x90000009) return;
    const add = code[index + 1]!;
    assert.equal((add & 0xffc003ff) >>> 0, 0x91000129, "ADD x9, x9, #imm");
    let pages = ((adrp >>> 5) & 0x7ffff) * 4 + ((adrp >>> 29) & 3);
    if (pages >= 1 << 20) pages -= 1 << 21;
    const site = near.offset + index * 4;
    targets.push(
      (Math.floor(site / 4096) + pages) * 4096 + ((add >>> 10) & 0xfff),
    );
  });
  assert.ok(targets.length > 0, "out-of-reach addresses use ADRP");
  assert.equal(code.filter(adrX9).length, 0, "no long ADR sequences remain");
  const pooled = emitted.value.strings[0]!.offset;
  assert.ok(targets.includes(pooled), `${pooled} in ${targets.join(",")}`);
});
