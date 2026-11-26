import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  instructionResult,
  type FunctionIR,
  type Block,
  type ModuleIR,
  type RecordField,
  type RecordLayout,
} from "@tint/ir/scalar";
const span = { start: 0, end: 1 };
test("function environment extraction requires a reference and returns an optional reference", () => {
  for (const input of ["reference", "number"] as const) {
    const result = verify({
      functions: [
        {
          id: 0,
          name: "environment",
          exported: true,
          parameters: [0],
          slots: [input],
          returnType: "optional-reference",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "function-environment", id: 1, callee: 0, ...span },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    });
    assert.equal(result.ok, input === "reference", JSON.stringify(result));
  }
});
test("general unary operands permit truthiness but still reject numeric payload operations", () => {
  for (const operator of ["truthy", "!", "+", "is-integer"] as const) {
    const result = verify({
      functions: [
        {
          id: 0,
          name: "generalUnary",
          exported: true,
          parameters: [0],
          slots: ["general"],
          returnType: operator === "+" ? "number" : "boolean",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "unary", id: 1, operator, operand: 0, ...span },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    });
    assert.equal(
      result.ok,
      operator === "truthy" || operator === "!",
      JSON.stringify(result),
    );
  }
});
test("initialization propagation schedules affected blocks instead of rescanning a reverse chain", () => {
  const count = 160;
  let reads = 0;
  const blocks: Block[] = Array.from({ length: count }, (_, id) => ({
    id,
    instructions: id === 0 ? [{ kind: "load", id: 0, slot: 0, ...span }] : [],
    terminator:
      id === 0
        ? { kind: "return", value: 0, ...span }
        : { kind: "jump", target: id - 1, ...span },
  }));
  const observed = new Proxy(blocks, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const result = verify({
    functions: [
      {
        id: 0,
        name: "reverse",
        exported: true,
        parameters: [],
        slots: ["number"],
        returnType: "number",
        entry: count - 1,
        blocks: observed,
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "INITIALIZATION");
  assert.ok(reads < count * 50, `block reads: ${reads}`);
});
test("record verification reuses numeric scratch instead of per-byte Set entries", () => {
  const original = globalThis.Set;
  let insertions = 0;
  const records = Array.from({ length: 4 }, () => ({
    byteLength: 80,
    fields: Array.from({ length: 8 }, (_, i) => ({
      offset: 16 + i * 8,
      type: "number" as const,
      mutable: true,
    })),
  }));
  class CountedSet<T> extends original<T> {
    override add(value: T): this {
      if (typeof value === "number") insertions++;
      return super.add(value);
    }
  }
  globalThis.Set = CountedSet;
  try {
    assert.ok(verify({ functions: [], records }).ok);
    assert.equal(insertions, 0);
    // Resetting scratch between records must not hide an overlap inside one.
    assert.equal(
      verify({
        functions: [],
        records: [
          ...records,
          {
            byteLength: 80,
            fields: [records[0]!.fields[0]!, records[0]!.fields[0]!],
          },
        ],
      }).ok,
      false,
    );
  } finally {
    globalThis.Set = original;
  }
});
test("dynamic optional-field presence is a boolean contract separate from its payload", () => {
  function construction(presence: boolean | number) {
    return verify({
      records: [
        {
          byteLength: 48,
          fields: [
            {
              offset: 24,
              presenceOffset: 16,
              type: "optional-number",
              mutable: true,
            },
          ],
        },
      ],
      functions: [
        {
          id: 0,
          name: "build",
          exported: true,
          parameters: [],
          slots: [],
          returnType: "reference",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "undefined", id: 0, ...span },
                { kind: "constant", id: 1, value: presence, ...span },
                {
                  kind: "record-new",
                  id: 2,
                  record: 0,
                  arguments: [0],
                  presence: [1],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 2, ...span },
            },
          ],
        },
      ],
    });
  }
  assert.ok(construction(false).ok);
  assert.ok(construction(true).ok);
  assert.equal(construction(1).ok, false);
});
test("general fields keep own presence separate from an undefined payload", () => {
  for (const present of [false, true]) {
    const result = verify({
      records: [
        {
          byteLength: 48,
          fields: [
            { offset: 24, presenceOffset: 16, type: "general", mutable: true },
          ],
        },
      ],
      functions: [
        {
          id: 0,
          name: "hasGeneral",
          exported: true,
          parameters: [],
          slots: [],
          returnType: "boolean",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "general-none", id: 0, ...span },
                { kind: "constant", id: 1, value: present, ...span },
                {
                  kind: "record-new",
                  id: 2,
                  record: 0,
                  arguments: [0],
                  presence: [1],
                  ...span,
                },
                {
                  kind: "record-has",
                  id: 3,
                  object: 2,
                  record: 0,
                  field: 0,
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 3, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("record presence queries validate descriptors, fields and reference inputs", () => {
  const module = {
    records: [
      {
        byteLength: 32,
        fields: [
          {
            offset: 24,
            presenceOffset: 16,
            type: "optional-reference" as const,
            mutable: true,
          },
        ],
      },
    ],
    functions: [
      {
        id: 0,
        name: "has",
        exported: true,
        parameters: [0],
        slots: ["reference" as const],
        returnType: "boolean" as const,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load" as const, id: 0, slot: 0, ...span },
              {
                kind: "record-has" as const,
                id: 1,
                object: 0,
                record: 0,
                field: 0,
                ...span,
              },
            ],
            terminator: { kind: "return" as const, value: 1, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(module).ok);
  for (const field of [-1, 1]) {
    const changed = structuredClone(module);
    const query = changed.functions[0]!.blocks[0]!.instructions[1]!;
    assert.equal(query.kind, "record-has");
    if (query.kind === "record-has") query.field = field;
    assert.equal(verify(changed).ok, false);
  }
});
test("primitive representation references require explicit boundary operations", () => {
  const roundTrip: FunctionIR = {
    id: 0,
    name: "box",
    exported: true,
    parameters: [0],
    slots: ["reference", "primitive"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "primitive-wrap", id: 1, value: 0, ...span },
          { kind: "store", slot: 1, value: 1, ...span },
          { kind: "load", id: 2, slot: 1, ...span },
          { kind: "primitive-reference", id: 3, value: 2, ...span },
        ],
        terminator: { kind: "return", value: 3, ...span },
      },
    ],
  };
  assert.equal(verify({ functions: [roundTrip] }).ok, true);
  const block = roundTrip.blocks[0]!;
  for (const op of [
    {
      kind: "binary",
      id: 4,
      operator: "===",
      left: 1,
      right: 1,
      ...span,
    } as const,
    { kind: "unary", id: 4, operator: "truthy", operand: 1, ...span } as const,
  ])
    assert.equal(
      verify({
        functions: [
          {
            ...roundTrip,
            returnType: "boolean",
            blocks: [
              {
                ...block,
                instructions: [...block.instructions, op],
                terminator: { kind: "return", value: 4, ...span },
              },
            ],
          },
        ],
      }).ok,
      false,
    );
  assert.equal(
    verify({
      functions: [
        {
          ...roundTrip,
          blocks: [
            { ...block, terminator: { kind: "return", value: 1, ...span } },
          ],
        },
      ],
    }).ok,
    false,
  );
  assert.equal(
    verify({
      functions: [
        {
          ...roundTrip,
          blocks: [
            {
              ...block,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "primitive-reference", id: 3, value: 0, ...span },
              ],
            },
          ],
        },
      ],
    }).ok,
    false,
  );
});
function fn(blocks: readonly Block[]): FunctionIR {
  return {
    id: 0,
    name: "f",
    exported: true,
    parameters: [0],
    slots: ["number", "number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
}
const good: Block = {
  id: 0,
  instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
  terminator: { kind: "return", value: 0, ...span },
};
test("accepts typed scalar values, calls and initialized slots", () => {
  assert.equal(verify({ functions: [fn([good])] }).ok, true);
});
test("rejects malformed graph, invalid operands and uninitialized loads", () => {
  const bad: FunctionIR[] = [
    fn([{ ...good, id: 1 }]),
    fn([good, good]),
    fn([{ ...good, terminator: { kind: "jump", target: 9, ...span } }]),
    fn([
      { ...good, instructions: [{ kind: "load", id: 0, slot: 1, ...span }] },
    ]),
    fn([{ ...good, instructions: [] }]),
    fn([
      {
        ...good,
        instructions: [{ kind: "constant", id: 0, value: true, ...span }],
      },
    ]),
    fn([
      {
        ...good,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 0, slot: 0, ...span },
        ],
      },
    ]),
    fn([
      {
        ...good,
        instructions: [
          { kind: "constant", id: 0, value: 1, ...span },
          { kind: "binary", id: 1, operator: "?", left: 0, right: 0, ...span },
        ],
      },
    ]),
    fn([
      {
        ...good,
        instructions: [
          { kind: "call", id: 0, target: 99, arguments: [], ...span },
        ],
      },
    ]),
  ];
  for (const f of bad)
    assert.equal(verify({ functions: [f] }).ok, false, JSON.stringify(f));
});
test("initialization must hold on every incoming path including the first loop iteration", () => {
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [{ kind: "constant", id: 0, value: true, ...span }],
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
      instructions: [
        { kind: "constant", id: 1, value: 2, ...span },
        { kind: "store", slot: 1, value: 1, ...span },
      ],
      terminator: { kind: "jump", target: 2, ...span },
    },
    {
      id: 2,
      instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
      terminator: { kind: "return", value: 2, ...span },
    },
  ];
  assert.equal(verify({ functions: [fn(blocks)] }).ok, false);
  const initialized: Block = {
    ...blocks[0],
    id: 0,
    instructions: [
      { kind: "constant", id: 0, value: true, ...span },
      { kind: "constant", id: 3, value: 0, ...span },
      { kind: "store", slot: 1, value: 3, ...span },
    ],
    terminator: blocks[0]!.terminator,
  };
  assert.equal(
    verify({ functions: [fn([initialized, ...blocks.slice(1)])] }).ok,
    true,
  );
  const loop: Block[] = [
    {
      id: 0,
      instructions: [],
      terminator: { kind: "jump", target: 1, ...span },
    },
    {
      id: 1,
      instructions: [
        { kind: "load", id: 0, slot: 1, ...span },
        { kind: "store", slot: 1, value: 0, ...span },
      ],
      terminator: { kind: "jump", target: 1, ...span },
    },
  ];
  assert.equal(verify({ functions: [fn(loop)] }).ok, false);
});
test("values are local to their defining block in this first IR slice", () => {
  assert.equal(
    verify({
      functions: [
        fn([
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 1, ...span }],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 1,
            instructions: [],
            terminator: { kind: "return", value: 0, ...span },
          },
        ]),
      ],
    }).ok,
    false,
  );
});
test("callee signatures, branch booleans, slot stores and source spans are checked independently", () => {
  const variants: { block: Block; code: string }[] = [
    {
      block: {
        ...good,
        instructions: [
          { kind: "constant", id: 0, value: 1, ...span },
          { kind: "call", id: 1, target: 0, arguments: [], ...span },
        ],
      },
      code: "TYPE",
    },
    {
      block: {
        ...good,
        instructions: [
          { kind: "constant", id: 0, value: true, ...span },
          { kind: "call", id: 1, target: 0, arguments: [0], ...span },
        ],
      },
      code: "TYPE",
    },
    {
      block: {
        ...good,
        instructions: [
          { kind: "constant", id: 0, value: true, ...span },
          { kind: "store", slot: 0, value: 0, ...span },
        ],
      },
      code: "TYPE",
    },
    {
      block: {
        ...good,
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 0,
          alternate: 0,
          ...span,
        },
      },
      code: "TYPE",
    },
    {
      block: {
        ...good,
        instructions: [{ kind: "load", id: 0, slot: 0, start: -1, end: 1 }],
      },
      code: "GRAPH",
    },
    {
      block: {
        ...good,
        instructions: [{ kind: "load", id: 0, slot: 1, ...span }],
      },
      code: "INITIALIZATION",
    },
    { block: { ...good, instructions: [] }, code: "VALUE" },
  ];
  for (const item of variants) {
    const r = verify({ functions: [fn([item.block])] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, item.code);
  }
});

test("typed-array operations require array handles and numeric operands", () => {
  const make = (
    kind: "array-read" | "array-valid",
    array: number,
    index: number,
  ): FunctionIR => ({
    id: 0,
    name: "array",
    exported: false,
    parameters: [0, 1],
    slots: ["Uint32Array", "number"],
    returnType: kind === "array-read" ? "optional-number" : "boolean",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          { kind, id: 2, array, index, ...span },
        ],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  });
  for (const kind of ["array-read", "array-valid"] as const) {
    assert.equal(verify({ functions: [make(kind, 0, 1)] }).ok, true);
    assert.equal(verify({ functions: [make(kind, 1, 0)] }).ok, false);
    assert.equal(verify({ functions: [make(kind, 0, 3)] }).ok, false);
  }
});

test("optional instructions enforce tag construction and extraction types", () => {
  const make = (
    operation: import("@tint/ir/scalar").Instruction,
    returnType: import("@tint/ir/scalar").ReturnType,
  ): FunctionIR => ({
    id: 0,
    name: "optional",
    exported: false,
    parameters: [],
    slots: [],
    returnType,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 1, ...span },
          operation,
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  });
  assert.equal(
    verify({
      functions: [
        make(
          { kind: "optional-wrap", id: 1, value: 0, ...span },
          "optional-number",
        ),
      ],
    }).ok,
    true,
  );
  assert.equal(
    verify({
      functions: [
        make({ kind: "optional-wrap", id: 1, value: 0, ...span }, "number"),
      ],
    }).ok,
    false,
  );
  assert.equal(
    verify({
      functions: [
        make({ kind: "optional-value", id: 1, value: 0, ...span }, "number"),
      ],
    }).ok,
    false,
  );
  assert.equal(
    verify({
      functions: [
        make({ kind: "optional-present", id: 1, value: 0, ...span }, "boolean"),
      ],
    }).ok,
    false,
  );
});

