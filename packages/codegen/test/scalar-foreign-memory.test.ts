// c-memory lowering and the C stack reserve (docs/native-ffi.md): each C
// view member access is the data pointer and one access at a constant
// offset; external-storage primitives rewrite only array headers.
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindForeignCalls,
  callbackState,
  callbackTransition,
  dynamicCallFrame,
  dynamicForeignCall,
  foreignCallTypes,
  type ForeignCall,
  type ForeignMemoryAccess,
  type Instruction as IRInstruction,
  type ModuleIR,
  type ScalarType,
  type ReturnType,
} from "@tint/ir/scalar";
import type { CType } from "@tint/abi/c";
import { encode, type Instruction } from "@tint/codegen/aarch64/isa";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";

const scalar = (
  name: "bool" | "i8" | "u16" | "u32" | "i64" | "u64" | "f32" | "f64",
): CType => ({ kind: "scalar", scalar: name });
const address: CType = { kind: "pointer", pointee: scalar("u32") };
function stub(parameters: ScalarType[], result: ReturnType): ModuleIR {
  const slots = parameters.slice();
  if (result !== "void") slots.push(result);
  return {
    functions: [
      {
        id: 0,
        name: "stub",
        exported: true,
        parameters: parameters.map((_, index) => index),
        slots,
        returnType: result,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions:
              result === "void"
                ? []
                : [
                    {
                      kind: "load",
                      id: 0,
                      slot: parameters.length,
                      start: 0,
                      end: 0,
                    },
                  ],
            terminator: {
              kind: "return",
              value: result === "void" ? undefined : 0,
              start: 0,
              end: 0,
            },
          },
        ],
      },
    ],
  };
}
function emitted(
  binding: { call?: ForeignCall; memory?: ForeignMemoryAccess },
  parameters: ScalarType[],
  result: ReturnType,
): Uint32Array {
  const bound = bindForeignCalls(stub(parameters, result), [
    { function: 0, ...binding },
  ]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const module = emitModule(bound.value, { hostABI: darwinHostABI() });
  assert.ok(module.ok, JSON.stringify(module));
  // Neither a field access nor a leaf call is a safepoint.
  for (const table of module.value.stackMaps) assert.equal(table.entries, 0);
  const code = module.value.code;
  return new Uint32Array(
    code.buffer.slice(code.byteOffset, code.byteOffset + code.byteLength),
  );
}
function word(instruction: Instruction): number {
  const encoded = encode(instruction);
  assert.ok(encoded.ok, JSON.stringify(instruction));
  return encoded.value;
}
/** Whether `code` contains `sequence` contiguously. */
function contains(
  code: Uint32Array,
  sequence: readonly Instruction[],
): boolean {
  const words = sequence.map(word);
  for (let at = 0; at + words.length <= code.length; at++)
    if (words.every((value, index) => code[at + index] === value)) return true;
  return false;
}
const field = (
  operation: "load" | "store",
  type: CType,
  offset: number,
  minimum = 112,
): ForeignMemoryAccess => ({ operation, type, offset, minimum });
const lengthCheck: Instruction[] = [
  { op: "ldr", width: 32, rt: 10, rn: 9, offset: 8 },
  {
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 10,
    immediate: 112,
    shift: 0,
    setFlags: true,
  },
];
const dataPointer: Instruction = {
  op: "ldr",
  width: 64,
  rt: 11,
  rn: 9,
  offset: 16,
};

/** A function whose body is one c-memory view access over its parameters
 * (view loads and stores come only from the view lowering, never from a
 * bound stub). */
function viewEmitted(
  access: ForeignMemoryAccess,
  parameters: ScalarType[],
  result: ReturnType,
): Uint32Array {
  const module = stub(parameters, result),
    fn = module.functions[0]!;
  const instructions = parameters.map((_, index) => ({
    kind: "load" as const,
    id: index,
    slot: index,
    start: 0,
    end: 0,
  }));
  const id = result === "void" ? undefined : parameters.length;
  const body = {
    ...fn,
    blocks: [
      {
        id: 0,
        instructions: [
          ...instructions,
          {
            kind: "c-memory" as const,
            access,
            id,
            arguments: parameters.map((_, index) => index),
            start: 0,
            end: 0,
          },
        ],
        terminator: { kind: "return" as const, value: id, start: 0, end: 0 },
      },
    ],
  };
  const emittedModule = emitModule(
    { functions: [body] },
    { hostABI: darwinHostABI() },
  );
  assert.ok(emittedModule.ok, JSON.stringify(emittedModule));
  for (const table of emittedModule.value.stackMaps)
    assert.equal(table.entries, 0);
  const code = emittedModule.value.code;
  return new Uint32Array(
    code.buffer.slice(code.byteOffset, code.byteOffset + code.byteLength),
  );
}

test("a view load is the data pointer and one constant-offset load", () => {
  const code = viewEmitted(
    field("load", scalar("u32"), 32),
    ["Uint8Array"],
    "number",
  );
  // Creating the view proved its size: no length check.
  assert.ok(!contains(code, lengthCheck));
  assert.ok(
    contains(code, [
      dataPointer,
      { op: "ldr", width: 32, rt: 12, rn: 11, offset: 32 },
      { op: "ucvtf-d-w", rd: 0, rn: 12 },
    ]),
  );
  const double = viewEmitted(
    field("load", scalar("f64"), 16),
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(double, [dataPointer, { op: "ldr-d", rt: 0, rn: 11, offset: 16 }]),
  );
  // Narrow signed members sign-extend; bool normalizes to 0/1.
  const narrow = viewEmitted(
    field("load", scalar("i8"), 3),
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(narrow, [
      { op: "ldrb", rt: 12, rn: 11, offset: 3 },
      { op: "sbfm", width: 32, rd: 12, rn: 12, immr: 0, imms: 7 },
    ]),
  );
  const flag = viewEmitted(
    field("load", scalar("bool"), 7),
    ["Uint8Array"],
    "boolean",
  );
  assert.ok(contains(flag, [{ op: "ldrb", rt: 12, rn: 11, offset: 7 }]));
  // View accesses rely on the lowering's checks, so no stub binds to one.
  const bound = bindForeignCalls(stub(["Uint8Array"], "number"), [
    { function: 0, memory: field("load", scalar("u32"), 32) },
  ]);
  assert.equal(bound.ok, false);
});

test("64-bit view loads convert exactly; view stores convert unchecked", () => {
  const pointer = viewEmitted(
    field("load", address, 104),
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(pointer, [
      dataPointer,
      { op: "ldr", width: 64, rt: 12, rn: 11, offset: 104 },
      // CMN x12, #1: 2^64 - 1 is not a binary64 value.
      {
        op: "add-imm",
        width: 64,
        rd: "zr",
        rn: 12,
        immediate: 1,
        shift: 0,
        setFlags: true,
      },
    ]),
  );
  // The lowering checked the stored value against the member's contract
  // (TypeError), so the store converts and writes with no trap.
  const store = viewEmitted(
    field("store", scalar("i64"), 40),
    ["Uint8Array", "number"],
    "void",
  );
  assert.ok(contains(store, [{ op: "fcvtzs-x-d", rd: 12, rn: 0 }]));
  assert.ok(!contains(store, [{ op: "scvtf-d-x", rd: 1, rn: 12 }]));
  assert.ok(
    contains(store, [
      dataPointer,
      { op: "str", width: 64, rt: 12, rn: 11, offset: 40 },
    ]),
  );
  const narrow = viewEmitted(
    field("store", scalar("u16"), 6),
    ["Uint8Array", "number"],
    "void",
  );
  assert.ok(contains(narrow, [{ op: "fcvtzs-w-d", rd: 12, rn: 0 }]));
  assert.ok(contains(narrow, [{ op: "strh", rt: 12, rn: 11, offset: 6 }]));
});

test("consecutive accesses to one view reuse its data pointer", () => {
  // Two loads of one view with a constant and a slot store between them,
  // then a branch to a block whose only predecessor this is, which reloads
  // the view's slot and stores to it: one data pointer load in all. A store
  // to the view's slot, or any other operation, forgets it.
  const u32 = scalar("u32");
  const memory = (
    operation: "load" | "store",
    offset: number,
    id: number | undefined,
    args: number[],
  ) => ({
    kind: "c-memory" as const,
    access: { operation, type: u32, offset, minimum: 16 },
    id,
    arguments: args,
    start: 0,
    end: 0,
  });
  const views = (between: IRInstruction[]): Uint32Array => {
    const module: ModuleIR = {
      functions: [
        {
          id: 0,
          name: "views",
          exported: true,
          parameters: [0, 1, 3],
          slots: ["Uint8Array", "number", "number", "Uint8Array"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
                memory("load", 0, 1, [0]),
                { kind: "constant", id: 2, value: 7, start: 0, end: 0 },
                { kind: "store", slot: 2, value: 1, start: 0, end: 0 },
                memory("load", 4, 3, [0]),
                { kind: "store", slot: 1, value: 3, start: 0, end: 0 },
                ...between,
                { kind: "constant", id: 4, value: true, start: 0, end: 0 },
              ],
              terminator: {
                kind: "branch",
                condition: 4,
                consequent: 1,
                alternate: 2,
                start: 0,
                end: 0,
              },
            },
            {
              id: 1,
              instructions: [
                { kind: "load", id: 10, slot: 0, start: 0, end: 0 },
                { kind: "load", id: 11, slot: 2, start: 0, end: 0 },
                memory("store", 8, undefined, [10, 11]),
                { kind: "load", id: 12, slot: 1, start: 0, end: 0 },
              ],
              terminator: { kind: "return", value: 12, start: 0, end: 0 },
            },
            {
              id: 2,
              instructions: [
                { kind: "load", id: 20, slot: 2, start: 0, end: 0 },
              ],
              terminator: { kind: "return", value: 20, start: 0, end: 0 },
            },
          ],
        },
      ],
    };
    const emitted = emitModule(module, { hostABI: darwinHostABI() });
    assert.ok(emitted.ok, JSON.stringify(emitted));
    const code = emitted.value.code;
    return new Uint32Array(
      code.buffer.slice(code.byteOffset, code.byteOffset + code.byteLength),
    );
  };
  const pointer = word(dataPointer),
    loads = (code: Uint32Array) =>
      [...code].filter((value) => value === pointer).length;
  const reused = views([]);
  assert.equal(loads(reused), 1);
  assert.ok(
    contains(reused, [{ op: "ldr", width: 32, rt: 12, rn: 11, offset: 4 }]),
  );
  assert.ok(
    contains(reused, [{ op: "str", width: 32, rt: 12, rn: 11, offset: 8 }]),
  );
  // Copies keep the view's identity; rebinding its slot to another array,
  // or an opaque operation, forgets the pointer.
  assert.equal(
    loads(views([{ kind: "store", slot: 0, value: 0, start: 0, end: 0 }])),
    1,
  );
  assert.equal(
    loads(
      views([
        { kind: "load", id: 6, slot: 3, start: 0, end: 0 },
        { kind: "store", slot: 0, value: 6, start: 0, end: 0 },
      ]),
    ),
    2,
  );
  assert.equal(
    loads(
      views([
        { kind: "array-length", id: 5, array: 0, start: 0, end: 0 },
        { kind: "store", slot: 1, value: 5, start: 0, end: 0 },
      ]),
    ),
    2,
  );
});

