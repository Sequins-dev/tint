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
} from "./shared-memory-host.ts";

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
// the isolate first has a service. They are accessed outside any managed
// heap through the shared memory host, which the generational mutator's
// closed-world proof admits (raw memory-word writes it does not).
function identityPage(): NativeSharedBlockRegistry {
  const page = currentContextDomain();
  if (page <= 0) throw "SHARED_BLOCKS_CONTEXT";
  return { base: page, byteLength: 16, engineId: page };
}
/** Record `service` as the isolate's shared block service: the Worker
 * host's, created or attached before any of the isolate's code runs. */
export function installIsolateSharedBlocks(
  service: NativeSharedBlockService,
): void {
  const memory = nativeSharedMemoryHost(),
    page = identityPage(),
    registry = service.registry,
    current = readNumber(memory, page, 0, new Uint32Array(2));
  if (current !== 0 && current !== registry.base) throw "ISOLATE_SHARED_BLOCKS";
  writeNumber(memory, page, 8, registry.byteLength);
  writeNumber(memory, page, 0, registry.base);
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