test("guarded environment cells initialize read destinations only on their success edge", () => {
  const environment = {
    byteLength: 24,
    cells: [
      {
        type: "number" as const,
        stateOffset: 0,
        valueOffset: 8,
        mutable: true,
      },
    ],
  };
  const f: FunctionIR = {
    ...fn([
      {
        id: 0,
        instructions: [],
        terminator: {
          kind: "cell",
          cell: 0,
          operation: "read",
          slot: 0,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
      {
        id: 2,
        instructions: [{ kind: "constant", id: 1, value: -1, ...span }],
        terminator: { kind: "return", value: 1, ...span },
      },
    ]),
    environment,
  };
  assert.ok(verify({ functions: [f] }).ok);
  assert.ok(verify({ functions: [{ ...f, parameters: [] }] }).ok);
  assert.ok(
    !verify({
      functions: [
        {
          ...f,
          parameters: [],
          blocks: f.blocks.map((b) =>
            b.id === 2
              ? {
                  ...b,
                  instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
                }
              : b,
          ),
        },
      ],
    }).ok,
  );
  assert.ok(
    !verify({
      functions: [{ ...f, environment: { ...environment, byteLength: 8 } }],
    }).ok,
  );
  assert.ok(
    !verify({
      functions: [
        {
          ...f,
          environment: {
            ...environment,
            cells: [...environment.cells, ...environment.cells],
          },
        },
      ],
    }).ok,
  );
  const { environment: unused, ...without } = f;
  void unused;
  assert.ok(!verify({ functions: [without] }).ok);
  const caller = fn([
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 0, ...span },
        { kind: "call", id: 1, target: 1, arguments: [0], ...span },
      ],
      terminator: { kind: "return", value: 1, ...span },
    },
  ]);
  const call = verify({
    functions: [caller, { ...f, id: 1, name: "environment" }],
  });
  assert.ok(!call.ok);
  assert.equal(call.error.code, "GRAPH");
});

