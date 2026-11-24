import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  type Block,
  type FunctionIR,
  type ModuleIR,
} from "@tint/ir/scalar";
import {
  lowerProvenRecordReads,
  sinkEnvironmentLoads,
} from "@tint/ir/optimization";

const span = { start: 0, end: 0 };

const envRecord = {
  byteLength: 32,
  fields: [
    { offset: 8, type: "number" as const, mutable: false },
    { offset: 16, type: "number" as const, mutable: false },
    { offset: 24, type: "number" as const, mutable: true },
  ],
};

function makeModule(fn: FunctionIR): ModuleIR {
  const caller: FunctionIR = {
    id: 0,
    name: "entry",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "constant", id: 0, value: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  return {
    records: [envRecord],
    functions: [caller, { ...fn, id: 1 }],
  };
}

test("sinks cold-branch closure-environment loads and removes dead entry env", () => {
  const fn: FunctionIR = {
    id: 1,
    name: "callee",
    exported: false,
    closureEnvironment: 0,
    parameters: [0],
    slots: ["boolean", "reference", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "closure-environment", id: 0, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          {
            kind: "record-read",
            id: 1,
            object: 0,
            record: 0,
            field: 0,
            ...span,
          },
          { kind: "store", slot: 2, value: 1, ...span },
          { kind: "load", id: 2, slot: 1, ...span },
          {
            kind: "record-read",
            id: 3,
            object: 2,
            record: 0,
            field: 1,
            ...span,
          },
          { kind: "store", slot: 3, value: 3, ...span },
          { kind: "load", id: 4, slot: 0, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "constant", id: 10, value: 1, ...span }],
        terminator: { kind: "return", value: 10, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 20, slot: 2, ...span },
          { kind: "load", id: 21, slot: 3, ...span },
          {
            kind: "binary",
            id: 22,
            operator: "+",
            left: 20,
            right: 21,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 22, ...span },
      },
    ],
  };
  const module = makeModule(fn);
  assert.deepEqual(verify(module), { ok: true });
  const result = sinkEnvironmentLoads(module.functions[1]!, module, 10000);
  assert.ok(result !== undefined);
  assert.equal(result.sunk, 2);
  const updated: ModuleIR = {
    ...module,
    functions: [module.functions[0]!, result.fn],
  };
  assert.deepEqual(verify(updated), { ok: true });
  // Entry block no longer loads closure-environment or either cold field.
  assert.equal(
    result.fn.blocks[0]!.instructions.some(
      (op) => op.kind === "closure-environment" || op.kind === "record-read",
    ),
    false,
  );
  // Cold block 2 gets one shared closure-environment and both record-reads.
  const cold = result.fn.blocks[2]!.instructions;
  assert.equal(
    cold.filter((op) => op.kind === "closure-environment").length,
    1,
  );
  assert.equal(cold.filter((op) => op.kind === "record-read").length, 2);
});

test("keeps loop-used closure-environment loads hoisted outside natural loops", () => {
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [
        { kind: "closure-environment", id: 0, ...span },
        { kind: "record-read", id: 1, object: 0, record: 0, field: 0, ...span },
        { kind: "store", slot: 1, value: 1, ...span },
        { kind: "load", id: 2, slot: 0, ...span },
      ],
      terminator: {
        kind: "branch",
        condition: 2,
        consequent: 1,
        alternate: 4,
        ...span,
      },
    },
    {
      id: 1, // preheader
      instructions: [],
      terminator: { kind: "jump", target: 2, ...span },
    },
    {
      id: 2, // loop header
      instructions: [
        { kind: "load", id: 10, slot: 1, ...span },
        { kind: "load", id: 11, slot: 0, ...span },
      ],
      terminator: {
        kind: "branch",
        condition: 11,
        consequent: 3,
        alternate: 4,
        ...span,
      },
    },
    {
      id: 3, // loop latch
      instructions: [],
      terminator: { kind: "jump", target: 2, ...span },
    },
    {
      id: 4,
      instructions: [{ kind: "constant", id: 20, value: 0, ...span }],
      terminator: { kind: "return", value: 20, ...span },
    },
  ];
  const fn: FunctionIR = {
    id: 1,
    name: "loopCallee",
    exported: false,
    closureEnvironment: 0,
    parameters: [0],
    slots: ["boolean", "number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
  const module = makeModule(fn);
  assert.deepEqual(verify(module), { ok: true });
  const result = sinkEnvironmentLoads(module.functions[1]!, module, 10000);
  assert.ok(result !== undefined);
  assert.equal(result.sunk, 1);
  // Must land in preheader b1, NOT inside loop header b2.
  assert.equal(
    result.fn.blocks[1]!.instructions.some((op) => op.kind === "record-read"),
    true,
  );
  assert.equal(
    result.fn.blocks[2]!.instructions.some((op) => op.kind === "record-read"),
    false,
  );
  assert.deepEqual(
    verify({ ...module, functions: [module.functions[0]!, result.fn] }),
    { ok: true },
  );
});

