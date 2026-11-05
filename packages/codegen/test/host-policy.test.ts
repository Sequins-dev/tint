import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
const span = { start: 0, end: 1 };
function clock(): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "clock",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "host-call",
                id: 0,
                operation: "monotonic-time",
                arguments: [],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
}
test("OS-dependent instruction generation requires explicit host policy", async () => {
  const missing = emitModule(clock());
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error.message, /host ABI/);
  const { darwinHostABI } = await import("@tint/platform/darwin/host-abi");
  const target = emitModule(clock(), { hostABI: darwinHostABI() });
  assert.ok(target.ok, JSON.stringify(target));
  assert.ok(
    target.value.imports.some(
      (reference) =>
        reference.target.kind === "import" &&
        reference.target.name === "_clock_gettime_nsec_np",
    ),
  );
  const alternate = emitModule(clock(), {
    hostABI: {
      ...darwinHostABI(),
      clockNanosecondsSymbol: "custom_clock",
      monotonicClockId: 23,
    },
  });
  assert.ok(alternate.ok);
  assert.ok(
    alternate.value.imports.some(
      (reference) =>
        reference.target.kind === "import" &&
        reference.target.name === "custom_clock",
    ),
  );
  assert.ok(
    !alternate.value.imports.some(
      (reference) =>
        reference.target.kind === "import" &&
        reference.target.name.startsWith("_clock"),
    ),
  );
});
