import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import {
  devirtualizeClosureCalls,
  optimizeModule,
} from "../src/optimization/index.ts";
import { pruneUnallocatedRecords } from "../src/optimization/unallocated-records.ts";
import { scalarizeLoopRecords } from "../src/optimization/loop-records.ts";
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

test("non-escaping record-cell fields scalarize init, read and write", () => {
  const input: ModuleIR = {
    records: [
      {
        byteLength: 24,
        fields: [{ type: "number", mutable: true, offset: 8, stateOffset: 16 }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "cellLocal",
        exported: true,
        parameters: [],
        slots: ["reference", "number"],
        returnType: "number",
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
              { kind: "store", slot: 0, value: 0, ...span },
              { kind: "constant", id: 1, value: 10, ...span },
              { kind: "store", slot: 1, value: 1, ...span },
              { kind: "load", id: 2, slot: 0, ...span },
            ],
            terminator: {
              kind: "record-cell",
              object: 2,
              record: 0,
              field: 0,
              operation: "initialize",
              slot: 1,
              consequent: 1,
              alternate: 4,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "constant", id: 3, value: 42, ...span },
              { kind: "store", slot: 1, value: 3, ...span },
              { kind: "load", id: 4, slot: 0, ...span },
            ],
            terminator: {
              kind: "record-cell",
              object: 4,
              record: 0,
              field: 0,
              operation: "write",
              slot: 1,
              consequent: 2,
              alternate: 4,
              ...span,
            },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 5, slot: 0, ...span }],
            terminator: {
              kind: "record-cell",
              object: 5,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 3,
              alternate: 4,
              ...span,
            },
          },
          {
            id: 3,
            instructions: [{ kind: "load", id: 6, slot: 1, ...span }],
            terminator: { kind: "return", value: 6, ...span },
          },
          { id: 4, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok, JSON.stringify(verify(output.module)));
  const fn = output.module.functions[0]!;
  assert.equal(
    fn.blocks
      .flatMap((b) => b.instructions)
      .filter((i) => i.kind === "record-new").length,
    0,
  );
  assert.equal(
    fn.blocks.filter((b) => b.terminator.kind === "record-cell").length,
    0,
  );
});

test("pruneUnallocatedRecords eliminates unallocated layouts and never-written optional fields", () => {
  const input: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [
          { type: "number", mutable: true, offset: 8 },
          {
            type: "optional-number",
            mutable: true,
            offset: 16,
            presenceOffset: 24,
          },
        ],
      },
      {
        byteLength: 16,
        fields: [{ type: "number", mutable: true, offset: 8 }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "pruneMe",
        exported: true,
        parameters: [],
        slots: ["reference", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 7, ...span },
              {
                kind: "record-new",
                id: 1,
                record: 0,
                arguments: [0, undefined],
                ...span,
              },
              { kind: "store", slot: 0, value: 1, ...span },
              { kind: "load", id: 2, slot: 0, ...span },
            ],
            // Record 1 is never allocated: jumps straight to alternate (block 2).
            terminator: {
              kind: "record",
              object: 2,
              record: 1,
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
            instructions: [{ kind: "load", id: 3, slot: 1, ...span }],
            terminator: { kind: "return", value: 3, ...span },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 4, slot: 0, ...span },
              // Field 1 of record 0 is never written: folds to false.
              {
                kind: "record-has",
                id: 5,
                object: 4,
                record: 0,
                field: 1,
                ...span,
              },
            ],
            terminator: {
              kind: "branch",
              condition: 5,
              consequent: 3,
              alternate: 4,
              ...span,
            },
          },
          {
            id: 3,
            instructions: [{ kind: "constant", id: 6, value: 99, ...span }],
            terminator: { kind: "return", value: 6, ...span },
          },
          {
            id: 4,
            instructions: [{ kind: "constant", id: 7, value: 1, ...span }],
            terminator: { kind: "return", value: 7, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const pruned = pruneUnallocatedRecords(input, 100000);
  assert.ok(pruned !== undefined && pruned.rewritten > 0);
  assert.ok(verify(pruned.module).ok, JSON.stringify(verify(pruned.module)));
  const fn = pruned.module.functions[0]!;
  assert.equal(fn.blocks[0]?.terminator.kind, "jump");
  assert.ok(
    !fn.blocks
      .flatMap((b) => b.instructions)
      .some((op) => op.kind === "record-has"),
  );
});

