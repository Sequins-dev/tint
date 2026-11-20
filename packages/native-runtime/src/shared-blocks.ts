import type {
  SharedBlockDescriptor,
  SharedBlockAtomics,
  SharedBlockService,
  SharedBlockWaiting,
  SharedBlockNotifications,
  SharedOrder,
  SharedResult,
  SharedStatus,
  SharedUnsignedWidth,
} from "@tint/js-runtime/bytes/shared";
import {
  sharedRegistryMagic,
  sharedRegistryHeaderBytes,
  sharedRegistryMagicOffset,
  sharedRegistryEngineOffset,
  sharedRegistryBlockLimitOffset,
  sharedRegistryReservationLimitOffset,
  sharedRegistryPageSizeOffset,
  sharedRegistryPublishedCountOffset,
  sharedRegistryReservedBytesOffset,
  sharedRegistryLockOffset,
  sharedBlockDescriptorBytes,
  sharedBlockStateOffset,
  sharedBlockAddressOffset,
  sharedBlockReservationOffset,
  sharedBlockMaximumOffset,
  sharedBlockLengthOffset,
  sharedBlockGrowableOffset,
  sharedBlockPublished,
} from "@tint/abi/shared-block";
import {
  integer,
  readNumber,
  writeNumber,
  compareNumber,
  type NativeSharedMemoryHost,
  type NativeSharedAtomicMemoryHost,
  type NativeSharedBlockRegistry,
} from "./shared-memory-host.ts";
export {
  nativeSharedMemoryHost,
  nativeSharedAtomicMemoryHost,
  type NativeSharedMemoryHost,
  type NativeSharedAtomicMemoryHost,
  type NativeSharedBlockRegistry,
} from "./shared-memory-host.ts";
import {
  createNativeWaitRegistry,
  attachNativeWaitRegistry,
  type NativeWaitRegistry,
  type NativeWaitLocation,
  type NativeWaiterParkingHost,
} from "./shared-waiters.ts";
export interface NativeSharedWaitHost {
  readonly parking: NativeWaiterParkingHost;
  readonly now: () => number;
  readonly maxWaiters: number;
}
export interface NativeSharedWaitAttachment {
  readonly parking: NativeWaiterParkingHost;
  readonly now: () => number;
  readonly registry: NativeSharedBlockRegistry;
}
export interface NativeSharedBlockPolicy {
  /** Reservation granule: block reservations are rounded up to it. */
  readonly pageSize: number;
  readonly maxBlocks: number;
  /** Payload reservation budget, including page rounding and zero-length pages.
   * The separately bounded registry mapping is not charged to this budget. */
  readonly maxReservedBytes: number;
}
/** Trusted embedding capability for an already owned live mapping. Never accept
 * invented addresses or expose this capability as a Script object property. */
interface BlockLocation {
  readonly offset: number;
  readonly base: number;
  readonly maximum: number;
  readonly growable: boolean;
}
function orderCode(order: SharedOrder): number {
  return order === "unordered" ? 0 : order === "seq-cst" ? 1 : -1;
}
function roundReservation(length: number, page: number): number {
  return Math.ceil(Math.max(1, length) / page) * page;
}
/** Kernels align mappings to their page, at least 4 KiB on every supported
 * target, which may be smaller than the policy's reservation granule. */
