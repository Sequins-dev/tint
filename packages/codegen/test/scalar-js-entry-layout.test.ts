import assert from "node:assert/strict";
import test from "node:test";
import { scriptArgumentLayout } from "../src/aarch64/scalar/abi.ts";
import { decodeStackMaps, emitModule } from "../src/aarch64/scalar/index.ts";
import { verify, type ModuleIR } from "@tint/ir/scalar";

test("a JavaScript entry takes an arbitrary actual count in register pairs and stack words", () => {
  assert.equal(scriptArgumentLayout(0).stackBytes, 0);
  assert.deepEqual(scriptArgumentLayout(1), {
    registerArguments: 1,
    stackBytes: 0,
  });
  assert.deepEqual(scriptArgumentLayout(3), {
    registerArguments: 3,
    stackBytes: 0,
  });
  assert.deepEqual(scriptArgumentLayout(10), {
    registerArguments: 3,
    stackBytes: 112,
  });
});

const span = { start: 0, end: 0 };
export const scriptCall: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "source",
      exported: false,
      scriptEntry: true,
      parameters: [0, 1, 2, 3],
      slots: ["general", "general", "general", "optional-reference"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "script-argument-count", id: 0, ...span },
            { kind: "constant", id: 1, value: 1, ...span },
            {
              kind: "binary",
              id: 2,
              operator: "-",
              left: 0,
              right: 1,
              ...span,
            },
            {
              kind: "host-call",
              operation: "collect-garbage",
              id: undefined,
              arguments: [],
              ...span,
            },
            { kind: "script-argument", id: 3, index: 2, ...span },
          ],
          terminator: { kind: "return", value: 3, ...span },
        },
      ],
    },
    {
      id: 1,
      name: "main",
      exported: true,
      parameters: [],
      slots: [],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "function-new", id: 0, target: 0, ...span },
            { kind: "general-none", id: 1, ...span },
            { kind: "constant", id: 2, value: 42, ...span },
            { kind: "general-wrap", id: 3, value: 2, ...span },
            { kind: "reference-none", id: 6, ...span },
            {
              kind: "call-indirect",
              id: 4,
              target: 0,
              callee: 0,
              arguments: [1, 1, 1, 6],
              scriptArguments: [1, 1, 1, 1, 1, 1, 3],
              ...span,
            },
            { kind: "general-value", id: 5, type: "number", value: 4, ...span },
          ],
          terminator: { kind: "return", value: 5, ...span },
        },
      ],
    },
  ],
};

test("a variadic source call lowers its argument reads and roots its overflow area", () => {
  assert.ok(verify(scriptCall).ok);
  const emitted = emitModule(scriptCall, { closedRoots: [1] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const maps = decodeStackMaps(emitted.value);
  assert.ok(maps);
  const source = emitted.value.functions[0]!;
  const caller = emitted.value.functions[1]!;
  const inside = maps.find(
    (site) =>
      site.offset > source.offset &&
      site.offset <= source.offset + source.byteLength,
  );
  assert.ok(inside);
  assert.equal(inside.generals.length, 3);
  assert.ok(
    maps.some(
      (site) =>
        site.offset > caller.offset &&
        site.offset <= caller.offset + caller.byteLength &&
        [0, 16, 32, 48].every((offset) => site.generals.includes(offset)),
    ),
  );
});
