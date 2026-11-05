import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  summarizeEffects,
  effectAllocate,
  effectThrow,
  type ModuleIR,
  type FunctionIR,
} from "../src/scalar/index.ts";
import {
  optimizeModule,
  pruneClosedModule,
} from "../src/optimization/index.ts";
const span = { start: 0, end: 0 };
function fixture(): ModuleIR {
  const imported: FunctionIR = {
    id: 0,
    name: "managedHelper",
    import: true,
    exported: false,
    parameters: [0],
    slots: ["reference"],
    returnType: "reference",
    entry: 0,
    blocks: [],
  };
  return {
    functions: [
      imported,
      {
        id: 1,
        name: "run",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "call", id: 1, target: 0, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      { ...imported, id: 2, name: "unusedHelper" },
    ],
  };
}
test("opaque managed imports carry only their ABI and retain conservative caller effects", () => {
  const module = fixture();
  const verified = verify(module);
  assert.ok(verified.ok, JSON.stringify(verified));
  const effects = summarizeEffects(module);
  assert.ok(effects);
  assert.equal(effects[0]! & effectAllocate, effectAllocate);
  assert.equal(effects[0]! & effectThrow, effectThrow);
  assert.equal(effects[1]! & effectAllocate, effectAllocate);
  assert.equal(effects[1]! & effectThrow, effectThrow);
});
test("optimization preserves called imports and pruning drops unused import declarations", () => {
  const original = fixture();
  const optimized = optimizeModule(original);
  assert.equal(optimized.budgetExhausted, false);
  assert.ok(verify(optimized.module).ok);
  assert.equal(optimized.module.functions[0]?.import, true);
  assert.deepEqual(optimized.module.functions[0]?.blocks, []);
  const pruned = pruneClosedModule(optimized.module, [1]);
  assert.ok(pruned);
  assert.equal(pruned.removedFunctions, 1);
  assert.equal(pruned.module.functions.length, 2);
  assert.equal(pruned.module.functions[0]?.import, true);
  assert.ok(verify(pruned.module).ok);
});
test("import declarations reject local execution state and first-class construction", () => {
  const module = fixture(),
    base = module.functions[0]!;
  const invalid: FunctionIR[] = [
    { ...base, exported: true },
    {
      ...base,
      blocks: [
        { id: 0, instructions: [], terminator: { kind: "trap", ...span } },
      ],
    },
    { ...base, environment: { byteLength: 0, cells: [] } },
    { ...base, closureEnvironment: 0 },
    { ...base, receiverSlot: 1, slots: ["reference", "general"] },
  ];
  for (const imported of invalid)
    assert.equal(
      verify({ ...module, functions: [imported, ...module.functions.slice(1)] })
        .ok,
      false,
    );
  const indirect: FunctionIR = {
    ...module.functions[1]!,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          {
            kind: "call-indirect",
            id: 1,
            target: 0,
            callee: 0,
            arguments: [0],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
  assert.equal(verify({ ...module, functions: [base, indirect] }).ok, false);
  const construction: FunctionIR = {
    ...indirect,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "function-new", id: 0, target: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  assert.equal(
    verify({ ...module, functions: [base, construction] }).ok,
    false,
  );
});

test("managed imports keep their public ABI and safepoint boundary", async () => {
  const {
    provenNoSafepoints,
    provenDirectOnlyFunctions,
    provenWordArguments,
    provenRecordFlows,
  } = await import("../src/scalar/index.ts");
  const module = fixture(),
    safe = provenNoSafepoints(module),
    direct = provenDirectOnlyFunctions(module, [1]);
  assert.ok(safe);
  assert.equal(safe[0], 0);
  assert.equal(safe[1], 0);
  assert.ok(direct);
  assert.equal(direct[0], 0);
  const words = provenWordArguments(module, [1]);
  assert.ok(words);
  assert.deepEqual(words[0], new Uint8Array([0]));
  assert.equal(
    provenRecordFlows({ ...module, records: [{ byteLength: 16, fields: [] }] }),
    undefined,
  );
});
