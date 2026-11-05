import assert from "node:assert/strict";
import test from "node:test";
import {
  scanNativeObjectWithVerifiedDescriptor,
  scanNativeRootsWithVerifiedDescriptors,
} from "../src/tracing/scan.ts";
function fixture() {
  return new Map<number, number>([
    [256, 4096],
    [264, 0],
    [272, 512],
    [280, 3],
    [288, 768],
    [4096, 48],
    [4104, 1],
    [4112, 16],
    [4120, 1],
    [4128, 24],
    [1024, 0],
    [1032, 4104],
    [1040, 512],
    [1048, 3],
    [1056, 768],
  ]);
}
test("verified descriptors retain exact pointer and general-value scanning", () => {
  const words = fixture(),
    read = (address: number) => words.get(address),
    seen: number[][] = [];
  assert.equal(
    scanNativeObjectWithVerifiedDescriptor(read, 256, 48, (value, slot) => {
      seen.push([value, slot]);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [
    [512, 272],
    [768, 288],
  ]);
  seen.length = 0;
  assert.equal(
    scanNativeRootsWithVerifiedDescriptors(read, 1024, (value, slot) => {
      seen.push([value, slot]);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [
    [512, 1040],
    [768, 1056],
  ]);
});
test("verified static descriptors do not waive dynamic tags, references, read authorization or limits", () => {
  const words = fixture(),
    read = (address: number) => words.get(address);
  assert.equal(
    scanNativeObjectWithVerifiedDescriptor(read, 256, 48, () => true, 1),
    "limit",
  );
  assert.equal(
    scanNativeObjectWithVerifiedDescriptor(read, 256, 48, () => false),
    "visitor",
  );
  words.set(280, 8);
  assert.equal(
    scanNativeObjectWithVerifiedDescriptor(read, 256, 48, () => true),
    "invalid",
  );
  words.set(280, 3);
  words.set(288, 769);
  assert.equal(
    scanNativeObjectWithVerifiedDescriptor(read, 256, 48, () => true),
    "invalid",
  );
  words.delete(288);
  assert.equal(
    scanNativeObjectWithVerifiedDescriptor(read, 256, 48, () => true),
    "read",
  );
  assert.equal(
    scanNativeRootsWithVerifiedDescriptors(read, 1024, () => true, 0),
    "limit",
  );
  words.set(1024, 1024);
  assert.equal(
    scanNativeRootsWithVerifiedDescriptors(read, 1024, () => true, 2),
    "limit",
  );
});
