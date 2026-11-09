import assert from "node:assert/strict";
import test from "node:test";
import { pruneClosedModule } from "../src/optimization/reachable.ts";
import { verify, type ModuleIR, type FunctionIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
test("record predicates retain and remap their descriptor without an allocation", () => {
  const input: ModuleIR = {
    records: [
      { byteLength: 16, fields: [] },
      { byteLength: 32, fields: [] },
    ],
    functions: [
      {
        id: 0,
        name: "guard",
        exported: true,
        parameters: [0],
        slots: ["general"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "general-record-is", id: 1, value: 0, record: 1, ...s },
            ],
            terminator: { kind: "return", value: 1, ...s },
          },
        ],
      },
    ],
  };
  const result = pruneClosedModule(input, [0]);
  assert.ok(result);
  assert.equal(result.module.records?.length, 1);
  assert.equal(verify(result.module).ok, true);
  assert.deepEqual(result.module.functions[0]?.blocks[0]?.instructions[1], {
    kind: "general-record-is",
    id: 1,
    value: 0,
    record: 0,
    ...s,
  });
});
function leaf(id: number): FunctionIR {
  return {
    id,
    name: "leaf" + id,
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "constant", id: 0, value: 42, ...s }],
        terminator: { kind: "return", value: 0, ...s },
      },
    ],
  };
}
const module: ModuleIR = {
  records: [
    { byteLength: 32, fields: [{ offset: 16, type: "number", mutable: true }] },
    { byteLength: 16, fields: [] },
  ],
  functions: [
    leaf(0),
    {
      ...leaf(1),
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "record-new", id: 0, record: 1, arguments: [], ...s },
            { kind: "function-new", id: 1, target: 3, ...s },
            {
              kind: "call-indirect",
              id: 2,
              target: 2,
              callee: 1,
              arguments: [],
              ...s,
            },
          ],
          terminator: { kind: "return", value: 2, ...s },
        },
      ],
    },
    leaf(2),
    leaf(3),
    leaf(4),
  ],
};
test("closed roots retain closure targets and indirect contracts while dropping unrelated exports", () => {
  assert.equal(verify(module).ok, true);
  const result = pruneClosedModule(module, [1]);
  assert.ok(result);
  assert.deepEqual(
    result.module.functions.map((f) => f.name),
    ["leaf1", "leaf2", "leaf3"],
  );
  assert.deepEqual(Array.from(result.functionIds), [0, 1, 2, 3, 0]);
  assert.deepEqual(Array.from(result.recordIds), [0, 1]);
  assert.equal(verify(result.module).ok, true);
  assert.equal(module.functions.length, 5);
  assert.equal(module.records?.length, 2);
});
test("cycles converge and explicit extra roots remain callable", () => {
  const fn = leaf(4);
  const cyclic = {
    ...module,
    functions: [
      ...module.functions.slice(0, 4),
      {
        ...fn,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "call" as const, id: 0, target: 4, arguments: [], ...s },
            ],
            terminator: { kind: "return" as const, value: 0, ...s },
          },
        ],
      },
    ],
  };
  const result = pruneClosedModule(cyclic, [1, 4]);
  assert.ok(result);
  assert.equal(result.module.functions.length, 4);
  assert.equal(verify(result.module).ok, true);
});
test("unknown roots, exhausted budgets and raw writes do not publish a partial prune", () => {
  for (const roots of [[], [-1], [5], [0.5]])
    assert.equal(pruneClosedModule(module, roots), undefined);
  assert.equal(pruneClosedModule(module, [1], 0), undefined);
  assert.equal(pruneClosedModule(module, [1], NaN), undefined);
  const fn = leaf(0),
    raw = {
      ...module,
      functions: [
        {
          ...fn,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "constant" as const, id: 0, value: 0, ...s },
                {
                  kind: "host-call" as const,
                  id: 1,
                  operation: "memory-write-word" as const,
                  arguments: [0, 0, 0, 0],
                  ...s,
                },
              ],
              terminator: { kind: "return" as const, value: 1, ...s },
            },
          ],
        },
        ...module.functions.slice(1),
      ],
    };
  assert.equal(pruneClosedModule(raw, [1]), undefined);
});

function withHostCall(
  operation: "executable-call-number" | "memory-write-word",
) {
  const fn = leaf(0);
  return {
    ...module,
    functions: [
      {
        ...fn,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant" as const, id: 0, value: 0, ...s },
              {
                kind: "host-call" as const,
                id: 1,
                operation,
                arguments: [0, 0, 0, 0],
                ...s,
              },
            ],
            terminator: { kind: "return" as const, value: 1, ...s },
          },
        ],
      },
      ...module.functions.slice(1),
    ],
  };
}
test("foreign entry points prune only when every entry is an explicit root", () => {
  const foreign = withHostCall("executable-call-number");
  // Executable calls leave the closed world, so a closed prune declines...
  assert.equal(pruneClosedModule(foreign, [1]), undefined);
  // ...but with the foreign entries rooted, unrelated functions still go.
  const result = pruneClosedModule(foreign, [1, 0], 10000000, true);
  assert.ok(result);
  assert.notEqual(result.functionIds[0], 0);
  assert.notEqual(result.functionIds[1], 0);
  assert.equal(result.functionIds[4], 0);
  assert.ok(result.removedFunctions > 0);
  // Raw writes could forge entries or headers: still declined.
  assert.equal(
    pruneClosedModule(
      withHostCall("memory-write-word"),
      [1, 0],
      10000000,
      true,
    ),
    undefined,
  );
});

test("pruning shares blocks whose operands and control flow do not change", () => {
  const module: ModuleIR = { functions: [leaf(0), leaf(1)] };
  const result = pruneClosedModule(module, [0])!;
  assert.equal(result.removedFunctions, 1);
  assert.equal(
    result.module.functions[0]!.blocks[0],
    module.functions[0]!.blocks[0],
  );
  assert.deepEqual(verify(result.module), { ok: true });
});

test("reachability facts are reusable without copying or renumbering IR", async () => {
  const { traceClosedModule } =
    await import("../src/optimization/reachability.ts");
  const facts = traceClosedModule(module, [1]);
  assert.ok(facts);
  assert.deepEqual([...facts.functions], [0, 1, 1, 1, 0]);
  assert.deepEqual([...facts.records], [0, 1]);
  assert.equal(traceClosedModule(module, [1], 0), undefined);
});
