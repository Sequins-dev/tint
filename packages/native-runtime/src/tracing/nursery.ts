import {
  nativeWeakSlotMarker,
  nativeWeakSlotWeak,
  nativeWeakSlotEphemeron,
  nativeWeakSlotFlagsOffset,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotKeyPayloadOffset,
  nativeWeakSlotValueOffset,
  nativeWeakSlotValuePayloadOffset,
} from "@tint/abi/weak-slot";
import { reserveLinear } from "../allocators/linear/index.ts";
import { nativeObjectExtent } from "./extent.ts";
import {
  scanNativeObject,
  scanNativeObjectWithVerifiedDescriptor,
  scanNativeRootsWithVerifiedDescriptors,
  scanNativeRoots,
  type ReadWord,
  type VisitReference,
} from "./scan.ts";
import { relocateNativeArrayData } from "./relocation.ts";
export interface NurseryOptions {
  readonly base: number;
  readonly byteLength: number;
  readonly targetBase: number;
  readonly targetLength: number;
  /** One object-start bit and one zero-initialized forwarding word per 16 bytes. */
  readonly starts: Uint32Array;
  readonly forwarding: Uint32Array;
  /** Survivor queue, source/destination offsets, and exact aligned sizes. */
  readonly sources: Uint32Array;
  readonly sizes: Uint32Array;
  readonly destinations: Uint32Array;
  readonly slots: Float64Array;
  readonly values: Float64Array;
  /** Successful [survivorCount, survivorBytes, fixupCount]. */
  readonly summary: Uint32Array;
  readonly read: ReadWord;
  readonly isExternal: (address: number) => boolean;
  /** Enumerate CURRENT reference slots in remembered old objects, checking tags.
   * Stale raw slots are insufficient: their containing field may no longer be a reference. */
  readonly scanRemembered: (visit: VisitReference) => boolean;
  readonly canWrite: (slot: number) => boolean;
  readonly copy: (destination: number, source: number, size: number) => boolean;
  readonly write: (slot: number, value: number) => boolean;
  readonly publish: (count: number, bytes: number) => boolean;
  readonly maxSteps?: number;
  /** Capability: all reachable object/root descriptors are compiler-verified,
   * immutable, and headers cannot be forged by the mutator. Defaults to checked. */
  readonly verifiedDescriptors?: boolean;
}
export interface NurseryEvacuator {
  readonly prepare: (
    usedBytes: number,
    rootHead: number,
    reverse?: boolean,
  ) => boolean;
  /** Both ranges must be disjoint subwindows of the two configured mappings.
   * The start bitmap is indexed relative to the containing configured window. */
  readonly prepareRange: (
    sourceBase: number,
    sourceLength: number,
    destinationBase: number,
    destinationLength: number,
    usedBytes: number,
    rootHead: number,
  ) => boolean;
  readonly commit: () => boolean;
}
function window(base: number, length: number): boolean {
  return (
    Number.isSafeInteger(base) &&
    base > 0 &&
    base % 16 === 0 &&
    Number.isInteger(length) &&
    length > 0 &&
    length <= 0xfffffff0 &&
    length % 16 === 0 &&
    Number.isSafeInteger(base + length)
  );
}
/** All control/scratch buffers are exclusive, disjoint from each other and both
 * windows, and allocated outside the nursery. Source and target windows must be
 * disjoint. Source headers, start bits and remembered graph stay immutable across
 * prepare/commit. Callbacks must be nonallocating, nonreentrant trusted leaves.
 * Forwarding starts zero and is cleared by visited entries on subsequent prepares.
 * Failure before commit changes scratch only. A commit callback failure is fatal:
 * the embedding must terminate, never catch and resume a partially moved graph. */
