import { initializeExternalMemory } from "./external-memory.ts";
import { createCollectingRegion } from "./heap/index.ts";
import { readMemoryWord, currentRootHead } from "./intrinsics/memory.ts";
function contains(base: number, length: number, address: number): boolean {
  return address >= base && address - base <= length - 8;
}
function valid(base: number, length: number): boolean {
  return (
    Number.isSafeInteger(base) &&
    base > 0 &&
    base % 16 === 0 &&
    Number.isInteger(length) &&
    length >= 16 &&
    Number.isSafeInteger(base + length)
  );
}
/** Startup supplies live disjoint memory windows and borrowed collector arrays.
 * This factory runs on the permanent control allocator. Its returned function
 * becomes the managed allocation callback in the same runtime context. */
export function initializeRuntime(
  managedBase: number,
  managedLength: number,
  controlBase: number,
  controlLength: number,
  imageBase: number,
  imageLength: number,
  stackBase: number,
  stackLength: number,
  metadata: Uint32Array,
  offsets: Uint32Array,
  sizes: Uint32Array,
  starts: Float64Array,
  marks: Uint8Array,
  pending: Uint32Array,
  roots: Float64Array,
): (bytes: number) => number | undefined {
  if (
    !valid(managedBase, managedLength) ||
    !valid(controlBase, controlLength) ||
    !valid(imageBase, imageLength) ||
    !valid(stackBase, stackLength)
  )
    throw "INVALID_RUNTIME_WINDOWS";
  const external = initializeExternalMemory(
    managedBase,
    managedLength,
    controlBase,
    controlLength,
    imageBase,
    imageLength,
    stackBase,
    stackLength,
  );
  const workBudget = (metadata.length + roots.length) * 16;
  const heap = createCollectingRegion({
    base: managedBase,
    byteLength: managedLength,
    metadata,
    offsets,
    sizes,
    starts,
    marks,
    pending,
    roots,
    maxSteps: workBudget > 0xffffffff ? 0xffffffff : workBudget,
    // Reads the root head in this frame, which saves every callee-saved
    // register, and keeps it live while the collection walks its callers.
    withRootHead: (collect) => collect(currentRootHead()),
    isExternal: (address) =>
      contains(controlBase, controlLength, address) ||
      contains(imageBase, imageLength, address) ||
      external.contains(address, 8),
    readWord: (address) => {
      let value = -1;
      if (contains(managedBase, managedLength, address))
        value = readMemoryWord(
          managedBase,
          managedLength,
          address - managedBase,
        );
      else if (contains(controlBase, controlLength, address))
        value = readMemoryWord(
          controlBase,
          controlLength,
          address - controlBase,
        );
      else if (contains(imageBase, imageLength, address))
        value = readMemoryWord(imageBase, imageLength, address - imageBase);
      else if (contains(stackBase, stackLength, address))
        value = readMemoryWord(stackBase, stackLength, address - stackBase);
      else if (external.contains(address, 8))
        value = readMemoryWord(address, 8, 0);
      return value < 0 ? undefined : value;
    },
  });
  if (heap === undefined) throw "INVALID_RUNTIME_HEAP";
  return heap.allocate;
}

export { initializeGenerationalRuntime } from "./generational.ts";
