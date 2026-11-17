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
      clock: {
        kind: "nanoseconds",
        symbol: "custom_clock",
        monotonicId: 23,
        wallId: 0,
      },
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
test("POSIX timespec clocks and buffer entropy follow the host policy", async () => {
  const { linuxHostABI } = await import("@tint/platform/linux/host-abi");
  const clocked = emitModule(clock(), { hostABI: linuxHostABI() });
  assert.ok(clocked.ok, JSON.stringify(clocked));
  assert.deepEqual(
    clocked.value.imports.map((reference) => reference.target.name),
    ["clock_gettime"],
  );
  const random = clock();
  const fn = random.functions[0];
  const block = fn?.blocks[0];
  const call = block?.instructions[0];
  assert.ok(fn && block && call && call.kind === "host-call");
  const entropy = emitModule(
    {
      functions: [
        {
          ...fn,
          blocks: [
            {
              ...block,
              instructions: [{ ...call, operation: "random-word" }],
            },
          ],
        },
      ],
    },
    { hostABI: linuxHostABI() },
  );
  assert.ok(entropy.ok, JSON.stringify(entropy));
  assert.deepEqual(
    entropy.value.imports.map((reference) => reference.target.name),
    ["getrandom"],
  );
});
