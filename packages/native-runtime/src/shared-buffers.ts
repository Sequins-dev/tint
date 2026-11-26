import {
  sharedBlockAddressOffset,
  sharedBlockDescriptorBytes,
  sharedBlockLengthOffset,
  sharedBlockPublished,
  sharedBlockStateOffset,
  sharedRegistryHeaderBytes,
  sharedRegistryPublishedCountOffset,
} from "@tint/abi/shared-block";
import { externalAddress } from "./ffi/primitives.ts";
import { monotonicMilliseconds } from "./intrinsics/clock.ts";
import { currentContextDomain } from "./intrinsics/memory.ts";
import {
  attachNativeSharedBlockService,
  createNativeSharedBlockService,
  nativeSharedAtomicMemoryHost,
  nativeSharedMemoryHost,
  type NativeSharedBlockService,
} from "./shared-blocks.ts";
import {
  readNumber,
  writeNumber,
  type NativeSharedBlockRegistry,
  type NativeSharedMemoryHost,
} from "./shared-memory-host.ts";
import {
  attachNativeWaitRegistry,
  createNativeWaitRegistry,
  nativeWaiterParkingHost,
  type NativeWaitRegistry,
} from "./shared-waiters.ts";

// Identity-page and worker-record byte offsets matching @tint/abi/host
// (literal constants so single-module runtimes without module init stay pure).
const nativeIdentityWaitRegistryBaseOffset = 40;
const nativeIdentityWaitRegistryLengthOffset = 48;
const nativeIdentityWaitRegistryEngineOffset = 56;
const nativeIdentityWorkerRecordOffset = 64;
const nativeWorkerStopStateOffset = 72;
const nativeWorkerWaitTicketOffset = 104;

// Typed SharedArrayBuffers (docs/design-worker-runtime.md, "Typed
// buffers"): each is the payload of a fixed-length block of its isolate's
// shared block service, viewed as a nonmoving borrowed byte array. Blocks
// stay mapped as long as the engine, so a typed buffer may outlive every
// realm wrapper of its block.
//
// Typed code reaches the service without module state, which its runtime
// helpers cannot hold: the isolate's registry is recorded in its hosted
// context's identity page (nativeContextDomainOffset), a zeroed page
// mapped for each context and otherwise used only for its address. Word 0
// holds the registry's address and word 1 its byte length, both zero until
// the isolate first has a service. Words 5-7 hold the wait registry
// (base, byteLength, engineId) and word 8 holds the worker lifecycle record
// address (0 in the main isolate). They are accessed outside any managed
// heap through the shared memory host, which the generational mutator's
// closed-world proof admits (raw memory-word writes it does not).
function identityPage(): NativeSharedBlockRegistry {
  const page = currentContextDomain();
  if (page <= 0) throw "SHARED_BLOCKS_CONTEXT";
  return { base: page, byteLength: 72, engineId: page };
}
/** Record `service` as the isolate's shared block service: the Worker
 * host's, created or attached before any of the isolate's code runs. */
export function installIsolateSharedBlocks(
  service: NativeSharedBlockService,
  workerRecordBase: number = 0,
): void {
  const memory = nativeSharedMemoryHost(),
    page = identityPage(),
    registry = service.registry,
    scratch = new Uint32Array(2),
    current = readNumber(memory, page, 0, scratch);
  if (current !== 0 && current !== registry.base) throw "ISOLATE_SHARED_BLOCKS";
  writeNumber(memory, page, 8, registry.byteLength);
  writeNumber(memory, page, 0, registry.base);
  const waitRegistry = service.waitRegistry;
  if (waitRegistry !== undefined) {
    writeNumber(
      memory,
      page,
      nativeIdentityWaitRegistryLengthOffset,
      waitRegistry.byteLength,
    );
    writeNumber(
      memory,
      page,
      nativeIdentityWaitRegistryEngineOffset,
      waitRegistry.engineId,
    );
    writeNumber(
      memory,
      page,
      nativeIdentityWaitRegistryBaseOffset,
      waitRegistry.base,
    );
  }
  if (workerRecordBase > 0)
    writeNumber(
      memory,
      page,
      nativeIdentityWorkerRecordOffset,
      workerRecordBase,
    );
}
/** The isolate's shared block service. An isolate without a Worker host
 * creates one on first use, which no other agent can reach. */
