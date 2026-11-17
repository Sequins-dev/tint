import assert from "node:assert/strict";
import test from "node:test";
import {
  bindForeignCalls,
  type ForeignCall,
  type ModuleIR,
  type ScalarType,
  type ReturnType,
} from "@tint/ir/scalar";
import type { CType } from "@tint/abi/c";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";

const s = (
  scalar: "i8" | "u16" | "i32" | "u32" | "i64" | "u64" | "f32" | "f64",
): CType => ({
  kind: "scalar",
  scalar,
});
const pointer: CType = { kind: "pointer", pointee: s("i32") };
function record(name: string, fields: CType[]): CType {
  return {
    kind: "record",
    name,
    union: false,
    packed: false,
    alignment: 0,
    fields: fields.map((type, index) => ({ name: "f" + index, type })),
  };
}
/** One function bound to `call` with matching parameters. */
function bound(
  call: ForeignCall,
  parameters: ScalarType[],
  result: ReturnType,
): ModuleIR {
  const slots = parameters.slice();
  if (result !== "void") slots.push(result);
  const stub: ModuleIR = {
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
  const module = bindForeignCalls(stub, [{ function: 0, call }]);
  if (!module.ok) throw new Error(module.error);
  return module.value;
}
function imports(module: ModuleIR): string[] {
  const emitted = emitModule(module, { hostABI: darwinHostABI() });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  // A leaf call is never a safepoint.
  for (const table of emitted.value.stackMaps) assert.equal(table.entries, 0);
  return emitted.value.imports.map((reference) =>
    reference.target.kind === "import" ? reference.target.name : "?",
  );
}

test("c-calls import their symbol, capture errno and emit no safepoints", () => {
  const write = bound(
    {
      symbol: "write",
      signature: {
        parameters: [s("i32"), pointer, s("u64")],
        result: s("i64"),
        fixedParameters: 3,
        callClass: "leaf",
        errno: "negated-result",
      },
      operands: ["number", "bytes", "number"],
      result: "number",
    },
    ["number", "Uint8Array", "number"],
    "number",
  );
  assert.deepEqual(imports(write), ["_write", "___error"]);
});

test("every argument class and record result lowers on the target ABI", () => {
  const big = record("big", [s("i64"), s("i64"), s("i64")]),
    hfa = record("hfa", [s("f32"), s("f32"), s("f32")]),
    pair = record("pair", [s("i64"), s("i32")]);
  const parameters: CType[] = [
    s("i8"),
    s("u16"),
    s("u32"),
    s("f32"),
    s("f64"),
    pair,
    hfa,
    big,
  ];
  // Fill the X registers so later integers and records go to the stack.
  for (let i = 0; i < 6; i++) parameters.push(s("i64"));
  parameters.push(pair, s("i8"), s("f64"));
  const operands = parameters.map((type) =>
    type.kind === "record" ? ("record" as const) : ("number" as const),
  );
  for (const result of [pair, hfa, big]) {
    const module = bound(
      {
        symbol: "probe",
        signature: {
          parameters,
          result,
          fixedParameters: parameters.length - 2,
          callClass: "leaf",
          errno: "none",
        },
        operands,
        result: "record",
      },
      [
        ...operands.map((form): ScalarType =>
          form === "record" ? "Uint8Array" : "number",
        ),
        "Uint8Array",
      ],
      "void",
    );
    assert.deepEqual(imports(module), ["_probe"]);
  }
});

test("targets without a C calling convention reject c-calls", () => {
  const module = bound(
    {
      symbol: "getpid",
      signature: {
        parameters: [],
        result: s("i32"),
        fixedParameters: 0,
        callClass: "leaf",
        errno: "none",
      },
      operands: [],
      result: "number",
    },
    [],
    "number",
  );
  const { c: _, ...withoutC } = darwinHostABI();
  const emitted = emitModule(module, { hostABI: withoutC });
  assert.equal(emitted.ok, false);
  if (!emitted.ok) assert.match(emitted.error.message, /C calling convention/);
});

test("import call sites stay exact when a function is re-emitted with long branches", () => {
  const span = { start: 0, end: 0 };
  // A c-call before over 1 MiB of code inside a conditional: the function
  // first emits compact branches, then rolls back and re-emits long ones.
  const body: ModuleIR["functions"][number]["blocks"][number]["instructions"][number][] =
    [
      {
        kind: "c-call",
        id: 2,
        arguments: [],
        call: {
          symbol: "getpid",
          signature: {
            parameters: [],
            result: s("i32"),
            fixedParameters: 0,
            callClass: "leaf",
            errno: "none",
          },
          operands: [],
          result: "number",
        },
        ...span,
      },
      { kind: "store", slot: 1, value: 2, ...span },
    ];
  for (let index = 0; index < 90000; index++) {
    body.push({
      kind: "constant",
      id: 1000000 + index,
      value: index + 0.5,
      ...span,
    });
    body.push({ kind: "store", slot: 1, value: 1000000 + index, ...span });
  }
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "far",
        exported: true,
        parameters: [0, 1],
        slots: ["boolean", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: {
              kind: "branch",
              condition: 0,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: body,
            terminator: { kind: "jump", target: 2, ...span },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  const emitted = emitModule(module, { hostABI: darwinHostABI() });
  assert.ok(emitted.ok, JSON.stringify(emitted).slice(0, 400));
  assert.ok((emitted.value.functions[0]?.byteLength ?? 0) > 1 << 20);
  const references = emitted.value.imports;
  assert.equal(references.length, 1);
  const view = new DataView(
    emitted.value.code.buffer,
    emitted.value.code.byteOffset,
  );
  // ADR x16 starts the recorded import sequence.
  const word = view.getUint32(references[0]!.offset, true);
  assert.equal((word & 0x9f00001f) >>> 0, 0x10000010);
});
