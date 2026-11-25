import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { provenNonNullValues } from "../src/aarch64/scalar/block-entries.ts";
import { encode, type Condition } from "../src/aarch64/isa.ts";
const s = { start: 0, end: 0 };
function fixture(
  shared: boolean,
  operator: "<" | ">" | "<=" | ">=" | "===" | "!==" | "==" | "!=" = "<",
): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "compare",
        exported: true,
        parameters: [0, 1],
        slots: ["number", "number", "boolean"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "load", id: 1, slot: 1, ...s },
              { kind: "binary", id: 2, operator, left: 0, right: 1, ...s },
              ...(shared
                ? [{ kind: "store" as const, slot: 2, value: 2, ...s }]
                : []),
            ],
            terminator: {
              kind: "branch",
              condition: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "constant", id: 3, value: true, ...s }],
            terminator: { kind: "return", value: 3, ...s },
          },
          {
            id: 2,
            instructions: [{ kind: "constant", id: 4, value: false, ...s }],
            terminator: { kind: "return", value: 4, ...s },
          },
        ],
      },
    ],
  };
}
function conditionSets(module: ModuleIR, condition: Condition = "mi"): number {
  const r = emitModule(module);
  assert.ok(r.ok, JSON.stringify(r));
  const word = encode({ op: "cset", rd: 9, condition });
  assert.ok(word.ok);
  const view = new DataView(r.value.code.buffer, r.value.code.byteOffset);
  const fn = r.value.functions[0]!;
  let count = 0;
  // cset into any destination: x9 or the result's register home.
  for (let i = fn.offset; i < fn.offset + fn.byteLength; i += 4)
    if (
      (view.getUint32(i, true) & 0xffffffe0) >>> 0 ===
      (word.value & 0xffffffe0) >>> 0
    )
      count++;
  return count;
}
test("a comparison used only by its branch does not materialize a boolean", () => {
  assert.equal(conditionSets(fixture(false)), 0);
});
test("a comparison saved before its branch retains its boolean value", () => {
  assert.equal(conditionSets(fixture(true)), 1);
});
test("all comparison flags work with either successor in fallthrough position", () => {
  for (const [operator, condition] of [
    ["===", "eq"],
    ["!==", "ne"],
    ["==", "eq"],
    ["!=", "ne"],
    ["<", "mi"],
    ["<=", "ls"],
    [">", "gt"],
    [">=", "ge"],
  ] as const) {
    const module = fixture(false, operator),
      fn = module.functions[0]!;
    assert.equal(conditionSets(module, condition), 0, operator);
    const swapped: ModuleIR = {
      ...module,
      functions: [
        {
          ...fn,
          blocks: fn.blocks.map((block) =>
            block.id === 0 && block.terminator.kind === "branch"
              ? {
                  ...block,
                  terminator: {
                    ...block.terminator,
                    consequent: 2,
                    alternate: 1,
                  },
                }
              : block,
          ),
        },
      ],
    };
    assert.equal(conditionSets(swapped, condition), 0, operator + " swapped");
  }
});

function countMasked(
  module: ModuleIR,
  mask: number,
  expected: number,
  options?: Parameters<typeof emitModule>[1],
): number {
  const r = emitModule(module, options);
  assert.ok(r.ok, JSON.stringify(r));
  const view = new DataView(r.value.code.buffer, r.value.code.byteOffset);
  const fn = r.value.functions[0]!;
  let count = 0;
  for (let i = fn.offset; i < fn.offset + fn.byteLength; i += 4)
    if ((view.getUint32(i, true) & mask) >>> 0 === expected >>> 0) count++;
  return count;
}

