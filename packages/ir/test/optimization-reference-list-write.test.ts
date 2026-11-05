import assert from "node:assert/strict";
import test from "node:test";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import { buildReferenceListWrite } from "../src/optimization/reference-list-write.ts";
const s = { start: 0, end: 0 };
const module: ModuleIR = {
  records: [
    {
      byteLength: 32,
      fields: [
        { type: "number", offset: 16, mutable: true },
        { type: "optional-reference", offset: 24, mutable: true },
      ],
    },
    {
      byteLength: 32,
      fields: [{ type: "optional-reference", offset: 16, mutable: true }],
    },
  ],
  functions: [
    {
      id: 0,
      name: "create",
      exported: false,
      parameters: [0],
      slots: ["number"],
      returnType: "reference",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 0, ...s },
            { kind: "reference-none", id: 1, ...s },
            { kind: "record-new", id: 2, record: 0, arguments: [0, 1], ...s },
          ],
          terminator: { kind: "return", value: 2, ...s },
        },
      ],
    },
    {
      id: 1,
      name: "write",
      exported: false,
      parameters: [0, 1, 2],
      slots: ["reference", "number", "optional-reference"],
      returnType: "void",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [],
          terminator: { kind: "return", value: undefined, ...s },
        },
      ],
    },
  ],
};
test("dense writer emits verified growth, cell updates and sparse migration", () => {
  assert.ok(verify(module).ok);
  const fn = buildReferenceListWrite(module, 0, 1, 0, 1);
  assert.ok(fn);
  assert.deepEqual(
    verify({ ...module, functions: [...module.functions, fn] }),
    { ok: true },
  );
  const operations = fn.blocks.flatMap((b) => b.instructions);
  assert.ok(operations.some((i) => i.kind === "reference-vector-new"));
  assert.ok(operations.some((i) => i.kind === "record-new" && i.record === 1));
  assert.ok(operations.some((i) => i.kind === "call" && i.target === 0));
  assert.ok(operations.some((i) => i.kind === "call" && i.target === 1));
  assert.ok(
    fn.blocks.some(
      (b) =>
        b.terminator.kind === "throw-literal" &&
        b.terminator.value === "INVALID_INDEX",
    ),
  );
});
test("writer does not accept mismatched runtime contracts", () => {
  assert.equal(buildReferenceListWrite(module, 1, 0, 0, 1), undefined);
  assert.equal(buildReferenceListWrite(module, 0, 1, 1, 0), undefined);
});

test("opaque direct-reference lists allocate no per-element value records", () => {
  const fn = buildReferenceListWrite(module, 0, 1, 0, 1, true);
  assert.ok(fn);
  assert.deepEqual(
    verify({ ...module, functions: [...module.functions, fn] }),
    { ok: true },
  );
  assert.ok(
    !fn.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "record-new"),
    ),
  );
  assert.ok(
    fn.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "reference-vector-new"),
    ),
  );
});
