import assert from "node:assert/strict";
import test from "node:test";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
import type { ScalarType, FunctionIR } from "@tint/ir/scalar";
const span = { start: 0, end: 0 };

for (const type of [
  "number",
  "boolean",
  "optional-reference",
  "string",
] satisfies ScalarType[]) {
  test(`leaf ${type} copies stay in the FP storage bank without an integer round trip`, () => {
    const fn: FunctionIR = {
      id: 0,
      name: "copy",
      exported: true,
      parameters: [0],
      slots: [type, type],
      returnType: type,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...span },
            { kind: "store", slot: 1, value: 0, ...span },
            { kind: "load", id: 1, slot: 1, ...span },
          ],
          terminator: { kind: "return", value: 1, ...span },
        },
      ],
    };
    const result = emitModule({ functions: [fn] }, { closedRoots: [0] });
    assert.ok(result.ok, JSON.stringify(result));
    const view = new DataView(
      result.value.code.buffer,
      result.value.code.byteOffset,
      result.value.code.byteLength,
    );
    const words = Array.from({ length: view.byteLength / 4 }, (_, index) =>
      view.getUint32(index * 4, true),
    );
    const rawRoundTrips = words.filter((word) => {
      for (let register = 16; register < 32; register++) {
        const code = encode({ op: "fmov-x-d", rd: 9, rn: register });
        assert.ok(code.ok);
        if (word === code.value) return true;
      }
      return false;
    });
    assert.equal(
      rawRoundTrips.length,
      1,
      "only the result ABI may transfer through x9",
    );
  });
}

test("leaf storage planning assigns distinct whole-word homes and falls back on exhausted budgets", async () => {
  const { leafStorageRegisters } =
    await import("../src/aarch64/scalar/leaf-registers.ts");
  const fn: FunctionIR = {
    id: 0,
    name: "wide",
    exported: false,
    slots: ["general"],
    parameters: [0],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", slot: 0, id: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  const value = () => ({ offset: 32, type: "general" as const });
  const plan = leafStorageRegisters(fn, [16], value, 16, 48);
  assert.ok(plan);
  assert.equal(plan[0], 0);
  assert.equal(plan[1], 0);
  assert.equal(
    new Set(plan.slice(2)).size,
    4,
    "tag and payload words must never share a register",
  );
  assert.equal(leafStorageRegisters(fn, [16], value, 16, 48, 0), undefined);
  assert.equal(leafStorageRegisters(fn, [16], value, 16, 8000008), undefined);
});