test("a view store's contract check is the exact conversion round trip", () => {
  const fits = (type: CType): ForeignMemoryAccess => ({
    operation: "fits",
    type,
    offset: 0,
    minimum: 0,
  });
  const word = viewEmitted(fits(scalar("u32")), ["number"], "boolean");
  assert.ok(
    contains(word, [
      { op: "fcvtzu-w-d", rd: 12, rn: 0 },
      { op: "ucvtf-d-w", rd: 1, rn: 12 },
      { op: "fcmp", rn: 0, rm: 1 },
      { op: "cset", rd: 9, condition: "eq" },
    ]),
  );
  // Narrow types also compare the extension; 64-bit types reject the
  // saturation bound (CMN x12, #1).
  const narrow = viewEmitted(fits(scalar("i8")), ["number"], "boolean");
  assert.ok(
    contains(narrow, [
      { op: "sbfm", width: 32, rd: 10, rn: 12, immr: 0, imms: 7 },
      {
        op: "sub-reg",
        width: 32,
        rd: "zr",
        rn: 10,
        rm: 12,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      },
      { op: "cset", rd: 10, condition: "eq" },
      { op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 },
    ]),
  );
  const wide = viewEmitted(fits(address), ["number"], "boolean");
  assert.ok(
    contains(wide, [
      {
        op: "add-imm",
        width: 64,
        rd: "zr",
        rn: 12,
        immediate: 1,
        shift: 0,
        setFlags: true,
      },
      { op: "cset", rd: 10, condition: "ne" },
    ]),
  );
  for (const bad of [scalar("f64"), scalar("bool")])
    assert.equal(
      bindForeignCalls(stub(["number"], "boolean"), [
        { function: 0, memory: fits(bad) },
      ]).ok,
      false,
    );
});

