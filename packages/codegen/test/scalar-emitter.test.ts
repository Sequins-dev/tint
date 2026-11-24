import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { frameRoots } from "./frame-roots.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModuleIR } from "@tint/ir/scalar";
import { decodeStackMaps, emitModule } from "@tint/codegen/aarch64/scalar";
import { encode, relativeAddress } from "@tint/codegen/aarch64/isa";
const span = { start: 1, end: 3 };
/** ldr x10, [xn]: a descriptor read through x9 or the object's GP home. */
function descriptorLoad(word: number): boolean {
  return (word & 0xfffffc1f) >>> 0 === 0xf940000a;
}
/** A call at `offset` to `target`: a BL in reach, or the long x16 sequence
 * that ends at `offset` when the module needed full-range calls. */
function relativeCallMatches(
  view: DataView,
  offset: number,
  target: number,
): boolean {
  const bl = encode({ op: "bl", displacement: target - offset });
  if (bl.ok && view.getUint32(offset, true) === bl.value) return true;
  if (offset < 16) return false;
  const call = encode({ op: "blr", rn: 16 });
  assert.ok(call.ok);
  if (view.getUint32(offset, true) !== call.value) return false;
  const start = offset - 16;
  const address = relativeAddress(16, 17, target - start);
  assert.ok(address.ok);
  return address.value.every((instruction, index) => {
    const word = encode(instruction);
    return word.ok && view.getUint32(start + index * 4, true) === word.value;
  });
}

