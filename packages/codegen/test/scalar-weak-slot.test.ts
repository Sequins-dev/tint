import test from "node:test";
import assert from "node:assert/strict";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode, type Instruction } from "../src/aarch64/isa.ts";
const s = { start: 0, end: 0 };
const module: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "weak",
      exported: true,
      parameters: [0, 1, 2],
      slots: ["general", "general", "boolean"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "load", id: 1, slot: 1, ...s },
            { kind: "load", id: 2, slot: 2, ...s },
            {
              kind: "weak-slot-new",
              id: 3,
              key: 0,
              value: 1,
              ephemeron: 2,
              ...s,
            },
            { kind: "weak-slot-key", id: 4, cell: 3, ...s },
            { kind: "weak-slot-value", id: 5, cell: 3, ...s },
            { kind: "weak-slot-set-value", cell: 3, value: 1, ...s },
            { kind: "weak-slot-clear", cell: 3, ...s },
          ],
          terminator: { kind: "return", value: 4, ...s },
        },
      ],
    },
  ],
};
test("weak operations emit with rooted general values across both allocation paths", () => {
  for (const linearAllocation of [false, true]) {
    const result = emitModule(module, { linearAllocation });
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("generational weak operations remember ephemeron stores without a heap flag", () => {
  const result = emitModule(module, { generationalBarriers: true });
  assert.ok(result.ok, JSON.stringify(result));
  const code = result.value.code,
    words = new Uint32Array(
      code.buffer.slice(code.byteOffset, code.byteOffset + code.byteLength),
    );
  const word = (instruction: Instruction): number => {
    const encoded = encode(instruction);
    assert.ok(encoded.ok);
    return encoded.value;
  };
  const contains = (sequence: readonly Instruction[]): boolean => {
    const expected = sequence.map(word);
    for (let at = 0; at + expected.length <= words.length; at++)
      if (expected.every((value, index) => words[at + index] === value))
        return true;
    return false;
  };
  // The allocation no longer sets a weak flag in the generational state
  // (word 15): every collector path handles weak slots...
  assert.ok(
    !contains([
      { op: "ldr", width: 64, rt: 12, rn: 10, offset: 56 },
      { op: "cbz", width: 64, rt: 12, displacement: 12 },
      { op: "movz", width: 32, rd: 13, immediate: 1, shift: 0 },
      { op: "str", width: 32, rt: 13, rn: 12, offset: 60 },
    ]),
  );
  // ...and the ephemeron value store runs the write barrier on the cell.
  assert.ok(contains([{ op: "orr-reg", width: 64, rd: 9, rn: "zr", rm: 10 }]));
  const unbarriered = emitModule(module, {});
  assert.ok(unbarriered.ok);
  assert.ok(unbarriered.value.code.byteLength < code.byteLength);
});