export function createNurseryEvacuator(
  o: NurseryOptions,
): NurseryEvacuator | undefined {
  // Keep bounds behind one shared capture so fast external-reference paths do
  // not unpack every window field before knowing which bounds they need.
  const plan = {
    base: o.base,
    length: o.byteLength,
    target: o.targetBase,
    targetLength: o.targetLength,
    startUnit: 0,
    count: 0,
    weakCount: 0,
    fixups: 0,
    used: 0,
    currentSource: 0,
    currentTarget: 0,
    prepared: false,
    busy: false,
  };
  const maxSteps = o.maxSteps ?? 1000000;
  const scanObject =
    o.verifiedDescriptors === true
      ? scanNativeObjectWithVerifiedDescriptor
      : scanNativeObject;
  const scanRoots =
    o.verifiedDescriptors === true
      ? scanNativeRootsWithVerifiedDescriptors
      : scanNativeRoots;
  if (
    !window(plan.base, plan.length) ||
    !window(plan.target, plan.targetLength) ||
    (plan.base < plan.target + plan.targetLength &&
      plan.target < plan.base + plan.length) ||
    o.starts.length <
      Math.ceil(Math.max(plan.length, plan.targetLength) / 512) ||
    o.forwarding.length < Math.max(plan.length, plan.targetLength) / 16 ||
    o.summary.length < 3 ||
    !Number.isInteger(maxSteps) ||
    maxSteps < 0 ||
    maxSteps > 0xffffffff
  )
    return undefined;
  const state = new Uint32Array(2),
    header = new Uint8Array(1);
  function resolveReference(
    address: number,
    discover: boolean,
    allowUndiscovered: boolean = false,
  ): number | undefined {
    if (!Number.isSafeInteger(address) || address <= 0 || address % 8 !== 0)
      return undefined;
    if (address < plan.base || address >= plan.base + plan.length) {
      if (address >= plan.target && address < plan.target + plan.targetLength)
        return undefined;
      return o.isExternal(address) ? address : undefined;
    }
    const offset = address - plan.base;
    if (offset >= plan.used || offset % 16 !== 0) return undefined;
    const unit = offset / 16,
      word = o.starts[(plan.startUnit + unit) >>> 5];
    if (
      word === undefined ||
      (word & (1 << ((plan.startUnit + unit) & 31))) === 0
    )
      return undefined;
    const encoded = o.forwarding[unit];
    if (encoded !== undefined && encoded !== 0)
      return plan.target + encoded - 1;
    if (!discover) return allowUndiscovered ? address : undefined;
    if (
      plan.count >= o.sources.length ||
      plan.count >= o.sizes.length ||
      plan.count >= o.destinations.length ||
      plan.count >= maxSteps
    )
      return undefined;
    const size = nativeObjectExtent(
      o.read,
      address,
      plan.base + plan.used,
      header,
    );
    if (size === undefined) return undefined;
    const destination = reserveLinear(state, size, 16);
    if (destination === undefined) return undefined;
    o.sources[plan.count] = offset;
    // Extents are 16-byte aligned, leaving four scratch bits for header kind.
    // Normalize every size before publishing a successful preparation.
    const classification = header[0] ?? 0;
    o.sizes[plan.count] = size + classification;
    if (classification === nativeWeakSlotMarker) plan.weakCount++;
    o.destinations[plan.count] = destination;
    plan.count = plan.count + 1;
    o.forwarding[unit] = destination + 1;
    return plan.target + destination;
  }
  function lookup(address: number): number | undefined {
    return resolveReference(address, false);
  }
  function append(slot: number, value: number): boolean {
    if (
      !Number.isSafeInteger(slot) ||
      slot <= 0 ||
      slot % 8 !== 0 ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      plan.fixups >= o.slots.length ||
      plan.fixups >= o.values.length ||
      !o.canWrite(slot)
    )
      return false;
    o.slots[plan.fixups] = slot;
    o.values[plan.fixups] = value;
    plan.fixups = plan.fixups + 1;
    return true;
  }
  function visit(address: number, slot: number): boolean {
    const destination = resolveReference(address, true);
    if (destination === undefined) return false;
    if (destination === address) return true;
    const output =
      plan.currentSource === 0
        ? slot
        : plan.currentTarget + (slot - plan.currentSource);
    // Root/remembered slots must not refer into either evacuation window. Managed
    // source slots are transformed using the currently scanned survivor instead.
    if (
      plan.currentSource === 0 &&
      ((slot >= plan.base && slot < plan.base + plan.length) ||
        (slot >= plan.target && slot < plan.target + plan.targetLength))
    )
      return false;
    return append(output, destination);
  }
  /** Zero is cleared/dead, one is live, minus one is an invalid edge. A
   * non-reference immediate is immortal; its opaque payload need not be read. */
  function weakKeyState(source: number): number {
    const tag = o.read(source + nativeWeakSlotKeyOffset);
    if (tag === undefined || !Number.isInteger(tag) || tag < 0 || tag > 7)
      return -1;
    if (tag === 0) return 0;
    if (tag !== 3 && tag !== 5 && tag !== 6 && tag !== 7) return 1;
    const key = o.read(source + nativeWeakSlotKeyPayloadOffset);
    if (key === undefined) return -1;
    if (key === 0) return 0;
    if (resolveReference(key, false) !== undefined) return 1;
    // Distinguish an undiscovered object start from an interior/foreign pointer.
    return resolveReference(key, false, true) === undefined ? -1 : 0;
  }
  function visitWeakValue(source: number): boolean {
    const tag = o.read(source + nativeWeakSlotValueOffset);
    if (tag === undefined || !Number.isInteger(tag) || tag < 0 || tag > 7)
      return false;
    if (tag !== 3 && tag !== 5 && tag !== 6 && tag !== 7) return true;
    const value = o.read(source + nativeWeakSlotValuePayloadOffset);
    return (
      value !== undefined &&
      (value === 0 || visit(value, source + nativeWeakSlotValuePayloadOffset))
    );
  }
  function clearPair(target: number, offset: number): boolean {
    return append(target + offset, 0) && append(target + offset + 8, 0);
  }
  function preparePlan(usedBytes: number, rootHead: number): boolean {
    if (plan.busy) return false;
    plan.busy = true;
    plan.prepared = false;
    try {
      for (let i = 0; i < plan.count; i++) {
        const offset = o.sources[i];
        if (offset === undefined) return false;
        o.forwarding[offset / 16] = 0;
      }
      plan.count = 0;
      plan.weakCount = 0;
      plan.fixups = 0;
      plan.currentSource = 0;
      plan.currentTarget = 0;
      o.summary[0] = 0;
      o.summary[1] = 0;
      o.summary[2] = 0;
      if (
        !Number.isInteger(usedBytes) ||
        usedBytes < 0 ||
        usedBytes > plan.length ||
        usedBytes % 16 !== 0
      )
        return false;
      plan.used = usedBytes;
      state[0] = 0;
      state[1] = plan.targetLength;
      if (
        scanRoots(o.read, rootHead, visit, maxSteps, maxSteps) !== "complete" ||
        !o.scanRemembered(visit)
      )
        return false;
      let scanned = 0;
      while (true) {
        for (; scanned < plan.count; scanned++) {
          const source = o.sources[scanned],
            destination = o.destinations[scanned],
            encodedSize = o.sizes[scanned];
          if (
            source === undefined ||
            destination === undefined ||
            encodedSize === undefined
          )
            return false;
          plan.currentSource = plan.base + source;
          plan.currentTarget = plan.target + destination;
          const kind = encodedSize & 15,
            size = encodedSize - kind;
          if (kind >= 1 && kind <= 5) continue;
          // Deferral still validates both tagged slots; only discovery is skipped.
          if (
            scanObject(
              o.read,
              plan.currentSource,
              size,
              visit,
              maxSteps,
              false,
            ) !== "complete"
          )
            return false;
        }
        if (plan.weakCount === 0) break;
        const end = plan.count;
        for (let i = 0; i < end; i++) {
          const encodedSize = o.sizes[i];
          if (encodedSize === undefined) return false;
          if ((encodedSize & 15) !== nativeWeakSlotMarker) continue;
          const source = o.sources[i],
            destination = o.destinations[i];
          if (source === undefined || destination === undefined) return false;
          plan.currentSource = plan.base + source;
          plan.currentTarget = plan.target + destination;
          const flags = o.read(plan.currentSource + nativeWeakSlotFlagsOffset);
          if (flags === nativeWeakSlotWeak) {
            o.sizes[i] = encodedSize + 8;
          } else if (flags === nativeWeakSlotEphemeron) {
            const state = weakKeyState(plan.currentSource);
            if (state < 0) return false;
            if (state !== 0) {
              if (!visitWeakValue(plan.currentSource)) return false;
              // Classification 15 is a scratch-only processed bit. It prevents
              // duplicate value fixups; normalization below restores the extent.
              o.sizes[i] = encodedSize + 8;
            }
          } else return false;
        }
        // Newly discovered values can strongly reach more keys or weak cells.
        // Scan that frontier before examining its ephemerons in the next round.
        if (plan.count === end) break;
      }
      if (plan.weakCount !== 0) {
        for (let i = 0; i < plan.count; i++) {
          const encodedSize = o.sizes[i];
          if (encodedSize === undefined) return false;
          if ((encodedSize & 7) !== nativeWeakSlotMarker) continue;
          const source = o.sources[i],
            destination = o.destinations[i];
          if (source === undefined || destination === undefined) return false;
          const address = plan.base + source,
            target = plan.target + destination;
          const state = weakKeyState(address);
          if (state < 0) return false;
          if (state === 0) {
            // Dead values must not retain from-space payloads in an untraced cell.
            if (
              !clearPair(target, nativeWeakSlotKeyOffset) ||
              !clearPair(target, nativeWeakSlotValueOffset)
            )
              return false;
          } else {
            const tag = o.read(address + nativeWeakSlotKeyOffset);
            if (tag === undefined) return false;
            if (tag === 3 || tag === 5 || tag === 6 || tag === 7) {
              const key = o.read(address + nativeWeakSlotKeyPayloadOffset);
              if (key === undefined) return false;
              const moved = resolveReference(key, false);
              if (
                moved === undefined ||
                (moved !== key &&
                  !append(target + nativeWeakSlotKeyPayloadOffset, moved))
              )
                return false;
            }
            if (
              o.read(address + nativeWeakSlotFlagsOffset) ===
                nativeWeakSlotWeak &&
              !clearPair(target, nativeWeakSlotValueOffset)
            )
              return false;
          }
        }
      }
      // Owners have now all been discovered. Resolve derived backing addresses
      // against immutable original headers and stage writes into copied headers.
      for (let i = 0; i < plan.count; i++) {
        const source = o.sources[i],
          destination = o.destinations[i];
        if (source === undefined || destination === undefined) return false;
        const encodedSize = o.sizes[i];
        if (encodedSize === undefined) return false;
        const kind = encodedSize & 15,
          address = plan.base + source,
          marker = kind & 7;
        o.sizes[i] = encodedSize - kind;
        if (marker >= 2 && marker <= 5) {
          const data = relocateNativeArrayData(
            o.read,
            address,
            lookup,
            maxSteps,
          );
          if (
            data === undefined ||
            !append(plan.target + destination + 24, data)
          )
            return false;
        }
      }
      o.summary[0] = plan.count;
      o.summary[1] = state[0] ?? 0;
      o.summary[2] = plan.fixups;
      plan.prepared = true;
      return true;
    } finally {
      if (!plan.prepared) {
        o.summary[0] = plan.count;
        o.summary[1] = state[0] ?? 0;
        o.summary[2] = plan.fixups;
      }
      plan.busy = false;
    }
  }
  function containingWindow(address: number, size: number): number {
    if (
      address >= o.base &&
      size <= o.byteLength &&
      address - o.base <= o.byteLength - size
    )
      return o.base;
    if (
      address >= o.targetBase &&
      size <= o.targetLength &&
      address - o.targetBase <= o.targetLength - size
    )
      return o.targetBase;
    return 0;
  }
  return {
    prepare: (usedBytes, rootHead, reverse: boolean = false) => {
      if (plan.busy) return false;
      plan.base = reverse ? o.targetBase : o.base;
      plan.length = reverse ? o.targetLength : o.byteLength;
      plan.target = reverse ? o.base : o.targetBase;
      plan.targetLength = reverse ? o.byteLength : o.targetLength;
      plan.startUnit = 0;
      return preparePlan(usedBytes, rootHead);
    },
    prepareRange: (
      sourceBase,
      sourceLength,
      destinationBase,
      destinationLength,
      usedBytes,
      rootHead,
    ) => {
      if (plan.busy) return false;
      plan.prepared = false;
      if (
        !window(sourceBase, sourceLength) ||
        !window(destinationBase, destinationLength) ||
        (sourceBase < destinationBase + destinationLength &&
          destinationBase < sourceBase + sourceLength)
      )
        return false;
      const containing = containingWindow(sourceBase, sourceLength);
      if (
        containing === 0 ||
        containingWindow(destinationBase, destinationLength) === 0
      )
        return false;
      plan.base = sourceBase;
      plan.length = sourceLength;
      plan.target = destinationBase;
      plan.targetLength = destinationLength;
      plan.startUnit = (plan.base - containing) / 16;
      return preparePlan(usedBytes, rootHead);
    },
    commit: () => {
      if (plan.busy || !plan.prepared) return false;
      plan.busy = true;
      plan.prepared = false;
      // Deliberately stay busy after a fatal failure. Publication is last.
      for (let i = 0; i < plan.count; i++) {
        const source = o.sources[i],
          destination = o.destinations[i],
          size = o.sizes[i];
        if (
          source === undefined ||
          destination === undefined ||
          size === undefined ||
          !o.copy(plan.target + destination, plan.base + source, size)
        )
          throw "NURSERY_COMMIT_FAILED";
      }
      for (let i = 0; i < plan.fixups; i++) {
        const slot = o.slots[i],
          value = o.values[i];
        if (slot === undefined || value === undefined || !o.write(slot, value))
          throw "NURSERY_COMMIT_FAILED";
      }
      if (!o.publish(plan.count, state[0] ?? 0)) throw "NURSERY_COMMIT_FAILED";
      plan.busy = false;
      return true;
    },
  };
}
