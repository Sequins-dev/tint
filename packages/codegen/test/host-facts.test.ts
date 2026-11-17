// Host facts (page size, available CPUs, SHA-256 instructions) lower to the
// target's own query: a constant where every kernel/CPU of the target
// agrees, else the C library call the host ABI names. Native execution of
// each form is covered by tools/native-host-facts.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PosixHostABI } from "@tint/abi/host";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { linuxHostABI } from "@tint/platform/linux/host-abi";
import {
  bindHostOperations,
  hostParameters,
  hostReturnType,
  type HostOperation,
  type ModuleIR,
} from "@tint/ir/scalar";
import { emitModule, type NativeModule } from "../src/aarch64/scalar/index.ts";

function bound(operation: HostOperation, hostABI: PosixHostABI): NativeModule {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: operation,
        exported: true,
        parameters: [],
        slots: [],
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
  const host = bindHostOperations(input, [{ function: 0, operation }]);
  assert.ok(host.ok, JSON.stringify(host));
  const emitted = emitModule(host.value, { hostABI });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  return emitted.value;
}
function imports(operation: HostOperation, hostABI: PosixHostABI): string[] {
  return bound(operation, hostABI).imports.map((i) => i.target.name);
}

test("host fact operations take no arguments and return numbers", () => {
  for (const operation of [
    "memory-page-bytes",
    "processor-count",
    "cpu-sha256",
  ] as const) {
    assert.deepEqual(hostParameters(operation), []);
    assert.equal(hostReturnType(operation), "number");
  }
});

test("Darwin's page size and SHA-256 support are constants; its CPU count is sysconf", () => {
  assert.deepEqual(imports("memory-page-bytes", darwinHostABI()), []);
  assert.deepEqual(imports("cpu-sha256", darwinHostABI()), []);
  assert.deepEqual(imports("processor-count", darwinHostABI()), ["_sysconf"]);
});

test("Linux queries the page size, the affinity mask and HWCAP", () => {
  assert.deepEqual(imports("memory-page-bytes", linuxHostABI()), [
    "getpagesize",
  ]);
  assert.deepEqual(imports("processor-count", linuxHostABI()), [
    "sched_getaffinity",
  ]);
  assert.deepEqual(imports("cpu-sha256", linuxHostABI()), ["getauxval"]);
  // The affinity mask is filled in the frame's outgoing area.
  const counted = bound("processor-count", linuxHostABI()).functions[0];
  assert.ok(counted !== undefined && counted.frameBytes >= 128);
});

test("an affinity mask that is not whole words fails explicitly", () => {
  const hostABI: PosixHostABI = {
    ...linuxHostABI(),
    processors: {
      kind: "affinity",
      symbol: "sched_getaffinity",
      maskBytes: 12,
    },
  };
  const host = bindHostOperations(
    {
      functions: [
        {
          id: 0,
          name: "count",
          exported: true,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [],
              terminator: {
                kind: "return",
                value: undefined,
                start: 0,
                end: 0,
              },
            },
          ],
        },
      ],
    },
    [{ function: 0, operation: "processor-count" }],
  );
  assert.ok(host.ok);
  const emitted = emitModule(host.value, { hostABI });
  assert.equal(emitted.ok, false);
  if (!emitted.ok) assert.match(emitted.error.message, /processor mask/);
});