test("float and integer select diamonds emit fcsel/csel without branching over arms", () => {
  // clampHigh(x): if (x > 64) res = 64; else res = x; return res;
  const floatDiamond: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "clampHigh",
        exported: true,
        parameters: [0],
        slots: ["number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "constant", id: 1, value: 64, ...s },
              { kind: "binary", id: 2, operator: ">", left: 0, right: 1, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "constant", id: 3, value: 64, ...s },
              { kind: "store", slot: 1, value: 3, ...s },
            ],
            terminator: { kind: "jump", target: 3, ...s },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 4, slot: 0, ...s },
              { kind: "store", slot: 1, value: 4, ...s },
            ],
            terminator: { kind: "jump", target: 3, ...s },
          },
          {
            id: 3,
            instructions: [{ kind: "load", id: 5, slot: 1, ...s }],
            terminator: { kind: "return", value: 5, ...s },
          },
        ],
      },
    ],
  };
  // FCSEL Dd, Dn, Dm, cond: fixed bits 0xffe00c00 == 0x1e600c00.
  assert.equal(countMasked(floatDiamond, 0xffe00c00, 0x1e600c00), 1);
  // 1-arm update: if (x < 0) x = 0; return x;
  const oneArmFloat: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "clampZero",
        exported: true,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "constant", id: 1, value: 0, ...s },
              { kind: "binary", id: 2, operator: "<", left: 0, right: 1, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "constant", id: 3, value: 0, ...s },
              { kind: "store", slot: 0, value: 3, ...s },
            ],
            terminator: { kind: "jump", target: 2, ...s },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 4, slot: 0, ...s }],
            terminator: { kind: "return", value: 4, ...s },
          },
        ],
      },
    ],
  };
  assert.equal(countMasked(oneArmFloat, 0xffe00c00, 0x1e600c00), 1);
  // Boolean select diamond emits 64-bit CSEL (0xffe00c00 == 0x9a800000).
  const boolDiamond: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "pickBool",
        exported: true,
        parameters: [0, 1],
        slots: ["number", "boolean", "boolean"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "constant", id: 1, value: 0, ...s },
              { kind: "binary", id: 2, operator: ">", left: 0, right: 1, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 3, slot: 1, ...s },
              { kind: "store", slot: 2, value: 3, ...s },
            ],
            terminator: { kind: "jump", target: 3, ...s },
          },
          {
            id: 2,
            instructions: [
              { kind: "constant", id: 4, value: false, ...s },
              { kind: "store", slot: 2, value: 4, ...s },
            ],
            terminator: { kind: "jump", target: 3, ...s },
          },
          {
            id: 3,
            instructions: [{ kind: "load", id: 5, slot: 2, ...s }],
            terminator: { kind: "return", value: 5, ...s },
          },
        ],
      },
    ],
  };
  assert.equal(countMasked(boolDiamond, 0xffe00c00, 0x9a800000), 1);
});

