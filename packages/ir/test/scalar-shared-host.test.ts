import assert from "node:assert/strict";
import test from "node:test";
import {
  hostParameters,
  bindHostOperations,
  instructionEffects,
  effectUnknown,
  verify,
  type HostOperation,
  type ModuleIR,
  type ScalarType,
} from "../src/scalar/index.ts";
import { optimizeModule } from "../src/optimization/index.ts";
const span = { start: 0, end: 0 };
const signatures: readonly [string, readonly ScalarType[]][] = [
  [
    "shared-compare-exchange-unsigned",
    ["number", "number", "number", "number", "number", "number"],
  ],
  ["shared-read-unsigned", ["number", "number", "number", "number", "number"]],
  [
    "shared-write-unsigned",
    ["number", "number", "number", "number", "number", "number"],
  ],
  [
    "shared-read-word64",
    ["number", "number", "number", "number", "Uint32Array"],
  ],
  [
    "shared-write-word64",
    ["number", "number", "number", "number", "number", "number"],
  ],
  [
    "shared-compare-exchange-word64",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "Uint32Array",
    ],
  ],
];
for (const [name, parameters] of signatures)
  test(`${name} has an explicit trusted checked ABI and observable effects`, () => {
    const operation = name as HostOperation;
    assert.deepEqual(hostParameters(operation), parameters);
    const input: ModuleIR = {
      functions: [
        {
          id: 0,
          name,
          exported: true,
          parameters: parameters.map((_, index) => index),
          slots: [...parameters],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "constant", id: 0, value: 0, ...span }],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    };
    const bound = bindHostOperations(input, [{ function: 0, operation }]);
    assert.ok(bound.ok);
    assert.ok(verify(bound.value).ok);
    const fn = bound.value.functions[0]!;
    const block = fn.blocks[0]!;
    const call = block.instructions.find((op) => op.kind === "host-call")!;
    assert.equal(instructionEffects(call), effectUnknown);
    assert.ok(call.kind === "host-call");
    assert.ok(call.id !== undefined);
    // Identical reads with unused results still observe shared memory; do not CSE/remove.
    const repeated: ModuleIR = {
      functions: [
        {
          ...fn,
          blocks: [
            {
              ...block,
              instructions: [
                ...block.instructions,
                { ...call, id: call.id + 1 },
                { kind: "constant", id: call.id + 2, value: 42, ...span },
              ],
              terminator: { kind: "return", value: call.id + 2, ...span },
            },
          ],
        },
      ],
    };
    assert.ok(verify(repeated).ok);
    const optimized = optimizeModule(repeated).module;
    assert.ok(verify(optimized).ok);
    assert.equal(
      optimized.functions[0]!.blocks[0]!.instructions.filter(
        (op) => op.kind === "host-call",
      ).length,
      2,
    );
    const invalid = {
      functions: [
        {
          ...fn,
          slots: fn.slots.map((type, index) =>
            index === parameters.length - 1 ? ("boolean" as const) : type,
          ),
        },
      ],
    };
    assert.equal(
      bindHostOperations(invalid, [{ function: 0, operation }]).ok,
      false,
    );
  });