test("IR verification failures preserve the offending instruction span", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "invalid",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 1, start: 37, end: 51 },
            ],
            terminator: { kind: "return", value: undefined, ...span },
          },
        ],
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.function, 0);
    assert.equal(result.error.block, 0);
    assert.deepEqual(result.error.span, { start: 37, end: 51 });
  }
});
test("generational barriers cover managed writes and omit numeric-only stores", () => {
  for (const type of ["reference", "number", "general"] as const) {
    const module: ModuleIR = {
      records: [
        { byteLength: 32, fields: [{ offset: 16, type, mutable: true }] },
      ],
      functions: [
        {
          id: 0,
          name: "write",
          exported: true,
          parameters: [0, 1],
          slots: ["reference", type],
          returnType: "void",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
              terminator: {
                kind: "record",
                object: 0,
                record: 0,
                field: 0,
                operation: "write",
                slot: 1,
                consequent: 1,
                alternate: 2,
                ...span,
              },
            },
            {
              id: 1,
              instructions: [],
              terminator: { kind: "return", value: undefined, ...span },
            },
            { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
          ],
        },
      ],
    };
    const ordinary = emitModule(module),
      barrier = emitModule(module, {
        maxByteLength: 0xffffffff,
        debugSpans: false,
        linearAllocation: false,
        generationalBarriers: true,
      });
    assert.ok(ordinary.ok);
    assert.ok(barrier.ok, JSON.stringify(barrier));
    assert.ok(
      !ordinary.value.helpers.some((h) => h.kind === "remember-object"),
    );
    assert.equal(
      barrier.value.helpers.some((h) => h.kind === "remember-object"),
      type !== "number",
    );
    // The nursery filter is inline: LDR x12, [x10, #56] (generational
    // state) precedes the helper call, so young objects skip the call.
    const view = new DataView(barrier.value.code.buffer),
      fn = barrier.value.functions[0]!;
    let filtered = false;
    for (
      let offset = fn.offset;
      offset < fn.offset + fn.byteLength;
      offset += 4
    )
      if (view.getUint32(offset, true) === 0xf9401d4c) filtered = true;
    assert.equal(filtered, type !== "number");
  }
});
test("reference vector copies are one indexed loop with at most one barrier", () => {
  function words(rebase: boolean, generationalBarriers: boolean): number[] {
    const module: ModuleIR = {
      functions: [
        {
          id: 0,
          name: "copy",
          exported: true,
          parameters: [0, 1, 2],
          slots: ["reference", "reference", "number"],
          returnType: "void",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "load", id: 1, slot: 1, ...span },
                { kind: "load", id: 2, slot: 2, ...span },
                {
                  kind: "reference-vector-copy",
                  source: 0,
                  target: 1,
                  count: 2,
                  rebase,
                  ...span,
                },
              ],
              terminator: { kind: "return", value: undefined, ...span },
            },
          ],
        },
      ],
    };
    const result = emitModule(module, {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: false,
      generationalBarriers,
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(
      result.value.helpers.some((h) => h.kind === "remember-object"),
      generationalBarriers,
    );
    const view = new DataView(result.value.code.buffer),
      fn = result.value.functions[0]!,
      out: number[] = [];
    for (let at = fn.offset; at < fn.offset + fn.byteLength; at += 4)
      out.push(view.getUint32(at, true));
    return out;
  }
  function word(instruction: Parameters<typeof encode>[0]): number {
    const encoded = encode(instruction);
    assert.ok(encoded.ok);
    return encoded.value;
  }
  // ldr x11, [x13, x12, lsl #3]; str x11, [x10, x12, lsl #3]; cmp x11, x14.
  const load = word({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 11,
      rn: 13,
      rm: 12,
      scaled: true,
    }),
    store = word({
      op: "str-indexed",
      size: 3,
      fp: false,
      rt: 11,
      rn: 10,
      rm: 12,
      scaled: true,
    }),
    self = word({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 11,
      rm: 14,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  for (const rebase of [false, true]) {
    const code = words(rebase, true);
    assert.equal(code.filter((w) => w === load).length, 1);
    assert.equal(code.filter((w) => w === store).length, 1);
    assert.equal(code.includes(self), rebase);
    // The barrier's nursery filter (ldr x12, [x10, #56]) appears once,
    // after the loop rather than per element.
    assert.equal(code.filter((w) => w === 0xf9401d4c).length, 1);
    assert.ok(code.indexOf(0xf9401d4c) > code.indexOf(store));
  }
  assert.ok(!words(true, false).includes(0xf9401d4c));
});
test("managed cell barriers cover initialization and mutation but omit reads and scalars", () => {
  for (const type of ["reference", "number", "general"] as const)
    for (const operation of ["read", "write", "initialize"] as const) {
      const module: ModuleIR = {
        records: [
          {
            byteLength: 48,
            fields: [{ offset: 24, stateOffset: 16, type, mutable: true }],
          },
        ],
        functions: [
          {
            id: 0,
            name: "cell",
            exported: true,
            parameters: [0, 1],
            slots: ["reference", type],
            returnType: "void",
            entry: 0,
            blocks: [
              {
                id: 0,
                instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
                terminator: {
                  kind: "record-cell",
                  record: 0,
                  field: 0,
                  object: 0,
                  operation,
                  slot: 1,
                  consequent: 1,
                  alternate: 2,
                  ...span,
                },
              },
              {
                id: 1,
                instructions: [],
                terminator: { kind: "return", value: undefined, ...span },
              },
              {
                id: 2,
                instructions: [],
                terminator: { kind: "trap", ...span },
              },
            ],
          },
        ],
      };
      const emitted = emitModule(module, {
        maxByteLength: 0xffffffff,
        debugSpans: false,
        linearAllocation: false,
        generationalBarriers: true,
      });
      assert.ok(emitted.ok, JSON.stringify(emitted));
      assert.equal(
        emitted.value.helpers.some(
          (helper) => helper.kind === "remember-object",
        ),
        type !== "number" && operation !== "read",
      );
    }
});
test("generational emission rejects untracked borrowed reference environments", () => {
  for (const type of [
    "number",
    "general",
    "primitive",
    "Uint32Array",
  ] as const) {
    const module: ModuleIR = {
      functions: [
        {
          id: 0,
          name: "borrowed",
          exported: true,
          parameters: [],
          slots: [],
          returnType: "void",
          entry: 0,
          environment: {
            byteLength: 32,
            cells: [
              {
                type,
                stateOffset: 0,
                valueOffset: 8,
                mutable: true,
                ...(type === "Uint32Array" ? { borrowed: true } : {}),
              },
            ],
          },
          blocks: [
            {
              id: 0,
              instructions: [],
              terminator: { kind: "return", value: undefined, ...span },
            },
          ],
        },
      ],
    };
    assert.ok(emitModule(module).ok);
    const emitted = emitModule(module, {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: false,
      generationalBarriers: true,
    });
    assert.equal(emitted.ok, type === "number");
    if (!emitted.ok)
      assert.match(emitted.error.message, /borrowed reference environment/);
  }
});
test("generational state publication emits a checked native host operation", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "publish",
        exported: true,
        parameters: [0, 1, 2, 3],
        slots: ["Uint32Array", "Uint32Array", "Uint8Array", "Float64Array"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "load", id: 2, slot: 2, ...span },
              { kind: "load", id: 3, slot: 3, ...span },
              {
                kind: "host-call",
                id: 4,
                operation: "generational-state" as never,
                arguments: [0, 1, 2, 3],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
});
test("general values use two words and conditional root descriptors", () => {
  const result = emitModule(
    {
      records: [
        {
          byteLength: 32,
          fields: [{ offset: 16, type: "general", mutable: true }],
        },
      ],
      functions: [
        {
          id: 0,
          name: "general",
          exported: true,
          parameters: [0],
          slots: ["general"],
          returnType: "general",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(result.ok, JSON.stringify(result));
  const root = frameRoots(result.value)[0]!;
  assert.deepEqual(root.offsets, []);
  assert.equal(root.generalOffsets.length, 2);
  assert.equal(root.generalOffsets[1]! - root.generalOffsets[0]!, 16);
  assert.deepEqual(result.value.records[0]!.referenceOffsets, []);
  assert.deepEqual(result.value.records[0]!.generalOffsets, [16]);
});
test("general packing and checked extraction preserve scalar contracts", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "pack",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...span },
              { kind: "general-wrap", id: 1, value: 0, ...span },
              {
                kind: "general-value",
                id: 2,
                value: 1,
                type: "number",
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(frameRoots(result.value)[0]!.generalOffsets.length, 1);
});
test("primitive boxes use pointer ABI slots and traced record fields", () => {
  const result = emitModule({
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "primitive", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "primitive",
        exported: true,
        parameters: [0],
        slots: ["primitive"],
        returnType: "primitive",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "primitive-reference", id: 1, value: 0, ...span },
              { kind: "primitive-wrap", id: 2, value: 1, ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.records[0]?.referenceOffsets, [16]);
  // The parameter plus two overlapping temporary pointers.
  assert.equal(frameRoots(result.value)[0]?.offsets.length, 3);
  assert.deepEqual(result.value.functions[0]?.signature.parameters[0], {
    kind: "integer",
    index: 4,
  });
});
function liveLocalFrame(count: number): ModuleIR {
  // Explicit stores keep the wide-addressing case after unused-slot cleanup.
  return {
    functions: [
      {
        id: 0,
        name: "large",
        exported: true,
        parameters: [],
        slots: Array.from({ length: count }, () => "number"),
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 7, ...span },
              ...Array.from({ length: count }, (_, slot) => ({
                kind: "store" as const,
                slot,
                value: 0,
                ...span,
              })),
              { kind: "load", id: 1, slot: count - 1, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
}
function fixture(): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "answer",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 42, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
}
test("emits deterministic framed native functions without mutating verified IR", () => {
  const ir = fixture(),
    before = structuredClone(ir),
    a = emitModule(ir),
    b = emitModule(ir);
  assert.equal(a.ok, true);
  assert.deepEqual(a, b);
  assert.deepEqual(ir, before);
  if (!a.ok) return;
  assert.ok(a.value.code.length > 0);
  assert.equal(a.value.code.length % 4, 0);
  assert.equal(a.value.functions[0]?.offset, 0);
  assert.equal(a.value.functions[0]?.frameBytes % 16, 0);
});
test("rejects invalid IR and output budgets without partial output", () => {
  const ir = fixture();
  assert.equal(emitModule(ir, { maxByteLength: 4 }).ok, false);
  assert.equal(emitModule(ir, { maxByteLength: NaN }).ok, false);
  const f = ir.functions[0];
  assert.ok(f);
  assert.equal(emitModule({ functions: [{ ...f, entry: 99 }] }).ok, false);
});
test("remainder emits a shared helper and large frames use indirect addressing", () => {
  const f = fixture().functions[0];
  assert.ok(f);
  const b = f.blocks[0];
  assert.ok(b);
  const r = emitModule({
    functions: [
      {
        ...f,
        blocks: [
          {
            ...b,
            instructions: [
              ...b.instructions,
              // A fractional dividend takes the helper.
              { kind: "constant", id: 5, value: 5.5, ...span },
              {
                kind: "binary",
                id: 1,
                operator: "%",
                left: 5,
                right: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const helper = r.value.helpers[0];
    assert.equal(helper?.kind, "remainder");
    assert.ok(helper);
    const code = new DataView(r.value.code.buffer);
    let resolvedCall = false;
    for (let offset = 16; offset < helper.offset; offset += 4) {
      if (relativeCallMatches(code, offset, helper.offset)) resolvedCall = true;
    }
    assert.ok(resolvedCall, "shared helper calls must reach the helper");
  }
  // Exact integers divide inline, without the helper.
  const exact = emitModule({
    functions: [
      {
        ...f,
        blocks: [
          {
            ...b,
            instructions: [
              ...b.instructions,
              {
                kind: "binary",
                id: 1,
                operator: "%",
                left: 0,
                right: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(exact.ok);
  assert.deepEqual(exact.value.helpers, []);
  const large = emitModule(liveLocalFrame(4096));
  assert.ok(large.ok, JSON.stringify(large));
  assert.ok(large.value.functions[0]!.frameBytes > 32752);
});
test("typed ABI allocates independent banks and interleaves overflow in source order", () => {
  const types = [
    "boolean",
    "number",
    "boolean",
    "number",
    "boolean",
    "number",
    "boolean",
    "number",
    "boolean",
    "number",
    "boolean",
    "number",
    "number",
    "number",
    "number",
    "number",
  ] as const;
  const r = emitModule({
    functions: [
      {
        id: 0,
        name: "mixed",
        exported: false,
        parameters: types.map((_, i) => i),
        slots: types,
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: { kind: "return", value: undefined, ...span },
          },
        ],
      },
    ],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.functions[0]?.signature, {
    parameters: [
      { kind: "integer", index: 4 },
      { kind: "float", index: 0 },
      { kind: "integer", index: 5 },
      { kind: "float", index: 1 },
      { kind: "integer", index: 6 },
      { kind: "float", index: 2 },
      { kind: "integer", index: 7 },
      { kind: "float", index: 3 },
      { kind: "stack", index: 0 },
      { kind: "float", index: 4 },
      { kind: "stack", index: 8 },
      { kind: "float", index: 5 },
      { kind: "float", index: 6 },
      { kind: "float", index: 7 },
      { kind: "stack", index: 16 },
      { kind: "stack", index: 24 },
    ],
    stackBytes: 32,
  });
});
test("numeric helpers are shared, budgeted and linked after source functions", () => {
  const f = fixture().functions[0];
  assert.ok(f);
  const b = f.blocks[0];
  assert.ok(b);
  const ir: ModuleIR = {
    functions: [
      {
        ...f,
        blocks: [
          {
            ...b,
            instructions: [
              ...b.instructions,
              { kind: "constant", id: 5, value: 5.5, ...span },
              {
                kind: "binary",
                id: 1,
                operator: "%",
                left: 5,
                right: 0,
                ...span,
              },
              {
                kind: "binary",
                id: 2,
                operator: "&",
                left: 1,
                right: 0,
                ...span,
              },
              { kind: "unary", id: 3, operator: "~", operand: 2, ...span },
              {
                kind: "binary",
                id: 4,
                operator: ">>>",
                left: 3,
                right: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  };
  const r = emitModule(ir);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.value.helpers.map((h) => h.kind),
    ["remainder", "to-uint32"],
  );
  assert.deepEqual(emitModule(ir), r);
  const end = r.value.functions[0]?.byteLength;
  assert.ok(end);
  assert.equal(r.value.helpers[0]?.offset, end);
  const view = new DataView(r.value.code.buffer);
  let calls = 0;
  for (let offset = 0; offset < end; offset += 4) {
    if (
      r.value.helpers.some((helper) =>
        relativeCallMatches(view, offset, helper.offset),
      )
    )
      calls++;
  }
  // Remainder plus conversion of its unknown result; constants and bitwise
  // results need no generic conversion helper.
  assert.equal(calls, 2);
  const budget = emitModule(ir, { maxByteLength: end });
  assert.equal(budget.ok, false);
  if (!budget.ok) assert.equal(budget.error.code, "CODE_LIMIT");
  assert.deepEqual(emitModule(fixture()).ok, true);
});

test("environment cell reads inline guarded transfers with explicit failure branches", () => {
  const ir: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "read",
        exported: true,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        environment: {
          byteLength: 24,
          cells: [
            { type: "number", stateOffset: 0, valueOffset: 8, mutable: true },
          ],
        },
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: {
              kind: "cell",
              operation: "read",
              cell: 0,
              slot: 0,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
          {
            id: 2,
            instructions: [{ kind: "constant", id: 1, value: -1, ...span }],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  const r = emitModule(ir);
  assert.ok(r.ok);
  assert.equal(r.value.cellHelpers.length, 0);
  assert.ok(!emitModule(ir, { maxByteLength: r.value.code.length - 4 }).ok);
  const first = ir.functions[0];
  assert.ok(first);
  const shared = emitModule({
    functions: [first, { ...first, id: 1, name: "other" }],
  });
  assert.ok(shared.ok);
  assert.equal(shared.value.cellHelpers.length, 0);
});

test("literal throw pools preserve UTF-16, deduplicate strings and respect output budgets", () => {
  const value = "x\ud800\u0000";
  const ir: ModuleIR = {
    functions: [0, 1].map((id) => ({
      id,
      name: "throw" + id,
      exported: true,
      slots: [],
      parameters: [],
      returnType: "void",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [],
          terminator: { kind: "throw-literal", value, ...span },
        },
      ],
    })),
  };
  const r = emitModule(ir);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.strings.length, 1);
  assert.equal(r.value.code.length % 4, 0);
  const literal = r.value.strings[0];
  assert.ok(literal);
  const view = new DataView(r.value.code.buffer, r.value.code.byteOffset);
  assert.equal(view.getBigUint64(literal.offset + 8, true), 3n);
  assert.deepEqual(
    [...r.value.code.slice(literal.offset + 16, literal.offset + 22)],
    [120, 0, 0, 216, 0, 0],
  );
  assert.ok(!emitModule(ir, { maxByteLength: r.value.code.length - 1 }).ok);
});

test("managed locals and block-local temporaries have separate zeroed root pools", () => {
  const s = { start: 0, end: 0 };
  const r = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "identity",
          exported: true,
          parameters: [0],
          slots: ["reference"],
          returnType: "reference",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
              terminator: { kind: "jump", target: 1, ...s },
            },
            {
              id: 1,
              instructions: [
                { kind: "constant", id: 1, value: 42, ...s },
                { kind: "load", id: 2, slot: 0, ...s },
              ],
              terminator: { kind: "return", value: 2, ...s },
            },
          ],
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(frameRoots(r.value).length, 1);
  const root = frameRoots(r.value)[0]!;
  assert.equal(root.function, 0);
  assert.equal(root.offsets.length, 2);
  assert.equal(new Set(root.offsets).size, 2);
  assert.ok(root.offsets.every((offset) => offset >= 16 && offset % 8 === 0));
});

test("record descriptors list only managed fields and large offsets use address arithmetic", () => {
  const s = { start: 0, end: 0 };
  const r = emitModule({
    records: [
      {
        byteLength: 65568,
        fields: [
          { offset: 16, type: "number", mutable: true },
          { offset: 65536, type: "reference", mutable: false },
        ],
      },
    ],
    functions: [
      {
        id: 0,
        name: "read",
        exported: true,
        parameters: [0],
        slots: ["reference", "reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field: 1,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
            terminator: { kind: "return", value: 1, ...s },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 2, slot: 0, ...s }],
            terminator: { kind: "return", value: 2, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.records[0]?.referenceOffsets, [65536]);
  const descriptor = r.value.records[0]!,
    view = new DataView(
      r.value.code.buffer,
      r.value.code.byteOffset,
      r.value.code.byteLength,
    );
  assert.equal(view.getBigUint64(descriptor.offset, true), 65568n);
  assert.equal(view.getBigUint64(descriptor.offset + 8, true), 1n);
  assert.equal(view.getBigUint64(descriptor.offset + 16, true), 65536n);
});

test("allocation alone creates a rooted result even without reference parameters", () => {
  const s = { start: 0, end: 0 };
  const r = emitModule({
    records: [{ byteLength: 16, fields: [] }],
    functions: [
      {
        id: 0,
        name: "empty",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "record-new", id: 0, record: 0, arguments: [], ...s },
            ],
            terminator: { kind: "return", value: 0, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(frameRoots(r.value)[0]?.offsets.length, 1);
  assert.equal(r.value.records[0]?.byteLength, 16);
  assert.deepEqual(r.value.records[0]?.referenceOffsets, []);
});
test("ordinary string literals use immutable UTF-16 objects and participate in root maps", () => {
  const r = emitModule({
    functions: [
      {
        id: 0,
        name: "text",
        exported: true,
        slots: [],
        parameters: [],
        returnType: "string",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "string-literal",
                id: 0,
                value: "A\u0000\ud800",
                start: 0,
                end: 0,
              },
            ],
            terminator: { kind: "return", value: 0, start: 0, end: 0 },
          },
        ],
      },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  const literal = r.value.strings[0];
  assert.ok(literal);
  const view = new DataView(r.value.code.buffer, r.value.code.byteOffset);
  // One header word (marker 1), the length, then the units.
  assert.equal(view.getBigUint64(literal.offset, true), 1n);
  assert.equal(view.getBigUint64(literal.offset + 8, true), 3n);
  assert.deepEqual(
    [...r.value.code.slice(literal.offset + 16, literal.offset + 22)],
    [65, 0, 0, 0, 0, 216],
  );
  assert.equal(frameRoots(r.value)[0]?.offsets.length, 1);
});
test("string-valued record fields are included in managed trace descriptors", () => {
  const r = emitModule({
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "string", mutable: false }],
      },
    ],
    functions: [],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.records[0]?.referenceOffsets, [16]);
});
test("concatenation roots both inputs and output but not allocation size scratch", () => {
  const s = { start: 0, end: 0 };
  const r = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "join",
          exported: true,
          slots: ["string", "string"],
          parameters: [0, 1],
          returnType: "string",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...s },
                { kind: "load", id: 1, slot: 1, ...s },
                { kind: "string-concat", id: 2, left: 0, right: 1, ...s },
              ],
              terminator: { kind: "return", value: 2, ...s },
            },
          ],
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(frameRoots(r.value)[0]?.offsets.length, 5);
  assert.ok(r.value.helpers.some((h) => h.kind === "string-concat-copy"));
});
test("slicing roots its input and result while bounds and allocation metadata stay untraced", () => {
  const s = { start: 0, end: 0 };
  const r = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "slice",
          exported: true,
          slots: ["string", "number", "optional-number"],
          parameters: [0, 1, 2],
          returnType: "string",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...s },
                { kind: "load", id: 1, slot: 1, ...s },
                { kind: "load", id: 2, slot: 2, ...s },
                {
                  kind: "string-slice",
                  id: 3,
                  string: 0,
                  begin: 1,
                  limit: 2,
                  ...s,
                },
              ],
              terminator: { kind: "return", value: 3, ...s },
            },
          ],
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(frameRoots(r.value)[0]?.offsets.length, 3);
  assert.ok(r.value.helpers.some((h) => h.kind === "string-slice-bounds"));
  assert.ok(r.value.helpers.some((h) => h.kind === "string-slice-copy"));
});
test("typed-array parameters stay rooted without redundant return-only temporaries", () => {
  const s = { start: 0, end: 0 };
  for (const type of ["Uint8Array", "Uint16Array", "Uint32Array"] as const) {
    const r = emitModule({
      functions: [
        {
          id: 0,
          name: "array",
          exported: true,
          slots: [type],
          parameters: [0],
          returnType: type,
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
              terminator: { kind: "return", value: 0, ...s },
            },
          ],
        },
      ],
    });
    assert.ok(r.ok);
    assert.equal(frameRoots(r.value)[0]?.offsets.length, 1);
  }
});
test("scalar SSA temporaries reuse block storage without aliasing managed roots", () => {
  const s = { start: 0, end: 0 };
  const blocks = Array.from({ length: 100 }, (_, id) => ({
    id,
    instructions: Array.from({ length: 8 }, (_, n) => ({
      kind: "constant" as const,
      id: id * 8 + n,
      value: n,
      ...s,
    })),
    terminator:
      id === 99
        ? { kind: "return" as const, value: 799, ...s }
        : { kind: "jump" as const, target: id + 1, ...s },
  }));
  const r = emitModule({
    functions: [
      {
        id: 0,
        name: "large",
        exported: true,
        slots: ["string"],
        parameters: [0],
        returnType: "number",
        entry: 0,
        blocks,
      },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.value.functions[0]!.frameBytes < 256);
  assert.equal(frameRoots(r.value)[0]?.offsets.length, 1);
});
test("owned typed-array allocation publishes a rooted initialized result", () => {
  const s = { start: 0, end: 0 };
  const r = emitModule({
    functions: [
      {
        id: 0,
        name: "make",
        exported: true,
        slots: ["number"],
        parameters: [0],
        returnType: "Uint8Array",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "array-new", id: 1, type: "Uint8Array", length: 0, ...s },
            ],
            terminator: { kind: "return", value: 1, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(frameRoots(r.value)[0]?.offsets.length, 1);
  assert.ok(r.value.helpers.some((h) => h.kind === "array-initialize"));
});
test("typed-array fields are traced as object handles rather than raw data pointers", () => {
  const r = emitModule({
    records: [
      {
        byteLength: 48,
        fields: [
          { offset: 16, type: "Uint8Array", mutable: false },
          { offset: 24, type: "Uint16Array", mutable: true },
          { offset: 32, type: "Uint32Array", mutable: false },
          { offset: 40, type: "Float64Array", mutable: true },
        ],
      },
    ],
    functions: [],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.records[0]?.referenceOffsets, [16, 24, 32, 40]);
});
test("subarray allocation roots the owner and result without tracing bounds", () => {
  const s = { start: 0, end: 0 };
  const r = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "view",
          exported: true,
          slots: ["Uint32Array", "number", "number"],
          parameters: [0, 1, 2],
          returnType: "Uint32Array",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...s },
                { kind: "load", id: 1, slot: 1, ...s },
                { kind: "load", id: 2, slot: 2, ...s },
                {
                  kind: "array-subarray",
                  id: 3,
                  array: 0,
                  begin: 1,
                  length: 2,
                  ...s,
                },
              ],
              terminator: { kind: "return", value: 3, ...s },
            },
          ],
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(frameRoots(r.value)[0]?.offsets.length, 3);
});

test("frames larger than one immediate retain addressable local storage", () => {
  const r = emitModule(liveLocalFrame(600));
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.value.functions[0]!.frameBytes > 4096);
  const expanded = emitModule(liveLocalFrame(4096));
  assert.ok(expanded.ok, JSON.stringify(expanded));
  assert.ok(expanded.value.functions[0]!.frameBytes > 32752);
});
test("optional references contribute pointer roots and record tracing offsets", () => {
  const result = emitModule(
    {
      records: [
        {
          byteLength: 32,
          fields: [
            {
              offset: 16,
              presenceOffset: 24,
              type: "optional-reference",
              mutable: true,
            },
          ],
        },
      ],
      functions: [
        {
          id: 0,
          name: "optional",
          exported: true,
          parameters: [0],
          slots: ["optional-reference"],
          returnType: "optional-reference",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "reference-none", id: 1, ...span },
              ],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.records[0]?.referenceOffsets, [16]);
  assert.equal(frameRoots(result.value)[0]?.offsets.length, 3);
});
test("optional strings contribute pointer roots and record tracing offsets", () => {
  const result = emitModule(
    {
      records: [
        {
          byteLength: 32,
          fields: [
            {
              offset: 16,
              presenceOffset: 24,
              type: "optional-string",
              mutable: true,
            },
          ],
        },
      ],
      functions: [
        {
          id: 0,
          name: "optional",
          exported: true,
          parameters: [0],
          slots: ["optional-string"],
          returnType: "optional-string",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "string-none", id: 1, ...span },
              ],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.records[0]?.referenceOffsets, [16]);
  assert.equal(frameRoots(result.value)[0]?.offsets.length, 3);
});

test("managed function values emit traced descriptors, relocations and indirect ABI calls", async () => {
  const { functionValueFixture } =
    await import("../../../tools/function-value-fixtures.ts");
  for (const type of [
    "number",
    "string",
    "reference",
    "optional-number",
  ] as const) {
    const module = functionValueFixture(type, type === "number" ? 10 : 6);
    const emitted = emitModule(module);
    assert.ok(emitted.ok, JSON.stringify(emitted));
    assert.deepEqual(emitted.value.records.at(-1)?.referenceOffsets, [16]);
    assert.equal(emitted.value.records.at(-1)?.byteLength, 40);
    assert.ok(frameRoots(emitted.value).some((r) => r.function === 2));
    assert.ok(frameRoots(emitted.value).some((r) => r.function === 3));
    assert.deepEqual(emitModule(module), emitted);
  }
});

test("owned closure environments are rooted independently of local captured-cell reads", async () => {
  const { ownedClosureFixture } =
    await import("../../../tools/owned-closure-fixture.ts");
  const emitted = emitModule(ownedClosureFixture());
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const roots = frameRoots(emitted.value).find((r) => r.function === 0);
  assert.ok(roots);
  // The owned environment is the first root word, listed at every collecting
  // call of the closure (this counter makes none).
  const fn = emitted.value.functions[0]!,
    environment = roots.offsets[0]!,
    sites = (decodeStackMaps(emitted.value) ?? []).filter(
      (site) =>
        site.offset > fn.offset &&
        site.offset <= fn.offset + fn.byteLength &&
        site.references.length + site.generals.length > 0,
    );
  for (const site of sites) assert.ok(site.references.includes(environment));
  assert.deepEqual(emitted.value.records[0]?.referenceOffsets, []);
  assert.deepEqual(emitted.value.records[1]?.referenceOffsets, [16]);
  // The function record's environment word.
  assert.deepEqual(emitted.value.records.at(-1)?.referenceOffsets, [16]);
  // Aligned word-sized cell reads and writes are both inline: no generic
  // cell helper remains.
  assert.deepEqual(emitted.value.cellHelpers, []);
});
test("default emission supports modules larger than the original fixture budget", () => {
  const module: ModuleIR = {
    functions: Array.from({ length: 512 }, (_, id) => ({
      id,
      name: "large" + id,
      exported: false,
      parameters: [],
      slots: [],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: Array.from({ length: 128 }, (_, id) => ({
            kind: "constant",
            id,
            value: id + 0.1, // full 64-bit pattern: several instructions
            ...span,
          })),
          terminator: { kind: "return", value: 127, ...span },
        },
      ],
    })),
  };
  const limited = emitModule(module, { maxByteLength: 1048576 });
  assert.ok(!limited.ok);
  assert.equal(limited.error.code, "CODE_LIMIT");
  const result = emitModule(module);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.code.length > 1048576);
});
test("large modules relocate literal and root descriptors beyond ADR range", () => {
  const module: ModuleIR = {
    functions: Array.from({ length: 512 }, (_, id) => ({
      id,
      name: "far" + id,
      exported: false,
      parameters: [],
      slots: [],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "string-literal", id: 128, value: "far", ...span },
            ...Array.from({ length: 128 }, (_, id) => ({
              kind: "constant" as const,
              id,
              value: id + 0.1,
              ...span,
            })),
          ],
          terminator: { kind: "return", value: 127, ...span },
        },
      ],
    })),
  };
  const result = emitModule(module);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.code.length > 1048576);
});

test("general SSA root storage is reused across blocks and separated from scalar temporaries", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "cross-block-general",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "general-none", id: 0, ...span }],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 1,
            instructions: [
              { kind: "constant", id: 1, value: 42, ...span },
              { kind: "general-wrap", id: 2, value: 1, ...span },
            ],
            terminator: { kind: "jump", target: 2, ...span },
          },
          {
            id: 2,
            instructions: [{ kind: "constant", id: 3, value: 99, ...span }],
            terminator: { kind: "return", value: 3, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  const roots = frameRoots(result.value)[0]!;
  assert.equal(roots.generalOffsets.length, 1);
  assert.equal(roots.offsets.length, 0);
});

test("large functions can branch to distant allocation failure exits", () => {
  const result = emitModule({
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "distant-failure",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
              ...Array.from({ length: 70000 }, (_, index) => ({
                kind: "constant" as const,
                id: index + 2,
                value: index + 0.1,
                ...span,
              })),
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.functions[0]!.byteLength > 1048576);
});

test("optional source ranges track emitted instructions without changing code", () => {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "mapped",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "constant",
                id: 0,
                value: 42,
                start: 10,
                end: 12,
              },
            ],
            terminator: { kind: "return", value: 0, start: 14, end: 20 },
          },
        ],
      },
    ],
  };
  const plain = emitModule(input),
    debug = emitModule(input, { maxByteLength: 0xffffffff, debugSpans: true });
  assert.ok(plain.ok);
  assert.ok(debug.ok);
  assert.deepEqual(debug.value.code, plain.value.code);
  assert.equal(plain.value.sourceRanges.length, 0);
  assert.ok(
    debug.value.sourceRanges.some((r) => r.start === 10 && r.end === 12),
  );
  assert.ok(
    debug.value.sourceRanges.some((r) => r.start === 14 && r.end === 20),
  );
  let end = 0;
  for (const range of debug.value.sourceRanges) {
    assert.ok(range.offset >= end);
    assert.ok(range.byteLength > 0);
    assert.equal(range.function, 0);
    end = range.offset + range.byteLength;
    assert.ok(end <= debug.value.code.length);
  }
});

test("temporary root cleanup scales with incoming values rather than every block times frame capacity", () => {
  const blocks: ModuleIR["functions"][number]["blocks"][number][] = [];
  for (let id = 0; id < 200; id++)
    blocks.push({
      id,
      instructions:
        id === 0
          ? Array.from({ length: 64 }, (_, value) => ({
              kind: "load" as const,
              id: value,
              slot: 0,
              ...span,
            }))
          : id === 199
            ? [{ kind: "constant", id: 64, value: 42, ...span }]
            : [],
      terminator:
        id === 199
          ? { kind: "return", value: 64, ...span }
          : { kind: "jump", target: id + 1, ...span },
    });
  const result = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "pooled",
          exported: true,
          parameters: [0],
          slots: ["reference"],
          returnType: "number",
          entry: 0,
          blocks,
        },
      ],
    },
    { aliasSlotLoads: false },
  );
  assert.ok(result.ok, JSON.stringify(result));
  // Unused loads share one temporary slot alongside the parameter.
  assert.equal(frameRoots(result.value)[0]!.offsets.length, 2);
  assert.ok(
    result.value.code.length < 12000,
    `${result.value.code.length} emitted bytes`,
  );
});

