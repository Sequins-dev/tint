import { createKeyIndex } from "@tint/foundation/collections/key-index";
import {
  adoptByteStorage,
  byteStorageData,
  detachByteStorage,
  type ByteAllocator,
  type ByteStorage,
} from "@tint/js-runtime/bytes";
import { adoptExternal, externalAddress } from "./ffi/primitives.ts";
import { collectGarbage } from "./intrinsics/memory.ts";
import { createWeakSlot, weakSlotKey } from "./intrinsics/weak.ts";
import { integer, type NativeSharedMemoryHost } from "./shared-memory-host.ts";

/** A packet owns this mapping between movement out of one isolate and
 * adoption by another. The descriptor is never a Script-accessible value. */
export interface NativeWorkerBackingGrant {
  readonly address: number;
  readonly length: number;
  readonly maximum: number;
  readonly resizable: boolean;
}
export interface NativeWorkerBacking {
  readonly allocate: ByteAllocator;
  /** Sample and validate again after observable serialization. */
  inspect(storage: ByteStorage): NativeWorkerBackingGrant | undefined;
  move(storage: ByteStorage, grant: NativeWorkerBackingGrant): void;
  adopt(grant: NativeWorkerBackingGrant, allocationLimit: number): ByteStorage;
  discard(grant: NativeWorkerBackingGrant): void;
  /** Invoke only when no guest code or native borrows remain in this isolate. */
  close(): void;
}
interface LocalMapping {
  readonly cell: unknown;
  readonly mappedBytes: number;
}

const PAGE = 16384;
const INITIAL_PRESSURE = 67108864;
const INITIAL_SWEEP = 1024;
const MAXIMUM_LENGTH = 4294967295;

function extent(length: number): number {
  return Math.max(PAGE, Math.ceil(length / PAGE) * PAGE);
}

export function createNativeWorkerBacking(
  memory: NativeSharedMemoryHost,
): NativeWorkerBacking {
  const mappings = createKeyIndex<number, LocalMapping>(
    (address: number): number => Math.floor(address / 4096) >>> 0,
  );
  let liveBytes = 0;
  let liveMappings = 0;
  let collectAt: number = INITIAL_PRESSURE;
  let sweepAt: number = INITIAL_SWEEP;
  let closed = false;
  function unmap(address: number, bytes: number): void {
    if (memory.unmapMemory(address, bytes) !== 0)
      throw "NATIVE_WORKER_BACKING_RELEASE";
  }
  function forget(address: number, mapping: LocalMapping): void {
    mappings.delete(address);
    liveBytes -= mapping.mappedBytes;
    liveMappings--;
  }
  function sweep(force: boolean): void {
    if (force) collectGarbage();
    const dead: number[] = [];
    mappings.forEach((mapping, address): void => {
      if (weakSlotKey(mapping.cell) === undefined) dead.push(address);
    });
    for (const address of dead) {
      const mapping = mappings.get(address);
      if (mapping === undefined) throw "NATIVE_WORKER_BACKING_SWEEP";
      forget(address, mapping);
      unmap(address, mapping.mappedBytes);
    }
    sweepAt = Math.max(INITIAL_SWEEP, liveMappings * 2);
    if (force) collectAt = Math.max(INITIAL_PRESSURE, liveBytes * 2);
  }
  function register(address: number, view: Uint8Array): void {
    if (mappings.has(address)) throw "NATIVE_WORKER_BACKING_DOUBLE_ADOPTION";
    const mappedBytes = extent(view.length);
    const mapping = {
      cell: createWeakSlot(view, undefined, false),
      mappedBytes,
    };
    mappings.set(address, mapping);
    liveBytes += mappedBytes;
    liveMappings++;
  }
  function allocate(length: number): Uint8Array | undefined {
    if (closed || !integer(length) || length > MAXIMUM_LENGTH) return undefined;
    const mappedBytes = extent(length);
    if (liveBytes + mappedBytes > collectAt) sweep(true);
    else if (liveMappings >= sweepAt) sweep(false);
    let address = memory.mapMemory(mappedBytes);
    if (address <= 0) {
      sweep(true);
      address = memory.mapMemory(mappedBytes);
    }
    if (address <= 0) return undefined;
    try {
      const view = adoptExternal(new Uint8Array(0), address, length);
      register(address, view);
      return view;
    } catch (error) {
      unmap(address, mappedBytes);
      throw error;
    }
  }
  function inspect(storage: ByteStorage): NativeWorkerBackingGrant | undefined {
    const view = byteStorageData(storage, "write");
    // A pinned backing is viewed by native typed arrays: never moved.
    if (view === undefined || closed || storage.pinned === true)
      return undefined;
    const address = externalAddress(view);
    if (!mappings.has(address)) return undefined;
    return {
      address,
      length: view.length,
      maximum: storage.maxByteLength,
      resizable: storage.resizable,
    };
  }
  return {
    allocate,
    inspect,
    move: (storage, grant): void => {
      const view = byteStorageData(storage, "write");
      const mapping = mappings.get(grant.address);
      if (
        closed ||
        view === undefined ||
        mapping === undefined ||
        externalAddress(view) !== grant.address ||
        view.length !== grant.length ||
        storage.maxByteLength !== grant.maximum ||
        storage.resizable !== grant.resizable
      )
        throw new Error(
          "ArrayBuffer backing changed during message serialization",
        );
      forget(grant.address, mapping);
      detachByteStorage(storage);
    },
    adopt: (grant, allocationLimit): ByteStorage => {
      if (
        closed ||
        !integer(grant.address) ||
        grant.address === 0 ||
        grant.address % 4096 !== 0 ||
        !integer(grant.length) ||
        grant.length > MAXIMUM_LENGTH
      )
        throw "NATIVE_WORKER_BACKING_GRANT";
      const view = adoptExternal(
        new Uint8Array(0),
        grant.address,
        grant.length,
      );
      const storage = adoptByteStorage(
        view,
        grant.maximum,
        grant.resizable,
        allocationLimit,
        allocate,
      );
      if (!storage.ok) throw "NATIVE_WORKER_BACKING_GRANT";
      register(grant.address, view);
      return storage.value;
    },
    discard: (grant): void => unmap(grant.address, extent(grant.length)),
    close: (): void => {
      if (closed) return;
      closed = true;
      mappings.forEach((mapping, address): void =>
        unmap(address, mapping.mappedBytes),
      );
      mappings.clear();
      liveBytes = 0;
      liveMappings = 0;
    },
  };
}