test("proven non-null reference-value skips cbz traps and omits dead unwraps", () => {
  // Check x === none (and store after the comparison into slot 1), then in the
  // non-null branch emit both a dead reference-value and a live one.
  const narrowed: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "unwrapChecked",
        exported: true,
        parameters: [0],
        slots: ["optional-reference", "optional-reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "reference-none", id: 1, ...s },
              {
                kind: "binary",
                id: 2,
                operator: "===",
                left: 0,
                right: 1,
                ...s,
              },
              { kind: "store", slot: 1, value: 0, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [],
            terminator: { kind: "throw-literal", value: "missing", ...s },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 3, slot: 1, ...s },
              // Dead unwrap: must emit zero instructions.
              { kind: "reference-value", id: 4, value: 3, ...s },
              { kind: "load", id: 5, slot: 1, ...s },
              // Live unwrap: must not emit cbz trap.
              { kind: "reference-value", id: 6, value: 5, ...s },
            ],
            terminator: { kind: "return", value: 6, ...s },
          },
        ],
      },
    ],
  };
  // 64-bit CBZ: 0xff000000 == 0xb4000000.
  assert.equal(countMasked(narrowed, 0xff000000, 0xb4000000), 0);
  // Without a null check, reference-value MUST keep its CBZ trap.
  const unchecked: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "unwrapUnchecked",
        exported: true,
        parameters: [0],
        slots: ["optional-reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "reference-value", id: 1, value: 0, ...s },
            ],
            terminator: { kind: "return", value: 1, ...s },
          },
        ],
      },
    ],
  };
  assert.equal(countMasked(unchecked, 0xff000000, 0xb4000000), 1);
  // A catch block reachable only via block.exception must invalidate non-null
  // facts at a post-try/catch join block: value 2 (load slot 0 in join) is
  // proven non-null without the handler, and NOT proven with the handler.
  const tryJoinFn = (withHandler: boolean) => ({
    id: 0,
    name: "unwrapAfterTry",
    exported: true,
    parameters: [0],
    slots: ["optional-reference" as const, "general" as const],
    returnType: "reference" as const,
    entry: 0,
    blocks: withHandler
      ? [
          {
            id: 0,
            exception: { target: 1, slot: 1 },
            instructions: [
              {
                kind: "call" as const,
                id: undefined,
                target: 1,
                arguments: [],
                ...s,
              },
              { kind: "load" as const, id: 0, slot: 0, ...s },
              { kind: "reference-value" as const, id: 1, value: 0, ...s },
            ],
            terminator: { kind: "jump" as const, target: 2, ...s },
          },
          {
            id: 1,
            instructions: [],
            terminator: { kind: "jump" as const, target: 2, ...s },
          },
          {
            id: 2,
            instructions: [
              { kind: "load" as const, id: 2, slot: 0, ...s },
              { kind: "reference-value" as const, id: 3, value: 2, ...s },
            ],
            terminator: { kind: "return" as const, value: 3, ...s },
          },
        ]
      : [
          {
            id: 0,
            instructions: [
              {
                kind: "call" as const,
                id: undefined,
                target: 1,
                arguments: [],
                ...s,
              },
              { kind: "load" as const, id: 0, slot: 0, ...s },
              { kind: "reference-value" as const, id: 1, value: 0, ...s },
            ],
            terminator: { kind: "jump" as const, target: 1, ...s },
          },
          {
            id: 1,
            instructions: [
              { kind: "load" as const, id: 2, slot: 0, ...s },
              { kind: "reference-value" as const, id: 3, value: 2, ...s },
            ],
            terminator: { kind: "return" as const, value: 3, ...s },
          },
        ],
  });
  const withCatch = provenNonNullValues(tryJoinFn(true), (id) => id, 4, 10000);
  const withoutCatch = provenNonNullValues(
    tryJoinFn(false),
    (id) => id,
    4,
    10000,
  );
  assert.equal(withCatch?.[2], 0);
  assert.equal(withoutCatch?.[2], 1);
});

test("comparison branches fuse past trailing flag-preserving stores", () => {
  const mod: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "trailingStore",
        exported: true,
        parameters: [0, 1],
        slots: [
          "optional-reference",
          "optional-reference",
          "optional-reference",
        ],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "load", id: 1, slot: 1, ...s },
              { kind: "reference-none", id: 2, ...s },
              {
                kind: "binary",
                id: 3,
                operator: "===",
                left: 0,
                right: 2,
                ...s,
              },
              { kind: "store", slot: 2, value: 1, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 3,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "constant", id: 4, value: true, ...s }],
            terminator: { kind: "return", value: 4, ...s },
          },
          {
            id: 2,
            instructions: [{ kind: "constant", id: 5, value: false, ...s }],
            terminator: { kind: "return", value: 5, ...s },
          },
        ],
      },
    ],
  };
  // CSINC (cset): 0xffe00c00 == 0x1a800400 (32-bit) / 0x9a800400 (64-bit).
  assert.equal(countMasked(mod, 0x7fe00c00, 0x1a800400), 0);
});

test("2-level nested float select diamonds emit two fcsel instructions without branches", () => {
  // clamp(x, -64, 64): x < -64 ? -64 : (x > 64 ? 64 : x)
  const clampMod: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "clampNested",
        exported: true,
        parameters: [0],
        slots: ["number", "number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "constant", id: 1, value: -64, ...s },
              { kind: "binary", id: 2, operator: "<", left: 0, right: 1, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "constant", id: 3, value: -64, ...s },
              { kind: "store", slot: 1, value: 3, ...s },
            ],
            terminator: { kind: "jump", target: 6, ...s },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 4, slot: 0, ...s },
              { kind: "constant", id: 5, value: 64, ...s },
              { kind: "binary", id: 6, operator: ">", left: 4, right: 5, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 6,
              consequent: 3,
              alternate: 4,
              ...s,
            },
          },
          {
            id: 3,
            instructions: [
              { kind: "constant", id: 7, value: 64, ...s },
              { kind: "store", slot: 2, value: 7, ...s },
            ],
            terminator: { kind: "jump", target: 5, ...s },
          },
          {
            id: 4,
            instructions: [
              { kind: "load", id: 8, slot: 0, ...s },
              { kind: "store", slot: 2, value: 8, ...s },
            ],
            terminator: { kind: "jump", target: 5, ...s },
          },
          {
            id: 5,
            instructions: [
              { kind: "load", id: 9, slot: 2, ...s },
              { kind: "store", slot: 1, value: 9, ...s },
            ],
            terminator: { kind: "jump", target: 6, ...s },
          },
          {
            id: 6,
            instructions: [{ kind: "load", id: 10, slot: 1, ...s }],
            terminator: { kind: "return", value: 10, ...s },
          },
        ],
      },
    ],
  };
  // Double-precision FCSEL: 0xffe00c00 == 0x1e600c00.
  assert.equal(countMasked(clampMod, 0xffe00c00, 0x1e600c00), 2);
});

