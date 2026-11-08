import { test } from "node:test";
import { addressesTarget } from "./address-forms.ts";
import assert from "node:assert/strict";
import {
  encode,
  relativeAddress,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
import type { ModuleIR, HostOperation } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const span = { start: 0, end: 0 };
function fixture(operation: HostOperation): ModuleIR {
  return {
    records: [
      {
        byteLength: 48,
        fields: [{ offset: 24, type: "optional-reference", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "reflect",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "host-call", id: 1, operation, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
}
function word(instruction: Instruction): number {
  const value = encode(instruction);
  assert.ok(value.ok);
  return value.value;
}
function offsets(bytes: Uint8Array, instruction: Instruction): number[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    needle = word(instruction),
    result: number[] = [];
  for (let i = 0; i + 4 <= bytes.length; i += 4)
    if (v.getUint32(i, true) === needle) result.push(i);
  return result;
}
for (const [operation, field] of [
  ["native-function-descriptor", 0],
  ["native-function-signature", 32],
] as const) {
  test(`${operation} guards the explicit function brand then reads only its permanent identity`, () => {
    const result = emitModule(fixture(operation));
    assert.ok(result.ok, JSON.stringify(result));
    const n = result.value;
    assert.ok(n.functionDescriptor);
    assert.equal(n.functionDescriptor.record, 1);
    assert.notEqual(n.functionDescriptor, n.records[0]);
    assert.deepEqual(n.functionDescriptor.referenceOffsets, [24]);
    assert.deepEqual(n.signatures, []);
    const reads = offsets(n.code, {
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: field,
    });
    assert.equal(reads.length, 1);
    const guard = offsets(n.code, {
      op: "ldr",
      width: 64,
      rt: 10,
      rn: 9,
      offset: 0,
    });
    assert.equal(guard.length, 1);
    assert.ok(guard[0]! < reads[0]!);
    const view = new DataView(n.code.buffer, n.code.byteOffset, n.code.length);
    assert.ok(
      addressesTarget(view, guard[0]! + 4, 11, n.functionDescriptor.offset),
    );
    const range = offsets(n.code, {
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 9,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    assert.equal(range.length, 1);
    const branch = view.getUint32(range[0]! + 4, true);
    assert.equal(branch & 15, 8); // unsigned HI, before conversion
    let displacement = (branch >>> 5) & 0x7ffff;
    if (displacement & 0x40000) displacement -= 0x80000;
    const rejected = range[0]! + 4 + displacement * 4;
    assert.equal(
      view.getUint32(rejected, true),
      word({ op: "movz", width: 64, rd: 9, immediate: 1, shift: 0 }),
    );
    assert.equal(
      view.getUint32(rejected + 4, true),
      word({ op: "scvtf-d-x", rd: 0, rn: 9 }),
    );
    assert.equal(
      view.getUint32(rejected + 8, true),
      word({ op: "fneg", rd: 0, rn: 0 }),
    );
    for (const [op, shift] of [
      ["movz", 0],
      ["movk", 16],
      ["movk", 32],
    ] as const)
      assert.equal(
        offsets(n.code, { op, width: 64, rd: 10, immediate: 65535, shift })
          .length,
        1,
      );
    for (const offset of [16, 24])
      assert.equal(
        offsets(n.code, { op: "ldr", width: 64, rt: 9, rn: 9, offset }).length,
        0,
      );

    const conversions = offsets(n.code, { op: "scvtf-d-x", rd: 0, rn: 9 });
    assert.ok(conversions.some((i) => i > range[0]!));
    const upper = offsets(n.code, {
      op: "movk",
      width: 64,
      rd: 10,
      immediate: 31,
      shift: 48,
    });
    assert.equal(upper.length, 1); // 0x001f_ffff_ffff_ffff
    const zero = offsets(n.code, {
      op: "cbz",
      width: 64,
      rt: 9,
      displacement: 0,
    });
    assert.equal(zero.length, 0); // all branch labels resolved
  });
}
test("ordinary records never acquire a function descriptor role just from matching layout", () => {
  const module = fixture("native-function-descriptor");
  const fn = module.functions[0]!;
  const result = emitModule({
    ...module,
    functions: [
      {
        ...fn,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 42, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(result.ok);
  assert.equal(result.value.functionDescriptor, undefined);
  assert.equal(result.value.records.length, 1);
});

for (const [name, field] of [
  ["native-value-function-descriptor", 0],
  ["native-value-function-signature", 32],
] as const) {
  test(`${name} inspects unknown values only after reference-tag and function-brand checks`, () => {
    const base = fixture(name as HostOperation);
    const module: ModuleIR = {
      ...base,
      functions: base.functions.map((fn) => ({ ...fn, slots: ["general"] })),
    };
    const emitted = emitModule(module);
    assert.ok(emitted.ok, JSON.stringify(emitted));
    assert.ok(emitted.value.functionDescriptor);
    const tag = offsets(emitted.value.code, {
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 5,
      shift: 0,
      setFlags: true,
    });
    const header = offsets(emitted.value.code, {
      op: "ldr",
      width: 64,
      rt: 10,
      rn: 9,
      offset: 0,
    });
    const identity = offsets(emitted.value.code, {
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: field,
    });
    assert.equal(tag.length, 1);
    // General-value marshalling also emits descriptor reads. Restrict this
    // assertion to the reflection sequence after its dedicated tag check.
    const reflectedHeader = header.filter((offset) => offset > tag[0]!);
    assert.equal(reflectedHeader.length, 1);
    const reflectedIdentity = identity.filter(
      (offset) => offset > reflectedHeader[0]!,
    );
    assert.equal(reflectedIdentity.length, 1);
  });
}