test("explicit inherited-environment calls require matching caller and callee contracts", () => {
  const environment = {
    byteLength: 16,
    cells: [
      {
        type: "number" as const,
        stateOffset: 0,
        valueOffset: 8,
        mutable: true,
      },
    ],
  };
  const callee: FunctionIR = {
    ...fn([
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ]),
    id: 1,
    name: "callee",
    environment,
  };
  const caller: FunctionIR = {
    ...fn([
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          {
            kind: "call",
            id: 1,
            target: 1,
            arguments: [0],
            environment: "inherit",
            ...span,
          },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ]),
    environment,
  };
  assert.ok(verify({ functions: [caller, callee] }).ok);
  const { environment: ignored, ...plainCaller } = caller;
  void ignored;
  const { environment: ignored2, ...plainCallee } = callee;
  void ignored2;
  assert.ok(!verify({ functions: [plainCaller, callee] }).ok);
  assert.ok(!verify({ functions: [caller, plainCallee] }).ok);
  assert.ok(
    !verify({
      functions: [
        caller,
        {
          ...callee,
          environment: {
            ...environment,
            cells: [{ ...environment.cells[0]!, mutable: false }],
          },
        },
      ],
    }).ok,
  );
});

test("borrowed handle cells require an explicit lifetime qualifier", () => {
  const f: FunctionIR = {
    ...fn([{ id: 0, instructions: [], terminator: { kind: "trap", ...span } }]),
    parameters: [],
    slots: [],
    environment: {
      byteLength: 16,
      cells: [
        {
          type: "Uint8Array",
          borrowed: true,
          stateOffset: 0,
          valueOffset: 8,
          mutable: false,
        },
      ],
    },
  };
  assert.ok(verify({ functions: [f] }).ok);
  assert.ok(
    !verify({
      functions: [
        {
          ...f,
          environment: {
            byteLength: 16,
            cells: [
              {
                type: "Uint8Array",
                stateOffset: 0,
                valueOffset: 8,
                mutable: false,
              },
            ],
          },
        },
      ],
    }).ok,
  );
  assert.ok(
    !verify({
      functions: [
        {
          ...f,
          environment: {
            byteLength: 16,
            cells: [
              {
                type: "number",
                borrowed: true,
                stateOffset: 0,
                valueOffset: 8,
                mutable: false,
              },
            ],
          },
        },
      ],
    }).ok,
  );
});

test("managed references remain distinct from scalar data and borrowed cells", () => {
  const f: FunctionIR = {
    id: 0,
    name: "identity",
    exported: true,
    parameters: [0],
    slots: ["reference"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [f] }).ok);
  assert.ok(!verify({ functions: [{ ...f, returnType: "number" }] }).ok);
  assert.ok(
    !verify({
      functions: [
        {
          ...f,
          environment: {
            byteLength: 16,
            cells: [
              {
                type: "reference",
                stateOffset: 0,
                valueOffset: 8,
                mutable: true,
              },
            ],
          },
        },
      ],
    }).ok,
  );
  assert.ok(
    !verify({
      functions: [
        {
          ...f,
          returnType: "number",
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "unary", id: 1, operator: "+", operand: 0, ...span },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    }).ok,
  );
});

test("record guards establish read initialization only on the successful edge", () => {
  const record = {
    byteLength: 32,
    fields: [{ offset: 16, type: "number" as const, mutable: true }],
  };
  const f: FunctionIR = {
    id: 0,
    name: "read",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
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
        instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
        terminator: { kind: "return", value: 1, ...span },
      },
      {
        id: 2,
        instructions: [{ kind: "constant", id: 2, value: -1, ...span }],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
  assert.ok(verify({ records: [record], functions: [f] }).ok);
  assert.ok(
    !verify({
      records: [record],
      functions: [
        {
          ...f,
          blocks: [
            f.blocks[0]!,
            f.blocks[1]!,
            {
              ...f.blocks[2]!,
              instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
            },
          ],
        },
      ],
    }).ok,
  );
  const entry = f.blocks[0]!.terminator;
  assert.ok(entry.kind === "record");
  const write = {
    ...f,
    blocks: [
      {
        ...f.blocks[0]!,
        terminator: { ...entry, operation: "write" as const },
      },
      ...f.blocks.slice(1),
    ],
  };
  assert.ok(!verify({ records: [record], functions: [write] }).ok);
  assert.ok(
    !verify({
      records: [{ ...record, fields: [...record.fields, ...record.fields] }],
      functions: [f],
    }).ok,
  );
  assert.ok(
    !verify({ records: [{ ...record, byteLength: 16 }], functions: [f] }).ok,
  );
});

test("record writes require the declared field type and mutable storage", () => {
  const f: FunctionIR = {
    id: 0,
    name: "write",
    exported: true,
    parameters: [0, 1],
    slots: ["reference", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "write",
          slot: 1,
          consequent: 1,
          alternate: 1,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...span },
      },
    ],
  };
  const record = {
    byteLength: 32,
    fields: [{ offset: 16, type: "number" as const, mutable: true }],
  };
  assert.ok(verify({ records: [record], functions: [f] }).ok);
  assert.ok(
    !verify({
      records: [
        { ...record, fields: [{ ...record.fields[0]!, mutable: false }] },
      ],
      functions: [f],
    }).ok,
  );
  assert.ok(
    !verify({
      records: [
        { ...record, fields: [{ ...record.fields[0]!, type: "reference" }] },
      ],
      functions: [f],
    }).ok,
  );
});

test("record deletes require a mutable field with presence", () => {
  const f: FunctionIR = {
    id: 0,
    name: "remove",
    exported: true,
    parameters: [0, 1],
    slots: ["reference", "optional-number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "delete",
          slot: 1,
          consequent: 1,
          alternate: 1,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...span },
      },
    ],
  };
  const field = {
    offset: 24,
    presenceOffset: 16,
    type: "optional-number" as const,
    mutable: true,
  };
  assert.ok(
    verify({ records: [{ byteLength: 32, fields: [field] }], functions: [f] })
      .ok,
  );
  const { presenceOffset: _, ...absent } = field;
  for (const changed of [absent, { ...field, mutable: false }])
    assert.ok(
      !verify({
        records: [{ byteLength: 32, fields: [changed] }],
        functions: [f],
      }).ok,
      JSON.stringify(changed),
    );
});

