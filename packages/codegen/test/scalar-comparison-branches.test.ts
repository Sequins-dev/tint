import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
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
