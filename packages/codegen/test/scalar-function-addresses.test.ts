import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";
import { encode, relativeAddress } from "@tint/codegen/aarch64/isa";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const span = { start: 0, end: 0 };
function fixture(): ModuleIR {
  const target: FunctionIR = {
    id: 0,
    name: "first",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  return {
    functions: [
      target,
      { ...target, id: 1, name: "second" },
      {
        id: 2,
        name: "addresses",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "function-address",
                id: 0,
                target: 0,
                part: "entry",
                ...span,
              },
              {
                kind: "function-address",
                id: 1,
                target: 1,
                part: "entry",
                ...span,
              },
              {
                kind: "function-address",
                id: 2,
                target: 0,
                part: "signature",
                ...span,
              },
              {
                kind: "function-address",
                id: 3,
                target: 1,
                part: "signature",
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
}
test("static addresses relocate code entries and share physical signatures without boxed functions", () => {
  const emitted = emitModule(fixture(), { closedRoots: [2] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const native = emitted.value;
  assert.equal(native.functionDescriptor, undefined);
  assert.equal(native.functionDescriptorImport, undefined);
  assert.equal(native.signatures.length, 1);
  const signature = native.signatures[0]!;
  assert.deepEqual(signature.functions, [0, 1]);
  assert.deepEqual(signature.parameters, ["number"]);
  const view = new DataView(
      native.code.buffer,
      native.code.byteOffset,
      native.code.byteLength,
    ),
    entry = native.functions[2]!;
  function matches(target: number): number {
    let count = 0;
    for (
      let offset = entry.offset;
      offset + 16 <= entry.offset + entry.byteLength;
      offset += 4
    ) {
      const sequence = relativeAddress(10, 17, target - offset);
      assert.ok(sequence.ok);
      if (
        sequence.value.every((op, i) => {
          const word = encode(op);
          assert.ok(word.ok);
          return view.getUint32(offset + i * 4, true) === word.value;
        })
      )
        count++;
    }
    return count;
  }
  assert.ok(matches(native.functions[0]!.offset) > 0);
  assert.ok(matches(native.functions[1]!.offset) > 0);
  assert.equal(matches(signature.offset), 2);
});
function emitManaged(members?: readonly number[]) {
  const original = fixture(),
    target = original.functions[0]!;
  const witness: FunctionIR = {
    ...target,
    id: 3,
    name: "witness",
    blocks: [
      { id: 0, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  const caller: FunctionIR = {
    id: 4,
    name: "indirect",
    exported: false,
    parameters: [0],
    slots: ["reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "constant", id: 1, value: 42, ...span },
          {
            kind: "call-indirect",
            id: 2,
            target: 3,
            callee: 0,
            arguments: [1],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
  const module: ModuleIR = {
    ...original,
    functions: [...original.functions, witness, caller],
  };
  return emitModule(module, {
    closedRoots: [2],
    managedABI: {
      version: 1,
      functionBrand: { name: "brand", contract: "test.function.brand" },
      signatures: [
        {
          name: "signature",
          contract: "test.address.signature",
          witness: 3,
          ...(members === undefined ? {} : { localFunctions: members }),
          parameters: ["number"],
          returnType: "number",
        },
      ],
    },
  });
}
test("static signature addresses honor explicitly imported signature membership", () => {
  const result = emitManaged([0, 1]);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.linkage, "unresolved-managed");
  assert.equal(result.value.signatures.length, 0);
  assert.equal(result.value.managedImports.length, 2);
  assert.deepEqual(
    result.value.managedImports.map((i) => i.role),
    ["function-brand", "signature"],
  );
});

test("physical ABI equality does not grant imported signature membership", () => {
  const result = emitManaged();
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.signatures.length, 1);
  assert.deepEqual(result.value.signatures[0]?.functions, [0, 1]);
  assert.equal(
    result.value.managedImports.find((binding) => binding.role === "signature")
      ?.witness,
    3,
  );
});

test("managed pointer sites retain exact instruction windows for AOT prelinking", () => {
  const result = emitManaged([0, 1]);
  assert.ok(result.ok, JSON.stringify(result));
  const native = result.value;
  assert.ok(native.managedReferences?.length);
  const view = new DataView(native.code.buffer);
  for (const reference of native.managedReferences) {
    const imported = native.managedImports[reference.import];
    assert.ok(imported);
    const sequence = relativeAddress(
      reference.rd,
      17,
      imported.offset - reference.offset,
    );
    assert.ok(sequence.ok);
    assert.equal(sequence.value.length, 4);
    for (let i = 0; i < 4; i++) {
      const encoded = encode(sequence.value[i]!);
      assert.ok(encoded.ok);
      assert.equal(
        view.getUint32(reference.offset + i * 4, true),
        encoded.value,
      );
    }
    const load = encode({
      op: "ldr",
      width: 64,
      rt: reference.rd,
      rn: reference.rd,
      offset: 0,
    });
    assert.ok(load.ok);
    assert.equal(view.getUint32(reference.offset + 16, true), load.value);
  }
});

test("retained entry signatures keep physical interning without an address-taking instruction", () => {
  const original = fixture(),
    first = original.functions[0]!;
  const emitted = emitModule(
    { functions: [first, { ...first, id: 1, name: "other" }] },
    { signatureRoots: [0, 1] },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  assert.equal(emitted.value.signatures.length, 1);
  assert.deepEqual(emitted.value.signatures[0]?.functions, [0, 1]);
});