test("record construction initializes every declared field with a matching value", () => {
  const f: FunctionIR = {
    id: 0,
    name: "make",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
  const records = [
    {
      byteLength: 32,
      fields: [{ offset: 16, type: "number" as const, mutable: false }],
    },
  ];
  assert.ok(verify({ records, functions: [f] }).ok);
  for (const arguments_ of [[], [0, 0], [2]])
    assert.ok(
      !verify({
        records,
        functions: [
          {
            ...f,
            blocks: [
              {
                ...f.blocks[0]!,
                instructions: [
                  f.blocks[0]!.instructions[0]!,
                  {
                    kind: "record-new",
                    id: 1,
                    record: 0,
                    arguments: arguments_,
                    ...span,
                  },
                ],
              },
            ],
          },
        ],
      }).ok,
    );
  assert.ok(
    !verify({
      records: [
        {
          ...records[0]!,
          fields: [{ offset: 16, type: "reference", mutable: false }],
        },
      ],
      functions: [f],
    }).ok,
  );
});
test("optional numeric record fields occupy one NaN-boxed word", () => {
  const optional = {
    offset: 16,
    type: "optional-number" as const,
    mutable: true,
  };
  assert.ok(
    verify({ records: [{ byteLength: 32, fields: [optional] }], functions: [] })
      .ok,
  );
  assert.equal(
    verify({
      records: [{ byteLength: 32, fields: [{ ...optional, offset: 32 }] }],
      functions: [],
    }).ok,
    false,
  );
  assert.ok(
    verify({
      records: [
        {
          byteLength: 32,
          fields: [
            optional,
            { offset: 24, type: "number" as const, mutable: false },
          ],
        },
      ],
      functions: [],
    }).ok,
  );
  assert.equal(
    verify({
      records: [
        {
          byteLength: 32,
          fields: [
            optional,
            { offset: 16, type: "number" as const, mutable: false },
          ],
        },
      ],
      functions: [],
    }).ok,
    false,
  );
});
test("strings have content operations and cannot masquerade as numbers or opaque references", () => {
  const f: FunctionIR = {
    id: 0,
    name: "text",
    exported: true,
    slots: ["string"],
    parameters: [0],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "string-length", id: 1, string: 0, ...span },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [f] }).ok);
  assert.equal(
    verify({ functions: [{ ...f, slots: ["reference"] }] }).ok,
    false,
  );
  assert.equal(
    verify({
      functions: [
        {
          ...f,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "unary", id: 1, operator: "+", operand: 0, ...span },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    }).ok,
    false,
  );
});
test("concatenation requires two defined strings and produces a string", () => {
  const f: FunctionIR = {
    id: 0,
    name: "join",
    exported: true,
    slots: ["string", "string"],
    parameters: [0, 1],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          { kind: "string-concat", id: 2, left: 0, right: 1, ...span },
        ],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [f] }).ok);
  for (const type of [
    "number",
    "reference",
    "optional-number",
    "boolean",
  ] as const)
    assert.equal(
      verify({ functions: [{ ...f, slots: ["string", type] }] }).ok,
      false,
    );
  assert.equal(
    verify({ functions: [{ ...f, returnType: "number" }] }).ok,
    false,
  );
});
test("slice bounds distinguish numeric begin from optional limit", () => {
  const f: FunctionIR = {
    id: 0,
    name: "slice",
    exported: true,
    slots: ["string", "number", "optional-number"],
    parameters: [0, 1, 2],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          { kind: "load", id: 2, slot: 2, ...span },
          {
            kind: "string-slice",
            id: 3,
            string: 0,
            begin: 1,
            limit: 2,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 3, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [f] }).ok);
  for (const slots of [
    ["reference", "number", "optional-number"],
    ["string", "optional-number", "optional-number"],
    ["string", "number", "number"],
  ] as const)
    assert.equal(verify({ functions: [{ ...f, slots }] }).ok, false);
});
test("prefix tests require string operands and a numeric position", () => {
  const f: FunctionIR = {
    id: 0,
    name: "prefix",
    exported: true,
    slots: ["string", "string", "number"],
    parameters: [0, 1, 2],
    returnType: "boolean",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          { kind: "load", id: 2, slot: 2, ...span },
          {
            kind: "string-starts-with",
            id: 3,
            string: 0,
            search: 1,
            position: 2,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 3, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [f] }).ok);
  for (const slots of [
    ["reference", "string", "number"],
    ["string", "number", "number"],
    ["string", "string", "optional-number"],
  ] as const)
    assert.equal(verify({ functions: [{ ...f, slots }] }).ok, false);
  assert.equal(
    verify({ functions: [{ ...f, returnType: "number" }] }).ok,
    false,
  );
});
test("owned array creation has a numeric length and preserves element kind", () => {
  for (const type of ["Uint8Array", "Uint16Array", "Uint32Array"] as const) {
    const f: FunctionIR = {
      id: 0,
      name: "make",
      exported: true,
      parameters: [0],
      slots: ["number"],
      returnType: type,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...span },
            { kind: "array-new", id: 1, type, length: 0, ...span },
          ],
          terminator: { kind: "return", value: 1, ...span },
        },
      ],
    };
    assert.ok(verify({ functions: [f] }).ok);
    assert.equal(
      verify({ functions: [{ ...f, slots: ["boolean"] }] }).ok,
      false,
    );
    assert.equal(
      verify({ functions: [{ ...f, returnType: "reference" }] }).ok,
      false,
    );
  }
});
test("subarray IR preserves array kind and requires numeric normalized bounds", () => {
  const f: FunctionIR = {
    id: 0,
    name: "view",
    exported: true,
    slots: ["Uint16Array", "number", "number"],
    parameters: [0, 1, 2],
    returnType: "Uint16Array",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          { kind: "load", id: 2, slot: 2, ...span },
          {
            kind: "array-subarray",
            id: 3,
            array: 0,
            begin: 1,
            length: 2,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 3, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [f] }).ok);
  for (const slots of [
    ["reference", "number", "number"],
    ["Uint16Array", "boolean", "number"],
    ["Uint16Array", "number", "optional-number"],
  ] as const)
    assert.equal(verify({ functions: [{ ...f, slots }] }).ok, false);
  assert.equal(
    verify({ functions: [{ ...f, returnType: "Uint8Array" }] }).ok,
    false,
  );
});
test("presence-bearing numeric fields validate separate tags and permit only explicit omitted arguments", () => {
  const record = {
    byteLength: 32,
    fields: [
      {
        offset: 24,
        presenceOffset: 16,
        type: "optional-number" as const,
        mutable: true,
      },
    ],
  };
  const fn: FunctionIR = {
    id: 0,
    name: "make",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          {
            kind: "record-new",
            id: 0,
            record: 0,
            arguments: [undefined],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  assert.ok(verify({ records: [record], functions: [fn] }).ok);
  for (const presenceOffset of [0, 7, 24, 31, 32, 40, -1, 1.5])
    assert.equal(
      verify({
        records: [
          { ...record, fields: [{ ...record.fields[0]!, presenceOffset }] },
        ],
        functions: [],
      }).ok,
      false,
      String(presenceOffset),
    );
  assert.equal(
    verify({
      records: [
        {
          ...record,
          fields: [{ offset: 24, type: "optional-number", mutable: true }],
        },
      ],
      functions: [fn],
    }).ok,
    false,
  );
  assert.equal(
    verify({
      records: [
        { ...record, fields: [{ ...record.fields[0]!, type: "reference" }] },
      ],
      functions: [],
    }).ok,
    false,
  );
});
test("optional references have explicit none, wrap and checked extraction operations", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "optional",
    exported: true,
    parameters: [0],
    slots: ["reference"],
    returnType: "optional-reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "reference-wrap", id: 1, value: 0, ...span },
          { kind: "reference-none", id: 2, ...span },
          {
            kind: "binary",
            id: 3,
            operator: "!==",
            left: 1,
            right: 2,
            ...span,
          },
          { kind: "reference-value", id: 4, value: 1, ...span },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [fn] }).ok);
  assert.equal(verify({ functions: [{ ...fn, slots: ["number"] }] }).ok, false);
  assert.equal(
    verify({ functions: [{ ...fn, returnType: "reference" }] }).ok,
    false,
  );
});

test("optional strings keep a distinct encoding and explicit presence/extraction operations", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "optionalText",
    exported: true,
    parameters: [0],
    slots: ["string"],
    returnType: "optional-string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "string-wrap", id: 1, value: 0, ...span },
          { kind: "string-none", id: 2, ...span },
          { kind: "string-present", id: 3, value: 1, ...span },
          { kind: "string-value", id: 4, value: 1, ...span },
          {
            kind: "binary",
            id: 5,
            operator: "===",
            left: 1,
            right: 2,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [fn] }).ok);
  assert.ok(!verify({ functions: [{ ...fn, slots: ["reference"] }] }).ok);
  assert.ok(
    !verify({ functions: [{ ...fn, returnType: "optional-reference" }] }).ok,
  );
});