test("emission indexes sparse value IDs without quadratic linked-map work", () => {
  const instructions: import("@tint/ir/scalar").Instruction[] = [
    { kind: "constant", id: Number.MAX_SAFE_INTEGER, value: 0, ...span },
  ];
  let previous = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < 200; i++) {
    instructions.push({ kind: "constant", id: i, value: i, ...span });
    instructions.push({
      kind: "binary",
      id: 1000 + i,
      operator: "+",
      left: previous,
      right: i,
      ...span,
    });
    previous = 1000 + i;
  }
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "sparse",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions,
            terminator: { kind: "return", value: previous, ...span },
          },
        ],
      },
    ],
  };
  const get = Map.prototype.get;
  let work = 0;
  Map.prototype.get = function (key) {
    if (typeof key === "number") work += this.size;
    return get.call(this, key);
  };
  try {
    const result = emitModule(module, { maxByteLength: 0xffffffff });
    assert.ok(result.ok, JSON.stringify(result));
  } finally {
    Map.prototype.get = get;
  }
  assert.ok(work < 2000, `emitter linked lookup work: ${work}`);
});

test("validated instructions retain encoded words instead of instruction objects", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "constant",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 42, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
  const push = Array.prototype.push;
  let retained = 0;
  Array.prototype.push = function (...items) {
    for (const item of items)
      if (
        item &&
        typeof item === "object" &&
        "op" in item &&
        typeof item.op === "string"
      )
        retained++;
    return push.apply(this, items);
  };
  try {
    const result = emitModule(module, { maxByteLength: 0xffffffff });
    assert.ok(result.ok, JSON.stringify(result));
  } finally {
    Array.prototype.push = push;
  }
  assert.equal(retained, 0);
});

