import assert from "node:assert/strict";
import test from "node:test";
import {
  bindHostOperations,
  type HostOperation,
  type ModuleIR,
} from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
function words(code: Uint8Array): number[] {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength),
    result: number[] = [];
  for (let offset = 0; offset < view.byteLength; offset += 4)
    result.push(view.getUint32(offset, true));
  return result;
}
function word(instruction: Parameters<typeof encode>[0]): number {
  const encoded = encode(instruction);
  assert.ok(encoded.ok);
  return encoded.value;
}
test("collect-garbage calls the runtime allocator entry with request size 0", () => {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "collectGarbage",
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
    { function: 0, operation: "collect-garbage" as HostOperation },
  ]);
  assert.ok(bound.ok);
  const emitted = emitModule(bound.value);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const code = words(emitted.value.code);
  // Allocator code pointer (context +16) and environment (+24), then d0 = 0
  // from w9 and an indirect call through x16.
  const loadEntry = word({ op: "ldr", width: 64, rt: 16, rn: 0, offset: 16 }),
    loadEnvironment = word({ op: "ldr", width: 64, rt: 1, rn: 0, offset: 24 }),
    zeroRequest = word({ op: "ucvtf-d-w", rd: 0, rn: 9 }),
    call = word({ op: "blr", rn: 16 });
  const at = code.indexOf(call);
  assert.ok(at > 0, "allocator call");
  assert.equal(code.filter((w) => w === call).length, 1);
  assert.ok(code.slice(0, at).includes(loadEntry));
  assert.ok(code.slice(0, at).includes(loadEnvironment));
  assert.ok(code.slice(0, at).includes(zeroRequest));
  assert.deepEqual(emitted.value.imports, []);
});
