import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import {
  devirtualizeClosureCalls,
  optimizeModule,
} from "@tint/ir/optimization";

const span = { start: 0, end: 0 };
/** `run(n)` creates a closure over a one-field environment record holding
 * `n`, stores it in a slot and calls it through that slot with 1. The
 * closure returns its argument plus the captured value. */
function closureModule(secondTarget: boolean = false): ModuleIR {
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
          { kind: "function-new", id: 2, target: 1, environment: 1, ...span },
          { kind: "store", slot: 1, value: 2, ...span },
          ...(secondTarget
            ? [
                { kind: "function-new" as const, id: 6, target: 2, ...span },
                { kind: "store" as const, slot: 1, value: 6, ...span },
              ]
            : []),
          { kind: "load", id: 3, slot: 1, ...span },
          { kind: "constant", id: 4, value: 1, ...span },
          {
            kind: "call-indirect",
            id: 5,
            target: 1,
            callee: 3,
            arguments: [4],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 5, ...span },
      },
    ],
  };
  const captured: FunctionIR = {
    id: 1,
    name: "captured",
    exported: false,
    parameters: [0],
    slots: ["number", "number"],
    returnType: "number",
    closureEnvironment: 0,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "closure-environment", id: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 0, ...span },
          { kind: "load", id: 2, slot: 1, ...span },
          { kind: "binary", id: 3, operator: "+", left: 1, right: 2, ...span },
        ],
        terminator: { kind: "return", value: 3, ...span },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  const plain: FunctionIR = {
    id: 2,
    name: "plain",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
    ],
    functions: [run, captured, plain],
  };
}

test("indirect calls of a known closure become direct calls of an environment-passing twin", () => {
  const input = closureModule();
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 1000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  const twin = result.module.functions[3]!;
  assert.equal(twin.name, "captured$direct");
  assert.equal(twin.closureEnvironment, undefined);
  assert.deepEqual(twin.parameters, [0, 2]);
  assert.deepEqual(twin.blocks[0]!.instructions[0], {
    kind: "load",
    id: 0,
    slot: 2,
    ...span,
  });
  const call = result.module.functions[0]!.blocks[0]!.instructions.find(
    (op) => op.kind === "call",
  );
  assert.ok(call?.kind === "call");
  assert.equal(call.target, 3);
  assert.equal(call.arguments.length, 2);
  // The original closure body stays for other (escaping) uses.
  assert.equal(result.module.functions[1], input.functions[1]);
});

test("slots that may hold closures of different functions keep indirect calls", () => {
  const input = closureModule(true);
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 1000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
  assert.equal(result.module, input);
});

test("devirtualized closures inline through the ordinary optimizer", () => {
  const optimized = optimizeModule(closureModule(), 20000000, {
    devirtualizeClosures: true,
  });
  assert.ok(verify(optimized.module).ok);
  const pass = optimized.passes.find((p) => p.pass === "devirtualize-closures");
  assert.equal(pass?.rewritten, 1);
  const run = optimized.module.functions[0]!;
  assert.ok(
    !run.blocks.some((block) =>
      block.instructions.some(
        (op) => op.kind === "call-indirect" || op.kind === "call",
      ),
    ),
    "the closure body is inlined into its caller",
  );
});

test("devirtualization is an explicit closed-program option", () => {
  const optimized = optimizeModule(closureModule());
  assert.ok(!optimized.passes.some((p) => p.pass === "devirtualize-closures"));
});

test("exhausted devirtualization reports no partial result", () => {
  assert.equal(devirtualizeClosureCalls(closureModule(), 2), undefined);
});
