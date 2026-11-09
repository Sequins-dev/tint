import { initializeExternalMemory } from "./external-memory.ts";
import type { ExternalMemoryRegistry } from "./tracing/index.ts";
import {
  createNurseryEvacuator,
  nativeObjectExtent,
  scanNativeObjectWithVerifiedDescriptor,
  type VisitReference,
} from "./tracing/index.ts";
import {
  readMemoryWord,
  writeMemoryWord,
  moveMemory,
  currentRootHead,
  configureGenerationalAllocation,
  engineRangeError,
} from "./intrinsics/memory.ts";
function contains(base: number, length: number, address: number): boolean {
  return address >= base && address - base <= length - 8;
}
/** Stop-the-world nursery promotion with a packed old prefix. Collector workspaces
 * and remembered metadata are permanent; application stores use emitted barriers.
 * Requires compiler-verified immutable object/root descriptors and an emitted
 * managed mutator with no raw-memory writes or external header mutation. The
 * generational emitter gate enforces the mutator side of this contract. */
/** Thrown when the managed heap stays full after collection. A runtime
 * closure is a value no JavaScript program can produce (Script functions are
 * ordinary objects), so catch boundaries recognise this engine abort by kind
 * and a Script throwing any string or object is unaffected. Created when the
 * module initializes, so throwing it never allocates. */