test("scalarizeLoopRecords hoists loop-carried allocations to conditional exit materialization", () => {
  const input: ModuleIR = {
    records: [
      {
        byteLength: 24,
        fields: [
          { type: "number", mutable: false, offset: 8 },
          { type: "number", mutable: false, offset: 16 },
        ],
      },
    ],
    functions: [
      {
        id: 0,
        name: "stepLoop",
        exported: true,
        parameters: [0],
        slots: ["number", "reference", "number", "number", "number"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 1, ...span },
              { kind: "constant", id: 1, value: 2, ...span },
              {
                kind: "record-new",
                id: 2,
                record: 0,
                arguments: [0, 1],
                ...span,
              },
              { kind: "store", slot: 1, value: 2, ...span },
              { kind: "constant", id: 3, value: 0, ...span },
              { kind: "store", slot: 2, value: 3, ...span },
            ],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 4, slot: 2, ...span },
              { kind: "load", id: 5, slot: 0, ...span },
              {
                kind: "binary",
                id: 6,
                operator: "<",
                left: 4,
                right: 5,
                ...span,
              },
            ],
            terminator: {
              kind: "branch",
              condition: 6,
              consequent: 2,
              alternate: 5,
              ...span,
            },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 7, slot: 1, ...span }],
            terminator: {
              kind: "record",
              object: 7,
              record: 0,
              field: 0,
              operation: "read",
              slot: 3,
              consequent: 3,
              alternate: 6,
              ...span,
            },
          },
          {
            id: 3,
            instructions: [{ kind: "load", id: 8, slot: 1, ...span }],
            terminator: {
              kind: "record",
              object: 8,
              record: 0,
              field: 1,
              operation: "read",
              slot: 4,
              consequent: 4,
              alternate: 6,
              ...span,
            },
          },
          {
            id: 4,
            instructions: [
              { kind: "load", id: 9, slot: 3, ...span },
              { kind: "constant", id: 10, value: 1, ...span },
              {
                kind: "binary",
                id: 11,
                operator: "+",
                left: 9,
                right: 10,
                ...span,
              },
              { kind: "load", id: 12, slot: 4, ...span },
              {
                kind: "binary",
                id: 13,
                operator: "+",
                left: 12,
                right: 10,
                ...span,
              },
              {
                kind: "record-new",
                id: 14,
                record: 0,
                arguments: [11, 13],
                ...span,
              },
              { kind: "store", slot: 1, value: 14, ...span },
              { kind: "load", id: 15, slot: 2, ...span },
              {
                kind: "binary",
                id: 16,
                operator: "+",
                left: 15,
                right: 10,
                ...span,
              },
              { kind: "store", slot: 2, value: 16, ...span },
            ],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 5,
            instructions: [{ kind: "load", id: 17, slot: 1, ...span }],
            terminator: { kind: "return", value: 17, ...span },
          },
          { id: 6, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const res = scalarizeLoopRecords(input.functions[0]!, input, 100000);
  assert.ok(res !== undefined && res.scalarized === 1);
  const outMod: ModuleIR = { ...input, functions: [res.fn] };
  assert.ok(verify(outMod).ok, JSON.stringify(verify(outMod)));
  const fn = res.fn;
  // Loop body block 4 has zero record-new instructions; materialization moved to exit.
  assert.ok(!fn.blocks[4]!.instructions.some((op) => op.kind === "record-new"));
  // Preheader block 0 still has initial record-new, plus exit materialization has one.
  assert.equal(
    fn.blocks
      .flatMap((b) => b.instructions)
      .filter((op) => op.kind === "record-new").length,
    2,
  );
});

