import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verify,
  provenRecordFacts,
  provenRecordFlows,
  type ModuleIR,
} from "@tint/ir/scalar";
const span = { start: 0, end: 1 };
function fixture(): ModuleIR {
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "optional-reference", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "main",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
              { kind: "reference-wrap", id: 2, value: 1, ...span },
              { kind: "record-new", id: 3, record: 1, arguments: [2], ...span },
              { kind: "call", id: 4, target: 1, arguments: [3], ...span },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "read",
        exported: false,
        parameters: [0],
        slots: ["reference", "optional-reference", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: {
              kind: "record",
              record: 1,
              field: 0,
              object: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 3,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "reference-value", id: 2, value: 1, ...span },
            ],
            terminator: {
              kind: "record",
              record: 0,
              field: 0,
              object: 2,
              operation: "read",
              slot: 2,
              consequent: 2,
              alternate: 3,
              ...span,
            },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 3, slot: 2, ...span }],
            terminator: { kind: "return", value: 3, ...span },
          },
          { id: 3, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    ],
  };
}
test("closed record flow crosses calls and follows reference fields", () => {
  const module = fixture();
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const facts = provenRecordFlows(module);
  assert.ok(facts);
  assert.deepEqual([...facts[1]!], [3, 3, 0, 0]);
  assert.equal(provenRecordFlows(module, 0), undefined);
});
test("per-value facts name the one descriptor and non-null origins", () => {
  const module = fixture();
  const facts = provenRecordFacts(module);
  assert.ok(facts);
  assert.deepEqual([...facts.blocks[1]!], [3, 3, 0, 0]);
  // read: v0 loads the record-1 parameter, v1 the field holding a wrapped
  // record 0, v2 unwraps it; v3 is a number.
  assert.equal(facts.descriptor(1, 0), 1);
  assert.equal(facts.nonNull(1, 0), true);
  assert.equal(facts.descriptor(1, 1), 0);
  assert.equal(facts.descriptor(1, 2), 0);
  assert.equal(facts.nonNull(1, 2), true);
  assert.equal(facts.descriptor(1, 3), -1);
  assert.equal(facts.nonNull(1, 3), false);
  // IDs that are not instruction results prove nothing.
  assert.equal(facts.descriptor(1, 99), -1);
  assert.equal(facts.descriptor(7, 0), -1);
});
test("proven record-read instructions carry their field's layout", () => {
  const module = fixture(),
    read = module.functions[1]!;
  // The second access reads the field with an instruction (as a proven read
  // does after guard elimination) instead of a checked terminator.
  const instructionRead: ModuleIR = {
    ...module,
    functions: [
      module.functions[0]!,
      {
        ...read,
        blocks: [
          read.blocks[0]!,
          {
            id: 1,
            instructions: [
              { kind: "load", id: 4, slot: 0, ...span },
              {
                kind: "record-read",
                id: 1,
                object: 4,
                record: 1,
                field: 0,
                ...span,
              },
              { kind: "reference-value", id: 2, value: 1, ...span },
            ],
            terminator: {
              kind: "record",
              record: 0,
              field: 0,
              object: 2,
              operation: "read",
              slot: 2,
              consequent: 2,
              alternate: 3,
              ...span,
            },
          },
          read.blocks[2]!,
          read.blocks[3]!,
        ],
      },
    ],
  };
  assert.ok(
    verify(instructionRead).ok,
    JSON.stringify(verify(instructionRead)),
  );
  const facts = provenRecordFacts(instructionRead);
  assert.ok(facts);
  assert.equal(facts.descriptor(1, 2), 0);
  assert.equal(facts.nonNull(1, 2), true);
  assert.equal(facts.blocks[1]![1], 3);
});
test("exported reference inputs cannot establish field or parameter layout proofs", () => {
  const module = fixture(),
    read = module.functions[1]!;
  const external: ModuleIR = {
    ...module,
    functions: [module.functions[0]!, { ...read, exported: true }],
  };
  assert.ok(verify(external).ok, JSON.stringify(verify(external)));
  const facts = provenRecordFlows(external);
  assert.ok(facts);
  assert.deepEqual([...facts[1]!], [0, 0, 0, 0]);
});
test("returned reference fields are exposed to mutation between calls", () => {
  const module = fixture();
  const main = module.functions[0]!,
    block = main.blocks[0]!;
  const external: ModuleIR = {
    ...module,
    functions: [
      {
        ...main,
        returnType: "reference",
        blocks: [
          { ...block, terminator: { kind: "return", value: 3, ...span } },
        ],
      },
      module.functions[1]!,
    ],
  };
  assert.ok(verify(external).ok, JSON.stringify(verify(external)));
  const facts = provenRecordFlows(external);
  assert.ok(facts);
  assert.equal(facts[1]![1], 0);
});

