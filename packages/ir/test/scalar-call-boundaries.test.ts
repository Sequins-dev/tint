import assert from "node:assert/strict";
import test from "node:test";
import { verify, type ModuleIR } from "../src/scalar/index.ts";
import { provenDirectOnlyFunctions } from "../src/scalar/call-boundaries.ts";
const s = { start: 0, end: 0 };
const module: ModuleIR = {
  functions: [0, 1, 2].map((id) => ({
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
            ? [
                { kind: "function-new", id: 0, target: 2, ...s },
                { kind: "call", id: 1, target: 1, arguments: [], ...s },
              ]
            : [{ kind: "constant", id: 1, value: 42, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  })),
};
test("closed call boundaries retain entry and address-taken function contracts", () => {
  assert.deepEqual(verify(module), { ok: true });
  assert.deepEqual([...provenDirectOnlyFunctions(module, [0])!], [0, 1, 0]);
  assert.deepEqual([...provenDirectOnlyFunctions(module, [0, 1])!], [0, 0, 0]);
  assert.equal(provenDirectOnlyFunctions(module, [-1]), undefined);
  assert.equal(provenDirectOnlyFunctions(module, [3]), undefined);
  assert.equal(provenDirectOnlyFunctions(module, [0], 0), undefined);
});