const managedHeapExhausted: () => void = (): void => {};
export function initializeGenerationalRuntime(
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
  const capacity = Math.floor(managedLength / 1024) * 512,
    youngCapacity = Math.min(
      // Large compiler heaps benefit from amortizing root/remembered-set scans.
      // Bound nursery storage to one quarter of a semispace.
      268435456,
      Math.max(512, Math.floor(capacity / 2048) * 512),
    ),
    oldCapacity = capacity - youngCapacity,
    units = capacity / 16,
    words = Math.ceil(units / 32),
    fixupCapacity = Math.floor(starts.length / 2);
  if (
    !Number.isSafeInteger(managedBase) ||
    managedBase <= 0 ||
    managedBase % 16 !== 0 ||
    !Number.isSafeInteger(managedBase + managedLength) ||
    capacity > 0x7ffffff0 ||
    oldCapacity < 512 ||
    metadata.length < units + words ||
    marks.length < Math.ceil(oldCapacity / 128) ||
    roots.length < 1 ||
    fixupCapacity < 1
  )
    throw "INVALID_GENERATIONAL_WORKSPACE";
  const forwarding = metadata.subarray(0, units),
    bits = metadata.subarray(units, units + words),
    youngBits = bits.subarray(oldCapacity / 512),
    dirty = marks.subarray(0, Math.ceil(oldCapacity / 128)),
    slots = starts.subarray(0, fixupCapacity),
    values = starts.subarray(fixupCapacity, fixupCapacity * 2),
    summary = new Uint32Array(3),
    allocation = new Uint32Array(16);
  allocation[1] = youngCapacity;
  allocation[2] = oldCapacity;
  allocation[7] = oldCapacity;
  let reverse = false,
    collecting = false,
    minor = false;
  function activeBase(): number {
    return managedBase + (reverse ? capacity : 0);
  }
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
  // Capture one immutable range record. Reading later windows remains lazy;
  // separate captures would all be unpacked at each reader entry.
  const readable: {
    readonly managedBase: number;
    readonly managedLength: number;
    readonly controlBase: number;
    readonly controlLength: number;
    readonly imageBase: number;
    readonly imageLength: number;
    readonly stackBase: number;
    readonly stackLength: number;
    readonly external: ExternalMemoryRegistry;
  } = {
    managedBase,
    managedLength,
    controlBase,
    controlLength,
    imageBase,
    imageLength,
    stackBase,
    stackLength,
    external,
  };
  function read(address: number): number | undefined {
    if (!(
      contains(readable.managedBase, readable.managedLength, address) ||
      contains(readable.controlBase, readable.controlLength, address) ||
      contains(readable.imageBase, readable.imageLength, address) ||
      contains(readable.stackBase, readable.stackLength, address) ||
      readable.external.contains(address, 8)
    ))
      return undefined;
    const value = readMemoryWord(address, 8, 0);
    return value < 0 ? undefined : value;
  }
  function oldStart(address: number): boolean {
    const offset = address - activeBase();
    if (offset < 0 || offset % 16 !== 0 || offset >= (allocation[3] ?? 0))
      return false;
    const unit = offset / 16;
    return ((bits[unit >>> 5] ?? 0) & (1 << (unit & 31))) !== 0;
  }
  function remember(offset: number): void {
    const byte = offset >>> 7,
      bit = 1 << ((offset >>> 4) & 7),
      current = dirty[byte] ?? 0;
    if ((current & bit) !== 0) return;
    dirty[byte] = current | bit;
    const count = allocation[12] ?? 0;
    if (count >= roots.length) allocation[14] = 1;
    else {
      roots[count] = offset;
      allocation[12] = count + 1;
    }
  }
  function clearRemembered(): void {
    if ((allocation[14] ?? 0) !== 0) dirty.fill(0);
    else
      for (let i = 0; i < (allocation[12] ?? 0); i++) {
        const offset = roots[i];
        if (offset !== undefined) dirty[offset >>> 7] = 0;
      }
    allocation[12] = 0;
    allocation[14] = 0;
  }
  function scanOld(offset: number, visit: VisitReference): boolean {
    const address = activeBase() + offset;
    if (!oldStart(address)) return false;
    const extent = nativeObjectExtent(
      read,
      address,
      activeBase() + (allocation[3] ?? 0),
    );
    return (
      extent !== undefined &&
      scanNativeObjectWithVerifiedDescriptor(
        read,
        address,
        extent,
        visit,
        0xffffffff,
      ) === "complete"
    );
  }
  const collector = createNurseryEvacuator({
    base: managedBase,
    byteLength: capacity,
    targetBase: managedBase + capacity,
    targetLength: capacity,
    starts: bits,
    forwarding,
    sources: offsets,
    sizes,
    destinations: pending,
    slots,
    values,
    summary,
    maxSteps: 0xffffffff,
    // The AArch64 generational mutator gate rejects raw writes and borrowed
    // reference environments; emitter-verified descriptors are immutable.
    verifiedDescriptors: true,
    isExternal: (address) =>
      contains(controlBase, controlLength, address) ||
      contains(imageBase, imageLength, address) ||
      (minor && oldStart(address)) ||
      external.contains(address, 8),
    scanRemembered: (visit) => {
      if (!minor) return true;
      if ((allocation[14] ?? 0) !== 0) {
        const end = Math.ceil((allocation[3] ?? 0) / 128);
        for (let byte = 0; byte < end; byte++) {
          const flags = dirty[byte] ?? 0;
          if (flags !== 0)
            for (let bit = 0; bit < 8; bit++)
              if (
                (flags & (1 << bit)) !== 0 &&
                !scanOld(byte * 128 + bit * 16, visit)
              )
                return false;
        }
      } else
        for (let i = 0; i < (allocation[12] ?? 0); i++) {
          const offset = roots[i];
          if (offset === undefined || !scanOld(offset, visit)) return false;
        }
      return true;
    },
    read,
    canWrite: (slot) =>
      contains(managedBase, managedLength, slot) ||
      contains(stackBase, stackLength, slot),
    copy: (destination, source, size) =>
      moveMemory(
        managedBase,
        managedLength,
        destination - managedBase,
        source - managedBase,
        size,
      ) === 0,
    write: (slot, value) =>
      contains(managedBase, managedLength, slot)
        ? writeMemoryWord(
            managedBase,
            managedLength,
            slot - managedBase,
            value,
          ) === 0
        : writeMemoryWord(stackBase, stackLength, slot - stackBase, value) ===
          0,
    publish: (count, bytes) => {
      const oldTop = allocation[3] ?? 0,
        youngTop = allocation[0] ?? 0;
      if (minor) youngBits.fill(0, 0, Math.ceil(youngTop / 512));
      else
        bits.fill(
          0,
          0,
          Math.ceil((youngTop > 0 ? oldCapacity + youngTop : oldTop) / 512),
        );
      const destinationBase = minor ? oldTop : 0;
      for (let i = 0; i < count; i++) {
        const destination = pending[i];
        if (destination === undefined) return false;
        const unit = (destinationBase + destination) / 16,
          word = unit >>> 5;
        bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
      }
      allocation[3] = destinationBase + bytes;
      allocation[0] = 0;
      if (!minor) reverse = !reverse;
      allocation[2] = (reverse ? capacity : 0) + oldCapacity;
      clearRemembered();
      return true;
    },
  });
  if (collector === undefined) throw "INVALID_GENERATIONAL_HEAP";
  const heap = collector;
  if (
    configureGenerationalAllocation(allocation, youngBits, dirty, roots) !== 0
  )
    throw "INVALID_GENERATIONAL_STATE";
  function collect(forceMajor: boolean): boolean {
    const youngTop = allocation[0] ?? 0,
      oldTop = allocation[3] ?? 0;
    minor = !forceMajor && youngTop > 0 && youngTop <= oldCapacity - oldTop;
    collecting = true;
    const prepared = minor
      ? heap.prepareRange(
          activeBase() + oldCapacity,
          youngCapacity,
          activeBase() + oldTop,
          oldCapacity - oldTop,
          youngTop,
          currentRootHead(),
        )
      : heap.prepare(
          youngTop > 0 ? oldCapacity + youngTop : oldTop,
          currentRootHead(),
          reverse,
        );
    if (!prepared || (!minor && (summary[1] ?? 0) > oldCapacity)) {
      collecting = false;
      return false;
    }
    if (!heap.commit()) throw "GENERATIONAL_COMMIT_FAILED";
    collecting = false;
    return true;
  }
  // Exhaustion throws, so compiled callers unwind through their exceptional
  // edges (an embedded compilation fails instead of trapping). Reentrant or
  // malformed requests remain invariant failures (undefined traps).
  // Request size 0 is reserved for a forced full collection (the Test262
  // host's $262.gc); it returns +0 and allocates nothing.
  return (bytes) => {
    if (bytes === 0 && !collecting) {
      if (!collect(true)) throw managedHeapExhausted;
      return 0;
    }
    if (collecting || !Number.isInteger(bytes) || bytes <= 0) return undefined;
    // No collection can make room for this request (an impossible string
    // length lands here too): a catchable RangeError, not an engine abort.
    if (bytes > oldCapacity) throw engineRangeError();
    const size = Math.ceil(bytes / 16) * 16;
    if (size >= Math.max(128, youngCapacity / 4)) {
      if (size > oldCapacity - (allocation[3] ?? 0) && !collect(true))
        throw managedHeapExhausted;
      const top = allocation[3] ?? 0;
      if (size > oldCapacity - top) throw managedHeapExhausted;
      const unit = top / 16,
        word = unit >>> 5;
      bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
      allocation[3] = top + size;
      // Constructor stores need no separate barrier: every directly old allocation
      // is remembered before initialization, which has no intervening safepoint.
      remember(top);
      return (reverse ? capacity : 0) + top;
    }
    if (size > youngCapacity - (allocation[0] ?? 0) && !collect(false))
      throw managedHeapExhausted;
    const top = allocation[0] ?? 0;
    if (size > youngCapacity - top) throw managedHeapExhausted;
    const unit = (oldCapacity + top) / 16,
      word = unit >>> 5;
    bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
    allocation[0] = top + size;
    return (reverse ? capacity : 0) + oldCapacity + top;
  };
}