test("(int32 + f64) | 0 fuses into fjcvtzs fast path", () => {
  const mod: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "addOrZero",
        exported: true,
        parameters: [0],
        slots: ["number", "number"],
        integerSlots: [1],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 1, ...s },
              { kind: "store", slot: 1, value: 0, ...s },
              { kind: "load", id: 1, slot: 1, ...s },
              { kind: "load", id: 2, slot: 0, ...s },
              { kind: "binary", id: 3, operator: "+", left: 1, right: 2, ...s },
              { kind: "constant", id: 4, value: 0, ...s },
              { kind: "binary", id: 5, operator: "|", left: 3, right: 4, ...s },
              { kind: "store", slot: 1, value: 5, ...s },
              { kind: "load", id: 6, slot: 1, ...s },
            ],
            terminator: { kind: "return", value: 6, ...s },
          },
        ],
      },
    ],
  };
  // FJCVTZS: 0xfffffc00 == 0x1e7e0000 (1 fast path + 1 slow path = 2) when
  // baseline JavaScript conversion is available, and 0 without it.
  assert.equal(
    countMasked(mod, 0xfffffc00, 0x1e7e0000, { hostABI: darwinHostABI() }),
    2,
  );
  assert.equal(countMasked(mod, 0xfffffc00, 0x1e7e0000), 0);
});

test("folded string-present feeding a select diamond tests the source word instead of an unmaterialized boolean", () => {
  const mod: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "coalesce",
        exported: true,
        parameters: [0, 1],
        slots: ["optional-string", "optional-string", "optional-string"],
        returnType: "optional-string",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "string-present", id: 1, value: 0, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 1,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 2, slot: 0, ...s },
              { kind: "store", slot: 2, value: 2, ...s },
            ],
            terminator: { kind: "jump", target: 3, ...s },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 3, slot: 1, ...s },
              { kind: "store", slot: 2, value: 3, ...s },
            ],
            terminator: { kind: "jump", target: 3, ...s },
          },
          {
            id: 3,
            instructions: [{ kind: "load", id: 4, slot: 2, ...s }],
            terminator: { kind: "return", value: 4, ...s },
          },
        ],
      },
    ],
  };
  const emitted = emitModule(mod);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  const view = new DataView(
    emitted.value.code.buffer,
    emitted.value.code.byteOffset,
  );
  let cselCount = 0,
    cmpSourceCount = 0;
  for (let i = fn.offset; i < fn.offset + fn.byteLength; i += 4) {
    const insn = view.getUint32(i, true);
    // 64-bit CSEL: 0xffe00c00 == 0x9a800000.
    if ((insn & 0xffe00c00) >>> 0 === 0x9a800000) cselCount++;
    // 64-bit SUBS xzr, xN, #0: 0xfffffc1f == 0xf100001f.
    if ((insn & 0xfffffc1f) >>> 0 === 0xf100001f) {
      const rn = (insn >>> 5) & 31;
      // Parameter 0 lives in x1 (copied to its home register or stack slot) and
      // must be loaded/tested directly rather than loading an unwritten slot
      // into x11 when x11 was never written.
      if (rn !== 31) cmpSourceCount++;
    }
  }
  assert.equal(cselCount, 1);
  assert.equal(cmpSourceCount, 1);
  // No cset ne should be emitted for the folded string-present.
  assert.equal(conditionSets(mod, "ne"), 0);
});
