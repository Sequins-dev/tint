import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { decodeStackMaps, emitModule } from "@tint/codegen/aarch64/scalar";
import {
  scanNativeObject,
  createNativeRootScan,
} from "@tint/native-runtime/tracing";
import { ownedClosureFixture } from "./owned-closure-fixture.ts";
import { generalValueFixture } from "./general-value-fixture.ts";

test("retired layout/tracing prototypes have no parallel production owner", () => {
  for (const name of [
    "trace-plan",
    "gc-tracing",
    "closure-tracing",
    "value-layout",
  ])
    assert.equal(existsSync("packages/" + name), false, name);
});
for (const [name, fixture] of [
  ["closure", ownedClosureFixture],
  ["tagged record", generalValueFixture],
] as const) {
  test("production emitter descriptors and collector agree for " + name, () => {
    const emitted = emitModule(fixture());
    assert.ok(emitted.ok, JSON.stringify(emitted));
    const image = emitted.value,
      codeBase = 8192;
    const bytes = new DataView(
      image.code.buffer,
      image.code.byteOffset,
      image.code.byteLength,
    );
    for (const referenceTag of [1, 3]) {
      for (const descriptor of image.records) {
        const words = new Map<number, number>([
          [256, codeBase + descriptor.offset],
          [264, 0],
        ]);
        const expected: number[] = [];
        for (const offset of descriptor.referenceOffsets) {
          words.set(256 + offset, 512);
          expected.push(512);
        }
        for (const offset of descriptor.generalOffsets) {
          words.set(256 + offset, referenceTag);
          words.set(264 + offset, 768);
          if (referenceTag === 3) expected.push(768);
        }
        const read = (address: number) =>
          address >= codeBase && address + 8 <= codeBase + image.code.length
            ? Number(bytes.getBigUint64(address - codeBase, true))
            : words.get(address);
        const seen: number[] = [];
        assert.equal(
          scanNativeObject(read, 256, descriptor.byteLength, (pointer) => {
            seen.push(pointer);
            return true;
          }),
          "complete",
        );
        assert.deepEqual(seen, expected);
        if (expected.length > 0)
          assert.equal(
            scanNativeObject(read, 256, descriptor.byteLength, () => false),
            "visitor",
          );
      }
      // Each safepoint, walked through the emitted table: one managed frame
      // whose call returns to it, below an entry frame.
      const table = image.stackMaps[0]!;
      for (const safepoint of decodeStackMaps(image) ?? []) {
        const registry = 4096,
          sp = 65536,
          words = new Map<number, number>([
            [registry, 1],
            [registry + 8, 1],
            [registry + 16, sp - 16],
            [registry + 24, 0],
            [registry + 32, codeBase],
            [registry + 40, image.code.length],
            [registry + 48, codeBase + table.tableOffset],
            [sp - 16, sp + safepoint.frameBytes],
            [sp - 8, codeBase + safepoint.offset],
            // The frame's caller is the entry record (saved fp 0).
            [sp + safepoint.frameBytes, sp + safepoint.frameBytes + 16],
            [sp + safepoint.frameBytes + 8, 0],
            [sp + safepoint.frameBytes + 16, 0],
            [sp + safepoint.frameBytes + 24, 0],
          ]),
          expected: number[] = [];
        for (const offset of safepoint.references) {
          words.set(sp + offset, 512);
          expected.push(512);
        }
        for (const offset of safepoint.generals) {
          words.set(sp + offset, referenceTag);
          words.set(sp + offset + 8, 768);
          if (referenceTag === 3) expected.push(768);
        }
        const read = (address: number) =>
          address >= codeBase && address + 8 <= codeBase + image.code.length
            ? Number(bytes.getBigUint64(address - codeBase, true))
            : words.get(address);
        const seen: number[] = [];
        assert.equal(
          createNativeRootScan(read)(registry, (pointer) => {
            seen.push(pointer);
            return true;
          }),
          "complete",
        );
        assert.deepEqual(seen, expected);
      }
    }
  });
}