test("a 64-bit c-call result rejects the saturation bound", () => {
  // 2^63 - 1 rounds to 2^63, which converts back to 2^63 - 1, so the bound
  // itself must trap.
  const call = emitted(
    {
      call: {
        symbol: "labs",
        signature: {
          parameters: [scalar("i64")],
          result: scalar("i64"),
          fixedParameters: 1,
          callClass: "leaf",
          errno: "none",
        },
        operands: ["number"],
        result: "number",
      },
    },
    ["number"],
    "number",
  );
  assert.ok(
    contains(call, [
      {
        op: "add-imm",
        width: 64,
        rd: "zr",
        rn: 0,
        immediate: 1,
        shift: 0,
        setFlags: true,
      },
    ]),
  );
});

test("unaligned and distant members form the address first", () => {
  const packed = viewEmitted(
    field("store", scalar("u32"), 5, 16),
    ["Uint8Array", "number"],
    "void",
  );
  assert.ok(
    contains(packed, [
      dataPointer,
      {
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: 11,
        immediate: 5,
        shift: 0,
        setFlags: false,
      },
      { op: "str", width: 32, rt: 12, rn: 13, offset: 0 },
    ]),
  );
  const half = viewEmitted(
    field("load", scalar("u16"), 8191, 8193),
    ["Uint8Array"],
    "number",
  );
  assert.ok(contains(half, [{ op: "ldrh", rt: 12, rn: 13, offset: 0 }]));
});

