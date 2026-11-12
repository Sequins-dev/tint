import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type Instruction, type ModuleIR } from "@tint/ir/scalar";
import { optimizeModule } from "@tint/ir/optimization";

const span = { start: 0, end: 0 };
function program(
  instructions: Instruction[],
  result: number,
  type: "string" | "number" | "boolean",
): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "run",
        exported: true,
        parameters: [],
        slots: ["string"],
        returnType: type,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions,
            terminator: { kind: "return", value: result, ...span },
          },
        ],
      },
    ],
  };
}

test("concatenations, lengths and equality of literal strings fold", () => {
  const input = program(
    [
      { kind: "string-literal", id: 0, value: "tint-", ...span },
      { kind: "string-literal", id: 1, value: "native", ...span },
      { kind: "string-concat", id: 2, left: 0, right: 1, ...span },
      { kind: "store", slot: 0, value: 2, ...span },
      { kind: "load", id: 3, slot: 0, ...span },
      { kind: "string-literal", id: 4, value: "tint-native", ...span },
      { kind: "binary", id: 5, operator: "===", left: 3, right: 4, ...span },
    ],
    5,
    "boolean",
  );
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = optimizeModule(input);
  assert.ok(verify(result.module).ok);
  const ops = result.module.functions[0]!.blocks[0]!.instructions;
  assert.ok(
    !ops.some((op) => op.kind === "string-concat" || op.kind === "binary"),
  );
  assert.ok(ops.some((op) => op.kind === "constant" && op.value === true));

  const length = optimizeModule(
    program(
      [
        { kind: "string-literal", id: 0, value: "abc", ...span },
        { kind: "string-literal", id: 1, value: "de", ...span },
        { kind: "string-concat", id: 2, left: 0, right: 1, ...span },
        { kind: "string-length", id: 3, string: 2, ...span },
      ],
      3,
      "number",
    ),
  );
  const lengthOps = length.module.functions[0]!.blocks[0]!.instructions;
  assert.ok(lengthOps.some((op) => op.kind === "constant" && op.value === 5));
});

test("long concatenations stay runtime work", () => {
  const long = "x".repeat(800);
  const result = optimizeModule(
    program(
      [
        { kind: "string-literal", id: 0, value: long, ...span },
        { kind: "string-concat", id: 1, left: 0, right: 0, ...span },
      ],
      1,
      "string",
    ),
  );
  assert.ok(
    result.module.functions[0]!.blocks[0]!.instructions.some(
      (op) => op.kind === "string-concat",
    ),
  );
});
