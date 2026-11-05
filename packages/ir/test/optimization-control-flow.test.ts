import assert from "node:assert/strict";
import test from "node:test";
import { simplifyControlFlow } from "../src/optimization/control-flow.ts";
import { verify, type FunctionIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
test("constant branches remove unreachable paths and compact successor labels", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "branch",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "constant", id: 0, value: false, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      { id: 1, instructions: [], terminator: { kind: "trap", ...s } },
      {
        id: 2,
        instructions: [{ kind: "constant", id: 1, value: 42, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
  const result = simplifyControlFlow(fn, 1000)!;
  assert.ok(result);
  assert.equal(result.fn.blocks.length, 2);
  assert.deepEqual(result.fn.blocks[0]!.terminator, {
    kind: "jump",
    target: 1,
    ...s,
  });
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
  assert.equal(simplifyControlFlow(fn, 0), undefined);
});
