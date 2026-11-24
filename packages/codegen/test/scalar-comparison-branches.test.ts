import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
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

function countMasked(module: ModuleIR, mask: number, expected: number): number {
  const r = emitModule(module);
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
