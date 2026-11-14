import assert from "node:assert/strict";
import test from "node:test";
import { provenWordArguments } from "../src/scalar/word-arguments.ts";
import type { FunctionIR, ModuleIR, Instruction } from "../src/scalar/model.ts";
const s = { start: 0, end: 0 };
function callee(): FunctionIR {
  return {
    id: 1,
    name: "callee",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: { kind: "return", value: 0, ...s },
      },
    ],
  };
}
function fixture(value = 42, extra: readonly Instruction[] = []): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "entry",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value, ...s },
              { kind: "call", id: 1, target: 1, arguments: [0], ...s },
              ...extra,
            ],
            terminator: { kind: "return", value: undefined, ...s },
          },
        ],
      },
      callee(),
    ],
  };
}
test("closed direct callers establish integer parameters despite exported source declarations", () => {
  assert.equal(provenWordArguments(fixture(), [0])?.[1]?.[0], 1);
  assert.equal(provenWordArguments(fixture(0.5), [0])?.[1]?.[0], 4);
});
test("every call contributes including incompatible calls in unreachable functions", () => {
  const m = fixture();
  const caller = {
    ...m.functions[0]!,
    id: 2,
    blocks: fixture(0.5).functions[0]!.blocks,
  };
  assert.equal(
    provenWordArguments(
      { ...m, functions: [...m.functions, caller] },
      [0],
    )?.[1]?.[0],
    5,
  );
});
test("external entry and escaping function values retain unknown arguments", () => {
  assert.equal(provenWordArguments(fixture(), [0, 1])?.[1]?.[0], 0);
  assert.equal(
    provenWordArguments(
      fixture(42, [{ kind: "function-new", id: 2, target: 1, ...s }]),
      [0],
    )?.[1]?.[0],
    0,
  );
});
test("missing callers and exhausted work publish no speculative parameter proof", () => {
  const m = fixture();
  assert.equal(
    provenWordArguments(
      { ...m, functions: [{ ...callee(), id: 0 }] },
      [],
    )?.[0]?.[0],
    0,
  );
  assert.equal(provenWordArguments(m, [0], undefined, 0), undefined);
  assert.equal(provenWordArguments(m, [9]), undefined);
});
test("address-only exports prevent caller-derived word argument facts", () => {
  const module = fixture(42, [
    { kind: "function-address", id: 2, target: 1, part: "signature", ...s },
  ]);
  assert.equal(provenWordArguments(module, [0])?.[1]?.[0], 0);
});
test("words flow through parameters passed along call chains", () => {
  // entry calls middle(42); middle passes its parameter on to callee.
  const base = fixture();
  const middle: FunctionIR = {
    id: 2,
    name: "middle",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "call", id: 1, target: 1, arguments: [0], ...s },
        ],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
  const entry = base.functions[0]!;
  const block = entry.blocks[0]!;
  const module: ModuleIR = {
    functions: [
      {
        ...entry,
        blocks: [
          {
            ...block,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...s },
              { kind: "call", id: 1, target: 2, arguments: [0], ...s },
            ],
          },
        ],
      },
      { ...callee(), exported: false },
      middle,
    ],
  };
  const words = provenWordArguments(module, [0]);
  assert.equal(words?.[2]?.[0], 1);
  assert.equal(words?.[1]?.[0], 1);
});
