import assert from "node:assert/strict";
import test from "node:test";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import { buildReferenceListResize } from "../src/optimization/reference-list-resize.ts";
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
  ],
  functions: [
    {
      id: 0,
      name: "sparseResize",
      exported: false,
      parameters: [0, 1],
      slots: ["reference", "number"],
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
test("dense resize emits verified clearing, sparse fallback and invalid-length paths", () => {
  const fn = buildReferenceListResize(module, 0, 0);
  assert.ok(fn);
  assert.deepEqual(
    verify({ ...module, functions: [...module.functions, fn] }),
    { ok: true },
  );
  const operations = fn.blocks.flatMap((b) => b.instructions);
  assert.ok(operations.some((i) => i.kind === "reference-vector-write"));
  assert.ok(operations.some((i) => i.kind === "call" && i.target === 0));
  assert.ok(
    fn.blocks.some(
      (b) =>
        b.terminator.kind === "throw-literal" &&
        b.terminator.value === "INVALID_LENGTH",
    ),
  );
});
test("resize rejects unbound headers and incompatible fallback ABI", () => {
  assert.equal(buildReferenceListResize(module, 1, 0), undefined);
  assert.equal(buildReferenceListResize(module, 0, 1), undefined);
});