test("view elements add the proven index times the stride", () => {
  const element = (stride: number, count: number): ForeignMemoryAccess => ({
    operation: "load",
    type: scalar("u32"),
    offset: 12,
    minimum: 12 + stride * count,
    stride,
    length: count,
  });
  const scaled = viewEmitted(element(4, 4), ["Uint8Array", "number"], "number");
  assert.ok(contains(scaled, [dataPointer]));
  assert.ok(
    contains(scaled, [
      { op: "fcvtzu-x-d", rd: 10, rn: 1 },
      {
        op: "add-reg",
        width: 64,
        rd: 13,
        rn: 11,
        rm: 10,
        shift: "lsl",
        amount: 2,
        setFlags: false,
      },
      { op: "ldr", width: 32, rt: 12, rn: 13, offset: 12 },
    ]),
  );
  const multiplied = viewEmitted(
    element(12, 3),
    ["Uint8Array", "number"],
    "number",
  );
  assert.ok(
    contains(multiplied, [
      { op: "madd", width: 64, rd: 13, rn: 10, rm: 14, ra: 11 },
      { op: "ldr", width: 32, rt: 12, rn: 13, offset: 12 },
    ]),
  );
  // The element range must fit the proven view.
  assert.equal(
    bindForeignCalls(stub(["Uint8Array", "number"], "number"), [
      { function: 0, memory: { ...element(4, 4), minimum: 27 } },
    ]).ok,
    false,
  );
});

