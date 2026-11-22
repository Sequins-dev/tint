import {
  installAtomicsIntrinsics,
  installSharedArrayBufferIntrinsics,
  processAtomicWaitEvents,
  type ErrorRealm,
  type OrdinaryObject,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import type { SharedBlockWaiting } from "@tint/js-runtime/bytes/shared";
import {
  createNodeWorkerThreads,
  type NodeWorkerLaunch,
  type NodeWorkerPlan,
  type NodeWorkerThreads,
  type WorkerResourceLimits,
} from "./worker-threads.ts";
import type { ReactorEventLoop } from "../event-loop-reactor.ts";
import type { EventLoopHandle } from "../event-loop.ts";
import {
  attachNativeSharedBlockService,
  createNativeSharedBlockService,
  nativeSharedAtomicMemoryHost,
  type NativeSharedBlockService,
} from "../shared-blocks.ts";
import {
  compareNumber,
  readNumber,
  type NativeSharedMemoryHost,
  type NativeSharedBlockRegistry,
} from "../shared-memory-host.ts";
import type { NativeWaiterParkingHost } from "../shared-waiters.ts";
import { nativePacketMemory } from "../packet-memory.ts";
import {
  startNativeWorker,
  type NativeWorkerEngineGrant,
  type NativeWorkerLifecycle,
  type NativeWorkerRequest,
  type NativeWorkerThreadHost,
  type NativeWorkerTurnControl,
} from "../worker-lifecycle.ts";

interface NodeWorkerHost {
  readonly global: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly realm: ErrorRealm;
  readonly reactor: ReactorEventLoop;
  readonly memory: NativeSharedMemoryHost;
  readonly parking: NativeWaiterParkingHost;
  readonly threads: NativeWorkerThreadHost;
  readonly threadId: number;
  readonly control: NativeWorkerTurnControl | undefined;
  readonly managedBytes: number;
  readonly stackBytes: number;
  now(): number;
  lookup(filename: string): number | undefined;
}
export interface NodeWorkerSession {
  readonly exports: NodeWorkerThreads;
  checkpointAtomicWaits(): number;
  close(): void;
}

const MiB = 1048576;
const page = 16384;

export function startNodeWorkerHost(host: NodeWorkerHost): NodeWorkerSession {
  const { realm, control, memory, parking, reactor } = host;
  const atomic = nativeSharedAtomicMemoryHost();
  let service: NativeSharedBlockService;
  let engine: NativeWorkerEngineGrant;
  if (control === undefined) {
    const created = createNativeSharedBlockService(
      memory,
      {
        pageSize: page,
        maxBlocks: 65536,
        maxReservedBytes: Number.MAX_SAFE_INTEGER,
      },
      atomic,
      { parking, now: (): number => host.now(), maxWaiters: 65536 },
    );
    if (!created.ok)
      throw new Error("cannot create worker shared block service");
    service = created.value;
    const sequence = memory.mapMemory(page);
    if (sequence <= 0)
      throw new Error("cannot allocate worker thread identity sequence");
    engine = { sequence, shared: service.registry };
  } else {
    const descriptor = control.engine;
    const waiters = control.waiters;
    if (descriptor === undefined || waiters === undefined)
      throw "WORKER_ENGINE_STARTUP";
    const active: NativeWorkerTurnControl = control;
    const attached = attachNativeSharedBlockService(
      memory,
      descriptor.shared,
      atomic,
      {
        parking,
        now: (): number => host.now(),
        registry: waiters.registry,
        wrapWaiting: (waiting): SharedBlockWaiting =>
          active.interruptibleWaiting(waiting),
      },
    );
    if (!attached.ok)
      throw new Error("cannot attach worker shared block service");
    service = attached.value;
    engine = descriptor;
    reactor.watchReadable(active.input, (): void => {}).unref();
  }
  const sequence: NativeSharedBlockRegistry = {
    base: engine.sequence,
    byteLength: page,
    engineId: engine.sequence,
  };
  const scratch = new Uint32Array(2);
  const waits = service.waitEvents;
  if (waits === undefined) throw "WORKER_ENGINE_WAIT_REGISTRY";
  const waitEvents = waits;
  const imageEngine = engine;
  installSharedArrayBufferIntrinsics(
    host.global,
    realm,
    realm.objectHooks,
    service,
  );
  installAtomicsIntrinsics(host.global, realm, realm.objectHooks, {
    lockFree1: true,
    lockFree2: true,
    lockFree8: true,
  });
  function nextThreadId(): number {
    let previous = readNumber(memory, sequence, 0, scratch);
    for (;;) {
      if (previous === Number.MAX_SAFE_INTEGER)
        throw new RangeError("worker thread identity space exhausted");
      const seen = compareNumber(
        memory,
        sequence,
        0,
        previous,
        previous + 1,
        scratch,
      );
      if (seen === previous) return previous + 1;
      previous = seen;
    }
  }
  function size(
    amount: number | undefined,
    maximum: number,
    minimum: number,
  ): number {
    if (amount === undefined) return maximum;
    const result = Math.floor((amount * MiB) / 16) * 16;
    if (result < minimum || result > maximum)
      throw new RangeError(
        "worker resource limit is outside the image's supported range",
      );
    return result;
  }
  const threads = createNodeWorkerThreads({
    realm,
    control,
    reactor,
    memory,
    parking,
    threads: host.threads,
    shared: service,
    packets: nativePacketMemory(),
    threadId: host.threadId,
    prepare: (filename, requested): NodeWorkerPlan => {
      const moduleId = host.lookup(filename);
      if (moduleId === undefined)
        throw new Error("Worker module is absent from the image: " + filename);
      if (requested.codeRangeSizeMb !== undefined)
        throw new Error("Code range limits require a JIT-enabled worker image");
      const old = requested.maxOldGenerationSizeMb,
        young = requested.maxYoungGenerationSizeMb;
      const combined = old === undefined ? young : old + (young ?? 0);
      const heapBytes = size(combined, host.managedBytes, page * 4);
      const stackBytes = size(requested.stackSizeMb, host.stackBytes, page * 8);
      const resourceLimits: WorkerResourceLimits = {
        maxYoungGenerationSizeMb: young,
        maxOldGenerationSizeMb:
          old ?? (young === undefined ? heapBytes / MiB : undefined),
        codeRangeSizeMb: undefined,
        stackSizeMb: stackBytes / MiB,
      };
      return {
        resourceLimits,
        launch: (request: NodeWorkerLaunch): NativeWorkerLifecycle => {
          const start: NativeWorkerRequest = {
            threadId: nextThreadId(),
            moduleId,
            stackBytes,
            heapBytes,
            engine: imageEngine,
            waiters: waitEvents,
            parentPort: request.parentPort,
            onError: (message: string): void => request.onError(message),
            onExit: (status: number): void => request.onExit(status),
            onUnclaimedParentPort: request.onUnclaimedParentPort,
          };
          return startNativeWorker(
            memory,
            parking,
            host.threads,
            reactor,
            start,
          );
        },
      };
    },
  });
  let reference: EventLoopHandle | undefined;
  let timeout: EventLoopHandle | undefined;
  let deadline: number = Infinity;
  function checkpointAtomicWaits(): number {
    const completed = processAtomicWaitEvents(realm.agent, true);
    const pending = realm.agent.pendingAtomicWaits;
    if (pending.length === 0) {
      reference?.close();
      reference = undefined;
      timeout?.close();
      timeout = undefined;
      deadline = Infinity;
      return completed;
    }
    const target = reactor.wakeTarget();
    let next = Infinity;
    for (const wait of pending) {
      if (!waitEvents.setWakeTarget(wait.ticket, target).ok)
        throw "WORKER_ENGINE_ASYNC_WAIT";
      next = Math.min(next, wait.deadline);
    }
    if (reference === undefined) reference = reactor.loop.retain();
    if (deadline !== next) {
      deadline = next;
      timeout?.close();
      timeout = undefined;
      if (deadline !== Infinity)
        timeout = reactor.loop.scheduleDeadline((): void => {
          deadline = Infinity;
        }, deadline);
    }
    return completed;
  }
  return {
    exports: threads,
    checkpointAtomicWaits,
    close: (): void => {
      const pending = realm.agent.pendingAtomicWaits;
      for (const wait of pending) {
        wait.waiting.expire(wait.ticket);
        wait.waiting.take(wait.ticket);
      }
      pending.length = 0;
      reference?.close();
      timeout?.close();
      threads.close();
    },
  };
}
