import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  instructionEffects,
  effectReadHeap,
  visitInstructionOperands,
  substituteInstructionValues,
  type FunctionIR,
} from "@tint/ir/scalar";
import { pruneClosedModule } from "@tint/ir/optimization";
import { bindRecordOperation } from "../src/closure/lowering/record-bindings.ts";
const span = { start: 0, end: 0 };
function fixture() {
  const fn: FunctionIR = {
    id: 0,
    name: "descriptor",
    exported: true,
    parameters: [0, 1],
    slots: ["general", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      { id: 0, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  return {
    records: [
      { byteLength: 32, fields: [] },
      { byteLength: 16, fields: [] },
    ],
    functions: [bindRecordOperation(fn, 0, 1, "descriptor", span)],
  };
}
test("trusted record descriptor binding produces a verified numeric reflection entry", () => {
  const module = fixture();
  assert.deepEqual(verify(module), { ok: true });
  const entry = module.functions[0]!;
  assert.equal(
    entry.blocks
      .flatMap((b) => b.instructions)
      .filter((op) => op.kind === "general-record-descriptor").length,
    1,
  );
});
test("record descriptor reflection survives reachability and participates in ordinary IR rewrites", () => {
  const module = fixture();
  const retained = pruneClosedModule(module, [0]);
  assert.ok(retained, JSON.stringify(retained));
  assert.equal(retained.module.records?.length, 1);
  const op = {
    kind: "general-record-descriptor" as const,
    id: 1,
    value: 0,
    record: 0,
    ...span,
  };
  assert.equal(instructionEffects(op), effectReadHeap);
  const values: number[] = [];
  visitInstructionOperands(op, (id) => values.push(id));
  assert.deepEqual(values, [0]);
  assert.deepEqual(substituteInstructionValues(op, new Uint32Array([3])), {
    ...op,
    value: 2,
  });
});

test("source record reflection requires an explicit grant and exact facade signature", async () => {
  const { createSourceText } = await import("@tint/source/text");
  const { parseModule } = await import("@tint/typescript/syntax");
  const { checkClosureModule } = await import("@tint/typescript/checker");
  const { lowerModuleEntries } =
    await import("@tint/ts-native/closure/lowering");
  function lower(signature: string, authorized = true) {
    const bytes = new TextEncoder().encode(
      `interface Box{value:number} function descriptor(${signature}{throw "UNBOUND";}`,
    );
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseModule(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    return lowerModuleEntries(
      checked.value,
      [0],
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
      authorized
        ? { recordBindings: [{ function: 0, operation: "descriptor" }] }
        : undefined,
    );
  }
  const plain = lower("value:unknown,witness:Box):number", false);
  assert.ok(plain.ok, JSON.stringify(plain));
  assert.equal(
    plain.value.module.functions[0]!.blocks.flatMap((b) => b.instructions).some(
      (op) => op.kind === "general-record-descriptor",
    ),
    false,
  );
  const bound = lower("value:unknown,witness:Box):number");
  assert.ok(bound.ok, JSON.stringify(bound));
  assert.ok(verify(bound.value.module).ok);
  for (const signature of [
    "value:number,witness:Box):number",
    "value:unknown):number",
    "value:unknown,witness:Box):boolean",
    "value:unknown,witness:Box|undefined):number",
  ])
    assert.equal(lower(signature).ok, false, signature);
});

test("instance-free record identity is pure and keeps its descriptor through pruning", () => {
  const original = fixture(),
    fn = original.functions[0]!;
  const module = {
    ...original,
    functions: [bindRecordOperation(fn, 0, 1, "identity", span)],
  };
  assert.deepEqual(verify(module), { ok: true });
  const op = module.functions[0]!.blocks[0]!.instructions[0]!;
  assert.equal(op.kind, "record-descriptor-address");
  assert.equal(instructionEffects(op), 0);
  const values: number[] = [];
  visitInstructionOperands(op, (id) => values.push(id));
  assert.deepEqual(values, []);
  assert.equal(substituteInstructionValues(op, new Uint32Array([5])), op);
  const retained = pruneClosedModule(module, [0]);
  assert.ok(retained);
  assert.equal(retained.module.records?.length, 1);
  const rewritten = retained.module.functions[0]!.blocks[0]!.instructions[0]!;
  assert.deepEqual(rewritten, {
    ...span,
    kind: "record-descriptor-address",
    id: 0,
    record: 0,
  });
  assert.equal(verify({ ...module, records: [] }).ok, false);
});

test("instance-free source identity requires a concrete optional witness and explicit authorization", async () => {
  const { createSourceTextView } = await import("@tint/source/text");
  const { parseModule } = await import("@tint/typescript/syntax");
  const { checkClosureModule } = await import("@tint/typescript/checker");
  const { lowerModuleEntries } =
    await import("@tint/ts-native/closure/lowering");
  function lower(signature: string, authorized = true) {
    const parsed = parseModule(
      createSourceTextView(
        `interface Box{value:number;}function identity(${signature}{throw "UNBOUND";}`,
      ),
    );
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    return lowerModuleEntries(
      checked.value,
      [0],
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
      authorized
        ? { recordBindings: [{ function: 0, operation: "identity" }] }
        : undefined,
    );
  }
  const bound = lower("witness:Box|undefined):number");
  assert.ok(bound.ok, JSON.stringify(bound));
  assert.ok(
    bound.value.module.functions[0]!.blocks.flatMap(
      (block) => block.instructions,
    ).some((op) => op.kind === "record-descriptor-address"),
  );
  const plain = lower("witness:Box|undefined):number", false);
  assert.ok(plain.ok);
  assert.equal(
    plain.value.module.functions[0]!.blocks.flatMap(
      (block) => block.instructions,
    ).some((op) => op.kind === "record-descriptor-address"),
    false,
  );
  for (const signature of [
    "witness:Box):number",
    "witness:unknown):number",
    "witness:Box|undefined):boolean",
    "witness:Box|undefined,extra:number):number",
  ])
    assert.equal(lower(signature).ok, false, signature);
});

test("packed module entries preserve both ordinary and replaced function bodies", async () => {
  const { createSourceTextView } = await import("@tint/source/text");
  const { parseModule } = await import("@tint/typescript/syntax");
  const { checkClosureModule } = await import("@tint/typescript/checker");
  const { lowerModuleEntries } =
    await import("@tint/ts-native/closure/lowering");
  const parsed = parseModule(
    createSourceTextView(`
      interface Box { value: number; }
      function identity(witness: Box | undefined): number { throw "UNBOUND"; }
      function caller(): number { return identity(undefined); }
    `),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const target = {
    pointerSize: 8,
    wordSize: 8,
    allocationAlignment: 16,
    frameAlignment: 16,
    maxAlignment: 16,
  } as const;
  const options = {
    debug: true,
    recordBindings: [{ function: 0, operation: "identity" as const }],
  };
  const decoded = lowerModuleEntries(
    checked.value,
    [0, 1],
    target,
    4096,
    options,
  );
  assert.ok(decoded.ok, JSON.stringify(decoded));
  const packed = lowerModuleEntries(checked.value, [0, 1], target, 4096, {
    ...options,
    packBodiesAfter: 2,
  });
  assert.ok(packed.ok, JSON.stringify(packed));
  const store = packed.value.bodies;
  assert.ok(store, "the function bodies should be stored separately");
  try {
    assert.ok(verify(packed.value.module, store).ok);
    for (const header of packed.value.module.functions) {
      assert.deepEqual(header.blocks, []);
      const body: FunctionIR = store.get(header.id);
      const original: FunctionIR | undefined =
        decoded.value.module.functions[header.id];
      assert.deepEqual(body, original);
    }
  } finally {
    store.close();
  }
});