export function isolateSharedBlocks(): NativeSharedBlockService {
  const memory = nativeSharedMemoryHost(),
    atomic = nativeSharedAtomicMemoryHost(),
    page = identityPage(),
    scratch = new Uint32Array(2),
    base = readNumber(memory, page, 0, scratch);
  if (base > 0) {
    const attached = attachNativeSharedBlockService(
      memory,
      {
        base,
        byteLength: readNumber(memory, page, 8, scratch),
        engineId: base,
      },
      atomic,
    );
    if (!attached.ok) throw "ISOLATE_SHARED_BLOCKS";
    return attached.value;
  }
  const created = createNativeSharedBlockService(
    memory,
    {
      pageSize: 16384,
      maxBlocks: 65536,
      maxReservedBytes: Number.MAX_SAFE_INTEGER,
    },
    atomic,
  );
  if (!created.ok) throw new RangeError("Array buffer allocation failed");
  installIsolateSharedBlocks(created.value);
  return created.value;
}
/** A typed `new SharedArrayBuffer(length)`, `length` already a valid
 * index: a new fixed-length block's payload address. */
export function newSharedBlock(length: number): number {
  const shared = isolateSharedBlocks();
  const created = shared.create(length, length, false);
  if (!created.ok) throw new RangeError("Array buffer allocation failed");
  return shared.address(created.value.handle);
}
interface SharedBlockEntry {
  readonly handle: number;
  readonly base: number;
  readonly byteLength: number;
}
function findSharedBlock(
  memory: NativeSharedMemoryHost,
  page: NativeSharedBlockRegistry,
  address: number,
  scratch: Uint32Array,
): SharedBlockEntry | undefined {
  if (address <= 0) return undefined;
  const base = readNumber(memory, page, 0, scratch);
  if (base <= 0) return undefined;
  const registry: NativeSharedBlockRegistry = {
    base,
    byteLength: readNumber(memory, page, 8, scratch),
    engineId: base,
  };
  const count = readNumber(
    memory,
    registry,
    sharedRegistryPublishedCountOffset,
    scratch,
  );
  for (let handle = 1; handle <= count; handle++) {
    const offset =
      sharedRegistryHeaderBytes + (handle - 1) * sharedBlockDescriptorBytes;
    if (
      readNumber(memory, registry, offset + sharedBlockStateOffset, scratch) ===
        sharedBlockPublished &&
      readNumber(
        memory,
        registry,
        offset + sharedBlockAddressOffset,
        scratch,
      ) === address
    )
      return {
        handle,
        base: address,
        byteLength: readNumber(
          memory,
          registry,
          offset + sharedBlockLengthOffset,
          scratch,
        ),
      };
  }
  return undefined;
}
function attachIsolateWaitRegistry(
  memory: NativeSharedMemoryHost,
  page: NativeSharedBlockRegistry,
  scratch: Uint32Array,
  createIfMissing: boolean,
): NativeWaitRegistry | undefined {
  const base = readNumber(
    memory,
    page,
    nativeIdentityWaitRegistryBaseOffset,
    scratch,
  );
  const parking = nativeWaiterParkingHost();
  if (base > 0) {
    const attached = attachNativeWaitRegistry(memory, parking, {
      base,
      byteLength: readNumber(
        memory,
        page,
        nativeIdentityWaitRegistryLengthOffset,
        scratch,
      ),
      engineId: readNumber(
        memory,
        page,
        nativeIdentityWaitRegistryEngineOffset,
        scratch,
      ),
    });
    if (!attached.ok) throw "ISOLATE_WAIT_REGISTRY";
    return attached.value;
  }
  if (!createIfMissing) return undefined;
  const created = createNativeWaitRegistry(memory, parking, page.base, 65536);
  if (!created.ok) throw new RangeError("Wait registry allocation failed");
  const registry = created.value.registry;
  writeNumber(
    memory,
    page,
    nativeIdentityWaitRegistryLengthOffset,
    registry.byteLength,
  );
  writeNumber(
    memory,
    page,
    nativeIdentityWaitRegistryEngineOffset,
    registry.engineId,
  );
  writeNumber(
    memory,
    page,
    nativeIdentityWaitRegistryBaseOffset,
    registry.base,
  );
  return created.value;
}
/** True when `array` is a typed SharedArrayBuffer (a borrowed byte array
 * viewing a published block of this isolate's shared block service). Never
 * creates a service on an isolate that does not already have one. */
export function isNativeSharedArrayBuffer(array: Uint8Array): boolean {
  const address = externalAddress(array);
  if (address < 0) return false;
  const memory = nativeSharedMemoryHost(),
    page = identityPage(),
    scratch = new Uint32Array(2);
  return findSharedBlock(memory, page, address, scratch) !== undefined;
}
/** Typed `Atomics.wait(typedArray, index, value, timeout?)` after view/index
 * validation and operand conversion. Returns "ok", "not-equal", "timed-out",
 * or "" when interrupted by a worker termination stop request. */
