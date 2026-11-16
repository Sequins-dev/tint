import assert from "node:assert/strict";
import test from "node:test";
import { verify, type ModuleIR, type FunctionIR } from "@tint/ir/scalar";
import { buildReferenceListAccessors } from "../src/optimization/reference-list-access.ts";
const s = { start: 0, end: 0 };
function fallback(id: number, reference: boolean): FunctionIR {
  return {
    id,
    name: "fallback" + id,
    exported: false,
    parameters: [0, 1],
    slots: ["reference", "number"],
    returnType: reference ? "optional-reference" : "boolean",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: reference
          ? [{ kind: "reference-none", id: 0, ...s }]
          : [{ kind: "constant", id: 0, value: false, ...s }],
        terminator: { kind: "return", value: 0, ...s },
      },
    ],
  };
}
const module: ModuleIR = {
  records: [
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "number", mutable: true },
        { offset: 16, type: "optional-reference", mutable: true },
      ],
    },
    {
      byteLength: 16,
      fields: [{ offset: 8, type: "optional-reference", mutable: true }],
    },
  ],
  functions: [fallback(0, true), fallback(1, false), fallback(2, false)],
};
test("reference-list accessors use explicit layouts and fallback contracts", () => {
  assert.ok(verify(module).ok);
  const built = buildReferenceListAccessors(module, 0, 1, {
    read: 0,
    has: 1,
    delete: 2,
  });
  assert.ok(built);
  const combined = {
    ...module,
    functions: [...module.functions, ...built.functions],
  };
  assert.deepEqual(verify(combined), { ok: true });
  assert.deepEqual([built.read, built.has, built.delete], [3, 4, 5]);
  assert.deepEqual(
    built.functions.map((f) => f.returnType),
    ["optional-reference", "boolean", "boolean"],
  );
  for (const fn of built.functions) {
    assert.ok(
      fn.blocks.some((b) =>
        b.instructions.some((i) => i.kind === "reference-vector-is"),
      ),
    );
    assert.ok(
      fn.blocks.some((b) => b.instructions.some((i) => i.kind === "call")),
    );
  }
  assert.equal(module.functions.length, 3);
});
test("incompatible layouts and fallback ABIs do not authorize list rewriting", () => {
  assert.equal(
    buildReferenceListAccessors(module, 1, 0, { read: 0, has: 1, delete: 2 }),
    undefined,
  );
  assert.equal(
    buildReferenceListAccessors(module, 0, 1, { read: 1, has: 0, delete: 2 }),
    undefined,
  );
  assert.equal(
    buildReferenceListAccessors(module, 0, 1, { read: 0, has: 1, delete: 99 }),
    undefined,
  );
});

test("opaque direct-reference readers do not dereference value cells", () => {
  const built = buildReferenceListAccessors(
    module,
    0,
    1,
    { read: 0, has: 1, delete: 2 },
    true,
  );
  assert.ok(built);
  assert.deepEqual(
    verify({ ...module, functions: [...module.functions, ...built.functions] }),
    { ok: true },
  );
  assert.ok(
    !built.functions.some((fn) =>
      fn.blocks.some(
        (b) => b.terminator.kind === "record" && b.terminator.record === 1,
      ),
    ),
  );
});

test("inline general and boolean cells preserve missing-value encodings", () => {
  for (const element of ["general", "optional-boolean"] as const) {
    const missing = element === "general" ? "general-none" : "boolean-none";
    const input: ModuleIR = {
      ...module,
      records: [
        module.records![0]!,
        {
          byteLength: 24,
          fields: [{ offset: 8, type: element, mutable: true }],
        },
      ],
      functions: [
        {
          ...fallback(0, true),
          returnType: element,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: missing, id: 0, ...s }],
              terminator: { kind: "return", value: 0, ...s },
            },
          ],
        },
        fallback(1, false),
        fallback(2, false),
      ],
    };
    assert.deepEqual(verify(input), { ok: true });
    const built = buildReferenceListAccessors(input, 0, 1, {
      read: 0,
      has: 1,
      delete: 2,
    });
    assert.ok(built, element);
    assert.deepEqual(
      verify({ ...input, functions: [...input.functions, ...built.functions] }),
      { ok: true },
    );
    const read = built.functions[0]!;
    assert.equal(read.returnType, element);
    assert.ok(
      read.blocks
        .find((block) => block.id === 5)!
        .instructions.some((op) => op.kind === missing),
    );
  }
});

test("direct string readers return the stored word as an optional string", () => {
  const strings: ModuleIR = {
    records: [
      module.records![0]!,
      {
        byteLength: 16,
        fields: [{ offset: 8, type: "optional-string", mutable: true }],
      },
    ],
    functions: [
      {
        ...fallback(0, true),
        returnType: "optional-string",
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "string-none", id: 0, ...s }],
            terminator: { kind: "return", value: 0, ...s },
          },
        ],
      },
      fallback(1, false),
      fallback(2, false),
    ],
  };
  const built = buildReferenceListAccessors(
    strings,
    0,
    1,
    { read: 0, has: 1, delete: 2 },
    true,
  );
  assert.ok(built);
  assert.deepEqual(
    verify({
      ...strings,
      functions: [...strings.functions, ...built.functions],
    }),
    { ok: true },
  );
  const read = built.functions[0]!;
  assert.equal(read.returnType, "optional-string");
  assert.ok(
    read.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "reference-string"),
    ),
  );
  assert.ok(
    !built.functions.some((fn) =>
      fn.blocks.some(
        (b) => b.terminator.kind === "record" && b.terminator.record === 1,
      ),
    ),
  );
});