test("external-storage primitives check the array kind before rewriting it", () => {
  const primitive = (
    operation: "address" | "adopt" | "retarget",
  ): ForeignMemoryAccess => ({
    operation,
    type: { kind: "void" },
    offset: 0,
    minimum: 0,
  });
  const kind: Instruction = {
    op: "ubfm",
    width: 64,
    rd: 10,
    rn: 10,
    immr: 48,
    imms: 50,
  };
  const where = emitted(
    { memory: primitive("address") },
    ["Uint8Array"],
    "number",
  );
  assert.ok(
    contains(where, [{ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 }, kind]),
  );
  assert.ok(
    contains(where, [
      { op: "csel", width: 64, rd: 11, rn: 11, rm: 12, condition: "eq" },
    ]),
  );
  const adopt = emitted(
    { memory: primitive("adopt") },
    ["Uint8Array", "number", "number"],
    "Uint8Array",
  );
  assert.ok(
    contains(adopt, [
      { op: "str", width: 64, rt: 10, rn: 9, offset: 0 },
      { op: "str", width: 64, rt: 13, rn: 9, offset: 8 },
      { op: "str", width: 64, rt: 12, rn: 9, offset: 16 },
    ]),
  );
  const retarget = emitted(
    { memory: primitive("retarget") },
    ["Uint8Array", "number"],
    "void",
  );
  assert.ok(contains(retarget, [kind]));
  assert.ok(
    contains(retarget, [{ op: "str", width: 64, rt: 12, rn: 9, offset: 16 }]),
  );
});