test("managed function values and indirect calls verify their ABI witness and operands", () => {
  const target = fn([good]);
  const caller: FunctionIR = {
    ...fn([good]),
    id: 1,
    name: "caller",
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "function-new", id: 0, target: 0, ...span },
          { kind: "constant", id: 1, value: 7, ...span },
          {
            kind: "call-indirect",
            id: 2,
            target: 0,
            callee: 0,
            arguments: [1],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
  const checked = verify({ functions: [target, caller] });
  assert.ok(checked.ok, JSON.stringify(checked));
  for (const instructions of [
    [{ kind: "function-new", id: 0, target: 99, ...span }],
    [
      { kind: "constant", id: 0, value: 7, ...span },
      {
        kind: "call-indirect",
        id: 2,
        target: 0,
        callee: 0,
        arguments: [0],
        ...span,
      },
    ],
    [
      { kind: "function-new", id: 0, target: 0, ...span },
      {
        kind: "call-indirect",
        id: 2,
        target: 0,
        callee: 0,
        arguments: [],
        ...span,
      },
    ],
  ] as const)
    assert.ok(
      !verify({
        functions: [
          target,
          { ...caller, blocks: [{ ...caller.blocks[0]!, instructions }] },
        ],
      }).ok,
    );
  assert.ok(
    !verify({
      functions: [
        { ...target, environment: { byteLength: 32, cells: [] } },
        caller,
      ],
    }).ok,
  );
});

test("owned closure environments and managed record cells verify their storage contracts", async () => {
  const { ownedClosureFixture } =
    await import("../../../tools/owned-closure-fixture.ts");
  const module = ownedClosureFixture();
  const result = verify(module);
  assert.ok(result.ok, JSON.stringify(result));
  const counter = module.functions[0]!;
  for (const closureEnvironment of [99, -1])
    assert.ok(
      !verify({
        ...module,
        functions: [
          { ...counter, closureEnvironment },
          ...module.functions.slice(1),
        ],
      }).ok,
    );
  assert.ok(
    !verify({
      ...module,
      records: [
        {
          byteLength: 32,
          fields: [{ offset: 24, type: "number", mutable: true }],
        },
        module.records![1]!,
      ],
    }).ok,
  );
});

test("managed cell guards cannot be bypassed or initialize failure-edge slots", async () => {
  const { ownedClosureFixture } =
    await import("../../../tools/owned-closure-fixture.ts");
  const module = ownedClosureFixture();
  const bypass = {
    ...module,
    functions: module.functions.map((fn) => ({
      ...fn,
      blocks: fn.blocks.map((block) => ({
        ...block,
        terminator:
          block.terminator.kind === "record-cell"
            ? {
                ...block.terminator,
                kind: "record" as const,
                operation: "read" as const,
              }
            : block.terminator,
      })),
    })),
  };
  assert.ok(!verify(bypass).ok);
  const failure = {
    ...module,
    functions: module.functions.map((fn) =>
      fn.id !== 0
        ? fn
        : {
            ...fn,
            blocks: fn.blocks.map((block) =>
              block.id !== 4
                ? block
                : {
                    ...block,
                    instructions: [
                      { kind: "load" as const, id: 10, slot: 2, ...span },
                    ],
                    terminator: { kind: "return" as const, value: 10, ...span },
                  },
            ),
          },
    ),
  };
  const checked = verify(failure);
  assert.ok(!checked.ok);
  assert.equal(checked.error.code, "INITIALIZATION");
  assert.ok(
    !verify({
      ...module,
      records: module.records!.map((r, i) =>
        i !== 0
          ? r
          : {
              ...r,
              fields: r.fields.map((f) => ({ ...f, presenceOffset: 17 })),
            },
      ),
    }).ok,
  );
});

test("string construction requires defined numeric code-unit operands", () => {
  const make = (values: readonly number[]): FunctionIR => ({
    id: 0,
    name: "text",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "string-from-code-units", id: 1, values, ...span },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  });
  assert.ok(verify({ functions: [make([])] }).ok);
  assert.ok(verify({ functions: [make([0, 0])] }).ok);
  assert.equal(verify({ functions: [make([2])] }).ok, false);
  for (const type of ["boolean", "string", "optional-number"] as const)
    assert.equal(
      verify({ functions: [{ ...make([0]), slots: [type] }] }).ok,
      false,
    );
});

test("boolean-number conversion requires a boolean operand", () => {
  for (const value of [false, true, 0, 1]) {
    const body = fn([
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value, ...span },
          {
            kind: "unary",
            id: 1,
            operator: "boolean-number",
            operand: 0,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ]);
    assert.equal(verify({ functions: [body] }).ok, typeof value === "boolean");
  }
});

test("rejects holes in record and field declarations as graph diagnostics", () => {
  const records = [
    {
      byteLength: 32,
      fields: [{ type: "number" as const, offset: 16, mutable: true }],
    },
  ];
  delete records[0];
  assert.equal(verify({ functions: [fn([good])], records }).ok, false);
  const fields = [{ type: "number" as const, offset: 16, mutable: true }];
  delete fields[0];
  assert.equal(
    verify({ functions: [fn([good])], records: [{ byteLength: 32, fields }] })
      .ok,
    false,
  );
});

test("rejects holes in function slots, parameters and environment cells", () => {
  const slots = ["number" as const];
  delete slots[0];
  assert.equal(verify({ functions: [{ ...fn([good]), slots }] }).ok, false);
  const parameters = [0];
  delete parameters[0];
  assert.equal(
    verify({ functions: [{ ...fn([good]), parameters }] }).ok,
    false,
  );
  const cells = [
    { type: "number" as const, stateOffset: 0, valueOffset: 8, mutable: true },
  ];
  delete cells[0];
  assert.equal(
    verify({
      functions: [{ ...fn([good]), environment: { byteLength: 16, cells } }],
    }).ok,
    false,
  );
});

test("instruction result IDs follow the IR operation contract", () => {
  const result = instructionResult;
  assert.equal(result({ kind: "constant", id: 0, value: 1, ...span }), 0);
  assert.equal(
    result({ kind: "call", id: undefined, target: 0, arguments: [], ...span }),
    undefined,
  );
  assert.equal(
    result({ kind: "store", slot: 0, value: 1, ...span }),
    undefined,
  );
  assert.equal(
    result({ kind: "array-write", array: 0, index: 1, value: 2, ...span }),
    undefined,
  );
});

test("large initialization graphs avoid materializing a Set entry for every block-slot pair", () => {
  const blocks: Block[] = [];
  for (let id = 0; id < 256; id++)
    blocks.push({
      id,
      instructions: [],
      terminator:
        id === 255
          ? { kind: "return", value: undefined, ...span }
          : { kind: "jump", target: id + 1, ...span },
    });
  const fn: FunctionIR = {
    id: 0,
    name: "large",
    exported: true,
    parameters: [],
    slots: Array.from({ length: 512 }, () => "number" as const),
    returnType: "void",
    entry: 0,
    blocks,
  };
  const NativeSet = globalThis.Set;
  let copiedEntries = 0;
  class CountedSet<T> extends NativeSet<T> {
    constructor(values?: Iterable<T> | null) {
      super(values);
      copiedEntries += this.size;
    }
  }
  try {
    globalThis.Set = CountedSet;
    assert.ok(verify({ functions: [fn] }).ok);
  } finally {
    globalThis.Set = NativeSet;
  }
  assert.ok(copiedEntries < 4096, `copied ${copiedEntries} set entries`);
});

test("verification indexes sparse safe-integer value IDs without linear maps", () => {
  const instructions: import("@tint/ir/scalar").Instruction[] = [
    { kind: "constant", id: Number.MAX_SAFE_INTEGER, value: 0, ...span },
  ];
  let previous = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < 200; i++) {
    instructions.push({ kind: "constant", id: i, value: i, ...span });
    instructions.push({
      kind: "binary",
      id: 1000 + i,
      operator: "+",
      left: previous,
      right: i,
      ...span,
    });
    previous = 1000 + i;
  }
  const fn: FunctionIR = {
    id: 0,
    name: "sparse",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: previous, ...span },
      },
    ],
  };
  const get = Map.prototype.get,
    has = Set.prototype.has;
  let work = 0;
  Map.prototype.get = function (key) {
    if (typeof key === "number") work += this.size;
    return get.call(this, key);
  };
  Set.prototype.has = function (key) {
    if (typeof key === "number") work += this.size;
    return has.call(this, key);
  };
  try {
    assert.ok(verify({ functions: [fn] }).ok);
  } finally {
    Map.prototype.get = get;
    Set.prototype.has = has;
  }
  assert.ok(work < 2000, `value verification linked lookup work: ${work}`);
});