export function nativeAtomicsWait(
  bufferAddress: number,
  byteOffset: number,
  width: number,
  expectedLo: number,
  expectedHi: number,
  timeout: number,
): string {
  const elementWidth: 4 | 8 = width === 8 ? 8 : 4;
  const memory = nativeSharedMemoryHost(),
    page = identityPage(),
    scratch = new Uint32Array(2);
  const block = findSharedBlock(memory, page, bufferAddress, scratch);
  if (block === undefined)
    throw new TypeError("Atomics.wait cannot be called in this context");
  const waiters = attachIsolateWaitRegistry(memory, page, scratch, true);
  if (waiters === undefined) throw "ISOLATE_WAIT_REGISTRY";
  const duration = timeout !== timeout ? Infinity : timeout < 0 ? 0 : timeout;
  const registered = waiters.register(
    {
      engineId: waiters.registry.engineId,
      blockId: block.handle,
      address: block.base,
      byteLength: block.byteLength,
      byteOffset,
      width: elementWidth,
    },
    expectedLo >>> 0,
    elementWidth === 8 ? expectedHi >>> 0 : 0,
    duration === 0,
  );
  if (!registered.ok) throw new RangeError("Too many waiting threads");
  const registration = registered.value;
  if (registration.state !== "waiting") return registration.state;
  const ticket = registration.ticket;
  const workerBase = readNumber(
    memory,
    page,
    nativeIdentityWorkerRecordOffset,
    scratch,
  );
  const workerRecord: NativeSharedBlockRegistry | undefined =
    workerBase > 0
      ? { base: workerBase, byteLength: 16384, engineId: workerBase }
      : undefined;
  function stopRequested(): boolean {
    if (workerRecord === undefined) return false;
    return (
      readNumber(memory, workerRecord, nativeWorkerStopStateOffset, scratch) !==
      0
    );
  }
  let live = true;
  try {
    const started = monotonicMilliseconds();
    const deadline = started + duration;
    for (;;) {
      if (stopRequested()) return "";
      const observed = waiters.poll(ticket);
      if (!observed.ok) throw "ATOMIC_WAIT_POLL_INVARIANT";
      if (observed.value !== "waiting") {
        const completed = waiters.take(ticket);
        if (!completed.ok || completed.value === "waiting")
          throw "ATOMIC_WAIT_COMPLETION_INVARIANT";
        live = false;
        if (stopRequested()) return "";
        return completed.value === "notified" ? "ok" : "timed-out";
      }
      const now = monotonicMilliseconds();
      if (now >= deadline) {
        const expired = waiters.expire(ticket);
        if (!expired.ok) throw "ATOMIC_WAIT_TIMEOUT_INVARIANT";
        continue;
      }
      const nanoseconds =
        deadline === Infinity
          ? 0
          : Math.min(
              Number.MAX_SAFE_INTEGER,
              Math.max(1, Math.ceil((deadline - now) * 1000000)),
            );
      if (workerRecord !== undefined)
        writeNumber(memory, workerRecord, nativeWorkerWaitTicketOffset, ticket);
      try {
        if (stopRequested()) return "";
        const parked = waiters.park(ticket, nanoseconds);
        if (!parked.ok) throw "ATOMIC_WAIT_PARK_INVARIANT";
        if (stopRequested()) return "";
      } finally {
        if (workerRecord !== undefined)
          writeNumber(memory, workerRecord, nativeWorkerWaitTicketOffset, 0);
      }
    }
  } finally {
    if (live) {
      waiters.expire(ticket);
      waiters.take(ticket);
    }
  }
}
/** Typed `Atomics.notify(typedArray, index, count?)` after view/index
 * validation. Ordinary ArrayBuffers return 0; shared buffers wake up to
 * `count` FIFO waiters at `(block, byteOffset)`. */
export function nativeAtomicsNotify(
  bufferAddress: number,
  byteOffset: number,
  width: number,
  count: number,
): number {
  const elementWidth: 4 | 8 = width === 8 ? 8 : 4;
  // ToIntegerOrInfinity(count), clamped to [0, Infinity].
  let limit: number;
  if (count !== count || count <= 0) limit = 0;
  else if (count === Infinity || count > Number.MAX_SAFE_INTEGER)
    limit = Infinity;
  else limit = Math.trunc(count);
  const memory = nativeSharedMemoryHost(),
    page = identityPage(),
    scratch = new Uint32Array(2);
  const block = findSharedBlock(memory, page, bufferAddress, scratch);
  if (block === undefined) return 0;
  const waiters = attachIsolateWaitRegistry(memory, page, scratch, false);
  if (waiters === undefined) return 0;
  const notified = waiters.notify(
    block.handle,
    byteOffset,
    elementWidth,
    limit,
  );
  if (!notified.ok) throw "ATOMIC_NOTIFY_INVARIANT";
  return notified.value;
}