test("sinks multi-branch capture to lowest common dominator and ignores mutable fields", () => {
  const fn: FunctionIR = {
    id: 1,
    name: "diamond",
    exported: false,
    closureEnvironment: 0,
    parameters: [0],
    slots: ["boolean", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "closure-environment", id: 0, ...span },
          {
            kind: "record-read",
            id: 1,
            object: 0,
            record: 0,
            field: 0,
            ...span,
          },
          { kind: "store", slot: 1, value: 1, ...span },
          {
            kind: "record-read",
            id: 2,
            object: 0,
            record: 0,
            field: 2,
            ...span,
          },
          { kind: "store", slot: 2, value: 2, ...span },
          { kind: "load", id: 3, slot: 0, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "constant", id: 10, value: 0, ...span }],
        terminator: { kind: "return", value: 10, ...span },
      },
      {
        id: 2, // LCD of b3 and b4
        instructions: [{ kind: "load", id: 20, slot: 0, ...span }],
        terminator: {
          kind: "branch",
          condition: 20,
          consequent: 3,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 30, slot: 1, ...span },
          { kind: "load", id: 31, slot: 2, ...span },
          {
            kind: "binary",
            id: 32,
            operator: "+",
            left: 30,
            right: 31,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 32, ...span },
      },
      {
        id: 4,
        instructions: [{ kind: "load", id: 40, slot: 1, ...span }],
        terminator: { kind: "return", value: 40, ...span },
      },
    ],
  };
  const module = makeModule(fn);
  assert.deepEqual(verify(module), { ok: true });
  const result = sinkEnvironmentLoads(module.functions[1]!, module, 10000);
  assert.ok(result !== undefined);
  // Only immutable field 0 sinks (to LCD b2); mutable field 2 stays in b0.
  assert.equal(result.sunk, 1);
  assert.equal(
    result.fn.blocks[2]!.instructions.some(
      (op) => op.kind === "record-read" && op.field === 0,
    ),
    true,
  );
  assert.equal(
    result.fn.blocks[0]!.instructions.some(
      (op) => op.kind === "record-read" && op.field === 2,
    ),
    true,
  );
  assert.deepEqual(
    verify({ ...module, functions: [module.functions[0]!, result.fn] }),
    { ok: true },
  );
});

test("lowerProvenRecordReads lowers checked reads on non-exported closure-environment", () => {
  const fn: FunctionIR = {
    id: 1,
    name: "checkedEnv",
    exported: false,
    closureEnvironment: 0,
    parameters: [],
    slots: ["number"],
    returnType: "number",
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
          slot: 0,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
        terminator: { kind: "return", value: 1, ...span },
      },
      {
        id: 2,
        instructions: [],
        terminator: { kind: "trap", ...span },
      },
    ],
  };
  const module = makeModule(fn);
  assert.deepEqual(verify(module), { ok: true });
  const lowered = lowerProvenRecordReads(module, 10000);
  assert.ok(lowered !== undefined);
  assert.equal(lowered.rewritten, 1);
  assert.deepEqual(verify(lowered.module), { ok: true });
  assert.equal(
    lowered.module.functions[1]!.blocks[0]!.instructions.some(
      (op) => op.kind === "record-read",
    ),
    true,
  );
});

