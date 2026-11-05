import assert from "node:assert/strict";
import test from "node:test";
import { relativeAddress, writeInstruction } from "../src/aarch64/isa.ts";
import { aarch64ImageRelocations } from "../src/aarch64/image-relocations.ts";
test("target relocation adapters retain their own register and destination metadata", () => {
  const source = {
    offset: 0,
    rd: 1,
    scratch: 17,
    target: { kind: "data" as const, offset: 0 },
  };
  const adapter = aarch64ImageRelocations([source]);
  source.rd = 2;
  source.target.offset = 8;
  assert.deepEqual(adapter.addressFixups, [
    {
      offset: 0,
      byteLength: 16,
      alignment: 4,
      target: { kind: "data", offset: 0 },
    },
  ]);
  const code = new Uint8Array(32),
    instructions = relativeAddress(1, 17, 0);
  assert.ok(instructions.ok);
  for (let i = 0; i < instructions.value.length; i++)
    assert.ok(writeInstruction(code, i * 4, instructions.value[i]!).ok);
  assert.equal(adapter.patchAddress(code, 0, 0, 16), "complete");
});
