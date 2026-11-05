import assert from "node:assert/strict";
import test from "node:test";
import {
  bindHostOperations,
  type HostOperation,
  type ModuleIR,
} from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
test("trusted cpu pause emits the existing YIELD oracle without helpers or OS imports", () => {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "cpuPause",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "void",
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
  const bound = bindHostOperations(input, [
    { function: 0, operation: "cpu-pause" as HostOperation },
  ]);
  assert.ok(bound.ok);
  const emitted = emitModule(bound.value);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const oracle = encode({ op: "yield" });
  assert.ok(oracle.ok);
  assert.equal(oracle.value, 0xd503203f);
  const view = new DataView(
    emitted.value.code.buffer,
    emitted.value.code.byteOffset,
    emitted.value.code.byteLength,
  );
  let count = 0;
  for (let offset = 0; offset < view.byteLength; offset += 4)
    if (view.getUint32(offset, true) === oracle.value) count++;
  assert.equal(count, 1);
  assert.deepEqual(emitted.value.imports, []);
  assert.deepEqual(emitted.value.helpers, []);
});
