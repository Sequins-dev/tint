import assert from "node:assert/strict";
import test from "node:test";
import { provenNoSafepoints } from "../src/scalar/safepoints.ts";
import type { FunctionIR, Instruction, ModuleIR } from "../src/scalar/model.ts";
const span = { start: 0, end: 0 };
function fn(id: number, instructions: Instruction[]): FunctionIR {
  return {
    id,
    name: `f${id}`,
    exported: true,
    parameters: [],
    slots: [],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: undefined, ...span },
      },
    ],
  };
}
const call = (target: number): Instruction => ({
  kind: "call",
  id: undefined,
  target,
  arguments: [],
  ...span,
});
test("nonallocating recursive components are safe; allocating effects propagate to every caller", () => {
  const module: ModuleIR = {
    functions: [
      fn(0, [call(1)]),
      fn(1, [call(0)]),
      fn(2, [call(3)]),
      fn(3, [
        call(2),
        { kind: "record-new", id: 0, record: 0, arguments: [], ...span },
      ]),
      fn(4, [call(2)]),
    ],
  };
  assert.deepEqual([...provenNoSafepoints(module)!], [1, 1, 0, 0, 0]);
});
test("indirect and host calls cannot inherit a direct-target proof", () => {
  const module: ModuleIR = {
    functions: [
      fn(0, []),
      fn(1, [
        {
          kind: "call-indirect",
          id: undefined,
          target: 0,
          callee: 0,
          arguments: [],
          ...span,
        },
      ]),
      fn(2, [
        {
          kind: "host-call",
          id: 0,
          operation: "close",
          arguments: [0],
          ...span,
        },
      ]),
    ],
  };
  assert.deepEqual([...provenNoSafepoints(module)!], [1, 0, 0]);
});
test("static strings and reference mutations do not collect", () => {
  assert.deepEqual(
    [
      ...provenNoSafepoints({
        functions: [
          fn(0, [
            { kind: "string-literal", id: 0, value: "static", ...span },
            {
              kind: "reference-vector-write",
              vector: 1,
              index: 2,
              value: 3,
              ...span,
            },
          ]),
        ],
      })!,
    ],
    [1],
  );
});
test("budget exhaustion and invalid call targets publish no proof", () => {
  assert.equal(provenNoSafepoints({ functions: [fn(0, [])] }, 0), undefined);
  assert.equal(provenNoSafepoints({ functions: [fn(0, [])] }, NaN), undefined);
  assert.equal(
    provenNoSafepoints({ functions: [fn(0, [call(2)])] }),
    undefined,
  );
});
