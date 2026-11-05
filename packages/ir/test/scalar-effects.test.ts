import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeEffects,
  instructionEffects,
  effectAllocate,
  effectThrow,
  effectUnknown,
  effectWriteHeap,
  effectReadHeap,
} from "../src/scalar/effects.ts";
import type { ModuleIR } from "../src/scalar/model.ts";
const s = { start: 0, end: 0 };
test("function environment extraction reads heap without allocation or invocation", () => {
  assert.equal(
    instructionEffects({
      kind: "function-environment",
      id: 1,
      callee: 0,
      ...s,
    }),
    effectReadHeap,
  );
});
test("allocation, mutable memory, and exceptions are independent effects", () => {
  const allocation = instructionEffects({
    kind: "record-new",
    id: 0,
    record: 0,
    arguments: [],
    ...s,
  });
  assert.ok(allocation & effectAllocate);
  assert.ok(allocation & effectThrow);
  assert.equal(allocation & effectWriteHeap, 0);
  const write = instructionEffects({
    kind: "array-write",
    array: 0,
    index: 1,
    value: 2,
    ...s,
  });
  assert.ok(write & effectWriteHeap);
  assert.equal(write & (effectAllocate | effectThrow), 0);
});
test("recursive effect summaries converge and preserve independent call components", () => {
  const module: ModuleIR = {
    functions: [0, 1, 2].map((id) => ({
      id,
      name: "f",
      exported: true,
      parameters: [],
      slots: [],
      returnType: "void",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions:
            id === 2
              ? []
              : [
                  {
                    kind: "call",
                    id: undefined,
                    target: 1 - id,
                    arguments: [],
                    ...s,
                  },
                ],
          terminator:
            id === 1
              ? { kind: "throw-literal", value: "error", ...s }
              : { kind: "return", value: undefined, ...s },
        },
      ],
    })),
  };
  const effects = summarizeEffects(module)!;
  assert.ok(effects[0]! & effectThrow);
  assert.ok(effects[1]! & effectThrow);
  assert.equal(effects[2], 0);
  assert.equal(effects[0]! & effectAllocate, 0);
  assert.equal(summarizeEffects(module, 1), undefined);
});
test("opaque calls conservatively carry every effect", () => {
  assert.equal(
    instructionEffects({
      kind: "call-indirect",
      id: undefined,
      target: 0,
      callee: 0,
      arguments: [],
      ...s,
    }),
    effectUnknown,
  );
});