const minimumMappingAlignment = 4096;
function ownedWindow(base: number, length: number, page: number): boolean {
  return (
    integer(base) &&
    base > 0 &&
    base % Math.min(page, minimumMappingAlignment) === 0 &&
    integer(base + length)
  );
}
function rollback(
  host: NativeSharedMemoryHost,
  base: number,
  length: number,
): void {
  if (host.unmapMemory(base, length) !== 0)
    throw "NATIVE_SHARED_ROLLBACK_FAILED";
}
export function createNativeSharedBlockService(
  host: NativeSharedMemoryHost,
  policy: NativeSharedBlockPolicy,
  atomicHost?: NativeSharedAtomicMemoryHost,
  waitHost?: NativeSharedWaitHost,
): SharedResult<NativeSharedBlockService> {
  const page = policy.pageSize,
    count = policy.maxBlocks,
    limit = policy.maxReservedBytes;
  if (
    !integer(page) ||
    page < 8 ||
    page > 0x40000000 ||
    (page & (page - 1)) !== 0 ||
    !integer(count) ||
    count < 1 ||
    !integer(limit)
  )
    return { ok: false, error: "invalid-length" };
  const extent = roundReservation(
    sharedRegistryHeaderBytes + count * sharedBlockDescriptorBytes,
    page,
  );
  if (!integer(extent)) return { ok: false, error: "invalid-length" };
  const base = host.mapMemory(extent);
  if (base <= 0) return { ok: false, error: "allocation-limit" };
  if (!ownedWindow(base, extent, page)) {
    rollback(host, base, extent);
    return { ok: false, error: "allocation-limit" };
  }
  const registry = { base, byteLength: extent, engineId: base };
  writeNumber(host, registry, sharedRegistryEngineOffset, base);
  writeNumber(host, registry, sharedRegistryBlockLimitOffset, count);
  writeNumber(host, registry, sharedRegistryReservationLimitOffset, limit);
  writeNumber(host, registry, sharedRegistryPageSizeOffset, page);
  // Zeroed mapping already holds count/quota/lock = 0. Publish the header last.
  writeNumber(host, registry, sharedRegistryMagicOffset, sharedRegistryMagic);
  let waiters: NativeWaitRegistry | undefined;
  if (waitHost !== undefined) {
    const created = createNativeWaitRegistry(
      host,
      waitHost.parking,
      registry.engineId,
      waitHost.maxWaiters,
    );
    if (!created.ok) {
      rollback(host, base, extent);
      return created;
    }
    waiters = created.value;
  }
  return {
    ok: true,
    value: sharedFacade(host, registry, atomicHost, waiters, waitHost?.now),
  };
}
export function attachNativeSharedBlockService(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
  atomicHost?: NativeSharedAtomicMemoryHost,
  waitHost?: NativeSharedWaitAttachment,
): SharedResult<NativeSharedBlockService> {
  // The caller proves this capability came from an owned live registry mapping.
  if (
    !integer(registry.base) ||
    registry.base <= 0 ||
    registry.base % 8 !== 0 ||
    !integer(registry.byteLength) ||
    registry.byteLength < sharedRegistryHeaderBytes
  )
    return { ok: false, error: "invalid-handle" };
  const scratch = new Uint32Array(2);
  if (
    readNumber(host, registry, sharedRegistryMagicOffset, scratch) !==
      sharedRegistryMagic ||
    readNumber(host, registry, sharedRegistryEngineOffset, scratch) !==
      registry.engineId ||
    registry.engineId !== registry.base
  )
    return { ok: false, error: "invalid-handle" };
  let waiters: NativeWaitRegistry | undefined;
  if (waitHost !== undefined) {
    if (waitHost.registry.engineId !== registry.engineId)
      return { ok: false, error: "invalid-handle" };
    const attached = attachNativeWaitRegistry(
      host,
      waitHost.parking,
      waitHost.registry,
    );
    if (!attached.ok) return attached;
    waiters = attached.value;
  }
  return {
    ok: true,
    value: sharedFacade(host, registry, atomicHost, waiters, waitHost?.now),
  };
}
/** Moving managed facade; all mutable authority is scalar native registry data.
 * Successful mappings are retained through engine lifetime. There is deliberately
 * no finalizer/destroy API: shutdown must first exclude every agent/operation. */