test("definite-initialization matrices allocate independently of block count", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "loop",
    exported: true,
    parameters: [],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...span },
          { kind: "store", slot: 0, value: 0, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 0, ...span },
          { kind: "constant", id: 2, value: 10, ...span },
          { kind: "binary", id: 3, operator: "<", left: 1, right: 2, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...span },
          { kind: "constant", id: 5, value: 1, ...span },
          { kind: "binary", id: 6, operator: "+", left: 4, right: 5, ...span },
          { kind: "store", slot: 0, value: 6, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 7, slot: 0, ...span }],
        terminator: { kind: "return", value: 7, ...span },
      },
    ],
  };
  const original = globalThis.Uint32Array;
  let allocations = 0;
  globalThis.Uint32Array = new Proxy(original, {
    construct(target, args) {
      if (args[0] === 1) allocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    assert.ok(verify({ functions: [fn] }).ok);
    const small = allocations;
    allocations = 0;
    const expanded: FunctionIR = {
      ...fn,
      blocks: [
        ...fn.blocks.map((block) =>
          block.id === 3
            ? {
                ...block,
                terminator: { kind: "jump" as const, target: 4, ...span },
              }
            : block,
        ),
        ...Array.from({ length: 252 }, (_, index) => ({
          id: index + 4,
          instructions:
            index === 251
              ? [{ kind: "load" as const, id: 8, slot: 0, ...span }]
              : [],
          terminator:
            index === 251
              ? { kind: "return" as const, value: 8, ...span }
              : { kind: "jump" as const, target: index + 5, ...span },
        })),
      ],
    };
    const checked = verify({ functions: [expanded] });
    assert.ok(checked.ok, JSON.stringify(checked));
    // A short proof can now omit fixed-point scratch altogether. Both the
    // proved small graph and the budget-exhausting graph retain a constant cap.
    assert.ok(small <= 5, "per-slot scratch must stay bounded");
  } finally {
    globalThis.Uint32Array = original;
  }
  assert.ok(
    allocations <= 5, // Three one-word scratch vectors and two slot-compaction buffers.
    `one-word initialization buffers allocated: ${allocations}`,
  );
});

test("queued initialization agrees with a set-based fixed point on cyclic graphs", () => {
  let seed = 92831;
  function random(limit: number): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  }
  let accepted = 0;
  for (let trial = 0; trial < 120; trial++) {
    const count = 3 + random(9),
      slots = 1 + random(5);
    const parameters = Array.from({ length: random(slots + 1) }, (_, i) => i);
    const blocks: Block[] = Array.from({ length: count }, (_, id) => {
      const instructions: Block["instructions"][number][] = [
        { kind: "constant", id: id * 4, value: 42, ...span },
      ];
      if (random(2) === 0)
        instructions.push({
          kind: "store",
          slot: random(slots),
          value: id * 4,
          ...span,
        });
      instructions.push({
        kind: "load",
        id: id * 4 + 1,
        slot: random(slots),
        ...span,
      });
      if (random(2) === 0)
        instructions.push({
          kind: "store",
          slot: random(slots),
          value: id * 4,
          ...span,
        });
      instructions.push({
        kind: "constant",
        id: id * 4 + 2,
        value: true,
        ...span,
      });
      return {
        id,
        instructions,
        terminator: {
          kind: "branch",
          condition: id * 4 + 2,
          consequent: (id + 1) % count,
          alternate: random(count),
          ...span,
        },
      };
    });
    const entry = random(count);
    const fn: FunctionIR = {
      id: 0,
      name: "cyclic",
      exported: true,
      parameters,
      slots: Array.from({ length: slots }, () => "number" as const),
      returnType: "number",
      entry,
      blocks,
    };
    const predecessors = blocks.map(() => new Set<number>());
    for (const block of blocks) {
      const term = block.terminator;
      if (term.kind === "branch") {
        predecessors[term.consequent]!.add(block.id);
        predecessors[term.alternate]!.add(block.id);
      }
    }
    const universe = Array.from({ length: slots }, (_, i) => i);
    const outputs = blocks.map(() => new Set(universe));
    function incoming(id: number): Set<number> {
      const result = new Set(id === entry ? parameters : universe);
      for (const pred of predecessors[id]!)
        for (const slot of [...result])
          if (!outputs[pred]!.has(slot)) result.delete(slot);
      return result;
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const block of blocks) {
        const result = incoming(block.id);
        for (const op of block.instructions)
          if (op.kind === "store") result.add(op.slot);
        if (
          result.size !== outputs[block.id]!.size ||
          [...result].some((slot) => !outputs[block.id]!.has(slot))
        )
          changed = true;
        outputs[block.id] = result;
      }
    }
    let expected = true;
    for (const block of blocks) {
      const initialized = incoming(block.id);
      for (const op of block.instructions) {
        if (op.kind === "load" && !initialized.has(op.slot)) expected = false;
        if (op.kind === "store") initialized.add(op.slot);
      }
    }
    if (expected) accepted++;
    const actual = verify({ functions: [fn] });
    assert.ok(
      actual.ok === expected,
      `trial ${trial}: ${JSON.stringify(actual)}`,
    );
  }
  assert.ok(accepted > 0 && accepted < 120);
});

