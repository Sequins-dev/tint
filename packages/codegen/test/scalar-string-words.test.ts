import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleIR } from "@tint/ir/scalar";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { stringHelper } from "../src/aarch64/scalar/strings.ts";

test("comparison kernels compare full words and both string kinds", () => {
  for (const kind of ["string-equal", "string-starts-with"] as const) {
    const body = stringHelper(kind);
    assert.ok(
      body.some(
        (op) =>
          (op.op === "ldr" && op.width === 64) ||
          (op.op === "ldr-indexed" && op.size === 3),
      ),
    );
    assert.ok(body.every((op) => op.op !== "bl" && op.op !== "blr"));
  }
  // Same-kind compares run on bytes, so tails are byte loads; a one-byte
  // search in a two-byte source compares each unit widened.
  const prefix = stringHelper("string-starts-with");
  assert.ok(prefix.some((op) => op.op === "ldrb"));
  assert.ok(prefix.some((op) => op.op === "ldrh"));
});

test("copy kernels copy full words, widen and narrow, keeping the destination", () => {
  for (const kind of [
    "string-concat-copy",
    "string-slice-copy",
    "string-write-copy",
  ] as const) {
    const body = stringHelper(kind);
    assert.ok(body.some((op) => op.op === "ldr" && op.width === 64));
    assert.ok(body.some((op) => op.op === "ldrb"));
    assert.ok(body.every((op) => !("rd" in op) || op.rd !== 9));
    assert.ok(body.every((op) => op.op !== "bl" && op.op !== "blr"));
  }
  // One-byte parts widen into two-byte results; a one-byte slice of a
  // two-byte source narrows.
  assert.ok(stringHelper("string-concat-copy").some((op) => op.op === "strh"));
  const slice = stringHelper("string-slice-copy");
  assert.ok(slice.some((op) => op.op === "ldrh"));
  assert.ok(slice.some((op) => op.op === "strb"));
  // The slice kind scan preserves its inputs (x9 source, x12/x13 bounds).
  const scan = stringHelper("string-slice-kind");
  assert.ok(
    scan.every(
      (op) => !("rd" in op) || (op.rd !== 9 && op.rd !== 12 && op.rd !== 13),
    ),
  );
  assert.ok(
    scan.every(
      (op) => !("rt" in op) || (op.rt !== 9 && op.rt !== 12 && op.rt !== 13),
    ),
  );
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