export interface NativeSharedBlockService extends SharedBlockService {
  readonly registry: NativeSharedBlockRegistry;
  readonly waitRegistry: NativeSharedBlockRegistry | undefined;
}
function sharedFacade(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
  atomicHost: NativeSharedAtomicMemoryHost | undefined,
  waiters: NativeWaitRegistry | undefined,
  clock: (() => number) | undefined,
): NativeSharedBlockService {
  function location(
    handle: number,
    scratch: Uint32Array,
  ): BlockLocation | undefined {
    if (!integer(handle) || handle === 0) return undefined;
    const count = readNumber(
      host,
      registry,
      sharedRegistryPublishedCountOffset,
      scratch,
    );
    if (handle > count) return undefined;
    const offset =
      sharedRegistryHeaderBytes + (handle - 1) * sharedBlockDescriptorBytes;
    if (
      readNumber(host, registry, offset + sharedBlockStateOffset, scratch) !==
      sharedBlockPublished
    )
      return undefined;
    return {
      offset,
      base: readNumber(
        host,
        registry,
        offset + sharedBlockAddressOffset,
        scratch,
      ),
      maximum: readNumber(
        host,
        registry,
        offset + sharedBlockMaximumOffset,
        scratch,
      ),
      growable:
        readNumber(
          host,
          registry,
          offset + sharedBlockGrowableOffset,
          scratch,
        ) === 1,
    };
  }
  function create(
    initial: number,
    maximum: number,
    growable: boolean,
  ): SharedResult<SharedBlockDescriptor> {
    if (
      !integer(initial) ||
      !integer(maximum) ||
      initial > maximum ||
      (!growable && initial !== maximum)
    )
      return { ok: false, error: "invalid-length" };
    const scratch = new Uint32Array(2);
    // No managed allocation or callbacks while holding the publication lock.
    // Native CAS owns quota/publication authority, never a managed Map/counter.
    while (
      compareNumber(host, registry, sharedRegistryLockOffset, 0, 1, scratch) !==
      0
    ) {}
    const count = readNumber(
        host,
        registry,
        sharedRegistryPublishedCountOffset,
        scratch,
      ),
      reserved = readNumber(
        host,
        registry,
        sharedRegistryReservedBytesOffset,
        scratch,
      ),
      limit = readNumber(
        host,
        registry,
        sharedRegistryReservationLimitOffset,
        scratch,
      ),
      blocks = readNumber(
        host,
        registry,
        sharedRegistryBlockLimitOffset,
        scratch,
      ),
      page = readNumber(host, registry, sharedRegistryPageSizeOffset, scratch),
      reservation = roundReservation(maximum, page);
    if (
      count >= blocks ||
      !integer(reservation) ||
      reservation > limit - reserved
    ) {
      writeNumber(host, registry, sharedRegistryLockOffset, 0);
      return { ok: false, error: "allocation-limit" };
    }
    const base = host.mapMemory(reservation);
    if (base <= 0) {
      writeNumber(host, registry, sharedRegistryLockOffset, 0);
      return { ok: false, error: "allocation-limit" };
    }
    if (!ownedWindow(base, reservation, page)) {
      rollback(host, base, reservation);
      writeNumber(host, registry, sharedRegistryLockOffset, 0);
      return { ok: false, error: "allocation-limit" };
    }
    const offset =
      sharedRegistryHeaderBytes + count * sharedBlockDescriptorBytes;
    writeNumber(host, registry, offset + sharedBlockAddressOffset, base);
    writeNumber(
      host,
      registry,
      offset + sharedBlockReservationOffset,
      reservation,
    );
    writeNumber(host, registry, offset + sharedBlockMaximumOffset, maximum);
    writeNumber(host, registry, offset + sharedBlockLengthOffset, initial);
    writeNumber(
      host,
      registry,
      offset + sharedBlockGrowableOffset,
      growable ? 1 : 0,
    );
    writeNumber(
      host,
      registry,
      offset + sharedBlockStateOffset,
      sharedBlockPublished,
    );
    writeNumber(
      host,
      registry,
      sharedRegistryReservedBytesOffset,
      reserved + reservation,
    );
    writeNumber(host, registry, sharedRegistryPublishedCountOffset, count + 1);
    writeNumber(host, registry, sharedRegistryLockOffset, 0);
    return {
      ok: true,
      value: {
        handle: count + 1,
        blockId: count + 1,
        maxByteLength: maximum,
        growable,
      },
    };
  }
  function describe(handle: number): SharedResult<SharedBlockDescriptor> {
    const block = location(handle, new Uint32Array(2));
    return block === undefined
      ? { ok: false, error: "invalid-handle" }
      : {
          ok: true,
          value: {
            handle,
            blockId: handle,
            maxByteLength: block.maximum,
            growable: block.growable,
          },
        };
  }
  function length(handle: number, order: SharedOrder): SharedResult<number> {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return { ok: false, error: "invalid-handle" };
    const code = orderCode(order);
    if (code < 0) return { ok: false, error: "invalid-order" };
    return {
      ok: true,
      value: readNumber(
        host,
        registry,
        block.offset + sharedBlockLengthOffset,
        scratch,
        code,
      ),
    };
  }
  function foreignAddress(
    handle: number,
    offset: number,
    extent: number,
  ): SharedResult<number> {
    const scratch = new Uint32Array(2);
    const block = location(handle, scratch);
    if (block === undefined) return { ok: false, error: "invalid-handle" };
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
      orderCode("seq-cst"),
    );
    if (
      !integer(offset) ||
      !integer(extent) ||
      offset > length ||
      extent > length - offset
    )
      return { ok: false, error: "invalid-range" };
    return { ok: true, value: block.base + offset };
  }

  function grow(handle: number, target: number): SharedStatus {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return "invalid-handle";
    if (!block.growable) return "fixed-length";
    if (!integer(target) || target > block.maximum) return "invalid-length";
    let current = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
    );
    for (;;) {
      if (target < current) return "invalid-length";
      const observed = compareNumber(
        host,
        registry,
        block.offset + sharedBlockLengthOffset,
        current,
        target,
        scratch,
      );
      if (observed === current) return "none";
      current = observed;
    }
  }
  function readUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    order: SharedOrder,
  ): SharedResult<number> {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return { ok: false, error: "invalid-handle" };
    const status = access(offset, width, order, false);
    if (status !== "none") return { ok: false, error: status };
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
      orderCode(order),
    );
    const value = host.readSharedUnsigned(
      block.base,
      length,
      offset,
      width,
      orderCode(order),
    );
    return value < 0
      ? { ok: false, error: "invalid-range" }
      : { ok: true, value };
  }
  function writeUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    value: number,
    order: SharedOrder,
  ): SharedStatus {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return "invalid-handle";
    const status = access(offset, width, order, false);
    if (status !== "none") return status;
    if (
      !integer(value) ||
      value > (width === 1 ? 255 : width === 2 ? 65535 : 4294967295)
    )
      return "invalid-value";
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
      orderCode(order),
    );
    return host.writeSharedUnsigned(
      block.base,
      length,
      offset,
      width,
      value,
      orderCode(order),
    ) === 0
      ? "none"
      : "invalid-range";
  }
  function readWord64(
    handle: number,
    offset: number,
    order: SharedOrder,
    output: Uint32Array,
  ): SharedStatus {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return "invalid-handle";
    const status = access(offset, 8, order, true);
    if (status !== "none") return status;
    if (output.length < 2) return "invalid-value";
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
      orderCode(order),
    );
    return host.readSharedWord64(
      block.base,
      length,
      offset,
      orderCode(order),
      output,
    ) === 0
      ? "none"
      : "invalid-range";
  }
  function writeWord64(
    handle: number,
    offset: number,
    order: SharedOrder,
    lo: number,
    hi: number,
  ): SharedStatus {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return "invalid-handle";
    const status = access(offset, 8, order, true);
    if (status !== "none") return status;
    if (!integer(lo) || !integer(hi) || lo > 0xffffffff || hi > 0xffffffff)
      return "invalid-value";
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
      orderCode(order),
    );
    return host.writeSharedWord64(
      block.base,
      length,
      offset,
      orderCode(order),
      lo,
      hi,
    ) === 0
      ? "none"
      : "invalid-range";
  }
  function compareExchangeUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    expected: number,
    replacement: number,
  ): SharedResult<number> {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return { ok: false, error: "invalid-handle" };
    const status = access(offset, width, "seq-cst", false);
    if (status !== "none") return { ok: false, error: status };
    const maximum = width === 1 ? 255 : width === 2 ? 65535 : 4294967295;
    if (
      !integer(expected) ||
      expected > maximum ||
      !integer(replacement) ||
      replacement > maximum
    )
      return { ok: false, error: "invalid-value" };
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
    );
    const atomic = atomicHost;
    if (atomic === undefined) throw "NATIVE_SHARED_ATOMIC_AUTHORITY";
    const value = atomic.compareExchangeSharedUnsigned(
      block.base,
      length,
      offset,
      width,
      expected,
      replacement,
    );
    return value < 0
      ? { ok: false, error: "invalid-range" }
      : { ok: true, value };
  }
  function compareExchangeWord64(
    handle: number,
    offset: number,
    expectedLo: number,
    expectedHi: number,
    replacementLo: number,
    replacementHi: number,
    output: Uint32Array,
  ): SharedStatus {
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return "invalid-handle";
    const status = access(offset, 8, "seq-cst", true);
    if (status !== "none") return status;
    if (
      output.length < 2 ||
      !integer(expectedLo) ||
      expectedLo > 0xffffffff ||
      !integer(expectedHi) ||
      expectedHi > 0xffffffff ||
      !integer(replacementLo) ||
      replacementLo > 0xffffffff ||
      !integer(replacementHi) ||
      replacementHi > 0xffffffff
    )
      return "invalid-value";
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
    );
    return host.compareExchangeSharedWord64(
      block.base,
      length,
      offset,
      expectedLo,
      expectedHi,
      replacementLo,
      replacementHi,
      output,
    ) === 0
      ? "none"
      : "invalid-range";
  }
  const atomics: SharedBlockAtomics | undefined =
    atomicHost === undefined
      ? undefined
      : {
          compareExchangeUnsigned: (
            handle,
            offset,
            width,
            expected,
            replacement,
          ): SharedResult<number> =>
            compareExchangeUnsigned(
              handle,
              offset,
              width,
              expected,
              replacement,
            ),
          compareExchangeWord64: (
            handle,
            offset,
            expectedLo,
            expectedHi,
            replacementLo,
            replacementHi,
            output,
          ): SharedStatus =>
            compareExchangeWord64(
              handle,
              offset,
              expectedLo,
              expectedHi,
              replacementLo,
              replacementHi,
              output,
            ),
        };
  function waiterLocation(
    handle: number,
    offset: number,
    width: 4 | 8,
  ): SharedResult<NativeWaitLocation> {
    if (width !== 4 && width !== 8)
      return { ok: false, error: "invalid-width" };
    const scratch = new Uint32Array(2),
      block = location(handle, scratch);
    if (block === undefined) return { ok: false, error: "invalid-handle" };
    const status = access(offset, width, "seq-cst", width === 8);
    if (status !== "none") return { ok: false, error: status };
    const length = readNumber(
      host,
      registry,
      block.offset + sharedBlockLengthOffset,
      scratch,
    );
    if (offset > length || width > length - offset)
      return { ok: false, error: "invalid-range" };
    return {
      ok: true,
      value: {
        engineId: registry.engineId,
        blockId: handle,
        address: block.base,
        byteLength: length,
        byteOffset: offset,
        width,
      },
    };
  }
  function configureWaiting(
    active: NativeWaitRegistry,
    now: () => number,
  ): SharedBlockWaiting {
    return {
      registryId: active.registry.base,
      register: (handle, offset, width, lo, hi, zeroTimeout) => {
        const grant = waiterLocation(handle, offset, width);
        return grant.ok
          ? active.register(grant.value, lo, hi, zeroTimeout)
          : grant;
      },
      poll: (ticket) => active.poll(ticket),
      order: (ticket) => active.order(ticket),
      expire: (ticket) => active.expire(ticket),
      take: (ticket) => active.take(ticket),
      park: (ticket, timeout) => active.park(ticket, timeout),
      now,
    };
  }
  function configureNotifications(
    active: NativeWaitRegistry,
  ): SharedBlockNotifications {
    return {
      notifyOrdered: (handle, offset, width, count) => {
        const grant = waiterLocation(handle, offset, width);
        return grant.ok
          ? active.notifyOrdered(grant.value.blockId, offset, width, count)
          : grant;
      },
      notify: (handle, offset, width, count) => {
        const grant = waiterLocation(handle, offset, width);
        return grant.ok
          ? active.notify(grant.value.blockId, offset, width, count)
          : grant;
      },
    };
  }
  const waiting =
    waiters === undefined || clock === undefined
      ? undefined
      : configureWaiting(waiters, clock);
  const notifications =
    waiters === undefined ? undefined : configureNotifications(waiters);
  return {
    engineId: registry.engineId,
    registry,
    waitRegistry: waiters?.registry,
    waiting,
    notifications,
    atomics,
    create: (initial, maximum, growable): SharedResult<SharedBlockDescriptor> =>
      create(initial, maximum, growable),
    describe: (handle): SharedResult<SharedBlockDescriptor> => describe(handle),
    length: (handle, order): SharedResult<number> => length(handle, order),
    foreignAddress: (handle, offset, extent): SharedResult<number> =>
      foreignAddress(handle, offset, extent),
    grow: (handle, target): SharedStatus => grow(handle, target),
    readUnsigned: (handle, offset, width, order): SharedResult<number> =>
      readUnsigned(handle, offset, width, order),
    writeUnsigned: (handle, offset, width, value, order): SharedStatus =>
      writeUnsigned(handle, offset, width, value, order),
    readWord64: (handle, offset, order, output): SharedStatus =>
      readWord64(handle, offset, order, output),
    writeWord64: (handle, offset, order, lo, hi): SharedStatus =>
      writeWord64(handle, offset, order, lo, hi),
  };
}
function access(
  offset: number,
  width: number,
  order: SharedOrder,
  word: boolean,
): SharedStatus {
  if (orderCode(order) < 0) return "invalid-order";
  if (word ? width !== 8 : width !== 1 && width !== 2 && width !== 4)
    return "invalid-width";
  if (!integer(offset)) return "invalid-range";
  return offset % width === 0 ? "none" : "unaligned";
}

export {
  createNativeWaitRegistry,
  attachNativeWaitRegistry,
  nativeWaiterParkingHost,
  type NativeWaitRegistry,
  type NativeWaitLocation,
  type NativeWaitState,
  type NativeWaitRegistration,
  type NativeWaiterParkingHost,
} from "./shared-waiters.ts";