test("unchanged exceptional facts do not repeatedly schedule a high-fan-in handler", () => {
  const count = 160;
  let reads = 0;
  const blocks: Block[] = Array.from({ length: count }, (_, id) => ({
    id,
    ...(id === count - 1 ? {} : { exception: { target: count - 1, slot: 0 } }),
    instructions:
      id === 0
        ? [{ kind: "load", id: 0, slot: 1, ...span }]
        : id === count - 1
          ? [{ kind: "constant", id: 1, value: 0, ...span }]
          : [],
    terminator:
      id === 0 || id === count - 1
        ? { kind: "return", value: id === 0 ? 0 : 1, ...span }
        : { kind: "jump", target: id - 1, ...span },
  }));
  const observed = new Proxy(blocks, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const result = verify({
    functions: [
      {
        id: 0,
        name: "fanIn",
        exported: true,
        parameters: [],
        slots: ["general", "number"],
        returnType: "number",
        entry: count - 2,
        blocks: observed,
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "INITIALIZATION");
  assert.ok(reads < count * 60, `block reads: ${reads}`);
});

test("a shared normal and exceptional target intersects both incoming states", () => {
  const result = verify({
    functions: [
      {
        id: 0,
        name: "sharedTarget",
        exported: true,
        parameters: [],
        slots: ["general", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            exception: { target: 1, slot: 0 },
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 0, slot: 1, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "INITIALIZATION");
});

test("bulk typed-array copy requires matching element encodings and a numeric offset", () => {
  for (const source of [
    "Uint8Array",
    "Uint16Array",
    "Float64Array",
    "number",
  ] as const) {
    for (const offset of ["number", "boolean"] as const) {
      const result = verify({
        functions: [
          {
            id: 0,
            name: "copy",
            exported: true,
            parameters: [0, 1, 2],
            slots: ["Uint8Array", source, offset],
            returnType: "boolean",
            entry: 0,
            blocks: [
              {
                id: 0,
                instructions: [
                  { kind: "load", id: 0, slot: 0, ...span },
                  { kind: "load", id: 1, slot: 1, ...span },
                  { kind: "load", id: 2, slot: 2, ...span },
                  {
                    kind: "array-copy",
                    id: 3,
                    array: 0,
                    source: 1,
                    offset: 2,
                    ...span,
                  },
                ],
                terminator: { kind: "return", value: 3, ...span },
              },
            ],
          },
        ],
      });
      assert.equal(
        result.ok,
        source === "Uint8Array" && offset === "number",
        JSON.stringify(result),
      );
    }
  }
});

test("locally established initialization needs no fixed-point bit matrices", () => {
  const original = Uint32Array.prototype.fill;
  let fills = 0;
  Uint32Array.prototype.fill = function (value, start, end) {
    if (value === 0xffffffff) fills++;
    return original.call(this, value, start, end);
  };
  try {
    const result = verify({
      functions: [
        {
          id: 0,
          name: "local",
          exported: true,
          parameters: [],
          slots: ["number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "constant", id: 0, value: 42, ...span },
                { kind: "store", slot: 0, value: 0, ...span },
                { kind: "load", id: 1, slot: 0, ...span },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(fills, 0, "local proof must bypass dataflow matrices");
  } finally {
    Uint32Array.prototype.fill = original;
  }
});

test("activation reads name a record except top and an index only for actuals", () => {
  const read = (
    instructions: FunctionIR["blocks"][number]["instructions"],
    returned: number,
    returnType: FunctionIR["returnType"],
  ) =>
    verify({
      functions: [
        {
          id: 0,
          name: "activation",
          exported: true,
          parameters: [0],
          slots: ["number"],
          returnType,
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions,
              terminator: { kind: "return", value: returned, ...span },
            },
          ],
        },
      ],
    });
  const record = { kind: "load", id: 0, slot: 0, ...span } as const;
  assert.equal(
    read(
      [{ kind: "activation-read", id: 1, field: "top", ...span }],
      1,
      "number",
    ).ok,
    true,
  );
  assert.equal(
    read(
      [
        record,
        { kind: "activation-read", id: 1, field: "callee", record: 0, ...span },
      ],
      1,
      "general",
    ).ok,
    true,
  );
  assert.equal(
    read(
      [record, { kind: "activation-read", id: 1, field: "previous", ...span }],
      1,
      "number",
    ).ok,
    false,
  );
  assert.equal(
    read(
      [
        record,
        {
          kind: "activation-read",
          id: 1,
          field: "count",
          record: 0,
          index: 0,
          ...span,
        },
      ],
      1,
      "number",
    ).ok,
    false,
  );
  assert.equal(
    read(
      [
        record,
        {
          kind: "activation-read",
          id: 1,
          field: "argument",
          record: 0,
          index: 0,
          ...span,
        },
      ],
      1,
      "general",
    ).ok,
    true,
  );
});

test("a tail call is a script entry's returned last call", () => {
  const entry = (
    id: number,
    instructions: FunctionIR["blocks"][number]["instructions"],
    returned: number,
  ): FunctionIR => ({
    id,
    name: "entry" + id,
    exported: false,
    scriptEntry: true,
    parameters: [0, 1, 2, 3],
    slots: ["general", "general", "general", "optional-reference"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: returned, ...span },
      },
    ],
  });
  const module = (returned: number) => ({
    functions: [
      entry(0, [{ kind: "load", id: 0, slot: 0, ...span }], 0),
      entry(
        1,
        [
          { kind: "function-new", id: 0, target: 0, ...span },
          { kind: "general-none", id: 1, ...span },
          { kind: "reference-none", id: 2, ...span },
          {
            kind: "call-indirect",
            id: 3,
            target: 0,
            callee: 0,
            arguments: [1, 1, 1, 2],
            scriptArguments: [],
            tail: true,
            ...span,
          },
        ],
        returned,
      ),
    ],
  });
  assert.deepEqual(verify(module(3)), { ok: true });
  const other = verify(module(1));
  assert.ok(
    !other.ok && other.error.message.includes("tail call"),
    JSON.stringify(other),
  );
});

test("property loads verify every entry of their site layout", () => {
  // Object record 1 (shape, one value), epoch record 3, and site record 2
  // with four inherited entries (shape, word index, general value) then the
  // epoch, its record, and stringShape.
  const siteFields: RecordField[] = [];
  for (let entry = 0; entry < 4; entry++)
    siteFields.push(
      { offset: 8 + entry * 32, type: "reference", mutable: true },
      { offset: 16 + entry * 32, type: "number", mutable: true },
      { offset: 24 + entry * 32, type: "general", mutable: true },
    );
  siteFields.push(
    { offset: 136, type: "number", mutable: true },
    { offset: 144, type: "reference", mutable: false },
    { offset: 152, type: "reference", mutable: false },
  );
  const records: RecordLayout[] = [
    { byteLength: 16, fields: [] },
    {
      byteLength: 32,
      fields: [
        { offset: 8, type: "optional-reference", mutable: true },
        { offset: 16, type: "general", mutable: true },
      ],
    },
    { byteLength: 160, fields: siteFields },
    { byteLength: 16, fields: [{ offset: 8, type: "number", mutable: true }] },
  ];
  const load = (
    entries: number,
    inherited: boolean,
    siteField: number = 0,
  ): ModuleIR => ({
    records,
    functions: [
      {
        id: 0,
        name: "read",
        exported: true,
        parameters: [0, 1],
        slots: ["general", "reference"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              {
                kind: "property-load",
                id: 2,
                object: 0,
                site: 1,
                record: 1,
                field: 1,
                count: 1,
                siteRecord: 2,
                siteField,
                inherited,
                entries,
                epochRecord: 3,
                epochField: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  });
  assert.equal(verify(load(4, true)).ok, true);
  assert.equal(verify(load(1, true, 9)).ok, true);
  // Five entries run past the layout; zero is no cache.
  assert.equal(verify(load(5, true)).ok, false);
  assert.equal(verify(load(0, true)).ok, false);
  // Own entries take two fields each: the third field is a holder, not a
  // shape, so a two-entry own load over this layout is rejected.
  assert.equal(verify(load(1, false)).ok, true);
  assert.equal(verify(load(2, false)).ok, false);
});

test("element access requires an elements reference with a number count and Float64Array storage", () => {
  function module(
    elementsType: "optional-reference" | "number",
    countType: "number" | "general",
    storageType: "Float64Array" | "reference",
    indexType: "number" | "general",
    store: boolean,
  ) {
    const instructions: Block["instructions"][number][] = [
      { kind: "load", id: 0, slot: 0, ...span },
      { kind: "load", id: 1, slot: 1, ...span },
    ];
    const layout = {
      record: 0,
      field: 1,
      elementsRecord: 1,
      countField: 0,
      storageField: 1,
    };
    instructions.push(
      store
        ? {
            kind: "element-store",
            id: 2,
            object: 0,
            index: 1,
            value: 0,
            ...layout,
            ...span,
          }
        : {
            kind: "element-load",
            id: 2,
            object: 0,
            index: 1,
            ...layout,
            ...span,
          },
    );
    return verify({
      functions: [
        {
          id: 0,
          name: "element",
          exported: true,
          parameters: [0, 1],
          slots: ["general", indexType],
          returnType: store ? "boolean" : "general",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions,
              terminator: { kind: "return", value: 2, ...span },
            },
          ],
        },
      ],
      records: [
        {
          byteLength: 24,
          fields: [
            { offset: 8, type: "optional-reference", mutable: true },
            { offset: 16, type: elementsType, mutable: true },
          ],
        },
        {
          byteLength: 32,
          fields: [
            {
              offset: 8,
              type: countType,
              mutable: true,
            },
            {
              offset: countType === "general" ? 24 : 16,
              type: storageType,
              mutable: true,
            },
          ],
        },
      ],
    });
  }
  for (const store of [false, true]) {
    const valid = module(
      "optional-reference",
      "number",
      "Float64Array",
      "number",
      store,
    );
    assert.ok(valid.ok, JSON.stringify(valid));
    assert.equal(
      module("number", "number", "Float64Array", "number", store).ok,
      false,
    );
    assert.equal(
      module("optional-reference", "general", "Float64Array", "number", store)
        .ok,
      false,
    );
    assert.equal(
      module("optional-reference", "number", "reference", "number", store).ok,
      false,
    );
    assert.equal(
      module("optional-reference", "number", "Float64Array", "general", store)
        .ok,
      false,
    );
  }

  function lengthModule(
    elementsType: "optional-reference" | "number",
    lengthType: "number" | "general",
    objectType: "general" | "reference",
  ) {
    return verify({
      functions: [
        {
          id: 0,
          name: "length",
          exported: true,
          parameters: [0],
          slots: [objectType],
          returnType: "general",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                {
                  kind: "element-length",
                  id: 1,
                  object: 0,
                  record: 0,
                  field: 1,
                  elementsRecord: 1,
                  lengthField: 0,
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
      records: [
        {
          byteLength: 24,
          fields: [
            { offset: 8, type: "optional-reference", mutable: true },
            { offset: 16, type: elementsType, mutable: true },
          ],
        },
        {
          byteLength: 24,
          fields: [{ offset: 8, type: lengthType, mutable: true }],
        },
      ],
    });
  }
  const validLength = lengthModule("optional-reference", "number", "general");
  assert.ok(validLength.ok, JSON.stringify(validLength));
  assert.equal(lengthModule("number", "number", "general").ok, false);
  assert.equal(
    lengthModule("optional-reference", "general", "general").ok,
    false,
  );
  assert.equal(
    lengthModule("optional-reference", "number", "reference").ok,
    false,
  );

  function cachedModule(
    storageType: "optional-reference" | "reference",
    countType: "number" | "boolean",
    includeCount: boolean,
    store: boolean,
  ) {
    const layout = {
      record: 0,
      field: 1,
      elementsRecord: 1,
      countField: 0,
      storageField: 1,
    };
    const instructions: Block["instructions"][number][] = [
      { kind: "load", id: 0, slot: 0, ...span },
      { kind: "load", id: 1, slot: 1, ...span },
      { kind: "load", id: 2, slot: 2, ...span },
      { kind: "load", id: 3, slot: 3, ...span },
      store
        ? {
            kind: "element-store",
            id: 4,
            object: 0,
            index: 1,
            value: 0,
            ...layout,
            cachedStorage: 2,
            ...(includeCount ? { cachedCount: 3 } : {}),
            ...span,
          }
        : {
            kind: "element-load",
            id: 4,
            object: 0,
            index: 1,
            ...layout,
            cachedStorage: 2,
            ...(includeCount ? { cachedCount: 3 } : {}),
            ...span,
          },
    ];
    return verify({
      functions: [
        {
          id: 0,
          name: "cachedElement",
          exported: true,
          parameters: [0, 1, 2, 3],
          slots: ["general", "number", storageType, countType],
          returnType: store ? "boolean" : "general",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions,
              terminator: { kind: "return", value: 4, ...span },
            },
          ],
        },
      ],
      records: [
        {
          byteLength: 24,
          fields: [
            { offset: 8, type: "optional-reference", mutable: true },
            { offset: 16, type: "optional-reference", mutable: true },
          ],
        },
        {
          byteLength: 32,
          fields: [
            { offset: 8, type: "number", mutable: true },
            { offset: 16, type: "Float64Array", mutable: true },
          ],
        },
      ],
    });
  }
  for (const store of [false, true]) {
    const ok = cachedModule("optional-reference", "number", true, store);
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.equal(cachedModule("reference", "number", true, store).ok, false);
    assert.equal(
      cachedModule("optional-reference", "boolean", true, store).ok,
      false,
    );
    assert.equal(
      cachedModule("optional-reference", "number", false, store).ok,
      false,
    );
  }
  const cacheReads = verify({
    functions: [
      {
        id: 0,
        name: "cacheReads",
        exported: true,
        parameters: [0],
        slots: ["general", "optional-reference"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              {
                kind: "element-storage",
                id: 1,
                object: 0,
                record: 0,
                field: 1,
                elementsRecord: 1,
                countField: 0,
                storageField: 1,
                ...span,
              },
              { kind: "store", slot: 1, value: 1, ...span },
              {
                kind: "element-count",
                id: 2,
                object: 0,
                record: 0,
                field: 1,
                elementsRecord: 1,
                countField: 0,
                storageField: 1,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
    records: [
      {
        byteLength: 24,
        fields: [
          { offset: 8, type: "optional-reference", mutable: true },
          { offset: 16, type: "optional-reference", mutable: true },
        ],
      },
      {
        byteLength: 32,
        fields: [
          { offset: 8, type: "number", mutable: true },
          { offset: 16, type: "Float64Array", mutable: true },
        ],
      },
    ],
  });
  assert.ok(cacheReads.ok, JSON.stringify(cacheReads));
});

test("general-element, general-slot, and polymorphic property-store instructions verify layouts and operands", () => {
  const generalRecords: readonly RecordLayout[] = [
    // 0: Object with internalArrayElements at field 0
    {
      byteLength: 16,
      fields: [{ offset: 8, type: "optional-reference", mutable: true }],
    },
    // 1: ArrayElements with generalCount, generalTags, generalRefs, numbers
    {
      byteLength: 40,
      fields: [
        { offset: 8, type: "number", mutable: true },
        { offset: 16, type: "Uint8Array", mutable: true },
        { offset: 24, type: "reference", mutable: true },
        { offset: 32, type: "Float64Array", mutable: true },
      ],
    },
  ];
  const validGeneral = verify({
    records: generalRecords,
    functions: [
      {
        id: 0,
        name: "generalElements",
        exported: true,
        parameters: [0, 1, 2, 3, 4, 5],
        slots: [
          "general",
          "number",
          "general",
          "Uint8Array",
          "reference",
          "Float64Array",
        ],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "load", id: 2, slot: 2, ...span },
              { kind: "load", id: 3, slot: 3, ...span },
              { kind: "load", id: 4, slot: 4, ...span },
              { kind: "load", id: 5, slot: 5, ...span },
              {
                kind: "general-element-load",
                id: 6,
                object: 0,
                index: 1,
                record: 0,
                field: 0,
                elementsRecord: 1,
                countField: 0,
                tagsField: 1,
                refsField: 2,
                numbersField: 3,
                ...span,
              },
              {
                kind: "general-element-store",
                id: 7,
                object: 0,
                index: 1,
                value: 6,
                record: 0,
                field: 0,
                elementsRecord: 1,
                countField: 0,
                tagsField: 1,
                refsField: 2,
                numbersField: 3,
                ...span,
              },
              {
                kind: "general-slot-load",
                id: 8,
                tags: 3,
                refs: 4,
                numbers: 5,
                index: 1,
                ...span,
              },
              {
                kind: "general-slot-store",
                id: 9,
                tags: 3,
                refs: 4,
                numbers: 5,
                index: 1,
                value: 8,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 9, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(validGeneral.ok, JSON.stringify(validGeneral));

  // Invalid tags operand type on general-slot-load must fail verification.
  const badSlotLoad = verify({
    functions: [
      {
        id: 0,
        name: "badSlotLoad",
        exported: true,
        parameters: [0, 1, 2, 3],
        slots: ["number", "reference", "optional-reference", "number"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "load", id: 2, slot: 2, ...span },
              { kind: "load", id: 3, slot: 3, ...span },
              {
                kind: "general-slot-load",
                id: 4,
                tags: 0,
                refs: 1,
                numbers: 2,
                index: 3,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  });
  assert.equal(badSlotLoad.ok, false);

  // Polymorphic property-store with entries: 4 requires 4x(shape, slot, transition, epoch) + shared epoch.
  function storeSiteRecord(entryCount: number): RecordLayout {
    const fields: RecordField[] = [];
    let offset = 8;
    for (let i = 0; i < entryCount; i++) {
      fields.push({ offset, type: "reference", mutable: true });
      offset += 8;
      fields.push({ offset, type: "number", mutable: true });
      offset += 8;
      fields.push({ offset, type: "optional-reference", mutable: true });
      offset += 8;
      fields.push({ offset, type: "number", mutable: true });
      offset += 8;
    }
    fields.push({ offset, type: "reference", mutable: true });
    offset += 8;
    return { byteLength: offset, fields };
  }
  function polyStoreModule(entries: number, recordEntries: number) {
    return verify({
      records: [
        {
          byteLength: 40,
          fields: [
            { offset: 8, type: "optional-reference", mutable: true },
            { offset: 16, type: "number", mutable: true },
            { offset: 24, type: "general", mutable: true },
          ],
        },
        storeSiteRecord(recordEntries),
        {
          byteLength: 16,
          fields: [{ offset: 8, type: "number", mutable: true }],
        },
      ],
      functions: [
        {
          id: 0,
          name: "polyStore",
          exported: true,
          parameters: [0, 1, 2],
          slots: ["general", "reference", "general"],
          returnType: "boolean",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "load", id: 1, slot: 1, ...span },
                { kind: "load", id: 2, slot: 2, ...span },
                {
                  kind: "property-store",
                  id: 3,
                  object: 0,
                  site: 1,
                  value: 2,
                  record: 0,
                  field: 2,
                  count: 1,
                  siteRecord: 1,
                  siteField: 0,
                  entries,
                  epochRecord: 2,
                  epochField: 0,
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 3, ...span },
            },
          ],
        },
      ],
    });
  }
  const okPoly = polyStoreModule(4, 4);
  assert.ok(okPoly.ok, JSON.stringify(okPoly));
  assert.equal(polyStoreModule(4, 1).ok, false);
  assert.equal(polyStoreModule(0, 1).ok, false);
});
