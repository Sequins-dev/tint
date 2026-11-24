import assert from "node:assert/strict";
import test from "node:test";
import { lowerProvenRecordReads } from "../src/optimization/record-access.ts";
import { optimizeModule } from "../src/optimization/index.ts";
import { verify, type ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
test("separates proven field reads from fallible record terminators", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "record",
        exported: true,
        parameters: [],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...s },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
            ],
            terminator: {
              kind: "record",
              object: 1,
              record: 0,
              field: 0,
              operation: "read",
              slot: 0,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 2, slot: 0, ...s }],
            terminator: { kind: "return", value: 2, ...s },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
        ],
      },
    ],
  };
  const result = lowerProvenRecordReads(module, 10000)!;
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.ok(
    result.module.functions[0]!.blocks[0]!.instructions.some(
      (op) => op.kind === "record-read",
    ),
  );
  assert.deepEqual(verify(result.module), { ok: true });
  assert.equal(lowerProvenRecordReads(module, 0), undefined);
});
test("verified direct reads preserve layout knowledge through long access chains", () => {
  const blocks: import("@tint/ir/scalar").Block[] = Array.from(
    { length: 42 },
    (_, id) =>
      id === 41
        ? { id, instructions: [], terminator: { kind: "trap", ...s } }
        : id === 40
          ? {
              id,
              instructions: [{ kind: "load", id: 40, slot: 1, ...s }],
              terminator: { kind: "return", value: 40, ...s },
            }
          : {
              id,
              instructions: [{ kind: "load", id, slot: 0, ...s }],
              terminator: {
                kind: "record",
                object: id,
                record: 0,
                field: 0,
                operation: "read",
                slot: 1,
                consequent: id + 1,
                alternate: 41,
                ...s,
              },
            },
  );
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "chain",
        exported: true,
        parameters: [0],
        slots: ["reference", "number"],
        returnType: "number",
        entry: 0,
        blocks,
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = lowerProvenRecordReads(module, 100000)!;
  assert.equal(result.rewritten, 39);
  assert.deepEqual(verify(result.module), { ok: true });
  const reverse = (id: number) => blocks.length - 1 - id;
  const reversed: ModuleIR = {
    ...module,
    functions: [
      {
        ...module.functions[0]!,
        entry: reverse(0),
        blocks: blocks
          .map((b) => ({
            ...b,
            id: reverse(b.id),
            terminator:
              b.terminator.kind === "record"
                ? {
                    ...b.terminator,
                    consequent: reverse(b.terminator.consequent),
                    alternate: reverse(b.terminator.alternate),
                  }
                : b.terminator,
          }))
          .reverse(),
      },
    ],
  };
  assert.deepEqual(verify(reversed), { ok: true });
  assert.deepEqual(verify(lowerProvenRecordReads(reversed, 100000)!.module), {
    ok: true,
  });
});

test("optimized proven reads leave neither their success branch nor its condition", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "record",
        exported: true,
        parameters: [0],
        slots: ["number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
            ],
            terminator: {
              kind: "record",
              object: 1,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 2, slot: 1, ...s }],
            terminator: { kind: "return", value: 2, ...s },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
        ],
      },
    ],
  };
  const optimized = optimizeModule(module, 1000000).module;
  assert.deepEqual(verify(optimized), { ok: true });
  const fn = optimized.functions[0];
  assert.ok(fn);
  // The constant true that guarded the lowered read folds into a jump
  // before the sweep, so it is removed rather than materialized.
  for (const block of fn.blocks) {
    assert.ok(block);
    assert.notEqual(block.terminator.kind, "branch");
    for (const op of block.instructions)
      assert.ok(op?.kind !== "constant" || op.value !== true, op?.kind);
  }
});
test("reads stay checked where the verifier's budget would not prove them", () => {
  // `receivers` objects checked up front, read again (checked) after 100 000
  // straight-line instructions. Lowering proves the reads with its own
  // budget; past the verifier's, it keeps them checked and counts the
  // fallback, so the module stays verifiable.
  function build(receivers: number): ModuleIR {
    const fillerBlocks = 100,
      fillerSize = 1000,
      blocks: ModuleIR["functions"][number]["blocks"][number][] = [],
      slots: ModuleIR["functions"][number]["slots"][number][] = ["number"],
      parameters: number[] = [];
    for (let r = 0; r < receivers; r++) {
      slots.push("reference");
      parameters.push(r + 1);
    }
    const reads = receivers + fillerBlocks,
      done = reads + receivers,
      trap = done + 1;
    for (let r = 0; r < receivers; r++)
      blocks.push({
        id: r,
        instructions: [{ kind: "load", id: r, slot: r + 1, ...s }],
        terminator: {
          kind: "record",
          object: r,
          record: 0,
          field: 0,
          operation: "read",
          slot: 0,
          consequent: r + 1,
          alternate: trap,
          ...s,
        },
      });
    let id = receivers;
    for (let b = 0; b < fillerBlocks; b++) {
      const instructions: ModuleIR["functions"][number]["blocks"][number]["instructions"][number][] =
        [];
      for (let i = 0; i < fillerSize; i++)
        instructions.push({ kind: "constant", id: id++, value: i, ...s });
      blocks.push({
        id: receivers + b,
        instructions,
        terminator: { kind: "jump", target: receivers + b + 1, ...s },
      });
    }
    for (let r = 0; r < receivers; r++) {
      const loaded = id++;
      blocks.push({
        id: reads + r,
        instructions: [{ kind: "load", id: loaded, slot: r + 1, ...s }],
        terminator: {
          kind: "record",
          object: loaded,
          record: 0,
          field: 0,
          operation: "read",
          slot: 0,
          consequent: reads + r + 1,
          alternate: trap,
          ...s,
        },
      });
    }
    blocks.push({
      id: done,
      instructions: [{ kind: "load", id: id++, slot: 0, ...s }],
      terminator: { kind: "return", value: id - 1, ...s },
    });
    blocks.push({
      id: trap,
      instructions: [],
      terminator: { kind: "trap", ...s },
    });
    return {
      records: [
        {
          byteLength: 32,
          fields: [{ offset: 16, type: "number", mutable: true }],
        },
      ],
      functions: [
        {
          id: 0,
          name: "large",
          exported: true,
          parameters,
          slots,
          returnType: "number",
          entry: 0,
          blocks,
        },
      ],
    };
  }
  // Two receivers fit the verifier's budget: every read lowers.
  const small = lowerProvenRecordReads(build(2), 1e9);
  assert.ok(small);
  assert.equal(small.fallbacks, 0);
  assert.ok(small.rewritten >= 2);
  assert.ok(verify(small.module).ok);
  // Twenty do not: the function keeps its checked reads.
  const input = build(20),
    large = lowerProvenRecordReads(input, 1e9);
  assert.ok(large);
  assert.equal(large.fallbacks, 1);
  assert.equal(large.rewritten, 0);
  assert.equal(large.module, input);
  assert.ok(verify(large.module).ok);
});