test("sinks cold captures across a multi-block straight-line entry prefix", () => {
  const fn: FunctionIR = {
    id: 1,
    name: "prefixChain",
    exported: false,
    closureEnvironment: 0,
    parameters: [0],
    slots: ["boolean", "reference", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "closure-environment", id: 0, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          {
            kind: "record-read",
            id: 1,
            object: 0,
            record: 0,
            field: 0,
            ...span,
          },
          { kind: "store", slot: 2, value: 1, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...span },
          {
            kind: "record-read",
            id: 3,
            object: 2,
            record: 0,
            field: 1,
            ...span,
          },
          { kind: "store", slot: 3, value: 3, ...span },
          { kind: "load", id: 4, slot: 0, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [{ kind: "constant", id: 10, value: 1, ...span }],
        terminator: { kind: "return", value: 10, ...span },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 20, slot: 2, ...span },
          { kind: "load", id: 21, slot: 3, ...span },
          {
            kind: "binary",
            id: 22,
            operator: "+",
            left: 20,
            right: 21,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 22, ...span },
      },
    ],
  };
  const module = makeModule(fn);
  assert.deepEqual(verify(module), { ok: true });
  const result = sinkEnvironmentLoads(module.functions[1]!, module, 10000);
  assert.ok(result !== undefined);
  assert.equal(result.sunk, 2);
  const updated: ModuleIR = {
    ...module,
    functions: [module.functions[0]!, result.fn],
  };
  assert.deepEqual(verify(updated), { ok: true });
  assert.equal(result.fn.blocks[0]!.instructions.length, 0);
  assert.equal(
    result.fn.blocks[1]!.instructions.some(
      (op) => op.kind === "record-read" || op.kind === "closure-environment",
    ),
    false,
  );
  const cold = result.fn.blocks[3]!.instructions;
  assert.equal(
    cold.filter((op) => op.kind === "closure-environment").length,
    1,
  );
  assert.equal(cold.filter((op) => op.kind === "record-read").length, 2);
});

test("sinking into a record-check block preserves proven layout in its consequent", () => {
  const boxRecord = {
    byteLength: 16,
    fields: [{ offset: 8, type: "number" as const, mutable: false }],
  };
  const refEnvRecord = {
    byteLength: 16,
    fields: [{ offset: 8, type: "reference" as const, mutable: false }],
  };
  const fn: FunctionIR = {
    id: 1,
    name: "checkedSink",
    exported: false,
    closureEnvironment: 0,
    parameters: [0],
    slots: ["boolean", "reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "closure-environment", id: 0, ...span },
          {
            kind: "record-read",
            id: 1,
            object: 0,
            record: 0,
            field: 0,
            ...span,
          },
          { kind: "store", slot: 1, value: 1, ...span },
          { kind: "load", id: 2, slot: 0, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 2,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "constant", id: 10, value: 0, ...span }],
        terminator: { kind: "return", value: 10, ...span },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 20, slot: 1, ...span }],
        terminator: {
          kind: "record",
          object: 20,
          record: 1,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 3,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 30, slot: 1, ...span },
          {
            kind: "record-read",
            id: 31,
            object: 30,
            record: 1,
            field: 0,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 31, ...span },
      },
      {
        id: 4,
        instructions: [],
        terminator: { kind: "trap", ...span },
      },
    ],
  };
  const base = makeModule(fn);
  const module: ModuleIR = {
    ...base,
    records: [refEnvRecord, boxRecord],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = sinkEnvironmentLoads(module.functions[1]!, module, 10000);
  assert.ok(result !== undefined);
  assert.equal(result.sunk, 1);
  assert.deepEqual(
    verify({ ...module, functions: [module.functions[0]!, result.fn] }),
    { ok: true },
  );
  assert.equal(
    result.fn.blocks[2]!.instructions.some(
      (op) => op.kind === "record-read" && op.record === 0,
    ),
    true,
  );
});
