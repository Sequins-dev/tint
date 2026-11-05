import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import { optimizeModule } from "../src/optimization/index.ts";
const span = { start: 0, end: 1 };
function fixture(escape = false): ModuleIR {
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ type: "number", mutable: true, offset: 16 }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "local",
        exported: true,
        parameters: [],
        slots: ["reference", "number"],
        returnType: escape ? "reference" : "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
              { kind: "store", slot: 0, value: 1, ...span },
              { kind: "load", id: 2, slot: 0, ...span },
            ],
            terminator: {
              kind: "record",
              object: 2,
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
              { kind: "load", id: 3, slot: escape ? 0 : 1, ...span },
            ],
            terminator: { kind: "return", value: 3, ...span },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    ],
  };
}
test("non-escaping fixed records become scalar locals", () => {
  const input = fixture();
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok, JSON.stringify(verify(output.module)));
  assert.equal(
    output.module.functions[0]!.blocks.flatMap((b) => b.instructions).filter(
      (i) => i.kind === "record-new",
    ).length,
    0,
  );
  assert.ok(
    output.passes.some(
      (p) => p.pass === "scalar-replace-records" && p.rewritten === 1,
    ),
  );
  assert.equal(
    input.functions[0]!.blocks[0]!.instructions[1]!.kind,
    "record-new",
  );
});
test("returned records remain heap allocated", () => {
  const input = fixture(true);
  assert.ok(verify(input).ok);
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok);
  assert.equal(
    output.module.functions[0]!.blocks[0]!.instructions.filter(
      (i) => i.kind === "record-new",
    ).length,
    1,
  );
});

test("forwarded copies prove overwritten parameter slots and duplicate stores local", () => {
  const base = fixture();
  const fn = base.functions[0]!;
  for (const variant of [
    { ...fn, parameters: [0] },
    {
      ...fn,
      blocks: fn.blocks.map((b) =>
        b.id !== 0
          ? b
          : {
              ...b,
              instructions: [
                ...b.instructions,
                { kind: "store" as const, slot: 0, value: 1, ...span },
              ],
            },
      ),
    },
  ]) {
    const input: ModuleIR = { ...base, functions: [variant] };
    assert.ok(verify(input).ok, JSON.stringify(verify(input)));
    const output = optimizeModule(input);
    assert.ok(verify(output.module).ok, JSON.stringify(verify(output.module)));
    assert.equal(
      output.module.functions[0]!.blocks.some((b) =>
        b.instructions.some((i) => i.kind === "record-new"),
      ),
      false,
    );
  }
});

test("an object used as another object's field is not scalar replaced", () => {
  const base = fixture();
  const fn = base.functions[0]!;
  const input: ModuleIR = {
    ...base,
    records: [
      ...base.records!,
      {
        byteLength: 32,
        fields: [{ type: "reference", mutable: true, offset: 16 }],
      },
    ],
    functions: [
      {
        ...fn,
        blocks: fn.blocks.map((b) =>
          b.id !== 0
            ? b
            : {
                ...b,
                instructions: [
                  ...b.instructions,
                  {
                    kind: "record-new",
                    id: 10,
                    record: 1,
                    arguments: [2],
                    ...span,
                  },
                ],
              },
        ),
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok);
  assert.equal(
    output.module.functions[0]!.blocks[0]!.instructions.filter(
      (i) => i.kind === "record-new",
    ).length,
    2,
  );
});

test("inliner budget exhaustion retains completed scalar replacement", () => {
  const input = fixture();
  const full = optimizeModule(input);
  const index = full.passes.findIndex(
    (p) => p.pass === "inline-small-functions",
  );
  const work = full.passes
    .slice(0, index + 1)
    .reduce((n, p) => n + p.visited, 0);
  const limited = optimizeModule(input, work - 1);
  assert.equal(limited.budgetExhausted, true);
  assert.notEqual(limited.module, input);
  assert.deepEqual(limited.passes.slice(0, index), full.passes.slice(0, index));
  assert.equal(limited.passes.at(-1)?.pass, "inline-small-functions");
  assert.ok(
    limited.module.functions[0]!.blocks.every((block) =>
      block.instructions.every((op) => op.kind !== "record-new"),
    ),
  );
  assert.ok(verify(limited.module).ok);
});

test("loop-local records are scalar replaced when each alias follows its allocation", () => {
  const base = fixture(),
    fn = base.functions[0]!;
  const input: ModuleIR = {
    ...base,
    functions: [
      {
        ...fn,
        entry: 3,
        parameters: [2],
        slots: [...fn.slots, "boolean"],
        blocks: [
          fn.blocks[0]!,
          {
            id: 1,
            instructions: [{ kind: "load", id: 4, slot: 2, ...span }],
            terminator: {
              kind: "branch",
              condition: 4,
              consequent: 0,
              alternate: 4,
              ...span,
            },
          },
          fn.blocks[2]!,
          {
            id: 3,
            instructions: [],
            terminator: { kind: "jump", target: 0, ...span },
          },
          {
            id: 4,
            instructions: [{ kind: "load", id: 5, slot: 1, ...span }],
            terminator: { kind: "return", value: 5, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok, JSON.stringify(verify(output.module)));
  assert.equal(
    output.module.functions[0]!.blocks.flatMap((b) => b.instructions).filter(
      (i) => i.kind === "record-new",
    ).length,
    0,
  );
});

test("an alias read before its next loop assignment keeps distinct heap objects", () => {
  const base = fixture(),
    fn = base.functions[0]!;
  const input: ModuleIR = {
    ...base,
    functions: [
      {
        ...fn,
        entry: 3,
        parameters: [0, 2],
        slots: [...fn.slots, "boolean"],
        blocks: [
          {
            ...fn.blocks[0]!,
            instructions: [
              { kind: "load", id: 10, slot: 0, ...span },
              ...fn.blocks[0]!.instructions,
            ],
            terminator: {
              ...fn.blocks[0]!.terminator,
              kind: "record",
              object: 10,
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
            instructions: [{ kind: "load", id: 4, slot: 2, ...span }],
            terminator: {
              kind: "branch",
              condition: 4,
              consequent: 0,
              alternate: 4,
              ...span,
            },
          },
          fn.blocks[2]!,
          {
            id: 3,
            instructions: [],
            terminator: { kind: "jump", target: 0, ...span },
          },
          {
            id: 4,
            instructions: [{ kind: "load", id: 5, slot: 1, ...span }],
            terminator: { kind: "return", value: 5, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok, JSON.stringify(verify(output.module)));
  assert.equal(
    output.module.functions[0]!.blocks.flatMap((b) => b.instructions).filter(
      (i) => i.kind === "record-new",
    ).length,
    1,
  );
});

test("an observed parameter identity keeps a new record on the heap", () => {
  const base = fixture(),
    fn = base.functions[0]!;
  const input: ModuleIR = {
    ...base,
    functions: [
      {
        ...fn,
        parameters: [0],
        returnType: "boolean",
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 42, ...span },
              { kind: "record-new", id: 2, record: 0, arguments: [1], ...span },
              {
                kind: "binary",
                id: 3,
                operator: "===",
                left: 0,
                right: 2,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 3, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok, JSON.stringify(verify(output.module)));
  assert.ok(
    output.module.functions[0]!.blocks[0]!.instructions.some(
      (op) => op.kind === "record-new",
    ),
  );
});
