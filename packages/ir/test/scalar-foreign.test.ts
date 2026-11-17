import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindForeignCalls,
  foreignCallTypes,
  foreignMemoryTypes,
  instructionEffects,
  instructionMayThrow,
  effectAllocate,
  effectReadHeap,
  effectWriteHeap,
  provenNoSafepoints,
  verify,
  type ForeignCall,
  type ForeignMemoryAccess,
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

const u32: CType = { kind: "scalar", scalar: "u32" };
const flag: CType = { kind: "scalar", scalar: "bool" };
function access(
  overrides: Partial<ForeignMemoryAccess> = {},
): ForeignMemoryAccess {
  return {
    operation: "load",
    type: u32,
    offset: 8,
    minimum: 112,
    ...overrides,
  };
}

test("C memory accesses type loads, stores and external-storage primitives", () => {
  const types = (value: ForeignMemoryAccess) => {
    const result = foreignMemoryTypes(value);
    return result.ok ? result.value : result.error;
  };
  assert.deepEqual(types(access()), {
    parameters: ["Uint8Array"],
    result: "number",
  });
  assert.deepEqual(types(access({ operation: "store" })), {
    parameters: ["Uint8Array", "number"],
    result: "void",
  });
  assert.deepEqual(types(access({ type: flag, offset: 0 })), {
    parameters: ["Uint8Array"],
    result: "boolean",
  });
  // Raw addresses are numbers.
  assert.deepEqual(types(access({ type: bytes, offset: 104 })), {
    parameters: ["Uint8Array"],
    result: "number",
  });
  const primitive = { type: { kind: "void" } as const, offset: 0, minimum: 0 };
  assert.deepEqual(types({ operation: "address", ...primitive }), {
    parameters: ["Uint8Array"],
    result: "number",
  });
  assert.deepEqual(types({ operation: "adopt", ...primitive }), {
    parameters: ["Uint8Array", "number", "number"],
    result: "Uint8Array",
  });
  assert.deepEqual(types({ operation: "retarget", ...primitive }), {
    parameters: ["Uint8Array", "number"],
    result: "void",
  });
  // A member must lie inside the record; only scalars and pointers.
  assert.match(String(types(access({ offset: 110 }))), /outside its record/);
  assert.match(String(types(access({ offset: -4 }))), /outside its record/);
  assert.match(String(types(access({ type: pair }))), /scalars or pointers/);
  assert.match(
    String(types({ operation: "address", type: u32, offset: 0, minimum: 0 })),
    /only field accesses/,
  );
});

test("Field accessors bind to one c-memory access that inlines, never allocating", async () => {
  const getter = bindForeignCalls(stub(["Uint8Array"], "number"), [
    { function: 0, memory: access() },
  ]);
  assert.ok(getter.ok, JSON.stringify(getter));
  assert.ok(verify(getter.value).ok);
  const op = getter.value.functions[0]!.blocks[0]!.instructions[1]!;
  assert.equal(op.kind, "c-memory");
  assert.equal(instructionEffects(op), effectReadHeap);
  assert.equal(instructionMayThrow(op), false);
  const setter = bindForeignCalls(stub(["Uint8Array", "number"], "void"), [
    { function: 0, memory: access({ operation: "store" }) },
  ]);
  assert.ok(setter.ok);
  const store = setter.value.functions[0]!.blocks[0]!.instructions[2]!;
  assert.equal(instructionEffects(store), effectWriteHeap);
  assert.deepEqual([...(provenNoSafepoints(setter.value) ?? [])], [1]);
  // A binding is a call or an access, never both or neither.
  for (const binding of [
    { function: 0 },
    { function: 0, call: call(), memory: access() },
  ])
    assert.equal(
      bindForeignCalls(stub(["Uint8Array"], "number"), [binding]).ok,
      false,
    );
  // The declared signature must match the access.
  assert.equal(
    bindForeignCalls(stub(["number"], "number"), [
      { function: 0, memory: access() },
    ]).ok,
    false,
  );
  const { optimizeModule } = await import("@tint/ir/optimization");
  const callee = getter.value.functions[0]!;
  const module: ModuleIR = {
    functions: [
      { ...callee, exported: false },
      {
        id: 1,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["Uint8Array"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
              {
                kind: "call",
                id: 1,
                target: 0,
                arguments: [0],
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
  const optimized = optimizeModule(module).module;
  const kinds = optimized.functions
    .find((fn) => fn.name === "caller")!
    .blocks.flatMap((block) => block.instructions.map((op) => op.kind));
  assert.ok(
    kinds.includes("c-memory") && !kinds.includes("call"),
    kinds.join(),
  );
});

test("verification rejects c-memory operands and results that disagree", () => {
  const module = (
    instruction: ModuleIR["functions"][number]["blocks"][number]["instructions"][number],
  ): ModuleIR => ({
    functions: [
      {
        id: 0,
        name: "probe",
        exported: true,
        parameters: [0, 1],
        slots: ["Uint8Array", "number"],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
              { kind: "load", id: 1, slot: 1, start: 0, end: 0 },
              instruction,
            ],
            terminator: { kind: "return", value: undefined, start: 0, end: 0 },
          },
        ],
      },
    ],
  });
  const at = { start: 0, end: 0 };
  assert.ok(
    verify(
      module({
        kind: "c-memory",
        access: access({ operation: "store" }),
        id: undefined,
        arguments: [0, 1],
        ...at,
      }),
    ).ok,
  );
  for (const bad of [
    { access: access({ operation: "store" }), id: 2, arguments: [0, 1] },
    { access: access(), id: undefined, arguments: [0] },
    { access: access(), id: 2, arguments: [1] },
    {
      access: access({ operation: "store" }),
      id: undefined,
      arguments: [1, 1],
    },
  ])
    assert.equal(
      verify(module({ kind: "c-memory", ...bad, ...at })).ok,
      false,
      JSON.stringify(bad),
    );
});