test("devirtualizeClosureCalls devirtualizes closed records while leaving openRecords indirect", () => {
  // Record 0: closed module-export record holding closure of `target`.
  // Record 1: open surface record holding closure of `target` (foreign code may write it).
  // Record 2: closed record initialized from a field read of open record 1 (must stay unknown).
  const input: ModuleIR = {
    records: [
      {
        byteLength: 24,
        fields: [{ offset: 16, type: "reference", mutable: false }],
      },
      {
        byteLength: 24,
        fields: [{ offset: 16, type: "reference", mutable: true }],
      },
      {
        byteLength: 24,
        fields: [{ offset: 16, type: "reference", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "run",
        exported: true,
        parameters: [0],
        slots: [
          "number",
          "reference",
          "reference",
          "reference",
          "reference",
          "reference",
          "reference",
        ],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "function-new", id: 0, target: 1, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
              { kind: "store", slot: 1, value: 1, ...span },
              { kind: "record-new", id: 2, record: 1, arguments: [0], ...span },
              { kind: "store", slot: 2, value: 2, ...span },
              { kind: "load", id: 3, slot: 1, ...span },
            ],
            terminator: {
              kind: "record",
              object: 3,
              record: 0,
              field: 0,
              operation: "read",
              slot: 3,
              consequent: 1,
              alternate: 4,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 4, slot: 2, ...span }],
            terminator: {
              kind: "record",
              object: 4,
              record: 1,
              field: 0,
              operation: "read",
              slot: 4,
              consequent: 2,
              alternate: 4,
              ...span,
            },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 5, slot: 4, ...span },
              { kind: "record-new", id: 6, record: 2, arguments: [5], ...span },
              { kind: "store", slot: 5, value: 6, ...span },
              { kind: "load", id: 7, slot: 5, ...span },
            ],
            terminator: {
              kind: "record",
              object: 7,
              record: 2,
              field: 0,
              operation: "read",
              slot: 6,
              consequent: 3,
              alternate: 4,
              ...span,
            },
          },
          {
            id: 3,
            instructions: [
              { kind: "load", id: 8, slot: 0, ...span },
              { kind: "load", id: 9, slot: 3, ...span },
              {
                kind: "call-indirect",
                id: 10,
                target: 1,
                callee: 9,
                arguments: [8],
                ...span,
              },
              { kind: "load", id: 11, slot: 4, ...span },
              {
                kind: "call-indirect",
                id: 12,
                target: 1,
                callee: 11,
                arguments: [10],
                ...span,
              },
              { kind: "load", id: 13, slot: 6, ...span },
              {
                kind: "call-indirect",
                id: 14,
                target: 1,
                callee: 13,
                arguments: [12],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 14, ...span },
          },
          { id: 4, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
      {
        id: 1,
        name: "target",
        exported: false,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 1, ...span },
              {
                kind: "binary",
                id: 2,
                operator: "+",
                left: 0,
                right: 1,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));

  // With record 1 open, only the call through closed record 0 devirtualizes;
  // calls through open record 1 and closed record 2 (tainted by record 1) stay indirect.
  const partial = devirtualizeClosureCalls(
    input,
    100000,
    true,
    undefined,
    new Set([1]),
  );
  assert.ok(partial);
  assert.equal(partial.rewritten, 1);
  assert.ok(verify(partial.module).ok, JSON.stringify(verify(partial.module)));
  const block3 = partial.module.functions[0]!.blocks[3]!;
  assert.equal(
    block3.instructions.filter((op) => op.kind === "call").length,
    1,
  );
  assert.equal(
    block3.instructions.filter((op) => op.kind === "call-indirect").length,
    2,
  );

  // With all records closed, all three calls devirtualize.
  const allClosed = devirtualizeClosureCalls(input, 100000, true);
  assert.ok(allClosed);
  assert.equal(allClosed.rewritten, 3);
  assert.ok(
    verify(allClosed.module).ok,
    JSON.stringify(verify(allClosed.module)),
  );
});

test("pruneUnallocatedRecords preserves layouts and optional presence fields in openRecords", () => {
  // Record 0: unallocated closed layout (should prune).
  // Record 1: unallocated open layout with optional-presence field (must NOT prune).
  const input: ModuleIR = {
    records: [
      {
        byteLength: 24,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
      {
        byteLength: 32,
        fields: [
          {
            offset: 24,
            type: "optional-reference",
            mutable: true,
            presenceOffset: 16,
          },
        ],
      },
    ],
    functions: [
      {
        id: 0,
        name: "check",
        exported: true,
        parameters: [0],
        slots: ["reference", "number"],
        returnType: "boolean",
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
            instructions: [{ kind: "constant", id: 1, value: true, ...span }],
            terminator: { kind: "return", value: 1, ...span },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 2, slot: 0, ...span },
              {
                kind: "record-has",
                id: 3,
                object: 2,
                record: 1,
                field: 0,
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

  const pruned = pruneUnallocatedRecords(
    input,
    100000,
    undefined,
    new Set([1]),
  );
  assert.ok(pruned);
  assert.equal(pruned.rewritten, 1);
  assert.ok(verify(pruned.module).ok, JSON.stringify(verify(pruned.module)));
  const fn = pruned.module.functions[0]!;
  // Closed unallocated record 0 check pruned away; open record 1 record-has kept.
  assert.ok(!fn.blocks.some((b) => b.terminator.kind === "record"));
  assert.ok(
    fn.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "record-has" && op.record === 1),
    ),
    "open record-has must remain intact",
  );
});
