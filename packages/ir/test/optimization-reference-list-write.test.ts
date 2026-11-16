import assert from "node:assert/strict";
import test from "node:test";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import {
  buildReferenceListCreate,
  buildReferenceListWrite,
} from "../src/optimization/reference-list-write.ts";
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
  // Growth copies the old vector in one operation; cell entries are never
  // the vector itself, so nothing is rebased.
  assert.ok(
    operations.some((i) => i.kind === "reference-vector-copy" && !i.rebase),
  );
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
test("the first vector of a resized empty list covers its logical length", () => {
  const fn = buildReferenceListWrite(module, 0, 1, 0, 1);
  assert.ok(fn);
  const operations = fn.blocks.flatMap((b) => b.instructions);
  // The presize bound: logical lengths up to 65536 are allocated at once.
  assert.ok(
    operations.some((op) => op.kind === "constant" && op.value === 65536),
  );
  // The length is read from the header (field 0) on the empty-root path
  // as well as when extending.
  assert.ok(
    fn.blocks.filter(
      (b) =>
        b.terminator.kind === "record" &&
        b.terminator.field === 0 &&
        b.terminator.operation === "read",
    ).length >= 2,
  );
});
test("dense create sizes the first vector from an integral hint and otherwise defers", () => {
  const fn = buildReferenceListCreate(module, 0, 0);
  assert.ok(fn);
  assert.deepEqual(
    verify({ ...module, functions: [...module.functions, fn] }),
    { ok: true },
  );
  // Inlinable: not a shape-recognized `__tint_reference_list_` helper.
  assert.ok(!fn.name.startsWith("__tint_reference_list_"));
  const operations = fn.blocks.flatMap((b) => b.instructions);
  assert.ok(
    operations.some((i) => i.kind === "unary" && i.operator === "is-integer"),
  );
  assert.ok(operations.some((i) => i.kind === "reference-vector-new"));
  assert.ok(operations.some((i) => i.kind === "record-new" && i.record === 0));
  assert.ok(
    operations.some((op) => op.kind === "constant" && op.value === 65536),
  );
  // Zero, invalid and oversized hints run the bound create.
  assert.ok(operations.some((i) => i.kind === "call" && i.target === 0));
  assert.equal(buildReferenceListCreate(module, 1, 0), undefined);
  assert.equal(buildReferenceListCreate(module, 0, 1), undefined);
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
  // A stored undefined is the vector itself, so growth rebases it.
  assert.ok(
    fn.blocks.some((b) =>
      b.instructions.some(
        (op) => op.kind === "reference-vector-copy" && op.rebase,
      ),
    ),
  );
});

test("direct string lists store string words without value records", () => {
  // A string-celled list: the writer takes optional strings.
  const strings: ModuleIR = {
    ...module,
    records: [
      module.records![0]!,
      {
        byteLength: 32,
        fields: [{ type: "optional-string", offset: 16, mutable: true }],
      },
    ],
    functions: [
      module.functions[0]!,
      {
        ...module.functions[1]!,
        slots: ["reference", "number", "optional-string"],
      },
    ],
  };
  const fn = buildReferenceListWrite(strings, 0, 1, 0, 1, true);
  assert.ok(fn);
  assert.deepEqual(
    verify({ ...strings, functions: [...strings.functions, fn] }),
    { ok: true },
  );
  const kinds = fn.blocks.flatMap((b) => b.instructions.map((op) => op.kind));
  assert.ok(!kinds.includes("record-new"));
  // Presence is decided on the word as a reference (an empty string is a
  // present element), and migration converts words back to strings.
  assert.ok(kinds.includes("string-reference"));
  assert.ok(kinds.includes("reference-string"));
  // Direct storage needs a single-word payload.
  assert.equal(
    buildReferenceListWrite(
      {
        ...strings,
        records: [
          module.records![0]!,
          {
            byteLength: 32,
            fields: [{ type: "general", offset: 16, mutable: true }],
          },
        ],
        functions: [
          module.functions[0]!,
          {
            ...module.functions[1]!,
            slots: ["reference", "number", "general"],
          },
        ],
      },
      0,
      1,
      0,
      1,
      true,
    ),
    undefined,
  );
});