test("record mutations join every layout, including writes after a read", () => {
  const module = fixture(),
    main = module.functions[0]!,
    block = main.blocks[0]!;
  const mixed: ModuleIR = {
    ...module,
    records: [...module.records!, module.records![0]!],
    functions: [
      {
        ...main,
        slots: ["optional-reference"],
        blocks: [
          {
            ...block,
            instructions: [
              ...block.instructions,
              { kind: "record-new", id: 5, record: 2, arguments: [0], ...span },
              { kind: "reference-wrap", id: 6, value: 5, ...span },
              { kind: "store", slot: 0, value: 6, ...span },
            ],
            terminator: {
              kind: "record",
              object: 3,
              record: 1,
              field: 0,
              operation: "write",
              slot: 0,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "constant", id: 7, value: 0, ...span }],
            terminator: { kind: "return", value: 7, ...span },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
      module.functions[1]!,
    ],
  };
  assert.ok(verify(mixed).ok, JSON.stringify(verify(mixed)));
  const facts = provenRecordFlows(mixed);
  assert.ok(facts);
  assert.deepEqual([...facts[1]!], [3, 0, 0, 0]);
});
test("exception escape is conservative unless executable startup guarantees no reentry", () => {
  const module = fixture(),
    main = module.functions[0]!,
    block = main.blocks[0]!;
  const throwing: ModuleIR = {
    ...module,
    functions: [
      {
        ...main,
        blocks: [
          {
            ...block,
            instructions: [
              ...block.instructions,
              { kind: "general-wrap", id: 5, value: 3, ...span },
            ],
            terminator: { kind: "throw", value: 5, ...span },
          },
        ],
      },
      module.functions[1]!,
    ],
  };
  assert.ok(verify(throwing).ok, JSON.stringify(verify(throwing)));
  assert.equal(provenRecordFlows(throwing)?.[1]?.[1], 0);
  assert.equal(provenRecordFlows(throwing, 100000, true)?.[1]?.[1], 3);
});

test("closed invocation roots are distinct from emitted symbol visibility", () => {
  const module = fixture();
  const symbols: ModuleIR = {
    ...module,
    functions: module.functions.map((fn) => ({ ...fn, exported: true })),
  };
  assert.ok(verify(symbols).ok);
  assert.deepEqual(
    [...provenRecordFlows(symbols, 100000, true, [0])![1]!],
    [3, 3, 0, 0],
  );
  assert.equal(provenRecordFlows(symbols, 100000, true, [9]), undefined);
});
test("owned closure environments derive layouts from construction", () => {
  const module = fixture(),
    main = module.functions[0]!,
    block = main.blocks[0]!,
    reader = module.functions[1]!;
  const closure: ModuleIR = {
    ...module,
    functions: [
      {
        ...main,
        blocks: [
          {
            ...block,
            instructions: [
              ...block.instructions,
              {
                kind: "function-new",
                id: 5,
                target: 2,
                environment: 3,
                ...span,
              },
              {
                kind: "call-indirect",
                id: 6,
                target: 2,
                callee: 5,
                arguments: [],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 6, ...span },
          },
        ],
      },
      reader,
      {
        ...reader,
        id: 2,
        name: "captured",
        parameters: [],
        closureEnvironment: 1,
        blocks: [
          {
            ...reader.blocks[0]!,
            instructions: [{ kind: "closure-environment", id: 0, ...span }],
          },
          ...reader.blocks.slice(1),
        ],
      },
    ],
  };
  assert.ok(verify(closure).ok, JSON.stringify(verify(closure)));
  const facts = provenRecordFlows(closure);
  assert.ok(facts);
  assert.deepEqual([...facts[2]!], [3, 3, 0, 0]);
});

test("layout inference converges through recursive parameter and return constraints", () => {
  const module = fixture(),
    main = module.functions[0]!,
    block = main.blocks[0]!;
  const instructions = [...block.instructions];
  instructions.splice(
    2,
    1,
    { kind: "constant", id: 10, value: true, ...span },
    { kind: "call", id: 9, target: 2, arguments: [1, 10], ...span },
    { kind: "reference-wrap", id: 2, value: 9, ...span },
  );
  const recursive: ModuleIR = {
    ...module,
    functions: [
      { ...main, blocks: [{ ...block, instructions }] },
      module.functions[1]!,
      {
        id: 2,
        name: "recursive",
        exported: false,
        parameters: [0, 1],
        slots: ["reference", "boolean"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 1, ...span }],
            terminator: {
              kind: "branch",
              condition: 0,
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
            instructions: [
              { kind: "load", id: 2, slot: 0, ...span },
              { kind: "load", id: 3, slot: 1, ...span },
              { kind: "call", id: 4, target: 2, arguments: [2, 3], ...span },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(recursive).ok, JSON.stringify(verify(recursive)));
  assert.deepEqual([...provenRecordFlows(recursive)![1]!], [3, 3, 0, 0]);
});
test("raw memory capabilities invalidate whole-module layout inference", () => {
  const module = fixture(),
    main = module.functions[0]!,
    block = main.blocks[0]!;
  const unsafe: ModuleIR = {
    ...module,
    functions: [
      {
        ...main,
        blocks: [
          {
            ...block,
            instructions: [
              ...block.instructions,
              {
                kind: "host-call",
                id: 5,
                operation: "memory-write-word",
                arguments: [0, 0, 0, 0],
                ...span,
              },
            ],
          },
        ],
      },
      module.functions[1]!,
    ],
  };
  assert.ok(verify(unsafe).ok);
  assert.equal(provenRecordFlows(unsafe, 100000, true, [0]), undefined);
});

test("compact verified IDs avoid repeated generic numeric-key validation", () => {
  const module = fixture(),
    original = Number.isSafeInteger;
  let checks = 0;
  Number.isSafeInteger = (value: unknown): boolean => {
    checks++;
    return original(value);
  };
  try {
    assert.deepEqual([...provenRecordFlows(module)![1]!], [3, 3, 0, 0]);
  } finally {
    Number.isSafeInteger = original;
  }
  assert.ok(checks < 10, String(checks));
});
test("large sparse value IDs preserve layout inference without a huge direct table", () => {
  const module = fixture(),
    shift = 0x80000000;
  const sparse: ModuleIR = {
    ...module,
    functions: module.functions.map((fn) => ({
      ...fn,
      blocks: fn.blocks.map((block) => ({
        ...block,
        instructions: block.instructions.map((op) => {
          switch (op.kind) {
            case "constant":
            case "load":
              return { ...op, id: op.id + shift };
            case "record-new":
              return {
                ...op,
                id: op.id + shift,
                arguments: op.arguments.map((value) =>
                  value === undefined ? undefined : value + shift,
                ),
              };
            case "call":
              return {
                ...op,
                id: op.id === undefined ? undefined : op.id + shift,
                arguments: op.arguments.map((value) => value + shift),
              };
            case "reference-wrap":
            case "reference-value":
              return { ...op, id: op.id + shift, value: op.value + shift };
            default:
              throw Error("fixture instruction");
          }
        }),
        terminator:
          block.terminator.kind === "record"
            ? { ...block.terminator, object: block.terminator.object + shift }
            : block.terminator.kind === "return"
              ? {
                  ...block.terminator,
                  value:
                    block.terminator.value === undefined
                      ? undefined
                      : block.terminator.value + shift,
                }
              : block.terminator,
      })),
    })),
  };
  assert.ok(verify(sparse).ok, JSON.stringify(verify(sparse)));
  assert.deepEqual([...provenRecordFlows(sparse)![1]!], [3, 3, 0, 0]);
});

test("a null-only field cannot invent a record origin through a checked cast", () => {
  const module = fixture(),
    main = module.functions[0]!;
  const nullable: ModuleIR = {
    ...module,
    functions: [
      {
        ...main,
        blocks: main.blocks.map((block) => ({
          ...block,
          instructions: block.instructions.map((op) =>
            op.kind === "reference-wrap"
              ? { kind: "reference-none" as const, id: op.id, ...span }
              : op,
          ),
        })),
      },
      module.functions[1]!,
    ],
  };
  assert.ok(verify(nullable).ok, JSON.stringify(verify(nullable)));
  assert.deepEqual([...provenRecordFlows(nullable)![1]!], [3, 0, 0, 0]);
});
test("address-only exports invalidate direct-caller record parameter proofs", () => {
  const original = fixture(),
    main = original.functions[0]!,
    block = main.blocks[0]!;
  const module: ModuleIR = {
    ...original,
    functions: [
      {
        ...main,
        blocks: [
          {
            ...block,
            instructions: [
              ...block.instructions,
              {
                kind: "function-address",
                id: 5,
                target: 1,
                part: "entry",
                ...span,
              },
            ],
          },
        ],
      },
      original.functions[1]!,
    ],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  // The guarded field read still has a module-wide layout proof; the exposed
  // function's input itself no longer inherits the direct caller's record.
  assert.deepEqual([...provenRecordFlows(module)![1]!], [0, 3, 0, 0]);
});
