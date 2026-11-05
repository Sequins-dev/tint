import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import {
  scanNativeObject,
  scanNativeRoots,
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
      for (const descriptor of image.roots) {
        const words = new Map<number, number>([
            [256, 0],
            [264, codeBase + descriptor.descriptorOffset],
          ]),
          expected: number[] = [];
        for (const offset of descriptor.offsets) {
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
          scanNativeRoots(read, 256, (pointer) => {
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
