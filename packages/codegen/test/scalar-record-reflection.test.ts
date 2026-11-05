import { encode, relativeAddress } from "@tint/codegen/aarch64/isa";
import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const span = { start: 0, end: 0 };
function fixture(record = 0): ModuleIR {
  return {
    records: [{ byteLength: 16, fields: [] }],
    functions: [
      {
        id: 0,
        name: "descriptor",
        exported: true,
        parameters: [0],
        slots: ["general"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              {
                kind: "general-record-descriptor",
                id: 1,
                value: 0,
                record,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
}
test("record descriptor reflection emits a numeric checked metadata address", () => {
  const result = emitModule(fixture());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.records.length, 1);
  assert.equal(result.value.helpers.length, 0);
  assert.ok(result.value.functions[0]!.byteLength > 0);
  assert.equal(verify(fixture(1)).ok, false);
  assert.equal(
    verify({
      ...fixture(),
      functions: [{ ...fixture().functions[0]!, slots: ["reference"] }],
    }).ok,
    false,
  );
});

test("instance-free descriptor addresses target the emitted record metadata", () => {
  const base = fixture(),
    fn = base.functions[0]!;
  const module: ModuleIR = {
    ...base,
    functions: [
      {
        ...fn,
        parameters: [],
        slots: [],
        blocks: [
          {
            id: 0,
            instructions: [
              { ...span, kind: "record-descriptor-address", id: 0, record: 0 },
            ],
            terminator: { ...span, kind: "return", value: 0 },
          },
        ],
      },
    ],
  };
  const result = emitModule(module);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.helpers.length, 0);
  assert.equal(result.value.records.length, 1);
  const native = result.value,
    view = new DataView(
      native.code.buffer,
      native.code.byteOffset,
      native.code.byteLength,
    );
  let matches = false;
  for (let offset = 0; offset < native.functions[0]!.byteLength; offset += 4) {
    const address = relativeAddress(11, 17, native.records[0]!.offset - offset);
    assert.ok(address.ok);
    if (
      address.value.every((instruction, index) => {
        const word = encode(instruction);
        assert.ok(word.ok);
        return view.getUint32(offset + index * 4, true) === word.value;
      })
    ) {
      matches = true;
      break;
    }
  }
  assert.equal(matches, true);
});