test("an availability query loads the import slot and compares it with zero", () => {
  const available: ForeignMemoryAccess = {
    operation: "available",
    type: { kind: "void" },
    offset: 0,
    minimum: 0,
    symbol: "inflateBack",
  };
  const bound = bindForeignCalls(stub([], "boolean"), [
    { function: 0, memory: available },
  ]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const module = emitModule(bound.value, { hostABI: darwinHostABI() });
  assert.ok(module.ok, JSON.stringify(module));
  for (const table of module.value.stackMaps) assert.equal(table.entries, 0);
  // The slot's address (an import fixup into x9, x10 scratch), one load and
  // the comparison; no call.
  assert.deepEqual(
    module.value.imports.map((reference) => [
      reference.target.kind === "import" ? reference.target.name : "?",
      reference.rd,
      reference.scratch,
    ]),
    [["_inflateBack", 9, 10]],
  );
  const code = module.value.code;
  const words = new Uint32Array(
    code.buffer.slice(code.byteOffset, code.byteOffset + code.byteLength),
  );
  assert.ok(
    contains(words, [
      { op: "ldr", width: 64, rt: 9, rn: 9, offset: 0 },
      {
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 9,
        immediate: 0,
        shift: 0,
        setFlags: true,
      },
      { op: "cset", rd: 9, condition: "ne" },
    ]),
  );
  assert.ok(!contains(words, [{ op: "blr", rn: 16 }]));
  // Symbols are validated; only queries name one.
  for (const memory of [
    { ...available, symbol: "1bad" },
    { ...available, symbol: undefined },
    { ...field("load", scalar("u32"), 0), symbol: "x" },
  ])
    assert.equal(
      bindForeignCalls(stub([], "boolean"), [{ function: 0, memory }]).ok,
      false,
    );
});

test("functions containing c-calls reserve C stack in their entry check", () => {
  const getpid: ForeignCall = {
    symbol: "getpid",
    signature: {
      parameters: [],
      result: { kind: "scalar", scalar: "i32" },
      fixedParameters: 0,
      callClass: "leaf",
      errno: "none",
    },
    operands: [],
    result: "number",
  };
  const code = emitted({ call: getpid }, [], "number");
  // SUB x17, sp, #16, LSL #12 (the 64 KiB reserve), then the limit compare.
  assert.ok(
    contains(code, [
      {
        op: "sub-imm",
        width: 64,
        rd: 17,
        rn: "sp",
        immediate: 16,
        shift: 12,
        setFlags: false,
      },
      {
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 17,
        rm: 16,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      },
    ]),
  );
});

test("the universal trampoline loads every argument register from its frame and calls the address", () => {
  const call = dynamicForeignCall(),
    frame = dynamicCallFrame;
  assert.deepEqual(foreignCallTypes(call), {
    ok: true,
    value: {
      parameters: [
        "number",
        "Uint8Array",
        ...Array.from({ length: frame.byteOperands }, () => "Uint8Array"),
      ],
      result: "void",
    },
  });
  // Only the exact trampoline shape is a dynamic call.
  assert.equal(foreignCallTypes({ ...call, symbol: "write" }).ok, false);
  assert.equal(
    foreignCallTypes({ ...call, operands: call.operands.slice(1) }).ok,
    false,
  );
  const parameters: ScalarType[] = ["number"];
  for (let index = 0; index <= frame.byteOperands; index++)
    parameters.push("Uint8Array");
  const code = emitted({ call }, parameters, "void");
  // x8, d0-d7 and x0-x7 from the frame (x12), then blr to the address.
  const loads: Instruction[] = [
    { op: "ldr", width: 64, rt: 8, rn: 12, offset: frame.indirect },
  ];
  for (let register = 0; register < 8; register += 2)
    loads.push({
      op: "ldp-d",
      rt: register,
      rt2: register + 1,
      rn: 12,
      offset: frame.floats + register * 8,
    });
  for (let register = 0; register < 8; register += 2)
    loads.push({
      op: "ldp",
      width: 64,
      rt: register,
      rt2: register + 1,
      rn: 12,
      offset: frame.registers + register * 8,
      mode: "offset",
    });
  loads.push({ op: "blr", rn: 15 });
  assert.ok(contains(code, loads));
  // Results x0, x1 and d0-d3 back into the frame.
  assert.ok(
    contains(code, [
      {
        op: "stp",
        width: 64,
        rt: 0,
        rt2: 1,
        rn: 12,
        offset: frame.registers,
        mode: "offset",
      },
      { op: "stp-d", rt: 0, rt2: 1, rn: 12, offset: frame.floats },
      { op: "stp-d", rt: 2, rt2: 3, rn: 12, offset: frame.floats + 16 },
    ]),
  );
  // Stack words are copied one at a time into the outgoing area at sp.
  assert.ok(
    contains(code, [
      { op: "ldr", width: 64, rt: 14, rn: 10, offset: 0 },
      { op: "str", width: 64, rt: 14, rn: 11, offset: 0 },
    ]),
  );
  // Patches store base + addend at a frame word.
  assert.ok(
    contains(code, [
      {
        op: "str-indexed",
        size: 3,
        fp: false,
        rt: 14,
        rn: 12,
        rm: 11,
        scaled: false,
      },
    ]),
  );
});

test("an indirect c-call converts its callee first and branches to it, never to 0", () => {
  const call: ForeignCall = {
    symbol: "q_sum",
    signature: {
      parameters: [scalar("u32"), scalar("f64")],
      result: scalar("u32"),
      fixedParameters: 2,
      callClass: "leaf",
      errno: "none",
    },
    operands: ["number", "number"],
    result: "number",
    indirect: true,
  };
  assert.deepEqual(foreignCallTypes(call), {
    ok: true,
    value: { parameters: ["number", "number", "number"], result: "number" },
  });
  const code = emitted({ call }, ["number", "number", "number"], "number");
  // The callee (x15) is checked before the arguments; the call is blr x15
  // with no import.
  assert.ok(contains(code, [{ op: "blr", rn: 15 }]));
  assert.ok(!contains(code, [{ op: "blr", rn: 16 }]));
});

test("a may-callback call pushes and pops its transition, is a safepoint and saves x19..x28", () => {
  const call: ForeignCall = {
    symbol: "qsort",
    signature: {
      parameters: [address, scalar("u64"), scalar("u64"), address],
      result: { kind: "void" },
      fixedParameters: 4,
      callClass: "may-callback",
      errno: "none",
    },
    // The callback state and dispatcher, then the C arguments (the
    // comparator here as a plain address).
    operands: ["bytes", "callback", "bytes", "number", "number", "number"],
    result: "void",
    mayCallback: true,
  };
  const types: ScalarType[] = [
    "Uint8Array",
    "reference",
    "Uint8Array",
    "number",
    "number",
    "number",
  ];
  assert.deepEqual(foreignCallTypes(call), {
    ok: true,
    value: { parameters: types, result: "void" },
  });
  // The state and dispatcher come first, and only may-callback signatures
  // qualify.
  assert.equal(
    foreignCallTypes({
      ...call,
      signature: { ...call.signature, callClass: "leaf" },
    }).ok,
    false,
  );
  const bound = bindForeignCalls(stub(types, "void"), [{ function: 0, call }]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const module = emitModule(bound.value, { hostABI: darwinHostABI() });
  assert.ok(module.ok, JSON.stringify(module));
  // One safepoint: the call's return address.
  assert.equal(
    module.value.stackMaps.reduce((total, table) => total + table.entries, 0),
    1,
  );
  const bytes = module.value.code,
    code = new Uint32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  const t = callbackTransition;
  // Push: previous, x29, the return address, entered = 0, the thread, the
  // context and the dispatcher, then current.
  assert.ok(
    contains(code, [
      { op: "ldr", width: 64, rt: 12, rn: 14, offset: callbackState.current },
      { op: "str", width: 64, rt: 12, rn: 13, offset: t.previous },
      { op: "str", width: 64, rt: 29, rn: 13, offset: t.frame },
    ]),
  );
  assert.ok(
    contains(code, [
      { op: "str", width: 64, rt: "zr", rn: 13, offset: t.entered },
      { op: "mrs-thread", rt: 12, readOnly: true },
      { op: "str", width: 64, rt: 12, rn: 13, offset: t.thread },
    ]),
  );
  assert.ok(
    contains(code, [
      { op: "str", width: 64, rt: 9, rn: 13, offset: t.registered },
      { op: "str", width: 64, rt: 13, rn: 14, offset: callbackState.current },
    ]),
  );
  // Every callee-saved GP register is saved (callers' references may be
  // held in any of them while C runs).
  for (const pair of [
    [19, 20],
    [21, 22],
    [23, 24],
    [25, 26],
    [27, 28],
  ]) {
    const [first, second] = pair;
    if (first === undefined || second === undefined) continue;
    let found = false;
    for (let at = 0; at < code.length && !found; at++)
      for (let offset = 0; offset < 512 && !found; offset += 8)
        found =
          code[at] ===
          word({
            op: "stp",
            width: 64,
            rt: first,
            rt2: second,
            rn: "sp",
            offset,
            mode: "offset",
          });
    assert.ok(found, "stp x" + first + ", x" + second);
  }
});
