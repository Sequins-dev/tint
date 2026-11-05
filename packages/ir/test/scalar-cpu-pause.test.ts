import assert from "node:assert/strict";
import test from "node:test";
import {
  bindHostOperations,
  hostParameters,
  hostReturnType,
  instructionEffects,
  effectUnknown,
  stableRecordLayouts,
  verify,
  type HostOperation,
  type ModuleIR,
} from "../src/scalar/index.ts";
import { optimizeModule } from "../src/optimization/index.ts";
const span = { start: 0, end: 0 };
const operation = "cpu-pause" as HostOperation;
function fixture(): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "cpuPause",
        exported: true,
        parameters: [],
        slots: [],
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
  };
}
test("cpu pause binds only the explicit zero-argument void capability", () => {
  assert.deepEqual(hostParameters(operation), []);
  assert.equal(hostReturnType(operation), "void");
  const input = fixture(),
    before = structuredClone(input);
  const bound = bindHostOperations(input, [{ function: 0, operation }]);
  assert.ok(bound.ok);
  assert.deepEqual(input, before);
  assert.ok(verify(bound.value).ok);
  const fn = bound.value.functions[0]!;
  assert.deepEqual(fn.blocks[0]!.terminator, {
    kind: "return",
    value: undefined,
    ...span,
  });
  const pause = fn.blocks[0]!.instructions[0]!;
  assert.equal(pause.kind, "host-call");
  assert.equal("id" in pause ? pause.id : undefined, undefined);
  assert.equal(instructionEffects(pause), effectUnknown);
  assert.ok(stableRecordLayouts(bound.value));
  const invalid = {
    functions: [{ ...input.functions[0]!, returnType: "number" as const }],
  };
  assert.equal(
    bindHostOperations(invalid, [{ function: 0, operation }]).ok,
    false,
  );
});
test("unused duplicate pause calls survive optimization without invented result values", () => {
  const bound = bindHostOperations(fixture(), [{ function: 0, operation }]);
  assert.ok(bound.ok);
  const fn = bound.value.functions[0]!,
    block = fn.blocks[0]!;
  const input = {
    functions: [
      {
        ...fn,
        blocks: [
          {
            ...block,
            instructions: [...block.instructions, ...block.instructions],
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok);
  const result = optimizeModule(input).module;
  assert.ok(verify(result).ok);
  assert.equal(
    result.functions[0]!.blocks[0]!.instructions.filter(
      (op) => op.kind === "host-call",
    ).length,
    2,
  );
});

test("host verification rejects invented void results, missing numeric results and bad arguments", () => {
  const input = fixture(),
    fn = input.functions[0]!,
    block = fn.blocks[0]!;
  for (const instructions of [
    [
      {
        kind: "host-call",
        operation: "cpu-pause",
        id: 0,
        arguments: [],
        ...span,
      },
    ],
    [
      {
        kind: "host-call",
        operation: "cpu-pause",
        id: undefined,
        arguments: [0],
        ...span,
      },
    ],
    [
      { kind: "constant", id: 0, value: 1, ...span },
      {
        kind: "host-call",
        operation: "close",
        id: undefined,
        arguments: [0],
        ...span,
      },
    ],
  ] as const) {
    const bad: ModuleIR = {
      functions: [{ ...fn, blocks: [{ ...block, instructions }] }],
    };
    assert.equal(verify(bad).ok, false);
  }
});

test("unused void calls to a pause-bound function remain observable", () => {
  const bound = bindHostOperations(fixture(), [{ function: 0, operation }]);
  assert.ok(bound.ok);
  const input: ModuleIR = {
    functions: [
      ...bound.value.functions,
      {
        id: 1,
        name: "run",
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
                kind: "call",
                id: undefined,
                target: 0,
                arguments: [],
                ...span,
              },
              {
                kind: "call",
                id: undefined,
                target: 0,
                arguments: [],
                ...span,
              },
              { kind: "constant", id: 0, value: 42, ...span },
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok);
  const optimized = optimizeModule(input).module;
  assert.ok(verify(optimized).ok);
  assert.equal(
    optimized.functions[1]!.blocks[0]!.instructions.filter(
      (op) => op.kind === "call",
    ).length,
    2,
  );
});