test("monotonic clock host calls use the target clock import and return milliseconds", () => {
  const result = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "now",
          exported: true,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                {
                  kind: "host-call",
                  id: 0,
                  operation: "monotonic-time",
                  arguments: [],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    { hostABI: darwinHostABI() },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value.imports.map((item) => item.target),
    [{ kind: "import", name: "_clock_gettime_nsec_np" }],
  );
});

test("wall-clock host calls use the target clock import and return milliseconds", () => {
  const result = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "now",
          exported: true,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                {
                  kind: "host-call",
                  id: 0,
                  operation: "wall-clock-time",
                  arguments: [],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    { hostABI: darwinHostABI() },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value.imports.map((item) => item.target),
    [{ kind: "import", name: "_clock_gettime_nsec_np" }],
  );
});

test("typed-array index checks use hardware conversion without modulo helpers", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "read",
        exported: true,
        parameters: [0, 1],
        slots: ["Uint32Array", "number"],
        returnType: "optional-number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "array-read", id: 2, array: 0, index: 1, ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value.helpers.map((helper) => helper.kind),
    [],
  );
});

test("bitwise chains convert only inputs without a proven word representation", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "words",
        exported: true,
        parameters: [0],
        slots: ["number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 4294967295, ...span },
              {
                kind: "binary",
                id: 2,
                operator: "^",
                left: 0,
                right: 1,
                ...span,
              },
              { kind: "store", slot: 1, value: 2, ...span },
              { kind: "load", id: 5, slot: 1, ...span },
              { kind: "constant", id: 3, value: 3, ...span },
              {
                kind: "binary",
                id: 4,
                operator: ">>>",
                left: 5,
                right: 3,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  const helper = result.value.helpers.find(
    (value) => value.kind === "to-uint32",
  );
  assert.ok(helper);
  const view = new DataView(result.value.code.buffer);
  let calls = 0;
  for (
    let offset = 0;
    offset < result.value.functions[0]!.byteLength;
    offset += 4
  ) {
    if (relativeCallMatches(view, offset, helper.offset)) calls++;
  }
  assert.equal(calls, 1);
});
test("unknown bitwise operands try an exact 64-bit round trip before the conversion helper", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "bits",
        exported: true,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 0, ...span },
              {
                kind: "binary",
                id: 2,
                operator: "|",
                left: 0,
                right: 1,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  // The operand may come from its FP home (any source register n): the
  // sequence is fcvtzs x9, dn; scvtf d1, x9; fcmp dn, d1.
  const view = new DataView(result.value.code.buffer),
    end = result.value.functions[0]!.byteLength;
  let found = -1;
  for (let offset = 0; offset + 12 <= end && found < 0; offset += 4) {
    const first = view.getUint32(offset, true),
      source = (first >>> 5) & 31;
    const words = [
      encode({ op: "fcvtzs-x-d", rd: 9, rn: source }),
      encode({ op: "scvtf-d-x", rd: 1, rn: 9 }),
      encode({ op: "fcmp", rn: source, rm: 1 }),
    ].map((word) => {
      assert.ok(word.ok);
      return word.value;
    });
    if (
      words.every(
        (word, index) => view.getUint32(offset + index * 4, true) === word,
      )
    )
      found = offset;
  }
  assert.ok(found >= 0, "inline integral fast path");
  // The helper remains for non-integral, non-finite and saturated inputs.
  const helper = result.value.helpers.find(
    (value) => value.kind === "to-uint32",
  );
  assert.ok(helper);
  let calls = 0;
  for (let offset = 0; offset < end; offset += 4)
    if (relativeCallMatches(view, offset, helper.offset)) {
      calls++;
      assert.ok(offset > found, "fast path precedes the call");
    }
  assert.equal(calls, 1);
});
test("word slot facts cross blocks only when every store is proven", () => {
  for (const nextBlock of [false, true]) {
    const initial = [
      { kind: "constant", id: 0, value: 3, ...span },
      { kind: "store", slot: 1, value: 0, ...span },
    ] as const;
    const unknown = [
      { kind: "load", id: 1, slot: 0, ...span },
      { kind: "store", slot: 1, value: 1, ...span },
    ] as const;
    const use = [
      { kind: "load", id: 2, slot: 1, ...span },
      { kind: "unary", id: 3, operator: "~", operand: 2, ...span },
    ] as const;
    const result = emitModule({
      functions: [
        {
          id: 0,
          name: "invalidate",
          exported: true,
          parameters: [0],
          slots: ["number", "number"],
          returnType: "number",
          entry: 0,
          blocks: nextBlock
            ? [
                {
                  id: 0,
                  instructions: initial,
                  terminator: { kind: "jump", target: 1, ...span },
                },
                {
                  id: 1,
                  instructions: use,
                  terminator: { kind: "return", value: 3, ...span },
                },
              ]
            : [
                {
                  id: 0,
                  instructions: [...initial, ...unknown, ...use],
                  terminator: { kind: "return", value: 3, ...span },
                },
              ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(
      result.value.helpers.some((helper) => helper.kind === "to-uint32"),
      !nextBlock,
    );
  }
});
test("emission removes a repeated descriptor load only after a successful guard", () => {
  const result = emitModule({
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "guarded",
        exported: true,
        parameters: [0],
        slots: ["reference", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
            terminator: {
              kind: "record",
              object: 1,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 3,
              alternate: 2,
              ...span,
            },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
          {
            id: 3,
            instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  const view = new DataView(result.value.code.buffer);
  let loads = 0;
  // ldr x10, [x9]: descriptor reads, not the field at offset 16.
  for (
    let offset = 0;
    offset < result.value.functions[0]!.byteLength;
    offset += 4
  )
    if (descriptorLoad(view.getUint32(offset, true))) loads++;
  assert.equal(loads, 1);
});
function joinedGuards(reassign: boolean) {
  return emitModule({
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "joined",
        exported: true,
        parameters: [0, 2, 3],
        slots: ["reference", "number", "boolean", "reference"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 1, slot: 2, ...span }],
            terminator: {
              kind: "branch",
              condition: 1,
              consequent: 3,
              alternate: 4,
              ...span,
            },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
          {
            id: 3,
            instructions: [],
            terminator: { kind: "jump", target: 5, ...span },
          },
          {
            id: 4,
            instructions: reassign
              ? [
                  { kind: "load", id: 2, slot: 3, ...span },
                  { kind: "store", slot: 0, value: 2, ...span },
                ]
              : [],
            terminator: { kind: "jump", target: 5, ...span },
          },
          {
            id: 5,
            instructions: [{ kind: "load", id: 3, slot: 0, ...span }],
            terminator: {
              kind: "record",
              object: 3,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 6,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 6,
            instructions: [{ kind: "load", id: 4, slot: 1, ...span }],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  });
}
test("descriptor checks dominated on every incoming path are not repeated after a join", () => {
  for (const [reassign, expected] of [
    [false, 1],
    [true, 2],
  ] as const) {
    const result = joinedGuards(reassign);
    assert.ok(result.ok, JSON.stringify(result));
    const view = new DataView(result.value.code.buffer);
    let loads = 0;
    // ldr x10, [x9]: descriptor reads, not the field at offset 16.
    for (
      let offset = 0;
      offset < result.value.functions[0]!.byteLength;
      offset += 4
    )
      if (descriptorLoad(view.getUint32(offset, true))) loads++;
    assert.equal(loads, expected, "reassigned on one path: " + reassign);
  }
});
test("closed-module descriptor facts survive direct calls", () => {
  const result = emitModule({
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "guarded",
        exported: true,
        parameters: [0],
        slots: ["reference", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 1, slot: 0, ...span },
              { kind: "call", id: 3, target: 0, arguments: [1], ...span },
            ],
            terminator: {
              kind: "record",
              object: 1,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 3,
              alternate: 2,
              ...span,
            },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
          {
            id: 3,
            instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  const view = new DataView(result.value.code.buffer);
  let loads = 0;
  // ldr x10, [x9]: descriptor reads, not the field at offset 16.
  for (
    let offset = 0;
    offset < result.value.functions[0]!.byteLength;
    offset += 4
  )
    if (descriptorLoad(view.getUint32(offset, true))) loads++;
  assert.equal(loads, 1);
});
test("memory argument constants discharge numeric validation without truncating large values", () => {
  for (const [length, expected] of [
    [8, 1],
    [4294967304, 2],
    [8.5, 2],
    [NaN, 2],
    [Infinity, 2],
  ] as const) {
    const result = emitModule({
      functions: [
        {
          id: 0,
          name: "read",
          exported: true,
          parameters: [0],
          slots: ["number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "constant", id: 1, value: length, ...span },
                { kind: "constant", id: 2, value: 0, ...span },
                {
                  kind: "host-call",
                  id: 3,
                  operation: "memory-read-word",
                  arguments: [0, 1, 2],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 3, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    const view = new DataView(result.value.code.buffer);
    let conversions = 0;
    for (
      let offset = 0;
      offset < result.value.functions[0]!.byteLength;
      offset += 4
    )
      if ((view.getUint32(offset, true) & 0xfffffc00) >>> 0 === 0x9e780000)
        conversions++;
    assert.equal(conversions, expected, String(length));
  }
});
test("raw word atomics emit exclusive pairs and acquire/release accesses", () => {
  // LDAXR/STLXR/LDAR/STLR (64-bit) opcode patterns, ignoring registers.
  const encodings = {
    ldaxr: 0xc85ffc00,
    stlxr: 0xc800fc00,
    ldar: 0xc8dffc00,
    stlr: 0xc89ffc00,
  } as const;
  const masks = {
    ldaxr: 0xfffffc00,
    stlxr: 0xffe0fc00,
    ldar: 0xfffffc00,
    stlr: 0xfffffc00,
  } as const;
  for (const [operation, arity, expected] of [
    ["memory-compare-exchange-word", 5, ["ldaxr", "stlxr"]],
    ["memory-fetch-add-word", 4, ["ldaxr", "stlxr"]],
    ["memory-load-acquire-word", 3, ["ldar"]],
    ["memory-store-release-word", 4, ["stlr"]],
  ] as const) {
    const parameters = Array.from({ length: arity }, (_, i) => i);
    const result = emitModule({
      functions: [
        {
          id: 0,
          name: "atomic",
          exported: true,
          parameters,
          slots: parameters.map(() => "number" as const),
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                ...parameters.map((id) => ({
                  kind: "load" as const,
                  id,
                  slot: id,
                  ...span,
                })),
                {
                  kind: "host-call",
                  id: arity,
                  operation,
                  arguments: parameters,
                  ...span,
                },
              ],
              terminator: { kind: "return", value: arity, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    const view = new DataView(result.value.code.buffer),
      fn = result.value.functions[0]!;
    const found = new Set<string>();
    for (
      let offset = fn.offset;
      offset < fn.offset + fn.byteLength;
      offset += 4
    )
      for (const name of ["ldaxr", "stlxr", "ldar", "stlr"] as const)
        if (
          (view.getUint32(offset, true) & masks[name]) >>> 0 ===
          encodings[name]
        )
          found.add(name);
    assert.deepEqual([...found].sort(), [...expected].sort(), operation);
  }
});
test("typed array writes use proven constant word and index encodings", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "write",
        exported: true,
        parameters: [0],
        slots: ["Uint32Array"],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 0, ...span },
              { kind: "constant", id: 2, value: -1, ...span },
              { kind: "array-write", array: 0, index: 1, value: 2, ...span },
            ],
            terminator: { kind: "return", value: undefined, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.helpers, []);
  const view = new DataView(result.value.code.buffer);
  for (
    let offset = 0;
    offset < result.value.functions[0]!.byteLength;
    offset += 4
  )
    assert.notEqual(
      (view.getUint32(offset, true) & 0xfffffc00) >>> 0,
      0x9e780000,
    );
});
test("linear allocation is an explicit code-generation capability with a checked fallback", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "make",
        exported: true,
        parameters: [0],
        slots: ["number"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  const baseline = emitModule(module),
    fast = emitModule(module, {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: true,
    });
  assert.ok(baseline.ok);
  assert.ok(fast.ok, JSON.stringify(fast));
  assert.equal(fast.value.linearAllocation, true);
  assert.notEqual(baseline.value.linearAllocation, true);
  const view = new DataView(fast.value.code.buffer);
  let stateLoads = 0;
  for (
    let offset = 0;
    offset < fast.value.functions[0]!.byteLength;
    offset += 4
  )
    if (view.getUint32(offset, true) === 0xf9401d4c) stateLoads++;
  assert.equal(stateLoads, 1);
  assert.ok(
    fast.value.functions[0]!.byteLength >
      baseline.value.functions[0]!.byteLength,
  );
});

test("integer predicates use proven word results while unknown numbers retain validation", () => {
  for (const input of ["word", "unknown", 42, 1.5, Infinity, NaN] as const) {
    const initial: import("@tint/ir/scalar").Instruction[] =
      typeof input === "number"
        ? [{ kind: "constant", id: 0, value: input, ...span }]
        : [{ kind: "load", id: 0, slot: 0, ...span }];
    if (input === "word")
      initial.push({
        kind: "unary",
        id: 1,
        operator: "~",
        operand: 0,
        ...span,
      });
    initial.push({
      kind: "unary",
      id: 2,
      operator: "is-integer",
      operand: input === "word" ? 1 : 0,
      ...span,
    });
    const result = emitModule({
      functions: [
        {
          id: 0,
          name: "integer",
          exported: true,
          parameters: [0],
          slots: ["number"],
          returnType: "boolean",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: initial,
              terminator: { kind: "return", value: 2, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    const view = new DataView(result.value.code.buffer);
    let truncations = 0;
    for (
      let offset = 0;
      offset < result.value.functions[0]!.byteLength;
      offset += 4
    )
      if (view.getUint32(offset, true) === 0x1e65c001) truncations++;
    assert.equal(
      truncations,
      input === "word" || input === 42 ? 0 : 1,
      String(input),
    );
  }
});

test("closed program origin proofs remove descriptor and null checks only for known constructors", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "main",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
              { kind: "call", id: 2, target: 1, arguments: [1], ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "read",
        exported: true,
        parameters: [0],
        slots: ["reference", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
            terminator: { kind: "return", value: 1, ...span },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    ],
  };
  for (const roots of [undefined, [0], [0, 1]]) {
    const result = emitModule(module, {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: false,
      generationalBarriers: false,
      closedRoots: roots,
    });
    assert.ok(result.ok, JSON.stringify(result));
    const fn = result.value.functions[1]!,
      view = new DataView(result.value.code.buffer);
    let descriptors = 0,
      nullChecks = 0;
    for (
      let offset = fn.offset;
      offset < fn.offset + fn.byteLength;
      offset += 4
    ) {
      const word = view.getUint32(offset, true);
      if (descriptorLoad(word)) descriptors++;
      // cbz xn (in reach) or the long form's inverted cbnz xn: the object
      // in x9 or its GP home.
      if ((word & 0xfe000000) >>> 0 === 0xb4000000) nullChecks++;
    }
    assert.equal(descriptors, roots?.length === 1 ? 0 : 1);
    assert.equal(nullChecks, roots?.length === 1 ? 0 : 1);
  }
});

test("an explicitly unwrapped reference does not repeat its null guard at field access", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "read",
        exported: true,
        parameters: [0],
        slots: ["optional-reference", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "reference-value", id: 1, value: 0, ...span },
            ],
            terminator: {
              kind: "record",
              object: 1,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
            terminator: { kind: "return", value: 2, ...span },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    ],
  };
  const result = emitModule(module);
  assert.ok(result.ok, JSON.stringify(result));
  const view = new DataView(result.value.code.buffer);
  let nullChecks = 0,
    descriptors = 0;
  for (
    let offset = 0;
    offset < result.value.functions[0]!.byteLength;
    offset += 4
  ) {
    const word = view.getUint32(offset, true);
    // CBZ X9 to the shared trap, or the inline CBNZ X9 skip over BRK.
    if ((word & 0xfe00001f) >>> 0 === 0xb4000009) nullChecks++;
    if (descriptorLoad(word)) descriptors++;
  }
  assert.equal(nullChecks, 1);
  assert.equal(descriptors, 1);
});

test("integer array facts preserve absence and bypass general numeric conversions", () => {
  for (const array of [
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ] as const) {
    const result = emitModule({
      functions: [
        {
          id: 0,
          name: "readWord",
          exported: true,
          parameters: [0],
          slots: [array],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "constant", id: 1, value: 0, ...span },
                { kind: "array-read", id: 2, array: 0, index: 1, ...span },
                {
                  kind: "unary",
                  id: 3,
                  operator: "is-integer",
                  operand: 2,
                  ...span,
                },
                { kind: "optional-value", id: 4, value: 2, ...span },
                {
                  kind: "unary",
                  id: 5,
                  operator: "is-integer",
                  operand: 4,
                  ...span,
                },
                {
                  kind: "binary",
                  id: 6,
                  operator: "|",
                  left: 4,
                  right: 1,
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 6, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(
      result.value.helpers.some((h) => h.kind === "to-uint32"),
      array === "Float64Array",
      array,
    );
    const view = new DataView(result.value.code.buffer);
    let truncations = 0;
    for (let i = 0; i < result.value.functions[0]!.byteLength; i += 4)
      if (view.getUint32(i, true) === 0x1e65c001) truncations++;
    assert.equal(truncations, array === "Float64Array" ? 2 : 0, array);
  }
});

test("direct calls reuse proven integer return facts without trusting number annotations", () => {
  for (const proven of [true, false]) {
    const result = emitModule({
      functions: [
        {
          id: 0,
          name: "caller",
          exported: true,
          parameters: [0],
          slots: ["number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "call", id: 1, target: 1, arguments: [0], ...span },
                { kind: "constant", id: 2, value: 0, ...span },
                {
                  kind: "binary",
                  id: 3,
                  operator: "|",
                  left: 1,
                  right: 2,
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 3, ...span },
            },
          ],
        },
        {
          id: 1,
          name: "callee",
          exported: false,
          parameters: [0],
          slots: ["number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                ...(proven
                  ? [
                      { kind: "constant" as const, id: 1, value: 0, ...span },
                      {
                        kind: "binary" as const,
                        id: 2,
                        operator: "|",
                        left: 0,
                        right: 1,
                        ...span,
                      },
                    ]
                  : []),
              ],
              terminator: { kind: "return", value: proven ? 2 : 0, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    const helper = result.value.helpers.find((h) => h.kind === "to-uint32");
    assert.ok(helper);
    const view = new DataView(result.value.code.buffer);
    let calls = 0;
    const fn = result.value.functions[0]!;
    for (
      let offset = fn.offset;
      offset < fn.offset + fn.byteLength;
      offset += 4
    ) {
      if (relativeCallMatches(view, offset, helper.offset)) calls++;
    }
    assert.equal(calls, proven ? 0 : 1);
  }
});

test("closed non-safepointing managed readers omit roots while allocating callers retain them", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "reader",
        exported: false,
        parameters: [0],
        slots: ["Uint8Array"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "array-length", id: 1, array: 0, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "allocate",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 8, ...span },
              {
                kind: "array-new",
                id: 1,
                type: "Uint8Array",
                length: 0,
                ...span,
              },
              { kind: "call", id: 2, target: 0, arguments: [1], ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  const ordinary = emitModule(module),
    closed = emitModule(module, {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: false,
      generationalBarriers: false,
      closedRoots: [1],
    });
  assert.ok(ordinary.ok);
  assert.ok(closed.ok);
  assert.ok(frameRoots(ordinary.value).some((r) => r.function === 0));
  assert.ok(!frameRoots(closed.value).some((r) => r.function === 0));
  assert.ok(frameRoots(closed.value).some((r) => r.function === 1));
  assert.ok(
    closed.value.functions[0]!.byteLength <
      ordinary.value.functions[0]!.byteLength,
  );
});

test("bitwise-only intermediate values avoid double conversion round trips", async () => {
  const { encode } = await import("@tint/codegen/aarch64/isa");
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "bits",
        exported: true,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "unary", id: 1, operator: "~", operand: 0, ...span },
              {
                kind: "binary",
                id: 2,
                operator: "^",
                left: 1,
                right: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  const result = emitModule(module);
  assert.ok(result.ok);
  const conversion = encode({ op: "fcvtzs-x-d", rd: 9, rn: 0 });
  assert.ok(conversion.ok);
  const view = new DataView(result.value.code.buffer);
  let conversions = 0;
  // fcvtzs x9, dn from any source register (an FP home or the d0 scratch).
  for (let offset = 0; offset < result.value.code.length; offset += 4)
    if ((view.getUint32(offset, true) & 0xfffffc1f) >>> 0 === conversion.value)
      conversions++;
  // Each use of the unknown parameter tries the inline integral conversion;
  // the intermediate bit pattern is consumed directly, never re-converted.
  assert.equal(
    conversions,
    2,
    "the intermediate bit pattern should be consumed directly",
  );
});

test("closed call arguments eliminate integer validation only when every caller proves it", () => {
  for (const input of [42, 0.5, NaN])
    for (const closed of [true, false]) {
      const module: ModuleIR = {
        functions: [
          {
            id: 0,
            name: "entry",
            exported: true,
            parameters: [],
            slots: [],
            returnType: "boolean",
            entry: 0,
            blocks: [
              {
                id: 0,
                instructions: [
                  { kind: "constant", id: 0, value: input, ...span },
                  { kind: "call", id: 1, target: 1, arguments: [0], ...span },
                ],
                terminator: { kind: "return", value: 1, ...span },
              },
            ],
          },
          {
            id: 1,
            name: "integer",
            exported: true,
            parameters: [0],
            slots: ["number"],
            returnType: "boolean",
            entry: 0,
            blocks: [
              {
                id: 0,
                instructions: [
                  { kind: "load", id: 0, slot: 0, ...span },
                  {
                    kind: "unary",
                    id: 1,
                    operator: "is-integer",
                    operand: 0,
                    ...span,
                  },
                ],
                terminator: { kind: "return", value: 1, ...span },
              },
            ],
          },
        ],
      };
      const result = emitModule(module, {
        maxByteLength: 0xffffffff,
        debugSpans: false,
        linearAllocation: false,
        generationalBarriers: false,
        closedRoots: closed ? [0] : undefined,
      });
      assert.ok(result.ok, JSON.stringify(result));
      const view = new DataView(result.value.code.buffer),
        fn = result.value.functions[1]!;
      let truncations = 0;
      for (
        let offset = fn.offset;
        offset < fn.offset + fn.byteLength;
        offset += 4
      )
        if (view.getUint32(offset, true) === 0x1e65c001) truncations++;
      assert.equal(
        truncations,
        closed && (input === 42 || Number.isNaN(input)) ? 0 : 1,
      );
    }
});

test("bounded integer addition chains bypass generic modulo helpers", () => {
  for (const bounded of [true, false]) {
    const instructions: import("@tint/ir/scalar").Instruction[] = [
      { kind: "load", id: 0, slot: 0, ...span },
      { kind: "constant", id: 1, value: 4294967295, ...span },
      { kind: "binary", id: 2, operator: "|", left: 0, right: 1, ...span },
      {
        kind: "binary",
        id: 3,
        operator: "+",
        left: bounded ? 2 : 0,
        right: 1,
        ...span,
      },
      { kind: "binary", id: 4, operator: "+", left: 3, right: 1, ...span },
      { kind: "binary", id: 5, operator: ">>>", left: 4, right: 1, ...span },
    ];
    const result = emitModule({
      functions: [
        {
          id: 0,
          name: "sum",
          exported: true,
          parameters: [0],
          slots: ["number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions,
              terminator: { kind: "return", value: 5, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    const helper = result.value.helpers.find((h) => h.kind === "to-uint32");
    assert.ok(helper);
    const view = new DataView(result.value.code.buffer),
      fn = result.value.functions[0]!;
    let calls = 0;
    for (
      let offset = fn.offset;
      offset < fn.offset + fn.byteLength;
      offset += 4
    ) {
      if (relativeCallMatches(view, offset, helper.offset)) calls++;
    }
    assert.equal(calls, bounded ? 1 : 2);
  }
});

test("managed root frames retain allocated results without redundant extraction roots", () => {
  const result = emitModule({
    records: [{ byteLength: 16, fields: [] }],
    functions: [
      {
        id: 0,
        name: "roots",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "record-new", id: 0, record: 0, arguments: [], ...span },
              { kind: "reference-wrap", id: 1, value: 0, ...span },
              { kind: "reference-value", id: 2, value: 1, ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(frameRoots(result.value)[0]?.offsets.length, 1);
});

test("verified direct calls do not initialize unread result-buffer bytes", async () => {
  const { encode } = await import("@tint/codegen/aarch64/isa");
  const module: ModuleIR = {
    functions: [0, 1].map((id) => ({
      id,
      name: `f${id}`,
      exported: id === 0,
      parameters: [0],
      slots: ["number"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions:
            id === 0
              ? [
                  { kind: "load", id: 0, slot: 0, ...span },
                  { kind: "call", id: 1, target: 1, arguments: [0], ...span },
                ]
              : [{ kind: "load", id: 0, slot: 0, ...span }],
          terminator: { kind: "return", value: id === 0 ? 1 : 0, ...span },
        },
      ],
    })),
  };
  const emitted = emitModule(module);
  assert.ok(emitted.ok);
  const view = new DataView(emitted.value.code.buffer),
    end = emitted.value.functions[1]!.offset;
  for (const offset of [0, 8, 16, 24]) {
    const zero = encode({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
    assert.ok(zero.ok);
    for (let at = 0; at < end; at += 4)
      assert.notEqual(
        view.getUint32(at, true),
        zero.value,
        `redundant clear at result byte ${offset}`,
      );
  }
});

test("private direct callees return payloads in registers while entry ABI stays buffered", async () => {
  const { encode } = await import("@tint/codegen/aarch64/isa");
  const module: ModuleIR = {
    functions: [0, 1].map((id) => ({
      id,
      name: `f${id}`,
      exported: true,
      parameters: [],
      slots: [],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions:
            id === 0
              ? [{ kind: "call", id: 0, target: 1, arguments: [], ...span }]
              : [{ kind: "constant", id: 0, value: 42, ...span }],
          terminator: { kind: "return", value: 0, ...span },
        },
      ],
    })),
  };
  const payloadStore = encode({
    op: "str",
    width: 64,
    rt: 9,
    rn: 10,
    offset: 16,
  });
  assert.ok(payloadStore.ok);
  for (const closed of [false, true]) {
    const output = emitModule(module, {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: false,
      generationalBarriers: false,
      closedRoots: closed ? [0] : undefined,
    });
    assert.ok(output.ok);
    const view = new DataView(output.value.code.buffer),
      first = output.value.functions[0]!,
      second = output.value.functions[1]!;
    const contains = (start: number, end: number) => {
      for (let at = start; at < end; at += 4)
        if (view.getUint32(at, true) === payloadStore.value) return true;
      return false;
    };
    assert.equal(contains(first.offset, second.offset), true);
    assert.equal(
      contains(second.offset, second.offset + second.byteLength),
      !closed,
    );
  }
});
test("proven record fields lower directly to native loads", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "read",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
              {
                kind: "record-read",
                id: 2,
                object: 1,
                record: 0,
                field: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  const result = emitModule(module);
  assert.ok(result.ok, JSON.stringify(result));
});

test("optional string equality skips the complete helper call for absent values", () => {
  const result = emitModule({
    functions: [
      {
        id: 0,
        name: "optional-equality",
        exported: true,
        parameters: [0, 1],
        slots: ["optional-string", "optional-string"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              {
                kind: "binary",
                id: 2,
                operator: "===",
                left: 0,
                right: 1,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  const view = new DataView(result.value.code.buffer);
  const helper = result.value.helpers.find((h) => h.kind === "string-equal");
  assert.ok(helper);
  // Absent operands branch (cbz x9 / cbz x10) past both the inline
  // identity/length checks and the content helper call.
  let checked = false;
  for (let offset = 24; offset < helper.offset; offset += 4) {
    if (!relativeCallMatches(view, offset, helper.offset)) continue;
    const absentBranches = new Set<number>();
    for (let at = offset - 4; at >= Math.max(0, offset - 64); at -= 4) {
      const word = view.getUint32(at, true);
      if ((word & 0xff000000) >>> 0 !== 0xb4000000) continue;
      const register = word & 31,
        displacement = (((word >>> 5) & 0x7ffff) << 13) >> 11;
      if ((register === 9 || register === 10) && at + displacement > offset)
        absentBranches.add(register);
    }
    assert.deepEqual(
      [...absentBranches].sort((a, b) => a - b),
      [9, 10],
    );
    checked = true;
  }
  assert.ok(checked);
});

test("direct function calls resolve in either layout direction", () => {
  for (const caller of [0, 1]) {
    const target = 1 - caller;
    const module: ModuleIR = {
      functions: [0, 1].map((id) => ({
        id,
        name: "function" + id,
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions:
              id === caller
                ? [{ kind: "call", id: 0, target, arguments: [], ...span }]
                : [{ kind: "constant", id: 0, value: 42, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      })),
    };
    const result = emitModule(module);
    assert.ok(result.ok, JSON.stringify(result));
    const source = result.value.functions[caller]!,
      destination = result.value.functions[target]!;
    const view = new DataView(result.value.code.buffer);
    let found = false;
    for (
      let offset = source.offset;
      offset < source.offset + source.byteLength;
      offset += 4
    )
      if (relativeCallMatches(view, offset, destination.offset)) found = true;
    assert.ok(found, "direct calls must reach their target");
  }
});

test("entropy host calls use the target unsigned-word import", () => {
  const result = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "now",
          exported: true,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                {
                  kind: "host-call",
                  id: 0,
                  operation: "random-word",
                  arguments: [],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    { hostABI: darwinHostABI() },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value.imports.map((item) => item.target),
    [{ kind: "import", name: "_arc4random" }],
  );
});

test("executable publication guards retain the full exact pointer range", () => {
  const result = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "publish",
          exported: true,
          parameters: [0, 1, 2, 3],
          slots: ["number", "number", "number", "Uint8Array"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "load", id: 1, slot: 1, ...span },
                { kind: "load", id: 2, slot: 2, ...span },
                { kind: "load", id: 3, slot: 3, ...span },
                {
                  kind: "host-call",
                  id: 4,
                  operation: "executable-write",
                  arguments: [0, 1, 2, 3],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 4, ...span },
            },
          ],
        },
      ],
    },
    { hostABI: darwinHostABI() },
  );
  assert.ok(result.ok, JSON.stringify(result));
  const words = new Uint32Array(
    result.value.code.buffer,
    result.value.code.byteOffset,
    result.value.code.byteLength / 4,
  );
  for (const [shift, immediate] of [
    [32, 0xffff],
    [48, 0x1f],
  ] as const) {
    const expected = encode({ op: "movk", width: 64, rd: 9, immediate, shift });
    assert.ok(expected.ok);
    assert.equal(
      Array.from(words).filter((word) => word === expected.value).length,
      2,
      "both address and end-address guards must accept pointers above 4 GiB",
    );
  }
  assert.deepEqual(
    result.value.imports.map((item) => item.target),
    [
      { kind: "import", name: "_pthread_jit_write_protect_np" },
      { kind: "import", name: "_memmove" },
      { kind: "import", name: "_sys_icache_invalidate" },
      { kind: "import", name: "_pthread_jit_write_protect_np" },
    ],
  );
});

test("published numeric calls use the standard Tint completion ABI", () => {
  const result = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "invoke",
          exported: true,
          parameters: [0],
          slots: ["number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                {
                  kind: "host-call",
                  id: 1,
                  operation: "executable-call-number",
                  arguments: [0],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    },
    { hostABI: darwinHostABI() },
  );
  assert.ok(result.ok, JSON.stringify(result));
  const words = new Uint32Array(
    result.value.code.buffer,
    result.value.code.byteOffset,
    result.value.code.byteLength / 4,
  );
  const resultPointer = encode({
    op: "add-imm",
    width: 64,
    rd: 3,
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
  assert.ok(resultPointer.ok);
  assert.ok(
    words.includes(resultPointer.value),
    "x3 must point to the reserved completion record",
  );
});

test("targets without executable-memory policy reject publication capabilities", () => {
  const { executableMemory, ...host } = darwinHostABI();
  assert.ok(executableMemory);
  const result = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "mapCode",
          exported: true,
          parameters: [0],
          slots: ["number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                {
                  kind: "host-call",
                  id: 1,
                  operation: "executable-map",
                  arguments: [0],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    },
    { maxByteLength: 4096, hostABI: host },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "UNSUPPORTED");
    assert.equal(result.error.message, "target has no executable-memory ABI");
  }
});

test("published tagged calls retain general roots across the opaque code boundary", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "publishedValue",
        exported: true,
        parameters: [0, 1],
        slots: ["number", "general"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              {
                kind: "host-call",
                id: 2,
                operation: "executable-call-value",
                arguments: [0, 1],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  const result = emitModule(module, { hostABI: darwinHostABI() });
  assert.ok(result.ok, JSON.stringify(result));
  const roots = frameRoots(result.value).find((root) => root.function === 0);
  assert.ok(
    roots && roots.generalOffsets.length > 0,
    "opaque code cannot elide tagged caller roots",
  );
  const generational = emitModule(module, {
    maxByteLength: 0xffffffff,
    hostABI: darwinHostABI(),
    debugSpans: false,
    linearAllocation: true,
    generationalBarriers: true,
  });
  assert.equal(
    generational.ok,
    false,
    "raw executable calls do not grant the tracked-write proof",
  );
});
