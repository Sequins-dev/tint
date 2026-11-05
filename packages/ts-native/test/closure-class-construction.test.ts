import assert from "node:assert/strict";
import { test } from "node:test";
import { verify, type RecordLayout } from "@tint/ir/scalar";
import { buildClassConstruction } from "../src/closure/lowering/class-construction.ts";
const s = { start: 4, end: 8 };
const records: RecordLayout[] = [
  { byteLength: 16, fields: [] },
  {
    byteLength: 48,
    fields: [
      { offset: 24, stateOffset: 16, type: "optional-number", mutable: true },
      { offset: 40, type: "reference", mutable: false },
    ],
  },
  {
    byteLength: 32,
    fields: [{ offset: 16, type: "reference", mutable: false }],
  },
];
test("construction bodies allocate an instance and initialize absent optional fields", () => {
  const fn = buildClassConstruction(
    {
      id: 0,
      name: "construct",
      parameters: [],
      environment: 2,
      prototypeField: 0,
      instance: 1,
      instancePrototypeField: 1,
      fields: [{ kind: "undefined", field: 0, ...s }],
      ...s,
    },
    records,
    [],
  );
  assert.equal(fn.closureEnvironment, 2);
  assert.ok(
    verify({ functions: [fn], records }).ok,
    JSON.stringify(verify({ functions: [fn], records })),
  );
  assert.ok(
    fn.blocks.some(
      (b) =>
        b.terminator.kind === "record-cell" &&
        b.terminator.operation === "initialize",
    ),
  );
  assert.ok(
    fn.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "record-new" && op.record === 1),
    ),
  );
});
test("construction plans reject missing field state and incompatible initializer results", () => {
  const base = {
    id: 0,
    name: "construct",
    parameters: [],
    environment: 2,
    prototypeField: 0,
    instance: 1,
    instancePrototypeField: 1,
    ...s,
  };
  assert.throws(
    () =>
      buildClassConstruction(
        { ...base, fields: [{ kind: "undefined", field: 1, ...s }] },
        records,
        [],
      ),
    /initialization/,
  );
  assert.throws(
    () =>
      buildClassConstruction(
        {
          ...base,
          fields: [
            { kind: "call", field: 0, entry: { field: 0, target: 0 }, ...s },
          ],
        },
        records,
        [{ parameters: [], returnType: "string" }],
      ),
    /signature/,
  );
});

test("static initialization reuses constructor state and passes the constructor as receiver", async () => {
  const api = await import("../src/closure/lowering/class-construction.ts");
  assert.equal(typeof api.buildClassStaticInitialization, "function");
  const fn = api.buildClassStaticInitialization(
    {
      id: 0,
      name: "initializeStatics",
      environment: 2,
      constructorField: 0,
      state: 1,
      fields: [{ kind: "undefined", field: 0, ...s }],
      ...s,
    },
    records,
    [],
  );
  const result = verify({ functions: [fn], records });
  assert.ok(result.ok, JSON.stringify(result));
  const instructions = fn.blocks.flatMap((block) => block.instructions);
  assert.ok(instructions.some((op) => op.kind === "function-environment"));
  assert.ok(!instructions.some((op) => op.kind === "record-new"));
  assert.equal(fn.returnType, "void");
  assert.ok(
    fn.blocks.some(
      (block) =>
        block.terminator.kind === "record-cell" &&
        block.terminator.operation === "initialize",
    ),
  );
});
