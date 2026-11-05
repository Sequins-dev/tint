import assert from "node:assert/strict";
import test from "node:test";
import { lowerProvenRecordReads } from "../src/optimization/record-access.ts";
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
