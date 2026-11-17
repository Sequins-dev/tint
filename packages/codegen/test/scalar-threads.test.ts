import assert from "node:assert/strict";
import test from "node:test";
import {
  bindHostOperations,
  type HostOperation,
  type ModuleIR,
} from "@tint/ir/scalar";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { linuxHostABI } from "@tint/platform/linux/host-abi";
import { emitModule } from "../src/aarch64/scalar/index.ts";
function bound(operation: HostOperation, count: number): ModuleIR {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "thread",
        exported: true,
        parameters: Array.from({ length: count }, (_, i) => i),
        slots: Array.from({ length: count }, () => "number" as const),
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: { kind: "return", value: undefined, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  const result = bindHostOperations(input, [{ function: 0, operation }]);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("native thread leaves require explicit platform lifecycle authority", () => {
  for (const [operation, count, symbol] of [
    ["thread-start", 2, "_pthread_create"],
    ["thread-join", 1, "_pthread_join"],
    ["word-park", 3, "___ulock_wait2"],
    ["word-wake", 2, "___ulock_wake"],
  ] as const) {
    const ir = bound(operation as HostOperation, count);
    assert.equal(emitModule(ir).ok, false);
    const result = emitModule(ir, { hostABI: darwinHostABI() });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(
      [...new Set(result.value.imports.map((r) => r.target.name))],
      [symbol],
    );
  }
});
test("glibc thread leaves use pthread and futex(2) through syscall", () => {
  for (const [operation, count, symbols] of [
    ["thread-start", 2, ["pthread_create"]],
    ["thread-join", 1, ["pthread_join"]],
    ["word-park", 3, ["syscall", "__errno_location"]],
    ["word-wake", 2, ["syscall", "__errno_location"]],
  ] as const) {
    const result = emitModule(bound(operation as HostOperation, count), {
      hostABI: linuxHostABI(),
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(
      [...new Set(result.value.imports.map((r) => r.target.name))],
      symbols,
    );
  }
});
