import assert from "node:assert/strict";
import test from "node:test";
import {
  bindHostOperations,
  hostParameters,
  hostReturnType,
  instructionEffects,
  instructionMayThrow,
  effectUnknown,
  stableRecordLayouts,
  provenNoSafepoints,
  verify,
  type HostOperation,
  type ModuleIR,
} from "../src/scalar/index.ts";
const span = { start: 0, end: 0 };
const operation = "collect-garbage" as HostOperation;
function fixture(): ModuleIR {
  const empty = {
    parameters: [],
    slots: [],
    returnType: "void" as const,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "return" as const, value: undefined, ...span },
      },
    ],
  };
  return {
    functions: [
      { id: 0, name: "collectGarbage", exported: false, ...empty },
      {
        id: 1,
        name: "caller",
        exported: true,
        ...empty,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "call",
                target: 0,
                id: undefined,
                arguments: [],
                ...span,
              },
            ],
            terminator: { kind: "return", value: undefined, ...span },
          },
        ],
      },
    ],
  };
}
test("collect-garbage is a void zero-argument throwing safepoint without layout proofs", () => {
  assert.deepEqual(hostParameters(operation), []);
  assert.equal(hostReturnType(operation), "void");
  const bound = bindHostOperations(fixture(), [{ function: 0, operation }]);
  assert.ok(bound.ok, JSON.stringify(bound));
  assert.ok(verify(bound.value).ok);
  const collect = bound.value.functions[0]!.blocks[0]!.instructions[0]!;
  assert.equal(collect.kind, "host-call");
  assert.equal("id" in collect ? collect.id : 0, undefined);
  // It may throw MANAGED_HEAP_EXHAUSTED through exceptional edges.
  assert.equal(instructionMayThrow(collect), true);
  // Unknown effects include allocation, so it (and its callers) are safepoints.
  assert.equal(instructionEffects(collect), effectUnknown);
  const safe = provenNoSafepoints(bound.value);
  assert.ok(safe !== undefined);
  assert.equal(safe[0], 0);
  assert.equal(safe[1], 0);
  // Deliberately absent from the stable-layout allowlist.
  assert.equal(stableRecordLayouts(bound.value), false);
  const numeric = {
    functions: [
      { ...fixture().functions[0]!, returnType: "number" as const },
      fixture().functions[1]!,
    ],
  };
  assert.equal(
    bindHostOperations(numeric, [{ function: 0, operation }]).ok,
    false,
  );
});
