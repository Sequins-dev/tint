import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleIR } from "@tint/ir/scalar";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { stringHelper } from "../src/aarch64/scalar/strings.ts";

test("UTF-16 comparison kernels compare full words and retain scalar tails", () => {
  for (const kind of ["string-equal", "string-starts-with"] as const) {
    const body = stringHelper(kind);
    assert.ok(body.some((op) => op.op === "ldr" && op.width === 64));
    assert.ok(body.some((op) => op.op === "ldrh"));
    assert.ok(body.every((op) => op.op !== "bl" && op.op !== "blr"));
  }
});

test("UTF-16 copy kernels copy full words without clobbering the destination", () => {
  for (const kind of ["string-concat-copy", "string-slice-copy"] as const) {
    const body = stringHelper(kind);
    assert.ok(body.some((op) => op.op === "ldr" && op.width === 64));
    assert.ok(body.some((op) => op.op === "ldrh"));
    assert.ok(body.every((op) => !("rd" in op) || op.rd !== 9));
    assert.ok(body.every((op) => op.op !== "bl" && op.op !== "blr"));
  }
});

test("from-code-units stores an exact integer without a conversion helper", () => {
  const span = { start: 0, end: 0 };
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "codeUnit",
        exported: true,
        parameters: [0],
        slots: ["Uint8Array"],
        returnType: "string",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "array-length", id: 1, array: 0, ...span },
              { kind: "constant", id: 2, value: 48, ...span },
              {
                kind: "binary",
                id: 3,
                operator: "|",
                left: 1,
                right: 2,
                ...span,
              },
              { kind: "string-from-code-units", id: 4, values: [3], ...span },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  };
  const result = emitModule(module, {
    hostABI: darwinHostABI(),
    operationRanges: true,
  });
  assert.ok(result.ok, JSON.stringify(result));
  const units = result.value.operationRanges?.find(
    ({ operation }) => operation === "string-from-code-units",
  );
  assert.match(units?.operands ?? "", /^word@/);
  assert.equal(
    result.value.helpers.some(({ kind }) => kind === "to-uint32"),
    false,
  );
});
