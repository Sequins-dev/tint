import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindForeignCalls,
  foreignCallTypes,
  instructionEffects,
  instructionMayThrow,
  effectAllocate,
  effectReadHeap,
  effectWriteHeap,
  provenNoSafepoints,
  verify,
  type ForeignCall,
  type ModuleIR,
  type ScalarType,
  type ReturnType,
} from "@tint/ir/scalar";
import type { CType } from "@tint/abi/c";

const i32: CType = { kind: "scalar", scalar: "i32" };
const bytes: CType = {
  kind: "pointer",
  pointee: { kind: "scalar", scalar: "u8" },
};
const pair: CType = {
  kind: "record",
  name: "pair",
  union: false,
  packed: false,
  alignment: 0,
  fields: [
    { name: "a", type: i32 },
    { name: "b", type: i32 },
  ],
};
function call(overrides: Partial<ForeignCall> = {}): ForeignCall {
  return {
    symbol: "write",
    signature: {
      parameters: [i32, bytes],
      result: i32,
      fixedParameters: 2,
      callClass: "leaf",
      errno: "negated-result",
    },
    operands: ["number", "bytes"],
    result: "number",
    ...overrides,
  };
}
function stub(parameters: ScalarType[], returnType: ReturnType): ModuleIR {
  const slots = parameters.slice();
  if (returnType !== "void") slots.push(returnType);
  return {
    functions: [
      {
        id: 0,
        name: "bound",
        exported: true,
        parameters: parameters.map((_, index) => index),
        slots,
        returnType,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions:
              returnType === "void"
                ? []
                : [
                    {
                      kind: "load",
                      id: 0,
                      slot: parameters.length,
                      start: 0,
                      end: 0,
                    },
                  ],
            terminator: {
              kind: "return",
              value: returnType === "void" ? undefined : 0,
              start: 0,
              end: 0,
            },
          },
        ],
      },
    ],
  };
}

test("foreign calls type their operands from the C signature and forms", () => {
  assert.deepEqual(foreignCallTypes(call()), {
    ok: true,
    value: { parameters: ["number", "Uint8Array"], result: "number" },
  });
  // A record result is written into a trailing byte operand.
  assert.deepEqual(
    foreignCallTypes(
      call({
        symbol: "div",
        signature: {
          parameters: [i32, i32],
          result: pair,
          fixedParameters: 2,
          callClass: "leaf",
          errno: "none",
        },
        operands: ["number", "number"],
        result: "record",
      }),
    ),
    {
      ok: true,
      value: { parameters: ["number", "number", "Uint8Array"], result: "void" },
    },
  );
  for (const malformed of [
    call({ symbol: "1bad" }),
    call({ operands: ["number"] }),
    call({ operands: ["bytes", "bytes"] }),
    call({ operands: ["number", "record"] }),
    call({ result: "boolean" }),
    call({
      signature: { ...call().signature, callClass: "may-callback" },
    }),
    call({
      signature: {
        ...call().signature,
        result: { kind: "scalar", scalar: "u32" },
      },
    }),
  ])
    assert.equal(
      foreignCallTypes(malformed).ok,
      false,
      JSON.stringify(malformed),
    );
});

test("binding replaces a declared stub with one leaf c-call and verifies", () => {
  const input = stub(["number", "Uint8Array"], "number"),
    before = structuredClone(input);
  const bound = bindForeignCalls(input, [{ function: 0, call: call() }]);
  assert.ok(bound.ok);
  assert.deepEqual(input, before);
  const fn = bound.value.functions[0]!;
  assert.deepEqual(
    fn.blocks[0]!.instructions.map((op) => op.kind),
    ["load", "load", "c-call"],
  );
  assert.ok(verify(bound.value).ok, JSON.stringify(verify(bound.value)));
  // Leaf calls neither allocate nor throw: callers need no safepoint.
  const op = fn.blocks[0]!.instructions[2]!;
  assert.equal(instructionEffects(op), effectReadHeap | effectWriteHeap);
  assert.equal(instructionEffects(op) & effectAllocate, 0);
  assert.equal(instructionMayThrow(op), false);
  assert.deepEqual([...(provenNoSafepoints(bound.value) ?? [])], [1]);
  for (const mismatch of [
    stub(["number", "number"], "number"),
    stub(["number", "Uint8Array"], "void"),
    stub(["number"], "number"),
  ])
    assert.equal(
      bindForeignCalls(mismatch, [{ function: 0, call: call() }]).ok,
      false,
    );
  assert.equal(
    bindForeignCalls(input, [
      { function: 0, call: call() },
      { function: 0, call: call() },
    ]).ok,
    false,
  );
});

test("verification rejects c-calls whose operands or results disagree", () => {
  const bound = bindForeignCalls(stub(["number", "Uint8Array"], "number"), [
    { function: 0, call: call() },
  ]);
  assert.ok(bound.ok);
  const fn = bound.value.functions[0]!;
  const block = fn.blocks[0]!;
  const op = block.instructions[2]!;
  if (op.kind !== "c-call") throw new Error("expected c-call");
  const swapped: ModuleIR = {
    functions: [
      {
        ...fn,
        blocks: [
          {
            ...block,
            instructions: [
              block.instructions[0]!,
              block.instructions[1]!,
              { ...op, arguments: [1, 0] },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(verify(swapped).ok, false);
  const voided: ModuleIR = {
    functions: [
      {
        ...fn,
        blocks: [
          {
            ...block,
            instructions: [
              block.instructions[0]!,
              block.instructions[1]!,
              { ...op, id: undefined },
            ],
            terminator: { kind: "return", value: undefined, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  assert.equal(verify(voided).ok, false);
});

test("general values extract as checked Uint8Arrays", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "bytes",
        exported: true,
        parameters: [0],
        slots: ["general"],
        returnType: "Uint8Array",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
              {
                kind: "general-value",
                id: 1,
                value: 0,
                type: "Uint8Array",
                start: 0,
                end: 0,
              },
            ],
            terminator: { kind: "return", value: 1, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
});

test("callers inline single-instruction c-call bindings", async () => {
  const { optimizeModule } = await import("@tint/ir/optimization");
  const bound = bindForeignCalls(stub(["number", "Uint8Array"], "number"), [
    { function: 0, call: call() },
  ]);
  assert.ok(bound.ok);
  const callee = bound.value.functions[0]!;
  const module: ModuleIR = {
    functions: [
      { ...callee, exported: false },
      {
        id: 1,
        name: "caller",
        exported: true,
        parameters: [0, 1],
        slots: ["number", "Uint8Array"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
              { kind: "load", id: 1, slot: 1, start: 0, end: 0 },
              {
                kind: "call",
                id: 2,
                target: 0,
                arguments: [0, 1],
                start: 0,
                end: 0,
              },
            ],
            terminator: { kind: "return", value: 2, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const optimized = optimizeModule(module).module;
  const caller = optimized.functions.find((fn) => fn.name === "caller")!;
  const kinds = caller.blocks.flatMap((block) =>
    block.instructions.map((op) => op.kind),
  );
  assert.ok(kinds.includes("c-call"), kinds.join(","));
  assert.ok(!kinds.includes("call"), kinds.join(","));
  assert.ok(verify(optimized).ok);
});
